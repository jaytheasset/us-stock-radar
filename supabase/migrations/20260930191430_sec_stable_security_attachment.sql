-- Stable identity uses the existing append-only identity table, without a ticker-change decision.
create function public.sec_stable_security_identity_valid(p_identity jsonb)
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
    o:=r.result_payload#>'{observations,0}';
    if r.source_state<>'available' or r.observation_count<>1
      or jsonb_array_length(r.result_payload->'observations')<>1
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

create function public.persist_sec_stable_security_identity(p_identity jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_id uuid; v_status text:='inserted'; v_existing public.sec_ticker_security_identities%rowtype;
begin
  if public.sec_stable_security_identity_valid(p_identity) is not true then
    raise exception 'STABLE_SECURITY_IDENTITY_EVIDENCE_MISMATCH'; end if;
  insert into public.sec_issuers(cik) values(p_identity->>'issuer_cik') on conflict(cik) do nothing;
  insert into public.sec_ticker_security_identities(id,issuer_cik,security_type,security_class,
    before_result_id,before_observation_key,after_result_id,after_observation_key,
    before_security_title,after_security_title,identity_method,identity_version,identity_payload,identity_sha256)
  values((p_identity->>'id')::uuid,p_identity->>'issuer_cik',p_identity->>'security_type',p_identity->>'security_class',
    (p_identity->>'before_result_id')::uuid,p_identity->>'before_observation_key',
    (p_identity->>'after_result_id')::uuid,p_identity->>'after_observation_key',
    p_identity->>'before_security_title',p_identity->>'after_security_title',p_identity->>'identity_method',
    p_identity->>'identity_version',p_identity->'identity_payload',p_identity->>'identity_sha256')
  on conflict(identity_sha256) do nothing returning id into v_id;
  if v_id is null then
    v_status:='replayed';
    select * into strict v_existing from public.sec_ticker_security_identities where identity_sha256=p_identity->>'identity_sha256';
    if to_jsonb(v_existing)-'created_at' is distinct from p_identity then raise exception 'STABLE_IDENTITY_REPLAY_MISMATCH'; end if;
    v_id:=v_existing.id;
  end if;
  return jsonb_build_object('id',v_id,'status',v_status);
end
$fn$;
revoke all on function public.persist_sec_stable_security_identity(jsonb) from public,anon,authenticated;
grant execute on function public.persist_sec_stable_security_identity(jsonb) to service_role;

do $fn$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.sec_listing_status_observations'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%identity_decision_id%'
  loop execute format('alter table public.sec_listing_status_observations drop constraint %I',c.conname); end loop;
end
$fn$;
alter table public.sec_listing_status_observations add constraint sec_listing_identity_attachment_check check (
  (attachment_status='attached' and security_identity_id is not null and issuer_cik is not null
    and security_title is not null and exchange is not null
    and (identity_decision_id is not null or observation#>>'{attachment,reason}'='validated_stable_sec_security_exchange'))
  or (attachment_status<>'attached' and security_identity_id is null and identity_decision_id is null));

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
    or coalesce(p_observation->'reported'->>'listing','') not in ('confirmed_exchange_delisting','removal_pending','unresolved')
    or coalesce(p_observation->'reported'->>'trading','') not in ('suspended','suspension_scheduled','unresolved')
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
  else
    if v_event is null or not exists(select 1 from public.events where id=v_event and raw_item_id=v_raw.id and source_code='sec_edgar')
      then raise exception 'LISTING_OBSERVATION_EVENT_MISMATCH'; end if;
    if v_context->>'status'='available' and not exists (
      select 1 from public.event_listing_risk_facts f where f.source_execution_id=(v_context->>'sourceExecutionId')::uuid
        and f.event_id=v_event and f.raw_item_id=v_raw.id and f.facts_payload=v_context->'facts'
        and f.parent_primary_ai_run_id=(v_context->>'parentPrimaryAiRunId')::uuid
    ) then raise exception 'LISTING_OBSERVATION_CONTEXT_MISMATCH'; end if;
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
