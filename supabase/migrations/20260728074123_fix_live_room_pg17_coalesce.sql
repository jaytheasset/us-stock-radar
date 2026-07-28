begin;

-- COALESCE is SQL syntax, not a schema-qualified pg_catalog function.
-- PostgreSQL resolves pg_catalog.coalesce(...) as a normal function call and
-- fails at runtime. Recreate only the four affected Live Room post functions,
-- preserving their bodies, attributes, signatures, and existing grants.
do $migration$
declare
  v_signature regprocedure;
  v_definition text;
  v_fixed_definition text;
begin
  foreach v_signature in array array[
    'public.create_live_room_post(uuid,uuid,text,text,text[],uuid)'::regprocedure,
    'public.update_live_room_post(uuid,uuid,text,text,text[],uuid)'::regprocedure,
    'public.moderate_live_room_post(uuid,uuid,text,text)'::regprocedure,
    'public.validate_live_room_post_cross_targets()'::regprocedure
  ]
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_signature);
    v_fixed_definition := pg_catalog.replace(
      v_definition,
      'pg_catalog.coalesce(',
      'coalesce('
    );

    if v_fixed_definition = v_definition then
      raise exception using
        errcode = 'P0001',
        message = 'LIVE_ROOM_PG17_COALESCE_FIX_TARGET_NOT_FOUND',
        detail = v_signature::text;
    end if;

    execute v_fixed_definition;
  end loop;
end
$migration$;

commit;
