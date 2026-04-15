#!/usr/bin/env node

/**
 * Ascent ATS Classifier
 * 
 * Production-grade tool for classifying company career pages by ATS platform,
 * extracting connection details, and validating against live APIs.
 * 
 * This is the canonical way to onboard new companies to Ascent. It replaces
 * manual career page inspection with automated, repeatable classification.
 * 
 * Usage:
 *   node classify-ats.js                          — Classify all unclassified companies
 *   node classify-ats.js --all                    — Reclassify everything (including ATS-mapped)
 *   node classify-ats.js --company "CrowdStrike"  — Classify a single company
 *   node classify-ats.js --add "Acme Corp" "https://acme.com/careers"
 *                                                 — Add a company with its career URL and classify
 *   node classify-ats.js --resume                 — Resume from checkpoint
 * 
 * Input:
 *   - scripts/refresh-jobs.js   — reads ALL_COMPANIES and ATS_MAP automatically
 *   - careers-urls.json         — career page URL registry (created/updated by this script)
 * 
 * Output:
 *   - ats-classification-results.json   — full structured results
 *   - ats-classification-report.txt     — human-readable report with ATS_MAP entries
 *   - careers-urls.json                 — updated with discovered career URLs
 * 
 * Run from Ascent project root (C:\ascent). No external dependencies.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = 15000;
const DELAY_BETWEEN_COMPANIES = 800;
const DELAY_BETWEEN_REQUESTS = 300;
const CHECKPOINT_INTERVAL = 10;

const RESULTS_PATH = path.join(process.cwd(), "ats-classification-results.json");
const REPORT_PATH = path.join(process.cwd(), "ats-classification-report.txt");
const CHECKPOINT_PATH = path.join(process.cwd(), "ats-classification-checkpoint.json");
const CAREERS_URLS_PATH = path.join(process.cwd(), "careers-urls.json");
const REFRESH_SCRIPT_PATH = path.join(process.cwd(), "scripts", "refresh-jobs.js");

// ---------------------------------------------------------------------------
// Known company domains — used when no career URL is in the registry.
// Maps company name → domain. The classifier tries /careers, /jobs, etc.
// Add new companies here or via --add flag + careers-urls.json.
// ---------------------------------------------------------------------------

const KNOWN_DOMAINS = {
  "Accrual": "accrual.com",
  "Adept AI": "adept.ai",
  "Aisera": "aisera.com",
  "Alto Pharmacy": "alto.com",
  "Arctic Wolf": "arcticwolf.com",
  "Bain & Company": "bain.com",
  "Base44": "base44.com",
  "Basis": "basis.com",
  "Billd": "billd.com",
  "BlackLine": "blackline.com",
  "Board International": "board.com",
  "Bolt": "bolt.com",
  "Box": "box.com",
  "Bryant Park Consulting": "bryantparkconsulting.com",
  "Built Technologies": "getbuilt.com",
  "Canva": "canva.com",
  "Character AI": "character.ai",
  "Clay": "clay.com",
  "Coactive AI": "coactive.ai",
  "Codeium": "codeium.com",
  "Cognigy": "cognigy.com",
  "Commonwealth Fusion": "cfs.energy",
  "Corebridge Financial": "corebridgefinancial.com",
  "Credo AI": "credo.ai",
  "CrewAI": "crewai.com",
  "Cribl": "cribl.io",
  "CrowdStrike": "crowdstrike.com",
  "Cursor": "cursor.com",
  "Cyera": "cyera.io",
  "Darwinbox": "darwinbox.com",
  "Dataiku": "dataiku.com",
  "dbt Labs": "getdbt.com",
  "Deepnote": "deepnote.com",
  "DevRev": "devrev.ai",
  "Devoted Health": "devoted.com",
  "Docusign": "docusign.com",
  "Domo": "domo.com",
  "DualEntry": "dualentry.com",
  "Echo Park Consulting": "echoparkconsulting.com",
  "Findigs": "findigs.com",
  "Flatfile": "flatfile.com",
  "Flock Safety": "flocksafety.com",
  "Flutterwave": "flutterwave.com",
  "Freshworks": "freshworks.com",
  "Gecko Robotics": "geckorobotics.com",
  "Genspark": "genspark.ai",
  "Giga": "giga.io",
  "GitLab": "gitlab.com",
  "Grammarly": "grammarly.com",
  "Graphiant": "graphiant.com",
  "Groq": "groq.com",
  "Harness": "harness.io",
  "HashiCorp": "hashicorp.com",
  "Hex": "hex.tech",
  "Hinge Health": "hingehealth.com",
  "Hippocratic AI": "hippocratic.ai",
  "HubSpot": "hubspot.com",
  "Hugging Face": "huggingface.co",
  "ICON 3D": "iconbuild.com",
  "Ironclad": "ironcladhq.com",
  "Island": "island.io",
  "Jasper": "jasper.ai",
  "Jedox": "jedox.com",
  "Klarna": "klarna.com",
  "Kong": "konghq.com",
  "Kore.ai": "kore.ai",
  "Light": "light.co",
  "Luminance": "luminance.com",
  "MainFunc": "mainfunc.ai",
  "Midjourney": "midjourney.com",
  "Miro": "miro.com",
  "Modular": "modular.com",
  "Monday.com": "monday.com",
  "Navan": "navan.com",
  "Nominal": "nominal.io",
  "Noom": "noom.com",
  "Northvolt": "northvolt.com",
  "Nuvei": "nuvei.com",
  "Omni Analytics": "omni.co",
  "OneStream": "onestream.com",
  "Orb": "withorb.com",
  "Oscar Health": "hioscar.com",
  "Outreach": "outreach.io",
  "Peec AI": "peec.ai",
  "Pega": "pega.com",
  "Perplexity AI": "perplexity.ai",
  "Planful": "planful.com",
  "Pluralsight": "pluralsight.com",
  "Procore": "procore.com",
  "Pyramid Analytics": "pyramidanalytics.com",
  "Relativity Space": "relativityspace.com",
  "Resolve AI": "resolve.ai",
  "Retell AI": "retellai.com",
  "Revolut": "revolut.com",
  "Rippling": "rippling.com",
  "Runway Financial": "runway.com",
  "SambaNova": "sambanova.ai",
  "ScaleOps": "scaleops.com",
  "Seismic": "seismic.com",
  "SentinelOne": "sentinelone.com",
  "ServiceNow": "servicenow.com",
  "Shopify": "shopify.com",
  "Sigma Computing": "sigmacomputing.com",
  "Skild AI": "skild.ai",
  "Snyk": "snyk.io",
  "Synthflow AI": "synthflow.ai",
  "Tabs": "tabs.inc",
  "Tempus AI": "tempus.com",
  "Thinking Machines Lab": "thinkingmachines.ai",
  "ThoughtSpot": "thoughtspot.com",
  "Together AI": "together.ai",
  "Tome": "tome.app",
  "Trader Joe's": "traderjoes.com",
  "Tropic": "tropicapp.io",
  "VAST Data": "vastdata.com",
  "Vena Solutions": "venasolutions.com",
  "Weights & Biases": "wandb.ai",
  "Wise": "wise.com",
  "Wiz": "wiz.io",
  "Wolters Kluwer": "wolterskluwer.com",
  "World Wide Technology": "wwt.com",
};

// ---------------------------------------------------------------------------
// ATS Platform Definitions
// ---------------------------------------------------------------------------

/**
 * Each platform definition includes:
 * - name: human-readable platform name
 * - code: short code for ATS_MAP (gh, ab, lv, rc, wd, ic, sr, bb)
 * - supported: whether we have a fetcher for this platform in refresh-jobs.js
 * - fingerprints: strings to search for in career page HTML
 * - extractSlug: function to extract connection details from HTML
 * - validate: function to test the extracted details against the live API
 */
