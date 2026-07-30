begin;

create table public.user_community_status (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'temporarily_suspended', 'permanently_suspended')),
  suspended_until timestamptz,
  reason text,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint user_community_status_suspension_shape check (
    (status = 'active' and suspended_until is null)
    or (status = 'temporarily_suspended' and suspended_until is not null)
    or (status = 'permanently_suspended' and suspended_until is null)
  ),
  constraint user_community_status_reason_check check (
    reason is null or char_length(reason) between 4 and 2000
  )
);

comment on table public.user_community_status is
  'Service-only effective community access state. Authentication account state is intentionally separate.';

create index user_community_status_active_suspension_idx
  on public.user_community_status (status, suspended_until)
  where status <> 'active';

create table public.user_community_enforcement_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_role text not null
    check (actor_role in ('super_admin', 'moderator')),
  action text not null
    check (action in ('warning', 'temporary_suspend', 'permanent_suspend', 'unsuspend')),
  reason text not null check (char_length(reason) between 4 and 2000),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_community_enforcement_expiry_check check (
    (action = 'temporary_suspend' and expires_at is not null)
    or (action <> 'temporary_suspend' and expires_at is null)
  )
);

comment on table public.user_community_enforcement_actions is
  'Append-only administrator warnings and community suspension history.';

create index user_community_enforcement_user_created_idx
  on public.user_community_enforcement_actions (user_id, created_at desc);

create table public.admin_moderation_cases (
  id uuid primary key default gen_random_uuid(),
  report_type text not null
    check (report_type in ('message', 'post', 'comment', 'direct_message')),
  report_id uuid not null,
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  severity text not null default 'normal'
    check (severity in ('low', 'normal', 'high', 'critical')),
  assigned_to uuid references public.user_profiles(id) on delete set null,
  target_type text not null
    check (
      target_type in (
        'live_room_message',
        'live_room_post',
        'live_room_post_comment',
        'live_room_direct_message'
      )
    ),
  target_id uuid not null,
  target_snapshot jsonb not null,
  resolution_action text,
  resolution_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint admin_moderation_cases_report_key unique (report_type, report_id),
  constraint admin_moderation_cases_resolution_check check (
    (status in ('open', 'in_review') and resolved_at is null)
    or (status in ('resolved', 'dismissed') and resolved_at is not null)
  ),
  constraint admin_moderation_cases_reason_check check (
    resolution_reason is null or char_length(resolution_reason) between 4 and 2000
  )
);

comment on table public.admin_moderation_cases is
  'Unified workflow metadata layered over immutable raw Live Room report evidence.';

create index admin_moderation_cases_queue_idx
  on public.admin_moderation_cases (status, severity, created_at desc);
create index admin_moderation_cases_assignee_idx
  on public.admin_moderation_cases (assigned_to, status, created_at desc)
  where assigned_to is not null;
create index admin_moderation_cases_target_idx
  on public.admin_moderation_cases (target_type, target_id, created_at desc);

create table public.admin_moderation_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admin_moderation_cases(id) on delete cascade,
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_role text not null
    check (actor_role in ('super_admin', 'moderator')),
  action text not null check (char_length(action) between 1 and 80),
  reason text not null check (char_length(reason) between 4 and 2000),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_moderation_case_events is
  'Append-only state and enforcement history for a unified moderation case.';

create index admin_moderation_case_events_case_created_idx
  on public.admin_moderation_case_events (case_id, created_at desc);

alter table public.user_community_status enable row level security;
alter table public.user_community_enforcement_actions enable row level security;
alter table public.admin_moderation_cases enable row level security;
alter table public.admin_moderation_case_events enable row level security;

revoke all on table public.user_community_status
  from public, anon, authenticated, service_role;
revoke all on table public.user_community_enforcement_actions
  from public, anon, authenticated, service_role;
revoke all on table public.admin_moderation_cases
  from public, anon, authenticated, service_role;
revoke all on table public.admin_moderation_case_events
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.user_community_status to service_role;
grant select, insert on table public.user_community_enforcement_actions to service_role;
grant select, insert, update on table public.admin_moderation_cases to service_role;
grant select, insert on table public.admin_moderation_case_events to service_role;

