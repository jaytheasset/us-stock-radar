# SC13 Lineage and Stored Current State V1

## Scope

This internal service projects Schedule 13D/13G amendment lineage and the latest
reported values within a complete persisted issuer history. It reads the
existing immutable `sec_sc13_filings` and `sec_sc13_reporting_persons` rows. It
does not add a table, mutation hook, backfill, Cron job, Monitor condition,
alert, UI, parser fallback, or LLM call.

`available_stored_history` never claims that the database contains every SEC
filing. Every projection therefore reports the scope as
`complete_stored_history_not_sec_global` and SEC-wide completeness as
`not_verified`.

## Supported source

The service accepts only canonical rows that pass the existing
`lib/sec-sc13-xml` readback validation. At V1 that means official SEC Schedule
13D/13G XML using schema `X0202`, the supported Schedule 13 namespace, and XSD
package version 2.3, with verified accession and EDGAR index roles. Legacy HTML,
older XML without the supported schema marker, truncated source, and rows that
fail source/payload revalidation are not converted or inferred.

## Link proof and identity

An amendment link is established only from the amendment XML's exact
`previousAccessionNumber`. Filing date, accession ordering, issuer name, ticker,
or nearest-neighbour selection never creates a link.

The referenced canonical filing must already be stored and must match all of:

- issuer CIK;
- header filer CIK;
- 13D or 13G form family (no inferred 13D/13G transition);
- security class after case and whitespace normalization only;
- the complete normalized CUSIP set; and
- the complete reporting-person CIK set.

Reporting persons without a verified CIK remain unresolved. Names do not
replace missing CIK evidence. Reporter rows are never summed.

The XML reference can be an original-filing anchor rather than the immediately
preceding amendment. Multiple amendments may therefore reference the same
original without invalidating those links. Stored current state is available
only when amendment numbers are unique and contiguous from 1, and their filing
timestamps are strictly increasing. Missing numbers, duplicate numbers,
reversed order, missing targets, and conflicting identities are unresolved.

An unresolved filing also blocks an otherwise separate current position when
it has the same issuer, class, and CUSIP and shares at least one verified
reporter CIK. This covers partial-reporter amendments without incorrectly
blocking filings by wholly different holders. The same verified reporter and
security appearing across 13D and 13G form families is a cross-family
latestness boundary and leaves both positions unresolved.

## Current values and missing fields

For an available stored lineage, the head filing's reporter rows are returned
separately. A present raw numeric value, including the literal value `0`, is a
current reported value from that head accession.

A null or omitted head field is not zero, an exit, or an implicit carry-forward.
Its current value is null with reason `current_filing_field_missing`. The most
recent earlier non-null value may be returned separately as `lastReported`,
including its source accession, but is not promoted to the current value.
Missing or added reporters make identity resolution unavailable rather than
creating an ownership change.

## Complete stored-history read

`readSc13IssuerCurrentState()` pages the filing table in fixed 100-row pages and
uses the exact REST count when available. It stops only on a short page or the
verified count. Malformed successful responses, count changes, duplicate
accessions, issuer mismatch after canonical readback, read failures, and
histories beyond the 10,000-row safety ceiling return `unavailable`; none are
reported as an empty or complete history.

## Official isolated verification

The positive SEC pair is Braveheart Bio, Inc. (`issuer CIK 0002131524`), filed
by OrbiMed Advisors LLC (`header filer CIK 0001055951`):

- original Schedule 13D `0000947871-26-000814`;
- Schedule 13D/A amendment 1 `0000947871-26-000860`, whose XML explicitly names
  the original accession;
- class `Common Stock`, CUSIP `10567X101`, and the same three reporting-person
  CIKs in both filings.

The isolated verification persists the amendment before the original, observes
`missing_predecessor`, persists the original, and then reads the amendment as
the stored-history head. It also saves and reads the existing LODE, MTCH, MSFT,
and AAPL canonical XML cases and verifies concurrent replay without row growth.

MTCH remains unresolved because its explicit 2024 predecessor is outside the
supported canonical store. AAPL remains unresolved because amendment 11 has no
explicit predecessor. MSFT's filing history is readable but its current
position remains unresolved because the XML does not provide a reporting-person
CIK. These cases are intentionally not repaired from names, dates, zero values,
or accessions.
