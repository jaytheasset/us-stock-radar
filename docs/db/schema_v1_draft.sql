-- US Stock Radar DB schema v1 draft.
-- Review-only file. Do not apply to Supabase until explicitly approved.
-- After this schema, apply docs/db/taxonomy_seed.sql for sector/theme seed rows.
-- Seed event_types from lib/eventTypeRegistry.ts before inserting events.

create extension if not exists pgcrypto;

do $$
begin
  create type source_group as enum ('news', 'filings', 'market');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type runtime_owner as enum ('render', 'nas', 'external', 'manual');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type run_status as enum ('queued', 'running', 'completed', 'failed', 'skipped');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type delivery_status as enum ('pending', 'sent', 'failed', 'skipped');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_delivery_level as enum ('archive', 'feed', 'alert');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_impact as enum ('high', 'medium', 'low');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_signal as enum ('bullish', 'bearish', 'volatile', 'neutral');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type event_market_scope as enum ('company', 'sector', 'theme', 'macro');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type classification_method as enum ('rule', 'llm', 'manual', 'unknown');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type theme_group_status as enum ('implemented', 'planned');
exception
  when duplicate_object then null;
end $$;

create table if not exists sources (
  code text primary key,
  name text not null,
  source_group source_group not null,
  runtime_owner runtime_owner not null,
  enabled boolean not null default true,
  poll_interval_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_types (
  code text primary key,
  label text not null,
  category text not null,
  badge_tone text not null,
  source_groups source_group[] not null default '{}',
  status text not null default 'active',
  covered_forms text[] not null default '{}',
  description text,
  examples jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_runs (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references sources(code),
  source_group source_group not null,
  run_type text not null,
  status run_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists raw_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references source_runs(id),
  source_code text not null references sources(code),
  source_group source_group not null,
  source_unique_id text,
  source_url text,
  title text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  body_text text,
  analysis_text text,
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text
);

create unique index if not exists raw_items_source_unique_idx
  on raw_items(source_code, source_unique_id)
  where source_unique_id is not null;

create unique index if not exists raw_items_source_dedupe_idx
  on raw_items(source_code, dedupe_key)
  where dedupe_key is not null;

create index if not exists raw_items_group_published_idx
  on raw_items(source_group, published_at desc);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  raw_item_id uuid references raw_items(id),
  source_code text not null references sources(code),
  source_group source_group not null,
  source_name text,
  source_url text,
  published_at timestamptz,
  ticker text,
  market text,
  event_type text not null references event_types(code),
  score integer not null check (score >= 0 and score <= 100),
  delivery_level event_delivery_level not null,
  impact event_impact not null,
  signal event_signal not null,
  market_scope event_market_scope not null default 'company',
  sector text,
  industry_group text,
  theme_group text,
  sub_theme text,
  title text not null,
  quick_take text,
  summary text,
  reason text,
  event_date date,
  detected_at timestamptz not null default now(),
  group_dedupe_key text not null,
  cross_group_event_key text,
  metadata jsonb not null default '{}'::jsonb
);

-- Important: dedupe is only inside the same source_group.
-- A reverse split filing and a reverse split news item should both survive.
create unique index if not exists events_group_dedupe_idx
  on events(source_group, group_dedupe_key);

create index if not exists events_detected_idx
  on events(detected_at desc);

create index if not exists events_group_detected_idx
  on events(source_group, detected_at desc);

create index if not exists events_source_detected_idx
  on events(source_code, detected_at desc);

create index if not exists events_ticker_detected_idx
  on events(ticker, detected_at desc)
  where ticker is not null;

create index if not exists events_type_delivery_idx
  on events(event_type, delivery_level);

create index if not exists events_score_idx
  on events(score desc, delivery_level);

create index if not exists events_market_scope_score_idx
  on events(market_scope, score desc, detected_at desc);

create index if not exists events_news_market_scope_idx
  on events(source_group, market_scope, detected_at desc)
  where source_group = 'news';

create index if not exists events_cross_group_key_idx
  on events(cross_group_event_key)
  where cross_group_event_key is not null;

create table if not exists event_links (
  id uuid primary key default gen_random_uuid(),
  left_event_id uuid not null references events(id) on delete cascade,
  right_event_id uuid not null references events(id) on delete cascade,
  link_type text not null default 'same_underlying_event',
  link_confidence text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint event_links_no_self_link check (left_event_id <> right_event_id)
);

create unique index if not exists event_links_pair_idx
  on event_links (
    least(left_event_id, right_event_id),
    greatest(left_event_id, right_event_id),
    link_type
  );

create table if not exists event_analysis (
  event_id uuid primary key references events(id) on delete cascade,
  analysis_scope text not null default 'company'
    check (analysis_scope in ('company', 'sector', 'theme', 'market')),
  why_it_matters text,
  bullish_points jsonb not null default '[]'::jsonb,
  bearish_points jsonb not null default '[]'::jsonb,
  key_evidence jsonb not null default '[]'::jsonb,
  watch_next jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists event_analysis_scope_idx
  on event_analysis(analysis_scope);

create table if not exists event_tickers (
  event_id uuid not null references events(id) on delete cascade,
  symbol text not null,
  exchange text,
  role text not null default 'related'
    check (role in ('primary', 'related', 'peer', 'customer', 'supplier', 'counterparty', 'mentioned', 'sector_constituent', 'theme_constituent')),
  relevance_score integer check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 100)),
  sort_order integer not null default 100,
  reason text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (event_id, symbol, role)
);

