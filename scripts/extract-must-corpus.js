#!/usr/bin/env node
/**
 * scripts/extract-must-corpus.js
 *
 * Classifies _must phrases against a seed of known canonical AI-role skills
 * (skills/seed-skills.json), producing a three-section report:
 *
 *   1. SEED MATCHES: how often each seed skill (and which alias) appeared
 *   2. UNRECOGNIZED LONG TAIL: high-frequency phrases NOT matched by any seed,
 *      filtered through a beefed-up JD-prose stopword list
 *   3. METADATA: corpus stats, redirect trail, freshness
 *
 * Output is INPUT to taxonomy curation. It does NOT produce taxonomy.json
 * automatically. Dom reviews the seed matches (which to keep, which to drop,
 * which aliases to add) and the long tail (which entries to PROMOTE to seed).
 *
 * Why seed-based vs raw frequency:
 * - Raw frequency on 21K+ jobs produces 251K candidate phrases dominated by
 *   recruiter prose. Unusable for curation.
 * - Seed-based gives ~80 known signals immediately, plus a curated long-tail
 *   bucket for finding what the seed missed.
 *
 * Usage:
 *   node scripts/extract-must-corpus.js > corpus-report.txt
 */

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const JOBS_ENDPOINT = 'https://career-ascent.io/api/jobs-data';
const SEED_PATH = path.join(__dirname, '..', 'skills', 'seed-skills.json');
const MAX_REDIRECTS = 5;
const PROGRESS_BYTES = 5 * 1024 * 1024;

