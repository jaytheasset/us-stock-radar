# Kiwoom loopback integration validation — 2026-10-08

Result: **partial real integration verified; complete acceptance withheld**.
Evidence review works through the existing authenticated administrator UI and
actual local PostgREST/PostgreSQL. Human comparison is environment-blocked because
the approved DB contains zero SEC resolution decisions. The protected-data gate
also fails for two pre-existing Auth bootstrap tables; details below.

## Scope and target

- Candidate: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`, detached.
- Base: `362f392756f9b1cf404f1f57fa50e8ea5ce5427f`.
- Existing feature: `9e5fabca49ecbf49ecddf3e82760fb7605592139`, unchanged.
- Local main ref: `d7347e4d2e75a5c412f69218003d2dfd407c79c5`.
- GitHub main, Vercel, remote DB and cron unqueried; no equality/deployment claim.
- Explicitly approved REST/Auth `http://127.0.0.1:56321`, SQL
  `127.0.0.1:56322/postgres`, system identifier `7678429483712069671`.
- Docker project `US-Stock_Radar`, network `supabase_network_US-Stock_Radar`.
  Gateway routing and both Auth/REST database destinations resolve to this exact
  DB container and database. Container/network IDs are in external receipts.
- No containers/accounts/roles created, removed or restarted. No seeds, SEC
  collection, backfill, LLM/OCR, paid APIs, ticker writes or scheduled jobs.

## Keys, migrations and candidate process

Read the installed local CLI status and running Kong configuration in memory.
All four stack key types were present in the running gateway. Legacy anon and
service keys equal the existing main configuration. New publishable/secret keys
are **absent** in main, not conflicting values. Candidate used the current stack
publishable/secret keys only in its child process; no keys/tokens/cookies copied
to receipts, source, environment files or browser automation. No `NEXT_PUBLIC_`
service key was passed. Main environment-file SHA-256 is unchanged.

Before writes: ledger 132, latest `20261006223000`, all Kiwoom tables/RPCs absent,
required admin/audit/SEC tables and service-only actor-role function present.
The standard local dry-run listed exactly:

1. `20261008121000_kiwoom_ticker_evidence_reviews.sql`
2. `20261008121100_kiwoom_human_comparisons.sql`

Standard local push applied only these two. Ledger is now 134, pending none.
This creates **three** tables: existing evidence reviews, SEC human judgments,
and comparisons. All three have RLS and append-only triggers; service role has
SELECT/INSERT, not UPDATE/DELETE. Eleven indexes and both service-only RPCs were
checked. PostgREST OpenAPI exposes all three tables and both RPCs. No ledger-only
marking, reset, manual SQL correction or earlier migration reapplication.

Next 16.2.6 ran from the candidate on `127.0.0.1:3111`. Minimal child environment:
system process essentials, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, `APP_BASE_URL`, `DEV_ALLOWED_ORIGINS`,
`NEXT_TELEMETRY_DISABLED`. No SQL URL, LLM/mail/Telegram/cron settings. Server-side
diagnostic confirmed loopback REST origin. No environment file was created.

## Actual UI → API → PostgREST → DB

Chrome's existing profile/session opened `/admin/data/kiwoom-verification`.
AdminShell showed **Operations**. No new login credentials or cookies were read,
exported or fabricated. The existing real session was reused, not a new password
login test. Viewport/design inspection was not performed.

Real notice 4611, image 1, manual row:
`2026 / October 6 / US / symbol change / PSKY / 파라마운트 스카이댄스 / PSKY → SKYD`.
The October 5 corporate-action row is a different row and was not used.

- Snapshot SHA-256: `78d820eb08e42b755cf9b8083aa7da13aaa142323848eb10fd0c6d4b78d255f2`.
- Image SHA-256: `8a35b9b094754035c26e366024719c26bd8dc11758b9f470c269252f25c97df2`.
- CIK/class/exchange not inferred from SEC or added to this row.
- Case: `e9f560f6-4079-4be3-9fa9-377e5cd0c828`.

| Revision | Saved review ID | Stored values | Result |
| --- | --- | --- | --- |
| 1 | `17452b18-9ad2-4c71-8e3d-3bf414d8385d` | PSKY / SKYD / null date | HTTP 200, unclear, preserved |
| 2 | `91bdc584-47ba-4c0b-93f3-a6d77883e574` | PSKY / SKYD / 2026-10-06 | HTTP 200, unclear, preserved |

Date input caveat: automation `fill()` showed a DOM value but it disappeared on
the next React render. Revision 1 really stored null; it is **not** reported as
a successful dated transcription. Native keyboard input and blur retained the
date across a checkbox rerender, then revision 2 stored/reloaded it correctly.
This does not reproduce a normal keyboard user-path defect; no product edit.
The unchecked checkbox after saving is the existing intentional reset, whereas
both saved drafts have `usMarketRowReviewed: true`.

Actual history clicks reread both IDs through HTTP 200 GETs. Exact review 2 also
loaded into the human-comparison panel with the correct case/revision/snapshot/
image/locator. Original evidence `recheck` returned unchanged source/image.
Trying to save from historical revision 1 after revision 2 existed returned
HTTP **409**, with “A newer review exists” in the UI; no third record/audit.

SQL and service PostgREST reads are deeply equal for complete draft/snapshot and
all selected immutable refs. Both request hashes recompute correctly. Both
audits have role `operations`, matching authenticated actor, request ID, case,
record ID, revision and `tickerAuthority: none`. Revision 2 audit predecessor is
revision 1. Actual actor UUID is hashed in receipts; no personal details saved.
Final counts: evidence reviews **2**, corresponding audits **2**, human judgments
**0**, comparisons **0**. No withdrawal was recorded for these evidence reviews.

