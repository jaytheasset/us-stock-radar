begin;

-- Calendar V1 has a separate taxonomy from the SEC/news analysis registry.
-- These tables are additive and intentionally do not replace event_calendar_items.
create table public.calendar_event_types (
  event_type text primary key,
  category text not null,
  policy_subcategory text,
  label text not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_types_event_type_check
    check (event_type = pg_catalog.btrim(event_type) and pg_catalog.length(event_type) > 0),
  constraint calendar_event_types_category_check
    check (category in ('company', 'macro', 'policy')),
  constraint calendar_event_types_policy_subcategory_check
    check (
      (category = 'policy' and policy_subcategory in (
        'monetary-policy',
        'treasury',
        'sec-regulation',
        'trade-policy',
        'industry-regulation'
      ))
      or (category <> 'policy' and policy_subcategory is null)
    ),
  constraint calendar_event_types_label_check
    check (label = pg_catalog.btrim(label) and pg_catalog.length(label) > 0),
  constraint calendar_event_types_schema_version_check
    check (schema_version > 0),
  constraint calendar_event_types_event_type_category_key
    unique (event_type, category)
);

insert into public.calendar_event_types (
  event_type,
  category,
  policy_subcategory,
  label,
  schema_version
)
values
  ('earnings', 'company', null, 'Earnings', 1),
  ('dividend', 'company', null, 'Dividends', 1),
  ('split', 'company', null, 'Splits', 1),
  ('ipo', 'company', null, 'IPO', 1),
  ('cpi', 'macro', null, 'CPI', 1),
  ('ppi', 'macro', null, 'PPI', 1),
  ('pce', 'macro', null, 'PCE', 1),
  ('employment-situation', 'macro', null, 'Employment Situation', 1),
  ('jolts', 'macro', null, 'JOLTS', 1),
  ('gdp-advance', 'macro', null, 'GDP Advance Estimate', 1),
  ('retail-sales', 'macro', null, 'Retail Sales', 1),
  ('fomc-decision', 'policy', 'monetary-policy', 'FOMC Decision', 1),
  ('fomc-minutes', 'policy', 'monetary-policy', 'FOMC Minutes', 1),
  ('fed-chair-testimony', 'policy', 'monetary-policy', 'Fed Chair Semiannual Testimony', 1),
  ('treasury-borrowing-estimate', 'policy', 'treasury', 'Treasury Quarterly Borrowing Estimate', 1),
  ('treasury-refunding', 'policy', 'treasury', 'Treasury Quarterly Refunding', 1),
  ('treasury-auction-10y', 'policy', 'treasury', '10-Year Treasury Auction', 1),
  ('treasury-auction-30y', 'policy', 'treasury', '30-Year Treasury Auction', 1),
  ('sec-open-meeting', 'policy', 'sec-regulation', 'SEC Major Open Meeting', 1),
  ('sec-rule-milestone', 'policy', 'sec-regulation', 'SEC Rule Milestone', 1),
  ('trade-policy-action', 'policy', 'trade-policy', 'Trade Policy Action', 1),
  ('fda-advisory-committee', 'policy', 'industry-regulation', 'FDA Advisory Committee', 1)
on conflict (event_type) do update
set
  category = excluded.category,
  policy_subcategory = excluded.policy_subcategory,
  label = excluded.label,
  schema_version = excluded.schema_version;

-- The application currently uses the public PostgREST schema for server-side
-- service-role access. Raw payloads therefore remain in public but are denied
-- to browser roles at the privilege layer and protected by RLS as defense in depth.
create table public.calendar_provider_payloads (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  request_window_start date,
  request_window_end date,
  payload jsonb not null,
  checksum text not null,
  checksum_algorithm text not null default 'sha256',
  fetched_at timestamptz not null,
  ingested_run_id text,
  is_development_data boolean not null default true,
  retention_mode text not null default 'prelaunch_long_term',
  purge_after timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint calendar_provider_payloads_provider_check
    check (provider = pg_catalog.btrim(provider) and pg_catalog.length(provider) > 0),
  constraint calendar_provider_payloads_request_window_check
    check (
      request_window_start is null
      or request_window_end is null
      or request_window_end >= request_window_start
    ),
  constraint calendar_provider_payloads_checksum_check
    check (checksum = pg_catalog.btrim(checksum) and pg_catalog.length(checksum) > 0),
  constraint calendar_provider_payloads_checksum_algorithm_check
    check (checksum_algorithm in ('sha256')),
  constraint calendar_provider_payloads_ingested_run_id_check
    check (
      ingested_run_id is null
      or (
        ingested_run_id = pg_catalog.btrim(ingested_run_id)
        and pg_catalog.length(ingested_run_id) > 0
      )
    ),
  constraint calendar_provider_payloads_retention_mode_check
    check (retention_mode in ('prelaunch_long_term', 'contract_bound', 'legal_hold')),
  constraint calendar_provider_payloads_prelaunch_purge_check
    check (retention_mode <> 'prelaunch_long_term' or purge_after is null)
);

