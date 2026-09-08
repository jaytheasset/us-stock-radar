begin;

create table public.offering_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null default 'offering',
  conditions jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint offering_monitors_domain_check check (domain = 'offering'),
  constraint offering_monitors_conditions_array_check check (
    pg_catalog.jsonb_typeof(conditions) = 'array'
    and pg_catalog.jsonb_array_length(conditions) > 0
  )
);

comment on table public.offering_monitors is
  'Owner-scoped Offering Monitor definitions. Conditions are Registry-validated; matching uses an exact-event Dilution Registry adapter.';

create index offering_monitors_user_created_idx
  on public.offering_monitors (user_id, created_at desc, id desc);

create index offering_monitors_active_user_created_idx
  on public.offering_monitors (user_id, created_at desc, id desc)
  where is_active;

alter table public.offering_monitors enable row level security;

revoke all on table public.offering_monitors from public, anon, authenticated;
grant select, insert, update, delete on table public.offering_monitors to authenticated;
grant select, insert, update, delete on table public.offering_monitors to service_role;

create policy offering_monitors_select_own
on public.offering_monitors
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy offering_monitors_insert_own
on public.offering_monitors
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy offering_monitors_update_own
on public.offering_monitors
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy offering_monitors_delete_own
on public.offering_monitors
for delete
to authenticated
using ((select auth.uid()) = user_id);

alter table public.user_alert_deliveries
  add column offering_monitor_id uuid,
  add column offering_registry_accession text,
  add column offering_registry_snapshot_id bigint;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_offering_monitor_id_fkey
    foreign key (offering_monitor_id)
    references public.offering_monitors (id)
    on update restrict
    on delete set null,
  add constraint user_alert_deliveries_offering_registry_snapshot_id_fkey
    foreign key (offering_registry_snapshot_id)
    references public.dilution_instrument_snapshots (id)
    on update restrict
    on delete restrict,
  add constraint user_alert_deliveries_offering_registry_accession_check
    check (
      offering_registry_accession is null
      or offering_registry_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
    ),
  add constraint user_alert_deliveries_offering_alert_shape_check
    check (
      offering_monitor_id is null
      or (
        alert_domain = 'offering'
        and offering_registry_accession is not null
        and offering_registry_snapshot_id is not null
        and alert_event_id is not null
        and category = 'dilution_risk'
        and alert_lane = 'offering_monitor'
        and delivery_status = 'queued'
        and delivered_channels = array[]::text[]
        and scheduled_for is null
        and sent_at is null
        and attempted_at is null
      )
    ),
  add constraint user_alert_deliveries_offering_monitor_event_key
    unique (offering_monitor_id, alert_event_id);

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_alert_domain_check,
  add constraint user_alert_deliveries_alert_domain_check
    check (alert_domain is null or alert_domain in ('listing', 'offering')),
  drop constraint user_alert_deliveries_alert_lane_check,
  add constraint user_alert_deliveries_alert_lane_check
    check (
      alert_lane in (
        'watchlist',
        'market_discovery',
        'calendar_follow',
        'listing_monitor',
        'offering_monitor'
      )
    );

comment on column public.user_alert_deliveries.offering_monitor_id is
  'Offering Monitor that produced this internal Alert; null for other lanes and after monitor deletion.';
comment on column public.user_alert_deliveries.offering_registry_accession is
  'Exact SEC accession shared by the event/raw item and Dilution Registry snapshot used for matching.';
comment on column public.user_alert_deliveries.offering_registry_snapshot_id is
  'Exact Dilution Registry snapshot used as the Offering fact source.';
comment on column public.user_alert_deliveries.alert_domain is
  'Monitor domain for internal rule alerts. Supported values are listing and offering.';
comment on constraint user_alert_deliveries_offering_monitor_event_key
  on public.user_alert_deliveries is
  'Atomic replay dedupe for one Offering Monitor and exact event.';

commit;
