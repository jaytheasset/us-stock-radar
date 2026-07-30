create table public.live_room_message_media (
  message_id uuid primary key
    references public.live_room_messages(id) on delete cascade,
  provider text not null
    constraint live_room_message_media_provider_check
    check (provider = 'klipy'),
  provider_media_id text not null
    constraint live_room_message_media_provider_media_id_check
    check (
      char_length(provider_media_id) between 1 and 128
      and provider_media_id ~ '^[A-Za-z0-9_-]+$'
    ),
  media_kind text not null
    constraint live_room_message_media_kind_check
    check (media_kind = 'gif'),
  title text not null default ''
    constraint live_room_message_media_title_check
    check (char_length(title) <= 240),
  alt_text text not null
    constraint live_room_message_media_alt_check
    check (char_length(alt_text) between 1 and 240),
  display_url text not null
    constraint live_room_message_media_display_url_check
    check (
      char_length(display_url) <= 2048
      and display_url ~ '^https://static\.klipy\.com/'
    ),
  preview_url text not null
    constraint live_room_message_media_preview_url_check
    check (
      char_length(preview_url) <= 2048
      and preview_url ~ '^https://static\.klipy\.com/'
    ),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  item_url text not null
    constraint live_room_message_media_item_url_check
    check (
      char_length(item_url) <= 2048
      and item_url ~ '^https://klipy\.com/'
    ),
  content_fingerprint text not null
    constraint live_room_message_media_fingerprint_check
    check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.live_room_message_media enable row level security;
revoke all on table public.live_room_message_media
  from public, anon, authenticated;
grant select, insert, delete on table public.live_room_message_media
  to service_role;

alter table public.live_room_messages
  drop constraint live_room_messages_body_check;
alter table public.live_room_messages
  add constraint live_room_messages_body_check
  check (
    char_length(body) between 0 and 600
    and body = btrim(body)
  );

create function private.insert_live_room_message_core(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_author_display_name text,
  p_author_emoji text,
  p_author_plan text,
  p_body text,
  p_referenced_event_id uuid default null,
  p_reply_to_message_id uuid default null,
  p_allow_empty boolean default false
)
returns public.live_room_messages
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_body text := pg_catalog.btrim(p_body);
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
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_INVALID_ACTOR';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_kind || ':' || v_actor_id::text, 0)
  );

  if pg_catalog.regexp_replace(v_body, '[[:space:]]+', '', 'g') = ''
    and not p_allow_empty
  then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_EMPTY';
  end if;
  if pg_catalog.char_length(v_body) > 600 then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_MAX_LENGTH';
  end if;
  if pg_catalog.lower(
    pg_catalog.regexp_replace(v_body, '[[:space:]]+', ' ', 'g')
  ) like any (array[
    '%guaranteed return%',
    '%pump and dump%',
    '%risk-free profit%'
  ]) then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_BLOCKED_WORD';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.regexp_matches(
      v_body, '(https?://|www\.)[^[:space:]]+', 'gi'
    )
  ) > 2 then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_EXCESSIVE_LINKS';
  end if;

  if v_body <> '' and exists (
    select 1
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= pg_catalog.now() - interval '2 minutes'
      and pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
        message.body, '[[:space:]]+', ' ', 'g'
      ))) = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
        v_body, '[[:space:]]+', ' ', 'g'
      )))
  ) then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_DUPLICATE';
  end if;

  if (
    select pg_catalog.count(*)
    from public.live_room_messages message
    where message.author_kind = p_actor_kind
      and message.actor_id = v_actor_id
      and message.visibility_status = 'visible'
      and message.created_at >= pg_catalog.now() - interval '20 seconds'
  ) >= 3 then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_RATE_LIMIT';
  end if;

  if p_referenced_event_id is not null then
    select
      case when event.source_group::text = 'filings' then 'filing' else 'news' end,
      event.title,
      pg_catalog.upper(pg_catalog.btrim(event.ticker)),
      event.delivery_level::text
    into v_event_kind, v_event_title, v_event_ticker, v_event_delivery_level
    from public.events event
    join public.live_room_rooms room on room.id = p_room_id
    where event.id = p_referenced_event_id
      and pg_catalog.upper(pg_catalog.btrim(event.ticker)) = room.ticker;
    if v_event_title is null or v_event_delivery_level = 'archive' then
      raise exception using
        errcode = 'P0001', message = 'LIVE_ROOM_INVALID_EVENT_REFERENCE';
    end if;
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1
    from public.live_room_messages target
    where target.id = p_reply_to_message_id
      and target.room_id = p_room_id
      and target.visibility_status = 'visible'
  ) then
    raise exception using
      errcode = 'P0001', message = 'LIVE_ROOM_INVALID_REPLY_TARGET';
  end if;

  insert into public.live_room_messages (
    room_id, author_kind, member_user_id, guest_session_id,
    author_display_name, author_emoji, author_plan, body,
    referenced_event_id, referenced_event_kind, referenced_event_title,
    reply_to_message_id
  ) values (
    p_room_id, p_actor_kind, p_member_user_id, p_guest_session_id,
    p_author_display_name, p_author_emoji, p_author_plan, v_body,
    p_referenced_event_id, v_event_kind, v_event_title,
    p_reply_to_message_id
  ) returning * into v_message;
  return v_message;
