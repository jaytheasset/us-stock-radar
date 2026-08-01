begin;

select plan(35);

select has_table(
  'public',
  'admin_telegram_campaigns',
  'administrator Telegram campaign table exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.admin_telegram_campaigns'::regclass
  ),
  'campaign rows have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.admin_telegram_campaigns', 'select')
  and not has_table_privilege(
    'authenticated',
    'public.admin_telegram_campaigns',
    'select'
  ),
  'browser roles cannot read administrator campaigns'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.admin_telegram_campaigns',
    'select,insert,update'
  )
  and not has_table_privilege(
    'service_role',
    'public.admin_telegram_campaigns',
    'delete'
  ),
  'service role manages campaigns without hard delete access'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_save_telegram_campaign(uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer)',
    'execute'
  ),
  'browser roles cannot call campaign mutation RPCs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.admin_save_telegram_campaign(uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_due_admin_telegram_campaign(uuid,text,uuid,text,text)',
    'execute'
  ),
  'service role can use campaign mutation and atomic claim RPCs'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_telegram_campaigns'
      and column_name ~* '(token|secret|chat_id|channel_id)'
  ),
  1,
  'only the opaque attempt token is stored; provider secrets and destinations are absent'
);

insert into public.user_profiles (id)
values
  ('97000000-0000-4000-8000-000000000001'),
  ('97000000-0000-4000-8000-000000000002'),
  ('97000000-0000-4000-8000-000000000003');

insert into public.admin_role_assignments (user_id, role, active)
values
  ('97000000-0000-4000-8000-000000000001', 'super_admin', true),
  ('97000000-0000-4000-8000-000000000002', 'operations', true),
  ('97000000-0000-4000-8000-000000000003', 'support', true);

create temporary table test_admin_telegram_ids (
  label text primary key,
  campaign_id uuid not null,
  attempt_token uuid,
  audit_id uuid
);

insert into test_admin_telegram_ids (label, campaign_id)
values (
  'cancel',
  public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    null,
    'company_event',
    'Verified filing update',
    'A filing was published by the issuer.',
    'BBLG',
    'SEC EDGAR',
    'https://www.sec.gov/example',
    'http://127.0.0.1:3110/analysis/example',
    'http://127.0.0.1:3110/live/BBLG',
    'Create a verified channel draft.',
    'db-test-create',
    null
  )
);

select is(
  (
    select status
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'cancel')
  ),
  'draft',
  'new campaigns begin as drafts'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'telegram_campaign.created'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_ids
        where label = 'cancel'
      )
  ),
  1,
  'draft creation appends an administrator audit record'
);

select lives_ok(
  $$ select public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_ids where label = 'cancel'),
    'company_event',
    'Verified filing update edited',
    'A filing was published by the issuer.',
    'BBLG',
    'SEC EDGAR',
    'https://www.sec.gov/example',
    'http://127.0.0.1:3110/analysis/example',
    'http://127.0.0.1:3110/live/BBLG',
    'Correct the draft title before scheduling.',
    'db-test-edit',
    1
  ) $$,
  'draft content can be edited with optimistic version checking'
);

select is(
  (
    select title || ':' || version::text
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'cancel')
  ),
  'Verified filing update edited:2',
  'editing updates the content and version atomically'
);

select ok(
  public.admin_schedule_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_ids where label = 'cancel'),
    pg_catalog.now() + interval '10 minutes',
    'Schedule the reviewed channel notice.',
    'db-test-schedule',
    2
  ),
  'a reviewed draft can be scheduled'
);

select is(
  (
    select status
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'cancel')
  ),
  'scheduled',
  'scheduling changes campaign state'
);

select ok(
  public.admin_cancel_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_ids where label = 'cancel'),
    'Cancel before the public send window.',
    'db-test-cancel',
    3
  ),
  'an unsent scheduled campaign can be canceled'
);

select is(
  (
    select status
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'cancel')
  ),
  'canceled',
  'canceled campaigns remain recorded without deletion'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'telegram_campaign.canceled'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_ids
        where label = 'cancel'
      )
  ),
  1,
  'campaign cancellation is audited'
);

