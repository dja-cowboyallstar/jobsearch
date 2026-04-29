#!/usr/bin/env node
/**
 * scripts/extract-must-corpus.js
 *
 * One-shot tool to seed the v2 skill taxonomy.
 *
 * Fetches live Ascent job data from the production Blob, extracts every parsed
 * _must qualification across all jobs, tokenizes them into skill candidates,
 * and outputs a frequency-sorted report.
 *
 * The output is INPUT to human curation — it is not the taxonomy itself.
 * Dom reads the report, deduplicates variants, decides canonical names,
 * authors aliases, and commits the curated result to skills/taxonomy.json.
 *
 * Why this script exists:
 * - V2_PLAN D4 says the taxonomy size must be derived from the actual _must
 *   corpus, not picked in advance. This script produces that corpus.
 * - V2_PLAN §10 / V2_SPECS S5 explicitly rejected guessing skill counts.
 *
 * Why this script is NOT the taxonomy:
 * - Tokenizers don't know that "py torch" and "pytorch" are the same skill.
 * - Tokenizers don't know that "transformer architecture" is one skill, not two.
 * - Aliases (torch -> pytorch, ml -> machine-learning) require human judgment.
 *
 * Usage:
 *   node scripts/extract-must-corpus.js > /tmp/corpus-report.txt
 *
 * Output (stdout) is a frequency-sorted list of candidate skill phrases, plus
 * per-job _must text dumps for spot-checking.
 *
 * Failure cases this script defends against:
 *  - Stale Blob: prints lastModified header so Dom sees data freshness
 *  - Empty _must coverage: counts and reports the parsed-vs-unparsed ratio
 *  - Tokenizer false-positives: outputs frequencies so Dom can prune
 *  - Network failure: explicit error with retry guidance
 */

'use strict';

const https = require('https');

// Production Blob endpoint. The site reads from /api/jobs-data which proxies
// the Blob; this script hits the API for parity with what the frontend sees.
const JOBS_ENDPOINT = 'https://career-ascent.io/api/jobs-data';

// Tokens that appear in qualification phrases but are NOT skills. These get
// stripped during tokenization. The list is intentionally conservative —
// over-pruning hides real signal.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'with', 'to', 'for',
  'at', 'by', 'as', 'is', 'are', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
  'must', 'can', 'experience', 'years', 'year', 'strong', 'solid', 'proven',
  'demonstrated', 'working', 'knowledge', 'understanding', 'expertise',
  'familiarity', 'proficiency', 'proficient', 'skilled', 'ability', 'able',
  'plus', 'preferred', 'required', 'minimum', 'least', 'including', 'such',
  'etc', 'similar', 'related', 'equivalent', 'background', 'degree',
]);

