begin;

select plan(49);

select has_column('public', 'event_market_snapshots', 'shares_outstanding', 'snapshot has market shares outstanding');
select has_column('public', 'event_market_snapshots', 'float_shares', 'snapshot has market float shares');
select has_column('public', 'event_market_snapshots', 'price_value_quality', 'snapshot separates price value quality');
select has_column('public', 'event_market_snapshots', 'price_availability', 'snapshot separates price availability');
select has_column('public', 'event_form4_transactions', 'post_transaction_shares', 'Form 4 has post-transaction shares');
select has_column('public', 'event_form4_transactions', 'reporting_owner_roles', 'Form 4 supports multiple owner roles');
select has_column('public', 'event_form4_transactions', 'is_officer', 'Form 4 stores officer flag');
select has_column('public', 'event_form4_transactions', 'is_director', 'Form 4 stores director flag');
select has_column('public', 'event_form4_transactions', 'is_10_percent_owner', 'Form 4 stores ten-percent-owner flag');
select has_column('public', 'event_form4_transactions', 'officer_title', 'Form 4 stores officer title');
select has_column('public', 'event_form4_transactions', 'is_10b5_1', 'Form 4 stores 10b5-1 flag');
select has_column('public', 'event_form4_transactions', 'fact_as_of', 'Form 4 stores fact as-of date');
select has_column('public', 'event_form144_proposed_sales', 'exchange', 'Form 144 stores parser-supplied exchange');

select is(
  (select count(*)::integer from public.event_types where metadata ->> 'taxonomy_version' = 'canonical_event_types_v1'),
  19,
  'the existing 19-event taxonomy remains unchanged'
);
select has_column('public', 'event_offering_terms', 'offering_amount', 'offering facts remain canonical typed columns');
select has_table('public', 'user_alert_deliveries', 'alert delivery persistence is unchanged');
select ok(
  has_function_privilege('service_role', 'public.replace_event_market_snapshots(uuid,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.replace_event_ownership_facts(uuid,jsonb,jsonb)', 'execute'),
  'service role can execute scoped replace functions'
);
select ok(
  not has_function_privilege('anon', 'public.replace_event_market_snapshots(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.replace_event_ownership_facts(uuid,jsonb,jsonb)', 'execute'),
  'client roles cannot execute monitor replace functions'
);

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('monitor_corrective_fixture', 'Monitor corrective fixture', 'filings', 'manual', false)
on conflict (code) do nothing;

insert into public.events (
  id, source_code, source_group, source_name, published_at, ticker, event_type,
  score, delivery_level, impact, signal, market_scope, title, group_dedupe_key
) values (
  '99000000-0000-4000-8000-000000000002', 'monitor_corrective_fixture', 'filings',
  'Monitor corrective fixture', '2026-08-11 00:00:00+00', 'MONI', 'other', 10,
  'archive', 'low', 'neutral', 'company', 'Monitor corrective fixture event',
  'pg-tap:monitor-corrective'
);

