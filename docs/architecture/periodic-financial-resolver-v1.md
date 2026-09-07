# Periodic Financial XBRL Deterministic Resolver V1

This resolver is a pure, accession-scoped read boundary for five monetary
metrics:

- Revenue
- Operating Income/Loss
- Net Income/Loss
- Operating Cash Flow
- Cash

The resolver itself does not integrate with Monitor or Stock Detail, replace
FMP, run SEC ingest, write a database row, call an LLM, calculate a missing
value, or add a schema. The implementation is
`lib/sec-structured-data/periodicFinancialResolver.ts`.

Cross-accession quarterly and annual history is a separate pure composition
layer documented in
[`periodic-financial-history-v1.md`](periodic-financial-history-v1.md). It calls
this resolver for every explicit target accession and does not weaken this
resolver's evidence or currentness gates.

## Generic Monitor integration

After the existing periodic Primary analysis is persisted, published, and its
existing alert path completes, production enqueues one deterministic Generic
Monitor child for `10-Q`, `10-K`, `20-F`, and `40-F` families (including their
amendment forms). The child reads the already stored filing ledger,
CompanyFacts, and filing-XBRL artifacts, invokes this resolver, and writes one
structured `periodic_financial_monitor_analysis_v1` result in the existing
Generic Monitor `ai_runs`/`ai_outputs` envelope. It adds no table or migration.

The child identity is bound to the event, raw filing, accession source
identity, analyzer key, and analyzer contract, but not to a particular Primary
GPT run. Replaying the same filing therefore reuses the same job and output.
The exact Primary run remains lineage evidence; its narrative is neither an
input to financial normalization nor rewritten by it. A missing or rejected
financial source produces unavailable metric decisions without changing the
Primary event or its analysis.

Before any stored SEC read, the child requires its deterministic source
accession, the exact raw row `source_unique_id`, and
`raw_payload.accession_number` to agree. The raw issuer CIK and periodic form
then become the expected result identity. Immediately before terminal output
persistence, the normalized analysis target and resolver filing must match
that accession, CIK, and form. A mismatch releases the existing job for retry
and writes no terminal output, so another filing cannot occupy the job's
deterministic result identity.

`lib/monitor/periodicFinancialMonitor.ts` derives only an exact decimal delta
and deterministic direction from resolver-approved current/prior pairs.
Income/loss directions are `IMPROVED`/`WORSENED`; Revenue, OCF, and Cash use
`INCREASED`/`DECREASED`. It emits no percentage, estimate, quarter-from-YTD
subtraction, or cross-accession fallback. Exact resolver evidence retains the
currency, unit, accession, context, artifact, document URL/hash, CompanyFacts
source key/path, and rejected dimensional fact keys.

## Existing foundations reused

The resolver consumes only existing source-backed structures:

1. `sec_filing_ledger` identity represented by `SecFilingRow`;
2. exact `sec_company_facts` entries represented by `SecCompanyFactRow`;
3. `SecFilingXbrlDocumentSetResult` from the existing filing-level XBRL
   artifact, context, dimension, unit, and fact parser.

CompanyFacts preserves the exact SEC decimal, unit, period, accession, form,
filed date, taxonomy/concept, raw-source ID, and JSON source path. Filing XBRL
adds the exact namespace-qualified concept, lexical value tree, transformation
attributes, resolved unit, context ID, entity identity, instant/duration,
every dimension, accession document URL/name/hash, and raw artifact identity.

The SEC describes CompanyFacts as non-custom-taxonomy facts applying to the
entire filing entity. It does not preserve the filing context, dimensions,
primary-statement role, or issuer extensions. CompanyFacts is therefore an
exact entity-wide value/accession anchor, not a substitute for filing XBRL and
not positive proof that the word “consolidated” applies. The resolver reports
accepted facts as `UNDIMENSIONED`; it never changes that status to
`CONSOLIDATED` merely because dimensions are absent.

