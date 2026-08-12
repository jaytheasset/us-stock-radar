# Offering Monitor V1 Architecture

> **Authority.** This document is the authoritative architecture reference for Offering Monitor V1. Before modifying Offering Monitor architecture, prompts, persistence, canonical facts, or Matcher behavior, read this document first.
>
> If this document and the implementation disagree, audit the current code, migrations, and tests before deciding which is correct. When an architecture change is approved, update the code and this document in the same change.

## Intended component architecture

The intended external mental model is:

```text
SEC Filing
   ↓
Stage 1 — Primary Analysis (+ optional bounded Repair)
   ↓
Publish Analysis / Existing Score Alert
   ↓
Async Stage 2 — Offering Monitor Normalizer
   ↓
Validated Monitor Facts
   ↓
Canonical Offering Monitor State
   ↓
Offering Matcher
```

This is the intended and implemented component architecture. It does not mean every transition is automatically connected in production. At the current V1 checkpoint, production orchestration is wired only through creation of the validated Second-stage candidate. Canonical promotion and Matcher invocation are implemented and validated components but are not connected to the production execution path.

## Production Execution Status

```text
Analysis → Second-stage candidate = WIRED

Candidate → Canonical promotion = IMPLEMENTED / NOT PRODUCTION-WIRED

Canonical → Matcher = IMPLEMENTED / NOT PRODUCTION-WIRED
```

### Automatically wired

`workflows/source-ingest.ts` and the SEC analyze route enqueue `offeringMonitorNormalizationWorkflow` after a completed Primary. That workflow runs `processOfferingMonitorSecondStageJob()` and stores a validated `offering_monitor_normalization_candidate` in `ai_outputs`. `saveOfferingMonitorDiagnosticCandidate()` deliberately records `diagnostic_candidate_only: true` and `canonical_persistence_changed: false`.

```text
Primary Analysis
   ↓
Async Stage 2 Offering Monitor execution
   ↓
Validated / diagnostic Second-stage candidate
```

### Implemented but not production-wired

#### Canonical Promotion

The canonical table, application helper `promoteOfferingMonitorCanonical()`, atomic promotion RPC, fail-closed reader, and stale/idempotency/race protections are implemented and validated. A repository-wide caller audit finds no production caller of `promoteOfferingMonitorCanonical()`. A successful Second-stage execution therefore does not automatically become canonical current state.

#### Offering Matcher

`evaluateOfferingMonitorEvent()` and its canonical-reader-only, three-state evaluation are implemented and tested. A repository-wide caller audit finds no production caller outside tests. Even if canonical facts exist, the current production event flow does not automatically run user condition evaluation.

The current automatic runtime therefore stops after the diagnostic candidate:

```text
Stage 1 publish / score alert
   ↓
Async Stage 2 validated diagnostic candidate
   ↓
[NOT YET PRODUCTION-WIRED]
Canonical Promotion
   ↓
[NOT YET PRODUCTION-WIRED]
Offering Matcher
```

The implemented canonical and Matcher boundaries are the only approved continuation of the pipeline; they must not be bypassed with a legacy fallback. Until both orchestration connections are wired, Offering Monitor is not an end-to-end production Monitor flow. Implemented component does not imply production-wired component.

## Stage responsibilities and timing

### Stage 1: Primary Analysis and bounded Repair

Primary Analysis plus its optional validation Repair is one stage. Repair is not an Offering Monitor stage. The form-specific Primary flow owns whole-filing interpretation, event classification, title, summary and quick take, score, signal, user-facing analysis, display payload, and normal analysis persistence.

The Repair call is validator-triggered, restricted to selected source blocks and enumerated patch paths, and run with `maxAttempts: 1` and fallback disabled. The S-1, S-3, and 424B repair planners and patch appliers remain form-specific.

