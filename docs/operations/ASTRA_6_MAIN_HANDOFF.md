# Stock Radar — Astra 6 Main Handoff

> Original snapshot: 2026-09-10 KST; dated completion updates follow below.
> Development authority: current permanent local `main`. Database statements are dated observations, not a live status check.
> Companion rules: [Production Source of Truth](PRODUCTION_SOURCE_OF_TRUTH.md), repository-root `AGENTS.md`, and [SEC Diagnostics Index](../DIAGNOSTICS_INDEX.md).

This document follows the handoff checklist in `PRODUCTION_SOURCE_OF_TRUTH.md`. If a past chat, old task report, detached worktree, or older architecture note conflicts with the current local `main`, inspect the current code and use it as the development baseline. This does not change the production rule that a deployment is complete only when local `main`, GitHub `main`, and the deployed Vercel commit have been deliberately aligned and verified.

## Ticker-change completion — 2026-09-14 KST

This addendum is the current ticker-change baseline and supersedes earlier ticker/runtime status below. Earlier sections remain historical records, not a current development backlog; recheck unrelated areas before resuming them.

- Local `main`: `e4435b405a40a58634532290cde067e44c69248b`, clean before this documentation-only edit. The audited six-file automatic-trigger commit `2f3fc49173c8158f01a426b9a89c48695923d785` is merged; do not merge or reimplement it again.
- SEC ingest and replay now connect saved cover observations to the existing `resolveAndPersistSecTickerChange()` engine through the automatic trigger. Resolution failure remains separate from raw/observation/site-analysis success; existing idempotency and retry-on-replay are reused. This does not enable source-ingest scheduling: `SOURCE_INGEST_AUTOMATIC_CRONS_ENABLED` remains `false`.
- Search, stock detail, and historical filing reads use effective same-security ticker projection. A current BTLN page can retrieve verified GGRP/VRAR filing evidence without rewriting the historical symbols.
- Watchlist follows effective ticker projection, displays the current ticker and saved-as ticker, and preserves original row identity/ticker/time. Existing old/new rows are retained; deletion targets only the selected original row.
- `user_alert_tickers` subscriptions match effective same-security current-ticker events across server/batch/CLI paths. Original subscriptions and historical Alerts remain intact; user/event dedupe and pre-send effective-relation revalidation protect against duplicate sends and a queued projection invalidated by Human reject.
- Current-price conditions in Listing/Split and the shared Form 4/144 `market.price` path use the verified current ticker only at quote lookup. Historical event tickers and price/market-cap snapshots remain unchanged; missing/stale-price policy and existing Form XML issuer/security identification remain intact. This is not a change to every Monitor.
- The administrator resolution screen exposes AUTO / REVIEW / UNRESOLVED and separate append-only Human decisions, including reject and withdrawal. SEC debug remains the evidence viewer. Consumers use the effective reader: unapproved REVIEW/UNRESOLVED, rejected, or reconsideration-required relations do not authorize projection. Withdrawal restores projection only when the resulting effective relation permits it.
- Historical SEC observations, filings, and Alerts retain their original ticker. Matching issuer CIK alone does not establish the same security; common stock, warrant, and other classes remain separated by the verified relationship rules.
- Still separate scope: general Monitor-wide succession, delisting/new-listing lifecycle, merger/reverse-merger/successor-predecessor and CIK-change generalization. Do not treat ticker-change completion as authorization for these features or destructive ticker/history rewrites.
- Last merge verification: 74 PASS / one existing `sourceWorkflowConfig.test.ts` Cron-count expectation failure (also reproduced at the pre-merge HEAD) / zero new failures; four existing type errors in `scripts/verify-dilution-registry-phase-5c1-isolated.ts`, zero new errors. Existing 3110 NVDA/AAPL search/detail/refresh, Filings list/detail, administrator, and SEC console smoke passed without a server restart. Evidence: `%TEMP%\stockradar-ticker-auto-main-merge-20260914`. No tests or browser checks were rerun for this documentation edit.
- Environment carry-forward: normal 3110/shared-local API `127.0.0.1:56321` and DB `127.0.0.1:56322`; last reported migration state 98 matching / pending zero, not re-queried here. No code, DB, schema, env, scheduler, or external-service changes; no backfill, LLM call, or Alert delivery in this documentation task.
- GitHub `main`: cached remote-tracking ref `9c13aee7ef41b38bac0637e53e579633745effda`, not freshly checked; Vercel production commit/status and remote DB state remain unverified. Local/GitHub/deployed equality is not claimed. Push/deploy are not authorized. Only this Markdown edit is pending; candidate/parallel-work status is not re-audited by this completion note.

