\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table(
  'public',
  'dilution_corporate_action_adjustments',
  'append-only dilution Corporate Action projection table exists'
);

select has_function(
  'public',
  'append_dilution_corporate_action_adjustment_v1',
  array['jsonb'],
  'idempotent projection append RPC exists'
);

select ok(
  not (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.append_dilution_corporate_action_adjustment_v1(jsonb)'::regprocedure
  ),
  'projection append RPC is SECURITY INVOKER'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.append_dilution_corporate_action_adjustment_v1(jsonb)'::regprocedure
  ),
  array['search_path=""']::text[],
  'projection append RPC uses an empty search_path'
);

select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'public.dilution_corporate_action_adjustments'::regclass),
  'projection table has RLS enabled'
);

select ok(
  pg_catalog.has_table_privilege(
    'service_role', 'public.dilution_corporate_action_adjustments', 'select,insert'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'public.dilution_corporate_action_adjustments', 'update,delete'
  )
  and not pg_catalog.has_table_privilege(
    'anon', 'public.dilution_corporate_action_adjustments', 'select,insert,update,delete'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.dilution_corporate_action_adjustments', 'select,insert,update,delete'
  ),
  'only service_role can select and append; no runtime role can mutate history'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.append_dilution_corporate_action_adjustment_v1(jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.append_dilution_corporate_action_adjustment_v1(jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.append_dilution_corporate_action_adjustment_v1(jsonb)',
    'execute'
  ),
  'only service_role can execute projection append RPC'
);

insert into public.dilution_instruments (
  instrument_key, issuer_cik, instrument_type, name
) values (
  'adjustment-test-warrant', '0001829635', 'warrant', 'Adjustment Test Warrant'
);

insert into public.dilution_instrument_snapshots (
  instrument_id,
  as_of_date,
  status,
  remaining_units,
  exercise_price,
  remaining_amount
)
select id, '2023-12-04', 'current', 300000, 0.3025, 90750
from public.dilution_instruments
where instrument_key = 'adjustment-test-warrant';

create temporary table adjustment_test_payloads as
select
  instrument.id::text as instrument_id,
  snapshot.id::text as snapshot_id,
  pg_catalog.jsonb_build_object(
    'version', 'dilution-corporate-action-adjustment-v1',
    'projectionId', 'dca:v1:' || pg_catalog.repeat('a', 64),
    'issuerCik', instrument.issuer_cik,
    'instrumentKey', instrument.instrument_key,
    'instrumentId', instrument.id::text,
    'baseSnapshotId', snapshot.id::text,
    'canonicalSecurityClassId', 'sc:v1:0001829635:common_stock:single',
    'asOfDate', snapshot.as_of_date::text,
    'effectiveDate', '2024-01-16',
    'executionIds', pg_catalog.jsonb_build_array(
      'rse:v1:' || pg_catalog.repeat('b', 64)
    ),
    'supersedesProjectionId', null,
    'originalFields', pg_catalog.jsonb_build_object(
      'remaining_units', '300000',
      'exercise_price', '0.3025'
    ),
    'adjustedFields', pg_catalog.jsonb_build_object(
      'remaining_units', '7500',
      'exercise_price', '12.1'
    ),
    'fieldEvidence', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'field', 'remaining_units',
        'executionId', 'rse:v1:' || pg_catalog.repeat('b', 64),
        'contractAccession', '0001104659-23-123274',
        'sourceDocumentUrl', 'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm',
        'evidenceIdentity', pg_catalog.jsonb_build_object(
          'version', 'corporate_action_evidence_identity_v1',
          'source_ref', 'rnaz_placement_warrant',
          'range_start', 0,
          'range_end', 10,
          'source_content_hash', pg_catalog.repeat('c', 64),
          'exact_source', true
        )
      )
    ),
    'status', 'APPLIED',
    'reviewReason', null
  ) as applied
from public.dilution_instruments as instrument
join public.dilution_instrument_snapshots as snapshot
  on snapshot.instrument_id = instrument.id
where instrument.instrument_key = 'adjustment-test-warrant';

insert into public.sources (code, name, source_group, runtime_owner)
values ('sec_edgar', 'SEC EDGAR', 'filings', 'external')
on conflict (code) do nothing;

