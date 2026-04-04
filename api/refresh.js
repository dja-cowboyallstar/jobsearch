// /api/refresh.js — Production-grade job cache endpoint
//
// GET /api/refresh          → Serves CDN-cached job data (instant for users)
// GET /api/refresh?key=X    → Admin: triggers full crawl, writes to CDN cache
// GET /api/refresh?health=1 → Health check: returns cache age and job count
//
// Vercel free tier has 10s function timeout. We batch aggressively (10 parallel)
// and minimize delays to finish within the window. The admin script calls this
// endpoint multiple times (chunked) if needed.

var COMPANIES = [
  "OpenAI","Anthropic","Mistral AI","Cohere","Databricks","Hugging Face","Together AI","Groq",
  "Cerebras Systems","xAI","CoreWeave","Lambda","SambaNova","ScaleOps","Perplexity AI","Jasper",
  "Runway","Glean","Harvey AI","ElevenLabs","Cursor","Cognition AI","Suno","Pika",
  "Writer","Replit","Moveworks","Genspark","Unstructured","Sierra AI","Lovable","Credo AI",
  "Stripe","Ramp","Brex","Plaid","Mercury","Navan","Deel","Rippling",
  "Carta","Zip","Billd","Steadily","Klarna","Revolut","Esusu","Wiz",
  "Abnormal Security","Island","Chainguard","Snyk","Cyera","Halcyon","Flock Safety","Abridge",
  "Tempus AI","Spring Health","Hippocratic AI","Pearl Health","Truveta","Benchling","Vercel","Supabase",
  "PostHog","Linear","Grafana Labs","Retool","Datadog","Canva","Notion","Figma",
  "Monday.com","Drata","Vanta","Clay","Lattice","Gong","Celonis","CaptivateIQ",
  "Common Room","ServiceNow","HubSpot","Docusign","AlphaSense","Snowflake","dbt Labs","Dataiku",
  "Scale AI","Cribl","Figure AI","Anduril","Physical Intelligence","Saronic","Shield AI","Gecko Robotics",
  "Apptronik","Whatnot","Faire","Flexport","Pacaso","Thrive Market","Redwood Materials","Form Energy",
  "Commonwealth Fusion","Northvolt","Duolingo","Handshake","Coursera","Gusto","Palantir","SpaceX",
  "Vannevar Labs","Ironclad","EvenUp","Discord","Whoop","Oura","ICON 3D","World Wide Technology",
  "Shopify","CrowdStrike","AppLovin","LangChain","Retell AI","Serval","Resolve AI","CrewAI",
  "Peec AI","DOSS","Kalshi","Hex","Tome","Orb","Statsig","Stainless",
  "Codeium","Graphiant","Affirm","Pluralsight","Riskified","Alloy","Zuora","Tropic",
  "Doppler","Flatfile","Render","Roblox","Campfire","DualEntry","Light","Tabs",
  "Base44","Samsara","Rillet","Skild AI","DeepL","Thinking Machines","Speak","OpenEvidence",
  "VAST Data","Crusoe","Decagon","Luminance","Swap","Kore.ai","Wise","Aisera",
  "NICE","Cognigy","Intercom","Numeric","Pega","Mercor","Apollo","n8n",
  "Tines","Torq","Parloa","MainFunc","Darwinbox","Ashby","Hightouch","DevRev",
  "Basis","Profound","Unify","Giga","Synthflow AI","Simular","Anaplan","OneStream",
  "Wolters Kluwer","Board International","Jedox","Pigment","Abacum","Runway Financial","Datarails","Cube",
  "Drivetrain","Vena Solutions","Planful","Nominal","FloQast","BlackLine","Accrual","ThoughtSpot",
  "Domo","Sisense","Sigma Computing","Deepnote","Pyramid Analytics","Omni Analytics","Lightdash","Thinking Machines Lab",
  "Hebbia","Coactive AI","Weights & Biases","Adept AI","Wrike","Amplitude","Airtable","Freshworks",
  "HashiCorp","Contentful","GitLab","Miro","ClickUp","Webflow","Warp","Verkada",
  "Applied Intuition","Nuro","Articulate","Grammarly","Relativity Space","Corebridge Financial","Sword Health","Nuvei",
  "Bain & Company","Trader Joe's","Box","Procore","Calm","Built Technologies","Hinge Health","Alto Pharmacy",
  "Findigs","Coast","Wealthsimple","Calendly","Typeform","Remote","Waymo","Omnea",
  "Bolt","Stability AI","Inflection AI","Modal","Pinecone","Weaviate","Character AI","Midjourney",
  "Synthesia","Coupa","Cockroach Labs","LaunchDarkly","Fivetran","Monte Carlo","Snorkel AI","Alchemy",
  "Braze","Kong","Harness","SentinelOne","1Password","Tanium","Arctic Wolf","Noom",
  "Ro","Devoted Health","Oscar Health","Outreach","Seismic","Highspot","Attentive","Klaviyo",
  "Forter","Flutterwave","GoCardless","Melio",
  "Bryant Park Consulting","Echo Park Consulting"
];

