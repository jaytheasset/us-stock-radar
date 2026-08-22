-- Issuer Common-Class Universe Snapshot V1.
-- A snapshot is derived from one complete primary IXDS filing set. Historical
-- share-count observations are never unioned to assert filing completeness.

create table public.issuer_common_class_universe_snapshots (
  id bigint generated always as identity primary key,
  snapshot_version text not null,
  issuer_cik text not null references public.sec_issuers(cik),
  universe_as_of date not null,
  accepted_at timestamptz not null,
  source_accession text not null,
  source_form text not null,
  source_filed_date date not null,
  source_documents text[] not null default '{}'::text[],
  status text not null,
  reason text not null,
  required_canonical_security_class_ids text[] not null default '{}'::text[],
  class_evidence jsonb not null default '[]'::jsonb,
  aggregate_evidence jsonb not null default '[]'::jsonb,
  excluded_evidence jsonb not null default '[]'::jsonb,
  completeness_provenance jsonb not null,
  source_identity_hash text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint issuer_common_class_universe_snapshot_version_check
    check (snapshot_version = 'issuer-common-class-universe-snapshot-v1'),
  constraint issuer_common_class_universe_status_check
    check (status in ('COMPLETE_SINGLE', 'COMPLETE_MULTI', 'INCOMPLETE', 'AMBIGUOUS')),
  constraint issuer_common_class_universe_reason_check
    check (
      pg_catalog.btrim(reason) <> ''
      and (
        (status = 'COMPLETE_SINGLE' and reason = 'COMPLETE_SINGLE_COMMON_STOCK')
        or (status = 'COMPLETE_MULTI' and reason = 'COMPLETE_MULTI_COMMON_STOCK')
        or (status = 'AMBIGUOUS'
          and reason in ('ADS_OR_ORDINARY_AMBIGUOUS', 'CLASS_FACT_CONFLICT'))
        or (status = 'INCOMPLETE'
          and reason in (
            'FILING_CONTEXT_INCOMPLETE',
            'SOURCE_PROVENANCE_INVALID',
            'COMMON_CLASS_BREAKDOWN_INCOMPLETE',
            'AGGREGATE_CLASS_SUM_MISMATCH',
            'UNSUPPORTED_CLASS_MEMBER',
            'AUTHORITATIVE_SOURCE_NOT_ELIGIBLE'
          ))
      )
    ),
  constraint issuer_common_class_universe_accession_check
    check (source_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  constraint issuer_common_class_universe_source_form_check
    check (pg_catalog.btrim(source_form) <> ''),
  constraint issuer_common_class_universe_documents_check
    check (pg_catalog.array_position(source_documents, null) is null),
  constraint issuer_common_class_universe_required_classes_check
    check (
      pg_catalog.array_position(required_canonical_security_class_ids, null) is null
      and (
        (status = 'COMPLETE_SINGLE'
          and pg_catalog.cardinality(required_canonical_security_class_ids) = 1
          and required_canonical_security_class_ids[1] = 'sc:v1:' || issuer_cik || ':common_stock:single')
        or
        (status = 'COMPLETE_MULTI'
          and pg_catalog.cardinality(required_canonical_security_class_ids) >= 2
          and not ('sc:v1:' || issuer_cik || ':common_stock:single'
            = any(required_canonical_security_class_ids)))
        or
        (status in ('INCOMPLETE', 'AMBIGUOUS')
          and pg_catalog.cardinality(required_canonical_security_class_ids) = 0)
      )
    ),
  constraint issuer_common_class_universe_json_check
    check (
      pg_catalog.jsonb_typeof(class_evidence) = 'array'
      and pg_catalog.jsonb_typeof(aggregate_evidence) = 'array'
      and pg_catalog.jsonb_typeof(excluded_evidence) = 'array'
      and pg_catalog.jsonb_typeof(completeness_provenance) = 'object'
      and completeness_provenance ->> 'historicalClassUnionUsed' = 'false'
      and (
        (status = 'COMPLETE_SINGLE' and pg_catalog.jsonb_array_length(class_evidence) = 1)
        or
        (status = 'COMPLETE_MULTI'
          and pg_catalog.jsonb_array_length(class_evidence)
            = pg_catalog.cardinality(required_canonical_security_class_ids))
        or
        status in ('INCOMPLETE', 'AMBIGUOUS')
      )
    ),
  constraint issuer_common_class_universe_source_hash_check
    check (source_identity_hash ~ '^[0-9a-f]{64}$'),
  constraint issuer_common_class_universe_filing_identity_fk
    foreign key (source_accession, issuer_cik, source_form, source_filed_date)
    references public.sec_filing_ledger(accession_number, issuer_cik, form, filed_date),
  constraint issuer_common_class_universe_source_unique
    unique (source_identity_hash)
);

create index issuer_common_class_universe_issuer_time_idx
  on public.issuer_common_class_universe_snapshots (
    issuer_cik,
    universe_as_of desc,
    accepted_at desc,
    source_accession,
    id
  );

alter table public.issuer_common_class_universe_snapshots enable row level security;

revoke all on table public.issuer_common_class_universe_snapshots
  from public, anon, authenticated, service_role;
revoke all on sequence public.issuer_common_class_universe_snapshots_id_seq
  from public, anon, authenticated, service_role;

grant select, insert on table public.issuer_common_class_universe_snapshots to service_role;
grant usage, select on sequence public.issuer_common_class_universe_snapshots_id_seq to service_role;

comment on table public.issuer_common_class_universe_snapshots is
  'Append-only, filing-backed issuer common-stock class-universe snapshots. No row is a current O/S value.';
comment on column public.issuer_common_class_universe_snapshots.universe_as_of is
  'Shared instant date of the filing common O/S facts, never report period or filing date fallback.';
comment on column public.issuer_common_class_universe_snapshots.accepted_at is
  'Actual SEC filing-ledger acceptance timestamp used for event-time availability.';
comment on column public.issuer_common_class_universe_snapshots.required_canonical_security_class_ids is
  'Exact common class set only for COMPLETE_SINGLE or COMPLETE_MULTI snapshots.';
comment on column public.issuer_common_class_universe_snapshots.completeness_provenance is
  'Complete primary IXDS and authoritative decision lineage; historical class union is forbidden.';
