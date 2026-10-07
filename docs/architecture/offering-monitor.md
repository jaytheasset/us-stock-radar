# Offering Monitor V1 Architecture

> **Authority.** This is the authoritative Offering Monitor architecture reference. Audit code, migrations, and tests when they disagree; update this document with approved architectural changes.

## Current product paths

Primary, Registry facts, and the O/S child have separate responsibilities:

1. Form-specific Primary analysis and optional bounded Repair publish the analysis and existing score alert. Primary `offering_monitor_payload` compatibility is unchanged.
2. Dilution Registry JSON Preview/Apply and exact SEC Offering event persistence invoke the existing Registry-backed Offering trigger. `readRegistryBackedOfferingFacts()` supplies facts to the pure Matcher and internal Alert consumer.
3. Eligible completed Primary runs enqueue the durable `offering-monitor-normalization` Workflow. It runs the deterministic O/S sidecar and records terminal job state.

The Gemini Stage 2 provider executor, inline prompt/schema, input packaging, orchestration, application promotion writer, and legacy event Matcher wrapper have been removed. Historical candidate contracts and canonical readback remain isolated from current execution modules. No new fact mappings are introduced.

## Primary analysis and compatibility

Primary Analysis plus its optional validation Repair is one stage. Repair is not an Offering Monitor stage. The form-specific Primary flow owns whole-filing interpretation, event classification, title, summary and quick take, score, signal, user-facing analysis, display payload, and normal analysis persistence.

The Repair call is validator-triggered, restricted to selected source blocks and enumerated patch paths, and run with `maxAttempts: 1` and fallback disabled. The S-1, S-3, and 424B repair planners and patch appliers remain form-specific.

`runSecFilingAnalysisIngest()` persists the event and Primary AI trace, then runs
the existing score-based alert delivery, and only then returns `primaryAiRunId`.
The source-ingest workflow and analyze route enqueue Offering processing after
that completed result. Enqueue starts a durable child and does not await the
child result. Sidecar execution therefore never delays Stage 1 publication or
the existing score alert, and its result does not rewrite or roll back the
event, Primary analysis, score, signal, or alert.

The compact nested-string `offering_monitor_payload` contract in `minimalOfferingMonitor.ts` remains for S-1, S-3, and 424B Primary compatibility. F-1 and F-3 retain their legacy Primary schemas without this payload. Adapters validate the payload and remove the raw string; existing event persistence may retain its materialized form in display metadata. It is not Registry Matcher authority.

`minimalOfferingMonitor.ts` also provides the JSON parser used by S-8, Tender, Ownership, and Corporate Action code. Those consumers and shared helpers are preserved. Parser/source preparation supplies evidence and structure; it does not determine financing semantics from form names, security names, or fixture accessions.

## Registry JSON, Reader, Matcher, and internal Alert

Registry JSON Preview/Apply retains its current validation, identity, and write contract. `consumeOfferingMonitorAlertsForEvent()` reads exact-event Registry facts and active stored conditions, calls `evaluateOfferingMonitorConditions()`, and creates internal Alerts only for eligible matches. Registry Apply and SEC Offering event persistence retain their existing automatic trigger.

The reader joins exact event/raw-item/issuer/accession identity to `dilution_instrument_snapshots` and `dilution_instruments`. It does not substitute issuer-wide totals or historical Stage 2 rows. Current ATM and non-ATM snapshots remain semantically unmappable: all five facts are unavailable, total is unavailable, and side is unknown. ATM capacity is not an executed offering amount. This cleanup does not turn those states into matches.

`conditionRegistry.ts` source metadata names the actual TypeScript reader `readRegistryBackedOfferingFacts` and the snapshot authority `dilution_instrument_snapshots`. Its `jsonPath` addresses the reader's `canonical` or `materialized` projection. There is no fictional stored canonical column or new SQL reader. Alert consumption uses this reader directly; the pure Matcher uses Registry keys/operators and explicit unit, quality, currency, and basis guards. Saved condition key/operator/value contracts are unchanged.

