-- Canonical, immutable storage for verified SEC Forms 3/3-A/5/5-A XML.
-- This path is independent of site analysis. Holdings and transactions remain
-- separate, and all parser fields preserve exact raw values and footnote IDs.

create table public.sec_section16_filings (
  accession_number text primary key,
  raw_item_id uuid not null unique references public.raw_items(id) on delete restrict,
  form_type_raw text not null,
  is_amendment boolean not null,
  issuer_cik_raw text not null,
  issuer_cik text not null,
  issuer_name_raw text,
  trading_symbol_raw text,
  foreign_trading_symbol_raw text,
  filing_date_raw text,
  accepted_at_raw text,
  period_of_report_raw text,
  date_of_original_submission_raw text,
  source_url text not null,
  source_sha256 text not null,
  raw_xml text not null,
  raw_xml_char_count integer not null,
  raw_xml_utf8_byte_count integer not null,
  parser_version text not null,
  parser_mode text not null,
  source_payload jsonb not null,
  filing_payload jsonb not null,
  issuer_payload jsonb not null,
  parser_payload jsonb not null,
  payload_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint sec_section16_filings_accession_check check (accession_number ~ '^\d{10}-\d{2}-\d{6}$'),
  constraint sec_section16_filings_form_check check (
    form_type_raw in ('3', '3/A', '5', '5/A')
    and is_amendment = (form_type_raw in ('3/A', '5/A'))
  ),
  constraint sec_section16_filings_cik_check check (
    issuer_cik_raw ~ '^\d{1,10}$' and issuer_cik ~ '^\d{10}$'
  ),
  constraint sec_section16_filings_source_check check (
    source_url ~ '^https://(www\.)?sec\.gov/Archives/edgar/data/'
    and source_sha256 ~ '^[0-9a-f]{64}$'
    and payload_sha256 ~ '^[0-9a-f]{64}$'
    and raw_xml_char_count > 0
    and raw_xml_utf8_byte_count = octet_length(raw_xml)
    and raw_xml_utf8_byte_count > 0
  ),
  constraint sec_section16_filings_parser_check check (
    parser_version = 'section16-xml-parser-v1' and parser_mode = 'xml_only_no_llm'
  ),
  constraint sec_section16_filings_payload_check check (
    jsonb_typeof(source_payload) = 'object'
    and jsonb_typeof(filing_payload) = 'object'
    and jsonb_typeof(issuer_payload) = 'object'
    and jsonb_typeof(parser_payload) = 'object'
  )
);

create table public.sec_section16_reporting_owners (
  accession_number text not null references public.sec_section16_filings(accession_number) on delete cascade,
  reporting_owner_index smallint not null,
  reporting_owner_cik_raw text,
  reporting_owner_cik text,
  reporting_owner_name_raw text,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, reporting_owner_index),
  constraint sec_section16_reporting_owners_index_check check (reporting_owner_index between 0 and 99),
  constraint sec_section16_reporting_owners_cik_check check (
    (reporting_owner_cik_raw is null and reporting_owner_cik is null)
    or (reporting_owner_cik_raw ~ '^\d{1,10}$' and reporting_owner_cik ~ '^\d{10}$')
  ),
  constraint sec_section16_reporting_owners_payload_check check (jsonb_typeof(structural_payload) = 'object')
);

create table public.sec_section16_transactions (
  accession_number text not null references public.sec_section16_filings(accession_number) on delete cascade,
  row_ordinal smallint not null,
  row_kind text not null,
  row_index smallint not null,
  xml_path text not null,
  security_title_raw text,
  transaction_form_type_raw text,
  transaction_code_raw text,
  transaction_timeliness_raw text,
  transaction_date_raw text,
  deemed_execution_date_raw text,
  shares_raw text,
  transaction_total_value_raw text,
  price_per_share_raw text,
  acquired_disposed_code_raw text,
  post_transaction_shares_raw text,
  post_transaction_value_raw text,
  direct_or_indirect_ownership_raw text,
  nature_of_ownership_raw text,
  conversion_or_exercise_price_raw text,
  exercise_date_raw text,
  expiration_date_raw text,
  underlying_security_title_raw text,
  underlying_security_shares_raw text,
  underlying_security_value_raw text,
  footnote_ids jsonb not null,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, row_ordinal),
  unique (accession_number, row_kind, row_index),
  constraint sec_section16_transactions_order_check check (row_ordinal between 0 and 999 and row_index between 0 and 999),
  constraint sec_section16_transactions_kind_check check (row_kind in ('non_derivative', 'derivative')),
  constraint sec_section16_transactions_payload_check check (
    jsonb_typeof(footnote_ids) = 'array' and jsonb_typeof(structural_payload) = 'object'
  )
);

