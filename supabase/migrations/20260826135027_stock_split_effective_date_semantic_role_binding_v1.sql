-- Admit the V4 semantic-role-bound Stock Split contract without adding tables
-- or changing O/S arithmetic. The canonical JSONB retains the calculation
-- basis beside the exact effective-date evidence identity.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or v_execution.metadata->>'analyzer_contract_version' not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )
    or v_execution.prompt_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )$old$;
  v_new := $new$or v_execution.metadata->>'analyzer_contract_version' not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3',
      'corporate_action_stock_split_day_basis_evidence_v4'
    )
    or v_execution.prompt_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3',
      'corporate_action_stock_split_day_basis_evidence_v4'
    )$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v4_persistence_contract_source_unexpected';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or p_analyzer_contract_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )$old$;
  v_new := $new$or p_analyzer_contract_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3',
      'corporate_action_stock_split_day_basis_evidence_v4'
    )$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v4_current_reader_contract_source_unexpected';
  end if;

  -- A V4 attempt is the current semantic contract. Recheck it before either
  -- V3 or V1 fallback so pending/failed/incomplete V4 can never revive an
  -- older successful calculation date.
  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$  if p_analyzer_contract_version = 'corporate_action_reverse_split_analyzer_v1'
    and exists ($old$;
  v_new := $new$  if p_analyzer_contract_version in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )
    and exists (
      select 1
      from public.ai_runs as attempt_row
      where attempt_row.event_id = p_event_id
        and attempt_row.raw_item_id = v_event.raw_item_id
        and attempt_row.prompt_key = 'domain_monitor_child'
        and attempt_row.prompt_version = 'corporate_action_stock_split_day_basis_evidence_v4'
        and attempt_row.metadata->>'child_schema_version' = 'generic_monitor_child_execution_v1'
        and attempt_row.metadata->>'purpose' = 'domain_monitor_child'
        and attempt_row.metadata->>'monitor_analyzer_key' = 'corporate_action'
        and attempt_row.metadata->>'analyzer_contract_version' = 'corporate_action_stock_split_day_basis_evidence_v4'
        and attempt_row.metadata->>'parent_primary_ai_run_id' is not distinct from v_current_parent.id::text
        and attempt_row.metadata->>'parent_prompt_key' is not distinct from v_current_parent.prompt_key
        and attempt_row.metadata->>'parent_prompt_version' is not distinct from v_current_parent.prompt_version
        and attempt_row.metadata->>'source_family' = v_source_family
        and attempt_row.metadata->>'source_group' is not distinct from v_event.source_group::text
        and attempt_row.metadata->>'source_code' is not distinct from v_event.source_code
        and attempt_row.metadata->>'source_identity' is not distinct from v_raw.source_unique_id
        and attempt_row.metadata->>'event_id' is not distinct from p_event_id::text
        and attempt_row.metadata->>'raw_item_id' is not distinct from v_event.raw_item_id::text
    )
  then
    return pg_catalog.jsonb_build_object(
      'status', 'not_ready',
      'reason', 'current_contract_result_incomplete_or_failed'
    );
  end if;

  if p_analyzer_contract_version = 'corporate_action_reverse_split_analyzer_v1'
    and exists ($new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v4_fallback_boundary_source_unexpected';
  end if;

  -- The service-role persistence boundary rejects a V4 available date unless
  -- the LLM-bound calculation basis is one of the three narrow semantic roles.
  select pg_catalog.pg_get_functiondef(
    'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$  select parent_row.* into v_parent
  from public.ai_runs as parent_row$old$;
  v_new := $new$  if v_execution.prompt_version = 'corporate_action_stock_split_day_basis_evidence_v4'
    and v_applicable
    and (
      (v_facts#>>'{effective_date,availability}' = 'available'
        and (
          v_facts#>>'{effective_date,calculation_basis}' is null
          or v_facts#>>'{effective_date,calculation_basis}' not in (
            'split_effective',
            'shares_reclassified',
            'split_adjusted_trading'
          )
        ))
      or (v_facts#>>'{effective_date,availability}' = 'unavailable'
        and v_facts#>'{effective_date,calculation_basis}' is not null)
    )
  then
    return pg_catalog.jsonb_build_object(
      'status', 'rejected',
      'reason', 'calculation_effective_date_role_invalid'
    );
  end if;

  select parent_row.* into v_parent
  from public.ai_runs as parent_row$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v4_calculation_role_boundary_source_unexpected';
  end if;
end
$migration$;

comment on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb) is
  'Persists one validated stock-split result for an allowed analyzer contract after exact lineage, current-parent, and V4 calculation-date-role checks.';

comment on function public.read_current_event_corporate_action_facts(uuid, text) is
  'Service-role-only fail-closed reader for current Corporate Action facts under the V4, V3, or legacy analyzer contract.';
