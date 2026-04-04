// /api/company-jobs.js — Fetch jobs for a single company
// Uses ATS-primary logic: check Ashby/Greenhouse/Lever/Recruitee first, JSearch fallback
// GET /api/company-jobs?company=1Password

var ATS_MAP = {"1Password":{ats:"ab",slug:"1password"},"Abnormal Security":{ats:"gh",slug:"abnormalsecurity"},"Abridge":{ats:"ab",slug:"abridge"},"Affirm":{ats:"gh",slug:"affirm"},"Airtable":{ats:"gh",slug:"airtable"},"Alchemy":{ats:"ab",slug:"alchemy"},"Alloy":{ats:"gh",slug:"alloy"},"AlphaSense":{ats:"gh",slug:"alphasense"},"Amplitude":{ats:"gh",slug:"amplitude"},"Anaplan":{ats:"gh",slug:"anaplan"},"Anduril":{ats:"gh",slug:"andurilindustries"},"Anthropic":{ats:"gh",slug:"anthropic"},"Apollo":{ats:"gh",slug:"apollo"},"AppLovin":{ats:"gh",slug:"applovin"},"Applied Intuition":{ats:"gh",slug:"appliedintuition"},"Apptronik":{ats:"gh",slug:"apptronik"},"Articulate":{ats:"lv",slug:"articulate"},"Ashby":{ats:"ab",slug:"ashby"},"Attentive":{ats:"gh",slug:"attentive"},"Benchling":{ats:"ab",slug:"benchling"},"Braze":{ats:"gh",slug:"braze"},"Brex":{ats:"gh",slug:"brex"},"Calendly":{ats:"gh",slug:"calendly"},"Calm":{ats:"gh",slug:"calm"},"Campfire":{ats:"ab",slug:"campfire"},"CaptivateIQ":{ats:"lv",slug:"captivateiq"},"Carta":{ats:"gh",slug:"carta"},"Celonis":{ats:"gh",slug:"celonis"},"Cerebras Systems":{ats:"gh",slug:"cerebrassystems"},"Chainguard":{ats:"gh",slug:"chainguard"},"ClickUp":{ats:"ab",slug:"clickup"},"Coast":{ats:"gh",slug:"coast"},"Cockroach Labs":{ats:"gh",slug:"cockroachlabs"},"Cognition AI":{ats:"ab",slug:"cognition"},"Cohere":{ats:"ab",slug:"cohere"},"Common Room":{ats:"ab",slug:"commonroom"},"Contentful":{ats:"gh",slug:"contentful"},"CoreWeave":{ats:"gh",slug:"coreweave"},"Coupa":{ats:"lv",slug:"coupa"},"Coursera":{ats:"gh",slug:"coursera"},"Crusoe":{ats:"ab",slug:"crusoe"},"Cube":{ats:"ab",slug:"cube"},"DOSS":{ats:"ab",slug:"doss"},"Databricks":{ats:"gh",slug:"databricks"},"Datadog":{ats:"gh",slug:"datadog"},"Datarails":{ats:"gh",slug:"datarails"},"Decagon":{ats:"ab",slug:"decagon"},"Deel":{ats:"ab",slug:"deel"},"DeepL":{ats:"ab",slug:"deepl"},"Deepnote":{ats:"ab",slug:"deepnote"},"Discord":{ats:"gh",slug:"discord"},"Doppler":{ats:"ab",slug:"doppler"},"Drata":{ats:"ab",slug:"drata"},"Drivetrain":{ats:"lv",slug:"drivetrain"},"DualEntry":{ats:"rc",slug:"dualentry"},"Duolingo":{ats:"gh",slug:"duolingo"},"ElevenLabs":{ats:"ab",slug:"elevenlabs"},"Esusu":{ats:"gh",slug:"esusu"},"Faire":{ats:"gh",slug:"faire"},"Figma":{ats:"gh",slug:"figma"},"Figure AI":{ats:"gh",slug:"figureai"},"Fivetran":{ats:"gh",slug:"fivetran"},"Flexport":{ats:"gh",slug:"flexport"},"FloQast":{ats:"lv",slug:"floqast"},"Form Energy":{ats:"ab",slug:"formenergy"},"Forter":{ats:"gh",slug:"forter"},"Glean":{ats:"gh",slug:"gleanwork"},"GoCardless":{ats:"gh",slug:"gocardless"},"Gong":{ats:"rc",slug:"gong"},"Grafana Labs":{ats:"gh",slug:"grafanalabs"},"Gusto":{ats:"gh",slug:"gusto"},"Halcyon":{ats:"gh",slug:"halcyon"},"Handshake":{ats:"ab",slug:"handshake"},"Harvey AI":{ats:"ab",slug:"harvey"},"Hebbia":{ats:"gh",slug:"hebbia"},"Highspot":{ats:"lv",slug:"highspot"},"Hightouch":{ats:"gh",slug:"hightouch"},"Inflection AI":{ats:"gh",slug:"inflectionai"},"Intercom":{ats:"gh",slug:"intercom"},"Kalshi":{ats:"ab",slug:"kalshi"},"Klaviyo":{ats:"gh",slug:"klaviyo"},"Kong":{ats:"ab",slug:"kong"},"Lambda":{ats:"ab",slug:"lambda"},"LangChain":{ats:"ab",slug:"langchain"},"Lattice":{ats:"gh",slug:"lattice"},"LaunchDarkly":{ats:"gh",slug:"launchdarkly"},"Light":{ats:"ab",slug:"light"},"Lightdash":{ats:"ab",slug:"lightdash"},"Linear":{ats:"ab",slug:"linear"},"Lovable":{ats:"ab",slug:"lovable"},"Melio":{ats:"gh",slug:"melio"},"Mercor":{ats:"ab",slug:"mercor"},"Mercury":{ats:"gh",slug:"mercury"},"Mistral AI":{ats:"lv",slug:"mistral"},"Modal":{ats:"ab",slug:"modal"},"Monte Carlo":{ats:"ab",slug:"montecarlodata"},"NICE":{ats:"gh",slug:"nice"},"Notion":{ats:"ab",slug:"notion"},"Numeric":{ats:"ab",slug:"numeric"},"Nuro":{ats:"gh",slug:"nuro"},"Omnea":{ats:"ab",slug:"omnea"},"OpenAI":{ats:"ab",slug:"openai"},"OpenEvidence":{ats:"ab",slug:"openevidence"},"Oura":{ats:"gh",slug:"oura"},"Pacaso":{ats:"gh",slug:"pacaso"},"Palantir":{ats:"lv",slug:"palantir"},"Parloa":{ats:"gh",slug:"parloa"},"Pearl Health":{ats:"ab",slug:"pearlhealth"},"Physical Intelligence":{ats:"ab",slug:"physicalintelligence"},"Pigment":{ats:"lv",slug:"pigment"},"Pika":{ats:"ab",slug:"pika"},"Pinecone":{ats:"ab",slug:"pinecone"},"Plaid":{ats:"ab",slug:"plaid"},"PostHog":{ats:"ab",slug:"posthog"},"Profound":{ats:"ab",slug:"profound"},"Ramp":{ats:"ab",slug:"ramp"},"Redwood Materials":{ats:"gh",slug:"redwoodmaterials"},"Remote":{ats:"gh",slug:"remote"},"Render":{ats:"ab",slug:"render"},"Replit":{ats:"ab",slug:"replit"},"Retool":{ats:"ab",slug:"retool"},"Rillet":{ats:"ab",slug:"rillet"},"Riskified":{ats:"gh",slug:"riskified"},"Ro":{ats:"lv",slug:"ro"},"Roblox":{ats:"gh",slug:"roblox"},"Runway":{ats:"ab",slug:"runway"},"Samsara":{ats:"gh",slug:"samsara"},"Saronic":{ats:"ab",slug:"saronic"},"Scale AI":{ats:"gh",slug:"scaleai"},"Serval":{ats:"ab",slug:"serval"},"Shield AI":{ats:"lv",slug:"shieldai"},"Sierra AI":{ats:"ab",slug:"sierra"},"Simular":{ats:"ab",slug:"simular"},"Sisense":{ats:"gh",slug:"sisense"},"Snorkel AI":{ats:"gh",slug:"snorkelai"},"Snowflake":{ats:"ab",slug:"snowflake"},"SpaceX":{ats:"gh",slug:"spacex"},"Speak":{ats:"ab",slug:"speak"},"Stability AI":{ats:"gh",slug:"stabilityai"},"Stainless":{ats:"ab",slug:"stainlessapi"},"Statsig":{ats:"ab",slug:"statsig"},"Steadily":{ats:"ab",slug:"steadily"},"Stripe":{ats:"gh",slug:"stripe"},"Suno":{ats:"ab",slug:"suno"},"Supabase":{ats:"ab",slug:"supabase"},"Swap":{ats:"ab",slug:"swap"},"Sword Health":{ats:"lv",slug:"swordhealth"},"Synthesia":{ats:"ab",slug:"synthesia"},"Tabs":{ats:"ab",slug:"tabs"},"Tanium":{ats:"gh",slug:"tanium"},"Thinking Machines":{ats:"gh",slug:"thinkingmachines"},"Thrive Market":{ats:"gh",slug:"thrivemarket"},"Tines":{ats:"gh",slug:"tines"},"Torq":{ats:"gh",slug:"torq"},"Truveta":{ats:"gh",slug:"truveta"},"Typeform":{ats:"gh",slug:"typeform"},"Unify":{ats:"ab",slug:"unify"},"Unstructured":{ats:"ab",slug:"unstructured"},"Vannevar Labs":{ats:"gh",slug:"vannevarlabs"},"Vanta":{ats:"ab",slug:"vanta"},"Vercel":{ats:"gh",slug:"vercel"},"Verkada":{ats:"gh",slug:"verkada"},"Warp":{ats:"gh",slug:"warp"},"Waymo":{ats:"gh",slug:"waymo"},"Wealthsimple":{ats:"ab",slug:"wealthsimple"},"Weaviate":{ats:"ab",slug:"weaviate"},"Webflow":{ats:"gh",slug:"webflow"},"Whatnot":{ats:"ab",slug:"whatnot"},"Whoop":{ats:"ab",slug:"whoop"},"Wrike":{ats:"gh",slug:"wrike"},"Writer":{ats:"ab",slug:"writer"},"Zip":{ats:"ab",slug:"zip"},"Zuora":{ats:"gh",slug:"zuora"},"n8n":{ats:"ab",slug:"n8n"},"xAI":{ats:"gh",slug:"xai"},"Fireworks AI":{ats:"gh",slug:"fireworksai"},"Baseten":{ats:"ab",slug:"baseten"},"EvenUp":{ats:"ab",slug:"evenup"},"EliseAI":{ats:"ab",slug:"eliseai"},"Luma AI":{ats:"ab",slug:"luma-ai"},"Ambience Healthcare":{ats:"ab",slug:"ambiencehealthcare"},"Sesame":{ats:"ab",slug:"sesame"},"You.com":{ats:"gh",slug:"youcom"},"Uniphore":{ats:"lv",slug:"uniphore"},"Eudia":{ats:"gh",slug:"eudia"}};

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var company = req.query.company;
  if (!company) return res.status(400).json({ error: "Missing company parameter" });

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
