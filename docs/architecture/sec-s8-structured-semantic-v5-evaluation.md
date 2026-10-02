# S-8 Structured v5 — semantic-only snapshot experiment

## Scope / result

Candidate worktree: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Base: e587b9fec767f2dc059c874a9fb59bcd0b266d24

Result: Schema 3/3 PASS; Semantic 3/3 PASS; Snapshot discipline 1/3 PASS.
The narrower role is not yet consistently followed. No further tuning or calls after this result.

The independent source -> neutral blocks -> LLM -> structural validation -> snapshot path is unchanged. Primary, deterministic direct facts and source identity/provenance remain separate. Nothing is connected to production DB persistence, Monitor, Alert, UI or MCP.

## Minimal changes

- Version s8_structured_v5.
- key_facts[{fact,evidence}] -> semantic_notes[{note,evidence}], maximum 6 -> 3 entries.
- Summary requests 1-2 meaning-only sentences; structural maximum 2000 -> 1000 characters.
- Same filing_kind, current_plans, prior_filings relationship enums and unresolved.
- Instructions explicitly separate server-owned identity/rows/counts/units/security values from semantic interpretation; unnecessary procedural/legal/pricing/fee facts are omitted.
- Exact plan names and necessary earlier-filing identifiers retain their source spelling/numbers.
- No new numeric exception is needed for these three cases.
- No semantic candidate extraction, numeric/semantic regex validator, relationship check or answer repair added. Structurally valid numeric prose is deliberately accepted unchanged by regression tests.
- Source blocks/direct rows/input payload construction, generic provider, runtime, runner and all Primary files unchanged.

The earlier key_facts label may have encouraged broad summarization, but this experiment does not prove a causal effect of that field name: instructions and structural limits also changed.

Instruction SHA-256: 9e2238efe90b5812b0ff0959cf9074e02671201313ee1a926bde1f57edc83a83.
Instruction length: 2318 characters (v4 2123); explicit role separation made instructions longer, not shorter.
Schema bytes: Microsoft 1609, Nautilus 1594, Lottery 1549. Renaming the field adds 10 bytes despite lower output limits.
Total request bytes: 27764 / 21991 / 13539. Do not equate reduced output scope with smaller input bytes.

## Frozen comparison

Same three retained SEC raw/canonical pairs, source blocks, direct rows, identity, limitations and provider settings as v4; offline equality checks preserved. Ground truth and three separate acceptance axes were fixed before calls.

gemini-3.5-flash only; maxOutputTokens 4000, temperature 0, thinkingBudget 0, 60000ms timeout. The unchanged v4 experimental runner explicitly preserves budget 0 at its fetch boundary. JSON mode with output_contract in the payload and server validation; not provider-enforced responseSchema.
Exactly one call per case, three total. No retry, repair, Primary execution or follow-up call. Code hashes unchanged throughout the live run.

| Case | Schema | Semantic | Snapshot discipline | v4 discipline |
|---|---|---|---|---|
| Microsoft 0001193125-25-337056 | PASS | PASS | FAIL | FAIL |
| Nautilus 0001808805-26-000013 | PASS | PASS | FAIL | FAIL |
| Lottery.com 0001641172-25-017852 | PASS | PASS | PASS | FAIL |

Semantic PASS means source-supported meaning, not compliance with every output-role instruction. Each full raw response and accepted snapshot is preserved without correction.

### Microsoft

Correct actual 2026 plan and registration purpose; no invented historical plan or signature-date reference.
Summary: “This Form S-8 registers 226,000,000 shares of common stock to be issued under the Microsoft Corporation 2026 Stock Plan.”
Quantity/security repetition violates discipline even though accurate. The note about the 2025 Directors' Trust and Officers' Trust is supported by E2 but incidental. Approval/effective dates match E7.
No regeneration of authoritative server rows occurred; the duplicated values exist only in model prose.

### Nautilus

Correct two plans, additional/annual-evergreen meaning and all five prior S8 file numbers; no price-date filing confusion.
Summary repeats “an additional 7,588,176 shares of common stock”.
The exact aggregate is expressly present in E5's legal opinion, so this is not evidence of an invented number or proof that the model calculated a sum. It still violates the instruction to avoid repeating direct registration quantities/security facts.
Notes now focus on evergreen and incorporation meaning; v4 price/fee/counsel details are absent.

