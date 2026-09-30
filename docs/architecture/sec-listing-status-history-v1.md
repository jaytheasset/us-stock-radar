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

## Explicit follow-up observations (2026-10-01)

This candidate adds only two reported values: listing
`removal_decision_withdrawn` and trading `resumed`. Neither means ACTIVE or
relisting. Existing Form 25 parsing/automatic persistence, Listing Risk, Primary,
Monitor policies, and identity rules are unchanged. There is no automatic 8-K/6-K
collection or model call.

`persistSecListingObservation` accepts an optional, explicitly selected
`sourceEvent` with a document URL/hash, exact normalized quote, source date and
literal date text, exact security/exchange scope, and issue reference. Initial
removal decisions and suspensions reuse the existing pending/suspended values.
This is a bounded manual evidence-selection API, not a general prose classifier.
Unsupported wording is rejected. The app verifies retained source membership,
SEC accession/CIK, document integrity, dates, explicit operative wording and
conditional/negated statements; it does not independently establish legal facts.
The service-only SQL guard validates structural state/source/link integrity; the
official reader repeats the app's source validation. SQL is not a second prose
parser. Use the official writer/reader rather than treating a table row alone as
validated status.

Each closing event has `resolves: {observationId, sourceHash, eventDate}`. It must
refer to the same security/exchange, issue and axis, and to the appropriate
initial event. A prior source date or precise regulation reference must recur in
the follow-up evidence. References to absent, changed, wrong-scope or different
issue observations are rejected. Existing rows are never updated/deleted. The
projection closes only that observation on that axis; unrelated or unresolved
observations still block a positive projection. An already completed delisting
cannot be closed as a pending decision or silently become a relisting.

As-of selection uses filing dates as knowledge boundaries, never operative dates.
A single later filing can report both an earlier suspension and its subsequent
resumption: both become known only at that filing, with distinct original event
dates. Separate filings on the same calendar date are conservatively not ordered.
The projector exposes the withdrawal notice date and confirmed resumption date alongside original evidence and
linked observation IDs. It still requires an existing validated exact canonical
security identity. No ticker/name/CIK-only attachment is added.

First-version boundaries: links currently target explicit `sourceEvent` initial
observations. Legacy Form 25/typed Listing Risk observations lacking an explicit
issue reference are NOT silently upgraded or closed. A manually selected source
excerpt must be reviewed for subject/scope and other surrounding disclosures;
this API is not suitable for unattended broad extraction. Repeated independent
issues and conflicting histories remain unresolved rather than taking latest-wins.

### Real isolated persistence validation

Database: existing 127.0.0.1:57322, system identifier 7689949482832261158.
Evidence directory:
`C:/Users/PC/.codex/visualizations/2026/10/01/listing-status-follow-up/`.
Full SEC HTML, URL/hash manifests, selected excerpts, pre-run expectations,
migration before/after, immutable observation IDs, official readback, projection
results and protected-table hashes are preserved outside Git.

- Scorpius 8-Ks 0001079973-24-000891 (June 17) and
  0001079973-24-001121 (July 30): June 14 removal decision and suspension;
  July 29 withdrawal of that removal decision under Section 1003(f)(v).
  Three currently valid observations saved. Withdrawal points to the removal decision only.
  Expected August 2 trading resumption is NOT confirmed trading resumption.
- Apollomics 6-K 0001193125-25-328822 (December 22), exhibit 99.2:
  expressly reports September 18 suspension and October 14 resumption for
  Class A Ordinary Shares (and separately warrants). Two Class A observations
  saved and linked from this single retrospective disclosure. Before December 22
  this source provides no known status. This is NOT verification of a separate
  earlier suspension filing followed by a later resumption filing.
- The September 25 Apollomics 6-K instead describes a conditional September 29
  suspension and an appeal. It was NOT rewritten into September 18 suspension,
  linked as if those dates agreed, or treated as proof of restored trading.

All five current observations passed the official reader. Immediate reruns returned the
same five IDs with no extra observations. SQL rejected an altered predecessor
date. Previous observations and eight protected product/analysis/Monitor/identity
table digests remained unchanged. No Primary/event/alert records were fabricated.

**Real canonical projection remains unresolved for both issuers**: the isolated
DB lacks their exact validated security/exchange identities. Source-backed event
persistence/link/readback is verified; positive before/after canonical projection
is covered only by unit fixtures with explicitly synthetic identities. Tests show
Scorpius pending -> withdrawal while trading remains unresolved without an explicit
suspension effective date, and retrospective
Apollomics unknown -> resumed at its knowledge date. Do not report these unit
projections as real attached-security E2E success. Identity was not weakened or
backfilled in this task.

