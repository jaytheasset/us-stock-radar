# SEC catalog stage 3: explicit Submissions-only ingestion

2026-10-06; candidate `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
Base `903aff1720757c916d76bf8865466a789778e1a5`, detached and clean at start.
No branch/worktree replacement, merge, push, deployment, real SEC request,
database connection, migration, environment-file edit, cron, queue or UI wiring.
Local main, GitHub main, Vercel, migration and cron state were not queried.
The handoff's `af265b5bf3bb8878d706e1f4d763c0ce85a1b024` local-main value
is historical, not a newly verified state.

## Entry point and contracts

`SecStructuredDataService.ingestIssuerSubmissions({ cik })` is an explicit
server ingestion method on the existing injected service. It always requests
`fetchSubmissions(normalizedCik, "incremental")`: one main JSON document only.
It does not call CompanyFacts, historical Submissions, filing XBRL, an LLM,
O/S baseline readers, filing analysis, event generation or enqueue operations.
There is no new HTTP endpoint, factory, scheduler or automatic execution.

Existing `ingestIssuer({ cik, mode })` and its O/S caller are unchanged. Full
ingestion still requires both Submissions and CompanyFacts via Promise.all;
CompanyFacts failure rejects without calling the repository. Existing O/S
incremental baseline requirements remain in place.

Before writing, the standalone method requires:

- Exactly one Submissions document; request/document/payload CIK agreement.
- Exact main URL and source identity `https://data.sec.gov/submissions/CIK<10 digits>.json`.
- Nonempty original body, a name, ticker/exchange arrays, and a recent ledger.
  Required accession/form/filingDate arrays and all supplied recent arrays must
  have the same length. Empty arrays are valid. The existing normalizer checks
  individual values and ticker/exchange pairing; nothing is truncated or filled.
- Existing normalization's original body/payload equality, hash, authority kind,
  timestamps and source/value validation. Any rejection, missing accepted main
  raw/name observation or unexpected facts fails before repository ingestion.

The result contains existing repository write counts, `sourceDocuments: 1`,
`normalizedFacts: 0`, `rejected: 0`, mode `incremental`, and **only**
`sourceUpdates.submissions = { fetched, updated, unchanged }`. No CompanyFacts
success is implied. Fetch, validation and persistence failures reject; no
empty-batch success or unchanged result is manufactured.

## Storage and reader compatibility

The existing normalizer and `PostgresSecStructuredRepository.ingestBatch` are
reused without changes. Source-kind/identity/body hash and deterministic raw ID,
observation keys, transaction and conflict handling are unchanged. The source
URL never receives a run timestamp or query suffix. No new store/table exists.

Empty ticker/exchange arrays retain raw/name/issuer observations with no ticker
rows. They do not erase prior observations or imply delisting, a merger event,
or effective ticker changes. The recent ledger is stored without downloading
or analyzing its filing bodies.

Same-content replay preserves the raw snapshot's **first** stored `fetched_at`.
`fetched: 1, updated: 0, unchanged: 1` means that this request fetched accepted
content already stored; it does not refresh the stored timestamp or implement
last-checked/current-pointer selection. Current snapshot policy and refresh
integration are deferred. The existing detail reader's policy is unchanged.

## HTTP boundary: directly reproduced, then minimally fixed

Before product edits, `submissionsHttp.test.mjs` with
`SEC_SUBMISSIONS_BODY_BEFORE=1` ran native fetch/Response against a temporary
loopback HTTP server. Only the test transport redirected the SEC URL.
With the existing injectable policy timeout set to 200ms, the server flushed
HTTP 200 headers and sent `{`, then kept the body open. At **656.041ms**:
one request, headers received, no abort, no settlement, connection still open.
Only explicit test cleanup released it. This confirms a pre-existing weakness
in structured HTTP, separate from the already-fixed company-catalog F1 path.

`SecRequestPolicy.fetchText` now retains the final attempt signal/deadline
through complete `response.text()`, checks cancellation after reading, and
disposes it in finally. The structured JSON client uses it for Submissions
and CompanyFacts. Error responses are cancelled without reading their bodies.
Network/header failures and transient HTTP statuses keep the existing bounded
retry/backoff policy; body-read and JSON/validation failures are **not retried**.
The default timeout stays 30,000ms per attempt, not a new timer after headers.
The existing cadence, maximum attempts, User-Agent and raw `fetch(): Response`
consumer contract remain; filing-XBRL consumers still use that unchanged body
ownership contract. This is not a general fix for every HTTP reader in the app.
JSON queue work now stays active until its body completes or fails.

Actual default **30-second** native body-stall run (not a fake clock):

- Abort at **30,007.614ms** from invocation; failure and closed server stream
  confirmed by **30,052.689ms**, including a 30ms close-observation wait.
- Assertion tolerance: no earlier than timeout minus 20ms; settled before
  timeout plus 1,500ms. No timeout increase, forced disconnect, or Promise.race
  substituted for product cancellation.
- Policy maximum attempts remained **3**, but this body failure used **1**
  HTTP attempt; storage calls **0**. Next normal request succeeded, cumulative
  requests **2**, successful storage calls **1**.

Short real-timer native stream cases also cover delayed headers, broken body,
invalid JSON, continuously arriving partial bytes, complete delayed JSON, caller
cancellation, queue recovery and zero partial writes. A separate abort-ignoring
Response double completes late: the post-read abort check rejects it, storage
calls remain zero, and the next request succeeds. This double is separate from
the native cancellation evidence. A watchdog only prevents broken regression
tests from hanging; forced cleanup is asserted false in success checks.

## Isolated results

