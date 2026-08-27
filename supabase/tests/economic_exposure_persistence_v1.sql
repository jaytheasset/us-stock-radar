begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.ee_evidence(p_accession text, p_seed text)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_evidence_identity_v1',
    'source_ref', 'analysis-source:' || p_accession || ':0',
    'range_start', 0,
    'range_end', 10,
    'source_content_hash', pg_catalog.repeat(p_seed, 64),
    'exact_source', true
  )
$$;

create function pg_temp.ee_claim(
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
    'semantic_role', case when p_kind = 'original_issuance_or_closing_date'
      then to_jsonb('instrument_issuance_date'::text) else 'null'::jsonb end,
    'evidence_identity', pg_temp.ee_evidence(p_accession, p_seed)
  )
$$;

create function pg_temp.ee_observation(
  p_issuer text,
  p_accession text,
  p_kind text,
  p_claim_kind text,
  p_claim_value text,
  p_seed text default 'a',
  p_type text default 'convertible_note'
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_source_observation_v1',
    'issuer_cik', p_issuer,
    'accession', p_accession,
    'form', '8-K',
    'filed_date', '2026-08-27',
    'accepted_at', null,
    'analysis_lineage', null,
    'exposure_id', null,
    'exposure_type', p_type,
    'observation_kind', p_kind,
    'observed_fields', '[]'::jsonb,
    'identity_claims', pg_catalog.jsonb_build_array(
      pg_temp.ee_claim(p_accession, p_claim_kind, p_claim_value, p_seed)
    ),
    'status', 'VALIDATED'
  )
$$;

create function pg_temp.ee_resolution(
  p_decision text,
  p_reason text,
  p_evidence jsonb,
  p_claim_kind text,
  p_target text default null,
  p_issuer text default null,
  p_type text default null
)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'version', 'dilution_identity_decision_v1',
    'resolver_version', 'economic_exposure_identity_resolver_v1',
    'decision', p_decision,
    'reason_code', p_reason,
    'target_exposure_id', p_target,
    'identity_claim_kinds', pg_catalog.jsonb_build_array(p_claim_kind),
    'identity_evidence', pg_catalog.jsonb_build_array(p_evidence),
    'matched_strong_claims', '[]'::jsonb,
    'conflicting_strong_claims', '[]'::jsonb,
    'independent_strong_claims', '[]'::jsonb,
    'supporting_evidence_references', pg_catalog.jsonb_build_array(p_evidence),
    'supporting_registration_matches', '[]'::jsonb,
    'candidate_exposure_identity', case when p_target is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'exposure_id', p_target,
        'issuer_cik', p_issuer,
        'exposure_type', p_type
      ) end
  )
$$;

select has_table(
  'public', 'dilution_economic_exposure_registry_v1',
  'canonical economic exposure registry exists'
);
select has_table(
  'public', 'dilution_source_observations_v1',
  'source-backed observation history exists'
);
select has_function(
  'public', 'read_dilution_exposure_resolution_context', array['jsonb'],
  'same-issuer resolver context reader exists'
);
select has_function(
  'public', 'persist_dilution_exposure_resolution_v1', array['jsonb', 'jsonb'],
  'atomic decision persistence RPC exists'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.dilution_economic_exposure_registry_v1'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.dilution_source_observations_v1'::regclass),
  'both public tables have RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.dilution_economic_exposure_registry_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_economic_exposure_registry_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('service_role', 'public.dilution_economic_exposure_registry_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.dilution_source_observations_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_source_observations_v1', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('service_role', 'public.dilution_source_observations_v1', 'select,insert,update,delete'),
  'browser and service roles have no direct table access'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_dilution_exposure_resolution_context(jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.read_dilution_exposure_resolution_context(jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.read_dilution_exposure_resolution_context(jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.persist_dilution_exposure_resolution_v1(jsonb,jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('authenticated', 'public.persist_dilution_exposure_resolution_v1(jsonb,jsonb)', 'execute')
  and pg_catalog.has_function_privilege('service_role', 'public.persist_dilution_exposure_resolution_v1(jsonb,jsonb)', 'execute'),
  'only service_role can execute the two reviewed RPCs'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'public.read_dilution_exposure_resolution_context(jsonb)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'public.persist_dilution_exposure_resolution_v1(jsonb,jsonb)'::regprocedure),
  'both SECURITY DEFINER RPCs pin an empty search_path'
);
select hasnt_column(
  'public', 'dilution_source_observations_v1', 'raw_source_text',
  'SEC source text is not duplicated into observation rows'
);

delete from public.dilution_source_observations_v1;
delete from public.dilution_economic_exposure_registry_v1;
insert into public.sec_issuers(cik)
values ('0001234567'), ('0007654321')
on conflict do nothing;

create temporary table ee_results(name text primary key, payload jsonb not null);

insert into ee_results(name, payload)
select 'create', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000001', 'exposure_identity',
    'designation_or_tranche', 'Series A Note', 'a'
  ),
  pg_temp.ee_resolution(
    'CREATE_NEW', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY',
    pg_temp.ee_evidence('0001234567-26-000001', 'a'),
    'designation_or_tranche'
  )
);

select is((select payload->>'status' from ee_results where name = 'create'), 'saved', 'CREATE_NEW is saved');
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'CREATE_NEW creates one exposure');
select is((select count(*)::integer from public.dilution_source_observations_v1), 1, 'CREATE_NEW creates one observation');
select ok(
  (select observation.target_exposure_id = exposure.exposure_id
   from public.dilution_source_observations_v1 observation
   join public.dilution_economic_exposure_registry_v1 exposure
     on exposure.exposure_id = observation.target_exposure_id
   where observation.resolver_decision = 'CREATE_NEW'),
  'CREATE_NEW observation points to the atomically-created exposure'
);

