# SEC S-1 / F-1 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_S1_F1.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for S-1 / F-1 parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
s1-f1
```

Forms:

```text
S-1
S-1/A
F-1
F-1/A
```

Editable folder:

```text
lib/sources/sec/forms/s1-f1/
```

## Likely Event Types

```text
dilution_risk
financial_risk
strategic_transaction
other
```

## Parser Focus

Extract:

```text
IPO vs resale vs primary registration
shares offered
price range
offering amount
use of proceeds
selling stockholders
dilution table
capitalization table
underwriters
lock-up terms
warrant/convertible terms
risk factor excerpts
fee table
expected pricing/effective dates
calendar candidates
```

## Prompt Focus

This is an offering/dilution-heavy room. Read the S-3 offering/dilution baseline before drafting prompts.

Router should distinguish IPO/new listing, resale registration, primary offering, and routine amendment.

Analysis should use common score semantics for dilution and overhang.