## Reboot checkpoint — 2026-09-13 KST

Historical shutdown preparation only, superseded by the dated completion update above. The runtime and restart notes describe that checkpoint, not the current service state or an instruction to restart services now.

- Local application baseline: `main` at `6af84ec85c8eb9d413e642c70ca1b6e1faa50967`, clean before this documentation-only checkpoint. The audited nine-file ticker resolution read-only UI commit `644d59b0ed769ed054af6a154d451bb5891e820a` is already merged; do not merge it again.
- GitHub `main`: cached local remote-tracking ref `9c13aee7ef41b38bac0637e53e579633745effda`; no fresh remote check or push during reboot preparation. Vercel commit/status and remote DB migrations remain unverified. Local/remote/deployed equality is not claimed.
- Last completed main regression: 256 PASS, one existing `beginSecAnalysisSpan is not defined` failure in `lib/ai/secOwnershipLlmRouting.test.ts`; four existing type errors in `scripts/verify-dilution-registry-phase-5c1-isolated.ts`, no new test/type failures. No tests were rerun for this checkpoint. Logs: `%TEMP%\stockradar-ticker-resolution-ui-main-merge-6af84ec-20260913`.
- Browser checks at the checkpoint: administrator login/existing menus, SEC console stored filing, NVDA/AAPL search/detail/refresh, and Filings list/detail passed. One UI defect was then unfixed: navigating from resolution `state=REVIEW` through AUTO then UNRESOLVED cards changed the URL while the select retained REVIEW until reload. Evidence: `%TEMP%\stockradar-main-login-20260913\admin-filter-stale-selection.json` and corresponding PNG. Later resolved by `7d8e5eb833f08642fed96af94889bfab6fbf46e6`, merged as `42d6b9704c6cf3f3d73e7595690dec1191fd72d7`; current code keys the filter form by query/state. The original failure record is retained.
- Last verified shared-local state: API `127.0.0.1:56321`, DB `127.0.0.1:56322`, 95 matching migrations, pending zero, latest `20260913005601`; resolution rows zero is expected. No migration, DB write, backfill, or reprocessing was performed for reboot preparation. Docker Desktop/backend and `docker-desktop` WSL were already stopped when checked; they were not restarted.
- Reboot shutdown: permanent-main 3110 and completed candidate 3113 were stopped after verifying their ownership. No active Stock Radar test/build/migration was found. Previously retired isolated test containers and their data volumes remain preserved; do not start every historical test stack. Cleanup inventory: `%TEMP%\stockradar-container-cleanup-20260913`.
- Candidate `feea` is the already-merged detached `644d59b0ed769ed054af6a154d451bb5891e820a` workspace. Its frozen evidence remains in `%TEMP%\stockradar-ticker-resolution-ui-feea-20260913`; independent audit is `%TEMP%\stockradar-ticker-resolution-ui-main-audit-20260913\AUDIT_RESULT.md`. No new feature work or evidence files are included in this checkpoint.
- Parallel Hàn82 room confirmed current `30bc` worktree at `ec809992c289b199749b541d5a857e1381793459`, branch `codex/wave1c-location-foundation`, clean, and its existing status documents saved. Its administrator `3472` worktree is clean. The previous `C:/dev/vn-kr-marketplace-handoff/vn-kr-marketplace` has one untracked `AGENTS.md` of unknown ownership, preserved without commit/delete/restore. No Hàn82 test/build/migration/DB CLI or Web/Metro listener remains. Its existing handoff records migration replay follow-up; do not start it automatically.
- Restart only what is needed: start Docker Desktop and the existing Stock Radar shared-local services, verify their original ports, then run `node "$env:TEMP\stockradar-local-recovery-20260912\launch.cjs"` from the permanent main workspace. The existing `launch.cjs` and `guard.cjs` were checked on disk. They preserve project env files and use process-only safety settings; do not replace them with an isolated DB launcher. Do not automatically restart 3113 or historical isolated stacks. If these local temporary launcher files are missing, inspect the preserved session records before choosing another launch method.
- Source-ingest Cron, LLM/analysis execution, external notifications, current ticker projection, and watchlist/Monitor succession remain outside the authorized restart scope. No project env, product code, schema, or permissions were changed for this checkpoint. Recheck actual HEAD, Git status, service ownership, and saved evidence before continuing the outstanding UI issue.

