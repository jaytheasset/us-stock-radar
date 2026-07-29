begin;

select plan(17);

select ok(
  to_regprocedure(
    'public.get_live_room_resume_state(uuid,uuid)'
  ) is not null,
  'joined-room resume RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_live_room_resume_state(uuid,uuid)',
    'execute'
  ),
  'service role can read the resume cursor'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_live_room_resume_state(uuid,uuid)',
    'execute'
  ),
  'anonymous browser role cannot read resume cursors'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_live_room_resume_state(uuid,uuid)',
    'execute'
  ),
  'authenticated browser role cannot read resume cursors'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.list_live_room_memberships(uuid,integer)',
    'execute'
  ),
  'service role can read the enriched membership list'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_live_room_memberships(uuid,integer)',
    'execute'
  ),
  'membership aggregates remain server-only'
);

insert into public.user_profiles (id)
values
  ('81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003');

insert into public.live_room_member_profiles (
  user_id,
  display_name,
  emoji,
  public_profile_id,
  show_presence
)
values
  (
    '81000000-0000-4000-8000-000000000001',
    'Resume reader',
    chr(128075),
    '81100000-0000-4000-8000-000000000001',
    true
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    'Visible author',
    chr(128640),
    '81100000-0000-4000-8000-000000000002',
    true
  ),
  (
    '81000000-0000-4000-8000-000000000003',
    'Blocked author',
    chr(128202),
    '81100000-0000-4000-8000-000000000003',
    true
  );

insert into public.live_room_rooms (id, ticker, room_kind)
values (
  '82000000-0000-4000-8000-000000000001',
  'RSMZZ',
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
  created_at
)
values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'member',
  '81000000-0000-4000-8000-000000000002',
  'Visible author',
  chr(128640),
  'free',
  'Last read context',
  'visible',
  '2026-07-29 10:00:00+00'
);

select ok(
  public.set_live_room_membership(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    true
  ),
  'reader joins after the context message'
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
  created_at
)
values
  (
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    'member',
    '81000000-0000-4000-8000-000000000002',
    'Visible author',
    chr(128640),
    'free',
    'First visible unread',
    'visible',
    '2026-07-29 10:01:00+00'
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000001',
    'member',
    '81000000-0000-4000-8000-000000000002',
    'Visible author',
    chr(128640),
    'free',
    'Hidden unread',
    'hidden',
    '2026-07-29 10:02:00+00'
  ),
  (
    '83000000-0000-4000-8000-000000000004',
    '82000000-0000-4000-8000-000000000001',
    'member',
    '81000000-0000-4000-8000-000000000001',
    'Resume reader',
    chr(128075),
    'free',
    'Own message',
    'visible',
    '2026-07-29 10:03:00+00'
  ),
  (
    '83000000-0000-4000-8000-000000000005',
    '82000000-0000-4000-8000-000000000001',
    'member',
    '81000000-0000-4000-8000-000000000003',
    'Blocked author',
    chr(128202),
    'free',
    'Blocked unread',
    'visible',
    '2026-07-29 10:04:00+00'
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
  '81000000-0000-4000-8000-000000000001',
  'member',
  '81000000-0000-4000-8000-000000000003',
  'Blocked author',
  chr(128202)
);

insert into public.live_room_member_presence (
  member_user_id,
  ticker,
  room_id,
  last_seen_at
)
values (
  '81000000-0000-4000-8000-000000000002',
  'RSMZZ',
  '82000000-0000-4000-8000-000000000001',
  pg_catalog.now()
);

select is(
  (
    public.get_live_room_resume_state(
      '82000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001'
    )->>'unreadCount'
  )::integer,
  1,
  'hidden, blocked, and self messages do not inflate resume unread'
);

select is(
  public.get_live_room_resume_state(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  )->>'firstUnreadMessageId',
  '83000000-0000-4000-8000-000000000002',
  'resume chooses the first visible unread message'
);

select is(
  public.get_live_room_resume_state(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  )->>'startMessageId',
  '83000000-0000-4000-8000-000000000001',
  'resume includes one visible context message'
);

select is(
  (
    public.list_live_room_memberships(
      '81000000-0000-4000-8000-000000000001',
      20
    )#>>'{items,0,ticker}'
  ),
  'RSMZZ',
  'My Rooms keeps the company ticker'
);

select is(
  (
    public.list_live_room_memberships(
      '81000000-0000-4000-8000-000000000001',
      20
    )#>>'{items,0,participantCount}'
  )::integer,
  3,
  'My Rooms participant count matches memberships and visible contributors'
);

select is(
  (
    public.list_live_room_memberships(
      '81000000-0000-4000-8000-000000000001',
      20
    )#>>'{items,0,onlineCount}'
  )::integer,
  1,
  'My Rooms online count uses the same current presence window'
);

select is(
  (
    public.list_live_room_memberships(
      '81000000-0000-4000-8000-000000000001',
      20
    )#>>'{items,0,unreadCount}'
  )::integer,
  1,
  'My Rooms unread count matches the resume cursor'
);

update public.live_room_messages
set visibility_status = 'hidden'
where id = '83000000-0000-4000-8000-000000000001';

select is(
  public.get_live_room_resume_state(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  )->>'startMessageId',
  '83000000-0000-4000-8000-000000000002',
  'hidden saved context falls back to the first visible unread message'
);

select ok(
  public.mark_live_room_follow_read(
    '82000000-0000-4000-8000-000000000001',
    'member',
    '81000000-0000-4000-8000-000000000001',
    null,
    '83000000-0000-4000-8000-000000000002'
  ),
  'viewport-visible unread can advance the canonical cursor'
);

select is(
  (
    public.get_live_room_resume_state(
      '82000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000001'
    )->>'unreadCount'
  )::integer,
  0,
  'after the visible cursor advances there is no remaining visible unread'
);

select * from finish();

rollback;
