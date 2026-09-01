# Share Count History Foundation V1

Resolver input identity and trusted acceptance-time provenance are specified in
`share-count-resolver-input-contract-v1.md`. This history remains append-only and
does not select a current or winning observation.

Class-specific event-time selection is defined separately in
`class-specific-os-resolver-v1.md`; the history reader itself remains winner-free.
Retrospective periodic-anchor quality control is defined separately in
`share-count-anchor-reconciliation-v1.md` and never writes reconciled values back
to this history.

Issuer common-class completeness is defined separately in
`issuer-common-class-universe-snapshot-v1.md`. The classes observed in this
history are never unioned to claim that an issuer's full common-class universe
is known.

This foundation stores append-only issuer/time share-count observations. It does
not determine current O/S, select a winner, sum classes, apply corporate-action
adjustments, or calculate dilution. It accepts authoritative XBRL observations
and separately validated filing-text sources. The automatic final-prospectus
seed is defined in `new-listing-prospectus-os-baseline-v1.md`; it never shares
the XBRL, Level 2, or human-approval provenance identity.

## Official flow

```text
SEC CompanyFacts candidate
  -> filing-level XBRL context
  -> Authoritative O/S Extraction
  -> ELIGIBLE
  -> writeAuthoritativeShareCountObservation()
  -> public.share_count_history

US-GAAP aggregate plus complete filing class breakdown
  -> Common-Class Universe V2 COMPLETE_MULTI
  -> writeCompleteMultiClassShareCountObservations()
  -> class facts only -> public.share_count_history

Existing Level 2 domain provider call
  -> optional source-stated sidecar
  -> deterministic provenance validation
  -> writeLevel2ShareCountObservation()
  -> public.share_count_history

Stored final 424B4 primary document
  -> deterministic complete-document/listing/class/current-O/S verifier
  -> sec_prospectus_text_authoritative_os
  -> atomic history + complete-single universe write
```

`REQUIRES_FURTHER_CONTEXT` and `UNAVAILABLE` are rejected before repository
access. The writer consumes the typed output of
`resolveAuthoritativeOsFromFiling()`; it does not parse a filing or reproduce
security semantics.

The sole specialized exception is the complete-multi writer. It requires the
parent decision to remain `REQUIRES_FURTHER_CONTEXT` with the exact
aggregate-plus-class reason and independently validates the V2 universe,
source fact linkage, required-class coverage, and aggregate equality. It emits
one observation per source class fact with decision version
`authoritative-multi-class-os-extraction-v1`. It never emits the aggregate,
repairs a value, infers a missing class, or promotes an incomplete/ambiguous
snapshot.

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
member. Standard members retain the backward-compatible
`us-gaap:<member-local-name>` canonical ID. A source-backed issuer-extension
member uses `custom:<namespace-uri-sha256>:<member-local-name>` while retaining
the exact namespace URI in provenance. Aggregate and class-specific rows are
never combined.

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
latest/current/winner behavior. `source_type` distinguishes
`sec_authoritative_os`, `sec_filing_text_level2`,
`sec_filing_text_human_verified`, and
`sec_prospectus_text_authoritative_os`; the unique source identity includes
that field, so cross-source observations are preserved rather than replaced.
See [Level 2 Share Count Observation V1](level2-share-count-observation.md).

The public-schema table has RLS enabled. `public`, `anon`, and `authenticated`
receive no table or sequence privileges. `service_role` receives only
`SELECT`/`INSERT` and identity-sequence usage.
