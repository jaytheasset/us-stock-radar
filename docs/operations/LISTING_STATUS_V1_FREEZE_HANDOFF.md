# Listing Status v1 — frozen local-main handoff

Frozen on 2026-10-01 against product commit
`c506647f8f01aa0e3f5c41016c0b82b108299e65`. This is the current implementation
summary; dated candidate experiments in the linked documents remain historical
evidence, not a backlog to repeat. Reopen v1 only for a concrete future product
requirement or demonstrated defect. Do not restart prompt tuning, broad identity
work, collection or UI expansion merely to improve sample coverage.

## Purpose and separate responsibilities

Maintain source-backed observations and reconstruct the safest supported state
for one exact security/exchange as of a requested date. This is neither a live
exchange directory nor a guarantee of complete SEC history.

| Layer | Current responsibility / entry point |
| --- | --- |
| Source/event facts | Retained SEC XML/HTML, attachments, accession, hashes, original filing/event/operative dates. `lib/sources/sec/forms/form25/storedSource.ts`, `lib/sec-delisting-state/state.ts`. |
| Listing Risk / Monitor | Existing secondary execution, typed facts, official reader, user conditions, activation and alert dedupe. `lib/monitor/genericMonitorChildRuntime.ts`, `form25ListingRuntime.ts`, `listingRiskPersistence.ts`. Monitor results and Primary prose are not canonical status. |
| Canonical history | Append-only `sec_listing_status_observations`; `lib/sec-listing-status/persistence.ts`: `persistSecListingObservation`, `readSecListingHistory`, `readSecListingStatusAsOf`. Projection is computed on read, not a mutable current-status row. |
| Human review | Separate append-only `sec_listing_status_date_reviews`; `lib/sec-listing-status/review.ts`, `readReviewedSecListingObservation`. Does not rewrite source, AI or automatic observations. |
| Stock page | `lib/watchlist/stockListingStatusServer.ts` shared adapter; `StockListingStatus.tsx` under the stock header. Presentation is a filter over canonical results, not another state evaluator. |
| JSON | `GET /api/stocks/[ticker]/listing-status` uses the same adapter without the UI visibility filter. |

## Automatic source paths

- **Form 25 / 25-NSE and amendments:** `lib/secIngest.ts` invokes
  `persistForm25ListingStatusAutomatically` in
  `lib/sec-listing-status/automaticPersistence.ts` after the raw/source sidecars.
  The preserved original source feeds the existing deterministic state reader
  and canonical writer. It does not require a Primary/LLM result. The separate
  Form 25 → existing Listing Risk child path remains integrated; neither path
  changes activation rules or forces an alert.
- **Supported 8-K / 6-K:** after successful Listing Risk persistence,
  `genericMonitorChildRuntime.ts` calls
  `lib/sec-listing-status/listingRiskAutomaticPersistence.ts`. It reads the exact
  current raw/event/parent/child lineage through `readCurrentListingRiskFacts`.
  Canonical writer authorization uses that official RPC, not direct SELECT on
  the private facts table. Completed-child replay can retry the idempotent
  sidecar without another analysis. Sidecar failures are reported separately.
- Source-supported removal decisions and suspension facts can be retained.
  Withdrawal of a removal decision and confirmed trading resumption require
  the existing `sourceEvent.ts` evidence contract and a uniquely linked earlier
  event. Only that security/exchange/issue is closed. Appeals, compliance-only
  notices and scheduled/expected resumption do not establish restoration.

Listing states: `unresolved`, `removal_pending`,
`confirmed_exchange_delisting`, `removal_decision_withdrawn`.
Trading states: `unresolved`, `suspension_scheduled`, `suspended`, `resumed`.
No global ACTIVE or relisting state is inferred. Transfer evidence is not a
license to merge old-exchange removal with new-exchange trading.

## Identity, dates and provenance safety

- Exact issuer + security/class + ticker + exchange evidence is required.
  `identity.ts`, `coverAttachment.ts` and the existing SEC ticker-resolution
  readers validate attachment. One justified row may be selected from a
  multi-security cover; sibling securities are retained. Never choose the first
  row or match by CIK/company name alone.
- Stable security proof and actual ticker-change continuity remain distinct.
  Changes still require validated change evidence. Insufficient identity may
  retain an observation but cannot project it onto a canonical security.
- As-of is limited to filings/evidence available by that date, not the DB's
  historical ingestion time. Filing date is never substituted for an operative
  date. Pending stays pending; unsupported exact dates remain null/unresolved.
- `effectiveDate.ts` checks source support for exact operative dates. Scorpius's
  June 14 notice did not prove a June 14 suspension effective date; the original
  model date remains in its own history, not promoted into canonical state.