A separate direct browser navigation to the JSON GET was blocked by the browser
client (the server logged 200). It is not claimed as a separately decoded API
response proof; successful UI GET read-back plus SQL/REST equality are the proof.

## Blocked and unverified checks

SQL and REST agree that `sec_ticker_resolution_decisions` contains **0 rows**.
The retained real sample's ID `8a301af7-075b-537b-ad26-616dc8ce1d84` returned HTTP
**404 / KIWOOM_CANDIDATE_NOT_FOUND** in the actual administrator UI. It was not
substituted with another candidate or seeded. Thus exact SEC candidate/quote,
human preview, atomic append, replay/no-op, human revision/predecessor, stale,
withdrawal/latest withdrawn and human actor/audit linkage are **environment
blocked**, not actual E2E PASS. Prior isolated tests do not replace them.

Actual anonymous candidate API GET and same-origin POST: **401
ADMIN_AUTH_REQUIRED**. Anonymous cross-origin POST: **403 AUTH_ORIGIN_REJECTED**.
Responses are private/no-store. These are not authenticated adversarial tests.
Evidence-review expected-revision conflict was verified as above; human expected
revision conflict remains blocked. Request-ID replay/body collision, body actor
override, authenticated cross-origin, support-role denial, actual changed
source/review/image stale controls and simulated lookup outage were **not
verified in this real session**. No alternate account/role was created, session
exported, live service broken or fixture result relabeled to fill these gaps.
Missing candidate was observed; an outage-versus-missing comparison was not run.

## Protected data gate — FAIL (28/30 unchanged)

Before → after migration: **30/30** protected table counts/content hashes match.
Before → after authenticated UI/API: **28/30** match. SEC candidate/payload,
ticker current/projection, Watchlist, Alert, subscriptions and the remaining
selected tables match their recorded fingerprints. Two exceptions:

| Table | Rows before/after | Before full-content MD5 | Final full-content MD5 |
| --- | --- | --- | --- |
| alert_preferences | 10 / 10 | 0531126aa159167b44fdea711165aada | fcfaf8d6dacfdfa2a8f19ad731c385dc |
| user_profiles | 12 / 12 | 99fdc18f6f2b056e9b5345b69425a64f | c5b28974c6159a20c4955c0728b4a1b0 |

Read-only follow-up: one row in each has `updated_at` during this run; both rows
belong to the saved review actor. Final timestamps are respectively
`2026-10-08T09:11:54.99383Z` and `2026-10-08T09:11:54.972981Z`.
Existing `resolveAdminApiAccess` calls `resolveAuthSession` with default
`bootstrap=true`; `ensureUserBootstrap` uses merge-upserts on these two tables.
Their existing BEFORE UPDATE triggers run `set_user_alert_updated_at`.
This established code path and observed timing support Auth bootstrap as the
cause. Aggregate baseline hashes cannot prove that **only** timestamps changed;
no pre-run per-column snapshots exist, so that narrower claim is withheld.

No data was restored/deleted to conceal the difference, and no shared Auth
behavior was changed during this verification task. Follow-up review must decide
whether administrator identity reads should use the existing no-bootstrap path
and test its semantics separately. Full protected-data acceptance is **not PASS**.
Allowed changes also remain: two ledger entries and two evidence/audit records.
This is not a claim that the whole DB remained unchanged.

## Reproduction, artifacts and cleanup

`scripts/verify-kiwoom-loopback.mjs` provides read-only target/schema/hash/REST/SQL
inspection and a separate candidate-process launcher. Credentials stay in memory;
child errors suppress captured sensitive output. It does not migrate/write DB,
seed, authenticate as a user or automate browser writes. Browser actions above
used the existing real session and visible controls.

```powershell
node --no-warnings --experimental-strip-types scripts/verify-kiwoom-loopback.mjs inspect '<receipt.json>' '<existing main env path>'
node_modules/.bin/supabase.cmd db push --local --dry-run
# Apply only after confirming the dry-run is exactly the approved pair:
node_modules/.bin/supabase.cmd db push --local --yes
node --no-warnings --experimental-strip-types scripts/verify-kiwoom-loopback.mjs serve '<server.json>' '<existing main env path>'
node --check scripts/verify-kiwoom-loopback.mjs
npx tsc --noEmit --incremental false
git diff --check
git diff --cached --check
```

External receipt root:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/loopback/`.
Retained `before.json`, `after-migration.json`, `server.json`, `server.json.pid`,
`after-review.json`, `final.json`, `comparison.json`, and `review2-saved.png`.
`auth-bootstrap-observation.json` retains only aggregate timing/actor-match facts.
`comparison.json` records the two changed protected tables, not a masked PASS.
The comparison command intentionally failed its unchanged-data assertion.
Artifacts stay outside Git; no source image/private payload dump committed.

TypeScript and script syntax pass. Product tests were not rerun/relabelled as
actual integration tests; product code was unchanged. Only this verification
document and script are committed. Next's generated `next-env.d.ts` was restored
from its exact pre-server copy. Owned launcher/Next process tree terminated and
3111 listener gone; owned Chrome tab closed. Supabase containers, migrations and
append-only records preserved. Main environment unchanged; main/3110 untouched.
No merge/push/deploy. Stop for independent GPT review with the blockers above.
