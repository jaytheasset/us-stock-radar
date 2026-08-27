# Economic Exposure Identity Observation Sidecar V1

## Production-call inspection

Read-only inspection was completed before implementation against the production SEC execution path in `lib/ai/secFilingAnalysisPreview.ts`, the form adapters and prompt builders, `security_inventory`, `instrument_details`, the common and 8-K/6-K source-block builders, and the Offering Monitor primary/child execution path.

| Production domain | Existing provider architecture | Source input available to the main analysis call | Sidecar decision |
| --- | --- | --- | --- |
| 8-K / 6-K | Existing router phase followed by one main analysis phase when analysis is required; an existing bounded validation-repair phase may run only for pre-existing display issues | Deep `cleaned_source_blocks` include stable block IDs, source references, original source text, attachment text, and explicitly labeled parent/related context | Add the optional sidecar only to the existing main analysis response. Router, repair, and call counts are unchanged. |
| S-1 / F-1 | One main analysis phase; an existing bounded validation-repair phase may run only for pre-existing display issues | Up to 40 source blocks, 5,000 characters per block, 135,000 total characters, with reserved attachment coverage and source/block identity | Add the optional sidecar to the existing main analysis response. No identity call or repair is added. |
| S-3 / F-3 | One main analysis phase. S-3/A and F-3/A can have a pre-existing amendment-triage phase; an existing bounded display repair may also run | Bounded `cleaned_source_blocks`, current filing identity, market context, and explicitly labeled parent context | Add the optional sidecar only to the existing main analysis response. Triage, repair, and call counts are unchanged. |
| 424B | One main analysis phase and no router; an existing bounded validation-repair phase may run only for pre-existing display issues | Bounded `cleaned_source_blocks`; 424B5 material-event variants already assign source block IDs | Add the optional sidecar to the existing main analysis response. No identity call or repair is added. |
| EFFECT | Deterministic analysis, no relevant exposure-analysis provider call | Registration lifecycle evidence only | Do not add the sidecar. |
| Offering Monitor canonical child | Separate existing child analyzer with its own canonical financing/dilution schema and normalized source-block input | Source blocks are available, but the child owns financing metrics and canonical persistence | Do not add identity extraction here. Doing so would duplicate the primary observation path and would cross the memory-only boundary. |

The inspected `security_inventory` and `instrument_details` surfaces contain useful security labels and terms, but they are presentation/coverage structures rather than authoritative economic-exposure identity contracts. The sidecar therefore reads the same original source bundle as the main LLM and does not derive identity from those surfaces.

## Provider-count conclusion

The implementation is structurally safe inside the existing main analysis invocation. For every targeted main analyzer, the sidecar changes that invocation from one provider request to one provider request (`1 -> 1`). Sidecar-added provider calls, verifier calls, and repair calls are all zero. Pre-existing form router, amendment triage, and display-repair behavior is unchanged and is not used to create or repair sidecar claims.

## Bounded wire schema

The logical sidecar root field is `economic_exposure_identity_observations`. The Gemini compatibility wire uses the compact required provider key `eeio`; transport maps it directly to the logical sidecar and raw trace cleanup removes both names so identity observations remain memory-only.

- Maximum observations: 4.
- Maximum claims per observation: 6.
- Distinct logical wire fields: 10 including the optional root field; observation has 3 fields, claim has 4, and evidence selection has 2. The provider returns the bounded observation array as one JSON string at the compact `eeio` field so the nested array/object graph and long canonical property name do not exceed Gemini's 8-K finite-state schema limit; transport decodes it before enforcing the full contract.
- Supported exposure types and claim kinds are imported from `economicExposureContracts.ts`; the sidecar defines no duplicate domain enum. Exposure-type, observation-kind, claim-kind, and semantic-role enums are enforced by deterministic transport rather than expanded in the provider schema.
- Observation fields: `exposure_type`, `observation_kind`, `identity_claims`.
- Claim fields: `claim_kind`, `value`, `semantic_role`, `evidence`.
- Evidence-selection fields: `source_block_index`, `exact_quote`.
- Optional/null policy: observation content is optional and uses an empty logical array when absent; current provider schemas require the compact string field and require the exact string `[]` for no observations, while transport remains backward-compatible with an omitted logical root or a legacy array value. `semantic_role` is null for non-date claims and an exact locked date role plus an exact ISO date for date claims. Observations and claims themselves use no null placeholders.
- For the failing 8-K operating/legal/routine family, the exact Gemini-transformed schema is 8,874 bytes after compatibility encoding versus 8,842 bytes before the sidecar. Runtime logical output is an empty array when absent and is bounded by 4 x 6 claims otherwise.

The provider does not calculate hashes. It selects one exact quote and its source-block index. Deterministic transport verifies membership and a unique exact range, then uses `buildDilutionEvidenceIdentity` to derive the locked field-level range, SHA-256, source reference, and `exact_source: true` identity. This derives provenance only; it does not calculate, correct, or supply an SEC analysis value.

## Gemini structured-output compatibility evidence

Cached NVDA accession `0001045810-24-000113` (`8-K`) reproduced the production Primary `operating_legal_routine` rejection on `gemini-2.5-flash-lite` at `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`. The provider returned HTTP 400 / `INVALID_ARGUMENT` with this message:

> The specified schema produces a constraint that has too many states for serving. Typical causes of this error are schemas with lots of text (for example, very long property or enum names), schemas with long array length limits (especially when nested), or schemas using complex value matchers (for example, integers or numbers with minimum/maximum bounds or strings with complex formats like date-time)

