create table if not exists public.dashboard_mover_snapshots (
  mode text primary key check (mode in ('gainers', 'losers', 'volume')),
  provider_as_of timestamptz,
  captured_at timestamptz not null,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  data_availability jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data_availability) = 'object'),
  source_count integer not null default 0 check (source_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_mover_snapshots enable row level security;

revoke all on table public.dashboard_mover_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.dashboard_mover_snapshots to service_role;
