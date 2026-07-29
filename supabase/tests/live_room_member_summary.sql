begin;

select plan(13);

select ok(
  to_regprocedure(
    'public.get_live_room_member_summaries(uuid,text,uuid,uuid,uuid[],integer)'
  ) is not null,
  'bounded Live Room member summary RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_live_room_member_summaries(uuid,text,uuid,uuid,uuid[],integer)',
    'execute'
  ),
  'service role can execute member summaries'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_live_room_member_summaries(uuid,text,uuid,uuid,uuid[],integer)',
    'execute'
  ),
  'authenticated browser role cannot execute member summaries directly'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_live_room_member_summaries(uuid,text,uuid,uuid,uuid[],integer)',
    'execute'
  ),
  'anonymous browser role cannot execute member summaries directly'
);

insert into public.user_profiles (id)
values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Requester',
    chr(128075),
    '20000000-0000-4000-8000-000000000001',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Public creator',
    chr(128640),
    '20000000-0000-4000-8000-000000000002',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Follower',
    chr(128202),
    '20000000-0000-4000-8000-000000000003',
    true
  );

insert into public.live_room_rooms (id, ticker, room_kind)
values (
  '30000000-0000-4000-8000-000000000001',
  'MSUMZZ',
  'company'
);

insert into public.live_room_messages (
  id,
  room_id,
  author_kind,
  member_user_id,
  author_display_name,
  author_emoji,
  author_plan,
  body,
  visibility_status
)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'member',
  '10000000-0000-4000-8000-000000000002',
  'Public creator',
  chr(128640),
  'free',
  'Visible room contribution',
  'visible'
);

insert into public.live_room_posts (
  id,
  room_id,
  author_user_id,
  title,
  body,
  visibility_status,
  like_count
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'First visible post',
    'A visible post body long enough for validation.',
    'visible',
    3
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'Second visible post',
    'Another visible post body long enough for validation.',
    'visible',
    4
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'Hidden post ignored',
    'This hidden post body must not affect public totals.',
    'hidden',
    20
  );

insert into public.live_room_member_follows (
  follower_user_id,
  followed_user_id
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002'
  );

insert into public.user_plan_subscriptions (
  user_id,
  plan,
  status,
  trial_plan,
  trial_started_at,
  trial_ends_at,
  trial_used_at
)
values (
  '10000000-0000-4000-8000-000000000002',
  'ad_free',
  'active',
  'pro',
  now() - interval '1 day',
  now() + interval '1 day',
  now() - interval '1 day'
);

insert into public.live_room_social_verifications (
  member_user_id,
  platform,
  normalized_handle,
  profile_url,
  proof_code,
  status,
  show_on_profile
)
values
  (
    '10000000-0000-4000-8000-000000000002',
    'x',
    'public.creator',
    'https://x.com/public.creator',
    'SR-TEST-0001',
    'verified',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'youtube',
    'private.creator',
    'https://youtube.com/@private.creator',
    'SR-TEST-0002',
    'verified',
    false
  );

insert into public.live_room_member_presence (
  member_user_id,
  ticker,
  room_id,
  last_seen_at,
  updated_at
)
values (
  '10000000-0000-4000-8000-000000000002',
  'MSUMZZ',
  '30000000-0000-4000-8000-000000000001',
  now(),
  now()
);

create temporary table member_summary_result(payload jsonb);

insert into member_summary_result (payload)
select public.get_live_room_member_summaries(
  '30000000-0000-4000-8000-000000000001',
  'member',
  '10000000-0000-4000-8000-000000000001',
  null,
  array['20000000-0000-4000-8000-000000000002'::uuid],
  8
);

select is(
  (select payload->'items'->0->>'publicProfileId' from member_summary_result),
  '20000000-0000-4000-8000-000000000002',
  'summary returns only the requested opaque public profile'
);

select is(
  (select (payload->'items'->0->>'followerCount')::integer from member_summary_result),
  2,
  'followers count active member relationships'
);

select is(
  (select (payload->'items'->0->>'postCount')::integer from member_summary_result),
  2,
  'posts count only visible Live Room posts'
);

select is(
  (select (payload->'items'->0->>'receivedLikeCount')::integer from member_summary_result),
  7,
  'received likes sum only currently visible posts'
);

select is(
  (select payload->'items'->0->>'plan' from member_summary_result),
  'pro',
  'active trial resolves the effective plan over the base plan'
);

select is(
  (select jsonb_array_length(payload->'items'->0->'socialBadges') from member_summary_result),
  1,
  'only approved and showable creator verification is returned'
);

select is(
  (select (payload->'items'->0->>'isOnline')::boolean from member_summary_result),
  true,
  'online state uses current room-scoped opt-in presence'
);

select ok(
  position(
    '10000000-0000-4000-8000-000000000002'
    in (select payload::text from member_summary_result)
  ) = 0,
  'browser payload does not expose the member user UUID'
);

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
  '10000000-0000-4000-8000-000000000001',
  'member',
  '10000000-0000-4000-8000-000000000002',
  'Public creator',
  chr(128640)
);

select is(
  public.get_live_room_member_summaries(
    '30000000-0000-4000-8000-000000000001',
    'member',
    '10000000-0000-4000-8000-000000000001',
    null,
    array['20000000-0000-4000-8000-000000000002'::uuid],
    8
  )->'items',
  '[]'::jsonb,
  'bilaterally blocked members are excluded'
);

select * from finish();

rollback;
