begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table(
  'public',
  'issuer_common_class_universe_snapshots',
  'issuer common-class universe snapshot history exists'
);
select has_column(
  'public',
  'issuer_common_class_universe_snapshots',
  'required_canonical_security_class_ids',
  'required canonical common classes are persisted'
);
select has_column(
  'public',
  'issuer_common_class_universe_snapshots',
  'completeness_provenance',
  'filing completeness provenance is persisted'
);
select has_column(
  'public',
  'issuer_common_class_universe_snapshots',
  'accepted_at',
  'event-time availability is persisted separately'
);
select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'public.issuer_common_class_universe_snapshots'::regclass),
  'universe snapshot history has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'public.issuer_common_class_universe_snapshots', 'select,insert,update,delete'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.issuer_common_class_universe_snapshots', 'select,insert,update,delete'
  )
  and not pg_catalog.has_sequence_privilege(
    'anon', 'public.issuer_common_class_universe_snapshots_id_seq', 'usage'
  )
  and not pg_catalog.has_sequence_privilege(
    'authenticated', 'public.issuer_common_class_universe_snapshots_id_seq', 'usage'
  ),
  'browser roles have no direct table or sequence access'
);
select ok(
  pg_catalog.has_table_privilege(
    'service_role', 'public.issuer_common_class_universe_snapshots', 'select,insert'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'public.issuer_common_class_universe_snapshots', 'update,delete'
  )
  and pg_catalog.has_sequence_privilege(
    'service_role', 'public.issuer_common_class_universe_snapshots_id_seq', 'usage,select'
  ),
  'service role has append/read-only table privileges'
);

insert into public.sec_structured_raw_sources (
  id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
  content_hash, raw_content_kind, raw_content, payload
) values (
  '97000000-0000-5000-8000-000000000001',
  'submissions',
  'https://data.sec.gov/submissions/CIK0000000097.json',
  'issuer-common-class-universe:fixture',
  '0000000097',
  '2026-08-22 10:00:00+00',
  '2026-08-22 10:00:01+00',
  repeat('7', 64),
  'injected_exact_body',
  '{"fixture":true}',
  '{"fixture":true}'::jsonb
) on conflict do nothing;

insert into public.sec_issuers (cik)
values ('0000000097')
on conflict do nothing;

insert into public.sec_filing_ledger (
  accession_number, issuer_cik, form, filed_date, accepted_at,
  primary_document, is_xbrl, is_inline_xbrl, source_raw_id, ingested_at
) values
  (
    '0000000097-26-000001', '0000000097', '10-Q', '2026-08-01',
    '2026-08-01 12:00:00+00', 'single.htm', true, true,
    '97000000-0000-5000-8000-000000000001', '2026-08-01 12:01:00+00'
  ),
  (
    '0000000097-26-000002', '0000000097', '10-Q', '2026-11-01',
    '2026-11-01 12:00:00+00', 'multi.htm', true, true,
    '97000000-0000-5000-8000-000000000001', '2026-11-01 12:01:00+00'
  ),
  (
    '0000000097-26-000003', '0000000097', '10-Q', '2026-11-02',
    '2026-11-02 12:00:00+00', 'incomplete.htm', true, true,
    '97000000-0000-5000-8000-000000000001', '2026-11-02 12:01:00+00'
  )
on conflict do nothing;

