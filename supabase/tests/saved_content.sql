begin;

select plan(18);

select has_table('public', 'saved_content', 'saved content table exists');
select col_is_pk('public', 'saved_content', 'id', 'saved content has a primary key');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.saved_content'::regclass),
  'saved content has RLS enabled'
);
select ok(not has_table_privilege('anon', 'public.saved_content', 'select'), 'anon cannot select saved content');
select ok(not has_table_privilege('anon', 'public.saved_content', 'insert'), 'anon cannot insert saved content');
select ok(not has_table_privilege('anon', 'public.saved_content', 'delete'), 'anon cannot delete saved content');
select ok(has_table_privilege('authenticated', 'public.saved_content', 'select'), 'authenticated can select through RLS');
select ok(has_table_privilege('authenticated', 'public.saved_content', 'insert'), 'authenticated can insert through RLS');
select ok(has_table_privilege('authenticated', 'public.saved_content', 'delete'), 'authenticated can delete through RLS');
select ok(not has_table_privilege('authenticated', 'public.saved_content', 'update'), 'authenticated cannot update saved rows');
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'saved_content_user_created_idx'
  ),
  'saved listing has a user and created-at index'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  (
    '92000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'saved-a@example.test', '', now(), now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'saved-b@example.test', '', now(), now(), now()
  );

insert into public.saved_content (user_id, content_type, content_id) values
  ('92000000-0000-4000-8000-000000000001', 'news', '93000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002', 'filing', '93000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ insert into public.saved_content (user_id, content_type, content_id)
     values ('92000000-0000-4000-8000-000000000001', 'calendar', '93000000-0000-4000-8000-000000000003') $$,
  '23514',
  null,
  'only supported content types are accepted'
);

select throws_ok(
  $$ insert into public.saved_content (user_id, content_type, content_id)
     values ('92000000-0000-4000-8000-000000000001', 'news', '93000000-0000-4000-8000-000000000001') $$,
  '23505',
  null,
  'duplicate saves are rejected by the unique constraint'
);

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.saved_content),
  1::bigint,
  'user A can only read their own saved row'
);

select lives_ok(
  $$ insert into public.saved_content (user_id, content_type, content_id)
     values ('92000000-0000-4000-8000-000000000001', 'live_room_post', '93000000-0000-4000-8000-000000000004') $$,
  'user A can insert their own saved row'
);

select throws_ok(
  $$ insert into public.saved_content (user_id, content_type, content_id)
     values ('92000000-0000-4000-8000-000000000002', 'news', '93000000-0000-4000-8000-000000000005') $$,
  '42501',
  null,
  'user A cannot insert a saved row for user B'
);

select lives_ok(
  $$ delete from public.saved_content
     where user_id = '92000000-0000-4000-8000-000000000002' $$,
  'deleting user B rows reveals no rows and does not error'
);

reset role;

select is(
  (select count(*) from public.saved_content where user_id = '92000000-0000-4000-8000-000000000002'),
  1::bigint,
  'user A cannot delete user B saved rows'
);

select * from finish();
rollback;
