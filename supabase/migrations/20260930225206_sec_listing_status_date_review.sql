-- Human date decisions are additive audit records, never source/AI/automatic rewrites.
create table public.sec_listing_status_date_reviews (
 id uuid primary key default extensions.gen_random_uuid(),
 observation_id uuid not null references public.sec_listing_status_observations(id),
 revision integer not null check(revision > 0),
 action text not null check(action in ('reviewed','withdrawn')),
 base_version text not null check(base_version ~ '^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 dates jsonb not null,
 actor_user_id uuid not null references auth.users(id), actor_role text not null,
 reason text not null check(length(trim(reason)) between 4 and 2000),
 previous_decision_id uuid references public.sec_listing_status_date_reviews(id),
 request_id text not null, request_payload jsonb not null,
 audit_log_id uuid not null references public.admin_audit_logs(id),
 created_at timestamptz not null default now(),
 unique(observation_id,revision), unique(observation_id,request_id)
);
alter table public.sec_listing_status_date_reviews enable row level security;
revoke all on public.sec_listing_status_date_reviews from public,anon,authenticated,service_role;
grant select,insert on public.sec_listing_status_date_reviews to service_role;
create policy service_read on public.sec_listing_status_date_reviews for select to service_role using(true);
create policy service_insert on public.sec_listing_status_date_reviews for insert to service_role with check(true);
create trigger sec_listing_date_review_append_only before update or delete on public.sec_listing_status_date_reviews
 for each row execute function private.reject_sec_ticker_resolution_human_mutation();

create function public.admin_apply_sec_listing_date_review(
 p_observation_id uuid,p_actor_user_id uuid,p_action text,p_dates jsonb,p_reason text,
 p_expected_version text,p_expected_revision integer,p_request_id text
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 o public.sec_listing_status_observations; r public.raw_items;
 prev public.sec_listing_status_date_reviews; replay public.sec_listing_status_date_reviews;
 role_name text; request_data jsonb; snapshot jsonb; current_facts jsonb; context jsonb;
 f record; doc text; doc_url text; doc_truncated boolean; parsed_date date; attachment jsonb;
 decision_id uuid:=extensions.gen_random_uuid(); audit_id uuid:=extensions.gen_random_uuid(); rev integer;
begin
 role_name:=private.admin_actor_role(p_actor_user_id,array['super_admin','operations']);
 if role_name is null then raise exception 'ADMIN_PERMISSION_REQUIRED'; end if;
 if coalesce(p_action,'') not in('reviewed','withdrawn') or coalesce(length(trim(p_reason)),0) not between 4 and 2000
   or coalesce(length(p_request_id),0) not between 1 and 240 or p_expected_revision is null or p_expected_revision<0
   or coalesce(p_expected_version,'') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_LISTING_REVIEW'; end if;
 request_data:=jsonb_build_object('actor',p_actor_user_id,'action',p_action,'dates',p_dates,'reason',trim(p_reason),
   'version',p_expected_version,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('listing_date_review:'||p_observation_id::text,0));
 select * into replay from public.sec_listing_status_date_reviews where observation_id=p_observation_id and request_id=p_request_id;
 if replay.id is not null then
   if replay.request_payload is distinct from request_data then raise exception 'LISTING_REVIEW_REPLAY_CONFLICT'; end if;
   return jsonb_build_object('id',replay.id,'revision',replay.revision,'replayed',true);
 end if;
 select * into strict o from public.sec_listing_status_observations where id=p_observation_id for share;
 select * into prev from public.sec_listing_status_date_reviews where observation_id=p_observation_id order by revision desc limit 1;
 if o.observation_sha256 is distinct from p_expected_version or coalesce(prev.revision,0)<>p_expected_revision then
   raise exception 'LISTING_REVIEW_STALE_REVISION'; end if;
 if p_action='withdrawn' then
   if prev.action is distinct from 'reviewed' or p_dates is distinct from '{}'::jsonb then raise exception 'NO_LISTING_REVIEW_TO_WITHDRAW'; end if;
 else
   select * into strict r from public.raw_items where id=o.raw_item_id for share;
   snapshot:=jsonb_build_object('id',r.id,'source_code',r.source_code,'source_group',r.source_group,
     'source_unique_id',r.source_unique_id,'source_url',r.source_url,'published_at',r.published_at,'fetched_at',r.fetched_at,'raw_payload',r.raw_payload);
   if (snapshot-'published_at'-'fetched_at') is distinct from ((o.observation->'sourceSnapshot')-'published_at'-'fetched_at')
     or r.published_at is distinct from (o.observation#>>'{sourceSnapshot,published_at}')::timestamptz
     or r.fetched_at is distinct from (o.observation#>>'{sourceSnapshot,fetched_at}')::timestamptz then
     raise exception 'LISTING_REVIEW_SOURCE_CHANGED'; end if;
   context:=o.observation->'listingRisk';
   if context is not null and context<>'null'::jsonb then
     current_facts:=public.read_current_event_listing_risk_facts(o.event_id,context->>'analyzerContractVersion');
     if current_facts->>'status' is distinct from context->>'status'
       or current_facts->'facts' is distinct from context->'facts'
       or current_facts->>'source_execution_id' is distinct from context->>'sourceExecutionId'
       or current_facts->>'parent_primary_ai_run_id' is distinct from context->>'parentPrimaryAiRunId'
       then raise exception 'LISTING_REVIEW_ANALYSIS_CHANGED'; end if;
   end if;
   if coalesce(jsonb_typeof(p_dates),'')<>'object' or
     (select array_agg(key order by key) from jsonb_object_keys(p_dates) key) is distinct from array['notice_date','suspension_effective_date'] then
     raise exception 'LISTING_REVIEW_DATE_ROLES_REQUIRED'; end if;
   for f in select * from jsonb_each(p_dates) loop
     if coalesce(jsonb_typeof(f.value),'')<>'object'
       or (select array_agg(key order by key) from jsonb_object_keys(f.value) key) is distinct from array['availability','quote','sourceHash','sourceRef','value']
       or coalesce(f.value->>'availability','') not in('available','unknown')
       or coalesce(length(f.value->>'quote'),0) not between 20 and 4000 then raise exception 'INVALID_LISTING_REVIEW_DATE'; end if;
     if f.value->>'availability'='unknown' then
       if f.value->'value' is distinct from 'null'::jsonb then raise exception 'UNKNOWN_DATE_MUST_BE_NULL'; end if;
     else
       if coalesce(f.value->>'value','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_CALENDAR_DATE'; end if;
       parsed_date:=(f.value->>'value')::date;
       if to_char(parsed_date,'YYYY-MM-DD')<>f.value->>'value' then raise exception 'INVALID_CALENDAR_DATE'; end if;
     end if;
     if f.value->>'sourceRef'='primary' then
       doc:=r.raw_payload->>'primary_document_html'; doc_url:=r.raw_payload->>'primary_document_url';
       doc_truncated:=coalesce((r.raw_payload->>'primary_document_html_truncated')::boolean,false);
     elsif f.value->>'sourceRef' ~ '^attachment:[0-9]+$' then
       attachment:=r.raw_payload->'attachment_texts'->split_part(f.value->>'sourceRef',':',2)::integer;
       doc:=attachment->>'text'; doc_url:=attachment->>'url'; doc_truncated:=coalesce((attachment->>'textTruncated')::boolean,false);
     else raise exception 'INVALID_LISTING_REVIEW_SOURCE'; end if;
     if coalesce(doc,'')='' or doc_truncated or doc_url is null
       or encode(extensions.digest(convert_to(doc,'UTF8'),'sha256'),'hex') is distinct from f.value->>'sourceHash' then
       raise exception 'LISTING_REVIEW_SOURCE_HASH_MISMATCH'; end if;
     -- The server additionally verifies the verbatim normalized quote. No AI value is repaired.
   end loop;
 end if;
 rev:=coalesce(prev.revision,0)+1;
 insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,before_data,after_data,request_id)
 values(audit_id,p_actor_user_id,role_name,'listing_status_dates.'||p_action,'sec_listing_status_observation',p_observation_id::text,
   trim(p_reason),case when prev.id is null then null else to_jsonb(prev) end,
   jsonb_build_object('id',decision_id,'dates',p_dates,'revision',rev,'baseVersion',p_expected_version),p_request_id);
 insert into public.sec_listing_status_date_reviews(id,observation_id,revision,action,base_version,source_sha256,dates,
   actor_user_id,actor_role,reason,previous_decision_id,request_id,request_payload,audit_log_id)
 values(decision_id,p_observation_id,rev,p_action,p_expected_version,o.observation->>'sourceHash',p_dates,
   p_actor_user_id,role_name,trim(p_reason),prev.id,p_request_id,request_data,audit_id);
 return jsonb_build_object('id',decision_id,'revision',rev,'replayed',false);
end $fn$;
revoke all on function public.admin_apply_sec_listing_date_review(uuid,uuid,text,jsonb,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_apply_sec_listing_date_review(uuid,uuid,text,jsonb,text,text,integer,text) to service_role;
notify pgrst,'reload schema';
