begin;
-- Append administrative attribution to the existing history; no original rows are rewritten.
alter table public.sec_form25_identity_human_decisions
 add column override_ticker text,
 add column override_reference text,
 add column withdraws_decision_id uuid references public.sec_form25_identity_human_decisions(id);
alter table public.sec_form25_identity_human_decisions drop constraint sec_form25_identity_human_decisions_action_check;
alter table public.sec_form25_identity_human_decisions add constraint sec_form25_identity_human_decisions_action_check
 check(action in ('approved','held','withdrawn','forced_approved','forced_withdrawn'));
alter table public.sec_form25_identity_human_decisions add constraint sec_form25_identity_forced_fields_check check(
 (action='forced_approved' and override_ticker is not null and override_ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$' and withdraws_decision_id is null)
 or (action='forced_withdrawn' and override_ticker is null and withdraws_decision_id is not null)
 or (action not in ('forced_approved','forced_withdrawn') and override_ticker is null and override_reference is null and withdraws_decision_id is null));

create function private.active_sec_form25_identity_decision(p_raw_item_id uuid)
returns public.sec_form25_identity_human_decisions language plpgsql security invoker set search_path='' as $fn$
declare item public.sec_form25_identity_human_decisions; active public.sec_form25_identity_human_decisions; stack uuid[]:='{}'; depth integer;
begin
 for item in select * from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision asc loop
  depth:=coalesce(pg_catalog.array_length(stack,1),0);
  if item.action='withdrawn' then stack:='{}';
  elsif item.action='forced_withdrawn' then
   if depth=0 or stack[depth] is distinct from item.withdraws_decision_id or not exists(select 1 from public.sec_form25_identity_human_decisions where id=item.withdraws_decision_id and action='forced_approved') then raise exception 'FORM25_OVERRIDE_HISTORY_INVALID';end if;
   stack:=stack[1:depth-1];
  else stack:=pg_catalog.array_append(stack,item.id);end if;
 end loop;
 depth:=coalesce(pg_catalog.array_length(stack,1),0);
 if depth>0 then select * into active from public.sec_form25_identity_human_decisions where id=stack[depth];end if;
 return active;
end $fn$;
revoke all on function private.active_sec_form25_identity_decision(uuid) from public,anon,authenticated;
grant execute on function private.active_sec_form25_identity_decision(uuid) to service_role;

create function public.admin_apply_sec_form25_forced_override(p_raw_item_id uuid,p_actor_user_id uuid,p_action text,p_ticker text,p_reference text,p_reason text,
 p_expected_sha256 text,p_expected_revision integer,p_request_id text,p_raw_snapshot jsonb,p_reference_snapshots jsonb,p_conflict_checks jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare role_name text; latest public.sec_form25_identity_evidence; previous public.sec_form25_identity_human_decisions;
 active public.sec_form25_identity_human_decisions; replay public.sec_form25_identity_human_decisions; request_data jsonb; reference_row jsonb;
 new_id uuid:=extensions.gen_random_uuid();audit_id uuid:=extensions.gen_random_uuid();revision_number integer;withdraw_id uuid;
begin
 role_name:=private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
 if role_name is null then raise exception 'ADMIN_PERMISSION_REQUIRED';end if;
 if coalesce(p_action,'') not in ('forced_approved','forced_withdrawn') or coalesce(length(trim(p_reason)),0) not between 4 and 2000
  or coalesce(length(p_request_id),0) not between 1 and 240 then raise exception 'FORM25_OVERRIDE_INPUT_INVALID';end if;
 if p_action='forced_approved' and coalesce(p_ticker,'') !~ '^[A-Z][A-Z0-9.-]{0,9}$' then raise exception 'FORM25_OVERRIDE_TICKER_REQUIRED';end if;
 if p_reference is not null and (length(p_reference)>2000 or p_reference !~ '^(\d{10}-\d{2}-\d{6}|https://(www\.)?sec\.gov/[^[:space:]]*)$') then raise exception 'FORM25_OVERRIDE_REFERENCE_INVALID';end if;
 if pg_catalog.jsonb_typeof(p_reference_snapshots) is distinct from 'array' or pg_catalog.jsonb_typeof(p_conflict_checks) is distinct from 'array' then raise exception 'FORM25_OVERRIDE_CHECKS_INVALID';end if;
 request_data:=pg_catalog.jsonb_build_object('rawItemId',p_raw_item_id,'actorUserId',p_actor_user_id,'action',p_action,'ticker',p_ticker,'reference',p_reference,'reason',trim(p_reason),'sha',p_expected_sha256,'revision',p_expected_revision);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_override_request:'||p_request_id,0));
 select * into replay from public.sec_form25_identity_human_decisions where request_id=p_request_id;
 if replay.id is not null then
  if replay.request_payload is distinct from request_data then raise exception 'FORM25_OVERRIDE_REPLAY_CONFLICT';end if;
  return pg_catalog.jsonb_build_object('status','replayed','id',replay.id,'revision',replay.revision);
 end if;
 perform 1 from public.raw_items where id=p_raw_item_id for share;
 if not exists(select 1 from public.raw_items r where r.id=p_raw_item_id and pg_catalog.jsonb_build_object('source',r.source_url,'accession',r.source_unique_id,'body',r.body_text,'analysis',r.analysis_text,'form',r.raw_payload->'form_type','html',r.raw_payload->'primary_document_html','attachments',r.raw_payload->'attachment_texts','payload',r.raw_payload,'title',r.title,'published',r.published_at,'identityMetadata',pg_catalog.jsonb_build_object('company_name',r.metadata->'company_name','accession_number',r.metadata->'accession_number','cik',r.metadata->'cik','form_type',r.metadata->'form_type','ticker',r.metadata->'ticker','exchange',r.metadata->'exchange','form25_exchange',r.metadata->'form25_exchange','listing_exchange',r.metadata->'listing_exchange','removal_exchange',r.metadata->'removal_exchange'))=p_raw_snapshot) then raise exception 'FORM25_IDENTITY_SOURCE_CHANGED';end if;
 for reference_row in select value from pg_catalog.jsonb_array_elements(p_reference_snapshots) loop
  perform 1 from public.raw_items where id=(reference_row->>'id')::uuid for share;
  if not exists(select 1 from public.raw_items r where r.id=(reference_row->>'id')::uuid and pg_catalog.jsonb_build_object('source',r.source_url,'accession',r.source_unique_id,'body',r.body_text,'analysis',r.analysis_text,'form',r.raw_payload->'form_type','html',r.raw_payload->'primary_document_html','attachments',r.raw_payload->'attachment_texts','payload',r.raw_payload,'title',r.title,'published',r.published_at,'identityMetadata',pg_catalog.jsonb_build_object('company_name',r.metadata->'company_name','accession_number',r.metadata->'accession_number','cik',r.metadata->'cik','form_type',r.metadata->'form_type','ticker',r.metadata->'ticker','exchange',r.metadata->'exchange','form25_exchange',r.metadata->'form25_exchange','listing_exchange',r.metadata->'listing_exchange','removal_exchange',r.metadata->'removal_exchange'))=reference_row->'snapshot') then raise exception 'FORM25_OVERRIDE_REFERENCE_CHANGED';end if;
 end loop;
 select * into latest from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
 select * into previous from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
 if latest.id is null or latest.evidence_sha256 is distinct from p_expected_sha256 or coalesce(previous.revision,0) is distinct from p_expected_revision then raise exception 'FORM25_IDENTITY_STALE';end if;
 if p_action='forced_approved' and latest.evidence->>'reason'='subject_cik_conflict' then raise exception 'FORM25_OVERRIDE_SUBJECT_CONFLICT';end if;
 if p_action='forced_withdrawn' then
  active:=private.active_sec_form25_identity_decision(p_raw_item_id);
  if active.id is null or active.action<>'forced_approved' then raise exception 'FORM25_OVERRIDE_WITHDRAWAL_UNAVAILABLE';end if;
  withdraw_id:=active.id;
 end if;
 revision_number:=coalesce(previous.revision,0)+1;
 insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
 values(audit_id,p_actor_user_id,role_name,'form25_identity.'||p_action,'sec_form25_identity',p_raw_item_id::text,trim(p_reason),case when previous.id is null then null else pg_catalog.to_jsonb(previous) end,
 pg_catalog.jsonb_build_object('decisionId',new_id,'identityId',latest.id,'evidence',latest.evidence,'ticker',p_ticker,'reference',p_reference,'conflictChecks',p_conflict_checks,'withdrawsDecisionId',withdraw_id,'revision',revision_number),p_request_id);
 insert into public.sec_form25_identity_human_decisions(id,raw_item_id,identity_id,revision,action,candidate_index,actor_user_id,actor_role,reason,previous_decision_id,request_id,request_payload,audit_log_id,override_ticker,override_reference,withdraws_decision_id)
 values(new_id,p_raw_item_id,latest.id,revision_number,p_action,null,p_actor_user_id,role_name,trim(p_reason),previous.id,p_request_id,request_data,audit_id,case when p_action='forced_approved' then p_ticker else null end,p_reference,withdraw_id);
 return pg_catalog.jsonb_build_object('status','inserted','id',new_id,'revision',revision_number);
end $fn$;
revoke all on function public.admin_apply_sec_form25_forced_override(uuid,uuid,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_apply_sec_form25_forced_override(uuid,uuid,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb) to service_role;

create or replace function private.current_sec_form25_identity(p_raw_item_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare e public.sec_form25_identity_evidence; h public.sec_form25_identity_human_decisions;s text;t text;revision_number integer;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0)) then
  return pg_catalog.jsonb_build_object('status','unavailable','state','UNRESOLVED','ticker',null,'reason','identity_decision_in_progress');
 end if;
 select * into e from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
 select coalesce(max(revision),0) into revision_number from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id;
 h:=private.active_sec_form25_identity_decision(p_raw_item_id);
 s:=coalesce(e.evidence->>'status','UNRESOLVED');
 if h.id is not null then
  if h.identity_id<>e.id then s:='REVIEW';
  elsif h.action='held' then s:='HELD';
  elsif h.action='approved' then s:='HUMAN_APPROVED';t:=e.evidence->'candidates'->h.candidate_index->>'ticker';
  elsif h.action='forced_approved' then s:='HUMAN_APPROVED';t:=h.override_ticker;
  end if;
 elsif s='AUTO' and pg_catalog.jsonb_array_length(e.evidence->'candidates')=1 then t:=e.evidence->'candidates'->0->>'ticker';end if;
 return pg_catalog.jsonb_build_object('status',case when e.id is null then 'unavailable' else 'available' end,'state',s,'ticker',t,'exchange',e.evidence->>'exchange','identityId',e.id,'evidenceSha256',e.evidence_sha256,'revision',revision_number,'reason',case when h.action='forced_approved' then 'forced_manual_override' else coalesce(e.evidence->>'reason','identity_unavailable') end);
end $fn$;
commit;
