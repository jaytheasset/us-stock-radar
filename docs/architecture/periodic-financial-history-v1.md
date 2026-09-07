# Periodic Financial History / Series V1

This layer composes the accession-scoped
[`periodic-financial-resolver-v1`](periodic-financial-resolver-v1.md). It does
not select filing facts, reinterpret concepts, calculate values, write a
database row, call an LLM, or introduce an FMP fallback. The implementation is
`lib/sec-structured-data/periodicFinancialHistory.ts`.

## Boundary

The caller supplies one issuer, its bounded filing-ledger family, exact
CompanyFacts rows, and one filing-XBRL document set for every explicit target
accession. The history layer invokes the production resolver independently for
each unique accession. A resolver failure remains unavailable or ambiguous and
contributes no series claim.

The output is versioned as `periodic-financial-history-v1`, declares
`gptDependency: false`, and keeps every underlying resolver resolution for
audit and replay.

## Series identities

Quarterly and annual filing families are separate. Within them, the following
fields define an exact series identity:

- issuer CIK;
- `10-Q`, `10-K`, `20-F`, or `40-F` base form;
- resolver metric and period basis;
- un-dimensioned financial scope;
- ISO 4217 currency unit;
- taxonomy, local concept, and exact namespace URI;
- complete reviewed issuer-extension mapping identity, when used.

The exact namespace is retained in the identity. A taxonomy-year change is
therefore a visible series boundary even when the local concept name is
unchanged. The layer does not claim semantic equivalence across taxonomy
revisions.

`QUARTER`, `QUARTER_AND_YEAR_TO_DATE`, `ANNUAL`, and `INSTANT` are distinct
lanes. `YEAR_TO_DATE` resolver observations are preserved in
`nonSeriesDecisions`; they never enter quarterly history and are never
subtracted to derive a quarter. Cash remains `INSTANT`; its quarterly or annual
category comes only from the filing family.

## Points and provenance

Both the resolver-approved current evidence and its exact same-accession
prior-year comparable may become series claims. Each claim keeps:

- the target accession, filing ledger row, and resolver currentness result;
- the complete resolver observation;
- filing fact keys, contexts, periods, dimensions, lexical values, units,
  document URLs, hashes, artifact IDs, and source metadata;
- CompanyFacts source keys, JSON paths, exact decimals, and fiscal metadata;
- reviewed concept-mapping evidence, when present.

Claims join only when the complete series identity and exact instant or
duration period match. Exact-equal values collapse to one resolved point while
all claims remain attached. A same-identity, same-period value disagreement is
an explicit `CROSS_ACCESSION_VALUE_CONFLICT` unavailable point containing all
conflicting values and claims. No claim silently overwrites another.

Duplicate target-accession inputs are `DUPLICATE_ACCESSION_INPUT`; the layer
does not select one by array order. Filing originals, amendments, and duplicate
families are governed by the underlying reviewed-currentness contract. An
unreviewed ambiguous family contributes no point.

## Determinism

Target accessions, series, points, claims, unavailable results, and non-series
decisions use fixed semantic ordering. The production resolver already sorts
facts and evidence. Reordering filing inputs, filing rows, CompanyFacts rows,
filing facts, and filing sources therefore produces an identical result.

## Audit cases

The minimal audit fixture stores no complete filing body. Its Apple and Wix
rows contain exact observations from official SEC Submissions, CompanyFacts,
filing indexes, and Inline XBRL documents. Its IFRS `40-F` row is explicitly
synthetic and covers deterministic form-family, duplicate-source, amendment,
and conflict contracts only. Offline history regression coverage includes:

- Apple 2025 and 2026 Q3 `10-Q` accessions;
- Apple 2024 and 2025 `10-K` accessions;
- Wix.com 2024 and 2025 `20-F` accessions using US GAAP;
- a synthetic IFRS `40-F`, including duplicate-source provenance;
- a synthetic `40-F` / `40-F/A` family as an unreviewed
  amendment-currentness rejection.

The official Apple 2025 Q3 CompanyFacts rows omit the SEC frame on the current
Revenue, Operating Income/Loss, and Net Income/Loss quarter facts. Those three
metrics therefore remain `PERIOD_BASIS_AMBIGUOUS` for that accession; the
history test does not inject a frame to make them pass. Its exact cash and OCF
YTD observations remain available in their proper identities.

The source boundary follows the SEC's EDGAR API description:
<https://www.sec.gov/search-filings/edgar-application-programming-interfaces>.

Run the focused production-code regression with:

```text
npm run verify:periodic-financial-history
```

Run the independent TD official-source audit with:

```text
npm run verify:periodic-financial-history:td-official
```

That audit fetches current official SEC Submissions and CompanyFacts bodies and
the immutable filing inventory for accession `0001562762-25-000289`. It then
runs the exact production sequence: HTTP source clients, structured-data
normalization, complete IXDS parsing, accession resolver, and history/series.
The three filing-document URLs, SHA-256 hashes, deterministic artifact IDs,
CIK, accession, and authoritative-body provenance are asserted. No financial
fact value is supplied to the parser; expected values exist only as assertions
after resolution.

This V1 has no UI or API integration, schema or migration, database write,
backfill, scheduler, or production deployment behavior.