`runSecFilingAnalysisIngest()` persists the event and Primary AI trace, then runs the existing score-based alert delivery, and only then returns `primaryAiRunId`. The source-ingest workflow and analyze route enqueue Offering normalization after that completed result. Enqueue starts a durable child and does not await the child result. Stage 2 therefore never delays Stage 1 publication or the existing score alert. Enqueue or Stage 2 failure changes only the Monitor execution record; it does not rewrite or roll back the event, Primary analysis, score, signal, or alert.

### Stage 2: Offering Monitor Normalizer

Stage 2 is a Monitor-specific semantic normalizer, not a second whole-filing analyst. It owns the small fact contract required by canonical persistence and deterministic Matcher evaluation. It does not produce or revise title, summary, quick take, score, signal, bullish/bearish narrative, or any other user-facing Primary field.

Offering uses two stages because financing amount, primary/resale economics, immediate versus additional exposure, security relationships, and comparison compatibility form an interdependent semantic contract. Isolating that contract protects Primary latency and existing alerts while allowing Monitor validation to fail independently. This is an Offering-specific decision, not a universal Monitor rule. A simpler stable domain, including Ownership where its contract permits it, may remain one-stage.

## Supported form families and independent Primary paths

Stage 2 eligibility requires a completed Primary result, an exact supported prompt key, a supported form, and an exact persisted `primaryAiRunId`.

| Stage 2 family | Eligible forms in the identity guard | Required Primary prompt key | Primary preparation boundary |
| --- | --- | --- | --- |
| `s1` | `S-1`, `S-1/A` | `sec_s1_f1_analysis` | `secS1F1AnalysisAdapter.ts` and `s1-f1/sourceInput.ts` |
| `s3` | `S-3`, `S-3/A`, `S-3ASR`, `S-3MEF`, `F-3`, `F-3/A`, `F-3ASR`, `F-3MEF` | `sec_s3_offering_analysis` | `secS3AnalysisAdapter.ts` and `prompts/secS3OfferingAnalysis.ts` |
| `424b` | `424B` plus numeric 424B variants, with optional `/A`, when produced by `sec_424b_analysis` | `sec_424b_analysis` | `sec424bAnalysisAdapter.ts` and `forms/424b/analysisPrompt.ts` |

The SEC room registry explicitly enumerates `424B`, `424B1`, `424B2`, `424B3`, `424B4`, `424B5`, `424B7`, and `424B8`; the Monitor identity guard uses `^424B\d*(?:/A)?$` together with the exact prompt key.

`F-1`, `F-1/A`, `S-1MEF`, `F-1MEF`, and `POS AM` share the broader S-1/F-1 Primary room but are not Stage 2 `s1` eligibility. `S-4`/`F-4`, `S-8`, 8-K/6-K financing analysis, and other forms are also excluded. The tests explicitly reject F-1, S-4, 8-K, near-match `S-3D`/`F-3D`, wrong-prompt, dry-run, and failed Primary results.

The common Monitor output contract does not merge the Primary paths. Each family keeps its own source preparation, prompt, validation, repair, and display semantics. In particular, F-3 uses the S-3/F-3 Primary path and can start Stage 2 even though the transitional one-pass Monitor payload is enabled only for S-3 forms.

## Parser and semantic ownership boundary

Parsers and source-preparation code prepare structure and evidence: current filing identity, raw text blocks, tables, footnotes and remarks when present in those blocks, attachments and exhibits, document metadata, stable block/source identifiers, inventories, warnings, and bounded source packages. S-1 uses `buildS1F1LlmSourceInput()`; the current Stage 2 S-3/424B branch recursively collects prepared `cleaned_source_blocks`. `groupOfferingMonitorEvidenceBlocks()` groups by document metadata and preserves source order; tests forbid content-based financing or sample-specific ranking in that grouping.

Parser output is not Offering semantic truth. The LLM owns primary/resale/mixed classification, transaction-amount meaning, immediate/additional exposure, security/right relationships, alternative versus simultaneous exposure, comparison meaning, quality, and bound. Parser labels, security names, form names, or sample accessions must not be deterministic substitutes for those judgments.

## Stage 2 input and direct provider transport