### Lottery.com

Actual current plan: The Lottery.com 2021 Incentive Award Plan only.
The nonexistent 2023 plan is explicitly denied, never emitted as an entity.
2023-10-11 S8 = current_target; 2022-04-06 S8 = prior_filing.
No 500000 quantity repeated; no fee/price/security-title restatement or new registration row.
Summary's date identifies the prior correction target rather than duplicating the current filing date. Plan-year numbers are names, not quantities.
Summary retains “registered shares are instead issued pursuant to” the 2021 plan in the explicit historical-amendment context. E1 quotes that corrected historical explanatory note. This is not scored as a fabricated current issuance, but is not independent proof of completed/current issuance and must not be promoted into issuance data.
One semantic note preserves the relevant plan-existence denial. Snapshot discipline PASS for this fixed case.

## Verification

- Updated v5 structural/provenance/isolation/runtime suite: 25/25 PASS (one new check plus 24 retained/adapted checks).
- Existing direct-history and S8 Primary/parser/adapter/router: 55/55 PASS.
- Total 80/80 PASS, zero skipped.
- Full TypeScript noEmit/incremental false PASS.
- Primary prompt/adapter diff against local main: zero.
- Source builder/direct-history/generic provider/runner/Primary diff against task base: zero.
- diff check PASS.
- Repeated server direct rows/source fingerprint remain unchanged. All model semantics, including violations, preserved unchanged.
- No browser test: no UI/route changes.
- Singular not called: retained evidence lacks a normal raw/canonical pair; no identity bypass or new DB query.

| Case | Input tokens | Output tokens | Latency | HTTP / finish |
|---|---:|---:|---:|---|
| Microsoft | 6945 | 297 | 2.627s | 200 / STOP |
| Nautilus | 5867 | 601 | 3.399s | 200 / STOP |
| Lottery | 3383 | 346 | 2.486s | 200 / STOP |
| Total | 16195 | 1244 | 8.512s | |

Average 2.837s. Thinking usage not separately reported. V4 output tokens 1943 -> v5 1244 (about 36% lower); input 16087 -> 16195. These single runs do not establish general model performance or production reliability.

## Evidence / resume boundary

Evidence: C:/Users/PC/.codex/visualizations/s8-structured-semantic-v5-20261002/
- ground-truth.md / prior-v4-ground-truth.md: frozen evaluation scope and preserved earlier expectations.
- offline.json / offline-input-review.json / live-start.json: input, code and settings freeze.
- CASE-source-package.json / CASE-request.json / CASE-actual-request.json.
- CASE-raw-response.json / CASE-output.txt: unmodified full provider responses.
- CASE-result.json / CASE-execution.json: snapshots, tokens, latency, timestamps, hashes.
- assessment.json: complete outputs and relevant source blocks with separate Schema/Semantic/discipline judgments.
- tests.txt / typecheck.txt / completion.json / manifest.json.

Original SEC evidence remains in s8-factual-e2e-20261001; all v1-v4 artifacts and commits remain untouched.
Do not automatically tune or rerun. The unresolved issue is reliable adherence to semantic-only prose, not factual correction by code. No numeric stripping, semantic gating or extra model path was implemented.

## Operational handoff

Changed files: lib/ai/s8StructuredAnalyzerPreview.ts; lib/sec-s8/structuredContract.ts; lib/sec-s8/structured.test.ts; this document.
Candidate commit: commit adding this document (git log -1 -- this file).
Permanent main workspace remains C:/Users/PC/Documents/Codex/US-Stock Radar, main only; no repository commands/mutations there.
Local main shared ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b.
Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda; live GitHub state unverified.
Vercel commit/status unverified; no equality/deployment claim.
No DB query/write/migration, account/permission, server, Docker, cron, runtime configuration, Monitor/Alert, UI or external-notification changes. Existing evidence, shared dependencies and credentials preserved.
Existing Gemini credential read only in memory; no secret values saved.
No merge/push/deploy authorized or performed.
