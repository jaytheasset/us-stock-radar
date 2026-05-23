# SEC EFFECT Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_EFFECT.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for EFFECT parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
effect
```

Forms:

```text
EFFECT
```

Editable folder:

```text
lib/sources/sec/forms/effect/
```

## Likely Event Types

```text
dilution_risk
strategic_transaction
other
```

## Parser Focus

Extract:

```text
effective date/time
registration number
related form type
related accession number if present
issuer/ticker/cik
SEC file number
source URL
linked registration context needs
```

## Prompt Focus

EFFECT may often complete deterministically or at router level.

Its importance depends on the related registration statement. Document what related filing context is required from integration. Do not fetch or wire parent context in this room.
