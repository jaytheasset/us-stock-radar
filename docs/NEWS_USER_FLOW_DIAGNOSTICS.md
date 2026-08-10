# News user-flow diagnostics

Start at `/news`, `components/news-v2/StockRadarNewsV2.tsx`, and
`lib/newsV2FlowState.ts` when investigating the global News user journey.

## Selected user flow and existing GET

Use the accessible search combobox named `Search news by ticker or company`
and the `Search` button. A submitted query keeps the user on `/news` and uses
the existing public request:

```text
GET /api/news-v2?query=<QUERY>&include_total=true
```

Do not treat the draft combobox value as applied until the user submits it.
The response `items`, `totalCount`, and optional `error` feed the same client
state that renders the visible list and safe DOM observation.

## Shared safe state

`resolveNewsV2FlowState` combines the applied query and filters with request
progress, response failure, visible item count, and total count:

- `loading`: the selected News request is in progress.
- `ready`: at least one story is visible. A later load-more failure does not
  relabel already visible stories as unavailable.
- `source-empty`: a successful result whose visible and total counts both
  confirm zero stories, with no applied query or filter.
- `filter-empty`: a successful zero-story result with an applied query or
  filter.
- `unknown`: visible and total counts conflict without an active criterion or
  confirmed error. The screen and `data-news-state` say the state is not
  confirmed rather than inferring source-empty or unavailable.
- `unavailable`: the selected initial/refresh request failed and no stories
  remain visible. No unconfirmed failure reason is inferred.

The list result label and empty-state copy render from that object. The list
anchor exposes only `data-news-state`, `data-news-visible-count`,
`data-news-total-count`, and `data-news-has-active-criteria`. Raw error text,
response bodies, query text, tokens, cookies, and account data stay out of
diagnostic DOM values.

## Read-only browser evidence

Verify the logged-out direct `/news` journey at PC, intermediate CSS width,
and 390px. Record the combobox/button roles and names, submitted condition,
unchanged page URL, matching GET, response HTTP status and safe count fields,
visible result label/story count, `aria-busy`, the four `data-news-*` values,
console errors, and horizontal overflow.

Use a query matching current public data for a real success comparison. Do
not change product/DB data to force zero or failure states. When source-empty,
filter-empty, loading, unavailable, or inconsistent counts cannot be produced
safely, verify the pure resolver branches with unit inputs and report those
browser states as unverified. In particular, `visibleCount: 0` with a positive
`totalCount`, no active criterion, and no error is fixture-only evidence for
`unknown`; it must not be reported as a browser-confirmed source-empty result.

## Investigation boundary

Use only the existing public page and `/api/news-v2` GET. Do not add a debug
API, console, persistent log, WebMCP/MCP surface, test data, forced cache
change, ingestion/analysis run, SQL, migration, permission, plan, or product
state change. A read failure is evidence of an unavailable request, not proof
that underlying data does not exist.
