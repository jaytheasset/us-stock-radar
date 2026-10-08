# SEC ticker-resolution automatic runner — stage 3-A

Base: `6bde1c948365a182e78c1f21d144a670438a911c`, eeb4 detached candidate.
This stage implements the runner and verifies a real **query-only** plan. No
shared issuer lease or candidate persistence was executed.

## Shared production selection

`automaticPlanner.ts` contains the existing issuer discovery, symbol runs,
boundary request enumeration, preview ranking, and existing decision/human scope
anchoring moved from `automaticTrigger.ts`. It is a query-only async iterator.
It yields preview checkpoints and selected candidates so the production trigger
keeps its original lease renewal locations and boundary-by-boundary persistence
ordering. The generator has a repository that rejects every RPC. No evaluator,
claim extractor, identity rule, evidence rule or company-specific override changed.

`automaticRunner.ts` consumes the same iterator, exact cover reader/validator,
`previewSecTickerChange`, exact decision reader and effective human reader. It
also validates all existing decisions in the bounded issuer/method scope,
including their relevant human history. Every successful repository read binds
the table/query and full returned rows into a SHA-256 fingerprint. Repeated reads
of the same query with different content fail closed. Only hashes/counts of raw
source rows and human history enter the receipt, never source HTML, source text
spans, actor data, review text or credentials.

Receipt: versions, target system identifier, exact trigger, issuer cover and
decision/human fingerprints, symbol runs/boundaries, every preview and selected
request, before/after/evidence references, production evaluation fields and
payload IDs/hashes, mutation rows/counts, classification and deterministic digest.
`insert`/`replay` describe persistence intent, independently of AUTO/REVIEW/UNRESOLVED.
A REVIEW evaluation can have a ready insert plan; this does not approve its claim.

The v1 official runner executes **one selected decision intent**. It still scans
the full issuer scope; more than one selection is `review-required`, not a partial
batch. The ingest trigger retains its existing multi-boundary behavior. This
avoids treating a plan made before any writes as an equivalent execution of a
sequential multi-boundary ingest that can anchor later selections to earlier writes.

## CLI and apply contract

```powershell
npm run sec:ticker-automatic -- `
  --input <exact-trigger.json> --mode plan `
  --expected-api-url http://127.0.0.1:56321 `
  --expected-db-url postgresql://127.0.0.1:56322/postgres `
  --expected-system-identifier 7678429483712069671 `
  --receipt <new-receipt.json>
```

Input requires exactly issuerCik, accessionNumber, sourceSha256 and resultId.
The existing offline local-target verifier rejects remote/configured-target drift,
checks the PostgreSQL system identifier and scopes status-derived credentials in
memory with restoration. Receipt writes are create-new. No environment file.

Apply (synthetic-tested only) additionally requires `--mode apply` and
`--confirm-plan-digest`. Its steps are:

1. Query-only preflight; wrong digest/not-ready performs zero lock/persist RPCs.
2. Refuse an already present issuer lock row, even expired; acquire the existing
   issuer lease and report acquisition failure/busy separately.
3. Under the lease, recompute the whole shared plan and compare its digest.
4. Call `resolveAndPersistSecTickerChange`. Its own evaluation must match the
   exact planned identity/evidence/decision payload. Immediately before its RPC,
   replan the whole issuer scope again, compare the digest, and renew the lease.
5. Allow only `persist_sec_ticker_resolution`; validate its production response
   and reread through `readSecTickerResolutionByDecisionId` for exact evaluation.
6. Release the lease in finally. Failed release yields `incomplete`, even if the
   decision has already been verified. Never delete an append-only row to retry.

Only acquire/renew/release and persist_sec_ticker_resolution RPCs are permitted.
No claim RPC, raw/cover metadata writer, ingest collector or downstream ticker
application is connected. No batch transaction is claimed. These checks use the
existing cooperative issuer lease, not a serializable snapshot across all REST
queries or a new lock respected by unrelated writers. A failed or lost RPC response
may follow a commit; `persistenceAttempted` and verification/release status remain
separate. The next full plan resolves insert/replay/conflict and requires its new
digest. A successful insert intentionally changes the digest for the next replay
because existing decision/human scope and mutation expectations have changed.

## Actual retained PSKY plan (2026-10-09)

