begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select has_table(
  'public',
  'event_offering_monitor_canonical',
  'Offering Monitor has one dedicated canonical current-state table'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_offering_monitor_canonical'::regclass),
  'canonical table has RLS enabled in the exposed public schema'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.event_offering_monitor_canonical', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.event_offering_monitor_canonical', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'public.event_offering_monitor_canonical', 'insert'),
  'browser roles cannot read and even service role cannot bypass the promotion RPC with a direct insert'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.promote_event_offering_monitor_canonical(uuid,uuid,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.promote_event_offering_monitor_canonical(uuid,uuid,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.promote_event_offering_monitor_canonical(uuid,uuid,jsonb)', 'execute'),
  'only service role executes the atomic promotion RPC'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_event_offering_monitor_canonical(uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_event_offering_monitor_canonical(uuid)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_event_offering_monitor_canonical(uuid)', 'execute'),
  'only service role executes the canonical reader'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.promote_event_offering_monitor_canonical(uuid,uuid,jsonb)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid = 'public.promote_event_offering_monitor_canonical(uuid,uuid,jsonb)'::regprocedure),
  'RPC-only table boundary uses a fixed empty search_path on the narrowly granted definer function'
);

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('phase5n_fixture', 'Phase 5N fixture', 'filings', 'manual', false)
on conflict (code) do nothing;

insert into public.raw_items (
  id, source_code, source_group, source_unique_id, fetched_at, raw_payload, metadata
) values (
  '95000000-0000-4000-8000-000000000001',
  'phase5n_fixture', 'filings', 'phase5n-accession-a', pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
);

insert into public.events (
  id, raw_item_id, source_code, source_group, source_name, published_at, ticker, event_type,
  score, delivery_level, impact, signal, market_scope, title, group_dedupe_key, metadata
) values (
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'phase5n_fixture', 'filings', 'Phase 5N fixture', pg_catalog.now(), 'P5N', 'dilution_risk',
  50, 'feed', 'medium', 'neutral', 'company', 'Phase 5N canonical fixture', 'phase5n:canonical', '{}'::jsonb
);

create function pg_temp.phase5n_candidate(
  p_execution_id uuid,
  p_parent_id uuid,
  p_amount numeric default 10000000,
  p_immediate numeric default 15713387,
  p_additional numeric default 15713387,
  p_amount_source text default 'amount_ref'
)
returns jsonb
language sql
as $function$
  with facts as (
    select pg_catalog.jsonb_build_object(
      'actual_primary_offering_amount', pg_catalog.jsonb_build_object(
        'value', p_amount, 'availability', 'available', 'value_quality', 'estimated', 'bound', 'maximum',
        'unit', 'currency', 'currency', 'USD', 'security_basis', 'unit_offering',
        'comparison_basis_type', 'market_cap', 'comparable_to_event_market_basis', false, 'source_ref', p_amount_source
      ),
      'offering_price', pg_catalog.jsonb_build_object(
        'value', null, 'availability', 'unavailable', 'value_quality', 'unknown', 'bound', 'unknown',
        'unit', 'currency_per_security', 'currency', null, 'security_basis', null,
        'comparison_basis_type', 'market_price', 'comparable_to_event_market_basis', null, 'source_ref', null
      ),
      'immediate_primary_share_exposure', pg_catalog.jsonb_build_object(
        'value', p_immediate, 'availability', 'available', 'value_quality', 'estimated', 'bound', 'maximum',
        'unit', 'shares', 'currency', null, 'security_basis', 'common_shares',
        'comparison_basis_type', 'shares_outstanding', 'comparable_to_event_market_basis', false, 'source_ref', 'immediate_ref'
      ),
      'additional_potential_primary_share_exposure', pg_catalog.jsonb_build_object(
        'value', p_additional, 'availability', 'available', 'value_quality', 'estimated', 'bound', 'maximum',
        'unit', 'shares', 'currency', null, 'security_basis', 'common_warrants',
        'comparison_basis_type', 'shares_outstanding', 'comparable_to_event_market_basis', false, 'source_ref', 'additional_ref'
      ),
      'resale_share_exposure', pg_catalog.jsonb_build_object(
        'value', null, 'availability', 'unavailable', 'value_quality', 'unknown', 'bound', 'unknown',
        'unit', 'shares', 'currency', null, 'security_basis', null,
        'comparison_basis_type', 'public_float', 'comparable_to_event_market_basis', null, 'source_ref', null
      )
    ) as value
  ), canonical as (
    select pg_catalog.jsonb_build_object(
      'version', 'minimal_offering_monitor_v1', 'applicability', 'applicable',
      'financing_stage', 'registration_only', 'primary_or_resale', 'primary',
      'security_nature', 'equity_linked', 'has_warrant', true,
      'has_prefunded_warrant', true, 'has_convertible', false, 'facts', facts.value
    ) as value
    from facts
  ), materialized as (
    select canonical.value || pg_catalog.jsonb_build_object(
      'total_potential_primary_share_exposure', pg_catalog.jsonb_build_object(
        'value', p_immediate + p_additional, 'availability', 'available', 'value_quality', 'estimated',
        'bound', 'maximum', 'unit', 'shares', 'currency', null,
        'security_basis', 'common_shares + common_warrants',
        'comparison_basis_type', 'shares_outstanding', 'comparable_to_event_market_basis', false,
        'source_ref', 'immediate_ref + additional_ref'
      ),
      'derived_metrics', '{}'::jsonb,
      'safe_projection', pg_catalog.jsonb_build_object(
        'actual_primary_offering_amount', p_amount,
        'immediate_primary_share_exposure', p_immediate,
        'additional_potential_primary_share_exposure', p_additional,
        'total_potential_primary_share_exposure', p_immediate + p_additional
      )
    ) as value
    from canonical
  )
  select pg_catalog.jsonb_build_object(
    'schema_version', 'offering_monitor_second_stage_candidate_v2',
    'job_id', p_execution_id,
    'parent_primary_ai_run_id', p_parent_id,
    'event_id', '95000000-0000-4000-8000-000000000002',
    'raw_item_id', '95000000-0000-4000-8000-000000000001',
    'source_identity', 'phase5n-accession-a',
    'prompt', pg_catalog.jsonb_build_object('key', 'offering_monitor_normalization_job', 'version', 'second_stage_direct_v8'),
    'input_stats', pg_catalog.jsonb_build_object('selectedSourceRefs', pg_catalog.jsonb_build_array('amount_ref', 'immediate_ref', 'additional_ref')),
    'validation', pg_catalog.jsonb_build_object('status', 'success', 'errors', '[]'::jsonb),
    'canonical_candidate', canonical.value,
    'materialized_candidate', materialized.value
  )
  from canonical cross join materialized
$function$;

insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, metadata
) values (
  '95000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'sec_s1_f1_analysis', 'fixture-primary-a', 'fixture', 'completed',
  '2026-08-12 01:00:00+00', '2026-08-12 01:01:00+00', '{}'::jsonb, '{}'::jsonb
), (
  '95000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'offering_monitor_normalization_job', 'second_stage_direct_v8', 'fixture', 'completed',
  '2026-08-12 01:02:00+00', '2026-08-12 01:03:00+00', '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'purpose', 'offering_monitor_normalization',
    'execution_id', '95000000-0000-4000-8000-000000000004',
    'execution_contract_version', 'second_stage_direct_v8',
    'parent_primary_ai_run_id', '95000000-0000-4000-8000-000000000003',
    'parent_prompt_key', 'sec_s1_f1_analysis', 'form_family', 's1',
    'validation_status', 'success', 'diagnostic_candidate_only', true,
    'phase', 'diagnostic_candidate_saved'
  )
);

insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
select
  '95000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000002',
  'offering_monitor_normalization_candidate',
  pg_temp.phase5n_candidate(
    '95000000-0000-4000-8000-000000000004',
    '95000000-0000-4000-8000-000000000003'
  );

select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000004',
    pg_temp.phase5n_candidate('95000000-0000-4000-8000-000000000004', '95000000-0000-4000-8000-000000000003')
  )->>'status',
  'saved',
  'valid completed exact-parent Second-stage candidate promotes atomically'
);
select is(
  (select count(*)::integer from public.event_offering_monitor_canonical where event_id = '95000000-0000-4000-8000-000000000002'),
  1,
  'event current-state uniqueness produces one row'
);
select is(
  (select total_potential_primary_share_exposure from public.event_offering_monitor_canonical where event_id = '95000000-0000-4000-8000-000000000002'),
  31426774::numeric,
  'promotion persists the existing materializer Immediate plus Additional total exactly once'
);
select is(
  public.read_event_offering_monitor_canonical('95000000-0000-4000-8000-000000000002')->>'status',
  'available',
  'canonical-only reader returns a current promoted row'
);
select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000004',
    pg_temp.phase5n_candidate('95000000-0000-4000-8000-000000000004', '95000000-0000-4000-8000-000000000003')
  )->>'status',
  'idempotent',
  'same execution double promotion is idempotent'
);
select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000099',
    '{}'::jsonb
  )->>'reason',
  'source_execution_missing',
  'missing or invalid execution is rejected without touching canonical state'
);
select is(
  (select source_execution_id from public.event_offering_monitor_canonical where event_id = '95000000-0000-4000-8000-000000000002'),
  '95000000-0000-4000-8000-000000000004'::uuid,
  'invalid execution cannot erase the valid canonical row'
);

-- A successful but foreign provenance ref is not promotable even though it is
-- inside the same diagnostic candidate shape.
insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, metadata
) values (
  '95000000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'offering_monitor_normalization_job', 'second_stage_direct_v8', 'fixture', 'completed',
  '2026-08-12 01:04:00+00', '2026-08-12 01:05:00+00', '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'purpose', 'offering_monitor_normalization',
    'execution_id', '95000000-0000-4000-8000-000000000005',
    'execution_contract_version', 'second_stage_direct_v8',
    'parent_primary_ai_run_id', '95000000-0000-4000-8000-000000000003',
    'parent_prompt_key', 'sec_s1_f1_analysis', 'form_family', 's1',
    'validation_status', 'success', 'diagnostic_candidate_only', true,
    'phase', 'diagnostic_candidate_saved'
  )
);
insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
select
  '95000000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000002',
  'offering_monitor_normalization_candidate',
  pg_temp.phase5n_candidate(
    '95000000-0000-4000-8000-000000000005',
    '95000000-0000-4000-8000-000000000003',
    10000000, 15713387, 15713387, 'foreign_ref'
  );
