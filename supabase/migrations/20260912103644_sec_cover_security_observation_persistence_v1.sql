create table public.sec_cover_observation_results (
  id uuid primary key,
  lineage_kind text not null,
  raw_item_id uuid references public.raw_items(id) on delete restrict,
  filing_ledger_accession_number text references public.sec_filing_ledger(accession_number) on delete restrict,
  filing_ledger_source_raw_id uuid,
  filing_ledger_source_kind text,
  accession_number text not null,
  issuer_cik text not null,
  form_type_raw text not null,
  filing_date_raw text,
  accepted_at_raw text,
  accepted_at timestamptz,
  source_parser_version text,
  source_state text not null,
  source_state_hash text not null,
  source_raw_id uuid,
  source_kind text not null default 'filing_xbrl',
  source_url text,
  source_document text,
  source_sha256 text,
  extraction_method text not null,
  extraction_version text not null,
  extraction_status text not null,
  observation_count integer not null,
  result_payload jsonb not null,
  payload_sha256 text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_cover_observation_results_identity_unique unique (id, issuer_cik),
  constraint sec_cover_observation_results_replay_unique
    unique (lineage_kind, accession_number, source_state_hash, extraction_version, payload_sha256),
  constraint sec_cover_observation_results_lineage_check
    check (
      (lineage_kind = 'raw_item_primary_document'
        and raw_item_id is not null
        and filing_ledger_accession_number is null
        and filing_ledger_source_raw_id is null
        and filing_ledger_source_kind is null)
      or (lineage_kind = 'structured_filing_artifact'
        and raw_item_id is null
        and filing_ledger_accession_number = accession_number
        and filing_ledger_source_raw_id is not null
        and filing_ledger_source_kind = 'submissions')
    ),
  constraint sec_cover_observation_results_accession_check
    check (accession_number ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint sec_cover_observation_results_cik_check
    check (issuer_cik ~ '^\d{10}$' and issuer_cik <> '0000000000'),
  constraint sec_cover_observation_results_form_check
    check (pg_catalog.btrim(form_type_raw) <> '' and pg_catalog.char_length(form_type_raw) <= 32),
  constraint sec_cover_observation_results_filing_date_check
    check (filing_date_raw is null or filing_date_raw ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint sec_cover_observation_results_accepted_at_check
    check (
      (accepted_at_raw is null and accepted_at is null)
      or (accepted_at_raw is not null and accepted_at is not null)
    ),
  constraint sec_cover_observation_results_source_state_check
    check (source_state in ('available', 'missing', 'truncated')),
  constraint sec_cover_observation_results_source_hash_check
    check (
      source_state_hash ~ '^[0-9a-f]{64}$'
      and (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$')
      and payload_sha256 ~ '^[0-9a-f]{64}$'
    ),
  constraint sec_cover_observation_results_source_check
    check (
      (source_state = 'available'
        and source_raw_id is not null
        and source_url ~ '^https://([a-z0-9-]+\.)*sec\.gov/Archives/edgar/data/'
        and pg_catalog.btrim(source_document) <> ''
        and source_sha256 is not null)
      or (source_state in ('missing', 'truncated') and source_raw_id is null)
    ),
  constraint sec_cover_observation_results_source_kind_check check (source_kind = 'filing_xbrl'),
  constraint sec_cover_observation_results_source_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_cover_observation_results_ledger_raw_fk
    foreign key (filing_ledger_source_raw_id, issuer_cik, filing_ledger_source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_cover_observation_results_extraction_check
    check (
      extraction_method = 'sec-filing-xbrl-context-parser'
      and extraction_version = 'sec-cover-security-observation-v1'
      and extraction_status in (
        'available', 'partial', 'source_missing', 'source_truncated', 'parse_failed',
        'unsupported_context', 'identity_mismatch', 'no_cover_facts'
      )
    ),
  constraint sec_cover_observation_results_count_check check (observation_count between 0 and 1000),
  constraint sec_cover_observation_results_payload_check check (pg_catalog.jsonb_typeof(result_payload) = 'object')
);

create table public.sec_cover_security_observations (
  result_id uuid not null,
  observation_index integer not null,
  observation_key text not null,
  issuer_cik_raw text not null,
  issuer_cik text not null,
  context_ref text not null,
  context_hash text not null,
  period_kind text not null,
  instant_date date,
  start_date date,
  end_date date,
  dimensions_payload jsonb not null,
  security_title_status text not null,
  security_title_raw text,
  trading_symbol_status text not null,
  trading_symbol_raw text,
  exchange_status text not null,
  exchange_raw text,
  structural_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (result_id, observation_index),
  constraint sec_cover_security_observations_key_unique unique (result_id, observation_key),
  constraint sec_cover_security_observations_result_fk
    foreign key (result_id, issuer_cik)
    references public.sec_cover_observation_results(id, issuer_cik) on delete cascade,
  constraint sec_cover_security_observations_index_check check (observation_index between 0 and 999),
  constraint sec_cover_security_observations_hash_check
    check (observation_key ~ '^[0-9a-f]{64}$' and context_hash ~ '^[0-9a-f]{64}$'),
  constraint sec_cover_security_observations_cik_check
    check (
      issuer_cik_raw ~ '^\d{1,10}$'
      and issuer_cik ~ '^\d{10}$'
      and issuer_cik = pg_catalog.lpad(issuer_cik_raw, 10, '0')
    ),
  constraint sec_cover_security_observations_context_check
    check (pg_catalog.btrim(context_ref) <> '' and pg_catalog.char_length(context_ref) <= 512),
  constraint sec_cover_security_observations_period_check
    check (
      (period_kind = 'instant' and instant_date is not null and start_date is null and end_date is null)
      or (period_kind = 'duration' and instant_date is null and start_date is not null and end_date is not null and start_date <= end_date)
    ),
  constraint sec_cover_security_observations_dimensions_check check (pg_catalog.jsonb_typeof(dimensions_payload) = 'array'),
  constraint sec_cover_security_observations_field_status_check
    check (
      security_title_status in ('observed', 'source_missing', 'explicit_nil', 'explicit_blank', 'explicit_empty', 'duplicate_equal', 'duplicate_conflict', 'unsupported')
      and trading_symbol_status in ('observed', 'source_missing', 'explicit_nil', 'explicit_blank', 'explicit_empty', 'duplicate_equal', 'duplicate_conflict', 'unsupported')
      and exchange_status in ('observed', 'source_missing', 'explicit_nil', 'explicit_blank', 'explicit_empty', 'duplicate_equal', 'duplicate_conflict', 'unsupported')
    ),
  constraint sec_cover_security_observations_field_value_check
    check (
      ((security_title_status in ('observed', 'duplicate_equal', 'explicit_blank')) = (security_title_raw is not null))
      and ((trading_symbol_status in ('observed', 'duplicate_equal', 'explicit_blank')) = (trading_symbol_raw is not null))
      and ((exchange_status in ('observed', 'duplicate_equal', 'explicit_blank')) = (exchange_raw is not null))
    ),
  constraint sec_cover_security_observations_payload_check check (pg_catalog.jsonb_typeof(structural_payload) = 'object')
);

create index sec_cover_observation_results_accession_created_idx
  on public.sec_cover_observation_results (accession_number, created_at desc, id desc);
create index sec_cover_observation_results_issuer_created_idx
  on public.sec_cover_observation_results (issuer_cik, created_at desc, id desc);
create index sec_cover_observation_results_source_idx
  on public.sec_cover_observation_results (source_sha256, accession_number) where source_sha256 is not null;
create index sec_cover_security_observations_context_idx
  on public.sec_cover_security_observations (context_ref, result_id);

alter table public.sec_cover_observation_results enable row level security;
alter table public.sec_cover_security_observations enable row level security;

revoke all on table public.sec_cover_observation_results from public, anon, authenticated, service_role;
revoke all on table public.sec_cover_security_observations from public, anon, authenticated, service_role;
grant select, insert on table public.sec_cover_observation_results to service_role;
grant select, insert on table public.sec_cover_security_observations to service_role;

create or replace function public.reject_sec_cover_observation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'SEC cover observation rows are append-only';
end;
$$;

create trigger sec_cover_observation_results_append_only
before update or delete on public.sec_cover_observation_results
for each row execute function public.reject_sec_cover_observation_mutation();

create trigger sec_cover_security_observations_append_only
before update or delete on public.sec_cover_security_observations
for each row execute function public.reject_sec_cover_observation_mutation();

create or replace function public.persist_sec_cover_observation_result(
  p_raw_item_id uuid,
  p_source jsonb,
  p_result jsonb,
  p_observations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_raw public.raw_items%rowtype;
  v_ledger public.sec_filing_ledger%rowtype;
  v_source public.sec_structured_raw_sources%rowtype;
  v_result_id uuid;
  v_source_id uuid;
  v_existing public.sec_cover_observation_results%rowtype;
  v_observation_count integer;
begin
  if coalesce(pg_catalog.jsonb_typeof(p_result), '') <> 'object' then
    raise exception using errcode = '22023', message = 'SEC cover result payload must be an object';
  end if;
  if coalesce(pg_catalog.jsonb_typeof(p_observations), '') <> 'array' then
    raise exception using errcode = '22023', message = 'SEC cover observations payload must be an array';
  end if;
  if p_source is not null and coalesce(pg_catalog.jsonb_typeof(p_source), '') <> 'object' then
    raise exception using errcode = '22023', message = 'SEC cover raw source payload must be an object or null';
  end if;

  if p_result ->> 'lineage_kind' = 'raw_item_primary_document' then
    select * into v_raw from public.raw_items where id = p_raw_item_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'SEC cover raw item does not exist';
    end if;
    if v_raw.source_code <> 'sec_edgar'
       or v_raw.source_group::text <> 'filings'
       or v_raw.source_unique_id is distinct from p_result ->> 'accession_number'
       or v_raw.raw_payload ->> 'accession_number' is distinct from p_result ->> 'accession_number'
       or pg_catalog.lpad(v_raw.raw_payload ->> 'cik', 10, '0') is distinct from p_result ->> 'issuer_cik'
       or pg_catalog.upper(pg_catalog.regexp_replace(v_raw.raw_payload ->> 'form_type', '\s+', '', 'g')) is distinct from p_result ->> 'form_type_raw'
       or p_result ->> 'raw_item_id' is distinct from p_raw_item_id::text
       or p_result ->> 'filing_ledger_accession_number' is not null
       or p_result ->> 'filing_ledger_source_raw_id' is not null then
      raise exception using errcode = '22023', message = 'SEC cover raw item identity does not match result identity';
    end if;
  elsif p_result ->> 'lineage_kind' = 'structured_filing_artifact' then
    if p_raw_item_id is not null or p_result ->> 'raw_item_id' is not null then
      raise exception using errcode = '22023', message = 'SEC structured cover result must not claim raw-item lineage';
    end if;
    select * into v_ledger
    from public.sec_filing_ledger
    where accession_number = p_result ->> 'accession_number';
    if not found
       or v_ledger.issuer_cik is distinct from p_result ->> 'issuer_cik'
       or v_ledger.form is distinct from p_result ->> 'form_type_raw'
       or v_ledger.filed_date::text is distinct from p_result ->> 'filing_date_raw'
       or v_ledger.accepted_at is distinct from nullif(p_result ->> 'accepted_at', '')::timestamptz
       or v_ledger.source_raw_id::text is distinct from p_result ->> 'filing_ledger_source_raw_id'
       or p_result ->> 'filing_ledger_accession_number' is distinct from v_ledger.accession_number
       or p_result ->> 'filing_ledger_source_kind' is distinct from 'submissions' then
      raise exception using errcode = '22023', message = 'SEC structured artifact does not match filing ledger identity';
    end if;
  else
    raise exception using errcode = '22023', message = 'SEC cover result lineage kind is invalid';
  end if;

  v_result_id := (p_result ->> 'id')::uuid;
  if p_source is null then
    if p_result ->> 'source_raw_id' is not null
       or coalesce(p_result ->> 'source_state', '') not in ('missing', 'truncated') then
      raise exception using errcode = '22023', message = 'SEC cover absent source state is invalid';
    end if;
  else
    if not (p_source ?& array[
      'id', 'source_kind', 'source_url', 'source_identity', 'cik', 'fetched_at', 'ingested_at',
      'content_hash', 'source_schema_version', 'raw_content_kind', 'raw_content', 'payload'
    ]::text[]) or (select count(*) from pg_catalog.jsonb_object_keys(p_source)) <> 12 then
      raise exception using errcode = '22023', message = 'SEC cover raw source field set is invalid';
    end if;
    if p_source ->> 'source_kind' <> 'filing_xbrl'
       or p_source ->> 'source_identity' is distinct from p_source ->> 'source_url'
       or p_source ->> 'cik' is distinct from p_result ->> 'issuer_cik'
       or p_source -> 'payload' ->> 'accession' is distinct from p_result ->> 'accession_number'
       or coalesce(p_source -> 'payload' ->> 'role', '') not in ('primary_document', 'inline_xbrl', 'instance_xml')
       or p_source ->> 'content_hash' is distinct from p_result ->> 'source_sha256'
       or p_source ->> 'source_url' is distinct from p_result ->> 'source_url'
       or p_source -> 'payload' ->> 'document_name' is distinct from p_result ->> 'source_document'
       or p_result ->> 'source_state' <> 'available'
       or p_result ->> 'source_raw_id' is distinct from p_source ->> 'id'
       or pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(p_source ->> 'raw_content', 'UTF8'), 'sha256'),
            'hex'
          ) is distinct from p_source ->> 'content_hash' then
      raise exception using errcode = '22023', message = 'SEC cover raw source identity or hash is invalid';
    end if;

    insert into public.sec_structured_raw_sources (
      id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
      content_hash, source_schema_version, raw_content_kind, raw_content, payload
    ) values (
      (p_source ->> 'id')::uuid, p_source ->> 'source_kind', p_source ->> 'source_url',
      p_source ->> 'source_identity', p_source ->> 'cik', (p_source ->> 'fetched_at')::timestamptz,
      (p_source ->> 'ingested_at')::timestamptz, p_source ->> 'content_hash',
      p_source ->> 'source_schema_version', p_source ->> 'raw_content_kind',
      p_source ->> 'raw_content', p_source -> 'payload'
    )
    on conflict (source_kind, source_identity, content_hash) do nothing;

    select * into v_source
    from public.sec_structured_raw_sources
    where source_kind = 'filing_xbrl'
      and source_identity = p_source ->> 'source_identity'
      and content_hash = p_source ->> 'content_hash';
    v_source_id := v_source.id;
    if v_source_id is null
       or v_source_id::text is distinct from p_source ->> 'id'
       or v_source.source_url is distinct from p_source ->> 'source_url'
       or v_source.source_identity is distinct from p_source ->> 'source_identity'
       or v_source.cik is distinct from p_source ->> 'cik'
       or v_source.content_hash is distinct from p_source ->> 'content_hash'
       or v_source.source_schema_version is distinct from p_source ->> 'source_schema_version'
       or v_source.raw_content_kind is distinct from p_source ->> 'raw_content_kind'
       or v_source.raw_content is distinct from p_source ->> 'raw_content'
       or v_source.payload is distinct from p_source -> 'payload' then
      raise exception using errcode = '23505', message = 'SEC cover raw source has a conflicting immutable identity';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    coalesce(p_raw_item_id::text, p_result ->> 'accession_number'), 0
  ));
  select * into v_existing from public.sec_cover_observation_results where id = v_result_id;
  if found then
    if v_existing.raw_item_id is distinct from p_raw_item_id
       or v_existing.lineage_kind is distinct from p_result ->> 'lineage_kind'
       or v_existing.filing_ledger_accession_number is distinct from p_result ->> 'filing_ledger_accession_number'
       or v_existing.filing_ledger_source_raw_id::text is distinct from p_result ->> 'filing_ledger_source_raw_id'
       or v_existing.source_state_hash is distinct from p_result ->> 'source_state_hash'
       or v_existing.source_raw_id::text is distinct from p_result ->> 'source_raw_id'
       or v_existing.payload_sha256 is distinct from p_result ->> 'payload_sha256'
       or v_existing.result_payload is distinct from p_result -> 'result_payload'
       or v_existing.observation_count is distinct from jsonb_array_length(p_observations) then
      raise exception using errcode = '23505', message = 'SEC cover result ID has a conflicting immutable payload';
    end if;
    select count(*) into v_observation_count
    from public.sec_cover_security_observations where result_id = v_result_id;
    if v_observation_count <> jsonb_array_length(p_observations)
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_observations) with ordinality expected(value, position)
         left join public.sec_cover_security_observations stored
           on stored.result_id = v_result_id
          and stored.observation_index = expected.position - 1
         where stored.result_id is null
            or stored.structural_payload is distinct from expected.value -> 'structural_payload'
            or stored.observation_key is distinct from expected.value ->> 'observation_key'
       ) then
      raise exception using errcode = '23505', message = 'SEC cover result has conflicting observation rows';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'result_id', v_result_id, 'observation_count', v_observation_count
    );
  end if;

  if jsonb_array_length(p_observations) <> (p_result ->> 'observation_count')::integer
     or jsonb_array_length(p_observations) > 1000
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_observations) with ordinality expected(value, position)
       where pg_catalog.jsonb_typeof(expected.value) <> 'object'
          or expected.value ->> 'result_id' is distinct from v_result_id::text
          or expected.value ->> 'observation_index' is distinct from (expected.position - 1)::text
          or expected.value ->> 'issuer_cik' is distinct from p_result ->> 'issuer_cik'
     ) then
    raise exception using errcode = '22023', message = 'SEC cover observation identity, order, or count is invalid';
  end if;

  insert into public.sec_cover_observation_results (
    id, lineage_kind, raw_item_id, filing_ledger_accession_number,
    filing_ledger_source_raw_id, filing_ledger_source_kind,
    accession_number, issuer_cik, form_type_raw, filing_date_raw,
    accepted_at_raw, accepted_at, source_parser_version, source_state, source_state_hash,
    source_raw_id, source_url, source_document, source_sha256, extraction_method,
    extraction_version, extraction_status, observation_count, result_payload, payload_sha256
  ) values (
    v_result_id, p_result ->> 'lineage_kind', p_raw_item_id,
    nullif(p_result ->> 'filing_ledger_accession_number', ''),
    nullif(p_result ->> 'filing_ledger_source_raw_id', '')::uuid,
    nullif(p_result ->> 'filing_ledger_source_kind', ''),
    p_result ->> 'accession_number', p_result ->> 'issuer_cik',
    p_result ->> 'form_type_raw', p_result ->> 'filing_date_raw', p_result ->> 'accepted_at_raw',
    nullif(p_result ->> 'accepted_at', '')::timestamptz, p_result ->> 'source_parser_version',
    p_result ->> 'source_state', p_result ->> 'source_state_hash',
    nullif(p_result ->> 'source_raw_id', '')::uuid, p_result ->> 'source_url',
    p_result ->> 'source_document', p_result ->> 'source_sha256', p_result ->> 'extraction_method',
    p_result ->> 'extraction_version', p_result ->> 'extraction_status',
    (p_result ->> 'observation_count')::integer, p_result -> 'result_payload', p_result ->> 'payload_sha256'
  );

  insert into public.sec_cover_security_observations (
    result_id, observation_index, observation_key, issuer_cik_raw, issuer_cik,
    context_ref, context_hash, period_kind, instant_date, start_date, end_date,
    dimensions_payload, security_title_status, security_title_raw,
    trading_symbol_status, trading_symbol_raw, exchange_status, exchange_raw,
    structural_payload
  )
  select
    v_result_id,
    (observation.value ->> 'observation_index')::integer,
    observation.value ->> 'observation_key', observation.value ->> 'issuer_cik_raw',
    observation.value ->> 'issuer_cik', observation.value ->> 'context_ref',
    observation.value ->> 'context_hash', observation.value ->> 'period_kind',
    nullif(observation.value ->> 'instant_date', '')::date,
    nullif(observation.value ->> 'start_date', '')::date,
    nullif(observation.value ->> 'end_date', '')::date,
    observation.value -> 'dimensions_payload', observation.value ->> 'security_title_status',
    observation.value ->> 'security_title_raw', observation.value ->> 'trading_symbol_status',
    observation.value ->> 'trading_symbol_raw', observation.value ->> 'exchange_status',
    observation.value ->> 'exchange_raw', observation.value -> 'structural_payload'
  from pg_catalog.jsonb_array_elements(p_observations) observation(value);

  return pg_catalog.jsonb_build_object(
    'status', 'inserted', 'result_id', v_result_id, 'observation_count', jsonb_array_length(p_observations)
  );