insert into public.raw_items (
  id, source_code, source_group, source_unique_id, source_url,
  body_text, raw_payload, metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'sec_edgar',
  'filings',
  '0001104659-23-123274',
  'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm',
  'the Exercise Price shall be multiplied by a fraction',
  pg_catalog.jsonb_build_object(
    'accession_number', '0001104659-23-123274',
    'cik', '1829635',
    'primary_document_url', 'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm'
  ),
  pg_catalog.jsonb_build_object('cik', '1829635')
);

create temporary table adjustment_binding_payloads as
select pg_catalog.jsonb_build_object(
  'version', 'dilution-corporate-action-clause-binding-v1',
  'bindingId', 'dcab:v1:' || pg_catalog.repeat('f', 64),
  'issuerCik', '0001829635',
  'instrumentKey', 'adjustment-test-warrant',
  'executionId', 'rse:v1:' || pg_catalog.repeat('b', 64),
  'canonicalSecurityClassId', 'sc:v1:0001829635:common_stock:single',
  'contractAccession', '0001104659-23-123274',
  'contractRawItemId', '11111111-1111-4111-8111-111111111111',
  'sourceRef', 'sec-raw:v1:11111111-1111-4111-8111-111111111111:' ||
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm',
      'UTF8'
    ), 'sha256'), 'hex'),
  'sourceDocumentUrl', 'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm',
  'fieldAdjustments', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'field', 'exercise_price',
    'operation', 'divide_by_split_ratio',
    'evidenceIdentity', pg_catalog.jsonb_build_object(
      'version', 'corporate_action_evidence_identity_v1',
      'source_ref', 'sec-raw:v1:11111111-1111-4111-8111-111111111111:' ||
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          'https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm',
          'UTF8'
        ), 'sha256'), 'hex'),
      'range_start', 0,
      'range_end', pg_catalog.length('the Exercise Price shall be multiplied by a fraction'),
      'source_content_hash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        'the Exercise Price shall be multiplied by a fraction', 'UTF8'
      ), 'sha256'), 'hex'),
      'exact_source', true
    )
  )),
  'supersedesBindingId', null
) as binding;

select lives_ok(
  $$insert into public.dilution_instruments (
      instrument_key, issuer_cik, instrument_type, name
    ) values
      ('adjustment-test-option', '0001058090', 'stock_option', 'Stock Option'),
      ('adjustment-test-award', '0001058090', 'equity_award', 'Equity Award'),
      ('adjustment-test-reserve', '0001058090', 'share_reserve', 'Plan Reserve')$$,
  'registry accepts live stock-option, equity-award, and share-reserve conditions'
);

grant select on adjustment_test_payloads to service_role;
grant select on adjustment_binding_payloads to service_role;

set local role service_role;

select is(
  (select public.append_dilution_corporate_action_clause_binding_v1(binding)->>'added'
   from adjustment_binding_payloads),
  '1',
  'reviewed exact SEC clause binding appends through its service-only RPC'
);

select is(
  public.read_dilution_corporate_action_context_v1('0001829635')
    #>> '{source_documents,0,text}',
  'the Exercise Price shall be multiplied by a fraction',
  'production context reader returns the exact persisted SEC contract document'
);

select is(
  (select public.append_dilution_corporate_action_adjustment_v1(applied)->>'added'
   from adjustment_test_payloads),
  '1',
  'first valid projection append adds one row'
);

select is(
  (select public.append_dilution_corporate_action_adjustment_v1(applied)->>'already_saved'
   from adjustment_test_payloads),
  'true',
  'exact replay is an idempotent already-saved result'
);

select is(
  (select count(*)::integer
   from public.dilution_corporate_action_adjustments
   where projection_id = 'dca:v1:' || pg_catalog.repeat('a', 64)),
  1,
  'replay creates zero duplicate adjustment rows'
);

reset role;
update public.dilution_instrument_snapshots
set status = 'old'
where id = (select snapshot_id::bigint from adjustment_test_payloads);
set local role service_role;

