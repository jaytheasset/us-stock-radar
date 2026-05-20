-- User personalization tables for alert delivery settings.
-- Feed browsing remains event-based. These tables only control personalized delivery.
-- RLS is intentionally not enabled yet. Add auth.uid()-based policies after Supabase Auth is wired.

create or replace function set_user_alert_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists user_profiles (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_plan_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'ad_free', 'pro', 'advanced', 'ultimate')),
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancelled', 'paused')),
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists watchlist_tickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  ticker text not null check (ticker = upper(ticker) and ticker = btrim(ticker) and length(ticker) > 0),
  company_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table if not exists alert_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  watchlist_news_enabled boolean not null default true,
  watchlist_filings_enabled boolean not null default true,
  watchlist_calendar_enabled boolean not null default true,
  watchlist_risk_enabled boolean not null default true,
  discovery_enabled boolean not null default true,
  group_duplicates boolean not null default true,
  cooldown_minutes int not null default 60 check (cooldown_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists user_discovery_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  category text not null
    check (category in (
      'listing_risk',
      'dilution_risk',
      'earnings',
      'sales_performance',
      'product_update',
      'leadership_governance',
      'insider_ownership',
      'shareholder_vote',
      'strategic_transaction',
      'financial_risk',
      'legal_risk',
      'dividends',
      'capital_return',
      'fda_clinical',
      'policy_regulation',
      'macro_market',
      'other'
    )),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

create table if not exists user_delivery_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  channel text not null
    check (channel in ('web', 'telegram', 'email', 'webhook', 'api')),
  enabled boolean not null default false,
  destination text,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel)
);

create table if not exists user_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  alert_event_id uuid references events(id) on delete set null,
  ticker text,
  title text not null,
  category text
    check (
      category is null
      or category in (
        'listing_risk',
        'dilution_risk',
        'earnings',
        'sales_performance',
        'product_update',
        'leadership_governance',
        'insider_ownership',
        'shareholder_vote',
        'strategic_transaction',
        'financial_risk',
        'legal_risk',
        'dividends',
        'capital_return',
        'fda_clinical',
        'policy_regulation',
        'macro_market',
        'other'
      )
    ),
  source_type text,
  source_label text,
  alert_lane text not null check (alert_lane in ('watchlist', 'market_discovery')),
  severity text check (severity in ('low', 'medium', 'high', 'critical')),
  delivered_channels text[] not null default '{}'::text[]
    check (delivered_channels <@ array['web', 'telegram', 'email', 'webhook', 'api']::text[]),
  delivery_status text not null default 'sent'
    check (delivery_status in ('queued', 'sent', 'failed', 'suppressed')),
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

drop trigger if exists user_profiles_set_updated_at on user_profiles;
create trigger user_profiles_set_updated_at
  before update on user_profiles
  for each row execute function set_user_alert_updated_at();

drop trigger if exists user_plan_subscriptions_set_updated_at on user_plan_subscriptions;
create trigger user_plan_subscriptions_set_updated_at
  before update on user_plan_subscriptions
  for each row execute function set_user_alert_updated_at();

drop trigger if exists watchlist_tickers_set_updated_at on watchlist_tickers;
create trigger watchlist_tickers_set_updated_at
  before update on watchlist_tickers
  for each row execute function set_user_alert_updated_at();

drop trigger if exists alert_preferences_set_updated_at on alert_preferences;
create trigger alert_preferences_set_updated_at
  before update on alert_preferences
  for each row execute function set_user_alert_updated_at();

drop trigger if exists user_discovery_categories_set_updated_at on user_discovery_categories;
create trigger user_discovery_categories_set_updated_at
  before update on user_discovery_categories
  for each row execute function set_user_alert_updated_at();

drop trigger if exists user_delivery_channels_set_updated_at on user_delivery_channels;
create trigger user_delivery_channels_set_updated_at
  before update on user_delivery_channels
  for each row execute function set_user_alert_updated_at();

