create or replace function public.get_user_calendar_event_follow_active_count(
  p_user_id uuid
)
returns table (
  active_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.count(*)::bigint as active_count
  from public.user_calendar_event_follows as follow
  join public.calendar_events as event
    on event.id = follow.event_id
  where follow.user_id = p_user_id
    and follow.enabled
    and event.lifecycle_status not in ('released', 'completed', 'cancelled')
    and (
      (event.event_instant is not null and event.event_instant >= pg_catalog.now())
      or (
        event.event_instant is null
        and event.event_date >= (pg_catalog.now() at time zone 'America/New_York')::date
      )
    );
$function$;

comment on function public.get_user_calendar_event_follow_active_count(uuid) is
  'Service-only exact count of enabled, actionable Calendar follows. Released/completed/cancelled and past events do not consume plan quota.';

create or replace function public.set_user_calendar_event_follow_with_limit(
  p_user_id uuid,
  p_event_id uuid,
  p_enabled boolean,
  p_limit integer
)
returns table (
  follow_id uuid,
  enabled boolean,
  active_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_follow_id uuid;
  v_existing_enabled boolean := false;
  v_target_consumes_quota boolean := false;
  v_active_count bigint := 0;
begin
  if p_limit is not null and p_limit < 0 then
    raise exception using
      errcode = '22023',
      message = 'CALENDAR_FOLLOW_LIMIT_INVALID';
  end if;

  -- Serialize quota decisions per user so concurrent follows cannot both pass
  -- the same count check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select follow.id, follow.enabled
    into v_follow_id, v_existing_enabled
  from public.user_calendar_event_follows as follow
  where follow.user_id = p_user_id
    and follow.event_id = p_event_id;

  if p_enabled and not coalesce(v_existing_enabled, false) then
    select exists (
      select 1
      from public.calendar_events as event
      where event.id = p_event_id
        and event.lifecycle_status not in ('released', 'completed', 'cancelled')
        and (
          (event.event_instant is not null and event.event_instant >= pg_catalog.now())
          or (
            event.event_instant is null
            and event.event_date >= (pg_catalog.now() at time zone 'America/New_York')::date
          )
        )
    ) into v_target_consumes_quota;

    if v_target_consumes_quota and p_limit is not null then
      select usage.active_count
        into v_active_count
      from public.get_user_calendar_event_follow_active_count(p_user_id) as usage;

      if v_active_count >= p_limit then
        raise exception using
          errcode = 'P0001',
          message = 'CALENDAR_FOLLOW_LIMIT_REACHED';
      end if;
    end if;
  end if;

  insert into public.user_calendar_event_follows as follow (
    user_id,
    event_id,
    enabled
  )
  values (
    p_user_id,
    p_event_id,
    p_enabled
  )
  on conflict (user_id, event_id)
  do update set enabled = excluded.enabled
  returning follow.id into v_follow_id;

  select usage.active_count
    into v_active_count
  from public.get_user_calendar_event_follow_active_count(p_user_id) as usage;

  return query
  select v_follow_id, p_enabled, v_active_count;
end;
$function$;

comment on function public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer) is
  'Service-only atomic Calendar follow mutation. A per-user transaction lock protects the active plan quota from concurrent requests.';

revoke all on function public.get_user_calendar_event_follow_active_count(uuid)
  from public, anon, authenticated;
revoke all on function public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer)
  from public, anon, authenticated;

grant execute on function public.get_user_calendar_event_follow_active_count(uuid)
  to service_role;
grant execute on function public.set_user_calendar_event_follow_with_limit(uuid, uuid, boolean, integer)
  to service_role;

-- All mutations now pass through the server route and the atomic RPC. Existing
-- own-row SELECT access remains available under RLS.
revoke insert, update, delete on table public.user_calendar_event_follows
  from authenticated;
