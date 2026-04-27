// api/hiring-team.js
//
// Phase 0 v2 — Find the Hiring Team (orchestrator)
//
// Flow:
//   1. Validate request (method, params, whitelist, rate limit, daily ceiling)
//   2. Canonicalize company
//   3. Check empty-sentinel cache (skip Firecrawl entirely if recently empty)
//   4. Check team cache; serve if fresh
//   5. Build 4 queries; fan out via Firecrawl /v2/search in parallel
//   6. Require >=2 successful sub-queries to render team UI
//   7. Dedupe + rank (lib/hiring-team-rank.js)
//   8. Write cache (team or empty sentinel)
//   9. Return structured response

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
const MAX_REQ_PER_HOUR = 10;          // per-IP, in-memory bucket
const HOUR_MS = 60 * 60 * 1000;
const DAILY_FIRECRAWL_CEILING = 100;  // max unique team lookups per UTC day
const MIN_SUCCESSFUL_QUERIES = 2;     // require >=2 of 4 to render team

// Module-scope state. Resets on cold start. Phase 0 accepts cold-start reset
// as imperfect rate-limit (each instance enforces its own bucket); Phase 1
// upgrade is Vercel KV-backed limiter. Daily ceiling is also module-scope;
// see RISK in spec for documented limitation.
const ipBuckets = new Map();
let dailyTracker = { date: '', count: 0 };

// ---- Lazy whitelist load -------------------------------------------------
// Whitelist of canonical company names is derived from jobs-data.json.
// We fetch jobs-data.json once per warm instance and cache the canonical set.

let _whitelistMemo = null;
let _whitelistFetchedAt = 0;
const WHITELIST_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes per warm instance

async function loadWhitelist() {
  const now = Date.now();
  if (_whitelistMemo && (now - _whitelistFetchedAt) < WHITELIST_TTL_MS) {
    return _whitelistMemo;
  }

  try {
    // jobs-data.json is in the same Vercel Blob bucket. We need its public URL.
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
    return set;
  } catch (err) {
    console.error('[hiring-team] whitelist load error:', err.message);
    // Failed load — return cached if available, else empty (fail closed).
    return _whitelistMemo || new Set();
  }
}

// ---- Rate limiting -------------------------------------------------------

function getClientIp(req) {
  // Vercel sets x-forwarded-for; fall back to socket address.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip) || { count: 0, windowStart: now };

  if ((now - bucket.windowStart) > HOUR_MS) {
    bucket.count = 1;
    bucket.windowStart = now;
  } else {
    bucket.count += 1;
  }

  ipBuckets.set(ip, bucket);
  return bucket.count <= MAX_REQ_PER_HOUR;
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
  // Mirrors the existing xrayUrl() in index.html — kept here to avoid
  // depending on client code from the server.
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
  // Method check
  if (req.method !== 'GET') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  // Parse query params (Vercel parses for us at req.query for Node runtime)
  const url = new URL(req.url, 'http://localhost');
  const company = (req.query?.company || url.searchParams.get('company') || '').trim();
  const jobFunction = (req.query?.jobFunction || url.searchParams.get('jobFunction') || 'engineering').trim();

  if (!company) {
    return send(res, 400, { error: 'missing_company' });
  }
  if (company.length > 200) {
    return send(res, 400, { error: 'company_too_long' });
  }
  if (jobFunction.length > 100) {
    return send(res, 400, { error: 'jobFunction_too_long' });
  }

  // Whitelist check — company must exist in Ascent corpus (zero-cost rejection)
  const canonical = canonicalizeCompany(company);
  if (!canonical) {
    return send(res, 400, { error: 'company_invalid' });
  }
  const whitelist = await loadWhitelist();
  if (whitelist.size > 0 && !whitelist.has(canonical)) {
    return send(res, 400, { error: 'company_not_in_corpus' });
  }

  // Per-IP rate limit
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return send(res, 429, { error: 'rate_limit_exceeded', retryAfterSeconds: 3600 });
  }

  // Empty-sentinel cache — if recently confirmed empty, skip everything
  const emptyCheck = await getEmptyEntry(canonical);
  if (emptyCheck.hit && emptyCheck.fresh) {
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

  // Cache miss or stale → need to fetch. Daily ceiling check (circuit breaker).
  if (!checkDailyCeiling()) {
    return send(res, 200, fallbackPayload(company, jobFunction, 'Daily search budget reached. Search LinkedIn directly →'));
  }

  // API key check — no Firecrawl call possible without it
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error('[hiring-team] FIRECRAWL_API_KEY missing in env');
    return send(res, 200, fallbackPayload(company, jobFunction, 'Search service not configured. Search LinkedIn directly →'));
  }

  // Build queries and fan out
  const queries = buildTeamQueries(company, jobFunction);
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

  // Bump daily counter regardless of success — credits were spent on attempt
  bumpDailyCeiling();

  // Need at least MIN_SUCCESSFUL_QUERIES to render team UI
  if (fanout.successCount < MIN_SUCCESSFUL_QUERIES) {
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

  // Empty after ranking → write empty sentinel
  if (ranked.length === 0) {
    try {
      await writeEmptyEntry(canonical, 'all queries succeeded but 0 valid /in/ profiles after dedupe');
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
  } catch (err) {
    console.error('[hiring-team] writeTeamEntry failed:', err.message);
    // Continue — we can still return the result without caching
  }

  // Return response
  const message = fanout.successCount === 4
    ? 'Live results'
    : `Showing results from ${fanout.successCount} of 4 searches`;

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
