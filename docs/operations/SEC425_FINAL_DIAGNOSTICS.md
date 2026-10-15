# 425 final diagnostics (2026-10-15)

Base `1f6676888fa3af26753cd712a05ce86f8cb9e97b`, detached/clean at start, only candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`.

## Checkpoint / acceptance

1. Investigate historical raw2 full-before availability. Previous BEFORE.json contains row hashes only; never reconstruct historical values as observed facts. If unavailable, explicitly separate historical uncertainty from one current full-before → normal cover path → full-after reproduction on the owned DB. Source/body/payload/official identity and immutable AI are protected; expected cover status metadata has its own contract. No restore/reset or retroactive PASS.
2. Compare committed local main8a2bb826d38eeca6e0eb071e7017d66e579ba46a and candidate base in Git-outside archive snapshots, same Node/dependencies/lock/webpack command/environment, separate outputs. No build in main or candidate original folders. No env file copy. No CSS redesign merely to pass an existing failure.
3. Establish exact Axcelis parse_failed/replayed and Diana persistence_failed reasons from parser payload, real RPC/SQL errors and applied function/constraints. Distinguish source coverage, identity contract, migration/environment and product defect. No new inference or repaired values.

Actual provider/Router/Primary/live SEC calls0; other workers0. Only owned API59721/SQL59722, project sec425-monitor-20261015, system identifier7696651306517409831. No shared/remote DB, main3110 operation, new worktree/branch/reset, merge/push/deploy. Main next-env expected SHA083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd retained. GitHub/Vercel/remote migration/env/cron unqueried.

New evidence root: `C:/Users/PC/.codex/visualizations/sec425-final-diagnostics-20261015`. Previous trials and their failed whole-row checks remain immutable. Stage order: read-only discovery/build snapshot preparation → bounded exact cover reproduction → root-cause/protected-input analysis → minimal fix only if warranted → final checks/report/commit/STOP. Supabase and Postgres skills read; no new schema API or optimization introduced.

## Findings

- Historical full-before rows were not retained; prior whole-row hashes cannot establish past column values. New `FULL-BEFORE.json` / `FULL-AFTER.json` and `EXACT-RAW-DIFF.json` observe the current bounded reproduction only. Both source bodies, raw_payload and all columns outside cover status metadata are unchanged. Both recorded_at values changed.
- Axcelis additionally changed ticker_resolution from waiting / observation_pair_missing to failed / issuer_lease_acquire_failed: the diagnostic guard blocked the automatic trigger's initial lease RPC. This is a persisted guard-induced diagnostic state, not a production regression or an unconstrained normal-ingest result. No restoration or further mutation replay is permitted. Immutable AI/Alert/cover/decision table hashes and migration hash remained identical.
- Axcelis replays existing result2520664c-6853-4c4e-aa61-bb904767a9c6: parse_failed, observations0, FILING_XBRL_PARSE_FAILED / artifact is not well-formed XML/XHTML. Available denotes stored diagnostics, not successful cover extraction.
- Diana actual RPC returns HTTP400 / SQL22023 / SEC cover absent source state is invalid. Artifact construction rejects raw CIK1326200 versus URL CIK1318885, producing identity_mismatch / source_identity_invalid / artifact accession URL mismatch, sourceRaw null and source.status available. The RPC cannot persist that combination. This cover identity limitation does not invalidate the separate official 425 party references. Never substitute CIK/URL or weaken identity checks.
- Identical archived main8a2bb826 and candidate1f667688 builds both exit1 at StockRadarDashboardV2.module.css:1:1 (global-only selector is not pure). Node24.15.0 / Next16.2.6 / TypeScript5.9.3 / package-lock / dependencies / --webpack command match. No CSS change or repeat build is needed.

## Minimal fix and unchanged boundaries

`lib/sec-cover-observations/persistence.ts` now rejects an artifact-less identity_mismatch with the existing `SecCoverObservationSourceError("source_identity_invalid", originalDetail)` before sending a known-invalid persistence RPC. The existing ingest catch / failure-state recording contract accepts that code. This is diagnostic propagation, not a new source adapter or successful cover extraction. The original CIK, URL, payload, classification and zero observations remain unchanged. Context-level identity_mismatch with a valid source artifact still takes the existing diagnostic persistence path.

Before the fix, the new direct regression failed: expected source_identity_invalid, actual persistence_failed. After the fix, all six direct tests pass: invalid artifact/no persistence RPC, original reason into the existing status-recording contract, source_missing, source_truncated, malformed XML, valid cover observation, and valid-artifact/context identity mismatch (the last two are parameterized tests). Source data are compared before/after. Tests use synthetic CIK/accession/symbol and an injected repository; they make no network or DB calls.

Read-only actual-source check: `closeout-readonly.mjs` verifies the owned system ID, reads the real Diana raw through production PostgREST select, and calls the corrected persistence function. Result: source_identity_invalid / artifact accession URL mismatch, selects1, RPC attempts0. Both full raw rows, seven protected tables and migration153 hash remain identical to the bounded reproduction's FULL-AFTER. No new cover-state recording was performed. The DB's existing Diana failure metadata therefore still says persistence_failed; we did not rewrite history merely to display the new error code. Failure-state recording with the new code is verified by repository-double regression and the existing ingest catch, not a second actual DB write.

No changes to canonical source construction, identity validation, cover parser, raw source storage, SQL schema/RPC, automatic ticker resolution, Primary/Router/FACT prompt, Monitor, Alert, UI or operational enablement. No new migration or additional LLM/provider/SEC/worker execution. The observed identity boundary remains unsupported for this425 cover input; official party identities and FACT extraction are separate paths.

## Raw invariance contract and exact scope

Raw rows checked:
- Axcelis `71eb6909-352d-40b3-acfa-232cddd74e5d`.
- Diana `7753b150-113f-4a01-b47c-4cc623cc29b7`.

For normal status recording, compare the full row outside `metadata.sec_cover_observation_persistence` for strict equality, including body_text, full raw_payload, source identity and other metadata. Inspect every changed path inside that status subtree separately; do not demand whole-row equality from a status update, and do not silently exempt other metadata. Timestamp changes are expected status recording. Axcelis' waiting→failed and observation_pair_missing→issuer_lease_acquire_failed changes are specifically the guard-induced limitation, not a successful unchanged ticker-resolution check.

The one-time reproduction sent two cover persistence requests (Axcelis replay and Diana HTTP400) and two cover-state record requests. The issuer lease request was blocked before transmission. It created no cover result, observation, ticker decision or AI/Alert row. These claims are bounded by the captured response and protected-table evidence, not a claim to have hashed every table. Do not rerun or restore this diagnostic mutation.

Protected whole-table hashes/counts remained equal: ai_runs5, ai_outputs5, user_alert_deliveries2, sec_cover_observation_results1, sec_cover_security_observations0, sec_ticker_resolution_decisions0, sec_ticker_resolution_human_decisions0. Migration versions/count153 remained equal. Whole-row status-hash differences from the earlier task are not retroactively declared PASS; its full historical before rows are unavailable.

## Build comparison

`BUILD-PREPARATION.json` and `BUILD-COMPARISON.json` bind Git archives, original refs, package/lock hashes, shared physical dependencies, runtime versions, command and output logs. Both committed snapshots used `node node_modules/next/dist/bin/next build --webpack`, blocked network and stripped credentials, without copying env files. Both exit1 with the exact same CSS selector error. This establishes an existing committed-main build blocker; it does not establish that all later build stages would succeed. No repeat build or unrelated CSS fix.

Original main next-env SHA remains `083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd`; candidate next-env remains `4e4da12aa061aac172fb1bcb48e9b6e4b293080d2f494327925fdba8f39632ac`. Build outputs were confined to external archive directories. We did not capture a before/after hash of the whole original main .next directory and do not claim such a comparison.

## Verification

- `persistence-before.log`: new narrow regression reproduced the defect, 5pass/1fail before product change.
- `related-tests-retained.log`: 72 tests, 70pass/2fail/0skip; includes all six new direct regressions. Cover canonical/persistence/stored-raw replay, ticker canonical/persistence/automatic trigger,425 FACT/storage/consumer/disclosure tests run with retained public source fixtures and network blocked.
- The two failures are automaticTrigger.test.ts's `product ingest new` and `product ingest replay` cases: existing mock `@/lib/ai/secInvestableUniverseGate` lacks buildSecInvestableUniverseSkipAnalysis. `baseline-automatic-trigger-tests.log` reproduces the exact two failures on the untouched1f667688 archive (10pass/2fail). Not fixed or masked in this task. The first related run skipped8 retained-source cases; the final run supplies the existing evidence paths and skips0.
- `npm run typecheck -- --incremental false`: PASS.
- `git diff --check` and staged whitespace check: PASS at commit.
- Real owned-stack verification: production raw select1 / RPC0 / writes0 after fix; actual recorded-state integration with the new code remains unexecuted.

Test invocation uses Node24.15.0, `--no-warnings`, absolute file URLs for `scripts/resolve-server-only.mjs` and `scripts/resolve-ts-paths.mjs`, `--experimental-strip-types --test`, and the following files:

```text
lib/sec-cover-observations/canonical.test.ts
lib/sec-cover-observations/persistence.test.ts
lib/sec-cover-observations/storedRawReplay.test.ts
lib/sec-ticker-resolution/canonical.test.ts
lib/sec-ticker-resolution/persistence.test.ts
lib/sec-ticker-resolution/automaticTrigger.test.ts
lib/sec425/facts.test.ts
lib/sec425/storage.test.ts
lib/sec425/consumer.test.ts
lib/sec425/disclosureFirst.test.ts
```

For retained-source tests, SEC425_SOURCE_EVIDENCE points to the existing external `sec425-veeco-stage-trial-20261015/sources`, SEC425_PRODUCT_EVIDENCE to `sec425-monitor-product-20261015`; only the test process gets these settings and original values are restored. A pre-import replaces global fetch with a throwing guard. Provider simulation uses injected synthetic fetch, never live network. The baseline test uses the exact candidate archive and its own absolute loader URLs.

Evidence includes full before/after rows, exact path diff, applied functions/permissions, exact RPC requests/responses, cover payload/results, read-only fix receipt, build environment/logs/comparison and test logs. No credentials are included. Existing evidence is not overwritten. `FINAL-CHECK.json` outside Git records final commit/status and evidence hashes.

## Stop boundary

The three diagnostics are resolved to observed causes with a minimal error-propagation fix. Remaining limitations: historical full-row comparison unavailable; unsupported Axcelis XML and Diana cover identity semantics; guard-induced Axcelis status persisted; two pre-existing test mock failures; production build blocked by existing main CSS. This is not full cover support, an unconstrained ingest rerun, UI revalidation, operational activation or merge readiness. Local main reference8a2bb826 is unchanged by this task; GitHub main, deployed Vercel SHA and remote operational state were not queried. Stop for Main independent review.
