-- 425 one-call FACT: compact source binding, durable no-retry provider checkpoint.
create unique index sec425_execution_once on public.ai_runs
 (raw_item_id,prompt_version,(metadata->'binding'->>'sourceFingerprint'),(metadata->'binding'->>'attempt'))
 where prompt_key='sec425_facts';
create unique index sec425_output_once on public.ai_outputs(ai_run_id) where output_type='sec425_facts';

create function public.reserve_sec425_facts(p_id uuid,p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; added boolean;
begin
 select * into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
 if r.source_code is distinct from 'sec_edgar'
  or r.source_unique_id is distinct from p_binding->>'accession'
  or r.raw_payload->>'accession_number' is distinct from p_binding->>'accession'
  or pg_catalog.lpad(r.raw_payload->>'cik',10,'0') is distinct from p_binding->>'issuerCik'
  or r.raw_payload->>'form_type' is distinct from '425'
  or p_binding->>'sourceSha256' is distinct from encode(sha256(convert_to(r.raw_payload->>'primary_document_html','UTF8')),'hex')
  or p_binding->>'contractVersion' is distinct from 'sec425_facts_v1'
  or coalesce(p_binding->>'attempt','') !~ '^(automatic|verification:[a-z0-9][a-z0-9_-]{0,79})$'
  or coalesce(p_binding->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
 then raise exception 'sec425_source_binding_invalid'; end if;
 insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
 values(p_id,r.id,'sec425_facts','sec425_facts_v1','gemini-2.5-flash','pending',
 jsonb_build_object('binding',p_binding,'state','pending','reservedAt',now(),'stages','{}'::jsonb)) on conflict do nothing;
 added:=found;
 select * into strict a from public.ai_runs where id=p_id;
 if a.prompt_key is distinct from 'sec425_facts' or a.metadata->'binding' is distinct from p_binding
 then raise exception 'sec425_execution_conflict'; end if;
 return jsonb_build_object('inserted',added,'status',a.metadata->>'state');
end $$;

-- Every transition locks the execution. A started provider request is NEVER reclaimed.
-- Scheduler leases may expire safely: replacement workflows can only replay saved responses.
create function public.sec425_transition(p_id uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; s jsonb; stage text:=p_value->>'stage'; token text; cp jsonb;
begin
 select * into strict a from public.ai_runs where id=p_id and prompt_key='sec425_facts' for update;
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
  if stage <> 'fact' or stage is null or coalesce(p_value->>'requestHash','') !~ '^[0-9a-f]{64}$'
   then raise exception 'sec425_stage_invalid'; end if;
  s:=a.metadata->'stages'->stage;
  if s is not null then
   if s->>'requestHash' is distinct from p_value->>'requestHash' then raise exception 'sec425_request_changed'; end if;
   if s->>'state'='complete' then return jsonb_build_object('checkpoint',s); end if;
   if s->>'state'='started' and (s->>'startedAt')::timestamptz > now()-interval '180 seconds'
    then return jsonb_build_object('claimed',false,'status','busy'); end if;
   update public.ai_runs set status='failed',finished_at=now(),metadata=metadata||jsonb_build_object('state','uncertain'),error_message='provider_outcome_unknown' where id=p_id;
   return jsonb_build_object('claimed',false,'status','uncertain');
  end if;
  if a.status in ('succeeded','failed','stale') then return jsonb_build_object('claimed',false,'status',a.metadata->>'state'); end if;
  token:=gen_random_uuid()::text;
  s:=jsonb_build_object('state','started','token',token,'startedAt',now(),'requestHash',p_value->>'requestHash','mode',p_value->>'mode');
  update public.ai_runs set status='running',started_at=coalesce(started_at,now()),metadata=jsonb_set(metadata,'{stages}',(metadata->'stages')||jsonb_build_object(stage,s))||jsonb_build_object('state','running') where id=p_id;
  return jsonb_build_object('claimed',true,'token',token);
 elsif p_action in ('checkpoint','uncertain') then
  s:=a.metadata->'stages'->stage;
  if s->>'token' is distinct from p_value->>'token' or s->>'state' is distinct from 'started' then raise exception 'sec425_stage_fenced'; end if;
  if a.status <> 'running' then raise exception 'sec425_execution_terminal'; end if;
  if p_action='uncertain' then
   update public.ai_runs set status='failed',finished_at=now(),error_message='provider_outcome_unknown',metadata=metadata||jsonb_build_object('state','uncertain') where id=p_id;
   return jsonb_build_object('status','uncertain');
  end if;
  cp:=p_value->'response';
  if jsonb_typeof(cp->'body') is distinct from 'string' or (cp->>'status')::integer not between 200 and 599
   or cp->>'bodyHash' is distinct from encode(sha256(convert_to(cp->>'body','UTF8')),'hex') then raise exception 'sec425_checkpoint_invalid'; end if;
  s:=s||jsonb_build_object('state','complete','completedAt',now(),'response',cp);
  update public.ai_runs set metadata=jsonb_set(metadata,'{stages}',(metadata->'stages')||jsonb_build_object(stage,s)) where id=p_id;
  return jsonb_build_object('saved',true);
 else raise exception 'sec425_transition_invalid'; end if;
end $$;

create function public.finish_sec425_facts(p_id uuid,p_status text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; o public.ai_outputs; r public.raw_items;
begin
 select * into strict a from public.ai_runs where id=p_id and prompt_key='sec425_facts' for update;
 if p_status is null or p_status not in ('succeeded','failed','stale') or p_payload->'binding' is distinct from a.metadata->'binding'
 then raise exception 'sec425_output_binding_invalid'; end if;
 select * into o from public.ai_outputs where ai_run_id=p_id and output_type='sec425_facts';
 if found then
  if o.payload is distinct from p_payload then raise exception 'sec425_immutable_result'; end if;
  return jsonb_build_object('status',a.metadata->>'state','replayed',true);
 end if;
 if a.status not in ('pending','running') then return jsonb_build_object('status',a.metadata->>'state'); end if;
 if p_status='succeeded' and (a.metadata->'stages'->'fact'->>'state' is distinct from 'complete'
  or jsonb_typeof(p_payload->'canonical') is distinct from 'object') then raise exception 'sec425_final_checkpoint_required'; end if;
 select * into strict r from public.raw_items where id=a.raw_item_id for share;
 if p_status='succeeded' and a.metadata->'binding'->>'sourceSha256' is distinct from encode(sha256(convert_to(r.raw_payload->>'primary_document_html','UTF8')),'hex') then p_status:='stale'; end if;
 insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec425_facts',p_payload);
 update public.ai_runs set status=p_status,finished_at=now(),metadata=metadata||jsonb_build_object('state',p_status),
 usage=coalesce(p_payload->'usage','{}'::jsonb),error_message=p_payload->>'error' where id=p_id;
 return jsonb_build_object('status',p_status,'replayed',false);
end $$;

create function public.guard_sec425_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='ai_outputs' then
  if old.output_type='sec425_facts' or (tg_op='UPDATE' and new.output_type='sec425_facts') then raise exception 'sec425_output_immutable'; end if;
 elsif old.prompt_key='sec425_facts' or (tg_op='UPDATE' and new.prompt_key='sec425_facts') then
  if tg_op='DELETE' then raise exception 'sec425_history_immutable'; end if;
  if new.id is distinct from old.id or new.raw_item_id is distinct from old.raw_item_id or new.prompt_key is distinct from old.prompt_key
   or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
   or new.metadata->'binding' is distinct from old.metadata->'binding'
   or new.metadata->'reservedAt' is distinct from old.metadata->'reservedAt'
   or (old.metadata->'stages'->'fact'->>'state'='complete' and new.metadata->'stages'->'fact' is distinct from old.metadata->'stages'->'fact')

   or (old.status in ('succeeded','failed','stale') and (new.status is distinct from old.status or new.metadata is distinct from old.metadata
     or new.finished_at is distinct from old.finished_at or new.usage is distinct from old.usage or new.error_message is distinct from old.error_message))
   then raise exception 'sec425_history_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger sec425_run_guard before update or delete on public.ai_runs for each row execute function public.guard_sec425_history();
create trigger sec425_output_guard before update or delete on public.ai_outputs for each row execute function public.guard_sec425_history();
revoke all on function public.reserve_sec425_facts(uuid,jsonb),public.sec425_transition(uuid,text,jsonb),
 public.finish_sec425_facts(uuid,text,jsonb),public.guard_sec425_history() from public,anon,authenticated;
grant execute on function public.reserve_sec425_facts(uuid,jsonb),public.sec425_transition(uuid,text,jsonb),
 public.finish_sec425_facts(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';

alter table public.user_alert_deliveries add column sec425_raw_item_id uuid references public.raw_items(id) on delete restrict, add column sec425_match_evidence jsonb;
create unique index sec425_alert_once on public.user_alert_deliveries(listing_monitor_id,sec425_raw_item_id);
alter table public.user_alert_deliveries drop constraint user_alert_deliveries_listing_alert_shape_check;
alter table public.user_alert_deliveries add constraint user_alert_deliveries_listing_alert_shape_check check (
 (sec425_raw_item_id is null and sec425_match_evidence is null and (
    listing_monitor_id is null or (
      alert_domain = 'listing'
      and listing_source_execution_id is not null and alert_event_id is not null
      and (
        (offering_plan_match_evidence is null and (
          (listing_match_evidence is null and category = 'listing_risk')
          or (listing_match_evidence is not null and category = 'insider_ownership')
        ))
        or (offering_plan_match_evidence is not null and category = 'dilution_risk')
        or coalesce((
          category = 'financial_risk'
          and source_type = 'other' and source_label = 'SEC Filing Monitor'
          and title in ('SEC late-filing notice filed', 'Delayed periodic report filed')
          -- Fail closed for nullable identity fields in this new branch.
          and alert_domain = 'listing'
          and listing_match_evidence is null and offering_plan_match_evidence is null
          and effect_match_evidence is null and effect_registration_key is null
          and projected_fact_id is null and projected_monitor_id is null
          and projected_alert_key is null and projected_scenario is null
          and offering_monitor_id is null and offering_registry_snapshot_id is null
          and offering_registry_accession is null
          and financial_monitor_id is null and financial_source_execution_id is null
          and financial_accession is null and financial_issuer_cik is null
          and sc13_monitor_id is null and sc13_match_evidence is null
          and sc13_position_key is null and sc13_root_accession is null
          and sc13_head_accession is null and sc13_reporter_cik is null
          and sc13_security_class is null and sc13_cusips is null
          and ticker_match is null and calendar_event_id is null
          and severity is null and dedupe_key is null
        ), false)
      )
      and alert_lane = 'listing_monitor' and delivery_status = 'queued'
      and delivered_channels = ARRAY[]::text[]
      and scheduled_for is null and sent_at is null and attempted_at is null
    )))
 or coalesce((sec425_raw_item_id is not null and sec425_match_evidence->>'version'='sec425_alert_v1'
 and sec425_match_evidence->>'rawItemId'=sec425_raw_item_id::text
 and sec425_match_evidence->>'executionId'=listing_source_execution_id::text
 and listing_monitor_id is not null and listing_source_execution_id is not null and alert_event_id is null
 and alert_domain='listing' and alert_lane='listing_monitor' and category='listing_risk'
 and source_type='other' and source_label='425 Announcement Monitor' and delivery_status='queued'
 and delivered_channels=array[]::text[] and scheduled_for is null and sent_at is null and attempted_at is null
 and listing_match_evidence is null and offering_plan_match_evidence is null and secondary_match_evidence is null
 and effect_match_evidence is null and effect_registration_key is null and projected_monitor_id is null
 and offering_monitor_id is null and financial_monitor_id is null and sc13_monitor_id is null and reported_holding_monitor_id is null),false)
);
notify pgrst,'reload schema';

create function public.preserve_sec425_alert_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if new.sec425_match_evidence is distinct from old.sec425_match_evidence
 or new.sec425_raw_item_id is distinct from old.sec425_raw_item_id
 or (old.sec425_raw_item_id is not null and (new.user_id is distinct from old.user_id
 or new.listing_source_execution_id is distinct from old.listing_source_execution_id
 or new.listing_monitor_id is distinct from old.listing_monitor_id
 or new.alert_event_id is distinct from old.alert_event_id)) then raise exception 'sec425_alert_evidence_immutable';end if;
 return new;
end $$;
revoke all on function public.preserve_sec425_alert_evidence() from public,anon,authenticated;
create trigger preserve_sec425_alert_evidence before update on public.user_alert_deliveries for each row execute function public.preserve_sec425_alert_evidence();
