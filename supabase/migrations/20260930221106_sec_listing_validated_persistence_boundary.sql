-- Canonical persistence boundary only. No table grant or Monitor contract change.
create or replace function public.sec_listing_effective_date_clause(p_quote text,p_date text,p_key text)
returns boolean language plpgsql immutable security invoker set search_path='' as $fn$
declare v_date date; v_literal text; v_pattern text; v_quote text;
begin
  if p_quote is null or p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  begin v_date:=p_date::date; exception when others then return false; end;
  if to_char(v_date,'YYYY-MM-DD')<>p_date then return false; end if;
  v_quote:=regexp_replace(regexp_replace(btrim(p_quote),'\s+',' ','g'),'\m(Inc|Corp|Co|Ltd)\.','\1','gi');
  if v_quote ~* '\m(not|never|if|unless|would|could|might|may|expected|scheduled|will|anticipat\w*)\M' then return false; end if;
  v_literal:=(array['January','February','March','April','May','June','July','August','September','October','November','December'])[extract(month from v_date)::int]
    ||' '||extract(day from v_date)::int||', '||extract(year from v_date)::int;
  v_pattern:=case p_key
    when 'removal_effective_date' then '(?:remove[^.0-9;]{0,100}from listing|removed from listing|delisted|removal|delisting)[^.0-9;]{0,160}?(?:effective(?: at)?(?: the opening of (?:the )?(?:trading session|business) on)?|on) '
    when 'trading_suspension_date' then '(?:trading[^.0-9;]{0,120}?(?:was|were|has been|is) suspended|(?:stock|shares|securities) (?:was|were) suspended|suspended trading)[^.0-9;]{0,120}?(?:beginning|on|effective(?: at)?(?: the opening of (?:the )?(?:trading session|business) on)?) '
    else null end;
  return coalesce(v_quote ~* (v_pattern||'(?:'||p_date||'|'||v_literal||')(?![0-9])'),false);
end
$fn$;
revoke all on function public.sec_listing_effective_date_clause(text,text,text) from public,anon,authenticated;
grant execute on function public.sec_listing_effective_date_clause(text,text,text) to service_role;

