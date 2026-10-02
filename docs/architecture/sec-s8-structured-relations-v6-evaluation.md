# S-8 Structured v6 — relations-only snapshot experiment

## Scope and freeze result

Candidate: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Task base: 3b2bfbf4f538faa63dc128d5d2cf6294cbc503a2

Result: Schema 3/3 PASS; Semantic 3/3 PASS. The requested v6 candidate freeze criteria are met. This is a bounded experiment, not production integration or a guarantee of general semantic accuracy.

## Contract and implementation

- version: s8_structured_v6.
- filing_kind: registration / amendment / deregistration / reoffer / other / unclear.
- current_plans: source names and existing E evidence references.
- prior_filings: source identifiers, prior_filing / current_target / unclear relationship and E references.
- unresolved: unique closed enum array, plan_relationship / prior_filing_relationship / filing_kind.

Removed summary and semantic_notes; no replacement prose field or key_facts. Existing server-owned directRegistrationRows remain separate from semantic in snapshot assembly. Source blocks, direct rows, input identity, source integrity and limitations are unchanged. No semantic extractor, regex, semantic/prose validator, relationship correction or repair was added. Names/references remain bounded strings: structural validation cannot guarantee their truth or prevent all prose inside those identifier strings. The three actual responses contain identifiers rather than explanatory prose.

Instruction length: 2318 -> 1672 characters.
Instruction SHA-256: 96bb9fe0d9c11036f9a973500a721ced36ce181f3a01fda4677dd5634a20f672.
Schema bytes (Microsoft / Nautilus / Lottery): 1248 / 1238 / 1208.
Complete request bytes: 26682 / 20916 / 12485. Instruction length and request size are different measures.

## Frozen real calls and factual evaluation

Same retained raw/canonical pairs, source blocks, direct rows, identity and generation settings as v5, confirmed offline. Expectations frozen before execution. Retained v5 results reused without another call.

gemini-3.5-flash; maxOutputTokens 4000; temperature 0; thinkingBudget 0; timeout 60000ms. The unchanged experimental runner preserves budget 0 at its fetch boundary. JSON mode with the output contract in the user payload and existing server structural validation, not provider-enforced responseSchema. Exactly three calls, one per case, no retry/repair/re-call or Primary execution. Runtime code hashes unchanged during execution.

| Case / accession | v5 Semantic | v6 Schema | v6 Semantic | Source comparison |
|---|---|---|---|---|
| Microsoft / 0001193125-25-337056 | PASS | PASS | PASS | registration; Microsoft Corporation 2026 Stock Plan only; E1/E2/E5/E7; no incidental historical plan or signature/price date |
| Nautilus / 0001808805-26-000013 | PASS | PASS | PASS | registration; 2021 Equity Incentive Plan and 2021 Employee Stock Purchase Plan; five actual prior S8 file numbers from E1 |
| Lottery.com / 0001641172-25-017852 | PASS | PASS | PASS | amendment; The Lottery.com 2021 Incentive Award Plan only; October 11, 2023 S8 current_target; April 6, 2022 S8 prior_filing |

Microsoft's source cover/exhibits/opinion/fee note support the 2026 plan. Empty prior_filings omits no necessary S8 parent; incidental incorporated periodic filings are not required relationships here.

Nautilus returns 333-258684, 333-262992, 333-269950, 333-277436 and 333-285356, each prior_filing supported by E1. It does not misclassify a price date as a filing date.

Lottery's source explicitly denies the nonexistent 2023 plan; it is not returned as an entity. The current correction target and earlier filing are correctly distinguished. No new registration, issuance, quantity or security claim is generated; its empty direct rows remain unchanged.

All complete responses and cited source blocks are retained in assessment.json. No separate snapshot-discipline score is used in v6. No authoritative quantities are repeated in these semantic outputs.

| Case | Input tokens | Output tokens | Latency | HTTP / finish |
|---|---:|---:|---:|---|
| Microsoft | 6719 | 110 | 2.309s | 200 / STOP |
| Nautilus | 5644 | 418 | 2.597s | 200 / STOP |
| Lottery | 3169 | 213 | 2.021s | 200 / STOP |
| Total | 15532 | 741 | 6.927s | |

Average latency 2.309s. Thinking usage not separately returned. Retained v5 totals: 16195 input / 1244 output, mean 2.837s. One sample per case does not establish general speed or reliability improvements.

## Verification and limitations

- v6 structural/provenance/isolation/runtime tests: 28/28 PASS.
- Existing direct-history and S8 Primary/parser/adapter/router tests: 55/55 PASS.
- Total 83/83, zero skipped; full TypeScript noEmit/incremental false PASS; diff check PASS.
- Primary prompt and adapter diff against local main: zero.
- Source builder, direct facts/persistence, Primary, generic provider and runner unchanged from task base.
- Tests explicitly reject removed/undeclared prose and direct-quantity fields; semantic mistakes in otherwise valid names/relationships are deliberately not corrected or rejected by code.
- Direct rows and source fingerprint preserved; snapshot read-back checked in memory, not production DB.
- No UI/browser checks needed: no UI/route changes.
- Singular not called because no verified normal raw/canonical pair was available. No identity bypass.
- Fine additional-registration/correction effects and explanatory negative context are intentionally absent from this minimal semantic contract; retained source evidence remains available.
- No production persistence, MCP endpoint, Monitor, Alert or overall product E2E certification.

## Evidence and operational handoff

Evidence: C:/Users/PC/.codex/visualizations/s8-structured-relations-v6-20261002/

- ground-truth.md, prior-v5-ground-truth.md: frozen expectations.
- offline.json, offline-input-review.json, live-start.json: input/settings/code freeze.
- CASE-source-package.json, CASE-request.json, CASE-actual-request.json.
- CASE-raw-response.json, CASE-output.txt: full unmodified responses.
- CASE-result.json, CASE-execution.json, CASE-official-reader.json: snapshot/read-back, usage, timing and hashes.
- assessment.json: full outputs and cited source evidence with separate Schema/Semantic assessments.
- tests.txt, typecheck.txt, completion.json, manifest.json.

Original SEC source artifacts remain in s8-factual-e2e-20261001; all earlier versions and evidence remain untouched. Candidate commit is the commit adding this document (git log -1 -- this file).

Changed files: lib/ai/s8StructuredAnalyzerPreview.ts; lib/sec-s8/structuredContract.ts; lib/sec-s8/structured.test.ts; this document.
Permanent main remains C:/Users/PC/Documents/Codex/US-Stock Radar, main only; no repository commands or mutations there.
Last verified local main shared ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b.
Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda; live GitHub main unverified.
Vercel commit/status unverified. No code-equality or deployment claim.
No DB query/write/migration, credentials/account/permission, runtime/server/Docker, cron, Monitor/Alert, UI or external-notification changes. Existing credentials are read only in memory by the existing runner, never saved in evidence. No merge/push/deploy performed. Freeze this candidate experiment; production adoption remains a separate authorized task.
