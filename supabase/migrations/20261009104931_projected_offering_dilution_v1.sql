begin;
create table public.projected_offering_dilution_facts (
 id uuid primary key, raw_item_id uuid not null references public.raw_items(id),
 contract_version text not null default 'projected_offering_dilution_v1' check(contract_version='projected_offering_dilution_v1'),
 source_guard jsonb not null, fact jsonb not null, created_at timestamptz not null default now()
);
alter table public.projected_offering_dilution_facts enable row level security;
revoke all on public.projected_offering_dilution_facts from public,anon,authenticated;
grant select,insert on public.projected_offering_dilution_facts to service_role;

create function public.read_projected_offering_inputs(p_raw_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.raw_items; a public.ai_runs; o jsonb; p jsonb; v jsonb; d jsonb; g jsonb;
begin
 select * into r from public.raw_items where id=p_raw_id;
 if r.id is null or r.source_code<>'sec_edgar' or r.raw_payload->>'form_type' not in ('F-1','F-1/A') then return '{}'::jsonb; end if;
 for a in select distinct on (prompt_key) * from public.ai_runs where raw_item_id=p_raw_id
   and prompt_key in ('sec_os_snapshot','sec_offering_plan') order by prompt_key,metadata->>'reservedAt' desc,id desc loop
   select payload->'validated' into v from public.ai_outputs where ai_run_id=a.id and output_type=a.prompt_key;
   d:=null;
   if a.prompt_key='sec_os_snapshot' then
     select jsonb_build_object('id',id,'action',action,'candidate_indexes',candidate_indexes) into d
       from public.sec_os_snapshot_decisions where run_id=a.id order by created_at desc,id desc limit 1;
     o:=jsonb_build_object('id',a.id,'value',v,'decision',d,'fingerprint',a.metadata->'binding'->>'sourceFingerprint','status',a.metadata->>'osStatus');
   else
     select jsonb_build_object('id',id,'action',action,'candidate_indexes',candidate_indexes) into d
       from public.sec_offering_plan_decisions where run_id=a.id order by created_at desc,id desc limit 1;
     p:=jsonb_build_object('id',a.id,'value',v,'decision',d,'fingerprint',a.metadata->'binding'->>'sourceFingerprint','status',a.metadata->>'offeringStatus');
   end if;
 end loop;
 g:=jsonb_build_object('raw_hash',encode(extensions.digest(jsonb_build_array(r.raw_payload,r.source_code,r.source_unique_id,r.source_url)::text,'sha256'),'hex'),
   'os',o-'value','offering',p-'value');
 return jsonb_build_object('raw',to_jsonb(r),'os',o,'offering',p,'guard',g);
end $$;

create function public.save_projected_offering_fact(p_id uuid,p_raw_id uuid,p_guard jsonb,p_fact jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i jsonb; part jsonb; existing public.projected_offering_dilution_facts;
begin
 perform 1 from public.raw_items where id=p_raw_id for share;
 perform 1 from public.ai_runs where raw_item_id=p_raw_id and prompt_key in ('sec_os_snapshot','sec_offering_plan') order by id for share;
 i:=public.read_projected_offering_inputs(p_raw_id);
 if i->'guard' is distinct from p_guard then raise exception 'projected_source_changed'; end if;
 foreach part in array array[i->'os',i->'offering'] loop
   if coalesce(part->>'status','') not in ('PASS','REVIEW_REQUIRED') or part->'value'->>'status' is distinct from part->>'status'
     or part->'decision'->>'action' in ('hold','reject')
     or (part->>'status'='REVIEW_REQUIRED' and part->'decision'->>'action' is distinct from 'approve')
     or coalesce(jsonb_typeof(part->'value'),'null')<>'object' then raise exception 'projected_input_not_public'; end if;
 end loop;
 if p_fact->>'version' is distinct from 'projected_offering_dilution_v1'
   or p_fact->>'accession' is distinct from i->'raw'->>'source_unique_id'
   or p_fact->>'os_run_id' is distinct from i->'os'->>'id'
   or p_fact->>'offering_run_id' is distinct from i->'offering'->>'id' then raise exception 'projected_identity_conflict'; end if;
 insert into public.projected_offering_dilution_facts(id,raw_item_id,source_guard,fact) values(p_id,p_raw_id,p_guard,p_fact) on conflict(id) do nothing;
 select * into existing from public.projected_offering_dilution_facts where id=p_id;
 if existing.fact<>p_fact or existing.source_guard<>p_guard or existing.raw_item_id<>p_raw_id then raise exception 'projected_immutable_conflict'; end if;
 return jsonb_build_object('status','saved','id',p_id);
end $$;

create function public.projected_fact_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'projected_fact_immutable'; end $$;
create trigger projected_fact_immutable before update or delete on public.projected_offering_dilution_facts for each row execute function public.projected_fact_immutable();

-- A dedicated identity column preserves existing Monitor event-dedupe contracts for all other families.
-- Uses the SAME monitors, matcher, internal outbox, owner RLS and Alert UI.
alter table public.user_alert_deliveries add column projected_monitor_id uuid references public.listing_monitors(id) on delete set null,
 add column projected_fact_id uuid references public.projected_offering_dilution_facts(id),
 add column projected_alert_key text unique, add column projected_scenario text,
 add constraint projected_internal_alert_shape check(projected_fact_id is null or (
   projected_alert_key is not null and projected_scenario is not null and projected_scenario in ('base','full_overallotment','combined')
   and alert_domain='listing' and alert_lane='listing_monitor' and delivery_status='queued'
   and delivered_channels=array[]::text[] and scheduled_for is null and sent_at is null and attempted_at is null
 ));
create function public.create_projected_offering_alert(p_monitor_id uuid,p_event_id uuid,p_fact_id uuid,p_conditions jsonb,p_scenario text)
returns table(alert_id uuid,created_new boolean) language plpgsql security invoker set search_path='' as $$
declare m public.listing_monitors; f public.projected_offering_dilution_facts; e public.events; i jsonb; k text; aid uuid;
begin
 select * into m from public.listing_monitors where id=p_monitor_id for update;
 select * into f from public.projected_offering_dilution_facts where id=p_fact_id;
 select * into e from public.events where id=p_event_id;
 if m.id is null or not m.is_active or m.conditions is distinct from p_conditions or f.id is null
   or e.raw_item_id is distinct from f.raw_item_id or e.source_code is distinct from 'sec_edgar'
   or p_scenario is null or p_scenario not in ('base','full_overallotment','combined') then raise exception 'projected_alert_identity_conflict'; end if;
 perform 1 from public.raw_items where id=f.raw_item_id for share;
 perform 1 from public.ai_runs where raw_item_id=f.raw_item_id and prompt_key in ('sec_os_snapshot','sec_offering_plan') order by id for share;
 i:=public.read_projected_offering_inputs(f.raw_item_id);
 if i->'guard' is distinct from f.source_guard then raise exception 'projected_alert_source_changed'; end if;
 k:=concat_ws(':',m.id,f.fact->>'accession',f.fact->>'os_run_id',f.fact->>'offering_run_id',f.contract_version,p_scenario,
   encode(extensions.digest(m.conditions::text,'sha256'),'hex'));
 insert into public.user_alert_deliveries(user_id,alert_event_id,title,category,source_type,source_label,alert_lane,
   delivered_channels,delivery_status,delivered_at,alert_domain,listing_source_execution_id,
   projected_monitor_id,projected_fact_id,projected_alert_key,projected_scenario)
 values(m.user_id,e.id,'예상 O/S 증가·희석 — 공모 계획 기준','listing_risk','other','공모 계획 기준 예상 희석 Monitor','listing_monitor',
   array[]::text[],'queued',now(),'listing',f.id,m.id,f.id,k,p_scenario)
 on conflict(projected_alert_key) do nothing returning id into aid;
 if aid is not null then return query select aid,true; else return query select a.id,false from public.user_alert_deliveries a where a.projected_alert_key=k; end if;
end $$;
revoke all on function public.read_projected_offering_inputs(uuid),public.save_projected_offering_fact(uuid,uuid,jsonb,jsonb),public.projected_fact_immutable(),public.create_projected_offering_alert(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.read_projected_offering_inputs(uuid),public.save_projected_offering_fact(uuid,uuid,jsonb,jsonb),public.create_projected_offering_alert(uuid,uuid,uuid,jsonb,text) to service_role;
commit;
