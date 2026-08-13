begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ), 'listing_risk_domain_analyzer_v8') > 0,
  'persistence explicitly recognizes single-string transport analyzer v8'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) ~ 'listing_risk_domain_analyzer_v5[\s\S]+listing_risk_domain_analyzer_v6[\s\S]+listing_risk_domain_analyzer_v7[\s\S]+listing_risk_domain_analyzer_v8[\s\S]+listing_risk_event_facts_v2',
  'persistence maps v5 through v8 analyzer contracts to canonical facts V2'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.read_current_event_listing_risk_facts(uuid,text)'::pg_catalog.regprocedure
  ) ~ 'listing_risk_domain_analyzer_v7[\s\S]+listing_risk_event_facts_v2[\s\S]+listing_risk_domain_analyzer_v8[\s\S]+listing_risk_event_facts_v2',
  'official reader keeps v7 and v8 explicit V2 mappings separate'
);

select is(
  public.read_current_event_listing_risk_facts(
    '81000000-0000-4000-8000-000000000002',
    'listing_risk_domain_analyzer_unknown'
  )->>'status',
  'not_ready',
  'unsupported analyzer contracts remain fail closed'
);

select * from finish();
rollback;
