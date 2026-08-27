-- Dilution Identity Review Exchange V1.
--
-- Adds a server-only, append-only human adjudication alongside the immutable
-- locked resolver result. Review validation and application are intentionally
-- separate: only apply_dilution_identity_review_v1 writes canonical state.

create table public.dilution_identity_adjudications_v1 (
  adjudication_id text primary key,
  observation_key text not null unique
    references public.dilution_source_observations_v1(observation_key),
  review_case_id text not null unique,
  input_hash text not null,
  original_resolver_decision text not null,
  original_resolver_reason_code text not null,
  original_target_exposure_id text,
  gpt_supplied_payload jsonb not null,
  gpt_supplied_decision text not null,
  final_decision text not null,
  target_exposure_id text
    references public.dilution_economic_exposure_registry_v1(exposure_id),
  confidence text not null,
  reason text not null,
  evidence_refs jsonb not null,
  applied_by_user_id uuid not null,
  applied_at timestamptz not null default pg_catalog.now(),
  constraint dilution_identity_adjudications_v1_id_check
    check (adjudication_id ~ '^dilution-adjudication:v1:[0-9a-f]{64}$'),
  constraint dilution_identity_adjudications_v1_case_check
    check (review_case_id ~ '^dilution-review-case:v1:[0-9a-f]{64}$'),
  constraint dilution_identity_adjudications_v1_hash_check
    check (input_hash ~ '^dilution-review-input:v1:[0-9a-f]{64}$'),
  constraint dilution_identity_adjudications_v1_original_check
    check (
      original_resolver_decision in ('UNRESOLVED', 'CONFLICT')
      and original_target_exposure_id is null
    ),
  constraint dilution_identity_adjudications_v1_decision_check
    check (
      gpt_supplied_decision in (
        'CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT'
      )
      and final_decision = gpt_supplied_decision
    ),
  constraint dilution_identity_adjudications_v1_target_check
    check (
      (final_decision in ('CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING')
        and target_exposure_id is not null)
      or
      (final_decision in ('UNRESOLVED', 'CONFLICT') and target_exposure_id is null)
    ),
  constraint dilution_identity_adjudications_v1_confidence_check
    check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  constraint dilution_identity_adjudications_v1_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.length(reason) between 1 and 4000
    ),
  constraint dilution_identity_adjudications_v1_evidence_check
    check (
      pg_catalog.jsonb_typeof(evidence_refs) = 'array'
      and pg_catalog.jsonb_array_length(evidence_refs) between 1 and 40
    ),
  constraint dilution_identity_adjudications_v1_payload_check
    check (
      pg_catalog.jsonb_typeof(gpt_supplied_payload) = 'object'
      and gpt_supplied_payload->>'review_case_id' = review_case_id
      and gpt_supplied_payload->>'input_hash' = input_hash
      and gpt_supplied_payload->>'decision' = gpt_supplied_decision
      and gpt_supplied_payload->>'confidence' = confidence
      and gpt_supplied_payload->>'reason' = reason
      and gpt_supplied_payload->'evidence_refs' = evidence_refs
    )
);

create index dilution_identity_adjudications_v1_target_idx
  on public.dilution_identity_adjudications_v1 (target_exposure_id, applied_at, adjudication_id)
  where target_exposure_id is not null;

alter table public.dilution_identity_adjudications_v1 enable row level security;

revoke all on table public.dilution_identity_adjudications_v1
  from public, anon, authenticated, service_role;

comment on table public.dilution_identity_adjudications_v1 is
  'Append-only final human adjudications for manual GPT review. Original resolver rows remain immutable; direct table access is denied.';

create or replace function private.dilution_identity_review_case_id_v1(
  p_observation_key text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select 'dilution-review-case:v1:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_observation_key, 'UTF8'), 'sha256'),
    'hex'
  )
$function$;

