begin;

select plan(26);

select has_table('public', 'sec_sc13_filings', 'SC13 canonical filing table exists');
select has_table('public', 'sec_sc13_reporting_persons', 'SC13 reporting-person table exists');
select has_column('public', 'sec_sc13_filings', 'raw_xml', 'raw XML is preserved');
select has_column('public', 'sec_sc13_filings', 'issuer_cik', 'issuer identity is stored separately');
select has_column('public', 'sec_sc13_filings', 'header_filer_cik', 'header filer identity is stored separately');
select has_column('public', 'sec_sc13_reporting_persons', 'aggregate_amount_owned_raw', 'raw ownership decimal is preserved');
select has_column('public', 'sec_sc13_reporting_persons', 'aggregate_amount_owned', 'normalized ownership numeric is stored');
select has_index('public', 'sec_sc13_filings', 'sec_sc13_filings_issuer_history_idx', 'issuer history has a composite index');

select ok(
  not has_table_privilege('anon', 'public.sec_sc13_filings', 'select')
  and not has_table_privilege('authenticated', 'public.sec_sc13_filings', 'select'),
  'client roles cannot read SC13 filings'
);
select ok(
  not has_table_privilege('anon', 'public.sec_sc13_reporting_persons', 'select')
  and not has_table_privilege('authenticated', 'public.sec_sc13_reporting_persons', 'select'),
  'client roles cannot read SC13 reporter rows'
);
select ok(
  has_table_privilege('service_role', 'public.sec_sc13_filings', 'select,insert')
  and not has_table_privilege('service_role', 'public.sec_sc13_filings', 'update,delete'),
  'service role receives only required filing privileges'
);
select ok(
  has_function_privilege('service_role', 'public.persist_sec_sc13_filing(uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.persist_sec_sc13_filing(uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.persist_sec_sc13_filing(uuid,jsonb,jsonb)', 'execute'),
  'canonical write RPC is service-only'
);
select ok(
  has_function_privilege('service_role', 'public.record_sec_sc13_persistence_state(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_sec_sc13_persistence_state(uuid,jsonb)', 'execute'),
  'persistence-state RPC is service-only'
);

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('sec_sc13_fixture', 'SC13 fixture', 'filings', 'manual', false)
on conflict (code) do nothing;

insert into public.raw_items (
  id, source_code, source_group, source_unique_id, source_url, title,
  published_at, fetched_at, body_text, analysis_text, raw_payload, metadata, dedupe_key
) values (
  '98000000-0000-4000-8000-000000000001', 'sec_sc13_fixture', 'filings',
  '0000000001-26-000001', 'https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/index.html',
  'SC13 fixture', '2026-09-02 00:00:00+00', '2026-09-02 00:00:00+00', '', '', '{}'::jsonb,
  '{"analysis_status":"completed"}'::jsonb, 'sc13-fixture'
);

select is(
  public.persist_sec_sc13_filing(
    '98000000-0000-4000-8000-000000000001',
    '{
      "accession_number":"0000000001-26-000001",
      "raw_item_id":"98000000-0000-4000-8000-000000000001",
      "form_type_raw":"SCHEDULE 13D/A",
      "previous_accession_number_raw":"0000000001-25-000009",
      "amendment_number_raw":"07",
      "event_date_raw":"09/01/2026",
      "event_date":"2026-09-01",
      "filed_at_raw":"2026-09-02T00:00:00.000Z",
      "filed_at":"2026-09-02T00:00:00.000Z",
      "header_filer_cik_raw":"0002222222",
      "header_filer_cik":"0002222222",
      "issuer_cik_raw":"0001111111",
      "issuer_cik":"0001111111",
      "issuer_name_raw":"Issuer & Co.",
      "security_class_raw":"Common Stock",
      "cusips_raw":["111111111"],
      "source_url":"https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/primary_doc.xml",
      "source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "raw_xml":"<edgarSubmission/>",
      "raw_xml_char_count":18,
      "raw_xml_utf8_byte_count":18,
      "parser_version":"sc13-structural-xml-v1",
      "xsd_package_version":"2.3",
      "namespace":"http://www.sec.gov/edgar/schedule13D",
      "schema_version_raw":"X0202",
      "archive_directory_cik_raw":"1111111",
      "archive_directory_role":"issuer",
      "index_subject_cik_raw":"0001111111",
      "index_filed_by_ciks_raw":["0002222222"],
      "index_canonical_xml_url":"https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/primary_doc.xml",
      "provenance_payload":{"indexStatus":"verified"},
      "structural_payload":{"submissionTypeRaw":"SCHEDULE 13D/A"},
      "payload_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }'::jsonb,
    '[
      {
        "accession_number":"0000000001-26-000001","reporting_person_index":0,
        "reporting_person_cik_raw":"0002222222","reporting_person_cik":"0002222222",
        "reporting_person_cik_missing_flag_raw":"N","reporting_person_name_raw":"Alpha Fund LP",
        "member_of_group_raw":"a","fund_types_raw":["WC"],"citizenship_or_organization_raw":"DE",
        "sole_voting_power_raw":"000123.40","shared_voting_power_raw":"5.00",
        "sole_dispositive_power_raw":"000123.40","shared_dispositive_power_raw":"5.00",
        "aggregate_amount_owned_raw":"000128.40","aggregate_excludes_certain_shares_flag_raw":"N",
        "percent_of_class_raw":"07.50","types_of_reporting_person_raw":["PN"],
        "structural_payload":{"reportingPersonNameRaw":"Alpha Fund LP"}
      },
      {
        "accession_number":"0000000001-26-000001","reporting_person_index":1,
        "reporting_person_cik_raw":null,"reporting_person_cik":null,
        "reporting_person_cik_missing_flag_raw":"Y","reporting_person_name_raw":"Alpha GP LLC",
        "member_of_group_raw":null,"fund_types_raw":[],"citizenship_or_organization_raw":null,
        "sole_voting_power_raw":"0.00","shared_voting_power_raw":null,
        "sole_dispositive_power_raw":"0.00","shared_dispositive_power_raw":null,
        "aggregate_amount_owned_raw":"0.00","aggregate_excludes_certain_shares_flag_raw":null,
        "percent_of_class_raw":"0.00","types_of_reporting_person_raw":["OO"],
        "structural_payload":{"reportingPersonNameRaw":"Alpha GP LLC"}
      }
    ]'::jsonb
  ),
  '{"status": "inserted", "filing_count": 1, "reporter_count": 2}'::jsonb,
  'canonical filing and reporter rows insert atomically'
);

