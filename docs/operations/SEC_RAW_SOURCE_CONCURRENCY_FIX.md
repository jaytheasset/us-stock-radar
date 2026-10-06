# Raw source concurrency guard and completed PostgreSQL verification

2026-10-06, existing eeb4, base
`835fdfcaf246134a89dbc3b382adb4b37d77edec`, detached / clean at start.
Prior failure record remains in `SEC_SUBMISSIONS_POSTGRES_VERIFICATION.md`.
This run fixes the raw repository boundary and completes the previously
unreached checks. No migration, normalization, HTTP, API, UI or scheduler change.

## Product change

`PostgresSecStructuredRepository.insertRawSources()` now uses
`ON CONFLICT DO NOTHING`, without an arbiter target, to handle all existing
unique constraints. It does not catch 23505, retry errors, generate replacement
IDs, change source URLs or update existing raw rows.

After each raw INSERT, a **separate SELECT in the same transaction** verifies
every input against the persisted row using ID, CIK, source kind, source URL,
source identity, hash, exact raw string and JSONB payload equality. The stored
payload must also equal the input raw string parsed with the existing
JavaScript JSON.parse -> JSONB representation contract. This deliberately
preserves existing numeric representation (including large numeric lexemes)
rather than adding PostgreSQL-specific reinterpretation. Exact raw strings are
never normalized, reserialized or whitespace-stripped for the body comparison.

The separate statement uses a new READ COMMITTED statement snapshot after a
competing INSERT has committed. A single INSERT/SELECT CTE's earlier snapshot
is not relied upon. Missing/mismatched rows, an alternate ID on the same natural
key, or a contradictory batch produce `sec_raw_source_identity_mismatch` before
any issuer/name/ticker/ledger/fact INSERT. Checking only some rows is insufficient;
the verified row count must equal the entire input chunk count. All raw chunks
are handled before follow-on observations begin.

Timestamps, source schema version and raw acquisition classification are not
identity fields and do not overwrite the original stored metadata. Only IDs
actually returned by INSERT enter `insertedRawSourceIds`; verified old rows
remain dedupes. Managed mode rolls back failures. External mode still leaves
commit/rollback to its caller and never issues its own commit.

## One owned PostgreSQL database, before and after

Existing development engine revalidated: `127.0.0.1:56322`, PostgreSQL 17.6,
system ID **7678429483712069671**, `postgres` administration session. Created
exactly one temporary database from template0:

- `sec_submissions_eeb4_7eba31252c624dd8af81f7a0505543f6`
- OID **164495**, owner `postgres`
- ownership marker `eeb4 submissions verification 7eba3125-2c62-4dd8-af81-f7a0505543f6`

The unchanged foundation migration `20260821140512` supplied all six tables,
PK/unique/FK/check constraints, RLS and existing service-role privileges. No
cluster roles, shared application tables, migration history or server settings
were changed. All actual repository work used SET ROLE service_role and managed
transactions. Each connection and write target was checked against the recorded
DB identity; this was not a localhost-only check.

The harness ran **before product edits**, wrote a partial receipt, then paused
without an open application transaction. After the code change and focused
tests, a continuation marker resumed the same process/database and dynamically
loaded the edited repository module. The original class was not monkey-patched
into a simulated SQL fix. The pause has a 15-minute cleanup deadline.

### Before: confirmed original error

Four small synthetic first-write races used two distinct pg Clients/backend
PIDs per pair, synchronized immediately before raw INSERT. All targets began
with zero raw rows. One pair returned:

- one successful transaction: inserted **5**, deduped **0**;
- one SQLSTATE **23505**, constraint `sec_structured_raw_sources_pkey`, rollback;
- separate reader: raw/issuer/name/ticker/ledger each **1**.

The other three pairs returned insert + dedupe. Both outcomes, operation/table
SQL trace and post-race DB counts were recorded. These small synthetic trial
counts are not an estimate of production failure frequency.

### After: normal concurrency, damage rejection and versions

- **10/10** new synthetic first-write races passed, **20/20** calls successful.
  Each pair returned `(inserted=5, deduped=0)` and `(inserted=0, deduped=5)`.
  Raw/issuer/name/ticker/ledger each remained exactly **1**; exact raw/hash/ID
  matched. This is actual database constraint behavior, not a process lock.
- **7/7 actual DB negative fixtures** rejected: same ID/different body or hash,
  different CIK, different source, same natural key/different ID, unchanged
  ID/hash with damaged stored body, damaged payload, and mixed valid/invalid
  source batch. No subsequent observations were inserted. Entire prior table
  snapshots matched after rollback. The mixed batch really inserted one new
  raw row before its failed guard; that row was rolled back too.
- Same URL/CIK with genuinely different body/hash stored **2** distinct source
  versions. Neither version was deleted or rewritten. Identical body with new
  timestamps/acquisition classification inserted **0** and preserved the first
  stored metadata. No current-version selection policy was introduced.
- Additional isolated repository tests cover a missing/unobservable SELECT
  result, source-kind/URL/hash mismatch, contradictory batch, inconsistent
  input payload, JSON property order/large-number representation and external
  transaction ownership. These supplementary tests use an honest SQL-memory
  double, not claims of extra PostgreSQL damage cases.

## Completed real-source checks

The previous receipt had hashes but no preserved raw bodies, so this run fetched
each allowed main document once through the unchanged real HTTP client and
Submissions-only service. Expected names/listing pairs came from received
sources, not hardcoded fixture answers.

