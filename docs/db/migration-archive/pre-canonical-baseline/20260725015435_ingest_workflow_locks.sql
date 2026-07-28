create table if not exists public.ingest_workflow_locks (
  lock_key text primary key,
  lock_owner text not null,
  locked_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ingest_workflow_locks is
  'Short-lived distributed leases used to prevent overlapping source ingest workflows.';

alter table public.ingest_workflow_locks enable row level security;

revoke all on table public.ingest_workflow_locks from public, anon, authenticated;
grant all on table public.ingest_workflow_locks to service_role;

create or replace function public.acquire_ingest_workflow_lock(
  p_lock_key text,
  p_lock_owner text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_acquired boolean := false;
begin
  if nullif(btrim(p_lock_key), '') is null or nullif(btrim(p_lock_owner), '') is null then
    raise exception 'lock key and owner are required';
  end if;

  insert into public.ingest_workflow_locks (
    lock_key,
    lock_owner,
    locked_until,
    updated_at
  )
  values (
    p_lock_key,
    p_lock_owner,
    now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 7200), 21600))),
    now()
  )
  on conflict (lock_key) do update
  set
    lock_owner = excluded.lock_owner,
    locked_until = excluded.locked_until,
    updated_at = now()
  where public.ingest_workflow_locks.locked_until <= now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.renew_ingest_workflow_lock(
  p_lock_key text,
  p_lock_owner text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_renewed boolean := false;
begin
  update public.ingest_workflow_locks
  set
    locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 7200), 21600))),
    updated_at = now()
  where lock_key = p_lock_key
    and lock_owner = p_lock_owner
    and locked_until > now()
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.release_ingest_workflow_lock(
  p_lock_key text,
  p_lock_owner text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_released boolean := false;
begin
  delete from public.ingest_workflow_locks
  where lock_key = p_lock_key
    and lock_owner = p_lock_owner
  returning true into v_released;

  return coalesce(v_released, false);
end;
$$;

revoke execute on function public.acquire_ingest_workflow_lock(text, text, integer)
from public, anon, authenticated;
revoke execute on function public.renew_ingest_workflow_lock(text, text, integer)
from public, anon, authenticated;
revoke execute on function public.release_ingest_workflow_lock(text, text)
from public, anon, authenticated;

grant execute on function public.acquire_ingest_workflow_lock(text, text, integer)
to service_role;
grant execute on function public.renew_ingest_workflow_lock(text, text, integer)
to service_role;
grant execute on function public.release_ingest_workflow_lock(text, text)
to service_role;

;
