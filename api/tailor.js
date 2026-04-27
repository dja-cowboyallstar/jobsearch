// /api/tailor.js — Server-side proxy for Claude resume tailoring
//
// POST /api/tailor { stage, resume_text, jd_text, parsed_resume?, parsed_jd?, byo_key? }
//
// Stages:
//   "extract_resume" — parse pasted resume into structured JSON
//   "extract_jd"     — parse pasted JD into structured JSON
//   "generate_edits" — produce per-bullet edit suggestions
//
// Requires ANTHROPIC_API_KEY env var. Honors TAILOR_ENABLED kill switch.
//
// In-memory rate limiting: 10 req/hr per IP, resets per cold start.
// Per-instance daily soft cap: 200 req/instance/day.
// Hard monthly spend cap: enforced via manual Anthropic dashboard monitoring
// (no KV in v1; documented limitation).

var RATE = {}; // ip -> {count, windowStart}
var INSTANCE = { count: 0, dayStart: Date.now() };
var RATE_PER_HOUR = 10;
var INSTANCE_DAILY_CAP = 200;
var ONE_HOUR_MS = 3600 * 1000;
var ONE_DAY_MS = 24 * ONE_HOUR_MS;

var MODEL = "claude-sonnet-4-6";
var ANTHROPIC_VERSION = "2023-06-01";
var MAX_RESUME_CHARS = 20000;
var MAX_JD_CHARS = 20000;
var ANTHROPIC_TIMEOUT_MS = 25000;

function getIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.headers["x-real-ip"]
    || "unknown";
}

function checkRate(ip) {
  var now = Date.now();
  if (now - INSTANCE.dayStart > ONE_DAY_MS) { INSTANCE = { count: 0, dayStart: now }; }
  if (INSTANCE.count >= INSTANCE_DAILY_CAP) {
    return { ok: false, status: 429, error: "Daily soft cap reached on this instance. Try again later." };
  }
  var rec = RATE[ip];
  if (!rec || (now - rec.windowStart > ONE_HOUR_MS)) { RATE[ip] = { count: 0, windowStart: now }; rec = RATE[ip]; }
  if (rec.count >= RATE_PER_HOUR) {
    var retryAfter = Math.ceil((ONE_HOUR_MS - (now - rec.windowStart)) / 1000);
    return { ok: false, status: 429, error: "Rate limit exceeded. Try again in " + Math.ceil(retryAfter / 60) + " minutes.", retry_after: retryAfter };
  }
  rec.count += 1;
  INSTANCE.count += 1;
  return { ok: true };
}

function callAnthropic(apiKey, body) {
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ANTHROPIC_TIMEOUT_MS);
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    },
    body: JSON.stringify(body),
    signal: ctrl.signal
  }).then(function(r) { clearTimeout(timer); return r; })
    .catch(function(e) { clearTimeout(timer); throw e; });
}

// Tool schema: extract structured resume
var EXTRACT_RESUME_TOOL = {
  name: "submit_parsed_resume",
  description: "Submit a structured parse of the candidate's resume",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "The candidate's headline/summary section, if present. Empty string if absent." },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            start_date: { type: "string" },
            end_date: { type: "string" },
            location: { type: "string" },
            bullets: { type: "array", items: { type: "string" } }
          },
          required: ["company", "title", "bullets"]
        }
      },
      skills: { type: "array", items: { type: "string" } },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            year: { type: "string" }
          },
          required: ["institution"]
        }
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            tools: { type: "array", items: { type: "string" } }
          },
          required: ["name"]
        }
      }
    },
    required: ["summary", "experience", "skills", "education", "projects"]
  }
};

