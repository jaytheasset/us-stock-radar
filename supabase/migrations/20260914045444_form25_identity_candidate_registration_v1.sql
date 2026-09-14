begin;
-- Preserve existing immutable evidence, Human decisions and historical events.
create or replace function public.persist_sec_form25_identity(p_raw_item_id uuid,p_evidence jsonb,p_evidence_sha256 text,p_raw_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_row public.sec_form25_identity_evidence; v_old public.sec_form25_identity_evidence; v_human public.sec_form25_identity_human_decisions; v_ticker text; v_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0));
  perform 1 from public.raw_items where id=p_raw_item_id for share;
  if not exists(select 1 from public.raw_items r where r.id=p_raw_item_id and pg_catalog.jsonb_build_object('source',r.source_url,'accession',r.source_unique_id,'body',r.body_text,'analysis',r.analysis_text,'form',r.raw_payload->'form_type','html',r.raw_payload->'primary_document_html','attachments',r.raw_payload->'attachment_texts','payload',r.raw_payload,'title',r.title,'published',r.published_at,'identityMetadata',pg_catalog.jsonb_build_object('company_name',r.metadata->'company_name','accession_number',r.metadata->'accession_number','cik',r.metadata->'cik','form_type',r.metadata->'form_type','ticker',r.metadata->'ticker','exchange',r.metadata->'exchange','form25_exchange',r.metadata->'form25_exchange','listing_exchange',r.metadata->'listing_exchange','removal_exchange',r.metadata->'removal_exchange'))=p_raw_snapshot) then raise exception 'FORM25_IDENTITY_SOURCE_CHANGED'; end if;
  if p_evidence->>'status' not in ('AUTO','REVIEW','UNRESOLVED') or p_evidence->>'version'<>'sec_form25_subject_identity_v1'
     or pg_catalog.jsonb_typeof(p_evidence->'candidates')<>'array' then raise exception 'FORM25_IDENTITY_INVALID'; end if;
  select * into v_old from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
  if v_old.evidence_sha256=p_evidence_sha256 then v_row:=v_old;end if;
  if v_row.id is not null then
    if v_row.evidence<>p_evidence then raise exception 'FORM25_IDENTITY_HASH_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('status','replayed','id',v_row.id);
  end if;
  insert into public.sec_form25_identity_evidence(raw_item_id,evidence_sha256,evidence) values(p_raw_item_id,p_evidence_sha256,p_evidence) returning * into v_row;
  select * into v_human from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
  v_state:=p_evidence->>'status';
  if v_human.id is not null and v_human.action<>'withdrawn' then v_state:='REVIEW';
  elsif v_state='AUTO' then v_ticker:=p_evidence->'candidates'->0->>'ticker'; end if;
  -- Identity is consumed through the effective reader; historical event rows stay unchanged.
  return pg_catalog.jsonb_build_object('status','inserted','id',v_row.id);
