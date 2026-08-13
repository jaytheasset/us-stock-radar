begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_table('public', 'event_listing_risk_results', 'Listing Risk has execution-keyed semantic result history');
select has_table('public', 'event_listing_risk_facts', 'Listing Risk has applicable-only event fact storage');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_listing_risk_results'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_listing_risk_facts'::regclass),
  'both exposed-schema tables have RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.event_listing_risk_results', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.event_listing_risk_results', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.event_listing_risk_results', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.event_listing_risk_facts', 'select'),
  'browser roles and service role cannot bypass the RPC boundary with direct table access'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)', 'execute'),
  'only service role executes Listing Risk persistence'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_current_event_listing_risk_facts(uuid,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_current_event_listing_risk_facts(uuid,text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_current_event_listing_risk_facts(uuid,text)', 'execute'),
  'only service role executes the current Listing Risk reader'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_current_event_listing_risk_facts(uuid,text)'::regprocedure),
  'both narrowly granted definer functions use a fixed empty search_path'
);

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('phase1i_news', 'Phase 1I fixture', 'news', 'manual', false)
on conflict (code) do nothing;

insert into public.raw_items (
  id, source_code, source_group, source_unique_id, source_url, fetched_at, raw_payload, metadata
) values (
  '81000000-0000-4000-8000-000000000001',
  'phase1i_news', 'news', 'phase1i-article', 'https://example.com/phase1i',
  pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
), (
  '81000000-0000-4000-8000-000000000011',
  'phase1i_news', 'news', 'phase1i-other-article', 'https://example.com/phase1i-other',
  pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
);

insert into public.events (
  id, raw_item_id, source_code, source_group, source_name, published_at, ticker, event_type,
  score, delivery_level, impact, signal, market_scope, title, group_dedupe_key, metadata
) values (
  '81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  'phase1i_news', 'news', 'Phase 1I fixture', pg_catalog.now(), 'P1I', 'dilution_risk',
  50, 'feed', 'medium', 'neutral', 'company', 'Phase 1I Listing fixture', 'phase1i:listing',
  pg_catalog.jsonb_build_object('listing_status_snapshot', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label', 'Legacy display', 'value', 'must not be read')
  ))
), (
  '81000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000011',
  'phase1i_news', 'news', 'Phase 1I fixture', pg_catalog.now(), 'OTH', 'dilution_risk',
  50, 'feed', 'medium', 'neutral', 'company', 'Phase 1I other event', 'phase1i:other', '{}'::jsonb
);

create function pg_temp.phase1i_unavailable_text()
returns jsonb
language sql
immutable
as $function$
  select '{"value":null,"availability":"unavailable","value_quality":"unknown","source_ref":null}'::jsonb
$function$;

create function pg_temp.phase1i_unavailable_date()
returns jsonb
language sql
immutable
as $function$
  select '{"value":null,"availability":"unavailable","value_quality":"unknown","date_status":"unknown","source_ref":null}'::jsonb
$function$;

