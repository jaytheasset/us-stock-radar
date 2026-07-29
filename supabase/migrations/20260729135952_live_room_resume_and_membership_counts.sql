begin;

create or replace function public.list_live_room_memberships(
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
  public_members as (
    select membership.room_id, membership.member_user_id
    from joined_room_ids as joined_room
    join public.live_room_memberships as membership
      on membership.room_id = joined_room.room_id
    union
    select message.room_id, message.member_user_id
    from joined_room_ids as joined_room
    join public.live_room_messages as message
      on message.room_id = joined_room.room_id
      and message.author_kind = 'member'
      and message.member_user_id is not null
      and message.visibility_status = 'visible'
    union
    select post.room_id, post.author_user_id
    from joined_room_ids as joined_room
    join public.live_room_posts as post
      on post.room_id = joined_room.room_id
      and post.visibility_status = 'visible'
    union
    select post.room_id, comment.author_user_id
    from joined_room_ids as joined_room
    join public.live_room_posts as post
      on post.room_id = joined_room.room_id
      and post.visibility_status = 'visible'
    join public.live_room_post_comments as comment
      on comment.post_id = post.id
      and comment.visibility_status = 'visible'
  ),
  online_members as (
    select presence.room_id, presence.member_user_id
    from joined_room_ids as joined_room
    join public.live_room_member_presence as presence
      on presence.room_id = joined_room.room_id
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
    join public.live_room_member_profiles as profile
      on profile.user_id = presence.member_user_id
      and profile.show_presence = true
  ),
  online_member_visitors as (
    select online.room_id, online.member_user_id
    from online_members as online
    where not exists (
      select 1
      from public_members as participant
      where participant.room_id = online.room_id
        and participant.member_user_id = online.member_user_id
    )
  ),
  online_guests as (
    select presence.room_id, presence.guest_session_id
    from joined_room_ids as joined_room
    join public.live_room_guest_presence as presence
      on presence.room_id = joined_room.room_id
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
    join public.live_room_guest_sessions as session
      on session.id = presence.guest_session_id
      and session.expires_at > pg_catalog.now()
  ),
  public_member_counts as (
    select member.room_id, pg_catalog.count(*)::integer as member_count
    from public_members as member
    group by member.room_id
  ),
  online_member_counts as (
    select member.room_id, pg_catalog.count(*)::integer as online_member_count
    from online_members as member
    group by member.room_id
  ),
  online_member_visitor_counts as (
    select visitor.room_id, pg_catalog.count(*)::integer
      as online_member_visitor_count
    from online_member_visitors as visitor
    group by visitor.room_id
  ),
  online_guest_counts as (
    select guest.room_id, pg_catalog.count(*)::integer as online_guest_count
    from online_guests as guest
    group by guest.room_id
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
      follow.last_read_message_id,
      coalesce(public_member_counts.member_count, 0) as member_count,
      coalesce(online_member_counts.online_member_count, 0)
        as online_member_count,
      coalesce(
        online_member_visitor_counts.online_member_visitor_count,
        0
      ) as online_member_visitor_count,
      coalesce(online_guest_counts.online_guest_count, 0)
        as online_guest_count
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
    left join public_member_counts
      on public_member_counts.room_id = membership.room_id
    left join online_member_counts
      on online_member_counts.room_id = membership.room_id
    left join online_member_visitor_counts
      on online_member_visitor_counts.room_id = membership.room_id
    left join online_guest_counts
      on online_guest_counts.room_id = membership.room_id
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
            'participantCount',
              page.member_count
                + page.online_member_visitor_count
                + page.online_guest_count,
            'onlineCount',
              page.online_member_count + page.online_guest_count,
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
  'Service-only bounded membership list with room-unread cursors and set-based participant/online aggregates matching the room header contract.';

create function public.get_live_room_resume_state(
  p_room_id uuid,
  p_member_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with read_state as (
    select
      follow.last_read_at,
      follow.last_read_message_id
    from public.live_room_memberships as membership
    join public.live_room_follows as follow
      on follow.room_id = membership.room_id
      and follow.actor_kind = 'member'
      and follow.member_user_id = membership.member_user_id
      and follow.followed = true
    where membership.room_id = p_room_id
      and membership.member_user_id = p_member_user_id
  ),
  unread as (
    select message.id, message.created_at
    from read_state as cursor
    join public.live_room_messages as message
      on message.room_id = p_room_id
      and message.visibility_status = 'visible'
      and message.member_user_id is distinct from p_member_user_id
      and (
        message.created_at > cursor.last_read_at
        or (
          message.created_at = cursor.last_read_at
          and cursor.last_read_message_id is not null
          and message.id > cursor.last_read_message_id
        )
      )
    where not exists (
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
  ),
  first_unread as (
    select unread.id, unread.created_at
    from unread
    order by unread.created_at, unread.id
    limit 1
  ),
  context_message as (
    select message.id, message.created_at
    from first_unread
    join public.live_room_messages as message
      on message.room_id = p_room_id
      and message.visibility_status = 'visible'
      and (
        message.created_at < first_unread.created_at
        or (
          message.created_at = first_unread.created_at
          and message.id < first_unread.id
        )
      )
    where not exists (
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
    order by message.created_at desc, message.id desc
    limit 1
  )
  select pg_catalog.jsonb_build_object(
    'joined', exists (select 1 from read_state),
    'unreadCount', (select pg_catalog.count(*) from unread),
    'firstUnreadMessageId', (select first_unread.id from first_unread),
    'startMessageId',
      coalesce(
        (select context_message.id from context_message),
        (select first_unread.id from first_unread)
      ),
    'startCreatedAt',
      coalesce(
        (select context_message.created_at from context_message),
        (select first_unread.created_at from first_unread)
      )
  )
$$;

comment on function public.get_live_room_resume_state(uuid, uuid) is
  'Service-only joined-room resume cursor. Returns one visible context anchor plus the first visible unread message after bilateral block filtering.';

revoke all on function public.list_live_room_memberships(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_live_room_resume_state(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.list_live_room_memberships(uuid, integer)
  to service_role;
grant execute on function public.get_live_room_resume_state(uuid, uuid)
  to service_role;

commit;