insert into ee_results(name, payload)
select 'create_replay', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000001', 'exposure_identity',
    'designation_or_tranche', 'Series A Note', 'a'
  ),
  pg_temp.ee_resolution(
    'CREATE_NEW', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY',
    pg_temp.ee_evidence('0001234567-26-000001', 'a'),
    'designation_or_tranche'
  )
);
select is((select payload->>'status' from ee_results where name = 'create_replay'), 'idempotent', 'CREATE_NEW replay is idempotent');
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'CREATE_NEW replay adds zero exposures');
select is((select count(*)::integer from public.dilution_source_observations_v1), 1, 'CREATE_NEW replay adds zero observations');
select is(
  public.read_dilution_exposure_resolution_context(pg_temp.ee_observation(
    '0001234567', '0001234567-26-000001', 'exposure_identity',
    'designation_or_tranche', 'Series A Note', 'a'
  ))->>'status',
  'already_persisted',
  'reader detects deterministic replay before Resolver execution'
);

create temporary table ee_canonical_before as
select exposure_id, canonical_identity_claims
from public.dilution_economic_exposure_registry_v1;

insert into ee_results(name, payload)
select 'link', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000002', 'exposure_identity',
    'designation_or_tranche', 'Series A Note', 'b'
  ),
  pg_temp.ee_resolution(
    'LINK_EXISTING', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH',
    pg_temp.ee_evidence('0001234567-26-000002', 'b'),
    'designation_or_tranche',
    (select exposure_id from public.dilution_economic_exposure_registry_v1),
    '0001234567', 'convertible_note'
  )
);
select is((select payload->>'status' from ee_results where name = 'link'), 'saved', 'LINK_EXISTING is saved');
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'LINK_EXISTING adds zero exposures');
select is((select count(*)::integer from public.dilution_source_observations_v1), 2, 'LINK_EXISTING adds one observation');
select is(
  (select canonical_identity_claims from public.dilution_economic_exposure_registry_v1),
  (select canonical_identity_claims from ee_canonical_before),
  'LINK_EXISTING does not promote or overwrite canonical identity claims'
);

insert into ee_results(name, payload)
select 'amend', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000003', 'exposure_amendment',
    'amendment_reference', 'Series A Note', 'c'
  ),
  pg_temp.ee_resolution(
    'AMEND_EXISTING', 'EXPLICIT_AMENDMENT_REFERENCE_MATCH',
    pg_temp.ee_evidence('0001234567-26-000003', 'c'),
    'amendment_reference',
    (select exposure_id from public.dilution_economic_exposure_registry_v1),
    '0001234567', 'convertible_note'
  )
);
select is((select payload->>'status' from ee_results where name = 'amend'), 'saved', 'AMEND_EXISTING is saved');
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'AMEND_EXISTING adds zero exposures');
select is(
  (select canonical_identity_claims from public.dilution_economic_exposure_registry_v1),
  (select canonical_identity_claims from ee_canonical_before),
  'AMEND_EXISTING does not overwrite canonical identity or current terms'
);

insert into ee_results(name, payload)
select 'unresolved', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000004', 'exposure_identity',
    'holder_or_investor', 'Investor A', 'd'
  ),
  pg_temp.ee_resolution(
    'UNRESOLVED', 'INSUFFICIENT_SOURCE_BACKED_IDENTITY',
    pg_temp.ee_evidence('0001234567-26-000004', 'd'),
    'holder_or_investor'
  )
);
insert into ee_results(name, payload)
select 'conflict', public.persist_dilution_exposure_resolution_v1(
  pg_temp.ee_observation(
    '0001234567', '0001234567-26-000005', 'exposure_identity',
    'designation_or_tranche', 'Conflicting Note', 'e'
  ),
  pg_temp.ee_resolution(
    'CONFLICT', 'AMBIGUOUS_STRONG_IDENTITY_MATCH',
    pg_temp.ee_evidence('0001234567-26-000005', 'e'),
    'designation_or_tranche'
  )
);
select is(
  (select target_exposure_id from public.dilution_source_observations_v1 where resolver_decision = 'UNRESOLVED'),
  null,
  'UNRESOLVED preserves a null target'
);
select is(
  (select target_exposure_id from public.dilution_source_observations_v1 where resolver_decision = 'CONFLICT'),
  null,
  'CONFLICT preserves a distinct null-target decision'
);
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'null-target decisions add zero exposures');

