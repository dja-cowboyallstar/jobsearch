#!/usr/bin/env node

/**
 * Test harness for Ascent Layer 2 fetchers.
 * Validates fetchFirecrawl and fetchWorkday against real companies.
 * 
 * Usage:
 *   node test-layer2.js                           — Test all (3 Firecrawl + 2 Workday)
 *   node test-layer2.js --firecrawl               — Test Firecrawl only
 *   node test-layer2.js --workday                 — Test Workday only
 *   node test-layer2.js --url "https://..."       — Test a single URL
 * 
 * Requires FIRECRAWL_API_KEY env var or pass via --key flag.
 */

const {
  fetchFirecrawl,
  fetchWorkday,
  WORKDAY_MAP,
  CAREERS_URLS,
} = require("./firecrawl-fetcher.js");

// Minimal stubs for parseQualifications and trimDesc (from refresh-jobs.js)
function stubParseQualifications(text) {
  var must = [];
  var nice = [];
  var bene = [];
  // Very basic: look for keywords
  if (text && text.toLowerCase().includes("require")) must.push("(parsed)");
  if (text && text.toLowerCase().includes("prefer")) nice.push("(parsed)");
  if (text && text.toLowerCase().includes("benefit")) bene.push("(parsed)");
  return { must: must, nice: nice, bene: bene };
}

function stubTrimDesc(text) {
  return (text || "").substring(0, 800);
}

async function testFirecrawl(name, url, apiKey) {
  console.log("\n  Testing Firecrawl: " + name);
  console.log("  URL: " + url);
  console.log("  " + "-".repeat(60));

  var cache = {};
  var startTime = Date.now();

  try {
    var jobs = await fetchFirecrawl(name, url, cache, stubParseQualifications, stubTrimDesc, apiKey);
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("  Jobs found: " + jobs.length);
    console.log("  Time: " + elapsed + "s");
    console.log("  Cache entries created: " + Object.keys(cache).length);
    console.log("  Credits used: ~" + (1 + Object.keys(cache).length) + " (1 listing + " + Object.keys(cache).length + " job pages)");

    if (jobs.length > 0) {
      console.log("\n  Sample jobs:");
      for (var i = 0; i < Math.min(3, jobs.length); i++) {
        var j = jobs[i];
        console.log("    " + (i + 1) + ". " + j.job_title);
        console.log("       Location: " + (j._loc || "—"));
        console.log("       Apply: " + j.job_apply_link);
        console.log("       Desc length: " + (j.job_description || "").length + " chars");
        console.log("       Qualifications: must=" + j._must.length + " nice=" + j._nice.length + " bene=" + j._bene.length);
        console.log("       Source: " + j._source);
      }
    }

    return { success: true, jobCount: jobs.length };
  } catch (e) {
    console.log("  ERROR: " + e.message);
    return { success: false, error: e.message };
  }
}

async function testWorkday(name, config) {
  console.log("\n  Testing Workday: " + name);
  console.log("  Tenant: " + config.tenant + "  DC: " + config.dataCenter + "  Site: " + config.site);
  console.log("  " + "-".repeat(60));

  var startTime = Date.now();

  try {
    var jobs = await fetchWorkday(name, config, stubParseQualifications, stubTrimDesc);
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("  Jobs found: " + jobs.length);
    console.log("  Time: " + elapsed + "s");
    console.log("  Credits used: 0 (free API)");

    if (jobs.length > 0) {
      console.log("\n  Sample jobs:");
      for (var i = 0; i < Math.min(3, jobs.length); i++) {
        var j = jobs[i];
        console.log("    " + (i + 1) + ". " + j.job_title);
        console.log("       Location: " + (j._loc || "—"));
        console.log("       Desc length: " + (j.job_description || "").length + " chars");
        console.log("       Qualifications: must=" + j._must.length + " nice=" + j._nice.length + " bene=" + j._bene.length);
        console.log("       Source: " + j._source);
      }
    }

    return { success: true, jobCount: jobs.length };
  } catch (e) {
    console.log("  ERROR: " + e.message);
    return { success: false, error: e.message };
  }
}

async function main() {
  var args = process.argv.slice(2);
  var firecrawlOnly = args.includes("--firecrawl");
  var workdayOnly = args.includes("--workday");
  var keyIdx = args.indexOf("--key");
  var urlIdx = args.indexOf("--url");
  var apiKey = keyIdx >= 0 ? args[keyIdx + 1] : process.env.FIRECRAWL_API_KEY;
  var singleUrl = urlIdx >= 0 ? args[urlIdx + 1] : null;

  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         ASCENT LAYER 2 TEST HARNESS                 ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");

  if (singleUrl) {
    if (!apiKey) { console.error("\n  ✗ Set FIRECRAWL_API_KEY env var or use --key"); process.exit(1); }
    await testFirecrawl("Test", singleUrl, apiKey);
    return;
  }

  var results = [];

  // Firecrawl tests
  if (!workdayOnly) {
    if (!apiKey) {
      console.log("\n  ⚠ No FIRECRAWL_API_KEY — skipping Firecrawl tests.");
      console.log("    Set env var or use: node test-layer2.js --key fc-xxx\n");
    } else {
      console.log("\n  Firecrawl API key: " + apiKey.substring(0, 8) + "...\n");

      // Test 3 different platforms
      var fcTests = [
        ["Groq", "https://jobs.gem.com/groq"],                   // Gem platform
        ["Billd", "https://billd.com/careers/"],                  // BambooHR
        ["Cognigy", "https://www.cognigy.com/careers"],           // Unknown platform
      ];

      for (var i = 0; i < fcTests.length; i++) {
        results.push(await testFirecrawl(fcTests[i][0], fcTests[i][1], apiKey));
        if (i < fcTests.length - 1) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // Workday tests
  if (!firecrawlOnly) {
    var wdTests = [
      ["CrowdStrike", WORKDAY_MAP["CrowdStrike"]],
      ["Pluralsight", WORKDAY_MAP["Pluralsight"]],
    ];

    for (var i = 0; i < wdTests.length; i++) {
      // Only fetch first 3 jobs for testing (override limit)
      results.push(await testWorkday(wdTests[i][0], wdTests[i][1]));
      if (i < wdTests.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Summary
  console.log("\n  " + "=".repeat(60));
  var passed = results.filter(r => r.success && r.jobCount > 0).length;
  var failed = results.filter(r => !r.success).length;
  var empty = results.filter(r => r.success && r.jobCount === 0).length;
  console.log("  Results: " + passed + " passed, " + empty + " empty, " + failed + " failed");
  console.log("  " + "=".repeat(60) + "\n");
}

main().catch(e => { console.error("Fatal: " + e.message); process.exit(1); });
