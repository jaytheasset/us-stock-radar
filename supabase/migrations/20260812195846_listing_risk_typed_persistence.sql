-- Listing Risk Phase 1I: execution-keyed event facts and a fail-closed current reader.
--
-- This is not a company-level listing-state reducer. Results remain attached to
-- one exact Primary -> Listing child execution. A valid not_applicable result is
-- history, not a fake fact row. Analyzer failures never enter this writer, and
-- stale executions are rejected before either table changes.

create table public.event_listing_risk_results (
  source_execution_id uuid primary key references public.ai_runs(id),
  event_id uuid not null references public.events(id) on delete cascade,
  raw_item_id uuid not null references public.raw_items(id),
  parent_primary_ai_run_id uuid not null references public.ai_runs(id),
  logical_job_id uuid not null,
  source_execution_kind text not null,
  monitor_analyzer_key text not null,
  analyzer_contract_version text not null,
  result_status text not null,
  validated_result_payload jsonb not null,
  persisted_at timestamptz not null default pg_catalog.now(),
  constraint event_listing_risk_results_execution_kind_check
    check (
      source_execution_kind = pg_catalog.btrim(source_execution_kind)
      and pg_catalog.length(source_execution_kind) between 1 and 80
    ),
  constraint event_listing_risk_results_analyzer_key_check
    check (monitor_analyzer_key = 'listing_risk'),
  constraint event_listing_risk_results_contract_version_check
    check (
      analyzer_contract_version = pg_catalog.btrim(analyzer_contract_version)
      and pg_catalog.length(analyzer_contract_version) between 1 and 120
    ),
  constraint event_listing_risk_results_status_check
    check (result_status in ('applicable', 'not_applicable')),
  constraint event_listing_risk_results_payload_check
    check (
      pg_catalog.jsonb_typeof(validated_result_payload) = 'object'
      and validated_result_payload->>'status' = result_status
      and (
        (
          result_status = 'applicable'
          and pg_catalog.jsonb_typeof(validated_result_payload->'facts') = 'object'
          and validated_result_payload = pg_catalog.jsonb_build_object(
            'status', 'applicable',
            'facts', validated_result_payload->'facts'
          )
        )
        or (
          result_status = 'not_applicable'
          and validated_result_payload = '{"status":"not_applicable"}'::jsonb
        )
      )
    ),
  constraint event_listing_risk_results_exact_lineage_key
    unique (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      result_status
    )
);

create index event_listing_risk_results_current_reader_idx
  on public.event_listing_risk_results (
    event_id,
    raw_item_id,
    parent_primary_ai_run_id,
    monitor_analyzer_key,
    analyzer_contract_version
  );

