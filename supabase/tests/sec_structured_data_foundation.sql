begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'sec_structured_raw_sources', 'raw SEC structured sources are versioned');
select has_column('public', 'sec_structured_raw_sources', 'raw_content', 'exact raw source text is recoverable');
select has_column('public', 'sec_structured_raw_sources', 'raw_content_kind', 'raw text authority is explicit');
select has_table('public', 'sec_issuers', 'issuer identity is keyed by CIK');
select has_table('public', 'sec_issuer_ticker_observations', 'ticker/exchange observations preserve source time');
select has_table('public', 'sec_filing_ledger', 'filings have an accession ledger');
select has_table('public', 'sec_company_facts', 'CompanyFacts facts are generic normalized rows');

select ok(
  (select pg_catalog.bool_and(c.relrowsecurity)
   from pg_catalog.pg_class c
   where c.oid in (
     'public.sec_structured_raw_sources'::regclass,
     'public.sec_issuers'::regclass,
     'public.sec_issuer_source_observations'::regclass,
     'public.sec_issuer_ticker_observations'::regclass,
     'public.sec_filing_ledger'::regclass,
     'public.sec_company_facts'::regclass
   )),
  'all public-schema SEC foundation tables have RLS'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.sec_company_facts', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.sec_company_facts', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.sec_structured_raw_sources', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.sec_structured_raw_sources', 'insert'),
  'browser roles have no raw or normalized access'
);
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.sec_company_facts', 'select,insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.sec_company_facts', 'update,delete')
  and pg_catalog.has_table_privilege('service_role', 'public.sec_filing_ledger', 'select,insert,update'),
  'service role has only repository-required table privileges'
);
select ok(
  not pg_catalog.has_sequence_privilege('anon', 'public.sec_company_facts_id_seq', 'usage')
  and not pg_catalog.has_sequence_privilege('authenticated', 'public.sec_company_facts_id_seq', 'usage')
  and pg_catalog.has_sequence_privilege('service_role', 'public.sec_company_facts_id_seq', 'usage,select'),
  'identity sequence privileges are explicit and server-only'
);

select throws_ok(
  $$insert into public.sec_issuers (cik) values ('0000000000')$$,
  '23514', null, 'issuer identity rejects the all-zero CIK'
);
select throws_ok(
  $$insert into public.sec_structured_raw_sources (
      id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
      content_hash, raw_content_kind, raw_content, payload
    ) values (
      '80000000-0000-5000-8000-000000000000', 'submissions',
      'https://data.sec.gov/submissions/CIK0000000000.json', 'fixture:all-zero-cik',
      '0000000000', '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00',
      repeat('0', 64), 'injected_exact_body', '{"cik":0}', '{"cik":0}'::jsonb
    )$$,
  '23514', null, 'raw SEC source rejects the all-zero CIK'
);

insert into public.sec_structured_raw_sources (
  id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
  content_hash, source_schema_version, raw_content_kind, raw_content, payload
) values
  ('81000000-0000-5000-8000-000000000001', 'submissions',
   'https://data.sec.gov/submissions/CIK0000000001.json', 'fixture:submissions:1',
   '0000000001', '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00',
   pg_catalog.encode(extensions.digest('{"cik":1}', 'sha256'), 'hex'), null,
   'injected_exact_body', '{"cik":1}', '{"cik":1}'::jsonb),
  ('81000000-0000-5000-8000-000000000002', 'companyfacts',
   'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json', 'fixture:companyfacts:1',
   '0000000001', '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00',
   pg_catalog.encode(extensions.digest('{"cik":1,"facts":{}}', 'sha256'), 'hex'), null,
   'injected_exact_body', '{"cik":1,"facts":{}}', '{"cik":1,"facts":{}}'::jsonb)
on conflict do nothing;
insert into public.sec_issuers (cik) values ('0000000001') on conflict do nothing;
insert into public.sec_issuer_source_observations (
  issuer_cik, entity_name, source_raw_id, observed_at, ingested_at
) values (
  '0000000001', 'Fixture Issuer', '81000000-0000-5000-8000-000000000001',
  '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00'
);
insert into public.sec_issuer_ticker_observations (
  issuer_cik, ticker, exchange, source_raw_id, observed_at, ingested_at
) values
  ('0000000001', 'AAA', 'NYSE', '81000000-0000-5000-8000-000000000001', '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00'),
  ('0000000001', 'AAA.B', 'NYSE', '81000000-0000-5000-8000-000000000001', '2026-08-21 00:00:00+00', '2026-08-21 00:01:00+00');
