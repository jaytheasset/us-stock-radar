# S-8 Structured v4 — minimal snapshot experiment

## Scope and decision

Candidate: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Base: 012cf44d6dbef96540e5f7c9126901dccc803925

Before: neutral source -> independent LLM -> detailed semantic relationship graph.
After: the same source -> independent LLM -> compact factual AI snapshot.

Decision: **Snapshot 계약 추가 단순화 필요**.

All three samples pass schema and factual semantic assessment; the v3 nonexistent Lottery plan entity error is resolved in this bounded run. However, all three responses repeat server-owned registration quantities in prose despite the instruction not to, and Microsoft/Nautilus include nonessential facts. Do not call this complete adherence to the minimum snapshot contract. No tuning or new calls followed the results.

This remains an independent preview, not a Primary extension, production canonical writer, Monitor, Alert, public route or MCP integration.

## Contract and unchanged boundaries

Removed:
- plan scope and historical plan entity management;
- registrations/row-to-plan graph;
- seven reference roles;
- separate amendment-effect enum and redundant relationship evidence;
- enumerated unresolved categories.

Model-facing fields:
- version: s8_structured_v4.
- filing_kind: registration / amendment / deregistration / reoffer / other / unclear.
- summary: factual English 1-3 sentences requested; up to 2000 characters structurally.
- current_plans: name + E evidence refs, at most 20.
- prior_filings: reference + prior_filing/current_target/unclear + E refs, at most 20.
- key_facts: fact + E refs, at most 6.
- unresolved: short free-text uncertainties, at most 5.

All keys required; objects closed. Text items at most 1000 characters; E arrays at most 8 distinct supplied refs. No source quotes or model fingerprint echo.

The server attaches unchanged directRegistrationRows separately; registration counts, units, exact security titles and source evidence remain owned by the existing deterministic direct-history path. Model prose is not a replacement for these records. No numeric parser fallback or semantic repair exists.

Validator checks only JSON/duplicate keys, required keys/types/enums/lengths, E refs and package integrity. It does not judge claims, entity existence, date roles or relationships. Tests deliberately require structurally valid false semantics and contradictory prose to pass unchanged. Sentence-count compliance is not enforced by lexical heuristics.

Source builder, original source blocks/spans/hashes, direct rows, Primary prompts/schemas/runtime/repair and direct canonical persistence/reader are unchanged. Removed v3 semantic candidates/guards remain absent. v1-v3 commits and evidence remain preserved.

## Instructions and frozen execution

Instruction source: lib/ai/s8StructuredAnalyzerPreview.ts / S8_STRUCTURED_INSTRUCTIONS.
SHA-256: aee4062d514daf301017cdfd7dc8271687c6cf86bf5fe9717fdf036b8fe04889
Length: 2123 characters (v3 3137, reduction 1014).
Schema: Microsoft 1599 bytes (v3 2705); Nautilus 1584 (2685); Lottery 1539 (2614), about 41% smaller.
Total actual request: 27559 / 21786 / 13334 bytes, respectively; source text is still present.

scripts/verify-s8-structured-preview.mjs uses gemini-3.5-flash explicitly for this experiment without changing environment/default product models.
The runner preserves the prior 3.5 comparison's generation settings: JSON mode, temperature 0, thinkingBudget 0, maxOutputTokens 4000, timeout 60000ms. Its injected transport supplies budget 0 because the unchanged generic provider omits that setting for 3.5. No provider responseSchema is added: output_contract is in the user payload and the existing Ajv boundary enforces it.
Model IDs were previously confirmed by the actual API; each response again reports gemini-3.5-flash.

Offline comparisons prove identical v3/v4 source package, identity, direct rows, limitations and generation configuration. Only instructions and output contract differ. Original ground truth preserved; v4 pre-call acceptance notes are evaluator-only. Code hashes frozen before all calls, checked after them. Three calls total, one per sample; no retries, repair, Primary or separate analysis calls.

## Source-grounded results

| Case | Schema | Semantic | v3 Semantic | Core snapshot understanding |
|---|---|---|---|---|
| Microsoft 0001193125-25-337056 | PASS | PASS | PASS | PASS |
| Nautilus 0001808805-26-000013 | PASS | PASS | PASS | PASS |
| Lottery.com 0001641172-25-017852 | PASS | PASS | FAIL | PASS |

Semantic PASS means supported statements within the fixed sample, not full instruction compliance. Separately, the no-regenerated-direct-values instruction was not followed in all three outputs. No quantity string was corrected or stripped before evaluation/snapshot generation.

### Microsoft

Correct current Microsoft Corporation 2026 Stock Plan and registration purpose. Approval December 5, 2025 / scheduled effectiveness March 1, 2026 match fee Note 1.B. No signature-date prior filing or invented historical plan. Empty prior_filings omits ancillary incorporated reports, not a required S8 parent.

Summary repeats 226000000 shares; key facts repeat quantity, security/par value and registration fee. They are accurate but violate the intended direct-value separation. The indemnification-trust fact is in E2 but extraneous to the minimum registration snapshot.

### Nautilus

