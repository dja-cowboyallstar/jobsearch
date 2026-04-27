# ascent-discovery-patch.ps1
# Patches scripts/refresh-jobs.js with Phase 2 auto-discovery
# Run from C:\ascent: .\ascent-discovery-patch.ps1
# Safe to re-run: each patch checks if it's already applied before patching

$file = "C:\ascent\scripts\refresh-jobs.js"
$content = Get-Content -Raw $file

Write-Host "=== ASCENT PHASE 2 PATCH ===" -ForegroundColor Cyan
Write-Host "File: $file"
Write-Host "Size before: $($content.Length) chars"

# ── PATCH 1: Add REGISTRY_OBJ global ──
if ($content -notmatch "var REGISTRY_OBJ") {
  $content = $content -replace [regex]::Escape("var ALL_COMPANIES = [];"), "var ALL_COMPANIES = [];`nvar REGISTRY_OBJ = null;"
  Write-Host "  [1/4] Added REGISTRY_OBJ global" -ForegroundColor Green
} else {
  Write-Host "  [1/4] REGISTRY_OBJ already present — skipped" -ForegroundColor Yellow
}

# ── PATCH 2: Store registry object in loadRegistry() ──
$anchor2 = 'console.log("Registry loaded: " + mapped + " mapped, " + registry.unmapped.length + " unmapped, " + ALL_COMPANIES.length + " total");'
if ($content -notmatch "REGISTRY_OBJ = registry") {
  $content = $content -replace [regex]::Escape($anchor2), "REGISTRY_OBJ = registry;`n    $anchor2"
  Write-Host "  [2/4] Wired REGISTRY_OBJ = registry in loadRegistry()" -ForegroundColor Green
} else {
  Write-Host "  [2/4] REGISTRY_OBJ assignment already present — skipped" -ForegroundColor Yellow
}

# ── PATCH 3: Insert discovery functions before main() ──
$discoveryFunctions = @'
// ── ATS AUTO-DISCOVERY ──
var DISCOVERY_TIME_CAP_MS = 55000; // 55s hard cap (leaves 5s buffer for registry write)
var PROBE_TIMEOUT_MS = 5000;       // 5s per individual ATS probe

function generateSlugVariants(name) {
  var base = name.toLowerCase()
    .replace(/['']/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  var stripped = base
    .replace(/-ai$/, "").replace(/-inc$/, "").replace(/-corp$/, "")
    .replace(/-labs$/, "").replace(/-technologies$/, "").replace(/-systems$/, "")
    .replace(/-platform$/, "").replace(/-hq$/, "").replace(/-app$/, "");
  var nohyphen = base.replace(/-/g, "");
  var variants = [base];
  if (stripped !== base) variants.push(stripped);
  if (nohyphen !== base && nohyphen !== stripped) variants.push(nohyphen);
  return variants.filter(function(v, i, a) { return a.indexOf(v) === i; });
}

async function probeATSEndpoint(ats, slug) {
  var urls = {
    gh: "https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs",
    ab: "https://api.ashbyhq.com/posting-api/job-board/" + slug,
    lv: "https://api.lever.co/v0/postings/" + slug + "?mode=json",
    rc: "https://" + slug + ".recruitee.com/api/offers"
  };
  var url = urls[ats];
  if (!url) return { count: 0, titles: [] };
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, PROBE_TIMEOUT_MS);
    var resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { count: 0, titles: [] };
    var data = await resp.json();
    var jobs = [];
    if (ats === "gh") jobs = data.jobs || [];
    else if (ats === "ab") jobs = data.jobs || [];
    else if (ats === "lv") jobs = Array.isArray(data) ? data : [];
    else if (ats === "rc") jobs = data.offers || [];
    var titles = jobs.slice(0, 10).map(function(j) {
      return (j.title || j.text || "").toLowerCase();
    });
    return { count: jobs.length, titles: titles };
  } catch (e) {
    return { count: 0, titles: [] };
  }
}

var AI_TITLE_KEYWORDS = [
  "engineer","software","data","ml","ai","product","research","scientist",
  "analyst","developer","manager","design","ops","platform","infrastructure",
  "backend","frontend","fullstack","security","devops","cloud","machine","learning",
  "model","llm","applied","founding","technical","architect","principal","recruiter",
  "finance","legal","marketing","sales","operations","counsel","accounting"
];

function isTitlePlausible(titles) {
  if (titles.length === 0) return false;
  var matches = titles.filter(function(t) {
    return AI_TITLE_KEYWORDS.some(function(kw) { return t.indexOf(kw) > -1; });
  });
  return (matches.length / titles.length) >= 0.4;
}

async function runDiscoveryPhase(unmappedList) {
  if (!unmappedList || unmappedList.length === 0) return [];
  console.log("\n=== DISCOVERY PHASE ===");
  console.log("Probing " + unmappedList.length + " unmapped companies...");
  var ATS_TYPES = ["gh", "ab", "lv", "rc"];
  var newMappings = [];
  var phaseStart = Date.now();
  for (var i = 0; i < unmappedList.length; i++) {
    if (Date.now() - phaseStart > DISCOVERY_TIME_CAP_MS) {
      console.log("  Time cap reached -- " + (unmappedList.length - i) + " companies skipped");
      break;
    }
    var company = unmappedList[i];
    var slugs = generateSlugVariants(company);
    var best = null;
    for (var a = 0; a < ATS_TYPES.length && !best; a++) {
      for (var s = 0; s < slugs.length && !best; s++) {
        var result = await probeATSEndpoint(ATS_TYPES[a], slugs[s]);
        if (result.count > 0) {
          if (isTitlePlausible(result.titles)) {
            best = { ats: ATS_TYPES[a], slug: slugs[s], count: result.count };
          } else {
            console.log("  SKIP (implausible titles): " + company + " -> " + ATS_TYPES[a] + "/" + slugs[s]);
          }
        }
      }
    }
    if (best) {
      console.log("  DISCOVERED: " + company + " -> " + best.ats + "/" + best.slug + " (" + best.count + " jobs)");
      newMappings.push({ company: company, ats: best.ats, slug: best.slug });
    }
  }
  console.log("Discovery complete: " + newMappings.length + " new mappings found");
  return newMappings;
}

