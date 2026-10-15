# Stock Radar — Astra 6 Main Handoff

## FMP retirement and final build/check publication — 2026-10-15 KST

- Verified product main `ed724575a522bf533fce4127215175a5402253ca`, FMP candidate `70456a84939197241c53378b0fbe269a44f3dfca`. All FMP execution retired at user request; existing unavailable responses replace FMP-only data, other providers and SEC identity retained. No TradingView integration or chart redesign. Historical DB rows/migrations and offline helpers retained.
- Previously reported CSS, browser `node:crypto`, auth inventory and FMP inspection failures are closed for this scope. Actual final main: **1,162 PASS / 0 FAIL / 12 existing optional skips**; default/Webpack builds with typecheck and diffcheck PASS. Main Operations Integrations and Regular dashboard verified at 1440/900/390; six FMP API retirement responses verified. [Scope, evidence and limitations](../architecture/sec425-fact-monitor-v1.md#final-buildcheck-closeout-and-fmp-retirement--2026-10-15).
- 425 operating OFF; no provider/Worker or product-data/migration operations. Main3110 retained; owned candidate3122 stopped. Original user `next-env.d.ts` bytes/diff remain uncommitted. Existing Operations session refreshed normally during browser checks; do not claim whole shared DB unchanged.
- Publication approved for GitHub only; pre-push remote main `d1131ba7b24cda653b02ded2d473ee692ef02cad` is an ancestor, with no remote-only commits. Hosting read-only: three Stock Radar Render services autoDeploy OFF, delivery cron suspended; repository-filtered Vercel inventory empty. Existing Vercel READY deployment `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU` remains on SHA `bf586ed559c7f4bea6a171790ab7b563cabc7161`, CLI source. Local/GitHub publication does not update deployed code. No deploy, remote migration, environment or cron change authorized.
- Evidence: `%TEMP%/stockradar-fmp-retirement-eR26ir/`. Earlier entries below record prior checkpoints, not the latest remaining failures.

## Registry browser dependency and auth-inventory repair — 2026-10-15 KST

- Local merge `fcfba2002eb4edc6c230e68c9e8f3c508dea9eaa`, candidate `c8f534d77357f76f60f2616394d5fe3a7f62fbaf`: browser-safe shared Registry validation with unchanged server hashes; exact delegated authentication inventory checks and negative controls. 425 and product authentication policy unchanged.
- Default/Webpack production builds, typecheck and diffcheck PASS. Independent 41-case before/after parser/hash comparison PASS. Main regression: 1,026 PASS / 12 existing optional skips; separate baseline FMP economic-calendar inline-dryRun inspection failure remains unchanged. Mutation-origin inventory failure resolved.
- Actual Operations Preview valid/invalid binding, anonymous redirect and CSS widths 1440/900/390 verified on candidate/main. No Apply; console errors 0; existing main O/S observations read normally. Candidate guard blocks its unrelated read-only observations RPC, not a product data failure.
- 425 operating OFF, no provider/Worker calls, no DB mutations/migrations, 3110 retained, original next-env bytes/diff preserved. No push/deploy; GitHub last verified `d1131ba7`, Vercel not reverified. Evidence: `%TEMP%/stockradar-crypto-auth-KZxh2t/`. [Details](../architecture/sec425-fact-monitor-v1.md#registry-browser-dependency-and-auth-inventory-closeout--2026-10-15).

## CSS build recovery and image review — 2026-10-15 KST

- Product main `defe494fb178fdb39041836a3f7ef414b9c33724`: `--no-ff` merge of `4b02faf3b10d4ddc4ece58c4d6e086decbbb8bf1`, based on published main `d1131ba7b24cda653b02ded2d473ee692ef02cad`. Four changed files: dashboard global/module CSS, import, direct layout test. All 173 selector occurrences retain declarations/media/order; 425 and other product logic unchanged.
- Normal production build PASS on candidate and exact merged-main archive; typecheck/diff PASS. Post-main focused regression 89 PASS / 8 existing optional skips. Broader candidate regression retains the documented unrelated mutation-origin inventory failure. Auxiliary `--webpack` now exposes a separate unchanged `node:crypto` client import issue; no broad configuration workaround or unrelated fix.
- Main authenticated Monitor/Alerts 1440/900/390 image review completed; main 390px smoke and dashboard HTML200 repeated after merge. Dashboard mobile detail/filter fixture UI verified separately from live market data. Full details and verification limitations: [425 closeout](../architecture/sec425-fact-monitor-v1.md#css-build-and-image-review-closeout--2026-10-15).
- Main3110 kept running without restart; original user `next-env.d.ts` bytes/diff preserved. DB/migration/env/425 activation unchanged; no provider/Worker calls. No push or deployment authorized/performed for this fix. GitHub remains at the previously verified `d1131ba7`; Vercel not redeployed or reverified.
- Evidence outside Git: `%TEMP%/sec425-css-final-n8ZgnB/`; original UI worktree `css-build-20261015/` contains candidate build, selector preservation and fixture captures. No raw source, secrets, dependency copies or screenshots are committed.

## 425 FACT Monitor local integration / publication — 2026-10-15 KST

- Product main: `ca8fb4f77955b712e0543ce24f86e19c818e36c7`, full candidate `2818030adcbb2d06f4442923c98856ab2ed514d6`, `--no-ff` with no conflicts. Previous main `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`.
- Current source/worker/storage/reader/Monitor/Alert diagram and detailed evidence: [425 FACT Monitor](../architecture/sec425-fact-monitor-v1.md). Independent one-call disclosure-first FACT; existing Primary and internal Monitor infrastructure retained. Operating flag remains OFF.
- Fresh candidate E2E: Diana Alert 1 / Axcelis not_applicable Alert 0; two native FACT requests; duplicate provider/Alert 0. Main integration made no provider/Worker calls.
- Merged-main regression: 938 PASS / 8 existing skips / 1 existing mutation-origin inventory failure; typecheck and diff PASS. Existing CSS build error kept separate. Logged-in Monitor/Alerts and anonymous API checks completed; full screenshot set incomplete due capture timeouts. This is not an all-checks-PASS or release-ready claim.
- Verified local DB56722 only: backup then migration `20261014220801`; ledger150→151, prior checked product rows unchanged. Remote migration not applied or verified. Existing `next-env.d.ts` bytes/diff remain user changes, excluded from commits.
- Fresh GitHub pre-publication main: `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`, local ahead22 / remote ahead0 before this documentation commit. User explicitly approved publication after the integration report. Final SHA equality checked after push.
- Hosting read-only: three Stock Radar Render services autoDeploy OFF (cron suspended); Vercel repository-filtered linked-project result empty, latest existing deployment unchanged `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`. No hosting settings, remote DB, cron or deployment change. Deployed/local equality is not claimed.
- Private integration receipt: `%TEMP%/sec425-main-integration-GRgM7l/FINAL-REPORT.json`. Credentials, DB backup, raw filings and screenshots remain outside Git.

## Offering direct FACT integration / GitHub publication — 2026-10-13 KST

- Product main: `7651dad75da9137458de78efdb345de7ba65195c`; full candidate `eac0545bddff3f4684cabe49e1225e8fdb89e65e` merged with `--no-ff`, no conflicts. Earlier ticker verification, O/S Snapshot, Registry, Proxy and other main features retained. Primary unchanged.
- Current architecture/diagram and detailed acceptance: [Offering direct FACT Monitor](OFFERING_PLAN_MONITOR_DIRECT_FACTS.md). Domestic combined extraction, shared ATM evidence and independent F-1 paths; PASS automatic, existing REVIEW_REQUIRED exception; no projected arithmetic, no new Registry authority or routine administrator gate. Unused calculator removed, historical contracts/records kept.
- Main checks: 376 PASS / 4 optional skips; Combined25 / O-S37 / Offering45 / Alerts76 / filings46 / related Monitor151 / additional52 PASS (overlapping selections), full typecheck/build/diff PASS. Main code login/readback/admin views at 1440/900/390; access10 PASS. Positive automatic proof reuses real iBio source/model response under an explicit TEST ONLY filing envelope; no fresh provider call claim. Main DB's existing four Alerts remain readable.
- Local DB: backed up before exactly five migrations `20261009104931`, `20261009175018`, `20261009180530`, `20261012162202`, `20261012173310`. Prior136 ledger rows and existing product data preserved; ledger now141 at this checkpoint. Historical migration SQL was not edited or arbitrarily repaired. Remote migration state remains unverified/unmodified.
- Local recovery: Windows reserved old56321/56322; same main data volume/credentials now loopback API56721 / DB56722. Ignored `.env.local` / `.env.development.local` endpoint values updated, tracked config unchanged. Use the verified temporary CLI workspace for these local ports; repository-default CLI config still refers to original ports. Main3110 running, temporary main3123 stopped. Existing `next-env.d.ts` user bytes/diff preserved; excluded from commits.
- GitHub publication requested by user. Fresh pre-publication `origin/main` is `7fa1de18a5c9b6dc9454862c1d195ea6a773cefa`, 63 product/history commits behind local product main and zero remote-only commits. The documentation publication commit adds to this; final local/remote equality is checked after push rather than inventing a self-referential SHA here. No force push.
- Hosting read-only check: Render `us-stock-radar-web`, `us-stock-radar`, and `us-stock-radar-alert-delivery-cron` all `autoDeploy=no` / trigger off; cron suspended. Vercel Git-linked project inventory does not include Stock Radar. Latest production deployment remains READY `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`, CLI source, SHA `bf586ed559c7f4bea6a171790ab7b563cabc7161`, different from local main. Push is authorized; deployment/remote migration/external delivery is not performed by this publication.
- Evidence: `%TEMP%/offering-main-integration-20261013-154834/FINAL.json` and `main-ui/`; retained response/automatic artifacts `%TEMP%/offering-direct-monitor-1f6c-20261013/combined-auto-v2-*`. Backups, original filings, credentials and screenshots stay outside Git. This checkpoint is not SEC-all-families completion or launch readiness.

> Original snapshot: 2026-09-10 KST; dated completion updates follow below.
> Development authority: current permanent local `main`. Database statements are dated observations, not a live status check.
> Companion rules: [Production Source of Truth](PRODUCTION_SOURCE_OF_TRUTH.md), repository-root `AGENTS.md`, and [SEC Diagnostics Index](../DIAGNOSTICS_INDEX.md).

This document follows the handoff checklist in `PRODUCTION_SOURCE_OF_TRUTH.md`. If a past chat, old task report, detached worktree, or older architecture note conflicts with the current local `main`, inspect the current code and use it as the development baseline. This does not change the production rule that a deployment is complete only when local `main`, GitHub `main`, and the deployed Vercel commit have been deliberately aligned and verified.

## S-4/F-4 + EFFECT integration / publication checkpoint — 2026-10-06 KST

- Product baseline: local main `def887903bb4fedf2bfa8d9d2f6a7af04b69d8e3`. S-4/F-4 merge `3e15836c` and both EFFECT commits `2ce3aa72` / `2c560046` are included. Main fast-forward followed combined review; five common-file conflicts were resolved in the reviewed combined commit, preserving both independent hooks/reader contracts. No new prompt/FACT/policy tuning.
- S-4/F-4: original Primary retained; independent selector → evidence index → MCP, no internal LLM or full-source duplicate. Generic Monitor handles exact `event.sec_form` submission/amendment only after valid event/run persistence. EFFECT uses explicit registration selection and original XML evidence, not an issuer-wide form trigger or Primary prose.
- Verification: combined 243/243, retained real MCP 15/15, TypeScript PASS; post-main 94/94, typecheck/diff PASS. `/monitor` and `/alerts` authenticated main 3110, existing 7 Monitors/2 alerts, 1440/820/390px and no browser error/overflow; logged-out APIs 401. Paid calls 0 during integration. PureCycle fresh candidate E2E remains separate from retained-response integration replay and main read-only smoke.
- Main local DB `127.0.0.1:56322/postgres`: only migration `20261005183052` applied, history now 130 entries at this checkpoint. Functions/grants/trigger/columns/unique constraint checked; existing Monitor/alert hashes unchanged. Backup `%LOCALAPPDATA%/StockRadar/backups/effect-main-20261006`; evidence `%TEMP%/stockradar-effect-main-approved-20261006` and `%TEMP%/stockradar-effect-main-integration-20261006`. Private artifacts are outside Git. Remote migration not applied/verified.
- Publication request now authorizes GitHub push, superseding older no-push checkpoints below. Before this documentation commit/push, freshly fetched GitHub main is `9c13aee7ef41b38bac0637e53e579633745effda` (527 commits behind product baseline, no remote-only commits). Final published SHA/equality is verified after push; these pre-push numbers are historical checkpoints, not a claim of current equality.
- Vercel read-only check: production deployment `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`, READY, commit `bf586ed559c7f4bea6a171790ab7b563cabc7161`, source CLI. Connected Git-project inventory does not list Stock Radar. Deployment is not part of this request and does not equal local main. Cron/external delivery and remote DB activation require separate approval; no settings changed.
- Render publication guard resolved with explicit user approval on 2026-10-06: `us-stock-radar-web`, `us-stock-radar`, and `us-stock-radar-alert-delivery-cron` now report `autoDeploy=no` / `autoDeployTrigger=off` in the Render API. Both Free web services remain unsuspended; the alert-delivery cron remains suspended. Only automatic deployment settings changed, with no manual deploy or service resume. GitHub publication may proceed after the normal push checks; this does not authorize Vercel deployment or production DB/cron activation.
- Hosting decision: Supabase supplies DB/Auth; Vercel is the intended web/API/Cron/Workflow runtime. The 2026-08-01 runbook change (`33a36cd1`) replaced the earlier Render-only web/alert-cron policy. Retained Render SEC tooling is transition/rollback material, not a requirement to run both collectors concurrently. Source-ingest automatic schedules remain disabled during prelaunch; declared market-cache/alert-delivery crons alone do not prove operational execution. See [alert delivery](../ALERT_DELIVERY_RUNBOOK.md), [source scheduling](../SOURCE_INGEST_SCHEDULING.md), and [Render rollback boundaries](../VERCEL_WORKFLOW_INGEST.md#render-병행-운영과-롤백).
- Permanent root/branch stay `C:/Users/PC/Documents/Codex/US-Stock Radar` / `main`. Integration ended clean; this checkpoint changes documentation only. Original EFFECT candidate and combined verification worktree/evidence remain preserved; no candidate cleanup or new worktree in this publication task. Existing market-data availability and the two documented baseline static-test failures are not reclassified as EFFECT regressions.
- Resume references: [EFFECT](../architecture/effect-registration-monitor-v1.md), [S-4/F-4](../../lib/sources/sec/forms/s4-f4/MCP_EVIDENCE_HANDOFF.md), [single Mermaid flow](../architecture/map/01-primary-analysis.md). Remote DB/deployment activation and full scheduler/durable-dispatch verification remain separate; S-1/S-3 Registry/snapshots are unchanged.

## Proxy Structured product v1 — historical local main completion — 2026-10-05 KST

Current architecture: [Proxy product v1](../architecture/proxy-structured-product-v1.md).
Single Mermaid flow source: [SEC Primary map](../architecture/map/01-primary-analysis.md).
This update supersedes the historical “Proxy audit next / not connected” plan.

- Local product merge: `53e1f79098563a0ac6e761d900ada2fbf623c0ae`, normal non-fast-forward merge of complete candidate `d9368157dcadd9a46c95b6f36af3d91664fb733e` from main `b1e80ca68e2b702849286091b3b0a7de4a190101`, no conflicts. This closeout commit changes documentation only; its HEAD is recorded in Git history/final closeout report.
- SEC raw → Proxy Parser/discoveryBlocks forks into independent Primary and Structured. Both use the same parser-selected discovery source; Primary preserves order/text/IDs/coordinates/boundaries 1:1 and retains supporting inputs. Neither analysis supplies the other's answers.
- Structured frozen Call1 → Call2 → Validator → durable persistence → official reader → deterministic Matcher → internal Alert. Only validated Call2 FACT is canonical; Call1 handoff/trace/source evidence remain separate.
- Provider stage claims/checkpoints are immutable: uncertain outcomes cannot be automatically re-called. Infrastructure replay reuses saved responses; no new provider retry/repair/fallback. Official reader validates source fingerprint, contract version, checkpoint/output integrity and frozen validators. Missing/stale/failed/uncertain remains unavailable.
- Only `proxy.has_proposal` and `proxy.has_capital_structure_proposal`, boolean `eq`, are connected to Generic Monitor. Existing activation, lineage and `(listing_monitor_id, alert_event_id)` dedupe remain. Proposal is not approval or execution.
- Local automatic filing → internal Alert E2E PASS and repeat dedupe/idempotence PASS: explicitly synthetic filing `9999999999-26-000001` with exact retained response replay. This is distinct from the four earlier fresh Alternus/BigBear model calls. No fresh real eligible positive-alert or external-delivery success is claimed.
- Independent main review/readback: Alternus 8 proposals, BigBear negative, uncertain automatic real-fixture attempts remain unavailable. Existing canonical/alert state unchanged; 215/217 regressions pass with the same two baseline failures; full TypeScript/diff checks pass. Main 3110 `/monitor` and `/alerts` authenticated/logged-out, PC/900/390px screens verified. No extra Gemini calls or DB writes during main integration/closeout.
- Migration `20261005043414`: local `127.0.0.1:56322` objects/history aligned (four functions, two indexes, two triggers, service-only RPC execution). Authorized candidate history alignment is historical; no reapplication/repair in main integration/closeout. Remote migrations are not verified/applied.
- Baseline failures retained: Matcher static regex catches existing `Form4PurchaseMatchEvidence`; preset roundtrip expectation omits existing `monitor_kind`/`form4_purchase_settings`. No tests weakened; minor omissions do not reopen the development loop.
- Evidence remains outside Git: `C:/Users/PC/.codex/visualizations/proxy-structured-product-20261005`, `proxy-merge-gates-20261005`, `proxy-product-main-integration-20261005`. The existing Proxy chat and branch/commit history are preserved. Completed candidate checkout is approved for retirement after this document commit and final clean/no-unique-work check; cleanup result is recorded with closeout evidence.

### Operating handoff boundary

- Permanent root `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch `main`. Product merge above is the code baseline; this later docs-only commit does not change product behavior. Main's generated `next-env.d.ts` path-only difference is restored to tracked state for closeout, not committed as product logic.
- Cached `origin/main`: `9c13aee7ef41b38bac0637e53e579633745effda`, not refreshed/current GitHub verification. Vercel last recorded `bf586ed559c7f4bea6a171790ab7b563cabc7161` READY; current deployment is unverified. Local/GitHub/deployed equality is not claimed.
- **Push/deploy not performed or authorized.** External email/Telegram completion is not claimed. No DB writes, new API/Gemini calls, replay/backfill, migration/history/permissions/env/credential/cron edits in closeout. Main 3110 remains running; stop only retired candidate 3115. No new room/worktree is created; no next feature is started.

## S-8 direct-registration v1 freeze — historical 2026-10-01 KST

Final architecture, real-filing evidence, Registry decision and resume points:
[S-8 direct-registration history v1](../architecture/sec-s8-direct-registration-v1.md).
This update supersedes the earlier selection of S-8 as the next audit family.

- Frozen product commit: `2a7784efab3a7e8874ee054ca3743f7c0605c041`.
- S-8 / S-8/A / S-8 POS remain separate canonical registration history for
  source-backed research/future AI use. Registered quantity is not issuance,
  sale, exercise, current plan reserve or realized dilution; heuristics remain
  non-canonical. Exact class/plan and related-registration links may be unresolved.
- Dilution Registry and S-8 secondary Monitor/alerts are intentionally deferred:
  existing Registry types do not represent these registration facts safely.
  Preserve the Firefly, SentinelOne and Lottery.com verification evidence;
  no new product or DB work is authorized by this handoff.
- Historical next-audit recommendation was **Proxy**; it is now superseded by
  the completed local product slice above. Reuse its actual raw-trigger/durable
  path; do not create another generic child or restart the initial audit.
  A proposal still does not mean approval or completed execution.
- The historical queue is advisory; Merger/Tender also have implementation
  foundations. This earlier recommendation is not a current implementation queue.
- Documentation task-entry local main is the S-8 freeze commit; cached
  `origin/main` is `9c13aee7ef41b38bac0637e53e579633745effda` (not refreshed).
  Vercel and remote DB state remain unverified. No push/deploy/equality claim.
  The linked S-8 handoff records the full environment and verification boundary.

## NT secondary Monitor v1 freeze — 2026-10-01 KST

Current NT architecture, evidence and resume boundary:
[NT secondary Monitor v1](../architecture/nt-secondary-monitor-v1.md).
This dated update supersedes the earlier selection of NT as the next family.

- Frozen product commit: `d531571294eeb282be948b0f9a3dffe56f82cf9d`.
- Reuses deterministic NT/parser and periodic DEI facts, generic durable child
  persistence, official revalidation, saved Monitor conditions and alert dedupe.
  Unique issuer/form/period/filing-order evidence links a later report; no deadline
  is inferred from the notice date, and local absence never proves non-filing.
- Real Karbon-X NT 10-K: fresh Primary (1 Gemini call), automatic durable NT
  child (0 model calls), persistence/readback and follow-up linkage verified.
  Notice matched; historical activation correctly blocked alerts. Same-child
  replay created no duplicate result/alert. Authenticated filing/user/admin
  surfaces were checked; there is no NT-specific admin evaluation detail page.
- Limitations retained: real NT 10-Q/20-F/amendment E2Es and positive live alerts
  unverified; separate cover `caller_stored_identity_mismatch`; unrelated Matcher
  static assertion failure (149/150 regression, full typecheck passed).
- Next plan-supported **audit** candidate: **S-8 / S-8/A**. Current fetch/parser/
  Primary structures exist; generic secondary and automatic Offering eligibility
  do not include S-8. Inspect existing stored facts/readers before deciding what
  to add. No S-8 implementation or provider run was started.
- The priority list below remains historical, not a binding queue. This is a
  recommendation for the next scoped audit. Listing Status v1 and CUSIP/13F
  remain frozen; their earlier plans do not authorize reopening.
- Documentation-only handoff: local main task-entry HEAD is the freeze commit;
  cached `origin/main` remains `9c13aee7ef41b38bac0637e53e579633745effda` (not
  fetched), Vercel/remote DB state unverified. No push/deploy or equality claim.
  Full environment checklist and evidence paths are in the linked NT handoff.

## Listing Status v1 freeze — 2026-10-01 KST

Current Listing Status handoff: [Listing Status v1 freeze](LISTING_STATUS_V1_FREEZE_HANDOFF.md).
This supersedes older candidate-only/current-backlog statements for Listing
Status/Form 25, without rewriting historical evidence for unrelated features.

- Product main baseline: `c506647f8f01aa0e3f5c41016c0b82b108299e65`.
- Backend integrated by `c048ab4053eda2196a524ba045e5944c58a8fe5d`; shared stock/JSON
  surface by `a3bd03d4ee7116f78ab718a163a3499e07c92d99`; final presentation and
  safe exchange fallback by `c506647f8f01aa0e3f5c41016c0b82b108299e65`.
- Frozen unless a concrete future product requirement or demonstrated defect
  requires reopening. Do not restart implementation, provider runs or broad audits.
- Next plan-supported family: **NT 10-K / NT 10-Q / NT 20-F**, read-only audit
  first. The old roadmap is explicitly historical, so this is not authorization
  to start. CUSIP/13F remains frozen at `0b75ffcf573b64fcf030fde432d594bfa9f487ae`;
  its old Priority 5 entry is not a current instruction.
- The freeze document records architecture, source/identity/date safety, human
  review, migrations, main versus candidate evidence, the unrelated preset-test
  failure, and the required local/GitHub/Vercel/environment checklist.
- Only documentation changed for this freeze; no new tests, DB writes or runtime
  execution. Current GitHub and Vercel state remain unverified; no push/deploy.

## Ownership one-call main runtime check — 2026-09-30 KST

- Local `main` checked at `19c93a6cb336deb5f93ed4e870fe0843ce86fbd8` on the existing 3110 server. One fresh Gemini 3.5 Flash call for historical ONTF Form 4 produced both Primary and Structured outputs; persistence, official readback, Monitor evaluation, and authenticated user/admin screens worked. The 33,407-share row matched the ONTF/director/minimum-1,000 condition; no alert was created because the 2025 filing predates monitor activation.
- Factual acceptance is **blocked**: the raw Primary output and filing page say Lynrock Lake Master Fund LP holds shares *indirectly*, while SEC footnote F1 says that fund holds them *directly*. No prompt, code, or model-output repair was attempted. The `ownership-one-call` candidate worktree and its 3111 review server were **not retired**.
- Evidence and screen captures: `C:\Users\PC\.codex\visualizations\2026\09\28\stock-radar-main-ownership-merge\ontf-main3110-validation\one-call-final-check\main-runtime-check.md`. The only pre-existing local main change at the start was generated `next-env.d.ts`; this handoff update is documentation only. Cached `origin/main` ref is `9c13aee7ef41b38bac0637e53e579633745effda` (not freshly fetched); deployed Vercel commit/status is unverified. Local/GitHub/deployed equality is not claimed; no push or deployment occurred.

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

- Gemini Stage 2 application provider execution, prompt/schema, input packaging, and orchestration: removed by the approved offline cleanup.
- Legacy application promotion writer and empty-condition Matcher wrapper: removed. Historical canonical readback remains separate from product runtime.
- Historical candidate identifiers/types/validation, canonical reader tests, SQL functions/migrations, stored rows, frozen evidence, and provider records remain. The removed execution-only tests do not describe current commands.
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
- Proxy — completed local main product v1; see the dated completion update above
- Merger / S-4 / F-4 / 425
- Tender / SC TO / SC 13E-3

Some of these already have collection, parser, prompts, or site analysis. That does not mean canonical persistence, deterministic conditions, internal Alert/readback, or product-path E2E is complete. Audit each family from source to saved user result before calling it implemented.

### Legacy Offering cleanup — later, not a feature prerequisite

The approved offline Stage 2 cleanup removed unused application execution and promotion code. Historical contracts and canonical readback remain in `offeringMonitorHistoricalContract.ts` and `offeringMonitorCanonicalPersistence.ts`; current Registry/Matcher imports neither. Do not delete migrations, SQL functions, canonical rows, frozen evidence, or provider history. The current conservative Registry-backed adapter also needs separately reviewed semantic mappings before additional Offering conditions can become available; never revive Gemini Stage 2 as a shortcut.

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
