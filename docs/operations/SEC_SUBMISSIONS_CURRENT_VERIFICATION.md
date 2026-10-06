# Explicit Submissions current confirmation

Candidate base: `9a85549cb0c7e9a56c14436bc2517194af025b74`, detached eeb4.
Scope: source preservation + explicit main refresh + independent SQL reader.
No site/API/cron/queue integration or existing reader replacement.

## Contract and implementation

- `sec_submissions_current` contains only issuer CIK, source raw ID, the FK's
  `submissions` kind, bigint refresh sequence and `confirmed_at`. Composite FK
  prevents cross-CIK/kind references. Main URL/identity is validated in code.
- `sec_submissions_refresh_sequence`: bigint, CACHE 1, NO CYCLE. A completed
  autocommit `nextval(...)::text` precedes HTTP. Sequence values remain strings
  or `BigInt`, never JavaScript Number. Gaps are allowed.
- `SecSubmissionsRefreshService.refreshIssuerSubmissions({cik})` owns the HTTP
  client and requests only the main incremental document. Transport/clock
  injection exists for isolated tests; there is no saved-document refresh API.
  The shared `normalizeMainSubmissions` is the existing standalone validation
  extracted without changing accepted data. The confirmation clock is sampled
  after receipt and validation, before persistence.
- Use a **dedicated, idle managed SQL connection per concurrent refresh**.
  Caller-owned transactions are unsupported; external repository mode rejects
  allocation/publication. Do not share a connection with another in-flight
  transaction, or wrap refresh in BEGIN. This is an internal server API contract,
  not a general transaction/session manager.
- Managed storage uses the existing raw INSERT + separate identity guard,
  issuer/name/listing/ledger writes, conditional current UPSERT, then COMMIT.
  The verified main must match the submitted batch (ID/hash, issuer/name/listing/ledger, no facts or rejections) before BEGIN. Publication failure rolls everything back. Old raw rows, IDs/hashes and first
  `fetched_at` are immutable; insert/dedupe counts retain their original meaning.
- `publication` is separately `published`, `unchanged`, or `superseded`.
  Higher successful order wins. For the retained current order, identical
  source/time is no-op and contradictory source/time throws. An order lower
  than retained current is superseded; no discarded-order receipt history is
  stored. `confirmation` in a refresh result describes that request; it is not
  a claim that a superseded response became current.
- `readCurrentIssuerSubmissions(client,{cik})` executes one SQL statement for
  current + raw + name/listings. Shared normalization verifies main identity,
  raw body/payload, deterministic ID/hash and the complete observation set.
  Returns provenance, name, listing pairs, sequence, `confirmedAt`, and separate
  `firstFetchedAt`; does not expose raw text/payload in the returned object.
  No current => `not-confirmed`; DB/identity/observation failure => `unavailable`;
  valid empty listing => `available` with `[]`. No HTTP/write/latest-raw fallback.
- Ordinary `ingestBatch`, standalone archival ingest, replay, bootstrap/backfill
  and full Submissions + CompanyFacts do not publish current. Even a saved body
  marked `authoritative_http_body` is not a new live confirmation.
- No migration backfill, TTL, attempt-history, ticker trading eligibility, new
  facts/parser, source copies or product reader replacement. Current means only
  the last successful adopted **explicit refresh**, not every existing collector.

## Actual PostgreSQL + synthetic HTTP verification

Command: existing `scripts/verify-sec-submissions-postgres.mjs` with
`--run --current-only --system-id=7678429483712069671 --output=<external receipt>`.
`SEC_VERIFY_ADMIN_DB_URL` is process-only and validated as the existing local
development engine, `127.0.0.1:56322/postgres`. No environment file was changed.
The default live verification mode is preserved; this task ran only current-only.

Engine rechecked: PostgreSQL 17.6, system identifier `7678429483712069671`.
Foundation and `20261006140457_sec_submissions_current.sql` applied only inside
owned temporary databases. Shared `postgres` was used only for cluster metadata
and owned database creation/deletion, not application data/schema changes.

Final receipt outside Git:
`C:/Users/PC/.codex/visualizations/sec-submissions-current-accepted-20261006.json`.
21 named checks passed; 27 native localhost HTTP attempts, **zero real SEC,
CompanyFacts, XBRL or LLM requests**. Every HTTP attempt observed the dedicated
writer connection `idle` with `xact_start=null`. Existing three minimal preserved
fixtures (AAPL, NEOM, WIT) also passed HTTP → refresh → independent SQL reader.
Other names/tickers are synthetic test values. Test confirmation clocks are
controlled; DB concurrency/transactions/constraints and HTTP transport are real.

