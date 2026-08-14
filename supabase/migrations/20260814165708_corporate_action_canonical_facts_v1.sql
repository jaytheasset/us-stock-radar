-- Corporate Action Canonical Fact Foundation V1: reverse split only.
-- One exact Generic Monitor child execution owns one immutable applicable or
-- not-applicable result. Parser, calendar, Primary display fields, and older
-- unrelated AI runs are never persistence or reader fallbacks.

create table public.event_corporate_action_results (
  source_execution_id uuid primary key references public.ai_runs(id),
  event_id uuid not null references public.events(id) on delete cascade,
  raw_item_id uuid not null references public.raw_items(id),
  parent_primary_ai_run_id uuid not null references public.ai_runs(id),
  logical_job_id uuid not null,
  source_execution_kind text not null,
  monitor_analyzer_key text not null,
  analyzer_contract_version text not null,
  applicable boolean not null,
  validated_result_payload jsonb not null,
  persisted_at timestamptz not null default pg_catalog.now(),
  constraint event_corporate_action_results_execution_kind_check
    check (source_execution_kind = 'generic_monitor_child'),
  constraint event_corporate_action_results_analyzer_key_check
    check (monitor_analyzer_key = 'corporate_action'),
  constraint event_corporate_action_results_contract_version_check
    check (
      analyzer_contract_version = pg_catalog.btrim(analyzer_contract_version)
      and pg_catalog.length(analyzer_contract_version) between 1 and 120
    ),
  constraint event_corporate_action_results_payload_check
    check (
      pg_catalog.jsonb_typeof(validated_result_payload) = 'object'
      and (validated_result_payload->>'applicable')::boolean = applicable
      and (
        (
          applicable
          and pg_catalog.jsonb_typeof(validated_result_payload->'facts') = 'object'
          and validated_result_payload = pg_catalog.jsonb_build_object(
            'applicable', true,
            'facts', validated_result_payload->'facts'
          )
        )
        or (
          not applicable
          and validated_result_payload = '{"applicable":false}'::jsonb
        )
      )
    ),
  constraint event_corporate_action_results_exact_lineage_key
    unique (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      applicable
    )
);

create index event_corporate_action_results_current_reader_idx
  on public.event_corporate_action_results (
    event_id,
    raw_item_id,
    parent_primary_ai_run_id,
    monitor_analyzer_key,
    analyzer_contract_version
  );

