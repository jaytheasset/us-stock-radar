# SEC Ownership Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_OWNERSHIP.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for Form 4 / Form 144 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
ownership
```

Forms:

```text
4
4/A
Form 4
Form 4/A
144
144/A
Form 144
Form 144/A
```

Editable folder:

```text
lib/sources/sec/forms/ownership/
```

## Likely Event Types

```text
insider_ownership
other
```

## Parser Focus

Extract:

```text
reporting owner
issuer/ticker/cik
owner relationship
transaction date
transaction code
buy/sell/acquire/dispose classification
shares transacted
price
post-transaction ownership
direct/indirect ownership
10b5-1 plan indicators
derivative security details
Form 144 planned sale amount
broker/market maker if present
```

## Prompt Focus

Many ownership filings can be deterministic if structured fields are reliable.

Router should distinguish insider purchase, insider sale, award/grant, option exercise, planned sale, and amendment/noise.

Analysis should avoid over-scoring routine compensation grants.
