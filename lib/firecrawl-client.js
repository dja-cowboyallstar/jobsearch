// lib/firecrawl-client.js
//
// Phase 0 v2 — Find the Hiring Team
// Firecrawl /v2/search wrapper.
//
// Observed response shape (from 3 calls 2026-04-27):
//   {
//     success: true,
//     data: { web: [{ url, title, description, position }] },
//     creditsUsed: 2,        // measured: 2 credits per call regardless of limit
//     id: "..."
//   }
//
// Failures observed:
//   - Insufficient credits: { success: false, error: "..." }
//   - Unauthorized: { success: false, error: "Unauthorized: Token missing" }

const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/search';
const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 8000;

// Strict regex — only accept LinkedIn /in/ profile URLs.
// Rejects: company pages, posts, learning pages, jobs, anything else.
const LINKEDIN_IN_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\/[^\/\?#]+\/?$/;

// ---- Query construction ---------------------------------------------------

function buildTeamQueries(company, jobFunction) {
  if (!company || typeof company !== 'string') {
    throw new Error('buildTeamQueries: company required');
  }
  const co = `"${company}"`;
  const fn = (jobFunction && typeof jobFunction === 'string')
    ? jobFunction.toLowerCase().trim()
    : 'engineering';

  return {
    recruiter: `site:linkedin.com/in ${co} recruiter`,
    hm:        `site:linkedin.com/in ${co} "hiring manager" OR "head of"`,
    peer:      `site:linkedin.com/in ${co} ${fn}`,
    skip:      `site:linkedin.com/in ${co} "VP" OR "Director" ${fn}`
  };
}

// ---- Validation ----------------------------------------------------------

function isValidLinkedInResult(r) {
  return r
    && typeof r.url === 'string'
    && LINKEDIN_IN_RE.test(r.url)
    && typeof r.title === 'string'
    && r.title.length > 0;
}

// ---- Single search call --------------------------------------------------

async function searchOnce({ apiKey, query, limit, timeoutMs }) {
  if (!apiKey) {
    throw new Error('searchOnce: apiKey required (FIRECRAWL_API_KEY env var)');
  }
  if (!query || typeof query !== 'string') {
    throw new Error('searchOnce: query required');
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        limit: limit || DEFAULT_LIMIT
      }),
      signal: controller.signal
    });

    const status = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch (_e) {
      body = { success: false, error: 'response not JSON' };
    }

    if (status === 429) {
      return { ok: false, status, error: 'rate_limited', body };
    }
    if (status >= 500) {
      return { ok: false, status, error: 'upstream_5xx', body };
    }
    if (!body || body.success !== true) {
      return { ok: false, status, error: body?.error || 'unsuccessful_response', body };
    }
    if (!body.data || !Array.isArray(body.data.web)) {
      return { ok: false, status, error: 'malformed_data_shape', body };
    }

    // Filter to valid LinkedIn /in/ results only. Hard cap at 5.
    const allResults = body.data.web;
    const validResults = allResults.filter(isValidLinkedInResult).slice(0, 5);

    return {
      ok: true,
      status,
      results: validResults,
      rejectedCount: allResults.length - validResults.length,
      creditsUsed: body.creditsUsed || 0,
      requestId: body.id || null
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'timeout', body: null };
    }
    return { ok: false, status: 0, error: err.message || 'fetch_error', body: null };
  } finally {
    clearTimeout(t);
  }
}

// ---- Parallel fan-out ----------------------------------------------------
// Fires all 4 queries in parallel using Promise.allSettled — one slow/failing
// query does not block the others. Returns full result map; caller decides
// success threshold (Phase 0 v2 requires >=2 of 4 to render team UI).

async function searchTeamParallel({ apiKey, queries, limit, timeoutMs }) {
  if (!queries || typeof queries !== 'object') {
    throw new Error('searchTeamParallel: queries object required');
  }

  const queryEntries = Object.entries(queries);

  const settled = await Promise.allSettled(
    queryEntries.map(([key, q]) =>
      searchOnce({ apiKey, query: q, limit, timeoutMs })
        .then(r => ({ key, ...r }))
    )
  );

  const byQuery = {};
  let totalCreditsUsed = 0;
  let successCount = 0;

  for (let i = 0; i < settled.length; i++) {
    const [key] = queryEntries[i];
    const s = settled[i];

    if (s.status === 'fulfilled' && s.value.ok) {
      byQuery[key] = {
        ok: true,
        results: s.value.results,
        rejectedCount: s.value.rejectedCount,
        creditsUsed: s.value.creditsUsed,
        requestId: s.value.requestId
      };
      totalCreditsUsed += s.value.creditsUsed || 0;
      successCount += 1;
    } else {
      const errInfo = s.status === 'fulfilled'
        ? { status: s.value.status, error: s.value.error }
        : { status: 0, error: s.reason?.message || 'rejected' };
      byQuery[key] = { ok: false, ...errInfo, results: [] };
    }
  }

  return {
    byQuery,
    successCount,
    totalQueries: queryEntries.length,
    totalCreditsUsed
  };
}

// ---- Exports -------------------------------------------------------------

module.exports = {
  buildTeamQueries,
  isValidLinkedInResult,
  searchOnce,
  searchTeamParallel,
  LINKEDIN_IN_RE,
  FIRECRAWL_ENDPOINT,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS
};
