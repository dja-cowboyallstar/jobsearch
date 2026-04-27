// scripts/merge-registry-patch.js
// ONE-OFF. Reads the current ats-registry.json from Vercel Blob, merges the
// approved mappings from scripts/proposed-registry-additions.json, writes a
// local backup + a local preview, and — only with --upload — pushes the new
// registry back to Blob.
//
// Dry-run default. No source code change required; the refresh pipeline
// picks up the new registry on its next cycle (§25 loadRegistry in
// refresh-jobs.js).
//
// Usage:
//   cd C:\ascent
//   set BLOB_READ_WRITE_TOKEN=<your token>
//   node scripts/merge-registry-patch.js              — dry run
//   node scripts/merge-registry-patch.js --upload     — push to Blob

"use strict";

const fs = require("fs");
const path = require("path");
const { put, list } = require("@vercel/blob");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) {
  console.error("FATAL: Missing BLOB_READ_WRITE_TOKEN env var");
  process.exit(1);
}

const PROPOSAL_PATH = path.join(__dirname, "proposed-registry-additions.json");
const PREVIEW_PATH = path.join(__dirname, "proposed-registry-merged.json");
const BACKUP_DIR = __dirname;

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseVersion(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  var n = parseInt(String(v).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : NaN;
}

async function loadCurrentRegistry() {
  console.log("[1/6] Reading current registry from Blob...");
  var { blobs } = await list({ prefix: "ats-registry", limit: 10, token: BLOB_TOKEN });
  if (!blobs || blobs.length === 0) {
    throw new Error("No ats-registry blob found");
  }
  var latest = blobs.sort(function (a, b) {
    return new Date(b.uploadedAt) - new Date(a.uploadedAt);
  })[0];
  console.log("      URL:           " + latest.url);
  console.log("      Uploaded at:   " + latest.uploadedAt);

  var res = await fetch(latest.url);
  if (!res.ok) throw new Error("Blob fetch failed: HTTP " + res.status);
  var registry = await res.json();

  if (!registry.mappings || typeof registry.mappings !== "object") {
    throw new Error("Current registry missing 'mappings' object");
  }
  if (!Array.isArray(registry.unmapped)) {
    throw new Error("Current registry missing 'unmapped' array");
  }
  var baseVersion = parseVersion(registry.version);
  if (!Number.isFinite(baseVersion)) {
    throw new Error("Could not parse base registry version: " + registry.version);
  }

  console.log("      Base version:  " + baseVersion);
  console.log("      Base mapped:   " + Object.keys(registry.mappings).length);
  console.log("      Base unmapped: " + registry.unmapped.length);
  return { registry: registry, baseUrl: latest.url };
}

function loadProposals() {
  console.log("[2/6] Reading proposal file...");
  if (!fs.existsSync(PROPOSAL_PATH)) {
    throw new Error("Missing " + PROPOSAL_PATH);
  }
  var p = JSON.parse(fs.readFileSync(PROPOSAL_PATH, "utf8"));
  var autoHigh = p.auto_high || {};
  var reviewMed = p.review_med || {};
  console.log("      auto_high:  " + Object.keys(autoHigh).length + " rows");
  console.log("      review_med: " + Object.keys(reviewMed).length + " rows");

  // Combined proposed mappings — both tiers (Dom spot-checked review_med)
  var combined = {};
  for (var name in autoHigh) combined[name] = autoHigh[name];
  for (name in reviewMed) {
    var entry = Object.assign({}, reviewMed[name]);
    delete entry._needs_spot_check; // strip internal flag before registry merge
    combined[name] = entry;
  }
  console.log("      combined:   " + Object.keys(combined).length + " rows");
  return combined;
}

function detectDuplicates(currentMappings, newMappings) {
  console.log("[3/6] Duplicate-name check (case-insensitive)...");
  var existingLower = {};
  for (var k in currentMappings) existingLower[k.toLowerCase()] = k;

  var dupes = [];
  for (var n in newMappings) {
    var hit = existingLower[n.toLowerCase()];
    if (hit) dupes.push({ new: n, existing: hit });
  }
  if (dupes.length) {
    console.error("FATAL: " + dupes.length + " duplicate name(s) vs current registry:");
    dupes.forEach(function (d) {
      console.error("  '" + d.new + "' collides with existing '" + d.existing + "'");
    });
    throw new Error("duplicate names — aborting");
  }
  console.log("      Duplicates detected: 0  ✓");
  return dupes;
}

function validateProposedEntries(newMappings) {
  console.log("[4/6] Validating proposed entries...");
  var bad = [];
  var ATS_ALLOWED = ["ab", "gh", "lv", "rc", "wd"];
  for (var name in newMappings) {
    var e = newMappings[name];
    if (!e.ats || ATS_ALLOWED.indexOf(e.ats) === -1) {
      bad.push({ name: name, reason: "bad or missing ats: " + e.ats });
      continue;
    }
    if (e.ats === "wd") {
      if (!e.tenant || !e.dc || !e.site) {
        bad.push({ name: name, reason: "wd entry missing tenant/dc/site" });
      }
    } else {
      if (!e.slug || typeof e.slug !== "string") {
        bad.push({ name: name, reason: "missing slug" });
      }
    }
    if (!e.verified_at || !/^\d{4}-\d{2}-\d{2}$/.test(e.verified_at)) {
      bad.push({ name: name, reason: "bad verified_at: " + e.verified_at });
    }
    if (!e.source) {
      bad.push({ name: name, reason: "missing source" });
    }
  }
  if (bad.length) {
    console.error("FATAL: " + bad.length + " invalid proposed entries:");
    bad.forEach(function (b) { console.error("  " + b.name + " — " + b.reason); });
    throw new Error("invalid proposed entries");
  }
  console.log("      All " + Object.keys(newMappings).length + " entries valid  ✓");
}

function buildMergedRegistry(current, newMappings) {
  console.log("[5/6] Building merged registry (in memory)...");
  // Spread with new coming after — but we already guaranteed no duplicates, so
  // this is a pure additive operation.
  var mergedMappings = Object.assign({}, current.mappings, newMappings);

  // Remove added names from unmapped array if present (belt-and-suspenders)
  var removedFromUnmapped = [];
  var newUnmapped = current.unmapped.filter(function (c) {
    if (newMappings[c]) {
      removedFromUnmapped.push(c);
      return false;
    }
    return true;
  });

  var baseVersion = parseVersion(current.version);
  var next = {
    version: baseVersion + 1,
    schema: current.schema || "ats-registry-v1",
    updated_at: new Date().toISOString(),
    mappings: mergedMappings,
    unmapped: newUnmapped,
  };

  // Counts
  var baseMapped = Object.keys(current.mappings).length;
  var addedCount = Object.keys(newMappings).length;
  var nextMapped = Object.keys(mergedMappings).length;
  var totalCheck = baseMapped + addedCount;
  if (nextMapped !== totalCheck) {
    throw new Error("Merge arithmetic failed: base=" + baseMapped + " + added=" + addedCount + " !== merged=" + nextMapped);
  }

  console.log("      Version:  " + baseVersion + " → " + next.version);
  console.log("      Mapped:   " + baseMapped + " → " + nextMapped + " (+" + addedCount + ")");
  console.log("      Unmapped: " + current.unmapped.length + " → " + newUnmapped.length + (removedFromUnmapped.length ? " (removed " + removedFromUnmapped.length + " now-mapped names)" : ""));

  // ATS distribution delta
  function dist(mappings) {
    var d = {};
    for (var k in mappings) {
      var a = mappings[k].ats;
      d[a] = (d[a] || 0) + 1;
    }
    return d;
  }
  var before = dist(current.mappings);
  var after = dist(mergedMappings);
  console.log("      ATS dist: " + JSON.stringify(before) + " → " + JSON.stringify(after));

  return next;
}

async function main() {
  var args = process.argv.slice(2);
  var doUpload = args.indexOf("--upload") !== -1;

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        MERGE REGISTRY PATCH (one-off)                ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("  Mode: " + (doUpload ? "UPLOAD" : "DRY RUN — use --upload to persist"));
  console.log("");

  var { registry: current, baseUrl } = await loadCurrentRegistry();
  console.log("");

  var proposed = loadProposals();
  console.log("");

  detectDuplicates(current.mappings, proposed);
  console.log("");

  validateProposedEntries(proposed);
  console.log("");

  var next = buildMergedRegistry(current, proposed);
  console.log("");

  // Write preview locally
  fs.writeFileSync(PREVIEW_PATH, JSON.stringify(next, null, 2));
  console.log("[6/6] Local preview written: " + PREVIEW_PATH);
  console.log("      Size: " + (Buffer.byteLength(JSON.stringify(next), "utf8") / 1024).toFixed(1) + " KB");

  if (!doUpload) {
    console.log("");
    console.log("DRY RUN complete. Review " + PREVIEW_PATH + ", then re-run with --upload.");
    return;
  }

  // Backup current registry before upload
  var backupPath = path.join(BACKUP_DIR, "ats-registry-backup-" + stamp() + ".json");
  fs.writeFileSync(backupPath, JSON.stringify(current, null, 2));
  console.log("");
  console.log("Pre-upload backup: " + backupPath);

  var json = JSON.stringify(next);
  console.log("Uploading to Vercel Blob...");
  var blob = await put("ats-registry.json", json, {
    access: "public",
    contentType: "application/json",
    token: BLOB_TOKEN,
    addRandomSuffix: false,
  });
  console.log("✓ UPLOADED: " + blob.url);
  console.log("");
  console.log("POST-UPLOAD VERIFICATION:");
  console.log("  curl -s \"" + blob.url + "\" | python -m json.tool | head -10");
  console.log("  curl -s \"" + blob.url + "\" | node -e \"var j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('version:',j.version,'mapped:',Object.keys(j.mappings).length,'unmapped:',j.unmapped.length)\"");
  console.log("");
  console.log("The next refresh-jobs run will pick up the new registry automatically.");
}

main().catch(function (e) {
  console.error("\nFATAL: " + (e && e.message ? e.message : e));
  if (e && e.stack) console.error(e.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
});
