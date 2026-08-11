begin;

select plan(11);

select has_column('public', 'event_form4_transactions', 'economic_direction', 'Form 4 stores canonical economic direction separately');
select has_column('public', 'event_form144_proposed_sales', 'reporting_owner_names', 'Form 144 preserves reporting-owner identities');

insert into public.sources (code, name, source_group, runtime_owner, enabled)
values ('ownership_analysis_fixture', 'Ownership Analysis fixture', 'filings', 'manual', false)
on conflict (code) do nothing;

insert into public.events (
  id, source_code, source_group, source_name, published_at, ticker, event_type,
  score, delivery_level, impact, signal, market_scope, title, group_dedupe_key
) values (
  '99000000-0000-4000-8000-000000000003', 'ownership_analysis_fixture', 'filings',
  'Ownership Analysis fixture', '2026-08-11 00:00:00+00', 'OWNR', 'insider_ownership', 55,
  'feed', 'medium', 'neutral', 'company', 'Ownership Analysis fixture event',
  'pg-tap:ownership-analysis'
);

select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000003',
    '[
      {"transaction_index":0,"symbol":"OWNR","reporting_owner_names":["Owner One"],"reporting_owner_roles":["CEO","Director"],"officer_titles":["Chief Executive Officer"],"is_officer":true,"is_director":true,"is_10_percent_owner":false,"officer_title":"Chief Executive Officer","is_10b5_1":true,"transaction_kind":"non_derivative","transaction_date":"2026-08-10","transaction_code":"P","acquired_disposed_code":"A","economic_direction":"buy","shares":100,"shares_quality":"exact","price_per_share":10,"price_per_share_quality":"exact","transaction_value":1000,"transaction_value_quality":"derived","post_transaction_shares":1100,"shares_value_quality":"exact","shares_availability":"available","price_per_share_value_quality":"exact","price_per_share_availability":"available","transaction_value_value_quality":"derived","transaction_value_availability":"available","post_transaction_shares_value_quality":"exact","post_transaction_shares_availability":"available","confidence":0.95,"provenance":{"source":"sec_ownership_analysis","parser_fallback":false},"evidence":["source row"],"calculation_basis":{"formula":"shares * price_per_share"}},
      {"transaction_index":1,"symbol":"OWNR","reporting_owner_names":["Owner One"],"reporting_owner_roles":["CEO","Director"],"officer_titles":["Chief Executive Officer"],"is_officer":true,"is_director":true,"is_10_percent_owner":false,"is_10b5_1":null,"transaction_kind":null,"transaction_code":"S","acquired_disposed_code":"D","economic_direction":"sell","shares":40,"shares_value_quality":"unknown","shares_availability":"available","price_per_share":null,"price_per_share_value_quality":"unknown","price_per_share_availability":"unavailable","transaction_value":null,"transaction_value_quality":null,"transaction_value_value_quality":"unknown","transaction_value_availability":"unavailable","post_transaction_shares":null,"post_transaction_shares_value_quality":"unknown","post_transaction_shares_availability":"unavailable","confidence":null,"provenance":{"source":"sec_ownership_analysis","parser_fallback":false},"evidence":[],"calculation_basis":{}},
      {"transaction_index":2,"symbol":"OWNR","reporting_owner_names":["Owner Two"],"reporting_owner_roles":["10% Owner"],"officer_titles":[],"is_10_percent_owner":true,"is_10b5_1":null,"transaction_kind":"derivative","transaction_code":"M","acquired_disposed_code":"A","economic_direction":"other","shares":25,"shares_value_quality":"unknown","shares_availability":"available","price_per_share":5,"price_per_share_value_quality":"exact","price_per_share_availability":"available","transaction_value":125,"transaction_value_quality":"unknown","transaction_value_value_quality":"unknown","transaction_value_availability":"available","post_transaction_shares":500,"post_transaction_shares_value_quality":"unknown","post_transaction_shares_availability":"available","confidence":0.75,"provenance":{"source":"sec_ownership_analysis","parser_fallback":false},"evidence":[],"calculation_basis":{"formula":"shares * price_per_share"}}
    ]'::jsonb,
    '[{"proposed_sale_index":0,"symbol":"OWNR","seller_name":"Owner One","reporting_owner_names":["Owner One","Owner Trust"],"security_title":"Common Stock","exchange":"NASDAQ","securities_to_be_sold":25000,"securities_to_be_sold_quality":"exact","aggregate_market_value":175000,"aggregate_market_value_quality":"exact","approximate_sale_date":"2026-08-15","shares_outstanding":100000000,"shares_outstanding_quality":"exact","proposed_sale_percent":0.025,"proposed_sale_percent_quality":"derived","securities_to_be_sold_value_quality":"exact","securities_to_be_sold_availability":"available","aggregate_market_value_value_quality":"exact","aggregate_market_value_availability":"available","shares_outstanding_value_quality":"exact","shares_outstanding_availability":"available","proposed_sale_percent_value_quality":"derived","proposed_sale_percent_availability":"available","confidence":0.95,"provenance":{"source":"sec_ownership_analysis","parser_fallback":false},"evidence":[],"calculation_basis":{"formula":"securities_to_be_sold / shares_outstanding * 100"}}]'::jsonb
  ),
  '{"form4_transaction_count": 3, "form144_proposed_sale_count": 1}'::jsonb,
  'raw Form 4 and Form 144 Analysis rows replace atomically'
);

