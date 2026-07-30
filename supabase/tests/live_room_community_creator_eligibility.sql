begin;

select plan(25);

select ok(
  to_regprocedure(
    'public.get_live_room_community_creator_eligibility(uuid)'
  ) is not null,
  'service-only Community Room creator eligibility function exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_live_room_community_creator_eligibility(uuid)',
    'execute'
  ),
  'service role can execute creator eligibility'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_live_room_community_creator_eligibility(uuid)',
    'execute'
  ),
  'anonymous browser role cannot execute creator eligibility'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_live_room_community_creator_eligibility(uuid)',
    'execute'
  ),
  'authenticated browser role cannot execute creator eligibility'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.get_live_room_member_follower_counts(uuid[])',
    'execute'
  ),
  'authenticated browser role cannot execute canonical follower counts'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid =
        'public.live_room_community_rooms'::regclass
      and trigger.tgname =
        'assert_live_room_community_creator_eligibility'
      and not trigger.tgisinternal
  ),
  'Community Room inserts install the final eligibility trigger'
);

insert into public.user_profiles (id)
select (
  '91000000-0000-4000-8000-'
  || pg_catalog.lpad(series.value::text, 12, '0')
)::uuid
from pg_catalog.generate_series(1, 10) as series(value);

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
select
  (
    '91000000-0000-4000-8000-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  'Eligibility target ' || series.value,
  chr(128640),
  (
    '91100000-0000-4000-8000-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  true
from pg_catalog.generate_series(1, 10) as series(value);

insert into public.user_profiles (id)
select (
  '91000000-0000-4000-8100-'
  || pg_catalog.lpad(series.value::text, 12, '0')
)::uuid
from pg_catalog.generate_series(1, 101) as series(value);

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
select
  (
    '91000000-0000-4000-8100-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  'Eligibility follower ' || series.value,
  chr(128075),
  (
    '91100000-0000-4000-8100-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  true
from pg_catalog.generate_series(1, 101) as series(value);

insert into public.user_plan_subscriptions (
  user_id,
  plan,
  status,
  trial_plan,
  trial_started_at,
  trial_ends_at,
  trial_used_at
)
values
  (
    '91000000-0000-4000-8000-000000000001',
    'free',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'ad_free',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    'pro',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    'advanced',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000005',
    'advanced',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000006',
    'advanced',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000007',
    'ultimate',
    'active',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000008',
    'advanced',
    'cancelled',
    null,
    null,
    null,
    null
  ),
  (
    '91000000-0000-4000-8000-000000000009',
    'free',
    'active',
    'advanced',
    pg_catalog.now() - interval '1 day',
    pg_catalog.now() + interval '1 day',
    pg_catalog.now() - interval '1 day'
  ),
  (
    '91000000-0000-4000-8000-000000000010',
    'advanced',
    'active',
    null,
    null,
    null,
    null
  );

insert into public.live_room_member_follows (
  follower_user_id,
  followed_user_id
)
select
  (
    '91000000-0000-4000-8100-'
    || pg_catalog.lpad(follower.value::text, 12, '0')
  )::uuid,
  (
    '91000000-0000-4000-8000-'
    || pg_catalog.lpad(target.value::text, 12, '0')
  )::uuid
from (
  values
    (1, 101),
    (2, 101),
    (3, 101),
    (4, 99),
    (5, 100),
    (6, 101),
    (7, 100),
    (8, 101),
    (9, 100),
    (10, 101)
) as target(value, follower_limit)
join lateral pg_catalog.generate_series(
  1,
  target.follower_limit
) as follower(value) on true;

insert into public.live_room_actor_blocks (
  blocker_kind,
  blocker_member_user_id,
  blocked_kind,
  blocked_member_user_id,
  blocked_display_name,
  blocked_emoji
)
values (
  'member',
  '91000000-0000-4000-8100-000000000101',
  'member',
  '91000000-0000-4000-8000-000000000010',
  'Blocked target',
  chr(128640)
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000001'
  )->>'effectivePlan',
  'free',
  'active Free remains below creator plan eligibility'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000002'
  )->>'effectivePlan',
  'ad_free',
  'active Ad-Free remains below creator plan eligibility'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000003'
  )->>'effectivePlan',
  'pro',
  'active Pro remains below creator plan eligibility'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000005'
  )->>'effectivePlan',
  'advanced',
  'active Advanced is resolved from the canonical plan contract'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000007'
  )->>'effectivePlan',
  'ultimate',
  'active Ultimate is resolved from the canonical plan contract'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000008'
  )->>'effectivePlan',
  'free',
  'cancelled Advanced is not treated as an active creator plan'
);

select is(
  public.get_live_room_community_creator_eligibility(
    '91000000-0000-4000-8000-000000000009'
  )->>'effectivePlan',
  'advanced',
  'an active Advanced trial uses the shared effective-plan contract'
);

select is(
  (
    public.get_live_room_community_creator_eligibility(
      '91000000-0000-4000-8000-000000000004'
    )->>'followerCount'
  )::integer,
  99,
  '99 distinct active followers remain below the boundary'
);

select is(
  (
    public.get_live_room_community_creator_eligibility(
      '91000000-0000-4000-8000-000000000005'
    )->>'followerCount'
  )::integer,
  100,
  '100 distinct active followers meet the boundary'
);

select is(
  (
    public.get_live_room_community_creator_eligibility(
      '91000000-0000-4000-8000-000000000006'
    )->>'followerCount'
  )::integer,
  101,
  '101 distinct active followers remain above the boundary'
);

