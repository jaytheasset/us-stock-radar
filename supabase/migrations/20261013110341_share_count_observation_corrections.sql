begin;

-- Corrections belong to one immutable observation, never to an issuer winner.
create table public.share_count_observation_corrections (
 id uuid primary key default gen_random_uuid(),
 observation_id bigint not null references public.share_count_history(id),
 revision integer not null check(revision > 0),
 action text not null check(action in ('correct','revoke')),
 observation_hash text not null check(observation_hash ~ '^[0-9a-f]{64}$'),
 source_binding_hash text not null check(source_binding_hash ~ '^[0-9a-f]{64}$'),
 quantity numeric,
 as_of date,
 evidence text,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 actor_user_id uuid not null references auth.users(id),
 request_id uuid not null unique,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 unique(observation_id,revision),
 check((action='revoke' and quantity is null and as_of is null and evidence is null)
  or (action='correct' and quantity is not null and quantity>0 and scale(quantity)=0 and as_of is not null and evidence is not null and length(btrim(evidence)) between 1 and 600))
);
alter table public.share_count_observation_corrections enable row level security;
revoke all on public.share_count_observation_corrections from public,anon,authenticated;
grant select,insert on public.share_count_observation_corrections to service_role;
create function public.guard_share_count_correction_immutable() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'os_correction_immutable'; end $$;
create trigger share_count_correction_immutable before update or delete on public.share_count_observation_corrections
 for each row execute function public.guard_share_count_correction_immutable();

