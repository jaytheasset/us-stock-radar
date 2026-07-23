alter table public.dashboard_mover_snapshots
  add column if not exists market_date date,
  add column if not exists is_final boolean not null default false,
  add column if not exists finalized_at timestamptz;

update public.dashboard_mover_snapshots
set market_date = (captured_at at time zone 'America/New_York')::date
where market_date is null;

alter table public.dashboard_mover_snapshots
  alter column market_date set not null;

alter table public.dashboard_extended_mover_snapshots
  add column if not exists is_final boolean not null default false,
  add column if not exists finalized_at timestamptz;

comment on column public.dashboard_mover_snapshots.is_final is
  'True after the regular-session rankings have been frozen for the market date.';
comment on column public.dashboard_extended_mover_snapshots.is_final is
  'True after the pre-market or after-hours rankings have been frozen for the market date.';
