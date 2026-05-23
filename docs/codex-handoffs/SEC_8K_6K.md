# SEC 8-K / 6-K Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_8K_6K.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for the 8-K / 6-K parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
8k-6k
```

Forms:

```text
8-K
8-K/A
6-K
6-K/A
```

Editable folder:

```text
lib/sources/sec/forms/8k-6k/
```

## Likely Event Types

```text
listing_risk
dilution_risk
earnings
sales_performance
product_update
leadership_governance
shareholder_vote
strategic_transaction
financial_risk
legal_risk
dividends
capital_return
fda_clinical
other
```

## Parser Focus

Extract:

```text
form item numbers
item titles
exhibit references
event date
issuer/ticker/cik
Nasdaq/listing notices
financing or securities issuance terms
material agreement details
leadership/auditor/governance changes
earnings release and guidance references
shareholder vote results
dividend/capital return announcements
clinical/FDA disclosures
bankruptcy/default/liquidity warnings
legal/regulatory actions
calendar candidates
```

## Prompt Focus

Router prompt should decide which event type owns the disclosure, because 8-K/6-K is a broad container.

Analysis prompt should be event-specific after routing. It must avoid treating every exhibit or generic press release as investor-critical.

Offering/dilution references are possible, so read the S-3 offering/dilution baseline when drafting financing routes.
