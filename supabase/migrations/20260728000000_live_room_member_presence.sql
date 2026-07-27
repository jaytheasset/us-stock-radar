begin;

-- This version follows the existing Live Room blocks and member activity
-- migrations because the summary RPC reuses their tables.
-- Same-room member presence is server-owned, deliberately coarse, and
-- expires by database time. Browsers never receive member IDs or timestamps.

alter table public.live_room_member_profiles
  add column if not exists show_presence boolean not null default true;

create table if not exists public.live_room_member_presence (
  member_user_id uuid primary key
    references public.user_profiles(id) on delete cascade,
  ticker text not null
    check (
      ticker = upper(btrim(ticker))
      and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
    ),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_room_member_presence_ticker_seen_idx
  on public.live_room_member_presence (ticker, last_seen_at desc);

alter table public.live_room_member_presence enable row level security;

revoke all on table public.live_room_member_presence
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.live_room_member_presence
  to service_role;

create or replace function public.set_live_room_member_presence_heartbeat(
  p_member_user_id uuid,
  p_ticker text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_show_presence boolean;
begin
  if p_member_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if p_ticker is null
    or p_ticker <> pg_catalog.upper(pg_catalog.btrim(p_ticker))
    or p_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
  then
    raise exception 'LIVE_ROOM_PRESENCE_INVALID_TICKER';
  end if;

  select profile.show_presence
  into v_show_presence
  from public.live_room_member_profiles as profile
  where profile.user_id = p_member_user_id;

  if v_show_presence is distinct from true then
    delete from public.live_room_member_presence
    where member_user_id = p_member_user_id;
    return false;
  end if;

  insert into public.live_room_member_presence (
    member_user_id,
    ticker,
    last_seen_at,
    updated_at
  )
  values (
    p_member_user_id,
    p_ticker,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (member_user_id) do update
  set
    ticker = excluded.ticker,
    last_seen_at = pg_catalog.now(),
    updated_at = pg_catalog.now();

  return true;
end;
$$;

create or replace function public.get_live_room_presence_setting(
  p_member_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select profile.show_presence
  from public.live_room_member_profiles as profile
  where profile.user_id = p_member_user_id
$$;

create or replace function public.set_live_room_presence_setting(
  p_member_user_id uuid,
  p_show_presence boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_member_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;
  if p_show_presence is null then
    raise exception 'LIVE_ROOM_INVALID_PRESENCE_SETTING';
  end if;

  update public.live_room_member_profiles
  set show_presence = p_show_presence
  where user_id = p_member_user_id;

  if not found then
    raise exception 'LIVE_ROOM_PROFILE_UNAVAILABLE';
  end if;

  if not p_show_presence then
    delete from public.live_room_member_presence
    where member_user_id = p_member_user_id;
  end if;

  return p_show_presence;
end;
$$;

create or replace function public.get_live_room_member_presence_summary(
  p_member_user_id uuid,
  p_ticker text,
  p_message_ids uuid[],
  p_message_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with request_context as (
    select
      greatest(1, least(coalesce(p_message_limit, 50), 50)) as message_limit
    where p_member_user_id is not null
      and exists (
        select 1
        from public.live_room_member_profiles as profile
        where profile.user_id = p_member_user_id
      )
      and p_ticker is not null
      and p_ticker = pg_catalog.upper(pg_catalog.btrim(p_ticker))
      and p_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
  ),
  requested_message_ids as (
    select requested.message_id, requested.ordinality
    from request_context as context
    cross join lateral pg_catalog.unnest(
      p_message_ids[1:context.message_limit]
    ) with ordinality as requested(message_id, ordinality)
  ),
  requested_messages as (
    select
      requested.message_id,
      requested.ordinality,
      message.member_user_id
    from requested_message_ids as requested
    join public.live_room_messages as message
      on message.id = requested.message_id
      and message.author_kind = 'member'
      and message.visibility_status = 'visible'
    join public.live_room_rooms as room
      on room.id = message.room_id
      and room.ticker = p_ticker
  ),
  message_presence as (
    select
      message.message_id,
      message.ordinality,
      (
        presence.member_user_id is not null
        and profile.show_presence = true
        and not exists (
          select 1
          from public.live_room_actor_blocks as block
          where block.blocker_kind = 'member'
            and block.blocked_kind = 'member'
            and (
              (
                block.blocker_member_user_id = p_member_user_id
                and block.blocked_member_user_id = message.member_user_id
              )
              or (
                block.blocker_member_user_id = message.member_user_id
                and block.blocked_member_user_id = p_member_user_id
              )
            )
        )
      ) as is_online
    from requested_messages as message
    join public.live_room_member_profiles as profile
      on profile.user_id = message.member_user_id
    left join public.live_room_member_presence as presence
      on presence.member_user_id = message.member_user_id
      and presence.ticker = p_ticker
      and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes'
  ),
  room_count as (
    select pg_catalog.count(*)::integer as online_member_count
    from public.live_room_member_presence as presence
    join public.live_room_member_profiles as profile
      on profile.user_id = presence.member_user_id
      and profile.show_presence = true
    join request_context as context on true
    where presence.ticker = p_ticker
      and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes'
  )
  select pg_catalog.jsonb_build_object(
    'onlineMemberCount',
    coalesce(
      (select count.online_member_count from room_count as count),
      0
    ),
    'messages',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', presence.message_id,
            'isOnline', presence.is_online
          )
          order by presence.ordinality
        )
        from message_presence as presence
      ),
      '[]'::jsonb
    )
  )
$$;

revoke execute on function public.set_live_room_member_presence_heartbeat(
  uuid,
  text
) from public, anon, authenticated;
revoke execute on function public.get_live_room_presence_setting(uuid)
  from public, anon, authenticated;
revoke execute on function public.set_live_room_presence_setting(
  uuid,
  boolean
) from public, anon, authenticated;
revoke execute on function public.get_live_room_member_presence_summary(
  uuid,
  text,
  uuid[],
  integer
) from public, anon, authenticated;

grant execute on function public.set_live_room_member_presence_heartbeat(
  uuid,
  text
) to service_role;
grant execute on function public.get_live_room_presence_setting(uuid)
  to service_role;
grant execute on function public.set_live_room_presence_setting(
  uuid,
  boolean
) to service_role;
grant execute on function public.get_live_room_member_presence_summary(
  uuid,
  text,
  uuid[],
  integer
) to service_role;

commit;
