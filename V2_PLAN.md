# Ascent v2 — Build Plan

**Status:** Draft (not yet implemented)
**Owner:** Dom (sole engineer)
**Last reviewed:** 2026-04-28
**Review cadence:** Every 4 weeks during active build, then quarterly
**Supersedes:** No prior v2 plan exists. This document is the source of truth for v2 architecture decisions; if it conflicts with anything in chat, code comments, or memory, this file wins until updated by commit.

---

## 0. What this document is and is not

This is a hypothesis about how Ascent v2 should be built, not a contract. Sections marked **DECIDED** are committed and reversing them requires an explicit commit that updates this file. Sections marked **OPEN** are still being validated and may change.

This document is the artifact PRs reference in their description. If a PR makes a v2 architectural choice not covered here, the PR must update this file as part of its diff. No silent architecture drift.

---

## 1. The keystone (DECIDED)

The v2 build is anchored on a single product hypothesis:

> Users will save a job — and create an account to do so — because **Resume Tailor** is good enough to be worth saving for, by itself.

The other three sub-features (Hiring Team, Learning Path, Roadmap) are stubs in v2.0. They ship visible in the saved-Plan UI as "coming soon" cards with copy explaining what's coming. They earn their build slot only after Resume Tailor proves the save action is worth doing.

If Resume Tailor does not produce that result by the end of week 12, the response is **not** to add more sub-features. The response is to fix Resume Tailor or kill v2.

### Build order (DECIDED)

1. Resume Tailor — keystone, full v2.0 build
2. Hiring Team — pulled in from existing Apply Plan outreach generator (mostly UI integration)
3. Learning Path — v2.1
4. Roadmap — v2.2

---

## 2. Dependencies that must exist before v2.0 ships (DECIDED)

These are non-negotiable. v2.0 does not ship to production with any of them missing.

| # | Dependency | Acceptance bar |
|---|---|---|
| D1 | Apply Plan Phase 1 shipped to production (`IS_PREVIEW&&` removed in three locations) | Live on career-ascent.io with Vercel Web Analytics tracking save / status events |
| D2 | Qualification parser at ≥60% coverage | Measured against the live Blob job feed; coverage line in refresh diagnostics |
| D3 | Data integrity remediation complete | JSearch dependency ≤30% (down from ~40%); DualEntry and Bryant Park resolved or removed |
| D4 | Skill taxonomy authored | Size derived from the actual `_must` corpus once D2 holds — deduplicated, canonicalized. **Not** a number picked in advance. JSON file in repo, version-stamped. Provisional working estimate: ~80-150 skills, but final count is whatever the corpus produces. |
| D5 | Skill → action mapping seed data | ≥80% coverage of skills appearing in `_must` fields, human-curated |
| D6 | Resume fixture set | **Starter set of 30** real AI-role resumes (redacted) in `tests/resume-fixtures/` for week 1-2 parser work. **Expanded to 60-100** covering the full role taxonomy (research scientist, ML eng, applied AI PM, infra eng, etc.) before Tailor is declared production-ready in week 7. |

D2 is the highest-risk dependency. v2.0 cannot ship without it because Resume Tailor reads from `_must`/`_nice`/`_bene`. Building Tailor on top of a 17%-coverage parser produces hallucinated tailoring for 83% of jobs.

---

## 3. Architecture (DECIDED unless otherwise noted)

### 3.1 Auth — Clerk

Reasons: provider-agnostic (does not lock the DB choice), CDN script works without a build step, free tier covers the first ~10K MAU, exposes a JWT verifiable in Vercel functions in one line.

What Clerk does not solve: the data model. That stays our responsibility.

**Open:** Whether Clerk's Preact integration is clean enough or whether we ship a thin wrapper. Decided in week 3.

### 3.2 Database — Upstash Redis (via Vercel Marketplace) for v2.0, Postgres later (v2.x)