create function private.admin_actor_role(
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns text
language sql
stable
security invoker
set search_path = ''
as $function$
  select assignment.role
  from public.admin_role_assignments as assignment
  where assignment.user_id = p_actor_user_id
    and assignment.active = true
    and assignment.role = any (p_allowed_roles)
  order by case assignment.role
    when 'super_admin' then 1
    when 'operations' then 2
    when 'moderator' then 3
    when 'verification_reviewer' then 4
    when 'support' then 5
    when 'billing' then 6
    else 100
  end
  limit 1
$function$;

create function private.create_admin_moderation_case()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_report_type text;
  v_target_type text;
  v_target_id uuid;
  v_severity text := 'normal';
  v_snapshot jsonb;
begin
  if tg_table_name = 'live_room_message_reports' then
    v_report_type := 'message';
    v_target_type := 'live_room_message';
    v_target_id := new.message_id;
    select jsonb_build_object(
      'author_user_id', message.member_user_id,
      'author_display_name', message.author_display_name,
      'body', message.body,
      'created_at', message.created_at,
      'room_id', message.room_id,
      'visibility_status', message.visibility_status
    )
    into v_snapshot
    from public.live_room_messages as message
    where message.id = new.message_id;
  elsif tg_table_name = 'live_room_post_reports' then
    v_report_type := 'post';
    v_target_type := 'live_room_post';
    v_target_id := new.post_id;
    select jsonb_build_object(
      'author_user_id', post.author_user_id,
      'body', post.body,
      'created_at', post.created_at,
      'room_id', post.room_id,
      'title', post.title,
      'visibility_status', post.visibility_status
    )
    into v_snapshot
    from public.live_room_posts as post
    where post.id = new.post_id;
  elsif tg_table_name = 'live_room_post_comment_reports' then
    v_report_type := 'comment';
    v_target_type := 'live_room_post_comment';
    v_target_id := new.comment_id;
    select jsonb_build_object(
      'author_user_id', comment.author_user_id,
      'body', comment.body,
      'created_at', comment.created_at,
      'post_id', comment.post_id,
      'visibility_status', comment.visibility_status
    )
    into v_snapshot
    from public.live_room_post_comments as comment
    where comment.id = new.comment_id;
  elsif tg_table_name = 'live_room_direct_message_reports' then
    v_report_type := 'direct_message';
    v_target_type := 'live_room_direct_message';
    v_target_id := new.message_id;
    v_severity := case
      when new.priority >= 150 then 'critical'
      when new.priority >= 100 then 'high'
      when new.priority < 40 then 'low'
      else 'normal'
    end;
    select jsonb_build_object(
      'author_user_id', message.sender_user_id,
      'body', message.body,
      'conversation_id', message.conversation_id,
      'created_at', message.created_at,
      'message_kind', message.message_kind,
      'risk_flags', message.risk_flags,
      'risk_score', message.risk_score
    )
    into v_snapshot
    from public.live_room_direct_messages as message
    where message.id = new.message_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'ADMIN_MODERATION_REPORT_SOURCE_UNSUPPORTED';
  end if;

  if v_snapshot is null then
    v_snapshot := jsonb_build_object(
      'evidence_missing', true,
      'target_id', v_target_id
    );
  end if;

  insert into public.admin_moderation_cases (
    report_type,
    report_id,
    severity,
    target_type,
    target_id,
    target_snapshot,
    created_at,
    updated_at
  )
  values (
    v_report_type,
    new.id,
    v_severity,
    v_target_type,
    v_target_id,
    v_snapshot,
    new.created_at,
    new.created_at
  )
  on conflict (report_type, report_id) do nothing;

  return new;
end
$function$;

create trigger live_room_message_reports_create_admin_case
after insert on public.live_room_message_reports
for each row execute function private.create_admin_moderation_case();

create trigger live_room_post_reports_create_admin_case
after insert on public.live_room_post_reports
for each row execute function private.create_admin_moderation_case();

create trigger live_room_post_comment_reports_create_admin_case
after insert on public.live_room_post_comment_reports
for each row execute function private.create_admin_moderation_case();

create trigger live_room_direct_message_reports_create_admin_case
after insert on public.live_room_direct_message_reports
for each row execute function private.create_admin_moderation_case();

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'message',
  report.id,
  'normal',
  'live_room_message',
  report.message_id,
  jsonb_build_object(
    'author_user_id', message.member_user_id,
    'author_display_name', message.author_display_name,
    'body', message.body,
    'created_at', message.created_at,
    'room_id', message.room_id,
    'visibility_status', message.visibility_status
  ),
  report.created_at,
  report.created_at
from public.live_room_message_reports as report
join public.live_room_messages as message on message.id = report.message_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'post',
  report.id,
  'normal',
  'live_room_post',
  report.post_id,
  jsonb_build_object(
    'author_user_id', post.author_user_id,
    'body', post.body,
    'created_at', post.created_at,
    'room_id', post.room_id,
    'title', post.title,
    'visibility_status', post.visibility_status
  ),
  report.created_at,
  report.created_at
from public.live_room_post_reports as report
join public.live_room_posts as post on post.id = report.post_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'comment',
  report.id,
  'normal',
  'live_room_post_comment',
  report.comment_id,
  jsonb_build_object(
    'author_user_id', comment.author_user_id,
    'body', comment.body,
    'created_at', comment.created_at,
    'post_id', comment.post_id,
    'visibility_status', comment.visibility_status
  ),
  report.created_at,
  report.created_at
from public.live_room_post_comment_reports as report
join public.live_room_post_comments as comment on comment.id = report.comment_id
on conflict (report_type, report_id) do nothing;

insert into public.admin_moderation_cases (
  report_type,
  report_id,
  severity,
  target_type,
  target_id,
  target_snapshot,
  created_at,
  updated_at
)
select
  'direct_message',
  report.id,
  case
    when report.priority >= 150 then 'critical'
    when report.priority >= 100 then 'high'
    when report.priority < 40 then 'low'
    else 'normal'
  end,
  'live_room_direct_message',
  report.message_id,
  jsonb_build_object(
    'author_user_id', message.sender_user_id,
    'body', message.body,
    'conversation_id', message.conversation_id,
    'created_at', message.created_at,
    'message_kind', message.message_kind,
    'risk_flags', message.risk_flags,
    'risk_score', message.risk_score
  ),
  report.created_at,
  report.created_at
from public.live_room_direct_message_reports as report
join public.live_room_direct_messages as message on message.id = report.message_id
on conflict (report_type, report_id) do nothing;

create function public.admin_apply_user_community_action(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns public.user_community_status
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before public.user_community_status;
  v_after public.user_community_status;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'moderator']
  );
  if v_actor_role is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_MODERATOR_REQUIRED';
  end if;
  if p_target_user_id is null
    or not exists (
      select 1 from public.user_profiles as profile
      where profile.id = p_target_user_id
    )
  then
    raise exception using errcode = 'P0001', message = 'ADMIN_USER_NOT_FOUND';
  end if;
  if p_target_user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'ADMIN_SELF_ENFORCEMENT_FORBIDDEN';
  end if;
  if char_length(v_reason) < 4 or char_length(v_reason) > 2000 then
    raise exception using errcode = 'P0001', message = 'ADMIN_REASON_REQUIRED';
  end if;
  if p_action not in ('warning', 'temporary_suspend', 'permanent_suspend', 'unsuspend') then
    raise exception using errcode = 'P0001', message = 'ADMIN_COMMUNITY_ACTION_INVALID';
  end if;
  if p_action = 'temporary_suspend'
    and (
      p_expires_at is null
      or p_expires_at <= now()
      or p_expires_at > now() + interval '365 days'
    )
  then
    raise exception using errcode = 'P0001', message = 'ADMIN_SUSPENSION_EXPIRY_INVALID';
  end if;
  if p_action <> 'temporary_suspend' and p_expires_at is not null then
    raise exception using errcode = 'P0001', message = 'ADMIN_SUSPENSION_EXPIRY_INVALID';
  end if;

  insert into public.user_community_status (user_id)
  values (p_target_user_id)
  on conflict (user_id) do nothing;

  select status.*
  into v_before
  from public.user_community_status as status
  where status.user_id = p_target_user_id
  for update;

  if p_action = 'warning' then
    v_after := v_before;
  else
    update public.user_community_status
    set
      status = case p_action
        when 'temporary_suspend' then 'temporarily_suspended'
        when 'permanent_suspend' then 'permanently_suspended'
        else 'active'
      end,
      suspended_until = case
        when p_action = 'temporary_suspend' then p_expires_at
        else null
      end,
      reason = case when p_action = 'unsuspend' then null else v_reason end,
      updated_by = p_actor_user_id,
      updated_at = now()
    where user_id = p_target_user_id
    returning * into v_after;
  end if;

  insert into public.user_community_enforcement_actions (
    user_id,
    actor_user_id,
    actor_role,
    action,
    reason,
    expires_at
  )
  values (
    p_target_user_id,
    p_actor_user_id,
    v_actor_role,
    p_action,
    v_reason,
    case when p_action = 'temporary_suspend' then p_expires_at else null end
  );

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    p_actor_user_id,
    v_actor_role,
    'community.' || p_action,
    'user',
    p_target_user_id::text,
    v_reason,
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  return v_after;
end
$function$;

