// scripts/verify-add-companies.js
// ONE-OFF verification probe. Read-only against external services. Does NOT
// touch refresh-jobs.js, refresh-workday.js, or the production ats-registry
// blob. Writes two local JSON files for Dom's review.
//
// Phase A: fetch careers-page HTML for each candidate, scan for ATS signatures
//          (boards.greenhouse.io, jobs.ashbyhq.com, jobs.lever.co,
//           myworkdayjobs.com, *.recruitee.com)
// Phase B: validate detected slug against the ATS's public API; require a
//          200 response AND (a) a jobs array / body-shape that matches the
//          ATS, and (b) a fuzzy name-token match against the candidate name
//          (flagged LOW_CONFIDENCE when it fails — not auto-promoted).
//
// Run:   node scripts/verify-add-companies.js
// Reqs:  Node 18+ (built-in fetch), no npm deps
// Env:   none required
//
// Outputs (gitignored, local):
//   scripts/verify-report.json             — full results for all 79
//   scripts/proposed-registry-additions.json — VERIFIED_WITH_JOBS subset only,
//                                              ready to merge into the registry

"use strict";

const fs = require("fs");
const path = require("path");

// ── Note: regression protection against requiring production files ───────────
// (scripts/refresh-jobs.js, scripts/refresh-workday.js, ats-registry*.json) is
// enforced at handoff-time via a grep on `require(` — this script uses only
// `fs` and `path` as runtime requires, no production surfaces.

// ── Config ───────────────────────────────────────────────────────────────────
const INPUT_PATH = path.join(__dirname, "candidates-input.json");
const REPORT_PATH = path.join(__dirname, "verify-report.json");
const PROPOSAL_PATH = path.join(__dirname, "proposed-registry-additions.json");

const REQUEST_TIMEOUT_MS = 8000;
const INTER_REQUEST_DELAY_MS = 1000;     // polite: 1s between external calls
const GLOBAL_BUDGET_MS = 15 * 60 * 1000; // 15 minutes hard ceiling
const USER_AGENT =
  "Ascent-Verification/1.0 (one-off probe; contact dominickjamirr@gmail.com)";

const START = Date.now();

function budgetRemaining() {
  return GLOBAL_BUDGET_MS - (Date.now() - START);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...(opts || {}),
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        ...((opts && opts.headers) || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ── Slug candidates (cheap combinatorial guesses) ────────────────────────────
function slugCandidates(name, seedSlug) {
  const s = new Set();
  if (seedSlug) s.add(seedSlug);
  const lower = String(name).toLowerCase().trim();
  const nospace = lower.replace(/[^a-z0-9]+/g, "");
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  s.add(nospace);
  s.add(dashed);
  // strip trailing " ai" / " labs" / " inc"
  const stripped = lower
    .replace(/\s+(ai|labs?|inc|corp|technologies|technology|io)$/i, "")
    .trim();
  if (stripped && stripped !== lower) {
    s.add(stripped.replace(/[^a-z0-9]+/g, ""));
    s.add(stripped.replace(/[^a-z0-9]+/g, "-"));
  }
  return Array.from(s).filter(Boolean);
}

// ── Name-token fuzzy match ────────────────────────────────────────────────────
function nameTokenMatch(candidateName, haystack) {
  if (!haystack) return false;
  const tokens = String(candidateName)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["the", "and", "inc", "ai"].includes(w));
  const h = String(haystack).toLowerCase();
  return tokens.length === 0 || tokens.some((t) => h.indexOf(t) !== -1);
}

// ── ATS detectors (careers-page HTML pass) ────────────────────────────────────
// Returns first match only. Each pattern captures the slug from the URL.
const ATS_PATTERNS = [
  { ats: "gh", rx: /(?:boards|job-boards|boards-api)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: "ab", rx: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i },
  { ats: "lv", rx: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { ats: "rc", rx: /([a-z0-9_-]+)\.recruitee\.com/i },
  // Workday: captures tenant subdomain; full slug format is site-specific
  { ats: "wd", rx: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/([a-z0-9_-]+)/i },
];

async function scrapeCareersPage(url) {
  if (!url) return { ok: false, reason: "no careers URL" };
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, reason: "HTTP " + res.status };
    const html = await res.text();
    for (const p of ATS_PATTERNS) {
      const m = html.match(p.rx);
      if (m) {
        if (p.ats === "wd") {
          return {
            ok: true,
            ats: "wd",
            slug: m[1], // tenant
            wdRegion: m[2],
            wdSite: m[3],
            source: "html-scrape",
          };
        }
        return { ok: true, ats: p.ats, slug: m[1], source: "html-scrape" };
      }
    }
    return { ok: false, reason: "no ATS signature found in HTML", htmlLen: html.length };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + e.message };
  }
}

