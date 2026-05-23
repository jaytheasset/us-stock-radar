# SEC Event Detail UI Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit form-room parser, ingest, DB, or alert delivery
logic from this room.

## Scope

This room builds detail-page UI for SEC filing events using event type and
`display_payload`.

Allowed responsibilities:

- improve common SEC filing detail rendering
- build approved special detail UI templates
- render `display_payload.display_type = "generic"`
- render `display_payload.display_type = "offering_terms"`
- inspect `candidate_special` payloads and propose a UI shape
- verify desktop and mobile detail pages

## Inputs

The UI room consumes data produced by form rooms and persisted by integration:

- `events`
- `event_analysis`
- `event_tickers`
- `event_calendar_items`
- `event_offering_terms`
- `events.metadata.display_payload`

Do not change parser output shape from this room.

## Approved Event Types

The UI room must render events using only these 15 event types:

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

## Display Types

Initial display types:

- `generic`
  - common filing detail page
  - should work for archive, feed, and alert events
- `offering_terms`
  - dilution/offering detail display
  - may use `event_offering_terms`
- `candidate_special`
  - not a final UI type
  - means a form room or integration found fields that may need a new detail UI

Do not invent a permanent display type silently. If a new display type is
needed, report it clearly and wait for main-thread approval before treating it
as a stable UI contract.

## Archive / Feed / Alert

`delivery_level` controls where the event appears, not what UI template it uses.

- `archive`: ticker/company detail history only
- `feed`: feed plus detail
- `alert`: feed plus detail plus alert delivery

The detail UI must still render archive events if the user opens them from a
ticker/company history page.

## Candidate Special Workflow

When a `candidate_special` payload appears:

1. Inspect `display_payload.data`, `evidence`, and `notes`.
2. Decide whether the generic page is enough.
3. If generic is not enough, propose a named UI type and required fields.
4. Do not change DB schema unless explicitly approved.
5. Do not change parser or ingest logic from this room.

Examples of future special UI candidates:

- dividends
- insider ownership
- listing risk
- strategic transaction
- shareholder vote
- tender offer
- Form 25 delisting/removal
- EFFECT linked registration effectiveness

These are candidates, not pre-approved permanent `display_type` values.

## Do Not Do

Do not edit:

- `lib/sources/sec/forms/`
- SEC parser files
- SEC ingest files
- DB migrations
- alert delivery files
- live market-context fetch code
- form-room handoff documents

Do not:

- rename the 15 event types
- change score bands
- send alerts
- call FMP live for UI rendering
- create new DB tables or columns without explicit approval
- shorten SEC form scope labels

## Required Reminders While Working

Before editing files, state the exact UI files that will be changed.

Before every commit, confirm:

- no parser, form-room, ingest, DB, or alert files were changed
- which display type is being rendered
- whether the UI uses persisted DB fields or fixture/mock data
- whether desktop and mobile views were checked when a visual page changed

## Final Handoff

When done, report:

- changed files
- display type handled
- event types covered
- fixture or DB samples used
- desktop/mobile verification
- unresolved payload fields
- any new proposed stable display type