select is(
  public.replace_event_market_snapshots(
    '99000000-0000-4000-8000-000000000002',
    '[
      {"symbol":"AAA","security_key":"primary","snapshot_status":"available","event_time":"2026-08-11T00:00:00Z","price":10,"market_cap":1000000,"shares_outstanding":100000,"float_shares":null,"price_value_quality":"exact","price_availability":"available","market_cap_value_quality":"estimated","market_cap_availability":"available","shares_outstanding_value_quality":"derived","shares_outstanding_availability":"available","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"analysis_context","provenance":{},"field_sources":{}},
      {"symbol":"AAA","security_key":"class-b","snapshot_status":"unavailable","event_time":"2026-08-11T00:00:00Z","price":null,"market_cap":null,"shares_outstanding":null,"float_shares":null,"price_value_quality":"unknown","price_availability":"unavailable","market_cap_value_quality":"unknown","market_cap_availability":"unavailable","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"unavailable","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"unavailable","unavailable_reason":"local_data_unavailable","provenance":{},"field_sources":{}},
      {"symbol":"BBB","security_key":"primary","snapshot_status":"available","event_time":"2026-08-11T00:00:00Z","price":20,"market_cap":2000000,"shares_outstanding":200000,"float_shares":150000,"price_value_quality":"exact","price_availability":"available","market_cap_value_quality":"exact","market_cap_availability":"available","shares_outstanding_value_quality":"exact","shares_outstanding_availability":"available","float_shares_value_quality":"exact","float_shares_availability":"available","source_kind":"local_market_snapshot","provenance":{},"field_sources":{}}
    ]'::jsonb
  ),
  3,
  'three event/ticker/security snapshots replace successfully'
);
select is((select count(*)::integer from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002'), 3, 'all three snapshot identities persist');
select is((select price_value_quality from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002' and symbol = 'AAA' and security_key = 'primary'), 'exact', 'exact quality persists');
select is((select market_cap_value_quality from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002' and symbol = 'AAA' and security_key = 'primary'), 'estimated', 'estimated quality persists');
select is((select shares_outstanding_value_quality from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002' and symbol = 'AAA' and security_key = 'primary'), 'derived', 'derived quality persists');
select ok(
  (select float_shares is null and float_shares_value_quality = 'unknown' and float_shares_availability = 'unavailable'
   from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002' and symbol = 'AAA' and security_key = 'primary'),
  'unknown quality and unavailable status are separate and non-numeric'
);
select lives_ok(
  $$ insert into public.event_market_snapshots (
    event_id, symbol, security_key, snapshot_status, event_time, price,
    price_value_quality, price_availability, source_kind, unavailable_reason
  ) values (
    '99000000-0000-4000-8000-000000000002', 'BAD', 'primary', 'partial',
    '2026-08-11T00:00:00Z', 1, 'unknown', 'available', 'analysis_context', null
  ) $$,
  'available unknown-quality numeric evidence is retained'
);
select ok(
  (select price = 1 and price_value_quality = 'unknown' and price_availability = 'available'
   from public.event_market_snapshots
   where event_id = '99000000-0000-4000-8000-000000000002' and symbol = 'BAD'),
  'available unknown-quality numeric evidence remains distinct from absent data and is not comparison-eligible'
);

select is(
  public.replace_event_market_snapshots(
    '99000000-0000-4000-8000-000000000002',
    '[
      {"symbol":"AAA","security_key":"primary","snapshot_status":"unavailable","event_time":"2026-08-11T00:00:00Z","price":null,"market_cap":null,"shares_outstanding":null,"float_shares":null,"price_value_quality":"unknown","price_availability":"unavailable","market_cap_value_quality":"unknown","market_cap_availability":"unavailable","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"unavailable","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"unavailable","unavailable_reason":"local_data_unavailable","provenance":{},"field_sources":{}},
      {"symbol":"BBB","security_key":"primary","snapshot_status":"unavailable","event_time":"2026-08-11T00:00:00Z","price":null,"market_cap":null,"shares_outstanding":null,"float_shares":null,"price_value_quality":"unknown","price_availability":"unavailable","market_cap_value_quality":"unknown","market_cap_availability":"unavailable","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"unavailable","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"unavailable","unavailable_reason":"local_data_unavailable","provenance":{},"field_sources":{}}
    ]'::jsonb
  ), 2, 'three-to-two replacement succeeds'
);
select is((select count(*)::integer from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002'), 2, 'stale third snapshot is deleted');
select is(public.replace_event_market_snapshots('99000000-0000-4000-8000-000000000002', (select jsonb_agg(to_jsonb(s) - 'event_id' - 'created_at') from public.event_market_snapshots s where event_id = '99000000-0000-4000-8000-000000000002')), 2, 'same snapshot input is idempotent');
select is((select count(distinct (symbol, security_key))::integer from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002'), 2, 'multiple ticker/security identities remain distinct');
select is(public.replace_event_market_snapshots('99000000-0000-4000-8000-000000000002', '[]'::jsonb), 0, 'successful tickerless empty replacement returns zero');
select is((select count(*)::integer from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002'), 0, 'successful tickerless empty replacement clears stale snapshots');

select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000002',
    '[
      {"transaction_index":0,"symbol":"MONI","reporting_owner_names":["Owner One"],"reporting_owner_roles":["Officer","Director"],"officer_titles":["CFO"],"is_officer":true,"is_director":true,"is_10_percent_owner":false,"officer_title":"CFO","is_10b5_1":true,"transaction_kind":"non_derivative","transaction_date":"2026-08-10","transaction_code":"P","acquired_disposed_code":"A","shares":100,"shares_quality":"exact","price_per_share":10,"price_per_share_quality":"exact","transaction_value":1000,"transaction_value_quality":"derived","post_transaction_shares":1100,"shares_value_quality":"exact","shares_availability":"available","price_per_share_value_quality":"exact","price_per_share_availability":"available","transaction_value_value_quality":"derived","transaction_value_availability":"available","post_transaction_shares_value_quality":"exact","post_transaction_shares_availability":"available","fact_as_of":"2026-08-10","confidence":0.95,"provenance":{"source":"fixture"},"evidence":[],"calculation_basis":{"formula":"shares * price_per_share"}},
      {"transaction_index":1,"symbol":"MONI","reporting_owner_names":["Owner One"],"reporting_owner_roles":["Officer","Director"],"officer_titles":["CFO"],"is_officer":true,"is_director":true,"is_10_percent_owner":false,"officer_title":"CFO","is_10b5_1":true,"transaction_kind":"non_derivative","transaction_code":"S","acquired_disposed_code":"D","shares":40,"shares_quality":"exact","price_per_share":12,"price_per_share_quality":"exact","transaction_value":480,"transaction_value_quality":"derived","post_transaction_shares":1060,"shares_value_quality":"exact","shares_availability":"available","price_per_share_value_quality":"exact","price_per_share_availability":"available","transaction_value_value_quality":"derived","transaction_value_availability":"available","post_transaction_shares_value_quality":"exact","post_transaction_shares_availability":"available","confidence":0.95,"provenance":{"source":"fixture"},"evidence":[],"calculation_basis":{"formula":"shares * price_per_share"}},
      {"transaction_index":2,"symbol":"MONI","reporting_owner_names":["Owner Two"],"reporting_owner_roles":["10% Owner"],"officer_titles":[],"is_officer":false,"is_director":false,"is_10_percent_owner":true,"is_10b5_1":false,"transaction_kind":"derivative","transaction_code":"M","acquired_disposed_code":"A","shares":25,"shares_quality":"exact","price_per_share":5,"price_per_share_quality":"exact","transaction_value":125,"transaction_value_quality":"derived","post_transaction_shares":500,"shares_value_quality":"unknown","shares_availability":"available","price_per_share_value_quality":"unknown","price_per_share_availability":"available","transaction_value_value_quality":"unknown","transaction_value_availability":"available","post_transaction_shares_value_quality":"unknown","post_transaction_shares_availability":"available","confidence":0.95,"provenance":{"source":"fixture"},"evidence":[],"calculation_basis":{"formula":"shares * price_per_share"}}
    ]'::jsonb,
    '[{"proposed_sale_index":0,"symbol":"MONI","seller_name":"Owner One","security_title":"Common Stock","exchange":"NASDAQ","securities_to_be_sold":25000,"securities_to_be_sold_quality":"exact","aggregate_market_value":175000,"aggregate_market_value_quality":"exact","approximate_sale_date":"2026-08-15","shares_outstanding":100000000,"shares_outstanding_quality":"exact","proposed_sale_percent":0.025,"proposed_sale_percent_quality":"derived","securities_to_be_sold_value_quality":"unknown","securities_to_be_sold_availability":"available","aggregate_market_value_value_quality":"unknown","aggregate_market_value_availability":"available","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"available","proposed_sale_percent_value_quality":"unknown","proposed_sale_percent_availability":"available","fact_as_of":"2026-08-15","confidence":0.95,"provenance":{"source":"fixture"},"evidence":[],"calculation_basis":{"formula":"securities_to_be_sold / shares_outstanding * 100"}}]'::jsonb
  ),
  '{"form4_transaction_count": 3, "form144_proposed_sale_count": 1}'::jsonb,
  'three Form 4 rows and one Form 144 row replace atomically'
);
select is((select count(*)::integer from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000002'), 3, 'all Form 4 transactions persist without netting');
select ok(
  (select post_transaction_shares = 1100 and reporting_owner_roles = '["Officer", "Director"]'::jsonb and is_10b5_1 and not is_10_percent_owner
   from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000002' and transaction_index = 0),
  'post shares, multiple roles, owner flags, and 10b5-1 persist'
);
select ok(
  (select shares = 25 and shares_value_quality = 'unknown' and shares_availability = 'available'
      and price_per_share = 5 and price_per_share_value_quality = 'unknown' and price_per_share_availability = 'available'
      and transaction_value = 125 and transaction_value_value_quality = 'unknown' and transaction_value_availability = 'available'
      and post_transaction_shares = 500 and post_transaction_shares_value_quality = 'unknown' and post_transaction_shares_availability = 'available'
   from public.event_form4_transactions
   where event_id = '99000000-0000-4000-8000-000000000002' and transaction_index = 2),
  'all Form 4 numeric facts allow available unknown-quality evidence'
);
select is((select exchange from public.event_form144_proposed_sales where event_id = '99000000-0000-4000-8000-000000000002'), 'NASDAQ', 'Form 144 exchange persists');
select ok(
  (select securities_to_be_sold = 25000 and securities_to_be_sold_value_quality = 'unknown' and securities_to_be_sold_availability = 'available'
      and aggregate_market_value = 175000 and aggregate_market_value_value_quality = 'unknown' and aggregate_market_value_availability = 'available'
      and shares_outstanding = 100000000 and shares_outstanding_value_quality = 'unknown' and shares_outstanding_availability = 'available'
      and proposed_sale_percent = 0.025 and proposed_sale_percent_value_quality = 'unknown' and proposed_sale_percent_availability = 'available'
   from public.event_form144_proposed_sales
   where event_id = '99000000-0000-4000-8000-000000000002'),
  'all Form 144 numeric facts allow available unknown-quality evidence'
);
select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000002',
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form4_transactions f where event_id = '99000000-0000-4000-8000-000000000002' and transaction_index < 2),
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form144_proposed_sales f where event_id = '99000000-0000-4000-8000-000000000002')
  ),
  '{"form4_transaction_count": 2, "form144_proposed_sale_count": 1}'::jsonb,
  'ownership three-to-two replacement succeeds'
);
select is((select count(*)::integer from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000002'), 2, 'stale third Form 4 row is deleted');
select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000002',
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form4_transactions f where event_id = '99000000-0000-4000-8000-000000000002'),
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form144_proposed_sales f where event_id = '99000000-0000-4000-8000-000000000002')
  ),
  '{"form4_transaction_count": 2, "form144_proposed_sale_count": 1}'::jsonb,
  'same ownership input is idempotent'
);
select is(public.replace_event_ownership_facts('99000000-0000-4000-8000-000000000002', '[]'::jsonb, '[]'::jsonb), '{"form4_transaction_count": 0, "form144_proposed_sale_count": 0}'::jsonb, 'successful known-empty ownership clears the domain');
select ok(
  not exists (select 1 from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.event_form144_proposed_sales where event_id = '99000000-0000-4000-8000-000000000002'),
  'known-empty ownership leaves no stale rows'
);

select is(public.replace_event_market_snapshots(
  '99000000-0000-4000-8000-000000000002',
  '[{"symbol":"KEEP","security_key":"primary","snapshot_status":"unavailable","event_time":"2026-08-11T00:00:00Z","price":null,"market_cap":null,"shares_outstanding":null,"float_shares":null,"price_value_quality":"unknown","price_availability":"unavailable","market_cap_value_quality":"unknown","market_cap_availability":"unavailable","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"unavailable","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"unavailable","unavailable_reason":"unavailable","provenance":{},"field_sources":{}}]'::jsonb
), 1, 'valid snapshot is seeded for rollback test');
select throws_ok(
  $$ select public.replace_event_market_snapshots(
    '99000000-0000-4000-8000-000000000002',
    '[{"symbol":"lowercase","security_key":"primary","snapshot_status":"unavailable","event_time":"2026-08-11T00:00:00Z","price_value_quality":"unknown","price_availability":"unavailable","market_cap_value_quality":"unknown","market_cap_availability":"unavailable","shares_outstanding_value_quality":"unknown","shares_outstanding_availability":"unavailable","float_shares_value_quality":"unknown","float_shares_availability":"unavailable","source_kind":"unavailable","unavailable_reason":"invalid","provenance":{},"field_sources":{}}]'::jsonb
  ) $$,
  '23514', null, 'invalid snapshot replacement fails'
);
select is((select symbol from public.event_market_snapshots where event_id = '99000000-0000-4000-8000-000000000002'), 'KEEP', 'failed snapshot replacement preserves prior valid rows');

select is(public.replace_event_ownership_facts(
  '99000000-0000-4000-8000-000000000002',
  '[{"transaction_index":0,"symbol":"MONI","reporting_owner_names":[],"reporting_owner_roles":[],"officer_titles":[],"transaction_kind":"non_derivative","shares":null,"price_per_share":null,"transaction_value":null,"post_transaction_shares":null,"shares_value_quality":"unknown","shares_availability":"unavailable","price_per_share_value_quality":"unknown","price_per_share_availability":"unavailable","transaction_value_value_quality":"unknown","transaction_value_availability":"unavailable","post_transaction_shares_value_quality":"unknown","post_transaction_shares_availability":"unavailable","confidence":0.5,"provenance":{"source":"fixture"},"evidence":[],"calculation_basis":{}}]'::jsonb,
  '[]'::jsonb
), '{"form4_transaction_count": 1, "form144_proposed_sale_count": 0}'::jsonb, 'valid ownership row is seeded for rollback test');
select throws_ok(
  $$ select public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000002',
    '[{"transaction_index":1,"reporting_owner_names":[],"reporting_owner_roles":[],"officer_titles":[],"transaction_kind":"invalid","shares_value_quality":"unknown","shares_availability":"unavailable","price_per_share_value_quality":"unknown","price_per_share_availability":"unavailable","transaction_value_value_quality":"unknown","transaction_value_availability":"unavailable","post_transaction_shares_value_quality":"unknown","post_transaction_shares_availability":"unavailable","confidence":0.5,"provenance":{},"evidence":[],"calculation_basis":{}}]'::jsonb,
    '[]'::jsonb
  ) $$,
  '23514', null, 'invalid ownership replacement fails'
);
select is((select transaction_index from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000002'), 0, 'failed ownership replacement preserves prior valid rows');

select * from finish();
rollback;
