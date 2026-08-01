begin;

select plan(18);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'live_room_member_profiles'
      and column_name = 'avatar_path'
      and is_nullable = 'YES'
  ),
  'member avatar path is nullable'
);

select ok(
  to_regprocedure(
    'public.set_live_room_member_avatar_path(uuid,text)'
  ) is not null,
  'the service avatar setter exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.set_live_room_member_avatar_path(uuid,text)',
    'execute'
  ),
  'service role can update an avatar path'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_live_room_member_avatar_path(uuid,text)',
    'execute'
  ),
  'anonymous browsers cannot update avatar paths'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_live_room_member_avatar_path(uuid,text)',
    'execute'
  ),
  'authenticated browsers cannot update avatar paths directly'
);

select is(
  (
    select routine.security_type
    from information_schema.routines as routine
    where routine.routine_schema = 'public'
      and routine.routine_name = 'set_live_room_member_avatar_path'
  ),
  'INVOKER',
  'the avatar setter remains security invoker'
);

select ok(
  exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'live-room-member-avatars'
      and bucket.public = true
      and bucket.file_size_limit = 1048576
      and bucket.allowed_mime_types = array['image/webp']::text[]
  ),
  'the public avatar bucket accepts only processed WebP objects'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
  ),
  'Storage objects keep RLS enabled'
);

select is(
  (
    select pg_catalog.count(*)::bigint
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.cmd in ('INSERT', 'UPDATE', 'DELETE')
      and (
        coalesce(policy.qual, '') like '%live-room-member-avatars%'
        or coalesce(policy.with_check, '')
          like '%live-room-member-avatars%'
      )
  ),
  0::bigint,
  'no browser write or delete policy exists for the avatar bucket'
);

insert into public.user_profiles (id)
values
  ('99000000-0000-4000-8000-000000000001'),
  ('99000000-0000-4000-8000-000000000002');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji
)
values
  (
    '99000000-0000-4000-8000-000000000001',
    'Avatar Owner',
    null
  ),
  (
    '99000000-0000-4000-8000-000000000002',
    'Avatar Other',
    null
  );

select lives_ok(
  format(
    $sql$
      select *
      from public.set_live_room_member_avatar_path(
        '99000000-0000-4000-8000-000000000001',
        %L
      )
    $sql$,
    (
      select profile.public_profile_id::text
        || '/99000000-0000-4000-8000-000000000011.webp'
      from public.live_room_member_profiles as profile
      where profile.user_id =
        '99000000-0000-4000-8000-000000000001'
    )
  ),
  'an owner-scoped opaque avatar path is accepted'
);

select is(
  (
    select pg_catalog.right(profile.avatar_path, 42)
    from public.live_room_member_profiles as profile
    where profile.user_id =
      '99000000-0000-4000-8000-000000000001'
  ),
  '/99000000-0000-4000-8000-000000000011.webp',
  'the validated avatar path is stored'
);

select throws_ok(
  format(
    $sql$
      select *
      from public.set_live_room_member_avatar_path(
        '99000000-0000-4000-8000-000000000001',
        %L
      )
    $sql$,
    (
      select profile.public_profile_id::text
        || '/99000000-0000-4000-8000-000000000012.webp'
      from public.live_room_member_profiles as profile
      where profile.user_id =
        '99000000-0000-4000-8000-000000000002'
    )
  ),
  '22023',
  'LIVE_ROOM_INVALID_AVATAR_PATH',
  'a path scoped to another public profile is rejected'
);

select throws_ok(
  $$
    update public.live_room_member_profiles
    set avatar_path = 'https://attacker.example/avatar.webp'
    where user_id = '99000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'raw external avatar URLs cannot bypass the path constraint'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_avatar_path(
      '99000000-0000-4000-8000-000000000001',
      null
    )
  $$,
  'the owner avatar can be removed'
);

select is(
  (
    select profile.avatar_path
    from public.live_room_member_profiles as profile
    where profile.user_id =
      '99000000-0000-4000-8000-000000000001'
  ),
  null,
  'avatar removal restores the NULL fallback state'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.live_room_member_profiles',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.live_room_member_profiles',
    'select'
  ),
  'avatar paths remain absent from direct browser profile reads'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.live_room_member_profiles',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.live_room_member_profiles',
    'update'
  ),
  'the service repository retains only its explicit profile access'
);

select ok(
  (
    select pg_catalog.array_to_string(setting.proconfig, ',')
    from pg_catalog.pg_proc as setting
    where setting.oid =
      'public.set_live_room_member_avatar_path(uuid,text)'::regprocedure
  ) like '%search_path=""%',
  'the avatar setter has an empty search path'
);

select * from finish();

rollback;
