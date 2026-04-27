// api/hiring-team.js
//
// Phase 0 v2 Handoff 4 — Find the Hiring Team (orchestrator)
//
// Changes from Handoff 1:
//   1. Rate limit moved AFTER cache lookup — cache hits don't count.
//      The rate limit protects Firecrawl call rate, not endpoint hit rate.
//   2. Per-IP cache-miss rate raised from 10/hour to 30/hour.
//   3. Added separate per-IP TOTAL request rate (200/hour) as outer defense.
//   4. Daily Firecrawl ceiling raised from 100/day to 200/day.
//   5. Added [hiring-team] prefixed diagnostic logging at every decision
//      point (matches §10 self-healing pattern from ascent-engineering).
//
// Flow (corrected):
//   1. Validate request (method, params)
//   2. Whitelist check (zero-cost rejection of non-corpus companies)
//   3. Per-IP TOTAL request limit (catches runaway clients only)
//   4. Canonicalize company
//   5. Check empty-sentinel cache (zero credits, fast bailout)
//   6. Check team cache; serve if fresh (zero credits, fast bailout)
//   7. Per-IP CACHE-MISS rate limit (only counts here — protects Firecrawl)
//   8. Daily Firecrawl ceiling check (circuit breaker)
//   9. Build 4 queries; fan out via Firecrawl /v2/search in parallel
//  10. Require >=2 successful sub-queries to render team UI
//  11. Dedupe + rank (lib/hiring-team-rank.js)
//  12. Write cache (team or empty sentinel)
//  13. Return structured response

const { searchTeamParallel, buildTeamQueries } = require('../lib/firecrawl-client');
const {
  canonicalizeCompany,
  getTeamEntry,
  getEmptyEntry,
  writeTeamEntry,
  writeEmptyEntry,
  daysSince
} = require('../lib/hiring-team-cache');
const { rankTeam } = require('../lib/hiring-team-rank');

// ---- Config --------------------------------------------------------------

const ALLOWED_ROLES = ['recruiter', 'hm', 'peer', 'skip'];
const MAX_CACHE_MISS_PER_HOUR = 30;       // per-IP — counted ONLY on Firecrawl-bound requests
const MAX_TOTAL_REQ_PER_HOUR = 200;       // per-IP — outer defense against runaway loops
const HOUR_MS = 60 * 60 * 1000;
const DAILY_FIRECRAWL_CEILING = 200;      // total team lookups across all users per UTC day
const MIN_SUCCESSFUL_QUERIES = 2;         // require >=2 of 4 to render team

// Module-scope state. Resets on cold start. Phase 0 accepts cold-start reset
// as imperfect rate-limit (each instance enforces its own bucket); Phase 1
// upgrade is Vercel KV-backed limiter.
const ipMissBuckets = new Map();          // per-IP cache-miss counter
const ipTotalBuckets = new Map();         // per-IP total request counter
let dailyTracker = { date: '', count: 0 };

// ---- Lazy whitelist load -------------------------------------------------

let _whitelistMemo = null;
let _whitelistFetchedAt = 0;
const WHITELIST_TTL_MS = 5 * 60 * 1000;

async function loadWhitelist() {
  const now = Date.now();
  if (_whitelistMemo && (now - _whitelistFetchedAt) < WHITELIST_TTL_MS) {
    return _whitelistMemo;
  }

  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: 'jobs-data.json', limit: 1 });
    if (!blobs || blobs.length === 0) {
      console.warn('[hiring-team] jobs-data.json not found in blob — whitelist empty');
      _whitelistMemo = new Set();
      _whitelistFetchedAt = now;
      return _whitelistMemo;
    }

    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`whitelist fetch failed: ${res.status}`);
    }
    const data = await res.json();

    const set = new Set();
    if (data && Array.isArray(data.data)) {
      for (const job of data.data) {
        const name = job._company || job.employer_name;
        if (name) set.add(canonicalizeCompany(name));
      }
    }
    _whitelistMemo = set;
    _whitelistFetchedAt = now;
    console.log(`[hiring-team] whitelist loaded: ${set.size} canonical company names`);
    return set;
  } catch (err) {
    console.error('[hiring-team] whitelist load error:', err.message);
    return _whitelistMemo || new Set();
  }
}

// ---- Rate limiting -------------------------------------------------------

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkAndBumpBucket(bucketsMap, ip, maxPerHour) {
  const now = Date.now();
  const bucket = bucketsMap.get(ip) || { count: 0, windowStart: now };

  if ((now - bucket.windowStart) > HOUR_MS) {
    bucket.count = 1;
    bucket.windowStart = now;
  } else {
    bucket.count += 1;
  }

  bucketsMap.set(ip, bucket);
  return { ok: bucket.count <= maxPerHour, count: bucket.count };
}

function checkTotalRequestRate(ip) {
  return checkAndBumpBucket(ipTotalBuckets, ip, MAX_TOTAL_REQ_PER_HOUR);
}

