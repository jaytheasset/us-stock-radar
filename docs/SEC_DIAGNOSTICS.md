# SEC Diagnostics

This is the canonical starting point for investigating persisted SEC collection
and analysis state. It documents existing development-only read surfaces; it
does not define a new runtime, data model, or execution path.

## Start here

Use the human console when reviewing results interactively:

```text
/development/sec?room=ownership&tab=live
```

Choose the relevant form room, then search recent saved results by ticker or
accession. The UI also accepts company name and CIK. Selecting a result shows
collection lineage, the first analysis result, validation warnings, correction
execution and basis, and the before/after values when that trace was recorded.
Execution controls are a separate part of the console and are not part of a
read-only investigation.

Use the structured diagnostics response when a machine-readable result is more
appropriate:

```text
GET /api/development/sec-form-room?room=<ROOM_KEY>&view=diagnostics&ticker=<TICKER>
GET /api/development/sec-form-room?room=<ROOM_KEY>&view=diagnostics&accession=<ACCESSION_NUMBER>
GET /api/development/sec-form-room?room=<ROOM_KEY>&view=diagnostics&eventId=<EVENT_UUID>
```

The only accepted query keys for `view=diagnostics` are `room`, `view`,
`eventId`, `ticker`, and `accession`. `eventId` must be a UUID. Ticker input is
normalized to uppercase and must be 1-10 characters from `A-Z`, `0-9`, `.`, or
`-`. Accession uses the SEC `0000000000-00-000000` format. Start with one
identifier; multiple supplied filters are applied together.

The regular room-detail response contains `detail.diagnosticSnapshot`. The
structured form above returns `diagnostics`. Both are built from the same
recent persisted room data and snapshot builder, so the UI is not a second
source of truth and should not be scraped to reconstruct diagnostics.

## Read-only investigation flow

1. Confirm that the server is a development instance and that the session has
   the administrator `system.read` permission.
2. Choose the form room that owns the filing. In the UI, narrow recent saved
   results by ticker or accession; for an exact event UUID, use the structured
   diagnostics filter.
3. Match `identity` and `timestamps` first. Then inspect collection, background
   analysis, and source-run status before interpreting the analysis trace.
4. Follow the named lineage records and their timestamps. Review `warnings`
   and `errors` without treating an absent record as a successful or failed
   operation.
5. Use the first result, validation, and correction sections only when their
   availability says the trace was recorded. Do not infer a correction from the
   final saved event alone.

## Lineage and status meaning

The snapshot can name these persisted sources:

- `raw_items`
- `source_runs`
- `events`
- `event_analysis`
- `ai_runs`
- `ai_outputs.validation_repair_trace`

Interpret absence conservatively:

| State | Meaning |
| --- | --- |
| `available` | The diagnostic adapter found the named record or trace. |
| `missing` | An identifier exists, but the corresponding record was not available to the snapshot. |
| `unavailable` | The adapter has no record or identifier with which to establish that source. |
| `unknown` | A status value was not recorded; it is neither success nor failure. |
| `record_missing` | A historical analysis or correction trace was not recorded. |
| `empty` | The current room and filters matched no recent persisted diagnostic result. |
| `not_used` | Persisted review read named database records directly; browser or application cache state was not inferred. |

Domain statuses such as `completed` or `failed` may also appear where the
underlying record supplied them. Preserve the original status and timestamp;
do not replace an unknown or missing state with a guess.

## Permission and environment boundary

- `/development/sec` and the GET diagnostics route require server-side
  `system.read` administrator authorization.
- The page and route are disabled when `NODE_ENV=production`: the page resolves
  through `notFound` and the API returns 404. Production-like preview builds
  therefore do not expose this development console.
- The diagnostics GET path reads existing room/domain data. It contains no DB
  mutation, SEC fetch, analysis, cron, alert action, generic SQL/code executor,
  or arbitrary external request facility.
- SEC live/test POST routes are separate and require `data.run`. Permission to
  read diagnostics does not authorize those actions.

Never use execution controls, `/api/development/sec-live`,
`/api/development/sec-tests`, source jobs, cron routes, analysis actions, or
alert actions merely to investigate state. Do not run `npm run sec:live-test`
without explicit authorization: as documented in
`docs/SEC_LIVE_TEST_DIRECTION.md`, it may exercise real development DB
persistence and alert-delivery paths.

## Related readouts and implementation anchors

Database, prompt, integration, source, and health registries remain separate
administrator readouts; see `docs/READOUTS.md`. The SEC diagnostic snapshot does
not claim to provide global request logs, general cache health, cron state, or
all source health.

For architecture and runtime ownership, see `docs/ARCHITECTURE.md` and
`docs/SEC_FORM_RUNTIME_SPLIT.md`. Use `docs/SEC_LIVE_TEST_DIRECTION.md` only
when a separately authorized task actually requires live execution.

When checking this document for drift, compare it with:

- `app/development/sec/page.tsx`
- `app/api/development/sec-form-room/route.ts`
- `app/api/development/sec-live/route.ts`
- `app/api/development/sec-tests/route.ts`
- `lib/development/secFormDevDashboard.ts`
- `lib/development/secDiagnosticSnapshot.ts`
- `lib/development/secDiagnosticSnapshot.test.ts`
- `lib/development/secRepairObservability.test.ts`
