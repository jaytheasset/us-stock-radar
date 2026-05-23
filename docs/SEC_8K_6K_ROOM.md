# SEC 8-K / 6-K Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. That file is the common rulebook for
all SEC form rooms.

## Scope

This room covers only:

- `8-K / 6-K`
- `8-K/A / 6-K/A`

Allowed working folder:

- `lib/sources/sec/forms/8k-6k/`

Do not edit common code, live ingest, DB migrations, app pages, alert delivery,
or UI files from this room.

## Goal

Build the 8-K / 6-K form-family parser, router prompt, analysis prompt,
fixtures, and local tests.

The work should answer:

- What did the filing disclose?
- Which one of the 15 approved event types does it belong to?
- Is it archive, feed, or alert level?
- Does it need market context?
- Does it need special detail UI later?

Do not connect the result to live site display. Integration is handled by the
SEC ingest/integration room later.

## Expected Flow

Default flow:

1. Parser extracts source-backed filing facts.
2. Router prompt chooses event type and action.
3. Analysis prompt writes final investor-facing analysis.

Allowed exceptions:

- A clearly routine 8-K/A or 6-K/A can be archive without full analysis.
- A deterministic filing can finish early when the meaning is obvious and low
  risk.

If a case skips LLM or skips full analysis, the fixture must show why.

## Approved Event Types

Use only the 15 approved event types:

- `listing_risk`
- `dilution_risk`
- `earnings`
- `sales_performance`
- `product_update`
- `leadership_governance`
- `insider_ownership`
- `shareholder_vote`
- `strategic_transaction`
- `financial_risk`
- `legal_risk`
- `dividends`
- `capital_return`
- `fda_clinical`
- `other`

8-K and 6-K are broad current-report forms. Classify by disclosure content, not
by form type alone.

## Score And Delivery

Use the common score bands:

- Below 50: `archive`
- 50 to 74: `feed`
- 75 or above: `alert`

75 or above means immediate alert delivery once the integration room connects
the result. This room does not send alerts.

## Parser Targets

The parser should extract the important facts that help routing and analysis:

- form type: `8-K`, `8-K/A`, `6-K`, or `6-K/A`
- accession number, CIK, company name, ticker, filed date, source URL
- SEC item numbers when present, such as Item 1.01, 2.02, 3.01, 5.02, 7.01,
  8.01, 9.01
- exhibit list and important exhibit text, especially Exhibit 99.1
- filing headline or normalized title
- dates, deadlines, meeting dates, effective dates, payment dates, closing dates
- dollar amounts, share counts, prices, percentages, ratios, and contract terms
- named counterparties, exchanges, lenders, buyers, sellers, customers,
  suppliers, directors, officers, auditors, regulators, or clinical programs
- whether this is an amendment and what appears changed
- whether the filing is routine, administrative, exhibit-only, or material

Keep evidence snippets short and source-backed.

## Routing Guidance

Common 8-K / 6-K routing examples:

- Nasdaq/NYSE non-compliance, delisting notice, trading suspension, reverse
  split for minimum bid: `listing_risk`
- registered direct, ATM, PIPE, convertible notes, warrants, resale,
  exchange-cap approval, financing terms: `dilution_risk`
- earnings release, results, guidance, conference call tied to results:
  `earnings`
- revenue, sales, orders, bookings, backlog, margins, deliveries, production
  metrics outside full earnings: `sales_performance`
- product launch, production update, trial update, commercialization update:
  `product_update`
- CEO/CFO/director/auditor changes, board changes, internal controls,
  compensation governance: `leadership_governance`
- shareholder meeting, vote result, proposal approval/rejection:
  `shareholder_vote`
- merger, acquisition, asset sale, joint venture, license, material agreement,
  tender/deal update: `strategic_transaction`
- liquidity warning, default, covenant breach, going concern, bankruptcy,
  restructuring, debt amendment: `financial_risk`
- lawsuit, investigation, settlement, enforcement, subpoena, compliance matter:
  `legal_risk`
- dividend declaration, dividend change, distribution, record date, payment date:
  `dividends`
- buyback authorization, repurchase program, capital return program:
  `capital_return`
- FDA approval, CRL, clinical data, trial halt, PDUFA, advisory committee:
  `fda_clinical`
- unclear, routine, administrative, or non-investor-relevant filing: `other`

Use `other` for ambiguous cases rather than inventing a new type.

## Market Context

Use fixture-only market context when it changes investor interpretation.

Likely market-context cases:

- `dilution_risk`: price, market cap, shares outstanding, public float, volume
- `dividends`: price and dividend amount for yield context
- `capital_return`: market cap and buyback amount
- `listing_risk`: price, exchange, market cap, trading liquidity
- `strategic_transaction`: market cap, deal value, premium/discount when known
- `financial_risk`: market cap, price, debt/liquidity scale when useful

Usually not needed:

- simple leadership changes
- routine legal updates
- administrative exhibit updates
- vague product updates without numbers

If market context is used in a fixture, also test one case without it.

The output should indicate whether market context is needed:

```json
{
  "market_context_needed": true,
  "market_context_reason": "Dividend yield needs price context.",
  "market_context_fields": ["price"]
}
```

Do not call FMP or write DB market snapshots from this room.

## Amendment Handling

For `8-K/A` and `6-K/A`, do not automatically create a new event.

Decide whether the amendment:

- corrects a material term
- adds a missing exhibit
- changes dates, amounts, share counts, counterparties, or risk language
- updates an earlier market-moving event
- is routine or administrative

Use fixture parent context when needed. Do not query live DB for the parent
filing.

## Calendar Items

Extract calendar items only when the filing states an investor-relevant date or
deadline.

Examples:

- earnings call date
- shareholder meeting or vote date
- dividend ex-date, record date, payment date
- reverse split effective date
- delisting appeal or compliance deadline
- merger vote or closing date
- tender, rights, warrant, lock-up, or financing approval deadline
- PDUFA, FDA advisory committee, clinical readout, or trial date

Do not add calendar items for the filing date itself unless the filing says the
event occurs on that date.

## Fixture Tests

Use fixture JSON, not live DB.

Recommended first fixtures:

- listing-risk 8-K
- dilution or financing 8-K
- earnings 8-K with Exhibit 99.1
- dividend or capital-return 8-K
- leadership/governance 8-K
- strategic transaction 8-K
- routine 8-K/A archive case
- foreign issuer 6-K with Exhibit 99.1

Each fixture should include:

- filing input
- optional parent filing context for amendments
- optional market context
- expected event type
- expected score band
- expected delivery level
- important parser facts
- expected calendar items, if any

## Output Needed For Handoff

When this room is done, provide:

- files changed under `lib/sources/sec/forms/8k-6k/`
- fixture list and what each fixture proves
- parser output examples
- router output examples
- analysis output examples
- market context assumptions
- deterministic archive/skip cases
- special UI needs discovered
- open questions for integration

Do not wire this room into runtime ingest. The integration room will do that
after review.