create or replace function private.dilution_identity_review_state_v1(
  p_observation_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_observation public.dilution_source_observations_v1%rowtype;
  v_entity_name text;
  v_tickers jsonb;
  v_registry jsonb;
  v_history jsonb;
  v_allowed_evidence_refs jsonb;
begin
  select observation.* into v_observation
  from public.dilution_source_observations_v1 as observation
  where observation.observation_key = p_observation_key;

  if not found then
    raise exception using errcode = 'P0002', message = 'REVIEW_CASE_NOT_FOUND';
  end if;
  if v_observation.resolver_decision not in ('UNRESOLVED', 'CONFLICT') then
    raise exception using errcode = '22023', message = 'REVIEW_CASE_NOT_REVIEWABLE';
  end if;

  select observation.entity_name into v_entity_name
  from public.sec_issuer_source_observations as observation
  where observation.issuer_cik = v_observation.issuer_cik
  order by observation.observed_at desc, observation.id desc
  limit 1;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'ticker', ticker.ticker,
    'exchange', ticker.exchange
  ) order by ticker.ticker, ticker.exchange), '[]'::jsonb)
  into v_tickers
  from (
    select distinct on (observation.ticker, observation.exchange)
      observation.ticker,
      observation.exchange
    from public.sec_issuer_ticker_observations as observation
    where observation.issuer_cik = v_observation.issuer_cik
    order by observation.ticker, observation.exchange,
      observation.observed_at desc, observation.id desc
  ) as ticker;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'exposure_id', exposure.exposure_id,
    'issuer_cik', exposure.issuer_cik,
    'exposure_type', exposure.exposure_type,
    'canonical_identity_claims', exposure.canonical_identity_claims,
    'created_from_observation_key', exposure.created_from_observation_key,
    'created_accession', exposure.created_accession,
    'created_at', exposure.created_at
  ) order by exposure.created_at, exposure.exposure_id), '[]'::jsonb)
  into v_registry
  from public.dilution_economic_exposure_registry_v1 as exposure
  where exposure.issuer_cik = v_observation.issuer_cik;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'observation_key', observation.observation_key,
    'accession', observation.accession,
    'form', observation.form,
    'filed_date', observation.filed_date,
    'accepted_at', observation.accepted_at,
    'exposure_type', observation.exposure_type,
    'observation_kind', observation.observation_kind,
    'resolver_original', pg_catalog.jsonb_build_object(
      'decision', observation.resolver_decision,
      'reason_code', observation.resolver_reason_code,
      'target_exposure_id', observation.target_exposure_id,
      'result', observation.resolver_result_payload
    ),
    'observation', observation.observation_payload,
    'human_adjudication', case when adjudication.adjudication_id is null then null
      else pg_catalog.jsonb_build_object(
        'adjudication_id', adjudication.adjudication_id,
        'review_case_id', adjudication.review_case_id,
        'input_hash', adjudication.input_hash,
        'gpt_supplied_decision', adjudication.gpt_supplied_decision,
        'final_decision', adjudication.final_decision,
        'target_exposure_id', adjudication.target_exposure_id,
        'confidence', adjudication.confidence,
        'reason', adjudication.reason,
        'evidence_refs', adjudication.evidence_refs,
        'applied_by_user_id', adjudication.applied_by_user_id,
        'applied_at', adjudication.applied_at
      ) end
  ) order by observation.filed_date, observation.accepted_at nulls last,
    observation.created_at, observation.observation_key), '[]'::jsonb)
  into v_history
  from public.dilution_source_observations_v1 as observation
  left join public.dilution_identity_adjudications_v1 as adjudication
    on adjudication.observation_key = observation.observation_key
  where observation.issuer_cik = v_observation.issuer_cik;

  select coalesce(pg_catalog.jsonb_agg(ref.value order by ref.value), '[]'::jsonb)
  into v_allowed_evidence_refs
  from (
    select distinct claim.value#>>'{evidence_identity,source_ref}' as value
    from public.dilution_source_observations_v1 as observation
    cross join lateral pg_catalog.jsonb_array_elements(
      observation.observation_payload->'identity_claims'
    ) as claim(value)
    where observation.issuer_cik = v_observation.issuer_cik
    union
    select distinct evidence.value->>'source_ref' as value
    from public.dilution_source_observations_v1 as observation
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(observation.resolver_result_payload->'identity_evidence', '[]'::jsonb)
      || coalesce(observation.resolver_result_payload->'supporting_evidence_references', '[]'::jsonb)
    ) as evidence(value)
    where observation.issuer_cik = v_observation.issuer_cik
    union
    select distinct claim.value#>>'{evidence_identity,source_ref}' as value
    from public.dilution_economic_exposure_registry_v1 as exposure
    cross join lateral pg_catalog.jsonb_array_elements(
      exposure.canonical_identity_claims
    ) as claim(value)
    where exposure.issuer_cik = v_observation.issuer_cik
  ) as ref
  where ref.value is not null
    and pg_catalog.length(ref.value) between 1 and 240;

  return pg_catalog.jsonb_build_object(
    'state_version', 'dilution_identity_review_state_v1',
    'issuer', pg_catalog.jsonb_build_object(
      'cik', v_observation.issuer_cik,
      'entity_name', v_entity_name,
      'tickers', v_tickers
    ),
    'review_observation_key', v_observation.observation_key,
    'review_observation', pg_catalog.jsonb_build_object(
      'observation_key', v_observation.observation_key,
      'accession', v_observation.accession,
      'form', v_observation.form,
      'filed_date', v_observation.filed_date,
      'accepted_at', v_observation.accepted_at,
      'exposure_type', v_observation.exposure_type,
      'observation_kind', v_observation.observation_kind,
      'observation', v_observation.observation_payload,
      'resolver_original', pg_catalog.jsonb_build_object(
        'decision', v_observation.resolver_decision,
        'reason_code', v_observation.resolver_reason_code,
        'target_exposure_id', v_observation.target_exposure_id,
        'result', v_observation.resolver_result_payload
      )
    ),
    'existing_economic_exposures', v_registry,
    'identity_observation_history', v_history,
    'allowed_target_exposure_ids', coalesce((
      select pg_catalog.jsonb_agg(item->>'exposure_id' order by item->>'exposure_id')
      from pg_catalog.jsonb_array_elements(v_registry) as registry(item)
    ), '[]'::jsonb),
    'allowed_evidence_refs', v_allowed_evidence_refs
  );
