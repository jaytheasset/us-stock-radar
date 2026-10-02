-- Independent raw-bound S-8 semantic executions; existing direct registration history is untouched.
-- Reuse service-only ai_runs/ai_outputs. No event or Primary parent is required.
create unique index sec_s8_structured_execution_once on public.ai_runs
  (raw_item_id, prompt_version, (metadata->'binding'->>'sourceFingerprint'), (metadata->'binding'->>'attempt'))
  where prompt_key = 'sec_s8_structured';
create unique index sec_s8_structured_output_once on public.ai_outputs(ai_run_id)
  where output_type = 'sec_s8_structured';

create function public.reserve_sec_s8_structured(p_id uuid, p_binding jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.raw_items; d public.sec_s8_registration_filings; a public.ai_runs; added boolean;
begin
  select * into strict r from public.raw_items where id = (p_binding->>'rawItemId')::uuid for share;
  select * into strict d from public.sec_s8_registration_filings where raw_item_id = r.id;
  if r.source_code is distinct from 'sec_edgar'
    or r.source_unique_id is distinct from p_binding->>'accession'
    or r.raw_payload->>'accession_number' is distinct from p_binding->>'accession'
    or d.accession_number is distinct from p_binding->>'accession'
    or d.issuer_cik is distinct from p_binding->>'issuerCik'
    or pg_catalog.lpad(r.raw_payload->>'cik',10,'0') is distinct from d.issuer_cik
    or r.raw_payload->>'form_type' is distinct from d.form_type
    or d.form_type is distinct from p_binding->>'formType'
    or d.source_sha256 is distinct from p_binding->>'sourceSha256'
    or d.facts_sha256 is distinct from p_binding->>'directFactsSha256'
    or d.sources is distinct from p_binding->'original'
    or r.raw_payload->'s8_source' is distinct from d.sources
    or nullif(r.raw_payload->>'filing_date','') is distinct from d.facts->>'filingDate'
    or nullif(r.raw_payload->>'accepted_at','') is distinct from d.facts->>'acceptedAt'
    or p_binding->>'acceptedAt' is distinct from d.facts->>'acceptedAt'
    or p_binding->>'attempt' is distinct from 'automatic'
    or p_binding->>'model' is distinct from 'gemini-3.5-flash'
    or coalesce(p_binding->>'contractVersion','') !~ '^s8_structured_v[0-9]+$'
    or coalesce(p_binding->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
    or p_binding->'source'->>'fingerprint' is distinct from p_binding->>'sourceFingerprint'
    or p_binding->'source'->>'sourceSha256' is distinct from d.source_sha256
    or p_binding->'source'->>'directFactsSha256' is distinct from d.facts_sha256
    or p_binding->'source'->'identity'->>'accession' is distinct from d.accession_number
    or p_binding->'source'->'identity'->>'issuerCik' is distinct from d.issuer_cik
    or p_binding->'source'->'identity'->>'form' is distinct from d.form_type
  then raise exception 's8_execution_source_binding_mismatch'; end if;
  insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
    values(p_id,r.id,'sec_s8_structured',p_binding->>'contractVersion',p_binding->>'model','pending',
      jsonb_build_object('binding',p_binding,'reservedAt',now())) on conflict do nothing;
  added := found;
  select * into strict a from public.ai_runs where id=p_id;
  if a.prompt_key is distinct from 'sec_s8_structured' or a.metadata->'binding' is distinct from p_binding
    or a.raw_item_id is distinct from r.id or a.prompt_version is distinct from p_binding->>'contractVersion'
    or a.model is distinct from p_binding->>'model' then raise exception 's8_execution_identity_conflict'; end if;
  return jsonb_build_object('inserted',added,'id',a.id,'status',a.status);
end $$;

create function public.link_sec_s8_structured_workflow(p_id uuid,p_workflow_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ai_runs;
begin
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_s8_structured' for update;
  if nullif(p_workflow_id,'') is null or (a.metadata->>'workflowRunId' is not null and a.metadata->>'workflowRunId' <> p_workflow_id)
    then raise exception 's8_workflow_identity_conflict'; end if;
  update public.ai_runs set metadata=metadata || jsonb_build_object('workflowRunId',p_workflow_id) where id=p_id;
  return jsonb_build_object('linked',true);
end $$;

create function public.claim_sec_s8_structured(p_id uuid,p_raw_item_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ai_runs;
begin
  update public.ai_runs set status='running',started_at=now()
    where id=p_id and raw_item_id=p_raw_item_id and prompt_key='sec_s8_structured' and status='pending' returning * into a;
  return jsonb_build_object('claimed',found,'binding',a.metadata->'binding');
end $$;

create function public.finish_sec_s8_structured(p_id uuid,p_status text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ai_runs; old_output public.ai_outputs; r public.raw_items; final_status text := p_status;
begin
  select * into strict a from public.ai_runs where id=p_id and prompt_key='sec_s8_structured' for update;
  if p_status not in ('succeeded','failed','stale') or p_status is null
    or p_payload->'binding' is distinct from a.metadata->'binding'
    or jsonb_typeof(p_payload->'outputText') is distinct from 'string'
    or p_payload->>'outputSha256' is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload->>'outputText','UTF8')),'hex')
    then raise exception 's8_result_binding_mismatch'; end if;
  select * into old_output from public.ai_outputs where ai_run_id=p_id and output_type='sec_s8_structured';
  if found then
    if old_output.payload is distinct from p_payload then raise exception 's8_immutable_output_conflict'; end if;
    return jsonb_build_object('status',a.status,'replayed',true);
  end if;
  if a.status <> 'running' then raise exception 's8_execution_not_running'; end if;
  select * into strict r from public.raw_items where id=a.raw_item_id for share;
  if p_status='succeeded' and (
    r.source_code is distinct from 'sec_edgar'
    or r.source_unique_id is distinct from a.metadata->'binding'->>'accession'
    or r.raw_payload->>'accession_number' is distinct from a.metadata->'binding'->>'accession'
    or pg_catalog.lpad(r.raw_payload->>'cik',10,'0') is distinct from a.metadata->'binding'->>'issuerCik'
    or r.raw_payload->>'form_type' is distinct from a.metadata->'binding'->>'formType'
    or r.raw_payload->'s8_source' is distinct from a.metadata->'binding'->'original'
    or nullif(r.raw_payload->>'filing_date','') is distinct from a.metadata->'binding'->'source'->'identity'->>'filingDate'
    or nullif(r.raw_payload->>'accepted_at','') is distinct from a.metadata->'binding'->>'acceptedAt'
  ) then final_status := 'stale'; end if;
  insert into public.ai_outputs(ai_run_id,output_type,payload) values(p_id,'sec_s8_structured',p_payload);
  update public.ai_runs set status=final_status,finished_at=now(),
    usage=coalesce(nullif(p_payload->'provider'->'usage','null'::jsonb),'{}'::jsonb),
    error_message=p_payload->>'error' where id=p_id;
  return jsonb_build_object('status',final_status,'replayed',false);
end $$;

-- Restrict immutability protection to this feature; unrelated AI executions retain existing behavior.
create function public.guard_sec_s8_structured_history() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name='ai_outputs' then
    if old.output_type='sec_s8_structured' or (tg_op='UPDATE' and new.output_type='sec_s8_structured') then
      raise exception 's8_output_history_immutable'; end if;
  else
    if old.prompt_key='sec_s8_structured' or (tg_op='UPDATE' and new.prompt_key='sec_s8_structured') then
      if tg_op='DELETE' then raise exception 's8_run_history_immutable'; end if;
      if new.id is distinct from old.id or new.raw_item_id is distinct from old.raw_item_id
        or new.event_id is distinct from old.event_id or new.prompt_key is distinct from old.prompt_key
        or new.prompt_version is distinct from old.prompt_version or new.model is distinct from old.model
        or new.metadata->'binding' is distinct from old.metadata->'binding'
        or new.metadata->'reservedAt' is distinct from old.metadata->'reservedAt'
        or (old.status in ('succeeded','failed','stale') and (new.status is distinct from old.status
          or new.started_at is distinct from old.started_at or new.finished_at is distinct from old.finished_at
          or new.usage is distinct from old.usage or new.error_message is distinct from old.error_message))
        then raise exception 's8_run_history_immutable'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger sec_s8_structured_run_guard before update or delete on public.ai_runs
  for each row execute function public.guard_sec_s8_structured_history();
create trigger sec_s8_structured_output_guard before update or delete on public.ai_outputs
  for each row execute function public.guard_sec_s8_structured_history();

revoke all on function public.reserve_sec_s8_structured(uuid,jsonb), public.claim_sec_s8_structured(uuid,uuid),
 public.link_sec_s8_structured_workflow(uuid,text), public.finish_sec_s8_structured(uuid,text,jsonb),
 public.guard_sec_s8_structured_history() from public, anon, authenticated;
grant execute on function public.reserve_sec_s8_structured(uuid,jsonb), public.claim_sec_s8_structured(uuid,uuid),
 public.link_sec_s8_structured_workflow(uuid,text), public.finish_sec_s8_structured(uuid,text,jsonb) to service_role;
notify pgrst, 'reload schema';
