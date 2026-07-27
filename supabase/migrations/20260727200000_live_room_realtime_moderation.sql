begin;

-- Live Room Realtime signals and service-only moderation primitives.
--
-- The message tables remain server-only. Realtime publishes only an
-- untrusted refresh hint to a public per-ticker topic so browser guests can
-- subscribe without receiving message bodies or actor identifiers.

alter table public.live_room_messages
  add column if not exists updated_at timestamptz not null default now();

create index if not exists live_room_messages_room_change_cursor_idx
  on public.live_room_messages (room_id, updated_at asc, id asc);

drop trigger if exists live_room_messages_set_updated_at
  on public.live_room_messages;
create trigger live_room_messages_set_updated_at
before update on public.live_room_messages
for each row execute function private.set_live_room_updated_at();

create table if not exists public.live_room_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null
    references public.live_room_messages(id) on delete restrict,
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
  unique (message_id, reporter_kind, reporter_actor_id)
);

create index if not exists live_room_message_reports_message_idx
  on public.live_room_message_reports (message_id, created_at desc);

create index if not exists live_room_message_reports_member_idx
  on public.live_room_message_reports (reporter_member_user_id)
  where reporter_member_user_id is not null;

create index if not exists live_room_message_reports_guest_idx
  on public.live_room_message_reports (reporter_guest_session_id)
  where reporter_guest_session_id is not null;

create table if not exists public.live_room_actor_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_kind text not null
    check (blocker_kind in ('member', 'guest')),
  blocker_member_user_id uuid
    references public.user_profiles(id) on delete cascade,
  blocker_guest_session_id uuid
    references public.live_room_guest_sessions(id) on delete cascade,
  blocker_actor_id uuid generated always as (
    coalesce(blocker_member_user_id, blocker_guest_session_id)
  ) stored,
  blocked_kind text not null
    check (blocked_kind in ('member', 'guest')),
  blocked_member_user_id uuid
    references public.user_profiles(id) on delete cascade,
  blocked_guest_session_id uuid
    references public.live_room_guest_sessions(id) on delete cascade,
  blocked_actor_id uuid generated always as (
    coalesce(blocked_member_user_id, blocked_guest_session_id)
  ) stored,
  blocked_display_name text not null
    check (char_length(blocked_display_name) between 1 and 24),
  blocked_emoji text not null,
  created_at timestamptz not null default now(),
  check (
    (blocker_kind = 'member'
      and blocker_member_user_id is not null
      and blocker_guest_session_id is null)
    or
    (blocker_kind = 'guest'
      and blocker_guest_session_id is not null
      and blocker_member_user_id is null)
  ),
  check (
    (blocked_kind = 'member'
      and blocked_member_user_id is not null
      and blocked_guest_session_id is null)
    or
    (blocked_kind = 'guest'
      and blocked_guest_session_id is not null
      and blocked_member_user_id is null)
  ),
  check (
    blocker_kind <> blocked_kind
    or blocker_actor_id <> blocked_actor_id
  ),
  unique (
    blocker_kind,
    blocker_actor_id,
    blocked_kind,
    blocked_actor_id
  )
);

create index if not exists live_room_actor_blocks_blocker_idx
  on public.live_room_actor_blocks (
    blocker_kind,
    blocker_actor_id,
    created_at desc
  );

create index if not exists live_room_actor_blocks_blocked_idx
  on public.live_room_actor_blocks (blocked_kind, blocked_actor_id);

create index if not exists live_room_actor_blocks_blocker_member_idx
  on public.live_room_actor_blocks (blocker_member_user_id)
  where blocker_member_user_id is not null;

create index if not exists live_room_actor_blocks_blocker_guest_idx
  on public.live_room_actor_blocks (blocker_guest_session_id)
  where blocker_guest_session_id is not null;

create index if not exists live_room_actor_blocks_blocked_member_idx
  on public.live_room_actor_blocks (blocked_member_user_id)
  where blocked_member_user_id is not null;

create index if not exists live_room_actor_blocks_blocked_guest_idx
  on public.live_room_actor_blocks (blocked_guest_session_id)
  where blocked_guest_session_id is not null;

