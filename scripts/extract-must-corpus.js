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
 * The output is INPUT to human curation -- it is not the taxonomy itself.
 * Dom reads the report, deduplicates variants, decides canonical names,
 * authors aliases, and commits the curated result to skills/taxonomy.json.
 *
 * Why this script exists:
 * - V2_PLAN D4 says the taxonomy size must be derived from the actual _must
 *   corpus, not picked in advance. This script produces that corpus.
 * - V2_PLAN section 10 / V2_SPECS S5 explicitly rejected guessing skill counts.
 *
 * Why this script is NOT the taxonomy:
 * - Tokenizers don't know that "py torch" and "pytorch" are the same skill.
 * - Tokenizers don't know that "transformer architecture" is one skill, not two.
 * - Aliases (torch -> pytorch, ml -> machine-learning) require human judgment.
 *
 * Usage:
 *   node scripts/extract-must-corpus.js > corpus-report.txt
 *
 * Output (stdout) is a frequency-sorted list of candidate skill phrases, plus
 * per-job _must text dumps for spot-checking. Progress is logged to stderr.
 *
 * Failure cases this script defends against:
 *  - Stale Blob: prints lastModified header so Dom sees data freshness
 *  - Empty _must coverage: counts and reports the parsed-vs-unparsed ratio
 *  - Tokenizer false-positives: outputs frequencies so Dom can prune
 *  - Network failure: explicit error with retry guidance
 *  - HTTP redirects: follows up to 5 hops, refuses non-HTTPS, prints final URL
 *  - Large payloads: progress reported every 5MB to stderr
 *  - Non-JSON response: preview first 200 chars on parse failure
 */

'use strict';

const https = require('https');
const { URL } = require('url');

// Production endpoint. The site reads from /api/jobs-data which proxies the
// Blob. Vercel commonly redirects (HTTPS upgrade, region routing); the fetcher
// below follows redirects.
const JOBS_ENDPOINT = 'https://career-ascent.io/api/jobs-data';

// Maximum redirect hops to follow before giving up.
const MAX_REDIRECTS = 5;

// Progress reporting threshold (bytes) -- log a dot to stderr every Nth byte.
const PROGRESS_BYTES = 5 * 1024 * 1024; // 5 MB

// Tokens that appear in qualification phrases but are NOT skills. These get
// stripped during tokenization. The list is intentionally conservative --
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

const PHRASE_MIN_LEN = 1;
const PHRASE_MAX_LEN = 4;

/**
 * Fetch a URL, following redirects up to MAX_REDIRECTS hops. Refuses any
 * non-HTTPS redirect target. Reports progress to stderr.
 */
function fetchJson(urlStr, hopsRemaining = MAX_REDIRECTS, history = []) {
  return new Promise((resolve, reject) => {
    if (hopsRemaining <= 0) {
      reject(new Error(`Redirect limit exceeded after ${MAX_REDIRECTS} hops. Trail: ${history.join(' -> ')}`));
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error(`Refusing non-HTTPS URL: ${urlStr}`));
      return;
    }

    history.push(urlStr);

    const req = https.get(urlStr, (res) => {
      const status = res.statusCode;

      // Redirect handling.
      if (status >= 300 && status < 400 && res.headers.location) {
        // Resolve relative redirects against the current URL.
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        process.stderr.write(`  redirect ${status} -> ${nextUrl}\n`);
        // Drain the redirect response body so the socket can be reused.
        res.resume();
        fetchJson(nextUrl, hopsRemaining - 1, history).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        reject(new Error(`HTTP ${status} from ${urlStr}`));
        return;
      }

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
          resolve({
            data: parsed,
            lastModified,
            bytes: received,
            finalUrl: urlStr,
            hops: history.length,
          });
        } catch (e) {
          const preview = data.slice(0, 200).replace(/\s+/g, ' ');
          reject(new Error(`JSON parse failed: ${e.message}\nFirst 200 chars: ${preview}`));
        }
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error(`Request timeout after 60s: ${urlStr}`));
    });
  });
}

function normalizeToken(tok) {
  return tok
    .toLowerCase()
    .replace(/[^a-z0-9+\-#./]/g, '')
    .trim();
}

function extractPhrases(text) {
  const sentences = text.split(/[.;,()/\[\]\n]+/);
  const phrases = [];
  for (const s of sentences) {
    const tokens = s
      .split(/\s+/)
      .map(normalizeToken)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t));
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

  return { total, mustCount, mustCoverage: total ? mustCount / total : 0, allMustText, phraseFreq };
}

function printReport(summary, fetchInfo) {
  const { total, mustCount, mustCoverage, allMustText, phraseFreq } = summary;
  const { lastModified, bytes, finalUrl, hops } = fetchInfo;

  console.log('=== ASCENT _must CORPUS REPORT ===');
  console.log(`Source: ${JOBS_ENDPOINT}`);
  console.log(`Final URL after redirects: ${finalUrl} (${hops} hop(s))`);
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
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  for (const [phrase, count] of sorted) {
    console.log(`${String(count).padStart(5)} ${phrase}`);
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Unique candidate phrases (count >= 3): ${sorted.length}`);
  console.log(`Unique candidate phrases (all): ${phraseFreq.size}`);
  console.log('');
  console.log('Next step: curate the count-sorted list above into skills/taxonomy.json.');
  console.log('See V2_SPECS.md (Spec for skill taxonomy) for the schema.');
}

async function main() {
  process.stderr.write(`Fetching ${JOBS_ENDPOINT} ...\n`);
  let result;
  try {
    result = await fetchJson(JOBS_ENDPOINT);
  } catch (e) {
    process.stderr.write(`!! Fetch failed: ${e.message}\n`);
    process.stderr.write('!! Check network, then retry. If the Blob endpoint moved, update JOBS_ENDPOINT in this script.\n');
    process.exit(1);
  }

  // Defensive: response may be array or {jobs: [...]}
  const jobs = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data.jobs)
      ? result.data.jobs
      : null;

  if (!jobs) {
    process.stderr.write(`!! Unexpected response shape. Top-level keys: ${Object.keys(result.data || {}).join(', ')}\n`);
    process.exit(1);
  }

  const summary = summarize(jobs);
  printReport(summary, result);
}

main().catch((e) => {
  process.stderr.write(`!! Unhandled error: ${e.stack || e.message}\n`);
  process.exit(1);
});
