begin;

create table public.live_room_memberships (
  room_id uuid not null
    references public.live_room_rooms(id) on delete cascade,
  member_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (room_id, member_user_id)
);

comment on table public.live_room_memberships is
  'Canonical service-only room membership. A row remains until explicit Leave room; presence is stored separately.';

create index live_room_memberships_member_joined_idx
  on public.live_room_memberships (
    member_user_id,
    joined_at desc,
    room_id
  );

alter table public.live_room_memberships enable row level security;

revoke all on table public.live_room_memberships
  from public, anon, authenticated;
grant select, insert, delete
  on table public.live_room_memberships
  to service_role;

-- Existing saved-room state becomes the initial canonical membership set.
insert into public.live_room_memberships (
  room_id,
  member_user_id,
  joined_at
)
select
  follow.room_id,
  follow.member_user_id,
  follow.created_at
from public.live_room_follows as follow
where follow.actor_kind = 'member'
  and follow.member_user_id is not null
  and follow.followed = true
on conflict (room_id, member_user_id) do nothing;

-- Presence remains one current room per member, but room_id permits both
-- company and Community Rooms. ticker remains populated for company wrappers.
alter table public.live_room_member_presence
  add column room_id uuid;

update public.live_room_member_presence as presence
set room_id = room.id
from public.live_room_rooms as room
where room.room_kind = 'company'
  and room.ticker = presence.ticker;

delete from public.live_room_member_presence
where room_id is null;

alter table public.live_room_member_presence
  alter column room_id set not null,
  alter column ticker drop not null,
  add constraint live_room_member_presence_room_id_fkey
    foreign key (room_id)
    references public.live_room_rooms(id)
    on delete cascade;

create index live_room_member_presence_room_seen_idx
  on public.live_room_member_presence (room_id, last_seen_at desc);

comment on table public.live_room_guest_presence is
  'Service-only ephemeral room presence for opaque guest sessions. Guests are visitors, never members; public APIs expose aggregate counts only.';

create function private.ensure_live_room_membership(
  p_room_id uuid,
  p_member_user_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_latest_message_at timestamptz;
  v_latest_message_id uuid;
begin
  if p_room_id is null or p_member_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.live_room_rooms as room
    where room.id = p_room_id
  ) or not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = p_member_user_id
  ) then
    raise exception 'LIVE_ROOM_MEMBERSHIP_UNAVAILABLE';
  end if;

  insert into public.live_room_memberships (
    room_id,
    member_user_id,
    joined_at
  )
  values (
    p_room_id,
    p_member_user_id,
    pg_catalog.now()
  )
  on conflict (room_id, member_user_id) do nothing;

  select message.created_at, message.id
  into v_latest_message_at, v_latest_message_id
  from public.live_room_messages as message
  where message.room_id = p_room_id
    and message.visibility_status = 'visible'
  order by message.created_at desc, message.id desc
  limit 1;

  insert into public.live_room_follows as existing (
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
    'member',
    p_member_user_id,
    null,
    true,
    'new_chat_messages',
    coalesce(v_latest_message_at, pg_catalog.now()),
    v_latest_message_id
  )
  on conflict (room_id, actor_kind, actor_id)
  do update set
    followed = true,
    notification_scope = 'new_chat_messages',
    updated_at = pg_catalog.now(),
    last_read_at = case
      when existing.followed then existing.last_read_at
      else excluded.last_read_at
    end,
    last_read_message_id = case
      when existing.followed then existing.last_read_message_id
      else excluded.last_read_message_id
    end;

  return true;
end;
$$;

comment on function private.ensure_live_room_membership(uuid, uuid) is
  'Internal idempotent membership and room-unread activation used by Join and successful contributions.';

create function private.join_live_room_after_message()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.author_kind = 'member'
    and new.member_user_id is not null
  then
    perform private.ensure_live_room_membership(
      new.room_id,
      new.member_user_id
    );
  end if;
  return new;
end;
$$;

create function private.join_live_room_after_post()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_live_room_membership(
    new.room_id,
    new.author_user_id
  );
  return new;
end;
$$;

create function private.join_live_room_after_comment()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select post.room_id
  into v_room_id
  from public.live_room_posts as post
  where post.id = new.post_id;

  if v_room_id is null then
    raise exception 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  perform private.ensure_live_room_membership(
    v_room_id,
    new.author_user_id
  );
  return new;
end;
$$;

create trigger live_room_messages_join_room
after insert on public.live_room_messages
for each row execute function private.join_live_room_after_message();

create trigger live_room_posts_join_room
after insert on public.live_room_posts
for each row execute function private.join_live_room_after_post();

create trigger live_room_post_comments_join_room
after insert on public.live_room_post_comments
for each row execute function private.join_live_room_after_comment();

