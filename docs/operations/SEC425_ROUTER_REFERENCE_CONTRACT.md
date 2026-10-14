# Diana Router source-reference contract — one-call verification

2026-10-15 KST. Base `909a97af5b875a25d8dff9a87d7d1266b8c4c61f`, existing detached candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`. Scope: remove the redundant Router quotation contract that failed at480/300 characters. Veeco/CIK identity, SEC parser, source selection, Primary scoring and other routing policies are unchanged. No legacy-data repair/backfill.

## Reproduction and consumer trace

Before editing, replayed the preserved actual Diana Router response against its saved v7 local schema. It failed only `/evidence/2`, length480 versus300; other lengths124/289/158. Existing instructions already requested short reasons rather than long quotations, so this was not a missing-instruction claim. Saved failure files were read-only.

`selected_source_block_ids` already determines Primary's source selection. Existing selection adds adjacent same-document context; on the failed response's four selections it produces12 original blocks, including045 non-binding language. The free-text Router `evidence` was not needed to select those blocks. `buildSec425DisplayPayload` previously prepended that model evidence to display evidence; deterministic archive uses the same display builder. Primary also received the model evidence again inside `router_result`, duplicating source material.

## Minimal contract change

- Router v8 removes the model `evidence` field and its requirement. It uses the existing `selected_source_block_ids` / `source_blocks_used` references. No larger quote limit, truncation, repaired quote, new event rule or route-policy tuning.
- All other Router fields, schema limits and routing instructions remain unchanged. The preparation audit verifies exactly the evidence-field removal plus debug version change in local/wire schemas, one corresponding instruction replacement, identical Router user input bytes and identical generation settings.
- `inspectSec425RouterReferences` rejects obsolete evidence, missing/invalid reference arrays, unknown IDs and ambiguous/missing full-source IDs. `normalizeSec425RouterResult` rejects those **before** its existing normalization; unknown IDs can no longer disappear through filtering and become a successful result. Existing route, score, display-family and archive decisions are otherwise untouched.
- Display resolves selected IDs to original source fields locally. `router_source_evidence` retains block ID, source reference, URL, heading and text. The existing plain display evidence contains source text/headings, not IDs masquerading as quotations. Source fields are neither shortened nor reconstructed from a model quote. Presentation joins headings/text; their exact individual fields remain in the structured source evidence. This source resolution is not model-output repair.
- Primary's source selection function and prompt were not changed. New Router output contains no repeated evidence quotations, while `cleaned_source_blocks` remains the original source and context. Archive/display data consumers have direct regression coverage; no browser/UI claim is made.

The internal optional `evidence` type permits prebuilt test objects, but the new model schema and reference guard reject this field. There is no old-response upgrade, stored-data conversion or fallback path.

## Offline checks before the one request

Evidence root: `C:/Users/PC/.codex/visualizations/sec425-router-reference-once-20261015`.

- `BEFORE-REPRO.json`: actual old480/300 failure, preserved response hashes and baseline12 Primary blocks.
- `OFFLINE-CHECK.json`: a clearly labeled **synthetic reference-only fixture**, not a claimed new model response, omits the obsolete field to test the new contract. Its selected IDs, Primary block array and selection metadata are identical to the baseline. Source045 survives unchanged. Original saved model response remains untouched.
- Direct tests cover obsolete quotation rejection without cutting, unknown ID in either reference array before normalization, exact source resolution, display provenance/no ID-as-quote, unchanged Primary context and deterministic archive consumption.
- Single-slot guard tests cover success, schema failure, transport failure, HTTP error, incomplete generation, restart and concurrent reservation. Every attempted transmission consumes the sole slot; no result releases it.
- Related regressions54/54; experiment/guard regressions120/120; typecheck/diffcheck PASS before execution. Identity/parser regression expectations were retained; identity and parser files have zero diff from this task's base.

## Exact one-call plan and actual result

New plan `trial/plan.json` SHA `e6f5d9d07858e5ff2eae667c7f9bb29312ebbfe637d86bbb232a267568f16ae8`. New `trial/ledger/attempt.json` was exclusively created and fsynced before transmission. Previous `sec425-veeco-stage-trial-20261015` HALTED ledger and its remaining slots were not resumed or modified.

Model **gemini-2.5-flash-lite**, maxOutputTokens5000, temperature0, thinkingBudget0; 120-second diagnostic abort limit. Router source user input and all generation settings are byte/value identical to the failed trial. Only the approved output contract/instruction/version changed. No SEC request or source refresh.

**Exactly1 provider HTTP request → HTTP200, finishReason STOP, mechanical schema/reference PASS.** Input5,764 / output509 / total6,273 tokens, latency2,542ms. No `evidence` field was returned. No retry, repair, fallback, baseline, token-count API, Primary, FACT or Axcelis model call.

Raw selected IDs and `source_blocks_used` both:

```text
425_primary_008
425_primary_019
425_primary_070
425_primary_044
```

These are exactly the previous four selections. Offline Primary input contains the same12 blocks (007/008/009,018/019/020,043/044/045,069/070/071), with exact original heading/text and selection metadata. In particular,045 preserves that no binding agreement or obligation exists unless/until a definitive agreement is executed;070 retains conditional future second-step merger language. No actual Primary request was made.

### Mechanical versus source-quality findings

- **Mechanical PASS**: new schema, no obsolete quotation field, all references valid, zero unknown-ID filtering, original model response preserved.
- **Narrow route/source preservation PASS**: `acquisition_offer_or_proposal` / `proposal`; both `material_update_reason` and `routing_reason` describe a **revised** offer. The earlier new/revised wording inconsistency is absent in this single response. No signed/completed transaction is claimed. Selection and original contextual evidence are preserved.
- **Limits**: the short material-update explanation says $27.34 per share without the word “implied”; the original019 block retains “total implied value,” and008 retains the share-valuation/VWAP basis. The unchanged12-block selection does not include every tender condition, such as the full068 block. This is not complete financial-condition extraction or proof of downstream Primary/FACT quality.
- **Raw versus normalized metadata**: raw `needs_analysis_llm=true` with `deterministic_stage="router"`; the existing normalization changes deterministic_stage to null and adds `selected_source_block_ids_normalized=false`. Both raw and normalized files are saved separately. This pre-existing policy inconsistency/normalization was not silently presented as a new raw response, fixed or retuned.

Cost estimate from the **historical2026-10-14** preserved Flash-Lite Standard rates ($0.10/M input, $0.40/M output): **$0.0007800**. Current pricing and actual invoice remain unverified. Token counts and latency are actual response/receipt values; no token-count request was made.

## Final preservation and boundary

`FINAL-EVALUATION.json` records raw/normalized differences, exact12-block comparison, local/reference validation, source-quality limitations and historical cost basis. All new frozen plan artifacts, including old requests/responses/inputs and the old HALTED ledger, remain hash-identical. The previous plan's code hashes continue to describe its historical commit; this task intentionally changes Router/display code, not those historical experiment files.

No Veeco identity or parser modification; no DB reads/writes, storage, Monitor/Alert connection, UI/browser/login, environment changes, main/3110/Docker operation, merge/push/deploy. Local main last confirmed ref `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; main's existing next-env user edit untouched. GitHub/Vercel actual commits/runtime, remote DB/env/cron unqueried.

Commands use the existing absolute file-URL `scripts/resolve-ts-paths.mjs` and `scripts/resolve-server-only.mjs` loaders on Windows, Node `--experimental-strip-types --test` (experiment suite uses its existing `runtime-loader.mjs`), `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and `git diff --check`. Exact logs, one-call scripts and receipts are outside Git in the evidence root.

This completes only the Diana Router reference-contract acceptance check. **Stop after the local candidate commit; no Primary/FACT/whole-product or merge-readiness PASS.**
