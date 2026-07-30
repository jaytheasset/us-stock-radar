# Calendar FMP Company ingest

Calendar 2B adds a protected, manual-only ingestion path for FMP Company
calendar events. It does not add a workflow lane, Vercel Cron, alert delivery,
or Macro/Policy provider.

## Endpoint and scope

- Protected route: `/api/sources/fmp-calendar/ingest`
- FMP stable endpoints: earnings, dividends, splits, and IPO calendars
- GET is always dry-run.
- POST persists only when `dryRun=false`, `persist=true`, and `mode=backfill`.
- Requests are limited to 93 days. Every provider call uses a one-day
  `from=to` window with concurrency 2 and a 15-second timeout.
- A daily response at the 4,000-row provider cap is marked `truncated`.
  Truncated or partially failed runs never persist.
- Responses contain aggregate and per-endpoint statistics only. They never
  include the FMP API key or raw rows.

## Allowed ticker universe

The authoritative universe is `public.tickers`: active `stock` or
`adr_or_class` rows on the NASDAQ, NYSE, or AMEX exchange families. The local
reference measurement was 5,492 symbols.

For 2026-07-27 through 2026-08-02, daily FMP requests produced:

| Type | Fetched | Accepted in listed universe |
| --- | ---: | ---: |
| Earnings | 2,294 | 967 |
| Dividends | 557 | 96 |
| Splits | 17 | 12 |
| IPO | 28 | 1 already-listed ticker |

The listed total was roughly 1,076, below the Calendar read limit of 2,000.
The ingest never silently slices accepted events. It returns `readLimitRisk`
when a requested range would exceed the limit.

IPO symbols often do not exist in `tickers` before listing. A valid company
and supported exchange therefore creates an `ipo-candidate` observation with
no security relation. A current ticker match is counted separately as listed.
The opaque FMP `daa` field is neither interpreted nor persisted into normalized
details.

## Provider identity limitation

FMP calendar rows do not provide immutable provider event IDs. Calendar uses
tested occurrence identities that do not include the mutable scheduled event
date:

- Earnings: ticker plus calendar year/quarter.
- Dividend: ticker, verified declaration or record occurrence, normalized
  amount, and frequency. Implausible auxiliary dates are nullable and excluded
  from identity.
- Split: ticker, occurrence year, and reduced numerator/denominator ratio.
  Forward/reverse comes from the ratio, not an unverified label.
- IPO: normalized symbol/TBA, company, and exchange.

Conflicting normalized observations for the same identity are quarantined
instead of being written as separate confirmed events.

## Atomic persistence and history

HTTP collection and normalization finish before persistence. Each accepted
observation is sent to the service-role-only
`public.ingest_fmp_calendar_observation(jsonb)` RPC. The invoker function takes
a transaction advisory lock on canonical identity and atomically writes:

1. private prelaunch raw payload,
2. normalized event,
3. FMP source,
4. optional primary security,
5. typed details,
6. history when normalized state changed.

Identical observations update source checksum/fetch time and event
`last_seen_at` without increasing revision/history. Schedule changes,
first release, and result changes create `schedule-changed`, `released`, or
`result-updated` history respectively.

Raw rows remain `is_development_data=true`,
`retention_mode='prelaunch_long_term'`, and `purge_after=null`. No automatic
purge is installed.

## Before production

- Confirm FMP storage, redistribution, and retention rights.
- Replace prelaunch retention with the contract-approved duration.
- Purge development raw rows and verify the purge.
- Validate provider cap behavior and identity collisions with production-scale
  observations.
- Add live-mode alert candidate policy separately; backfill must remain
  non-alerting.
- Implement Macro/Policy official-source adapters separately.
- Enable automation only after UI, identity, retention, and alert reviews.
