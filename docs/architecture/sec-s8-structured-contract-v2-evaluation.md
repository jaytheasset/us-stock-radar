# S-8 Structured preview — closed-candidate revision and bounded revalidation

## Decision

**Structured contract needs further correction. No automatic persistence, Monitor or Alert integration is ready.**

This is the separate second-stage Structured path, not Primary-plus-semantics. The original experiment and raw results remain preserved. The revision removed free-form model quotes/names/references and strengthened rejection of explicitly denied plans, but the fixed three-case live run did not satisfy acceptance. In particular, Nautilus's schema-valid result regressed in historical-reference semantics.

Workspace: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Starting candidate: 0bd0d5c7dcb9c4eb29dcec7bbc214fcae833e293
Original base/main ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b

## Confirmed causes in the previous run

- Microsoft: a reference description exceeded 400 characters. Although all selected quotes existed, regenerating reference labels introduced whitespace mismatches. Future incorporation boilerplate was also classified as incorporated history; that was a separate semantic error, not a length/style error.
- Lottery: a literal name-in-quote check permitted the name inside a sentence denying its existence. The model selected the nonexistent 2023 plan in historical scope. Two quotes changed whitespace and two straddled E1/E2 while citing E2 alone. Current correction, historical registration and multiple lexical aliases were not cleanly separated.

These observations do not establish the model's internal cause.

## Changes

Existing path preserved:
retained SEC source → neutral package → one independent Structured call → validation → typed snapshot.

- structuredCandidates.ts (new): lexical P plan mentions and H references from actual source; exact occurrences/offsets/context/evidence refs retained. Candidate identity is not a confirmed entity or relation. No parser aggregate or estimated parent is promoted.
- structuredSource.ts: packages these candidates alongside unchanged direct rows and E blocks; revised fingerprint and internal source version.
- structuredContract.ts: model selects E/P/H/R refs only. No free quote, plan name or historical-description fields. Closed enums, complete row coverage and package fingerprint remain. Plan occurrences must bind to selected E blocks; multi-block spans require their associated blocks. Explicit denial rejects any plan scope; recognized historical/non-current-only support rejects current promotion. Invalid result returns no snapshot.
- s8StructuredAnalyzerPreview.ts: corresponding instruction/input changes; same provider wrapper, model/config and one-call/no-repair behavior.
- structured.test.ts: retained/adapted 19 cases plus 17 new tests.
- verify-s8-structured-preview.mjs: includes the candidate builder in frozen code hashes.
- This document: results, limitations, resume point.

Server binding dereferences selected candidates and evidence, preserving the exact raw model selections separately. It does not correct a fingerprint, drop a wrong plan, change a role or repair a model output. Display labels normalize whitespace/framing articles and retain original lexical occurrence text; no historical source/canonical row is rewritten.

Evidence limits are unchanged: 120,000 normalized source characters, at most 64 source blocks, 8 E refs per assertion. Candidate sets are capped at 100 each and fail instead of truncating. More than 400 characters of actual source can be selected by ref; the model no longer has to reproduce that string within a contradictory output length limit.

The lexical candidate builder is deliberately incomplete and conservative. Its pattern guards are vetoes, not proof of every semantic assertion. Absence of a guard is not proof of a current plan. A candidate occurrence/quote does not prove entity existence, date role or historical-filing relevance.

## Offline checks and freeze