create function pg_temp.phase1i_facts(
  p_outcome text default 'adverse',
  p_evidence text default 'Issuer received a minimum bid price notice.'
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'version', 'listing_risk_event_facts_v1',
    'classification', pg_catalog.jsonb_build_object(
      'event_kind', 'deficiency_notice', 'event_outcome', p_outcome, 'source_ref', 'source:block:1'
    ),
    'exchange', pg_catalog.jsonb_build_object(
      'value', 'Nasdaq', 'availability', 'available', 'value_quality', 'exact', 'source_ref', 'source:block:1'
    ),
    'affected_security', pg_catalog.jsonb_build_object(
      'title', pg_temp.phase1i_unavailable_text(),
      'ticker', pg_catalog.jsonb_build_object(
        'value', '0', 'availability', 'available', 'value_quality', 'exact', 'source_ref', 'source:block:1'
      ),
      'security_basis', pg_temp.phase1i_unavailable_text()
    ),
    'listing_rule', pg_temp.phase1i_unavailable_text(),
    'listing_requirement', pg_catalog.jsonb_build_object(
      'value', 'Minimum bid price requirement', 'availability', 'available',
      'value_quality', 'exact', 'source_ref', 'source:block:1'
    ),
    'compliance_period', pg_temp.phase1i_unavailable_text(),
    'proceeding', pg_catalog.jsonb_build_object('kind', 'unknown', 'status', 'unknown', 'source_ref', null),
    'dates', pg_catalog.jsonb_build_object(
      'notice_date', pg_catalog.jsonb_build_object(
        'value', '2026-08-12', 'availability', 'available', 'value_quality', 'exact',
        'date_status', 'occurred', 'source_ref', 'source:block:1'
      ),
      'compliance_deadline', pg_temp.phase1i_unavailable_date(),
      'hearing_date', pg_temp.phase1i_unavailable_date(),
      'appeal_deadline', pg_temp.phase1i_unavailable_date(),
      'trading_suspension_date', pg_temp.phase1i_unavailable_date(),
      'removal_effective_date', pg_temp.phase1i_unavailable_date()
    ),
    'continued_trading', pg_catalog.jsonb_build_object(
      'continues', pg_catalog.jsonb_build_object(
        'value', false, 'availability', 'available', 'value_quality', 'exact', 'source_ref', 'source:block:1'
      ),
      'venue', pg_temp.phase1i_unavailable_text()
    ),
    'as_of', pg_catalog.jsonb_build_object(
      'value', '2026-08-12', 'availability', 'available', 'value_quality', 'exact',
      'date_status', 'occurred', 'source_ref', 'source:block:1'
    ),
    'confidence', null,
    'sources', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'source_family', 'news', 'source_id', 'phase1i-article',
      'source_url', 'https://example.com/phase1i', 'source_ref', 'source:block:1',
      'evidence', p_evidence
    ))
  )
$function$;

create function pg_temp.phase1i_add_parent(
  p_parent_id uuid,
  p_output_id uuid,
  p_started_at timestamptz,
  p_finished_at timestamptz
)
returns void
language plpgsql
as $function$
begin
  insert into public.ai_runs (
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
    started_at, finished_at, usage, metadata
  ) values (
    p_parent_id, '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'news_event_analysis', 'v27-monitor-routing', 'fixture', 'completed',
    p_started_at, p_finished_at, '{}'::jsonb, '{}'::jsonb
  );
  insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
  values (
    p_output_id, p_parent_id, '81000000-0000-4000-8000-000000000002',
    'news_event_analysis',
    pg_catalog.jsonb_build_object('analysis', pg_catalog.jsonb_build_object(
      'monitor_routes', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('monitor_analyzer_key', 'listing_risk')
      )
    ))
  );
end
$function$;

create function pg_temp.phase1i_add_child(
  p_execution_id uuid,
  p_parent_id uuid,
  p_logical_job_id uuid,
  p_started_at timestamptz
)
returns void
language sql
as $function$
  insert into public.ai_runs (
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
    started_at, finished_at, usage, metadata
  ) values (
    p_execution_id,
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'domain_monitor_child', 'listing_risk_domain_analyzer_v2', 'fixture', 'running',
    p_started_at, null, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'child_schema_version', 'generic_monitor_child_execution_v1',
      'purpose', 'domain_monitor_child',
      'logical_job_id', p_logical_job_id,
      'execution_id', p_execution_id,
      'monitor_analyzer_key', 'listing_risk',
      'analyzer_contract_version', 'listing_risk_domain_analyzer_v2',
      'attempt_kind', 'automatic', 'attempt_key', 'automatic',
      'parent_primary_ai_run_id', p_parent_id,
      'parent_prompt_key', 'news_event_analysis',
      'parent_prompt_version', 'v27-monitor-routing',
      'source_family', 'news', 'source_group', 'news', 'source_code', 'phase1i_news',
      'source_identity', 'phase1i-article',
      'event_id', '81000000-0000-4000-8000-000000000002',
      'raw_item_id', '81000000-0000-4000-8000-000000000001',
      'reserved_at', p_started_at,
      'execution_state', 'running', 'phase', 'running'
    )
  )
$function$;

create function pg_temp.phase1i_terminalize(
  p_execution_id uuid,
  p_output_id uuid,
  p_execution_state text,
  p_finished_at timestamptz
)
returns void
language plpgsql
as $function$
declare
  v_run public.ai_runs%rowtype;
