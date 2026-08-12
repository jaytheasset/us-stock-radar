# Ownership Monitor V1 Architecture

> **Authority.** This document is the authoritative architecture reference for Ownership Monitor V1. Read this document before modifying Form 4/Form 144 source preparation, Ownership Analysis semantics, typed Monitor facts, or downstream Ownership behavior.
>
> If this document and the implementation disagree, audit the current code, migrations, and tests first and correct the document or implementation according to the approved architecture. An approved architecture change must update the code and this document together.

## Mental model

```text
SEC Form 4 / Form 144 filing package
        ↓
XML-first source preparation
        ↓
Structured raw ownership evidence
        ↓
Primary Ownership Analysis LLM
        ↓
Validated ownership_monitor_facts_v1
        ↓
Typed event ownership persistence / downstream use
```

`XML-first` does not mean `XML-only`. A usable SEC Ownership XML document is the primary structured source; HTML or text is a lower-confidence fallback. The parser owns deterministic source selection and structural extraction. The Ownership Analysis LLM owns economic semantics. Validated Analysis facts, not parser semantic outputs, are the canonical input to typed Ownership persistence.

Ownership currently has no Offering-style asynchronous Stage-2 Monitor Normalizer:

```text
Ownership: XML source preparation → Primary Ownership Analysis → validated typed Monitor facts
Offering:  Primary Analysis → asynchronous Stage-2 Offering Monitor Normalizer → canonical state
```

Stage count is domain-specific. Do not add an Ownership Stage 2 solely to make the two domains look alike.

## Implementation landmarks

| Responsibility | Current implementation |
| --- | --- |
| SEC document discovery and raw source preservation | `lib/sources/sec/parser.ts` |
| Ownership fetch requirements | `lib/sources/sec/forms/ownership/fetchPlan.ts` |
| Form 4 and Form 144 structural parser | `lib/sources/sec/forms/ownership/parser.ts` |
| Direct Ownership Analysis input and semantic contract | `lib/sources/sec/forms/ownership/analysisPrompt.ts` |
| Runtime prompt, output schema, and validation | `lib/ai/secOwnershipAnalysisAdapter.ts` |
| Typed Analysis fact contract | `lib/monitor/ownershipAnalysisFacts.ts` |
| Typed row construction and persistence call | `lib/monitor/persistence.ts` |
| Production event/persistence caller | `lib/secStores/eventStore.ts` |
| Condition capability registry | `lib/monitor/conditionRegistry.ts` |
| Existing score-alert execution | `lib/secFilingAnalysisIngest.ts`, `lib/alerts/delivery/*` |

## SEC document inventory and raw XML preservation

The SEC ingestion layer starts from the filing detail/index document list. `selectDocumentsForText()` always selects the primary document and, for Forms `4`, `4/A`, `144`, and `144/A`, additionally selects XML document candidates. `isOwnershipXmlDocumentCandidate()` requires an `.xml` document or URL and excludes SEC XSL-rendered URLs matching `/xslF345` or `/xsl144`. The Ownership fetch plan independently requests canonical XML candidates with `preserveRawText: true` and allows a small explanatory-exhibit supplement.

For each fetched document, the raw ingest item preserves document inventory metadata in `raw_payload.documents`, including:

- sequence, description, SEC document name, type, size, URL, and primary-document identity;
- cleaned-text counts and truncation state;
- raw-text/raw-HTML counts, preservation flags, formats, and truncation state; and
- fetch and extraction status/error fields.

For the selected ownership source, raw ingest also stores:

- `raw_payload.accession_number`;
- `raw_payload.ownership_source_url`;
- `raw_payload.ownership_source_format`;
- `raw_payload.ownership_source_text`;
- `raw_payload.ownership_source_text_char_count`; and
- `raw_payload.ownership_source_text_truncated`.