create table public.sec_section16_holdings (
  accession_number text not null references public.sec_section16_filings(accession_number) on delete cascade,
  row_ordinal smallint not null,
  row_kind text not null,
  row_index smallint not null,
  xml_path text not null,
  security_title_raw text,
  transaction_form_type_raw text,
  amount_owned_raw text,
  value_owned_raw text,
  direct_or_indirect_ownership_raw text,
  nature_of_ownership_raw text,
  conversion_or_exercise_price_raw text,
  exercise_date_raw text,
  expiration_date_raw text,
  underlying_security_title_raw text,
  underlying_security_shares_raw text,
  underlying_security_value_raw text,
  footnote_ids jsonb not null,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, row_ordinal),
  unique (accession_number, row_kind, row_index),
  constraint sec_section16_holdings_order_check check (row_ordinal between 0 and 999 and row_index between 0 and 999),
  constraint sec_section16_holdings_kind_check check (row_kind in ('non_derivative', 'derivative')),
  constraint sec_section16_holdings_payload_check check (
    jsonb_typeof(footnote_ids) = 'array' and jsonb_typeof(structural_payload) = 'object'
  )
);

create table public.sec_section16_footnotes (
  accession_number text not null references public.sec_section16_filings(accession_number) on delete cascade,
  footnote_index smallint not null,
  footnote_id text not null,
  text_value text not null,
  raw_text text not null,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, footnote_index),
  unique (accession_number, footnote_id),
  constraint sec_section16_footnotes_index_check check (footnote_index between 0 and 999),
  constraint sec_section16_footnotes_id_check check (btrim(footnote_id) <> ''),
  constraint sec_section16_footnotes_payload_check check (jsonb_typeof(structural_payload) = 'object')
);

create table public.sec_section16_signatures (
  accession_number text not null references public.sec_section16_filings(accession_number) on delete cascade,
  signature_index smallint not null,
  signature_name_raw text,
  signature_date_raw text,
  structural_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (accession_number, signature_index),
  constraint sec_section16_signatures_index_check check (signature_index between 0 and 99),
  constraint sec_section16_signatures_payload_check check (jsonb_typeof(structural_payload) = 'object')
);

create index sec_section16_filings_issuer_history_idx
  on public.sec_section16_filings (issuer_cik, accepted_at_raw desc, filing_date_raw desc, accession_number desc);
create index sec_section16_reporting_owners_cik_idx
  on public.sec_section16_reporting_owners (reporting_owner_cik, accession_number);

alter table public.sec_section16_filings enable row level security;
alter table public.sec_section16_reporting_owners enable row level security;
alter table public.sec_section16_transactions enable row level security;
alter table public.sec_section16_holdings enable row level security;
alter table public.sec_section16_footnotes enable row level security;
alter table public.sec_section16_signatures enable row level security;

revoke all on table public.sec_section16_filings from public, anon, authenticated, service_role;
revoke all on table public.sec_section16_reporting_owners from public, anon, authenticated, service_role;
revoke all on table public.sec_section16_transactions from public, anon, authenticated, service_role;
revoke all on table public.sec_section16_holdings from public, anon, authenticated, service_role;
revoke all on table public.sec_section16_footnotes from public, anon, authenticated, service_role;
revoke all on table public.sec_section16_signatures from public, anon, authenticated, service_role;
grant select, insert on table public.sec_section16_filings to service_role;
grant select, insert on table public.sec_section16_reporting_owners to service_role;
grant select, insert on table public.sec_section16_transactions to service_role;
grant select, insert on table public.sec_section16_holdings to service_role;
grant select, insert on table public.sec_section16_footnotes to service_role;
grant select, insert on table public.sec_section16_signatures to service_role;

