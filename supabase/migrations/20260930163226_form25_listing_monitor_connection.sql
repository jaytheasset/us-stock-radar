-- Form25 deterministic source-backed child: existing typed tables, reader and permissions.
-- No Primary semantics, monitor policy, historical records or other families are rewritten.

CREATE OR REPLACE FUNCTION public.persist_listing_risk_analyzer_result(p_event_id uuid, p_source_execution_id uuid, p_expected_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_execution public.ai_runs%rowtype;
  v_parent public.ai_runs%rowtype;
  v_existing public.event_listing_risk_results%rowtype;
  v_current_parent_id uuid;
  v_parent_id uuid;
  v_logical_job_id uuid;
  v_parent_prompt_key text;
  v_parent_prompt_version text;
  v_source_family text;
  v_result_status text;
  v_expected_terminal_state text;
  v_facts jsonb;
  v_parent_output_type text;
begin
  if p_event_id is null
    or p_source_execution_id is null
    or pg_catalog.jsonb_typeof(p_expected_result) <> 'object'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  v_result_status := p_expected_result->>'status';
  if v_result_status = 'applicable' then
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_expected_result)) <> 2
      or pg_catalog.jsonb_typeof(p_expected_result->'facts') <> 'object'
      or p_expected_result#>>'{facts,version}' not in (
        'listing_risk_event_facts_v1',
        'listing_risk_event_facts_v2'
      )
    then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_shape_invalid');
    end if;
    v_expected_terminal_state := 'succeeded_applicable';
    v_facts := p_expected_result->'facts';
  elsif v_result_status = 'not_applicable' then
    if p_expected_result <> '{"status":"not_applicable"}'::jsonb then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_shape_invalid');
    end if;
    v_expected_terminal_state := 'succeeded_not_applicable';
    v_facts := null;
  else
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_status_invalid');
  end if;

  -- The event lock serializes current-parent acceptance against new event-linked
  -- Primary runs and stabilizes its current raw lineage for this transaction.
  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id
  for update of event_row;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_current_raw_missing');
  end if;

  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = v_event.raw_item_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'current_raw_missing');
  end if;

  select run_row.* into v_execution
  from public.ai_runs as run_row
  where run_row.id = p_source_execution_id
  for update of run_row;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_execution_missing');
  end if;

  v_parent_id := nullif(pg_catalog.btrim(v_execution.metadata->>'parent_primary_ai_run_id'), '')::uuid;
  v_logical_job_id := nullif(pg_catalog.btrim(v_execution.metadata->>'logical_job_id'), '')::uuid;
  v_parent_prompt_key := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_key');
  v_parent_prompt_version := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_version');
  v_source_family := pg_catalog.btrim(v_execution.metadata->>'source_family');

  if v_execution.prompt_version not in (
    'listing_risk_domain_analyzer_v2',
    'listing_risk_domain_analyzer_v3',
    'listing_risk_domain_analyzer_v4',
    'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7',
    'listing_risk_domain_analyzer_v8',
    'listing_risk_domain_analyzer_v9',
    'listing_risk_domain_analyzer_v10',
    'listing_risk_domain_analyzer_v11',
    'listing_risk_form25_state_v1'
  ) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'unsupported_analyzer_contract_version');
  end if;
  if v_result_status = 'applicable' and p_expected_result#>>'{facts,version}' is distinct from (case
    when v_execution.prompt_version in (
      'listing_risk_domain_analyzer_v2',
      'listing_risk_domain_analyzer_v3',
      'listing_risk_domain_analyzer_v4'
    )
      then 'listing_risk_event_facts_v1'
    when v_execution.prompt_version in (
      'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7',
      'listing_risk_domain_analyzer_v8',
      'listing_risk_domain_analyzer_v9',
      'listing_risk_domain_analyzer_v10',
      'listing_risk_domain_analyzer_v11',
    'listing_risk_form25_state_v1'
    )
      then 'listing_risk_event_facts_v2'
    else null
  end) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'analyzer_fact_schema_version_mismatch');
  end if;

  if v_execution.prompt_key <> 'domain_monitor_child'
    or v_execution.event_id is distinct from p_event_id
    or v_execution.raw_item_id is distinct from v_event.raw_item_id
    or v_execution.metadata->>'child_schema_version' <> 'generic_monitor_child_execution_v1'
    or v_execution.metadata->>'purpose' <> 'domain_monitor_child'
    or v_execution.metadata->>'execution_id' is distinct from p_source_execution_id::text
    or v_execution.metadata->>'monitor_analyzer_key' <> 'listing_risk'
    or v_execution.metadata->>'analyzer_contract_version' is distinct from v_execution.prompt_version
    or v_execution.metadata->>'event_id' is distinct from p_event_id::text
    or v_execution.metadata->>'raw_item_id' is distinct from v_event.raw_item_id::text
    or v_execution.metadata->>'source_group' is distinct from v_event.source_group::text
    or v_execution.metadata->>'source_code' is distinct from v_event.source_code
    or v_execution.metadata->>'source_identity' is distinct from v_raw.source_unique_id
    or v_parent_id is null
    or v_logical_job_id is null
    or not (
      (
        v_execution.status in ('pending', 'running')
        and v_execution.metadata->>'execution_state' in ('reserved', 'running')
      )
      or (
        v_execution.status = 'completed'
        and v_execution.metadata->>'execution_state' = v_expected_terminal_state
      )
    )
    or not (
      (v_source_family = 'news'
        and v_event.source_group::text = 'news'
        and v_event.source_code <> 'nasdaq_corporate_actions'
        and v_parent_prompt_key = 'news_event_analysis')
      or (v_source_family = 'nasdaq_corporate_actions'
        and v_event.source_group::text = 'news'
        and v_event.source_code = 'nasdaq_corporate_actions'
        and v_parent_prompt_key = 'nasdaq_corporate_action_analysis')
      or (v_source_family = 'sec_form25'
        and v_event.source_group::text = 'filings' and v_event.source_code = 'sec_edgar'
        and v_raw.raw_payload->>'form_type' in ('25','25-NSE','25/A','25-NSE/A')
        and v_parent_prompt_key = 'sec_form25_analysis_draft'
        and v_execution.prompt_version = 'listing_risk_form25_state_v1')
      or (v_source_family = 'sec_8k_6k'
        and v_event.source_group::text = 'filings'
        and v_event.source_code = 'sec_edgar'
        and v_parent_prompt_key in (
          'sec_8k_6k_analysis_listing_financial_risk',
          'sec_8k_6k_analysis_financing_dilution_capital_structure',
          'sec_8k_6k_analysis_strategic_transaction',
          'sec_8k_6k_analysis_governance_vote_leadership',
          'sec_8k_6k_analysis_operating_legal_routine'
        ))
    )
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_execution_lineage_invalid');
  end if;

  if (v_execution.prompt_version='listing_risk_form25_state_v1') is distinct from (v_source_family='sec_form25') then
    return pg_catalog.jsonb_build_object('status','rejected','reason','form25_contract_family_mismatch');
  end if;
  if v_source_family='sec_form25' and (
    (select count(*) from public.ai_outputs t where t.ai_run_id=v_execution.id and t.output_type='form25_listing_state')<>1
    or not exists (select 1 from public.ai_outputs t where t.ai_run_id=v_execution.id and t.event_id=p_event_id and t.output_type='form25_listing_state'
      and t.payload->>'version'='listing_risk_form25_state_v1' and t.payload->'result'=p_expected_result
      and (t.payload#>'{source_snapshot,raw_payload}')=v_raw.raw_payload
      and t.payload#>>'{source_snapshot,source_code}'=v_raw.source_code
      and t.payload#>>'{source_snapshot,source_unique_id}'=v_raw.source_unique_id
      and t.payload#>>'{source_snapshot,source_url}'=v_raw.source_url
      and (t.payload#>>'{source_snapshot,published_at}')::timestamptz=v_raw.published_at)
  ) then
    return pg_catalog.jsonb_build_object('status','rejected','reason','form25_source_or_state_trace_mismatch');
  end if;

  if v_result_status = 'applicable' and (
    pg_catalog.jsonb_typeof(v_facts->'sources') <> 'array'
    or pg_catalog.jsonb_array_length(v_facts->'sources') = 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_facts->'sources') as source_row(value)
      where pg_catalog.jsonb_typeof(source_row.value) <> 'object'
        or source_row.value->>'source_family' is distinct from case v_source_family
          when 'news' then 'news'
          when 'nasdaq_corporate_actions' then 'nasdaq'
          when 'sec_8k_6k' then 'sec'
          when 'sec_form25' then 'sec'
          else null
        end
        or source_row.value->>'source_id' is distinct from v_raw.source_unique_id
        or (source_row.value->>'source_url' is distinct from v_raw.source_url
          and not (v_source_family = 'sec_form25' and exists (
            select 1 from pg_catalog.jsonb_array_elements(v_raw.raw_payload#>'{form25_source,documents}') d
            where d->>'url'=source_row.value->>'source_url'
          )))
    )
  ) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'facts_source_identity_invalid');
  end if;

  select parent_row.* into v_parent
  from public.ai_runs as parent_row
  where parent_row.id = v_parent_id;
  if not found
    or v_parent.status <> 'completed'
    or v_parent.event_id is distinct from p_event_id
    or v_parent.raw_item_id is distinct from v_event.raw_item_id
    or v_parent.prompt_key is distinct from v_parent_prompt_key
    or v_parent.prompt_version is distinct from v_parent_prompt_version
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exact_parent_lineage_invalid');
  end if;

  v_parent_output_type := case
    when v_source_family in ('sec_8k_6k','sec_form25') then v_parent_prompt_key
    else 'news_event_analysis'
  end;
  if (
    select pg_catalog.count(*)
    from public.ai_outputs as output_row
    where output_row.ai_run_id = v_parent_id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
  ) <> 1 or not exists (
    select 1
    from public.ai_outputs as output_row
    where output_row.ai_run_id = v_parent_id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
      and (v_source_family = 'sec_form25' and pg_catalog.jsonb_typeof(output_row.payload->'analysis')='object'
        or (pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'listing_risk'
      )))
  ) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exact_parent_output_or_route_invalid');
  end if;

  select current_parent.id into v_current_parent_id
  from public.ai_runs as current_parent
  where current_parent.event_id = p_event_id
    and current_parent.raw_item_id = v_event.raw_item_id
    and current_parent.status = 'completed'
    and (
      (v_source_family = 'news' and current_parent.prompt_key = 'news_event_analysis')
      or (v_source_family = 'nasdaq_corporate_actions' and current_parent.prompt_key = 'nasdaq_corporate_action_analysis')
      or (v_source_family = 'sec_form25' and current_parent.prompt_key = 'sec_form25_analysis_draft')
      or (v_source_family = 'sec_8k_6k' and current_parent.prompt_key in (
        'sec_8k_6k_analysis_listing_financial_risk',
        'sec_8k_6k_analysis_financing_dilution_capital_structure',
        'sec_8k_6k_analysis_strategic_transaction',
        'sec_8k_6k_analysis_governance_vote_leadership',
        'sec_8k_6k_analysis_operating_legal_routine'
      ))
    )
  order by current_parent.finished_at desc nulls last,
    current_parent.started_at desc nulls last,
    current_parent.id desc
  limit 1;
  if v_current_parent_id is null or v_current_parent_id is distinct from v_parent_id then
    return pg_catalog.jsonb_build_object('status', 'stale', 'reason', 'parent_not_current');
  end if;

  select result_row.* into v_existing
  from public.event_listing_risk_results as result_row
  where result_row.source_execution_id = p_source_execution_id
  for update of result_row;
  if found then
    if v_existing.validated_result_payload is distinct from p_expected_result then
      return pg_catalog.jsonb_build_object('status', 'conflict', 'reason', 'same_execution_different_payload');
    end if;
    if v_result_status = 'applicable' and not exists (
      select 1 from public.event_listing_risk_facts as fact_row
      where fact_row.source_execution_id = p_source_execution_id
        and fact_row.facts_payload = v_facts
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'applicable_fact_row_missing_or_mismatched');
    end if;
    if v_result_status = 'not_applicable' and exists (
      select 1 from public.event_listing_risk_facts as fact_row
      where fact_row.source_execution_id = p_source_execution_id
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'not_applicable_has_fact_row');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'result_status', v_result_status,
      'event_id', p_event_id,
      'source_execution_id', p_source_execution_id
    );
  end if;

  -- A terminal success without an already persisted result proves the caller
  -- violated the required ordering. Never backfill facts after the execution
  -- has claimed semantic success.
  if v_execution.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'status', 'rejected',
      'reason', 'terminal_success_without_prior_persistence'
    );
  end if;

  insert into public.event_listing_risk_results (
    source_execution_id,
    event_id,
    raw_item_id,
    parent_primary_ai_run_id,
    logical_job_id,
    source_execution_kind,
    monitor_analyzer_key,
    analyzer_contract_version,
    result_status,
    validated_result_payload,
    persisted_at
  ) values (
    p_source_execution_id,
    p_event_id,
    v_event.raw_item_id,
    v_parent_id,
    v_logical_job_id,
    'generic_monitor_child',
    'listing_risk',
    v_execution.prompt_version,
    v_result_status,
    p_expected_result,
    v_now
  );

  if v_result_status = 'applicable' then
    insert into public.event_listing_risk_facts (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      result_status,
      fact_schema_version,
      facts_payload,
      event_kind,
      event_outcome,
      classification_source_ref,
      exchange,
      affected_security_title,
      affected_security_ticker,
      affected_security_basis,
      listing_rule,
      listing_requirement,
      compliance_period,
      proceeding_kind,
      proceeding_status,
      notice_date,
      compliance_deadline,
      hearing_date,
      appeal_deadline,
      trading_suspension_date,
      removal_effective_date,
      continued_trading,
      continued_trading_venue,
      fact_as_of,
      confidence,
      sources,
      persisted_at
    ) values (
      p_source_execution_id,
      p_event_id,
      v_event.raw_item_id,
      v_parent_id,
      v_logical_job_id,
      'listing_risk',
      v_execution.prompt_version,
      'applicable',
      v_facts->>'version',
      v_facts,
      v_facts#>>'{classification,event_kind}',
      v_facts#>>'{classification,event_outcome}',
      v_facts#>>'{classification,source_ref}',
      v_facts#>>'{exchange,value}',
      v_facts#>>'{affected_security,title,value}',
      v_facts#>>'{affected_security,ticker,value}',
      v_facts#>>'{affected_security,security_basis,value}',
      v_facts#>>'{listing_rule,value}',
      v_facts#>>'{listing_requirement,value}',
      v_facts#>>'{compliance_period,value}',
      v_facts#>>'{proceeding,kind}',
      v_facts#>>'{proceeding,status}',
      nullif(v_facts#>>'{dates,notice_date,value}', '')::date,
      nullif(v_facts#>>'{dates,compliance_deadline,value}', '')::date,
      nullif(v_facts#>>'{dates,hearing_date,value}', '')::date,
      nullif(v_facts#>>'{dates,appeal_deadline,value}', '')::date,
      nullif(v_facts#>>'{dates,trading_suspension_date,value}', '')::date,
      nullif(v_facts#>>'{dates,removal_effective_date,value}', '')::date,
      nullif(v_facts#>>'{continued_trading,continues,value}', '')::boolean,
      v_facts#>>'{continued_trading,venue,value}',
      nullif(v_facts#>>'{as_of,value}', '')::date,
      v_facts->>'confidence',
      v_facts->'sources',
      v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'result_status', v_result_status,
    'event_id', p_event_id,
    'source_execution_id', p_source_execution_id,
    'parent_primary_ai_run_id', v_parent_id
  );
exception
  when invalid_text_representation or datetime_field_overflow or check_violation or foreign_key_violation then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_scalar_or_lineage_invalid');
end
$function$
;

CREATE OR REPLACE FUNCTION public.read_current_event_listing_risk_facts(p_event_id uuid, p_analyzer_contract_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_current_parent public.ai_runs%rowtype;
  v_child public.ai_runs%rowtype;
  v_result public.event_listing_risk_results%rowtype;
  v_facts public.event_listing_risk_facts%rowtype;
  v_source_family text;
  v_parent_output_type text;
  v_expected_result_status text;
begin
  if p_event_id is null
    or p_analyzer_contract_version is null
    or pg_catalog.btrim(p_analyzer_contract_version) = ''
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'invalid_arguments');
  end if;

  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'event_or_current_raw_missing');
  end if;

  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = v_event.raw_item_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_raw_missing');
  end if;

  v_source_family := case
    when v_event.source_group::text = 'news' and v_event.source_code = 'nasdaq_corporate_actions'
      then 'nasdaq_corporate_actions'
    when v_event.source_group::text = 'news'
      then 'news'
    when v_event.source_group::text='filings' and v_event.source_code='sec_edgar'
      and v_raw.raw_payload->>'form_type' in ('25','25-NSE','25/A','25-NSE/A') then 'sec_form25'
    when v_event.source_group::text = 'filings' and v_event.source_code = 'sec_edgar'
      then 'sec_8k_6k'
    else null
  end;
  if v_source_family is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'unsupported_source_family');
  end if;

  if v_source_family='sec_form25' then p_analyzer_contract_version := 'listing_risk_form25_state_v1'; end if;

  select parent_row.* into v_current_parent
  from public.ai_runs as parent_row
  where parent_row.event_id = p_event_id
    and parent_row.raw_item_id = v_event.raw_item_id
    and parent_row.status = 'completed'
    and (
      (v_source_family = 'news' and parent_row.prompt_key = 'news_event_analysis')
      or (v_source_family = 'nasdaq_corporate_actions' and parent_row.prompt_key = 'nasdaq_corporate_action_analysis')
      or (v_source_family = 'sec_form25' and parent_row.prompt_key = 'sec_form25_analysis_draft')
      or (v_source_family = 'sec_8k_6k' and parent_row.prompt_key in (
        'sec_8k_6k_analysis_listing_financial_risk',
        'sec_8k_6k_analysis_financing_dilution_capital_structure',
        'sec_8k_6k_analysis_strategic_transaction',
        'sec_8k_6k_analysis_governance_vote_leadership',
        'sec_8k_6k_analysis_operating_legal_routine'
      ))
    )
  order by parent_row.finished_at desc nulls last,
    parent_row.started_at desc nulls last,
    parent_row.id desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_primary_missing');
  end if;

  v_parent_output_type := case
    when v_source_family in ('sec_8k_6k','sec_form25') then v_current_parent.prompt_key
    else 'news_event_analysis'
  end;
  if (
    select pg_catalog.count(*)
    from public.ai_outputs as output_row
    where output_row.ai_run_id = v_current_parent.id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
  ) <> 1 or not exists (
    select 1
    from public.ai_outputs as output_row
    where output_row.ai_run_id = v_current_parent.id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
      and (v_source_family = 'sec_form25' and pg_catalog.jsonb_typeof(output_row.payload->'analysis')='object'
        or (pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'listing_risk'
      )))
  ) then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_primary_output_or_route_invalid');
  end if;

  -- Select the newest terminal semantic success first, even if persistence is
  -- absent. This prevents an older persisted result from becoming a fallback.
  select child_row.* into v_child
  from public.ai_runs as child_row
  where child_row.event_id = p_event_id
    and child_row.raw_item_id = v_event.raw_item_id
    and child_row.prompt_key = 'domain_monitor_child'
    and child_row.prompt_version = p_analyzer_contract_version
    and child_row.status = 'completed'
    and child_row.metadata->>'child_schema_version' = 'generic_monitor_child_execution_v1'
    and child_row.metadata->>'purpose' = 'domain_monitor_child'
    and child_row.metadata->>'execution_id' is not distinct from child_row.id::text
    and child_row.metadata->>'monitor_analyzer_key' = 'listing_risk'
    and child_row.metadata->>'analyzer_contract_version' = p_analyzer_contract_version
    and child_row.metadata->>'parent_primary_ai_run_id' is not distinct from v_current_parent.id::text
    and child_row.metadata->>'parent_prompt_key' is not distinct from v_current_parent.prompt_key
    and child_row.metadata->>'parent_prompt_version' is not distinct from v_current_parent.prompt_version
    and child_row.metadata->>'source_family' = v_source_family
    and child_row.metadata->>'source_group' is not distinct from v_event.source_group::text
    and child_row.metadata->>'source_code' is not distinct from v_event.source_code
    and child_row.metadata->>'source_identity' is not distinct from v_raw.source_unique_id
    and child_row.metadata->>'event_id' is not distinct from p_event_id::text
    and child_row.metadata->>'raw_item_id' is not distinct from v_event.raw_item_id::text
    and child_row.metadata->>'execution_state' in ('succeeded_applicable', 'succeeded_not_applicable')
    and (
      select pg_catalog.count(*)
      from public.ai_outputs as output_row
      where output_row.ai_run_id = child_row.id
        and output_row.event_id = p_event_id
        and output_row.output_type = 'domain_monitor_child_execution_result'
    ) = 1
    and exists (
      select 1
      from public.ai_outputs as output_row
      where output_row.ai_run_id = child_row.id
        and output_row.event_id = p_event_id
        and output_row.output_type = 'domain_monitor_child_execution_result'
        and output_row.payload->>'schema_version' = 'generic_monitor_child_execution_result_v1'
        and output_row.payload->>'execution_id' is not distinct from child_row.id::text
        and output_row.payload->>'parent_primary_ai_run_id' is not distinct from v_current_parent.id::text
        and output_row.payload->>'monitor_analyzer_key' = 'listing_risk'
        and output_row.payload->>'analyzer_contract_version' = p_analyzer_contract_version
        and output_row.payload->>'result_classification' is not distinct from child_row.metadata->>'execution_state'
    )
  order by child_row.finished_at desc nulls last,
    child_row.started_at desc nulls last,
    child_row.id desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_successful_result_missing');
  end if;

  v_expected_result_status := case v_child.metadata->>'execution_state'
    when 'succeeded_applicable' then 'applicable'
    when 'succeeded_not_applicable' then 'not_applicable'
    else null
  end;

  select result_row.* into v_result
  from public.event_listing_risk_results as result_row
  where result_row.source_execution_id = v_child.id;
  if not found
    or v_result.event_id is distinct from p_event_id
    or v_result.raw_item_id is distinct from v_event.raw_item_id
    or v_result.parent_primary_ai_run_id is distinct from v_current_parent.id
    or v_result.logical_job_id::text is distinct from v_child.metadata->>'logical_job_id'
    or v_result.source_execution_kind <> 'generic_monitor_child'
    or v_result.monitor_analyzer_key <> 'listing_risk'
    or v_result.analyzer_contract_version <> p_analyzer_contract_version
    or v_result.result_status is distinct from v_expected_result_status
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_result_not_persisted_or_mismatched');
  end if;

  if v_source_family='sec_form25' and (
    (select count(*) from public.ai_outputs t where t.ai_run_id=v_child.id and t.output_type='form25_listing_state')<>1
    or not exists (select 1 from public.ai_outputs t where t.ai_run_id=v_child.id and t.event_id=p_event_id and t.output_type='form25_listing_state'
      and t.payload->>'version'='listing_risk_form25_state_v1' and t.payload->'result'=v_result.validated_result_payload
      and (t.payload#>'{source_snapshot,raw_payload}')=v_raw.raw_payload
      and t.payload#>>'{source_snapshot,source_code}'=v_raw.source_code
      and t.payload#>>'{source_snapshot,source_unique_id}'=v_raw.source_unique_id
      and t.payload#>>'{source_snapshot,source_url}'=v_raw.source_url
      and (t.payload#>>'{source_snapshot,published_at}')::timestamptz=v_raw.published_at)
  ) then return pg_catalog.jsonb_build_object('status','not_ready','reason','form25_source_or_state_trace_mismatch'); end if;

  if v_result.result_status = 'not_applicable' then
    if exists (
      select 1 from public.event_listing_risk_facts as fact_row
      where fact_row.source_execution_id = v_child.id
    ) then
      return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'not_applicable_has_fact_row');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'not_applicable',
      'event_id', p_event_id,
      'raw_item_id', v_event.raw_item_id,
      'parent_primary_ai_run_id', v_current_parent.id,
      'source_execution_id', v_child.id,
      'monitor_analyzer_key', 'listing_risk',
      'analyzer_contract_version', p_analyzer_contract_version,
      'persisted_at', v_result.persisted_at,
      'form25_state', (select t.payload->'state' from public.ai_outputs t where v_source_family='sec_form25' and t.ai_run_id=v_child.id and t.output_type='form25_listing_state' limit 1)
    );
  end if;

  select fact_row.* into v_facts
  from public.event_listing_risk_facts as fact_row
  where fact_row.source_execution_id = v_child.id;
  if not found
    or v_facts.event_id is distinct from p_event_id
    or v_facts.raw_item_id is distinct from v_event.raw_item_id
    or v_facts.parent_primary_ai_run_id is distinct from v_current_parent.id
    or v_facts.logical_job_id is distinct from v_result.logical_job_id
    or v_facts.monitor_analyzer_key <> 'listing_risk'
    or v_facts.analyzer_contract_version <> p_analyzer_contract_version
    or v_facts.result_status <> 'applicable'
    or v_facts.fact_schema_version <> (case p_analyzer_contract_version
      when 'listing_risk_domain_analyzer_v2' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v3' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v4' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v5' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v6' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v7' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v8' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v9' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v10' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v11' then 'listing_risk_event_facts_v2'
      when 'listing_risk_form25_state_v1' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'
    end)
    or v_facts.facts_payload is distinct from v_result.validated_result_payload->'facts'
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_applicable_facts_missing_or_mismatched');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'event_id', p_event_id,
    'raw_item_id', v_event.raw_item_id,
    'parent_primary_ai_run_id', v_current_parent.id,
    'source_execution_id', v_child.id,
    'monitor_analyzer_key', 'listing_risk',
    'analyzer_contract_version', p_analyzer_contract_version,
    'fact_schema_version', v_facts.fact_schema_version,
    'facts', v_facts.facts_payload,
    'persisted_at', v_facts.persisted_at,
    'form25_state', (select t.payload->'state' from public.ai_outputs t where v_source_family='sec_form25' and t.ai_run_id=v_child.id and t.output_type='form25_listing_state' limit 1)
  );
end
$function$
;
NOTIFY pgrst, 'reload schema';
