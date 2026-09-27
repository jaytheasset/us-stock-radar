create table if not exists public.listing_monitor_evaluation_records (
  id uuid primary key default gen_random_uuid(),
  processing_attempt_id uuid not null,
  event_id uuid not null,
  source_execution_id uuid,
  monitor_id uuid not null,
  owner_user_id uuid not null,
  alert_id uuid,
  monitor_kind text not null,
  evaluated_at timestamptz not null,
  evaluation_status text not null,
  evaluation_reason_code text not null,
  notification_status text not null,
  notification_reason_code text not null,
  notification_error text,
  monitor_snapshot jsonb not null,
  filing_snapshot jsonb not null,
  evaluation_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint listing_monitor_evaluation_records_kind_check check (
    monitor_kind = 'form4_insider_purchase'
  ),
  constraint listing_monitor_evaluation_records_evaluation_status_check check (
    evaluation_status = any (array['match'::text, 'no_match'::text, 'ineligible'::text])
  ),
  constraint listing_monitor_evaluation_records_notification_status_check check (
    notification_status = any (array['created'::text, 'existing'::text, 'not_created'::text, 'failed'::text])
  ),
  constraint listing_monitor_evaluation_records_notification_error_check check (
    (notification_status = 'failed' and notification_error is not null)
    or (notification_status <> 'failed' and notification_error is null)
  )
);

comment on table public.listing_monitor_evaluation_records is
  'Append-only service-owned history of actual Form 4 monitor evaluation and internal alert-consumer outcomes.';

create index if not exists listing_monitor_evaluation_records_event_idx
  on public.listing_monitor_evaluation_records (event_id, evaluated_at desc);

create index if not exists listing_monitor_evaluation_records_monitor_idx
  on public.listing_monitor_evaluation_records (monitor_id, evaluated_at desc);

create index if not exists listing_monitor_evaluation_records_owner_idx
  on public.listing_monitor_evaluation_records (owner_user_id, evaluated_at desc);

create index if not exists listing_monitor_evaluation_records_alert_idx
  on public.listing_monitor_evaluation_records (alert_id)
  where alert_id is not null;

alter table public.listing_monitor_evaluation_records enable row level security;
revoke all on table public.listing_monitor_evaluation_records
  from public, anon, authenticated, service_role;
grant select, insert on table public.listing_monitor_evaluation_records to service_role;
