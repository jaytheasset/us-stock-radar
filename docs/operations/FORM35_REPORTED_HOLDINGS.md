# Form 3 and Form 5 reported holding monitors

2026-10-14 KST. Candidate implementation and isolated verification; no main integration, push, deployment, production migration or cron activation.

## Acceptance and scope

The accepted journey is normal login → `/monitor` → existing ticker/company autocomplete and SEC issuer confirmation → review/save non-derivative holding title/quantity → normal `/api/sources/sec/ingest` → canonical XML → official Section16 Reader → unchanged same-row Matcher → internal alert → `/alerts`. Sequential and concurrent exact replay must add zero alerts. Owner, another existing account and anonymous access must work at 1440×900, 900×900 and 390×900.

Only original Form `3` or `5`, exact security title, and reported shares `eq`/`gte`/`lte` with a nonnegative decimal string are public. Non-derivative row kind is fixed internally. Every condition must match one holding row. No cross-row, owner or security-class aggregation; no purchase, holdings-change or current-balance interpretation. Exact zero remains distinct from missing, empty and footnote-only fields. `noSecuritiesOwned=true` fails closed even if contradictory rows exist.

The separate `reported_holding_monitors` table leaves existing manual Section16 `listing_monitors` conditions inactive. The manual registry, pure Matcher, canonical parser/Reader, historical lineage and existing Form4/Form144/SC13/Financial/Offering/EFFECT/NT contracts are unchanged. Form3/A and5/A are collected and preserved for history/manual review but do not automatically alert.

## Runtime path and persistence

- Existing Financial target proof is reused as an issuer identity contract: complete current SEC Submissions plus exact catalog mapping, immutable selected ticker/CIK/source/hash, and fresh verification on save and match. Typing clears the selected target and review checkbox. Unconfirmed or stale target selection cannot save. No background current-identity refresh is added.
- GET/POST `/api/monitors/reported-holdings` and GET `/api/monitors/reported-holdings/target` require the existing login. POST uses the existing same-origin check, strict schema and server-selected owner. Public timestamps, historical flags, owner and active-state overrides are rejected.
- The ownership raw-ingest group adds `3`, `3/A`, `5`, `5/A` without changing the existing Form4/144 Primary ownership room. Pending Primary selection skips these exact forms. Explicit `runSecFilingAnalysisIngest` also returns `raw_only` / `reported_holdings_canonical_only` before any provider call. No synthetic Primary or event is created.
- The consumer runs after canonical persistence on both initial ingest and exact replay. It binds raw ID, accession and XML hash, reads the official facts and passes fixed public conditions into `evaluateSection16MonitorConditions(..., "holding")`. Current issuer identity must still agree. Consumer failures are isolated from successful XML preservation and can retry on source replay.
- The service inserts one `user_alert_deliveries` row per monitor/accession with lane/domain `reported_holdings`, no `alert_event_id`, empty channels and no delivery schedule. The database unique key resolves replay/races. The existing delivery scheduler selects non-null due schedules, so these internal rows are not external delivery work.
- `reported_holding_evidence` stores the first matched canonical row ordinals/XML paths, exact raw titles/quantities/statuses, direct/indirect ownership, nature of ownership and referenced footnotes, both target proofs, source URL/hash/parser, accession/raw ID, filing time, report date and activation time. It never recomputes historical display from newer rows. The common `SecondaryMonitorAlertDetails` renderer has a separate typed holding branch; the Form144 branch is unchanged.
- Migration `20261013233754_reported_holdings_monitors.sql` adds owner SELECT RLS and service-only monitor creation, immutable monitor/alert records, canonical/owner/target/source binding, foreign keys and atomic dedupe. Existing lane/domain values are preserved. This stage has no edit/pause/delete API.

## Filing time semantics

Activation uses the monitor's database `created_at`. Production INSERT omits it. The public request has no date-control field.

