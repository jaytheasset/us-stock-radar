# Markets Dashboard mover diagnostics

Start at `/dashboard-v2`, `components/dashboard-v2/StockRadarDashboardV2.tsx`,
and `lib/dashboardV2MoverObservation.ts` for the Market movers user journey.

## User selection and existing GET

The accessible controls remain tablists. `Market mover category` contains tabs
named `TOP GAINERS`, `TOP LOSERS`, and `TOP VOLUME`; `Market session` contains
`PRE`, `REGULAR`, and `AFTER`. The active tab in each list has
`aria-selected="true"`.

`getDashboardV2MoversRequest` is the single mapping used by the UI request and
the observation model:

| Category tab | `mode` |
| --- | --- |
| `TOP GAINERS` | `gainers` |
| `TOP LOSERS` | `losers` |
| `TOP VOLUME` | `volume` |

The selected session is sent unchanged as `Pre`, `Regular`, or `After`:

```text
GET /api/dashboard-v2/movers?session=<SESSION>&mode=<MODE>
```

## Shared safe state

`resolveDashboardV2MoverObservation` combines the current category/session,
HTTP status, API `ok`, `available`, `reason`, response-row count, safe freshness
and optional `dataAvailability`, plus the post-filter rendered count. Its
top-level state is `loading`, `ready`, `empty`, `unavailable`, or `error`;
`filtered_empty` is a render state under an API-level `ready` result.

- `ready` requires a successful response with `ok: true`, `available: true`,
  `reason: "ready"`, and response rows. Optional `events`, `marketCap`, or
  `volume` availability may still be `partial`, `empty`, or `unavailable`.
- `empty` requires the explicit `reason: "empty"` with zero response rows.
  Zero rows by itself is not interpreted as empty.
- `unavailable` is reserved for `missing_key` or `session_unavailable`.
- `upstream_error`, a non-success HTTP response, a failed request, or an
  inconsistent response is `error`.

The `Market movers dashboard` region and human-facing status/results use that
same object. Safe DOM attributes expose only the selected tab/session/mode,
derived state and render state, HTTP status, API booleans/reason, response and
rendered counts, freshness, and the three optional availability statuses under
the `data-market-movers-*` prefix. Raw exceptions, API error/message strings,
tokens, cookies, account data, and provider payloads are never projected.

## Read-only investigation boundary

Use the public guest `/dashboard-v2` page and the existing GET only. Record the
selected tabs' role/name/`aria-selected`, matching request, safe response
fields, visible copy, safe DOM attributes, console errors, failed requests,
and horizontal overflow at PC, intermediate, and 390px widths. Do not add or
execute diagnostic-only or forced cache changes or provider refreshes. The
existing public GET remains the normal user flow and may perform its existing
route-owned snapshot persistence; do not change that behavior. If normal empty
or unavailable cannot be produced without changing service/DB state, verify
those branches with isolated tests and mark the real-browser state unverified.
