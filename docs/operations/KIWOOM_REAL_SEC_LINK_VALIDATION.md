# Kiwoom linkage: actual SEC input validation, 2026-10-08 KST

## Scope and outcome

Base `cac6bce9e31699eddcc9ece1dc67e3495861194d`, existing detached/clean
`C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
Only a verification script and this receipt were added. Product code, accepted
pure linkage tests, UI, login, DB, migrations and collection policies are unchanged.

**One actual event / two actual SEC filings tested.** Source parsing and passing
unmodified candidate values to `candidateLink` succeeded. The result is
**unconfirmed**, not a successful three-field or same-security verification.
No values were supplied to fill gaps in the existing candidate result.

## Selection and acquisition

Inspected retained Kiwoom notice/list and local candidate verification scripts.
The prior Kiwoom linkage sample used synthetic SEC candidates. The local SEC
candidate tests concern other issuer changes; a corresponding original pair
for notice 4611 was not found in the inspected local material. This is a scoped
search result, not a claim that no other retained source exists anywhere.

Public SEC search found before/after 8-Ks for the PSKY row in the already
retained notice. Selected this event because both original filings are available,
not because its outcome matches the synthetic test. Other discovery results
(ILCB ETF and VACI business combination) were not run as additional cases.

Retrieved exactly **3 native HTTP bodies**: two SEC primary HTML documents and
one SEC Submissions metadata document. No retry. Search-service discovery was
separate (four search queries and two inaccessible filing-index opens); index
access failures were not treated as missing filings. No new Kiwoom fetch,
paid API, LLM/OCR or DB call. The verification script itself is offline and
replaces `fetch` with a failure guard; network attempts during replay: **0**.

## Actual source identities and hashes

Issuer CIK **0002041610**. Accession, form, filing date, acceptance timestamp
and primary filename came from retained official Submissions metadata. Before
and after cover CIK contexts were checked by the existing parser. Current
Submissions company name is not used to invent a historical observation.

| Role | Accession / date / document | SHA-256 of retained UTF-8 body |
| --- | --- | --- |
| Before, 8-K | `0001104659-26-113076`, 2026-10-02, `tm2626659d3_8k.htm` | `52931a86349c70126cebeeeba86a9ddd4e290e80a2c060c349c16b0e60e4c9e4` |
| After, 8-K / change evidence | `0001104659-26-113913`, 2026-10-06, `tm2626659d7_8k.htm` | `84e5fde7dce0a8fc0c1a5cad36c81b52455f53d4070ed2ce48f165f196e1b3b2` |
| Metadata | `https://data.sec.gov/submissions/CIK0002041610.json` | `f89875138e6d54305d2922d1e11f25b8aea0f6bde2be81f8efdf2ca72f39f23f` |

