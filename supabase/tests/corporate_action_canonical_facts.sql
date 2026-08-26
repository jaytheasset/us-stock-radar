begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'event_corporate_action_results', 'Corporate Action has execution-keyed result history');
select has_table('public', 'event_corporate_action_facts', 'Corporate Action has applicable-only typed facts');
select has_function(
  'public',
  'read_reverse_split_execution_update_candidates',
  array['text'],
  'Reverse Split execution-update lineage reader exists'
);
select has_function(
  'public',
  'read_stock_split_history_candidates',
  array['text', 'text', 'text', 'date', 'date'],
  'Generic stock-split history lineage reader exists'
);
select has_function(
  'public',
  'read_stock_split_execution_update_candidates',
  array['text', 'text'],
  'Generic stock-split execution-update lineage reader exists'
);
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
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_reverse_split_execution_update_candidates(text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_reverse_split_execution_update_candidates(text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_reverse_split_execution_update_candidates(text)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'public.read_reverse_split_execution_update_candidates(text)'::regprocedure),
  'execution-update lineage reader is service-role-only with an empty search_path'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute'),
  'generic stock-split lineage readers are service-role-only'
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

create function pg_temp.ca_forward_facts()
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'version', 'corporate_action_forward_split_facts_v1',
    'event_kind', 'forward_split',
    'action_stage', 'scheduled',
    'effective_date', pg_catalog.jsonb_build_object(
      'availability', 'available', 'value', '2026-09-01'
    ),
    'ratio', pg_catalog.jsonb_build_object(
      'old_shares_per_new_share', pg_catalog.jsonb_build_object(
        'availability', 'available', 'value', 0.25
      ),
      'exact_source_components', pg_catalog.jsonb_build_object(
        'availability', 'available', 'old_share_units', '1', 'new_share_units', '4'
      )
    ),
    'applicability', pg_catalog.jsonb_build_object(
      'version', 'forward_split_applicability_v1',
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
      'basis_change_capability', 'forward_split_only'
    ),
    'effective_timing', pg_catalog.jsonb_build_object(
      'availability', 'unavailable', 'reason', 'date_only'
    ),
    'execution_update', pg_catalog.jsonb_build_object(
      'version', 'forward_split_execution_update_v1',
      'decision', 'NEW_EXECUTION',
      'target_execution_id', null,
      'target_issuer_cik', null,
      'target_canonical_security_class_id', null,
      'candidate_execution_ids', '[]'::jsonb,
      'source_ref', 'news_article_body',
      'evidence', pg_catalog.jsonb_build_object(
        'availability', 'available', 'value', '4-for-1 forward stock split'
      ),
      'provenance', pg_catalog.jsonb_build_object(
        'rule', 'llm_explicit_execution_update_exact_candidate'
      )
    ),
    'source_ref', 'news_article_body',
    'evidence', pg_catalog.jsonb_build_object(
      'availability', 'available', 'value', '4-for-1 forward stock split'
    ),
    'confidence', 'high',
    'as_of', pg_catalog.jsonb_build_object(
      'availability', 'available', 'value', '2026-09-01'
    ),
    'source', pg_catalog.jsonb_build_object(
      'source_family', 'news',
      'source_id', 'canonical-ca-source',
      'source_url', 'https://example.com/canonical-ca'
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
  p_source_identity text default 'canonical-ca-source',
  p_contract_version text default 'corporate_action_reverse_split_analyzer_v1'
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
    'domain_monitor_child', p_contract_version,
    'fixture', 'running', p_started_at, null, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'child_schema_version', 'generic_monitor_child_execution_v1',
      'purpose', 'domain_monitor_child',
      'logical_job_id', p_logical_job_id,
      'execution_id', p_execution_id,
      'monitor_analyzer_key', 'corporate_action',
      'analyzer_contract_version', p_contract_version,
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
      'analyzer_contract_version', v_run.prompt_version,
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

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000007',
  '72000000-0000-4000-8000-000000000111',
  '2026-08-14 00:14:00+00'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000011',
    pg_catalog.jsonb_build_object('applicable', true, 'facts', pg_temp.ca_forward_facts())
  )->>'status',
  'saved',
  'existing Corporate Action persistence accepts one canonical forward split'
);
select pg_temp.ca_terminalize(
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000211',
  'succeeded_applicable', '2026-08-14 00:15:00+00'
);
select is(
  (select fact_schema_version || ':' || event_kind
   from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000011'),
  'corporate_action_forward_split_facts_v1:forward_split',
  'forward fact version and action kind materialize as one locked pair'
);
select is(
  (select ratio_old_share_units::text || ':' || ratio_new_share_units::text
   from public.event_corporate_action_facts
   where source_execution_id = '72000000-0000-4000-8000-000000000011'),
  '1:4',
  '4-for-1 stores exact old=1 and new=4 orientation'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )#>>'{facts,event_kind}',
  'forward_split',
  'official current reader returns the current forward split under existing lineage'
);
select is(
  public.read_stock_split_history_candidates(
    'forward_split', '0000000001', null, '2026-01-01', '2026-12-31'
  )->>'action_kind',
  'forward_split',
  'generic history reader preserves requested action kind'
);
select is(
  public.read_stock_split_execution_update_candidates(
    'reverse_split', '0000000001'
  )->>'action_kind',
  'reverse_split',
  'generic update reader preserves reverse action isolation'
);

