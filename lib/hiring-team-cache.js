// lib/hiring-team-cache.js
//
// Phase 0 v2 — Find the Hiring Team
// Cache layer: Blob read/write, canonicalization, TTL logic.
//
// Cache shape (hiring-teams-cache-v2.json in Vercel Blob):
//   {
//     schemaVersion: 2,
//     lastWriteAt: ISO8601,
//     entries: {
//       "<canonical>:_team": { team:[...], verifiedAt, ttlDays, queries, creditsUsed, successfulQueries },
//       "<canonical>:_empty": { verifiedAt, ttlDays, reason }
//     }
//   }

const { put, list } = require('@vercel/blob');

const CACHE_FILENAME = 'hiring-teams-cache-v2.json';
const SCHEMA_VERSION = 2;
const DEFAULT_TTL_DAYS = 14;
const EMPTY_TTL_DAYS = 3;

// Module-scope memo for warm-instance speed.
// Vercel function instances are reused across invocations within a warm period;
// this avoids re-fetching the Blob on every request.
let _memo = null;
let _memoFetchedAt = 0;
const MEMO_TTL_MS = 60 * 1000; // 60s — long enough to be useful, short enough to pick up writes

// ---- Canonicalization ----------------------------------------------------
// Identical function MUST be applied at write-time and read-time.
// Snapshot tested via assertCanonicalize() below.

function canonicalizeCompany(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s,]+/g, '-')      // spaces and commas -> hyphens
    .replace(/[^\w\-]/g, '')       // strip everything except word chars and hyphens
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
}

// Self-test snapshot — runs on first import in dev/preview, asserts in prod.
// If canonicalization ever silently drifts, this catches it loudly.
function assertCanonicalize() {
  const cases = [
    ['Anthropic', 'anthropic'],
    ['Anthropic, Inc.', 'anthropic-inc'],
    ['anthropic', 'anthropic'],
    ['  Anthropic  ', 'anthropic'],
    ['Saronic Technologies', 'saronic-technologies'],
    ['AT&T', 'att'],
    ['', ''],
    ['---', '']
  ];
  for (const [input, expected] of cases) {
    const got = canonicalizeCompany(input);
    if (got !== expected) {
      throw new Error(
        `canonicalizeCompany regression: input=${JSON.stringify(input)} expected=${JSON.stringify(expected)} got=${JSON.stringify(got)}`
      );
    }
  }
}

// Run snapshot at module load. Throws loudly if canonicalization changed.
assertCanonicalize();

// ---- Cache key construction ----------------------------------------------

function teamKey(canonicalCompany) {
  return `${canonicalCompany}:_team`;
}

function emptyKey(canonicalCompany) {
  return `${canonicalCompany}:_empty`;
}

// ---- TTL logic -----------------------------------------------------------

function isFresh(entry, ttlDaysOverride) {
  if (!entry || !entry.verifiedAt) return false;
  const ttlDays = ttlDaysOverride || entry.ttlDays || DEFAULT_TTL_DAYS;
  const verifiedMs = Date.parse(entry.verifiedAt);
  if (Number.isNaN(verifiedMs)) return false;
  const ageMs = Date.now() - verifiedMs;
  return ageMs < ttlDays * 24 * 60 * 60 * 1000;
}

