begin;

select plan(26);

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
        'is_display_name_custom'
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
  'only custom names have a case-insensitive partial unique index'
);

select is(
  private.live_room_default_member_display_name('ult@tes.t'),
  'ul',
  'the usual email local part yields exactly its first two characters'
);

select is(
  private.live_room_default_member_display_name('free@tes.t'),
  'fr',
  'another usual email yields its own two-character default'
);

select is(
  private.live_room_default_member_display_name('x@tes.t'),
  'sr',
  'short or abnormal emails use the non-identifying safe fallback'
);

insert into public.user_profiles (id, email)
values
  ('97000000-0000-4000-8000-000000000001', 'ult@tes.t'),
  ('97000000-0000-4000-8000-000000000002', 'free@tes.t'),
  ('97000000-0000-4000-8000-000000000003', 'friend@tes.t');

select lives_ok(
  $$
    insert into public.live_room_member_profiles (
      user_id,
      display_name,
      emoji,
      is_display_name_custom
    )
    values
      (
        '97000000-0000-4000-8000-000000000001',
        'ul',
        null,
        false
      ),
      (
        '97000000-0000-4000-8000-000000000002',
        'fr',
        null,
        false
      ),
      (
        '97000000-0000-4000-8000-000000000003',
        'fr',
        null,
        false
      )
  $$,
  'duplicate automatic defaults are allowed'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.live_room_member_profiles
    where display_name = 'fr'
      and not is_display_name_custom
  ),
  2,
  'automatic duplicate names remain explicitly non-custom'
);

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
  'trimmed and collapsed custom whitespace is stored'
);

select ok(
  (
    select is_display_name_custom
    from public.live_room_member_profiles
    where user_id = '97000000-0000-4000-8000-000000000001'
  ),
  'the setter marks an explicitly chosen name as custom'
);

select lives_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000001',
      'moon scout'
    )
  $$,
  'a member can save their own existing custom name with different casing'
);

select is(
  (
    select display_name
    from public.live_room_member_profiles
    where user_id = '97000000-0000-4000-8000-000000000001'
  ),
  'moon scout',
  'a successful custom change updates the current public identity'
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
  'another member cannot race a case-insensitive custom duplicate'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_member_chat_name(
      '97000000-0000-4000-8000-000000000002',
      pg_catalog.chr(233) || 'clair'
    )
  $$,
  '22023',
  'LIVE_ROOM_INVALID_CHAT_NAME',
  'Unicode custom chat names remain rejected'
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
  'a custom chat name still cannot begin with a number'
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
  'reserved custom identities remain blocked across separators and casing'
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
      '97000000-0000-4000-8000-000000000002',
      'Spoofed Name',
      chr(128075),
      'free',
      'The trigger must use the automatic public name.'
    )
  $$,
  'a member can message without choosing a custom name'
);

select is(
  (
    select author_display_name
    from public.live_room_messages
    where id = '97200000-0000-4000-8000-000000000001'
  ),
  'fr',
  'message snapshots contain exactly the safe two-character default'
);

select lives_ok(
  $$
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
      '97000000-0000-4000-8000-000000000002',
      'Default identity post',
      'This valid post is published with the automatic public identity.'
    )
  $$,
  'a member can publish a post without choosing a custom name'
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
      '97000000-0000-4000-8000-000000000003',
      'Default identity reply'
    )
  $$,
  'a member can comment without choosing a custom name'
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
      '97200000-0000-4000-8000-000000000002',
      '97100000-0000-4000-8000-000000000001',
      'member',
      '97000000-0000-4000-8000-000000000001',
      'Spoofed Name',
      chr(128075),
      'free',
      'The trigger must preserve the current custom name.'
    )
  $$,
  'a custom-name member can continue creating messages'
);

select is(
  (
    select author_display_name
    from public.live_room_messages
    where id = '97200000-0000-4000-8000-000000000002'
  ),
  'moon scout',
  'custom message snapshots preserve the chosen current identity'
);

select * from finish();

rollback;
