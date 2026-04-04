// /api/jobs-cache.js — Chunked cache write + CDN-cached read
//
// GET  /api/jobs-cache              → Returns full cached job data (24h CDN TTL)
// POST /api/jobs-cache?key=X&chunk=N → Write one chunk of jobs (small payload)
// POST /api/jobs-cache?key=X&finalize=1 → Assemble chunks into final cache
//
// Architecture: PowerShell writes ~100 jobs per chunk (many small POSTs),
// then calls finalize to merge them. Each POST is <200KB — well within
// any serverless limit.

var fs = require("fs");
var path = require("path");
var CACHE_FILE = path.join("/tmp", "jobs-cache.json");
var CHUNK_DIR = path.join("/tmp", "job-chunks");

function ensureChunkDir() {
  if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });
}

function clearChunks() {
  if (fs.existsSync(CHUNK_DIR)) {
    fs.readdirSync(CHUNK_DIR).forEach(function(f) {
      fs.unlinkSync(path.join(CHUNK_DIR, f));
    });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var KEY = process.env.RAPIDAPI_KEY;

  if (req.method === "POST") {
    var provided = req.query.key;
    if (provided !== KEY) return res.status(401).json({ error: "Invalid key" });

    try {
      // FINALIZE — assemble all chunks into the cache
      if (req.query.finalize) {
        ensureChunkDir();
        var files = fs.readdirSync(CHUNK_DIR).filter(function(f) { return f.endsWith(".json"); }).sort();
        var allJobs = [];
        files.forEach(function(f) {
          var data = JSON.parse(fs.readFileSync(path.join(CHUNK_DIR, f), "utf8"));
          allJobs = allJobs.concat(data);
        });

        var cacheData = {
          status: "OK",
          refreshed_at: req.body && req.body.refreshed_at ? req.body.refreshed_at : new Date().toISOString(),
          total_jobs: allJobs.length,
          companies_queried: req.body && req.body.companies_queried ? req.body.companies_queried : 0,
          data: allJobs
        };

        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData), "utf8");
        clearChunks();

        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({
          status: "OK",
          total_jobs: cacheData.total_jobs,
          chunks_assembled: files.length,
          refreshed_at: cacheData.refreshed_at
        });
      }

      // CHUNK WRITE — store one chunk of jobs
      var chunkNum = parseInt(req.query.chunk);
      if (isNaN(chunkNum)) return res.status(400).json({ error: "Missing chunk number" });

      var body = req.body;
      if (!body || !body.data || !Array.isArray(body.data)) {
        return res.status(400).json({ error: "Missing data array in body" });
      }

      // Clear old chunks on chunk 0 (start of new refresh)
      if (chunkNum === 0) clearChunks();
      ensureChunkDir();

      var chunkFile = path.join(CHUNK_DIR, "chunk_" + String(chunkNum).padStart(4, "0") + ".json");
      fs.writeFileSync(chunkFile, JSON.stringify(body.data), "utf8");

      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        status: "CHUNK_OK",
        chunk: chunkNum,
        jobs_written: body.data.length
      });

    } catch (e) {
      return res.status(500).json({ error: "Cache write failed: " + e.message });
    }
  }

  // GET — User reads cached data
  if (req.method === "GET") {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        var cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (cached && cached.data && cached.data.length > 0) {
          res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
          return res.status(200).json(cached);
        }
      }
    } catch (e) {}

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json({
      status: "NEEDS_REFRESH",
      message: "No cached data. Run the refresh script.",
      data: []
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
