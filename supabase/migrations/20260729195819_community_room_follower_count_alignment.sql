begin;

create or replace function private.get_live_room_member_follower_counts(
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

commit;
