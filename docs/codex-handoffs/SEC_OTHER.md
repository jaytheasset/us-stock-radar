# SEC Other Filing Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_OTHER.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for the Other SEC Filing fallback parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
other
```

Forms:

```text
Other SEC Filing
```

Editable folder:

```text
lib/sources/sec/forms/other/
```

## Likely Event Types

```text
other
```

Other event types may be proposed only when the fallback parser has enough evidence to route safely.

## Parser Focus

Extract generic normalized facts:

```text
form_type
accession_number
issuer/ticker/cik
filed date
document title
primary document text stats
recognized keywords
dates/deadlines
amounts/shares/prices if obvious
named parties
source URL
reason this form did not match a dedicated parser room
```

## Prompt Focus

Fallback should be conservative.

Router should prefer `other` or archive unless the filing clearly matches an existing canonical event type with source-backed evidence.

Document candidates for future dedicated parser rooms in `NOTES.md`.
