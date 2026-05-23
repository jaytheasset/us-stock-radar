# SEC EFFECT Room

Read `docs/SEC_FORM_ROOM_RULES.md` first. Treat that file and this file as
fixed instructions. Do not edit either file from this room.

## Scope

This room covers only:

- `EFFECT`

Allowed working folder:

- `lib/sources/sec/forms/effect/`

## Work Flow

Build this form family in this order:

1. Parser
2. Router LLM prompt if needed
3. Analysis LLM prompt if needed
4. Fixture JSON tests

EFFECT can often finish deterministically because it usually means a related
registration filing became effective. If LLM is not needed, show that with a
fixture.

Every final result must use one of the approved 15 event types from
`docs/SEC_FORM_ROOM_RULES.md`.

## Testing

Use fixture JSON only.

Fixture tests may include sample parent filing context, but they must not query
the live DB.

Do not use the live database for this room. Do not create a local DB for this
room. Use files only.

## Do Not Do

Do not edit anything outside:

- `lib/sources/sec/forms/effect/`

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

- all changed files are inside `lib/sources/sec/forms/effect/`
- no live DB, FMP, ingest, alert, app, or UI files were changed
- tests use fixture JSON only

## Final Handoff

When done, report changed files, fixture cases tested, parser/router/analysis
outputs, deterministic cases, parent filing assumptions, integration needs, and
special UI needs.

Do not wire this room into the live site. The SEC ingest/integration room will
link EFFECT to the original analyzed filing later.

