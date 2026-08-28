\set ON_ERROR_STOP on

\if :{?fixture_json}
\else
  \echo 'fixture_json psql variable is required'
  \quit 2
\endif

begin;

create temporary table phase_5a_fixture (
  payload jsonb not null
) on commit drop;

insert into phase_5a_fixture (payload)
values (:'fixture_json'::jsonb);

insert into public.dilution_instruments (
  instrument_key,
  issuer_cik,
  instrument_type,
  name,
  series_or_tranche,
  holders,
  first_source_accession
)
select
  item ->> 'instrument_key',
  fixture.payload #>> '{issuer,issuer_cik}',
  item ->> 'instrument_type',
  item ->> 'name',
  item ->> 'series_or_tranche',
  case
    when item ? 'holders' then
      array(select pg_catalog.jsonb_array_elements_text(item -> 'holders'))
    else null
  end,
  item ->> 'first_source_accession'
from phase_5a_fixture as fixture
cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'instruments') as instruments(item);

insert into public.dilution_instrument_snapshots (
  instrument_id,
  as_of_date,
  status,
  closed_reason,
  can_convert_or_exercise,
  restriction,
  currency,
  original_amount,
  remaining_amount,
  converted_amount,
  repaid_amount,
  interest_rate,
  interest_converted,
  original_units,
  remaining_units,
  converted_units,
  exercised_units,
  cancelled_units,
  expired_units,
  stated_value,
  original_capacity,
  used_amount,
  remaining_capacity,
  shares_issued,
  shares_sold,
  gross_proceeds,
  remaining_potential_shares,
  price_type,
  conversion_price,
  exercise_price,
  floor_price,
  price_formula,
  available_date,
  start_date,
  end_date,
  end_date_type,
  term_months,
  resale_status,
  registered_resale_shares,
  share_basis_date,
  source_accession,
  source_note,
  review_note,
  last_checked
)
select
  instrument.id,
  (item ->> 'as_of_date')::date,
  item ->> 'status',
  item ->> 'closed_reason',
  (item ->> 'can_convert_or_exercise')::boolean,
  item ->> 'restriction',
  item ->> 'currency',
  (item ->> 'original_amount')::numeric,
  (item ->> 'remaining_amount')::numeric,
  (item ->> 'converted_amount')::numeric,
  (item ->> 'repaid_amount')::numeric,
  (item ->> 'interest_rate')::numeric,
  (item ->> 'interest_converted')::numeric,
  (item ->> 'original_units')::numeric,
  (item ->> 'remaining_units')::numeric,
  (item ->> 'converted_units')::numeric,
  (item ->> 'exercised_units')::numeric,
  (item ->> 'cancelled_units')::numeric,
  (item ->> 'expired_units')::numeric,
  (item ->> 'stated_value')::numeric,
  (item ->> 'original_capacity')::numeric,
  (item ->> 'used_amount')::numeric,
  (item ->> 'remaining_capacity')::numeric,
  (item ->> 'shares_issued')::numeric,
  (item ->> 'shares_sold')::numeric,
  (item ->> 'gross_proceeds')::numeric,
  (item ->> 'remaining_potential_shares')::numeric,
  item ->> 'price_type',
  (item ->> 'conversion_price')::numeric,
  (item ->> 'exercise_price')::numeric,
  (item ->> 'floor_price')::numeric,
  item ->> 'price_formula',
  (item ->> 'available_date')::date,
  (item ->> 'start_date')::date,
  (item ->> 'end_date')::date,
  item ->> 'end_date_type',
  (item ->> 'term_months')::numeric,
  item ->> 'resale_status',
  (item ->> 'registered_resale_shares')::numeric,
  (item ->> 'share_basis_date')::date,
  item ->> 'source_accession',
  item ->> 'source_note',
  item ->> 'review_note',
  (item ->> 'last_checked')::date
from phase_5a_fixture as fixture
cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'snapshots') as snapshots(item)
join public.dilution_instruments as instrument
  on instrument.instrument_key = item ->> 'instrument_key';