end $fn$;
revoke all on function public.persist_sec_form25_identity(uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_sec_form25_identity(uuid,jsonb,text,jsonb) to service_role;

create or replace function public.admin_apply_sec_form25_identity_decision(p_raw_item_id uuid,p_actor_user_id uuid,p_action text,p_candidate_index integer,
 p_expected_sha256 text,p_expected_revision integer,p_reason text,p_request_id text,p_raw_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_identity public.sec_form25_identity_evidence; v_previous public.sec_form25_identity_human_decisions; v_replay public.sec_form25_identity_human_decisions;
 v_role text;v_payload jsonb;v_candidate jsonb;v_ticker text;v_exchange text;v_state text;v_id uuid:=extensions.gen_random_uuid();v_audit uuid:=extensions.gen_random_uuid();v_revision integer;
begin
 v_role:=private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
 if v_role is null then raise exception 'ADMIN_PERMISSION_REQUIRED'; end if;
 if p_action not in ('approved','held','withdrawn') or length(trim(p_reason)) not between 4 and 2000 or length(p_request_id) not between 1 and 240 then raise exception 'FORM25_IDENTITY_ACTION_INVALID'; end if;
 v_payload:=pg_catalog.jsonb_build_object('rawItemId',p_raw_item_id,'actorUserId',p_actor_user_id,'action',p_action,'candidateIndex',p_candidate_index,'sha',p_expected_sha256,'revision',p_expected_revision,'reason',trim(p_reason));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0));
  perform 1 from public.raw_items where id=p_raw_item_id for share;
  if not exists(select 1 from public.raw_items r where r.id=p_raw_item_id and pg_catalog.jsonb_build_object('source',r.source_url,'accession',r.source_unique_id,'body',r.body_text,'analysis',r.analysis_text,'form',r.raw_payload->'form_type','html',r.raw_payload->'primary_document_html','attachments',r.raw_payload->'attachment_texts','payload',r.raw_payload,'title',r.title,'published',r.published_at,'identityMetadata',pg_catalog.jsonb_build_object('company_name',r.metadata->'company_name','accession_number',r.metadata->'accession_number','cik',r.metadata->'cik','form_type',r.metadata->'form_type','ticker',r.metadata->'ticker','exchange',r.metadata->'exchange','form25_exchange',r.metadata->'form25_exchange','listing_exchange',r.metadata->'listing_exchange','removal_exchange',r.metadata->'removal_exchange'))=p_raw_snapshot) then raise exception 'FORM25_IDENTITY_SOURCE_CHANGED'; end if;
 select * into v_replay from public.sec_form25_identity_human_decisions where request_id=p_request_id;
 if v_replay.id is not null then
  if v_replay.request_payload<>v_payload then raise exception 'FORM25_IDENTITY_REPLAY_CONFLICT';end if;
  return pg_catalog.jsonb_build_object('status','replayed','id',v_replay.id);
 end if;
 select * into v_identity from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
 select * into v_previous from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
 if v_identity.id is null or v_identity.evidence_sha256 is distinct from p_expected_sha256 or coalesce(v_previous.revision,0) is distinct from p_expected_revision then raise exception 'FORM25_IDENTITY_STALE';end if;
 v_revision:=coalesce(v_previous.revision,0)+1;
 v_state:=v_identity.evidence->>'status';
 if p_action='approved' then
  if p_candidate_index is null or p_candidate_index<0 or p_candidate_index>=pg_catalog.jsonb_array_length(v_identity.evidence->'candidates')
    or v_identity.evidence->>'reason' in ('subject_cik_conflict','subject_cik_unavailable','security_identity_unavailable')
    or not(v_state='AUTO' or v_identity.evidence->>'mode'='historical_replay') then raise exception 'FORM25_IDENTITY_APPROVAL_EVIDENCE_REQUIRED';end if;
  v_candidate:=v_identity.evidence->'candidates'->p_candidate_index;
  if v_candidate->>'cik' is distinct from v_identity.evidence->>'subjectCik' or coalesce(v_candidate->>'ticker','') !~ '^[A-Z][A-Z0-9.-]{0,9}$' then raise exception 'FORM25_IDENTITY_CANDIDATE_INVALID';end if;
  v_ticker:=v_candidate->>'ticker';v_state:='HUMAN_APPROVED';
 elsif p_action='held' then v_state:='HELD';
 else
  if v_previous.id is null or v_previous.action='withdrawn' then raise exception 'FORM25_IDENTITY_WITHDRAWAL_UNAVAILABLE';end if;
  if v_state='AUTO' then v_ticker:=v_identity.evidence->'candidates'->0->>'ticker';end if;
 end if;
 v_exchange:=v_identity.evidence->>'exchange';
 insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
 values(v_audit,p_actor_user_id,v_role,'form25_identity.'||p_action,'sec_form25_identity',p_raw_item_id::text,trim(p_reason),case when v_previous.id is null then null else pg_catalog.to_jsonb(v_previous) end,
 pg_catalog.jsonb_build_object('decisionId',v_id,'identityId',v_identity.id,'evidence',v_identity.evidence,'ticker',v_ticker,'state',v_state,'revision',v_revision),p_request_id);
 insert into public.sec_form25_identity_human_decisions(id,raw_item_id,identity_id,revision,action,candidate_index,actor_user_id,actor_role,reason,previous_decision_id,request_id,request_payload,audit_log_id)
 values(v_id,p_raw_item_id,v_identity.id,v_revision,p_action,case when p_action='approved' then p_candidate_index else null end,p_actor_user_id,v_role,trim(p_reason),v_previous.id,p_request_id,v_payload,v_audit);
 -- Human decisions never rewrite the original event or ticker-link rows.
 return pg_catalog.jsonb_build_object('status','inserted','id',v_id,'revision',v_revision);