comment on table public.calendar_provider_payloads is
  'Private-by-grant provider payload archive. Prelaunch rows are retained long-term until a release-readiness migration establishes contract-bound retention.';
comment on column public.calendar_provider_payloads.payload is
  'Server-only raw provider response. Never return through a product API or UI.';
comment on column public.calendar_provider_payloads.purge_after is
  'Null during prelaunch. No purge job or cron is enabled by this migration.';

create index calendar_provider_payloads_provider_fetched_idx
  on public.calendar_provider_payloads (provider, fetched_at desc);
create index calendar_provider_payloads_ingested_run_idx
  on public.calendar_provider_payloads (ingested_run_id)
  where ingested_run_id is not null;
create index calendar_provider_payloads_purge_idx
  on public.calendar_provider_payloads (purge_after)
  where purge_after is not null;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  canonical_identity_key text not null,
  event_type text not null,
  category text not null,
  title text not null,
  event_date date not null,
  event_end_date date,
  event_time time without time zone,
  event_timezone text not null default 'America/New_York',
  event_instant timestamptz,
  time_status text not null,
  market_session text not null,
  lifecycle_status text not null default 'scheduled',
  schedule_confidence text not null default 'confirmed',
  impact_level text not null,
  impact_scope text not null,
  current_revision integer not null default 1,
  first_seen_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_events_canonical_identity_key_key unique (canonical_identity_key),
  constraint calendar_events_event_type_category_fkey
    foreign key (event_type, category)
    references public.calendar_event_types (event_type, category)
    on update restrict
    on delete restrict,
  constraint calendar_events_canonical_identity_key_check
    check (
      canonical_identity_key = pg_catalog.btrim(canonical_identity_key)
      and pg_catalog.length(canonical_identity_key) > 0
    ),
  constraint calendar_events_title_check
    check (title = pg_catalog.btrim(title) and pg_catalog.length(title) > 0),
  constraint calendar_events_date_range_check
    check (event_end_date is null or event_end_date >= event_date),
  constraint calendar_events_timezone_check
    check (
      event_timezone = pg_catalog.btrim(event_timezone)
      and pg_catalog.length(event_timezone) > 0
    ),
  constraint calendar_events_time_status_check
    check (time_status in ('exact', 'time-not-announced', 'all-day')),
  constraint calendar_events_time_shape_check
    check (
      (time_status = 'exact' and event_time is not null)
      or (time_status in ('time-not-announced', 'all-day') and event_time is null and event_instant is null)
    ),
  constraint calendar_events_market_session_check
    check (market_session in ('bmo', 'market-hours', 'amc', 'tna')),
  constraint calendar_events_tna_session_check
    check (time_status <> 'time-not-announced' or market_session = 'tna'),
  constraint calendar_events_lifecycle_status_check
    check (lifecycle_status in ('scheduled', 'released', 'postponed', 'cancelled')),
  constraint calendar_events_schedule_confidence_check
    check (schedule_confidence in ('confirmed', 'tentative')),
  constraint calendar_events_impact_level_check
    check (impact_level in ('high', 'medium', 'low')),
  constraint calendar_events_impact_scope_check
    check (impact_scope in ('market-wide', 'sector', 'company')),
  constraint calendar_events_current_revision_check
    check (current_revision > 0),
  constraint calendar_events_seen_order_check
    check (last_seen_at >= first_seen_at)
);

comment on column public.calendar_events.canonical_identity_key is
  'Immutable provider-neutral identity. It must identify the event series and must not include a scheduled date, so a reschedule updates the same event.';
comment on column public.calendar_events.event_date is
  'Source-local calendar date. Never parse this date-only value as a UTC timestamp.';
comment on column public.calendar_events.event_instant is
  'Nullable normalized UTC instant for exact times; local date/time and IANA timezone remain authoritative source fields.';
comment on column public.calendar_events.updated_at is
  'Set explicitly by the server on updates; no broad public trigger is installed.';

