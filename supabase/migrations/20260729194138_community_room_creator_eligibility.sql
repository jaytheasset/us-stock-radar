begin;

alter table public.user_plan_subscriptions
  drop constraint user_plan_subscriptions_trial_plan_check;

alter table public.user_plan_subscriptions
  add constraint user_plan_subscriptions_trial_plan_check
  check (
    trial_plan is null
    or trial_plan in ('pro', 'advanced')
  );

create function private.get_live_room_member_follower_counts(
  p_followed_user_ids uuid[]
)
returns table (
  followed_user_id uuid,
  follower_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_user_id
    from pg_catalog.unnest(
      coalesce(p_followed_user_ids, array[]::uuid[])
    ) as input(requested_user_id)
    where requested_user_id is not null
  )
  select
    follow.followed_user_id,
    pg_catalog.count(distinct follow.follower_user_id)::bigint
      as follower_count
  from public.live_room_member_follows as follow
  join requested
    on requested.requested_user_id = follow.followed_user_id
  join public.user_profiles as follower
    on follower.id = follow.follower_user_id
  where follow.follower_user_id <> follow.followed_user_id
    and not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = 'member'
        and block.blocked_kind = 'member'
        and (
          (
            block.blocker_member_user_id = follow.follower_user_id
            and block.blocked_member_user_id = follow.followed_user_id
          )
          or (
            block.blocker_member_user_id = follow.followed_user_id
            and block.blocked_member_user_id = follow.follower_user_id
          )
        )
    )
  group by follow.followed_user_id
$$;

comment on function private.get_live_room_member_follower_counts(uuid[]) is
  'Canonical bounded follower counts for persisted member relationships. Self, duplicate, deleted-profile, and blocked relationships do not count.';

revoke all on function private.get_live_room_member_follower_counts(uuid[])
  from public, anon, authenticated;
grant execute on function private.get_live_room_member_follower_counts(uuid[])
  to service_role;