The initial isolated validation incorrectly copied Scorpius's June 14 notice
date into suspensionDate. The final source adapter preserves the notice date but
only supplies suspensionDate when the source explicitly says suspended
beginning/on that date. A corrected observation was appended; the first attempt
was not overwritten or deleted. Its old summary fails official revalidation and
remains in the isolated history as unusable evidence. Both runtime result versions
are retained. This additional unusable test record also prevents a positive
projection if that history later gains an identity; it is not silently ignored.

Migration `20260930195938_sec_listing_status_follow_up.sql` widens only reported
state CHECKs and the existing writer's optional source-event contract; no new
table/column. Applied only to the isolated DB. SQL applied in a transaction;
Supabase CLI repair then encountered a local DB connection error, so the verified
new version alone was recorded through the same verified PostgreSQL connection.
Migration SQL was not rerun. Existing migration records and observation data were
preserved. Main/shared-local migration application is not claimed.

### Handoff

Detached base 37b87b4fd73b210d464f6c0012bc0f99f748b90d, worktree
`C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.
Local main ref: 0b75ffcf573b64fcf030fde432d594bfa9f487ae. Cached origin/main:
9c13aee7ef41b38bac0637e53e579633745effda. Live GitHub main and Vercel commit/status
not queried; code/deployment equality not claimed. No runtime configuration,
credentials, permissions, servers, cron, Docker services, external delivery or
main/shared-local data were changed. No UI change or browser verification is
needed/claimed. No push/deploy. Remaining blocker for real positive canonical
projection: exact identity evidence; legacy observation linkage and automatic
8-K/6-K extraction remain outside the implemented explicit-source path.

Final focused regression suite: 63/63 PASS (listing-status, delisting-state,
stable identity, Form 25 source connection). Full TypeScript:
`tsc --noEmit --incremental false` PASS. `git diff --check` PASS.
Tests and typecheck logs are in the evidence directory above. No model calls.

## Exact cover selection and audited invalid-summary exclusion (2026-10-01)

This validation supersedes the earlier Scorpius identity/projection blocker above;
the earlier records and reports have not been rewritten.

- Stable identity accepts explicit before/after observation keys from the existing
  source-validating cover reader. Both selected rows must retain the same CIK,
  exact title/class, ticker, venue and dimensions. A competing row for the selected
  title/ticker or an incomplete competing security blocks selection. Rights and
  warrants are retained as sibling evidence, not accepted as common stock.
- An explicit 8-K/6-K source event binds to one unique row in its own original
  filing cover. A short subject may omit only the cover's terminal par-value
  description; a venue may omit its terminal LLC designation. An explicitly
  different par value, class, ticker or venue does not match. The selected row key,
  result ID, document hash, full title, ticker and venue are returned/persisted in
  `attachment.coverRow`. No issuer-name/CIK-only shortcut or external alias source.
- Stable evidence endpoints still require actual receipt timestamps. An intervening
  cover with no receipt timestamp can use its preserved filing date (or the
  original raw filing date) to bound the evidence scan. This creates neither an
  acceptance timestamp nor an effective status date. Unknown dates still block.
- Official history revalidates the unchanged source and source-event/link. Only
  an explicit source-event summary that differs from the current deterministic
  result receives `revalidationFailure` with the source hash, stored summary and
  revalidated summary. Projection reports it in `excludedObservations`; the
  original row, source, ID and reason remain in official history. This is a
  read-time failure result, not deletion or a mutable administrative override.
  Missing/stale source, read errors, invalid links, identity conflicts and valid
  unresolved observations are NOT ignored. Form 25 projection policy is unchanged.
- Immutable attachment versions of the **exact same** raw/source-hash/scope/event/
  reported-facts combination are the same underlying event. A validated follow-up
  closes those repeated versions, listing each ID and its explicit target/follow-up
  in `closedObservations`. Different evidence or an independent issue stays open.

### Real persisted Scorpius result

Identity evidence (both SEC covers retain common stock and purchase-right rows):

- [May 2 8-K, 0001079973-24-000635](https://www.sec.gov/Archives/edgar/data/1476963/000107997324000635/scpx_8k.htm),
  accepted 2024-05-02T12:00:11Z.
- [May 16 8-K, 0001079973-24-000767](https://www.sec.gov/Archives/edgar/data/1476963/000107997324000767/scpx_8k.htm),
  accepted 2024-05-16T20:48:38Z.
- Receipts come from the retained SEC submissions response, not guessed dates.
  Exact security: CIK 0001476963 / Common Stock, $0.0002 par value per share /
  SCPX / NYSE American LLC. Canonical ID:
  `9a45f886-e49d-5972-a63f-6ca17ce0bd02`. No earlier ticker transition is bridged.

The original June 17 / July 30 SEC filings and excerpts remain unchanged.
Attached removal observation `9cdafdb8-462d-4964-bb7d-09894092e685` is linked by
withdrawal `aa797de3-c916-40d1-9a64-2e947cec330e`. Official as-of results:

| Knowledge date | Listing | Trading | Meaning |
|---|---|---|---|
| 2024-07-29 | removal_pending | unresolved | The July 29 notice is not yet in the July 30 filing record. |
| 2024-07-30 | removal_decision_withdrawn | unresolved | Only the Section 1003(f)(v) removal decision is closed; notice date July 29. |

No ACTIVE, relisting, effective removal date, or confirmed trading resumption is
created. The valid suspension notice remains independent; its effective date is
not explicit, so trading projection remains unresolved. Invalid old observation
`91bd7e0e-4cd3-45c5-b62d-55dfcf9ca89a` remains queryable with its incorrect stored
June 14 suspension date and the revalidation comparison showing null.
All pre-existing business/source/history rows were compared unchanged. An initial
validation attempt retained an additional unresolved attachment version; it was
not deleted. Final reruns replay the same cover, identity and observation IDs.
SQL rejects wrong class, exchange, row key and ticker; ticker-change persistence
and policy remain unchanged.

Evidence and reproducible isolated runner (outside Git, no credentials):
`C:/Users/PC/.codex/visualizations/2026/10/01/listing-exact-cover-transition/`.
Final run: `2026-09-30T21-17-48-036Z/` (`official-history.json`,
`projections.json`, `sql-negative-checks.json`, `result.json`, API ledger).
Earlier failed attempts, full SEC sources and receipt metadata are retained.
Focused regressions: 81/81 PASS; full `tsc --noEmit --incremental false` PASS.
Includes source-backed ticker-change contract regressions, ambiguity, wrong
class/venue, appeal-only, compliance-only, scheduled resumption, independent risks,
source failure and immutable invalid-summary audit checks. No provider calls.

### Migration and handoff

`20260930210543_sec_listing_exact_cover_attachment.sql` replaces the stable-row
guard and extends the existing observation writer with an exact cover-binding
guard. No table, column, status, permission scope or automatic ingestion hook was
added. Invoker functions retain service-role-only execution. Applied only on
127.0.0.1:57322, system identifier 7689949482832261158. The new uncommitted migration
was refined once during isolated validation; its own stored SQL was updated to
the final file. Older migration files/history were untouched. This is not a clean
DB rebuild test or a main/shared-local migration application.

Candidate base: detached `068d34f5d0fdc9aa4bc498d3d98d61fec13f7ed9` in
`C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.
Changes: cover-row selection/binding, official history/projection audit metadata,
focused tests, the one migration, this diagnostic note. No UI/browser change is
needed or claimed. Existing Monitor, Primary, Form 25 source/state, other filing
families, runtime configuration, credentials and services remain unchanged.
Local main ref: `0b75ffcf573b64fcf030fde432d594bfa9f487ae`; cached origin/main:
`9c13aee7ef41b38bac0637e53e579633745effda`. Live GitHub main and deployed Vercel
commit/status were not queried; equality is not claimed. No merge/push/deploy.
The Scorpius canonical transition blockers are resolved. Broad automatic 8-K/6-K
persistence, unsupported ordinary-share/warrant identities, and legacy event
linking remain outside this task.

