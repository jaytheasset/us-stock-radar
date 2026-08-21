# SEC O/S Extraction V1 — filing-context HOLD

This contract deterministically validates and preserves SEC CompanyFacts
shares-outstanding observations. It does **not** promote them to authoritative
common-stock O/S because the existing Foundation cannot prove the security
class. It does not resolve current shares outstanding, write Share Count
History, adjust reverse splits, calculate dilution, or expose an API/UI.

Final verdict: **HOLD — SEC O/S REQUIRES FILING CONTEXT FOUNDATION**.

## Audited source shape and merge-gate conclusion

The official [EDGAR data API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
says CompanyFacts aggregates non-custom taxonomy facts that apply to the
entire filing entity. A normalized Foundation fact preserves taxonomy,
concept, unit, exact numeric string, instant/duration dates, accession, form,
filed date, raw-source ID, and source key/path. It assigns the synthetic
`companyfacts_implicit` context. It does **not** preserve an XBRL context ID,
axis, member, security title, common-stock class, or ADS ratio.

The Submissions filing ledger supplies the exact CIK/accession/form/filed
identity and `acceptanceDateTime`. `acceptedAt` comes only from an exact joined
ledger row. Neither source adds security-class identity.

SEC's [EDGAR XBRL Guide](https://www.sec.gov/files/edgar/edgar-xbrl-guide.pdf)
describes expected filing-instance tagging: one non-ADR class normally uses an
axis-free cover fact; multiple classes and ADRs normally use security-axis
members. That filing convention is not positive single-class evidence after
CompanyFacts has omitted the context. SEC staff also documents that filers can
submit [incorrect tags and scaling](https://www.sec.gov/about/divisions-offices/division-economic-risk-analysis/observations-custom-tag-rates-errors).

Consequently, the runtime representation of a correctly axis-free single-class
DEI fact is indistinguishable from an incorrectly aggregate/non-dimensional
multi-class DEI fact. The absence of another CompanyFacts fact is not proof of
one class. Alphabet's observed shape is one negative example, not a general
classifier. There is no general deterministic CompanyFacts-only predicate in
the current Foundation that proves one common security class.

## Concepts

| Taxonomy/concept | Contract treatment | Reason |
| --- | --- | --- |
| `dei:EntityCommonStockSharesOutstanding` | Filing-context candidate | Exact cover-page O/S concept, but the normalized observation lacks class context. |
| `us-gaap:CommonStockSharesOutstanding` | Filing-context/conflict evidence only | Balance-sheet concept/date; may aggregate classes and is never a semantic fallback. |
| Issued, authorized, weighted-average, diluted EPS denominator, treasury, public-float, custom, or text concepts | Unsupported | Different semantics; no calculated or inferred substitute is allowed. |

## Validation and status contract

A relevant observation is preserved as `REQUIRES_FILING_CONTEXT` only after all
applicable checks pass:

1. CIK is a non-zero ten-digit identity and matches the fact.
2. Concept is exactly one of the two audited concepts above.
3. Unit is exactly `shares`.
4. Value is a positive canonical integer string. Decimal, exponent, zero,
   negative, text, or missing values fail closed.
5. Period is one valid instant date; duration or mixed periods fail closed.
6. Source kind/context are exactly `companyfacts` /
   `companyfacts_implicit`, with valid source key, source path, and raw ID.
7. Form is exactly one of `10-K`, `10-K/A`, `10-Q`, `10-Q/A`, `20-F`,
   `20-F/A`, `40-F`, `40-F/A`, `6-K`, or `6-K/A`. Foreign forms are
   supported only to preserve an explicit ADS/ordinary-share escalation.
8. Exactly one Submissions ledger row joins on CIK + accession + form + filed
   date and supplies a valid non-null `acceptedAt`.

Passing those checks validates numeric and filing provenance only. It never
establishes a security class. Accordingly, the public runtime enum contains
only `REQUIRES_FILING_CONTEXT` and `UNAVAILABLE`; the unsafe
`COMPANY_FACTS_ELIGIBLE` status has been removed.

Malformed, unsupported, unjoined, or wholly absent observations are
`UNAVAILABLE`. No ticker, entity name, exchange, issuer type, form, unit,
taxonomy family, fiscal period, frame, array position, absence of conflict, or
“latest” position is used as class proof.

## Security class, multi-class, and ADR boundary

Every otherwise-valid domestic DEI observation is
`REQUIRES_FILING_CONTEXT` with
`MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT`. This includes apparently
ordinary issuers: CompanyFacts-only data cannot positively prove that the
observation identifies exactly one common security class.

Foreign-report relevant observations are `REQUIRES_FILING_CONTEXT` with
`ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT`. An ordinary/equity-share
count cannot be treated as the count of a US-traded ADS, and no ratio is
inferred.

Known multi-class, dimension-sensitive, aggregate, or same-date conflicting
observations also require filing context. A multi-class issuer with an
aggregate/non-dimensional DEI fact and no US-GAAP signal follows the same
missing-class-context path; the missing signal does not make it eligible.

## Amendments, duplicates, conflicts, and replay

Observations sort by accepted/filed/as-of/accession chronology. Amendments
remain distinct accession observations and never win automatically. Identical
observations dedupe only on complete semantic and filing-ledger identity; all
distinct source key/path/raw IDs remain in sorted `sourceFacts` provenance.

Different values at the same issuer/instant, or different audited O/S concepts
at that instant, are all retained with
`SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT`. No winner is selected. Input
order does not affect output.

## Exact filing-XBRL escalation conditions

Filing-level XBRL/security context is required when any of these conditions
holds:

1. the normalized CompanyFacts fact lacks positive security-class identity
   (the universal current-Foundation case);
2. multiple common/equity classes exist or may exist;
3. ADS/depositary-receipt versus ordinary/equity-share basis may differ;
4. a value is or may be dimension-sensitive, aggregate, or stripped of its
   axis/member context;
5. same-issuer/same-instant values or audited O/S concepts conflict;
6. an expected class-specific CompanyFacts observation is absent;
7. any equivalent security-basis gap prevents exact identification of the
   common/traded class.

V1 defines these conditions but does not fetch or parse filing XBRL.

## Five-issuer audit

The fixture contains deterministic injected rows and exact official
observations, not full SEC payloads. “Usable” below means usable as
authoritative common-stock O/S; all are **No** under this contract.

| Issuer | Raw fact | Value | As of | Unit | Accession / form | Ambiguity | Status | Usable | Escalation |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| Apple (`0000320193`) | `dei:EntityCommonStockSharesOutstanding` | `14594180000` | 2026-07-17 | shares | `0000320193-26-000020` / 10-Q | No positive class identity in CompanyFacts | `REQUIRES_FILING_CONTEXT` | No | Missing security-class context |
| NeoMedia (`0001022701`) | `dei:EntityCommonStockSharesOutstanding` | `4984827279` | 2013-08-02 | shares | `0001144204-13-044345` / 10-Q/A | No class identity; amendment retained; no split arithmetic | `REQUIRES_FILING_CONTEXT` | No | Missing security-class context |
| Alphabet (`0001652044`) | `us-gaap:CommonStockSharesOutstanding` | `12230000000` | 2026-06-30 | shares | `0001652044-26-000071` / 10-Q | Filing has class-member DEI facts omitted from CompanyFacts | `REQUIRES_FILING_CONTEXT` | No | Missing security-class context |
| Wipro (`0001123799`) | `dei:EntityCommonStockSharesOutstanding` | `10488412458` | 2026-03-31 | shares | `0001193125-26-253514` / 20-F | Equity shares versus NYSE ADS | `REQUIRES_FILING_CONTEXT` | No | ADS/ordinary basis |
| Arm (`0001973239`) | `dei:EntityCommonStockSharesOutstanding` | `1064055252` | 2026-03-31 | shares | `0001973239-26-000097` / 20-F | Ordinary shares versus ADS; same-date balance-sheet value differs | `REQUIRES_FILING_CONTEXT` | No | ADS/ordinary and same-date conflict |

The test suite also injects the decisive adversarial shape: a valid domestic,
aggregate/non-dimensional DEI observation for a multi-class issuer with no
US-GAAP signal. Its runtime fields are indistinguishable from the Apple-shaped
record, so both require filing context.

## Typed contract and official interface

`SecOsFilingContextCandidate` preserves issuer CIK, exact shares string,
`asOf`, accession, form, filed date, ledger `acceptedAt`, taxonomy/concept/unit,
CompanyFacts source kind/context, every source key/path/raw ID, filing-ledger
raw ID, `REQUIRES_FILING_CONTEXT`, and its explicit reason.

`SecOsUnavailableObservation` preserves whatever exact fields passed
validation plus `UNAVAILABLE` and one explicit reason.
`SecOsExtractionResult` returns deterministic `candidates` and `rejected`
arrays and a summary status. It never returns authoritative common O/S.

- `extractCompanyFactsOs({ cik, facts, filings })` is the pure deterministic
  validation/escalation contract for fixtures and replay.
- `readOsCandidates(repository, cik)` uses the official `readFacts` interface
  for the exact DEI and US-GAAP concepts and joins `readFilings`; it performs no
  write. It is not yet an interface for populating Share Count History.

## Audit and mutation counts

- Original audit successful direct public SEC HTTP calls: 12 (five
  CompanyFacts, six Submissions including one NeoMedia provenance recheck, and
  one Alphabet filing document). Requests were sequential and rate-limited;
  contact headers were not printed or committed.
- Merge-gate correction direct SEC data/API calls: 0; official SEC
  documentation was re-read.
- Large SEC payloads committed: 0.
- Local DB writes/backfills/migrations: 0.
- LLM/Gemini calls: 0.
- Local DB read result: the configured local listener was audited inside a
  `READ ONLY` transaction and rolled back. The Foundation schema matches local
  migration `20260821140512`; all three Foundation tables contained zero rows
  at audit time. Issuer observations therefore came from official SEC sources
  and deterministic injected fixtures.
