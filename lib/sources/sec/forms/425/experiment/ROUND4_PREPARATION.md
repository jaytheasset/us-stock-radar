# Round 4 combined analysis — prepared, no live requests

2026-10-15 KST. Candidate root: `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`. Base/current HEAD `e6fde48201b5a9e07d6dbebd635bf33d1267bd76`, detached. Round 1–3 files and evidence are unchanged. Only new round4 experiment files are present; no production imports or integrations.

This preparation implements the approved event-classification revision. Main's preparation review is pending; **actual provider requests 0**, SEC fetch 0, Router/baseline/repair/retry/fallback/token-count/model-validation requests 0. No credentials were read during preparation. No DB, server, environment, account, main, eeb4 or Monitor changes. No commit in this preparation turn.

## Contract and boundaries

The original Round 2 **combined Primary + filing_events** request is the control. All original system instructions are retained as an exact prefix; the new instructions are appended and scoped to filing_events. User content, metadata, saved Router result, Primary schema and generation settings are unchanged. Round 3 event-only results are contextual reference, not a controlled combined comparison.

Only the event item contract changes:

- Existing `statement` remains an event explanation. No forced literal replacement, code reconstruction or summary-derived events.
- `actor.name/role` identifies the acting party, rather than merely the publisher. `target.description/category` identifies the action's object (business combination versus own-share repurchase versus proxy/meeting process, etc.).
- Existing `event_state` is explicitly action occurrence. The schema can express `occurred`, `scheduled`, `conditional_future` or `unknown`; the occurred-event validator reports the latter three as non-passing, without correction or deletion. The prompt still excludes clearly future actions from events and does not force them into unresolved.
- `transaction_status.binding`, `.completion`, and `.conditions` separately retain stated binding/non-binding, completion and conditional status. Unknown source information stays `not_stated`/null. An actually submitted non-binding proposal or issued conditional approval can be an occurred action while the acquisition remains incomplete.
- Event evidence gains `purpose=action|transaction_qualification|both`. Every event needs action evidence; an explicit transaction-status assertion needs qualification evidence. The statement and source spans coexist. The validator does not infer semantic support from a purpose label.
- Existing `disclosure_context` preserves current versus prior background. Earlier events are not promoted to newly announced events, and current conditions are not automatically applied to historical actions.
- Original seven kinds/actions, dates, decision scope and unresolved structure remain. No company names, filing IDs or source-keyword classifiers appear in the contract logic.

Local mechanical validation reports enum contradictions, missing evidence purpose, and unconfirmed required actor role. A regulator/court/vote result with role unknown is incomplete, not a pass; no role is filled in. Actual conditional/partial decisions, signing, withdrawal and termination remain representable.

## Independent assessments

1. Full combined schema and Primary-only schema, each with its own errors.
2. filing_events structural validation independent of Primary failure. Diagnostic quote-maxLength removal applies only to a cloned diagnostic schema; it does not alter the real schema/output or acceptance result.
3. Enum consistency and evidence-purpose diagnostics, without natural-language interpretation.
4. Exact source-field citation, length and literal binding; whitespace-only matches remain failures, with a diagnostic flag. No relocation, normalization or repair.
5. **Direct SEC-source semantic assessment remains UNREVIEWED until live output exists.** An intentionally wrong synthetic closing statement with internally consistent labels and an exact proposal quote passes mechanical checks; the test documents this limitation rather than claiming automatic semantic detection.

The prior local numeric quote limit (240) versus provider description-only limit is preserved, as are existing wire/local array-bound differences. This trial does not mix citation enforcement changes into event classification. Long/whitespace-different citations and event meaning will be reported separately. Full acceptance cannot ignore either failure. Empty output is schema-valid but missing positive events is a recall failure.

## Frozen requests

Create-new evidence directory:
`C:/Users/PC/.codex/visualizations/sec425-primary-events-round4-20261015`

Plan SHA-256: `0f361dd49831e6b480a8a14701c30bcbd70a3032997a8c159afbbc6e125042b2`.

Each case has exact source bytes, saved Router, Round2 prompt/request/response copies, Round4 prompt/request and a `*-diff-audit.json` including both event schemas and allowed changes. `plan.json` records source/request/prompt/user hashes and settings. Ledger is empty; no Round4 response exists.