select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000005',
    pg_temp.phase5n_candidate(
      '95000000-0000-4000-8000-000000000005',
      '95000000-0000-4000-8000-000000000003',
      10000000, 15713387, 15713387, 'foreign_ref'
    )
  )->>'reason',
  'source_membership_or_fact_coverage_invalid',
  'allowed source membership remains a strict promotion prerequisite'
);

-- Primary PA2 becomes current. Canonical A remains physically present but is
-- immediately unavailable through the official reader (Option A).
insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, metadata
) values (
  '95000000-0000-4000-8000-000000000006',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'sec_s1_f1_analysis', 'fixture-primary-b', 'fixture', 'completed',
  '2026-08-12 02:00:00+00', '2026-08-12 02:01:00+00', '{}'::jsonb, '{}'::jsonb
);
select is(
  public.read_event_offering_monitor_canonical('95000000-0000-4000-8000-000000000002')->>'reason',
  'parent_not_current',
  'PA2 completion makes canonical A immediately unavailable without an invalidation write'
);
select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000004',
    pg_temp.phase5n_candidate('95000000-0000-4000-8000-000000000004', '95000000-0000-4000-8000-000000000003')
  )->>'status',
  'stale',
  'late old MA loses save authority after PA2'
);

insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, error_message, metadata
) values (
  '95000000-0000-4000-8000-000000000007',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'offering_monitor_normalization_job', 'second_stage_direct_v8', 'fixture', 'failed',
  '2026-08-12 02:02:00+00', '2026-08-12 02:03:00+00', '{}'::jsonb, 'fixture failure',
  pg_catalog.jsonb_build_object(
    'purpose', 'offering_monitor_normalization',
    'execution_id', '95000000-0000-4000-8000-000000000007',
    'execution_contract_version', 'second_stage_direct_v8',
    'parent_primary_ai_run_id', '95000000-0000-4000-8000-000000000006',
    'parent_prompt_key', 'sec_s1_f1_analysis', 'form_family', 's1',
    'validation_status', 'validation_failed', 'diagnostic_candidate_only', true,
    'phase', 'diagnostic_candidate_rejected'
  )
);
select is(
  public.read_event_offering_monitor_canonical('95000000-0000-4000-8000-000000000002')->>'status',
  'not_ready',
  'MA2 pending or failed does not make stale canonical A visible'
);

insert into public.ai_runs (
  id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
  started_at, finished_at, usage, metadata
) values (
  '95000000-0000-4000-8000-000000000008',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000001',
  'offering_monitor_normalization_job', 'second_stage_direct_v8', 'fixture', 'completed',
  '2026-08-12 02:04:00+00', '2026-08-12 02:05:00+00', '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'purpose', 'offering_monitor_normalization',
    'execution_id', '95000000-0000-4000-8000-000000000008',
    'execution_contract_version', 'second_stage_direct_v8',
    'parent_primary_ai_run_id', '95000000-0000-4000-8000-000000000006',
    'parent_prompt_key', 'sec_s1_f1_analysis', 'form_family', 's1',
    'validation_status', 'success', 'diagnostic_candidate_only', true,
    'phase', 'diagnostic_candidate_saved'
  )
);
insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
select
  '95000000-0000-4000-8000-000000000008',
  '95000000-0000-4000-8000-000000000008',
  '95000000-0000-4000-8000-000000000002',
  'offering_monitor_normalization_candidate',
  pg_temp.phase5n_candidate(
    '95000000-0000-4000-8000-000000000008',
    '95000000-0000-4000-8000-000000000006',
    12000000, 16000000, 4000000
  );
select is(
  public.promote_event_offering_monitor_canonical(
    '95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000008',
    pg_temp.phase5n_candidate(
      '95000000-0000-4000-8000-000000000008',
      '95000000-0000-4000-8000-000000000006',
      12000000, 16000000, 4000000
    )
  )->>'status',
  'saved',
  'MA2 success atomically promotes canonical B'
);
select is(
  public.read_event_offering_monitor_canonical('95000000-0000-4000-8000-000000000002')#>>'{materialized_payload,total_potential_primary_share_exposure,value}',
  '20000000',
  'reader returns B stored total without recalculation or legacy fallback'
);
select is(
  (select source_execution_id from public.event_offering_monitor_canonical where event_id = '95000000-0000-4000-8000-000000000002'),
  '95000000-0000-4000-8000-000000000008'::uuid,
  'old MA cannot overwrite canonical B'
);
select is(
  public.read_event_offering_monitor_canonical('95000000-0000-4000-8000-000000000099')->>'reason',
  'event_or_current_raw_missing',
  'missing canonical reader fails closed without Primary/parser/terms fallback'
);

select * from finish();
rollback;