var HOST = "jsearch.p.rapidapi.com";

// ATS fallback map — Greenhouse (gh) and Lever (lv) public APIs, no auth needed
var ATS_MAP = {
  "1Password":{ats:"ab",slug:"1password"},
  "Abnormal Security":{ats:"gh",slug:"abnormalsecurity"},
  "Abridge":{ats:"ab",slug:"abridge"},
  "Affirm":{ats:"gh",slug:"affirm"},
  "Airtable":{ats:"gh",slug:"airtable"},
  "Alchemy":{ats:"ab",slug:"alchemy"},
  "Alloy":{ats:"gh",slug:"alloy"},
  "AlphaSense":{ats:"gh",slug:"alphasense"},
  "Amplitude":{ats:"gh",slug:"amplitude"},
  "Anaplan":{ats:"gh",slug:"anaplan"},
  "Anduril":{ats:"gh",slug:"andurilindustries"},
  "Anthropic":{ats:"gh",slug:"anthropic"},
  "Apollo":{ats:"gh",slug:"apollo"},
  "AppLovin":{ats:"gh",slug:"applovin"},
  "Applied Intuition":{ats:"gh",slug:"appliedintuition"},
  "Apptronik":{ats:"gh",slug:"apptronik"},
  "Articulate":{ats:"lv",slug:"articulate"},
  "Ashby":{ats:"ab",slug:"ashby"},
  "Attentive":{ats:"gh",slug:"attentive"},
  "Benchling":{ats:"ab",slug:"benchling"},
  "Braze":{ats:"gh",slug:"braze"},
  "Brex":{ats:"gh",slug:"brex"},
  "Calendly":{ats:"gh",slug:"calendly"},
  "Calm":{ats:"gh",slug:"calm"},
  "Campfire":{ats:"ab",slug:"campfire"},
  "CaptivateIQ":{ats:"lv",slug:"captivateiq"},
  "Carta":{ats:"gh",slug:"carta"},
  "Celonis":{ats:"gh",slug:"celonis"},
  "Cerebras Systems":{ats:"gh",slug:"cerebrassystems"},
  "Chainguard":{ats:"gh",slug:"chainguard"},
  "ClickUp":{ats:"ab",slug:"clickup"},
  "Coast":{ats:"gh",slug:"coast"},
  "Cockroach Labs":{ats:"gh",slug:"cockroachlabs"},
  "Cognition AI":{ats:"ab",slug:"cognition"},
  "Cohere":{ats:"ab",slug:"cohere"},
  "Common Room":{ats:"ab",slug:"commonroom"},
  "Contentful":{ats:"gh",slug:"contentful"},
  "CoreWeave":{ats:"gh",slug:"coreweave"},
  "Coupa":{ats:"lv",slug:"coupa"},
  "Coursera":{ats:"gh",slug:"coursera"},
  "Crusoe":{ats:"ab",slug:"crusoe"},
  "Cube":{ats:"ab",slug:"cube"},
  "DOSS":{ats:"ab",slug:"doss"},
  "Databricks":{ats:"gh",slug:"databricks"},
  "Datadog":{ats:"gh",slug:"datadog"},
  "Datarails":{ats:"gh",slug:"datarails"},
  "Decagon":{ats:"ab",slug:"decagon"},
  "Deel":{ats:"ab",slug:"deel"},
  "DeepL":{ats:"ab",slug:"deepl"},
  "Deepnote":{ats:"ab",slug:"deepnote"},
  "Discord":{ats:"gh",slug:"discord"},
  "Doppler":{ats:"ab",slug:"doppler"},
  "Drata":{ats:"ab",slug:"drata"},
  "Drivetrain":{ats:"lv",slug:"drivetrain"},
  "DualEntry":{ats:"rc",slug:"dualentry"},
  "Duolingo":{ats:"gh",slug:"duolingo"},
  "ElevenLabs":{ats:"ab",slug:"elevenlabs"},
  "Esusu":{ats:"gh",slug:"esusu"},
  "Faire":{ats:"gh",slug:"faire"},
  "Figma":{ats:"gh",slug:"figma"},
  "Figure AI":{ats:"gh",slug:"figureai"},
  "Fivetran":{ats:"gh",slug:"fivetran"},
  "Flexport":{ats:"gh",slug:"flexport"},
  "FloQast":{ats:"lv",slug:"floqast"},
  "Form Energy":{ats:"ab",slug:"formenergy"},
  "Forter":{ats:"gh",slug:"forter"},
  "Glean":{ats:"gh",slug:"gleanwork"},
  "GoCardless":{ats:"gh",slug:"gocardless"},
  "Gong":{ats:"rc",slug:"gong"},
  "Grafana Labs":{ats:"gh",slug:"grafanalabs"},
  "Gusto":{ats:"gh",slug:"gusto"},
  "Halcyon":{ats:"gh",slug:"halcyon"},
  "Handshake":{ats:"ab",slug:"handshake"},
  "Harvey AI":{ats:"ab",slug:"harvey"},
  "Hebbia":{ats:"gh",slug:"hebbia"},
  "Highspot":{ats:"lv",slug:"highspot"},
  "Hightouch":{ats:"gh",slug:"hightouch"},
  "Inflection AI":{ats:"gh",slug:"inflectionai"},
  "Intercom":{ats:"gh",slug:"intercom"},
  "Kalshi":{ats:"ab",slug:"kalshi"},
  "Klaviyo":{ats:"gh",slug:"klaviyo"},
  "Kong":{ats:"ab",slug:"kong"},
  "Lambda":{ats:"ab",slug:"lambda"},
  "LangChain":{ats:"ab",slug:"langchain"},
  "Lattice":{ats:"gh",slug:"lattice"},
  "LaunchDarkly":{ats:"gh",slug:"launchdarkly"},
  "Light":{ats:"ab",slug:"light"},
  "Lightdash":{ats:"ab",slug:"lightdash"},
  "Linear":{ats:"ab",slug:"linear"},
  "Lovable":{ats:"ab",slug:"lovable"},
  "Melio":{ats:"gh",slug:"melio"},
  "Mercor":{ats:"ab",slug:"mercor"},
  "Mercury":{ats:"gh",slug:"mercury"},
  "Mistral AI":{ats:"lv",slug:"mistral"},
  "Modal":{ats:"ab",slug:"modal"},
  "Monte Carlo":{ats:"ab",slug:"montecarlodata"},
  "NICE":{ats:"gh",slug:"nice"},
  "Notion":{ats:"ab",slug:"notion"},
  "Numeric":{ats:"ab",slug:"numeric"},
  "Nuro":{ats:"gh",slug:"nuro"},
  "Omnea":{ats:"ab",slug:"omnea"},
  "OpenAI":{ats:"ab",slug:"openai"},
  "OpenEvidence":{ats:"ab",slug:"openevidence"},
  "Oura":{ats:"gh",slug:"oura"},
  "Pacaso":{ats:"gh",slug:"pacaso"},
  "Palantir":{ats:"lv",slug:"palantir"},
  "Parloa":{ats:"gh",slug:"parloa"},
  "Pearl Health":{ats:"ab",slug:"pearlhealth"},
  "Physical Intelligence":{ats:"ab",slug:"physicalintelligence"},
  "Pigment":{ats:"lv",slug:"pigment"},
  "Pika":{ats:"ab",slug:"pika"},
  "Pinecone":{ats:"ab",slug:"pinecone"},
  "Plaid":{ats:"ab",slug:"plaid"},
  "PostHog":{ats:"ab",slug:"posthog"},
  "Profound":{ats:"ab",slug:"profound"},
  "Ramp":{ats:"ab",slug:"ramp"},
  "Redwood Materials":{ats:"gh",slug:"redwoodmaterials"},
  "Remote":{ats:"gh",slug:"remote"},
  "Render":{ats:"ab",slug:"render"},
  "Replit":{ats:"ab",slug:"replit"},
  "Retool":{ats:"ab",slug:"retool"},
  "Rillet":{ats:"ab",slug:"rillet"},
  "Riskified":{ats:"gh",slug:"riskified"},
  "Ro":{ats:"lv",slug:"ro"},
  "Roblox":{ats:"gh",slug:"roblox"},
  "Runway":{ats:"ab",slug:"runway"},
  "Samsara":{ats:"gh",slug:"samsara"},
  "Saronic":{ats:"ab",slug:"saronic"},
  "Scale AI":{ats:"gh",slug:"scaleai"},
  "Serval":{ats:"ab",slug:"serval"},
  "Shield AI":{ats:"lv",slug:"shieldai"},
  "Sierra AI":{ats:"ab",slug:"sierra"},
  "Simular":{ats:"ab",slug:"simular"},
  "Sisense":{ats:"gh",slug:"sisense"},
  "Snorkel AI":{ats:"gh",slug:"snorkelai"},
  "Snowflake":{ats:"ab",slug:"snowflake"},
  "SpaceX":{ats:"gh",slug:"spacex"},
  "Speak":{ats:"ab",slug:"speak"},
  "Stability AI":{ats:"gh",slug:"stabilityai"},
  "Stainless":{ats:"ab",slug:"stainlessapi"},
  "Statsig":{ats:"ab",slug:"statsig"},
  "Steadily":{ats:"ab",slug:"steadily"},
  "Stripe":{ats:"gh",slug:"stripe"},
  "Suno":{ats:"ab",slug:"suno"},
  "Supabase":{ats:"ab",slug:"supabase"},
  "Swap":{ats:"ab",slug:"swap"},
  "Sword Health":{ats:"lv",slug:"swordhealth"},
  "Synthesia":{ats:"ab",slug:"synthesia"},
  "Tabs":{ats:"ab",slug:"tabs"},
  "Tanium":{ats:"gh",slug:"tanium"},
  "Thinking Machines":{ats:"gh",slug:"thinkingmachines"},
  "Thrive Market":{ats:"gh",slug:"thrivemarket"},
  "Tines":{ats:"gh",slug:"tines"},
  "Torq":{ats:"gh",slug:"torq"},
  "Truveta":{ats:"gh",slug:"truveta"},
  "Typeform":{ats:"gh",slug:"typeform"},
  "Unify":{ats:"ab",slug:"unify"},
  "Unstructured":{ats:"ab",slug:"unstructured"},
  "Vannevar Labs":{ats:"gh",slug:"vannevarlabs"},
  "Vanta":{ats:"ab",slug:"vanta"},
  "Vercel":{ats:"gh",slug:"vercel"},
  "Verkada":{ats:"gh",slug:"verkada"},
  "Warp":{ats:"gh",slug:"warp"},
  "Waymo":{ats:"gh",slug:"waymo"},
  "Wealthsimple":{ats:"ab",slug:"wealthsimple"},
  "Weaviate":{ats:"ab",slug:"weaviate"},
  "Webflow":{ats:"gh",slug:"webflow"},
  "Whatnot":{ats:"ab",slug:"whatnot"},
  "Whoop":{ats:"ab",slug:"whoop"},
  "Wrike":{ats:"gh",slug:"wrike"},
  "Writer":{ats:"ab",slug:"writer"},
  "Zip":{ats:"ab",slug:"zip"},
  "Zuora":{ats:"gh",slug:"zuora"},
  "n8n":{ats:"ab",slug:"n8n"},
  "xAI":{ats:"gh",slug:"xai"}
};