`buildOwnershipRawSource()` recognizes an `ownershipDocument` or `edgarSubmission` root as `ownership_xml`; an XML candidate with a generic XML/SEC wrapper can be retained as `raw_xml`. The selected raw Ownership source is capped at 500,000 characters, and the truncation flag is authoritative for that limitation. The parser later keeps only a 1,200-character `raw.source_excerpt`; that excerpt is not the raw-source preservation boundary.

The inventories have different purposes:

- `raw_payload.documents` is the SEC filing-package document inventory.
- `raw_payload.ownership_source_text` is the selected preserved raw Ownership source.
- parser `facts.source_inventory` is a compact structural count/status summary for Analysis; it is not a copy of the full SEC document inventory.

The parser summary's `attachment_inventory` is currently an empty array. Consumers that need the filing-package inventory must use the preserved raw item rather than infer document availability from that parser field.

No separate canonical XML table or normalized extraction cache is part of V1. The existing raw item and its document inventory are the storage boundary.

## Source selection contract

### Candidate collection order

`selectOwnershipSource()` collects candidates in this order:

1. `raw_payload.ownership_source_text`
2. `metadata.ownership_source_text`
3. attachments, in supplied order
4. `filingText`
5. `primaryDocumentText`
6. `text`

Selection then applies format precedence across the collected candidates:

1. the first well-formed `structured_xml` candidate;
2. otherwise the first non-XML, non-malformed HTML/text fallback;
3. otherwise the first malformed XML candidate for limited extraction;
4. otherwise empty input.

A candidate is `structured_xml` when it contains an `ownershipDocument` or `edgarSubmission` open root and the corresponding closing root, without an obviously unterminated tag. This is a lightweight structural check, not XSD validation.

### Exact source statuses

| Selected state | `facts.filing.source_status` | Confidence | Meaning |
| --- | --- | --- | --- |
| Well-formed recognized root | `structured_xml_selected` | `high` | XML is the selected structured source. |
| XML malformed, usable fallback exists | `fallback_after_malformed_xml` | `low` | HTML/text fallback wins over malformed XML. |
| XML absent, usable fallback exists | `fallback_missing_xml` | `low` | HTML/text is used because no structured XML was found. |
| Only malformed XML is available | `malformed_xml_limited_extraction` | `low` | Best-effort extraction runs on malformed source. |
| No candidate | `empty` | `low` | No source text is available. |

`facts.filing.source_format` is `structured_xml`, `legacy_html`, or `text_excerpt`. `raw.source_selection` records candidate count, selected role/format/confidence/URL/description/filename, XML availability, fallback use, malformed-candidate count, and available source roles.

A well-formed structured candidate always beats HTML/text, even if it appears later in candidate order. Conversely, malformed XML never beats an available non-malformed fallback. XSL-rendered HTML may still serve as fallback; its exclusion applies to canonical XML candidacy, not to all fallback use.

## Form 4 XML-first flow

```text
SEC filing index/detail
  → primary/XSL-rendered document plus raw ownership XML are discovered
  → raw XML and document identity are preserved on the raw item
  → supported form and selected source are classified
  → ownershipDocument structure is extracted
  → compact structured evidence is passed to Ownership Analysis
```

For Forms `4` and `4/A`, `parseOwnershipFiling()` extracts source structure without netting transaction rows:

- issuer name, CIK, trading symbol, and supplied exchange;
- every `reportingOwner`, its identity, relationship booleans, role list, officer title, and address;
- ordered non-derivative and derivative transaction arrays;
- ordered non-derivative and derivative holdings;
- security title, transaction date, deemed execution date, raw transaction code, raw A/D code, equity-swap flag, and timeliness fields;
- shares, price, post-transaction holdings, direct/indirect ownership, and nature of ownership;
- derivative conversion/exercise price, exercise date, expiration date, underlying security title, and underlying units;
- filing-level `aff10b5One`, `notSubjectToSection16`, remarks, signatures, and footnotes; and
- amendment comparison data only when an original filing was supplied locally.

Transaction rows remain separate and retain `transaction_kind`. Conversion or exercise rows are not merged with related common-stock rows. Multiple securities and multiple transactions remain distinct.

