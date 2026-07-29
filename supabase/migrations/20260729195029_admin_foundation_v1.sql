create table if not exists public.admin_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  granted_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_role_assignments_role_check check (
    role = any (
      array[
        'super_admin'::text,
        'operations'::text,
        'moderator'::text,
        'verification_reviewer'::text,
        'support'::text,
        'billing'::text
      ]
    )
  ),
  constraint admin_role_assignments_user_role_key unique (user_id, role)
);

comment on table public.admin_role_assignments is
  'Service-only admin RBAC assignments. Browser metadata must never be used for authorization.';

create index if not exists admin_role_assignments_active_user_idx
  on public.admin_role_assignments (user_id, role)
  where active = true;

create index if not exists admin_role_assignments_active_role_idx
  on public.admin_role_assignments (role, user_id)
  where active = true;

create trigger admin_role_assignments_set_updated_at
  before update on public.admin_role_assignments
  for each row execute function private.set_live_room_updated_at();

alter table public.admin_role_assignments enable row level security;
revoke all on table public.admin_role_assignments
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.admin_role_assignments to service_role;

insert into public.admin_role_assignments (
  user_id,
  role,
  active,
  granted_by,
  created_at,
  updated_at
)
select
  moderator.user_id,
  'super_admin',
  true,
  null,
  moderator.created_at,
  now()
from public.live_room_moderators as moderator
where moderator.role = 'admin'
  and moderator.active = true
on conflict (user_id, role) do update
set
  active = true,
  updated_at = now();

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.user_profiles(id) on delete set null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  ip_address inet,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_actor_role_check check (
    actor_role = any (
      array[
        'super_admin'::text,
        'operations'::text,
        'moderator'::text,
        'verification_reviewer'::text,
        'support'::text,
        'billing'::text
      ]
    )
  ),
  constraint admin_audit_logs_action_check check (
    char_length(action) between 1 and 120
  ),
  constraint admin_audit_logs_target_type_check check (
    char_length(target_type) between 1 and 120
  ),
  constraint admin_audit_logs_target_id_check check (
    target_id is null or char_length(target_id) <= 240
  ),
  constraint admin_audit_logs_reason_check check (
    reason is null or char_length(reason) <= 2000
  ),
  constraint admin_audit_logs_request_id_check check (
    request_id is null or char_length(request_id) <= 240
  )
);

comment on table public.admin_audit_logs is
  'Append-only service-written audit history for administrator actions.';

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_actor_created_at_idx
  on public.admin_audit_logs (actor_user_id, created_at desc);

create index if not exists admin_audit_logs_target_created_at_idx
  on public.admin_audit_logs (target_type, target_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_audit_logs
  from public, anon, authenticated, service_role;
grant select, insert on table public.admin_audit_logs to service_role;

create or replace function public.list_live_room_social_verification_reviews(
  p_admin_user_id uuid,
  p_cursor_submitted_at timestamptz default null,
  p_cursor_public_request_id uuid default null,
  p_limit integer default 25
)
returns table (
  public_request_id uuid,
  platform text,
  normalized_handle text,
  profile_url text,
  proof_code text,
  proof_url text,
  status text,
  submitted_at timestamptz,
  expires_at timestamptz,
  applicant_display_name text,
  applicant_emoji text
)
language plpgsql
set search_path to ''
as $$
begin
  if not exists (
    select 1
    from public.admin_role_assignments as assignment
    where assignment.user_id = p_admin_user_id
      and assignment.active = true
      and assignment.role in ('super_admin', 'verification_reviewer')
  ) and not exists (
    select 1
    from public.live_room_moderators as moderator
    where moderator.user_id = p_admin_user_id
      and moderator.active = true
      and moderator.role = 'admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ADMIN_REQUIRED';
  end if;

  return query
  select
    request.public_request_id,
    request.platform,
    request.normalized_handle,
    request.profile_url,
    request.proof_code,
    request.proof_url,
    request.status,
    request.submitted_at,
    request.expires_at,
    profile.display_name,
    profile.emoji
  from public.live_room_social_verifications as request
  join public.live_room_member_profiles as profile
    on profile.user_id = request.member_user_id
  where request.status = 'pending_review'
    and request.expires_at > pg_catalog.now()
    and (
      p_cursor_submitted_at is null
      or (request.submitted_at, request.public_request_id)
        > (p_cursor_submitted_at, p_cursor_public_request_id)
    )
  order by request.submitted_at asc, request.public_request_id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50);
end
$$;

revoke all on function public.list_live_room_social_verification_reviews(
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.list_live_room_social_verification_reviews(
  uuid,
  timestamptz,
  uuid,
  integer
) to service_role;

create or replace function public.review_live_room_social_verification(
  p_admin_user_id uuid,
  p_public_request_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.live_room_social_verifications
language plpgsql
set search_path to ''
as $$
declare
  v_request public.live_room_social_verifications;
  v_result public.live_room_social_verifications;
  v_actor_role text;
  v_note text := pg_catalog.left(
    pg_catalog.btrim(coalesce(p_review_note, '')),
    240
  );
  v_now timestamptz := pg_catalog.now();
begin
  select assignment.role
  into v_actor_role
  from public.admin_role_assignments as assignment
  where assignment.user_id = p_admin_user_id
    and assignment.active = true
    and assignment.role in ('super_admin', 'verification_reviewer')
  order by case assignment.role
    when 'super_admin' then 1
    else 2
  end
  limit 1;

  if v_actor_role is null and exists (
    select 1
    from public.live_room_moderators as moderator
    where moderator.user_id = p_admin_user_id
      and moderator.active = true
      and moderator.role = 'admin'
  ) then
    v_actor_role := 'super_admin';
  end if;

  if v_actor_role is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ADMIN_REQUIRED';
  end if;

  select request.*
  into v_request
  from public.live_room_social_verifications as request
  where request.public_request_id = p_public_request_id
  for update;

  if v_request.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_NOT_FOUND';
  end if;

  if v_request.status <> 'pending_review' then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ALREADY_REVIEWED';
  end if;

  if v_request.expires_at <= v_now then
    update public.live_room_social_verifications
    set status = 'expired', updated_at = v_now
    where id = v_request.id;
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_EXPIRED';
  end if;

  if p_decision = 'approve' then
    update public.live_room_social_verifications
    set
      status = 'verified',
      reviewed_by = p_admin_user_id,
      reviewed_at = v_now,
      review_note = null,
      expires_at = null,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_decision = 'reject' then
    if v_note = '' then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_REVIEW_NOTE_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      status = 'rejected',
      reviewed_by = p_admin_user_id,
      reviewed_at = v_now,
      review_note = v_note,
      show_on_profile = false,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_DECISION';
  end if;

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
    p_admin_user_id,
    v_actor_role,
    'creator_verification.' || p_decision,
    'live_room_social_verification',
    p_public_request_id::text,
    nullif(v_note, ''),
    pg_catalog.to_jsonb(v_request),
    pg_catalog.to_jsonb(v_result)
  );

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_HANDLE_CONFLICT';
end
$$;

revoke all on function public.review_live_room_social_verification(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.review_live_room_social_verification(
  uuid,
  uuid,
  text,
  text
) to service_role;
