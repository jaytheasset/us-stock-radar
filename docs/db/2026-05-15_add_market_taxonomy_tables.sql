-- Market taxonomy tables needed for sector/industry coverage calculations.
-- Safe to run repeatedly.

do $$
begin
  create type classification_method as enum ('rule', 'llm', 'manual', 'unknown');
exception
  when duplicate_object then null;
end $$;

create table if not exists tickers (
  symbol text primary key,
  name text,
  exchange text,
  fmp_sector text,
  fmp_industry text,
  asset_type text,
  market_cap numeric,
  is_active boolean not null default true,
  last_profiled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tickers_fmp_industry_idx
  on tickers(fmp_industry)
  where fmp_industry is not null;

create index if not exists tickers_asset_type_idx
  on tickers(asset_type)
  where asset_type is not null;

create table if not exists market_sectors (
  code text primary key,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists market_sub_categories (
  sector_code text not null references market_sectors(code) on delete cascade,
  slug text not null,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sector_code, slug)
);

create table if not exists fmp_industry_mappings (
  id uuid primary key default gen_random_uuid(),
  fmp_industry text not null,
  sector_code text not null,
  sub_category_slug text not null,
  priority integer not null default 100,
  is_primary boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (sector_code, sub_category_slug)
    references market_sub_categories(sector_code, slug)
    on delete cascade,
  unique (fmp_industry, sector_code, sub_category_slug)
);

create index if not exists fmp_industry_mappings_lookup_idx
  on fmp_industry_mappings(fmp_industry, priority);

create table if not exists ticker_classifications (
  symbol text primary key references tickers(symbol) on delete cascade,
  sector_code text references market_sectors(code),
  sub_category_slug text,
  method classification_method not null default 'unknown',
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  manual_override boolean not null default false,
  reason text,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (sector_code, sub_category_slug)
    references market_sub_categories(sector_code, slug)
);

create index if not exists ticker_classifications_sector_idx
  on ticker_classifications(sector_code, sub_category_slug);
