begin;

create table public.financial_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null default 'financial',
  conditions jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint financial_monitors_domain_check check (domain = 'financial'),
  constraint financial_monitors_conditions_array_check check (
    pg_catalog.jsonb_typeof(conditions) = 'array'
    and pg_catalog.jsonb_array_length(conditions) > 0
  )
);

comment on table public.financial_monitors is
  'Owner-scoped deterministic SEC periodic Financial Monitor definitions. Exact decimal thresholds are stored as JSON strings.';

create index financial_monitors_user_created_idx
  on public.financial_monitors (user_id, created_at desc, id desc);
create index financial_monitors_active_user_created_idx
  on public.financial_monitors (user_id, created_at desc, id desc)
  where is_active;

alter table public.financial_monitors enable row level security;
revoke all on table public.financial_monitors from public, anon, authenticated;
grant select, insert, update, delete on table public.financial_monitors to authenticated;
grant select, insert, update, delete on table public.financial_monitors to service_role;

create policy financial_monitors_select_own on public.financial_monitors
for select to authenticated using ((select auth.uid()) = user_id);
create policy financial_monitors_insert_own on public.financial_monitors
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy financial_monitors_update_own on public.financial_monitors
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy financial_monitors_delete_own on public.financial_monitors
for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.user_alert_deliveries
  add column financial_monitor_id uuid,
  add column financial_source_execution_id uuid,
  add column financial_accession text,
  add column financial_issuer_cik text;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_financial_monitor_id_fkey
    foreign key (financial_monitor_id) references public.financial_monitors (id)
    on update restrict on delete set null,
  add constraint user_alert_deliveries_financial_source_execution_id_fkey
    foreign key (financial_source_execution_id) references public.ai_runs (id)
    on update restrict on delete restrict,
  add constraint user_alert_deliveries_financial_accession_check
    check (financial_accession is null or financial_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  add constraint user_alert_deliveries_financial_issuer_cik_check
    check (financial_issuer_cik is null or financial_issuer_cik ~ '^[0-9]{10}$'),
  add constraint user_alert_deliveries_financial_alert_shape_check
    check (
      financial_monitor_id is null
      or (
        alert_domain = 'financial'
        and financial_source_execution_id is not null
        and financial_accession is not null
        and financial_issuer_cik is not null
        and alert_event_id is not null
        and category = 'financial_risk'
        and alert_lane = 'financial_monitor'
        and delivery_status = 'queued'
        and delivered_channels = array[]::text[]
        and scheduled_for is null
        and sent_at is null
        and attempted_at is null
      )
    ),
  add constraint user_alert_deliveries_financial_monitor_event_key
    unique (financial_monitor_id, alert_event_id);

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_alert_domain_check,
  add constraint user_alert_deliveries_alert_domain_check
    check (alert_domain is null or alert_domain in ('listing', 'offering', 'financial')),
  drop constraint user_alert_deliveries_alert_lane_check,
  add constraint user_alert_deliveries_alert_lane_check
    check (alert_lane in ('watchlist', 'market_discovery', 'calendar_follow', 'listing_monitor', 'offering_monitor', 'financial_monitor'));

comment on column public.user_alert_deliveries.financial_monitor_id is
  'Financial Monitor that produced this internal Alert; null for other lanes and after monitor deletion.';
comment on column public.user_alert_deliveries.financial_source_execution_id is
  'Exact completed deterministic Periodic Financial child execution used for matching.';
comment on column public.user_alert_deliveries.financial_accession is
  'Exact SEC accession verified across event raw source, child execution, and canonical analysis.';
comment on column public.user_alert_deliveries.financial_issuer_cik is
  'Exact zero-padded issuer CIK verified across raw source and canonical evidence.';
comment on constraint user_alert_deliveries_financial_monitor_event_key on public.user_alert_deliveries is
  'Atomic replay and concurrent-run dedupe for one Financial Monitor and exact event.';

commit;