SEC index acceptance text such as `2026-08-04 17:04:45` is interpreted in `America/New_York`, including DST. Explicit offsets are respected. Invalid dates, nonexistent/ambiguous local DST times and invalid acceptance strings fail closed. If acceptance is absent but the filing date is known, the monitor must predate the start of that Eastern calendar day; same-day ordering is not inferred. Report date, transaction date and import time are never activation substitutes. The SEC describes Eastern filing receipt timing in its [filing-date guidance](https://www.sec.gov/submit-filings/filer-support-resources/how-do-i-guides/request-filing-date-adjustment).

For historical E2E only, the user approved creation-clock control in the isolated environment. An uncommitted transport guard supplied `created_at` solely to new `reported_holding_monitors` INSERTs originating from the authenticated POST route. Earlier conditions used `2024-01-01T00:00:00Z`; negative late conditions used `2026-10-14T00:00:00Z`. The production API, global clock, authentication, SEC identity checks and existing rows were not altered. The guard is now disarmed for new creation.

## Verified real sources and results

Exact SEC index/XML and full company catalog responses were downloaded and retained locally, then replayed at the HTTP transport boundary through the normal ingest route. Parser, storage RPC, official Reader, Matcher, consumer and alert writer were real. This is captured-source transport replay, not a live cron run or fabricated FACT/Primary test.

| Source | SEC acceptance text | Result |
| --- | --- | --- |
| SCL Form3 `0000094049-26-000112` | `2026-08-04 17:04:45` | Common Stock `9319`: one automatic alert |
| SCL Form5 `0001127602-25-004959` | `2025-02-14 17:50:36` | Common Stock `156090.869`: one alert; explicit `0`: one separate alert with F4 |
| Historical GGRP Form3 `0000891839-26-000231` | `2026-06-05 16:16:58` | No securities owned/no holding rows: zero alerts |
| Same issuer Form3/A `0000891839-26-000252` | `2026-06-18 16:18:13` | Canonical preservation only; zero new alerts |
| SCL Form5/A `0000094049-26-000015` | `2026-02-19 19:18:38` | Canonical preservation only; original snapshots/alerts unchanged |

Current SEC confirmation identifies CIK `0001854445` as Brightline Interactive / BTLN. Historical GGRP source values remain preserved; the test did not fabricate a current GGRP identity.

The original positive XML SHA-256 values are `123d467dd4d5ec03dda80390dcceb8c9a467e44d6fbc70b906ff2c3399d8e3cd` (Form3) and `d45ed53b2f534e48768825f5a9d34817f3a6532535354ae5e522e64dc0a1d5fa` (Form5). All five hashes and raw IDs are in the retained source readback.

| Acceptance check | Evidence/result |
| --- | --- |
| Normal login, confirmed company, actual controls, review and save | Eight owner conditions saved through `/monitor`; no cookie injection or account/plan/role change |
| Positive and negative cases | Three automatic alerts; late3/late5, other issuer, wrong title and no-securities cases zero |
| Zero versus unavailable and same-row conjunction | Focused tests use official canonical Reader plus unchanged Matcher; synthetic negative unit cases only, no DB fabricated filings |
| Replay | Two sequential and four concurrent replay requests add zero; canonical rows and first alert evidence unchanged |
| Manual conditions/history | A new task-owned manual condition remained inactive, still manually matched; actual amendments preserved without replacing original records or alerts |
| Permissions and immutable data | Owner sees8 monitors/3 alerts, other sees0, anonymous401; cross-origin403, invalid shapes400 and stale/mismatched target422. Direct RLS agrees. DB rejects monitor time/target changes, alert mutations, wrong owner/hash/URL and direct authenticated monitor INSERT |
| Browser | Both exact pages, three account states, all three viewport sizes; actual ready controls and saved evidence inspected, no horizontal overflow or signed-in console/page/HTTP errors. Retained Form144 USD display verified |
| Automated | 105 focused existing-family/Section16/Financial/SC13/evidence tests pass. Additional workflow/group/auth/cancellation tests:33 pass, one unchanged FMP-calendar source-string assertion fails (details below). Full TypeScript check and production build pass. Security advisors: no issues |
| Preservation | All pre-task public rows retain original values. Zero new events or event_analysis rows; eight new automatic monitors, one manual condition, five raw/canonical filings and three alerts |

Local evidence directory: `C:/Users/PC/AppData/Local/Temp/form35-holdings-7f32/`. Main records: `source-http.json`, `source-readback.json`, `identity-refresh.json`, `monitors-created.json`, `ingest-complete.json`, `amendment-proof.json`, `manual-proof.json`, `primary-skip.json`, `db-constraints.json`, `browser-complete.json`, `final-console-ready.json`, `integrity-proof.json`, `tests.log`, `workflow-tests.log`, `build.log`, `advisors.log`. Source downloads, test credentials, captured HTTP responses, screenshots and guard scripts remain outside Git.

The additional failure is `every individual ingest route enforces authorization for GET and POST` in `lib/sourceIngestRouteAuth.test.ts`: it expects an inline `request.nextUrl.searchParams.get("dryRun") === "true"` string in the FMP economic-calendar route, which uses `parseFmpEconomicCalendarIngestRequest`. Both that route and its test are unchanged from the candidate base. This unrelated assertion is not repaired in this task. The new ownership workflow test passes: all four Form3/5 forms are collected, none enters Primary, and Form4/144 continue to analysis.

The isolated guard deliberately blocked existing auth bootstrap writes and the unrelated SEC cover-observation/ticker-resolution sidecar. Ingest responses therefore show that sidecar's `persistence_failed`/`stateRecorded:false`; this is a harness restriction, not a reported-holdings failure. Canonical Section16 persistence/state and this consumer succeeded. `ensureSecSource` was transported with ignore-duplicates to preserve the existing source configuration. No successful original-row mutation is hidden by those restrictions.

## Handoff and deployment boundary

- Candidate root: `C:/Users/PC/.codex/worktrees/7f32/US-Stock Radar`; detached base `9add34898310d2a5e28595e155375205f3df63d7`. Final commit and clean status are in the completion report. No branch switch, checkout or worktree operation.
- Permanent main: `C:/Users/PC/Documents/Codex/US-Stock Radar`, fixed `main`. Local main ref read from this candidate remains `9add34898310d2a5e28595e155375205f3df63d7`. No repository commands or edits in permanent main; inherited user `next-env.d.ts` change untouched. Port3110 not operated.
- Cached origin/main: `aef4d35221c9744c3a3f47518c492212f678e582`. Current GitHub main and Vercel commit/READY/domain state unverified. Three-way equality is not established. Remote environment/migrations/cron/services unchanged and unverified.
- Only isolated `nt-positive-e56cf806`, API/Auth59621, PG59622, PostgreSQL system ID `7696143717028368440`. The additive CLI-generated migration was applied through verified PG simple protocol; the migration ledger was not changed. No main or remote migration. Two real current Submissions responses added their complete source-derived ledger entries; all existing rows preserved.
- Candidate server3157 with isolated child-process environment. No `.env` files changed. Existing `SUPABASE_DB_URL` and `SEC_USER_AGENT` identity prerequisites remain required. Providers and external sends disabled/blocked. No paid provider calls, synthetic Primary/events, cron or production service activation.
- Real Pro-plan state, live scheduled collection, broad future-source coverage and unrestricted cover/ticker sidecar processing remain unverified. The historical positive test depends on the explicitly approved isolated insertion clock; production retains the normal database clock and will not alert on older filings.
- Independent main review must inspect every changed file and repeat the accepted journey before integration. Candidate tests do not authorize merge, push or deployment.