create function public.admin_set_role_assignment(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_active boolean,
  p_reason text
)
returns public.admin_role_assignments
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before public.admin_role_assignments;
  v_after public.admin_role_assignments;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin']
  );
  if v_actor_role is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_SUPER_ADMIN_REQUIRED';
  end if;
  if p_target_user_id is null
    or not exists (
      select 1 from public.user_profiles as profile
      where profile.id = p_target_user_id
    )
  then
    raise exception using errcode = 'P0001', message = 'ADMIN_USER_NOT_FOUND';
  end if;
  if p_target_user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'ADMIN_SELF_ROLE_CHANGE_FORBIDDEN';
  end if;
  if p_role not in (
    'super_admin',
    'operations',
    'moderator',
    'verification_reviewer',
    'support',
    'billing'
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_ROLE_INVALID';
  end if;
  if p_active is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_ROLE_STATE_REQUIRED';
  end if;
  if char_length(v_reason) < 4 or char_length(v_reason) > 2000 then
    raise exception using errcode = 'P0001', message = 'ADMIN_REASON_REQUIRED';
  end if;

  select assignment.*
  into v_before
  from public.admin_role_assignments as assignment
  where assignment.user_id = p_target_user_id
    and assignment.role = p_role
  for update;

  if p_role = 'super_admin'
    and p_active = false
    and v_before.active = true
    and (
      select count(*)
      from public.admin_role_assignments as assignment
      where assignment.role = 'super_admin'
        and assignment.active = true
        and assignment.user_id <> p_target_user_id
    ) = 0
  then
    raise exception using errcode = 'P0001', message = 'ADMIN_LAST_SUPER_ADMIN_REQUIRED';
  end if;

  insert into public.admin_role_assignments (
    user_id,
    role,
    active,
    granted_by,
    created_at,
    updated_at
  )
  values (
    p_target_user_id,
    p_role,
    p_active,
    p_actor_user_id,
    now(),
    now()
  )
  on conflict (user_id, role) do update
  set
    active = excluded.active,
    granted_by = excluded.granted_by,
    updated_at = now()
  returning * into v_after;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    p_actor_user_id,
    v_actor_role,
    case when p_active then 'admin_role.grant' else 'admin_role.revoke' end,
    'admin_role_assignment',
    p_target_user_id::text || ':' || p_role,
    v_reason,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );

  return v_after;