`buildOfferingMonitorSecondStagePackage()` constructs `offering_monitor_second_stage_input_v1` from:

- exact event, raw item, accession, form family, parent prompt, and `parent_primary_ai_run_id` identity;
- a compact final Stage 1 context containing selected user-facing analysis and evidence references;
- selected SEC evidence blocks with stable `source_ref` values;
- structural document groups, current filing metadata, source inventory, and attachment inventory; and
- `allowed_source_refs`, the complete provenance namespace allowed in the response.

Primary context is semantic context only. It is scrubbed of Primary `offering_monitor`, `offering_monitor_payload`, `offering_monitor_provenance`, and `parser_output`, and it is never SEC provenance. Every available fact must point to selected SEC evidence through an allowed `source_ref`.

The selected package is bounded to 28 blocks and 100,000 source-text characters and must use less than 90% of the Primary source-text budget. The workflow fails before Gemini when the package is not meaningfully reduced.

Stage 2 calls Gemini once through `runStructuredGeminiJson()` with the direct `offeringMonitorSecondStageProviderSchema`. It no longer transports `offering_monitor_payload: "JSON string inside JSON"`. The response is one direct object with these root fields:

- required: `version`, `applicability`, `financing_stage`, `primary_or_resale`, `security_nature`, `available_monetary_facts`, `available_share_facts`, `unavailable_fact_keys`;
- optional when known: `has_warrant`, `has_prefunded_warrant`, `has_convertible`.

### Available/unavailable split

Provider schema conditionals for every combination of available and unavailable facts create an unnecessarily large state space. The direct transport instead separates:

- `available_monetary_facts`: amount and price rows;
- `available_share_facts`: immediate, additional, and resale rows; and
- `unavailable_fact_keys`: key-only unavailable facts.

Runtime requires each of the five LLM facts to appear exactly once in exactly one collection. Missing, duplicate, cross-family, both-available-and-unavailable, unknown, and extra rows fail closed. Unavailable keys carry no value, basis, or provenance in provider transport; runtime reconstructs their canonical null representation.

## Canonical fact contract

The direct object supplies root semantic fields plus five numeric facts. Code materializes the sixth, total exposure.

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

### Immediate, additional, and comparison compatibility

Immediate exposure is the distinct, deduplicated primary share-equivalent pool available from the current transaction. Additional exposure is only a distinct conditional or potential primary pool not already included in immediate; it is not a total.

Equal counts do not prove duplicate exposure. The Matcher fixture models IPDN with immediate `15,713,387` common shares and additional `15,713,387` common-warrant shares, producing total `31,426,774`. This is an example of the contract, not a sample-specific rule.

`security_basis` identifies the security or right that produces a fact. Immediate and additional may legitimately have different values. `comparison_basis_type` identifies the measurement basis that allows validation and addition. Validation requires compatible unit, currency, and comparison basis, not literal `security_basis` equality. Parser or code must not infer addition from security names.

### Deterministic total and numeric safety

Gemini never returns total potential exposure. `materializeMinimalOfferingMonitor()` calculates immediate plus additional once when both facts are eligible and their unit, currency, and comparison basis are compatible. It combines quality and bound conservatively and preserves both source/security identifiers. The promotion boundary re-materializes the five facts and compares the result with the stored diagnostic candidate before persistence. The Matcher reads the materialized total and never recalculates it.

The prompt requires the shortest ordinary JSON number that preserves source-supported value and precision: no invented precision, padded zeros, decorated/suffix numbers, or floating-point artifacts. Runtime additionally rejects duplicate JSON keys, trailing content, non-finite values, negative available facts, and any numeric literal longer than 128 characters. That lexical guard is serialization safety, not semantic amount correction; it fails closed and supplies no replacement value.

## Fact validity and provenance

Fact validity and exact citation quality are distinct. A fact with a valid value/quality/bound contract and an allowed `source_ref` remains Matcher-usable even if a human might choose a better allowed block as the most precise citation. Runtime and promotion strictly reject missing, fabricated, foreign, or forbidden-namespace `source_ref` values, but they do not claim to verify that the chosen member is the best exact semantic citation.

