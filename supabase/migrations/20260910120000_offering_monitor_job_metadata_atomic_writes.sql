begin;

create or replace function public.set_offering_monitor_registry_alert_state(
  p_job_id uuid,
  p_state text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.ai_runs%rowtype;
  v_current text;
  v_now timestamptz := pg_catalog.now();
begin
  if p_job_id is null or p_state not in ('pending', 'failed', 'completed') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  select job.*
  into v_job
  from public.ai_runs as job
  where job.id = p_job_id
    and job.prompt_key = 'offering_monitor_normalization_job'
  for update of job;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing', 'job_id', p_job_id);
  end if;

  v_current := v_job.metadata->>'registry_alert_status';
  if v_current = 'completed' and p_state <> 'completed' then
    return pg_catalog.jsonb_build_object(
      'status', 'preserved',
      'job_id', p_job_id,
      'registry_alert_status', v_current
    );
  end if;

  update public.ai_runs as job
  set metadata = coalesce(job.metadata, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'registry_alert_status', p_state,
      'registry_alert_error', case when p_state = 'completed' then null else p_error end,
      'registry_alert_updated_at', v_now
    )
  where job.id = p_job_id;

  return pg_catalog.jsonb_build_object(
    'status', 'updated',
    'job_id', p_job_id,
    'registry_alert_status', p_state
  );
end;
$function$;

create or replace function public.attach_offering_monitor_workflow_run(
  p_job_id uuid,
  p_workflow_run_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_job_id is null or nullif(pg_catalog.btrim(p_workflow_run_id), '') is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  perform 1
  from public.ai_runs as job
  where job.id = p_job_id
    and job.prompt_key = 'offering_monitor_normalization_job'
    and job.status in ('pending', 'running')
  for update of job;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing', 'job_id', p_job_id);
  end if;

  update public.ai_runs as job
  set metadata = pg_catalog.jsonb_set(
    coalesce(job.metadata, '{}'::jsonb),
    '{workflow_run_id}',
    pg_catalog.to_jsonb(p_workflow_run_id),
    true
  )
  where job.id = p_job_id;

  return pg_catalog.jsonb_build_object('status', 'updated', 'job_id', p_job_id);
end;
$function$;

create or replace function public.finish_offering_monitor_sidecar_job(
  p_job_id uuid,
  p_prompt_version text,
  p_status text,
  p_error text,
  p_metadata_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_job_id is null
    or nullif(pg_catalog.btrim(p_prompt_version), '') is null
    or p_status not in ('completed', 'failed', 'stale')
    or pg_catalog.jsonb_typeof(p_metadata_patch) <> 'object'
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_metadata_patch) as patch_key(key)
      where patch_key.key not in (
        'phase',
        'sidecar_status',
        'sidecar_reason',
        'sidecar_inserted',
        'sidecar_deduped',
        'stage_2_provider_enabled',
        'provider_attempts',
        'legacy_canonical_wiring_enabled',
        'legacy_empty_condition_matcher_enabled',
        'diagnostic_candidate_saved',
        'canonical_persistence_changed'
      )
    )
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  perform 1
  from public.ai_runs as job
  where job.id = p_job_id
    and job.prompt_key = 'offering_monitor_normalization_job'
  for update of job;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing', 'job_id', p_job_id);
  end if;

  update public.ai_runs as job
  set prompt_version = p_prompt_version,
    model = 'not_used',
    status = p_status,
    finished_at = pg_catalog.now(),
    usage = '{}'::jsonb,
    error_message = case when p_status = 'failed' then p_error else null end,
    metadata = coalesce(job.metadata, '{}'::jsonb) || p_metadata_patch
  where job.id = p_job_id;

  return pg_catalog.jsonb_build_object('status', 'updated', 'job_id', p_job_id);
end;
$function$;

revoke all on function public.set_offering_monitor_registry_alert_state(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.attach_offering_monitor_workflow_run(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_offering_monitor_sidecar_job(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.set_offering_monitor_registry_alert_state(uuid, text, text)
  to service_role;
grant execute on function public.attach_offering_monitor_workflow_run(uuid, text)
  to service_role;
grant execute on function public.finish_offering_monitor_sidecar_job(uuid, text, text, text, jsonb)
  to service_role;

comment on function public.set_offering_monitor_registry_alert_state(uuid, text, text) is
  'Atomically preserves the Registry-to-Matcher-to-Alert state on the existing Offering Monitor ai_run; completed is monotonic.';
comment on function public.attach_offering_monitor_workflow_run(uuid, text) is
  'Atomically adds workflow linkage without replacing Registry Alert or sidecar metadata.';
comment on function public.finish_offering_monitor_sidecar_job(uuid, text, text, text, jsonb) is
  'Atomically completes only the deterministic O/S sidecar fields while preserving Registry Alert metadata.';

commit;