Both actual plans are current; additional/annual-evergreen registration is correctly summarized. All five earlier S8 file numbers are prior_filing. The February 20, 2026 price date is correctly fee-pricing context, not a prior filing. Original two direct rows remain unchanged.

Summary/key facts repeat the two authoritative counts. Price, fee and legal counsel shareholding facts are present in E2/E4 but unnecessary for this snapshot. The source-stated counsel percentage is not a newly calculated dilution percentage.

### Lottery

Only current entity: The Lottery.com 2021 Incentive Award Plan.
The nonexistent 2023 plan is explicitly denied in summary/key_facts, never emitted as a current/historical entity.
October 11, 2023 S8 = current_target; April 6, 2022 S8 = prior_filing. Approval October 28, 2021 is not misclassified as a filing.
Amendment/correction meaning is clear; server direct rows remain empty. No new registration row is created.

Complete summary:
> This filing is a post-effective amendment to a previously filed Form S-8 to correct a mistake regarding the registered plan. It clarifies and confirms that there is no Lottery.com 2023 Incentive Award Plan, and that the registered shares are instead issued pursuant to the Lottery.com 2021 Incentive Award Plan.

The last key fact says the 500000 shares referenced in the October 11, 2023 filing are being issued pursuant to the 2021 plan. E1's quoted replacement explanatory note actually says those shares "are being issued pursuant to" that plan. In the complete amendment/historical-reference context, this is not assessed as an invented current issuance event. It is still not independent proof of completed/current issuance, and must not be promoted into canonical issuance facts. Repeating the historical quantity violates the prompt's direct-value separation. The full source/output review is preserved in lottery-context-review.json.

## Tests and runtime evidence

- V4 structural/provenance/isolation/runtime checks: 24/24 PASS (updated suite, not 24 wholly new tests).
- Unchanged direct-history and S8 Primary/parser/adapter/router: 55/55 PASS.
- Total 79/79 PASS; zero skipped.
- Full TypeScript noEmit/incremental false: PASS.
- Primary files diff against local main: zero.
- Source builder, direct-history, generic provider and Primary diff against base: zero.
- git diff --check: PASS.
- Initial test command using a relative custom loader failed before test collection because its resolution pointed above the worktree. Using the existing loader's absolute file URL passed; no loader/product fix was made. Both logs are preserved.

| Case | Calls | Input tokens | Output tokens | Latency | HTTP / finish |
|---|---:|---:|---:|---:|---|
| Microsoft | 1 | 6909 | 429 | 3.104s | 200 / STOP |
| Nautilus | 1 | 5831 | 928 | 4.417s | 200 / STOP |
| Lottery | 1 | 3347 | 586 | 3.260s | 200 / STOP |
| Total | 3 | 16087 | 1943 | 10.781s | |

Mean 3.594s. Thinking usage not separately returned. Retained v3 3.5 comparison: input 17374, output 1606, mean 3.060s. Smaller schema did not imply fewer output tokens or lower latency in this sample. Model was not compared again.

Evidence directory:
C:/Users/PC/.codex/visualizations/s8-structured-snapshot-v4-20261002/

- ground-truth.md and prior-v3-ground-truth.md: pre-call acceptance and preserved earlier expectations.
- offline.json, offline-input-review.json, live-start.json: source/config/code freeze.
- CASE-source-package.json, CASE-request.json, CASE-actual-request.json: full evidence/input.
- CASE-raw-response.json, CASE-output.txt: full untouched response.
- CASE-result.json: structurally accepted snapshot, including any instruction violations.
- CASE-execution.json: timestamps, usage, latency, finish and hashes.
- assessment.json, lottery-context-review.json: separate source evaluation, not runtime validation.
- tests.txt: initial loader failure; tests-absolute-loader.txt: 79 passing checks.
- typecheck.txt, completion.json, manifest.json.

Original sources: C:/Users/PC/.codex/visualizations/s8-factual-e2e-20261001/
V3 comparison: C:/Users/PC/.codex/visualizations/s8-structured-v3-model-comparison-20261002/
Earlier experiments remain in their original locations. Singular not called: no verified normal raw/canonical pair in the retained evidence.

## Resume boundary / operational handoff

Stop after this experiment. A subsequent decision is needed on direct-value repetition and snapshot relevance before calling the minimum contract fully satisfied. No additional semantic validator, numeric stripping, prompt tuning, retry or product connection has been implemented.

Changed files: structuredContract.ts, s8StructuredAnalyzerPreview.ts, structured.test.ts, verify-s8-structured-preview.mjs, this document.
Candidate commit: commit adding this document (git log -1 -- this file).
Permanent main workspace remains C:/Users/PC/Documents/Codex/US-Stock Radar, main only; no repository command or mutation performed there.
Local main shared ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b.
Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda; live GitHub state unverified.
Vercel deployment commit/status unverified. No code equality/deployment claim.
No DB query/write/migration, account/permission, runtime configuration, server, Docker, cron, UI, Monitor/Alert or external notification changes.
Existing candidate node_modules junction preserved; no install/lockfile change.
Existing Gemini credentials read in memory only; no secret values saved.
No merge/push/deploy authorized or performed. No browser work required: no UI changes.