- Immutable cited document identity/bytes/hashes matter; a mutable raw envelope
  refresh alone is not a changed SEC fact. Changed/forged evidence remains invalid.
  `provenance.ts` and the history reader preserve stale rows and exclusion reasons.
  Only the existing validated revalidation/replacement rules can exclude them
  from projection; they cannot erase a separate still-open issue.
- Identical writes replay existing IDs. Reads do not create observations/reviews.
  Bounded/incomplete reads fail closed, not as evidence that nothing exists.

## Human date review and product surfaces

Admin UI: `/admin/data/listing-status?observationId=<id>`.
API: `/api/admin/data/listing-status/[observationId]`.
The existing admin checks use `system.read` for viewing, `data.run` for mutations,
same-origin/session checks, revisions, source versions and request replay guards.
Only `notice_date` and `suspension_effective_date` are reviewable, each an exact
date or explicit unknown/null with retained quote/document hash and actor/reason.
Corrections or withdrawal append decisions; no silent overwrites. Invalid/stale
review evidence is not usable. Human review cannot establish security identity.

The reviewed reader returns automatic and human facts/history separately.
The as-of status projector and Monitor do not silently substitute human dates.
The public adapter exposes valid reviewed dates separately from automatic dates;
it does not expose reviewer identities, internal audit bodies or raw model output.

**Current UI policy:** show a compact Listing Risk panel only for an available,
exact-attached canonical result with pending removal, confirmed delisting,
scheduled suspension or suspended trading. Either axis can keep the card visible
despite the other resolving. No observations, unresolved-only results, reader
errors or resolved-only withdrawal/resumption do not produce a current warning.
Hidden does not mean ACTIVE. Historical resolved facts remain in JSON/history.

JSON is `{ ok, data }`: ticker, query `asOf`, stored-SEC-only coverage,
availability/reason, verified security/class/exchange, separate listing/trading
states and supported dates, SEC form/accession/URL/filing-date references and
separate reviewed dates. Unknown is HTTP 200; reader failure is 503; invalid ticker
is 400; responses are `no-store`. There is no bulk API or public as-of parameter.

Header identity is separate: latest appropriate submissions remain preferred.
`stockHeaderSecIdentity.ts` can fall back to `stockHeaderCanonicalExchange.ts`
only after a unique current SEC catalog ticker/issuer match and stable canonical
cover revalidation through today. It never copies exchange from status history.
Ambiguity, stale proof and changed-symbol fallback remain unavailable.

## Preserved verification and intentional limitations

- Main PLTR/TTOO raw records lack usable structural scope: unresolved observations,
  no invented canonical security, no current risk card or guessed exchange.
- Main SCPX uses four explicitly test-scoped retained original SEC filings,
  parsed cover evidence, one stable common-stock/NYSE American identity and two
  linked observations written through existing writers. Removal pending → removal
  decision withdrawn; July 29, 2024 withdrawal notice; trading remains unresolved.
  No current warning. Its current SEC ticker-catalog query returned no exact SCPX
  entry, so the header remains Exchange unavailable despite historical proof.
- This main preparation was not a fresh provider/product E2E. Candidate live
  execution, candidate human review and main retained-source readback are distinct
  evidence sets. Candidate Scorpius review recorded notice June 14 / suspension
  effective unknown; main display checks did not create a new human decision.
- The main integration suite recorded **659/660** passing. The unrelated
  `lib/monitor/monitorPresets.test.ts:193` expected create payload omits
  `monitor_kind: condition_set` and `form4_purchase_settings: null` now included
  by the existing implementation. The same failure was reproduced read-only at
  pre-merge `1a4ad0ac`; it was not fixed/relaxed. This is not a Listing Status
  regression. This handoff does not claim a fresh reproduction.
- Latest presentation verification: **126/126** focused regressions, full
  TypeScript and diff check passed; desktop/768px/390px rendering checked.
  Positive new header fallback/open-risk combinations were regression-tested;
  no new real current-exchange or open-risk browser fixture was created.
- Full-market coverage, broad identity/security-class support, automatic source
  scheduling, public historical-query/bulk APIs, additional review fields and
  complete exchange lifecycle remain deferred. Source-ingest automatic crons
  remain disabled in `lib/sourceWorkflowConfig.ts`. No inference from silence.
  No new provider call, external alert delivery or production deployment is
  certified by these checks. Old resolved Dilution type errors are not current
  Listing Status blockers; latest full typecheck passed.

Existing evidence directories outside Git, under
`C:/Users/PC/.codex/visualizations/2026/10/01/`:
`listing-status-main-integration/` (including baseline failure comparison),
`listing-status-live-attachment/`, `listing-status-provenance/`,
`listing-status-human-review/`, `stock-listing-status-surface/`,
`stock-listing-risk-presentation/`. Preserve them; do not rerun jobs merely to
recreate this handoff.