| Case | Accession | Model | Blocks | User payload SHA-256 (same as Round2) |
|---|---|---|---:|---|
| Blue Owl / signed | 0001193125-25-267134 | gemini-2.5-flash | 28 | 141f8f7a31a82d78a9b485f9bd21aacf37a556bd72d6b789133a3b2a38ade432 |
| MasterBrand / background | 0001193125-25-220725 | gemini-2.5-flash-lite | 7 | 1faf52c6e202e8740af7a2490099be2bb04557da132471d3295165e61c1f19e6 |
| Diana / revised-offer | 0001104659-26-075214 | gemini-2.5-flash | 27 | 18bf4306e6380bb5948e137ae33b7af59e19f15f4a8102b11c26685f9e9ee3f8 |

Temperature 0, thinkingBudget 0, maxOutputTokens 5000, JSON schema response and 120-second timeout are unchanged. Added output fields may increase token demand; the cap is not raised. Truncation consumes the case and is reported, never retried.

`round4-guard.mjs` is the preserved Round3 guard with only exported function and plan-version names changed. It durably reserves before fetch, locks across processes, binds plan/request hashes, caps total requests at 3 and prohibits repeating a case across restart. Numeric status and exact raw responses are retained. Complete output failures consume a slot but allow another unsent case; HTTP/transport/protocol uncertainty halts. No retry, continuation, fallback or stale-lock reset. `round4-send.mjs` pins this exact directory/digest and accepts one explicit case per invocation; it has **not been executed**.

## Acceptance checks for subsequent source review

The preserved sources were re-read offline; these are review criteria, not model-output results.

- Blue Owl 056: signing is supported; preserve parties and Adviser's limited-purpose involvement. 056/489/490/491 are four corporate-board approvals, not regulator/court decisions. 1504 describes current/historical own-share repurchase programs, not target acquisition proposals. Require signing recall, removal of all six Round3 false positives and no new proposal from conditional merger mechanics. 1505 closing remains future/conditional.
- MasterBrand 007/009: proxy was filed; shareholders will vote at a later meeting. Require **zero result events**; scheduled actions need not be forced into unresolved. An empty list is valid here, not evidence of complete absence across all filings.
- Diana 011/045/067: preserve current revised proposal and consideration change with applicable non-binding/definitive-agreement conditions on each. Two historical actions, if returned, must remain prior_background; do not claim they are new. The current offer is not a completed acquisition. Check cash/share details and adjustment conditions against source, without computing or correcting values.
- Assess Primary output contract and preservation of important qualifications separately, including generic-display empty snapshot requirements. No seven-category-wide factual PASS from three samples.
- Preserve the previous correction: Round1 Diana008 quote exists in the transmitted **heading**; it was not a wrong block ID. Round3's eight whitespace-only mismatches are not fabricated quotations.

## Offline checks completed

- New Round4 contract/guard tests: **24/24 PASS**.
- All experiment suites (Round1–4, guard/continuation included): **72/72 PASS**.
- Existing 425 parser/router/analysis/adapter/fetchPlan scripts: **5/5 PASS**.
- Typecheck: PASS, `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Diff/whitespace: PASS; new files checked separately because they are intentionally untracked before Main review.

Commands from the candidate:

```powershell
node --no-warnings --experimental-strip-types --test lib/sources/sec/forms/425/experiment/round4.test.mjs lib/sources/sec/forms/425/experiment/round3.test.mjs lib/sources/sec/forms/425/experiment/round2.test.ts lib/sources/sec/forms/425/experiment/combined.test.ts lib/sources/sec/forms/425/experiment/round2-guard.test.mjs lib/sources/sec/forms/425/experiment/round2-continuation.test.mjs
node --no-warnings --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --experimental-strip-types --test lib/sources/sec/forms/425/parser.test.ts lib/sources/sec/forms/425/router.test.ts lib/sources/sec/forms/425/analysis.test.ts lib/sources/sec/forms/425/adapter.test.ts lib/sources/sec/forms/425/fetchPlan.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

## Handoff limits

Per Main handoff, local main last confirmed `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; this preparation did not query main. Main's user-owned `next-env.d.ts` remains outside this task. GitHub main was last reported equal but not queried this turn; Vercel deployed SHA/runtime and remote DB are unverified. No deployment equality or operational completion claim. No UI/API/viewport acceptance applies to an unconnected experiment.

The new six files are preparation changes only; no live result, production-readiness or integration PASS. Stop for Main's frozen-request/guard review before executing the three bounded requests.