create index calendar_events_category_date_idx
  on public.calendar_events (category, event_date, event_time, id);
create index calendar_events_type_date_idx
  on public.calendar_events (event_type, event_date, event_time, id);
create index calendar_events_lifecycle_date_idx
  on public.calendar_events (lifecycle_status, event_date, id);
create index calendar_events_instant_idx
  on public.calendar_events (event_instant)
  where event_instant is not null;

create table public.calendar_event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  provider text not null,
  source_agency text not null,
  source_name text not null,
  source_url text,
  source_event_key text,
  source_modified_at timestamptz,
  fetched_at timestamptz not null,
  checksum text not null,
  confidence text not null,
  raw_payload_id uuid
    references public.calendar_provider_payloads (id)
    on update restrict
    on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_sources_provider_check
    check (provider = pg_catalog.btrim(provider) and pg_catalog.length(provider) > 0),
  constraint calendar_event_sources_agency_check
    check (source_agency = pg_catalog.btrim(source_agency) and pg_catalog.length(source_agency) > 0),
  constraint calendar_event_sources_name_check
    check (source_name = pg_catalog.btrim(source_name) and pg_catalog.length(source_name) > 0),
  constraint calendar_event_sources_key_check
    check (
      source_event_key is null
      or (
        source_event_key = pg_catalog.btrim(source_event_key)
        and pg_catalog.length(source_event_key) > 0
      )
    ),
  constraint calendar_event_sources_checksum_check
    check (checksum = pg_catalog.btrim(checksum) and pg_catalog.length(checksum) > 0),
  constraint calendar_event_sources_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create unique index calendar_event_sources_provider_key_uidx
  on public.calendar_event_sources (provider, source_event_key)
  where source_event_key is not null;
create index calendar_event_sources_event_idx
  on public.calendar_event_sources (event_id, fetched_at desc);
create index calendar_event_sources_raw_payload_idx
  on public.calendar_event_sources (raw_payload_id)
  where raw_payload_id is not null;

create table public.calendar_event_securities (
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  ticker text not null,
  role text not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (event_id, ticker),
  constraint calendar_event_securities_ticker_check
    check (
      ticker = pg_catalog.upper(pg_catalog.btrim(ticker))
      and pg_catalog.length(ticker) > 0
    ),
  constraint calendar_event_securities_role_check
    check (role in ('primary', 'related', 'affected'))
);

create unique index calendar_event_securities_primary_uidx
  on public.calendar_event_securities (event_id)
  where role = 'primary';
create index calendar_event_securities_ticker_idx
  on public.calendar_event_securities (ticker, event_id);

create table public.calendar_event_sectors (
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  sector text not null,
  role text not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (event_id, sector),
  constraint calendar_event_sectors_sector_check
    check (sector = pg_catalog.btrim(sector) and pg_catalog.length(sector) > 0),
  constraint calendar_event_sectors_role_check
    check (role in ('primary', 'related', 'affected'))
);

create index calendar_event_sectors_sector_idx
  on public.calendar_event_sectors (sector, event_id);

create table public.calendar_event_metrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  metric_key text not null,
  name text not null,
  actual numeric,
  consensus numeric,
  previous numeric,
  actual_text text,
  consensus_text text,
  previous_text text,
  unit text not null,
  unit_raw text,
  release_stage text not null,
  released boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_metrics_identity_key
    unique (event_id, metric_key, release_stage),
  constraint calendar_event_metrics_metric_key_check
    check (metric_key = pg_catalog.btrim(metric_key) and pg_catalog.length(metric_key) > 0),
  constraint calendar_event_metrics_name_check
    check (name = pg_catalog.btrim(name) and pg_catalog.length(name) > 0),
  constraint calendar_event_metrics_unit_check
    check (unit = pg_catalog.btrim(unit) and pg_catalog.length(unit) > 0),
  constraint calendar_event_metrics_release_stage_check
    check (release_stage in ('monthly', 'advance', 'preliminary', 'final')),
  constraint calendar_event_metrics_prerelease_actual_check
    check (released or (actual is null and actual_text is null))
);

create index calendar_event_metrics_event_idx
  on public.calendar_event_metrics (event_id, release_stage, metric_key);

create table public.calendar_event_details (
  event_id uuid primary key
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_details_object_check
    check (pg_catalog.jsonb_typeof(detail) = 'object'),
  constraint calendar_event_details_schema_version_check
    check (schema_version > 0)
);

