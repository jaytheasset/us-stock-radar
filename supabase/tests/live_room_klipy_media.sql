begin;

select plan(17);

select has_table(
  'public', 'live_room_message_media',
  'KLIPY message media table exists'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.live_room_message_media'::regclass),
  'KLIPY media table has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.live_room_message_media', 'select'),
  'anon cannot read raw media rows'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.live_room_message_media', 'select'
  ),
  'authenticated cannot read raw media rows'
);
select ok(
  has_table_privilege(
    'service_role', 'public.live_room_message_media', 'select,insert,delete'
  ),
  'service role manages media rows'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.insert_live_room_message_with_attachments(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,uuid,boolean,text,text,text,text,text,text,text,integer,integer,text,text)',
    'execute'
  ),
  'browser roles cannot execute the atomic attachment function'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.insert_live_room_message_with_attachments(uuid,text,uuid,uuid,text,text,text,text,uuid,uuid,uuid,boolean,text,text,text,text,text,text,text,integer,integer,text,text)',
    'execute'
  ),
  'service role can execute the atomic attachment function'
);

insert into public.user_profiles (id)
values ('96000000-0000-4000-8000-000000000001');
insert into public.live_room_member_profiles (
  user_id, display_name, emoji, public_profile_id, show_presence
) values (
  '96000000-0000-4000-8000-000000000001',
  'KLIPY sender',
  chr(128640),
  '96100000-0000-4000-8000-000000000001',
  true
);
insert into public.live_room_rooms (id, ticker, room_kind)
values (
  '96200000-0000-4000-8000-000000000001',
  'KLPYZZ',
  'company'
);

select throws_ok(
  $$ select public.insert_live_room_message(
    '96200000-0000-4000-8000-000000000001', 'member',
    '96000000-0000-4000-8000-000000000001', null,
    'KLIPY sender', chr(128640), 'free', '', null, null
  ) $$,
  'P0001',
  'LIVE_ROOM_EMPTY',
  'ordinary empty messages remain rejected'
);

select lives_ok(
  $$ select public.insert_live_room_message_with_attachments(
    '96200000-0000-4000-8000-000000000001', 'member',
    '96000000-0000-4000-8000-000000000001', null,
    'KLIPY sender', chr(128640), 'free', '', null, null, null, false,
    'klipy', 'media_one', 'gif', 'Market GIF', 'Market GIF',
    'https://static.klipy.com/qa/one.gif',
    'https://static.klipy.com/qa/one-preview.gif',
    640, 360, 'https://klipy.com/gifs/one',
    repeat('a', 64)
  ) $$,
  'media-only message is inserted atomically'
);

select is(
  (select count(*)::integer
   from public.live_room_messages
   where room_id = '96200000-0000-4000-8000-000000000001'
     and body = ''),
  1,
  'the empty body exists only for the valid media message'
);
select is(
  (select count(*)::integer
   from public.live_room_message_media as media
   join public.live_room_messages as message
     on message.id = media.message_id
   where message.room_id = '96200000-0000-4000-8000-000000000001'),
  1,
  'one structured media row is attached'
);
select is(
  (select count(*)::integer
   from public.live_room_memberships
   where room_id = '96200000-0000-4000-8000-000000000001'
     and member_user_id = '96000000-0000-4000-8000-000000000001'),
  1,
  'sending media preserves creator auto-join behavior'
);

select lives_ok(
  $$ select public.insert_live_room_message_with_attachments(
    '96200000-0000-4000-8000-000000000001', 'member',
    '96000000-0000-4000-8000-000000000001', null,
    'KLIPY sender', chr(128640), 'free', 'Caption', null, null, null, false,
    'klipy', 'media_two', 'gif', '', 'Reaction GIF',
    'https://static.klipy.com/qa/two.gif',
    'https://static.klipy.com/qa/two-preview.gif',
    320, 320, 'https://klipy.com/gifs/two',
    repeat('b', 64)
  ) $$,
  'text and media can be stored together'
);

select throws_ok(
  $$ select public.insert_live_room_message_with_attachments(
    '96200000-0000-4000-8000-000000000001', 'guest', null,
    '96300000-0000-4000-8000-000000000001',
    'Guest', chr(128075), 'free', '', null, null, null, false,
    'klipy', 'guest_media', 'gif', '', 'Guest GIF',
    'https://static.klipy.com/qa/guest.gif',
    'https://static.klipy.com/qa/guest-preview.gif',
    320, 180, 'https://klipy.com/gifs/guest',
    repeat('c', 64)
  ) $$,
  'P0001',
  'LIVE_ROOM_MEMBER_REQUIRED',
  'guest cannot bypass media membership'
);

select throws_ok(
  $$ select public.insert_live_room_message_with_attachments(
    '96200000-0000-4000-8000-000000000001', 'member',
    '96000000-0000-4000-8000-000000000001', null,
    'KLIPY sender', chr(128640), 'free', 'Tampered', null, null, null, false,
    'klipy', 'tampered', 'gif', '', 'Tampered GIF',
    'https://evil.example/tampered.gif',
    'https://static.klipy.com/qa/tampered-preview.gif',
    320, 180, 'https://klipy.com/gifs/tampered',
    repeat('d', 64)
  ) $$,
  '23514',
  null,
  'DB rejects a tampered media host'
);
select is(
  (select count(*)::integer
   from public.live_room_messages where body = 'Tampered'),
  0,
  'failed media validation rolls back the message'
);

select throws_ok(
  $$ insert into public.live_room_message_media (
    message_id, provider, provider_media_id, media_kind, title, alt_text,
    display_url, preview_url, width, height, item_url, content_fingerprint
  )
  select message_id, provider, 'duplicate', media_kind, title, alt_text,
    display_url, preview_url, width, height, item_url, repeat('e', 64)
  from public.live_room_message_media limit 1 $$,
  '23505',
  null,
  'message attachment is one-to-one'
);

select * from finish();
rollback;
