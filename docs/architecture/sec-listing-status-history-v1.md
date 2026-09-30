# SEC listing-status observations and as-of reader

This is a small source-backed history layer, separate from filing/event records,
Listing Risk results, and Monitor decisions. It does not claim complete current
market status. Form 25-family raw ingestion now persists observations automatically.
No UI, model, alert, or timed refresh is added.

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

Attachment distinguishes two evidence paths using the existing identity table:

- Actual ticker changes still require the existing validated AUTO decision and
  explicit change-continuity evidence, through `readSecTickerResolutionByDecisionId`.
- Unchanged securities can use `persistStableSecSecurityIdentity`: two distinct,
  chronological, source-validated SEC cover filings, each with exactly one complete
  common-stock observation and matching CIK, exact title/class, ticker, exchange
  and dimensions. This writes an identity, **not a ticker-change decision**.

Both paths require the filing's exact CIK/security title/exchange scope. Stable
attachment additionally checks stored cover observations between the first proof
and the filing date. A changed ticker/class/exchange, incomplete competing cover,
multiple securities, conflicting source revision or ambiguous identity blocks the
stable path. Source-less Form 25 XBRL cover results are not competing identities:
the separate Form 25 source reader still validates their filing scope. Missing
10-Q cover facts do not receive that exception. Future covers cannot establish or
change an earlier filing's attachment. CIK/name/catalog matching is insufficient.

These are observed identity facts, not proof of continuous trading or an unbounded
historical/current ticker timeline. The latest supporting cover must already be
available at the filing date. Known-at remains the latest supporting SEC acceptance
time; the reader does not backdate it or infer a status from identity alone.

Stored observations remain immutable. The official reader may expose a separate
`resolvedAttachment` only for an otherwise valid old observation whose sole identity
reason was `no_exact_canonical_security_exchange`, using stable evidence available
to that filing. Its original JSON is returned unchanged. Conflicts and source
failures are never overwritten. Projection uses this verified binding; status
evaluation, dates and conflict rules are unchanged. New persistence stores the
verified attachment directly, preserving any earlier unresolved observation.

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

## Initial verification at 8369448c, 2026-10-01

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


## Stable identity validation after 8369448c, 2026-10-01

The original AUTO-only attachment rejected unchanged PLTR with
`SUPPORTED_CHANGE_EVIDENCE_MISSING`. The ticker-change evaluator was correct;
using it as the sole identity prerequisite was not. No ticker-change evaluator,
Monitor, status evaluator, Primary/LLM or other filing-family rule was changed.

Reused original SEC PLTR 10-Qs already persisted in the same authorized isolated DB:

| Accession | Accepted at (UTC) | Source |
| --- | --- | --- |
| 0001321655-24-000135 | 2024-08-05 22:19:46 | https://www.sec.gov/Archives/edgar/data/1321655/000132165524000135/pltr-20240630.htm |
| 0001321655-24-000209 | 2024-11-04 23:08:49 | https://www.sec.gov/Archives/edgar/data/1321655/000132165524000209/pltr-20240930.htm |

Both establish CIK 0001321655, Class A Common Stock, par value $0.001 per share,
PLTR, New York Stock Exchange, and no competing cover security. Original hashes:
`219eafb7a3d8af2822ed6250ecd9041afd9206ad065a112ce77c8366cf02e373` and
`6d3137eaaa81d222777c0d4a59791e38c0588d4a74945511f5233e379ecab5fc`.

- Canonical stable identity: `816ec549-767d-5da6-9966-28d2b3c20118`.
- PLTR Form 25 `0001321655-24-000231` new attached observation:
  `70282488-f1e1-4cc7-923f-a5ea83b6625d`; decisionId is null by design.
- Official history validates the attached observation and preserves original
  unresolved observation `92f7b385-03e5-4a3b-bf9f-f02955ca0719` unchanged, with a
  separately validated read-time binding.
- As-of 2026-09-30 no longer reports `canonical_identity_unresolved` for PLTR.
  Listing and trading both remain unresolved: the preserved source does not
  establish the needed operative dates. This is successful identity attachment,
  not evidence of effective removal or suspension.
