begin;

select plan(20);

select has_table(
  'public',
  'alert_delivery_channel_attempts',
  'channel delivery attempts have a durable audit table'
);

select has_column(
  'public',
  'user_alert_deliveries',
  'read_at',
  'delivery history keeps the in-app read cursor'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'alert_delivery_channel_attempts'
  ),
  'channel attempt rows are protected by RLS'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_alert_deliveries'
      and policyname = 'user_alert_deliveries_select_own'
      and roles = array['authenticated']::name[]
  ),
  'users can select only their delivery rows'
);

select ok(
  (
    select qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_alert_deliveries'
      and policyname = 'user_alert_deliveries_update_read_own'
  ),
  'delivery read updates apply ownership to USING and WITH CHECK'
);

select has_function(
  'public',
  'claim_alert_delivery_channel_attempt',
  array['uuid', 'uuid', 'text', 'uuid'],
  'channel attempt claim function exists'
);

select has_function(
  'public',
  'finish_alert_delivery_channel_attempt',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text'],
  'channel attempt completion function exists'
);

select ok(
  (
    select not procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'claim_alert_delivery_channel_attempt'
  ),
  'attempt claim is SECURITY INVOKER'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_alert_delivery_channel_attempt(uuid,uuid,text,uuid)',
    'execute'
  ),
  'anon cannot claim channel attempts'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.user_alert_deliveries',
    'select'
  ),
  'authenticated users can select ownership-filtered deliveries'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.user_alert_deliveries',
    'read_at',
    'update'
  ),
  'authenticated users may update the read cursor'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.user_alert_deliveries',
    'title',
    'update'
  ),
  'authenticated users cannot update delivery payload fields'
);

insert into public.user_profiles (id, email)
values (
  '00000000-0000-4000-8000-000000000181',
  'alerts-stage2-runtime@example.test'
);

insert into public.user_alert_deliveries (
  id,
  user_id,
  title,
  source_type,
  source_label,
  alert_lane,
  severity,
  delivered_channels,
  delivery_status,
  scheduled_for,
  dedupe_key
)
values (
  '00000000-0000-4000-8000-000000000182',
  '00000000-0000-4000-8000-000000000181',
  'Alerts stage 2 runtime test',
  'other',
  'pgTAP',
  'watchlist',
  'low',
  array['web']::text[],
  'queued',
  now(),
  'alerts-stage2-runtime-test'
);

select is(
  (
    select acquired
    from public.claim_alert_delivery_channel_attempt(
      '00000000-0000-4000-8000-000000000182',
      '00000000-0000-4000-8000-000000000181',
      'web',
      '00000000-0000-4000-8000-000000000183'
    )
  ),
  true,
  'the first worker atomically claims the Web attempt'
);

select is(
  (
    select acquired
    from public.claim_alert_delivery_channel_attempt(
      '00000000-0000-4000-8000-000000000182',
      '00000000-0000-4000-8000-000000000181',
      'web',
      '00000000-0000-4000-8000-000000000184'
    )
  ),
  false,
  'a concurrent worker cannot claim the same Web attempt'
);

select is(
  public.finish_alert_delivery_channel_attempt(
    '00000000-0000-4000-8000-000000000182',
    'web',
    '00000000-0000-4000-8000-000000000183',
    'sent'
  ),
  true,
  'the owning worker finalizes the channel attempt'
);

select is(
  (
    select acquired
    from public.claim_alert_delivery_channel_attempt(
      '00000000-0000-4000-8000-000000000182',
      '00000000-0000-4000-8000-000000000181',
      'web',
      '00000000-0000-4000-8000-000000000185'
    )
  ),
  false,
  'a completed channel attempt is never reclaimed'
);

select is(
  (
    select status
    from public.alert_delivery_channel_attempts
    where delivery_id = '00000000-0000-4000-8000-000000000182'
      and channel = 'web'
  ),
  'sent',
  'the final sent outcome is durable'
);

select is(
  (
    select attempt_count
    from public.alert_delivery_channel_attempts
    where delivery_id = '00000000-0000-4000-8000-000000000182'
      and channel = 'web'
  ),
  1,
  'duplicate claims do not increment the provider attempt count'
);

select is(
  (
    select count(*)
    from public.alert_delivery_channel_attempts
    where delivery_id = '00000000-0000-4000-8000-000000000182'
      and channel = 'web'
  ),
  1::bigint,
  'one delivery/channel has exactly one idempotency row'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'alert_delivery_channel_attempts'
      and policyname = 'alert_delivery_channel_attempts_select_own'
      and qual like '%auth.uid()%'
  ),
  'attempt audit rows use auth.uid ownership filtering'
);

select * from finish();

rollback;