- 91/91 tests PASS: 36 Structured (19 retained/adapted + 17 added), 55 existing S-8/direct-history/Primary/parser/adapter/router regressions.
- Full TypeScript PASS: node node_modules/typescript/bin/tsc --noEmit --incremental false.
- Diff check PASS.
- Three hand-authored representative responses passed the new contracts offline; these were evaluator-only artifacts, never model input.
- Forged/unknown E/P/H identities, wrong package, denied plans, historical-only current promotion, negative relationship statements, extra current rows, Primary fields, duplicate keys, source tampering, evidence/candidate limits and cross-block coverage tested.
- An initial synthetic long-name test used 390 repeated identical characters, triggering the existing chunk normalizer's repetition guard. It was corrected to a nonrepeating 400+ character source name to test the intended string-length condition; the input guard was not weakened.
- Offline inspection caught a phone suffix matching the file-number lexical pattern; a telephone-pattern exclusion and regression were added before freezing.
- Original E blocks and direct registration rows are byte/value-identical to the previous run. Retained canonical records were revalidated through the existing official reader in an in-memory read-only repository, not a fresh DB query.
- Full outbound request bodies were inspected and then checked by the fetch wrapper against the offline bodies. Source hashes, prior evidence and pre-call ground truth were preserved.
- Code/prompt stayed frozen throughout all three calls. No output correction, retry or repair followed a failure.

## Frozen real results

Model: gemini-2.5-flash. Temperature 0, thinkingBudget 0, maxOutputTokens 4000. JSON-mode transport with a closed server-side contract, not provider-enforced responseSchema.

| Case / accession | Calls | JSON/schema | Existing validator | Semantic source comparison |
|---|---:|---|---|---|
| Microsoft / 0001193125-25-337056 | 1 | Complete JSON / FAIL | Rejected; no snapshot | FAIL overall. Correct 2026 Stock Plan and R1 connection; wrong fingerprint and current signature date categorized as historical filing reference |
| Nautilus / 0001808805-26-000013 | 1 | Complete JSON / PASS | Accepted snapshot, preserved as returned | FAIL overall/regression. Both plan-row links and five earlier S-8 numbers correct; fee-pricing date categorized as historical filing; abbreviated alias selected separately |
| Lottery.com / 0001641172-25-017852 | 1 | Complete JSON / PASS | Rejected by plan:denied_existence; no snapshot | FAIL. Nonexistent 2023 plan selected again; real 2021 plan only historical, redundant aliases and approval date treated as filing reference |
| Singular / 0001193125-25-031333 | 0 | Not run | No verified retained raw/canonical pair | Still not testable with the supplied archive; no new ingestion/identity bypass/DB modification |

### Microsoft

Actual fingerprint:
ba56620a9c3e00654a927c49501edf3789877194684688a968f6f13cfc917feef3

Expected fingerprint:
ba56620a9c3e00654a738171df85dbe754312df91fb0b26f72bee9a2fdf1ce0a

The exact comparison correctly rejected the response. It was not replaced with the expected value for evaluation or snapshot creation.

Output selects H3 / historical_reference. Its source context says:
“this registration statement has been signed ... on December 30, 2025.”
That is the current registration's signature date, not an earlier registration. H1/H2 concern an actual incorporated 10-K, but a report-period date and filing date should not become two independently identified earlier filings.

### Nautilus

R1 → 2021 Equity Incentive Plan and R2 → 2021 Employee Stock Purchase Plan remain correct. The direct rows retain 6,323,480 and 1,264,696 shares. No model quantity is generated. The five prior S-8 file numbers are correctly incorporated history.

P3 “2021 Plan” is explicitly the alias of P1, yet appears as a third plan selection. This is redundant identity representation, not evidence of a third real plan.

H9 / historical_reference is February 20, 2026. E4 states that this is the average high/low market-price measurement date used “solely for the purpose of calculating the registration fee.” It is not an earlier filing reference. This is a factual category error, not a stylistic preference. The lexical date-candidate rule included it because the sentence also mentioned a registration statement. The existing validator only verified the selected candidate occurred in the bound source, so it did not reject that wrong role.

The accepted snapshot is retained unchanged for audit and is **not approved for downstream use**. No automatic consumer, DB write or publication exists in this preview. Overall Nautilus is not reported PASS merely because validation succeeded.

### Lottery.com

Output selects P1 / historical_reference despite source:
“there is no Lottery.com 2023 Incentive Award Plan.”

The new denial guard rejects this plan even in historical scope. This demonstrates improved detection, not corrected model understanding.

October 11, 2023 → amendment_target and April 6, 2022 → historical_reference remain appropriate. The model did not restore the earlier additional_to-2022 error. It correctly returns corrects_prior and no current registration rows. However, the actual 2021 plan is still only historical despite being the subject of the current correction, and its abbreviated/generic mentions are listed redundantly.