function daysSince(isoString) {
  if (!isoString) return null;
  const ms = Date.now() - Date.parse(isoString);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

// ---- Blob read -----------------------------------------------------------

async function readCacheBlob() {
  const now = Date.now();
  if (_memo && (now - _memoFetchedAt) < MEMO_TTL_MS) {
    return _memo;
  }

  try {
    // List blobs to find the cache file URL (Vercel Blob requires URL not just key).
    const { blobs } = await list({ prefix: CACHE_FILENAME, limit: 1 });
    if (!blobs || blobs.length === 0) {
      // Cache doesn't exist yet — return empty shell.
      const empty = { schemaVersion: SCHEMA_VERSION, lastWriteAt: null, entries: {} };
      _memo = empty;
      _memoFetchedAt = now;
      return empty;
    }

    const url = blobs[0].url;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`blob fetch failed: ${res.status}`);
    }

    const data = await res.json();

    // Validate schema. If wrong version, treat as no cache (don't crash).
    if (!data || data.schemaVersion !== SCHEMA_VERSION || !data.entries) {
      console.warn('[hiring-team-cache] schema mismatch or missing entries, treating as empty');
      const empty = { schemaVersion: SCHEMA_VERSION, lastWriteAt: null, entries: {} };
      _memo = empty;
      _memoFetchedAt = now;
      return empty;
    }

    _memo = data;
    _memoFetchedAt = now;
    return data;
  } catch (err) {
    console.error('[hiring-team-cache] read error:', err.message);
    // On read failure, return empty shell — caller will treat as cache miss.
    return { schemaVersion: SCHEMA_VERSION, lastWriteAt: null, entries: {} };
  }
}

// ---- Cache lookup --------------------------------------------------------

async function getTeamEntry(canonicalCompany) {
  const cache = await readCacheBlob();
  const key = teamKey(canonicalCompany);
  const entry = cache.entries[key];
  if (!entry) return { hit: false, entry: null, fresh: false };
  return { hit: true, entry, fresh: isFresh(entry, DEFAULT_TTL_DAYS) };
}

async function getEmptyEntry(canonicalCompany) {
  const cache = await readCacheBlob();
  const key = emptyKey(canonicalCompany);
  const entry = cache.entries[key];
  if (!entry) return { hit: false, entry: null, fresh: false };
  return { hit: true, entry, fresh: isFresh(entry, EMPTY_TTL_DAYS) };
}

// ---- Cache write ---------------------------------------------------------
// Write semantics: read-modify-write the whole Blob.
// At 245 companies × 12KB = ~3MB max, full RMW is acceptable for Phase 0.
// Atomic enough for our concurrency profile (Phase 0 accepts last-write-wins).

async function writeTeamEntry(canonicalCompany, payload) {
  if (!canonicalCompany || typeof canonicalCompany !== 'string') {
    throw new Error('writeTeamEntry: canonicalCompany required');
  }
  if (!payload || !Array.isArray(payload.team)) {
    throw new Error('writeTeamEntry: payload.team must be array');
  }

  const cache = await readCacheBlob();
  const key = teamKey(canonicalCompany);

  cache.entries[key] = {
    team: payload.team,
    verifiedAt: new Date().toISOString(),
    ttlDays: DEFAULT_TTL_DAYS,
    queries: payload.queries || {},
    creditsUsed: payload.creditsUsed || 0,
    successfulQueries: payload.successfulQueries || 0
  };
  cache.lastWriteAt = new Date().toISOString();

  await put(CACHE_FILENAME, JSON.stringify(cache), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });

  // Invalidate memo so next read picks up the write.
  _memo = cache;
  _memoFetchedAt = Date.now();
}

async function writeEmptyEntry(canonicalCompany, reason) {
  if (!canonicalCompany || typeof canonicalCompany !== 'string') {
    throw new Error('writeEmptyEntry: canonicalCompany required');
  }

  const cache = await readCacheBlob();
  const key = emptyKey(canonicalCompany);

  cache.entries[key] = {
    verifiedAt: new Date().toISOString(),
    ttlDays: EMPTY_TTL_DAYS,
    reason: reason || 'no valid /in/ profiles returned'
  };
  cache.lastWriteAt = new Date().toISOString();

  await put(CACHE_FILENAME, JSON.stringify(cache), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });

  _memo = cache;
  _memoFetchedAt = Date.now();
}

// ---- Exports -------------------------------------------------------------

module.exports = {
  canonicalizeCompany,
  teamKey,
  emptyKey,
  isFresh,
  daysSince,
  readCacheBlob,
  getTeamEntry,
  getEmptyEntry,
  writeTeamEntry,
  writeEmptyEntry,
  CACHE_FILENAME,
  SCHEMA_VERSION,
  DEFAULT_TTL_DAYS,
  EMPTY_TTL_DAYS
};
