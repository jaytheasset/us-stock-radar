# S-8 independent Structured preview — first implementation

## Scope and disposition

Candidate-only experiment, 2026-10-02. **Structured contract changes are required before production integration.** Three fresh calls produced complete JSON, but only Nautilus passed the full contract and source comparison. Schema acceptance is not semantic certification.

Workspace: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Base: 9e5afda70b5b7314bcb747aaaef26462ce21888b

Primary, direct-registration canonical history, DB, migrations, Monitor routing, Matcher, alerts, and UI are unchanged. No new durable child or automatic enqueue is connected. This does not revive the earlier Primary-plus-semantics experiment.

## Implemented path

Retained S-8 raw SEC documents → unchanged direct-facts builder → neutral current-filing package → one independent Structured provider call → duplicate-key/closed-schema/evidence validation → typed result and AI snapshot.

- `lib/sec-s8/structuredSource.ts`: verifies retained source through the existing direct-facts builder; emits current identity, immutable direct rows R*, evidence blocks E*, source hashes and package fingerprint. No Primary interpretation is input.
- `lib/sec-s8/structuredContract.ts`: closed wire, source-bound validation and snapshot binding. Invalid output returns no snapshot; it is not repaired.
- `lib/ai/s8StructuredAnalyzerPreview.ts`: independent instructions and stage/result analyzer, using existing Gemini wrapper and generic secondary model configuration.
- `lib/sec-s8/structured.test.ts`: focused contract, evidence, independence and failure regressions.
- `scripts/verify-s8-structured-preview.mjs`: offline-first, bounded real-source validation; complete requests/responses saved outside Git. No DB connection or write.
- This document: evaluation, limitations and resume point.

The small wire contains filing kind; plans and current/historical scope; direct-row-to-plan relationships; earlier reference roles; amendment effect; unresolved categories. It does not contain quantities, scores, signals, display prose or dilution estimates. The server copies unchanged direct rows into a successful snapshot and binds selected quotes to document URL/hash and normalized text offsets/hash. These are normalized-document offsets, not raw HTML offsets. Original canonical row evidence remains intact.

Unknown or foreign E/R references, package changes, nonmatching quotes, missing row coverage, undeclared fields, and some cross-field contradictions fail closed. Literal quotations do **not** prove entailment: negation, chronology and equivalent plan names still require factual evaluation. No claim is rewritten to make it pass.

Source limits: reject truncated source, more than 120,000 normalized characters or 64 blocks. This preview does not claim support for every large filing.

## Model and frozen execution

Reused configured generic secondary model: gemini-2.5-flash. Ownership's separate model configuration was not adopted. Existing Gemini JSON-mode transport was retained: output_contract is disclosed in the request and enforced server-side with Ajv; there is no provider-enforced responseSchema in this run.

Settings: temperature 0, thinkingBudget 0, maxOutputTokens 4000, 60-second timeout. One call per case, zero retries/repair calls. Primary calls: zero.

System instructions: 2,658 characters. Actual complete request bodies: Microsoft 33,825 bytes; Nautilus 28,550 bytes; Lottery 16,998 bytes. These include evidence and output contract.

Code and expected facts were frozen before calls. The live runner verifies the actual transmitted body against its offline request and prevents rerunning the same evidence directory. No analyzer/prompt/schema tuning followed the results.

## Real source comparison

| Case / accession | Direct facts reused | JSON/schema | Evidence and semantics | Typed snapshot |
|---|---|---|---|---|
| Microsoft / 0001193125-25-337056 | One row: 226,000,000 xbrli:shares, common stock, par $0.00000625 | Complete JSON; schema FAIL: references[3].reference exceeds 400 characters | Correct 2026 Stock Plan and R1 link; all 12 citation quotes exact, refs known. Future incorporation boilerplate wrongly categorized as incorporated_history. Some reference labels also normalize source whitespace and would violate the literal-reference check. Core plan success is not whole-result success. | None |
| Nautilus / 0001808805-26-000013 | R1 6,323,480 shares / 2021 Equity Incentive Plan; R2 1,264,696 shares / 2021 Employee Stock Purchase Plan; common stock par $0.0001 | Complete JSON; schema PASS | Full validation PASS; 17/17 exact citations. Additional registration, both plan-row links and five earlier S-8 file numbers correctly separated. Other incorporated reports are source-supported but nonessential scope expansion. No quantity regeneration. | Produced; direct rows unchanged |
| Lottery.com / 0001641172-25-017852 | No current canonical fee-table rows; correction disclosure retained, not converted into new registration | Complete JSON; schema PASS; evidence validation FAIL | Correct amendment/corrects_prior and October 11, 2023 amendment target; April 6, 2022 not promoted to additional_registration_to. Material error: explicitly nonexistent 2023 plan listed as historical plan; real 2021 plan appears in three lexical variants and only historical scope despite current correction relevance. 10 citations use known refs, 6 exact: two whitespace mismatches and two quotes spanning E1/E2 attributed only to E2. | None |
| Singular Genomics / 0001193125-25-031333 | Source-only historical diagnostics available; no verified normal-ingest raw plus official canonical record in retained fixture set | Not called | Existing retained validation reports identity failure. No identity relaxation or live DB investigation in this task. | None |