| Check | Observed result |
| --- | --- |
| Raw-only before migration | Remains `not-confirmed`; migration creates no current rows |
| First refresh | raw/name/listing/ledger/current commit; separate connection reads matching source and confirmation |
| Same A twice | inserted 0 / updated 0 / deduped 5; confirmation 15:00:00 → 15:00:01 UTC; first fetched_at remains 00:00:00 |
| A → B → A | Raw count **2**. Final A `9467453a-89a2-5ee9-8f24-2c18ac413d18`, B `ab495d08-aa41-554a-9079-92e687eb6113`; current sequence 5 / 2026-10-06T15:00:03Z |
| Different bodies, reversed completion | Independent PIDs 12257/12258. Sequence 7 at 15:00:05 publishes; sequence 6 finishes at 15:00:06 and is superseded. Its raw is archived; current source/time stay on sequence 7 |
| Network / HTTP / JSON / validation / raw guard | Failure preserves all tables/current, next normal refresh succeeds. Existing network retry policy remains unchanged |
| Actual current SQL failure | Trigger raises P0001 after raw/name/listing INSERT each returned 1; entire raw/observation/current snapshot unchanged after rollback. Removing trigger permits recovery |
| Re-save | Exact receipt no-op; same current order with different time or source explicitly errors; prior state unchanged |
| Archival replay/full | Saved authoritative body replay does not advance current; fixture full bootstrap still inserts 2 financial facts and does not create current |
| Empty listing | Returns `[]`, no previous ticker substitution |
| Concurrent reader during store | Paused before publication after raw/observation INSERTs: reader sees old complete state; after commit sees new complete source/name/listings/time |
| Invalid references/observations | Wrong CIK FK 23503; wrong kind check 23514. Bad raw identity/name/missing listing => unavailable; rollback restores state. Unit test also checks missing raw and bad hash/CIK/payload |
| Permissions | anon/authenticated read/insert/update/delete/sequence access denied; official reader unavailable. service_role raw UPDATE/DELETE and sequence setval denied (15 total denials) |
| Bigint/sequence | CACHE 1 / no cycle confirmed. Actual allocated `9007199254740993` survives publication/read without precision loss |
| Previous raw regression | 3 independent-connection races / 6 successes, 7 corruption guards, metadata replay and 2-version preservation pass |

Final owned database:
`sec_submissions_eeb4_adace605790040258aaa54aeea4dff40`, OID `165463`, owner
`postgres`, marker `eeb4 submissions verification adace605-7900-4025-8aaa-54aeea4dff40`.
Name/OID/owner/marker rechecked, sessions **0**, plain DROP succeeded, absence
verified, owned clients **0**, loopback server/sockets closed. No FORCE or backend
termination. Earlier runs OIDs 164953, 165123 and 165293 were also cleaned. First run
completed the new checks but an old helper reused synthetic issuer 800 already
seeded by a race: the harness race range was moved to 900; product logic and
existing assertions were not weakened. Additional final tests verified three
preserved fixtures, network failure and later wall-clock time for the old result.

## Regression commands and results

Use the repository's absolute `resolve-server-only.mjs` import and
`resolve-ts-paths.mjs` loader with `node --experimental-strip-types`:

- `--test <all lib/sec-structured-data *.test.ts/*.test.mjs>`: **231/231**
  (previous 223 + new 8). Receipt `sec-current-structured-tests.txt`.
- Existing 18-file catalog/search/identity command recorded below: **138/138**.
  Receipt `sec-current-catalog-tests.txt`.
- `scripts/verify-sec-catalog-body-timeout.mjs --output=<external receipt>`:
  **6/6** native streaming cases. Body abort 15018.5ms, header abort 15011.2ms,
  drip abort 15001.5ms; prior snapshots/timestamps intact, recovery succeeds,
  no forced cleanup, all resources closed. Receipt `sec-current-f1-timeout.json`.
- `npm run typecheck`: PASS. `git diff --check`: PASS.

Catalog regression test paths (unchanged assertions):
```
lib/sources/sec/tickerCatalog.test.mjs lib/sources/sec/tickerCatalogCache.test.ts
lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts
lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts
lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts
lib/sources/sec/forms/ownership/source-parser.test.ts lib/watchlist/stockHeaderSecIdentity.test.ts
lib/sec-ticker-resolution/publicTickerSearch.test.ts lib/tickerSearchContract.test.ts
lib/tickerSearchAvailability.test.mjs lib/tickerSearchFlowObservation.test.ts
components/shell/tickerSearchFlowRegression.test.ts components/alerts-v2/alertsV2Regression.test.ts
lib/telegram/telegramCommandPolicy.test.ts lib/live-room/posts.test.ts
```

## Review boundary

No shared/production migration or backfill; no actual site/browser, API, automatic
refresh or remote SEC verification in this task. Existing site reader remains on
its old contract. Existing full/O/S/prospectus pipelines remain archival. No
Docker/3110 manipulation, merge, push or deploy. Independent GPT review is next.
Historical local main `af265b5bf3bb8878d706e1f4d763c0ce85a1b024` was not freshly
checked; GitHub main, deployed Vercel commit, production migrations/cron are
unqueried. No production equality or deployment claim.
