// /api/ai-match.js — Server-side proxy for Claude AI matching
//
// POST /api/ai-match { linkedin_url, jobs: [...] }
// Returns Claude's analysis of best-fit roles
//
// Requires ANTHROPIC_API_KEY env var in Vercel dashboard

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(200).json({
      error: "AI Match is not configured. Add ANTHROPIC_API_KEY to Vercel env vars."
    });
  }

  try {
    var body = req.body;
    if (!body || !body.linkedin_url || !body.jobs) {
      return res.status(400).json({ error: "Missing linkedin_url or jobs" });
    }

    var jobSample = body.jobs.slice(0, 20).map(function(j) {
      return { title: j.title, company: j.company, category: j.category, workType: j.workType };
    });

    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: "You are a career advisor. A job seeker shared their LinkedIn profile: " + body.linkedin_url + "\n\nAnalyze these " + jobSample.length + " job openings and recommend the best matches. Prioritize companies with workplace awards. Return ONLY valid JSON, no markdown fences: {top_matches:[{title,company,reason}],keywords:[string],career_tip:string,award_insight:string}\n\nJobs:\n" + JSON.stringify(jobSample)
        }]
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(200).json({ error: "AI analysis failed. Status: " + response.status });
    }

    var data = await response.json();
    var text = (data.content || []).map(function(c) { return c.text || ""; }).join("");

    // Parse the JSON response, stripping any markdown fences
    var clean = text.replace(/```json|```/g, "").trim();
    var parsed = JSON.parse(clean);

    return res.status(200).json(parsed);
  } catch (e) {
    console.error("AI Match error:", e);
    return res.status(200).json({ error: "Could not analyze. Try again." });
  }
};
