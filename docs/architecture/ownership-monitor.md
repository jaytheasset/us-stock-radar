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
        ├──→ verified production parser rows ──→ typed event ownership persistence
        └──→ Primary Ownership Analysis LLM ──→ summary, score, narrative, and semantic analysis
```

`XML-first` does not mean `XML-only` for Analysis input. A usable SEC Ownership XML document is the primary structured source; HTML or text is a lower-confidence Analysis fallback. The parser owns deterministic source selection and structural extraction. The Ownership Analysis LLM owns economic semantics. Only verified XML/parser structural values are canonical for typed Ownership detail persistence; HTML/text fallback and Analysis output are not typed-detail inputs.

For Ownership **detail persistence**, verified SEC XML and the production parser are canonical. Primary Analysis remains required for the normal analyzed event, summary, score, narrative, and semantic interpretation, but its numeric/date/row output is not a typed-detail storage input. A failed Primary Analysis remains failed; verified parser rows may still be stored against an archive-only event shell with a failed `ai_runs` record.

Ownership currently has no Offering-style asynchronous Stage-2 Monitor Normalizer:

```text
Ownership details: XML source preparation → source verification → production parser → typed rows
Ownership summary: XML source preparation → Primary Ownership Analysis → analyzed event/summary
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
| XML/parser typed row construction | `lib/monitor/ownershipParserFacts.ts` |
| Typed persistence call | `lib/monitor/persistence.ts` |
| Production event/persistence caller | `lib/secStores/eventStore.ts` |
| Condition capability registry | `lib/monitor/conditionRegistry.ts` |
| Canonical Ownership fact reader | `lib/monitor/ownershipMonitorPersistence.ts` |
| Common Matcher and alert consumer | `lib/listingMonitorMatcher.ts`, `lib/monitor/listingMonitorAlertConsumer.ts` |
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

The canonical detail path reads only structural source values from the production parser. It does not persist parser transaction categories, parser scores/signals, parser-calculated transaction value, or parser-calculated Form 144 percentage. Provenance records `canonical_input: "raw_items.raw_payload.ownership_source_text"` and `parser_fallback: false`. Removing legacy semantic fields from the parser itself remains a separate cleanup.

## Ownership Analysis contract

The Primary Analysis adapter continues to require and validate `analysis_output.ownership_monitor_facts` with version `ownership_monitor_facts_v1`. The prompt and validation contract are preserved for analysis quality and regression compatibility, but this object no longer supplies production typed Ownership detail rows.

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

Rows remain in source order and are not netted, aggregated, or deduplicated. Production typed detail persistence independently rebuilds those rows from verified XML and does not derive transaction value.

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

The Analysis contract may express a comparability decision, but production typed XML detail persistence leaves `proposed_sale_percent` unavailable. It does not promote the Analysis decision into the canonical detail row and does not perform blind division. Historical Analysis-shaped row builders may still exercise the prior calculation rules in isolated regression tests, but they are not product callers.

The prior Analysis-shaped persistence calculation required:

1. `comparable_units === true`;
2. numerator and denominator are available;
3. the selected denominator is greater than zero;
4. both numeric qualities are comparison-eligible (`exact`, `derived`, or `estimated`); and
5. any normalization decision has already passed the Analysis fact validator.

Otherwise the historical Analysis-shaped percent is unavailable/null. The parser's `proposed_sale_percent_of_shares_outstanding` is never a canonical input.

The PDD regression illustrates the boundary without creating a ticker rule: the proposed quantity is 1,533 ADS, the outstanding denominator is ordinary shares, and source text may describe one ADS as multiple ordinary shares. The parser preserves both raw bases and the relation text. Analysis may interpret that relation for narrative/semantic output, while canonical typed XML persistence keeps the two source numbers and leaves the percentage unavailable.

## Typed XML/parser persistence

Production event persistence identifies the Ownership form when `promptKey === "sec_ownership_analysis"`, passes the persisted raw item to strict `persistOwnershipAnalysisFacts()`, and calls the production parser again from `raw_payload.ownership_source_text`. The typed write is allowed only when the source is untruncated `ownership_xml`, its accession matches the raw item, its official HTTPS SEC Archives URL contains that same accession's 18-digit directory, the expected complete XML root is present, and parser source-selection reports the preserved raw XML as a high-confidence structured source. The XML `issuerCik` must also exactly match the raw item's target Ownership issuer CIK. When the XML supplies `issuerTradingSymbol`, it must agree with the target and caller-supplied ticker; when it does not (as in current Form 144 XML), the target ticker may come from the raw SEC issuer-resolution result but a caller-supplied ticker cannot replace it. The SEC Archives CIK directory is not required to equal the issuer CIK because an Ownership submission can be filed under a reporting owner's filer identity.

