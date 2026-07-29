alter table public.live_room_messages
  add column like_count bigint not null default 0;

alter table public.live_room_messages
  add constraint live_room_messages_like_count_check
  check (like_count >= 0);

create table public.live_room_message_likes (
  message_id uuid not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint live_room_message_likes_pkey
    primary key (message_id, actor_user_id),
  constraint live_room_message_likes_message_id_fkey
    foreign key (message_id)
    references public.live_room_messages (id)
    on delete cascade,
  constraint live_room_message_likes_actor_user_id_fkey
    foreign key (actor_user_id)
    references public.live_room_member_profiles (user_id)
    on delete cascade
);

comment on table public.live_room_message_likes is
  'Service-only likes for ordinary Live Room and Community Room chat messages.';

alter table public.live_room_message_likes enable row level security;

create index live_room_message_likes_actor_created_idx
  on public.live_room_message_likes (actor_user_id, created_at desc);

create or replace function private.sync_live_room_message_like_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    update public.live_room_messages
    set like_count = like_count + 1
    where id = new.message_id;
    return new;
  end if;

  update public.live_room_messages
  set like_count = greatest(like_count - 1, 0)
  where id = old.message_id;
  return old;
end
$function$;

alter function private.sync_live_room_message_like_count()
  owner to postgres;

create trigger live_room_message_likes_sync_count
after insert or delete on public.live_room_message_likes
for each row
execute function private.sync_live_room_message_like_count();

create or replace function private.touch_live_room_message_reply_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_old_parent_id uuid;
  v_new_parent_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_parent_id := old.reply_to_message_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_parent_id := new.reply_to_message_id;
  end if;

  update public.live_room_messages
  set updated_at = pg_catalog.now()
  where id in (v_old_parent_id, v_new_parent_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

alter function private.touch_live_room_message_reply_parent()
  owner to postgres;

create trigger live_room_messages_touch_reply_parent
after insert or delete or update of reply_to_message_id, visibility_status
on public.live_room_messages
for each row
execute function private.touch_live_room_message_reply_parent();

drop trigger if exists live_room_messages_broadcast_change
  on public.live_room_messages;

create trigger live_room_messages_broadcast_change
after insert or update of visibility_status, like_count, updated_at
on public.live_room_messages
for each row
execute function private.broadcast_live_room_message_change();

create or replace function public.get_live_room_message_reply_counts(
  p_room_id uuid,
  p_message_ids uuid[],
  p_blocked_actor_ids uuid[] default array[]::uuid[]
)
returns table (
  message_id uuid,
  reply_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    reply.reply_to_message_id as message_id,
    pg_catalog.count(*)::bigint as reply_count
  from public.live_room_messages as reply
  where reply.room_id = p_room_id
    and reply.reply_to_message_id = any (
      coalesce(p_message_ids, array[]::uuid[])
    )
    and reply.visibility_status = 'visible'
    and not (
      reply.actor_id = any (
        coalesce(
          p_blocked_actor_ids,
          array[]::uuid[]
        )
      )
    )
  group by reply.reply_to_message_id
$function$;

alter function public.get_live_room_message_reply_counts(
  uuid,
  uuid[],
  uuid[]
)
  owner to postgres;

create or replace function public.set_live_room_message_like(
  p_room_id uuid,
  p_message_id uuid,
  p_actor_user_id uuid,
  p_liked boolean
)
returns table (
  message_id uuid,
  liked boolean,
  like_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_message public.live_room_messages;
begin
  if p_actor_user_id is null
    or not exists (
      select 1
      from public.live_room_member_profiles as profile
      where profile.user_id = p_actor_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MEMBER_REQUIRED';
  end if;

  if p_liked is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_INVALID_MESSAGE_LIKE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'live-room-message-like:'
        || p_message_id::text
        || ':'
        || p_actor_user_id::text,
      0
    )
  );

  select message.*
  into v_message
  from public.live_room_messages as message
  where message.id = p_message_id
    and message.room_id = p_room_id
    and message.visibility_status = 'visible'
  for update;

  if v_message.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.live_room_actor_blocks as block
    where (
      block.blocker_kind = 'member'
      and block.blocker_member_user_id = p_actor_user_id
      and block.blocked_kind = v_message.author_kind
      and block.blocked_actor_id = v_message.actor_id
    )
    or (
      block.blocker_kind = v_message.author_kind
      and block.blocker_actor_id = v_message.actor_id
      and block.blocked_kind = 'member'
      and block.blocked_member_user_id = p_actor_user_id
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LIVE_ROOM_MESSAGE_NOT_FOUND';
  end if;

  if p_liked then
    insert into public.live_room_message_likes (
      message_id,
      actor_user_id
    )
    values (
      p_message_id,
      p_actor_user_id
    )
    on conflict on constraint live_room_message_likes_pkey do nothing;
  else
    delete from public.live_room_message_likes as message_like
    where message_like.message_id = p_message_id
      and message_like.actor_user_id = p_actor_user_id;
  end if;

  return query
  select
    message.id,
    exists (
      select 1
      from public.live_room_message_likes as message_like
      where message_like.message_id = message.id
        and message_like.actor_user_id = p_actor_user_id
    ),
    message.like_count
  from public.live_room_messages as message
  where message.id = p_message_id;
end
$function$;

alter function public.set_live_room_message_like(
  uuid,
  uuid,
  uuid,
  boolean
)
  owner to postgres;

revoke all on table public.live_room_message_likes
  from public, anon, authenticated;
grant select, insert, delete
  on table public.live_room_message_likes
  to service_role;

revoke all on function private.sync_live_room_message_like_count()
  from public, anon, authenticated;
grant execute on function private.sync_live_room_message_like_count()
  to service_role;

revoke all on function private.touch_live_room_message_reply_parent()
  from public, anon, authenticated;
grant execute on function private.touch_live_room_message_reply_parent()
  to service_role;

revoke all on function public.get_live_room_message_reply_counts(
  uuid,
  uuid[],
  uuid[]
)
  from public, anon, authenticated;
grant execute on function public.get_live_room_message_reply_counts(
  uuid,
  uuid[],
  uuid[]
)
  to service_role;

revoke all on function public.set_live_room_message_like(
  uuid,
  uuid,
  uuid,
  boolean
)
  from public, anon, authenticated;
grant execute on function public.set_live_room_message_like(
  uuid,
  uuid,
  uuid,
  boolean
)
  to service_role;