insert into test_admin_telegram_ids (label, campaign_id, attempt_token)
values (
  'send',
  public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000002',
    null,
    'special_issue',
    'Special market notice',
    'Verified operational context only.',
    null,
    null,
    null,
    null,
    null,
    'Create a send-now verification draft.',
    'db-test-send-create',
    null
  ),
  '97000000-0000-4000-8000-000000000101'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97000000-0000-4000-8000-000000000002',
      (select campaign_id from test_admin_telegram_ids where label = 'send'),
      (select attempt_token from test_admin_telegram_ids where label = 'send'),
      'Send the reviewed campaign now.',
      'db-test-send-claim',
      1
    )
  ),
  1,
  'send-now atomically claims one draft'
);

select throws_ok(
  $$ select * from public.admin_claim_telegram_campaign(
    '97000000-0000-4000-8000-000000000002',
    (select campaign_id from test_admin_telegram_ids where label = 'send'),
    '97000000-0000-4000-8000-000000000102',
    'Attempt a duplicate send claim.',
    'db-test-send-duplicate',
    2
  ) $$,
  'P0001',
  'ADMIN_TELEGRAM_CAMPAIGN_NOT_SENDABLE',
  'a campaign already being sent cannot be claimed again'
);

select ok(
  public.finish_admin_telegram_campaign(
    (select campaign_id from test_admin_telegram_ids where label = 'send'),
    (select attempt_token from test_admin_telegram_ids where label = 'send'),
    'sent',
    '123456789',
    null
  ),
  'a confirmed provider success completes the claimed campaign'
);

select is(
  (
    select status || ':' || delivery_outcome || ':' || provider_message_id
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'send')
  ),
  'sent:sent:123456789',
  'provider confirmation and message id are retained for operations review'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'telegram_campaign.sent'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_ids
        where label = 'send'
      )
  ),
  1,
  'confirmed send completion is audited'
);

insert into test_admin_telegram_ids (label, campaign_id, attempt_token)
values (
  'retry',
  public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000002',
    null,
    'general',
    'Retry policy verification',
    null,
    null,
    null,
    null,
    null,
    null,
    'Create a deterministic failure test.',
    'db-test-retry-create',
    null
  ),
  '97000000-0000-4000-8000-000000000201'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97000000-0000-4000-8000-000000000002',
      (select campaign_id from test_admin_telegram_ids where label = 'retry'),
      (select attempt_token from test_admin_telegram_ids where label = 'retry'),
      'Run deterministic failure verification.',
      'db-test-retry-claim',
      1
    )
  ),
  1,
  'a failure-policy campaign is claimed once'
);

select ok(
  public.finish_admin_telegram_campaign(
    (select campaign_id from test_admin_telegram_ids where label = 'retry'),
    (select attempt_token from test_admin_telegram_ids where label = 'retry'),
    'not_sent',
    null,
    'Telegram rejected the request before delivery.'
  ),
  'a confirmed not-sent result is recorded'
);

select ok(
  (
    select status = 'failed'
      and delivery_outcome = 'not_sent'
      and retry_allowed
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'retry')
  ),
  'only confirmed not-sent failure permits an explicit retry'
);

update test_admin_telegram_ids
set attempt_token = '97000000-0000-4000-8000-000000000202'
where label = 'retry';

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97000000-0000-4000-8000-000000000002',
      (select campaign_id from test_admin_telegram_ids where label = 'retry'),
      (select attempt_token from test_admin_telegram_ids where label = 'retry'),
      'Retry only after confirmed non-delivery.',
      'db-test-retry-second-claim',
      3
    )
  ),
  1,
  'a confirmed not-sent failure can be explicitly reclaimed'
);

select ok(
  public.finish_admin_telegram_campaign(
    (select campaign_id from test_admin_telegram_ids where label = 'retry'),
    (select attempt_token from test_admin_telegram_ids where label = 'retry'),
    'uncertain',
    null,
    'Provider response was not safely confirmed.'
  ),
  'an uncertain provider result is recorded without guessing'
);