`source_ref` is retained for execution diagnostics, traceability, and evidence linkage. Current UI code does not render canonical `source_ref` or label it as a verified exact citation. A future UI must not make that claim without a separate exact-citation validation contract.

## Execution identity, history, and exact lineage

Logical Monitor work means normalization for one exact `(event_id, raw_item_id, parent_primary_ai_run_id)` tuple. `deterministicLogicalJobId()` hashes that identity. An execution is one attempt of that logical work under a specific execution contract and attempt key. `deterministicExecutionId()` adds `execution_contract_version` and `execution_attempt_key`; the current automatic contract is `second_stage_direct_v8` and the default attempt key is `automatic`.

Changing the approved attempt key or contract version creates a new execution ID while retaining the same logical ID and exact Primary parent. A failed execution and a later approved execution therefore have independent lifecycle records rather than overwriting each other.

`ai_runs` stores execution status, prompt/model/usage, errors, and metadata including `logical_job_id`, `execution_id`, contract, attempt, form family, and exact `parent_primary_ai_run_id`. `ai_outputs` stores the immutable diagnostic candidate keyed to the execution. Duplicate reservation/output writes use ignore-duplicate semantics. These tables are execution history and audit evidence, not current Matcher truth.

The parent association always comes from `parent_primary_ai_run_id`. Exact parent run/output/event/raw/accession relationships are rechecked when Stage 2 loads artifacts. Queries for the latest completed Primary are authority checks used only to reject stale work; they must never be used to choose a different parent for an execution.

## Canonical persistence and reader

The official current-state table is `event_offering_monitor_canonical`. It stores one row per event with exact raw item, parent Primary, source execution, form family, contract/schema versions, `validated_canonical_payload`, `materialized_payload`, deterministic total, validation status, and promotion time.

`promoteOfferingMonitorCanonical()` validates the stored `ai_outputs` candidate, re-materializes it, checks selected-source membership and identity, then calls the only write boundary: `promote_event_offering_monitor_canonical(event_id, source_execution_id, expected_candidate)`. The RPC locks the event and execution rows, verifies the exact event/raw/parent/output lineage and successful validation, confirms that the parent is still current, and upserts canonical state atomically. Failed, invalid, foreign, or stale executions cannot overwrite current state. Re-promoting the same execution is idempotent.

The official reader is `read_event_offering_monitor_canonical(event_id)`, wrapped by `readOfferingMonitorCanonical()`. It returns `available` only when the stored row, current event raw item, source execution/output, deterministic total, and latest exact Primary all agree. Otherwise it returns `not_ready` with a reason. It has no fallback to Primary one-pass Monitor data, parser output, `event_offering_terms`, latest `ai_runs`, raw Gemini output, or any market/display projection.

### Reanalysis and stale policy

The reader implements fail-closed reanalysis:

```text
Primary PA  → Monitor MA  → Canonical A
new Primary PA2 completes
             Canonical A immediately reads not_ready
Monitor MA2 pending/failed
             still not_ready
Monitor MA2 successfully promoted
             Canonical B becomes available
```

The old row may remain physically stored for audit, but it is not Matcher eligible once its parent is no longer current. This prevents a new analysis from matching against old financing terms.

### Atomicity, idempotency, and concurrency acceptance

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

`event_offering_monitor_canonical` has RLS enabled and direct table privileges revoked from `public`, `anon`, `authenticated`, and `service_role`. Both canonical functions are `SECURITY DEFINER` with fixed empty `search_path`. Direct execute is revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execute permission for promotion and reading. Application code must use these RPCs rather than direct table access.

## Legacy and display boundaries

### `event_offering_terms`

`event_offering_terms` is an Offering display/legacy projection populated by the existing Primary persistence path. Filing and event pages read it for offering registration/dilution presentation, classifications, amounts, market context, and display metadata. It may also hold the transitional Primary one-pass Monitor materialization under metadata. It is not current canonical Matcher truth, and `offeringMonitorMatcher.ts` does not read it.

