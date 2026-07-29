# Normalized Calendar schema

Status: phase 1 database foundation. The Calendar UI still uses mock data. No
provider adapter, ingestion workflow, cron, product API, or alert delivery is
enabled by this schema.

## Boundaries

The normalized Calendar tables are additive. They do not replace or share a
taxonomy with `event_calendar_items`, `calendarEventRegistry.ts`, or
`calendarPolicy.ts`; those objects remain the news and SEC-analysis calendar
contract.

Calendar V1 owns 22 event types:

- Company: Earnings, Dividends, Splits, IPO.
- Macro: CPI, PPI, PCE, Employment Situation, JOLTS, GDP Advance Estimate,
  Retail Sales.
- Policy: FOMC Decision, FOMC Minutes, Fed Chair Semiannual Testimony,
  Treasury Quarterly Borrowing Estimate, Treasury Quarterly Refunding,
  10-Year Treasury Auction, 30-Year Treasury Auction, SEC Major Open Meeting,
  SEC Rule Milestone, Trade Policy Action, FDA Advisory Committee.

`lib/calendar-v1/taxonomyManifest.ts` is the application manifest. The database
verification script compares all type/category/subcategory/label/version rows
against that manifest.

## Tables and identities

| Table | Responsibility | Durable identity |
| --- | --- | --- |
| `calendar_event_types` | Closed Calendar-only taxonomy | `event_type` |
| `calendar_events` | Current canonical event and schedule | `id`; unique `canonical_identity_key` |
| `calendar_event_sources` | Provider/agency observations | partial unique `(provider, source_event_key)` |
| `calendar_event_securities` | Primary/related/affected tickers | `(event_id, ticker)` |
| `calendar_event_sectors` | Primary/related/affected sectors | `(event_id, sector)` |
| `calendar_event_metrics` | Actual/consensus/previous releases | `(event_id, metric_key, release_stage)` |
| `calendar_event_details` | Provider-neutral typed detail JSON | `event_id` |
| `calendar_event_history` | Schedule/result revisions | `(event_id, revision)` and `(event_id, observation_fingerprint)` |
| `user_calendar_event_follows` | Per-user single-event follows | `(user_id, event_id)` |
| `calendar_reminder_rules` | Follow-relative reminder intent | `(follow_id, minutes_before, channel)` |
| `calendar_alert_candidates` | Future idempotent outbox candidates | `candidate_key` |
| `calendar_delivery_attempts` | Future retry/delivery audit | `idempotency_key` |
| `calendar_provider_payloads` | Server-only raw provider archive | `id` |

The canonical identity key must identify the source-independent event series.
It must not contain the scheduled date. A reschedule updates `event_date`,
increments `current_revision`, and appends a history observation instead of
creating another canonical event.

Date-only values use `date`. Exact source schedules retain local `date`,
`time without time zone`, and an IANA timezone alongside a nullable normalized
UTC `timestamptz`. Missing times are never replaced with midnight or a guessed
market session.

Numeric release fields use PostgreSQL `numeric`; the optional text forms and
`unit_raw` preserve provider notation without floating-point loss.

## Access and RLS

The current server integration uses service-role PostgREST calls against the
exposed `public` schema. For that reason, raw payloads are in
`public.calendar_provider_payloads` rather than an unexposed schema that the
current server data path cannot address.

This does not make raw data browser-readable:

| Role | Events/source/metrics/details/history | Raw/outbox/delivery | Follows/reminders |
| --- | --- | --- | --- |
| `anon` | no table grant, no policy | no table grant, no policy | no table grant, no policy |
| `authenticated` | no table grant, no policy | no table grant, no policy | CRUD grant plus owner-only RLS |
| `service_role` | explicit CRUD | explicit CRUD | explicit CRUD |

RLS is enabled on every new `public` table. Follow UPDATE policies have both
`USING` and `WITH CHECK`. Reminder policies resolve ownership through the
parent follow and use `(select auth.uid())`; they do not trust user metadata or
`auth.role()`. No view, public function, or `SECURITY DEFINER` function is added.

These explicit grants are intentional because Supabase treats table grants and
RLS as separate Data API layers. See
[Securing your API](https://supabase.com/docs/guides/api/securing-your-api) and
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Delete and history policy

- Canonical events use restrictive foreign keys. An event with sources,
  metrics, follows, outbox candidates, or history cannot be removed
  accidentally.
- Account deletion cascades transient follow/reminder preferences.
- A deleted follow sets the delivery attempt's follow reference to null.
- A deleted profile sets the delivery attempt's user reference to null.
- Raw payload cleanup sets source references to null rather than deleting
  normalized source observations.
- Candidates and delivery attempts use restrictive relationships so retry and
  delivery history cannot disappear through a parent cascade.

## Prelaunch raw retention

During development and test, raw provider payloads use:

- `retention_mode = 'prelaunch_long_term'`
- `purge_after = null`
- `is_development_data = true`
- provider, request window, checksum, fetch time, and ingest run ID metadata

The database rejects a non-null `purge_after` while a row remains in
`prelaunch_long_term`. No cleanup function, job, workflow, or cron is created.
Raw payloads must never be returned by a product route or UI.

Before release:

1. Confirm FMP and every provider's storage and redistribution terms.
2. Approve a production retention duration per provider/data class.
3. Inventory and bulk-purge all development/test raw payloads.
4. Verify the purge by provider, request window, and ingest run.
5. Migrate new production rows to `contract_bound` with an explicit
   `purge_after`.
6. Implement, review, and enable server-only cleanup with audit logs.
7. Re-run grant, RLS, Data API, and recovery tests before enabling collection.

## Verification

Run against the already-running local Supabase stack:

```powershell
npm run verify:calendar-db
npm run supabase:db:lint
```

The verifier runs all mutations in a transaction and rolls them back. It checks
the 22-row taxonomy, constraints, indexes, foreign-key delete actions, grants,
RLS policies, service-role access, anonymous denial, cross-user IDOR denial,
canonical/source/history deduplication, and raw retention defaults.
