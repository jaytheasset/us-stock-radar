begin;

select plan(26);

select has_column(
  'public',
  'admin_telegram_campaigns',
  'lease_expires_at',
  'Telegram delivery claims have an explicit lease deadline'
);

select is(
  extract(
    epoch from private.admin_telegram_delivery_lease_interval()
  )::integer,
  600,
  'the DB-authoritative delivery lease is ten minutes'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.expire_admin_telegram_campaign_leases(integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.expire_admin_telegram_campaign_leases(integer)',
    'execute'
  ),
  'browser roles cannot expire delivery leases'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.expire_admin_telegram_campaign_leases(integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.admin_reconcile_telegram_campaign(uuid,uuid,text,text,integer,text)',
    'execute'
  ),
  'only the server service path can expire or reconcile campaign delivery'
);

insert into public.user_profiles (id)
values
  ('97100000-0000-4000-8000-000000000001'),
  ('97100000-0000-4000-8000-000000000002');

insert into public.admin_role_assignments (user_id, role, active)
values
  ('97100000-0000-4000-8000-000000000001', 'operations', true),
  ('97100000-0000-4000-8000-000000000002', 'support', true);

create temporary table test_admin_telegram_lease_ids (
  label text primary key,
  campaign_id uuid not null,
  attempt_token uuid not null
);

insert into test_admin_telegram_lease_ids (label, campaign_id, attempt_token)
values (
  'expire',
  public.admin_save_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    null,
    'general',
    'Lease expiration verification',
    null,
    null,
    null,
    null,
    null,
    null,
    'Create a lease expiration test campaign.',
    'lease-test-create-expire',
    null
  ),
  '97100000-0000-4000-8000-000000000101'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'expire'),
      (select attempt_token from test_admin_telegram_lease_ids where label = 'expire'),
      'Claim the campaign for lease verification.',
      'lease-test-claim-expire',
      1
    )
  ),
  1,
  'an administrator can claim the lease test campaign'
);

select is(
  (
    select extract(
      epoch from (lease_expires_at - started_at)
    )::integer
    from public.admin_telegram_campaigns
    where id = (
      select campaign_id from test_admin_telegram_lease_ids where label = 'expire'
    )
  ),
  600,
  'claiming sets the lease deadline from the shared ten-minute policy'
);

select is(
  public.expire_admin_telegram_campaign_leases(50),
  0,
  'a sending campaign inside its lease is not expired'
);

select is(
  (
    select status
    from public.admin_telegram_campaigns
    where id = (
      select campaign_id from test_admin_telegram_lease_ids where label = 'expire'
    )
  ),
  'sending',
  'cleanup leaves an active claim unchanged'
);

update public.admin_telegram_campaigns
set lease_expires_at = pg_catalog.now() - interval '1 second'
where id = (
  select campaign_id from test_admin_telegram_lease_ids where label = 'expire'
);

select is(
  public.expire_admin_telegram_campaign_leases(50),
  1,
  'cleanup expires one stale sending campaign without provider work'
);

select ok(
  (
    select status = 'failed'
      and delivery_outcome = 'uncertain'
      and not retry_allowed
      and completed_at is not null
    from public.admin_telegram_campaigns
    where id = (
      select campaign_id from test_admin_telegram_lease_ids where label = 'expire'
    )
  ),
  'an expired claim becomes failed and uncertain with retries blocked'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'telegram_campaign.delivery_lease_expired'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_lease_ids
        where label = 'expire'
      )
  ),
  1,
  'lease expiration appends an audit record'
);

select is(
  public.finish_admin_telegram_campaign(
    (select campaign_id from test_admin_telegram_lease_ids where label = 'expire'),
    (select attempt_token from test_admin_telegram_lease_ids where label = 'expire'),
    'sent',
    'late-provider-result',
    null
  ),
  false,
  'a late provider completion cannot overwrite an expired claim'
);

select throws_ok(
  $$ select * from public.admin_claim_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_lease_ids where label = 'expire'),
    '97100000-0000-4000-8000-000000000102',
    'Do not retry an uncertain delivery.',
    'lease-test-block-retry',
    3
  ) $$,
  'P0001',
  'ADMIN_TELEGRAM_CAMPAIGN_NOT_SENDABLE',
  'an uncertain expired campaign cannot be reclaimed automatically or manually'
);

insert into test_admin_telegram_lease_ids (label, campaign_id, attempt_token)
values (
  'delivered',
  public.admin_save_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    null,
    'special_issue',
    'Delivered reconciliation verification',
    null,
    null,
    null,
    null,
    null,
    null,
    'Create the delivered reconciliation test.',
    'lease-test-create-delivered',
    null
  ),
  '97100000-0000-4000-8000-000000000201'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'delivered'),
      (select attempt_token from test_admin_telegram_lease_ids where label = 'delivered'),
      'Claim the delivered reconciliation test.',
      'lease-test-claim-delivered',
      1
    )
  ),
  1,
  'the delivered reconciliation campaign is claimed once'
);

