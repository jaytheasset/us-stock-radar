# SEC O/S Snapshot v1 candidate

Base: `d7347e4d2e75a5c412f69218003d2dfd407c79c5`, detached candidate at `C:\Users\PC\.codex\worktrees\8e9d\US-Stock Radar`.

## Acceptance and scope

F-1/F-1A complete SEC primary source → neutral blocks → durable enqueue → one Codex extraction → structural validation → immutable SEC snapshot → administrator review. No manual JSON upload, Offering Structured, market shares-outstanding replacement, new canonical priority system, or changes to Primary/Offering/S-8 interpretation.

Admin routes: `/admin/data/os-snapshots` and `?id=<run-id>`, mutation `/api/admin/data/os-snapshots/<run-id>`. Read permission `data.read`; decisions `data.run`, same-origin checks, server-resolved actor, and DB active `operations`/`super_admin` checks. Anonymous access must redirect/deny. Required visual acceptance: desktop, intermediate, 390px mobile; incomplete visual checks remain a merge blocker.

## Reused foundations

- Existing `raw_items` SEC ingestion and saved original response. F-1/F-1A additionally retain `os_snapshot_primary_html` before the existing Primary text budget truncates it. Existing Primary fields and limits remain unchanged.
- Existing neutral HTML renderer (`renderS4F4SourceHtml` only, no S-4 selector). All primary lines become sequential 40-line blocks with accession/document-qualified IDs. No O/S field is parsed or calculated.
- Existing service-only `ai_runs` for durable queue/lease/checkpoint and `ai_outputs` for first terminal output. No second queue table. Existing S-8/Proxy code was inspected; its provider restart policy cannot safely be reused verbatim for a host-local Codex subprocess.
- Existing Supabase repository transport and admin RBAC/page/API patterns. Human decisions use a separate append-only table, as in other reviews.

The raw-save hook runs for new/replayed eligible filings, including source-only filings excluded from Primary due to missing ticker. Dry runs do not enqueue. Incomplete/missing/truncated source remains `source_not_ready`. The complete original, filing metadata, all neutral blocks and fingerprint are constructed before reservation. Metadata-only fetches do not start GPT.

## Contract and identity

`lib/sec-os-snapshot/contracts/os_snapshot_v1-prompt-r2` contains byte-identical frozen schema, instructions and original reference validator. Its manifest records all hashes and the source revision-manifest hash. `.gitattributes` disables line-ending conversion for contracts/fixtures. AJV 2020 validates with format checks and no coercion/default/repair options. Filing identity, document hashes and evidence block content/line references are checked; meaning is always `NOT_ASSESSED` by code.

Key: SHA256 of `[raw item ID, accession, source fingerprint, contract revision, schema SHA256, prompt SHA256, provider profile]`. A deterministic UUID and unique key index prevent duplicate reservation. Completed results return before large-source revalidation in SQL. New fingerprints/revisions/profiles produce separate history. Current-source readers compare fingerprints and never update a latest pointer or market quote value.

## Worker and crash recovery

Run on the authenticated local Codex host, not Vercel: `npm run os-snapshot:worker`. Required private environment variables: `OS_SNAPSHOT_CODEX_EXECUTABLE` (absolute native binary path) and `OS_SNAPSHOT_JOURNAL_DIR` (absolute persistent private directory outside the checkout). `.env.local` supplies this app's local DB credentials. `-- --once --id=<uuid>` bounds a manual worker run. Ordinary mode polls the existing queue every five seconds. No OS service/cron is installed by this candidate.

Provider is `codex-cli:gpt-6-astra:high:v1`, observed CLI `0.154.0`, ChatGPT login. Spawn uses executable plus argv, `shell:false`, hidden windows, isolated per-run/attempt workspace, ignored user config/rules, ephemeral sessions, disabled inherited skills/memory/multi-agent, no product/API credentials in child environment. `:workspace` with the Windows sandbox permits output in the isolated temporary workspace, while the product checkout remains outside writable roots. The frozen prompt's file-output protocol is preserved. Model output, freeze, stdout, stderr, exit status and start/end timestamps are retained. Credentials/auth files are never copied to repo/DB/logs; diagnostics redact credential-like strings.

DB advisory transaction lock serializes global claims; 90-second lease with 20-second heartbeat. A host-local exclusive provider lock serializes actual processes, including surviving orphan processes after a worker crash. DB invocation intent records the host/journal and attempt before spawn. Once intent exists, recovery cannot create a fresh invocation from a missing journal or a different path. A living/unknown child remains blocked from replay. A dead child with final output is recovered and validated without a new GPT call; a dead child without final output is a technical failure. Missing journals/unknown process identity require operator reconciliation, never automatic inference that the call did not happen. Keep the journal on durable local storage; do not point two hosts at different directories for the same queue.