select is(
  (
    public.get_live_room_community_creator_eligibility(
      '91000000-0000-4000-8000-000000000010'
    )->>'followerCount'
  )::integer,
  100,
  'a bilaterally blocked relationship is excluded canonically'
);

select throws_ok(
  $$
    select public.create_live_room_community_room(
      '91000000-0000-4000-8000-000000000003',
      'creator-pro-denied-test',
      'Pro creator denied',
      'Verifies that Pro cannot create a Community Room.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QAPRO'],
      array[]::text[],
      array[]::text[]
    )
  $$,
  'P0001',
  'COMMUNITY_ROOM_ADVANCED_REQUIRED',
  'the service create path rejects Pro even with 101 followers'
);

select throws_ok(
  $$
    select public.create_live_room_community_room(
      '91000000-0000-4000-8000-000000000004',
      'creator-followers-denied-test',
      'Follower creator denied',
      'Verifies that 99 followers cannot create a room.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QA99'],
      array[]::text[],
      array[]::text[]
    )
  $$,
  'P0001',
  'COMMUNITY_ROOM_FOLLOWERS_REQUIRED',
  'the service create path rejects Advanced with 99 followers'
);

select throws_ok(
  $$
    with room as (
      insert into public.live_room_rooms (
        id,
        ticker,
        issuer_id,
        room_kind
      )
      values (
        '91200000-0000-4000-8000-000000000001',
        null,
        null,
        'community'
      )
      returning id
    )
    insert into public.live_room_community_rooms (
      room_id,
      slug,
      owner_user_id,
      name,
      summary,
      topic,
      room_style,
      focus_tags,
      language,
      related_tickers
    )
    select
      room.id,
      'creator-direct-bypass-test',
      '91000000-0000-4000-8000-000000000001',
      'Direct bypass denied',
      'Verifies the final table trigger cannot be bypassed.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QAFREE']
    from room
  $$,
  'P0001',
  'COMMUNITY_ROOM_ADVANCED_REQUIRED',
  'a direct table insert cannot bypass creator plan eligibility'
);

select lives_ok(
  $$
    select public.create_live_room_community_room(
      '91000000-0000-4000-8000-000000000005',
      'creator-boundary-success-test',
      'Boundary creator succeeds',
      'Verifies that Advanced with 100 followers can create.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QA100'],
      array[]::text[],
      array[]::text[]
    )
  $$,
  'Advanced with exactly 100 followers can create'
);

select ok(
  exists (
    select 1
    from public.live_room_memberships as membership
    join public.live_room_community_rooms as room
      on room.room_id = membership.room_id
    where room.slug = 'creator-boundary-success-test'
      and membership.member_user_id =
        '91000000-0000-4000-8000-000000000005'
  ),
  'an eligible creator is still auto-joined'
);

select ok(
  exists (
    select 1
    from public.live_room_follows as follow
    join public.live_room_community_rooms as room
      on room.room_id = follow.room_id
    where room.slug = 'creator-boundary-success-test'
      and follow.actor_kind = 'member'
      and follow.member_user_id =
        '91000000-0000-4000-8000-000000000005'
      and follow.followed = true
  ),
  'an eligible creator retains canonical follow/read state'
);

select throws_ok(
  $$
    select public.create_live_room_community_room(
      '91000000-0000-4000-8000-000000000005',
      'creator-cooldown-denied-test',
      'Cooldown creator denied',
      'Verifies that eligibility does not remove cooldown.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QACOOL'],
      array[]::text[],
      array[]::text[]
    )
  $$,
  'P0001',
  'COMMUNITY_ROOM_CREATE_RATE_LIMIT',
  'the existing five-minute cooldown still applies after eligibility'
);

insert into public.live_room_rooms (
  id,
  ticker,
  issuer_id,
  room_kind
)
select
  (
    '91200000-0000-4000-8001-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  null,
  null,
  'community'
from pg_catalog.generate_series(1, 5) as series(value);

insert into public.live_room_community_rooms (
  room_id,
  slug,
  owner_user_id,
  name,
  summary,
  topic,
  room_style,
  focus_tags,
  language,
  related_tickers,
  created_at,
  last_activity_at,
  updated_at
)
select
  (
    '91200000-0000-4000-8001-'
    || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  'creator-daily-room-' || series.value || '-test',
  '91000000-0000-4000-8000-000000000007',
  'Daily room ' || series.value,
  'Verifies that the rolling daily limit remains active.',
  'creator_community',
  'open_discussion',
  array['company_news'],
  'en',
  array['QADAY'],
  pg_catalog.now() - (series.value * interval '1 hour'),
  pg_catalog.now() - (series.value * interval '1 hour'),
  pg_catalog.now() - (series.value * interval '1 hour')
from pg_catalog.generate_series(1, 5) as series(value);

select throws_ok(
  $$
    select public.create_live_room_community_room(
      '91000000-0000-4000-8000-000000000007',
      'creator-daily-limit-denied-test',
      'Daily limit denied',
      'Verifies that eligibility does not remove daily limits.',
      'creator_community',
      'open_discussion',
      array['company_news'],
      'en',
      array['QADAY'],
      array[]::text[],
      array[]::text[]
    )
  $$,
  'P0001',
  'COMMUNITY_ROOM_CREATE_RATE_LIMIT',
  'the existing rolling 24-hour limit still applies after eligibility'
);

select * from finish();

rollback;
