-- Signed-in members always have a safe two-character public identity.
-- Custom chat names remain case-insensitively unique, while automatic
-- defaults may repeat and never expose an email beyond the first two safe
-- local-part characters.

create or replace function private.live_room_default_member_display_name(
  p_email text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')))
      ~ '^[a-z0-9]{2}[^@]*@[^@]+$'
    then pg_catalog.substr(
      pg_catalog.lower(pg_catalog.btrim(p_email)),
      1,
      2
    )
    else 'sr'
  end;
$$;

revoke all on function private.live_room_default_member_display_name(text)
  from public, anon, authenticated;
grant execute on function private.live_room_default_member_display_name(text)
  to service_role;

alter table public.live_room_member_profiles
  add column is_display_name_custom boolean not null default false;

alter table public.live_room_member_profiles
  drop constraint if exists live_room_member_profiles_display_name_check;

drop index if exists public.live_room_member_profiles_chat_name_unique_idx;

update public.live_room_member_profiles
set is_display_name_custom = true
where display_name is not null;

update public.live_room_member_profiles as profile
set display_name = private.live_room_default_member_display_name(
  user_profile.email
)
from public.user_profiles as user_profile
where profile.user_id = user_profile.id
  and profile.display_name is null;

update public.live_room_member_profiles
set display_name = 'sr'
where display_name is null;

alter table public.live_room_member_profiles
  alter column display_name set not null;

alter table public.live_room_member_profiles
  add constraint live_room_member_profiles_display_name_check
  check (
    (
      not is_display_name_custom
      and display_name ~ '^[a-z0-9]{2}$'
    )
    or (
      is_display_name_custom
      and pg_catalog.char_length(display_name) between 2 and 24
      and display_name = pg_catalog.regexp_replace(
        pg_catalog.btrim(display_name),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and display_name ~ '^[A-Za-z][A-Za-z0-9 _-]{1,23}$'
      and pg_catalog.regexp_replace(
        pg_catalog.lower(display_name),
        '[ _-]+',
        '',
        'g'
      ) <> all (
        array[
          'guest',
          'member',
          'admin',
          'administrator',
          'moderator',
          'stockradar'
        ]
      )
    )
  );

create or replace function private.normalize_live_room_member_display_name_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_default_display_name text;
begin
  select private.live_room_default_member_display_name(profile.email)
  into v_default_display_name
  from public.user_profiles as profile
  where profile.id = new.user_id;

  v_default_display_name := coalesce(v_default_display_name, 'sr');
  if not new.is_display_name_custom
    and new.display_name <> v_default_display_name
  then
    new.is_display_name_custom := true;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_live_room_member_display_name_state()
  from public, anon, authenticated;

create trigger live_room_member_profiles_normalize_display_name_state
before insert or update of user_id, display_name, is_display_name_custom
on public.live_room_member_profiles
for each row
execute function private.normalize_live_room_member_display_name_state();

create or replace function private.sync_live_room_member_default_display_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.live_room_member_profiles
    set display_name = private.live_room_default_member_display_name(new.email)
    where user_id = new.id
      and not is_display_name_custom;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_live_room_member_default_display_name()
  from public, anon, authenticated;

create trigger user_profiles_sync_live_room_default_display_name
after update of email on public.user_profiles
for each row
execute function private.sync_live_room_member_default_display_name();

create unique index live_room_member_profiles_chat_name_unique_idx
  on public.live_room_member_profiles (pg_catalog.lower(display_name))
  where is_display_name_custom;

create or replace function public.set_live_room_member_chat_name(
  p_member_user_id uuid,
  p_display_name text
)
returns public.live_room_member_profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_display_name text;
  v_profile public.live_room_member_profiles;
begin
  v_display_name := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(p_display_name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );

  if pg_catalog.char_length(v_display_name) < 2
    or pg_catalog.char_length(v_display_name) > 24
    or v_display_name !~ '^[A-Za-z][A-Za-z0-9 _-]{1,23}$'
  then
    raise exception using
      errcode = '22023',
      message = 'LIVE_ROOM_INVALID_CHAT_NAME';
  end if;

  if pg_catalog.regexp_replace(
    pg_catalog.lower(v_display_name),
    '[ _-]+',
    '',
    'g'
  ) = any (
    array[
      'guest',
      'member',
      'admin',
      'administrator',
      'moderator',
      'stockradar'
    ]
  )
  then
    raise exception using
      errcode = '22023',
      message = 'LIVE_ROOM_RESERVED_CHAT_NAME';
  end if;

  insert into public.live_room_member_profiles (
    user_id,
    display_name,
    is_display_name_custom
  )
  values (
    p_member_user_id,
    v_display_name,
    true
  )
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    is_display_name_custom = true
  returning * into v_profile;

  return v_profile;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'LIVE_ROOM_CHAT_NAME_TAKEN';
end;
$$;

revoke all on function public.set_live_room_member_chat_name(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_live_room_member_chat_name(uuid, text)
  to service_role;

create or replace function private.set_live_room_message_member_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_display_name text;
begin
  if new.author_kind <> 'member' then
    return new;
  end if;

  select profile.display_name
  into v_display_name
  from public.live_room_member_profiles as profile
  where profile.user_id = new.member_user_id;

  if v_display_name is null then
    raise exception using
      errcode = '23514',
      message = 'LIVE_ROOM_MEMBER_PROFILE_REQUIRED';
  end if;

  new.author_display_name := v_display_name;
  new.author_emoji := pg_catalog.upper(
    pg_catalog.substr(v_display_name, 1, 1)
  );
  return new;
end;
$$;

revoke all on function private.set_live_room_message_member_identity()
  from public, anon, authenticated;

drop trigger if exists live_room_messages_require_chat_name
  on public.live_room_messages;
create trigger live_room_messages_set_member_identity
before insert on public.live_room_messages
for each row
execute function private.set_live_room_message_member_identity();

drop trigger if exists live_room_posts_require_chat_name
  on public.live_room_posts;
drop trigger if exists live_room_post_comments_require_chat_name
  on public.live_room_post_comments;
drop function if exists private.require_live_room_author_chat_name();

comment on column public.live_room_member_profiles.display_name is
  'Effective public Live Room name. Automatic values are safe two-character email-derived defaults; custom values preserve the existing validation contract.';
comment on column public.live_room_member_profiles.is_display_name_custom is
  'True only after the member explicitly saves a custom public chat name.';
comment on function private.live_room_default_member_display_name(text) is
  'Returns only a safe two-character public fallback and never returns an email or full local part.';