comment on column public.calendar_event_details.detail is
  'Provider-neutral typed detail object validated by the Calendar application discriminated union.';

create table public.calendar_event_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  revision integer not null,
  change_kind text not null,
  before_schedule jsonb,
  after_schedule jsonb not null,
  observation_fingerprint text not null,
  source_id uuid
    references public.calendar_event_sources (id)
    on update restrict
    on delete set null,
  observed_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_history_revision_key unique (event_id, revision),
  constraint calendar_event_history_observation_key unique (event_id, observation_fingerprint),
  constraint calendar_event_history_revision_check check (revision > 0),
  constraint calendar_event_history_change_kind_check
    check (change_kind in (
      'registered',
      'schedule-changed',
      'postponed',
      'cancelled',
      'released',
      'result-updated'
    )),
  constraint calendar_event_history_before_object_check
    check (before_schedule is null or pg_catalog.jsonb_typeof(before_schedule) = 'object'),
  constraint calendar_event_history_after_object_check
    check (pg_catalog.jsonb_typeof(after_schedule) = 'object'),
  constraint calendar_event_history_fingerprint_check
    check (
      observation_fingerprint = pg_catalog.btrim(observation_fingerprint)
      and pg_catalog.length(observation_fingerprint) > 0
    )
);

create index calendar_event_history_event_observed_idx
  on public.calendar_event_history (event_id, observed_at desc);
create index calendar_event_history_source_idx
  on public.calendar_event_history (source_id)
  where source_id is not null;

create table public.user_calendar_event_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.user_profiles (id)
    on update restrict
    on delete cascade,
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint user_calendar_event_follows_user_event_key unique (user_id, event_id)
);

create index user_calendar_event_follows_event_idx
  on public.user_calendar_event_follows (event_id, user_id);

create table public.calendar_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  follow_id uuid not null
    references public.user_calendar_event_follows (id)
    on update restrict
    on delete cascade,
  minutes_before integer not null,
  channel text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_reminder_rules_identity_key
    unique (follow_id, minutes_before, channel),
  constraint calendar_reminder_rules_minutes_before_check
    check (minutes_before between 0 and 525600),
  constraint calendar_reminder_rules_channel_check
    check (channel in ('web', 'telegram', 'email', 'webhook', 'api'))
);

create index calendar_reminder_rules_enabled_idx
  on public.calendar_reminder_rules (follow_id, minutes_before)
  where enabled;

create table public.calendar_alert_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.calendar_events (id)
    on update restrict
    on delete restrict,
  event_revision integer not null,
  candidate_kind text not null,
  candidate_key text not null,
  available_at timestamptz not null default pg_catalog.now(),
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_alert_candidates_candidate_key_key unique (candidate_key),
  constraint calendar_alert_candidates_event_revision_check check (event_revision > 0),
  constraint calendar_alert_candidates_kind_check
    check (candidate_kind in (
      'event-registered',
      'schedule-changed',
      'postponed',
      'cancelled',
      'reminder-due',
      'released',
      'result-updated'
    )),
  constraint calendar_alert_candidates_key_check
    check (candidate_key = pg_catalog.btrim(candidate_key) and pg_catalog.length(candidate_key) > 0),
  constraint calendar_alert_candidates_status_check
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  constraint calendar_alert_candidates_payload_object_check
    check (pg_catalog.jsonb_typeof(payload) = 'object')
);

create index calendar_alert_candidates_event_idx
  on public.calendar_alert_candidates (event_id, event_revision);
create index calendar_alert_candidates_pending_idx
  on public.calendar_alert_candidates (available_at, id)
  where status in ('pending', 'failed');

create table public.calendar_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null
    references public.calendar_alert_candidates (id)
    on update restrict
    on delete restrict,
  follow_id uuid
    references public.user_calendar_event_follows (id)
    on update restrict
    on delete set null,
  user_id uuid
    references public.user_profiles (id)
    on update restrict
    on delete set null,
  channel text not null,
  attempt_number integer not null,
  idempotency_key text not null,
  status text not null default 'queued',
  provider_message_id text,
  error_code text,
  error_message text,
  next_retry_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_delivery_attempts_idempotency_key_key unique (idempotency_key),
  constraint calendar_delivery_attempts_candidate_attempt_key
    unique (candidate_id, channel, attempt_number, idempotency_key),
  constraint calendar_delivery_attempts_channel_check
    check (channel in ('web', 'telegram', 'email', 'webhook', 'api')),
  constraint calendar_delivery_attempts_attempt_number_check
    check (attempt_number > 0),
  constraint calendar_delivery_attempts_idempotency_key_check
    check (
      idempotency_key = pg_catalog.btrim(idempotency_key)
      and pg_catalog.length(idempotency_key) > 0
    ),
  constraint calendar_delivery_attempts_status_check
    check (status in ('queued', 'attempting', 'sent', 'failed', 'suppressed')),
  constraint calendar_delivery_attempts_time_order_check
    check (
      completed_at is null
      or started_at is null
      or completed_at >= started_at
    )
);

