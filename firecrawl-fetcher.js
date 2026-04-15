/**
 * Ascent Layer 2: Firecrawl Career Page Fetcher
 * 
 * Drop-in module for refresh-jobs.js. Fetches job listings from any career
 * page URL using Firecrawl's scrape API, regardless of ATS platform.
 * 
 * Architecture:
 *   1. Scrape listing page → extract job URLs, titles, locations (1 credit)
 *   2. Check description cache → skip jobs already fetched
 *   3. Scrape new job pages → get full descriptions (1 credit each)
 *   4. Parse qualifications from descriptions (existing parseQualifications)
 *   5. Return standard job objects matching ATS fetcher format
 * 
 * Cost control:
 *   - Description cache stored in Vercel Blob (descriptions-cache.json)
 *   - Only new/changed job URLs get scraped for descriptions
 *   - Steady-state: ~70 listing pages + ~50-100 new jobs/day ≈ 120-170 credits/day
 * 
 * Integration: see INTEGRATION INSTRUCTIONS at bottom of file.
 */

// ---------------------------------------------------------------------------
// CAREERS_URLS — career page URLs for companies without direct ATS APIs.
// Add new companies here. The pipeline fetcher handles the rest.
// ---------------------------------------------------------------------------

const CAREERS_URLS = {
  // Gem
  "Groq": "https://jobs.gem.com/groq",
  
  // Workable
  "Hugging Face": "https://apply.workable.com/huggingface",
  
  // iCIMS (38 companies)
  "Bain & Company": "https://www.bain.com/careers",
  "Base44": "https://careers.wix.com/",
  "BlackLine": "https://careers.blackline.com/careers-home/",
  "Board International": "https://www.board.com/careers",
  "Bolt": "https://www.bolt.com/careers",
  "Canva": "https://www.lifeatcanva.com/en/",
  "Cribl": "https://cribl.io/careers/",
  "Cyera": "https://www.cyera.com/careers",
  "Darwinbox": "https://www.darwinbox.com/en-us/careers",
  "Docusign": "https://careers.docusign.com/",
  "Flatfile": "https://flatfile.com/careers",
  "Flock Safety": "https://www.flocksafety.com/careers",
  "Freshworks": "https://www.freshworks.com/company/careers/",
  "Hex": "https://hex.tech/careers/",
  "HubSpot": "https://www.hubspot.com/careers",
  "Island": "https://www.island.io/careers",
  "Jedox": "https://www.jedox.com/en/about/careers/",
  "Kore.ai": "https://www.kore.ai/careers",
  "Miro": "https://miro.com/careers/",
  "Modular": "https://www.modular.com/company/careers",
  "Monday.com": "https://www.monday.com/careers",
  "Navan": "https://navan.com/careers",
  "Nuvei": "https://www.nuvei.com/careers",
  "Pega": "https://www.pega.com/about/careers",
  "Rippling": "https://www.rippling.com/careers",
  "Runway Financial": "https://runway.com/careers",
  "SambaNova": "https://sambanova.ai/company/careers",
  "Seismic": "https://www.seismic.com/careers/",
  "Snyk": "https://snyk.io/careers/",
  "ThoughtSpot": "https://www.thoughtspot.com/careers",
  "VAST Data": "https://www.vastdata.com/careers",
  "Vena Solutions": "https://vena.pinpointhq.com/",
  "Weights & Biases": "https://wandb.ai/site/careers/",
  "Wise": "https://wise.jobs/",
  "Wiz": "https://www.wiz.io/careers",
  "World Wide Technology": "https://www.wwt.com/corporate/who-we-are/careers",
  "Domo": "https://www.domo.com/company/careers",
  
  // BambooHR
  "Billd": "https://billd.com/careers/",
  "Graphiant": "https://www.graphiant.com/careers",
  
  // Workday (7 companies — direct API, no Firecrawl needed. See WORKDAY_MAP below.)
  // These are handled by fetchWorkday, not fetchFirecrawl.
  
  // Other / unknown platform
  "Accrual": "https://www.accrual.com/",
  "Cognigy": "https://www.cognigy.com/careers",
  "Flutterwave": "https://www.flutterwave.com/us/careers",
  "Klarna": "https://www.klarna.com/careers/",
  "Luminance": "https://www.luminance.com/careers/",
  "Northvolt": "https://northvolt.com/careers",
  "OneStream": "https://www.onestream.com/careers/",
  "Procore": "https://careers.procore.com/",
  "Revolut": "https://www.revolut.com/careers/",
  "SentinelOne": "https://www.sentinelone.com/careers/",
  "ServiceNow": "https://www.servicenow.com/careers.html",
};

// ---------------------------------------------------------------------------
// WORKDAY_MAP — companies on Workday with verified CXS API endpoints.
// These use fetchWorkday (free, no Firecrawl credits needed).
// ---------------------------------------------------------------------------

