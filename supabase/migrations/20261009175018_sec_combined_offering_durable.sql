begin;
create unique index sec_combined_key on public.ai_runs ((metadata->'binding'->>'key')) where prompt_key='sec_combined_offering';
create unique index sec_combined_output on public.ai_outputs(ai_run_id) where output_type='sec_combined_offering';
create function public.reserve_sec_combined_offering(p_binding jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.ai_runs; r public.raw_items; f jsonb; d jsonb; k text; childkey text; domain text; added boolean;
begin
 if jsonb_typeof(p_binding) is distinct from 'object' or octet_length(p_binding::text)>16384 then raise exception 'combined_compact_binding_required'; end if;
 if not p_binding ?& array['rawItemId','accession','sourceVersion','sourceFingerprint','contractVersion','schemaHash','promptHash','osContractVersion','osSchemaHash','offeringContractVersion','offeringSchemaHash','key','id','providerProfile','filing','ticker','documents','blockCount','family','osRunId','offeringRunId']
 or jsonb_typeof(p_binding->'documents') is distinct from 'array' or jsonb_typeof(p_binding->'filing') is distinct from 'object'
 or jsonb_typeof(p_binding->'blockCount') is distinct from 'number' then raise exception 'combined_binding_shape_invalid';end if;
 k:=p_binding->>'key';f:=p_binding->'filing';d:=p_binding->'documents'->0;
 if (p_binding-array['rawItemId','accession','sourceVersion','sourceFingerprint','contractVersion','schemaHash','promptHash','osContractVersion','osSchemaHash','offeringContractVersion','offeringSchemaHash','key','id','providerProfile','filing','ticker','documents','blockCount','family','osRunId','offeringRunId'])<>'{}'::jsonb
 or coalesce(k,'')!~'^[0-9a-f]{64}$' or coalesce(p_binding->>'sourceFingerprint','')!~'^[0-9a-f]{64}$'
 or p_binding->>'contractVersion' is distinct from 'combined_offering_v1-output-r1'
 or p_binding->>'sourceVersion' is distinct from 'combined_offering_source_v1'
 or p_binding->>'id' is distinct from substr(k,1,8)||'-'||substr(k,9,4)||'-5'||substr(k,14,3)||'-a'||substr(k,18,3)||'-'||substr(k,21,12)
 or p_binding->>'providerProfile' is distinct from 'codex-cli:gpt-6-astra:high:v1'
 or p_binding->>'accession' is distinct from f->>'accession'
 or (p_binding->>'blockCount')::integer<1
 or jsonb_typeof(d) is distinct from 'object'
 or coalesce(d->>'original_sha256','')!~'^[0-9a-f]{64}$' or coalesce(d->>'text_sha256','')!~'^[0-9a-f]{64}$'
 or p_binding ? 'source' or jsonb_array_length(p_binding->'documents')<>1
 or (d-array['id','original_sha256','text_sha256'])<>'{}'::jsonb then raise exception 'combined_binding_invalid';end if;
 foreach domain in array array['os','offering'] loop
  childkey:=encode(sha256(convert_to(k||':'||domain,'UTF8')),'hex');
  if p_binding->>(case when domain='os' then 'osRunId' else 'offeringRunId' end) is distinct from
   substr(childkey,1,8)||'-'||substr(childkey,9,4)||'-5'||substr(childkey,14,3)||'-a'||substr(childkey,18,3)||'-'||substr(childkey,21,12)
  then raise exception 'combined_child_identity_invalid';end if;
 end loop;
 select * into a from public.ai_runs where id=(p_binding->>'id')::uuid;
 if found then
  if a.prompt_key<>'sec_combined_offering' or a.metadata->'binding' is distinct from p_binding then raise exception 'combined_identity_conflict';end if;
  return jsonb_build_object('id',a.id,'inserted',false,'status',a.metadata->>'combinedStatus');
 end if;
 select * into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
 if r.source_code is distinct from 'sec_edgar' or r.source_unique_id is distinct from f->>'accession'
 or r.raw_payload->>'accession_number' is distinct from f->>'accession'
 or r.raw_payload->>'form_type' not in ('S-1','S-1/A','S-3','S-3/A','424B3','424B5')
 or r.raw_payload->>'form_type' is distinct from f->>'form'
 or r.raw_payload->>'cik' is distinct from f->>'cik'
 or r.raw_payload->>'company_name' is distinct from f->>'issuer'
 or nullif(r.raw_payload->>'filing_date','') is null or r.raw_payload->>'filing_date' is distinct from f->>'filing_date'
 or (nullif(r.raw_payload->>'combined_offering_primary_html','') is null and r.raw_payload->>'primary_document_html_truncated' is distinct from 'false')
 or encode(sha256(convert_to(coalesce(nullif(r.raw_payload->>'combined_offering_primary_html',''),r.raw_payload->>'primary_document_html'),'UTF8')),'hex') is distinct from d->>'original_sha256'
 then raise exception 'combined_source_binding_mismatch';end if;
 insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
 values((p_binding->>'id')::uuid,r.id,'sec_combined_offering',p_binding->>'contractVersion',p_binding->>'providerProfile','pending',
 jsonb_build_object('binding',p_binding,'combinedStatus','QUEUED','attempt',1,'reservedAt',clock_timestamp())) on conflict do nothing;
 added:=found;
 select * into strict a from public.ai_runs where id=(p_binding->>'id')::uuid;
 if a.metadata->'binding' is distinct from p_binding then raise exception 'combined_identity_conflict';end if;
 return jsonb_build_object('id',a.id,'inserted',added,'status',a.metadata->>'combinedStatus');
end $$;

create function public.sec_combined_offering_transition(p_id uuid,p_action text,p_token text default null,p_value jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare a public.ai_runs; b jsonb; cp jsonb; t timestamptz:=clock_timestamp(); tok text; domain text; runid uuid; purpose text; sk text; ck text; part jsonb; v jsonb; f jsonb; cb jsonb; viewcp jsonb; ds text;
begin
 perform pg_advisory_xact_lock(728193,1);
 select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_combined_offering' for update;
 if a.metadata->>'combinedStatus' not in ('QUEUED','RUNNING') then return jsonb_build_object('claimed',false,'status',a.metadata->>'combinedStatus');end if;
 if p_action='claim' then
  if exists(select 1 from public.ai_runs where prompt_key in ('sec_combined_offering','sec_os_snapshot','sec_offering_plan')
   and coalesce(metadata->>'combinedStatus',metadata->>'osStatus',metadata->>'offeringStatus')='RUNNING' and (metadata->>'leaseUntil')::timestamptz>t)
  then return jsonb_build_object('claimed',false,'status','busy');end if;
  tok:=gen_random_uuid()::text;
  update public.ai_runs set status='running',started_at=coalesce(started_at,t),metadata=metadata||jsonb_build_object('combinedStatus','RUNNING','token',tok,'leaseUntil',t+interval '90 seconds') where id=p_id;
  return jsonb_build_object('claimed',true,'token',tok,'binding',a.metadata->'binding','checkpoint',a.metadata->'combinedCheckpoint');
 end if;
 if a.metadata->>'token' is distinct from p_token or (a.metadata->>'leaseUntil')::timestamptz<=t then raise exception 'combined_lease_lost';end if;
 if p_action='heartbeat' then
  update public.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',t+interval '90 seconds') where id=p_id;
 elsif p_action='provider_started' then
  if a.metadata ? 'combinedJournal' and a.metadata->>'combinedJournal' is distinct from p_value->>'journalId' then raise exception 'combined_journal_location_changed';end if;
  if a.metadata ? 'invocationAttempt' then return jsonb_build_object('recoverOnly',true);end if;
  if nullif(p_value->>'journalId','') is null then raise exception 'combined_journal_required';end if;
  update public.ai_runs set metadata=metadata||jsonb_build_object('combinedJournal',p_value->>'journalId','invocationAttempt',1) where id=p_id;
  return jsonb_build_object('recoverOnly',false);
 elsif p_action='checkpoint' then
  if coalesce(p_value->>'status','') not in ('COMPLETE','TECHNICAL_FAILED')
   or (p_value->>'providerInvoked'='true' and not a.metadata ? 'invocationAttempt') or p_value->>'rawHash' is distinct from
   encode(sha256(case when p_value->'provider'->>'rawBytesBase64' is not null then decode(p_value->'provider'->>'rawBytesBase64','base64') else convert_to(p_value->>'raw','UTF8') end),'hex') then raise exception 'combined_checkpoint_invalid';end if;
  if a.metadata ? 'combinedCheckpoint' and a.metadata->'combinedCheckpoint' is distinct from p_value then raise exception 'combined_checkpoint_immutable';end if;
  update public.ai_runs set metadata=metadata||jsonb_build_object('combinedCheckpoint',p_value) where id=p_id;
 elsif p_action='finish' then
  cp:=a.metadata->'combinedCheckpoint';b:=a.metadata->'binding';
  if cp is null then raise exception 'combined_checkpoint_required';end if;
  insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_combined_offering',cp);
  if cp->>'status'='COMPLETE' then
   foreach domain in array array['os','offering'] loop
    purpose:=case when domain='os' then 'sec_os_snapshot' else 'sec_offering_plan' end;
    sk:=case when domain='os' then 'osStatus' else 'offeringStatus' end;ck:=case when domain='os' then 'osCheckpoint' else 'offeringCheckpoint' end;
    runid:=(b->>(case when domain='os' then 'osRunId' else 'offeringRunId' end))::uuid;
    part:=cp->'validation'->(case when domain='os' then 'os_snapshot' else 'offering_plan' end);
    v:=null;ds:='VALIDATION_FAILED';f:=b->'filing';
    if part->>'ok'='true' then
     if part->'value' is distinct from (cp->>'raw')::jsonb->(case when domain='os' then 'os_snapshot' else 'offering_plan' end)
      or (cp->>'raw')::jsonb->'filing' is distinct from f then raise exception 'combined_domain_projection_mismatch';end if;
     if domain='os' then f:=f-array['accepted_at','file_number','registration_number'];end if;
     v:=jsonb_build_object('version',case when domain='os' then 'os_snapshot_v1' else 'offering_plan_v1' end,'filing',f)||(part->'value');ds:=v->>'status';
    end if;
    cb:=b||jsonb_build_object('id',runid,'key',encode(sha256(convert_to((b->>'key')||':'||domain,'UTF8')),'hex'),
      'source',jsonb_build_object('filing',case when domain='os' then (b->'filing')-array['accepted_at','file_number','registration_number'] else b->'filing' end,'ticker',b->'ticker'));
    viewcp:=jsonb_build_object('status',ds,'validated',v,'validation',part,'rawHash',cp->>'rawHash','combinedInvocationId',p_id,'domain',domain,'provider',jsonb_build_object('providerInvoked',false,'retrySafe',false));
    insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,metadata)
     values(runid,a.raw_item_id,purpose,b->>'contractVersion','derived-domain-view',case when ds='VALIDATION_FAILED' then 'failed' else 'succeeded' end,a.started_at,t,
     jsonb_build_object('binding',cb,'executionKind','derived_domain_view','combinedInvocationId',p_id,'reservedAt',a.metadata->'reservedAt',sk,ds,ck,viewcp));
    insert into public.ai_outputs(ai_run_id,output_type,payload) values(runid,purpose,viewcp);
   end loop;
  end if;
  update public.ai_runs set status=case when cp->>'status'='COMPLETE' then 'succeeded' else 'failed' end,finished_at=t,metadata=metadata||jsonb_build_object('combinedStatus',cp->>'status') where id=p_id;
 else raise exception 'combined_unknown_transition';end if;
 return jsonb_build_object('status',coalesce(cp->>'status','ok'));
end $$;

create function public.guard_sec_combined_offering() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='ai_outputs' then
  if old.output_type='sec_combined_offering' or (tg_op='UPDATE' and new.output_type='sec_combined_offering') then raise exception 'combined_output_immutable';end if;
 elsif old.prompt_key='sec_combined_offering' or (tg_op='UPDATE' and new.prompt_key='sec_combined_offering') then
  if tg_op='DELETE' or new.metadata->'binding' is distinct from old.metadata->'binding' or new.raw_item_id is distinct from old.raw_item_id
  or new.prompt_key is distinct from old.prompt_key or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
  or (old.metadata ? 'combinedCheckpoint' and new.metadata->'combinedCheckpoint' is distinct from old.metadata->'combinedCheckpoint')
  or (old.metadata ? 'invocationAttempt' and (new.metadata->'invocationAttempt' is distinct from old.metadata->'invocationAttempt' or new.metadata->'combinedJournal' is distinct from old.metadata->'combinedJournal'))
  or old.metadata->>'combinedStatus' in ('COMPLETE','TECHNICAL_FAILED') then raise exception 'combined_history_immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger guard_combined_runs before update or delete on public.ai_runs for each row execute function public.guard_sec_combined_offering();
create trigger guard_combined_outputs before update or delete on public.ai_outputs for each row execute function public.guard_sec_combined_offering();
create or replace function public.guard_sec_codex_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if new.prompt_key in ('sec_os_snapshot','sec_offering_plan','sec_combined_offering')
 and coalesce(new.metadata->>'combinedStatus',new.metadata->>'osStatus',new.metadata->>'offeringStatus')='RUNNING'
 and new.metadata->>'token' is distinct from old.metadata->>'token' then
  perform pg_advisory_xact_lock(728193,1);
  if exists(select 1 from public.ai_runs r where r.id<>new.id and r.prompt_key in ('sec_os_snapshot','sec_offering_plan','sec_combined_offering')
   and coalesce(r.metadata->>'combinedStatus',r.metadata->>'osStatus',r.metadata->>'offeringStatus')='RUNNING' and (r.metadata->>'leaseUntil')::timestamptz>clock_timestamp()) then raise exception 'sec_codex_provider_busy';end if;
 end if;return new;
end $$;
revoke all on function public.reserve_sec_combined_offering(jsonb),public.sec_combined_offering_transition(uuid,text,text,jsonb),public.guard_sec_combined_offering() from public,anon,authenticated;
grant execute on function public.reserve_sec_combined_offering(jsonb),public.sec_combined_offering_transition(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
