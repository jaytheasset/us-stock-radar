begin;

-- Live Room follows are chat-read state. They are intentionally unrelated to
-- paid news/filing alert preferences and event delivery.
alter table public.live_room_follows
  drop constraint if exists live_room_follows_notification_scope_check;

update public.live_room_follows
set notification_scope = 'new_chat_messages'
where notification_scope <> 'new_chat_messages';

alter table public.live_room_follows
  alter column notification_scope set default 'new_chat_messages';

alter table public.live_room_follows
  add constraint live_room_follows_notification_scope_check
  check (notification_scope = 'new_chat_messages');

alter table public.live_room_follows
  add column if not exists last_read_at timestamptz not null default now(),
  add column if not exists last_read_message_id uuid
    references public.live_room_messages(id) on delete set null;

create index if not exists live_room_follows_unread_actor_idx
  on public.live_room_follows (actor_kind, actor_id, updated_at desc)
  where followed = true;

create table if not exists public.live_room_member_follows (
  follower_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  followed_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id),
  check (follower_user_id <> followed_user_id)
);

create index if not exists live_room_member_follows_followed_user_idx
  on public.live_room_member_follows (followed_user_id, created_at desc);

alter table public.live_room_member_follows enable row level security;

revoke all privileges
on table public.live_room_member_follows
from public, anon, authenticated;

grant all privileges
on table public.live_room_member_follows
to service_role;

create or replace function public.set_live_room_chat_follow(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_followed boolean
)
returns setof public.live_room_follows
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_latest_message_id uuid;
  v_latest_message_at timestamptz;
  v_follow public.live_room_follows%rowtype;
begin
  if p_followed is null then
    raise exception 'LIVE_ROOM_INVALID_FOLLOW';
  end if;

  if not (
    (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    )
    or
    (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ) then
    raise exception 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_followed then
    select message.id, message.created_at
    into v_latest_message_id, v_latest_message_at
    from public.live_room_messages as message
    where message.room_id = p_room_id
      and message.visibility_status = 'visible'
    order by message.created_at desc, message.id desc
    limit 1;
  end if;

  insert into public.live_room_follows as existing_follow (
    room_id,
    actor_kind,
    member_user_id,
    guest_session_id,
    followed,
    notification_scope,
    last_read_at,
    last_read_message_id
  )
  values (
    p_room_id,
    p_actor_kind,
    p_member_user_id,
    p_guest_session_id,
    p_followed,
    'new_chat_messages',
    coalesce(v_latest_message_at, now()),
    v_latest_message_id
  )
  on conflict (room_id, actor_kind, actor_id)
  do update set
    followed = excluded.followed,
    notification_scope = 'new_chat_messages',
    last_read_at = case
      when excluded.followed then excluded.last_read_at
      else existing_follow.last_read_at
    end,
    last_read_message_id = case
      when excluded.followed then excluded.last_read_message_id
      else existing_follow.last_read_message_id
    end
  returning * into v_follow;

  return next v_follow;
end
$$;

create or replace function public.mark_live_room_follow_read(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_message_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_read_at timestamptz;
  v_updated_count integer;
begin
  if not (
    (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    )
    or
    (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ) then
    raise exception 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_message_id is null then
    v_read_at := now();
  else
    select message.created_at
    into v_read_at
    from public.live_room_messages as message
    where message.id = p_message_id
      and message.room_id = p_room_id
      and message.visibility_status = 'visible';

    if v_read_at is null then
      raise exception 'LIVE_ROOM_MESSAGE_NOT_FOUND';
    end if;
  end if;

  update public.live_room_follows as follow
  set
    last_read_message_id = case
      when v_read_at >= follow.last_read_at then p_message_id
      else follow.last_read_message_id
    end,
    last_read_at = greatest(follow.last_read_at, v_read_at),
    notification_scope = 'new_chat_messages'
  where follow.room_id = p_room_id
    and follow.actor_kind = p_actor_kind
    and follow.actor_id = coalesce(p_member_user_id, p_guest_session_id)
    and follow.followed = true;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;

create or replace function public.get_live_room_unread_summary(
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid
)
returns table (
  room_ticker text,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    room.ticker as room_ticker,
    count(message.id)::bigint as unread_count
  from public.live_room_follows as follow
  join public.live_room_rooms as room
    on room.id = follow.room_id
  left join public.live_room_messages as message
    on message.room_id = follow.room_id
    and message.visibility_status = 'visible'
    and (
      message.created_at > follow.last_read_at
      or (
        message.created_at = follow.last_read_at
        and follow.last_read_message_id is not null
        and message.id > follow.last_read_message_id
      )
    )
    and (
      message.author_kind is distinct from follow.actor_kind
      or message.actor_id is distinct from follow.actor_id
    )
  where follow.actor_kind = p_actor_kind
    and follow.actor_id = coalesce(p_member_user_id, p_guest_session_id)
    and follow.followed = true
    and follow.notification_scope = 'new_chat_messages'
  group by room.ticker
  order by count(message.id) desc, room.ticker asc
$$;

revoke all privileges
on function public.set_live_room_chat_follow(
  uuid,
  text,
  uuid,
  uuid,
  boolean
)
from public, anon, authenticated;

revoke all privileges
on function public.mark_live_room_follow_read(
  uuid,
  text,
  uuid,
  uuid,
  uuid
)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_unread_summary(
  text,
  uuid,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.set_live_room_chat_follow(
  uuid,
  text,
  uuid,
  uuid,
  boolean
)
to service_role;

grant execute
on function public.mark_live_room_follow_read(
  uuid,
  text,
  uuid,
  uuid,
  uuid
)
to service_role;

grant execute
on function public.get_live_room_unread_summary(
  text,
  uuid,
  uuid
)
to service_role;

comment on table public.live_room_follows is
  'Saved Live Rooms and per-actor chat read cursors. This table is not part of paid news/filing Alerts delivery.';

comment on table public.live_room_member_follows is
  'Service-only member relationship storage. No notification, feed, or recommendation delivery is implied.';

commit;
