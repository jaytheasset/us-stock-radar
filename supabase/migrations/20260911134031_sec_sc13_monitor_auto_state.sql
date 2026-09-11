begin;

create or replace function public.preserve_sec_sc13_monitor_alert_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_old_state jsonb := coalesce(old.metadata, '{}'::jsonb) -> 'sc13_monitor_alert';
  v_new_state jsonb := coalesce(new.metadata, '{}'::jsonb) -> 'sc13_monitor_alert';
  v_old_generation bigint;
  v_new_generation bigint;
  v_old_status text;
  v_new_status text;
begin
  if old.source_code <> 'sec_edgar'
    or pg_catalog.jsonb_typeof(v_old_state) is distinct from 'object'
  then
    return new;
  end if;

  if pg_catalog.jsonb_typeof(v_old_state -> 'attempt_generation') = 'number'
    and (v_old_state ->> 'attempt_generation') ~ '^\d+$'
  then
    v_old_generation := (v_old_state ->> 'attempt_generation')::bigint;
  end if;
  if pg_catalog.jsonb_typeof(v_new_state -> 'attempt_generation') = 'number'
    and (v_new_state ->> 'attempt_generation') ~ '^\d+$'
  then
    v_new_generation := (v_new_state ->> 'attempt_generation')::bigint;
  end if;
  v_old_status := v_old_state ->> 'status';
  v_new_status := v_new_state ->> 'status';

  if v_new_generation is null
    or (v_old_generation is not null and v_new_generation < v_old_generation)
    or (
      v_old_generation is not null
      and v_new_generation = v_old_generation
      and (
        v_new_state ->> 'attempt_id' is distinct from v_old_state ->> 'attempt_id'
        or (
          v_old_status in ('failed', 'completed')
          and v_new_status is distinct from v_old_status
        )
      )
    )
  then
    new.metadata := pg_catalog.jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{sc13_monitor_alert}',
      v_old_state,
      true
    );
  end if;
  return new;
end;
$function$;

create trigger raw_items_preserve_sc13_monitor_alert_metadata
before update of metadata on public.raw_items
for each row execute function public.preserve_sec_sc13_monitor_alert_metadata();

create or replace function public.begin_sec_sc13_monitor_alert_attempt(
  p_raw_item_id uuid,
  p_issuer_cik text,
  p_source_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_raw public.raw_items%rowtype;
  v_previous_state jsonb;
  v_generation bigint := 1;
  v_attempt_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_state jsonb;
begin
  if p_raw_item_id is null
    or p_issuer_cik is null
    or p_issuer_cik !~ '^\d{10}$'
    or p_source_sha256 is null
    or p_source_sha256 !~ '^[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  select raw.*
  into v_raw
  from public.raw_items as raw
  where raw.id = p_raw_item_id
    and raw.source_code = 'sec_edgar'
  for update of raw;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing', 'raw_item_id', p_raw_item_id);
  end if;

  if not exists (
    select 1
    from public.sec_sc13_filings as filing
    where filing.raw_item_id = p_raw_item_id
      and filing.issuer_cik = p_issuer_cik
      and filing.source_sha256 = p_source_sha256
  ) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'canonical_identity_mismatch');
  end if;

  v_previous_state := coalesce(v_raw.metadata, '{}'::jsonb) -> 'sc13_monitor_alert';
  if pg_catalog.jsonb_typeof(v_previous_state -> 'attempt_generation') = 'number'
    and (v_previous_state ->> 'attempt_generation') ~ '^\d+$'
  then
    v_generation := (v_previous_state ->> 'attempt_generation')::bigint + 1;
  end if;

  v_state := pg_catalog.jsonb_build_object(
    'status', 'pending',
    'version', 'sec_sc13_monitor_auto_v1',
    'issuer_cik', p_issuer_cik,
    'source_sha256', p_source_sha256,
    'attempt_id', v_attempt_id,
    'attempt_generation', v_generation,
    'started_at', v_now,
    'updated_at', v_now,
    'error', null,
    'result', null
  );

  update public.raw_items as raw
  set metadata = pg_catalog.jsonb_set(
    coalesce(raw.metadata, '{}'::jsonb),
    '{sc13_monitor_alert}',
    v_state,
    true
  )
  where raw.id = p_raw_item_id;

  return pg_catalog.jsonb_build_object(
    'status', 'started',
    'raw_item_id', p_raw_item_id,
    'attempt_id', v_attempt_id,
    'attempt_generation', v_generation
  );
