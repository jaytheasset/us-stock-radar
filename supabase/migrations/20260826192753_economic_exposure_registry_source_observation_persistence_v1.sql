-- Economic Exposure Registry & Source Observation Persistence V1.
-- Exactly two persistent concepts: stable exposure identities and immutable
-- source/resolver observation history. No terms, registration links, current
-- state, projection, calculation, or realized-issuance materialization.

create table public.dilution_economic_exposures (
  exposure_id uuid primary key default extensions.gen_random_uuid(),
  issuer_cik text not null references public.sec_issuers(cik),
  exposure_type text not null,
  origin_observation_key text not null unique,
  origin_source_execution_id uuid not null references public.ai_runs(id),
  origin_accession text not null,
  origin_analyzer_key text not null,
  origin_analyzer_contract_version text not null,
  origin_resolver_contract_version text not null,
  origin_resolver_reason_code text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_economic_exposures_type_check check (
    exposure_type in (
      'convertible_note', 'warrant', 'prefunded_warrant',
      'convertible_preferred', 'atm_program', 'equity_line'
    )
  ),
  constraint dilution_economic_exposures_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_economic_exposures_origin_key_check
    check (origin_observation_key ~ '^origin:v1:[0-9a-f]{64}$'),
  constraint dilution_economic_exposures_accession_check
    check (origin_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint dilution_economic_exposures_lineage_text_check check (
    origin_analyzer_key = pg_catalog.btrim(origin_analyzer_key)
    and pg_catalog.length(origin_analyzer_key) between 1 and 120
    and origin_analyzer_contract_version = pg_catalog.btrim(origin_analyzer_contract_version)
    and pg_catalog.length(origin_analyzer_contract_version) between 1 and 120
    and origin_resolver_contract_version = 'economic_exposure_identity_resolver_v1'
  ),
  constraint dilution_economic_exposures_origin_reason_check check (
    origin_resolver_reason_code in (
      'NO_PRIOR_CANDIDATE', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY'
    )
  ),
  constraint dilution_economic_exposures_exact_identity_unique
    unique (exposure_id, issuer_cik, exposure_type)
);

create index dilution_economic_exposures_issuer_type_idx
  on public.dilution_economic_exposures (issuer_cik, exposure_type, created_at, exposure_id);

create table public.dilution_source_observations (
  observation_id uuid primary key default extensions.gen_random_uuid(),
  observation_key text not null unique,
  canonical_fingerprint jsonb not null,
  canonical_fingerprint_serialization text not null,
  issuer_cik text not null references public.sec_issuers(cik),
  accession text not null,
  source_execution_id uuid not null references public.ai_runs(id),
  parent_primary_ai_run_id uuid not null references public.ai_runs(id),
  analyzer_key text not null,
  analyzer_contract_version text not null,
  source_observation_version text not null,
  exposure_type text not null,
  observation_kind text not null,
  observation_status text not null,
  identity_decision text not null,
  resolver_reason_code text not null,
  identity_decision_version text not null,
  resolver_contract_version text not null,
  exposure_id uuid,
  identity_claims jsonb not null,
  observed_fields jsonb not null,
  identity_evidence jsonb not null,
  registration_context jsonb not null default '[]'::jsonb,
  observation_payload jsonb not null,
  resolver_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint dilution_source_observations_key_check check (
    observation_key ~ '^obs:v1:[0-9a-f]{64}$'
    and canonical_fingerprint_serialization::jsonb = canonical_fingerprint
    and observation_key = 'obs:v1:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(canonical_fingerprint_serialization, 'UTF8'), 'sha256'),
      'hex'
    )
  ),
  constraint dilution_source_observations_cik_check
    check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  constraint dilution_source_observations_accession_check
    check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint dilution_source_observations_type_check check (
    exposure_type in (
      'convertible_note', 'warrant', 'prefunded_warrant',
      'convertible_preferred', 'atm_program', 'equity_line'
    )
  ),
  constraint dilution_source_observations_kind_check check (
    observation_kind in ('exposure_identity', 'exposure_terms', 'exposure_amendment')
  ),
  constraint dilution_source_observations_status_check check (
    observation_status in (
      'VALIDATED', 'EVIDENCE_IDENTITY_MISMATCH', 'SEMANTIC_ROLE_UNAVAILABLE',
      'IDENTITY_UNRESOLVED', 'IDENTITY_CONFLICT',
      'REGISTRATION_IDENTITY_UNRESOLVED', 'REGISTRATION_RELATIONSHIP_UNRESOLVED',
      'TERMS_VERSION_UNRESOLVED', 'ISSUANCE_AVAILABILITY_INDETERMINATE',
      'CURRENT_CONTRACT_RESULT_INCOMPLETE_OR_FAILED',
      'REALIZED_ISSUANCE_ATTRIBUTION_UNRESOLVED'
    )
  ),
  constraint dilution_source_observations_decision_check check (
    identity_decision in (
      'CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT'
    )
  ),
  constraint dilution_source_observations_reason_check check (
    resolver_reason_code in (
      'NO_PRIOR_CANDIDATE', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY',
      'EXPLICIT_SOURCE_REFERENCE_MATCH', 'EXPLICIT_AMENDMENT_REFERENCE_MATCH',
      'SOURCE_BACKED_STRONG_IDENTITY_MATCH', 'INSUFFICIENT_SOURCE_BACKED_IDENTITY',
      'CONFLICTING_STRONG_IDENTITY_CLAIMS', 'CROSS_ISSUER_IDENTITY_CONFLICT',
      'EXPOSURE_TYPE_CONFLICT', 'AMBIGUOUS_STRONG_IDENTITY_MATCH',
      'AMBIGUOUS_AMENDMENT_TARGET', 'NON_EXPOSURE_OBSERVATION',
      'EVIDENCE_VALIDATION_FAILED'
    )
    and (
      (identity_decision = 'CREATE_NEW' and resolver_reason_code in (
        'NO_PRIOR_CANDIDATE', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY'
      ))
      or (identity_decision = 'LINK_EXISTING' and resolver_reason_code in (
        'EXPLICIT_SOURCE_REFERENCE_MATCH', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH'
      ))
      or (identity_decision = 'AMEND_EXISTING'
        and resolver_reason_code = 'EXPLICIT_AMENDMENT_REFERENCE_MATCH')
      or (identity_decision = 'UNRESOLVED' and resolver_reason_code in (
        'INSUFFICIENT_SOURCE_BACKED_IDENTITY', 'NON_EXPOSURE_OBSERVATION',
        'EVIDENCE_VALIDATION_FAILED'
      ))
      or (identity_decision = 'CONFLICT' and resolver_reason_code in (
        'CONFLICTING_STRONG_IDENTITY_CLAIMS', 'CROSS_ISSUER_IDENTITY_CONFLICT',
        'EXPOSURE_TYPE_CONFLICT', 'AMBIGUOUS_STRONG_IDENTITY_MATCH',
        'AMBIGUOUS_AMENDMENT_TARGET'
      ))
    )
  ),
  constraint dilution_source_observations_version_check check (
    source_observation_version = 'dilution_source_observation_v1'
    and identity_decision_version = 'dilution_identity_decision_v1'
    and resolver_contract_version = 'economic_exposure_identity_resolver_v1'
  ),
  constraint dilution_source_observations_lineage_text_check check (
    analyzer_key = pg_catalog.btrim(analyzer_key)
    and pg_catalog.length(analyzer_key) between 1 and 120
    and analyzer_contract_version = pg_catalog.btrim(analyzer_contract_version)
    and pg_catalog.length(analyzer_contract_version) between 1 and 120
  ),
  constraint dilution_source_observations_decision_target_check check (
    (
      identity_decision in ('CREATE_NEW', 'LINK_EXISTING', 'AMEND_EXISTING')
      and exposure_id is not null
      and observation_status = 'VALIDATED'
    )
    or (
      identity_decision in ('UNRESOLVED', 'CONFLICT')
      and exposure_id is null
    )
  ),
  constraint dilution_source_observations_json_types_check check (
    pg_catalog.jsonb_typeof(canonical_fingerprint) = 'object'
    and pg_catalog.jsonb_typeof(identity_claims) = 'array'
    and pg_catalog.jsonb_typeof(observed_fields) = 'array'
    and pg_catalog.jsonb_typeof(identity_evidence) = 'array'
    and pg_catalog.jsonb_typeof(registration_context) = 'array'
    and pg_catalog.jsonb_typeof(observation_payload) = 'object'
    and pg_catalog.jsonb_typeof(resolver_payload) = 'object'
  ),
  constraint dilution_source_observations_payload_materialization_check check (coalesce((
    observation_payload->>'version' = source_observation_version
    and observation_payload->>'issuer_cik' = issuer_cik
    and observation_payload->>'accession' = accession
    and observation_payload->>'exposure_type' = exposure_type
    and observation_payload->>'observation_kind' = observation_kind
    and observation_payload->>'status' = observation_status
    and observation_payload->'identity_claims' = identity_claims
    and observation_payload->'observed_fields' = observed_fields
    and observation_payload#>>'{analysis_lineage,source_execution_id}' = source_execution_id::text
    and observation_payload#>>'{analysis_lineage,parent_primary_ai_run_id}' = parent_primary_ai_run_id::text
    and observation_payload#>>'{analysis_lineage,analyzer_key}' = analyzer_key
    and observation_payload#>>'{analysis_lineage,analyzer_contract_version}' = analyzer_contract_version
    and resolver_payload->>'version' = identity_decision_version
    and resolver_payload->>'resolver_version' = resolver_contract_version
    and resolver_payload->>'decision' = identity_decision
    and resolver_payload->>'reason_code' = resolver_reason_code
    and resolver_payload->'identity_evidence' = identity_evidence
    and (
      (identity_decision in ('LINK_EXISTING', 'AMEND_EXISTING')
        and resolver_payload->>'target_exposure_id' is not distinct from exposure_id::text)
      or (identity_decision in ('CREATE_NEW', 'UNRESOLVED', 'CONFLICT')
        and resolver_payload->>'target_exposure_id' is null)
    )
  ), false)),
  constraint dilution_source_observations_exact_exposure_fkey
    foreign key (exposure_id, issuer_cik, exposure_type)
    references public.dilution_economic_exposures (exposure_id, issuer_cik, exposure_type)
);

