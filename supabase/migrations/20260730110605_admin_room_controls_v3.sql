begin;

alter table public.live_room_rooms
  add column if not exists admin_status text not null default 'active',
  add column if not exists admin_status_reason text,
  add column if not exists admin_status_updated_at timestamptz,
  add column if not exists admin_status_updated_by uuid
    references public.user_profiles(id) on delete set null;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'live_room_rooms_admin_status_check'
      and conrelid = 'public.live_room_rooms'::regclass
  ) then
    alter table public.live_room_rooms
      add constraint live_room_rooms_admin_status_check
      check (admin_status = any (array['active'::text, 'locked'::text, 'archived'::text]));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'live_room_rooms_admin_status_reason_check'
      and conrelid = 'public.live_room_rooms'::regclass
  ) then
    alter table public.live_room_rooms
      add constraint live_room_rooms_admin_status_reason_check
      check (
        admin_status_reason is null
        or char_length(admin_status_reason) between 4 and 2000
      );
  end if;
end
$block$;

comment on column public.live_room_rooms.admin_status is
  'Administrator-controlled room availability. Locked and archived rooms remain publicly readable.';
comment on column public.live_room_rooms.admin_status_reason is
  'Most recent administrator reason. Service-only and never included in public room responses.';

create index if not exists live_room_rooms_admin_status_updated_idx
  on public.live_room_rooms (admin_status, updated_at desc);

create or replace function private.assert_live_room_writable(p_room_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_status text;
begin
  if p_room_id is null then
    raise exception 'LIVE_ROOM_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text, 0)
  );

  select room.admin_status
  into v_status
  from public.live_room_rooms as room
  where room.id = p_room_id;

  if v_status is null then
    raise exception 'LIVE_ROOM_UNAVAILABLE';
  end if;
  if v_status = 'locked' then
    raise exception 'LIVE_ROOM_LOCKED';
  end if;
  if v_status = 'archived' then
    raise exception 'LIVE_ROOM_ARCHIVED';
  end if;
end
$function$;

create or replace function private.enforce_live_room_writable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_room_id uuid;
begin
  if tg_table_name = 'live_room_post_comments' then
    select post.room_id
    into v_room_id
    from public.live_room_posts as post
    where post.id = new.post_id;
  else
    v_room_id := new.room_id;
  end if;

  perform private.assert_live_room_writable(v_room_id);
  return new;
end
$function$;

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'live_room_messages_enforce_room_writable'
      and tgrelid = 'public.live_room_messages'::regclass
      and not tgisinternal
  ) then
    create trigger live_room_messages_enforce_room_writable
    before insert on public.live_room_messages
    for each row execute function private.enforce_live_room_writable();
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'live_room_posts_enforce_room_writable'
      and tgrelid = 'public.live_room_posts'::regclass
      and not tgisinternal
  ) then
    create trigger live_room_posts_enforce_room_writable
    before insert on public.live_room_posts
    for each row execute function private.enforce_live_room_writable();
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'live_room_post_comments_enforce_room_writable'
      and tgrelid = 'public.live_room_post_comments'::regclass
      and not tgisinternal
  ) then
    create trigger live_room_post_comments_enforce_room_writable
    before insert on public.live_room_post_comments
    for each row execute function private.enforce_live_room_writable();
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'live_room_memberships_enforce_room_writable'
      and tgrelid = 'public.live_room_memberships'::regclass
      and not tgisinternal
  ) then
    create trigger live_room_memberships_enforce_room_writable
    before insert on public.live_room_memberships
    for each row execute function private.enforce_live_room_writable();
  end if;
end
$block$;

