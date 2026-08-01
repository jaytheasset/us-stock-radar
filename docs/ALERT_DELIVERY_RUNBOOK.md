# Alert Delivery Runbook

This runbook covers the STOCK RADAR personalized alert delivery scheduler.

Current deployment strategy:

- Deploy the Next.js app and API routes on Vercel Production.
- Run scheduled alert delivery through the Vercel Cron `GET /api/cron/alert-delivery` contract in `vercel.json`.
- Keep `POST /api/cron/alert-delivery` as a protected manual operator endpoint.
- Host the production Telegram webhook at `https://us-stock-radar.com/api/telegram/webhook`.

The delivery system is not a news or SEC analysis pipeline. It only takes already-created `events` and decides which users should receive personalized delivery based on watchlist, discovery categories, preferences, plan limits, and delivery channels.

## Current Vercel Production Architecture

### Vercel Production Deployment

The Vercel Production deployment hosts the Next.js app and API routes:

- `/alerts`
- `/watchlist`
- `/premium`
- `/api/alerts/*`
- `/api/watchlist/*`
- `/api/telegram/webhook`
- `/api/cron/alert-delivery`

Vercel Cron uses the protected GET route. The protected POST route remains available for intentional manual runs.

### Vercel Cron Job

`vercel.json` invokes the scheduler Route Handler every five minutes:

```text
GET /api/cron/alert-delivery
```

The route contract provides:

- `Authorization: Bearer <CRON_SECRET>` verification for scheduled requests;
- an `ALERT_DELIVERY_CRON_WRITE_ENABLED` production write gate;
- the existing application-level overlap lock;
- durable scheduler and event-run records;
- explicit reconciliation instead of automatic retry for uncertain external sends.

## Vercel Deployment Checklists

### Production Deployment Checklist

Vercel Production should run the Next.js app and API routes.

Repository build command:

```bash
npm run build
```

Before enabling cron delivery, confirm:

- the Vercel Production build succeeds;
- `/alerts` returns 200;
- `/watchlist` returns 200;
- `/premium` returns 200;
- `/api/alerts/settings` returns 200 for the current user context;
- `/api/alerts/delivered?limit=5` returns 200;
- `/api/telegram/webhook` is reachable by Telegram after webhook registration;
- protected cron endpoint rejects unauthorized calls;
- service logs do not print DB URLs, service role keys, Telegram tokens, webhook secrets, or cron secrets.

### Cron Job Dry-Run Checklist

Use this command first:

```bash
npm run deliver:scheduler -- --limit 50 --queued-limit 50 --lookback-hours 6
```

Confirm:

- command exits successfully;
- output is dry-run;
- no `user_alert_deliveries` rows are created;
- no external messages are sent;
- no secret, token, or DB URL is printed;
- scheduler summary shows scanned/would-process counts.

### Cron Job Write Checklist, Telegram Off

Use this command only after dry-run looks correct:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Keep:

```bash
ALERT_DELIVERY_SEND_TELEGRAM=false
```

Confirm:

- `user_alert_deliveries` rows are created or deduped as expected;
- `alert_delivery_scheduler_runs` records `success`;
- `alert_delivery_event_runs` records processed events;
- `/alerts` Delivered Alerts shows `sent` rows only;
- `failed` and `suppressed` rows can be queried;
- Telegram messages are not sent.

### Telegram Prelaunch Checklist

Do this separately after write mode is stable.

- Use the single production bot only during an announced, short prelaunch test window.
- Connect one test Telegram account from `/alerts`.
- Temporarily register the approved local HTTPS tunnel webhook.
- Keep batch limits low.
- Run a single event dry-run first.
- Run a single event `--write` second.
- Enable `ALERT_DELIVERY_SEND_TELEGRAM=true` only for the restricted test.
- Confirm message receipt.
- Restore and verify `https://us-stock-radar.com/api/telegram/webhook` before ending the test window.

## Product Rules

```text
Feed page = browsing all alert-tagged news and filings.
Alerts page = personalized delivery settings and delivered alert history.
Plan limits control delivery, not browsing.
```

Delivery lanes:

- `watchlist`: event ticker matches a user watchlist ticker.
- `market_discovery`: event ticker is outside the user's watchlist and event category is active for that user.

`/alerts` only shows user-specific delivered alerts where:

```sql
delivery_status = 'sent'
```

Queued, failed, and suppressed rows are worker state, not default delivered-alert history.

## System Flow

1. Source ingestion and analysis create rows in `events`, `event_analysis`, `event_tickers`, and related read models.
2. Alert delivery batch scans recent eligible `events`.
3. Each event is normalized into a delivery event shape:
   - `id`
   - `title`
   - `tickers`
   - `primaryTicker`
   - `category`
   - `sourceType`
   - `sourceLabel`
   - `severity`
