// scripts/reclassify-report.js
// ONE-OFF. Reads scripts/verify-report.json, rescores each row with the
// corrected confidence logic, writes verify-report-reclassified.json and
// overwrites proposed-registry-additions.json.
//
// No network calls. Pure local reclassification.
//
// The original verify-add-companies.js used nameTokenMatch() against job
// LOCATIONS / TITLES, which never contain company names — producing 45
// false-positive VERIFIED_LOW_CONFIDENCE rows. The corrected logic below
// trusts the Phase-A HTML scrape as dispositive: if the company's own careers
// page links to a specific ATS board URL, that IS their board.
//
// Run: node scripts/reclassify-report.js

"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_IN      = path.join(__dirname, "verify-report.json");
const REPORT_OUT     = path.join(__dirname, "verify-report-reclassified.json");
const PROPOSAL_OUT   = path.join(__dirname, "proposed-registry-additions.json");

function classify(row) {
  // Pull phase-A (scrape) result
  const phaseA = (row.attempts || []).find((a) => a.phase === "A:html-scrape") || {};
  const phaseB = (row.attempts || []).find((a) => a.phase === "B:ats-api") || { attempts: [] };

  // Find the successful phase-B attempt (if any)
  const okB = (phaseB.attempts || []).find((a) => a.ok);

  // Determine source: scrape-derived vs probable-fallback
  let source = null;
  if (okB) {
    source = okB.source === "probable-fallback" ? "probable-fallback" : "scrape";
  }

  const jobCount = okB ? (okB.jobCount || 0) : 0;
  const scrapeOk = phaseA.ok === true;

  // Corrected classification:
  //   HIGH_CONFIDENCE: scrape found the ATS link on the company's own page
  //                    AND the ATS API confirmed the slug is live
  //                    AND jobs > 0
  //   EMPTY_SCRAPED:   same as above but 0 jobs (board exists, no openings)
  //   MEDIUM_CONFIDENCE_FALLBACK: scrape failed, but a slug guess matched with jobs
  //                               (requires manual spot-check before adding)
  //   WORKDAY_MANUAL:  Workday detected — verification is manual
  //   UNVERIFIED:      nothing matched

  let status, confidence;
  if (scrapeOk && okB && jobCount > 0) {
    status = "VERIFIED_WITH_JOBS";
    confidence = "HIGH"; // scrape-derived, jobs confirmed
  } else if (scrapeOk && okB && jobCount === 0) {
    status = "VERIFIED_EMPTY";
    confidence = "HIGH_BUT_EMPTY";
  } else if (!scrapeOk && okB && jobCount > 0) {
    status = "VERIFIED_FALLBACK";
    confidence = "MEDIUM"; // slug was a guess; needs spot-check
  } else if (!scrapeOk && okB && jobCount === 0) {
    status = "VERIFIED_FALLBACK_EMPTY";
    confidence = "LOW";
  } else if (row.detected_ats === "wd" || (scrapeOk && phaseA.ats === "wd")) {
    status = "WORKDAY_MANUAL_REVIEW";
    confidence = "N/A";
  } else {
    status = "UNVERIFIED";
    confidence = "NONE";
  }

  return {
    name: row.name,
    priority: row.priority,
    probable_ats: row.probable_ats,
    probable_slug: row.probable_slug,
    careers_url: row.careers_url,
    status,
    confidence,
    source,
    detected_ats: okB ? okB.ats : (scrapeOk ? phaseA.ats : null),
    detected_slug: okB ? okB.slug : (scrapeOk ? phaseA.slug : null),
    job_count: okB ? jobCount : null,
    scrape_ok: scrapeOk,
    scrape_reason: phaseA.reason || null,
    phase_b_attempts: (phaseB.attempts || []).length,
    original_status: row.status,
  };
}

function countBy(arr, key) {
  const out = {};
  for (const r of arr) out[r[key]] = (out[r[key]] || 0) + 1;
  return out;
}

