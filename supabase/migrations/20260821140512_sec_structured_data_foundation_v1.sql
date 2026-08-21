-- SEC Structured Data Foundation V1.
-- Internal source preservation and generic CompanyFacts normalization only.
-- This migration intentionally defines no public metric resolver or product API.

create table public.sec_structured_raw_sources (
  id uuid primary key,
  source_kind text not null,
  source_url text not null,
  source_identity text not null,
  cik text not null,
  fetched_at timestamptz not null,
  ingested_at timestamptz not null default pg_catalog.now(),
  content_hash text not null,
  source_schema_version text,
  raw_content_kind text not null,
  raw_content text not null,
  payload jsonb not null,
  constraint sec_structured_raw_sources_kind_check
    check (source_kind in ('submissions', 'companyfacts', 'filing_xbrl')),
  constraint sec_structured_raw_sources_cik_check
    check (cik ~ '^[0-9]{10}$' and cik <> '0000000000'),
  constraint sec_structured_raw_sources_url_check
    check (source_url ~ '^https://([a-z0-9-]+\.)*sec\.gov/'),
  constraint sec_structured_raw_sources_identity_check
    check (pg_catalog.btrim(source_identity) <> ''),
  constraint sec_structured_raw_sources_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint sec_structured_raw_sources_content_kind_check
    check (raw_content_kind in ('authoritative_http_body', 'injected_exact_body', 'canonical_fixture_json')),
  constraint sec_structured_raw_sources_content_size_check
    check (pg_catalog.octet_length(raw_content) between 1 and 268435456),
  constraint sec_structured_raw_sources_payload_check
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint sec_structured_raw_sources_identity_unique
    unique (source_kind, source_identity, content_hash),
  constraint sec_structured_raw_sources_exact_fk_unique
    unique (id, cik, source_kind)
);

create index sec_structured_raw_sources_issuer_kind_fetched_idx
  on public.sec_structured_raw_sources (cik, source_kind, fetched_at desc);

create table public.sec_issuers (
  cik text primary key,
  created_at timestamptz not null default pg_catalog.now(),
  constraint sec_issuers_cik_check
    check (cik ~ '^[0-9]{10}$' and cik <> '0000000000')
);

create table public.sec_issuer_source_observations (
  id bigint generated always as identity primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  entity_name text not null,
  source_raw_id uuid not null,
  source_kind text not null default 'submissions',
  observed_at timestamptz not null,
  ingested_at timestamptz not null default pg_catalog.now(),
  constraint sec_issuer_source_observations_name_check
    check (pg_catalog.btrim(entity_name) <> ''),
  constraint sec_issuer_source_observations_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_issuer_source_observations_source_kind_check
    check (source_kind = 'submissions'),
  constraint sec_issuer_source_observations_unique
    unique (issuer_cik, source_raw_id)
);

create index sec_issuer_source_observations_issuer_observed_idx
  on public.sec_issuer_source_observations (issuer_cik, observed_at desc);

create table public.sec_issuer_ticker_observations (
  id bigint generated always as identity primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  ticker text not null,
  exchange text not null,
  source_raw_id uuid not null,
  source_kind text not null default 'submissions',
  observed_at timestamptz not null,
  ingested_at timestamptz not null default pg_catalog.now(),
  constraint sec_issuer_ticker_observations_ticker_check
    check (ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,11}$'),
  constraint sec_issuer_ticker_observations_exchange_check
    check (pg_catalog.btrim(exchange) <> ''),
  constraint sec_issuer_ticker_observations_source_kind_check
    check (source_kind = 'submissions'),
  constraint sec_issuer_ticker_observations_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_issuer_ticker_observations_unique
    unique (issuer_cik, ticker, exchange, source_raw_id)
);

create index sec_issuer_ticker_observations_issuer_observed_idx
  on public.sec_issuer_ticker_observations (issuer_cik, observed_at desc);
create index sec_issuer_ticker_observations_ticker_exchange_observed_idx
  on public.sec_issuer_ticker_observations (ticker, exchange, observed_at desc);