The provider body supplied no field-violation path. Static A/B and same-model confirmation isolated the rejected delta to `$.properties.economic_exposure_identity_observations`: the pre-sidecar-equivalent transformed schema was 8,842 bytes, SHA-256 `86d994935fad625ea08ae88d14c8e95d9f94e6196699b7016673e82d14769f26`, and returned HTTP 200; the nested sidecar schema was 9,953 bytes, SHA-256 `77f1d4858966689ead3a04bcbd0f63936c93b4b4d2aa11286e4984e43664eeeb`, and returned the 400 above. Removing only domain enums and then collapsing only the nested object shape did not clear the limit. The accepted required `eeio` string schema was 8,874 bytes, SHA-256 `9ac229dc1cc430549adf5ba5783b00d378c62da936fe6d9e5e131995df421823`, and the same cached NVDA Primary confirmation returned HTTP 200 / `STOP` with valid JSON and a sidecar string that decoded to an array.

## Fail-closed transport and memory boundary

Transport enforces the locked exposure/claim compatibility map, exact object keys, count bounds, source-bundle membership, unique exact quote, semantic date role, and explicit pre-funded subtype evidence. A malformed claim is rejected without making another valid observation unusable; an observation with no remaining valid source-backed claim is omitted and reported in the in-memory rejection list.

The production adapter exposes validated observations separately from `analysis`. `runSecFilingAnalysisIngest` returns them for diagnostics but does not pass them to `saveAnalyzedSecFilingEvent`, Offering Monitor persistence, or any database repository. The existing AI trace receives the provider output with both the logical sidecar root and compact provider key removed, so the observation result is not retained indirectly in raw output text. The deterministic resolver remains the only owner of `CREATE_NEW`, `LINK_EXISTING`, `AMEND_EXISTING`, `UNRESOLVED`, and `CONFLICT`.

No migration, table, registry, RLS/grant, terms state, potential-share calculation, dilution calculation, O/S change, UI route, scheduler, provider call, push, deployment, or server restart is part of V1.

## Actual-cache production preview

All eight cached accessions were run read-only through `runSecFilingAnalysisPreview` with the candidate production analyzers and their existing Gemini execution paths. A separate dry inspection confirmed the expected source anchor in every filing input and, for S-3/424B, in the exact bounded main prompt. No preview persisted, enqueued, or mutated data.

| Ticker | CIK / accession / form | Validated result and exact evidence | Resolver outcome / unresolved reason |
| --- | --- | --- | --- |
| GME | 0001326380 / 0001193125-24-141214 / 8-K | `atm_program`; `sales_agreement_reference=Open Market Sale Agreement SM`, `sales_agent=Jefferies LLC`, plus supporting capacity. Each claim has an analyzer-source ref, exact range, and SHA-256. | `CREATE_NEW` |
| HR | 0001360604 / 0001628280-26-051463 / S-3 | Final snapshot's pre-existing main `material_events` display validation failed before adapter transport. An earlier candidate run did validate the exact `3.00% Exchangeable Senior Notes due 2032` reference, demonstrating the source/input path. | `UNRESOLVED` in the final snapshot: main analysis unavailable |
| EDBL | 0001809750 / 0001477932-26-004651 / S-3 | Final snapshot returned no sidecar claims despite the prompt containing both note designations. | `UNRESOLVED`; no notes were collapsed. The deterministic actual-source replay separately proves Note A-1 and Note B resolve as two `CREATE_NEW` exposures under one agreement. |
| RLAY | 0001812364 / 0001193125-24-194962 / S-3ASR | `atm_program`; exact sales-agreement reference plus supporting capacity, with exact evidence identities. | `CREATE_NEW` |
| EMPD | 0001829794 / 0001683168-26-002135 / 424B5 | Pre-existing main `material_events.key_terms` validation failed before adapter transport. | `UNRESOLVED`: main analysis unavailable |
| MRAI | 0001844392 / 0001213900-26-084129 / 8-K | A provider attempt mislabeled evidence as pre-funded; deterministic explicit-subtype validation rejected the observation. | `UNRESOLVED`: all claims rejected fail-closed |
| TPET | 0001898766 / 0001493152-26-015727 / 424B5 | ATM agent/capacity were source-backed but were supporting-only. A prospectus-supplement amendment reference did not identify the sales agreement target. | `UNRESOLVED`; no false link/amend/create |
| SKK | 0001991261 / 0001493152-26-035691 / 424B5 | `atm_program`; exact `sales agreement originally dated May 18, 2026` plus A.G.P./Alliance Global Partners, with field-level evidence. A separate prospectus-amendment reference remains unresolved. | Repeated exact agreement can `LINK_EXISTING`; no duplicate exposure and no false `AMEND_EXISTING`. |

Final filing-level snapshot counts are: resolved 3/8 (`CREATE_NEW=2`, `LINK_EXISTING=1`, `AMEND_EXISTING=0`), `UNRESOLVED=5`, `CONFLICT=0`, wrong-confident identity=0. The deterministic actual-source transport replay covers 10 observations and produces `CREATE_NEW=9`, `LINK_EXISTING=1`, `UNRESOLVED=0`, `CONFLICT=0`, wrong-confident=0; identical replay inputs return identical decisions. The higher pure replay count is validation coverage, not a fallback applied to missing live output.