update public.admin_telegram_campaigns
set lease_expires_at = pg_catalog.now() - interval '1 second'
where id = (
  select campaign_id from test_admin_telegram_lease_ids where label = 'delivered'
);

select is(
  (
    select count(*)::integer
    from public.admin_reconcile_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'delivered'),
      'delivered',
      'Verified the message in the public channel.',
      2,
      'lease-test-mark-delivered'
    )
  ),
  1,
  'an operator can mark an expired sending claim as delivered'
);

select ok(
  (
    select status = 'sent'
      and delivery_outcome = 'sent'
      and not retry_allowed
      and sent_at is not null
    from public.admin_telegram_campaigns
    where id = (
      select campaign_id from test_admin_telegram_lease_ids where label = 'delivered'
    )
  ),
  'mark delivered records success without enabling another send'
);

select ok(
  (
    select after_data ->> 'telegram_send_invoked' = 'false'
    from public.admin_audit_logs
    where action = 'telegram_campaign.reconciled_delivered'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_lease_ids
        where label = 'delivered'
      )
  ),
  'delivered reconciliation audit explicitly records that no send occurred'
);

select throws_ok(
  $$ select * from public.admin_reconcile_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_lease_ids where label = 'delivered'),
    'not_delivered',
    'Attempt a stale reconciliation.',
    2,
    'lease-test-stale-reconcile'
  ) $$,
  'P0001',
  'ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT',
  'stale expected versions cannot reconcile a campaign'
);

insert into test_admin_telegram_lease_ids (label, campaign_id, attempt_token)
values (
  'not-delivered',
  public.admin_save_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    null,
    'general',
    'Not-delivered reconciliation verification',
    null,
    null,
    null,
    null,
    null,
    null,
    'Create the non-delivery reconciliation test.',
    'lease-test-create-not-delivered',
    null
  ),
  '97100000-0000-4000-8000-000000000301'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'not-delivered'),
      (select attempt_token from test_admin_telegram_lease_ids where label = 'not-delivered'),
      'Claim the non-delivery reconciliation test.',
      'lease-test-claim-not-delivered',
      1
    )
  ),
  1,
  'the non-delivery reconciliation campaign is claimed once'
);

update public.admin_telegram_campaigns
set lease_expires_at = pg_catalog.now() - interval '1 second'
where id = (
  select campaign_id from test_admin_telegram_lease_ids where label = 'not-delivered'
);

select is(
  public.expire_admin_telegram_campaign_leases(50),
  1,
  'cleanup marks the second stale claim uncertain before reconciliation'
);

select is(
  (
    select count(*)::integer
    from public.admin_reconcile_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'not-delivered'),
      'not_delivered',
      'Verified no message exists in the public channel.',
      3,
      'lease-test-confirm-not-delivered'
    )
  ),
  1,
  'an operator can confirm that an uncertain attempt was not delivered'
);

select ok(
  (
    select status = 'failed'
      and delivery_outcome = 'not_sent'
      and retry_allowed
    from public.admin_telegram_campaigns
    where id = (
      select campaign_id from test_admin_telegram_lease_ids where label = 'not-delivered'
    )
  ),
  'only confirmed non-delivery enables an explicit retry'
);

select is(
  (
    select count(*)::integer
    from public.admin_claim_telegram_campaign(
      '97100000-0000-4000-8000-000000000001',
      (select campaign_id from test_admin_telegram_lease_ids where label = 'not-delivered'),
      '97100000-0000-4000-8000-000000000302',
      'Explicitly retry after verified non-delivery.',
      'lease-test-retry-after-confirmation',
      4
    )
  ),
  1,
  'a verified not-delivered campaign can be explicitly reclaimed once'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where action = 'telegram_campaign.reconciled_not_delivered'
      and target_id = (
        select campaign_id::text
        from test_admin_telegram_lease_ids
        where label = 'not-delivered'
      )
      and after_data ->> 'telegram_send_invoked' = 'false'
  ),
  1,
  'confirmed non-delivery is audited without invoking Telegram'
);

select throws_ok(
  $$ select * from public.admin_reconcile_telegram_campaign(
    '97100000-0000-4000-8000-000000000002',
    (select campaign_id from test_admin_telegram_lease_ids where label = 'expire'),
    'not_delivered',
    'Support must not reconcile delivery.',
    3,
    'lease-test-unauthorized'
  ) $$,
  'P0001',
  'ADMIN_PERMISSION_REQUIRED',
  'roles without telegram.send authority cannot reconcile delivery'
);

select throws_ok(
  $$ select * from public.admin_reconcile_telegram_campaign(
    '97100000-0000-4000-8000-000000000001',
    (select campaign_id from test_admin_telegram_lease_ids where label = 'expire'),
    'not_delivered',
    'Valid operator reason.',
    null,
    'lease-test-no-version'
  ) $$,
  'P0001',
  'ADMIN_TELEGRAM_EXPECTED_VERSION_REQUIRED',
  'delivery reconciliation requires an expected version'
);

select * from finish();
rollback;
