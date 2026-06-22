# SEC Live Test Direction

This is the testing direction for every SEC form room.

## Main Rule

Do not reimplement SEC fetch, DB write, alert delivery, market context, or UI
logic inside a form room.

Use the real integration runtime through:

```powershell
npm run sec:live-test
```

That command is the approved live path. It syncs only the current form folder
into the integration worktree, then runs real SEC ingest, analysis persistence,
site routing, and alert delivery.

## What Each Room Owns

Each form room owns only form-specific work:

- parser quality
- deterministic result logic when safe
- router prompt if that form uses one
- analysis prompt or compact analysis input
- fixtures and expected outputs
- form-specific warnings about missing source materials
- final handoff notes

If a live test shows weak extraction, wrong scoring, bad wording, missing
evidence, or poor analysis quality, fix it inside that form room.

## What Integration Owns

Do not fix these from a form room:

- SEC HTTP fetch execution
- current-feed or archive traversal
- attachment fetching
- raw item persistence
- event persistence
- ticker/event/calendar/offering mapping
- dedupe
- alert delivery and alert run logs
- market context live fetch
- app routes and UI rendering
- Supabase schema or direct DB adapters

If a live test shows one of those problems, record it as an integration issue
and stop changing shared files from the form room.

## Unit Tests Vs Live Tests

Use fixture JSON for unit tests:

```powershell
node --test lib/sources/sec/forms/<room>/*.test.ts
```

Use the bridge for site/DB/alert verification:

```powershell
npm run sec:live-test
```

Do not replace the bridge with a temporary script that mimics SEC fetch logic.
Temporary fetch scripts can drift from the real runtime and create false
confidence.

## Required Live Test Behavior

Live tests may write to the real development DB. This project is not the live
production service.

The bridge must use real runtime behavior:

- real SEC fetch through the integration code
- real raw item persistence
- real parser dispatch
- real analysis LLM unless the form produces a deterministic persistable result
- real event persistence
- real site URL output
- real alert delivery path for score 75 or above

Do not silently switch live tests back to dry-run mode unless the user asks.

## Standard Commands

Run the default sample for the current room:

```powershell
npm run sec:live-test
```

Run a specific form set:

```powershell
npm run sec:live-test -- --formTypes=425 --limit=1 --countPerForm=3 --attachmentLimit=8
```

Run a known accession:

```powershell
npm run sec:live-test -- --accessionNumber=0001193125-26-237487
```

Sync the form folder only, without DB writes:

```powershell
npm run sec:live-test -- --syncOnly=true
```

## If Dependencies Or Imports Fail

Do not rewrite the runtime fetch path in a throwaway script.

Use one of these:

- run `npm run sec:live-test`
- start the integration dev server and use the real API
- install/use the repo dependencies required by the existing code

If the real bridge cannot fetch required source documents, report an
integration fetchPlan/runtime issue.

## Required Report After Live Test

Every live test report should include:

- command used
- sample form/accession/ticker
- raw item id
- event id
- URL opened
- score and delivery level
- parser group used
- whether router was used or skipped
- whether full raw text/XML was excluded from LLM input when required
- whether `display_payload` persisted
- whether `fixture_expected` was stripped
- dedupe result when re-run
- alert result:
  - `user_alert_deliveries`
  - `alert_delivery_event_runs`
  - whether any actual delivery was sent
- any integration issues discovered

## Alert Rule

Alerts stay on for live tests.

Expected behavior:

- score below 50: archive page only, no alert delivery
- score 50 to 74: feed/detail page, no alert delivery
- score 75 or above: feed/detail page plus real alert delivery path

Feed or archive events must not create alert delivery run logs.