// Fetch from Greenhouse public API (no auth)
function fetchGreenhouse(name, slug) {
  var url = "https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs?content=true";
  return fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(function(r) { return r.ok ? r.json() : { jobs: [] }; })
    .then(function(data) {
      return (data.jobs || []).map(function(j) {
        var loc = j.location ? j.location.name : "";
        var isRemote = loc.toLowerCase().indexOf("remote") > -1;
        return {
          job_id: "gh_" + j.id,
          job_title: j.title,
          employer_name: name,
          employer_logo: null,
          job_city: null,
          job_state: null,
          job_country: null,
          job_is_remote: isRemote,
          job_apply_link: j.absolute_url,
          job_description: trimDesc((j.content || "").replace(/<[^>]+>/g, " ")),
          job_employment_type: null,
          job_min_salary: null,
          job_max_salary: null,
          job_salary_currency: null,
          job_salary_period: null,
          job_posted_at: j.updated_at || null,
          job_highlights: null,
          job_required_skills: [],
          _company: name,
          _loc: loc
        };
      });
    })
    .catch(function() { return []; });
}

// Fetch from Lever public API (no auth)
function fetchLever(name, slug) {
  var url = "https://api.lever.co/v0/postings/" + slug + "?mode=json";
  return fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(jobs) {
      return (jobs || []).map(function(j) {
        var loc = j.categories && j.categories.location ? j.categories.location : "";
        var isRemote = loc.toLowerCase().indexOf("remote") > -1;
        var desc = "";
        if (j.descriptionPlain) desc = j.descriptionPlain;
        else if (j.description) desc = j.description.replace(/<[^>]+>/g, " ");
        return {
          job_id: "lv_" + j.id,
          job_title: j.text,
          employer_name: name,
          employer_logo: null,
          job_city: null,
          job_state: null,
          job_country: null,
          job_is_remote: isRemote,
          job_apply_link: j.hostedUrl || j.applyUrl,
          job_description: trimDesc(desc),
          job_employment_type: j.categories && j.categories.commitment ? j.categories.commitment : null,
          job_min_salary: null,
          job_max_salary: null,
          job_salary_currency: null,
          job_salary_period: null,
          job_posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          job_highlights: null,
          job_required_skills: [],
          _company: name,
          _loc: loc
        };
      });
    })
    .catch(function() { return []; });
}

