-- Reverse Split Applicability & History Contract V1.
-- Extends the existing immutable Corporate Action fact row. It intentionally
-- performs no share-count arithmetic and creates no parallel action table.

alter table public.event_corporate_action_facts
  add column issuer_cik text references public.sec_issuers(cik),
  add column applicability_status text,
  add column affected_security_type text,
  add column canonical_security_class_id text,
  add column applicability_payload jsonb,
  add column ratio_old_share_units numeric,
  add column ratio_new_share_units numeric,
  add column effective_timing_status text,
  add column effective_timing_kind text,
  add column effective_timestamp timestamptz,
  add column effective_timing_payload jsonb;

alter table public.event_corporate_action_facts
  add constraint event_corporate_action_facts_applicability_materialization_check
    check (coalesce((
      (applicability_payload is null
        and issuer_cik is null
        and applicability_status is null
        and affected_security_type is null
        and canonical_security_class_id is null)
      or
      (pg_catalog.jsonb_typeof(applicability_payload) = 'object'
        and applicability_payload ->> 'version' = 'reverse_split_applicability_v1'
        and applicability_payload ->> 'basis_change_capability' = 'reverse_split_only'
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
  add constraint event_corporate_action_facts_exact_ratio_materialization_check
    check (coalesce((
      (facts_payload #> '{ratio,exact_source_components}' is null
        and ratio_old_share_units is null
        and ratio_new_share_units is null)
      or
      (facts_payload #>> '{ratio,exact_source_components,availability}' = 'unavailable'
        and ratio_old_share_units is null
        and ratio_new_share_units is null)
      or
      (facts_payload #>> '{ratio,exact_source_components,availability}' = 'available'
        and ratio_old_share_units = (facts_payload #>> '{ratio,exact_source_components,old_share_units}')::numeric
        and ratio_new_share_units = (facts_payload #>> '{ratio,exact_source_components,new_share_units}')::numeric
        and ratio_old_share_units > 0
        and ratio_new_share_units > 0
        and old_shares_per_new_share = ratio_old_share_units / ratio_new_share_units)
    ), false)),
  add constraint event_corporate_action_facts_effective_timing_materialization_check
    check (coalesce((
      (effective_timing_payload is null
        and effective_timing_status is null
        and effective_timing_kind is null
        and effective_timestamp is null)
      or
      (pg_catalog.jsonb_typeof(effective_timing_payload) = 'object'
        and effective_timing_status = effective_timing_payload ->> 'availability'
        and effective_timing_status in ('available', 'unavailable')
        and (
          (effective_timing_status = 'unavailable'
            and effective_timing_kind is null
            and effective_timestamp is null
            and effective_timing_payload ->> 'reason' in ('not_provided', 'date_only', 'ambiguous'))
          or
          (effective_timing_status = 'available'
            and effective_timing_kind = effective_timing_payload ->> 'kind'
            and effective_timing_payload #>> '{evidence,availability}' = 'available'
            and pg_catalog.btrim(coalesce(effective_timing_payload ->> 'source_ref', '')) <> ''
            and effective_timing_kind in ('market_open', 'start_of_trading', 'after_market_close', 'exact_timestamp')
            and (
              (effective_timing_kind = 'exact_timestamp'
                and effective_timestamp = (effective_timing_payload ->> 'timestamp')::timestamptz)
              or
              (effective_timing_kind <> 'exact_timestamp'
                and effective_timestamp is null
                and effective_timing_payload -> 'timestamp' = 'null'::jsonb)
            ))
        ))
    ), false));

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
  v_ledger public.sec_filing_ledger%rowtype;
begin
  if v_applicability is not null then
    if pg_catalog.jsonb_typeof(v_applicability) <> 'object'
      or v_applicability ->> 'version' <> 'reverse_split_applicability_v1'
      or v_applicability ->> 'basis_change_capability' <> 'reverse_split_only'
    then
      raise exception 'reverse_split_applicability_payload_invalid';
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
        raise exception 'reverse_split_issuer_lineage_invalid';
      end if;
    elsif v_issuer #>> '{availability}' = 'unavailable' then
      new.issuer_cik := null;
    else
      raise exception 'reverse_split_issuer_availability_invalid';
    end if;

    new.applicability_payload := v_applicability;
    if v_affected #>> '{availability}' = 'available' then
      if new.issuer_cik is null then
        raise exception 'reverse_split_affected_security_requires_issuer';
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
        raise exception 'reverse_split_canonical_security_class_support_unavailable';
      end if;
    elsif v_affected #>> '{availability}' = 'unavailable' then
      new.applicability_status := 'unavailable';
      new.affected_security_type := null;
      new.canonical_security_class_id := null;
    else
      raise exception 'reverse_split_affected_security_availability_invalid';
    end if;
  end if;

  if v_exact_ratio is not null then
    if v_exact_ratio ->> 'availability' = 'available' then
      new.ratio_old_share_units := (v_exact_ratio ->> 'old_share_units')::numeric;
      new.ratio_new_share_units := (v_exact_ratio ->> 'new_share_units')::numeric;
    elsif v_exact_ratio ->> 'availability' <> 'unavailable' then
      raise exception 'reverse_split_exact_ratio_invalid';
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
      raise exception 'reverse_split_effective_timing_invalid';
    end if;
  end if;
  return new;
end
$function$;

create trigger materialize_reverse_split_applicability_v1
before insert on public.event_corporate_action_facts
for each row execute function public.materialize_reverse_split_applicability_v1();

create index event_corporate_action_facts_reverse_split_history_idx
  on public.event_corporate_action_facts (
    issuer_cik,
    canonical_security_class_id,
    effective_date,
    source_execution_id
  )
  where event_kind = 'reverse_split' and applicability_status = 'mapped';

create or replace function public.read_corporate_action_applicability_context(
  p_event_id uuid,
  p_raw_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_raw public.raw_items%rowtype;
  v_payload_accession text;
  v_source_accession text;
  v_accession text;
  v_ledger public.sec_filing_ledger%rowtype;
  v_candidates jsonb := '[]'::jsonb;
begin
  if p_event_id is null or p_raw_item_id is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'filing_ledger_identity_unavailable');
  end if;
  select event_row.* into v_event
  from public.events as event_row
  where event_row.id = p_event_id and event_row.raw_item_id = p_raw_item_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'filing_ledger_identity_unavailable');
  end if;
  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = p_raw_item_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'filing_ledger_identity_unavailable');
  end if;
  if v_event.source_group::text <> 'filings' or v_event.source_code <> 'sec_edgar' then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'non_sec_source');
  end if;

  v_payload_accession := pg_catalog.btrim(coalesce(v_raw.raw_payload ->> 'accession_number', ''));
  v_source_accession := pg_catalog.btrim(coalesce(v_raw.source_unique_id, ''));
  if v_payload_accession <> '' and v_payload_accession !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' then
    v_payload_accession := '';
  end if;
  if v_source_accession <> '' and v_source_accession !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' then
    v_source_accession := '';
  end if;
  if v_payload_accession <> '' and v_source_accession <> ''
    and v_payload_accession is distinct from v_source_accession
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'filing_ledger_identity_conflict');
  end if;
  v_accession := nullif(coalesce(nullif(v_payload_accession, ''), nullif(v_source_accession, '')), '');
  if v_accession is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'accession_unavailable');
  end if;
  select ledger.* into v_ledger
  from public.sec_filing_ledger as ledger
  where ledger.accession_number = v_accession;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'unavailable', 'reason', 'filing_ledger_identity_unavailable');
  end if;

  if v_ledger.accepted_at is not null then
    select coalesce(pg_catalog.jsonb_agg(candidate.payload order by candidate.class_id), '[]'::jsonb)
      into v_candidates
    from (
      select classes.class_id, pg_catalog.jsonb_build_object(
        'canonical_security_class_id', classes.class_id,
        'security_type', 'common_stock',
        'security_class_basis', classes.class_basis,
        'source_member_local_name', case when classes.class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'
          then pg_catalog.split_part(classes.class_id, ':', 6) else null end,
        'supporting_accessions', (
          select coalesce(pg_catalog.jsonb_agg(support.accession_number order by support.accepted_at desc), '[]'::jsonb)
          from (
            select distinct history.accession_number, history.accepted_at
            from public.share_count_history as history
            where history.issuer_cik = v_ledger.issuer_cik
              and history.canonical_security_class_id = classes.class_id
              and history.canonical_security_class_status = 'mapped'
              and history.source_type = 'sec_authoritative_os'
              and history.accepted_at is not null
              and history.accepted_at <= v_ledger.accepted_at
            order by history.accepted_at desc
            limit 12
          ) as support
        )
      ) as payload
      from (
        select history.canonical_security_class_id as class_id,
          pg_catalog.min(history.security_class_basis) as class_basis
        from public.share_count_history as history
        where history.issuer_cik = v_ledger.issuer_cik
          and history.canonical_security_class_status = 'mapped'
          and history.canonical_security_class_kind = 'common_stock'
          and history.source_type = 'sec_authoritative_os'
          and history.accepted_at is not null
          and history.accepted_at <= v_ledger.accepted_at
        group by history.canonical_security_class_id
        having pg_catalog.count(distinct history.security_class_basis) = 1
        order by history.canonical_security_class_id
        limit 24
      ) as classes
    ) as candidate;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'issuer_context', pg_catalog.jsonb_build_object(
      'availability', 'available',
      'issuer_cik', v_ledger.issuer_cik,
      'accession_number', v_ledger.accession_number,
      'accepted_at', v_ledger.accepted_at,
      'provenance', 'sec_filing_ledger'
    ),
    'security_class_candidates', v_candidates
  );
