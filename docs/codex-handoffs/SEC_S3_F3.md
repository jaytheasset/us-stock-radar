# SEC S-3 / F-3 Room Handoff

Read this file and `SEC_FORM_ROOM_BASE_GUIDE.md`.

This room is special because existing S-3 behavior already exists and must be preserved.

## Start Message

```text
Read C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_S3_F3.md and C:\Users\PC\Documents\Codex\US-Stock Radar\docs\codex-handoffs\SEC_FORM_ROOM_BASE_GUIDE.md, then follow them.

This room is only for the S-3 / F-3 family parser, router prompt draft, and analysis prompt draft.
Existing S-3 behavior must be preserved.
Do not wire new runtime ingestion or detail UI unless explicitly requested.

First inspect the current S-3 implementation and report a short plan before editing.
```

## Scope

Slug:

```text
s3-f3
```

Forms assigned by `lib/sources/sec/forms/common/forms.ts`:

```text
S-3
S-3/A
F-3
F-3/A
S-3ASR
F-3ASR
```

Editable folder:

```text
lib/sources/sec/forms/s3-f3/
```

## Current Code Reality

The common form registry already assigns both S-3 and F-3 forms to `s3-f3`.

However, the current parser implementation is S-3-only in practice.

Current parser file:

```text
lib/sources/sec/forms/s3-f3/parser.ts
```

Current S-3 support:

```text
S-3
S-3/A
S-3ASR
```

Current F-3 support status:

```text
F-3: not implemented in parser logic yet
F-3/A: not implemented in parser logic yet
F-3ASR: not implemented in parser logic yet
```

Evidence from current code:

```text
canonicalS3FormType only returns S-3, S-3/A, S-3ASR.
isS3Family matches only /^S-3(?:ASR|\/A)?$/.
readFormTypeFromTitle only recognizes S-3ASR, S-3/A, S-3.
S-3 amendment logic only treats S-3/A as amendment.
QA scripts default to S-3,S-3ASR,S-3/A.
Runtime hard-parser selection currently matches only S-3 family regex.
```

Therefore, do not claim F-3 is complete until parser, QA, and runtime selection are updated and tested.

## Existing Runtime References To Preserve

Before editing, inspect:

```text
lib/sources/sec/forms/s3-f3/parser.ts
lib/prompts/secFilingAnalysisPackage.ts
lib/ai/secFilingAnalysisPreview.ts
lib/prompts/secS3OfferingAnalysis.ts
lib/prompts/secS3AmendmentTriage.ts
lib/prompts/secOfferingAudit.ts
lib/secOfferingMarketContext.ts
scripts/qa-sec-s3-parser.mjs
scripts/qa-sec-s3-offering-analysis.mjs
docs/SEC_DILUTION_OFFERING_CONTRACT_DRAFT.md
```

The current S-3 parser is the baseline for offering/dilution scoring and should not regress.

## Likely Event Types

```text
dilution_risk
strategic_transaction
financial_risk
other
```

S-3/F-3 family filings should usually route to `dilution_risk` when they contain shelf, resale, ATM, warrant, convertible, or concrete offering mechanics.

Use `other` or archive only when the filing is routine, administrative, or not investor-relevant.

## Parser Focus

Preserve and improve extraction for:

```text
registration statement kind
automatic shelf status
registration status
prospectus status
amendment metadata
registration number
primary_or_resale
securities registered
shares registered
resale share count
current shares outstanding
selling stockholders
fee table rows/totals
ATM program size
shelf capacity
warrant coverage
convertible terms
use of proceeds
plan of distribution
private placement references
routine amendment signals
material amendment signals
calendar candidates
```

For F-3 support, evaluate whether the same extraction patterns apply with form labels changed from S-3 to F-3.

Do not simply rename S-3 to F-3 without tests.

## Router Prompt Focus

The router prompt should distinguish:

```text
base shelf registration
automatic shelf registration
resale registration
ATM program
priced/takedown supplement if present
warrant or convertible overhang
routine amendment
material amendment
needs_human_review
```

Existing S-3/A triage behavior should be preserved unless the user explicitly asks to redesign it.

If F-3 amendment behavior differs, document it in `NOTES.md`.

## Analysis Prompt Focus

This family is the offering/dilution baseline for other form rooms.

Analysis prompt behavior must preserve common score semantics:

```text
score < 50 -> archive
50 <= score < 75 -> feed
score >= 75 -> feed_alert
```

Keep scoring comparable for:

```text
S-3 offering score 80
F-3 offering score 80
424B5 offering score 80
S-8 dilution score 80
```

These should represent comparable dilution/offering severity.

## F-3 Implementation Notes

If this room adds F-3 support, update or propose updates for:

```text
canonical form recognition
is family regex
title/document form detection
amendment detection for F-3/A
automatic shelf detection for F-3ASR if applicable
QA formTypes defaults
runtime hard-parser selection
prompt wording if F-3 is included in the same prompt
fixtures or DB samples for F-3/F-3/A/F-3ASR
```

Do not wire runtime selection in this form room unless explicitly requested. If runtime changes are needed, document them in `NOTES.md` for the integration room.

## Required QA

Always run:

```powershell
npm.cmd run typecheck
node scripts/qa-sec-s3-parser.mjs --source=db
```

If F-3 support is added, add fixed F-3 fixtures or a QA path before claiming support.

Suggested future QA:

```powershell
node scripts/qa-sec-s3-parser.mjs --source=db --formTypes=S-3,S-3ASR,S-3/A,F-3,F-3/A,F-3ASR
```

Only use live SEC samples as supplementary checks because live samples can change.

## Completion Checklist

Before finishing:

```text
existing S-3 QA still passes
typecheck passes
S-3/A routine amendment behavior preserved
S-3 offering/dilution scoring semantics preserved
F-3 support status clearly documented
new F-3 support has fixtures or QA if implemented
NOTES.md lists integration-room wiring needs
git status has no out-of-scope changes
focused commit created
```

## NOTES.md Must Include

```text
current S-3 support status
current F-3 support status
parser changes made
router prompt changes made
analysis prompt changes made
F-3 runtime wiring needs
F-3 fixture/QA gaps
offering/dilution scoring considerations
display_model_type candidates
integration-room wiring tasks
open questions
```