create index dilution_source_observations_issuer_history_idx
  on public.dilution_source_observations (issuer_cik, created_at, observation_id);

create index dilution_source_observations_exposure_history_idx
  on public.dilution_source_observations (exposure_id, created_at, observation_id)
  where exposure_id is not null;

create index dilution_source_observations_unresolved_idx
  on public.dilution_source_observations (issuer_cik, identity_decision, created_at, observation_id)
  where exposure_id is null;

create index dilution_source_observations_lineage_idx
  on public.dilution_source_observations (source_execution_id, analyzer_contract_version);

alter table public.dilution_economic_exposures enable row level security;

alter table public.dilution_source_observations enable row level security;

revoke all on table public.dilution_economic_exposures
  from public, anon, authenticated, service_role;

revoke all on table public.dilution_source_observations
  from public, anon, authenticated, service_role;

grant select, insert on table public.dilution_economic_exposures to service_role;

grant select, insert on table public.dilution_source_observations to service_role;

comment on table public.dilution_economic_exposures is
  'Stable internal economic-exposure identities only. Rows contain immutable creation provenance and no terms, state, or calculations.';

comment on column public.dilution_economic_exposures.origin_observation_key is
  'Replay-only creation key for one resolver-authorized CREATE_NEW observation; not an external instrument identity.';

