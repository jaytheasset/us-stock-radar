-- Compact reservations only for new runs. Historical bindings/outputs are never rewritten.
create or replace function public.reserve_sec_offering_plan(p_binding jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare a public.ai_runs; r record; p record; f jsonb; d jsonb; family jsonb; fn text; rn text; added boolean; k text;
begin
  select * into a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if found then
    if a.prompt_key is distinct from 'sec_offering_plan' or a.raw_item_id is distinct from (p_binding->>'rawItemId')::uuid
      or a.metadata->'binding'->>'key' is distinct from p_binding->>'key' then raise exception 'offering_identity_conflict'; end if;
    -- Both old full and new compact requests can replay a historic run without changing it.
    return jsonb_build_object('id',a.id,'inserted',false,'status',a.metadata->>'offeringStatus');
  end if;
  if jsonb_typeof(p_binding) is distinct from 'object' or p_binding->>'bindingVersion' is distinct from '2'
    or (p_binding - array['id','key','rawItemId','bindingVersion','filing','ticker','documents','documentCount','blockCount','sourceFingerprint','contractVersion','schemaHash','promptHash','providerProfile','family']) <> '{}'::jsonb
    or octet_length(p_binding::text)>16384
    or jsonb_typeof(p_binding->'filing') is distinct from 'object'
    or jsonb_typeof(p_binding->'documents') is distinct from 'array'
    then raise exception 'offering_compact_binding_required'; end if;
  k:=p_binding->>'key';f:=p_binding->'filing';d:=p_binding->'documents'->0;
  if coalesce(k,'') !~ '^[0-9a-f]{64}$'
    or p_binding->>'id' is distinct from substr(k,1,8)||'-'||substr(k,9,4)||'-5'||substr(k,14,3)||'-a'||substr(k,18,3)||'-'||substr(k,21,12)
    or coalesce(p_binding->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_binding->>'schemaHash','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_binding->>'promptHash','') !~ '^[0-9a-f]{64}$'
    or nullif(p_binding->>'contractVersion','') is null or nullif(p_binding->>'providerProfile','') is null
    or p_binding->>'documentCount' is distinct from '1' or jsonb_array_length(p_binding->'documents')<>1
    or coalesce(p_binding->>'blockCount','') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(d) is distinct from 'object' or (d-array['id','original_sha256','text_sha256'])<>'{}'::jsonb
    or coalesce(d->>'original_sha256','') !~ '^[0-9a-f]{64}$' or coalesce(d->>'text_sha256','') !~ '^[0-9a-f]{64}$'
    or d->>'id' is distinct from (f->>'accession')||':primary:'||substr(d->>'original_sha256',1,16)
    then raise exception 'offering_source_binding_mismatch'; end if;
  select id,source_code,source_unique_id,raw_payload into strict r from public.raw_items where id=(p_binding->>'rawItemId')::uuid for share;
  -- Decode the retained raw payload once; no multi-megabyte RPC value or string equality.
  select * into p from jsonb_to_record(r.raw_payload) as x(accession_number text,company_name text,cik text,form_type text,filing_date text,accepted_at text,file_number text,registration_number text,ticker text,os_snapshot_primary_html text,primary_document_html text,primary_document_html_truncated boolean);
  if r.source_code is distinct from 'sec_edgar' or p.form_type is null or p.form_type not in ('F-1','F-1/A')
    or r.source_unique_id is distinct from f->>'accession'
    or f is distinct from jsonb_build_object('accession',p.accession_number,'issuer',p.company_name,'cik',lpad(p.cik,10,'0'),'form',p.form_type,'filing_date',p.filing_date,'accepted_at',nullif(btrim(p.accepted_at),''),'file_number',nullif(btrim(p.file_number),''),'registration_number',nullif(btrim(p.registration_number),''))
    or p_binding->'ticker' is distinct from coalesce(to_jsonb(p.ticker),'null'::jsonb)
    or (nullif(p.os_snapshot_primary_html,'') is null and p.primary_document_html_truncated is distinct from false)
    or encode(sha256(convert_to(coalesce(nullif(p.os_snapshot_primary_html,''),p.primary_document_html),'UTF8')),'hex') is distinct from d->>'original_sha256'
    then raise exception 'offering_source_binding_mismatch'; end if;
  fn:=nullif(btrim(p.file_number),'');rn:=nullif(btrim(p.registration_number),'');
  if fn is not null and rn is not null and fn<>rn then
    family:=jsonb_build_object('status','conflicting','key',null,'number',null);
  elsif coalesce(fn,rn) is null or coalesce(fn,rn) !~ '^[0-9]{3}-[0-9]+$' then
    family:=jsonb_build_object('status','unavailable','key',null,'number',null);
  else
    family:=jsonb_build_object('status','confirmed','key',lpad(p.cik,10,'0')||':'||coalesce(fn,rn),'number',coalesce(fn,rn));
  end if;
  if p_binding->'family' is distinct from family then raise exception 'offering_family_binding_mismatch'; end if;
  insert into public.ai_runs(id,raw_item_id,prompt_key,prompt_version,model,status,metadata)
    values((p_binding->>'id')::uuid,r.id,'sec_offering_plan',p_binding->>'contractVersion',p_binding->>'providerProfile','pending',jsonb_build_object('binding',p_binding,'offeringStatus','QUEUED','attempt',1,'reservedAt',now())) on conflict do nothing;
  added:=found;
  select * into strict a from public.ai_runs where id=(p_binding->>'id')::uuid;
  if a.metadata->'binding' is distinct from p_binding then raise exception 'offering_identity_conflict'; end if;
  return jsonb_build_object('id',a.id,'inserted',added,'status',a.metadata->>'offeringStatus');
end $$;
revoke all on function public.reserve_sec_offering_plan(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_sec_offering_plan(jsonb) to service_role;
notify pgrst,'reload schema';
