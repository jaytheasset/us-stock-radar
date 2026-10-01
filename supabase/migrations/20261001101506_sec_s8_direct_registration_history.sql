-- Filing-time S-8 registration evidence. Not issuance, outstanding shares or Monitor facts.
create table public.sec_s8_registration_filings (
  accession_number text primary key check (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  raw_item_id uuid not null unique references public.raw_items(id) on delete restrict,
  issuer_cik text not null check (issuer_cik ~ '^[0-9]{10}$' and issuer_cik <> '0000000000'),
  form_type text not null check (form_type in ('S-8', 'S-8/A', 'S-8 POS')),
  sources jsonb not null check (jsonb_typeof(sources) = 'object'),
  facts jsonb not null check (jsonb_typeof(facts) = 'object' and facts->>'version' = 'sec_s8_direct_v1'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  facts_sha256 text not null check (facts_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index sec_s8_registration_issuer_idx on public.sec_s8_registration_filings(issuer_cik, accession_number);
alter table public.sec_s8_registration_filings enable row level security;
revoke all on public.sec_s8_registration_filings from public, anon, authenticated, service_role;
grant select, insert on public.sec_s8_registration_filings to service_role;

create function public.persist_sec_s8_registration(
  p_raw_item_id uuid, p_facts jsonb, p_sources jsonb, p_source_sha256 text, p_facts_sha256 text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.raw_items;
  saved public.sec_s8_registration_filings;
  was_inserted boolean;
begin
  select * into strict r from public.raw_items where id = p_raw_item_id for share;
  if r.source_code is distinct from 'sec_edgar'
    or r.source_unique_id is distinct from p_facts->>'accessionNumber'
    or r.raw_payload->>'accession_number' is distinct from r.source_unique_id
    or r.raw_payload->>'form_type' is distinct from p_facts->>'formType'
    or r.raw_payload->>'form_type' not in ('S-8', 'S-8/A', 'S-8 POS')
    or r.raw_payload->>'cik' !~ '^[0-9]{1,10}$'
    or pg_catalog.lpad(r.raw_payload->>'cik', 10, '0') is distinct from p_facts->>'issuerCik'
    or r.raw_payload->'s8_source' is distinct from p_sources
    or nullif(r.raw_payload->>'filing_date', '') is distinct from p_facts->>'filingDate'
    or nullif(r.raw_payload->>'accepted_at', '') is distinct from p_facts->>'acceptedAt'
    or p_facts->>'version' is distinct from 'sec_s8_direct_v1'
    or p_sources->>'version' is distinct from 'sec_s8_original_v1'
    or jsonb_typeof(p_facts->'registrationRows') is distinct from 'array'
    or jsonb_typeof(p_facts->'plans') is distinct from 'array'
  then raise exception 's8_stored_source_contract_mismatch'; end if;

  insert into public.sec_s8_registration_filings(accession_number, raw_item_id, issuer_cik, form_type,
    sources, facts, source_sha256, facts_sha256)
  values(r.source_unique_id, p_raw_item_id, p_facts->>'issuerCik', p_facts->>'formType',
    p_sources, p_facts, p_source_sha256, p_facts_sha256)
  on conflict do nothing;
  was_inserted := found;
  select * into strict saved from public.sec_s8_registration_filings where accession_number = r.source_unique_id;
  if saved.raw_item_id is distinct from p_raw_item_id or saved.sources is distinct from p_sources
    or saved.facts is distinct from p_facts or saved.source_sha256 is distinct from p_source_sha256
    or saved.facts_sha256 is distinct from p_facts_sha256
  then raise exception 's8_immutable_registration_conflict'; end if;
  return jsonb_build_object('status', case when was_inserted then 'inserted' else 'replayed' end);
end;
$$;
revoke all on function public.persist_sec_s8_registration(uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.persist_sec_s8_registration(uuid,jsonb,jsonb,text,text) to service_role;
notify pgrst, 'reload schema';
