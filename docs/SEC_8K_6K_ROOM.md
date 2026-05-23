# SEC 8-K / 6-K Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit either file from this room.

## Scope

This room covers only:

- `8-K / 6-K`
- `8-K/A / 6-K/A`

Allowed working folder:

- `lib/sources/sec/forms/8k-6k/`

## Work Flow

Build this form family in this order:

1. Parser
2. Router LLM prompt
3. Analysis LLM prompt
4. Fixture JSON tests

Some cases may finish deterministically in the parser or router when LLM is not
needed. If that happens, show it with a fixture.

Every final result must use one of the approved 15 event types from
`docs/SEC_FORM_ROOM_RULES.md`.

## Testing

Use fixture JSON only.

Fixture tests may include sample market context values, but they must not call
live FMP or any other live market-data API.

Do not use the live database for this room. Do not create a local DB for this
room. Use files only.

## Do Not Do

Do not edit anything outside:

- `lib/sources/sec/forms/8k-6k/`

Do not edit:

- `lib/sources/sec/forms/common/`
- SEC ingest files
- DB schema or migration files
- app pages
- detail UI files
- alert delivery files
- live market-context fetch code
- global prompt files outside this form room

Do not:

- wire this parser into runtime ingest
- write to the live DB
- call FMP live
- send alerts
- build site UI
- change the 15 event type list
- add new DB tables or columns
- modify this handoff document

If any of those changes seem necessary, stop and report the need in the room's
final handoff instead of making the change.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- all changed files are inside `lib/sources/sec/forms/8k-6k/`
- no live DB, FMP, ingest, alert, app, or UI files were changed
- tests use fixture JSON only

If the work discovers a new common rule, market-context need, integration need,
or special UI need, record it in the final handoff. Do not implement it outside
this form folder. This rule exists because other SEC form rooms may be working
in parallel; changing common, ingest, DB, app, UI, or alert files from this room
can create merge conflicts and can overwrite another room's work.

## Final Handoff

When done, report:

- changed files
- fixture cases tested
- parser/router/analysis outputs
- deterministic cases, if any
- market context assumptions, if any
- integration needs, if any
- special UI needs, if any

Do not wire this room into the live site. The SEC ingest/integration room will
handle that later.
