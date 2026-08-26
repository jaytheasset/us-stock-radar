-- Admit the V3 Stock Split day-basis/evidence analyzer contract through the
-- existing lineage-locked persistence and current-reader functions. The
-- canonical JSONB payload already retains evidence identities and activation
-- data byte-for-byte, so no table or arithmetic schema change is required.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or v_execution.metadata->>'analyzer_contract_version' <> 'corporate_action_reverse_split_analyzer_v1'
    or v_execution.prompt_version <> 'corporate_action_reverse_split_analyzer_v1'$old$;
  v_new := $new$or v_execution.metadata->>'analyzer_contract_version' not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )
    or v_execution.prompt_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v3_persistence_contract_source_unexpected';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or p_analyzer_contract_version <> 'corporate_action_reverse_split_analyzer_v1'$old$;
  v_new := $new$or p_analyzer_contract_version not in (
      'corporate_action_reverse_split_analyzer_v1',
      'corporate_action_stock_split_day_basis_evidence_v3'
    )$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v3_current_reader_contract_source_unexpected';
  end if;

  -- Recheck V3 at the legacy-reader boundary as well. This closes the race in
  -- which V3 was absent on the application's first read but started before its
  -- V1 fallback read.
  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$  select child_row.* into v_child
  from public.ai_runs as child_row$old$;
  v_new := $new$  if p_analyzer_contract_version = 'corporate_action_reverse_split_analyzer_v1'
    and exists (
      select 1
      from public.ai_runs as attempt_row
      where attempt_row.event_id = p_event_id
        and attempt_row.raw_item_id = v_event.raw_item_id
        and attempt_row.prompt_key = 'domain_monitor_child'
        and attempt_row.prompt_version = 'corporate_action_stock_split_day_basis_evidence_v3'
        and attempt_row.metadata->>'child_schema_version' = 'generic_monitor_child_execution_v1'
        and attempt_row.metadata->>'purpose' = 'domain_monitor_child'
        and attempt_row.metadata->>'monitor_analyzer_key' = 'corporate_action'
        and attempt_row.metadata->>'analyzer_contract_version' = 'corporate_action_stock_split_day_basis_evidence_v3'
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

  select child_row.* into v_child
  from public.ai_runs as child_row$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v3_legacy_fallback_boundary_source_unexpected';
  end if;

  -- A missing V3 success permits a legacy read only when no exact-current V3
  -- child has started. Any pending, failed, stale, malformed, or unpersisted
  -- current-lineage V3 attempt is a fail-closed boundary, not "V3 absent".
  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_successful_result_missing');
  end if;$old$;
  v_new := $new$if not found then
    if exists (
      select 1
      from public.ai_runs as attempt_row
      where attempt_row.event_id = p_event_id
        and attempt_row.raw_item_id = v_event.raw_item_id
        and attempt_row.prompt_key = 'domain_monitor_child'
        and attempt_row.prompt_version = p_analyzer_contract_version
        and attempt_row.metadata->>'child_schema_version' = 'generic_monitor_child_execution_v1'
        and attempt_row.metadata->>'purpose' = 'domain_monitor_child'
        and attempt_row.metadata->>'monitor_analyzer_key' = 'corporate_action'
        and attempt_row.metadata->>'analyzer_contract_version' = p_analyzer_contract_version
        and attempt_row.metadata->>'parent_primary_ai_run_id' is not distinct from v_current_parent.id::text
        and attempt_row.metadata->>'parent_prompt_key' is not distinct from v_current_parent.prompt_key
        and attempt_row.metadata->>'parent_prompt_version' is not distinct from v_current_parent.prompt_version
        and attempt_row.metadata->>'source_family' = v_source_family
        and attempt_row.metadata->>'source_group' is not distinct from v_event.source_group::text
        and attempt_row.metadata->>'source_code' is not distinct from v_event.source_code
        and attempt_row.metadata->>'source_identity' is not distinct from v_raw.source_unique_id
        and attempt_row.metadata->>'event_id' is not distinct from p_event_id::text
        and attempt_row.metadata->>'raw_item_id' is not distinct from v_event.raw_item_id::text
    ) then
      return pg_catalog.jsonb_build_object(
        'status', 'not_ready',
        'reason', 'current_contract_result_incomplete_or_failed'
      );
    end if;
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_successful_result_missing');
  end if;$new$;
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif pg_catalog.strpos(v_definition, v_new) = 0 then
    raise exception 'corporate_action_v3_current_attempt_boundary_source_unexpected';
  end if;
end
$migration$;

comment on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb) is
  'Persists one validated stock-split result for an allowed analyzer contract after exact Generic Monitor lineage and current-parent checks.';

comment on function public.read_current_event_corporate_action_facts(uuid, text) is
  'Service-role-only fail-closed reader for current Corporate Action facts under an allowed analyzer contract.';
