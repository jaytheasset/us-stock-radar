begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'share_count_history', 'common Share Count History table exists');
select has_column('public', 'share_count_history', 'security_class_identity', 'security-class identity is preserved');
select has_column('public', 'share_count_history', 'share_basis_metadata', 'share-basis metadata is preserved');
select has_column('public', 'share_count_history', 'authoritative_decision_lineage', 'authoritative decision lineage is preserved');
select has_column('public', 'share_count_history', 'canonical_security_class_id', 'source-independent canonical security-class identity is preserved');
select has_column('public', 'share_count_history', 'accepted_at_source', 'SEC acceptance timestamp provenance is preserved');

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.share_count_history'::regclass),
  'Share Count History has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.share_count_history', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.share_count_history', 'select,insert,update,delete')
  and not pg_catalog.has_sequence_privilege('anon', 'public.share_count_history_id_seq', 'usage')
  and not pg_catalog.has_sequence_privilege('authenticated', 'public.share_count_history_id_seq', 'usage'),
  'browser roles have no direct table or sequence access'
);
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.share_count_history', 'select,insert')
  and not pg_catalog.has_table_privilege('service_role', 'public.share_count_history', 'update,delete')
  and pg_catalog.has_sequence_privilege('service_role', 'public.share_count_history_id_seq', 'usage,select'),
  'service role has append/read-only table privileges and the required sequence privileges'
);

insert into public.sec_structured_raw_sources (
  id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
  content_hash, raw_content_kind, raw_content, payload
) values (
  '93000000-0000-5000-8000-000000000001', 'submissions',
  'https://data.sec.gov/submissions/CIK0000000099.json', 'share-count-history:fixture:submissions',
  '0000000099', '2026-08-20 00:00:00+00', '2026-08-20 00:01:00+00',
  repeat('9', 64), 'injected_exact_body', '{"fixture":true}', '{"fixture":true}'::jsonb
) on conflict do nothing;
insert into public.sec_issuers (cik) values ('0000000099') on conflict do nothing;
insert into public.sec_filing_ledger (
  accession_number, issuer_cik, form, filed_date, accepted_at, primary_document,
  is_xbrl, is_inline_xbrl, source_raw_id, ingested_at
) values
  ('0000000099-26-000001', '0000000099', '10-Q', '2026-08-20', '2026-08-20 12:00:00+00', 'fixture.htm', true, true, '93000000-0000-5000-8000-000000000001', '2026-08-20 13:00:00+00'),
  ('0000000099-26-000002', '0000000099', '10-Q', '2026-08-21', '2026-08-21 12:00:00+00', 'fixture.htm', true, true, '93000000-0000-5000-8000-000000000001', '2026-08-21 13:00:00+00'),
  ('0000000099-26-000003', '0000000099', '10-Q', '2026-08-21', '2026-08-21 12:01:00+00', 'fixture.htm', true, true, '93000000-0000-5000-8000-000000000001', '2026-08-21 13:00:00+00'),
  ('0000000099-26-000004', '0000000099', '10-Q', '2026-08-21', '2026-08-21 12:02:00+00', 'fixture.htm', true, true, '93000000-0000-5000-8000-000000000001', '2026-08-21 13:00:00+00')
on conflict do nothing;

create function pg_temp.insert_share_history(
  p_accession text,
  p_as_of date,
  p_shares numeric,
  p_fact_key text,
  p_context_ref text,
  p_filed_date date,
  p_accepted_at timestamptz,
  p_security_basis text default 'SINGLE_COMMON_STOCK_CLASS',
  p_security_identity jsonb default '{"canonicalKey":"SINGLE_COMMON_STOCK_CLASS|dei:EntityCommonStockSharesOutstanding@required-context","identity":"dei:EntityCommonStockSharesOutstanding@required-context"}'::jsonb,
  p_dimensions jsonb default '[]'::jsonb,
  p_reason text default 'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT',
  p_status text default 'ELIGIBLE'
) returns integer
language plpgsql
as $$
declare
  affected integer;
  artifact_id uuid := '94000000-0000-5000-8000-000000000001';
  source_url text := 'https://www.sec.gov/Archives/edgar/data/99/fixture.htm';
