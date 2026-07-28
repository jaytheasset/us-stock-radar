create table if not exists public.company_logo_cache (
  symbol text primary key,
  provider text not null default 'polygon',
  status text not null check (status in ('ready', 'missing', 'error')),
  logo_url text,
  icon_url text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_error text,
  raw_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint company_logo_cache_ready_url_check
    check (
      status <> 'ready'
      or coalesce(nullif(logo_url, ''), nullif(icon_url, '')) is not null
    )
);

create index if not exists company_logo_cache_expires_at_idx
  on public.company_logo_cache (expires_at);

alter table public.company_logo_cache enable row level security;

revoke all on table public.company_logo_cache from anon, authenticated;
grant select, insert, update, delete on table public.company_logo_cache to service_role;
