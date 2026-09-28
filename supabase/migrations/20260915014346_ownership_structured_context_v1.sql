-- Ownership Structured Context v1 is an additive semantic sidecar for the
-- existing verified XML/parser rows. It never updates canonical numeric,
-- date, ticker, transaction-code, or A/D columns.

alter table public.event_form4_transactions
  add column context_facts jsonb;

alter table public.event_form144_proposed_sales
  add column context_facts jsonb;

create or replace function public.ownership_context_envelope_shape_valid(p_context jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_assertion jsonb;
  v_fact text;
  v_status text;
begin
  if p_context is null or pg_catalog.jsonb_typeof(p_context) <> 'object'
    or not (p_context ? 'version' and p_context ? 'source_fingerprint' and p_context ? 'assertions')
    or pg_catalog.jsonb_typeof(p_context->'version') <> 'string'
    or pg_catalog.jsonb_typeof(p_context->'source_fingerprint') <> 'string'
    or p_context->>'version' <> 'ownership_context_v1'
    or p_context->>'source_fingerprint' !~ '^ownership-context-v1:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_context->'assertions') <> 'array'
    or pg_catalog.jsonb_array_length(p_context->'assertions') = 0
    or pg_catalog.jsonb_array_length(p_context->'assertions') > 7
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_context) as key(value)
      where key.value not in ('version', 'source_fingerprint', 'assertions', 'ai_refs')
    )
  then return false; end if;
  if p_context ? 'ai_refs' and (
    pg_catalog.jsonb_typeof(p_context->'ai_refs') <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_context->'ai_refs')) <> 2
    or not (p_context->'ai_refs' ? 'run_id' and p_context->'ai_refs' ? 'output_id')
    or p_context#>>'{ai_refs,run_id}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_context#>>'{ai_refs,output_id}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then return false; end if;
  for v_assertion in select item.value from pg_catalog.jsonb_array_elements(p_context->'assertions') as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_assertion) <> 'object'
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_assertion) as key(value)
        where key.value not in ('fact', 'status', 'value', 'owner_ref', 'security_ref', 'evidence_refs')
      )
      or not (v_assertion ? 'fact' and v_assertion ? 'status' and v_assertion ? 'evidence_refs')
      or pg_catalog.jsonb_typeof(v_assertion->'fact') <> 'string'
      or pg_catalog.jsonb_typeof(v_assertion->'status') <> 'string'
      or pg_catalog.jsonb_typeof(v_assertion->'evidence_refs') <> 'array'
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(v_assertion->'evidence_refs') as evidence(value)
        where pg_catalog.jsonb_typeof(evidence.value) <> 'string'
          or pg_catalog.length(pg_catalog.btrim(evidence.value#>>'{}')) = 0
      )
      or (v_assertion ? 'owner_ref' and (
        pg_catalog.jsonb_typeof(v_assertion->'owner_ref') <> 'string'
        or v_assertion->>'owner_ref' !~ '^owner:(form4|form144):[0-9]+:[0-9]+$'
      ))
      or (v_assertion ? 'security_ref' and (
        pg_catalog.jsonb_typeof(v_assertion->'security_ref') <> 'string'
        or v_assertion->>'security_ref' !~ '^security:(form4|form144):[0-9]+$'
      ))
    then return false; end if;
    v_fact := v_assertion->>'fact';
    v_status := v_assertion->>'status';
    if v_fact not in (
      'owner_attribution', 'ownership_relation', 'economic_direction',
      'derivative_underlying_relation', 'rule_10b5_1_applicability',
      'footnote_scope', 'amendment_effect'
    ) or v_status not in ('supported', 'ambiguous', 'conflict', 'unresolved')
    then return false; end if;
    if v_status = 'supported' then
      if not (v_assertion ? 'value') or pg_catalog.jsonb_array_length(v_assertion->'evidence_refs') = 0
      then return false; end if;
      if (v_fact = 'owner_attribution' and (
        pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
        or v_assertion->>'value' !~ '^owner:(form4|form144):[0-9]+:[0-9]+$'
      )) or (v_fact = 'ownership_relation' and (
        pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
        or v_assertion->>'value' not in ('direct', 'indirect')
      )) or (v_fact = 'economic_direction' and (
        pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
        or v_assertion->>'value' not in ('buy', 'sell', 'other')
      )) or (v_fact = 'derivative_underlying_relation' and (
        pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
        or v_assertion->>'value' !~ '^security:(form4|form144):[0-9]+$'
      )) or (v_fact = 'rule_10b5_1_applicability' and pg_catalog.jsonb_typeof(v_assertion->'value') <> 'boolean')
        or (v_fact = 'footnote_scope' and (
          pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
          or v_assertion->>'value' not in ('row', 'owner', 'security', 'filing')
        )) or (v_fact = 'amendment_effect' and (
          pg_catalog.jsonb_typeof(v_assertion->'value') <> 'string'
          or v_assertion->>'value' not in ('adds', 'modifies', 'removes', 'restates', 'no_change')
        ))
      then return false; end if;
    elsif v_assertion ? 'value' then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

alter table public.event_form4_transactions
  add constraint event_form4_transactions_context_facts_check check (
    context_facts is null or public.ownership_context_envelope_shape_valid(context_facts)
  );

alter table public.event_form144_proposed_sales
  add constraint event_form144_proposed_sales_context_facts_check check (
    context_facts is null or public.ownership_context_envelope_shape_valid(context_facts)
  );

create or replace function public.ownership_context_source_fingerprint(p_event_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_form text;
  v_form4_count integer;
  v_form144_count integer;
  v_payload jsonb;
  v_raw_xml_sha256 text;
begin
  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id;
  if not found or v_event.raw_item_id is null then return null; end if;

  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = v_event.raw_item_id;
  if not found
    or v_raw.raw_payload->>'ownership_source_format' <> 'ownership_xml'
    or coalesce(pg_catalog.length(v_raw.raw_payload->>'ownership_source_text'), 0) = 0
  then
    return null;
  end if;
  v_raw_xml_sha256 := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_raw.raw_payload->>'ownership_source_text', 'UTF8'), 'sha256'
  ), 'hex');

  v_form := case pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(v_event.metadata->>'form_type'), '^FORM[[:space:]]+', ''))
    when '4' then 'form4'
    when '4/A' then 'form4'
    when '144' then 'form144'
    when '144/A' then 'form144'
    else null
  end;
  if v_form is null then return null; end if;

  select pg_catalog.count(*) into v_form4_count
  from public.event_form4_transactions where event_id = p_event_id;
  select pg_catalog.count(*) into v_form144_count
  from public.event_form144_proposed_sales where event_id = p_event_id;
  if (v_form = 'form4' and (v_form4_count = 0 or v_form144_count <> 0))
    or (v_form = 'form144' and (v_form144_count = 0 or v_form4_count <> 0))
  then
    return null;
  end if;
  if (v_form = 'form4' and exists (
    select 1 from public.event_form4_transactions as row_value
    where row_value.event_id = p_event_id
      and (
        row_value.provenance->>'source' is distinct from 'sec_ownership_xml_parser'
        or row_value.provenance->>'canonical_input' is distinct from 'raw_items.raw_payload.ownership_source_text'
        or row_value.provenance->>'source_xml_sha256' is distinct from v_raw_xml_sha256
      )
  )) or (v_form = 'form144' and exists (
    select 1 from public.event_form144_proposed_sales as row_value
    where row_value.event_id = p_event_id
      and (
        row_value.provenance->>'source' is distinct from 'sec_ownership_xml_parser'
        or row_value.provenance->>'canonical_input' is distinct from 'raw_items.raw_payload.ownership_source_text'
        or row_value.provenance->>'source_xml_sha256' is distinct from v_raw_xml_sha256
      )
  )) then
    return null;
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'contract', 'ownership_context_source_v1',
    'event_id', v_event.id,
    'raw_item_id', v_event.raw_item_id,
    'form_type', v_event.metadata->>'form_type',
    'accession_number', v_event.metadata->>'accession_number',
    'raw_source_unique_id', v_raw.source_unique_id,
    'raw_xml_sha256', v_raw_xml_sha256,
    'form4_rows', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_value) - 'created_at' - 'updated_at' - 'context_facts'
        order by row_value.transaction_index
      ), '[]'::jsonb)
      from public.event_form4_transactions as row_value
      where row_value.event_id = p_event_id
    ),
    'form144_rows', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_value) - 'created_at' - 'updated_at' - 'context_facts'
        order by row_value.proposed_sale_index
      ), '[]'::jsonb)
      from public.event_form144_proposed_sales as row_value
      where row_value.event_id = p_event_id
    )
  );
  return 'ownership-context-v1:' || pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'
  ), 'hex');
