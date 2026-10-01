# SEC delisting state, phase 1

The state reader itself remains read-only. The following connection now lets
the existing Listing Risk child workflow persist its source-backed result;
the older sections retain the scope and evidence of their respective stages.

## Deterministic Listing Risk connection (2026-10-01)

After a successful existing Form 25 Primary run, the existing SEC analysis
ingest hook now reserves one `sec_form25` / `listing_risk` child. Form 25,
25-NSE and their amendments use `listing_risk_form25_state_v1`. The child uses
`readStoredForm25Source` and `evaluateStoredForm25`, not a provider. Primary
analysis, the deterministic parser/state rules and all other families remain
unchanged. No LLM call, prompt, provider fallback or new Monitor is introduced.

`form25ListingRisk.ts` projects an established removal into the existing
`listing_removal` fact, and an established/scheduled suspension into the existing
`trading_suspension` fact. The latter's Registry meaning already includes a
scheduled action; its date remains `scheduled`, never `occurred`. Pending
removal alone cannot mean completed `listing_removal`. Pending-only/unresolved
cases therefore store `not_applicable` in the existing eligible-facts contract,
while retaining their actual pending/unresolved state and reasons separately.
An unavailable adverse/procedural outcome, ticker or date stays unavailable;
neither Primary prose nor catalog status supplies a replacement.

The normal child reservation, exact-parent checks, terminal lifecycle, typed
writer, official reader, Matcher and alert consumer are reused. No changes to
Monitor conditions, identity/Human-review gates, activation or dedupe policies.
The `form25_listing_state` AI output preserves the input source snapshot,
as-of date, state, reasons and parser/source hashes. Existing
`event_listing_risk_results` and `event_listing_risk_facts` hold the unchanged V2
fact contract. The official reader also returns `form25State` for both eligible
and ineligible results. Original raw evidence is not rewritten.

Migration `20260930163226_form25_listing_monitor_connection.sql` extends only
the existing writer/reader functions. It accepts this source/contract/parent
combination and actual retained document URLs; it requires the trace, result
and current raw snapshot to agree. Current-parent checks and immutable replay
remain enforced. There are no new tables or grants. The two predecessor
function bodies were checked against the ordered repository migrations before
replacement. Only the authorized isolated DB was migrated; function ACLs are
unchanged. Other databases still require this migration before using the route.

### Verified cases and limits

| Retained real SEC source | Official result | Existing condition and alert path |
| --- | --- | --- |
| TTOO 25-NSE/A, `0001354457-25-000637` | Available; confirmed removal 2025-07-21, suspended 2025-02-12 | `listing.event_kind = listing_removal` matches the typed facts. Actual consumer blocks on the existing unresolved subject identity (`subject_not_in_sec_catalog`); zero alerts. |
| FTCH 25-NSE, `0000876661-23-001010` | Not applicable; `removal_pending` and original reasons retained | No eligible completed-removal fact; zero alerts. Existing identity is also unresolved. |
| PLTR 25, `0001321655-24-000231` | Not applicable; `unresolved` because source dates/status are insufficient | Identity is available, but no eligible fact; zero alerts. |

`scripts/verify-form25-listing-isolated.mjs` uses those retained raw records,
the production child starter/runtime, typed persistence, official reader,
Matcher and alert consumer. It requires an explicit isolated connection at
`127.0.0.1:57322` / REST `57321` and verifies system identifier
`7689949482832261158`. Credentials come from the authorized local environment
and are never recorded. No external request is needed.

This DB had no real Primary records for these cases: parent/event fixtures are
explicitly labelled `fixture-no-provider`, not presented as new Primary model
results. The starter invokes the actual worker synchronously in this test;
live Workflow scheduling and fresh Primary execution were not exercised.
Earlier source-ingest evidence below establishes the retained raw inputs.
Positive real alert insertion is **not** claimed because the identity gate
legitimately blocked TTOO; existing alert creation/dedupe regressions passed.
No identity override, dates, policies or accounts were changed to obtain alerts.

Repeated execution kept one typed result per child and one TTOO fact row,
without new alerts or source changes. Same-payload SQL replay was idempotent.
Changed raw evidence, changed trace, forged document URL and stale parent were
rejected in transactions that were rolled back. The original reader result
remained identical. A validation-harness RPC arity error was corrected; it was
not a product failure or a successful database guard test.