const ATS_PLATFORMS = [
  {
    name: "Greenhouse",
    code: "gh",
    supported: true,
    fingerprints: [
      "boards.greenhouse.io",
      "boards-api.greenhouse.io",
      "grnh.se",
      "grnhse_app",
      "greenhouse.io/embed",
    ],
    extractSlug(html) {
      // Try boards URL first: boards.greenhouse.io/{slug}
      const boardMatch = html.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9-]+)/i);
      if (boardMatch) return boardMatch[1].toLowerCase();
      // Try grnh.se redirect links
      const grnhMatch = html.match(/grnh\.se\/([a-z0-9]+)/i);
      if (grnhMatch) return null; // grnh.se links are job-level, not board-level
      // Try embed script
      const embedMatch = html.match(/greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9-]+)/i);
      if (embedMatch) return embedMatch[1].toLowerCase();
      return null;
    },
    async validate(slug) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        const jobs = data.jobs || [];
        return {
          valid: true,
          jobCount: jobs.length,
          sampleTitles: jobs.slice(0, 3).map(j => j.title),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "Ashby",
    code: "ab",
    supported: true,
    fingerprints: [
      "ashbyhq.com",
      "jobs.ashbyhq.com",
      "api.ashbyhq.com",
    ],
    extractSlug(html) {
      // jobs.ashbyhq.com/{slug} or api.ashbyhq.com/posting-api/job-board/{slug}
      const jobsMatch = html.match(/jobs\.ashbyhq\.com\/([a-z0-9-]+)/i);
      if (jobsMatch && jobsMatch[1] !== "api") return jobsMatch[1].toLowerCase();
      const apiMatch = html.match(/api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9-]+)/i);
      if (apiMatch) return apiMatch[1].toLowerCase();
      return null;
    },
    async validate(slug) {
      try {
        const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        const jobs = data.jobs || [];
        return {
          valid: true,
          jobCount: jobs.length,
          sampleTitles: jobs.slice(0, 3).map(j => j.title),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "Lever",
    code: "lv",
    supported: true,
    fingerprints: [
      "lever.co",
      "jobs.lever.co",
      "api.lever.co",
    ],
    extractSlug(html) {
      const match = html.match(/(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9-]+)/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate(slug) {
      try {
        const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        if (!Array.isArray(data)) return { valid: false, error: "Unexpected format" };
        return {
          valid: true,
          jobCount: data.length,
          sampleTitles: data.slice(0, 3).map(j => j.text),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "Recruitee",
    code: "rc",
    supported: true,
    fingerprints: [
      "recruitee.com",
    ],
    extractSlug(html) {
      const match = html.match(/([a-z0-9-]+)\.recruitee\.com/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate(slug) {
      try {
        const url = `https://${slug}.recruitee.com/api/offers`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        const offers = data.offers || [];
        return {
          valid: true,
          jobCount: offers.length,
          sampleTitles: offers.slice(0, 3).map(j => j.title),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "Workday",
    code: "wd",
    supported: false, // fetcher not yet built — this classifier identifies them for Phase 2
    fingerprints: [
      "myworkdayjobs.com",
      "myworkdaysite.com",
      "wd1.myworkday",
      "wd2.myworkday",
      "wd3.myworkday",
      "wd5.myworkday",
    ],
    extractSlug(html) {
      // Pattern: https://{tenant}.wd{N}.myworkdayjobs.com/{locale}/{site}
      const match = html.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([a-z0-9_-]+)/i);
      if (match) {
        return {
          tenant: match[1].toLowerCase(),
          dataCenter: match[2].toLowerCase(),
          site: match[3].toLowerCase(),
          apiUrl: `https://${match[1].toLowerCase()}.${match[2].toLowerCase()}.myworkdayjobs.com/wday/cxs/${match[1].toLowerCase()}/${match[3].toLowerCase()}/jobs`,
        };
      }
      // Alternative: jobs.myworkdaysite.com/recruiting/{tenant}/{site}
      const altMatch = html.match(/jobs\.myworkdaysite\.com\/recruiting\/([a-z0-9-]+)\/([a-z0-9_-]+)/i);
      if (altMatch) {
        return {
          tenant: altMatch[1].toLowerCase(),
          dataCenter: "unknown",
          site: altMatch[2].toLowerCase(),
          apiUrl: null, // need to discover the wd{N} portion
        };
      }
      return null;
    },
    async validate(slugData) {
      if (!slugData || !slugData.apiUrl) return { valid: false, error: "No API URL" };
      try {
        const response = await fetchWithTimeout(slugData.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: "" }),
        });
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        return {
          valid: true,
          jobCount: data.total || 0,
          sampleTitles: (data.jobPostings || []).slice(0, 3).map(j => j.title),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "iCIMS",
    code: "ic",
    supported: false,
    fingerprints: [
      "icims.com",
      "careers-",
      ".icims.",
    ],
    extractSlug(html) {
      // Pattern: careers-{company}.icims.com or {company}.icims-se.com
      const match = html.match(/(?:careers-)?([a-z0-9-]+)\.icims\.com/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate() { return { valid: false, error: "iCIMS validation not implemented — no public API" }; },
  },
  {
    name: "SmartRecruiters",
    code: "sr",
    supported: false,
    fingerprints: [
      "smartrecruiters.com",
      "jobs.smartrecruiters.com",
    ],
    extractSlug(html) {
      const match = html.match(/jobs\.smartrecruiters\.com\/([a-zA-Z0-9-]+)/i);
      if (match) return match[1];
      return null;
    },
    async validate(slug) {
      if (!slug) return { valid: false, error: "No slug" };
      try {
        const url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        const jobs = data.content || [];
        return {
          valid: true,
          jobCount: data.totalFound || jobs.length,
          sampleTitles: jobs.slice(0, 3).map(j => j.name),
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "BambooHR",
    code: "bb",
    supported: false,
    fingerprints: [
      "bamboohr.com",
    ],
    extractSlug(html) {
      const match = html.match(/([a-z0-9-]+)\.bamboohr\.com/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate(slug) {
      if (!slug) return { valid: false, error: "No slug" };
      try {
        const url = `https://${slug}.bamboohr.com/careers/list`;
        const response = await fetchWithTimeout(url);
        return { valid: response.ok, jobCount: null, error: response.ok ? null : `HTTP ${response.status}` };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    },
  },
  {
    name: "Taleo",
    code: "ta",
    supported: false,
    fingerprints: [
      "taleo.net",
      "oracle.com/taleo",
      "taleoportal",
    ],
    extractSlug() { return null; },
    async validate() { return { valid: false, error: "Taleo validation not implemented" }; },
  },
  {
    name: "SuccessFactors",
    code: "sf",
    supported: false,
    fingerprints: [
      "successfactors.com",
      "successfactors.eu",
      "sap.com/career",
    ],
    extractSlug() { return null; },
    async validate() { return { valid: false, error: "SuccessFactors validation not implemented" }; },
  },
  {
    name: "Jobvite",
    code: "jv",
    supported: false,
    fingerprints: [
      "jobvite.com",
      "jobs.jobvite.com",
    ],
    extractSlug(html) {
      const match = html.match(/jobs\.jobvite\.com\/([a-z0-9-]+)/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate() { return { valid: false, error: "Jobvite validation not implemented" }; },
  },
  {
    name: "JazzHR",
    code: "jz",
    supported: false,
    fingerprints: [
      "applytojob.com",
      "jazzhr.com",
    ],
    extractSlug(html) {
      const match = html.match(/([a-z0-9-]+)\.applytojob\.com/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate() { return { valid: false, error: "JazzHR validation not implemented" }; },
  },
  {
    name: "Rippling",
    code: "rp",
    supported: false,
    fingerprints: [
      "ats.rippling.com",
    ],
    extractSlug(html) {
      const match = html.match(/ats\.rippling\.com\/([a-z0-9-]+)/i);
      if (match) return match[1].toLowerCase();
      return null;
    },
    async validate() { return { valid: false, error: "Rippling ATS validation not implemented" }; },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        ...(options.headers || {}),
      },
      redirect: "follow",
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Source Data Extraction (from refresh-jobs.js)
// ---------------------------------------------------------------------------

function extractFromRefreshScript() {
  if (!fs.existsSync(REFRESH_SCRIPT_PATH)) {
    console.log(`  ⚠ ${REFRESH_SCRIPT_PATH} not found. Run from Ascent project root.`);
    return { atsMap: new Map(), allCompanies: [] };
  }

  const source = fs.readFileSync(REFRESH_SCRIPT_PATH, "utf8");

  // Extract ATS_MAP
  const atsMap = new Map();
  const mapPattern = /"([^"]+)"\s*:\s*\{\s*ats\s*:\s*"(\w+)"\s*,\s*slug\s*:\s*"([^"]+)"\s*\}/g;
  let match;
  while ((match = mapPattern.exec(source)) !== null) {
    atsMap.set(match[1], { ats: match[2], slug: match[3] });
  }

  // Extract ALL_COMPANIES
  const companiesMatch = source.match(/const\s+ALL_COMPANIES\s*=\s*\[\s*\.\.\.\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)\s*\]/);
  const allCompanies = [];
  if (companiesMatch) {
    const namePattern = /"([^"]+)"/g;
    let nameMatch;
    while ((nameMatch = namePattern.exec(companiesMatch[1])) !== null) {
      allCompanies.push(nameMatch[1]);
    }
  }

  console.log(`  ✓ Extracted ${atsMap.size} ATS_MAP entries and ${allCompanies.length} companies from refresh-jobs.js\n`);
  return { atsMap, allCompanies };
}

// ---------------------------------------------------------------------------
// Career URL Registry
// ---------------------------------------------------------------------------

function loadCareersUrls() {
  if (fs.existsSync(CAREERS_URLS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CAREERS_URLS_PATH, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCareersUrls(registry) {
  // Sort alphabetically for readability
  const sorted = Object.keys(registry).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const ordered = {};
  for (const key of sorted) {
    ordered[key] = registry[key];
  }
  fs.writeFileSync(CAREERS_URLS_PATH, JSON.stringify(ordered, null, 2));
}

/**
 * Discover a company's career page URL by trying common patterns.
 * Returns the first URL that responds with a 200 and >5KB of content.
 */
async function discoverCareersUrl(companyName) {
  const domain = KNOWN_DOMAINS[companyName];
  if (!domain) return null;

  const candidates = [
    `https://www.${domain}/careers`,
    `https://www.${domain}/careers/`,
    `https://www.${domain}/jobs`,
    `https://www.${domain}/jobs/`,
    `https://careers.${domain}`,
    `https://www.${domain}/about/careers`,
    `https://www.${domain}/company/careers`,
    `https://${domain}/careers`,
    `https://${domain}/jobs`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, {}, 8000);
      if (response.ok) {
        const text = await response.text();
        if (text.length > 5000) {
          return { url: response.url, contentLength: text.length, html: text };
        }
      }
    } catch {
      // try next
    }
    await sleep(DELAY_BETWEEN_REQUESTS);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Classification Engine
// ---------------------------------------------------------------------------

/**
 * Classify a single company's career page.
 * Returns: { company, careersUrl, platform, slug, validation, htmlLength, jsRendered }
 */
async function classifyCompany(companyName, careersUrl, html) {
  // If we don't have HTML yet, fetch the career page
  if (!html) {
    if (!careersUrl) {
      // Try to discover the career page
      const discovered = await discoverCareersUrl(companyName);
      if (!discovered) {
        return {
          company: companyName,
          careersUrl: null,
          platform: null,
          slug: null,
          validation: null,
          htmlLength: 0,
          jsRendered: false,
          status: "no_careers_url",
          error: "Could not discover career page URL. Add manually to careers-urls.json.",
        };
      }
      careersUrl = discovered.url;
      html = discovered.html;
    } else {
      try {
        const response = await fetchWithTimeout(careersUrl);
        if (!response.ok) {
          return {
            company: companyName,
            careersUrl,
            platform: null,
            slug: null,
            validation: null,
            htmlLength: 0,
            jsRendered: false,
            status: "fetch_failed",
            error: `HTTP ${response.status}`,
          };
        }
        html = await response.text();
        // Update careersUrl in case of redirect
        careersUrl = response.url;
      } catch (error) {
        return {
          company: companyName,
          careersUrl,
          platform: null,
          slug: null,
          validation: null,
          htmlLength: 0,
          jsRendered: false,
          status: "fetch_error",
          error: error.message,
        };
      }
    }
  }

  const htmlLength = html.length;
  const jsRendered = htmlLength < 10000; // very short HTML = likely JS-rendered shell

  // Search for ATS fingerprints
  const htmlLower = html.toLowerCase();
  const detectedPlatforms = [];

  for (const platform of ATS_PLATFORMS) {
    const matched = platform.fingerprints.some(fp => htmlLower.includes(fp.toLowerCase()));
    if (matched) {
      const slug = platform.extractSlug(html);
      detectedPlatforms.push({ platform, slug });
    }
  }

  if (detectedPlatforms.length === 0) {
    return {
      company: companyName,
      careersUrl,
      platform: null,
      slug: null,
      validation: null,
      htmlLength,
      jsRendered,
      status: jsRendered ? "js_rendered_no_match" : "no_match",
      error: jsRendered
        ? "Page appears JS-rendered (<10KB). ATS may be loaded client-side."
        : "No ATS fingerprint detected in HTML.",
    };
  }

  // Validate each detected platform, prioritize supported platforms
  detectedPlatforms.sort((a, b) => {
    // Supported platforms first
    if (a.platform.supported && !b.platform.supported) return -1;
    if (!a.platform.supported && b.platform.supported) return 1;
    // Platforms with extracted slugs first
    if (a.slug && !b.slug) return -1;
    if (!a.slug && b.slug) return 1;
    return 0;
  });

  let bestResult = null;

  for (const detected of detectedPlatforms) {
    if (detected.slug) {
      await sleep(DELAY_BETWEEN_REQUESTS);
      const validation = await detected.platform.validate(detected.slug);

      const result = {
        company: companyName,
        careersUrl,
        platform: detected.platform.name,
        platformCode: detected.platform.code,
        supported: detected.platform.supported,
        slug: detected.slug,
        validation,
        htmlLength,
        jsRendered,
        status: validation.valid ? "verified" : "detected_not_verified",
        allDetected: detectedPlatforms.map(d => ({
          platform: d.platform.name,
          code: d.platform.code,
          supported: d.platform.supported,
          slug: d.slug,
        })),
      };

      // If validated successfully, return immediately
      if (validation.valid) return result;

      // Otherwise, keep as best candidate and try next
      if (!bestResult) bestResult = result;
    } else {
      // Platform detected but no slug extracted
      if (!bestResult) {
        bestResult = {
          company: companyName,
          careersUrl,
          platform: detected.platform.name,
          platformCode: detected.platform.code,
          supported: detected.platform.supported,
          slug: null,
          validation: null,
          htmlLength,
          jsRendered,
          status: "detected_no_slug",
          allDetected: detectedPlatforms.map(d => ({
            platform: d.platform.name,
            code: d.platform.code,
            supported: d.platform.supported,
            slug: d.slug,
          })),
        };
      }
    }
  }

  return bestResult;
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

function saveCheckpoint(results, remaining) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
    completedResults: results,
    remainingCompanies: remaining,
    savedAt: new Date().toISOString(),
  }, null, 2));
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------

function generateReport(results) {
  const lines = [];
  const divider = "=".repeat(80);
  const thinDivider = "-".repeat(80);

  lines.push(divider);
  lines.push("  ASCENT ATS CLASSIFICATION REPORT");
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push(`  Companies classified: ${results.length}`);
  lines.push(divider);

  // Summary
  const byStatus = {};
  const byPlatform = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.platform) {
      byPlatform[r.platform] = byPlatform[r.platform] || { count: 0, supported: r.supported, jobs: 0 };
      byPlatform[r.platform].count++;
      if (r.validation && r.validation.jobCount) byPlatform[r.platform].jobs += r.validation.jobCount;
    }
  }

  lines.push("\n  STATUS SUMMARY");
  lines.push(thinDivider);
  lines.push(`  Verified (API confirmed):       ${byStatus["verified"] || 0}`);
  lines.push(`  Detected, not verified:         ${byStatus["detected_not_verified"] || 0}`);
  lines.push(`  Detected, no slug extracted:    ${byStatus["detected_no_slug"] || 0}`);
  lines.push(`  JS-rendered, no match:          ${byStatus["js_rendered_no_match"] || 0}`);
  lines.push(`  No ATS match:                   ${byStatus["no_match"] || 0}`);
  lines.push(`  No career URL found:            ${byStatus["no_careers_url"] || 0}`);
  lines.push(`  Fetch failed:                   ${(byStatus["fetch_failed"] || 0) + (byStatus["fetch_error"] || 0)}`);

  lines.push("\n  PLATFORM DISTRIBUTION");
  lines.push(thinDivider);
  for (const [platform, data] of Object.entries(byPlatform).sort((a, b) => b[1].count - a[1].count)) {
    const supportTag = data.supported ? "✓ supported" : "✗ needs fetcher";
    lines.push(`  ${platform.padEnd(20)} ${String(data.count).padStart(3)} companies  ${String(data.jobs).padStart(6)} jobs  [${supportTag}]`);
  }

  // Section 1: Verified — ready to add to ATS_MAP
  const verified = results.filter(r => r.status === "verified" && r.supported);
  if (verified.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push("  READY TO ADD: VERIFIED ATS MAPPINGS (supported platforms)");
    lines.push(`  ${verified.length} companies — API confirmed, can be added to ATS_MAP now`);
    lines.push(`${"█".repeat(80)}`);

    for (const r of verified.sort((a, b) => (b.validation?.jobCount || 0) - (a.validation?.jobCount || 0))) {
      lines.push(`\n  ${r.company}`);
      lines.push(`    Platform: ${r.platform} (${r.platformCode})  |  Slug: "${typeof r.slug === 'object' ? JSON.stringify(r.slug) : r.slug}"  |  Jobs: ${r.validation?.jobCount || 0}`);
      lines.push(`    ATS_MAP: "${r.company}": { ats: "${r.platformCode}", slug: "${typeof r.slug === 'object' ? r.slug.site || r.slug.slug : r.slug}" }`);
      if (r.validation?.sampleTitles?.length > 0) {
        lines.push(`    Sample: ${r.validation.sampleTitles.join(", ")}`);
      }
      lines.push(`    Career page: ${r.careersUrl}`);
    }
  }

  // Section 2: Verified Workday — needs fetcher but API works
  const verifiedWorkday = results.filter(r => r.status === "verified" && r.platform === "Workday");
  if (verifiedWorkday.length > 0) {
    lines.push(`\n\n${"█".repeat(80)}`);
    lines.push("  WORKDAY COMPANIES: VERIFIED (fetcher needed)");
    lines.push(`  ${verifiedWorkday.length} companies — Workday CXS API confirmed working`);
    lines.push(`${"█".repeat(80)}`);

    for (const r of verifiedWorkday.sort((a, b) => (b.validation?.jobCount || 0) - (a.validation?.jobCount || 0))) {
      const slugData = r.slug;
      lines.push(`\n  ${r.company}`);
      lines.push(`    Tenant: "${slugData.tenant}"  |  DC: ${slugData.dataCenter}  |  Site: "${slugData.site}"  |  Jobs: ${r.validation?.jobCount || 0}`);
      lines.push(`    API: ${slugData.apiUrl}`);
      if (r.validation?.sampleTitles?.length > 0) {
        lines.push(`    Sample: ${r.validation.sampleTitles.join(", ")}`);
      }
      lines.push(`    Career page: ${r.careersUrl}`);
    }
  }

  // Section 3: Detected unsupported platforms
  const unsupported = results.filter(r => r.platform && !r.supported && r.platform !== "Workday");
  if (unsupported.length > 0) {
    lines.push(`\n\n${thinDivider}`);
    lines.push("  UNSUPPORTED PLATFORMS DETECTED");
    lines.push(`  ${unsupported.length} companies — on platforms we don't have fetchers for`);
    lines.push(thinDivider);

    for (const r of unsupported.sort((a, b) => a.platform.localeCompare(b.platform))) {
      lines.push(`  ${r.company.padEnd(35)} ${r.platform.padEnd(18)} slug: ${r.slug || "not extracted"}  (${r.careersUrl})`);
    }
  }

  // Section 4: No match / JS-rendered / errors
  const unresolved = results.filter(r => !r.platform);
  if (unresolved.length > 0) {
    lines.push(`\n\n${thinDivider}`);
    lines.push("  UNRESOLVED — NO ATS DETECTED");
    lines.push(`  ${unresolved.length} companies — manual review or Firecrawl needed`);
    lines.push(thinDivider);

    for (const r of unresolved.sort((a, b) => a.company.localeCompare(b.company))) {
      const reason = r.jsRendered ? "JS-rendered" : r.status === "no_careers_url" ? "no URL" : r.error ? r.error.substring(0, 50) : "unknown";
      lines.push(`  ${r.company.padEnd(35)} ${reason.padEnd(30)} ${r.careersUrl || "—"}`);
    }
  }

  // Section 5: Discovered career URLs
  lines.push(`\n\n${thinDivider}`);
  lines.push("  CAREER URL REGISTRY UPDATES");
  lines.push(thinDivider);
  const urlUpdates = results.filter(r => r.careersUrl);
  lines.push(`  ${urlUpdates.length} career URLs discovered/confirmed. Saved to careers-urls.json.`);

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
  const classifyAll = args.includes("--all");
  const resumeMode = args.includes("--resume");
  const singleIndex = args.indexOf("--company");
  const singleCompany = singleIndex >= 0 ? args[singleIndex + 1] : null;
  const addIndex = args.indexOf("--add");
  const addCompany = addIndex >= 0 ? args[addIndex + 1] : null;
  const addUrl = addIndex >= 0 ? args[addIndex + 2] : null;

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         ASCENT ATS CLASSIFIER v1.0                  ║");
  console.log("  ╚══════════════════════════════════════════════════════╝\n");

  // Load data sources
  const { atsMap, allCompanies } = extractFromRefreshScript();
  const careersUrlRegistry = loadCareersUrls();

  // Handle --add
  if (addCompany) {
    if (addUrl) {
      careersUrlRegistry[addCompany] = addUrl;
      saveCareersUrls(careersUrlRegistry);
      console.log(`  Added "${addCompany}" with URL: ${addUrl}`);
    }
    // Classify the single added company
    console.log(`  Classifying "${addCompany}"...\n`);
    const result = await classifyCompany(addCompany, addUrl || careersUrlRegistry[addCompany]);
    console.log(`  Result: ${result.status}`);
    if (result.platform) console.log(`  Platform: ${result.platform} (${result.platformCode})`);
    if (result.slug) console.log(`  Slug: ${typeof result.slug === "object" ? JSON.stringify(result.slug) : result.slug}`);
    if (result.validation) console.log(`  Jobs: ${result.validation.jobCount || 0}`);
    if (result.validation?.sampleTitles) console.log(`  Sample: ${result.validation.sampleTitles.join(", ")}`);
    if (result.error) console.log(`  Note: ${result.error}`);
    console.log(`  Career URL: ${result.careersUrl || "not found"}`);
    return;
  }

  // Build queue
  let companyQueue = [];
  let completedResults = [];

  if (singleCompany) {
    companyQueue = [singleCompany];
    console.log(`  Mode: Single company — "${singleCompany}"\n`);

  } else if (resumeMode) {
    const checkpoint = loadCheckpoint();
    if (!checkpoint) {
      console.error("  No checkpoint found. Run without --resume first.");
      process.exit(1);
    }
    completedResults = checkpoint.completedResults;
    companyQueue = checkpoint.remainingCompanies;
    console.log(`  Mode: Resume — ${companyQueue.length} remaining\n`);

  } else {
    // Determine which companies need classification
    if (classifyAll) {
      companyQueue = [...allCompanies];
      console.log(`  Mode: All companies (${companyQueue.length})\n`);
    } else {
      // Only companies NOT in ATS_MAP
      companyQueue = allCompanies.filter(name => !atsMap.has(name));
      console.log(`  Mode: Unclassified only (${companyQueue.length} of ${allCompanies.length} not in ATS_MAP)\n`);
    }
  }

  const totalCompanies = completedResults.length + companyQueue.length;

  console.log(`  Companies to classify: ${companyQueue.length}`);
  console.log(`  Career URLs in registry: ${Object.keys(careersUrlRegistry).length}`);
  console.log(`  Known domains: ${Object.keys(KNOWN_DOMAINS).length}`);
  console.log(`  Checkpoint every: ${CHECKPOINT_INTERVAL} companies`);
  console.log(`\n  Starting classification...\n`);

  // Process queue
  let processedCount = completedResults.length;

  for (let i = 0; i < companyQueue.length; i++) {
    const companyName = companyQueue[i];
    processedCount++;

    const progress = `[${processedCount}/${totalCompanies}]`;
    process.stdout.write(`  ${progress} ${companyName.padEnd(35)} `);

    try {
      const knownUrl = careersUrlRegistry[companyName];
      const result = await classifyCompany(companyName, knownUrl);
      completedResults.push(result);

      // Update careers URL registry
      if (result.careersUrl && !careersUrlRegistry[companyName]) {
        careersUrlRegistry[companyName] = result.careersUrl;
      }

      // Print inline result
      if (result.status === "verified") {
        const jobCount = result.validation?.jobCount || 0;
        const supportTag = result.supported ? "✓" : "⚠";
        console.log(`${supportTag} ${result.platform}  ${jobCount} jobs`);
      } else if (result.platform) {
        console.log(`~ ${result.platform} (${result.status})`);
      } else {
        const reason = result.jsRendered ? "JS-rendered" : result.status;
        console.log(`✗ ${reason}`);
      }

    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      completedResults.push({
        company: companyName,
        careersUrl: null,
        platform: null,
        slug: null,
        validation: null,
        htmlLength: 0,
        jsRendered: false,
        status: "error",
        error: error.message,
      });
    }

    // Checkpoint
    if ((i + 1) % CHECKPOINT_INTERVAL === 0 && i + 1 < companyQueue.length) {
      const remaining = companyQueue.slice(i + 1);
      saveCheckpoint(completedResults, remaining);
      saveCareersUrls(careersUrlRegistry);
      console.log(`  --- Checkpoint saved (${completedResults.length} done, ${remaining.length} remaining) ---`);
    }

    if (i + 1 < companyQueue.length) {
      await sleep(DELAY_BETWEEN_COMPANIES);
    }
  }

  // Write outputs
  console.log("\n  Classification complete. Writing results...\n");

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(completedResults, null, 2));
  console.log(`  ✓ Full results:    ${RESULTS_PATH}`);

  const report = generateReport(completedResults);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`  ✓ Report:          ${REPORT_PATH}`);

  saveCareersUrls(careersUrlRegistry);
  console.log(`  ✓ Career URLs:     ${CAREERS_URLS_PATH}`);

  if (fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
    console.log(`  ✓ Checkpoint cleaned up`);
  }

  // Summary
  const verified = completedResults.filter(r => r.status === "verified").length;
  const verifiedSupported = completedResults.filter(r => r.status === "verified" && r.supported).length;
  const workday = completedResults.filter(r => r.platform === "Workday" && r.status === "verified").length;
  const otherUnsupported = completedResults.filter(r => r.platform && !r.supported && r.platform !== "Workday").length;
  const unresolved = completedResults.filter(r => !r.platform).length;

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║              CLASSIFICATION SUMMARY                 ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║  Ready to add (supported ATS):  ${String(verifiedSupported).padStart(4)}                  ║`);
  console.log(`  ║  Workday (needs fetcher):        ${String(workday).padStart(4)}                  ║`);
  console.log(`  ║  Other unsupported platforms:    ${String(otherUnsupported).padStart(4)}                  ║`);
  console.log(`  ║  Unresolved (no ATS detected):   ${String(unresolved).padStart(4)}                  ║`);
  console.log("  ╚══════════════════════════════════════════════════════╝\n");
}

main().catch(error => {
  console.error(`\n  Fatal error: ${error.message}`);
  process.exit(1);
});