end;
$function$;

create or replace function public.get_event_ownership_context_fingerprint(p_event_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_form text;
  v_fingerprint text;
  v_raw_item_id uuid;
  v_context_ai_refs_valid boolean;
begin
  select case pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(event_row.metadata->>'form_type'), '^FORM[[:space:]]+', ''))
    when '4' then 'form4'
    when '4/A' then 'form4'
    when '144' then 'form144'
    when '144/A' then 'form144'
    else null
  end, event_row.raw_item_id into v_form, v_raw_item_id
  from public.events as event_row
  where event_row.id = p_event_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'event_missing');
  end if;
  v_fingerprint := public.ownership_context_source_fingerprint(p_event_id);
  if v_fingerprint is null then
    return pg_catalog.jsonb_build_object('status', 'not_ready', 'reason', 'ownership_context_source_unavailable');
  end if;
  select not exists (
    select 1
    from (
      select context_facts from public.event_form4_transactions where event_id = p_event_id
      union all
      select context_facts from public.event_form144_proposed_sales where event_id = p_event_id
    ) as context_row
    where context_row.context_facts->'ai_refs' is not null
      and not exists (
        select 1
        from public.ai_runs as run_row
        join public.ai_outputs as output_row
          on output_row.id::text = context_row.context_facts#>>'{ai_refs,output_id}'
         and output_row.ai_run_id = run_row.id
         and output_row.event_id = p_event_id
         and output_row.output_type = 'ownership_context_v1'
        where run_row.id::text = context_row.context_facts#>>'{ai_refs,run_id}'
          and run_row.event_id = p_event_id
          and run_row.raw_item_id = v_raw_item_id
          and run_row.status = 'completed'
      )
  ) into v_context_ai_refs_valid;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'form', v_form,
    'source_fingerprint', v_fingerprint,
    'context_ai_refs_valid', v_context_ai_refs_valid
  );
