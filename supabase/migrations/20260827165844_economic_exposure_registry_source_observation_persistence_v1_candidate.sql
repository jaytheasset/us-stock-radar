-- Economic Exposure Registry & Source Observation Persistence V1.
--
-- This is an append-only, server-only persistence boundary for the locked
-- Dilution Identity Resolver. It records resolver decisions without deriving
-- economic values, promoting later claims into canonical identity, or choosing
-- an alternate target.

create table public.dilution_economic_exposure_registry_v1 (
  exposure_id text primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  exposure_type text not null,
  canonical_identity_claims jsonb not null,
  created_from_observation_key text not null unique,
  created_accession text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_economic_exposure_registry_v1_id_check
    check (exposure_id ~ '^economic-exposure:v1:[0-9a-f]{64}$'),
  constraint dilution_economic_exposure_registry_v1_type_check
    check (exposure_type in (
      'convertible_note', 'warrant', 'prefunded_warrant',
      'convertible_preferred', 'atm_program', 'equity_line'
    )),
  constraint dilution_economic_exposure_registry_v1_claims_check
    check (
      pg_catalog.jsonb_typeof(canonical_identity_claims) = 'array'
      and pg_catalog.jsonb_array_length(canonical_identity_claims) between 1 and 6
    ),
  constraint dilution_economic_exposure_registry_v1_observation_key_check
    check (created_from_observation_key ~ '^economic-observation:v1:[0-9a-f]{64}$'),
  constraint dilution_economic_exposure_registry_v1_accession_check
    check (created_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$')
);

create index dilution_economic_exposure_registry_v1_issuer_type_idx
  on public.dilution_economic_exposure_registry_v1 (issuer_cik, exposure_type, created_at, exposure_id);

create table public.dilution_source_observations_v1 (
  observation_key text primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  accession text not null,
  form text not null,
  filed_date date not null,
  accepted_at timestamptz,
  exposure_type text not null,
  observation_kind text not null,
  resolver_decision text not null,
  resolver_reason_code text not null,
  target_exposure_id text references public.dilution_economic_exposure_registry_v1(exposure_id),
  observation_payload jsonb not null,
  resolver_result_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_source_observations_v1_key_check
    check (observation_key ~ '^economic-observation:v1:[0-9a-f]{64}$'),
  constraint dilution_source_observations_v1_accession_check
    check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint dilution_source_observations_v1_form_check
    check (form = pg_catalog.btrim(form) and pg_catalog.length(form) between 1 and 40),
  constraint dilution_source_observations_v1_type_check
    check (exposure_type in (
      'convertible_note', 'warrant', 'prefunded_warrant',
      'convertible_preferred', 'atm_program', 'equity_line'
    )),
  constraint dilution_source_observations_v1_kind_check
    check (observation_kind in ('exposure_identity', 'exposure_amendment')),
  constraint dilution_source_observations_v1_decision_check
    check (resolver_decision in (
      'CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT'
    )),
  constraint dilution_source_observations_v1_target_check
    check (
      (resolver_decision in ('CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING') and target_exposure_id is not null)
      or
      (resolver_decision in ('UNRESOLVED', 'CONFLICT') and target_exposure_id is null)
    ),
  constraint dilution_source_observations_v1_payload_check
    check (
      pg_catalog.jsonb_typeof(observation_payload) = 'object'
      and observation_payload->>'issuer_cik' = issuer_cik
      and observation_payload->>'accession' = accession
      and observation_payload->>'form' = form
      and (observation_payload->>'filed_date')::date = filed_date
      and observation_payload->>'exposure_type' = exposure_type
      and observation_payload->>'observation_kind' = observation_kind
      and resolver_result_payload->>'decision' = resolver_decision
      and resolver_result_payload->>'reason_code' = resolver_reason_code
    )
);

create index dilution_source_observations_v1_target_idx
  on public.dilution_source_observations_v1 (target_exposure_id, created_at, observation_key)
  where target_exposure_id is not null;

create index dilution_source_observations_v1_issuer_accession_idx
  on public.dilution_source_observations_v1 (issuer_cik, accession, observation_key);

alter table public.dilution_economic_exposure_registry_v1 enable row level security;
alter table public.dilution_source_observations_v1 enable row level security;

revoke all on table public.dilution_economic_exposure_registry_v1
  from public, anon, authenticated, service_role;
revoke all on table public.dilution_source_observations_v1
  from public, anon, authenticated, service_role;

comment on table public.dilution_economic_exposure_registry_v1 is
  'Server-only canonical identity registry: one row per resolver-created economic exposure. V1 never promotes later observation claims or current terms.';
comment on table public.dilution_source_observations_v1 is
  'Server-only append-only source observations and exact locked-resolver decisions. SEC source text is referenced by bounded evidence identity and is not copied here.';

create or replace function private.dilution_evidence_identity_valid_v1(p_evidence jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_typeof(p_evidence) = 'object'
    and p_evidence ?& array[
      'version', 'source_ref', 'range_start', 'range_end',
      'source_content_hash', 'exact_source'
    ]
    and (p_evidence - array[
      'version', 'source_ref', 'range_start', 'range_end',
      'source_content_hash', 'exact_source'
    ]) = '{}'::jsonb
    and p_evidence->>'version' = 'dilution_evidence_identity_v1'
    and p_evidence->>'source_ref' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
    and pg_catalog.jsonb_typeof(p_evidence->'range_start') = 'number'
    and pg_catalog.jsonb_typeof(p_evidence->'range_end') = 'number'
    and (p_evidence->>'range_start') ~ '^[0-9]+$'
    and (p_evidence->>'range_end') ~ '^[0-9]+$'
    and (p_evidence->>'range_start')::numeric >= 0
    and (p_evidence->>'range_end')::numeric > (p_evidence->>'range_start')::numeric
    and p_evidence->>'source_content_hash' ~ '^[0-9a-f]{64}$'
    and p_evidence->'exact_source' = 'true'::jsonb,
    false
  );
$function$;

create or replace function private.dilution_identity_claims_valid_v1(
  p_claims jsonb,
  p_exposure_type text,
  p_observation_kind text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_kind text;
  v_role text;
  v_allowed boolean;
  v_has_amendment_reference boolean := false;
begin
  if pg_catalog.jsonb_typeof(p_claims) <> 'array'
    or pg_catalog.jsonb_array_length(p_claims) not between 1 and 6
  then
    return false;
  end if;

  for v_claim in select value from pg_catalog.jsonb_array_elements(p_claims)
  loop
    if pg_catalog.jsonb_typeof(v_claim) <> 'object'
      or not (v_claim ?& array['version', 'claim_kind', 'value', 'semantic_role', 'evidence_identity'])
      or (v_claim - array['version', 'claim_kind', 'value', 'semantic_role', 'evidence_identity']) <> '{}'::jsonb
      or v_claim->>'version' <> 'dilution_identity_claim_v1'
      or pg_catalog.length(v_claim->>'value') not between 1 and 1000
      or v_claim->>'value' <> pg_catalog.btrim(v_claim->>'value')
      or not private.dilution_evidence_identity_valid_v1(v_claim->'evidence_identity')
    then
      return false;
    end if;

    v_kind := v_claim->>'claim_kind';
    v_role := v_claim->>'semantic_role';
    v_allowed := case p_exposure_type
      when 'convertible_note' then v_kind in (
        'original_instrument_reference', 'agreement_reference', 'amendment_reference',
        'designation_or_tranche', 'original_issuance_or_closing_date',
        'holder_or_investor', 'principal', 'exhibit_or_accession_reference'
      )
      when 'warrant' then v_kind in (
        'original_instrument_reference', 'agreement_reference', 'amendment_reference',
        'series_or_designation', 'original_issuance_or_closing_date',
        'holder_or_investor', 'underlying_share_quantity', 'expiration_date',
        'exhibit_or_accession_reference'
      )
      when 'prefunded_warrant' then v_kind in (
        'original_instrument_reference', 'agreement_reference', 'amendment_reference',
        'series_or_designation', 'original_issuance_or_closing_date',
        'holder_or_investor', 'underlying_share_quantity', 'expiration_date',
        'exhibit_or_accession_reference'
      )
      when 'convertible_preferred' then v_kind in (
        'original_instrument_reference', 'amendment_reference', 'series_or_designation',
        'certificate_of_designation_reference', 'original_issuance_or_closing_date',
        'holder_or_investor', 'exhibit_or_accession_reference'
      )
      when 'atm_program' then v_kind in (
        'amendment_reference', 'sales_agreement_reference', 'sales_agreement_date',
        'sales_agent', 'exhibit_or_accession_reference', 'original_program_capacity'
      )
      when 'equity_line' then v_kind in (
        'amendment_reference', 'purchase_agreement_reference', 'purchase_agreement_date',
        'counterparty', 'exhibit_or_accession_reference', 'committed_amount'
      )
      else false
    end;
    if not v_allowed then return false; end if;

    if v_kind in ('sales_agreement_date', 'purchase_agreement_date') then
      if v_role is distinct from 'agreement_signing_date' then return false; end if;
    elsif v_kind = 'original_issuance_or_closing_date' then
      if v_role not in ('instrument_issuance_date', 'funding_date') then return false; end if;
    elsif v_kind = 'expiration_date' then
      if v_role is distinct from 'expiration_date' then return false; end if;
    elsif v_claim->'semantic_role' <> 'null'::jsonb then
      return false;
    end if;

    if v_kind = 'amendment_reference' then v_has_amendment_reference := true; end if;
  end loop;

  return (p_observation_kind = 'exposure_amendment') = v_has_amendment_reference;
end
$function$;

create or replace function private.dilution_source_observation_key_v1(p_observation jsonb)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_lineage jsonb;
begin
  if pg_catalog.jsonb_typeof(p_observation) <> 'object'
    or not (p_observation ?& array[
      'version', 'issuer_cik', 'accession', 'form', 'filed_date', 'accepted_at',
      'analysis_lineage', 'exposure_id', 'exposure_type', 'observation_kind',
      'observed_fields', 'identity_claims', 'status'
    ])
    or (p_observation - array[
      'version', 'issuer_cik', 'accession', 'form', 'filed_date', 'accepted_at',
      'analysis_lineage', 'exposure_id', 'exposure_type', 'observation_kind',
      'observed_fields', 'identity_claims', 'status'
    ]) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'dilution observation shape is invalid';
  end if;

  if p_observation->>'version' <> 'dilution_source_observation_v1'
    or p_observation->>'issuer_cik' !~ '^[0-9]{10}$'
    or p_observation->>'issuer_cik' = '0000000000'
    or p_observation->>'accession' !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
    or pg_catalog.length(p_observation->>'form') not between 1 and 40
    or p_observation->>'form' <> pg_catalog.btrim(p_observation->>'form')
    or p_observation->>'filed_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_observation->'exposure_id' <> 'null'::jsonb
    or p_observation->>'exposure_type' not in (
      'convertible_note', 'warrant', 'prefunded_warrant',
      'convertible_preferred', 'atm_program', 'equity_line'
    )
    or p_observation->>'observation_kind' not in ('exposure_identity', 'exposure_amendment')
    or p_observation->>'status' <> 'VALIDATED'
    or p_observation->'observed_fields' <> '[]'::jsonb
    or not private.dilution_identity_claims_valid_v1(
      p_observation->'identity_claims',
      p_observation->>'exposure_type',
      p_observation->>'observation_kind'
    )
  then
    raise exception using errcode = '22023', message = 'dilution observation contract is invalid';
  end if;

  perform (p_observation->>'filed_date')::date;
  if p_observation->'accepted_at' <> 'null'::jsonb then
    perform (p_observation->>'accepted_at')::timestamptz;
  end if;

  v_lineage := p_observation->'analysis_lineage';
  if v_lineage <> 'null'::jsonb and (
    pg_catalog.jsonb_typeof(v_lineage) <> 'object'
    or not (v_lineage ?& array[
      'source_execution_id', 'parent_primary_ai_run_id',
      'analyzer_key', 'analyzer_contract_version'
    ])
    or (v_lineage - array[
      'source_execution_id', 'parent_primary_ai_run_id',
      'analyzer_key', 'analyzer_contract_version'
    ]) <> '{}'::jsonb
    or v_lineage->>'source_execution_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_lineage->>'parent_primary_ai_run_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.length(v_lineage->>'analyzer_key') not between 1 and 120
    or pg_catalog.length(v_lineage->>'analyzer_contract_version') not between 1 and 120
  ) then
    raise exception using errcode = '22023', message = 'dilution observation lineage is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_observation->'identity_claims') as claim(value)
    where pg_catalog.strpos(claim.value#>>'{evidence_identity,source_ref}', p_observation->>'accession') = 0
  ) then
    raise exception using errcode = '22023', message = 'dilution observation evidence source does not identify its accession';
  end if;

  return 'economic-observation:v1:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_observation::text, 'UTF8'), 'sha256'),
    'hex'
  );
end
$function$;

create or replace function public.read_dilution_exposure_resolution_context(p_observation jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_issuer_cik text;
  v_existing public.dilution_source_observations_v1%rowtype;
  v_candidates jsonb;
begin
  v_key := private.dilution_source_observation_key_v1(p_observation);
  v_issuer_cik := p_observation->>'issuer_cik';

  if not exists (select 1 from public.sec_issuers where cik = v_issuer_cik) then
    raise exception using errcode = '23503', message = 'dilution observation issuer does not exist';
  end if;

  select row_value.* into v_existing
  from public.dilution_source_observations_v1 as row_value
  where row_value.observation_key = v_key;
  if found then
    if v_existing.issuer_cik is distinct from v_issuer_cik
      or v_existing.observation_payload is distinct from p_observation
    then
      raise exception using errcode = '23505', message = 'deterministic dilution observation identity collision';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'already_persisted',
      'observation_key', v_key,
      'decision', v_existing.resolver_decision,
      'target_exposure_id', v_existing.target_exposure_id
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'exposure_id', exposure.exposure_id,
    'issuer_cik', exposure.issuer_cik,
    'exposure_type', exposure.exposure_type,
    'identity_claims', exposure.canonical_identity_claims,
    'registration_canonical_keys', '[]'::jsonb
  ) order by exposure.created_at, exposure.exposure_id), '[]'::jsonb)
  into v_candidates
  from public.dilution_economic_exposure_registry_v1 as exposure
  where exposure.issuer_cik = v_issuer_cik;

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'observation_key', v_key,
    'candidates', v_candidates
  );
