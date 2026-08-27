begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.review_evidence(p_accession text, p_seed text)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_evidence_identity_v1',
    'source_ref', 'review-source:' || p_accession || ':0',
    'range_start', 0,
    'range_end', 18,
    'source_content_hash', pg_catalog.repeat(p_seed, 64),
    'exact_source', true
  )
$$;

create function pg_temp.review_claim(
  p_accession text,
  p_kind text,
  p_value text,
  p_seed text default 'a'
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_identity_claim_v1',
    'claim_kind', p_kind,
    'value', p_value,
    'semantic_role', null,
    'evidence_identity', pg_temp.review_evidence(p_accession, p_seed)
  )
$$;

create function pg_temp.review_observation(
  p_issuer text,
  p_accession text,
  p_claim_value text,
  p_seed text default 'a'
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_source_observation_v1',
    'issuer_cik', p_issuer,
    'accession', p_accession,
    'form', '8-K',
    'filed_date', '2026-08-28',
    'accepted_at', null,
    'analysis_lineage', null,
    'exposure_id', null,
    'exposure_type', 'warrant',
    'observation_kind', 'exposure_identity',
    'observed_fields', '[]'::jsonb,
    'identity_claims', pg_catalog.jsonb_build_array(
      pg_temp.review_claim(p_accession, 'series_or_designation', p_claim_value, p_seed)
    ),
    'status', 'VALIDATED'
  )
$$;

create function pg_temp.review_resolution(
  p_accession text,
  p_seed text,
  p_decision text,
  p_reason text
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_identity_decision_v1',
    'resolver_version', 'economic_exposure_identity_resolver_v1',
    'decision', p_decision,
    'reason_code', p_reason,
    'target_exposure_id', null,
    'identity_claim_kinds', pg_catalog.jsonb_build_array('series_or_designation'),
    'identity_evidence', pg_catalog.jsonb_build_array(pg_temp.review_evidence(p_accession, p_seed)),
    'matched_strong_claims', '[]'::jsonb,
    'conflicting_strong_claims', '[]'::jsonb,
    'independent_strong_claims', '[]'::jsonb,
    'supporting_evidence_references', pg_catalog.jsonb_build_array(pg_temp.review_evidence(p_accession, p_seed)),
    'supporting_registration_matches', '[]'::jsonb,
    'candidate_exposure_identity', null
  )
$$;