async function saveUpdatedRegistry(newMappings) {
  if (!REGISTRY_OBJ) {
    console.error("  Registry object unavailable -- skipping registry update (non-fatal)");
    return;
  }
  var today = new Date().toISOString().slice(0, 10);
  for (var i = 0; i < newMappings.length; i++) {
    var m = newMappings[i];
    REGISTRY_OBJ.mappings[m.company] = { ats: m.ats, slug: m.slug, verified_at: today, source: "auto-discovery" };
    REGISTRY_OBJ.unmapped = REGISTRY_OBJ.unmapped.filter(function(u) { return u !== m.company; });
  }
  REGISTRY_OBJ.version = (REGISTRY_OBJ.version || 1) + 1;
  REGISTRY_OBJ.updated_at = new Date().toISOString();
  try {
    await put("ats-registry.json", JSON.stringify(REGISTRY_OBJ), {
      access: "public",
      contentType: "application/json",
      token: BLOB_TOKEN,
      addRandomSuffix: false
    });
    console.log("  Registry updated in Blob: " + Object.keys(REGISTRY_OBJ.mappings).length + " mapped, " + REGISTRY_OBJ.unmapped.length + " unmapped, version " + REGISTRY_OBJ.version);
  } catch (e) {
    console.error("  Registry Blob write FAILED (non-fatal): " + e.message);
  }
}

'@

if ($content -notmatch "runDiscoveryPhase") {
  $content = $content -replace [regex]::Escape("async function main()"), "$discoveryFunctions`nasync function main()"
  Write-Host "  [3/4] Inserted discovery functions before main()" -ForegroundColor Green
} else {
  Write-Host "  [3/4] Discovery functions already present — skipped" -ForegroundColor Yellow
}

# ── PATCH 4: Call discovery phase inside main() after fetch complete ──
$anchor4 = 'console.log("Fetch complete: " + allJobs.length + " jobs");'
$replacement4 = @'
console.log("Fetch complete: " + allJobs.length + " jobs");

  // ── AUTO-DISCOVERY ──
  var unmappedAtStart = ALL_COMPANIES.filter(function(c) { return !ATS_MAP[c]; });
  var newMappings = await runDiscoveryPhase(unmappedAtStart);
  if (newMappings.length > 0) {
    console.log("Saving " + newMappings.length + " new mappings to registry...");
    await saveUpdatedRegistry(newMappings);
  }
'@

if ($content -notmatch "unmappedAtStart") {
  $content = $content -replace [regex]::Escape($anchor4), $replacement4
  Write-Host "  [4/4] Added discovery call in main() after fetch loop" -ForegroundColor Green
} else {
  Write-Host "  [4/4] Discovery call already present — skipped" -ForegroundColor Yellow
}

# ── WRITE FILE ──
$content | Set-Content -Path $file -Encoding UTF8 -NoNewline
Write-Host ""
Write-Host "Size after: $((Get-Content -Raw $file).Length) chars"
Write-Host ""

# ── VERIFY ──
Write-Host "=== VERIFICATION ===" -ForegroundColor Cyan
$final = Get-Content -Raw $file
$checks = @(
  @{ label = "REGISTRY_OBJ global";        pattern = "var REGISTRY_OBJ = null" },
  @{ label = "REGISTRY_OBJ = registry";    pattern = "REGISTRY_OBJ = registry" },
  @{ label = "generateSlugVariants()";     pattern = "function generateSlugVariants" },
  @{ label = "probeATSEndpoint()";         pattern = "function probeATSEndpoint" },
  @{ label = "runDiscoveryPhase()";        pattern = "function runDiscoveryPhase" },
  @{ label = "saveUpdatedRegistry()";      pattern = "function saveUpdatedRegistry" },
  @{ label = "Discovery call in main()";   pattern = "unmappedAtStart" },
  @{ label = "put() still present";        pattern = 'await put\("jobs-data' }
)
$allPassed = $true
foreach ($check in $checks) {
  if ($final -match $check.pattern) {
    Write-Host "  PASS: $($check.label)" -ForegroundColor Green
  } else {
    Write-Host "  FAIL: $($check.label)" -ForegroundColor Red
    $allPassed = $false
  }
}

if ($allPassed) {
  Write-Host ""
  Write-Host "All checks passed. Ready to commit." -ForegroundColor Green
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "  git add scripts/refresh-jobs.js"
  Write-Host "  git commit -m 'Phase 2: auto-discovery for unmapped companies'"
  Write-Host "  git push"
} else {
  Write-Host ""
  Write-Host "One or more checks FAILED. Do not commit. Paste output above for diagnosis." -ForegroundColor Red
}