Official API reference:
<https://www.sec.gov/search-filings/edgar-application-programming-interfaces>

## Exact resolution contract

The caller supplies an issuer CIK, one explicit target accession, the bounded
filing-ledger family, CompanyFacts rows, one parsed filing XBRL document set,
and optional reviewed issuer-extension mappings. The result is versioned as
`periodic-financial-resolver-v1` and declares `gptDependency: false`.

A result is eligible only when all of the following agree exactly:

- issuer and target accession;
- every selected filing fact's CIK, accession, document URL, content hash, and
  source metadata must exactly match one source registered in the filing XBRL
  document set;
- filing-ledger form and CompanyFacts form;
- taxonomy and local concept;
- filing concept namespace;
- ISO 4217 currency measure and CompanyFacts unit;
- exact instant or exact start/end duration;
- exact filing numeric value after the declared Inline XBRL transform and
  CompanyFacts decimal;
- current/prior metric definition, currency, period basis, and
  un-dimensioned state.

The output keeps the complete matching filing facts and CompanyFacts rows.
Exact duplicate occurrences can therefore collapse into one observation
without losing any fact key, context, document, hash, raw-source ID, or source
path. No duplicate silently overwrites another.

## Standard concept allowlist

Each listed concept remains an exact identity. The resolver does not treat
multiple alternatives as a priority list. If more than one mapped concept
competes for the same metric and basis, it returns
`MULTIPLE_METRIC_CONCEPTS`.