4. Delivery evaluation chooses user-specific delivery lanes.
5. `user_alert_deliveries` is used as the user-specific delivery job/log table.
6. Free and Ad-Free plans create `queued` rows with a 5-minute delay.
7. Pro and higher can create immediate `sent` rows for web delivery.
8. Queued processor converts due `queued` rows into `sent`, `suppressed`, or `failed`.
9. Scheduler run logs are written to `alert_delivery_scheduler_runs`.
10. Event processing logs are written to `alert_delivery_event_runs`.

## CLI Commands

Default executions are dry-run and must not write delivery rows or send external messages.

```bash
npm run deliver:event -- --event-id <event_id>
npm run deliver:batch
npm run deliver:queued
npm run deliver:scheduler
```

Write mode requires an explicit flag:

```bash
npm run deliver:event -- --event-id <event_id> --write
npm run deliver:batch -- --write --limit 50 --lookback-hours 6
npm run deliver:queued -- --write --limit 50
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Supported scheduler options:

```bash
--write
--limit <number>
--queued-limit <number>
--lookback-hours <number>
--force
--skip-batch
--skip-queued
--lock-ttl-seconds <seconds>
--no-lock
```

## Vercel Environment Variables

### Vercel Production Env

Required for the Next.js app and API routes:

```bash
SUPABASE_URL=<value>
SUPABASE_SERVICE_ROLE_KEY=<value>
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Do not expose it with a `NEXT_PUBLIC_` prefix and do not use it in client components.

Required for Telegram connect flow and webhook verification:

```bash
TELEGRAM_BOT_TOKEN=<value>
TELEGRAM_BOT_USERNAME=<value>
TELEGRAM_WEBHOOK_SECRET=<value>
```

Required for Vercel Cron and protected manual runs:

```bash
CRON_SECRET=<secret>
ALERT_DELIVERY_CRON_WRITE_ENABLED=false
```

Telegram delivery gate:

```bash
ALERT_DELIVERY_SEND_TELEGRAM=false
```

Set these values in the Vercel Production scope. Environment changes take
effect only after a new deployment. `ALERT_DELIVERY_CRON_SECRET` is optional and
used only when a separate secret is desired for manual POST operations.

Never print env values in logs, shell output, support screenshots, run logs, or commit messages.

## Vercel Cron Job Setup

`vercel.json` registers `GET /api/cron/alert-delivery` every five minutes. Vercel
adds the configured `CRON_SECRET` authorization header.

Use the CLI only for local or isolated operator dry-runs:

```bash
npm run deliver:scheduler -- --limit 50 --queued-limit 50 --lookback-hours 6
```

An intentional local write-mode check uses:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Keep `ALERT_DELIVERY_CRON_WRITE_ENABLED=false` for the initial Production deploy,
then enable it and redeploy only after dry-run verification. Keep
`ALERT_DELIVERY_SEND_TELEGRAM=false` through the first write-enabled phase.

Keep the application lock enabled. The scheduler uses `alert_delivery_job_locks` to protect against overlapping execution.

## Protected HTTP Cron Endpoint

Scheduled endpoint:

```text
GET /api/cron/alert-delivery
```

Manual endpoint:

```text
POST /api/cron/alert-delivery
```

Authentication:

```http
Authorization: Bearer <secret>
```

or:

```http
X-Cron-Secret: <secret>
```

This endpoint is kept for:

- manual operator runs;
- isolated dry-run/write verification;
- an explicit fallback if the scheduled Vercel invocation needs diagnosis.

Dry-run request:

```bash
curl -X POST "https://us-stock-radar.com/api/cron/alert-delivery?limit=50&queuedLimit=50&lookbackHours=6" \
  -H "Authorization: Bearer $ALERT_DELIVERY_CRON_SECRET"
```

Write request:

```bash
curl -X POST "https://us-stock-radar.com/api/cron/alert-delivery?write=true&limit=50&queuedLimit=50&lookbackHours=6" \
  -H "Authorization: Bearer $ALERT_DELIVERY_CRON_SECRET"
```

The endpoint write request is blocked unless:

```bash
ALERT_DELIVERY_CRON_WRITE_ENABLED=true
```

This endpoint gate is separate from the CLI `--write` flag.

## Operating Phases

### Phase 1: Local scheduler dry-run

Command:

```bash
npm run deliver:scheduler -- --limit 50 --queued-limit 50 --lookback-hours 6
```

Expected:

- DB write is disabled.
- No `user_alert_deliveries` rows are created.
- No Telegram messages are sent.
- Scheduler output contains no secrets.
- Logs show plausible batch and queued summaries.

### Phase 2: Write enabled, Telegram off

Command:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Env:

