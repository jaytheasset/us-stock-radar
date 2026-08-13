begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ), 'listing_risk_domain_analyzer_v10') > 0,
  'persistence explicitly recognizes Core and Agent analyzer v10'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) ~ 'listing_risk_domain_analyzer_v8[\s\S]+listing_risk_domain_analyzer_v9[\s\S]+listing_risk_domain_analyzer_v10[\s\S]+listing_risk_event_facts_v2',
  'persistence maps v8 through v10 analyzer contracts to canonical facts V2'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.read_current_event_listing_risk_facts(uuid,text)'::pg_catalog.regprocedure
  ) ~ 'listing_risk_domain_analyzer_v9[\s\S]+listing_risk_event_facts_v2[\s\S]+listing_risk_domain_analyzer_v10[\s\S]+listing_risk_event_facts_v2',
  'official reader keeps v9 and v10 explicit V2 mappings separate'
);

select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000003',
    'listing_risk_domain_analyzer_unknown'
  )->>'status',
  'not_ready',
  'unsupported analyzer contracts remain fail closed'
);

select * from finish();
rollback;
