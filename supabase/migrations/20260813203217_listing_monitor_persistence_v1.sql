create table public.listing_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null default 'listing',
  conditions jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint listing_monitors_domain_check check (domain = 'listing'),
  constraint listing_monitors_conditions_array_check check (
    pg_catalog.jsonb_typeof(conditions) = 'array'
    and pg_catalog.jsonb_array_length(conditions) > 0
  )
);

comment on table public.listing_monitors is
  'Owner-scoped Listing Monitor definitions. Conditions are canonical Registry-validated data; this table does not execute matching or delivery.';

create index listing_monitors_user_created_idx
  on public.listing_monitors (user_id, created_at desc, id desc);

create index listing_monitors_active_user_created_idx
  on public.listing_monitors (user_id, created_at desc, id desc)
  where is_active;

alter table public.listing_monitors enable row level security;

revoke all on table public.listing_monitors from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_monitors to authenticated;
grant select, insert, update, delete on table public.listing_monitors to service_role;

create policy listing_monitors_select_own
on public.listing_monitors
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy listing_monitors_insert_own
on public.listing_monitors
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy listing_monitors_update_own
on public.listing_monitors
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy listing_monitors_delete_own
on public.listing_monitors
for delete
to authenticated
using ((select auth.uid()) = user_id);