## Automatic 8-K/6-K Listing Risk history consumer (2026-10-01)

Base: detached `89abe46a86477cac5350999b2f4769727717872e`, same candidate.
`processGenericMonitorChild` now invokes `persistListingRiskStatusAutomatically`
after applicable Listing Risk typed persistence and terminal recording, before
the unchanged alert consumer. Only `sec_8k_6k` / `listing_risk` is connected.
The official current-facts reader must return the exact raw, parent and child
execution. A stale/unavailable result does not authorize a history write.
Completed-child replay retries only this idempotent sidecar, with no analyzer
call or change to the existing Monitor outcome. Sidecar failure is reported in
`postPersistence`; it does not fail or change a successful Monitor evaluation.

The adapter reuses the existing source-event contracts and their validators:
source-stated, exact subject/venue/issue/date excerpts must belong to the retained
SEC document. Complete containing paragraphs are retained as evidence, including
qualifications. No date is inferred from filing time; filing time is only the
as-of knowledge boundary. A validated unique earlier event is required for
withdrawal/resumption. Equal immutable versions of that event are treated as one
link candidate; distinct candidates are ambiguous. An already validated opening
event excerpt containing all current fact spans is reused to avoid duplicating
the same event because of an adjacent sentence. Source-only observations retain
source identity across Monitor executions; hook results carry execution lineage.