create function public.set_live_room_membership(
  p_room_id uuid,
  p_member_user_id uuid,
  p_joined boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_room_id is null
    or p_member_user_id is null
    or p_joined is null
  then
    raise exception 'LIVE_ROOM_INVALID_MEMBERSHIP';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_room_id::text || ':' || p_member_user_id::text,
      0
    )
  );

  if p_joined then
    return private.ensure_live_room_membership(
      p_room_id,
      p_member_user_id
    );
  end if;

  delete from public.live_room_memberships as membership
  where membership.room_id = p_room_id
    and membership.member_user_id = p_member_user_id;

  delete from public.live_room_follows as follow
  where follow.room_id = p_room_id
    and follow.actor_kind = 'member'
    and follow.member_user_id = p_member_user_id;

  return false;
end;
$$;

comment on function public.set_live_room_membership(uuid, uuid, boolean) is
  'Service-only canonical Join/Leave mutation. Leave also stops internal room unread tracking.';

create function public.set_live_room_room_presence_heartbeat(
  p_member_user_id uuid,
  p_room_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_show_presence boolean;
  v_ticker text;
begin
  if p_member_user_id is null or p_room_id is null then
    raise exception 'LIVE_ROOM_MEMBER_REQUIRED';
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

  select room.ticker
  into v_ticker
  from public.live_room_rooms as room
  where room.id = p_room_id
    and room.room_kind in ('company', 'community');

  if not found then
    raise exception 'LIVE_ROOM_ROOM_NOT_FOUND';
  end if;

  insert into public.live_room_member_presence (
    member_user_id,
    ticker,
    room_id,
    last_seen_at,
    updated_at
  )
  values (
    p_member_user_id,
    v_ticker,
    p_room_id,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (member_user_id) do update
  set
    ticker = excluded.ticker,
    room_id = excluded.room_id,
    last_seen_at = pg_catalog.now(),
    updated_at = pg_catalog.now();

  return true;
end;
$$;

create function public.set_live_room_guest_presence_for_room(
  p_guest_session_id uuid,
  p_room_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_guest_session_id is null or p_room_id is null then
    raise exception 'LIVE_ROOM_GUEST_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.live_room_guest_sessions as session
    where session.id = p_guest_session_id
      and session.expires_at > pg_catalog.now()
  ) or not exists (
    select 1
    from public.live_room_rooms as room
    where room.id = p_room_id
  ) then
    raise exception 'LIVE_ROOM_GUEST_SESSION_EXPIRED';
  end if;

  insert into public.live_room_guest_presence (
    guest_session_id,
    room_id,
    last_seen_at
  )
  values (
    p_guest_session_id,
    p_room_id,
    pg_catalog.now()
  )
  on conflict (guest_session_id) do update
  set
    room_id = excluded.room_id,
    last_seen_at = pg_catalog.now()
  where public.live_room_guest_presence.room_id
      is distinct from excluded.room_id
    or public.live_room_guest_presence.last_seen_at
      <= pg_catalog.now() - interval '30 seconds';

  return true;
end;
$$;

create function public.get_live_room_presence_summary_for_room(
  p_member_user_id uuid,
  p_room_id uuid,
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
    select greatest(
      1,
      least(coalesce(p_message_limit, 50), 50)
    ) as message_limit
    where p_member_user_id is not null
      and p_room_id is not null
      and exists (
        select 1
        from public.live_room_member_profiles as profile
        where profile.user_id = p_member_user_id
      )
  ),
  requested as (
    select input.message_id, input.ordinality
    from request_context as context
    cross join lateral pg_catalog.unnest(
      p_message_ids[1:context.message_limit]
    ) with ordinality as input(message_id, ordinality)
  ),
  messages as (
    select
      requested.message_id,
      requested.ordinality,
      message.member_user_id
    from requested
    join public.live_room_messages as message
      on message.id = requested.message_id
      and message.room_id = p_room_id
      and message.author_kind = 'member'
      and message.visibility_status = 'visible'
  )
  select pg_catalog.jsonb_build_object(
    'messages',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'messageId', message.message_id,
            'isOnline',
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
                      and block.blocked_member_user_id
                        = message.member_user_id
                    )
                    or (
                      block.blocker_member_user_id
                        = message.member_user_id
                      and block.blocked_member_user_id
                        = p_member_user_id
                    )
                  )
              )
          )
          order by message.ordinality
        )
        from messages as message
        join public.live_room_member_profiles as profile
          on profile.user_id = message.member_user_id
        left join public.live_room_member_presence as presence
          on presence.member_user_id = message.member_user_id
          and presence.room_id = p_room_id
          and presence.last_seen_at
            >= pg_catalog.now() - interval '2 minutes'
      ),
      '[]'::jsonb
    )
  )
