begin;

select plan(30);

select has_table('public', 'listing_monitors', 'Listing Monitor persistence table exists');
select col_is_pk('public', 'listing_monitors', 'id', 'Listing Monitor has a UUID primary key');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.listing_monitors'::regclass),
  'Listing Monitor has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.listing_monitors', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.listing_monitors', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.listing_monitors', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.listing_monitors', 'delete'),
  'anon has no Listing Monitor privileges'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.listing_monitors', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.listing_monitors', 'insert')
  and pg_catalog.has_table_privilege('authenticated', 'public.listing_monitors', 'update')
  and pg_catalog.has_table_privilege('authenticated', 'public.listing_monitors', 'delete'),
  'authenticated receives only CRUD access governed by RLS'
);
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.listing_monitors', 'select')
  and pg_catalog.has_table_privilege('service_role', 'public.listing_monitors', 'insert')
  and pg_catalog.has_table_privilege('service_role', 'public.listing_monitors', 'update')
  and pg_catalog.has_table_privilege('service_role', 'public.listing_monitors', 'delete'),
  'service repository has the required CRUD privileges'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.listing_monitors'::regclass
      and conname = 'listing_monitors_domain_check'
      and contype = 'c'
  ),
  'domain is locked to Listing'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.listing_monitors'::regclass
      and conname = 'listing_monitors_conditions_array_check'
      and contype = 'c'
  ),
  'conditions must be a non-empty JSON array'
);
select has_index('public', 'listing_monitors', 'listing_monitors_user_created_idx', 'owner list reads are indexed');
select has_index('public', 'listing_monitors', 'listing_monitors_active_user_created_idx', 'active owner reads use a partial index');
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'listing_monitors'),
  4,
  'Listing Monitor defines separate select, insert, update, and delete policies'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'listing_monitors'
      and cmd = 'UPDATE'
      and qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'
  ),
  'UPDATE ownership policy has both USING and WITH CHECK'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'listing-monitor-a@example.test', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'listing-monitor-b@example.test', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  );

insert into public.listing_monitors (id, user_id, conditions)
values
  (
    '94100000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"},{"key":"listing.event_outcome","operator":"eq","value":"adverse"},{"key":"listing.compliance_deadline","operator":"within_days","value":30}]'::jsonb
  ),
  (
    '94100000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000002',
    '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"}]'::jsonb
  );

select is(
  (select conditions from public.listing_monitors where id = '94100000-0000-4000-8000-000000000001'),
  '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"},{"key":"listing.event_outcome","operator":"eq","value":"adverse"},{"key":"listing.compliance_deadline","operator":"within_days","value":30}]'::jsonb,
  'ATPC canonical condition JSON is stored exactly'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is((select count(*) from public.listing_monitors), 1::bigint, 'owner reads only their Listing monitors');
select is(
  (select conditions from public.listing_monitors where id = '94100000-0000-4000-8000-000000000001'),
  '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"},{"key":"listing.event_outcome","operator":"eq","value":"adverse"},{"key":"listing.compliance_deadline","operator":"within_days","value":30}]'::jsonb,
  'owner receives exact canonical JSON round trip'
);
select is((select count(*) from public.listing_monitors where is_active), 1::bigint, 'active query includes the ATPC monitor');
select lives_ok(
  $$ update public.listing_monitors set is_active = false, updated_at = pg_catalog.now()
     where id = '94100000-0000-4000-8000-000000000001' $$,
  'owner can pause their Listing monitor'
);
select is((select count(*) from public.listing_monitors where is_active), 0::bigint, 'pause excludes the monitor from active reads');
select lives_ok(
  $$ update public.listing_monitors set is_active = true, updated_at = pg_catalog.now()
     where id = '94100000-0000-4000-8000-000000000001' $$,
  'owner can resume their Listing monitor'
);
select is((select count(*) from public.listing_monitors where is_active), 1::bigint, 'resume includes the monitor in active reads');
select is(
  (select count(*) from public.listing_monitors where id = '94100000-0000-4000-8000-000000000002'),
  0::bigint,
  'owner cannot read another user monitor'
);
select lives_ok(
  $$ update public.listing_monitors set is_active = false
     where id = '94100000-0000-4000-8000-000000000002' $$,
  'foreign update safely affects no visible row'
);
select lives_ok(
  $$ delete from public.listing_monitors where id = '94100000-0000-4000-8000-000000000002' $$,
  'foreign delete safely affects no visible row'
);
select throws_ok(
  $$ insert into public.listing_monitors (user_id, conditions)
     values ('94000000-0000-4000-8000-000000000002', '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"}]'::jsonb) $$,
  '42501',
  null,
  'owner cannot create a monitor for another user'
);
select throws_ok(
  $$ insert into public.listing_monitors (user_id, domain, conditions)
     values ('94000000-0000-4000-8000-000000000001', 'offering', '[{"key":"listing.event_kind","operator":"eq","value":"deficiency_notice"}]'::jsonb) $$,
  '23514',
  null,
  'domain identity rejects non-Listing rows'
);
select throws_ok(
  $$ insert into public.listing_monitors (user_id, conditions)
     values ('94000000-0000-4000-8000-000000000001', '[]'::jsonb) $$,
  '23514',
  null,
  'database rejects an empty condition set'
);
select lives_ok(
  $$ delete from public.listing_monitors where id = '94100000-0000-4000-8000-000000000001' $$,
  'owner can hard-delete their Listing monitor'
);

reset role;

select is(
  (select is_active from public.listing_monitors where id = '94100000-0000-4000-8000-000000000002'),
  true,
  'foreign update did not change the other owner monitor'
);
select is(
  (select count(*) from public.listing_monitors where id = '94100000-0000-4000-8000-000000000002'),
  1::bigint,
  'foreign delete did not remove the other owner monitor'
);
select is(
  (select count(*) from public.listing_monitors where id = '94100000-0000-4000-8000-000000000001'),
  0::bigint,
  'hard delete removes the owner monitor row'
);

select * from finish();
rollback;
