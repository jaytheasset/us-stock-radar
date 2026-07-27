begin;

-- Member follows gain a per-follow read cursor. The cursor is deliberately
-- independent from room-follow unread state and paid news/filing Alerts.
alter table public.live_room_member_follows
  add column if not exists last_read_at timestamptz not null default now(),
  add column if not exists last_read_message_id uuid
    references public.live_room_messages(id) on delete set null;

alter table public.live_room_member_follows enable row level security;

create index if not exists live_room_member_follows_activity_cursor_idx
  on public.live_room_member_follows (
    follower_user_id,
    last_read_at,
    followed_user_id
  );

create index if not exists live_room_member_follows_read_message_idx
  on public.live_room_member_follows (last_read_message_id)
  where last_read_message_id is not null;

create index if not exists live_room_messages_member_activity_idx
  on public.live_room_messages (
    member_user_id,
    created_at desc,
    id desc
  )
  where author_kind = 'member'
    and visibility_status = 'visible'
    and member_user_id is not null;

create or replace function public.set_live_room_member_follow(
  p_follower_user_id uuid,
  p_room_id uuid,
  p_message_id uuid,
  p_followed boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_followed_user_id uuid;
  v_latest_message_id uuid;
  v_latest_message_at timestamptz;
begin
  if p_followed is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MEMBER_FOLLOW';
  end if;

  select message.member_user_id
  into v_followed_user_id
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_followed_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_NOT_FOLLOWABLE';
  end if;

  if v_followed_user_id = p_follower_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_FOLLOW_SELF';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocker_member_user_id = p_follower_user_id
      and block.blocked_kind = 'member'
      and block.blocked_member_user_id = v_followed_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_NOT_FOLLOWABLE';
  end if;

  if not p_followed then
    delete from public.live_room_member_follows as follow
    where follow.follower_user_id = p_follower_user_id
      and follow.followed_user_id = v_followed_user_id;
    return false;
  end if;

  select message.id, message.created_at
  into v_latest_message_id, v_latest_message_at
  from public.live_room_messages as message
  where message.author_kind = 'member'
    and message.member_user_id = v_followed_user_id
    and message.visibility_status = 'visible'
  order by message.created_at desc, message.id desc
  limit 1;

  insert into public.live_room_member_follows (
    follower_user_id,
    followed_user_id,
    last_read_at,
    last_read_message_id
  )
  values (
    p_follower_user_id,
    v_followed_user_id,
    coalesce(v_latest_message_at, now()),
    v_latest_message_id
  )
  on conflict (follower_user_id, followed_user_id)
  do nothing;

  return true;
end
$$;

create or replace function public.mark_live_room_member_activity_read(
  p_follower_user_id uuid,
  p_room_id uuid,
  p_message_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_followed_user_id uuid;
  v_message_at timestamptz;
  v_updated_count integer;
begin
  select message.member_user_id, message.created_at
  into v_followed_user_id, v_message_at
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.author_kind = 'member'
    and message.member_user_id is not null
    and message.visibility_status = 'visible';

  if v_followed_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocker_member_user_id = p_follower_user_id
      and block.blocked_kind = 'member'
      and block.blocked_member_user_id = v_followed_user_id
  ) then
    return false;
  end if;

  update public.live_room_member_follows as follow
  set
    last_read_message_id = case
      when v_message_at > follow.last_read_at
        or (
          v_message_at = follow.last_read_at
          and (
            follow.last_read_message_id is null
            or p_message_id > follow.last_read_message_id
          )
        )
      then p_message_id
      else follow.last_read_message_id
    end,
    last_read_at = greatest(follow.last_read_at, v_message_at)
  where follow.follower_user_id = p_follower_user_id
    and follow.followed_user_id = v_followed_user_id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;

create or replace function public.get_live_room_activity_summary(
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_people_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with actor_context as (
    select
      pg_catalog.coalesce(p_member_user_id, p_guest_session_id) as actor_id,
      pg_catalog.greatest(
        1,
        pg_catalog.least(pg_catalog.coalesce(p_people_limit, 30), 50)
      ) as people_limit
    where (
      p_actor_kind = 'member'
      and p_member_user_id is not null
      and p_guest_session_id is null
    ) or (
      p_actor_kind = 'guest'
      and p_member_user_id is null
      and p_guest_session_id is not null
    )
  ),
  followed_rooms as (
    select
      follow.room_id,
      room.ticker,
      follow.last_read_at,
      follow.last_read_message_id
    from public.live_room_follows as follow
    join public.live_room_rooms as room
      on room.id = follow.room_id
    join actor_context as actor on true
    where follow.actor_kind = p_actor_kind
      and follow.actor_id = actor.actor_id
      and follow.followed = true
      and follow.notification_scope = 'new_chat_messages'
  ),
  room_unread_messages as (
    select
      followed_room.room_id,
      followed_room.ticker,
      message.id as message_id
    from followed_rooms as followed_room
    join public.live_room_messages as message
      on message.room_id = followed_room.room_id
      and message.visibility_status = 'visible'
      and (
        message.created_at > followed_room.last_read_at
        or (
          message.created_at = followed_room.last_read_at
          and followed_room.last_read_message_id is not null
          and message.id > followed_room.last_read_message_id
        )
      )
    join actor_context as actor on true
    where (
      message.author_kind is distinct from p_actor_kind
      or message.actor_id is distinct from actor.actor_id
    )
    and not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = p_actor_kind
        and block.blocker_actor_id = actor.actor_id
        and block.blocked_kind = message.author_kind
        and block.blocked_actor_id = message.actor_id
    )
  ),
  room_summaries as (
    select
      followed_room.ticker,
      pg_catalog.count(room_unread.message_id)::bigint as unread_count
    from followed_rooms as followed_room
    left join room_unread_messages as room_unread
      on room_unread.room_id = followed_room.room_id
    group by followed_room.ticker
  ),
  people_unread_messages as (
    select
      message.id as message_id,
      room.ticker,
      message.author_display_name,
      message.author_emoji,
      pg_catalog.left(
        pg_catalog.regexp_replace(
          message.body,
          '[[:space:]]+',
          ' ',
          'g'
        ),
        160
      ) as body_preview,
      message.created_at
    from public.live_room_member_follows as follow
    join public.live_room_messages as message
      on message.author_kind = 'member'
      and message.member_user_id = follow.followed_user_id
      and message.visibility_status = 'visible'
      and (
        message.created_at > follow.last_read_at
        or (
          message.created_at = follow.last_read_at
          and follow.last_read_message_id is not null
          and message.id > follow.last_read_message_id
        )
      )
    join public.live_room_rooms as room
      on room.id = message.room_id
    where p_actor_kind = 'member'
      and follow.follower_user_id = p_member_user_id
      and follow.followed_user_id <> p_member_user_id
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocker_member_user_id = p_member_user_id
          and block.blocked_kind = 'member'
          and block.blocked_member_user_id = follow.followed_user_id
      )
  ),
  followed_people as (
    select distinct on (follow.followed_user_id)
      follow.followed_user_id,
      message.id as message_id,
      room.ticker,
      message.author_display_name,
      message.author_emoji,
      message.created_at
    from public.live_room_member_follows as follow
    join public.live_room_messages as message
      on message.author_kind = 'member'
      and message.member_user_id = follow.followed_user_id
      and message.visibility_status = 'visible'
    join public.live_room_rooms as room
      on room.id = message.room_id
    where p_actor_kind = 'member'
      and follow.follower_user_id = p_member_user_id
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocker_member_user_id = p_member_user_id
          and block.blocked_kind = 'member'
          and block.blocked_member_user_id = follow.followed_user_id
      )
    order by
      follow.followed_user_id,
      message.created_at desc,
      message.id desc
  ),
  limited_followed_people as (
    select followed.*
    from followed_people as followed
    order by followed.created_at desc, followed.message_id desc
    limit 50
  ),
  limited_people as (
    select people.*
    from people_unread_messages as people
    cross join actor_context as actor
    order by people.created_at desc, people.message_id desc
    limit (select actor.people_limit from actor_context as actor)
  ),
  distinct_unread_messages as (
    select room_unread.message_id
    from room_unread_messages as room_unread
    union
    select people_unread.message_id
    from people_unread_messages as people_unread
  )
  select pg_catalog.jsonb_build_object(
    'isAuthenticated',
    p_actor_kind = 'member',
    'hasMemberFollows',
    p_actor_kind = 'member'
      and exists (
        select 1
        from public.live_room_member_follows as follow
        where follow.follower_user_id = p_member_user_id
      ),
    'followedPeople',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', followed.message_id,
            'ticker', followed.ticker,
            'authorDisplayName', followed.author_display_name,
            'authorEmoji', followed.author_emoji
          )
          order by followed.created_at desc, followed.message_id desc
        )
        from limited_followed_people as followed
      ),
      '[]'::jsonb
    ),
    'rooms',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'ticker', room.ticker,
            'unreadCount', room.unread_count
          )
          order by room.unread_count desc, room.ticker asc
        )
        from room_summaries as room
      ),
      '[]'::jsonb
    ),
    'people',
    pg_catalog.coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', people.message_id,
            'ticker', people.ticker,
            'authorDisplayName', people.author_display_name,
            'authorEmoji', people.author_emoji,
            'bodyPreview', people.body_preview,
            'createdAt', people.created_at
          )
          order by people.created_at desc, people.message_id desc
        )
        from limited_people as people
      ),
      '[]'::jsonb
    ),
    'peopleUnreadCount',
    (
      select pg_catalog.count(*)::bigint
      from people_unread_messages
    ),
    'totalUnreadCount',
    (
      select pg_catalog.count(*)::bigint
      from distinct_unread_messages
    )
  )
