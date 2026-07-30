create table public.brokerage_manual_refreshes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  provider text not null default 'snaptrade' check (provider = 'snaptrade'),
  provider_account_id text not null,
  provider_authorization_id text not null,
  expected_account_ids text[] not null,
  completed_account_ids text[] not null default array[]::text[],
  failed_account_ids text[] not null default array[]::text[],
  status text not null default 'reserved'
    check (status in ('reserved', 'queued', 'succeeded', 'failed', 'request_failed')),
  requested_at timestamptz not null default now(),
  provider_accepted_at timestamptz,
  completed_at timestamptz,
  counted_at timestamptz,
  estimated_cost_cents integer not null default 5
    check (estimated_cost_cents between 0 and 10000),
  failure_code text,
  constraint brokerage_manual_refresh_expected_accounts_present
    check (cardinality(expected_account_ids) > 0),
  constraint brokerage_manual_refresh_counted_success_only
    check (counted_at is null or status = 'succeeded')
);

create index brokerage_manual_refresh_user_month_idx
  on public.brokerage_manual_refreshes (user_id, requested_at desc);

create index brokerage_manual_refresh_connection_cooldown_idx
  on public.brokerage_manual_refreshes (
    user_id,
    provider_authorization_id,
    provider_accepted_at desc
  )
  where provider_accepted_at is not null;

create index brokerage_manual_refresh_pending_idx
  on public.brokerage_manual_refreshes (
    user_id,
    provider_authorization_id,
    provider_accepted_at desc
  )
  where status in ('reserved', 'queued');

alter table public.brokerage_manual_refreshes enable row level security;

revoke all on table public.brokerage_manual_refreshes
  from public, anon, authenticated;
grant select, insert, update on table public.brokerage_manual_refreshes
  to service_role;

