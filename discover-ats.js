#!/usr/bin/env node

/**
 * Ascent ATS Discovery Script
 * 
 * Purpose: Probe every company across all supported ATS platforms to discover
 * valid board slugs. Produces a verified mapping table that replaces guesswork
 * with confirmed API responses.
 * 
 * Usage:
 *   node discover-ats.js                    — Run full discovery on all companies
 *   node discover-ats.js --jsearch-only     — Only probe the 120 JSearch fallback companies
 *   node discover-ats.js --ats-only         — Only probe existing ATS-mapped companies (verify current mappings)
 *   node discover-ats.js --ats-only --merge — Verify ATS-mapped companies and merge with previous JSearch results
 *   node discover-ats.js --company "Wiz"    — Probe a single company
 *   node discover-ats.js --resume           — Resume from last checkpoint
 * 
 * ATS_MAP is extracted automatically from scripts/refresh-jobs.js at runtime.
 * No manual data entry required. Run from your Ascent project root (C:\ascent).
 * 
 * Output:
 *   ./ats-discovery-results.json   — Full structured results
 *   ./ats-discovery-report.txt     — Human-readable summary
 *   ./ats-discovery-checkpoint.json — Progress checkpoint (auto-saved every 10 companies)
 * 
 * Requirements: Node 18+ (uses native fetch)
 * No external dependencies.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONCURRENCY = 3;           // parallel company probes (be polite)
const DELAY_BETWEEN_REQUESTS = 200;   // ms between individual ATS hits
const DELAY_BETWEEN_COMPANIES = 500;  // ms between companies
const CHECKPOINT_INTERVAL = 10;       // save progress every N companies
const REQUEST_TIMEOUT = 10000;        // 10s per request

const RESULTS_PATH = path.join(process.cwd(), "ats-discovery-results.json");
const REPORT_PATH = path.join(process.cwd(), "ats-discovery-report.txt");
const CHECKPOINT_PATH = path.join(process.cwd(), "ats-discovery-checkpoint.json");

// ---------------------------------------------------------------------------
// Company Lists
// ---------------------------------------------------------------------------

// JSearch fallback companies (120) — from audit doc, no current ATS mapping
const JSEARCH_COMPANIES = [
  "Accrual", "Adept AI", "Aisera", "Alto Pharmacy", "Arctic Wolf",
  "Bain & Company", "Base44", "Basis", "Billd", "BlackLine",
  "Board International", "Bolt", "Box", "Bryant Park Consulting", "Built Technologies",
  "Canva", "Character AI", "Clay", "Coactive AI", "Codeium",
  "Cognigy", "Commonwealth Fusion", "Corebridge Financial", "Credo AI", "CrewAI",
  "Cribl", "CrowdStrike", "Cursor", "Cyera", "Darwinbox",
  "Dataiku", "Deepnote", "DevRev", "Devoted Health", "Docusign",
  "Domo", "Echo Park Consulting", "Findigs", "Flatfile", "Flock Safety",
  "Flutterwave", "Freshworks", "Gecko Robotics", "Genspark", "Giga",
  "GitLab", "Grammarly", "Graphiant", "Groq", "Harness",
  "HashiCorp", "Hex", "Hinge Health", "Hippocratic AI", "HubSpot",
  "Hugging Face", "ICON 3D", "Ironclad", "Island", "Jasper",
  "Jedox", "Klarna", "Kong", "Kore.ai", "Light",
  "Luminance", "MainFunc", "Midjourney", "Miro", "Modular",
  "Monday.com", "Navan", "Nominal", "Noom", "Northvolt",
  "Nuvei", "Omni Analytics", "OneStream", "Orb", "Oscar Health",
  "Outreach", "Peec AI", "Pega", "Perplexity AI", "Planful",
  "Pluralsight", "Procore", "Pyramid Analytics", "Relativity Space", "Resolve AI",
  "Retell AI", "Revolut", "Rippling", "Runway Financial", "SambaNova",
  "ScaleOps", "Seismic", "SentinelOne", "ServiceNow", "Shopify",
  "Sigma Computing", "Skild AI", "Snyk", "Synthflow AI", "Tabs",
  "Tempus AI", "Thinking Machines Lab", "ThoughtSpot", "Together AI", "Tome",
  "Trader Joe's", "Tropic", "VAST Data", "Vena Solutions", "Weights & Biases",
  "Wise", "Wiz", "Wolters Kluwer", "World Wide Technology", "dbt Labs",
];

// ATS-mapped companies — extracted automatically from refresh-jobs.js at runtime.
// No manual population needed.
function extractAtsMappedCompanies() {
  const refreshScriptPath = path.join(process.cwd(), "scripts", "refresh-jobs.js");
  
  if (!fs.existsSync(refreshScriptPath)) {
    console.log(`  ⚠ refresh-jobs.js not found at ${refreshScriptPath}`);
    console.log(`    Skipping ATS-mapped company verification.`);
    console.log(`    Run this script from your Ascent project root (C:\\ascent) to enable.\n`);
    return [];
  }
  
  const source = fs.readFileSync(refreshScriptPath, "utf8");
  const pattern = /"([^"]+)"\s*:\s*\{\s*ats\s*:\s*"(\w+)"\s*,\s*slug\s*:\s*"([^"]+)"\s*\}/g;
  const entries = [];
  let match;
  
  while ((match = pattern.exec(source)) !== null) {
    entries.push({
      name: match[1],
      currentAts: match[2],
      currentSlug: match[3],
    });
  }
  
  if (entries.length === 0) {
    console.log("  ⚠ Could not parse ATS_MAP from refresh-jobs.js. Format may have changed.");
    console.log("    Skipping ATS-mapped company verification.\n");
  } else {
    console.log(`  ✓ Extracted ${entries.length} ATS-mapped companies from refresh-jobs.js\n`);
  }
  
  return entries;
}

const ATS_MAPPED_COMPANIES = extractAtsMappedCompanies();

// ---------------------------------------------------------------------------
// Slug Generation
// ---------------------------------------------------------------------------

/**
 * Generate candidate slugs from a company name.
 * 
 * Strategy: produce a ranked list of likely slugs from most common patterns
 * seen across Greenhouse, Ashby, Lever, and Recruitee boards.
 * 
 * "Perplexity AI" → ["perplexityai", "perplexity-ai", "perplexity", "perplexity_ai"]
 * "dbt Labs"      → ["dbtlabs", "dbt-labs", "dbt", "dbt_labs", "dbtlabsinc"]
 * "VAST Data"     → ["vastdata", "vast-data", "vast", "vast_data", "vastdatainc"]
 * "Monday.com"    → ["mondaycom", "monday-com", "monday", "monday_com", "mondaydotcom"]
 */
