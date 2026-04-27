// scripts/seed-registry.js
// One-time script: reads current ATS_MAP from refresh-jobs.js and uploads
// the ATS registry to Vercel Blob Storage. Run ONCE before deploying the
// updated refresh-jobs.js that reads from Blob.
//
// Usage:
//   cd C:\ascent
//   set BLOB_READ_WRITE_TOKEN=<your token>
//   node scripts/seed-registry.js              — dry run (preview)
//   node scripts/seed-registry.js --upload     — upload to Blob
//
// Requires: BLOB_READ_WRITE_TOKEN env var, @vercel/blob installed

const fs = require("fs");

// ── Parse the existing ATS_MAP from source code ──

function extractRegistry() {
  var src = fs.readFileSync("./scripts/refresh-jobs.js", "utf8");

  // Extract ATS_MAP
  var mapMatch = src.match(/(?:const|var)\s+ATS_MAP\s*=\s*\{/);
  if (!mapMatch) {
    console.error("FATAL: Could not find ATS_MAP in refresh-jobs.js");
    process.exit(1);
  }
  var chunk = src.substring(mapMatch.index);
  var mapBody = chunk.substring(chunk.indexOf("{"), chunk.indexOf("};") + 1);
  var map;
  try {
    map = eval("(" + mapBody + ")");
  } catch (e) {
    console.error("FATAL: Could not eval ATS_MAP:", e.message);
    process.exit(1);
  }

  // Extract ALL_COMPANIES
  var compMatch = src.match(/(?:const|var)\s+ALL_COMPANIES\s*=\s*\[/);
  if (!compMatch) {
    console.error("FATAL: Could not find ALL_COMPANIES in refresh-jobs.js");
    process.exit(1);
  }
  var cchunk = src.substring(compMatch.index);
  var cEnd = cchunk.indexOf("];");
  if (cEnd === -1) cEnd = cchunk.indexOf("]);"); // [...new Set([...])]
  var cStr = cchunk.substring(0, cEnd + 2);
  var names = cStr.match(/"([^"]+)"/g).map(function(x) { return x.replace(/"/g, ""); });
  var companies = [...new Set(names)];

  return { map: map, companies: companies };
}

function buildRegistry(map, companies) {
  var companySet = new Set(companies);
  var mapKeys = new Set(Object.keys(map));

  // Build mappings using ALL_COMPANIES names as canonical keys
  var mappings = {};
  var now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  for (var i = 0; i < companies.length; i++) {
    var name = companies[i];
    if (map[name]) {
      mappings[name] = {
        ats: map[name].ats,
        slug: map[name].slug,
        verified_at: now,
        source: "seed-from-production"
      };
    }
  }

  // Handle orphan ATS_MAP entries (in map but not ALL_COMPANIES)
  var orphans = [];
  for (var key of Object.keys(map)) {
    if (!companySet.has(key)) {
      // Try to find a close match in ALL_COMPANIES
      var match = companies.find(function(c) {
        return c.toLowerCase().indexOf(key.toLowerCase()) > -1 ||
               key.toLowerCase().indexOf(c.toLowerCase()) > -1;
      });
      if (match && !mappings[match]) {
        mappings[match] = {
          ats: map[key].ats,
          slug: map[key].slug,
          verified_at: now,
          source: "seed-orphan-matched:" + key
        };
        console.log("  Orphan matched: \"" + key + "\" → \"" + match + "\"");
      } else {
        orphans.push({ key: key, ats: map[key].ats, slug: map[key].slug });
      }
    }
  }

  // Unmapped = ALL_COMPANIES entries with no mapping
  var unmapped = companies.filter(function(c) { return !mappings[c]; });

  var registry = {
    version: 1,
    schema: "ats-registry-v1",
    updated_at: new Date().toISOString(),
    mappings: mappings,
    unmapped: unmapped
  };

  return { registry: registry, orphans: orphans };
}

