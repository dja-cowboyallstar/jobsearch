// /api/jobs.js — Vercel Serverless Function
// Proxies JSearch API requests so the RapidAPI key stays server-side.
// Supports optional access code for basic user gating.

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Optional: basic access gating
  const ACCESS_CODE = process.env.ACCESS_CODE; // set in Vercel env vars, or leave empty to disable
  if (ACCESS_CODE) {
    const userCode = req.headers["x-access-code"] || req.query.code;
    if (userCode !== ACCESS_CODE) {
      return res.status(401).json({ error: "Invalid access code" });
    }
  }

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) {
    return res.status(500).json({ error: "Server misconfigured: missing RAPIDAPI_KEY" });
  }

  // Forward the query to JSearch
  const { query, page = "1", num_pages = "1" } = req.query;
  if (!query) {
    return res.status(400).json({ error: "Missing 'query' parameter" });
  }

  try {
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=${page}&num_pages=${num_pages}`;

    const response = await fetch(url, {
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return res.status(429).json({ error: "Rate limited by JSearch API. Try again shortly." });
      }
      return res.status(status).json({ error: `JSearch API returned ${status}` });
    }

    const data = await response.json();

    // Cache for 5 minutes to reduce API calls
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    console.error("JSearch proxy error:", err);
    return res.status(500).json({ error: "Failed to fetch jobs" });
  }
}