end
$function$;

create or replace function public.read_reverse_split_history_candidates(
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
  if p_issuer_cik !~ '^[0-9]{10}$'
    or p_from is null or p_to is null or p_from > p_to
    or (p_canonical_security_class_id is not null and p_canonical_security_class_id !~ (
      '^sc:v1:' || p_issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
    ))
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
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
      where facts.event_kind = 'reverse_split'
        and facts.applicability_status = 'mapped'
        and facts.issuer_cik = p_issuer_cik
        and (p_canonical_security_class_id is null
          or facts.canonical_security_class_id = p_canonical_security_class_id)
        and facts.effective_date between p_from and p_to
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.read_corporate_action_applicability_context(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_reverse_split_history_candidates(text, text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.read_corporate_action_applicability_context(uuid, uuid)
  to service_role;
grant execute on function public.read_reverse_split_history_candidates(text, text, date, date)
  to service_role;

comment on function public.read_corporate_action_applicability_context(uuid, uuid) is
  'Returns exact SEC filing-ledger CIK and pre-source-time canonical common-stock class candidates; no ticker or title mapping.';
comment on function public.read_reverse_split_history_candidates(text, text, date, date) is
  'Returns mapped reverse-split fact candidates for official application-level current-lineage verification; performs no share arithmetic.';