create or replace function public.persist_sec_section16_filing(
  p_raw_item_id uuid,
  p_filing jsonb,
  p_reporting_owners jsonb,
  p_transactions jsonb,
  p_holdings jsonb,
  p_footnotes jsonb,
  p_signatures jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_accession text;
  v_raw public.raw_items%rowtype;
  v_existing public.sec_section16_filings%rowtype;
  v_source_sha256 text;
  v_counts integer[];
begin
  if coalesce(pg_catalog.jsonb_typeof(p_filing), '') <> 'object'
     or coalesce(pg_catalog.jsonb_typeof(p_reporting_owners), '') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_transactions), '') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_holdings), '') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_footnotes), '') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_signatures), '') <> 'array' then
    raise exception using errcode = '22023', message = 'Section 16 canonical payload types are invalid';
  end if;
  if not (p_filing ?& array[
    'accession_number', 'raw_item_id', 'form_type_raw', 'is_amendment',
    'issuer_cik_raw', 'issuer_cik', 'issuer_name_raw', 'trading_symbol_raw',
    'foreign_trading_symbol_raw', 'filing_date_raw', 'accepted_at_raw',
    'period_of_report_raw', 'date_of_original_submission_raw', 'source_url',
    'source_sha256', 'raw_xml', 'raw_xml_char_count', 'raw_xml_utf8_byte_count',
    'parser_version', 'parser_mode', 'source_payload', 'filing_payload',
    'issuer_payload', 'parser_payload', 'payload_sha256'
  ]::text[]) or (select count(*) from pg_catalog.jsonb_object_keys(p_filing)) <> 25 then
    raise exception using errcode = '22023', message = 'Section 16 filing field set is invalid';
  end if;

  v_accession := p_filing ->> 'accession_number';
  if v_accession is null or v_accession !~ '^\d{10}-\d{2}-\d{6}$'
     or p_filing ->> 'raw_item_id' is distinct from p_raw_item_id::text then
    raise exception using errcode = '22023', message = 'Section 16 filing identity is invalid';
  end if;
  if pg_catalog.jsonb_array_length(p_reporting_owners) > 100
     or pg_catalog.jsonb_array_length(p_transactions) > 1000
     or pg_catalog.jsonb_array_length(p_holdings) > 1000
     or pg_catalog.jsonb_array_length(p_footnotes) > 1000
     or pg_catalog.jsonb_array_length(p_signatures) > 100 then
    raise exception using errcode = '22023', message = 'Section 16 child row count is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_accession, 0));
  select * into v_raw from public.raw_items where id = p_raw_item_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Section 16 raw item does not exist';
  end if;

  v_source_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_filing ->> 'raw_xml', 'UTF8'), 'sha256'),
    'hex'
  );
  if v_raw.source_code is distinct from 'sec_edgar'
     or v_raw.source_group::text is distinct from 'filings'
     or v_raw.source_unique_id is distinct from v_accession
     or v_raw.raw_payload ->> 'accession_number' is distinct from v_accession
     or pg_catalog.upper(pg_catalog.regexp_replace(v_raw.raw_payload ->> 'form_type', '\s+', '', 'g'))
          is distinct from p_filing ->> 'form_type_raw'
     or pg_catalog.lpad(pg_catalog.btrim(v_raw.raw_payload ->> 'ownership_issuer_cik'), 10, '0')
          is distinct from p_filing ->> 'issuer_cik'
     or v_raw.raw_payload ->> 'ownership_source_url' is distinct from p_filing ->> 'source_url'
     or v_raw.raw_payload ->> 'ownership_source_format' is distinct from 'ownership_xml'
     or v_raw.raw_payload ->> 'ownership_source_text' is distinct from p_filing ->> 'raw_xml'
     or (v_raw.raw_payload ->> 'ownership_source_text_char_count')::integer
          is distinct from (p_filing ->> 'raw_xml_char_count')::integer
     or coalesce((v_raw.raw_payload ->> 'ownership_source_text_truncated')::boolean, false)
     or v_source_sha256 is distinct from p_filing ->> 'source_sha256'
     or (
       nullif(v_raw.raw_payload ->> 'ownership_source_sha256', '') is not null
       and pg_catalog.lower(v_raw.raw_payload ->> 'ownership_source_sha256') is distinct from v_source_sha256
     ) then
    raise exception using errcode = '22023', message = 'Section 16 payload does not match the stored SEC raw source';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_reporting_owners) with ordinality as item(value, position)
    where item.value ->> 'accession_number' is distinct from v_accession
       or item.value ->> 'reporting_owner_index' is distinct from (position - 1)::text
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_transactions) with ordinality as item(value, position)
    where item.value ->> 'accession_number' is distinct from v_accession
       or item.value ->> 'row_ordinal' is distinct from (position - 1)::text
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_holdings) with ordinality as item(value, position)
    where item.value ->> 'accession_number' is distinct from v_accession
       or item.value ->> 'row_ordinal' is distinct from (position - 1)::text
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_footnotes) with ordinality as item(value, position)
    where item.value ->> 'accession_number' is distinct from v_accession
       or item.value ->> 'footnote_index' is distinct from (position - 1)::text
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_signatures) with ordinality as item(value, position)
    where item.value ->> 'accession_number' is distinct from v_accession
       or item.value ->> 'signature_index' is distinct from (position - 1)::text
  ) then
    raise exception using errcode = '22023', message = 'Section 16 child identity or order is invalid';
  end if;

  select * into v_existing from public.sec_section16_filings where accession_number = v_accession;
  if found then
    if v_existing.raw_item_id is distinct from p_raw_item_id
       or v_existing.source_sha256 is distinct from p_filing ->> 'source_sha256'
       or v_existing.payload_sha256 is distinct from p_filing ->> 'payload_sha256'
       or v_existing.raw_xml is distinct from p_filing ->> 'raw_xml'
       or v_existing.parser_payload is distinct from p_filing -> 'parser_payload' then
      raise exception using errcode = '23505', message = 'Section 16 accession already has a conflicting canonical payload';
    end if;

    select array[
      (select count(*)::integer from public.sec_section16_reporting_owners where accession_number = v_accession),
      (select count(*)::integer from public.sec_section16_transactions where accession_number = v_accession),
      (select count(*)::integer from public.sec_section16_holdings where accession_number = v_accession),
      (select count(*)::integer from public.sec_section16_footnotes where accession_number = v_accession),
      (select count(*)::integer from public.sec_section16_signatures where accession_number = v_accession)
    ] into v_counts;
    if v_counts is distinct from array[
      pg_catalog.jsonb_array_length(p_reporting_owners), pg_catalog.jsonb_array_length(p_transactions),
      pg_catalog.jsonb_array_length(p_holdings), pg_catalog.jsonb_array_length(p_footnotes),
      pg_catalog.jsonb_array_length(p_signatures)
    ] or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_reporting_owners) with ordinality item(value, position)
      left join public.sec_section16_reporting_owners stored on stored.accession_number = v_accession and stored.reporting_owner_index = position - 1
      where stored.structural_payload is distinct from item.value -> 'structural_payload'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_transactions) with ordinality item(value, position)
      left join public.sec_section16_transactions stored on stored.accession_number = v_accession and stored.row_ordinal = position - 1
      where stored.structural_payload is distinct from item.value -> 'structural_payload'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_holdings) with ordinality item(value, position)
      left join public.sec_section16_holdings stored on stored.accession_number = v_accession and stored.row_ordinal = position - 1
      where stored.structural_payload is distinct from item.value -> 'structural_payload'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_footnotes) with ordinality item(value, position)
      left join public.sec_section16_footnotes stored on stored.accession_number = v_accession and stored.footnote_index = position - 1
      where stored.structural_payload is distinct from item.value -> 'structural_payload'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_signatures) with ordinality item(value, position)
      left join public.sec_section16_signatures stored on stored.accession_number = v_accession and stored.signature_index = position - 1
      where stored.structural_payload is distinct from item.value -> 'structural_payload'
    ) then
      raise exception using errcode = '23505', message = 'Section 16 accession already has conflicting child rows';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'filing_count', 1,
      'reporting_owner_count', v_counts[1], 'transaction_count', v_counts[2],
      'holding_count', v_counts[3], 'footnote_count', v_counts[4], 'signature_count', v_counts[5]
    );
  end if;

  insert into public.sec_section16_filings (
    accession_number, raw_item_id, form_type_raw, is_amendment, issuer_cik_raw, issuer_cik,
    issuer_name_raw, trading_symbol_raw, foreign_trading_symbol_raw, filing_date_raw,
    accepted_at_raw, period_of_report_raw, date_of_original_submission_raw, source_url,
    source_sha256, raw_xml, raw_xml_char_count, raw_xml_utf8_byte_count, parser_version,
    parser_mode, source_payload, filing_payload, issuer_payload, parser_payload, payload_sha256
  ) values (
    v_accession, p_raw_item_id, p_filing ->> 'form_type_raw', (p_filing ->> 'is_amendment')::boolean,
    p_filing ->> 'issuer_cik_raw', p_filing ->> 'issuer_cik', p_filing ->> 'issuer_name_raw',
    p_filing ->> 'trading_symbol_raw', p_filing ->> 'foreign_trading_symbol_raw',
    p_filing ->> 'filing_date_raw', p_filing ->> 'accepted_at_raw', p_filing ->> 'period_of_report_raw',
    p_filing ->> 'date_of_original_submission_raw', p_filing ->> 'source_url', p_filing ->> 'source_sha256',
    p_filing ->> 'raw_xml', (p_filing ->> 'raw_xml_char_count')::integer,
    (p_filing ->> 'raw_xml_utf8_byte_count')::integer, p_filing ->> 'parser_version',
    p_filing ->> 'parser_mode', p_filing -> 'source_payload', p_filing -> 'filing_payload',
    p_filing -> 'issuer_payload', p_filing -> 'parser_payload', p_filing ->> 'payload_sha256'
  );

  insert into public.sec_section16_reporting_owners (
    accession_number, reporting_owner_index, reporting_owner_cik_raw, reporting_owner_cik,
    reporting_owner_name_raw, structural_payload
  ) select accession_number, reporting_owner_index, reporting_owner_cik_raw, reporting_owner_cik,
      reporting_owner_name_raw, structural_payload
    from pg_catalog.jsonb_to_recordset(p_reporting_owners) as item(
      accession_number text, reporting_owner_index smallint, reporting_owner_cik_raw text,
      reporting_owner_cik text, reporting_owner_name_raw text, structural_payload jsonb
    );

  insert into public.sec_section16_transactions (
    accession_number, row_ordinal, row_kind, row_index, xml_path, security_title_raw,
    transaction_form_type_raw, transaction_code_raw, transaction_timeliness_raw,
    transaction_date_raw, deemed_execution_date_raw, shares_raw, transaction_total_value_raw,
    price_per_share_raw, acquired_disposed_code_raw, post_transaction_shares_raw,
    post_transaction_value_raw, direct_or_indirect_ownership_raw, nature_of_ownership_raw,
    conversion_or_exercise_price_raw, exercise_date_raw, expiration_date_raw,
    underlying_security_title_raw, underlying_security_shares_raw, underlying_security_value_raw,
    footnote_ids, structural_payload
  ) select * from pg_catalog.jsonb_to_recordset(p_transactions) as item(
    accession_number text, row_ordinal smallint, row_kind text, row_index smallint, xml_path text,
    security_title_raw text, transaction_form_type_raw text, transaction_code_raw text,
    transaction_timeliness_raw text, transaction_date_raw text, deemed_execution_date_raw text,
    shares_raw text, transaction_total_value_raw text, price_per_share_raw text,
    acquired_disposed_code_raw text, post_transaction_shares_raw text, post_transaction_value_raw text,
    direct_or_indirect_ownership_raw text, nature_of_ownership_raw text,
    conversion_or_exercise_price_raw text, exercise_date_raw text, expiration_date_raw text,
    underlying_security_title_raw text, underlying_security_shares_raw text,
    underlying_security_value_raw text, footnote_ids jsonb, structural_payload jsonb
  );

  insert into public.sec_section16_holdings (
    accession_number, row_ordinal, row_kind, row_index, xml_path, security_title_raw,
    transaction_form_type_raw, amount_owned_raw, value_owned_raw, direct_or_indirect_ownership_raw,
    nature_of_ownership_raw, conversion_or_exercise_price_raw, exercise_date_raw,
    expiration_date_raw, underlying_security_title_raw, underlying_security_shares_raw,
    underlying_security_value_raw, footnote_ids, structural_payload
  ) select * from pg_catalog.jsonb_to_recordset(p_holdings) as item(
    accession_number text, row_ordinal smallint, row_kind text, row_index smallint, xml_path text,
    security_title_raw text, transaction_form_type_raw text, amount_owned_raw text, value_owned_raw text,
    direct_or_indirect_ownership_raw text, nature_of_ownership_raw text,
    conversion_or_exercise_price_raw text, exercise_date_raw text, expiration_date_raw text,
    underlying_security_title_raw text, underlying_security_shares_raw text,
    underlying_security_value_raw text, footnote_ids jsonb, structural_payload jsonb
  );

  insert into public.sec_section16_footnotes (
    accession_number, footnote_index, footnote_id, text_value, raw_text, structural_payload
  ) select accession_number, footnote_index, footnote_id, text_value, raw_text, structural_payload
    from pg_catalog.jsonb_to_recordset(p_footnotes) as item(
      accession_number text, footnote_index smallint, footnote_id text, text_value text,
      raw_text text, structural_payload jsonb
    );

  insert into public.sec_section16_signatures (
    accession_number, signature_index, signature_name_raw, signature_date_raw, structural_payload
  ) select accession_number, signature_index, signature_name_raw, signature_date_raw, structural_payload
    from pg_catalog.jsonb_to_recordset(p_signatures) as item(
      accession_number text, signature_index smallint, signature_name_raw text,
      signature_date_raw text, structural_payload jsonb
    );

  return pg_catalog.jsonb_build_object(
    'status', 'inserted', 'filing_count', 1,
    'reporting_owner_count', pg_catalog.jsonb_array_length(p_reporting_owners),
    'transaction_count', pg_catalog.jsonb_array_length(p_transactions),
    'holding_count', pg_catalog.jsonb_array_length(p_holdings),
    'footnote_count', pg_catalog.jsonb_array_length(p_footnotes),
    'signature_count', pg_catalog.jsonb_array_length(p_signatures)
  );