const WORKDAY_MAP = {
  "CrowdStrike": { tenant: "crowdstrike", dataCenter: "wd5", site: "crowdstrikecareers" },
  "Wolters Kluwer": { tenant: "wk", dataCenter: "wd3", site: "external" },
  "Tempus AI": { tenant: "tempus", dataCenter: "wd5", site: "tempus_careers" },
  "Arctic Wolf": { tenant: "arcticwolf", dataCenter: "wd1", site: "external" },
  "Devoted Health": { tenant: "devoted", dataCenter: "wd1", site: "devoted" },
  "Alto Pharmacy": { tenant: "alto", dataCenter: "wd1", site: "fuzehealthcareersite" },
  "Pluralsight": { tenant: "pluralsight", dataCenter: "wd1", site: "careers" },
};

// ---------------------------------------------------------------------------
// Firecrawl API (raw fetch, no SDK dependency)
// ---------------------------------------------------------------------------

async function firecrawlScrape(url, apiKey) {
  var response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({ url: url, formats: ["markdown"] }),
  });
  
  if (!response.ok) {
    var errorText = await response.text();
    throw new Error("Firecrawl HTTP " + response.status + ": " + errorText.substring(0, 200));
  }
  
  var data = await response.json();
  if (!data.success) {
    throw new Error("Firecrawl error: " + (data.error || "unknown"));
  }
  
  return data.data.markdown || "";
}

/**
 * Extract structured data from a page using Firecrawl's LLM-powered extraction.
 * Costs more credits than scrape but eliminates brittle regex parsing.
 */
async function firecrawlExtract(url, schema, apiKey) {
  var response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      url: url,
      formats: ["extract"],
      extract: { schema: schema },
    }),
  });
  
  if (!response.ok) {
    var errorText = await response.text();
    throw new Error("Firecrawl extract HTTP " + response.status + ": " + errorText.substring(0, 200));
  }
  
  var data = await response.json();
  if (!data.success) {
    throw new Error("Firecrawl extract error: " + (data.error || "unknown"));
  }
  
  return data.data.extract || null;
}

// Schema for extracting job listings from a career page
var JOB_LISTING_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      description: "All job openings listed on this career page. Only include actual job postings, not navigation links, team pages, or other content.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The job title exactly as shown, e.g. 'Senior Software Engineer' or 'Account Executive, EMEA'",
          },
          location: {
            type: "string",
            description: "Job location, e.g. 'San Francisco, CA', 'Remote', 'London, UK'. Include remote/hybrid/onsite if shown.",
          },
          apply_url: {
            type: "string",
            description: "The URL to view or apply for this specific job. Must be a full URL starting with https://.",
          },
          department: {
            type: "string",
            description: "Department or team if shown, e.g. 'Engineering', 'Sales', 'Finance'.",
          },
        },
        required: ["title"],
      },
    },
  },
  required: ["jobs"],
};

// ---------------------------------------------------------------------------
// Listing extraction is handled by firecrawlExtract + JOB_LISTING_SCHEMA.
// No markdown parsing needed for career listing pages.
// parseJobPageMarkdown below is still used for individual job descriptions.
// ---------------------------------------------------------------------------

/**
 * Parse an individual job page markdown into a description string.
 * Strips navigation, headers, and footers to get the core job description.
 */
