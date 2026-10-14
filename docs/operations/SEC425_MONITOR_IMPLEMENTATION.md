# 425 FACT Monitor implementation checkpoints

Active task:2026-10-15, candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, base `b08323d7286b6d2cbb7d39a18ecc6163e7451b37`, detached/clean at start. Prior experiments are closed. No eeb4/main/shared DB operation.

## Acceptance and boundaries

1. Separate one-call FACT, shared original SEC raw/parser/official identity; no Primary or Router dependency. Current announcement versus prior context comes from the model. Original outputs immutable. Mechanical source spans tolerate whitespace but never change field/block or semantic values.
2. Reuse `ai_runs`/`ai_outputs` and Proxy's durable single-provider-claim pattern, with compact raw/hash binding (no duplicate filing or request source text in metadata). Raw-based Alert identity follows Form3/5; an absent Primary event cannot suppress a valid425 match. Reuse existing listing monitors/compiler/owner-plan checks/internal alerts and common detail UI. No new approval system.
3. One announcement per filing, one alert per monitor/raw filing; all predicates AND over that announcement and exact official party references. Unavailable predicates cannot be dropped. None/uncertain/old filing/user isolation/free/anonymous must not alert. Unsupported cross-family sets rejected, not partially matched.
4. Dedicated owned Supabase/Auth/DB only, proposed ports59721/59722 and candidate app3155; confirm no collisions. Do not access shared56322/operational stack. Real Pro login→condition save→raw FACT→worker→official reader→internal Alert→/alerts evidence→dedupe. Real viewport1440×900,900×900,390×900. Historical filing replay with explicit isolated monitor-time control is distinguished from live new arrival.
5. Provider budget maximum3 total, failed/unknown attempts consume slots: Diana FACT1, Axcelis FACT1, natural-language compiler1. **All 3/3 slots consumed. No further model calls.** No new Router/Primary/semantic-check/retry/repair/fallback. Blue Owl/MasterBrand and prior Diana/Axcelis outputs are offline regression inputs only; old-output projection is not new extraction success.

## Reuse review

Proxy source/runtime/persistence/workflow offers durable checkpoints and immutable validation reads but depends on `events` for its alert consumer;425 will instead follow reportedHoldingsConsumer's raw-bound delivery with `alert_event_id=null`. S8 persists raw-bound history without interpreting registration as issuance; Financial/Form35/SC13 preserve issuer/row/time boundaries. Existing Primary and other-family behavior remains untouched. Only scoped425 modules and direct integration points may change.

Supabase skill read; CLI2.110.0. Current changelog and local-development guide read. Cloud TLS changes do not affect the owned HTTP loopback stack. No upgrades or shared migrations. New SQL file will be generated with `supabase migration new`; only owned isolated DB may receive it.

## Stage log

- Start: verified base/detached/clean; reviewed existing patterns; provider0, DB0.
- Stage1 implemented: standalone minimal FACT contract, original-field whitespace coordinates and official company references. Original responses remain immutable. Mechanical availability does not establish semantic accuracy.
- Stage2 implemented: durable single provider claim/checkpoint, raw-bound reader/consumer, owner/Pro checks and existing Monitor/Alerts integration. Default `SEC425_MONITOR_ENABLED` is OFF.
- Stage3 executed: owned stack API59721/SQL59722, system identifier `7696651306517409831`, project `sec425-monitor-20261015`; candidate webpack3155. Two provider-mode FACT runs/outputs, zero Primary events, one Diana internal Alert. Concurrent replay created zero further alerts. Owner GET1; other/free GET0. Immutable response/canonical/Alert evidence/owner checks passed in isolated DB.
- **FAIL: natural-language creation.** Compiler HTTP200 omitted required `reason`/`question`; existing compiler rejected `requirements[0]_shape_invalid` and API returned502. No repair. Positive monitor setup used manually authored canonical conditions through the authenticated existing API; it was not successful natural-language creation or manual UI condition entry.
- **FAIL: Axcelis semantic selection.** Current shareholder vote was classified as `definitive_agreement_signed` despite the source marking the September2025 agreement as previously announced. Mechanical canonical availability and signed-agreement+VECO matching remain true. Zero Axcelis deliveries under the different revised/GNK predicates is NOT a negative semantic PASS. No date/keyword/company exception or output correction added.
- Actual owner Pro browser session displayed the saved monitor and Diana Alert/source/terms at1440/900/390px. JPEG captures preserved outside Git. Natural-language whole journey remains failed; no production acceptance or merge readiness.
- Closing checks: Monitor153/153, SEC/Auth/consumer72/72 and offline experiment127/127 passed (the consumer4 tests occur in both of the first two suites; counts are not disjoint). Final typecheck/diffcheck recorded below. Webpack production build failed on `components/dashboard-v2/StockRadarDashboardV2.module.css:1`, whose global-only selector is unchanged from base. No unrelated CSS correction. Retained source replay completed without mutation or network.

