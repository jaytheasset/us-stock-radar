# SEC Tender / CB / 13E3 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_TENDER_CB_13E3.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for tender / CB / 13E3 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
tender
```

Forms:

```text
SC TO-I
SC TO-T
SC TO-C
CB
SC 13E3
SC 13E3/A
```

Editable folder:

```text
lib/sources/sec/forms/tender/
```

## Likely Event Types

```text
strategic_transaction
financial_risk
insider_ownership
other
```

## Parser Focus

Extract:

```text
offer type
bidder/target
offer price
securities sought
expiration date/time
proration conditions
minimum/maximum tender conditions
withdrawal rights
financing condition
going-private indicators
special committee/fairness references
amendment changes
calendar candidates
```

## Prompt Focus

Router should distinguish tender offer, issuer tender, exchange offer, cross-border CB, and going-private 13E3.

Analysis should focus on price, control implications, deadline, conditions, and shareholder impact.
