# S-3 / F-3 Form Room Notes

## Current S-3 Support Status

The existing `parseSecS3Filing` contract and S-3-focused type names are preserved. S-3, S-3/A, and S-3ASR remain the runtime baseline for offering/dilution extraction, amendment triage evidence, fee table parsing, selling-stockholder parsing, and market-context handoff.

## Current F-3 Support Status

Parser-level F-3 recognition now covers `F-3`, `F-3/A`, and `F-3ASR` for canonical form detection, title/document form detection, family membership, amendment detection, automatic shelf detection, issuer cover reads, and the shared offering extraction patterns used by S-3.

F-3 runtime ingestion and prompt selection are not wired in this room.

## Parser Changes Made

- Extended canonical family recognition from `S-3` only to `S-3/F-3`.
- Treated `F-3/A` as an amendment for amendment number, registration number, limited-scope signals, changed-term signals, added exhibits, and router payload.
- Treated `F-3ASR` as an automatic shelf form alongside `S-3ASR`.
- Generalized Form S-3 cover-form and issuer extraction to S-3/F-3 labels.
- Added fixed fixtures for F-3 resale, routine F-3/A amendment, and F-3ASR automatic shelf behavior.

## Router Prompt Changes Made

Added `routerPrompt.ts` as an unwired draft. It distinguishes base shelf registration, automatic shelf registration, resale registration, ATM program, priced/takedown supplement, warrant or convertible overhang, routine amendment, material amendment, `needs_human_review`, and `other`.

## Analysis Prompt Changes Made

Added `analysisPrompt.ts` as an unwired draft. It preserves the common score/action thresholds and keeps S-3/F-3 offering severity comparable with 424B5 and S-8 dilution baselines.

## F-3 Runtime Wiring Needs

Integration room should update hard-parser selection currently limited to S-3 family regexes:

- `lib/prompts/secFilingAnalysisPackage.ts`
- `lib/ai/secFilingAnalysisPreview.ts`
- `lib/sources/sec/parser.ts`
- parent-registration lookup and S-3 amendment triage checks if F-3/A should share that behavior
- QA defaults in `scripts/qa-sec-s3-parser.mjs` and `scripts/qa-sec-s3-offering-analysis.mjs` when live DB samples are available

## F-3 Fixture / QA Gaps

Fixed local fixtures cover form recognition, resale shares, ordinary shares, routine F-3/A amendment signals, added exhibits, F-3ASR automatic shelf status, and universal shelf security detection. `parser.fixture-test.mjs` is the local runnable fixture QA path.

Live DB QA for F-3 remains an integration-room task because runtime selection and sample availability are outside this folder.

## Offering / Dilution Scoring Considerations

S-3 and F-3 scoring should remain comparable:

- routine amendment: score below 50, action `archive`
- base shelf or automatic shelf without concrete sale terms: generally feed-level, not alert-level
- resale pool, ATM program, concrete amount, warrant coverage, convertible pool, or takedown terms: usually `dilution_risk`
- material score/action thresholds: below 50 archive, 50-74 feed, 75+ feed_alert

## Display_Model_Type Candidates

- `offering_terms` for shelf, resale, ATM, takedown, warrant, convertible, and fee-table economics
- `generic_filing` for routine or unclear archived filings
- `calendar` only when an exact investor-relevant date is stated
- `none` for no-display routine archive outcomes

## Integration-Room Wiring Tasks

- Expand S-3 hard-parser regexes to include F-3 forms where integration owners want runtime coverage.
- Decide whether existing `s3` hard-parser payload key remains the shared offering-family key or a new `s3_f3` alias is needed.
- Decide whether existing S-3/A amendment triage prompt should be generalized or whether F-3/A receives separate prompt wording.
- Add DB/live QA coverage for `F-3`, `F-3/A`, and `F-3ASR`.
- Verify detail UI mappings use `display_model_type`, not SEC form labels.

## Open Questions

- Should runtime keep the exported `SecS3*` type names for compatibility, or should a future shared `SecS3F3*` alias layer be added?
- Should F-3/A parent-registration lookup search both F-3 and F-3ASR parents only, or also S-3 parents for issuers that changed domestic/foreign registration status?
- Should F-3ASR base shelves receive the exact same default feed floor as S-3ASR after live market-context testing?
