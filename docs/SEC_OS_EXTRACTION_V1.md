# SEC O/S Extraction V1

This contract extracts deterministic **candidate observations** from the SEC
Structured Data Foundation. It does not resolve current shares outstanding,
write Share Count History, adjust reverse splits, calculate dilution, or expose
an API/UI.

## Audited source shape

The official [EDGAR data API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
states that CompanyFacts aggregates non-custom taxonomy facts that apply to the
entire filing entity. A normalized Foundation row preserves taxonomy, concept,
unit, exact numeric string, instant/duration, accession, form, filed date,
CompanyFacts raw-source ID, source key/path, and `companyfacts_implicit`
context. It does **not** preserve an XBRL axis, member, context ID, security
class, ADS ratio, or filing acceptance timestamp.

The official Submissions filing ledger supplies the exact CIK/accession/form/
filed identity and `acceptanceDateTime`. `accepted_at` in this contract comes
only from that joined ledger row. CompanyFacts array order, `frame`, fiscal
period, collection time, and application event time are not acceptance
provenance.

SEC's definition of `dei:EntityCommonStockSharesOutstanding` is the number of
shares or other units outstanding for each registrant class as stated on the
periodic-report cover. SEC's
[XBRL validation warning](https://www.sec.gov/info/edgar/xbrlwarnings.htm)
states that the concept should be axis-free for one non-ADR member and should
otherwise use separate security-axis member contexts. SEC also distinguishes
the cover fact from balance-sheet
[`us-gaap:CommonStockSharesOutstanding`](https://www.sec.gov/newsroom/whats-new/osd-announcement-2210-dqreminder-entitycommonstocksharesoutstanding).

## Concepts

| Taxonomy/concept | Contract treatment | Reason |
| --- | --- | --- |
| `dei:EntityCommonStockSharesOutstanding` | Sole candidate concept | Instant cover-page disclosure with the required SEC meaning. |
| `us-gaap:CommonStockSharesOutstanding` | Escalation evidence only | Balance-sheet concept/date; it can aggregate classes and is never a semantic fallback for the DEI cover fact. |
| Issued, authorized, weighted-average, diluted EPS denominator, treasury, public-float, custom, or text concepts | Unsupported | Different semantics; the extractor returns no calculated or inferred substitute. |

## Eligibility contract

A row is `COMPANY_FACTS_ELIGIBLE` only when every condition below is true:

1. CIK is a non-zero, ten-digit identity and matches the fact.
2. Taxonomy/concept are exactly `dei:EntityCommonStockSharesOutstanding`.
3. Unit is exactly `shares`.
4. The Foundation value is a positive canonical integer string. Decimal,
   exponent, zero, negative, text, and missing values fail closed.
5. The period is one valid instant date; duration or mixed periods fail closed.
6. Source kind/context are exactly `companyfacts` / `companyfacts_implicit`,
   with valid source key, source path, and raw-source ID.
7. Form is exactly `10-K`, `10-Q`, `10-K/A`, or `10-Q/A`.
8. Exactly one filing-ledger row joins on CIK + accession + form + filed date.
9. The joined ledger row has Submissions lineage and a valid non-null
   `accepted_at`.
10. No same-issuer/same-instant value or concept conflict exists in the
    extraction set.

No ticker, exchange, issuer name, CompanyFacts unit, taxonomy family, entity
type, fiscal period, frame, array position, or “latest” position establishes a
security class.

## Security class, multi-class, and ADR boundary

CompanyFacts does not expose axis/member context. The narrow eligible case is a
domestic periodic-report DEI fact that the official API includes as an
entity-wide fact under the SEC's axis-free single-non-ADR tagging rule. The
form whitelist is essential: Wipro and Arm demonstrate that a 20-F CompanyFacts
DEI value can be the foreign issuer's ordinary/equity-share count even when the
US-traded security is an ADS.

The extractor therefore fails closed as follows:

- `20-F`, `20-F/A`, `40-F`, `40-F/A`, `6-K`, and `6-K/A` relevant facts are
  `REQUIRES_FILING_CONTEXT` with
  `ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT`.
- A domestic periodic filing that has only the balance-sheet O/S concept and
  no DEI CompanyFacts fact is `REQUIRES_FILING_CONTEXT` with
  `MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT`. Alphabet's three class-member
  DEI facts are present in its official filing but omitted from CompanyFacts;
  the aggregate balance-sheet row is not selected.
- A confirmed multiple-class, ADS/ordinary, or dimension-sensitive case always
  requires filing XBRL, even if some aggregate numeric fact happens to exist.
- Malformed, unsupported, unjoined, or wholly absent usable facts are
  `UNAVAILABLE`; they are not guessed.

## Amendments, duplicates, conflicts, and replay

Candidates sort by accepted/filed/as-of/accession chronology. Amendments remain
separate accession observations and never win automatically. Identical
canonical observations dedupe only on the complete semantic and filing-ledger
identity; all distinct source key/path/raw IDs are retained in sorted
`sourceFacts` provenance.

Different values at the same issuer/instant, or a candidate and another O/S
concept at that instant, become
`SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT`. No winner is chosen. Input array
order does not affect output.

## Exact filing-XBRL escalation conditions

Filing XBRL context is required for any of these conditions:

1. multiple common/equity classes are known or indicated by class-member facts;
2. ADS/depositary-receipt versus ordinary/equity-share basis may differ;
3. the relevant value is dimension-sensitive or CompanyFacts omitted its
   axis/member context;
4. same issuer/instant values or O/S concepts conflict;
5. a domestic periodic filing has a balance-sheet O/S fact but no class-safe
   DEI CompanyFacts fact;
6. any equivalent security-basis gap prevents the exact traded/common class
   from being identified.

This V1 defines those escalation conditions but does not fetch or parse filing
XBRL.

## Five-issuer audit

The committed fixture contains only deterministic injected rows and exact
official observations, not full payloads.

| Issuer | Raw fact | Value | As of | Unit | Accession / form | Ambiguity | Status | Usable | Escalation |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| Apple (`0000320193`) | `dei:EntityCommonStockSharesOutstanding` | `14594180000` | 2026-07-17 | shares | `0000320193-26-000020` / 10-Q | None within narrow domestic contract | `COMPANY_FACTS_ELIGIBLE` | Yes | None |
| NeoMedia (`0001022701`) | `dei:EntityCommonStockSharesOutstanding` | `4984827279` | 2013-08-02 | shares | `0001144204-13-044345` / 10-Q/A | Amendment; reverse-split history is not adjusted | `COMPANY_FACTS_ELIGIBLE` | Yes, as a distinct observation | None |
| Alphabet (`0001652044`) | `us-gaap:CommonStockSharesOutstanding` | `12230000000` | 2026-06-30 | shares | `0001652044-26-000071` / 10-Q | Filing has three class-member DEI facts; CompanyFacts omits them | `REQUIRES_FILING_CONTEXT` | No | Missing security-class context |
| Wipro (`0001123799`) | `dei:EntityCommonStockSharesOutstanding` | `10488412458` | 2026-03-31 | shares | `0001193125-26-253514` / 20-F | Equity shares versus NYSE ADS | `REQUIRES_FILING_CONTEXT` | No | ADS/ordinary basis |
| Arm (`0001973239`) | `dei:EntityCommonStockSharesOutstanding` | `1064055252` | 2026-03-31 | shares | `0001973239-26-000097` / 20-F | Ordinary shares versus ADS; same-date balance-sheet value also differs | `REQUIRES_FILING_CONTEXT` | No | ADS/ordinary and filing context |

## Typed contract and official interface

`SecOsEligibleCandidate` preserves issuer CIK, exact shares string, `asOf`,
accession, form, filed date, ledger `acceptedAt`, taxonomy/concept/unit,
CompanyFacts source kind/context, every source key/path/raw ID, filing-ledger raw
source ID, extraction status, and null rejection reason.

`SecOsRejectedObservation` preserves whatever exact fields passed validation,
plus `REQUIRES_FILING_CONTEXT` or `UNAVAILABLE` and one explicit reason.
`SecOsExtractionResult` returns deterministic `candidates` and `rejected`
arrays with a summary status. A safe candidate may coexist with rejected older
observations; any same-date conflict removes the affected candidate.

- `extractCompanyFactsOs({ cik, facts, filings })` is the pure deterministic
  contract and supports fixture/injected replay.
- `readOsCandidates(repository, cik)` is the official reader. It calls the
  existing `readFacts` interface for the exact DEI candidate and US-GAAP
  escalation concepts and joins `readFilings`; it performs no write.

## Audit and mutation counts

- Successful direct public SEC HTTP calls: 12 (five CompanyFacts, six
  Submissions including one exact NeoMedia provenance recheck, and one Alphabet
  filing document). Requests were sequential and rate-limited; contact headers
  were not printed or committed.
- Large SEC payloads committed: 0.
- Local DB writes/backfills/migrations: 0.
- LLM/Gemini calls: 0.
- Local DB read result: the configured local listener was audited inside a
  `READ ONLY` transaction and rolled back. The three Foundation tables and
  constraints match migration `20260821140512`; all three tables currently
  contain zero rows, so issuer observation content came from official SEC
  sources and deterministic injected fixtures rather than local data.
