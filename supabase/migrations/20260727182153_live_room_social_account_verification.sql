begin;

create table public.live_room_social_verifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_request_id uuid not null unique default pg_catalog.gen_random_uuid(),
  member_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  platform text not null
    check (platform in ('x', 'youtube', 'instagram')),
  normalized_handle text not null
    check (
      pg_catalog.char_length(normalized_handle) between 1 and 64
      and normalized_handle = pg_catalog.lower(normalized_handle)
      and normalized_handle ~ '^[a-z0-9._-]+$'
    ),
  profile_url text not null
    check (pg_catalog.char_length(profile_url) between 12 and 500),
  proof_code text not null
    check (proof_code ~ '^SR-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  proof_url text
    check (
      proof_url is null
      or pg_catalog.char_length(proof_url) between 12 and 700
    ),
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'proof_ready',
        'pending_review',
        'verified',
        'rejected',
        'expired',
        'cancelled'
      )
    ),
  show_on_profile boolean not null default true,
  submitted_at timestamptz,
  expires_at timestamptz,
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (
    review_note is null
    or pg_catalog.char_length(review_note) <= 240
  ),
  last_code_issued_at timestamptz not null default pg_catalog.now(),
  code_issue_count integer not null default 1
    check (code_issue_count between 1 and 5),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create unique index live_room_social_verifications_member_platform_active_uidx
  on public.live_room_social_verifications (member_user_id, platform)
  where status in ('draft', 'proof_ready', 'pending_review', 'verified');

create unique index live_room_social_verifications_handle_review_uidx
  on public.live_room_social_verifications (platform, normalized_handle)
  where status in ('pending_review', 'verified');

create unique index live_room_social_verifications_proof_code_uidx
  on public.live_room_social_verifications (proof_code);

create index live_room_social_verifications_member_created_idx
  on public.live_room_social_verifications (
    member_user_id,
    created_at desc,
    id desc
  );

create index live_room_social_verifications_pending_idx
  on public.live_room_social_verifications (
    submitted_at asc,
    id asc
  )
  where status = 'pending_review';

create index live_room_social_verifications_public_badge_idx
  on public.live_room_social_verifications (member_user_id, platform)
  where status = 'verified' and show_on_profile = true;

create or replace function public.create_live_room_social_verification(
  p_member_user_id uuid,
  p_platform text,
  p_normalized_handle text,
  p_profile_url text,
  p_proof_code text
)
returns public.live_room_social_verifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.live_room_social_verifications;
  v_now timestamptz := pg_catalog.now();
  v_recent_count integer;
