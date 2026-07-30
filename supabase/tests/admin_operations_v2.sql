begin;

select plan(33);

select has_table('public', 'user_community_status', 'community status table exists');
select has_table('public', 'user_community_enforcement_actions', 'community enforcement history exists');
select has_table('public', 'admin_moderation_cases', 'unified moderation queue exists');
select has_table('public', 'admin_moderation_case_events', 'moderation case history exists');

select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_catalog.pg_class as relation
    where relation.oid in (
      'public.user_community_status'::regclass,
      'public.user_community_enforcement_actions'::regclass,
      'public.admin_moderation_cases'::regclass,
      'public.admin_moderation_case_events'::regclass
    )
  ),
  'all administrator operation tables have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.user_community_status', 'select')
  and not has_table_privilege('anon', 'public.admin_moderation_cases', 'select'),
  'anonymous clients cannot read administrator operation data'
);

select ok(
  not has_table_privilege('authenticated', 'public.user_community_status', 'select')
  and not has_table_privilege('authenticated', 'public.admin_moderation_cases', 'select'),
  'authenticated clients cannot read administrator operation data'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.user_community_status',
    'select,insert,update'
  ),
  'service role manages effective community status'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.user_community_enforcement_actions',
    'select,insert'
  ),
  'service role appends community enforcement history'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.admin_moderation_cases',
    'select,insert,update'
  ),
  'service role manages moderation case workflow'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.admin_moderation_case_events',
    'select,insert'
  ),
  'service role appends moderation case history'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_apply_user_community_action(uuid,uuid,text,text,timestamptz)',
    'execute'
  ),
  'browser clients cannot apply community enforcement'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_apply_user_community_action(uuid,uuid,text,text,timestamptz)',
    'execute'
  ),
  'service role can apply community enforcement'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_set_role_assignment(uuid,uuid,text,boolean,text)',
    'execute'
  ),
  'browser clients cannot change administrator roles'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_role_assignment(uuid,uuid,text,boolean,text)',
    'execute'
  ),
  'service role can change administrator roles'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_update_moderation_case(uuid,uuid,text,text,text,text,uuid,timestamptz)',
    'execute'
  ),
  'browser clients cannot mutate moderation cases'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_update_moderation_case(uuid,uuid,text,text,text,text,uuid,timestamptz)',
    'execute'
  ),
  'service role can mutate moderation cases'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger as trigger
    where trigger.tgname in (
      'live_room_message_reports_create_admin_case',
      'live_room_post_reports_create_admin_case',
      'live_room_post_comment_reports_create_admin_case',
      'live_room_direct_message_reports_create_admin_case'
    )
      and not trigger.tgisinternal
  ),
  4,
  'all raw report tables feed the unified queue'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.user_community_enforcement_actions',
    'update,delete'
  )
  and not has_table_privilege(
    'service_role',
    'public.admin_moderation_case_events',
    'update,delete'
  ),
  'administrator action histories are append-only'
);

insert into public.user_profiles (id)
values
  ('92000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002'),
  ('92000000-0000-4000-8000-000000000003'),
  ('92000000-0000-4000-8000-000000000004');

insert into public.admin_role_assignments (user_id, role, active)
values
  ('92000000-0000-4000-8000-000000000001', 'super_admin', true),
  ('92000000-0000-4000-8000-000000000002', 'moderator', true);

select lives_ok(
  $$ select public.admin_apply_user_community_action(
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000003',
    'temporary_suspend',
    'Temporary community safety review',
    now() + interval '2 days'
  ) $$,
  'a moderator can temporarily suspend another community member'
);

select is(
  (
    select status
    from public.user_community_status
    where user_id = '92000000-0000-4000-8000-000000000003'
  ),
  'temporarily_suspended',
  'effective community status records the suspension'
);

select is(
  (
    select count(*)::integer
    from public.user_community_enforcement_actions
    where user_id = '92000000-0000-4000-8000-000000000003'
      and action = 'temporary_suspend'
  ),
  1,
  'community enforcement history is appended'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where target_id = '92000000-0000-4000-8000-000000000003'
      and action = 'community.temporary_suspend'
  ),
  1,
  'community enforcement is written to the administrator audit log'
);

select throws_ok(
  $$ select private.assert_user_community_write_allowed(
    '92000000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'COMMUNITY_ACCESS_SUSPENDED',
  'suspended members are blocked by the shared community write guard'
);

select throws_ok(
  $$ select public.admin_apply_user_community_action(
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000004',
    'warning',
    'no',
    null
  ) $$,
  'P0001',
  'ADMIN_REASON_REQUIRED',
  'community enforcement always requires a meaningful reason'
);

select lives_ok(
  $$ select public.admin_set_role_assignment(
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000004',
    'support',
    true,
    'Support coverage for local verification'
  ) $$,
  'a super administrator can grant a database-backed role'
);

select ok(
  exists (
    select 1
    from public.admin_role_assignments
    where user_id = '92000000-0000-4000-8000-000000000004'
      and role = 'support'
      and active = true
  ),
  'the granted administrator role is active'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'admin_role.grant'
      and target_id =
        '92000000-0000-4000-8000-000000000004:support'
  ),
  1,
  'role changes are written to the administrator audit log'
);

select throws_ok(
  $$ select public.admin_set_role_assignment(
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'super_admin',
    false,
    'Attempted self role removal'
  ) $$,
  'P0001',
  'ADMIN_SELF_ROLE_CHANGE_FORBIDDEN',
  'a super administrator cannot change their own role'
);

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  target_type,
  target_id,
  target_snapshot
)
values (
  'message',
  '92000000-0000-4000-8000-000000000011',
  'live_room_message',
  '92000000-0000-4000-8000-000000000012',
  jsonb_build_object(
    'author_user_id',
    '92000000-0000-4000-8000-000000000004',
    'body',
    'captured report evidence'
  )
);

select lives_ok(
  $$ select public.admin_update_moderation_case(
    '92000000-0000-4000-8000-000000000002',
    (
      select id
      from public.admin_moderation_cases
      where report_id = '92000000-0000-4000-8000-000000000011'
    ),
    'dismiss',
    'Report reviewed and dismissed',
    null,
    null,
    null,
    null
  ) $$,
  'a moderator can dismiss one reviewed case'
);

select is(
  (
    select status
    from public.admin_moderation_cases
    where report_id = '92000000-0000-4000-8000-000000000011'
  ),
  'dismissed',
  'the moderation case reaches dismissed state'
);

select is(
  (
    select count(*)::integer
    from public.admin_moderation_case_events as event
    join public.admin_moderation_cases as moderation_case
      on moderation_case.id = event.case_id
    where moderation_case.report_id =
        '92000000-0000-4000-8000-000000000011'
      and event.action = 'dismiss'
  ),
  1,
  'moderation case history remains append-only'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs as audit
    join public.admin_moderation_cases as moderation_case
      on audit.target_id = moderation_case.id::text
    where moderation_case.report_id =
        '92000000-0000-4000-8000-000000000011'
      and audit.action = 'moderation.dismiss'
  ),
  1,
  'moderation actions are written to the administrator audit log'
);

select * from finish();
rollback;
