create or replace function public.get_live_room_member_relationships(
  p_requester_user_id uuid,
  p_filter text default 'following',
  p_after_at timestamptz default null,
  p_after_user_id uuid default null,
  p_limit integer default 30
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_result jsonb;
begin
  if p_requester_user_id is null then
    raise exception 'COMMUNITY_HUB_MEMBER_REQUIRED';
  end if;

  if p_filter not in ('following', 'followers', 'mutual') then
    raise exception 'COMMUNITY_HUB_INVALID_PEOPLE_FILTER';
  end if;

  if (p_after_at is null) <> (p_after_user_id is null) then
    raise exception 'COMMUNITY_HUB_INVALID_CURSOR';
  end if;

  with outbound as (
    select
      follow.followed_user_id as target_user_id,
      follow.created_at as following_at
    from public.live_room_member_follows as follow
    where follow.follower_user_id = p_requester_user_id
  ),
  inbound as (
    select
      follow.follower_user_id as target_user_id,
      follow.created_at as follower_at
    from public.live_room_member_follows as follow
    where follow.followed_user_id = p_requester_user_id
  ),
  relationships as (
    select
      coalesce(outbound.target_user_id, inbound.target_user_id) as target_user_id,
      outbound.following_at,
      inbound.follower_at,
      greatest(outbound.following_at, inbound.follower_at) as relationship_at,
      outbound.target_user_id is not null as is_following,
      inbound.target_user_id is not null as follows_you
    from outbound
    full join inbound using (target_user_id)
  ),
  visible as (
    select relationship.*
    from relationships as relationship
    where not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocked_kind = 'member'
          and (
            (
              block.blocker_member_user_id = p_requester_user_id
              and block.blocked_member_user_id = relationship.target_user_id
            )
            or (
              block.blocker_member_user_id = relationship.target_user_id
              and block.blocked_member_user_id = p_requester_user_id
            )
          )
      )
  ),
  selected as (
    select visible.*
    from visible
    where (p_filter = 'following' and visible.is_following)
      or (p_filter = 'followers' and visible.follows_you)
      or (
        p_filter = 'mutual'
        and visible.is_following
        and visible.follows_you
      )
  ),
  filtered as (
    select selected.*
    from selected
    where p_after_at is null
      or (selected.relationship_at, selected.target_user_id)
        < (p_after_at, p_after_user_id)
  ),
  enriched as (
    select
      filtered.target_user_id,
      filtered.relationship_at,
      filtered.is_following,
      filtered.follows_you,
      profile.public_profile_id,
      profile.display_name,
      profile.emoji,
      latest_message.id as message_id,
      exists (
        select 1
        from public.live_room_social_verifications as verification
        where verification.member_user_id = filtered.target_user_id
          and verification.status = 'verified'
          and verification.show_on_profile = true
          and verification.expires_at is null
      ) as is_verified,
      case greatest(
        case
          when subscription.status = 'active' then
            case subscription.plan
              when 'ultimate' then 4
              when 'advanced' then 3
              when 'pro' then 2
              when 'ad_free' then 1
              else 0
            end
          else 0
        end,
        case
          when subscription.trial_plan in ('pro', 'advanced')
            and subscription.trial_started_at is not null
            and subscription.trial_ends_at is not null
            and subscription.trial_ends_at > now()
          then
            case subscription.trial_plan
              when 'advanced' then 3
              when 'pro' then 2
              else 0
            end
          else 0
        end
      )
        when 4 then 'ultimate'
        when 3 then 'advanced'
        when 2 then 'pro'
        when 1 then 'ad_free'
        else 'free'
      end as plan
    from filtered
    join public.live_room_member_profiles as profile
      on profile.user_id = filtered.target_user_id
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = filtered.target_user_id
    left join lateral (
      select message.id
      from public.live_room_messages as message
      join public.live_room_rooms as room
        on room.id = message.room_id
      where message.author_kind = 'member'
        and message.member_user_id = filtered.target_user_id
        and message.visibility_status = 'visible'
        and room.room_kind = 'company'
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest_message on true
    order by filtered.relationship_at desc, filtered.target_user_id desc
    limit v_limit + 1
  ),
  page as (
    select enriched.*
    from enriched
    order by enriched.relationship_at desc, enriched.target_user_id desc
    limit v_limit
  ),
  counts as (
    select
      count(*) filter (where visible.is_following)::bigint as following_count,
      count(*) filter (where visible.follows_you)::bigint as follower_count,
      count(*) filter (
        where visible.is_following and visible.follows_you
      )::bigint as mutual_count
    from visible
  )
  select jsonb_build_object(
    'items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'targetUserId', page.target_user_id,
              'relationshipAt', page.relationship_at,
              'publicProfileId', page.public_profile_id,
              'messageId', page.message_id,
              'displayName', page.display_name,
              'emoji', page.emoji,
              'plan', page.plan,
              'isVerified', page.is_verified,
              'isFollowing', page.is_following,
              'followsYou', page.follows_you
            )
            order by page.relationship_at desc, page.target_user_id desc
          )
          from page
        ),
        '[]'::jsonb
      ),
    'hasMore', (select count(*) from enriched) > v_limit,
    'followingCount', counts.following_count,
    'followerCount', counts.follower_count,
    'mutualCount', counts.mutual_count
  )
  into v_result
  from counts;

  return coalesce(
    v_result,
    jsonb_build_object(
      'items', '[]'::jsonb,
      'hasMore', false,
      'followingCount', 0,
      'followerCount', 0,
      'mutualCount', 0
    )
  );