select public.persist_dilution_exposure_resolution_v1(
  observation_payload, resolver_result_payload
)
from public.dilution_source_observations_v1
where resolver_decision in ('LINK_EXISTING', 'AMEND_EXISTING', 'UNRESOLVED', 'CONFLICT');
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'all non-create replays add zero exposures');
select is((select count(*)::integer from public.dilution_source_observations_v1), 5, 'all decision replays add zero observations');

select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0001234567', '0001234567-26-000006', 'exposure_identity',
        'designation_or_tranche', 'Missing Target Note', 'f'
      ),
      pg_temp.ee_resolution(
        'LINK_EXISTING', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH',
        pg_temp.ee_evidence('0001234567-26-000006', 'f'),
        'designation_or_tranche', null, '0001234567', 'convertible_note'
      )
    )$$,
  '22023', null, 'LINK target is required'
);
select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0001234567', '0001234567-26-000010', 'exposure_amendment',
        'amendment_reference', 'Missing Amendment Target', '5'
      ),
      pg_temp.ee_resolution(
        'AMEND_EXISTING', 'EXPLICIT_AMENDMENT_REFERENCE_MATCH',
        pg_temp.ee_evidence('0001234567-26-000010', '5'),
        'amendment_reference', null, '0001234567', 'convertible_note'
      )
    )$$,
  '22023', null, 'AMEND target is required'
);
select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0001234567', '0001234567-26-000007', 'exposure_amendment',
        'amendment_reference', 'Missing Target Note', '1'
      ),
      pg_temp.ee_resolution(
        'AMEND_EXISTING', 'EXPLICIT_AMENDMENT_REFERENCE_MATCH',
        pg_temp.ee_evidence('0001234567-26-000007', '1'),
        'amendment_reference', 'economic-exposure:v1:9999999999999999999999999999999999999999999999999999999999999999',
        '0001234567', 'convertible_note'
      )
    )$$,
  '23503', null, 'nonexistent AMEND target fails closed'
);
select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0007654321', '0007654321-26-000001', 'exposure_identity',
        'designation_or_tranche', 'Wrong Issuer Note', '2'
      ),
      pg_temp.ee_resolution(
        'LINK_EXISTING', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH',
        pg_temp.ee_evidence('0007654321-26-000001', '2'),
        'designation_or_tranche',
        (select exposure_id from public.dilution_economic_exposure_registry_v1),
        '0007654321', 'convertible_note'
      )
    )$$,
  '23514', null, 'cross-issuer target fails closed'
);
select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0001234567', '0001234567-26-000008', 'exposure_identity',
        'designation_or_tranche', 'Invalid Decision Note', '3'
      ),
      pg_temp.ee_resolution(
        'MERGE_LIKELY', 'SOURCE_BACKED_STRONG_IDENTITY_MATCH',
        pg_temp.ee_evidence('0001234567-26-000008', '3'),
        'designation_or_tranche'
      )
    )$$,
  '22023', null, 'invalid decision enum fails closed'
);
select throws_ok(
  $$select public.read_dilution_exposure_resolution_context(
      jsonb_set(
        pg_temp.ee_observation(
          '0001234567', '0001234567-26-000009', 'exposure_identity',
          'designation_or_tranche', 'Malformed Evidence Note', '4'
        ),
        '{identity_claims,0,evidence_identity,source_content_hash}',
        '"bad"'::jsonb
      )
    )$$,
  '22023', null, 'malformed evidence identity fails before resolver or persistence'
);

create function pg_temp.ee_reject_atomic_observation()
returns trigger language plpgsql as $$
begin
  if new.accession = '0001234567-26-000011' then
    raise exception using errcode = 'P0001', message = 'forced observation failure';
  end if;
  return new;
end
$$;
create trigger ee_reject_atomic_observation
before insert on public.dilution_source_observations_v1
for each row execute function pg_temp.ee_reject_atomic_observation();
select throws_ok(
  $$select public.persist_dilution_exposure_resolution_v1(
      pg_temp.ee_observation(
        '0001234567', '0001234567-26-000011', 'exposure_identity',
        'designation_or_tranche', 'Atomic Rollback Note', '6'
      ),
      pg_temp.ee_resolution(
        'CREATE_NEW', 'SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY',
        pg_temp.ee_evidence('0001234567-26-000011', '6'),
        'designation_or_tranche'
      )
    )$$,
  'P0001', 'forced observation failure',
  'CREATE_NEW rolls back the exposure when observation insertion fails'
);
drop trigger ee_reject_atomic_observation on public.dilution_source_observations_v1;
select is((select count(*)::integer from public.dilution_economic_exposure_registry_v1), 1, 'fail-closed cases create no exposure contamination');
select is((select count(*)::integer from public.dilution_source_observations_v1), 5, 'fail-closed cases create no observation contamination');

select * from finish();
rollback;