| Metric | US-GAAP | IFRS |
| --- | --- | --- |
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`, `SalesRevenueNet` | `Revenue` |
| Operating Income/Loss | `OperatingIncomeLoss` | `ProfitLossFromOperatingActivities` |
| Net Income/Loss | `NetIncomeLoss` | `ProfitLoss` |
| Operating Cash Flow | `NetCashProvidedByUsedInOperatingActivities` | `CashFlowsFromUsedInOperatingActivities` |
| Cash | `CashAndCashEquivalentsAtCarryingValue` | `CashAndCashEquivalents` |

The taxonomy actually used controls eligibility. A `20-F` may validly use
US-GAAP, and a `40-F` may validly use IFRS. Form never substitutes for taxonomy
evidence.

The resolver deliberately excludes restricted-cash aggregates, continuing-
operations subsets, bank-specific net-revenue concepts, owner-attributable
subsets, subtotals, and similar concepts. It never sums components or derives
one metric from another.

## Numeric representation

The filing lexical value and the exact CompanyFacts decimal are both retained.
The resolver supports only deterministic decimal forms already observed in
the accepted samples:

- plain or `num-dot-decimal` / `numdotdecimal`;
- `num-comma-decimal` / `numcommadecimal`;
- `fixed-zero`;
- integer Inline XBRL `scale` and explicit `sign`.

It performs exact decimal-point movement using strings. It does not pass the
value through a JavaScript number, estimate precision, round, or reinterpret an
unknown transform. Parenthetical negative formats and other unimplemented
transforms return `FILING_FACT_VALUE_UNSUPPORTED`.

## Period basis

Cash is always an instant. A cash fact with a duration is unavailable.

Annual duration facts require an annual form, one exact CompanyFacts `FY`
identity, and a 330–400 day exact duration. A prior-year pair requires the same
concept/currency and a duration within seven days of the current duration, with
period ends 350–380 days apart.

For `10-Q` duration facts:

- a duration no longer than 120 days requires one SEC quarter frame and is
  `QUARTER`;
- Q1 is explicitly `QUARTER_AND_YEAR_TO_DATE` because the exact duration has
  both identities;
- a longer duration up to 320 days, with the same quarterly fiscal-period
  identity and no quarter frame, is `YEAR_TO_DATE`;
- any other duration is `PERIOD_BASIS_AMBIGUOUS`.

These gates combine the exact context dates, form, fiscal-period metadata, and
SEC frame. An end date alone never classifies a duration. No quarterly value is
subtracted from YTD, and no annual/quarter/YTD values are mixed. QoQ is outside
V1.

A prior-year comparison is same-accession only in V1. This preserves the
restated comparative exactly as filed. If the true prior-year instant is only
in another filing, the current cash observation may resolve but its comparable
is explicitly `PRIOR_YEAR_COMPARABLE_NOT_FOUND`. Cross-accession restatement
and cash comparison are deferred to a separately reviewed contract.

## Dimensional and currency boundaries

V1 never selects, sums, or infers an entity-wide amount from dimensional
facts. A supported concept found only with dimensions returns
`DIMENSIONAL_FACT_REJECTED`. When an exact un-dimensioned fact resolves, all
rejected dimensional fact keys remain visible on the decision.

Currencies are separate identities. A USD current fact never pairs with an
INR, CAD, EUR, or other prior fact. When a filing supplies more than one
eligible currency for the same current metric/basis, there is no implicit
reporting-currency priority; the result fails closed rather than choosing.

## Amendments and duplicates

The target accession is always explicit. Currentness is evaluated only inside
the exact issuer, base form, and report-date family:

- one original filing with no amendment is current;
- an amendment requires exactly one original accession in the supplied ledger
  family;
- acceptance time alone never makes an amendment authoritative;
- a versioned reviewed filing-selection record must bind issuer, base form,
  report date, selected accession, and every superseded accession;
- without that record, an original/amendment family returns
  `AMENDMENT_CURRENTNESS_REQUIRES_REVIEW`;
- multiple original accessions for one base form/report date are a duplicate
  filing ambiguity;
- targeting an accession superseded by the reviewed record returns
  `TARGET_SUPERSEDED_BY_REVIEWED_AMENDMENT`.

An amendment is still a separate accession. It must contain its own eligible
CompanyFacts and filing-XBRL evidence. Missing amendment facts never inherit or
copy values from the original filing.

Within an accession, exact-equal filing occurrences collapse only after
concept, context period, unit, transformed value, and metric identity agree.
Every occurrence remains in evidence. Materially conflicting filing or
CompanyFacts duplicates return an explicit conflict.

## Issuer extensions

Names and labels never auto-map an issuer extension. A mapping must be
versioned as `periodic-financial-reviewed-concept-v1` and bind all of:

- review ID and timestamp;
- issuer CIK;
- V1 metric;
- exact extension namespace URI, taxonomy name, and local concept;
- one same-metric standard concept used as the reviewed equivalence target.

Cross-issuer rules, standard namespaces masquerading as extensions, and
cross-metric equivalence are invalid. The exact CompanyFacts link remains
required. Because the SEC CompanyFacts endpoint generally excludes custom
taxonomy facts, real issuer extensions ordinarily remain unavailable in V1
even with a plausible name. This is deliberate: an extension cannot bypass the
exact raw-source anchor. A future extension-capable path must add a reviewed
filing-statement/equivalence evidence contract, not a fallback calculation.

## Official acceptance audit

The committed fixture is
`lib/sec-structured-data/fixtures/periodic-financial-four-form-audit.json`.
It contains minimal official Apple and Wix observations plus an explicitly
synthetic IFRS `40-F` contract sample. Full SEC bodies are not committed, and
the synthetic sample is not evidence for Toronto-Dominion Bank or any other
real issuer.

### Apple 2026 Q3 10-Q

Accession `0000320193-26-000020`, official filing:
<https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm>

- Revenue, operating income, and net income have distinct current/prior
  quarter and current/prior YTD contexts.
- Operating cash flow has YTD only. The resolver does not manufacture a
  quarter value.
- Cash at `2026-06-27` resolves as an instant. The same filing's
  `2025-09-27` cash is prior fiscal year-end, not a prior-year comparable.
- Segment facts with two dimensions are rejected while their fact keys remain
  visible.

### Apple 2025 10-K

Accession `0000320193-25-000079`, official filing:
<https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm>

All four duration metrics resolve as annual current/prior pairs. Cash resolves
as current/prior instants. No duration or instant is converted into the other.

### Wix 2025 20-F

Accession `0001628280-26-015222`, official filing:
<https://www.sec.gov/Archives/edgar/data/1576789/000162828026015222/wix-20251231.htm>

The issuer uses US-GAAP for this `20-F`. All five USD metrics resolve using the
actual US-GAAP concepts. The resolver does not infer IFRS from the form and
does not use ADS/ordinary-share information for monetary metrics.

### Toronto-Dominion Bank 2025 40-F

Accession `0001562762-25-000289`, official filing index:
<https://www.sec.gov/Archives/edgar/data/947263/000156276225000289/0001562762-25-000289-index.html>

IFRS revenue, profit/loss, operating cash flow, and cash resolve in CAD.
Operating income remains unavailable because the supported standard concept is
absent. Cash occurs identically in two IXDS documents; both document URLs and
hashes are retained. No duplicate is overwritten.

This case is not reconstructed from tuples in the committed fixture. Run
`npm run verify:periodic-financial-history:td-official` to fetch the official
SEC Submissions and CompanyFacts JSON plus the filing inventory and exact IXDS
bodies. The production parser consumes the complete official IXDS
(`40f20251031.htm`, `ex992.htm`, and `ex993.htm`) before the resolver and
history layer run. `ex993.htm` alone is not a valid parser fixture because its
facts depend on contexts and units supplied by the IXDS set.

### Coverage negatives

The read-only audit also confirmed:

- Wipro `20-F` `0000950170-25-076303` contains current-year INR and USD
  translations but prior comparables only in INR. A USD/INR pair is invalid.
- Barrick `40-F` `0001193125-26-079253` has standard IFRS evidence for four
  metrics but no standard annual operating-profit fact. Its issuer extension
  is not automatically equivalent to operating income.
- bank-specific revenue and cash gaps remain unavailable; no bank formula is
  introduced.

## Next-metric contract review (not implemented)

The independent review recommends this order:

1. **Gross Profit** — safe next candidate for exact
   `us-gaap:GrossProfit` / `ifrs-full:GrossProfit`, monetary duration only.
   Never calculate revenue minus cost.
2. **Assets** — safe next candidate for exact `us-gaap:Assets` /
   `ifrs-full:Assets`, monetary instant only.
3. **Liabilities** — safe next candidate for exact `us-gaap:Liabilities` /
   `ifrs-full:Liabilities`, monetary instant only. Never calculate assets minus
   equity or use liabilities-and-equity.
4. **EPS** — not one generic metric. It must split into basic and diluted,
   require a resolved currency-per-share divided unit, exact duration, and an
   explicit ordinary-share versus ADS basis for foreign issuers.
5. **Equity** — not one generic metric. Parent-attributable equity and total
   equity including noncontrolling interests must remain separate identities.

Gross Profit, Assets, and Liabilities can use the same exact-link machinery.
EPS and Equity require the identity split before implementation.

## Verification boundary

Focused tests cover:

- official 10-Q, 10-K, and 20-F fixture cases;
- the live official TD 40-F parser-to-resolver-to-history case;
- quarter/YTD/annual/instant isolation;
- current/prior like-for-like matching;
- dimensional rejection;
- currency mismatch;
- exact and conflicting CompanyFacts duplicates;
- identical and conflicting filing facts;
- amendment and duplicate filing currentness;
- issuer-extension review gates;
- exact numeric transforms;
- deterministic replay under reordered input;
- no GPT dependency.

No migration, table, route, UI, scheduler, source run, or backfill is part of
the resolver. Its Generic Monitor consumer uses only the existing Generic
Monitor execution/output persistence envelope.