- Identity and observation reruns return `replayed` and unchanged IDs. Pre-existing
  source/analysis/Monitor/alert rows and the ticker-change writer are unchanged.
- A request before the second cover remains unattached. Forged symbol and scope
  requests are rejected. Regressions retain changed-symbol explicit evidence,
  multi-security/Class A-B ambiguity, source revision, intervening transition,
  future-evidence and original-history protections. Existing change examples are
  offline contract regressions, not new real filing ingestion runs.

Migration `20260930191430_sec_stable_security_attachment.sql` adds the stable
identity evidence check/writer and a narrow stable branch to listing persistence;
no table is added, and the change-evidence/AUTO contracts are untouched. Applied
only to 127.0.0.1:57322, system identifier 7689949482832261158. Supabase CLI 2.110.0
`db query --file` rejected multi-statement SQL before execution; the unchanged
migration was then applied in one transaction on the verified connection and its
history recorded with explicit-target CLI migration repair. New functions are
SECURITY INVOKER with empty search_path and service-role-only execution. Targeted
permission checks and CLI security advisors passed. No DB rebuild is claimed.

Final checks: 45/45 focused regressions, full `tsc --noEmit --incremental false`,
and `git diff --check` passed. The existing three-real-case runner also passed:
TTOO/FTCH retain unresolved attachments; PLTR is attached with unresolved status.
Sequential/concurrent replay inserted zero new rows (four observations before/after);
all protected table digests and access restrictions were unchanged.

Validation evidence: `C:/Users/PC/.codex/visualizations/2026/10/01/sec-stable-identity-validation/`.
The previous source/cover evidence remains in `../sec-listing-status-real-attachment/`.
These directories contain no committed credentials and are outside Git. The
`apply-and-verify.mjs` run records actual writes; its timestamped rerun directory
contains successful identity/observation/readback/projection and immutable-row checks.
For the existing three-case runner, explicitly set
`LISTING_HISTORY_EXPECT_STABLE_PLTR_ID=816ec549-767d-5da6-9966-28d2b3c20118` in this
seeded DB; omit it only when validating the original pre-identity dataset.

Remaining limits: automatic stable-identity collection and listing-observation
persistence are not wired in this task; no real 8-K/6-K was added. Stable support
is intentionally narrow (two complete, single-common-security covers). Missing,
multiple or changed security evidence remains unresolved/conflicted. No positive
confirmed-status real case is claimed merely from PLTR identity success.

Current task base: detached 8369448c82b23a53d3a42f75e534f85b810834b0 in the same
candidate. Local main ref remains 0b75ffcf573b64fcf030fde432d594bfa9f487ae; cached
origin/main remains 9c13aee7ef41b38bac0637e53e579633745effda. Live GitHub/Vercel
were not queried; parity/deployment is not claimed. No configuration, accounts,
servers, cron, Docker services or shared-local/main data were changed. No UI was
changed or required for this identity-only check; merge/push/deploy not authorized.

## Automatic Form 25 persistence after cf1a5746, 2026-10-01

`runSecRawIngest` now invokes `persistForm25ListingStatusAutomatically` after
existing source/identity/cover sidecars on both saved-raw and existing-raw paths.
Only Form 25, 25-NSE and their amendments are eligible. Dry-run, excluded forms
and failed raw writes do not reach this hook. No Primary/LLM or Monitor dependency
is introduced, and 8-K/6-K automatic persistence remains out of scope.

The hook rereads the exact stored original source and calls the unchanged canonical
writer. Missing/invalid source returns unavailable without a write. Missing identity
is different: preserve the observation and evidence, with an unresolved attachment.
The existing identity rules alone decide whether an exact security can be attached.

Automatic observations are evaluated at the preserved filing's UTC calendar date
so rerunning an unchanged stored source on another day remains idempotent. This is
an observation-time parameter, never an effective date. The unchanged as-of reader
reevaluates explicit source dates at the requested date. Pending does not become
confirmed merely because a proposed date passed; listing and trading stay separate.

