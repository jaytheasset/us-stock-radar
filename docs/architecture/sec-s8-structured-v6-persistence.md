# S-8 Structured v6 persistence and minimal Monitor fact

Candidate worktree: C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar
Branch: codex/s8-structured-monitor-v1
Base: 65b3e35fb441d421eed03d991ff2c17f3c1825ff
Candidate commit: the commit adding this document (git log -1 -- this file).

## Audit and selected boundary

Generic Monitor children require event identity, parentPrimaryAiRunId, an authorized Primary prompt and latest-Primary checks. Their normal result consumer can evaluate/deliver alerts. Those contracts are not suitable for independent S8 semantic execution and were not relaxed.

Existing ai_runs permits a raw_item_id with null event_id, and ai_outputs permits an event-free output. Both are RLS-enabled and service-only in the verified local DB. Reuse those tables and the existing durable Workflow platform. No new result table and no change to sec_s8_registration_filings. Ownership's event-bound row context writer and SC13/NT typed facts cannot store this separate registration semantic snapshot without changing their meanings, so they were not reused.

Normal path: runSecRawIngest -> successful direct persistence -> enqueueS8Structured -> raw-bound Workflow job -> source reconstruction -> unchanged v6 analyzer -> transactional result persistence. Primary output, event score, prompts and repair are never read by this path. Gemini model is explicitly gemini-3.5-flash; tested v6 budget 0 / temperature 0 / 4000 output tokens / 60s timeout preserved. No retry, repair, fallback or alert consumer.

## Storage and exact source binding

ai_runs prompt_key = sec_s8_structured, prompt_version = s8_structured_v6. Metadata binds rawItemId, accession, issuerCik, formType, sourceFingerprint, sourceSha256, directFactsSha256, contractVersion, model, automatic attempt, acceptedAt, neutral source package and retained original documents. Reservation/started/completed times, workflow linkage, status, model usage and error remain recorded. No Primary parent is fabricated.

ai_outputs output_type = sec_s8_structured. Payload preserves the exact outputText and SHA-256, full provider response/usage, validation stage, binding, error, and provider vs injected_analyzer_replay execution mode. Existing immutable source documents and neutral evidence blocks remain auditable even if the current raw envelope changes.

Direct history remains unchanged:
- version/parserVersion, accessionNumber, issuerCik, formType, filingDate, acceptedAt and amendment indicators;
- registrationRows: contextRef, securityClass text/evidence, securityType text/evidence, amountRegistered text/value/unit/evidence, status/reasons, unresolved canonical security/plan attachment;
- plan mentions/disclosures, unresolved references, limitations, original sources and SHA-256 values.

Semantic JSON remains exactly the frozen five fields: version, filing_kind, current_plans, prior_filings, unresolved. Direct quantities are never copied into that semantic object. readS8Structured combines independently validated direct facts and unchanged semantic output as separate objects, plus selected evidence/provenance.

Uniqueness covers raw item + fingerprint + contract + automatic attempt. One atomic claim authorizes processing. Concurrent/replayed jobs cannot call the analyzer again. Finish writes one immutable output and terminal run state in one transaction; conflicting replacement is rejected. Different contract versions have distinct identities/history. New source packages have distinct identities, but are eligible only when the existing direct history independently validates the same source. The existing immutable direct-history contract is not bypassed to force a refreshed source through.

Historical executions remain in ai_runs/ai_outputs. The current official reader validates raw/accession/issuer/form, direct hashes, complete source package/fingerprint, contract/model, exact execution identity, output hash and the existing structural validator. Missing/stale/failed/unrecognized-version results are unavailable, not a fallback to older success. No semantic correctness validator added.

## Monitor boundary

| Actual key | Source | Type/operators | Meaning |
|---|---|---|---|
| s8.filing_kind | Official v6 readback | enum; eq/in | Model-reported broad filing classification, not a direct SEC fact or issuance claim |

The existing pure Matcher accepts this fact only when its validated adapter result is explicitly supplied. monitorDomains is empty; event readers/automatic alert consumers/UI are not wired to S8. Unknown/unclear or unresolved filing_kind is ineligible. The adapter's eligibility does not alter the stored semantic JSON.

Only a scalar classification is exposed. Current registry values are scalars; specialized Ownership row conjunction does not establish S8 row semantics. Plan names, prior references/relationships, unresolved arrays and row quantities remain in the reader without first-element selection, joins, min/max or aggregation. No unresolved boolean expansion.

Not supported: issued/sold/exercised/vested shares, O/S, current/remaining plan reserve, remaining registration capacity, realized dilution/percentages, current ownership or inferred issuance dates. No Dilution Registry connection.

## Database changes actually applied

User explicitly authorized the existing local DB only: 127.0.0.1:56322/postgres; system identifier 7678429483712069671. Supabase CLI 2.110.0 confirmed the only pending migration was 20261002072251_sec_s8_structured_v6_execution.sql; it was compiled in a rolled-back transaction then applied with migration up to the explicit DB URL. No old migration or history repair.

