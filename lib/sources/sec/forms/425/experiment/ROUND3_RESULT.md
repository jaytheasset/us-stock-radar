# Event-only comparison: three requests complete, acceptance 0/3

2026-10-15 KST. Baseline is the **raw round-2 filing_events region only**; round-2 Primary formatting, repairs and adapter results are not included in the event-only comparison. No output was corrected and no model was rerun.

## Controlled input and execution

- Actual user payload strings are byte-identical to round 2 (selected blocks 28/7/27, metadata and Router result unchanged).
- Local and actual-provider filing_events schemas are identical to round 2. The original Primary task/system prefix and Primary output/schema fields were removed; remaining event instructions were changed only to remove Primary/BOTH references. Per-line diffs are preserved.
- Models Flash / Flash-Lite / Flash, temperature 0, thinkingBudget 0, maxOutputTokens 5000 and provider JSON-schema settings remain fixed.
- The main thread independently reviewed plan SHA `d1e928af8f1482331e51961ffad886ae8bf4fb1ca1001eeed8b5b2ba34f18e5c` before execution.
- Exactly **3** actual HTTP requests: one per filing, each HTTP 200 / STOP. Router, baseline, repair, retry, fallback, evaluator-model, token-count API, SEC network and DB access **0**. Complete output FAILs stayed FAIL and did not prevent the other unsent cases. All three slots are consumed; no further trial requests are authorized.

## Direct source comparison

| Case | Round 2 events | Event-only result | Source assessment |
|---|---:|---|---|
| Blue Owl / signed | 2: signing + false proposal from merger mechanics | 7: signing, four regulatory decisions, two acquisition proposals | Signing supported. Four corporate-board approvals are **not regulator/court decisions**. Current/historical own-share repurchase programs are **not acquisition proposals for a target company**. Six categorical false positives. |
| MasterBrand / background | 2 false vote outcomes: future vote and proxy filing | 1 occurred vote_result for future meeting/vote | Proxy-filing false positive disappears, but **future voting remains misclassified as an occurred result**. No actual vote outcome is stated. |
| Diana/Genco / revised offer | 2 current events: revised proposal and consideration change | 4: two current events plus May 27 price change and May 4 tender-offer commencement marked prior_background | Current actions supported by 011/067. Prior actions are directly stated in the same current source067 and correctly marked prior_background; they are not inferred first occurrences or compared with another filing. No transaction completion is asserted. |

Evidence anchors:

- Signed 056 establishes signing. Blocks 056/489/490/491 describe corporate-board decisions, not an external regulator or court. Block1504 describes OBDC's own-share repurchases. The filing's legal/regulatory wording does not make its boards regulatory authorities.
- Background 009 says shareholders **will** vote at a future meeting. Both local/provider schemas permit empty events/unresolved, but the model still emits a vote result. This is a semantic error, not a structural requirement to emit an event.
- Diana 011 establishes the current increased proposal; 067 states current and historical consideration/tender actions. Block045 states that the indication is non-binding and imposes no legal obligation until a definitive agreement. The new proposal statement explicitly preserves **non-binding** and cites 045. Its separate consideration statement does not repeat that qualifier, so do not claim every event statement independently retains all conditions.
- Blue Owl's signing quote retains the Adviser's limited-purpose role; the short statement does not repeat that qualification. Signing support does not validate the other six categories.

## Schema, evidence and semantic checks remain separate

| Check | Signed | Background | Revised offer |
|---|---|---|---|
| Event-only schema | FAIL: five quotes > 240 chars | PASS | FAIL: three quotes > 240 chars |
| Exact source quote | 0/7 exact; 7 whitespace-only differences | 0/1 exact; 1 whitespace-only difference | 10/10 exact |
| Literal present in its quoted span | PASS | PASS | PASS |
| Event meaning | One supported signing, six false categories | Future-vote false positive | Two current and two explicitly historical actions supported |
| Complete acceptance | FAIL | FAIL | FAIL |

There are **18 citations**: eight have only whitespace/newline differences and ten are exact. None of those eight should be described as a fabricated quote or wrong block ID. No normalization was applied to accept or repair them. Literal-in-quote validity does not erase a quote-to-source mismatch. The local 240-character rule still fails despite otherwise exact Diana quotations (641, 361 and 357 characters among the offending spans).

Schema PASS is **1/3**, also 1/3 for the round-2 event subtree—not an improvement obtained by dropping failing Primary fields. Complete evidence/meaning acceptance remains **0/3**. No sample returned empty events; therefore this result did not avoid positive cases by returning all-empty lists. Unresolved is empty in all three responses.

Historical correction retained: the round-1 Diana008 citation existed verbatim in the transmitted **heading**. The original text-only validator missed that evidence field; the earlier wrong-block diagnosis was incorrect. Round 3 allows heading/text explicitly but all actual new citations use text.

## What the comparison supports and does not support

Event-only generation did not eliminate category false positives with the same source input/settings in these samples. Therefore Primary writing requirements cannot be treated as the sole explanation for the observed errors. Signed false positives increased; background's false-positive count fell from two to one but the key error persisted; Diana's explicit non-binding preservation improved. These observations are not proof of a universal causal mechanism or evidence that a separate production pipeline is necessary.

Primary writing quality is **not evaluated** in this event-only trial. All seven event types are not validated; genuine vote outcomes, actual regulator/court decisions, closing and termination/withdrawal remain untested. Prior-background extraction is supported here only for Diana's source-stated historical actions.

The provider still receives the unchanged description-only quote-length bound, while local schema enforces numeric maxLength. Its enforcement gap is retained for a controlled comparison; it is not established as the sole cause of quotation length or semantic errors.

## Actual usage and cost

| Case | Model | Input tokens | Output | Thinking | Latency | Estimated paid USD |
|---|---|---:|---:|---:|---:|---:|
| Signed | Gemini 2.5 Flash | 6,927 | 1,747 | 0 reported | 8.617 s | 0.0064456 |
| Background | Gemini 2.5 Flash-Lite | 2,056 | 285 | 2 | 1.456 s | 0.0003204 |
| Revised offer | Gemini 2.5 Flash | 6,231 | 1,361 | 0 reported | 6.765 s | 0.0052718 |
| Total | | **15,214** | **3,393** | **2** | **16.838 s** | **0.0120378** |

Provider total tokens: 18,609. Paid Standard estimate uses the [official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) verified 2026-10-14: Flash $0.30/$2.50 and Lite $0.10/$0.40 per million input/output, including thinking. Account credits/tier billing and invoice are unverified. Round 2 used 24,271 input / 5,082 output tokens and 23.015 seconds across its three calls; reduced token use is not a factual-quality PASS.

## Evidence, verification and stop

External evidence: `C:/Users/PC/.codex/visualizations/sec425-events-only-round3-20261015`. `FINAL-ROUND3-EVALUATION.json` contains immutable-input checks, old/new event outputs, schema errors, exact/whitespace diagnostics and usage. Full source bytes, old/new requests, instruction diffs, raw responses, HTTP statuses and all three durable attempt/result pairs are retained. Earlier round1/2 evidence and code are unchanged.

13/13 new offline tests PASS, typecheck/diffcheck PASS; existing five 425 regression scripts PASS. Only new opt-in round3 files/docs are added. No product pipeline, Monitor/Alerts, DB/migration, environment/account, server, eeb4/main/other-worktree, merge/push/deploy changes.

Next smallest proposals only: review the seven categories' inclusion/exclusion boundaries and the provider-visible quotation limits offline. No further prompt/schema/model/source tuning, provider call or production separation is authorized or performed in this trial. Await independent review.