Multiple reporting owners are preserved in `facts.reporting_owners`. The XML model and current parser associate that owner set with the filing; the parser does **not** create a stable per-transaction owner foreign key. Typed persistence currently writes the filing's aggregated reporting-owner names and roles on each Form 4 row. Do not claim a more precise owner-to-row mapping than the source/parser actually provides, and do not collapse the owner array to only the first owner.

## Form 144 namespaced XML-first flow

```text
SEC filing index/detail
  → primary/XSL-rendered document plus edgarSubmission XML are discovered
  → raw XML and document identity are preserved on the raw item
  → namespace-tolerant edgarSubmission tags are selected
  → securitiesInformation, securitiesToBeSold, and
    securitiesSoldInPast3Months rows are extracted independently
  → raw units, numbers, descriptions, dates, remarks, and footnotes
    are passed to Ownership Analysis
```

The XML tag matcher accepts an optional namespace prefix on every known tag, so namespaced Form 144 XML such as `ns2:edgarSubmission` and common-address namespace tags is supported without stripping the namespace first.

For Forms `144` and `144/A`, the parser preserves:

- submission type, prior accession, seller/account-person name, seller address, and issuer relationships;
- every `securitiesInformation` proposed-sale row, including security class, broker/market-maker details, proposed units, aggregate market value, units outstanding, approximate sale date, exchange, and footnote links;
- every `securitiesToBeSold` acquisition lot, including acquisition/payment dates, acquisition/payment descriptions, source person, gift boolean, amount, and footnote links;
- every `securitiesSoldInPast3Months` row, including seller, security class, sale date, amount, gross proceeds, and footnote links;
- the explicit no-prior-sales indicator, notice date, plan-adoption dates, detected instruction dates, and remarks; and
- amendment fields and locally supplied parent comparison when available.

Form 4 and Form 144 are separate source schemas. Do not flatten them into one giant parser schema or describe a Form 144 proposed sale as an executed Form 4 transaction.

## Row, field, footnote, and missing-value structure

### Row preservation

The parser preserves source row boundaries for:

- non-derivative transactions;
- derivative transactions;
- non-derivative and derivative holdings;
- Form 144 proposed sales;
- Form 144 acquisition lots; and
- Form 144 prior-three-month sales.

Rows are not netted, deduplicated, or merged before Analysis. Source order is retained within each array. Form 4 non-derivative rows are emitted before derivative rows because they are collected as separate XML table groups.

### Footnotes

The parser preserves three complementary forms of footnote structure:

- row-level `footnote_ids`;
- field-level `field_footnote_ids`, keyed by the SEC field name; and
- the exact filing-level `facts.footnotes` map from footnote ID to text, plus `footnote_order`.

`facts.footnote_diagnostics` records linked IDs, unresolved references, and orphan footnotes. This applies to Form 4 transactions/holdings and to Form 144 proposed-sale, acquisition, prior-sale, and broker/market-maker structures.

Footnotes can change the meaning of a gift, exercise/conversion, mixed transaction, 10b5-1 status, derivative relationship, price, or ownership nature. The parser must preserve the link; Analysis must interpret the economic meaning.

### Null, zero, false, and footnote-only values

Missing values are never coerced to numeric zero. Numeric extraction retains the raw text, parsed value, and an exact status:

| State | Numeric status |
| --- | --- |
| Field absent and no fallback number | `missing` |
| Field present but blank | `blank` |
| Field present only through footnote reference | `footnote_only` |
| Explicit numeric zero | `zero` |
| Parsed non-zero number | `numeric` |
| Explicit N/A, none, various, or “see footnote” | `not_applicable`, `none`, `various`, `see_footnote` |
| Other text, with or without footnote | `text`, `text_with_footnote` |

Date fields similarly retain `missing`, `footnote_only`, `date`, `not_applicable`, `none`, `various`, `see_footnote`, `text`, or `text_with_footnote`. Form 144 prior-sales summary additionally distinguishes `none_reported`, `reported_rows`, and `missing_or_blank`.

