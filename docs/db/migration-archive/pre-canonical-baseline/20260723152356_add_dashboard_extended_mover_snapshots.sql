create table if not exists public.dashboard_extended_mover_snapshots (
  session text not null check (session in ('Pre', 'After')),
  mode text not null check (mode in ('gainers', 'losers', 'volume')),
  market_date date not null,
  provider_as_of timestamptz,
  captured_at timestamptz not null,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  data_availability jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_availability) = 'object'),
  source_count integer not null default 0 check (source_count >= 0),
  matching_count integer not null default 0 check (matching_count >= 0),
  provider text not null default 'massive_full_market_snapshot',
  updated_at timestamptz not null default now(),
  primary key (session, mode)
);

alter table public.dashboard_extended_mover_snapshots enable row level security;

revoke all on table public.dashboard_extended_mover_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.dashboard_extended_mover_snapshots
  to service_role;