## Evidence checkpoint (do not restart completed experiments)

All task evidence is outside Git at `C:/Users/PC/.codex/visualizations/sec425-monitor-product-20261015`.
`budget/attempt-{compiler,diana,axcelis}.json` and corresponding request/response/result files are the actual3-call ledger. `CONDITION-SAVE.json`, `STORAGE-AND-REPLAY.json`, `DIANA-STORED.json`, `ALERT-OWNER-READ.json` and each official-reader/dispatch receipt record actual execution. `ui-alert-1440.jpg`, `ui-alert-900.jpg`, `ui-alert-390.jpg`, `ui-alert-390-viewport.jpg` are actual browser captures, not PNG or mockups. Images precede a final evidence-label wording change.

The overall automated semantic acceptance is **FAIL**, even though isolated storage, ownership and delivery/replay checks passed. Preserve the isolated DB and evidence for independent review. No further provider or write E2E is needed for closeout. Earlier Round4/eeb4 work is not this active task.

## Implemented boundary

`lib/sec425/facts.ts` defines a separate one-call schema/prompt, not a rewrite of Primary output. `locateProof` tolerates whitespace only and returns original-field offsets; wrong field/block, missing or ambiguous span stays unresolved. Company references combine existing official index/catalog identity with source trading pairs. Neither a model ticker nor FILED BY/SUBJECT role alone establishes the transaction party. Genco's source name and its indexed CIK share the existing official evidence boundary; no global company alias was introduced.

`storage.ts`, `starter.ts`, `workflows/sec425-facts.ts` reuse `ai_runs`/`ai_outputs`, production package serialization and durable workflow scheduling. A single provider stage is claimed before transmission. Ambiguous transport/checkpoint outcomes never authorize a new provider call; infrastructure retries replay saved state. Raw SHA, input fingerprint, request hash, original response hash and canonical hash bind the reader to exact inputs. Source HTML/request blocks are not duplicated in metadata. The scoped SQL migration provides service-only transition RPCs and immutable output/history guards.

`consumer.ts` starts from exact raw IDs, independent of Primary/events; all predicates apply to the same announcement. Official role ticker identity, subscription and activation time are checked before internal delivery. Existing listing-monitor ownership and dedupe storage are reused. New Alert evidence is immutable while ordinary read status remains editable. No email/Telegram publishing or real ticker/identity mutation was added.

Direct integration files are SEC raw ingest; Monitor condition registry/persistence/draft review/API; existing425 preview route; existing draft-builder and common Alert detail. No new page, CSS redesign or shared schema application. The conditional425 API/consumer gate defaults OFF, even though425 registry metadata is present.

Closeout found one input-boundary defect: a425 condition array containing `null` threw before shared shape validation. `malformed-condition-before.txt` reproduces it. A one-line object guard now returns validation errors; the direct regression passes. This does not alter model classification, quotations or prompt content.

## Real source and output assessment

