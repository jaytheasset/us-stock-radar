begin;

select plan(8);

select has_table(
  'public',
  'stock_fundamentals_provider_cache',
  'the server-only FMP provider cache exists'
);

select has_column(
  'public',
  'stock_fundamentals_provider_cache',
  'raw_payload',
  'the provider cache retains the source payload'
);

select has_index(
  'public',
  'stock_fundamentals_provider_cache',
  'stock_fundamentals_provider_cache_expiry_idx',
  'expired cache rows can be located efficiently'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'stock_fundamentals_provider_cache'
  ),
  'the public cache table has RLS enabled'
);

select is(
  has_table_privilege('anon', 'public.stock_fundamentals_provider_cache', 'select'),
  false,
  'anon cannot read cached provider payloads'
);

select is(
  has_table_privilege('authenticated', 'public.stock_fundamentals_provider_cache', 'select'),
  false,
  'authenticated clients cannot read cached provider payloads'
);

select is(
  has_table_privilege('service_role', 'public.stock_fundamentals_provider_cache', 'select'),
  true,
  'service_role can read cached provider payloads'
);

select throws_ok(
  $$
    insert into public.stock_fundamentals_provider_cache (
      symbol,
      source_key,
      provider_state,
      raw_payload,
      fetched_at,
      expires_at
    ) values (
      'AMD',
      'unknownSource',
      'ready',
      '[]'::jsonb,
      now(),
      now() + interval '1 hour'
    )
  $$,
  '23514',
  null,
  'unknown provider source keys are rejected'
);

select * from finish();

rollback;