insert into public.dilution_instrument_activity (
  issuer_cik,
  instrument_id,
  related_instrument_keys,
  activity_type,
  activity_date,
  period_start,
  period_end,
  currency,
  units_issued,
  amount_converted,
  amount_repaid,
  interest_converted,
  units_converted,
  units_exercised,
  units_cancelled,
  units_expired,
  used_amount,
  shares_issued,
  shares_sold,
  gross_proceeds,
  details,
  source_accession,
  source_note,
  last_checked
)
select
  fixture.payload #>> '{issuer,issuer_cik}',
  instrument.id,
  case
    when item ? 'related_instrument_keys' then
      array(select pg_catalog.jsonb_array_elements_text(item -> 'related_instrument_keys'))
    else null
  end,
  item ->> 'activity_type',
  (item ->> 'activity_date')::date,
  (item ->> 'period_start')::date,
  (item ->> 'period_end')::date,
  item ->> 'currency',
  (item ->> 'units_issued')::numeric,
  (item ->> 'amount_converted')::numeric,
  (item ->> 'amount_repaid')::numeric,
  (item ->> 'interest_converted')::numeric,
  (item ->> 'units_converted')::numeric,
  (item ->> 'units_exercised')::numeric,
  (item ->> 'units_cancelled')::numeric,
  (item ->> 'units_expired')::numeric,
  (item ->> 'used_amount')::numeric,
  (item ->> 'shares_issued')::numeric,
  (item ->> 'shares_sold')::numeric,
  (item ->> 'gross_proceeds')::numeric,
  item ->> 'details',
  item ->> 'source_accession',
  item ->> 'source_note',
  (item ->> 'last_checked')::date
from phase_5a_fixture as fixture
cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'activities') as activities(item)
left join public.dilution_instruments as instrument
  on instrument.instrument_key = item ->> 'instrument_key';

insert into public.dilution_totals (
  issuer_cik,
  instrument_type,
  name,
  total_shares,
  other_shares,
  total_amount,
  other_amount,
  currency,
  as_of_date,
  status,
  included_instrument_keys,
  source_accession,
  source_note,
  review_note,
  last_checked
)
select
  item ->> 'issuer_cik',
  item ->> 'instrument_type',
  item ->> 'name',
  (item ->> 'total_shares')::numeric,
  (item ->> 'other_shares')::numeric,
  (item ->> 'total_amount')::numeric,
  (item ->> 'other_amount')::numeric,
  item ->> 'currency',
  (item ->> 'as_of_date')::date,
  item ->> 'status',
  case
    when item ? 'included_instrument_keys' then
      array(select pg_catalog.jsonb_array_elements_text(item -> 'included_instrument_keys'))
    else null
  end,
  item ->> 'source_accession',
  item ->> 'source_note',
  item ->> 'review_note',
  (item ->> 'last_checked')::date
from phase_5a_fixture as fixture
cross join lateral pg_catalog.jsonb_array_elements(fixture.payload -> 'totals') as totals(item);

commit;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  (select count(*)
   from pg_catalog.pg_class as relation
   join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relkind = 'r'
     and relation.relname in (
       'dilution_instruments',
       'dilution_instrument_snapshots',
       'dilution_instrument_activity',
       'dilution_totals'
     )),
  4::bigint,
  'exactly four Phase 5A registry tables exist'
);

select ok(
  (select pg_catalog.bool_and(relation.relrowsecurity)
   from pg_catalog.pg_class as relation
   where relation.oid in (
     'public.dilution_instruments'::regclass,
     'public.dilution_instrument_snapshots'::regclass,
     'public.dilution_instrument_activity'::regclass,
     'public.dilution_totals'::regclass
   )),
  'all four public tables have RLS enabled'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.dilution_instruments', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_instruments', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.dilution_instrument_snapshots', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_instrument_snapshots', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.dilution_instrument_activity', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_instrument_activity', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.dilution_totals', 'select,insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.dilution_totals', 'select,insert,update,delete'),
  'browser roles have no registry table privileges'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.dilution_instruments', 'select,insert,update,delete')
  and pg_catalog.has_table_privilege('service_role', 'public.dilution_instrument_snapshots', 'select,insert,update,delete')
  and pg_catalog.has_table_privilege('service_role', 'public.dilution_instrument_activity', 'select,insert,update,delete')
  and pg_catalog.has_table_privilege('service_role', 'public.dilution_totals', 'select,insert,update,delete')
  and pg_catalog.has_sequence_privilege('service_role', 'public.dilution_instruments_id_seq', 'usage,select')
  and pg_catalog.has_sequence_privilege('service_role', 'public.dilution_instrument_snapshots_id_seq', 'usage,select')
  and pg_catalog.has_sequence_privilege('service_role', 'public.dilution_instrument_activity_id_seq', 'usage,select')
  and pg_catalog.has_sequence_privilege('service_role', 'public.dilution_totals_id_seq', 'usage,select'),
  'service role has explicit registry table and identity-sequence privileges'
);