create index if not exists event_tickers_symbol_idx
  on event_tickers(symbol, role);

create index if not exists event_tickers_event_sort_idx
  on event_tickers(event_id, sort_order);

create table if not exists event_calendar_items (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid references events(id) on delete cascade,
  raw_item_id uuid references raw_items(id) on delete set null,
  source_code text references sources(code),
  source_group source_group not null,
  ticker text,
  company_name text,
  calendar_event_key text not null,
  calendar_event_type text not null,
  calendar_group text not null,
  calendar_title text not null,
  event_date date,
  event_time time,
  event_timezone text,
  date_precision text not null default 'exact'
    check (date_precision in ('exact', 'month', 'quarter', 'year', 'unknown')),
  estimated_start_date date,
  estimated_end_date date,
  is_estimated boolean not null default false,
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  calendar_status text not null default 'tentative'
    check (calendar_status in ('tentative', 'confirmed', 'superseded', 'cancelled')),
  confirmation_source text not null default 'news',
  confirmed_at timestamptz,
  confirmed_by_event_id uuid references events(id) on delete set null,
  superseded_by_item_id uuid references event_calendar_items(id) on delete set null,
  source_url text,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (
    event_date is not null
    or estimated_start_date is not null
    or estimated_end_date is not null
  )
);

create index if not exists event_calendar_items_date_idx
  on event_calendar_items(event_date, estimated_start_date, calendar_group);

create index if not exists event_calendar_items_event_idx
  on event_calendar_items(source_event_id);

create index if not exists event_calendar_items_key_idx
  on event_calendar_items(calendar_event_key);

create index if not exists event_calendar_items_ticker_idx
  on event_calendar_items(ticker, event_date)
  where ticker is not null;

create index if not exists event_calendar_items_type_idx
  on event_calendar_items(calendar_event_type, event_date);

create index if not exists event_calendar_items_status_date_idx
  on event_calendar_items(calendar_status, event_date, estimated_start_date);

create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  price numeric,
  market_cap numeric,
  float_shares numeric,
  shares_outstanding numeric,
  volume numeric,
  avg_volume numeric,
  source text not null,
  fetched_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists market_snapshots_ticker_fetched_idx
  on market_snapshots(ticker, fetched_at desc);

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

create table if not exists dashboard_mover_snapshots (
  mode text primary key check (mode in ('gainers', 'losers', 'volume')),
  provider_as_of timestamptz,
  captured_at timestamptz not null,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  data_availability jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_availability) = 'object'),
  source_count integer not null default 0 check (source_count >= 0),
  updated_at timestamptz not null default now()
);

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