create function pg_temp.review_decision(
  p_context jsonb,
  p_decision text,
  p_target text default null
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'review_case_id', p_context->>'review_case_id',
    'input_hash', p_context->>'input_hash',
    'decision', p_decision,
    'target_exposure_id', p_target,
    'confidence', 'HIGH',
    'reason', 'Source-backed identity evidence supports this final human adjudication.',
    'evidence_refs', pg_catalog.jsonb_build_array(p_context#>>'{allowed_evidence_refs,0}'),
    'sources_checked', pg_catalog.jsonb_build_array(
      p_context#>>'{review_observation,accession}',
      'https://www.sec.gov/Archives/edgar/data/' ||
        pg_catalog.ltrim((p_context#>>'{issuer,cik}'), '0') || '/' ||
        pg_catalog.replace((p_context#>>'{review_observation,accession}'), '-', '') || '/' ||
        (p_context#>>'{review_observation,accession}') || '-index.html'
    )
  ))
$$;

select has_table(
  'public', 'dilution_identity_adjudications_v1',
  'append-only dilution identity adjudication table exists'
);
select has_function(
  'public', 'read_dilution_identity_review_case_v1', array['text'],
  'review packet context reader exists'
);
select has_function(
  'public', 'list_dilution_identity_review_cases_v1', array['integer'],
  'review case list reader exists'
);
select has_function(
  'public', 'read_effective_dilution_identity_decision_v1', array['text'],
  'effective identity decision reader exists'
);
select has_function(
  'public', 'apply_dilution_identity_review_v1', array['text', 'jsonb', 'uuid'],
  'atomic human apply function exists'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.dilution_identity_adjudications_v1'::regclass),
  'adjudication table has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.dilution_identity_adjudications_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_identity_adjudications_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('service_role', 'public.dilution_identity_adjudications_v1', 'select,insert,update,delete'),
  'no Data API role has direct adjudication table access'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.apply_dilution_identity_review_v1(text,jsonb,uuid)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.apply_dilution_identity_review_v1(text,jsonb,uuid)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.apply_dilution_identity_review_v1(text,jsonb,uuid)', 'execute'),
  'only service_role can execute final Apply'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.apply_dilution_identity_review_v1(text,jsonb,uuid)'::regprocedure),
  'Apply is SECURITY DEFINER with a pinned empty search_path'
);

delete from public.dilution_identity_adjudications_v1;
delete from public.dilution_source_observations_v1;
delete from public.dilution_economic_exposure_registry_v1;
insert into public.sec_issuers(cik)
values ('0001111111'), ('0002222222'), ('0003333333')
on conflict do nothing;

create temporary table review_fixture (
  name text primary key,
  observation_key text,
  exposure_id text,
  context jsonb,
  decision jsonb,
  result jsonb
);

-- Existing same-issuer target.
insert into review_fixture(name, result)
select 'issuer_a_exposure', public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0001111111', '0001111111-26-000001', 'Series A Warrants', 'a'),
  pg_temp.review_resolution(
    '0001111111-26-000001', 'a', 'CREATE_NEW',
    'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY'
  )
);
update review_fixture
set exposure_id = result->>'target_exposure_id'
where name = 'issuer_a_exposure';

-- Existing other-issuer target.
insert into review_fixture(name, result)
select 'issuer_b_exposure', public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0002222222', '0002222222-26-000001', 'Series B Warrants', 'b'),
  pg_temp.review_resolution(
    '0002222222-26-000001', 'b', 'CREATE_NEW',
    'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY'
  )
);
update review_fixture
set exposure_id = result->>'target_exposure_id'
where name = 'issuer_b_exposure';

-- A. Persist the machine original as UNRESOLVED, then prepare LINK_EXISTING.
insert into review_fixture(name, result)
select 'unresolved', public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0001111111', '0001111111-26-000002', 'Series A Warrants', 'c'),
  pg_temp.review_resolution(
    '0001111111-26-000002', 'c', 'UNRESOLVED',
    'INSUFFICIENT_SOURCE_BACKED_IDENTITY'
  )
);
update review_fixture
set observation_key = result->>'observation_key'
where name = 'unresolved';
update review_fixture
set context = public.read_dilution_identity_review_case_v1(observation_key)
where name = 'unresolved';
update review_fixture
set decision = pg_temp.review_decision(
  context,
  'LINK_EXISTING',
  (select exposure_id from review_fixture where name = 'issuer_a_exposure')
)
where name = 'unresolved';
update review_fixture
set decision = decision || pg_catalog.jsonb_build_object(
  'suggested_corrections', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'field', 'current_stock_radar_analysis.source_backed_claims[0]',
      'suggestion', 'Check the structured identity value against the cited SEC exhibit.',
      'reason', 'Structured claim values are not represented as verbatim SEC quotes.'
    )
  )
)
where name = 'unresolved';

select is(
  (select count(*)::integer from public.dilution_identity_adjudications_v1),
  0,
  'packet generation and preview inputs create no adjudication'
);
select is(
  (select count(*)::integer from public.dilution_economic_exposure_registry_v1),
  2,
  'packet generation creates no canonical exposure'
);
select is(
  (select context#>>'{review_observation,resolver_original,decision}'
   from review_fixture where name = 'unresolved'),
  'UNRESOLVED',
  'review packet exposes the original resolver decision'
);
select ok(
  (select pg_catalog.jsonb_array_length(context->'existing_economic_exposures') = 1
    and pg_catalog.jsonb_array_length(context->'identity_observation_history') >= 2
    and pg_catalog.jsonb_array_length(context->'allowed_evidence_refs') >= 1
   from review_fixture where name = 'unresolved'),
  'review packet carries same-issuer registry, history, and evidence references'
);