create or replace function public.admin_record_source_run_audit(
  p_actor_user_id uuid,
  p_phase text,
  p_reason text,
  p_force boolean,
  p_limit integer,
  p_result jsonb default null,
  p_request_id text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_audit_id uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations']
  );
  if v_actor_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  if pg_catalog.char_length(v_reason) < 4 then
    raise exception 'ADMIN_REASON_REQUIRED';
  end if;
  if p_phase not in ('started', 'succeeded', 'failed', 'blocked') then
    raise exception 'ADMIN_SOURCE_RUN_PHASE_INVALID';
  end if;
  if p_limit < 1 or p_limit > 20 then
    raise exception 'ADMIN_SOURCE_RUN_LIMIT_INVALID';
  end if;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    after_data,
    request_id
  )
  values (
    p_actor_user_id,
    v_actor_role,
    case when p_force
      then 'source.globe.force_run.' || p_phase
      else 'source.globe.run.' || p_phase
    end,
    'source_ingest',
    'globe',
    v_reason,
    pg_catalog.jsonb_build_object(
      'force', p_force,
      'limit', p_limit,
      'phase', p_phase,
      'result', coalesce(p_result, '{}'::jsonb)
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  )
  returning id into v_audit_id;

  return v_audit_id;
end
$function$;

create or replace function public.admin_set_live_room_status(
  p_actor_user_id uuid,
  p_room_id uuid,
  p_action text,
  p_reason text,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_before public.live_room_rooms;
  v_after public.live_room_rooms;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_next_status text;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations', 'moderator']
  );
  if v_actor_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  if pg_catalog.char_length(v_reason) < 4 then
    raise exception 'ADMIN_REASON_REQUIRED';
  end if;
  if p_action not in ('lock', 'unlock', 'archive', 'restore') then
    raise exception 'ADMIN_ROOM_ACTION_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_room_id::text, 0)
  );
  select room.*
  into v_before
  from public.live_room_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'ADMIN_ROOM_NOT_FOUND';
  end if;

  v_next_status := case p_action
    when 'lock' then 'locked'
    when 'unlock' then 'active'
    when 'archive' then 'archived'
    when 'restore' then 'active'
  end;

  if (p_action = 'lock' and v_before.admin_status <> 'active')
    or (p_action = 'unlock' and v_before.admin_status <> 'locked')
    or (p_action = 'archive' and v_before.admin_status = 'archived')
    or (p_action = 'restore' and v_before.admin_status <> 'archived')
  then
    raise exception 'ADMIN_ROOM_STATE_CONFLICT';
  end if;

  update public.live_room_rooms
  set
    admin_status = v_next_status,
    admin_status_reason = v_reason,
    admin_status_updated_at = pg_catalog.now(),
    admin_status_updated_by = p_actor_user_id,
    updated_at = pg_catalog.now()
  where id = p_room_id
  returning * into v_after;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data,
    request_id
  )
  values (
    p_actor_user_id,
    v_actor_role,
    'live_room.' || p_action,
    'live_room',
    p_room_id::text,
    v_reason,
    pg_catalog.jsonb_build_object(
      'admin_status', v_before.admin_status,
      'admin_status_updated_at', v_before.admin_status_updated_at
    ),
    pg_catalog.jsonb_build_object(
      'admin_status', v_after.admin_status,
      'admin_status_updated_at', v_after.admin_status_updated_at
    ),
    nullif(pg_catalog.btrim(p_request_id), '')
  );

  return pg_catalog.jsonb_build_object(
    'id', v_after.id,
    'status', v_after.admin_status,
    'updatedAt', v_after.admin_status_updated_at
  );
end
$function$;

