# SEC Proxy Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_PROXY.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for proxy parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
proxy
```

Forms:

```text
DEF 14A
DEFA14A
PRE 14A
PRER14A
PREC14A
```

Editable folder:

```text
lib/sources/sec/forms/proxy/
```

## Likely Event Types

```text
shareholder_vote
leadership_governance
strategic_transaction
dilution_risk
listing_risk
other
```

## Parser Focus

Extract:

```text
meeting date
record date
proposal list
proposal numbers
board recommendation
reverse split proposal
share issuance proposal
equity plan proposal
merger/acquisition vote
director elections
compensation vote
auditor ratification
vote result references if available
calendar candidates
```

## Prompt Focus

Router should distinguish routine annual proxy from investor-relevant votes.

Equity plan/share issuance/reverse split proposals may route to dilution_risk or listing_risk. Merger votes may route to strategic_transaction.