## 1. Start here

- Permanent integration workspace: `C:\Users\PC\Documents\Codex\US-Stock Radar`
- Required integration branch: `main`
- Do not switch or checkout branches in the permanent workspace.
- New feature work belongs in its own Codex task/worktree on port `3111` or higher. Port `3110` belongs to the persistent permanent-main review server.
- Before changing anything, run the `AGENTS.md` start-of-task checks and independently recheck every state in this document.
- Existing detached and named worktrees include historical task remnants. Their names or presence do not make them active or approved candidates. No unmerged commit is authorized by this handoff.

## 2. Historical source-of-truth snapshot — 2026-09-10 KST

These values belong to the original snapshot. Use the dated completion update above for the latest recorded local baseline; this table is not a current remote/deployment check.

| Item | Verified state |
| --- | --- |
| Local main HEAD | `491e79d855343c625c45493a5975ef8ecd2f60bb` |
| Branch / root | `main` at the permanent integration workspace |
| Working tree before this handoff edit | Clean |
| Working tree after this handoff edit | Only this uncommitted Markdown file is expected; no code/config change |
| GitHub main | `9c13aee7ef41b38bac0637e53e579633745effda` |
| Local vs GitHub | Local is 375 commits ahead and 0 behind; deliberately not pushed in this task |
| Vercel production commit | `UNVERIFIED`; current CLI session has no Vercel credentials, so do not infer equality from a prior deployment report |
| Push / deploy authorization | None for this handoff |

At that snapshot, local `main` differed from GitHub and Vercel equality was unverified. Any future push or deployment must first follow the complete source-alignment and post-deploy checks in `PRODUCTION_SOURCE_OF_TRUTH.md`.

## 3. Historical shared-local database and scheduler snapshot — 2026-09-10 KST

The counts, migration version, and service states below are historical. Shared-local migrations were not re-queried for the 2026-09-14 document review; do not use this table as current DB verification.

| Item | Verified state |
| --- | --- |
| Shared-local Supabase | Core local API and PostgreSQL are running at the repository-configured local ports |
| Repository migrations | 86 SQL migrations |
| Shared-local applied migrations | 86; exact version match with repository |
| Latest migration | `20260908093924_registry_backed_offering_fact_adapter.sql` |
| Pending shared-local migration | 0 |
| Optional local services | imgproxy, Edge Runtime, analytics, vector, and pooler are stopped; this is not a migration mismatch |
| Source-ingest automatic Cron | OFF: `SOURCE_INGEST_AUTOMATIC_CRONS_ENABLED = false` |
| Other declared Vercel crons | `market-cache` and `alert-delivery` remain declared in `vercel.json`; do not confuse them with source-ingest scheduling |
| DB changes in this handoff | 0 |

Do not print or copy local keys. `SUPABASE_DB_URL` is the direct PostgreSQL path and is separate from the Supabase API-key migration. Current code supports new publishable/secret keys while retaining the approved legacy fallback; disabling legacy keys or changing production environment variables is a separate, explicitly authorized operation.

## 4. Critical architecture boundary — do not merge these systems

### Site-visible SEC filing analysis — complete and locked

The existing site analysis pipeline remains:

```text
SEC source
→ form router/source preparation
→ site-visible Primary LLM analysis
→ validator-triggered bounded LLM repair/failure recovery where defined
→ Event + analysis/trace persistence
→ existing score-based display/alert behavior
```

This path owns the filing title, summary, quick take, score, signal, display payload, and normal analysis persistence. It is a completed product area for this handoff. Do not remove, replace, or repurpose its Primary/failure-recovery LLM providers while implementing Monitor or dilution work.

### Monitor/canonical data — separate system

Monitor analysis is not “the second call” of site filing analysis. It uses domain-specific canonical inputs and deterministic condition evaluation. A site analysis result must not silently become canonical XML/XBRL/O/S/dilution truth.

