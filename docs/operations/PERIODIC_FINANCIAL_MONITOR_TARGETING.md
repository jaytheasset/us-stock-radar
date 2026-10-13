# Financial Monitor issuer targeting candidate

2026-10-14 KST. Candidate based on detached `1ec66926acf53e8af9532f9d3915ca59013c74dd`. No main merge, push, deployment or automatic worker activation.

## Request and acceptance

Limit this change to Financial Monitor company selection using the existing ticker search and verified SEC identity. The user selects a ticker/company on `/monitor`, reviews the company and exact financial conditions, saves, then sees that company and immutable matched financial evidence on `/alerts`. A different real issuer whose actual financial facts satisfy the same conditions must not generate an alert for the selected issuer. Existing targetless Monitors and alerts remain explicitly legacy all-issuer records.

Acceptance covers owner/other/anonymous APIs and actual browser journeys at 1440×900, 900×900 and 390×900, forged/stale/unconfirmed selections, sequential and concurrent replay, preserved originals, target/evidence immutability, existing-family regressions, typecheck and production build. This report is evidence for independent review, not merge authorization.

## Implementation

- Reuse `TickerCompanyAutocomplete` and `/api/tickers/search`. Typing clears the previous target and review; pending confirmation is aborted on a new input or unmount. Selection does not auto-confirm an exact search string. A local Financial Monitor CSS module preserves the shared autocomplete's flex layout without changing other builders.
- Authenticated, no-store `GET /api/monitors/financial/target` uses the unchanged `readStockHeaderSecIdentity` gate: exactly one SEC catalog ticker/CIK plus the official current Submissions reader, with one matching listing/name/exchange. The financial adapter captures provenance from that same reader result. No local ticker/name fallback, inferred first security, or archived-source freshness promotion.
- POST create and validate require `{conditions,target}`. The selection contains only ticker, issuer CIK, source raw ID and refresh sequence. Both endpoints re-resolve the server identity and reject changed, forged, stale or unavailable selections. The server saves its own full target, including name/exchange, source hash and confirmation/verification times.
- Runtime checks saved ticker → current issuer → official financial FACT issuer. Changed/unavailable identity and other issuers are ineligible with distinct reasons. One target read per ticker per consumer invocation. This is issuer financial scope: share classes of the same CIK use the same issuer financial statements.
- The unchanged financial Matcher still validates exact decimal strings, periods, currencies, provenance and existing YoY values. No Registry expansion, combined Q1 basis alias, financial value calculation/repair, LLM change, new scheduling or delivery channel.
- Match evidence optionally adds selected target and match-time confirmed target. Both must bind to the same FACT issuer and ticker; immutable saved alerts render their saved evidence without current-state reconstruction. Common delivery `ticker` remains unchanged/null; the Financial Monitor evidence supplies the verified display ticker.
- Explicit SQL null is legacy all-issuer scope. Missing/malformed stored targets are diagnostics and never widen to legacy. No backfill. Legacy alert snapshots remain byte-for-byte unchanged.

## Additive migrations and access

Apply both before this code:

1. `20261013213834_financial_monitor_issuer_target.sql`: nullable target for pre-existing rows, shape validation, required target for new inserts, immutable target including legacy null, and alert-insert binding to the saved target and FACT CIK. Existing evidence immutability stays in effect.
2. `20261013214717_financial_monitor_verified_creation.sql`: revoke direct authenticated INSERT on `financial_monitors` so user-supplied JSON cannot bypass the server identity gate. Server service-role creation remains available. Existing owner SELECT/UPDATE/DELETE policies and RLS stay unchanged; the trigger prevents any target change. No user/account role changed.

Both files were generated with the Supabase CLI. The first CLI `db query` could not execute multiple statements in its prepared-statement mode; its exact SQL was applied through the verified isolated PostgreSQL connection. The second was applied by CLI. No previously applied migration was edited. The isolated clone has no migration ledger; no history repair was attempted. Security advisors report no issues. Privilege checks confirm authenticated INSERT false, owner SELECT true, service-role INSERT true and RLS enabled.

## Real source and runtime evidence

Local uncommitted evidence: `C:/Users/PC/AppData/Local/Temp/financial-target-7f32/`.

**Target identity:** one real successful current Submissions refresh for SVCO through the existing refresh service, followed by one real full SEC company ticker catalog request. Current CIK `0001943289`, source `0ecb3351-0b04-5f7d-aefb-1d533a8a1bac`, refresh sequence `1`, confirmed `2026-10-13T21:33:21.876Z`, source SHA256 `e12ef7d3a37fb24f6da0caaf35240f36bfba1a4627ee8ec900d7e911b3bec2b4`. No previous rows were updated. `identity-http.json`, `current-refresh.json`, `before-identity.json`, `after-identity.json`.

Repeated browser and consumer tests replay the complete actual captured catalog response at the HTTP transport boundary to bound public requests. They use the real database-backed current reader and production identity adapter. These repeated catalog checks are **transport replay, not additional live SEC confirmations**. No product-code test override or fabricated identity was added.

**Positive:** original retained Silvaco 10-Q `0001628280-26-032286`, official cash FACT `10925000` USD at 2026-03-31, condition `gte 10000000 USD`. Prior source/resolver evidence remains as documented in [stage 1](PERIODIC_FINANCIAL_MONITOR_UI_STAGE1.md). Normal owner login → actual autocomplete → server confirmation → review → Save returned 201, new Monitor `9ec27b91-cebc-4b44-8932-aa708b00f222`. Default production consumer created one new alert `724af5d6-7776-4888-9214-11b285238335`; prior legacy match remained an existing duplicate. Selected, confirmed and FACT CIKs all match. Sequential replay and three simultaneous replay calls created zero more alerts.

