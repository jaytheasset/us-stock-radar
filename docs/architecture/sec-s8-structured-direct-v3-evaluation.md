# S-8 Structured v3 — direct source analysis

## Scope and result

Candidate: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Starting commit: e0c544cb9f6d86e28451942650d317c56c4c93c0

Requested architecture change is implemented:
source → neutral ordered source blocks → independent LLM semantic analysis → structural validation → snapshot.

Bounded live result: Microsoft Schema PASS / Semantic PASS; Nautilus PASS / PASS; Lottery PASS / FAIL. Conclusion for these fixed samples: **gemini-2.5-flash semantic reliability is insufficient**. This does not establish a universal model ranking or authorize another tuning cycle, call, model change or architecture redesign.

All three structurally accepted snapshots are retained unchanged. Lottery's snapshot is not semantically approved and must not be treated as trusted product data. No DB, Monitor, Alert, public route or UI consumes this preview.

## Removed and retained

Deleted structuredCandidates.ts and all its runtime imports. Removed plan-name/date/file-number/URL candidate extraction, lexical aliases, historical/current/denial guards, candidate promotion checks, row-plan meaning checks and amendment/reference compatibility checks. Original implementation and results remain in Git and the v1/v2 evidence archives.

The existing canonical direct-facts builder is still reused to validate retained source and direct registration rows. Its legacy plan/related-reference outputs are not supplied to the model; the underlying frozen direct-history implementation is unchanged.

Source package retains document order, D document IDs, E block IDs, normalized text/spans/hash and original document URL/hash. Chunk size/source limits unchanged. No semantic labels are attached to source blocks.

Model input contains current identity, projected direct registration rows (R ID, exact canonical security title, quantity/unit and source document IDs), neutral text blocks, source limitations and output contract. It contains no Primary result, parser plan classification, semantic candidate set or guard. Direct rows in the snapshot remain byte/value-equivalent to the previous run; parser-owned source records are not rewritten.

The package fingerprint remains server-owned provenance. It is not a model input/output field to be regenerated. The provider response is associated with the current request by the caller; no fingerprint correction or substitution is performed.

## V3 wire and validation boundary

Fields:
- version: s8_structured_v3
- filing: kind, evidence
- plans: source name, current_filing/historical_reference/amendment_target/unresolved scope, evidence
- registrations: allowed R row, linked/unresolved relation, plan-name strings, evidence
- references: reference_text, role, evidence
- amendment: effect, evidence
- unresolved: existing bounded categories

All objects are closed. Model-selected E/R refs must exist in the request. String/array limits, required fields, enums/types, duplicate JSON keys and unknown fields are checked. Source-package integrity is checked as provenance, not meaning.

There is **no semantic validator**. Invented names, wrong current/historical scope, wrong date roles, inconsistent linkage/effect, missing relationships or mistaken plan selections can pass structure. Their correctness is evaluated separately against SEC source. Tests explicitly prove that semantically incorrect but structurally valid combinations pass unchanged. No original response is repaired, filtered, rewritten or retried.

Snapshot creation occurs after structural acceptance only. It retains model semantics unchanged, copies original direct rows and dereferences selected E blocks. It explicitly records that structural validation does not certify semantic accuracy. No issued shares/current reserve/realized dilution interpretation is supplied by code.

## Dedicated instructions

Location: lib/ai/s8StructuredAnalyzerPreview.ts, S8_STRUCTURED_INSTRUCTIONS.
Instruction SHA-256: ffcff6042bb8d1daec40fe1e26a7dadf8dc3e1730ee50a2c93a9b6a5847bd2e9
Length: 3,137 characters.

The model reads source directly and decides filing meaning, plan scope, direct-row relationships, earlier-document relationships and amendment effect. It must distinguish a mention from a plan/entity, a date from a filing identity, historical context from current registration, and future boilerplate from a completed action. Unestablished relationships remain unresolved. General principles only; no company-specific rules.

Existing provider/config reused: gemini-2.5-flash, temperature 0, thinkingBudget 0, maximum output 4000 tokens, timeout 60 seconds. JSON mode with disclosed output_contract and server Ajv validation; not provider-enforced responseSchema. One independent Structured call per case, no Primary call or separate repair.

## Offline checks

- 25 v3 structural/provenance/isolation/runtime checks PASS.
- 55 existing direct-history/S-8 Primary/parser/adapter/router checks PASS.
- Total **80/80 PASS**, zero skipped.
- Full TypeScript PASS (noEmit, incremental false); diff check PASS.
- Former semantic-rejection expectations were replaced, not skipped: the new tests require arbitrary valid semantic combinations to pass structural validation, as requested.
- Actual outbound requests inspected offline: no P/H candidates, guard fields or fingerprint echo; E block text/order and canonical direct values match v2. D IDs were added without changing source text.
- Source-hash/official-reader checks use preserved records in an in-memory read-only repository, not a fresh DB query.
- Existing pre-call ground truth reused unchanged. It is evaluator-only, never model input.
- Code/prompt frozen before live execution; no code change or output correction after seeing results.

## Live source comparison

