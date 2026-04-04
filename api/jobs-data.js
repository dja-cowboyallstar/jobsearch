// /api/jobs-data.js — Reads job data from Vercel Blob Storage
// The refresh script uploads to Blob. This endpoint reads it back.
// No /tmp, no cold starts, no stale CDN. Data persists permanently.

const { list, head } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Find the most recent jobs-data blob
    const { blobs } = await list({ prefix: "jobs-data", limit: 10 });

    if (!blobs || blobs.length === 0) {
      return res.status(200).json({
        status: "NEEDS_REFRESH",
        message: "No job data found. Run refresh-ascent.ps1.",
        data: []
      });
    }

    // Get the most recent blob (sorted by uploadedAt descending)
    const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];

    // Redirect to the blob's public URL — CDN serves it directly
    res.setHeader("Cache-Control", "public, s-maxage=0, must-revalidate");
    res.setHeader("Location", latest.url);
    return res.status(302).end();
  } catch (e) {
    console.error("Blob read error:", e);
    return res.status(500).json({ error: "Failed to read job data: " + e.message });
  }
};
