# Bounded Submissions refresh runner v1

Candidate: eeb4, detached, base `3a7b862030afc8b19b508f32f1eea0abf5ce0ed8`.
This is an explicit server function and CLI only. No scheduler, page/API wiring,
site initial load, target discovery, migration or persistent job history.

## Use and boundaries

Run from this repository on the existing Node runtime. The loaders are the
repository's existing server-only and TypeScript alias support. On Windows,
use absolute file URLs for the loaders (including `%20` for path spaces).

```powershell
$secNode = @(
  '--no-warnings',
  '--import', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs',
  '--experimental-loader', 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs'
)
# Requires explicit SUPABASE_DB_URL in the process. This defaults to dry-run.
node @secNode --experimental-strip-types scripts/run-sec-submissions-refresh.mjs --ciks=0000320193,0001652044,0001853138
# Opt-in syntax only: NOT executed on these real CIKs in this task.
# Also requires the existing SEC_USER_AGENT with an organization/contact.
node @secNode --experimental-strip-types scripts/run-sec-submissions-refresh.mjs --ciks=0000320193,0001652044,0001853138 --apply --expect-db=YOUR_VERIFIED_DATABASE
```

The three CIKs are documentation examples, never implicit defaults. No env-file
discovery, fallback URL, ticker resolution, SEC catalog, FMP or Watchlist input.
Only `--ciks=...`, `--apply`, `--expect-db=...` are supported; unknown/duplicate
flags fail. Invalid/empty lists or more than 20 **normalized unique** CIKs fail
before client construction. Existing normalization and first-occurrence order
are preserved. `runSubmissionsRefresh({ciks, apply?, expectedDatabase?})` is the
server entry point, not an externally exposed endpoint.

The runner owns one `pg.Client`, connect timeout 5s, SQL statement timeout 30s,
client query timeout 35s. It does not obtain/end the site/shared pool. Initial
support is **direct PostgreSQL or a verified session-preserving connection**.
Transaction pooling is unsupported; it cannot guarantee session advisory locks.
Matching `current_database()` proves the requested database name only, not that
the endpoint is development or safe for production. No operating deployment or
production connection was verified here.

## Planning and execution

- `SUBMISSIONS_REFRESH_AGE_MS` is one 24-hour scheduling constant. The official
  reader's `not-confirmed` is initial, `available` under 24h is skipped, exactly
  24h or older is due. Unavailable/invalid/future confirmation is an error. Only
  `confirmedAt` is used; `firstFetchedAt` and UI/reader freshness semantics stay
  unchanged. This is not a claim about SEC update frequency.
- Dry-run performs target/current reads only: HTTP, sequence, writes and refresh
  locks all zero. Apply confirms the expected database, tries the dedicated
  two-int session advisory lock `(0x534543, 0x535542)`, then rereads current.
  There is no saved-plan input. Busy returns immediately without current reads,
  sequence/HTTP/store, or unlocking another session's lock.
- The lock covers cooperating instances of this runner in one database, not
  all SEC callers or a global rate limiter. One backend stays owned throughout;
  there is no reconnect. HTTP has no open DB transaction or row lock.
- One existing `SecSubmissionsRefreshService` and its HTTP policy are reused.
  Refresh starts are at least 1s apart using a monotonic clock. The policy still
  owns its original 125ms HTTP cadence, bounded retry/backoff and 30s full-body
  attempt timeout. No outer refresh retry was added.
- Individual HTTP/JSON/validation/SQL failures can continue after healthy
  transaction cleanup and a same-session health query. Session loss, uncertain
  transport/query completion, failed rollback, or final SEC 401/403/429 stop
  the remaining batch. Session loss aborts an active native HTTP stream and
  prevents later SQL/store or actual HTTP retries on that lost session.
- Each item reports planned/skipped/attempted/failed/not-run, the planning
  reason, prior confirmation when available, invocation flag, actual HTTP
  attempts and successful original refresh result. Batch counters distinguish
  refresh calls from inner HTTP attempts. Successful `attempted` items carry
  `result`; failures carry safe error codes. Unvisited items remain `not-run`.
- `result.publication`, source ID, confirmation receipt, bigint sequence and
  original counts are returned unchanged. `superseded` does **not** say the
  response became current. Same raw content may be `published` with a newer
  confirmation and zero new raw rows. No raw/hash/first-fetch/order guard changes.
- Cleanup explicitly unlocks only an acquired usable session and ends its
  owned client. For a lost/broken transaction, connection close releases the
  session lock instead (`lockReleased=false`, `connectionClosed=true`). The
  report never claims that an explicit unlock succeeded when it did not.
- CLI exit 0 = completed dry-run/apply; 1 = failure; 2 = busy. Reports include
  database name/backend PID, never connection URLs, credentials or raw errors.

## Verification performed (2026-10-07)

All transport was synthetic/localhost. Names/tickers/CIKs and confirmation
clocks in the runner suite are synthetic, not actual SEC confirmations.
Real SEC, CompanyFacts, XBRL, LLM and product API calls: **0**.

Commands (using `$secNode` above):

