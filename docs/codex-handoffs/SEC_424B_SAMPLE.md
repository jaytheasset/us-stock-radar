# SEC Form Room Handoff Guide Sample: 424B3 / 424B5

This is a complete sample handoff guide for one SEC form room. Use this format when generating the rest of the SEC form handoff documents.

This sample is for `424B3` / `424B5`, but the same structure should be reused for other form rooms.

## Start Message For The New Codex Room

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_424B_SAMPLE.md and follow it.

This room is only for the 424B3 / 424B5 parser, router LLM prompt draft, and analysis LLM prompt draft.
Do not wire runtime ingestion, do not change DB schema, do not change common scoring, and do not implement detail UI in this room.

First inspect the current repo structure, then report a short plan before editing.
```

## Big Picture

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

Important exception:

Some filings do not need every step. A form may finish at parser output or router output if the result is stable, deterministic, explainable, and source-backed.

Allowed completion paths:

```text
parser only
parser -> router LLM
parser -> router LLM -> market context -> analysis LLM
```

Runtime completion rules are owned by the integration room. This form room may only propose them in `NOTES.md`.

## Room Scope

Assigned SEC forms:

```text
424B3
424B5
```

Current room phases:

```text
Phase 1: parser
Phase 2: router LLM prompt draft
Phase 3: analysis LLM prompt draft
Phase 4: notes for integration, scoring, market context, and display UI needs
```

This room does not connect anything to production runtime.

## Allowed Files

Primary editable area:

```text
lib/sources/sec/forms/424b/
```

Expected files:

```text
lib/sources/sec/forms/424b/parser.ts
lib/sources/sec/forms/424b/types.ts
lib/sources/sec/forms/424b/routerPrompt.ts
lib/sources/sec/forms/424b/analysisPrompt.ts
lib/sources/sec/forms/424b/fixtures/
lib/sources/sec/forms/424b/parser.test.ts
lib/sources/sec/forms/424b/NOTES.md
```

Optional parser-only QA script:

```text
scripts/qa-sec-424b-parser.mjs
```

The QA script must call the parser directly. It must not wire runtime ingestion.

## Do Not Edit

Do not edit these files or areas from this room:

```text
lib/sources/sec/forms/s3-f3/parser.ts
lib/ai/secFilingAnalysisPreview.ts
lib/prompts/secFilingAnalysisPackage.ts
lib/promptRegistry.ts
lib/secFilingAnalysisIngest.ts
lib/secOfferingMarketContext.ts
lib/prompts/secOfferingAudit.ts
app/
docs/db/
```

If a shared change is required, document the request in `lib/sources/sec/forms/424b/NOTES.md` and stop.

## Read First

Before editing, inspect these files:

```text
lib/sources/sec/forms/README.md
lib/sources/sec/forms/common/parserContract.ts
lib/sources/sec/forms/common/forms.ts
lib/sources/sec/forms/s3-f3/parser.ts
scripts/qa-sec-s3-parser.mjs
docs/SEC_DILUTION_OFFERING_CONTRACT_DRAFT.md
lib/secOfferingMarketContext.ts
lib/prompts/secS3OfferingAnalysis.ts
lib/prompts/secOfferingAudit.ts
```

Use the S-3 implementation as the current offering/dilution baseline. Do not modify it.

## Form Type Is Not Display Type

SEC form type is only the source document type.

The site display must be decided by analysis result fields:

```text
source_form_type = SEC source form, such as 424B5
analysis_family = broad analysis family, such as offering
event_type = site event classification, such as dilution_risk
display_model_type = detail UI contract, such as offering_terms
```

Do not assume every `424B5` goes to the same detail page.

Examples:

```text
424B5 priced equity offering -> offering_terms display
424B5 debt offering -> debt_offering display
424B5 resale prospectus -> resale_overhang display
424B5 ATM supplement -> atm_program display
424B3 sparse supplement -> generic_sec_event or needs_display_model_review
```

## SEC Form Rooms Are Work Units

The source of truth is:

```text
lib/sources/sec/forms/common/forms.ts
```

SEC form rooms are work units for parallel development. Their count is not the product taxonomy.

The current code defines these parser room slugs:

```text
8k-6k
periodic-reports
nt
s1-f1
s3-f3
424b
s8
effect
ownership
sc13
proxy
425
s4-f4
tender
form25
other
```

A form room may cover one form or many related forms. The exact number of form rooms can change if it helps development.

Every form room handoff must name its exact slug from this list. Do not invent new form room slugs without updating the common forms registry in an integration/foundation room.

## Canonical Filing Event Types Are The Product Taxonomy

The important taxonomy is `event_type`, not the SEC form room count.

The source of truth is:

```text
lib/eventTypeRegistry.ts
```

The code currently defines 15 filing event types, including `other`:

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

Router and analysis prompt drafts must choose `event_type` from this taxonomy.

Form room count does not matter. Every form-specific parser/router/analysis path must normalize its final result to one of these 15 event types.

Examples:

```text
424B5 priced offering -> dilution_risk
8-K Nasdaq notice -> listing_risk
10-Q going concern warning -> financial_risk
Form 4 insider purchase -> insider_ownership
Proxy vote proposal -> shareholder_vote
```

Do not invent a new `event_type` inside a form room. If the taxonomy is missing a needed type, document it in `NOTES.md` and stop. Use `other` only as a fallback with a clear reason.

## Parser Goal

The parser should extract source-backed facts and evidence for the router and LLM prompts.

Initial extraction candidates:

```text
form_type
accession_number
issuer
ticker
prospectus_type
supplement_type
offering_type
security_type
primary_or_resale
offering_amount
shares_offered
offering_price
pricing_date
closing_date
gross_proceeds
net_proceeds
underwriter_discount
discount_to_market_reference
atm_program_size
shelf_registration_reference
registration_number
selling_stockholders
resale_share_count
warrant_terms
convertible_terms
debt_terms
use_of_proceeds
plan_of_distribution
risk_factor_excerpt
fee_table
calendar_candidates
```

Prefer this field shape when possible:

```ts
{
  value: "...",
  evidence: "...",
  confidence: "high" | "medium" | "low"
}
```

Evidence should preserve a short source sentence, table row, or fragment from the SEC filing.

## Router LLM Prompt Goal

Draft the router prompt here:

```text
lib/sources/sec/forms/424b/routerPrompt.ts
```

Do not register it in `promptRegistry.ts`.

The router prompt should decide:

```text
whether the filing can complete deterministically
whether the filing should be archived without analysis LLM
analysis_family
event_type candidate from lib/eventTypeRegistry.ts
display_model_type candidate
whether market context is needed
which market context fields are needed
which analysis prompt should run next
route confidence
source-backed route evidence
```

424B router signal candidates:

```text
priced_equity_offering
priced_debt_offering
resale_prospectus
atm_takedown
prospectus_supplement_only
warrant_or_convertible_overhang
selling_stockholder_overhang
routine_supplement
needs_human_review
```

Router output draft should be strict JSON.

Suggested shape:

```json
{
  "route_action": "run_analysis",
  "analysis_family": "offering",
  "event_type": "dilution_risk",
  "display_model_type": "offering_terms",
  "analysis_prompt_key": "sec_424b_offering_analysis",
  "needs_market_context": true,
  "market_context_fields": ["last_close_price", "market_cap", "public_float", "shares_outstanding"],
  "confidence": "medium",
  "reasons": [],
  "evidence": []
}
```

Possible `route_action` values:

```text
complete_archive
complete_feed
run_analysis
needs_human_review
```

This room only drafts the shape. Integration room owns final runtime route handling.

## Deterministic Completion Rules

Some filings can be completed without an analysis LLM if the rule is stable and evidence-backed.

Allowed examples:

```text
purely administrative supplement with no investor-relevant event
known routine form with no material terms
exact structured filing where the parser fully determines the action
```

Do not implement deterministic runtime completion here. Put proposals in `NOTES.md`.

Document:

```text
rule name
trigger conditions
required parser facts
why no LLM is needed
expected score/action if applicable
examples
edge cases
```

## Analysis LLM Prompt Goal

Draft the analysis prompt here:

```text
lib/sources/sec/forms/424b/analysisPrompt.ts
```

Do not register it in `promptRegistry.ts`.

The analysis prompt should include:

```text
task description
input parser facts contract
router decision input
market context usage rules
skip/archive/feed/alert score semantics
event_type candidates from lib/eventTypeRegistry.ts
display_model_type candidates
strict JSON output schema draft
form-specific caveats
```

The LLM must treat parser facts as source-backed candidate evidence, not unquestioned truth.

## Common Score Action Policy

Score meaning is common across SEC filing analysis unless integration policy changes it later.

Use these thresholds consistently:

```text
score < 50:
  archive only
  store on ticker/detail history
  do not show on main feed
  do not send alerts

