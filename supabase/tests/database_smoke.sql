begin;

select plan(6);

select is(
  current_setting('server_version_num')::integer / 10000,
  17,
  'local database runs PostgreSQL 17'
);

select has_table(
  'public',
  'live_room_post_activity',
  'the latest migration created live_room_post_activity'
);

select has_column(
  'public',
  'live_room_post_activity',
  'read_at',
  'live_room_post_activity includes its read cursor'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'live_room_post_activity'
  ),
  'live_room_post_activity has row level security enabled'
);

select ok(
  to_regprocedure(
    'public.get_live_room_post_activity_summary(uuid,integer)'
  ) is not null,
  'the latest activity summary function exists'
);

select ok(
  exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260728094224'
  ),
  'the latest repository migration is recorded'
);

select * from finish();

rollback;
