# Narrow continuation guard — awaiting main review, no additional provider calls

This checkpoint follows the first `signed` response's schema failure and the main thread's clarification that the original three-filing budget may include settled output failures. It does not change input, schema, evaluation criteria or the first failure verdict.

- Actual requests consumed: **1**; additional requests during this checkpoint: **0**.
- Original `attempt-1.json`, `result-1.json`, `HALTED.json`, raw response, validation, frozen plan, prompts/requests, Router and source bytes remain unchanged.
- No actual `ledger/continuation-1.json` has been written. The proposal alone cannot bypass HALTED.
- Proposal: `C:/Users/PC/.codex/visualizations/sec425-primary-events-round2-20261014/CONTINUATION-PROPOSAL.json`.
- Proposal SHA-256: `02d12cda38bbdea733e5b0dbdd980b6cf8b4b39fa02a944fd94cb7a605c80f54`.
- Frozen plan SHA-256 remains `94a25902d0589fe7f84cbeb92510043425d64818a2c9cc5f091e0025c860f8f7`.

## Proof and exact HTTP limitation

The proposal binds hashes of the first attempt/result/HALTED, first raw response/validation, plan, signed request/prompt, and the exact original guard source snapshot. It reparses the complete STOP response and independently reproduces the unchanged schema failure with Ajv.

The original failure receipt omitted numeric HTTP status. The unchanged original guard (`guard-at-first-attempt.mjs`, SHA `4f13e82fc5f44131b55684d6ed2d195b12276444da891fb566abb8bbb2696fe6`) reaches validation only after `response.ok` and STOP. This supports **successful 2xx + STOP**, not an observed numeric 200. Accordingly the proposal records `httpStatus:null`, the control-flow proof, and `originalVerdict:FAIL`. Main must review this exact proof basis; no fabricated 200 receipt is introduced.

## Minimal runner behavior

`appendReviewedContinuation(directory, exactProposalSha)` is a separate no-network, append-only action after main reviews the proposal. It uses the same exclusive lock, requires exactly the one existing reservation, revalidates every proof hash and adds only `ledger/continuation-1.json`. It cannot reset the allowance or permit signed to run again.

With that exact record present, the guard may permit only the two previously unsent cases. Future responses must have observed HTTP **200**, one complete candidate and STOP. A local schema/evidence FAIL remains `output_validation_failed`, with raw response, usage and exact hashes retained; it consumes its slot but does not prohibit the other unsent case. Nothing turns FAIL into PASS.

Network errors, timeout, non-200 (including 201/302/429/503), unknown/incomplete responses, parse failure and unrecognized receipt state still halt. A subsequent transport halt is appended as `HALTED-2.json` or `HALTED-3.json`; original HALTED is never overwritten. Per-case uniqueness, global three reservations, create-new fsynced reservation before fetch, redirect:error, concurrency lock and restart checks are retained. The old `run.mjs` and production retry/repair functions remain unused.

## Offline validation

35/35 tests pass: original seven experiment tests, six round-2 contract/context tests, thirteen original guard tests, and nine narrow continuation tests. New tests show proposal-only blocks all calls; explicit append preserves old receipts; two unsent mock cases may each fail output validation once; signed/duplicates/fourth attempts remain blocked; non-200 and timeout halt; altered original evidence invalidates continuation; missing HTTP evidence without the exact guard proof fails closed. All sends in tests are mocks, with separate temporary ledgers.

Typecheck and diffcheck pass. Existing five 425 regression scripts passed earlier in this round; no shared production file has changed. The provider-visible schema omission of Primary list maxItems and description-only quote length remains documented in `ROUND2_RESULT.md`; neither input nor schema is altered by this guard checkpoint.

Stop here for main guard review. Do not append the actual continuation or send background/Diana during this checkpoint. eeb4/main/other worktrees, servers, DB, migrations, accounts, environment files and deployment remain untouched.
