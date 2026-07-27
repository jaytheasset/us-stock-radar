-- Live Room persistence foundation.
--
-- Access model:
--   * Browsers call same-origin Next.js API routes.
--   * Only the server-held service role can access these tables/RPCs.
--   * anon/authenticated receive no table or function privileges and no RLS
--     policies, so RLS remains default-deny if a grant is added accidentally.
--   * The service role must never be exposed to a browser.
--
-- Realtime is intentionally not configured in this migration. The current app
-- keeps Supabase access tokens in HttpOnly cookies and supports non-Auth guest
-- sessions, so private Realtime channels cannot authenticate every browser
-- without adding a separate short-lived token service. The phase-1 client uses
-- cursor polling behind a replaceable transport interface.

create schema if not exists private;

create table if not exists public.live_room_rooms (
  id uuid primary key default gen_random_uuid(),
  ticker text not null
    check (
      ticker = upper(btrim(ticker))
      and ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'
    ),
  -- Reserved for a canonical issuer table. Ticker is the phase-1 identity.
  issuer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker)
);

create unique index if not exists live_room_rooms_issuer_unique_idx
  on public.live_room_rooms (issuer_id)
  where issuer_id is not null;

create table if not exists public.live_room_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Only a SHA-256 digest is stored. The random bearer token stays in an
  -- HttpOnly, SameSite cookie.
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index if not exists live_room_guest_sessions_expiry_idx
  on public.live_room_guest_sessions (expires_at);

