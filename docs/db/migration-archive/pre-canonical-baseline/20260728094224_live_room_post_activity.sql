begin;

-- Community activity is intentionally separate from paid market Alerts and
-- from the chat-specific Rooms/People unread cursors.
create table public.live_room_post_activity (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  actor_user_id uuid
    references public.user_profiles(id) on delete set null,
  activity_kind text not null
    check (
      activity_kind in (
        'post_comment',
        'comment_reply',
        'followed_member_post',
        'followed_room_post'
      )
    ),
  source_id uuid not null,
  post_id uuid not null
    references public.live_room_posts(id) on delete cascade,
  comment_id uuid
    references public.live_room_post_comments(id) on delete cascade,
  room_id uuid not null
    references public.live_room_rooms(id) on delete restrict,
  read_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (
    (
      activity_kind in ('post_comment', 'comment_reply')
      and comment_id is not null
      and source_id = comment_id
    )
    or
    (
      activity_kind in ('followed_member_post', 'followed_room_post')
      and comment_id is null
      and source_id = post_id
    )
  ),
  check (recipient_user_id is distinct from actor_user_id),
  unique (recipient_user_id, source_id)
);

create index live_room_post_activity_recipient_created_idx
  on public.live_room_post_activity (
    recipient_user_id,
    created_at desc,
    id desc
  );

create index live_room_post_activity_recipient_unread_idx
  on public.live_room_post_activity (
    recipient_user_id,
    created_at desc,
    id desc
  )
  where read_at is null;

create index live_room_post_activity_post_idx
  on public.live_room_post_activity (post_id);

create index live_room_post_activity_comment_idx
  on public.live_room_post_activity (comment_id)
  where comment_id is not null;

alter table public.live_room_post_activity enable row level security;

revoke all privileges
on table public.live_room_post_activity
from public, anon, authenticated;

grant select, insert, update, delete
on table public.live_room_post_activity
to service_role;

create function private.enqueue_live_room_post_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.visibility_status <> 'visible' then
    return new;
  end if;

  with candidates as (
    select
      follow.follower_user_id as recipient_user_id,
      'followed_member_post'::text as activity_kind,
      1 as priority
    from public.live_room_member_follows as follow
    where follow.followed_user_id = new.author_user_id
      and follow.follower_user_id <> new.author_user_id

    union all

    select
      follow.member_user_id as recipient_user_id,
      'followed_room_post'::text as activity_kind,
      2 as priority
    from public.live_room_follows as follow
    where follow.room_id = new.room_id
      and follow.actor_kind = 'member'
      and follow.member_user_id is not null
      and follow.followed = true
      and follow.member_user_id <> new.author_user_id
  ),
  eligible as (
    select distinct on (candidate.recipient_user_id)
      candidate.recipient_user_id,
      candidate.activity_kind
    from candidates as candidate
    where not exists (
      select 1
      from public.live_room_actor_blocks as block
      where block.blocker_kind = 'member'
        and block.blocked_kind = 'member'
        and (
          (
            block.blocker_member_user_id = candidate.recipient_user_id
            and block.blocked_member_user_id = new.author_user_id
          )
          or
          (
            block.blocker_member_user_id = new.author_user_id
            and block.blocked_member_user_id = candidate.recipient_user_id
          )
        )
    )
    order by candidate.recipient_user_id, candidate.priority
  )
  insert into public.live_room_post_activity (
    recipient_user_id,
    actor_user_id,
    activity_kind,
    source_id,
    post_id,
    room_id
  )
  select
    eligible.recipient_user_id,
    new.author_user_id,
    eligible.activity_kind,
    new.id,
    new.id,
    new.room_id
  from eligible
  on conflict (recipient_user_id, source_id) do nothing;

  return new;
end
$$;

create function private.enqueue_live_room_comment_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post public.live_room_posts;
  v_parent_author_user_id uuid;
begin
  if new.visibility_status <> 'visible' then
    return new;
  end if;

  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = new.post_id
    and post.visibility_status = 'visible';

  if v_post.id is null then
    return new;
  end if;

  if new.parent_comment_id is not null then
    select comment.author_user_id
    into v_parent_author_user_id
    from public.live_room_post_comments as comment
    where comment.id = new.parent_comment_id
      and comment.visibility_status = 'visible';

    if v_parent_author_user_id is distinct from new.author_user_id then
      insert into public.live_room_post_activity (
        recipient_user_id,
        actor_user_id,
        activity_kind,
        source_id,
        post_id,
        comment_id,
        room_id
      )
      values (
        v_parent_author_user_id,
        new.author_user_id,
        'comment_reply',
        new.id,
        new.post_id,
        new.id,
        v_post.room_id
      )
      on conflict (recipient_user_id, source_id) do nothing;
    end if;
  end if;

  if v_post.author_user_id is distinct from new.author_user_id
    and (
      v_parent_author_user_id is null
      or v_post.author_user_id is distinct from v_parent_author_user_id
    )
  then
    insert into public.live_room_post_activity (
      recipient_user_id,
      actor_user_id,
      activity_kind,
      source_id,
      post_id,
      comment_id,
      room_id
    )
    values (
      v_post.author_user_id,
      new.author_user_id,
      'post_comment',
      new.id,
      new.post_id,
      new.id,
      v_post.room_id
    )
    on conflict (recipient_user_id, source_id) do nothing;
  end if;

  return new;
