begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'event_corporate_action_results', 'Corporate Action has execution-keyed result history');
select has_table('public', 'event_corporate_action_facts', 'Corporate Action has applicable-only typed facts');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_corporate_action_results'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_corporate_action_facts'::regclass),
  'both public-schema tables have RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.event_corporate_action_results', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.event_corporate_action_results', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.event_corporate_action_results', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.event_corporate_action_facts', 'select'),
  'direct Data API table access is denied to browser and service roles'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)', 'execute'),
  'only service role executes Corporate Action persistence'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_current_event_corporate_action_facts(uuid,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_current_event_corporate_action_facts(uuid,text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_current_event_corporate_action_facts(uuid,text)', 'execute'),
  'only service role executes the official reader'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_current_event_corporate_action_facts(uuid,text)'::regprocedure),
  'both definer RPCs fix an empty search_path'
);

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('canonical_ca_news', 'Corporate Action fixture', 'news', 'manual', false)
on conflict (code) do nothing;

insert into public.raw_items (
  id, source_code, source_group, source_unique_id, source_url, fetched_at,
  body_text, raw_payload, metadata
) values (
  '72000000-0000-4000-8000-000000000001',
  'canonical_ca_news', 'news', 'canonical-ca-source', 'https://example.com/canonical-ca',
  pg_catalog.now(), 'Stored source body.',
  '{"corporate_action_event_family":"reverse_split"}'::jsonb,
  '{}'::jsonb
);

insert into public.events (
  id, raw_item_id, source_code, source_group, source_name, published_at, ticker,
  event_type, score, delivery_level, impact, signal, market_scope, title,
  group_dedupe_key, metadata
) values (
  '72000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001',
  'canonical_ca_news', 'news', 'Corporate Action fixture', pg_catalog.now(), 'CCA',
  'listing_risk', 50, 'feed', 'medium', 'neutral', 'company',
  'Corporate Action fixture', 'canonical-ca:event',
  '{"calendar_items":[{"calendar_event_type":"reverse_split_effective"}]}'::jsonb
);

create function pg_temp.ca_facts(
  p_stage text default 'scheduled',
  p_source_id text default 'canonical-ca-source',
  p_ratio numeric default 20,
  p_evidence_available boolean default true
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'version', 'corporate_action_reverse_split_facts_v1',
    'event_kind', 'reverse_split',
    'action_stage', p_stage,
    'effective_date', '{"availability":"available","value":"2026-08-04"}'::jsonb,
    'ratio', pg_catalog.jsonb_build_object(
      'old_shares_per_new_share', pg_catalog.jsonb_build_object(
        'availability', 'available', 'value', p_ratio
      )
    ),
    'source_ref', 'news_article_body',
    'evidence', case when p_evidence_available
      then '{"availability":"available","value":"one-for-twenty reverse split"}'::jsonb
      else '{"availability":"unavailable","reason":"not_exact_span"}'::jsonb end,
    'confidence', 'high',
    'as_of', '{"availability":"available","value":"2026-08-04"}'::jsonb,
    'source', pg_catalog.jsonb_build_object(
      'source_family', 'news',
      'source_id', p_source_id,
      'source_url', 'https://example.com/canonical-ca'
    )
  )
$function$;

create function pg_temp.ca_extended_facts()
returns jsonb
language sql
as $function$
  select pg_temp.ca_facts()
    || pg_catalog.jsonb_build_object(
      'ratio', pg_catalog.jsonb_build_object(
        'old_shares_per_new_share', pg_catalog.jsonb_build_object(
          'availability', 'available', 'value', 20
        ),
        'exact_source_components', pg_catalog.jsonb_build_object(
          'availability', 'available', 'old_share_units', '20', 'new_share_units', '1'
        )
      ),
      'applicability', pg_catalog.jsonb_build_object(
        'version', 'reverse_split_applicability_v1',
        'issuer', pg_catalog.jsonb_build_object(
          'availability', 'unavailable', 'reason', 'non_sec_source'
        ),
        'affected_security', pg_catalog.jsonb_build_object(
          'availability', 'unavailable',
          'reason', 'issuer_identity_unavailable',
          'source_ref', null,
          'evidence', pg_catalog.jsonb_build_object(
            'availability', 'unavailable', 'reason', 'not_provided'
          )
        ),
        'basis_change_capability', 'reverse_split_only'
      ),
      'effective_timing', pg_catalog.jsonb_build_object(
        'availability', 'unavailable', 'reason', 'date_only'
      )
    )
$function$;

create function pg_temp.ca_add_parent(
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
    p_parent_id, '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'news_event_analysis', 'v28-corporate-action-routing', 'fixture', 'completed',
    p_started_at, p_finished_at, '{}'::jsonb, '{}'::jsonb
  );
  insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
  values (
    p_output_id, p_parent_id, '72000000-0000-4000-8000-000000000002',
    'news_event_analysis',
    pg_catalog.jsonb_build_object('analysis', pg_catalog.jsonb_build_object(
      'event_type', 'listing_risk',
      'calendar_items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('calendar_event_type', 'reverse_split_effective')
      ),
      'monitor_routes', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('monitor_analyzer_key', 'listing_risk'),
        pg_catalog.jsonb_build_object('monitor_analyzer_key', 'corporate_action')
      )
    ))
  );