select throws_ok(
  $$insert into public.dilution_instruments (
      instrument_key, issuer_cik, instrument_type, name
    ) values (
      'veea-series-a-preferred-20260330', '0001840317', 'warrant', 'duplicate'
    )$$,
  '23505', null, 'instrument_key is unique'
);

select throws_ok(
  $$insert into public.dilution_instruments (
      instrument_key, issuer_cik, instrument_type, name
    ) values (
      'invalid-type-fixture', '0001840317', 'option', 'invalid type'
    )$$,
  '23514', null, 'invalid instrument_type is rejected'
);

select throws_ok(
  $$insert into public.dilution_instrument_snapshots (
      instrument_id, as_of_date, status
    ) select id, '2026-08-28', 'unknown'
      from public.dilution_instruments limit 1$$,
  '23514', null, 'invalid snapshot status is rejected'
);

select throws_ok(
  $$insert into public.dilution_instrument_snapshots (
      instrument_id, as_of_date, status
    ) values (9223372036854775807, '2026-08-28', 'current')$$,
  '23503', null, 'snapshot instrument_id must reference an existing instrument'
);

select throws_ok(
  $$insert into public.dilution_instrument_activity (
      issuer_cik, instrument_id, activity_type
    ) values ('0001840317', 9223372036854775807, 'fixture')$$,
  '23503', null, 'non-null activity instrument_id enforces its foreign key'
);

select is(
  (select count(*)::integer from public.dilution_instruments),
  20,
  'VEEA fixture inserts 20 instruments'
);

select is(
  (select count(*)::integer from public.dilution_instrument_snapshots),
  20,
  'VEEA fixture inserts 20 snapshots'
);

select is(
  (select count(*)::integer from public.dilution_instrument_activity),
  8,
  'VEEA fixture inserts 8 activities'
);

select is(
  (select count(*)::integer from public.dilution_totals),
  4,
  'VEEA fixture inserts 4 totals'
);

select results_eq(
  $$select instrument_type, count(*)::bigint
      from public.dilution_instruments
     group by instrument_type
     order by instrument_type$$,
  $$values
      ('atm_program'::text, 1::bigint),
      ('convertible_note'::text, 7::bigint),
      ('convertible_preferred'::text, 2::bigint),
      ('equity_line'::text, 1::bigint),
      ('warrant'::text, 9::bigint)$$,
  'instrument type counts round-trip exactly'
);

select results_eq(
  $$select status, count(*)::bigint
      from public.dilution_instrument_snapshots
     group by status
     order by status$$,
  $$values
      ('closed'::text, 4::bigint),
      ('current'::text, 16::bigint)$$,
  'snapshot status counts preserve current 16, old 0, closed 4'
);

select is(
  (select total_shares
   from public.dilution_totals
   where name = 'All Warrants'),
  76513659::numeric,
  'warrant total shares round-trip exactly'
);

select is(
  (select other_shares
   from public.dilution_totals
   where name = 'All Warrants'),
  8641299::numeric,
  'warrant other shares round-trip exactly'
);

select is(
  (select sum(snapshot.remaining_potential_shares)
   from public.dilution_instrument_snapshots as snapshot
   join public.dilution_instruments as instrument on instrument.id = snapshot.instrument_id
   where instrument.instrument_type = 'warrant'
     and snapshot.status = 'current'),
  67872360::numeric,
  'individual current warrant potential shares sum to 67,872,360'
);

select is(
  (select total_amount
   from public.dilution_totals
   where name = 'White Lion Notes' and as_of_date = '2026-06-30'),
  1156668::numeric,
  'White Lion 6/30 group amount round-trips exactly'
);

