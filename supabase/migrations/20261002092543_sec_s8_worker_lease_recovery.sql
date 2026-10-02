-- Recovery lives in the existing private ai_runs metadata, not a separate queue/table.
-- 180s = the fixed 60s provider timeout plus 120s for reconstruction/checkpoint/DB overhead.
-- Four ownership claims = initial attempt plus three bounded infrastructure recoveries.
create function public.sec_s8_worker_transition(p_id uuid, p_raw_item_id uuid, p_action text,
  p_token text default null, p_value jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ai_runs; w jsonb; sched jsonb; cp jsonb; tok text; n integer;
  t timestamptz := clock_timestamp(); answer jsonb;
begin
  select * into strict a from public.ai_runs
    where id=p_id and raw_item_id=p_raw_item_id and prompt_key='sec_s8_structured' for update;
  w := coalesce(a.metadata->'worker','{}'::jsonb);
  sched := coalesce(a.metadata->'scheduler','{}'::jsonb);
  cp := a.metadata->'s8Checkpoint';
  if a.status in ('succeeded','failed','stale') then
    return jsonb_build_object('status','duplicate','executionStatus',a.status,'claimed',false);
  end if;
  if p_action='schedule' then
    if (a.status='running' and coalesce((w->>'leaseExpiresAt')::timestamptz,a.started_at+interval '180 seconds',t)>t)
      or coalesce((sched->>'leaseExpiresAt')::timestamptz,'-infinity'::timestamptz)>t then
      return jsonb_build_object('status','busy','claimed',false);
    end if;
    n := coalesce((sched->>'attempts')::integer,0)+1;
    if n>4 then return jsonb_build_object('status','schedule_exhausted','claimed',false); end if;
    tok := gen_random_uuid()::text;
    sched := jsonb_build_object('token',tok,'attempts',n,'claimedAt',t,'leaseExpiresAt',t+interval '180 seconds');
    update public.ai_runs set metadata=metadata || jsonb_build_object('scheduler',sched) where id=p_id;
    return jsonb_build_object('status','scheduled','claimed',true,'token',tok);
  elsif p_action='link' then
    if sched->>'token' is distinct from p_token then raise exception 's8_schedule_fenced'; end if;
    if nullif(p_value->>'workflowRunId','') is null then raise exception 's8_workflow_id_missing'; end if;
    sched := sched || jsonb_build_object('workflowRunId',p_value->>'workflowRunId');
    update public.ai_runs set metadata=metadata || jsonb_build_object('scheduler',sched,
      'workflowRunId',coalesce(metadata->>'workflowRunId',p_value->>'workflowRunId'),
      'workflowHistory',coalesce(metadata->'workflowHistory','[]'::jsonb) || jsonb_build_array(p_value->>'workflowRunId')) where id=p_id;
    return jsonb_build_object('linked',true);
  elsif p_action='claim' then
    if a.status='running' and coalesce((w->>'leaseExpiresAt')::timestamptz,a.started_at+interval '180 seconds',t)>t then
      return jsonb_build_object('status','busy','claimed',false);
    end if;
    n := coalesce((w->>'claimCount')::integer,0)+1;
    if n>4 then
      update public.ai_runs set status='failed',finished_at=t,error_message='s8_recovery_exhausted',
        metadata=metadata || jsonb_build_object('worker',w || jsonb_build_object('phase','exhausted','lastError','s8_recovery_exhausted')) where id=p_id;
      return jsonb_build_object('status','recovery_exhausted','claimed',false);
    end if;
    tok := gen_random_uuid()::text;
    -- A durable call-start marker without a response is uncertain, never assumed uncalled.
    w := w || jsonb_build_object('token',tok,'claimCount',n,'claimedAt',t,'leaseExpiresAt',t+interval '180 seconds',
      'uncertainProviderAttempts',coalesce((w->>'uncertainProviderAttempts')::integer,0)+
        case when w->>'phase'='provider_started' and cp is null then 1 else 0 end,
      'phase',case when cp is null then 'claimed' else 'checkpoint' end);
    update public.ai_runs set status='running',started_at=coalesce(started_at,t),
      metadata=metadata || jsonb_build_object('worker',w) where id=p_id;
    return jsonb_build_object('status','claimed','claimed',true,'token',tok,'binding',a.metadata->'binding','checkpoint',cp);
  end if;
  if a.status<>'running' or w->>'token' is distinct from p_token
    or coalesce((w->>'leaseExpiresAt')::timestamptz,'-infinity'::timestamptz)<=t then
    raise exception 's8_worker_lease_lost';
  end if;
  if p_action='provider_started' then
    if cp is not null or w->>'phase'<>'claimed' then raise exception 's8_provider_not_permitted'; end if;
    w := w || jsonb_build_object('phase','provider_started','providerStartedAt',t,
      'providerAttempts',coalesce((w->>'providerAttempts')::integer,0)+1,'leaseExpiresAt',t+interval '180 seconds');
  elsif p_action='checkpoint' then
    if coalesce(p_value->>'status','') not in ('succeeded','failed','stale')
      or p_value->'payload'->'binding' is distinct from a.metadata->'binding'
      or jsonb_typeof(p_value->'payload'->'outputText') is distinct from 'string'
      or p_value->'payload'->>'outputSha256' is distinct from encode(sha256(convert_to(p_value->'payload'->>'outputText','UTF8')),'hex') then
      raise exception 's8_checkpoint_binding_invalid';
    end if;
    if cp is not null and cp is distinct from p_value then raise exception 's8_checkpoint_immutable'; end if;
    cp := p_value;
    w := w || jsonb_build_object('phase','checkpoint','checkpointAt',coalesce(w->'checkpointAt',to_jsonb(t)),
      'leaseExpiresAt',t+interval '180 seconds','lastStage',p_value->'payload'->>'validationStage');
    update public.ai_runs set metadata=metadata || jsonb_build_object('s8Checkpoint',cp) where id=p_id;
  elsif p_action='finish' then
    if cp is null then raise exception 's8_checkpoint_required'; end if;
    -- The original finish still checks current SEC source before publishing a successful result.
    answer := public.finish_sec_s8_structured(p_id,
      case when p_value->>'stale'='true' then 'stale' else cp->>'status' end, cp->'payload');
    update public.ai_runs set metadata=metadata || jsonb_build_object('worker',w || jsonb_build_object('phase','completed')) where id=p_id;
    return answer;
  else raise exception 's8_worker_action_invalid'; end if;
  update public.ai_runs set metadata=metadata || jsonb_build_object('worker',w) where id=p_id;
  return jsonb_build_object('status',w->>'phase');
end $$;
revoke all on function public.sec_s8_worker_transition(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sec_s8_worker_transition(uuid,uuid,text,text,jsonb) to service_role;

-- Existing claim callers receive the fenced lease too, rather than bypassing it.
create or replace function public.claim_sec_s8_structured(p_id uuid,p_raw_item_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.sec_s8_worker_transition(p_id,p_raw_item_id,'claim');
$$;
create or replace function public.finish_sec_s8_structured(p_id uuid,p_status text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ai_runs; old_output public.ai_outputs; r public.raw_items; final_status text := p_status;
begin
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_s8_structured' for update;
  if p_status not in ('succeeded','failed','stale') or p_status is null
    or p_payload->'binding' is distinct from a.metadata->'binding'
    or jsonb_typeof(p_payload->'outputText') is distinct from 'string'
    or p_payload->>'outputSha256' is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload->>'outputText','UTF8')),'hex')
    then raise exception 's8_result_binding_mismatch'; end if;
  select * into old_output from public.ai_outputs where ai_run_id=p_id and output_type='sec_s8_structured';
  if found then
    if old_output.payload is distinct from p_payload then raise exception 's8_immutable_output_conflict'; end if;
    return jsonb_build_object('status',a.status,'replayed',true);
  end if;
  if a.status <> 'running' then raise exception 's8_execution_not_running'; end if;
  -- Once lease-managed, only the retained checkpoint may be committed. Fenced worker RPC owns publication.
  if a.metadata ? 'worker' and (a.metadata->'s8Checkpoint' is null
    or a.metadata->'s8Checkpoint'->'payload' is distinct from p_payload
    or coalesce((a.metadata->'worker'->>'leaseExpiresAt')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp()) then
    raise exception 's8_checkpoint_required'; end if;
  select * into strict r from public.raw_items where id=a.raw_item_id for share;
  if p_status='succeeded' and (
    r.source_code is distinct from 'sec_edgar'
    or r.source_unique_id is distinct from a.metadata->'binding'->>'accession'
    or r.raw_payload->>'accession_number' is distinct from a.metadata->'binding'->>'accession'
    or pg_catalog.lpad(r.raw_payload->>'cik',10,'0') is distinct from a.metadata->'binding'->>'issuerCik'
    or r.raw_payload->>'form_type' is distinct from a.metadata->'binding'->>'formType'
    or r.raw_payload->'s8_source' is distinct from a.metadata->'binding'->'original'
    or nullif(r.raw_payload->>'filing_date','') is distinct from a.metadata->'binding'->'source'->'identity'->>'filingDate'
    or nullif(r.raw_payload->>'accepted_at','') is distinct from a.metadata->'binding'->>'acceptedAt'
  ) then final_status := 'stale'; end if;
  insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_s8_structured',p_payload);
  update public.ai_runs set status=final_status,finished_at=now(),
    usage=coalesce(nullif(p_payload->'provider'->'usage','null'::jsonb),'{}'::jsonb),
    error_message=p_payload->>'error' where id=p_id;
  return jsonb_build_object('status',final_status,'replayed',false);
end $$;

create or replace function public.guard_sec_s8_structured_history() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name='ai_outputs' then
    if old.output_type='sec_s8_structured' or (tg_op='UPDATE' and new.output_type='sec_s8_structured') then
      raise exception 's8_output_history_immutable'; end if;
  else
    if old.prompt_key='sec_s8_structured' or (tg_op='UPDATE' and new.prompt_key='sec_s8_structured') then
      if tg_op='DELETE' then raise exception 's8_run_history_immutable'; end if;
      if new.id is distinct from old.id or new.raw_item_id is distinct from old.raw_item_id
        or new.event_id is distinct from old.event_id or new.prompt_key is distinct from old.prompt_key
        or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
        or new.metadata->'binding' is distinct from old.metadata->'binding'
        or new.metadata->'reservedAt' is distinct from old.metadata->'reservedAt'
        or (old.metadata ? 's8Checkpoint' and new.metadata->'s8Checkpoint' is distinct from old.metadata->'s8Checkpoint')
        or (old.status in ('succeeded','failed','stale') and (new.status is distinct from old.status
          or new.started_at is distinct from old.started_at or new.finished_at is distinct from old.finished_at
          or new.usage is distinct from old.usage or new.error_message is distinct from old.error_message))
        then raise exception 's8_run_history_immutable'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
notify pgrst, 'reload schema';