| Received source | Exact listings, all Nasdaq | Ledger | Initial inserted rows | Read-back / existing detail reader |
|---|---|---:|---:|---|
| Apple Inc., 0000320193 | AAPL | 1,000 | 1,004 | PASS |
| Alphabet Inc., 0001652044 | GOOGL, GOOG, GOOGM, GOOGN | 1,000 | 1,007 | PASS |
| Kodiak AI, Inc., 0001853138 | KDK, KDKRW | 259 | 264 | PASS |

Writer connections closed before independent reader connections checked exact
body/hash/source ID/CIK/source identity/first fetched_at and all normalized
recent-ledger fields. All name/listing observations referenced the same raw ID.
No CompanyFacts facts were generated for any real sample.

Kodiak additionally ran the same real body on independent backend PIDs **9170**
and **9171**, returning **264 inserted / 0 deduped** and **0 inserted / 264
deduped**. It retained one raw/issuer/name, two ticker rows and 259 ledger rows.
Source ID `dce7d2f1-31cd-5e9a-b5b9-9c9dbabd92dc`, SHA-256
`ed2d615eb56c182e21f822eb83acbead248d6fd889325c039ea7eef5aa7f64df`.

`readStockHeaderSecIdentity` actually queried the temporary DB through the
bounded SQL adapter, honoring the reader's CIK/source-ID/order/limit predicates.
All **7** exact ticker/exchange pairs passed. Current catalog input came from
one real `company_tickers.json` request, checked at
`2026-10-06T13:10:55.844Z`, 10,434 rows. This is DB -> existing reader verification,
not PostgREST, Next or browser verification.

Exact-body sequential replay of all three real samples inserted/updated **0**,
and complete table snapshots, including original fetched_at, stayed identical.
Preserved minimal fixture CIK 0001022701 then ran single -> full -> single ->
full: inserted **5, 3, 0, 0**, deduped **0, 5, 5, 8**. The two fixture financial
facts and all existing rows were preserved after the latter replays. CompanyFacts
here was a preserved fixture, never a network request.

For controlled SQL failure, a temporary DB-only trigger rejected fixture CIK
0001123799 at name insertion with **P0001**, after confirmed raw=1 and issuer=1
inserts. The real repository rolled back. A different connection confirmed all
prior rows unchanged and no partial batch. The trigger/function were removed;
re-execution inserted **5** successfully. No failure device entered a migration.

Actual SET ROLE anon/authenticated checks rejected SELECT and INSERT on all six
tables: **24/24 SQLSTATE 42501**. Service-role storage/reading succeeded with
existing grants. No grants or RLS policies were expanded to make tests pass.

## Calls, cleanup and regression

- Real external SEC: **3 main Submissions + 1 company catalog** HTTP attempts,
  all HTTP 200, no retry. No new CompanyFacts/history/XBRL/filing-body/LLM call.
- Actual captured-body replay: **4** invocations (Kodiak race plus three
  sequential replays). Fixture replay: **6** Submissions invocations (four cross
  path, failed storage and recovery), **2** preserved CompanyFacts invocations.
  Synthetic races/negative/version tests are separate from both categories.
- Harness pg calls: **1,469**, including **11** admin metadata/create/drop and
  **1,458** against the owned DB. Repository operation trace contains **423**
  statements. A multi-statement migration pg call counts once in call totals.
- Owned connections were closed. Database name/OID/owner/marker and zero active
  sessions were rechecked; plain DROP removed only this DB. No FORCE or other
  session termination. `databaseDropped=true`, `ownedConnections=0`.
- Existing structured/O/S/HTTP **219 retained + 4 added = 223 PASS**;
  search/identity/etc. **138 PASS**. No weakened original assertions.
- F1 native loopback **6/6 PASS**; body/header/trickle aborts approximately
  15.014s / 15.010s / 15.012s; no forced cleanup, snapshot/time and recovery kept.
- `npm run typecheck`, harness syntax checks and `git diff --check`: PASS.

Local receipts under `C:/Users/PC/.codex/visualizations/`:

- `sec-submissions-conflict-fixed-20261006.json` (full result)
- matching `.before.json`, `.identity.json` and `.continue` (audit checkpoint)
- `sec-raw-fix-structured-tests.txt`, `sec-raw-fix-catalog-tests.txt`
- `sec-raw-fix-f1-regression.json`

No large source bodies or credentials were added to Git. The test entry point
remains `scripts/verify-sec-submissions-postgres.mjs --run --system-id=<verified ID>
--output=<new external receipt>` with process-only SEC_VERIFY_ADMIN_DB_URL and
the configured SEC_USER_AGENT; absolute loader flags are documented in the
preceding stage-3 record. Normal runs execute fixed-path cases directly.
`--pause-for-repair` is only for a before-edit reproduction on an unfixed
repository; do not use it expecting the fixed code to reproduce the old bug.

## Stop boundary

This is a bounded candidate verification PASS, not a migration/deployment or
continuous-current-state claim. Shared/site DB data, existing financial data,
cluster roles, environment files, Docker, 3110 and other task servers were not
changed. Local main's last supplied value remains historical; remote main,
Vercel, production migration and cron states were not queried.

No auto-refresh, last-checked, current snapshot policy, site loading, backfill,
search/detail writes or merge/push/deploy. PostgREST/Next/browser and authenticated
Live Room remain unverified. Stop for independent GPT review.