create table public.sec_filing_ledger (
  accession_number text primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  form text not null,
  filed_date date not null,
  accepted_at timestamptz,
  report_date date,
  primary_document text,
  is_xbrl boolean,
  is_inline_xbrl boolean,
  source_raw_id uuid not null,
  source_kind text not null default 'submissions',
  ingested_at timestamptz not null default pg_catalog.now(),
  constraint sec_filing_ledger_accession_check
    check (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint sec_filing_ledger_form_check check (pg_catalog.btrim(form) <> ''),
  constraint sec_filing_ledger_primary_document_check
    check (primary_document is null or pg_catalog.btrim(primary_document) <> ''),
  constraint sec_filing_ledger_source_kind_check check (source_kind = 'submissions'),
  constraint sec_filing_ledger_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_filing_ledger_fact_identity_unique
    unique (accession_number, issuer_cik, form, filed_date)
);

create index sec_filing_ledger_issuer_filed_idx
  on public.sec_filing_ledger (issuer_cik, filed_date desc, accession_number);
create index sec_filing_ledger_form_filed_idx
  on public.sec_filing_ledger (form, filed_date desc);
create index sec_filing_ledger_raw_source_idx
  on public.sec_filing_ledger (source_raw_id);

create table public.sec_company_facts (
  id bigint generated always as identity primary key,
  source_fact_key text not null unique,
  source_fact_path text not null,
  issuer_cik text not null,
  filing_accession text not null,
  form text not null,
  filed_date date not null,
  source_raw_id uuid not null,
  source_kind text not null default 'companyfacts',
  context_kind text not null default 'companyfacts_implicit',
  taxonomy text not null,
  concept text not null,
  unit text not null,
  value_kind text not null,
  value_numeric numeric,
  value_text text,
  instant_date date,
  start_date date,
  end_date date,
  fiscal_year integer,
  fiscal_period text,
  frame text,
  ingested_at timestamptz not null default pg_catalog.now(),
  constraint sec_company_facts_source_key_check
    check (source_fact_key ~ '^[0-9a-f]{64}$'),
  constraint sec_company_facts_source_path_check
    check (pg_catalog.btrim(source_fact_path) <> ''),
  constraint sec_company_facts_taxonomy_check
    check (taxonomy ~ '^[A-Za-z][A-Za-z0-9._-]*$'),
  constraint sec_company_facts_concept_check
    check (concept ~ '^[A-Za-z][A-Za-z0-9._-]*$'),
  constraint sec_company_facts_unit_check check (pg_catalog.btrim(unit) <> ''),
  constraint sec_company_facts_source_context_check
    check (source_kind = 'companyfacts' and context_kind = 'companyfacts_implicit'),
  constraint sec_company_facts_value_check
    check (
      (value_kind = 'numeric' and value_numeric is not null and value_text is null)
      or
      (value_kind = 'text' and value_numeric is null and value_text is not null)
    ),
  constraint sec_company_facts_period_check
    check (
      (instant_date is not null and start_date is null and end_date is null)
      or
      (instant_date is null and start_date is not null and end_date is not null and start_date <= end_date)
    ),
  constraint sec_company_facts_fiscal_year_check
    check (fiscal_year is null or fiscal_year between 1800 and 2200),
  constraint sec_company_facts_raw_fk
    foreign key (source_raw_id, issuer_cik, source_kind)
    references public.sec_structured_raw_sources(id, cik, source_kind),
  constraint sec_company_facts_filing_fk
    foreign key (filing_accession, issuer_cik, form, filed_date)
    references public.sec_filing_ledger(accession_number, issuer_cik, form, filed_date)
);

create index sec_company_facts_issuer_concept_period_idx
  on public.sec_company_facts (
    issuer_cik,
    taxonomy,
    concept,
    unit,
    (coalesce(instant_date, end_date)) desc
  );
create index sec_company_facts_filing_idx
  on public.sec_company_facts (filing_accession);
create index sec_company_facts_raw_source_idx
  on public.sec_company_facts (source_raw_id);

alter table public.sec_structured_raw_sources enable row level security;
alter table public.sec_issuers enable row level security;
alter table public.sec_issuer_source_observations enable row level security;
alter table public.sec_issuer_ticker_observations enable row level security;
alter table public.sec_filing_ledger enable row level security;
alter table public.sec_company_facts enable row level security;

revoke all on table public.sec_structured_raw_sources from public, anon, authenticated, service_role;
revoke all on table public.sec_issuers from public, anon, authenticated, service_role;
revoke all on table public.sec_issuer_source_observations from public, anon, authenticated, service_role;
revoke all on table public.sec_issuer_ticker_observations from public, anon, authenticated, service_role;
revoke all on table public.sec_filing_ledger from public, anon, authenticated, service_role;
revoke all on table public.sec_company_facts from public, anon, authenticated, service_role;
revoke all on sequence public.sec_issuer_source_observations_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.sec_issuer_ticker_observations_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.sec_company_facts_id_seq from public, anon, authenticated, service_role;

grant select, insert on table public.sec_structured_raw_sources to service_role;
grant select, insert on table public.sec_issuers to service_role;
grant select, insert on table public.sec_issuer_source_observations to service_role;
grant select, insert on table public.sec_issuer_ticker_observations to service_role;
grant select, insert, update on table public.sec_filing_ledger to service_role;
grant select, insert on table public.sec_company_facts to service_role;
grant usage, select on sequence public.sec_issuer_source_observations_id_seq to service_role;
grant usage, select on sequence public.sec_issuer_ticker_observations_id_seq to service_role;
grant usage, select on sequence public.sec_company_facts_id_seq to service_role;

comment on table public.sec_structured_raw_sources is
  'Internal, versioned raw SEC Submissions/CompanyFacts payloads retained for deterministic replay.';
comment on table public.sec_issuer_ticker_observations is
  'Point-in-time SEC Submissions ticker/exchange observations. No historical validity interval is inferred.';
comment on table public.sec_filing_ledger is
  'CIK-owned accession ledger. accepted_at is populated only from an authoritative SEC source field.';
comment on table public.sec_company_facts is
  'Generic CompanyFacts facts. No metric semantics, dimensions, security classes, or accepted timestamp are inferred.';