Saved jobs, Plans, and sub-state are document-shaped, low-relational, per-user. Upstash Redis (provisioned via the Vercel Marketplace; same Redis-compatible API and `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars formerly used for Vercel KV) handles this trivially. The cold-start latency flagged in prior notes is acceptable for save/load operations the user expects to take a beat — it is **not** acceptable for the job board itself, which stays on Vercel Blob.

**Note:** Vercel KV was retired as a product in December 2024; existing stores were migrated to Upstash Redis. New projects install Upstash Redis from the Vercel Marketplace. The integration pattern is unchanged. See V2_SPECS.md Spec 1 for the `SCAN MATCH` enumeration pattern and free-tier limits.

We move to Postgres only when one of these is true and not before:
- Cross-user queries needed (employer dashboard, internal analytics beyond Vercel Web Analytics)
- Full-text search over saved Plans
- Relational integrity across users (sharing, teams)

None of those are in v2. Pre-building for them is the trap.

#### Key shape

```
user:{userId}:savedJobs           → set of jobIds
user:{userId}:job:{jobId}         → SavedJob document
user:{userId}:job:{jobId}:plan    → Plan document
user:{userId}:profile             → UserProfile (parsed resume + claims)
user:{userId}:resumes             → list of ResumeVersion ids
user:{userId}:resume:{rid}        → ResumeVersion document
```

The flat key prefix lets us list a user's data with a `SCAN MATCH user:{userId}:*` cursor loop for export/delete (GDPR) without scanning the whole DB. **Resolved by V2_SPECS.md Spec 1** — uses cursor-based `SCAN`, never blocking `KEYS`. Free-tier limits documented there.

### 3.3 Resume storage — Vercel Blob

Already in use for jobs data. Resume blobs at `resumes/{userId}/{resumeId}.{pdf|docx}`. Parsed structured form lives in KV under `user:{userId}:resume:{rid}`. Never re-parse on the read path — parse once on upload, store the result.

**Retention policy (DECIDED):** raw blob kept for 90 days post-delete for support/recovery, then hard-deleted. Documented in privacy policy on day one.

### 3.4 Function topology — three Vercel serverless functions

Resist creating one function per feature.

| Route | Purpose |
|---|---|
| `/api/auth/*` | Clerk webhook handlers (user created, user deleted → cascade KV delete) |
| `/api/data` | Single CRUD endpoint for SavedJob + Plan + Profile. Routes by `{op, entity, id}` in body. One function, one auth check, one rate limiter, one error path. See V2_SPECS.md Spec 3 for the full operation matrix and request schema. |
| `/api/llm` | Single LLM proxy for Resume Tailor (and later Learning Path if LLM-backed). Centralized rate limits, cost caps, prompt versioning, abuse detection. Provider: Anthropic Claude (default model: Haiku 4.5). **Never call LLM provider directly from the client.** See V2_SPECS.md Spec 4 for full proxy contract. |

The existing `/api/jobs-data.js` and `/api/company-jobs.js` stay untouched. v2 adds; it does not migrate.

### 3.5 Resume upload + parsing pipeline

This is the load-bearing piece. Order:

1. Client uploads PDF or DOCX to `/api/resume/upload` → stored in Blob, parsed asynchronously, status returned by polling.

   **Why polling and not SSE/webhooks:** Vercel serverless functions don't hold connections; SSE would require a separate long-lived process or an external pub/sub service (Pusher, Ably, Upstash Redis pub/sub). Polling is a 5-second `setInterval` on the client and a simple read on the server. Rejected alternatives: (a) SSE — adds infra dependency; (b) websocket — same plus a connection lifecycle bug surface; (c) webhook to client — clients don't receive webhooks. Downside of polling: minor extra read traffic for the first 30 seconds after upload. Acceptable.
2. Text extraction: `pdf-parse` for PDFs, `mammoth` for DOCX. Both Node-compatible, run in a Vercel function, no external service.
3. **Reject scanned/image-only PDFs at upload** with a clear error message. Do not silently OCR; the failure mode is too quiet.
4. Structured extraction against the skill taxonomy (D4). Domain-specific extractor, ~200 lines deterministic code:
   - Regex for dates and titles
   - Taxonomy lookup for skills
   - Link extraction for GitHub/portfolios
   - Simple section detection (Experience, Education, Projects)
5. LLM pass for ambiguous fields only — non-canonical job titles, project description normalization. Constrained to specific fields, not "parse this resume." Output is a `UserProfile` document.
6. **User reviews extracted profile in a UI before it is used by Tailor.** This is the single most important UX gate in v2. Skipping it is the difference between "AI parsed my resume wrong and I can't fix it" (Teal's most common complaint) and "AI extracted, I corrected, now it's right."

**Generic resume parsers (Affinda, Sovren, RChilli, pyresparser) are explicitly rejected** for v2.0. They underperform domain-specific extractors against AI-role resumes and are harder to debug. We can revisit if the domain-specific parser plateaus below 85% recall on the fixture set.

### 3.6 Schemas — versioning required from day one

```typescript
SavedJob {
  schemaVersion: 1,
  jobId, userId, savedAt,
  jobSnapshot: { title, company, descriptionHash, must, nice, bene, comp },
  jobLiveRef: { source, sourceId, lastVerifiedAt },
  status: 'saved' | 'qualifying' | 'applying' | 'applied' | 'archived',
  divergence: { detectedAt, fields: [...] } | null
}

Plan {
  schemaVersion: 1,
  jobId, userId, createdAt, updatedAt,
  resumeTailor: { resumeVersionId, tailoredAt, output, edits } | null,
  hiringTeam:   { generatedAt, targets } | null,
  learningPath: { generatedAt, gaps, actions } | null,
  roadmap:      { generatedAt, weeks } | null
}

UserProfile {
  schemaVersion: 1,
  userId, lastResumeId,
  skills: [{ name, source: 'parsed' | 'claimed', confidence }],
  experience: [...],
  education: [...],
  links: [...],
  claims: { /* user overrides on parsed data */ }
}

