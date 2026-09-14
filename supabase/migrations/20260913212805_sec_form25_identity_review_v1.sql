begin;

create table public.sec_form25_identity_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  sequence bigint generated always as identity unique,
  raw_item_id uuid not null references public.raw_items(id) on delete restrict,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now()
);
create table public.sec_form25_identity_human_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  raw_item_id uuid not null references public.raw_items(id) on delete restrict,
  identity_id uuid not null references public.sec_form25_identity_evidence(id) on delete restrict,
  revision integer not null check(revision>0),
  action text not null check(action in ('approved','held','withdrawn')),
  candidate_index integer,
  actor_user_id uuid not null,
  actor_role text not null check(actor_role in ('super_admin','operations')),
  reason text not null check(length(reason) between 4 and 2000),
  previous_decision_id uuid references public.sec_form25_identity_human_decisions(id) on delete restrict,
  request_id text not null unique check(length(request_id) between 1 and 240),
  request_payload jsonb not null,
  audit_log_id uuid not null references public.admin_audit_logs(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(raw_item_id,revision),
  check((action='approved' and candidate_index>=0) or (action<>'approved' and candidate_index is null))
);
create index sec_form25_identity_latest on public.sec_form25_identity_evidence(raw_item_id,sequence desc);
alter table public.sec_form25_identity_evidence enable row level security;
alter table public.sec_form25_identity_human_decisions enable row level security;
revoke all on public.sec_form25_identity_evidence,public.sec_form25_identity_human_decisions from public,anon,authenticated,service_role;
grant select,insert on public.sec_form25_identity_evidence,public.sec_form25_identity_human_decisions to service_role;
grant usage,select on sequence public.sec_form25_identity_evidence_sequence_seq to service_role;
create trigger sec_form25_identity_evidence_immutable before update or delete on public.sec_form25_identity_evidence
 for each row execute function private.reject_sec_ticker_resolution_human_mutation();
create trigger sec_form25_identity_human_immutable before update or delete on public.sec_form25_identity_human_decisions
 for each row execute function private.reject_sec_ticker_resolution_human_mutation();

