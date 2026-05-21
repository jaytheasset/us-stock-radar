-- Alert delivery scheduler run logs.
-- This migration only adds scheduler execution observability.
-- It does not modify events, raw_items, event_analysis, event_tickers, deliveries, or notification_subscriptions.

create table if not exists alert_delivery_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  status text not null,
  dry_run boolean not null default true,
  write_enabled boolean not null default false,
  lock_acquired boolean not null default false,
  lock_skipped boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  batch_summary jsonb not null default '{}',
  queued_summary jsonb not null default '{}',
  result_summary jsonb not null default '{}',
  last_error text,
  created_at timestamptz default now(),
  constraint alert_delivery_scheduler_runs_status_check
    check (status in ('running', 'success', 'failed', 'skipped'))
);

create index if not exists alert_delivery_scheduler_runs_started_at_idx
  on alert_delivery_scheduler_runs(started_at desc);

create index if not exists alert_delivery_scheduler_runs_status_started_at_idx
  on alert_delivery_scheduler_runs(status, started_at desc);

create index if not exists alert_delivery_scheduler_runs_run_id_idx
  on alert_delivery_scheduler_runs(run_id);

comment on table alert_delivery_scheduler_runs is
  'Execution log for protected alert delivery scheduler cron runs.';

-- RLS remains disabled for now. Add auth.uid() policies only after Supabase Auth is wired.