| Sample | Exact source | Actual outcome and limits |
| --- | --- | --- |
| Diana | accession `0001104659-26-075214`; SHA `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d` | New actual FACT call returns revised proposal. Source011/037 supports current action, non-binding character and exclusion of shares already owned by Diana. Implied27.34, cash24.80 and source2.54 VWAP basis are retained without calculation. DSX/acquirer and GNK/target corroborated; Star Bulk identity stays unresolved. One internal Alert for revised+GNK. This is retained genuine filing replay with isolated monitor activation2026-01-01, not live arrival. |
| Axcelis | accession `0001104659-26-011578`; SHA `c5ae0230448ed9ce19660881dca132b8afd96368037e2f80d6446b1018fb2a51` | Source048 explicitly describes previously announced September30 agreement;049/057/100 describe February6 vote. Model reason/statement describe vote but type says new signing. **Semantic FAIL**; canonical mechanically available; definitive-agreement+VECO would match. Invented ACLS reference absent from supplied references stays unresolved. No output correction. |
| Blue Owl | accession `0001193125-25-267134`; SHA `3d7ec163cc58b040592ecd1cfe0dee329f8061b4bc916b7daea0edb943469b54` | Older FACT response only. Source056 supports signing, conditional future mergers and limited-purpose Adviser participation.22 quotes:9 exact,13 whitespace equivalent,0 unresolved. Old OBDC II ticker claim remains an abbreviation/identity problem. No old response upgraded to this schema and no new extraction PASS. |
| MasterBrand | accession `0001193125-25-220725`; SHA `60056493e027b95a2824b63969a80f4d6301c2a68a54f3193241ceec2da3e623` | Older Round5 response only: not_applicable/null. Source009 supports prior proxy filing and future votes. One quote, exact. Not a new model extraction or product delivery negative PASS. |

Mechanical quotation linkage is distinct from semantic accuracy and completeness. In particular, Diana's last long conditions quote ends before the end of its term value; source linkage is not full value entailment. The no-Star-Bulk-completion condition is in partner evidence, not a separately displayed key term. Exhaustive legal qualification extraction is not claimed. The actual request/response values were preserved; no normalization was written back to model output.

## Isolated validation and resources

- Actual compiler request1 + Diana FACT1 + Axcelis FACT1 =3. HTTP200 for all, native responses retained; no Router, Primary, retry, repair, fallback or semantic evaluation provider call. Compiler was Flash-Lite, FACT calls Flash.
- Manual canonical monitor POST through authenticated API: anonymous401, free403, invalid origin403, owner/other201. The browser Add-condition catalog did not expose425 options during the attempt, so manual UI creation is **unverified/not passed**. API setup is explicitly distinguished from natural-language/UI creation.
- Genuine worker dispatch passed through existing-raw `runSecRawIngest`, with retained SEC transport and compiled-workflow metadata adapter in the external harness. Real workflow registration, provider calls, DB persistence and Alert consumer ran. No fake worker/provider result.
- `STORAGE-AND-REPLAY.json`: simultaneous replay created0/existing1 for each caller; response/canonical/evidence/raw-link/owner edits rejected and rolled back; rows unchanged; read_at update permitted; RPC grant anon=false/authenticated=false/service=true.
- `FINAL-READONLY.json`: owned stack identity rechecked, migrations153, Primary events0, FACT runs2/outputs2, Alerts1. Both original raw bindings and production PostgREST-built request hashes equal preflight; all3 budget request/response hashes verified. Closeout writes0, new provider calls0.
- Actual authenticated owner `/alerts` evidence at1440/900/390px; measured document widths1425/885/390, no horizontal overflow. Existing JPEG screenshots are retained. Old logs include intermediate server-only bundle and compiler failures; all-session console cleanliness is not claimed. Final evidence-label wording was checked by tests, not recaptured. Free/other API isolation passed; full free/logged-out browser journeys are unverified.
- Owned3155 webpack dev server stopped before production build. Owned stack/network/DB and external workflow evidence retained for independent review; no other server or Docker lifecycle touched during closeout.

## Repeatable regression commands

Run from the candidate root. Tests use no live provider. Set `SEC425_SOURCE_EVIDENCE=C:/Users/PC/.codex/visualizations/sec425-veeco-stage-trial-20261015/sources` for the retained-source tests; without it five source-backed tests skip. Use absolute file URLs for the loaders on this Windows checkout (relative loader lookup failed before tests started; recorded separately).