create table public.event_listing_risk_facts (
  source_execution_id uuid primary key,
  event_id uuid not null,
  raw_item_id uuid not null,
  parent_primary_ai_run_id uuid not null,
  logical_job_id uuid not null,
  monitor_analyzer_key text not null,
  analyzer_contract_version text not null,
  result_status text not null default 'applicable',
  fact_schema_version text not null,
  facts_payload jsonb not null,
  event_kind text not null,
  event_outcome text not null,
  classification_source_ref text not null,
  exchange text,
  affected_security_title text,
  affected_security_ticker text,
  affected_security_basis text,
  listing_rule text,
  listing_requirement text,
  compliance_period text,
  proceeding_kind text not null,
  proceeding_status text not null,
  notice_date date,
  compliance_deadline date,
  hearing_date date,
  appeal_deadline date,
  trading_suspension_date date,
  removal_effective_date date,
  continued_trading boolean,
  continued_trading_venue text,
  fact_as_of date,
  confidence text,
  sources jsonb not null,
  persisted_at timestamptz not null default pg_catalog.now(),
  constraint event_listing_risk_facts_result_status_check
    check (result_status = 'applicable'),
  constraint event_listing_risk_facts_schema_version_check
    check (fact_schema_version = 'listing_risk_event_facts_v1'),
  constraint event_listing_risk_facts_event_kind_check
    check (event_kind in (
      'deficiency_notice', 'compliance_recovery', 'delisting_determination',
      'hearing_or_appeal_update', 'trading_suspension', 'listing_removal',
      'voluntary_withdrawal', 'other'
    )),
  constraint event_listing_risk_facts_event_outcome_check
    check (event_outcome in ('adverse', 'recovered', 'procedural', 'unknown')),
  constraint event_listing_risk_facts_proceeding_kind_check
    check (proceeding_kind in ('hearing', 'appeal', 'other', 'unknown')),
  constraint event_listing_risk_facts_proceeding_status_check
    check (proceeding_status in ('intended', 'requested', 'pending', 'decided', 'not_pursued', 'unknown')),
  constraint event_listing_risk_facts_confidence_check
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint event_listing_risk_facts_payload_shape_check
    check (
      pg_catalog.jsonb_typeof(facts_payload) = 'object'
      and facts_payload->>'version' = fact_schema_version
      and pg_catalog.jsonb_typeof(facts_payload->'sources') = 'array'
      and pg_catalog.jsonb_array_length(facts_payload->'sources') > 0
      and sources = facts_payload->'sources'
    ),
  constraint event_listing_risk_facts_materialization_check
    check (
      event_kind = facts_payload#>>'{classification,event_kind}'
      and event_outcome = facts_payload#>>'{classification,event_outcome}'
      and classification_source_ref = facts_payload#>>'{classification,source_ref}'
      and exchange is not distinct from facts_payload#>>'{exchange,value}'
      and affected_security_title is not distinct from facts_payload#>>'{affected_security,title,value}'
      and affected_security_ticker is not distinct from facts_payload#>>'{affected_security,ticker,value}'
      and affected_security_basis is not distinct from facts_payload#>>'{affected_security,security_basis,value}'
      and listing_rule is not distinct from facts_payload#>>'{listing_rule,value}'
      and listing_requirement is not distinct from facts_payload#>>'{listing_requirement,value}'
      and compliance_period is not distinct from facts_payload#>>'{compliance_period,value}'
      and proceeding_kind = facts_payload#>>'{proceeding,kind}'
      and proceeding_status = facts_payload#>>'{proceeding,status}'
      and notice_date is not distinct from nullif(facts_payload#>>'{dates,notice_date,value}', '')::date
      and compliance_deadline is not distinct from nullif(facts_payload#>>'{dates,compliance_deadline,value}', '')::date
      and hearing_date is not distinct from nullif(facts_payload#>>'{dates,hearing_date,value}', '')::date
      and appeal_deadline is not distinct from nullif(facts_payload#>>'{dates,appeal_deadline,value}', '')::date
      and trading_suspension_date is not distinct from nullif(facts_payload#>>'{dates,trading_suspension_date,value}', '')::date
      and removal_effective_date is not distinct from nullif(facts_payload#>>'{dates,removal_effective_date,value}', '')::date
      and continued_trading is not distinct from nullif(facts_payload#>>'{continued_trading,continues,value}', '')::boolean
      and continued_trading_venue is not distinct from facts_payload#>>'{continued_trading,venue,value}'
      and fact_as_of is not distinct from nullif(facts_payload#>>'{as_of,value}', '')::date
      and confidence is not distinct from facts_payload->>'confidence'
    ),
  constraint event_listing_risk_facts_exact_result_fkey
    foreign key (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      result_status
    ) references public.event_listing_risk_results (
      source_execution_id,
      event_id,
      raw_item_id,
      parent_primary_ai_run_id,
      logical_job_id,
      monitor_analyzer_key,
      analyzer_contract_version,
      result_status
    ) on delete cascade
);

create index event_listing_risk_facts_parent_idx
  on public.event_listing_risk_facts (parent_primary_ai_run_id);

alter table public.event_listing_risk_results enable row level security;
alter table public.event_listing_risk_facts enable row level security;

revoke all on table public.event_listing_risk_results from public, anon, authenticated, service_role;
revoke all on table public.event_listing_risk_facts from public, anon, authenticated, service_role;

comment on table public.event_listing_risk_results is
  'Server-only immutable semantic result history for exact Listing Risk executions. not_applicable rows contain no typed fact row.';
comment on table public.event_listing_risk_facts is
  'Server-only event-level Listing Risk facts for applicable executions. It is not company current-listing state.';

create or replace function public.persist_listing_risk_analyzer_result(
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
      or p_expected_result#>>'{facts,version}' <> 'listing_risk_event_facts_v1'
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
          else null
        end
        or source_row.value->>'source_id' is distinct from v_raw.source_unique_id
        or source_row.value->>'source_url' is distinct from v_raw.source_url
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
    when v_source_family = 'sec_8k_6k' then v_parent_prompt_key
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
      and pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'listing_risk'
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
$function$;

comment on function public.persist_listing_risk_analyzer_result(uuid, uuid, jsonb) is
  'Service-role-only atomic Listing result persistence. Applicable writes result plus facts; not_applicable writes only the semantic result; stale writes neither.';

create or replace function public.read_current_event_listing_risk_facts(
  p_event_id uuid,
  p_analyzer_contract_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
    when v_event.source_group::text = 'filings' and v_event.source_code = 'sec_edgar'
      then 'sec_8k_6k'
    else null
  end;
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

  v_parent_output_type := case
    when v_source_family = 'sec_8k_6k' then v_current_parent.prompt_key
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
      and pg_catalog.jsonb_typeof(output_row.payload#>'{analysis,monitor_routes}') = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(output_row.payload#>'{analysis,monitor_routes}') as route(value)
        where route.value->>'monitor_analyzer_key' = 'listing_risk'
      )
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
      'persisted_at', v_result.persisted_at
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
    or v_facts.fact_schema_version <> 'listing_risk_event_facts_v1'
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
    'persisted_at', v_facts.persisted_at
  );
end
$function$;

comment on function public.read_current_event_listing_risk_facts(uuid, text) is
  'Service-role-only fail-closed reader for the current Primary and latest successful Listing result. No event, display snapshot, parser, news, or old-fact fallback.';

revoke all on function public.persist_listing_risk_analyzer_result(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.read_current_event_listing_risk_facts(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.persist_listing_risk_analyzer_result(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.read_current_event_listing_risk_facts(uuid, text)
  to service_role;
