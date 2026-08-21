-- Share Count History Foundation V1.
-- Append-only observations admitted only after Authoritative O/S Extraction
-- returns ELIGIBLE. This schema intentionally has no current/winner resolver.

create table public.share_count_history (
  id bigint generated always as identity primary key,
  issuer_cik text not null references public.sec_issuers(cik),
  shares_outstanding numeric not null,
  as_of date not null,
  security_class_basis text not null,
  security_class_identity jsonb not null,
  security_class_metadata jsonb not null,
  share_basis_identity text not null,
  share_basis_metadata jsonb not null,
  accession_number text not null,
  form text not null,
  filing_document text not null,
  filed_date date not null,
  accepted_at timestamptz not null,
  ingested_at timestamptz not null,
  source_concept_namespace_uri text not null,
  source_concept_local_name text not null,
  source_fact_key text not null,
  source_context_ref text not null,
  source_artifact_id uuid not null,
  filing_ledger_raw_source_id uuid not null,
  source_fact_identity jsonb not null,
  source_context jsonb not null,
  source_dimensions jsonb not null,
  source_provenance jsonb not null,
  source_type text not null,
  authoritative_status text not null,
  authoritative_decision_version text not null,
  authoritative_decision_reason text not null,
  authoritative_decision_lineage jsonb not null,
  source_document_url text not null,
  source_content_hash text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint share_count_history_shares_check
    check (shares_outstanding > 0 and pg_catalog.scale(shares_outstanding) = 0),
  constraint share_count_history_security_class_basis_check
    check (security_class_basis in ('SINGLE_COMMON_STOCK_CLASS', 'CLASS_SPECIFIC_COMMON_STOCK')),
  constraint share_count_history_security_class_identity_check
    check (coalesce((
      pg_catalog.jsonb_typeof(security_class_identity) = 'object'
      and security_class_identity <> '{}'::jsonb
      and pg_catalog.btrim(security_class_identity ->> 'canonicalKey') <> ''
      and (
        (security_class_basis = 'SINGLE_COMMON_STOCK_CLASS'
          and security_class_identity ->> 'identity' = 'dei:EntityCommonStockSharesOutstanding@required-context')
        or
        (security_class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'
          and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,axis,namespaceUri}', '')) <> ''
          and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,axis,localName}', '')) <> ''
          and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,member,namespaceUri}', '')) <> ''
          and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,member,localName}', '')) <> '')
      )
    ), false)),
  constraint share_count_history_security_class_metadata_check
    check (coalesce((
      pg_catalog.jsonb_typeof(security_class_metadata) = 'object'
      and security_class_metadata ->> 'evidenceFactKey' = source_fact_key
      and security_class_metadata ->> 'contextRef' = source_context_ref
      and security_class_metadata -> 'dimensions' = source_dimensions
    ), false)),
  constraint share_count_history_share_basis_identity_check
    check (share_basis_identity ~ '^[a-z][a-z0-9_.:-]{2,127}$'),
  constraint share_count_history_share_basis_metadata_check
    check (coalesce((
      pg_catalog.jsonb_typeof(share_basis_metadata) = 'object'
      and share_basis_metadata ->> 'measurement' = 'shares_outstanding'
      and share_basis_metadata #>> '{unit,namespaceUri}' = 'http://www.xbrl.org/2003/instance'
      and share_basis_metadata #>> '{unit,localName}' = 'shares'
    ), false)),
  constraint share_count_history_accession_check
    check (accession_number ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint share_count_history_text_identity_check
    check (
      pg_catalog.btrim(form) <> ''
      and pg_catalog.btrim(filing_document) <> ''
      and pg_catalog.btrim(source_context_ref) <> ''
    ),
  constraint share_count_history_source_concept_check
    check (
      source_concept_namespace_uri ~ '^https?://xbrl\.sec\.gov/dei/[0-9]{4}$'
      and source_concept_local_name = 'EntityCommonStockSharesOutstanding'
    ),
  constraint share_count_history_source_fact_key_check
    check (source_fact_key ~ '^[0-9a-f]{64}$'),
  constraint share_count_history_source_json_check
    check (coalesce((
      pg_catalog.jsonb_typeof(source_fact_identity) = 'object'
      and source_fact_identity ->> 'factKey' = source_fact_key
      and source_fact_identity ->> 'contextRef' = source_context_ref
      and source_fact_identity ->> 'accession' = accession_number
      and source_fact_identity ->> 'documentName' = filing_document
      and source_fact_identity ->> 'artifactId' = source_artifact_id::text
      and source_fact_identity #>> '{concept,namespaceUri}' = source_concept_namespace_uri
      and source_fact_identity #>> '{concept,localName}' = source_concept_local_name
      and pg_catalog.jsonb_typeof(source_context) = 'object'
      and source_context ->> 'id' = source_context_ref
      and source_context #>> '{period,kind}' = 'instant'
      and source_context #>> '{period,instant}' = as_of::text
      and pg_catalog.lpad(pg_catalog.ltrim(source_context ->> 'entityIdentifier', '0'), 10, '0') = issuer_cik
      and pg_catalog.jsonb_typeof(source_dimensions) = 'array'
      and source_context -> 'dimensions' = source_dimensions
      and pg_catalog.jsonb_typeof(source_provenance) = 'object'
      and source_provenance ->> 'filingLedgerRawSourceId' = filing_ledger_raw_source_id::text
      and pg_catalog.jsonb_typeof(source_provenance -> 'companyFacts') = 'array'
      and pg_catalog.jsonb_array_length(source_provenance -> 'companyFacts') > 0
      and source_provenance #>> '{filingFactSource,artifactId}' = source_artifact_id::text
      and source_provenance #>> '{filingFactSource,sourceUrl}' = source_document_url
      and source_provenance #>> '{filingFactSource,contentHash}' = source_content_hash
    ), false)),
  constraint share_count_history_source_type_check
    check (source_type ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint share_count_history_authoritative_check
    check (coalesce((
      authoritative_status = 'ELIGIBLE'
      and authoritative_decision_version = 'authoritative-os-extraction-v1'
      and authoritative_decision_reason in (
        'ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT',
        'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT'
      )
      and pg_catalog.jsonb_typeof(authoritative_decision_lineage) = 'object'
      and authoritative_decision_lineage ->> 'status' = 'ELIGIBLE'
      and authoritative_decision_lineage ->> 'decisionVersion' = authoritative_decision_version
      and authoritative_decision_lineage ->> 'reason' = authoritative_decision_reason
      and pg_catalog.jsonb_typeof(authoritative_decision_lineage -> 'candidate') = 'object'
      and authoritative_decision_lineage #>> '{candidate,issuerCik}' = issuer_cik
      and authoritative_decision_lineage #>> '{candidate,sharesOutstanding}' = shares_outstanding::text
      and authoritative_decision_lineage #>> '{candidate,asOf}' = as_of::text
      and authoritative_decision_lineage #>> '{candidate,accession}' = accession_number
      and authoritative_decision_lineage #>> '{candidate,form}' = form
      and authoritative_decision_lineage #>> '{candidate,filedDate}' = filed_date::text
      and pg_catalog.jsonb_typeof(authoritative_decision_lineage -> 'filingFacts') = 'array'
      and pg_catalog.jsonb_array_length(authoritative_decision_lineage -> 'filingFacts') > 0
      and authoritative_decision_lineage -> 'filingFacts'
        @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('factKey', source_fact_key))
    ), false)),
  constraint share_count_history_source_url_check
    check (source_document_url ~ '^https://([a-z0-9-]+\.)*sec\.gov/'),
  constraint share_count_history_source_hash_check
    check (source_content_hash ~ '^[0-9a-f]{64}$'),
  constraint share_count_history_filing_identity_fk
    foreign key (accession_number, issuer_cik, form, filed_date)
    references public.sec_filing_ledger(accession_number, issuer_cik, form, filed_date),
  constraint share_count_history_canonical_source_unique
    unique (
      source_type,
      issuer_cik,
      accession_number,
      filing_document,
      source_content_hash,
      source_fact_key,
      source_context_ref
    )
);