// Fetch from Recruitee public API (no auth)
function fetchRecruitee(name, slug) {
  var url = "https://" + slug + ".recruitee.com/api/offers";
  return fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(function(r) { return r.ok ? r.json() : { offers: [] }; })
    .then(function(data) {
      return (data.offers || []).map(function(j) {
        var loc = j.location || "";
        var isRemote = (j.remote === true) || loc.toLowerCase().indexOf("remote") > -1;
        var desc = "";
        if (j.description) desc = j.description.replace(/<[^>]+>/g, " ");
        return {
          job_id: "rc_" + j.id,
          job_title: j.title,
          employer_name: name,
          employer_logo: null,
          job_city: j.city || null,
          job_state: j.state || null,
          job_country: j.country || null,
          job_is_remote: isRemote,
          job_apply_link: j.careers_url || ("https://" + slug + ".recruitee.com/o/" + j.slug),
          job_description: trimDesc(desc),
          job_employment_type: j.employment_type || null,
          job_min_salary: j.min_salary || null,
          job_max_salary: j.max_salary || null,
          job_salary_currency: j.salary_currency || null,
          job_salary_period: null,
          job_posted_at: j.published_at || j.created_at || null,
          job_highlights: null,
          job_required_skills: [],
          _company: name,
          _loc: loc
        };
      });
    })
    .catch(function() { return []; });
}

