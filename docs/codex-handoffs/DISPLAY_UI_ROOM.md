# Display UI Room Handoff

This handoff is for a detail UI Codex room.

Display UI rooms are organized by `display_model_type`, not by SEC form type.

## Start Message For The New Codex Room

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\DISPLAY_UI_ROOM.md and follow it.

This room is only for a display_model_type detail UI contract and implementation.
Do not edit SEC parsers, router prompts, analysis prompts, DB schema, common scoring, or alert delivery unless explicitly requested.

First identify the target display_model_type and inspect existing detail pages/components before editing.
```

## Ownership

This room owns:

```text
display_model_type contract
detail page UI for that display model
shared display components for that model
empty/loading/error states if relevant
browser verification for detail rendering
sample payloads for UI QA
```

This room does not own:

```text
SEC parser extraction
router LLM prompt logic
analysis LLM prompt logic
common score/action policy
market context calculation
DB migrations
alert delivery
```

## Display Model Principle

SEC form type is not the UI type.

The UI should render by:

```text
display_model_type
```

not by:

```text
source_form_type
```

Examples:

```text
S-3 resale registration -> resale_overhang UI
424B5 priced offering -> offering_terms UI
8-K Nasdaq notice -> listing_risk UI
10-Q going concern warning -> financial_risk UI
Form 4 insider purchase -> ownership UI
Proxy vote -> governance/shareholder_vote UI
```

Multiple SEC forms and news sources may reuse the same display UI.

## Common Event Types

The product event taxonomy lives in:

```text
lib/eventTypeRegistry.ts
```

Current canonical event types:

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

The display UI may support one event type or multiple related event types.

## Display Contract Location

Create or update a contract document under:

```text
docs/sec-display-models/
```

Suggested file names:

```text
docs/sec-display-models/OFFERING_TERMS.md
docs/sec-display-models/DIVIDENDS.md
docs/sec-display-models/LISTING_RISK.md
docs/sec-display-models/OWNERSHIP.md
docs/sec-display-models/FINANCIAL_RISK.md
docs/sec-display-models/STRATEGIC_TRANSACTION.md
```

The contract must define:

```text
display_model_type
supported event_type values
required JSON fields
optional JSON fields
field meanings
rendered sections
sample payload
fallback behavior for missing fields
source forms that may produce this model
```

## UI Implementation Areas

Inspect before editing:

```text
app/filings/[id]/page.tsx
app/events/[id]/page.tsx
app/news/archive/[id]/page.tsx
components/
app/globals.css
```

Prefer extracting reusable components if the display model will appear on more than one detail page.

Possible component location:

```text
components/sec-display/
```

Keep UI changes scoped to the target display model.

## Common Score / Action Policy

Display UI must respect the existing action semantics:

```text
score < 50:
  archive only
  ticker/detail history only

50 <= score < 75:
  feed only

score >= 75:
  feed plus alert eligible
```

The UI may show score/severity, but it must not change score/action policy.

## Market Context Display

If the display model uses market context, render it as supporting context.

Do not calculate market data in the UI.

Possible fields:

```text
last_close_price
market_cap
public_float
shares_outstanding
average_volume
recent_price_change
offering_amount_to_market_cap
shares_offered_to_float
discount_to_last_close
estimated_dilution_percent
```

If required market context is missing, render a graceful fallback.

## Detail UI Quality Rules

The UI should:

```text
show the actual investor-relevant facts first
show source/evidence snippets when useful
avoid form-type-specific assumptions
handle missing/null fields gracefully
avoid oversized marketing-style layouts
use dense but readable information structure
avoid nested cards inside cards
avoid overlapping text on mobile and desktop
```

Use existing app design conventions. Do not create a landing page.

## Sample Contract Skeleton

````md
# Display Model: offering_terms

## Purpose

Render priced offerings, shelf takedowns, ATM programs, resale overhang, or related dilution events.

## Supported Event Types

- dilution_risk
- strategic_transaction when offering-like consideration is present

## Required Fields

- display_model_type
- security_type
- offering_amount or shares_offered
- summary_items

## Optional Fields

- offering_price
- discount_to_last_close
- estimated_dilution_percent
- resale_overhang_percent
- use_of_proceeds
- closing_date
- market_context
- evidence

## Sample Payload

```json
{
  "display_model_type": "offering_terms",
  "security_type": "common_stock",
  "offering_amount": "$100,000,000",
  "shares_offered": "12,500,000",
  "offering_price": "$8.00",
  "estimated_dilution_percent": 18.4,
  "use_of_proceeds": "working capital",
  "evidence": []
}
```
````

## Verification

Always run:

```powershell
npm.cmd run typecheck
```

If frontend UI changed and a dev server is available, verify in browser:

```text
desktop detail page
mobile detail page
missing-field fallback
high-score item
archive-only item if relevant
```

Check console logs for React key warnings or rendering errors.

## Commit Rules

Use focused commits:

```text
Add offering terms display contract
Implement offering terms detail UI
Add listing risk display UI
```

Do not mix parser/prompt/runtime wiring with detail UI unless the user explicitly asks.

## Stop Conditions

Stop and report if:

```text
display_model_type is not defined
sample payload is missing or unclear
DB fields do not contain needed display_model data
new event_type is required
common score/action policy needs to change
parser or prompt changes are needed before UI can be correct
```

## Completion Checklist

Before finishing:

```text
display model contract created or updated
UI renders required fields
missing fields handled gracefully
mobile and desktop checked when possible
typecheck passes
browser verification completed when possible
git status has no out-of-scope changes
focused commit created
```