ResumeVersion {
  schemaVersion: 1,
  id, userId, uploadedAt, blobUrl, contentHash,
  parsed: UserProfile,
  parseStatus: 'pending' | 'ok' | 'failed', parseError?
}
```

`schemaVersion` enables read-time migrations: load doc → if version < current, run migration function, save back. Cheap. The alternative — big-bang migrations — is what kills products at 5K users.

**Migration discipline (DECIDED):** every migration is idempotent and write-then-mark, never mark-then-write. If the read succeeds and the write fails, the document stays in its prior version, not a half-migrated state.

### 3.7 The mutable-job problem — snapshot + live ref

`jobSnapshot` is captured at save time. `jobLiveRef` points at the source. A daily cron re-verifies live refs and, if `descriptionHash` differs, populates `divergence` and surfaces it in UI. The user sees "the salary on this job changed since you saved it" — not silently stale data.

**Closed jobs are not deleted.** When a source returns 404 or `closed`, the SavedJob is marked `expired`. The user's Plan is preserved — the work is theirs.

### 3.8 Save-before-auth — anonymous device path

Anonymous users save to localStorage under `ascent.anon.savedJobs.*`, identified by a generated `anonDeviceId`. On account creation, the client sends the local payload to `/api/data { op: 'claim', anonPayload }` and the server merges into the user's KV namespace.

This is a ~50-line feature and is the difference between a 5% and a 25% save-to-account conversion. It is in v2.0, not v2.1.

**Cap (HYPOTHESIS, revisit at first cohort):** anonymous users see a "create an account" prompt at 3 saved jobs. The cap is a soft prompt, not a hard block. **3 is a guess** — once we have data on anonymous save→claim conversion by save count, this number is recalibrated against the actual curve.

### 3.9 Job freshness model — per-source TTLs

| Source | Refresh | Mark stale | Hide |
|---|---|---|---|
| Direct ATS (Greenhouse, Ashby, Lever, Recruitee) | Daily | 3 days | 7 days |
| JSearch / aggregators | Daily | 2 days | 5 days |
| Saved jobs | Re-verified every 24h regardless of feed cycle | Source-specific | Never auto-hidden — user owns their saves |

Every job carries `firstSeenAt`, `lastSeenAt`, `lastVerifiedAt`. Saved-job UI shows "verified Xh ago." Honesty is the feature; quality scores are not.

### 3.10 Company ingestion — CLI, not UI

`npm run add-company -- --url=<careers-url>`:

1. Fetch careers page, detect ATS by URL pattern + page signatures
2. If detected ATS is in `ats-registry.json`, generate the listing config
3. If not, prompt for manual mapping; on submission, write to `pending-review` file
4. Output a git diff for review; Dom commits

This reuses the JD parser. **It does not reuse the JD parser for resumes** — different problem, different code path, no shared module. Pretending otherwise is the trap.

**Discipline (DECIDED):** the CLI opens a PR. Never auto-commit ingestion output. A wrong ATS mapping that ships unreviewed breaks all jobs from that company.

---

## 4. Build order — 12-14 weeks solo

| Week | Deliverable | Acceptance |
|---|---|---|
| 1-2 | Resume foundation: skill taxonomy authored (size determined by `_must` corpus, see §9), starter fixture set of 30 resumes assembled, domain-specific resume parser as CLI | Week-1 deliverable: **report measured achievable recall** on fixture set; bar is set at week 1 against measured ground truth, not picked in advance. **Provisional target ≥85%** subject to revision based on what's actually achievable. No UI yet. |
| 3 | Auth + data layer: Clerk live, `/api/data` with four entities, anonymous→authed claim flow, schema versioning baked in, Apply Plan localStorage migrates to KV via the same claim flow | New account can save a job round-trip; old anonymous saves merge cleanly on claim |
| 4 | Save + saved-job UI: button on listings, list view, status state machine, `jobSnapshot` + `jobLiveRef` populated, daily verification cron via GitHub Actions hits `/api/jobs/reverify` | Saved jobs survive a refresh cycle and update `lastVerifiedAt` |
| 5-7 | Resume Tailor: upload UI, parsing pipeline live, profile review UI, `/api/llm` with versioned prompt, per-user rate limit (10/day free, monitor cost), tailored-output UI with diff against original, save tailored version to Plan | Real users on preview can upload → review profile → tailor → see diff |
| 8 | Hiring Team integration: existing Apply Plan outreach generator pulled into saved-Plan UI; stub Learning Path and Roadmap with explanatory "coming soon" cards | All four sub-features visible in Plan UI; Hiring Team functional, others honestly stubbed |
| 9-10 | Freshness + ingestion: per-source TTLs implemented, stale labels in UI, saved-job re-verification, divergence detection and surfacing, ingestion CLI built and used to add 5 companies | JSearch dependency tracked in dashboard; 5 net-new companies added via CLI |
| 11-12 | Hardening: replay 100 synthetic localStorage payloads through `claim`, GDPR export + delete endpoints, rate-limit tuning under load, `IS_PREVIEW` removed feature-by-feature behind real adoption signals | All ungating decisions backed by adoption data, not by calendar |
| 13-14 | **Buffer.** It will overrun. Plan for it. | — |

**Learning Path is v2.1. Roadmap is v2.2. Adding either to v2.0 is the failure mode flagged in conversation.**

---

## 5. Trip-wires (DECIDED)

These metrics are checked weekly. Each has a defined response. Don't add a trip-wire without one.

| Metric | Threshold | Response |
|---|---|---|
| Resume parse success rate | < 85% on real uploads | Parser regression — fix before adding companies |
| Saved-job 7-day return rate | < 30% | Save isn't worth the friction; revisit the keystone hypothesis |
| Resume Tailor "edit after generate" rate | > 60% | Prompt is wrong, not just imperfect — LLM produces output users substantively rewrite |
| JSearch dependency | > 30% at week 12 | Ingestion CLI isn't being used; figure out why |
| localStorage→KV claim conversion | < 20% | Claim flow is broken or invisible |
| Job divergence rate | > 15% of saved jobs/week | Snapshot model insufficient; users need stronger sync |
| `/api/llm` cost per active user | > $2/month | Rate limits too loose or prompt too expensive; cap before scale |
| Schema migration count in first 90 days | > 2 | Schemas weren't stable enough at launch; freeze and stabilize |

---

## 6. Failure modes — must be designed for, not discovered

Each row identifies a failure that has been discussed and the v2.0 mitigation. Anything not mitigated here is explicitly accepted as a v2.0 limitation.

| # | Scenario | v2.0 mitigation |
|---|---|---|
| F1 | User uploads a scanned PDF | Detect image-only at upload, reject with "we need a text PDF — here's how to convert" |
| F2 | Resume parses to a profile that's 80% wrong, user doesn't review carefully | Tailor gated behind explicit "I've reviewed my profile" confirmation |
| F3 | User saves 30 jobs, never returns | No code fix; trip-wire catches it; product response |
| F4 | Clerk outage | Documented dependency; status page; no app-side workaround at v2 scale |
| F5 | JD mutates after save, user never reopens | Divergence detected and stored; weekly digest email is v2.1, not v2.0 |
| F6 | Anonymous user clears cookies before claiming | Soft prompt to create account at 3+ saved jobs |
| F7 | User uploads 50 resumes to test | Cap at 5 active versions per user; soft-delete older |
| F8 | Two devices both anonymous, both claim into same account | Server-side merge: deterministic dedup by `jobId`, last-write-wins on metadata |
| F9 | LLM provider deprecates the model the prompt was tuned against | Prompt versioning includes model version; A/B old prompt+model vs. new prompt+model when migrating |
| F10 | Schema v1→v2 migration: read succeeds, write fails | Migrations are idempotent and write-then-mark, never mark-then-write |
| F11 | Ingestion CLI generates a wrong ATS mapping | CLI opens PR; never auto-commit; review before merge |
| F12 | Tailor output cached and leaks across users | No cross-user caching of tailor output; cache key includes `userId` if cached at all; prefer no cache |
| F13 | Anonymous user's localStorage save survives 6 months, then claims; underlying job no longer exists | Claim flow re-verifies each job; expired ones claimed-but-archived with banner |
| F14 | `index.html` hits cognitive wall at week 6 when Tailor UI grows dense | Pre-emptive: extract Resume Tailor UI into `app/resume-tailor.js` as ES module, served as static file, no build step |
| F15 | Mid-build temptation to add Learning Path "since the data is right there" | Keystone discipline: no. Cost of breaking build order is shipping nothing in 14 weeks instead of one great thing |

---

## 7. What would invalidate this plan

This is the section that keeps the plan from becoming a stale contract. If any of these become true, the plan is re-opened, not followed mechanically:

- D2 (parser ≥60%) is unreachable in 4 weeks. Re-evaluate whether v2 should ship without Tailor depending on parsed qualifications.
- Resume Tailor has < 30% 7-day return rate after 4 weeks of preview adoption. The keystone hypothesis is wrong; do not build Hiring Team integration on a broken foundation.
- A second engineer joins. Single-file `index.html` discipline becomes untenable; extraction order changes.
- Vercel KV pricing changes meaningfully. The DB choice gets revisited against Postgres.
- Clerk pricing tier changes meaningfully at our scale. Auth provider is revisited.
- A regulatory requirement (GDPR enforcement, CCPA, employer-side compliance) lands that requires Postgres-grade auditing. KV is no longer sufficient.

---

## 8. Out of scope for v2.0 (DECIDED)

Listed here so they don't get smuggled in:

- Postgres
- A build step (Vite, Webpack, esbuild, Turborepo, etc.)
- TypeScript across the codebase (server-side type checking on `/api/data` and `/api/llm` only is fine; not the client)
- Sharing / teams / multi-user Plans
- Employer accounts or dashboards
- Email digests of saved-job changes (v2.1)
- Mobile app
- Browser extension
- Generic resume parser (Affinda et al.)
- LLM-generated learning curricula at runtime (skill→action map is human-curated)
- DAG / mindmap visualization (the original Roadmap pitch — v2.2 minimum, and only if data justifies)

---

## 9. Open questions — resolved in V2_SPECS.md

The six original open questions for week 1-3 are resolved in `V2_SPECS.md`:

| Original question | Resolved in |
|---|---|
| Vercel KV `KEYS`/`SCAN` semantics with our prefix scheme | V2_SPECS Spec 1 (and corrected: it's now Upstash Redis, not Vercel KV) |
| Clerk + Preact integration — clean SDK or thin wrapper? | V2_SPECS Spec 2 (CDN script tag + imperative mount; Path A) |
| Rate limit scope — per `userId` or per `userId + endpoint`? | V2_SPECS Spec 4 (per-user-per-task with global cost cap) |
| LLM provider choice — Anthropic, OpenAI, or both? | V2_SPECS Spec 4 (Anthropic Haiku 4.5 default; Sonnet 4.6 as escalation) |
| Resume upload size limit — what's the max PDF/DOCX? | V2_SPECS Spec 6 (5 MB; image-only PDFs rejected) |
| GDPR delete cascade — does deleting a user delete tailored outputs? | V2_SPECS Spec 6 (yes — derived data follows the user) |

Two additional specs surfaced during the Spec work and are also covered in V2_SPECS.md:

- **Spec 3** — the `/api/data` request shape and operation matrix (could not be left to implementation time without ambiguity)
- **Spec 5** — the resume fixture format and expected-output contract (needed to make D6 testable, not just present)

V2_SPECS.md is the source of truth for these decisions. Any change to a spec requires a commit that updates V2_SPECS.md and (if it affects this file's architecture) updates this file too.

---

## 10. Self-audit — convenient choices flagged

Per the `ascent-handoff-verification` skill discipline: every plan decision was reviewed for "convenient choice that looks like simplicity but is actually a deferred problem." This section records what was flagged and how it was resolved.

| # | Convenient choice | Resolution |
|---|---|---|
| A1 | "≥85% recall" as a fixture-set acceptance bar | Changed to provisional. Week-1 deliverable is to **measure** achievable recall, then set the bar against ground truth. |
| A2 | "~120 skills" for the taxonomy | Removed as a target. Taxonomy size is derived from the actual `_must` corpus, deduplicated. Working estimate kept as a range, not a target. |
| A3 | "30 resume fixtures" presented as the bar | Split into starter (30, week 1-2) and production-ready (60-100, before week 7). 30 is enough to start the parser; not enough to declare it production-ready. |
| A4 | Polling for upload status, no tradeoff analysis | Added explicit rejected-alternatives block (SSE, websocket, webhook) and the rationale for polling over each, per ascent-engineering §8. |
| A5 | "3 saved jobs" as the soft-prompt threshold | Re-marked as HYPOTHESIS, not DECIDED. Recalibrated once anonymous save→claim conversion data exists. |

Items reviewed and **kept as decided** (no shortcut found):

- Three serverless functions instead of per-feature splits — discipline, not convenience
- Schema versioning + read-time migrations — more upfront work, not less
- Per-source freshness TTLs over a uniform TTL — honest, not lazy
- Vercel KV for v2.0, Postgres deferred — postpones complexity until features justify it; section §7 names what re-opens this
- Generic resume parsers explicitly rejected — the harder, debuggable path
- CLI-only company ingestion — refuses the convenience of a UI we don't have time to build well

This audit re-runs at every quarterly review. New convenient choices will appear; the discipline is naming them, not eliminating them.