Results are returned per item and recorded in `source_runs.metadata.form25_listing_status`,
with inserted/replayed/unavailable/failed counters. A canonical sidecar failure
preserves a successful raw write, records the failure and allows a normal rerun.
No new table, RPC, migration, runtime configuration or permissions are required.
The earlier candidate migrations remain prerequisites in other databases.

### Bounded real persisted-source verification

Target: existing isolated API 127.0.0.1:57321 / DB 127.0.0.1:57322, verified system
identifier 7689949482832261158. `verify-form25-listing-status-ingest-isolated.mjs`
feeds retained exact real sources into the normal `runSecRawIngest` fetch boundary;
all production writers and sidecars remain enabled. This is not a new SEC download,
Primary execution or direct manual observation-writer test. The fresh-raw branch
is covered separately by a focused ingest regression.

| Filing | Saved source-time observation | Attachment / as-of readback |
| --- | --- | --- |
| PLTR 0001321655-24-000231 | Listing/trading unresolved; effective dates absent | Exact stable Class A/NYSE identity attached; canonical status remains unresolved |
| TTOO 0001354457-25-000637 | Removal pending at filing; suspended; removal 2025-07-21 / suspension 2025-02-12 preserved | Source-only state at 2026-09-30 confirms removal/suspension; identity unresolved, so canonical projection unresolved |
| FTCH 0000876661-23-001010 | Removal pending; trading unresolved; proposed 2024-01-02 retained | Still pending at 2026-09-30; identity unresolved, canonical projection unresolved |

Each official history read validated the automatically stored observation. Three
initial runs inserted three observations (4 -> 7); two additional runs per filing
returned the same IDs and inserted zero observations. Existing four observations
and original filing payloads/dates were preserved. No model calls or alerts ran.
Analysis, event, Monitor, alert and canonical identity table digests were unchanged.

Existing sidecars are not all healthy and are separate from this new hook:
- TTOO's aggregate delisting reader returns `event_read_failed_or_ambiguous`;
  two pre-existing event rows for that raw item were confirmed read-only.
- TTOO/FTCH cover persistence returns `persistence_failed` (HTTP 400). The underlying
  SQL failure was not investigated or fixed here. Original Form 25 source remains
  available, and the new canonical observation does not depend on that cover write.
- The retained cover ticker sidecar appended one PLTR UNRESOLVED change decision
  with no identity and no AUTO continuity claim. Existing decisions were unchanged.
  Stable canonical identity attachment succeeds independently under the existing rule.

The initial harness incorrectly protected the entire change-decision table as
immutable and failed its final assertion after all case/readback/replay checks.
Read-only reconciliation confirmed the legitimate unresolved sidecar append and
preserved the original failure. The runner now protects pre-existing decisions
and separately records allowed unresolved appends. Product code was not changed
or rerun to conceal this finding. This is canonical-hook verification, not a claim
that every legacy sidecar or the live collector passed.

Evidence: `C:/Users/PC/.codex/visualizations/2026/10/01/form25-listing-status-automatic/`.
Includes pre-call expected facts, raw/source snapshots, nine ingest outputs,
source-run records, official history/projections, unchanged-data hashes, sanitized
request ledger, original harness failure/reconciliation and final result.
Focused regressions: 58/58 passed. Full TypeScript check
`tsc --noEmit --incremental false` passed. No UI verification is required or claimed.

### Handoff / remaining scope

- Detached candidate base cf1a5746ac415462d5a931efff941161d70a116a in
  `C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.
- Local main remains 0b75ffcf573b64fcf030fde432d594bfa9f487ae; cached origin/main
  9c13aee7ef41b38bac0637e53e579633745effda. Live GitHub main and deployed Vercel
  commit/status were not queried; parity or deployment is not claimed.
- Main/shared-local, credentials, servers, Docker services and unrelated projects
  were unchanged. Existing isolated test data/evidence are retained. No push/deploy.
- Automatic canonical persistence is now wired for Form 25-family only. Missing
  exact identities, missing operative dates and legacy sidecar errors remain
  explicit limitations. Broader source collection, other forms and UI remain out
  of scope; no Listing Risk or Monitor-policy change is included.