**Different real issuer:** five bounded successful SEC HTTP requests fetched actual Apple Submissions, CompanyFacts and filing inventory/body. Actual 10-Q `0000320193-26-000020`, CIK `0000320193`, report date 2026-06-27, primary document `aapl-20260627.htm`. The unchanged stored-source resolver and official reader return cash `39544000000` USD. The same saved amount condition returns `match`, but the production consumer's issuer gate returns `target_issuer_mismatch`, zero writes. The negative run selected only the newly created Monitor from the real active-monitor repository to avoid creating a new unrelated legacy alert for Apple. `other-source-http.json`, `other-source-proof.json`, `other-official-reader.json`, `evaluation-proof.json`.

Apple preparation added 5 exact source records, 1 issuer, 1 filing ledger row, 16 source-derived facts, 1 raw/event transport pair and 1 deterministic run/output pair. The exact computed output was persisted for the official reader. Required event score/archive/neutral fields are isolated transport metadata, not fabricated financial values or Primary analysis. This verifies actual source → unchanged stored resolver/output → official reader → consumer, **not fresh Primary/automatic child/fanout E2E**. No paid provider, worker dispatch or external send.

## Verification

| Check | Result and artifact |
| --- | --- |
| UI creation | Normal existing owner password login, ticker selection, company/conditions review and POST201; only one Monitor inserted. `monitor-created.json`, `create-proof.json` |
| Owner boundaries | Owner sees saved target and exact alert, other sees neither, anonymous APIs return401. `/monitor` and `/alerts` at all three widths for each state. `api-isolation.json`, `browser-complete.json` |
| Request verification | Targetless400; forged CIK422; stale refresh sequence422; valid validate200; forged validate422; cross-origin403; anonymous401. `*-target-api.json` |
| UI invalidation | Editing SVCO clears target and checkbox; Save disabled. Selecting AAPL without confirmed current data displays unavailable and cannot save. Final DOM confirms autocomplete input is contained in its flex control. `builder-final-*.png`, `browser.cjs` |
| Positive / negative / replay | SVCO created1; Apple amount match but target exclusion0; sequential and concurrent replay0. `evaluation-proof.json` |
| Immutable originals | Every original row across172 public tables retained. New nullable column excluded when comparing old Monitor hashes; its legacy values remain null. Source, FACT, old AI, old Monitor and old Alert contents preserved. `final-integrity.json` |
| DB rejection | Target change/removal, legacy backfill, alert evidence mutation, new targetless insert and targeted alert without bound evidence rejected. `evaluation-proof.json`, `final-integrity.json` |
| Source links | Preserved SEC href matches source accession; View filing reaches the correct existing archive route. `filing-route.json` |
| Existing families | Real retained SC13/Form144 content and SC13 modes; 15 browser-only response-fixture views for Form4/OfferingPlan/EFFECT/NT/invalid evidence. Fixture checks are display regressions, not new family source E2Es |
| Automated | 126 financial/resolver/runtime and existing-family tests pass; full TypeScript check, production build and diffcheck pass. `tests.log`, `build-final.log`. Security advisors: no issues |

Actual final screenshots were reviewed at all three widths. No horizontal overflow or signed-in console/page/HTTP errors in completed journeys; anonymous protected401s are expected. Temporary guard blocked existing auth bootstrap upserts; they were not successful product writes. Existing login session changes are outside public product-table hash checks. No injected cookies, new accounts or changed account plans/roles.

## Handoff and unverified limits

- Candidate root `C:/Users/PC/.codex/worktrees/7f32/US-Stock Radar`, original detached base `1ec66926acf53e8af9532f9d3915ca59013c74dd`. Remains detached; no switch/checkout/reset/worktree operations. Final candidate commit is supplied by the completion report; no unrelated or secret/local evidence files included.
- Permanent main root `C:/Users/PC/Documents/Codex/US-Stock Radar` remains main-only. No repository commands or edits there. Its previously reported user `next-env.d.ts` change is untouched. Main3110 was not operated or restored.
- Local main ref verified from the candidate: `d933d7662560eb14f6d99966c0b01dbf5a23566c`. Cached origin/main `aef4d35221c9744c3a3f47518c492212f678e582`; current GitHub main unverified. Current Vercel commit/status unverified; earlier `bf586ed5… READY` report is historical. Three-way equality is not established.
- Only authorized isolated database `nt-positive-e56cf806`, API/Auth59621, PG59622, system identifier `7696143717028368440`. No main/remote migration, data or job operations. Prior main migration ledger information is inherited, not newly verified.
- Candidate server3153 only. Child-process environment provides isolated Supabase values, read-only current-reader DB access and SEC user agent; provider/send settings disabled. No environment files changed. Server PID/build metadata is in `owned-process.json` and `environment.json`. Product rollout requires the existing `SUPABASE_DB_URL`/`SEC_USER_AGENT` current-identity configuration and confirmed current issuer data.
- Other issuers without official confirmed current records remain unavailable. No background current refresh/scheduler added. Pro-plan state, wider company/period coverage, fresh Primary/automatic child/fanout and live production journeys remain unverified and are not claimed. Existing Q1 combined-basis limitation is unchanged.
- The two previously reported unrelated baseline failures (social creator-title assertion and cron-wrapper mutation-origin regex) were not changed; the focused126 suite passes. Remote environment, migrations, cron and external-service state remain unchanged/unverified.
- No push/deploy approval or action. Stop at the clean candidate commit for independent parent review. Before integration the parent must inspect the complete candidate diff and repeat the accepted real journey; do not infer merge authorization from these checks.
