begin;

-- COALESCE is a SQL expression, not a schema-qualified pg_catalog function.
-- Recreate both affected RPCs without changing their contracts or grants.

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
  v_blocker_actor_id uuid := coalesce(
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
    pg_catalog.btrim(coalesce(p_reason, '')),
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

commit;

;
