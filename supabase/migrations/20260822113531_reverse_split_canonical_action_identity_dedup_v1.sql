-- Reverse Split Canonical Action Identity & Dedup V1.
-- Adds lifecycle identity to the existing immutable Corporate Action fact
-- history. It performs no share-count arithmetic and creates no parallel fact
-- table.

alter table public.event_corporate_action_facts
  add column reverse_split_action_id text,
  add column action_link_status text,
  add column action_origin_event_id uuid,
  add column action_link_payload jsonb;

alter table public.event_corporate_action_facts
  add constraint event_corporate_action_facts_action_identity_check
  check (coalesce((
    (facts_payload -> 'action_identity' is null
      and reverse_split_action_id is null
      and action_link_status is null
      and action_origin_event_id is null
      and action_link_payload is null)
    or
    (pg_catalog.jsonb_typeof(action_link_payload) = 'object'
      and action_link_payload = facts_payload -> 'action_identity'
      and action_link_payload ->> 'version' = 'reverse_split_action_identity_v1'
      and action_link_status in ('new_action', 'existing_action', 'unresolved')
      and (
        (action_link_status = 'unresolved'
          and action_link_payload ->> 'link_status' = 'unresolved'
          and action_link_payload ->> 'link_decision' = 'UNRESOLVED_ACTION_LINK'
          and action_link_payload -> 'reverse_split_action_id' = 'null'::jsonb
          and action_link_payload -> 'origin_event_id' = 'null'::jsonb
          and reverse_split_action_id is null
          and action_origin_event_id is null
          and action_link_payload ->> 'unresolved_reason' in (
            'issuer_or_security_class_unavailable',
            'no_safe_candidate',
            'ambiguous_candidate_match',
            'insufficient_source_evidence'
          ))
        or
        (action_link_status in ('new_action', 'existing_action')
          and action_link_payload ->> 'link_status' = 'linked'
          and action_link_payload ->> 'link_decision' = case action_link_status
            when 'new_action' then 'NEW_ACTION' else 'EXISTING_ACTION_ID' end
          and reverse_split_action_id = action_link_payload ->> 'reverse_split_action_id'
          and action_origin_event_id = (action_link_payload ->> 'origin_event_id')::uuid
          and reverse_split_action_id = (
            'rsa:v1:' || issuer_cik || ':' || action_origin_event_id::text
          )
          and reverse_split_action_id ~ (
            '^rsa:v1:' || issuer_cik || ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          and action_link_payload #>> '{evidence,availability}' = 'available'
          and pg_catalog.btrim(coalesce(action_link_payload ->> 'source_ref', '')) <> ''
          and action_link_payload -> 'unresolved_reason' = 'null'::jsonb)
      ))
  ), false));

create or replace function public.materialize_reverse_split_action_identity_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_identity jsonb := new.facts_payload -> 'action_identity';
  v_existing_origin uuid;
begin
  if v_identity is null then
    return new;
  end if;
  if pg_catalog.jsonb_typeof(v_identity) <> 'object'
    or v_identity ->> 'version' <> 'reverse_split_action_identity_v1'
  then
    raise exception 'reverse_split_action_identity_payload_invalid';
  end if;
  new.action_link_payload := v_identity;
  if v_identity ->> 'link_status' = 'unresolved' then
    if v_identity ->> 'link_decision' <> 'UNRESOLVED_ACTION_LINK' then
      raise exception 'reverse_split_action_unresolved_shape_invalid';
    end if;
    new.action_link_status := 'unresolved';
    new.reverse_split_action_id := null;
    new.action_origin_event_id := null;
    return new;
  end if;
  if v_identity ->> 'link_status' <> 'linked'
    or new.applicability_status <> 'mapped'
    or new.issuer_cik is null
    or new.canonical_security_class_id is null
  then
    raise exception 'reverse_split_action_link_requires_mapped_applicability';
  end if;
  new.reverse_split_action_id := v_identity ->> 'reverse_split_action_id';
  begin
    new.action_origin_event_id := (v_identity ->> 'origin_event_id')::uuid;
  exception when others then
    raise exception 'reverse_split_action_origin_invalid';
  end;
  if new.reverse_split_action_id is distinct from (
    'rsa:v1:' || new.issuer_cik || ':' || new.action_origin_event_id::text
  ) then
    raise exception 'reverse_split_action_id_invalid';
  end if;
  if v_identity ->> 'link_decision' = 'NEW_ACTION' then
    new.action_link_status := 'new_action';
    if new.action_origin_event_id is distinct from new.event_id
      or v_identity #>> '{provenance,rule}' <> 'llm_new_action_exact_source_evidence'
      or v_identity #> '{provenance,candidate_action_id}' <> 'null'::jsonb
    then
      raise exception 'reverse_split_new_action_origin_invalid';
    end if;
  elsif v_identity ->> 'link_decision' = 'EXISTING_ACTION_ID' then
    new.action_link_status := 'existing_action';
    if v_identity #>> '{provenance,rule}' <> 'llm_existing_candidate_exact_source_evidence'
      or v_identity #>> '{provenance,candidate_action_id}' is distinct from new.reverse_split_action_id
    then
      raise exception 'reverse_split_existing_action_provenance_invalid';
    end if;
    select facts.action_origin_event_id into v_existing_origin
    from public.event_corporate_action_facts as facts
    where facts.reverse_split_action_id = new.reverse_split_action_id
      and facts.action_link_status in ('new_action', 'existing_action')
      and facts.issuer_cik = new.issuer_cik
      and facts.canonical_security_class_id = new.canonical_security_class_id
    order by facts.persisted_at, facts.source_execution_id
    limit 1;
    if not found or v_existing_origin is distinct from new.action_origin_event_id then
      raise exception 'reverse_split_existing_action_candidate_invalid';
    end if;
  else
    raise exception 'reverse_split_action_link_decision_invalid';
  end if;
  return new;
end
$function$;

-- PostgreSQL executes same-timing triggers alphabetically. The zz_ prefix is
-- deliberate: applicability materialization must establish issuer/class first.
create trigger zz_materialize_reverse_split_action_identity_v1
before insert on public.event_corporate_action_facts
for each row execute function public.materialize_reverse_split_action_identity_v1();

create index event_corporate_action_facts_action_history_idx
  on public.event_corporate_action_facts (
    issuer_cik,
    canonical_security_class_id,
    reverse_split_action_id,
    source_execution_id
  )
  where reverse_split_action_id is not null
    and action_link_status in ('new_action', 'existing_action');

create or replace function public.read_reverse_split_action_link_candidates(
  p_issuer_cik text,
  p_before_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_issuer_cik !~ '^[0-9]{10}$' or p_before_accepted_at is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'issuer_cik', p_issuer_cik,
    'before_accepted_at', p_before_accepted_at,
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(candidate.payload order by candidate.accepted_at desc, candidate.source_execution_id)
      from (
        select facts.source_execution_id,
          ledger.accepted_at,
          pg_catalog.jsonb_build_object(
            'event_id', facts.event_id,
            'source_execution_id', facts.source_execution_id,
            'reverse_split_action_id', facts.reverse_split_action_id,
            'action_origin_event_id', facts.action_origin_event_id,
            'issuer_cik', facts.issuer_cik,
            'canonical_security_class_id', facts.canonical_security_class_id,
            'accession_number', ledger.accession_number,
            'accepted_at', ledger.accepted_at
          ) as payload
        from public.event_corporate_action_facts as facts
        join public.sec_filing_ledger as ledger
          on ledger.issuer_cik = facts.issuer_cik
          and ledger.accession_number = facts.source_id
        where facts.event_kind = 'reverse_split'
          and facts.source_family = 'sec'
          and facts.applicability_status = 'mapped'
          and facts.action_link_status in ('new_action', 'existing_action')
          and facts.reverse_split_action_id is not null
          and facts.issuer_cik = p_issuer_cik
          and ledger.accepted_at is not null
          and ledger.accepted_at <= p_before_accepted_at
        order by ledger.accepted_at desc, facts.source_execution_id
        limit 96
      ) as candidate
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.read_reverse_split_action_history_candidates(
  p_issuer_cik text,
  p_canonical_security_class_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_issuer_cik !~ '^[0-9]{10}$'
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
    'candidates', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'event_id', facts.event_id,
        'source_execution_id', facts.source_execution_id,
        'reverse_split_action_id', facts.reverse_split_action_id,
        'action_origin_event_id', facts.action_origin_event_id,
        'issuer_cik', facts.issuer_cik,
        'canonical_security_class_id', facts.canonical_security_class_id,
        'accession_number', ledger.accession_number,
        'accepted_at', ledger.accepted_at
      ) order by ledger.accepted_at, facts.source_execution_id)
      from public.event_corporate_action_facts as facts
      join public.sec_filing_ledger as ledger
        on ledger.issuer_cik = facts.issuer_cik
        and ledger.accession_number = facts.source_id
      where facts.event_kind = 'reverse_split'
        and facts.source_family = 'sec'
        and facts.applicability_status = 'mapped'
        and facts.action_link_status in ('new_action', 'existing_action')
        and facts.reverse_split_action_id is not null
        and facts.issuer_cik = p_issuer_cik
        and (p_canonical_security_class_id is null
          or facts.canonical_security_class_id = p_canonical_security_class_id)
        and ledger.accepted_at is not null
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.read_reverse_split_action_link_candidates(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.read_reverse_split_action_history_candidates(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_reverse_split_action_link_candidates(text, timestamptz)
  to service_role;
grant execute on function public.read_reverse_split_action_history_candidates(text, text)
  to service_role;

comment on function public.read_reverse_split_action_link_candidates(text, timestamptz) is
  'Returns bounded prior linked SEC reverse-split observations for application-level current-lineage verification and one-call semantic linking.';
comment on function public.read_reverse_split_action_history_candidates(text, text) is
  'Returns linked reverse-split observations for official action-level grouping; performs no share-count arithmetic.';