Use this rule:

- If SEC XML/XBRL or another authoritative SEC structure proves the fields, use a deterministic parser/resolver and preserve provenance.
- A different non-dilution Monitor may use an LLM API only when its bounded schema is demonstrably reliable and independently validated.
- Dilution is the exception: product-runtime dilution analysis LLM API use is forbidden. It uses the GPT/Codex-managed Registry path below.
- Missing, ambiguous, identity-mismatched, or incomparable canonical inputs fail closed; do not estimate or backfill from GPT narrative or FMP.

## 5. Dilution golden path

The accepted target/golden dilution path is:

```text
GPT/Codex direct filing review
→ Dilution Registry JSON
→ Admin Preview / Apply
→ append-only Registry DB
→ event/accession-scoped Registry-backed Offering facts
→ deterministic user condition Matcher
→ deduplicated internal Alert
```

Non-negotiable rules:

- Product runtime performs zero dilution-analysis LLM API calls.
- The Registry is the dilution source of truth; do not rebuild separate S-1, S-3, F-3, or 424B dilution analyzers.
- Site-visible filing analysis remains separate and unchanged.
- Registry reads used by Offering conditions must be bound to the exact issuer, event, accession, raw item, and Registry snapshot. Issuer-wide current state must not be substituted.
- A Registry field maps to an Offering condition only when its economic meaning is identical. For example, ATM authorization capacity is not an executed offering amount and stays `Unavailable`.
- Current adapter V1 is deliberately conservative: the VEEA ATM case is identity-valid but semantically unmappable, so `offering.amount` is unavailable and creates no Alert. This is a safety boundary, not a defect to bypass.
- Main code checked on 2026-09-14 connects Registry Apply and SEC Offering event persistence to the automatic trigger and `consumeOfferingMonitorAlertsForEvent()`. The previous missing-trigger limitation is resolved. This does not broaden fact mappings: the audited VEEA ATM capacity remains unavailable as `offering.amount`.

Legacy Offering Gemini Stage 2 status:

- Automatic Gemini Stage 2 provider execution: disabled.
- Legacy `event_offering_monitor_canonical` promotion/read and empty-condition Matcher wiring: disabled in product runtime.
- Historical source, schema, migrations, tests, and stored rows remain for audit; deletion is not authorized.
- Offering enqueue/workflow remains active because it runs the deterministic O/S sidecar and records a terminal state.
- Completed/failed/stale jobs do not return to pending through late workflow linkage.

## 6. Completed functionality on current main

### SEC ingest and site analysis

- Raw SEC ingestion, routing, form-specific site analysis, Event/analysis persistence, and the bounded validation-repair paths are present.
- Raw SEC requests and structured O/S SEC requests have a 30-second per-attempt timeout integrated with the existing retry/error policy; normal 200, 429, 5xx, Retry-After, rate limiting, and caller abort semantics are retained.
- FPI 20-F/40-F analysis includes the required source/attachment selection and persists through the same Event/analysis/readback path without coupling general analysis success to O/S acceptance.
- Cancelled source workflows can record `cancelled`; late callbacks cannot overwrite terminal states as running/completed.
- Source-ingest automatic scheduling remains off; manual/product routes still exist.

### O/S and share-count history

- Periodic O/S is baseline-aware and incremental. An issuer with a baseline scans only after the baseline; one without a baseline returns `BASELINE_REQUIRED` rather than fetching history.
- Periodic authoritative forms cover 10-Q/10-K and safely supported 20-F/40-F cases. ADS, multi-class, or basis ambiguity fails closed.
- New-listing baseline V1 accepts only directly dated, positively proven single-common-class 424B4 current O/S. Future, pro-forma, post-offering, ADS, and unresolved multi-class values do not write.
- Offering O/S sidecar supports eligible S-1/S-3/F-3/424B filings without the legacy Stage 2 provider. Raw CIK, metadata CIK, accession, and SEC Archive identity must agree.
- Existing periodic, 424B4 baseline, 8-K/6-K, human-verified, resolver, and replay paths remain separate and preserved.
- Forward/reverse split execution and O/S resolver continuity are implemented, including effective timing, same-day ordering, next-trading-day behavior, no double adjustment, and ambiguous-order fail-closed handling.
- Share-count history, class snapshots, resolver, and replay remain append-oriented and provenance-bound.