-- C. Other issuer target fails closed.
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'unresolved'),
    pg_temp.review_decision(
      (select context from review_fixture where name = 'unresolved'),
      'LINK_EXISTING',
      (select exposure_id from review_fixture where name = 'issuer_b_exposure')
    ),
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '23514',
  'REVIEW_TARGET_ISSUER_MISMATCH',
  'LINK target from another issuer is rejected'
);

-- D. Missing target fails closed.
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'unresolved'),
    pg_temp.review_decision(
      (select context from review_fixture where name = 'unresolved'),
      'LINK_EXISTING',
      'economic-exposure:v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    ),
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '23503',
  'REVIEW_TARGET_NOT_FOUND',
  'nonexistent LINK target is rejected'
);

-- G. Mismatched review case fails closed.
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'unresolved'),
    (select decision || pg_catalog.jsonb_build_object(
      'review_case_id', 'dilution-review-case:v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    ) from review_fixture where name = 'unresolved'),
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '22023',
  'REVIEW_CASE_ID_MISMATCH',
  'review_case_id mismatch is rejected'
);

-- F at the DB boundary: malformed decision object is rejected before writes.
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'unresolved'),
    '{"decision":"LINK_EXISTING"}'::jsonb,
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '22023',
  'REVIEW_DECISION_SCHEMA_INVALID',
  'malformed decision payload is rejected'
);
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'unresolved'),
    (select decision - 'sources_checked' from review_fixture where name = 'unresolved'),
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '22023',
  'REVIEW_DECISION_SCHEMA_INVALID',
  'sources_checked is required at the database Apply boundary'
);

update review_fixture
set result = public.apply_dilution_identity_review_v1(
  observation_key,
  decision,
  '11111111-1111-4111-8111-111111111111'::uuid
)
where name = 'unresolved';

select is(
  (select result->>'status' from review_fixture where name = 'unresolved'),
  'applied',
  'UNRESOLVED to LINK_EXISTING applies after human Apply'
);
select is(
  (select resolver_decision from public.dilution_source_observations_v1
   where observation_key = (select observation_key from review_fixture where name = 'unresolved')),
  'UNRESOLVED',
  'original resolver decision remains UNRESOLVED'
);
select is(
  (select target_exposure_id from public.dilution_source_observations_v1
   where observation_key = (select observation_key from review_fixture where name = 'unresolved')),
  null,
  'original resolver target remains null'
);
select is(
  public.read_effective_dilution_identity_decision_v1(
    (select observation_key from review_fixture where name = 'unresolved')
  )#>>'{effective,decision}',
  'LINK_EXISTING',
  'effective identity decision reads the human LINK_EXISTING'
);
select is(
  public.read_effective_dilution_identity_decision_v1(
    (select observation_key from review_fixture where name = 'unresolved')
  )#>>'{original,decision}',
  'UNRESOLVED',
  'effective reader still returns the machine original separately'
);
select is(
  (select pg_catalog.jsonb_array_length(gpt_supplied_payload->'sources_checked')::integer
   from public.dilution_identity_adjudications_v1
   where observation_key = (select observation_key from review_fixture where name = 'unresolved')),
  2,
  'sources checked are retained in the GPT supplied audit payload'
);
select is(
  (select gpt_supplied_payload#>>'{suggested_corrections,0,field}'
   from public.dilution_identity_adjudications_v1
   where observation_key = (select observation_key from review_fixture where name = 'unresolved')),
  'current_stock_radar_analysis.source_backed_claims[0]',
  'suggested corrections are retained only inside the supplied audit payload'
);

