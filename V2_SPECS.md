# Ascent v2 — Specs

**Status:** Draft (not yet implemented)
**Companion document:** `V2_PLAN.md` — this file resolves V2_PLAN §9 open questions
**Last reviewed:** 2026-04-28
**Review cadence:** With V2_PLAN

This file resolves the six open questions in V2_PLAN.md §9. Each spec uses the same DECIDED / HYPOTHESIS / OPEN labels as V2_PLAN. Every numeric assertion is sourced from a measurement or current vendor docs (cited inline), not from memory.

If a spec in this file conflicts with V2_PLAN, this file wins for the specific decision and V2_PLAN is updated by the same commit.

---

## Critical correction to V2_PLAN before specs proceed

**Vercel KV no longer exists as a product** as of December 2024. Existing Vercel KV stores were automatically migrated to Upstash Redis. New projects install Upstash Redis via the Vercel Marketplace, which provisions the same Redis-compatible store and injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars (env var names preserved for backward compatibility).

This is a vendor naming change, not an architectural change. The Redis-compatible API, key prefix scheme, and `SCAN MATCH` semantics in V2_PLAN §3.2 all still apply. References to "Vercel KV" in V2_PLAN should be read as "Upstash Redis (via Vercel Marketplace)."

V2_PLAN §3.2 will be updated by the same commit that lands this file.

---

## Spec 1 — Upstash Redis (formerly Vercel KV) `SCAN MATCH` for per-user data ops

**Resolves V2_PLAN §9 question 1.**

### DECIDED

Use the Upstash Redis SDK (`@upstash/redis`, available as the `@vercel/kv` shim or directly). Per-user enumeration uses cursor-based `SCAN` with `MATCH user:{userId}:*`, **not** `KEYS`.

`KEYS` is blocking and unsafe in production. `SCAN` is cursor-based, non-blocking, and supports glob-style patterns including the `user:*` prefix scheme V2_PLAN §3.2 specifies.

### Reference implementation

```javascript
// /api/data — list all keys for a user (GDPR export, account delete cascade)
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

async function listUserKeys(userId) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, {
      match: `user:${userId}:*`,
      count: 100   // hint, not guarantee
    });
    keys.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return keys;
}
```

### Constraints derived from current Upstash docs

- The free tier is **500K commands/month** and **256MB storage**. **Per-user op volume is unmeasured for v2 use cases** — instrument the actual count from week 4 (post saved-job UI launch). The 5K-active-users-on-free-tier figure assumes 100 ops/user/month, which is a guess until measured. Trip-wire wording: monitor `commands/MAU` weekly; upgrade before crossing 80% of the 500K cap.
- Cursor changed from `number` to `string` in `@vercel/kv` v3.0.0+. Use string cursors. Compare against `'0'`, not `0`.
- `kv.get<T>()` generic typing has a known bug producing null on serialized objects. Do not use generics on `get`. Cast after retrieval and validate with a type guard.
- `scanIterator()` has reported hang issues with large datasets. Prefer the explicit cursor loop above.

### Rejected alternatives

- **`KEYS user:*`** — blocking, unsafe, documented anti-pattern. Rejected.
- **One Redis database per user** — Upstash free tier caps at 10 databases. Doesn't scale past 10 users. Rejected immediately.
- **Sorted set indexing all user keys** — adds write amplification on every save. Considered, rejected for v2.0 because `SCAN MATCH` is sufficient at our scale and avoids the second-source-of-truth problem.

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | User has 10K saved jobs, `SCAN` takes too long for an HTTP timeout | Page the response; first call returns first 100 + cursor; client iterates if needed. v2.0 caps at 5 active resume versions and no cap on saves, but soft-cap saves at 100/user with a "you have a lot of saves — consider archiving" UI |
| 2 | `kv.get` returns null for a known-existing key (the v3 generic bug) | Use untyped `get`, cast manually, validate with a type guard. Add a regression test that round-trips a `SavedJob` |
| 3 | Cursor handling regresses to numeric comparison after a refactor | Explicit `cursor !== '0'` check (string compare) in the loop; add a comment citing this spec |
| 4 | Free-tier 500K command/month cap exceeded mid-month | Trip-wire metric checked weekly; upgrade path is one click in Vercel dashboard |

