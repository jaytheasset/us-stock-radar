create table public.sec_sc13_filings (
  accession_number text primary key,
  raw_item_id uuid not null unique references public.raw_items(id) on delete restrict,
  form_type_raw text not null,
  previous_accession_number_raw text,
  amendment_number_raw text,
  amendment_number smallint,
  event_date_raw text not null,
  event_date date not null,
  filed_at_raw text,
  filed_at timestamptz,
  header_filer_cik_raw text not null,
  header_filer_cik text not null,
  issuer_cik_raw text not null,
  issuer_cik text not null,
  issuer_name_raw text not null,
  security_class_raw text not null,
  cusips_raw jsonb not null,
  source_url text not null,
  source_sha256 text not null,
  raw_xml text not null,
  raw_xml_char_count integer not null,
  raw_xml_utf8_byte_count integer not null,
  parser_version text not null,
  xsd_package_version text not null,
  namespace text not null,
  schema_version_raw text not null,
  archive_directory_cik_raw text not null,
  archive_directory_role text not null,
  index_subject_cik_raw text not null,
  index_filed_by_ciks_raw jsonb not null,
  index_canonical_xml_url text not null,
  provenance_payload jsonb not null,
  structural_payload jsonb not null,
  payload_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint sec_sc13_filings_accession_check
    check (accession_number ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint sec_sc13_filings_previous_accession_check
    check (previous_accession_number_raw is null or previous_accession_number_raw ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint sec_sc13_filings_amendment_number_check
    check (
      (amendment_number_raw is null and amendment_number is null)
      or (amendment_number_raw ~ '^\d{1,3}$' and amendment_number = amendment_number_raw::smallint)
    ),
  constraint sec_sc13_filings_filed_at_check
    check (
      (filed_at_raw is null and filed_at is null)
      or (filed_at_raw is not null and filed_at = filed_at_raw::timestamptz)
    ),
  constraint sec_sc13_filings_cik_check
    check (
      header_filer_cik_raw ~ '^\d{1,10}$'
      and header_filer_cik ~ '^\d{10}$'
      and issuer_cik_raw ~ '^\d{1,10}$'
      and issuer_cik ~ '^\d{10}$'
      and archive_directory_cik_raw ~ '^\d{1,10}$'
      and index_subject_cik_raw ~ '^\d{1,10}$'
    ),
  constraint sec_sc13_filings_form_check
    check (upper(form_type_raw) in ('SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A')),
  constraint sec_sc13_filings_cusips_check check (jsonb_typeof(cusips_raw) = 'array' and jsonb_array_length(cusips_raw) > 0),
  constraint sec_sc13_filings_index_filers_check check (jsonb_typeof(index_filed_by_ciks_raw) = 'array' and jsonb_array_length(index_filed_by_ciks_raw) > 0),
  constraint sec_sc13_filings_payload_check check (jsonb_typeof(provenance_payload) = 'object' and jsonb_typeof(structural_payload) = 'object'),
  constraint sec_sc13_filings_source_check check (
    source_url ~ '^https://(www\.)?sec\.gov/Archives/edgar/data/'
    and source_sha256 ~ '^[0-9a-f]{64}$'
    and payload_sha256 ~ '^[0-9a-f]{64}$'
    and raw_xml_char_count > 0
    and raw_xml_utf8_byte_count = octet_length(raw_xml)
    and raw_xml_utf8_byte_count > 0
  ),
  constraint sec_sc13_filings_parser_check check (
    parser_version = 'sc13-structural-xml-v1'
    and xsd_package_version = '2.3'
    and schema_version_raw = 'X0202'
    and namespace in ('http://www.sec.gov/edgar/schedule13D', 'http://www.sec.gov/edgar/schedule13g')
  ),
  constraint sec_sc13_filings_archive_role_check check (archive_directory_role in ('issuer', 'header_filer', 'reporting_person', 'multiple'))
);

create table public.sec_sc13_reporting_persons (
  accession_number text not null references public.sec_sc13_filings(accession_number) on delete cascade,
  reporting_person_index smallint not null,
  reporting_person_cik_raw text,
  reporting_person_cik text,
  reporting_person_cik_missing_flag_raw text,
  reporting_person_name_raw text not null,
  member_of_group_raw text,
  fund_types_raw jsonb not null,
  citizenship_or_organization_raw text,
  sole_voting_power_raw text,
  sole_voting_power numeric,
  shared_voting_power_raw text,
  shared_voting_power numeric,
  sole_dispositive_power_raw text,
  sole_dispositive_power numeric,
  shared_dispositive_power_raw text,
  shared_dispositive_power numeric,
  aggregate_amount_owned_raw text,
  aggregate_amount_owned numeric,
  aggregate_excludes_certain_shares_flag_raw text,
  aggregate_excludes_certain_shares boolean,
  percent_of_class_raw text,
  percent_of_class numeric,
  types_of_reporting_person_raw jsonb not null,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, reporting_person_index),
  constraint sec_sc13_reporting_persons_index_check check (reporting_person_index between 0 and 99),
  constraint sec_sc13_reporting_persons_cik_check check (
    (reporting_person_cik_raw is null and reporting_person_cik is null)
    or (reporting_person_cik_raw ~ '^\d{1,10}$' and reporting_person_cik ~ '^\d{10}$')
  ),
  constraint sec_sc13_reporting_persons_name_check check (btrim(reporting_person_name_raw) <> ''),
  constraint sec_sc13_reporting_persons_arrays_check check (
    jsonb_typeof(fund_types_raw) = 'array'
    and jsonb_typeof(types_of_reporting_person_raw) = 'array'
    and jsonb_typeof(structural_payload) = 'object'
  ),
  constraint sec_sc13_reporting_persons_numeric_check check (
    (sole_voting_power_raw is null or sole_voting_power_raw ~ '^\d+(\.\d{1,2})?$')
    and (shared_voting_power_raw is null or shared_voting_power_raw ~ '^\d+(\.\d{1,2})?$')
    and (sole_dispositive_power_raw is null or sole_dispositive_power_raw ~ '^\d+(\.\d{1,2})?$')
    and (shared_dispositive_power_raw is null or shared_dispositive_power_raw ~ '^\d+(\.\d{1,2})?$')
    and (aggregate_amount_owned_raw is null or aggregate_amount_owned_raw ~ '^\d+(\.\d{1,2})?$')
    and (percent_of_class_raw is null or percent_of_class_raw ~ '^\d+(\.\d{1,2})?$')
    and ((sole_voting_power_raw is null and sole_voting_power is null) or sole_voting_power = sole_voting_power_raw::numeric)
    and ((shared_voting_power_raw is null and shared_voting_power is null) or shared_voting_power = shared_voting_power_raw::numeric)
    and ((sole_dispositive_power_raw is null and sole_dispositive_power is null) or sole_dispositive_power = sole_dispositive_power_raw::numeric)
    and ((shared_dispositive_power_raw is null and shared_dispositive_power is null) or shared_dispositive_power = shared_dispositive_power_raw::numeric)
    and ((aggregate_amount_owned_raw is null and aggregate_amount_owned is null) or aggregate_amount_owned = aggregate_amount_owned_raw::numeric)
    and ((percent_of_class_raw is null and percent_of_class is null) or percent_of_class = percent_of_class_raw::numeric)
    and (percent_of_class is null or percent_of_class between 0 and 100)
  )
);

create index sec_sc13_filings_issuer_history_idx
  on public.sec_sc13_filings (issuer_cik, filed_at desc, event_date desc, accession_number desc);

create index sec_sc13_reporting_persons_cik_idx
  on public.sec_sc13_reporting_persons (reporting_person_cik, accession_number);

alter table public.sec_sc13_filings enable row level security;
alter table public.sec_sc13_reporting_persons enable row level security;

revoke all on table public.sec_sc13_filings from public, anon, authenticated, service_role;
revoke all on table public.sec_sc13_reporting_persons from public, anon, authenticated, service_role;
grant select, insert on table public.sec_sc13_filings to service_role;
grant select, insert on table public.sec_sc13_reporting_persons to service_role;

create or replace function public.persist_sec_sc13_filing(
  p_raw_item_id uuid,
  p_filing jsonb,
  p_reporters jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_accession text;
  v_existing public.sec_sc13_filings%rowtype;
  v_reporter_count integer;
begin
  if coalesce(jsonb_typeof(p_filing), '') <> 'object' then
    raise exception using errcode = '22023', message = 'SC13 filing payload must be an object';
  end if;
  if coalesce(jsonb_typeof(p_reporters), '') <> 'array' then
    raise exception using errcode = '22023', message = 'SC13 reporter payload must be an array';
  end if;
  if not (p_filing ?& array[
    'accession_number', 'raw_item_id', 'form_type_raw', 'previous_accession_number_raw',
    'amendment_number_raw', 'event_date_raw', 'event_date', 'filed_at_raw', 'filed_at',
    'header_filer_cik_raw', 'header_filer_cik', 'issuer_cik_raw', 'issuer_cik',
    'issuer_name_raw', 'security_class_raw', 'cusips_raw', 'source_url', 'source_sha256',
    'raw_xml', 'raw_xml_char_count', 'raw_xml_utf8_byte_count', 'parser_version',
    'xsd_package_version', 'namespace', 'schema_version_raw', 'archive_directory_cik_raw',
    'archive_directory_role', 'index_subject_cik_raw', 'index_filed_by_ciks_raw',
    'index_canonical_xml_url', 'provenance_payload', 'structural_payload', 'payload_sha256'
  ]::text[]) or (select count(*) from pg_catalog.jsonb_object_keys(p_filing)) <> 33 then
    raise exception using errcode = '22023', message = 'SC13 filing payload field set is invalid';
  end if;
  if p_filing ->> 'raw_item_id' is distinct from p_raw_item_id::text then
    raise exception using errcode = '22023', message = 'SC13 raw item identity is invalid';
  end if;

  v_accession := p_filing ->> 'accession_number';
  if v_accession is null or v_accession !~ '^\d{10}-\d{2}-\d{6}$' then
    raise exception using errcode = '22023', message = 'SC13 accession number is invalid';
  end if;
  if jsonb_array_length(p_reporters) < 1 or jsonb_array_length(p_reporters) > 100 then
    raise exception using errcode = '22023', message = 'SC13 reporter count is outside 1..100';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_reporters) as reporter(value)
    where jsonb_typeof(reporter.value) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'SC13 reporter payload must contain only objects';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_reporters) with ordinality as reporter(value, position)
    where not (reporter.value ?& array[
         'accession_number', 'reporting_person_index', 'reporting_person_cik_raw',
         'reporting_person_cik', 'reporting_person_cik_missing_flag_raw',
         'reporting_person_name_raw', 'member_of_group_raw', 'fund_types_raw',
         'citizenship_or_organization_raw', 'sole_voting_power_raw', 'shared_voting_power_raw',
         'sole_dispositive_power_raw', 'shared_dispositive_power_raw', 'aggregate_amount_owned_raw',
         'aggregate_excludes_certain_shares_flag_raw', 'percent_of_class_raw',
         'types_of_reporting_person_raw', 'structural_payload'
       ]::text[])
       or (select count(*) from pg_catalog.jsonb_object_keys(reporter.value)) <> 18
       or reporter.value ->> 'accession_number' is distinct from v_accession
       or reporter.value ->> 'reporting_person_index' is distinct from (reporter.position - 1)::text
  ) then
    raise exception using errcode = '22023', message = 'SC13 reporter identity or order is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_accession, 0));
  select * into v_existing
  from public.sec_sc13_filings
  where accession_number = v_accession
  ;

  if found then
    if v_existing.raw_item_id is distinct from p_raw_item_id
       or v_existing.source_sha256 is distinct from p_filing ->> 'source_sha256'
       or v_existing.payload_sha256 is distinct from p_filing ->> 'payload_sha256'
       or v_existing.raw_xml is distinct from p_filing ->> 'raw_xml'
       or v_existing.structural_payload is distinct from p_filing -> 'structural_payload'
       or v_existing.provenance_payload is distinct from p_filing -> 'provenance_payload' then
      raise exception using errcode = '23505', message = 'SC13 accession already has a conflicting canonical payload';
    end if;

    select count(*) into v_reporter_count
    from public.sec_sc13_reporting_persons
    where accession_number = v_accession;
    if v_reporter_count <> jsonb_array_length(p_reporters)
       or exists (
         select 1
         from jsonb_array_elements(p_reporters) with ordinality as expected(value, position)
         left join public.sec_sc13_reporting_persons stored
           on stored.accession_number = v_accession
          and stored.reporting_person_index = expected.position - 1
         where stored.accession_number is null
            or stored.structural_payload is distinct from expected.value -> 'structural_payload'
       ) then
      raise exception using errcode = '23505', message = 'SC13 accession already has conflicting reporter rows';
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'filing_count', 1,
      'reporter_count', v_reporter_count
    );
  end if;

  insert into public.sec_sc13_filings (
    accession_number, raw_item_id, form_type_raw, previous_accession_number_raw,
    amendment_number_raw, amendment_number, event_date_raw, event_date, filed_at_raw, filed_at,
    header_filer_cik_raw, header_filer_cik, issuer_cik_raw, issuer_cik,
    issuer_name_raw, security_class_raw, cusips_raw, source_url, source_sha256,
    raw_xml, raw_xml_char_count, raw_xml_utf8_byte_count, parser_version, xsd_package_version, namespace,
    schema_version_raw, archive_directory_cik_raw, archive_directory_role,
    index_subject_cik_raw, index_filed_by_ciks_raw, index_canonical_xml_url,
    provenance_payload, structural_payload, payload_sha256
  ) values (
    v_accession, p_raw_item_id, p_filing ->> 'form_type_raw', p_filing ->> 'previous_accession_number_raw',
    p_filing ->> 'amendment_number_raw', nullif(p_filing ->> 'amendment_number_raw', '')::smallint,
    p_filing ->> 'event_date_raw', (p_filing ->> 'event_date')::date,
    p_filing ->> 'filed_at_raw',
    nullif(p_filing ->> 'filed_at', '')::timestamptz,
    p_filing ->> 'header_filer_cik_raw', p_filing ->> 'header_filer_cik',
    p_filing ->> 'issuer_cik_raw', p_filing ->> 'issuer_cik',
    p_filing ->> 'issuer_name_raw', p_filing ->> 'security_class_raw',
    p_filing -> 'cusips_raw', p_filing ->> 'source_url', p_filing ->> 'source_sha256',
    p_filing ->> 'raw_xml', (p_filing ->> 'raw_xml_char_count')::integer,
    (p_filing ->> 'raw_xml_utf8_byte_count')::integer,
    p_filing ->> 'parser_version', p_filing ->> 'xsd_package_version',
    p_filing ->> 'namespace', p_filing ->> 'schema_version_raw',
    p_filing ->> 'archive_directory_cik_raw', p_filing ->> 'archive_directory_role',
    p_filing ->> 'index_subject_cik_raw', p_filing -> 'index_filed_by_ciks_raw',
    p_filing ->> 'index_canonical_xml_url', p_filing -> 'provenance_payload',
    p_filing -> 'structural_payload', p_filing ->> 'payload_sha256'
  );

  insert into public.sec_sc13_reporting_persons (
    accession_number, reporting_person_index, reporting_person_cik_raw,
    reporting_person_cik, reporting_person_cik_missing_flag_raw,
    reporting_person_name_raw, member_of_group_raw, fund_types_raw,
    citizenship_or_organization_raw, sole_voting_power_raw, sole_voting_power,
    shared_voting_power_raw, shared_voting_power, sole_dispositive_power_raw,
    sole_dispositive_power, shared_dispositive_power_raw, shared_dispositive_power,
    aggregate_amount_owned_raw, aggregate_amount_owned,
    aggregate_excludes_certain_shares_flag_raw, aggregate_excludes_certain_shares,
    percent_of_class_raw, percent_of_class, types_of_reporting_person_raw,
    structural_payload
  )
  select
    v_accession,
    (reporter.value ->> 'reporting_person_index')::smallint,
    reporter.value ->> 'reporting_person_cik_raw',
    reporter.value ->> 'reporting_person_cik',
    reporter.value ->> 'reporting_person_cik_missing_flag_raw',
    reporter.value ->> 'reporting_person_name_raw',
    reporter.value ->> 'member_of_group_raw',
    reporter.value -> 'fund_types_raw',
    reporter.value ->> 'citizenship_or_organization_raw',
    reporter.value ->> 'sole_voting_power_raw', nullif(reporter.value ->> 'sole_voting_power_raw', '')::numeric,
    reporter.value ->> 'shared_voting_power_raw', nullif(reporter.value ->> 'shared_voting_power_raw', '')::numeric,
    reporter.value ->> 'sole_dispositive_power_raw', nullif(reporter.value ->> 'sole_dispositive_power_raw', '')::numeric,
    reporter.value ->> 'shared_dispositive_power_raw', nullif(reporter.value ->> 'shared_dispositive_power_raw', '')::numeric,
    reporter.value ->> 'aggregate_amount_owned_raw', nullif(reporter.value ->> 'aggregate_amount_owned_raw', '')::numeric,
    reporter.value ->> 'aggregate_excludes_certain_shares_flag_raw',
    case reporter.value ->> 'aggregate_excludes_certain_shares_flag_raw'
      when 'Y' then true when 'N' then false else null
    end,
    reporter.value ->> 'percent_of_class_raw', nullif(reporter.value ->> 'percent_of_class_raw', '')::numeric,
    reporter.value -> 'types_of_reporting_person_raw',
    reporter.value -> 'structural_payload'
  from jsonb_array_elements(p_reporters) as reporter(value);

  return jsonb_build_object(
    'status', 'inserted',
    'filing_count', 1,
    'reporter_count', jsonb_array_length(p_reporters)
  );
