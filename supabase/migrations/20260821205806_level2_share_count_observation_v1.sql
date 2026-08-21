-- Level 2 source-stated Share Count Observation V1.
-- Generalizes the common append-only history boundary without adding current,
-- latest, priority, split, dilution, or winner semantics.

alter table public.share_count_history
  add column observation_type text,
  add column source_evidence text,
  add column source_analyzer text;

update public.share_count_history
set observation_type = 'authoritative_xbrl'
where observation_type is null;

alter table public.share_count_history
  alter column observation_type set not null,
  alter column source_concept_namespace_uri drop not null,
  alter column source_concept_local_name drop not null,
  alter column filing_ledger_raw_source_id drop not null,
  alter column authoritative_status drop not null,
  alter column authoritative_decision_version drop not null,
  alter column authoritative_decision_reason drop not null,
  alter column authoritative_decision_lineage drop not null;

alter table public.share_count_history
  drop constraint share_count_history_security_class_basis_check,
  drop constraint share_count_history_security_class_identity_check,
  drop constraint share_count_history_security_class_metadata_check,
  drop constraint share_count_history_share_basis_metadata_check,
  drop constraint share_count_history_text_identity_check,
  drop constraint share_count_history_source_concept_check,
  drop constraint share_count_history_source_json_check,
  drop constraint share_count_history_authoritative_check,
  drop constraint share_count_history_filing_identity_fk;