// Tool schema: extract structured JD
var EXTRACT_JD_TOOL = {
  name: "submit_parsed_jd",
  description: "Submit a structured parse of the job description",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      seniority: { type: "string", enum: ["entry", "mid", "senior", "staff", "principal", "unknown"] },
      required_skills: { type: "array", items: { type: "string" } },
      preferred_skills: { type: "array", items: { type: "string" } },
      required_tools: { type: "array", items: { type: "string" } },
      responsibilities: { type: "array", items: { type: "string" } },
      outcomes_valued: { type: "array", items: { type: "string" } },
      ai_emphasis: { type: "string", enum: ["none", "mentioned", "central"] }
    },
    required: ["title", "seniority", "required_skills", "preferred_skills", "required_tools", "responsibilities", "outcomes_valued", "ai_emphasis"]
  }
};

// Tool schema: per-bullet edits
var EDITS_TOOL = {
  name: "submit_edits",
  description: "Submit per-bullet resume edit suggestions and a tailored summary",
  input_schema: {
    type: "object",
    properties: {
      tailored_summary: { type: "string", description: "A rewritten summary section that aligns with the role. Must use only facts present in the original resume." },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bullet_id: { type: "string", description: "Format: 'exp.<exp_index>.<bullet_index>' matching the parsed resume." },
            original_text: { type: "string" },
            edit_type: { type: "string", enum: ["keep", "light_edit", "strong_edit", "add_if_true", "remove_if_irrelevant"] },
            proposed_text: { type: "string" },
            rationale: { type: "string", description: "Brief explanation, max 200 chars." },
            matched_requirements: { type: "array", items: { type: "string" } },
            risk: { type: "string", enum: ["safe", "needs_confirmation", "do_not_suggest"] },
            ai_signal: { type: "boolean" }
          },
          required: ["bullet_id", "original_text", "edit_type", "proposed_text", "rationale", "matched_requirements", "risk", "ai_signal"]
        }
      },
      analysis: {
        type: "object",
        properties: {
          strong_matches: { type: "array", items: { type: "string" } },
          partial_matches: { type: "array", items: { type: "string" } },
          missing: { type: "array", items: { type: "string" } },
          transferable: { type: "array", items: { type: "string" } },
          score: { type: "number", description: "Overall match score 0-100" }
        },
        required: ["strong_matches", "partial_matches", "missing", "transferable", "score"]
      }
    },
    required: ["tailored_summary", "suggestions", "analysis"]
  }
};

function extractToolUse(data, toolName) {
  var blocks = (data && data.content) || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "tool_use" && blocks[i].name === toolName) {
      return blocks[i].input;
    }
  }
  return null;
}

// Hallucination guard: detect entities in proposed text that aren't in source.
// Returns array of novel entity strings.
function detectNovelEntities(proposed_text, source_text) {
  if (!proposed_text || !source_text) return [];
  var srcLower = source_text.toLowerCase().replace(/\s+/g, " ");
  var novel = [];

  // 1. Numeric metrics: numbers with units, percentages, dollar amounts, multipliers
  var numericRe = /\b\d[\d,]*\.?\d*\s*(%|x|hrs?|hours?|days?|weeks?|months?|years?|k|m|b|million|billion|\$)?/gi;
  var matches = proposed_text.match(numericRe) || [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].toLowerCase().trim();
    // Skip trivial numbers (e.g., dates that look like years if present in source as a year)
    if (m.length < 2) continue;
    if (srcLower.indexOf(m) === -1) {
      // Try also without unit
      var bare = m.replace(/[^\d.]/g, "");
      if (bare.length >= 2 && srcLower.indexOf(bare) === -1) {
        novel.push(matches[i]);
      }
    }
  }

  // 2. Capitalized multi-word phrases (likely tools/companies)
  var capRe = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g;
  var capMatches = proposed_text.match(capRe) || [];
  for (var j = 0; j < capMatches.length; j++) {
    if (srcLower.indexOf(capMatches[j].toLowerCase()) === -1) {
      novel.push(capMatches[j]);
    }
  }

  // 3. Acronyms (2-5 caps)
  var acroRe = /\b[A-Z]{2,5}\b/g;
  var acroMatches = proposed_text.match(acroRe) || [];
  for (var k = 0; k < acroMatches.length; k++) {
    if (srcLower.indexOf(acroMatches[k].toLowerCase()) === -1) {
      novel.push(acroMatches[k]);
    }
  }

  // De-duplicate
  var seen = {};
  return novel.filter(function(x) { if (seen[x]) return false; seen[x] = true; return true; });
}