Final regression: **142/143 passed**, none skipped. The remaining failure is
the pre-existing `listingMonitorMatcher.test.ts:518` blanket source-string
assertion: unchanged Matcher imports/types already contain `Evidence`.
Both source and test are identical to task base `874d4ca9` after newline
normalization, and the exact assertion fails there too. It was not weakened.
Full `tsc --noEmit --incremental false` passed after typing the new fixture
mutations. No product type error remains.

Evidence: `C:/Users/PC/.codex/visualizations/2026/10/01/form25-monitor-connection/`.
`e2e.log` records the initial runtime outcomes; per-case JSON and timestamped
`repeat-*` directories record official readback and repeated runs.
`database-guards.json` inside the successful repeat records rollback checks.
`migration-predecessor-check.json`, `migration-applied.json`,
`baseline-static-failure.json`, `regression-final.log` and
`typecheck-corrected.log` record the remaining checks.

Execution/source history uses existing AI run/output storage. Existing admin
Form25 identity/analysis review is unchanged; its human-decision history and
the Form4-specific evaluation-history screen are not repurposed as Form25
evaluation UI. No browser/UI verification is claimed in this connection task.
There is no new timed state refresh, amendment-chain reconciliation or
market-wide source/identity coverage. Unsupported templates and uncertain
source facts still fail closed.

### Candidate handoff

- Worktree: `C:/Users/PC/.codex/worktrees/form35-history-validation/US-Stock Radar`,
  detached candidate based on `874d4ca9d5669df88dae57ff450fa8db7e7504d7`.
- Local main ref: `0b75ffcf573b64fcf030fde432d594bfa9f487ae`, unchanged.
- Cached `origin/main`: `9c13aee7ef41b38bac0637e53e579633745effda`;
  live GitHub main and Vercel deployment were not queried. Equality/deployment
  is not claimed. No merge, push or deployment was performed/authorized.
- Only the isolated DB received the new migration and labelled test data.
  Main/shared-local, remote migration state, cron and external services were
  unchanged. No environment/credential, Docker or server lifecycle change.
- No PC/mobile screen verification this task. Reuse the prior source-reader
  evidence only within its stated scope; it is not fresh automatic Monitor E2E.
- Before an integration, independently review this candidate and apply its
  migration to the explicitly authorized target. Do not resolve the isolated
  identity gap by guessing a ticker or bypassing existing gates.

## HTML scope and cover-sidecar investigation (2026-09-30)

Candidate follow-up to `5b9b8956`, limited to source integrity. The PLTR HTML
limitation described in the previous section below is now partly resolved.
No Primary parser/prompt, Listing Risk classification rule, Monitor routing,
SQL/schema or source record is changed.

`htmlScope.ts` recognizes only the standard labelled issuer/exchange and class
fields, with a retained complete SEC submission proving the same accession,
form, primary filename and textual content. Its single FILER name/CIK must
match the primary's labelled issuer and SEC archive directory. The primary must
explicitly check the issuer-filed Rule 12d2-2(c) provision; this is the evidence
that FILER is the subject issuer, not an assumption that all filers are issuers.
The existing parser's issuer/class/rule facts must agree. Missing, duplicated,
conflicting or differently formatted proof stays unavailable. No company-name
catalog lookup or synthetic XML is used. The existing source/evidence model
retains the header and HTML field provenance, and `isXml` stays false.

This narrow scope proof feeds the existing deterministic state reader through
`readStoredForm25Source`; reader/ingest-adapter versions are now v3. The existing
date/status rules still apply. PLTR's filing/index effectiveness date is **not**
an exchange-removal date. Its scope now reads back as issuer 1321655, Class A
common stock, par value $0.001 per share, New York Stock Exchange, rule (c), but
listing/trading remain unresolved with `removal_effective_evidence_unavailable`
and `suspension_evidence_unavailable`, rather than `xml_scope_unavailable`.
Other HTML templates and exchange-filed HTML lacking direct subject proof are
not newly supported.

### Separate cover persistence failure: confirmed cause, intentionally unchanged

The actual stored records were read through the normal REST reader and passed
to `buildSecCoverObservationPayload`. The existing DB persistence function was
then exercised in transactions that were always rolled back:

1. TTOO/FTCH are exchange-filed: their archive CIKs are 1354457/876661 while
   the subject issuers are 1492674/1740915.
2. `createSecFilingDocumentArtifact` validates an issuer-CIK archive path and
   rejects these with `artifact accession URL mismatch`. No XBRL artifact or
   cover observation is produced (`identity_mismatch`, zero observations).
3. The cover payload still marks its source `available`, but has no artifact.
   `persist_sec_cover_observation_result` rejects that null-source/available
   combination with SQLSTATE `22023`, `SEC cover absent source state is invalid`.
   The ingest sidecar records its generic `persistence_failed` code.
