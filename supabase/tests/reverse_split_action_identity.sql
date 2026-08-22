begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column(
  'public', 'event_corporate_action_facts', 'reverse_split_action_id',
  'Corporate Action facts preserve canonical reverse-split action identity'
);
select has_column(
  'public', 'event_corporate_action_facts', 'action_link_status',
  'Corporate Action facts preserve action link status'
);
select has_column(
  'public', 'event_corporate_action_facts', 'action_origin_event_id',
  'Corporate Action facts preserve deterministic origin observation identity'
);
select has_column(
  'public', 'event_corporate_action_facts', 'action_link_payload',
  'Corporate Action facts preserve complete action link provenance'
);
select has_trigger(
  'public', 'event_corporate_action_facts', 'zz_materialize_reverse_split_action_identity_v1',
  'action identity is materialized after applicability/class identity'
);
select has_function(
  'public', 'read_reverse_split_action_link_candidates', array['text', 'timestamp with time zone'],
  'bounded analyzer action-candidate RPC exists'
);
select has_function(
  'public', 'read_reverse_split_action_history_candidates', array['text', 'text'],
  'official action-history candidate RPC exists'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.read_reverse_split_action_link_candidates(text,timestamptz)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.read_reverse_split_action_link_candidates(text,timestamptz)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.read_reverse_split_action_link_candidates(text,timestamptz)', 'execute'
  ),
  'action-link candidates are service-role-only'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.read_reverse_split_action_history_candidates(text,text)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.read_reverse_split_action_history_candidates(text,text)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.read_reverse_split_action_history_candidates(text,text)', 'execute'
  ),
  'action history candidates are service-role-only'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_reverse_split_action_link_candidates(text,timestamptz)'::regprocedure)
  and
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_catalog.pg_proc
   where oid = 'public.read_reverse_split_action_history_candidates(text,text)'::regprocedure),
  'both action candidate readers are security-definer functions with empty search_path'
);
select ok(
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'public.event_corporate_action_facts'::regclass)
  and not pg_catalog.has_table_privilege(
    'anon', 'public.event_corporate_action_facts', 'select,insert,update,delete'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.event_corporate_action_facts', 'select,insert,update,delete'
  ),
  'existing Corporate Action RLS and direct-access denial remain intact'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'event_corporate_action_facts'
      and indexname = 'event_corporate_action_facts_action_history_idx'
      and indexdef like '%reverse_split_action_id%'
  ),
  'action-level lookup has a partial issuer/class/action index'
);

select * from finish();
rollback;
