create table if not exists public.source_workflow_cancellations (
  workflow_run_id text primary key,
  cancelled_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint source_workflow_cancellations_run_id_check
    check (workflow_run_id ~ '^wrun_[A-Za-z0-9_-]{10,120}$')
);

alter table public.source_workflow_cancellations enable row level security;

revoke all on table public.source_workflow_cancellations from public, anon, authenticated;
grant select, insert, update, delete on table public.source_workflow_cancellations to service_role;

create or replace function public.register_workflow_source_run(
  p_run_id uuid,
  p_source_code text,
  p_source_group text,
  p_run_type text,
  p_started_at timestamptz,
  p_stats jsonb,
  p_metadata jsonb
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_workflow_run_id text := nullif(btrim(coalesce(p_metadata ->> 'workflow_run_id', '')), '');
  v_bound_workflow_run_id text;
  v_cancelled_at timestamptz;
  v_status public.run_status;
begin
  if v_workflow_run_id is null or v_workflow_run_id !~ '^wrun_[A-Za-z0-9_-]{10,120}$' then
    raise exception 'A valid Workflow run ID is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workflow_run_id, 0)
  );

  select cancellation.cancelled_at
  into v_cancelled_at
  from public.source_workflow_cancellations cancellation
  where cancellation.workflow_run_id = v_workflow_run_id;

  v_status := case
    when v_cancelled_at is not null then 'cancelled'::public.run_status
    else 'running'::public.run_status
  end;

  insert into public.source_runs (
    id,
    source_code,
    source_group,
    run_type,
    status,
    started_at,
    finished_at,
    stats,
    error_message,
    metadata
  ) values (
    p_run_id,
    p_source_code,
    p_source_group::public.source_group,
    p_run_type,
    v_status,
    p_started_at,
    v_cancelled_at,
    coalesce(p_stats, '{}'::jsonb),
    null,
    coalesce(p_metadata, '{}'::jsonb) || case
      when v_cancelled_at is not null then jsonb_build_object(
        'cancellation_authority', 'workflow',
        'cancelled_at', v_cancelled_at
      )
      else '{}'::jsonb
    end
  )
  on conflict (id) do nothing;

  select run.status, run.metadata ->> 'workflow_run_id'
  into v_status, v_bound_workflow_run_id
  from public.source_runs run
  where run.id = p_run_id;

  if v_bound_workflow_run_id is distinct from v_workflow_run_id then
    raise exception 'Source run % is bound to another Workflow run', p_run_id;
  end if;

  return v_status::text;
end;
$$;

create or replace function public.cancel_workflow_source_runs(
  p_workflow_run_id text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_workflow_run_id text := nullif(btrim(coalesce(p_workflow_run_id, '')), '');
  v_cancelled_at timestamptz;
  v_updated_count integer;
begin
  if v_workflow_run_id is null or v_workflow_run_id !~ '^wrun_[A-Za-z0-9_-]{10,120}$' then
    raise exception 'A valid Workflow run ID is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workflow_run_id, 0)
  );

  insert into public.source_workflow_cancellations (
    workflow_run_id,
    metadata
  ) values (
    v_workflow_run_id,
    jsonb_build_object('cancellation_authority', 'workflow')
  )
  on conflict (workflow_run_id) do update
  set metadata = public.source_workflow_cancellations.metadata || excluded.metadata
  returning cancelled_at into v_cancelled_at;

  update public.source_runs run
  set
    status = 'cancelled'::public.run_status,
    finished_at = coalesce(run.finished_at, v_cancelled_at),
    error_message = null,
    metadata = run.metadata || jsonb_build_object(
      'cancellation_authority', 'workflow',
      'cancelled_at', v_cancelled_at
    )
  where run.metadata ->> 'workflow_run_id' = v_workflow_run_id
    and run.status in ('queued'::public.run_status, 'running'::public.run_status);

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

revoke all on function public.register_workflow_source_run(
  uuid, text, text, text, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.register_workflow_source_run(
  uuid, text, text, text, timestamptz, jsonb, jsonb
) to service_role;

revoke all on function public.cancel_workflow_source_runs(text)
  from public, anon, authenticated;
grant execute on function public.cancel_workflow_source_runs(text)
  to service_role;
