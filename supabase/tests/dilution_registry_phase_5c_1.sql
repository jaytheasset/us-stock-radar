\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column(
  'public',
  'dilution_instrument_snapshots',
  'paste_id',
  'snapshots can carry the successful-paste completion marker'
);

select has_column(
  'public',
  'dilution_instrument_activity',
  'paste_id',
  'activity can carry the successful-paste completion marker'
);

select has_column(
  'public',
  'dilution_totals',
  'paste_id',
  'dilution_totals has the successful-paste completion marker'
);

select col_type_is(
  'public',
  'dilution_totals',
  'paste_id',
  'text',
  'paste_id is text'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dilution_instrument_snapshots'::regclass
      and conname = 'dilution_instrument_snapshots_paste_id_key'
      and contype = 'u'
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dilution_instrument_activity'::regclass
      and conname = 'dilution_instrument_activity_paste_id_key'
      and contype = 'u'
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dilution_totals'::regclass
      and conname = 'dilution_totals_paste_id_key'
      and contype = 'u'
  ),
  'each append-only marker location permits at most one row per paste_id'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dilution_totals'::regclass
      and conname = 'dilution_totals_paste_id_format_check'
      and contype = 'c'
  ),
  'paste_id has a format constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.dilution_totals'::regclass
      and conname = 'dilution_totals_paste_id_key'
      and contype = 'u'
  ),
  'one completion marker is allowed per paste_id'
);

select has_function(
  'public',
  'apply_dilution_registry_v1',
  array['jsonb', 'text', 'text'],
  'atomic dilution registry Apply RPC exists'
);

select ok(
  not (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.apply_dilution_registry_v1(jsonb,text,text)'::regprocedure
  ),
  'Apply RPC is SECURITY INVOKER'
);

select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.apply_dilution_registry_v1(jsonb,text,text)'::regprocedure
  ),
  array['search_path=""']::text[],
  'Apply RPC uses an empty search_path'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.apply_dilution_registry_v1(jsonb,text,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.apply_dilution_registry_v1(jsonb,text,text)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_dilution_registry_v1(jsonb,text,text)',
    'execute'
  ),
  'only the backend service role can execute Apply RPC'
);

select ok(
  (select pg_catalog.bool_and(relrowsecurity)
   from pg_catalog.pg_class
   where oid in (
     'public.dilution_instruments'::regclass,
     'public.dilution_instrument_snapshots'::regclass,
     'public.dilution_instrument_activity'::regclass,
     'public.dilution_totals'::regclass
   )),
  'RLS remains enabled on all four registry tables'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.dilution_totals', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.dilution_totals', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_totals', 'select,insert,update,delete'),
  'existing registry table grants remain unchanged'
);

create temporary table phase_5c_1_payloads (
  name text primary key,
  source text not null,
  paste_id text,
  payload jsonb generated always as (source::jsonb) stored
) on commit drop;

insert into phase_5c_1_payloads (name, source)
values (
  'first',
  jsonb_build_object(
    'issuer', jsonb_build_object('issuer_cik', '0001840317'),
    'instruments', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-note',
      'instrument_type', 'convertible_note',
      'name', 'Phase 5C-1 Note'
    )),
    'snapshots', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-note',
      'as_of_date', '2026-08-28',
      'status', 'current',
      'remaining_amount', 100
    )),
    'activities', '[]'::jsonb,
    'totals', jsonb_build_array(jsonb_build_object(
      'issuer_cik', '0001840317',
      'instrument_type', 'convertible_note',
      'name', 'Phase 5C-1 Notes Total',
      'total_amount', 100,
      'currency', 'USD'
    ))
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex');

create temporary table phase_5c_1_results (
  result jsonb not null
) on commit drop;

insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads
where name = 'first';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'false',
  'first Apply is saved'
);