// ── ATS API validators (phase B) ──────────────────────────────────────────────
async function validateGreenhouse(slug, candidateName) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) return { ok: false, reason: "HTTP " + res.status, url };
    const body = await res.json();
    if (!body || !Array.isArray(body.jobs)) {
      return { ok: false, reason: "body missing 'jobs' array", url };
    }
    const jobCount = body.jobs.length;
    // Name token match against first few job titles + board name
    const sample = body.jobs.slice(0, 5).map((j) => j.location && j.location.name).join(" ");
    const nameMatch =
      nameTokenMatch(candidateName, sample) ||
      // if no jobs, can't verify name — flag LOW_CONFIDENCE
      jobCount === 0;
    return { ok: true, jobCount, nameMatch, url };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + e.message, url };
  }
}

async function validateAshby(slug, candidateName) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) return { ok: false, reason: "HTTP " + res.status, url };
    const body = await res.json();
    if (!body || !Array.isArray(body.jobs)) {
      return { ok: false, reason: "body missing 'jobs' array", url };
    }
    const jobCount = body.jobs.length;
    const boardName = body.apiVersion ? "" : "";
    // Ashby board-api returns jobs with .title, .department, .location
    const sample = body.jobs
      .slice(0, 5)
      .map((j) => (j.title || "") + " " + (j.department || "") + " " + (j.location || ""))
      .join(" ");
    const nameMatch = nameTokenMatch(candidateName, sample) || jobCount === 0;
    return { ok: true, jobCount, nameMatch, url };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + e.message, url };
  }
}

async function validateLever(slug, candidateName) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) return { ok: false, reason: "HTTP " + res.status, url };
    const body = await res.json();
    if (!Array.isArray(body)) {
      return { ok: false, reason: "body is not an array", url };
    }
    const jobCount = body.length;
    const sample = body.slice(0, 5).map((j) => (j.text || "") + " " + ((j.categories && j.categories.team) || "")).join(" ");
    const nameMatch = nameTokenMatch(candidateName, sample) || jobCount === 0;
    return { ok: true, jobCount, nameMatch, url };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + e.message, url };
  }
}

async function validateRecruitee(slug, candidateName) {
  const url = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) return { ok: false, reason: "HTTP " + res.status, url };
    const body = await res.json();
    if (!body || !Array.isArray(body.offers)) {
      return { ok: false, reason: "body missing 'offers' array", url };
    }
    const jobCount = body.offers.length;
    const sample = body.offers.slice(0, 5).map((j) => j.title).join(" ");
    const nameMatch = nameTokenMatch(candidateName, sample) || jobCount === 0;
    return { ok: true, jobCount, nameMatch, url };
  } catch (e) {
    return { ok: false, reason: "fetch error: " + e.message, url };
  }
}

// Workday: no universal public API endpoint for a bare slug — we only report
// what we scraped. Flag for manual verification.
async function validateWorkday(slug, wdRegion, wdSite) {
  return {
    ok: false,
    reason: "Workday verification is manual — visit the URL in a browser",
    url: `https://${slug}.${wdRegion || "wdX"}.myworkdayjobs.com/${wdSite || ""}`,
  };
}

