#!/usr/bin/env node

/**
 * Ascent ATS_MAP Patch Script
 * 
 * Applies 37 verified new ATS mappings and 4 verified fixes to refresh-jobs.js.
 * Also patches api/company-jobs.js if it contains a separate ATS_MAP.
 * 
 * Usage:
 *   node patch-ats-map.js              — Preview changes (dry run, default)
 *   node patch-ats-map.js --apply      — Apply changes to files
 * 
 * Run from Ascent project root (C:\ascent).
 * No external dependencies.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Changes to apply
// ---------------------------------------------------------------------------

// 37 new mappings — verified by sample role inspection against known company profiles
const NEW_MAPPINGS = {
  "Aisera":               { ats: "gh", slug: "aiserajobs" },
  "Box":                  { ats: "gh", slug: "boxinc" },
  "Bryant Park Consulting": { ats: "gh", slug: "bryantparkconsulting" },
  "Character AI":         { ats: "ab", slug: "character" },
  "Coactive AI":          { ats: "gh", slug: "coactive" },
  "Cribl":                { ats: "gh", slug: "cribl" },
  "Cursor":               { ats: "ab", slug: "cursor" },
  "Dataiku":              { ats: "gh", slug: "dataiku" },
  "dbt Labs":             { ats: "gh", slug: "dbtlabsinc" },
  "Deepnote":             { ats: "ab", slug: "deepnote" },
  "DevRev":               { ats: "gh", slug: "devrev" },
  "Flatfile":             { ats: "ab", slug: "flatfile" },
  "Freshworks":           { ats: "lv", slug: "freshworks" },
  "Gecko Robotics":       { ats: "ab", slug: "gecko-robotics" },
  "GitLab":               { ats: "gh", slug: "gitlab" },
  "Harness":              { ats: "gh", slug: "harnessinc" },
  "Hinge Health":         { ats: "ab", slug: "hinge-health" },
  "HubSpot":              { ats: "gh", slug: "hubspotjobs" },
  "Ironclad":             { ats: "ab", slug: "ironcladhq" },
  "Kong":                 { ats: "ab", slug: "kong" },
  "Kore.ai":              { ats: "gh", slug: "koreaiinc" },
  "Light":                { ats: "ab", slug: "light" },
  "Omni Analytics":       { ats: "ab", slug: "omni" },
  "Orb":                  { ats: "ab", slug: "orb" },
  "Oscar Health":         { ats: "gh", slug: "oscar" },
  "Outreach":             { ats: "lv", slug: "outreach" },
  "Peec AI":              { ats: "ab", slug: "peec" },
  "Perplexity AI":        { ats: "ab", slug: "perplexity" },
  "Relativity Space":     { ats: "gh", slug: "relativity" },
  "Retell AI":            { ats: "ab", slug: "retell-ai" },
  "Sigma Computing":      { ats: "gh", slug: "sigmacomputing" },
  "Snyk":                 { ats: "ab", slug: "snyk" },
  "Synthflow AI":         { ats: "ab", slug: "synthflow" },
  "Tabs":                 { ats: "ab", slug: "tabs" },
  "Thinking Machines Lab": { ats: "ab", slug: "thinking-machines-lab" },
  "Together AI":          { ats: "gh", slug: "togetherai" },
  "Wiz":                  { ats: "gh", slug: "wizinc" },
};

// 4 fixes — current mapping points to wrong ATS or slug
const FIXES = {
  "DualEntry":     { from: { ats: "rc", slug: "dualentry" },     to: { ats: "ab", slug: "dualentry" } },
  "Moveworks":     { from: { ats: "ab", slug: "moveworks" },      to: { ats: "gh", slug: "moveworks" } },
  "Spring Health": { from: { ats: "ab", slug: "springhealth" },   to: { ats: "rc", slug: "spring" } },
  "Warp":          { from: { ats: "gh", slug: "warp" },           to: { ats: "ab", slug: "warp" } },
};

// ---------------------------------------------------------------------------
// ATS_MAP parser and patcher
// ---------------------------------------------------------------------------

/**
 * Parse the ATS_MAP object from source code.
 * Returns: { entries: Map<name, {ats, slug}>, startIndex, endIndex }
 */
