# Resume Fixtures

This directory holds the redacted real-resume fixture set used to test the
domain-specific resume parser. Spec: `V2_SPECS.md` — Spec 5.

## Authoring discipline (read before adding any fixture)

### 1. Redaction is mandatory. No exceptions.

Every fixture must have PII redacted before commit. If you are not 100%
sure a fixture is fully redacted, do not commit it. PII in git history is
catastrophic and unrecoverable without a force-push of history (which is
itself banned per ascent-engineering §1).

**Required redactions**, applied to both the source file (`resume.pdf` /
`resume.docx`) and any extracted text:

| Field | Replacement |
|---|---|
| Full name | `[CANDIDATE]` |
| Email | `candidate@example.com` |
| Phone | `+1-555-555-0100` |
| Street address | `[STREET], [CITY], [STATE] [ZIP]` |
| Personal URLs (LinkedIn, GitHub, portfolio) | `https://example.com/[CANDIDATE]` if presence matters; remove otherwise |
| Company names | `[COMPANY-A]`, `[COMPANY-B]`, etc. — preserves the *fact* of N distinct employers without leaking which |
| University names | `[UNIVERSITY]`, `[UNIVERSITY-2]` — preserves the structural education claim |
| Dates of birth, graduation years, employment dates | Preserve **only** if structurally needed by the fixture's stresses; otherwise generalize (e.g., "2018-2021" -> "[3 years]") |
| References (named individuals) | Remove entirely |

The `expected.json` file uses these placeholder strings in its `degreeContains`,
`fieldContains`, and `links` assertions. Do not assert against original strings.

### 2. The redaction must not destroy signal.

A redaction that removes the structural fact under test defeats the fixture.
Examples:

- Replacing every company with `[COMPANY]` (no suffix) makes the fixture
  unable to assert on number of distinct employers. Use `[COMPANY-A]`,
  `[COMPANY-B]`.
- Replacing all dates with `[DATE]` removes the parser's ability to infer
  experience duration. Generalize to ranges (`[3 years]`) instead.
- Replacing all skill mentions with `[SKILL]` defeats the entire fixture.
  Skills are not PII — keep them.

### 3. Diversity matters more than count.

A fixture set of 30 resumes from the same author, same role, same format is
worse than 10 resumes spanning roles, formats, and writing styles.
`meta.json.stresses` records what each fixture exercises. Before declaring
the starter set complete, every common stress must be covered by at least
2 fixtures. See `_TEMPLATE/meta.json` for the stress vocabulary.

### 4. Source files are committed.

`resume.pdf` and `resume.docx` are committed to the repo. Do not store
them externally — the fixture set must be reproducible from a fresh clone
without depending on Dom's machine or any cloud bucket.

If the repo grows past practical Git limits (~50MB) due to fixture PDFs,
move the *blobs* to Git LFS but keep `expected.json` and `meta.json` in
plain Git. Spec 5 covers this.

## Layout

```
tests/resume-fixtures/
  README.md                   <- you are here
  _TEMPLATE/                  <- copy this directory to start a new fixture
    resume.pdf                <- (placeholder; replace with redacted real PDF)
    expected.json             <- assertions per V2_SPECS Spec 5
    meta.json                 <- stress tags, role, author, redaction level
  fx001-mle-mid/              <- first real fixture
    resume.pdf
    expected.json
    meta.json
  fx002-research-senior/
    ...
```

Fixture IDs are `fx{NNN}-{role-slug}-{seniority}`. Zero-padded to 3 digits;
seniority is one of `intern | junior | mid | senior | staff | principal`.

## Running fixtures

(Parser CLI lands in week 2. Once present:)

```
node scripts/resume-parser/run-fixtures.js [--filter fx0]
```

Output is a per-fixture pass/fail with the specific assertion that failed.
Aggregate report shows recall and precision over the union skill set per
V2_SPECS Spec 5 acceptance bar.

## Privacy

These fixtures live in a public GitHub repo. Treat every byte committed
here as public forever. If in doubt about whether a redaction is sufficient,
ask a second person to review before the commit. The cost of a privacy
incident is far higher than the cost of an extra review pass.