function generateSlugs(companyName) {
  const slugs = new Set();
  
  // Normalize: lowercase, trim
  const clean = companyName.toLowerCase().trim();
  
  // Remove special characters for base processing
  const alphaOnly = clean.replace(/[^a-z0-9\s]/g, "");
  const words = alphaOnly.split(/\s+/).filter(Boolean);
  
  if (words.length === 0) return [];
  
  // Common suffixes to strip for shorter variants
  const stripSuffixes = ["ai", "inc", "co", "io", "hq", "labs", "tech", "technologies", "software", "systems", "consulting", "solutions"];
  
  // ---- Core patterns ----
  
  // All words joined: "perplexityai"
  slugs.add(words.join(""));
  
  // Hyphenated: "perplexity-ai"
  slugs.add(words.join("-"));
  
  // First word only: "perplexity"
  slugs.add(words[0]);
  
  // Underscored: "perplexity_ai"
  slugs.add(words.join("_"));
  
  // ---- Suffix-stripped variants ----
  
  const coreWords = words.filter(w => !stripSuffixes.includes(w));
  if (coreWords.length > 0 && coreWords.length < words.length) {
    slugs.add(coreWords.join(""));
    slugs.add(coreWords.join("-"));
    if (coreWords.length > 1) {
      slugs.add(coreWords[0]);
    }
  }
  
  // ---- Common corporate slug patterns ----
  
  // With "inc" appended: "perplexityaiinc" (rare but exists)
  slugs.add(words.join("") + "inc");
  
  // With "hq" appended: "perplexityaihq"
  slugs.add(words.join("") + "hq");
  
  // With "careers" appended: "perplexityaicareers"
  slugs.add(words.join("") + "careers");
  
  // With "jobs" appended: "perplexityaijobs"
  slugs.add(words.join("") + "jobs");
  
  // ---- Handle dots (Monday.com, Kore.ai) ----
  
  if (companyName.includes(".")) {
    const dotless = clean.replace(/\./g, "");
    const dotHyphen = clean.replace(/\./g, "-").replace(/[^a-z0-9-]/g, "");
    const dotWords = dotless.replace(/[^a-z0-9]/g, "");
    slugs.add(dotWords);
    slugs.add(dotHyphen);
    
    // "monday" from "monday.com"
    const preDot = clean.split(".")[0].replace(/[^a-z0-9]/g, "");
    slugs.add(preDot);
  }
  
  // ---- Handle "&" (Bain & Company, Weights & Biases) ----
  
  if (companyName.includes("&")) {
    const andVersion = clean.replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "");
    const andWords = andVersion.split(/\s+/).filter(Boolean);
    slugs.add(andWords.join(""));
    slugs.add(andWords.join("-"));
  }
  
  // ---- Handle numeric/3D (ICON 3D) ----
  // Already handled by alphaOnly processing
  
  // ---- Capitalize-aware: "dbt" stays "dbt", not "Dbt" ----
  // Slugs are already lowercase
  
  // Remove empty strings and duplicates
  return [...slugs].filter(s => s.length > 0 && s.length <= 60);
}