```powershell
node @secNode --experimental-strip-types --test lib/sec-structured-data/submissionsRefreshRunner.test.mjs lib/sec-structured-data/submissionsCurrent.test.mjs lib/sec-structured-data/submissionsIngest.test.mjs lib/sec-structured-data/submissionsHttp.test.mjs lib/sec-structured-data/secStructuredData.test.ts lib/sec-structured-data/secRequestPolicy.test.ts
node @secNode --experimental-strip-types scripts/verify-sec-submissions-postgres.mjs --run --runner-only --system-id=7678429483712069671 --output=EXTERNAL_RUNNER_RECEIPT
node @secNode --experimental-strip-types scripts/verify-sec-submissions-postgres.mjs --run --current-only --system-id=7678429483712069671 --output=EXTERNAL_CURRENT_RECEIPT
npx tsc --noEmit --incremental false
node --check scripts/run-sec-submissions-refresh.mjs
node --check scripts/sec-submissions-runner-cases.mjs
node --check scripts/verify-sec-submissions-postgres.mjs
git diff --check
```

Database harness requires its explicitly scoped `SEC_VERIFY_ADMIN_DB_URL` and
verified system ID. Runner-only cannot be combined with live/header modes.
Do not omit `--runner-only`/`--current-only`: the older default harness mode
performs real SEC requests and was not run here.

51 tests passed: 12 runner/CLI tests and 39 unchanged current/refresh/raw/HTTP
regressions. Full typecheck and script syntax checks passed. Inputs/flags,
24h boundary, future/invalid dates, unavailable vs initial, pre-I/O validation,
dry-run/busy/skipped zero work, per-company continuation, rollback/session
abort and report redaction were checked. Final 403 used one refresh/one HTTP;
final 429 used one refresh/three HTTP attempts under the unchanged retry policy.

Actual PostgreSQL 17.6 at the existing verified dev cluster was used only via
the established owned-temporary-database harness. Existing roles/permissions
and the two existing migrations were reused; no new role/schema migration or
shared application-data read/write. Admin access was for cluster/ownership
metadata and creating/dropping the uniquely marked owned databases.

| Actual PostgreSQL + native localhost HTTP check | Result |
| --- | --- |
| Dry-run three initial CIKs | Three planned; entire snapshot/sequence unchanged; HTTP/sequence/write/lock = 0/0/0/0 |
| Initial sequential apply | Three published; official reader source/time match; sequence-start gaps 1010.03ms and 1007.26ms (measurement tolerance 1ms) |
| Identical response on due refresh | Raw insert 0; same raw ID/first fetch; confirmedAt advances by controlled 24h |
| Dry-run followed by another completed refresh | Apply rereads and skips; HTTP/sequence/write = 0/0/0 |
| Two independent runner sessions | One acquired; second busy, distinct PIDs, HTTP/sequence/write = 0/0/0 |
| Held HTTP response | Writer idle, xact_start null; independent official reader sees old complete current |
| Partial HTTP JSON + real SQL publication failure | Statuses skipped/failed/failed/attempted; failed companies keep old current/time; SQL raw insert rolled back; later company succeeds |
| Rerun partial batch | Only two unfinished CIKs attempted; subsequent all-complete rerun has zero HTTP/sequence/write |
| Final SEC 403 | First failed; second not-run; lock released, subsequent run succeeds |
| Owned connection ends during partial HTTP body | Stream aborted; one sequence/one HTTP/no writes; remaining item not-run; no replacement connection; next run acquires |
| Independent newer refresh while runner HTTP held | Runner returns superseded, official current remains on newer source |
| Injected rollback failure | Batch aborts, owned session closes and releases lock; subsequent run succeeds |
| Expected DB mismatch | No lock/HTTP/sequence/store; snapshot unchanged |

Runner suite: **11 named checks, 19 runs, 21 localhost HTTP attempts** (20 runner
attempts + one independent refresh in the superseded case). All 20 runner
HTTP attempts verified `idle / xact_start=null`. Every cleanup checkpoint
verified no owned runner sessions/advisory locks remained. HTTP server closed.

Existing actual current suite: **21 named checks**, 27 localhost HTTP attempts,
including three raw races, seven identity guards, publication rollback,
reversed completion, role boundaries, bigint preservation and replay behavior.

External receipts (not committed):

- `C:/Users/PC/.codex/visualizations/sec-submissions-runner-v1-20261007-b.json`
- `C:/Users/PC/.codex/visualizations/sec-submissions-runner-current-regression-20261007.json`

Both accepted databases were dropped after ownership/OID/marker checks with
zero remaining sessions; no FORCE DROP or unrelated backend termination. The
initial harness attempt (`...-a.json`) hit the existing service-role restriction
on directly reading sequence state; only that verification read was moved to
the owned DB's control session. No permission was broadened, and that temporary
database was also dropped. Product code was not changed to bypass permissions.

## Review stop

No UI or site reader changes, browser/login/Live Room retest, production
connection/pooler verification, initial site load or scheduling activation.
No merge/push/deploy; GitHub main, Vercel, shared/production migrations and
actual cron state remain unqueried. Local main reference supplied for this task:
`7fa1de18a5c9b6dc9454862c1d195ea6a773cefa`; it was not integrated. Independent
review is required before another task or any live apply/scheduling work.