function parseJobPageMarkdown(markdown) {
  var lines = markdown.split("\n");
  var descriptionLines = [];
  var started = false;
  var skipPatterns = [
    /^!\[/,               // images
    /^\[view all/i,       // navigation
    /^\[apply/i,          // apply button
    /^cookie/i,           // cookie notices
    /^privacy/i,          // privacy notices
    /^©/,                 // copyright
  ];
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      if (started) descriptionLines.push("");
      continue;
    }
    
    // Skip images and navigation
    var skip = false;
    for (var j = 0; j < skipPatterns.length; j++) {
      if (skipPatterns[j].test(line)) { skip = true; break; }
    }
    if (skip) continue;
    
    // Start capturing after we see meaningful content
    if (!started && (line.startsWith("#") || line.startsWith("**") || line.length > 40)) {
      started = true;
    }
    
    if (started) {
      // Convert markdown to plain-ish text for the parser
      descriptionLines.push(line);
    }
  }
  
  return descriptionLines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Description Cache
// ---------------------------------------------------------------------------

/**
 * Cache structure: { "https://job-url": { description: "...", fetchedAt: "ISO" } }
 * Stored in Vercel Blob as descriptions-cache.json.
 */

async function loadDescriptionCache(blobToken) {
  try {
    // Try to read from Blob
    var listResponse = await fetch("https://api.vercel.com/v2/blob/list", {
      headers: { "Authorization": "Bearer " + blobToken },
    });
    // For simplicity in initial implementation: load from local file if exists
  } catch (e) {
    // Cache miss is fine — we'll build it up
  }
  
  var cachePath = require("path").join(process.cwd(), "descriptions-cache.json");
  if (require("fs").existsSync(cachePath)) {
    try {
      return JSON.parse(require("fs").readFileSync(cachePath, "utf8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveDescriptionCacheLocal(cache) {
  var cachePath = require("path").join(process.cwd(), "descriptions-cache.json");
  require("fs").writeFileSync(cachePath, JSON.stringify(cache));
}

// ---------------------------------------------------------------------------
// fetchFirecrawl — main fetcher function (matches ATS fetcher signature)
// ---------------------------------------------------------------------------

/**
 * Fetch jobs from a career page URL using Firecrawl.
 * 
 * @param {string} name - Company name
 * @param {string} careersUrl - Career page URL
 * @param {object} cache - Description cache (mutated in place)
 * @param {function} parseQualifications - Qualification parser from refresh-jobs.js
 * @param {function} trimDesc - Description trimmer from refresh-jobs.js
 * @param {string} apiKey - Firecrawl API key
 * @returns {Array} Job objects in standard Ascent format
 */
async function fetchFirecrawl(name, careersUrl, cache, parseQualifications, trimDesc, apiKey) {
  if (!apiKey) {
    console.log("    [FC] No FIRECRAWL_API_KEY — skipping " + name);
    return [];
  }
  
  // Step 1: Extract job listings from career page using LLM
  var extracted;
  try {
    extracted = await firecrawlExtract(careersUrl, JOB_LISTING_SCHEMA, apiKey);
  } catch (e) {
    console.log("    [FC] Extract failed for " + name + ": " + e.message);
    return [];
  }
  
  var listings = (extracted && extracted.jobs) ? extracted.jobs : [];
  
  // Filter out entries without titles
  listings = listings.filter(function(j) { return j.title && j.title.trim().length > 0; });
  
  if (listings.length === 0) {
    console.log("    [FC] No jobs extracted from " + name);
    return [];
  }
  
  // Step 2: For each job, get full description (from cache or Firecrawl scrape)
  var jobs = [];
  var newScrapes = 0;
  var cacheHits = 0;
  var maxJobScrapes = 50; // safety cap per company per refresh
  
  for (var i = 0; i < listings.length; i++) {
    var listing = listings[i];
    var applyUrl = listing.apply_url || careersUrl;
    var description = "";
    var cached = cache[applyUrl];
    
    if (cached && cached.description) {
      description = cached.description;
      cacheHits++;
    } else if (newScrapes < maxJobScrapes && applyUrl && applyUrl !== careersUrl) {
      try {
        var jobMarkdown = await firecrawlScrape(applyUrl, apiKey);
        description = parseJobPageMarkdown(jobMarkdown);
        
        cache[applyUrl] = {
          description: description,
          fetchedAt: new Date().toISOString(),
        };
        newScrapes++;
        
        if (i < listings.length - 1) {
          await new Promise(function(resolve) { setTimeout(resolve, 200); });
        }
      } catch (e) {
        console.log("    [FC] Job scrape failed: " + listing.title + " — " + e.message);
      }
    }
    
    var qualifications = { must: [], nice: [], bene: [] };
    if (description && parseQualifications) {
      qualifications = parseQualifications(description);
    }
    
    jobs.push({
      job_id: "fc_" + Buffer.from(applyUrl).toString("base64").substring(0, 20),
      job_title: listing.title,
      employer_name: name,
      job_apply_link: applyUrl,
      job_description: trimDesc ? trimDesc(description) : description.substring(0, 800),
      job_employment_type: null,
      job_min_salary: null,
      job_max_salary: null,
      job_posted_at: null,
      _company: name,
      _loc: listing.location || "",
      _must: qualifications.must,
      _nice: qualifications.nice,
      _bene: qualifications.bene,
      _source: "firecrawl",
    });
  }
  
  console.log("    [FC] " + name + ": " + jobs.length + " jobs (" + cacheHits + " cached, " + newScrapes + " scraped)");
  return jobs;
}

// ---------------------------------------------------------------------------
// fetchWorkday — Workday CXS API fetcher (free, no Firecrawl needed)
// ---------------------------------------------------------------------------

async function fetchWorkday(name, config, parseQualifications, trimDesc) {
  var apiUrl = "https://" + config.tenant + "." + config.dataCenter +
    ".myworkdayjobs.com/wday/cxs/" + config.tenant + "/" + config.site + "/jobs";
  
  var allJobs = [];
  var offset = 0;
  var limit = 20;
  var total = null;
  
  // Paginate through all jobs
  while (total === null || offset < total) {
    try {
      var response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: limit,
          offset: offset,
          searchText: "",
        }),
      });
      
      if (!response.ok) break;
      
      var data = await response.json();
      total = data.total || 0;
      var postings = data.jobPostings || [];
      
      if (postings.length === 0) break;
      
      for (var i = 0; i < postings.length; i++) {
        var posting = postings[i];
        
        // Workday listing only has title/location/path — no description.
        // Get description from the detail endpoint.
        var description = "";
        var jobDetailUrl = "https://" + config.tenant + "." + config.dataCenter +
          ".myworkdayjobs.com/wday/cxs/" + config.tenant + "/" + config.site +
          "/job/" + posting.externalPath;
        
        try {
          var detailResponse = await fetch(jobDetailUrl, {
            headers: { "Accept": "application/json", "Accept-Language": "en-US" },
          });
          if (detailResponse.ok) {
            var detail = await detailResponse.json();
            description = detail.jobPostingInfo?.jobDescription || "";
          }
        } catch (e) {
          // Detail fetch failed — continue without description
        }
        
        var qualifications = { must: [], nice: [], bene: [] };
        if (description && parseQualifications) {
          qualifications = parseQualifications(description);
        }
        
        var applyUrl = "https://" + config.tenant + "." + config.dataCenter +
          ".myworkdayjobs.com/en-US/" + config.site + "/job/" + posting.externalPath;
        
        allJobs.push({
          job_id: "wd_" + (posting.bulletFields?.[0] || posting.externalPath || offset + "_" + i),
          job_title: posting.title,
          employer_name: name,
          job_apply_link: applyUrl,
          job_description: trimDesc ? trimDesc(description) : description.substring(0, 800),
          job_employment_type: null,
          job_min_salary: null,
          job_max_salary: null,
          job_posted_at: posting.postedOn || null,
          _company: name,
          _loc: posting.locationsText || "",
          _must: qualifications.must,
          _nice: qualifications.nice,
          _bene: qualifications.bene,
          _source: "workday",
        });
      }
      
      offset += limit;
      
      // Rate limit
      await new Promise(function(resolve) { setTimeout(resolve, 300); });
      
    } catch (e) {
      console.log("    [WD] Fetch failed for " + name + " at offset " + offset + ": " + e.message);
      break;
    }
  }
  
  return allJobs;
}

// ---------------------------------------------------------------------------
// INTEGRATION INSTRUCTIONS
// ---------------------------------------------------------------------------

/*
 * To integrate into refresh-jobs.js:
 * 
 * 1. Copy CAREERS_URLS, WORKDAY_MAP, firecrawlScrape, parseListingMarkdown,
 *    parseJobPageMarkdown, fetchFirecrawl, and fetchWorkday into refresh-jobs.js.
 * 
 * 2. Add to the fetchCompany router (the function that decides which fetcher to use):
 * 
 *    // After ATS_MAP check, before JSearch fallback:
 *    if (WORKDAY_MAP[name]) {
 *      return fetchWorkday(name, WORKDAY_MAP[name], parseQualifications, trimDesc);
 *    }
 *    if (CAREERS_URLS[name]) {
 *      return fetchFirecrawl(name, CAREERS_URLS[name], descriptionsCache, parseQualifications, trimDesc, process.env.FIRECRAWL_API_KEY);
 *    }
 * 
 * 3. At the top of the refresh function, load the description cache:
 *    var descriptionsCache = {};
 *    try { descriptionsCache = JSON.parse(fs.readFileSync("descriptions-cache.json", "utf8")); } catch(e) {}
 * 
 * 4. After all jobs are fetched, save the updated cache:
 *    fs.writeFileSync("descriptions-cache.json", JSON.stringify(descriptionsCache));
 * 
 * 5. Add FIRECRAWL_API_KEY to:
 *    - GitHub Secrets (for Actions)
 *    - .github/workflows/refresh-jobs.yml env block
 *    - Vercel env vars (if using api/company-jobs.js)
 * 
 * 6. In .github/workflows/refresh-jobs.yml, add to the env block:
 *    FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
 * 
 * 7. Remove CAREERS_URLS companies from JSearch fallback by removing them from
 *    ALL_COMPANIES or by making the router stop before JSearch for mapped companies.
 *    The cleanest approach: remove the JSearch fallback entirely. If a company
 *    isn't in ATS_MAP, WORKDAY_MAP, or CAREERS_URLS, it returns 0 jobs.
 */

// Export for use in refresh-jobs.js or standalone testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CAREERS_URLS,
    WORKDAY_MAP,
    firecrawlScrape,
    firecrawlExtract,
    JOB_LISTING_SCHEMA,
    parseJobPageMarkdown,
    fetchFirecrawl,
    fetchWorkday,
    loadDescriptionCache: loadDescriptionCache,
    saveDescriptionCache: saveDescriptionCacheLocal,
  };
}
