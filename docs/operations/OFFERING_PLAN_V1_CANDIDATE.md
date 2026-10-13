# Offering Structured v1 — original extraction gate and integration status

## Current local integration checkpoint — 2026-10-13

The O/S/Offering/direct FACT Monitor integration is in local main `7651dad75da9137458de78efdb345de7ba65195c`. See [current architecture, verification and migration record](OFFERING_PLAN_MONITOR_DIRECT_FACTS.md) for the authoritative current checkpoint. Projected calculations are retired; the unused calculator was removed, while historical result contracts/readback remain. PASS direct facts do not require routine administrator approval. Existing Registry/share-count history remains separate and unchanged. Primary is unchanged; no production deployment is claimed.

**The candidate sections below are dated history.** Their unmerged/unverified statements describe those checkpoints, not the completed local integration. Frozen original extraction gates are retained; newer combined/ATM contracts do not retroactively rewrite their evidence.

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

## Compact reservations and four additional product E2Es — 2026-10-09

Continuation base: detached `d2b7cafb04a786d46d564e47f1d8b768c847607b`, same `b31e` candidate. The original failed expanded-E2E folder and all gate outputs/hashes remain unchanged. ARM reused raw item `5161faa0-d09a-4f9b-ac21-5ead0ef4bd2c`.

### Measured problem and compact contract

The old ARM binding was **6,264,931 UTF-8 bytes**, RPC body 6,264,945 bytes: original HTML 3,274,263 bytes, rendered text 1,338,342 bytes, serialized blocks 1,491,973 bytes / 544 blocks. Canaan's old binding was 5,518,923 bytes (RPC 5,518,937; original 3,177,327; text 998,422; blocks 1,154,047). Original and rendered content were duplicated in the reservation request and binding metadata.

The historical local DB/PostgREST logs show a statement timeout in the old reserve function's source-validation `IF`. They do not isolate one comparison expression as the cause. GPT-free rollback measurements did **not** reproduce the timeout: an unchanged reserve called inside a rollback wrapper took 6.25s over REST (2.69s inside the wrapper); a clone of the original body with a mandatory rollback exception took 1.66s. Neither measurement left a run or invoked a provider. The earlier timeout remains a recorded failure; these measurements are not a claimed timeout duration.

New `bindingVersion:2` stores deterministic run ID/key, raw ID, filing identity, ticker, fingerprint, per-document ID/original/text SHA256, document/block counts, contract/schema/prompt/profile and official family. It contains no source body or block array. The deterministic key is unchanged, so old full-binding Canaan replays to its original run. The semantic schema, instructions and frozen writer are unchanged.

Follow-up migration **`20261009072629_sec_offering_compact_binding.sql`** replaces only reserve behavior: compact shape/size/hash-format checks, raw filing/family identity checks, one raw-payload decode and SHA256 of the retained original, followed by idempotent reservation. It retains the existing 30s bound, service-only RPC permissions, RLS and immutable guards. The already-applied migration is byte-identical; no historic run/output is rewritten. The follow-up was applied to local DB for verification, without adding a migration-history entry, consistent with the original local candidate setup. Main integration must reconcile the local migration history separately; no remote DB was accessed.

After claim, Worker reconstructs the neutral source from raw ID and compares the complete compact descriptor before recording invocation intent. Changed/missing/mismatched source becomes a persisted `TECHNICAL_FAILED` / `pre_provider_source` checkpoint with no provider call and no automatic retry. Checkpoint/journal recovery and shared O/S lock are retained. Admin evidence uses the same reconstruction; unavailable/mismatched source produces a notice and no current-source evidence. Old full bindings remain readable/replayable without conversion.

### Actual product results

Every case used its complete retained primary, the actual ingest replay hook, Offering-only shared Worker, one CLI invocation, strict UTF-8 freeze, structural validator, immutable output, direct source review, admin UI and terminal reenqueue. Gate JSON/reviews were evaluation material only, never provider inputs. No O/S worker/backfill, extra reviewer model, output correction or retry ran.

| Case / accession | Run ID | Status | Binding / RPC bytes | Reserve / whole enqueue |
| --- | --- | --- | --- | --- |
| ARM F-1/A `0001193125-23-228059` | `3e24e215-9d61-5626-a8f3-2faa92a5cb7d` | PASS | 1,142 / 1,156 | 170ms / 2.27s |
| NuCana F-1/A `0001193125-25-110310` | `7c0b355a-d4ac-5632-aba0-e004de2d2be2` | PASS | 1,131 / 1,145 | 57ms / 0.21s |
| Birkenstock F-1 `0001193125-23-233488` | `b03218a6-720a-5b03-af3a-e63f5def73e0` | PASS | 1,143 / 1,157 | 546ms / 2.21s |
| Birkenstock F-1/A `0001193125-23-250555` | `5ec1a5af-4db0-509e-a21f-e2c7aadb212e` | PASS | 1,145 / 1,159 | 1,330ms / 2.07s |

