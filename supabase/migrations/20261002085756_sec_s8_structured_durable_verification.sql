-- Explicit service-only verification history, separate from automatic execution identities.
-- No data rewrite; preserve the existing source checks, unique indexes and privileges.
create or replace function public.reserve_sec_s8_structured(p_id uuid, p_binding jsonb)
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
    or (coalesce(p_binding->>'attempt','') <> 'automatic'
      and coalesce(p_binding->>'attempt','') !~ '^verification:[a-z0-9][a-z0-9_-]{0,79}$')
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

notify pgrst, 'reload schema';
