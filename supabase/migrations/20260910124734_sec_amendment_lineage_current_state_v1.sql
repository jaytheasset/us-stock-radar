create table public.sec_filing_lineage_observations (
  observation_key text primary key,
  amendment_raw_item_id uuid not null references public.raw_items(id),
  decision text not null,
  prior_raw_item_id uuid references public.raw_items(id),
  issuer_cik text not null,
  form_family text not null,
  amendment_accession text not null,
  prior_accession text,
  operation text,
  affected_fact_keys text[] not null default '{}',
  fact_scope_evidence jsonb not null default '[]'::jsonb,
  amendment_identity jsonb not null,
  prior_identity jsonb,
  review_target_identity jsonb,
  evidence jsonb not null,
  operation_evidence text,
  target_evidence text,
  resolution_reason text,
  recorded_at timestamptz not null default now(),
  constraint sec_filing_lineage_observation_key_check
    check (observation_key ~ '^[0-9a-f]{64}$'),
  constraint sec_filing_lineage_decision_check
    check (decision in ('linked', 'unavailable_review')),
  constraint sec_filing_lineage_cik_check
    check (issuer_cik ~ '^[0-9]{1,10}$'),
  constraint sec_filing_lineage_form_family_check
    check (form_family ~ '^[A-Z0-9][A-Z0-9 -]{0,39}$' and form_family not like '%/A'),
  constraint sec_filing_lineage_accession_check
    check (
      amendment_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
      and (prior_accession is null or prior_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$')
    ),
  constraint sec_filing_lineage_fact_keys_check
    check (
      array_position(affected_fact_keys, '') is null
      and array_to_string(affected_fact_keys, ',') !~ '[^a-z0-9_.:,-]'
    ),
  constraint sec_filing_lineage_fact_scope_evidence_check
    check (jsonb_typeof(fact_scope_evidence) = 'array'),
  constraint sec_filing_lineage_shape_check
    check (
      (
        decision = 'linked'
        and prior_raw_item_id is not null
        and prior_accession is not null
        and operation in ('NOOP', 'SUPPLEMENT', 'REPLACE', 'CANCEL')
        and prior_identity is not null
        and operation_evidence is not null
        and target_evidence is not null
        and resolution_reason is null
        and amendment_accession <> prior_accession
        and (
          (operation in ('SUPPLEMENT', 'REPLACE') and cardinality(affected_fact_keys) > 0)
          or (operation in ('NOOP', 'CANCEL') and cardinality(affected_fact_keys) = 0)
        )
      )
      or (
        decision = 'unavailable_review'
        and prior_raw_item_id is null
        and prior_accession is null
        and operation is null
        and prior_identity is null
        and operation_evidence is null
        and target_evidence is null
        and resolution_reason is not null
        and cardinality(affected_fact_keys) = 0
      )
    )
);

create unique index sec_filing_lineage_one_linked_amendment_idx
  on public.sec_filing_lineage_observations (amendment_raw_item_id)
  where decision = 'linked';

create index sec_filing_lineage_issuer_family_idx
  on public.sec_filing_lineage_observations (issuer_cik, form_family, recorded_at, observation_key);

create table public.sec_filing_semantic_fact_history (
  history_key text primary key,
  raw_item_id uuid not null references public.raw_items(id),
  event_id uuid references public.events(id),
  source_execution_id uuid references public.ai_runs(id),
  issuer_cik text not null,
  form_family text not null,
  source_accession text not null,
  semantic_fact_key text not null,
  fact_payload jsonb not null,
  source_ref jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint sec_filing_semantic_fact_history_key_check
    check (history_key ~ '^[0-9a-f]{64}$'),
  constraint sec_filing_semantic_fact_cik_check
    check (issuer_cik ~ '^[0-9]{1,10}$'),
  constraint sec_filing_semantic_fact_form_family_check
    check (form_family ~ '^[A-Z0-9][A-Z0-9 -]{0,39}$' and form_family not like '%/A'),
  constraint sec_filing_semantic_fact_accession_check
    check (source_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint sec_filing_semantic_fact_key_check
    check (semantic_fact_key ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'),
  constraint sec_filing_semantic_fact_payload_check
    check (jsonb_typeof(fact_payload) = 'object'),
  constraint sec_filing_semantic_fact_source_ref_check
    check (
      jsonb_typeof(source_ref) = 'object'
      and source_ref->>'url' like 'https://www.sec.gov/%'
      and coalesce(btrim(source_ref->>'document'), '') <> ''
      and coalesce(btrim(source_ref->>'evidence'), '') <> ''
    )
);

create index sec_filing_semantic_fact_issuer_family_idx
  on public.sec_filing_semantic_fact_history (issuer_cik, form_family, source_accession, semantic_fact_key);

alter table public.sec_filing_lineage_observations enable row level security;
alter table public.sec_filing_semantic_fact_history enable row level security;

revoke all on table public.sec_filing_lineage_observations from public, anon, authenticated, service_role;
revoke all on table public.sec_filing_semantic_fact_history from public, anon, authenticated, service_role;

create or replace function public.persist_sec_filing_original_facts(
  p_identity jsonb,
  p_facts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw public.raw_items;
  v_fact jsonb;
  v_existing public.sec_filing_semantic_fact_history;
  v_inserted integer := 0;
  v_idempotent integer := 0;
begin
  if jsonb_typeof(p_identity) <> 'object' or jsonb_typeof(p_facts) <> 'array' then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_payload_shape');
  end if;

  select raw_row.* into v_raw
  from public.raw_items as raw_row
  where raw_row.id = (p_identity->>'rawItemId')::uuid
  for share;

  if v_raw.id is null
    or v_raw.source_code <> 'sec_edgar'
    or v_raw.source_unique_id is distinct from p_identity->>'accessionNumber'
    or v_raw.raw_payload->>'accession_number' is distinct from p_identity->>'accessionNumber'
    or upper(btrim(v_raw.raw_payload->>'form_type')) is distinct from upper(btrim(p_identity->>'formType'))
    or upper(btrim(p_identity->>'formType')) like '%/A'
    or coalesce(p_identity->>'issuerCik', '') !~ '^[0-9]{1,10}$'
    or regexp_replace(coalesce(v_raw.raw_payload->>'cik', ''), '^0+', '')
      is distinct from regexp_replace(coalesce(p_identity->>'issuerCik', ''), '^0+', '')
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'root_raw_identity_mismatch');
  end if;

  -- Validate the whole batch, including immutable-key conflicts, before the
  -- first insert so a rejected multi-fact request cannot be partially saved.
  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    if v_fact->>'rawItemId' is distinct from p_identity->>'rawItemId'
      or v_fact->>'sourceAccessionNumber' is distinct from p_identity->>'accessionNumber'
      or jsonb_typeof(v_fact->'factPayload') <> 'object'
      or jsonb_typeof(v_fact->'sourceRef') <> 'object'
      or v_fact#>>'{sourceRef,url}' not like '%' || replace(p_identity->>'accessionNumber', '-', '') || '%'
      or split_part(v_fact#>>'{sourceRef,url}', '/', -1) is distinct from v_fact#>>'{sourceRef,document}'
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'fact_identity_mismatch');
    end if;

    select fact_row.* into v_existing
    from public.sec_filing_semantic_fact_history as fact_row
    where fact_row.history_key = v_fact->>'historyKey';
    if v_existing.history_key is not null
      and (
        v_existing.raw_item_id::text is distinct from v_fact->>'rawItemId'
        or v_existing.source_accession is distinct from v_fact->>'sourceAccessionNumber'
        or v_existing.semantic_fact_key is distinct from v_fact->>'semanticFactKey'
        or v_existing.fact_payload is distinct from v_fact->'factPayload'
        or v_existing.source_ref is distinct from v_fact->'sourceRef'
      )
    then
      return jsonb_build_object('status', 'conflict', 'reason', 'history_key_payload_conflict');
    end if;
  end loop;

  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    if v_fact->>'rawItemId' is distinct from p_identity->>'rawItemId'
      or v_fact->>'sourceAccessionNumber' is distinct from p_identity->>'accessionNumber'
      or jsonb_typeof(v_fact->'factPayload') <> 'object'
      or jsonb_typeof(v_fact->'sourceRef') <> 'object'
      or v_fact#>>'{sourceRef,url}' not like '%' || replace(p_identity->>'accessionNumber', '-', '') || '%'
      or split_part(v_fact#>>'{sourceRef,url}', '/', -1) is distinct from v_fact#>>'{sourceRef,document}'
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'fact_identity_mismatch');
    end if;

    insert into public.sec_filing_semantic_fact_history (
      history_key, raw_item_id, event_id, source_execution_id,
      issuer_cik, form_family, source_accession, semantic_fact_key,
      fact_payload, source_ref
    ) values (
      v_fact->>'historyKey',
      (v_fact->>'rawItemId')::uuid,
      nullif(v_fact->>'eventId', '')::uuid,
      nullif(v_fact->>'sourceExecutionId', '')::uuid,
      regexp_replace(p_identity->>'issuerCik', '^0+', ''),
      regexp_replace(upper(btrim(p_identity->>'formType')), '/A$', ''),
      v_fact->>'sourceAccessionNumber',
      v_fact->>'semanticFactKey',
      v_fact->'factPayload',
      v_fact->'sourceRef'
    ) on conflict (history_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    else
      select fact_row.* into v_existing
      from public.sec_filing_semantic_fact_history as fact_row
      where fact_row.history_key = v_fact->>'historyKey';
      if v_existing.raw_item_id::text is distinct from v_fact->>'rawItemId'
        or v_existing.source_accession is distinct from v_fact->>'sourceAccessionNumber'
        or v_existing.semantic_fact_key is distinct from v_fact->>'semanticFactKey'
        or v_existing.fact_payload is distinct from v_fact->'factPayload'
        or v_existing.source_ref is distinct from v_fact->'sourceRef'
      then
        -- A concurrent conflicting writer raced the preflight. Raising keeps
        -- this function call atomic because the exception block rolls back it.
        raise exception 'history_key_payload_conflict';
      end if;
      v_idempotent := v_idempotent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_inserted = 0 then 'idempotent' else 'saved' end,
    'inserted_count', v_inserted,
    'idempotent_count', v_idempotent
  );
exception
  when raise_exception then
    if sqlerrm = 'history_key_payload_conflict' then
      return jsonb_build_object('status', 'conflict', 'reason', 'history_key_payload_conflict');
    end if;
    raise;
  when invalid_text_representation then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_uuid');
  when foreign_key_violation or check_violation then
    return jsonb_build_object('status', 'rejected', 'reason', 'database_contract_rejected');
end;
$$;

create or replace function public.persist_sec_filing_amendment_observation(
  p_observation jsonb,
  p_facts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amendment public.raw_items;
  v_prior public.raw_items;
  v_fact jsonb;
  v_existing public.sec_filing_lineage_observations;
  v_existing_fact public.sec_filing_semantic_fact_history;
  v_inserted integer := 0;
  v_idempotent integer := 0;
  v_decision text := p_observation->>'status';
  v_operation text := p_observation->>'operation';
  v_affected text[];
begin
  if jsonb_typeof(p_observation) <> 'object' or jsonb_typeof(p_facts) <> 'array' then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_payload_shape');
  end if;

  select raw_row.* into v_amendment
  from public.raw_items as raw_row
  where raw_row.id = (p_observation#>>'{amendment,rawItemId}')::uuid
  for share;

  if v_amendment.id is null
    or v_amendment.source_code <> 'sec_edgar'
    or v_amendment.source_unique_id is distinct from p_observation#>>'{amendment,accessionNumber}'
    or v_amendment.raw_payload->>'accession_number' is distinct from p_observation#>>'{amendment,accessionNumber}'
    or upper(btrim(v_amendment.raw_payload->>'form_type')) is distinct from upper(btrim(p_observation#>>'{amendment,formType}'))
    or upper(btrim(p_observation#>>'{amendment,formType}')) not like '%/A'
    or coalesce(p_observation#>>'{amendment,issuerCik}', '') !~ '^[0-9]{1,10}$'
    or regexp_replace(coalesce(v_amendment.raw_payload->>'cik', ''), '^0+', '')
      is distinct from regexp_replace(coalesce(p_observation#>>'{amendment,issuerCik}', ''), '^0+', '')
  then
    return jsonb_build_object('status', 'rejected', 'reason', 'amendment_raw_identity_mismatch');
  end if;

  select coalesce(array_agg(value order by value), '{}') into v_affected
  from jsonb_array_elements_text(coalesce(p_observation->'affectedFactKeys', '[]'::jsonb));

  if v_decision = 'linked' then
    select raw_row.* into v_prior
    from public.raw_items as raw_row
    where raw_row.id = (p_observation#>>'{prior,rawItemId}')::uuid
    for share;
    if v_prior.id is null
      or v_prior.source_code <> 'sec_edgar'
      or v_prior.source_unique_id is distinct from p_observation#>>'{prior,accessionNumber}'
      or v_prior.raw_payload->>'accession_number' is distinct from p_observation#>>'{prior,accessionNumber}'
      or regexp_replace(coalesce(v_prior.raw_payload->>'cik', ''), '^0+', '')
        is distinct from regexp_replace(coalesce(v_amendment.raw_payload->>'cik', ''), '^0+', '')
      or regexp_replace(upper(btrim(v_prior.raw_payload->>'form_type')), '/A$', '')
        is distinct from regexp_replace(upper(btrim(v_amendment.raw_payload->>'form_type')), '/A$', '')
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'prior_raw_identity_mismatch');
    end if;
  elsif v_decision <> 'unavailable_review' then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_decision');
  end if;

  if v_decision = 'linked' and v_operation in ('SUPPLEMENT', 'REPLACE') and jsonb_array_length(p_facts) > 0 then
    if (select coalesce(array_agg(value->>'semanticFactKey' order by value->>'semanticFactKey'), '{}') from jsonb_array_elements(p_facts)) is distinct from v_affected then
      return jsonb_build_object('status', 'rejected', 'reason', 'operation_scope_fact_mismatch');
    end if;
  elsif jsonb_array_length(p_facts) <> 0 then
    return jsonb_build_object('status', 'rejected', 'reason', 'operation_must_not_write_facts');
  end if;

  -- Preflight every immutable fact before recording the observation. This
  -- prevents an invalid/conflicting fact later in the array from leaving a
  -- lineage row without its complete fact batch.
  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    if v_fact->>'rawItemId' is distinct from p_observation#>>'{amendment,rawItemId}'
      or v_fact->>'sourceAccessionNumber' is distinct from p_observation#>>'{amendment,accessionNumber}'
      or jsonb_typeof(v_fact->'factPayload') <> 'object'
      or jsonb_typeof(v_fact->'sourceRef') <> 'object'
      or v_fact#>>'{sourceRef,url}' not like '%' || replace(p_observation#>>'{amendment,accessionNumber}', '-', '') || '%'
      or split_part(v_fact#>>'{sourceRef,url}', '/', -1) is distinct from v_fact#>>'{sourceRef,document}'
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'fact_identity_mismatch');
    end if;

    select fact_row.* into v_existing_fact
    from public.sec_filing_semantic_fact_history as fact_row
    where fact_row.history_key = v_fact->>'historyKey';
    if v_existing_fact.history_key is not null
      and (
        v_existing_fact.raw_item_id::text is distinct from v_fact->>'rawItemId'
        or v_existing_fact.source_accession is distinct from v_fact->>'sourceAccessionNumber'
        or v_existing_fact.semantic_fact_key is distinct from v_fact->>'semanticFactKey'
        or v_existing_fact.fact_payload is distinct from v_fact->'factPayload'
        or v_existing_fact.source_ref is distinct from v_fact->'sourceRef'
      )
    then
      return jsonb_build_object('status', 'conflict', 'reason', 'history_key_payload_conflict');
    end if;
  end loop;

  insert into public.sec_filing_lineage_observations (
    observation_key, amendment_raw_item_id, decision, prior_raw_item_id,
    issuer_cik, form_family, amendment_accession, prior_accession,
    operation, affected_fact_keys, fact_scope_evidence, amendment_identity, prior_identity, review_target_identity,
    evidence, operation_evidence, target_evidence, resolution_reason
  ) values (
    p_observation->>'observationKey',
    v_amendment.id,
    v_decision,
    case when v_decision = 'linked' then v_prior.id else null end,
    regexp_replace(p_observation#>>'{amendment,issuerCik}', '^0+', ''),
    regexp_replace(upper(btrim(p_observation#>>'{amendment,formType}')), '/A$', ''),
    p_observation#>>'{amendment,accessionNumber}',
    case when v_decision = 'linked' then p_observation#>>'{prior,accessionNumber}' else null end,
    case when v_decision = 'linked' then v_operation else null end,
    case when v_decision = 'linked' then v_affected else '{}'::text[] end,
    case when v_decision = 'linked' then p_observation->'factScopeEvidence' else '[]'::jsonb end,
    p_observation->'amendment',
    case when v_decision = 'linked' then p_observation->'prior' else null end,
    case when v_decision = 'unavailable_review' then p_observation->'reviewTarget' else null end,
    p_observation->'evidence',
    case when v_decision = 'linked' then p_observation->>'operationEvidence' else null end,
    case when v_decision = 'linked' then p_observation->>'targetEvidence' else null end,
    case when v_decision = 'unavailable_review' then p_observation->>'reason' else null end
  ) on conflict (observation_key) do nothing;

  if found then
    v_inserted := v_inserted + 1;
  else
    select observation.* into v_existing
    from public.sec_filing_lineage_observations as observation
    where observation.observation_key = p_observation->>'observationKey';
    if v_existing.amendment_identity is distinct from p_observation->'amendment'
      or v_existing.decision is distinct from v_decision
      or v_existing.evidence is distinct from p_observation->'evidence'
      or v_existing.operation is distinct from (case when v_decision = 'linked' then v_operation else null end)
      or v_existing.affected_fact_keys is distinct from (case when v_decision = 'linked' then v_affected else '{}'::text[] end)
      or v_existing.fact_scope_evidence is distinct from (case when v_decision = 'linked' then p_observation->'factScopeEvidence' else '[]'::jsonb end)
      or v_existing.review_target_identity is distinct from (case when v_decision = 'unavailable_review' then p_observation->'reviewTarget' else null end)
    then
      return jsonb_build_object('status', 'conflict', 'reason', 'observation_key_payload_conflict');
    end if;
    v_idempotent := v_idempotent + 1;
  end if;

  for v_fact in select value from jsonb_array_elements(p_facts)
  loop
    if v_fact->>'rawItemId' is distinct from p_observation#>>'{amendment,rawItemId}'
      or v_fact->>'sourceAccessionNumber' is distinct from p_observation#>>'{amendment,accessionNumber}'
      or jsonb_typeof(v_fact->'factPayload') <> 'object'
      or jsonb_typeof(v_fact->'sourceRef') <> 'object'
      or v_fact#>>'{sourceRef,url}' not like '%' || replace(p_observation#>>'{amendment,accessionNumber}', '-', '') || '%'
      or split_part(v_fact#>>'{sourceRef,url}', '/', -1) is distinct from v_fact#>>'{sourceRef,document}'
    then
      return jsonb_build_object('status', 'rejected', 'reason', 'fact_identity_mismatch');
    end if;

    insert into public.sec_filing_semantic_fact_history (
      history_key, raw_item_id, event_id, source_execution_id,
      issuer_cik, form_family, source_accession, semantic_fact_key,
      fact_payload, source_ref
    ) values (
      v_fact->>'historyKey',
      (v_fact->>'rawItemId')::uuid,
      nullif(v_fact->>'eventId', '')::uuid,
      nullif(v_fact->>'sourceExecutionId', '')::uuid,
      regexp_replace(p_observation#>>'{amendment,issuerCik}', '^0+', ''),
      regexp_replace(upper(btrim(p_observation#>>'{amendment,formType}')), '/A$', ''),
      v_fact->>'sourceAccessionNumber',
      v_fact->>'semanticFactKey',
      v_fact->'factPayload',
      v_fact->'sourceRef'
    ) on conflict (history_key) do nothing;
    if found then
      v_inserted := v_inserted + 1;
    else
      select fact_row.* into v_existing_fact
      from public.sec_filing_semantic_fact_history as fact_row
      where fact_row.history_key = v_fact->>'historyKey';
      if v_existing_fact.raw_item_id::text is distinct from v_fact->>'rawItemId'
        or v_existing_fact.source_accession is distinct from v_fact->>'sourceAccessionNumber'
        or v_existing_fact.semantic_fact_key is distinct from v_fact->>'semanticFactKey'
        or v_existing_fact.fact_payload is distinct from v_fact->'factPayload'
        or v_existing_fact.source_ref is distinct from v_fact->'sourceRef'
      then
        raise exception 'history_key_payload_conflict';
      end if;
      v_idempotent := v_idempotent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_inserted = 0 then 'idempotent' else 'saved' end,
    'inserted_count', v_inserted,
    'idempotent_count', v_idempotent
  );
exception
  when raise_exception then
    if sqlerrm = 'history_key_payload_conflict' then
      return jsonb_build_object('status', 'conflict', 'reason', 'history_key_payload_conflict');
    end if;
    raise;
  when unique_violation then
    return jsonb_build_object('status', 'conflict', 'reason', 'amendment_already_linked_differently');
  when invalid_text_representation then
    return jsonb_build_object('status', 'rejected', 'reason', 'invalid_uuid');
  when foreign_key_violation or check_violation then
    return jsonb_build_object('status', 'rejected', 'reason', 'database_contract_rejected');
end;
$$;

create or replace function public.read_sec_filing_amendment_ledger(
  p_root_raw_item_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_root public.raw_items;
  v_cik text;
  v_family text;
begin
  select raw_row.* into v_root
  from public.raw_items as raw_row
  where raw_row.id = p_root_raw_item_id;
  if v_root.id is null or v_root.source_code <> 'sec_edgar' then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_raw_item_missing');
  end if;
  v_cik := regexp_replace(coalesce(v_root.raw_payload->>'cik', ''), '^0+', '');
  v_family := regexp_replace(upper(btrim(coalesce(v_root.raw_payload->>'form_type', ''))), '/A$', '');
  if v_cik = '' or v_family = '' or upper(btrim(v_root.raw_payload->>'form_type')) like '%/A' then
    return jsonb_build_object('status', 'not_ready', 'reason', 'root_raw_identity_invalid');
  end if;

  return jsonb_build_object(
    'status', 'available',
    'root', jsonb_build_object(
      'rawItemId', v_root.id,
      'sourceCode', v_root.source_code,
      'issuerCik', v_root.raw_payload->>'cik',
      'accessionNumber', v_root.raw_payload->>'accession_number',
      'formType', v_root.raw_payload->>'form_type',
      'filedDate', v_root.raw_payload->>'filed_date',
      'primaryDocumentUrl', v_root.raw_payload->>'primary_document_url',
      'indexUrl', v_root.source_url
    ),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', observation.decision,
        'version', 'sec_amendment_lineage_v1',
        'amendment', observation.amendment_identity,
        'prior', observation.prior_identity,
        'formFamily', observation.form_family,
        'operation', observation.operation,
        'operationEvidence', observation.operation_evidence,
        'targetEvidence', observation.target_evidence,
        'affectedFactKeys', to_jsonb(observation.affected_fact_keys),
        'factScopeEvidence', observation.fact_scope_evidence,
        'reviewTarget', observation.review_target_identity,
        'evidence', observation.evidence,
        'reason', observation.resolution_reason,
        'observationKey', observation.observation_key
      ) order by observation.recorded_at, observation.observation_key)
      from public.sec_filing_lineage_observations as observation
      where observation.issuer_cik = v_cik and observation.form_family = v_family
    ), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rawItemId', fact.raw_item_id,
        'sourceAccessionNumber', fact.source_accession,
        'semanticFactKey', fact.semantic_fact_key,
        'factPayload', fact.fact_payload,
        'sourceRef', fact.source_ref,
        'eventId', fact.event_id,
        'sourceExecutionId', fact.source_execution_id
      ) order by fact.recorded_at, fact.history_key)
      from public.sec_filing_semantic_fact_history as fact
      where fact.issuer_cik = v_cik and fact.form_family = v_family
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.persist_sec_filing_original_facts(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.persist_sec_filing_amendment_observation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.read_sec_filing_amendment_ledger(uuid) from public, anon, authenticated;
grant execute on function public.persist_sec_filing_original_facts(jsonb, jsonb) to service_role;
grant execute on function public.persist_sec_filing_amendment_observation(jsonb, jsonb) to service_role;
grant execute on function public.read_sec_filing_amendment_ledger(uuid) to service_role;

-- Preserve the existing Primary route gate. The only exception is a persisted,
-- exact REPLACE lineage whose official scope targets the already-materialized
-- Corporate Action fact on the stable root event. This admits the amendment
-- correction without rewriting the Primary output or weakening non-amendment
-- executions.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.persist_corporate_action_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := $old$return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exact_parent_output_or_route_invalid');$old$;
  v_new := $new$if not exists (
      select 1
      from public.sec_filing_lineage_observations as observation
      join public.raw_items as prior_raw
        on prior_raw.id = observation.prior_raw_item_id
      join public.events as root_event
        on root_event.raw_item_id = observation.prior_raw_item_id
      where observation.observation_key = v_execution.metadata->>'sec_amendment_observation_key'
        and observation.decision = 'linked'
        and observation.operation = 'REPLACE'
        and observation.amendment_raw_item_id = v_event.raw_item_id
        and observation.amendment_accession = v_raw.source_unique_id
        and observation.prior_raw_item_id::text = v_execution.metadata->>'sec_amendment_root_raw_item_id'
        and observation.prior_accession = v_execution.metadata->>'sec_amendment_root_accession'
        and observation.issuer_cik = regexp_replace(v_execution.metadata->>'sec_amendment_issuer_cik', '^0+', '')
        and observation.affected_fact_keys @> array['monitor.corporate_action']::text[]
        and observation.fact_scope_evidence @> '[{"semanticFactKey":"monitor.corporate_action"}]'::jsonb
        and v_execution.metadata->>'sec_amendment_operation' = observation.operation
        and v_execution.metadata->>'sec_amendment_amendment_accession' = observation.amendment_accession
        and v_execution.metadata->'sec_amendment_affected_fact_keys' @> '["monitor.corporate_action"]'::jsonb
        and v_execution.metadata->>'alert_event_id' = root_event.id::text
        and root_event.source_code = 'sec_edgar'
        and root_event.source_group::text = 'filings'
        and prior_raw.source_code = 'sec_edgar'
        and prior_raw.source_unique_id = observation.prior_accession
        and regexp_replace(prior_raw.raw_payload->>'cik', '^0+', '') = observation.issuer_cik
        and regexp_replace(upper(btrim(prior_raw.raw_payload->>'form_type')), '/A$', '') = observation.form_family
        and observation.amendment_identity->>'rawItemId' = v_event.raw_item_id::text
        and observation.amendment_identity->>'accessionNumber' = observation.amendment_accession
        and observation.prior_identity->>'rawItemId' = observation.prior_raw_item_id::text
        and observation.prior_identity->>'accessionNumber' = observation.prior_accession
        and exists (
          select 1
          from public.event_corporate_action_results as root_result
          join public.event_corporate_action_facts as root_fact
            on root_fact.source_execution_id = root_result.source_execution_id
          where root_result.event_id = root_event.id
            and root_result.raw_item_id = observation.prior_raw_item_id
            and root_result.applicable = true
        )
        and exists (
          select 1
          from public.ai_outputs as output_row
          where output_row.ai_run_id = v_parent_id
            and output_row.event_id = p_event_id
            and output_row.output_type = v_parent_output_type
            and coalesce(
              output_row.payload#>>'{analysis,sec_8k_6k_amendment_delta,is_amendment}',
              output_row.payload#>>'{analysis,amendment_delta,is_amendment}'
            ) = 'true'
            and coalesce(
              output_row.payload#>>'{analysis,sec_8k_6k_amendment_delta,parent_accession}',
              output_row.payload#>>'{analysis,amendment_delta,parent_accession}'
            ) = observation.prior_accession
        )
        and (
          select pg_catalog.count(*)
          from public.ai_outputs as exact_output
          where exact_output.ai_run_id = v_parent_id
            and exact_output.event_id = p_event_id
            and exact_output.output_type = v_parent_output_type
        ) = 1
    ) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'exact_parent_output_or_route_invalid');
    end if;$new$;
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'corporate_action_amendment_route_gate_source_unexpected';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

comment on table public.sec_filing_lineage_observations is
  'Append-only, source-backed SEC amendment linkage decisions. unavailable_review rows never change current state.';
comment on table public.sec_filing_semantic_fact_history is
  'Append-only semantic fact versions used by the SEC amendment current-state projector.';
comment on function public.read_sec_filing_amendment_ledger(uuid) is
  'Returns immutable ledger inputs only; deterministic current state and Alert identity are projected in application code.';