| Condition key | Type | Operators | Canonical source |
| --- | --- | --- | --- |
| `offering.side` | enum text | `eq`, `in` | `primary_or_resale` |
| `offering.amount` | number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte` | `facts.actual_primary_offering_amount` |
| `offering.offering_price` | number | numeric operators | `facts.offering_price` |
| `offering.immediate_primary_share_exposure` | number | numeric operators | `facts.immediate_primary_share_exposure` |
| `offering.additional_potential_primary_share_exposure` | number | numeric operators | `facts.additional_potential_primary_share_exposure` |
| `offering.resale_share_exposure` | number | numeric operators | `facts.resale_share_exposure` |
| `offering.total_potential_share_exposure` | number | numeric operators | materialized `total_potential_primary_share_exposure` |

For side, valid values are `primary`, `resale`, and `mixed`; unknown side is ineligible. Numeric facts require availability, a finite non-negative number, expected unit, expected comparison basis, and `exact`, `derived`, or `estimated` quality. `unknown` quality is stored but ineligible. Amount and price conditions must specify compatible currency; share conditions reject a currency argument. A requested comparison basis, when present, must match the fact. Null or unavailable is never coerced to zero.

Facts missing/not-ready, reader failure, not-applicable canonical state, unsupported keys/operators, invalid values, incompatible currency/basis, and empty condition sets all fail closed as `ineligible`.

Conditions use AND aggregation:

1. Any definite `no_match` makes the set `no_match`, even if another condition is ineligible.
2. With no `no_match`, any `ineligible` makes the set `ineligible`.
3. Only all matching conditions produce `match`.

Percentage conditions such as dilution percent and float overhang percent are intentionally absent. Materialization contains derived metric slots, but V1 Registry exposes no percentage keys. Without a reliable denominator, as-of time, currency/unit, and comparison-basis contract, the Matcher must not invent percentages.


## Durable O/S child and execution identity

`workflows/source-ingest.ts` and the SEC analyze route enqueue the existing durable child. `workflows/offering-monitor-normalization.ts` runs only `processOfferingShareCountSidecar()` and sidecar-only finalization. The sidecar reads the complete exact stored primary SEC document and may append one source-stated O/S observation. It makes no provider call and never fabricates a count.

Eligible and safely ineligible results finish `completed`; sidecar exceptions finish `failed`; stale exact-Primary lineage finishes `stale`. The sidecar step has zero automatic retries. Terminal metadata records zero Stage 2 provider attempts and disabled legacy wiring. Job identity, enqueue, parent authority, Registry retry state, and terminal handling remain unchanged.

Logical work is scoped to the exact `(event_id, raw_item_id, parent_primary_ai_run_id)` tuple. Execution identity adds contract and attempt key; the current automatic contract remains `offering_sidecar_only_v1`. Latest Primary lookup is a stale guard, never a substitute parent. Historical executions keep their original identifiers and versions.

## Supported automatic enqueue and sidecar families

Automatic child eligibility requires a completed Primary result, an exact
supported prompt key, a supported form, and an exact persisted
`primaryAiRunId`.

| Job family | Eligible forms in the identity guard | Required Primary prompt key | Primary preparation boundary |
| --- | --- | --- | --- |
| `s1` | `S-1`, `S-1/A` | `sec_s1_f1_analysis` | `secS1F1AnalysisAdapter.ts` and `s1-f1/sourceInput.ts` |
| `s3` | `S-3`, `S-3/A`, `S-3ASR`, `S-3MEF`, `F-3`, `F-3/A`, `F-3ASR`, `F-3MEF` | `sec_s3_offering_analysis` | `secS3AnalysisAdapter.ts` and `prompts/secS3OfferingAnalysis.ts` |
| `424b` | `424B` plus numeric 424B variants, with optional `/A`, when produced by `sec_424b_analysis` | `sec_424b_analysis` | `sec424bAnalysisAdapter.ts` and `forms/424b/analysisPrompt.ts` |

The SEC room registry explicitly enumerates `424B`, `424B1`, `424B2`, `424B3`, `424B4`, `424B5`, `424B7`, and `424B8`; the Monitor identity guard uses `^424B\d*(?:/A)?$` together with the exact prompt key.

`F-1`, `F-1/A`, `S-1MEF`, `F-1MEF`, and `POS AM` share the broader S-1/F-1 Primary room but are not automatic `s1` child eligibility. `S-4`/`F-4`, `S-8`, 8-K/6-K financing analysis, and other forms are also excluded. The tests explicitly reject F-1, S-4, 8-K, near-match `S-3D`/`F-3D`, wrong-prompt, dry-run, and failed Primary results.

The common job identity does not merge the Primary paths. Each family keeps its
own source preparation, prompt, validation, repair, and display semantics. F-3
continues to use the S-3/F-3 Primary path and remains eligible for the
deterministic sidecar.

The detailed deterministic extraction boundary is in [Level 2 Share Count Observation V1](level2-share-count-observation.md).

## Historical Stage 2 inspection only

`offeringMonitorHistoricalContract.ts` preserves the historical candidate type, input-stat shape, prompt identifiers, output type `offering_monitor_normalization_candidate`, prompt version `second_stage_direct_v8`, and schema `offering_monitor_second_stage_candidate_v2`. `validateOfferingMonitorHistoricalCandidate()` retains the former candidate validation meaning and error strings: successful validation, strict canonical shape, selected-source membership, and stored-materialization equality. It neither repairs stored evidence nor writes it.

`offeringMonitorCanonicalPersistence.ts` now contains only `readOfferingMonitorCanonical()`, `validateOfferingMonitorCanonicalReadResult()`, read types, and required helpers. The RPC remains `read_event_offering_monitor_canonical`. It returns available only under the existing lineage/staleness contract; invalid identities, payloads, or stored-total mismatch fail closed. Readback does not recompute the total or fall back to Primary, parser, display metadata, or latest AI output.

The table `event_offering_monitor_canonical`, applied migrations, SQL promotion/read functions, historical rows, SEC originals, frozen experiment evidence, provider records, and hashes are retained. Removal of the application writer does not delete the SQL promotion function. Historical `ai_runs`/`ai_outputs` remain audit evidence, not current Offering product authority.

### Preserved historical fact contract

Historical candidates contain root semantic fields, five numeric facts, and a stored materialized total. The shared contract in `minimalOfferingMonitor.ts` is unchanged.

| Fact | Canonical key | Required unit | Required `comparison_basis_type` | Currency |
| --- | --- | --- | --- | --- |
| Financing amount | `actual_primary_offering_amount` | `currency` | `market_cap` | required when available |
| Offering price | `offering_price` | `currency_per_security` | `market_price` | required when available |
| Immediate primary exposure | `immediate_primary_share_exposure` | `shares` | `shares_outstanding` | `null` |
| Additional potential primary exposure | `additional_potential_primary_share_exposure` | `shares` | `shares_outstanding` | `null` |
| Resale exposure | `resale_share_exposure` | `shares` | `public_float` | `null` |
| Deterministic total | `total_potential_primary_share_exposure` | inherited `shares` | inherited `shares_outstanding` | `null` |

Every canonical numeric fact has exactly these fields:

| Field | Contract |
| --- | --- |
| `value` | non-negative finite number when available; `null` when unavailable |
| `availability` | `available` or `unavailable` |
| `value_quality` | `exact`, `derived`, `estimated`, or `unknown` |
| `bound` | `exact`, `maximum`, `minimum`, or `unknown` |
| `unit` | `currency`, `currency_per_security`, `shares`, `other`, or `unknown` |
| `currency` | non-empty for available currency facts; otherwise nullable |
| `security_basis` | non-empty for every available fact; nullable when unavailable |
| `comparison_basis_type` | `shares_outstanding`, `public_float`, `market_cap`, `market_price`, `none`, or `unknown` |
| `comparable_to_event_market_basis` | `true`, `false`, or `null`; separate from fact availability |
| `source_ref` | compact stable allowed SEC source identifier when available; `null` when unavailable |

`applicability` is `applicable` or source-backed `not_applicable`. Root `financing_stage`, `primary_or_resale`, `security_nature`, and the nullable warrant/convertible flags remain part of canonical state. Failure is never converted into `not_applicable`.

#### Immediate, additional, and comparison compatibility

Immediate exposure is the distinct, deduplicated primary share-equivalent pool available from the current transaction. Additional exposure is only a distinct conditional or potential primary pool not already included in immediate; it is not a total.

Equal counts do not prove duplicate exposure. The Matcher fixture models IPDN with immediate `15,713,387` common shares and additional `15,713,387` common-warrant shares, producing total `31,426,774`. This is an example of the contract, not a sample-specific rule.

`security_basis` identifies the security or right that produces a fact. Immediate and additional may legitimately have different values. `comparison_basis_type` identifies the measurement basis that allows validation and addition. Validation requires compatible unit, currency, and comparison basis, not literal `security_basis` equality. Parser or code must not infer addition from security names.

#### Deterministic total and numeric safety

The retired provider did not return total potential exposure. `materializeMinimalOfferingMonitor()` calculates immediate plus additional once when both facts are eligible and their unit, currency, and comparison basis are compatible. It combines quality and bound conservatively and preserves both source/security identifiers. The historical candidate validator re-materializes the five facts only to check equality with the stored candidate; it does not repair or persist values. The Matcher reads the materialized total and never recalculates it.

The retired provider prompt and its 128-character numeric-literal guard are no longer executable. The shared Primary JSON parser and strict fact validators remain unchanged, including duplicate-key and invalid-number rejection. Historical validation does not repair a stored value.

#### Historical fact validity and provenance

Fact validity and exact citation quality are distinct. Historical candidate validation requires a valid value/quality/bound contract and selected-source membership. It does not verify that the chosen source is the best semantic citation, and it does not make historical rows current Registry Matcher inputs.

`source_ref` is retained for execution diagnostics, traceability, and evidence linkage. Current UI code does not render canonical `source_ref` or label it as a verified exact citation. A future UI must not make that claim without a separate exact-citation validation contract.

### Historical SQL acceptance (not rerun by this cleanup)

The migration serializes replacement through `FOR UPDATE` locks on the event, source execution, and existing canonical row. SQL tests verify saved promotion, same-execution idempotency, stale old execution rejection after a newer Primary, old-canonical reader invalidation, and successful replacement by the newer execution. These establish the intended atomic and stale-safe database boundary.

Real multi-session concurrency acceptance validation is completed. The Phase 5O disposable acceptance run used independent Postgres sessions and passed Race A, Race B, Race C, and Race D. It verified stale-write protection, same-execution idempotency, and that an older execution cannot overwrite newer canonical state. Real lock waits were observed; there were no deadlocks or timeouts.

The independent-session concurrency harness was intentionally disposable, removed after acceptance, and is not preserved in current `main` as a tracked, permanent, re-runnable regression test. Keep these two facts separate:

```text
Real multi-session concurrency acceptance validation: completed.