create index if not exists user_plan_subscriptions_user_idx
  on user_plan_subscriptions(user_id);

create index if not exists watchlist_tickers_user_only_idx
  on watchlist_tickers(user_id);

create index if not exists watchlist_tickers_user_idx
  on watchlist_tickers(user_id, ticker);

create index if not exists alert_preferences_user_idx
  on alert_preferences(user_id);

create index if not exists user_discovery_categories_user_only_idx
  on user_discovery_categories(user_id);

create index if not exists user_discovery_categories_user_enabled_idx
  on user_discovery_categories(user_id, enabled);

create index if not exists user_discovery_categories_user_idx
  on user_discovery_categories(user_id, enabled, category);

create index if not exists user_delivery_channels_user_only_idx
  on user_delivery_channels(user_id);

create index if not exists user_delivery_channels_user_idx
  on user_delivery_channels(user_id, channel, enabled);

create index if not exists user_alert_deliveries_user_time_idx
  on user_alert_deliveries(user_id, delivered_at desc);

create index if not exists user_alert_deliveries_event_idx
  on user_alert_deliveries(alert_event_id)
  where alert_event_id is not null;

create index if not exists user_alert_deliveries_lane_time_idx
  on user_alert_deliveries(user_id, alert_lane, delivered_at desc);

create index if not exists user_alert_deliveries_category_time_idx
  on user_alert_deliveries(user_id, category, delivered_at desc)
  where category is not null;

-- Development seed only. Replace this with Supabase Auth user ids later.
insert into user_profiles (id, email)
values ('00000000-0000-4000-8000-000000000001', 'dev@stockradar.local')
on conflict (id) do update set
  email = excluded.email,
  updated_at = now();

insert into user_plan_subscriptions (user_id, plan, status)
values ('00000000-0000-4000-8000-000000000001', 'pro', 'active')
on conflict (user_id) do update set
  plan = excluded.plan,
  status = excluded.status,
  updated_at = now();

insert into watchlist_tickers (user_id, ticker, company_name)
values
  ('00000000-0000-4000-8000-000000000001', 'NVDA', 'NVIDIA Corporation'),
  ('00000000-0000-4000-8000-000000000001', 'TSLA', 'Tesla, Inc.'),
  ('00000000-0000-4000-8000-000000000001', 'REGN', 'Regeneron Pharmaceuticals, Inc.'),
  ('00000000-0000-4000-8000-000000000001', 'NXXT', 'NextNRG, Inc.')
on conflict (user_id, ticker) do update set
  company_name = excluded.company_name,
  updated_at = now();

insert into alert_preferences (user_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (user_id) do update set
  watchlist_news_enabled = excluded.watchlist_news_enabled,
  watchlist_filings_enabled = excluded.watchlist_filings_enabled,
  watchlist_calendar_enabled = excluded.watchlist_calendar_enabled,
  watchlist_risk_enabled = excluded.watchlist_risk_enabled,
  discovery_enabled = excluded.discovery_enabled,
  group_duplicates = excluded.group_duplicates,
  cooldown_minutes = excluded.cooldown_minutes,
  updated_at = now();

insert into user_discovery_categories (user_id, category, enabled)
values
  ('00000000-0000-4000-8000-000000000001', 'listing_risk', true),
  ('00000000-0000-4000-8000-000000000001', 'dilution_risk', true),
  ('00000000-0000-4000-8000-000000000001', 'earnings', true),
  ('00000000-0000-4000-8000-000000000001', 'fda_clinical', true)
on conflict (user_id, category) do update set
  enabled = excluded.enabled,
  updated_at = now();

insert into user_delivery_channels (user_id, channel, enabled)
values
  ('00000000-0000-4000-8000-000000000001', 'web', true),
  ('00000000-0000-4000-8000-000000000001', 'telegram', false)
on conflict (user_id, channel) do update set
  enabled = excluded.enabled,
  updated_at = now();
