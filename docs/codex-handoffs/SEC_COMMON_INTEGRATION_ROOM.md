# SEC Common / Integration Room Handoff

This handoff is for the SEC common/foundation/integration Codex room.

This room owns shared contracts and runtime wiring. Form-specific rooms should not do this work.

## Start Message For The New Codex Room

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_COMMON_INTEGRATION_ROOM.md and follow it.

This room owns SEC parser integration, shared contracts, router/analysis runtime wiring, common market context, common scoring policy, DB/event storage mapping, and display model contract coordination.

Do not rewrite form-specific parser logic unless explicitly requested. First inspect the repo state and report a short plan before editing.
```

## Ownership

This room owns:

```text
shared SEC parser contracts
SEC form parser registry
runtime parser routing
router LLM runtime wiring
analysis LLM runtime wiring
promptRegistry integration
market context attachment
common score/action policy
DB/event/calendar storage mapping
display_model_type contract coordination
cross-form QA
browser verification after integration
```

This room does not own:

```text
deep form-specific parser extraction logic
form-specific prompt drafting before the form room finishes
detail UI implementation unless the user explicitly asks
```

## Source Of Truth Files

SEC form room map:

```text
lib/sources/sec/forms/common/forms.ts
```

Filing event type taxonomy:

```text
lib/eventTypeRegistry.ts
```

Common parser contract:

```text
lib/sources/sec/forms/common/parserContract.ts
```

S-3 offering/dilution baseline:

```text
lib/sources/sec/forms/s3-f3/parser.ts
lib/prompts/secS3OfferingAnalysis.ts
lib/prompts/secOfferingAudit.ts
lib/secOfferingMarketContext.ts
docs/SEC_DILUTION_OFFERING_CONTRACT_DRAFT.md
```

Existing runtime areas to inspect:

```text
lib/prompts/secFilingAnalysisPackage.ts
lib/ai/secFilingAnalysisPreview.ts
lib/secFilingAnalysisIngest.ts
lib/promptRegistry.ts
lib/secOfferingMarketContext.ts
app/filings/[id]/page.tsx
app/events/[id]/page.tsx
```

## Product Flow

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

Deterministic completion is allowed only when the rule is stable, explainable, source-backed, and covered by tests.

## Canonical Event Types

The product taxonomy is `event_type`, not SEC form count.

Every SEC route/analysis result must normalize to one of the 15 event types in `lib/eventTypeRegistry.ts`:

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

Do not add a new event type casually. If a new type is needed, update taxonomy, UI, storage mapping, scoring expectations, and tests together.

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

This policy must remain consistent across form families unless the user explicitly changes it.

## Offering / Dilution Baseline

Offering/dilution-related forms must share severity semantics with S-3.

High-priority affected forms include:

```text
s3-f3
424b
s1-f1
s8
s4-f4
425
8k-6k
periodic-reports
tender
other when it produces offering/dilution risk
```

Use the S-3 scoring/prompt context as baseline, but do not blindly copy S-3 logic into unrelated forms.

Common offering/dilution signals:

```text
offering_amount_to_market_cap
shares_offered_to_float
shares_offered_to_outstanding
discount_to_last_close
estimated_dilution_percent
resale_overhang_percent
warrant_or_convertible_overhang
ATM program size
underwriter discount
pricing certainty
closing timing
```

## Common JSON Envelope

Integration should normalize parser/router/analysis output toward this envelope:

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

Allowed actions:

```text
archive
feed
feed_alert
needs_human_review
```

## Display Model Coordination

Display UI is owned by display UI rooms, not form rooms.

This integration room owns the mapping between:

```text
event_type
display_model_type
display_model JSON contract
detail page rendering path
```

If a form room proposes `needs_display_model_review`, create or update a display model contract under:

```text
docs/sec-display-models/
```

Then hand the contract to the appropriate display UI room.

## Integration Process

For each completed form room:

```text
1. Inspect that form room commit and NOTES.md.
2. Confirm parser files are isolated to its form folder.
3. Confirm parser QA/typecheck passed.
4. Register parser in common registry.
5. Wire router prompt if ready.
6. Wire analysis prompt if ready.
7. Attach market context only when needed.
8. Map output to common score/action policy.
9. Map output to DB/event/calendar storage.
10. Confirm display_model_type has a UI contract.
11. Run typecheck and relevant QA.
12. Verify representative pages in browser.
13. Commit integration separately per form family when possible.
```

## Commit Rules

Prefer small commits:

```text
Add SEC parser registry
Wire 424B SEC parser
Wire 424B router prompt
Wire 424B analysis prompt
Map 424B display model storage
```

Do not mix unrelated form families in one commit unless the user asks.

## Verification

Always run:

```powershell
npm.cmd run typecheck
```

Run form-specific QA scripts where available:

```powershell
node scripts/qa-sec-s3-parser.mjs --source=db
node scripts/qa-sec-424b-parser.mjs
```

After runtime integration, verify:

```text
filing detail page
event detail page
feed visibility for score >= 50
archive-only behavior for score < 50
alert eligibility for score >= 75
calendar items if the form emits dated triggers
admin prompt/test pages if prompt wiring changed
```

## Stop Conditions

Stop and ask the user if:

```text
multiple form rooms changed the same common contract incompatibly
DB schema change is required
event_type taxonomy change is required
score/action policy change is required
display UI contract is missing for a high-priority event
tests show S-3 behavior regressed
```

## Completion Checklist

Before finishing:

```text
all intended form outputs wired
common event_type taxonomy respected
score/action thresholds respected
market context attached only where needed
display_model_type contract exists
storage mapping verified
typecheck passes
relevant QA passes
browser verification completed when UI/storage changed
git status clean
focused commit created
```
