begin;

select plan(27);

select has_table(
  'public',
  'live_room_message_likes',
  'message likes table exists'
);

select has_column(
  'public',
  'live_room_messages',
  'like_count',
  'messages store the synchronized like count'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.live_room_message_likes'::regclass
  ),
  'message likes table has RLS enabled'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy
    where polrelid = 'public.live_room_message_likes'::regclass
  ),
  0,
  'message likes table exposes no browser policies'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.live_room_message_likes',
    'select,insert,delete'
  ),
  'service role can manage message likes'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.live_room_message_likes',
    'select'
  ),
  'anonymous browser role cannot read message likes'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.live_room_message_likes',
    'select'
  ),
  'authenticated browser role cannot read message likes'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.set_live_room_message_like(uuid,uuid,uuid,boolean)',
    'execute'
  ),
  'service role can set a message like'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_live_room_message_like(uuid,uuid,uuid,boolean)',
    'execute'
  ),
  'anonymous browser role cannot set a message like'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_live_room_message_like(uuid,uuid,uuid,boolean)',
    'execute'
  ),
  'authenticated browser role cannot set a message like'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_live_room_message_reply_counts(uuid,uuid[],uuid[])',
    'execute'
  ),
  'service role can read batched reply counts'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_live_room_message_reply_counts(uuid,uuid[],uuid[])',
    'execute'
  ),
  'anonymous browser role cannot read batched reply counts'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_live_room_message_reply_counts(uuid,uuid[],uuid[])',
    'execute'
  ),
  'authenticated browser role cannot read batched reply counts'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.live_room_message_likes'::regclass
      and tgname = 'live_room_message_likes_sync_count'
      and not tgisinternal
  ),
  'message like writes synchronize the stored count'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.live_room_messages'::regclass
      and tgname = 'live_room_messages_touch_reply_parent'
      and not tgisinternal
  ),
  'reply changes touch the parent message'
);

insert into public.user_profiles (id)
values
  ('71000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000003'),
  ('71000000-0000-4000-8000-000000000004');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'Message liker',
    chr(128075),
    '71100000-0000-4000-8000-000000000001',
    true
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'Message author',
    chr(128640),
    '71100000-0000-4000-8000-000000000002',
    true
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    'Blocked replier',
    chr(128202),
    '71100000-0000-4000-8000-000000000003',
    true
  ),
  (
    '71000000-0000-4000-8000-000000000004',
    'Visible replier',
    chr(127793),
    '71100000-0000-4000-8000-000000000004',
    true
  );

insert into public.live_room_rooms (id, ticker, room_kind)
values
  (
    '72000000-0000-4000-8000-000000000001',
    'MENGZZ',
    'company'
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    'MENGYY',
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
  visibility_status,
  reply_to_message_id
)
values
  (
    '73000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'member',
    '71000000-0000-4000-8000-000000000002',
    'Message author',
    chr(128640),
    'free',
    'Visible engagement target',
    'visible',
    null
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'member',
    '71000000-0000-4000-8000-000000000004',
    'Visible replier',
    chr(127793),
    'free',
    'Visible reply',
    'visible',
    '73000000-0000-4000-8000-000000000001'
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    'member',
    '71000000-0000-4000-8000-000000000002',
    'Message author',
    chr(128640),
    'free',
    'Hidden reply',
    'hidden',
    '73000000-0000-4000-8000-000000000001'
  ),
  (
    '73000000-0000-4000-8000-000000000004',
    '72000000-0000-4000-8000-000000000001',
    'member',
    '71000000-0000-4000-8000-000000000003',
    'Blocked replier',
    chr(128202),
    'free',
    'Blocked visible reply',
    'visible',
    '73000000-0000-4000-8000-000000000001'
  ),
  (
    '73000000-0000-4000-8000-000000000005',
    '72000000-0000-4000-8000-000000000001',
    'member',
    '71000000-0000-4000-8000-000000000002',
    'Message author',
    chr(128640),
    'free',
    'Hidden engagement target',
    'hidden',
    null
  ),
  (
    '73000000-0000-4000-8000-000000000006',
    '72000000-0000-4000-8000-000000000002',
    'member',
    '71000000-0000-4000-8000-000000000002',
    'Message author',
    chr(128640),
    'free',
    'Other room engagement target',
    'visible',
    null
  );

select is(
  (
    select reply_count
    from public.get_live_room_message_reply_counts(
      '72000000-0000-4000-8000-000000000001',
      array['73000000-0000-4000-8000-000000000001'::uuid],
      array['71000000-0000-4000-8000-000000000003'::uuid]
    )
    where message_id = '73000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'batched reply count excludes hidden and blocked replies'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  $$ values (true, 1::bigint) $$,
  'member can like a visible message'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  $$ values (true, 1::bigint) $$,
  'setting the same desired like state is idempotent'
);

select is(
  (
    select like_count
    from public.live_room_messages
    where id = '73000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'message row stores the trigger-maintained like count'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      true
    )
  $$,
  $$ values (true, 2::bigint) $$,
  'message authors can like their own message'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      false
    )
  $$,
  $$ values (false, 1::bigint) $$,
  'member can remove a message like'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      false
    )
  $$,
  $$ values (false, 1::bigint) $$,
  'removing an absent like is idempotent'
);

select results_eq(
  $$
    select liked, like_count
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      false
    )
  $$,
  $$ values (false, 0::bigint) $$,
  'removing the last like never produces a negative count'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000005',
      '71000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  'P0001',
  'LIVE_ROOM_MESSAGE_NOT_FOUND',
  'hidden messages cannot be liked'
);

select throws_ok(
  $$
    select *
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000002',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  'P0001',
  'LIVE_ROOM_MESSAGE_NOT_FOUND',
  'a message cannot be liked through another room'
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
  '71000000-0000-4000-8000-000000000002',
  'member',
  '71000000-0000-4000-8000-000000000001',
  'Message liker',
  chr(128075)
);

select throws_ok(
  $$
    select *
    from public.set_live_room_message_like(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      true
    )
  $$,
  'P0001',
  'LIVE_ROOM_MESSAGE_NOT_FOUND',
  'bilaterally blocked actors cannot like a message'
);

update public.live_room_messages
set visibility_status = 'hidden'
where id = '73000000-0000-4000-8000-000000000002';

select is(
  coalesce(
    (
      select reply_count
      from public.get_live_room_message_reply_counts(
        '72000000-0000-4000-8000-000000000001',
        array['73000000-0000-4000-8000-000000000001'::uuid],
        array['71000000-0000-4000-8000-000000000003'::uuid]
      )
      where message_id = '73000000-0000-4000-8000-000000000001'
    ),
    0
  ),
  0::bigint,
  'reply visibility changes are reflected in the visible count'
);

select * from finish();

rollback;
