# SEC S-8 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_S8.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for S-8 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
s8
```

Forms:

```text
S-8
S-8/A
```

Editable folder:

```text
lib/sources/sec/forms/s8/
```

## Likely Event Types

```text
dilution_risk
leadership_governance
other
```

## Parser Focus

Extract:

```text
plan name
plan type
shares registered
fee table
reoffer prospectus indicators
selling stockholders if present
prior registration references
evergreen or amendment language
issuer share class
current shares outstanding references
calendar candidates if any
```

## Prompt Focus

S-8 can be routine or meaningful dilution depending on size and context.

Read the S-3 offering/dilution baseline, but adapt it to equity compensation and plan registration context. Do not score routine small plan filings like urgent priced offerings.
