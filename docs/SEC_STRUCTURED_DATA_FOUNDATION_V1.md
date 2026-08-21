# SEC Structured Data Foundation V1

This foundation is an internal ingestion and read boundary for SEC Submissions
and CompanyFacts. It does not calculate shares outstanding, revenue, cash,
debt, dilution, market capitalization, or any other product metric.

## Identity and provenance

- `sec_issuers` is keyed by normalized ten-digit CIK.
- `sec_issuer_source_observations` retains names observed in exact Submissions
  raw sources.
- `sec_issuer_ticker_observations` retains ticker/exchange/source/observation
  tuples. It deliberately has no `valid_from` or `valid_to`, because
  Submissions supplies current arrays rather than historical intervals.
- `sec_filing_ledger` is keyed by accession and bound to CIK, form, and filed
  date. `accepted_at` is nullable and is populated only from the SEC
  `acceptanceDateTime` field. Existing event `published_at` values are not used.

## Raw and normalized boundary

`sec_structured_raw_sources` stores the SEC source URL and identity, normalized
CIK, fetch and ingest timestamps, schema version when supplied, the exact raw
text used for SHA-256, its authority kind, and a queryable JSONB payload.
`authoritative_http_body` is byte-for-byte SEC response text,
`injected_exact_body` is exact deterministic test-client text, and
`canonical_fixture_json` explicitly means no authoritative source bytes were
available. A deterministic UUID and a
unique source-kind/identity/hash key make replay concurrency-safe.

`sec_company_facts` stores one row per exact CompanyFacts unit-array entry. It
keeps taxonomy, concept, unit, typed numeric or text value, instant or duration,
accession, form, filed date, optional `fy`/`fp`/`frame`, exact raw source, and a
source path and a deterministic key derived only from the normalized SEC fact
tuple, never the snapshot hash or array position. CompanyFacts rows are explicitly marked
`companyfacts_implicit`; no axis, member, context, or security-class value is
invented. A later filing-XBRL implementation can add a separate dimension table
for `filing_xbrl` sources without changing CompanyFacts meaning.

For an exact raw body, numeric facts are parsed from their original JSON number
lexeme and canonicalized without passing through a JavaScript number. Injected
payload objects without exact raw text accept only safe integer numeric values;
other numeric values fail closed because their original decimal cannot be
guaranteed. Text facts remain text.

## Interfaces

- `SecStructuredSourceClient.fetchSubmissions(cik, mode)` and
  `fetchCompanyFacts(cik, mode)` support fixture injection and the same
  bootstrap/backfill/incremental service boundary.
- `SecStructuredHttpClient` supplies SEC contact headers, rate limiting, current
  Submissions, historical Submissions files for bootstrap/backfill, and
  CompanyFacts. Tests never call it.
- `SecStructuredDataService.ingestIssuer({ cik, mode })` normalizes and returns
  inserted, updated, deduped, rejected, source, and fact counts.
- `PostgresSecStructuredRepository.ingestBatch(batch)` writes batches in one
  short transaction with database conflicts as the idempotency boundary.
- `readIssuerTickers(cik)`, `readFilings(cik, limit)`, and `readFacts(filter)`
  are the official internal read interfaces for later metric extraction.

All six tables have RLS enabled. `anon` and `authenticated` have no privileges.
Only repository-required table and sequence privileges are granted to
`service_role`; no function, RPC, UI, route, or scheduler is added.
