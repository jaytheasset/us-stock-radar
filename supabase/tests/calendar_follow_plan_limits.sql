begin;

select plan(13);

select has_function(
  'public',
  'get_user_calendar_event_follow_active_count',
  array['uuid'],
  'active Calendar follow count function exists'
);

select has_function(
  'public',
  'set_user_calendar_event_follow_with_limit',
  array['uuid', 'uuid', 'boolean', 'integer'],
  'atomic Calendar follow mutation function exists'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer)',
    'EXECUTE'
  ),
  'service role can execute the atomic follow mutation'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the server follow mutation'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.user_calendar_event_follows',
    'INSERT, UPDATE, DELETE'
  ),
  'authenticated clients cannot mutate follow rows directly'
);

select matches(
  pg_catalog.pg_get_functiondef(
    'public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer)'::regprocedure
  ),
  'pg_advisory_xact_lock',
  'the mutation serializes quota decisions per user'
);

insert into public.user_profiles (id, email)
values ('00000000-0000-4000-8000-0000000000a1', 'calendar-follow-limit@example.test');

insert into public.calendar_events (
  id,
  canonical_identity_key,
  event_type,
  category,
  title,
  event_date,
  event_timezone,
  time_status,
  market_session,
  lifecycle_status,
  schedule_confidence,
  impact_level,
  impact_scope
)
values
  ('00000000-0000-4000-8000-0000000000b1', 'follow-limit-active-1', 'earnings', 'company', 'Active one', current_date + 1, 'America/New_York', 'time-not-announced', 'tna', 'scheduled', 'confirmed', 'medium', 'company'),
  ('00000000-0000-4000-8000-0000000000b2', 'follow-limit-active-2', 'earnings', 'company', 'Active two', current_date + 2, 'America/New_York', 'time-not-announced', 'tna', 'scheduled', 'confirmed', 'medium', 'company'),
  ('00000000-0000-4000-8000-0000000000b3', 'follow-limit-active-3', 'earnings', 'company', 'Active three', current_date + 3, 'America/New_York', 'time-not-announced', 'tna', 'scheduled', 'confirmed', 'medium', 'company'),
  ('00000000-0000-4000-8000-0000000000b4', 'follow-limit-past', 'earnings', 'company', 'Past event', current_date - 1, 'America/New_York', 'time-not-announced', 'tna', 'scheduled', 'confirmed', 'medium', 'company'),
  ('00000000-0000-4000-8000-0000000000b5', 'follow-limit-released', 'earnings', 'company', 'Released event', current_date + 4, 'America/New_York', 'time-not-announced', 'tna', 'released', 'confirmed', 'medium', 'company'),
  ('00000000-0000-4000-8000-0000000000b6', 'follow-limit-cancelled', 'earnings', 'company', 'Cancelled event', current_date + 5, 'America/New_York', 'time-not-announced', 'tna', 'cancelled', 'confirmed', 'medium', 'company');

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
  impact_scope
)
values (
  '00000000-0000-4000-8000-0000000000b7',
  'follow-limit-past-instant',
  'earnings',
  'company',
  'Past exact event',
  (pg_catalog.now() at time zone 'America/New_York')::date,
  ((pg_catalog.now() - interval '1 hour') at time zone 'America/New_York')::time,
  'America/New_York',
  pg_catalog.now() - interval '1 hour',
  'exact',
  'market-hours',
  'scheduled',
  'confirmed',
  'medium',
  'company'
);

select lives_ok(
  $$select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', true, 2)$$,
  'the first active event can be followed'
);

select lives_ok(
  $$select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', true, 2)$$,
  'the second active event can fill the limit'
);

select lives_ok(
  $$select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', true, 2)$$,
  're-enabling an already enabled event is idempotent at the limit'
);

select throws_ok(
  $$select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b3', true, 2)$$,
  'P0001',
  'CALENDAR_FOLLOW_LIMIT_REACHED',
  'a new active event is rejected after the limit is reached'
);

select lives_ok(
  $$
    select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b4', true, 2);
    select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b5', true, 2);
    select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b6', true, 2);
    select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b7', true, 2);
  $$,
  'past, released, and cancelled events can be saved without consuming quota'
);

select is(
  (select active_count from public.get_user_calendar_event_follow_active_count('00000000-0000-4000-8000-0000000000a1')),
  2::bigint,
  'only enabled future actionable events consume quota'
);

select lives_ok(
  $$select * from public.set_user_calendar_event_follow_with_limit('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', false, 0)$$,
  'unfollowing remains available regardless of the plan limit'
);

select * from finish();

rollback;
