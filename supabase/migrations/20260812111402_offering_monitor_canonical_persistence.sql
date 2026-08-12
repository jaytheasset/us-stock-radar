-- Offering Monitor Phase 5N: one server-only current canonical row per event.
-- ai_runs/ai_outputs remain the immutable execution history. This table is only
-- the promoted current-state projection and is never a fallback source.

create table public.event_offering_monitor_canonical (
  event_id uuid primary key references public.events(id) on delete cascade,
  raw_item_id uuid not null references public.raw_items(id),
  parent_primary_ai_run_id uuid not null references public.ai_runs(id),
  source_execution_id uuid not null unique references public.ai_runs(id),
  form_family text not null,
  contract_version text not null,
  schema_version text not null,
  validated_canonical_payload jsonb not null,
  materialized_payload jsonb not null,
  total_potential_primary_share_exposure numeric,
  validation_status text not null,
  validation_success boolean not null,
  promoted_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint event_offering_monitor_canonical_family_check
    check (form_family in ('s1', 's3', '424b')),
  constraint event_offering_monitor_canonical_contract_version_check
    check (contract_version = pg_catalog.btrim(contract_version) and pg_catalog.length(contract_version) between 1 and 120),
  constraint event_offering_monitor_canonical_schema_version_check
    check (schema_version = pg_catalog.btrim(schema_version) and pg_catalog.length(schema_version) between 1 and 120),
  constraint event_offering_monitor_canonical_validated_payload_check
    check (pg_catalog.jsonb_typeof(validated_canonical_payload) = 'object'),
  constraint event_offering_monitor_canonical_materialized_payload_check
    check (pg_catalog.jsonb_typeof(materialized_payload) = 'object'),
  constraint event_offering_monitor_canonical_total_check
    check (total_potential_primary_share_exposure is null or total_potential_primary_share_exposure >= 0),
  constraint event_offering_monitor_canonical_validation_check
    check (validation_status = 'success' and validation_success)
);

create index event_offering_monitor_canonical_parent_idx
  on public.event_offering_monitor_canonical (parent_primary_ai_run_id);

alter table public.event_offering_monitor_canonical enable row level security;

revoke all on table public.event_offering_monitor_canonical from public, anon, authenticated, service_role;

comment on table public.event_offering_monitor_canonical is
  'Server-only current Offering Monitor truth. Execution history stays in ai_runs/ai_outputs; stale lineage remains stored but readers fail closed.';

