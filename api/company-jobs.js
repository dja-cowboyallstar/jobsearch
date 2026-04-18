// /api/company-jobs.js — Fetch jobs for a single company
// Uses ATS registry from Vercel Blob (shared with refresh-jobs.js)
// GET /api/company-jobs?company=1Password

var { list } = require("@vercel/blob");

// ── Registry cache (module-scope, survives warm starts) ──
var _registryCache = null;
var _registryCacheTime = 0;
var REGISTRY_TTL = 5 * 60 * 1000; // 5 minutes

async function getAtsMap() {
  var now = Date.now();
  if (_registryCache && (now - _registryCacheTime) < REGISTRY_TTL) {
    return _registryCache;
  }
  try {
    var token = process.env.BLOB_READ_WRITE_TOKEN;
    var { blobs } = await list({ prefix: "ats-registry", limit: 5, token: token });
    if (!blobs || blobs.length === 0) return _registryCache || {};
    var latest = blobs.sort(function(a, b) {
      return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    })[0];
    var resp = await fetch(latest.url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return _registryCache || {};
    var registry = await resp.json();
    var atsMap = {};
    if (registry.mappings) {
      for (var name in registry.mappings) {
        var entry = registry.mappings[name];
        if (entry.ats && entry.slug) {
          atsMap[name] = { ats: entry.ats, slug: entry.slug };
        }
      }
    }
    _registryCache = atsMap;
    _registryCacheTime = now;
    return atsMap;
  } catch (e) {
    // On error, use stale cache if available, otherwise empty
    return _registryCache || {};
  }
}

// ── Helpers ──

function stripHtml(s) {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s{2,}/g, " ").trim();
}

function trimDesc(raw) {
  if (!raw) return "";
  var d = stripHtml(raw);
  if (d.length > 800) d = d.slice(0, 800) + "\u2026";
  return d;
}

function fetchGreenhouse(name, slug) {
  return fetch("https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs?content=true", { signal: AbortSignal.timeout(8000) })
    .then(function(r) { return r.ok ? r.json() : { jobs: [] }; })
    .then(function(data) {
      return (data.jobs || []).map(function(j) {
        return { job_id: "gh_" + j.id, job_title: j.title, employer_name: name, employer_logo: null, job_apply_link: j.absolute_url, job_description: trimDesc(j.content), job_posted_at: j.updated_at, _company: name, _loc: j.location ? j.location.name : "" };
      });
    }).catch(function() { return []; });
}

function fetchLever(name, slug) {
  return fetch("https://api.lever.co/v0/postings/" + slug + "?mode=json", { signal: AbortSignal.timeout(8000) })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(jobs) {
      return (jobs || []).map(function(j) {
        return { job_id: "lv_" + j.id, job_title: j.text, employer_name: name, employer_logo: null, job_apply_link: j.hostedUrl || j.applyUrl, job_description: trimDesc(j.descriptionPlain || j.description), job_employment_type: j.categories && j.categories.commitment ? j.categories.commitment : null, job_posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, _company: name, _loc: j.categories && j.categories.location ? j.categories.location : "" };
      });
    }).catch(function() { return []; });
}

function fetchAshby(name, slug) {
  return fetch("https://api.ashbyhq.com/posting-api/job-board/" + slug + "?includeCompensation=true", { signal: AbortSignal.timeout(8000) })
    .then(function(r) { return r.ok ? r.json() : { jobs: [] }; })
    .then(function(data) {
      return (data.jobs || []).map(function(j) {
        var minSal = null, maxSal = null;
        if (j.compensation && j.compensation.compensationTierSummary) { minSal = j.compensation.compensationTierSummary.min; maxSal = j.compensation.compensationTierSummary.max; }
        return { job_id: "ab_" + j.id, job_title: j.title, employer_name: name, employer_logo: null, job_apply_link: j.jobUrl || ("https://jobs.ashbyhq.com/" + slug + "/" + j.id), job_description: trimDesc(j.descriptionPlain || j.descriptionHtml), job_employment_type: j.employmentType || null, job_min_salary: minSal, job_max_salary: maxSal, job_posted_at: j.publishedAt || null, _company: name, _loc: j.location || "" };
      });
    }).catch(function() { return []; });
}

function fetchRecruitee(name, slug) {
  return fetch("https://" + slug + ".recruitee.com/api/offers", { signal: AbortSignal.timeout(8000) })
    .then(function(r) { return r.ok ? r.json() : { offers: [] }; })
    .then(function(data) {
      return (data.offers || []).map(function(j) {
        return { job_id: "rc_" + j.id, job_title: j.title, employer_name: name, employer_logo: null, job_apply_link: j.careers_url || ("https://" + slug + ".recruitee.com/o/" + j.slug), job_description: trimDesc(j.description), job_employment_type: j.employment_type || null, job_min_salary: j.min_salary || null, job_max_salary: j.max_salary || null, job_posted_at: j.published_at || null, _company: name, _loc: j.location || "" };
      });
    }).catch(function() { return []; });
}

// ── Handler ──

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var company = req.query.company;
  if (!company) return res.status(400).json({ error: "Missing company parameter" });

  // Load ATS registry (cached in memory, 5-min TTL)
  var ATS_MAP = await getAtsMap();
  var mapping = ATS_MAP[company];
  var jobs = [];

  // ATS-primary: try ATS first if we have a mapping
  if (mapping) {
    try {
      if (mapping.ats === "gh") jobs = await fetchGreenhouse(company, mapping.slug);
      else if (mapping.ats === "lv") jobs = await fetchLever(company, mapping.slug);
      else if (mapping.ats === "ab") jobs = await fetchAshby(company, mapping.slug);
      else if (mapping.ats === "rc") jobs = await fetchRecruitee(company, mapping.slug);
    } catch (e) { jobs = []; }
  }

  // JSearch fallback if ATS returned nothing
  if (jobs.length === 0) {
    var KEY = process.env.RAPIDAPI_KEY;
    if (KEY) {
      try {
        var url = "https://jsearch.p.rapidapi.com/search?query=" + encodeURIComponent('"' + company + '" jobs') + "&page=1&num_pages=1";
        var resp = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": "jsearch.p.rapidapi.com" }, signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          var data = await resp.json();
          if (data.status === "OK" && data.data) {
            var cn = company.toLowerCase().replace(/[^a-z0-9]/g, "");
            jobs = data.data.filter(function(j) {
              var e = (j.employer_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              if (e === cn) return true;
              if (e.indexOf(cn) > -1 && e.length <= cn.length * 1.5) return true;
              if (cn.indexOf(e) > -1 && cn.length <= e.length * 1.5) return true;
              return false;
            }).map(function(j) {
              return { job_id: j.job_id, job_title: j.job_title, employer_name: j.employer_name, employer_logo: j.employer_logo, job_apply_link: j.job_apply_link, job_description: trimDesc(j.job_description), job_employment_type: j.job_employment_type || null, job_min_salary: j.job_min_salary || null, job_max_salary: j.job_max_salary || null, job_posted_at: j.job_posted_at_datetime_utc || null, job_required_skills: (j.job_required_skills || []).slice(0, 10), _company: company };
            });
          }
        }
      } catch (e) {}
    }
  }

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  return res.status(200).json({ status: "OK", company: company, total: jobs.length, data: jobs });
};