-- Captures the exact observation/source/ledger and historical class support.
-- No source collection or mutation occurs while reading this context.
create function public.read_share_count_correction_source(p_observation_id bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare h public.share_count_history; l public.sec_filing_ledger; a public.sec_structured_raw_sources;
 c jsonb; u jsonb; body text; source_state jsonb; ready boolean:=true; why text:=null;
 original_hash text; binding_hash text;
begin
 select * into h from public.share_count_history where id=p_observation_id;
 if h.id is null then return '{}'::jsonb;end if;
 original_hash:=encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex');
 select * into l from public.sec_filing_ledger where accession_number=h.accession_number;
 if h.canonical_security_class_status<>'mapped' or h.canonical_security_class_kind<>'common_stock'
  or h.canonical_security_class_id<>'sc:v1:'||h.issuer_cik||':common_stock:single'
  or h.accepted_at_source<>'sec_filing_ledger'
  or l.issuer_cik is distinct from h.issuer_cik or l.form is distinct from h.form
  or l.filed_date is distinct from h.filed_date or l.accepted_at is distinct from h.accepted_at
  or l.primary_document is distinct from h.filing_document or l.source_raw_id is distinct from h.filing_ledger_raw_source_id
 then ready:=false;why:='Exact common-stock observation and SEC filing identity are required.';end if;
 if h.source_type='sec_os_snapshot_verified' then
  c:=public.read_os_snapshot_publication_context((h.source_provenance#>>'{snapshot,runId}')::uuid);
  body:=coalesce(nullif(c#>>'{raw,raw_payload,combined_offering_primary_html}',''),c#>>'{raw,raw_payload,primary_document_html}');
  source_state:=jsonb_build_object('rawHash',c->'rawHash','run',c->'run','parent',c->'parent','output',c->'output','parentOutput',c->'parentOutput','decision',c->'decision','latestRootId',c->'latestRootId');
  if not public.os_snapshot_history_is_current(h) then ready:=false;why:='The saved observation no longer matches a publishable source result.';end if;
 else
  select * into a from public.sec_structured_raw_sources where id=h.source_artifact_id and source_kind='filing_xbrl';
  body:=a.raw_content;source_state:=to_jsonb(a);
  if a.id is null or a.cik is distinct from h.issuer_cik or a.source_url is distinct from h.source_document_url
   or a.content_hash is distinct from h.source_content_hash
   or a.payload->>'accession' is distinct from h.accession_number or a.payload->>'document_name' is distinct from h.filing_document
   or h.source_type not in ('sec_filing_text_human_verified','sec_authoritative_os','sec_prospectus_text_authoritative_os')
  then ready:=false;why:='The exact retained SEC document is unavailable.';end if;
 end if;
 if body is null or encode(sha256(convert_to(body,'UTF8')),'hex') is distinct from h.source_content_hash
 then ready:=false;why:='The retained source content changed or is unavailable.';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into u from (
  select * from public.issuer_common_class_universe_snapshots where issuer_cik=h.issuer_cik
   and accepted_at<=h.accepted_at and universe_as_of<=h.accepted_at::date
  order by universe_as_of desc,accepted_at desc,id desc limit 1001
 ) x;
 binding_hash:=encode(sha256(convert_to(jsonb_build_object('observation',original_hash,'source',source_state,'ledger',to_jsonb(l),'universes',u)::text,'UTF8')),'hex');
 return jsonb_build_object('observation',to_jsonb(h)||jsonb_build_object('id',h.id::text,'shares_outstanding',h.shares_outstanding::text),'observationHash',original_hash,'sourceBindingHash',binding_hash,
  'available',ready,'unavailableReason',why,'body',body,'ledger',to_jsonb(l),'universes',u);
exception when others then
 return jsonb_build_object('observation',to_jsonb(h),'observationHash',original_hash,'available',false,'unavailableReason','The source binding could not be verified.');
end $$;

create function public.read_share_count_correction_context(p_observation_id bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.read_share_count_correction_source(p_observation_id)||jsonb_build_object(
  'revision',coalesce((select max(revision) from public.share_count_observation_corrections where observation_id=p_observation_id),0),
  'history',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('observation_id',c.observation_id::text,'quantity',c.quantity::text) order by c.revision desc) from public.share_count_observation_corrections c where observation_id=p_observation_id),'[]'::jsonb));
$$;

create function public.list_share_count_correction_observations(p_accession text default null,p_run_id text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (
  select id::text,issuer_cik,accession_number,shares_outstanding::text,as_of,source_type,canonical_security_class_id
  from public.share_count_history where canonical_security_class_kind='common_stock' and canonical_security_class_status='mapped'
   and (p_accession is null or accession_number=p_accession)
   and (p_run_id is null or source_provenance#>>'{snapshot,runId}'=p_run_id)
  order by share_count_history.id desc limit 30
 ) h;
$$;

create function public.current_share_count_correction(p_observation_id bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.share_count_observation_corrections; c jsonb; h jsonb;
begin
 select * into d from public.share_count_observation_corrections where observation_id=p_observation_id order by revision desc limit 1;
 if d.id is null or d.action<>'correct' then return null;end if;
 c:=public.read_share_count_correction_source(p_observation_id);h:=c->'observation';
 if c->>'available' is distinct from 'true' or c->>'observationHash' is distinct from d.observation_hash
  or c->>'sourceBindingHash' is distinct from d.source_binding_hash then return null;end if;
 return jsonb_build_object('id',d.id,'observationId',p_observation_id::text,'revision',d.revision,
  'quantity',d.quantity::text,'asOf',d.as_of,'evidence',d.evidence,'reason',d.reason,'actorUserId',d.actor_user_id,'createdAt',d.created_at,
  'originalQuantity',h->>'shares_outstanding','originalAsOf',h->>'as_of','classId',h->>'canonical_security_class_id',
  'sourceHash',h->>'source_content_hash','sourceBindingHash',d.source_binding_hash);
end $$;

create or replace view public.share_count_history_eligible with(security_invoker=true) as
 select h.*,true as snapshot_publication_valid,c.value as os_correction,
  coalesce((c.value->>'asOf')::date,h.as_of) as effective_as_of
 from public.share_count_history h
 left join lateral (select public.current_share_count_correction(h.id) value) c on true
 where public.os_snapshot_history_is_current(h);

create function public.append_share_count_correction(p_observation_id bigint,p_actor uuid,p_request uuid,p_request_hash text,
 p_expected_revision integer,p_observation_hash text,p_source_binding_hash text,p_action text,p_quantity text,p_as_of date,p_evidence text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare h public.share_count_history; d public.share_count_observation_corrections; c jsonb; current_revision integer;
begin
 if not exists(select 1 from public.admin_role_assignments where user_id=p_actor and active and role in ('operations','super_admin'))
 then raise exception 'os_correction_admin_required';end if;
 -- Serialize requests/target revisions without granting UPDATE on immutable sources.
 perform pg_advisory_xact_lock(hashtextextended('os-correction-request:'||p_request::text,0));
 perform pg_advisory_xact_lock(hashtextextended('os-correction-observation:'||p_observation_id::text,0));
 select * into h from public.share_count_history where id=p_observation_id;
 if h.id is null then raise exception 'os_correction_not_found';end if;
 select * into d from public.share_count_observation_corrections where request_id=p_request;
 if d.id is not null then
  if d.observation_id<>p_observation_id or d.actor_user_id<>p_actor or d.request_hash<>p_request_hash then raise exception 'os_correction_request_conflict';end if;
  return jsonb_build_object('id',d.id,'revision',d.revision,'deduped',true);
 end if;
 select coalesce(max(revision),0) into current_revision from public.share_count_observation_corrections where observation_id=p_observation_id;
 if current_revision<>p_expected_revision then raise exception 'os_correction_revision_conflict';end if;
 if p_action not in ('correct','revoke') or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
 then raise exception 'os_correction_invalid_input';end if;
 c:=public.read_share_count_correction_source(p_observation_id);
 if c->>'observationHash' is distinct from p_observation_hash or c->>'sourceBindingHash' is distinct from p_source_binding_hash
 then raise exception 'os_correction_source_conflict';end if;
 if p_action='correct' then
  if c->>'available' is distinct from 'true' or p_quantity is null or p_quantity !~ '^[1-9][0-9]{0,77}$'
   or p_as_of is null or p_as_of>h.filed_date or p_evidence is null or length(btrim(p_evidence)) not between 1 and 600
  then raise exception 'os_correction_invalid_input';end if;
 else
  select * into d from public.share_count_observation_corrections where observation_id=p_observation_id order by revision desc limit 1;
  if d.id is null or d.action<>'correct' then raise exception 'os_correction_nothing_to_revoke';end if;
  if p_quantity is not null or p_as_of is not null or p_evidence is not null then raise exception 'os_correction_invalid_input';end if;
 end if;
 insert into public.share_count_observation_corrections(observation_id,revision,action,observation_hash,source_binding_hash,quantity,as_of,evidence,reason,actor_user_id,request_id,request_hash)
 values(p_observation_id,current_revision+1,p_action,p_observation_hash,p_source_binding_hash,p_quantity::numeric,p_as_of,p_evidence,btrim(p_reason),p_actor,p_request,p_request_hash)
 returning * into d;
 return jsonb_build_object('id',d.id,'revision',d.revision,'deduped',false);
end $$;

revoke all on function public.read_share_count_correction_source(bigint),public.read_share_count_correction_context(bigint),public.list_share_count_correction_observations(text,text),public.current_share_count_correction(bigint),public.append_share_count_correction(bigint,uuid,uuid,text,integer,text,text,text,text,date,text,text) from public,anon,authenticated;
grant execute on function public.read_share_count_correction_source(bigint),public.read_share_count_correction_context(bigint),public.list_share_count_correction_observations(text,text),public.current_share_count_correction(bigint),public.append_share_count_correction(bigint,uuid,uuid,text,integer,text,text,text,text,date,text,text) to service_role;
notify pgrst,'reload schema';
commit;