create function public.reserve_brokerage_manual_refresh(
  p_user_id uuid,
  p_provider_account_id text,
  p_provider_authorization_id text,
  p_expected_account_ids text[],
  p_monthly_limit integer default 20,
  p_cooldown_seconds integer default 600,
  p_estimated_cost_cents integer default 5
)
returns table (
  request_id uuid,
  successful_used integer,
  pending_count integer,
  remaining_count integer,
  available_count integer,
  refresh_requested_at timestamptz,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_available integer;
  v_expected_account_ids text[];
  v_month_start timestamptz;
  v_next_month timestamptz;
  v_pending integer;
  v_request_id uuid;
  v_requested_at timestamptz;
  v_successful integer;
begin
  if p_user_id is null
    or btrim(coalesce(p_provider_account_id, '')) = ''
    or btrim(coalesce(p_provider_authorization_id, '')) = ''
    or p_monthly_limit < 1
    or p_cooldown_seconds < 60
    or p_estimated_cost_cents < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'BROKERAGE_REFRESH_INVALID_REQUEST';
  end if;

  select coalesce(
    array_agg(distinct btrim(input.account_id)),
    array[]::text[]
  )
  into v_expected_account_ids
  from unnest(coalesce(p_expected_account_ids, array[]::text[]))
    as input(account_id)
  where btrim(input.account_id) <> '';

  if cardinality(v_expected_account_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'BROKERAGE_REFRESH_INVALID_REQUEST';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'brokerage-refresh:' || p_user_id::text,
      0
    )
  );

  v_month_start :=
    pg_catalog.date_trunc('month', pg_catalog.timezone('UTC', now()))
    at time zone 'UTC';
  v_next_month := v_month_start + interval '1 month';

  update public.brokerage_manual_refreshes
  set
    completed_at = now(),
    failure_code = 'RESERVATION_EXPIRED',
    status = 'request_failed'
  where user_id = p_user_id
    and status = 'reserved'
    and requested_at < now() - interval '5 minutes';

  update public.brokerage_manual_refreshes
  set
    completed_at = now(),
    failure_code = 'SYNC_TIMEOUT',
    status = 'failed'
  where user_id = p_user_id
    and status = 'queued'
    and provider_accepted_at < now() - interval '1 hour';

  if exists (
    select 1
    from public.brokerage_manual_refreshes as refresh
    where refresh.user_id = p_user_id
      and refresh.provider_authorization_id = p_provider_authorization_id
      and refresh.provider_accepted_at >
        now() - pg_catalog.make_interval(secs => p_cooldown_seconds)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROKERAGE_REFRESH_COOLDOWN';
  end if;

  select count(*)::integer
  into v_successful
  from public.brokerage_manual_refreshes as refresh
  where refresh.user_id = p_user_id
    and refresh.status = 'succeeded'
    and refresh.counted_at >= v_month_start
    and refresh.counted_at < v_next_month;

  select count(*)::integer
  into v_pending
  from public.brokerage_manual_refreshes as refresh
  where refresh.user_id = p_user_id
    and refresh.status in ('reserved', 'queued')
    and refresh.requested_at >= v_month_start
    and refresh.requested_at < v_next_month;

  v_available := greatest(p_monthly_limit - v_successful - v_pending, 0);
  if v_available = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'BROKERAGE_REFRESH_LIMIT_REACHED';
  end if;

  insert into public.brokerage_manual_refreshes (
    user_id,
    provider_account_id,
    provider_authorization_id,
    expected_account_ids,
    estimated_cost_cents
  )
  values (
    p_user_id,
    p_provider_account_id,
    p_provider_authorization_id,
    v_expected_account_ids,
    p_estimated_cost_cents
  )
  returning id, requested_at into v_request_id, v_requested_at;

  request_id := v_request_id;
  successful_used := v_successful;
  pending_count := v_pending + 1;
  remaining_count := greatest(p_monthly_limit - v_successful, 0);
  available_count :=
    greatest(p_monthly_limit - v_successful - v_pending - 1, 0);
  refresh_requested_at := v_requested_at;
  reset_at := v_next_month;
  return next;
end
$function$;

create function public.record_brokerage_manual_refresh_webhook(
  p_user_id uuid,
  p_provider_authorization_id text,
  p_provider_account_id text,
  p_succeeded boolean,
  p_event_timestamp timestamptz
)
returns table (
  refresh_request_id uuid,
  refresh_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed text[];
  v_expected text[];
  v_failed text[];
  v_request_id uuid;
  v_requested_at timestamptz;
  v_status text;
begin
  if p_user_id is null
    or btrim(coalesce(p_provider_authorization_id, '')) = ''
    or btrim(coalesce(p_provider_account_id, '')) = ''
    or p_event_timestamp is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'brokerage-refresh:' || p_user_id::text,
      0
    )
  );

  select
    refresh.id,
    refresh.expected_account_ids,
    refresh.completed_account_ids,
    refresh.failed_account_ids,
    refresh.requested_at,
    refresh.status
  into
    v_request_id,
    v_expected,
    v_completed,
    v_failed,
    v_requested_at,
    v_status
  from public.brokerage_manual_refreshes as refresh
  where refresh.user_id = p_user_id
    and refresh.provider_authorization_id = p_provider_authorization_id
    and refresh.status = 'queued'
    and p_provider_account_id = any(refresh.expected_account_ids)
    and refresh.provider_accepted_at <= p_event_timestamp + interval '5 minutes'
    and refresh.provider_accepted_at >= p_event_timestamp - interval '2 hours'
  order by refresh.provider_accepted_at desc
  limit 1
  for update;

  if v_request_id is null then
    return;
  end if;

  if not (p_provider_account_id = any(v_completed)) then
    v_completed := pg_catalog.array_append(v_completed, p_provider_account_id);
    if not p_succeeded then
      v_failed := pg_catalog.array_append(v_failed, p_provider_account_id);
    end if;
  end if;

  if cardinality(v_completed) >= cardinality(v_expected) then
    v_status := case
      when cardinality(v_failed) = 0 then 'succeeded'
      else 'failed'
    end;
  else
    v_status := 'queued';
  end if;

  update public.brokerage_manual_refreshes
  set
    completed_account_ids = v_completed,
    failed_account_ids = v_failed,
    status = v_status,
    completed_at = case when v_status in ('succeeded', 'failed')
      then p_event_timestamp
      else null
    end,
    counted_at = case when v_status = 'succeeded'
      then v_requested_at
      else null
    end,
    failure_code = case when v_status = 'failed'
      then 'PROVIDER_SYNC_FAILED'
      else null
    end
  where id = v_request_id;

  refresh_request_id := v_request_id;
  refresh_status := v_status;
  return next;
end
$function$;

revoke all on function public.reserve_brokerage_manual_refresh(
  uuid, text, text, text[], integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_brokerage_manual_refresh(
  uuid, text, text, text[], integer, integer, integer
) to service_role;

revoke all on function public.record_brokerage_manual_refresh_webhook(
  uuid, text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_brokerage_manual_refresh_webhook(
  uuid, text, text, boolean, timestamptz
) to service_role;