// Fetch from Ashby public posting API (no auth)
function fetchAshby(name, slug) {
  var url = "https://api.ashbyhq.com/posting-api/job-board/" + slug + "?includeCompensation=true";
  return fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(function(r) { return r.ok ? r.json() : { jobs: [] }; })
    .then(function(data) {
      return (data.jobs || []).map(function(j) {
        var loc = j.location || "";
        var isRemote = j.isRemote === true || loc.toLowerCase().indexOf("remote") > -1;
        var minSal = null, maxSal = null, salCur = null;
        if (j.compensation && j.compensation.compensationTierSummary) {
          minSal = j.compensation.compensationTierSummary.min || null;
          maxSal = j.compensation.compensationTierSummary.max || null;
          salCur = j.compensation.compensationTierSummary.currency || null;
        }
        return {
          job_id: "ab_" + j.id,
          job_title: j.title,
          employer_name: name,
          employer_logo: null,
          job_city: null,
          job_state: null,
          job_country: null,
          job_is_remote: isRemote,
          job_apply_link: j.jobUrl || ("https://jobs.ashbyhq.com/" + slug + "/" + j.id),
          job_description: trimDesc((j.descriptionPlain || j.descriptionHtml || "").replace(/<[^>]+>/g, " ")),
          job_employment_type: j.employmentType || null,
          job_min_salary: minSal,
          job_max_salary: maxSal,
          job_salary_currency: salCur,
          job_salary_period: null,
          job_posted_at: j.publishedAt || null,
          job_highlights: null,
          job_required_skills: [],
          _company: name,
          _loc: loc
        };
      });
    })
    .catch(function() { return []; });
}