Boolean parsing preserves `true`, `false`, and unavailable `null`. In particular, explicit `aff10b5One=false`, relationship flags, gift flags, and the no-prior-sales flag must not be turned into null merely because they are false.

## Parser responsibility versus Analysis responsibility

| Parser: structural evidence | Ownership Analysis LLM: semantic truth |
| --- | --- |
| Source selection, form/root recognition, raw tags, row boundaries | Economic direction: `buy`, `sell`, `other`, or `unknown` |
| Raw transaction code and raw A/D marker | Whether a gift, exercise, conversion, or mixed row is economically significant |
| Security and underlying-security descriptions | Whether security/unit bases are comparable |
| Exact numeric text/value/status | Form 144 numerator/denominator comparability and normalization decision |
| Owner/relationship fields | Row-level 10b5-1 meaning when the complete evidence is considered |
| Footnote IDs, text map, remarks, signatures | Complex multi-leg and derivative relationships |
| Raw dates and date status | Investor-facing Calendar importance and event semantics |
| Warnings and safety/completion diagnostics | Event title, narrative, score, signal, and Monitor semantic facts |

The production Ownership path is `ownership_direct_analysis`; there is no router LLM and no deterministic final-Analysis bypass. The runtime system instruction explicitly forbids parser-generated facts, signals, routing hints, labels, and safety classifications as Analysis authority.

`buildOwnershipAnalysisInput()` enforces the boundary. It sends compact structural evidence such as raw transaction/A-D codes, numeric value/text/status, security descriptions, footnote links/text, remarks, and row excerpts. It deliberately does not send parser `transaction_code_meaning`, `transaction_category`, `transaction_value`, or `proposed_sale_percent_of_shares_outstanding` as Analysis facts.

Raw code is evidence, not an economic action. For example:

```text
transactionCode = P
acquiredDisposedCode = A
```

does not by itself authorize `economic_direction = buy`. Analysis must consider the complete row, security type, derivative structure, footnotes, remarks, and related evidence. New canonical code must not implement mappings such as `P → buy`, `S → sell`, `G → other`, or `M → buy`.

## Legacy parser semantic outputs

The current parser still contains compatibility-era semantic logic. Examples include:

- `transaction_code_meaning` and `transaction_category` mappings;
- `has_purchase`, `has_sale`, `has_gift`, and `has_conversion` summaries;
- `insider_purchase`, `insider_sale`, `insider_gift`, routine/archive, and other parser signals;
- parser score/routing/completion/safety classifications;
- parser-calculated Form 4 `transaction_value`; and
- parser-calculated `proposed_sale_percent_of_shares_outstanding` and Form 144 size/archive heuristics.

These values may still exist for compatibility, routing history, diagnostics, or legacy flow reasons, but they are **not authoritative Ownership Monitor semantic truth**. They must not become:

- a semantic source of truth;
- a canonical Monitor fact;
- a Matcher eligibility fact;
- a fallback when Analysis is missing or invalid; or
- a reason to bypass Ownership Analysis.

The current canonical path already excludes the critical legacy semantics from the compact Analysis evidence and sets persistence provenance to `canonical_input: "analysis_output.ownership_monitor_facts"` and `parser_fallback: false`. Their continued presence therefore does not redefine V1 truth. Removing them is a separate architecture cleanup and is not required to document or operate the current boundary.

## Ownership Analysis and typed fact contract

The Analysis adapter requires and validates `analysis_output.ownership_monitor_facts` with version `ownership_monitor_facts_v1`. Exactly one current form family is non-null; a successfully analyzed family with no supported rows uses an empty array rather than omitting the family object.

### Reporting owners

Both form families preserve an array of reporting-owner facts:

| Fact | Type / states | Semantic owner |
| --- | --- | --- |
| `name` | string or null | Analysis from source identity |
| `roles` | string array | Analysis, preserving every supported role |
| `is_officer`, `is_director`, `is_10_percent_owner` | true, false, or null | Analysis from source relationship evidence |
| `officer_title` | string or null | Analysis from source |
| `evidence` | non-empty strings array, possibly empty for an owner when no citation is available | Analysis |
| `confidence` | `high`, `medium`, `low`, or null | Analysis |

### Form 4 transaction facts

Each source transaction row becomes one Analysis fact with:

- `transaction_kind`, `security_title`, and `transaction_date`;
- raw `transaction_code` and raw `acquired_disposed_code`;
- semantic `economic_direction` (`buy`, `sell`, `other`, `unknown`);
- typed `shares`, `price_per_share`, and `post_transaction_shares` numeric facts;
- direct/indirect ownership and nature of ownership;
- row-level `is_10b5_1` (`true`, `false`, or `null`);
- `evidence`; and
- `confidence`.

Rows remain in source order and are not netted, aggregated, or deduplicated. Analysis does not calculate transaction value. Persistence may derive `shares * price_per_share` from validated typed numeric facts.

### Form 144 proposed-sale facts

Each proposed-sale row contains:

- `security_title`;
- typed `proposed_sale_shares` and `aggregate_market_value`;
- `proposed_sale_date` and `exchange`;
- typed `shares_outstanding`;
- the semantic `percent_calculation` decision;
- `evidence`; and
- `confidence`.

A proposed sale is not an executed transaction.

### Numeric availability and quality

Every typed numeric fact has:

| Field | Contract |
| --- | --- |
| `value` | non-negative finite number or null |
| `value_quality` | `exact`, `derived`, `estimated`, or `unknown` |
| `availability` | `available` or `unavailable` |

An available fact must have a number, including legitimate zero. An unavailable fact must be `{ value: null, value_quality: "unknown", availability: "unavailable" }`. A supplied number may be available with unknown quality. Validators detect violations; they do not calculate, correct, replace, or supply fallback Analysis values.

## Form 144 unit comparability and percentage

Parser mechanical division is legacy and non-authoritative because the numerator and denominator may describe different securities or units. Analysis must return, for each row:

- `comparable_units`: `true`, `false`, or `null`;
- raw `numerator_unit` and `denominator_unit` descriptions;
- optional `normalization_target` (`numerator` or `denominator`);
- optional positive `normalization_multiplier`;
- source-backed `source_relation` when normalization is used;
- decision `evidence`; and
- decision `confidence`.

Normalization is valid only when `comparable_units=true`, the source explicitly supplies the relation, a target and multiplier are both present, and evidence is non-empty. Issuer identity, ticker, accession, market convention, or code may not supply an ADS ratio.

Typed persistence deterministically calculates `proposed_sale_percent` only when:

1. `comparable_units === true`;
2. numerator and denominator are available;
3. the selected denominator is greater than zero;
4. both numeric qualities are comparison-eligible (`exact`, `derived`, or `estimated`); and
5. any normalization decision has already passed the Analysis fact validator.

Otherwise the percent is unavailable/null. The parser's `proposed_sale_percent_of_shares_outstanding` is never a fallback.

The PDD regression illustrates the boundary without creating a ticker rule: the proposed quantity is 1,533 ADS, the outstanding denominator is ordinary shares, and source text may describe one ADS as multiple ordinary shares. The parser preserves both raw bases and the relation text. Analysis decides whether the relation is sufficient and, if it is, supplies normalization. Persistence performs only the approved arithmetic.

## Typed persistence

Production event persistence identifies Ownership output only when `promptKey === "sec_ownership_analysis"`, reads `analysis.ownership_monitor_facts`, and calls `persistOptionalMonitorFoundation()` with `ownershipInputState: "known"`. A missing, failed, or non-Ownership Analysis is not promoted to known-empty, so it does not erase prior valid facts.

`persistOwnershipAnalysisFacts()` validates the complete fact object, constructs typed rows, and calls:

```text
replace_event_ownership_facts(
  p_event_id,
  p_form4_rows,
  p_form144_rows
)
```

The RPC atomically replaces both event-scoped tables:

- `public.event_form4_transactions`, keyed by `(event_id, transaction_index)`; and
- `public.event_form144_proposed_sales`, keyed by `(event_id, proposed_sale_index)`.

Important persisted Form 4 columns include owner arrays/roles, relationship flags, `is_10b5_1`, transaction kind/security/date, raw codes, `economic_direction`, shares/price/derived transaction value, post-transaction shares, direct/indirect ownership, nature, quality/availability fields, confidence, provenance, evidence, and calculation basis.

Important persisted Form 144 columns include seller/owner names, security/exchange/date, proposed units, aggregate value, outstanding units, comparability-gated derived percent, quality/availability fields, confidence, provenance, evidence, and calculation basis. `calculation_basis` retains the LLM comparability decision and any source-backed normalization relation.

Persistence provenance is:

```json
{
  "source": "sec_ownership_analysis",
  "schema_version": "ownership_monitor_facts_v1",
  "canonical_input": "analysis_output.ownership_monitor_facts",
  "parser_fallback": false
}
```

Typed Ownership persistence is production-wired through `saveAnalyzedSecFilingEvent()`. It is intentionally optional relative to event publication: failures are collected and logged by the Monitor foundation rather than rewriting or rolling back the already persisted Primary event.

## Matcher and production wiring status

There is no implemented Ownership-specific Matcher evaluator in the current repository. In particular, there is no Ownership equivalent of `evaluateOfferingMonitorConditions()` or `evaluateOfferingMonitorEvent()`.

What is implemented and tested is the condition capability registry. Current Ownership entries are:

| Condition key | Registry status | Typed source |
| --- | --- | --- |
| `ownership.form4.direction` | `READY` | `event_form4_transactions.economic_direction` |
| `ownership.form4.transaction_value` | `READY` | derived transaction value plus quality/availability |
| `ownership.form4.reporting_owner_role` | `READY` | `reporting_owner_roles` |
| `ownership.form4.is_10_percent_owner` | `READY` | relationship boolean |
| `ownership.form144.proposed_sale_value` | `READY` | aggregate value plus quality/availability |
| `ownership.form4.is_officer` | `PARTIAL` | typed row flag |
| `ownership.form4.is_director` | `PARTIAL` | typed row flag |
| `ownership.form4.officer_title` | `PARTIAL` | typed row title |
| `ownership.form4.is_10b5_1` | `PARTIAL` | row-level Analysis fact |

`ownership.form144.proposed_sale_percent` is not a registered condition. `READY` means the registry declares a condition/fact capability; it does not mean an evaluator, user condition store, production caller, or delivery path exists.

A repository-wide caller audit finds no Ownership Matcher and therefore no production caller. The V1 production boundary is:

```text
Ownership Analysis → validated facts → typed persistence = WIRED

User-created Ownership Monitor condition evaluation = NOT IMPLEMENTED
Ownership Monitor match-triggered delivery = NOT IMPLEMENTED
```

## Existing alert versus user-created Monitor alert

The existing Stock Radar alert path is event/score based:

1. Ownership Analysis supplies the event score and signal.
2. Event persistence derives `archive` below 50, `feed` from 50 through 74, and `alert` at 75 or above.
3. `runSecFilingAnalysisIngest()` invokes alert delivery only for persisted `delivery_level=alert` events.
4. Existing delivery evaluates user watchlist tickers, discovery categories, plan access, market-cap filters, preferences, and channels.

That is the existing event alert system. It does not evaluate the Ownership condition registry or user-created Monitor thresholds. Do not describe a score alert, watchlist alert, or discovery alert as a Monitor Matcher result.

## Provenance boundary

Current Ownership provenance is layered and human/audit traceable:

- raw item accession, SEC source URL, selected raw Ownership source, and document inventory;
- parser-selected source role/status/format and compact source inventory;
- source row excerpts in parser evidence;
- row-level and field-level footnote links plus exact footnote text;
- compact `selected_evidence` labels/values/source descriptions passed to Analysis;
- Analysis `evidence: string[]` on owner and row facts; and
- typed persistence provenance and calculation basis.

Current Ownership provenance is **human/audit traceable but not a stable field-level machine-verifiable citation contract**. The typed fact schema has no required `source_ref`, allowed-reference namespace, or validator that resolves a fact to `(accession, document, row, field path)`. The validation-repair helper's constant label `source_ref: "SEC ownership source excerpt"` is a bounded repair block label, not that contract.

This gap is not a V1 blocker and must not be “fixed” by inventing references in parser or persistence. A future design may add accession + XML document identity + row index + field path, but only as an explicit versioned architecture change.

## Calendar boundary

The source layer preserves more dates than the current Calendar candidate path uses.

Form 4 date structure includes transaction date, deemed execution date, exercise/date-exercisable value, expiration date, filing period, signature dates, and 10b5-1 adoption/instruction dates when found in structured fields or evidence. Form 144 date structure includes approximate proposed-sale date, acquisition date, payment date, prior-sale dates, notice date, plan-adoption dates, detected instruction dates, and original-submission metadata.

Parser `calendarItems` currently emits only:

- each Form 4 `transaction_date`; and
- the primary Form 144 `approximate_sale_date`.

Those parser candidates are structural conveniences, not Calendar semantic truth. The production Calendar writer does not directly persist `parserOutput.calendarItems`; it consumes `analysis.calendar_items`, then applies date normalization and Calendar policy before writing `event_calendar_items`. Ownership Analysis receives the underlying transaction and proposed-sale dates in source evidence, but no architecture invariant guarantees that every parser candidate becomes a Calendar item.

Calendar importance, event type, precision, estimated range, title, and keep/drop policy are not parser responsibilities. Future Calendar enrichment may reuse the additional raw dates, but must make that semantic decision in the Calendar/Analysis boundary rather than adding importance heuristics to the Ownership parser.

## Fallback and future XML limitations

| Condition | Current behavior | Limitation |
| --- | --- | --- |
| Recognized well-formed Ownership XML | Selected before HTML/text | “Well-formed” is root/closing-tag best effort, not XSD validation. |
| Namespaced Form 144 XML | Optional prefixes are accepted for known tags | Unknown renamed/restructured tags are not automatically understood. |
| XML missing | First usable HTML/text fallback is selected | Row, relationship, and footnote fidelity may be lower. |
| XML malformed and fallback exists | `fallback_after_malformed_xml` | Structured XML is not partially merged with fallback. |
| Only malformed XML exists | `malformed_xml_limited_extraction` | Best-effort results may be partial and remain low confidence. |
| Empty source | `empty`; no rows | No values are invented. |
| Legacy Form 144 HTML | A minimal Form 144 shell and remarks may be retained | Structured proposed-sale rows are not normalized from legacy HTML. |
| Future XML version using known root/tags | Best-effort known-tag extraction | `schemaVersion` is recorded but not whitelisted or validated. |
| Future XML version changing structure/tags | May select as structured XML but extract partial/empty facts | A well-formed recognized root can prevent fallback even when new semantics are unsupported. |

Future SEC schema changes should be handled with captured fixtures, explicit monitoring, and an approved parser update. They must not trigger silent numeric or semantic fallbacks.

## Do not reintroduce