### What would invalidate this spec

- Upstash deprecates `SCAN MATCH` semantics or changes the cursor protocol again
- Per-user op count exceeds 1K/month (would need indexing, not enumeration)
- We move to Postgres (kills this spec entirely; replace with row-level scopes)

---

## Spec 2 — Clerk integration without a build step

**Resolves V2_PLAN §9 question 2.**

### DECIDED

Use Clerk's CDN script tag (`@clerk/clerk-js@5`). No NPM, no bundler, no build step. Confirmed in Clerk's official JavaScript Quickstart (clerk.com/docs/quickstarts/javascript): the script-tag installation path is a first-class option alongside the NPM/Vite path.

### Reference implementation

In `index.html` (and mirrored to `public/index.html` per the dual-mirror rule):

```html
<!-- Before any other script that uses Clerk -->
<script
  async
  crossorigin="anonymous"
  data-clerk-publishable-key="pk_live_..."
  src="https://YOUR_FRONTEND_API_URL/npm/@clerk/clerk-js@5/dist/clerk.browser.js"
></script>

<script>
  window.addEventListener('load', async function () {
    await Clerk.load();
    // Clerk is now available on window.Clerk
    if (Clerk.user) {
      // Authenticated path
    } else {
      // Anonymous path — anonDeviceId from localStorage
    }
  });
</script>
```

The `data-clerk-publishable-key` is environment-specific. For preview builds (`*.vercel.app`, `localhost`) we use the test publishable key; for `career-ascent.io` we use the live key. Selection is a 3-line check on `window.location.hostname` — same pattern as `IS_PREVIEW`.

### Where Preact fits

Clerk's prebuilt components (`<SignIn />`, `<UserButton />`) are React components. Ascent uses Preact via CDN. Two integration paths:

**Path A (DECIDED for v2.0, pending one verification):** mount Clerk's components imperatively via the JS API into plain DOM nodes, not as Preact JSX. Clerk's JS SDK exposes `Clerk.mountSignIn(node)`, `Clerk.mountUserButton(node)`, etc. — this is the documented script-tag path and bypasses the React/Preact compatibility question entirely.

**Verification required week 3:** confirm `Clerk.mountSignIn` / `Clerk.mountUserButton` are still the current API on `@clerk/clerk-js@5` (not deprecated in favor of a JSX-only path). If deprecated, fall back to Path B with a `preact/compat` shim resolved via importmap. The fallback is documented; the build step still doesn't materialize.

```javascript
// Preact owns the surrounding shell; Clerk owns the auth widget
function AuthSlot() {
  useEffect(() => {
    const node = document.getElementById('clerk-mount');
    if (!Clerk.user) Clerk.mountSignIn(node);
    else Clerk.mountUserButton(node);
    return () => Clerk.unmountSignIn(node) || Clerk.unmountUserButton(node);
  }, []);
  return h('div', { id: 'clerk-mount' });
}
```

**Path B (rejected):** use `preact/compat` to alias React → Preact and import Clerk's React components. Adds a build step or a preact/compat shim resolved via importmap. Higher risk, no benefit for v2.0.

### Server-side verification

Server functions (`/api/data`, `/api/llm`) verify the Clerk session JWT via `@clerk/backend`:

```javascript
import { verifyToken } from '@clerk/backend';

async function getUserId(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('unauthenticated');
  const claims = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY
  });
  return claims.sub;  // Clerk user ID
}
```

This is a server-side dependency on `@clerk/backend` in `node_modules`, scoped to the `/api/*` directory's `package.json`. **The client side stays buildless.** Vercel installs server deps automatically per function.

### Rejected alternatives