select is(
  (select result#>>'{added,instruments}' from phase_5c_1_results limit 1),
  '1',
  'first Apply adds one instrument'
);

select is(
  (select result#>>'{added,snapshots}' from phase_5c_1_results limit 1),
  '1',
  'first Apply adds one snapshot'
);

select is(
  (select result#>>'{added,activities}' from phase_5c_1_results limit 1),
  '0',
  'first Apply preserves an empty activity list'
);

select is(
  (select result#>>'{added,totals}' from phase_5c_1_results limit 1),
  '1',
  'first Apply adds one total and completion marker'
);

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads
where name = 'first';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'true',
  'identical replay is already saved'
);

select is(
  (select result->'added' from phase_5c_1_results limit 1),
  '{"totals": 0, "snapshots": 0, "activities": 0, "instruments": 0}'::jsonb,
  'identical replay adds zero rows in all four tables'
);

select is(
  (select count(*) from public.dilution_instruments),
  1::bigint,
  'replay leaves instrument count unchanged'
);

select is(
  (select count(*) from public.dilution_instrument_snapshots),
  1::bigint,
  'replay leaves snapshot count unchanged'
);

select is(
  (select count(*) from public.dilution_instrument_activity),
  0::bigint,
  'replay leaves activity count unchanged'
);

select is(
  (select count(*) from public.dilution_totals),
  1::bigint,
  'replay leaves total count unchanged'
);

select is(
  (select count(*) from public.dilution_instrument_snapshots where paste_id is not null),
  1::bigint,
  'snapshot is the preferred successful-paste marker when snapshots exist'
);

select is(
  (select count(*) from public.dilution_totals where paste_id is not null),
  0::bigint,
  'totals do not receive a second marker when a snapshot exists'
);

insert into phase_5c_1_payloads (name, source)
values (
  'snapshot-no-totals',
  jsonb_build_object(
    'issuer', jsonb_build_object('issuer_cik', '0001840317'),
    'instruments', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-snapshot-only-note',
      'instrument_type', 'convertible_note',
      'name', 'Snapshot Without Totals'
    )),
    'snapshots', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-snapshot-only-note',
      'as_of_date', '2026-08-28',
      'status', 'current'
    )),
    'activities', '[]'::jsonb,
    'totals', '[]'::jsonb
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'snapshot-no-totals';

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'snapshot-no-totals';

select is(
  (select result->'added' from phase_5c_1_results limit 1),
  '{"totals": 0, "snapshots": 1, "activities": 0, "instruments": 1}'::jsonb,
  'instrument plus snapshot saves without a total'
);

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'snapshot-no-totals';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'true',
  'snapshot-only exact replay uses its snapshot marker'
);

insert into phase_5c_1_payloads (name, source)
values (
  'activity-no-snapshot-or-total',
  jsonb_build_object(
    'issuer', jsonb_build_object('issuer_cik', '0001840317'),
    'instruments', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-activity-only-note',
      'instrument_type', 'convertible_note',
      'name', 'Activity Without Snapshot Or Total'
    )),
    'snapshots', '[]'::jsonb,
    'activities', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-activity-only-note',
      'activity_type', 'issued'
    )),
    'totals', '[]'::jsonb
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'activity-no-snapshot-or-total';

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'activity-no-snapshot-or-total';

select is(
  (select result->'added' from phase_5c_1_results limit 1),
  '{"totals": 0, "snapshots": 0, "activities": 1, "instruments": 1}'::jsonb,
  'instrument plus activity saves without a snapshot or total'
);

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'activity-no-snapshot-or-total';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'true',
  'activity-only exact replay uses its activity marker'
);

insert into phase_5c_1_payloads (name, source)
values (
  'instrument-only',
  jsonb_build_object(
    'issuer', jsonb_build_object('issuer_cik', '0001840317'),
    'instruments', jsonb_build_array(jsonb_build_object(
      'instrument_key', 'phase-5c-1-instrument-only-note',
      'instrument_type', 'convertible_note',
      'name', 'Instrument Only'
    )),
    'snapshots', '[]'::jsonb,
    'activities', '[]'::jsonb,
    'totals', '[]'::jsonb
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'instrument-only';

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'instrument-only';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'false',
  'instrument-only first Apply reports its new instrument'
);

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'instrument-only';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'true',
  'instrument-only replay is an honest identity-reuse no-op'
);

