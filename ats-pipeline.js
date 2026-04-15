#!/usr/bin/env node

/**
 * Ascent Unified ATS Pipeline
 * 
 * Single tool that replaces discover-ats.js, classify-ats.js, and patch-ats-map.js.
 * For each unmapped company: discovers career URL → fingerprints ATS platform →
 * extracts or brute-forces slug → validates against live API → checks for false
 * positives → writes to refresh-jobs.js → verifies persistence.
 * 
 * Usage:
 *   node ats-pipeline.js                     — Process all unmapped companies
 *   node ats-pipeline.js --company "Shopify" — Process a single company
 *   node ats-pipeline.js --dry-run           — Find mappings but don't write to file
 *   node ats-pipeline.js --resume            — Resume from checkpoint
 * 
 * Run from C:\ascent. No external dependencies. Node 18+.
 */

const fs = require("fs");
const path = require("path");

const REFRESH_SCRIPT = path.join(process.cwd(), "scripts", "refresh-jobs.js");
const REPORT_PATH = path.join(process.cwd(), "ats-pipeline-report.txt");
const CHECKPOINT_PATH = path.join(process.cwd(), "ats-pipeline-checkpoint.json");
const REQUEST_TIMEOUT = 12000;
const DELAY_MS = 250;
const COMPANY_DELAY_MS = 600;
const CHECKPOINT_EVERY = 10;

// ---------------------------------------------------------------------------
// Known domains — company name → website domain
// ---------------------------------------------------------------------------

const DOMAINS = {
  "Accrual":"accrual.com","Adept AI":"adept.ai","Aisera":"aisera.com","Alto Pharmacy":"alto.com",
  "Arctic Wolf":"arcticwolf.com","Bain & Company":"bain.com","Base44":"base44.com","Basis":"basis.com",
  "Billd":"billd.com","BlackLine":"blackline.com","Board International":"board.com","Bolt":"bolt.com",
  "Box":"box.com","Bryant Park Consulting":"bryantparkconsulting.com","Built Technologies":"getbuilt.com",
  "Canva":"canva.com","Character AI":"character.ai","Clay":"clay.com","Coactive AI":"coactive.ai",
  "Codeium":"codeium.com","Cognigy":"cognigy.com","Commonwealth Fusion":"cfs.energy",
  "Corebridge Financial":"corebridgefinancial.com","Credo AI":"credo.ai","CrewAI":"crewai.com",
  "Cribl":"cribl.io","CrowdStrike":"crowdstrike.com","Cursor":"cursor.com","Cyera":"cyera.io",
  "Darwinbox":"darwinbox.com","Dataiku":"dataiku.com","dbt Labs":"getdbt.com","Deepnote":"deepnote.com",
  "DevRev":"devrev.ai","Devoted Health":"devoted.com","Docusign":"docusign.com","Domo":"domo.com",
  "DualEntry":"dualentry.com","Echo Park Consulting":"echoparkconsulting.com","Findigs":"findigs.com",
  "Flatfile":"flatfile.com","Flock Safety":"flocksafety.com","Flutterwave":"flutterwave.com",
  "Freshworks":"freshworks.com","Gecko Robotics":"geckorobotics.com","Genspark":"genspark.ai",
  "Giga":"giga.io","GitLab":"gitlab.com","Grammarly":"grammarly.com","Graphiant":"graphiant.com",
  "Groq":"groq.com","Harness":"harness.io","HashiCorp":"hashicorp.com","Hex":"hex.tech",
  "Hinge Health":"hingehealth.com","Hippocratic AI":"hippocratic.ai","HubSpot":"hubspot.com",
  "Hugging Face":"huggingface.co","ICON 3D":"iconbuild.com","Ironclad":"ironcladhq.com",
  "Island":"island.io","Jasper":"jasper.ai","Jedox":"jedox.com","Klarna":"klarna.com",
  "Kong":"konghq.com","Kore.ai":"kore.ai","Light":"light.co","Luminance":"luminance.com",
  "MainFunc":"mainfunc.ai","Midjourney":"midjourney.com","Miro":"miro.com","Modular":"modular.com",
  "Monday.com":"monday.com","Navan":"navan.com","Nominal":"nominal.io","Noom":"noom.com",
  "Northvolt":"northvolt.com","Nuvei":"nuvei.com","Omni Analytics":"omni.co","OneStream":"onestream.com",
  "Orb":"withorb.com","Oscar Health":"hioscar.com","Outreach":"outreach.io","Peec AI":"peec.ai",
  "Pega":"pega.com","Perplexity AI":"perplexity.ai","Planful":"planful.com","Pluralsight":"pluralsight.com",
  "Procore":"procore.com","Pyramid Analytics":"pyramidanalytics.com","Relativity Space":"relativityspace.com",
  "Resolve AI":"resolve.ai","Retell AI":"retellai.com","Revolut":"revolut.com","Rippling":"rippling.com",
  "Runway Financial":"runway.com","SambaNova":"sambanova.ai","ScaleOps":"scaleops.com",
  "Seismic":"seismic.com","SentinelOne":"sentinelone.com","ServiceNow":"servicenow.com",
  "Shopify":"shopify.com","Sigma Computing":"sigmacomputing.com","Skild AI":"skild.ai","Snyk":"snyk.io",
  "Synthflow AI":"synthflow.ai","Tabs":"tabs.inc","Tempus AI":"tempus.com",
  "Thinking Machines Lab":"thinkingmachines.ai","ThoughtSpot":"thoughtspot.com","Together AI":"together.ai",
  "Tome":"tome.app","Trader Joe's":"traderjoes.com","Tropic":"tropicapp.io","VAST Data":"vastdata.com",
  "Vena Solutions":"venasolutions.com","Weights & Biases":"wandb.ai","Wise":"wise.com","Wiz":"wiz.io",
  "Wolters Kluwer":"wolterskluwer.com","World Wide Technology":"wwt.com",
  // Additional domains for companies that may be added later
  "Noom":"noom.com","Shopify":"shopify.com",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOk(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.5",
        ...(options.headers || {}),
      },
      redirect: "follow",
    });
    clearTimeout(tid);
    return r;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Read/write refresh-jobs.js