create table public.event_corporate_action_facts (
  source_execution_id uuid primary key,
  event_id uuid not null,
  raw_item_id uuid not null,
  parent_primary_ai_run_id uuid not null,
  logical_job_id uuid not null,
  monitor_analyzer_key text not null,
  analyzer_contract_version text not null,
  applicable boolean not null default true,
  fact_schema_version text not null,
  facts_payload jsonb not null,
  event_kind text not null,
  action_stage text not null,
  effective_date date,
  old_shares_per_new_share numeric,
  source_ref text not null,
  evidence jsonb not null,
  confidence text not null,
  fact_as_of date,
  source_family text not null,
  source_id text not null,
  source_url text,
  persisted_at timestamptz not null default pg_catalog.now(),
  constraint event_corporate_action_facts_applicable_check check (applicable),
  constraint event_corporate_action_facts_schema_version_check
    check (fact_schema_version = 'corporate_action_reverse_split_facts_v1'),
  constraint event_corporate_action_facts_event_kind_check
    check (event_kind = 'reverse_split'),
  constraint event_corporate_action_facts_stage_check
    check (action_stage in (
      'announced', 'board_approved', 'shareholder_approved',
      'scheduled', 'effective', 'unknown'
    )),
  constraint event_corporate_action_facts_ratio_check
    check (old_shares_per_new_share is null or old_shares_per_new_share > 0),
  constraint event_corporate_action_facts_source_ref_check
    check (
      source_ref = pg_catalog.btrim(source_ref)
      and source_ref ~ '^[A-Za-z0-9._:-]{1,160}$'
    ),
  constraint event_corporate_action_facts_confidence_check
    check (confidence in ('high', 'medium', 'low')),
  constraint event_corporate_action_facts_source_family_check
    check (source_family in ('nasdaq', 'news', 'sec')),
  constraint event_corporate_action_facts_payload_shape_check
    check (
      pg_catalog.jsonb_typeof(facts_payload) = 'object'
      and facts_payload->>'version' = fact_schema_version
      and facts_payload->>'event_kind' = 'reverse_split'
      and facts_payload->>'action_stage' = action_stage
      and facts_payload->>'source_ref' = source_ref
      and facts_payload->>'confidence' = confidence
      and pg_catalog.jsonb_typeof(facts_payload->'effective_date') = 'object'
      and pg_catalog.jsonb_typeof(facts_payload#>'{ratio,old_shares_per_new_share}') = 'object'
      and pg_catalog.jsonb_typeof(facts_payload->'evidence') = 'object'
      and pg_catalog.jsonb_typeof(facts_payload->'as_of') = 'object'
      and pg_catalog.jsonb_typeof(facts_payload->'source') = 'object'
    ),
  constraint event_corporate_action_facts_materialization_check
    check (
      effective_date is not distinct from
        case when facts_payload#>>'{effective_date,availability}' = 'available'
          then (facts_payload#>>'{effective_date,value}')::date else null end
      and old_shares_per_new_share is not distinct from
        case when facts_payload#>>'{ratio,old_shares_per_new_share,availability}' = 'available'
          then (facts_payload#>>'{ratio,old_shares_per_new_share,value}')::numeric else null end
      and evidence = facts_payload->'evidence'
      and fact_as_of is not distinct from
        case when facts_payload#>>'{as_of,availability}' = 'available'
          then (facts_payload#>>'{as_of,value}')::date else null end
      and source_family = facts_payload#>>'{source,source_family}'
      and source_id = facts_payload#>>'{source,source_id}'
      and source_url is not distinct from facts_payload#>>'{source,source_url}'
    ),
  constraint event_corporate_action_facts_exact_result_fkey
    foreign key (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      applicable
    ) references public.event_corporate_action_results (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      applicable
    ) on delete cascade
);

create index event_corporate_action_facts_parent_idx
  on public.event_corporate_action_facts (parent_primary_ai_run_id);

alter table public.event_corporate_action_results enable row level security;
alter table public.event_corporate_action_facts enable row level security;

-- These are server-only history tables. The explicit revokes are intentional:
-- neither anon/authenticated nor direct service-role Data API access is part of
-- the contract. The two reviewed RPCs below are the only exposed boundary.
revoke all on table public.event_corporate_action_results
  from public, anon, authenticated, service_role;
revoke all on table public.event_corporate_action_facts
  from public, anon, authenticated, service_role;

comment on table public.event_corporate_action_results is
  'Server-only immutable semantic result history for exact Corporate Action Generic Monitor executions.';
comment on table public.event_corporate_action_facts is
  'Server-only reverse-split canonical facts for applicable exact executions.';

create or replace function public.persist_corporate_action_analyzer_result(
  p_event_id uuid,
  p_source_execution_id uuid,
  p_expected_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_execution public.ai_runs%rowtype;
  v_parent public.ai_runs%rowtype;
  v_existing public.event_corporate_action_results%rowtype;
  v_current_parent_id uuid;
  v_parent_id uuid;
  v_logical_job_id uuid;
  v_parent_prompt_key text;
  v_parent_prompt_version text;
  v_source_family text;
  v_expected_terminal_state text;
  v_parent_output_type text;
  v_applicable boolean;
  v_facts jsonb;
begin
  if p_event_id is null
    or p_source_execution_id is null
    or pg_catalog.jsonb_typeof(p_expected_result) <> 'object'
    or not (p_expected_result ? 'applicable')
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  if p_expected_result->'applicable' = 'true'::jsonb then
    v_applicable := true;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_expected_result)) <> 2
      or pg_catalog.jsonb_typeof(p_expected_result->'facts') <> 'object'
      or p_expected_result#>>'{facts,version}' <> 'corporate_action_reverse_split_facts_v1'
      or p_expected_result#>>'{facts,event_kind}' <> 'reverse_split'
    then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_shape_invalid');
    end if;
    v_expected_terminal_state := 'succeeded_applicable';
    v_facts := p_expected_result->'facts';
  elsif p_expected_result = '{"applicable":false}'::jsonb then
    v_applicable := false;
    v_expected_terminal_state := 'succeeded_not_applicable';
    v_facts := null;
  else
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_result_shape_invalid');
  end if;

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

  begin
    v_parent_id := nullif(pg_catalog.btrim(v_execution.metadata->>'parent_primary_ai_run_id'), '')::uuid;
    v_logical_job_id := nullif(pg_catalog.btrim(v_execution.metadata->>'logical_job_id'), '')::uuid;
  exception when others then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_execution_lineage_invalid');
  end;
  v_parent_prompt_key := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_key');
  v_parent_prompt_version := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_version');
  v_source_family := pg_catalog.btrim(v_execution.metadata->>'source_family');

  if v_execution.prompt_key <> 'domain_monitor_child'
    or v_execution.event_id is distinct from p_event_id
    or v_execution.raw_item_id is distinct from v_event.raw_item_id
    or v_execution.metadata->>'child_schema_version' <> 'generic_monitor_child_execution_v1'
    or v_execution.metadata->>'purpose' <> 'domain_monitor_child'
    or v_execution.metadata->>'execution_id' is distinct from p_source_execution_id::text
    or v_execution.metadata->>'monitor_analyzer_key' <> 'corporate_action'
    or v_execution.metadata->>'analyzer_contract_version' <> 'corporate_action_reverse_split_analyzer_v1'
    or v_execution.prompt_version <> 'corporate_action_reverse_split_analyzer_v1'
    or v_execution.metadata->>'event_id' is distinct from p_event_id::text
    or v_execution.metadata->>'raw_item_id' is distinct from v_event.raw_item_id::text
    or v_execution.metadata->>'source_group' is distinct from v_event.source_group::text
    or v_execution.metadata->>'source_code' is distinct from v_event.source_code
    or v_execution.metadata->>'source_identity' is distinct from v_raw.source_unique_id
    or v_parent_id is null
    or v_logical_job_id is null
    or not (
      (v_execution.status in ('pending', 'running') and v_execution.metadata->>'execution_state' in ('reserved', 'running'))
      or (v_execution.status = 'completed' and v_execution.metadata->>'execution_state' = v_expected_terminal_state)
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

  if v_applicable and (
    v_facts#>>'{source,source_family}' is distinct from case v_source_family
      when 'news' then 'news'
      when 'nasdaq_corporate_actions' then 'nasdaq'
      when 'sec_8k_6k' then 'sec'
      else null end
    or v_facts#>>'{source,source_id}' is distinct from v_raw.source_unique_id
    or v_facts#>>'{source,source_url}' is distinct from v_raw.source_url
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

  v_parent_output_type := case when v_source_family = 'sec_8k_6k'
    then v_parent_prompt_key else 'news_event_analysis' end;
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
      and pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'corporate_action'
      )
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
  from public.event_corporate_action_results as result_row
  where result_row.source_execution_id = p_source_execution_id
  for update of result_row;
  if found then
    if v_existing.validated_result_payload is distinct from p_expected_result then
      return pg_catalog.jsonb_build_object('status', 'conflict', 'reason', 'same_execution_different_payload');
    end if;
    if v_applicable and not exists (
      select 1 from public.event_corporate_action_facts as fact_row
      where fact_row.source_execution_id = p_source_execution_id
        and fact_row.facts_payload = v_facts
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'applicable_fact_row_missing_or_mismatched');
    end if;
    if not v_applicable and exists (
      select 1 from public.event_corporate_action_facts as fact_row
      where fact_row.source_execution_id = p_source_execution_id
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'not_applicable_has_fact_row');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'applicable', v_applicable,
      'event_id', p_event_id,
      'source_execution_id', p_source_execution_id
    );
  end if;

  if v_execution.status = 'completed' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'terminal_success_without_prior_persistence');
  end if;

  insert into public.event_corporate_action_results (
    source_execution_id, event_id, raw_item_id, parent_primary_ai_run_id,
    logical_job_id, source_execution_kind, monitor_analyzer_key,
    analyzer_contract_version, applicable, validated_result_payload, persisted_at
  ) values (
    p_source_execution_id, p_event_id, v_event.raw_item_id, v_parent_id,
    v_logical_job_id, 'generic_monitor_child', 'corporate_action',
    v_execution.prompt_version, v_applicable, p_expected_result, v_now
  );

  if v_applicable then
    insert into public.event_corporate_action_facts (
      source_execution_id, event_id, raw_item_id, parent_primary_ai_run_id,
      logical_job_id, monitor_analyzer_key, analyzer_contract_version,
      applicable, fact_schema_version, facts_payload, event_kind, action_stage,
      effective_date, old_shares_per_new_share, source_ref, evidence,
      confidence, fact_as_of, source_family, source_id, source_url, persisted_at
    ) values (
      p_source_execution_id, p_event_id, v_event.raw_item_id, v_parent_id,
      v_logical_job_id, 'corporate_action', v_execution.prompt_version,
      true, v_facts->>'version', v_facts, v_facts->>'event_kind',
      v_facts->>'action_stage',
      case when v_facts#>>'{effective_date,availability}' = 'available'
        then (v_facts#>>'{effective_date,value}')::date else null end,
      case when v_facts#>>'{ratio,old_shares_per_new_share,availability}' = 'available'
        then (v_facts#>>'{ratio,old_shares_per_new_share,value}')::numeric else null end,
      v_facts->>'source_ref', v_facts->'evidence', v_facts->>'confidence',
      case when v_facts#>>'{as_of,availability}' = 'available'
        then (v_facts#>>'{as_of,value}')::date else null end,
      v_facts#>>'{source,source_family}', v_facts#>>'{source,source_id}',
      v_facts#>>'{source,source_url}', v_now
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'applicable', v_applicable,
    'event_id', p_event_id,
    'source_execution_id', p_source_execution_id
  );
end
$function$;

comment on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb) is
  'Persists one validated reverse-split analyzer result after exact Generic Monitor lineage and current-parent checks.';

create or replace function public.read_current_event_corporate_action_facts(
  p_event_id uuid,
  p_analyzer_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_current_parent public.ai_runs%rowtype;
  v_child public.ai_runs%rowtype;
  v_result public.event_corporate_action_results%rowtype;
  v_facts public.event_corporate_action_facts%rowtype;
  v_source_family text;
  v_parent_output_type text;
  v_expected_applicable boolean;
begin
  if p_event_id is null
    or p_analyzer_contract_version <> 'corporate_action_reverse_split_analyzer_v1'
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'invalid_arguments');
  end if;

  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'event_or_current_raw_missing');
  end if;

  select raw_row.* into v_raw from public.raw_items as raw_row where raw_row.id = v_event.raw_item_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_raw_missing');
  end if;

  v_source_family := case
    when v_event.source_group::text = 'news' and v_event.source_code = 'nasdaq_corporate_actions' then 'nasdaq_corporate_actions'
    when v_event.source_group::text = 'news' then 'news'
    when v_event.source_group::text = 'filings' and v_event.source_code = 'sec_edgar' then 'sec_8k_6k'
    else null end;
  if v_source_family is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'unsupported_source_family');
  end if;

  select parent_row.* into v_current_parent
  from public.ai_runs as parent_row
  where parent_row.event_id = p_event_id
    and parent_row.raw_item_id = v_event.raw_item_id
    and parent_row.status = 'completed'
    and (
      (v_source_family = 'news' and parent_row.prompt_key = 'news_event_analysis')
      or (v_source_family = 'nasdaq_corporate_actions' and parent_row.prompt_key = 'nasdaq_corporate_action_analysis')
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

  v_parent_output_type := case when v_source_family = 'sec_8k_6k'
    then v_current_parent.prompt_key else 'news_event_analysis' end;
  if (
    select pg_catalog.count(*) from public.ai_outputs as output_row
    where output_row.ai_run_id = v_current_parent.id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
  ) <> 1 or not exists (
    select 1 from public.ai_outputs as output_row
    where output_row.ai_run_id = v_current_parent.id
      and output_row.event_id = p_event_id
      and output_row.output_type = v_parent_output_type
      and pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'corporate_action'
      )
  ) then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_primary_output_or_route_invalid');
  end if;

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
    and child_row.metadata->>'monitor_analyzer_key' = 'corporate_action'
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
      select pg_catalog.count(*) from public.ai_outputs as output_row
      where output_row.ai_run_id = child_row.id
        and output_row.event_id = p_event_id
        and output_row.output_type = 'domain_monitor_child_execution_result'
    ) = 1
    and exists (
      select 1 from public.ai_outputs as output_row
      where output_row.ai_run_id = child_row.id
        and output_row.event_id = p_event_id
        and output_row.output_type = 'domain_monitor_child_execution_result'
        and output_row.payload->>'schema_version' = 'generic_monitor_child_execution_result_v1'
        and output_row.payload->>'execution_id' is not distinct from child_row.id::text
        and output_row.payload->>'parent_primary_ai_run_id' is not distinct from v_current_parent.id::text
        and output_row.payload->>'monitor_analyzer_key' = 'corporate_action'
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

  v_expected_applicable := v_child.metadata->>'execution_state' = 'succeeded_applicable';
  select result_row.* into v_result
  from public.event_corporate_action_results as result_row
  where result_row.source_execution_id = v_child.id;
  if not found
    or v_result.event_id is distinct from p_event_id
    or v_result.raw_item_id is distinct from v_event.raw_item_id
    or v_result.parent_primary_ai_run_id is distinct from v_current_parent.id
    or v_result.logical_job_id::text is distinct from v_child.metadata->>'logical_job_id'
    or v_result.source_execution_kind <> 'generic_monitor_child'
    or v_result.monitor_analyzer_key <> 'corporate_action'
    or v_result.analyzer_contract_version <> p_analyzer_contract_version
    or v_result.applicable is distinct from v_expected_applicable
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_result_not_persisted_or_mismatched');
  end if;

  if not v_result.applicable then
    if exists (
      select 1 from public.event_corporate_action_facts as fact_row
      where fact_row.source_execution_id = v_child.id
    ) then
      return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'not_applicable_has_fact_row');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'not_applicable', 'event_id', p_event_id,
      'raw_item_id', v_event.raw_item_id,
      'parent_primary_ai_run_id', v_current_parent.id,
      'source_execution_id', v_child.id,
      'monitor_analyzer_key', 'corporate_action',
      'analyzer_contract_version', p_analyzer_contract_version,
      'persisted_at', v_result.persisted_at
    );
  end if;

  select fact_row.* into v_facts
  from public.event_corporate_action_facts as fact_row
  where fact_row.source_execution_id = v_child.id;
  if not found
    or v_facts.event_id is distinct from p_event_id
    or v_facts.raw_item_id is distinct from v_event.raw_item_id
    or v_facts.parent_primary_ai_run_id is distinct from v_current_parent.id
    or v_facts.logical_job_id is distinct from v_result.logical_job_id
    or v_facts.monitor_analyzer_key <> 'corporate_action'
    or v_facts.analyzer_contract_version <> p_analyzer_contract_version
    or not v_facts.applicable
    or v_facts.fact_schema_version <> 'corporate_action_reverse_split_facts_v1'
    or v_facts.facts_payload is distinct from v_result.validated_result_payload->'facts'
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'current_applicable_facts_missing_or_mismatched');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available', 'event_id', p_event_id,
    'raw_item_id', v_event.raw_item_id,
    'parent_primary_ai_run_id', v_current_parent.id,
    'source_execution_id', v_child.id,
    'monitor_analyzer_key', 'corporate_action',
    'analyzer_contract_version', p_analyzer_contract_version,
    'fact_schema_version', v_facts.fact_schema_version,
    'facts', v_facts.facts_payload,
    'persisted_at', v_facts.persisted_at
  );
end
$function$;

comment on function public.read_current_event_corporate_action_facts(uuid, text) is
  'Service-role-only fail-closed reader for the current Primary and latest successful Corporate Action result.';

revoke all on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.read_current_event_corporate_action_facts(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.read_current_event_corporate_action_facts(uuid, text)
  to service_role;
