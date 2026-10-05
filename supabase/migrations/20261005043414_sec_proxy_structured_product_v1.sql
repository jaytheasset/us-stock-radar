-- Raw-bound Proxy FACT and durable provider checkpoints; no existing records are rewritten.
create unique index sec_proxy_execution_once on public.ai_runs
 (raw_item_id,prompt_version,(metadata->'binding'->>'sourceFingerprint'),(metadata->'binding'->>'attempt'))
 where prompt_key='sec_proxy_structured';
create unique index sec_proxy_output_once on public.ai_outputs(ai_run_id) where output_type='sec_proxy_structured';

create function public.reserve_sec_proxy_structured(p_id uuid,p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; added boolean;
begin
 select * into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
 if r.source_code is distinct from 'sec_edgar'
  or r.source_unique_id is distinct from p_binding->>'accession'
  or r.raw_payload->>'accession_number' is distinct from p_binding->>'accession'
  or pg_catalog.lpad(r.raw_payload->>'cik',10,'0') is distinct from p_binding->>'issuerCik'
  or p_binding->'original' is distinct from jsonb_build_object('source_code',r.source_code,
     'source_unique_id',r.source_unique_id,'source_url',r.source_url,'body_text',r.body_text,'raw_payload',r.raw_payload)
  or p_binding->>'contractVersion' is distinct from 'proxy_product_v1'
  or coalesce(p_binding->>'attempt','') !~ '^(automatic|verification:[a-z0-9][a-z0-9_-]{0,79})$'
  or coalesce(p_binding->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
 then raise exception 'proxy_source_binding_invalid'; end if;
 insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
 values(p_id,r.id,'sec_proxy_structured','proxy_product_v1','gemini-2.5-flash-lite+gemini-3.5-flash','pending',
 jsonb_build_object('binding',p_binding,'state','pending','reservedAt',now(),'stages','{}'::jsonb)) on conflict do nothing;
 added:=found;
 select * into strict a from public.ai_runs where id=p_id;
 if a.prompt_key is distinct from 'sec_proxy_structured' or a.metadata->'binding' is distinct from p_binding
 then raise exception 'proxy_execution_conflict'; end if;
 return jsonb_build_object('inserted',added,'status',a.metadata->>'state');
end $$;

-- Every transition locks the execution. A started provider request is NEVER reclaimed.
-- Scheduler leases may expire safely: replacement workflows can only replay saved responses.
create function public.sec_proxy_transition(p_id uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; s jsonb; stage text:=p_value->>'stage'; token text; cp jsonb;
begin
 select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_proxy_structured' for update;
 if p_action='schedule' then
  if a.status in ('succeeded','failed','stale') then return jsonb_build_object('claimed',false,'status',a.metadata->>'state'); end if;
  if (a.metadata->>'scheduledAt')::timestamptz > now()-interval '60 seconds' then return jsonb_build_object('claimed',false,'status','scheduled'); end if;
  token:=gen_random_uuid()::text;
  update public.ai_runs set metadata=metadata||jsonb_build_object('scheduledAt',now(),'scheduleToken',token) where id=p_id;
  return jsonb_build_object('claimed',true,'token',token);
 elsif p_action='link' then
  if a.status in ('succeeded','failed','stale') then return jsonb_build_object('linked',false,'status',a.metadata->>'state'); end if;
  if a.metadata->>'scheduleToken' is distinct from p_value->>'token' then return jsonb_build_object('linked',false); end if;
  update public.ai_runs set metadata=metadata||jsonb_build_object('workflowRunId',p_value->>'workflowRunId') where id=p_id;
  return jsonb_build_object('linked',true);
 elsif p_action='begin' then
  if a.status in ('succeeded','failed','stale') then return jsonb_build_object('claimed',false,'status',a.metadata->>'state'); end if;
  if stage not in ('call1','call2') or stage is null or coalesce(p_value->>'requestHash','') !~ '^[0-9a-f]{64}$'
   then raise exception 'proxy_stage_invalid'; end if;
  s:=a.metadata->'stages'->stage;
  if s is not null then
   if s->>'requestHash' is distinct from p_value->>'requestHash' then raise exception 'proxy_request_changed'; end if;
   if s->>'state'='complete' then return jsonb_build_object('checkpoint',s); end if;
   if s->>'state'='started' and (s->>'startedAt')::timestamptz > now()-interval '180 seconds'
    then return jsonb_build_object('claimed',false,'status','busy'); end if;
   update public.ai_runs set status='failed',finished_at=now(),metadata=metadata||jsonb_build_object('state','uncertain'),error_message='provider_outcome_unknown' where id=p_id;
   return jsonb_build_object('claimed',false,'status','uncertain');
  end if;
  if a.status in ('succeeded','failed','stale') then return jsonb_build_object('claimed',false,'status',a.metadata->>'state'); end if;
  if stage='call2' and a.metadata->'stages'->'call1'->>'state' is distinct from 'complete' then raise exception 'proxy_call1_checkpoint_required'; end if;
  token:=gen_random_uuid()::text;
  s:=jsonb_build_object('state','started','token',token,'startedAt',now(),'requestHash',p_value->>'requestHash','request',p_value->'request','mode',p_value->>'mode');
  update public.ai_runs set status='running',started_at=coalesce(started_at,now()),metadata=jsonb_set(metadata,'{stages}',(metadata->'stages')||jsonb_build_object(stage,s))||jsonb_build_object('state','running') where id=p_id;
  return jsonb_build_object('claimed',true,'token',token);
 elsif p_action in ('checkpoint','uncertain') then
  s:=a.metadata->'stages'->stage;
  if s->>'token' is distinct from p_value->>'token' or s->>'state' is distinct from 'started' then raise exception 'proxy_stage_fenced'; end if;
  if a.status <> 'running' then raise exception 'proxy_execution_terminal'; end if;
  if p_action='uncertain' then
   update public.ai_runs set status='failed',finished_at=now(),error_message='provider_outcome_unknown',metadata=metadata||jsonb_build_object('state','uncertain') where id=p_id;
   return jsonb_build_object('status','uncertain');
  end if;
  cp:=p_value->'response';
  if jsonb_typeof(cp->'body') is distinct from 'string' or (cp->>'status')::integer not between 200 and 599
   or cp->>'bodyHash' is distinct from encode(sha256(convert_to(cp->>'body','UTF8')),'hex') then raise exception 'proxy_checkpoint_invalid'; end if;
  s:=s||jsonb_build_object('state','complete','completedAt',now(),'response',cp);
  update public.ai_runs set metadata=jsonb_set(metadata,'{stages}',(metadata->'stages')||jsonb_build_object(stage,s)) where id=p_id;
  return jsonb_build_object('saved',true);
 else raise exception 'proxy_transition_invalid'; end if;
end $$;

create function public.finish_sec_proxy_structured(p_id uuid,p_status text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; o public.ai_outputs; r public.raw_items;
begin
 select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_proxy_structured' for update;
 if p_status is null or p_status not in ('succeeded','failed','stale') or p_payload->'binding' is distinct from a.metadata->'binding'
 then raise exception 'proxy_output_binding_invalid'; end if;
 select * into o from public.ai_outputs where ai_run_id=p_id and output_type='sec_proxy_structured';
 if found then
  if o.payload is distinct from p_payload then raise exception 'proxy_immutable_result'; end if;
  return jsonb_build_object('status',a.metadata->>'state','replayed',true);
 end if;
 if a.status not in ('pending','running') then return jsonb_build_object('status',a.metadata->>'state'); end if;
 if p_status='succeeded' and (a.metadata->'stages'->'call2'->>'state' is distinct from 'complete'
  or p_payload->'canonical'->>'version' is distinct from 'proxy_final_structured_v1') then raise exception 'proxy_final_checkpoint_required'; end if;
 select * into strict r from public.raw_items where id=a.raw_item_id for share;
 if p_status='succeeded' and a.metadata->'binding'->'original' is distinct from jsonb_build_object('source_code',r.source_code,
  'source_unique_id',r.source_unique_id,'source_url',r.source_url,'body_text',r.body_text,'raw_payload',r.raw_payload) then p_status:='stale'; end if;
 insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_proxy_structured',p_payload);
 update public.ai_runs set status=p_status,finished_at=now(),metadata=metadata||jsonb_build_object('state',p_status),
 usage=coalesce(p_payload->'usage','{}'::jsonb),error_message=p_payload->>'error' where id=p_id;
 return jsonb_build_object('status',p_status,'replayed',false);
end $$;

create function public.guard_sec_proxy_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='ai_outputs' then
  if old.output_type='sec_proxy_structured' or (tg_op='UPDATE' and new.output_type='sec_proxy_structured') then raise exception 'proxy_output_immutable'; end if;
 elsif old.prompt_key='sec_proxy_structured' or (tg_op='UPDATE' and new.prompt_key='sec_proxy_structured') then
  if tg_op='DELETE' then raise exception 'proxy_history_immutable'; end if;
  if new.id is distinct from old.id or new.raw_item_id is distinct from old.raw_item_id or new.prompt_key is distinct from old.prompt_key
   or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
   or new.metadata->'binding' is distinct from old.metadata->'binding'
   or new.metadata->'reservedAt' is distinct from old.metadata->'reservedAt'
   or (old.metadata->'stages'->'call1'->>'state'='complete' and new.metadata->'stages'->'call1' is distinct from old.metadata->'stages'->'call1')
   or (old.metadata->'stages'->'call2'->>'state'='complete' and new.metadata->'stages'->'call2' is distinct from old.metadata->'stages'->'call2')
   or (old.status in ('succeeded','failed','stale') and (new.status is distinct from old.status or new.metadata is distinct from old.metadata
     or new.finished_at is distinct from old.finished_at or new.usage is distinct from old.usage or new.error_message is distinct from old.error_message))
   then raise exception 'proxy_history_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger sec_proxy_run_guard before update or delete on public.ai_runs for each row execute function public.guard_sec_proxy_history();
create trigger sec_proxy_output_guard before update or delete on public.ai_outputs for each row execute function public.guard_sec_proxy_history();
revoke all on function public.reserve_sec_proxy_structured(uuid,jsonb),public.sec_proxy_transition(uuid,text,jsonb),
 public.finish_sec_proxy_structured(uuid,text,jsonb),public.guard_sec_proxy_history() from public,anon,authenticated;
grant execute on function public.reserve_sec_proxy_structured(uuid,jsonb),public.sec_proxy_transition(uuid,text,jsonb),
 public.finish_sec_proxy_structured(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
