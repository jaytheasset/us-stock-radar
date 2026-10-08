# SEC stored-raw cover replay — stage 2-A

Date: 2026-10-09 KST. Base: `59a8d0ed92644bb9522c9559fc6a0b23f737371c`.
Worktree: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`, detached.

## Scope

Official exact-raw plan/apply runner, with mocked repository apply regression and
an actual read-only local plan. **Shared DB cover apply was not executed.**
No migration addition/edit/application; no candidate or SEC human E2E claim.

Reuses `buildSecCoverObservationPayload`,
`persistSecCoverObservationsForRawItem`, and `readSecCoverObservations` (including
its stored-payload validator/parser replay). It does not call ingest orchestration,
after-save wrappers, persistence-state metadata recording, or the automatic ticker
trigger. No new parser, SQL insert, RPC, HTTP endpoint, or scheduled workflow.

Local endpoint/status/SQL system-identifier checking was mechanically extracted
from the offline-import CLI into `lib/sec-offline-import/localRuntime.ts` and is
shared by both CLIs. It keeps loopback-only matching, explicit configured-URL
drift rejection, read-only SQL identity checks, and status service credentials
scoped in memory with `withSecOfflineLocalCredentials`. No environment files.

## Input and CLI

Input is a JSON array of 1–100 exact targets. Duplicate raw IDs are rejected.
Each entry requires `rawItemId`, `accessionNumber`, ten-digit `issuerCik`, and
lowercase `sourceSha256`. No issuer-wide discovery or latest-record substitution.

```powershell
npm run sec:cover-replay -- `
  --input <exact-targets.json> --mode plan `
  --expected-api-url http://127.0.0.1:56321 `
  --expected-db-url postgresql://127.0.0.1:56322/postgres `
  --expected-system-identifier 7678429483712069671 `
  --receipt <new-plan-receipt.json>
```

The implemented apply mode uses the same arguments plus `--mode apply` and
`--confirm-plan-digest <reviewed-digest>`. It was exercised only with synthetic
repositories during this stage. Receipt paths use create-new writes. Receipts
omit HTML/raw source bodies, credentials, database passwords and tokens.

## Plan and confirmation

Plan has SELECT-only access to exact raw, source, result and observation rows.
RPC is explicitly forbidden in that repository wrapper. Failed/malformed reads
remain unavailable and cannot become not-found or insert. Identity/SHA mismatch
is conflict. Exact bytes are hashed, the raw's optional declared SHA is checked,
and the complete source/provenance must pass the production builder boundary.
Canonical extraction status is reported as-is, including unsupported/partial
outcomes; it is not repaired into a successful extraction.

Result-ID-only inspection first detects collisions hidden by accession filtering.
Replay then requires a matching result, matching immutable source columns and the
existing exact reader's validated source/result/all observations. Missing source,
missing observations, payload drift or orphan observations are not replay.

The stable SHA-256 confirmation binds:

- runner version and target DB system identifier;
- sorted exact target IDs/identity/expected source SHA;
- **entire stored raw row fingerprint**, including metadata;
- deterministic source/result IDs;
- immutable source payload hash (capture/ingest timestamps excluded, matching
  the production source replay contract), result row/payload hashes;
- observation hashes/counts, extraction status and context/field summaries.

Verified `insert` and verified `replay` have the same digest readiness value.
This is deliberate: an exact earlier item committed before a later failure can
resume with the original confirmation. No changed raw/payload or invalid cover
state shares that confirmation. Classification/counts still remain explicit in
the receipt; the digest represents the reviewed append intent, not an insert count.

## Apply and partial completion

Before any RPC, apply replans **every** target and checks both digest and ready
status. Each persistence reread is additionally checked against the whole-row raw
fingerprint. The RPC allowlist accepts only `persist_sec_cover_observation_result`
with exactly the prepared source/result/observations. Existing persistence checks
the RPC response; the exact reader then verifies the stored output again.