function parseAtsMap(source) {
  // Find the ATS_MAP object — it's a single-line or multi-line const
  const mapRegex = /const\s+ATS_MAP\s*=\s*\{/;
  const match = mapRegex.exec(source);
  
  if (!match) {
    return null;
  }
  
  const startIndex = match.index;
  
  // Find the matching closing brace
  let braceDepth = 0;
  let endIndex = -1;
  
  for (let i = match.index + match[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") braceDepth++;
    if (source[i] === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }
  
  if (endIndex === -1) {
    return null;
  }
  
  // Extract the full ATS_MAP statement including semicolon
  let fullEnd = endIndex;
  if (source[fullEnd] === ";") fullEnd++;
  
  const mapSource = source.substring(startIndex, fullEnd);
  
  // Parse individual entries
  const entryRegex = /"([^"]+)"\s*:\s*\{\s*ats\s*:\s*"(\w+)"\s*,\s*slug\s*:\s*"([^"]+)"\s*\}/g;
  const entries = new Map();
  let entryMatch;
  
  while ((entryMatch = entryRegex.exec(mapSource)) !== null) {
    entries.set(entryMatch[1], { ats: entryMatch[2], slug: entryMatch[3] });
  }
  
  return { entries, startIndex, endIndex: fullEnd, originalSource: mapSource };
}

/**
 * Apply changes to a parsed ATS_MAP and generate the new source.
 */
function applyChanges(entries) {
  const log = [];
  let addedCount = 0;
  let fixedCount = 0;
  let skippedCount = 0;
  
  // Apply fixes first
  for (const [name, fix] of Object.entries(FIXES)) {
    const current = entries.get(name);
    
    if (!current) {
      log.push(`  ⚠ FIX SKIPPED: "${name}" not found in ATS_MAP`);
      skippedCount++;
      continue;
    }
    
    // Verify current mapping matches expected "from" value
    if (current.ats !== fix.from.ats || current.slug !== fix.from.slug) {
      log.push(`  ⚠ FIX SKIPPED: "${name}" current is ${current.ats}/"${current.slug}", expected ${fix.from.ats}/"${fix.from.slug}"`);
      skippedCount++;
      continue;
    }
    
    entries.set(name, { ats: fix.to.ats, slug: fix.to.slug });
    log.push(`  ✓ FIXED: "${name}" — ${fix.from.ats}/"${fix.from.slug}" → ${fix.to.ats}/"${fix.to.slug}"`);
    fixedCount++;
  }
  
  // Apply new mappings
  for (const [name, mapping] of Object.entries(NEW_MAPPINGS)) {
    if (entries.has(name)) {
      const existing = entries.get(name);
      log.push(`  ⚠ ADD SKIPPED: "${name}" already exists as ${existing.ats}/"${existing.slug}"`);
      skippedCount++;
      continue;
    }
    
    entries.set(name, mapping);
    log.push(`  ✓ ADDED: "${name}" — ${mapping.ats}/"${mapping.slug}"`);
    addedCount++;
  }
  
  return { log, addedCount, fixedCount, skippedCount };
}

/**
 * Serialize the entries map back to the ATS_MAP source format.
 * Preserves the single-line-per-entry compact format from the original.
 */
function serializeAtsMap(entries) {
  // Sort alphabetically for consistency
  const sorted = [...entries.entries()].sort((a, b) => 
    a[0].toLowerCase().localeCompare(b[0].toLowerCase())
  );
  
  // Match original format: single-line compact object on line 18
  const pairs = sorted.map(([name, val]) => 
    `"${name}":{ats:"${val.ats}",slug:"${val.slug}"}`
  );
  
  return `const ATS_MAP = {\n  ${pairs.join(",")}\n};`;
}

/**
 * Patch a single file.
 */
function patchFile(filePath, dryRun) {
  const displayPath = path.relative(process.cwd(), filePath);
  
  if (!fs.existsSync(filePath)) {
    console.log(`\n  ⚠ File not found: ${displayPath} — skipping`);
    return null;
  }
  
  console.log(`\n  Processing: ${displayPath}`);
  console.log("  " + "-".repeat(60));
  
  const source = fs.readFileSync(filePath, "utf8");
  const parsed = parseAtsMap(source);
  
  if (!parsed) {
    console.log("  ⚠ Could not find ATS_MAP in this file — skipping");
    return null;
  }
  
  console.log(`  Found ATS_MAP with ${parsed.entries.size} entries`);
  
  // Clone entries so we don't mutate across files
  const entries = new Map(parsed.entries);
  const { log, addedCount, fixedCount, skippedCount } = applyChanges(entries);
  
  // Print change log
  for (const line of log) {
    console.log(line);
  }
  
  console.log(`\n  Summary: ${addedCount} added, ${fixedCount} fixed, ${skippedCount} skipped`);
  console.log(`  ATS_MAP total: ${parsed.entries.size} → ${entries.size} entries`);
  
  if (addedCount === 0 && fixedCount === 0) {
    console.log("  No changes to apply.");
    return { addedCount, fixedCount };
  }
  
  // Generate new source
  const newMapSource = serializeAtsMap(entries);
  const newSource = source.substring(0, parsed.startIndex) + newMapSource + source.substring(parsed.endIndex);
  
  if (dryRun) {
    console.log("\n  [DRY RUN] No files modified. Use --apply to write changes.");
  } else {
    // Create backup
    const backupPath = filePath + ".backup-" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(backupPath, source);
    console.log(`  Backup: ${path.relative(process.cwd(), backupPath)}`);
    
    // Write patched file
    fs.writeFileSync(filePath, newSource);
    console.log(`  ✓ Written: ${displayPath}`);
  }
  
  return { addedCount, fixedCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");
  
  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         ASCENT ATS_MAP PATCH SCRIPT                 ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`\n  Mode: ${dryRun ? "DRY RUN (preview only)" : "APPLY (writing changes)"}`);
  console.log(`  Changes: ${Object.keys(NEW_MAPPINGS).length} new mappings + ${Object.keys(FIXES).length} fixes`);
  
  // Target files
  const refreshPath = path.join(process.cwd(), "scripts", "refresh-jobs.js");
  const companyJobsPath = path.join(process.cwd(), "api", "company-jobs.js");
  
  const result1 = patchFile(refreshPath, dryRun);
  const result2 = patchFile(companyJobsPath, dryRun);
  
  // Final summary
  console.log("\n  " + "=".repeat(60));
  
  if (dryRun) {
    console.log("  DRY RUN COMPLETE. Review above, then run:");
    console.log("    node patch-ats-map.js --apply");
  } else {
    console.log("  PATCH APPLIED.");
    console.log("  Backup files created with .backup-* suffix.");
    console.log("\n  Next steps:");
    console.log("    1. Verify: node -e \"const s=require('fs').readFileSync('./scripts/refresh-jobs.js','utf8');const r=/\\\"([^\\\"]+)\\\"\\s*:\\s*\\{/g;let c=0;while(r.exec(s))c++;console.log(c+' ATS_MAP entries')\"");
    console.log("    2. Test a new mapping: node -e \"fetch('https://boards-api.greenhouse.io/v1/boards/wizinc/jobs').then(r=>r.json()).then(d=>console.log('Wiz:',d.jobs?.length,'jobs')).catch(console.error)\"");
    console.log("    3. Commit: git add scripts/refresh-jobs.js api/company-jobs.js && git commit -m \"ATS_MAP: add 37 verified mappings, fix 4 wrong mappings\"");
    console.log("    4. Push: git push");
    console.log("    5. Trigger refresh to pick up new data");
  }
  
  console.log("");
}

main();