end
$function$;

create or replace function public.persist_dilution_exposure_resolution_v1(
  p_observation jsonb,
  p_resolution jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_exposure_id text;
  v_issuer_cik text;
  v_exposure_type text;
  v_decision text;
  v_reason text;
  v_resolver_target text;
  v_existing public.dilution_source_observations_v1%rowtype;
  v_target public.dilution_economic_exposure_registry_v1%rowtype;
  v_evidence jsonb;
begin
  v_key := private.dilution_source_observation_key_v1(p_observation);
  v_issuer_cik := p_observation->>'issuer_cik';
  v_exposure_type := p_observation->>'exposure_type';

  if pg_catalog.jsonb_typeof(p_resolution) <> 'object'
    or not (p_resolution ?& array[
      'version', 'resolver_version', 'decision', 'reason_code', 'target_exposure_id',
      'identity_claim_kinds', 'identity_evidence', 'matched_strong_claims',
      'conflicting_strong_claims', 'independent_strong_claims',
      'supporting_evidence_references', 'supporting_registration_matches',
      'candidate_exposure_identity'
    ])
    or (p_resolution - array[
      'version', 'resolver_version', 'decision', 'reason_code', 'target_exposure_id',
      'identity_claim_kinds', 'identity_evidence', 'matched_strong_claims',
      'conflicting_strong_claims', 'independent_strong_claims',
      'supporting_evidence_references', 'supporting_registration_matches',
      'candidate_exposure_identity'
    ]) <> '{}'::jsonb
    or p_resolution->>'version' <> 'dilution_identity_decision_v1'
    or p_resolution->>'resolver_version' <> 'economic_exposure_identity_resolver_v1'
  then
    raise exception using errcode = '22023', message = 'dilution resolver result shape is invalid';
  end if;

  v_decision := p_resolution->>'decision';
  v_reason := p_resolution->>'reason_code';
  v_resolver_target := p_resolution->>'target_exposure_id';

  if v_decision not in ('CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT')
    or not (
      (v_decision = 'CREATE_NEW' and v_reason in ('NO_PRIOR_CANDIDATE', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY'))
      or (v_decision = 'LINK_EXISTING' and v_reason in ('EXPLICIT_SOURCE_REFERENCE_MATCH', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH'))
      or (v_decision = 'AMEND_EXISTING' and v_reason = 'EXPLICIT_AMENDMENT_REFERENCE_MATCH')
      or (v_decision = 'UNRESOLVED' and v_reason in ('INSUFFICIENT_SOURCE_BACKED_IDENTITY', 'NON_EXPOSURE_OBSERVATION', 'EVIDENCE_VALIDATION_FAILED'))
      or (v_decision = 'CONFLICT' and v_reason in (
        'CONFLICTING_STRONG_IDENTITY_CLAIMS', 'CROSS_ISSUER_IDENTITY_CONFLICT',
        'EXPOSURE_TYPE_CONFLICT', 'AMBIGUOUS_STRONG_IDENTITY_MATCH', 'AMBIGUOUS_AMENDMENT_TARGET'
      ))
    )
    or pg_catalog.jsonb_typeof(p_resolution->'identity_claim_kinds') <> 'array'
    or pg_catalog.jsonb_array_length(p_resolution->'identity_claim_kinds') = 0
    or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(p_resolution->'identity_claim_kinds') as kind(value)
      where kind.value not in (
        'original_instrument_reference', 'agreement_reference', 'amendment_reference',
        'designation_or_tranche', 'series_or_designation', 'certificate_of_designation_reference',
        'original_issuance_or_closing_date', 'holder_or_investor', 'counterparty', 'principal',
        'underlying_share_quantity', 'expiration_date', 'sales_agreement_reference',
        'sales_agreement_date', 'sales_agent', 'exhibit_or_accession_reference',
        'original_program_capacity', 'purchase_agreement_reference',
        'purchase_agreement_date', 'committed_amount'
      )
    )
    or pg_catalog.jsonb_typeof(p_resolution->'identity_evidence') <> 'array'
    or pg_catalog.jsonb_array_length(p_resolution->'identity_evidence') = 0
    or pg_catalog.jsonb_typeof(p_resolution->'matched_strong_claims') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolution->'conflicting_strong_claims') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolution->'independent_strong_claims') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolution->'supporting_evidence_references') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolution->'supporting_registration_matches') <> 'array'
  then
    raise exception using errcode = '22023', message = 'dilution resolver result contract is invalid';
  end if;

  for v_evidence in
    select value from pg_catalog.jsonb_array_elements(
      (p_resolution->'identity_evidence') || (p_resolution->'supporting_evidence_references')
    )
  loop
    if not private.dilution_evidence_identity_valid_v1(v_evidence) then
      raise exception using errcode = '22023', message = 'dilution resolver evidence identity is invalid';
    end if;
  end loop;

  if v_decision in ('LINK_EXISTING', 'AMEND_EXISTING') then
    if v_resolver_target is null
      or p_resolution->'candidate_exposure_identity' = 'null'::jsonb
      or p_resolution#>>'{candidate_exposure_identity,exposure_id}' is distinct from v_resolver_target
      or p_resolution#>>'{candidate_exposure_identity,issuer_cik}' is distinct from v_issuer_cik
      or p_resolution#>>'{candidate_exposure_identity,exposure_type}' is distinct from v_exposure_type
    then
      raise exception using errcode = '22023', message = 'dilution resolver target is missing or malformed';
    end if;
  elsif v_resolver_target is not null
    or p_resolution->'candidate_exposure_identity' <> 'null'::jsonb
  then
    raise exception using errcode = '22023', message = 'dilution resolver target must be null for this decision';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  select row_value.* into v_existing
  from public.dilution_source_observations_v1 as row_value
  where row_value.observation_key = v_key
  for update of row_value;
  if found then
    if v_existing.observation_payload is distinct from p_observation
      or v_existing.resolver_result_payload is distinct from p_resolution
    then
      raise exception using errcode = '23505', message = 'same dilution observation has a different resolver result';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'observation_key', v_key,
      'decision', v_existing.resolver_decision,
      'target_exposure_id', v_existing.target_exposure_id
    );
  end if;

  if not exists (select 1 from public.sec_issuers where cik = v_issuer_cik) then
    raise exception using errcode = '23503', message = 'dilution observation issuer does not exist';
  end if;

  if v_decision = 'CREATE_NEW' then
    v_exposure_id := 'economic-exposure:v1:' || pg_catalog.substr(
      v_key,
      pg_catalog.length('economic-observation:v1:') + 1
    );
    insert into public.dilution_economic_exposure_registry_v1 (
      exposure_id, issuer_cik, exposure_type, canonical_identity_claims,
      created_from_observation_key, created_accession
    ) values (
      v_exposure_id, v_issuer_cik, v_exposure_type,
      p_observation->'identity_claims', v_key, p_observation->>'accession'
    );
  elsif v_decision in ('LINK_EXISTING', 'AMEND_EXISTING') then
    select exposure.* into v_target
    from public.dilution_economic_exposure_registry_v1 as exposure
    where exposure.exposure_id = v_resolver_target
    for key share of exposure;
    if not found then
      raise exception using errcode = '23503', message = 'dilution resolver target does not exist';
    end if;
    if v_target.issuer_cik is distinct from v_issuer_cik then
      raise exception using errcode = '23514', message = 'dilution resolver target belongs to another issuer';
    end if;
    if v_target.exposure_type is distinct from v_exposure_type then
      raise exception using errcode = '23514', message = 'dilution resolver target has another exposure type';
    end if;
    v_exposure_id := v_target.exposure_id;
  else
    v_exposure_id := null;
  end if;

  insert into public.dilution_source_observations_v1 (
    observation_key, issuer_cik, accession, form, filed_date, accepted_at,
    exposure_type, observation_kind, resolver_decision, resolver_reason_code,
    target_exposure_id, observation_payload, resolver_result_payload
  ) values (
    v_key, v_issuer_cik, p_observation->>'accession', p_observation->>'form',
    (p_observation->>'filed_date')::date,
    case when p_observation->'accepted_at' = 'null'::jsonb then null
      else (p_observation->>'accepted_at')::timestamptz end,
    v_exposure_type, p_observation->>'observation_kind', v_decision, v_reason,
    v_exposure_id, p_observation, p_resolution
  );

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'observation_key', v_key,
    'decision', v_decision,
    'target_exposure_id', v_exposure_id
  );
end
$function$;

comment on function public.read_dilution_exposure_resolution_context(jsonb) is
  'Returns exact same-issuer canonical candidates, or an existing deterministic observation, for the locked resolver. No fuzzy or alternate target logic.';
comment on function public.persist_dilution_exposure_resolution_v1(jsonb, jsonb) is
  'Atomically persists one authoritative locked-resolver decision. CREATE_NEW creates registry plus observation; other decisions never mutate canonical identity.';

revoke all on function private.dilution_evidence_identity_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.dilution_identity_claims_valid_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.dilution_source_observation_key_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.read_dilution_exposure_resolution_context(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.persist_dilution_exposure_resolution_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.read_dilution_exposure_resolution_context(jsonb)
  to service_role;
grant execute on function public.persist_dilution_exposure_resolution_v1(jsonb, jsonb)
  to service_role;