All three provider calls returned HTTP 200 and STOP. Nautilus's prior combined-task repetition/truncation did not recur in this single sample; this is not a general reliability guarantee.

The direct parser's aggregate estimates were not model inputs or canonical outputs. Lottery's quoted 500,000 shares were not promoted into a new registration row. Raw responses are preserved even when the analyzer rejects them.

| Case | Calls | Input tokens | Output tokens | Latency |
|---|---:|---:|---:|---:|
| Microsoft | 1 | 9,521 | 1,969 | 9.211 s |
| Nautilus | 1 | 8,471 | 2,089 | 8.980 s |
| Lottery | 1 | 4,539 | 1,758 | 7.722 s |
| Total | 3 | 22,531 | 5,816 | 25.913 s |

Average latency 8.638 s. Separate thinking-token usage was not returned; configured budget was zero. No list-price or billing claim is made.

## Evidence and validation

Original retained normal-ingest evidence:
C:/Users/PC/.codex/visualizations/s8-factual-e2e-20261001/

New immutable run evidence:
C:/Users/PC/.codex/visualizations/s8-structured-v1-20261002/

- ground-truth.md: pre-call expected facts, not model input.
- offline.json and live-start.json: code hashes, model, frozen ground-truth hash.
- CASE-offline.json: accession, original raw/canonical paths and hashes, package fingerprint and request size.
- CASE-source-package.json, CASE-request.json, CASE-actual-request.json: complete disclosed evidence/contract and actual body.
- CASE-raw-response.json / CASE-output.txt: untouched provider response and model text.
- CASE-result.json / CASE-execution.json: validation, snapshot/null, timing, provider metadata and hashes.
- CASE-official-reader.json: existing official reader revalidation of preserved canonical fixture through a read-only in-memory repository; **not a fresh DB read or persistence test**.
- CASE-citation-audit.json: post-call diagnostics only; whitespace-equivalent quotes were not repaired/accepted.
- tests.txt / typecheck.txt / manifest.json: checks and archive hashes.

Tests: **74/74 PASS** (19 new Structured; 55 existing direct-history and S-8 Primary/parser/adapter/router tests). Full TypeScript check PASS with incremental false. Primary code and direct-history diff from base: empty. No live Primary quality comparison was run; its implementation and existing regressions remain unchanged.

Reproduce offline tests with the repository's resolve-ts-paths.mjs loader and node --test --experimental-strip-types on:
lib/sec-s8/structured.test.ts,
lib/sec-s8/directFacts.test.ts,
lib/ai/secS8AnalysisAdapter.test.ts,
lib/sources/sec/forms/s8/{parser,analysis,adapter,router}.test.ts
(the brace notation is documentation shorthand; list actual paths in PowerShell).
Typecheck: node node_modules/typescript/bin/tsc --noEmit --incremental false.

## Narrow next step; no automatic follow-on authorized

Recommendation: **Structured contract correction required**.

First review reference scope/representation and the exact contiguous-quote versus block-boundary contract. Increasing the 400-character limit alone would not resolve Microsoft's future/historical classification error. Lottery's denied-plan/current-scope error remains a separate semantic reliability problem, not whitespace/style. Lexical evidence validation must not be described as universal unsupported-assertion detection.

Keep this preview isolated. Do not connect persistence, fanout, Matcher, alerts or AI public consumption yet. Do not silently normalize model answers, loosen identity, or add repair calls. Any next provider evaluation needs a separately approved bounded run; existing failures must remain preserved.

Administrative/exhibit/deregistration and ambiguous relationships have offline regression coverage, not live coverage of every variant. No Singular live run, production DB persistence, automatic child execution, browser UI, or downstream consumer was tested or added.

## Required handoff / operational state

- Local main shared ref at completion: 9e5afda70b5b7314bcb747aaaef26462ce21888b; untouched.
- Cached origin/main: 9c13aee7ef41b38bac0637e53e579633745effda. Live GitHub main was not fetched/verified; code equality is not claimed.
- Vercel deployed commit/status: unverified; no deployment requested or attempted.
- Permanent main workspace remains C:/Users/PC/Documents/Codex/US-Stock Radar; do not develop there or switch its branch.
- Candidate commit: the commit adding this document (see git log -1 -- this file); not merged.
- Product changes are only the five new preview/test/runner files and this document; no existing product file changed.
- Candidate-only ignored node_modules junction reuses existing main dependencies. No install, lockfile change or shared dependency write was performed.
- Credentials were read in memory from existing project-local configuration for the authorized provider calls. No credential values, headers, env files or login material enter evidence/Git.
- Environment configuration, local/remote DB migration state, permissions, cron and external notification services unchanged; DB/deployment state otherwise not audited.
- No UI/routes changed; PC/mobile browser checks not applicable. No review server started/stopped.
- Push/deployment not authorized. Remaining blocker is preview output reliability/contract compliance, not a claimed product E2E failure.
