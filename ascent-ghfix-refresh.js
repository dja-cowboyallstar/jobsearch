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
  var t = html
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  return t.length > 800 ? t.substring(0, 800) : t;
}

function parseQualifications(html) {
  if (!html) return { must: [], nice: [], bene: [] };
  var text = html
    // Step 1: Decode entities FIRST (handle double-encoding)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    // Second pass for double-encoded entities
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    // Step 2: Now strip HTML tags (they're real tags after decode)
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
  return {must:must,nice:nice,bene:bene};
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
    return { job_id: "gh_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.absolute_url, job_description: trimDesc(j.content), job_posted_at: j.updated_at, _company: name, _loc: j.location ? j.location.name : "", _must: q.must, _nice: q.nice, _bene: q.bene };
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
    return { job_id: "ab_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.jobUrl || ("https://jobs.ashbyhq.com/" + slug + "/" + j.id), job_description: trimDesc(j.descriptionPlain || j.descriptionHtml), job_employment_type: j.employmentType || null, job_min_salary: minSal, job_max_salary: maxSal, job_posted_at: j.publishedAt || null, _company: name, _loc: j.location || "", _must: q.must, _nice: q.nice, _bene: q.bene };
  });
}

async function fetchLever(name, slug) {
  var d = await fetchJson("https://api.lever.co/v0/postings/" + slug + "?mode=json");
  if (!d || !Array.isArray(d)) return [];
  return d.map(function(j) {
    var q = parseQualifications(j.description || j.descriptionPlain);
    return { job_id: "lv_" + j.id, job_title: j.text, employer_name: name, job_apply_link: j.hostedUrl || j.applyUrl, job_description: trimDesc(j.descriptionPlain || j.description), job_employment_type: j.categories && j.categories.commitment ? j.categories.commitment : null, job_posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null, _company: name, _loc: j.categories && j.categories.location ? j.categories.location : "", _must: q.must, _nice: q.nice, _bene: q.bene };
  });
}

