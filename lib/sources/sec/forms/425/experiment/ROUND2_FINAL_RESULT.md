# Round 2 final comparison — three requests consumed, acceptance failed

This final record supersedes the **execution status**, not the evidence, of the first-request halt and continuation preparation notes. Original first-run artifacts, `attempt-1/result-1/HALTED`, failed validations and fixed inputs remain unchanged. No response was repaired or adapted, and no further provider requests will be made in this trial.

## Scope and actual execution

- Base: `7d4652c3c33a1e2ff449339ff46fef8c6d6012a1`, same detached `sec425-primary-events` candidate.
- Source, saved Router, three requests/prompts and plan hashes verified unchanged. Plan SHA: `94a25902d0589fe7f84cbeb92510043425d64818a2c9cc5f091e0025c860f8f7`.
- Exactly **3 actual provider requests**, one per filing. New Router/baseline/repair/retry/fallback/model evaluation/token-count API/SEC network/DB access: **0**.
- After the first response failed schema validation, the original guard halted all cases. Main reviewed a narrow append-only continuation binding the original failure and frozen plan. `continuation-1.json` was then appended using reviewed proposal SHA `02d12cda38bbdea733e5b0dbdd980b6cf8b4b39fa02a944fd94cb7a605c80f54`. No halt or failed-result record was deleted or changed, and signed was not retried.
- First numeric HTTP status remains unrecorded/null; original control flow proves successful 2xx + STOP. Requests 2/3 have observed HTTP 200 + STOP. The continued guard records settled output-validation failures as FAIL while allowing only the other unsent case; transport/unknown failures still halt. Total allowance is now exhausted.

## First original response versus first new response

The only baselines are retained combined HTTP **4 / 9 / 14**. Previous separate baseline calls, Primary repairs and adapter-adjusted scores are excluded from this performance comparison.

| Case | Original combined | New combined | Assessment |
|---|---|---|---|
| Blue Owl / signed | Signing event supported; quote whitespace mismatch | Signing event supported with exact 226-character body quote; additional occurred `proposal_made` from conditional future merger mechanics | Extra category/action is a semantic false positive. Its exact quote is 524 characters, exceeding 240. Signing date_literal substitutes a space for source newline. |
| MasterBrand / background | Future meeting incorrectly classified as vote result, but state was proposed | Future meeting and prior proxy filing both classified as occurred vote results | **Semantic worsening:** neither is an actual voting outcome. Both quotes are exact; valid quote references do not validate the event category. |
| Diana/Genco / revised offer | Proposal extracted, consideration_changed absent | Proposal cites 011 and consideration_changed cites 067, both exact body text | **Limited content improvement:** current revised economics now separately extracted from the newly supplied blocks. Long 641-character quote and date-literal newline mismatch fail the contract. |

Source conclusions:

- Blue Owl 056 says an agreement was signed and describes future conditional two-step merger mechanics. Those mechanics are not a separately submitted acquisition proposal. No completed merger was asserted.
- MasterBrand 009 says shareholders **will** vote and identifies an already-filed proxy statement. Scheduled voting and proxy filing are not vote results, regardless of a model returning `event_state:occurred`.
- Diana 011 explicitly announces an increased offer; 067 explicitly describes the June 17 revised cash/share consideration. Both became available through the general bounded context expansion and both are cited in the new output. This establishes an observed extraction improvement; input expansion, instructions and schema changed together, so isolated causality is not proven.
- The prior claim that Diana 008 was a wrong-block citation is corrected: the old HTTP 14 payload transmitted its quote verbatim in **heading**. The old validator inspected only **text**. Original results remain preserved, with the correction in `round1-heading-correction.json`.

## Independent checks, without converting FAIL to PASS