begin
  insert into public.share_count_history (
    observation_type, issuer_cik, shares_outstanding, as_of, security_class_basis,
    security_class_identity, security_class_metadata,
    canonical_security_class_id, canonical_security_class_kind,
    canonical_security_class_status, canonical_security_class_provenance,
    share_basis_identity,
    share_basis_metadata, accession_number, form, filing_document, filed_date,
    accepted_at, accepted_at_source, accepted_at_provenance, ingested_at,
    source_concept_namespace_uri,
    source_concept_local_name, source_fact_key, source_context_ref,
    source_artifact_id, filing_ledger_raw_source_id, source_fact_identity,
    source_context, source_dimensions, source_provenance, source_type,
    authoritative_status, authoritative_decision_version,
    authoritative_decision_reason, authoritative_decision_lineage,
    source_document_url, source_content_hash
  ) values (
    'authoritative_xbrl', '0000000099', p_shares, p_as_of, p_security_basis,
    p_security_identity,
    pg_catalog.jsonb_build_object('evidenceFactKey', p_fact_key, 'contextRef', p_context_ref, 'dimensions', p_dimensions),
    case when p_security_basis = 'SINGLE_COMMON_STOCK_CLASS'
      then 'sc:v1:0000000099:common_stock:single'
      else 'sc:v1:0000000099:common_stock:us-gaap:' ||
        (p_security_identity #>> '{identity,member,localName}') end,
    'common_stock', 'mapped',
    pg_catalog.jsonb_build_object('version', 'share-count-security-class-v1', 'fixture', true),
    'shares_outstanding:xbrli_shares',
    '{"measurement":"shares_outstanding","unit":{"namespaceUri":"http://www.xbrl.org/2003/instance","localName":"shares"}}'::jsonb,
    p_accession, '10-Q', 'fixture.htm', p_filed_date, p_accepted_at,
    'sec_filing_ledger',
    pg_catalog.jsonb_build_object('source', 'sec_filing_ledger.accepted_at', 'accessionNumber', p_accession),
    '2026-08-22 01:02:03+00', 'http://xbrl.sec.gov/dei/2025',
    'EntityCommonStockSharesOutstanding', p_fact_key, p_context_ref,
    artifact_id, '93000000-0000-5000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'factKey', p_fact_key, 'contextRef', p_context_ref, 'accession', p_accession,
      'documentName', 'fixture.htm', 'artifactId', artifact_id::text,
      'concept', pg_catalog.jsonb_build_object('namespaceUri', 'http://xbrl.sec.gov/dei/2025', 'localName', 'EntityCommonStockSharesOutstanding')
    ),
    pg_catalog.jsonb_build_object(
      'id', p_context_ref, 'entityIdentifier', '0000000099', 'entityScheme', 'http://www.sec.gov/CIK',
      'period', pg_catalog.jsonb_build_object('kind', 'instant', 'instant', p_as_of::text),
      'dimensions', p_dimensions
    ),
    p_dimensions,
    pg_catalog.jsonb_build_object(
      'companyFacts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'sourceFactKey', repeat('8', 64), 'sourceFactPath', 'facts.dei.fixture',
        'sourceRawId', '93000000-0000-5000-8000-000000000002')),
      'filingLedgerRawSourceId', '93000000-0000-5000-8000-000000000001',
      'filingFactSource', pg_catalog.jsonb_build_object(
        'artifactId', artifact_id::text, 'sourceUrl', source_url, 'contentHash', p_fact_key)
    ),
    'sec_authoritative_os', p_status, 'authoritative-os-extraction-v1', p_reason,
    pg_catalog.jsonb_build_object(
      'status', p_status, 'decisionVersion', 'authoritative-os-extraction-v1',
      'reason', p_reason, 'candidate', pg_catalog.jsonb_build_object(
        'issuerCik', '0000000099', 'sharesOutstanding', p_shares::text,
        'asOf', p_as_of::text, 'accession', p_accession, 'form', '10-Q',
        'filedDate', p_filed_date::text),
      'filingFacts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('factKey', p_fact_key))
    ),
    source_url, p_fact_key
  ) on conflict on constraint share_count_history_canonical_source_unique do nothing;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function pg_temp.insert_level2_history()
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  insert into public.share_count_history (
    observation_type, issuer_cik, shares_outstanding, as_of,
    security_class_basis, security_class_identity, security_class_metadata,
    canonical_security_class_id, canonical_security_class_kind,
    canonical_security_class_status, canonical_security_class_provenance,
    share_basis_identity, share_basis_metadata, accession_number, form,
    filing_document, filed_date, accepted_at, accepted_at_source,
    accepted_at_provenance, ingested_at,
    source_concept_namespace_uri, source_concept_local_name, source_fact_key,
    source_context_ref, source_artifact_id, filing_ledger_raw_source_id,
    source_fact_identity, source_context, source_dimensions, source_provenance,
    source_type, authoritative_status, authoritative_decision_version,
    authoritative_decision_reason, authoritative_decision_lineage,
    source_document_url, source_content_hash, source_evidence, source_analyzer
  ) values (
    'source_stated', '0000000099', 27500000, '2026-08-18',
    'SOURCE_STATED_SECURITY_CLASS',
    pg_catalog.jsonb_build_object(
      'canonicalKey', 'SOURCE_STATED_SECURITY_CLASS|' || repeat('7', 64),
      'identity', pg_catalog.jsonb_build_object('title', 'common stock')
    ),
    pg_catalog.jsonb_build_object(
      'sourceRef', 'sec-cover',
      'evidence', 'As of August 18, 2026, 27,500,000 shares of common stock were outstanding.',
      'sourceDeclaredClassKind', 'common_stock'
    ),
    'sc:v1:0000000099:common_stock:single', 'common_stock', 'mapped',
    pg_catalog.jsonb_build_object(
      'version', 'share-count-security-class-v1',
      'derivation', 'level2_explicit_common_stock_plus_authoritative_single_class_evidence',
      'supportingObservations', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('sourceFactKey', repeat('a', 64)))
    ),
    'shares_outstanding:source_stated',
    '{"measurement":"shares_outstanding","unit":{"kind":"shares","representation":"positive_integer"},"sourceStatedBasis":null}'::jsonb,
    '0000000099-26-000001', '8-K', 'fixture-level2.htm', '2026-08-18',
    '2026-08-18 12:00:00+00', 'sec_raw_payload_acceptance',
    '{"source":"raw_items.raw_payload.accepted_at"}'::jsonb,
    '2026-08-22 12:00:00+00',
    null, null, repeat('6', 64), 'sec-cover',
    '95000000-0000-5000-8000-000000000001', null,
    pg_catalog.jsonb_build_object(
      'factKey', repeat('6', 64), 'sourceRef', 'sec-cover',
      'accession', '0000000099-26-000001', 'documentName', 'fixture-level2.htm',
      'observationType', 'source_stated'
    ),
    '{"sourceRef":"sec-cover","asOf":"2026-08-18","issuerCik":"0000000099"}'::jsonb,
    '[]'::jsonb,
    pg_catalog.jsonb_build_object(
      'rawItemId', '95000000-0000-5000-8000-000000000001',
      'eventId', '95000000-0000-5000-8000-000000000002',
      'parentPrimaryAiRunId', '95000000-0000-5000-8000-000000000003',
      'sourceExecutionId', '95000000-0000-5000-8000-000000000004',
      'analyzerKey', 'listing_risk', 'sourceRef', 'sec-cover'
    ),
    'sec_filing_text_level2', null, null, null, null,
    'https://www.sec.gov/Archives/edgar/data/99/fixture-level2.htm', repeat('5', 64),
    'As of August 18, 2026, 27,500,000 shares of common stock were outstanding.',
    'listing_risk'
  ) on conflict on constraint share_count_history_canonical_source_unique do nothing;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select is(
  pg_temp.insert_share_history('0000000099-26-000001', '2026-08-01', 100, repeat('a', 64), 'c-1', '2026-08-20', '2026-08-20 12:00:00+00'),
  1, 'ELIGIBLE observation saves'
);
select is(pg_temp.insert_level2_history(), 1, 'exact source-stated Level 2 observation saves');
select is(pg_temp.insert_level2_history(), 0, 'exact Level 2 replay inserts zero rows');
select is(
  (select count(*)::integer from public.share_count_history
   where issuer_cik = '0000000099'
     and source_type in ('sec_authoritative_os', 'sec_filing_text_level2')),
  2,
  'SEC XBRL and Level 2 sources coexist without cross-source replacement'
);
select is(
  (select count(distinct canonical_security_class_id)::integer
   from public.share_count_history
   where issuer_cik = '0000000099'
     and source_type in ('sec_authoritative_os', 'sec_filing_text_level2')),
  1,
  'single-class XBRL and explicit Level 2 common stock share one canonical identity'
);
select ok(
  (select accepted_at_source = 'sec_raw_payload_acceptance'
          and accepted_at = '2026-08-18 12:00:00+00'::timestamptz
   from public.share_count_history where source_type = 'sec_filing_text_level2'),
  'Level 2 accepted_at records the exact SEC raw-payload acceptance provenance'
);
select is(
  pg_temp.insert_share_history('0000000099-26-000001', '2026-08-01', 100, repeat('a', 64), 'c-1', '2026-08-20', '2026-08-20 12:00:00+00'),
  0, 'exact authoritative replay inserts zero rows'
);
select is(
  pg_temp.insert_share_history('0000000099-26-000002', '2026-08-15', 110, repeat('b', 64), 'c-2', '2026-08-21', '2026-08-21 12:00:00+00'),
  1, 'new as-of/value/accession appends another row'
);
select is(
  (select count(*)::integer from public.share_count_history where issuer_cik = '0000000099' and security_class_basis = 'SINGLE_COMMON_STOCK_CLASS'),
  2, 'two dates remain two history rows'
);

