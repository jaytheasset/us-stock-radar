# SEC SC 13D / 13G Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_SC13.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for SC 13D / SC 13G parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
sc13
```

Forms:

```text
SC 13D
SC 13D/A
SC 13G
SC 13G/A
```

Editable folder:

```text
lib/sources/sec/forms/sc13/
```

## Likely Event Types

```text
insider_ownership
strategic_transaction
other
```

## Parser Focus

Extract:

```text
beneficial owner
issuer/ticker/cik
percent owned
shares beneficially owned
filing status 13D vs 13G
amendment number
ownership change amount
source of funds
Item 4 purpose of transaction
activist or strategic intent
agreements or group members
plans/proposals for control or transaction
```

## Prompt Focus

Router should distinguish passive ownership, activist/control intent, major holder increase/decrease, and amendment/noise.

Analysis should focus on changes in control, activism, strategic intent, and ownership size.
