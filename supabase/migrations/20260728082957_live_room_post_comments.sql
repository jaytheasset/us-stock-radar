begin;

create table public.live_room_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null
    references public.live_room_posts(id) on delete cascade,
  author_user_id uuid not null
    references public.user_profiles(id) on delete restrict,
  parent_comment_id uuid
    references public.live_room_post_comments(id) on delete cascade,
  body text not null
    check (
      char_length(body) between 1 and 2000
      and body = btrim(body)
    ),
  visibility_status text not null default 'visible'
    check (visibility_status in ('visible', 'hidden', 'deleted')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index live_room_post_comments_post_created_idx
  on public.live_room_post_comments (post_id, created_at asc, id asc)
  where visibility_status = 'visible';
create index live_room_post_comments_author_created_idx
  on public.live_room_post_comments (author_user_id, created_at desc)
  where visibility_status = 'visible';
create index live_room_post_comments_parent_idx
  on public.live_room_post_comments (parent_comment_id, created_at asc)
  where parent_comment_id is not null
    and visibility_status = 'visible';

create table public.live_room_post_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null
    references public.live_room_post_comments(id) on delete restrict,
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
  unique (comment_id, reporter_kind, reporter_actor_id)
);

create index live_room_post_comment_reports_comment_idx
  on public.live_room_post_comment_reports (comment_id, created_at desc);
create index live_room_post_comment_reports_member_idx
  on public.live_room_post_comment_reports (reporter_member_user_id)
  where reporter_member_user_id is not null;
create index live_room_post_comment_reports_guest_idx
  on public.live_room_post_comment_reports (reporter_guest_session_id)
  where reporter_guest_session_id is not null;

create function private.validate_live_room_post_comment_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent public.live_room_post_comments;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  if new.parent_comment_id = new.id then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_INVALID_PARENT';
  end if;

  select comment.*
  into v_parent
  from public.live_room_post_comments as comment
  where comment.id = new.parent_comment_id;

  if v_parent.id is null
    or v_parent.post_id <> new.post_id
    or v_parent.parent_comment_id is not null
    or v_parent.visibility_status <> 'visible'
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_INVALID_PARENT';
  end if;

  return new;
end
$$;

create trigger live_room_post_comments_validate_parent
before insert or update of post_id, parent_comment_id
on public.live_room_post_comments
for each row execute function private.validate_live_room_post_comment_parent();

create trigger live_room_post_comments_set_updated_at
before update on public.live_room_post_comments
for each row execute function private.set_live_room_updated_at();

create function public.create_live_room_post_comment(
  p_post_id uuid,
  p_author_user_id uuid,
  p_body text,
  p_parent_comment_id uuid default null
)
returns public.live_room_post_comments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_comment public.live_room_post_comments;
begin
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

  if not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = p_author_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-post-comment:' || p_author_user_id::text,
      0
    )
  );

  if (
    select pg_catalog.count(*)
    from public.live_room_post_comments as comment
    where comment.author_user_id = p_author_user_id
      and comment.created_at >= pg_catalog.now() - interval '10 minutes'
  ) >= 30 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_RATE_LIMIT';
  end if;

  if exists (
    select 1
    from public.live_room_post_comments as comment
    where comment.post_id = p_post_id
      and comment.author_user_id = p_author_user_id
      and comment.visibility_status = 'visible'
      and comment.created_at >= pg_catalog.now() - interval '1 minute'
      and comment.parent_comment_id is not distinct from p_parent_comment_id
      and pg_catalog.lower(comment.body) = pg_catalog.lower(v_body)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_DUPLICATE';
  end if;

  insert into public.live_room_post_comments (
    post_id,
    author_user_id,
    parent_comment_id,
    body
  )
  values (
    p_post_id,
    p_author_user_id,
    p_parent_comment_id,
    v_body
  )
  returning * into v_comment;

  return v_comment;
end
$$;

create function public.update_live_room_post_comment(
  p_comment_id uuid,
  p_author_user_id uuid,
  p_body text
)
returns public.live_room_post_comments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_comment public.live_room_post_comments;
begin
  update public.live_room_post_comments
  set body = pg_catalog.btrim(coalesce(p_body, ''))
  where id = p_comment_id
    and author_user_id = p_author_user_id
    and visibility_status = 'visible'
  returning * into v_comment;

  if v_comment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_EDITABLE';
  end if;

  return v_comment;
end
$$;

create function public.delete_live_room_post_comment(
  p_comment_id uuid,
  p_author_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.live_room_post_comments as comment
    where comment.id = p_comment_id
      and comment.author_user_id = p_author_user_id
      and comment.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_EDITABLE';
  end if;

  update public.live_room_post_comments
  set
    visibility_status = 'deleted',
    deleted_at = pg_catalog.now()
  where id = p_comment_id
    or parent_comment_id = p_comment_id;

  return true;
end
$$;

create function public.report_live_room_post_comment(
  p_comment_id uuid,
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
    from public.live_room_post_comments as comment
    join public.live_room_posts as post
      on post.id = comment.post_id
    where comment.id = p_comment_id
      and comment.visibility_status = 'visible'
      and post.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_COMMENT_NOT_FOUND';
  end if;

  insert into public.live_room_post_comment_reports (
    comment_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_comment_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (comment_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_post_comment_reports as report
    where report.comment_id = p_comment_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;

alter table public.live_room_post_comments enable row level security;
alter table public.live_room_post_comment_reports enable row level security;

revoke all privileges
on table
  public.live_room_post_comments,
  public.live_room_post_comment_reports
from public, anon, authenticated;

grant select, insert, update, delete
on table
  public.live_room_post_comments,
  public.live_room_post_comment_reports
to service_role;

revoke all privileges
on function private.validate_live_room_post_comment_parent()
from public, anon, authenticated;
revoke all privileges
on function public.create_live_room_post_comment(uuid, uuid, text, uuid)
from public, anon, authenticated;
revoke all privileges
on function public.update_live_room_post_comment(uuid, uuid, text)
from public, anon, authenticated;
revoke all privileges
on function public.delete_live_room_post_comment(uuid, uuid)
from public, anon, authenticated;
revoke all privileges
on function public.report_live_room_post_comment(
  uuid, text, uuid, uuid, text
)
from public, anon, authenticated;

grant execute
on function private.validate_live_room_post_comment_parent()
to service_role;
grant execute
on function public.create_live_room_post_comment(uuid, uuid, text, uuid)
to service_role;
grant execute
on function public.update_live_room_post_comment(uuid, uuid, text)
to service_role;
grant execute
on function public.delete_live_room_post_comment(uuid, uuid)
to service_role;
grant execute
on function public.report_live_room_post_comment(
  uuid, text, uuid, uuid, text
)
to service_role;

comment on table public.live_room_post_comments is
  'Canonical post comments and one-level replies shared by every cross-post exposure of a Live Room post.';

commit;
