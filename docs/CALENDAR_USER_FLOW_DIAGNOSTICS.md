# Calendar user-flow diagnostics

Start at `/calendar`, `components/calendar-v1/StockRadarCalendarV1.tsx`, and
`lib/calendar-v1/flowState.ts` when investigating the global Calendar journey.

## Selected user flow and existing GET

Advance the visible range to next week. On PC and intermediate widths, use the
`Date range` tablist and select the `Next Week` tab; the active tab has
`aria-selected="true"`. At 390px, the preset tabs are replaced by mobile range
navigation, so use the visible `Next period` button and confirm the resulting
range label. In both layouts the page stays on `/calendar`, calculates the
same date-only range, and uses the existing public request:

```text
GET /api/calendar/normalized?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
```

Compare the selected tab and visible range label with response `range`, `ok`,
`count`, and `data.length`. The response data becomes the client source list;
search and filter controls then derive the visible list without another
Calendar data request.

## Shared safe state

`resolveCalendarFlowState` combines the selected range, request state, source
row count, post-filter count, and active-filter count:

- `loading`: the selected range request is in progress.
- `ready`: the successful source has rows and the active client state leaves
  visible rows.
- `source-empty`: a successful selected-range result has zero source rows.
- `filter-empty`: the source has rows but applied client filters leave zero.
- `unavailable`: the selected range request or public response failed.
- `unknown`: counts are inconsistent or otherwise do not confirm a supported
  interpretation; do not infer empty or unavailable.

The results summary and status-panel copy render from the same object. The
`Calendar results` region exposes only `data-calendar-state`,
`data-calendar-source-count`, `data-calendar-visible-count`,
`data-calendar-active-filter-count`, `data-calendar-range-from`, and
`data-calendar-range-to`. Raw error text, response bodies, search text,
cookies, tokens, and account data stay out of diagnostic DOM values.

## Read-only browser evidence

Verify the logged-out direct `/calendar` journey at PC, intermediate CSS
width, and 390px. Record the visible range control's role/name/selection where
applicable, visible range, matching normalized GET, safe response fields,
visible summary/status, safe DOM values, console errors, and horizontal
overflow.

Use search only after confirming a populated source range when checking
filter-only empty. Do not change DB or product data to create empty or failure
states. The existing `?state=loading|error|empty` query is a presentation
preview, not real request/response evidence; if a real state cannot be
produced safely, test the pure resolver input and report browser verification
as unverified.

## Investigation boundary

Use only the public page and existing normalized Calendar GET. Do not run the
legacy route QA script because it creates and removes test data. Do not add a
debug API, console, persistent log, WebMCP/MCP surface, seed, ingestion run,
SQL, migration, cache change, permission, plan, follow, watchlist, or product
state mutation. A read failure does not prove that underlying Calendar data
does not exist.