create index share_count_history_issuer_as_of_idx
  on public.share_count_history (issuer_cik, as_of, accepted_at, accession_number, id);

create index share_count_history_issuer_class_as_of_idx
  on public.share_count_history (
    issuer_cik,
    security_class_basis,
    (security_class_identity ->> 'canonicalKey'),
    as_of,
    id
  );

alter table public.share_count_history enable row level security;

revoke all on table public.share_count_history from public, anon, authenticated, service_role;
revoke all on sequence public.share_count_history_id_seq from public, anon, authenticated, service_role;

grant select, insert on table public.share_count_history to service_role;
grant usage, select on sequence public.share_count_history_id_seq to service_role;

comment on table public.share_count_history is
  'Append-only issuer/time share-count observations. ELIGIBLE authority is required; no row is a current or winning value.';
comment on column public.share_count_history.as_of is 'O/S measurement date from the filing fact context.';
comment on column public.share_count_history.filed_date is 'SEC filing submission date.';
comment on column public.share_count_history.accepted_at is 'SEC acceptance timestamp.';
comment on column public.share_count_history.ingested_at is 'Stock Radar collection timestamp for this history observation.';
comment on column public.share_count_history.source_type is
  'Extensible producer identity. V1 writes sec_authoritative_os; future levels require their own validated writer.';
