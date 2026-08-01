begin;

select plan(13);

select has_index(
  'public',
  'user_delivery_channels',
  'user_delivery_channels_telegram_destination_uidx',
  'Telegram destinations have a database-enforced unique owner'
);

select ok(
  (
    select pg_get_expr(index.indpred, index.indrelid)
    from pg_index as index
    join pg_class as relation on relation.oid = index.indexrelid
    where relation.relname = 'user_delivery_channels_telegram_destination_uidx'
  ) like '%channel = ''telegram''%'
  and (
    select pg_get_expr(index.indpred, index.indrelid)
    from pg_index as index
    join pg_class as relation on relation.oid = index.indexrelid
    where relation.relname = 'user_delivery_channels_telegram_destination_uidx'
  ) like '%btrim(destination)%',
  'the unique index excludes other channels and empty destinations'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.user_delivery_channels'::regclass
  ),
  'Telegram ownership enforcement preserves delivery-channel RLS'
);

insert into public.user_profiles (id, email)
values
  ('00000000-0000-4000-8000-0000000000d1', 'telegram-owner-one@example.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'telegram-owner-two@example.test'),
  ('00000000-0000-4000-8000-0000000000d3', 'telegram-owner-three@example.test');

insert into public.user_delivery_channels (user_id, channel, enabled, destination, verified_at)
values (
  '00000000-0000-4000-8000-0000000000d1',
  'telegram',
  true,
  '424242',
  now()
);

select throws_ok(
  $$
    insert into public.user_delivery_channels (user_id, channel, enabled, destination, verified_at)
    values ('00000000-0000-4000-8000-0000000000d2', 'telegram', true, '424242', now())
  $$,
  '23505',
  null,
  'a Telegram chat already owned by another user is rejected'
);

select is(
  (
    select user_id
    from public.user_delivery_channels
    where channel = 'telegram' and destination = '424242'
  ),
  '00000000-0000-4000-8000-0000000000d1'::uuid,
  'a rejected duplicate leaves the existing owner unchanged'
);

select lives_ok(
  $$
    insert into public.user_delivery_channels (user_id, channel, enabled, destination)
    values ('00000000-0000-4000-8000-0000000000d2', 'email', false, '424242')
  $$,
  'the same destination text remains valid for another channel'
);

select lives_ok(
  $$
    insert into public.user_delivery_channels (user_id, channel, enabled, destination)
    values
      ('00000000-0000-4000-8000-0000000000d2', 'telegram', false, ''),
      ('00000000-0000-4000-8000-0000000000d3', 'telegram', false, null)
  $$,
  'empty and null Telegram destinations are not uniquely constrained'
);

update public.user_delivery_channels
set enabled = false,
    metadata = '{"username":"old_user"}'::jsonb
where user_id = '00000000-0000-4000-8000-0000000000d1'
  and channel = 'telegram';

select lives_ok(
  $$
    insert into public.user_delivery_channels (
      user_id, channel, enabled, destination, metadata, verified_at
    ) values (
      '00000000-0000-4000-8000-0000000000d1',
      'telegram',
      false,
      '525252',
      '{"username":"changed_user"}'::jsonb,
      now()
    )
    on conflict (user_id, channel) do update
    set enabled = excluded.enabled,
        destination = excluded.destination,
        metadata = excluded.metadata,
        verified_at = excluded.verified_at
  $$,
  'the same member can change to an unowned Telegram account'
);

select is(
  (
    select destination || ':' || enabled::text
    from public.user_delivery_channels
    where user_id = '00000000-0000-4000-8000-0000000000d1'
      and channel = 'telegram'
  ),
  '525252:false',
  'Change account preserves the existing ON/OFF pause state'
);

update public.user_delivery_channels
set destination = '626262', verified_at = now()
where user_id = '00000000-0000-4000-8000-0000000000d2'
  and channel = 'telegram';

select throws_ok(
  $$
    insert into public.user_delivery_channels (
      user_id, channel, enabled, destination, metadata, verified_at
    ) values (
      '00000000-0000-4000-8000-0000000000d1',
      'telegram',
      false,
      '626262',
      '{"username":"conflict_user"}'::jsonb,
      now()
    )
    on conflict (user_id, channel) do update
    set destination = excluded.destination,
        metadata = excluded.metadata,
        verified_at = excluded.verified_at
  $$,
  '23505',
  null,
  'Change account rejects a destination owned by another member'
);

select is(
  (
    select destination
    from public.user_delivery_channels
    where user_id = '00000000-0000-4000-8000-0000000000d1'
      and channel = 'telegram'
  ),
  '525252',
  'a rejected Change account keeps the prior connection intact'
);

delete from public.user_delivery_channels
where user_id = '00000000-0000-4000-8000-0000000000d1'
  and channel = 'telegram';

select is(
  (
    select count(*)
    from public.user_delivery_channels
    where user_id = '00000000-0000-4000-8000-0000000000d1'
      and channel = 'telegram'
  ),
  0::bigint,
  'Disconnect removes destination, metadata, verification, and enabled state with the row'
);

select lives_ok(
  $$
    insert into public.user_delivery_channels (
      user_id, channel, enabled, destination, metadata, verified_at
    ) values (
      '00000000-0000-4000-8000-0000000000d1',
      'telegram',
      true,
      '727272',
      '{}'::jsonb,
      now()
    )
  $$,
  'a disconnected member can reconnect'
);

select * from finish();

rollback;
