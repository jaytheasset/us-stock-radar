begin;

-- Public member routes use a stable identifier that is intentionally
-- different from auth.users/user_profiles IDs.
alter table public.live_room_member_profiles
  add column if not exists public_profile_id uuid;

update public.live_room_member_profiles
set public_profile_id = gen_random_uuid()
where public_profile_id is null;

alter table public.live_room_member_profiles
  alter column public_profile_id set default gen_random_uuid(),
  alter column public_profile_id set not null;

create unique index if not exists
  live_room_member_profiles_public_profile_id_idx
  on public.live_room_member_profiles (public_profile_id);

create table public.live_room_posts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.live_room_rooms(id) on delete restrict,
  author_user_id uuid not null
    references public.user_profiles(id) on delete restrict,
  title text not null
    check (
      char_length(title) between 4 and 120
      and title = btrim(title)
      and title !~ '[[:cntrl:]]'
    ),
  body text not null
    check (
      char_length(body) between 20 and 10000
      and body = btrim(body)
    ),
  related_tickers text[] not null default array[]::text[],
  referenced_event_id uuid
    references public.events(id) on delete set null,
  visibility_status text not null default 'visible'
    check (visibility_status in ('visible', 'hidden', 'deleted')),
  moderation_reason text,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_room_posts_related_tickers_check
    check (
      public.live_room_community_tickers_valid(related_tickers)
    )
);

create index live_room_posts_room_created_idx
  on public.live_room_posts (room_id, created_at desc, id desc)
  where visibility_status = 'visible';

create index live_room_posts_author_created_idx
  on public.live_room_posts (author_user_id, created_at desc, id desc)
  where visibility_status = 'visible';

create index live_room_posts_room_updated_idx
  on public.live_room_posts (room_id, updated_at asc, id asc);

create index live_room_posts_event_idx
  on public.live_room_posts (referenced_event_id)
  where referenced_event_id is not null;

create table public.live_room_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null
    references public.live_room_posts(id) on delete restrict,
  reporter_kind text not null
    check (reporter_kind in ('member', 'guest')),
  reporter_actor_id uuid not null,
  reporter_member_user_id uuid
    references public.user_profiles(id) on delete set null,
  reporter_guest_session_id uuid
    references public.live_room_guest_sessions(id) on delete set null,
  reason text not null
    check (reason in ('spam', 'harassment', 'misinformation', 'other')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter_kind, reporter_actor_id)
);

create index live_room_post_reports_post_idx
  on public.live_room_post_reports (post_id, created_at desc);

create index live_room_post_reports_member_idx
  on public.live_room_post_reports (reporter_member_user_id)
  where reporter_member_user_id is not null;

create index live_room_post_reports_guest_idx
  on public.live_room_post_reports (reporter_guest_session_id)
  where reporter_guest_session_id is not null;

create table public.live_room_post_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null
    references public.live_room_posts(id) on delete restrict,
  moderator_user_id uuid
    references public.user_profiles(id) on delete set null,
  moderator_role text not null
    check (moderator_role in ('moderator', 'admin')),
  action text not null
    check (action in ('hide', 'restore')),
  previous_visibility_status text not null
    check (previous_visibility_status in ('visible', 'hidden', 'deleted')),
  resulting_visibility_status text not null
    check (resulting_visibility_status in ('visible', 'hidden', 'deleted')),
  reason text not null
    check (char_length(reason) between 1 and 240),
  created_at timestamptz not null default now()
);

create index live_room_post_moderation_actions_post_idx
  on public.live_room_post_moderation_actions
    (post_id, created_at desc);

create index live_room_post_moderation_actions_moderator_idx
  on public.live_room_post_moderation_actions
    (moderator_user_id, created_at desc)
  where moderator_user_id is not null;

drop trigger if exists live_room_posts_set_updated_at
  on public.live_room_posts;
create trigger live_room_posts_set_updated_at
before update on public.live_room_posts
for each row execute function private.set_live_room_updated_at();

