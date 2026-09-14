-- Expand typed Human analysis corrections only. No source/identity/event rewrite or backfill.
-- Original applied migration20260914041702 remains unchanged.
create or replace function public.admin_apply_sec_form25_analysis_decision(p_raw_item_id uuid,p_actor_user_id uuid,p_action text,p_corrections jsonb,p_reason text,
 p_expected_version text,p_actual_version text,p_expected_revision integer,p_request_id text,p_basis jsonb,p_source_sha256 text,p_retry_ai_run_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare r public.raw_items;prev public.sec_form25_analysis_decisions;replayed public.sec_form25_analysis_decisions;
 role_name text;request_data jsonb;latest_ai uuid;v_id uuid:=extensions.gen_random_uuid();audit_id uuid:=extensions.gen_random_uuid();field record;revision_no integer;
begin
 role_name:=private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
 if role_name is null then raise exception 'ADMIN_PERMISSION_REQUIRED';end if;
 if p_expected_revision is null or p_expected_revision<0 or coalesce(p_expected_version,'') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_ANALYSIS_REVISION';end if;
 if p_action not in('corrected','unavailable','awaiting_filing','withdrawn','retry_requested','retry_completed','retry_cancelled') or length(trim(p_reason)) not between 4 and 2000 or length(p_request_id) not between 1 and 240 then raise exception 'INVALID_ANALYSIS_ACTION';end if;
 request_data:=pg_catalog.jsonb_build_object('actor',p_actor_user_id,'action',p_action,'corrections',p_corrections,'reason',trim(p_reason),'version',p_expected_version,'revision',p_expected_revision,'retryAiRunId',p_retry_ai_run_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('form25_analysis:'||p_raw_item_id::text,0));
 select * into replayed from public.sec_form25_analysis_decisions where raw_item_id=p_raw_item_id and request_id=p_request_id;
 if replayed.id is not null then
  if replayed.request_payload is distinct from request_data then raise exception 'ANALYSIS_REPLAY_CONFLICT';end if;
  return pg_catalog.jsonb_build_object('id',replayed.id,'revision',replayed.revision,'replayed',true);
 end if;
 select * into r from public.raw_items where id=p_raw_item_id for share;
 if r.id is null or upper(coalesce(r.raw_payload->>'form_type','')) !~ '^(FORM )?25(-NSE)?(/A)?$' then raise exception 'FORM25_REQUIRED';end if;
 if pg_catalog.jsonb_build_object('source',r.source_url,'accession',r.source_unique_id,'body',r.body_text,'analysis',r.analysis_text,'form',r.raw_payload->'form_type','html',r.raw_payload->'primary_document_html','attachments',r.raw_payload->'attachment_texts','payload',r.raw_payload,'title',r.title,'published',r.published_at,'identityMetadata',pg_catalog.jsonb_build_object('company_name',r.metadata->'company_name','accession_number',r.metadata->'accession_number','cik',r.metadata->'cik','form_type',r.metadata->'form_type','ticker',r.metadata->'ticker','exchange',r.metadata->'exchange','form25_exchange',r.metadata->'form25_exchange','listing_exchange',r.metadata->'listing_exchange','removal_exchange',r.metadata->'removal_exchange')) is distinct from p_basis->'rawSnapshot' then raise exception 'ANALYSIS_SOURCE_CHANGED';end if;
 select id into latest_ai from public.ai_runs where raw_item_id=p_raw_item_id and prompt_key ilike '%form25%' order by started_at desc,id desc limit 1;
 if latest_ai::text is distinct from p_basis->>'latestAiRunId' then raise exception 'ANALYSIS_VERSION_CHANGED';end if;
 if p_basis->>'outputId' is not null and not exists(select 1 from public.ai_outputs o join public.ai_runs a on a.id=o.ai_run_id where o.id::text=p_basis->>'outputId' and a.raw_item_id=p_raw_item_id and o.payload=p_basis->'outputPayload') then raise exception 'ANALYSIS_OUTPUT_CHANGED';end if;
 select * into prev from public.sec_form25_analysis_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
 if coalesce(prev.revision,0)<>p_expected_revision or p_expected_version is distinct from p_actual_version then raise exception 'ANALYSIS_STALE_REVIEW';end if;
 if p_action='withdrawn' and coalesce((select d.action from public.sec_form25_analysis_decisions d where d.raw_item_id=p_raw_item_id and d.action in('corrected','unavailable','awaiting_filing','withdrawn') order by d.revision desc limit 1),'withdrawn')='withdrawn' then raise exception 'NO_HUMAN_DECISION_TO_WITHDRAW';end if;
 if p_action='retry_requested' and prev.action='retry_requested' then raise exception 'ANALYSIS_RETRY_IN_PROGRESS';end if;
 if p_action='retry_completed' and (prev.action is distinct from 'retry_requested' or p_retry_ai_run_id is null or not exists(select 1 from public.ai_runs where id=p_retry_ai_run_id and raw_item_id=p_raw_item_id)) then raise exception 'ANALYSIS_RETRY_NOT_CLAIMED';end if;
 if p_action='retry_cancelled' and prev.action is distinct from 'retry_requested' then raise exception 'ANALYSIS_RETRY_NOT_CLAIMED';end if;
 if p_action='corrected' then
  if pg_catalog.jsonb_typeof(p_corrections)<>'object' or p_corrections='{}'::jsonb then raise exception 'ANALYSIS_CORRECTIONS_REQUIRED';end if;
  for field in select * from pg_catalog.jsonb_each(p_corrections) loop
   if field.key not in('trading_suspension_date','removal_effective_date','event_kind','event_outcome','exchange','security_title') or coalesce(field.value->>'availability','') not in('available','unavailable') or coalesce(field.value->>'sourceRef','') !~ '^(filing|attachment:[0-9]+)$' then raise exception 'INVALID_TYPED_CORRECTION';end if;
   if field.value->>'availability'='unavailable' and field.value->>'value' is not null then raise exception 'UNAVAILABLE_MUST_BE_NULL';end if;
   if field.value->>'availability'='available' then
    if field.key like '%_date' and (coalesce(field.value->>'value','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(field.value->>'dateStatus','') not in('occurred','scheduled','conditional','unknown')) then raise exception 'INVALID_DATE_CORRECTION';end if;
    if field.key in('exchange','security_title') and (pg_catalog.jsonb_typeof(field.value->'value') is distinct from 'string' or length(trim(coalesce(field.value->>'value',''))) not between 2 and 300 or field.value->>'value' ~ '[<>\r\n]') then raise exception 'INVALID_SOURCE_TEXT_CORRECTION';end if;
    if field.key='event_kind' and coalesce(field.value->>'value','') not in('deficiency_notice','compliance_recovery','delisting_determination','hearing_or_appeal_update','trading_suspension','listing_removal','voluntary_withdrawal','other') then raise exception 'INVALID_KIND';end if;
    if field.key='event_outcome' and coalesce(field.value->>'value','') not in('adverse','recovered','procedural','unknown') then raise exception 'INVALID_OUTCOME';end if;
   end if;
  end loop;
 end if;
 revision_no:=coalesce(prev.revision,0)+1;
 insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
 values(audit_id,p_actor_user_id,role_name,'form25_analysis.'||p_action,'sec_form25_analysis',p_raw_item_id::text,trim(p_reason),case when prev.id is null then null else pg_catalog.to_jsonb(prev) end,pg_catalog.jsonb_build_object('id',v_id,'action',p_action,'corrections',p_corrections,'baseVersion',p_actual_version,'revision',revision_no),p_request_id);
 insert into public.sec_form25_analysis_decisions(id,raw_item_id,revision,action,base_version,source_sha256,corrections,actor_user_id,actor_role,reason,previous_decision_id,request_id,request_payload,audit_log_id,retry_ai_run_id)
 values(v_id,p_raw_item_id,revision_no,p_action,p_actual_version,p_source_sha256,case when p_action='corrected' then p_corrections else '{}'::jsonb end,p_actor_user_id,role_name,trim(p_reason),prev.id,p_request_id,request_data,audit_id,p_retry_ai_run_id);
 return pg_catalog.jsonb_build_object('id',v_id,'revision',revision_no,'replayed',false);
end $fn$;
revoke all on function public.admin_apply_sec_form25_analysis_decision(uuid,uuid,text,jsonb,text,text,text,integer,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_apply_sec_form25_analysis_decision(uuid,uuid,text,jsonb,text,text,text,integer,text,jsonb,text,uuid) to service_role;
