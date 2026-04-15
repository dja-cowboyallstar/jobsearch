#!/usr/bin/env node

/**
 * Ascent ATS_MAP Repair
 * 
 * Fixes malformed ATS_MAP where entries were nested inside other entries
 * due to a brace-depth bug in writeAtsMapEntry. Extracts ALL entries
 * (including nested ones), flattens them, and rewrites the ATS_MAP.
 * 
 * Usage:
 *   node repair-ats-map.js              — Preview (dry run)
 *   node repair-ats-map.js --apply      — Apply fix
 * 
 * Run from C:\ascent.
 */

const fs = require("fs");
const path = require("path");

const TARGET = path.join(process.cwd(), "scripts", "refresh-jobs.js");

function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         ASCENT ATS_MAP REPAIR                       ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`\n  Mode: ${dryRun ? "DRY RUN" : "APPLY"}\n`);

  const source = fs.readFileSync(TARGET, "utf8");

  // Find ATS_MAP boundaries
  const mapStart = source.indexOf("const ATS_MAP = {");
  if (mapStart === -1) {
    console.error("  ✗ ATS_MAP not found");
    process.exit(1);
  }

  // Find the matching closing brace — start AT the opening { so depth is correct
  let depth = 0;
  let mapEnd = -1;
  const braceStart = source.indexOf("{", mapStart);
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        mapEnd = i + 1;
        break;
      }
    }
  }

  // Include semicolon
  if (source[mapEnd] === ";") mapEnd++;

  const mapSource = source.substring(mapStart, mapEnd);
  console.log("  ATS_MAP source length: " + mapSource.length + " chars");

  // Extract ALL name:{ats:"xx",slug:"yy"} patterns regardless of nesting
  const pattern = /"([^"]+)"\s*:\s*\{\s*ats\s*:\s*"(\w+)"\s*,\s*slug\s*:\s*"([^"]+)"\s*\}/g;
  const entries = new Map();
  let match;

  while ((match = pattern.exec(mapSource)) !== null) {
    const name = match[1];
    const ats = match[2];
    const slug = match[3];

    // Skip if this looks like a nested entry name that's actually a slug value
    // (shouldn't happen with our pattern, but be safe)
    if (name === "ats" || name === "slug") continue;

    if (entries.has(name)) {
      const existing = entries.get(name);
      if (existing.ats !== ats || existing.slug !== slug) {
        console.log(`  ⚠ Duplicate: "${name}" — keeping ${ats}/"${slug}" over ${existing.ats}/"${existing.slug}"`);
      }
    }
    entries.set(name, { ats, slug });
  }

  console.log("  Entries extracted: " + entries.size);

  // Sort alphabetically by name (case-insensitive)
  const sorted = [...entries.entries()].sort((a, b) =>
    a[0].toLowerCase().localeCompare(b[0].toLowerCase())
  );

  // Rebuild ATS_MAP in correct single-line format (matching original style)
  const pairs = sorted.map(([name, val]) =>
    `"${name}":{ats:"${val.ats}",slug:"${val.slug}"}`
  );

  const newMap = "const ATS_MAP = {\n  " + pairs.join(",") + "\n};";

  // Verify by re-parsing
  const verifyPattern = /"([^"]+)"\s*:\s*\{/g;
  let verifyCount = 0;
  let vm;
  while ((vm = verifyPattern.exec(newMap)) !== null) {
    if (vm[1] !== "ats" && vm[1] !== "slug") verifyCount++;
  }

  // Also verify with JS eval
  let evalCount = 0;
  try {
    const evalMap = eval("(" + newMap.replace("const ATS_MAP = ", "").replace(/;\s*$/, "") + ")");
    evalCount = Object.keys(evalMap).length;
  } catch (e) {
    console.error("  ✗ Generated ATS_MAP is not valid JavaScript: " + e.message);
    process.exit(1);
  }

  console.log("  Regex verify: " + verifyCount + " entries");
  console.log("  JS eval verify: " + evalCount + " entries (Object.keys count)");

  if (verifyCount !== evalCount) {
    console.error("  ✗ Regex count ≠ eval count. Something is still malformed.");
    process.exit(1);
  }

  if (evalCount !== entries.size) {
    console.error("  ✗ Eval count (" + evalCount + ") ≠ extracted count (" + entries.size + "). Possible duplicate keys.");
    process.exit(1);
  }

  console.log("  ✓ Counts match: " + evalCount + " entries, all valid\n");

  // Show first few entries to verify structure
  console.log("  First 3 entries:");
  for (let i = 0; i < 3 && i < sorted.length; i++) {
    console.log("    " + sorted[i][0] + ": " + sorted[i][1].ats + "/" + sorted[i][1].slug);
  }
  console.log("  Last 3 entries:");
  for (let i = Math.max(0, sorted.length - 3); i < sorted.length; i++) {
    console.log("    " + sorted[i][0] + ": " + sorted[i][1].ats + "/" + sorted[i][1].slug);
  }

  if (dryRun) {
    console.log("\n  [DRY RUN] No files modified. Run with --apply to write.\n");
    return;
  }

  // Backup
  const backupPath = TARGET + ".backup-repair-" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(backupPath, source);
  console.log("\n  Backup: " + path.relative(process.cwd(), backupPath));

  // Replace
  const newSource = source.substring(0, mapStart) + newMap + source.substring(mapEnd);
  fs.writeFileSync(TARGET, newSource);
  console.log("  ✓ Written: scripts/refresh-jobs.js");

  // Final verification: read back and eval
  const finalSource = fs.readFileSync(TARGET, "utf8");
  const finalMapStart = finalSource.indexOf("const ATS_MAP = {");
  let finalDepth = 0;
  let finalMapEnd = -1;
  const finalBraceStart = finalSource.indexOf("{", finalMapStart);
  for (let i = finalBraceStart; i < finalSource.length; i++) {
    if (finalSource[i] === "{") finalDepth++;
    if (finalSource[i] === "}") {
      finalDepth--;
      if (finalDepth === 0) { finalMapEnd = i + 1; break; }
    }
  }
  if (finalSource[finalMapEnd] === ";") finalMapEnd++;
  const finalMapSource = finalSource.substring(finalMapStart, finalMapEnd);

  try {
    const finalMap = eval("(" + finalMapSource.replace("const ATS_MAP = ", "").replace(/;\s*$/, "") + ")");
    const finalCount = Object.keys(finalMap).length;
    console.log("  ✓ VERIFIED: Object.keys(ATS_MAP).length === " + finalCount);

    if (finalCount !== evalCount) {
      console.error("  ✗ Post-write count (" + finalCount + ") ≠ pre-write count (" + evalCount + "). SOMETHING WENT WRONG.");
      process.exit(1);
    }
  } catch (e) {
    console.error("  ✗ Post-write ATS_MAP is not valid JS: " + e.message);
    process.exit(1);
  }

  // Also verify WORKDAY_MAP and other changes survived
  const hasWorkday = finalSource.includes("WORKDAY_MAP");
  const hasDecoded = finalSource.includes("var decoded = html");
  const noJSearch = !finalSource.includes("jobs = await fetchJSearch(name)");
  console.log("  ✓ WORKDAY_MAP: " + hasWorkday);
  console.log("  ✓ Entity fix: " + hasDecoded);
  console.log("  ✓ JSearch killed: " + noJSearch);

  console.log("\n  Next:");
  console.log("    git add scripts/refresh-jobs.js");
  console.log('    git commit -m "Fix malformed ATS_MAP: flatten nested entries, verify with eval"');
  console.log("    git push");
  console.log("    # Trigger refresh\n");
}

main();