// ---------------------------------------------------------------------------

function readAtsMap() {
  const source = fs.readFileSync(REFRESH_SCRIPT, "utf8");
  const map = new Map();
  const pattern = /"([^"]+)"\s*:\s*\{\s*ats\s*:\s*"(\w+)"\s*,\s*slug\s*:\s*"([^"]+)"\s*\}/g;
  let m;
  while ((m = pattern.exec(source)) !== null) map.set(m[1], { ats: m[2], slug: m[3] });
  return map;
}

function readAllCompanies() {
  const source = fs.readFileSync(REFRESH_SCRIPT, "utf8");
  const match = source.match(/const\s+ALL_COMPANIES\s*=\s*\[\s*\.\.\.\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)\s*\]/);
  if (!match) return [];
  const names = [];
  const namePattern = /"([^"]+)"/g;
  let nm;
  while ((nm = namePattern.exec(match[1])) !== null) names.push(nm[1]);
  return names;
}

function writeAtsMapEntry(companyName, atsCode, slug) {
  const source = fs.readFileSync(REFRESH_SCRIPT, "utf8");

  // Find the closing of ATS_MAP
  const mapStart = source.indexOf("const ATS_MAP = {");
  if (mapStart === -1) throw new Error("ATS_MAP not found in refresh-jobs.js");

  // Find the closing brace+semicolon
  let depth = 0;
  let mapEnd = -1;
  for (let i = mapStart + 17; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) { mapEnd = i; break; }
    }
  }
  if (mapEnd === -1) throw new Error("Could not find end of ATS_MAP");

  // Check if entry already exists
  const entryPattern = new RegExp(`"${companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\{`);
  if (entryPattern.test(source.substring(mapStart, mapEnd))) {
    return false; // already exists
  }

  // Insert before the closing brace
  const entry = `,"${companyName}":{ats:"${atsCode}",slug:"${slug}"}`;
  const newSource = source.substring(0, mapEnd) + entry + source.substring(mapEnd);
  fs.writeFileSync(REFRESH_SCRIPT, newSource);
  return true;
}

