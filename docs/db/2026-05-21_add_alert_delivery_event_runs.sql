-- Alert delivery batch run log.
-- This table records which analyzed events have already been evaluated for personalized delivery.
-- It does not modify events, raw_items, event_analysis, event_tickers, deliveries, or notification_subscriptions.

create table if not exists alert_delivery_event_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  status text not null default 'processed'
    check (status in ('processed', 'failed', 'skipped')),
  dry_run boolean not null default false,
  processed_at timestamptz not null default now(),
  deliveries_created int not null default 0,
  duplicates_skipped int not null default 0,
  candidates_found int not null default 0,
  suppressed_count int not null default 0,
  failed_count int not null default 0,
  result_summary jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists alert_delivery_event_runs_event_write_unique
  on alert_delivery_event_runs(event_id)
  where dry_run = false;

create index if not exists alert_delivery_event_runs_event_idx
  on alert_delivery_event_runs(event_id);

create index if not exists alert_delivery_event_runs_status_processed_idx
  on alert_delivery_event_runs(status, processed_at desc);

create index if not exists alert_delivery_event_runs_processed_idx
  on alert_delivery_event_runs(processed_at desc);

create or replace function set_alert_delivery_event_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists alert_delivery_event_runs_set_updated_at on alert_delivery_event_runs;
create trigger alert_delivery_event_runs_set_updated_at
  before update on alert_delivery_event_runs
  for each row execute function set_alert_delivery_event_runs_updated_at();

-- Dry runs intentionally do not need to be persisted. If persisted later, they will not trip the write-run unique index.
-- RLS remains disabled for now. Add auth.uid() policies when Supabase Auth is wired.
