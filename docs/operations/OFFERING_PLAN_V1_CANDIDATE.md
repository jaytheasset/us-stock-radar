# Offering Structured v1 candidate

Candidate: `b31e/US-Stock Radar`, detached from `8d21d3196468a16d07a9c1f97c1ca3cbb7146780`. No main integration, push, deployment or remote DB operation. Main/GitHub main/Vercel commit equality is **unverified** and is the main integration owner's subsequent gate.

## Acceptance and frozen gate

- Ten fixed filings / six issuers PASS. Eight continuation filings each received exactly one extraction, no retry/replacement/output repair. NuCana r2 was reassessed without another call. Its prior r1 transport failure remains historical evidence.
- Contract/schema and semantic instructions remain the gate-tested `offering_plan_v1`, output protocol `offering-output-r2`. Currency normalization such as GBP 0.01 is accepted; verbatim source evidence still requires intact Unicode.
- `lib/sec-offering-plan/contracts/offering-output-r2/completed-gate.json`, corrected criteria, manifests and individual review records retain the gate evidence. `.gitattributes` preserves frozen bytes, including CRLF in the schema. The production writer is byte-identical to the frozen writer.
- Gate cases: ARM F-1/A; NuCana F-1/A; Birkenstock, Viking, Amer Sports and On F-1/F-1/A pairs. Direct fixed **final_stated** IPO price was not present in this fixed cohort; coverage must not be claimed for that optional sample type. Fixed/assumed NuCana pricing, blanks, ranges, seller types, ADS, warrants, directly stated proceeds and amendment pairs were covered.
- `fixtures/*.json` are unmodified frozen outputs. Compressed source fixtures contain only exact cited lines at their original line offsets and explicitly say `sparse-reference-only`. They are structural regression inputs, **not full filings or extraction inputs**. Full originals/journals remain outside Git.

## Product behavior

F-1/F-1A saved full primary HTML → existing neutral renderer and 40-line blocks → separate Offering binding → `ai_runs` → the existing worker dispatch → one Offering CLI call → host UTF-8 freeze → schema, identity and reference validation → immutable `ai_outputs` → administrator review.

- Reuses full HTML saved as `os_snapshot_primary_html` (or a confirmed untruncated primary), shared process runner and existing worker. No new queue table or worker service.
- `sec_offering_plan`, revision `offering_plan_v1-output-r2`; binding includes raw ID, accession, source fingerprint, revision, schema/prompt hashes and provider profile.
- Shared worker uses the same `OS_SNAPSHOT_CODEX_EXECUTABLE` and `OS_SNAPSHOT_JOURNAL_DIR` for both domains. An Offering-only run uses `npm run os-snapshot:worker -- --once --purpose=sec_offering_plan --id=<id>`. Do not point separate workers at different journal roots. The unchanged O/S RPC is also protected by a shared DB claim trigger; same-host filesystem locking prevents overlapping subprocesses even after lease expiry.
- DB invocation intent binds the host journal. A saved checkpoint or result is recovered without another call. Live/unknown PID, missing journal after invocation intent or another host's journal stops recovery for operator reconciliation. Lease expiry alone never proves a call did not happen.
- Invalid output is never repaired. Invalid UTF-8 is retained as Base64 bytes, with hash over the original bytes. A returned output forbids technical retry. Only a durable no-output technical failure marked retry-safe can be explicitly retried by an administrator.
- PASS auto-saves, REVIEW_REQUIRED saves candidates without selection, NO_DIRECT_OFFERING_PLAN is terminal, VALIDATION_FAILED retains raw, TECHNICAL_FAILED retains execution diagnostics. Human decisions append separately and never mutate AI payloads.
- Family grouping uses only official CIK + matching file/registration number. Missing/invalid/conflicting numbers are not guessed. Each accession/fingerprint/revision has separate history; no current-value synthesis or carry-forward.
- No parser meaning selection, calculated proceeds, output correction, actual O/S reuse, closing confirmation, Registry/Primary/Monitor/public Dilution integration.

## Administrator acceptance

Routes: `/admin/data/offering-plans`, `?id=<run-id>`, POST `/api/admin/data/offering-plans/<run-id>`.

List/detail show identity, status, seller/security, quantity/price and missing-state distinctions, depositary relationship, directly stated optional values, evidence, raw output, validation, separate family snapshots and append-only decisions. A REVIEW_REQUIRED approval selects exactly one plan. All decision requests require same-origin authentication, `data.run`, a request UUID and a reason. Reads require `data.read`.