insert into phase_5c_1_payloads (name, source)
values (
  'fully-empty',
  jsonb_build_object(
    'instruments', '[]'::jsonb,
    'snapshots', '[]'::jsonb,
    'activities', '[]'::jsonb,
    'totals', '[]'::jsonb
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'fully-empty';

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads where name = 'fully-empty';

select is(
  (select result from phase_5c_1_results limit 1),
  jsonb_build_object(
    'already_saved', true,
    'paste_id', (select paste_id from phase_5c_1_payloads where name = 'fully-empty'),
    'added', '{"totals": 0, "snapshots": 0, "activities": 0, "instruments": 0}'::jsonb
  ),
  'fully empty Preview-valid payload is an honest unrecorded no-op'
);

insert into phase_5c_1_payloads (name, source)
values (
  'missing-reference',
  jsonb_build_object(
      'issuer', jsonb_build_object('issuer_cik', '0001840317'),
      'instruments', jsonb_build_array(jsonb_build_object(
        'instrument_key', 'phase-5c-1-failed-note',
        'instrument_type', 'convertible_note',
        'name', 'Must Roll Back'
      )),
      'snapshots', jsonb_build_array(jsonb_build_object(
        'instrument_key', 'phase-5c-1-failed-note',
        'as_of_date', '2026-08-28',
        'status', 'current'
      )),
      'activities', jsonb_build_array(jsonb_build_object(
        'instrument_key', 'missing-after-snapshot-marker',
        'activity_type', 'issued'
      )),
      'totals', '[]'::jsonb
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'missing-reference';

select throws_ok(
  $$select public.apply_dilution_registry_v1(payload, paste_id, source)
    from phase_5c_1_payloads where name = 'missing-reference'$$,
  '23503',
  'dilution registry activity references a missing instrument_key',
  'missing activity reference fails after the snapshot marker insert'
);

select is(
  (select count(*) from public.dilution_instruments),
  4::bigint,
  'failed Apply rolls back its new instrument'
);

select is(
  (select count(*) from public.dilution_instrument_snapshots),
  2::bigint,
  'failed Apply leaves snapshot count unchanged'
);

select is(
  (select count(*) from public.dilution_instrument_activity),
  1::bigint,
  'failed Apply leaves activity count unchanged'
);

select is(
  (select count(*) from public.dilution_totals),
  1::bigint,
  'failed Apply leaves total count unchanged'
);

select is(
  (
    select count(*) from (
      select paste_id from public.dilution_instrument_snapshots
      union all
      select paste_id from public.dilution_instrument_activity
      union all
      select paste_id from public.dilution_totals
    ) as markers
    where paste_id = (select paste_id from phase_5c_1_payloads where name = 'missing-reference')
  ),
  0::bigint,
  'failed Apply leaves no success marker'
);

insert into phase_5c_1_payloads (name, source)
select
  'corrected-reference',
  jsonb_set(
    payload,
    '{activities,0,instrument_key}',
    to_jsonb(payload#>>'{instruments,0,instrument_key}')
  )::text
from phase_5c_1_payloads
where name = 'missing-reference';

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'corrected-reference';

truncate phase_5c_1_results;
insert into phase_5c_1_results (result)
select public.apply_dilution_registry_v1(payload, paste_id, source)
from phase_5c_1_payloads
where name = 'corrected-reference';

select is(
  (select result->>'already_saved' from phase_5c_1_results limit 1),
  'false',
  'corrected payload saves because the failed call left no success marker'
);

select is(
  (select count(*) from public.dilution_instrument_snapshots
   where paste_id = (select paste_id from phase_5c_1_payloads where name = 'corrected-reference')),
  1::bigint,
  'corrected payload receives its completion marker'
);

select throws_ok(
  $$select public.apply_dilution_registry_v1(
      payload,
      'dilution-registry:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source
    ) from phase_5c_1_payloads where name = 'first'$$,
  '22023',
  'dilution registry paste_id does not match the exact Preview source',
  'RPC does not trust an arbitrary caller paste_id'
);

select throws_ok(
  $$select public.apply_dilution_registry_v1(
      (select payload from phase_5c_1_payloads where name = 'corrected-reference'),
      paste_id,
      source
    ) from phase_5c_1_payloads where name = 'first'$$,
  '22023',
  'dilution registry payload does not match the exact Preview source',
  'RPC binds parsed payload to the exact source used for identity'
);

insert into phase_5c_1_payloads (name, source)
values (
  'identity-mismatch',
  jsonb_build_object(
      'issuer', jsonb_build_object('issuer_cik', '0001840317'),
      'instruments', jsonb_build_array(
        jsonb_build_object(
          'instrument_key', 'phase-5c-1-new-before-mismatch',
          'instrument_type', 'warrant',
          'name', 'Must Not Persist'
        ),
        jsonb_build_object(
          'instrument_key', 'phase-5c-1-note',
          'instrument_type', 'warrant',
          'name', 'Identity Mismatch'
        )
      ),
      'snapshots', '[]'::jsonb,
      'activities', '[]'::jsonb,
      'totals', jsonb_build_array(jsonb_build_object(
        'issuer_cik', '0001840317',
        'instrument_type', 'warrant',
        'name', 'Mismatch Total'
      ))
  )::text
);

update phase_5c_1_payloads
set paste_id = 'dilution-registry:v1:' ||
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(source, 'UTF8'), 'sha256'), 'hex')
where name = 'identity-mismatch';

select throws_ok(
  $$select public.apply_dilution_registry_v1(payload, paste_id, source)
    from phase_5c_1_payloads where name = 'identity-mismatch'$$,
  '23514',
  'dilution registry instrument identity does not match the stored issuer or type',
  'stored instrument identity mismatch fails the whole Apply'
);

select is(
  (select count(*) from public.dilution_instruments),
  5::bigint,
  'identity mismatch leaves no partial instrument'
);

select is(
  (select count(*) from public.dilution_totals
   where paste_id = (select paste_id from phase_5c_1_payloads where name = 'identity-mismatch')),
  0::bigint,
  'identity mismatch leaves no success marker'
);

select throws_ok(
  $$insert into public.dilution_totals (
    issuer_cik, instrument_type, name, paste_id
  ) values (
    '0001840317', 'warrant', 'Bad Paste ID', 'client-value'
  )$$,
  '23514',
  null,
  'paste_id format constraint rejects arbitrary values'
);

select * from finish();
rollback;
