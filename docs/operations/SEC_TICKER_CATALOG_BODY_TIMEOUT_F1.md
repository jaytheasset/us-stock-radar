# SEC company catalog F1 — total request/body timeout

2026-10-06. F1-only candidate verification; independent GPT re-review pending.

## Candidate and scope

- Existing workspace: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
- Base: `a01a7e663b98d44547e673063abe10b5d06a449e`, detached / clean at start.
- Phase 1/2 commits preserved; no branch/worktree replacement or reset.
- User's earlier local-main reference is `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`;
  current main, GitHub main, Vercel, DB and cron state were not queried.
- Product change only in `loadCompanyCatalog()` in `tickerCatalog.ts`.
  Cache helper, exchange `secFetch`, other `timedFetch` callers, wrapper/API/probe,
  source separation, TTL, search/identity policies and unrelated features unchanged.
- F2 search-error presentation, real Next/browser verification and stage 3 remain
  outside this change. No integration/deployment or production-equality claim.

## Defect classification and minimal fix

The pre-stage-2 company reader used `timedFetch`, whose `finally` cleared the
abort timer after fetch returned headers, before its caller read JSON. This
inherited body-timeout weakness is visible at stage-1 commit
`0fec36e4da1a261029882ce110ce4f7b275f6f1d:lib/integrations.ts`.
Stage 2 retained that weakness, but its shared `inFlight` additionally made
subsequent requests join the hung body read. That amplification is the new
regression. The old implementation was inspected, not executed again here.

The fix moves HTTP-status handling, full JSON consumption and validation inside
the existing timer's `try/finally`. There is still exactly one 15,000ms timer and
no retry; headers or new body chunks do not start a new budget. Abort cancels the
native request/body stream. An explicit post-JSON `throwIfAborted()` prevents an
already-cancelled completion from being returned as success. No Promise.race or
cache-helper redesign is involved.

## Native streaming reproduction

`scripts/verify-sec-catalog-body-timeout.mjs` uses Node **v24.15.0**, real wall
time, native fetch/Response and an ephemeral `127.0.0.1` HTTP server. Only within
that process, the two exact SEC catalog URLs route to loopback; other fetch URLs
are rejected. All companies, CIKs and tickers are synthetic. No SEC request,
environment-file change, Next server, DB, Docker or provider call occurs.

Test-only module hooks add read-only snapshot/state accessors to the actual
cache closure; they do not replace the loader, get logic, validation or timers.
The API's actual GET function runs in-process with NextRequest/NextResponse.
Each stalled scenario starts with successful company OLD and exchange XSYN.

**Before product edits:** HTTP 200 headers arrived in **3.339ms**, followed only
by `{`. At **16,304.375ms**, all six requests were still pending, AbortSignal was
not cancelled, and one company refresh/one HTTP attempt was in flight. Only
test-forced connection teardown released them at 16,313–16,316ms. This was a
successful reproduction of a failure, not a product-timeout PASS.

**After fix:** three real 15-second scenarios passed. Predeclared timing
acceptance was **14,500–17,000ms** (scheduler tolerance, not a changed product
timeout). Times below are milliseconds from starting the shared refresh group.

| Scenario | Headers | Abort | All six settled by | Server response closed | Attempts / refreshes |
|---|---:|---:|---:|---:|---:|
| Headers immediate, body stalls | 3.122 | 15,014.004 | 15,016.287 | 15,017.980 | 1 / 1 |
| Headers never arrive | none | 15,005.381 | 15,006.148 | 15,006.464 | 1 / 1 |
| Body sends a chunk every 500ms | 0.956 | 15,015.011 | 15,015.627 | 15,016.128 | 1 / 1 |

The trickle test received 29 additional chunks without extending the deadline.
One HTTP entry per scenario confirms one company loader/refresh, since the
company loader makes one HTTP call and has no internal retry.

For the body-stall scenario, each consumer preserved its distinct contract:

| Consumer | Settlement ms | Result |
|---|---:|---|
| Direct reader fresh | 15,015.088 | rejects AbortError |
| Direct reader cached | 15,015.095 | rejects AbortError |
| Company wrapper fresh | 15,015.143 | resolves ok=false, status=0 |
| Company wrapper cached | 15,015.148 | resolves ok=false, status=0 |
| probeSec | 15,016.255 | resolves ok=false, status=0 |
| API GET | 15,016.287 | resolves HTTP 502 with failure body |

The 22-second test safety watchdog did **not** fire. Before recovery or test
cleanup, native abort had closed the server response and `destroyed` was true.
Only then was the old response deliberately ended late with LATEOLD JSON; the
cache remained NEW. All test connections, server timers and server were closed
at the end; the process exited normally.

## Recovery and boundary evidence

- All three timeout scenarios preserved the complete OLD snapshot and exact
  last-success timestamp; `refreshing=false`, `refreshFailed=true` after failure.
- All three next **ordinary/cached-mode** calls made one new HTTP request and
  returned NEW. Failed/partial JSON was not served or committed as fresh success.
- All three late-old-response attempts left NEW intact, without another HTTP.
- Exchange XSYN remained available from its own cache, with **zero** extra
  exchange requests after each company failure.
- Mid-body disconnect: wrapper failure status 0, original snapshot retained,
  ordinary recovery RECOVERED; one failed attempt + one recovery attempt.
- Invalid JSON: same failure/preservation/recovery results. Reported durations
  including recovery were 66.046ms and 2.638ms respectively.
- Complete valid JSON arriving in two pieces 150ms apart succeeded in 159.736ms,
  HTTP 200, ticker COMPLETE, one attempt.

Receipts (synthetic data only; local, not committed):
`C:/Users/PC/.codex/visualizations/sec-catalog-f1-before.json` and
`C:/Users/PC/.codex/visualizations/sec-catalog-f1-after.json`.
The script refuses to overwrite receipt files. `--before` was run on the base
before editing the product; it is expected to fail its pending assertion on the
fixed candidate.

## Commands and existing regression

Run from the candidate root. Before-fix command used `--before` and the before
receipt path; the same script after the fix used the command below:

```powershell
node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/verify-sec-catalog-body-timeout.mjs --output=C:/Users/PC/.codex/visualizations/sec-catalog-f1-after.json

node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/verify-sec-company-search-contract.mjs --compare=C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json

node --no-warnings --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/reproduce-sec-catalog-fresh.mjs

node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/sources/sec/tickerCatalog.test.mjs lib/sources/sec/tickerCatalogCache.test.ts lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts lib/sources/sec/forms/ownership/source-parser.test.ts lib/watchlist/stockHeaderSecIdentity.test.ts lib/sec-ticker-resolution/publicTickerSearch.test.ts lib/tickerSearchContract.test.ts

npm run typecheck
git diff --check
git diff --cached --check
```

- **71/71 existing tests PASS**, zero skipped; no existing test edits or weakened assertions.
- **6/6 added native streaming scenarios PASS**, including three real timeouts.
- Search baseline: all eight complete results equal, eight fresh HTTP attempts,
  original order/count/50-result cap preserved; SHA-256 unchanged:
  `afd78e8622449447d62e631ed60c449564e2388b15e2e0ca24e048775928575f`.
- Stage-1 exported repro: OLD / OLD / fresh NEW / ordinary NEW, two refreshes / two HTTP attempts.
- Typecheck and working/staged diffcheck PASS.

This completes only F1 candidate verification. F2, real Next/browser behavior,
live SEC/network conditions and production runtimes remain unverified. No
merge/push/deploy or next-stage work; stop for independent GPT re-review.