Verified actual Canaan page at 1440, 900 and 390px, with no horizontal overflow or browser page errors. Verified direct logged-out redirect/API denial, operations-account read and decisions, authenticated non-admin denial, cross-origin denial, navigation, raw/validation display. Clearly labeled local synthetic fixtures exercise review approve/hold/reject, family comparison, invalid-output no-retry and safe technical requeue. No read-only `data.read` role currently exists in the role matrix; non-admin denial is checked instead of inventing a new role.

## Migration and tests

`20261008211452_sec_offering_plan_v1.sql` adds Offering idempotency indexes, reserve/transition/decision RPCs, immutable guards, a private decisions table and shared Codex claim guard. Functions use security invoker and an empty search path; only service_role receives execution/decision access. Existing ai_runs/ai_outputs remain service-only with RLS.

Only Offering RPCs have a bounded 30s statement timeout: the 5.5MB Canaan binding exceeded the local REST role's 8s default before any GPT invocation. Global roles/settings and O/S RPC settings remain unchanged. PostgREST applies per-function settings at transaction scope ([official reference](https://docs.postgrest.org/en/stable/references/transactions.html)).

Local migration was applied for candidate verification, without a migration-history entry. The final SQL must be reviewed/applied through the main integration workflow; remote DB is unchanged. Local Supabase security advisors reported no issues.

- `npm run verify:offering-plan`: 30 PASS, no real model calls; includes ten frozen outputs, both Windows/Node eleven-string transport paths, neutral source enqueue, replay/recovery, raw-byte failure retention and one-at-a-time real Node stub subprocess under the shared lock.
- `npm run verify:offering-plan:local`: isolated-schema SQL/runtime PASS; concurrent idempotency, terminal reuse, finish response loss, leases/checkpoints/journal intent, revisions/fingerprints, family spoof rejection, approval cardinality/roles/replay, immutable history, invalid UTF-8 storage, all terminal states, safe retry and both-direction O/S/Offering claim exclusion. Test-owned schema removed afterward.
- `npm run verify:os-snapshot`: existing 37 PASS.
- Registry/Monitor/instrumentation regression set: 158 PASS, four existing optional tests skipped. Existing S-1/F-1 Primary tests: 17 PASS, using the repository's TypeScript path loader.
- TypeScript noEmit and candidate Next.js route compilation PASS. React review: server-side reads and parallel list/detail loading, server-only source/schema, small client decision component, labeled single-choice controls, busy state and authenticated API.

## Real E2E and preservation

Canaan F-1 `0001193125-19-276263`, run `df85e8b8-3f37-5c4a-a794-829096a7537c`: **PASS**. Actual post-save ingestion hook, Offering CLI once, strict UTF-8 freeze, validator, DB, actual admin page. Reenqueue and terminal replay added **zero** calls. No O/S worker or backfill ran.

Raw SHA256: `495ca3d8b4fb5508faa48271f9d67eae7de1ec442f913659d66dde2fef7848f6`.

Direct source check: issuer ADS offering, quantity/price/ADS ratio blank; Class A underlying; blank over-allotment quantity; directly stated Class B 356,624,444 after-offering scenarios; no fabricated proceeds or closing. Official family metadata is absent in this retained raw record and remains null.

This continuation made **9** actual Offering GPT calls: eight remaining gate cases + one product E2E. Across the historical gate and E2E, **12** calls, including the preserved NuCana r1 transport failure and r2 output. No extra NuCana/ARM invocation.

Local evidence: `%LOCALAPPDATA%/Temp/offering-product-e2e-b31e` (E2E/browser/integrity reports and screenshots). Gate originals: `offering-plan-gate-b31e-r1` and `-r2`. Shared provider journal remains at the existing O/S E2E journal root; Offering uses its own `offering/<run>/<attempt>` namespace.

Integrity audit confirms all 9 existing O/S runs and 6 O/S outputs unchanged; actual Offering raw/freeze/DB hashes agree; decisions leave AI outputs unchanged; anon/authenticated direct table access denied. Four clearly labeled synthetic UI fixture records remain only in local DB, with immutable decision history. The synthetic retry was completed without a model and left no synthetic queued job.

Candidate UI verification used port 3114; that server was stopped after verification. Port 3110 and other tasks' servers were untouched. `.env.local`, raw filings, screenshots, credentials and journals are not committed. Candidate-generated `next-env.d.ts` change is excluded/restored; permanent main's file is untouched.

The candidate is available for independent main merge review. This report does not authorize merge/push/deploy and does not replace the main workspace acceptance gate.