Original documents: [before 8-K](https://www.sec.gov/Archives/edgar/data/2041610/000110465926113076/tm2626659d3_8k.htm),
[after 8-K](https://www.sec.gov/Archives/edgar/data/2041610/000110465926113913/tm2626659d7_8k.htm).
Acceptance times are respectively `2026-10-02T17:29:01.000Z` and
`2026-10-06T17:08:38.000Z`. HTTP bodies were retained as decoded UTF-8; capture
timestamps in the manifest are local file-write times, not SEC event dates.

Kiwoom [notice 4611](https://bbn.kiwoom.com/bbs/VBbsNoticeBWGCZDetailView?seqid=4611):

- Snapshot SHA-256: `78d820eb08e42b755cf9b8083aa7da13aaa142323848eb10fd0c6d4b78d255f2`.
- Original image SHA-256: `8a35b9b094754035c26e366024719c26bd8dc11758b9f470c269252f25c97df2`.
- Exact row: image 1, `효력일 (2026)` header, `10월6일`, `US`, `심볼변경`,
  `PSKY`, `파라마운트 스카이댄스`, `PSKY → SKYD`.
- Manually re-read the preserved image and reused that exact transcription.
  Date `2026-10-06` is from the table year and this row's merged date cell.
  The posting date and weekly title range do not supply the event date.
  The distinct PSKY corporate-action row under October 5 was not substituted.
  No account posting, settlement, transfer or account restriction data is used.

## Existing path and unmodified results

Executed:
`buildSecCoverObservationPayload` → `validateSecCoverStoredPayload` → existing
`coverObservations` adapter → `evaluateSecTickerResolution` →
`candidateRevision` / `createCandidateEvidenceLink`.
No persistence function, repository or database was called. The pure cover
builder accepts an 8-K with a complete primary HTML body; no form bypass was
introduced. Both cover payloads are **available** and pass source replay validation.

| Observation | Actual value |
| --- | --- |
| Before security | Class B Common Stock, $0.001 par value |
| Before symbol / exchange | PSKY / The Nasdaq Stock Market LLC |
| After security | Class B Common Stock, $0.001 par value |
| After symbol / exchange | SKYD / New York Stock Exchange |
| Context IDs | `AsOf2026-10-02` / `AsOf2026-10-05` (kept unchanged) |
| Candidate state | **REVIEW** |
| Candidate old / new ticker | **PSKY / SKYD** |
| Candidate effective date / precision | **null / null** |
| Candidate security type / class | common_stock / B |
| Candidate continuity basis / source text span hash | null / null |
| Candidate reasons | `EXCHANGE_CONFLICT`, `SUPPORTED_CHANGE_EVIDENCE_MISSING` |

The after 8-K's explanatory note explicitly describes the October 6 closing,
transfer from Nasdaq to NYSE and PSKY→SKYD symbol change. It connects these
actions with the WBD merger. Thus this is **not missing SEC source material**.
The existing narrow change extractor does not accept this clause as supported
same-security change evidence; it requires its established wording/continuity
patterns. The exchange difference also independently prevents AUTO. These are
preserved contract boundaries, not fixed with a fixture-specific parser rule.

The null date was not replaced with a date from the SEC paragraph, cover context,
Submissions filing date, Kiwoom row or previous synthetic test.

| Comparison field | Actual SEC candidate | Kiwoom transcription | candidateLink result |
| --- | --- | --- | --- |
| Old ticker | PSKY | PSKY | match |
| New ticker | SKYD | SKYD | match |
| Effective date | null | 2026-10-06 | unconfirmed |

Aggregate: **unconfirmed**; reasons: `review_unconfirmed`,
`security_row_not_confirmed`, `candidate_date_precision_unconfirmed`.
The exchange conflict is between the SEC before/after observations, not an
assertion that SEC and Kiwoom contradict each other. There is no proven date
disagreement between the two original sources; the candidate date is unavailable.
Only the two ticker fields agree. Kiwoom does not identify the share class or CIK
in this row; no same-company/same-security approval follows from name/symbol similarity.

## Actual evidence versus test metadata

Actual: original SEC HTML, official Submissions filing metadata, parser-created
cover observations/candidate, retained Kiwoom snapshot/image and manual row text.

Test-only: in-memory raw-item UUID envelopes and review ID/actor/request UUID,
revision 1, `verdict: unclear`. `usMarketRowReviewed: true` means the research
image was manually read, not an authenticated administrator review. Row
correspondence remains **unconfirmed**. No real user account, stored review or
approval is claimed. Candidate values in the test review are copied unchanged
from the evaluated SEC candidate; they are not an independent evidence source.

The historical link replay accepts the identical supplied historical inputs with
status unconfirmed. Its `reusable: true` is not proof of latest live-source state.
Authority remains `supporting_evidence_only` / `tickerAuthority: none`.

## Reproduction, limits and handoff

External retained artifacts (not committed):
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/real-sec-link/`
contains `manifest.json`, `psky-before.htm`, `psky-after.htm`, `submissions.json`
and `result.json` (full original candidate, observations, link and provenance).
The script verifies every source hash before replay and binds the transcription
to the established notice/image hashes. Original source files are unchanged.

From this worktree in PowerShell:

```powershell
$evidenceDir = 'C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/real-sec-link'
node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --experimental-strip-types scripts/verify-kiwoom-real-sec-link.mjs "$evidenceDir/manifest.json" "$evidenceDir/result.json"
node --check scripts/verify-kiwoom-real-sec-link.mjs
npx tsc --noEmit --incremental false
git diff --check
```

An initial relative-loader invocation failed to resolve the loader under a
Windows path containing a space. Absolute file URLs resolved it; this was a
harness invocation issue, not a product defect. No candidate/source correction.
Actual-input replay, script syntax, full typecheck and staged diffcheck passed.
Previously accepted synthetic/UI/login verification was not repeated as new evidence.

**PASS only for actual-source ingestion, replay integrity, unchanged values and
the conservative comparison boundary.** Three-field verification, automatic
same-security approval, current/live freshness, DB/authentication and production
integration are not established. No minimum product fix is proposed: extending
supported event/exchange semantics would require a separately approved contract,
not a corrective tweak in this source-validation task. No second sample was
needed to explain this boundary; no search for a forced positive result.

Local main ref read from this candidate remains
`d7347e4d2e75a5c412f69218003d2dfd407c79c5`. GitHub main, Vercel, shared DB and cron
state are unqueried. No migration, main/3110/Docker operation, new worktree,
reset, merge, push or deploy. Existing UI/login checks were not repeated.
Stop for GPT independent review after this verification-only handoff.