// Phrase patterns that indicate a skill mention. We extract noun phrases of
// 1-4 tokens. Multi-token skills (e.g., "vector database") matter — splitting
// them would lose meaning.
const PHRASE_MIN_LEN = 1;
const PHRASE_MAX_LEN = 4;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const lastModified = res.headers['last-modified'] || 'unknown';
      const status = res.statusCode;
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (status !== 200) {
          reject(new Error(`HTTP ${status} from ${url}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ data: parsed, lastModified, bytes: data.length });
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function normalizeToken(tok) {
  return tok
    .toLowerCase()
    .replace(/[^a-z0-9+\-#./]/g, '') // keep tech-relevant punctuation: + - # . /
    .trim();
}

function extractPhrases(text) {
  // Split on sentence-ish boundaries first.
  const sentences = text.split(/[.;,()/\[\]\n]+/);
  const phrases = [];
  for (const s of sentences) {
    const tokens = s
      .split(/\s+/)
      .map(normalizeToken)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t));
    // Generate sliding-window phrases.
    for (let len = PHRASE_MIN_LEN; len <= PHRASE_MAX_LEN; len++) {
      for (let i = 0; i + len <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + len).join(' ');
        if (phrase.length >= 2) phrases.push(phrase);
      }
    }
  }
  return phrases;
}

function summarize(jobs) {
  const total = jobs.length;
  const withMust = jobs.filter((j) => Array.isArray(j._must) && j._must.length > 0);
  const mustCount = withMust.length;
  const allMustText = [];
  const phraseFreq = new Map();

  for (const j of withMust) {
    for (const m of j._must) {
      if (typeof m !== 'string') continue;
      allMustText.push(m);
      const phrases = extractPhrases(m);
      for (const p of phrases) {
        phraseFreq.set(p, (phraseFreq.get(p) || 0) + 1);
      }
    }
  }

  return { total, mustCount, mustCoverage: mustCount / total, allMustText, phraseFreq };
}

function printReport(summary, lastModified, bytes) {
  const { total, mustCount, mustCoverage, allMustText, phraseFreq } = summary;

  console.log('=== ASCENT _must CORPUS REPORT ===');
  console.log(`Source: ${JOBS_ENDPOINT}`);
  console.log(`Blob last-modified: ${lastModified}`);
  console.log(`Payload size: ${bytes.toLocaleString()} bytes`);
  console.log('');
  console.log('=== COVERAGE ===');
  console.log(`Total jobs: ${total}`);
  console.log(`Jobs with parsed _must: ${mustCount} (${(mustCoverage * 100).toFixed(1)}%)`);
  console.log(`Total _must lines extracted: ${allMustText.length}`);
  console.log('');

  if (mustCoverage < 0.30) {
    console.log('!! WARNING: _must coverage is below 30%.');
    console.log('!! Taxonomy seeded from this corpus will be biased toward the parser\'s current blind spots.');
    console.log('!! Recommend hitting D2 (>=60% coverage) before final taxonomy curation.');
    console.log('');
  }

  console.log('=== TOP CANDIDATE SKILLS (frequency-sorted) ===');
  console.log('# Format: <count> <phrase>');
  console.log('# These are RAW phrases. Curate before committing to taxonomy.json:');
  console.log('#  - Merge variants (pytorch/PyTorch/torch -> pytorch + aliases)');
  console.log('#  - Drop non-skills (years, degree, team)');
  console.log('#  - Decide canonical multi-word phrases (vector database vs vector-db)');
  console.log('');

  const sorted = [...phraseFreq.entries()]
    .filter(([, count]) => count >= 3) // floor: appearing 3+ times across the corpus
    .sort((a, b) => b[1] - a[1]);

  for (const [phrase, count] of sorted) {
    console.log(`${String(count).padStart(5)} ${phrase}`);
  }

  console.log('');
  console.log(`=== SUMMARY ===`);
  console.log(`Unique candidate phrases (count >= 3): ${sorted.length}`);
  console.log(`Unique candidate phrases (all): ${phraseFreq.size}`);
  console.log('');
  console.log('Next step: curate the count-sorted list above into skills/taxonomy.json.');
  console.log('See V2_SPECS.md (skill taxonomy section) for the schema.');
}

async function main() {
  console.error(`Fetching ${JOBS_ENDPOINT} ...`);
  let result;
  try {
    result = await fetchJson(JOBS_ENDPOINT);
  } catch (e) {
    console.error(`!! Fetch failed: ${e.message}`);
    console.error('!! Check network, then retry. If the Blob endpoint moved, update JOBS_ENDPOINT in this script.');
    process.exit(1);
  }

  // The /api/jobs-data response shape: array of jobs OR { jobs: [...] }.
  // Be defensive — both shapes have appeared historically.
  const jobs = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data.jobs)
      ? result.data.jobs
      : null;

  if (!jobs) {
    console.error('!! Unexpected response shape. Top-level keys:', Object.keys(result.data || {}));
    process.exit(1);
  }

  const summary = summarize(jobs);
  printReport(summary, result.lastModified, result.bytes);
}

main().catch((e) => {
  console.error('!! Unhandled error:', e);
  process.exit(1);
});
