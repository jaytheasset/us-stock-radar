-- Alert delivery scheduler job locks.
-- This migration only adds scheduler lock state and helper functions.
-- It does not modify events, feed, deliveries, notification_subscriptions, or source tables.

create table if not exists alert_delivery_job_locks (
  job_name text primary key,
  locked_until timestamptz not null,
  locked_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists alert_delivery_job_locks_locked_until_idx
  on alert_delivery_job_locks(locked_until);

create or replace function acquire_alert_delivery_job_lock(
  p_job_name text,
  p_ttl_seconds int,
  p_locked_by text
)
returns boolean
language plpgsql
as $$
declare
  v_row_count int := 0;
begin
  insert into alert_delivery_job_locks (job_name, locked_until, locked_by, updated_at, created_at)
  values (p_job_name, now() + make_interval(secs => greatest(p_ttl_seconds, 1)), p_locked_by, now(), now())
  on conflict (job_name) do update
    set locked_until = now() + make_interval(secs => greatest(p_ttl_seconds, 1)),
        locked_by = p_locked_by,
        updated_at = now()
    where alert_delivery_job_locks.locked_until <= now()
       or alert_delivery_job_locks.locked_by = p_locked_by;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

create or replace function release_alert_delivery_job_lock(
  p_job_name text,
  p_locked_by text
)
returns boolean
language plpgsql
as $$
declare
  v_row_count int := 0;
begin
  update alert_delivery_job_locks
     set locked_until = now(),
         updated_at = now()
   where job_name = p_job_name
     and locked_by = p_locked_by;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

comment on table alert_delivery_job_locks is
  'Lease table for alert delivery scheduler runs. Does not store alert payloads.';
comment on function acquire_alert_delivery_job_lock(text, int, text) is
  'Atomically acquires an alert delivery job lease when no current lease is active.';
comment on function release_alert_delivery_job_lock(text, text) is
  'Releases an alert delivery job lease only for the matching lock owner.';

-- RLS remains disabled for now. Add auth.uid() policies only after Supabase Auth is wired.