function verifyAtsMapCount() {
  return readAtsMap().size;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function generateSlugs(companyName) {
  const slugs = new Set();
  const clean = companyName.toLowerCase().trim();
  const alpha = clean.replace(/[^a-z0-9\s]/g, "");
  const words = alpha.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const strips = ["ai","inc","co","io","hq","labs","tech","technologies","software","systems","consulting","solutions","health","robotics","computing"];

  // Core
  slugs.add(words.join(""));
  slugs.add(words.join("-"));
  slugs.add(words[0]);
  slugs.add(words.join("_"));

  // Suffix-stripped
  const core = words.filter(w => !strips.includes(w));
  if (core.length > 0 && core.length < words.length) {
    slugs.add(core.join(""));
    slugs.add(core.join("-"));
    if (core.length > 1) slugs.add(core[0]);
  }

  // Common suffixes
  slugs.add(words.join("") + "inc");
  slugs.add(words.join("") + "hq");
  slugs.add(words.join("") + "careers");
  slugs.add(words.join("") + "jobs");

  // Handle dots
  if (companyName.includes(".")) {
    slugs.add(clean.replace(/\./g, "").replace(/[^a-z0-9]/g, ""));
    slugs.add(clean.split(".")[0].replace(/[^a-z0-9]/g, ""));
  }

  // Handle &
  if (companyName.includes("&")) {
    const andWords = clean.replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    slugs.add(andWords.join(""));
    slugs.add(andWords.join("-"));
  }

  // Domain-based slug (often the best guess)
  const domain = DOMAINS[companyName];
  if (domain) {
    const domainBase = domain.split(".")[0];
    slugs.add(domainBase);
  }

  return [...slugs].filter(s => s.length > 0 && s.length <= 60);
}

// ---------------------------------------------------------------------------
// ATS API probers
// ---------------------------------------------------------------------------

async function probeGreenhouse(slug) {
  try {
    const r = await fetchOk(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const d = await r.json();
    const jobs = d.jobs || [];
    return { ats: "gh", slug, jobCount: jobs.length, samples: jobs.slice(0, 3).map(j => j.title) };
  } catch { return null; }
}

async function probeAshby(slug) {
  try {
    const r = await fetchOk(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const d = await r.json();
    const jobs = d.jobs || [];
    return { ats: "ab", slug, jobCount: jobs.length, samples: jobs.slice(0, 3).map(j => j.title) };
  } catch { return null; }
}

async function probeLever(slug) {
  try {
    const r = await fetchOk(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d)) return null;
    return { ats: "lv", slug, jobCount: d.length, samples: d.slice(0, 3).map(j => j.text) };
  } catch { return null; }
}

async function probeRecruitee(slug) {
  try {
    const r = await fetchOk(`https://${slug}.recruitee.com/api/offers`);
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const d = await r.json();
    const offers = d.offers || [];
    return { ats: "rc", slug, jobCount: offers.length, samples: offers.slice(0, 3).map(j => j.title) };
  } catch { return null; }
}

async function probeWorkday(tenant, dataCenter, site) {
  try {
    const apiUrl = `https://${tenant}.${dataCenter}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
    const r = await fetchOk(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: "" }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      ats: "wd",
      slug: `${tenant}|${dataCenter}|${site}`,
      tenant, dataCenter, site, apiUrl,
      jobCount: d.total || 0,
      samples: (d.jobPostings || []).slice(0, 3).map(j => j.title),
    };
  } catch { return null; }
}

const PROBERS = [
  { name: "Greenhouse", code: "gh", probe: probeGreenhouse },
  { name: "Ashby", code: "ab", probe: probeAshby },
  { name: "Lever", code: "lv", probe: probeLever },
  { name: "Recruitee", code: "rc", probe: probeRecruitee },
];

// ---------------------------------------------------------------------------
// Career page fetching & fingerprinting
// ---------------------------------------------------------------------------

async function fetchCareerPage(companyName) {
  const domain = DOMAINS[companyName];
  if (!domain) return null;

  const candidates = [
    `https://www.${domain}/careers`,
    `https://www.${domain}/careers/`,
    `https://www.${domain}/jobs`,
    `https://careers.${domain}`,
    `https://www.${domain}/about/careers`,
    `https://www.${domain}/company/careers`,
    `https://${domain}/careers`,
  ];

  for (const url of candidates) {
    try {
      const r = await fetchOk(url, {}, 8000);
      if (r.ok) {
        const html = await r.text();
        if (html.length > 3000) return { url: r.url, html };
      }
    } catch { /* next */ }
    await sleep(DELAY_MS);
  }
  return null;
}

function fingerprintHtml(html) {
  const lower = html.toLowerCase();
  const results = [];

  // Greenhouse
  if (lower.includes("greenhouse.io") || lower.includes("grnh.se") || lower.includes("grnhse_app")) {
    const m = html.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9-]+)/i)
           || html.match(/greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9-]+)/i);
    results.push({ platform: "Greenhouse", code: "gh", slug: m ? m[1].toLowerCase() : null });
  }

  // Ashby
  if (lower.includes("ashbyhq.com")) {
    const m = html.match(/jobs\.ashbyhq\.com\/([a-z0-9-]+)/i)
           || html.match(/api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9-]+)/i);
    results.push({ platform: "Ashby", code: "ab", slug: m ? m[1].toLowerCase() : null });
  }

  // Lever
  if (lower.includes("lever.co")) {
    const m = html.match(/(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9-]+)/i);
    results.push({ platform: "Lever", code: "lv", slug: m ? m[1].toLowerCase() : null });
  }

  // Recruitee
  if (lower.includes("recruitee.com")) {
    const m = html.match(/([a-z0-9-]+)\.recruitee\.com/i);
    results.push({ platform: "Recruitee", code: "rc", slug: m ? m[1].toLowerCase() : null });
  }

  // Workday
  if (lower.includes("myworkdayjobs.com") || lower.includes("myworkdaysite.com")) {
    const m = html.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([a-z0-9_-]+)/i);
    if (m) {
      results.push({
        platform: "Workday", code: "wd",
        slug: null,
        workday: { tenant: m[1].toLowerCase(), dataCenter: m[2].toLowerCase(), site: m[3].toLowerCase() },
      });
    }
  }

  // Unsupported platforms (detect but can't fetch)
  if (lower.includes("icims.com")) results.push({ platform: "iCIMS", code: "ic", slug: null, unsupported: true });
  if (lower.includes("bamboohr.com")) results.push({ platform: "BambooHR", code: "bb", slug: null, unsupported: true });
  if (lower.includes("taleo.net")) results.push({ platform: "Taleo", code: "ta", slug: null, unsupported: true });
  if (lower.includes("successfactors")) results.push({ platform: "SuccessFactors", code: "sf", slug: null, unsupported: true });
  if (lower.includes("workable.com")) results.push({ platform: "Workable", code: "wk", slug: null, unsupported: true });

  return results;
}