- **`@clerk/clerk-react` via CDN with importmap** — works in theory; multiple reports of edge cases with Preact aliasing. Rejected as over-engineered.
- **Self-hosted auth (Lucia, plain JWT)** — disqualified per V2_PLAN. Rolling auth in 2026 is a mistake category.
- **Auth0** — overkill, expensive at scale. Rejected.
- **Supabase Auth** — pulls toward Postgres prematurely. Rejected.

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | Clerk CDN unreachable | App degrades to anonymous mode; saves go to localStorage; banner explains auth temporarily unavailable |
| 2 | `Clerk.load()` fails silently | Wrap in try/catch, log to Vercel Web Analytics as `auth.load.failed`, render anonymous shell |
| 3 | JWT verification fails on `/api/data` (key rotation, clock skew) | Return 401, client triggers `Clerk.session.touch()` to refresh; if still failing, sign-out and prompt re-auth |
| 4 | Test pk used on production by mistake | `IS_PREVIEW`-style hostname check; assertion at boot (`assert pk.startsWith('pk_test_') === IS_PREVIEW`) |
| 5 | User signs out on tab A, tab B still shows authed UI | Clerk's session listener fires on cross-tab logout; subscribe in main script |
| 6 | Mobile Safari blocks third-party storage and Clerk session breaks | Clerk handles this via first-party cookies on the Frontend API URL; verify by testing on actual mobile Safari before launch |

### What would invalidate this spec

- Clerk deprecates the script-tag installation
- Clerk's pricing tier at our scale exceeds Auth0 or alternatives meaningfully
- We add a build step for unrelated reasons (then path B becomes the default)

---

## Spec 3 — `/api/data` request shape

**Resolves V2_PLAN §9 question 5 (op vs entity ambiguity).**

### DECIDED

Single endpoint, single function, body-routed by `{op, entity}`. The pair is unambiguous: `op` is one of a closed set of verbs, `entity` is one of a closed set of nouns, no overlap.

### Schema

```typescript
// Request body
type DataRequest = {
  op: 'get' | 'set' | 'delete' | 'list' | 'claim' | 'export';
  entity: 'savedJob' | 'plan' | 'profile' | 'resume' | 'all';
  id?: string;            // required for: get, set, delete (entity-specific id)
  payload?: unknown;      // required for: set, claim
  schemaVersion?: number; // required for: set (to detect client/server schema drift)
};

// Response body
type DataResponse =
  | { ok: true; data: unknown; schemaVersion: number }
  | { ok: false; error: string; code: 'unauthenticated' | 'not_found' | 'schema_mismatch' | 'rate_limited' | 'invalid' };
```

### Operation matrix

| op | entity | id | payload | Result |
|---|---|---|---|---|
| `get` | `savedJob` | jobId | — | `SavedJob \| null` |
| `get` | `plan` | jobId | — | `Plan \| null` |
| `get` | `profile` | — | — | `UserProfile \| null` |
| `get` | `resume` | resumeId | — | `ResumeVersion \| null` |
| `set` | `savedJob` | jobId | `SavedJob` | written `SavedJob` |
| `set` | `plan` | jobId | `Plan` (partial allowed) | merged `Plan` |
| `set` | `profile` | — | `UserProfile` (partial allowed) | merged `UserProfile` |
| `delete` | `savedJob` | jobId | — | `{ deleted: true }` |
| `delete` | `plan` | jobId | — | `{ deleted: true }` |
| `delete` | `resume` | resumeId | — | `{ deleted: true }` (soft-delete; raw blob retained 90d per V2_PLAN §3.3) |
| `list` | `savedJob` | — | — | `SavedJob[]` (paged; cursor in response if >100) |
| `list` | `resume` | — | — | `ResumeVersion[]` (active versions only) |
| `claim` | `all` | — | `{ anonDeviceId, savedJobs: [...] }` | `{ claimed: N, conflicts: [...] }` |
| `export` | `all` | — | — | full GDPR export of every `user:{userId}:*` key |

### Rules

- **`set` with partial payload merges; full replace requires `op: 'replace'`** (not in v2.0; deferred to v2.1 if needed). Partial-set semantics are: merge top-level fields, replace nested objects entirely. No deep merge — too easy to get wrong.
- **`schemaVersion` mismatch on `set` returns `schema_mismatch`**, not silent overwrite. Client must read-then-write with the correct version. This prevents two-tab races.
- **All `op + entity` combinations not in the matrix return `invalid`.** No "permissive" parsing — 400 on anything outside the matrix.
- **Auth check first, then validation, then operation.** Single error path: `unauthenticated` → `invalid` → `not_found` → `schema_mismatch` → `rate_limited`. Stable order makes client error handling deterministic.

