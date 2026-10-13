-- One new automatic source in the existing history. Existing source contracts,
-- observations, approvals, conflict rules and immutable triggers remain intact.
begin;

create function public.read_os_snapshot_publication_context(p_run_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a public.ai_runs; p public.ai_runs; r public.raw_items; l public.sec_filing_ledger; latest uuid; d jsonb;
begin
 select * into a from public.ai_runs where id=p_run_id;
 if a.prompt_key='sec_combined_offering' then
  p:=a;select * into a from public.ai_runs where id=(p.metadata->'binding'->>'osRunId')::uuid;
 elsif a.metadata->>'executionKind'='derived_domain_view' then
  select * into p from public.ai_runs where id=(a.metadata->>'combinedInvocationId')::uuid;
 end if;
 if a.id is null or a.prompt_key<>'sec_os_snapshot' then return '{}'::jsonb;end if;
 select * into r from public.raw_items where id=a.raw_item_id;
 select * into l from public.sec_filing_ledger where accession_number=r.source_unique_id;
 select id into latest from public.ai_runs where raw_item_id=r.id
  and (prompt_key='sec_combined_offering' or (prompt_key='sec_os_snapshot' and coalesce(metadata->>'executionKind','')<>'derived_domain_view'))
  order by metadata->>'reservedAt' desc nulls last,id desc limit 1;
 select to_jsonb(x) into d from public.sec_os_snapshot_decisions x where run_id=a.id order by created_at desc,id desc limit 1;
 return jsonb_build_object('run',to_jsonb(a),'parent',case when p.id is null then null else to_jsonb(p) end,
  'raw',to_jsonb(r),'rawHash',encode(sha256(convert_to(r.raw_payload::text,'UTF8')),'hex'),
  'output',(select payload from public.ai_outputs where ai_run_id=a.id and output_type='sec_os_snapshot'),
  'parentOutput',(select payload from public.ai_outputs where ai_run_id=p.id and output_type='sec_combined_offering'),
  'decision',d,'latestRootId',latest,'ledger',case when l.accession_number is null then null else to_jsonb(l) end,
  'ledgerHash',encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex'),
  'universes',coalesce((select jsonb_agg(to_jsonb(u)||jsonb_build_object('publication_hash',encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex')))
   from (select * from public.issuer_common_class_universe_snapshots where issuer_cik=l.issuer_cik order by universe_as_of desc,accepted_at desc limit 1001) u),'[]'::jsonb));
end $$;

create function public.valid_os_snapshot_history_shape(h jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(
  h->>'source_type'='sec_os_snapshot_verified' and h->>'observation_type'='source_stated'
  and h->>'security_class_basis'='SOURCE_STATED_SECURITY_CLASS' and h->>'share_basis_identity'='shares_outstanding:source_stated'
  and h->>'canonical_security_class_kind'='common_stock' and h->>'canonical_security_class_status'='mapped'
  and h->>'canonical_security_class_id'='sc:v1:'||(h->>'issuer_cik')||':common_stock:single'
  and h->>'accepted_at_source'='sec_filing_ledger' and h->>'accepted_at' is not null and h->>'filing_ledger_raw_source_id' is not null
  and h#>>'{accepted_at_provenance,source}'='sec_filing_ledger.accepted_at'
  and h->>'authoritative_status' is null and h->>'authoritative_decision_version' is null
  and h->>'authoritative_decision_reason' is null and h->>'authoritative_decision_lineage' is null
  and h->>'source_concept_namespace_uri' is null and h->>'source_concept_local_name' is null and h->>'source_analyzer' is null
  and h->'source_dimensions'='[]'::jsonb and length(h->>'source_evidence') between 1 and 600
  and h#>>'{share_basis_metadata,measurement}'='shares_outstanding' and h#>>'{share_basis_metadata,unit,kind}'='shares'
  and h#>>'{share_basis_metadata,unit,representation}'='positive_integer'
  and h#>>'{security_class_identity,identity,title}' in ('Common Stock','Common stock','common stock')
  and h#>>'{security_class_identity,canonicalKey}'='SOURCE_STATED_SECURITY_CLASS|'||encode(sha256(convert_to(h#>>'{security_class_identity,identity,title}','UTF8')),'hex')
  and h#>>'{security_class_metadata,sourceRef}'=h->>'source_context_ref'
  and h#>>'{security_class_metadata,evidence}'=h->>'source_evidence'
  and h#>>'{source_fact_identity,factKey}'=h->>'source_fact_key'
  and h#>>'{source_fact_identity,accession}'=h->>'accession_number'
  and h#>>'{source_fact_identity,documentName}'=h->>'filing_document'
  and h#>>'{source_context,asOf}'=h->>'as_of' and h#>>'{source_context,issuerCik}'=h->>'issuer_cik'
  and h#>>'{source_provenance,snapshot,version}'='os-snapshot-history-publication-v1'
  and not (h->'source_provenance' ? 'approval')
  and h#>>'{source_provenance,snapshot,rawId}'=h->>'source_artifact_id'
  and h#>>'{source_provenance,snapshot,runId}' ~ '^[0-9a-f-]{36}$'
  and h#>>'{source_provenance,snapshot,rawHash}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,outputHash}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,sourceFingerprint}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,schemaHash}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,universeHash}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,ledgerHash}' ~ '^[0-9a-f]{64}$'
  and h#>>'{source_provenance,snapshot,recordIndex}' ~ '^[0-9]+$'
  and h#>>'{source_provenance,snapshot,record,scope}'='class'
  and h#>>'{source_provenance,snapshot,record,quantity}'=h->>'shares_outstanding'
  and h#>>'{source_provenance,snapshot,record,as_of_date}'=h->>'as_of'
  and h#>>'{source_provenance,snapshot,record,share_class}'=h#>>'{security_class_identity,identity,title}',false);
$$;

-- Keep every old CHECK expression as-is. Only the new source may use the new,
-- stricter shape; universal numeric/identity/FK/unique/immutability rules stay.
do $$ declare c record; begin
 for c in select conname,pg_get_expr(conbin,conrelid) expression from pg_constraint
  where conrelid='public.share_count_history'::regclass and contype='c'
   and pg_get_expr(conbin,conrelid) like '%source_type%'
 loop
  execute format('alter table public.share_count_history drop constraint %I',c.conname);
  execute format('alter table public.share_count_history add constraint %I check ((%s) or (source_type=''sec_os_snapshot_verified'' and public.valid_os_snapshot_history_shape(to_jsonb(share_count_history))))',c.conname,c.expression);
 end loop;
end $$;
alter table public.share_count_history add constraint share_count_history_snapshot_shape
 check(source_type<>'sec_os_snapshot_verified' or public.valid_os_snapshot_history_shape(to_jsonb(share_count_history)));

create function public.os_snapshot_history_is_current(h public.share_count_history) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb; p jsonb; a jsonb; cp jsonb; d jsonb; v jsonb; u jsonb; q jsonb; l jsonb;
begin
 if h.source_type<>'sec_os_snapshot_verified' then return true;end if;
 if not public.valid_os_snapshot_history_shape(to_jsonb(h)) then return false;end if;
 p:=h.source_provenance->'snapshot';c:=public.read_os_snapshot_publication_context((p->>'runId')::uuid);
 a:=c->'run';cp:=a#>'{metadata,osCheckpoint}';d:=c->'decision';l:=c->'ledger';
 if a->>'status' is distinct from 'succeeded' or a->>'raw_item_id' is distinct from p->>'rawId'
  or c->>'rawHash' is distinct from p->>'rawHash' or c->>'ledgerHash' is distinct from p->>'ledgerHash'
  or c->>'latestRootId' is distinct from coalesce(c#>>'{parent,id}',a->>'id')
  or c#>>'{parent,id}' is distinct from p->>'parentId' or c->'output' is distinct from cp
  or cp->>'rawHash' is distinct from p->>'outputHash'
  or a#>>'{metadata,binding,sourceFingerprint}' is distinct from p->>'sourceFingerprint'
  or a#>>'{metadata,binding,schemaHash}' is distinct from p->>'schemaHash'
  or a#>>'{metadata,binding,contractVersion}' is distinct from p->>'contractVersion'
  or d->>'id' is distinct from p->>'decisionId' or coalesce(d->>'action','') in ('hold','reject') then return false;end if;
 if c#>>'{parent,id}' is not null then
  q:=c#>'{parent,metadata,combinedCheckpoint}';
  if c#>>'{parent,metadata,combinedStatus}' is distinct from 'COMPLETE' or c->'parentOutput' is distinct from q
   or c#>>'{parent,metadata,binding,osRunId}' is distinct from a->>'id'
   or q#>>'{validation,os_snapshot,ok}' is distinct from 'true'
   or encode(sha256(convert_to(q->>'raw','UTF8')),'hex') is distinct from p->>'outputHash' then return false;end if;
 else
  if cp#>>'{validation,ok}' is distinct from 'true'
   or encode(sha256(convert_to(cp->>'raw','UTF8')),'hex') is distinct from p->>'outputHash' then return false;end if;
 end if;
 if cp->>'status'='PASS' then v:=cp#>'{validated,current_os}'->(p->>'recordIndex')::integer;
 elsif cp->>'status'='REVIEW_REQUIRED' and d->>'action'='approve'
  and (d->'candidate_indexes') @> jsonb_build_array((p->>'recordIndex')::integer)
 then v:=cp#>'{validated,review,candidates}'->(p->>'recordIndex')::integer;
 else return false;end if;
 if v is distinct from p->'record' or cp#>>'{validated,filing,cik}' is distinct from h.issuer_cik
  or cp#>>'{validated,filing,accession}' is distinct from h.accession_number
  or l->>'issuer_cik' is distinct from h.issuer_cik or l->>'form' is distinct from h.form
  or l->>'filed_date' is distinct from h.filed_date::text or l->>'primary_document' is distinct from h.filing_document
  or (l->>'accepted_at')::timestamptz is distinct from h.accepted_at
  or l->>'source_raw_id' is distinct from h.filing_ledger_raw_source_id::text then return false;end if;
 select x into u from jsonb_array_elements(c->'universes') x where x->>'id'=p->>'universeId';
 if u->>'publication_hash' is distinct from p->>'universeHash' or u->>'status' is distinct from 'COMPLETE_SINGLE'
  or u->>'reason' is distinct from 'COMPLETE_SINGLE_COMMON_STOCK' or u->>'universe_as_of'>h.as_of::text
  or u->'required_canonical_security_class_ids' is distinct from jsonb_build_array(h.canonical_security_class_id)
  or u#>>'{class_evidence,0,canonicalSecurityClassId}' is distinct from h.canonical_security_class_id then return false;end if;
 -- New contradictory class evidence must not leave an old publication current.
 if exists(select 1 from jsonb_array_elements(c->'universes') x
  where (x->>'accepted_at')::timestamptz<=h.accepted_at and x->>'universe_as_of'<=left(h.accepted_at::text,10)
   and (x->>'universe_as_of'>u->>'universe_as_of' or
    (x->>'universe_as_of'=u->>'universe_as_of' and
     ((x->>'accepted_at')::timestamptz>(u->>'accepted_at')::timestamptz or
      ((x->>'accepted_at')::timestamptz=(u->>'accepted_at')::timestamptz and
       (x->>'status'<>'COMPLETE_SINGLE' or x->'required_canonical_security_class_ids'<>u->'required_canonical_security_class_ids')))))) then return false;end if;
 if exists(select 1 from public.share_count_history s where s.issuer_cik=h.issuer_cik
  and s.source_type<>'sec_os_snapshot_verified' and s.canonical_security_class_status='mapped'
  and s.canonical_security_class_id<>h.canonical_security_class_id and s.as_of<=h.accepted_at::date
  and s.accepted_at>(u->>'accepted_at')::timestamptz and s.accepted_at<=h.accepted_at) then return false;end if;
 return true;
exception when others then return false;
end $$;

create view public.share_count_history_eligible with(security_invoker=true) as
 select h.*,true as snapshot_publication_valid from public.share_count_history h
 where public.os_snapshot_history_is_current(h);
revoke all on public.share_count_history_eligible from public,anon,authenticated;
grant select on public.share_count_history_eligible to service_role;

create function public.publish_os_snapshot_share_history(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare j jsonb; h public.share_count_history; n integer:=0; total integer;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_snapshot_publication_batch';end if;
 total:=jsonb_array_length(p_rows);
 for j in select value from jsonb_array_elements(p_rows) loop
  h:=jsonb_populate_record(null::public.share_count_history,j||jsonb_build_object('created_at',clock_timestamp()));
  if h.source_type is distinct from 'sec_os_snapshot_verified' then raise exception 'invalid_snapshot_publication_source';end if;
  perform 1 from public.raw_items where id=h.source_artifact_id for update;
  perform 1 from public.ai_runs where id in ((h.source_provenance#>>'{snapshot,runId}')::uuid,(h.source_provenance#>>'{snapshot,parentId}')::uuid) order by id for share;
  if not public.os_snapshot_history_is_current(h) then raise exception 'snapshot_publication_source_changed_or_invalid';end if;
  insert into public.share_count_history (observation_type,issuer_cik,shares_outstanding,as_of,security_class_basis,security_class_identity,security_class_metadata,share_basis_identity,canonical_security_class_id,canonical_security_class_kind,canonical_security_class_status,canonical_security_class_provenance,share_basis_metadata,accession_number,form,filing_document,filed_date,accepted_at,accepted_at_source,accepted_at_provenance,ingested_at,source_concept_namespace_uri,source_concept_local_name,source_fact_key,source_context_ref,source_artifact_id,filing_ledger_raw_source_id,source_fact_identity,source_context,source_dimensions,source_provenance,source_type,authoritative_status,authoritative_decision_version,authoritative_decision_reason,authoritative_decision_lineage,source_document_url,source_content_hash,source_evidence,source_analyzer)
   select h.observation_type,h.issuer_cik,h.shares_outstanding,h.as_of,h.security_class_basis,h.security_class_identity,h.security_class_metadata,h.share_basis_identity,h.canonical_security_class_id,h.canonical_security_class_kind,h.canonical_security_class_status,h.canonical_security_class_provenance,h.share_basis_metadata,h.accession_number,h.form,h.filing_document,h.filed_date,h.accepted_at,h.accepted_at_source,h.accepted_at_provenance,h.ingested_at,h.source_concept_namespace_uri,h.source_concept_local_name,h.source_fact_key,h.source_context_ref,h.source_artifact_id,h.filing_ledger_raw_source_id,h.source_fact_identity,h.source_context,h.source_dimensions,h.source_provenance,h.source_type,h.authoritative_status,h.authoritative_decision_version,h.authoritative_decision_reason,h.authoritative_decision_lineage,h.source_document_url,h.source_content_hash,h.source_evidence,h.source_analyzer
   on conflict on constraint share_count_history_canonical_source_unique do nothing;
  if found then n:=n+1;end if;
 end loop;
 return jsonb_build_object('inserted',n,'deduped',total-n);
end $$;

revoke all on function public.read_os_snapshot_publication_context(uuid),public.valid_os_snapshot_history_shape(jsonb),public.os_snapshot_history_is_current(public.share_count_history),public.publish_os_snapshot_share_history(jsonb) from public,anon,authenticated;
grant execute on function public.read_os_snapshot_publication_context(uuid),public.valid_os_snapshot_history_shape(jsonb),public.os_snapshot_history_is_current(public.share_count_history),public.publish_os_snapshot_share_history(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
