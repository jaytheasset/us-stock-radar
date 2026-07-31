-- Member chat names are intentionally unset until the member chooses one.
-- Historical message author snapshots remain unchanged.

alter table public.live_room_member_profiles
  alter column display_name drop not null,
  alter column emoji drop not null;

alter table public.live_room_member_profiles
  drop constraint if exists live_room_member_profiles_display_name_check;

update public.live_room_member_profiles
set display_name = null
where display_name = 'Member';

update public.live_room_member_profiles
set display_name = null
where display_name is not null
  and (
    display_name <> pg_catalog.regexp_replace(
      pg_catalog.btrim(display_name),
      '[[:space:]]+',
      ' ',
      'g'
    )
    or pg_catalog.char_length(display_name) < 2
    or pg_catalog.char_length(display_name) > 24
    or display_name !~ '^[A-Za-z][A-Za-z0-9 _-]{1,23}$'
    or pg_catalog.regexp_replace(
      pg_catalog.lower(display_name),
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
  );

with ranked_names as (
  select
    profile.user_id,
    pg_catalog.row_number() over (
      partition by pg_catalog.lower(profile.display_name)
      order by profile.created_at, profile.user_id
    ) as duplicate_rank
  from public.live_room_member_profiles as profile
  where profile.display_name is not null
)
update public.live_room_member_profiles as profile
set display_name = null
from ranked_names
where ranked_names.user_id = profile.user_id
  and ranked_names.duplicate_rank > 1;

alter table public.live_room_member_profiles
  add constraint live_room_member_profiles_display_name_check
  check (
    display_name is null
    or (
      pg_catalog.char_length(display_name) between 2 and 24
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

drop index if exists public.live_room_member_profiles_chat_name_unique_idx;
create unique index live_room_member_profiles_chat_name_unique_idx
  on public.live_room_member_profiles (pg_catalog.lower(display_name))
  where display_name is not null;

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
    display_name
  )
  values (
    p_member_user_id,
    v_display_name
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name
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

alter table public.live_room_messages
  drop constraint if exists live_room_messages_author_emoji_check;
alter table public.live_room_messages
  add constraint live_room_messages_author_emoji_check
  check (
    author_emoji = any (
      array[
        pg_catalog.chr(128075),
        pg_catalog.chr(129418),
        pg_catalog.chr(128059),
        pg_catalog.chr(129417),
        pg_catalog.chr(128640),
        pg_catalog.chr(129517),
        pg_catalog.chr(128202),
        pg_catalog.chr(127793)
      ]
    )
    or author_emoji ~ '^[A-Z]$'
  );

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
      message = 'LIVE_ROOM_CHAT_NAME_REQUIRED';
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
create trigger live_room_messages_require_chat_name
before insert on public.live_room_messages
for each row
execute function private.set_live_room_message_member_identity();

create or replace function private.require_live_room_author_chat_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.live_room_member_profiles as profile
    where profile.user_id = new.author_user_id
      and profile.display_name is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'LIVE_ROOM_CHAT_NAME_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.require_live_room_author_chat_name()
  from public, anon, authenticated;

drop trigger if exists live_room_posts_require_chat_name
  on public.live_room_posts;
create trigger live_room_posts_require_chat_name
before insert or update of
  author_user_id,
  title,
  body,
  related_tickers,
  signal_labels,
  referenced_event_id
on public.live_room_posts
for each row
execute function private.require_live_room_author_chat_name();

drop trigger if exists live_room_post_comments_require_chat_name
  on public.live_room_post_comments;
create trigger live_room_post_comments_require_chat_name
before insert or update of author_user_id, parent_comment_id, body
on public.live_room_post_comments
for each row
execute function private.require_live_room_author_chat_name();

comment on column public.live_room_member_profiles.display_name is
  'Unique public chat name. NULL means the member has not completed chat identity setup.';
comment on function public.set_live_room_member_chat_name(uuid, text) is
  'Service-only atomic chat-name setter. The server derives the member user id from the authenticated session.';