function isNumericNovel(entity) {
  return /\d/.test(entity);
}

function applyHallucinationGuard(suggestions, source_text) {
  return suggestions.map(function(s) {
    var novel = detectNovelEntities(s.proposed_text, source_text);
    var newRisk = s.risk;
    if (novel.length > 0) {
      var hasNumeric = novel.some(isNumericNovel);
      newRisk = hasNumeric ? "do_not_suggest" : "needs_confirmation";
    }
    return Object.assign({}, s, { novel_entities: novel, risk: newRisk });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).json({ error: "Method not allowed" });

  // Kill switch
  if (process.env.TAILOR_ENABLED === "false") {
    return res.status(200).json({ error: "Resume tailoring is temporarily unavailable." });
  }

  var body = req.body;
  if (!body || !body.stage) {
    return res.status(200).json({ error: "Missing stage parameter" });
  }

  var apiKey = (body.byo_key && typeof body.byo_key === "string" && body.byo_key.indexOf("sk-ant-") === 0)
    ? body.byo_key
    : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: "Resume tailoring is not configured. Add ANTHROPIC_API_KEY to Vercel env vars." });
  }

  // Rate limit only when using shared key (BYO-key bypasses)
  if (!body.byo_key) {
    var ip = getIp(req);
    var rate = checkRate(ip);
    if (!rate.ok) {
      return res.status(200).json({ error: rate.error, retry_after: rate.retry_after });
    }
  }

  try {
    if (body.stage === "extract_resume") {
      var rt = body.resume_text || "";
      if (!rt.trim()) return res.status(200).json({ error: "Resume text is empty." });
      if (rt.length > MAX_RESUME_CHARS) return res.status(200).json({ error: "Resume is too long (>" + MAX_RESUME_CHARS + " chars). Trim and try again." });

      var aResp = await callAnthropic(apiKey, {
        model: MODEL,
        max_tokens: 4000,
        tools: [EXTRACT_RESUME_TOOL],
        tool_choice: { type: "tool", name: "submit_parsed_resume" },
        messages: [{
          role: "user",
          content: "Parse the following resume into structured fields. Use ONLY information explicitly stated. Do not infer, embellish, or invent. If a field is not present, return an empty string or empty array.\n\nRESUME:\n" + rt
        }]
      });
      if (!aResp.ok) {
        var aErr = await aResp.text();
        console.error("Anthropic extract_resume error:", aResp.status, aErr);
        return res.status(200).json({ error: "Could not parse resume. Status: " + aResp.status });
      }
      var aData = await aResp.json();
      var parsed = extractToolUse(aData, "submit_parsed_resume");
      if (!parsed) return res.status(200).json({ error: "Could not parse resume (no tool output)." });
      return res.status(200).json({ parsed: parsed, usage: aData.usage });
    }

    if (body.stage === "extract_jd") {
      var jt = body.jd_text || "";
      if (!jt.trim()) return res.status(200).json({ error: "Job description is empty." });
      if (jt.length > MAX_JD_CHARS) return res.status(200).json({ error: "Job description is too long (>" + MAX_JD_CHARS + " chars)." });

      var bResp = await callAnthropic(apiKey, {
        model: MODEL,
        max_tokens: 2000,
        tools: [EXTRACT_JD_TOOL],
        tool_choice: { type: "tool", name: "submit_parsed_jd" },
        messages: [{
          role: "user",
          content: "Parse the following job description into structured fields. Distinguish required from preferred. Identify the seniority level. Note whether AI is mentioned (none / mentioned / central).\n\nJOB DESCRIPTION:\n" + jt
        }]
      });
      if (!bResp.ok) {
        var bErr = await bResp.text();
        console.error("Anthropic extract_jd error:", bResp.status, bErr);
        return res.status(200).json({ error: "Could not parse job description. Status: " + bResp.status });
      }
      var bData = await bResp.json();
      var parsedJd = extractToolUse(bData, "submit_parsed_jd");
      if (!parsedJd) return res.status(200).json({ error: "Could not parse job description (no tool output)." });
      return res.status(200).json({ parsed: parsedJd, usage: bData.usage });
    }

    if (body.stage === "generate_edits") {
      if (!body.parsed_resume || !body.parsed_jd) {
        return res.status(200).json({ error: "Missing parsed_resume or parsed_jd." });
      }
      var sourceText = body.resume_text || "";
      if (!sourceText.trim()) return res.status(200).json({ error: "Original resume text required for hallucination guard." });

      var systemPrompt = [
        "You are a surgical resume editor. Your job is to suggest per-bullet edits that better align the candidate's resume with the target job description.",
        "",
        "Strict rules:",
        "- Use ONLY facts present in the parsed resume. Do not invent skills, tools, employers, dates, metrics, or achievements.",
        "- Prefer concrete verbs, specific tools, and measurable outcomes already in the source.",
        "- Avoid generic phrases (\"leveraged\", \"synergized\", \"cutting-edge\", \"drove impact\").",
        "- Do not reorder bullets or restructure sections.",
        "- For each bullet, choose edit_type: keep, light_edit, strong_edit, add_if_true, or remove_if_irrelevant.",
        "- Set risk='needs_confirmation' for any edit that could be perceived as stretching the source.",
        "- Set risk='do_not_suggest' for any edit you cannot fully ground in the source.",
        "- Set ai_signal=true ONLY when the edit strengthens AI-related work that is already grounded in the resume.",
        "- bullet_id must use the format 'exp.<exp_index>.<bullet_index>' matching the parsed resume.",
        "- Vary sentence length. Replace generic adjectives with concrete scope.",
        "- Each bullet should sound like something the candidate could explain in 30 seconds."
      ].join("\n");

      var userMsg = "PARSED RESUME:\n" + JSON.stringify(body.parsed_resume) + "\n\nPARSED JOB DESCRIPTION:\n" + JSON.stringify(body.parsed_jd) + "\n\nGenerate per-bullet edit suggestions and a tailored summary. Also produce a match analysis (strong/partial/missing/transferable + 0-100 score).";

      var cResp = await callAnthropic(apiKey, {
        model: MODEL,
        max_tokens: 8000,
        system: systemPrompt,
        tools: [EDITS_TOOL],
        tool_choice: { type: "tool", name: "submit_edits" },
        messages: [{ role: "user", content: userMsg }]
      });
      if (!cResp.ok) {
        var cErr = await cResp.text();
        console.error("Anthropic generate_edits error:", cResp.status, cErr);
        return res.status(200).json({ error: "Could not generate edits. Status: " + cResp.status });
      }
      var cData = await cResp.json();
      var edits = extractToolUse(cData, "submit_edits");
      if (!edits) return res.status(200).json({ error: "Could not generate edits (no tool output)." });

      // Hallucination guard: post-process every suggestion
      edits.suggestions = applyHallucinationGuard(edits.suggestions || [], sourceText);

      return res.status(200).json({ edits: edits, usage: cData.usage });
    }

    return res.status(200).json({ error: "Unknown stage: " + body.stage });
  } catch (e) {
    console.error("Tailor error:", e);
    if (e && e.name === "AbortError") {
      return res.status(200).json({ error: "Request timed out. Try a shorter resume or job description." });
    }
    return res.status(200).json({ error: "Tailoring failed. Try again." });
  }
};
