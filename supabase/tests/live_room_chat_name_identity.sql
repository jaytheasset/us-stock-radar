begin;

select plan(25);

select ok(
  to_regprocedure('public.set_live_room_member_chat_name(uuid,text)') is not null,
  'service-only chat-name setter exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.set_live_room_member_chat_name(uuid,text)',
    'execute'
  ),
  'service role can set a member chat name'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_live_room_member_chat_name(uuid,text)',
    'execute'
  ),
  'anonymous browser role cannot set a member chat name'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_live_room_member_chat_name(uuid,text)',
    'execute'
  ),
  'authenticated browser role cannot set a member chat name'
);

select ok(
  (
    select
      index_metadata.indisunique
      and pg_catalog.strpos(
        pg_catalog.pg_get_indexdef(index_metadata.indexrelid),
        'lower(display_name)'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_indexdef(index_metadata.indexrelid),
        'display_name IS NOT NULL'
      ) > 0
    from pg_catalog.pg_index as index_metadata
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_metadata.indexrelid
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname =
        'live_room_member_profiles_chat_name_unique_idx'
  ),
  'chat names have a case-insensitive partial unique index'
);

insert into public.user_profiles (id)
values
  ('97000000-0000-4000-8000-000000000001'),
  ('97000000-0000-4000-8000-000000000002'),
  ('97000000-0000-4000-8000-000000000003');

select lives_ok(
  $$
    insert into public.live_room_member_profiles (user_id, display_name, emoji)
    values (
      '97000000-0000-4000-8000-000000000001',
      null,
      null
    )
  $$,
  'a new member profile can remain explicitly unnamed'
);

insert into public.live_room_member_profiles (user_id, display_name, emoji)
values
  ('97000000-0000-4000-8000-000000000002', null, null),
  ('97000000-0000-4000-8000-000000000003', null, null);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000001',
      '  Moon   Scout  '
    )
  $$,
  'the service setter accepts and normalizes a valid ASCII chat name'
);

select is(
  (
    select display_name
    from public.live_room_member_profiles
    where user_id = '97000000-0000-4000-8000-000000000001'
  ),
  'Moon Scout',
  'trimmed and collapsed whitespace is stored'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000001',
      'moon scout'
    )
  $$,
  'a member can save their own existing name with different casing'
);

select is(
  (
    select display_name
    from public.live_room_member_profiles
    where user_id = '97000000-0000-4000-8000-000000000001'
  ),
  'moon scout',
  'a successful change updates the current public identity'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000002',
      'MOON SCOUT'
    )
  $$,
  '23505',
  'LIVE_ROOM_CHAT_NAME_TAKEN',
  'another member cannot race a case-insensitive duplicate'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000002',
      '한글 Name'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_CHAT_NAME',
  'Unicode chat names are rejected'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000002',
      '1Trader'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_CHAT_NAME',
  'a chat name cannot begin with a number'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000002',
      'Stock-Radar'
    )
  $$,
  '22023',
  'LIVE_ROOM_RESERVED_CHAT_NAME',
  'reserved identities remain blocked across separators and casing'
);

select throws_ok(
  $$
    update public.live_room_member_profiles
    set display_name = 'Bad!'
    where user_id = '97000000-0000-4000-8000-000000000002'
  $$,
  '23514',
  null,
  'the table constraint blocks direct invalid-name bypasses'
);

insert into public.live_room_rooms (id, ticker, room_kind)
values (
  '97100000-0000-4000-8000-000000000001',
  'CIDQA',
  'company'
);

select throws_ok(
  $$
    insert into public.live_room_messages (
      room_id,
      author_kind,
      member_user_id,
      author_display_name,
      author_emoji,
      author_plan,
      body
    )
    values (
      '97100000-0000-4000-8000-000000000001',
      'member',
      '97000000-0000-4000-8000-000000000002',
      'Spoofed Name',
      chr(128075),
      'free',
      'This message must be rejected.'
    )
  $$,
  '23514',
  'LIVE_ROOM_CHAT_NAME_REQUIRED',
  'message writes fail closed until chat identity setup'
);

select throws_ok(
  $$
    insert into public.live_room_posts (
      room_id,
      author_user_id,
      title,
      body
    )
    values (
      '97100000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000002',
      'Unnamed member post',
      'This post body is long enough but must still be rejected.'
    )
  $$,
  '23514',
  'LIVE_ROOM_CHAT_NAME_REQUIRED',
  'post writes fail closed until chat identity setup'
);

select lives_ok(
  $$
    insert into public.live_room_messages (
      id,
      room_id,
      author_kind,
      member_user_id,
      author_display_name,
      author_emoji,
      author_plan,
      body
    )
    values (
      '97200000-0000-4000-8000-000000000001',
      '97100000-0000-4000-8000-000000000001',
      'member',
      '97000000-0000-4000-8000-000000000001',
      'Spoofed Name',
      chr(128075),
      'free',
      'The trigger must use the current profile name.'
    )
  $$,
  'a named member can create a message'
);

select is(
  (
    select author_display_name
    from public.live_room_messages
    where id = '97200000-0000-4000-8000-000000000001'
  ),
  'moon scout',
  'message identity snapshots are derived from the current profile'
);

select is(
  (
    select author_emoji
    from public.live_room_messages
    where id = '97200000-0000-4000-8000-000000000001'
  ),
  'M',
  'new message snapshots use the uppercase chat-name initial'
);

insert into public.live_room_posts (
  id,
  room_id,
  author_user_id,
  title,
  body
)
values (
  '97300000-0000-4000-8000-000000000001',
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  'Named member post',
  'This valid post provides a parent for the comment identity test.'
);

select throws_ok(
  $$
    insert into public.live_room_post_comments (
      post_id,
      author_user_id,
      body
    )
    values (
      '97300000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000002',
      'Unnamed reply'
    )
  $$,
  '23514',
  'LIVE_ROOM_CHAT_NAME_REQUIRED',
  'comment writes fail closed until chat identity setup'
);

select lives_ok(
  $$
    insert into public.live_room_post_comments (
      post_id,
      author_user_id,
      body
    )
    values (
      '97300000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000001',
      'Named reply'
    )
  $$,
  'a named member can create a comment'
);

update public.live_room_member_profiles
set display_name = null
where user_id = '97000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    update public.live_room_posts
    set like_count = like_count + 1
    where id = '97300000-0000-4000-8000-000000000001'
  $$,
  'engagement updates on historical posts do not require a current chat name'
);

select lives_ok(
  $$
    update public.live_room_posts
    set visibility_status = 'hidden'
    where id = '97300000-0000-4000-8000-000000000001'
  $$,
  'moderation updates on historical posts do not require a current chat name'
);

select throws_ok(
  $$
    update public.live_room_posts
    set body = 'An unnamed member cannot edit public post content.'
    where id = '97300000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'LIVE_ROOM_CHAT_NAME_REQUIRED',
  'public content edits still require the author chat identity'
);

select * from finish();

rollback;
