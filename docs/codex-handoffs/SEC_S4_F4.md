# SEC S-4 / F-4 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_S4_F4.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for S-4 / F-4 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
s4-f4
```

Forms:

```text
S-4
S-4/A
F-4
F-4/A
```

Editable folder:

```text
lib/sources/sec/forms/s4-f4/
```

## Likely Event Types

```text
strategic_transaction
shareholder_vote
dilution_risk
financial_risk
other
```

## Parser Focus

Extract:

```text
transaction parties
deal type
consideration
exchange ratio
cash/stock mix
securities registered
shares to be issued
ownership after transaction
meeting/vote date
record date
conditions
termination fees
risk factors
financial statements/pro forma references
calendar candidates
```

## Prompt Focus

Router should distinguish merger registration, exchange offer, shareholder vote, and amendment/noise.

Stock consideration can create dilution/ownership impact, so read the S-3 baseline for scoring when issuance impact matters.