alter table public.share_count_history
  add constraint share_count_history_observation_type_check
    check (
      (source_type = 'sec_authoritative_os' and observation_type = 'authoritative_xbrl')
      or
      (source_type = 'sec_filing_text_level2' and observation_type = 'source_stated')
    ),
  add constraint share_count_history_security_class_basis_check
    check (
      (source_type = 'sec_authoritative_os'
        and security_class_basis in ('SINGLE_COMMON_STOCK_CLASS', 'CLASS_SPECIFIC_COMMON_STOCK'))
      or
      (source_type = 'sec_filing_text_level2'
        and security_class_basis = 'SOURCE_STATED_SECURITY_CLASS')
    ),
  add constraint share_count_history_security_class_identity_check
    check (coalesce((
      pg_catalog.jsonb_typeof(security_class_identity) = 'object'
      and security_class_identity <> '{}'::jsonb
      and pg_catalog.btrim(security_class_identity ->> 'canonicalKey') <> ''
      and (
        (source_type = 'sec_authoritative_os' and (
          (security_class_basis = 'SINGLE_COMMON_STOCK_CLASS'
            and security_class_identity ->> 'identity' = 'dei:EntityCommonStockSharesOutstanding@required-context')
          or
          (security_class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'
            and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,axis,namespaceUri}', '')) <> ''
            and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,axis,localName}', '')) <> ''
            and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,member,namespaceUri}', '')) <> ''
            and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,member,localName}', '')) <> '')
        ))
        or
        (source_type = 'sec_filing_text_level2'
          and security_class_basis = 'SOURCE_STATED_SECURITY_CLASS'
          and pg_catalog.btrim(coalesce(security_class_identity #>> '{identity,title}', '')) <> '')
      )
    ), false)),
  add constraint share_count_history_security_class_metadata_check
    check (coalesce((
      pg_catalog.jsonb_typeof(security_class_metadata) = 'object'
      and (
        (source_type = 'sec_authoritative_os'
          and security_class_metadata ->> 'evidenceFactKey' = source_fact_key
          and security_class_metadata ->> 'contextRef' = source_context_ref
          and security_class_metadata -> 'dimensions' = source_dimensions)
        or
        (source_type = 'sec_filing_text_level2'
          and security_class_metadata ->> 'sourceRef' = source_context_ref
          and security_class_metadata ->> 'evidence' = source_evidence
          and source_dimensions = '[]'::jsonb)
      )
    ), false)),
  add constraint share_count_history_share_basis_metadata_check
    check (coalesce((
      pg_catalog.jsonb_typeof(share_basis_metadata) = 'object'
      and share_basis_metadata ->> 'measurement' = 'shares_outstanding'
      and (
        (source_type = 'sec_authoritative_os'
          and share_basis_identity = 'shares_outstanding:xbrli_shares'
          and share_basis_metadata #>> '{unit,namespaceUri}' = 'http://www.xbrl.org/2003/instance'
          and share_basis_metadata #>> '{unit,localName}' = 'shares')
        or
        (source_type = 'sec_filing_text_level2'
          and share_basis_identity = 'shares_outstanding:source_stated'
          and share_basis_metadata #>> '{unit,kind}' = 'shares'
          and share_basis_metadata #>> '{unit,representation}' = 'positive_integer')
      )
    ), false)),
  add constraint share_count_history_text_identity_check
    check (
      pg_catalog.btrim(form) <> ''
      and pg_catalog.btrim(filing_document) <> ''
      and pg_catalog.btrim(source_context_ref) <> ''
    ),
  add constraint share_count_history_source_concept_check
    check (
      (source_type = 'sec_authoritative_os'
        and source_concept_namespace_uri ~ '^https?://xbrl\.sec\.gov/dei/[0-9]{4}$'
        and source_concept_local_name = 'EntityCommonStockSharesOutstanding')
      or
      (source_type = 'sec_filing_text_level2'
        and source_concept_namespace_uri is null
        and source_concept_local_name is null)
    ),
  add constraint share_count_history_source_json_check
    check (coalesce((
      pg_catalog.jsonb_typeof(source_fact_identity) = 'object'
      and source_fact_identity ->> 'factKey' = source_fact_key
      and source_fact_identity ->> 'accession' = accession_number
      and source_fact_identity ->> 'documentName' = filing_document
      and pg_catalog.jsonb_typeof(source_context) = 'object'
      and pg_catalog.jsonb_typeof(source_dimensions) = 'array'
      and pg_catalog.jsonb_typeof(source_provenance) = 'object'
      and (
        (source_type = 'sec_authoritative_os'
          and source_fact_identity ->> 'contextRef' = source_context_ref
          and source_fact_identity ->> 'artifactId' = source_artifact_id::text
          and source_fact_identity #>> '{concept,namespaceUri}' = source_concept_namespace_uri
          and source_fact_identity #>> '{concept,localName}' = source_concept_local_name
          and source_context ->> 'id' = source_context_ref
          and source_context #>> '{period,kind}' = 'instant'
          and source_context #>> '{period,instant}' = as_of::text
          and pg_catalog.lpad(pg_catalog.ltrim(source_context ->> 'entityIdentifier', '0'), 10, '0') = issuer_cik
          and source_context -> 'dimensions' = source_dimensions
          and source_provenance ->> 'filingLedgerRawSourceId' = filing_ledger_raw_source_id::text
          and pg_catalog.jsonb_typeof(source_provenance -> 'companyFacts') = 'array'
          and pg_catalog.jsonb_array_length(source_provenance -> 'companyFacts') > 0
          and source_provenance #>> '{filingFactSource,artifactId}' = source_artifact_id::text
          and source_provenance #>> '{filingFactSource,sourceUrl}' = source_document_url
          and source_provenance #>> '{filingFactSource,contentHash}' = source_content_hash)
        or
        (source_type = 'sec_filing_text_level2'
          and source_fact_identity ->> 'sourceRef' = source_context_ref
          and source_fact_identity ->> 'observationType' = 'source_stated'
          and source_context ->> 'sourceRef' = source_context_ref
          and source_context ->> 'asOf' = as_of::text
          and source_context ->> 'issuerCik' = issuer_cik
          and source_provenance ->> 'rawItemId' = source_artifact_id::text
          and source_provenance ->> 'sourceRef' = source_context_ref
          and source_provenance ->> 'analyzerKey' = source_analyzer)
      )
    ), false)),
  add constraint share_count_history_authoritative_check
    check (coalesce((
      (source_type = 'sec_authoritative_os'
        and authoritative_status = 'ELIGIBLE'
        and authoritative_decision_version = 'authoritative-os-extraction-v1'
        and authoritative_decision_reason in (
          'ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT',
          'ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT'
        )
        and pg_catalog.jsonb_typeof(authoritative_decision_lineage) = 'object'
        and authoritative_decision_lineage ->> 'status' = 'ELIGIBLE'
        and authoritative_decision_lineage ->> 'decisionVersion' = authoritative_decision_version
        and authoritative_decision_lineage ->> 'reason' = authoritative_decision_reason
        and authoritative_decision_lineage #>> '{candidate,issuerCik}' = issuer_cik
        and authoritative_decision_lineage #>> '{candidate,sharesOutstanding}' = shares_outstanding::text
        and authoritative_decision_lineage #>> '{candidate,asOf}' = as_of::text
        and authoritative_decision_lineage #>> '{candidate,accession}' = accession_number
        and authoritative_decision_lineage #>> '{candidate,form}' = form
        and authoritative_decision_lineage #>> '{candidate,filedDate}' = filed_date::text
        and pg_catalog.jsonb_typeof(authoritative_decision_lineage -> 'filingFacts') = 'array'
        and pg_catalog.jsonb_array_length(authoritative_decision_lineage -> 'filingFacts') > 0
        and authoritative_decision_lineage -> 'filingFacts'
          @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('factKey', source_fact_key)))
      or
      (source_type = 'sec_filing_text_level2'
        and authoritative_status is null
        and authoritative_decision_version is null
        and authoritative_decision_reason is null
        and authoritative_decision_lineage is null)
    ), false)),
  add constraint share_count_history_level2_evidence_check
    check (
      (source_type = 'sec_authoritative_os'
        and source_evidence is null
        and source_analyzer is null)
      or
      (source_type = 'sec_filing_text_level2'
        and pg_catalog.btrim(coalesce(source_evidence, '')) <> ''
        and pg_catalog.length(source_evidence) <= 600
        and pg_catalog.btrim(coalesce(source_analyzer, '')) <> '')
    );

comment on table public.share_count_history is
  'Append-only issuer/time share-count observations from validated XBRL and filing-text sources; never a current or winning value.';
comment on column public.share_count_history.observation_type is
  'Observation semantics: authoritative_xbrl or source_stated. This field does not encode source priority.';
comment on column public.share_count_history.source_type is
  'Producer identity. sec_authoritative_os and sec_filing_text_level2 coexist without cross-source dedupe.';
comment on column public.share_count_history.source_evidence is
  'Compact contiguous filing-text evidence for source-stated Level 2 observations; null for XBRL rows.';