// ATS fallback — try Greenhouse, Lever, Recruitee, or Ashby
function fetchATS(name) {
  var m = ATS_MAP[name];
  if (!m) return Promise.resolve([]);
  if (m.ats === "gh") return fetchGreenhouse(name, m.slug);
  if (m.ats === "lv") return fetchLever(name, m.slug);
  if (m.ats === "rc") return fetchRecruitee(name, m.slug);
  if (m.ats === "ab") return fetchAshby(name, m.slug);
  return Promise.resolve([]);
}

// Smart description trimmer — strips legal/EEO boilerplate, keeps role details
function trimDesc(raw) {
  if (!raw) return "";
  var d = raw;
  // Strip HTML tags first
  d = d.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  d = d.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
       .replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  // Collapse whitespace
  d = d.replace(/\s{2,}/g, " ");

  // Strip "About the company" / mission / boilerplate sections
  var aboutCo = [
    /about\s+(us|the\s+company|our\s+company|our\s+team|our\s+mission|our\s+culture|who\s+we\s+are)[:\s].*?(?=(what\s+you|your\s+role|the\s+role|responsibilities|qualifications|requirements|preferred|nice\s+to\s+have|compensation|benefits|salary|about\s+the\s+(role|position|opportunity)|what\s+we('re|\s+are)\s+looking|$))/gis,
    /our\s+(mission|vision|values)\s+(is|are).*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|nice\s+to|compensation|benefits|$))/gis,
    /we\s+are\s+a\s+(leading|fast-growing|venture|innovative|mission).*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|compensation|benefits|$))/gis,
    /(^|\s)(at\s+)?[A-Z][a-z]+(\s+[A-Z][a-z]+)*\s+(is|was|are)\s+(a\s+)?(leading|fast-growing|venture-backed|innovative|cutting-edge|world-class|premier|global|next-gen).*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|compensation|benefits|we('re|\s+are)\s+looking|$))/gis,
    /founded\s+in\s+\d{4}.*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|compensation|$))/gis,
    /we\s+believe\s+(that|in).*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|compensation|$))/gis,
    /join\s+(us|our\s+team|a\s+team).*?(?=(what\s+you|the\s+role|responsibilities|qualifications|requirements|preferred|compensation|$))/gis,
  ];
  for (var a = 0; a < aboutCo.length; a++) {
    d = d.replace(aboutCo[a], " ");
  }

  // Strip EEO / legal boilerplate
  var cuts = [
    /equal\s*opportunity\s*employer.*/is,
    /we\s*are\s*(an?\s*)?equal.*/is,
    /e-verify.*/is,
    /this\s*employer\s*participates\s*in\s*e-verify.*/is,
    /we\s*do\s*not\s*discriminate.*/is,
    /accommodation.*disability.*/is,
    /all\s*qualified\s*applicants\s*will\s*receive.*/is,
    /pursuant\s*to\s*(the\s*)?(san\s*francisco|los\s*angeles|new\s*york|colorado).*/is,
    /pay\s*transparency\s*nondiscrimination.*/is,
    /export\s*control\s*regulations?.*/is,
    /this\s+position\s+is\s+not\s+eligible\s+for.*$/is,
    /note:\s+this\s+job\s+description.*$/is,
  ];
  for (var i = 0; i < cuts.length; i++) {
    d = d.replace(cuts[i], "");
  }
  d = d.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (d.length > 800) d = d.slice(0, 800) + "\u2026";
  return d;
}