```powershell
$loader='file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-ts-paths.mjs'
$serverOnly='file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-server-only.mjs'
$env:SEC425_SOURCE_EVIDENCE='C:/Users/PC/.codex/visualizations/sec425-veeco-stage-trial-20261015/sources'
node --no-warnings --import $serverOnly --experimental-loader $loader --experimental-strip-types --test lib/sec425/facts.test.ts lib/sec425/storage.test.ts lib/sec425/consumer.test.ts lib/monitor/conditionRegistry.test.ts lib/monitor/listingMonitorPersistence.test.ts lib/monitor/listingMonitorDraftReview.test.ts lib/monitor/listingMonitorApi.test.ts lib/monitor/naturalLanguageConditionCompiler.test.ts lib/monitor/naturalLanguageMonitorDraft.test.ts lib/monitor/sec425CandidatePreview.test.ts lib/monitor/listingMonitorAlertConsumer.test.ts lib/monitor/genericMonitorProductionFanout.test.ts components/alerts-v2/listingMonitorUxRegression.test.ts components/alerts-v2/alertsV2Regression.test.ts
node --no-warnings --import $serverOnly --experimental-loader $loader --experimental-strip-types --test lib/sec425/consumer.test.ts lib/ai/sec425IdentityBoundary.test.ts lib/sources/sec/sec425IdentityPipeline.test.ts lib/sources/sec/forms/425/adapter.test.ts lib/sources/sec/forms/425/analysis.test.ts lib/sources/sec/forms/425/parser.test.ts lib/sources/sec/forms/425/router.test.ts lib/sources/sec/forms/425/routerReferences.test.ts lib/sources/sec/forms/425/transactionContext.test.ts lib/sources/sec/forms/425/verification.test.ts lib/sources/sec/forms/425/fetchPlan.test.ts lib/sources/sec/forms/425/factsCandidate.test.ts lib/ai/secPrimaryValidationDisposition.test.ts lib/ai/secPrimaryStructuralFailure.test.ts lib/auth/authPolicy.test.ts lib/admin/readOnlyAuth.test.mjs lib/subscriptionPolicy.test.ts
$tests=Get-ChildItem lib/sources/sec/forms/425/experiment -File | Where-Object Name -Match '\.test\.(mjs|ts)$' | ForEach-Object FullName
node --no-warnings --import $serverOnly --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/lib/sources/sec/forms/425/experiment/runtime-loader.mjs' --experimental-strip-types --test @tests
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

Receipts: `final-monitor-tests-complete.txt`153/153; `final-sec-auth-tests.txt`72/72; `final-experiment-tests.txt`127/127. The external `retained-source-replay.mjs` performs quote-coordinate checks with network disabled and create-new output. Production build command was `node node_modules/next/dist/bin/next build --webpack` with the owned-stack `isolation.mjs` preload; `final-build.txt` records the unchanged Dashboard CSS failure. Build is **FAIL**, not a passing build or merge readiness.

Final `tsc --noEmit --incremental false`: **PASS** (`final-typecheck-closeout.txt`, exit0). `git diff --check`: **PASS**. Candidate-generated `next-env.d.ts` was restored to the exact base content and is excluded from the commit; no main file was restored or edited. External read-only closeout uses the production PostgREST JSON repository: direct `pg` rows contain Date objects and are not the production serializer input contract.

## Handoff scope

Candidate implementation and diagnostic evidence only. **Keep operating activation OFF; do not merge or deploy.** Compiler shape failure and Axcelis semantic false positive require separate approved follow-up; no prompt tuning is included here. Shared DB, main3110, GitHub, Vercel, remote environment and cron remain untouched/unqueried. Local main last observed `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; remote/deployed equality is unverified. No production migration approval. Final candidate HEAD/clean status is recorded in the external closeout receipt after commit.

Final report must distinguish real provider extraction, retained-response replay, actual authenticated storage/alert/browser outcomes, failures and unverified scope. Local main last verified8a2bb826d38eeca6e0eb071e7017d66e579ba46a. GitHub/Vercel/remote DB/env/cron unqueried. No merge/push/deploy authority.
