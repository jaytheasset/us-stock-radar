# SEC-source human exception comparison — 2026-10-08

## Scope and contract

Base `0d406e3fdb320a3f6cc5b45506865a8276b955dd`, existing detached candidate
`C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
**PASS for separate SEC human judgment and Kiwoom comparison while preserving
automatic REVIEW/null.** Not authenticated approval, same-security confirmation,
storage integration or ticker activation. No existing automatic path is changed.

`lib/ticker-verification/kiwoom/humanException.ts` exports:

- `SecHumanJudgment`: automatic candidate revision; exact SEC source identity
  (CIK, accession, result/raw IDs, URL/name/hash); separate values, security
  title/class, occurred/proposed/unknown event state, optional SEC-only exchange
  transfer, proof per field/context; status/reason, actor, revision/predecessor.
- `createHumanExceptionComparison`: retains A (full automatic evaluation and
  original candidate link), B (SEC human judgment), C (linked Kiwoom row).
  Compares B/C with input label `sec_human_values_vs_kiwoom_transcription` and
  records A/B differences for the three compared values.
- `checkHumanExceptionComparison`: requires explicitly supplied current
  candidate, SEC source, judgment, review, row and snapshot. Changed content,
  revision or withdrawal blocks reuse; missing inputs fail closed.

Existing review facts must still equal A, including its null date. B is never
copied into those facts or A. Existing EXCHANGE_CONFLICT and other rejection
rules remain intact. Proofs are exact `[start,end)` UTF-16 offsets and quotes in
existing `secVisibleText(rawContent)`. Validation checks source hash/reference,
exact SEC document URL, quote inclusion, value formats and revision shape.
No keyword, proximity, date-inference or company-specific semantic rules.

Field equality, human status and assessment eligibility are separate. Date
comparison requires an occurred judgment, date/event proofs and a Kiwoom
market-effective date basis. Missing proof is unconfirmed. Non-US/different or
unconfirmed rows, compound events, known class/type conflict, missing context
and unconfirmed/withdrawn judgments prevent eligibility. `eligible` means only
this local comparison checklist, never approval or ticker-change permission.
Every result retains `tickerAuthority: none`, `authentication: not_verified`,
`semanticAccuracy: requires_human_review` and supporting-evidence authority.

SEC exchange is recorded only under `exchange.secOnly`; Kiwoom exchange stays
null and `compared` false. Missing Kiwoom CIK/class/type is not populated from
SEC. No merger counterparty history or security is combined.

Hash/quote inclusion does not prove semantic accuracy, source authenticity or
administrator authentication. Predecessor hash format is checked; no verified
append-only judgment chain or storage is implemented. The caller must provide
genuinely current inputs. Identical historical inputs can replay identically
without proving live freshness. This minimal contract binds B to A's exact SEC
evidence document; it does not discover documents or orchestrate current records.

## Actual retained-source result

Reused originals from [actual SEC validation](KIWOOM_REAL_SEC_LINK_VALIDATION.md),
without network. CIK **0002041610**; before 8-K **0001104659-26-113076**;
after 8-K **0001104659-26-113913**. Replayed the existing cover builder, source
validation, cover adapter and canonical evaluator into a new output file.
The automatic candidate equals the preserved previous candidate.

| Field | Automatic A | SEC human B | Kiwoom C | B/C |
| --- | --- | --- | --- | --- |
| Old ticker | PSKY | PSKY | PSKY | match |
| New ticker | SKYD | SKYD | SKYD | match |
| Effective date | null | 2026-10-06, occurred | 2026-10-06 | match |
| Security class | B | Class B Common Stock / B | absent | not confirmed by Kiwoom |
| Exchange transfer | EXCHANGE_CONFLICT reason | Nasdaq to NYSE | absent | not compared |

A stays **REVIEW**, date/precision null, with EXCHANGE_CONFLICT and
SUPPORTED_CHANGE_EVIDENCE_MISSING. B's `confirmed` records a research reading,
not authenticated approval. Assessment is **ineligible:
row_correspondence_unconfirmed**.

The completed-event sentence in the after filing begins “Additionally, in
connection with the Closing” and states the October 6 Class B listing transfer
from Nasdaq to NYSE and PSKY to SKYD change. Normalized coordinates:
**3086–3361**, end-exclusive. The complete quote is in the test and result.
B was manually read from this sentence independently of C.
C: notice **4611**, image 1, table year **2026**, **10월6일 / US / 심볼변경 /
PSKY → SKYD**. The separate October 5 corporate-action row is not used.
Weekly period, posting and account/settlement dates do not supply the date.

| Retained source | SHA-256 |
| --- | --- |
| Before SEC body | `52931a86349c70126cebeeeba86a9ddd4e290e80a2c060c349c16b0e60e4c9e4` |
| After SEC body | `84e5fde7dce0a8fc0c1a5cad36c81b52455f53d4070ed2ce48f165f196e1b3b2` |
| Kiwoom snapshot | `78d820eb08e42b755cf9b8083aa7da13aaa142323848eb10fd0c6d4b78d255f2` |
| Kiwoom image | `8a35b9b094754035c26e366024719c26bd8dc11758b9f470c269252f25c97df2` |

Actual before-source control: the earlier 8-K says the company **intends** to
change the symbol on October 6. Its bytes/observations go through the existing
evaluator; a separate source-bound human judgment says `proposed`. Its date
comparison stays **unconfirmed**. No candidate was edited to create this control.

Actor/review/case IDs, raw-item envelopes, timestamps and judgment revisions are
**synthetic test metadata**. SEC HTML, image and literal row are actual retained
evidence. Conflict/revision/withdrawal cases are controlled mutations. No real
administrator account, stored review or approval is claimed.

## Tests and semantic limit

- Kiwoom **38/38** (28 existing + 10 new); canonical SEC **7/7**.
- Actual-source mode **10/10**, covering completed/proposed documents, missing
  proof, ticker/date/row mismatch, invalid identity/hash/offset/reference,
  judgment revision/withdrawal, candidate/SEC/image/row/review changes, unavailable
  current inputs, deterministic replay and original-input immutability.
- Deliberate semantic-error control: both typed dates are **October 7**, quoting
  the real **October 6** sentence. Reference checks pass and strings match.
  Recorded separately as **wrong** and requiring human review; not claimed to
  be automatically detected or approved.
- New logic/tests network attempts **0**; no ticker/current/Watchlist/Alert
  mutation imports or calls. Existing timeout regression uses owned localhost
  only. No live SEC/Kiwoom, LLM/OCR or DB. Full typecheck and diffcheck pass.

External artifacts, under the retained `real-sec-link` directory:
`human-exception-automatic.json`, `human-exception-result.json`,
`human-exception-proposed-control.json`, `human-exception-semantic-control.json`,
`human-exception-tests.log`. Original `result.json`, manifest and source bytes
are preserved. No whole original source added to Git.

Reproduce in PowerShell from the candidate:

```powershell
$evidenceDir = 'C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/real-sec-link'
node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --experimental-strip-types scripts/verify-kiwoom-real-sec-link.mjs "$evidenceDir/manifest.json" "$evidenceDir/human-exception-automatic.json"
$env:KIWOOM_HUMAN_TEST_DIR = $evidenceDir
try {
  node --no-warnings --experimental-strip-types --test lib/ticker-verification/kiwoom/humanException.test.ts
} finally { Remove-Item Env:KIWOOM_HUMAN_TEST_DIR }
npm run verify:kiwoom-evidence
node --no-warnings --experimental-strip-types --test lib/sec-ticker-resolution/canonical.test.ts
npx tsc --noEmit --incremental false
git diff --check
git diff --cached --check
```

## Handoff boundary

Local main ref: `d7347e4d2e75a5c412f69218003d2dfd407c79c5`.
GitHub/Vercel/shared DB/cron unqueried; code equality/deployment not claimed.
No migration, environment/UI/browser/login change, paid API, collection,
main/3110/Docker operation, merge/push/deploy. Existing real authentication and
storage integration gaps remain outside scope. Stop for GPT independent review.

## Explicit automatic/human class conflict fix

Follow-up base `4776ca68afdf4b412e78ff49ac9797402fc2f554`, detached/clean.
Before modifying product code, added five direct class controls and ran:
`node --no-warnings --experimental-strip-types --test --test-name-pattern='automatic-human class' lib/ticker-verification/kiwoom/humanException.test.ts`.
A/D/E passed; B/C failed because both returned `eligible: true`, reasons `[]`.
The failure log is retained as `real-sec-link/class-conflict-before.log`.

The only product change compares the already structured automatic candidate
class with the SEC human class. When both are non-null and unequal, it adds
`automatic_human_security_class_conflict`. No parsing, normalization, correction
or change to field comparison, automatic decisions or reuse logic.

| Control | Automatic / human / Kiwoom class | Before eligible | After eligible | New conflict |
| --- | --- | --- | --- | --- |
| A | B / B / null | true | true | no |
| B | B / A / null | true | false | yes |
| C | B / A / A | true | false | yes |
| D | null / A / null | true | true | no; automatic null retained |
| E | B / null / null | true | true | no; human null retained |

These are controlled assertions with synthetic row-correspondence confirmation
to isolate this guard. D uses synthetic class-unspecified cover observations
through the existing evaluator, not an edited real candidate. All five retain
three matching ticker/date fields, original REVIEW/EXCHANGE_CONFLICT, distinct
class values and `tickerAuthority: none`. Eligibility here is not class identity
confirmation or administrator approval. Missing classes remain missing.

The unmodified actual PSKY sample remains B/B/null, REVIEW/date null, human/date
2026-10-06, three-field match and **ineligible: row_correspondence_unconfirmed**.
Hashes of all nine retained JSON/HTML files before/after replay are equal,
including the original automatic and human comparison outputs.

Regression: existing 38 plus five controls **43/43**; canonical SEC **7/7**;
retained-source mode existing 10 plus five controls **15/15**. Full typecheck
and diffcheck pass. Commands are the same as above. New logs:
`class-conflict-regression.log`, `class-conflict-real-mode.log` alongside the
pre-fix log. No existing expectations weakened. No additional defect fixed,
UI/login/DB/source fetching or ticker writes; prior scope restrictions remain.