create function public.get_live_room_community_creator_eligibility(
  p_owner_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with effective_plan as (
    select case greatest(
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
          and subscription.trial_ends_at > pg_catalog.now()
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
    from (select 1) as seed
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = p_owner_user_id
  ),
  follower_counts as (
    select counts.follower_count
    from private.get_live_room_member_follower_counts(
      array[p_owner_user_id]
    ) as counts
    where counts.followed_user_id = p_owner_user_id
  )
  select pg_catalog.jsonb_build_object(
    'effectivePlan',
      case
        when exists (
          select 1
          from public.user_profiles as profile
          join public.live_room_member_profiles as member_profile
            on member_profile.user_id = profile.id
          where profile.id = p_owner_user_id
        )
        then (select plan from effective_plan)
        else 'free'
      end,
    'followerCount',
      coalesce((select follower_count from follower_counts), 0)
  )
$$;

comment on function public.get_live_room_community_creator_eligibility(
  uuid
) is
  'Service-only creator plan and canonical follower count. Returns no user identifiers or follower list.';

revoke all on function public.get_live_room_community_creator_eligibility(
  uuid
) from public, anon, authenticated;
grant execute on function public.get_live_room_community_creator_eligibility(
  uuid
) to service_role;

create function private.assert_live_room_community_creator_eligibility()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_eligibility jsonb;
  v_plan text;
  v_follower_count bigint;
begin
  v_eligibility :=
    public.get_live_room_community_creator_eligibility(new.owner_user_id);
  v_plan := v_eligibility->>'effectivePlan';
  v_follower_count :=
    coalesce((v_eligibility->>'followerCount')::bigint, 0);

  if v_plan not in ('advanced', 'ultimate') then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_ADVANCED_REQUIRED';
  end if;

  if v_follower_count < 100 then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ROOM_FOLLOWERS_REQUIRED';
  end if;

  return new;
end;
$$;

comment on function private.assert_live_room_community_creator_eligibility()
is
  'Final transactional Advanced-or-Ultimate and 100-active-followers assertion for Community Room inserts.';

create trigger assert_live_room_community_creator_eligibility
before insert on public.live_room_community_rooms
for each row
execute function private.assert_live_room_community_creator_eligibility();

revoke all on function private.assert_live_room_community_creator_eligibility()
  from public, anon, authenticated;
grant execute on function private.assert_live_room_community_creator_eligibility()
  to service_role;

-- Keep public member summaries on the same canonical active-follower count.
create or replace function public.get_live_room_member_summaries(
  p_room_id uuid,
  p_requester_kind text,
  p_requester_member_user_id uuid,
  p_requester_guest_session_id uuid,
  p_public_profile_ids uuid[],
  p_limit integer default 8
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with request_context as (
    select
      least(greatest(coalesce(p_limit, 8), 1), 12) as member_limit
    where p_room_id is not null
      and p_requester_kind in ('member', 'guest')
      and exists (
        select 1
        from public.live_room_rooms as room
        where room.id = p_room_id
          and room.room_kind in ('company', 'community')
      )
      and (
        (
          p_requester_kind = 'member'
          and p_requester_member_user_id is not null
          and p_requester_guest_session_id is null
          and exists (
            select 1
            from public.live_room_member_profiles as requester
            where requester.user_id = p_requester_member_user_id
          )
        )
        or (
          p_requester_kind = 'guest'
          and p_requester_member_user_id is null
          and p_requester_guest_session_id is not null
          and exists (
            select 1
            from public.live_room_guest_sessions as session
            where session.id = p_requester_guest_session_id
              and session.expires_at > pg_catalog.now()
          )
        )
      )
  ),
  requested as (
    select distinct on (input.public_profile_id)
      input.public_profile_id,
      input.ordinality
    from request_context as context
    cross join lateral pg_catalog.unnest(
      (coalesce(p_public_profile_ids, array[]::uuid[]))[
        1:context.member_limit
      ]
    ) with ordinality as input(public_profile_id, ordinality)
    where input.public_profile_id is not null
    order by input.public_profile_id, input.ordinality
  ),
  visible_candidates as (
    select
      requested.ordinality,
      profile.user_id,
      profile.public_profile_id,
      profile.display_name,
      profile.emoji,
      profile.show_presence
    from requested
    join public.live_room_member_profiles as profile
      on profile.public_profile_id = requested.public_profile_id
    where (
        exists (
          select 1
          from public.live_room_messages as message
          where message.room_id = p_room_id
            and message.author_kind = 'member'
            and message.member_user_id = profile.user_id
            and message.visibility_status = 'visible'
        )
        or exists (
          select 1
          from public.live_room_posts as post
          where post.room_id = p_room_id
            and post.author_user_id = profile.user_id
            and post.visibility_status = 'visible'
        )
      )
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where (
            p_requester_kind = 'member'
            and block.blocker_kind = 'member'
            and block.blocked_kind = 'member'
            and (
              (
                block.blocker_member_user_id
                  = p_requester_member_user_id
                and block.blocked_member_user_id = profile.user_id
              )
              or (
                block.blocker_member_user_id = profile.user_id
                and block.blocked_member_user_id
                  = p_requester_member_user_id
              )
            )
          )
          or (
            p_requester_kind = 'guest'
            and (
              (
                block.blocker_kind = 'guest'
                and block.blocker_guest_session_id
                  = p_requester_guest_session_id
                and block.blocked_kind = 'member'
                and block.blocked_member_user_id = profile.user_id
              )
              or (
                block.blocker_kind = 'member'
                and block.blocker_member_user_id = profile.user_id
                and block.blocked_kind = 'guest'
                and block.blocked_guest_session_id
                  = p_requester_guest_session_id
              )
            )
          )
      )
  ),
  follower_counts as (
    select
      counts.followed_user_id as user_id,
      counts.follower_count
    from private.get_live_room_member_follower_counts(
      array(
        select candidate.user_id
        from visible_candidates as candidate
      )
    ) as counts
  ),
  post_stats as (
    select
      post.author_user_id as user_id,
      pg_catalog.count(*)::bigint as post_count,
      coalesce(pg_catalog.sum(post.like_count), 0)::bigint
        as received_like_count
    from public.live_room_posts as post
    join visible_candidates as candidate
      on candidate.user_id = post.author_user_id
    where post.visibility_status = 'visible'
    group by post.author_user_id
  ),
  verification_badges as (
    select
      verification.member_user_id as user_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'platform', verification.platform,
          'label',
            case verification.platform
              when 'x' then 'Verified X'
              when 'youtube' then 'Verified YouTube'
              when 'instagram' then 'Verified Instagram'
            end,
          'profileUrl', verification.profile_url
        )
        order by verification.platform
      ) as badges
    from public.live_room_social_verifications as verification
    join visible_candidates as candidate
      on candidate.user_id = verification.member_user_id
    where verification.status = 'verified'
      and verification.show_on_profile = true
      and verification.expires_at is null
    group by verification.member_user_id
  ),
  enriched as (
    select
      candidate.ordinality,
      candidate.public_profile_id,
      candidate.display_name,
      candidate.emoji,
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
            and subscription.trial_ends_at > pg_catalog.now()
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
      end as plan,
      coalesce(followers.follower_count, 0) as follower_count,
      coalesce(posts.post_count, 0) as post_count,
      coalesce(posts.received_like_count, 0) as received_like_count,
      coalesce(verifications.badges, '[]'::jsonb) as social_badges,
      candidate.show_presence
        and presence.member_user_id is not null as is_online
    from visible_candidates as candidate
    left join public.user_plan_subscriptions as subscription
      on subscription.user_id = candidate.user_id
    left join follower_counts as followers
      on followers.user_id = candidate.user_id
    left join post_stats as posts
      on posts.user_id = candidate.user_id
    left join verification_badges as verifications
      on verifications.user_id = candidate.user_id
    left join public.live_room_member_presence as presence
      on presence.member_user_id = candidate.user_id
      and presence.room_id = p_room_id
      and presence.last_seen_at
        >= pg_catalog.now() - interval '2 minutes'
  )
  select pg_catalog.jsonb_build_object(
    'items',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'publicProfileId', member.public_profile_id,
            'displayName', member.display_name,
            'emoji', member.emoji,
            'plan', member.plan,
            'socialBadges', member.social_badges,
            'isOnline', member.is_online,
            'followerCount', member.follower_count,
            'postCount', member.post_count,
            'receivedLikeCount', member.received_like_count
          )
          order by member.ordinality
        )
        from enriched as member
      ),
      '[]'::jsonb
    )
  )
$$;

comment on function public.get_live_room_member_summaries(
  uuid,
  text,
  uuid,
  uuid,
  uuid[],
  integer
) is
  'Service-only bounded bulk public member summaries for visible authors in a Live Room. Returns opaque profile IDs and excludes blocked pairs.';

revoke all on function public.get_live_room_member_summaries(
  uuid,
  text,
  uuid,
  uuid,
  uuid[],
  integer
) from public, anon, authenticated;

grant execute on function public.get_live_room_member_summaries(
  uuid,
  text,
  uuid,
  uuid,
  uuid[],
  integer
) to service_role;


commit;
