begin;

select plan(18);

select has_table('public', 'event_market_snapshots', 'event-time market snapshot table exists');
select has_table('public', 'event_form4_transactions', 'typed Form 4 transaction table exists');
select has_table('public', 'event_form144_proposed_sales', 'typed Form 144 proposed-sale table exists');

select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class where oid in (
    'public.event_market_snapshots'::regclass,
    'public.event_form4_transactions'::regclass,
    'public.event_form144_proposed_sales'::regclass
  )),
  'all monitor foundation tables have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.event_market_snapshots', 'select')
  and not has_table_privilege('anon', 'public.event_form4_transactions', 'select')
  and not has_table_privilege('anon', 'public.event_form144_proposed_sales', 'select'),
  'anonymous clients cannot read monitor foundation data'
);

select ok(
  not has_table_privilege('authenticated', 'public.event_market_snapshots', 'select')
  and not has_table_privilege('authenticated', 'public.event_form4_transactions', 'select')
  and not has_table_privilege('authenticated', 'public.event_form144_proposed_sales', 'select'),
  'authenticated clients cannot read monitor foundation data'
);

select ok(
  has_table_privilege('service_role', 'public.event_market_snapshots', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.event_form4_transactions', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.event_form144_proposed_sales', 'select,insert,update,delete'),
  'service role manages monitor foundation persistence'
);

select is(
  (select count(*)::integer from public.event_types where metadata ->> 'taxonomy_version' = 'canonical_event_types_v1'),
  19,
  'the existing 19-event canonical taxonomy is unchanged'
);

select has_column('public', 'event_offering_terms', 'offering_amount', 'offering facts remain in event_offering_terms');

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('monitor_fixture', 'Monitor fixture', 'filings', 'manual', false)
on conflict (code) do nothing;

select lives_ok(
  $$ insert into public.events (
    id, source_code, source_group, source_name, published_at, ticker, event_type,
    score, delivery_level, impact, signal, market_scope, title, group_dedupe_key
  ) values (
    '99000000-0000-4000-8000-000000000001', 'monitor_fixture', 'filings', 'Monitor fixture',
    '2026-08-11 00:00:00+00', 'MONI', 'other', 10, 'archive', 'low', 'neutral', 'company',
    'Monitor fixture event', 'pg-tap:monitor-foundation'
  ) $$,
  'fixture event can be created without monitor facts'
);

select lives_ok(
  $$ insert into public.event_market_snapshots (
    event_id, symbol, security_key, snapshot_status, event_time,
    source_kind, unavailable_reason, price_quality, market_cap_quality
  ) values (
    '99000000-0000-4000-8000-000000000001', 'MONI', 'primary', 'unavailable',
    '2026-08-11 00:00:00+00', 'unavailable',
    'analysis_context_and_valid_local_market_data_unavailable', 'unavailable', 'unavailable'
  ) $$,
  'an explicit unavailable snapshot is valid and does not require market values'
);

select is(
  (select count(*)::integer from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000001'),
  1,
  'one event/ticker/security snapshot is stored'
);

select lives_ok(
  $$ insert into public.event_form4_transactions (
    event_id, transaction_index, symbol, transaction_kind, transaction_code,
    acquired_disposed_code, shares, shares_quality, price_per_share,
    price_per_share_quality, transaction_value, transaction_value_quality,
    confidence, provenance, calculation_basis
  ) values
  (
    '99000000-0000-4000-8000-000000000001', 0, 'MONI', 'non_derivative', 'P',
    'A', 100, 'exact', 10, 'exact', 1000, 'derived', 0.95,
    '{"source":"fixture"}'::jsonb, '{"formula":"shares * price_per_share"}'::jsonb
  ),
  (
    '99000000-0000-4000-8000-000000000001', 1, 'MONI', 'non_derivative', 'S',
    'D', 40, 'exact', 12, 'exact', 480, 'derived', 0.95,
    '{"source":"fixture"}'::jsonb, '{"formula":"shares * price_per_share"}'::jsonb
  ) $$,
  'separate Form 4 buy and sell rows are stored without netting'
);

select is(
  (select count(*)::integer from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000001'),
  2,
  'both Form 4 transaction rows are preserved'
);

select throws_ok(
  $$ insert into public.event_form4_transactions (
    event_id, transaction_index, symbol, transaction_kind, shares, price_per_share,
    transaction_value, transaction_value_quality, confidence, provenance
  ) values (
    '99000000-0000-4000-8000-000000000001', 2, 'MONI', 'non_derivative',
    10, 10, 100, 'exact', 0.95, '{"source":"fixture"}'::jsonb
  ) $$,
  '23514',
  null,
  'Form 4 transaction value cannot be classified as exact'
);

select lives_ok(
  $$ insert into public.event_form144_proposed_sales (
    event_id, proposed_sale_index, symbol, securities_to_be_sold,
    securities_to_be_sold_quality, aggregate_market_value,
    aggregate_market_value_quality, shares_outstanding,
    shares_outstanding_quality, proposed_sale_percent,
    proposed_sale_percent_quality, confidence, provenance, calculation_basis
  ) values (
    '99000000-0000-4000-8000-000000000001', 0, 'MONI', 25000,
    'exact', 175000, 'exact', 100000000, 'exact', 0.025,
    'derived', 0.95, '{"source":"fixture"}'::jsonb,
    '{"formula":"securities_to_be_sold / shares_outstanding * 100"}'::jsonb
  ) $$,
  'Form 144 exact source value and derived percentage are accepted'
);

select is(
  (select proposed_sale_percent from public.event_form144_proposed_sales where event_id = '99000000-0000-4000-8000-000000000001'),
  0.025::numeric,
  'Form 144 proposed-sale percentage remains a separate derived fact'
);

select throws_ok(
  $$ insert into public.event_form144_proposed_sales (
    event_id, proposed_sale_index, symbol, securities_to_be_sold,
    proposed_sale_percent, proposed_sale_percent_quality, confidence, provenance
  ) values (
    '99000000-0000-4000-8000-000000000001', 1, 'MONI', 1000,
    5, 'derived', 0.95, '{"source":"fixture"}'::jsonb
  ) $$,
  '23514',
  null,
  'Form 144 percentage is rejected without a denominator'
);

select * from finish();
rollback;