// ---------------------------------------------------------------------------
// False positive check
// ---------------------------------------------------------------------------

function isFalsePositive(companyName, samples) {
  if (!samples || samples.length === 0) return false;

  // Check if sample roles are obviously from a different company/industry
  const companyLower = companyName.toLowerCase();
  const sampleText = samples.join(" ").toLowerCase();

  // Known false positive patterns from previous discovery runs
  const suspiciousPatterns = [
    // Hospitality jobs for a tech company
    { companies: ["clay"], patterns: ["restaurant", "hospitality", "chef", "bartender", "loft house"] },
    // Aerospace for a data company
    { companies: ["vast data"], patterns: ["astronaut", "avionics", "spacecraft"] },
    // Construction training for a payments company
    { companies: ["bolt"], patterns: ["construction.*trainer", "assessor", "learning mentor"] },
  ];

  for (const check of suspiciousPatterns) {
    if (check.companies.some(c => companyLower.includes(c))) {
      if (check.patterns.some(p => new RegExp(p, "i").test(sampleText))) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Process one company
// ---------------------------------------------------------------------------

async function processCompany(companyName) {
  const result = {
    company: companyName,
    careersUrl: null,
    method: null,       // "fingerprint", "brute_force", "workday"
    platform: null,
    atsCode: null,
    slug: null,
    jobCount: 0,
    samples: [],
    workday: null,      // { tenant, dataCenter, site, apiUrl } for Workday companies
    unsupported: null,   // platform name if detected but unsupported
    status: null,        // "mapped", "workday_mapped", "unsupported", "no_career_page", "no_match", "false_positive"
    error: null,
  };

  // Step 1: Fetch career page
  const page = await fetchCareerPage(companyName);

  if (!page) {
    result.status = "no_career_page";
    result.error = "Could not find career page. Add domain to DOMAINS map.";
    return result;
  }

  result.careersUrl = page.url;

  // Step 2: Fingerprint
  const fingerprints = fingerprintHtml(page.html);

  // Step 3: Handle Workday
  const workdayFp = fingerprints.find(f => f.code === "wd" && f.workday);
  if (workdayFp) {
    const wd = workdayFp.workday;
    await sleep(DELAY_MS);
    const validated = await probeWorkday(wd.tenant, wd.dataCenter, wd.site);
    if (validated && validated.jobCount > 0) {
      result.method = "workday";
      result.platform = "Workday";
      result.atsCode = "wd";
      result.workday = { tenant: wd.tenant, dataCenter: wd.dataCenter, site: wd.site, apiUrl: validated.apiUrl };
      result.jobCount = validated.jobCount;
      result.samples = validated.samples;
      result.status = "workday_mapped";
      return result;
    }
  }

  // Step 4: Handle unsupported platforms
  const unsupportedFp = fingerprints.find(f => f.unsupported);
  if (unsupportedFp && fingerprints.every(f => f.unsupported || (f.code === "wd" && !f.workday))) {
    // Only unsupported platforms detected, no supported ones
    result.platform = unsupportedFp.platform;
    result.unsupported = unsupportedFp.platform;
    result.status = "unsupported";
    return result;
  }

  // Step 5: Try supported platforms — fingerprint slug first, then brute force

  // 5a: If fingerprint extracted a slug for a supported platform, validate it
  for (const fp of fingerprints.filter(f => f.slug && !f.unsupported && f.code !== "wd")) {
    const prober = PROBERS.find(p => p.code === fp.code);
    if (!prober) continue;
    await sleep(DELAY_MS);
    const validated = await prober.probe(fp.slug);
    if (validated && validated.jobCount > 0) {
      if (isFalsePositive(companyName, validated.samples)) {
        result.status = "false_positive";
        result.error = `Slug "${fp.slug}" returned jobs from wrong company: ${validated.samples.join(", ")}`;
        continue;
      }
      result.method = "fingerprint";
      result.platform = prober.name;
      result.atsCode = fp.code;
      result.slug = fp.slug;
      result.jobCount = validated.jobCount;
      result.samples = validated.samples;
      result.status = "mapped";
      return result;
    }
  }

  // 5b: If fingerprint found a platform but couldn't extract slug, brute force that platform only
  for (const fp of fingerprints.filter(f => !f.slug && !f.unsupported && f.code !== "wd")) {
    const prober = PROBERS.find(p => p.code === fp.code);
    if (!prober) continue;
    const slugs = generateSlugs(companyName);
    for (const slug of slugs) {
      await sleep(DELAY_MS);
      const validated = await prober.probe(slug);
      if (validated && validated.jobCount > 0) {
        if (isFalsePositive(companyName, validated.samples)) continue;
        result.method = "brute_force_targeted";
        result.platform = prober.name;
        result.atsCode = fp.code;
        result.slug = slug;
        result.jobCount = validated.jobCount;
        result.samples = validated.samples;
        result.status = "mapped";
        return result;
      }
    }
  }

  // Step 6: No fingerprint or fingerprint failed — brute force all supported platforms
  if (fingerprints.length === 0 || fingerprints.every(f => f.unsupported)) {
    const slugs = generateSlugs(companyName);
    for (const prober of PROBERS) {
      for (const slug of slugs) {
        await sleep(DELAY_MS);
        const validated = await prober.probe(slug);
        if (validated && validated.jobCount > 0) {
          if (isFalsePositive(companyName, validated.samples)) continue;
          result.method = "brute_force_all";
          result.platform = prober.name;
          result.atsCode = validated.ats;
          result.slug = slug;
          result.jobCount = validated.jobCount;
          result.samples = validated.samples;
          result.status = "mapped";
          return result;
        }
        // If found board but 0 jobs, note it but keep searching
        if (validated && validated.jobCount === 0) {
          if (!result.slug) {
            result.platform = prober.name;
            result.atsCode = validated.ats;
            result.slug = slug;
            result.jobCount = 0;
            result.method = "brute_force_all";
            // Don't return — keep searching for one with jobs
          }
        }
      }
    }
  }

  // If we found a 0-job board, report it
  if (result.slug && result.jobCount === 0) {
    result.status = "mapped_zero_jobs";
    return result;
  }

  // If unsupported was detected earlier alongside the failed search
  if (unsupportedFp) {
    result.platform = unsupportedFp.platform;
    result.unsupported = unsupportedFp.platform;
    result.status = "unsupported";
    return result;
  }

  result.status = "no_match";
  result.error = page.html.length < 10000
    ? "JS-rendered page (<10KB). ATS loaded client-side — fingerprinting missed it."
    : "No ATS detected in HTML and no slug matched any supported platform.";
  return result;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function generateReport(results, startCount, endCount) {
  const lines = [];
  const div = "=".repeat(80);
  const thin = "-".repeat(80);

  lines.push(div);
  lines.push("  ASCENT UNIFIED ATS PIPELINE REPORT");
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push(`  Companies processed: ${results.length}`);
  lines.push(`  ATS_MAP: ${startCount} → ${endCount} entries`);
  lines.push(div);

  const mapped = results.filter(r => r.status === "mapped");
  const workday = results.filter(r => r.status === "workday_mapped");
  const zeroJobs = results.filter(r => r.status === "mapped_zero_jobs");
  const unsupported = results.filter(r => r.status === "unsupported");
  const noMatch = results.filter(r => r.status === "no_match");
  const noPage = results.filter(r => r.status === "no_career_page");
  const falsePos = results.filter(r => r.status === "false_positive");

  lines.push("\n  SUMMARY");
  lines.push(thin);
  lines.push(`  Mapped (supported ATS):       ${mapped.length}`);
  lines.push(`  Mapped (Workday, needs fetcher): ${workday.length}`);
  lines.push(`  Mapped (0 jobs):              ${zeroJobs.length}`);
  lines.push(`  Unsupported platform:         ${unsupported.length}`);
  lines.push(`  No ATS detected:              ${noMatch.length}`);
  lines.push(`  No career page found:         ${noPage.length}`);
  lines.push(`  False positives blocked:      ${falsePos.length}`);

  // Platform distribution
  const platCounts = {};
  for (const r of results) {
    const p = r.platform || r.unsupported || "Unknown";
    platCounts[p] = (platCounts[p] || 0) + 1;
  }
  lines.push("\n  PLATFORM DISTRIBUTION");
  lines.push(thin);
  for (const [p, c] of Object.entries(platCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${p.padEnd(20)} ${c} companies`);
  }

  // Mapped — written to ATS_MAP
  if (mapped.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push(`  WRITTEN TO ATS_MAP: ${mapped.length} new mappings`);
    lines.push(`${"█".repeat(80)}`);
    for (const r of mapped.sort((a, b) => b.jobCount - a.jobCount)) {
      lines.push(`\n  ${r.company}`);
      lines.push(`    ${r.platform} (${r.atsCode})  |  "${r.slug}"  |  ${r.jobCount} jobs  |  via ${r.method}`);
      if (r.samples.length) lines.push(`    Sample: ${r.samples.join(", ")}`);
    }
  }

  // Workday
  if (workday.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push(`  WORKDAY: ${workday.length} companies (needs fetchWorkday)`);
    lines.push(`${"█".repeat(80)}`);
    for (const r of workday.sort((a, b) => b.jobCount - a.jobCount)) {
      lines.push(`\n  ${r.company}  |  ${r.jobCount} jobs`);
      lines.push(`    Tenant: ${r.workday.tenant}  |  DC: ${r.workday.dataCenter}  |  Site: ${r.workday.site}`);
      lines.push(`    API: ${r.workday.apiUrl}`);
      if (r.samples.length) lines.push(`    Sample: ${r.samples.join(", ")}`);
    }
  }

  // Zero jobs
  if (zeroJobs.length > 0) {
    lines.push(`\n\n${thin}`);
    lines.push(`  MAPPED BUT 0 JOBS: ${zeroJobs.length} companies`);
    lines.push(thin);
    for (const r of zeroJobs) {
      lines.push(`  ${r.company.padEnd(35)} ${r.platform}/${r.slug}`);
    }
  }

  // Unsupported
  if (unsupported.length > 0) {
    lines.push(`\n\n${thin}`);
    lines.push(`  UNSUPPORTED PLATFORM: ${unsupported.length} companies`);
    lines.push(thin);
    for (const r of unsupported.sort((a, b) => (a.platform || "").localeCompare(b.platform || ""))) {
      lines.push(`  ${r.company.padEnd(35)} ${r.platform.padEnd(18)} ${r.careersUrl || "—"}`);
    }
  }

  // No match + no page
  const unresolved = [...noMatch, ...noPage];
  if (unresolved.length > 0) {
    lines.push(`\n\n${thin}`);
    lines.push(`  UNRESOLVED: ${unresolved.length} companies`);
    lines.push(thin);
    for (const r of unresolved.sort((a, b) => a.company.localeCompare(b.company))) {
      const reason = r.status === "no_career_page" ? "no career page" : (r.error || "no match").substring(0, 50);
      lines.push(`  ${r.company.padEnd(35)} ${reason}`);
    }
  }

  // False positives
  if (falsePos.length > 0) {
    lines.push(`\n\n${thin}`);
    lines.push(`  FALSE POSITIVES BLOCKED: ${falsePos.length}`);
    lines.push(thin);
    for (const r of falsePos) {
      lines.push(`  ${r.company}: ${r.error}`);
    }
  }

  lines.push(`\n\n${div}`);
  lines.push("  END OF REPORT");
  lines.push(div);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const resumeMode = args.includes("--resume");
  const singleIdx = args.indexOf("--company");
  const singleCompany = singleIdx >= 0 ? args[singleIdx + 1] : null;

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║       ASCENT UNIFIED ATS PIPELINE v1.0              ║");
  console.log("  ╚══════════════════════════════════════════════════════╝\n");

  if (!fs.existsSync(REFRESH_SCRIPT)) {
    console.error("  ✗ scripts/refresh-jobs.js not found. Run from C:\\ascent.");
    process.exit(1);
  }

  const atsMap = readAtsMap();
  const allCompanies = readAllCompanies();
  const startCount = atsMap.size;

  console.log(`  ATS_MAP: ${startCount} entries`);
  console.log(`  ALL_COMPANIES: ${allCompanies.length}`);
  console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE (writes to refresh-jobs.js)"}\n`);

  let queue = [];
  let completed = [];

  if (singleCompany) {
    queue = [singleCompany];
    console.log(`  Target: "${singleCompany}"\n`);
  } else if (resumeMode) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    completed = cp.completedResults;
    queue = cp.remainingCompanies;
    console.log(`  Resuming: ${queue.length} remaining\n`);
  } else {
    queue = allCompanies.filter(name => !atsMap.has(name));
    console.log(`  Unmapped companies: ${queue.length}\n`);
  }

  console.log(`  Starting...\n`);

  let newMappings = 0;

  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    const progress = `[${completed.length + i + 1}/${completed.length + queue.length}]`;
    process.stdout.write(`  ${progress} ${name.padEnd(35)} `);

    try {
      const result = await processCompany(name);
      completed.push(result);

      if (result.status === "mapped" && result.atsCode && result.slug) {
        if (!dryRun) {
          const wrote = writeAtsMapEntry(name, result.atsCode, result.slug);
          if (wrote) newMappings++;
        }
        console.log(`★ ${result.platform}/"${result.slug}" (${result.jobCount} jobs) [${result.method}]`);
      } else if (result.status === "workday_mapped") {
        console.log(`⚙ Workday/${result.workday.tenant} (${result.jobCount} jobs)`);
      } else if (result.status === "mapped_zero_jobs") {
        console.log(`○ ${result.platform}/"${result.slug}" (0 jobs)`);
      } else if (result.status === "unsupported") {
        console.log(`▪ ${result.platform}`);
      } else if (result.status === "false_positive") {
        console.log(`✗ false positive blocked`);
      } else if (result.status === "no_career_page") {
        console.log(`✗ no career page`);
      } else {
        console.log(`✗ ${result.error ? result.error.substring(0, 50) : "no match"}`);
      }

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      completed.push({ company: name, status: "error", error: err.message });
    }

    // Checkpoint
    if ((i + 1) % CHECKPOINT_EVERY === 0 && i + 1 < queue.length) {
      fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
        completedResults: completed,
        remainingCompanies: queue.slice(i + 1),
      }, null, 2));
      console.log(`  --- checkpoint (${completed.length} done) ---`);
    }

    if (i + 1 < queue.length) await sleep(COMPANY_DELAY_MS);
  }

  // Verify
  const endCount = verifyAtsMapCount();

  console.log("\n  Pipeline complete.\n");

  if (!dryRun && newMappings > 0) {
    const expectedCount = startCount + newMappings;
    if (endCount === expectedCount) {
      console.log(`  ✓ VERIFIED: ATS_MAP ${startCount} → ${endCount} (${newMappings} added)`);
    } else {
      console.log(`  ⚠ COUNT MISMATCH: expected ${expectedCount}, got ${endCount}. Check refresh-jobs.js manually.`);
    }
  } else if (dryRun) {
    console.log(`  DRY RUN: ${completed.filter(r => r.status === "mapped").length} mappings found, not written.`);
  } else {
    console.log(`  No new supported-ATS mappings found.`);
  }

  // Report
  const report = generateReport(completed, startCount, endCount);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`  ✓ Report: ${REPORT_PATH}`);

  // Cleanup checkpoint
  if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);

  // Summary
  const mapped = completed.filter(r => r.status === "mapped").length;
  const wd = completed.filter(r => r.status === "workday_mapped").length;
  const unsup = completed.filter(r => r.status === "unsupported").length;
  const unres = completed.filter(r => ["no_match", "no_career_page", "error"].includes(r.status)).length;

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║               PIPELINE SUMMARY                      ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║  Written to ATS_MAP:          ${String(mapped).padStart(4)}                    ║`);
  console.log(`  ║  Workday (needs fetcher):     ${String(wd).padStart(4)}                    ║`);
  console.log(`  ║  Unsupported platform:        ${String(unsup).padStart(4)}                    ║`);
  console.log(`  ║  Unresolved:                  ${String(unres).padStart(4)}                    ║`);
  console.log(`  ║  ATS_MAP total:          ${String(startCount).padStart(4)} → ${String(endCount).padStart(4)}                ║`);
  console.log("  ╚══════════════════════════════════════════════════════╝\n");

  if (!dryRun && newMappings > 0) {
    console.log("  Next: verify, commit, push:");
    console.log("    git add scripts/refresh-jobs.js");
    console.log(`    git commit -m "ATS_MAP: ${newMappings} new mappings via unified pipeline"`);
    console.log("    git push\n");
  }
}

main().catch(e => { console.error(`\n  Fatal: ${e.message}`); process.exit(1); });
