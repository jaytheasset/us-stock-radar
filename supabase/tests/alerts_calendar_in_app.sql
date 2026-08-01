begin;

select plan(15);

select has_column(
  'public',
  'user_alert_deliveries',
  'calendar_event_id',
  'in-app delivery history references normalized Calendar events'
);

select has_column(
  'public',
  'user_alert_deliveries',
  'read_at',
  'in-app delivery history has a read cursor'
);

select col_type_is(
  'public',
  'user_alert_deliveries',
  'read_at',
  'timestamp with time zone',
  'the read cursor is timezone-aware'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(oid)
    from pg_catalog.pg_constraint
    where conname = 'user_alert_deliveries_alert_lane_check'
  ) like '%calendar_follow%',
  'Calendar follows have a distinct delivery lane'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(oid)
    from pg_catalog.pg_constraint
    where conname = 'user_discovery_categories_category_check'
  ) like '%ipo_listing%',
  'Discovery category persistence accepts every subscriptionPolicy category'
);

select has_trigger(
  'public',
  'calendar_event_history',
  'calendar_event_history_enqueue_alert_candidate',
  'Calendar history changes enqueue alert candidates'
);

select has_trigger(
  'public',
  'user_calendar_event_follows',
  'user_calendar_event_follows_set_updated_at',
  'Calendar follows maintain updated_at'
);

select has_function(
  'private',
  'enqueue_calendar_alert_candidate',
  array[]::text[],
  'the Calendar candidate trigger function exists outside the exposed schema'
);

select has_index(
  'public',
  'user_alert_deliveries',
  'user_alert_deliveries_user_unread_idx',
  'unread in-app history has a user/time index'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'user_calendar_event_follows'
  ),
  'Calendar follow rows remain protected by RLS'
);

insert into public.user_profiles (id, email)
values ('00000000-0000-4000-8000-000000000091', 'alerts-calendar-test@example.test');

insert into public.calendar_events (
  id,
  canonical_identity_key,
  event_type,
  category,
  title,
  event_date,
  event_time,
  event_timezone,
  event_instant,
  time_status,
  market_session,
  lifecycle_status,
  schedule_confidence,
  impact_level,
  impact_scope,
  current_revision
)
values (
  '00000000-0000-4000-8000-000000000092',
  'pg-tap-alerts-calendar-event',
  'earnings',
  'company',
  'Alerts Calendar pgTAP event',
  current_date + 1,
  null,
  'America/New_York',
  null,
  'time-not-announced',
  'tna',
  'scheduled',
  'confirmed',
  'medium',
  'company',
  1
);

insert into public.calendar_event_history (
  event_id,
  revision,
  change_kind,
  before_schedule,
  after_schedule,
  observation_fingerprint
)
values (
  '00000000-0000-4000-8000-000000000092',
  1,
  'registered',
  null,
  '{"eventDate":"2099-01-01"}'::jsonb,
  'pg-tap-alerts-calendar-history'
);

select is(
  (
    select count(*)
    from public.calendar_alert_candidates
    where event_id = '00000000-0000-4000-8000-000000000092'
      and event_revision = 1
      and candidate_kind = 'event-registered'
  ),
  1::bigint,
  'one Calendar candidate is created for one event revision'
);

update public.calendar_events
set current_revision = 2,
    lifecycle_status = 'cancelled'
where id = '00000000-0000-4000-8000-000000000092';

insert into public.calendar_event_history (
  event_id,
  revision,
  change_kind,
  before_schedule,
  after_schedule,
  observation_fingerprint
)
values (
  '00000000-0000-4000-8000-000000000092',
  2,
  'schedule-changed',
  '{"lifecycle_status":"scheduled"}'::jsonb,
  '{"lifecycle_status":"cancelled"}'::jsonb,
  'pg-tap-alerts-calendar-cancelled-history'
);

select is(
  (
    select candidate_kind
    from public.calendar_alert_candidates
    where event_id = '00000000-0000-4000-8000-000000000092'
      and event_revision = 2
  ),
  'cancelled',
  'a cancellation revision is enqueued as a cancellation alert'
);

insert into public.user_calendar_event_follows (user_id, event_id, enabled)
values (
  '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000092',
  true
);

select is(
  (
    select count(*)
    from public.user_calendar_event_follows
    where user_id = '00000000-0000-4000-8000-000000000091'
      and event_id = '00000000-0000-4000-8000-000000000092'
      and enabled
  ),
  1::bigint,
  'Follow Event is stored per user and event'
);

insert into public.user_alert_deliveries (
  user_id,
  calendar_event_id,
  title,
  source_type,
  source_label,
  alert_lane,
  severity,
  delivered_channels,
  delivery_status,
  dedupe_key
)
values (
  '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000092',
  'Following: Alerts Calendar pgTAP event',
  'calendar',
  'Calendar',
  'calendar_follow',
  'medium',
  array['web']::text[],
  'sent',
  'calendar:pg-tap:one'
);

select is(
  (
    select count(*)
    from public.user_alert_deliveries
    where user_id = '00000000-0000-4000-8000-000000000091'
      and calendar_event_id = '00000000-0000-4000-8000-000000000092'
      and alert_lane = 'calendar_follow'
      and delivered_channels = array['web']::text[]
  ),
  1::bigint,
  'Calendar follow delivery is visible in the existing Alerts history table'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'user_alert_deliveries'
      and indexname = 'user_alert_deliveries_user_dedupe_key_unique'
  ),
  'existing per-user dedupe protection remains the single delivery idempotency guard'
);

select * from finish();

rollback;