Permanent repository-tracked, re-runnable multi-session concurrency
regression harness: not currently preserved.
```

The tracked pgTAP suite continues to cover the sequential stale/idempotency contract. Absence of the disposable harness from the repository is not evidence that the completed multi-session acceptance did not occur.

### Security boundary

`event_offering_monitor_canonical` has RLS enabled and direct table privileges revoked from `public`, `anon`, `authenticated`, and `service_role`. Both canonical functions are `SECURITY DEFINER` with fixed empty `search_path`. Direct execute is revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execute permission for promotion and reading. Historical application reads use the reader RPC. The application promotion writer has been removed; the SQL functions and grants are preserved.

## Display and history boundaries

`event_offering_terms` remains a Primary/display projection for filing/event pages. It may retain transitional one-pass Monitor metadata. Neither it nor historical `ai_outputs` supplies current Offering Matcher truth. The current consumer has no import path to the historical reader or candidate validator.

## Regression checks and limits

- `verify:offering-os-sidecar`: deterministic O/S extraction and sidecar-only job/Workflow protection.
- `verify:minimal-offering-monitor`: Primary compatibility, shared helpers, and exposure validation.
- `verify:offering-matcher`: pure evaluation and transitive dependency checks preventing legacy reconnection.
- `verify:offering-history`: historical candidate and canonical readback validation with mock RPCs, plus read-only SQL source assertions.
- `verify:registry-backed-offering-adapter`: Registry Reader, Matcher, internal Alert, trigger, and site-analysis isolation.
- `verify:async-monitor-foundation`: job identity, parent authority, terminal handling, and mocked source-ingest connections.

Registry Preview/Apply and S-1/F-1, S-3/F-3, 424B adapter fixtures also guard this cleanup. These are offline mock/fixture checks, not real database or UI E2E. Historical SQL acceptance above is recorded evidence, not a fresh production verification. Isolated/live runners require separate authorization and are not cleanup acceptance commands.

## Do not reintroduce

- Stage 2 provider execution or canonical promotion through the current Registry/Matcher path.
- Primary/display/parser fallback when Registry facts are unavailable.
- ATM capacity or other unmappable values as Offering facts.
- Matcher/UI total recalculation, unavailable-to-zero coercion, or security-name semantic rules.
- New percentage conditions without a separately approved denominator/as-of/currency/basis contract.

## Implementation anchors

- Primary: `lib/ai/secS1F1AnalysisAdapter.ts`, `secS3AnalysisAdapter.ts`, `sec424bAnalysisAdapter.ts`, `lib/secFilingAnalysisIngest.ts`.
- Registry: `lib/dilution-registry/preview.ts`, `applyContract.ts`, `applyServer.ts`; `lib/monitor/registryBackedOfferingFacts.ts`, `offeringMonitorAutomaticTrigger.ts`, `offeringMonitorAlertConsumer.ts`, `conditionRegistry.ts`.
- Matcher: `lib/offeringMonitorMatcher.ts`; shared facts/helpers: `lib/minimalOfferingMonitor.ts`.
- O/S: `lib/sec-structured-data/offeringShareCountSidecar.ts`, `offeringShareCountSidecarRuntime.ts`; `workflows/offering-monitor-normalization.ts`.
- Jobs: `lib/offeringMonitorJobFoundation.ts`, `offeringMonitorJobRepository.ts`, `offeringMonitorJobStarter.ts`.
- History only: `lib/offeringMonitorHistoricalContract.ts`, `offeringMonitorCanonicalPersistence.ts`, `supabase/migrations/20260812111402_offering_monitor_canonical_persistence.sql`.
