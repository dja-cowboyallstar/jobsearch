// scripts/refresh-jobs.js
// Fetches jobs from all ATS-mapped companies + JSearch fallback
// Uploads results to Vercel Blob Storage
// Run: node scripts/refresh-jobs.js
// Requires env vars: RAPIDAPI_KEY, BLOB_READ_WRITE_TOKEN

const { put } = require("@vercel/blob");

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!RAPIDAPI_KEY) { console.error("Missing RAPIDAPI_KEY"); process.exit(1); }
if (!BLOB_TOKEN) { console.error("Missing BLOB_READ_WRITE_TOKEN"); process.exit(1); }

// ── ATS MAPPINGS ──

const ATS_MAP = {
  "1Password":{ats:"ab",slug:"1password"},"Abacum":{ats:"ab",slug:"abacum"},"Abnormal Security":{ats:"gh",slug:"abnormalsecurity"},"Abridge":{ats:"ab",slug:"abridge"},"Affirm":{ats:"gh",slug:"affirm"},"Airtable":{ats:"gh",slug:"airtable"},"Alchemy":{ats:"ab",slug:"alchemy"},"Alloy":{ats:"gh",slug:"alloy"},"AlphaSense":{ats:"gh",slug:"alphasense"},"Amplitude":{ats:"gh",slug:"amplitude"},"Anaplan":{ats:"gh",slug:"anaplan"},"Anduril":{ats:"gh",slug:"andurilindustries"},"Anthropic":{ats:"gh",slug:"anthropic"},"Apollo":{ats:"gh",slug:"apollo"},"AppLovin":{ats:"gh",slug:"applovin"},"Applied Intuition":{ats:"gh",slug:"appliedintuition"},"Apptronik":{ats:"gh",slug:"apptronik"},"Articulate":{ats:"lv",slug:"articulate"},"Ashby":{ats:"ab",slug:"ashby"},"Attentive":{ats:"gh",slug:"attentive"},"Benchling":{ats:"ab",slug:"benchling"},"Braze":{ats:"gh",slug:"braze"},"Brex":{ats:"gh",slug:"brex"},"Calendly":{ats:"gh",slug:"calendly"},"Calm":{ats:"gh",slug:"calm"},"Campfire":{ats:"ab",slug:"campfire"},"CaptivateIQ":{ats:"lv",slug:"captivateiq"},"Carta":{ats:"gh",slug:"carta"},"Celonis":{ats:"gh",slug:"celonis"},"Cerebras Systems":{ats:"gh",slug:"cerebrassystems"},"Chainguard":{ats:"gh",slug:"chainguard"},"ClickUp":{ats:"ab",slug:"clickup"},"Coast":{ats:"gh",slug:"coast"},"Cockroach Labs":{ats:"gh",slug:"cockroachlabs"},"Cognition AI":{ats:"ab",slug:"cognition"},"Cohere":{ats:"ab",slug:"cohere"},"Common Room":{ats:"ab",slug:"commonroom"},"Contentful":{ats:"gh",slug:"contentful"},"CoreWeave":{ats:"gh",slug:"coreweave"},"Coupa":{ats:"lv",slug:"coupa"},"Coursera":{ats:"gh",slug:"coursera"},"Crusoe":{ats:"ab",slug:"crusoe"},"Cube":{ats:"ab",slug:"cube"},"Databricks":{ats:"gh",slug:"databricks"},"Datadog":{ats:"gh",slug:"datadog"},"Datarails":{ats:"gh",slug:"datarails"},"Decagon":{ats:"ab",slug:"decagon"},"Deel":{ats:"ab",slug:"deel"},"DeepL":{ats:"ab",slug:"deepl"},"Discord":{ats:"gh",slug:"discord"},"Doppler":{ats:"ab",slug:"doppler"},"DOSS":{ats:"ab",slug:"doss"},"Drata":{ats:"ab",slug:"drata"},"Drivetrain":{ats:"lv",slug:"drivetrain"},"DualEntry":{ats:"rc",slug:"dualentry"},"Duolingo":{ats:"gh",slug:"duolingo"},"ElevenLabs":{ats:"ab",slug:"elevenlabs"},"Esusu":{ats:"gh",slug:"esusu"},"Faire":{ats:"gh",slug:"faire"},"Figma":{ats:"gh",slug:"figma"},"Figure AI":{ats:"gh",slug:"figureai"},"Fivetran":{ats:"gh",slug:"fivetran"},"Flexport":{ats:"gh",slug:"flexport"},"FloQast":{ats:"lv",slug:"floqast"},"Form Energy":{ats:"ab",slug:"formenergy"},"Forter":{ats:"gh",slug:"forter"},"Glean":{ats:"gh",slug:"gleanwork"},"GoCardless":{ats:"gh",slug:"gocardless"},"Gong":{ats:"rc",slug:"gong"},"Grafana Labs":{ats:"gh",slug:"grafanalabs"},"Gusto":{ats:"gh",slug:"gusto"},"Halcyon":{ats:"gh",slug:"halcyon"},"Handshake":{ats:"ab",slug:"handshake"},"Harvey AI":{ats:"ab",slug:"harvey"},"Hebbia":{ats:"gh",slug:"hebbia"},"Highspot":{ats:"lv",slug:"highspot"},"Hightouch":{ats:"gh",slug:"hightouch"},"Inflection AI":{ats:"gh",slug:"inflectionai"},"Intercom":{ats:"gh",slug:"intercom"},"Kalshi":{ats:"ab",slug:"kalshi"},"Klaviyo":{ats:"gh",slug:"klaviyo"},"Lambda":{ats:"ab",slug:"lambda"},"LangChain":{ats:"ab",slug:"langchain"},"LaunchDarkly":{ats:"gh",slug:"launchdarkly"},"Lattice":{ats:"gh",slug:"lattice"},"Lightdash":{ats:"ab",slug:"lightdash"},"Linear":{ats:"ab",slug:"linear"},"Lovable":{ats:"ab",slug:"lovable"},"Melio":{ats:"gh",slug:"melio"},"Mercor":{ats:"ab",slug:"mercor"},"Mercury":{ats:"gh",slug:"mercury"},"Mistral AI":{ats:"lv",slug:"mistral"},"Modal":{ats:"ab",slug:"modal"},"Monte Carlo":{ats:"ab",slug:"montecarlodata"},"Moveworks":{ats:"ab",slug:"moveworks"},"n8n":{ats:"ab",slug:"n8n"},"NICE":{ats:"gh",slug:"nice"},"Notion":{ats:"ab",slug:"notion"},"Numeric":{ats:"ab",slug:"numeric"},"Nuro":{ats:"gh",slug:"nuro"},"Omnea":{ats:"ab",slug:"omnea"},"OpenAI":{ats:"ab",slug:"openai"},"OpenEvidence":{ats:"ab",slug:"openevidence"},"Oura":{ats:"gh",slug:"oura"},"Pacaso":{ats:"gh",slug:"pacaso"},"Palantir":{ats:"lv",slug:"palantir"},"Parloa":{ats:"gh",slug:"parloa"},"Pearl Health":{ats:"ab",slug:"pearlhealth"},"Physical Intelligence":{ats:"ab",slug:"physicalintelligence"},"Pigment":{ats:"lv",slug:"pigment"},"Pika":{ats:"ab",slug:"pika"},"Pinecone":{ats:"ab",slug:"pinecone"},"Plaid":{ats:"ab",slug:"plaid"},"PostHog":{ats:"ab",slug:"posthog"},"Profound":{ats:"ab",slug:"profound"},"Ramp":{ats:"ab",slug:"ramp"},"Redwood Materials":{ats:"gh",slug:"redwoodmaterials"},"Remote":{ats:"gh",slug:"remote"},"Render":{ats:"ab",slug:"render"},"Replit":{ats:"ab",slug:"replit"},"Retool":{ats:"ab",slug:"retool"},"Rillet":{ats:"ab",slug:"rillet"},"Riskified":{ats:"gh",slug:"riskified"},"Ro":{ats:"lv",slug:"ro"},"Roblox":{ats:"gh",slug:"roblox"},"Runway":{ats:"ab",slug:"runway"},"Samsara":{ats:"gh",slug:"samsara"},"Saronic":{ats:"ab",slug:"saronic"},"Scale AI":{ats:"gh",slug:"scaleai"},"Serval":{ats:"ab",slug:"serval"},"Shield AI":{ats:"lv",slug:"shieldai"},"Sierra AI":{ats:"ab",slug:"sierra"},"Simular":{ats:"ab",slug:"simular"},"Sisense":{ats:"gh",slug:"sisense"},"Snorkel AI":{ats:"gh",slug:"snorkelai"},"Snowflake":{ats:"ab",slug:"snowflake"},"SpaceX":{ats:"gh",slug:"spacex"},"Speak":{ats:"ab",slug:"speak"},"Spring Health":{ats:"ab",slug:"springhealth"},"Stability AI":{ats:"gh",slug:"stabilityai"},"Stainless":{ats:"ab",slug:"stainlessapi"},"Statsig":{ats:"ab",slug:"statsig"},"Steadily":{ats:"ab",slug:"steadily"},"Stripe":{ats:"gh",slug:"stripe"},"Suno":{ats:"ab",slug:"suno"},"Supabase":{ats:"ab",slug:"supabase"},"Swap":{ats:"ab",slug:"swap"},"Sword Health":{ats:"lv",slug:"swordhealth"},"Synthesia":{ats:"ab",slug:"synthesia"},"Tanium":{ats:"gh",slug:"tanium"},"Thinking Machines":{ats:"gh",slug:"thinkingmachines"},"Thrive Market":{ats:"gh",slug:"thrivemarket"},"Tines":{ats:"gh",slug:"tines"},"Torq":{ats:"gh",slug:"torq"},"Truveta":{ats:"gh",slug:"truveta"},"Typeform":{ats:"gh",slug:"typeform"},"Unify":{ats:"ab",slug:"unify"},"Unstructured":{ats:"ab",slug:"unstructured"},"Vanta":{ats:"ab",slug:"vanta"},"Vannevar Labs":{ats:"gh",slug:"vannevarlabs"},"Vercel":{ats:"gh",slug:"vercel"},"Verkada":{ats:"gh",slug:"verkada"},"Warp":{ats:"gh",slug:"warp"},"Waymo":{ats:"gh",slug:"waymo"},"Wealthsimple":{ats:"ab",slug:"wealthsimple"},"Weaviate":{ats:"ab",slug:"weaviate"},"Webflow":{ats:"gh",slug:"webflow"},"Whatnot":{ats:"ab",slug:"whatnot"},"Whoop":{ats:"ab",slug:"whoop"},"Wrike":{ats:"gh",slug:"wrike"},"Writer":{ats:"ab",slug:"writer"},"xAI":{ats:"gh",slug:"xai"},"Zip":{ats:"ab",slug:"zip"},"Zuora":{ats:"gh",slug:"zuora"},"Fireworks AI":{ats:"gh",slug:"fireworksai"},"Baseten":{ats:"ab",slug:"baseten"},"EvenUp":{ats:"ab",slug:"evenup"},"EliseAI":{ats:"ab",slug:"eliseai"},"Luma AI":{ats:"ab",slug:"luma-ai"},"Ambience Healthcare":{ats:"ab",slug:"ambiencehealthcare"},"Sesame":{ats:"ab",slug:"sesame"},"You.com":{ats:"gh",slug:"youcom"},"Uniphore":{ats:"lv",slug:"uniphore"},"Eudia":{ats:"gh",slug:"eudia"}
};

