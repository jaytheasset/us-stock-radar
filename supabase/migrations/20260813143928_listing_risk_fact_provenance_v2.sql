-- Listing Risk fact-level provenance V2 is additive. Existing V1 history stays
-- valid and readable only through their legacy analyzer contracts; v5 writes/reads V2.

alter table public.event_listing_risk_facts
  drop constraint event_listing_risk_facts_schema_version_check;

alter table public.event_listing_risk_facts
  add constraint event_listing_risk_facts_schema_version_check
  check (fact_schema_version in (
    'listing_risk_event_facts_v1',
    'listing_risk_event_facts_v2'
  ));

-- Preserve the already-audited lineage/currentness implementation byte-for-byte
-- except for the explicit analyzer-contract -> fact-schema mapping. Guard every
-- replacement so a changed predecessor migration fails instead of weakening the
-- persistence boundary silently.
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
    $old$or p_expected_result#>>'{facts,version}' <> 'listing_risk_event_facts_v1'$old$,
    $new$or p_expected_result#>>'{facts,version}' not in (
        'listing_risk_event_facts_v1',
        'listing_risk_event_facts_v2'
      )$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk V2 shape guard replacement did not match';
  end if;
  v_definition := v_updated;

  v_updated := pg_catalog.replace(
    v_definition,
    $old$v_source_family := pg_catalog.btrim(v_execution.metadata->>'source_family');$old$,
    $new$v_source_family := pg_catalog.btrim(v_execution.metadata->>'source_family');

  if v_execution.prompt_version not in (
    'listing_risk_domain_analyzer_v2',
    'listing_risk_domain_analyzer_v3',
    'listing_risk_domain_analyzer_v4',
    'listing_risk_domain_analyzer_v5'
  ) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'unsupported_analyzer_contract_version');
  end if;
  if v_result_status = 'applicable' and p_expected_result#>>'{facts,version}' is distinct from (case
    when v_execution.prompt_version in (
      'listing_risk_domain_analyzer_v2',
      'listing_risk_domain_analyzer_v3',
      'listing_risk_domain_analyzer_v4'
    )
      then 'listing_risk_event_facts_v1'
    when v_execution.prompt_version = 'listing_risk_domain_analyzer_v5'
      then 'listing_risk_event_facts_v2'
    else null
  end) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'reason', 'analyzer_fact_schema_version_mismatch');
  end if;$new$
  );
  if v_updated = v_definition then
    raise exception 'persist Listing Risk V2 analyzer mapping replacement did not match';
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
    $old$or v_facts.fact_schema_version <> 'listing_risk_event_facts_v1'$old$,
    $new$or v_facts.fact_schema_version <> (case p_analyzer_contract_version
      when 'listing_risk_domain_analyzer_v2' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v3' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v4' then 'listing_risk_event_facts_v1'
      when 'listing_risk_domain_analyzer_v5' then 'listing_risk_event_facts_v2'
      else '__unsupported_listing_risk_fact_schema__'
    end)$new$
  );
  if v_updated = v_definition then
    raise exception 'read Listing Risk V2 analyzer mapping replacement did not match';
  end if;

  execute v_updated;
end
$migration$;

comment on constraint event_listing_risk_facts_schema_version_check
  on public.event_listing_risk_facts is
  'Allows immutable Listing facts V1 history and additive fact-level provenance V2 payloads.';
