# SEC Common Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit form-room handoff documents from this room
unless the main thread explicitly asks for a documentation update.

## Scope

This room maintains shared SEC form contracts and room-local common helpers.

Allowed working folder:

- `lib/sources/sec/forms/common/`

Allowed responsibilities:

- shared parser contracts
- shared TypeScript types used by form-room outputs
- shared validators for the Required Output JSON shape
- shared constants for approved event types
- shared score-to-delivery helpers
- shared fixture-only market-context interfaces
- small common normalization helpers that multiple form rooms need

This room does not build individual form parsers.

## Approved Event Types

The common room must define or validate only these 15 event types:

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

## Score And Delivery

The common room may implement shared helpers for these score bands:

- below 50: `archive`
- 50 to 74: `feed`
- 75 or above: `alert`

Do not change these bands without explicit main-thread approval.

## Market Context

The common room may define types or validators for market context fields.

It must not:

- call FMP live
- write market snapshots to DB
- connect market context to live ingest
- decide which filings should fetch live market context

Form rooms describe market-context needs with fixtures. The ingest room connects
live market context later.

## Required Output JSON

If this room adds validators or shared types, they must preserve the common
shape from `docs/SEC_FORM_ROOM_RULES.md`:

- `parser_output`
- `analysis_output`
- `display_payload`
- `fixture_expected`

Do not accept one-off shapes for individual form rooms.

## Do Not Do

Do not edit:

- individual form folders under `lib/sources/sec/forms/` except `common/`
- SEC ingest files
- DB migrations
- app/UI files
- alert delivery files
- live market-context fetch code
- form-room handoff documents

Do not:

- wire parsers into runtime ingest
- write to the live DB
- call FMP live
- send alerts
- build site UI
- change the 15 event type list
- change score bands
- add new DB tables or columns
- shorten SEC form scope labels

If any of those changes seem necessary, stop and report the need in the final
handoff instead of making the change. This rule exists because SEC form rooms,
ingest, UI, and alert work may be running in parallel.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- all changed code files are inside `lib/sources/sec/forms/common/`
- no individual form parser folders were changed
- no ingest, DB, app/UI, alert, live FMP, or live DB files were changed
- whether the change affects form-room output JSON compatibility

## Final Handoff

When done, report:

- changed files
- common contracts or helpers changed
- event type or score-band compatibility
- form rooms affected
- ingest room notes
- UI room notes
- tests run
- open risks or follow-up work
