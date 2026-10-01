-- Source-versioned observations, independent of events/Monitor eligibility.
-- No current-state row is stored: the validating application reader projects as-of.
create table public.sec_listing_status_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  raw_item_id uuid not null references public.raw_items(id) on delete restrict,
  event_id uuid references public.events(id) on delete restrict,
  security_identity_id uuid references public.sec_ticker_security_identities(id) on delete restrict,
  identity_decision_id uuid references public.sec_ticker_resolution_decisions(id) on delete restrict,
  issuer_cik text,
  security_title text,
  exchange text,
  filing_date date not null,
  evaluated_as_of date not null,
  attachment_status text not null check (attachment_status in ('attached','unresolved','conflict')),
  observation jsonb not null,
  observation_sha256 text not null unique check (observation_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default pg_catalog.now(),
  check (evaluated_as_of >= filing_date),
  check (issuer_cik is null or issuer_cik ~ '^[0-9]{10}$'),
  check ((attachment_status='attached' and security_identity_id is not null and identity_decision_id is not null
    and issuer_cik is not null and security_title is not null and exchange is not null)
    or (attachment_status<>'attached' and security_identity_id is null and identity_decision_id is null)),
  check (jsonb_typeof(observation)='object' and observation->>'version'='sec_listing_observation_v1'),
  check (observation->'reported'->>'listing' in ('confirmed_exchange_delisting','removal_pending','unresolved')),
  check (observation->'reported'->>'trading' in ('suspended','suspension_scheduled','unresolved'))
);
create index sec_listing_observations_raw_idx on public.sec_listing_status_observations(raw_item_id,filing_date,id);
create index sec_listing_observations_scope_idx on public.sec_listing_status_observations(issuer_cik,filing_date,id);
alter table public.sec_listing_status_observations enable row level security;
revoke all on public.sec_listing_status_observations from public,anon,authenticated,service_role;
grant select,insert on public.sec_listing_status_observations to service_role;

create function public.persist_sec_listing_status_observation(p_observation jsonb)
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
    select * into strict v_decision from public.sec_ticker_resolution_decisions where id=(v_attach->>'decisionId')::uuid;
    if v_identity.issuer_cik is distinct from v_scope->>'issuerCik'
      or v_decision.security_identity_id is distinct from v_identity.id or v_decision.resolution_state<>'AUTO'
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
