// scripts/refresh-workday.js
// Dedicated Workday pipeline. Runs on its own GitHub Actions schedule (2 AM UTC,
// 4 hours before the main refresh at 6 AM UTC) with a 45-minute timeout.
//
// Reads ATS registry, filters to ats="wd" entries, fetches jobs for each Workday
// company via the CXS list+detail endpoints, parses descriptions via the same
// parseQualifications used by the main pipeline (duplicated here intentionally
// to keep this script standalone), and writes to its own blob `jobs-workday.json`.
//
// The main pipeline (refresh-jobs.js) reads that blob at 6 AM UTC and merges
// the Workday jobs into the final `jobs-data.json` before upload.
//
// Run: node scripts/refresh-workday.js
// Requires env: BLOB_READ_WRITE_TOKEN (RAPIDAPI_KEY is NOT required here)

const { put, list } = require("@vercel/blob");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!BLOB_TOKEN) { console.error("Missing BLOB_READ_WRITE_TOKEN"); process.exit(1); }

// ── Pipeline constants ──
var WORKDAY_LIST_PAGE_SIZE        = 20;       // Workday default, max for public CXS API
var WORKDAY_LIST_PARALLEL         = 5;        // pages fetched per wave
var WORKDAY_DETAIL_PARALLEL       = 10;       // detail calls per wave
var WORKDAY_LIST_TIMEOUT_MS       = 10000;
var WORKDAY_DETAIL_TIMEOUT_MS     = 6000;
var WORKDAY_MAX_PAGES_PER_COMPANY = 50;       // 50 * 20 = 1000 jobs max/company
var WORKDAY_COMPANY_BUDGET_MS     = 300000;   // 5 min hard ceiling per company
var WORKDAY_PIPELINE_BUDGET_MS    = 2400000;  // 40 min total pipeline ceiling

// ── parseQualifications + trimDesc (duplicated from refresh-jobs.js) ──
// Keep this in sync with the definitions in refresh-jobs.js. This script is
// deliberately standalone so a failure here cannot take down the main pipeline.

function trimDesc(html) {
  if (!html) return "";
  var t = html
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  return t.length > 800 ? t.substring(0, 800) : t;
}

