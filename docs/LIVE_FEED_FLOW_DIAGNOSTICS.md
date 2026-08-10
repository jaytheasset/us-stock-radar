# Live Feed flow diagnostics

Start at `/feed`, `components/feed-v2/StockRadarFeedV2.tsx`, and
`lib/liveFeedV2FlowState.ts` when investigating a Live Feed user journey.

## Read-only boundary

Use the existing public page and `/api/feed-v2` response. Do not add a public
debug endpoint, browser instrumentation, persistent logs, WebMCP/MCP, or a
second feed API. Do not expose cookies, tokens, internal errors, database
details, or unpublished data. Browser extensions may block direct JSON tabs;
`ERR_BLOCKED_BY_CLIENT` alone is not evidence of a product defect.

## State interpretation

The selected filter drives the existing `GET /api/feed-v2?filter=<filter>`
request. `resolveLiveFeedV2FlowState` joins that selection with the response
availability and row count plus the client request state:

- `loading`: the selected filter request is in progress.
- `unavailable`: the response explicitly says `availability: "unavailable"`.
- `error`: the request failed or the API returned a non-success response.
- `empty`: the response says `availability: "available"` and has zero rows.
- `ready`: the response says `availability: "available"` and has rows.
- `unknown`: no confirmed response availability exists; do not treat it as
  available, empty, or an error.

The feed column exposes only safe derived DOM state through
`data-feed-filter`, `data-feed-state`, `data-feed-availability`,
`data-feed-row-count`, and `data-feed-total-count`. Human-facing state copy is
rendered from the same model. API `error` details stay out of the DOM.

## Browser evidence

For a candidate, verify the logged-out direct `/feed` journey at desktop,
intermediate, and actual CSS 390px widths. Record the selected filter's
role/name and `aria-pressed`, the matching feed GET and response status/body
shape, the final human and DOM state, console errors, and horizontal overflow.
Use the All filter to check an available result when data permits; if an
available zero-row response cannot be produced safely, record that check as
unverified rather than mocking a browser result.