### Primary one-pass Monitor

The Primary schema and prompt still contain the compact nested-string `offering_monitor_payload` path in `minimalOfferingMonitor.ts` for S-1, S-3, and 424B Primary compatibility. The adapter validates it, removes the raw string, and may persist its materialized form into legacy/display metadata. F-1 and F-3 use legacy Primary schemas without this payload. Stage 2 explicitly strips all Primary Monitor fields from its context.

This one-pass structure is transitional/legacy and regression-protected; it is not authoritative Matcher state. The direct-object transport rule applies to Stage 2. Do not confuse the continued Primary compatibility payload with permission to restore nested-string Stage 2 transport.

### `ai_runs` and `ai_outputs`

These are historical execution/audit stores. A Matcher must never scan them to infer current truth. Only a successfully promoted and still-current canonical row is eligible.

## Offering Matcher V1

`evaluateOfferingMonitorEvent()` reads canonical state exactly once per event and evaluates any number of condition sets. `evaluateOfferingMonitorConditions()` is pure, deterministic, and side-effect free. It produces `match`, `no_match`, or `ineligible`.

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

Canonical missing/stale/not-ready, reader failure, not-applicable canonical state, unsupported keys/operators, invalid values, incompatible currency/basis, and empty condition sets all fail closed as `ineligible`.

Conditions use AND aggregation:

1. Any definite `no_match` makes the set `no_match`, even if another condition is ineligible.
2. With no `no_match`, any `ineligible` makes the set `ineligible`.
3. Only all matching conditions produce `match`.

Percentage conditions such as dilution percent and float overhang percent are intentionally absent. Materialization contains derived metric slots, but the current Stage 2 candidate materialization uses an empty market snapshot and V1 Registry exposes no percentage keys. Without a reliable denominator, as-of time, currency/unit, and comparison-basis contract, the Matcher must not invent percentages.

## Alerts and product boundary

The existing alert is the Stock Radar score alert: event `delivery_level` is derived from Primary score (`75+` is `alert`) and delivery is attempted before Stage 2 enqueue. A future Monitor alert would be triggered by user condition matches. Both could legitimately occur for the same event and user; current architecture provides no automatic deduplication rule between them.

Monitor alert delivery, natural-language Monitor creation, and Monitor creation UI are not implemented. Production Offering Matcher invocation is implemented as a callable component but is not connected: no production code outside tests calls `evaluateOfferingMonitorEvent()`.

## Current Completion Boundary

### Implemented and validated components

- form-specific Stage 1 analysis, optional bounded Repair, persistence, and existing score alert;
- durable asynchronous Stage 2 identity, exact lineage checks, source reduction, direct Gemini object, and strict diagnostic candidate validation;
- execution history and logical-work/execution identity separation;
- five-fact canonical contract and deterministic total materialization;
- canonical table, atomic promotion helper/RPC, fail-closed reader, RLS/function security, stale protection, idempotency, and completed real multi-session concurrency acceptance;
- seven Offering Registry keys and deterministic three-state Matcher tests.

### Production-wired flow

```text
Analysis → Second-stage candidate
```

### Implemented but not production-wired

- automatic promotion of a successful Stage 2 candidate into canonical current state;
- production invocation of the Offering Matcher;

These are the two immediate production orchestration gaps: the canonical promotion connection and the Matcher invocation connection.

### Not yet implemented or connected

- Monitor alert delivery and any score-alert/Monitor-alert deduplication policy;
- natural-language Monitor creation and Monitor creation UI;
- removal of the transitional Primary one-pass Monitor contract;
- separately validated exact semantic citation and any provenance UI;
- percentage Matcher conditions without the required market denominator/as-of contract.

The permanent repository-tracked multi-session concurrency regression harness is also not preserved, although the disposable independent-session acceptance itself completed successfully.

## Next Production Integration

