begin;

select plan(9);

select ok(
  to_regprocedure(
    'public.get_live_room_member_relationships(uuid,text,timestamp with time zone,uuid,integer)'
  ) is not null,
  'paginated member relationship RPC exists'
);

select ok(
  to_regprocedure(
    'public.set_live_room_member_follow_by_profile(uuid,uuid,boolean)'
  ) is not null,
  'opaque-profile member follow RPC exists'
);

select ok(
  to_regprocedure(
    'public.get_live_room_followed_rooms(uuid,timestamp with time zone,uuid,integer)'
  ) is not null,
  'paginated followed rooms RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_live_room_member_relationships(uuid,text,timestamp with time zone,uuid,integer)',
    'execute'
  ),
  'service role can execute relationship listing'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_live_room_member_relationships(uuid,text,timestamp with time zone,uuid,integer)',
    'execute'
  ),
  'authenticated browser role cannot execute relationship listing'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_live_room_followed_rooms(uuid,timestamp with time zone,uuid,integer)',
    'execute'
  ),
  'anonymous browser role cannot execute followed rooms listing'
);

select is(
  (
    public.get_live_room_member_relationships(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'following',
      null,
      null,
      30
    )->'items'
  ),
  '[]'::jsonb,
  'an empty member has no fabricated relationship items'
);

select is(
  (
    public.get_live_room_followed_rooms(
      '00000000-0000-4000-8000-000000000001'::uuid,
      null,
      null,
      30
    )->'items'
  ),
  '[]'::jsonb,
  'an empty member has no fabricated followed rooms'
);

select ok(
  exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260728150000'
  ),
  'the Community hub migration is recorded'
);

select * from finish();

rollback;
