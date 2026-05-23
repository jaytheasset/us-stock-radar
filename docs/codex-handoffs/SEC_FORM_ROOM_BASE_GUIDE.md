# SEC Form Room Base Guide

This base guide applies to every form-specific SEC Codex room.

Each form room should also read its own handoff file.

## Core Flow

Target SEC filing flow:

```text
SEC raw filing
-> form parser
-> optional deterministic parser completion
-> router LLM prompt
-> optional deterministic router completion
-> market context attach
-> analysis LLM prompt
-> common score/action policy
-> DB/event storage
-> display_model_type based detail UI
```

Allowed completion paths:

```text
parser only
parser -> router LLM
parser -> router LLM -> market context -> analysis LLM
```

Runtime wiring is owned by the SEC common/integration room.

## What A Form Room Owns

A form room owns:

```text
form parser
form-specific types
fixtures
parser tests or parser-only QA script
router LLM prompt draft
analysis LLM prompt draft
NOTES.md for integration handoff
```

A form room does not own:

```text
runtime registry wiring
promptRegistry wiring
DB migrations
common market context code
common scoring policy
detail UI implementation
alert delivery
```

## Required Deliverables

Use these names where possible:

```text
parser.ts
types.ts
routerPrompt.ts
analysisPrompt.ts
fixtures/
parser.test.ts
NOTES.md
```

If a QA script is useful, add a parser-only script under:

```text
scripts/
```

The QA script must call parser code directly. It must not wire runtime ingestion.

## Canonical Event Types

The product taxonomy is `event_type`, not SEC form count.

Source of truth:

```text
lib/eventTypeRegistry.ts
```

Current event types:

```text
listing_risk
dilution_risk
earnings
sales_performance
product_update
leadership_governance
insider_ownership
shareholder_vote
strategic_transaction
financial_risk
legal_risk
dividends
capital_return
fda_clinical
other
```

Do not invent a new `event_type` from a form room. If a new type is needed, document it in `NOTES.md` and stop.

Use `other` only as a fallback with a clear reason.

## Form Type Is Not Display Type

Do not map UI by SEC form type.

Use:

```text
display_model_type
```

Examples:

```text
424B5 priced offering -> offering_terms
8-K Nasdaq notice -> listing_risk
10-Q going concern warning -> financial_risk
Form 4 insider purchase -> ownership
Proxy vote proposal -> governance/shareholder_vote
```

If a new display UI is needed, write it in `NOTES.md` and hand it to a display UI room.

## Common Score / Action Policy

Default SEC score thresholds:

```text
score < 50:
  action = archive
  store on ticker/detail history
  do not show on main feed
  do not send alerts

50 <= score < 75:
  action = feed
  show on feed/detail pages
  do not send alerts

score >= 75:
  action = feed_alert
  show on feed/detail pages
  eligible for alert delivery
```

Form rooms must use these semantics in router and analysis prompt drafts.

## Offering / Dilution Baseline

If a form can produce offering, dilution, resale, ATM, warrant, convertible, equity compensation, or overhang events, read the S-3 baseline:

```text
lib/sources/sec/forms/s3-f3/parser.ts
lib/prompts/secS3OfferingAnalysis.ts
lib/prompts/secOfferingAudit.ts
lib/secOfferingMarketContext.ts
docs/SEC_DILUTION_OFFERING_CONTRACT_DRAFT.md
```

Do not copy S-3 blindly. Use it so offering/dilution scores have comparable severity across forms.

Common offering/dilution fields:

```text
offering_amount
shares_offered
offering_price
discount_to_last_close
shares_offered_to_float
shares_offered_to_outstanding
offering_amount_to_market_cap
estimated_dilution_percent
resale_overhang_percent
warrant_or_convertible_overhang
ATM program size
closing timing
```

Parsers must not fetch market data. Extract filing-side facts only.

## Common JSON Envelope Direction

Prompt drafts should fit this direction:

```json
{
  "source_group": "filings",
  "source_form_type": "",
  "analysis_family": "",
  "event_type": "",
  "display_model_type": "",
  "score": 0,
  "severity": "",
  "confidence": "",
  "action": "",
  "summary": "",
  "why_it_matters": "",
  "key_points": [],
  "risks": [],
  "parser_facts": {},
  "router": {},
  "market_context": {},
  "display_model": {},
  "calendar_items": [],
  "debug": {
    "parser_version": "",
    "router_prompt_key": "",
    "router_prompt_version": "",
    "analysis_prompt_key": "",
    "analysis_prompt_version": ""
  }
}
```

Integration room owns final DB mapping.

## Read Before Editing

Every form room should inspect:

```text
lib/sources/sec/forms/README.md
lib/sources/sec/forms/common/forms.ts
lib/sources/sec/forms/common/parserContract.ts
lib/eventTypeRegistry.ts
```

Offering/dilution-related rooms should also inspect the S-3 baseline files listed above.

## Verification

Always run:

```powershell
npm.cmd run typecheck
```

Run form-specific parser QA/test if added.

## Commit Rules

Use one focused commit per form room when possible.

Suggested pattern:

```text
Add 8-K and 6-K SEC parser drafts
Add 424B SEC parser and prompt drafts
Add ownership SEC parser drafts
```

Do not commit unrelated changes.

## Stop Conditions

Stop and document in `NOTES.md` if the task needs:

```text
common contract changes
DB schema changes
event_type taxonomy changes
common scoring changes
runtime wiring
new detail UI implementation
S-3 parser changes
```

## NOTES.md Template

Each form room should include:

```text
extractable facts
unstable facts
router signal candidates
router LLM prompt caveats
analysis LLM prompt caveats
deterministic completion candidates
market context fields needed
score/action considerations
display_model_type candidates
new detail UI needs
integration-room wiring tasks
open questions
```