### Rate limiting

Per `userId` per `op + entity`, not per IP. See Spec 5 for the rate-limit numbers and rationale.

### Rejected alternatives

- **REST routes (`/api/data/savedJob/:id`)** — nicer aesthetically, more functions to maintain, more places to forget the auth check. Rejected.
- **GraphQL** — overkill, adds dependency, fights the no-build-step constraint. Rejected.
- **`{op: 'savedJob.set'}` with dotted op names** — collapses op and entity into one field; harder to validate; route table becomes a string-prefix forest. Rejected in favor of the orthogonal `{op, entity}`.

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | Client sends `{op: 'set', entity: 'savedJob', id: 'job123', payload: {...}}` without `schemaVersion` | Server returns `invalid`; client must include version |
| 2 | Two tabs `set` the same `savedJob` concurrently | Last-write-wins, but `schemaVersion` mismatch on the second writer triggers re-read-then-write. F8 from V2_PLAN |
| 3 | Client sends `{op: 'get', entity: 'all'}` (matrix has it only for export/claim) | `invalid` |
| 4 | Malicious client sends `{op: 'list', entity: 'savedJob'}` for a different `userId` | Auth check uses `userId` from JWT, ignores any `userId` in body. Body never specifies `userId` — only the JWT does |
| 5 | `claim` payload contains a job that's no longer in the feed | Per V2_PLAN F13, claim re-verifies; expired jobs are claimed-but-archived |
| 6 | Schema drift: server is v2, client cached at v1 | `schema_mismatch` response includes `serverVersion`; client triggers reload |

### What would invalidate this spec

- A genuine N+1 problem appears that demands a multi-entity batch op (not in v2.0)
- The op matrix grows past ~25 cells (refactor to subroutes)
- Server-side type sharing with the client becomes worth a build step (then auto-generate the matrix from a Zod schema)

---

## Spec 4 — `/api/llm` prompt versioning and proxy contract

**Resolves V2_PLAN §9 question 4 (LLM provider choice + abuse mitigation).**

### DECIDED

Single proxy at `/api/llm`, body-routed by `{task, version, inputs}`. The provider and model are server-controlled per task — the client never picks. Prompts are versioned strings stored in `/api/llm/prompts/` as plain `.txt` files committed to the repo.

### Provider — Anthropic Claude

**Default model: `claude-haiku-4-5-20251001`** at $1/M input, $5/M output. Sources: anthropic.com/claude/haiku, platform.claude.com/docs/en/about-claude/pricing (verified 2026-04-28).

Rationale:
- Resume Tailor is a structured-output, instruction-following task — well-matched to Haiku's strengths
- Cost ceiling is critical (V2_PLAN trip-wire: <$2/MAU/month)
- Same provider as the rest of Anthropic's surface area (consistency for prompt iteration)
- Prompt caching (90% off cached input) cuts effective cost on the system prompt

Sonnet 4.6 is the escalation tier when Haiku output quality is measurably worse on the fixture set. Opus 4.7 is not in v2.0.

### Schema

```typescript
type LLMRequest = {
  task: 'resumeTailor' | 'profileExtract' | 'titleNormalize';
  version: string;        // e.g. 'resumeTailor.v3'; client sends the version it expects
  inputs: Record<string, unknown>;  // task-specific, validated server-side
};

type LLMResponse =
  | { ok: true; output: unknown; usage: { inTokens: number; outTokens: number; costUsd: number }; promptVersion: string; modelVersion: string }
  | { ok: false; error: string; code: 'unauthenticated' | 'rate_limited' | 'budget_exceeded' | 'task_unknown' | 'version_unknown' | 'invalid_inputs' | 'upstream_error' };
```

### Prompt versioning

Prompts live in repo at `api/llm/prompts/{task}.{version}.txt`. The version is part of the filename, never inline. The proxy loads the matching file at request time (cached in memory after first load).

```
api/llm/prompts/
  resumeTailor.v1.txt
  resumeTailor.v2.txt
  resumeTailor.v3.txt   ← current
  profileExtract.v1.txt
  titleNormalize.v1.txt
```