$$;

revoke all privileges
on function public.set_live_room_member_follow(
  uuid,
  uuid,
  uuid,
  boolean
)
from public, anon, authenticated;

revoke all privileges
on function public.mark_live_room_member_activity_read(
  uuid,
  uuid,
  uuid
)
from public, anon, authenticated;

revoke all privileges
on function public.get_live_room_activity_summary(
  text,
  uuid,
  uuid,
  integer
)
from public, anon, authenticated;

grant execute
on function public.set_live_room_member_follow(
  uuid,
  uuid,
  uuid,
  boolean
)
to service_role;

grant execute
on function public.mark_live_room_member_activity_read(
  uuid,
  uuid,
  uuid
)
to service_role;

grant execute
on function public.get_live_room_activity_summary(
  text,
  uuid,
  uuid,
  integer
)
to service_role;

revoke all privileges
on table public.live_room_member_follows
from public, anon, authenticated;

revoke all privileges
on table public.live_room_member_follows
from service_role;

grant select, insert, update, delete
on table public.live_room_member_follows
to service_role;

comment on column public.live_room_member_follows.last_read_at is
  'Per-follow member activity cursor; unrelated to room unread and paid Alerts.';

comment on function public.get_live_room_activity_summary(
  text,
  uuid,
  uuid,
  integer
) is
  'Service-only bounded Live Room Rooms/People inbox summary with distinct cross-channel unread count.';

commit;