create table if not exists public.live_room_member_profiles (
  user_id uuid primary key
    references public.user_profiles(id) on delete cascade,
  display_name text not null
    check (
      char_length(display_name) between 1 and 24
      and display_name = btrim(display_name)
    ),
  emoji text not null
    check (emoji in ('👋', '🦊', '🐻', '🦉', '🚀', '🧭', '📊', '🌱')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_room_guest_profiles (
  guest_session_id uuid primary key
    references public.live_room_guest_sessions(id) on delete cascade,
  display_name text not null
    check (
      char_length(display_name) between 1 and 24
      and display_name = btrim(display_name)
    ),
  emoji text not null
    check (emoji in ('👋', '🦊', '🐻', '🦉', '🚀', '🧭', '📊', '🌱')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.live_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.live_room_rooms(id) on delete restrict,
  author_kind text not null
    check (author_kind in ('member', 'guest')),
  member_user_id uuid
    references public.user_profiles(id) on delete set null,
  guest_session_id uuid
    references public.live_room_guest_sessions(id) on delete set null,
  actor_id uuid generated always as (
    coalesce(member_user_id, guest_session_id)
  ) stored,
  -- Author and plan snapshots preserve historical attribution after account or
  -- guest-session cleanup. The server derives plan from subscriptions.
  author_display_name text not null
    check (char_length(author_display_name) between 1 and 24),
  author_emoji text not null
    check (author_emoji in ('👋', '🦊', '🐻', '🦉', '🚀', '🧭', '📊', '🌱')),
  author_plan text not null
    check (author_plan in ('free', 'ad_free', 'pro', 'advanced', 'ultimate')),
  body text not null
    check (
      char_length(body) between 1 and 600
      and body = btrim(body)
    ),
  referenced_event_id uuid
    references public.events(id) on delete set null,
  referenced_event_kind text
    check (referenced_event_kind in ('filing', 'news')),
  referenced_event_title text,
  visibility_status text not null default 'visible'
    check (visibility_status in ('visible', 'hidden', 'deleted')),
  moderation_reason text,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (author_kind = 'member' and guest_session_id is null)
    or
    (author_kind = 'guest' and member_user_id is null)
  ),
  check (
    (
      referenced_event_id is null
      and referenced_event_kind is null
      and referenced_event_title is null
    )
    or
    (
      referenced_event_id is not null
      and referenced_event_kind is not null
      and referenced_event_title is not null
    )
  )
);

create index if not exists live_room_messages_room_cursor_idx
  on public.live_room_messages (room_id, created_at desc, id desc)
  where visibility_status = 'visible';

create index if not exists live_room_messages_actor_recent_idx
  on public.live_room_messages (
    author_kind,
    actor_id,
    created_at desc
  )
  where visibility_status = 'visible' and actor_id is not null;

create index if not exists live_room_messages_event_idx
  on public.live_room_messages (referenced_event_id)
  where referenced_event_id is not null;

create table if not exists public.live_room_follows (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null
    references public.live_room_rooms(id) on delete cascade,
  actor_kind text not null
    check (actor_kind in ('member', 'guest')),
  member_user_id uuid
    references public.user_profiles(id) on delete cascade,
  guest_session_id uuid
    references public.live_room_guest_sessions(id) on delete cascade,
  actor_id uuid generated always as (
    coalesce(member_user_id, guest_session_id)
  ) stored,
  followed boolean not null default true,
  notification_scope text not null default 'company_updates_only'
    check (
      notification_scope in ('all_room_messages', 'company_updates_only')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (actor_kind = 'member'
      and member_user_id is not null
      and guest_session_id is null)
    or
    (actor_kind = 'guest'
      and guest_session_id is not null
      and member_user_id is null)
  ),
  unique (room_id, actor_kind, actor_id)
);

create index if not exists live_room_follows_actor_idx
  on public.live_room_follows (actor_kind, actor_id, updated_at desc);

create or replace function private.set_live_room_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

revoke all privileges
on function private.set_live_room_updated_at()
from public, anon, authenticated;

drop trigger if exists live_room_rooms_set_updated_at
  on public.live_room_rooms;
create trigger live_room_rooms_set_updated_at
before update on public.live_room_rooms
for each row execute function private.set_live_room_updated_at();

drop trigger if exists live_room_member_profiles_set_updated_at
  on public.live_room_member_profiles;
create trigger live_room_member_profiles_set_updated_at
before update on public.live_room_member_profiles
for each row execute function private.set_live_room_updated_at();

drop trigger if exists live_room_guest_profiles_set_updated_at
  on public.live_room_guest_profiles;
create trigger live_room_guest_profiles_set_updated_at
before update on public.live_room_guest_profiles
for each row execute function private.set_live_room_updated_at();

drop trigger if exists live_room_follows_set_updated_at
  on public.live_room_follows;
create trigger live_room_follows_set_updated_at
before update on public.live_room_follows
for each row execute function private.set_live_room_updated_at();

-- Serializes moderation checks per server-resolved actor and inserts the
-- message atomically. The function is SECURITY INVOKER and callable only by
-- service_role, so it does not create a privileged public endpoint.
create or replace function public.insert_live_room_message(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_author_display_name text,
  p_author_emoji text,
  p_author_plan text,
  p_body text,
  p_referenced_event_id uuid default null
)
returns public.live_room_messages
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_body text := btrim(p_body);
  v_event_kind text;
  v_event_title text;
  v_event_ticker text;
  v_event_delivery_level text;
  v_message public.live_room_messages;
begin
  if p_actor_kind = 'member'
    and p_member_user_id is not null
    and p_guest_session_id is null
  then
    v_actor_id := p_member_user_id;
  elsif p_actor_kind = 'guest'
    and p_guest_session_id is not null
    and p_member_user_id is null
  then
    v_actor_id := p_guest_session_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_kind || ':' || v_actor_id::text, 0)
  );

  if regexp_replace(v_body, '[[:space:]]+', '', 'g') = '' then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_EMPTY';
  end if;

  if char_length(v_body) > 600 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MAX_LENGTH';
  end if;

  if lower(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
    like any (array[
      '%guaranteed return%',
      '%pump and dump%',
      '%risk-free profit%'
    ])
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_BLOCKED_WORD';
  end if;

  if (
    select count(*)
    from regexp_matches(
      v_body,
      '(https?://|www\.)[^[:space:]]+',
      'gi'
    )
  ) > 2 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_EXCESSIVE_LINKS';
  end if;

  if exists (
    select 1
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= now() - interval '2 minutes'
      and lower(
        btrim(regexp_replace(message.body, '[[:space:]]+', ' ', 'g'))
      ) = lower(
        btrim(regexp_replace(v_body, '[[:space:]]+', ' ', 'g'))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select count(*)
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= now() - interval '20 seconds'
  ) >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if p_referenced_event_id is not null then
    select
      case
        when event.source_group::text = 'filings' then 'filing'
        else 'news'
      end,
      event.title,
      upper(btrim(event.ticker)),
      event.delivery_level::text
    into
      v_event_kind,
      v_event_title,
      v_event_ticker,
      v_event_delivery_level
    from public.events event
    join public.live_room_rooms room
      on room.id = p_room_id
    where event.id = p_referenced_event_id
      and upper(btrim(event.ticker)) = room.ticker;

    if v_event_title is null or v_event_delivery_level = 'archive' then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    end if;
  end if;

  insert into public.live_room_messages (
    room_id,
    author_kind,
    member_user_id,
    guest_session_id,
    author_display_name,
    author_emoji,
    author_plan,
    body,
    referenced_event_id,
    referenced_event_kind,
    referenced_event_title
  )
  values (
    p_room_id,
    p_actor_kind,
    p_member_user_id,
    p_guest_session_id,
    p_author_display_name,
    p_author_emoji,
    p_author_plan,
    v_body,
    p_referenced_event_id,
    v_event_kind,
    v_event_title
  )
  returning * into v_message;

  return v_message;
end
$$;

revoke all privileges
on function public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid
)
to service_role;

alter table public.live_room_rooms enable row level security;
alter table public.live_room_guest_sessions enable row level security;
alter table public.live_room_member_profiles enable row level security;
alter table public.live_room_guest_profiles enable row level security;
alter table public.live_room_messages enable row level security;
alter table public.live_room_follows enable row level security;

revoke all privileges
on table
  public.live_room_rooms,
  public.live_room_guest_sessions,
  public.live_room_member_profiles,
  public.live_room_guest_profiles,
  public.live_room_messages,
  public.live_room_follows
from public, anon, authenticated;

revoke all privileges
on all sequences in schema public
from public, anon, authenticated;

grant all privileges
on table
  public.live_room_rooms,
  public.live_room_guest_sessions,
  public.live_room_member_profiles,
  public.live_room_guest_profiles,
  public.live_room_messages,
  public.live_room_follows
to service_role;

grant all privileges
on all sequences in schema public
to service_role;

comment on table public.live_room_messages is
  'Company-room chat. Hidden/deleted rows are retained for moderation audit; no client hard-delete API is exposed.';

comment on table public.live_room_guest_sessions is
  'Server-issued guest identities. Expired sessions may be pruned; message author snapshots survive via ON DELETE SET NULL.';
