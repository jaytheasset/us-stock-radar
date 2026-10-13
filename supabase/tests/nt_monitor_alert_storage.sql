-- Shape regressions use the real table's current CHECKs/defaults/indexes.
-- No source facts, accounts, or live delivery rows are changed.
begin;
select no_plan();
create temporary table nt_alert_shape (like public.user_alert_deliveries including all);
create function pg_temp.nt_alert(patch jsonb default '{}'::jsonb) returns void
language plpgsql as $$
begin
  truncate pg_temp.nt_alert_shape;
  insert into pg_temp.nt_alert_shape
  select (jsonb_populate_record(null::pg_temp.nt_alert_shape, jsonb_build_object(
    'id', gen_random_uuid(), 'user_id', '95000000-0000-4000-8000-000000000001',
    'alert_event_id', '95000000-0000-4000-8000-000000000010',
    'listing_monitor_id', '95000000-0000-4000-8000-000000000011',
    'listing_source_execution_id', '95000000-0000-4000-8000-000000000021',
    'title', 'SEC late-filing notice filed', 'category', 'financial_risk',
    'source_type', 'other', 'source_label', 'SEC Filing Monitor',
    'alert_domain', 'listing', 'alert_lane', 'listing_monitor',
    'delivery_status', 'queued', 'delivered_channels', '[]'::jsonb,
    'created_at', now(), 'delivered_at', now()
  ) || patch)).*;