function main() {
  if (!fs.existsSync(REPORT_IN)) {
    console.error("FATAL: missing", REPORT_IN);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(REPORT_IN, "utf8"));
  const rows = raw.results || [];
  const reclassified = rows.map(classify);

  // Snapshot old proposal count for delta reporting
  let oldProposalCount = 0;
  if (fs.existsSync(PROPOSAL_OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(PROPOSAL_OUT, "utf8"));
      oldProposalCount = Object.keys(prev.mappings || {}).length;
    } catch (_e) { /* ignore */ }
  }

  const out = {
    version: 2,
    generated_at: new Date().toISOString(),
    note:
      "Reclassified from verify-report.json. Corrected logic: scrape-derived " +
      "results are HIGH confidence (company's own careers page linked to the ATS " +
      "board, so identity is established by the outbound link — not by fuzzy " +
      "matching job titles).",
    input_count: rows.length,
    status_counts: countBy(reclassified, "status"),
    confidence_counts: countBy(reclassified, "confidence"),
    results: reclassified,
  };
  fs.writeFileSync(REPORT_OUT, JSON.stringify(out, null, 2));

  // Build proposed registry additions — two tiers for Dom to review:
  //   auto_high:   scrape-derived + jobs > 0   → safe to merge
  //   review_med:  fallback-derived + jobs > 0 → spot-check 2-3 random before merging
  const today = new Date().toISOString().split("T")[0];
  const autoHigh = {};
  const reviewMed = {};
  const emptyWithBoard = {};
  for (const r of reclassified) {
    if (r.status === "VERIFIED_WITH_JOBS") {
      autoHigh[r.name] = {
        ats: r.detected_ats,
        slug: r.detected_slug,
        verified_at: today,
        source: "verify-add-companies:scrape:" + today,
      };
    } else if (r.status === "VERIFIED_FALLBACK") {
      reviewMed[r.name] = {
        ats: r.detected_ats,
        slug: r.detected_slug,
        verified_at: today,
        source: "verify-add-companies:fallback:" + today,
        _needs_spot_check: true,
      };
    } else if (r.status === "VERIFIED_EMPTY") {
      emptyWithBoard[r.name] = {
        ats: r.detected_ats,
        slug: r.detected_slug,
        verified_at: today,
        source: "verify-add-companies:scrape-empty:" + today,
        _note: "board exists but 0 jobs currently posted",
      };
    }
  }

  const proposal = {
    version: 2,
    generated_at: new Date().toISOString(),
    note:
      "Three tiers: auto_high is scrape-derived and safe to merge into the " +
      "registry as-is. review_med was slug-guessed and jobs were found, but " +
      "spot-check 2-3 random rows before merging. empty_with_board should be " +
      "added only if we accept 0-job companies (they'd just emit no jobs " +
      "until they hire).",
    counts: {
      auto_high: Object.keys(autoHigh).length,
      review_med: Object.keys(reviewMed).length,
      empty_with_board: Object.keys(emptyWithBoard).length,
    },
    auto_high: autoHigh,
    review_med: reviewMed,
    empty_with_board: emptyWithBoard,
  };
  fs.writeFileSync(PROPOSAL_OUT, JSON.stringify(proposal, null, 2));

  // Print summary
  console.log("");
  console.log("=== RECLASSIFICATION SUMMARY ===");
  console.log("  input rows:", rows.length);
  console.log("");
  console.log("  Status distribution (corrected):");
  for (const [status, n] of Object.entries(out.status_counts).sort((a, b) => b[1] - a[1])) {
    console.log("    " + status.padEnd(26) + " " + n);
  }
  console.log("");
  console.log("  Proposal delta: " + oldProposalCount + " → " + proposal.counts.auto_high + " auto_high rows");
  console.log("  (+ " + proposal.counts.review_med + " review_med, " + proposal.counts.empty_with_board + " empty_with_board)");
  console.log("");
  console.log("  Outputs:");
  console.log("    " + REPORT_OUT);
  console.log("    " + PROPOSAL_OUT);
}

main();