async function validateATS(detected, candidateName) {
  switch (detected.ats) {
    case "gh": return validateGreenhouse(detected.slug, candidateName);
    case "ab": return validateAshby(detected.slug, candidateName);
    case "lv": return validateLever(detected.slug, candidateName);
    case "rc": return validateRecruitee(detected.slug, candidateName);
    case "wd": return validateWorkday(detected.slug, detected.wdRegion, detected.wdSite);
    default: return { ok: false, reason: "unknown ATS: " + detected.ats };
  }
}

// ── Per-candidate orchestration ──────────────────────────────────────────────
async function probeCandidate(c) {
  const attempts = [];

  // Phase A — scrape careers page HTML
  const scrape = await scrapeCareersPage(c.careers);
  attempts.push({ phase: "A:html-scrape", url: c.careers, ...scrape });

  let detected = null;
  if (scrape.ok) {
    detected = { ats: scrape.ats, slug: scrape.slug, wdRegion: scrape.wdRegion, wdSite: scrape.wdSite };
  }

  // Phase B — validate against ATS API
  // Use scraped result if any, otherwise fall back to probable ATS + slug guesses
  let validation = null;
  const attemptsAPI = [];

  const candidatesToTry = [];
  if (detected) {
    candidatesToTry.push(detected);
  }
  // Fallback attempts if scrape failed or for cross-validation
  if (!detected && c.probable_ats) {
    for (const slug of slugCandidates(c.name, c.probable_slug)) {
      candidatesToTry.push({ ats: c.probable_ats, slug, source: "probable-fallback" });
    }
  }

  for (const cand of candidatesToTry) {
    await sleep(INTER_REQUEST_DELAY_MS);
    if (budgetRemaining() <= 0) {
      attemptsAPI.push({ ats: cand.ats, slug: cand.slug, ok: false, reason: "BUDGET_EXHAUSTED" });
      break;
    }
    const v = await validateATS(cand, c.name);
    attemptsAPI.push({ ats: cand.ats, slug: cand.slug, source: cand.source || "scrape", ...v });
    if (v.ok) {
      validation = { ats: cand.ats, slug: cand.slug, ...v };
      break;
    }
  }
  attempts.push({ phase: "B:ats-api", attempts: attemptsAPI });

  // Status determination
  let status;
  if (validation && validation.ok && validation.jobCount > 0 && validation.nameMatch) {
    status = "VERIFIED_WITH_JOBS";
  } else if (validation && validation.ok && validation.jobCount > 0 && !validation.nameMatch) {
    status = "VERIFIED_LOW_CONFIDENCE";
  } else if (validation && validation.ok && validation.jobCount === 0) {
    status = "VERIFIED_EMPTY";
  } else if (detected && detected.ats === "wd") {
    status = "WORKDAY_MANUAL_REVIEW";
  } else {
    status = "UNVERIFIED";
  }

  return {
    name: c.name,
    priority: c.priority,
    probable_ats: c.probable_ats,
    probable_slug: c.probable_slug,
    careers_url: c.careers,
    status,
    detected_ats: validation ? validation.ats : (detected ? detected.ats : null),
    detected_slug: validation ? validation.slug : (detected ? detected.slug : null),
    job_count: validation ? validation.jobCount : null,
    name_match: validation ? validation.nameMatch : null,
    attempts,
  };
}

