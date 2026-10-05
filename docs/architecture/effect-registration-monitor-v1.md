# EFFECT registration Monitor — local Practical PASS

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
