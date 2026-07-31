create table if not exists public.stock_fundamentals_provider_cache (
  symbol text not null,
  source_key text not null,
  provider text not null default 'fmp',
  provider_state text not null,
  http_status integer,
  raw_payload jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (symbol, source_key),
  constraint stock_fundamentals_provider_cache_symbol_check
    check (symbol = upper(btrim(symbol)) and symbol ~ '^[A-Z0-9.-]{1,12}$'),
  constraint stock_fundamentals_provider_cache_source_key_check
    check (source_key = any (array[
      'balanceAnnual',
      'balanceQuarterly',
      'beneficialOwnership',
      'cashAnnual',
      'cashQuarterly',
      'enterpriseValues',
      'incomeAnnual',
      'incomeQuarterly',
      'insiderStatistics',
      'insiderTrades',
      'institutionalHolders',
      'institutionalSummary',
      'sharesFloat',
      'splits'
    ]::text[])),
  constraint stock_fundamentals_provider_cache_state_check
    check (provider_state = any (array['ready', 'plan_unavailable', 'unavailable']::text[])),
  constraint stock_fundamentals_provider_cache_http_status_check
    check (http_status is null or (http_status >= 0 and http_status <= 599)),
  constraint stock_fundamentals_provider_cache_payload_check
    check (jsonb_typeof(raw_payload) = any (array['array', 'object']::text[])),
  constraint stock_fundamentals_provider_cache_expiry_check
    check (expires_at > fetched_at)
);

create index if not exists stock_fundamentals_provider_cache_expiry_idx
  on public.stock_fundamentals_provider_cache (expires_at);

alter table public.stock_fundamentals_provider_cache enable row level security;

revoke all on table public.stock_fundamentals_provider_cache from anon, authenticated;
grant all on table public.stock_fundamentals_provider_cache to service_role;