async function fetchRecruitee(name, slug) {
  var d = await fetchJson("https://" + slug + ".recruitee.com/api/offers");
  if (!d || !d.offers) return [];
  return d.offers.map(function(j) {
    var q = parseQualifications(j.description);
    return { job_id: "rc_" + j.id, job_title: j.title, employer_name: name, job_apply_link: j.careers_url || ("https://" + slug + ".recruitee.com/o/" + j.slug), job_description: trimDesc(j.description), job_employment_type: j.employment_type || null, job_min_salary: j.min_salary || null, job_max_salary: j.max_salary || null, job_posted_at: j.published_at || null, _company: name, _loc: j.location || "", _must: q.must, _nice: q.nice, _bene: q.bene };
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
    return { job_id: j.job_id, job_title: j.job_title, employer_name: j.employer_name, employer_logo: j.employer_logo, job_apply_link: j.job_apply_link, job_description: trimDesc(j.job_description), job_employment_type: j.job_employment_type || null, job_min_salary: j.job_min_salary || null, job_max_salary: j.job_max_salary || null, job_posted_at: j.job_posted_at_datetime_utc || null, _company: name, _loc: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "), _must: q.must, _nice: q.nice, _bene: q.bene };
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
  console.log("[BUILD:2026-04-04T19:00] Parser active, validator active");
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

  // ── LOCATION NORMALIZER ──
  var CITY_ALIASES = {
    // San Francisco Bay Area
    "san francisco":"San Francisco Bay Area","sf":"San Francisco Bay Area",
    "san francisco bay area":"San Francisco Bay Area",
    "menlo park":"San Francisco Bay Area","palo alto":"San Francisco Bay Area",
    "sunnyvale":"San Francisco Bay Area","san mateo":"San Francisco Bay Area",
    "mountain view":"San Francisco Bay Area","cupertino":"San Francisco Bay Area",
    "redwood city":"San Francisco Bay Area","south san francisco":"San Francisco Bay Area",
    "san jose":"San Francisco Bay Area","santa clara":"San Francisco Bay Area",
    "burlingame":"San Francisco Bay Area","foster city":"San Francisco Bay Area",
    "milpitas":"San Francisco Bay Area","fremont":"San Francisco Bay Area",
    // New York
    "new york":"New York","new york city":"New York","nyc":"New York","manhattan":"New York",
    "brooklyn":"New York","jersey city":"New York",
    // Seattle
    "seattle":"Seattle","redmond":"Seattle","bellevue":"Seattle","kirkland":"Seattle",
    // Austin
    "austin":"Austin","bastrop":"Austin","starbase":"Austin",
    // Los Angeles
    "los angeles":"Los Angeles","la":"Los Angeles","hawthorne":"Los Angeles",
    "santa monica":"Los Angeles","culver city":"Los Angeles","playa vista":"Los Angeles",
    "el segundo":"Los Angeles","marina del rey":"Los Angeles","pasadena":"Los Angeles",
    // Boston
    "boston":"Boston","cambridge":"Boston","somerville":"Boston",
    // Washington DC
    "washington":"Washington DC","washington dc":"Washington DC","arlington":"Washington DC",
    "mclean":"Washington DC","reston":"Washington DC","bethesda":"Washington DC",
    // Chicago
    "chicago":"Chicago",
    // Denver
    "denver":"Denver","boulder":"Denver",
    // Dallas
    "dallas":"Dallas","plano":"Dallas","irving":"Dallas","fort worth":"Dallas",
    // Costa Mesa / Orange County
    "costa mesa":"Costa Mesa","irvine":"Costa Mesa",
    // London
    "london":"London",
    // Paris
    "paris":"Paris",
    // Berlin
    "berlin":"Berlin",
    // Dublin
    "dublin":"Dublin",
    // Amsterdam
    "amsterdam":"Amsterdam",
    // Toronto
    "toronto":"Toronto","waterloo":"Toronto",
    // Tokyo
    "tokyo":"Tokyo",
    // Singapore
    "singapore":"Singapore",
    // Tel Aviv
    "tel aviv":"Tel Aviv",
    // Munich
    "munich":"Munich","münchen":"Munich",
    // Bangalore
    "bangalore":"Bangalore","bengaluru":"Bangalore",
    // Sydney
    "sydney":"Sydney",
    // Other
    "remote":"Remote"
  };
  var REMOTE_REGIONS = {
    "us":"US","usa":"US","united states":"US","u.s.":"US","north america":"US",
    "eu":"EU","europe":"EU","emea":"EU",
    "latam":"LATAM","latin america":"LATAM","south america":"LATAM",
    "apac":"APAC","asia":"APAC","asia pacific":"APAC",
    "global":"Global","worldwide":"Global","anywhere":"Global",
    "uk":"EU","canada":"US","india":"APAC","japan":"APAC"
  };
  function normalizeLocation(loc) {
    if (!loc) return { _city: null, _remote: false, _remote_region: null };
    var raw = loc.trim();
    var isRemote = /\bremote\b/i.test(raw);
    var remoteRegion = null;
    if (isRemote) {
      // Extract region from patterns like "Remote - US", "Remote (EU)", "Remote, LATAM"
      var regionMatch = raw.match(/remote\s*[\-\(\,\|\/]\s*([A-Za-z\s\.]+)/i);
      if (regionMatch) {
        var rk = regionMatch[1].trim().toLowerCase().replace(/[\)\]]/g, "");
        remoteRegion = REMOTE_REGIONS[rk] || null;
      }
      if (!remoteRegion && /\bremote\b/i.test(raw) && raw.replace(/remote/i, "").trim().length < 3) {
        remoteRegion = "Global";
      }
    }
    // Strip common suffixes and prefixes for city extraction
    var clean = raw
      .replace(/\s*\(HQ\)/gi, "")
      .replace(/\s*-\s*US$/i, "")
      .replace(/^US-[A-Z]{2}-/i, "")
      .replace(/,?\s*United States$/i, "")
      .replace(/,?\s*USA$/i, "")
      .replace(/,?\s*US$/i, "")
      .replace(/,?\s*United Kingdom$/i, "")
      .replace(/,?\s*UK$/i, "")
      .replace(/,?\s*Germany$/i, "")
      .replace(/,?\s*France$/i, "")
      .replace(/,?\s*Ireland$/i, "")
      .replace(/,?\s*Japan$/i, "")
      .replace(/,?\s*Canada$/i, "")
      .replace(/,?\s*Australia$/i, "")
      .replace(/,?\s*India$/i, "")
      .replace(/,?\s*Israel$/i, "")
      .replace(/,?\s*Netherlands$/i, "")
      .replace(/,?\s*Spain$/i, "")
      .replace(/,?\s*Poland$/i, "")
      .replace(/,?\s*Switzerland$/i, "")
      .replace(/,?\s*[A-Z]{2}$/g, "") // trailing state codes like ", CA"
      .replace(/,?\s*(?:California|Texas|Washington|Massachusetts|New York|Virginia|Colorado|Illinois|Georgia|Oregon|Maryland|Connecticut|North Carolina|Pennsylvania|District of Columbia|Florida)$/i, "")
      .trim();
    // Try to match the cleaned city
    var cityKey = clean.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    var city = CITY_ALIASES[cityKey] || null;
    // If no match, try first token before comma
    if (!city && clean.indexOf(",") > -1) {
      var firstPart = clean.split(",")[0].trim().toLowerCase().replace(/[^a-z\s]/g, "").trim();
      city = CITY_ALIASES[firstPart] || null;
    }
    // If still no match but we have a multi-location string (semicolons), try first location
    if (!city && raw.indexOf(";") > -1) {
      var firstLoc = raw.split(";")[0].trim();
      var fl = firstLoc.toLowerCase().replace(/[^a-z\s]/g, "").trim();
      city = CITY_ALIASES[fl] || null;
    }
    // For pure "Remote" strings, city stays null
    if (isRemote && !city) city = null;
    return { _city: city, _remote: isRemote, _remote_region: remoteRegion };
  }
  // Apply normalizer to all jobs
  allJobs.forEach(function(j) {
    var norm = normalizeLocation(j._loc);
    j._city = norm._city;
    j._remote = norm._remote;
    j._remote_region = norm._remote_region;
  });
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
  var jobsWithQuals = allJobs.filter(function(j) { return (j._must && j._must.length > 0) || (j._nice && j._nice.length > 0) || (j._bene && j._bene.length > 0); }).length;
  var jobsWithReq = allJobs.filter(function(j) { return j._must && j._must.length > 0; }).length;
  var jobsWithAdd = allJobs.filter(function(j) { return j._nice && j._nice.length > 0; }).length;
  var jobsWithBene = allJobs.filter(function(j) { return j._bene && j._bene.length > 0; }).length;
  console.log("Jobs with parsed qualifications: " + jobsWithQuals + "/" + allJobs.length + " (" + Math.round((jobsWithQuals / Math.max(allJobs.length, 1)) * 100) + "%)");
  console.log("  Required: " + jobsWithReq + " | Additional: " + jobsWithAdd + " | Benefits: " + jobsWithBene);

  // Source distribution and per-source parse rates
  var sources = { gh: {total:0,parsed:0}, ab: {total:0,parsed:0}, lv: {total:0,parsed:0}, rc: {total:0,parsed:0}, js: {total:0,parsed:0} };
  allJobs.forEach(function(j) {
    var id = j.job_id || "";
    var src = id.startsWith("gh_") ? "gh" : id.startsWith("ab_") ? "ab" : id.startsWith("lv_") ? "lv" : id.startsWith("rc_") ? "rc" : "js";
    sources[src].total++;
    if ((j._must && j._must.length > 0) || (j._nice && j._nice.length > 0) || (j._bene && j._bene.length > 0)) sources[src].parsed++;
  });
  console.log("\n=== SOURCE DISTRIBUTION ===");
  Object.keys(sources).forEach(function(k) {
    var s = sources[k];
    var pct = s.total > 0 ? Math.round(s.parsed / s.total * 100) : 0;
    console.log("  " + k.toUpperCase() + ": " + s.total + " jobs, " + s.parsed + " parsed (" + pct + "%)");
  });

  // Sample missed descriptions from ATS sources (not JSearch — those are expected misses)
  var missedATS = allJobs.filter(function(j) {
    var id = j.job_id || "";
    var isATS = id.startsWith("gh_") || id.startsWith("ab_") || id.startsWith("lv_") || id.startsWith("rc_");
    var hasParsed = (j._must && j._must.length > 0) || (j._nice && j._nice.length > 0) || (j._bene && j._bene.length > 0);
    return isATS && !hasParsed;
  });
  console.log("\n=== MISSED ATS SAMPLES (" + missedATS.length + " total missed from ATS) ===");
  for (var ms = 0; ms < Math.min(10, missedATS.length); ms++) {
    var mj = missedATS[ms];
    var rawDesc = mj.job_description || "";
    console.log("\n[" + (mj.job_id || "?").substring(0,5) + "] " + (mj._company || mj.employer_name) + " — " + mj.job_title);
    console.log("  DescLen: " + rawDesc.length + "chars");
    console.log("  Text: " + rawDesc.substring(0, 400));
  }

  // Location data audit
  var locCounts = {};
  var emptyLoc = 0;
  var remoteLoc = 0;
  allJobs.forEach(function(j) {
    var loc = (j._loc || "").trim();
    if (!loc) { emptyLoc++; return; }
    if (/remote/i.test(loc)) remoteLoc++;
    locCounts[loc] = (locCounts[loc] || 0) + 1;
  });
  var sortedLocs = Object.keys(locCounts).sort(function(a, b) { return locCounts[b] - locCounts[a]; });
  console.log("\n=== LOCATION DATA AUDIT ===");
  console.log("Total jobs: " + allJobs.length);
  console.log("Empty _loc: " + emptyLoc + " (" + Math.round(emptyLoc / allJobs.length * 100) + "%)");
  console.log("Contains 'remote': " + remoteLoc + " (" + Math.round(remoteLoc / allJobs.length * 100) + "%)");
  console.log("Unique _loc values: " + sortedLocs.length);
  console.log("\nTop 40 _loc values:");
  for (var li = 0; li < Math.min(40, sortedLocs.length); li++) {
    console.log("  " + locCounts[sortedLocs[li]] + "x | " + sortedLocs[li]);
  }
  // Per-source location samples (5 from each ATS)
  var srcPrefixes = ["gh_", "ab_", "lv_", "rc_"];
  var srcNames = ["Greenhouse", "Ashby", "Lever", "Recruitee"];
  console.log("\nLocation format by ATS (5 samples each):");
  for (var si = 0; si < srcPrefixes.length; si++) {
    var srcJobs = allJobs.filter(function(j) { return (j.job_id || "").startsWith(srcPrefixes[si]) && j._loc; });
    var seen = {};
    var samples = [];
    for (var sj = 0; sj < srcJobs.length && samples.length < 5; sj++) {
      if (!seen[srcJobs[sj]._loc]) { seen[srcJobs[sj]._loc] = true; samples.push(srcJobs[sj]._loc); }
    }
    console.log("  " + srcNames[si] + ": " + samples.join(" | "));
  }
  // Normalized city distribution
  var cityCounts = {};
  var unmappedCount = 0;
  var remoteCount = 0;
  var remoteRegionCounts = {};
  allJobs.forEach(function(j) {
    if (j._remote) remoteCount++;
    if (j._remote_region) remoteRegionCounts[j._remote_region] = (remoteRegionCounts[j._remote_region] || 0) + 1;
    if (j._city) {
      cityCounts[j._city] = (cityCounts[j._city] || 0) + 1;
    } else if (!j._remote) {
      unmappedCount++;
    }
  });
  var sortedCities = Object.keys(cityCounts).sort(function(a, b) { return cityCounts[b] - cityCounts[a]; });
  console.log("\n=== NORMALIZED LOCATION RESULTS ===");
  console.log("Mapped to city: " + allJobs.filter(function(j){return j._city}).length + " (" + Math.round(allJobs.filter(function(j){return j._city}).length / allJobs.length * 100) + "%)");
  console.log("Remote (any): " + remoteCount + " (" + Math.round(remoteCount / allJobs.length * 100) + "%)");
  console.log("Unmapped (not remote, no city): " + unmappedCount + " (" + Math.round(unmappedCount / allJobs.length * 100) + "%)");
  console.log("\nNormalized cities (" + sortedCities.length + "):");
  for (var ci = 0; ci < sortedCities.length; ci++) {
    console.log("  " + cityCounts[sortedCities[ci]] + "x | " + sortedCities[ci]);
  }
  console.log("\nRemote regions:");
  Object.keys(remoteRegionCounts).sort(function(a,b){return remoteRegionCounts[b]-remoteRegionCounts[a]}).forEach(function(r) {
    console.log("  " + remoteRegionCounts[r] + "x | Remote (" + r + ")");
  });
  // Sample unmapped locations
  if (unmappedCount > 0) {
    var unmapped = allJobs.filter(function(j) { return !j._city && !j._remote && j._loc; });
    console.log("\nUnmapped samples (first 15):");
    var unmSeen = {};
    var unmCount = 0;
    for (var ui = 0; ui < unmapped.length && unmCount < 15; ui++) {
      if (!unmSeen[unmapped[ui]._loc]) {
        unmSeen[unmapped[ui]._loc] = true;
        console.log("  " + unmapped[ui]._loc);
        unmCount++;
      }
    }
  }
  console.log("\n========================\n");

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