end
$function$;

create or replace function public.read_dilution_identity_review_case_v1(
  p_observation_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_state jsonb;
begin
  v_state := private.dilution_identity_review_state_v1(p_observation_key);
  return v_state || pg_catalog.jsonb_build_object(
    'review_case_id', private.dilution_identity_review_case_id_v1(p_observation_key),
    'input_hash', 'dilution-review-input:v1:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_state::text, 'UTF8'), 'sha256'),
      'hex'
    )
  );
end
$function$;

create or replace function public.list_dilution_identity_review_cases_v1(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'REVIEW_LIMIT_INVALID';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'observation_key', review_case.observation_key,
    'review_case_id', private.dilution_identity_review_case_id_v1(review_case.observation_key),
    'issuer_cik', review_case.issuer_cik,
    'ticker', review_case.ticker,
    'accession', review_case.accession,
    'form', review_case.form,
    'filed_date', review_case.filed_date,
    'exposure_type', review_case.exposure_type,
    'original_decision', review_case.resolver_decision,
    'original_reason_code', review_case.resolver_reason_code,
    'review_status', case when review_case.adjudication_id is null then 'PENDING' else 'APPLIED' end,
    'effective_decision', coalesce(review_case.final_decision, review_case.resolver_decision),
    'effective_target_exposure_id', coalesce(review_case.adjudication_target, review_case.target_exposure_id),
    'applied_at', review_case.applied_at
  ) order by review_case.filed_date desc, review_case.observation_key desc), '[]'::jsonb)
  into v_result
  from (
    select observation.*,
      ticker.ticker,
      adjudication.adjudication_id,
      adjudication.final_decision,
      adjudication.target_exposure_id as adjudication_target,
      adjudication.applied_at
    from public.dilution_source_observations_v1 as observation
    left join lateral (
      select ticker_observation.ticker
      from public.sec_issuer_ticker_observations as ticker_observation
      where ticker_observation.issuer_cik = observation.issuer_cik
      order by ticker_observation.observed_at desc, ticker_observation.id desc
      limit 1
    ) as ticker on true
    left join public.dilution_identity_adjudications_v1 as adjudication
      on adjudication.observation_key = observation.observation_key
    where observation.resolver_decision in ('UNRESOLVED', 'CONFLICT')
    order by observation.filed_date desc, observation.observation_key desc
    limit p_limit
  ) as review_case;

  return v_result;
end
$function$;

