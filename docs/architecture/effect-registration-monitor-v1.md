# EFFECT registration Monitor — local Practical PASS and live-input E2E

## Live-input E2E follow-up (2026-10-06)

**PASS in candidate 5f1c, starting from detached `2ce3aa72a96a3afa87af52aafc22a89d619f86a2`.** This extends, and does not reclassify, the replay/synthetic Practical PASS below. No main integration or operational activation.

Reused preserved Supabase project `effect-5f1c-isolated`, API 59421 / DB 59422, database system identifier `7693255112623656999`, candidate server 3117, and existing ordinary Free test accounts A/B. Before collection there were no PureCycle raw rows. Shared databases and port 3110 were not operated. The approved local Gemini and SEC contact settings were read into the isolated process only; no environment file was changed. The process guard blocks external delivery and other providers.

| Actual SEC input | Accession | Identity / purpose |
| --- | --- | --- |
| PureCycle S-3 | `0001193125-24-262591` | CIK `0001830033`, file `333-283364`, selected original registration |
| Same-registration S-3/A | `0001193125-25-003567` | Same CIK/file; grouped with original rather than treated as ambiguity |
| Different PureCycle S-3 | `0001104659-22-053550` | File `333-264581`, negative control |
| Matching EFFECT | `9999999995-25-000112` | S-3, file `333-283364`, effective `2025-01-15`, no explicit reference accession in this notice |