function checkCacheMissRate(ip) {
  return checkAndBumpBucket(ipMissBuckets, ip, MAX_CACHE_MISS_PER_HOUR);
}

function checkDailyCeiling() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyTracker.date !== today) {
    dailyTracker = { date: today, count: 0 };
  }
  return dailyTracker.count < DAILY_FIRECRAWL_CEILING;
}

function bumpDailyCeiling() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyTracker.date !== today) {
    dailyTracker = { date: today, count: 0 };
  }
  dailyTracker.count += 1;
}

// ---- Response helpers ----------------------------------------------------

function buildXrayUrl(company, role) {
  const co = encodeURIComponent(`"${company}"`);
  let q;
  switch (role) {
    case 'recruiter': q = `site:linkedin.com/in ${co} recruiter`; break;
    case 'hm':        q = `site:linkedin.com/in ${co} "hiring manager" OR "head of"`; break;
    case 'skip':      q = `site:linkedin.com/in ${co} "VP" OR "Director"`; break;
    default:          q = `site:linkedin.com/in ${co}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function fallbackPayload(company, jobFunction, reason) {
  return {
    source: 'fallback',
    company,
    jobFunction: jobFunction || null,
    team: [],
    partialQueryCount: 0,
    verifiedAt: null,
    fallbackXrayUrl: buildXrayUrl(company, 'all'),
    message: reason || 'Search service unavailable. Search LinkedIn directly →'
  };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// ---- Main handler --------------------------------------------------------

module.exports = async function handler(req, res) {
  const startMs = Date.now();

  // Method check
  if (req.method !== 'GET') {
    console.log('[hiring-team] reject method', req.method);
    return send(res, 405, { error: 'method_not_allowed' });
  }

  // Parse query params
  const url = new URL(req.url, 'http://localhost');
  const company = (req.query?.company || url.searchParams.get('company') || '').trim();
  const jobFunction = (req.query?.jobFunction || url.searchParams.get('jobFunction') || 'engineering').trim();

  if (!company) {
    console.log('[hiring-team] reject missing company');
    return send(res, 400, { error: 'missing_company' });
  }
  if (company.length > 200) {
    console.log('[hiring-team] reject company_too_long', company.length);
    return send(res, 400, { error: 'company_too_long' });
  }
  if (jobFunction.length > 100) {
    console.log('[hiring-team] reject jobFunction_too_long', jobFunction.length);
    return send(res, 400, { error: 'jobFunction_too_long' });
  }

  // Whitelist check (zero-cost rejection)
  const canonical = canonicalizeCompany(company);
  if (!canonical) {
    console.log('[hiring-team] reject company_invalid', JSON.stringify(company));
    return send(res, 400, { error: 'company_invalid' });
  }
  const whitelist = await loadWhitelist();
  if (whitelist.size > 0 && !whitelist.has(canonical)) {
    console.log(`[hiring-team] reject company_not_in_corpus: "${company}" -> "${canonical}"`);
    return send(res, 400, { error: 'company_not_in_corpus' });
  }

  // Outer per-IP TOTAL rate limit (catches runaway clients only — generous)
  const ip = getClientIp(req);
  const totalCheck = checkTotalRequestRate(ip);
  if (!totalCheck.ok) {
    console.warn(`[hiring-team] reject total_rate_limit ip=${ip} count=${totalCheck.count}/${MAX_TOTAL_REQ_PER_HOUR}`);
    return send(res, 429, { error: 'rate_limit_exceeded', message: 'Too many requests. Try again in a few minutes.', retryAfterSeconds: 600 });
  }

  // Empty-sentinel cache — recently confirmed empty, skip everything
  const emptyCheck = await getEmptyEntry(canonical);
  if (emptyCheck.hit && emptyCheck.fresh) {
    console.log(`[hiring-team] cache_hit_empty company=${canonical} verifiedAt=${emptyCheck.entry.verifiedAt}`);
    const xrayUrl = buildXrayUrl(company, 'all');
    return send(res, 200, {
      source: 'cache',
      company,
      jobFunction,
      team: [],
      partialQueryCount: 0,
      verifiedAt: emptyCheck.entry.verifiedAt,
      fallbackXrayUrl: xrayUrl,
      message: 'No specific people identified. Search LinkedIn directly →'
    });
  }

  // Team cache — serve if fresh
  const teamCheck = await getTeamEntry(canonical);
  if (teamCheck.hit && teamCheck.fresh) {
    const days = daysSince(teamCheck.entry.verifiedAt);
    const teamCount = (teamCheck.entry.team || []).length;
    console.log(`[hiring-team] cache_hit_team company=${canonical} verifiedAt=${teamCheck.entry.verifiedAt} ageDays=${days} teamCount=${teamCount} elapsedMs=${Date.now() - startMs}`);
    return send(res, 200, {
      source: 'cache',
      company,
      jobFunction,
      team: teamCheck.entry.team || [],
      partialQueryCount: teamCheck.entry.successfulQueries || 0,
      verifiedAt: teamCheck.entry.verifiedAt,
      fallbackXrayUrl: buildXrayUrl(company, 'all'),
      message: days === 0 ? 'Verified today' : `Verified ${days} day${days === 1 ? '' : 's'} ago`
    });
  }

  // Cache miss — now check the cache-miss-specific rate limit
  // This is the limit that protects Firecrawl. Cache hits did NOT increment it.
  const missCheck = checkCacheMissRate(ip);
  if (!missCheck.ok) {
    console.warn(`[hiring-team] reject cache_miss_rate_limit ip=${ip} count=${missCheck.count}/${MAX_CACHE_MISS_PER_HOUR}`);
    return send(res, 429, { error: 'rate_limit_exceeded', message: 'Search limit reached. Try a different company or wait a few minutes.', retryAfterSeconds: 600 });
  }

  // Daily ceiling check (circuit breaker — process-global)
  if (!checkDailyCeiling()) {
    console.warn(`[hiring-team] reject daily_ceiling count=${dailyTracker.count}/${DAILY_FIRECRAWL_CEILING}`);
    return send(res, 200, fallbackPayload(company, jobFunction, 'Daily search budget reached. Search LinkedIn directly →'));
  }

  // API key check
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error('[hiring-team] FIRECRAWL_API_KEY missing in env');
    return send(res, 200, fallbackPayload(company, jobFunction, 'Search service not configured. Search LinkedIn directly →'));
  }

  // Build queries and fan out
  const queries = buildTeamQueries(company, jobFunction);
  console.log(`[hiring-team] firecrawl_fanout company=${canonical} queries=4 ip=${ip}`);
  let fanout;
  try {
    fanout = await searchTeamParallel({
      apiKey,
      queries,
      limit: 5,
      timeoutMs: 8000
    });
  } catch (err) {
    console.error('[hiring-team] fanout error:', err.message);
    return send(res, 200, fallbackPayload(company, jobFunction, 'Search service is having trouble. Search LinkedIn directly →'));
  }

  // Bump daily counter — credits were spent on the attempt
  bumpDailyCeiling();
  console.log(`[hiring-team] firecrawl_complete company=${canonical} successCount=${fanout.successCount}/4 creditsUsed=${fanout.totalCreditsUsed}`);

  // Need at least MIN_SUCCESSFUL_QUERIES to render team UI
  if (fanout.successCount < MIN_SUCCESSFUL_QUERIES) {
    console.warn(`[hiring-team] insufficient_queries company=${canonical} successCount=${fanout.successCount} (need ${MIN_SUCCESSFUL_QUERIES})`);
    return send(res, 200, fallbackPayload(
      company,
      jobFunction,
      `Showing limited results (${fanout.successCount} of 4 searches succeeded). Search LinkedIn directly →`
    ));
  }

  // Dedupe + rank — extract result arrays from successful queries only
  const byQueryResults = {};
  for (const [key, q] of Object.entries(fanout.byQuery)) {
    if (q.ok && Array.isArray(q.results)) {
      byQueryResults[key] = q.results;
    }
  }

  const ranked = rankTeam(byQueryResults, {
    companyName: company,
    totalQueries: 4
  });
  console.log(`[hiring-team] ranked company=${canonical} totalPeople=${ranked.length} topThree=${ranked.filter(p => p.isTopThree).length}`);

  // Empty after ranking → write empty sentinel
  if (ranked.length === 0) {
    try {
      await writeEmptyEntry(canonical, 'all queries succeeded but 0 valid /in/ profiles after dedupe');
      console.log(`[hiring-team] wrote_empty_sentinel company=${canonical}`);
    } catch (err) {
      console.error('[hiring-team] writeEmptyEntry failed:', err.message);
    }
    return send(res, 200, {
      source: 'firecrawl',
      company,
      jobFunction,
      team: [],
      partialQueryCount: fanout.successCount,
      verifiedAt: new Date().toISOString(),
      fallbackXrayUrl: buildXrayUrl(company, 'all'),
      message: 'No specific people identified. Search LinkedIn directly →'
    });
  }

  // Write team cache
  try {
    await writeTeamEntry(canonical, {
      team: ranked,
      queries,
      creditsUsed: fanout.totalCreditsUsed,
      successfulQueries: fanout.successCount
    });
    console.log(`[hiring-team] wrote_team_cache company=${canonical} teamSize=${ranked.length}`);
  } catch (err) {
    console.error('[hiring-team] writeTeamEntry failed:', err.message);
    // Continue — return result even without caching
  }

  // Return response
  const message = fanout.successCount === 4
    ? 'Live results'
    : `Showing results from ${fanout.successCount} of 4 searches`;

  console.log(`[hiring-team] success company=${canonical} elapsedMs=${Date.now() - startMs}`);

  return send(res, 200, {
    source: fanout.successCount === 4 ? 'firecrawl' : 'partial',
    company,
    jobFunction,
    team: ranked,
    partialQueryCount: fanout.successCount,
    verifiedAt: new Date().toISOString(),
    fallbackXrayUrl: buildXrayUrl(company, 'all'),
    message
  });
};