4. PLTR's cover record instead replays with `parse_failed` / zero observations:
   the plain HTML/SGML primary is not well-formed XML/XHTML for the XBRL parser.

This is a real cover-sidecar mismatch, **not** lost Form25 original evidence.
The Form25 path reads `raw_items.raw_payload.form25_source`, not cover results.
Its XML issuer/security/exchange scope and notices remain available even while
cover persistence reports failed. The state reader's cover dependency applies
to its separate 8-K/6-K branch. Optional historical ticker review may use cover
evidence from another filing, but these Form25 sources contain no usable DEI
cover observations to restore. Expanding the common XBRL URL contract or
weakening the SQL check is unnecessary for this task and was not done.

### Verification and resume point

Existing real TTOO/FTCH/PLTR raw records in the authorized isolated DB at
`127.0.0.1:57322` were read through the official state reader and current ingest
adapter. All three now have verified source scope. TTOO remains confirmed /
suspended; FTCH remains intended removal pending / trading unresolved; PLTR
remains date/status unresolved for the source-based reasons above. Repeated
reads are equal. Original fixture/source hashes and all 11 checked table
counts/hashes remain unchanged. No new ingestion, LLM, Monitor or notification
execution was needed in this follow-up.

Source-integrity/collector/Form25/state/identity/review/cover regression suite:
**114 passed**. Full `tsc --noEmit --incremental false`: passed. Synthetic
negative tests separately cover absent/wrong header, accession/form/CIK/name
conflicts, mismatched primary class, missing labels and ambiguous checked rules.
No extra real filing or new schema was needed.

Evidence: `C:/Users/PC/.codex/visualizations/2026/09/30/form25-integrity-followup/`:
`cover-rest-investigation.json`, `*-cover-rest-input.json`,
`readback-result.json`, `*-source-reader.json`, `*-state-readback.json`,
`*-adapter-result.json`, `regression.log` and `typecheck.log`.

There is no remaining source-loss blocker for these three retained cases.
Unsupported HTML structures and absent effective-date evidence must remain
explicitly unresolved. Listing Risk/automatic Monitor integration, its existing
typed-contract/form eligibility, amendment lineage and user-facing behavior
remain a separate next step; this source check does not establish readiness of
an unimplemented Monitor route or complete current listing state.

## Original-source connection correction (2026-09-30)

This section supersedes the older source-selection description below; state
classification policy remains unchanged. The collector was already fetching the
canonical XML alongside the SEC XSL-rendered primary, but only retained stripped
attachment text. The reader searched `primary_document_html` for XML and could
therefore return `xml_scope_unavailable` despite successful collection.

Form 25/25-NSE (including amendments) now preserve each fetched document's
original response text in `raw_payload.form25_source`, with version, URL,
document type/description, primary flag, SHA-256, character count and truncation
flag. Existing Primary text fields and attachment projections are unchanged.
No table, migration, prompt, parser rules, or Monitor policy changed.

`readStoredForm25Source` selects a unique retained `notificationOfRemoval` XML
document and supplies it plus neutral notice text to the existing parser.
Original markup remains separately available in state-reader evidence. It
checks accession-scoped SEC URLs, hashes, lengths, primary consistency and
attachment completeness. Truncated, altered or ambiguous sources fail closed.
Previously stored primary XML remains readable through the legacy path. Legacy
records that already lost XML structure are **not** repaired by an ordinary
existing-row replay; collecting/restoring their original sources requires a
separately authorized source refresh. This change does not invent XML from HTML.

The existing automatic ingest adapter and selected-evidence reader now use this
shared source selector (versions `form25_delisting_ingest_v2` and
`sec_delisting_state_v2`). Original source storage is capped at 2,000,000
characters per document; any truncation is explicit and ineligible for state
confirmation. This is not an unlimited document archive.

### Real source / persistence verification

Fresh SEC retrieval, `runSecRawIngest`, raw persistence, the existing automatic
adapter and official `readStoredDelistingState` ran against the existing
authorized isolated DB at `127.0.0.1:57322` (system identifier
`7689949482832261158`). Main/shared-local were not targets.

