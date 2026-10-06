# Stock header status readability and non-interfering capture

2026-10-07 Asia/Seoul. Base `2b8be8593c965415ee539a38725f50362399f6c8`,
detached eeb4. Product change: eight CSS lines only.

## Reproduction and scoped fix

Fresh actual Next/Edge rendering at 390px reproduced both existing messages being
ellipsized before editing CSS. Synthetic catalog/SQL fixtures supplied states;
these were not new SEC confirmations or actual database reads.

| State | Before paragraph client/scroll width | Before height | After width/scroll | After height |
| --- | --- | --- | --- | --- |
| not-confirmed | 150 / 240px | 19px | 150 / 150px | 38px |
| unavailable | 150 / 271px | 19px | 150 / 150px | 38px |

The original images visibly showed `Company information …` / `Company information
t…`. After the fix they show the complete, distinct sentences on two lines. Header
height naturally grew from 196.16px to 215px. No font-size reduction or abbreviated
copy, tooltip-only fix, forced height or clamp.

`StockRadarWatchlistV2.module.css` now selects only:

```css
.stockHeader[data-company-identity-state="not-confirmed"] .stockIdentity p,
.stockHeader[data-company-identity-state="unavailable"] .stockIdentity p
```

Those paragraphs use `white-space: normal`, `text-overflow: clip`, visible overflow
and `overflow-wrap: anywhere`. The ordinary `.stockIdentity p` and ticker rules
remain unchanged. No JSX, message, DTO, API, reader or status logic was changed.

## Actual screen checks

Both messages at **390, 900, 1440px**: PASS. Full text was checked in screenshots,
computed styles and text-range rectangles, not just DOM text. All text rectangles
fit the paragraph; no vertical clipping, child-region overlap or page overflow.
Neither unavailable state had a confirmation timestamp. At 900px the longer
unavailable message wraps to two lines; at 1440px both fit one line.

- Available fixture at all three widths: exact ticker/Nasdaq/company and
  `confirmedAt=2026-10-07T02:03:04.567Z`, readable UTC copy. Quote/chart remain
  unavailable; company identity does not promote other data to ready.
- Available company name/ticker retain original ellipsis/nowrap policy. Normal
  and ordinary Watchlist paragraph style, text, dimensions, heading style and
  timestamp were compared directly with before-run measurements at all widths.
- Same `/stocks/SYNERR` browser page starts unavailable, then fixture transport
  recovers and page reloads: available, correct time, old error text absent.
- Ordinary Watchlist uses a synthetic GET view model with one guest row to render
  its existing header; no login/account/save action. Narrow Watchlist status
  badge remains hidden as before, unlike the stock-mode quote badge.

Before baseline: 10 passes. After: **15 passes** (two no-capture runs, six target
state/width screenshots, six normal/Watchlist checks, one same-ticker recovery).
The two initial baseline harness attempts exposed missing guest-row fixture and
an incorrect assumption that Watchlist's narrow badge was visible. The harness
was corrected to use the existing Watchlist contract; target message assertions
were not weakened. Every attempt closed its owned resources.

## Hydration: distinguish what was observed

For both unavailable states, listeners were installed before navigation. First a
fresh context navigated **without taking any screenshot**. Actual Search stocks
open/close handlers established interactive readiness after network idle. All
console messages/pageerrors from navigation onward were retained.

Separate fresh contexts then repeated the same readiness checks and used
`screenshot({ caret: "initial" })`. Every input's inline style was compared before
and after capture and was identical. No temporary CSS was injected in the browser.

- After-run pageerrors: **0**.
- Hydration warnings before capture / after capture: **0 / 0**.
- No-capture runs: **0** hydration warnings.
- Other console errors: **274** excluded ancillary API HTTP 503 messages; other
  console warnings: 0. Before baseline similarly had pageerrors/hydration 0,
  178 excluded 503 messages. Full logs are preserved, not suppressed or cleared.

**캡처 간섭을 배제한 이번 실제 화면 실행에서는 재현되지 않음.** This does not
prove the unique cause of the previous live-run warning. No suppressHydrationWarning,
SSR disablement, auth change or rendering rewrite was added.

## Isolation, regressions and cleanup

The real candidate Next/React/CSS ran on owned port 3118 with installed Edge.
The process-only preload intercepts all server fetches (catalog/REST fixture or
excluded 503) without native transmission and replaces pg acquisition/query with
synthetic SQL rows. A direct pg Client connection is forbidden. No actual SEC,
CompanyFacts, LLM or shared/operational DB read/write occurred. No environment
files were edited or real credentials used. No current refresh or ingestion ran. MSFT's catalog CIK
in this test is deliberately synthetic; it is not an issuer-identity test.

Browser ancillary APIs are excluded with 503, except the explicitly supplied
Watchlist GET fixture in Watchlist-mode cases. This covers quote/chart/profile,
logo, events/calendar, auth widgets, source filings, financials and live unread.
Their warnings are not product success claims. Authentication/plan/Live Room
remain unverified pending an approved session; no such environment was created.

- Related header/presentation, overview, ticker projection, ticker-flow and shell
  regression tests: **35/35 after the CSS change**.
- `npm run typecheck`: PASS.
- `node --check` on both new harness files: PASS. Diffcheck: PASS.
- Prior three-live-issuer DB/Next/browser, DB timeout, raw/current concurrency and
  HTTP tests are retained as earlier evidence: their product paths were unchanged,
  and no full SEC acquisition or storage suite was repeated.
- All owned Edge contexts/browser and Next processes closed. Port 3118 clear.
  Next-generated `next-env.d.ts` restored from starting bytes; tsconfig unchanged.
  No DB or Docker resources created, no 3110/other-worktree process operation.

Receipts and inspected PNGs outside Git:
`C:/Users/PC/.codex/visualizations/sec-header-display-before-20261007-r3/` and
`sec-header-display-after-20261007/`, including `report.json`, trace, Next log,
`MSFT-{390,900,1440}.png`, `SYNERR-{390,900,1440}.png`, `available-*.png`,
`watchlist-*.png`, `recovered-390.png`. Initial failed harness reports are retained.

Run using existing absolute server-only/TS loaders:
`node <loaders> --experimental-strip-types scripts/verify-sec-header-display.mjs
--phase=before --output=<external directory>`; after CSS change use `--phase=after
--baseline=<before directory>/report.json --output=<new external directory>`.
The after command checks full message visibility and normal/Watchlist preservation.
Related test command: same loaders + `--experimental-strip-types --test` with
`lib/watchlist/{stockHeaderSecIdentity,stockOverview,tickerProjection}.test.ts`,
`lib/tickerSearchFlowObservation.test.ts`,
`components/shell/tickerSearchFlowRegression.test.ts`.

No merge/push/deploy or following-stage work. Local main not rechecked (last
reported `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`); GitHub/Vercel/operational
migrations/cron unqueried. Independent review remains the next gate.