const JD_STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'you', 'your', 'youre', 'youll', 'we', 'us', 'our',
  'they', 'them', 'their', 'this', 'that', 'these', 'those', 'who', 'whom',
  'what', 'when', 'where', 'why', 'how', 'which', 'whose',
  'and', 'or', 'but', 'if', 'then', 'so', 'because', 'while', 'though',
  'although', 'as', 'than', 'like', 'unless', 'until',
  'of', 'in', 'on', 'at', 'by', 'for', 'to', 'with', 'about', 'across',
  'after', 'against', 'among', 'around', 'before', 'behind', 'between',
  'beyond', 'during', 'from', 'into', 'over', 'through', 'throughout',
  'under', 'within', 'without', 'upon', 'toward', 'towards',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
  'must', 'can', 'shall', 'am',
  'work', 'works', 'working', 'worked',
  'build', 'builds', 'building', 'built',
  'develop', 'develops', 'developing', 'developed',
  'deliver', 'delivers', 'delivering', 'delivered',
  'drive', 'drives', 'driving', 'driven',
  'lead', 'leads', 'leading', 'led',
  'manage', 'manages', 'managing', 'managed',
  'ensure', 'ensures', 'ensuring', 'ensured',
  'maintain', 'maintains', 'maintaining', 'maintained',
  'identify', 'identifies', 'identifying', 'identified',
  'help', 'helps', 'helping', 'helped',
  'create', 'creates', 'creating', 'created',
  'define', 'defines', 'defining', 'defined',
  'provide', 'provides', 'providing', 'provided',
  'focus', 'focuses', 'focusing', 'focused',
  'learn', 'learns', 'learning', 'learned',
  'make', 'makes', 'making', 'made',
  'meet', 'meets', 'meeting', 'met',
  'use', 'uses', 'using', 'used',
  'understand', 'understands', 'understanding', 'understood',
  'apply', 'applies', 'applying', 'applied',
  'collaborate', 'collaborates', 'collaborating', 'collaborated',
  'translate', 'translates', 'translating', 'translated',
  'support', 'supports', 'supporting', 'supported',
  'improve', 'improves', 'improving', 'improved',
  'own', 'owns', 'owning', 'owned',
  'design', 'designs', 'designing', 'designed',
  'team', 'teams', 'role', 'roles', 'business', 'company',
  'level', 'stage', 'way', 'ways', 'time', 'times', 'type', 'types',
  'scale', 'range', 'impact', 'value', 'values', 'success', 'process',
  'processes', 'system', 'product', 'products', 'project',
  'projects', 'plan', 'plans', 'goal', 'goals', 'people',
  'environment', 'environments', 'organization', 'organizations',
  'department', 'group', 'groups', 'partner', 'partners', 'partnership',
  'partnerships', 'opportunity', 'opportunities',
  'requirement', 'requirements', 'responsibility',
  'responsibilities', 'qualification', 'qualifications',
  'expertise', 'familiarity', 'proficiency',
  'background', 'mindset', 'attitude', 'approach', 'perspective',
  'capability', 'capabilities', 'strength', 'strengths',
  'strong', 'solid', 'proven', 'demonstrated', 'excellent', 'great',
  'good', 'best', 'better', 'high', 'low', 'fast', 'quick', 'rapid',
  'deep', 'broad', 'wide', 'large', 'small', 'big', 'long', 'short',
  'new', 'old', 'modern', 'current', 'recent', 'latest',
  'multiple', 'several', 'many', 'few', 'some', 'any', 'all',
  'other', 'others', 'another', 'one', 'two', 'three',
  'similar', 'related', 'equivalent', 'relevant', 'specific', 'general',
  'professional', 'personal', 'effective', 'efficient', 'successful',
  'comfortable', 'capable', 'able', 'ready', 'willing', 'eager',
  'experienced', 'skilled', 'proficient', 'qualified',
  'cross-functional', 'hands-on', 'fast-paced', 'end-to-end',
  'self-starter', 'self-directed',
  'years', 'year', 'plus', 'preferred', 'required', 'minimum', 'least',
  'including', 'such', 'etc', 'eg', 'ie', 'haves',
  'degree', 'bachelors', 'masters', 'phd', 'doctorate',
  'over', 'under', 'up', 'down',
  'highly', 'very', 'really', 'quite', 'just', 'only', 'even',
  'not', 'no', 'yes', 'both', 'either', 'neither',
  'more', 'most', 'less',
  'now', 'today', 'currently', 'often', 'always', 'never', 'sometimes',
  'here', 'there', 'everywhere', 'anywhere',
  'above', 'below',
  'key', 'core', 'critical', 'important', 'essential', 'vital',
  'effectively', 'efficiently', 'successfully', 'closely', 'directly',
  'clearly', 'quickly', 'rapidly',
  'written', 'verbal', 'oral',
  'global', 'local', 'national', 'international',
  'senior', 'junior', 'mid', 'staff', 'principal',
  'various', 'diverse',
  'communication', 'communications', 'leadership',
  'collaboration', 'collaborative',
  'execution', 'ownership', 'accountability',
  'feedback', 'mentorship', 'mentoring', 'coaching',
  'delivery', 'planning',
  'experience', 'experiences', 'knowledge', 'understanding',
  'skill', 'skills',
]);

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) {
    process.stderr.write(`!! Seed file not found at ${SEED_PATH}\n`);
    process.stderr.write('!! Run from C:\\ascent so the relative path resolves; or check that skills/seed-skills.json exists.\n');
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch (e) {
    process.stderr.write(`!! Seed file is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }
  if (!Array.isArray(raw.skills)) {
    process.stderr.write('!! Seed file missing "skills" array.\n');
    process.exit(1);
  }
  const canonicalSeen = new Set();
  const aliasSeen = new Map();
  for (const s of raw.skills) {
    if (!s.canonical || !Array.isArray(s.aliases) || s.aliases.length === 0) {
      process.stderr.write(`!! Bad seed entry (missing canonical or aliases): ${JSON.stringify(s)}\n`);
      process.exit(1);
    }
    if (canonicalSeen.has(s.canonical)) {
      process.stderr.write(`!! Duplicate canonical in seed: ${s.canonical}\n`);
      process.exit(1);
    }
    canonicalSeen.add(s.canonical);
    for (const a of s.aliases) {
      const aLow = a.toLowerCase();
      if (aliasSeen.has(aLow)) {
        process.stderr.write(`!! Alias "${a}" appears under both "${aliasSeen.get(aLow)}" and "${s.canonical}" -- ambiguous.\n`);
        process.exit(1);
      }
      aliasSeen.set(aLow, s.canonical);
    }
  }
  return raw;
}

function buildMatchers(seed) {
  const matchers = [];
  for (const s of seed.skills) {
    for (const a of s.aliases) {
      const escaped = a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[^a-z0-9+#./-])${escaped}s?(?=$|[^a-z0-9+#./-])`, 'gi');
      matchers.push({ alias: a, canonical: s.canonical, pattern });
    }
  }
  return matchers;
}

function classifyLine(text, matchers) {
  const lower = text.toLowerCase();
  const matchCounts = new Map();
  let residual = lower;
  for (const m of matchers) {
    const matches = lower.match(m.pattern);
    if (matches && matches.length > 0) {
      const aliasMap = matchCounts.get(m.canonical) || new Map();
      aliasMap.set(m.alias, (aliasMap.get(m.alias) || 0) + matches.length);
      matchCounts.set(m.canonical, aliasMap);
      residual = residual.replace(m.pattern, ' ');
    }
  }
  return { matchCounts, residual };
}