The analyzed Ownership event path validates that boundary before writing the event and uses strict typed persistence rather than the shared optional Monitor-fact wrapper. Missing or unverifiable required XML therefore fails the save instead of being logged as a successful analyzed event with absent details. The shared optional wrapper continues to handle unrelated market snapshots and non-Ownership callers.

On Primary Analysis failure, `saveOwnershipParserDetailsEvent()` validates the same source before creating an archive-only event shell, writes parser rows, and links a failed `ai_runs`/`ai_outputs` trace. The ingest result remains `ok: false`; no `event_analysis`, summary, alert, Calendar, or Monitor-child success is fabricated. If a prior analyzed event already exists, a later failure never downgrades that event. A later successful Analysis reuses the same filing dedupe identity and replays the same parser rows.

`persistOwnershipAnalysisFacts()` uses parser rows whenever `ownershipRawItem` is supplied, then calls:

```text
replace_event_ownership_facts(
  p_event_id,
  p_form4_rows,
  p_form144_rows
)
```

`ownershipRawItem` is mandatory when `ownershipInputState` is `known`. Supplying only a valid `ownershipAnalysisOutput` fails closed before the replacement RPC; Analysis-shaped output cannot write or clear canonical detail rows. The pure historical Analysis row builder remains only for regression coverage and has no product persistence fallback.

The RPC atomically replaces both event-scoped tables:

- `public.event_form4_transactions`, keyed by `(event_id, transaction_index)`; and
- `public.event_form144_proposed_sales`, keyed by `(event_id, proposed_sale_index)`.

Important persisted Form 4 columns include the filing-level owner set/roles, transaction kind/security/date, raw codes, shares/price, post-transaction shares, direct/indirect ownership, nature, quality/availability fields, provenance, row evidence, and source field status. Parser canonical rows store `economic_direction = "unknown"`, `is_10b5_1 = null`, and no derived transaction value because those are not raw row values. For multiple reporting owners, relationship flags remain null and provenance marks the owner set as filing-level and unattributed.

Important persisted Form 144 columns include seller/owner names, security/exchange/date, proposed units, aggregate value, outstanding units, quality/availability fields, provenance, row evidence, and source field status. The separate table and `fact_kind: "form144_proposed_sale_notice"` preserve proposed-not-executed meaning. Percentage remains null/unavailable because unit comparability is not a raw structural fact.

Persistence provenance includes the accession/source binding plus the verified issuer binding:

```json
{
  "source": "sec_ownership_xml_parser",
  "parser_version": "ownership-parser-v1",
  "canonical_input": "raw_items.raw_payload.ownership_source_text",
  "source_verified": true,
  "parser_fallback": false,
  "issuer_identity": {
    "source": "ownership_xml",
    "match_status": "exact_cik",
    "xml_cik": "0000000000",
    "target_cik": "0000000000"
  }
}
```

Typed Ownership persistence is production-wired through both `saveAnalyzedSecFilingEvent()` and the analysis-failure-only `saveOwnershipParserDetailsEvent()`. Event-scoped row replacement remains atomic. Invalid, missing, truncated, fallback, untrusted-host, accession-mismatched, issuer-mismatched, or ticker-injected source input performs no typed write and cannot erase prior valid rows.

## Matcher and production wiring status

The common Matcher evaluates Ownership conditions through `readCurrentEventOwnershipFacts()`. The reader accepts only complete, form-consistent rows produced from verified SEC XML by the production parser. It validates event/form identity, row indexes, accession-bound SEC source URLs, exact XML-to-target issuer CIK provenance, canonical ticker consistency, parser provenance, source role/format, numeric quality/availability, and the Form 144 proposed-not-executed marker. Any missing, mixed-form, malformed, issuer-mismatched, ticker-injected, or LLM-shaped row set fails closed as `not_ready`.

Current XML-backed `READY` conditions are:

