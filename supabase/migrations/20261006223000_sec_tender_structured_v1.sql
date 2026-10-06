-- Tender Structured V1: one filing -> at most one Gemini physical call.
-- Source-bound ai_runs/ai_outputs with immutable checkpointed provider response.
create unique index if not exists sec_tender_execution_once on public.ai_runs
 (raw_item_id)
 where prompt_key='sec_tender_structured';

create unique index if not exists sec_tender_accession_once on public.ai_runs ((metadata->'binding'->>'accession')) where prompt_key='sec_tender_structured';

create unique index if not exists sec_tender_output_once on public.ai_outputs(ai_run_id)
 where output_type='sec_tender_structured';

create or replace function public.reserve_sec_tender_structured(p_id uuid,p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; added boolean;
begin
 select * into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
 if r.source_code is distinct from 'sec_edgar'
  or r.source_unique_id is distinct from p_binding->>'accession'
  or r.raw_payload->>'accession_number' is distinct from p_binding->>'accession'
  or upper(coalesce(r.raw_payload->>'form_type','')) is distinct from p_binding->>'formType'
  or p_binding->>'contractVersion' is distinct from 'tender_structured_v1'
  or coalesce(p_binding->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
 then raise exception 'tender_source_binding_invalid'; end if;

 insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
 values(p_id,r.id,'sec_tender_structured','tender_structured_v1','gemini-3.5-flash','pending',
  jsonb_build_object('binding',p_binding,'state','pending','reservedAt',now(),'stages','{}'::jsonb,'rawSourceHash',md5(jsonb_build_array(r.raw_payload,r.source_url,r.published_at)::text)))
 on conflict do nothing;
 added:=found;

 select * into strict a from public.ai_runs where id=p_id;
 if a.prompt_key is distinct from 'sec_tender_structured'
  or a.prompt_version is distinct from 'tender_structured_v1'
  or a.model is distinct from 'gemini-3.5-flash'
  or a.metadata->'binding' is distinct from p_binding
 then raise exception 'tender_execution_conflict'; end if;

 return jsonb_build_object('inserted',added,'status',a.metadata->>'state');
end $$;

create or replace function public.sec_tender_transition(
 p_id uuid,p_action text,p_value jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; s jsonb; token text; cp jsonb; r public.raw_items;
begin
 select * into strict a from public.ai_runs
 where id=p_id and prompt_key='sec_tender_structured' for update;

 if p_action='schedule' then
  if a.status in ('succeeded','failed','stale') then
   return jsonb_build_object('claimed',false,'status',a.metadata->>'state');
  end if;
  if (a.metadata->>'scheduledAt')::timestamptz > now()-interval '60 seconds' then
   return jsonb_build_object('claimed',false,'status','scheduled');
  end if;
  token:=gen_random_uuid()::text;
  update public.ai_runs set metadata=metadata||jsonb_build_object(
   'scheduledAt',now(),'scheduleToken',token
  ) where id=p_id;
  return jsonb_build_object('claimed',true,'token',token);

 elsif p_action='link' then
  if a.status in ('succeeded','failed','stale') then
   return jsonb_build_object('linked',false,'status',a.metadata->>'state');
  end if;
  if a.metadata->>'scheduleToken' is distinct from p_value->>'token' then
   return jsonb_build_object('linked',false);
  end if;
  update public.ai_runs set metadata=metadata||jsonb_build_object(
   'workflowRunId',p_value->>'workflowRunId'
  ) where id=p_id;
  return jsonb_build_object('linked',true);

 elsif p_action='begin' then
  if a.status in ('succeeded','failed','stale') then
   return jsonb_build_object('claimed',false,'status',a.metadata->>'state');
  end if;
  if p_value->>'stage' is distinct from 'structured'
   or coalesce(p_value->>'requestHash','') !~ '^[0-9a-f]{64}$'
  then raise exception 'tender_stage_invalid'; end if;

  s:=a.metadata->'stages'->'structured';
  if s is not null then
   if s->>'requestHash' is distinct from p_value->>'requestHash' then
    raise exception 'tender_request_changed';
   end if;
   if s->>'state'='complete' then
    return jsonb_build_object('checkpoint',s);
   end if;
   if s->>'state'='started'
    and (s->>'startedAt')::timestamptz > now()-interval '180 seconds'
   then return jsonb_build_object('claimed',false,'status','busy');
   end if;
   update public.ai_runs set status='failed',finished_at=now(),
    metadata=metadata||jsonb_build_object('state','uncertain'),
    error_message='provider_outcome_unknown'
   where id=p_id;
   return jsonb_build_object('claimed',false,'status','uncertain');
  end if;

  select * into strict r from public.raw_items where id=a.raw_item_id for share;
  if a.metadata->>'rawSourceHash' is distinct from md5(jsonb_build_array(r.raw_payload,r.source_url,r.published_at)::text) then
   update public.ai_runs set status='stale',finished_at=now(),metadata=metadata||jsonb_build_object('state','stale') where id=p_id;
   return jsonb_build_object('claimed',false,'status','stale');
  end if;
  token:=gen_random_uuid()::text;
  s:=jsonb_build_object(
   'state','started','token',token,'startedAt',now(),
   'requestHash',p_value->>'requestHash','request',p_value->'request',
   'mode',p_value->>'mode'
  );
  update public.ai_runs set status='running',started_at=coalesce(started_at,now()),
   metadata=jsonb_set(metadata,'{stages}',(metadata->'stages')||jsonb_build_object('structured',s))
    ||jsonb_build_object('state','running')
  where id=p_id;
  return jsonb_build_object('claimed',true,'token',token);

 elsif p_action in ('checkpoint','uncertain') then
  s:=a.metadata->'stages'->'structured';
  if s->>'token' is distinct from p_value->>'token'
   or s->>'state' is distinct from 'started'
  then raise exception 'tender_stage_fenced'; end if;
  if a.status <> 'running' then raise exception 'tender_execution_terminal'; end if;

  if p_action='uncertain' then
   update public.ai_runs set status='failed',finished_at=now(),
    error_message='provider_outcome_unknown',
    metadata=metadata||jsonb_build_object('state','uncertain')
   where id=p_id;
   return jsonb_build_object('status','uncertain');
  end if;

  cp:=p_value->'response';
  if jsonb_typeof(cp->'body') is distinct from 'string'
   or (cp->>'status')::integer not between 200 and 599
   or cp->>'bodyHash' is distinct from encode(sha256(convert_to(cp->>'body','UTF8')),'hex')
  then raise exception 'tender_checkpoint_invalid'; end if;

  s:=s||jsonb_build_object('state','complete','completedAt',now(),'response',cp);
  update public.ai_runs set metadata=jsonb_set(
   metadata,'{stages}',(metadata->'stages')||jsonb_build_object('structured',s)
  ) where id=p_id;
  return jsonb_build_object('saved',true);

 else
  raise exception 'tender_transition_invalid';
 end if;
end $$;

create or replace function public.finish_sec_tender_structured(
 p_id uuid,p_status text,p_payload jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; o public.ai_outputs; r public.raw_items;
begin
 select * into strict a from public.ai_runs
 where id=p_id and prompt_key='sec_tender_structured' for update;

 if p_status is null or p_status not in ('succeeded','failed','stale')
  or p_payload->'binding' is distinct from a.metadata->'binding'
 then raise exception 'tender_output_binding_invalid'; end if;

 select * into o from public.ai_outputs
 where ai_run_id=p_id and output_type='sec_tender_structured';
 if found then
  if o.payload is distinct from p_payload then raise exception 'tender_immutable_result'; end if;
  return jsonb_build_object('status',a.metadata->>'state','replayed',true);
 end if;

 if a.status not in ('pending','running') then
  return jsonb_build_object('status',a.metadata->>'state');
 end if;

 if p_status='succeeded' and (
  a.metadata->'stages'->'structured'->>'state' is distinct from 'complete'
  or p_payload->'canonical'->>'version' is distinct from 'tender_structured_v1'
 ) then raise exception 'tender_final_checkpoint_required'; end if;

 select * into strict r from public.raw_items where id=a.raw_item_id for share;
 if p_status='succeeded' and (
  a.metadata->>'rawSourceHash' is distinct from md5(jsonb_build_array(r.raw_payload,r.source_url,r.published_at)::text)
  or r.source_code is distinct from 'sec_edgar'
  or r.source_unique_id is distinct from a.metadata->'binding'->>'accession'
  or r.raw_payload->>'accession_number' is distinct from a.metadata->'binding'->>'accession'
  or upper(coalesce(r.raw_payload->>'form_type','')) is distinct from a.metadata->'binding'->>'formType'
 ) then p_status:='stale'; end if;

 insert into public.ai_outputs(ai_run_id,output_type,payload)
 values(p_id,'sec_tender_structured',p_payload);

 update public.ai_runs set
  status=p_status,
  finished_at=now(),
  metadata=metadata||jsonb_build_object('state',p_status),
  usage=coalesce(p_payload->'usage','{}'::jsonb),
  error_message=p_payload->>'error'
 where id=p_id;

 return jsonb_build_object('status',p_status,'replayed',false);
end $$;

create or replace function public.guard_sec_tender_history()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='ai_outputs' then
  if old.output_type='sec_tender_structured'
   or (tg_op='UPDATE' and new.output_type='sec_tender_structured')
  then raise exception 'tender_output_immutable'; end if;
 elsif old.prompt_key='sec_tender_structured'
  or (tg_op='UPDATE' and new.prompt_key='sec_tender_structured') then
  if tg_op='DELETE' then raise exception 'tender_history_immutable'; end if;
  if new.id is distinct from old.id
   or new.raw_item_id is distinct from old.raw_item_id
   or new.prompt_key is distinct from old.prompt_key
   or new.prompt_version is distinct from old.prompt_version
   or new.model is distinct from old.model
   or new.metadata->'binding' is distinct from old.metadata->'binding'
   or new.metadata->'rawSourceHash' is distinct from old.metadata->'rawSourceHash'
   or (old.metadata->'stages'->'structured'->>'state'='started' and (
    new.metadata->'stages'->'structured'->>'state' not in ('started','complete')
    or new.metadata->'stages'->'structured'->>'token' is distinct from old.metadata->'stages'->'structured'->>'token'
    or new.metadata->'stages'->'structured'->>'requestHash' is distinct from old.metadata->'stages'->'structured'->>'requestHash'
    or new.metadata->'stages'->'structured' is null))
   or new.metadata->'reservedAt' is distinct from old.metadata->'reservedAt'
   or (
    old.metadata->'stages'->'structured'->>'state'='complete'
    and new.metadata->'stages'->'structured' is distinct from old.metadata->'stages'->'structured'
   )
   or (
    old.status in ('succeeded','failed','stale')
    and (
     new.status is distinct from old.status
     or new.metadata is distinct from old.metadata
     or new.finished_at is distinct from old.finished_at
     or new.usage is distinct from old.usage
     or new.error_message is distinct from old.error_message
    )
   )
  then raise exception 'tender_history_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

drop trigger if exists sec_tender_run_guard on public.ai_runs;
create trigger sec_tender_run_guard
before update or delete on public.ai_runs
for each row execute function public.guard_sec_tender_history();

drop trigger if exists sec_tender_output_guard on public.ai_outputs;
create trigger sec_tender_output_guard
before update or delete on public.ai_outputs
for each row execute function public.guard_sec_tender_history();

revoke all on function
 public.reserve_sec_tender_structured(uuid,jsonb),
 public.sec_tender_transition(uuid,text,jsonb),
 public.finish_sec_tender_structured(uuid,text,jsonb),
 public.guard_sec_tender_history()
from public,anon,authenticated;

grant execute on function
 public.reserve_sec_tender_structured(uuid,jsonb),
 public.sec_tender_transition(uuid,text,jsonb),
 public.finish_sec_tender_structured(uuid,text,jsonb)
to service_role;

notify pgrst,'reload schema';