create or replace function public.read_effective_dilution_identity_decision_v1(
  p_observation_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_observation public.dilution_source_observations_v1%rowtype;
  v_adjudication public.dilution_identity_adjudications_v1%rowtype;
begin
  select observation.* into v_observation
  from public.dilution_source_observations_v1 as observation
  where observation.observation_key = p_observation_key;
  if not found then
    raise exception using errcode = 'P0002', message = 'REVIEW_CASE_NOT_FOUND';
  end if;

  select adjudication.* into v_adjudication
  from public.dilution_identity_adjudications_v1 as adjudication
  where adjudication.observation_key = p_observation_key;

  return pg_catalog.jsonb_build_object(
    'observation_key', v_observation.observation_key,
    'original', pg_catalog.jsonb_build_object(
      'decision', v_observation.resolver_decision,
      'reason_code', v_observation.resolver_reason_code,
      'target_exposure_id', v_observation.target_exposure_id,
      'resolver_result', v_observation.resolver_result_payload
    ),
    'effective', case when v_adjudication.adjudication_id is null then
      pg_catalog.jsonb_build_object(
        'source', 'RESOLVER',
        'decision', v_observation.resolver_decision,
        'target_exposure_id', v_observation.target_exposure_id,
        'reason', v_observation.resolver_reason_code,
        'confidence', null,
        'adjudication_id', null,
        'applied_at', null
      ) else pg_catalog.jsonb_build_object(
        'source', 'HUMAN_ADJUDICATION',
        'decision', v_adjudication.final_decision,
        'target_exposure_id', v_adjudication.target_exposure_id,
        'reason', v_adjudication.reason,
        'confidence', v_adjudication.confidence,
        'adjudication_id', v_adjudication.adjudication_id,
        'applied_at', v_adjudication.applied_at
      ) end
  );
end
$function$;

create or replace function public.apply_dilution_identity_review_v1(
  p_observation_key text,
  p_decision jsonb,
  p_applied_by_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_state jsonb;
  v_expected_case_id text;
  v_expected_input_hash text;
  v_decision text;
  v_supplied_target text;
  v_final_target text;
  v_observation public.dilution_source_observations_v1%rowtype;
  v_target public.dilution_economic_exposure_registry_v1%rowtype;
  v_existing public.dilution_identity_adjudications_v1%rowtype;
  v_adjudication_id text;
  v_evidence_ref text;
begin
  if p_applied_by_user_id is null then
    raise exception using errcode = '22023', message = 'REVIEW_ACTOR_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_decision) <> 'object'
    or not (p_decision ?& array[
      'review_case_id', 'input_hash', 'decision', 'confidence', 'reason',
      'evidence_refs', 'sources_checked'
    ])
    or (p_decision - array[
      'review_case_id', 'input_hash', 'decision', 'target_exposure_id',
      'confidence', 'reason', 'evidence_refs', 'sources_checked',
      'suggested_corrections'
    ]) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'REVIEW_DECISION_SCHEMA_INVALID';
  end if;

  v_decision := p_decision->>'decision';
  v_supplied_target := p_decision->>'target_exposure_id';
  if p_decision->>'review_case_id' !~ '^dilution-review-case:v1:[0-9a-f]{64}$'
    or p_decision->>'input_hash' !~ '^dilution-review-input:v1:[0-9a-f]{64}$'
    or v_decision not in (
      'CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT'
    )
    or p_decision->>'confidence' not in ('HIGH', 'MEDIUM', 'LOW')
    or p_decision->>'reason' is null
    or p_decision->>'reason' <> pg_catalog.btrim(p_decision->>'reason')
    or pg_catalog.length(p_decision->>'reason') not between 1 and 4000
    or pg_catalog.jsonb_typeof(p_decision->'evidence_refs') <> 'array'
    or pg_catalog.jsonb_array_length(p_decision->'evidence_refs') not between 1 and 40
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_decision->'evidence_refs') as evidence(value)
      where pg_catalog.jsonb_typeof(evidence.value) <> 'string'
        or pg_catalog.length(evidence.value#>>'{}') not between 1 and 240
        or evidence.value#>>'{}' <> pg_catalog.btrim(evidence.value#>>'{}')
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements_text(p_decision->'evidence_refs') as evidence(value)
    ) <> (
      select pg_catalog.count(distinct evidence.value)
      from pg_catalog.jsonb_array_elements_text(p_decision->'evidence_refs') as evidence(value)
    )
    or pg_catalog.jsonb_typeof(p_decision->'sources_checked') <> 'array'
    or pg_catalog.jsonb_array_length(p_decision->'sources_checked') not between 1 and 40
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_decision->'sources_checked') as source(value)
      where pg_catalog.jsonb_typeof(source.value) <> 'string'
        or pg_catalog.length(source.value#>>'{}') not between 1 and 1000
        or source.value#>>'{}' <> pg_catalog.btrim(source.value#>>'{}')
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements_text(p_decision->'sources_checked') as source(value)
    ) <> (
      select pg_catalog.count(distinct source.value)
      from pg_catalog.jsonb_array_elements_text(p_decision->'sources_checked') as source(value)
    )
    or (
      p_decision ? 'suggested_corrections'
      and (
        pg_catalog.jsonb_typeof(p_decision->'suggested_corrections') <> 'array'
        or pg_catalog.jsonb_array_length(p_decision->'suggested_corrections') > 20
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_decision->'suggested_corrections') as correction(value)
          where pg_catalog.jsonb_typeof(correction.value) <> 'object'
            or not (correction.value ?& array['field', 'suggestion', 'reason'])
            or (correction.value - array['field', 'suggestion', 'reason']) <> '{}'::jsonb
            or pg_catalog.jsonb_typeof(correction.value->'field') <> 'string'
            or pg_catalog.length(correction.value->>'field') not between 1 and 200
            or correction.value->>'field' <> pg_catalog.btrim(correction.value->>'field')
            or pg_catalog.jsonb_typeof(correction.value->'suggestion') <> 'string'
            or pg_catalog.length(correction.value->>'suggestion') not between 1 and 4000
            or correction.value->>'suggestion' <> pg_catalog.btrim(correction.value->>'suggestion')
            or pg_catalog.jsonb_typeof(correction.value->'reason') <> 'string'
            or pg_catalog.length(correction.value->>'reason') not between 1 and 4000
            or correction.value->>'reason' <> pg_catalog.btrim(correction.value->>'reason')
        )
      )
    )
  then
    raise exception using errcode = '22023', message = 'REVIEW_DECISION_SCHEMA_INVALID';
  end if;

  if v_decision in ('LINK_EXISTING', 'AMEND_EXISTING') then
    if v_supplied_target is null
      or v_supplied_target !~ '^economic-exposure:v1:[0-9a-f]{64}$'
    then
      raise exception using errcode = '22023', message = 'REVIEW_TARGET_REQUIRED';
    end if;
  elsif v_supplied_target is not null then
    raise exception using errcode = '22023', message = 'REVIEW_TARGET_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dilution-review|' || p_observation_key, 0)
  );

  select adjudication.* into v_existing
  from public.dilution_identity_adjudications_v1 as adjudication
  where adjudication.observation_key = p_observation_key
  for update of adjudication;
  if found then
    if v_existing.gpt_supplied_payload is distinct from p_decision then
      raise exception using errcode = '23505', message = 'REVIEW_ALREADY_ADJUDICATED';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'adjudication_id', v_existing.adjudication_id,
      'observation_key', v_existing.observation_key,
      'original_decision', v_existing.original_resolver_decision,
      'effective_decision', v_existing.final_decision,
      'target_exposure_id', v_existing.target_exposure_id,
      'applied_at', v_existing.applied_at
    );
  end if;

  select observation.* into v_observation
  from public.dilution_source_observations_v1 as observation
  where observation.observation_key = p_observation_key
  for key share of observation;
  if not found then
    raise exception using errcode = 'P0002', message = 'REVIEW_CASE_NOT_FOUND';
  end if;
  if v_observation.resolver_decision not in ('UNRESOLVED', 'CONFLICT') then
    raise exception using errcode = '22023', message = 'REVIEW_CASE_NOT_REVIEWABLE';
  end if;

  v_state := private.dilution_identity_review_state_v1(p_observation_key);
  v_expected_case_id := private.dilution_identity_review_case_id_v1(p_observation_key);
  v_expected_input_hash := 'dilution-review-input:v1:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_state::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if p_decision->>'review_case_id' is distinct from v_expected_case_id then
    raise exception using errcode = '22023', message = 'REVIEW_CASE_ID_MISMATCH';
  end if;
  if p_decision->>'input_hash' is distinct from v_expected_input_hash then
    raise exception using errcode = '40001', message = 'STALE_REVIEW_INPUT';
  end if;

  for v_evidence_ref in
    select value from pg_catalog.jsonb_array_elements_text(p_decision->'evidence_refs') as evidence(value)
  loop
    if not (v_state->'allowed_evidence_refs' @> pg_catalog.jsonb_build_array(v_evidence_ref)) then
      raise exception using errcode = '22023', message = 'REVIEW_EVIDENCE_REF_NOT_IN_PACKET';
    end if;
  end loop;

  if v_decision in ('LINK_EXISTING', 'AMEND_EXISTING') then
    select exposure.* into v_target
    from public.dilution_economic_exposure_registry_v1 as exposure
    where exposure.exposure_id = v_supplied_target
    for key share of exposure;
    if not found then
      raise exception using errcode = '23503', message = 'REVIEW_TARGET_NOT_FOUND';
    end if;
    if v_target.issuer_cik is distinct from v_observation.issuer_cik then
      raise exception using errcode = '23514', message = 'REVIEW_TARGET_ISSUER_MISMATCH';
    end if;
    if v_target.exposure_type is distinct from v_observation.exposure_type then
      raise exception using errcode = '23514', message = 'REVIEW_TARGET_TYPE_MISMATCH';
    end if;
    if not (v_state->'allowed_target_exposure_ids' @> pg_catalog.jsonb_build_array(v_supplied_target)) then
      raise exception using errcode = '23514', message = 'REVIEW_TARGET_NOT_IN_PACKET';
    end if;
    v_final_target := v_target.exposure_id;
  elsif v_decision = 'CREATE_NEW' then
    v_final_target := 'economic-exposure:v1:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        'human-review-v1|' || p_observation_key || '|' || v_expected_input_hash,
        'UTF8'
      ), 'sha256'),
      'hex'
    );
    insert into public.dilution_economic_exposure_registry_v1 (
      exposure_id, issuer_cik, exposure_type, canonical_identity_claims,
      created_from_observation_key, created_accession
    ) values (
      v_final_target, v_observation.issuer_cik, v_observation.exposure_type,
      v_observation.observation_payload->'identity_claims',
      v_observation.observation_key, v_observation.accession
    );
  else
    v_final_target := null;
  end if;

  v_adjudication_id := 'dilution-adjudication:v1:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      v_expected_case_id || '|' || v_expected_input_hash,
      'UTF8'
    ), 'sha256'),
    'hex'
  );

  insert into public.dilution_identity_adjudications_v1 (
    adjudication_id, observation_key, review_case_id, input_hash,
    original_resolver_decision, original_resolver_reason_code,
    original_target_exposure_id, gpt_supplied_payload, gpt_supplied_decision,
    final_decision, target_exposure_id, confidence, reason, evidence_refs,
    applied_by_user_id
  ) values (
    v_adjudication_id, v_observation.observation_key, v_expected_case_id,
    v_expected_input_hash, v_observation.resolver_decision,
    v_observation.resolver_reason_code, v_observation.target_exposure_id,
    p_decision, v_decision, v_decision, v_final_target,
    p_decision->>'confidence', p_decision->>'reason',
    p_decision->'evidence_refs', p_applied_by_user_id
  );

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'adjudication_id', v_adjudication_id,
    'observation_key', v_observation.observation_key,
    'original_decision', v_observation.resolver_decision,
    'effective_decision', v_decision,
    'target_exposure_id', v_final_target,
    'applied_at', (
      select adjudication.applied_at
      from public.dilution_identity_adjudications_v1 as adjudication
      where adjudication.adjudication_id = v_adjudication_id
    )
  );
