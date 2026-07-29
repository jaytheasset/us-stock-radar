begin;

select plan(26);

select has_table('public', 'brokerage_connections', 'brokerage connections table exists');
select has_table('public', 'brokerage_proofs', 'brokerage proofs table exists');
select has_table('public', 'brokerage_proof_status', 'proof status table exists');
select has_table('public', 'live_room_message_brokerage_proofs', 'message proof join exists');
select has_table('public', 'live_room_post_brokerage_proofs', 'post proof join exists');
select has_table('public', 'brokerage_webhook_events', 'webhook idempotency table exists');

select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class where oid in (
    'public.brokerage_connections'::regclass,
    'public.brokerage_proofs'::regclass,
    'public.brokerage_proof_status'::regclass,
    'public.live_room_message_brokerage_proofs'::regclass,
    'public.live_room_post_brokerage_proofs'::regclass,
    'public.brokerage_webhook_events'::regclass
  )),
  'all brokerage tables have RLS enabled'
);

select ok(not has_table_privilege('anon', 'public.brokerage_connections', 'select'), 'anon cannot read secrets');
select ok(not has_table_privilege('authenticated', 'public.brokerage_connections', 'select'), 'authenticated cannot read secrets');
select ok(not has_table_privilege('anon', 'public.brokerage_proofs', 'select'), 'anon cannot query proof rows directly');
select ok(not has_table_privilege('authenticated', 'public.brokerage_proofs', 'select'), 'authenticated cannot query proof rows directly');
select ok(has_table_privilege('service_role', 'public.brokerage_connections', 'select,insert,update,delete'), 'service role manages connections');
select ok(has_table_privilege('service_role', 'public.brokerage_proofs', 'select,insert,delete'), 'service role manages immutable proofs');
select ok(not has_function_privilege('anon', 'public.create_brokerage_proof(uuid,text,text,text,text,text,timestamptz,date,numeric,numeric,numeric,numeric,text,boolean,boolean,boolean,boolean,boolean,text,boolean)', 'execute'), 'anon cannot create proof');
select ok(not has_function_privilege('authenticated', 'public.create_brokerage_proof(uuid,text,text,text,text,text,timestamptz,date,numeric,numeric,numeric,numeric,text,boolean,boolean,boolean,boolean,boolean,text,boolean)', 'execute'), 'authenticated cannot create proof');
select ok(has_function_privilege('service_role', 'public.create_brokerage_proof(uuid,text,text,text,text,text,timestamptz,date,numeric,numeric,numeric,numeric,text,boolean,boolean,boolean,boolean,boolean,text,boolean)', 'execute'), 'service role can create proof');
select ok(not has_function_privilege('authenticated', 'public.insert_live_room_message_with_proof(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,uuid,boolean)', 'execute'), 'browser cannot call message proof wrapper');
select ok(not has_function_privilege('authenticated', 'public.create_live_room_post_with_proof(uuid,uuid,text,text,text[],uuid,public.live_room_post_signal[],uuid,boolean)', 'execute'), 'browser cannot call post proof wrapper');

insert into public.user_profiles (id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003');
insert into public.user_plan_subscriptions (user_id, plan, status)
values
  ('91000000-0000-4000-8000-000000000001', 'pro', 'active'),
  ('91000000-0000-4000-8000-000000000002', 'free', 'active'),
  ('91000000-0000-4000-8000-000000000003', 'pro', 'active');
insert into public.brokerage_connections (
  user_id, provider_user_id, status, terms_version, terms_accepted_at, has_live_account
) values (
  '91000000-0000-4000-8000-000000000001',
  'stockradar_91000000000040008000000000000001',
  'connected',
  'snaptrade-end-user-terms-v1',
  now(),
  true
);

select throws_ok(
  $$ select public.create_brokerage_proof(
    '91000000-0000-4000-8000-000000000001', 'position', 'NVDA', 'LONG',
    'live', 'current', now(), null, 12, 118.4, null, null, null,
    false, false, false, false, false, 'disabled-proof', false
  ) $$,
  'P0001',
  'BROKERAGE_PUBLIC_SHARING_DISABLED',
  'public sharing flag is enforced in DB'
);

select throws_ok(
  $$ select public.create_brokerage_proof(
    '91000000-0000-4000-8000-000000000002', 'position', 'NVDA', 'LONG',
    'live', 'current', now(), null, 12, 118.4, null, null, null,
    false, false, false, false, false, 'free-proof', true
  ) $$,
  'P0001',
  'BROKERAGE_PLAN_REQUIRED',
  'free plan cannot bypass proof creation'
);

select lives_ok(
  $$ select public.create_brokerage_proof(
    '91000000-0000-4000-8000-000000000001', 'position', 'NVDA', 'LONG',
    'live', 'current', now(), null, 12, 118.4, null, null, null,
    false, false, false, false, false, 'pro-proof', true
  ) $$,
  'eligible connected Pro member can create a proof'
);

select is(
  (select count(*)::integer from public.brokerage_proofs where owner_user_id = '91000000-0000-4000-8000-000000000001'),
  1,
  'only one sanitized proof snapshot is stored'
);

select throws_ok(
  $$ update public.brokerage_proofs set ticker = 'AMD'
     where owner_user_id = '91000000-0000-4000-8000-000000000001' $$,
  'P0001',
  'BROKERAGE_PROOF_IMMUTABLE',
  'proof snapshots are immutable'
);

select throws_ok(
  $$ select private.assert_brokerage_proof_attachable(
    '91000000-0000-4000-8000-000000000003',
    (select id from public.brokerage_proofs where owner_user_id = '91000000-0000-4000-8000-000000000001'),
    true
  ) $$,
  'P0001',
  'BROKERAGE_PROOF_NOT_ATTACHABLE',
  'another eligible user cannot attach the proof'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.brokerage_proofs'::regclass
      and tgname = 'brokerage_proofs_immutable'
      and not tgisinternal
  ),
  'immutability trigger is installed'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'brokerage_proofs_owner_created_idx'
  ),
  'owner proof listing has a covering order index'
);

select * from finish();
rollback;