// ---------------------------------------------------------------------------
// ATS Probers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { 
      ...options, 
      signal: controller.signal,
      headers: {
        "User-Agent": "Ascent-ATS-Discovery/1.0",
        ...(options.headers || {}),
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Probe Greenhouse for a given slug.
 * Returns: { found: boolean, jobCount: number, slug: string, sampleTitles: string[] }
 */
async function probeGreenhouse(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const response = await fetchWithTimeout(url);
    
    if (response.status === 404) return { found: false, slug };
    if (!response.ok) return { found: false, slug, error: `HTTP ${response.status}` };
    
    const data = await response.json();
    const jobs = data.jobs || [];
    
    return {
      found: true,
      slug,
      jobCount: jobs.length,
      sampleTitles: jobs.slice(0, 5).map(j => j.title),
      hasDescriptions: jobs.some(j => j.content && j.content.length > 50),
    };
  } catch (error) {
    return { found: false, slug, error: error.message };
  }
}

/**
 * Probe Ashby for a given slug.
 * Updated: Ashby deprecated the GraphQL endpoint. New REST API at api.ashbyhq.com.
 */
async function probeAshby(slug) {
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    const response = await fetchWithTimeout(url);
    
    if (response.status === 404) return { found: false, slug };
    if (!response.ok) return { found: false, slug, error: `HTTP ${response.status}` };
    
    const data = await response.json();
    const jobs = data.jobs || [];
    
    return {
      found: true,
      slug,
      jobCount: jobs.length,
      sampleTitles: jobs.slice(0, 5).map(j => j.title),
      hasDescriptions: jobs.some(j => (j.descriptionHtml || j.descriptionPlain || "").length > 50),
    };
  } catch (error) {
    return { found: false, slug, error: error.message };
  }
}

/**
 * Probe Lever for a given slug.
 */
async function probeLever(slug) {
  try {
    const url = `https://api.lever.co/v0/postings/${slug}`;
    const response = await fetchWithTimeout(url);
    
    if (response.status === 404) return { found: false, slug };
    if (!response.ok) return { found: false, slug, error: `HTTP ${response.status}` };
    
    const data = await response.json();
    
    if (!Array.isArray(data)) return { found: false, slug, error: "Unexpected response format" };
    
    return {
      found: true,
      slug,
      jobCount: data.length,
      sampleTitles: data.slice(0, 5).map(j => j.text),
      hasDescriptions: data.some(j => (j.description || j.descriptionPlain || "").length > 50),
    };
  } catch (error) {
    return { found: false, slug, error: error.message };
  }
}