select pg_temp.ca_add_child(
  '72000000-0000-4000-8000-000000000012',
  '72000000-0000-4000-8000-000000000007',
  '72000000-0000-4000-8000-000000000112',
  '2026-08-14 00:16:00+00',
  'canonical-ca-source',
  'corporate_action_stock_split_day_basis_evidence_v3'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_stock_split_day_basis_evidence_v3'
  )->>'reason',
  'current_contract_result_incomplete_or_failed',
  'an exact-current pending V3 child blocks fallback to the persisted V1 success'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_reverse_split_analyzer_v1'
  )->>'reason',
  'current_contract_result_incomplete_or_failed',
  'the V1 fallback reader rechecks and blocks an exact-current pending V3 child'
);
select is(
  public.persist_corporate_action_analyzer_result(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000012',
    pg_catalog.jsonb_build_object(
      'applicable', true,
      'facts', pg_temp.ca_extended_facts()
        || pg_catalog.jsonb_build_object(
          'evidence', pg_catalog.jsonb_build_object(
            'availability', 'available',
            'value', pg_catalog.repeat('x', 800),
            'preview_truncated', true
          ),
          'evidence_identity', pg_catalog.jsonb_build_object(
            'version', 'corporate_action_evidence_identity_v1',
            'source_ref', 'news_article_body',
            'range_start', 0,
            'range_end', 1001,
            'source_content_hash', pg_catalog.repeat('a', 64),
            'exact_source', true
          ),
          'calculation_activation', pg_catalog.jsonb_build_object(
            'version', 'stock_split_day_basis_activation_v1',
            'state', 'ON_EFFECTIVE_DATE',
            'source_meaning', 'date_only',
            'evidence_identity', pg_catalog.jsonb_build_object(
              'version', 'corporate_action_evidence_identity_v1',
              'source_ref', 'news_article_body',
              'range_start', 0,
              'range_end', 1001,
              'source_content_hash', pg_catalog.repeat('a', 64),
              'exact_source', true
            )
          )
        )
    )
  )->>'status',
  'saved',
  'V3 persistence accepts an 800-character preview with an independent long-source identity'
);
select pg_temp.ca_terminalize(
  '72000000-0000-4000-8000-000000000012',
  '72000000-0000-4000-8000-000000000212',
  'succeeded_applicable', '2026-08-14 00:17:00+00'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_stock_split_day_basis_evidence_v3'
  )#>>'{facts,evidence_identity,range_end}',
  '1001',
  'V3 current reader retains the authoritative range beyond the preview limit'
);
select is(
  public.read_current_event_corporate_action_facts(
    '72000000-0000-4000-8000-000000000002',
    'corporate_action_stock_split_day_basis_evidence_v3'
  )#>>'{facts,calculation_activation,state}',
  'ON_EFFECTIVE_DATE',
  'V3 current reader retains the day-basis calculation activation'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_corporate_action_applicability_context(uuid,uuid)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.read_reverse_split_history_candidates(text,text,date,date)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_reverse_split_history_candidates(text,text,date,date)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_stock_split_history_candidates(text,text,text,date,date)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_stock_split_execution_update_candidates(text,text)', 'execute'),
  'applicability context and history candidate readers remain service-role-only'
);

select * from finish();
rollback;