$$;

create function public.get_live_room_room_state(
  p_room_id uuid,
  p_member_user_id uuid default null
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
    where room.id = p_room_id
  ),
  public_members as (
    select membership.member_user_id
    from room_context as room
    join public.live_room_memberships as membership
      on membership.room_id = room.id
    union
    select message.member_user_id
    from room_context as room
    join public.live_room_messages as message
      on message.room_id = room.id
      and message.author_kind = 'member'
      and message.member_user_id is not null
      and message.visibility_status = 'visible'
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
      on presence.room_id = room.id
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
    join public.live_room_member_profiles as profile
      on profile.user_id = presence.member_user_id
      and profile.show_presence = true
  ),
  online_member_visitors as (
    select member.member_user_id
    from online_members as member
    where not exists (
      select 1
      from public_members as participant
      where participant.member_user_id = member.member_user_id
    )
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
      (select pg_catalog.count(*)::integer from public_members)
        as member_count,
      (select pg_catalog.count(*)::integer from online_members)
        as online_member_count,
      (select pg_catalog.count(*)::integer from online_member_visitors)
        as online_member_visitor_count,
      (select pg_catalog.count(*)::integer from online_guests)
        as online_guest_count
  )
  select pg_catalog.jsonb_build_object(
    'joined',
    p_member_user_id is not null
      and exists (
        select 1
        from public.live_room_memberships as membership
        where membership.room_id = p_room_id
          and membership.member_user_id = p_member_user_id
      ),
    'memberCount',
    count.member_count,
    'visitorCount',
    count.online_member_visitor_count + count.online_guest_count,
    'participantCount',
    count.member_count
      + count.online_member_visitor_count
      + count.online_guest_count,
    'onlineCount',
    count.online_member_count + count.online_guest_count
  )
  from counts as count
$$;

comment on function public.get_live_room_room_state(uuid, uuid) is
  'Service-only aggregate room state. memberCount deduplicates memberships and visible authenticated contributors. visitorCount is current opt-in authenticated nonmembers plus opaque guests.';

create function public.list_live_room_memberships(
  p_member_user_id uuid,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with request_context as (
    select least(greatest(coalesce(p_limit, 20), 1), 100) as item_limit
    where p_member_user_id is not null
      and exists (
        select 1
        from public.live_room_member_profiles as profile
        where profile.user_id = p_member_user_id
      )
  ),
  joined_room_ids as (
    select membership.room_id, membership.joined_at
    from request_context as context
    join public.live_room_memberships as membership
      on membership.member_user_id = p_member_user_id
  ),
  activity as (
    select message.room_id, message.created_at
    from joined_room_ids as joined_room
    join public.live_room_messages as message
      on message.room_id = joined_room.room_id
    where message.visibility_status = 'visible'
    union all
    select post.room_id, post.created_at
    from joined_room_ids as joined_room
    join public.live_room_posts as post
      on post.room_id = joined_room.room_id
    where post.visibility_status = 'visible'
    union all
    select post.room_id, comment.created_at
    from joined_room_ids as joined_room
    join public.live_room_posts as post
      on post.room_id = joined_room.room_id
      and post.visibility_status = 'visible'
    join public.live_room_post_comments as comment
      on comment.post_id = post.id
      and comment.visibility_status = 'visible'
  ),
  room_activity as (
    select activity.room_id, pg_catalog.max(activity.created_at) as active_at
    from activity
    group by activity.room_id
  ),
  joined as (
    select
      membership.room_id,
      membership.joined_at,
      room.room_kind,
      room.ticker,
      community.slug,
      community.name,
      greatest(
        membership.joined_at,
        coalesce(room_activity.active_at, membership.joined_at),
        coalesce(community.last_activity_at, membership.joined_at)
      ) as recent_activity_at,
      follow.last_read_at,
      follow.last_read_message_id
    from joined_room_ids as membership
    join public.live_room_rooms as room
      on room.id = membership.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    left join room_activity
      on room_activity.room_id = room.id
    left join public.live_room_follows as follow
      on follow.room_id = membership.room_id
      and follow.actor_kind = 'member'
      and follow.member_user_id = p_member_user_id
      and follow.followed = true
    where room.room_kind = 'company'
      or (
        room.room_kind = 'community'
        and community.room_id is not null
      )
  ),
  enriched as (
    select
      joined.*,
      (
        select pg_catalog.count(*)::integer
        from public.live_room_messages as message
        where joined.last_read_at is not null
          and message.room_id = joined.room_id
          and message.visibility_status = 'visible'
          and message.member_user_id is distinct from p_member_user_id
          and (
            message.created_at > joined.last_read_at
            or (
              message.created_at = joined.last_read_at
              and joined.last_read_message_id is not null
              and message.id > joined.last_read_message_id
            )
          )
          and not exists (
            select 1
            from public.live_room_actor_blocks as block
            where (
              block.blocker_kind = 'member'
              and block.blocker_member_user_id = p_member_user_id
              and block.blocked_kind = message.author_kind
              and block.blocked_actor_id = message.actor_id
            )
            or (
              block.blocker_kind = message.author_kind
              and block.blocker_actor_id = message.actor_id
              and block.blocked_kind = 'member'
              and block.blocked_member_user_id = p_member_user_id
            )
          )
      ) as unread_count
    from joined
  ),
  bounded as (
    select enriched.*
    from enriched
    order by enriched.recent_activity_at desc, enriched.room_id desc
    limit (select context.item_limit + 1 from request_context as context)
  ),
  page as (
    select bounded.*
    from bounded
    order by bounded.recent_activity_at desc, bounded.room_id desc
    limit (select context.item_limit from request_context as context)
  )
  select pg_catalog.jsonb_build_object(
    'items',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'kind', page.room_kind,
            'label',
              case
                when page.room_kind = 'company'
                  then page.ticker || ' Live Room'
                else page.name
              end,
            'href',
              case
                when page.room_kind = 'company'
                  then '/live/' || page.ticker
                else '/live/community/' || page.slug
              end,
            'ticker', page.ticker,
            'joinedAt', page.joined_at,
            'recentActivityAt', page.recent_activity_at,
            'unreadCount', page.unread_count
          )
          order by page.recent_activity_at desc, page.room_id desc
        )
        from page
      ),
      '[]'::jsonb
    ),
    'hasMore',
    (select pg_catalog.count(*) from bounded)
      > (select context.item_limit from request_context as context)
  )
