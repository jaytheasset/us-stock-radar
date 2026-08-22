-- Forward Stock Split Canonical & Execution Contract V1.
--
-- This extends the existing immutable Corporate Action fact lineage and the
-- locked reverse-split execution contract. It adds no execution table, O/S
-- arithmetic, backfill, scheduler, or public write surface.

alter table public.event_corporate_action_facts
  drop constraint event_corporate_action_facts_schema_version_check,
  drop constraint event_corporate_action_facts_event_kind_check,
  drop constraint event_corporate_action_facts_payload_shape_check,
  drop constraint event_corporate_action_facts_applicability_materialization_check,
  add constraint event_corporate_action_facts_schema_version_check check (
    (event_kind = 'reverse_split'
      and fact_schema_version = 'corporate_action_reverse_split_facts_v1')
    or
    (event_kind = 'forward_split'
      and fact_schema_version = 'corporate_action_forward_split_facts_v1')
  ),
  add constraint event_corporate_action_facts_event_kind_check
    check (event_kind in ('reverse_split', 'forward_split')),
  add constraint event_corporate_action_facts_payload_shape_check check (
    pg_catalog.jsonb_typeof(facts_payload) = 'object'
    and facts_payload->>'version' = fact_schema_version
    and facts_payload->>'event_kind' = event_kind
    and facts_payload->>'action_stage' = action_stage
    and facts_payload->>'source_ref' = source_ref
    and facts_payload->>'confidence' = confidence
    and pg_catalog.jsonb_typeof(facts_payload->'effective_date') = 'object'
    and pg_catalog.jsonb_typeof(facts_payload#>'{ratio,old_shares_per_new_share}') = 'object'
    and pg_catalog.jsonb_typeof(facts_payload->'evidence') = 'object'
    and pg_catalog.jsonb_typeof(facts_payload->'as_of') = 'object'
    and pg_catalog.jsonb_typeof(facts_payload->'source') = 'object'
  ),
  add constraint event_corporate_action_facts_applicability_materialization_check check (coalesce((
    (applicability_payload is null
      and issuer_cik is null
      and applicability_status is null
      and affected_security_type is null
      and canonical_security_class_id is null)
    or
    (pg_catalog.jsonb_typeof(applicability_payload) = 'object'
      and (
        (event_kind = 'reverse_split'
          and applicability_payload ->> 'version' = 'reverse_split_applicability_v1'
          and applicability_payload ->> 'basis_change_capability' = 'reverse_split_only')
        or
        (event_kind = 'forward_split'
          and applicability_payload ->> 'version' = 'forward_split_applicability_v1'
          and applicability_payload ->> 'basis_change_capability' = 'forward_split_only')
      )
      and applicability_status in ('mapped', 'unavailable')
      and (
        (applicability_status = 'mapped'
          and applicability_payload #>> '{issuer,availability}' = 'available'
          and issuer_cik = applicability_payload #>> '{issuer,issuer_cik}'
          and issuer_cik ~ '^[0-9]{10}$'
          and applicability_payload #>> '{affected_security,availability}' = 'available'
          and affected_security_type = 'common_stock'
          and affected_security_type = applicability_payload #>> '{affected_security,security_type}'
          and canonical_security_class_id = applicability_payload #>> '{affected_security,canonical_security_class_id}'
          and applicability_payload #>> '{affected_security,evidence,availability}' = 'available'
          and pg_catalog.btrim(coalesce(applicability_payload #>> '{affected_security,source_ref}', '')) <> ''
          and pg_catalog.btrim(coalesce(applicability_payload #>> '{affected_security,source_security_title}', '')) <> ''
          and canonical_security_class_id ~ (
            '^sc:v1:' || issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
          ))
        or
        (applicability_status = 'unavailable'
          and canonical_security_class_id is null
          and affected_security_type is null
          and applicability_payload #>> '{affected_security,availability}' = 'unavailable'
          and (
            (applicability_payload #>> '{issuer,availability}' = 'available'
              and issuer_cik = applicability_payload #>> '{issuer,issuer_cik}')
            or
            (applicability_payload #>> '{issuer,availability}' = 'unavailable'
              and issuer_cik is null)
          ))
      ))
  ), false)),
  add constraint event_corporate_action_facts_forward_ratio_direction_check check (
    event_kind <> 'forward_split'
    or ratio_old_share_units is null
    or ratio_new_share_units > ratio_old_share_units
  );

create or replace function public.materialize_reverse_split_applicability_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_applicability jsonb := new.facts_payload -> 'applicability';
  v_issuer jsonb;
  v_affected jsonb;
  v_exact_ratio jsonb := new.facts_payload #> '{ratio,exact_source_components}';
  v_timing jsonb := new.facts_payload -> 'effective_timing';
  v_accession text;
  v_expected_applicability_version text;
  v_expected_basis_capability text;
  v_action_prefix text;
  v_ledger public.sec_filing_ledger%rowtype;
begin
  if new.event_kind = 'reverse_split' then
    v_expected_applicability_version := 'reverse_split_applicability_v1';
    v_expected_basis_capability := 'reverse_split_only';
    v_action_prefix := 'reverse_split';
  elsif new.event_kind = 'forward_split' then
    v_expected_applicability_version := 'forward_split_applicability_v1';
    v_expected_basis_capability := 'forward_split_only';
    v_action_prefix := 'forward_split';
  else
    raise exception 'stock_split_event_kind_invalid';
  end if;

  if v_applicability is not null then
    if pg_catalog.jsonb_typeof(v_applicability) <> 'object'
      or v_applicability ->> 'version' <> v_expected_applicability_version
      or v_applicability ->> 'basis_change_capability' <> v_expected_basis_capability
    then
      raise exception '%', v_action_prefix || '_applicability_payload_invalid';
    end if;
    v_issuer := v_applicability -> 'issuer';
    v_affected := v_applicability -> 'affected_security';
    if v_issuer #>> '{availability}' = 'available' then
      new.issuer_cik := v_issuer ->> 'issuer_cik';
      v_accession := v_issuer ->> 'accession_number';
      select ledger.* into v_ledger
      from public.sec_filing_ledger as ledger
      where ledger.accession_number = v_accession
        and ledger.issuer_cik = new.issuer_cik;
      if new.source_family <> 'sec'
        or new.source_id is distinct from v_accession
        or not found
      then
        raise exception '%', v_action_prefix || '_issuer_lineage_invalid';
      end if;
    elsif v_issuer #>> '{availability}' = 'unavailable' then
      new.issuer_cik := null;
    else
      raise exception '%', v_action_prefix || '_issuer_availability_invalid';
    end if;

    new.applicability_payload := v_applicability;
    if v_affected #>> '{availability}' = 'available' then
      if new.issuer_cik is null then
        raise exception '%', v_action_prefix || '_affected_security_requires_issuer';
      end if;
      new.applicability_status := 'mapped';
      new.affected_security_type := v_affected ->> 'security_type';
      new.canonical_security_class_id := v_affected ->> 'canonical_security_class_id';
      if v_ledger.accepted_at is null or not exists (
        select 1 from public.share_count_history as support
        where support.issuer_cik = new.issuer_cik
          and support.canonical_security_class_id = new.canonical_security_class_id
          and support.canonical_security_class_status = 'mapped'
          and support.canonical_security_class_kind = 'common_stock'
          and support.source_type = 'sec_authoritative_os'
          and support.accepted_at is not null
          and support.accepted_at <= v_ledger.accepted_at
      ) then
        raise exception '%', v_action_prefix || '_canonical_security_class_support_unavailable';
      end if;
    elsif v_affected #>> '{availability}' = 'unavailable' then
      new.applicability_status := 'unavailable';
      new.affected_security_type := null;
      new.canonical_security_class_id := null;
    else
      raise exception '%', v_action_prefix || '_affected_security_availability_invalid';
    end if;
  end if;

  if v_exact_ratio is not null then
    if v_exact_ratio ->> 'availability' = 'available' then
      new.ratio_old_share_units := (v_exact_ratio ->> 'old_share_units')::numeric;
      new.ratio_new_share_units := (v_exact_ratio ->> 'new_share_units')::numeric;
      if new.event_kind = 'forward_split'
        and new.ratio_new_share_units <= new.ratio_old_share_units
      then
        raise exception 'forward_split_ratio_orientation_invalid';
      end if;
    elsif v_exact_ratio ->> 'availability' <> 'unavailable' then
      raise exception '%', v_action_prefix || '_exact_ratio_invalid';
    end if;
  end if;

  if v_timing is not null then
    new.effective_timing_payload := v_timing;
    new.effective_timing_status := v_timing ->> 'availability';
    if new.effective_timing_status = 'available' then
      new.effective_timing_kind := v_timing ->> 'kind';
      new.effective_timestamp := case when new.effective_timing_kind = 'exact_timestamp'
        then (v_timing ->> 'timestamp')::timestamptz else null end;
    elsif new.effective_timing_status <> 'unavailable' then
      raise exception '%', v_action_prefix || '_effective_timing_invalid';
    end if;
  end if;
  return new;
end
$function$;

-- Keep the locked lineage and current-reader bodies byte-for-byte except for
-- their two fact-kind gates. Exact guarded replacement avoids forking either
-- security-definer function into a parallel persistence path.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or p_expected_result#>>'{facts,version}' <> 'corporate_action_reverse_split_facts_v1'
      or p_expected_result#>>'{facts,event_kind}' <> 'reverse_split'$old$;
  v_new := $new$or not (
        (p_expected_result#>>'{facts,version}' = 'corporate_action_reverse_split_facts_v1'
          and p_expected_result#>>'{facts,event_kind}' = 'reverse_split')
        or
        (p_expected_result#>>'{facts,version}' = 'corporate_action_forward_split_facts_v1'
          and p_expected_result#>>'{facts,event_kind}' = 'forward_split')
      )$new$;
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'corporate_action_persistence_contract_source_unexpected';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);

  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_corporate_action_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$or v_facts.fact_schema_version <> 'corporate_action_reverse_split_facts_v1'$old$;
  v_new := $new$or not (
      (v_facts.fact_schema_version = 'corporate_action_reverse_split_facts_v1'
        and v_facts.event_kind = 'reverse_split')
      or
      (v_facts.fact_schema_version = 'corporate_action_forward_split_facts_v1'
        and v_facts.event_kind = 'forward_split')
    )$new$;
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'corporate_action_current_reader_contract_source_unexpected';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

create index event_corporate_action_facts_forward_split_history_idx
  on public.event_corporate_action_facts (
    issuer_cik,
    canonical_security_class_id,
    effective_date,
    source_execution_id
  )
  where event_kind = 'forward_split' and applicability_status = 'mapped';

create index event_corporate_action_facts_forward_execution_update_idx
  on public.event_corporate_action_facts (issuer_cik, source_execution_id)
  where event_kind = 'forward_split'
    and facts_payload ? 'execution_update';

create or replace function public.read_stock_split_history_candidates(
  p_action_kind text,
  p_issuer_cik text,
  p_canonical_security_class_id text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_action_kind not in ('reverse_split', 'forward_split')
    or p_issuer_cik !~ '^[0-9]{10}$'
    or p_from is null or p_to is null or p_from > p_to
    or (p_canonical_security_class_id is not null and p_canonical_security_class_id !~ (
      '^sc:v1:' || p_issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
    ))
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'action_kind', p_action_kind,
    'issuer_cik', p_issuer_cik,
    'canonical_security_class_id', p_canonical_security_class_id,
    'from', p_from,
    'to', p_to,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', facts.event_id,
        'source_execution_id', facts.source_execution_id,
        'issuer_cik', facts.issuer_cik,
        'canonical_security_class_id', facts.canonical_security_class_id,
        'effective_date', facts.effective_date,
        'effective_timing', facts.effective_timing_payload,
        'facts', facts.facts_payload,
        'persisted_at', facts.persisted_at
      ) order by facts.effective_date, facts.source_execution_id)
      from public.event_corporate_action_facts as facts
      where facts.event_kind = p_action_kind
        and facts.applicability_status = 'mapped'
        and facts.issuer_cik = p_issuer_cik
        and (p_canonical_security_class_id is null
          or facts.canonical_security_class_id = p_canonical_security_class_id)
        and facts.effective_date between p_from and p_to
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.read_stock_split_execution_update_candidates(
  p_action_kind text,
  p_issuer_cik text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_action_kind not in ('reverse_split', 'forward_split')
    or p_issuer_cik !~ '^[0-9]{10}$'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'action_kind', p_action_kind,
    'issuer_cik', p_issuer_cik,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', candidate.event_id,
        'source_execution_id', candidate.source_execution_id,
        'persisted_at', candidate.persisted_at
      ) order by candidate.persisted_at, candidate.source_execution_id)
      from (
        select facts.event_id, facts.source_execution_id, facts.persisted_at
        from public.event_corporate_action_facts as facts
        where facts.event_kind = p_action_kind
          and facts.issuer_cik = p_issuer_cik
          and facts.facts_payload ? 'execution_update'
        order by facts.persisted_at desc, facts.source_execution_id desc
        limit 512
      ) as candidate
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.read_stock_split_history_candidates(text, text, text, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.read_stock_split_execution_update_candidates(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_stock_split_history_candidates(text, text, text, date, date)
  to service_role;
grant execute on function public.read_stock_split_execution_update_candidates(text, text)
  to service_role;

comment on table public.event_corporate_action_facts is
  'Server-only canonical reverse- and forward-stock-split facts for applicable exact executions.';
comment on function public.persist_corporate_action_analyzer_result(uuid, uuid, jsonb) is
  'Persists one validated stock-split analyzer result after exact Generic Monitor lineage and current-parent checks.';
comment on function public.read_stock_split_history_candidates(text, text, text, date, date) is
  'Returns mapped source-backed candidates for exactly one explicit stock-split action kind; performs no share arithmetic.';
comment on function public.read_stock_split_execution_update_candidates(text, text) is
  'Returns bounded update-lineage candidates for exactly one explicit stock-split action kind; performs no lifecycle inference or share arithmetic.';