## Commits, migrations and resume map

| Commit | Role |
| --- | --- |
| `1a4ad0aceffc3039c33eccdb532cc6de186381c4` | SEC stock-header identity preserved before integration |
| `e17a4db8679e9a7082ce420be6744d9c1c365774` | Frozen backend candidate, including amendment `filing_date` / legacy `filed_date` contract fix |
| `c048ab4053eda2196a524ba045e5944c58a8fe5d` | Normal non-fast-forward main merge of the complete candidate history |
| `a3bd03d4ee7116f78ab718a163a3499e07c92d99` | Shared public adapter, stock page and JSON |
| `c506647f8f01aa0e3f5c41016c0b82b108299e65` | Open-risk-only presentation and safe header fallback |

Candidate migrations integrated in repository order (under `supabase/migrations`):

1. `20260930163226_form25_listing_monitor_connection.sql`
2. `20260930182700_sec_listing_status_observations.sql`
3. `20260930191430_sec_stable_security_attachment.sql`
4. `20260930195938_sec_listing_status_follow_up.sql`
5. `20260930210543_sec_listing_exact_cover_attachment.sql`
6. `20260930221106_sec_listing_validated_persistence_boundary.sql`
7. `20260930225206_sec_listing_status_date_review.sql`
8. `20260930230812_sec_listing_date_review_immutable_read.sql`
9. `20261001002420_sec_listing_typed_cover_attachment.sql`
10. `20261001012244_sec_amendment_filing_date_contract.sql`

The integration evidence records these applied to verified local main PostgreSQL
127.0.0.1:56322, system ID 7678429483712069671: 114 → 124 matching migration
versions, no repair/reset. This documentation task did not query or modify DB
state. Do not reapply or extrapolate that observation to production.

Detailed references: [history](../architecture/sec-listing-status-history-v1.md),
[date review](../architecture/sec-listing-status-date-review-v1.md),
[provenance](../architecture/sec-listing-status-provenance-revalidation.md),
[live attachment](../architecture/sec-listing-status-live-attachment.md),
[Form 25](../architecture/sec-delisting-state-v1.md),
[public surfaces](../architecture/stock-listing-status-surface.md).
Their older candidate-only limitations/application statements are dated records;
the main integration and product behavior above supersede them for current scope.

## Next secondary Monitor family — selection, not authorization to implement

The existing [main handoff](ASTRA_6_MAIN_HANDOFF.md#8-historical-priorities--2026-09-10-verified-scope-updates--2026-09-14)
lists **NT 10-K / NT 10-Q / NT 20-F** immediately after Form 25/25-NSE, then
S-8, Proxy, Merger and Tender. With Form 25/Listing Status frozen and the user's
explicit CUSIP/13F freeze at `0b75ffcf573b64fcf030fde432d594bfa9f487ae`, NT is the
next documented family to resume with a read-only source-to-reader/Monitor audit.
Do not start implementation or assume its existing Primary support is a completed
secondary Monitor. Preserve Form 3/5 DB/history scope and all completed families.

Ambiguity: the roadmap explicitly calls its priorities historical, not a binding
current queue. No newer definitive family order was found in the repository.
NT is therefore the plan-supported next candidate, not a newly approved task.
The older Priority 5 13F entry does not override the later explicit freeze.

## Required environment handoff checklist

- Permanent root: `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch main;
  no branch switching here. 3110 is the persistent main review server.
- Local product HEAD: `c506647f8f01aa0e3f5c41016c0b82b108299e65`; the subsequent
  documentation-only commit containing this file is the handoff commit (see Git).
  Clean on task entry; only these requested documentation changes are committed.
- GitHub main: cached origin/main `9c13aee7ef41b38bac0637e53e579633745effda`,
  read locally, not freshly fetched. Live GitHub HEAD unverified.
- Deployed Vercel commit/status and remote DB migrations: unverified. No
  local/GitHub/deployed equality or publication claim. Push/deploy unauthorized.
- All Listing Status product work named above is in main. Other worktrees,
  unrelated unmerged work and their runtime status were not re-audited or changed.
- No DB/env/credential/service/cron change, new test data, server restart or
  external notification in this task. Existing review data/evidence remain.
- Validation this task: documentation links/paths, commit/migration references
  and diff scope/whitespace only. Runtime/typecheck results above are reused,
  not rerun. Recheck actual state before any later authorized implementation.

Follow [Production Source of Truth](PRODUCTION_SOURCE_OF_TRUTH.md) for any later
integration/publication; this freeze is not operational-service completion.