Approved API 127.0.0.1:56321, SQL 127.0.0.1:56322/postgres,
system identifier `7678429483712069671`. Exact after trigger:
accession `0001104659-26-113913`, result
`8982edf3-90b0-4167-ba87-e1a5ed609c1a`, SHA
`84e5fde7dce0a8fc0c1a5cad36c81b52455f53d4070ed2ce48f165f196e1b3b2`.
The planner selected that after filing as evidence and before accession
`0001104659-26-113076` / result `1912aec0-60b6-4f1a-a8a5-e935fbf99940` /
SHA `52931a86349c70126cebeeeba86a9ddd4e290e80a2c060c349c16b0e60e4c9e4`.

- Two symbol runs, one boundary, two previews, one selected intent; `insert`.
- PSKY → SKYD; effective date/precision null; common_stock, class B; REVIEW.
- Reasons: EXCHANGE_CONFLICT, SUPPORTED_CHANGE_EVIDENCE_MISSING.
- Decision: `6e81ab18-ea93-5b2b-a040-d0e28a8370d2`.
- Decision payload SHA: `f71ae1e415bab28f9d9482ab1e702f03b83fc05230ae6b04404bfcaea8b1017e`.
- Identity: `af2b0222-789a-5986-8b93-80b05cec6e3a`.
- Identity payload SHA: `368b5a710b7e381da7ebd892da6a844e6fa947d01edd35fd868e820271d8ae96`.
- Change evidence ID/payload SHA: null. This is the unmodified engine output.
- Expected inserts: sec_issuers +1, sec_ticker_security_identities +1,
  sec_ticker_change_evidence +0, sec_ticker_resolution_decisions +1. Audit +0;
  own lock row transient, expected final delta 0. **None executed.**
- Plan digest: `c0e7f971d4ec2cc353fdc191cb1c6369583e82035708bedde64703adf61727cf`.
- Actual HTTP: 40 allowed GETs, RPC/lock/apply/external fetch 0. Before/after
  repeatable-read read-only count/full-row fingerprints: **222/222 unchanged**.
  Profile/preferences had no drift in this measurement. Candidates and Kiwoom
  SEC human judgments/comparisons remain zero; raw metadata unchanged.

Known shared schema difference: ledger **136**, local files **135**, pending **0**,
unknownApplied `20261008171255 / sec_os_snapshot_v1`; sec_os_snapshot_decisions
already present. No copying/integration/application/deletion of that migration.
The verifier checks the exact allowed ledger difference and prior full table
inventory before plan, and column/constraint schema fingerprints plus ledger
before/after. No additional table/ledger difference or in-window schema change
was observed; it is not a historical full DDL audit of unrelated work.

External create-new evidence:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/automatic-stage3a-20261009/`
contains trigger.json, plan.json, before/after.json, target-baseline.json,
comparison.json, HTTP method/path log and the read-only verifier/guard.

## Verification

- `npm run verify:sec-ticker-automatic`: 29/29 synthetic tests. Determinism and
  RPC-zero planning; exact source mismatch; failed/missing reads; bounds, revisions,
  missing pair and no boundary; competing claims/human scope; exact replay;
  cover/time/SHA/decision/human/issuer/system drift; pre-lock and locked digest
  mismatch; final human scope drift; busy/lost lease; RPC/table allowlists;
  persistence/response/read-back failures and recovery; release failure; metadata
  preservation, no external fetch, no raw spans or human actor/reason in receipts.
- Existing automaticTrigger 12/12, ticker canonical 7/7, ticker persistence 6/6,
  cover observation canonical 11/11: 36/36 unchanged tests pass.
- `npm run verify:sec-cover-replay`: 14/14; `npm run verify:sec-offline-import`: 25/25.
- Node suites use experimental strip-types and existing absolute file-URL
  resolve-server-only import / resolve-ts-paths loader. No live DB in unit tests.
- `npm run typecheck` and `git diff --check`: PASS.

No shared candidate apply, actual SEC human E2E, whole-feature completion or merge
readiness PASS. No migration/SEC network/cron/backfill/UI/LLM/env/main/3110/Docker
lifecycle/push/deploy. Local main, GitHub and Vercel were not queried. Independent
GPT review is the next gate; this task does not authorize the next execution stage.
