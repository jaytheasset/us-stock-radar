# Submissions stage 3: PostgreSQL verification stopped on concurrency failure

2026-10-06, existing eeb4 candidate. Base
`2f45d9a97d06ca7017339aa3d9a33396b827485c`, detached / clean at start.
**Overall verification is not PASS.** Actual PostgreSQL returned SQLSTATE
`23505` on the first-write concurrency case. Per the request, testing stopped,
the owned temporary database was dropped, and product code was not repaired.

## Isolation and schema actually used

- Existing engine: host `127.0.0.1:56322`, PostgreSQL **17.6**, system identifier
  **7678429483712069671**. This matches the development engine recorded in
  `docs/SUPABASE_LOCAL_DEVELOPMENT.md`, `supabase/config.toml`, and prior
  architecture verification records; safety was not inferred from localhost.
- Listening processes were the existing Docker Desktop backend and WSL relay.
  No Docker command, new container, stack, process restart or server change.
- Read-only preflight connected to `postgres` as existing `postgres` and checked
  cluster identity and existing roles. No shared application table or migration
  history was queried or changed. `postgres` has CREATEDB and BYPASSRLS but is
  not a superuser; `service_role` has BYPASSRLS, anon/authenticated do not.
- Created exactly one database from template0:
  `sec_submissions_eeb4_9559fbe269074fbb9845ca57e6885124`, OID **164195**,
  owner `postgres`, marker
  `eeb4 submissions verification 9559fbe2-6907-4fbb-9845-ca57e6885124`.
- Every temporary connection checked current database/OID/owner/marker and
  host/port. All application writes used **SET ROLE service_role** and the
  actual repository's **managed transactions**. Guard checks do not issue a
  SELECT before rollback in an already-aborted transaction.
- Applied only the unmodified existing
  `20260821140512_sec_structured_data_foundation_v1.sql`, SHA-256
  `b6828ed0177c977f557d71370814d0ccd3f4b634e6b260e1473171d1a7f28bbb`.
  All six tables retained their FK/unique/check constraints and enabled RLS.
  Candidate migration search found no later definition/grant/revoke alteration
  to these six tables. Dependent services' migrations were not applied.
- No role creation, cluster role grant, server configuration change, shared DB
  trial writes, or migration-history insertion. The migration's original
  table/sequence grants applied only inside the new temporary database.

## Actual SEC requests and completed read-back

The existing `SEC_USER_AGENT` was read from the existing main workspace's
ignored `.env.local` into the verification process only. The file was neither
printed nor changed; no other credential was copied. The existing local test
connection setting was likewise held only in process memory.

The real `SecStructuredHttpClient` and `ingestIssuerSubmissions` performed these
three sequential main-document HTTP requests. Each returned HTTP 200 on one
attempt; there was no additional retry or re-download.

| CIK | SEC response name / listings | Managed insert / reconnect read-back |
|---|---|---|
| 0000320193 | Apple Inc.; AAPL / Nasdaq | PASS: raw 1, issuer 1, name 1, ticker 1, ledger 1,000, facts 0; inserted 1,004 |
| 0001652044 | Alphabet Inc.; GOOGL, GOOG, GOOGM, GOOGN, each Nasdaq | PASS: raw 1, issuer 1, name 1, ticker 4, ledger 1,000, facts 0; inserted 1,007 |
| 0001853138 | Main JSON HTTP 200 received; simultaneous ingestion case | FAIL: SQLSTATE 23505, sec_structured_raw_sources_pkey; completed read-back not claimed |

The first two writer connections were closed after commit. Independent reader
connections compared the database's exact raw string, SHA-256, deterministic
source ID, source identity/CIK, original fetched_at, name and each exact listing
pair against the captured HTTP document and existing normalized output.
Every normalized recent-ledger field and source link was checked against
actual SQL rows, including all 1,000 rows (not just the bounded reader page).
No ticker/company name was used as an expected hardcoded answer.

| CIK | Raw bytes | Source ID | SHA-256 |
|---|---:|---|---|
| 0000320193 | 163,743 | 9c65a5d6-3ed1-5980-987b-059eff816d89 | e89635068cd46772d1d3859ce2bc839fab781630787943a1874f258fa354e7a9 |
| 0001652044 | 152,415 | c4e73b66-6d5b-5392-a9ae-5316f623e739 | 9434407b197d6322de4bece8ad3b69459c8d6ddf3a68526b4b22b02e8175d33c |

Fetched timestamps: respectively `2026-10-06T12:35:04.384Z` and
`2026-10-06T12:35:04.716Z`. Their observed listings are from these Submissions
responses, not a separately verified current catalog. The optional company
ticker catalog request and existing detail-reader step were **not reached**.

## Confirmed concurrency failure and limited inference

