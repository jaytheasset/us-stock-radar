-- Analyzer v8 changes only the Gemini provider envelope to one payload
-- string. The strict inner parser still projects canonical
-- listing_risk_event_facts_v2. Extend the fail-closed analyzer -> facts
-- mapping without changing tables or promoting existing history.

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
    $old$'listing_risk_domain_analyzer_v4',
    'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7'
  ) then$old$,
    $new$'listing_risk_domain_analyzer_v4',
    'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7',
    'listing_risk_domain_analyzer_v8'
  ) then$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v8 supported analyzer replacement did not match';
  end if;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7'
    )
      then 'listing_risk_event_facts_v2'$old$,
    $new$'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7',
      'listing_risk_domain_analyzer_v8'
    )
      then 'listing_risk_event_facts_v2'$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v8 fact schema mapping replacement did not match';
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
    $old$when 'listing_risk_domain_analyzer_v7' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$old$,
    $new$when 'listing_risk_domain_analyzer_v7' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v8' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$new$
  );
  if v_updated = v_definition then
    raise exception 'read Listing Risk v8 fact schema mapping replacement did not match';
  end if;

  execute v_updated;
end
$migration$;

comment on function public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb) is
  'Persists fail-closed Listing Risk analyzer results; v5/v6/v7/v8 map to canonical fact schema V2.';