- Form 4: transaction kind, raw transaction code, raw acquisition/disposition marker, security class, transaction date, shares, price per share, post-transaction shares, filing-level reporting-owner role, officer/director/10-percent-owner flags, and officer title.
- Form 144: security class, proposed-sale shares, proposed-sale aggregate value, proposed-sale date, and exchange.

Numeric conditions require `availability=available`, `value_quality=exact`, and a non-negative condition value. Form 4 and Form 144 conditions are never evaluated against the other form family. Conditions for one Monitor must be satisfied by the same typed source row; values from different transactions or proposed-sale rows are not joined to fabricate a match.

For a single Form 4 reporting owner, owner attributes can be evaluated with transaction attributes on that row. For multiple reporting owners the parser exposes only a filing-level unattributed owner set. Combining an owner-scoped condition with a transaction-scoped condition, or combining multiple owner-scoped conditions that could belong to different owners, is therefore ineligible. One filing-level owner-role condition may still match the preserved owner set without claiming per-row attribution.

Semantic fields that verified XML cannot prove remain unsupported: `ownership.form4.direction`, `ownership.form4.transaction_value`, and `ownership.form4.is_10b5_1` are `PARTIAL`; `ownership.form144.proposed_sale_percent` is not registered. The Matcher never substitutes parser legacy semantics or Primary/late LLM output for these fields.

The production boundary is:

```text
Verified Ownership XML → production parser → typed detail persistence = WIRED
Ownership Analysis → analyzed event/summary = WIRED

Typed Ownership rows → common Matcher → deduplicated internal Monitor alert = WIRED
External Monitor alert delivery = NOT IMPLEMENTED
```

`runSecFilingAnalysisIngest()` invokes the LLM-free Monitor consumer after typed Ownership persistence in both the normal success path and the Primary Analysis failure path. The consumer reads Ownership rows once per event attempt and reuses the existing `(listing_monitor_id, alert_event_id)` uniqueness boundary, so replay and a later successful Analysis cannot duplicate the same Monitor output. A consumer failure is reported separately and does not relabel canonical persistence or a failed Primary Analysis as successful.

## Existing alert versus user-created Monitor alert

The existing Stock Radar alert path is event/score based:

1. Ownership Analysis supplies the event score and signal.
2. Event persistence derives `archive` below 50, `feed` from 50 through 74, and `alert` at 75 or above.
3. `runSecFilingAnalysisIngest()` invokes alert delivery only for persisted `delivery_level=alert` events.
4. Existing delivery evaluates user watchlist tickers, discovery categories, plan access, market-cap filters, preferences, and channels.

That existing event alert system remains separate from the newly wired internal Monitor alert path. Do not describe a score alert, watchlist alert, or discovery alert as a Monitor Matcher result. The Monitor consumer currently persists an internal alert only; existing external delivery workers deliberately exclude listing-monitor alerts.

## Provenance boundary

Current Ownership provenance is layered and human/audit traceable:

- raw item accession, SEC source URL, selected raw Ownership source, and document inventory;
- parser-selected source role/status/format and compact source inventory;
- source row excerpts in parser evidence;
- row-level and field-level footnote links plus exact footnote text;
- compact `selected_evidence` labels/values/source descriptions passed to Analysis;
- Analysis `evidence: string[]` on owner and row facts, retained separately from typed detail truth; and
- typed persistence accession/source URL, parser version, row group/index, row evidence, and source field statuses.

Current Ownership provenance is **human/audit traceable but not a stable field-level machine-verifiable citation contract**. Typed provenance resolves a row to accession, source URL, row group, and row index, but the schema has no required field-path namespace or independent XML-node resolver. The validation-repair helper's constant label `source_ref: "SEC ownership source excerpt"` is a bounded repair block label, not that contract.