drop trigger if exists live_room_posts_touch_community_activity
  on public.live_room_posts;
create trigger live_room_posts_touch_community_activity
after insert on public.live_room_posts
for each row execute function private.touch_live_room_community_activity();

create function public.create_live_room_post(
  p_room_id uuid,
  p_author_user_id uuid,
  p_title text,
  p_body text,
  p_related_tickers text[] default array[]::text[],
  p_referenced_event_id uuid default null
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_title text := pg_catalog.btrim(pg_catalog.coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(pg_catalog.coalesce(p_body, ''));
  v_tickers text[] := pg_catalog.coalesce(
    p_related_tickers,
    array[]::text[]
  );
  v_room public.live_room_rooms;
  v_event_ticker text;
  v_event_delivery_level text;
  v_community_tickers text[];
  v_post public.live_room_posts;
begin
  select room.*
  into v_room
  from public.live_room_rooms as room
  where room.id = p_room_id;

  if v_room.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_UNAVAILABLE';
  end if;

  if not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = p_author_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if not public.live_room_community_tickers_valid(v_tickers) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_TICKERS';
  end if;

  if p_referenced_event_id is not null then
    select
      pg_catalog.upper(pg_catalog.btrim(event.ticker)),
      event.delivery_level::text
    into v_event_ticker, v_event_delivery_level
    from public.events as event
    where event.id = p_referenced_event_id
      and event.source_group::text in ('news', 'filings');

    if v_event_ticker is null or v_event_delivery_level = 'archive' then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    end if;

    if v_room.room_kind = 'company'
      and v_event_ticker <> v_room.ticker
    then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    elsif v_room.room_kind = 'community' then
      select community.related_tickers
      into v_community_tickers
      from public.live_room_community_rooms as community
      where community.room_id = p_room_id;

      if not (v_event_ticker = any(
        pg_catalog.coalesce(v_community_tickers, array[]::text[])
      )) then
        raise exception using
          errcode = 'P0001',
          message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
      end if;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-post:' || p_author_user_id::text,
      0
    )
  );

  if (
    select pg_catalog.count(*)
    from public.live_room_posts as post
    where post.author_user_id = p_author_user_id
      and post.created_at >= pg_catalog.now() - interval '10 minutes'
  ) >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.live_room_posts as post
    where post.author_user_id = p_author_user_id
      and post.visibility_status = 'visible'
      and post.created_at >= pg_catalog.now() - interval '10 minutes'
      and pg_catalog.lower(post.title) = pg_catalog.lower(v_title)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_DUPLICATE';
  end if;

  insert into public.live_room_posts (
    room_id,
    author_user_id,
    title,
    body,
    related_tickers,
    referenced_event_id
  )
  values (
    p_room_id,
    p_author_user_id,
    v_title,
    v_body,
    v_tickers,
    p_referenced_event_id
  )
  returning * into v_post;

  return v_post;
end
$$;