select is((select count(*)::integer from public.sec_sc13_filings), 1, 'one filing row is stored');
select is((select count(*)::integer from public.sec_sc13_reporting_persons), 2, 'reporters remain separate rows');
select is((select issuer_cik from public.sec_sc13_filings), '0001111111', 'issuer is not replaced by header filer');
select is((select header_filer_cik from public.sec_sc13_filings), '0002222222', 'header filer remains distinct');
select is((select aggregate_amount_owned_raw from public.sec_sc13_reporting_persons where reporting_person_index = 0), '000128.40', 'leading-zero raw decimal is preserved');
select is((select aggregate_amount_owned from public.sec_sc13_reporting_persons where reporting_person_index = 0), 128.40::numeric, 'raw decimal has an equal numeric value');
select ok(
  (select aggregate_amount_owned = 0 and shared_voting_power is null and shared_voting_power_raw is null
   from public.sec_sc13_reporting_persons where reporting_person_index = 1),
  'numeric zero remains distinct from a missing power'
);

select is(
  public.persist_sec_sc13_filing(
    '98000000-0000-4000-8000-000000000001',
    (select to_jsonb(stored) - 'created_at' - 'amendment_number'
       from public.sec_sc13_filings stored where accession_number = '0000000001-26-000001'),
    (select jsonb_agg(
      to_jsonb(stored)
        - 'created_at'
        - 'sole_voting_power'
        - 'shared_voting_power'
        - 'sole_dispositive_power'
        - 'shared_dispositive_power'
        - 'aggregate_amount_owned'
        - 'aggregate_excludes_certain_shares'
        - 'percent_of_class'
      order by reporting_person_index)
    from public.sec_sc13_reporting_persons stored
    where accession_number = '0000000001-26-000001')
  ),
  '{"status": "replayed", "filing_count": 1, "reporter_count": 2}'::jsonb,
  'exact replay performs a verified no-op'
);

select is(
  public.record_sec_sc13_persistence_state(
    '98000000-0000-4000-8000-000000000001',
    '{"status":"available","storage_version":"sec_sc13_xml_v1"}'::jsonb
  ),
  '{"status": "available", "storage_version": "sec_sc13_xml_v1"}'::jsonb,
  'independent persistence state is recorded'
);
select ok(
  (select metadata ->> 'analysis_status' = 'completed'
      and metadata #>> '{sc13_xml_persistence,status}' = 'available'
   from public.raw_items where id = '98000000-0000-4000-8000-000000000001'),
  'persistence-state merge preserves existing analysis metadata'
);

select throws_ok(
  $$ select public.persist_sec_sc13_filing(
    '98000000-0000-4000-8000-000000000001',
    (select (to_jsonb(stored) - 'created_at' - 'amendment_number')
      || '{"source_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb
      from public.sec_sc13_filings stored where accession_number = '0000000001-26-000001'),
    (select jsonb_agg(
      to_jsonb(stored)
        - 'created_at'
        - 'sole_voting_power'
        - 'shared_voting_power'
        - 'sole_dispositive_power'
        - 'shared_dispositive_power'
        - 'aggregate_amount_owned'
        - 'aggregate_excludes_certain_shares'
        - 'percent_of_class'
      order by reporting_person_index)
    from public.sec_sc13_reporting_persons stored
    where accession_number = '0000000001-26-000001')
  ) $$,
  '23505',
  'SC13 accession already has a conflicting canonical payload',
  'conflicting replay fails closed'
);
select is((select source_sha256 from public.sec_sc13_filings), repeat('a', 64), 'conflict preserves prior filing value');

select * from finish();
rollback;
