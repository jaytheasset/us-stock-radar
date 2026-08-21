# SEC Authoritative O/S Extraction V1

This contract combines the existing CompanyFacts O/S discovery candidates with
the complete filing-level IXDS/XBRL context reader. It returns a deterministic
per-filing decision only. It does not select current O/S, persist Share Count
History, normalize split history, calculate dilution, or use an LLM.

## Status contract

The only statuses are:

- `ELIGIBLE`: one filing fact satisfies every value, unit, identity, context,
  security-class, and provenance gate below.
- `REQUIRES_FURTHER_CONTEXT`: the filing facts are structurally available but
  an aggregate/class, foreign ordinary/ADS, conflict, or equivalent semantic
  choice remains.
- `UNAVAILABLE`: required lineage or structure is missing/broken, the numeric
  fact is malformed, the unit is not resolved as XBRL shares, or the exact
  CompanyFacts-to-filing value link fails.

`authoritative-os-extraction-v1` is the decision version. There is no
confidence score and no ticker, company-name, exchange, fame, or unit-only
class inference.

## Exact `ELIGIBLE` definition

All of the following are required:

1. The input is an existing `SecOsFilingContextCandidate` returned by
   `extractCompanyFactsOs()` or `readOsCandidates()`.
2. `readOsCandidateFilingContexts()` successfully parses the complete primary
   IXDS or the single filing instance and reports no rejected relevant fact.
3. CIK, accession, concept, instant/as-of, filing document, and raw artifact
   lineage match exactly. The filing context entity identifier must normalize
   to the candidate CIK under the SEC CIK scheme.
4. The filing fact's unit resolves through the filing unit table to
   `xbrli:shares`; a `unitRef` spelling such as `shares` or `U_shares` alone is
   not evidence.
5. The filing numeric lexical value is transformed only by a supported exact
   Inline XBRL numeric transform plus explicit `scale`/`sign`. The resulting
   positive integer string must equal the exact CompanyFacts integer string.
6. The concept is exactly
   `dei:EntityCommonStockSharesOutstanding`. A
   `us-gaap:CommonStockSharesOutstanding` balance-sheet fact is preserved but
   is not promoted by this contract.
7. The form is a domestic periodic `10-K`, `10-K/A`, `10-Q`, or `10-Q/A`.
   Form is only a gate; it is never authority by itself.
8. Security identity is mechanically established by one of these shapes:
   - exactly one DEI fact at the candidate instant in the complete filing set,
     in the required context with zero dimensions (`SINGLE_COMMON_STOCK_CLASS`);
   - class facts only, each with exactly one explicit
     `StatementClassOfStockAxis`, and exactly one class fact whose exact value
     matches the candidate (`CLASS_SPECIFIC_COMMON_STOCK`). The exact axis and
     member QNames are the class identity.
9. There is no CompanyFacts same-date conflict, filing fact conflict,
   aggregate-plus-class mixture, unsupported dimension, or unresolved
   amendment relation used to pick a winner.

An eligible output preserves the CompanyFacts lexical integer and lineage,
filing lexical integer, as-of, class identity/evidence, accession, form,
document, filed/accepted timestamps, taxonomy/concept, fact key, contextRef,
full context/dimensions, filing URL/hash, filing-ledger raw ID, and the decision
reason/version.

## Single class

The positive evidence is the DEI cover O/S concept in the sole complete filing
required context, not the absence of another CompanyFacts row. This distinction
is why AAPL can be eligible only after complete filing parsing. A second fact,
an unsupported dimension, a broken relevant fact, or a value mismatch closes
the gate.

## Multiple classes and aggregate facts

Every filing fact is retained separately. Standard class-axis members retain
their exact member QName. An axis-free aggregate and Class A/B/C facts may
coexist, as in Alphabet. The resolver never sums facts and never adds an
aggregate to its class components. A `us-gaap` aggregate, an
aggregate-plus-class set, or more than one exact matching class remains
`REQUIRES_FURTHER_CONTEXT`.

This V1 produces an issuer/filed-fact observation. It does not map a ticker to
a class. Multiple tickers under one CIK therefore do not create authority.

## Ordinary shares, ADSs, and ADRs

Foreign forms `20-F`, `20-F/A`, `40-F`, `40-F/A`, `6-K`, and `6-K/A` can
provide structurally valid facts, but V1 returns
`REQUIRES_FURTHER_CONTEXT`. The current filing-context foundation preserves
title facts and raw documents but has no typed depositary ratio relation. Code
does not parse a prose title to infer or calculate an ADS ratio. Wipro and Arm
therefore remain fail-closed even when the filing text describes a one-to-one
relationship.

Preferred stock, mandatory convertible preferred stock, depositary shares for
preferred stock, debt, issued/authorized shares, treasury shares, weighted
average shares, and custom/text substitutes are not eligible O/S concepts.

## Forms, amendments, and conflicts

- `10-Q` and `10-K` can support eligibility only through the complete evidence
  gates.
- `/A` filings remain separate per-accession observations. An amendment does
  not automatically supersede an original, and this interface returns no
  chronological winner.
- Foreign reports remain at the ordinary/ADS boundary above.
- Registration statements and prospectuses are not CompanyFacts O/S candidate
  forms in V1. A value mentioned there is not promoted through a parallel
  parser.
- Same-as-of values are separated by context and dimensions. Different values,
  concepts, aggregate/class shapes, or rejected relevant facts produce no
  winner.

## Official interfaces

- `resolveAuthoritativeOsFromFiling(linked)` is the pure deterministic
  decision function over the official filing-context reader result.
- `readAuthoritativeOsCandidates({ structuredRepository,
  filingXbrlRepository, cik })` calls `readOsCandidates()` and then the official
  filing-context reader for every candidate. It performs reads only.

The eligible `authoritative` object is the typed handoff for a later Share Count
History task. That later task must still define observation persistence,
current-O/S selection, amendment supersession, split basis, and ticker/class
selection. None is implemented here.

## Five-issuer acceptance audit

The small audit fixture is
`lib/sec-structured-data/fixtures/authoritative-os-five-issuer-audit.json`.
It records official SEC URLs and full-document SHA-256 values without
committing full filings.

| Issuer | Candidate and filing fact | Class evidence | Decision |
| --- | --- | --- | --- |
| AAPL | DEI `14594180000`, filing `14,594,180,000`, 2026-07-17, `c-9` | sole zero-dimension DEI required context | `ELIGIBLE` |
| Alphabet | US-GAAP aggregate `12230000000` plus Class A/B/C contexts | aggregate and three exact `StatementClassOfStockAxis` members | `REQUIRES_FURTHER_CONTEXT` |
| Wipro | DEI `10488412458`, filing equity-share fact | ordinary/equity versus ADS ratio is not typed | `REQUIRES_FURTHER_CONTEXT` |
| Arm | DEI `1064055252`, filing ordinary-share fact; same-date US-GAAP conflict | ADS title/raw evidence exists, but conflict and ratio contract remain | `REQUIRES_FURTHER_CONTEXT` |
| NeoMedia | DEI `4984827279`, instance fact, 2013-08-02 | sole zero-dimension DEI required context in a distinct 10-Q/A accession | `ELIGIBLE` |

The fixture is audit data only. Production code contains no issuer, CIK,
ticker, document, value, or member hardcode.

## Mutation boundary

- Database writes, backfills, migrations, schema changes: 0
- LLM/Gemini calls: 0
- Share Count History/current resolver/Level 2/split/dilution operations: 0
- Full SEC filings committed: 0
