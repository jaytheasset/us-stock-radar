begin;

select plan(20);

select has_column('public', 'user_alert_deliveries', 'listing_monitor_id', 'Alert record references its Listing monitor');
select has_column('public', 'user_alert_deliveries', 'alert_domain', 'Alert record stores its monitor domain');
select has_column('public', 'user_alert_deliveries', 'listing_source_execution_id', 'Alert record references the exact current Listing execution');
select col_type_is('public', 'user_alert_deliveries', 'listing_monitor_id', 'uuid', 'Listing monitor identity is a UUID');
select col_type_is('public', 'user_alert_deliveries', 'alert_domain', 'text', 'Alert domain is text');
select col_type_is('public', 'user_alert_deliveries', 'listing_source_execution_id', 'uuid', 'Listing source execution identity is a UUID');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_alert_deliveries'::regclass
      and conname = 'user_alert_deliveries_listing_monitor_event_source_key'
      and contype = 'u'
  ),
  'monitor plus canonical event/source identity has a database unique constraint'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_alert_deliveries'::regclass
      and conname = 'user_alert_deliveries_listing_monitor_id_fkey'
      and contype = 'f'
  ),
  'Listing Alert monitor reference has a foreign key'
);
select ok(
  (select pg_catalog.pg_get_constraintdef(oid)
   from pg_catalog.pg_constraint
   where conname = 'user_alert_deliveries_alert_lane_check') like '%listing_monitor%',
  'existing Alert lanes include Listing Monitor internal records'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_alert_deliveries'::regclass
      and conname = 'user_alert_deliveries_listing_alert_shape_check'
      and contype = 'c'
  ),
  'Listing Alert rows are locked to no channels and no due delivery schedule'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.user_alert_deliveries'::regclass),
  'reused Alert records remain protected by RLS'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.user_alert_deliveries', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.user_alert_deliveries', 'insert'),
  'authenticated users can read owned Alerts but cannot forge them'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_alert_deliveries'
      and policyname = 'user_alert_deliveries_select_own'
      and qual like '%auth.uid()%'
  ),
  'existing Alert ownership policy remains authoritative'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_alert_deliveries'::regclass
      and conname = 'user_alert_deliveries_alert_event_id_fkey'
      and confrelid = 'public.events'::regclass
      and contype = 'f'
  ),
  'alert_event_id is the canonical public.events identity'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('95000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listing-alert-a@example.test', '', now(), now(), now()),
  ('95000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'listing-alert-b@example.test', '', now(), now(), now());

insert into public.user_profiles (id, email) values
  ('95000000-0000-4000-8000-000000000001', 'listing-alert-a@example.test'),
  ('95000000-0000-4000-8000-000000000002', 'listing-alert-b@example.test')
on conflict (id) do nothing;

insert into public.events (
  id, source_code, source_group, event_type, score, delivery_level,
  impact, signal, market_scope, title, group_dedupe_key
) values (
  '95000000-0000-4000-8000-000000000010', 'sec_edgar', 'filings',
  'listing_risk', 80, 'feed', 'high', 'bearish', 'company',
  'Listing Alert pgTAP event', 'listing-alert-e2e-pgtap-event'
);

insert into public.listing_monitors (id, user_id, conditions) values
  ('95000000-0000-4000-8000-000000000011', '95000000-0000-4000-8000-000000000001', '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"}]'::jsonb),
  ('95000000-0000-4000-8000-000000000012', '95000000-0000-4000-8000-000000000002', '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"}]'::jsonb);

insert into public.user_alert_deliveries (
  id, user_id, alert_event_id, title, category, source_type, source_label,
  alert_lane, delivered_channels, delivery_status, delivered_at,
  listing_monitor_id, alert_domain, listing_source_execution_id
) values (
  '95000000-0000-4000-8000-000000000020',
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000010',
  'Listing monitor matched', 'listing_risk', 'other', 'Listing Monitor',
  'listing_monitor', array[]::text[], 'queued', now(),
  '95000000-0000-4000-8000-000000000011', 'listing',
  '95000000-0000-4000-8000-000000000021'
);

select is(
  (select count(*) from public.user_alert_deliveries where listing_monitor_id = '95000000-0000-4000-8000-000000000011'),
  1::bigint,
  'first MATCH creates one internal Alert'
);

insert into public.user_alert_deliveries (
  user_id, alert_event_id, title, category, source_type, source_label,
  alert_lane, delivered_channels, delivery_status, delivered_at,
  listing_monitor_id, alert_domain, listing_source_execution_id
) values (
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000010',
  'Listing monitor matched', 'listing_risk', 'other', 'Listing Monitor',
  'listing_monitor', array[]::text[], 'queued', now(),
  '95000000-0000-4000-8000-000000000011', 'listing',
  '95000000-0000-4000-8000-000000000021'
) on conflict (listing_monitor_id, alert_event_id, listing_source_execution_id) do nothing;

select is(
  (select count(*) from public.user_alert_deliveries where listing_monitor_id = '95000000-0000-4000-8000-000000000011'),
  1::bigint,
  'replay is atomically deduped to one Alert'
);
select is(
  (select count(*)
   from public.user_alert_deliveries
   where listing_monitor_id is not null
     and delivery_status = 'queued'
     and scheduled_for <= pg_catalog.now()),
  0::bigint,
  'existing due-delivery worker predicate cannot claim Listing internal Alerts'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.user_alert_deliveries), 1::bigint, 'owner can read their Listing Alert');
select is(
  (select count(*) from public.user_alert_deliveries where user_id = '95000000-0000-4000-8000-000000000002'),
  0::bigint,
  'owner cannot read a foreign owner Alert'
);
reset role;

select throws_ok(
  $$ insert into public.user_alert_deliveries (
       user_id, alert_event_id, title, category, source_type, source_label,
       alert_lane, delivered_channels, delivery_status, delivered_at,
       listing_monitor_id, alert_domain, listing_source_execution_id, scheduled_for
     ) values (
       '95000000-0000-4000-8000-000000000001',
       '95000000-0000-4000-8000-000000000010',
       'unsafe delivery', 'listing_risk', 'other', 'Listing Monitor',
       'listing_monitor', array['web']::text[], 'queued', now(),
       '95000000-0000-4000-8000-000000000011', 'listing',
       '95000000-0000-4000-8000-000000000022', now()
     ) $$,
  '23514',
  null,
  'Listing internal Alerts cannot request a channel or due delivery schedule'
);

select * from finish();
rollback;