function parseQualifications(html) {
  if (!html) return { must: [], nice: [], bene: [] };
  var text = html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?(ul|ol|p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<(strong|b|em)>/gi, '').replace(/<\/(strong|b|em)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  var H = "(?:^|\\n)\\s*(?:#{1,3}\\s*)?";
  var E = "\\s*[:：\\-—]?\\s*";
  function rx(s){return new RegExp(H+s+E,"i");}
  var reqH = [
    rx("(?:minimum\\s+|required\\s+|basic\\s+|core\\s+)?(?:qualifications?|requirements?)"),
    rx("(?:required|key|essential|core)\\s+(?:skills?|experience|competenc(?:y|ies))"),
    rx("what\\s+(?:you['\\u2019]ll\\s+need|we['\\u2019]re\\s+looking\\s+for|you\\s+(?:should\\s+)?(?:have|bring|need))"),
    rx("what\\s+(?:you\\s+bring|this\\s+(?:job|role)\\s+requires?)"),
    rx("(?:about\\s+)?you(?:r\\s+(?:background|experience|skills|profile))?"),
    rx("who\\s+you\\s+are"),
    rx("must[- ]haves?"),
    rx("you\\s+(?:may\\s+be\\s+a\\s+fit|might\\s+thrive)\\s+if"),
    rx("what\\s+(?:we\\s+need|we\\s+expect|you\\s+need)"),
    rx("(?:preferred|desired)\\s+qualifications?"),
    rx("to\\s+be\\s+successful"),
    rx("(?:the\\s+)?ideal\\s+candidate"),
    rx("skills?\\s+(?:and|&)\\s+(?:experience|qualifications?)"),
    rx("experience\\s+(?:and|&)\\s+(?:skills?|qualifications?)"),
    rx("(?:we\\s+)?(?:need|want|expect)\\s+(?:you\\s+to|someone\\s+(?:who|with))"),
    rx("(?:your|the)\\s+(?:role|position)\\s+requires?"),
    rx("what\\s+(?:makes\\s+you\\s+(?:a\\s+)?(?:great|good|strong)\\s+(?:fit|candidate|match))"),
    rx("(?:strong\\s+)?candidates?\\s+(?:will\\s+|should\\s+)?(?:have|possess|demonstrate)"),
  ];
  var addH = [
    rx("nice\\s+to\\s+haves?"),
    rx("bonus\\s+(?:points?|qualifications?|skills?|experience)"),
    rx("(?:ideally|it(?:'s|\\s+would\\s+be)\\s+(?:great|nice|helpful))\\s+(?:if\\s+)?(?:you)?"),
    rx("extra\\s+credit"),
    rx("plus(?:es)?\\s+(?:if|that)\\s+you"),
    rx("(?:additional|supplemental|optional)\\s+(?:qualifications?|experience|skills?|background)"),
    rx("what\\s+(?:would\\s+be|is)\\s+(?:nice|helpful|great)\\s+to\\s+have"),
    rx("(?:not\\s+required\\s+but|while\\s+not\\s+required)"),
    rx("(?:we['\\u2019]d\\s+love|it['\\u2019]s?\\s+a\\s+plus)\\s+if"),
    rx("what\\s+sets\\s+you\\s+apart"),
    rx("(?:desired|preferred)\\s+(?:but\\s+not\\s+required)"),
    rx("(?:these\\s+(?:are|would\\s+be)\\s+)?(?:a\\s+)?(?:plus|bonus)"),
  ];
  var beneH = [
    rx("(?:what\\s+we\\s+offer|we\\s+offer)"),
    rx("benefits?(?:\\s+(?:and|&)\\s+(?:perks?|compensation))?"),
    rx("(?:perks?|total\\s+rewards?)(?:\\s+(?:and|&)\\s+benefits?)?"),
    rx("compensation(?:\\s+(?:and|&)\\s+benefits?)?"),
    rx("why\\s+(?:join|work\\s+(?:at|with|for))\\s+(?:us)?"),
    rx("what(?:'s|\\s+is)\\s+in\\s+it\\s+for\\s+you"),
    rx("(?:our|the)\\s+(?:benefits?|perks?|package|offer)"),
    rx("(?:salary|pay)\\s+(?:range|band|details?)"),
    rx("(?:the\\s+)?(?:annual\\s+)?compensation\\s+(?:range|for|details?)"),
  ];
  var stopH = [
    rx("about\\s+(?:us|the\\s+company|the\\s+team)"),
    /(?:^|\n)\s*(?:#{1,3}\s*)?about\s+[A-Z]/i,
    rx("(?:equal\\s+opportunity|we\\s+(?:are\\s+)?(?:committed|an?\\s+equal))"),
    rx("(?:not\\s+all\\s+strong\\s+candidates)"),
    rx("(?:location|visa|how\\s+to\\s+apply|application|deadline)"),
    rx("(?:our\\s+mission|we\\s+believe)"),
    rx("(?:your\\s+safety\\s+matters)"),
    rx("(?:guidance\\s+on\\s+candidates)"),
    rx("(?:interested\\s+in\\s+building\\s+your\\s+career)"),
  ];
  var allH = reqH.concat(addH).concat(beneH).concat(stopH);
  function findSec(hdrs){var best=null;for(var i=0;i<hdrs.length;i++){var m=text.match(hdrs[i]);if(m){var idx=text.indexOf(m[0])+m[0].length;if(!best||idx<best)best=idx;}}return best;}
  function findEnd(si,skip){var rem=text.substring(si),ear=rem.length;for(var i=0;i<allH.length;i++){var dominated=false;if(skip)for(var s=0;s<skip.length;s++){if(allH[i]===skip[s]){dominated=true;break;}}if(dominated)continue;var m=rem.match(allH[i]);if(m){var p=rem.indexOf(m[0]);if(p>0&&p<ear)ear=p;}}return si+ear;}
  function extract(sec){var lines=sec.replace(/;\s*/g,'\n').split('\n'),out=[];for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^[\s•·\-–—*▸►→●○◦■□▪▫\d.)+]+/,'').trim();if(l.length<10||l.length>300)continue;if(/^(anthropic|we believe|the easiest|this research|at \w+,? we|our mission|your safety|not all strong|guidance on)/i.test(l))continue;if(/^\w[\w\s]{0,20}\s+is\s+(?:a|an|the)\s/i.test(l))continue;if(/^about\s+/i.test(l))continue;out.push(l);}return out.slice(0,15);}
  var rs=findSec(reqH),as=findSec(addH),bs=findSec(beneH);
  var must=[],nice=[],bene=[];
  if(rs!==null){var re=findEnd(rs,reqH);must=extract(text.substring(rs,re));}
  if(as!==null){var ae=findEnd(as,addH);nice=extract(text.substring(as,ae));}
  if(bs!==null){var be=findEnd(bs,beneH);bene=extract(text.substring(bs,be));}
  return { must: must, nice: nice, bene: bene };
}

// ── HTTP helpers ──