Supported existing outcomes include removal decisions, suspension evidence,
explicit withdrawal and explicit resumption when the existing contract can
supply the exact operative date and prior-event reference. Other applicable
facts use the existing typed-facts observation writer and remain unresolved
where its source/identity checks cannot establish a supported state. No ACTIVE,
relisting, appeal/compliance-based restoration, or expected resumption is added.
No state/schema, migration, prompt, Primary, Form 25, identity, Monitor policy or
UI change is part of this step.

### Isolated integration evidence and precise limits

Evidence: `C:/Users/PC/.codex/visualizations/2026/10/01/listing-risk-auto-history/`.
DB: API 127.0.0.1:57321, PostgreSQL 127.0.0.1:57322, system ID
7689949482832261158. No migration applied. No external/provider request made.

The database had no retained 8-K/6-K Primary/analyzer runs. Its earlier manual
Scorpius raw records preserve complete original HTML, but lack the normal
analyzer's body/source-block material: `buildAnalyzerInput` yields metadata-only
blocks (`preflight.json`). Therefore this is **fixture-driven child-runtime and
real persistence verification**, not fresh Primary/LLM/full ingestion E2E.
`fixtures/listingRiskReplay.ts` explicitly labels source-grounded analyzer-shaped
fixtures; they are not represented as original provider outputs. Test Primary
records are likewise marked fixture/no-provider. Original raw records were not
supplemented or changed. The existing enqueue/reservation, exact-parent loading,
child runtime, typed writer/official reader, automatic hook, canonical writer and
as-of reader ran normally; the scheduler and analyzer were injected fixtures.
Alert delivery was stubbed; no alert claim is made in this step.

`v2-results.json`, `v2-history-before.json`, `v2-history-after.json`,
`v2-projections.json` and the per-accession stage files show:

- June 17 Scorpius accession `0001079973-24-000891`: typed facts saved, automatic
  history hook replayed attached pending observation
  `9cdafdb8-462d-4964-bb7d-09894092e685`.
- July 30 accession `0001079973-24-001121`: hook inserted attached withdrawal
  `315902e6-e426-457f-be02-b496d9a87d87`, linked to the validated earlier event
  version `8d7077c7-f69a-46d2-8f3e-5e225302e349`.
- Exact canonical security remains `9a45f886-e49d-5972-a63f-6ca17ce0bd02`.
  July 29 projection: removal_pending / trading unresolved. July 30:
  removal_decision_withdrawn / trading unresolved. Only the linked removal closes.
- Both child replays were duplicate with zero further analyzer invocations;
  history returned the same IDs as replayed, typed RPC replay was idempotent,
  one typed result/facts row per child remained. Original raw hashes and all
  earlier observations stayed unchanged, including the invalid historical row.
- Initial test setup used an incorrect Primary output type and then collided on
  its fixture dedupe key. The failed fixture record/evidence was retained; v2
  corrected only test setup. No product validator or policy was relaxed.

`aplm-existing-readback.json` rechecks the existing real 6-K suspension/resumption
history. Its Class A Ordinary Shares / Nasdaq attachment remains unresolved
(`no_exact_canonical_security_exchange`), and projection remains unresolved.
There is also no dedicated resumption-date slot in the current Listing Risk
contract: the adapter does not manufacture one from as_of or a notice date that
does not match the explicit resumption clause. A new positive automatic 6-K
resumption run is not claimed. No identity expansion or new collection was done.

Remaining verification: a normal, fully collected 8-K/6-K with an actual saved
analyzer response through the live workflow scheduler. The current hook's real
DB write/readback and replay are verified; provider/source-input completeness
and live scheduler execution were not established by these old manual records.
No browser/UI change was made or browser verification claimed.

Final checks: 133/133 focused regressions PASS; full
`tsc --noEmit --incremental false` PASS; `git diff --check` PASS.
New checks cover the actual child-runtime hook order, stale/non-applicable/news
exclusion, duplicate-sidecar replay, sidecar failure isolation, exact source
spans, unique prior-event selection and scheduled/appeal/compliance safeguards.
Logs are `regression.txt` and `typecheck.txt` in the evidence directory.

Handoff: candidate only; local main ref `0b75ffcf573b64fcf030fde432d594bfa9f487ae`,
cached origin/main `9c13aee7ef41b38bac0637e53e579633745effda`. Live GitHub main and
Vercel deployed commit/status unverified, equality not claimed. Main, shared-local,
other projects/services, prior evidence, and frozen work remain unchanged.
No merge, push or deployment.
