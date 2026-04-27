# Resume Tailor Phase 1 — Deploy Package

Generated: 2026-04-26
Target: career-ascent.io (Ascent), gated behind IS_PREVIEW
Files changed: 3 (1 modified, 2 new)

---

## === CHANGE EXPLANATION (Resume Tailor) ===

**WHAT:** Add an AI-powered resume tailoring tool to the existing Resume Tips tab,
gated behind IS_PREVIEW. Users paste their resume + a job description; the tool
returns per-bullet edit suggestions with a hallucination guard, structured tool-use
output, and side-by-side accept/reject diff UI.

**WHY:** Differentiates Ascent beyond a job board into the application workflow.
Existing Resume Tips tab is static content; this adds the "do it for me" execution
layer recruiters and candidates expect from an AI-era job tool.

**WHERE:**
- `index.html` — new CSS block (`rt-*` classes), new ResumeTailor + supporting
  components, new state in App(), one conditional render line inside ResumeTips.
- `api/tailor.js` — NEW serverless function (Anthropic proxy with tool use,
  hallucination guard, in-memory rate limit, kill switch).
- `api/ai-match.js` — fix invalid model string (separate change explanation below).

**RISK:**
- ResumeTips is production-visible. Any JSX error in the new conditional render
  line breaks the production tab. Mitigation: the only edit to ResumeTips itself
  is adding ONE line inside the existing component; the new component lives
  separately and is gated by IS_PREVIEW.
- New CSS uses `rt-` prefix exclusively to avoid colliding with `ct-` (Resume
  Tips/AI Learning shared classes). Verified by grep.
- New localStorage namespace `ascent.resume.*` is the first localStorage usage
  in the codebase. No collision risk.
- /api/tailor.js spends Anthropic credits. Per-IP rate limit + per-instance
  daily soft cap + manual monitoring + kill-switch env var.

**ROLLBACK:**
- Single commit revert: `git revert HEAD`
- Or kill switch: set `TAILOR_ENABLED=false` in Vercel env vars (no redeploy
  needed for this; function reads env at call time).
- Or visual hide: any future commit that wraps the entry point in `false &&`
  hides the feature without removing code.

**VERIFY:**
1. After deploy, navigate to https://career-ascent.io → Resume Tips tab → confirm
   visual is unchanged (no new CTA visible — IS_PREVIEW=false in production).
2. Navigate to https://<preview>.vercel.app → Resume Tips tab → confirm new
   "Tailor my resume" CTA is visible.
3. Click CTA → confirm tailoring workspace renders.
4. Without ANTHROPIC_API_KEY set, click "Analyze" → confirm graceful error.
5. With key set, paste sample resume + JD → confirm structured output renders.

---

## === FAILURE TEST CASES (Resume Tailor) ===

### CRITICAL

1. **JSX syntax error in the conditional render breaks Resume Tips entirely.**
   Detect: Resume Tips tab renders blank or browser console shows "Cannot read
   properties of undefined" or "Unexpected token".
   User sees: Resume Tips tab is broken in production.
   Mitigation: structural integrity check (parens/braces) after every edit.

2. **Hallucination guard fails to catch a fabricated metric.**
   Detect: a `proposed_text` contains a number not in the source resume but
   `risk` is "safe" instead of "do_not_suggest".
   User sees: a suggestion with a fake metric the user might accept.
   Mitigation: code-side regex extraction of all numeric tokens from
   proposed_text, cross-checked against source. If novel, force "do_not_suggest"
   regardless of LLM output. Tested with adversarial prompts.

### HIGH

3. **Anthropic API returns invalid tool-use response (malformed schema).**
   Detect: server logs show JSON parse error or schema validation failure.
   User sees: "Could not generate suggestions. Try again."
   Mitigation: try/catch with specific tool-use error path; UI shows recoverable
   error state, no half-rendered suggestions.

4. **Rate limit exceeded.**
   Detect: 429 response from /api/tailor.
   User sees: "You've made too many requests. Try again in a few minutes."
   Mitigation: in-memory IP counter, 10 requests/hour per IP. UI shows clear
   message.