end;
$$;

create or replace function public.record_sec_cover_observation_persistence_state(
  p_raw_item_id uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.jsonb_typeof(p_state), '') <> 'object'
     or coalesce(p_state ->> 'status', '') not in ('available', 'failed') then
    raise exception using errcode = '22023', message = 'SEC cover observation persistence state is invalid';
  end if;
  update public.raw_items
  set metadata = coalesce(metadata, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('sec_cover_observation_persistence', p_state)
  where id = p_raw_item_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEC cover observation raw item does not exist';
  end if;
  return p_state;
end;
$$;

revoke all on function public.reject_sec_cover_observation_mutation() from public, anon, authenticated, service_role;
revoke all on function public.persist_sec_cover_observation_result(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_sec_cover_observation_result(uuid, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.record_sec_cover_observation_persistence_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_sec_cover_observation_persistence_state(uuid, jsonb) to service_role;

comment on table public.sec_cover_observation_results is
  'Append-only SEC filing cover extraction revisions. Each revision preserves exact source/parser provenance and remains an observation, never a canonical or current ticker projection.';
comment on table public.sec_cover_security_observations is
  'One source-linked security observation per exact XBRL context. Title, trading symbol, and exchange are never joined across contexts or promoted to current security identity.';
comment on function public.persist_sec_cover_observation_result(uuid, jsonb, jsonb, jsonb) is
  'Service-only atomic insert-or-replay for immutable SEC cover observation revisions and exact filing source preservation.';