Added objects:
- RPCs reserve_sec_s8_structured, link_sec_s8_structured_workflow, claim_sec_s8_structured, finish_sec_s8_structured.
- guard_sec_s8_structured_history trigger function.
- sec_s8_structured_execution_once / sec_s8_structured_output_once unique indexes.
- sec_s8_structured_run_guard / sec_s8_structured_output_guard triggers, restricted to S8 runs/outputs.

All functions use security invoker. New RPC execution is revoked from public/anon/authenticated and granted to service_role. No existing table grants broadened. Related guidance: https://supabase.com/docs/guides/database/postgres/row-level-security.

Exactly three ai_runs and three ai_outputs added, all event-free, labeled injected_analyzer_replay. Microsoft 0001193125-25-337056, Nautilus 0001808805-26-000013, Lottery.com 0001641172-25-017852. No raw, direct-history, Primary or other AI data modified. Before/after content fingerprints of the entire existing direct table and non-S8 AI rows match. Contract-version negative inserts were rolled back; no extra test histories remain.

## Verification

Frozen v6 input packages/system/user/schema were compared to current DB reconstruction before using retained provider responses. This is persistence replay, not a fresh provider test.

| Filing | Stored/readback | Direct rows | Replay / condition |
|---|---|---:|---|
| Microsoft | Exact registration semantic | 1 | duplicate; eq/in supported |
| Nautilus | Exact registration, two plans and five prior filings | 2 | duplicate; rows never summed |
| Lottery | Exact amendment, actual 2021 plan, current-target/prior relations | 0 | duplicate; no invented registration rows |

- First replay saved all three; second complete runner invocation created zero additional runs/outputs and used zero injected analyzer responses.
- Real service-role RPC/readback verified; 30 negative/history checks include wrong accession/raw/issuer/source/fingerprint, conflicting replacement, forbidden output update/delete, terminal-run mutation and separate future contract identity rolled back.
- New tests: 26/26 PASS (21 persistence/runtime/Matcher; 5 real ingest-function dependency-boundary tests).
- Existing selected regressions: 140 PASS / 1 FAIL; total 166/167. The sole failure is the pre-existing listingMonitorMatcher.test.ts:518 source-text regex banning words including Evidence. The exact assertion also fails against base 65b3e35f source; unchanged test, not a new runtime failure. Do not claim the entire suite passed.
- Full TypeScript noEmit/incremental false PASS; diff check PASS.
- Frozen v6 analyzer instructions/schema/source builder, direct facts/history, Primary prompt/adapter/runtime and all S8 form files: diff zero against base. Primary prompt/adapter diff against local main also zero.
- New Gemini calls 0; Primary calls 0; alerts/external notifications 0.

## Limits and resume point

Persistence + minimal fact scope is a freeze candidate. No claim of fresh live provider or deployed durable-worker E2E: the retained responses exercised actual execution/persistence/reader functions, with a labeled injected workflow starter. Ingest scheduling is regression-tested with dependencies; the new Workflow entrypoint is typechecked, not live-server tested. No UI changed or browser verification required.

Ambiguous workflow start, a process crash after claim, and terminal failure do not automatically re-call the model. Such a reservation remains pending/running or terminal failed and requires operator investigation; no retry/recovery feature is added in this task. A result write can be replayed exactly, without another model call. Preserve raw outputs even when unavailable. Fresh source/direct-history conflicts stay unavailable. Wider semantic correctness, new S8 variants, UI/MCP and automatic alert delivery are not verified or enabled.

Evidence: C:/Users/PC/.codex/visualizations/s8-v6-persistence-20261002/
db-before.json; migration.txt; persistence-report.json; CASE-stored.json / CASE-readback.json; replay/persistence-report.json; tests-final.txt; typecheck-final.txt; final-audit.json; completion.json; manifest.json. Frozen provider evidence remains under s8-structured-relations-v6-20261002, untouched.

Reproduce replay using scripts/verify-s8-structured-persistence.mjs with frozen evidence and an outside-repository result directory. It refuses other DB host/port/system identity, restricts HTTP to local Supabase and cannot call Gemini.

Operational handoff: permanent main is C:/Users/PC/Documents/Codex/US-Stock Radar, branch main only. Local main shared ref last checked 9e5afda70b5b7314bcb747aaaef26462ce21888b. Cached origin/main 9c13aee7ef41b38bac0637e53e579633745effda; live GitHub main and Vercel deployment are unverified, no equality claim. Candidate only; no main code changes, merge, push or deploy. Local DB addition explicitly authorized above; remote DB/migration unverified. No environment files, account permissions, services, Docker, cron or external notifications changed. Credentials never committed or saved to evidence. Completed changes are the commit containing this document; check completion.json for exact HEAD and clean status.