function fetchCo(name, key) {
  var url = "https://" + HOST + "/search?query=" + encodeURIComponent('"' + name + '" jobs') + "&page=1&num_pages=1&employer=" + encodeURIComponent(name);
  return fetch(url, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
    signal: AbortSignal.timeout(5000) // 5s timeout per request
  })
  .then(function(resp) {
    if (!resp.ok) {
      if (resp.status === 429) {
        // Rate limited — wait 1s and retry once
        return new Promise(function(r) { setTimeout(r, 1000); })
          .then(function() {
            return fetch(url, {
              headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
              signal: AbortSignal.timeout(5000)
            });
          })
          .then(function(r2) { return r2.ok ? r2.json() : { data: [] }; })
          .then(function(d) { return d.status === "OK" ? d.data || [] : []; });
      }
      return [];
    }
    return resp.json().then(function(data) {
      if (data.status === "OK" && data.data) {
        var cn = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return data.data.filter(function(j) {
          var e = (j.employer_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          // Exact match or one contains the other, but reject if employer name is much longer (false positive)
          if (e === cn) return true;
          if (e.indexOf(cn) > -1 && e.length <= cn.length * 1.5) return true;
          if (cn.indexOf(e) > -1 && cn.length <= e.length * 1.5) return true;
          return false;
        }).map(function(j) {
          // Trim job_description — strip boilerplate, cap at 800 chars
          return {
            job_id: j.job_id,
            job_title: j.job_title,
            employer_name: j.employer_name,
            employer_logo: j.employer_logo,
            job_city: j.job_city,
            job_state: j.job_state,
            job_country: j.job_country,
            job_is_remote: j.job_is_remote,
            job_apply_link: j.job_apply_link,
            job_description: trimDesc(j.job_description),
            job_employment_type: j.job_employment_type || null,
            job_min_salary: j.job_min_salary || null,
            job_max_salary: j.job_max_salary || null,
            job_salary_currency: j.job_salary_currency || null,
            job_salary_period: j.job_salary_period || null,
            job_posted_at: j.job_posted_at_datetime_utc || null,
            job_highlights: j.job_highlights ? {
              qual: (j.job_highlights.Qualifications || []).slice(0, 8),
              resp: (j.job_highlights.Responsibilities || []).slice(0, 8),
              bene: (j.job_highlights.Benefits || []).slice(0, 6)
            } : null,
            job_required_skills: (j.job_required_skills || []).slice(0, 10),
            _company: name
          };
        });
      }
      return [];
    });
  })
  .catch(function() { return []; });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var KEY = process.env.RAPIDAPI_KEY;
  var provided = req.query.key;
  var chunk = parseInt(req.query.chunk) || 0;
  var chunkSize = 25; // Companies per chunk — 25 at 10 parallel = ~2-3s

  // Health check
  if (req.query.health) {
    return res.status(200).json({
      status: "HEALTH",
      companies_count: COMPANIES.length,
      chunks_needed: Math.ceil(COMPANIES.length / chunkSize),
      timestamp: new Date().toISOString()
    });
  }

  // No key = user request. If CDN has a cached version, Vercel serves it before
  // this code runs. If we're here, cache is cold.
  if (!provided) {
    // Explicitly prevent CDN from caching the NEEDS_REFRESH response
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json({
      status: "NEEDS_REFRESH",
      message: "Cache is cold. Falling back to live fetch.",
      data: []
    });
  }

  // Key provided = admin refresh
  if (provided !== KEY) return res.status(401).json({ error: "Invalid key" });
  if (!KEY) return res.status(500).json({ error: "Missing RAPIDAPI_KEY" });

  // Chunked crawl — process a slice of companies per call
  var start = chunk * chunkSize;
  var end = Math.min(start + chunkSize, COMPANIES.length);
  var batch = COMPANIES.slice(start, end);
  var isLastChunk = end >= COMPANIES.length;

  if (batch.length === 0) {
    return res.status(200).json({ status: "NO_MORE_CHUNKS", chunk: chunk });
  }

  // Fetch this chunk — split into ATS-mapped (authoritative) and JSearch-only
  var all = [];
  var parallelSize = 10;
  var atsMapped = batch.filter(function(n) { return !!ATS_MAP[n]; });
  var jsearchOnly = batch.filter(function(n) { return !ATS_MAP[n]; });

  // ATS-mapped companies: fetch directly from ATS (authoritative, returns ALL roles)
  for (var a = 0; a < atsMapped.length; a += parallelSize) {
    var atsBatch = atsMapped.slice(a, a + parallelSize);
    var atsResults = await Promise.all(
      atsBatch.map(function(n) { return fetchATS(n); })
    );
    atsResults.forEach(function(jobs) { if (jobs.length) all = all.concat(jobs); });
  }

  // JSearch-only companies: fetch from JSearch (supplementary)
  for (var i = 0; i < jsearchOnly.length; i += parallelSize) {
    var parallel = jsearchOnly.slice(i, i + parallelSize);
    var results = await Promise.all(
      parallel.map(function(n) { return fetchCo(n, KEY); })
    );
    for (var r = 0; r < results.length; r++) {
      if (results[r].length) {
        all = all.concat(results[r]);
      }
    }
  }

  var result = {
    status: "CHUNK_OK",
    chunk: chunk,
    chunks_total: Math.ceil(COMPANIES.length / chunkSize),
    is_last: isLastChunk,
    companies_in_chunk: batch.length,
    jobs_in_chunk: all.length,
    refreshed_at: new Date().toISOString(),
    data: all
  };

  // Only cache the combined result, not individual chunks
  // The PowerShell script assembles all chunks and hits /api/cache-write
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(result);
};