select is((select count(*)::integer from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000003'), 3, 'raw Form 4 rows persist without netting');
select results_eq(
  $$ select economic_direction from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000003' order by transaction_index $$,
  $$ values ('buy'::text), ('sell'::text), ('other'::text) $$,
  'economic direction persists independently from transaction code and A/D'
);
select ok(
  (select reporting_owner_roles = '["CEO", "Director"]'::jsonb and is_officer and is_director and is_10b5_1
   from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000003' and transaction_index = 0),
  'multiple normalized roles and reliable 10b5-1 true persist'
);
select ok(
  (select confidence is null and is_10b5_1 is null and shares = 40 and shares_value_quality = 'unknown' and shares_availability = 'available'
   from public.event_form4_transactions where event_id = '99000000-0000-4000-8000-000000000003' and transaction_index = 1),
  'unknown confidence and 10b5-1 remain null while available unknown-quality numeric evidence persists'
);
select is(
  (select reporting_owner_names from public.event_form144_proposed_sales where event_id = '99000000-0000-4000-8000-000000000003'),
  '["Owner One", "Owner Trust"]'::jsonb,
  'all Form 144 reporting owners persist'
);
select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000003',
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form4_transactions f where event_id = '99000000-0000-4000-8000-000000000003' and transaction_index < 2),
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form144_proposed_sales f where event_id = '99000000-0000-4000-8000-000000000003')
  ),
  '{"form4_transaction_count": 2, "form144_proposed_sale_count": 1}'::jsonb,
  'scoped replacement removes stale raw rows'
);
select is(
  public.replace_event_ownership_facts(
    '99000000-0000-4000-8000-000000000003',
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form4_transactions f where event_id = '99000000-0000-4000-8000-000000000003'),
    (select jsonb_agg(to_jsonb(f) - 'event_id' - 'created_at') from public.event_form144_proposed_sales f where event_id = '99000000-0000-4000-8000-000000000003')
  ),
  '{"form4_transaction_count": 2, "form144_proposed_sale_count": 1}'::jsonb,
  'same Ownership Analysis input is idempotent'
);
select is(
  public.replace_event_ownership_facts('99000000-0000-4000-8000-000000000003', '[]'::jsonb, '[]'::jsonb),
  '{"form4_transaction_count": 0, "form144_proposed_sale_count": 0}'::jsonb,
  'successful known-empty Ownership Analysis clears stale rows'
);

select * from finish();
rollback;
