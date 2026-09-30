# SEC listing-status observations and as-of reader

This is a small source-backed history layer, separate from filing/event records,
Listing Risk results, and Monitor decisions. It does not claim complete current
market status. No UI, ingest trigger, model, alert, or timed refresh is added.

## APIs and stored meaning

- `persistSecListingObservation({rawItemId, eventId?, asOf})` explicitly consumes
  an existing SEC raw record. Form 25/25-NSE and their amendments use the existing
  deterministic source/state reader, independently of Primary or Monitor success.
  8-K/6-K require an explicit matching event, the current official Listing Risk
  reader, direct SEC cover scope, and source-stated dated evidence. A Listing Risk
  label alone is not canonical status.
- `readSecListingHistory({rawItemId? | scope?})` returns immutable observations,
  their original source snapshot/hash, exact scope, dated state, attachment proof,
  evidence document URLs/hashes and unresolved reasons. Original XML/HTML and
  attachments remain in the saved raw snapshot. It rechecks source, parser version,
  reported facts, typed evidence and attached identity. Stale/malformed evidence
  cannot silently become a positive state. Read failures do not mean no evidence.
- `readSecListingStatusAsOf({securityIdentityId, scope, asOf})` reduces validated
  stored observations for one exact issuer/security title/exchange. A null
  identity returns unresolved. It returns separate listing and trading axes,
  dates, reasons and the observation IDs used. It never writes a current-state row.

The new `sec_listing_status_observations` table is append-only for the application:
service-role SELECT/INSERT and writer RPC only; anon/authenticated have no access,
and service-role UPDATE/DELETE are revoked. Exact JSON payload SHA-256 uniqueness
makes repeat and concurrent same-input writes return the same ID. A changed
source/version/as-of/proof produces a separate observation, never overwrites one.
The writer checks raw snapshot identity, event linkage and stored identity/facts;
the official application reader supplies semantic/source/proof revalidation.
Direct table contents must not bypass that reader.

Migration: `20260930182700_sec_listing_status_observations.sql`. It creates only
this table, indexes, permissions and its writer; no existing data is rewritten.

## Identity and projection boundaries

The first version reuses the existing **validated AUTO SEC ticker-continuity
security identities**, through `readSecTickerResolutionByDecisionId`. Both cover
observations must establish the same exact CIK, security title and exchange as
the filing. This is intentionally narrow; a ticker catalog entry, CIK alone,
issuer name or human override does not fill the gap. Multiple matching identity
IDs are conflict. Incomplete/read-failed identity evidence does not authorize a
match. No new identity registry or backfill is introduced.

Attachment is an observation-time proof, not an automatic future relinking job.
Unattached observations remain auditable and unprojected. New identity evidence
does not silently rewrite historical attachments. A future relinking/reconciliation
step needs explicit treatment of older unresolved or conflicting observations;
the current reducer conservatively retains them as blockers.

As-of uses filings available by the requested date and the validated identity's
source date, then reevaluates the original evidence at that date. This is an
SEC-evidence date view, not a reconstruction of which rows the application had
ingested on that day. A later filing does not leak backward into earlier views.
Effective/suspension dates come from source evidence, never filing-date offsets.
An explicit operative future date can become effective at that date under the
existing reader; an intention, proposal or conditional date remains pending.

No evidence does not imply ACTIVE. Different effective dates, later incompatible
pending evidence, withdrawal/stay, changed sources/proofs, unsupported recovery
and insufficient identity remain unresolved. Suspension is not delisting. Form
8-A is not accepted as active-trading evidence. No restored/relisted/active state
is manufactured. Listing/trading axes are evaluated separately; unresolved or
conflicting evidence is not resolved by choosing the newest result arbitrarily.
Missing-date pending evidence is retained as pending with a null date.

Reads are bounded (100 identity decisions, 1,000 observation rows); exceeded
bounds fail closed. This is not an amendment-chain resolver, security master,
full-market listing history, or guarantee of absence of other SEC evidence.

## Verification, 2026-10-01