-- I. Exact replay is idempotent and creates no duplicate row or exposure.
update review_fixture
set result = public.apply_dilution_identity_review_v1(
  observation_key,
  decision,
  '11111111-1111-4111-8111-111111111111'::uuid
)
where name = 'unresolved';
select is(
  (select result->>'status' from review_fixture where name = 'unresolved'),
  'idempotent',
  'exact Apply replay is idempotent'
);
select is(
  (select count(*)::integer from public.dilution_identity_adjudications_v1
   where observation_key = (select observation_key from review_fixture where name = 'unresolved')),
  1,
  'Apply replay creates no duplicate adjudication'
);
select is(
  (select count(*)::integer from public.dilution_economic_exposure_registry_v1),
  2,
  'LINK replay creates no exposure'
);

-- B. CONFLICT to CREATE_NEW generates an exposure in the database.
insert into review_fixture(name, result)
select 'conflict', public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0001111111', '0001111111-26-000003', 'Series C Warrants', 'd'),
  pg_temp.review_resolution(
    '0001111111-26-000003', 'd', 'CONFLICT',
    'AMBIGUOUS_STRONG_IDENTITY_MATCH'
  )
);
update review_fixture set observation_key = result->>'observation_key' where name = 'conflict';
update review_fixture
set context = public.read_dilution_identity_review_case_v1(observation_key)
where name = 'conflict';
update review_fixture
set decision = pg_temp.review_decision(context, 'CREATE_NEW')
where name = 'conflict';
update review_fixture
set result = public.apply_dilution_identity_review_v1(
  observation_key,
  decision,
  '11111111-1111-4111-8111-111111111111'::uuid
)
where name = 'conflict';
select is(
  (select result->>'status' from review_fixture where name = 'conflict'),
  'applied',
  'CONFLICT to CREATE_NEW applies'
);
select matches(
  (select result->>'target_exposure_id' from review_fixture where name = 'conflict'),
  '^economic-exposure:v1:[0-9a-f]{64}$',
  'database generates the CREATE_NEW exposure ID'
);
select is(
  (select resolver_decision from public.dilution_source_observations_v1
   where observation_key = (select observation_key from review_fixture where name = 'conflict')),
  'CONFLICT',
  'original CONFLICT is preserved after CREATE_NEW adjudication'
);
select is(
  (select count(*)::integer from public.dilution_economic_exposure_registry_v1),
  3,
  'CREATE_NEW human adjudication adds exactly one exposure'
);
select is(
  public.read_effective_dilution_identity_decision_v1(
    (select observation_key from review_fixture where name = 'conflict')
  )#>>'{effective,decision}',
  'CREATE_NEW',
  'effective reader returns human CREATE_NEW'
);

-- H. A related observation added after packet generation invalidates the old hash.
insert into review_fixture(name, result)
select 'stale', public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0003333333', '0003333333-26-000001', 'Series Stale Warrants', 'e'),
  pg_temp.review_resolution(
    '0003333333-26-000001', 'e', 'UNRESOLVED',
    'INSUFFICIENT_SOURCE_BACKED_IDENTITY'
  )
);
update review_fixture set observation_key = result->>'observation_key' where name = 'stale';
update review_fixture
set context = public.read_dilution_identity_review_case_v1(observation_key)
where name = 'stale';
update review_fixture
set decision = pg_temp.review_decision(context, 'UNRESOLVED')
where name = 'stale';

select public.persist_dilution_exposure_resolution_v1(
  pg_temp.review_observation('0003333333', '0003333333-26-000002', 'Series Later Warrants', 'f'),
  pg_temp.review_resolution(
    '0003333333-26-000002', 'f', 'CONFLICT',
    'AMBIGUOUS_STRONG_IDENTITY_MATCH'
  )
);
select throws_ok(
  $$select public.apply_dilution_identity_review_v1(
    (select observation_key from review_fixture where name = 'stale'),
    (select decision from review_fixture where name = 'stale'),
    '11111111-1111-4111-8111-111111111111'::uuid
  )$$,
  '40001',
  'STALE_REVIEW_INPUT',
  'stale input_hash is rejected after related state changes'
);
select is(
  (select count(*)::integer from public.dilution_identity_adjudications_v1
   where observation_key = (select observation_key from review_fixture where name = 'stale')),
  0,
  'stale rejection writes no adjudication'
);

select * from finish();
rollback;