select is(
  (select public.append_dilution_corporate_action_adjustment_v1(applied)->>'already_saved'
   from adjustment_test_payloads),
  'true',
  'exact replay remains idempotent after its base snapshot becomes old'
);

select throws_ok(
  $$select public.append_dilution_corporate_action_adjustment_v1(
    jsonb_set(
      (select applied from adjustment_test_payloads),
      '{effectiveDate}',
      '"2024-01-17"'::jsonb
    )
  )$$,
  '23514',
  'dilution corporate action projection identity payload mismatch',
  'an existing projection identity with a different payload fails after base closure'
);

select throws_ok(
  $$select public.append_dilution_corporate_action_adjustment_v1(
    jsonb_set(
      (select applied from adjustment_test_payloads),
      '{projectionId}',
      to_jsonb('dca:v1:' || repeat('e', 64))
    )
  )$$,
  '23514',
  'dilution corporate action base snapshot is not a matching live instrument state',
  'a genuinely new projection cannot target an old base snapshot'
);

reset role;
update public.dilution_instrument_snapshots
set status = 'current'
where id = (select snapshot_id::bigint from adjustment_test_payloads);
set local role service_role;

select results_eq(
  $$select remaining_units::text, exercise_price::text, remaining_amount::text
    from public.dilution_instrument_snapshots
    where id = (select snapshot_id::bigint from adjustment_test_payloads)$$,
  $$values ('300000', '0.3025', '90750')$$,
  'original historical snapshot and dollar amount remain unchanged'
);

select throws_ok(
  $$select public.append_dilution_corporate_action_adjustment_v1(
    jsonb_set(
      jsonb_set(
        (select applied from adjustment_test_payloads),
        '{projectionId}',
        to_jsonb('dca:v1:' || pg_catalog.repeat('8', 64))
      ),
      '{adjustedFields}',
      '{"remaining_amount":"1"}'::jsonb
    )
  )$$,
  '22023',
  'dilution corporate action projection fields or execution identity are invalid',
  'dollar-only fields cannot enter an adjustment projection'
);

select throws_ok(
  $$select public.append_dilution_corporate_action_adjustment_v1(
    jsonb_set(
      (select applied - 'reviewReason' from adjustment_test_payloads),
      '{projectionId}',
      to_jsonb('dca:v1:' || pg_catalog.repeat('9', 64))
    )
  )$$,
  '22023',
  'dilution corporate action applied or review state is invalid',
  'APPLIED projections require an explicit null review reason'
);

select is(
  public.append_dilution_corporate_action_adjustment_v1(
    pg_catalog.jsonb_build_object(
      'version', 'dilution-corporate-action-adjustment-v1',
      'projectionId', 'dca:v1:' || pg_catalog.repeat('d', 64),
      'issuerCik', '0001829635',
      'instrumentKey', 'adjustment-test-warrant',
      'instrumentId', (select instrument_id from adjustment_test_payloads),
      'baseSnapshotId', (select snapshot_id from adjustment_test_payloads),
      'canonicalSecurityClassId', 'sc:v1:0001829635:common_stock:single',
      'asOfDate', '2023-12-04',
      'effectiveDate', null,
      'executionIds', '[]'::jsonb,
      'supersedesProjectionId', 'dca:v1:' || pg_catalog.repeat('a', 64),
      'originalFields', '{}'::jsonb,
      'adjustedFields', '{}'::jsonb,
      'fieldEvidence', '[]'::jsonb,
      'status', 'REVIEW',
      'reviewReason', 'EXECUTION_CONFLICT'
    )
  )->>'added',
  '1',
  'Review replacement appends without mutating its historical predecessor'
);

select is(
  (select count(*)::integer from public.dilution_corporate_action_adjustments),
  2,
  'applied and Review states both remain in append-only history'
);

select results_eq(
  $$select status, review_reason
    from public.dilution_corporate_action_adjustments as adjustment
    where not exists (
      select 1
      from public.dilution_corporate_action_adjustments as replacement
      where replacement.supersedes_projection_id = adjustment.projection_id
    )$$,
  $$values ('REVIEW'::text, 'EXECUTION_CONFLICT'::text)$$,
  'deterministic supersession selects the Review state as current'
);

reset role;

select * from finish();
rollback;