begin
  update public.ai_runs
  set status = 'completed',
      finished_at = p_finished_at,
      metadata = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(metadata, '{execution_state}', pg_catalog.to_jsonb(p_execution_state)),
        '{phase}', pg_catalog.to_jsonb(p_execution_state)
      )
  where id = p_execution_id
  returning * into v_run;

  insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
  values (
    p_output_id, p_execution_id, v_run.event_id, 'domain_monitor_child_execution_result',
    pg_catalog.jsonb_build_object(
      'schema_version', 'generic_monitor_child_execution_result_v1',
      'logical_job_id', v_run.metadata->>'logical_job_id',
      'execution_id', p_execution_id,
      'parent_primary_ai_run_id', v_run.metadata->>'parent_primary_ai_run_id',
      'monitor_analyzer_key', 'listing_risk',
      'analyzer_contract_version', 'listing_risk_domain_analyzer_v2',
      'result_classification', p_execution_state
    )
  );
end
$function$;

select pg_temp.phase1i_add_parent(
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000103',
  '2026-08-13 00:00:00+00', '2026-08-13 00:01:00+00'
);
select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000104',
  '2026-08-13 00:02:00+00'
);

select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('status', 'applicable', 'facts', pg_temp.phase1i_facts())
  )->>'status',
  'saved',
  'validated applicable result is persisted before terminal success'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_listing_risk_results
   where source_execution_id = '81000000-0000-4000-8000-000000000004'),
  1,
  'one exact result row is stored'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_listing_risk_facts
   where source_execution_id = '81000000-0000-4000-8000-000000000004'),
  1,
  'applicable stores exactly one event fact row'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('status', 'applicable', 'facts', pg_temp.phase1i_facts())
  )->>'status',
  'idempotent',
  'same execution and same payload is idempotent'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('status', 'applicable', 'facts', pg_temp.phase1i_facts('recovered'))
  )->>'status',
  'conflict',
  'same execution and different semantic payload fails closed'
);

select pg_temp.phase1i_terminalize(
  '81000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000204',
  'succeeded_applicable',
  '2026-08-13 00:03:00+00'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'status',
  'available',
  'terminal applicable result exposes exact current facts'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )#>>'{facts,sources,0,evidence}',
  'Issuer received a minimum bid price notice.',
  'evidence round-trips without persistence truncation or rewrite'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )#>>'{facts,as_of,source_ref}',
  'source:block:1',
  'as_of source_ref round-trips exactly'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )#>>'{facts,continued_trading,continues,value}',
  'false',
  'explicit false is not collapsed to null'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )#>>'{facts,affected_security,ticker,value}',
  '0',
  'text zero is not collapsed to empty or null'
);
select ok(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )#>'{facts,listing_rule,value}' = 'null'::jsonb,
  'canonical unavailable null remains JSON null'
);

insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, metadata
) select
  '81000000-0000-4000-8000-000000000007', event_id, raw_item_id,
  'domain_monitor_child', 'listing_risk_domain_analyzer_v2', 'fixture', 'failed',
  '2026-08-13 00:04:00+00', '2026-08-13 00:05:00+00', '{}'::jsonb,
  metadata || pg_catalog.jsonb_build_object(
    'execution_id', '81000000-0000-4000-8000-000000000007',
    'logical_job_id', '81000000-0000-4000-8000-000000000107',
    'attempt_kind', 'retry', 'attempt_key', 'retry:failure',
    'execution_state', 'failed', 'phase', 'failed'
  )
from public.ai_runs where id = '81000000-0000-4000-8000-000000000004';
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'status',
  'available',
  'a later failure on the same current Primary does not semantically clear prior valid facts'
);

select pg_temp.phase1i_add_parent(
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-000000000105',
  '2026-08-13 01:00:00+00', '2026-08-13 01:01:00+00'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'reason',
  'current_successful_result_missing',
  'new current Primary immediately hides old-parent applicable facts'
);

select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-000000000008',
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000108',
  '2026-08-13 01:02:00+00'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000008',
    pg_catalog.jsonb_build_object('status', 'applicable', 'facts', pg_temp.phase1i_facts())
  )->>'status',
  'stale',
  'old-parent child cannot persist after a newer Primary is current'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_listing_risk_results
   where source_execution_id = '81000000-0000-4000-8000-000000000008'),
  0,
  'stale child writes no result or facts'
);