Authorized pre-existing isolated target: PostgreSQL `127.0.0.1:57322`, API
`127.0.0.1:57321`, system identifier `7689949482832261158`. No main/shared-local
database was used. No provider calls, Monitor executions, accounts or external
notifications were involved. Existing stored SEC sources were reused byte-for-byte.

| Retained real filing | Saved observation and official readback | Exact-security projection |
| --- | --- | --- |
| TTOO 25-NSE/A `0001354457-25-000637` | Removal 2025-07-21 confirmed; suspension 2025-02-12; source URLs/hashes retained | Unresolved: no validated canonical security/exchange identity |
| FTCH 25-NSE `0000876661-23-001010` | Intended removal 2024-01-02 remains pending, including after that date | Unresolved: same identity gap |
| PLTR 25 `0001321655-24-000231` | Direct HTML scope preserved; status/effective dates unresolved | Unresolved: status and identity gaps |

All three observations persisted and read back. Sequential/concurrent reruns kept
exactly three rows. Forged source, unsupported ACTIVE and nonexistent identity
were rejected. Anon/authenticated access and application UPDATE/DELETE are denied.
Eleven pre-existing source/analysis/Monitor/alert/identity tables retained identical
row counts and SHA-256 digests before migration and after runtime verification.

The isolated DB contains **zero real 8-K/6-K raw records and zero canonical
security-continuity identities**. Therefore real 8-K/6-K persistence and a positive
exact-security attached projection are **not runtime-verified**. The synthetic
8-K contract regression verifies cover/source retention, typed-reader reuse and
unresolved identity behavior; synthetic attachment regressions verify positive
as-of projection, scope/venue isolation, withdrawal, conflict and stale guards.
These are not real-filing identity successes.

Focused regressions: 52/52; full `tsc --noEmit --incremental false`: passed.
Runner: `scripts/verify-sec-listing-status-isolated.mjs`; requires explicit
`LISTING_HISTORY_TEST_DB_URL`, `LISTING_HISTORY_EVIDENCE_DIR` and authorized local
Supabase configuration. It checks target/DB identity and writes only observations.
Use existing `resolve-server-only.mjs` (Node `--import`) and `resolve-ts-paths.mjs`
(Node `--experimental-loader`), with absolute file URLs on Windows.

Evidence outside Git:
`C:/Users/PC/.codex/visualizations/2026/10/01/sec-listing-status-history/`.
`real-cases.json`, per-case history/projection JSON, `verification-result.json`,
protected-table digests, migration history, regression and typecheck logs are
retained there. The new migration's initial SQL operator-parenthesis defect and
inherited local table grants were corrected only in the new candidate objects
during verification. Existing migrations/objects were not changed. The final
file/function/ACL correspondence is recorded separately; no DB rebuild is claimed.

## Candidate handoff

- Worktree: `C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`;
  detached base `9a67d8b26b34c03187c79d77f09b3d53bbdeb747`. Candidate-only commit.
- Local main ref `0b75ffcf573b64fcf030fde432d594bfa9f487ae`, unchanged.
- Cached origin/main `9c13aee7ef41b38bac0637e53e579633745effda`; live GitHub main
  and deployed Vercel commit/status not queried or changed. Equality not claimed.
- New migration applied only to the named isolated DB. Its one history entry was
  recorded with Supabase CLI 2.110.0 using an explicit DB URL (`sslmode=disable`
  for this local target). Other databases still need the ordered candidate migrations.
- No environment/runtime/server/Docker, credentials, cron, UI, Primary/prompt,
  Monitor-policy or frozen feature changes. Main's existing local files preserved.
- An ignored node_modules junction reuses existing shared dependencies; no install
  or lockfile change. Runtime evidence and credential-bearing launch context stay
  outside the commit. No new screens are claimed or required by this layer.
- Merge/push/deploy not performed. Next work should address verified exact-security
  coverage and a real 8-K/6-K case before claiming production-wide status coverage;
  no automatic ingestion wiring or UI is included in this task.