create or replace function public.admin_list_live_rooms(
  p_actor_user_id uuid,
  p_search text default null,
  p_kind text default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_search text := pg_catalog.btrim(coalesce(p_search, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_result jsonb;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations', 'moderator']
  );
  if v_actor_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;
  if p_kind is not null and p_kind not in ('company', 'community') then
    raise exception 'ADMIN_ROOM_FILTER_INVALID';
  end if;
  if p_status is not null and p_status not in ('active', 'locked', 'archived') then
    raise exception 'ADMIN_ROOM_FILTER_INVALID';
  end if;

  select pg_catalog.jsonb_build_object(
    'items',
    coalesce(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item) order by item.last_activity_at desc),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select
      room.id,
      room.room_kind,
      room.ticker,
      room.admin_status,
      room.admin_status_updated_at,
      community.slug,
      coalesce(community.name, room.ticker || ' Live Room') as room_name,
      community.owner_user_id,
      coalesce(member_profile.display_name, owner_profile.email, 'Stock Radar') as owner_name,
      (select pg_catalog.count(*) from public.live_room_memberships as membership
        where membership.room_id = room.id) as member_count,
      (
        (select pg_catalog.count(distinct presence.member_user_id)
          from public.live_room_member_presence as presence
          where presence.room_id = room.id
            and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes')
        +
        (select pg_catalog.count(*)
          from public.live_room_guest_presence as presence
          where presence.room_id = room.id
            and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes')
      ) as online_count,
      (select pg_catalog.count(*) from public.live_room_messages as message
        where message.room_id = room.id) as message_count,
      (select pg_catalog.count(*) from public.live_room_posts as post
        where post.room_id = room.id) as post_count,
      (
        (select pg_catalog.count(*)
          from public.live_room_message_reports as report
          join public.live_room_messages as message on message.id = report.message_id
          where message.room_id = room.id)
        +
        (select pg_catalog.count(*)
          from public.live_room_post_reports as report
          join public.live_room_posts as post on post.id = report.post_id
          where post.room_id = room.id)
        +
        (select pg_catalog.count(*)
          from public.live_room_post_comment_reports as report
          join public.live_room_post_comments as comment on comment.id = report.comment_id
          join public.live_room_posts as post on post.id = comment.post_id
          where post.room_id = room.id)
      ) as report_count,
      greatest(
        room.updated_at,
        coalesce(community.last_activity_at, '-infinity'::timestamptz),
        coalesce(
          (select pg_catalog.max(message.created_at)
            from public.live_room_messages as message
            where message.room_id = room.id),
          '-infinity'::timestamptz
        ),
        coalesce(
          (select pg_catalog.max(post.created_at)
            from public.live_room_posts as post
            where post.room_id = room.id),
          '-infinity'::timestamptz
        )
      ) as last_activity_at
    from public.live_room_rooms as room
    left join public.live_room_community_rooms as community
      on community.room_id = room.id
    left join public.live_room_member_profiles as member_profile
      on member_profile.user_id = community.owner_user_id
    left join public.user_profiles as owner_profile
      on owner_profile.id = community.owner_user_id
    where (p_kind is null or room.room_kind = p_kind)
      and (p_status is null or room.admin_status = p_status)
      and (
        v_search = ''
        or room.ticker ilike '%' || v_search || '%'
        or community.name ilike '%' || v_search || '%'
        or community.slug ilike '%' || v_search || '%'
      )
    order by last_activity_at desc
    limit v_limit
  ) as item;

  return v_result;
end
$function$;

create or replace function public.admin_get_live_room_detail(
  p_actor_user_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_summary jsonb;
  v_messages jsonb;
  v_posts jsonb;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'operations', 'moderator']
  );
  if v_actor_role is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED';
  end if;

  select pg_catalog.jsonb_build_object(
    'id', room.id,
    'kind', room.room_kind,
    'ticker', room.ticker,
    'status', room.admin_status,
    'statusReason', room.admin_status_reason,
    'statusUpdatedAt', room.admin_status_updated_at,
    'slug', community.slug,
    'name', coalesce(community.name, room.ticker || ' Live Room'),
    'summary', community.summary,
    'ownerUserId', community.owner_user_id,
    'ownerName', coalesce(member_profile.display_name, owner_profile.email, 'Stock Radar'),
    'memberCount', (select pg_catalog.count(*) from public.live_room_memberships as membership where membership.room_id = room.id),
    'onlineCount', (
      (select pg_catalog.count(distinct presence.member_user_id)
        from public.live_room_member_presence as presence
        where presence.room_id = room.id
          and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes')
      +
      (select pg_catalog.count(*)
        from public.live_room_guest_presence as presence
        where presence.room_id = room.id
          and presence.last_seen_at >= pg_catalog.now() - interval '2 minutes')
    ),
    'messageCount', (select pg_catalog.count(*) from public.live_room_messages as message where message.room_id = room.id),
    'postCount', (select pg_catalog.count(*) from public.live_room_posts as post where post.room_id = room.id),
    'reportCount', (
      (select pg_catalog.count(*) from public.live_room_message_reports as report
        join public.live_room_messages as message on message.id = report.message_id
        where message.room_id = room.id)
      +
      (select pg_catalog.count(*) from public.live_room_post_reports as report
        join public.live_room_posts as post on post.id = report.post_id
        where post.room_id = room.id)
      +
      (select pg_catalog.count(*) from public.live_room_post_comment_reports as report
        join public.live_room_post_comments as comment on comment.id = report.comment_id
        join public.live_room_posts as post on post.id = comment.post_id
        where post.room_id = room.id)
    ),
    'hiddenMessageCount', (select pg_catalog.count(*) from public.live_room_messages as message
      where message.room_id = room.id and message.visibility_status = 'hidden'),
    'hiddenPostCount', (select pg_catalog.count(*) from public.live_room_posts as post
      where post.room_id = room.id and post.visibility_status = 'hidden'),
    'createdAt', room.created_at,
    'lastActivityAt', greatest(
      room.updated_at,
      coalesce(community.last_activity_at, '-infinity'::timestamptz),
      coalesce((select pg_catalog.max(message.created_at) from public.live_room_messages as message where message.room_id = room.id), '-infinity'::timestamptz),
      coalesce((select pg_catalog.max(post.created_at) from public.live_room_posts as post where post.room_id = room.id), '-infinity'::timestamptz)
    )
  )
  into v_summary
  from public.live_room_rooms as room
  left join public.live_room_community_rooms as community on community.room_id = room.id
  left join public.live_room_member_profiles as member_profile on member_profile.user_id = community.owner_user_id
  left join public.user_profiles as owner_profile on owner_profile.id = community.owner_user_id
  where room.id = p_room_id;

  if v_summary is null then
    raise exception 'ADMIN_ROOM_NOT_FOUND';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(message_item) order by message_item.created_at desc),
    '[]'::jsonb
  )
  into v_messages
  from (
    select
      message.id,
      message.author_display_name,
      message.author_kind,
      message.author_plan,
      message.body,
      message.visibility_status,
      message.moderation_reason,
      message.created_at
    from public.live_room_messages as message
    where message.room_id = p_room_id
      and message.visibility_status <> 'deleted'
    order by message.created_at desc
    limit 20
  ) as message_item;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(post_item) order by post_item.created_at desc),
    '[]'::jsonb
  )
  into v_posts
  from (
    select
      post.id,
      coalesce(profile.display_name, 'Member') as author_display_name,
      post.title,
      pg_catalog.left(post.body, 600) as body,
      post.visibility_status,
      post.moderation_reason,
      post.created_at
    from public.live_room_posts as post
    left join public.live_room_member_profiles as profile
      on profile.user_id = post.author_user_id
    where post.room_id = p_room_id
      and post.visibility_status <> 'deleted'
    order by post.created_at desc
    limit 20
  ) as post_item;

  return pg_catalog.jsonb_build_object(
    'summary', v_summary,
    'messages', v_messages,
    'posts', v_posts
  );
end
$function$;

revoke all on function private.assert_live_room_writable(uuid)
  from public, anon, authenticated;
revoke all on function private.enforce_live_room_writable()
  from public, anon, authenticated;
grant execute on function private.assert_live_room_writable(uuid) to service_role;
grant execute on function private.enforce_live_room_writable() to service_role;

revoke all on function public.admin_record_source_run_audit(
  uuid, text, text, boolean, integer, jsonb, text
) from public, anon, authenticated;
revoke all on function public.admin_set_live_room_status(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_list_live_rooms(
  uuid, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.admin_get_live_room_detail(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_record_source_run_audit(
  uuid, text, text, boolean, integer, jsonb, text
) to service_role;
grant execute on function public.admin_set_live_room_status(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.admin_list_live_rooms(
  uuid, text, text, text, integer
) to service_role;
grant execute on function public.admin_get_live_room_detail(uuid, uuid)
  to service_role;

commit;