end;
$function$;

create or replace function public.read_event_ownership_context_snapshot(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'event', (
      select pg_catalog.jsonb_build_object(
        'id', event_row.id,
        'raw_item_id', event_row.raw_item_id,
        'source_code', event_row.source_code,
        'source_group', event_row.source_group,
        'event_type', event_row.event_type,
        'metadata', event_row.metadata
      )
      from public.events as event_row
      where event_row.id = p_event_id
    ),
    'form4_rows', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
        order by row_value.transaction_index), '[]'::jsonb)
      from public.event_form4_transactions as row_value
      where row_value.event_id = p_event_id
    ),
    'form144_rows', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
        order by row_value.proposed_sale_index), '[]'::jsonb)
      from public.event_form144_proposed_sales as row_value
      where row_value.event_id = p_event_id
    ),
    'context_fingerprint', public.get_event_ownership_context_fingerprint(p_event_id)
  );
$function$;

create or replace function public.persist_event_ownership_context(
  p_event_id uuid,
  p_form text,
  p_source_fingerprint text,
  p_contexts jsonb,
  p_ai_run_id uuid default null,
  p_ai_output_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_ai_run public.ai_runs%rowtype;
  v_ai_output public.ai_outputs%rowtype;
  v_current_fingerprint text;
  v_context jsonb;
  v_assertion jsonb;
  v_row_ref text;
  v_row_index integer;
  v_fact text;
  v_status text;
  v_value jsonb;
  v_ref text;
  v_ref_parts text[];
  v_ref_row integer;
  v_ref_index integer;
  v_existing_context jsonb;
  v_envelope jsonb;
  v_direct_code text;
  v_direct_ownership text;
  v_transaction_kind text;
  v_direct_10b5_1 boolean;
  v_underlying_title text;
  v_target_title text;
  v_desired jsonb := '{}'::jsonb;
  v_updated_count integer := 0;
  v_is_replay boolean := true;
begin
  if p_event_id is null
    or p_form is null
    or p_form not in ('form4', 'form144')
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^ownership-context-v1:[0-9a-f]{64}$'
    or p_contexts is null
    or pg_catalog.jsonb_typeof(p_contexts) <> 'array'
    or pg_catalog.jsonb_array_length(p_contexts) = 0
    or pg_catalog.jsonb_array_length(p_contexts) > 1000
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ownership-context:' || p_event_id::text, 0));
  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id
  for share of event_row;
  if not found or v_event.raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_raw_missing');
  end if;
  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = v_event.raw_item_id
  for share of raw_row;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_raw_missing');
  end if;
  if p_form is distinct from (case pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(v_event.metadata->>'form_type'), '^FORM[[:space:]]+', ''))
    when '4' then 'form4' when '4/A' then 'form4'
    when '144' then 'form144' when '144/A' then 'form144'
    else null end)
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'form_mismatch');
  end if;

  v_current_fingerprint := public.ownership_context_source_fingerprint(p_event_id);
  if v_current_fingerprint is null or v_current_fingerprint is distinct from p_source_fingerprint then
    return pg_catalog.jsonb_build_object('status', 'stale', 'reason', 'source_fingerprint_mismatch');
  end if;

  if (p_ai_run_id is null) <> (p_ai_output_id is null) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ai_refs_incomplete');
  end if;
  if p_ai_run_id is not null then
    select run_row.* into v_ai_run from public.ai_runs as run_row
    where run_row.id = p_ai_run_id for share of run_row;
    select output_row.* into v_ai_output from public.ai_outputs as output_row
    where output_row.id = p_ai_output_id for share of output_row;
    if v_ai_run.id is null
      or v_ai_run.event_id is distinct from p_event_id
      or v_ai_run.raw_item_id is distinct from v_event.raw_item_id
      or v_ai_run.status <> 'completed'
      or v_ai_output.id is null
      or v_ai_output.ai_run_id is distinct from p_ai_run_id
      or v_ai_output.event_id is distinct from p_event_id
      or v_ai_output.output_type <> 'ownership_context_v1'
    then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ai_refs_lineage_invalid');
    end if;
  end if;

  for v_context in select item.value from pg_catalog.jsonb_array_elements(p_contexts) as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_context) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_context)) <> 2
      or not (v_context ? 'row_ref' and v_context ? 'assertions')
      or pg_catalog.jsonb_typeof(v_context->'row_ref') <> 'string'
      or pg_catalog.jsonb_typeof(v_context->'assertions') <> 'array'
      or pg_catalog.jsonb_array_length(v_context->'assertions') = 0
      or pg_catalog.jsonb_array_length(v_context->'assertions') > 7
    then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'context_shape_invalid');
    end if;
    v_row_ref := v_context->>'row_ref';
    if v_row_ref !~ ('^row:' || p_form || ':[0-9]+$') then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_invalid');
    end if;
    v_row_index := pg_catalog.split_part(v_row_ref, ':', 3)::integer;
    if v_desired ? v_row_ref then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_duplicate');
    end if;
    if (p_form = 'form4' and not exists (
      select 1 from public.event_form4_transactions where event_id = p_event_id and transaction_index = v_row_index
    )) or (p_form = 'form144' and not exists (
      select 1 from public.event_form144_proposed_sales where event_id = p_event_id and proposed_sale_index = v_row_index
    )) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_missing');
    end if;
    v_direct_code := null;
    v_direct_ownership := null;
    v_transaction_kind := null;
    v_direct_10b5_1 := null;
    v_underlying_title := null;
    if p_form = 'form4' then
      select acquired_disposed_code, direct_or_indirect_ownership, transaction_kind,
        is_10b5_1, calculation_basis->>'underlying_security_title'
      into v_direct_code, v_direct_ownership, v_transaction_kind, v_direct_10b5_1, v_underlying_title
      from public.event_form4_transactions
      where event_id = p_event_id and transaction_index = v_row_index;
    end if;

    if exists (
      select 1 from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
      where item.value->>'fact' is not null
      group by item.value->>'fact' having pg_catalog.count(*) > 1
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_fact_duplicate');
    end if;

    for v_assertion in select item.value from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_assertion) <> 'object'
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_assertion) as key(value)
          where key.value not in ('fact', 'status', 'value', 'owner_ref', 'security_ref', 'evidence_refs')
        )
        or not (v_assertion ? 'fact' and v_assertion ? 'status' and v_assertion ? 'evidence_refs')
        or pg_catalog.jsonb_typeof(v_assertion->'fact') <> 'string'
        or pg_catalog.jsonb_typeof(v_assertion->'status') <> 'string'
        or pg_catalog.jsonb_typeof(v_assertion->'evidence_refs') <> 'array'
        or (v_assertion ? 'owner_ref' and (
          pg_catalog.jsonb_typeof(v_assertion->'owner_ref') <> 'string'
          or pg_catalog.length(pg_catalog.btrim(v_assertion->>'owner_ref')) = 0
        ))
        or (v_assertion ? 'security_ref' and (
          pg_catalog.jsonb_typeof(v_assertion->'security_ref') <> 'string'
          or pg_catalog.length(pg_catalog.btrim(v_assertion->>'security_ref')) = 0
        ))
      then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_shape_invalid');
      end if;
      v_fact := v_assertion->>'fact';
      v_status := v_assertion->>'status';
      v_value := v_assertion->'value';
      if v_fact not in (
        'owner_attribution', 'ownership_relation', 'economic_direction',
        'derivative_underlying_relation', 'rule_10b5_1_applicability',
        'footnote_scope', 'amendment_effect'
      ) or v_status not in ('supported', 'ambiguous', 'conflict', 'unresolved') then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_enum_invalid');
      end if;
      if (v_status = 'supported' and (
        not (v_assertion ? 'value') or pg_catalog.jsonb_array_length(v_assertion->'evidence_refs') = 0
      )) or (v_status <> 'supported' and v_assertion ? 'value') then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_support_invalid');
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_array_elements(v_assertion->'evidence_refs') as evidence(value)
        where pg_catalog.jsonb_typeof(evidence.value) <> 'string'
          or pg_catalog.length(pg_catalog.btrim(evidence.value#>>'{}')) = 0
      ) then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'evidence_ref_type_invalid');
      end if;

      for v_ref in select item.value from pg_catalog.jsonb_array_elements_text(v_assertion->'evidence_refs') as item(value)
      loop
        v_ref_parts := pg_catalog.string_to_array(v_ref, ':');
        if pg_catalog.array_length(v_ref_parts, 1) <> 4
          or v_ref_parts[1] <> 'evidence'
          or v_ref_parts[2] <> p_form
          or v_ref_parts[3] !~ '^[0-9]+$'
          or v_ref_parts[4] !~ '^[0-9]+$'
        then
          return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'evidence_ref_invalid');
        end if;
        v_ref_row := v_ref_parts[3]::integer;
        v_ref_index := v_ref_parts[4]::integer;
        if (p_form = 'form4' and not exists (
          select 1 from public.event_form4_transactions as target
          where target.event_id = p_event_id and target.transaction_index = v_ref_row
            and v_ref_index < pg_catalog.jsonb_array_length(target.evidence)
        )) or (p_form = 'form144' and not exists (
          select 1 from public.event_form144_proposed_sales as target
          where target.event_id = p_event_id and target.proposed_sale_index = v_ref_row
            and v_ref_index < pg_catalog.jsonb_array_length(target.evidence)
        )) then
          return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'evidence_ref_missing');
        end if;
      end loop;

      if v_assertion ? 'owner_ref' then
        v_ref_parts := pg_catalog.string_to_array(v_assertion->>'owner_ref', ':');
        if pg_catalog.array_length(v_ref_parts, 1) <> 4 or v_ref_parts[1] <> 'owner'
          or v_ref_parts[2] <> p_form or v_ref_parts[3] !~ '^[0-9]+$'
          or v_ref_parts[4] !~ '^[0-9]+$' or v_ref_parts[3]::integer <> v_row_index
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_ref_invalid'); end if;
        v_ref_index := v_ref_parts[4]::integer;
        if (p_form = 'form4' and not exists (
          select 1 from public.event_form4_transactions as target
          where target.event_id = p_event_id and target.transaction_index = v_row_index
            and v_ref_index < pg_catalog.jsonb_array_length(target.reporting_owner_names)
        )) or (p_form = 'form144' and not exists (
          select 1 from public.event_form144_proposed_sales as target
          where target.event_id = p_event_id and target.proposed_sale_index = v_row_index
            and v_ref_index < pg_catalog.jsonb_array_length(target.reporting_owner_names)
        )) then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_ref_missing'); end if;
      end if;

      if v_assertion ? 'security_ref' then
        if v_assertion->>'security_ref' <> ('security:' || p_form || ':' || v_row_index::text)
          or (p_form = 'form4' and not exists (
            select 1 from public.event_form4_transactions where event_id = p_event_id
              and transaction_index = v_row_index and security_title is not null
          )) or (p_form = 'form144' and not exists (
            select 1 from public.event_form144_proposed_sales where event_id = p_event_id
              and proposed_sale_index = v_row_index and security_title is not null
          ))
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'security_ref_invalid'); end if;
      end if;

      if v_status = 'supported' and (
        (v_fact = 'owner_attribution' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_value#>>'{}' !~ ('^owner:' || p_form || ':' || v_row_index::text || ':[0-9]+$')
        ))
        or (v_fact = 'ownership_relation' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string' or v_value#>>'{}' not in ('direct', 'indirect')
        ))
        or (v_fact = 'economic_direction' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string' or v_value#>>'{}' not in ('buy', 'sell', 'other')
        ))
        or (v_fact = 'derivative_underlying_relation' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_value#>>'{}' !~ ('^security:' || p_form || ':[0-9]+$')
        ))
        or (v_fact = 'rule_10b5_1_applicability' and pg_catalog.jsonb_typeof(v_value) <> 'boolean')
        or (v_fact = 'footnote_scope' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string' or v_value#>>'{}' not in ('row', 'owner', 'security', 'filing')
        ))
        or (v_fact = 'amendment_effect' and (
          pg_catalog.jsonb_typeof(v_value) <> 'string' or v_value#>>'{}' not in ('adds', 'modifies', 'removes', 'restates', 'no_change')
        ))
      ) then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_value_invalid');
      end if;
      if v_status = 'supported' and v_fact = 'owner_attribution' then
        v_ref_parts := pg_catalog.string_to_array(v_value#>>'{}', ':');
        v_ref_index := v_ref_parts[4]::integer;
        if (p_form = 'form4' and not exists (
          select 1 from public.event_form4_transactions as target
          where target.event_id = p_event_id and target.transaction_index = v_row_index
            and v_ref_index < pg_catalog.jsonb_array_length(target.reporting_owner_names)
        )) or (p_form = 'form144' and not exists (
          select 1 from public.event_form144_proposed_sales as target
          where target.event_id = p_event_id and target.proposed_sale_index = v_row_index
            and v_ref_index < pg_catalog.jsonb_array_length(target.reporting_owner_names)
        )) then
          return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_value_ref_missing');
        end if;
      end if;
      if v_status = 'supported' and v_fact = 'ownership_relation' and (
        (v_direct_ownership = 'D' and v_value#>>'{}' = 'indirect')
        or (v_direct_ownership = 'I' and v_value#>>'{}' = 'direct')
      ) then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ownership_relation_xml_conflict');
      end if;
      if v_status = 'supported' and v_fact = 'economic_direction' and (
        (v_direct_code = 'A' and v_value#>>'{}' = 'sell')
        or (v_direct_code = 'D' and v_value#>>'{}' = 'buy')
      ) then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'economic_direction_xml_conflict');
      end if;
      if v_status = 'supported' and v_fact = 'rule_10b5_1_applicability'
        and v_direct_10b5_1 is not null
        and (v_value#>>'{}')::boolean is distinct from v_direct_10b5_1
      then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_xml_conflict');
      end if;
      if v_status = 'supported' and v_fact = 'derivative_underlying_relation' then
        if p_form <> 'form4' or v_transaction_kind <> 'derivative' or v_underlying_title is null then
          return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'underlying_relation_source_missing');
        end if;
        v_ref_parts := pg_catalog.string_to_array(v_value#>>'{}', ':');
        v_ref_row := v_ref_parts[3]::integer;
        select security_title into v_target_title
        from public.event_form4_transactions
        where event_id = p_event_id and transaction_index = v_ref_row;
        if not found or v_ref_row = v_row_index or v_target_title is distinct from v_underlying_title then
          return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'underlying_security_ref_invalid');
        end if;
      end if;
      if v_status = 'supported' and v_fact = 'amendment_effect'
        and pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(v_event.metadata->>'form_type'), '^FORM[[:space:]]+', ''))
          not in ('4/A', '144/A')
      then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'amendment_effect_not_applicable');
      end if;
    end loop;

    v_envelope := pg_catalog.jsonb_build_object(
      'version', 'ownership_context_v1',
      'source_fingerprint', p_source_fingerprint,
      'assertions', v_context->'assertions'
    );
    if p_ai_run_id is not null then
      v_envelope := v_envelope || pg_catalog.jsonb_build_object('ai_refs', pg_catalog.jsonb_build_object(
        'run_id', p_ai_run_id, 'output_id', p_ai_output_id
      ));
    end if;
    v_desired := v_desired || pg_catalog.jsonb_build_object(v_row_ref, v_envelope);

    if p_form = 'form4' then
      select context_facts into v_existing_context
      from public.event_form4_transactions
      where event_id = p_event_id and transaction_index = v_row_index
      for update;
    else
      select context_facts into v_existing_context
      from public.event_form144_proposed_sales
      where event_id = p_event_id and proposed_sale_index = v_row_index
      for update;
    end if;
    if v_existing_context is distinct from v_envelope then v_is_replay := false; end if;
  end loop;

  if p_form = 'form4' and (
    select pg_catalog.count(*) from public.event_form4_transactions
    where event_id = p_event_id and context_facts is not null
  ) <> pg_catalog.jsonb_array_length(p_contexts) then v_is_replay := false; end if;
  if p_form = 'form144' and (
    select pg_catalog.count(*) from public.event_form144_proposed_sales
    where event_id = p_event_id and context_facts is not null
  ) <> pg_catalog.jsonb_array_length(p_contexts) then v_is_replay := false; end if;
  if v_is_replay then
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'updated_row_count', pg_catalog.jsonb_array_length(p_contexts),
      'source_fingerprint', p_source_fingerprint
    );
  end if;

  if p_form = 'form4' then
    update public.event_form4_transactions set context_facts = null where event_id = p_event_id;
    update public.event_form4_transactions as target
    set context_facts = v_desired->('row:form4:' || target.transaction_index::text)
    where target.event_id = p_event_id and v_desired ? ('row:form4:' || target.transaction_index::text);
    get diagnostics v_updated_count = row_count;
  else
    update public.event_form144_proposed_sales set context_facts = null where event_id = p_event_id;
    update public.event_form144_proposed_sales as target
    set context_facts = v_desired->('row:form144:' || target.proposed_sale_index::text)
    where target.event_id = p_event_id and v_desired ? ('row:form144:' || target.proposed_sale_index::text);
    get diagnostics v_updated_count = row_count;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'stored', 'updated_row_count', v_updated_count,
    'source_fingerprint', p_source_fingerprint
  );