create function pg_temp.insert_universe_snapshot(
  p_accession text,
  p_filed_date date,
  p_as_of date,
  p_accepted_at timestamptz,
  p_status text,
  p_classes text[],
  p_hash text,
  p_evidence jsonb
) returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  insert into public.issuer_common_class_universe_snapshots (
    snapshot_version, issuer_cik, universe_as_of, accepted_at,
    source_accession, source_form, source_filed_date, source_documents,
    status, reason, required_canonical_security_class_ids, class_evidence,
    aggregate_evidence, excluded_evidence, completeness_provenance,
    source_identity_hash
  ) values (
    'issuer-common-class-universe-snapshot-v1',
    '0000000097',
    p_as_of,
    p_accepted_at,
    p_accession,
    '10-Q',
    p_filed_date,
    array['primary.htm'],
    p_status,
    case p_status
      when 'COMPLETE_SINGLE' then 'COMPLETE_SINGLE_COMMON_STOCK'
      when 'COMPLETE_MULTI' then 'COMPLETE_MULTI_COMMON_STOCK'
      else 'FILING_CONTEXT_INCOMPLETE'
    end,
    p_classes,
    p_evidence,
    '[]'::jsonb,
    '[]'::jsonb,
    '{"sourceContract":"authoritative-os-extraction-v1","historicalClassUnionUsed":false}'::jsonb,
    p_hash
  ) on conflict on constraint issuer_common_class_universe_source_unique do nothing;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select is(
  pg_temp.insert_universe_snapshot(
    '0000000097-26-000001', '2026-08-01', '2026-06-30', '2026-08-01 12:00:00+00',
    'COMPLETE_SINGLE',
    array['sc:v1:0000000097:common_stock:single'],
    repeat('a', 64),
    '[{"canonicalSecurityClassId":"sc:v1:0000000097:common_stock:single","sharesOutstanding":"100","sourceFacts":[]}]'::jsonb
  ),
  1,
  'complete-single snapshot appends'
);
select is(
  pg_temp.insert_universe_snapshot(
    '0000000097-26-000001', '2026-08-01', '2026-06-30', '2026-08-01 12:00:00+00',
    'COMPLETE_SINGLE',
    array['sc:v1:0000000097:common_stock:single'],
    repeat('a', 64),
    '[{"canonicalSecurityClassId":"sc:v1:0000000097:common_stock:single","sharesOutstanding":"100","sourceFacts":[]}]'::jsonb
  ),
  0,
  'same filing snapshot replay inserts zero rows'
);
select is(
  pg_temp.insert_universe_snapshot(
    '0000000097-26-000002', '2026-11-01', '2026-09-30', '2026-11-01 12:00:00+00',
    'COMPLETE_MULTI',
    array[
      'sc:v1:0000000097:common_stock:us-gaap:CommonClassAMember',
      'sc:v1:0000000097:common_stock:us-gaap:CommonClassBMember'
    ],
    repeat('b', 64),
    '[{"canonicalSecurityClassId":"sc:v1:0000000097:common_stock:us-gaap:CommonClassAMember","sharesOutstanding":"60","sourceFacts":[]},{"canonicalSecurityClassId":"sc:v1:0000000097:common_stock:us-gaap:CommonClassBMember","sharesOutstanding":"40","sourceFacts":[]}]'::jsonb
  ),
  1,
  'complete-multi snapshot appends separately'
);
select is(
  (select count(*)::integer
   from public.issuer_common_class_universe_snapshots
   where issuer_cik = '0000000097'),
  2,
  'time-versioned single and multi snapshots are both retained'
);
select is(
  (select pg_catalog.cardinality(required_canonical_security_class_ids)
   from public.issuer_common_class_universe_snapshots
   where status = 'COMPLETE_MULTI'),
  2,
  'complete-multi snapshot preserves the exact required class list'
);
select ok(
  (select completeness_provenance ->> 'historicalClassUnionUsed' = 'false'
   from public.issuer_common_class_universe_snapshots
   where status = 'COMPLETE_MULTI'),
  'snapshot provenance explicitly rejects historical class union completeness'
);

select throws_ok(
  $$select pg_temp.insert_universe_snapshot(
    '0000000097-26-000003', '2026-11-02', '2026-09-30', '2026-11-02 12:00:00+00',
    'INCOMPLETE', array['sc:v1:0000000097:common_stock:single'], repeat('c', 64), '[]'::jsonb
  )$$,
  '23514',
  null,
  'incomplete snapshots cannot expose required classes'
);
select throws_ok(
  $$select pg_temp.insert_universe_snapshot(
    '0000000097-26-000003', '2026-11-02', '2026-09-30', '2026-11-02 12:00:00+00',
    'COMPLETE_MULTI', array['sc:v1:0000000097:common_stock:us-gaap:CommonClassAMember'], repeat('d', 64),
    '[{"canonicalSecurityClassId":"sc:v1:0000000097:common_stock:us-gaap:CommonClassAMember","sharesOutstanding":"100","sourceFacts":[]}]'::jsonb
  )$$,
  '23514',
  null,
  'complete-multi snapshots require at least two classes'
);
select throws_ok(
  $$insert into public.issuer_common_class_universe_snapshots (
    snapshot_version, issuer_cik, universe_as_of, accepted_at,
    source_accession, source_form, source_filed_date, source_documents,
    status, reason, required_canonical_security_class_ids, class_evidence,
    aggregate_evidence, excluded_evidence, completeness_provenance, source_identity_hash
  ) values (
    'issuer-common-class-universe-snapshot-v1', '0000000097', '2026-09-30',
    '2026-11-01 12:00:00+00', '0000000097-26-999999', '10-Q', '2026-11-01',
    array['missing.htm'], 'INCOMPLETE', 'FILING_CONTEXT_INCOMPLETE', '{}'::text[],
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{"historicalClassUnionUsed":false}'::jsonb, repeat('e', 64)
  )$$,
  '23503',
  null,
  'snapshot source must resolve to the exact filing ledger identity'
);

select is(
  (select count(*)::integer from public.share_count_history where issuer_cik = '0000000097'),
  0,
  'snapshot persistence does not synthesize or mutate share-count observations'
);

select * from finish();
rollback;