async function fetchWithTimeout(url, opts, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var r = await fetch(url, Object.assign({ signal: controller.signal }, opts || {}));
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

async function fetchWorkdayListPage(tenant, dc, site, offset) {
  var url = "https://" + tenant + "." + dc + ".myworkdayjobs.com/wday/cxs/" + tenant + "/" + site + "/jobs";
  var body = JSON.stringify({ appliedFacets: {}, limit: WORKDAY_LIST_PAGE_SIZE, offset: offset, searchText: "" });
  var r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: body
  }, WORKDAY_LIST_TIMEOUT_MS);
  if (!r || !r.ok) return null;
  var ct = r.headers.get("content-type") || "";
  if (ct.indexOf("application/json") < 0) return null;
  try { return await r.json(); } catch (e) { return null; }
}

async function fetchWorkdayDetail(tenant, dc, site, externalPath) {
  // externalPath looks like "/job/Remote-USA/Sr-Engineer_R21789"
  var url = "https://" + tenant + "." + dc + ".myworkdayjobs.com/wday/cxs/" + tenant + "/" + site + externalPath;
  var r = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Accept": "application/json" }
  }, WORKDAY_DETAIL_TIMEOUT_MS);
  if (!r || !r.ok) return null;
  var ct = r.headers.get("content-type") || "";
  if (ct.indexOf("application/json") < 0) return null;
  try { return await r.json(); } catch (e) { return null; }
}

function buildApplyUrl(tenant, dc, site, externalPath) {
  return "https://" + tenant + "." + dc + ".myworkdayjobs.com/en-US/" + site + externalPath;
}

// ── Per-company fetch (list → details → records) ──

async function fetchWorkdayCompany(companyName, mapping) {
  var tenant = mapping.tenant, dc = mapping.dc, site = mapping.site;
  var started = Date.now();

  // Page 0 tells us the total; then we fetch the remaining pages in parallel waves.
  var first = await fetchWorkdayListPage(tenant, dc, site, 0);
  if (!first) {
    console.log("  " + companyName + ": list page 0 failed (non-JSON or timeout)");
    return [];
  }
  var total = first.total || 0;
  var postings = (first.jobPostings || []).slice();
  var totalPages = Math.min(Math.ceil(total / WORKDAY_LIST_PAGE_SIZE), WORKDAY_MAX_PAGES_PER_COMPANY);
  console.log("  " + companyName + ": total=" + total + ", fetching " + totalPages + " pages (cap " + WORKDAY_MAX_PAGES_PER_COMPANY + ")");

  // Fetch pages 1..totalPages-1 in parallel waves
  for (var p = 1; p < totalPages; p += WORKDAY_LIST_PARALLEL) {
    if (Date.now() - started > WORKDAY_COMPANY_BUDGET_MS) {
      console.log("  " + companyName + ": list budget exhausted at page " + p + "/" + totalPages);
      break;
    }
    var wavePages = [];
    for (var wp = 0; wp < WORKDAY_LIST_PARALLEL && p + wp < totalPages; wp++) {
      wavePages.push(p + wp);
    }
    var results = await Promise.all(wavePages.map(function(pg) {
      return fetchWorkdayListPage(tenant, dc, site, pg * WORKDAY_LIST_PAGE_SIZE);
    }));
    for (var rr = 0; rr < results.length; rr++) {
      if (results[rr] && Array.isArray(results[rr].jobPostings)) {
        postings = postings.concat(results[rr].jobPostings);
      }
    }
  }

  console.log("  " + companyName + ": list collected " + postings.length + "/" + total + " postings");

  // Fetch details in parallel waves
  var records = [];
  for (var d = 0; d < postings.length; d += WORKDAY_DETAIL_PARALLEL) {
    if (Date.now() - started > WORKDAY_COMPANY_BUDGET_MS) {
      console.log("  " + companyName + ": detail budget exhausted at " + d + "/" + postings.length);
      break;
    }
    var waveDetails = postings.slice(d, d + WORKDAY_DETAIL_PARALLEL);
    var details = await Promise.all(waveDetails.map(function(p) {
      return fetchWorkdayDetail(tenant, dc, site, p.externalPath).then(function(detail) {
        return { posting: p, detail: detail };
      });
    }));
    for (var di = 0; di < details.length; di++) {
      var posting = details[di].posting;
      var detail = details[di].detail;
      var info = (detail && detail.jobPostingInfo) || {};
      var descHtml = info.jobDescription || "";
      var q = parseQualifications(descHtml);
      var applyUrl = info.externalUrl || buildApplyUrl(tenant, dc, site, posting.externalPath);
      // job_id stable shape: wd_<tenant>_<R#####> parsed from externalPath tail
      var idMatch = posting.externalPath && posting.externalPath.match(/_([A-Z0-9-]+)$/);
      var jobId = idMatch ? idMatch[1] : posting.externalPath.split("/").pop();
      records.push({
        job_id: "wd_" + tenant + "_" + jobId,
        job_title: posting.title,
        employer_name: companyName,
        job_apply_link: applyUrl,
        job_description: trimDesc(descHtml),
        job_employment_type: info.timeType || null,
        job_posted_at: null, // Workday only returns human-readable "Posted X Days Ago"
        _company: companyName,
        _loc: (posting.locationsText || info.location || "").trim(),
        _must: q.must,
        _nice: q.nice,
        _bene: q.bene
      });
    }
  }

  var elapsedS = Math.round((Date.now() - started) / 1000);
  console.log("  " + companyName + ": " + records.length + " records in " + elapsedS + "s");
  return records;
}

