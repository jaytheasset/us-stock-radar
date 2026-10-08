-- Reuse the durable ai_runs queue and immutable ai_outputs store. No canonical market O/S write.
create unique index sec_offering_plan_key on public.ai_runs ((metadata->'binding'->>'key')) where prompt_key='sec_offering_plan';
create unique index sec_offering_plan_output on public.ai_outputs(ai_run_id) where output_type='sec_offering_plan';
create table public.sec_offering_plan_decisions (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.ai_runs(id),
  actor_user_id uuid not null references auth.users(id), action text not null check(action in ('approve','hold','reject','retry')),
  candidate_indexes jsonb not null default '[]', reason text not null check(length(reason) between 1 and 2000),
  request_id uuid not null unique, created_at timestamptz not null default now()
);
create index sec_offering_plan_decisions_run on public.sec_offering_plan_decisions(run_id,created_at);
alter table public.sec_offering_plan_decisions enable row level security;
revoke all on public.sec_offering_plan_decisions from public,anon,authenticated;
grant select,insert on public.sec_offering_plan_decisions to service_role;

create function public.reserve_sec_offering_plan(p_binding jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; added boolean; fn text; rn text; family jsonb;
begin
  -- Fast replay does not deserialize/compare the multi-megabyte retained source again.
  select * into a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if found then
    if a.prompt_key is distinct from 'sec_offering_plan' or a.raw_item_id is distinct from (p_binding->>'rawItemId')::uuid
      or a.metadata->'binding'->>'key' is distinct from p_binding->>'key' then raise exception 'offering_identity_conflict'; end if;
    return jsonb_build_object('id',a.id,'inserted',false,'status',a.metadata->>'offeringStatus');
  end if;
  select * into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
  if r.source_code is distinct from 'sec_edgar'
    or r.source_unique_id is distinct from p_binding->'source'->'filing'->>'accession'
    or r.raw_payload->>'form_type' not in ('F-1','F-1/A')
    or (nullif(r.raw_payload->>'os_snapshot_primary_html','') is null and r.raw_payload->>'primary_document_html_truncated' is distinct from 'false')
    or coalesce(nullif(r.raw_payload->>'os_snapshot_primary_html',''),r.raw_payload->>'primary_document_html') is distinct from p_binding->'source'->'documents'->0->>'original'
    or r.raw_payload->>'accession_number' is distinct from p_binding->'source'->'filing'->>'accession'
    or r.raw_payload->>'company_name' is distinct from p_binding->'source'->'filing'->>'issuer'
    or lpad(r.raw_payload->>'cik',10,'0') is distinct from p_binding->'source'->'filing'->>'cik'
    or r.raw_payload->>'filing_date' is distinct from p_binding->'source'->'filing'->>'filing_date'
    or r.raw_payload->>'form_type' is distinct from p_binding->'source'->'filing'->>'form'
    or nullif(btrim(r.raw_payload->>'accepted_at'),'') is distinct from p_binding->'source'->'filing'->>'accepted_at'
    or nullif(btrim(r.raw_payload->>'file_number'),'') is distinct from p_binding->'source'->'filing'->>'file_number'
    or nullif(btrim(r.raw_payload->>'registration_number'),'') is distinct from p_binding->'source'->'filing'->>'registration_number'
    or coalesce(p_binding->>'key','') !~ '^[0-9a-f]{64}$'
    then raise exception 'offering_source_binding_mismatch'; end if;
  fn:=nullif(btrim(r.raw_payload->>'file_number'),''); rn:=nullif(btrim(r.raw_payload->>'registration_number'),'');
  if fn is not null and rn is not null and fn<>rn then
    family:=jsonb_build_object('status','conflicting','key',null,'number',null);
  elsif coalesce(fn,rn) is null or coalesce(fn,rn) !~ '^[0-9]{3}-[0-9]+$' then
    family:=jsonb_build_object('status','unavailable','key',null,'number',null);
  else
    family:=jsonb_build_object('status','confirmed','key',lpad(r.raw_payload->>'cik',10,'0')||':'||coalesce(fn,rn),'number',coalesce(fn,rn));
  end if;
  if p_binding->'family' is distinct from family then raise exception 'offering_family_binding_mismatch'; end if;
  insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
    values((p_binding->>'id')::uuid,r.id,'sec_offering_plan',p_binding->>'contractVersion',p_binding->>'providerProfile','pending',
      jsonb_build_object('binding',p_binding,'offeringStatus','QUEUED','attempt',1,'reservedAt',now())) on conflict do nothing;
  added := found;
  select * into strict a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if a.metadata->'binding' is distinct from p_binding then raise exception 'offering_identity_conflict'; end if;
  return jsonb_build_object('id',a.id,'inserted',added,'status',a.metadata->>'offeringStatus');
end $$;

create function public.sec_offering_plan_transition(p_id uuid,p_action text,p_token text default null,p_value jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; tok text; t timestamptz:=clock_timestamp(); cp jsonb;
begin
  -- Serialize claims across the entire provider, not just one filing.
  perform pg_advisory_xact_lock(728193,1);
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_offering_plan' for update;
  if a.metadata->>'offeringStatus' not in ('QUEUED','RUNNING') then
    return jsonb_build_object('claimed',false,'status',a.metadata->>'offeringStatus');
  end if;
  if p_action='claim' then
    if exists(select 1 from public.ai_runs where prompt_key='sec_offering_plan' and metadata->>'offeringStatus'='RUNNING'
      and (metadata->>'leaseUntil')::timestamptz>t) then return jsonb_build_object('claimed',false,'status','busy'); end if;
    tok:=gen_random_uuid()::text;
    update public.ai_runs set status='running',started_at=coalesce(started_at,t),metadata=metadata||jsonb_build_object('offeringStatus','RUNNING','token',tok,'leaseUntil',t+interval '90 seconds') where id=p_id;
    return jsonb_build_object('claimed',true,'token',tok,'binding',a.metadata->'binding','attempt',a.metadata->'attempt','checkpoint',a.metadata->'offeringCheckpoint');
  end if;
  if a.metadata->>'token' is distinct from p_token or (a.metadata->>'leaseUntil')::timestamptz<=t then raise exception 'offering_lease_lost'; end if;
  if p_action='heartbeat' then
    update public.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',t+interval '90 seconds') where id=p_id;
  elsif p_action='provider_started' then
    if a.metadata ? 'offeringJournal' and a.metadata->>'offeringJournal' is distinct from p_value->>'journalId' then raise exception 'offering_journal_location_changed'; end if;
    if a.metadata->>'invocationAttempt'=a.metadata->>'attempt' then return jsonb_build_object('recoverOnly',true); end if;
    if nullif(p_value->>'journalId','') is null then raise exception 'offering_journal_required'; end if;
    update public.ai_runs set metadata=metadata||jsonb_build_object('offeringJournal',p_value->>'journalId','invocationAttempt',metadata->'attempt') where id=p_id;
    return jsonb_build_object('recoverOnly',false);
  elsif p_action='checkpoint' then
    if p_value->>'status' not in ('PASS','REVIEW_REQUIRED','NO_DIRECT_OFFERING_PLAN','VALIDATION_FAILED','TECHNICAL_FAILED')
      or p_value->>'rawHash' is distinct from encode(sha256(case when nullif(p_value->'provider'->>'rawBytesBase64','') is not null then decode(p_value->'provider'->>'rawBytesBase64','base64') else convert_to(p_value->>'raw','UTF8') end),'hex') then raise exception 'offering_invalid_checkpoint'; end if;
    if a.metadata ? 'offeringCheckpoint' and a.metadata->'offeringCheckpoint' is distinct from p_value then raise exception 'offering_checkpoint_immutable'; end if;
    update public.ai_runs set metadata=metadata||jsonb_build_object('offeringCheckpoint',p_value) where id=p_id;
  elsif p_action='finish' then
    cp:=a.metadata->'offeringCheckpoint';
    if cp is null then raise exception 'offering_checkpoint_required'; end if;
    -- Technical attempts remain in metadata history; only the first final output can occupy ai_outputs.
    if cp->>'status'<>'TECHNICAL_FAILED' then
      insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_offering_plan',cp);
    end if;
    update public.ai_runs set status=case when cp->>'status' in ('TECHNICAL_FAILED','VALIDATION_FAILED') then 'failed' else 'succeeded' end,
      finished_at=t,metadata=metadata||jsonb_build_object('offeringStatus',cp->>'status') where id=p_id;
  else raise exception 'offering_unknown_transition'; end if;
  return jsonb_build_object('status',coalesce(cp->>'status','ok'));
end $$;

create function public.decide_sec_offering_plan(p_id uuid,p_actor uuid,p_action text,p_indexes jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; old public.sec_offering_plan_decisions; candidate_count integer; idx jsonb;
begin
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_offering_plan' for update;
  if p_reason is null or length(btrim(p_reason))=0 or length(p_reason)>2000 or jsonb_typeof(p_indexes) is distinct from 'array' then raise exception 'offering_decision_invalid'; end if;
  select * into old from public.sec_offering_plan_decisions where request_id=p_request;
  if found then
    if old.run_id<>p_id or old.actor_user_id<>p_actor or old.action<>p_action or old.candidate_indexes<>p_indexes or old.reason<>p_reason then raise exception 'offering_decision_conflict'; end if;
    return jsonb_build_object('id',old.id,'replayed',true);
  end if;
  if not exists(select 1 from public.admin_role_assignments where user_id=p_actor and active and role in ('super_admin','operations')) then raise exception 'offering_admin_required'; end if;
  if p_action='retry' then
    if jsonb_array_length(p_indexes)<>0 then raise exception 'offering_candidates_forbidden'; end if;
    if a.metadata->>'offeringStatus'<>'TECHNICAL_FAILED' or (coalesce(a.metadata->'offeringCheckpoint'->>'raw','')<>'' or coalesce(a.metadata->'offeringCheckpoint'->'provider'->>'rawBytesBase64','')<>'') or a.metadata->'offeringCheckpoint'->'provider'->>'retrySafe' is distinct from 'true' then raise exception 'offering_retry_forbidden'; end if;
    update public.ai_runs set status='pending',started_at=null,finished_at=null,
      metadata=(metadata-'offeringCheckpoint'-'token'-'leaseUntil')||jsonb_build_object('offeringStatus','QUEUED','attempt',(metadata->>'attempt')::integer+1,
      'technicalHistory',coalesce(metadata->'technicalHistory','[]')||jsonb_build_array(metadata->'offeringCheckpoint')) where id=p_id;
  else
    if a.metadata->>'offeringStatus'<>'REVIEW_REQUIRED' or p_action not in ('approve','hold','reject') then raise exception 'offering_review_forbidden'; end if;
    if jsonb_typeof(p_indexes) is distinct from 'array' then raise exception 'offering_indexes_invalid'; end if;
    candidate_count:=jsonb_array_length(a.metadata->'offeringCheckpoint'->'validated'->'review'->'candidates');
    if p_action='approve' and jsonb_array_length(p_indexes)<>1 then raise exception 'offering_candidate_required'; end if;
    if p_action<>'approve' and jsonb_array_length(p_indexes)<>0 then raise exception 'offering_candidates_forbidden'; end if;
    for idx in select value from jsonb_array_elements(p_indexes) loop
      if jsonb_typeof(idx)<>'number' or idx::text !~ '^[0-9]+$' or (idx::text)::integer>=candidate_count then raise exception 'offering_candidate_invalid'; end if;
    end loop;
  end if;
  insert into public.sec_offering_plan_decisions(run_id,actor_user_id,action,candidate_indexes,reason,request_id)
    values(p_id,p_actor,p_action,p_indexes,p_reason,p_request) returning * into old;
  return jsonb_build_object('id',old.id,'replayed',false);
end $$;

create function public.guard_sec_offering_plan() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='sec_offering_plan_decisions' then raise exception 'offering_decisions_immutable'; end if;
  if tg_table_name='ai_outputs' then
    if old.output_type='sec_offering_plan' or (tg_op='UPDATE' and new.output_type='sec_offering_plan') then raise exception 'offering_output_immutable'; end if;
  elsif old.prompt_key='sec_offering_plan' or (tg_op='UPDATE' and new.prompt_key='sec_offering_plan') then
    if tg_op='DELETE' then raise exception 'offering_run_immutable'; end if;
    if new.metadata->'binding' is distinct from old.metadata->'binding' or new.raw_item_id is distinct from old.raw_item_id
      or new.prompt_key is distinct from old.prompt_key or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
      or (old.metadata->>'offeringStatus' in ('PASS','REVIEW_REQUIRED','NO_DIRECT_OFFERING_PLAN','VALIDATION_FAILED') and new is distinct from old)
      then raise exception 'offering_history_immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger guard_offering_runs before update or delete on public.ai_runs for each row execute function public.guard_sec_offering_plan();
create trigger guard_offering_outputs before update or delete on public.ai_outputs for each row execute function public.guard_sec_offering_plan();
create trigger guard_offering_decisions before update or delete on public.sec_offering_plan_decisions for each row execute function public.guard_sec_offering_plan();
revoke all on function public.reserve_sec_offering_plan(jsonb), public.sec_offering_plan_transition(uuid,text,text,jsonb), public.decide_sec_offering_plan(uuid,uuid,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_sec_offering_plan(jsonb), public.sec_offering_plan_transition(uuid,text,text,jsonb), public.decide_sec_offering_plan(uuid,uuid,text,jsonb,text,uuid) to service_role;
notify pgrst,'reload schema';

-- A shared claim guard also protects callers of the unchanged O/S RPC.
create function public.guard_sec_codex_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if new.prompt_key in ('sec_os_snapshot','sec_offering_plan')
 and coalesce(new.metadata->>'osStatus',new.metadata->>'offeringStatus')='RUNNING'
 and new.metadata->>'token' is distinct from old.metadata->>'token' then
  perform pg_advisory_xact_lock(728193,1);
  if exists(select 1 from public.ai_runs r where r.id<>new.id and r.prompt_key in ('sec_os_snapshot','sec_offering_plan')
   and coalesce(r.metadata->>'osStatus',r.metadata->>'offeringStatus')='RUNNING' and (r.metadata->>'leaseUntil')::timestamptz>clock_timestamp()) then raise exception 'sec_codex_provider_busy'; end if;
 end if;
 return new;
end $$;
create trigger guard_sec_codex_claim before update on public.ai_runs for each row execute function public.guard_sec_codex_claim();
revoke all on function public.guard_sec_codex_claim(), public.guard_sec_offering_plan() from public,anon,authenticated;
-- PostgREST hoists these per-RPC bounds. Whole filings exceed the shared 8s default;
-- leave the database roles and all existing O/S RPC settings unchanged.
alter function public.reserve_sec_offering_plan(jsonb) set statement_timeout='30s';
alter function public.sec_offering_plan_transition(uuid,text,text,jsonb) set statement_timeout='30s';
alter function public.decide_sec_offering_plan(uuid,uuid,text,jsonb,text,uuid) set statement_timeout='30s';
notify pgrst,'reload schema';