50 <= score < 75:
  feed only
  show on feed/detail pages
  do not send alerts

score >= 75:
  feed plus alert eligible
  show on feed/detail pages
  eligible for alert delivery
```

This room must not implement feed storage or alert delivery.

Router and analysis prompt drafts should use the thresholds above.

## Offering / Dilution Scoring Reference

If this form can produce dilution, offering, resale, ATM, warrant, convertible, or overhang events, it must follow the existing S-3 offering/dilution scoring baseline.

For `424B3` / `424B5`, this reference is required.

Read:

```text
lib/secOfferingMarketContext.ts
docs/SEC_DILUTION_OFFERING_CONTRACT_DRAFT.md
lib/sources/sec/forms/s3-f3/parser.ts
lib/prompts/secS3OfferingAnalysis.ts
lib/prompts/secOfferingAudit.ts
```

Do not copy the S-3 prompt blindly. Use it as the baseline so offering/dilution scores mean the same thing across forms.

Important principle:

```text
S-3 offering score 80
424B5 offering score 80
S-8 dilution score 80
```

These scores should have comparable severity meaning when they describe offering/dilution risk.

For offering/dilution forms, parser and prompt drafts should support:

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

The form parser must not fetch market data directly. It should extract the filing-side inputs. Common market context attaches market-side values later.

## Market Context Rules

Market context is common infrastructure. This room does not modify common market context code.

The parser and prompts should identify which market context fields are needed:

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

This room is responsible for:

```text
extracting filing-side facts needed by market context
documenting missing market context needs in NOTES.md
not fetching live market data inside the parser
```

## Common DB / JSON Envelope Direction

Do not change DB schema in this room.

Prompt drafts should follow this common envelope direction:

```json
{
  "source_group": "filings",
  "source_form_type": "424B5",
  "analysis_family": "offering",
  "event_type": "dilution_risk",
  "display_model_type": "offering_terms",
  "score": 82,
  "severity": "high",
  "confidence": "medium",
  "action": "feed_alert",
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

Possible `action` values:

```text
archive
feed
feed_alert
needs_human_review
```

Integration room owns final envelope, DB mapping, and storage.

## Display Model / Detail UI Rules

Detail UI is not owned by form rooms.

Detail UI should be built in separate rooms by `display_model_type`, for example:

```text
ui/display-offering
ui/display-dividends
ui/display-listing-risk
ui/display-ownership
ui/display-governance
ui/display-earnings
ui/display-transaction
ui/display-generic-sec-event
```

Possible 424B display model candidates:

```text
offering_terms
debt_offering
resale_overhang
atm_program
convertible_or_warrant_overhang
generic_sec_event
needs_display_model_review
```

If a display model contract exists, follow it:

```text
docs/sec-display-models/
```

If no display contract exists, do not create UI. Add a request to `NOTES.md`.

Example:

```text
display_model_type: "needs_display_model_review"
reason: "424B5 debt offering needs a debt_offering display model contract."
```

## Fixtures And Tests

Minimum fixtures:

```text
one 424B5 priced equity offering
one 424B5 resale or ATM-related filing
one 424B5 debt or non-equity offering if available
one 424B3 prospectus/supplement
one sparse or edge case
```

Recommended parser checks:

```text
recognizes 424B family
extracts primary document text
extracts offering/security type
extracts offering amount or share count when present
extracts price/discount when present
extracts use of proceeds when present
extracts selling stockholders when table exists
extracts fee table when available
emits router signal candidates
does not throw on sparse prospectus supplement
```

Recommended prompt checks:

```text
router prompt has strict JSON schema draft
analysis prompt has strict JSON schema draft
score thresholds match common policy
offering/dilution prompt references S-3 scoring baseline
display_model_type is separated from form_type
market context needs are explicit
```

## Verification Commands

Always run:

```powershell
npm.cmd run typecheck
```

If a QA script is added:

```powershell
node scripts/qa-sec-424b-parser.mjs
```

Live SEC samples can change. Prefer fixed fixtures or DB samples for regression checks.

## Completion Checklist

Before finishing:

```text
parser.ts added
types.ts added
routerPrompt.ts draft added
analysisPrompt.ts draft added
fixtures added
parser test or QA script added
NOTES.md documents integration requests
npm.cmd run typecheck passes
parser QA passes
git status has no out-of-scope changes
one focused commit created
```

Suggested commit message:

```text
Add 424B SEC parser and prompt drafts
```

## Stop Conditions

Stop and document the need in `NOTES.md` if the work requires:

```text
common parser contract changes
DB schema changes
common market context changes
common scoring policy changes
runtime ingest wiring
promptRegistry wiring
new detail UI implementation
S-3 parser changes
```

## NOTES.md Template

`lib/sources/sec/forms/424b/NOTES.md` should summarize:

```text
extractable facts
unstable facts
router signal candidates
router LLM prompt caveats
analysis LLM prompt caveats
deterministic completion candidates
market context fields needed
offering/dilution scoring considerations
score/action threshold considerations
display_model_type candidates
new detail UI needs
integration-room wiring tasks
open questions
```