create or replace function public.promote_event_offering_monitor_canonical(
  p_event_id uuid,
  p_source_execution_id uuid,
  p_expected_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.events%rowtype;
  v_execution public.ai_runs%rowtype;
  v_output public.ai_outputs%rowtype;
  v_parent public.ai_runs%rowtype;
  v_existing public.event_offering_monitor_canonical%rowtype;
  v_current_parent_id uuid;
  v_parent_id uuid;
  v_parent_prompt_key text;
  v_family text;
  v_allowed_refs jsonb;
  v_canonical jsonb;
  v_materialized jsonb;
  v_total_fact jsonb;
  v_total numeric;
begin
  if p_event_id is null or p_source_execution_id is null or pg_catalog.jsonb_typeof(p_expected_candidate) <> 'object' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  -- Serializes canonical replacement and stabilizes the event's current raw lineage.
  select event_row.*
  into v_event
  from public.events as event_row
  where event_row.id = p_event_id
  for update of event_row;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_current_raw_missing');
  end if;

  select run_row.*
  into v_execution
  from public.ai_runs as run_row
  where run_row.id = p_source_execution_id
  for update of run_row;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_execution_missing');
  end if;

  v_parent_id := nullif(pg_catalog.btrim(v_execution.metadata->>'parent_primary_ai_run_id'), '')::uuid;
  v_parent_prompt_key := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_key');
  v_family := pg_catalog.btrim(v_execution.metadata->>'form_family');

  if v_execution.prompt_key <> 'offering_monitor_normalization_job'
    or v_execution.status <> 'completed'
    or v_execution.event_id is distinct from p_event_id
    or v_execution.raw_item_id is distinct from v_event.raw_item_id
    or v_execution.metadata->>'purpose' <> 'offering_monitor_normalization'
    or v_execution.metadata->>'execution_id' is distinct from v_execution.id::text
    or v_execution.metadata->>'execution_contract_version' is distinct from v_execution.prompt_version
    or v_execution.metadata->>'validation_status' <> 'success'
    or v_execution.metadata->>'diagnostic_candidate_only' <> 'true'
    or v_execution.metadata->>'phase' <> 'diagnostic_candidate_saved'
    or v_parent_id is null
    or v_family not in ('s1', 's3', '424b')
    or (v_family = 's1' and v_parent_prompt_key <> 'sec_s1_f1_analysis')
    or (v_family = 's3' and v_parent_prompt_key <> 'sec_s3_offering_analysis')
    or (v_family = '424b' and v_parent_prompt_key <> 'sec_424b_analysis')
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_execution_ineligible');
  end if;

  select output_row.*
  into v_output
  from public.ai_outputs as output_row
  where output_row.id = p_source_execution_id
    and output_row.ai_run_id = p_source_execution_id
    and output_row.event_id = p_event_id
    and output_row.output_type = 'offering_monitor_normalization_candidate';
  if not found
    or v_output.payload is distinct from p_expected_candidate
    or p_expected_candidate->>'schema_version' <> 'offering_monitor_second_stage_candidate_v2'
    or p_expected_candidate->>'job_id' is distinct from p_source_execution_id::text
    or p_expected_candidate->>'event_id' is distinct from p_event_id::text
    or p_expected_candidate->>'raw_item_id' is distinct from v_event.raw_item_id::text
    or p_expected_candidate->>'parent_primary_ai_run_id' is distinct from v_parent_id::text
    or p_expected_candidate#>>'{prompt,version}' is distinct from v_execution.prompt_version
    or p_expected_candidate#>>'{validation,status}' <> 'success'
    or pg_catalog.jsonb_typeof(p_expected_candidate#>'{validation,errors}') <> 'array'
    or pg_catalog.jsonb_array_length(p_expected_candidate#>'{validation,errors}') <> 0
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'validated_candidate_mismatch');
  end if;

  v_canonical := p_expected_candidate->'canonical_candidate';
  v_materialized := p_expected_candidate->'materialized_candidate';
  v_allowed_refs := p_expected_candidate#>'{input_stats,selectedSourceRefs}';
  if pg_catalog.jsonb_typeof(v_canonical) <> 'object'
    or pg_catalog.jsonb_typeof(v_materialized) <> 'object'
    or pg_catalog.jsonb_typeof(v_canonical->'facts') <> 'object'
    or pg_catalog.jsonb_typeof(v_materialized->'facts') <> 'object'
    or v_materialized->'facts' is distinct from v_canonical->'facts'
    or pg_catalog.jsonb_typeof(v_allowed_refs) <> 'array'
    or pg_catalog.jsonb_array_length(v_allowed_refs) = 0
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'candidate_payload_invalid');
  end if;

  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_canonical->'facts')) <> 5
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_canonical->'facts') as fact_key(key)
      where fact_key.key not in (
        'actual_primary_offering_amount', 'offering_price', 'immediate_primary_share_exposure',
        'additional_potential_primary_share_exposure', 'resale_share_exposure'
      )
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_allowed_refs) as allowed(value)
      where pg_catalog.jsonb_typeof(allowed.value) <> 'string'
    )
    or exists (
      select 1
      from (
        select allowed.value, pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements_text(v_allowed_refs) as allowed(value)
        group by allowed.value
        having pg_catalog.count(*) > 1
      ) as duplicates
    )
    or exists (
      select 1
      from pg_catalog.jsonb_each(v_canonical->'facts') as fact(key, value)
      where fact.value->>'availability' = 'available'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(v_allowed_refs) as allowed(value)
          where allowed.value = fact.value->>'source_ref'
        )
    )
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'source_membership_or_fact_coverage_invalid');
  end if;

  v_total_fact := v_materialized->'total_potential_primary_share_exposure';
  if pg_catalog.jsonb_typeof(v_total_fact) <> 'object'
    or v_total_fact->>'availability' not in ('available', 'unavailable')
    or (v_total_fact->>'availability' = 'available' and pg_catalog.jsonb_typeof(v_total_fact->'value') <> 'number')
    or (v_total_fact->>'availability' = 'unavailable' and v_total_fact->'value' <> 'null'::jsonb)
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'deterministic_total_invalid');
  end if;
  v_total := case
    when v_total_fact->>'availability' = 'available' then (v_total_fact->>'value')::numeric
    else null
  end;

  select parent_row.*
  into v_parent
  from public.ai_runs as parent_row
  where parent_row.id = v_parent_id;
  if not found
    or v_parent.status <> 'completed'
    or v_parent.event_id is distinct from p_event_id
    or v_parent.raw_item_id is distinct from v_event.raw_item_id
    or v_parent.prompt_key is distinct from v_parent_prompt_key
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exact_parent_lineage_invalid');
  end if;

  select current_parent.id
  into v_current_parent_id
  from public.ai_runs as current_parent
  where current_parent.event_id = p_event_id
    and current_parent.raw_item_id = v_event.raw_item_id
    and current_parent.prompt_key = v_parent_prompt_key
    and current_parent.status = 'completed'
  order by current_parent.finished_at desc nulls last,
    current_parent.started_at desc nulls last,
    current_parent.id desc
  limit 1;
  if v_current_parent_id is null or v_current_parent_id is distinct from v_parent_id then
    return pg_catalog.jsonb_build_object('status', 'stale', 'reason', 'parent_not_current');
  end if;

  select canonical_row.*
  into v_existing
  from public.event_offering_monitor_canonical as canonical_row
  where canonical_row.event_id = p_event_id
  for update of canonical_row;
  if found and v_existing.source_execution_id = p_source_execution_id then
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'event_id', p_event_id,
      'source_execution_id', p_source_execution_id
    );
  end if;

  insert into public.event_offering_monitor_canonical (
    event_id,
    raw_item_id,
    parent_primary_ai_run_id,
    source_execution_id,
    form_family,
    contract_version,
    schema_version,
    validated_canonical_payload,
    materialized_payload,
    total_potential_primary_share_exposure,
    validation_status,
    validation_success,
    promoted_at,
    updated_at
  )
  values (
    p_event_id,
    v_event.raw_item_id,
    v_parent_id,
    p_source_execution_id,
    v_family,
    v_execution.prompt_version,
    p_expected_candidate->>'schema_version',
    v_canonical,
    v_materialized,
    v_total,
    'success',
    true,
    v_now,
    v_now
  )
  on conflict (event_id) do update set
    raw_item_id = excluded.raw_item_id,
    parent_primary_ai_run_id = excluded.parent_primary_ai_run_id,
    source_execution_id = excluded.source_execution_id,
    form_family = excluded.form_family,
    contract_version = excluded.contract_version,
    schema_version = excluded.schema_version,
    validated_canonical_payload = excluded.validated_canonical_payload,
    materialized_payload = excluded.materialized_payload,
    total_potential_primary_share_exposure = excluded.total_potential_primary_share_exposure,
    validation_status = excluded.validation_status,
    validation_success = excluded.validation_success,
    promoted_at = excluded.promoted_at,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'event_id', p_event_id,
    'source_execution_id', p_source_execution_id,
    'parent_primary_ai_run_id', v_parent_id
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'candidate_scalar_invalid');
end
$function$;