end
$function$;

create function public.admin_update_moderation_case(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_action text,
  p_reason text,
  p_status text default null,
  p_severity text default null,
  p_assigned_to uuid default null,
  p_suspend_until timestamptz default null
)
returns public.admin_moderation_cases
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_case public.admin_moderation_cases;
  v_before public.admin_moderation_cases;
  v_author_user_id uuid;
  v_visibility text;
begin
  v_actor_role := private.admin_actor_role(
    p_actor_user_id,
    array['super_admin', 'moderator']
  );
  if v_actor_role is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_MODERATOR_REQUIRED';
  end if;
  if char_length(v_reason) < 4 or char_length(v_reason) > 2000 then
    raise exception using errcode = 'P0001', message = 'ADMIN_REASON_REQUIRED';
  end if;

  select moderation_case.*
  into v_case
  from public.admin_moderation_cases as moderation_case
  where moderation_case.id = p_case_id
  for update;
  if v_case.id is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_MODERATION_CASE_NOT_FOUND';
  end if;
  v_before := v_case;

  if p_assigned_to is not null
    and private.admin_actor_role(
      p_assigned_to,
      array['super_admin', 'moderator']
    ) is null
  then
    raise exception using errcode = 'P0001', message = 'ADMIN_ASSIGNEE_INVALID';
  end if;

  if p_action = 'triage' then
    if p_status is null
      or p_status not in ('open', 'in_review')
      or p_severity is null
      or p_severity not in ('low', 'normal', 'high', 'critical')
    then
      raise exception using errcode = 'P0001', message = 'ADMIN_TRIAGE_INVALID';
    end if;
    update public.admin_moderation_cases
    set
      status = p_status,
      severity = p_severity,
      assigned_to = p_assigned_to,
      resolution_action = null,
      resolution_reason = null,
      resolved_at = null,
      updated_at = now()
    where id = p_case_id
    returning * into v_case;
  elsif p_action = 'dismiss' then
    update public.admin_moderation_cases
    set
      status = 'dismissed',
      assigned_to = coalesce(p_assigned_to, p_actor_user_id),
      resolution_action = p_action,
      resolution_reason = v_reason,
      resolved_at = now(),
      updated_at = now()
    where id = p_case_id
    returning * into v_case;
  elsif p_action in ('hide_content', 'restore_content') then
    if v_case.target_type = 'live_room_message' then
      update public.live_room_messages
      set
        visibility_status = case
          when p_action = 'hide_content' then 'hidden'
          else 'visible'
        end,
        moderation_reason = case
          when p_action = 'hide_content' then left(v_reason, 240)
          else null
        end,
        hidden_at = case
          when p_action = 'hide_content' then now()
          else null
        end,
        updated_at = now()
      where id = v_case.target_id
        and visibility_status <> 'deleted'
      returning visibility_status into v_visibility;
    elsif v_case.target_type = 'live_room_post' then
      update public.live_room_posts
      set
        visibility_status = case
          when p_action = 'hide_content' then 'hidden'
          else 'visible'
        end,
        moderation_reason = case
          when p_action = 'hide_content' then left(v_reason, 240)
          else null
        end,
        hidden_at = case
          when p_action = 'hide_content' then now()
          else null
        end,
        updated_at = now()
      where id = v_case.target_id
        and visibility_status <> 'deleted'
      returning visibility_status into v_visibility;
    elsif v_case.target_type = 'live_room_post_comment' then
      update public.live_room_post_comments
      set
        visibility_status = case
          when p_action = 'hide_content' then 'hidden'
          else 'visible'
        end,
        updated_at = now()
      where id = v_case.target_id
        and visibility_status <> 'deleted'
      returning visibility_status into v_visibility;
    else
      raise exception using
        errcode = 'P0001',
        message = 'ADMIN_DIRECT_MESSAGE_VISIBILITY_UNSUPPORTED';
    end if;
    if v_visibility is null then
      raise exception using errcode = 'P0001', message = 'ADMIN_MODERATION_TARGET_NOT_MUTABLE';
    end if;
    update public.admin_moderation_cases
    set
      status = 'resolved',
      assigned_to = coalesce(p_assigned_to, p_actor_user_id),
      resolution_action = p_action,
      resolution_reason = v_reason,
      resolved_at = now(),
      updated_at = now()
    where id = p_case_id
    returning * into v_case;
  elsif p_action in ('warn_user', 'temporary_suspend', 'permanent_suspend') then
    if coalesce(v_case.target_snapshot->>'author_user_id', '') = '' then
      raise exception using errcode = 'P0001', message = 'ADMIN_MODERATION_MEMBER_TARGET_REQUIRED';
    end if;
    v_author_user_id := (v_case.target_snapshot->>'author_user_id')::uuid;
    perform public.admin_apply_user_community_action(
      p_actor_user_id,
      v_author_user_id,
      case p_action
        when 'warn_user' then 'warning'
        else p_action
      end,
      v_reason,
      case when p_action = 'temporary_suspend' then p_suspend_until else null end
    );
    update public.admin_moderation_cases
    set
      status = 'resolved',
      assigned_to = coalesce(p_assigned_to, p_actor_user_id),
      resolution_action = p_action,
      resolution_reason = v_reason,
      resolved_at = now(),
      updated_at = now()
    where id = p_case_id
    returning * into v_case;
  else
    raise exception using errcode = 'P0001', message = 'ADMIN_MODERATION_ACTION_INVALID';
  end if;

  insert into public.admin_moderation_case_events (
    case_id,
    actor_user_id,
    actor_role,
    action,
    reason,
    before_data,
    after_data
  )
  values (
    p_case_id,
    p_actor_user_id,
    v_actor_role,
    p_action,
    v_reason,
    to_jsonb(v_before),
    to_jsonb(v_case)
  );

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    p_actor_user_id,
    v_actor_role,
    'moderation.' || p_action,
    'admin_moderation_case',
    p_case_id::text,
    v_reason,
    to_jsonb(v_before),
    to_jsonb(v_case)
  );

  return v_case;
