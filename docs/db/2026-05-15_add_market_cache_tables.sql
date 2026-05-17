-- Short-lived market-data cache for quote and chart API calls.
-- Safe to run repeatedly.

create table if not exists market_quotes (
  symbol text primary key,
  provider text not null default 'fmp',
  price numeric,
  change_amount numeric,
  change_percent numeric,
  previous_close numeric,
  volume numeric,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists market_quotes_expires_idx
  on market_quotes(expires_at);

create table if not exists market_bars (
  symbol text not null,
  range text not null,
  interval text not null, -- 5min, 30min, 2hour, or 1day
  provider text not null,
  provider_label text not null,
  previous_close numeric not null,
  latest_price numeric not null,
  change_amount numeric not null,
  change_percent numeric not null,
  bars jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  primary key (symbol, range, interval)
);

create index if not exists market_bars_expires_idx
  on market_bars(expires_at);

create table if not exists market_group_snapshots (
  scope text not null check (scope in ('sector', 'industry_group', 'theme', 'sub_theme')),
  group_key text not null,
  group_name text not null,
  parent_key text,
  range text not null,
  interval text not null,
  provider_label text not null,
  change_percent numeric not null,
  market_cap_label text,
  trend_points jsonb not null default '[]'::jsonb,
  top_movers jsonb not null default '[]'::jsonb,
  constituent_symbols jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  primary key (scope, group_key, range, interval)
);

create index if not exists market_group_snapshots_expires_idx
  on market_group_snapshots(expires_at);

create index if not exists market_group_snapshots_parent_idx
  on market_group_snapshots(parent_key, range, interval, sort_order);