// ── Main ──

async function main() {
  var doUpload = process.argv.includes("--upload");

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         ASCENT REGISTRY SEED                       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("  Mode:", doUpload ? "UPLOAD" : "DRY RUN (use --upload to write)");

  var { map, companies } = extractRegistry();
  console.log("  ATS_MAP entries:", Object.keys(map).length);
  console.log("  ALL_COMPANIES:", companies.length);

  var { registry, orphans } = buildRegistry(map, companies);

  var mapped = Object.keys(registry.mappings).length;
  var unmapped = registry.unmapped.length;
  var total = mapped + unmapped;

  console.log("\n  Registry summary:");
  console.log("    Mapped companies:", mapped);
  console.log("    Unmapped companies:", unmapped);
  console.log("    Total:", total);

  if (orphans.length > 0) {
    console.log("\n  WARNING — Orphan ATS_MAP entries (in map, not in ALL_COMPANIES):");
    orphans.forEach(function(o) {
      console.log("    " + o.key + " (" + o.ats + "/" + o.slug + ")");
    });
  }

  // ATS distribution
  var dist = {};
  for (var entry of Object.values(registry.mappings)) {
    dist[entry.ats] = (dist[entry.ats] || 0) + 1;
  }
  console.log("\n  ATS distribution:");
  for (var [ats, count] of Object.entries(dist).sort(function(a,b) { return b[1] - a[1]; })) {
    var label = { gh: "Greenhouse", ab: "Ashby", lv: "Lever", rc: "Recruitee" }[ats] || ats;
    console.log("    " + label + ": " + count);
  }

  // First/last entries
  var keys = Object.keys(registry.mappings);
  console.log("\n  First 3 mapped:", keys.slice(0, 3).map(function(k) {
    return k + " (" + registry.mappings[k].ats + "/" + registry.mappings[k].slug + ")";
  }).join(", "));
  console.log("  Last 3 mapped:", keys.slice(-3).map(function(k) {
    return k + " (" + registry.mappings[k].ats + "/" + registry.mappings[k].slug + ")";
  }).join(", "));
  console.log("  First 3 unmapped:", registry.unmapped.slice(0, 3).join(", "));

  // Validate
  if (total !== companies.length) {
    console.error("\n  FATAL: Total (" + total + ") does not match ALL_COMPANIES (" + companies.length + ")");
    process.exit(1);
  }
  if (mapped < 180) {
    console.error("\n  FATAL: Only " + mapped + " mappings — expected at least 180");
    process.exit(1);
  }
  console.log("\n  ✓ Validation passed: " + total + " companies, " + mapped + " mapped");

  var json = JSON.stringify(registry, null, 2);
  var sizeKB = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  console.log("  Registry size: " + sizeKB + " KB");

  if (!doUpload) {
    // Write locally for inspection
    fs.writeFileSync("./ats-registry-preview.json", json);
    console.log("\n  Preview written to: ats-registry-preview.json");
    console.log("  Run with --upload to push to Vercel Blob.");
    return;
  }

  // Upload to Vercel Blob
  var token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("\n  FATAL: Missing BLOB_READ_WRITE_TOKEN env var");
    process.exit(1);
  }

  var { put } = require("@vercel/blob");
  console.log("\n  Uploading to Vercel Blob...");

  var blob = await put("ats-registry.json", json, {
    access: "public",
    contentType: "application/json",
    token: token,
    addRandomSuffix: false
  });

  console.log("  ✓ UPLOADED: " + blob.url);
  console.log("\n  Next steps:");
  console.log("  1. Verify: curl " + blob.url + " | python -m json.tool | head -20");
  console.log("  2. Deploy updated refresh-jobs.js (reads from Blob registry)");
  console.log("  3. Trigger refresh and confirm 'Registry loaded' in Actions log");
}

main().catch(function(e) {
  console.error("FATAL:", e.message);
  process.exit(1);
});
