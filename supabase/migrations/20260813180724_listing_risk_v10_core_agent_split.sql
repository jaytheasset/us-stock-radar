-- Analyzer v10 removes Gemini responseSchema, separates the single-call Core
-- facts from Agent provenance transport, and preserves canonical V2 facts.
-- Extend only the explicit analyzer -> facts mapping so v9 lineage cannot
-- collide with the new v10 child identity.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7',
    'listing_risk_domain_analyzer_v8',
    'listing_risk_domain_analyzer_v9'
  ) then$old$,
    $new$'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7',
    'listing_risk_domain_analyzer_v8',
    'listing_risk_domain_analyzer_v9',
    'listing_risk_domain_analyzer_v10'
  ) then$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v10 supported analyzer replacement did not match';
  end if;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7',
      'listing_risk_domain_analyzer_v8',
      'listing_risk_domain_analyzer_v9'
    )
      then 'listing_risk_event_facts_v2'$old$,
    $new$'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7',
      'listing_risk_domain_analyzer_v8',
      'listing_risk_domain_analyzer_v9',
      'listing_risk_domain_analyzer_v10'
    )
      then 'listing_risk_event_facts_v2'$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v10 fact schema mapping replacement did not match';
  end if;

  execute v_updated;
end
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.read_current_event_listing_risk_facts(uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$when 'listing_risk_domain_analyzer_v9' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$old$,
    $new$when 'listing_risk_domain_analyzer_v9' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v10' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$new$
  );
  if v_updated = v_definition then
    raise exception 'read Listing Risk v10 fact schema mapping replacement did not match';
  end if;

  execute v_updated;
end
$migration$;

comment on function public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb) is
  'Persists fail-closed Listing Risk analyzer results; v5/v6/v7/v8/v9/v10 map to canonical fact schema V2.';
