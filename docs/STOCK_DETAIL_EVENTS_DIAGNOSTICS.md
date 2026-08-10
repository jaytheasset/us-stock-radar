# Stock detail Events diagnostics

Start at the direct stock URL, `components/watchlist-v2/StockRadarWatchlistV2.tsx`,
and `lib/watchlist/stockEventsObservation.ts` when investigating the **News &
Events** journey on a stock detail page.

## Local read-only path

Use the existing local app and a syntactically valid ticker. For the
representative candidate flow:

```text
http://127.0.0.1:3110/stocks/NVDA
GET http://127.0.0.1:3110/api/events?ticker=NVDA&limit=50&include_archive=true
```

Confirm that the direct URL ticker, rendered ticker, selected All/News/Filings
tab, and the existing GET ticker agree. Record the GET's HTTP status, `ok`, and
response `data` length without copying raw rows or error details into the DOM.
Then compare those facts with the section's `data-stock-events-*` fields,
visible copy, and rendered event-row count.

The filters remain accessible tabs under the ticker-specific event-filter
tablist. The active tab has `aria-selected="true"`; event rows retain their
existing pressed-state behavior.

## State interpretation

`resolveStockEventsObservation` is the shared source for the Events request,
safe section state, filter result, result label, empty/unavailable copy, and
rendered rows.

- `idle`: the client has not started the valid ticker request yet.
- `loading`: the existing Events GET is in progress.
- `ready`: a successful HTTP response has `ok: true`, a `data` array, and
  mapped source events.
- `empty`: that confirmed successful response has an empty `data` array.
- `filtered_empty`: the source is `ready`, but the selected News or Filings
  filter has no matches.
- `unavailable`: the request failed, the response was unsuccessful or invalid,
  or its source/mapped counts were inconsistent.

Zero by itself is never enough to label a response empty. Failed or invalid
responses keep the source count unknown and must not render successful-empty
copy.

## Partial boundary

This contract belongs only to the stock detail **News & Events** section.
Profile, quote, chart, fundamentals, Calendar, ads, Watchlist, authentication,
and plan state keep their own existing behavior. An unavailable or empty Events
section is not evidence that the whole stock page failed, and an optional FMP
section failure does not change a confirmed Events result.

## Safety boundary

Use only the public stock page and the existing read-only Events GET. Do not
create a diagnostic API, force external requests, seed or edit database data,
run collection/recollection/analysis/alert jobs, change cron/finalizers,
permissions, plans, environment variables, or caches, or add persistent logs,
MCP/WebMCP, or a general console. Safe DOM fields must not include raw errors,
response bodies, database details, keys, cookies, or personal information.

A browser extension may block a direct JSON tab with `ERR_BLOCKED_BY_CLIENT`.
That signal alone is not a product defect. Verify through the rendered product
UI plus the same existing local GET from a read-only client, and report the
extension block separately if it occurs.

For a candidate, check the logged-out direct URL at PC, an intermediate CSS
width, and 390px. At each width record the final Events DOM state, selected
filter, visible row count, horizontal overflow, and console errors. Do not mock
browser evidence or manufacture an empty/unavailable response; leave a branch
unverified in the real browser when it cannot be reached safely.