$$;

comment on function public.list_live_room_memberships(uuid, integer) is
  'Service-only bounded membership list with public room labels and existing room-unread cursors. Membership, not follow rows, determines inclusion.';

-- Keep legacy company presence callers compatible while routing through the
-- common room-aware contract.
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
  v_room_id uuid;
begin
  select room.id
  into v_room_id
  from public.live_room_rooms as room
  where room.room_kind = 'company'
    and room.ticker = p_ticker;

  if v_room_id is null then
    raise exception 'LIVE_ROOM_ROOM_NOT_FOUND';
  end if;

  return public.set_live_room_room_presence_heartbeat(
    p_member_user_id,
    v_room_id
  );
end;
$$;

create or replace function public.set_live_room_guest_presence_heartbeat(
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
  select room.id
  into v_room_id
  from public.live_room_rooms as room
  where room.room_kind = 'company'
    and room.ticker = p_ticker;

  if v_room_id is null then
    raise exception 'LIVE_ROOM_ROOM_NOT_FOUND';
  end if;

  return public.set_live_room_guest_presence_for_room(
    p_guest_session_id,
    v_room_id
  );
end;
$$;

create or replace function public.get_live_room_public_counts(
  p_ticker text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.get_live_room_room_state(room.id, null)
  from public.live_room_rooms as room
  where room.room_kind = 'company'
    and room.ticker = p_ticker
$$;

revoke all on function private.ensure_live_room_membership(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.join_live_room_after_message()
  from public, anon, authenticated;
revoke all on function private.join_live_room_after_post()
  from public, anon, authenticated;
revoke all on function private.join_live_room_after_comment()
  from public, anon, authenticated;
revoke all on function public.set_live_room_membership(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_live_room_room_presence_heartbeat(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_live_room_guest_presence_for_room(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_live_room_presence_summary_for_room(
  uuid,
  uuid,
  uuid[],
  integer
) from public, anon, authenticated;
revoke all on function public.get_live_room_room_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_live_room_memberships(uuid, integer)
  from public, anon, authenticated;

grant execute on function private.ensure_live_room_membership(uuid, uuid)
  to service_role;
grant execute on function private.join_live_room_after_message()
  to service_role;
grant execute on function private.join_live_room_after_post()
  to service_role;
grant execute on function private.join_live_room_after_comment()
  to service_role;
grant execute on function public.set_live_room_membership(uuid, uuid, boolean)
  to service_role;
grant execute on function public.set_live_room_room_presence_heartbeat(
  uuid,
  uuid
) to service_role;
grant execute on function public.set_live_room_guest_presence_for_room(
  uuid,
  uuid
) to service_role;
grant execute on function public.get_live_room_presence_summary_for_room(
  uuid,
  uuid,
  uuid[],
  integer
) to service_role;
grant execute on function public.get_live_room_room_state(uuid, uuid)
  to service_role;
grant execute on function public.list_live_room_memberships(uuid, integer)
  to service_role;

commit;
