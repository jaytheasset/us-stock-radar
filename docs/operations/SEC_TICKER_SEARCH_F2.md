# SEC catalog F2 — search availability propagation

2026-10-06 (Asia/Seoul). Implementation and isolated verification completed;
independent GPT review pending. Authenticated Live Room composer browser checks
remain unverified. No phase 3, merge, push or deployment.

## Workspace / scope

- Existing `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
- Base `08fa71addc332d9a994375d19d97e3365f1560bc`, detached / clean at start.
- Phase 1/2 and F1 preserved. No cache, timeout, TTL, source separation, FMP
  eligibility, asset_type/is_active, identity decision, Primary, MCP or Monitor changes.
- User's last local-main reference: `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`.
  Current local main, GitHub main, Vercel, DB migration and cron were not queried.
- No environment-file changes, actual DB writes, accounts, external deliveries
  or new dependencies. Test fixtures use synthetic companies/tickers only.

## Before / after and contract

Before editing product code, `verify-ticker-search-f2.mjs --before` invoked both
actual GET handlers with empty in-memory local results and a SEC 503 response:

| Handler | Before | After |
|---|---|---|
| `/api/sec/company-tickers` | 503, ok=false | 503, ok=false (unchanged) |
| `/api/tickers/search` | 200, ok=true, data=[] | 503, ok=false, TICKER_SEARCH_UNAVAILABLE |

Both runs made two synthetic SEC attempts across the two separate calls.
F2 existed before the cache changes; it is **not** a new cache regression.

The status-bearing search readers return the existing data plus optional
`partial:true`. Required supplemental failures are carried through aggregation:

- Complete: HTTP 200 / ok=true / data, no partial flag. Includes successful empty
  searches and correctly skipped SEC lookups under the existing limit policy.
- Partial: HTTP 200 / ok=true / nonempty data / partial=true. Valid results keep
  their existing order, fields, deduplication and limit.
- Unavailable: required read failed and no usable result remains => HTTP 503 /
  ok=false / TICKER_SEARCH_UNAVAILABLE. Never data=[] with partial=true.
- Primary tickers DB failure stops before SEC, still an error; known dependency
  failure now uses the same 503 code. Unexpected internal failure remains 500 /
  TICKER_SEARCH_FAILED. All search responses retain Cache-Control no-store.
- Fixed failure copy: “Ticker search is temporarily unavailable. Please try
  again.” Partial copy: “Some results may be unavailable.” Raw errors, keys,
  internal URLs and stack traces are not returned by the search API/readout.

`event_tickers` errors no longer disappear as successful empty rows. The
stock-research reader preserves base partial status and marks unconfirmed
projection reads partial/unavailable without admitting an unverified historical
edge. The existing issuer-binding implementation is unchanged. Array-only
compatibility wrappers fail closed on partial results; API and exact-symbol
consumers use the status-bearing readers.

`findTickerBySymbol` returns an exact valid row even in partial results; if the
exact row is missing in an incomplete search it throws unavailable. Only a
complete search can return null. This is availability propagation, not a new
security-type or issuer approval.

## Isolated verification

`lib/tickerSearchAvailability.test.mjs` runs actual search services, readers,
normal/stock-research GET, Watchlist/Alert POST handlers and the Telegram command
runtime. HTTP goes only to in-memory responses; unexpected URLs/mutations are
blocked. Mutation-handler authentication uses a process-only synthetic actor
module hook, not a product auth change. Existing plan/validation/lookup code
still executes. Telegram uses its existing dependency injection with the actual
exact-symbol lookup; no Telegram API or sending function runs.

Verified scenarios:

| Scenario | Observed result |
|---|---|
| Eight local results | Eight unchanged rows, SEC attempts 0 |
| Local + event + SEC | SYN, SYNA, SYNE, SYNZ; local name/market cap retain precedence |
| SEC 503 / invalid JSON / AbortError | Local row retained with partial; no rows => 503; next successful search clears partial/error |
| Successful missing ticker | 200 / ok=true / data=[]; client observation empty |
| event_tickers failure | Partial with usable rows, otherwise 503; when local rows fill limit SEC is still skipped |
| Primary tickers failure | 503; SEC attempts 0, no fallback |
| Projection unavailable | Base rows kept with partial, no new historical rows; empty => 503 |
| Partial selection | Keyboard-capable ready results; selection/detail snapshot retains responseStatus=partial |
| Exact ticker | Partial exact row accepted; incomplete absence throws; complete absence null |
| Watchlist/Alert POST | Both return 503 before persistence; write calls 0; one simulated Watchlist snapshot read |
| Telegram command | Temporary failure presentation, not “not an active listed ticker”; external sends 0 |
| Invalid client envelope/JSON/HTTP | Rejected, never empty; shared header observation reports failure |
| Unexpected internal exception | 500 / TICKER_SEARCH_FAILED with fixed safe message, no-store |

The new test file passes 9 tests (parent plus 8 scenario groups), with 20
synthetic SEC calls and zero real network/DB/delivery. Its AbortError is a
transport double; it does not replace F1's real streaming test.

Existing 71 tests remain unchanged and pass. Broader search/Alerts/Telegram
verification plus F2: **113/113 PASS**. Live Room posts: **21/21 PASS**.
One existing posts source assertion changed intentionally: instead of requiring
the old permissive `mapTickerSearchResults(payload)` call, it now requires the
shared response reader, `payload.data`, partial propagation and error state.
All other post-policy/navigation/mutation assertions remain intact.

Normal before/after service/API comparison executes preserved base modules via
read-only `git show` in a test-process loader, without checkout/reset. All six
normal responses and HTTP counts match exactly (full/merged/empty × two API
branches). The stage-2 company-search eight-query comparison also matches:
`afd78e8622449447d62e631ed60c449564e2388b15e2e0ca24e048775928575f`.

F1 real native streaming: **6/6 PASS**. Actual aborts were 15.018s body stall,
15.001s headers stall and 15.008s trickle; each used one company flight/attempt,
preserved the snapshot/timestamp, recovered and blocked late old results.
Receipt: `C:/Users/PC/.codex/visualizations/sec-catalog-f2-f1-regression.json`.
Typecheck and working/staged diffcheck pass.

## Actual browser boundary

Started only the candidate Next server on unused **127.0.0.1:3117**, with DB and
provider credentials empty in that child process (no env-file edits). Used
bundled Playwright with installed Edge because agent-browser and Playwright's
own downloaded Chromium were unavailable; no packages/browser were installed.
The temporary server and task-owned browser were stopped after verification.
Next's generated next-env.d.ts path change was restored and excluded.

Actual Next pages/components, at **1440 / 900 / 390px**:

- Header on `/watchlist`: normal, empty, partial, unavailable, recovery all PASS.
  Partial text appears alongside selectable results; safe DOM readout agrees.
- Common autocomplete on `/alerts`: the same five states all PASS.
- Both controls: late old success and late old failure cannot overwrite a new
  partial result. Keyboard selection works at all three widths.
- Header keyboard selection navigates to actual `/stocks/SYN`. This verifies
  navigation, not live stock data availability. Autocomplete selects SYN without
  clicking Add ticker or making a persistence request.
- 30 state/width/surface checks plus 6 stale-response/selection checks PASS.
  Search panels fit each viewport without horizontal clipping; screenshot
  inspection confirms readable notices separate from results. No pageerror.
- Existing unconfigured stock/profile/events endpoints return 5xx and guest
  Monitor endpoints return 401. These are not hidden or claimed to work.
- `/live/SYN` loads but reports room availability unconfirmed and read-only;
  no New post control is available. Authenticated composer states, Live Room
  search layout and its keyboard flow remain **unverified in browser**.
  No gate bypass, test account or product-only test endpoint was added.

Search API responses were intercepted **in the browser**, not generated by SEC
through the running Next server. Thus this is UI/Next verification with fixtures,
separate from service→API→client isolated tests, **not server-to-SEC E2E**.
Initial browser attempts hit SSR/hydration initialization; the harness waits for
client initialization before interaction. Product gates were not modified.
Screenshots: `C:/Users/PC/.codex/visualizations/f2-{header,autocomplete}-*.png`.

## Reproduction commands

Changed files (16 total):

- Services/contracts: `lib/alerts/tickers/getAlertTickersViewModel.ts`,
  `lib/sec-ticker-resolution/publicTickerSearch.ts`, `lib/tickerSearchContract.ts`,
  `lib/tickerSearchFlowObservation.ts`.
- APIs: `app/api/tickers/search/route.ts`, `app/api/watchlist/route.ts`,
  `app/api/alerts/tickers/route.ts`.
- UI: `components/shell/StockRadarTickerSearch.tsx`,
  `components/ui/TickerCompanyAutocomplete.tsx`, `components/live-room/PostsPanel.tsx`.
- Tests: `lib/tickerSearchAvailability.test.mjs`, `lib/live-room/posts.test.ts`.
- Scripts: `scripts/verify-ticker-search-f2.mjs`,
  `scripts/verify-ticker-search-f2-browser.cjs`.
- Docs: this file and `docs/TICKER_SEARCH_STOCK_DETAIL_DIAGNOSTICS.md`.

From this worktree, use the existing Node resolution hooks:

```powershell
$f2Node = @('--no-warnings', '--import', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs', '--experimental-loader', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs')
node @f2Node --experimental-strip-types scripts/verify-ticker-search-f2.mjs
# --before was run on base before editing; --baseline reads that base in memory.
node @f2Node --experimental-strip-types scripts/verify-ticker-search-f2.mjs --before --baseline
$normalBefore = node @f2Node --experimental-strip-types scripts/verify-ticker-search-f2.mjs --normal --baseline
$normalAfter = node @f2Node --experimental-strip-types scripts/verify-ticker-search-f2.mjs --normal
if ($normalBefore -cne $normalAfter) { throw 'Normal search regression' }