5. **Kill switch active (TAILOR_ENABLED=false).**
   Detect: 503 response.
   User sees: "Resume tailoring is temporarily unavailable."
   Mitigation: env var read on every call; flip in Vercel dashboard, no deploy.

6. **PII strip false positive (project ID shaped like phone number).**
   Detect: stripped.phone contains a non-phone string.
   User sees: their resume has [PHONE] placeholder where there shouldn't be one;
   when reassembled, looks correct because we re-attach the original tokens
   client-side.
   Mitigation: PII is stripped CLIENT-SIDE only for the network call; the user's
   displayed resume always shows the original text.

### MEDIUM

7. **Empty resume submitted.**
   Detect: validation pre-check.
   User sees: "Please paste your resume first."
   Mitigation: client-side validation before any API call.

8. **JD too long (>20k chars).**
   Detect: pre-flight char count.
   User sees: "Job description is unusually long. Try pasting just the role
   description and requirements."
   Mitigation: 20k char limit before send.

9. **localStorage quota exceeded.**
   Detect: try/catch on JSON.stringify + localStorage.setItem.
   User sees: "Could not save tailored resume locally. Browser storage may be
   full."
   Mitigation: graceful catch, suggest deleting old tailored versions.

10. **Anthropic monthly spend approaching cap.**
    Detect: manual monitoring of Anthropic console.
    User sees: nothing yet (no automated cap without KV).
    Mitigation: weekly check; flip kill switch if approaching $50.

### LOW

11. **User pastes resume in non-English language.**
    Detect: heuristic — if extracted parsed.skills is empty AND raw text contains
    >50% non-ASCII characters.
    User sees: "Resume tailoring currently supports English. Other languages
    coming soon."
    Mitigation: client-side check; refuse before API call.

12. **User accepts a `needs_confirmation` edit without explicit confirmation.**
    Detect: UI design ensures these require a modal confirm.
    User sees: a modal "This edit may add information not in your original
    resume. Are you sure?"
    Mitigation: separate confirm path in UI for elevated risk levels.

---

## === CHANGE EXPLANATION (ai-match.js model string fix) ===

**WHAT:** Fix the model string in /api/ai-match.js from
`claude-sonnet-4-6-20250217` (invalid) to `claude-sonnet-4-6` (current valid
alias per Anthropic's models documentation).

**WHY:** The current value `claude-sonnet-4-6-20250217` is not a valid model
identifier. Anthropic's API rejects every call, the catch block returns
`"Could not analyze. Try again."`, and the AI Match feature has been silently
broken in production. This was discovered while preparing the Resume Tailor
deploy.

**WHERE:** `api/ai-match.js`, line 39 (single line change).

**RISK:**
- Once fixed, AI Match will start consuming Anthropic credits again. Existing
  usage was zero (every call failed). New usage is bounded by the existing
  feature's natural usage rate.
- If `claude-sonnet-4-6` alias is later updated by Anthropic to point to a
  newer model, behavior could change silently. Per Anthropic's docs, this is
  the intended trade-off of using aliases. Acceptable for v1.

**ROLLBACK:** `git revert HEAD` on this commit, or change the string back.

**VERIFY:**
1. After deploy, go to https://career-ascent.io
2. Open AI Match panel (toggle in companies tab)
3. Paste any LinkedIn URL
4. Click "Match me"
5. Confirm response is structured JSON with top_matches, not error message.

---

## === FAILURE TEST CASES (ai-match.js fix) ===

1. **CRITICAL: New model string also invalid.**
   Detect: same error message as before.
   User sees: "Could not analyze. Try again."
   Mitigation: model string verified against Anthropic docs (April 2026).

2. **HIGH: Alias points to a model with different output behavior.**
   Detect: response shape changes (e.g., adds prose around JSON).
   User sees: "Could not analyze" because regex fence stripping fails.
   Mitigation: the regex fence stripping is permissive; failure mode is the
   pre-existing one.
