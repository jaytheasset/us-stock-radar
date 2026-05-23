# SEC Periodic Reports Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_PERIODIC_REPORTS.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for 10-K / 10-Q / 20-F parser, router prompt draft, and analysis prompt draft. Do not wire runtime ingestion or detail UI.
First inspect the repo structure and report a short plan before editing.
```

## Scope

Slug:

```text
periodic-reports
```

Forms:

```text
10-K
10-K/A
10-Q
10-Q/A
20-F
20-F/A
```

Editable folder:

```text
lib/sources/sec/forms/periodic-reports/
```

## Likely Event Types

```text
earnings
financial_risk
capital_return
leadership_governance
legal_risk
dilution_risk
sales_performance
product_update
fda_clinical
other
```

## Parser Focus

Extract:

```text
period covered
fiscal year/quarter
revenue/net income/EPS if available
guidance or outlook text
liquidity and cash runway
going concern language
debt/default/covenant warnings
material weakness/internal controls
risk factor changes
legal proceedings updates
share repurchase/dividend disclosures
equity issuance or dilution references
segment/product operating metrics
calendar candidates
```

## Prompt Focus

Router prompt should distinguish routine periodic reporting from material changes.

Analysis prompt should focus on new or changed investor-relevant disclosures, not boilerplate. Financial risk, earnings, and capital return are likely primary routes.

Offering/dilution can appear in periodic reports; use the S-3 baseline when dilution risk is routed.