Each prompt file ends with a comment block recording:

```
# task: resumeTailor
# version: v3
# model: claude-haiku-4-5-20251001
# created: 2026-05-15
# supersedes: v2
# notes: Tightened "do not invent experience" guardrail; added explicit JSON schema
```

When a model is deprecated by Anthropic, the prompt version pinned to that model is regenerated against the replacement model and saved as a new version. Old version files stay in repo for audit (V2_PLAN F9).

### Rate limits and abuse mitigation (HYPOTHESIS — recalibrate after week 7)

The numbers below are starting values, not modeled values. None are derived from measured tailor-call volume per session. Recalibrate against real usage data from the first 100 authed users; until then, treat as guardrails, not targets.

| Tier | Per-user budget | Mechanism |
|---|---|---|
| Free / anonymous | 0 calls — LLM is auth-gated | Server checks JWT exists before any LLM call |
| Authed | 10 `resumeTailor` calls/day (provisional) | Counter at `user:{userId}:llm:resumeTailor:{YYYYMMDD}` with 48h TTL |
| Authed | 50 `profileExtract` calls/day (one per resume upload + retries) (provisional) | Same counter pattern |
| Per-user monthly cost cap | $5 hard cap (provisional) | `user:{userId}:llm:cost:{YYYYMM}` accumulator, each call increments before LLM is called |
| Global monthly cost cap | $200 hard cap (provisional) | `global:llm:cost:{YYYYMM}` accumulator |

The caps are intentionally tight at launch. Loosening them after observing real usage is cheap; tightening after they've been loose is a bad-faith move toward users. Start strict.

Why $5/user vs the $2 trip-wire in V2_PLAN: the trip-wire is the alert threshold (warn at $2 average), the cap is the abuse threshold (no single user exceeds $5). Difference between "look at this" and "stop this." Both numbers are provisional.

### Rejected alternatives

- **Multiple providers behind the proxy** — adds prompt-portability work; v2.0 doesn't need it. Anthropic-only for v2.0; OpenAI is added if and only if pricing or quality forces it
- **Prompts inline in code** — versioning becomes a git-blame archaeology project. Rejected
- **Prompts in KV** — looks flexible, but introduces a non-source-of-truth path; mistakes propagate without code review. Rejected
- **No per-user cap, only global** — one bad actor consumes the budget; rejected
- **Per-IP rate limit** — V2_PLAN Spec 4 is auth-gated; per-user is the right unit. Per-IP is fragile (CGNAT) and irrelevant when auth is required

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | Anthropic API outage | Return `upstream_error`; client shows "tailoring temporarily unavailable, your resume is saved"; retry button |
| 2 | User hits 10/day cap | Return `rate_limited` with `retryAfter`; UI shows reset time |
| 3 | A single user runs scripts to exhaust their own $5 cap | Cap holds; no spillover. Their cost is bounded. Future enhancement: lower cap on suspicious patterns |
| 4 | Prompt v3 is worse than v2 in production | Pin specific accounts to v2 for A/B; if widespread regression, server falls back to v2 by changing the version-resolution map; old file is still in repo |
| 5 | Model deprecation: `claude-haiku-4-5-20251001` retires | Regenerate prompt against replacement model, save as new version, update default-version map. F9 from V2_PLAN |
| 6 | Cost accounting drift: KV cost counter undercounts vs Anthropic invoice | Reconcile monthly against the actual Anthropic billing CSV; if drift > 5%, audit the increment math |
| 7 | Prompt injection via resume content (user uploads a resume that says "ignore prior instructions") | Tailor prompt uses Anthropic's system/user role separation; the resume is a user-message attachment, not a system instruction. Document the threat model in the prompt header |
| 8 | Cross-user output cache leaks one user's tailored resume to another | No cross-user caching, ever. Spec forbids it. Cache key, if added later, must include `userId`. Per V2_PLAN F12 |
| 9 | Token usage exceeds estimate, cost cap exceeded mid-call | Pre-flight estimate + post-call accounting. If post-call accounting trips the cap, the response is returned to the user (they paid for it) but next call returns `budget_exceeded` |