end
$function$;

create function private.assert_user_community_write_allowed(
  p_user_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_status public.user_community_status;
begin
  if p_user_id is null then
    return;
  end if;
  select status.*
  into v_status
  from public.user_community_status as status
  where status.user_id = p_user_id;
  if v_status.status = 'permanently_suspended'
    or (
      v_status.status = 'temporarily_suspended'
      and v_status.suspended_until > now()
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMUNITY_ACCESS_SUSPENDED';
  end if;
end
$function$;

create function private.enforce_user_community_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  if tg_table_name = 'live_room_messages' then
    v_user_id := new.member_user_id;
  elsif tg_table_name = 'live_room_posts' then
    v_user_id := new.author_user_id;
  elsif tg_table_name = 'live_room_post_comments' then
    v_user_id := new.author_user_id;
  elsif tg_table_name = 'live_room_direct_messages' then
    v_user_id := new.sender_user_id;
  elsif tg_table_name = 'live_room_community_rooms' then
    v_user_id := new.owner_user_id;
  end if;
  perform private.assert_user_community_write_allowed(v_user_id);
  return new;
end
$function$;

create trigger live_room_messages_enforce_community_access
before insert or update of body on public.live_room_messages
for each row execute function private.enforce_user_community_write();

create trigger live_room_posts_enforce_community_access
before insert or update of title, body on public.live_room_posts
for each row execute function private.enforce_user_community_write();

create trigger live_room_post_comments_enforce_community_access
before insert or update of body on public.live_room_post_comments
for each row execute function private.enforce_user_community_write();

create trigger live_room_direct_messages_enforce_community_access
before insert on public.live_room_direct_messages
for each row execute function private.enforce_user_community_write();

create trigger live_room_community_rooms_enforce_community_access
before insert or update of name, summary on public.live_room_community_rooms
for each row execute function private.enforce_user_community_write();

revoke all on function private.admin_actor_role(uuid, text[])
  from public, anon, authenticated;
revoke all on function private.create_admin_moderation_case()
  from public, anon, authenticated;
revoke all on function private.assert_user_community_write_allowed(uuid)
  from public, anon, authenticated;
revoke all on function private.enforce_user_community_write()
  from public, anon, authenticated;

grant execute on function private.admin_actor_role(uuid, text[]) to service_role;
grant execute on function private.create_admin_moderation_case() to service_role;
grant execute on function private.assert_user_community_write_allowed(uuid) to service_role;
grant execute on function private.enforce_user_community_write() to service_role;

revoke all on function public.admin_apply_user_community_action(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_role_assignment(
  uuid, uuid, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.admin_update_moderation_case(
  uuid, uuid, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.admin_apply_user_community_action(
  uuid, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.admin_set_role_assignment(
  uuid, uuid, text, boolean, text
) to service_role;
grant execute on function public.admin_update_moderation_case(
  uuid, uuid, text, text, text, text, uuid, timestamptz
) to service_role;

commit;