select is(
  pg_temp.insert_share_history(
    '0000000099-26-000003', '2026-08-15', 70, repeat('c', 64), 'class-a', '2026-08-21', '2026-08-21 12:01:00+00',
    'CLASS_SPECIFIC_COMMON_STOCK',
    '{"canonicalKey":"CLASS_SPECIFIC_COMMON_STOCK|axis|ClassA","identity":{"axis":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"StatementClassOfStockAxis"},"member":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"CommonClassAMember"}}}'::jsonb,
    '[{"kind":"explicit","axis":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"StatementClassOfStockAxis"},"member":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"CommonClassAMember"}}]'::jsonb,
    'ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT'
  ), 1, 'Class A saves independently'
);
select is(
  pg_temp.insert_share_history(
    '0000000099-26-000004', '2026-08-15', 30, repeat('d', 64), 'class-b', '2026-08-21', '2026-08-21 12:02:00+00',
    'CLASS_SPECIFIC_COMMON_STOCK',
    '{"canonicalKey":"CLASS_SPECIFIC_COMMON_STOCK|axis|ClassB","identity":{"axis":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"StatementClassOfStockAxis"},"member":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"CommonClassBMember"}}}'::jsonb,
    '[{"kind":"explicit","axis":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"StatementClassOfStockAxis"},"member":{"namespaceUri":"http://fasb.org/us-gaap/2025","localName":"CommonClassBMember"}}]'::jsonb,
    'ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT'
  ), 1, 'Class B saves independently'
);
select is(
  (select count(distinct security_class_identity ->> 'canonicalKey')::integer
   from public.share_count_history where issuer_cik = '0000000099' and security_class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'),
  2, 'multi-class identities remain separate without summing or winner selection'
);
select is(
  (select count(distinct canonical_security_class_id)::integer
   from public.share_count_history where issuer_cik = '0000000099'
     and security_class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'),
  2, 'Class A and Class B have distinct source-independent canonical identities'
);

select throws_ok(
  $$select pg_temp.insert_share_history('0000000099-26-000001', '2026-08-01', 0, repeat('e', 64), 'bad-shares', '2026-08-20', '2026-08-20 12:00:00+00')$$,
  '23514', null, 'non-positive shares fail closed'
);
select throws_ok(
  $$select pg_temp.insert_share_history('0000000099-26-000001', '2026-08-01', 1, repeat('f', 64), 'non-eligible', '2026-08-20', '2026-08-20 12:00:00+00', 'SINGLE_COMMON_STOCK_CLASS', '{"canonicalKey":"single","identity":"dei:EntityCommonStockSharesOutstanding@required-context"}'::jsonb, '[]'::jsonb, 'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT', 'REQUIRES_FURTHER_CONTEXT')$$,
  '23514', null, 'REQUIRES_FURTHER_CONTEXT fails closed at the database'
);
select throws_ok(
  $$select pg_temp.insert_share_history('0000000099-26-000001', '2026-08-01', 1, repeat('f', 64), 'unavailable', '2026-08-20', '2026-08-20 12:00:00+00', 'SINGLE_COMMON_STOCK_CLASS', '{"canonicalKey":"single","identity":"dei:EntityCommonStockSharesOutstanding@required-context"}'::jsonb, '[]'::jsonb, 'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT', 'UNAVAILABLE')$$,
  '23514', null, 'UNAVAILABLE fails closed at the database'
);
select throws_ok(
  $$update public.share_count_history set source_provenance = '{}'::jsonb where issuer_cik = '0000000099'$$,
  '23514', null, 'incomplete IXDS/CompanyFacts provenance fails closed'
);
select throws_ok(
  $$update public.share_count_history set security_class_identity = '{}'::jsonb where issuer_cik = '0000000099'$$,
  '23514', null, 'unresolved security-class identity fails closed'
);
select throws_ok(
  $$update public.share_count_history set accepted_at_source = 'unavailable' where source_type = 'sec_filing_text_level2'$$,
  '23514', null, 'published/filed fallback cannot coexist with a non-null accepted_at'
);

select is(
  (select jsonb_array_length(source_provenance -> 'companyFacts') from public.share_count_history where source_fact_key = repeat('a', 64)),
  1, 'CompanyFacts provenance round-trips'
);
select is(
  (select source_context #>> '{period,instant}' from public.share_count_history where source_fact_key = repeat('a', 64)),
  '2026-08-01', 'fact/context provenance round-trips'
);
select ok(
  (select as_of = '2026-08-01'::date
          and filed_date = '2026-08-20'::date
          and accepted_at = '2026-08-20 12:00:00+00'::timestamptz
          and ingested_at = '2026-08-22 01:02:03+00'::timestamptz
   from public.share_count_history where source_fact_key = repeat('a', 64)),
  'all four event/collection timestamps remain distinct and exact'
);

delete from public.share_count_history where issuer_cik = '0000000099';
select is(
  (select count(*)::integer from public.share_count_history where issuer_cik = '0000000099'),
  0, 'local acceptance cleanup leaves fixture history rows zero'
);
delete from public.sec_filing_ledger where issuer_cik = '0000000099';
delete from public.sec_issuers where cik = '0000000099';
delete from public.sec_structured_raw_sources where cik = '0000000099';

select * from finish();
rollback;