end;
$function$;

-- Keep the existing atomic delete/insert contract, add the same per-event lock
-- as context writes, and restore only contexts whose DB-computed source
-- fingerprint is still identical after the replacement.
create or replace function public.replace_event_ownership_facts(
  p_event_id uuid,
  p_form4_rows jsonb default '[]'::jsonb,
  p_form144_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_form4_rows jsonb := coalesce(p_form4_rows, '[]'::jsonb);
  v_form144_rows jsonb := coalesce(p_form144_rows, '[]'::jsonb);
  v_form4_count integer;
  v_form144_count integer;
  v_form4_contexts jsonb;
  v_form144_contexts jsonb;
  v_source_fingerprint text;
begin
  if pg_catalog.jsonb_typeof(v_form4_rows) <> 'array' or pg_catalog.jsonb_typeof(v_form144_rows) <> 'array' then
    raise exception 'ownership row arguments must be JSON arrays' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ownership-context:' || p_event_id::text, 0));
  select coalesce(pg_catalog.jsonb_object_agg(transaction_index::text, context_facts)
    filter (where context_facts is not null), '{}'::jsonb)
    into v_form4_contexts from public.event_form4_transactions where event_id = p_event_id;
  select coalesce(pg_catalog.jsonb_object_agg(proposed_sale_index::text, context_facts)
    filter (where context_facts is not null), '{}'::jsonb)
    into v_form144_contexts from public.event_form144_proposed_sales where event_id = p_event_id;

  delete from public.event_form4_transactions where event_id = p_event_id;
  delete from public.event_form144_proposed_sales where event_id = p_event_id;

  insert into public.event_form4_transactions (
    event_id, transaction_index, symbol, reporting_owner_names, reporting_owner_roles,
    officer_titles, is_officer, is_director, is_10_percent_owner, officer_title,
    is_10b5_1, transaction_kind, security_title, transaction_date,
    deemed_execution_date, transaction_code, acquired_disposed_code, economic_direction,
    shares, shares_quality, price_per_share, price_per_share_quality,
    transaction_value, transaction_value_quality, post_transaction_shares,
    shares_value_quality, shares_availability,
    price_per_share_value_quality, price_per_share_availability,
    transaction_value_value_quality, transaction_value_availability,
    post_transaction_shares_value_quality, post_transaction_shares_availability,
    direct_or_indirect_ownership, nature_of_ownership, fact_as_of, confidence,
    provenance, evidence, calculation_basis, updated_at
  )
  select
    p_event_id, r.transaction_index, r.symbol,
    coalesce(r.reporting_owner_names, '[]'::jsonb), coalesce(r.reporting_owner_roles, '[]'::jsonb),
    coalesce(r.officer_titles, '[]'::jsonb), r.is_officer, r.is_director,
    r.is_10_percent_owner, r.officer_title, r.is_10b5_1, r.transaction_kind,
    r.security_title, r.transaction_date, r.deemed_execution_date, r.transaction_code,
    r.acquired_disposed_code, r.economic_direction, r.shares, r.shares_quality,
    r.price_per_share, r.price_per_share_quality, r.transaction_value, r.transaction_value_quality,
    r.post_transaction_shares, r.shares_value_quality, r.shares_availability,
    r.price_per_share_value_quality, r.price_per_share_availability,
    r.transaction_value_value_quality, r.transaction_value_availability,
    r.post_transaction_shares_value_quality, r.post_transaction_shares_availability,
    r.direct_or_indirect_ownership, r.nature_of_ownership, r.fact_as_of, r.confidence,
    coalesce(r.provenance, '{}'::jsonb), coalesce(r.evidence, '[]'::jsonb),
    coalesce(r.calculation_basis, '{}'::jsonb), coalesce(r.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(v_form4_rows) as r(
    transaction_index integer, symbol text, reporting_owner_names jsonb,
    reporting_owner_roles jsonb, officer_titles jsonb, is_officer boolean,
    is_director boolean, is_10_percent_owner boolean, officer_title text,
    is_10b5_1 boolean, transaction_kind text, security_title text,
    transaction_date date, deemed_execution_date date, transaction_code text,
    acquired_disposed_code text, economic_direction text, shares numeric,
    shares_quality text, price_per_share numeric, price_per_share_quality text,
    transaction_value numeric, transaction_value_quality text, post_transaction_shares numeric,
    shares_value_quality text, shares_availability text,
    price_per_share_value_quality text, price_per_share_availability text,
    transaction_value_value_quality text, transaction_value_availability text,
    post_transaction_shares_value_quality text, post_transaction_shares_availability text,
    direct_or_indirect_ownership text, nature_of_ownership text, fact_as_of date,
    confidence numeric, provenance jsonb, evidence jsonb, calculation_basis jsonb,
    updated_at timestamptz
  );
  get diagnostics v_form4_count = row_count;

  insert into public.event_form144_proposed_sales (
    event_id, proposed_sale_index, symbol, seller_name, reporting_owner_names,
    security_title, exchange, securities_to_be_sold, securities_to_be_sold_quality,
    aggregate_market_value, aggregate_market_value_quality, approximate_sale_date,
    shares_outstanding, shares_outstanding_quality, proposed_sale_percent, proposed_sale_percent_quality,
    securities_to_be_sold_value_quality, securities_to_be_sold_availability,
    aggregate_market_value_value_quality, aggregate_market_value_availability,
    shares_outstanding_value_quality, shares_outstanding_availability,
    proposed_sale_percent_value_quality, proposed_sale_percent_availability,
    fact_as_of, confidence, provenance, evidence, calculation_basis, updated_at
  )
  select
    p_event_id, r.proposed_sale_index, r.symbol, r.seller_name,
    coalesce(r.reporting_owner_names, '[]'::jsonb), r.security_title,
    r.exchange, r.securities_to_be_sold, r.securities_to_be_sold_quality,
    r.aggregate_market_value, r.aggregate_market_value_quality, r.approximate_sale_date,
    r.shares_outstanding, r.shares_outstanding_quality, r.proposed_sale_percent,
    r.proposed_sale_percent_quality, r.securities_to_be_sold_value_quality,
    r.securities_to_be_sold_availability, r.aggregate_market_value_value_quality,
    r.aggregate_market_value_availability, r.shares_outstanding_value_quality,
    r.shares_outstanding_availability, r.proposed_sale_percent_value_quality,
    r.proposed_sale_percent_availability, r.fact_as_of, r.confidence,
    coalesce(r.provenance, '{}'::jsonb), coalesce(r.evidence, '[]'::jsonb),
    coalesce(r.calculation_basis, '{}'::jsonb), coalesce(r.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(v_form144_rows) as r(
    proposed_sale_index integer, symbol text, seller_name text, reporting_owner_names jsonb,
    security_title text, exchange text, securities_to_be_sold numeric,
    securities_to_be_sold_quality text, aggregate_market_value numeric,
    aggregate_market_value_quality text, approximate_sale_date date,
    shares_outstanding numeric, shares_outstanding_quality text, proposed_sale_percent numeric,
    proposed_sale_percent_quality text, securities_to_be_sold_value_quality text,
    securities_to_be_sold_availability text, aggregate_market_value_value_quality text,
    aggregate_market_value_availability text, shares_outstanding_value_quality text,
    shares_outstanding_availability text, proposed_sale_percent_value_quality text,
    proposed_sale_percent_availability text, fact_as_of date, confidence numeric,
    provenance jsonb, evidence jsonb, calculation_basis jsonb, updated_at timestamptz
  );
  get diagnostics v_form144_count = row_count;

  v_source_fingerprint := public.ownership_context_source_fingerprint(p_event_id);
  if v_source_fingerprint is not null then
    update public.event_form4_transactions as target
    set context_facts = v_form4_contexts -> target.transaction_index::text
    where target.event_id = p_event_id
      and (v_form4_contexts -> target.transaction_index::text) ->> 'source_fingerprint' = v_source_fingerprint;
    update public.event_form144_proposed_sales as target
    set context_facts = v_form144_contexts -> target.proposed_sale_index::text
    where target.event_id = p_event_id
      and (v_form144_contexts -> target.proposed_sale_index::text) ->> 'source_fingerprint' = v_source_fingerprint;
  end if;

  return pg_catalog.jsonb_build_object(
    'form4_transaction_count', v_form4_count,
    'form144_proposed_sale_count', v_form144_count,
    'context_source_fingerprint', v_source_fingerprint
  );
end;
$function$;

revoke all on function public.ownership_context_envelope_shape_valid(jsonb) from public, anon, authenticated;
revoke all on function public.ownership_context_source_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.get_event_ownership_context_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.read_event_ownership_context_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.persist_event_ownership_context(uuid, text, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.ownership_context_envelope_shape_valid(jsonb) to service_role;
grant execute on function public.ownership_context_source_fingerprint(uuid) to service_role;
grant execute on function public.get_event_ownership_context_fingerprint(uuid) to service_role;
grant execute on function public.read_event_ownership_context_snapshot(uuid) to service_role;
grant execute on function public.persist_event_ownership_context(uuid, text, text, jsonb, uuid, uuid) to service_role;
grant execute on function public.replace_event_ownership_facts(uuid, jsonb, jsonb) to service_role;

comment on column public.event_form4_transactions.context_facts is
  'Validated ownership_context_v1 assertions only. Raw model JSON is forbidden; canonical XML/parser columns remain authoritative.';
comment on column public.event_form144_proposed_sales.context_facts is
  'Validated ownership_context_v1 assertions only. Raw model JSON is forbidden; canonical XML/parser columns remain authoritative.';
comment on function public.persist_event_ownership_context(uuid, text, text, jsonb, uuid, uuid) is
  'Writes validated context sidecars only after DB-current fingerprint and optional AI lineage checks; never updates canonical direct columns.';