Official evidence: [S-3 index](https://www.sec.gov/Archives/edgar/data/1830033/000119312524262591/0001193125-24-262591-index.html), [S-3 document](https://www.sec.gov/Archives/edgar/data/1830033/000119312524262591/d849012ds3.htm), [EFFECT index](https://www.sec.gov/Archives/edgar/data/1830033/999999999525000112/9999999995-25-000112-index.html), [EFFECT original XML](https://www.sec.gov/Archives/edgar/data/1830033/999999999525000112/primary_doc.xml).

| Stage | Actual execution / replay status | Result |
| --- | --- | --- |
| Registration collection/storage | Live SEC requests via unmodified `runSecRawIngest`, no HTTP replay or direct raw insertion | All three registration rows stored, no document failures |
| Natural language | Browser `/monitor`, ordinary user A: `PureCycle Technologies의 S-3 등록 건에 EFFECT가 나오면 알려줘` → existing compiler → live Gemini `gemini-2.5-flash-lite` | Exactly **1 physical provider request**, HTTP 200; no provider replay; two registration candidates, selected target has filingCount 2 |
| Review/create/readback | Browser selects original S-3, reviews canonical target, creates through existing API; authenticated GET compares all five saved conditions | PASS; original positive Monitor `1273268c-fe65-48cc-99da-edcf80642fcd` |
| Controls | Reuse the actual returned draft with existing confirm/create APIs; no second compiler call | A's other registration and B's same registration stored; no facts/events/alerts inserted by harness |
| EFFECT collection | Only after Monitor creation, live SEC requests via `runSecRawIngest` | Real index exposes XSL display link and direct XML link; collector fetches both. Direct XML identity/hash survives storage; display text is not match evidence |
| Evaluation/notification | Existing `runSecFilingAnalysisIngest` invoked in isolated process, as used by the existing analysis workflow step | Deterministic Primary persists event `630f415b-5276-4209-a770-0acabd6c33a1`, its automatic EFFECT hook invokes Reader/Matcher/outbox: created 2 (A/B one each), failed 0; no direct consumer call, no EFFECT LLM |
| Existing `/alerts` | Real authenticated page and alert API | Your monitors shows selected registration/accession; Monitor alerts shows one real notice per owner, correct date and direct XML link. Foreign-owner Monitor GET 404 and alert list empty. Other registration: 0 alerts |
| Reprocessing | Second live EFFECT recollection, then 6 concurrent existing analysis entrypoint calls over stored real input | Each returns created 0 / existing 2 / failed 0; DB and owner APIs still show one per Monitor. No HTTP/provider replay; stored real input reused for analysis |

Original XML block SHA-256: `0c90947110facbd1dd7d5ef3fb72ad99e86fe5bae3ee2c8eaf6dc7a22ffbdab6`. Guarded live run logged 32 SEC responses, all HTTP 200, plus one Gemini request/response. Preliminary SEC submissions/index discovery requests were also live. Prior Ibotta synthetic/replay rows remain in the reused DB, but assertions use the new Monitor IDs and exact PureCycle identity; those old rows are not counted as this E2E.

**Issue found and fixed:** Webpack `/monitor` initially failed because the shared persistence/preset import graph reached `source.ts` and `node:crypto`. Extracted unchanged identity syntax helpers into `lib/sec-effect/identity.ts`; registration lookup now imports that module. Server XML parsing/hash checks are unchanged. Browser then completed the live journey without an error overlay. No collector, compiler semantics, Matcher, migration, S-1/S-3 Registry/snapshot or S-4/F-4 logic changed in this follow-up.

Validation: EFFECT tests 12/12, TypeScript PASS, rendered alerts at 1440 / 820 / 390 px with no horizontal overflow. During concurrent forced Primary reprocessing, two existing optional `market_snapshots` writes reported `event_market_snapshots_pkey` conflicts. All six Primary calls and EFFECT alert executions completed; this common snapshot concurrency warning was left unchanged per task scope and is not a claim that the whole Primary pipeline is race-free.

Reproduction helpers: `scripts/effect-live-runtime.mjs` (isolated endpoints, actual SEC and compiler only, one provider request per evidence log) and `scripts/verify-effect-live.ts` (`inspect`, `collect <accession> <cik> <form>`, `controls`, `analyze <accession>`, `concurrent <accession>`, `check`). Set `EFFECT_ISOLATED_STATUS`, `EFFECT_LIVE_CREDENTIALS` (approved existing settings file), `EFFECT_LIVE_OUT` and `EFFECT_LIVE_HTTP_LOG` to private local paths. Start candidate Next with the runtime as an absolute file-URL preload. Use the existing absolute TS-path loader/server-only preload for the CLI. Browser capture of the actual compile/confirm/create responses supplies `live-monitor-responses.json`; the helper never fabricates compiler output. Do not use the older replay runtime for this procedure.

Private logs, readback evidence and screenshots are retained outside Git in `%TEMP%/stockradar-effect-5f1c-isolated` (`live-*`). Candidate server and isolated stack stopped after verification; database volumes preserved.

**Remaining activation boundary:** raw collection and analysis entrypoints were explicitly invoked in isolation; automatic post-Primary fanout was verified. Cron, workflow scheduling/durable dispatch, production migration/configuration and production availability were not activated or verified. No main merge, push, deployment or external notification. Live-input E2E has no remaining access blocker; main integration remains a separate decision. The earlier operational status references below are historical, not freshly verified production equality.

## Earlier Practical PASS (preserved)

Verified 2026-10-06 in the existing candidate `C:\Users\PC\.codex\worktrees\5f1c\US-Stock Radar`, detached from base `ee740278083bd08abc4d05d8bd0d1a3155614049`. No new chat/worktree, main integration, push, deployment, production database change, cron change, or external delivery.

## Connected flow and acceptance

Existing `/monitor` compiler → registration candidate review → explicit selection via existing `/api/monitors/listing/confirm` → canonical five-condition review → existing create/readback APIs → deterministic EFFECT Primary persistence → existing Listing Monitor consumer → existing `user_alert_deliveries` / `/alerts` Monitor alerts.

The saved target consists of `effect.observed=true`, registrant CIK, full SEC file number, registration family, and a verified registration accession. The first two identity fields identify the registration; the accession is a source anchor, not the EFFECT notice accession. S-1/S-3/F-1/F-3 are supported. S-4/F-4 Monitor work is untouched.

Candidate searches use saved `raw_items` SEC filing identity, group `/A` records by exact CIK/file number, and require selection even for one candidate. No latest-filing score or display parent resolver establishes the target. A capped/failed search stays unresolved. The confirmed target fields are read-only in the review; changing the request rebuilds candidates. Create/PATCH and the database trigger reject incomplete/conflicting targets. Existing EFFECT Monitors cannot be patched into targetless Monitors; pause/delete remain available.

## Original source and match semantics

`lib/sources/sec/parser.ts` captures only the small original EFFECT `edgarSubmission` XML (maximum 100,000 characters), SEC document URL, and SHA-256 in `raw_payload.documents[].effectOriginalSource` before text cleaning. It adds no complete-submission duplicate. Existing body text, Primary analysis, S-1/S-3 JSON→Registry, and snapshots retain their paths.

The reader verifies source accession/URL/hash, XML structure/date/form and every filer CIK/file-number pair, preserving suffixes such as `-07`. No parent context is supplied to the original deterministic EFFECT parser. An explicit reference accession must resolve to saved source identity consistent with the selected registration. POS AM requires that reference. Duplicate/conflicting fields, fund series targets, missing original source, missing references and failed reads are `not_ready`/ineligible. A different exact registration is `no_match`; neither result means ineffective or issuance incomplete.

The writer independently rechecks current Monitor target, active state, saved registration evidence, event/raw identity, source hash and XML target. It locks the Monitor and source, derives the owner from the Monitor, and atomically inserts using unique `(listing_monitor_id, effect_registration_key)` where the key is `CIK:full-file-number`. Replay, concurrent calls and a second EFFECT accession cannot duplicate that Monitor/registration alert. Separate Monitors, including another user's Monitor, have separate keys. Existing owner RLS is reused; only service_role may invoke the writer. Rows remain in the existing internal lane with no external channels.

This is observation of a selected registration when an EFFECT event is evaluated. It has no complete lifecycle, live issuance status, automatic historical scan, or “not effective” output. Reprocessing an older verified event may notify an as-yet-unnotified Monitor. A failed evaluation is reported by the existing consumer; retry uses existing event/analysis reprocessing, without a new queue or scheduler.

## Local evidence

Isolation: disposable Supabase project `effect-5f1c-isolated` (API 59421 / DB 59422), candidate Next server 3117; network bootstrap permits only those local endpoints and an in-process compiler response replay. Shared ports 56321/56322, server 3110, and other worktrees were not operated.

| Check | Result |
| --- | --- |
| Saved real Ibotta S-1 EFFECT `9999999995-24-001005` | Existing feed/detail/XML fetch, cleanup, JSON serialization and isolated DB roundtrip preserve CIK `0001538379` / `333-278172` |
| Saved real Hero POS AM EFFECT `9999999995-22-003509` | Explicit reference `0001477932-22-009165` preserved; absent/conflicting reference blocks evaluation |
| Saved real multiple-filer EFFECT `9999999995-24-000848` | All 3 pairs retained, including `333-277848-07` and `333-277848-06`; S-4 source test only |
| S-1 and synthetic S-3 natural-language API journeys | Compiler boundary replay → candidate selection → confirmation → create/readback → consumer → owner alert API PASS |
| Concurrent/replay/owner safety | 12 concurrent consumer runs, distinct second notice, distinct registration exclusion, two users, RLS and service-only RPC PASS |
| Mutation safety | Missing/conflicting target, target removal, other-owner GET/PATCH, pause and source-identity change rejected |
| Real deterministic ingest function | `runSecFilingAnalysisIngest` persisted Primary and invoked EFFECT fanout; first browser Monitor alert created, replay existing, no failed writes or EFFECT LLM calls |
| Rendered UI | `/monitor` and `/alerts`, logged-out and Free-account state, 1440px / 820px / 390px; explicit target, readback and source alert visible; no horizontal overflow or framework error overlay |
| TypeScript | `npm run typecheck` PASS |
| Relevant tests | 126 total: 125 PASS; 1 pre-existing static Matcher test failure, described below |

The static test `reader failure is deterministic and the Matcher has no fallback, provenance, LLM, or delivery dependency` rejects the words `evidence`/`alert` anywhere in the source. Base `ee740278` already contains `Form4PurchaseMatchEvidence`, `form4PurchaseEvidence`, and an S-8 `Event/alert` comment. The same regex fails on `git show HEAD:lib/listingMonitorMatcher.ts` at the starting commit. This unrelated test was not weakened or modified. All 12 new EFFECT tests pass.

**Verification limits:** SEC XML above is previously saved real source, replayed through the actual collector with synthetic HTTP envelopes; this is not a new live SEC fetch. Registration index rows/reference records in the isolated journey are controlled fixtures. S-3 cases are explicitly synthetic contract tests. The existing Gemini semantic compiler was not called live because no Gemini key was available; its normal HTTP response boundary was replayed, while its parser/validator and all downstream application routes were real. No paid EFFECT experiment occurred. Market data is intentionally unavailable in the isolated UI. Repeated harness runs create separate Monitors; visually similar alerts belong to different Monitor IDs, not duplicates for one Monitor.

## Reproduction

Use a separately initialized/migrated local Supabase at the documented isolated ports. Save its `supabase status -o json` privately and set `EFFECT_ISOLATED_STATUS` to that file. Never print or commit it. `scripts/effect-isolated-runtime.mjs` rejects different endpoints, removes inherited provider/delivery keys, and supplies only two exact compiler response fixtures. It is test-only and is never imported by product code.

Run `scripts/verify-effect-isolated.ts --seed`, then the script without flags and with `--s3` against the candidate server. Use Node strip-types and the absolute file-URL loader `scripts/resolve-ts-paths.mjs` (relative loader paths have a pre-existing Windows resolution issue). Start Next on 3117 with `NODE_OPTIONS=--import=<absolute-file-URL-to-effect-isolated-runtime.mjs>`. The `--ingest` check additionally uses `--import=<absolute-file-URL-to-scripts/resolve-server-only.mjs>` for the CLI-only server marker. Existing saved real fixtures are reused; no large fixture copies are added.

Local screenshots and logs reside outside Git in `%TEMP%/stockradar-effect-5f1c-isolated`. The candidate test server is stopped after verification; this directory and its database data are local verification artifacts.

## Operational activation still required

1. Main integration must independently repeat the requested acceptance checks; this candidate is not merge authorization.
2. Apply `20261005183052_effect_registration_monitor.sql` to the authorized target DB before deploying code that selects the new evidence column. Only the isolated database received it here.
3. Verify existing EFFECT collection/analysis scheduling and existing Gemini compiler configuration. No cron change or new EFFECT provider is needed by this implementation.
4. New collection preserves original XML. Older records without it remain unresolved until an explicitly approved targeted recollection; no automatic backfill was performed.
5. Validate live natural-language interpretation and actual production source availability without repeating paid experiments, then repeat production user-journey checks. External delivery is not part of this feature's completion.

Integration reference status: candidate base and local `main` ref are `ee740278083bd08abc4d05d8bd0d1a3155614049`; GitHub `main` read during this task is `9c13aee7ef41b38bac0637e53e579633745effda`. Prior audit recorded Vercel READY deployment `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU` at `bf586ed559c7f4bea6a171790ab7b563cabc7161`; it was not reverified during this implementation. These are not equal, and production activation is not claimed. Follow `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md` before any later integration/push/deployment.