### What would invalidate this spec

- Anthropic raises Haiku 4.5 prices significantly, or quality regresses; switch to Sonnet 4.6 ($3/$15) or another provider
- Per-user cost averages exceed $1/MAU even with caching (then re-tune prompts or escalate to a different model tier)
- We need streaming responses to the client (current spec is request-response; streaming is v2.1)

---

## Spec 5 — Resume fixture format and expected-output contract

**Resolves V2_PLAN §9 question 6 (testable parser regression).**

### DECIDED

Each fixture is a directory under `tests/resume-fixtures/{fixtureId}/` with three files: the source resume (PDF or DOCX, redacted), the expected `UserProfile`, and a metadata file describing what the fixture stresses.

```
tests/resume-fixtures/
  fx001-mle-mid/
    resume.pdf           # source file, real resume, redacted
    expected.json        # expected UserProfile output
    meta.json            # role, seniority, what this fixture exercises
  fx002-research-senior/
    resume.docx
    expected.json
    meta.json
  ...
```

### `expected.json` contract

```json
{
  "schemaVersion": 1,
  "minRecallSkills": ["python", "pytorch", "rag", "vector-db"],
  "exactSkills": ["pytorch", "rag"],
  "forbiddenSkills": ["javascript", "html"],
  "experienceCount": { "min": 3, "max": 5 },
  "education": [
    { "degreeContains": "MS", "fieldContains": "Computer Science" }
  ],
  "links": {
    "github": { "presence": true },
    "portfolio": { "presence": false }
  },
  "tolerances": {
    "skillRecall": 0.85,
    "skillPrecision": 0.80
  }
}
```

### Field semantics