/**
 * Probe Recruitee for a given slug.
 */
async function probeRecruitee(slug) {
  try {
    const url = `https://${slug}.recruitee.com/api/offers`;
    const response = await fetchWithTimeout(url);
    
    if (response.status === 404) return { found: false, slug };
    if (!response.ok) return { found: false, slug, error: `HTTP ${response.status}` };
    
    const data = await response.json();
    const offers = data.offers || [];
    
    return {
      found: true,
      slug,
      jobCount: offers.length,
      sampleTitles: offers.slice(0, 5).map(j => j.title),
      hasDescriptions: offers.some(j => (j.description || "").length > 50),
    };
  } catch (error) {
    return { found: false, slug, error: error.message };
  }
}

const ATS_PROBERS = [
  { name: "greenhouse", code: "gh", probe: probeGreenhouse },
  { name: "ashby",      code: "ab", probe: probeAshby },
  { name: "lever",      code: "lv", probe: probeLever },
  { name: "recruitee",  code: "rc", probe: probeRecruitee },
];

// ---------------------------------------------------------------------------
// Discovery Engine
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Discover ATS boards for a single company.
 * Tries all slug variants against all ATS platforms.
 * Returns the best match (highest job count from a direct ATS).
 */
async function discoverCompany(companyName, currentMapping = null) {
  const slugs = generateSlugs(companyName);
  const discoveries = [];
  let totalProbes = 0;
  
  for (const ats of ATS_PROBERS) {
    for (const slug of slugs) {
      totalProbes++;
      const result = await ats.probe(slug);
      
      if (result.found) {
        discoveries.push({
          atsName: ats.name,
          atsCode: ats.code,
          slug: result.slug,
          jobCount: result.jobCount,
          sampleTitles: result.sampleTitles,
          hasDescriptions: result.hasDescriptions,
        });
        
        // If we found a board with jobs on this ATS, skip remaining slugs for this ATS
        // (we found the right slug — no need to test more variants on the same platform)
        if (result.jobCount > 0) break;
      }
      
      await sleep(DELAY_BETWEEN_REQUESTS);
    }
  }
  
  // Rank discoveries: prefer boards with the most jobs
  discoveries.sort((a, b) => b.jobCount - a.jobCount);
  
  const bestMatch = discoveries.length > 0 ? discoveries[0] : null;
  
  // Check for mapping conflicts
  let mappingStatus = "no_current_mapping";
  if (currentMapping) {
    if (!bestMatch) {
      mappingStatus = "current_mapping_unverified";
    } else if (bestMatch.atsCode === currentMapping.currentAts && bestMatch.slug === currentMapping.currentSlug) {
      mappingStatus = "current_mapping_confirmed";
    } else {
      mappingStatus = "current_mapping_wrong";
    }
  } else if (bestMatch) {
    mappingStatus = "new_mapping_found";
  } else {
    mappingStatus = "no_ats_found";
  }
  
  return {
    company: companyName,
    currentMapping: currentMapping || null,
    bestMatch,
    allDiscoveries: discoveries,
    totalProbes,
    mappingStatus,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Checkpoint & Resume
// ---------------------------------------------------------------------------

function saveCheckpoint(results, remaining) {
  const checkpoint = {
    completedResults: results,
    remainingCompanies: remaining,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    console.log(`\n  Checkpoint found: ${data.completedResults.length} companies already done, ${data.remainingCompanies.length} remaining.`);
    console.log(`  Saved at: ${data.savedAt}`);
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------

function generateReport(results) {
  const lines = [];
  const divider = "=".repeat(80);
  const thinDivider = "-".repeat(80);
  
  lines.push(divider);
  lines.push("  ASCENT ATS DISCOVERY REPORT");
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push(`  Companies scanned: ${results.length}`);
  lines.push(divider);
  
  // ---- Summary stats ----
  
  const statusCounts = {};
  for (const r of results) {
    statusCounts[r.mappingStatus] = (statusCounts[r.mappingStatus] || 0) + 1;
  }
  
  lines.push("\n  SUMMARY");
  lines.push(thinDivider);
  lines.push(`  New ATS mappings found:       ${statusCounts["new_mapping_found"] || 0}`);
  lines.push(`  Current mappings confirmed:   ${statusCounts["current_mapping_confirmed"] || 0}`);
  lines.push(`  Current mappings WRONG:       ${statusCounts["current_mapping_wrong"] || 0}`);
  lines.push(`  Current mappings unverified:  ${statusCounts["current_mapping_unverified"] || 0}`);
  lines.push(`  No ATS found:                 ${statusCounts["no_ats_found"] || 0}`);
  lines.push(`  No current mapping:           ${statusCounts["no_current_mapping"] || 0}`);
  
  // ---- ATS distribution of discoveries ----
  
  const atsCounts = { greenhouse: 0, ashby: 0, lever: 0, recruitee: 0 };
  const atsJobTotals = { greenhouse: 0, ashby: 0, lever: 0, recruitee: 0 };
  for (const r of results) {
    if (r.bestMatch) {
      atsCounts[r.bestMatch.atsName]++;
      atsJobTotals[r.bestMatch.atsName] += r.bestMatch.jobCount;
    }
  }
  
  lines.push("\n  ATS DISTRIBUTION (discovered boards)");
  lines.push(thinDivider);
  for (const [ats, count] of Object.entries(atsCounts)) {
    if (count > 0) {
      lines.push(`  ${ats.padEnd(14)} ${String(count).padStart(4)} companies   ${String(atsJobTotals[ats]).padStart(6)} total jobs`);
    }
  }
  
  // ---- Section 1: New mappings found (ACTION: add to ATS_MAP) ----
  
  const newMappings = results.filter(r => r.mappingStatus === "new_mapping_found");
  if (newMappings.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push("  ACTION REQUIRED: NEW ATS MAPPINGS TO ADD");
    lines.push(`  ${newMappings.length} companies can be moved from JSearch to direct ATS`);
    lines.push(`${"█".repeat(80)}`);
    
    for (const r of newMappings.sort((a, b) => b.bestMatch.jobCount - a.bestMatch.jobCount)) {
      const m = r.bestMatch;
      lines.push(`\n  ${r.company}`);
      lines.push(`    ATS: ${m.atsName} (${m.atsCode})  |  Slug: "${m.slug}"  |  Jobs: ${m.jobCount}`);
      lines.push(`    ATS_MAP entry: "${r.company}": { ats: "${m.atsCode}", slug: "${m.slug}" }`);
      if (m.sampleTitles.length > 0) {
        lines.push(`    Sample roles: ${m.sampleTitles.slice(0, 3).join(", ")}`);
      }
      if (m.hasDescriptions === false) {
        lines.push(`    ⚠ WARNING: Jobs found but descriptions may be empty — verify parser compatibility`);
      }
      
      // Show alternative boards if multiple found
      if (r.allDiscoveries.length > 1) {
        lines.push(`    Also found on: ${r.allDiscoveries.slice(1).map(d => `${d.atsName}/${d.slug} (${d.jobCount} jobs)`).join(", ")}`);
      }
    }
  }
  
  // ---- Section 2: Wrong mappings (ACTION: fix in ATS_MAP) ----
  
  const wrongMappings = results.filter(r => r.mappingStatus === "current_mapping_wrong");
  if (wrongMappings.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push("  ACTION REQUIRED: WRONG ATS MAPPINGS TO FIX");
    lines.push(`  ${wrongMappings.length} companies have incorrect current mappings`);
    lines.push(`${"█".repeat(80)}`);
    
    for (const r of wrongMappings) {
      const m = r.bestMatch;
      const c = r.currentMapping;
      lines.push(`\n  ${r.company}`);
      lines.push(`    CURRENT (wrong): ${c.currentAts}/"${c.currentSlug}"`);
      lines.push(`    CORRECT:         ${m.atsCode}/"${m.slug}" (${m.jobCount} jobs)`);
      lines.push(`    ATS_MAP fix:     "${r.company}": { ats: "${m.atsCode}", slug: "${m.slug}" }`);
    }
  }
  
  // ---- Section 3: Unverified current mappings (ACTION: manual check) ----
  
  const unverified = results.filter(r => r.mappingStatus === "current_mapping_unverified");
  if (unverified.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push("  WARNING: CURRENT MAPPINGS COULD NOT BE VERIFIED");
    lines.push(`  ${unverified.length} companies — their current ATS slug returned no board`);
    lines.push(`${"█".repeat(80)}`);
    
    for (const r of unverified) {
      const c = r.currentMapping;
      lines.push(`\n  ${r.company}`);
      lines.push(`    Current mapping: ${c.currentAts}/"${c.currentSlug}" — NO BOARD FOUND`);
      lines.push(`    Action: Visit their career page manually. They may have switched ATS or shut down.`);
    }
  }
  
  // ---- Section 4: No ATS found (ACTION: manual review or remove) ----
  
  const noAts = results.filter(r => r.mappingStatus === "no_ats_found" || r.mappingStatus === "no_current_mapping");
  const actuallyNoAts = noAts.filter(r => !r.bestMatch);
  if (actuallyNoAts.length > 0) {
    lines.push(`\n\n${thinDivider}`);
    lines.push("  NO ATS DISCOVERED — MANUAL REVIEW NEEDED");
    lines.push(`  ${actuallyNoAts.length} companies — no Greenhouse/Ashby/Lever/Recruitee board found`);
    lines.push(thinDivider);
    lines.push("  These companies may use: Workday, iCIMS, SmartRecruiters, Taleo, custom pages,");
    lines.push("  or may be defunct. Each needs a manual career page visit.");
    lines.push("");
    
    for (const r of actuallyNoAts.sort((a, b) => a.company.localeCompare(b.company))) {
      lines.push(`  - ${r.company}`);
    }
  }
  
  // ---- Section 5: Confirmed mappings (no action needed) ----
  
  const confirmed = results.filter(r => r.mappingStatus === "current_mapping_confirmed");
  if (confirmed.length > 0) {
    lines.push(`\n\n${thinDivider}`);
    lines.push("  CONFIRMED MAPPINGS (no action needed)");
    lines.push(`  ${confirmed.length} companies — current ATS_MAP entry verified correct`);
    lines.push(thinDivider);
    
    for (const r of confirmed) {
      const m = r.bestMatch;
      lines.push(`  ✓ ${r.company.padEnd(35)} ${m.atsName}/${m.slug} (${m.jobCount} jobs)`);
    }
  }
  
  // ---- ATS_MAP code block (ready to paste) ----
  
  const allMappings = results.filter(r => r.bestMatch);
  if (allMappings.length > 0) {
    lines.push(`\n\n${divider}`);
    lines.push("  GENERATED ATS_MAP ENTRIES (paste into refresh-jobs.js)");
    lines.push(divider);
    lines.push("");
    
    for (const r of allMappings.sort((a, b) => a.company.localeCompare(b.company))) {
      const m = r.bestMatch;
      const status = r.mappingStatus === "new_mapping_found" ? " // NEW" :
                     r.mappingStatus === "current_mapping_wrong" ? " // FIXED" :
                     r.mappingStatus === "current_mapping_confirmed" ? "" : " // CHECK";
      lines.push(`  "${r.company}": { ats: "${m.atsCode}", slug: "${m.slug}" },${status}`);
    }
  }
  
  lines.push(`\n\n${divider}`);
  lines.push("  END OF REPORT");
  lines.push(divider);
  
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsearchOnly = args.includes("--jsearch-only");
  const atsOnly = args.includes("--ats-only");
  const resumeMode = args.includes("--resume");
  const mergeMode = args.includes("--merge");
  const singleCompanyIndex = args.indexOf("--company");
  const singleCompany = singleCompanyIndex >= 0 ? args[singleCompanyIndex + 1] : null;
  
  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         ASCENT ATS DISCOVERY SCRIPT v1.0            ║");
  console.log("  ╚══════════════════════════════════════════════════════╝\n");
  
  // Build the company queue
  let companyQueue = [];
  let completedResults = [];
  
  // --merge: load previous results and include them in the final report
  // without re-scanning those companies
  if (mergeMode && fs.existsSync(RESULTS_PATH)) {
    const previousResults = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
    completedResults = previousResults;
    console.log(`  Loaded ${previousResults.length} previous results from ${RESULTS_PATH}`);
    console.log(`  These companies will NOT be re-scanned.\n`);
  }
  
  const alreadyScanned = new Set(completedResults.map(r => r.company));
  
  if (singleCompany) {
    // Single company mode
    const existingMapping = ATS_MAPPED_COMPANIES.find(
      c => c.name.toLowerCase() === singleCompany.toLowerCase()
    );
    companyQueue = [{ name: singleCompany, currentMapping: existingMapping || null }];
    console.log(`  Mode: Single company — "${singleCompany}"`);
    
  } else if (resumeMode) {
    // Resume from checkpoint
    const checkpoint = loadCheckpoint();
    if (!checkpoint) {
      console.error("  No checkpoint file found. Run without --resume first.");
      process.exit(1);
    }
    completedResults = checkpoint.completedResults;
    companyQueue = checkpoint.remainingCompanies;
    console.log(`  Mode: Resume — ${companyQueue.length} companies remaining\n`);
    
  } else if (atsOnly) {
    // Only scan ATS-mapped companies (skip JSearch list)
    console.log(`  Mode: ATS-mapped companies only (${ATS_MAPPED_COMPANIES.length})\n`);
    for (const mapped of ATS_MAPPED_COMPANIES) {
      if (!alreadyScanned.has(mapped.name)) {
        companyQueue.push({ name: mapped.name, currentMapping: mapped });
      }
    }
    if (alreadyScanned.size > 0) {
      console.log(`  Skipping ${alreadyScanned.size} already-scanned companies from previous results.\n`);
    }
    
  } else {
    // Build full queue
    if (jsearchOnly) {
      console.log(`  Mode: JSearch fallback companies only (${JSEARCH_COMPANIES.length})\n`);
    } else {
      console.log(`  Mode: All companies (${JSEARCH_COMPANIES.length} JSearch + ${ATS_MAPPED_COMPANIES.length} ATS-mapped)\n`);
    }
    
    // Add JSearch companies (no current mapping)
    for (const name of JSEARCH_COMPANIES) {
      if (!alreadyScanned.has(name)) {
        companyQueue.push({ name, currentMapping: null });
      }
    }
    
    // Add ATS-mapped companies (if not jsearch-only)
    if (!jsearchOnly) {
      for (const mapped of ATS_MAPPED_COMPANIES) {
        if (!alreadyScanned.has(mapped.name)) {
          companyQueue.push({ name: mapped.name, currentMapping: mapped });
        }
      }
    }
    
    if (alreadyScanned.size > 0) {
      console.log(`  Skipping ${alreadyScanned.size} already-scanned companies from previous results.\n`);
    }
  }
  
  const totalCompanies = completedResults.length + companyQueue.length;
  
  // Estimate time
  const estimatedSlugsPer = 10; // average slug variants per company
  const estimatedProbes = companyQueue.length * ATS_PROBERS.length * estimatedSlugsPer;
  const estimatedMinutes = Math.ceil((estimatedProbes * DELAY_BETWEEN_REQUESTS + companyQueue.length * DELAY_BETWEEN_COMPANIES) / 60000);
  console.log(`  Companies to scan: ${companyQueue.length}`);
  console.log(`  Estimated probes:  ~${estimatedProbes}`);
  console.log(`  Estimated time:    ~${estimatedMinutes} minutes`);
  console.log(`  Checkpoint every:  ${CHECKPOINT_INTERVAL} companies`);
  console.log(`\n  Starting discovery...\n`);
  
  // Process companies
  let processedCount = completedResults.length;
  
  for (let i = 0; i < companyQueue.length; i++) {
    const entry = companyQueue[i];
    processedCount++;
    
    const progress = `[${processedCount}/${totalCompanies}]`;
    process.stdout.write(`  ${progress} ${entry.name.padEnd(35)} `);
    
    try {
      const result = await discoverCompany(entry.name, entry.currentMapping);
      completedResults.push(result);
      
      // Print inline result
      if (result.bestMatch) {
        const m = result.bestMatch;
        const statusIcon = result.mappingStatus === "new_mapping_found" ? "★ NEW" :
                          result.mappingStatus === "current_mapping_confirmed" ? "✓" :
                          result.mappingStatus === "current_mapping_wrong" ? "⚠ WRONG" : "?";
        console.log(`${statusIcon}  ${m.atsName}/${m.slug} (${m.jobCount} jobs)`);
      } else {
        console.log(`✗  No ATS board found`);
      }
      
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      completedResults.push({
        company: entry.name,
        currentMapping: entry.currentMapping,
        bestMatch: null,
        allDiscoveries: [],
        totalProbes: 0,
        mappingStatus: "error",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Checkpoint
    if ((i + 1) % CHECKPOINT_INTERVAL === 0 && i + 1 < companyQueue.length) {
      const remaining = companyQueue.slice(i + 1);
      saveCheckpoint(completedResults, remaining);
      console.log(`  --- Checkpoint saved (${completedResults.length} done, ${remaining.length} remaining) ---`);
    }
    
    // Delay between companies
    if (i + 1 < companyQueue.length) {
      await sleep(DELAY_BETWEEN_COMPANIES);
    }
  }
  
  // ---- Write outputs ----
  
  console.log("\n  Discovery complete. Writing results...\n");
  
  // Full JSON results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(completedResults, null, 2));
  console.log(`  ✓ Full results:   ${RESULTS_PATH}`);
  
  // Human-readable report
  const report = generateReport(completedResults);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`  ✓ Report:         ${REPORT_PATH}`);
  
  // Clean up checkpoint
  if (fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
    console.log(`  ✓ Checkpoint cleaned up`);
  }
  
  // ---- Print summary to console ----
  
  const newFound = completedResults.filter(r => r.mappingStatus === "new_mapping_found").length;
  const wrongFound = completedResults.filter(r => r.mappingStatus === "current_mapping_wrong").length;
  const noAtsFound = completedResults.filter(r => !r.bestMatch && r.mappingStatus !== "error").length;
  const confirmedFound = completedResults.filter(r => r.mappingStatus === "current_mapping_confirmed").length;
  const errors = completedResults.filter(r => r.mappingStatus === "error").length;
  
  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║                   DISCOVERY SUMMARY                 ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║  New ATS mappings found:      ${String(newFound).padStart(4)}                  ║`);
  console.log(`  ║  Wrong mappings detected:     ${String(wrongFound).padStart(4)}                  ║`);
  console.log(`  ║  Current mappings confirmed:  ${String(confirmedFound).padStart(4)}                  ║`);
  console.log(`  ║  No ATS found (manual check): ${String(noAtsFound).padStart(4)}                  ║`);
  console.log(`  ║  Errors:                      ${String(errors).padStart(4)}                  ║`);
  console.log("  ╚══════════════════════════════════════════════════════╝\n");
  
  if (newFound > 0) {
    console.log(`  ${newFound} companies can be moved from JSearch to direct ATS.`);
    console.log(`  See the report for copy-paste ATS_MAP entries.\n`);
  }
  
  if (noAtsFound > 0) {
    console.log(`  ${noAtsFound} companies need manual career page review.`);
    console.log(`  They may use Workday, iCIMS, or custom pages.\n`);
  }
}

main().catch(error => {
  console.error(`\n  Fatal error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