create index calendar_delivery_attempts_candidate_idx
  on public.calendar_delivery_attempts (candidate_id, attempt_number);
create index calendar_delivery_attempts_follow_idx
  on public.calendar_delivery_attempts (follow_id)
  where follow_id is not null;
create index calendar_delivery_attempts_user_idx
  on public.calendar_delivery_attempts (user_id, created_at desc)
  where user_id is not null;
create index calendar_delivery_attempts_retry_idx
  on public.calendar_delivery_attempts (next_retry_at, id)
  where status = 'failed' and next_retry_at is not null;

-- RLS is enabled for every table in the exposed public schema. Server-only
-- tables intentionally have no browser-role policy.
alter table public.calendar_event_types enable row level security;
alter table public.calendar_provider_payloads enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_sources enable row level security;
alter table public.calendar_event_securities enable row level security;
alter table public.calendar_event_sectors enable row level security;
alter table public.calendar_event_metrics enable row level security;
alter table public.calendar_event_details enable row level security;
alter table public.calendar_event_history enable row level security;
alter table public.user_calendar_event_follows enable row level security;
alter table public.calendar_reminder_rules enable row level security;
alter table public.calendar_alert_candidates enable row level security;
alter table public.calendar_delivery_attempts enable row level security;

revoke all on table
  public.calendar_event_types,
  public.calendar_provider_payloads,
  public.calendar_events,
  public.calendar_event_sources,
  public.calendar_event_securities,
  public.calendar_event_sectors,
  public.calendar_event_metrics,
  public.calendar_event_details,
  public.calendar_event_history,
  public.user_calendar_event_follows,
  public.calendar_reminder_rules,
  public.calendar_alert_candidates,
  public.calendar_delivery_attempts
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.calendar_event_types,
  public.calendar_provider_payloads,
  public.calendar_events,
  public.calendar_event_sources,
  public.calendar_event_securities,
  public.calendar_event_sectors,
  public.calendar_event_metrics,
  public.calendar_event_details,
  public.calendar_event_history,
  public.user_calendar_event_follows,
  public.calendar_reminder_rules,
  public.calendar_alert_candidates,
  public.calendar_delivery_attempts
to service_role;

grant select, insert, update, delete
  on table public.user_calendar_event_follows
  to authenticated;
grant select, insert, update, delete
  on table public.calendar_reminder_rules
  to authenticated;

create policy user_calendar_event_follows_select_own
on public.user_calendar_event_follows
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_calendar_event_follows_insert_own
on public.user_calendar_event_follows
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy user_calendar_event_follows_update_own
on public.user_calendar_event_follows
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_calendar_event_follows_delete_own
on public.user_calendar_event_follows
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy calendar_reminder_rules_select_own
on public.calendar_reminder_rules
for select
to authenticated
using (
  exists (
    select 1
    from public.user_calendar_event_follows as follow
    where follow.id = calendar_reminder_rules.follow_id
      and follow.user_id = (select auth.uid())
  )
);

create policy calendar_reminder_rules_insert_own
on public.calendar_reminder_rules
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_calendar_event_follows as follow
    where follow.id = calendar_reminder_rules.follow_id
      and follow.user_id = (select auth.uid())
  )
);

create policy calendar_reminder_rules_update_own
on public.calendar_reminder_rules
for update
to authenticated
using (
  exists (
    select 1
    from public.user_calendar_event_follows as follow
    where follow.id = calendar_reminder_rules.follow_id
      and follow.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.user_calendar_event_follows as follow
    where follow.id = calendar_reminder_rules.follow_id
      and follow.user_id = (select auth.uid())
  )
);

create policy calendar_reminder_rules_delete_own
on public.calendar_reminder_rules
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_calendar_event_follows as follow
    where follow.id = calendar_reminder_rules.follow_id
      and follow.user_id = (select auth.uid())
  )
);

commit;
