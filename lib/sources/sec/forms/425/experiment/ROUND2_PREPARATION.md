# Round 2 — offline preparation, no provider transmission

Prepared 2026-10-14 KST at candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, starting HEAD `7d4652c3c33a1e2ff449339ff46fef8c6d6012a1`, detached. This is a checkpoint for guard review, not an experiment result. **Actual provider/SEC/DB calls in this preparation: 0.** The old `run.mjs live` is not used. Existing round-1 artifacts and source files remain unchanged.

## Confirmed selection cause and correction of the first review

The existing parser (`selectRouterSourceBlocks`) selects at most four blocks per document: an early substantive lead, an identity block, then role/priority-ranked blocks. The analysis selector retains Router choices plus one adjacent block per side, excludes adjacent boilerplate, and caps the result at 24. Extra material-document selection applies to agreement amendments; route-context selection applies to meeting notices. A revised-offer route receives neither extension.

- Diana 011 is a normal communication block, but the four-block Router bundle omits it. Router-selected 008 has only 007/009 retained by the old adjacent window; 011 lies three positions away. The 24-block cap did not cause this loss (only twelve were selected).
- Diana 067 is marked `legal_boilerplate`/`is_boilerplate=true` despite containing changes in consideration alongside filing guidance. The existing transaction-specific-action vocabulary does not recognize its `increased` statements. It is omitted from the Router bundle and lies three positions before analysis-selected 070. This is a confirmed coverage loss, not proof of the cause of the LLM's omission.
- **Correction:** round-1 HTTP request 14 transmitted the disputed 008 quote verbatim in **heading**. It was absent from **text**, which the original validator alone checked. Calling it a wrong-block citation was incorrect. `round1-heading-correction.json` preserves the actual transmitted heading/text and model quote. Original first-run responses and body-only FAIL results are not overwritten. The other Diana quote differences and the Blue Owl quote difference are whitespace-only; this does not automatically make them exact matches.

The new opt-in context wrapper preserves every formerly selected block, then includes at most three document-order neighbors on each side of each saved Router anchor, including original boilerplate flags without claiming they are facts. It uses no issuer, accession, block-number exception, event keyword or changed-value inference. It never crosses source_ref. Maximum 32 blocks and 24,000 text+heading characters; overflow fails preparation rather than silently dropping source. Radius three is a bounded experiment choice motivated by the observed context loss, not proven general coverage.

| Sample | Old → prepared selected blocks | Prepared text characters | Fixed original model |
|---|---:|---:|---|
| Blue Owl | 12 → 28 | 10,282 | Gemini 2.5 Flash |
| MasterBrand | 3 → 7 | 568 | Gemini 2.5 Flash-Lite |
| Diana/Genco | 12 → 27 | 7,678 | Gemini 2.5 Flash |

Diana 011 and 067 are now present under the general context rule. All original selected text/headings are preserved byte-for-byte. The source documents and SHA values were rechecked without SEC fetches. Existing Router responses are reused; no Router regeneration or new model selection call occurs. Models stay fixed even though context expansion would change the original planner's thresholds.

## Explicit round-2 evaluation changes

- Seven categories are unchanged. `events.event_state` now accepts only `occurred`: a completed submission of a **non-binding** proposal is `proposal_made`, but a future vote is not a shareholder vote **result**, and a proposed acquisition is not a closing.
- Clearly future/scheduled actions are excluded from events; they are not automatically unresolved. Unresolved is reserved for insufficient/conflicting evidence about an asserted or genuinely uncertain occurrence. Empty events still do not prove filing-wide absence.
- Proof adds `source_field: heading | text`. A quote must be an exact, short contiguous span (up to 240 characters) from that field of that exact block. Multiple short spans may cover the required context. Whitespace-only diagnostics are reported separately and never repair or move the quote.
- Literal date/scope must occur in cited spans; reference/format validity still cannot establish semantic correctness.
- Existing Primary instructions/schema remain intact. The experiment explicitly repeats the existing generic snapshot-empty rule and requires preservation of source non-binding/conditional language in both outputs. No value correction, score change, Primary repair function or production prompt is modified.
- Compare against **first combined HTTP responses 4/9/14 only**, not the previous repairs or adapter-derived outputs. New first-response schema, event semantics, exact evidence, Primary material conditions and Primary output rules will be evaluated separately. No claim about quality improvement exists yet.

