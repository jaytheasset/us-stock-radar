begin;

create table public.sc13_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null default 'sc13',
  issuer_cik text not null,
  reporting_person_cik text not null,
  security_class text not null,
  cusips text[] not null,
  conditions jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint sc13_monitors_domain_check check (domain = 'sc13'),
  constraint sc13_monitors_issuer_cik_check check (issuer_cik ~ '^\d{10}$'),
  constraint sc13_monitors_reporting_person_cik_check check (reporting_person_cik ~ '^\d{10}$'),
  constraint sc13_monitors_security_class_check check (
    length(security_class) between 1 and 200
    and security_class = upper(regexp_replace(btrim(security_class), '\s+', ' ', 'g'))
  ),
  constraint sc13_monitors_cusips_check check (
    cardinality(cusips) between 1 and 20
    and array_position(cusips, null) is null
    and array_position(cusips, '') is null
  ),
  constraint sc13_monitors_conditions_array_check check (
    pg_catalog.jsonb_typeof(conditions) = 'array'
    and pg_catalog.jsonb_array_length(conditions) > 0
    and pg_catalog.jsonb_array_length(conditions) <= 6
  )
);

comment on table public.sc13_monitors is
  'Owner-scoped Schedule 13 monitors for one exact issuer, reporter, security class, and CUSIP position. Conditions compare latest saved filing values, never real-time ownership.';
comment on column public.sc13_monitors.conditions is
  'Registry-validated exact-decimal conditions. No aggregation, estimation, LLM completion, or last-reported fallback is allowed.';

create index sc13_monitors_user_created_idx on public.sc13_monitors (user_id, created_at desc, id desc);
create index sc13_monitors_active_issuer_idx on public.sc13_monitors (issuer_cik, created_at, id) where is_active;

alter table public.sc13_monitors enable row level security;
revoke all on table public.sc13_monitors from public, anon, authenticated;
grant select, insert, update, delete on table public.sc13_monitors to authenticated;
grant select, insert, update, delete on table public.sc13_monitors to service_role;

create policy sc13_monitors_select_own on public.sc13_monitors
for select to authenticated using ((select auth.uid()) = user_id);
create policy sc13_monitors_insert_own on public.sc13_monitors
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sc13_monitors_update_own on public.sc13_monitors
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy sc13_monitors_delete_own on public.sc13_monitors
for delete to authenticated using ((select auth.uid()) = user_id);

create trigger sc13_monitors_set_updated_at
before update on public.sc13_monitors
for each row execute function public.set_user_alert_updated_at();

alter table public.user_alert_deliveries
  add column sc13_monitor_id uuid,
  add column sc13_position_key text,
  add column sc13_root_accession text,
  add column sc13_head_accession text,
  add column sc13_reporter_cik text,
  add column sc13_security_class text,
  add column sc13_cusips text[],
  add column sc13_match_evidence jsonb;

alter table public.user_alert_deliveries
  add constraint user_alert_deliveries_sc13_monitor_id_fkey
    foreign key (sc13_monitor_id) references public.sc13_monitors (id)
    on update restrict on delete set null,
  add constraint user_alert_deliveries_sc13_root_accession_fkey
    foreign key (sc13_root_accession) references public.sec_sc13_filings (accession_number)
    on update restrict on delete restrict,
  add constraint user_alert_deliveries_sc13_head_accession_fkey
    foreign key (sc13_head_accession) references public.sec_sc13_filings (accession_number)
    on update restrict on delete restrict,
  add constraint user_alert_deliveries_sc13_accessions_check check (
    (sc13_root_accession is null or sc13_root_accession ~ '^\d{10}-\d{2}-\d{6}$')
    and (sc13_head_accession is null or sc13_head_accession ~ '^\d{10}-\d{2}-\d{6}$')
  ),
  add constraint user_alert_deliveries_sc13_reporter_cik_check
    check (sc13_reporter_cik is null or sc13_reporter_cik ~ '^\d{10}$'),
  add constraint user_alert_deliveries_sc13_alert_shape_check check (
    sc13_monitor_id is null
    or (
      alert_domain = 'sc13'
      and alert_event_id is null
      and sc13_position_key is not null and btrim(sc13_position_key) <> ''
      and sc13_root_accession is not null
      and sc13_head_accession is not null
      and sc13_reporter_cik is not null
      and sc13_security_class is not null and btrim(sc13_security_class) <> ''
      and sc13_cusips is not null and cardinality(sc13_cusips) > 0
      and sc13_match_evidence is not null and pg_catalog.jsonb_typeof(sc13_match_evidence) = 'object'
      and sc13_match_evidence @> '{"scope":"complete_stored_history_not_sec_global","meaning":"latest_saved_filing_value_not_realtime_ownership"}'::jsonb
      and category = 'insider_ownership'
      and source_type = 'other'
      and source_label = 'Schedule 13 Monitor'
      and alert_lane = 'sc13_monitor'
      and delivery_status = 'queued'
      and delivered_channels = array[]::text[]
      and scheduled_for is null
      and sent_at is null
      and attempted_at is null
      and dedupe_key is null
    )
  ),
  add constraint user_alert_deliveries_sc13_monitor_position_reporter_key
    unique (sc13_monitor_id, sc13_root_accession, sc13_position_key, sc13_reporter_cik);

alter table public.user_alert_deliveries
  drop constraint user_alert_deliveries_alert_domain_check,
  add constraint user_alert_deliveries_alert_domain_check
    check (alert_domain is null or alert_domain in ('listing', 'offering', 'financial', 'sc13')),
  drop constraint user_alert_deliveries_alert_lane_check,
  add constraint user_alert_deliveries_alert_lane_check
    check (alert_lane in ('watchlist', 'market_discovery', 'calendar_follow', 'listing_monitor', 'offering_monitor', 'financial_monitor', 'sc13_monitor'));

comment on column public.user_alert_deliveries.sc13_match_evidence is
  'Immutable first-match provenance for values that were latest in complete stored history at evaluation time; never a claim of real-time ownership.';
comment on constraint user_alert_deliveries_sc13_monitor_position_reporter_key on public.user_alert_deliveries is
  'Atomic dedupe: one internal Alert per monitor, immutable lineage root position, and reporting person. Amendments do not re-alert.';

commit;