end
$function$;

create function pg_temp.ca_add_child(
  p_execution_id uuid,
  p_parent_id uuid,
  p_logical_job_id uuid,
  p_started_at timestamptz,
  p_source_identity text default 'canonical-ca-source'
)
returns void
language sql
as $function$
  insert into public.ai_runs (
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
    started_at, finished_at, usage, metadata
  ) values (
    p_execution_id,
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'domain_monitor_child', 'corporate_action_reverse_split_analyzer_v1',
    'fixture', 'running', p_started_at, null, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'child_schema_version', 'generic_monitor_child_execution_v1',
      'purpose', 'domain_monitor_child',
      'logical_job_id', p_logical_job_id,
      'execution_id', p_execution_id,
      'monitor_analyzer_key', 'corporate_action',
      'analyzer_contract_version', 'corporate_action_reverse_split_analyzer_v1',
      'attempt_kind', 'automatic', 'attempt_key', 'automatic',
      'parent_primary_ai_run_id', p_parent_id,
      'parent_prompt_key', 'news_event_analysis',
      'parent_prompt_version', 'v28-corporate-action-routing',
      'source_family', 'news', 'source_group', 'news',
      'source_code', 'canonical_ca_news', 'source_identity', p_source_identity,
      'event_id', '72000000-0000-4000-8000-000000000002',
      'raw_item_id', '72000000-0000-4000-8000-000000000001',
      'reserved_at', p_started_at,
      'execution_state', 'running', 'phase', 'running'
    )
  )
$function$;

create function pg_temp.ca_terminalize(
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
  set status = 'completed', finished_at = p_finished_at,
      metadata = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(metadata, '{execution_state}', pg_catalog.to_jsonb(p_execution_state)),
        '{phase}', pg_catalog.to_jsonb(p_execution_state)
      )
  where id = p_execution_id
  returning * into v_run;

  insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
  values (
    p_output_id, p_execution_id, v_run.event_id,
    'domain_monitor_child_execution_result',
    pg_catalog.jsonb_build_object(
      'schema_version', 'generic_monitor_child_execution_result_v1',
      'logical_job_id', v_run.metadata->>'logical_job_id',
      'execution_id', p_execution_id,
      'parent_primary_ai_run_id', v_run.metadata->>'parent_primary_ai_run_id',
      'monitor_analyzer_key', 'corporate_action',
      'analyzer_contract_version', 'corporate_action_reverse_split_analyzer_v1',
      'result_classification', p_execution_state
    )
  );
end
$function$;

select pg_temp.ca_add_parent(
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000103',
  '2026-08-14 00:00:00+00', '2026-08-14 00:01:00+00'
);

select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )->>'status',
  'not_ready',
  'parser candidate, event_type, Primary calendar, and sibling Listing route never become a Corporate Action fallback'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000104',
  '2026-08-14 00:02:00+00'
);

select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts())
  )->>'status',
  'saved',
  'validated applicable result persists before terminal success'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_corporate_action_results
   where source_execution_id = '72000000-0000-4000-8000-000000000004'),
  1,
  'one exact Corporate Action result row is stored'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000004'),
  1,
  'applicable stores one typed fact row'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts())
  )->>'status',
  'idempotent',
  'same execution and identical payload is idempotent'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000004',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts('effective'))
  )->>'status',
  'conflict',
  'same execution with different semantic payload conflicts'
);

