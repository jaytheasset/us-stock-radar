# Round 3 event-only comparison — prepared, provider requests 0

2026-10-15 KST. Same candidate, base `4d9ffe2ca0ebf51809ea86ce026da52bcf4ebedf`, detached. This is only input preparation and offline validation; actual execution waits for main's inspection and execution message. Combined-contract adoption remains deferred. This is not a separate production pipeline.

## Controlled change

The exact round-2 actual user strings are reused byte-for-byte, including 28/7/27 selected source blocks and the same metadata/Router result. Models remain Flash / Flash-Lite / Flash. Temperature 0, thinkingBudget 0, maxOutputTokens 5000 and JSON-schema mode are unchanged.

Only the Primary writing/output task is removed:

- Delete the original Primary system prefix and its scoring/display obligations.
- Retain the round-2 event instruction suffix, replacing only the combined-root announcement, references to Primary/BOTH, and the Primary generic-snapshot reminder.
- Keep root `filing_events`; remove Primary properties from local and provider schemas.
- The entire local `filing_events` schema and the entire actual provider `filing_events` schema are each deep-equal to round 2. Seven types, occurred-only state, ambiguous-occurrence unresolved policy, short quote limit, heading/text field selection, literal dates, non-binding proposal definition and conditional qualifiers remain unchanged.
- No selection change, new source, model change, taxonomy tuning, answer injection or company-specific exception. No evaluation ground truth is included in the model payload. Primary quality is not evaluated in an event-only response.

Per-line old/new instruction diffs and full old/new system strings are in each `*-instruction-diff.json`. Exact current requests and copied actual round-2 requests/responses are separately preserved. Only round-2 original responses are comparison baselines; no repair/adapter output is used.

## Empty-list / instruction-conflict audit

For all three prepared requests, both local schema and **actual provider schema** accept:

```json
{"filing_events":{"coverage":"supplied_current_filing_blocks_only","empty_events_meaning":"not_a_finding_of_no_event","events":[],"unresolved":[]}}
```

Neither events nor unresolved has minItems. Required event fields and enum values apply only to an existing event item. The evidence minItems of one applies only to an existing event/unresolved item and does not require an event to exist. No remaining Primary field/output instruction forces a category. Clear scheduled votes are excluded without forced unresolved; insufficient/conflicting evidence about a real occurrence may be unresolved. A submitted non-binding proposal remains an occurred proposal action, not a signed agreement or closed acquisition.

This is a structural audit, not proof the model will obey the semantics. Residual instruction interpretation risks are deliberately not tuned for this comparison. All-empty output across the three cases would not count as success: actual signing and proposal/consideration-change evidence require independent review for omissions.

The provider still has the unchanged description-only 240-character quote bound, while local schema enforces maxLength. This round does not alter that known transport/local-constraint difference. The earlier Diana 008 quote was valid in its transmitted heading; the wrong-block diagnosis is corrected in the preceding round's evidence and remains part of the comparison history.

## Frozen plan and artifacts

New create-new folder: `C:/Users/PC/.codex/visualizations/sec425-events-only-round3-20261015`.

Plan SHA-256: `d1e928af8f1482331e51961ffad886ae8bf4fb1ca1001eeed8b5b2ba34f18e5c`.

| Case | Model | Source blocks | Identical user SHA-256 |
|---|---|---:|---|
| signed | gemini-2.5-flash | 28 | `141f8f7a31a82d78a9b485f9bd21aacf37a556bd72d6b789133a3b2a38ade432` |
| background | gemini-2.5-flash-lite | 7 | `1faf52c6e202e8740af7a2490099be2bb04557da132471d3295165e61c1f19e6` |
| revised-offer | gemini-2.5-flash | 27 | `18bf4306e6380bb5948e137ae33b7af59e19f15f4a8102b11c26685f9e9ee3f8` |

Source hashes, saved Router hashes, copied original response hashes, prompt/request hashes and generation settings are in plan.json. Source bytes and hashes were verified locally; no new SEC request occurred. The actual ledger is empty, and preparation reads no credential/environment file.

## Minimal single-request guard

`round3-guard.mjs` reuses round 2's durable write/hash helpers and the same bounded lock/reservation pattern, without a new framework or continuation mechanism. `round3-send.mjs` pins this directory/digest and accepts one named case per invocation with an explicit execute flag.

- Create-new/fsynced reservation before actual fetch; one per case, three total including failures. Duplicate/restart/concurrent requests cannot reset the allowance. Stale lock/unknown attempt fails closed.
- One POST to Gemini generateContent, redirect:error, 120-second abort; credential in memory-only header. No Router, baseline, repair, retry, fallback, evaluator model or token-count API.
- Persist numeric HTTP status immediately on headers, then raw response, usage/finish reason and result. No secret header or raw exception text is logged.
- Fully received HTTP 200 single-candidate output with an identified finishReason consumes one slot. Schema/evidence/semantic FAIL, invalid generated JSON or non-STOP generation is retained as output failure and allows only another unsent case. No result is corrected or promoted to PASS.
- Network failure, timeout, HTTP error/redirect, malformed outer provider envelope, missing/ambiguous candidate or finish reason halts without retry. Unknown transmission remains blocked. Output failure alone does not require modifying the guard later.

## Offline checks and pending execution

13/13 tests PASS: exact user/event-schema/settings preservation; empty local/provider schema validity and deliberate minItems conflict detection; unchanged planned-vote/non-binding definitions; unexpected actual payload mismatch; three output failures within cap; generated-JSON failure; complete non-STOP output; HTTP 302/429/503 logging+halt; network halt; plan/request/stale-lock denial; independent-process race and restart duplicate denial. All HTTP in tests is mocked. `offline-tests.log` and `typecheck.log` are external evidence; typecheck/diffcheck PASS.

Only new round3 experiment files and this note are added. Earlier code/evidence, eeb4/main/other worktrees, DB/migrations, environment files, accounts, servers and Monitor/Alerts are unchanged. No new worktree/chat, commit, merge, push or deployment during this preparation checkpoint. Wait for main's exact-plan review; provider request count remains **0**.

Operational handoff remains as supplied: main/GitHub `8a2bb826…` last matched; main's dirty next-env.d.ts preserved; Vercel deployed SHA unverified/no new deployment; prior Render auto-deploy off/cron suspended; remote DB unverified. None were queried or changed here.