begin
  if p_member_user_id is null
    or not exists (
      select 1
      from public.user_profiles as profile
      where profile.id = p_member_user_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_MEMBER_REQUIRED';
  end if;

  if p_platform not in ('x', 'youtube', 'instagram') then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_PLATFORM';
  end if;

  update public.live_room_social_verifications
  set
    status = 'expired',
    show_on_profile = false,
    updated_at = v_now
  where member_user_id = p_member_user_id
    and platform = p_platform
    and status in ('draft', 'proof_ready', 'pending_review')
    and expires_at <= v_now;

  if exists (
    select 1
    from public.live_room_social_verifications as request
    where request.member_user_id = p_member_user_id
      and request.platform = p_platform
      and request.status in (
        'draft',
        'proof_ready',
        'pending_review',
        'verified'
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_ACTIVE_REQUEST_EXISTS';
  end if;

  select pg_catalog.count(*)::integer
  into v_recent_count
  from public.live_room_social_verifications as request
  where request.member_user_id = p_member_user_id
    and request.last_code_issued_at > v_now - interval '24 hours';

  if v_recent_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
  end if;

  insert into public.live_room_social_verifications (
    member_user_id,
    platform,
    normalized_handle,
    profile_url,
    proof_code,
    expires_at,
    last_code_issued_at
  )
  values (
    p_member_user_id,
    p_platform,
    p_normalized_handle,
    p_profile_url,
    p_proof_code,
    v_now + interval '24 hours',
    v_now
  )
  returning * into v_result;

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CONFLICT';
end
$$;

create or replace function public.mutate_live_room_social_verification(
  p_member_user_id uuid,
  p_public_request_id uuid,
  p_action text,
  p_proof_url text default null,
  p_proof_code text default null,
  p_show_on_profile boolean default null
)
returns public.live_room_social_verifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.live_room_social_verifications;
  v_result public.live_room_social_verifications;
  v_now timestamptz := pg_catalog.now();
  v_recent_count integer;
begin
  select request.*
  into v_request
  from public.live_room_social_verifications as request
  where request.public_request_id = p_public_request_id
    and request.member_user_id = p_member_user_id
  for update;

  if v_request.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_NOT_FOUND';
  end if;

  if v_request.status in ('draft', 'proof_ready', 'pending_review')
    and v_request.expires_at <= v_now
  then
    update public.live_room_social_verifications
    set status = 'expired', updated_at = v_now
    where id = v_request.id
    returning * into v_request;
  end if;

  if p_action = 'save_proof' then
    if v_request.status not in ('draft', 'proof_ready') then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    if p_proof_url is null then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_PROOF_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      proof_url = p_proof_url,
      status = 'proof_ready',
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'submit_review' then
    if v_request.status <> 'proof_ready'
      or v_request.proof_url is null
    then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_PROOF_REQUIRED';
    end if;
    update public.live_room_social_verifications
    set
      status = 'pending_review',
      submitted_at = v_now,
      review_note = null,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'reissue_code' then
    if v_request.status not in ('draft', 'proof_ready') then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    if v_request.last_code_issued_at > v_now - interval '5 minutes' then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
    end if;
    select pg_catalog.count(*)::integer
    into v_recent_count
    from public.live_room_social_verifications as request
    where request.member_user_id = p_member_user_id
      and request.last_code_issued_at > v_now - interval '24 hours';
    if v_recent_count >= 5
      or v_request.code_issue_count >= 5
      or p_proof_code is null
    then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_CODE_RATE_LIMIT';
    end if;
    update public.live_room_social_verifications
    set
      proof_code = p_proof_code,
      proof_url = null,
      status = 'draft',
      expires_at = v_now + interval '24 hours',
      last_code_issued_at = v_now,
      code_issue_count = code_issue_count + 1,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'set_visibility' then
    if v_request.status <> 'verified' or p_show_on_profile is null then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    update public.live_room_social_verifications
    set
      show_on_profile = p_show_on_profile,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  elsif p_action = 'cancel' then
    if v_request.status not in (
      'draft',
      'proof_ready',
      'pending_review',
      'verified'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'SOCIAL_VERIFICATION_INVALID_TRANSITION';
    end if;
    update public.live_room_social_verifications
    set
      status = 'cancelled',
      show_on_profile = false,
      updated_at = v_now
    where id = v_request.id
    returning * into v_result;
  else
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_INVALID_ACTION';
  end if;

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_CONFLICT';
end
$$;

create or replace function public.review_live_room_social_verification(
  p_admin_user_id uuid,
  p_public_request_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.live_room_social_verifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.live_room_social_verifications;
  v_result public.live_room_social_verifications;
  v_note text := pg_catalog.left(
    pg_catalog.btrim(COALESCE(p_review_note, '')),
    240
  );
  v_now timestamptz := pg_catalog.now();
begin
  if not exists (
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

  return v_result;
exception
  when unique_violation then
    raise exception using
      errcode = 'P0001',
      message = 'SOCIAL_VERIFICATION_HANDLE_CONFLICT';
end
$$;

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
security invoker
set search_path = ''
as $$
begin
  if not exists (
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
  limit LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
end
$$;

create or replace function public.get_live_room_social_badges(
  p_actor_kind text,
  p_member_user_id uuid,
  p_guest_session_id uuid,
  p_message_ids uuid[]
)
returns table (
  message_id uuid,
  platform text,
  profile_url text
)
language sql
security invoker
set search_path = ''
as $$
  select
    message.id as message_id,
    verification.platform,
    verification.profile_url
  from public.live_room_messages as message
  join public.live_room_social_verifications as verification
    on verification.member_user_id = message.member_user_id
  where message.id = any(
      COALESCE(p_message_ids, '{}'::uuid[])
    )
    and pg_catalog.cardinality(
      COALESCE(p_message_ids, '{}'::uuid[])
    ) <= 50
    and message.author_kind = 'member'
    and message.visibility_status = 'visible'
    and verification.status = 'verified'
    and verification.show_on_profile = true
    and verification.expires_at is null
    and not exists (
      select 1
      from public.live_room_actor_blocks as block
      where (
        p_actor_kind = 'member'
        and (
          (
            block.blocker_kind = 'member'
            and block.blocker_member_user_id = p_member_user_id
            and block.blocked_kind = 'member'
            and block.blocked_member_user_id = message.member_user_id
          )
          or (
            block.blocker_kind = 'member'
            and block.blocker_member_user_id = message.member_user_id
            and block.blocked_kind = 'member'
            and block.blocked_member_user_id = p_member_user_id
          )
        )
      )
      or (
        p_actor_kind = 'guest'
        and block.blocker_kind = 'guest'
        and block.blocker_guest_session_id = p_guest_session_id
        and block.blocked_kind = 'member'
        and block.blocked_member_user_id = message.member_user_id
      )
    )
  order by message.id, verification.platform
$$;

alter table public.live_room_social_verifications enable row level security;

revoke all privileges
on table public.live_room_social_verifications
from public, anon, authenticated;

grant select, insert, update
on table public.live_room_social_verifications
to service_role;

revoke all
on function public.create_live_room_social_verification(
  uuid,
  text,
  text,
  text,
  text
)
from public, anon, authenticated;
grant execute
on function public.create_live_room_social_verification(
  uuid,
  text,
  text,
  text,
  text
)
to service_role;

revoke all
on function public.mutate_live_room_social_verification(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean
)
from public, anon, authenticated;
grant execute
on function public.mutate_live_room_social_verification(
  uuid,
  uuid,
  text,
  text,
  text,
  boolean
)
to service_role;

revoke all
on function public.review_live_room_social_verification(
  uuid,
  uuid,
  text,
  text
)
from public, anon, authenticated;
grant execute
on function public.review_live_room_social_verification(
  uuid,
  uuid,
  text,
  text
)
to service_role;

revoke all
on function public.list_live_room_social_verification_reviews(
  uuid,
  timestamptz,
  uuid,
  integer
)
from public, anon, authenticated;
grant execute
on function public.list_live_room_social_verification_reviews(
  uuid,
  timestamptz,
  uuid,
  integer
)
to service_role;

revoke all
on function public.get_live_room_social_badges(
  text,
  uuid,
  uuid,
  uuid[]
)
from public, anon, authenticated;
grant execute
on function public.get_live_room_social_badges(
  text,
  uuid,
  uuid,
  uuid[]
)
to service_role;

comment on table public.live_room_social_verifications is
  'Service-only manual social-account ownership review requests. Verification does not imply investment expertise or endorsement.';

commit;
