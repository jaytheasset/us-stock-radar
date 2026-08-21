# Share Count History Foundation V1

This foundation stores append-only issuer/time share-count observations. It does
not determine current O/S, select a winner, sum classes, apply corporate-action
adjustments, calculate dilution, or connect a Level 2 source.

## Official flow

```text
SEC CompanyFacts candidate
  -> filing-level XBRL context
  -> Authoritative O/S Extraction
  -> ELIGIBLE
  -> writeAuthoritativeShareCountObservation()
  -> public.share_count_history
```

`REQUIRES_FURTHER_CONTEXT` and `UNAVAILABLE` are rejected before repository
access. The writer consumes the typed output of
`resolveAuthoritativeOsFromFiling()`; it does not parse a filing or reproduce
security semantics.

## History identity

The database deduplicates the canonical source identity:

```text
source_type + issuer_cik + accession_number + filing_document
  + source_content_hash + source_fact_key + source_context_ref
```

Exact replay inserts zero rows. A new accession, source fact/value, context, or
filing document content creates another history observation. No update or
delete privilege is granted to the service role.

Security classes are independent identities. The single-common-stock identity
is the extractor's required-context identity. A class-specific identity is the
exact namespace/local-name pair for both `StatementClassOfStockAxis` and its
member. Aggregate and class-specific rows are never combined.

The share basis is `shares_outstanding:xbrli_shares`. Metadata preserves the
resolved XBRL unit, CompanyFacts integer, filing lexical value, and inline
numeric attributes. Full context, dimensions, source artifact, CompanyFacts
lineage, filing-ledger lineage, and the authoritative decision are retained as
JSONB alongside indexed scalar identities.

## Time contract

- `as_of`: O/S measurement date from the filing fact context.
- `filed_date`: SEC filing submission date.
- `accepted_at`: SEC acceptance timestamp.
- `ingested_at`: Stock Radar collection time for the observation.
- `created_at`: database insertion time.

These fields are never collapsed into one timestamp, so a later resolver can
apply event-time rules without look-ahead.

## Reader and future sources

`readShareCountHistory(cik, ...)` returns ordered history rows only. It has no
latest/current/winner behavior. `source_type` is a constrained text identity,
not a closed database enum; V1 writes only `sec_authoritative_os`. A future
Level 2 implementation can add its own validated writer and source type without
changing this table's history model. It is intentionally not connected here.

The public-schema table has RLS enabled. `public`, `anon`, and `authenticated`
receive no table or sequence privileges. `service_role` receives only
`SELECT`/`INSERT` and identity-sequence usage.
