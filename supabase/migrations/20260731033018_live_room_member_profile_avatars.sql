alter table public.live_room_member_profiles
  add column avatar_path text;

alter table public.live_room_member_profiles
  add constraint live_room_member_profiles_avatar_path_check
  check (
    avatar_path is null
    or avatar_path ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'live-room-member-avatars',
  'live-room-member-avatars',
  true,
  1048576,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.set_live_room_member_avatar_path(
  p_member_user_id uuid,
  p_avatar_path text
)
returns public.live_room_member_profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.live_room_member_profiles;
begin
  select *
  into v_profile
  from public.live_room_member_profiles as profile
  where profile.user_id = p_member_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'LIVE_ROOM_PROFILE_NOT_FOUND';
  end if;

  if p_avatar_path is not null
    and p_avatar_path <> (
      v_profile.public_profile_id::text
      || '/'
      || pg_catalog.split_part(p_avatar_path, '/', 2)
    )
  then
    raise exception using
      errcode = '22023',
      message = 'LIVE_ROOM_INVALID_AVATAR_PATH';
  end if;

  update public.live_room_member_profiles as profile
  set avatar_path = p_avatar_path
  where profile.user_id = p_member_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.set_live_room_member_avatar_path(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_live_room_member_avatar_path(uuid, text)
  to service_role;

revoke all on table public.live_room_member_profiles
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.live_room_member_profiles
  to service_role;

comment on column public.live_room_member_profiles.avatar_path is
  'Service-managed public profile image path. Contains only an opaque public profile id and a random versioned WebP filename.';
comment on function public.set_live_room_member_avatar_path(uuid, text) is
  'Service-only avatar path setter. The server supplies the authenticated member user id and a path scoped to its opaque public profile id.';