comment on function public.promote_event_offering_monitor_canonical(uuid, uuid, jsonb) is
  'Service-role-only atomic promotion of one already-stored, strictly validated Offering Monitor candidate when its exact Primary parent is still current.';

create or replace function public.read_event_offering_monitor_canonical(
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_canonical public.event_offering_monitor_canonical%rowtype;
  v_execution public.ai_runs%rowtype;
  v_current_parent_id uuid;
  v_parent_prompt_key text;
begin
  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'event_or_current_raw_missing');
  end if;

  select canonical_row.* into v_canonical
  from public.event_offering_monitor_canonical as canonical_row
  where canonical_row.event_id = p_event_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'canonical_missing');
  end if;
  if not v_canonical.validation_success
    or v_canonical.validation_status <> 'success'
    or v_canonical.raw_item_id is distinct from v_event.raw_item_id
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'canonical_invalid_or_stale_raw');
  end if;

  select run_row.* into v_execution
  from public.ai_runs as run_row
  where run_row.id = v_canonical.source_execution_id;
  if not found
    or v_execution.status <> 'completed'
    or v_execution.prompt_key <> 'offering_monitor_normalization_job'
    or v_execution.event_id is distinct from p_event_id
    or v_execution.raw_item_id is distinct from v_event.raw_item_id
    or v_execution.metadata->>'validation_status' <> 'success'
    or v_execution.metadata->>'parent_primary_ai_run_id' is distinct from v_canonical.parent_primary_ai_run_id::text
    or not exists (
      select 1
      from public.ai_outputs as output_row
      where output_row.id = v_canonical.source_execution_id
        and output_row.ai_run_id = v_canonical.source_execution_id
        and output_row.event_id = p_event_id
        and output_row.output_type = 'offering_monitor_normalization_candidate'
        and output_row.payload#>>'{validation,status}' = 'success'
    )
  then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'source_execution_not_eligible');
  end if;

  v_parent_prompt_key := pg_catalog.btrim(v_execution.metadata->>'parent_prompt_key');
  select current_parent.id into v_current_parent_id
  from public.ai_runs as current_parent
  where current_parent.event_id = p_event_id
    and current_parent.raw_item_id = v_event.raw_item_id
    and current_parent.prompt_key = v_parent_prompt_key
    and current_parent.status = 'completed'
  order by current_parent.finished_at desc nulls last,
    current_parent.started_at desc nulls last,
    current_parent.id desc
  limit 1;
  if v_current_parent_id is null or v_current_parent_id is distinct from v_canonical.parent_primary_ai_run_id then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'parent_not_current');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'event_id', v_canonical.event_id,
    'raw_item_id', v_canonical.raw_item_id,
    'parent_primary_ai_run_id', v_canonical.parent_primary_ai_run_id,
    'source_execution_id', v_canonical.source_execution_id,
    'form_family', v_canonical.form_family,
    'contract_version', v_canonical.contract_version,
    'schema_version', v_canonical.schema_version,
    'canonical_payload', v_canonical.validated_canonical_payload,
    'materialized_payload', v_canonical.materialized_payload,
    'total_potential_primary_share_exposure', v_canonical.total_potential_primary_share_exposure,
    'promoted_at', v_canonical.promoted_at
  );
end
$function$;

comment on function public.read_event_offering_monitor_canonical(uuid) is
  'Service-role-only fail-closed Offering canonical reader. It returns no Primary, parser, event_offering_terms, market-context, or latest-ai-run fallback.';

revoke all on function public.promote_event_offering_monitor_canonical(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.read_event_offering_monitor_canonical(uuid) from public, anon, authenticated;
grant execute on function public.promote_event_offering_monitor_canonical(uuid, uuid, jsonb) to service_role;
grant execute on function public.read_event_offering_monitor_canonical(uuid) to service_role;
