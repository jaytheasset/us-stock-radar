begin;

select plan(24);

select has_column(
  'public',
  'live_room_rooms',
  'admin_status',
  'Live Room stores its administrator-controlled availability'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger as trigger
    where trigger.tgname in (
      'live_room_messages_enforce_room_writable',
      'live_room_posts_enforce_room_writable',
      'live_room_post_comments_enforce_room_writable',
      'live_room_memberships_enforce_room_writable'
    )
      and not trigger.tgisinternal
  ),
  4,
  'all public Live Room create paths share the availability guard'
);

select is(
  (
    select procedure.provolatile::text
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.assert_live_room_writable(uuid)'::regprocedure
  ),
  'v',
  'the room write guard can acquire a transaction-scoped lock'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.assert_live_room_writable(uuid)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'room state changes and public writes serialize on the same room lock'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_set_live_room_status(uuid,uuid,text,text,text)',
    'execute'
  ),
  'browser members cannot change room availability'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_live_room_status(uuid,uuid,text,text,text)',
    'execute'
  ),
  'service role can invoke the room control RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_list_live_rooms(uuid,text,text,text,integer)',
    'execute'
  ),
  'browser members cannot query administrator room inventory'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_list_live_rooms(uuid,text,text,text,integer)',
    'execute'
  ),
  'service role can query administrator room inventory'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_record_source_run_audit(uuid,text,text,boolean,integer,jsonb,text)',
    'execute'
  ),
  'browser members cannot write source-run audit records'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_record_source_run_audit(uuid,text,text,boolean,integer,jsonb,text)',
    'execute'
  ),
  'service role can write source-run audit records'
);

insert into public.user_profiles (id)
values
  ('93000000-0000-4000-8000-000000000001'),
  ('93000000-0000-4000-8000-000000000002'),
  ('93000000-0000-4000-8000-000000000003');

insert into public.admin_role_assignments (user_id, role, active)
values
  ('93000000-0000-4000-8000-000000000001', 'moderator', true),
  ('93000000-0000-4000-8000-000000000002', 'operations', true);

insert into public.live_room_rooms (id, ticker, room_kind)
values (
  '93000000-0000-4000-8000-000000000010',
  'ADM3',
  'company'
);

select lives_ok(
  $$ select public.admin_set_live_room_status(
    '93000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000010',
    'lock',
    'Room safety review in progress',
    'admin-rooms-v3-lock'
  ) $$,
  'a moderator can lock a room with a reason'
);

select is(
  (
    select admin_status
    from public.live_room_rooms
    where id = '93000000-0000-4000-8000-000000000010'
  ),
  'locked',
  'locking stores the room availability state'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where target_id = '93000000-0000-4000-8000-000000000010'
      and action = 'live_room.lock'
  ),
  1,
  'locking appends an administrator audit record'
);

select throws_ok(
  $$ insert into public.live_room_memberships (room_id, member_user_id)
    values (
      '93000000-0000-4000-8000-000000000010',
      '93000000-0000-4000-8000-000000000003'
    ) $$,
  'P0001',
  'LIVE_ROOM_LOCKED',
  'a locked room rejects new membership'
);

select is(
  public.admin_get_live_room_detail(
    '93000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000010'
  )->'summary'->>'status',
  'locked',
  'locked room history remains available to the administrator detail view'
);

select is(
  pg_catalog.jsonb_array_length(
    public.admin_list_live_rooms(
      '93000000-0000-4000-8000-000000000001',
      'ADM3',
      'company',
      'locked',
      10
    )->'items'
  ),
  1,
  'administrator inventory finds a locked company room'
);

select lives_ok(
  $$ select public.admin_set_live_room_status(
    '93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000010',
    'archive',
    'Archive this inactive test room',
    'admin-rooms-v3-archive'
  ) $$,
  'operations can archive a room'
);

select is(
  (
    select admin_status
    from public.live_room_rooms
    where id = '93000000-0000-4000-8000-000000000010'
  ),
  'archived',
  'archiving stores a read-only room state'
);

select lives_ok(
  $$ select public.admin_record_source_run_audit(
    '93000000-0000-4000-8000-000000000002',
    'started',
    'Manual GlobeNewswire verification',
    false,
    1,
    '{"test":true}'::jsonb,
    'admin-source-v3'
  ) $$,
  'operations can append a reasoned source-run audit'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where actor_user_id = '93000000-0000-4000-8000-000000000002'
      and action = 'source.globe.run.started'
  ),
  1,
  'source-run audit retains the actor and phase'
);

select throws_ok(
  $$ select public.admin_record_source_run_audit(
    '93000000-0000-4000-8000-000000000001',
    'started',
    'Moderator must not run ingestion',
    false,
    1,
    null,
    'admin-source-v3-denied'
  ) $$,
  'P0001',
  'ADMIN_PERMISSION_REQUIRED',
  'moderators cannot run a data ingestion mutation'
);

select throws_ok(
  $$ select public.admin_set_live_room_status(
    '93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000010',
    'restore',
    'no',
    'admin-rooms-v3-short-reason'
  ) $$,
  'P0001',
  'ADMIN_REASON_REQUIRED',
  'room mutations require a meaningful reason'
);

select lives_ok(
  $$ select public.admin_set_live_room_status(
    '93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000010',
    'restore',
    'Restore after administrator verification',
    'admin-rooms-v3-restore'
  ) $$,
  'operations can restore an archived room'
);

select lives_ok(
  $$ insert into public.live_room_memberships (room_id, member_user_id)
    values (
      '93000000-0000-4000-8000-000000000010',
      '93000000-0000-4000-8000-000000000003'
    ) $$,
  'restored rooms accept new membership again'
);

select * from finish();

rollback;