comment on table public.dilution_source_observations is
  'Append-only source/analyzer/resolver observation history. UNRESOLVED and CONFLICT rows retain evidence with no exposure link.';

comment on column public.dilution_source_observations.canonical_fingerprint is
  'Order-stable, non-inferential identity material used only to verify observation_key.';

create or replace function public.persist_dilution_source_observation(
  p_observation_key text,
  p_canonical_fingerprint jsonb,
  p_canonical_fingerprint_serialization text,
  p_observation_payload jsonb,
  p_resolver_payload jsonb,
  p_registration_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_key text;
  v_issuer_cik text;
  v_accession text;
  v_exposure_type text;
  v_observation_kind text;
  v_observation_status text;
  v_source_execution_id uuid;
  v_parent_primary_ai_run_id uuid;
  v_analyzer_key text;
  v_analyzer_contract_version text;
  v_decision text;
  v_reason text;
  v_target_text text;
  v_target_exposure_id uuid;
  v_exposure public.dilution_economic_exposures%rowtype;
  v_existing public.dilution_source_observations%rowtype;
  v_origin_key text;
  v_inserted integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_canonical_fingerprint) <> 'object'
    or p_canonical_fingerprint_serialization is null
    or p_canonical_fingerprint_serialization::jsonb is distinct from p_canonical_fingerprint
    or pg_catalog.jsonb_typeof(p_observation_payload) <> 'object'
    or pg_catalog.jsonb_typeof(p_resolver_payload) <> 'object'
    or pg_catalog.jsonb_typeof(p_registration_context) <> 'array'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  v_expected_key := 'obs:v1:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_canonical_fingerprint_serialization, 'UTF8'), 'sha256'),
    'hex'
  );
  if p_observation_key is distinct from v_expected_key then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'observation_key_mismatch');
  end if;

  v_issuer_cik := p_observation_payload->>'issuer_cik';
  v_accession := p_observation_payload->>'accession';
  v_exposure_type := p_observation_payload->>'exposure_type';
  v_observation_kind := p_observation_payload->>'observation_kind';
  v_observation_status := p_observation_payload->>'status';
  v_analyzer_key := p_observation_payload#>>'{analysis_lineage,analyzer_key}';
  v_analyzer_contract_version := p_observation_payload#>>'{analysis_lineage,analyzer_contract_version}';
  v_decision := p_resolver_payload->>'decision';
  v_reason := p_resolver_payload->>'reason_code';
  v_target_text := p_resolver_payload->>'target_exposure_id';

  if coalesce(v_issuer_cik, '') !~ '^[0-9]{10}$'
    or v_issuer_cik = '0000000000'
    or coalesce(v_accession, '') !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
    or coalesce(p_observation_payload#>>'{analysis_lineage,source_execution_id}', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_observation_payload#>>'{analysis_lineage,parent_primary_ai_run_id}', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_observation_identity');
  end if;

  v_source_execution_id := (p_observation_payload#>>'{analysis_lineage,source_execution_id}')::uuid;
  v_parent_primary_ai_run_id := (p_observation_payload#>>'{analysis_lineage,parent_primary_ai_run_id}')::uuid;

  if p_observation_payload->>'version' <> 'dilution_source_observation_v1'
    or p_resolver_payload->>'version' <> 'dilution_identity_decision_v1'
    or p_resolver_payload->>'resolver_version' <> 'economic_exposure_identity_resolver_v1'
    or p_canonical_fingerprint->>'issuer_cik' is distinct from v_issuer_cik
    or p_canonical_fingerprint->>'accession' is distinct from v_accession
    or p_canonical_fingerprint->'analysis_lineage' is distinct from p_observation_payload->'analysis_lineage'
    or p_canonical_fingerprint->>'exposure_type' is distinct from v_exposure_type
    or p_canonical_fingerprint->>'observation_kind' is distinct from v_observation_kind
    or p_canonical_fingerprint->'identity_claims' is null
    or p_canonical_fingerprint->'resolver' is null
    or pg_catalog.jsonb_typeof(p_observation_payload->'identity_claims') <> 'array'
    or pg_catalog.jsonb_typeof(p_observation_payload->'observed_fields') <> 'array'
    or pg_catalog.jsonb_typeof(p_resolver_payload->'identity_evidence') <> 'array'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'contract_shape_invalid');
  end if;

  -- Serializes exact replays while retaining UNIQUE constraints as the final guard.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_observation_key, 0));

  select observation_row.* into v_existing
  from public.dilution_source_observations as observation_row
  where observation_row.observation_key = p_observation_key;
  if found then
    if v_existing.canonical_fingerprint is distinct from p_canonical_fingerprint then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'observation_key_collision');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'idempotent',
      'observation_id', v_existing.observation_id,
      'observation_key', v_existing.observation_key,
      'exposure_id', v_existing.exposure_id,
      'exposure_created', false,
      'observation_created', false
    );
  end if;

  if v_decision = 'CREATE_NEW' then
    if v_target_text is not null then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'create_target_must_be_null');
    end if;
    v_origin_key := 'origin:v1:' || pg_catalog.substr(p_observation_key, 8);
    insert into public.dilution_economic_exposures (
      issuer_cik, exposure_type, origin_observation_key,
      origin_source_execution_id, origin_accession, origin_analyzer_key,
      origin_analyzer_contract_version, origin_resolver_contract_version,
      origin_resolver_reason_code
    ) values (
      v_issuer_cik, v_exposure_type, v_origin_key,
      v_source_execution_id, v_accession, v_analyzer_key,
      v_analyzer_contract_version, p_resolver_payload->>'resolver_version', v_reason
    ) on conflict (origin_observation_key) do nothing;
    get diagnostics v_inserted = row_count;
    select exposure_row.* into strict v_exposure
    from public.dilution_economic_exposures as exposure_row
    where exposure_row.origin_observation_key = v_origin_key;
    if v_exposure.issuer_cik is distinct from v_issuer_cik
      or v_exposure.exposure_type is distinct from v_exposure_type
      or v_exposure.origin_source_execution_id is distinct from v_source_execution_id
    then
      raise exception using errcode = '23514', message = 'DILUTION_ORIGIN_REPLAY_CONFLICT';
    end if;
    v_target_exposure_id := v_exposure.exposure_id;
  elsif v_decision in ('LINK_EXISTING', 'AMEND_EXISTING') then
    if coalesce(v_target_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'target_exposure_invalid');
    end if;
    v_target_exposure_id := v_target_text::uuid;
    select exposure_row.* into v_exposure
    from public.dilution_economic_exposures as exposure_row
    where exposure_row.exposure_id = v_target_exposure_id;
    if not found then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'target_exposure_missing');
    end if;
    if v_exposure.issuer_cik is distinct from v_issuer_cik then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'cross_issuer_target');
    end if;
    if v_exposure.exposure_type is distinct from v_exposure_type then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exposure_type_mismatch');
    end if;
    v_inserted := 0;
  elsif v_decision in ('UNRESOLVED', 'CONFLICT') then
    if v_target_text is not null then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'unlinked_decision_target_must_be_null');
    end if;
    v_target_exposure_id := null;
    v_inserted := 0;
  else
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'identity_decision_invalid');
  end if;

  insert into public.dilution_source_observations (
    observation_key, canonical_fingerprint, canonical_fingerprint_serialization,
    issuer_cik, accession,
    source_execution_id, parent_primary_ai_run_id, analyzer_key,
    analyzer_contract_version, source_observation_version, exposure_type,
    observation_kind, observation_status, identity_decision,
    resolver_reason_code, identity_decision_version, resolver_contract_version,
    exposure_id, identity_claims, observed_fields, identity_evidence,
    registration_context, observation_payload, resolver_payload
  ) values (
    p_observation_key, p_canonical_fingerprint, p_canonical_fingerprint_serialization,
    v_issuer_cik, v_accession,
    v_source_execution_id, v_parent_primary_ai_run_id, v_analyzer_key,
    v_analyzer_contract_version, p_observation_payload->>'version', v_exposure_type,
    v_observation_kind, v_observation_status, v_decision,
    v_reason, p_resolver_payload->>'version', p_resolver_payload->>'resolver_version',
    v_target_exposure_id, p_observation_payload->'identity_claims',
    p_observation_payload->'observed_fields', p_resolver_payload->'identity_evidence',
    p_registration_context, p_observation_payload, p_resolver_payload
  ) returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'status', 'saved',
    'observation_id', v_existing.observation_id,
    'observation_key', v_existing.observation_key,
    'exposure_id', v_existing.exposure_id,
    'exposure_created', v_inserted = 1,
    'observation_created', true
  );
end
$function$;

comment on function public.persist_dilution_source_observation(text, jsonb, text, jsonb, jsonb, jsonb) is
  'Service-role-only atomic executor for locked Economic Exposure resolver decisions. It never derives CREATE_NEW semantics.';

revoke all on function public.persist_dilution_source_observation(text, jsonb, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.persist_dilution_source_observation(text, jsonb, text, jsonb, jsonb, jsonb)
  to service_role;
