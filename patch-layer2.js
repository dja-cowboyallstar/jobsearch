#!/usr/bin/env node

/**
 * Ascent refresh-jobs.js Patch — Layer 2 + Greenhouse Fix + Kill JSearch
 * 
 * Applies four changes to scripts/refresh-jobs.js:
 *   1. Fix Greenhouse parser: decode HTML entities before stripping tags
 *   2. Add Layer 2 imports: WORKDAY_MAP, CAREERS_URLS, fetchWorkday, fetchFirecrawl
 *   3. Update fetchCompany router: check Workday → Firecrawl → return []
 *   4. Kill JSearch fallback: never call fetchJSearch
 * 
 * Usage:
 *   node patch-layer2.js              — Preview changes (dry run)
 *   node patch-layer2.js --apply      — Apply changes
 * 
 * Run from C:\ascent.
 */

const fs = require("fs");
const path = require("path");

const TARGET = path.join(process.cwd(), "scripts", "refresh-jobs.js");
const BACKUP_SUFFIX = ".backup-layer2-" + new Date().toISOString().replace(/[:.]/g, "-");

function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║   ASCENT LAYER 2 PATCH                              ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`\n  Mode: ${dryRun ? "DRY RUN (preview)" : "APPLY (writing changes)"}\n`);

  if (!fs.existsSync(TARGET)) {
    console.error("  ✗ scripts/refresh-jobs.js not found. Run from C:\\ascent.");
    process.exit(1);
  }

  let source = fs.readFileSync(TARGET, "utf8");
  const originalLength = source.length;
  let changes = 0;

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE 1: Fix Greenhouse parser — decode entities BEFORE tag stripping
  // ═══════════════════════════════════════════════════════════════════════

  const oldParser = `function parseQualifications(html) {
  if (!html) return { must: [], nice: [], bene: [] };
  var text = html
    .replace(/<\\/li>/gi, '\\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<\\/?(ul|ol|p|div|br|h[1-6])[^>]*>/gi, '\\n')
    .replace(/<(strong|b|em)>/gi, '').replace(/<\\/(strong|b|em)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\\n{3,}/g, '\\n\\n').trim();`;

  const newParser = `function parseQualifications(html) {
  if (!html) return { must: [], nice: [], bene: [] };
  // Decode HTML entities FIRST so tag-stripping regex can match decoded tags
  var decoded = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  var text = decoded
    .replace(/<\\/li>/gi, '\\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<\\/?(ul|ol|p|div|br|h[1-6])[^>]*>/gi, '\\n')
    .replace(/<(strong|b|em)>/gi, '').replace(/<\\/(strong|b|em)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\\n{3,}/g, '\\n\\n').trim();`;

  // We need to find the actual text in the file, not the escaped version.
  // Read it literally from the source.
  const parserStart = source.indexOf("function parseQualifications(html) {");
  if (parserStart === -1) {
    console.log("  ✗ Could not find parseQualifications function");
  } else {
    // Find the line with entity decoding
    const entityLine = "    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, \"'\").replace(/&quot;/g, '\"')";
    const varTextLine = "  var text = html";

    if (source.includes(varTextLine) && source.indexOf("var decoded = html") === -1) {
      // Add entity decode step before tag stripping
      const insertPoint = source.indexOf(varTextLine);
      const entityDecodeCode = "  // Decode HTML entities FIRST so tag-stripping regex can match decoded tags\n" +
        "  var decoded = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, \"'\").replace(/&quot;/g, '\"');\n";

      source = source.substring(0, insertPoint) +
        entityDecodeCode +
        source.substring(insertPoint).replace("  var text = html", "  var text = decoded");

      console.log("  ✓ CHANGE 1: Greenhouse parser — entity decode before tag stripping");
      changes++;
    } else if (source.includes("var decoded = html")) {
      console.log("  ○ CHANGE 1: Already applied (entity decode exists)");
    } else {
      console.log("  ✗ CHANGE 1: Could not locate parser pattern");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE 2: Add Layer 2 constants and imports after ATS_MAP
  // ═══════════════════════════════════════════════════════════════════════

  if (source.includes("WORKDAY_MAP")) {
    console.log("  ○ CHANGE 2: Already applied (WORKDAY_MAP exists)");
  } else {
    const atsMapEnd = source.indexOf("};\n", source.indexOf("const ATS_MAP = {"));
    if (atsMapEnd === -1) {
      console.log("  ✗ CHANGE 2: Could not find end of ATS_MAP");
    } else {
      const layer2Code = `

// ── LAYER 2: WORKDAY (free CXS API) ──
const WORKDAY_MAP = {
  "CrowdStrike": { tenant: "crowdstrike", dataCenter: "wd5", site: "crowdstrikecareers" },
  "Wolters Kluwer": { tenant: "wk", dataCenter: "wd3", site: "external" },
  "Tempus AI": { tenant: "tempus", dataCenter: "wd5", site: "tempus_careers" },
  "Arctic Wolf": { tenant: "arcticwolf", dataCenter: "wd1", site: "external" },
  "Devoted Health": { tenant: "devoted", dataCenter: "wd1", site: "devoted" },
  "Alto Pharmacy": { tenant: "alto", dataCenter: "wd1", site: "fuzehealthcareersite" },
  "Pluralsight": { tenant: "pluralsight", dataCenter: "wd1", site: "careers" },
};

// ── LAYER 2: FIRECRAWL (career page scraping for unsupported ATS) ──
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const CAREERS_URLS = {
  "Groq": "https://jobs.gem.com/groq",
  "Hugging Face": "https://apply.workable.com/huggingface",
  "Bain & Company": "https://www.bain.com/careers",
  "BlackLine": "https://careers.blackline.com/careers-home/",
  "Board International": "https://www.board.com/careers",
  "Bolt": "https://www.bolt.com/careers",
  "Canva": "https://www.lifeatcanva.com/en/",
  "Cyera": "https://www.cyera.com/careers",
  "Darwinbox": "https://www.darwinbox.com/en-us/careers",
  "Docusign": "https://careers.docusign.com/",
  "Flock Safety": "https://www.flocksafety.com/careers",
  "Hex": "https://hex.tech/careers/",
  "Island": "https://www.island.io/careers",
  "Jedox": "https://www.jedox.com/en/about/careers/",
  "Miro": "https://miro.com/careers/",
  "Modular": "https://www.modular.com/company/careers",
  "Monday.com": "https://www.monday.com/careers",
  "Navan": "https://navan.com/careers",
  "Nuvei": "https://www.nuvei.com/careers",
  "Pega": "https://www.pega.com/about/careers",
  "Rippling": "https://www.rippling.com/careers",
  "SambaNova": "https://sambanova.ai/company/careers",
  "Seismic": "https://www.seismic.com/careers/",
  "ThoughtSpot": "https://www.thoughtspot.com/careers",
  "VAST Data": "https://www.vastdata.com/careers",
  "Vena Solutions": "https://vena.pinpointhq.com/",
  "Weights & Biases": "https://wandb.ai/site/careers/",
  "Wise": "https://wise.jobs/",
  "World Wide Technology": "https://www.wwt.com/corporate/who-we-are/careers",
  "Domo": "https://www.domo.com/company/careers",
  "Billd": "https://billd.com/careers/",
  "Graphiant": "https://www.graphiant.com/careers",
  "Cognigy": "https://www.cognigy.com/careers",
  "Klarna": "https://www.klarna.com/careers/",
  "Luminance": "https://www.luminance.com/careers/",
  "Northvolt": "https://northvolt.com/careers",
  "OneStream": "https://www.onestream.com/careers/",
  "Procore": "https://careers.procore.com/",
  "Revolut": "https://www.revolut.com/careers/",
  "SentinelOne": "https://www.sentinelone.com/careers/",
  "ServiceNow": "https://www.servicenow.com/careers.html",
  "Flutterwave": "https://www.flutterwave.com/us/careers",
};

// Description cache for Firecrawl (avoids re-scraping known job pages)
var descriptionsCache = {};
try { descriptionsCache = JSON.parse(require("fs").readFileSync("descriptions-cache.json", "utf8")); } catch(e) {}
`;

      source = source.substring(0, atsMapEnd + 2) + layer2Code + source.substring(atsMapEnd + 2);
      console.log("  ✓ CHANGE 2: Added WORKDAY_MAP (" + Object.keys(JSON.parse('{"CrowdStrike":1,"Wolters Kluwer":1,"Tempus AI":1,"Arctic Wolf":1,"Devoted Health":1,"Alto Pharmacy":1,"Pluralsight":1}')).length + " companies) + CAREERS_URLS + cache init");
      changes++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE 3: Add fetchWorkday and fetchFirecrawl functions before fetchCompany
  // ═══════════════════════════════════════════════════════════════════════

  if (source.includes("async function fetchWorkday(")) {
    console.log("  ○ CHANGE 3: Already applied (fetchWorkday exists)");
  } else {
    const fetchCompanyPos = source.indexOf("async function fetchCompany(name) {");
    if (fetchCompanyPos === -1) {
      console.log("  ✗ CHANGE 3: Could not find fetchCompany function");
    } else {
      const fetcherCode = `// ── LAYER 2 FETCHERS ──

async function fetchWorkday(name, config) {
  var apiUrl = "https://" + config.tenant + "." + config.dataCenter + ".myworkdayjobs.com/wday/cxs/" + config.tenant + "/" + config.site + "/jobs";
  var allJobs = [];
  var offset = 0;
  var limit = 20;
  var total = null;
  while (total === null || offset < total) {
    try {
      var r = await fetchJson(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": "en-US" },
        body: JSON.stringify({ appliedFacets: {}, limit: limit, offset: offset, searchText: "" }),
      });
      if (!r || !r.jobPostings) break;
      total = r.total || 0;
      if (r.jobPostings.length === 0) break;
      for (var i = 0; i < r.jobPostings.length; i++) {
        var p = r.jobPostings[i];
        var desc = "";
        try {
          var detailUrl = "https://" + config.tenant + "." + config.dataCenter + ".myworkdayjobs.com/wday/cxs/" + config.tenant + "/" + config.site + "/job/" + p.externalPath;
          var detail = await fetchJson(detailUrl, { headers: { "Accept-Language": "en-US" } });
          if (detail && detail.jobPostingInfo) desc = detail.jobPostingInfo.jobDescription || "";
        } catch(e) {}
        var q = parseQualifications(desc);
        var applyUrl = "https://" + config.tenant + "." + config.dataCenter + ".myworkdayjobs.com/en-US/" + config.site + "/job/" + p.externalPath;
        allJobs.push({ job_id: "wd_" + (p.bulletFields && p.bulletFields[0] || p.externalPath), job_title: p.title, employer_name: name, job_apply_link: applyUrl, job_description: trimDesc(desc), job_employment_type: null, job_min_salary: null, job_max_salary: null, job_posted_at: p.postedOn || null, _company: name, _loc: p.locationsText || "", _must: q.must, _nice: q.nice, _bene: q.bene });
      }
      offset += limit;
    } catch(e) { break; }
  }
  return allJobs;
}

async function firecrawlExtractJobs(url) {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    var r = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + FIRECRAWL_API_KEY },
      body: JSON.stringify({ url: url, formats: ["extract"], extract: { schema: {
        type: "object",
        properties: { jobs: { type: "array", description: "All job openings on this career page. Only actual job postings, not navigation or other content.", items: { type: "object", properties: { title: { type: "string", description: "Job title exactly as shown" }, location: { type: "string", description: "Job location including remote/hybrid if shown" }, apply_url: { type: "string", description: "Full URL to view or apply for this job" }, department: { type: "string", description: "Department or team if shown" } }, required: ["title"] } } },
        required: ["jobs"]
      } } }),
    });
    if (!r.ok) return [];
    var d = await r.json();
    if (!d.success || !d.data || !d.data.extract || !d.data.extract.jobs) return [];
    return d.data.extract.jobs;
  } catch(e) { return []; }
}

async function firecrawlScrapeMarkdown(url) {
  if (!FIRECRAWL_API_KEY) return "";
  try {
    var r = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + FIRECRAWL_API_KEY },
      body: JSON.stringify({ url: url, formats: ["markdown"] }),
    });
    if (!r.ok) return "";
    var d = await r.json();
    return (d.success && d.data && d.data.markdown) ? d.data.markdown : "";
  } catch(e) { return ""; }
}

async function fetchFirecrawl(name, careersUrl) {
  if (!FIRECRAWL_API_KEY) { console.log("    [FC] No API key — skipping " + name); return []; }
  var listings = await firecrawlExtractJobs(careersUrl);
  if (!listings || listings.length === 0) { console.log("    [FC] No jobs extracted for " + name); return []; }
  var jobs = [];
  var newScrapes = 0;
  var cacheHits = 0;
  for (var i = 0; i < listings.length; i++) {
    var li = listings[i];
    if (!li.title) continue;
    var applyUrl = li.apply_url || careersUrl;
    var desc = "";
    var cached = descriptionsCache[applyUrl];
    if (cached && cached.description) { desc = cached.description; cacheHits++; }
    else if (newScrapes < 50 && applyUrl !== careersUrl) {
      try {
        var md = await firecrawlScrapeMarkdown(applyUrl);
        if (md) {
          var lines = md.split("\\n");
          var started = false;
          var descLines = [];
          for (var k = 0; k < lines.length; k++) {
            var ln = lines[k].trim();
            if (!ln) { if (started) descLines.push(""); continue; }
            if (/^!\\[/.test(ln) || /^\\[view all/i.test(ln) || /^\\[apply/i.test(ln)) continue;
            if (!started && (ln.startsWith("#") || ln.startsWith("**") || ln.length > 40)) started = true;
            if (started) descLines.push(ln);
          }
          desc = descLines.join("\\n").trim();
        }
        descriptionsCache[applyUrl] = { description: desc, fetchedAt: new Date().toISOString() };
        newScrapes++;
      } catch(e) {}
    }
    var q = parseQualifications(desc);
    jobs.push({ job_id: "fc_" + Buffer.from(applyUrl).toString("base64").substring(0, 20), job_title: li.title, employer_name: name, job_apply_link: applyUrl, job_description: trimDesc(desc), job_employment_type: null, job_min_salary: null, job_max_salary: null, job_posted_at: null, _company: name, _loc: li.location || "", _must: q.must, _nice: q.nice, _bene: q.bene });
  }
  console.log("    [FC] " + name + ": " + jobs.length + " jobs (" + cacheHits + " cached, " + newScrapes + " scraped)");
  return jobs;
}

`;
      source = source.substring(0, fetchCompanyPos) + fetcherCode + source.substring(fetchCompanyPos);
      console.log("  ✓ CHANGE 3: Added fetchWorkday, firecrawlExtractJobs, firecrawlScrapeMarkdown, fetchFirecrawl");
      changes++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE 4: Update router — add Workday + Firecrawl, kill JSearch fallback
  // ═══════════════════════════════════════════════════════════════════════

  const oldRouter = `  if (jobs.length === 0) {
    jobs = await fetchJSearch(name);
  }
  return jobs;
}`;

  const newRouter = `  // Layer 2: Workday (free API)
  if (jobs.length === 0 && WORKDAY_MAP[name]) {
    jobs = await fetchWorkday(name, WORKDAY_MAP[name]);
  }
  // Layer 2: Firecrawl (career page scraping)
  if (jobs.length === 0 && CAREERS_URLS[name]) {
    jobs = await fetchFirecrawl(name, CAREERS_URLS[name]);
  }
  // JSearch fallback REMOVED — if no source found, return 0 jobs (honest data)
  return jobs;
}`;

  if (source.includes("jobs = await fetchJSearch(name)")) {
    source = source.replace(oldRouter, newRouter);
    console.log("  ✓ CHANGE 4: Router updated — Workday → Firecrawl → no fallback (JSearch killed)");
    changes++;
  } else if (source.includes("JSearch fallback REMOVED")) {
    console.log("  ○ CHANGE 4: Already applied (JSearch removed)");
  } else {
    console.log("  ✗ CHANGE 4: Could not find JSearch fallback pattern in router");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGE 5: Save description cache after refresh (inject before blob upload)
  // ═══════════════════════════════════════════════════════════════════════

  if (source.includes("descriptions-cache.json") && source.includes("writeFileSync")) {
    console.log("  ○ CHANGE 5: Already applied (cache save exists)");
  } else {
    const blobUploadMarker = source.indexOf("Uploading to Vercel Blob");
    if (blobUploadMarker === -1) {
      console.log("  ✗ CHANGE 5: Could not find Blob upload marker");
    } else {
      // Find the console.log line before upload
      const lineStart = source.lastIndexOf("console.log", blobUploadMarker);
      if (lineStart > 0) {
        const cacheSaveCode = `  // Save Firecrawl description cache
  try { require("fs").writeFileSync("descriptions-cache.json", JSON.stringify(descriptionsCache)); } catch(e) {}
  `;
        source = source.substring(0, lineStart) + cacheSaveCode + source.substring(lineStart);
        console.log("  ✓ CHANGE 5: Added description cache save before Blob upload");
        changes++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Write result
  // ═══════════════════════════════════════════════════════════════════════

  console.log(`\n  Total changes: ${changes}`);
  console.log(`  File size: ${originalLength} → ${source.length} bytes`);

  if (dryRun) {
    console.log("\n  [DRY RUN] No files modified. Run with --apply to write.\n");
  } else {
    // Backup
    const backupPath = TARGET + BACKUP_SUFFIX;
    fs.writeFileSync(backupPath, fs.readFileSync(TARGET));
    console.log(`  Backup: ${path.relative(process.cwd(), backupPath)}`);

    // Write
    fs.writeFileSync(TARGET, source);
    console.log(`  ✓ Written: scripts/refresh-jobs.js`);

    // Verify ATS_MAP count (should still be 221)
    const verify = fs.readFileSync(TARGET, "utf8");
    const mapPattern = /"[^"]+"\s*:\s*\{/g;
    let count = 0;
    // Count only within ATS_MAP
    const mapSection = verify.substring(verify.indexOf("const ATS_MAP = {"), verify.indexOf("};\n", verify.indexOf("const ATS_MAP = {")) + 2);
    let m;
    while ((m = mapPattern.exec(mapSection)) !== null) count++;
    console.log(`  Verify: ATS_MAP has ${count} entries`);

    const hasWorkday = verify.includes("WORKDAY_MAP");
    const hasCareers = verify.includes("CAREERS_URLS");
    const hasDecoded = verify.includes("var decoded = html");
    const noJSearch = !verify.includes("jobs = await fetchJSearch(name)");
    console.log(`  Verify: WORKDAY_MAP=${hasWorkday} CAREERS_URLS=${hasCareers} entityFix=${hasDecoded} noJSearch=${noJSearch}`);

    console.log("\n  Next steps:");
    console.log("    git add scripts/refresh-jobs.js");
    console.log('    git commit -m "Layer 2: Workday + Firecrawl fetchers, fix GH parser, kill JSearch"');
    console.log("    git push");
    console.log("    # Trigger refresh from GitHub Actions\n");
  }
}

main();