end
$$;

create trigger live_room_posts_enqueue_activity
after insert on public.live_room_posts
for each row execute function private.enqueue_live_room_post_activity();

create trigger live_room_post_comments_enqueue_activity
after insert on public.live_room_post_comments
for each row execute function private.enqueue_live_room_comment_activity();

create function public.get_live_room_post_activity_summary(
  p_recipient_user_id uuid,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with visible_activity as (
    select
      activity.id,
      activity.activity_kind,
      activity.post_id,
      activity.comment_id,
      activity.created_at,
      activity.read_at,
      post.title as post_title,
      pg_catalog.left(
        pg_catalog.regexp_replace(
          coalesce(comment.body, post.body),
          '[[:space:]]+',
          ' ',
          'g'
        ),
        160
      ) as body_preview,
      coalesce(profile.display_name, 'Member') as actor_display_name,
      coalesce(profile.emoji, pg_catalog.chr(128100)) as actor_emoji,
      room.room_kind,
      room.ticker,
      community.slug as community_slug,
      community.name as community_name
    from public.live_room_post_activity as activity
    join public.live_room_posts as post
      on post.id = activity.post_id
      and post.visibility_status = 'visible'
    left join public.live_room_post_comments as comment
      on comment.id = activity.comment_id
      and comment.visibility_status = 'visible'
    left join public.live_room_member_profiles as profile
      on profile.user_id = activity.actor_user_id
    join public.live_room_rooms as room
      on room.id = activity.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    where activity.recipient_user_id = p_recipient_user_id
      and (
        activity.comment_id is null
        or comment.id is not null
      )
      and not exists (
        select 1
        from public.live_room_actor_blocks as block
        where block.blocker_kind = 'member'
          and block.blocked_kind = 'member'
          and (
            (
              block.blocker_member_user_id = p_recipient_user_id
              and block.blocked_member_user_id = activity.actor_user_id
            )
            or
            (
              block.blocker_member_user_id = activity.actor_user_id
              and block.blocked_member_user_id = p_recipient_user_id
            )
          )
      )
  ),
  limited as (
    select visible.*
    from visible_activity as visible
    order by visible.created_at desc, visible.id desc
    limit greatest(1, least(coalesce(p_limit, 30), 50))
  )
  select pg_catalog.jsonb_build_object(
    'items',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'activityId', item.id,
            'kind', item.activity_kind,
            'postId', item.post_id,
            'commentId', item.comment_id,
            'createdAt', item.created_at,
            'isRead', item.read_at is not null,
            'postTitle', item.post_title,
            'bodyPreview', item.body_preview,
            'actorDisplayName', item.actor_display_name,
            'actorEmoji', item.actor_emoji,
            'roomKind', item.room_kind,
            'ticker', item.ticker,
            'communitySlug', item.community_slug,
            'roomLabel',
              case
                when item.room_kind = 'company'
                  then '$' || item.ticker
                else item.community_name
              end
          )
          order by item.created_at desc, item.id desc
        )
        from limited as item
      ),
      '[]'::jsonb
    ),
    'unreadCount',
    (
      select pg_catalog.count(*)::bigint
      from visible_activity as visible
      where visible.read_at is null
    )
  )
$$;

create function public.mark_live_room_post_activity_read(
  p_recipient_user_id uuid,
  p_activity_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  update public.live_room_post_activity as activity
  set read_at = coalesce(activity.read_at, pg_catalog.now())
  where activity.id = p_activity_id
    and activity.recipient_user_id = p_recipient_user_id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end
$$;

revoke all privileges
on function private.enqueue_live_room_post_activity()
from public, anon, authenticated;
revoke all privileges
on function private.enqueue_live_room_comment_activity()
from public, anon, authenticated;
revoke all privileges
on function public.get_live_room_post_activity_summary(uuid, integer)
from public, anon, authenticated;
revoke all privileges
on function public.mark_live_room_post_activity_read(uuid, uuid)
from public, anon, authenticated;

grant execute
on function private.enqueue_live_room_post_activity()
to service_role;
grant execute
on function private.enqueue_live_room_comment_activity()
to service_role;
grant execute
on function public.get_live_room_post_activity_summary(uuid, integer)
to service_role;
grant execute
on function public.mark_live_room_post_activity_read(uuid, uuid)
to service_role;

comment on table public.live_room_post_activity is
  'Member-only Live Room post, comment, reply, and follow activity. Separate from paid market Alerts.';

commit;