end;
$$;

create or replace function public.record_sec_sc13_persistence_state(
  p_raw_item_id uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(jsonb_typeof(p_state), '') <> 'object'
     or coalesce(p_state ->> 'status', '') not in ('available', 'failed') then
    raise exception using errcode = '22023', message = 'SC13 persistence state is invalid';
  end if;

  update public.raw_items
  set metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object('sc13_xml_persistence', p_state)
  where id = p_raw_item_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'SC13 raw item does not exist';
  end if;

  return p_state;
end;
$$;

revoke all on function public.persist_sec_sc13_filing(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_sec_sc13_filing(uuid, jsonb, jsonb) to service_role;
revoke all on function public.record_sec_sc13_persistence_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_sec_sc13_persistence_state(uuid, jsonb) to service_role;

comment on table public.sec_sc13_filings is
  'One immutable filing row per verified SEC Schedule 13D/G XML accession. Issuer and header filer identities remain separate; raw XML and exact structural parser payload are preserved independently of site analysis.';

comment on table public.sec_sc13_reporting_persons is
  'One immutable row per Schedule 13 reporting person in SEC XML order. Rows are never summed across joint reporters; raw decimal strings preserve zero versus missing values.';

comment on function public.persist_sec_sc13_filing(uuid, jsonb, jsonb) is
  'Service-only atomic insert-or-verify for canonical Schedule 13 XML. Exact replay is a no-op; conflicting accession payloads fail without changing stored values.';

comment on function public.record_sec_sc13_persistence_state(uuid, jsonb) is
  'Service-only atomic JSON metadata merge for the independent Schedule 13 XML persistence state. Other raw-item metadata, including analysis state, is preserved.';