end $fn$;
revoke all on function public.admin_apply_sec_form25_identity_decision(uuid,uuid,text,integer,text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_apply_sec_form25_identity_decision(uuid,uuid,text,integer,text,integer,text,text,jsonb) to service_role;


create or replace function public.admin_register_sec_form25_identity_candidate(
 p_raw_item_id uuid,p_actor_user_id uuid,p_evidence jsonb,p_evidence_sha256 text,p_raw_snapshot jsonb,
 p_expected_sha256 text,p_expected_revision integer,p_reason text,p_request_id text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare role_name text; latest public.sec_form25_identity_evidence; human public.sec_form25_identity_human_decisions;
 replay public.admin_audit_logs; request_data jsonb; written jsonb; audit_id uuid:=extensions.gen_random_uuid();
begin
 role_name:=private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
 if role_name is null then raise exception 'ADMIN_PERMISSION_REQUIRED';end if;
 if coalesce(length(trim(p_reason)),0) not between 4 and 2000 or coalesce(length(p_request_id),0) not between 1 and 240 then raise exception 'FORM25_CANDIDATE_REASON_REQUIRED';end if;
 if p_evidence->>'status' is distinct from 'REVIEW' or p_evidence->>'mode' is distinct from 'historical_replay'
  or p_evidence->>'reason' is distinct from 'manual_candidate_sec_evidence_requires_approval'
  or pg_catalog.jsonb_array_length(p_evidence->'candidates')<>1
  or p_evidence->'candidates'->0->>'cik' is distinct from p_evidence->>'subjectCik'
  or coalesce(p_evidence->'candidates'->0->>'ticker','') !~ '^[A-Z][A-Z0-9.-]{0,9}$'
  or coalesce(p_evidence->'candidates'->0->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'FORM25_CANDIDATE_EVIDENCE_REQUIRED';end if;
 request_data:=pg_catalog.jsonb_build_object('actor',p_actor_user_id,'raw',p_raw_item_id,'evidence',p_evidence,'expectedSha',p_expected_sha256,'expectedRevision',p_expected_revision,'reason',trim(p_reason));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_candidate_request:'||p_request_id,0));
 select * into replay from public.admin_audit_logs where request_id=p_request_id and action='form25_identity.candidate_registered' limit 1;
 if replay.id is not null then
  if replay.after_data->'request' is distinct from request_data then raise exception 'FORM25_CANDIDATE_REPLAY_CONFLICT';end if;
  return pg_catalog.jsonb_build_object('status','replayed','id',replay.after_data->>'identityId','auditId',replay.id);
 end if;
 select * into latest from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
 select * into human from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
 if latest.id is null or latest.evidence_sha256 is distinct from p_expected_sha256 or coalesce(human.revision,0) is distinct from p_expected_revision then raise exception 'FORM25_IDENTITY_STALE';end if;
 written:=public.persist_sec_form25_identity(p_raw_item_id,p_evidence,p_evidence_sha256,p_raw_snapshot);
 insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
 values(audit_id,p_actor_user_id,role_name,'form25_identity.candidate_registered','sec_form25_identity',p_raw_item_id::text,trim(p_reason),pg_catalog.to_jsonb(latest),pg_catalog.jsonb_build_object('identityId',written->>'id','request',request_data),p_request_id);
 return written||pg_catalog.jsonb_build_object('auditId',audit_id);
end $fn$;
revoke all on function public.admin_register_sec_form25_identity_candidate(uuid,uuid,jsonb,text,jsonb,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.admin_register_sec_form25_identity_candidate(uuid,uuid,jsonb,text,jsonb,text,integer,text,text) to service_role;

commit;
