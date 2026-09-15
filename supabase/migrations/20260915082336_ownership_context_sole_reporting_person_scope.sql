-- Narrow follow-up: allow an exact singular Form 4 self-reference only for owner-scoped footnotes.
-- Rule 10b5-1 owner attribution continues to require an explicit owner name or source-declared alias.

create or replace function public.ownership_context_footnote_establishes_owner_scope(
  p_xml text,
  p_footnote_id text,
  p_owner_name text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_text text := public.ownership_context_normalize_words(
    public.ownership_context_xml_footnote_text(p_xml, p_footnote_id)
  );
  v_document xml;
  v_owner_nodes xml[];
  v_owner_name_nodes xml[];
  v_source_owner_name text;
begin
  if public.ownership_context_footnote_mentions_owner(p_xml, p_footnote_id, p_owner_name)
  then return true; end if;
  if pg_catalog.length(v_text) = 0 then return false; end if;

  v_document := xmlparse(document pg_catalog.regexp_replace(p_xml, '^[[:space:]]*<\?xml[^>]*\?>', '', 'i'));
  v_owner_nodes := xpath('//*[local-name()="reportingOwner"]', v_document);
  if coalesce(pg_catalog.array_length(v_owner_nodes, 1), 0) <> 1 then return false; end if;
  v_owner_name_nodes := xpath(
    'string((//*[local-name()="reportingOwner"])[1]//*[local-name()="rptOwnerName"][1])',
    v_document
  );
  v_source_owner_name := nullif(pg_catalog.btrim(v_owner_name_nodes[1]::text), '');
  if v_source_owner_name is null
    or public.ownership_context_normalize_words(v_source_owner_name)
      is distinct from public.ownership_context_normalize_words(p_owner_name)
  then return false; end if;
  if v_text ~ '(^|[[:space:]])reporting[[:space:]]+persons([[:space:]]|$)'
    or v_text ~ '(^|[[:space:]])(a|another|any|each|other|the[[:space:]]+other)[[:space:]]+reporting[[:space:]]+person([[:space:]]|$)'
  then return false; end if;
  return v_text ~ '(^|[[:space:]])the[[:space:]]+reporting[[:space:]]+person([[:space:]]|$)';
exception when others then
  return false;
end;
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
  v_ref_index integer;
  v_existing_context jsonb;
  v_envelope jsonb;
  v_direct_code text;
  v_direct_ownership text;
  v_transaction_kind text;
  v_direct_10b5_1 boolean;
  v_owner_names jsonb;
  v_evidence jsonb;
  v_calculation_basis jsonb;
  v_security_title text;
  v_owner_name text;
  v_footnote_id text;
  v_filing_10b5_1 boolean;
  v_desired jsonb := '{}'::jsonb;
  v_existing_count integer := 0;
  v_updated_count integer := 0;
  v_is_replay boolean := true;
begin
  if p_event_id is null or p_form not in ('form4', 'form144')
    or p_source_fingerprint !~ '^ownership-context-v1:[0-9a-f]{64}$'
    or p_contexts is null or pg_catalog.jsonb_typeof(p_contexts) <> 'array'
    or pg_catalog.jsonb_array_length(p_contexts) > 1000
  then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ownership-context:' || p_event_id::text, 0));
  select event_row.* into v_event from public.events as event_row where event_row.id = p_event_id for share of event_row;
  if not found or v_event.raw_item_id is null then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_raw_missing'); end if;
  select raw_row.* into v_raw from public.raw_items as raw_row where raw_row.id = v_event.raw_item_id for share of raw_row;
  if not found then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'event_or_raw_missing'); end if;
  if p_form is distinct from (case pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(v_event.metadata->>'form_type'), '^FORM[[:space:]]+', ''))
    when '4' then 'form4' when '4/A' then 'form4' when '144' then 'form144' when '144/A' then 'form144' else null end)
  then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'form_mismatch'); end if;
  v_current_fingerprint := public.ownership_context_source_fingerprint(p_event_id);
  if v_current_fingerprint is null or v_current_fingerprint is distinct from p_source_fingerprint
  then return pg_catalog.jsonb_build_object('status', 'stale', 'reason', 'source_fingerprint_mismatch'); end if;

  if (p_ai_run_id is null) <> (p_ai_output_id is null)
  then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ai_refs_incomplete'); end if;
  if p_ai_run_id is not null then
    select run_row.* into v_ai_run from public.ai_runs as run_row where run_row.id = p_ai_run_id for share of run_row;
    select output_row.* into v_ai_output from public.ai_outputs as output_row where output_row.id = p_ai_output_id for share of output_row;
    if v_ai_run.id is null or v_ai_run.event_id is distinct from p_event_id or v_ai_run.raw_item_id is distinct from v_event.raw_item_id
      or v_ai_run.status <> 'completed' or v_ai_output.id is null or v_ai_output.ai_run_id is distinct from p_ai_run_id
      or v_ai_output.event_id is distinct from p_event_id or v_ai_output.output_type <> 'ownership_context_v1'
    then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ai_refs_lineage_invalid'); end if;
  end if;

  v_ref_parts := pg_catalog.regexp_match(v_raw.raw_payload->>'ownership_source_text',
    '<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?aff10b5One[^>]*>[[:space:]]*([01])[[:space:]]*</(?:[A-Za-z_][A-Za-z0-9_.-]*:)?aff10b5One>', 'i');
  v_filing_10b5_1 := case v_ref_parts[1]
    when '1' then true when '0' then false else null end;

  for v_context in select item.value from pg_catalog.jsonb_array_elements(p_contexts) as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_context) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_context)) <> 2
      or not (v_context ? 'row_ref' and v_context ? 'assertions')
      or pg_catalog.jsonb_typeof(v_context->'row_ref') <> 'string'
      or pg_catalog.jsonb_typeof(v_context->'assertions') <> 'array'
      or pg_catalog.jsonb_array_length(v_context->'assertions') = 0
      or pg_catalog.jsonb_array_length(v_context->'assertions') > 32
    then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'context_shape_invalid'); end if;
    v_row_ref := v_context->>'row_ref';
    if v_row_ref !~ ('^row:' || p_form || ':[0-9]+$') then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_invalid'); end if;
    v_row_index := pg_catalog.split_part(v_row_ref, ':', 3)::integer;
    if v_desired ? v_row_ref then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_duplicate'); end if;

    if p_form = 'form4' then
      select acquired_disposed_code, direct_or_indirect_ownership, transaction_kind, is_10b5_1,
        reporting_owner_names, evidence, calculation_basis, security_title
      into v_direct_code, v_direct_ownership, v_transaction_kind, v_direct_10b5_1,
        v_owner_names, v_evidence, v_calculation_basis, v_security_title
      from public.event_form4_transactions where event_id = p_event_id and transaction_index = v_row_index;
    else
      select null, null, null, null, reporting_owner_names, evidence, calculation_basis, security_title
      into v_direct_code, v_direct_ownership, v_transaction_kind, v_direct_10b5_1,
        v_owner_names, v_evidence, v_calculation_basis, v_security_title
      from public.event_form144_proposed_sales where event_id = p_event_id and proposed_sale_index = v_row_index;
    end if;
    if not found then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'row_ref_missing'); end if;

    if exists (
      select 1 from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
      where item.value->>'fact' = 'ownership_relation'
      group by item.value->>'owner_ref' having pg_catalog.count(*) > 1
    ) then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_duplicate'); end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
      where item.value->>'fact' = 'footnote_scope'
      group by item.value->>'footnote_ref', coalesce(item.value->>'owner_ref', ''), coalesce(item.value->>'security_ref', '')
      having pg_catalog.count(*) > 1
    ) then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_duplicate'); end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
      where item.value->>'fact' not in ('ownership_relation', 'footnote_scope')
      group by item.value->>'fact' having pg_catalog.count(*) > 1
    ) then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_fact_duplicate'); end if;

    for v_assertion in select item.value from pg_catalog.jsonb_array_elements(v_context->'assertions') as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_assertion) <> 'object'
        or exists (select 1 from pg_catalog.jsonb_object_keys(v_assertion) as key(value)
          where key.value not in ('fact', 'status', 'value', 'owner_ref', 'security_ref', 'footnote_ref', 'evidence_refs'))
        or not (v_assertion ? 'fact' and v_assertion ? 'status' and v_assertion ? 'evidence_refs')
        or pg_catalog.jsonb_typeof(v_assertion->'fact') <> 'string'
        or pg_catalog.jsonb_typeof(v_assertion->'status') <> 'string'
        or pg_catalog.jsonb_typeof(v_assertion->'evidence_refs') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(v_assertion->'evidence_refs') as evidence(value)
          where pg_catalog.jsonb_typeof(evidence.value) <> 'string' or pg_catalog.length(pg_catalog.btrim(evidence.value#>>'{}')) = 0)
        or (v_assertion ? 'owner_ref' and (pg_catalog.jsonb_typeof(v_assertion->'owner_ref') <> 'string'
          or pg_catalog.length(pg_catalog.btrim(v_assertion->>'owner_ref')) = 0))
        or (v_assertion ? 'security_ref' and (pg_catalog.jsonb_typeof(v_assertion->'security_ref') <> 'string'
          or pg_catalog.length(pg_catalog.btrim(v_assertion->>'security_ref')) = 0))
        or (v_assertion ? 'footnote_ref' and (pg_catalog.jsonb_typeof(v_assertion->'footnote_ref') <> 'string'
          or pg_catalog.length(pg_catalog.btrim(v_assertion->>'footnote_ref')) = 0))
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_shape_invalid'); end if;
      v_fact := v_assertion->>'fact'; v_status := v_assertion->>'status'; v_value := v_assertion->'value';
      if v_fact not in ('owner_attribution', 'ownership_relation', 'economic_direction', 'derivative_underlying_relation',
        'rule_10b5_1_applicability', 'footnote_scope', 'amendment_effect')
        or v_status not in ('supported', 'ambiguous', 'conflict', 'unresolved')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_enum_invalid'); end if;
      if (v_status = 'supported' and (not (v_assertion ? 'value') or pg_catalog.jsonb_array_length(v_assertion->'evidence_refs') = 0))
        or (v_status <> 'supported' and v_assertion ? 'value')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_support_invalid'); end if;
      if v_status = 'supported' and pg_catalog.jsonb_typeof(v_value) = 'null'
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_value_invalid'); end if;

      for v_ref in select item.value from pg_catalog.jsonb_array_elements_text(v_assertion->'evidence_refs') as item(value)
      loop
        v_ref_parts := pg_catalog.string_to_array(v_ref, ':');
        if pg_catalog.array_length(v_ref_parts, 1) <> 4 or v_ref_parts[1] <> 'evidence' or v_ref_parts[2] <> p_form
          or v_ref_parts[3] !~ '^[0-9]+$' or v_ref_parts[4] !~ '^[0-9]+$'
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'evidence_ref_invalid'); end if;
        if v_ref_parts[3]::integer <> v_row_index
          or v_ref_parts[4]::integer >= pg_catalog.jsonb_array_length(v_evidence)
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'evidence_ref_invalid'); end if;
      end loop;

      if v_assertion ? 'owner_ref' then
        v_ref_parts := pg_catalog.string_to_array(v_assertion->>'owner_ref', ':');
        if pg_catalog.array_length(v_ref_parts, 1) <> 4 or v_ref_parts[1] <> 'owner' or v_ref_parts[2] <> p_form
          or v_ref_parts[3] !~ '^[0-9]+$' or v_ref_parts[4] !~ '^[0-9]+$'
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_ref_invalid'); end if;
        if v_ref_parts[3]::integer <> v_row_index
          or v_ref_parts[4]::integer >= pg_catalog.jsonb_array_length(v_owner_names)
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_ref_invalid'); end if;
      end if;
      if v_assertion ? 'security_ref' and v_assertion->>'security_ref' <> ('security:' || p_form || ':' || v_row_index::text)
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'security_ref_invalid'); end if;
      v_footnote_id := null;
      if v_assertion ? 'footnote_ref' then
        if v_assertion->>'footnote_ref' !~ '^footnote:[A-Za-z0-9_.-]+$'
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_ref_invalid'); end if;
        v_footnote_id := pg_catalog.substr(v_assertion->>'footnote_ref', 10);
        if not coalesce(v_calculation_basis->'footnote_ids', '[]'::jsonb) ? v_footnote_id
          or not public.ownership_context_xml_row_has_footnote(
            v_raw.raw_payload->>'ownership_source_text', p_form, v_row_index, v_footnote_id)
          or public.ownership_context_xml_footnote_text(v_raw.raw_payload->>'ownership_source_text', v_footnote_id) is null
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_row_link_invalid'); end if;
      end if;

      if p_form = 'form144' and v_fact = 'ownership_relation'
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ownership_relation_not_applicable'); end if;
      if p_form = 'form144' and v_fact = 'rule_10b5_1_applicability'
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_not_applicable'); end if;
      if v_fact = 'owner_attribution' and (v_assertion ? 'owner_ref' or v_assertion ? 'security_ref' or v_assertion ? 'footnote_ref')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_invalid'); end if;
      if v_fact = 'economic_direction' and (v_assertion ? 'owner_ref' or v_assertion ? 'footnote_ref')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_invalid'); end if;
      if v_fact = 'derivative_underlying_relation' and (v_assertion ? 'owner_ref' or not (v_assertion ? 'security_ref'))
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_invalid'); end if;
      if v_fact = 'footnote_scope' and not (v_assertion ? 'footnote_ref')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_scope_invalid'); end if;
      if v_fact = 'amendment_effect' and (v_assertion ? 'owner_ref' or v_assertion ? 'security_ref' or v_assertion ? 'footnote_ref')
      then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'assertion_subject_invalid'); end if;

      if v_status = 'supported' and v_fact = 'owner_attribution' then
        if pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_value#>>'{}' !~ ('^owner:' || p_form || ':' || v_row_index::text || ':[0-9]+$')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_value_ref_invalid'); end if;
        v_ref_index := pg_catalog.split_part(v_value#>>'{}', ':', 4)::integer;
        if v_ref_index >= pg_catalog.jsonb_array_length(v_owner_names)
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'owner_value_ref_missing'); end if;
      elsif v_status = 'supported' and v_fact = 'ownership_relation' then
        if p_form <> 'form4' or pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_value#>>'{}' not in ('direct', 'indirect') or not (v_assertion ? 'owner_ref')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ownership_relation_not_applicable'); end if;
        v_ref_index := pg_catalog.split_part(v_assertion->>'owner_ref', ':', 4)::integer;
        v_owner_name := v_owner_names->>v_ref_index;
        if pg_catalog.jsonb_array_length(v_owner_names) = 1 then
          if v_direct_ownership is null or (v_direct_ownership = 'D') <> (v_value#>>'{}' = 'direct')
          then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ownership_relation_xml_conflict'); end if;
        elsif v_footnote_id is null or not public.ownership_context_owner_relation_supported(
          v_raw.raw_payload->>'ownership_source_text', v_footnote_id, v_owner_name, v_value#>>'{}')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'ownership_relation_owner_evidence_invalid'); end if;
      elsif v_status = 'supported' and v_fact = 'economic_direction' then
        if pg_catalog.jsonb_typeof(v_value) <> 'string' or v_value#>>'{}' not in ('buy', 'sell', 'other')
          or (v_direct_code = 'A' and v_value#>>'{}' = 'sell') or (v_direct_code = 'D' and v_value#>>'{}' = 'buy')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'economic_direction_xml_conflict'); end if;
      elsif v_status = 'supported' and v_fact = 'derivative_underlying_relation' then
        if p_form <> 'form4' or pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_transaction_kind <> 'derivative' or v_calculation_basis->>'underlying_security_title' is null
          or public.ownership_context_xml_row_underlying_title(
            v_raw.raw_payload->>'ownership_source_text', v_row_index) is distinct from v_calculation_basis->>'underlying_security_title'
          or v_value#>>'{}' <> ('security:form4:underlying:' || v_row_index::text)
          or v_assertion->>'security_ref' <> ('security:form4:' || v_row_index::text)
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'underlying_security_ref_invalid'); end if;
      elsif v_status = 'supported' and v_fact = 'rule_10b5_1_applicability' then
        if p_form <> 'form4' or pg_catalog.jsonb_typeof(v_value) <> 'boolean'
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_not_applicable'); end if;
        if v_direct_10b5_1 is not null and (v_value#>>'{}')::boolean is distinct from v_direct_10b5_1
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_xml_conflict'); end if;
        if v_filing_10b5_1 is not null and (v_value#>>'{}')::boolean is distinct from v_filing_10b5_1
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_xml_conflict'); end if;
        if (v_value#>>'{}')::boolean and (v_footnote_id is null
          or not public.ownership_context_footnote_supports_10b5_1(v_raw.raw_payload->>'ownership_source_text', v_footnote_id))
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_owner_evidence_invalid'); end if;
        if (v_value#>>'{}')::boolean and v_assertion ? 'owner_ref' then
          v_ref_index := pg_catalog.split_part(v_assertion->>'owner_ref', ':', 4)::integer;
          v_owner_name := v_owner_names->>v_ref_index;
          if not public.ownership_context_footnote_mentions_owner(v_raw.raw_payload->>'ownership_source_text', v_footnote_id, v_owner_name)
          then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_owner_evidence_invalid'); end if;
        end if;
        if not (v_value#>>'{}')::boolean and v_direct_10b5_1 is null and v_filing_10b5_1 is distinct from false
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'rule_10b5_1_source_missing'); end if;
      elsif v_status = 'supported' and v_fact = 'footnote_scope' then
        if pg_catalog.jsonb_typeof(v_value) <> 'string' or v_footnote_id is null
          or v_value#>>'{}' not in ('row', 'owner', 'security', 'filing')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_scope_invalid'); end if;
        if v_value#>>'{}' = 'owner' then
          if not (v_assertion ? 'owner_ref') then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_scope_owner_missing'); end if;
          v_ref_index := pg_catalog.split_part(v_assertion->>'owner_ref', ':', 4)::integer;
          v_owner_name := v_owner_names->>v_ref_index;
          if not public.ownership_context_footnote_establishes_owner_scope(v_raw.raw_payload->>'ownership_source_text', v_footnote_id, v_owner_name)
          then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_scope_owner_evidence_invalid'); end if;
        elsif v_value#>>'{}' = 'security' then
          if v_assertion->>'security_ref' <> ('security:' || p_form || ':' || v_row_index::text)
            or not public.ownership_context_footnote_mentions_security(v_raw.raw_payload->>'ownership_source_text', v_footnote_id, v_security_title)
          then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'footnote_scope_security_evidence_invalid'); end if;
        end if;
      elsif v_status = 'supported' and v_fact = 'amendment_effect' then
        if pg_catalog.jsonb_typeof(v_value) <> 'string'
          or v_value#>>'{}' not in ('adds', 'modifies', 'removes', 'restates', 'no_change')
          or pg_catalog.upper(pg_catalog.regexp_replace(pg_catalog.btrim(v_event.metadata->>'form_type'), '^FORM[[:space:]]+', '')) not in ('4/A', '144/A')
        then return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'amendment_effect_not_applicable'); end if;
      end if;
    end loop;

    v_envelope := pg_catalog.jsonb_build_object('version', 'ownership_context_v1', 'source_fingerprint', p_source_fingerprint,
      'assertions', v_context->'assertions');
    if p_ai_run_id is not null then v_envelope := v_envelope || pg_catalog.jsonb_build_object('ai_refs',
      pg_catalog.jsonb_build_object('run_id', p_ai_run_id, 'output_id', p_ai_output_id)); end if;
    v_desired := v_desired || pg_catalog.jsonb_build_object(v_row_ref, v_envelope);
    if p_form = 'form4' then select context_facts into v_existing_context from public.event_form4_transactions
      where event_id = p_event_id and transaction_index = v_row_index for update;
    else select context_facts into v_existing_context from public.event_form144_proposed_sales
      where event_id = p_event_id and proposed_sale_index = v_row_index for update; end if;
    if v_existing_context is distinct from v_envelope then v_is_replay := false; end if;
  end loop;

  if p_form = 'form4' then select pg_catalog.count(*) into v_existing_count from public.event_form4_transactions
    where event_id = p_event_id and context_facts is not null;
  else select pg_catalog.count(*) into v_existing_count from public.event_form144_proposed_sales
    where event_id = p_event_id and context_facts is not null; end if;
  if v_existing_count <> pg_catalog.jsonb_array_length(p_contexts) then v_is_replay := false; end if;
  if v_is_replay then return pg_catalog.jsonb_build_object('status', 'replayed', 'updated_row_count', 0,
    'source_fingerprint', p_source_fingerprint); end if;

  if p_form = 'form4' then
    update public.event_form4_transactions set context_facts = null where event_id = p_event_id and context_facts is not null;
    get diagnostics v_updated_count = row_count;
    update public.event_form4_transactions as target set context_facts = v_desired->('row:form4:' || target.transaction_index::text)
      where target.event_id = p_event_id and v_desired ? ('row:form4:' || target.transaction_index::text);
    v_updated_count := greatest(v_updated_count, pg_catalog.jsonb_array_length(p_contexts));
  else
    update public.event_form144_proposed_sales set context_facts = null where event_id = p_event_id and context_facts is not null;
    get diagnostics v_updated_count = row_count;
    update public.event_form144_proposed_sales as target set context_facts = v_desired->('row:form144:' || target.proposed_sale_index::text)
      where target.event_id = p_event_id and v_desired ? ('row:form144:' || target.proposed_sale_index::text);
    v_updated_count := greatest(v_updated_count, pg_catalog.jsonb_array_length(p_contexts));
  end if;
  return pg_catalog.jsonb_build_object('status', 'stored', 'updated_row_count', v_updated_count,
    'source_fingerprint', p_source_fingerprint);
end;
$function$;

revoke all on function public.ownership_context_footnote_establishes_owner_scope(text, text, text) from public, anon, authenticated;
grant execute on function public.ownership_context_footnote_establishes_owner_scope(text, text, text) to service_role;

