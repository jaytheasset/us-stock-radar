alter table public.live_room_messages
  add column reply_to_message_id uuid;

alter table public.live_room_messages
  add constraint live_room_messages_room_id_id_key
  unique (room_id, id);

alter table public.live_room_messages
  add constraint live_room_messages_reply_to_message_fkey
  foreign key (room_id, reply_to_message_id)
  references public.live_room_messages (room_id, id)
  on delete restrict;

create index live_room_messages_room_reply_idx
  on public.live_room_messages (room_id, reply_to_message_id)
  where reply_to_message_id is not null;

drop function if exists public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid
);

create function public.insert_live_room_message(
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
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
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

  if p_reply_to_message_id is not null
    and not exists (
      select 1
      from public.live_room_messages target
      where target.id = p_reply_to_message_id
        and target.room_id = p_room_id
        and target.visibility_status = 'visible'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_REPLY_TARGET';
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
    referenced_event_title,
    reply_to_message_id
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
    v_event_title,
    p_reply_to_message_id
  )
  returning * into v_message;

  return v_message;
end
$function$;

alter function public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid
) owner to postgres;

revoke all on function public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid
) from public;

grant all on function public.insert_live_room_message(
  uuid,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid
) to service_role;