function normalizeToken(tok) {
  return tok.toLowerCase().replace(/[^a-z0-9+\-#./]/g, '').trim();
}

function extractLongTailPhrases(residual) {
  const sentences = residual.split(/[.;,()/\[\]\n]+/);
  const phrases = [];
  for (const s of sentences) {
    const tokens = s.split(/\s+/).map(normalizeToken)
      .filter(t => t.length > 1 && !JD_STOPWORDS.has(t));
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i + len <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + len).join(' ');
        if (phrase.length >= 3) phrases.push(phrase);
      }
    }
    for (const t of tokens) {
      if (/[0-9+#./-]/.test(t) && t.length >= 2) phrases.push(t);
    }
  }
  return phrases;
}

function fetchJson(urlStr, hopsRemaining = MAX_REDIRECTS, history = []) {
  return new Promise((resolve, reject) => {
    if (hopsRemaining <= 0) {
      reject(new Error(`Redirect limit exceeded after ${MAX_REDIRECTS} hops. Trail: ${history.join(' -> ')}`));
      return;
    }
    let parsedUrl;
    try { parsedUrl = new URL(urlStr); } catch (e) { reject(new Error(`Invalid URL: ${urlStr}`)); return; }
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error(`Refusing non-HTTPS URL: ${urlStr}`));
      return;
    }
    history.push(urlStr);
    const req = https.get(urlStr, (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        process.stderr.write(`  redirect ${status} -> ${nextUrl}\n`);
        res.resume();
        fetchJson(nextUrl, hopsRemaining - 1, history).then(resolve, reject);
        return;
      }
      if (status !== 200) { reject(new Error(`HTTP ${status} from ${urlStr}`)); return; }
      const lastModified = res.headers['last-modified'] || 'unknown';
      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let nextProgressMark = PROGRESS_BYTES;
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= nextProgressMark) {
          const mb = (received / (1024 * 1024)).toFixed(1);
          const totalMb = contentLength ? ` / ${(contentLength / (1024 * 1024)).toFixed(1)}` : '';
          process.stderr.write(`  ${mb}${totalMb} MB ...\n`);
          nextProgressMark += PROGRESS_BYTES;
        }
      });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        process.stderr.write(`  done: ${(received / (1024 * 1024)).toFixed(1)} MB received\n`);
        try {
          const parsed = JSON.parse(data);
          resolve({ data: parsed, lastModified, bytes: received, finalUrl: urlStr, hops: history.length });
        } catch (e) {
          const preview = data.slice(0, 200).replace(/\s+/g, ' ');
          reject(new Error(`JSON parse failed: ${e.message}\nFirst 200 chars: ${preview}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error(`Request timeout after 60s: ${urlStr}`)));
  });
}

function printReport(result, jobs, endpointMeta, seed, seedAggregate, longTailFreq, jobsWithMust, mustLineCount) {
  const { lastModified, bytes, finalUrl, hops } = result;
  const meta = endpointMeta || {};

  console.log('=== ASCENT _must SEED-CLASSIFIED CORPUS REPORT ===');
  console.log(`Source: ${JOBS_ENDPOINT}`);
  console.log(`Final URL after redirects: ${finalUrl} (${hops} hop(s))`);
  if (meta.refreshedAt) console.log(`Endpoint refreshed_at: ${meta.refreshedAt}`);
  if (meta.status) console.log(`Endpoint status: ${meta.status}`);
  if (meta.totalJobsReported !== null && meta.totalJobsReported !== undefined) {
    console.log(`Endpoint total_jobs: ${meta.totalJobsReported}`);
  }
  console.log(`HTTP last-modified: ${lastModified}`);
  console.log(`Payload size: ${bytes.toLocaleString()} bytes`);
  console.log(`Seed lastReviewed: ${seed.lastReviewed}`);
  console.log(`Seed skill count: ${seed.skills.length}`);
  console.log('');
  console.log('=== COVERAGE ===');
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Jobs with parsed _must: ${jobsWithMust} (${(jobsWithMust / jobs.length * 100).toFixed(1)}%)`);
  console.log(`Total _must lines analyzed: ${mustLineCount}`);
  console.log('');

  console.log('=== SECTION 1: SEED MATCHES ===');
  console.log('# Format: <total-count>  <canonical>  [<alias-breakdown>]');
  console.log('# Use this to (a) prune seed entries with zero/near-zero count,');
  console.log('# (b) confirm aliases are firing as expected,');
  console.log('# (c) decide which seed entries graduate to skills/taxonomy.json.');
  console.log('');
  const seedSorted = [...seedAggregate.entries()]
    .map(([canonical, aliasMap]) => {
      const total = [...aliasMap.values()].reduce((a, b) => a + b, 0);
      return { canonical, total, aliasMap };
    })
    .sort((a, b) => b.total - a.total);

  for (const entry of seedSorted) {
    const aliasBreakdown = [...entry.aliasMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([alias, count]) => `${alias}=${count}`)
      .join(', ');
    console.log(`${String(entry.total).padStart(7)}  ${entry.canonical.padEnd(30)} [${aliasBreakdown}]`);
  }

  const matchedCanonicals = new Set([...seedAggregate.keys()]);
  const unmatched = seed.skills.filter(s => !matchedCanonicals.has(s.canonical));
  console.log('');
  console.log('=== SECTION 2: SEED ENTRIES WITH ZERO MATCHES ===');
  console.log('# These canonicals appeared zero times in the corpus.');
  console.log('# Either drop them from the seed or check the aliases (case sensitivity, alternate spellings).');
  console.log('');
  if (unmatched.length === 0) {
    console.log('  (none -- every seed entry matched at least once)');
  } else {
    for (const s of unmatched) {
      console.log(`  ${s.canonical.padEnd(30)} aliases: [${s.aliases.join(', ')}]`);
    }
  }

  console.log('');
  console.log('=== SECTION 3: UNRECOGNIZED LONG TAIL (top 200, count >= 50) ===');
  console.log('# Phrases that did NOT match any seed entry, after stopword filtering.');
  console.log('# Review for entries that should be PROMOTED into seed-skills.json.');
  console.log('# Format: <count>  <phrase>');
  console.log('');
  const longTailSorted = [...longTailFreq.entries()]
    .filter(([, c]) => c >= 50)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
  for (const [phrase, count] of longTailSorted) {
    console.log(`${String(count).padStart(7)}  ${phrase}`);
  }
  console.log('');
  console.log(`(Long-tail phrases >=50 count: ${longTailSorted.length} shown of ${[...longTailFreq.values()].filter(c => c >= 50).length} total)`);
  console.log(`(Long-tail phrases >=10 count: ${[...longTailFreq.values()].filter(c => c >= 10).length})`);
  console.log('');
  console.log('=== NEXT STEP ===');
  console.log('1. Review Section 1: prune low-count seed entries; confirm aliases.');
  console.log('2. Review Section 2: drop entries that are not real for this corpus.');
  console.log('3. Review Section 3: promote real skills into seed-skills.json.');
  console.log('4. Re-run this script. Iterate until Section 3 looks like noise.');
  console.log('5. Then commit the curated seed-skills.json AS skills/taxonomy.json (with schema fields filled in).');
}

async function main() {
  process.stderr.write('Loading seed...\n');
  const seed = loadSeed();
  const aliasCount = seed.skills.reduce((n, s) => n + s.aliases.length, 0);
  process.stderr.write(`  loaded ${seed.skills.length} canonicals, ${aliasCount} aliases\n`);

  process.stderr.write('Building matchers...\n');
  const matchers = buildMatchers(seed);
  process.stderr.write(`  ${matchers.length} regex matchers ready\n`);

  process.stderr.write(`Fetching ${JOBS_ENDPOINT} ...\n`);
  let result;
  try {
    result = await fetchJson(JOBS_ENDPOINT);
  } catch (e) {
    process.stderr.write(`!! Fetch failed: ${e.message}\n`);
    process.exit(1);
  }

  const jobs = Array.isArray(result.data) ? result.data
    : Array.isArray(result.data.jobs) ? result.data.jobs
    : Array.isArray(result.data.data) ? result.data.data
    : null;
  if (!jobs) {
    process.stderr.write(`!! Unexpected response shape. Top-level keys: ${Object.keys(result.data || {}).join(', ')}\n`);
    process.exit(1);
  }

  const endpointMeta = {
    refreshedAt: result.data && result.data.refreshed_at ? result.data.refreshed_at : null,
    totalJobsReported: result.data && typeof result.data.total_jobs === 'number' ? result.data.total_jobs : null,
    status: result.data && result.data.status ? result.data.status : null,
  };

  process.stderr.write(`Classifying ${jobs.length} jobs...\n`);
  const seedAggregate = new Map();
  const longTailFreq = new Map();
  let jobsWithMust = 0;
  let mustLineCount = 0;

  for (const j of jobs) {
    if (!Array.isArray(j._must) || j._must.length === 0) continue;
    jobsWithMust++;
    for (const line of j._must) {
      if (typeof line !== 'string') continue;
      mustLineCount++;
      const { matchCounts, residual } = classifyLine(line, matchers);
      for (const [canonical, aliasMap] of matchCounts) {
        const existing = seedAggregate.get(canonical) || new Map();
        for (const [alias, count] of aliasMap) {
          existing.set(alias, (existing.get(alias) || 0) + count);
        }
        seedAggregate.set(canonical, existing);
      }
      const longTail = extractLongTailPhrases(residual);
      for (const p of longTail) {
        longTailFreq.set(p, (longTailFreq.get(p) || 0) + 1);
      }
    }
  }
  process.stderr.write(`  ${seedAggregate.size}/${seed.skills.length} seed canonicals matched, ${longTailFreq.size} long-tail phrases collected\n`);

  printReport(result, jobs, endpointMeta, seed, seedAggregate, longTailFreq, jobsWithMust, mustLineCount);
}

main().catch((e) => {
  process.stderr.write(`!! Unhandled error: ${e.stack || e.message}\n`);
  process.exit(1);
});
