# SEC Form Room Rules

This document is the working rulebook for parallel SEC form rooms.

## Goal

Each SEC form room builds only its own parser, routing prompt, analysis prompt,
fixtures, and local tests. For live site verification, use the approved bridge
script from the form room instead of manually editing integration files.

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
are handled by the integration runtime. A form room may exercise that runtime
only through `npm run sec:live-test`.

Before live testing, read `docs/SEC_LIVE_TEST_DIRECTION.md`.

## Exact Form Room Scopes

Do not shorten, rename, or reinterpret these scopes in room handoffs. Other
parallel rooms rely on these exact labels.

- `8-K / 6-K, 8-K/A / 6-K/A`
- `10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A`
- `NT 10-K / NT 10-Q / NT 20-F`
- `S-1 / F-1, S-1/A / F-1/A`
- `S-3 / F-3 / S-3ASR / F-3ASR, S-3/A / F-3/A`
- `424B3 / 424B5`
- `S-8 / S-8/A`
- `EFFECT`
- `Form 4 / 4/A, Form 144 / 144/A`
- `SC 13D / SC 13D/A, SC 13G / SC 13G/A`
- `Proxy`
- `425`
- `S-4 / F-4 / S-4/A / F-4/A`
- `Tender / CB / 13E3`
- `Form 25 / 25-NSE`
- `Other SEC Filing`

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

## Runtime Split After Ingest Connection

Read `docs/SEC_FORM_RUNTIME_SPLIT.md` before live dry-run work.

After a form room is connected to ingest, the form module owns:

- form-specific fetch priorities in `fetchPlan.ts`
- the decision that a fetched document should be saved as raw source
- DB row payload values for raw source, events, analysis, tickers, calendar
  candidates, display payload, and alert candidates
- parser logic
- deterministic result logic when safe
- router prompt if the room uses one
- analysis prompt or compact analysis input
- fixture/live dry-run evidence
- warnings when important raw materials are missing

Common ingest still owns:

- SEC HTTP execution
- rate limiting and retry
- common store adapters: `rawStore`, `eventStore`, and `alertQueue`
- raw/event/calendar/ticker/alert dedupe
- DB writes
- score-to-delivery derivation
- transaction handling
- alert enqueue and delivery logs
- UI routing handoff

The exact rule:

```text
Values are owned by the form module.
Write mechanics are owned by common stores.
```

The form worker may request:

- `rawStore.save(rawPayload)`
- `eventStore.saveAll(eventPayload)`
- `alertQueue.enqueue(alertCandidate)`

Do not import Supabase directly from a form parser, prompt, or form worker. Do
not implement DB schema, dedupe, transaction handling, or direct alert delivery
inside a form room. If the form discovers a DB, alert, queue, or UI need, report
it in the final handoff.

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
JSON. In live testing through `npm run sec:live-test`, score 75 or above uses
the real alert delivery path.

## Market Context

Market context can be used inside a form room as fixture data for unit tests.
Live site tests may use the integration runtime's existing market context
behavior through `npm run sec:live-test`.

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

## Live Site Test Bridge

Fixture tests are for parser and prompt correctness. Site rendering, DB writes,
and alert delivery are verified through:

```powershell
npm run sec:live-test
```

Run that command from the individual form-room project. It will:

1. copy only that room's `lib/sources/sec/forms/<form-room>/` folder into the
   integration worktree
2. start the integration dev server on `http://127.0.0.1:3002` if needed
3. run real SEC raw ingest with `dryRun=false`
4. run real SEC analysis persistence with `dryRun=false`
5. send alerts when the persisted event is score 75 or above and user delivery
   settings match

Useful options:

```powershell
npm run sec:live-test -- --formTypes=4,144 --limit=1 --countPerForm=1
npm run sec:live-test -- --accessionNumber=0001193125-26-237487
npm run sec:live-test -- --syncOnly=true
```

Do not manually patch shared ingest, DB, UI, or alert files from a form room.
If live testing shows a shared runtime problem, record it and fix it in the
integration worktree.

Do not reimplement SEC fetch in a temporary script. If the bridge/runtime does
not fetch the needed document, attachment, XML, fee table, or enrichment data,
report that as an integration issue.

## Required Output JSON

Each form room must produce fixture and expected-output JSON in this shape. This
keeps the later SEC ingest/integration work from guessing how each room named
its fields.

```json
{
  "parser_output": {
    "parserVersion": "string",
    "parserGroup": "form-room-folder-name",
    "formType": "exact room scope label or exact SEC form type",
    "accessionNumber": "string | null",
    "isSupported": true,
    "summary": "string | null",
    "facts": {},
    "signals": [],
    "calendarItems": [],
    "warnings": [],
    "raw": {}
  },
  "analysis_output": {
    "source_group": "filings",
    "market_scope": "company | sector | theme | macro",
    "event_type": "one of the approved 15 event types",
    "event_title": "string",
    "primary_ticker": {
      "ticker": "string | null",
      "exchange": "string | null"
    },
    "tickers": [],
    "sector": "string | null",
    "industry_group": "string | null",
    "theme_group": "string | null",
    "sub_theme": "string | null",
    "score": 0,
    "score_reason": "string",
    "signal": "bullish | bearish | volatile | neutral",
    "quick_take": "string",
    "summary": "string",
    "why_it_matters": "string",
    "bullish_points": [],
    "bearish_points": [],
    "key_evidence": [],
    "what_to_watch_next": [],
    "related_tickers": [],
    "calendar_items": [],
    "confidence": "high | medium | low",
    "needs_human_review": false
  },
  "display_payload": {
    "display_type": "generic | offering_terms | candidate_special",
    "data": {},
    "evidence": [],
    "notes": []
  },
  "fixture_expected": {
    "expected_delivery_level": "archive | feed | alert",
    "expected_impact": "low | medium | high",
    "market_context_needed": false,
    "market_context_reason": "string | null",
    "market_context_fields": [],
    "special_ui_needed": false,
    "special_ui_reason": "string | null",
    "integration_notes": []
  }
}
```

`delivery_level` is derived from `analysis_output.score`; it is not a separate
free-form LLM decision. Below 50 is `archive`, 50 to 74 is `feed`, and 75 or
above is `alert`.

`display_payload.display_type` starts with only three values:

- `generic`: common detail page is enough.
- `offering_terms`: dilution/offering details that can map to offering display
  or `event_offering_terms`.
- `candidate_special`: the form room found fields that likely need a new
  special detail UI, but the UI type is not approved yet.

When using `candidate_special`, put the proposed display fields in
`display_payload.data`, keep evidence in `display_payload.evidence`, and explain
the UI need in `fixture_expected.special_ui_reason` and the final handoff. Do
not create a new display type from a form room.

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

## Fixture And Live Testing

Each form room tests parser and prompt internals with files, not live DB.

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
unit tests.

For site, DB, ingest, and alert verification, use `npm run sec:live-test`.

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
