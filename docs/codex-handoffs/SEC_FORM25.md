# SEC Form 25 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM25.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for Form 25 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
form25
```

Forms:

```text
25
25-NSE
Form 25
Form 25-NSE
```

Editable folder:

```text
lib/sources/sec/forms/form25/
```

## Likely Event Types

```text
listing_risk
strategic_transaction
other
```

## Parser Focus

Extract:

```text
exchange
security class
ticker
delisting effective date
registration withdrawal effective date
voluntary vs exchange-initiated delisting
reason for delisting if present
merger/acquisition related delisting indicators
rule references
calendar candidates
```

## Prompt Focus

Many Form 25 filings can be deterministic or router-complete.

Router should distinguish routine post-merger delisting, voluntary deregistration, and listing-risk/delisting event.