| Filing | Calls | Schema | Semantic | Findings |
|---|---:|---|---|---|
| Microsoft 0001193125-25-337056 | 1 | PASS | PASS | Correct current 2026 Stock Plan, R1 link and initial registration. Signature date not treated as earlier filing. Future incorporation boilerplate not emitted as existing history. |
| Nautilus 0001808805-26-000013 | 1 | PASS | PASS | Two actual plans with correct R1/R2 links; five earlier S-8 registrations separated. No extra 2021 Plan alias entity or fee-pricing date misclassified as a filing. |
| Lottery.com 0001641172-25-017852 | 1 | PASS | FAIL | Correct amendment/corrects_prior, 2023 amendment target, 2022 historical registration and empty direct rows. Still lists explicitly nonexistent 2023 plan. |
| Singular 0001193125-25-031333 | 0 | Not run | Not evaluated | Retained archive still lacks normal raw/canonical pair. No DB query, new ingestion or identity bypass. |

### Microsoft

SEC legal/fee evidence links 226,000,000 registered shares to Microsoft Corporation 2026 Stock Plan. The response links R1 to that current plan without generating quantities. Incorporated references correspond to the supplied 10-K/proxy/common-stock description evidence. Its broad past-reports incorporation entry is source-supported; narrower output could be more concise, but is not a factual failure.

### Nautilus

The response links R1 (6,323,480 shares) to 2021 Equity Incentive Plan and R2 (1,264,696 shares) to 2021 Employee Stock Purchase Plan. It preserves additional_registration semantics and five previous S-8 file numbers. not_applicable amendment effect is compatible with an additional-registration S-8 rather than an amendment form.

Extra references to 8-K/10-Q/S-4 exhibits are present in E2's “Incorporated by Reference” exhibit table with matching file/exhibit numbers and dates. This is nonessential detail, not an invented filing. No February 20 market-price-date reference appears.

### Lottery — material failure preserved

SEC explanatory note in E1:
“there is no Lottery.com 2023 Incentive Award Plan. The only Incentive Award Plan is ‘The Lottery.com 2021 Incentive Award Plan’ ...”

Raw output:
{"name":"Lottery.com 2023 Incentive Award Plan","scope":"historical_reference","evidence":["E1"]}

A denied plan mention is not an existing historical plan entity under the requested contract. This is Semantic FAIL even though the name occurs in the source and E1 exists. The validator correctly makes no semantic judgment under the new design.

The actual 2021 plan is now current_filing, an improvement over v2, but is duplicated with/without leading “The.” October 11, 2023 is correctly amendment_target; April 6, 2022 is historical/incorporated history, with redundant references rather than a fabricated additional-registration target. No source-less 500,000-share current row is created. The nonexistent 2023 plan is the principal material blocker; duplicates are a secondary quality finding.

## Calls and evidence

All three: HTTP 200, finishReason STOP, complete JSON. Three calls, zero retries/repair, zero Primary calls, zero DB writes.

| Case | Input tokens | Output tokens | Latency |
|---|---:|---:|---:|
| Microsoft | 7,347 | 615 | 3.713 s |
| Nautilus | 6,266 | 1,538 | 6.776 s |
| Lottery | 3,761 | 616 | 3.174 s |
| Total | 17,374 | 2,769 | 13.663 s |

Average 4.554 seconds. Thinking usage not separately returned; budget configured zero. These samples are not a billing or general latency claim.

Evidence:
C:/Users/PC/.codex/visualizations/s8-structured-direct-v3-20261002/

- ground-truth.md: prior source-grounded expectations frozen before calls.
- offline.json / live-start.json: code and input freeze.
- offline-input-review.json: request/source/direct-row equality checks and Singular availability.
- CASE-source-package.json, CASE-request.json, CASE-actual-request.json: complete input and actual body.
- CASE-raw-response.json, CASE-output.txt: complete unmodified response.
- CASE-result.json, CASE-execution.json: structural result/snapshot, timestamps, usage.
- assessment.json: separate manual semantic assessment, not runtime enforcement.
- tests.txt, typecheck.txt, manifest.json, completion.json.

Original SEC raw/canonical evidence:
C:/Users/PC/.codex/visualizations/s8-factual-e2e-20261001/
Prior experiments remain:
C:/Users/PC/.codex/visualizations/s8-structured-v1-20261002/
C:/Users/PC/.codex/visualizations/s8-structured-contract-v2-20261002/

## Files and operational handoff

- Removed: lib/sec-s8/structuredCandidates.ts.
- Updated: lib/sec-s8/structuredSource.ts; lib/sec-s8/structuredContract.ts; lib/ai/s8StructuredAnalyzerPreview.ts; lib/sec-s8/structured.test.ts; scripts/verify-s8-structured-preview.mjs.
- Added: this document.
- Candidate commit: commit adding this document (git log -1 -- this file).
- Local main shared ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b; unchanged.
- Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda; live GitHub state not fetched/verified.
- Vercel deployment commit/status unverified; no code-equality/deployment claim.
- Permanent main workspace: C:/Users/PC/Documents/Codex/US-Stock Radar; no Git commands or mutations there.
- Primary and canonical direct-history diff versus main/base zero. No product Primary prompt/schema/runtime or site contract change.
- No DB access/write/migration, permissions, cron, server, Docker, Monitor, UI, public route or external-notification changes. DB/deployment state otherwise unverified.
- Existing candidate node_modules junction retained; no dependency install/lockfile/runtime configuration changes.
- Existing local Gemini credentials read only in memory; no credentials/env/header values committed or included in evidence.
- No browser checks needed: no UI or route changes.
- No merge, push or deployment authorized/performed.
- Stop here. No automatic persistence or Monitor/Alert connection. No follow-up prompt/model change or new call was performed after the result.
