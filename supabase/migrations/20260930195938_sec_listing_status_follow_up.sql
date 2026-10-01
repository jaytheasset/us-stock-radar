-- Narrow, explicit 8-K/6-K source events and immutable predecessor links.
-- Existing Form 25 and Listing Risk contracts remain unchanged. No automatic hook.
do $fn$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.sec_listing_status_observations'::regclass
 and contype='c' and (pg_get_constraintdef(oid) like '%confirmed_exchange_delisting%' or pg_get_constraintdef(oid) like '%suspension_scheduled%')
 loop execute format('alter table public.sec_listing_status_observations drop constraint %I',c.conname); end loop;
end $fn$;
alter table public.sec_listing_status_observations add constraint sec_listing_reported_listing_check
 check (observation#>>'{reported,listing}' in ('confirmed_exchange_delisting','removal_pending','removal_decision_withdrawn','unresolved'));
alter table public.sec_listing_status_observations add constraint sec_listing_reported_trading_check
 check (observation#>>'{reported,trading}' in ('suspended','suspension_scheduled','resumed','unresolved'));

create function public.validate_sec_listing_source_event(o jsonb)
returns void language plpgsql stable security invoker set search_path='' as $fn$
declare e jsonb:=o->'sourceEvent'; r jsonb:=e->'resolves'; target public.sec_listing_status_observations%rowtype;
 doc text; kind text:=e->>'kind'; p jsonb:=o#>'{sourceSnapshot,raw_payload}';
begin
 if o->>'form' !~ '^(8-K|6-K)(/A)?$' or e->>'version' is distinct from 'listing_source_event_v1'
   or kind is null or kind not in ('removal_decision','trading_suspension','removal_decision_withdrawn','trading_resumed')
   or coalesce(length(e->>'quote'),0) not between 40 and 2400 or coalesce(length(e->>'issue'),0)<8
   or coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (e->>'date')::date>(o->>'filingDate')::date
   or e->>'securityText' is distinct from o#>>'{scope,securityTitle}'
   or e->>'exchangeText' is distinct from o#>>'{scope,exchange}'
   or lpad(p->>'cik',10,'0') is distinct from o#>>'{scope,issuerCik}'
   or o->'listingRisk' is distinct from 'null'::jsonb
 then raise exception 'INVALID_SOURCE_EVENT'; end if;
 if e->>'documentUrl'=p->>'primary_document_url' then doc:=p->>'primary_document_html';
 else select x->>'text' into strict doc from jsonb_array_elements(coalesce(p->'attachment_texts','[]'::jsonb)) x where x->>'url'=e->>'documentUrl'; end if;
 if doc is null or encode(extensions.digest(convert_to(doc,'UTF8'),'sha256'),'hex') is distinct from e->>'documentHash'
 then raise exception 'SOURCE_EVENT_DOCUMENT_MISMATCH'; end if;
 if o#>>'{reported,listing}' is distinct from (case kind when 'removal_decision' then 'removal_pending' when 'removal_decision_withdrawn' then 'removal_decision_withdrawn' else 'unresolved' end)
 or o#>>'{reported,trading}' is distinct from (case kind when 'trading_suspension' then 'suspended' when 'trading_resumed' then 'resumed' else 'unresolved' end)
 then raise exception 'SOURCE_EVENT_STATE_MISMATCH'; end if;
 if kind in ('removal_decision_withdrawn','trading_resumed') then
   if r is null then raise exception 'SOURCE_EVENT_TARGET_REQUIRED'; end if;
   select * into strict target from public.sec_listing_status_observations where id=(r->>'observationId')::uuid;
   if target.observation->>'sourceHash' is distinct from r->>'sourceHash'
     or target.observation->'scope' is distinct from o->'scope'
     or target.filing_date > (o->>'filingDate')::date
     or (target.filing_date = (o->>'filingDate')::date and target.raw_item_id is distinct from (o->>'rawItemId')::uuid)
     or target.observation#>>'{sourceEvent,date}' is distinct from r->>'eventDate'
     or target.observation#>>'{sourceEvent,issue}' is distinct from e->>'issue'
     or (r->>'eventDate')::date >= (e->>'date')::date
     or target.observation#>>'{sourceEvent,kind}' is distinct from (case kind when 'removal_decision_withdrawn' then 'removal_decision' else 'trading_suspension' end)
   then raise exception 'SOURCE_EVENT_TARGET_MISMATCH'; end if;
 elsif r is not null then raise exception 'UNEXPECTED_SOURCE_EVENT_TARGET'; end if;
end $fn$;
revoke all on function public.validate_sec_listing_source_event(jsonb) from public,anon,authenticated;
grant execute on function public.validate_sec_listing_source_event(jsonb) to service_role;

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
        or lower(regexp_replace(btrim(v_scope->>'securityTitle'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(v_identity.after_security_title),'\s+',' ','g'))
        or lower(regexp_replace(btrim(v_scope->>'exchange'),'\s+',' ','g')) is distinct from lower(regexp_replace(btrim(v_identity.identity_payload#>>'{after,exchange}'),'\s+',' ','g'))
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