-- This table is the trusted authorization source for moderator UI and
-- actions. It is intentionally separate from user-editable metadata.
create table if not exists public.live_room_moderators (
  user_id uuid primary key
    references public.user_profiles(id) on delete cascade,
  role text not null
    check (role in ('moderator', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists live_room_moderators_set_updated_at
  on public.live_room_moderators;
create trigger live_room_moderators_set_updated_at
before update on public.live_room_moderators
for each row execute function private.set_live_room_updated_at();

create table if not exists public.live_room_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null
    references public.live_room_messages(id) on delete restrict,
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

create index if not exists live_room_moderation_actions_message_idx
  on public.live_room_moderation_actions (message_id, created_at desc);

create index if not exists live_room_moderation_actions_moderator_idx
  on public.live_room_moderation_actions (
    moderator_user_id,
    created_at desc
  )
  where moderator_user_id is not null;

create or replace function private.broadcast_live_room_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticker text;
  v_action text;
begin
  select room.ticker
  into v_ticker
  from public.live_room_rooms as room
  where room.id = new.room_id;

  if v_ticker is null then
    return new;
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'created'
    else new.visibility_status
  end;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'roomId', new.room_id,
      'messageId', new.id,
      'action', v_action
    ),
    'live-room-changed',
    'live-room:' || v_ticker,
    false
  );

  return new;
end
$$;

revoke all privileges
on function private.broadcast_live_room_message_change()
from public, anon, authenticated;

drop trigger if exists live_room_messages_broadcast_change
  on public.live_room_messages;
create trigger live_room_messages_broadcast_change
after insert or update of visibility_status
on public.live_room_messages
for each row execute function private.broadcast_live_room_message_change();

create or replace function public.report_live_room_message(
  p_room_id uuid,
  p_message_id uuid,
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
    from public.live_room_messages as message
    where message.id = p_message_id
      and message.room_id = p_room_id
      and message.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  insert into public.live_room_message_reports (
    message_id,
    reporter_kind,
    reporter_actor_id,
    reporter_member_user_id,
    reporter_guest_session_id,
    reason
  )
  values (
    p_message_id,
    p_reporter_kind,
    v_reporter_actor_id,
    p_reporter_member_user_id,
    p_reporter_guest_session_id,
    p_reason
  )
  on conflict (message_id, reporter_kind, reporter_actor_id)
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.live_room_message_reports as report
    where report.message_id = p_message_id
      and report.reporter_kind = p_reporter_kind
      and report.reporter_actor_id = v_reporter_actor_id;
  end if;

  return v_report_id;
end
$$;

create or replace function public.block_live_room_message_author(
  p_room_id uuid,
  p_message_id uuid,
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
  v_block public.live_room_actor_blocks;
  v_message public.live_room_messages;
  v_blocker_actor_id uuid := pg_catalog.coalesce(
    p_blocker_member_user_id,
    p_blocker_guest_session_id
  );
begin
  select message.*
  into v_message
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.visibility_status = 'visible';

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if v_message.actor_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_BLOCK_TARGET_UNAVAILABLE';
  end if;

  if p_blocker_kind = v_message.author_kind
    and v_blocker_actor_id = v_message.actor_id
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_CANNOT_BLOCK_SELF';
  end if;

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
    v_message.author_kind,
    case
      when v_message.author_kind = 'member'
      then v_message.member_user_id
      else null
    end,
    case
      when v_message.author_kind = 'guest'
      then v_message.guest_session_id
      else null
    end,
    v_message.author_display_name,
    v_message.author_emoji
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

create or replace function public.moderate_live_room_message(
  p_room_id uuid,
  p_message_id uuid,
  p_moderator_user_id uuid,
  p_action text,
  p_reason text
)
returns public.live_room_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message public.live_room_messages;
  v_result public.live_room_messages;
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

  select message.*
  into v_message
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
  for update;

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if p_action = 'hide' and v_message.visibility_status = 'visible' then
    if v_reason = '' then
      v_reason := 'Hidden by moderator';
    end if;
    update public.live_room_messages
    set
      visibility_status = 'hidden',
      moderation_reason = v_reason,
      hidden_at = pg_catalog.now()
    where id = p_message_id
    returning * into v_result;
  elsif p_action = 'restore' and v_message.visibility_status = 'hidden' then
    if v_reason = '' then
      v_reason := 'Restored by moderator';
    end if;
    update public.live_room_messages
    set
      visibility_status = 'visible',
      moderation_reason = null,
      hidden_at = null
    where id = p_message_id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MODERATION_TRANSITION';
  end if;

  insert into public.live_room_moderation_actions (
    message_id,
    moderator_user_id,
    moderator_role,
    action,
    previous_visibility_status,
    resulting_visibility_status,
    reason
  )
  values (
    p_message_id,
    p_moderator_user_id,
    v_role,
    p_action,
    v_message.visibility_status,
    v_result.visibility_status,
    v_reason
  );

  return v_result;
end
$$;

revoke all privileges
on function public.report_live_room_message(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

revoke all privileges
on function public.block_live_room_message_author(
  uuid,
  uuid,
  text,
  uuid,
  uuid
)
from public, anon, authenticated;

revoke all privileges
on function public.moderate_live_room_message(
  uuid,
  uuid,
  uuid,
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.report_live_room_message(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text
)
to service_role;

grant execute
on function public.block_live_room_message_author(
  uuid,
  uuid,
  text,
  uuid,
  uuid
)
to service_role;

grant execute
on function public.moderate_live_room_message(
  uuid,
  uuid,
  uuid,
  text,
  text
)
to service_role;

alter table public.live_room_message_reports enable row level security;
alter table public.live_room_actor_blocks enable row level security;
alter table public.live_room_moderators enable row level security;
alter table public.live_room_moderation_actions enable row level security;

revoke all privileges
on table
  public.live_room_message_reports,
  public.live_room_actor_blocks,
  public.live_room_moderators,
  public.live_room_moderation_actions
from public, anon, authenticated;

grant all privileges
on table
  public.live_room_message_reports,
  public.live_room_actor_blocks,
  public.live_room_moderators,
  public.live_room_moderation_actions
to service_role;

comment on table public.live_room_moderators is
  'Trusted service-only moderator assignments. Authorization must not use user_metadata.';

comment on table public.live_room_moderation_actions is
  'Append-only audit records for Live Room hide and restore actions.';

comment on function private.broadcast_live_room_message_change() is
  'Public Realtime refresh hint only. Payload must never include body or actor identifiers.';

commit;