end $$;
select lives_ok('select pg_temp.nt_alert(''{}''::jsonb)', 'NT notice is accepted');
select lives_ok('select pg_temp.nt_alert(''{"title":"Delayed periodic report filed"}''::jsonb)', 'NT report is accepted');
select throws_ok('select pg_temp.nt_alert(''{"title":"Some other financial risk"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: title');
select throws_ok('select pg_temp.nt_alert(''{"source_label":"Primary"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: source_label');
select throws_ok('select pg_temp.nt_alert(''{"source_type":"sec"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: source_type');
select throws_ok('select pg_temp.nt_alert(''{"alert_domain":"financial"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: alert_domain');
select throws_ok('select pg_temp.nt_alert(''{"alert_lane":"watchlist"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: alert_lane');
select throws_ok('select pg_temp.nt_alert(''{"delivery_status":"sent"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: delivery_status');
select throws_ok('select pg_temp.nt_alert(''{"delivered_channels":["email"]}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: delivered_channels');
select throws_ok('select pg_temp.nt_alert(''{"scheduled_for":"2026-10-13T00:00:00Z"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: scheduled_for');
select throws_ok('select pg_temp.nt_alert(''{"sent_at":"2026-10-13T00:00:00Z"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sent_at');
select throws_ok('select pg_temp.nt_alert(''{"attempted_at":"2026-10-13T00:00:00Z"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: attempted_at');
select throws_ok('select pg_temp.nt_alert(''{"severity":"high"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: severity');
select throws_ok('select pg_temp.nt_alert(''{"dedupe_key":"primary-key"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: dedupe_key');
select throws_ok('select pg_temp.nt_alert(''{"listing_match_evidence":{}}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: listing_match_evidence');
select throws_ok('select pg_temp.nt_alert(''{"offering_plan_match_evidence":{}}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: offering_plan_match_evidence');
select throws_ok('select pg_temp.nt_alert(''{"effect_match_evidence":{}}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: effect_match_evidence');
select throws_ok('select pg_temp.nt_alert(''{"effect_registration_key":"effect-key"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: effect_registration_key');
select throws_ok('select pg_temp.nt_alert(''{"projected_fact_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: projected_fact_id');
select throws_ok('select pg_temp.nt_alert(''{"projected_monitor_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: projected_monitor_id');
select throws_ok('select pg_temp.nt_alert(''{"projected_alert_key":"projected"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: projected_alert_key');
select throws_ok('select pg_temp.nt_alert(''{"projected_scenario":"base"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: projected_scenario');
select throws_ok('select pg_temp.nt_alert(''{"offering_monitor_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: offering_monitor_id');
select throws_ok('select pg_temp.nt_alert(''{"offering_registry_snapshot_id":1}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: offering_registry_snapshot_id');
select throws_ok('select pg_temp.nt_alert(''{"offering_registry_accession":"0001062993-26-004186"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: offering_registry_accession');
select throws_ok('select pg_temp.nt_alert(''{"financial_monitor_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: financial_monitor_id');
select throws_ok('select pg_temp.nt_alert(''{"financial_source_execution_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: financial_source_execution_id');
select throws_ok('select pg_temp.nt_alert(''{"financial_accession":"0001062993-26-004186"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: financial_accession');
select throws_ok('select pg_temp.nt_alert(''{"financial_issuer_cik":"0001720424"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: financial_issuer_cik');
select throws_ok('select pg_temp.nt_alert(''{"sc13_monitor_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_monitor_id');
select throws_ok('select pg_temp.nt_alert(''{"sc13_match_evidence":{}}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_match_evidence');
select throws_ok('select pg_temp.nt_alert(''{"sc13_position_key":"x"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_position_key');
select throws_ok('select pg_temp.nt_alert(''{"sc13_root_accession":"0001062993-26-004186"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_root_accession');
select throws_ok('select pg_temp.nt_alert(''{"sc13_head_accession":"0001062993-26-004186"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_head_accession');
select throws_ok('select pg_temp.nt_alert(''{"sc13_reporter_cik":"0001720424"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_reporter_cik');
select throws_ok('select pg_temp.nt_alert(''{"sc13_security_class":"common"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_security_class');
select throws_ok('select pg_temp.nt_alert(''{"sc13_cusips":["123456789"]}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: sc13_cusips');
select throws_ok('select pg_temp.nt_alert(''{"ticker_match":{}}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: ticker_match');
select throws_ok('select pg_temp.nt_alert(''{"calendar_event_id":"95000000-0000-4000-8000-000000000099"}''::jsonb)', '23514', null, 'NT rejects foreign or delivery field: calendar_event_id');
select throws_ok('select pg_temp.nt_alert(''{"source_label":null}''::jsonb)', '23514', null, 'NT rejects missing source_label');
select throws_ok('select pg_temp.nt_alert(''{"source_type":null}''::jsonb)', '23514', null, 'NT rejects missing source_type');
select throws_ok('select pg_temp.nt_alert(''{"alert_domain":null}''::jsonb)', '23514', null, 'NT rejects missing alert_domain');
select throws_ok('select pg_temp.nt_alert(''{"listing_source_execution_id":null}''::jsonb)', '23514', null, 'NT rejects missing listing_source_execution_id');
select throws_ok('select pg_temp.nt_alert(''{"alert_event_id":null}''::jsonb)', '23514', null, 'NT rejects missing alert_event_id');
select lives_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Listing monitor matched","source_label":"Listing Monitor"}''::jsonb)', 'Listing Monitor existing branch remains accepted');
select throws_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Listing monitor matched","source_label":"Listing Monitor","delivered_channels":["email"]}''::jsonb)', '23514', null, 'Listing Monitor remains internal only');
select lives_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Proxy filing monitor matched","source_label":"Proxy Monitor"}''::jsonb)', 'Proxy Monitor existing branch remains accepted');
select throws_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Proxy filing monitor matched","source_label":"Proxy Monitor","delivered_channels":["email"]}''::jsonb)', '23514', null, 'Proxy Monitor remains internal only');
select lives_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Tender filing monitor matched","source_label":"Tender Monitor"}''::jsonb)', 'Tender Monitor existing branch remains accepted');
select throws_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"Tender filing monitor matched","source_label":"Tender Monitor","delivered_channels":["email"]}''::jsonb)', '23514', null, 'Tender Monitor remains internal only');
select lives_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"SEC registration filing filed","source_label":"SEC Filing Monitor"}''::jsonb)', 'SEC Filing Monitor existing branch remains accepted');
select throws_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"SEC registration filing filed","source_label":"SEC Filing Monitor","delivered_channels":["email"]}''::jsonb)', '23514', null, 'SEC Filing Monitor remains internal only');
select lives_ok('select pg_temp.nt_alert(''{"category":"insider_ownership","title":"HIVE Form 4 purchase","source_label":"Form 4 Purchase Monitor","listing_match_evidence":{"version":"form4_insider_purchase_match_v1","kind":"form4_insider_purchase","ticker":"HIVE","accessionNumber":"0001062993-26-004186","matches":[{}]}}''::jsonb)', 'Form 4 evidence branch preserved');
select throws_ok('select pg_temp.nt_alert(''{"category":"insider_ownership","title":"HIVE Form 4 purchase","source_label":"Form 4 Purchase Monitor","listing_match_evidence":null}''::jsonb)', '23514', null, 'Form 4 still requires evidence');
select throws_ok('select pg_temp.nt_alert(''{"category":"insider_ownership","title":"HIVE Form 4 purchase","source_label":"Form 4 Purchase Monitor","listing_match_evidence":{"version":"form4_insider_purchase_match_v1","kind":"form4_insider_purchase","ticker":"HIVE","accessionNumber":"0001062993-26-004186","matches":[]}}''::jsonb)', '23514', null, 'Form 4 invalid evidence rejected');
select lives_ok('select pg_temp.nt_alert(''{"category":"dilution_risk","title":"Stated offering plan matched","source_label":"Offering Plan Monitor","offering_plan_match_evidence":{"version":"offering_plan_match_v1","meaning":"stated_current_plan_component_not_execution","accession":"0001062993-26-004186","filedAt":"2026-08-11","contractVersion":"test","sourceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","outputHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","runId":"95000000-0000-4000-8000-000000000021","eventId":"95000000-0000-4000-8000-000000000010","rawId":"95000000-0000-4000-8000-000000000030","decisionId":null,"candidateIndex":null,"component":{"id":"c1","label":"Common shares","quantity":"100","unit":"shares","seller":"issuer","security":"common_stock","scenario":null,"references":[{"blockId":"b1","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","url":"https://www.sec.gov/Archives/edgar/data/1/filing.htm","lineStart":1,"lineEnd":2}]},"conditions":[{"key":"offering_plan.component_quantity","operator":"gte","value":"10"},{"key":"offering_plan.seller_type","operator":"eq","value":"issuer"},{"key":"offering_plan.security_type","operator":"eq","value":"common_stock"},{"key":"offering_plan.quantity_unit","operator":"eq","value":"shares"}]}}''::jsonb)', 'Offering Plan valid evidence preserved');
select throws_ok('select pg_temp.nt_alert(''{"category":"dilution_risk","title":"Stated offering plan matched","source_label":"Offering Plan Monitor","offering_plan_match_evidence":{}}''::jsonb)', '23514', null, 'Offering Plan invalid evidence still rejected');
select throws_ok('select pg_temp.nt_alert(''{"category":"dilution_risk","title":"Stated offering plan matched","source_label":"Offering Plan Monitor","offering_plan_match_evidence":{"version":"offering_plan_match_v1","meaning":"stated_current_plan_component_not_execution","accession":"0001062993-26-004186","filedAt":"2026-08-11","contractVersion":"test","sourceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","outputHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","runId":"95000000-0000-4000-8000-000000000021","eventId":"95000000-0000-4000-8000-000000000010","rawId":"95000000-0000-4000-8000-000000000030","decisionId":null,"candidateIndex":null,"component":{"id":"c1","label":"Common shares","quantity":"100","unit":"shares","seller":"issuer","security":"common_stock","scenario":null,"references":[{"blockId":"b1","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","url":"https://www.sec.gov/Archives/edgar/data/1/filing.htm","lineStart":1,"lineEnd":2}]},"conditions":[{"key":"offering_plan.component_quantity","operator":"gte","value":"10"},{"key":"offering_plan.seller_type","operator":"eq","value":"issuer"},{"key":"offering_plan.security_type","operator":"eq","value":"common_stock"},{"key":"offering_plan.quantity_unit","operator":"eq","value":"shares"}]},"listing_match_evidence":{"version":"form4_insider_purchase_match_v1","kind":"form4_insider_purchase","ticker":"HIVE","accessionNumber":"0001062993-26-004186","matches":[{}]}}''::jsonb)', '23514', null, 'Offering Plan cannot mix Form 4 evidence');
select throws_ok('select pg_temp.nt_alert(''{"category":"dilution_risk","title":"Stated offering plan matched","source_label":"Offering Plan Monitor","offering_plan_match_evidence":{"version":"offering_plan_match_v1","meaning":"stated_current_plan_component_not_execution","accession":"0001062993-26-004186","filedAt":"2026-08-11","contractVersion":"test","sourceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","outputHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","runId":"95000000-0000-4000-8000-000000000021","eventId":"95000000-0000-4000-8000-000000000010","rawId":"95000000-0000-4000-8000-000000000030","decisionId":null,"candidateIndex":null,"component":{"id":"c1","label":"Common shares","quantity":"100","unit":"shares","seller":"issuer","security":"common_stock","scenario":null,"references":[{"blockId":"b1","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","url":"https://www.sec.gov/Archives/edgar/data/1/filing.htm","lineStart":1,"lineEnd":2}]},"conditions":[{"key":"offering_plan.component_quantity","operator":"gte","value":"10"},{"key":"offering_plan.seller_type","operator":"eq","value":"issuer"},{"key":"offering_plan.security_type","operator":"eq","value":"common_stock"},{"key":"offering_plan.quantity_unit","operator":"eq","value":"shares"}]},"effect_match_evidence":{}}''::jsonb)', '23514', null, 'Offering Plan cannot mix EFFECT evidence');
select lives_ok('select pg_temp.nt_alert(''{"category":"listing_risk","title":"EFFECT registration matched","effect_registration_key":"retained-effect-key","effect_match_evidence":{"version":"retained-shape"}}''::jsonb)', 'EFFECT existing generic branch preserved');
select lives_ok('select pg_temp.nt_alert(''{"listing_monitor_id":null,"listing_source_execution_id":null,"alert_domain":null,"alert_lane":"watchlist","source_label":"SEC","source_type":"filings","severity":"high","delivered_channels":["web"],"delivery_status":"sent"}''::jsonb)', 'Primary financial_risk alert outside Monitor remains unchanged');
select lives_ok('select pg_temp.nt_alert(''{}''::jsonb)', 'prepare NT dedupe row');
select throws_ok($test$insert into pg_temp.nt_alert_shape select (jsonb_populate_record(null::pg_temp.nt_alert_shape, to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'listing_source_execution_id','95000000-0000-4000-8000-000000000099'))).* from pg_temp.nt_alert_shape a$test$, '23505', null, 'same monitor/event remains unique across executions');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.user_alert_deliveries'::regclass and conname='user_alert_deliveries_listing_monitor_event_key'), 'UNIQUE (listing_monitor_id, alert_event_id)', 'production event dedupe key is unchanged');
select * from finish();
rollback;
