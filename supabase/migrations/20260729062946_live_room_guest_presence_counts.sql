begin;

-- Anonymous presence is ephemeral and aggregate-only. One server-issued
-- opaque guest session can occupy one company room at a time, bounding this
-- table to at most one row per guest session. Browser cookie tokens and hashes
-- never enter this table or any public response.
create table public.live_room_guest_presence (
  guest_session_id uuid primary key
    references public.live_room_guest_sessions(id) on delete cascade,
  room_id uuid not null
    references public.live_room_rooms(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

comment on table public.live_room_guest_presence is
  'Service-only ephemeral company-room presence for opaque guest sessions. Public APIs expose aggregate counts only.';

create index live_room_guest_presence_room_seen_idx
  on public.live_room_guest_presence (room_id, last_seen_at desc);

-- These partial indexes support distinct visible public-author aggregation
-- without scanning unrelated moderation history.
create index live_room_messages_room_member_participant_idx
  on public.live_room_messages (room_id, member_user_id)
  where author_kind = 'member'
    and visibility_status = 'visible'
    and member_user_id is not null;

create index live_room_posts_room_author_participant_idx
  on public.live_room_posts (room_id, author_user_id)
  where visibility_status = 'visible';

create index live_room_post_comments_post_author_participant_idx
  on public.live_room_post_comments (post_id, author_user_id)
  where visibility_status = 'visible';

alter table public.live_room_guest_presence enable row level security;

revoke all on table public.live_room_guest_presence
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.live_room_guest_presence
  to service_role;

create function public.set_live_room_guest_presence_heartbeat(
  p_guest_session_id uuid,
  p_ticker text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  if p_guest_session_id is null then
    raise exception 'LIVE_ROOM_GUEST_REQUIRED';
  end if;

  if p_ticker is null
    or p_ticker <> pg_catalog.upper(pg_catalog.btrim(p_ticker))
    or p_ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
  then
    raise exception 'LIVE_ROOM_PRESENCE_INVALID_TICKER';
  end if;

  if not exists (
    select 1
    from public.live_room_guest_sessions as session
    where session.id = p_guest_session_id
      and session.expires_at > pg_catalog.now()
  ) then
    raise exception 'LIVE_ROOM_GUEST_SESSION_EXPIRED';
  end if;

  select room.id
  into v_room_id
  from public.live_room_rooms as room
  where room.room_kind = 'company'
    and room.ticker = p_ticker;

  if v_room_id is null then
    raise exception 'LIVE_ROOM_ROOM_NOT_FOUND';
  end if;

  insert into public.live_room_guest_presence (
    guest_session_id,
    room_id,
    last_seen_at
  )
  values (
    p_guest_session_id,
    v_room_id,
    pg_catalog.now()
  )
  on conflict (guest_session_id) do update
  set
    room_id = excluded.room_id,
    last_seen_at = pg_catalog.now()
  where public.live_room_guest_presence.room_id is distinct from excluded.room_id
    or public.live_room_guest_presence.last_seen_at
      <= pg_catalog.now() - interval '30 seconds';

  return true;
end;
$$;

comment on function public.set_live_room_guest_presence_heartbeat(uuid, text)
  is 'Service-only bounded guest heartbeat. Same-room writes are throttled to once per 30 seconds.';

create function public.get_live_room_public_counts(
  p_ticker text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with room_context as (
    select room.id
    from public.live_room_rooms as room
    where p_ticker is not null
      and p_ticker = pg_catalog.upper(pg_catalog.btrim(p_ticker))
      and p_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,9}$'
      and room.room_kind = 'company'
      and room.ticker = p_ticker
  ),
  public_member_authors as (
    select message.member_user_id
    from room_context as room
    join public.live_room_messages as message
      on message.room_id = room.id
      and message.author_kind = 'member'
      and message.visibility_status = 'visible'
      and message.member_user_id is not null
    union
    select post.author_user_id
    from room_context as room
    join public.live_room_posts as post
      on post.room_id = room.id
      and post.visibility_status = 'visible'
    union
    select comment.author_user_id
    from room_context as room
    join public.live_room_posts as post
      on post.room_id = room.id
      and post.visibility_status = 'visible'
    join public.live_room_post_comments as comment
      on comment.post_id = post.id
      and comment.visibility_status = 'visible'
  ),
  online_members as (
    select presence.member_user_id
    from room_context as room
    join public.live_room_member_presence as presence
      on presence.ticker = p_ticker
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
    join public.live_room_member_profiles as profile
      on profile.user_id = presence.member_user_id
      and profile.show_presence = true
    group by presence.member_user_id
  ),
  display_members as (
    select author.member_user_id
    from public_member_authors as author
    union
    select online.member_user_id
    from online_members as online
  ),
  online_guests as (
    select presence.guest_session_id
    from room_context as room
    join public.live_room_guest_presence as presence
      on presence.room_id = room.id
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
    join public.live_room_guest_sessions as session
      on session.id = presence.guest_session_id
      and session.expires_at > pg_catalog.now()
  ),
  counts as (
    select
      (
        select pg_catalog.count(*)::integer
        from display_members
      ) as display_member_count,
      (
        select pg_catalog.count(*)::integer
        from online_members
      ) as online_member_count,
      (
        select pg_catalog.count(*)::integer
        from online_guests
      ) as online_guest_count
  )
  select pg_catalog.jsonb_build_object(
    'participantCount',
    count.display_member_count + count.online_guest_count,
    'onlineCount',
    count.online_member_count + count.online_guest_count
  )
  from counts as count
$$;

comment on function public.get_live_room_public_counts(text)
  is 'Service-only aggregate company-room counts. Participants are distinct visible member authors plus current opt-in/guest visitors; online is current opt-in members plus guests. No identities are returned.';

revoke execute on function public.set_live_room_guest_presence_heartbeat(
  uuid,
  text
) from public, anon, authenticated;
revoke execute on function public.get_live_room_public_counts(text)
  from public, anon, authenticated;

grant execute on function public.set_live_room_guest_presence_heartbeat(
  uuid,
  text
) to service_role;
grant execute on function public.get_live_room_public_counts(text)
  to service_role;

commit;
