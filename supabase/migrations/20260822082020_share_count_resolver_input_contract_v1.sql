-- Share Count Resolver Input Contract V1.
-- Adds source-independent security-class identity and trustworthy SEC acceptance
-- timestamp provenance. This migration intentionally adds no resolver/winner logic.

alter table public.share_count_history
  add column canonical_security_class_id text,
  add column canonical_security_class_kind text,
  add column canonical_security_class_status text,
  add column canonical_security_class_provenance jsonb,
  add column accepted_at_source text,
  add column accepted_at_provenance jsonb;

update public.share_count_history
set
  canonical_security_class_id = case
    when source_type = 'sec_authoritative_os'
      and security_class_basis = 'SINGLE_COMMON_STOCK_CLASS'
      then 'sc:v1:' || issuer_cik || ':common_stock:single'
    when source_type = 'sec_authoritative_os'
      and security_class_basis = 'CLASS_SPECIFIC_COMMON_STOCK'
      then 'sc:v1:' || issuer_cik || ':common_stock:us-gaap:' ||
        (security_class_identity #>> '{identity,member,localName}')
    else null
  end,
  canonical_security_class_kind = case
    when source_type = 'sec_authoritative_os' then 'common_stock'
    else null
  end,
  canonical_security_class_status = case
    when source_type = 'sec_authoritative_os' then 'mapped'
    else 'unavailable'
  end,
  canonical_security_class_provenance = case
    when source_type = 'sec_authoritative_os' then pg_catalog.jsonb_build_object(
      'version', 'share-count-security-class-v1',
      'derivation', 'authoritative_filing_xbrl_context',
      'issuerCik', issuer_cik,
      'securityClassBasis', security_class_basis,
      'sourceCanonicalKey', security_class_identity ->> 'canonicalKey',
      'sourceIdentity', security_class_identity -> 'identity',
      'sourceFactKey', source_fact_key,
      'sourceContextRef', source_context_ref,
      'migrationBackfill', true
    )
    else pg_catalog.jsonb_build_object(
      'version', 'share-count-security-class-v1',
      'derivation', 'legacy_level2_unmapped',
      'reason', 'EXPLICIT_COMMON_STOCK_KIND_AND_AUTHORITATIVE_MAPPING_NOT_RECORDED',
      'sourceSpecificIdentity', security_class_identity
    )
  end,
  accepted_at_source = case
    when source_type = 'sec_authoritative_os' then 'sec_filing_ledger'
    else 'unavailable'
  end,
  accepted_at_provenance = case
    when source_type = 'sec_authoritative_os' then pg_catalog.jsonb_build_object(
      'source', 'sec_filing_ledger.accepted_at',
      'accessionNumber', accession_number,
      'filingLedgerRawSourceId', filing_ledger_raw_source_id
    )
    else pg_catalog.jsonb_build_object(
      'source', 'unavailable',
      'reason', 'LEGACY_LEVEL2_ACCEPTED_AT_MAY_BE_PUBLISHED_AT_FALLBACK',
      'rejectedLegacyValue', accepted_at
    )
  end;

-- Historical Level 2 accepted_at values may have originated from published_at.
-- Do not silently reinterpret them as SEC acceptance timestamps.
update public.share_count_history
set accepted_at = null
where source_type = 'sec_filing_text_level2';

alter table public.share_count_history
  alter column accepted_at drop not null,
  alter column canonical_security_class_status set not null,
  alter column canonical_security_class_provenance set not null,
  alter column accepted_at_source set not null,
  alter column accepted_at_provenance set not null;

alter table public.share_count_history
  add constraint share_count_history_canonical_security_class_check
    check (coalesce((
      pg_catalog.jsonb_typeof(canonical_security_class_provenance) = 'object'
      and canonical_security_class_provenance <> '{}'::jsonb
      and (
        (canonical_security_class_status = 'mapped'
          and canonical_security_class_kind = 'common_stock'
          and canonical_security_class_id ~ (
            '^sc:v1:' || issuer_cik || ':common_stock:(single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$'
          ))
        or
        (canonical_security_class_status = 'unavailable'
          and canonical_security_class_id is null
          and canonical_security_class_kind is null)
      )
      and (source_type <> 'sec_authoritative_os' or canonical_security_class_status = 'mapped')
      and (source_type <> 'sec_filing_text_level2'
        or canonical_security_class_status = 'unavailable'
        or security_class_metadata ->> 'sourceDeclaredClassKind' = 'common_stock')
    ), false)),
  add constraint share_count_history_accepted_at_provenance_check
    check (coalesce((
      pg_catalog.jsonb_typeof(accepted_at_provenance) = 'object'
      and accepted_at_provenance <> '{}'::jsonb
      and (
        (accepted_at_source = 'sec_filing_ledger'
          and source_type = 'sec_authoritative_os'
          and accepted_at is not null
          and accepted_at_provenance ->> 'source' = 'sec_filing_ledger.accepted_at')
        or
        (accepted_at_source = 'sec_raw_payload_acceptance'
          and source_type = 'sec_filing_text_level2'
          and accepted_at is not null
          and accepted_at_provenance ->> 'source' = 'raw_items.raw_payload.accepted_at')
        or
        (accepted_at_source = 'unavailable'
          and source_type = 'sec_filing_text_level2'
          and accepted_at is null
          and accepted_at_provenance ->> 'source' = 'unavailable'
          and pg_catalog.btrim(coalesce(accepted_at_provenance ->> 'reason', '')) <> '')
      )
    ), false));

create index share_count_history_issuer_canonical_class_as_of_idx
  on public.share_count_history (
    issuer_cik,
    canonical_security_class_id,
    as_of,
    accepted_at,
    id
  )
  where canonical_security_class_status = 'mapped';

comment on column public.share_count_history.canonical_security_class_id is
  'Source-independent issuer-scoped security class identity. Null means mapping is unavailable; never a title/synonym match.';
comment on column public.share_count_history.canonical_security_class_provenance is
  'Deterministic identity derivation and authoritative supporting observations; source-specific identity remains separately preserved.';
comment on column public.share_count_history.accepted_at is
  'Verified SEC acceptance timestamp only. Null when the SEC acceptance timestamp is unavailable.';
comment on column public.share_count_history.accepted_at_source is
  'Exact provenance boundary for accepted_at: SEC filing ledger, raw SEC acceptance payload, or unavailable.';