Input: actual main Submissions for CIK `0001853138`, fetched once. One service
execution used the actual HTTP client; a second used that exact captured
document. Two independent pg Clients/backend PIDs were checked as distinct.
A harness barrier synchronized their managed BEGIN calls; neither execution
used an outer/external transaction or changed the repository SQL.

Expected: both calls settle successfully, one inserts and the other dedupes,
with one raw source and one set of observations after the race.

Actual: Promise.allSettled completed, and a rejection had:

```text
SQLSTATE 23505
duplicate key value violates unique constraint "sec_structured_raw_sources_pkey"
```

Relevant unchanged product SQL:

```sql
insert into public.sec_structured_raw_sources (...)
...
on conflict (source_kind, source_identity, content_hash) do nothing
returning id
```

The normalizer also assigns a deterministic primary-key ID from source kind,
identity and content hash. **Cause candidate:** simultaneous insert arbitration
on the composite conflict target does not cover the observed primary-key
conflict in this race. This is not a confirmed PostgreSQL-internal diagnosis
and no proposed fix was applied. It is an existing repository/shared-schema
boundary exercised by the new entry point, not evidence of a SEC input error.

The first-run receipt captured the error but did not retain each race outcome
or partial SQL trace before throwing. Therefore the other transaction's exact
returned counts, Kodiak's post-race row counts and a verified rollback result
are **not claimed**. The harness was then changed only to preserve partial SQL
trace and per-race outcomes on future failures; syntax-checked, **not rerun**.
No additional SEC request or database trial was made after this failure.

## Executed versus unverified

| Check | Status |
|---|---|
| Dedicated DB identity/schema/constraints/RLS | Confirmed |
| Real service_role managed writes and fresh-connection reads | Confirmed for Apple and Alphabet |
| Original string/hash/source ID/name/listing/ledger | PASS for those two samples |
| Two-client simultaneous first write | FAIL, 23505 |
| Existing readStockHeaderSecIdentity through real SQL adapter | Not reached |
| Current company catalog source/time | Not requested |
| Sequential exact-body replay and first fetched_at preservation | Not reached in this PostgreSQL run |
| Preserved-fixture standalone/full cross replay and financial preservation | Not reached in this PostgreSQL run |
| Controlled SQL failure injection/rollback/recovery | Not reached; no test trigger/function installed |
| anon/authenticated actual SELECT/INSERT denial | Not reached; role attributes alone are not access verification |
| PostgREST / Next / browser / authenticated Live Room | Unverified |

Execution totals: **3 real SEC Submissions HTTP attempts**, **1 captured-body
replay invocation** (the concurrent attempt), **0 company-catalog requests**,
**0 CompanyFacts/historical/XBRL/filing-body/LLM requests**. The harness counted
**115 pg query invocations**: 11 admin/catalog/create/drop calls and 104 against
the temporary DB, including identity guards, read-back and failed operations.
A multi-statement migration query counts as one pg invocation, not one SQL
statement. Independent read-only preflight queries are outside this count.
Fixture CompanyFacts replay count is zero because the phase was not reached.

## Cleanup, receipts and reproduction boundary

All owned connections were closed. Admin rechecked the development cluster,
database name/OID/owner/marker and zero connected sessions, then issued plain
DROP DATABASE for **only the recorded owned DB**, without FORCE or terminating
any other session. Database absence was confirmed: `databaseDropped: true`,
`ownedConnections: 0`. No shared application tables, existing financial data,
cluster roles, settings, Docker, 3110 or other task servers were modified.

Local receipts (no credentials or large raw bodies):

- `C:/Users/PC/.codex/visualizations/sec-submissions-postgres-20261006.json`
- `C:/Users/PC/.codex/visualizations/sec-submissions-postgres-20261006.json.identity.json`

New harness: `scripts/verify-sec-submissions-postgres.mjs`. It requires explicit
`--run`, `--system-id=<independently verified dev system ID>`, a new external
`--output=<receipt.json>`, process-only `SEC_VERIFY_ADMIN_DB_URL`, and the
existing `SEC_USER_AGENT`. There is no default DB connection in the harness.
Use the repository's absolute server-only and TS-path loader URLs as in the
preceding stage-3 verification document. Do not use the old shared-DB script.

Performed local checks: `node --check scripts/verify-sec-submissions-postgres.mjs`
and `git diff --check`. Product code is unchanged. Unreached harness phases are
implementation awaiting execution, not passing tests.

No actual site loading, refresh, migration rollout, schedule or UI connection.
Latest-snapshot selection and last-checked remain deferred. Local main,
GitHub main, Vercel, production migrations and cron were not queried; no
integration/deployment equality is asserted. Stop for independent GPT review
of this failure before any fix, rerun, site loading or merge.
