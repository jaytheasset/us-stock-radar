# SEC NT Forms Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_NT.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for NT form parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
nt
```

Forms:

```text
NT 10-K
NT 10-Q
NT 20-F
```

Editable folder:

```text
lib/sources/sec/forms/nt/
```

## Likely Event Types

```text
financial_risk
earnings
other
```

## Parser Focus

Extract:

```text
late report type
original due date
expected filing date
reason for delay
anticipated material change in results
management statement about effort/expense
auditor/accounting references
going concern/liquidity/default references
calendar candidates
```

## Prompt Focus

Many NT filings may complete at router level. Use deterministic completion candidates for routine late filings with no material result change.

Escalate to analysis when the filing mentions accounting issues, liquidity risk, going concern, restatement, default, or material changes in results.
