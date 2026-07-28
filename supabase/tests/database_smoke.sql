begin;

select plan(9);

select is(
  current_setting('server_version_num')::integer / 10000,
  17,
  'local database runs PostgreSQL 17'
);

select has_table(
  'public',
  'live_room_post_activity',
  'the canonical baseline includes live_room_post_activity'
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

select is(
  (
    select count(*)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relkind = 'r'
      and not relation.relrowsecurity
  ),
  0::bigint,
  'every application table has row level security enabled'
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
    from pg_catalog.pg_event_trigger
    where evtname = 'stock_radar_enable_public_table_rls'
      and evtenabled <> 'D'
  ),
  'the public-table RLS event trigger is enabled'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_extension
    where extname in ('pgcrypto', 'pg_trgm', 'uuid-ossp')
  ),
  3::bigint,
  'the application extensions are installed'
);

select ok(
  exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260728113243'
  ),
  'the canonical baseline migration is recorded'
);

select * from finish();

rollback;