select is(
  (select count(*)::integer
   from public.dilution_instrument_snapshots as snapshot
   join public.dilution_instruments as instrument on instrument.id = snapshot.instrument_id
   where instrument.instrument_key = any(array[
       'veea-white-lion-note-first',
       'veea-white-lion-note-second',
       'veea-white-lion-note-third'
     ]::text[])
     and snapshot.as_of_date = '2026-06-30'
     and snapshot.remaining_amount is not null),
  0,
  'White Lion group amount is not forced into individual note balances'
);

select is(
  (select count(*)::integer
   from public.dilution_instruments
   where instrument_key like 'veea-crowdkeep-note-%'),
  2,
  'two Crowdkeep note instruments remain separate'
);

select is(
  (select total_amount
   from public.dilution_totals
   where name = 'Crowdkeep Notes' and as_of_date = '2026-06-30'),
  1000000::numeric,
  'Crowdkeep group amount round-trips exactly'
);

select ok(
  (select snapshot.original_capacity = 25000000::numeric
          and snapshot.used_amount = 904431::numeric
          and snapshot.remaining_capacity = 24095569::numeric
   from public.dilution_instrument_snapshots as snapshot
   join public.dilution_instruments as instrument on instrument.id = snapshot.instrument_id
   where instrument.instrument_key = 'veea-white-lion-eloc'
     and snapshot.as_of_date = '2026-06-30'),
  'ELOC original, used, and remaining capacity round-trip exactly'
);

select ok(
  (select activity.shares_issued = 1958479::numeric
          and activity.instrument_id is null
          and activity.related_instrument_keys = array[
            'veea-white-lion-eloc',
            'veea-white-lion-note-first',
            'veea-white-lion-note-second',
            'veea-white-lion-note-third',
            'veea-white-lion-note-fourth'
          ]::text[]
   from public.dilution_instrument_activity as activity
   where activity.activity_type = 'share_issuance'
     and activity.activity_date = '2026-08-10'),
  '8/10 activity preserves shares, null instrument_id, and all related keys'
);

select ok(
  (select included_instrument_keys = array[
      'veea-nlabs-warrant-20260330',
      'veea-nlabs-warrant-20260625',
      'veea-2025-investor-warrants',
      'veea-public-warrants',
      'veea-spac-private-warrants',
      'veea-legacy-assumed-warrants'
    ]::text[]
   from public.dilution_totals
   where name = 'All Warrants'),
  'totals preserve included instrument keys in supplied order'
);

select ok(
  (select snapshot.remaining_amount is null
          and snapshot.repaid_amount is null
          and snapshot.interest_converted is null
   from public.dilution_instrument_snapshots as snapshot
   join public.dilution_instruments as instrument on instrument.id = snapshot.instrument_id
   where instrument.instrument_key = 'veea-white-lion-note-first'
     and snapshot.as_of_date = '2026-06-30'),
  'unknown snapshot numeric values remain null instead of zero'
);

select is(
  (select count(*)
   from information_schema.columns
   where table_schema = 'public'
     and table_name in (
       'dilution_instrument_snapshots',
       'dilution_instrument_activity',
       'dilution_totals'
     )
     and column_name in (
       'original_amount', 'remaining_amount', 'converted_amount', 'repaid_amount',
       'interest_rate', 'interest_converted', 'original_units', 'remaining_units',
       'converted_units', 'exercised_units', 'cancelled_units', 'expired_units',
       'stated_value', 'original_capacity', 'used_amount', 'remaining_capacity',
       'shares_issued', 'shares_sold', 'gross_proceeds', 'remaining_potential_shares',
       'conversion_price', 'exercise_price', 'floor_price', 'term_months',
       'registered_resale_shares', 'units_issued', 'amount_converted', 'amount_repaid',
       'units_converted', 'units_exercised', 'units_cancelled', 'units_expired',
       'total_shares', 'other_shares', 'total_amount', 'other_amount'
     )
     and data_type <> 'numeric'),
  0::bigint,
  'all requested number-bearing columns use numeric rather than float types'
);

select * from finish();

rollback;