end;
$function$;

create or replace function public.finish_sec_sc13_monitor_alert_attempt(
  p_raw_item_id uuid,
  p_attempt_id uuid,
  p_attempt_generation bigint,
  p_status text,
  p_error text,
  p_result jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_raw public.raw_items%rowtype;
  v_current jsonb;
  v_now timestamptz := pg_catalog.now();
  v_state jsonb;
begin
  if p_raw_item_id is null
    or p_attempt_id is null
    or p_attempt_generation is null
    or p_attempt_generation < 1
    or p_status is null
    or p_status not in ('failed', 'completed')
    or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
  then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'invalid_arguments');
  end if;

  select raw.*
  into v_raw
  from public.raw_items as raw
  where raw.id = p_raw_item_id
    and raw.source_code = 'sec_edgar'
  for update of raw;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing', 'raw_item_id', p_raw_item_id);
  end if;

  v_current := coalesce(v_raw.metadata, '{}'::jsonb) -> 'sc13_monitor_alert';
  if pg_catalog.jsonb_typeof(v_current) is distinct from 'object'
    or v_current ->> 'attempt_id' is distinct from p_attempt_id::text
    or v_current ->> 'attempt_generation' is distinct from p_attempt_generation::text
  then
    return pg_catalog.jsonb_build_object(
      'status', 'preserved',
      'reason', 'stale_attempt',
      'raw_item_id', p_raw_item_id,
      'current_attempt_id', v_current ->> 'attempt_id',
      'current_attempt_generation', v_current -> 'attempt_generation'
    );
  end if;

  v_state := v_current || pg_catalog.jsonb_build_object(
    'status', p_status,
    'updated_at', v_now,
    'finished_at', v_now,
    'error', case when p_status = 'failed' then nullif(pg_catalog.left(coalesce(p_error, ''), 500), '') else null end,
    'result', p_result
  );

  update public.raw_items as raw
  set metadata = pg_catalog.jsonb_set(
    coalesce(raw.metadata, '{}'::jsonb),
    '{sc13_monitor_alert}',
    v_state,
    true
  )
  where raw.id = p_raw_item_id;

  return pg_catalog.jsonb_build_object(
    'status', 'updated',
    'raw_item_id', p_raw_item_id,
    'attempt_id', p_attempt_id,
    'attempt_generation', p_attempt_generation,
    'monitor_status', p_status
  );
end;
$function$;

revoke all on function public.preserve_sec_sc13_monitor_alert_metadata() from public, anon, authenticated;
revoke all on function public.begin_sec_sc13_monitor_alert_attempt(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_sec_sc13_monitor_alert_attempt(uuid, uuid, bigint, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.begin_sec_sc13_monitor_alert_attempt(uuid, text, text) to service_role;
grant execute on function public.finish_sec_sc13_monitor_alert_attempt(uuid, uuid, bigint, text, text, jsonb) to service_role;

comment on function public.preserve_sec_sc13_monitor_alert_metadata() is
  'Prevents whole-row raw metadata saves from deleting or rolling back a newer Schedule 13 Monitor attempt state.';
comment on function public.begin_sec_sc13_monitor_alert_attempt(uuid, text, text) is
  'Starts a generation-ordered Schedule 13 Monitor attempt only for the exact stored canonical XML issuer and source hash.';
comment on function public.finish_sec_sc13_monitor_alert_attempt(uuid, uuid, bigint, text, text, jsonb) is
  'Records only the current Schedule 13 Monitor attempt outcome so a stale failure cannot overwrite a newer result.';

commit;