end;
$$;

create or replace function public.record_sec_section16_persistence_state(p_raw_item_id uuid, p_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.jsonb_typeof(p_state), '') <> 'object'
     or coalesce(p_state ->> 'status', '') not in ('available', 'failed') then
    raise exception using errcode = '22023', message = 'Section 16 persistence state is invalid';
  end if;
  update public.raw_items
  set metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('section16_xml_persistence', p_state)
  where id = p_raw_item_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Section 16 raw item does not exist';
  end if;
  return p_state;
end;
$$;

revoke all on function public.persist_sec_section16_filing(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_sec_section16_filing(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;
revoke all on function public.record_sec_section16_persistence_state(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_sec_section16_persistence_state(uuid, jsonb)
  to service_role;

comment on table public.sec_section16_filings is
  'One immutable filing row per verified SEC Form 3/3-A/5/5-A XML accession. Exact raw XML, parser output, issuer identity, source URL, and source hashes are independent of site analysis.';
comment on table public.sec_section16_transactions is
  'Exact Section 16 XML transaction rows in document order. Form 5 transaction dates remain row dates and no total values are derived.';
comment on table public.sec_section16_holdings is
  'Exact Section 16 XML holding rows in document order. Form 3 holdings are never represented as purchases.';
comment on function public.persist_sec_section16_filing(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'Service-only atomic insert-or-verify. The RPC revalidates the persisted raw SEC source, serializes same-accession writes, and rejects conflicting replay.';