select ok(
  (
    select status = 'failed'
      and delivery_outcome = 'uncertain'
      and not retry_allowed
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'retry')
  ),
  'uncertain outcomes permanently block arbitrary retransmission'
);

insert into test_admin_telegram_ids (label, campaign_id, attempt_token)
values (
  'due',
  public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    null,
    'macro_policy',
    'Policy decision reminder',
    'The scheduled release time was supplied by the source.',
    null,
    'Federal Reserve',
    'https://www.federalreserve.gov/example',
    null,
    null,
    'Create a due-campaign mock test.',
    'db-test-due-create',
    null
  ),
  '97000000-0000-4000-8000-000000000301'
);

select ok(
  public.admin_schedule_telegram_campaign(
    '97000000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_ids where label = 'due'),
    pg_catalog.now() + interval '10 minutes',
    'Schedule the policy reminder.',
    'db-test-due-schedule',
    1
  ),
  'the local due-run test begins with a valid future schedule'
);

update public.admin_telegram_campaigns
set scheduled_for = pg_catalog.now() - interval '1 minute'
where id = (select campaign_id from test_admin_telegram_ids where label = 'due');

select is(
  (
    select count(*)::integer
    from public.claim_due_admin_telegram_campaign(
      (select attempt_token from test_admin_telegram_ids where label = 'due'),
      'local_mock',
      '97000000-0000-4000-8000-000000000002',
      'Verify one due campaign with a local mock.',
      'db-test-due-claim'
    )
  ),
  1,
  'the due runner atomically claims exactly one scheduled campaign'
);

select is(
  (
    select count(*)::integer
    from public.claim_due_admin_telegram_campaign(
      '97000000-0000-4000-8000-000000000302',
      'local_mock',
      '97000000-0000-4000-8000-000000000002',
      'Attempt a second local due claim.',
      'db-test-due-duplicate'
    )
  ),
  0,
  'a simultaneous or repeated due claim cannot claim the same campaign twice'
);

select ok(
  (
    select sent_by = '97000000-0000-4000-8000-000000000002'
      and attempt_trigger = 'local_mock'
    from public.admin_telegram_campaigns
    where id = (select campaign_id from test_admin_telegram_ids where label = 'due')
  )
  and (
    select count(*) = 1
    from public.admin_audit_logs
    where action = 'telegram_campaign.send_started'
      and actor_user_id = '97000000-0000-4000-8000-000000000002'
      and reason = 'Verify one due campaign with a local mock.'
      and request_id = 'db-test-due-claim'
  ),
  'local mock due runs record the current operator, reason, and request id'
);

select throws_ok(
  $$ select public.admin_save_telegram_campaign(
    '97000000-0000-4000-8000-000000000003',
    null,
    'general',
    'Unauthorized draft',
    null,
    null,
    null,
    null,
    null,
    null,
    'Support cannot publish channel notices.',
    'db-test-unauthorized',
    null
  ) $$,
  'P0001',
  'ADMIN_PERMISSION_REQUIRED',
  'roles without Telegram operations permission cannot create campaigns'
);

update test_admin_telegram_ids
set audit_id = public.admin_claim_telegram_ai_draft(
  '97000000-0000-4000-8000-000000000002',
  'Draft from the supplied verified facts only.',
  'db-test-ai-claim'
)
where label = 'due';

select ok(
  (
    select audit_id is not null
    from test_admin_telegram_ids
    where label = 'due'
  ),
  'an authorized administrator can claim a rate-limited AI draft request'
);

select ok(
  public.admin_finish_telegram_ai_draft(
    '97000000-0000-4000-8000-000000000002',
    (select audit_id from test_admin_telegram_ids where label = 'due'),
    'succeeded',
    'test-model',
    'response_test_123',
    null
  ) is not null,
  'AI draft completion updates the append-only audit trail through its RPC'
);

select is(
  (
    select after_data ->> 'model'
    from public.admin_audit_logs
    where action = 'telegram_campaign.ai_draft_succeeded'
      and target_id = (
        select audit_id::text
        from test_admin_telegram_ids
        where label = 'due'
      )
  ),
  'test-model',
  'AI draft success is retained without saving or sending a campaign'
);

select * from finish();
rollback;