1. Wire successful validated Second-stage executions to canonical promotion.
2. Wire canonical-ready Offering events to Offering Matcher evaluation.
3. Only after those execution paths are validated, connect Monitor Alert delivery.

These are future, separately approved implementation tasks. This document does not authorize bypassing the canonical reader, adding fallbacks, or coupling Monitor Alert delivery directly to diagnostic candidates.

## Do Not Reintroduce

1. **Giant provider schema.** Do not graft the complex Monitor contract back onto the full Primary Analysis schema; keep the Stage 2 contract small.
2. **Nested JSON string transport in Stage 2.** Do not restore `JSON → stringified JSON → parser`; Stage 2 uses a direct structured Gemini object.
3. **Primary-overloaded Matcher truth.** Do not make the transitional one-pass Primary Monitor authoritative.
4. **Parser semantic hardcodes.** Do not replace LLM semantic ownership with security/form/sample mappings.
5. **Legacy fallback.** Missing canonical must remain `not_ready`; never fall back to parser, Primary, or `event_offering_terms`.
6. **Exact citation as a Matcher blocker.** Do not discard an otherwise valid fact solely because another allowed source block would be a better exact citation.
7. **Stale canonical reuse.** Do not expose old-parent canonical facts after a newer Primary becomes current.
8. **Matcher-side total recalculation.** Read the promoted materialized total; never recompute it in Matcher or UI.
9. **Sample-specific provenance rules.** Do not hardcode an accession, exhibit, source ref, or fixture as the correct evidence source.

## Architecture invariants

1. Stage 2 never delays Stage 1 publication or the existing score alert.
2. Stage 2 never rewrites Primary user-facing analysis, score, or signal.
3. The canonical reader is the Matcher’s only Offering truth.
4. Exact `parent_primary_ai_run_id` lineage is mandatory; latest Primary lookup is only a stale guard.
5. Old-parent canonical facts are not Matcher eligible.
6. Parser/source preparation never owns Offering semantics.
7. Failed, invalid, or stale Monitor executions never damage Primary or promoted current state.
8. Total potential primary exposure is materialized deterministically once.
9. Allowed-source membership is strict, while exact citation quality remains separate from fact usability.
10. Offering’s two-stage design does not require other Monitor domains to be two-stage.
11. Execution history and canonical current state remain separate.
12. Until production promotion is wired, the automatic flow must be described as diagnostic-only, not end-to-end canonical.
13. Implemented component does not imply production-wired component.

## Implementation cross-check anchors

The architecture above was cross-checked against these current entry points rather than historical phase reports:

- Stage 1 and timing: `lib/ai/secFilingAnalysisPreview.ts`, `lib/secFilingAnalysisIngest.ts`, `workflows/source-ingest.ts`.
- Form boundaries: `lib/ai/secS1F1AnalysisAdapter.ts`, `lib/ai/secS3AnalysisAdapter.ts`, `lib/ai/sec424bAnalysisAdapter.ts`, `lib/sources/sec/forms/common/forms.ts`.
- Stage 2: `lib/offeringMonitorJobFoundation.ts`, `lib/offeringMonitorJobRepository.ts`, `lib/offeringMonitorSecondStage.ts`, `lib/offeringMonitorSecondStageRuntime.ts`, `workflows/offering-monitor-normalization.ts`.
- Facts and materialization: `lib/minimalOfferingMonitor.ts`.
- Canonical boundary: `lib/offeringMonitorCanonicalPersistence.ts`, `supabase/migrations/20260812111402_offering_monitor_canonical_persistence.sql`.
- Matcher and Registry: `lib/offeringMonitorMatcher.ts`, `lib/monitor/conditionRegistry.ts`.
- Tests: `lib/minimalOfferingMonitor.test.ts`, `lib/offeringMonitorJobFoundation.test.ts`, `lib/offeringMonitorSecondStage.test.ts`, `lib/offeringMonitorCanonicalPersistence.test.ts`, `lib/offeringMonitorMatcher.test.ts`, and `supabase/tests/offering_monitor_canonical_persistence.sql`.
