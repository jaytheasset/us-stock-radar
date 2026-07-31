# Calendar local seed

The Calendar local QA dataset is restored by `supabase/seed.sql` after all
migrations. Supabase documents seed files as the reproducible local data layer
run after migrations during `db reset`:

- https://supabase.com/docs/guides/local-development/seeding-your-database
- https://supabase.com/docs/guides/local-development/cli-workflows

## Reset and seed the local stack

Run only against the local project:

```powershell
npm run calendar:reset-seed:local
```

`npm run supabase:db:reset` also loads the same seed because `[db.seed]` is
enabled in `supabase/config.toml`. Never add `--linked` or a remote `--db-url`
to either command. A reset destroys current local development rows before
replaying migrations and the deterministic seed.

The fixture covers `2026-07-27` through `2026-08-02`, so the full validation
window is:

```text
http://127.0.0.1:3110/api/calendar/normalized?from=2026-07-27&to=2026-08-02
http://127.0.0.1:3110/api/calendar?from=2026-07-27&to=2026-08-02
http://127.0.0.1:3110/calendar
```

Expected reset counts are 22 normalized events and 22 legacy calendar items:

| Category | Event types | Rows |
| --- | --- | ---: |
| Company | Earnings, dividend, split, IPO | 4 |
| Macro | All seven Calendar Macro types | 7 |
| Policy | All eleven Calendar Policy types | 11 |

The seed includes released and scheduled rows, exact ET times, all-day and TNA
rows, Macro actual/consensus/previous metrics, Company details, Policy details,
primary/related securities, and affected sectors. It intentionally does not
insert provider raw payloads, event history, alert candidates, user follows, or
delivery attempts. Consequently a reset cannot manufacture a user subscription
or trigger a backfill alert burst.

Every source is labeled `Deterministic local QA fixture`; no source URL or live
provider response is fabricated. The normalized API remains the `/calendar`
source of truth. `event_calendar_items` is populated separately to preserve the
legacy `/api/calendar` QA and downstream analysis contract.

## Optional live local ingest

The existing protected routes remain the only provider ingestion paths. Do not
create another collector or enable a cron:

- Company: `/api/sources/fmp-calendar/ingest`
- Supported Macro/Policy: `/api/sources/fmp-economic-calendar/ingest`

Use GET/dry-run first. A local POST must use the existing source-ingest
authorization, `mode=backfill`, `persist=true`, and `dryRun=false`. Backfill is
non-alerting. Never put the token or FMP key in documentation, browser code, or
command output.