create table if not exists theme_groups (
  slug text primary key,
  name text not null,
  status theme_group_status not null default 'planned',
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists ticker_theme_members (
  symbol text not null references tickers(symbol) on delete cascade,
  theme_group_slug text not null references theme_groups(slug) on delete cascade,
  method classification_method not null default 'unknown',
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (symbol, theme_group_slug)
);

create index if not exists ticker_theme_members_theme_idx
  on ticker_theme_members(theme_group_slug, symbol);

create table if not exists event_theme_links (
  event_id uuid not null references events(id) on delete cascade,
  theme_group_slug text not null references theme_groups(slug) on delete cascade,
  method classification_method not null default 'unknown',
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (event_id, theme_group_slug)
);

create index if not exists event_theme_links_theme_idx
  on event_theme_links(theme_group_slug, created_at desc);

create table if not exists theme_snapshots (
  id uuid primary key default gen_random_uuid(),
  theme_group_slug text not null references theme_groups(slug) on delete cascade,
  as_of timestamptz not null,
  change_pct numeric,
  volume_score numeric,
  event_count integer not null default 0,
  alert_count integer not null default 0,
  top_symbols jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (theme_group_slug, as_of)
);

create index if not exists theme_snapshots_theme_asof_idx
  on theme_snapshots(theme_group_slug, as_of desc);

insert into theme_groups (slug, name, status, description, sort_order)
values
  ('ai_data_center', 'AI & Data Center', 'implemented', 'AI infrastructure, accelerators, cloud capacity, and data center demand.', 10),
  ('crypto_digital_assets', 'Crypto & Digital Assets', 'implemented', 'Crypto infrastructure, digital asset balance sheets, exchanges, miners, and tokens.', 20),
  ('healthcare_momentum', 'Healthcare Momentum', 'implemented', 'Clinical catalysts, drug approvals, medical devices, and healthcare deal flow.', 30),
  ('power_energy_resources', 'Power, Energy & Resources', 'planned', 'Power demand, nuclear, uranium, LNG, oil and gas, renewables, and key resources.', 40),
  ('defense_geopolitics', 'Defense & Geopolitics', 'planned', 'Defense contractors, aerospace programs, sanctions, conflict, and geopolitical policy.', 50),
  ('rates_credit_banks', 'Rates, Credit & Banks', 'planned', 'Banks, credit stress, yields, lending, capital markets, and rate-sensitive moves.', 60),
  ('retail_momentum_flows', 'Retail & Momentum Flows', 'planned', 'High-volume retail names, squeezes, social momentum, and flow-driven setups.', 70),
  ('policy_regulation', 'Policy & Regulation', 'planned', 'Regulatory, agency, court, White House, and enforcement actions with market impact.', 80)
on conflict (slug) do update set
  name = excluded.name,
  status = excluded.status,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists dedupe_keys (
  id uuid primary key default gen_random_uuid(),
  source_group source_group not null,
  source_code text not null,
  scope text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (source_group, scope, dedupe_key)
);

create table if not exists notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  destination_code text not null,
  recipient_ref text,
  enabled boolean not null default true,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists notification_subscriptions_channel_idx
  on notification_subscriptions(channel, enabled);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  subscription_id uuid references notification_subscriptions(id) on delete set null,
  channel text not null,
  destination_code text,
  status delivery_status not null default 'pending',
  attempted_at timestamptz,
  sent_at timestamptz,
  error_message text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists deliveries_event_idx
  on deliveries(event_id);

create index if not exists deliveries_subscription_idx
  on deliveries(subscription_id);

create index if not exists deliveries_channel_status_idx
  on deliveries(channel, status, attempted_at desc);

create table if not exists prompt_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version text not null,
  task text not null,
  model text,
  is_active boolean not null default false,
  template text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

create unique index if not exists prompt_templates_active_key_idx
  on prompt_templates(key)
  where is_active = true;

create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  raw_item_id uuid references raw_items(id) on delete set null,
  prompt_key text not null,
  prompt_version text not null,
  model text not null,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists ai_runs_event_idx
  on ai_runs(event_id);

create table if not exists ai_outputs (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references ai_runs(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  output_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists integration_configs (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists schema_versions (
  version text primary key,
  description text,
  applied_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  target_type text,
  target_id text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_target_idx
  on audit_logs(target_type, target_id, created_at desc);
