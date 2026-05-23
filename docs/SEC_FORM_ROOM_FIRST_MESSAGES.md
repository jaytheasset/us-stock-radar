# SEC Form Room First Messages

Use these messages after opening each Codex room in its own project folder.

Do not paste these into the original main folder unless the room is meant to be
the main coordination room.

Each message is intentionally scoped to planning only. The room must read the
documents and give a plan before editing files.

Approved event types for every form room:

`listing_risk`, `dilution_risk`, `earnings`, `sales_performance`,
`product_update`, `leadership_governance`, `insider_ownership`,
`shareholder_vote`, `strategic_transaction`, `financial_risk`, `legal_risk`,
`dividends`, `capital_return`, `fda_clinical`, `other`.

## 8-K / 6-K

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-8k-6k
```

First message:

```text
This room is for SEC 8-K / 6-K, 8-K/A / 6-K/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_8K_6K_ROOM.md
- lib/sources/sec/forms/8k-6k/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/8k-6k/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Periodic Reports

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-periodic-reports
```

First message:

```text
This room is for SEC 10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_PERIODIC_REPORTS_ROOM.md
- lib/sources/sec/forms/periodic-reports/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/periodic-reports/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## NT Reports

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-nt
```

First message:

```text
This room is for SEC NT 10-K / NT 10-Q / NT 20-F.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_NT_ROOM.md
- lib/sources/sec/forms/nt/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/nt/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## S-1 / F-1

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-s1-f1
```

First message:

```text
This room is for SEC S-1 / F-1, S-1/A / F-1/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_S1_F1_ROOM.md
- lib/sources/sec/forms/s1-f1/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/s1-f1/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## S-3 / F-3

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-s3-f3
```

First message:

```text
This room is for SEC S-3 / F-3 / S-3ASR / F-3ASR, S-3/A / F-3/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_S3_F3_ROOM.md
- lib/sources/sec/forms/s3-f3/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/s3-f3/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

This folder already contains preserved S-3/F-3 work. Do not delete or rewrite existing work unless it is directly part of the S-3/F-3 task and you state it before editing.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## 424B

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-424b
```

First message:

```text
This room is for SEC 424B3 / 424B5.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_424B_ROOM.md
- lib/sources/sec/forms/424b/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/424b/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## S-8

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-s8
```

First message:

```text
This room is for SEC S-8 / S-8/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_S8_ROOM.md
- lib/sources/sec/forms/s8/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/s8/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## EFFECT

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-effect
```

First message:

```text
This room is for SEC EFFECT.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_EFFECT_ROOM.md
- lib/sources/sec/forms/effect/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/effect/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt if needed > analysis LLM prompt if needed > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use parent filing context only as fixture JSON. Do not query the live DB.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Ownership

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-ownership
```

First message:

```text
This room is for SEC Form 4 / 4/A, Form 144 / 144/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_OWNERSHIP_ROOM.md
- lib/sources/sec/forms/ownership/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/ownership/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## SC 13

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-sc13
```

First message:

```text
This room is for SEC SC 13D / SC 13D/A, SC 13G / SC 13G/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_SC13_ROOM.md
- lib/sources/sec/forms/sc13/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/sc13/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Proxy

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-proxy
```

First message:

```text
This room is for SEC Proxy.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_PROXY_ROOM.md
- lib/sources/sec/forms/proxy/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/proxy/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## 425

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-425
```

First message:

```text
This room is for SEC 425.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_425_ROOM.md
- lib/sources/sec/forms/425/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/425/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## S-4 / F-4

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-s4-f4
```

First message:

```text
This room is for SEC S-4 / F-4 / S-4/A / F-4/A.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_S4_F4_ROOM.md
- lib/sources/sec/forms/s4-f4/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/s4-f4/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Tender / CB / 13E3

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-tender-cb-13e3
```

First message:

```text
This room is for SEC Tender / CB / 13E3.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_TENDER_CB_13E3_ROOM.md
- lib/sources/sec/forms/tender/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/tender/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Form 25

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-form25
```

First message:

```text
This room is for SEC Form 25 / 25-NSE.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_FORM25_ROOM.md
- lib/sources/sec/forms/form25/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/form25/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt if needed > analysis LLM prompt if needed > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```

## Other SEC Filing

Project folder:

```text
C:\Users\PC\Documents\Codex\US-Stock-Radar-sec-other
```

First message:

```text
This room is for SEC Other SEC Filing.

First, read only these documents and this work folder:

- docs/SEC_FORM_ROOM_RULES.md
- docs/SEC_OTHER_ROOM.md
- lib/sources/sec/forms/other/

These MD files are rule documents. Do not edit them.

Only work inside lib/sources/sec/forms/other/.
Do not touch common, ingest, DB, app/UI, alerts, live FMP, or live DB.

Use only these 15 event types: listing_risk, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.

The target flow is parser > router LLM prompt > analysis LLM prompt > fixture JSON tests.
If a case can finish deterministically without LLM, prove it with a fixture.
Use market context only as fixture JSON. Do not call a live API.
Result JSON must follow the Required Output JSON shape in docs/SEC_FORM_ROOM_RULES.md.

First read the documents and folder, then give only the work plan.
Do not edit files yet.
```
