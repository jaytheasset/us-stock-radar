-- Analyzer v7 changes only the Gemini transport to available-only generic
-- fact rows. Canonical persisted facts remain listing_risk_event_facts_v2.
-- Extend the explicit fail-closed analyzer -> facts mapping without changing
-- table shape or promoting any existing V1/V2 history.

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
    'listing_risk_domain_analyzer_v6'
  ) then$old$,
    $new$'listing_risk_domain_analyzer_v4',
    'listing_risk_domain_analyzer_v5',
    'listing_risk_domain_analyzer_v6',
    'listing_risk_domain_analyzer_v7'
  ) then$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v7 supported analyzer replacement did not match';
  end if;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$when v_execution.prompt_version in (
      'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6'
    )
      then 'listing_risk_event_facts_v2'$old$,
    $new$when v_execution.prompt_version in (
      'listing_risk_domain_analyzer_v5',
      'listing_risk_domain_analyzer_v6',
      'listing_risk_domain_analyzer_v7'
    )
      then 'listing_risk_event_facts_v2'$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk v7 fact schema mapping replacement did not match';
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
    $old$when 'listing_risk_domain_analyzer_v6' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$old$,
    $new$when 'listing_risk_domain_analyzer_v6' then 'listing_risk_event_facts_v2'
      when 'listing_risk_domain_analyzer_v7' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'$new$
  );
  if v_updated = v_definition then
    raise exception 'read Listing Risk v7 fact schema mapping replacement did not match';
  end if;

  execute v_updated;
end
$migration$;

comment on function public.persist_listing_risk_analyzer_result(uuid,uuid,jsonb) is
  'Persists fail-closed Listing Risk analyzer results; v5/v6/v7 map to canonical fact schema V2.';
