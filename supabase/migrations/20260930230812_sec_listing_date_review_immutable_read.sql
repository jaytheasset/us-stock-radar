-- Observations are append-only. FOR SHARE would unnecessarily require UPDATE
-- privilege; the per-observation advisory lock still serializes review revisions.
do $migration$
declare definition text; old_clause text := 'select * into strict o from public.sec_listing_status_observations where id=p_observation_id for share;';
begin
  definition := pg_get_functiondef('public.admin_apply_sec_listing_date_review(uuid,uuid,text,jsonb,text,text,integer,text)'::regprocedure);
  if strpos(definition, old_clause)=0 then raise exception 'UNEXPECTED_LISTING_REVIEW_FUNCTION'; end if;
  execute replace(definition, old_clause,
    'select * into strict o from public.sec_listing_status_observations where id=p_observation_id;');
end $migration$;
notify pgrst,'reload schema';
