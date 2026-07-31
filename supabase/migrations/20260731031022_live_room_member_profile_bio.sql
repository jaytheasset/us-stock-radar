alter table public.live_room_member_profiles
  add column bio text;

alter table public.live_room_member_profiles
  add constraint live_room_member_profiles_bio_check
  check (
    bio is null
    or (
      pg_catalog.char_length(bio) between 1 and 280
      and bio = pg_catalog.btrim(bio, E' \n')
      and pg_catalog.strpos(bio, E'\r') = 0
      and pg_catalog.array_length(
        pg_catalog.string_to_array(bio, E'\n'),
        1
      ) <= 4
      and pg_catalog.regexp_replace(bio, E'\n', '', 'g')
        !~ '[[:cntrl:]]'
      and bio !~ '[<>]'
      and bio !~ E'(^|\n) '
      and bio !~ E' ($|\n)'
    )
  );

create or replace function public.set_live_room_member_profile(
  p_member_user_id uuid,
  p_display_name text,
  p_bio text
)
returns public.live_room_member_profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bio text;
  v_profile public.live_room_member_profiles;
begin
  v_bio := pg_catalog.replace(
    pg_catalog.replace(coalesce(p_bio, ''), E'\r\n', E'\n'),
    E'\r',
    E'\n'
  );

  select pg_catalog.string_agg(
    pg_catalog.btrim(line.value, ' '),
    E'\n'
    order by line.ordinality
  )
  into v_bio
  from pg_catalog.unnest(
    pg_catalog.string_to_array(v_bio, E'\n')
  ) with ordinality as line(value, ordinality);

  v_bio := pg_catalog.btrim(coalesce(v_bio, ''), E' \n');
  if v_bio = '' then
    v_bio := null;
  end if;

  if v_bio is not null
    and (
      pg_catalog.char_length(v_bio) > 280
      or pg_catalog.array_length(
        pg_catalog.string_to_array(v_bio, E'\n'),
        1
      ) > 4
      or pg_catalog.regexp_replace(v_bio, E'\n', '', 'g')
        ~ '[[:cntrl:]]'
      or v_bio ~ '[<>]'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'LIVE_ROOM_INVALID_PROFILE_BIO';
  end if;

  select *
  into v_profile
  from public.set_live_room_member_chat_name(
    p_member_user_id,
    p_display_name
  );

  update public.live_room_member_profiles as profile
  set bio = v_bio
  where profile.user_id = p_member_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.set_live_room_member_profile(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_live_room_member_profile(uuid, text, text)
  to service_role;

revoke all on table public.live_room_member_profiles
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.live_room_member_profiles
  to service_role;

comment on column public.live_room_member_profiles.bio is
  'Optional public plain-text member introduction. NULL means no public About section.';
comment on function public.set_live_room_member_profile(uuid, text, text) is
  'Service-only atomic chat-name and optional public bio setter. The server supplies the authenticated member user id.';