| Check | Signed | Background | Revised offer |
|---|---|---|---|
| Full new JSON schema | FAIL | FAIL | FAIL |
| Primary-only schema | FAIL: key_evidence/watch lists each 4 > 3 | FAIL: one key_evidence string > 180 | FAIL: three key_evidence strings > 180; source_blocks_used 27 > 12 |
| Event-only schema | FAIL: 524-character quote | PASS | FAIL: 641-character quote |
| Exact quote substring | Both exact | Both exact | Both exact |
| Literal-date binding | FAIL: November newline | PASS | FAIL: June 17 newline in second event |
| Intended event meaning | Extra false proposal action | Two false vote-result actions | Proposal and revised consideration supported; qualifier omission remains |
| Generic snapshot rule | PASS | PASS | PASS |

All **six** new quotes are exact substrings of the stated body blocks, but quotation length, date-literal binding and semantic correctness are separate checks. Overall acceptance is **0/3**. Clear planned events should be excluded rather than automatically unresolved; the new model did not follow that rule in MasterBrand. No empty-events live case was produced.

## Primary quality and important conditions

- Raw scores versus the original combined responses are unchanged: **75→75 / 65→65 / 75→75**. No adapter scores are used.
- Generic snapshot output is empty in all three new outputs, versus only signed in the old first combined outputs. This is a narrow output-rule improvement, not overall quality PASS.
- Signing and conditional/expected Q1 2026 closing remain explicit in Blue Owl. Additional stock-repurchase detail is present, but Primary list lengths violate the original schema.
- Diana supplied block 045 explicitly says the proposal is non-binding and creates no obligation until a definitive agreement. Full recursive inspection of Primary string fields found **no explicit non-binding wording in either the old combined HTTP 14 or the new output**; new event statements also omit it. However, both Primary outputs retain `could lead to a definitive agreement`, and the new output preserves the separate no-financing-condition statement. Therefore do **not** call this loss of every important condition or a newly introduced omission versus the first combined baseline. Explicit non-binding preservation remains unmet.
- Existing provider-schema conversion omits maxItems for the two Primary lists, and the new quote maximum is provider-visible description text rather than a numeric maxLength constraint. The independent local schema still enforces the limits. This enforcement gap is confirmed; it is not proven to be the sole cause of output overruns. No shared converter or correction behavior was changed.

## Usage, cost and timing

| Case | Model | Input | Output | Attempt latency | Estimated paid USD |
|---|---|---:|---:|---:|---:|
| Signed | Gemini 2.5 Flash | 9,946 | 1,671 | 8.735 s | 0.0071613 |
| Background | Gemini 2.5 Flash-Lite | 5,075 | 1,276 | 4.413 s | 0.0010179 |
| Revised offer | Gemini 2.5 Flash | 9,250 | 2,135 | 9.867 s | 0.0081125 |
| Total | | **24,271** | **5,082** | **23.015 s** | **0.0162917** |

Reported total tokens: 29,353; no thinking tokens reported. All responses STOP. Cost uses [Google Standard paid-tier rates](https://ai.google.dev/gemini-api/docs/pricing) verified 2026-10-14 (Flash $0.30/$2.50, Lite $0.10/$0.40 per million input/output). It is an estimate; actual invoice/credits were not queried.

## Verification, artifacts and remaining limits

Evidence: `C:/Users/PC/.codex/visualizations/sec425-primary-events-round2-20261014/FINAL-ROUND2-EVALUATION.json`. Exact source bytes, prompts, schemas, requests, three raw provider responses, validations, original first-response copies, all ledger records and continuation fingerprints are in that folder. Original round-1 directory is untouched.

35/35 offline tests are preserved in `continuation-tests-35.log`; existing five 425 regression scripts, typecheck and diffcheck pass. Only opt-in experiment files/docs change; product paths, eeb4, main, other worktrees, DB/migrations, servers, Monitor/Alerts and environment files remain unchanged. No new worktree, branch switch, merge, push or deployment was performed.

Remaining limits: seven types are not validated; actual vote results, regulatory/court decisions, closings, termination/withdrawal and Router skip misses remain untested. Heading citations are supported by the contract/offline test, but these new live outputs selected text citations only. The trial does not demonstrate no-quality-degradation or production readiness.

Next smallest proposed work (not performed): offline error classification and contract review for action versus agreement mechanics, scheduled vote versus result, and provider-visible bounds. No further prompt/guard/schema tuning or provider call is part of this completed trial. Await independent review.
