# SEC Ingest / Integration Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit form-room handoff documents from this room
unless the main thread explicitly asks for a documentation update.

## Scope

This room connects completed SEC form-room work to the live pipeline.

Allowed responsibilities:

- load parser/router/analysis outputs from completed form rooms
- wire form routing into SEC package/analysis flow
- attach market context when needed
- map common output JSON into DB writes
- map `display_payload` into metadata or existing structured tables
- verify `/feed`, `/filings`, `/filings/[id]`, archive visibility, and alerts
- run live DB/FMP/site tests when needed

## Required Input

Only integrate a form room after it provides the required output JSON shape:

- `parser_output`
- `analysis_output`
- `display_payload`
- `fixture_expected`

Do not accept one-off JSON shapes. If a form room output does not match
`docs/SEC_FORM_ROOM_RULES.md`, stop and report the mismatch before wiring it.

## Approved Event Types

The integration room must accept only these 15 event types:

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

Do not rename, merge, split, or add event types from this room.

## Mapping Rules

Map common fields this way:

- `analysis_output.event_type`, `score`, `signal`, `market_scope`,
  `event_title`, `quick_take`, `summary`, `score_reason`
  -> `events`
- `why_it_matters`, `bullish_points`, `bearish_points`, `key_evidence`,
  `what_to_watch_next`
  -> `event_analysis`
- `primary_ticker`, `tickers`, `related_tickers`
  -> `event_tickers`
- `calendar_items`
  -> `event_calendar_items`
- `display_payload`
  -> `events.metadata.display_payload` unless there is an approved structured
  table
- `display_payload.display_type = "offering_terms"`
  -> also map to `event_offering_terms` when fields are available

Do not create a new DB table or column without explicit user approval.

## Delivery Rules

Delivery is derived from score:

- below 50: `archive`
  - save for ticker/company detail history only
  - do not show in main feed
- 50 to 74: `feed`
  - show in feed and filing pages
- 75 or above: `alert`
  - show in feed and filing pages
  - trigger immediate alert delivery through the alert system

Do not let a form room override these score bands.

## Market Context

This is the room that may connect live market context.

Use form-room hints:

- `fixture_expected.market_context_needed`
- `fixture_expected.market_context_fields`
- `fixture_expected.market_context_reason`

Fetch only fields needed for the event type. Avoid broad market calls for
routine, administrative, or archive-only filings unless the analysis requires
them.

## EFFECT Linking

For EFFECT filings, try to link the EFFECT result to the original registration
filing analysis so the site can show which filing became effective. The user
should not have to chase SEC links manually.

If the original filing cannot be found reliably, persist the EFFECT event with
the best source-backed reference and report the missing link.

## Candidate Special UI

If `display_payload.display_type = "candidate_special"`:

- persist the payload in metadata
- do not invent a permanent DB table
- report the candidate UI need to the detail UI room
- keep generic detail rendering usable until UI work is approved

## Do Not Do

Do not edit individual form-room parser logic just to make integration easier.
If a parser output is wrong, report it back to that form room or make a separate
clearly scoped fix.

Do not edit unrelated news, auth, subscription, or alert-preference work.

Do not rename the 15 event types.

Do not shorten form scopes in documentation or logs.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- which form room is being integrated
- whether live DB/FMP/site/alert tests were run
- whether any common, ingest, DB, app, UI, or alert files changed
- whether any form-room parser files changed
- whether `display_payload` mapping is generic, offering_terms, or
  candidate_special

Integrate one form room or one display payload family per commit when possible.

## Final Handoff

When done, report:

- integrated form room or rooms
- changed files
- DB tables written
- market context fields used
- pages verified
- alert behavior verified
- archive/feed/alert behavior verified
- candidate special UI needs forwarded
- open risks or follow-up work