```bash
ALERT_DELIVERY_SEND_TELEGRAM=false
```

Expected:

- `user_alert_deliveries` rows can be created.
- Immediate Pro+ web delivery can become `sent`.
- Free/Ad-Free delayed delivery can become `queued`.
- Due queued rows can become `sent`, `suppressed`, or `failed`.
- `/alerts` Delivered Alerts shows only `sent` rows.
- `alert_delivery_scheduler_runs` records scheduler summary.
- `alert_delivery_event_runs` records event-level processing summary.
- Telegram messages are not sent.

### Phase 3: Telegram prelaunch QA

Use the single production bot with a small number of test users during an
announced, short test window. Follow `docs/TELEGRAM_CONNECT.md`, including the
mandatory Production webhook restoration check.

Env:

```bash
ALERT_DELIVERY_SEND_TELEGRAM=true
```

Recommended order:

1. Connect one test user's Telegram from `/alerts`.
2. Confirm `user_delivery_channels.telegram.destination` is populated.
3. Confirm `user_delivery_channels.telegram.verified_at` is not null.
4. Confirm Telegram channel is `enabled = true`.
5. Run a single event first:

```bash
npm run deliver:event -- --event-id <event_id>
```

6. If dry-run output is correct, run:

```bash
npm run deliver:event -- --event-id <event_id> --write
```

7. After single-event QA passes, test the scheduler with conservative limits:

```bash
npm run deliver:scheduler -- --write --limit 1 --queued-limit 1 --lookback-hours 1
```

### Phase 4: Production

Start conservatively:

```bash
npm run deliver:scheduler -- --write --limit 10 --queued-limit 10 --lookback-hours 1
```

Then increase gradually after monitoring:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Production checks:

- monitor `failed` and `suppressed` delivery rows;
- monitor `LOCK_HELD`;
- monitor scheduler duration;
- keep Telegram rollout limited at first;
- keep log output free of secrets.

## Scheduler Run Log Checks

Recent scheduler runs:

```sql
select
  run_id,
  status,
  dry_run,
  write_enabled,
  lock_acquired,
  lock_skipped,
  started_at,
  finished_at,
  duration_ms,
  last_error
from alert_delivery_scheduler_runs
order by started_at desc
limit 20;
```

Run summary:

```sql
select
  run_id,
  batch_summary,
  queued_summary,
  result_summary
from alert_delivery_scheduler_runs
order by started_at desc
limit 5;
```

Failed scheduler runs:

```sql
select
  run_id,
  started_at,
  duration_ms,
  last_error,
  result_summary
from alert_delivery_scheduler_runs
where status = 'failed'
order by started_at desc
limit 20;
```

## Event Run Log Checks

Processed events:

```sql
select
  event_id,
  status,
  processed_at,
  deliveries_created,
  duplicates_skipped,
  candidates_found,
  failed_count,
  last_error
from alert_delivery_event_runs
order by processed_at desc
limit 50;
```

Events with delivery processing failures:

```sql
select
  event_id,
  status,
  processed_at,
  last_error,
  result_summary
from alert_delivery_event_runs
where status = 'failed'
order by processed_at desc
limit 50;
```

## Failed, Suppressed, and Queued Delivery Checks

Delivered rows shown in `/alerts`:

```sql
select
  user_id,
  ticker,
  title,
  category,
  alert_lane,
  delivered_channels,
  delivery_status,
  sent_at
from user_alert_deliveries
where delivery_status = 'sent'
order by sent_at desc
limit 50;
```

Queued rows due now:

```sql
select
  id,
  user_id,
  ticker,
  title,
  scheduled_for,
  delivered_channels
from user_alert_deliveries
where delivery_status = 'queued'
  and scheduled_for <= now()
order by scheduled_for asc
limit 50;
```

Failed rows:

```sql
select
  id,
  user_id,
  ticker,
  title,
  attempted_at,
  last_error
from user_alert_deliveries
where delivery_status = 'failed'
order by attempted_at desc nulls last
limit 50;
```

Suppressed rows:

```sql
select
  id,
  user_id,
  ticker,
  title,
  attempted_at,
  last_error
from user_alert_deliveries
where delivery_status = 'suppressed'
order by attempted_at desc nulls last
limit 50;
```

Common suppressed reason:

```text
No enabled delivery channels available at processing time.
```

This can happen if a queued row becomes due after a user disables channels.

## Lock Held Response

The scheduler uses `alert_delivery_job_locks` to prevent overlapping runs.

Check current lock:

```sql
select
  job_name,
  locked_until,
  locked_by,
  updated_at
from alert_delivery_job_locks
where job_name = 'alert_delivery_scheduler';
```

If `locked_until > now()`, another run owns the lock.

Recommended response:

1. Confirm there is no active scheduler process still running.
2. Wait until `locked_until` expires.
3. Re-run the scheduler.
4. Only manually clear the lock if the process is known dead and the lock is stale.

Manual stale-lock clear:

```sql
update alert_delivery_job_locks
set locked_until = now(), locked_by = null, updated_at = now()
where job_name = 'alert_delivery_scheduler'
  and locked_until < now() + interval '1 minute';
```

Do not clear an active lock casually.

## Telegram Actual Send Checklist

Before setting `ALERT_DELIVERY_SEND_TELEGRAM=true`:

- Prelaunch QA has passed with real Telegram messages.
- The bot token belongs to the intended environment.
- The webhook URL is correct:
  - `https://us-stock-radar.com/api/telegram/webhook`
- Telegram webhook secret is configured and verified.
- Bot webhook registration uses the correct secret token.
- Test users have connected Telegram from `/alerts`.
- `user_delivery_channels.telegram.destination` is populated.
- `user_delivery_channels.telegram.verified_at` is not null.
- `user_delivery_channels.telegram.enabled = true`.
- Scheduler dry-run output looks correct.
- Write mode with Telegram off has created correct web delivery rows.
- Rate/noise limits are acceptable.
- Logs do not print message bodies that contain sensitive user data.
- Logs do not print tokens, secrets, DB URLs, or authorization headers.

Register and inspect the webhook only with the secret-safe PowerShell commands in
`docs/TELEGRAM_CONNECT.md`. That procedure covers Production registration,
`getWebhookInfo`, temporary local-tunnel switching, and mandatory restoration.

## Safety Rules

- Never print `SUPABASE_DB_URL`.
- Never print `SUPABASE_SERVICE_ROLE_KEY`.
- Never print `ALERT_DELIVERY_CRON_SECRET` or `CRON_SECRET`.
- Never print `TELEGRAM_BOT_TOKEN`.
- Never print `TELEGRAM_WEBHOOK_SECRET`.
- Never log `Authorization` headers.
- Never store raw Telegram connect tokens. Only token hashes belong in the DB.
- Never let Telegram send run unless `ALERT_DELIVERY_SEND_TELEGRAM=true`.
- For CLI scheduler, never run write mode unless `--write` is intentional.
- For HTTP cron endpoint, never run write mode unless `ALERT_DELIVERY_CRON_WRITE_ENABLED=true`.
- Keep dry-run as the default for manual commands.
- Keep locks enabled for scheduled runs.
- Keep `user_alert_deliveries.dedupe_key` unique behavior intact.
- Do not use existing `deliveries` or `notification_subscriptions` for this worker.

## Troubleshooting

### CLI scheduler writes nothing

Check whether `--write` is present.

Dry-run is the default:

```bash
npm run deliver:scheduler
```

Write mode:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

### `CRON_SECRET_MISSING`

This only applies to the protected HTTP endpoint.

Set one of:

```bash
ALERT_DELIVERY_CRON_SECRET=<secret>
CRON_SECRET=<secret>
```

### `UNAUTHORIZED`

This only applies to the protected HTTP endpoint.

Check the request header. It must be one of:

```http
Authorization: Bearer <secret>
X-Cron-Secret: <secret>
```

Do not print the secret while debugging.

### `CRON_WRITE_DISABLED`

This only applies to the protected HTTP endpoint.

The endpoint received a write request, but endpoint write mode is not enabled.

Set:

```bash
ALERT_DELIVERY_CRON_WRITE_ENABLED=true
```

### `LOCK_HELD`

Another scheduler run owns the lock, or a prior run died before releasing it.

Check `alert_delivery_job_locks`, wait for expiration, then retry.

### Queued rows are not appearing in `/alerts`

This is expected. `/alerts` shows delivered rows only:

```sql
delivery_status = 'sent'
```

Run the queued processor:

```bash
npm run deliver:queued -- --write --limit 50
```

or the full scheduler:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50
```

### Telegram is connected but no Telegram messages are sent

Check:

```bash
ALERT_DELIVERY_SEND_TELEGRAM=true
```

Also verify:

- channel is `enabled = true`;
- `destination` is set;
- `verified_at` is set;
- bot token is configured;
- webhook is registered.

## Production TODO

1. Deploy Vercel Cron with the write gate off and verify authorization.
2. Enable Vercel Cron write mode with Telegram send off and redeploy.
3. Monitor scheduler run logs.
4. Run the approved Telegram prelaunch E2E QA and restore the Production webhook.
5. Enable production Telegram send with limited rollout.

## Not Now

- Email adapter.
- Webhook/API adapter.
- Saved Alert Rules.

## Source References

- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Functions runtimes: https://vercel.com/docs/functions/runtimes
- Vercel environment variables: https://vercel.com/docs/environment-variables