Raw result is journaled before checkpoint, checkpoint before publication. Lost checkpoint/finish responses replay retained state. Database errors are not converted into permission for a new provider invocation. No semantic auto retry exists. Technical retries require a recorded safe exit without final output, a reason, and a separate admin decision; attempt directories and technical history are retained. A retired provider profile cannot silently run on the new model.

## Statuses and storage

`QUEUED`, `RUNNING`; then `PASS`, `REVIEW_REQUIRED`, `NO_DIRECT_CURRENT_OS`, `VALIDATION_FAILED`, or `TECHNICAL_FAILED`. All valid statuses save literal JSON and original raw output. NO_DIRECT is successful completion. REVIEW never selects a candidate automatically. Parse/schema/reference/freeze errors preserve original output and forbid retry. Approval selects explicit candidate indexes in the decision history only. Hold/reject do not change AI output. Public/authenticated clients have no direct table/RPC access.

Migration: `20261008171255_sec_os_snapshot_v1.sql`. It adds feature-specific indexes/RPCs/immutability triggers and `sec_os_snapshot_decisions` with RLS. No existing data is deleted. Applied locally and registered as applied in local migration history. Local application affects only these objects; no reset, unrelated migration application, remote DB, environment provider changes, or cron changes.

## Verification record, 2026-10-09 KST

- Frozen original source hashes, unchanged 14 JSON outputs, schema and reference checks: 14/14. Repository fixtures retain the exact output bytes and small cited source excerpts (about 94 KB total), not complete filing archives; manifest preserves full-document hashes. Full original validation was performed during offline fixture import.
- `npm run verify:os-snapshot`: **37 PASS**, deterministic contract, source, provider journal, preflight technical failures and ingest checks (no real Codex).
- `npm run verify:os-snapshot:local`: temporary owned PostgreSQL schema with multiple connections, duplicate reservation/claim, completion reuse, lost finish response, lease/checkpoint restart, revisions, source changes, immutability, review decisions, validation/no-direct and technical-only retry. Only the owned test schema is dropped.
- Related Offering foundation, S-1/F-1 Primary analysis/parser/source input, S-8 ingestion/persistence: **142 PASS**, after the final source-capture change.
- `npm run typecheck` and `git diff --check`: PASS.
- Supabase local security advisors: no error-level issues.
- Real known filing: Canaan F-1 `0001193125-19-276263`, raw ID `c48ba300-3416-42ff-a042-17b74a4d2812`. Successful run `ada400dd-2c79-5e0e-a881-0057acaba811`, PASS, schema/reference complete, current fingerprint matches. Successful profile invoked once; reenqueue and actual raw-ingest replay returned existing result with zero additional calls.
- Earlier pre-extraction attempt using unsupported `gpt-6.1` failed with HTTP 400 and no JSON/semantic analysis. It remains a separate TECHNICAL_FAILED run `df855369-c09f-5b34-a6b9-39022d22ab83`. Total CLI process starts across setup: **2**, successful semantic extraction: **1**. This is not an unqualified first-attempt E2E pass.
- Local evidence directory: `C:\Users\PC\AppData\Local\Temp\os-snapshot-product-e2e-8e9d-20261009`. No evidence/auth/log folder is committed. Candidate Next server uses port 3112; port 3110 untouched.
- Browser: existing Operations session displayed PASS list/detail and retained JSON. Separate anonymous browser redirected to login. Actual DOM widths 1440/900/389 showed no horizontal document overflow, and no console errors were recorded. Chrome screenshot capture repeatedly timed out (one resized capture was corrupted). **Full responsive visual acceptance at exactly 390px and review-action browser interaction remain unverified; do not merge on this report alone.** DB review decisions were exercised deterministically.

## Production handoff boundaries

Permanent main stays `C:\Users\PC\Documents\Codex\US-Stock Radar`, branch `main`; no repository command targeted it. Inherited local main: `d7347e4d2e75a5c412f69218003d2dfd407c79c5`; inherited GitHub main: `7fa1de18a5c9b6dc9454862c1d195ea6a773cefa`, unequal and not refreshed. Vercel SHA/state and production DB/cron remain unverified. Main's preexisting `next-env.d.ts` and all other worktrees, including 18ad, untouched. No merge/push/deploy approval or action. Main integration must independently repeat acceptance and complete visual review per `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md`.
