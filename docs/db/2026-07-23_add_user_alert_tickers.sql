-- Alert-enabled tickers are distinct from the general watchlist.
-- Server routes validate the current user and access this table with the service role.

create table if not exists public.user_alert_tickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  ticker text not null
    check (ticker = upper(ticker) and ticker = btrim(ticker) and ticker ~ '^[A-Z0-9.-]{1,12}$'),
  company_name text not null check (length(btrim(company_name)) > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

drop trigger if exists user_alert_tickers_set_updated_at on public.user_alert_tickers;
create trigger user_alert_tickers_set_updated_at
  before update on public.user_alert_tickers
  for each row execute function public.set_user_alert_updated_at();

create index if not exists user_alert_tickers_user_enabled_idx
  on public.user_alert_tickers(user_id, enabled, ticker);

alter table public.user_alert_tickers enable row level security;

revoke all
  on table public.user_alert_tickers
  from anon, authenticated;

grant select, insert, update, delete
  on table public.user_alert_tickers
  to service_role;

insert into public.user_alert_tickers (user_id, ticker, company_name, enabled)
select
  watchlist.user_id,
  upper(watchlist.ticker),
  coalesce(nullif(btrim(catalog.name), ''), nullif(btrim(watchlist.company_name), ''), upper(watchlist.ticker)),
  true
from public.watchlist_tickers as watchlist
left join public.tickers as catalog
  on catalog.symbol = upper(watchlist.ticker)
on conflict (user_id, ticker) do nothing;
