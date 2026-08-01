-- Calendar 2C: atomic FMP Economic Calendar observations.
--
-- HTTP fetches and classification remain in the server-only adapter. This
-- service-role-only RPC persists one normalized Macro or supported Policy
-- release atomically without creating alert candidates.

create or replace function public.ingest_fmp_economic_calendar_observation(
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
  v_old_detail jsonb := '{}'::jsonb;
  v_detail jsonb := coalesce(p_observation->'details', '{}'::jsonb);
  v_metrics jsonb := coalesce(p_observation->'metrics', '[]'::jsonb);
  v_old_metrics jsonb := '[]'::jsonb;
  v_new_metrics jsonb := '[]'::jsonb;
  v_raw_payload jsonb := p_observation->'raw_payload';
  v_canonical_identity text :=
    pg_catalog.btrim(p_observation->>'canonical_identity_key');
  v_category text := pg_catalog.btrim(p_observation->>'category');
  v_event_type text := pg_catalog.btrim(p_observation->>'event_type');
  v_policy_subcategory text :=
    nullif(pg_catalog.btrim(p_observation->>'policy_subcategory'), '');
  v_event_date date;
  v_event_time time without time zone;
  v_event_timezone text :=
    pg_catalog.btrim(p_observation->>'event_timezone');
  v_event_instant timestamptz;
  v_time_status text := pg_catalog.btrim(p_observation->>'time_status');
  v_market_session text := pg_catalog.btrim(p_observation->>'market_session');
  v_lifecycle text := pg_catalog.btrim(p_observation->>'lifecycle_status');
  v_confidence text :=
    pg_catalog.btrim(p_observation->>'schedule_confidence');
  v_impact text := pg_catalog.btrim(p_observation->>'impact_level');
  v_impact_scope text := pg_catalog.btrim(p_observation->>'impact_scope');
  v_title text := pg_catalog.btrim(p_observation->>'title');
  v_source_agency text := pg_catalog.btrim(p_observation->>'source_agency');
  v_source_name text := pg_catalog.btrim(p_observation->>'source_name');
  v_source_event_key text :=
    pg_catalog.btrim(p_observation->>'source_event_key');
  v_raw_checksum text := pg_catalog.btrim(p_observation->>'raw_checksum');
  v_fingerprint text :=
    pg_catalog.btrim(p_observation->>'observation_fingerprint');
  v_history_fingerprint text;
  v_run_id text := pg_catalog.btrim(p_observation->>'run_id');
  v_request_from date;
  v_request_to date;
  v_fetched_at timestamptz;
  v_schedule_changed boolean := false;
  v_details_changed boolean := false;
  v_metrics_changed boolean := false;
  v_changed boolean := false;
  v_history_created boolean := false;
  v_upserted boolean := false;
  v_change_kind text;
  v_before jsonb;
  v_after jsonb;
begin
  if pg_catalog.jsonb_typeof(p_observation) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_OBSERVATION_INVALID';
  end if;
  if p_observation->>'provider' <> 'fmp'
    or p_observation->>'mode' <> 'backfill'
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_SCOPE_INVALID';
  end if;
  if v_event_type not in (
    'cpi',
    'ppi',
    'pce',
    'employment-situation',
    'jolts',
    'gdp-advance',
    'retail-sales',
    'fomc-decision',
    'fomc-minutes',
    'treasury-refunding',
    'treasury-auction-10y',
    'treasury-auction-30y'
  ) then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_EVENT_TYPE_INVALID';
  end if;
  if (
    v_event_type in (
      'cpi',
      'ppi',
      'pce',
      'employment-situation',
      'jolts',
      'gdp-advance',
      'retail-sales'
    )
    and (v_category <> 'macro' or v_policy_subcategory is not null)
  ) or (
    v_event_type in ('fomc-decision', 'fomc-minutes')
    and (
      v_category <> 'policy'
      or v_policy_subcategory <> 'monetary-policy'
    )
  ) or (
    v_event_type in (
      'treasury-refunding',
      'treasury-auction-10y',
      'treasury-auction-30y'
    )
    and (
      v_category <> 'policy'
      or v_policy_subcategory <> 'treasury'
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_TAXONOMY_INVALID';
  end if;
  if v_lifecycle not in ('scheduled', 'released')
    or v_confidence <> 'tentative'
    or v_impact not in ('high', 'medium', 'low')
    or v_impact_scope <> 'market-wide'
    or v_time_status <> 'exact'
    or v_market_session not in ('bmo', 'market-hours', 'amc')
    or v_event_timezone <> 'America/New_York'
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_STATE_INVALID';
  end if;
  if pg_catalog.length(v_canonical_identity) = 0
    or pg_catalog.length(v_title) = 0
    or pg_catalog.length(v_source_agency) = 0
    or pg_catalog.length(v_source_name) = 0
    or pg_catalog.length(v_source_event_key) = 0
    or v_source_event_key <> v_canonical_identity
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_IDENTITY_INVALID';
  end if;
  if v_raw_checksum !~ '^[0-9a-f]{64}$'
    or v_fingerprint !~ '^[0-9a-f]{64}$'
    or pg_catalog.length(v_run_id) = 0
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_FINGERPRINT_INVALID';
  end if;
  if pg_catalog.jsonb_typeof(v_detail) <> 'object'
    or pg_catalog.jsonb_typeof(v_metrics) <> 'array'
    or pg_catalog.jsonb_typeof(v_raw_payload) <> 'object'
    or pg_catalog.jsonb_typeof(v_raw_payload->'rows') <> 'array'
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_PAYLOAD_INVALID';
  end if;
  if (v_category = 'macro' and pg_catalog.jsonb_array_length(v_metrics) = 0)
    or (v_category = 'policy' and pg_catalog.jsonb_array_length(v_metrics) <> 0)
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_METRIC_SCOPE_INVALID';
  end if;

  begin
    v_event_date := (p_observation->>'event_date')::date;
    v_event_time := (p_observation->>'event_time')::time without time zone;
    v_event_instant := (p_observation->>'event_instant')::timestamptz;
    v_request_from := (p_observation->>'request_from')::date;
    v_request_to := (p_observation->>'request_to')::date;
    v_fetched_at := (p_observation->>'fetched_at')::timestamptz;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'metric_key', metric.metric_key,
          'name', metric.name,
          'actual', metric.actual,
          'consensus', metric.consensus,
          'previous', metric.previous,
          'unit', metric.unit,
          'release_stage', metric.release_stage,
          'released', metric.released
        )
        order by metric.metric_key, metric.release_stage
      ),
      '[]'::jsonb
    )
    into v_new_metrics
    from pg_catalog.jsonb_to_recordset(v_metrics) as metric(
      metric_key text,
      name text,
      actual numeric,
      consensus numeric,
      previous numeric,
      unit text,
      release_stage text,
      released boolean
    );
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'ECONOMIC_CALENDAR_VALUE_INVALID';
  end;

  if v_request_to < v_request_from
    or v_event_date < v_request_from
    or v_event_date > v_request_to
  then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_REQUEST_WINDOW_INVALID';
  end if;
  if pg_catalog.strpos(v_canonical_identity, v_event_date::text) > 0 then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_IDENTITY_CONTAINS_SCHEDULED_DATE';
  end if;
  if (
    (v_event_date + v_event_time)
      at time zone 'America/New_York'
  ) is distinct from v_event_instant then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_TIMEZONE_MISMATCH';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(v_metrics) as metric(
      metric_key text,
      name text,
      actual numeric,
      consensus numeric,
      previous numeric,
      unit text,
      release_stage text,
      released boolean
    )
    where metric.metric_key is null
      or metric.metric_key <> pg_catalog.btrim(metric.metric_key)
      or pg_catalog.length(metric.metric_key) = 0
      or metric.name is null
      or metric.name <> pg_catalog.btrim(metric.name)
      or pg_catalog.length(metric.name) = 0
      or metric.unit not in (
        'percent',
        'thousands',
        'index',
        'billions-usd'
      )
      or metric.release_stage not in (
        'monthly',
        'advance',
        'preliminary',
        'final'
      )
      or metric.released is null
      or (
        not metric.released
        and metric.actual is not null
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_METRIC_INVALID';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_to_recordset(v_metrics) as metric(
      metric_key text,
      release_stage text
    )
  ) <> (
    select pg_catalog.count(*)
    from (
      select metric.metric_key, metric.release_stage
      from pg_catalog.jsonb_to_recordset(v_metrics) as metric(
        metric_key text,
        release_stage text
      )
      group by metric.metric_key, metric.release_stage
    ) as unique_metrics
  ) then
    raise exception using
      errcode = '22023',
      message = 'ECONOMIC_CALENDAR_METRIC_DUPLICATE';
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
    v_request_from,
    v_request_to,
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

  if v_event.id is not null then
    select details.detail
    into v_old_detail
    from public.calendar_event_details as details
    where details.event_id = v_event.id;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'metric_key', metric.metric_key,
          'name', metric.name,
          'actual', metric.actual,
          'consensus', metric.consensus,
          'previous', metric.previous,
          'unit', metric.unit,
          'release_stage', metric.release_stage,
          'released', metric.released
        )
        order by metric.metric_key, metric.release_stage
      ),
      '[]'::jsonb
    )
    into v_old_metrics
    from public.calendar_event_metrics as metric
    where metric.event_id = v_event.id;
  end if;

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
      v_category,
      v_title,
      v_event_date,
      null,
      v_event_time,
      v_event_timezone,
      v_event_instant,
      v_time_status,
      v_market_session,
      v_lifecycle,
      v_confidence,
      v_impact,
      v_impact_scope,
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
      or v_event.event_time is distinct from v_event_time
      or v_event.event_timezone is distinct from v_event_timezone
      or v_event.event_instant is distinct from v_event_instant
      or v_event.time_status is distinct from v_time_status
      or v_event.market_session is distinct from v_market_session
      or v_event.schedule_confidence is distinct from v_confidence;
    v_details_changed :=
      coalesce(v_old_detail, '{}'::jsonb) is distinct from v_detail;
    v_metrics_changed := v_old_metrics is distinct from v_new_metrics;
    v_changed :=
      v_schedule_changed
      or v_event.event_type is distinct from v_event_type
      or v_event.category is distinct from v_category
      or v_event.title is distinct from v_title
      or v_event.lifecycle_status is distinct from v_lifecycle
      or v_event.impact_level is distinct from v_impact
      or v_event.impact_scope is distinct from v_impact_scope
      or v_details_changed
      or v_metrics_changed;
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
      'event_time', v_event.event_time,
      'event_instant', v_event.event_instant,
      'time_status', v_event.time_status,
      'market_session', v_event.market_session,
      'lifecycle_status', v_event.lifecycle_status,
      'schedule_confidence', v_event.schedule_confidence,
      'details', coalesce(v_old_detail, '{}'::jsonb),
      'metrics', v_old_metrics
    )
  end;

  if v_event.id is not null then
    update public.calendar_events
    set
      event_type = case when v_changed then v_event_type else event_type end,
      category = case when v_changed then v_category else category end,
      title = case when v_changed then v_title else title end,
      event_date = case when v_changed then v_event_date else event_date end,
      event_end_date = case when v_changed then null else event_end_date end,
      event_time = case when v_changed then v_event_time else event_time end,
      event_timezone = case
        when v_changed then v_event_timezone
        else event_timezone
      end,
      event_instant = case
        when v_changed then v_event_instant
        else event_instant
      end,
      time_status = case when v_changed then v_time_status else time_status end,
      market_session = case
        when v_changed then v_market_session
        else market_session
      end,
      lifecycle_status = case
        when v_changed then v_lifecycle
        else lifecycle_status
      end,
      schedule_confidence = case
        when v_changed then v_confidence
        else schedule_confidence
      end,
      impact_level = case when v_changed then v_impact else impact_level end,
      impact_scope = case
        when v_changed then v_impact_scope
        else impact_scope
      end,
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
    v_source_agency,
    v_source_name,
    null,
    v_source_event_key,
    null,
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
    source_agency = excluded.source_agency,
    source_name = excluded.source_name,
    fetched_at = excluded.fetched_at,
    checksum = excluded.checksum,
    confidence = excluded.confidence,
    raw_payload_id = excluded.raw_payload_id,
    updated_at = excluded.updated_at
  returning id into v_source_id;

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

  if v_changed then
    delete from public.calendar_event_metrics as existing
    where existing.event_id = v_event_id
      and not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(v_metrics) as incoming(
          metric_key text,
          release_stage text
        )
        where incoming.metric_key = existing.metric_key
          and incoming.release_stage = existing.release_stage
      );

    insert into public.calendar_event_metrics (
      event_id,
      metric_key,
      name,
      actual,
      consensus,
      previous,
      actual_text,
      consensus_text,
      previous_text,
      unit,
      unit_raw,
      release_stage,
      released,
      created_at,
      updated_at
    )
    select
      v_event_id,
      metric.metric_key,
      metric.name,
      metric.actual,
      metric.consensus,
      metric.previous,
      null,
      null,
      null,
      metric.unit,
      null,
      metric.release_stage,
      metric.released,
      v_now,
      v_now
    from pg_catalog.jsonb_to_recordset(v_metrics) as metric(
      metric_key text,
      name text,
      actual numeric,
      consensus numeric,
      previous numeric,
      unit text,
      release_stage text,
      released boolean
    )
    on conflict (event_id, metric_key, release_stage)
    do update set
      name = excluded.name,
      actual = excluded.actual,
      consensus = excluded.consensus,
      previous = excluded.previous,
      actual_text = excluded.actual_text,
      consensus_text = excluded.consensus_text,
      previous_text = excluded.previous_text,
      unit = excluded.unit,
      unit_raw = excluded.unit_raw,
      released = excluded.released,
      updated_at = excluded.updated_at;
  end if;

  select pg_catalog.jsonb_build_object(
    'event_date', event_row.event_date,
    'event_time', event_row.event_time,
    'event_instant', event_row.event_instant,
    'time_status', event_row.time_status,
    'market_session', event_row.market_session,
    'lifecycle_status', event_row.lifecycle_status,
    'schedule_confidence', event_row.schedule_confidence,
    'details', details.detail,
    'metrics', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'metric_key', metric.metric_key,
            'name', metric.name,
            'actual', metric.actual,
            'consensus', metric.consensus,
            'previous', metric.previous,
            'unit', metric.unit,
            'release_stage', metric.release_stage,
            'released', metric.released
          )
          order by metric.metric_key, metric.release_stage
        ),
        '[]'::jsonb
      )
      from public.calendar_event_metrics as metric
      where metric.event_id = event_row.id
    )
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

comment on function public.ingest_fmp_economic_calendar_observation(jsonb) is
  'Service-role-only atomic FMP Economic Calendar backfill for the seven supported Macro releases and five FMP-supported Policy schedule types. Canonical identities use reference periods or recurring occurrence keys and exclude exact scheduled dates.';

revoke all on function public.ingest_fmp_economic_calendar_observation(jsonb)
  from public;
revoke all on function public.ingest_fmp_economic_calendar_observation(jsonb)
  from anon;
revoke all on function public.ingest_fmp_economic_calendar_observation(jsonb)
  from authenticated;
grant execute on function public.ingest_fmp_economic_calendar_observation(jsonb)
  to service_role;