create function public.update_live_room_post(
  p_post_id uuid,
  p_author_user_id uuid,
  p_title text,
  p_body text,
  p_related_tickers text[] default array[]::text[],
  p_referenced_event_id uuid default null
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.live_room_posts;
  v_result public.live_room_posts;
begin
  select post.*
  into v_existing
  from public.live_room_posts as post
  where post.id = p_post_id
  for update;

  if v_existing.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if v_existing.author_user_id <> p_author_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_FORBIDDEN';
  end if;

  if v_existing.visibility_status <> 'visible' then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_EDITABLE';
  end if;

  -- Reuse the create validator without writing a duplicate row by validating
  -- the mutable values directly against the same table constraints and room.
  if not public.live_room_community_tickers_valid(
    pg_catalog.coalesce(p_related_tickers, array[]::text[])
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_INVALID_TICKERS';
  end if;

  if p_referenced_event_id is not null and not exists (
    select 1
    from public.events as event
    join public.live_room_rooms as room
      on room.id = v_existing.room_id
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    where event.id = p_referenced_event_id
      and event.source_group::text in ('news', 'filings')
      and event.delivery_level::text <> 'archive'
      and (
        (
          room.room_kind = 'company'
          and pg_catalog.upper(pg_catalog.btrim(event.ticker)) = room.ticker
        )
        or
        (
          room.room_kind = 'community'
          and pg_catalog.upper(pg_catalog.btrim(event.ticker))
            = any(community.related_tickers)
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
  end if;

  update public.live_room_posts
  set
    title = pg_catalog.btrim(pg_catalog.coalesce(p_title, '')),
    body = pg_catalog.btrim(pg_catalog.coalesce(p_body, '')),
    related_tickers = pg_catalog.coalesce(
      p_related_tickers,
      array[]::text[]
    ),
    referenced_event_id = p_referenced_event_id
  where id = p_post_id
  returning * into v_result;

  return v_result;
end
$$;

create function public.delete_live_room_post(
  p_post_id uuid,
  p_author_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.live_room_posts
  set
    visibility_status = 'deleted',
    deleted_at = pg_catalog.now()
  where id = p_post_id
    and author_user_id = p_author_user_id
    and visibility_status = 'visible';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_EDITABLE';
  end if;

  return true;
end
$$;

create function public.report_live_room_post(
  p_post_id uuid,
  p_reporter_kind text,
  p_reporter_member_user_id uuid,
  p_reporter_guest_session_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_reporter_actor_id uuid;
begin
  if p_reason not in ('spam', 'harassment', 'misinformation', 'other') then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORT_REASON';
  end if;

  if p_reporter_kind = 'member'
    and p_reporter_member_user_id is not null
    and p_reporter_guest_session_id is null
  then
    v_reporter_actor_id := p_reporter_member_user_id;
  elsif p_reporter_kind = 'guest'
    and p_reporter_guest_session_id is not null
    and p_reporter_member_user_id is null
  then
    v_reporter_actor_id := p_reporter_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPORTER';
  end if;

  if not exists (
    select 1
    from public.live_room_posts as post
    where post.id = p_post_id
      and post.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  insert into public.live_room_post_reports (
    post_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_post_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (post_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_post_reports as report
    where report.post_id = p_post_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;

create function public.moderate_live_room_post(
  p_post_id uuid,
  p_moderator_user_id uuid,
  p_action text,
  p_reason text
)
returns public.live_room_posts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post public.live_room_posts;
  v_result public.live_room_posts;
  v_role text;
  v_reason text := pg_catalog.left(
    pg_catalog.btrim(pg_catalog.coalesce(p_reason, '')),
    240
  );
begin
  select moderator.role
  into v_role
  from public.live_room_moderators as moderator
  where moderator.user_id = p_moderator_user_id
    and moderator.active = true;

  if v_role is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MODERATOR_REQUIRED';
  end if;

  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = p_post_id
  for update;

  if v_post.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if p_action = 'hide' and v_post.visibility_status = 'visible' then
    if v_reason = '' then
      v_reason := 'Hidden by moderator';
    end if;
    update public.live_room_posts
    set
      visibility_status = 'hidden',
      moderation_reason = v_reason,
      hidden_at = pg_catalog.now()
    where id = p_post_id
    returning * into v_result;
  elsif p_action = 'restore' and v_post.visibility_status = 'hidden' then
    if v_reason = '' then
      v_reason := 'Restored by moderator';
    end if;
    update public.live_room_posts
    set
      visibility_status = 'visible',
      moderation_reason = null,
      hidden_at = null
    where id = p_post_id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MODERATION_TRANSITION';
  end if;

  insert into public.live_room_post_moderation_actions (
    post_id,
    moderator_user_id,
    moderator_role,
    action,
    previous_visibility_status,
    resulting_visibility_status,
    reason
  )
  values (
    p_post_id,
    p_moderator_user_id,
    v_role,
    p_action,
    v_post.visibility_status,
    v_result.visibility_status,
    v_reason
  );

  return v_result;
end
$$;

create function public.block_live_room_post_author(
  p_post_id uuid,
  p_blocker_kind text,
  p_blocker_member_user_id uuid,
  p_blocker_guest_session_id uuid
)
returns public.live_room_actor_blocks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post public.live_room_posts;
  v_profile public.live_room_member_profiles;
  v_block public.live_room_actor_blocks;
  v_blocker_actor_id uuid := coalesce(
    p_blocker_member_user_id,
    p_blocker_guest_session_id
  );
begin
  select post.*
  into v_post
  from public.live_room_posts as post
  where post.id = p_post_id
    and post.visibility_status = 'visible';

  if v_post.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_POST_NOT_FOUND';
  end if;

  if v_blocker_actor_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  if p_blocker_kind = 'member'
    and p_blocker_member_user_id = v_post.author_user_id
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_BLOCK_SELF';
  end if;

  select profile.*
  into v_profile
  from public.live_room_member_profiles as profile
  where profile.user_id = v_post.author_user_id;

  insert into public.live_room_actor_blocks (
    blocker_kind,
    blocker_member_user_id,
    blocker_guest_session_id,
    blocked_kind,
    blocked_member_user_id,
    blocked_guest_session_id,
    blocked_display_name,
    blocked_emoji
  )
  values (
    p_blocker_kind,
    p_blocker_member_user_id,
    p_blocker_guest_session_id,
    'member',
    v_post.author_user_id,
    null,
    coalesce(v_profile.display_name, 'Member'),
    coalesce(v_profile.emoji, '👋')
  )
  on conflict (
    blocker_kind,
    blocker_actor_id,
    blocked_kind,
    blocked_actor_id
  )
  do update set
    blocked_display_name = excluded.blocked_display_name,
    blocked_emoji = excluded.blocked_emoji
  returning * into v_block;

  return v_block;
end
$$;

alter table public.live_room_posts enable row level security;
alter table public.live_room_post_reports enable row level security;
alter table public.live_room_post_moderation_actions
  enable row level security;

revoke all privileges
on table
  public.live_room_posts,
  public.live_room_post_reports,
  public.live_room_post_moderation_actions
from public, anon, authenticated;

grant select, insert, update, delete
on table
  public.live_room_posts,
  public.live_room_post_reports,
  public.live_room_post_moderation_actions
to service_role;

revoke all privileges
on function public.create_live_room_post(
  uuid, uuid, text, text, text[], uuid
)
from public, anon, authenticated;
revoke all privileges
on function public.update_live_room_post(
  uuid, uuid, text, text, text[], uuid
)
from public, anon, authenticated;
revoke all privileges
on function public.delete_live_room_post(uuid, uuid)
from public, anon, authenticated;
revoke all privileges
on function public.report_live_room_post(
  uuid, text, uuid, uuid, text
)
from public, anon, authenticated;
revoke all privileges
on function public.moderate_live_room_post(uuid, uuid, text, text)
from public, anon, authenticated;
revoke all privileges
on function public.block_live_room_post_author(
  uuid, text, uuid, uuid
)
from public, anon, authenticated;

grant execute
on function public.create_live_room_post(
  uuid, uuid, text, text, text[], uuid
)
to service_role;
grant execute
on function public.update_live_room_post(
  uuid, uuid, text, text, text[], uuid
)
to service_role;
grant execute
on function public.delete_live_room_post(uuid, uuid)
to service_role;
grant execute
on function public.report_live_room_post(
  uuid, text, uuid, uuid, text
)
to service_role;
grant execute
on function public.moderate_live_room_post(uuid, uuid, text, text)
to service_role;
grant execute
on function public.block_live_room_post_author(
  uuid, text, uuid, uuid
)
to service_role;

comment on column public.live_room_member_profiles.public_profile_id is
  'Opaque public route identifier. Never reuse the auth/user_profiles UUID.';
comment on table public.live_room_posts is
  'Canonical Live Room post originals. Room/profile/chat surfaces reference these rows; they do not copy title or body.';

commit;
