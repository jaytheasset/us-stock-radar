-- Stable identity uses the existing append-only identity table, without a ticker-change decision.
create or replace function public.sec_stable_security_identity_valid(p_identity jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare
  b public.sec_cover_observation_results%rowtype; a public.sec_cover_observation_results%rowtype;
  r public.sec_cover_observation_results%rowtype; o jsonb; expected jsonb; side text;
  bp jsonb:=p_identity#>'{identity_payload,before}'; ap jsonb:=p_identity#>'{identity_payload,after}';
begin
  select * into b from public.sec_cover_observation_results where id=(p_identity->>'before_result_id')::uuid;
  select * into a from public.sec_cover_observation_results where id=(p_identity->>'after_result_id')::uuid;
  if b.id is null or a.id is null or b.accepted_at is null or a.accepted_at is null
    or b.accepted_at>=a.accepted_at or b.accession_number=a.accession_number
    or b.issuer_cik is distinct from a.issuer_cik or b.issuer_cik is distinct from p_identity->>'issuer_cik'
    or p_identity->>'security_type' is distinct from 'common_stock'
    or p_identity->>'identity_method' is distinct from 'sec-cover-security-continuity'
    or p_identity->>'identity_version' is distinct from 'sec-ticker-security-identity-v1'
    or p_identity#>>'{identity_payload,issuerCik}' is distinct from b.issuer_cik
    or p_identity#>>'{identity_payload,securityType}' is distinct from p_identity->>'security_type'
    or p_identity#>>'{identity_payload,securityClass}' is distinct from p_identity->>'security_class'
    or bp->>'tradingSymbol' is distinct from ap->>'tradingSymbol'
    or lower(regexp_replace(btrim(bp->>'securityTitle'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(ap->>'securityTitle'),'\s+',' ','g'))
    or lower(regexp_replace(btrim(bp->>'exchange'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(ap->>'exchange'),'\s+',' ','g'))
    or bp->'dimensions' is distinct from ap->'dimensions'
  then return false; end if;
  foreach side in array array['before','after'] loop
    if side='before' then r:=b; else r:=a; end if;
    if (select count(*) from jsonb_array_elements(r.result_payload->'observations') x
      where x->>'observationKey'=p_identity->>(side||'_observation_key'))<>1 then return false; end if;
    select x into o from jsonb_array_elements(r.result_payload->'observations') x
      where x->>'observationKey'=p_identity->>(side||'_observation_key');
    if r.source_state<>'available' or r.observation_count<>jsonb_array_length(r.result_payload->'observations')
      or o#>>'{securityTitle,parsedTextValue}' ~* '\m(rights?|warrants?|units?)\M'
      or exists(select 1 from jsonb_array_elements(r.result_payload->'observations') sibling
        where sibling->>'observationKey' is distinct from o->>'observationKey' and (
          coalesce(sibling#>>'{securityTitle,parsedTextValue}','')='' or coalesce(sibling#>>'{tradingSymbol,parsedTextValue}','')=''
          or lower(regexp_replace(btrim(sibling#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g'))=lower(regexp_replace(btrim(o#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g'))
          or lower(btrim(sibling#>>'{tradingSymbol,parsedTextValue}'))=lower(btrim(o#>>'{tradingSymbol,parsedTextValue}'))))
      or coalesce(o#>>'{securityTitle,status}','') not in ('observed','duplicate_equal')
      or coalesce(o#>>'{tradingSymbol,status}','') not in ('observed','duplicate_equal')
      or coalesce(o#>>'{exchange,status}','') not in ('observed','duplicate_equal')
      or coalesce(o#>>'{tradingSymbol,parsedTextValue}','')=''
      or coalesce(o#>>'{securityTitle,parsedTextValue}','')=''
      or coalesce(o#>>'{exchange,parsedTextValue}','')=''
      or not exists(select 1 from public.sec_structured_raw_sources s where s.id=r.source_raw_id
        and s.cik=r.issuer_cik and s.content_hash=r.source_sha256
        and encode(extensions.digest(convert_to(s.raw_content,'UTF8'),'sha256'),'hex')=r.source_sha256)
      or exists(select 1 from public.sec_cover_observation_results rev where rev.accession_number=r.accession_number
        and rev.source_kind=r.source_kind and rev.source_url=r.source_url and rev.source_document=r.source_document
        and rev.source_sha256 is distinct from r.source_sha256)
    then return false; end if;
    expected:=jsonb_build_object('resultId',r.id,'observationKey',o->>'observationKey',
      'accessionNumber',r.accession_number,'contextRef',o->>'contextRef',
      'securityTitle',o#>>'{securityTitle,parsedTextValue}','tradingSymbol',o#>>'{tradingSymbol,parsedTextValue}',
      'exchange',o#>>'{exchange,parsedTextValue}','dimensions',o#>'{context,dimensions}');
    if p_identity->'identity_payload'->side is distinct from expected
      or p_identity->>(side||'_observation_key') is distinct from o->>'observationKey'
      or p_identity->>(side||'_security_title') is distinct from o#>>'{securityTitle,parsedTextValue}'
    then return false; end if;
  end loop;
  return true;
end
$fn$;
revoke all on function public.sec_stable_security_identity_valid(jsonb) from public,anon,authenticated;
grant execute on function public.sec_stable_security_identity_valid(jsonb) to service_role;


-- Source-event aliases are restricted to par-value descriptions / legal LLC suffix.
-- This does not change Form 25 scope handling or the ticker-change writer.
create or replace function public.sec_listing_cover_binding_valid(p_observation jsonb,p_identity jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare
  c jsonb:=p_observation#>'{attachment,coverRow}'; s jsonb:=p_observation->'scope';
  r public.sec_cover_observation_results%rowtype; o jsonb; x jsonb; matches integer:=0;
  title_pattern text:=',\s*(par value\s+\$[\d.]+|\$[\d.]+\s+par value)(\s+per share)?$';
begin
  if p_observation->>'form' !~ '^(8-K|6-K)(/A)?$' or p_observation->'sourceEvent' is null
    or jsonb_typeof(c) is distinct from 'object' then return false; end if;
  select * into r from public.sec_cover_observation_results where id=(c->>'resultId')::uuid;
  if r.id is null or r.raw_item_id is distinct from (p_observation->>'rawItemId')::uuid
    or r.issuer_cik is distinct from s->>'issuerCik' or r.source_sha256 is distinct from c->>'sourceHash'
    or r.source_sha256 is distinct from encode(extensions.digest(convert_to(p_observation#>>'{sourceSnapshot,raw_payload,primary_document_html}','UTF8'),'sha256'),'hex')
    or r.source_state<>'available' then return false; end if;
  for x in select value from jsonb_array_elements(r.result_payload->'observations') loop
    if lower(regexp_replace(btrim(s->>'securityTitle'),'\s+',' ','g')) in (
      lower(regexp_replace(btrim(x#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g')),
      regexp_replace(lower(regexp_replace(btrim(x#>>'{securityTitle,parsedTextValue}'),'\s+',' ','g')),title_pattern,''))
      and lower(regexp_replace(btrim(s->>'exchange'),'\s+',' ','g')) in (
      lower(regexp_replace(btrim(x#>>'{exchange,parsedTextValue}'),'\s+',' ','g')),
      regexp_replace(lower(regexp_replace(btrim(x#>>'{exchange,parsedTextValue}'),'\s+',' ','g')),'\s+llc$','')) then
      matches:=matches+1; o:=x;
    end if;
  end loop;
  if matches<>1 or o->>'observationKey' is distinct from c->>'observationKey'
    or o#>>'{securityTitle,parsedTextValue}' is distinct from c->>'securityTitle'
    or o#>>'{tradingSymbol,parsedTextValue}' is distinct from c->>'ticker'
    or o#>>'{exchange,parsedTextValue}' is distinct from c->>'exchange'
    or coalesce(o#>>'{securityTitle,status}','') not in ('observed','duplicate_equal')
    or coalesce(o#>>'{tradingSymbol,status}','') not in ('observed','duplicate_equal')
    or coalesce(o#>>'{exchange,status}','') not in ('observed','duplicate_equal')
    or o#>>'{securityTitle,parsedTextValue}' ~* '\m(rights?|warrants?|units?)\M'
    or lower(btrim(c->>'ticker')) in ('none','n/a','')
    or lower(regexp_replace(btrim(c->>'securityTitle'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(p_identity->>'after_security_title'),'\s+',' ','g'))
    or lower(regexp_replace(btrim(c->>'exchange'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(p_identity#>>'{identity_payload,after,exchange}'),'\s+',' ','g'))
    or c->>'ticker' is distinct from p_identity#>>'{identity_payload,after,tradingSymbol}'
    or exists(select 1 from jsonb_array_elements(r.result_payload->'observations') sibling
      where sibling->>'observationKey' is distinct from o->>'observationKey' and (
        coalesce(sibling#>>'{securityTitle,parsedTextValue}','')='' or coalesce(sibling#>>'{tradingSymbol,parsedTextValue}','')=''
        or coalesce(sibling#>>'{exchange,parsedTextValue}','')=''
        or lower(btrim(sibling#>>'{tradingSymbol,parsedTextValue}'))=lower(btrim(c->>'ticker'))))
  then return false; end if;
  return true;
end $fn$;
revoke all on function public.sec_listing_cover_binding_valid(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sec_listing_cover_binding_valid(jsonb,jsonb) to service_role;

create or replace function public.persist_sec_listing_status_observation(p_observation jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
  v_raw public.raw_items%rowtype; v_identity public.sec_ticker_security_identities%rowtype;
  v_decision public.sec_ticker_resolution_decisions%rowtype;
  v_snapshot jsonb; v_scope jsonb:=p_observation->'scope'; v_attach jsonb:=p_observation->'attachment';
  v_hash text; v_id uuid; v_event uuid; v_status text:='inserted'; v_context jsonb;
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
    if v_context->>'status'='available' and not exists (
      select 1 from public.event_listing_risk_facts f where f.source_execution_id=(v_context->>'sourceExecutionId')::uuid
        and f.event_id=v_event and f.raw_item_id=v_raw.id and f.facts_payload=v_context->'facts'
        and f.parent_primary_ai_run_id=(v_context->>'parentPrimaryAiRunId')::uuid
    ) then raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
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