node @f2Node --test --experimental-strip-types lib/sources/sec/tickerCatalog.test.mjs lib/sources/sec/tickerCatalogCache.test.ts lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts lib/sources/sec/forms/ownership/source-parser.test.ts lib/watchlist/stockHeaderSecIdentity.test.ts lib/sec-ticker-resolution/publicTickerSearch.test.ts lib/tickerSearchContract.test.ts lib/tickerSearchAvailability.test.mjs lib/tickerSearchFlowObservation.test.ts components/shell/tickerSearchFlowRegression.test.ts components/alerts-v2/alertsV2Regression.test.ts lib/telegram/telegramCommandPolicy.test.ts
node --no-warnings --experimental-strip-types --test lib/live-room/posts.test.ts
node @f2Node --experimental-strip-types scripts/verify-sec-catalog-body-timeout.mjs
node @f2Node --experimental-strip-types scripts/verify-sec-company-search-contract.mjs --compare=C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json

# Requires a task-owned server and an existing Playwright installation; no install.
$env:PLAYWRIGHT_MODULE_PATH='C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:F2_BROWSER_OUTPUT='C:/Users/PC/.codex/visualizations'
node scripts/verify-ticker-search-f2-browser.cjs
npm run typecheck
git diff --check
git diff --cached --check
```

Stop for independent GPT verification. No claim of complete authenticated site
verification or operational readiness; no automatic next-stage work.