create or replace function public.persist_sec_listing_status_observation(p_observation jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
  v_raw public.raw_items%rowtype; v_identity public.sec_ticker_security_identities%rowtype;
  v_decision public.sec_ticker_resolution_decisions%rowtype;
  v_snapshot jsonb; v_scope jsonb:=p_observation->'scope'; v_attach jsonb:=p_observation->'attachment';
  v_hash text; v_id uuid; v_event uuid; v_status text:='inserted'; v_context jsonb; v_current jsonb; v_key text; v_date text; v_provenance jsonb;
begin
  if p_observation->>'version' is distinct from 'sec_listing_observation_v1'
    or p_observation->>'readerVersion' is distinct from 'sec_delisting_state_v3'
    or coalesce(p_observation->>'form','') !~ '^(25|25-NSE|8-K|6-K)(/A)?$'
    or coalesce(p_observation->>'sourceHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(v_attach->>'status','') not in ('attached','unresolved','conflict')
    or coalesce(p_observation->'reported'->>'listing','') not in ('confirmed_exchange_delisting','removal_pending','removal_decision_withdrawn','unresolved')
    or coalesce(p_observation->'reported'->>'trading','') not in ('suspended','suspension_scheduled','resumed','unresolved')
    or coalesce(jsonb_typeof(p_observation->'reported'->'sources'),'')<>'array'
    or coalesce(jsonb_typeof(p_observation->'reported'->'reasons'),'')<>'array'
  then raise exception 'INVALID_LISTING_OBSERVATION'; end if;
  select * into strict v_raw from public.raw_items where id=(p_observation->>'rawItemId')::uuid for share;
  v_snapshot:=jsonb_build_object('id',v_raw.id,'source_code',v_raw.source_code,'source_group',v_raw.source_group,
    'source_unique_id',v_raw.source_unique_id,'source_url',v_raw.source_url,
    'published_at',v_raw.published_at,'fetched_at',v_raw.fetched_at,'raw_payload',v_raw.raw_payload);
  -- Timestamp JSON spelling can differ between PostgREST and PostgreSQL; compare
  -- the timestamp by value, every remaining source field by exact JSON equality.
  if v_raw.source_code<>'sec_edgar'
    or v_raw.source_unique_id is distinct from p_observation->>'accession'
    or v_raw.raw_payload->>'form_type' is distinct from p_observation->>'form'
    or ((p_observation->'sourceSnapshot') - 'published_at' - 'fetched_at') is distinct from (v_snapshot - 'published_at' - 'fetched_at')
    or (p_observation#>>'{sourceSnapshot,published_at}')::timestamptz is distinct from v_raw.published_at
    or (p_observation#>>'{sourceSnapshot,fetched_at}')::timestamptz is distinct from v_raw.fetched_at
    or (p_observation->>'filingDate')::date is distinct from (v_raw.published_at at time zone 'UTC')::date
    or (p_observation->>'evaluatedAsOf')::date < (p_observation->>'filingDate')::date
  then raise exception 'LISTING_OBSERVATION_SOURCE_CHANGED'; end if;
  v_event:=(p_observation->>'eventId')::uuid;
  v_context:=p_observation->'listingRisk';
  if p_observation->>'form' ~ '^(25|25-NSE)(/A)?$' then
    if v_event is not null or v_context is distinct from 'null'::jsonb then raise exception 'FORM25_OBSERVATION_MUST_BE_SOURCE_ONLY'; end if;
  elsif p_observation ? 'sourceEvent' then
    if v_context is distinct from 'null'::jsonb or (v_event is not null and not exists(
      select 1 from public.events where id=v_event and raw_item_id=v_raw.id and source_code='sec_edgar'))
    then raise exception 'LISTING_OBSERVATION_EVENT_MISMATCH'; end if;
  else
    if v_event is null or not exists(select 1 from public.events where id=v_event and raw_item_id=v_raw.id and source_code='sec_edgar')
      then raise exception 'LISTING_OBSERVATION_EVENT_MISMATCH'; end if;
    -- The private facts table stays private. Reuse the official currentness,
    -- execution, lineage and stored-output checks under its existing narrow RPC.
    v_current:=public.read_current_event_listing_risk_facts(v_event,
      coalesce(v_context->>'analyzerContractVersion','listing_risk_domain_analyzer_v11'));
    if v_current->>'status' is distinct from v_context->>'status' then
      raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
    if v_current->>'status'='not_ready' then
      if v_current->>'reason' is distinct from v_context->>'reason' then
        raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
    elsif v_current->>'status' in ('available','not_applicable') then
      if v_current->>'event_id' is distinct from v_context->>'eventId'
        or v_current->>'raw_item_id' is distinct from v_context->>'rawItemId'
        or v_current->>'parent_primary_ai_run_id' is distinct from v_context->>'parentPrimaryAiRunId'
        or v_current->>'source_execution_id' is distinct from v_context->>'sourceExecutionId'
        or v_current->>'monitor_analyzer_key' is distinct from v_context->>'monitorAnalyzerKey'
        or v_current->>'analyzer_contract_version' is distinct from v_context->>'analyzerContractVersion'
        or (v_current->>'persisted_at')::timestamptz is distinct from (v_context->>'persistedAt')::timestamptz
        or v_current->>'fact_schema_version' is distinct from v_context->>'factSchemaVersion'
        or v_current->'facts' is distinct from v_context->'facts'
      then raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
    else raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
    -- Defend direct RPC calls too. Do not promote a model date whose cited
    -- sentence has no explicit operative-date clause. Application readback
    -- additionally validates the quoted span against the retained SEC source.
    foreach v_key in array array['removal_effective_date','trading_suspension_date'] loop
      v_date:=p_observation#>>array['reported',case v_key when 'removal_effective_date' then 'removalDate' else 'suspensionDate' end];
      if v_date is not null then
        if v_current->>'status' is distinct from 'available'
          or v_current#>>array['facts','dates',v_key,'value'] is distinct from v_date
          or v_current#>>array['facts','dates',v_key,'availability'] is distinct from 'available'
          or v_current#>>array['facts','dates',v_key,'value_quality'] is distinct from 'exact'
          or v_current#>>array['facts','dates',v_key,'date_status'] is distinct from 'occurred'
          or (select count(*) from jsonb_array_elements(v_current#>'{facts,fact_provenance}') p
            where p->>'fact_path'='dates.'||v_key||'.value')<>1
        then raise exception 'LISTING_EFFECTIVE_DATE_UNSUPPORTED'; end if;
        select p into v_provenance from jsonb_array_elements(v_current#>'{facts,fact_provenance}') p
          where p->>'fact_path'='dates.'||v_key||'.value';
        if v_provenance->>'origin' is distinct from 'source_stated'
          or v_provenance->>'evidence_status' is distinct from 'available'
          or v_provenance->>'source_ref' is distinct from v_current#>>array['facts','dates',v_key,'source_ref']
          or public.sec_listing_effective_date_clause(v_provenance->>'evidence',v_date,v_key) is not true
        then raise exception 'LISTING_EFFECTIVE_DATE_UNSUPPORTED'; end if;
      end if;
    end loop;
  end if;
  if p_observation ? 'sourceEvent' then
    perform public.validate_sec_listing_source_event(p_observation);
  elsif p_observation#>>'{reported,listing}'='removal_decision_withdrawn'
    or p_observation#>>'{reported,trading}'='resumed' then
    raise exception 'FOLLOW_UP_SOURCE_REQUIRED';
  end if;
  if v_attach->>'status'='attached' then
    select * into strict v_identity from public.sec_ticker_security_identities where id=(v_attach->>'securityIdentityId')::uuid;
    if v_attach->>'decisionId' is null and v_attach->>'reason'='validated_stable_sec_security_exchange' then
      if public.sec_stable_security_identity_valid(to_jsonb(v_identity)-'created_at') is not true
        or (select (accepted_at at time zone 'UTC')::date from public.sec_cover_observation_results where id=v_identity.after_result_id) > (p_observation->>'filingDate')::date
        or (v_attach->>'knownAt')::timestamptz is distinct from (select accepted_at from public.sec_cover_observation_results where id=v_identity.after_result_id)
        or (case when v_attach ? 'coverRow' then
          public.sec_listing_cover_binding_valid(p_observation,to_jsonb(v_identity)) is not true
        else (lower(regexp_replace(btrim(v_scope->>'securityTitle'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(v_identity.after_security_title),'\s+',' ','g'))
        or lower(regexp_replace(btrim(v_scope->>'exchange'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(v_identity.identity_payload#>>'{after,exchange}'),'\s+',' ','g'))) end)
      then raise exception 'LISTING_STABLE_IDENTITY_MISMATCH'; end if;
    else
      select * into strict v_decision from public.sec_ticker_resolution_decisions where id=(v_attach->>'decisionId')::uuid;
      if v_decision.security_identity_id is distinct from v_identity.id or v_decision.resolution_state<>'AUTO'
        then raise exception 'LISTING_OBSERVATION_IDENTITY_MISMATCH'; end if;
    end if;
    if v_identity.issuer_cik is distinct from v_scope->>'issuerCik'
      or coalesce(v_scope->>'exchange','')='' or coalesce(v_scope->>'securityTitle','')=''
      or coalesce(v_attach->>'proofHash','') !~ '^[a-f0-9]{64}$' or (v_attach->>'knownAt')::timestamptz is null
    then raise exception 'LISTING_OBSERVATION_IDENTITY_MISMATCH'; end if;
  elsif v_attach->>'securityIdentityId' is not null or v_attach->>'decisionId' is not null then
    raise exception 'UNRESOLVED_LISTING_IDENTITY_HAS_ATTACHMENT';
  end if;
  v_hash:=encode(extensions.digest(convert_to(p_observation::text,'UTF8'),'sha256'),'hex');
  insert into public.sec_listing_status_observations(raw_item_id,event_id,security_identity_id,identity_decision_id,
    issuer_cik,security_title,exchange,filing_date,evaluated_as_of,attachment_status,observation,observation_sha256)
  values(v_raw.id,v_event,(v_attach->>'securityIdentityId')::uuid,(v_attach->>'decisionId')::uuid,
    v_scope->>'issuerCik',v_scope->>'securityTitle',v_scope->>'exchange',(p_observation->>'filingDate')::date,
    (p_observation->>'evaluatedAsOf')::date,v_attach->>'status',p_observation,v_hash)
  on conflict(observation_sha256) do nothing returning id into v_id;
  if v_id is null then
    v_status:='replayed'; select id into strict v_id from public.sec_listing_status_observations where observation_sha256=v_hash and observation=p_observation;
  end if;
  return jsonb_build_object('status',v_status,'id',v_id);
end
$fn$;
revoke all on function public.persist_sec_listing_status_observation(jsonb) from public,anon,authenticated;
grant execute on function public.persist_sec_listing_status_observation(jsonb) to service_role;
notify pgrst, 'reload schema';
