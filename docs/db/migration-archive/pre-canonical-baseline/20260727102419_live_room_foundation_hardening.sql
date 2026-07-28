begin;

alter table public.live_room_member_profiles
  drop constraint if exists live_room_member_profiles_emoji_check;

alter table public.live_room_member_profiles
  add constraint live_room_member_profiles_emoji_check
  check (
    emoji = any (
      array[
        chr(128075),
        chr(129418),
        chr(128059),
        chr(129417),
        chr(128640),
        chr(129517),
        chr(128202),
        chr(127793)
      ]
    )
  );

alter table public.live_room_guest_profiles
  drop constraint if exists live_room_guest_profiles_emoji_check;

alter table public.live_room_guest_profiles
  add constraint live_room_guest_profiles_emoji_check
  check (
    emoji = any (
      array[
        chr(128075),
        chr(129418),
        chr(128059),
        chr(129417),
        chr(128640),
        chr(129517),
        chr(128202),
        chr(127793)
      ]
    )
  );

alter table public.live_room_messages
  drop constraint if exists live_room_messages_author_emoji_check;

alter table public.live_room_messages
  add constraint live_room_messages_author_emoji_check
  check (
    author_emoji = any (
      array[
        chr(128075),
        chr(129418),
        chr(128059),
        chr(129417),
        chr(128640),
        chr(129517),
        chr(128202),
        chr(127793)
      ]
    )
  );

create index if not exists live_room_messages_member_user_idx
  on public.live_room_messages (member_user_id)
  where member_user_id is not null;

create index if not exists live_room_messages_guest_session_idx
  on public.live_room_messages (guest_session_id)
  where guest_session_id is not null;

create index if not exists live_room_follows_member_user_idx
  on public.live_room_follows (member_user_id)
  where member_user_id is not null;

create index if not exists live_room_follows_guest_session_idx
  on public.live_room_follows (guest_session_id)
  where guest_session_id is not null;

commit;