Atomicity remains **one raw result/source/observations per existing RPC**.
There is no batch transaction across raw items. On first failure the runner stops
and reports verified successes, `failed_unconfirmed` with `rpcAttempted` and safe
error code, and remaining `not_attempted` items. A failed response/read-back may
follow a committed transaction; no rollback is claimed. Nothing is deleted to
undo it. Replan and retry use exact reader validation to resolve that state.
Normal timestamp/type differences from PostgreSQL are compared by existing
validator semantics; original raw metadata is never updated.

The runner does not lock the entire batch against unrelated writers. It uses the
existing persistence reread and item-level RPC concurrency contract; no stronger
batch isolation or general immutable-table enforcement is claimed.

## Verification

- `npm run verify:sec-cover-replay`: 14/14 PASS, synthetic repositories only.
  Covers deterministic plan, missing/read-failed distinction, input/SHA/bytes
  mismatch, changed raw/digest with zero RPC, exact replay, corrupted/incomplete
  cover, response/read-back failure, partial resume, last raw reread, no metadata
  writer/trigger orchestration and zero external fetch.
- `npm run verify:sec-offline-import`: 25/25 PASS.
- Existing parser fetch 7/7, parser/catalog 11/11, cover canonical 11/11,
  ticker-resolution 51/51: 80/80 PASS.
  Node test run uses `--experimental-strip-types`, absolute file-URL loader
  `scripts/resolve-ts-paths.mjs`, and import `scripts/resolve-server-only.mjs`.
- `npm run typecheck`, `git diff --check`: PASS.

## Actual read-only PSKY plan

Verified API `127.0.0.1:56321`, SQL `127.0.0.1:56322/postgres`, system identifier
`7678429483712069671`. Exact raw IDs remain
`0fbd0403-00e7-4f51-b8ed-583598049b05` and
`e1b21551-6925-418e-a88c-0ffe574c6b44`. Both stored source SHAs match the approved
retained originals. Target cover results, SEC candidates and human records were zero.

Plan: **insert 2 / replay 0 / conflict 0 / unavailable 0**.
Digest: `f12cfd3f91af18f3af666ecd1d48eec2ae991abf12d2afa54b69ef04a26d27c1`.

| Accession suffix | Context | Symbol | Exchange (parsed text) | Observations |
| --- | --- | --- | --- | ---: |
| 113076 | AsOf2026-10-02 | PSKY | The Nasdaq Stock Market LLC | 1 |
| 113913 | AsOf2026-10-05 | SKYD | New York Stock Exchange | 1 |

Both titles parse to `Class B Common Stock, $0.001 par value`. All three fields
are `observed` in each context. Before-filing raw title/exchange retain their
literal newline/indentation; the runner does not overwrite them with parsed text.
Context dates are source context identifiers, **not inferred ticker effective dates**.

- Result IDs: `1912aec0-60b6-4f1a-a8a5-e935fbf99940`,
  `8982edf3-90b0-4167-ba87-e1a5ed609c1a` (planned, not stored).
- Source IDs: `5903c474-80d0-53aa-8fbe-938eb0ad42e2`,
  `7398bc35-85a2-54c5-8a18-42bc2a3f25d6` (planned).
- All **221 non-system user tables**: count/full-content fingerprints unchanged.
  Includes raw rows/metadata, run/source/ledger, issuer/security/candidate tables,
  Kiwoom/human/audit, events/current, Watchlist/Alert and prior protected data.
- 8 allowed local GETs; RPC/apply/external-network calls **0**.
- Credentials were not manually injected; status-derived values stayed in memory.

External evidence:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/cover-replay-stage2a-20261009/`
contains `targets.json`, official `plan.json`, `before.json`, `after.json`,
`comparison.json` and method/path-only `http.json`. A validation-only HTTP guard
allowed local SELECT requests and blocked all RPC/external requests; responses
were actual PostgREST results, not fixtures.

No shared cover apply, automatic candidate, SEC human E2E, full completion or
merge-readiness PASS. Prior migration CLI completion anomaly was not reproduced
or fixed. Local main/GitHub/Vercel unqueried; no main/3110, Docker lifecycle,
environment file, migration, collection, cron, backfill, LLM/OCR or deployment.
