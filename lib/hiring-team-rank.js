// lib/hiring-team-rank.js
//
// Phase 0 v2 — Find the Hiring Team
// Intelligence layer: dedupe across query results, score by signals,
// infer role per person, generate "why this person" line.
//
// All exports are pure functions — no I/O, no module state.
// Designed to be testable in isolation.

// ---- Role tier (highest tier wins when a person appears in multiple) ----

const ROLE_TIER = {
  skip: 4,        // Director+ / VP
  hm: 3,          // Hiring manager
  recruiter: 2,   // Recruiter
  peer: 1         // Team member / IC
};

const ROLE_LABEL = {
  skip: 'Director+',
  hm: 'Hiring manager',
  recruiter: 'Recruiter',
  peer: 'Team member'
};

// ---- Dedupe across queries -----------------------------------------------
// Input: { recruiter: [results], hm: [results], peer: [results], skip: [results] }
//        (failed queries omitted entirely from input map)
// Output: array of unique people, each with sourceQueries[] and bestPosition.

function dedupeAcrossQueries(byQuery) {
  if (!byQuery || typeof byQuery !== 'object') return [];

  const byUrl = new Map();

  for (const [queryKey, results] of Object.entries(byQuery)) {
    if (!Array.isArray(results)) continue;

    for (const r of results) {
      if (!r || typeof r.url !== 'string') continue;

      // Normalize URL: lowercase host, strip trailing slash, strip query/fragment
      const normalizedUrl = normalizeLinkedInUrl(r.url);
      const existing = byUrl.get(normalizedUrl);

      if (existing) {
        // Already seen this person via another query — record this query too
        if (!existing.sourceQueries.includes(queryKey)) {
          existing.sourceQueries.push(queryKey);
        }
        if (typeof r.position === 'number' && r.position < existing.bestPosition) {
          existing.bestPosition = r.position;
        }
      } else {
        byUrl.set(normalizedUrl, {
          url: r.url,
          title: r.title || '',
          description: r.description || '',
          position: r.position || 99,
          bestPosition: r.position || 99,
          sourceQueries: [queryKey]
        });
      }
    }
  }

  return Array.from(byUrl.values());
}

function normalizeLinkedInUrl(url) {
  if (typeof url !== 'string') return '';
  // Strip query/fragment, normalize to lowercase host, drop trailing slash.
  // Keep the /in/<slug> path verbatim (case-sensitive in some LinkedIn URLs).
  return url
    .replace(/[\?#].*$/, '')           // strip query/fragment
    .replace(/^https?:\/\/www\./, 'https://')
    .replace(/^http:\/\//, 'https://')
    .replace(/\/$/, '')                // strip trailing slash
    .toLowerCase()                     // lowercase whole URL — LinkedIn slugs are case-insensitive in practice
    ;
}

// ---- Scoring -------------------------------------------------------------
// Score is derived from already-fetched fields. No new I/O.
// Components:
//   1. Cross-query appearance:    sourceQueries.length * 30   (max ~120)
//   2. Position (best across):    max(0, 6 - bestPosition)    (max 5)
//   3. Currency markers in desc:  +10 if any
//   4. Company in title:          +5 if explicit
//   5. Description length:        floor(len/50), capped at 5

const CURRENCY_RE = /\b(currently|leading|head of|director|vp|vice president|chief|founder|co-?founder)\b/i;

function scorePerson(person, companyName) {
  if (!person) return 0;
  let score = 0;

  // 1. Cross-query signal (primary)
  const nQueries = (person.sourceQueries || []).length;
  score += nQueries * 30;

  // 2. Position signal (best across queries; lower = better)
  const pos = typeof person.bestPosition === 'number' ? person.bestPosition : 99;
  score += Math.max(0, 6 - pos);

  // 3. Currency markers in description
  const desc = (person.description || '').toLowerCase();
  if (CURRENCY_RE.test(desc)) {
    score += 10;
  }

  // 4. Explicit company name in title (stronger company-match signal)
  if (companyName && typeof companyName === 'string') {
    const companyLower = companyName.toLowerCase();
    const titleLower = (person.title || '').toLowerCase();
    if (titleLower.indexOf(companyLower) !== -1) {
      score += 5;
    }
  }

  // 5. Description length (capped)
  const descLen = (person.description || '').length;
  score += Math.min(5, Math.floor(descLen / 50));

  return score;
}

// ---- Role inference ------------------------------------------------------
// Highest-tier source query determines the role label.
// Ties broken by ROLE_TIER ordering (skip > hm > recruiter > peer).

function inferRole(person) {
  const queries = (person && person.sourceQueries) || [];
  if (queries.length === 0) return ROLE_LABEL.peer; // fallback

  let bestKey = queries[0];
  let bestTier = ROLE_TIER[bestKey] || 0;

  for (const q of queries) {
    const tier = ROLE_TIER[q] || 0;
    if (tier > bestTier) {
      bestTier = tier;
      bestKey = q;
    }
  }

  return ROLE_LABEL[bestKey] || ROLE_LABEL.peer;
}

// ---- Why-line generation -------------------------------------------------
// One line per top-3 card. Picks the strongest signal available.
// Priority order: cross-query count → senior pattern → top position → currency → fallback.

function generateWhyLine(person, totalQueries) {
  const n = (person.sourceQueries || []).length;
  const desc = (person.description || '').toLowerCase();
  const role = inferRole(person).toLowerCase();
  const totalQ = totalQueries || 4;

  // 1. Cross-query signal — strongest
  if (n >= 3) {
    return `Surfaced in ${n} of ${totalQ} searches`;
  }

  // 2. Two queries + senior signal
  if (n === 2 && /\b(head|director|vp|vice president|chief)\b/i.test(desc)) {
    return `Surfaced in 2 searches · Senior title pattern`;
  }

  // 3. Two queries, no senior signal but weak descriptions = honest hedge
  if (n >= 2 && desc.length < 50) {
    return `Cross-query match — verify role manually`;
  }

  // 4. Two queries, normal description
  if (n === 2) {
    return `Surfaced in 2 of ${totalQ} searches`;
  }

  // 5. Single query, top position
  if (n === 1 && person.bestPosition === 1) {
    return `Top result for ${role} search`;
  }

  // 6. Single query, currency in description
  if (n === 1 && /currently|leading/.test(desc)) {
    return `Active ${role} signal in profile`;
  }

  // 7. Single query, senior pattern
  if (n === 1 && /\b(head|director|vp|vice president|chief)\b/i.test(desc)) {
    return `${role} · Senior title pattern`;
  }

  // 8. Fallback
  return `Match for ${role} search`;
}

// ---- Top-level pipeline --------------------------------------------------
// Combines dedupe → score → rank → role/whyLine annotation → top-3 marker.
// This is the single function callers should use.

function rankTeam(byQuery, opts) {
  const companyName = opts && opts.companyName;
  const totalQueries = (opts && opts.totalQueries) || 4;

  const dedupedPeople = dedupeAcrossQueries(byQuery);

  const scored = dedupedPeople.map(p => ({
    ...p,
    score: scorePerson(p, companyName),
    role: inferRole(p),
    whyLine: generateWhyLine(p, totalQueries)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.map((p, i) => ({
    ...p,
    isTopThree: i < 3
  }));
}

// ---- Exports -------------------------------------------------------------

module.exports = {
  dedupeAcrossQueries,
  normalizeLinkedInUrl,
  scorePerson,
  inferRole,
  generateWhyLine,
  rankTeam,
  ROLE_TIER,
  ROLE_LABEL
};