### Financial XBRL

- Canonical SEC-only Financial Resolver V1 covers Revenue, Operating Income/Loss, Net Income/Loss, Operating Cash Flow, and Cash.
- It separates quarter, YTD, annual, and instant values; preserves currency, unit, concept, period, accession, filing source, hash, artifact identity, and provenance; and rejects dimensional, amendment, source-identity, or comparability ambiguity.
- Financial History/Series connects multiple 10-Q/10-K/20-F/40-F accessions while keeping Quarterly and Annual series separate and fail-closed.
- Periodic Financial Monitor analysis derives current/prior comparable changes from the canonical resolver, not GPT output. Job/raw/result filing identity and retry/replay contracts are enforced.
- Stock detail Financials now reads stored SEC XBRL through the resolver/history endpoint. It has no FMP Financials fallback, preserves per-metric `Unavailable`, and keeps FMP use outside Financials (for example existing Ownership/profile uses) untouched.

### Ownership

- Forms 4, 4/A, 144, and 144/A use verified SEC Ownership XML and the production parser for canonical typed detail rows.
- Typed rows preserve transaction/proposed-sale distinctions, dates, securities, quantities/prices, row grouping, footnotes, source identity, accession, and issuer CIK without unsupported multi-owner attribution or row netting.
- XML canonical persistence is independent of site-analysis LLM success. A failed site analysis remains failed while verified typed detail can still persist/read through the archive-only event shell.
- LLM-only, fallback HTML/text, malformed/truncated/untrusted, wrong-accession, wrong-issuer, or ticker-injected inputs cannot write canonical Ownership details or overwrite valid rows.
- Form 4/144 Ownership Monitor conditions read only verified typed rows, evaluate all predicates against one row, and produce replay-safe internal Monitor alerts. External email/Telegram delivery is not enabled by this path.

### SC 13D/G merged-main product display verification — 2026-09-12

