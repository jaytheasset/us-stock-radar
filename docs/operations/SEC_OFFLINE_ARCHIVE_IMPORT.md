# SEC verified offline archive import — stage 1

Date: 2026-10-08 KST
Base: `fd2aee264e95ecd8b80fa5108a6fffb2f7a84fa8`
Worktree: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar` (detached)

## Scope and verdict

This stage adds a production-contract path for turning retained SEC originals into
canonical `raw_items` without refetching SEC. It deliberately stops before cover
observations, ticker-resolution candidates, SEC human judgments, Kiwoom
comparisons, audit entries, or ticker writes.

The implementation and isolated PostgreSQL contract pass. The migration was **not
applied** to the shared local Supabase database and the PSKY files were **not
imported** into it. The live SEC-human storage E2E therefore remains blocked by
`sec_ticker_resolution_decisions = 0`.

## Architecture

```text
verified archive manifest + retained Submissions + exact filing bytes
  → file/path/UTF-8/SHA/provenance validation
  → deterministic canonical raw bundle
  → read-only current-state plan
  → exact bundle-SHA confirmation
  → one atomic service-role RPC
  → existing sources/source_runs/raw_items only
```

Network collection and offline acquisition converge on the same existing
`raw_items` contract. The automatic candidate is not seeded and no alternate
candidate table or alternate reader is introduced.

## Files

- `lib/sources/sec/documentText.ts`
  - Extracts the existing SEC visible-text projection from the live parser so
    network and offline paths share one text-cleaning implementation.
- `lib/sources/sec/parser.ts`
  - Reuses that shared projection; no intended live-fetch behavior change.
- `lib/sec-offline-import/canonical.ts`
  - Validates the archive and constructs deterministic canonical raw inputs.
- `lib/sec-offline-import/persistence.ts`
  - Plans insert/replay/conflict and calls the atomic import RPC only after an
    exact bundle confirmation.
- `supabase/migrations/20261008134000_sec_offline_archive_raw_import.sql`
  - Adds `import_sec_offline_archive_raw` for service role only.
- `scripts/import-sec-offline-archive.ts`
  - Operator CLI with `validate`, `plan`, and `apply` modes.
- `scripts/verify-sec-offline-import-postgres.mjs`
  - Owned temporary PostgreSQL verification; never touches Docker/shared DB.
- `lib/sec-offline-import/*.test.ts`
  - Direct file/canonical/plan/apply regression tests.

## Canonical input contract

For every retained filing the builder requires:

- manifest version 1;
- a relative file path that resolves inside the selected archive directory;
- exact SEC accession format;
- an exact retained `data.sec.gov/submissions/CIK##########.json` source;
- accession/form/filing date/acceptance timestamp/primary document present in
  retained Submissions metadata;
- strict byte-preserving UTF-8;
- raw-byte SHA-256 equal to the manifest;
- bounded primary-document size.

The canonical raw preserves:

- CIK, accession, form, filing date, acceptance timestamp;
- canonical SEC index and primary-document URLs;
- exact primary-document text;
- SHA-256 and UTF-8 byte count;
- archive file/role/capture timestamp;
- manifest, bundle, and Submissions lineage;
- acquisition method `offline_archive`.

It intentionally leaves ticker and exchange unresolved. An archive import must
not infer a current ticker merely because the expected PSKY→SKYD result is known.

## Engineering invariants

### Single source of truth

The import writes the existing `raw_items` contract. No PSKY fixture table,
decision seed table, or parallel source model is created.

### Provenance

The exact source body, source SHA, byte count, accession, SEC URLs, retained
Submissions SHA, manifest SHA, bundle SHA, archive filename, role, and capture
time remain linked in the raw payload/metadata.

### Idempotency

- deterministic raw ID: accession + exact source SHA;
- deterministic source-run ID: manifest SHA;
- same accession and same verified source identity/body: replay/no-op;
- same request after successful import: no duplicate raw or source run;
- an exact existing network-acquired raw can replay even though it has no
  offline-import metadata.

### Conflict preservation

The same accession with different source bytes, identity, dates, form, URL, or
primary document is a conflict. Existing raw rows are not overwritten to make
the import pass.

### Atomicity

The RPC validates and classifies the complete batch before inserts. Source,
source run, and all new raw rows commit in one transaction. A later invalid item
or source conflict leaves no partial run/raw residue.

### Least authority

- RPC execute: service role only;
- anonymous/authenticated execute denied;
- no admin actor impersonation or authentication bypass;
- no UPDATE/DELETE path;
- no cover/candidate/human/comparison/audit/ticker side effect.

### Target identity

`plan` and `apply` require explicit loopback API URL, DB URL, and PostgreSQL
`system_identifier`. They also compare both endpoints with the currently running
local Supabase status and compare the configured Supabase API URL. The expected
DB URL contains no credential; the connection uses the status-provided local DB
URL only after host/port/database match. This prevents a valid API and a valid
SQL URL from silently referring to different local stacks.

### Plan/apply separation

`validate` reads files only. `plan` reads current raw state only. `apply` requires
`--confirm-bundle-sha256` equal to the exact reviewed bundle and replans before
calling the RPC.

## CLI

File-only validation:

```powershell
npm run sec:offline-import -- `
  --directory <verified-archive-directory> `
  --mode validate `
  --receipt <new-receipt.json>
```

Read-only DB plan after a migration/application target is explicitly selected:

```powershell
npm run sec:offline-import -- `
  --directory <verified-archive-directory> `
  --mode plan `
  --expected-api-url http://127.0.0.1:<api-port> `
  --expected-db-url postgresql://127.0.0.1:<db-port>/postgres `
  --expected-system-identifier <exact-identifier> `
  --receipt <new-plan-receipt.json>
```

Apply requires the same target checks plus the reviewed bundle digest:

```powershell
npm run sec:offline-import -- `
  --directory <verified-archive-directory> `
  --mode apply `
  --expected-api-url http://127.0.0.1:<api-port> `
  --expected-db-url postgresql://127.0.0.1:<db-port>/postgres `
  --expected-system-identifier <exact-identifier> `
  --confirm-bundle-sha256 <exact-plan-bundle-sha256> `
  --receipt <new-apply-receipt.json>
```

Receipts omit source bodies, database credentials, API keys, cookies, and tokens.
Receipt files use create-new semantics and are not silently overwritten.

## Real retained PSKY validation

Archive:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/real-sec-link`

Validated inputs:

| Role | Accession | SHA-256 | UTF-8 bytes |
| --- | --- | --- | ---: |
| before | `0001104659-26-113076` | `52931a86349c70126cebeeeba86a9ddd4e290e80a2c060c349c16b0e60e4c9e4` | 32,508 |
| after | `0001104659-26-113913` | `84e5fde7dce0a8fc0c1a5cad36c81b52455f53d4070ed2ce48f165f196e1b3b2` | 121,430 |

Retained Submissions SHA:
`f89875138e6d54305d2922d1e11f25b8aea0f6bde2be81f8efdf2ca72f39f23f`

Final file-only receipt:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/offline-import/validate-commit-ready.json`

- manifest SHA: `4ee48d409a60d194d0e356454f5fb09b4c7f319a2a9fc737026bd9a49558deba`
- bundle SHA: `d5b1dd584b3492cae85208697e866c2eaccfe1c5677de20ed69ea43ec0d5d4f5`
- deterministic run ID: `5f3063a5-db7e-4267-84a3-72b2e2f47bf9`
- network requests: 0
- downstream triggered: false

This is validation/preparation only; those deterministic IDs are not yet records
in the shared local database.

## Verification

Direct tests:

```text
verify:sec-offline-import: 20/20 PASS
SEC parser fetch regression: 7/7 PASS
SEC parser/catalog regression: 11/11 PASS
SEC cover-observation regression: 11/11 PASS
SEC ticker-resolution regression: 51/51 PASS
```

Owned temporary PostgreSQL receipt:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/offline-import/postgres-commit-ready/postgres-result.json`

The isolated database verified:

1. migration applies against the existing source/source-run/raw table contract;
2. real retained PSKY files pass exact identity/SHA validation;
3. first execution inserts one source run and two raw rows atomically;
4. exact bodies, deterministic IDs, URLs, SHA lineage, and unresolved ticker
   meaning round-trip;
5. identical replay creates no duplicate raw or source run;
6. exact pre-existing network raw replays without importer provenance, including
   equivalent timestamp formatting;
7. different valid bytes for the same accession abort the full batch;
8. a later invalid batch member rolls the full transaction back;
9. anon/authenticated cannot call the RPC or read raw rows;
10. no network, candidate, human judgment, comparison, audit, or ticker-authority
    path was invoked.

Result: 11 checks PASS, cleanup PASS, network calls 0.

## Not performed / still blocked

- migration not applied to the approved shared local stack;
- shared-loopback `plan` not executed because this stage did not pass local
  service credentials through the remote executor; target-pair behavior is
  covered by the pure 20-test regression suite;
- no `raw_items` added to that stack;
- no `sec_structured_raw_sources` or cover/security observations generated;
- no automatic ticker-resolution trigger called;
- no `sec_ticker_resolution_decisions` added;
- no SEC human judgment/comparison/audit write;
- no ticker/current/Watchlist/Alert change;
- no SEC network fetch, cron, backfill, LLM, OCR, remote DB, merge, push, or deploy.

The next separate stage is a stored-raw replay path:

```text
exact raw_item ID
  → existing cover/source observation production functions
  → plan/apply and replay contract
  → no automatic candidate until cover outputs are independently reviewed
```