end
$function$;

create or replace function public.insert_live_room_message(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_author_display_name text,
  p_author_emoji text,
  p_author_plan text,
  p_body text,
  p_referenced_event_id uuid default null,
  p_reply_to_message_id uuid default null
)
returns public.live_room_messages
language sql
security invoker
set search_path = ''
as $function$
  select private.insert_live_room_message_core(
    p_room_id, p_actor_kind, p_member_user_id, p_guest_session_id,
    p_author_display_name, p_author_emoji, p_author_plan, p_body,
    p_referenced_event_id, p_reply_to_message_id, false
  );
$function$;

create function public.insert_live_room_message_with_attachments(
  p_room_id uuid,
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_author_display_name text,
  p_author_emoji text,
  p_author_plan text,
  p_body text,
  p_referenced_event_id uuid default null,
  p_reply_to_message_id uuid default null,
  p_proof_id uuid default null,
  p_public_sharing_enabled boolean default false,
  p_media_provider text default null,
  p_provider_media_id text default null,
  p_media_kind text default null,
  p_media_title text default null,
  p_media_alt_text text default null,
  p_media_display_url text default null,
  p_media_preview_url text default null,
  p_media_width integer default null,
  p_media_height integer default null,
  p_media_item_url text default null,
  p_media_content_fingerprint text default null
)
returns public.live_room_messages
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_has_media boolean := p_provider_media_id is not null;
  v_message public.live_room_messages;
begin
  if p_proof_id is not null and v_has_media then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_ATTACHMENT_CONFLICT';
  end if;
  if (p_proof_id is not null or v_has_media)
    and (p_actor_kind <> 'member' or p_member_user_id is null)
  then
    raise exception using errcode = 'P0001', message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;
  perform private.assert_brokerage_proof_attachable(
    p_member_user_id, p_proof_id, p_public_sharing_enabled
  );
  if v_has_media and (
    p_media_provider is distinct from 'klipy'
    or p_media_kind is distinct from 'gif'
    or p_media_title is null
    or p_media_alt_text is null
    or p_media_display_url is null
    or p_media_preview_url is null
    or p_media_width is null
    or p_media_height is null
    or p_media_item_url is null
    or p_media_content_fingerprint is null
  ) then
    raise exception using errcode = 'P0001', message = 'KLIPY_MEDIA_INVALID';
  end if;

  v_message := private.insert_live_room_message_core(
    p_room_id, p_actor_kind, p_member_user_id, p_guest_session_id,
    p_author_display_name, p_author_emoji, p_author_plan, p_body,
    p_referenced_event_id, p_reply_to_message_id, v_has_media
  );
  if p_proof_id is not null then
    insert into public.live_room_message_brokerage_proofs (message_id, proof_id)
    values (v_message.id, p_proof_id);
  end if;
  if v_has_media then
    insert into public.live_room_message_media (
      message_id, provider, provider_media_id, media_kind, title, alt_text,
      display_url, preview_url, width, height, item_url, content_fingerprint
    ) values (
      v_message.id, p_media_provider, p_provider_media_id, p_media_kind,
      p_media_title, p_media_alt_text, p_media_display_url, p_media_preview_url,
      p_media_width, p_media_height, p_media_item_url,
      p_media_content_fingerprint
    );
  end if;
  return v_message;
end
$function$;

revoke all on function private.insert_live_room_message_core(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function private.insert_live_room_message_core(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, boolean
) to service_role;

revoke all on function public.insert_live_room_message_with_attachments(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, boolean,
  text, text, text, text, text, text, text, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.insert_live_room_message_with_attachments(
  uuid, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid, boolean,
  text, text, text, text, text, text, text, integer, integer, text, text
) to service_role;