end
$function$;

comment on function public.read_dilution_identity_review_case_v1(text) is
  'Builds a complete manual GPT review context and deterministic stale-state hash without writing state.';
comment on function public.list_dilution_identity_review_cases_v1(integer) is
  'Lists persisted UNRESOLVED and CONFLICT observations for the internal review UI.';
comment on function public.read_effective_dilution_identity_decision_v1(text) is
  'Reads the immutable resolver result and overlays an approved human adjudication only as the effective decision.';
comment on function public.apply_dilution_identity_review_v1(text, jsonb, uuid) is
  'Atomically validates and applies one human adjudication. CREATE_NEW generates the exposure ID in the database; replay is idempotent.';

revoke all on function private.dilution_identity_review_case_id_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.dilution_identity_review_state_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_dilution_identity_review_case_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_dilution_identity_review_cases_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.read_effective_dilution_identity_decision_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_dilution_identity_review_v1(text, jsonb, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.read_dilution_identity_review_case_v1(text)
  to service_role;
grant execute on function public.list_dilution_identity_review_cases_v1(integer)
  to service_role;
grant execute on function public.read_effective_dilution_identity_decision_v1(text)
  to service_role;
grant execute on function public.apply_dilution_identity_review_v1(text, jsonb, uuid)
  to service_role;
