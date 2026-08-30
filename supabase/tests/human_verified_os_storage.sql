begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.sec_structured_raw_sources (
  id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
  content_hash, source_schema_version, raw_content_kind, raw_content, payload
) values
  (
    'a1000000-0000-4000-8000-000000000001', 'submissions',
    'https://data.sec.gov/submissions/CIK0001840317.json', 'human-os:test:submissions',
    '0001840317', '2026-06-26 21:10:00+00', '2026-06-26 21:10:01+00',
    repeat('1', 64), null, 'injected_exact_body', '{}', '{}'::jsonb
  ),
  (
    'a1000000-0000-4000-8000-000000000002', 'filing_xbrl',
    'https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm',
    'https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm',
    '0001840317', '2026-06-26 21:12:00+00', '2026-06-26 21:12:00+00',
    repeat('2', 64), 'filing-xbrl-context-v1', 'authoritative_http_body',
    '<html>exact SEC primary document fixture</html>',
    '{"accession":"0001213900-26-072701","role":"primary_document","document_name":"ea0295954-s3_veea.htm","content_type":"text/html"}'::jsonb
  )
on conflict do nothing;

insert into public.sec_issuers (cik) values ('0001840317') on conflict do nothing;

insert into public.sec_filing_ledger (
  accession_number, issuer_cik, form, filed_date, accepted_at, primary_document,
  is_xbrl, is_inline_xbrl, source_raw_id, source_kind, ingested_at
) values (
  '0001213900-26-072701', '0001840317', 'S-3', '2026-06-26',
  '2026-06-26 21:09:26+00', 'ea0295954-s3_veea.htm', true, true,
  'a1000000-0000-4000-8000-000000000001', 'submissions', '2026-06-26 21:10:01+00'
) on conflict do nothing;

create function pg_temp.insert_human_os(
  p_approval_user text default 'a1000000-0000-4000-8000-000000000003',
  p_observation_type text default 'source_stated',
  p_verifier_status text default 'Verified'
) returns integer
language plpgsql
as $$
declare
  affected integer;
  fact_key text := repeat('3', 64);
  evidence text := 'based on 55,116,953 shares of common stock outstanding, as of June 24, 2026';
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
    p_observation_type, '0001840317', 55116953, '2026-06-24',
    'SOURCE_STATED_SECURITY_CLASS',
    '{"canonicalKey":"SOURCE_STATED_SECURITY_CLASS|fixture","identity":{"title":"common stock"}}'::jsonb,
    pg_catalog.jsonb_build_object(
      'sourceRef', 'ea0295954-s3_veea.htm', 'evidence', evidence,
      'sourceDeclaredClassKind', 'common_stock',
      'canonicalSecurityClassId', 'sc:v1:0001840317:common_stock:single'),
    'sc:v1:0001840317:common_stock:single', 'common_stock', 'mapped',
    '{"method":"complete_single_common_stock_snapshot","titleSimilarityUsed":false}'::jsonb,
    'shares_outstanding:source_stated',
    '{"measurement":"shares_outstanding","unit":{"kind":"shares","representation":"positive_integer"}}'::jsonb,
    '0001213900-26-072701', 'S-3', 'ea0295954-s3_veea.htm', '2026-06-26',
    '2026-06-26 21:09:26+00', 'sec_filing_ledger',
    '{"source":"sec_filing_ledger.accepted_at"}'::jsonb,
    '2026-06-26 21:31:00+00', null, null, fact_key,
    'ea0295954-s3_veea.htm', 'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'factKey', fact_key, 'sourceRef', 'ea0295954-s3_veea.htm',
      'accession', '0001213900-26-072701', 'documentName', 'ea0295954-s3_veea.htm',
      'artifactId', 'a1000000-0000-4000-8000-000000000002',
      'observationType', 'source_stated'),
    '{"sourceRef":"ea0295954-s3_veea.htm","asOf":"2026-06-24","issuerCik":"0001840317"}'::jsonb,
    '[]'::jsonb,
    pg_catalog.jsonb_build_object(
      'filingLedgerRawSourceId', 'a1000000-0000-4000-8000-000000000001',
      'secArtifact', pg_catalog.jsonb_build_object(
        'artifactId', 'a1000000-0000-4000-8000-000000000002',
        'documentName', 'ea0295954-s3_veea.htm',
        'sourceUrl', 'https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm',
        'contentHash', repeat('2', 64), 'rawContentKind', 'authoritative_http_body'),
      'approval', pg_catalog.jsonb_build_object(
        'approver_user_id', p_approval_user, 'approved_at', '2026-06-26T21:30:00.000Z'),
      'verifier', pg_catalog.jsonb_build_object(
        'status', p_verifier_status, 'sourceCheck', 'Exact official SEC filing verified.'),
      'classUniverse', pg_catalog.jsonb_build_object(
        'status', 'COMPLETE_SINGLE', 'reason', 'COMPLETE_SINGLE_COMMON_STOCK',
        'sourceIdentityHash', repeat('4', 64), 'universeAsOf', '2026-05-13',
        'sourceAccession', '0001213900-26-057059',
        'canonicalSecurityClassId', 'sc:v1:0001840317:common_stock:single',
        'futureSnapshotUsed', false)),
    'sec_filing_text_human_verified', null, null, null, null,
    'https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm',
    repeat('2', 64), evidence, null
  ) on conflict on constraint share_count_history_canonical_source_unique do nothing;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select is(pg_temp.insert_human_os(), 1, 'human-verified source-stated SEC observation inserts once');
select is(pg_temp.insert_human_os(), 0, 'exact human-verified replay inserts zero rows');

select throws_ok(
  $$select pg_temp.insert_human_os('browser-supplied-plan')$$,
  '23514', null,
  'invalid approval UUID is rejected by the database contract'
);
select throws_ok(
  $$select pg_temp.insert_human_os('a1000000-0000-4000-8000-000000000003', 'authoritative_xbrl')$$,
  '23514', null,
  'human-verified source requires source_stated observation semantics'
);
select throws_ok(
  $$select pg_temp.insert_human_os('a1000000-0000-4000-8000-000000000003', 'source_stated', 'Review')$$,
  '23514', null,
  'only a Verified server result satisfies the database provenance contract'
);

select * from finish();
rollback;