end;
$$;

comment on function public.get_live_room_member_relationships(
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) is
  'Service-only paginated Community hub relationship list. Returns opaque public profile IDs and excludes blocked pairs.';

revoke all on function public.get_live_room_member_relationships(
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_live_room_member_relationships(
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) to service_role;

create or replace function public.set_live_room_member_follow_by_profile(
  p_requester_user_id uuid,
  p_public_profile_id uuid,
  p_followed boolean
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_target_user_id uuid;
begin
  if p_requester_user_id is null or p_public_profile_id is null then
    raise exception 'COMMUNITY_HUB_MEMBER_REQUIRED';
  end if;

  if p_followed is null then
    raise exception 'LIVE_ROOM_INVALID_MEMBER_FOLLOW';
  end if;

  select profile.user_id
  into v_target_user_id
  from public.live_room_member_profiles as profile
  where profile.public_profile_id = p_public_profile_id;

  if v_target_user_id is null then
    raise exception 'LIVE_ROOM_MEMBER_TARGET_NOT_FOUND';
  end if;

  if v_target_user_id = p_requester_user_id then
    raise exception 'LIVE_ROOM_CANNOT_FOLLOW_SELF';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where block.blocker_kind = 'member'
      and block.blocked_kind = 'member'
      and (
        (
          block.blocker_member_user_id = p_requester_user_id
          and block.blocked_member_user_id = v_target_user_id
        )
        or (
          block.blocker_member_user_id = v_target_user_id
          and block.blocked_member_user_id = p_requester_user_id
        )
      )
  ) then
    raise exception 'LIVE_ROOM_MEMBER_TARGET_NOT_FOUND';
  end if;

  if not p_followed then
    delete from public.live_room_member_follows as follow
    where follow.follower_user_id = p_requester_user_id
      and follow.followed_user_id = v_target_user_id;
    return false;
  end if;

  if not exists (
    select 1
    from public.live_room_member_follows as follow
    where follow.follower_user_id = v_target_user_id
      and follow.followed_user_id = p_requester_user_id
  ) then
    raise exception 'COMMUNITY_HUB_FOLLOW_BACK_REQUIRED';
  end if;

  insert into public.live_room_member_follows (
    follower_user_id,
    followed_user_id,
    created_at,
    last_read_at,
    last_read_message_id
  )
  values (
    p_requester_user_id,
    v_target_user_id,
    now(),
    now(),
    null
  )
  on conflict (follower_user_id, followed_user_id) do nothing;

  return true;
end;
$$;

comment on function public.set_live_room_member_follow_by_profile(
  uuid,
  uuid,
  boolean
) is
  'Service-only Community hub unfollow/follow-back mutation using an opaque public profile ID.';

revoke all on function public.set_live_room_member_follow_by_profile(
  uuid,
  uuid,
  boolean
) from public, anon, authenticated;
grant execute on function public.set_live_room_member_follow_by_profile(
  uuid,
  uuid,
  boolean
) to service_role;

create or replace function public.get_live_room_followed_rooms(
  p_requester_user_id uuid,
  p_after_at timestamptz default null,
  p_after_room_id uuid default null,
  p_limit integer default 30
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_result jsonb;
begin
  if p_requester_user_id is null then
    raise exception 'COMMUNITY_HUB_MEMBER_REQUIRED';
  end if;

  if (p_after_at is null) <> (p_after_room_id is null) then
    raise exception 'COMMUNITY_HUB_INVALID_CURSOR';
  end if;

  with followed as (
    select
      follow.room_id,
      follow.updated_at,
      follow.notification_scope,
      follow.last_read_at,
      follow.last_read_message_id,
      room.room_kind,
      room.ticker,
      community.slug,
      community.name
    from public.live_room_follows as follow
    join public.live_room_rooms as room
      on room.id = follow.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    where follow.actor_kind = 'member'
      and follow.member_user_id = p_requester_user_id
      and follow.followed = true
      and (
        room.room_kind = 'company'
        or (
          room.room_kind = 'community'
          and community.room_id is not null
        )
      )
  ),
  enriched as (
    select
      followed.*,
      (
        select count(*)::bigint
        from public.live_room_messages as message
        where message.room_id = followed.room_id
          and message.visibility_status = 'visible'
          and message.member_user_id is distinct from p_requester_user_id
          and (
            message.created_at > followed.last_read_at
            or (
              message.created_at = followed.last_read_at
              and followed.last_read_message_id is not null
              and message.id > followed.last_read_message_id
            )
          )
          and not exists (
            select 1
            from public.live_room_actor_blocks as block
            where block.blocker_kind = 'member'
              and block.blocker_member_user_id = p_requester_user_id
              and block.blocked_kind = message.author_kind
              and block.blocked_actor_id = message.actor_id
          )
      ) as unread_count
    from followed
  ),
  filtered as (
    select enriched.*
    from enriched
    where p_after_at is null
      or (enriched.updated_at, enriched.room_id)
        < (p_after_at, p_after_room_id)
    order by enriched.updated_at desc, enriched.room_id desc
    limit v_limit + 1
  ),
  page as (
    select filtered.*
    from filtered
    order by filtered.updated_at desc, filtered.room_id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'roomId', page.room_id,
              'updatedAt', page.updated_at,
              'kind', page.room_kind,
              'ticker', page.ticker,
              'slug', page.slug,
              'label',
                case
                  when page.room_kind = 'company'
                    then page.ticker || ' Live Room'
                  else page.name
                end,
              'notificationScope', page.notification_scope,
              'unreadCount', page.unread_count
            )
            order by page.updated_at desc, page.room_id desc
          )
          from page
        ),
        '[]'::jsonb
      ),
    'hasMore', (select count(*) from filtered) > v_limit,
    'totalUnreadCount',
      coalesce((select sum(enriched.unread_count) from enriched), 0)
  )
  into v_result;

  return coalesce(
    v_result,
    jsonb_build_object(
      'items', '[]'::jsonb,
      'hasMore', false,
      'totalUnreadCount', 0
    )
  );
end;
$$;

comment on function public.get_live_room_followed_rooms(
  uuid,
  timestamptz,
  uuid,
  integer
) is
  'Service-only paginated Community hub list of followed company and community rooms with chat unread counts.';

revoke all on function public.get_live_room_followed_rooms(
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_live_room_followed_rooms(
  uuid,
  timestamptz,
  uuid,
  integer
) to service_role;