| Scenario | Observed result |
|---|---|
| Three preserved minimal issuer fixtures | Each: Submissions 1, CompanyFacts 0, raw 1, normalized facts 0, rejection 0; name/listing/ledger preserved |
| CompanyFacts throws if invoked | Standalone succeeds without invocation; full calls it and rejects, SQL calls 0 |
| Existing full success | Two source documents, two financial facts for first fixture; both source reports remain |
| Single → single → full → single → full; reverse order | Same Submissions raw ID; final raw 2 (main + CompanyFacts), names 1, tickers 1, ledger 1, facts 2; first fetched_at and facts unchanged |
| Four invalid CIKs and 22 invalid document cases | Explicit rejection, storage calls 0, CompanyFacts calls 0 |
| Synthetic SYN / SYN.W pairs then empty lists | Order and exact exchanges retained; new empty snapshot adds raw/name but zero ticker rows; prior observations unchanged |
| Injected SQL failure after raw/name writes | Real repository issued begin/rollback, error propagated; SQL double reverted rows; subsequent request begin/commit succeeded |
| Actual HTTP client with declared historical file | Exactly one main request; no historical/CompanyFacts URL requested |
| Existing stock-header detail reader with injected catalog/selectRows | Same stored source ID supplies fixture names and exact ticker/exchange pairs; no canonical-exchange fallback |

The SQL double calls the **real repository** but models its limited insert and
conflict behavior in memory. It is not PostgreSQL, does not prove RLS or real
concurrent transaction behavior, and does not run migrations. The reader uses
injected in-memory selects; it does not verify a real DB or browser journey.
No actual external SEC, CompanyFacts, XBRL or provider request occurred.

## Regression commands and results

- All `lib/sec-structured-data/*.test.ts` / `*.test.mjs`: **219 PASS**
  (existing 207 plus 12 added scenario groups), including O/S and request policy.
- Existing stage 1/2/F1/F2 search/identity/Live Room regression set: **138 PASS**.
- Existing F1 native loopback script: **6/6 PASS**, resources closed; body/header/
  trickle aborts 15.012s / 15.012s / 15.001s, snapshot and success timestamp
  preserved, next request recovery, old-result exclusion maintained.
- Eight-query company search comparison unchanged, SHA-256
  `afd78e8622449447d62e631ed60c449564e2388b15e2e0ca24e048775928575f`.
- Six existing normal service/API comparisons against the script's preserved
  08fa71ad baseline: identical payload/status/order and SEC attempt counts.
  This comparison is not a claim about remote main or current production.
- `npm run typecheck` and `git diff --check`: PASS.

```powershell
$secNode = @('--no-warnings', '--import', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs', '--experimental-loader', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs')
$structuredTests = @(rg --files lib/sec-structured-data | Where-Object { $_ -match '\.test\.(ts|mjs)$' })
node @secNode --experimental-strip-types --test @structuredTests

# Only run the before reproduction on the original base; it intentionally
# asserts the defect and fails on the corrected implementation.
$env:SEC_SUBMISSIONS_BODY_BEFORE='1'
try { node @secNode --experimental-strip-types --test lib/sec-structured-data/submissionsHttp.test.mjs } finally { Remove-Item Env:SEC_SUBMISSIONS_BODY_BEFORE }

$env:SEC_SUBMISSIONS_REAL_TIMEOUT='1'
try { node @secNode --experimental-strip-types --test --test-name-pattern='headers-complete body-stall' lib/sec-structured-data/submissionsHttp.test.mjs } finally { Remove-Item Env:SEC_SUBMISSIONS_REAL_TIMEOUT }

node @secNode --test --experimental-strip-types lib/sources/sec/tickerCatalog.test.mjs lib/sources/sec/tickerCatalogCache.test.ts lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts lib/sources/sec/forms/ownership/source-parser.test.ts lib/watchlist/stockHeaderSecIdentity.test.ts lib/sec-ticker-resolution/publicTickerSearch.test.ts lib/tickerSearchContract.test.ts lib/tickerSearchAvailability.test.mjs lib/tickerSearchFlowObservation.test.ts components/shell/tickerSearchFlowRegression.test.ts components/alerts-v2/alertsV2Regression.test.ts lib/telegram/telegramCommandPolicy.test.ts lib/live-room/posts.test.ts
node @secNode --experimental-strip-types scripts/verify-sec-catalog-body-timeout.mjs
node @secNode --experimental-strip-types scripts/verify-sec-company-search-contract.mjs --compare=C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json
$normalBefore = node @secNode --experimental-strip-types scripts/verify-ticker-search-f2.mjs --normal --baseline
$normalAfter = node @secNode --experimental-strip-types scripts/verify-ticker-search-f2.mjs --normal
if (($normalBefore -join "`n") -cne ($normalAfter -join "`n")) { throw 'Normal search regression' }
npm run typecheck
git diff --check
```

Local receipts (not duplicated in Git):
`C:/Users/PC/.codex/visualizations/sec-submissions-stage3-structured-tests.txt`,
`sec-submissions-stage3-catalog-tests.txt`, `sec-submissions-stage3-real-timeout.txt`,
`sec-submissions-stage3-f1-regression.json` in the same directory.

## Stop boundary

No actual DB loading, automatic refresh, search/detail GET collection, UI,
Primary/MCP/Monitor/Watchlist semantic change, EFFECT or ticker lifecycle work.
Authenticated Live Room and real SEC/DB/Next/browser integration remain
unverified. Await independent GPT review before limited real ingestion or
execution wiring; this isolated implementation does not establish production
readiness, a current pointer, or a fresh confirmation timestamp.
