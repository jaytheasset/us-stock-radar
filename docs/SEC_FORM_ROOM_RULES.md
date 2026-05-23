# SEC Form Room Rules

This document is the working rulebook for parallel SEC form rooms.

## Goal

Each SEC form room builds only its own parser, routing prompt, analysis prompt,
fixtures, and local tests. It must not connect itself to live ingest, live DB
writes, alert delivery, or detail UI.

## Allowed Scope

A form room may edit only its own folder:

- `lib/sources/sec/forms/<form-room>/`

Examples:

- `lib/sources/sec/forms/8k-6k/`
- `lib/sources/sec/forms/s1-f1/`
- `lib/sources/sec/forms/424b/`
- `lib/sources/sec/forms/form25/`

Do not edit these from a form room:

- `lib/sources/sec/forms/common/`
- `lib/secIngest.ts`
- `lib/secFilingAnalysisIngest.ts`
- `lib/ai/`
- `lib/prompts/` outside the room folder
- `docs/db/`
- `app/`
- alert delivery files

Common code, ingest connection, DB persistence, site display, and alert sending
are handled later in the integration or UI room.

## Required Flow

Default flow:

1. Parser extracts source-backed facts from the SEC filing.
2. Router prompt chooses one of the approved event types and a preliminary
   action.
3. Analysis prompt produces the final investor-facing analysis.

Allowed exceptions:

- Some filings can finish deterministically in the parser.
- Some filings can finish at router stage without full analysis.
- EFFECT and some Form 25 cases can be deterministic when the filing meaning is
  clear.

When a room uses an exception, the fixture must show why LLM was not needed.

## Approved Event Types

Every SEC form result must use one of these 15 event types:

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

Do not invent a new event type in a form room. If the case is unclear, use
`other` and leave a note in the room output.

## Score And Delivery

Use the same score bands everywhere:

- Score below 50: `archive`
  - Saved for the ticker/company detail history only.
  - Not shown in the main feed.
- Score 50 to 74: `feed`
  - Shown in feed and filing pages.
- Score 75 or above: `alert`
  - Shown in feed and filing pages.
  - Eligible for immediate alert delivery.

The form room may decide the score and delivery level in fixtures and expected
JSON. The actual alert sending is connected later by the integration room.

## Market Context

Market context can be used inside a form room, but only as fixture data.

The form room may:

- include sample `market_context` in fixture JSON
- describe how market context changes the analysis
- test with and without market context
- output whether market context is needed

The form room must not:

- call FMP live
- write market snapshots to DB
- change shared market context fetch code
- connect market context to live ingest

Useful fields may include:

- `price`
- `previous_close`
- `market_cap`
- `shares_outstanding`
- `public_float`
- `volume`
- `avg_volume`

If market context matters, the output should include a clear reason, for
example:

```json
{
  "market_context_needed": true,
  "market_context_reason": "Offering size should be compared with market cap.",
  "market_context_fields": ["price", "market_cap", "shares_outstanding", "public_float"]
}
```

## Amendment Forms

Amended forms such as `/A` must be treated as update filings, not automatically
as new events.

The room should decide:

- Is this a real new market event?
- Is it a material change to a prior filing?
- Is it routine, exhibit-only, signature-only, or administrative?
- Does it need the original filing context?

If original filing comparison is needed, use fixture data to simulate the parent
filing. Do not query the live DB from the form room.

## EFFECT

EFFECT can often be handled without LLM. The important output is not only
"effective", but which registration filing became effective.

Expected output should try to identify:

- effective filing form
- company and ticker
- registration number or accession number when available
- effective date
- original registration filing link or reference
- whether the original filing analysis should be shown on the site

The integration room later links EFFECT to the original analyzed filing so users
do not need to manually chase the SEC chain.

## Form 25 / 25-NSE

Form 25 and 25-NSE are removal-from-listing or registration-withdrawal filings.
They are not always bad news.

The room must distinguish:

- common stock, ordinary shares, or ADS delisting risk
- merger or acquisition completion
- matured, redeemed, or retired securities
- warrants, notes, preferred shares, or other non-common securities
- exchange transfer or voluntary withdrawal

Deterministic handling is allowed for clear matured/redeemed/retired securities
or clear merger-completion removals. Use LLM when the investor impact is unclear
or common equity delisting risk is possible.

## Fixture Testing

Each form room tests with files, not live DB.

Recommended structure:

```text
lib/sources/sec/forms/<form-room>/
  fixtures/
    sample-case.json
  expected/
    sample-case.expected.json
  parser.test.ts
  router.test.ts
  analysis.test.ts
```

Fixture JSON should include:

- SEC form type
- filing text or relevant excerpts
- attachments when important
- optional parent filing context for amendments
- optional market context
- expected event type
- expected score band
- expected delivery level
- important extracted facts

Do not run live site, live DB writes, live FMP calls, or real alert sending from
a form room.

## Handoff To Integration And UI

When a form room is done, it should provide:

- parser output examples
- router output examples
- analysis output examples
- fixture names tested
- market context assumptions, if any
- deterministic exceptions, if any
- special UI needs, if any

The integration room decides how to connect it to ingest, DB, feed, filing
detail pages, and alerts.

The detail UI room decides whether an event type needs a special page. Form
rooms should not build UI directly.