select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-000000000006',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-000000000106',
  '2026-08-13 01:03:00+00'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000006',
    '{"status":"not_applicable"}'::jsonb
  )->>'status',
  'saved',
  'validated not_applicable result is recorded without a fake fact'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000006',
    '{"status":"not_applicable"}'::jsonb
  )->>'status',
  'idempotent',
  'same not_applicable execution retry is idempotent'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_listing_risk_facts
   where source_execution_id = '81000000-0000-4000-8000-000000000006'),
  0,
  'not_applicable creates no Listing fact row'
);
select pg_temp.phase1i_terminalize(
  '81000000-0000-4000-8000-000000000006',
  '81000000-0000-4000-8000-000000000206',
  'succeeded_not_applicable',
  '2026-08-13 01:04:00+00'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'status',
  'not_applicable',
  'A applicable then B not_applicable never returns A as current'
);

-- A stale child may finish late, but current-parent filtering keeps B authoritative.
select pg_temp.phase1i_terminalize(
  '81000000-0000-4000-8000-000000000008',
  '81000000-0000-4000-8000-000000000208',
  'succeeded_applicable',
  '2026-08-13 01:05:00+00'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'status',
  'not_applicable',
  'late stale applicable completion cannot replace or expose current facts'
);

select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-000000000009',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-000000000109',
  '2026-08-13 01:06:00+00'
);
update public.ai_runs
set metadata = pg_catalog.jsonb_set(metadata, '{parent_prompt_version}', '"wrong-version"'::jsonb)
where id = '81000000-0000-4000-8000-000000000009';
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000009',
    '{"status":"not_applicable"}'::jsonb
  )->>'reason',
  'exact_parent_lineage_invalid',
  'mismatched exact parent identity is rejected'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000006',
    '{"status":"not_applicable"}'::jsonb
  )->>'reason',
  'source_execution_lineage_invalid',
  'event/source mismatch fails closed'
);
select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-00000000000c',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-00000000010c',
  '2026-08-13 01:07:00+00'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-00000000000c',
    pg_catalog.jsonb_build_object(
      'status', 'applicable',
      'facts', pg_catalog.jsonb_set(
        pg_temp.phase1i_facts(),
        '{sources,0,source_id}',
        '"foreign-source"'::jsonb
      )
    )
  )->>'reason',
  'facts_source_identity_invalid',
  'validated facts source identity must match the exact raw source'
);
select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-00000000000d',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-00000000010d',
  '2026-08-13 01:08:00+00'
);
insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
values (
  '81000000-0000-4000-8000-00000000030d',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-000000000002',
  'news_event_analysis',
  pg_catalog.jsonb_build_object('analysis', pg_catalog.jsonb_build_object(
    'monitor_routes', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('monitor_analyzer_key', 'listing_risk')
    )
  ))
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-00000000000d',
    '{"status":"not_applicable"}'::jsonb
  )->>'reason',
  'exact_parent_output_or_route_invalid',
  'ambiguous duplicate Primary output fails exact lineage closed'
);
delete from public.ai_outputs where id = '81000000-0000-4000-8000-00000000030d';

select pg_temp.phase1i_add_parent(
  '81000000-0000-4000-8000-00000000000a',
  '81000000-0000-4000-8000-00000000010a',
  '2026-08-13 02:00:00+00', '2026-08-13 02:01:00+00'
);
select pg_temp.phase1i_add_child(
  '81000000-0000-4000-8000-00000000000b',
  '81000000-0000-4000-8000-00000000000a',
  '81000000-0000-4000-8000-00000000010b',
  '2026-08-13 02:02:00+00'
);
select pg_temp.phase1i_terminalize(
  '81000000-0000-4000-8000-00000000000b',
  '81000000-0000-4000-8000-00000000020b',
  'succeeded_applicable',
  '2026-08-13 02:03:00+00'
);
select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002', 'listing_risk_domain_analyzer_v2'
  )->>'reason',
  'current_result_not_persisted_or_mismatched',
  'terminal applicable without typed persistence is not ready and never falls back to old facts or display metadata'
);
select is(
  public.persist_listing_risk_analyzer_result(
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-00000000000b',
    pg_catalog.jsonb_build_object('status', 'applicable', 'facts', pg_temp.phase1i_facts())
  )->>'reason',
  'terminal_success_without_prior_persistence',
  'persistence cannot backfill an applicable fact after terminal success was recorded first'
);

select * from finish();
rollback;