| Filing | Direct read-back | Existing state result as of 2026-09-30 |
| --- | --- | --- |
| TTOO 25-NSE/A, `0001354457-25-000637` | Issuer 1492674; Common Stock; Nasdaq; rule 12d2-2(b); filed 2025-07-10; removal 2025-07-21; suspension 2025-02-12 | Confirmed exchange delisting / suspended. Before removal date: pending. |
| FTCH 25-NSE, `0000876661-23-001010` | Issuer 1740915; Class A ordinary shares; NYSE; rule 12d2-2(b); filed 2023-12-20; intended removal 2024-01-02 | Removal pending / trading unresolved. Intention is not completion. |
| PLTR 25, `0001321655-24-000231` | Original HTML/submission text retained; issuer 1321655; Class A common stock; rule 12d2-2(c); filed 2024-11-25 | Unresolved. Existing parser does not extract the combined issuer/exchange HTML label; XML-only scope remains unavailable. |

Each accession has one raw row after rerunning. Source content, hashes and
reader facts remained equal; execution history gets a new source-run record.
Existing cover-observation sidecar execution metadata changes on replay. Its
TTOO/FTCH `persistence_failed` and PLTR zero-observation result are recorded as a
separate limitation, not repaired or counted as successful cover persistence.
Primary/event/AI/Monitor/Alert, Section 16 and SC13 table counts/hashes and related
DB function definitions were unchanged. No LLM or notification call ran.

Evidence: `C:/Users/PC/.codex/visualizations/2026/09/30/form25-source-reader/`.
`final-e2e-check.json` summarizes the DB checks; `validated-*-stored-raw.json`,
`validated-*-source-readback.json`, `validated-*-state-readback.json` and
`validated-*-source-run.json` retain complete results. The initial harness
timestamp-serialization and cover-execution-metadata comparison failures remain
preserved; subsequent comparisons distinguish those from source/fact changes.

Public SEC response fixtures, URLs/hashes and pre-call expectations live under
`lib/sources/sec/forms/form25/fixtures/source-connection/`. Focused regressions
cover original-source acquisition, read-back, wrong accession, hash tampering,
truncation, missing originals, duplicate XML, withdrawal and conflicting dates.
Combined collector/Form25/state/identity/review regressions: **102 passed**;
`tsc --noEmit --incremental false`: passed. Node tests use the repository's
`scripts/resolve-server-only.mjs` and `scripts/resolve-ts-paths.mjs` loaders.

This validates source-to-reader connection, not a new Listing Risk/Monitor route,
HTML-only identity support, amendment lineage resolution or user-screen E2E.

## Form 25 ingest connection (2026-09-14)

The reader and its phase-1 rules below remain unchanged. `runSecRawIngest` now
invokes `runForm25DelistingAutomaticTrigger` after a new raw save and on an
existing-raw replay for the existing Form 25 supported-form list. The adapter
loads the exact stored raw ID/accession, uses the existing Form 25 parser's XML
issuer/security/exchange fields to prepare the scope, and calls the existing
reader with that single raw ID and the ingest run's UTC as-of date. Exchange
filer CIK and ticker/catalog metadata cannot substitute for XML issuer identity.

The outcome is recorded in existing `source_runs.metadata.form25_delisting`
and returned in the ingest item's `form25_delisting` field. This is a per-run
evidence evaluation record, not a current security-state table. It retains
scope, selected raw/event IDs, accession, as-of, states, reasons, parser/reader
versions and source URLs/hashes; original document bodies and AI payloads are
not copied into run metadata. Raw metadata and site analysis remain untouched.
No migration is needed. Replays make another execution record but do not create
duplicate delisting-state rows or rewrite prior failure records.

Reader/query exceptions are recorded as `failed`; missing XML scope is
`unavailable`. A successful reader's unresolved or pending evidence is preserved
as its result, not treated as an ingest failure. Failed evaluations do not change
raw ingest success or invoke site analysis, and an ordinary source replay retries
them. The existing source-run terminal writer persists outcomes; if that writer
itself fails, its existing error behavior is retained and durable recording is
not claimed. There is no new retry worker, scheduled as-of refresh, combined
all-filings state, UI, Alert, Watchlist, administrator, or catalog integration.

Official TTOO/FTCH source bytes were replayed through the product raw-ingest,
raw-store, existing parser/reader and source-run terminal persistence in the
dedicated `127.0.0.1:59822` database. TTOO remained confirmed/suspended; FTCH
remained removal-pending/trading-unresolved. Repeated and simultaneous replay
kept one raw row per accession. Injected event-query failure and helper exception
were recorded separately while the run stayed completed; replay recovered and
the prior failure record remained. Raw/source strings and pre-existing partial
archival analysis stayed unchanged. The transaction was rolled back, pre/post
counts matched, and external HTTP/LLM/notification calls were zero. These checks
do not constitute a new site-analysis execution or user-screen E2E.