select pg_temp.ca_terminalize(
  '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000204',
  'succeeded_applicable', '2026-08-14 00:03:00+00'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )->>'status',
  'available',
  'terminal applicable result is available from the official reader'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )#>>'{facts,ratio,old_shares_per_new_share,value}',
  '20',
  'mechanically normalized old-shares-per-new-share ratio round-trips'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )#>>'{facts,evidence,value}',
  'one-for-twenty reverse split',
  'exact evidence round-trips without rewriting'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000005',
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000105',
  '2026-08-14 00:04:00+00'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000005',
    '{"applicable":false}'::jsonb
  )->>'status',
  'saved',
  'validated non-reverse source stores a not-applicable result'
);
select pg_temp.ca_terminalize(
  '72000000-0000-4000-8000-000000000005',
  '72000000-0000-4000-8000-000000000205',
  'succeeded_not_applicable', '2026-08-14 00:05:00+00'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )->>'status',
  'not_applicable',
  'newer not-applicable success never falls back to the older reverse-split fact'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000005'),
  0,
  'not-applicable creates no fake reverse-split fact'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000006',
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000106',
  '2026-08-14 00:06:00+00',
  'wrong-source-identity'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000006',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts())
  )->>'reason',
  'source_execution_lineage_invalid',
  'source execution identity mismatch hard fails'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000006',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts('scheduled', 'invented-source'))
  )->>'reason',
  'source_execution_lineage_invalid',
  'invalid child lineage fails before any invented fact source can persist'
);

select pg_temp.ca_add_parent(
  '72000000-0000-4000-8000-000000000007',
  '72000000-0000-4000-8000-000000000107',
  '2026-08-14 00:07:00+00', '2026-08-14 00:08:00+00'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )->>'status',
  'not_ready',
  'a newer Primary immediately invalidates old-parent canonical state'
);
select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000008',
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000108',
  '2026-08-14 00:09:00+00'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000008',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts('effective', 'canonical-ca-source', 10, false))
  )->>'status',
  'stale',
  'late old-parent child cannot persist after a newer Primary'
);
select is(
  (select pg_catalog.count(*)::integer from public.event_corporate_action_results
   where source_execution_id = '72000000-0000-4000-8000-000000000008'),
  0,
  'stale execution writes no result or fact history'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000009',
  '72000000-0000-4000-8000-000000000007',
  '72000000-0000-4000-8000-000000000109',
  '2026-08-14 00:10:00+00'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000009',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_facts('effective', 'canonical-ca-source', 10, false))
  )->>'status',
  'saved',
  'current newer-parent result persists independently'
);
select pg_temp.ca_terminalize(
  '72000000-0000-4000-8000-000000000009',
  '72000000-0000-4000-8000-000000000209',
  'succeeded_applicable', '2026-08-14 00:11:00+00'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )#>>'{facts,evidence,availability}',
  'unavailable',
  'evidence-unavailable fact remains reader-eligible when semantic/source provenance is valid'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )#>>'{facts,action_stage}',
  'effective',
  'newer exact-parent fact is current'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000010',
  '72000000-0000-4000-8000-000000000007',
  '72000000-0000-4000-8000-000000000110',
  '2026-08-14 00:12:00+00'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000010',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_extended_facts())
  )->>'status',
  'saved',
  'backward-compatible persistence accepts the applicability/timing/exact-ratio extension'
);
select is(
  (select applicability_status from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000010'),
  'unavailable',
  'non-SEC source preserves unavailable affected-security applicability'
);
select is(
  (select ratio_old_share_units::text || ':' || ratio_new_share_units::text
   from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000010'),
  '20:1',
  'exact old/new ratio components materialize without floating-point-only storage'
);
select is(
  (select effective_timing_status || ':' || (effective_timing_payload ->> 'reason')
   from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000010'),
  'unavailable:date_only',
  'date-only effective timing preserves unresolved same-day ordering'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.read_reverse_split_history_candidates(text,text,date,date)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_reverse_split_history_candidates(text,text,date,date)', 'execute'),
  'applicability context and history candidate readers remain service-role-only'
);

select * from finish();
rollback;
