begin;

select plan(6);

select ok(
  to_regprocedure(
    'private.join_live_room_community_room_owner()'
  ) is not null,
  'Community Room creator membership trigger function exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid =
        'public.live_room_community_rooms'::regclass
      and trigger.tgname =
        'join_live_room_community_room_owner'
      and not trigger.tgisinternal
  ),
  'Community Room creation installs the creator membership trigger'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.join_live_room_community_room_owner()',
    'execute'
  ),
  'anonymous browser role cannot execute the creator membership trigger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.join_live_room_community_room_owner()',
    'execute'
  ),
  'authenticated browser role cannot execute the creator membership trigger'
);

insert into public.user_profiles (id)
values ('88000000-0000-4000-8000-000000000001');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
values (
  '88000000-0000-4000-8000-000000000001',
  'Community creator',
  chr(128640),
  '88100000-0000-4000-8000-000000000001',
  true
);

select public.create_live_room_community_room(
  '88000000-0000-4000-8000-000000000001',
  'community-creator-membership-test',
  'Community creator membership',
  'Verifies that a creator joins the new room atomically.',
  'creator_community',
  'open_discussion',
  array['company_news'],
  'en',
  array['QACR'],
  array[]::text[],
  array[]::text[]
);

select ok(
  exists (
    select 1
    from public.live_room_memberships as membership
    join public.live_room_community_rooms as room
      on room.room_id = membership.room_id
    where room.slug = 'community-creator-membership-test'
      and membership.member_user_id =
        '88000000-0000-4000-8000-000000000001'
  ),
  'Community Room creator becomes a persistent member'
);

select ok(
  exists (
    select 1
    from public.live_room_follows as follow
    join public.live_room_community_rooms as room
      on room.room_id = follow.room_id
    where room.slug = 'community-creator-membership-test'
      and follow.actor_kind = 'member'
      and follow.member_user_id =
        '88000000-0000-4000-8000-000000000001'
      and follow.followed = true
  ),
  'Community Room creator receives the canonical unread/follow state'
);

select * from finish();

rollback;
