create or replace function public.list_market_activity_chat_items(
  p_blocker_member_user_id uuid default null,
  p_blocker_guest_session_id uuid default null,
  p_limit integer default 8
)
returns table (
  room_kind text,
  ticker text,
  slug text,
  room_name text,
  body text,
  created_at timestamptz,
  activity_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with day_window as (
    select
      date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York' as starts_at,
      (date_trunc('day', now() at time zone 'America/New_York') + interval '1 day')
        at time zone 'America/New_York' as ends_at
  ),
  eligible as (
    select
      room.room_kind,
      room.ticker,
      community.slug,
      community.name as room_name,
      message.body,
      message.created_at,
      count(*) over (partition by message.room_id) as activity_count,
      row_number() over (
        partition by message.room_id
        order by message.created_at desc, message.id desc
      ) as room_message_rank
    from public.live_room_messages as message
    join public.live_room_rooms as room on room.id = message.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    cross join day_window
    where message.created_at >= day_window.starts_at
      and message.created_at < day_window.ends_at
      and message.visibility_status = 'visible'
      -- Any report is treated as moderation-pending for this broad public rail.
      and not exists (
        select 1
        from public.live_room_message_reports as report
        where report.message_id = message.id
      )
      -- Apply the current viewer's personal author blocks before ranking.
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocked_actor_id = message.actor_id
          and (
            (p_blocker_member_user_id is not null
              and block.blocker_kind = 'member'
              and block.blocker_member_user_id = p_blocker_member_user_id)
            or
            (p_blocker_guest_session_id is not null
              and block.blocker_kind = 'guest'
              and block.blocker_guest_session_id = p_blocker_guest_session_id)
          )
      )
      -- Company and Community Rooms are public; direct conversations use
      -- separate live_room_direct_* tables and cannot enter this query.
      and (
        (room.room_kind = 'company' and room.ticker is not null)
        or
        (room.room_kind = 'community' and community.room_id is not null)
      )
  )
  select
    eligible.room_kind,
    eligible.ticker,
    eligible.slug,
    eligible.room_name,
    eligible.body,
    eligible.created_at,
    eligible.activity_count
  from eligible
  where eligible.room_message_rank = 1
  order by eligible.activity_count desc, eligible.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 12));
$$;

revoke all on function public.list_market_activity_chat_items(uuid, uuid, integer) from public;
grant execute on function public.list_market_activity_chat_items(uuid, uuid, integer) to service_role;

comment on function public.list_market_activity_chat_items(uuid, uuid, integer) is
  'Service-only bounded public-room activity rail. Excludes hidden, deleted, reported, moderation-pending, and viewer-blocked messages; never reads direct messages.';