## Scope and states

`readStoredDelistingState` requires explicit stored raw-item IDs (maximum 100),
issuer CIK, exact declared security title, exact exchange name, and an as-of
date. Its coverage is **selected stored filing evidence only**, not all stored
filings, all SEC history, or a complete present-day exchange/trading status.
The caller must not describe `removal_pending` as proof that a years-old case is
still pending today. It means the selected sources do not confirm completion.

- Listing: `confirmed_exchange_delisting`, `removal_pending`, or `unresolved`.
- Trading: `suspended`, `suspension_scheduled`, or `unresolved`, independently.
- Catalog flag: `inactive_only`, `active_flag_only`, or `unavailable`. Neither
  flag establishes listing status. Missing sources or read errors are unresolved.

Confirmed removal means the stated security was removed from the stated
exchange under the selected source evidence effective as of the requested date.
It does not mean all trading stopped, OTC trading ended, SEC registration ended,
or the issuer disappeared. Filing/signature/index-effectiveness dates and
filing-plus-10/90-day arithmetic cannot establish this state.

## Reused sources and fail-closed boundaries

The existing Form 25 parser reads preserved `primary_document_html` XML and
stored official attachments. A separate invocation of that same parser obtains
issuer, exchange and security from XML without accepting catalog/filer metadata
as issuer identity. No parser or site-analysis contract is changed. Optional
existing event `display_payload` fields are checked for contradictions; missing
fields are never reconstructed and free-text AI summaries do not establish state.

The existing cover parser supplies filing/security identity for 8-K/6-K only;
their states come from `readCurrentListingRiskFacts`, including its current
execution/parent lineage checks. A source-stated, exact, `occurred` removal date
with matching SEC accession/evidence can confirm removal. Conditional facts
cannot. This does not run or extend an analyzer. Missing/unverified cover
identity (including unsupported 6-Ks) or missing current typed facts remains
unresolved. Non-SEC Listing Risk source families are outside phase 1.

Common stock, warrants, preferred/debt and different classes are not merged.
Exact exchange names are intentionally not normalized by substring: NYSE Arca
is not NYSE. Multiple identities, source/analysis conflicts, truncated documents,
failed document fetches, withdrawal/stay language, and conflicting notice dates
fail closed. The reader does not choose a convenient older record when selected
evidence disagrees. Amendments and reinstatements are not independently resolved.

Each result retains raw/event IDs, accession, issuer versus filer, source URLs,
original stored document strings and their UTF-8 SHA-256, parser fields/evidence,
optional stored analysis and official typed-reader result. A stored extracted
attachment string's hash identifies that stored string; it must not be advertised
as a byte-identical HTTP artifact unless separately compared with the original.
Repeated/concurrent reads do not create or overwrite state.

## Verification (2026-09-14)

Official TTOO `25-NSE/A` accession `0001354457-25-000637` XML identifies issuer
1492674, Common Stock, Nasdaq Stock Market LLC; exchange filer is 1354457.
The official notice establishes removal effective July 21, 2025 and suspension
February 12, 2025. Original documents, unchanged existing parser output, isolated
stored raw/event records, and the reader agree: confirmed exchange delisting and
suspension. Before July 21 the listing result remains pending.

Official FTCH `25-NSE` accession `0000876661-23-001010` identifies issuer 1740915,
Class A ordinary shares, NEW YORK STOCK EXCHANGE LLC; exchange filer is 876661.
The notice reports an intention to remove January 2, 2024. The reader preserves
that date but does not turn source intention into completion confirmation. The
source also describes immediate suspension; the existing parser does not extract
that suspension date, so the trading result remains unresolved. No parser fix or
AI replacement was made. An archived analysis rendering has a filer-CIK defect;
it remains untouched and is not used to replace XML issuer/filer identity.

Two actual cases used the existing dedicated isolated DB `127.0.0.1:59822` in a
transaction. Replay, concurrent reads, wrong-security rejection and unchanged
raw rows passed. Test raw/event records were rolled back and pre/post table
counts matched. There were no external HTTP/LLM/notification calls during E2E.
Previously saved analysis renderings were reused only as explicitly partial
archival metadata; no new AI analysis was called or fabricated.

The 8-K current typed-fact positive case, source conflicts, inactive/missing data,
different classes, and date/withdrawal boundaries are synthetic regressions,
separate from the two real Form 25 cases. No real 8-K/6-K typed state E2E or user
screen E2E is claimed. UI, Alerts, Watchlist handling and lifecycle automation are
deliberately deferred.