- ARM: shareholder-only 95,500,000 ADSs, proposed USD47–51, ordinary-share ratio 1:1, shareholder option 7,000,000. Explicit issuer no-proceeds; no calculated gross. Direct conditional post-offering 1,026,078,866 ordinary shares remains a plan assumption.
- NuCana: five issuer components covering ADSs, Series A, Series B, pre-funded warrants and registered underlying ADSs. 12,497,768 base ADSs; 559,275,129 directly registered underlying ADSs; ratio 1:25. Combined USD0.5601 is fixed/assumed; pre-funded purchase price stays blank with the source's price-minus-GBP0.01 relationship. Exercise prices are not subscription prices. Exact output and evidence retain `£0.01`/`£0.0004`. Direct conditional issuer net USD5.5m/3.9m/2.4m/0.8m is preserved without calculation.
- Birkenstock F-1: separate issuer/shareholder ordinary-share components with blank quantities/prices; both blank option quantities preserved. No numeric proceeds or post-offering O/S invented; issuer no-proceeds is scoped to shareholder sales.
- Birkenstock F-1/A: issuer 10,752,688 / shareholder 21,505,376 ordinary shares, proposed USD44–49, shareholder-only option 4,838,709 and direct conditional post-offering 187,825,592. Issuer gross USD500m is the literal new-investor consideration in the dilution table, not multiplication; net USD450.2m is directly stated. Shareholder proceeds are not assigned to issuer.

All direct meaning reviews PASS: no actual closing claim, fee-table proceeds, inferred values, hidden core conflict or amendment carry-forward. Birkenstock family is **`0001977102:333-274483`**, with separate runs/outputs and untouched F-1 blanks. The earlier issuer over-allotment placeholder is not carried into F-1/A.

This expansion used **four new Offering GPT calls total**, including ARM from the prior turn; **three** occurred after the user-started 3114 server resumed verification. ARM was not re-run or re-worked. Every attempt remains 1; reenqueue added **zero** provider calls and **zero** duplicate outputs.

Raw/freeze/DB SHA256:

| Case | SHA256 |
| --- | --- |
| ARM | `ba2cbf3f99dfc020a18379a7bc4e64da50febe1f485432041b6cf7be0a1cd719` |
| NuCana | `0fd20d3c89d87972b5707173e166d5f64c6a52df40f1fe3eb8262597d1564c11` |
| Birkenstock F-1 | `56d73a61487a3cecaf7b0c7ae30f85b9006e03dca70376f316f7c98eb86a0e8e` |
| Birkenstock F-1/A | `9473b84b1ed19864bbc8a3691b8dd604dc61917b3566e1d9d556d767632aa69c` |

### Browser, regression and preservation

All four list/detail/evidence/raw/validation views passed at **1440×900, 900×900 and exactly 390×900**. Screenshots were visually inspected; no horizontal page overflow, clipped value text, damaged Unicode or normal-flow console errors. Birkenstock family compares two separate conditions on desktop and stacks them on mobile. Logged-out/non-admin direct page/API denial and legacy Canaan full-binding read also passed. The first browser harness incorrectly counted an empty framework alert as an error; diagnosis showed no error message, and only the external harness was corrected to reject nonempty alerts. No product result changed and no synthetic REVIEW fixture was added.

Post-E2E verification: Offering **31 PASS**, O/S **37 PASS**, Registry/Monitor **213 PASS** with four existing optional skips, S-1/F-1 Primary **91 PASS**, isolated SQL/runtime tests PASS, TypeScript noEmit, production build and diff check PASS. Local tests covered actual retained ARM and both Birkenstock source sizes, compact metadata, duplicate reservation, old/full replay, source changes/missing content/fingerprint mismatch with zero model calls, safe evidence reconstruction, immutable results and checkpoint/lease/journal recovery. Model-free tests used isolated schemas and removed them afterward.

Final audit: all prior Offering **5 runs / 4 outputs**, including Canaan, and O/S **9 runs / 6 outputs** retain their row hashes. The four new outputs also retain their initial hashes after subsequent cases and replay. Prior gate/failure files and journals are unchanged. Anonymous run/output reads remain denied; anon/authenticated reserve and decision permissions remain denied. Shared provider lock is free.

Evidence is outside Git at `%LOCALAPPDATA%/Temp/offering-compact-b31e-20261009`: per-case preparation/capture/review/browser/replay/completion records, screenshots, `resumed-integrity.json` and regression logs. Historical `final-audit.json` intentionally retains the earlier browser-blocked status; the resumed records supersede that status without rewriting its evidence. The user-started candidate server remains on 3114. Port3110, main, remote DB, environment settings, scheduling, push and deployment were not changed. Local main / GitHub main / deployed Vercel commit equality remains **unverified**; this is candidate acceptance evidence for independent merge review, not production completion.