insert into public.sec_filing_ledger (
  accession_number, issuer_cik, form, filed_date, accepted_at, report_date,
  primary_document, is_xbrl, is_inline_xbrl, source_raw_id, ingested_at
) values (
  '0000000001-26-000001', '0000000001', '10-Q', '2026-05-01',
  '2026-05-01 12:34:56+00', '2026-03-31', 'fixture.htm', true, true,
  '81000000-0000-5000-8000-000000000001', '2026-08-21 00:01:00+00'
);
insert into public.sec_company_facts (
  source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
  filed_date, source_raw_id, taxonomy, concept, unit, value_kind,
  value_numeric, instant_date, fiscal_year, fiscal_period, frame, ingested_at
) values (
  repeat('c', 64), 'facts.dei.Shares.units.shares[0]', '0000000001',
  '0000000001-26-000001', '10-Q', '2026-05-01',
  '81000000-0000-5000-8000-000000000002', 'dei', 'Shares', 'shares',
  'numeric', 100, '2026-04-25', 2026, 'Q2', 'CY2026Q1I', '2026-08-21 00:01:00+00'
);
insert into public.sec_company_facts (
  source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
  filed_date, source_raw_id, taxonomy, concept, unit, value_kind,
  value_numeric, start_date, end_date, fiscal_year, fiscal_period, ingested_at
) values (
  repeat('d', 64), 'facts.us-gaap.Revenue.units.USD[0]', '0000000001',
  '0000000001-26-000001', '10-Q', '2026-05-01',
  '81000000-0000-5000-8000-000000000002', 'us-gaap', 'Revenue', 'USD',
  'numeric', 500, '2026-01-01', '2026-03-31', 2026, 'Q2', '2026-08-21 00:01:00+00'
);

select is((select count(*)::integer from public.sec_issuers where cik = '0000000001'), 1, 'one CIK owns the issuer');
select is(
  (select raw_content from public.sec_structured_raw_sources where id = '81000000-0000-5000-8000-000000000002'),
  '{"cik":1,"facts":{}}',
  'exact raw source text round-trips'
);
select ok(
  (select content_hash = pg_catalog.encode(extensions.digest(raw_content, 'sha256'), 'hex')
   from public.sec_structured_raw_sources where id = '81000000-0000-5000-8000-000000000002'),
  'content hash is derived from stored raw text'
);
select is((select count(*)::integer from public.sec_issuer_ticker_observations where issuer_cik = '0000000001'), 2, 'multiple tickers do not split issuer identity');
select is((select accepted_at from public.sec_filing_ledger where accession_number = '0000000001-26-000001'), '2026-05-01 12:34:56+00'::timestamptz, 'authoritative acceptance timestamp round-trips separately');
select is((select count(*)::integer from public.sec_company_facts where issuer_cik = '0000000001' and instant_date is not null), 1, 'instant is preserved');
select is((select count(*)::integer from public.sec_company_facts where issuer_cik = '0000000001' and start_date is not null and end_date is not null), 1, 'duration is preserved');
select is((select count(*)::integer from public.sec_company_facts where source_raw_id = '81000000-0000-5000-8000-000000000002'), 2, 'facts retain exact raw source linkage');

insert into public.sec_company_facts (
  source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
  filed_date, source_raw_id, taxonomy, concept, unit, value_kind,
  value_numeric, instant_date, ingested_at
) values (
  repeat('c', 64), 'facts.dei.Shares.units.shares[0]', '0000000001',
  '0000000001-26-000001', '10-Q', '2026-05-01',
  '81000000-0000-5000-8000-000000000002', 'dei', 'Shares', 'shares',
  'numeric', 100, '2026-04-25', '2026-08-21 00:01:00+00'
) on conflict (source_fact_key) do nothing;
select is((select count(*)::integer from public.sec_company_facts where source_fact_key = repeat('c', 64)), 1, 'normalized replay is conflict-safe');

select throws_ok(
  $$insert into public.sec_company_facts (
      source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
      filed_date, source_raw_id, taxonomy, concept, unit, value_kind,
      value_numeric, instant_date, start_date, end_date, ingested_at
    ) values (
      repeat('e', 64), 'mixed', '0000000001', '0000000001-26-000001', '10-Q',
      '2026-05-01', '81000000-0000-5000-8000-000000000002', 'dei', 'Mixed',
      'shares', 'numeric', 1, '2026-03-31', '2026-01-01', '2026-03-31', now()
    )$$,
  '23514', null, 'mixed instant and duration fails closed'
);
select throws_ok(
  $$insert into public.sec_company_facts (
      source_fact_key, source_fact_path, issuer_cik, filing_accession, form,
      filed_date, source_raw_id, taxonomy, concept, unit, value_kind,
      value_numeric, ingested_at
    ) values (
      repeat('f', 64), 'missing', '0000000001', '0000000001-26-000001', '10-Q',
      '2026-05-01', '81000000-0000-5000-8000-000000000002', 'dei', 'Missing',
      'shares', 'numeric', 1, now()
    )$$,
  '23514', null, 'missing period fails closed'
);

select * from finish();
rollback;
