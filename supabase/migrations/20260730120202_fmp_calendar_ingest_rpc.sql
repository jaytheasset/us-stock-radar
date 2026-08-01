-- Calendar 2B: atomic FMP Company calendar observations.
--
-- External HTTP requests are intentionally outside this function. The caller
-- validates and normalizes one provider observation, then invokes this short
-- transaction through the service-role-only Data API.

create unique index calendar_provider_payloads_fmp_observation_uidx
  on public.calendar_provider_payloads (
    provider,
    checksum,
    request_window_start,
    request_window_end
  )
  where (
    provider = 'fmp'
    and request_window_start is not null
    and request_window_end is not null
  );

create or replace function public.ingest_fmp_calendar_observation(
  p_observation jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_event public.calendar_events%rowtype;
  v_event_id uuid;
  v_raw_id uuid;
  v_source_id uuid;
  v_old_detail jsonb;
  v_detail jsonb := coalesce(p_observation->'details', '{}'::jsonb);
  v_raw_payload jsonb := p_observation->'raw_payload';
  v_canonical_identity text := pg_catalog.btrim(p_observation->>'canonical_identity_key');
  v_event_type text := pg_catalog.btrim(p_observation->>'event_type');
  v_event_date date;
  v_lifecycle text := pg_catalog.btrim(p_observation->>'lifecycle_status');
  v_confidence text := pg_catalog.btrim(p_observation->>'schedule_confidence');
  v_impact text := pg_catalog.btrim(p_observation->>'impact_level');
  v_title text := pg_catalog.btrim(p_observation->>'title');
  v_ticker text := nullif(pg_catalog.btrim(p_observation->>'ticker'), '');
  v_company_name text := pg_catalog.btrim(p_observation->>'company_name');
  v_source_event_key text := pg_catalog.btrim(p_observation->>'source_event_key');
  v_raw_checksum text := pg_catalog.btrim(p_observation->>'raw_checksum');
  v_fingerprint text := pg_catalog.btrim(p_observation->>'observation_fingerprint');
  v_history_fingerprint text;
  v_run_id text := pg_catalog.btrim(p_observation->>'run_id');
  v_request_date date;
  v_fetched_at timestamptz;
  v_source_modified_at timestamptz;
  v_schedule_changed boolean := false;
  v_details_changed boolean := false;
  v_changed boolean := false;
  v_history_created boolean := false;
  v_upserted boolean := false;
  v_change_kind text;
  v_before jsonb;
  v_after jsonb;
begin
  if pg_catalog.jsonb_typeof(p_observation) <> 'object' then
    raise exception using errcode = '22023', message = 'CALENDAR_OBSERVATION_INVALID';
  end if;
  if p_observation->>'provider' <> 'fmp'
    or p_observation->>'category' <> 'company'
    or p_observation->>'mode' <> 'backfill'
  then
    raise exception using errcode = '22023', message = 'CALENDAR_OBSERVATION_SCOPE_INVALID';
  end if;
  if v_event_type not in ('earnings', 'dividend', 'split', 'ipo') then
    raise exception using errcode = '22023', message = 'CALENDAR_EVENT_TYPE_INVALID';
  end if;
  if v_lifecycle not in ('scheduled', 'released')
    or v_confidence <> 'tentative'
    or v_impact not in ('high', 'medium', 'low')
  then
    raise exception using errcode = '22023', message = 'CALENDAR_EVENT_STATE_INVALID';
  end if;
  if pg_catalog.length(v_canonical_identity) = 0
    or pg_catalog.length(v_title) = 0
    or pg_catalog.length(v_company_name) = 0
    or pg_catalog.length(v_source_event_key) = 0
    or v_source_event_key <> v_canonical_identity
  then
    raise exception using errcode = '22023', message = 'CALENDAR_IDENTITY_INVALID';
  end if;
  if v_raw_checksum !~ '^[0-9a-f]{64}$'
    or v_fingerprint !~ '^[0-9a-f]{64}$'
    or pg_catalog.length(v_run_id) = 0
  then
    raise exception using errcode = '22023', message = 'CALENDAR_OBSERVATION_FINGERPRINT_INVALID';
  end if;
  if pg_catalog.jsonb_typeof(v_detail) <> 'object'
    or pg_catalog.jsonb_typeof(v_raw_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'CALENDAR_OBSERVATION_PAYLOAD_INVALID';
  end if;
  if v_ticker is not null
    and (
      v_ticker <> pg_catalog.upper(v_ticker)
      or v_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
    )
  then
    raise exception using errcode = '22023', message = 'CALENDAR_TICKER_INVALID';
  end if;

  begin
    v_event_date := (p_observation->>'event_date')::date;
    v_request_date := (p_observation->>'request_date')::date;
    v_fetched_at := (p_observation->>'fetched_at')::timestamptz;
    v_source_modified_at :=
      nullif(p_observation->>'source_modified_at', '')::timestamptz;
  exception
    when others then
      raise exception using errcode = '22023', message = 'CALENDAR_OBSERVATION_DATE_INVALID';
  end;
  if v_event_date <> v_request_date then
    raise exception using errcode = '22023', message = 'CALENDAR_REQUEST_WINDOW_INVALID';
  end if;
  if pg_catalog.strpos(v_canonical_identity, v_event_date::text) > 0 then
    raise exception using errcode = '22023', message = 'CALENDAR_IDENTITY_CONTAINS_SCHEDULED_DATE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_canonical_identity, 0)
  );

  insert into public.calendar_provider_payloads (
    provider,
    request_window_start,
    request_window_end,
    payload,
    checksum,
    checksum_algorithm,
    fetched_at,
    ingested_run_id,
    is_development_data,
    retention_mode,
    purge_after
  )
  values (
    'fmp',
    v_request_date,
    v_request_date,
    v_raw_payload,
    v_raw_checksum,
    'sha256',
    v_fetched_at,
    v_run_id,
    true,
    'prelaunch_long_term',
    null
  )
  on conflict (
    provider,
    checksum,
    request_window_start,
    request_window_end
  )
  where (
    provider = 'fmp'
    and request_window_start is not null
    and request_window_end is not null
  )
  do update set
    fetched_at = greatest(
      public.calendar_provider_payloads.fetched_at,
      excluded.fetched_at
    ),
    ingested_run_id = excluded.ingested_run_id
  returning id into v_raw_id;

  select event_row.*
  into v_event
  from public.calendar_events as event_row
  where event_row.canonical_identity_key = v_canonical_identity
  for update of event_row;

  select details.detail
  into v_old_detail
  from public.calendar_event_details as details
  where details.event_id = v_event.id;

  if v_event.id is null then
    insert into public.calendar_events (
      canonical_identity_key,
      event_type,
      category,
      title,
      event_date,
      event_end_date,
      event_time,
      event_timezone,
      event_instant,
      time_status,
      market_session,
      lifecycle_status,
      schedule_confidence,
      impact_level,
      impact_scope,
      current_revision,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    )
    values (
      v_canonical_identity,
      v_event_type,
      'company',
      v_title,
      v_event_date,
      null,
      null,
      'America/New_York',
      null,
      'time-not-announced',
      'tna',
      v_lifecycle,
      v_confidence,
      v_impact,
      'company',
      1,
      v_fetched_at,
      v_fetched_at,
      v_now,
      v_now
    )
    returning id into v_event_id;
    v_upserted := true;
    v_changed := true;
    v_change_kind := 'registered';
  else
    v_event_id := v_event.id;
    v_schedule_changed :=
      v_event.event_date is distinct from v_event_date
      or v_event.event_end_date is not null
      or v_event.event_time is not null
      or v_event.time_status is distinct from 'time-not-announced'
      or v_event.market_session is distinct from 'tna'
      or v_event.schedule_confidence is distinct from v_confidence;
    v_details_changed := coalesce(v_old_detail, '{}'::jsonb)
      is distinct from v_detail;
    v_changed :=
      v_schedule_changed
      or v_event.title is distinct from v_title
      or v_event.lifecycle_status is distinct from v_lifecycle
      or v_event.impact_level is distinct from v_impact
      or v_details_changed;
    if v_schedule_changed then
      v_change_kind := 'schedule-changed';
    elsif v_event.lifecycle_status <> 'released' and v_lifecycle = 'released' then
      v_change_kind := 'released';
    else
      v_change_kind := 'result-updated';
    end if;
  end if;

  v_before := case
    when v_event.id is null then null
    else pg_catalog.jsonb_build_object(
      'event_date', v_event.event_date,
      'event_end_date', v_event.event_end_date,
      'event_time', v_event.event_time,
      'time_status', v_event.time_status,
      'market_session', v_event.market_session,
      'lifecycle_status', v_event.lifecycle_status,
      'schedule_confidence', v_event.schedule_confidence,
      'details', coalesce(v_old_detail, '{}'::jsonb)
    )
  end;

  if v_event.id is not null then
    update public.calendar_events
    set
      title = case when v_changed then v_title else title end,
      event_date = case when v_changed then v_event_date else event_date end,
      event_end_date = case when v_changed then null else event_end_date end,
      event_time = case when v_changed then null else event_time end,
      event_instant = case when v_changed then null else event_instant end,
      time_status = case when v_changed then 'time-not-announced' else time_status end,
      market_session = case when v_changed then 'tna' else market_session end,
      lifecycle_status = case when v_changed then v_lifecycle else lifecycle_status end,
      schedule_confidence = case when v_changed then v_confidence else schedule_confidence end,
      impact_level = case when v_changed then v_impact else impact_level end,
      current_revision = current_revision + case when v_changed then 1 else 0 end,
      last_seen_at = greatest(last_seen_at, v_fetched_at),
      updated_at = case when v_changed then v_now else updated_at end
    where id = v_event_id;
  end if;

  insert into public.calendar_event_sources (
    event_id,
    provider,
    source_agency,
    source_name,
    source_url,
    source_event_key,
    source_modified_at,
    fetched_at,
    checksum,
    confidence,
    raw_payload_id,
    created_at,
    updated_at
  )
  values (
    v_event_id,
    'fmp',
    'Financial Modeling Prep',
    'FMP Company Calendar',
    null,
    v_source_event_key,
    v_source_modified_at,
    v_fetched_at,
    v_raw_checksum,
    'medium',
    v_raw_id,
    v_now,
    v_now
  )
  on conflict (provider, source_event_key)
  where source_event_key is not null
  do update set
    source_modified_at = excluded.source_modified_at,
    fetched_at = excluded.fetched_at,
    checksum = excluded.checksum,
    confidence = excluded.confidence,
    raw_payload_id = excluded.raw_payload_id,
    updated_at = excluded.updated_at
  returning id into v_source_id;

  if v_ticker is not null then
    insert into public.calendar_event_securities (event_id, ticker, role)
    values (v_event_id, v_ticker, 'primary')
    on conflict (event_id, ticker)
    do update set role = excluded.role;
  end if;

  insert into public.calendar_event_details (
    event_id,
    detail,
    schema_version,
    created_at,
    updated_at
  )
  values (v_event_id, v_detail, 1, v_now, v_now)
  on conflict (event_id)
  do update set
    detail = case
      when v_changed then excluded.detail
      else public.calendar_event_details.detail
    end,
    updated_at = case
      when v_changed then excluded.updated_at
      else public.calendar_event_details.updated_at
    end;

  select pg_catalog.jsonb_build_object(
    'event_date', event_row.event_date,
    'event_end_date', event_row.event_end_date,
    'event_time', event_row.event_time,
    'time_status', event_row.time_status,
    'market_session', event_row.market_session,
    'lifecycle_status', event_row.lifecycle_status,
    'schedule_confidence', event_row.schedule_confidence,
    'details', details.detail
  )
  into v_after
  from public.calendar_events as event_row
  join public.calendar_event_details as details
    on details.event_id = event_row.id
  where event_row.id = v_event_id;

  if v_changed then
    v_history_fingerprint := v_fingerprint;
    if exists (
      select 1
      from public.calendar_event_history as history
      where history.event_id = v_event_id
        and history.observation_fingerprint = v_history_fingerprint
    ) then
      v_history_fingerprint :=
        v_fingerprint || ':revision:' || (
          select event_row.current_revision::text
          from public.calendar_events as event_row
          where event_row.id = v_event_id
        );
    end if;
    insert into public.calendar_event_history (
      event_id,
      revision,
      change_kind,
      before_schedule,
      after_schedule,
      observation_fingerprint,
      source_id,
      observed_at,
      created_at
    )
    select
      event_row.id,
      event_row.current_revision,
      v_change_kind,
      v_before,
      v_after,
      v_history_fingerprint,
      v_source_id,
      v_fetched_at,
      v_now
    from public.calendar_events as event_row
    where event_row.id = v_event_id;
    v_history_created := true;
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'event_id', event_row.id,
      'history_created', v_history_created,
      'revision', event_row.current_revision,
      'unchanged', not v_changed,
      'upserted', v_upserted
    )
    from public.calendar_events as event_row
    where event_row.id = v_event_id
  );
end
$function$;

comment on function public.ingest_fmp_calendar_observation(jsonb) is
  'Service-role-only atomic FMP Company calendar backfill. FMP does not supply provider event IDs, so the caller must provide a tested provider-neutral occurrence identity that excludes the scheduled event date.';

revoke all on function public.ingest_fmp_calendar_observation(jsonb)
  from public;
revoke all on function public.ingest_fmp_calendar_observation(jsonb)
  from anon;
revoke all on function public.ingest_fmp_calendar_observation(jsonb)
  from authenticated;
grant execute on function public.ingest_fmp_calendar_observation(jsonb)
  to service_role;