1. **HTML-first regression.** Do not select rendered HTML as primary structured evidence when usable Ownership XML exists.
2. **Parser semantic truth.** Do not make parser categories, signals, scores, or size heuristics canonical Monitor facts.
3. **Code-to-action hardcodes.** Do not map transaction codes or A/D markers directly to canonical buy/sell meaning.
4. **Blind Form 144 percentage.** Do not divide numerator by denominator until Analysis establishes unit comparability and any conversion relation.
5. **Footnote flattening.** Do not discard row/field footnote links in favor of one undifferentiated text blob.
6. **Multiple-owner collapse.** Do not retain only the first reporting owner or claim a row-level owner mapping that does not exist.
7. **Row netting.** Do not merge derivative/non-derivative, acquisition/disposition, or multiple-security rows before Analysis.
8. **Missing-to-zero coercion.** Do not convert missing, blank, null, or footnote-only values to zero; do not convert explicit false to null.
9. **Offering architecture copy.** Do not add an Ownership Stage-2 Normalizer or Offering canonical machinery without an Ownership-specific approved need.
10. **Calendar semantics in parser.** Do not confuse raw date extraction with Calendar importance or event policy.
11. **Legacy semantic dependency.** Do not use legacy parser outputs as an Analysis fallback, Matcher fact, or delivery trigger.
12. **Implemented-means-wired claims.** Do not equate condition registry entries or typed persistence with a production Ownership Matcher.

## Architecture invariants

1. Forms 4, 4/A, 144, and 144/A use usable SEC Ownership XML before HTML/text fallback.
2. XML-first is not XML-only; fallback status and confidence remain explicit.
3. Raw Ownership source and SEC document inventory are preserved at ingest, subject to recorded truncation limits.
4. The parser preserves structure and evidence; Ownership Analysis owns economic semantics.
5. Raw transaction codes and A/D markers are evidence, not final buy/sell meaning.
6. Form 4 and Form 144 rows, securities, and footnote relationships remain distinct.
7. Multiple reporting owners remain an array; no unsupported per-row owner mapping is invented.
8. Missing, blank, zero, false, null, and footnote-only states remain distinct.
9. Form 144 percentages require Analysis-owned unit comparability and source-backed normalization.
10. Legacy parser semantic outputs are non-authoritative and never persistence fallback truth.
11. `analysis_output.ownership_monitor_facts` is the only canonical input to typed Ownership fact persistence.
12. Ownership does not inherit Offering's two-stage architecture by default.
13. Raw structured dates may support Calendar, but Calendar semantics and persistence policy remain separate.
14. Component capability, test coverage, production caller, and production wiring are documented separately.
15. Existing score alerts and user-created Monitor condition alerts are separate systems.

## Current completion boundary

### Implemented and validated

- SEC Ownership XML discovery, selected raw-source preservation, and document inventory;
- Form 4 and namespace-tolerant Form 144 XML-first structural extraction;
- HTML/text fallback statuses and warnings;
- multi-row, multi-owner, field-footnote, exact-footnote, and null/zero/false preservation;
- direct Primary Ownership Analysis with mandatory `ownership_monitor_facts_v1` validation;
- Analysis-owned economic direction, row-level 10b5-1, and Form 144 comparability decisions;
- deterministic typed row materialization and atomic event-domain replacement;
- Ownership condition capability registry entries; and
- limited parser Calendar candidates plus production Analysis-calendar policy path.

### Production-wired

- SEC raw filing → Ownership adapter/parser → direct Ownership Analysis;
- successful Ownership Analysis → event persistence;
- successful Ownership Analysis facts → optional typed Ownership persistence;
- event score ≥ 75 → existing score-based alert evaluation/delivery; and
- `analysis.calendar_items` → Calendar policy → `event_calendar_items` when valid and eligible.

### Legacy and non-authoritative

- parser transaction meaning/category mappings;
- parser purchase/sale/gift and routine/archive signals;
- parser scores, routing/safety/completion classifications, and semantic summaries;
- parser transaction-value calculations; and
- parser Form 144 raw mechanical percentage and percentage-based heuristics.

### Future or deferred

- stable field-level machine-verifiable Ownership provenance;
- legacy parser semantic cleanup;
- additional Calendar date enrichment;
- an Ownership-specific Matcher evaluator;
- user-created Ownership Monitor condition persistence/orchestration; and
- Monitor match-triggered alert delivery.

These deferred items do not authorize implicit implementation. Each requires its own acceptance criteria and architecture review.