// ── Registry load ──

async function loadWorkdayMappings() {
  var { blobs } = await list({ prefix: "ats-registry", limit: 5, token: BLOB_TOKEN });
  if (!blobs || blobs.length === 0) {
    throw new Error("No ats-registry blob found");
  }
  var latest = blobs.sort(function(a, b) {
    return new Date(b.uploadedAt) - new Date(a.uploadedAt);
  })[0];
  var resp = await fetch(latest.url);
  if (!resp.ok) throw new Error("Blob fetch failed: HTTP " + resp.status);
  var registry = await resp.json();
  if (!registry.mappings) throw new Error("Registry missing 'mappings'");
  var out = {};
  for (var name in registry.mappings) {
    var e = registry.mappings[name];
    if (e.ats === "wd" && e.tenant && e.dc && e.site) {
      out[name] = { ats: "wd", tenant: e.tenant, dc: e.dc, site: e.site };
    }
  }
  return { mappings: out, registryVersion: registry.version || "?" };
}

// ── Main ──

(async function main() {
  var started = Date.now();
  console.log("=== ASCENT WORKDAY REFRESH START ===");
  console.log("[BUILD:workday-v1] list+detail, parser active");
  console.log("Started: " + new Date().toISOString());

  var loaded;
  try {
    loaded = await loadWorkdayMappings();
  } catch (e) {
    console.error("FATAL: Could not load registry — " + e.message);
    process.exit(1);
  }
  var companies = Object.keys(loaded.mappings);
  console.log("Registry version: " + loaded.registryVersion + ", Workday companies: " + companies.length);

  if (companies.length === 0) {
    console.log("No Workday companies in registry — writing empty jobs-workday.json");
    // Still write an empty blob so the main pipeline's merge step has something consistent to read.
  }

  var allJobs = [];
  for (var ci = 0; ci < companies.length; ci++) {
    var name = companies[ci];
    if (Date.now() - started > WORKDAY_PIPELINE_BUDGET_MS) {
      console.log("Pipeline budget exhausted, " + (companies.length - ci) + " companies skipped");
      break;
    }
    console.log("[" + (ci + 1) + "/" + companies.length + "] " + name);
    try {
      var jobs = await fetchWorkdayCompany(name, loaded.mappings[name]);
      allJobs = allJobs.concat(jobs);
    } catch (e) {
      console.error("  " + name + ": ERROR " + e.message);
    }
  }

  // Per-company summary
  console.log("\n=== WORKDAY SUMMARY ===");
  var byCompany = {};
  allJobs.forEach(function(j) { byCompany[j._company] = (byCompany[j._company] || 0) + 1; });
  Object.keys(byCompany).forEach(function(c) { console.log("  " + c + ": " + byCompany[c] + " jobs"); });
  console.log("Total Workday jobs: " + allJobs.length);

  // Parse coverage
  var parsed = allJobs.filter(function(j) { return (j._must && j._must.length) || (j._nice && j._nice.length) || (j._bene && j._bene.length); }).length;
  var parsePct = allJobs.length > 0 ? Math.round(parsed / allJobs.length * 100) : 0;
  console.log("Parsed qualifications: " + parsed + "/" + allJobs.length + " (" + parsePct + "%)");

  // Build output
  var output = JSON.stringify({
    status: "OK",
    source: "workday",
    refreshed_at: new Date().toISOString(),
    total_jobs: allJobs.length,
    data: allJobs
  });
  var sizeMB = (Buffer.byteLength(output, "utf8") / (1024 * 1024)).toFixed(2);
  console.log("JSON size: " + sizeMB + " MB");

  // Upload
  try {
    var blob = await put("jobs-workday.json", output, {
      access: "public",
      contentType: "application/json",
      token: BLOB_TOKEN,
      addRandomSuffix: false
    });
    console.log("UPLOADED: " + blob.url);
    var elapsedS = Math.round((Date.now() - started) / 1000);
    console.log("=== ASCENT WORKDAY REFRESH COMPLETE (" + elapsedS + "s) ===");
    process.exit(0);
  } catch (e) {
    console.error("UPLOAD FAILED: " + e.message);
    process.exit(1);
  }
})();