const ALL_COMPANIES = [...new Set([
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
  "Peec AI","DOSS","Crusoe","VAST Data","Thinking Machines Lab","Speak","OpenEvidence","Decagon",
  "Luminance","Hebbia","Coactive AI","Weights & Biases","Adept AI","Wrike","Amplitude","Airtable",
  "Freshworks","HashiCorp","Contentful","GitLab","Miro","ClickUp","Webflow","Warp",
  "Verkada","Applied Intuition","Nuro","Articulate","Grammarly","Relativity Space","Corebridge Financial","Sword Health",
  "Nuvei","Bain & Company","Trader Joe's","Box","Procore","Calm","Built Technologies","Hinge Health",
  "Alto Pharmacy","Findigs","Coast","Wealthsimple","Calendly","Typeform","Remote","Waymo",
  "Omnea","Bolt","Stability AI","Inflection AI","Modal","Pinecone","Weaviate","Character AI",
  "Midjourney","Synthesia","Coupa","Cockroach Labs","LaunchDarkly","Fivetran","Monte Carlo","Snorkel AI",
  "Alchemy","Braze","Kong","Harness","SentinelOne","1Password","Tanium","Arctic Wolf",
  "Noom","Ro","Devoted Health","Oscar Health","Outreach","Seismic","Highspot","Attentive",
  "Klaviyo","Forter","Flutterwave","GoCardless","Melio","Kalshi","Hex","Tome",
  "Orb","Statsig","Stainless","Codeium","Graphiant","Affirm","Pluralsight","Riskified",
  "Alloy","Zuora","Tropic","Doppler","Flatfile","Render","Roblox","Campfire",
  "DualEntry","Light","Tabs","Base44","Samsara","Rillet","Skild AI","DeepL",
  "Swap","Kore.ai","Wise","Aisera","NICE","Cognigy","Intercom","Numeric",
  "Pega","Mercor","Apollo","n8n","Tines","Torq","Parloa","MainFunc",
  "Darwinbox","Ashby","Hightouch","DevRev","Basis","Profound","Unify","Giga",
  "Synthflow AI","Simular","Anaplan","OneStream","Wolters Kluwer","Board International","Jedox","Pigment",
  "Abacum","Runway Financial","Datarails","Cube","Drivetrain","Vena Solutions","Planful","Nominal",
  "FloQast","BlackLine","Accrual","ThoughtSpot","Domo","Sisense","Sigma Computing","Deepnote",
  "Pyramid Analytics","Omni Analytics","Lightdash","Bryant Park Consulting","Echo Park Consulting",
  "Fireworks AI","Baseten","EliseAI","Sesame","You.com","Modular","Luma AI","Uniphore","Eudia","Ambience Healthcare"
])];

