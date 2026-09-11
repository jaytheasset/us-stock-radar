begin;

select plan(18);

select has_table('public', 'sc13_monitors', 'Schedule 13 monitor definitions are persisted');
select has_column('public', 'sc13_monitors', 'issuer_cik', 'monitor stores exact issuer identity');
select has_column('public', 'sc13_monitors', 'reporting_person_cik', 'monitor stores exact reporter identity');
select has_column('public', 'sc13_monitors', 'security_class', 'monitor stores exact normalized security class');
select has_column('public', 'sc13_monitors', 'cusips', 'monitor stores exact normalized CUSIP set');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.sc13_monitors'::regclass), 'monitor table has RLS');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.sc13_monitors', 'select,insert,update,delete'), 'authenticated users can manage monitor rows through owner RLS');
select ok(not pg_catalog.has_table_privilege('anon', 'public.sc13_monitors', 'select'), 'anonymous users have no monitor table access');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='public' and tablename='sc13_monitors' and policyname in ('sc13_monitors_select_own','sc13_monitors_insert_own','sc13_monitors_update_own','sc13_monitors_delete_own')), 4, 'all monitor mutations and reads have owner policies');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid='public.sc13_monitors'::regclass and conname='sc13_monitors_conditions_array_check'), 'condition array is database bounded');
select ok(exists (select 1 from pg_catalog.pg_attribute where attrelid='public.user_alert_deliveries'::regclass and attname='sc13_match_evidence' and not attisdropped), 'Alert row stores first-match provenance');
select is((select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conrelid='public.user_alert_deliveries'::regclass and conname='user_alert_deliveries_sc13_monitor_position_reporter_key'), 'UNIQUE (sc13_monitor_id, sc13_root_accession, sc13_position_key, sc13_reporter_cik)', 'monitor/root/position/reporter is the atomic amendment-proof dedupe key');
select ok((select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conname='user_alert_deliveries_alert_lane_check') like '%sc13_monitor%', 'SC13 internal lane is registered');
select ok((select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conname='user_alert_deliveries_alert_domain_check') like '%sc13%', 'SC13 Alert domain is registered');
select ok((select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conname='user_alert_deliveries_sc13_alert_shape_check') like '%alert_event_id IS NULL%', 'SC13 Alert is independent of site event creation');
select ok((select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conname='user_alert_deliveries_sc13_alert_shape_check') like '%scheduled_for IS NULL%' and (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint where conname='user_alert_deliveries_sc13_alert_shape_check') like '%delivered_channels = ARRAY[]%', 'SC13 internal Alerts cannot enter external delivery workers');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.user_alert_deliveries', 'select') and not pg_catalog.has_table_privilege('authenticated', 'public.user_alert_deliveries', 'insert'), 'owners can read Alerts but cannot forge SC13 provenance');
select ok(exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='user_alert_deliveries' and policyname='user_alert_deliveries_select_own' and qual like '%auth.uid()%'), 'existing Alert owner isolation remains authoritative');

select * from finish();
rollback;
