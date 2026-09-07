create or replace function public.consume_prelaunch_internal_nonce(
  p_nonce_hash text,
  p_scope_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_consumed boolean := false;
begin
  if p_nonce_hash is null
     or p_scope_hash is null
     or p_nonce_hash !~ '^[0-9a-f]{64}$'
     or p_scope_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  if p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '60 seconds' then
    return false;
  end if;

  delete from public.ingest_workflow_locks
  where lock_key like 'prelaunch-internal:%'
    and locked_until <= now();

  insert into public.ingest_workflow_locks (
    lock_key,
    lock_owner,
    locked_until,
    updated_at
  ) values (
    'prelaunch-internal:' || p_nonce_hash,
    'scope:' || p_scope_hash,
    p_expires_at,
    now()
  )
  on conflict (lock_key) do nothing
  returning true into v_consumed;

  return coalesce(v_consumed, false);
end;
$$;

comment on function public.consume_prelaunch_internal_nonce(text, text, timestamptz)
  is 'Atomically consumes one short-lived, request-scoped prelaunch internal capability nonce.';

revoke all on function public.consume_prelaunch_internal_nonce(text, text, timestamptz) from public;
revoke all on function public.consume_prelaunch_internal_nonce(text, text, timestamptz) from anon;
revoke all on function public.consume_prelaunch_internal_nonce(text, text, timestamptz) from authenticated;
grant execute on function public.consume_prelaunch_internal_nonce(text, text, timestamptz) to service_role;