## Frozen artifacts and request guard

New create-new directory:
`C:/Users/PC/.codex/visualizations/sec425-primary-events-round2-20261014`

Frozen `plan.json` SHA-256:
`94a25902d0589fe7f84cbeb92510043425d64818a2c9cc5f091e0025c860f8f7`

It contains the three exact source/accession hashes, models, old response hashes, saved Router hashes and new prompt/request hashes. Each case has source bytes, copied old first request/response, new complete system+user+schema request and an input diff with every block's preserved/expanded/excluded reason. Original provider generation settings (temperature 0, maxOutputTokens 5000, thinkingBudget 0, JSON schema mode) are unchanged except the event schema. No credential is read by preparation or saved in these artifacts.

`round2-send.mjs` is a new **single-case** entrypoint; it never invokes the old live harness, private retry/fallback provider helper, repair helper, Router, token-count API or evaluator model. It pins the approved directory and plan digest, preventing budget reset by changing the output-folder argument. It verifies source, saved Router, old first-response and new prompt hashes before calling the guard.

At the actual fetch boundary, `sendPreparedOnce`:

1. Checks frozen plan and exact serialized request hash.
2. Obtains an exclusive filesystem lock; stale locks are never auto-cleared.
3. Checks durable attempts/results, the global three-request cap, per-case uniqueness and absence of HALTED/unsettled records.
4. Creates and fsyncs the next immutable reservation **before fetch**. A crash/uncertain transmission consumes that reservation and blocks recovery retries.
5. Calls fetch exactly once to the allowed Gemini generateContent endpoint with POST, `redirect:error`, a memory-only API-key header and a 120-second abort signal.
6. Preserves raw response separately from validation. Transport/HTTP/redirect/non-STOP/parse/schema/exact-evidence failure writes a HALTED receipt and consumes the attempt. No further case may send. Error receipts never include raw exception text or secret headers.

Each later invocation accepts one named case plus the exact digest and `--execute-one-approved-request`; there is no automatic three-case loop. After a successful response, direct source/Primary review remains required before proceeding. Maximum three actual HTTP attempts includes failed requests, not just successful outputs. Mock tests use independent temporary ledgers; the real trial ledger is empty.

## Offline verification and checkpoint

- 19 new offline checks (13 guard, 6 contract/context); combined with existing seven experiment tests: **26/26 PASS**.
- Guard checks include durable pre-send reservation, restart duplicate denial, three-case cap, fourth/unknown denial, two-process race (one mock dispatch), stale lock/unsettled reservation, 429, 503, redirect, invalid JSON, non-STOP, transport failure, output validation failure and tampered plan/request. Failure scenarios dispatch one mock request and zero retries; later requests dispatch zero.
- Five existing 425 regression scripts PASS. Typecheck and diffcheck PASS. No tests invoke live providers, SEC or DB.
- Changes are only new `round2*` experiment files and this checkpoint note. Prior experiment code/results and production code remain unchanged.
- Actual execution is intentionally pending the main thread's guard review and subsequent execution instruction; do not run the send entrypoint during preparation.

Handoff context: local/GitHub main `8a2bb826d38eeca6e0eb071e7017d66e579ba46a` was supplied by main; no remote checks were made here. Vercel prior READY `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`, current deployment SHA unverified. Main next-env.d.ts, eeb4, other worktrees, local/remote DB, Render/cron and servers remain untouched by this work. No merge/push/deploy or full seven-category PASS claim.
