# Alert Delivery Runbook

This runbook covers the STOCK RADAR personalized alert delivery scheduler.

Current deployment strategy:

- Use Render only for now.
- Deploy the Next.js app as a Render Web Service.
- Run alert delivery with a Render Cron Job using the scheduler CLI.
- Keep `POST /api/cron/alert-delivery` as a protected backup endpoint for external cron or manual operations.
- Do not build a Vercel native Cron GET wrapper now.

The delivery system is not a news or SEC analysis pipeline. It only takes already-created `events` and decides which users should receive personalized delivery based on watchlist, discovery categories, preferences, plan limits, and delivery channels.

## Current Render-Only Architecture

### Render Web Service

The Render Web Service hosts the Next.js app and API routes:

- `/alerts`
- `/watchlist`
- `/premium`
- `/api/alerts/*`
- `/api/watchlist/*`
- `/api/telegram/webhook`
- `/api/cron/alert-delivery`

The protected cron endpoint remains available, but it is not the primary scheduling path while using Render.

### Render Cron Job

The Render Cron Job runs the alert delivery scheduler as a command:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

This is preferred over calling the HTTP cron endpoint from Render because:

- the scheduler already exists as a CLI command;
- the CLI defaults to dry-run unless `--write` is passed;
- Render Cron Jobs are designed to run commands;
- the app-level job lock still protects against overlap;
- no HTTP cron secret is required for the primary Render cron path.

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

## Render Environment Variables

### Render Web Service Env

Required for the Next.js app and API routes:

```bash
SUPABASE_URL=<value>
SUPABASE_SERVICE_ROLE_KEY=<value>
SUPABASE_DB_URL=<value>
```

Required for Telegram connect flow and webhook verification:

```bash
TELEGRAM_BOT_TOKEN=<value>
TELEGRAM_BOT_USERNAME=<value>
TELEGRAM_WEBHOOK_SECRET=<value>
```

Required only if using the protected HTTP cron endpoint:

```bash
ALERT_DELIVERY_CRON_SECRET=<secret>
# or
CRON_SECRET=<secret>

ALERT_DELIVERY_CRON_WRITE_ENABLED=false
```

### Render Cron Job Env

Required:

```bash
SUPABASE_URL=<value>
SUPABASE_SERVICE_ROLE_KEY=<value>
SUPABASE_DB_URL=<value>
```

Telegram-related:

```bash
TELEGRAM_BOT_TOKEN=<value>
TELEGRAM_BOT_USERNAME=<value>
TELEGRAM_WEBHOOK_SECRET=<value>
ALERT_DELIVERY_SEND_TELEGRAM=false
```

For the default Render CLI Cron Job path:

- `ALERT_DELIVERY_CRON_SECRET` is not required.
- `CRON_SECRET` is not required.
- `ALERT_DELIVERY_CRON_WRITE_ENABLED` is not required.
- `--write` is the CLI write gate.
- `ALERT_DELIVERY_SEND_TELEGRAM=true` is still required before actual Telegram messages can be sent.

Never print env values in logs, shell output, support screenshots, run logs, or commit messages.

## Render Cron Job Setup

Use Render Cron Job with the scheduler CLI.

Build command:

```bash
npm install
```

Phase 1 dry-run command:

```bash
npm run deliver:scheduler -- --limit 50 --queued-limit 50 --lookback-hours 6
```

Phase 2 write command, Telegram send off:

```bash
npm run deliver:scheduler -- --write --limit 50 --queued-limit 50 --lookback-hours 6
```

Initial schedule:

- Start with every 5 minutes.
- After stability is confirmed, consider every 1-2 minutes if needed.
- Keep schedules in UTC.

Keep the application lock enabled. The scheduler uses `alert_delivery_job_locks` to protect against overlapping execution.

## Protected HTTP Cron Endpoint

Endpoint:

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

- external cron providers that can call POST with custom headers;
- manual operator runs;
- fallback operations if Render Cron Job is not used;
- curl-based Render cron if command-based cron is not preferred.

Dry-run request:

```bash
curl -X POST "https://YOUR_RENDER_DOMAIN/api/cron/alert-delivery?limit=50&queuedLimit=50&lookbackHours=6" \
  -H "Authorization: Bearer $ALERT_DELIVERY_CRON_SECRET"
```

Write request:

```bash
curl -X POST "https://YOUR_RENDER_DOMAIN/api/cron/alert-delivery?write=true&limit=50&queuedLimit=50&lookbackHours=6" \
  -H "Authorization: Bearer $ALERT_DELIVERY_CRON_SECRET"
```

The endpoint write request is blocked unless:

```bash
ALERT_DELIVERY_CRON_WRITE_ENABLED=true
```

This endpoint gate is separate from the CLI `--write` flag.

## Operating Phases

### Phase 1: Render Cron dry-run

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

### Phase 3: Telegram staging QA

Use only a staging bot and a small number of test users.

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

- Staging has passed with real Telegram messages.
- The bot token belongs to the intended environment.
- The webhook URL is correct:
  - `https://YOUR_RENDER_DOMAIN/api/telegram/webhook`
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

Register Telegram webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_RENDER_DOMAIN/api/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'"
  }'
```

Do not paste real token values into shared logs.

## Future Vercel Frontend-Only Split

Not now.

If needed later, split the deployment like this:

- Vercel: frontend only.
- Render: API server, cron jobs, Telegram webhook, delivery workers.
- Frontend calls Render backend through a configured API base URL.

Example frontend env:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

That split requires a separate design for:

- CORS;
- auth;
- cookies/session handling;
- API base URL routing;
- deployment boundaries.

Vercel native Cron is still not required in that split. Keeping cron on Render remains simpler because the scheduler is a CLI worker.

If Vercel native Cron is ever required, add a dedicated GET wrapper route at that time. Do not implement that wrapper now.

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

## Immediate TODO

1. Render Cron Job dry-run 설정.
2. Render Cron Job write mode 설정, Telegram send off.
3. Scheduler run log 모니터링.
4. Telegram staging E2E QA.
5. Production Telegram send 제한 활성화.

## Not Now

- Vercel GET cron wrapper.
- Frontend/backend split.
- Email adapter.
- Webhook/API adapter.
- Saved Alert Rules.

## Source References

- Render Cron Jobs: https://render.com/docs/cronjobs
- Vercel Cron Jobs, only for future frontend split review: https://vercel.com/docs/cron-jobs
