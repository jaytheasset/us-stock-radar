-- Reuse the durable ai_runs queue and immutable ai_outputs store. No canonical market O/S write.
create unique index sec_os_snapshot_key on public.ai_runs ((metadata->'binding'->>'key')) where prompt_key='sec_os_snapshot';
create unique index sec_os_snapshot_output on public.ai_outputs(ai_run_id) where output_type='sec_os_snapshot';
create table public.sec_os_snapshot_decisions (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.ai_runs(id),
  actor_user_id uuid not null references auth.users(id), action text not null check(action in ('approve','hold','reject','retry')),
  candidate_indexes jsonb not null default '[]', reason text not null check(length(reason) between 1 and 2000),
  request_id uuid not null unique, created_at timestamptz not null default now()
);
create index sec_os_snapshot_decisions_run on public.sec_os_snapshot_decisions(run_id,created_at);
alter table public.sec_os_snapshot_decisions enable row level security;
revoke all on public.sec_os_snapshot_decisions from public,anon,authenticated;
grant select,insert on public.sec_os_snapshot_decisions to service_role;

create function public.reserve_sec_os_snapshot(p_binding jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; added boolean;
begin
  -- Fast replay does not deserialize/compare the multi-megabyte retained source again.
  select * into a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if found then
    if a.prompt_key is distinct from 'sec_os_snapshot' or a.raw_item_id is distinct from (p_binding->>'rawItemId')::uuid
      or a.metadata->'binding'->>'key' is distinct from p_binding->>'key' then raise exception 'os_identity_conflict'; end if;
    return jsonb_build_object('id',a.id,'inserted',false,'status',a.metadata->>'osStatus');
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
    or coalesce(p_binding->>'key','') !~ '^[0-9a-f]{64}$'
    then raise exception 'os_source_binding_mismatch'; end if;
  insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
    values((p_binding->>'id')::uuid,r.id,'sec_os_snapshot',p_binding->>'contractVersion',p_binding->>'providerProfile','pending',
      jsonb_build_object('binding',p_binding,'osStatus','QUEUED','attempt',1,'reservedAt',now())) on conflict do nothing;
  added := found;
  select * into strict a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if a.metadata->'binding' is distinct from p_binding then raise exception 'os_identity_conflict'; end if;
  return jsonb_build_object('id',a.id,'inserted',added,'status',a.metadata->>'osStatus');
end $$;

create function public.sec_os_snapshot_transition(p_id uuid,p_action text,p_token text default null,p_value jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; tok text; t timestamptz:=clock_timestamp(); cp jsonb;
begin
  -- Serialize claims across the entire provider, not just one filing.
  perform pg_advisory_xact_lock(728193,1);
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_os_snapshot' for update;
  if a.metadata->>'osStatus' not in ('QUEUED','RUNNING') then
    return jsonb_build_object('claimed',false,'status',a.metadata->>'osStatus');
  end if;
  if p_action='claim' then
    if exists(select 1 from public.ai_runs where prompt_key='sec_os_snapshot' and metadata->>'osStatus'='RUNNING'
      and (metadata->>'leaseUntil')::timestamptz>t) then return jsonb_build_object('claimed',false,'status','busy'); end if;
    tok:=gen_random_uuid()::text;
    update public.ai_runs set status='running',started_at=coalesce(started_at,t),metadata=metadata||jsonb_build_object('osStatus','RUNNING','token',tok,'leaseUntil',t+interval '90 seconds') where id=p_id;
    return jsonb_build_object('claimed',true,'token',tok,'binding',a.metadata->'binding','attempt',a.metadata->'attempt','checkpoint',a.metadata->'osCheckpoint');
  end if;
  if a.metadata->>'token' is distinct from p_token or (a.metadata->>'leaseUntil')::timestamptz<=t then raise exception 'os_lease_lost'; end if;
  if p_action='heartbeat' then
    update public.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',t+interval '90 seconds') where id=p_id;
  elsif p_action='provider_started' then
    if a.metadata ? 'osJournal' and a.metadata->>'osJournal' is distinct from p_value->>'journalId' then raise exception 'os_journal_location_changed'; end if;
    if a.metadata->>'invocationAttempt'=a.metadata->>'attempt' then return jsonb_build_object('recoverOnly',true); end if;
    if nullif(p_value->>'journalId','') is null then raise exception 'os_journal_required'; end if;
    update public.ai_runs set metadata=metadata||jsonb_build_object('osJournal',p_value->>'journalId','invocationAttempt',metadata->'attempt') where id=p_id;
    return jsonb_build_object('recoverOnly',false);
  elsif p_action='checkpoint' then
    if p_value->>'status' not in ('PASS','REVIEW_REQUIRED','NO_DIRECT_CURRENT_OS','VALIDATION_FAILED','TECHNICAL_FAILED')
      or p_value->>'rawHash' is distinct from encode(sha256(convert_to(p_value->>'raw','UTF8')),'hex') then raise exception 'os_invalid_checkpoint'; end if;
    if a.metadata ? 'osCheckpoint' and a.metadata->'osCheckpoint' is distinct from p_value then raise exception 'os_checkpoint_immutable'; end if;
    update public.ai_runs set metadata=metadata||jsonb_build_object('osCheckpoint',p_value) where id=p_id;
  elsif p_action='finish' then
    cp:=a.metadata->'osCheckpoint';
    if cp is null then raise exception 'os_checkpoint_required'; end if;
    -- Technical attempts remain in metadata history; only the first final output can occupy ai_outputs.
    if cp->>'status'<>'TECHNICAL_FAILED' then
      insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_os_snapshot',cp);
    end if;
    update public.ai_runs set status=case when cp->>'status' in ('TECHNICAL_FAILED','VALIDATION_FAILED') then 'failed' else 'succeeded' end,
      finished_at=t,metadata=metadata||jsonb_build_object('osStatus',cp->>'status') where id=p_id;
  else raise exception 'os_unknown_transition'; end if;
  return jsonb_build_object('status',coalesce(cp->>'status','ok'));
end $$;

create function public.decide_sec_os_snapshot(p_id uuid,p_actor uuid,p_action text,p_indexes jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; old public.sec_os_snapshot_decisions; candidate_count integer; idx jsonb;
begin
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_os_snapshot' for update;
  select * into old from public.sec_os_snapshot_decisions where request_id=p_request;
  if found then
    if old.run_id<>p_id or old.actor_user_id<>p_actor or old.action<>p_action or old.candidate_indexes<>p_indexes or old.reason<>p_reason then raise exception 'os_decision_conflict'; end if;
    return jsonb_build_object('id',old.id,'replayed',true);
  end if;
  if not exists(select 1 from public.admin_role_assignments where user_id=p_actor and active and role in ('super_admin','operations')) then raise exception 'os_admin_required'; end if;
  if p_action='retry' then
    if a.metadata->>'osStatus'<>'TECHNICAL_FAILED' or coalesce(a.metadata->'osCheckpoint'->>'raw','')<>'' or a.metadata->'osCheckpoint'->'provider'->>'retrySafe' is distinct from 'true' then raise exception 'os_retry_forbidden'; end if;
    update public.ai_runs set status='pending',started_at=null,finished_at=null,
      metadata=(metadata-'osCheckpoint'-'token'-'leaseUntil')||jsonb_build_object('osStatus','QUEUED','attempt',(metadata->>'attempt')::integer+1,
      'technicalHistory',coalesce(metadata->'technicalHistory','[]')||jsonb_build_array(metadata->'osCheckpoint')) where id=p_id;
  else
    if a.metadata->>'osStatus'<>'REVIEW_REQUIRED' or p_action not in ('approve','hold','reject') then raise exception 'os_review_forbidden'; end if;
    if jsonb_typeof(p_indexes) is distinct from 'array' then raise exception 'os_indexes_invalid'; end if;
    candidate_count:=jsonb_array_length(a.metadata->'osCheckpoint'->'validated'->'review'->'candidates');
    if p_action='approve' and jsonb_array_length(p_indexes)=0 then raise exception 'os_candidate_required'; end if;
    if p_action<>'approve' and jsonb_array_length(p_indexes)<>0 then raise exception 'os_candidates_forbidden'; end if;
    for idx in select value from jsonb_array_elements(p_indexes) loop
      if jsonb_typeof(idx)<>'number' or idx::text !~ '^[0-9]+$' or (idx::text)::integer>=candidate_count then raise exception 'os_candidate_invalid'; end if;
    end loop;
  end if;
  insert into public.sec_os_snapshot_decisions(run_id,actor_user_id,action,candidate_indexes,reason,request_id)
    values(p_id,p_actor,p_action,p_indexes,p_reason,p_request) returning * into old;
  return jsonb_build_object('id',old.id,'replayed',false);
end $$;

create function public.guard_sec_os_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='sec_os_snapshot_decisions' then raise exception 'os_decisions_immutable'; end if;
  if tg_table_name='ai_outputs' then
    if old.output_type='sec_os_snapshot' or (tg_op='UPDATE' and new.output_type='sec_os_snapshot') then raise exception 'os_output_immutable'; end if;
  elsif old.prompt_key='sec_os_snapshot' or (tg_op='UPDATE' and new.prompt_key='sec_os_snapshot') then
    if tg_op='DELETE' then raise exception 'os_run_immutable'; end if;
    if new.metadata->'binding' is distinct from old.metadata->'binding' or new.raw_item_id is distinct from old.raw_item_id
      or new.prompt_key is distinct from old.prompt_key or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
      or (old.metadata->>'osStatus' in ('PASS','REVIEW_REQUIRED','NO_DIRECT_CURRENT_OS','VALIDATION_FAILED') and new is distinct from old)
      then raise exception 'os_history_immutable'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger guard_os_runs before update or delete on public.ai_runs for each row execute function public.guard_sec_os_snapshot();
create trigger guard_os_outputs before update or delete on public.ai_outputs for each row execute function public.guard_sec_os_snapshot();
create trigger guard_os_decisions before update or delete on public.sec_os_snapshot_decisions for each row execute function public.guard_sec_os_snapshot();
revoke all on function public.reserve_sec_os_snapshot(jsonb), public.sec_os_snapshot_transition(uuid,text,text,jsonb), public.decide_sec_os_snapshot(uuid,uuid,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_sec_os_snapshot(jsonb), public.sec_os_snapshot_transition(uuid,text,text,jsonb), public.decide_sec_os_snapshot(uuid,uuid,text,jsonb,text,uuid) to service_role;
notify pgrst,'reload schema';