// ── FETCH HELPERS ──

function trimDesc(html) {
  if (!html) return "";
  var t = html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  return t.length > 800 ? t.substring(0, 800) : t;
}

function parseQualifications(html) {
  if (!html) return { must: [], nice: [] };
  var text = html
    .replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?(ul|ol|p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
  var mustH = [/(?:^|\n)\s*(?:#{1,3}\s*)?(?:minimum\s+)?(?:required\s+)?qualifications?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?requirements?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?what\s+(?:you['']ll\s+need|we['']re\s+looking\s+for|you\s+(?:should\s+)?(?:have|bring))\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:about\s+)?you(?:r\s+(?:background|experience|skills))?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?who\s+you\s+are\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?must[- ]haves?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?key\s+(?:qualifications?|requirements?|skills?)\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?you\s+(?:may\s+be\s+a\s+fit|might\s+thrive)\s+if\s*[:：\n]/i];
  var niceH = [/(?:^|\n)\s*(?:#{1,3}\s*)?(?:preferred|desired)\s+qualifications?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?nice\s+to\s+haves?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?bonus\s+(?:points?|qualifications?|skills?)\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:ideally|it(?:'s|\s+would\s+be)\s+(?:great|nice|helpful))\s+(?:if\s+)?(?:you)?\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?extra\s+credit\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?plus\s+if\s+you\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:preferred|additional)\s+(?:experience|skills?|background)\s*[:：\n]/i];
  var endM = [/(?:^|\n)\s*(?:#{1,3}\s*)?(?:what\s+we\s+offer|benefits?|compensation|perks?|why\s+(?:join|work))\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?about\s+[A-Z]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:the\s+)?(?:annual\s+)?(?:salary|compensation)\s+(?:range|for)\s*/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:equal\s+opportunity|we\s+(?:are\s+)?(?:committed|an?\s+equal))\s*/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:not\s+all\s+strong\s+candidates)\s*/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:location|visa|how\s+to\s+apply|application|deadline)\s*[:：\n]/i,/(?:^|\n)\s*(?:#{1,3}\s*)?(?:our\s+mission|we\s+believe|at\s+\w+,\s+we)\s*/i];
  function findSec(hdrs){var best=null;for(var i=0;i<hdrs.length;i++){var m=text.match(hdrs[i]);if(m){var idx=text.indexOf(m[0])+m[0].length;if(!best||idx<best)best=idx;}}return best;}
  function findEnd(si){var rem=text.substring(si),ear=rem.length,all=mustH.concat(niceH).concat(endM);for(var i=0;i<all.length;i++){var m=rem.match(all[i]);if(m){var p=rem.indexOf(m[0]);if(p>0&&p<ear)ear=p;}}return si+ear;}
  function extract(sec){var lines=sec.split('\n'),out=[];for(var i=0;i<lines.length;i++){var l=lines[i].replace(/^[\s•·\-–—*▸►→●○◦■□▪▫]+/,'').trim();if(l.length<10||l.length>300)continue;if(/^(anthropic|we believe|the easiest|this research|at \w+,? we|our mission)/i.test(l))continue;if(/^\w[\w\s]{0,20}\s+is\s+(?:a|an|the)\s/i.test(l))continue;if(/^about\s+/i.test(l))continue;out.push(l);}return out.slice(0,12);}
  var ms=findSec(mustH),ns=findSec(niceH),must=[],nice=[];
  if(ms!==null){var me=findEnd(ms);if(ns!==null&&ns>ms&&ns<me)me=text.lastIndexOf('\n',ns);must=extract(text.substring(ms,me));}
  if(ns!==null){nice=extract(text.substring(ns,findEnd(ns)));}
  return {must:must,nice:nice};
}

async function fetchJson(url, options) {
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 15000);
  try {
    var r = await fetch(url, Object.assign({ signal: controller.signal }, options || {}));
    clearTimeout(timeout);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

async function fetchGreenhouse(name, slug) {
  var d = await fetchJson("https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs?content=true");
  if (!d || !d.jobs) return [];
  return d.jobs.map(function(j) {
    var q = parseQualifications(j.content);
    return { job_id: "gh_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.absolute_url, job_description: trimDesc(j.content), job_posted_at: j.updated_at, _company: name, _loc: j.location ? j.location.name : "", _must: q.must, _nice: q.nice };
  });
}

async function fetchAshby(name, slug) {
  var d = await fetchJson("https://api.ashbyhq.com/posting-api/job-board/" + slug + "?includeCompensation=true");
  if (!d || !d.jobs) return [];
  return d.jobs.map(function(j) {
    var minSal = null, maxSal = null;
    if (j.compensation && j.compensation.compensationTierSummary) {
      minSal = j.compensation.compensationTierSummary.min;
      maxSal = j.compensation.compensationTierSummary.max;
    }
    var q = parseQualifications(j.descriptionHtml || j.descriptionPlain);
    return { job_id: "ab_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.jobUrl || ("https://jobs.ashbyhq.com/" + slug + "/" + j.id), job_description: trimDesc(j.descriptionPlain || j.descriptionHtml), job_employment_type: j.employmentType || null, job_min_salary: minSal, job_max_salary: maxSal, job_posted_at: j.publishedAt || null, _company: name, _loc: j.location || "", _must: q.must, _nice: q.nice };
  });
}

async function fetchLever(name, slug) {
  var d = await fetchJson("https://api.lever.co/v0/postings/" + slug + "?mode=json");
  if (!d || !Array.isArray(d)) return [];
  return d.map(function(j) {
    var q = parseQualifications(j.description || j.descriptionPlain);
    return { job_id: "lv_" + j.id, job_title: j.text, employer_name: name, job_apply_link: j.hostedUrl || j.applyUrl, job_description: trimDesc(j.descriptionPlain || j.description), job_employment_type: j.categories && j.categories.commitment ? j.categories.commitment : null, job_posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, _company: name, _loc: j.categories && j.categories.location ? j.categories.location : "", _must: q.must, _nice: q.nice };
  });
}

async function fetchRecruitee(name, slug) {
  var d = await fetchJson("https://" + slug + ".recruitee.com/api/offers");
  if (!d || !d.offers) return [];
  return d.offers.map(function(j) {
    var q = parseQualifications(j.description);
    return { job_id: "rc_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.careers_url || ("https://" + slug + ".recruitee.com/o/" + j.slug), job_description: trimDesc(j.description), job_employment_type: j.employment_type || null, job_min_salary: j.min_salary || null, job_max_salary: j.max_salary || null, job_posted_at: j.published_at || null, _company: name, _loc: j.location || "", _must: q.must, _nice: q.nice };
  });
}

async function fetchJSearch(name) {
  var q = encodeURIComponent('"' + name + '" jobs');
  var d = await fetchJson("https://jsearch.p.rapidapi.com/search?query=" + q + "&page=1&num_pages=1", {
    headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": "jsearch.p.rapidapi.com" }
  });
  if (!d || d.status !== "OK" || !d.data) return [];
  var cn = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return d.data.filter(function(j) {
    var e = (j.employer_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (e === cn) return true;
    if (e.indexOf(cn) > -1 && e.length <= cn.length * 1.5) return true;
    if (cn.indexOf(e) > -1 && cn.length <= e.length * 1.5) return true;
    return false;
  }).map(function(j) {
    var q = parseQualifications(j.job_description);
    return { job_id: j.job_id, job_title: j.job_title, employer_name: j.employer_name, employer_logo: j.employer_logo, job_apply_link: j.job_apply_link, job_description: trimDesc(j.job_description), job_employment_type: j.job_employment_type || null, job_min_salary: j.job_min_salary || null, job_max_salary: j.job_max_salary || null, job_posted_at: j.job_posted_at_datetime_utc || null, _company: name, _loc: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "), _must: q.must, _nice: q.nice };
  });
}

async function fetchCompany(name) {
  var mapping = ATS_MAP[name];
  var jobs = [];
  if (mapping) {
    switch (mapping.ats) {
      case "gh": jobs = await fetchGreenhouse(name, mapping.slug); break;
      case "ab": jobs = await fetchAshby(name, mapping.slug); break;
      case "lv": jobs = await fetchLever(name, mapping.slug); break;
      case "rc": jobs = await fetchRecruitee(name, mapping.slug); break;
    }
  }
  if (jobs.length === 0) {
    jobs = await fetchJSearch(name);
  }
  return jobs;
}

// ── MAIN ──

async function main() {
  console.log("=== ASCENT REFRESH START ===");
  console.log("Companies: " + ALL_COMPANIES.length + ", ATS-mapped: " + Object.keys(ATS_MAP).length);

  var allJobs = [];
  var batchSize = 10;

  for (var i = 0; i < ALL_COMPANIES.length; i += batchSize) {
    var batch = ALL_COMPANIES.slice(i, i + batchSize);
    var batchNum = Math.floor(i / batchSize) + 1;
    var totalBatches = Math.ceil(ALL_COMPANIES.length / batchSize);
    console.log("Batch " + batchNum + "/" + totalBatches + ": " + batch.join(", "));

    var results = await Promise.all(batch.map(fetchCompany));
    for (var r = 0; r < results.length; r++) {
      if (results[r].length > 0) {
        allJobs = allJobs.concat(results[r]);
        console.log("  " + batch[r] + ": " + results[r].length + " jobs");
      } else {
        console.log("  " + batch[r] + ": 0 jobs");
      }
    }

    // Brief pause between batches to avoid rate limits
    if (i + batchSize < ALL_COMPANIES.length) {
      await new Promise(function(resolve) { setTimeout(resolve, 300); });
    }
  }

  console.log("Fetch complete: " + allJobs.length + " jobs");

  // ── VALIDATION ──
  var jobsByCompany = {};
  allJobs.forEach(function(j) {
    var co = j._company || j.employer_name || "Unknown";
    jobsByCompany[co] = (jobsByCompany[co] || 0) + 1;
  });
  var companiesWithJobs = Object.keys(jobsByCompany).length;
  var companiesWithZero = ALL_COMPANIES.filter(function(c) { return !jobsByCompany[c]; });

  console.log("\n=== REFRESH VALIDATION ===");
  console.log("Companies on site: " + ALL_COMPANIES.length);
  console.log("Companies with jobs: " + companiesWithJobs);
  console.log("Companies with ZERO jobs: " + companiesWithZero.length);
  if (companiesWithZero.length > 0) {
    console.log("WARNING — These companies returned 0 jobs:");
    companiesWithZero.forEach(function(c) {
      var mapping = ATS_MAP[c];
      var source = mapping ? mapping.ats + ":" + mapping.slug : "jsearch-fallback";
      console.log("  ⚠ " + c + " (" + source + ")");
    });
  }
  console.log("Coverage: " + Math.round((companiesWithJobs / ALL_COMPANIES.length) * 100) + "%");
  var jobsWithQuals = allJobs.filter(function(j) { return (j._must && j._must.length > 0) || (j._nice && j._nice.length > 0); }).length;
  console.log("Jobs with parsed qualifications: " + jobsWithQuals + "/" + allJobs.length + " (" + Math.round((jobsWithQuals / Math.max(allJobs.length, 1)) * 100) + "%)");
  console.log("========================\n");

  // Build the output
  var output = JSON.stringify({
    status: "OK",
    refreshed_at: new Date().toISOString(),
    total_jobs: allJobs.length,
    data: allJobs
  });

  var sizeMB = (Buffer.byteLength(output, "utf8") / (1024 * 1024)).toFixed(2);
  console.log("JSON size: " + sizeMB + " MB");

  // Upload to Vercel Blob
  console.log("Uploading to Vercel Blob...");
  try {
    var blob = await put("jobs-data.json", output, {
      access: "public",
      contentType: "application/json",
      token: BLOB_TOKEN,
      addRandomSuffix: false
    });
    console.log("UPLOADED: " + blob.url);
    console.log("=== ASCENT REFRESH COMPLETE ===");
  } catch (e) {
    console.error("UPLOAD FAILED: " + e.message);
    process.exit(1);
  }
}

main().catch(function(e) {
  console.error("FATAL: " + e.message);
  process.exit(1);
});