- Local-main merge `a68365c4186a9988fb6cde612385d145fc2cd7a6` was verified against the unchanged isolated 58821/58822 saved six-filing dataset through the real `/api/market/sec/ownership` route and `/stocks/{ticker}#watchlist-ownership` UI for LODE, MTCH, MSFT, AAPL, and BRVE at 1440×900 and 390×844. The existing Insider, Institutional, Financials, and Dilution surfaces remained present.
- LODE showed its three reporters separately at 5,763,729.00 / 8.1%; BRVE used amendment `0000947871-26-000860` and showed 13.5%, 13.2%, and 0.3% separately. MTCH retained 20 source reporters as unconfirmed history, MSFT retained 555,988,240 / 7.48% as unconfirmed, and AAPL retained explicit 0 / 0% as unconfirmed.
- Reporter CIK, security class/CUSIP, event date, accession, and SEC source link matched the saved reader/source evidence. No reporter totals, LLM values, or FMP numeric fallback were introduced; zero, missing CIK, and unconfirmed state remained distinct.
- Evidence: `%TEMP%\sc13-ownership-ui-main-a68365c4-3115-api-audit.json`, `%TEMP%\sc13-ownership-ui-main-a68365c4-3115-dom-audit.json`, and `%TEMP%\stockradar-sc13-main-a68365c4-3115-screenshots\`. “Latest” means the latest confirmed reported value within the stored filing history only, not all SEC filings or real-time ownership. Missing identity or unresolved amendment lineage remains unconfirmed and is not promoted to a current holding.

### Monitor foundation and current domain wiring

- Generic child execution has exact parent identity, terminal states, retry/replay handling, and canonical persistence for implemented domains.
- Listing Risk and Split/Reverse Split paths remain wired for their supported source families.
- Periodic Financial Monitor connects supported stored user conditions to the Matcher and internal Alert consumer; the canonical child runtime invokes the consumer on completion and replay. Period/currency comparability and unavailable-value restrictions remain.
- Ownership XML Monitor is wired through typed rows to deterministic conditions and internal alert persistence.
- Registry-backed Offering adapter, conditions, Matcher, dedupe, and internal-alert persistence are connected through Registry Apply and SEC event automatic triggers. Safe fact coverage remains intentionally narrow; unmappable Registry semantics return unavailable rather than match.
- Existing score-based filing alerts and user-created Monitor alerts are distinct systems.

### Dilution Registry and corporate actions

- GPT/Codex-managed Dilution Registry JSON, Admin Preview/Apply, provenance/identity validation, append-only snapshots, and product reads are present.
- Corporate Action adjustment projects split/reverse-split changes onto a new current projection without rewriting historical contract snapshots.
- Adjustment requires explicit SEC contract clauses, exact canonical split execution, class/timing compatibility, and field-specific operations. Dollar limits and unsupported/ambiguous terms are not adjusted.
- Registry identity, clause-binding replay, projection replay, closed-instrument exclusion, and no-double-adjustment contracts are implemented.
- Registry-backed Offering adapter uses exact event/accession-scoped Registry snapshots and never substitutes a whole-issuer aggregate.

### Platform/security relevant to continuation

- Supabase publishable/secret key support is merged with legacy fallback preserved. Browser/public and server-privileged key roles remain separate; `SUPABASE_DB_URL` was not converted.
- Local main contains the pre-launch page/API access gate and internal short-lived capability/replay protections. The exact Vercel production source commit is currently unverified, so do not assume live production equals local main.

## 7. Must not be changed as collateral work

- Site-visible SEC Primary analysis and its bounded failure-recovery/validation-repair LLM path.
- The separation between site filing analysis and Monitor/canonical data.
- The dilution golden path or its product-runtime LLM API prohibition.
- Periodic O/S, 424B4 new-listing baseline, 8-K/6-K O/S, Offering O/S sidecar, human-verified O/S, and Split/Reverse Split continuity.
- Append-only/history/replay/provenance and fail-closed identity contracts.
- Financial SEC-only policy: no FMP fallback and no SEC/FMP mixing.
- Ownership XML typed rows as canonical details; LLM output cannot replace them.
- Legacy Offering code/history must not be deleted merely because automatic execution is disabled.
- Port `3110`, shared-local data, migrations, schedulers, or environment files unless the user explicitly authorizes the exact operation.

## 8. Historical priorities — 2026-09-10; verified scope updates — 2026-09-14

The priority numbers preserve the original plan, not a current next-task order. The following completion corrections reflect code at `e4435b405a40a58634532290cde067e44c69248b`; they do not claim a new DB or E2E run. Other historical proposals below were not re-audited and require a fresh scope check before development.

### Original dilution follow-up — Registry-backed Offering activation (connected)

Registry Apply and SEC event persistence now call the existing automatic Offering consumer path. Do not rebuild the trigger. Additional economic mappings remain a separate scope; VEEA ATM capacity must remain unavailable as `offering.amount`. Gemini Stage 2 and new form-specific dilution analyzers are not authorized.

### Priority 1 — Financial Monitor user conditions and Alerts

Connected on current main: condition save/read APIs, canonical facts reader, deterministic Matcher, internal Alert persistence/readback, and runtime consumer invocation including replay. This is no longer a first implementation task. Preserve quarter/YTD/annual/instant and currency comparability; unavailable metrics must not become zero/false.

### Priority 2 — Amendment lineage, then 8-K/A and 6-K/A Monitor fan-out

Implemented on current main: amendment lineage/current-state persistence and the SEC analysis → amendment bridge → authorized 8-K/A and 6-K/A Monitor fan-out. Reuse this foundation and its `NOOP` / `SUPPLEMENT` / `REPLACE` / `CANCEL` semantics; uncertain lineage remains fail-closed. Do not rebuild it or treat every amendment as a fresh independent Alert.

### Priority 3 — SC 13D/G canonical ownership state and Monitor

Implemented on current main: canonical XML persistence, amendment lineage and latest-value reader within stored filing history, saved conditions, Matcher/internal Alert, XML-save/replay automatic execution, and the Ownership read surface. These are not first implementation tasks. Latest saved reported values are not real-time holdings or complete SEC history; keep reporter, class, date, and unresolved relationships separate.

### Priority 4 — Form 3/5 Ownership extension

Implemented on current main: Form 3/3A/5/5A XML collection/parsing, persistence/readback, original/amendment and row/duplicate judgments, plus saved direct-value conditions and manual Matcher evaluation. The manual condition contract is `manual_only_no_alerts`; Form 3/5 condition UI, automatic evaluation, and Alert connection are not completed by this path. Initial holdings are not purchases, omitted amendment rows are not zero/deletions, and only confirmed duplicate trades are excluded. Scope is stored history; actual multi-reporter and actual duplicate-positive cases remain unverified.

### Priority 5 — 13F institutional holdings

Build deterministic structured holdings ingestion, amendment handling, manager/issuer/security identity, typed persistence, conditions, internal Alert/readback, and real SEC E2E. Do not mix 13F reporting-date holdings with insider transactions or current beneficial-ownership percentages.

### Later Monitor families

- Form 25 / 25-NSE
- NT 10-K / NT 10-Q / NT 20-F
- S-8 / S-8/A
- Proxy
- Merger / S-4 / F-4 / 425
- Tender / SC TO / SC 13E-3

Some of these already have collection, parser, prompts, or site analysis. That does not mean canonical persistence, deterministic conditions, internal Alert/readback, or product-path E2E is complete. Audit each family from source to saved user result before calling it implemented.

### Legacy Offering cleanup — later, not a feature prerequisite

Automatic legacy Stage 2 is disabled, but its source, schema, migrations, canonical table, historical rows, and tests are retained. Decide cleanup only after an explicit history/rollback/data-retention audit. Do not delete migrations or historical data. The current conservative Registry-backed adapter also needs separately reviewed semantic mappings before additional Offering conditions can become available; never revive Gemini Stage 2 as a shortcut.

## 9. Operating rules for the next room

1. Finish and independently verify one feature at a time before starting the next dependent feature.
2. Parallelize only truly independent worktrees; each candidate must be audited against current `main` before merge.
3. Do not run baseline backfill, catch-up, or bulk/shared-local historical replay until the user explicitly orders it. Isolated replay/idempotency regression tests remain required and are not backfill. “Prepare,” “review,” or “continue development” is not backfill authorization.
4. Do not enable source-ingest Cron/Scheduler without explicit instruction.
5. Do not push, deploy, or modify production/remote DB or environment variables without explicit instruction.
6. Shared-local is shared across worktrees. Use isolated Supabase for write/E2E candidate tests unless the user specifically authorizes shared-local activation.
7. Diagnose first and stop on scope-expanding blockers. Never weaken assertions or provenance to make a candidate pass.
8. Preserve actual missing/ambiguous states as `Unavailable`/review/fail-closed; do not manufacture canonical values.
9. Before any merge, push, deployment, rollback, or new handoff, reread `PRODUCTION_SOURCE_OF_TRUTH.md` and report exact local/GitHub/Vercel alignment.

## 10. Historical regression baseline — 2026-09-10 KST

The integration run at `491e79d8` recorded the results below. They are retained historical evidence, not the latest main regression; see the dated completion update above.

- 253 tests passed across Offering foundation/sidecar, Registry-backed Offering, O/S/resolver/new-listing, Split/Dilution, site Primary/fallback analysis, and periodic-report coverage.
- Workflow strict validation passed.
- Typecheck still had four pre-existing errors limited to `scripts/verify-dilution-registry-phase-5c1-isolated.ts`; no new candidate-specific type error was introduced by the final Offering change.

These results are handoff evidence, not permission to skip task-specific regression or real product-path validation for the next candidate.

## 11. Historical handoff checklist — 2026-09-10 KST

Retained verbatim as the original checklist. Its HEAD, migration counts, and `Next task` are not current instructions or verification; the Financial connection has since been implemented as recorded above. Shared-local DB status was not re-queried for this document review.

```text
Local main: 491e79d855343c625c45493a5975ef8ecd2f60bb
GitHub main: 9c13aee7ef41b38bac0637e53e579633745effda
Local/GitHub equality: NO — local ahead 375, behind 0
Vercel production commit/status: UNVERIFIED — CLI authentication unavailable
Uncommitted files: docs/operations/ASTRA_6_MAIN_HANDOFF.md only (this requested handoff)
Shared-local DB migrations: 86/86, pending 0
Latest shared-local migration: 20260908093924_registry_backed_offering_fact_adapter.sql
Remote/production DB migrations: not checked or changed
Source-ingest automatic Cron: OFF
Backfill: not run; not authorized
Environment/secret changes: 0
Push/deploy/tag: 0; not authorized
Next task: Financial Monitor stored user conditions → Matcher → internal Alert/readback
```