This remaining field-level gap is not a V1 blocker. A future design may add XML-node identity and a field-path resolver, but only as an explicit versioned architecture change.

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
4. **Blind Form 144 percentage.** Do not divide numerator by denominator in canonical parser persistence; Analysis comparability remains separate from typed XML rows.
5. **Footnote flattening.** Do not discard row/field footnote links in favor of one undifferentiated text blob.
6. **Multiple-owner collapse.** Do not retain only the first reporting owner or claim a row-level owner mapping that does not exist.
7. **Row netting.** Do not merge derivative/non-derivative, acquisition/disposition, or multiple-security rows before persistence or Analysis.
8. **Missing-to-zero coercion.** Do not convert missing, blank, null, or footnote-only values to zero; do not convert explicit false to null.
9. **Offering architecture copy.** Do not add an Ownership Stage-2 Normalizer or Offering canonical machinery without an Ownership-specific approved need.
10. **Calendar semantics in parser.** Do not confuse raw date extraction with Calendar importance or event policy.
11. **Legacy semantic dependency.** Do not use legacy parser outputs as an Analysis fallback, Matcher fact, or delivery trigger.
12. **Internal-alert-means-delivered claims.** Do not equate the deduplicated internal Monitor alert with external channel delivery.

## Architecture invariants

1. Forms 4, 4/A, 144, and 144/A use usable SEC Ownership XML before HTML/text fallback.
2. XML-first is not XML-only; fallback status and confidence remain explicit.
3. Raw Ownership source and SEC document inventory are preserved at ingest, subject to recorded truncation limits.
4. The parser preserves structure and evidence; Ownership Analysis owns economic semantics.
5. Raw transaction codes and A/D markers are evidence, not final buy/sell meaning.
6. Form 4 and Form 144 rows, securities, and footnote relationships remain distinct.
7. Multiple reporting owners remain an array; no unsupported per-row owner mapping is invented.
8. Missing, blank, zero, false, null, and footnote-only states remain distinct.
9. Canonical Form 144 parser rows do not store a percentage; Analysis-owned unit comparability remains separate semantic output.
10. Legacy parser semantic outputs are non-authoritative and never persistence fallback truth.
11. Verified `raw_items.raw_payload.ownership_source_text` processed by the production parser is the only canonical input to product typed Ownership detail persistence.
12. The selected SEC Archives document directory must bind to the same accession as the raw item; SEC hostname validation alone is insufficient, while the Archives CIK directory is not treated as issuer identity.
13. The XML `issuerCik` must exactly match the target Ownership issuer CIK before any typed write. Caller-supplied ticker values are consistency checks only and can never replace XML/raw issuer identity.
14. `ownershipInputState: "known"` without a verified raw Ownership item fails before the replace RPC even when Analysis output is valid.
15. Ownership does not inherit Offering's two-stage architecture by default.
16. Raw structured dates may support Calendar, but Calendar semantics and persistence policy remain separate.
17. Component capability, test coverage, production caller, and production wiring are documented separately.
18. Existing score alerts and user-created Monitor condition alerts are separate systems.
19. Ownership Monitor matching uses only verified XML/parser typed rows and remains independent of Primary or late LLM values.
20. All conditions in one Ownership Monitor match on one source row; multiple-owner filing-level sets never imply unsupported owner-to-transaction attribution.

## Current completion boundary

### Implemented and validated

- SEC Ownership XML discovery, selected raw-source preservation, and document inventory;
- Form 4 and namespace-tolerant Form 144 XML-first structural extraction;
- HTML/text fallback statuses and warnings;
- multi-row, multi-owner, field-footnote, exact-footnote, and null/zero/false preservation;
- direct Primary Ownership Analysis with mandatory `ownership_monitor_facts_v1` validation;
- separate Analysis-owned economic direction, row-level 10b5-1, and Form 144 comparability decisions;
- verified XML/parser typed row materialization and atomic event-domain replacement;
- XML-backed Ownership condition registry entries, canonical reader, common Matcher evaluation, and replay-safe internal Monitor alerts; and
- limited parser Calendar candidates plus production Analysis-calendar policy path.

### Production-wired

- SEC raw filing → Ownership adapter/parser → direct Ownership Analysis;
- successful Ownership Analysis → analyzed event persistence;
- verified Ownership XML → typed Ownership persistence, independent of Analysis success;
- failed Ownership Analysis + verified XML → archive-only event shell + failed AI trace + typed details;
- typed Ownership details → LLM-free condition evaluation → deduplicated internal Monitor alert, including the Primary failure path;
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
- semantic Ownership conditions that XML cannot prove (`direction`, calculated transaction value, row-level 10b5-1, and Form 144 percentage);
- stable owner-to-transaction attribution for multi-owner Form 4 filings; and
- external Monitor match-triggered delivery.

These deferred items do not authorize implicit implementation. Each requires its own acceptance criteria and architecture review.
