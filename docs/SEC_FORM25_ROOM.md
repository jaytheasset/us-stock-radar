# SEC Form 25 Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit either file from this room.

## Scope

This room covers only:

- `Form 25 / 25-NSE`

Allowed working folder:

- `lib/sources/sec/forms/form25/`

## Work Flow

Build this form family in this order:

1. Parser
2. Router LLM prompt when needed
3. Analysis LLM prompt when needed
4. Fixture JSON tests

Some cases may finish deterministically in the parser or router when LLM is not
needed. If that happens, show it with a fixture.

Use LLM when the investor impact is unclear or common equity delisting risk is
possible.

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

- `lib/sources/sec/forms/form25/`

Do not edit common, ingest, DB, app, UI, alert, live market-context, or global
prompt files outside this form room.

Do not wire this parser into runtime ingest, write to live DB, call FMP live,
send alerts, build site UI, change the 15 event type list, add DB tables or
columns, or modify this handoff document.

If any of those changes seem necessary, stop and report the need in the final
handoff. This rule exists because other SEC form rooms may be working in
parallel; changing shared files from this room can create merge conflicts and
can overwrite another room's work.

## Required Reminders While Working

Before editing files, state the exact files that will be changed.

Before every commit, confirm:

- all changed files are inside `lib/sources/sec/forms/form25/`
- no live DB, FMP, ingest, alert, app, or UI files were changed
- tests use fixture JSON only

## Final Handoff

When done, report changed files, fixture cases tested, parser/router/analysis
outputs, deterministic cases, market context assumptions, integration needs, and
special UI needs.

Do not wire this room into the live site. The SEC ingest/integration room will
handle that later.

