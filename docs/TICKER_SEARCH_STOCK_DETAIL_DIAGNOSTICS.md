# Ticker search to stock-detail diagnostics

Start at any public page using `StockRadarAppShell`, then use the product-header
search and the existing stock-detail route. The representative local path is:

```text
button "Search stocks"
combobox "Search ticker or company"
GET /api/tickers/search?q=AMD
option "AMD NASDAQ Advanced Micro Devices, Inc."
/stocks/AMD
```

The search button, combobox, result listbox, and result options are the public
user controls. Use their semantic role and accessible name; coordinate clicks
are unnecessary. The active option has `aria-selected="true"`. Choosing an
option uses the same `getStockRouteHref` mapping as the direct stock URL.

## Shared safe state

`lib/tickerSearchFlowObservation.ts` is the single state model for the search
request, visible search result, selected route, and stock-detail render result.
The human-facing search matches/status copy and rendered options come from the
same observation used by the readout. On `/stocks/[ticker]`, the readout's
detail render state is the existing stock overview state that also drives the
visible profile/loading/unavailable presentation.

Find the semantic `status` named **Ticker search to stock detail state**. It
exposes only allowlisted `data-ticker-flow-*` values:

- stage, normalized query, existing request href, request state, safe response
  status, HTTP status, and API `ok`;
- response-row and rendered-option counts, active ticker, chosen ticker, and
  chosen stock-detail href;
- actual route ticker/href, whether it matches the choice, stock-detail render
  state, and the successfully rendered ticker.

The one-use navigation snapshot is session-scoped and is consumed by the
matching stock page. A direct stock URL correctly reports the search portion as
`unobserved`; it does not invent a prior search action.

## State interpretation

- `idle`: no normalized query has started a request.
- `loading`: the existing ticker-search GET is in progress.
- `ready`: HTTP succeeded, API `ok` is true, the response has rows, and the
  shared client contract rendered one or more safe results.
- `empty`: HTTP and API succeeded and both response and rendered counts are
  zero. This is a valid no-match result, not a failure.
- `unavailable`: transport failed, HTTP/API failed, the response shape was
  unsupported, or response and mapped counts were inconsistent.

Stock-detail render state remains `idle`, `loading`, `ready`, or `unavailable`.
It does not claim that every optional stock subsection succeeded; it mirrors
the existing overall stock overview judgment.

## Safety and verification boundary

The DOM and one-use selection snapshot never include raw errors, response
bodies, provider details, database fields, tokens, cookies, account data, or
company payloads. Do not add a diagnostic endpoint, console, MCP/WebMCP layer,
test data, cache mutation, database change, remote lookup, or source/analysis
job for this investigation.

For browser verification, use a logged-out public page at PC, an intermediate
width, and exactly 390px. Record the semantic controls, matching GET outcome,
safe readout, chosen option, `/stocks/{ticker}` URL, settled detail readout,
horizontal overflow, console errors, and failed product requests. Use isolated
unit fixtures for empty, unavailable, and inconsistent-response branches when
they cannot be reproduced safely in the real local UI; mark those browser
branches unverified.