create function public.persist_sec_form25_identity(p_raw_item_id uuid,p_evidence jsonb,p_evidence_sha256 text,p_raw_snapshot jsonb)
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
  -- Only this filing's derived identity is synchronized. Source/analysis/history are untouched.
  update public.events set ticker=v_ticker, metadata=coalesce(metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object('form25_ticker_identity',pg_catalog.jsonb_build_object('status','available','state',v_state,'ticker',v_ticker,'exchange',p_evidence->>'exchange','reason','identity_evidence_changed','identityId',v_row.id,'evidenceSha256',p_evidence_sha256)) where raw_item_id=p_raw_item_id;
  delete from public.event_tickers where event_id in(select id from public.events where raw_item_id=p_raw_item_id);
  if v_ticker is not null then
    insert into public.event_tickers(event_id,symbol,exchange,role,sort_order,reason,metadata)
    select id,v_ticker,p_evidence->>'exchange','primary',1,'Verified Form25 subject identity',pg_catalog.jsonb_build_object('form25_identity_id',v_row.id) from public.events where raw_item_id=p_raw_item_id;
  end if;
  return pg_catalog.jsonb_build_object('status','inserted','id',v_row.id);
end $fn$;
revoke all on function public.persist_sec_form25_identity(uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_sec_form25_identity(uuid,jsonb,text,jsonb) to service_role;

create function public.admin_apply_sec_form25_identity_decision(p_raw_item_id uuid,p_actor_user_id uuid,p_action text,p_candidate_index integer,
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
 update public.events set ticker=v_ticker,metadata=coalesce(metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object('form25_ticker_identity',pg_catalog.jsonb_build_object('status','available','state',v_state,'ticker',v_ticker,'exchange',v_exchange,'identityId',v_identity.id,'revision',v_revision,'evidenceSha256',v_identity.evidence_sha256)) where raw_item_id=p_raw_item_id;
 delete from public.event_tickers where event_id in(select id from public.events where raw_item_id=p_raw_item_id);
 if v_ticker is not null then
  insert into public.event_tickers(event_id,symbol,exchange,role,sort_order,reason,metadata)
  select id,v_ticker,v_exchange,'primary',1,'Approved Form25 subject identity',pg_catalog.jsonb_build_object('form25_identity_id',v_identity.id) from public.events where raw_item_id=p_raw_item_id;
 end if;
 return pg_catalog.jsonb_build_object('status','inserted','id',v_id,'revision',v_revision);
end $fn$;
revoke all on function public.admin_apply_sec_form25_identity_decision(uuid,uuid,text,integer,text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_apply_sec_form25_identity_decision(uuid,uuid,text,integer,text,integer,text,text,jsonb) to service_role;

-- A concurrent analysis save cannot undo an administrator's identity hold.
-- Both derived event identity and its ticker-link rows use the same scope lock.
create function private.current_sec_form25_identity(p_raw_item_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare e public.sec_form25_identity_evidence;h public.sec_form25_identity_human_decisions;s text;t text;
begin
 -- Event triggers already hold row locks; never wait on the inverse RPC lock order.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('form25_identity:'||p_raw_item_id::text,0)) then
  return pg_catalog.jsonb_build_object('status','unavailable','state','UNRESOLVED','ticker',null,'reason','identity_decision_in_progress');
 end if;
 select * into e from public.sec_form25_identity_evidence where raw_item_id=p_raw_item_id order by sequence desc limit 1;
 select * into h from public.sec_form25_identity_human_decisions where raw_item_id=p_raw_item_id order by revision desc limit 1;
 s:=coalesce(e.evidence->>'status','UNRESOLVED');
 if h.id is not null and h.action<>'withdrawn' then
  if h.identity_id<>e.id then s:='REVIEW';
  elsif h.action='held' then s:='HELD';
  elsif h.action='approved' then s:='HUMAN_APPROVED';t:=e.evidence->'candidates'->h.candidate_index->>'ticker';
  end if;
 elsif s='AUTO' and pg_catalog.jsonb_array_length(e.evidence->'candidates')=1 then t:=e.evidence->'candidates'->0->>'ticker';
 end if;
 return pg_catalog.jsonb_build_object('status',case when e.id is null then 'unavailable' else 'available' end,'state',s,'ticker',t,'exchange',e.evidence->>'exchange','identityId',e.id,'evidenceSha256',e.evidence_sha256,'revision',coalesce(h.revision,0),'reason',coalesce(e.evidence->>'reason','identity_unavailable'));
end $fn$;
revoke all on function private.current_sec_form25_identity(uuid) from public,anon,authenticated;
grant execute on function private.current_sec_form25_identity(uuid) to service_role;

create function private.guard_sec_form25_event_identity()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare v_form text;v_identity jsonb;v_raw uuid;v_event_ticker text;v_incoming jsonb;
begin
 if TG_TABLE_NAME='events' then v_raw:=new.raw_item_id;
 else select raw_item_id,ticker into v_raw,v_event_ticker from public.events where id=new.event_id;end if;
 select upper(coalesce(raw_payload->>'form_type',metadata->>'form_type','')) into v_form from public.raw_items where id=v_raw;
 if coalesce(v_form,'') !~ '^(FORM )?25(-NSE)?(/A)?$' then return new;end if;
 v_identity:=private.current_sec_form25_identity(v_raw);
 if TG_TABLE_NAME='events' then
  v_incoming:=new.metadata->'form25_ticker_identity';
  -- SQL cannot elevate a consumer that failed fresh source verification.
  if v_identity->>'ticker' is not null and (new.ticker is distinct from v_identity->>'ticker'
    or v_incoming->>'status' is distinct from 'available'
    or v_incoming->>'identityId' is distinct from v_identity->>'identityId'
    or v_incoming->>'evidenceSha256' is distinct from v_identity->>'evidenceSha256') then
    v_identity:=v_identity||pg_catalog.jsonb_build_object('status','unavailable','ticker',null,'reason','incoming_identity_not_verified');
  end if;
  new.ticker:=v_identity->>'ticker';
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object('form25_ticker_identity',v_identity);
  return new;
 end if;
 if v_identity->>'ticker' is null or v_event_ticker is distinct from v_identity->>'ticker' or new.symbol is distinct from v_identity->>'ticker' or new.role<>'primary' then return null;end if;
 new.exchange:=v_identity->>'exchange';
 return new;
end $fn$;
revoke all on function private.guard_sec_form25_event_identity() from public,anon,authenticated;
grant execute on function private.guard_sec_form25_event_identity() to service_role;
create trigger sec_form25_event_identity_guard before insert or update of ticker,metadata,raw_item_id on public.events for each row execute function private.guard_sec_form25_event_identity();
create trigger sec_form25_event_ticker_identity_guard before insert or update on public.event_tickers for each row execute function private.guard_sec_form25_event_identity();
commit;
