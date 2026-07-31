begin;

select plan(21);

select ok(
  to_regprocedure(
    'public.set_live_room_member_profile(uuid,text,text)'
  ) is not null,
  'the atomic member profile setter exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.set_live_room_member_profile(uuid,text,text)',
    'execute'
  ),
  'service role can save a member profile'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_live_room_member_profile(uuid,text,text)',
    'execute'
  ),
  'anonymous browser role cannot save a member profile'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_live_room_member_profile(uuid,text,text)',
    'execute'
  ),
  'authenticated browser role cannot save a member profile'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'live_room_member_profiles'
      and column_name = 'bio'
      and is_nullable = 'YES'
  ),
  'member bio is nullable'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'live_room_member_profiles'
  ),
  'member profiles keep RLS enabled'
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
  )
  and has_table_privilege(
    'service_role',
    'public.live_room_member_profiles',
    'select'
  ),
  'member profiles remain service-only'
);

select ok(
  to_regprocedure(
    'public.set_live_room_member_chat_name(uuid,text)'
  ) is not null,
  'the existing chat-name setter remains available'
);

insert into public.user_profiles (id)
values
  ('98000000-0000-4000-8000-000000000001'),
  ('98000000-0000-4000-8000-000000000002');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji
)
values
  ('98000000-0000-4000-8000-000000000001', null, null),
  ('98000000-0000-4000-8000-000000000002', null, null);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      ''
    )
  $$,
  'an empty bio is accepted'
);

select is(
  (
    select bio
    from public.live_room_member_profiles
    where user_id = '98000000-0000-4000-8000-000000000001'
  ),
  null,
  'an empty bio is stored as NULL'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      E'  First line  \r\n  Second line  '
    )
  $$,
  'CRLF and surrounding spaces are normalized'
);

select is(
  (
    select bio
    from public.live_room_member_profiles
    where user_id = '98000000-0000-4000-8000-000000000001'
  ),
  E'First line\nSecond line',
  'the canonical plain-text bio is stored'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      repeat('a', 280)
    )
  $$,
  'a 280-character bio is accepted'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      E'one\ntwo\nthree\nfour'
    )
  $$,
  'a four-line bio is accepted'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      repeat('a', 281)
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_PROFILE_BIO',
  'a 281-character bio is rejected'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      E'one\ntwo\nthree\nfour\nfive'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_PROFILE_BIO',
  'a five-line bio is rejected'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      '<strong>Not plain text</strong>'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_PROFILE_BIO',
  'HTML-like input is rejected'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000001',
      'Profile Scout',
      E'Not\tplain text'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_PROFILE_BIO',
  'forbidden control characters are rejected'
);

select throws_ok(
  $$
    update public.live_room_member_profiles
    set bio = ' <not normalized>'
    where user_id = '98000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'the table constraint blocks direct invalid bio bypasses'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_profile(
      '98000000-0000-4000-8000-000000000002',
      'Atomic Rename',
      repeat('a', 281)
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_PROFILE_BIO',
  'invalid bio rejects the whole profile write'
);

select is(
  (
    select display_name
    from public.live_room_member_profiles
    where user_id = '98000000-0000-4000-8000-000000000002'
  ),
  null,
  'an invalid bio cannot partially save the chat name'
);

select * from finish();

rollback;
