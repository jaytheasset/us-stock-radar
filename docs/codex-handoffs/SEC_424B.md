# SEC 424B Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_424B.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for 424B3 / 424B5 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
424b
```

Forms:

```text
424B3
424B5
```

Editable folder:

```text
lib/sources/sec/forms/424b/
```

## Likely Event Types

```text
dilution_risk
strategic_transaction
financial_risk
other
```

## Parser Focus

Extract:

```text
prospectus type
supplement type
offering type
security type
primary_or_resale
offering amount
shares offered
offering price
pricing date
closing date
gross/net proceeds
underwriter discount
ATM program size
shelf registration reference
selling stockholders
warrant/convertible/debt terms
use of proceeds
plan of distribution
fee table
calendar candidates
```

## Prompt Focus

This is an offering/dilution-heavy room. Read the S-3 offering/dilution baseline before drafting prompts.

Router should distinguish priced equity offering, debt offering, resale prospectus, ATM takedown, sparse supplement, and routine supplement.

Use `SEC_424B_SAMPLE.md` as the full-format example if more detail is needed.