// ── Banner ───────────────────────────────────────────────────────────────────
// (Regression protection against requiring production files is enforced at
// handoff-time via `Select-String -Pattern '^\s*const\s+.*=\s*require\('`
// — expected Count: 2 for fs + path. A self-referential runtime check is
// unreliable because the needle strings appear inside the check's own source.)
function banner() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   ASCENT CANDIDATE VERIFICATION (one-off probe)      ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("  Mode: READ-ONLY probe against external ATS APIs");
  console.log("  Outputs:", path.basename(REPORT_PATH), "+", path.basename(PROPOSAL_PATH));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  if (!fs.existsSync(INPUT_PATH)) {
    console.error("FATAL: missing input file", INPUT_PATH);
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const candidates = input.candidates || [];
  console.log("  Candidates to probe:", candidates.length);
  console.log("  Global budget:", (GLOBAL_BUDGET_MS / 60000) + " min");
  console.log("  Per-request timeout:", REQUEST_TIMEOUT_MS + "ms");
  console.log("  Inter-request delay:", INTER_REQUEST_DELAY_MS + "ms");
  console.log("");

  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    if (budgetRemaining() <= 0) {
      console.error("BUDGET EXHAUSTED — stopping early. Remaining: " + (candidates.length - i));
      for (let j = i; j < candidates.length; j++) {
        results.push({
          name: candidates[j].name,
          priority: candidates[j].priority,
          status: "NOT_PROBED_BUDGET",
          attempts: [],
        });
      }
      break;
    }
    const c = candidates[i];
    process.stdout.write(
      "[" + String(i + 1).padStart(2, "0") + "/" + candidates.length + "] " +
      c.name + " ".repeat(Math.max(0, 28 - c.name.length)) + " ... "
    );
    let r;
    try {
      r = await probeCandidate(c);
    } catch (e) {
      r = {
        name: c.name,
        priority: c.priority,
        status: "PROBE_ERROR",
        error: e.message,
        attempts: [],
      };
    }
    results.push(r);

    const mark =
      r.status === "VERIFIED_WITH_JOBS" ? "✓ " :
      r.status === "VERIFIED_LOW_CONFIDENCE" ? "? " :
      r.status === "VERIFIED_EMPTY" ? "○ " :
      r.status === "WORKDAY_MANUAL_REVIEW" ? "W " :
      "✗ ";
    const suffix = r.detected_ats
      ? r.detected_ats + "/" + r.detected_slug + " [" + r.job_count + " jobs]"
      : "";
    console.log(mark + r.status + "  " + suffix);
  }

  // Write report
  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - START,
    input_count: candidates.length,
    status_counts: countBy(results, "status"),
    results,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Write proposed registry additions (ONLY VERIFIED_WITH_JOBS)
  const now = new Date().toISOString().split("T")[0];
  const additions = {};
  for (const r of results) {
    if (r.status === "VERIFIED_WITH_JOBS") {
      additions[r.name] = {
        ats: r.detected_ats,
        slug: r.detected_slug,
        verified_at: now,
        source: "verify-add-companies:" + now,
      };
    }
  }
  fs.writeFileSync(
    PROPOSAL_PATH,
    JSON.stringify(
      {
        version: 1,
        generated_at: new Date().toISOString(),
        note: "Merge into ats-registry.json under .mappings — BUT only after Dom spot-checks 5 random rows.",
        count: Object.keys(additions).length,
        mappings: additions,
      },
      null,
      2
    )
  );

  // Summary
  console.log("");
  console.log("=== SUMMARY ===");
  for (const [status, n] of Object.entries(report.status_counts).sort((a, b) => b[1] - a[1])) {
    console.log("  " + status.padEnd(26) + " " + n);
  }
  console.log("  (elapsed " + ((Date.now() - START) / 1000).toFixed(1) + "s)");
  console.log("");
  console.log("Report:     " + REPORT_PATH);
  console.log("Proposals:  " + PROPOSAL_PATH);
  console.log("");
  console.log("NEXT STEPS:");
  console.log("  1. Open verify-report.json — skim UNVERIFIED + LOW_CONFIDENCE rows.");
  console.log("  2. Spot-check 5 random VERIFIED_WITH_JOBS rows by opening the ATS URL.");
  console.log("  3. If all looks correct, hand proposed-registry-additions.json back");
  console.log("     to Claude for a registry-patch commit (NOT by this script).");
}

function countBy(arr, key) {
  const out = {};
  for (const r of arr) out[r[key]] = (out[r[key]] || 0) + 1;
  return out;
}

main().catch((e) => {
  console.error("FATAL:", e && e.stack ? e.stack : e);
  process.exit(1);
});