- **`minRecallSkills`** — these MUST be in the parser output. Missing any of them fails the fixture. Use sparingly; reserve for skills the parser must not miss.
- **`exactSkills`** — exact-match list; parser output must contain every skill listed using the canonical taxonomy name. Stricter than `minRecallSkills`.
- **`forbiddenSkills`** — must NOT be in the parser output. Catches over-extraction (e.g., parser pulling "javascript" from a generic "tech stack" line that's about something else).
- **`experienceCount.{min, max}`** — bounded count, not exact. Real resumes have ambiguous boundaries (intern/full-time, contract/perm) and exact counts are noisy.
- **`education.degreeContains` / `fieldContains`** — substring match against canonical strings, not exact. Captures the structural fact ("has an MS in CS") without over-fitting.
- **`links.{type}.presence`** — boolean. URL exact-match is too brittle (redaction changes URLs).
- **`tolerances`** — fixture-level overrides for the global recall/precision targets. Some fixtures (intentionally noisy resumes) have lower bars by design.

### Why not a flat "exact expected UserProfile"

Tempting and wrong. Reasons it fails:

1. Skill taxonomy evolves; a flat-equality test breaks every time a skill is canonicalized differently
2. Order of skills/experience is non-semantic; flat comparison must normalize ordering anyway
3. Real resumes are ambiguous; the fixture must describe what's *required*, not what's *one valid output*
4. Multiple correct outputs are possible (e.g., "pytorch" vs "pytorch-lightning" both reasonable for the same line); flat-equality forces a coin flip

The contract above describes invariants instead of outputs. Invariants are stable across taxonomy churn; outputs aren't.

### `meta.json`

```json
{
  "fixtureId": "fx001-mle-mid",
  "role": "ml-engineer",
  "seniority": "mid",
  "format": "pdf",
  "stresses": [
    "skills-in-prose-not-bullets",
    "github-link-in-header",
    "intern-vs-fulltime-boundary"
  ],
  "redactionLevel": "names-emails-companies",
  "createdBy": "dom",
  "createdAt": "2026-05-08"
}
```

`stresses` is a free-tagged list. The fixture set is balanced when every common stress is covered by at least 2 fixtures. The `meta.json` allows a query like "show me all fixtures stressing skills-in-prose-not-bullets" — the parser regression report can group failures by stress.

### Acceptance bar (replaces V2_PLAN's placeholder)

- **Per-fixture pass:** all `exactSkills` present, no `forbiddenSkills` present, recall over `minRecallSkills` is 100%, education and links match, experience count in range
- **Aggregate parser pass:** ≥85% of fixtures pass per-fixture **AND** mean recall over the union skill set ≥ tolerance.skillRecall

If the bar isn't measurable (parser hits 70% recall on the starter set), V2_PLAN §7 fires and re-opens the plan.

### Rejected alternatives

- **Snapshot testing** (jest-style snapshots) — too brittle; every taxonomy change is a snapshot churn. Rejected
- **Soft-bag-of-words match** with cosine similarity — removes the ability to assert "this skill must appear"; turns regression into vibes. Rejected
- **LLM-as-judge** — circular for v2.0 (we'd be using an LLM to evaluate parser output that may itself feed an LLM). Defer to v2.1 if quality plateaus
- **Synthetic resumes only** — too clean; misses the messiness that real parsers fail on. Real (redacted) resumes only

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | Fixture passes but parser is actually worse for unmeasured cases | Expand fixture set to cover the new stress (the regression itself becomes a fixture) |
| 2 | Redaction destroys signal (stripping "Stanford" makes the education check fail) | Redaction level recorded in meta; redaction is consistent (replace with `[UNIVERSITY]`, not delete); `degreeContains` checks match against `[UNIVERSITY]`-style placeholders |
| 3 | Parser improvement adds a skill that was previously missing — `forbiddenSkills` flags it as a false positive | Author reviews the diff; if the skill is actually present, remove it from `forbiddenSkills`; if it's a hallucination, keep the assertion |
| 4 | A taxonomy change renames `pytorch` to `torch` | Migration script updates all fixture `expected.json` files; CI fails fixtures until migrated |
| 5 | Fixture file size grows past repo storage practicality (PDFs add up) | Cap at 100 fixtures total; rotate out fixtures that no longer cover unique stresses; if it grows past that, move blobs to a Git LFS or external store and keep only `expected.json` and `meta.json` in repo |
| 6 | All fixtures from one author; parser fits author's writing style | Diversify: mix of authors, role types, format origins (LaTeX, Word, Notion-export, ATS-stripped) |

### What would invalidate this spec

- The parser plateau is below the bar set here, sustained for 4+ weeks of work — see V2_PLAN §7
- The fixture set itself becomes the bottleneck (regressions miss because fixtures don't cover them) — expand or replace
- A taxonomy migration is so frequent the migration tooling breaks down — then the taxonomy needs more discipline, not the fixtures

---

## Spec 6 — Resume upload size limit and rejection rules

**Resolves V2_PLAN §9 question 5 (upload size).**

### DECIDED

- **Max file size: 5 MB**
- **Accepted MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)**
- **Rejected at upload: any other MIME, any file > 5 MB, any PDF that's image-only (no text layer)**
- **GDPR delete cascade: deleting a user deletes their tailored outputs as derived data the user owns**

### Why 5 MB

Real-world resume sizes (range estimates, not measured against an Ascent corpus):
- Plain DOCX: 30-100 KB
- Plain PDF (text + standard fonts): 50-300 KB
- PDF with embedded images / portfolio screenshots: 1-3 MB
- PDF with scanned pages or high-res photos: 5-20 MB

5 MB should cover the common case for legitimate text-based resumes, including those with reasonable visuals, while keeping the parser's job bounded. Above 5 MB is overwhelmingly scanned content, which we reject anyway (per V2_PLAN §3.5: no silent OCR). **If the fixture set or production data shows legitimate rejections at 5 MB, raise the cap.**

### Image-only PDF rejection

Detect at upload: extract text via `pdf-parse`; if extracted text count is below a threshold relative to page count, reject with the message "We can't read this PDF — it looks like a scanned image. Please upload a text-based PDF or a Word document."

**Threshold (HYPOTHESIS): < 200 chars total when page count > 0.** This is a starting value. Calibrate against the fixture set in week 1: run text extraction on every fixture PDF, plot text-length distribution, set the threshold to cleanly separate text-only from image-only without misclassifying minimal-text resumes. Document the chosen threshold inline in the parser code with the date and the calibration commit.

False-positive risk at 200 chars: a one-line resume would fail. Acceptable only if the fixture-set calibration confirms no real resume falls below the chosen threshold.

### Failure cases

| # | Scenario | Mitigation |
|---|---|---|
| 1 | User uploads a 4.9 MB PDF with embedded portfolio screenshots; parser extracts text fine but storage cost compounds | Cap at 5 active versions per user (V2_PLAN F7); soft-delete older versions |
| 2 | User uploads a 6 MB legitimate text-based PDF with embedded fonts | Rejected at upload; UI suggests "save as PDF (Reduce File Size)" with a one-line how-to |
| 3 | User uploads a Pages document, an RTF, or an ODT | Rejected at MIME; UI suggests exporting to PDF or DOCX |
| 4 | User uploads a malicious PDF (PDF.js exploits, embedded JS) | We don't render the PDF in the browser; we extract text server-side via `pdf-parse` which doesn't execute embedded scripts. Verify `pdf-parse` version is current at every dependency upgrade |
| 5 | Two users upload the same file (same hash) | Each gets their own ResumeVersion (`contentHash` field allows future dedup at storage level if cost matters; not an optimization for v2.0) |

### What would invalidate this spec

- A documented case of legitimate resumes being rejected at 5 MB
- `pdf-parse` is replaced by a parser that handles scanned PDFs reasonably (then we remove the rejection and run OCR)

---

## Cross-reference index

| Open question (V2_PLAN §9) | Resolved in spec |
|---|---|
| Vercel KV `KEYS`/`SCAN` semantics | Spec 1 (renamed: Upstash Redis) |
| Clerk + Preact integration | Spec 2 |
| Rate limit scope | Spec 4 |
| LLM provider choice | Spec 4 |
| Resume upload size limit | Spec 6 |
| GDPR delete cascade | Spec 6 |
| `/api/data` request shape | Spec 3 (new spec, surfaced during work) |
| Resume fixture format | Spec 5 (V2_PLAN D6 detail) |

V2_PLAN §9 is updated by the same commit landing this file: questions are removed and replaced with a "see V2_SPECS.md" reference.

---

## Self-audit — convenient choices flagged in V2_SPECS

Per the `ascent-handoff-verification` skill discipline, this file was reviewed for "convenient choice that looks like simplicity but is actually a deferred problem." Flagged and resolved:

| # | Convenient choice | Resolution |
|---|---|---|
| S1 | "100 ops/user/month" headroom math in Spec 1 | Marked as a guess; week-4 instrumentation is the actual measurement; trip-wire reframed as ratio of free-tier cap, not absolute count |
| S2 | $5/user and $200 global LLM cost caps in Spec 4 | Section retitled HYPOTHESIS; explicit note that recalibration follows first 100 authed users |
| S3 | "10 calls/day" rate limit in Spec 4 | Same section, same recalibration trigger |
| S4 | 200-char threshold for image-only PDF rejection in Spec 6 | Marked HYPOTHESIS; calibrated against fixture set in week 1 with documented commit |
| S5 | "covers 99% of legitimate resumes" claim in Spec 6 | Removed; replaced with "should cover the common case" + escape hatch to raise the cap if rejections appear |
| S6 | Path A (Clerk imperative mount) chosen confidently for Spec 2 | Marked "DECIDED pending one verification"; added explicit week-3 verification step against current `@clerk/clerk-js@5` API |

Items reviewed and **kept as decided** (no shortcut found):

- Anthropic Haiku 4.5 as the default LLM provider — pricing and quality verified against current docs (April 2026)
- `SCAN MATCH` over `KEYS` for per-user enumeration — `KEYS` is a documented anti-pattern; not a tradeoff
- `{op, entity}` orthogonal routing for `/api/data` — the alternatives (REST, dotted ops, GraphQL) all add complexity without earning it at v2.0 scale
- Invariant-based fixture contract (Spec 5) over flat-equality snapshot — invariants survive taxonomy churn; equality doesn't
- 5 MB upload cap — defensible against listed size ranges, with explicit room to raise
- Clerk over self-hosted auth — non-negotiable per V2_PLAN

The self-audit re-runs at every spec change. New convenient choices will appear; the discipline is naming them.
