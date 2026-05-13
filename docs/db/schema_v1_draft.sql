-- US Stock Radar DB schema v1 draft.
-- Review-only file. Do not apply to Supabase until explicitly approved.
-- After this schema, apply docs/db/taxonomy_seed.sql for sector/theme seed rows.

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
  raw_payload jsonb not null default '{}'::jsonb,
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
  ticker text,
  market text,
  event_type text not null,
  score integer not null check (score >= 0 and score <= 100),
  delivery_level event_delivery_level not null,
  impact event_impact not null,
  signal event_signal not null,
  title text not null,
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