H3 October 28, 2021 is the shareholder approval date. Selecting it as a historical filing reference is another date-role error.

## Usage and evidence

All three HTTP responses: 200, finishReason STOP. Primary calls 0; Structured calls 3; retries 0; repair calls 0; DB writes 0.

| Case | Input tokens | Output tokens | Latency |
|---|---:|---:|---:|
| Microsoft | 11,311 | 471 | 3.430 s |
| Nautilus | 14,750 | 817 | 4.127 s |
| Lottery | 7,006 | 548 | 3.155 s |
| Total | 33,067 | 1,836 | 10.712 s |

Average 3.571 s. Separate thinking usage was not returned; configured budget zero. Instruction length 3,273 characters; total request bodies 39,711 / 47,201 / 23,881 bytes respectively. Candidate occurrence metadata increased input size while ref-only output was smaller. This is not a cost or stability guarantee.

New evidence directory:
C:/Users/PC/.codex/visualizations/s8-structured-contract-v2-20261002/

- ground-truth.md: unchanged pre-call source expectations copied from prior run.
- offline.json / live-start.json: code/model/ground-truth freeze.
- CASE-source-package.json / CASE-request.json / CASE-actual-request.json.
- CASE-raw-response.json / CASE-output.txt: complete untouched provider outputs.
- CASE-result.json / CASE-execution.json: actual validator/snapshot and provider usage.
- CASE-official-reader.json / CASE-offline.json: preserved canonical fixture revalidation and source paths/hashes.
- offline-contract-check.json: representative offline check, not generated response.
- assessment.json: separate post-call evaluator judgments and source/ref contexts.
- tests.txt / typecheck.txt / manifest.json / completion.json.

Prior run:
C:/Users/PC/.codex/visualizations/s8-structured-v1-20261002/
Original source:
C:/Users/PC/.codex/visualizations/s8-factual-e2e-20261001/

## Resume point / limitations

Recommendation: **Structured contract additional correction required**.

Concrete unresolved contract issues:
1. Date mentions near “registration statement” are too broad to be historical filing candidates: signature, market-price and plan-approval dates entered the set.
2. Lexical aliases can be exposed as separate plan choices; closed refs alone do not resolve entity duplication.
3. Requiring the model to reproduce a long fingerprint remains a transport-contract failure mode. Any future alternative must preserve request/package binding and wrong-filing rejection; no such change was made after this run.
4. The model still selected an explicitly denied plan. The rejection works, but this is not semantic PASS and must not be hidden by filtering the response.

Do not proceed to automatic storage/Monitor/Alert. Do not reinterpret these results as evidence that another model call or architecture redesign is necessary. A next change should address the specific candidate/selection contract defects first, while retaining the Lottery semantic failure as unresolved. No retuning or rerun is authorized by this handoff alone.

## Operational handoff

- Candidate commit: the commit adding this document; inspect git log -1 -- this file.
- Local main ref: 9e5afda70b5b7314bcb747aaaef26462ce21888b, unchanged.
- Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda. Live GitHub main not fetched/verified.
- Vercel deployment commit/status: not verified; no deployment. Equality not claimed.
- Main workspace remains C:/Users/PC/Documents/Codex/US-Stock Radar; no Git commands or mutations were performed there.
- Existing candidate node_modules junction retained; shared dependencies, package/lockfiles and runtime configuration unchanged.
- Existing local Gemini credentials used only in memory for the three authorized calls; values/headers/env files are not in artifacts or commits.
- No DB migration, database access, permissions change, server operation or external notification. Local/remote migration, cron and deployment status otherwise not audited.
- Primary/S-8 direct-history implementation diff is zero. No Primary/provider regression comparison was run; existing tests passed.
- No UI/public route changes: browser/account/viewport verification not applicable.
- No main merge, push or deploy. Candidate is preserved as a failed bounded experiment for further review, not a product integration candidate.
