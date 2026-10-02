# S-8 Structured v6 lease recovery — freeze handoff

Worktree: `C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar`; branch `codex/s8-structured-monitor-v1`.
Start: `97a7516035fa43701b3ba60ababfc2ae9cf0287f`. Completion SHA: external `completion.json` / commit containing this file.

## Audit and minimum change

Previously a pending-to-running claim had no expiry; an abandoned claim could never be acquired again. Generic Monitor uses conditional claim/start updates and `releaseForRetry`/`recoverWorkflowFailure` when an error is caught, but has no heartbeat, expiring DB lease or bounded abandoned-claim counter. Its recovery step retries three times. No reusable lease RPC existed. Its Primary-dependent event/parent contract remains untouched.

Reuse existing `ai_runs.metadata`, private RPCs, immutable `ai_outputs`, Workflow queue/steps/sleep, and the existing source-bound input/official reader. No new queue, table, index, cron, semantic execution identity or provider/prompt/schema change.

New `sec_s8_worker_transition` locks the exact S8 raw-bound execution with SELECT FOR UPDATE before any state decision. It atomically schedules, claims, marks provider start, saves a checkpoint and finishes. Each claim has a random ownership token, count, claimedAt, leaseExpiresAt and phase. Expired owners are fenced from provider-start/checkpoint/finish operations. Concurrent reclaims yield one owner.

Lease is 180 seconds: existing provider timeout is 60 seconds, with 120 seconds of reconstruction/checkpoint/DB margin. Provider-start and checkpoint renew it. No heartbeat is added; an unexpectedly long/stalled operation loses ownership safely. Four global claims (initial plus three recoveries) bound attempts, matching the existing infrastructure retry count. Expired acquisition beyond the bound becomes failed/unavailable. Scheduler reservations have their own 180-second lease and four-start bound; ambiguous starts can be retried on a later enqueue after expiry. This is not a new periodic orphan scanner.

The existing Workflow catches infrastructure failures/busy leases, sleeps durably for 180 seconds and tries again within a bounded loop. Persistence step retains three retries. A replacement delivery/re-enqueue can reclaim an expired job under the same logical identity; the DB count is shared across workflows. Exhausted operations require investigation rather than an unbounded retry loop.

## Checkpoint and uncertainty

`metadata.s8Checkpoint` preserves terminalStatus plus the exact response/payload/binding/hash. It is stored before leaving the analysis step and is immutable once present. Its storage is independent of the original Workflow run, so another run can resume it. Existing finish still validates current SEC source and atomically saves the output/terminal state. The compatibility claim RPC delegates to the lease RPC; finish is guarded against publishing an arbitrary uncheckpointed payload for lease-managed jobs.

Order: completed -> no-op; retained checkpoint -> revalidate current binding/hash/format and persist without provider; no checkpoint -> durably mark provider-start before invoking the unchanged analyzer. Failed provider/validation checkpoints are persisted as failed, not semantically retried. A source mismatch remains stale/unavailable, including during checkpoint recovery; old evidence/checkpoint is preserved.

A provider call that may have completed but has no durable checkpoint is an unavoidable uncertainty window. Reclaim increments `uncertainProviderAttempts`; it may make another call within the claim budget. A start marker does not prove an HTTP request actually reached Google. No exactly-once provider guarantee is claimed for this window. After checkpoint, extra calls are zero.

## Real DB fault injection

Authorized local Supabase: 127.0.0.1:56322/postgres, cluster 7678429483712069671. Preserved real Microsoft source and v6 response, plus Nautilus/Lottery normal regressions. No fresh Gemini or Primary calls.

The runner intercepts a chosen repository boundary to throw before/after the real RPC, then expires only its newly created verification execution's worker lease. It does not kill unrelated processes, alter SEC/source/direct data, pass an arbitrary production clock, or add a public fault-injection RPC. The actual DB locks/RPCs, runtime analyzer adapter, checkpoint, persistence and official reader execute normally.

| Test | Interruption | First stub calls | Recovery stub calls | Outcome |
|---|---|---:|---:|---|
| T1 | claim acknowledged, before work | 0 | 1 | succeeded, one output |
| T2 | immediately before provider-start marker/call | 0 | 1 | succeeded, one output |
| T3 | DB checkpoint committed, response acknowledgment lost | 1 | 0 | succeeded, one output |
| T4 | checkpoint complete, before persistence | 1 | 0 | succeeded, one output |
| T5 | final persistence committed, acknowledgment lost | 1 | 0 | succeeded/no-op, one output |
| T6 | two concurrent expired-lease workers | 0 | 1 total | one owner, other busy/no-op, one output |
| T7 | completed job redelivery/enqueue | 1 | 0 | no-op, one output |
| C | provider response returned, checkpoint not committed | 1 | 1 | uncertain count 1, one final output |

Additional real-DB safety checks: old token fenced; four-claim bound; stale source read injection (no source DB mutation) remains unavailable; ambiguous scheduler-start expiry; checkpoint deletion rejected. Each successful case retains the original direct rows and official readback; Matcher eq/in matches the same `s8.filing_kind`. No array FACT, sum, Primary or alerts.

## Actual Workflow HTTP verification

Candidate server on 3113 executed the generated queue/flow/step HTTP path for Microsoft, Nautilus and Lottery using frozen raw responses at the provider HTTP boundary. All three: worker/persist/readback/Matcher PASS. Those are provider stubs, not fresh model calls. Normal source evidence/prompt/request contents were checked unchanged.

A further actual HTTP workflow received an execution with an already committed DB checkpoint and expired claim, with no output yet. It acquired claim 2, reused the checkpoint, persisted/read back successfully and made zero additional provider requests (providerAttempts remained 1). This verifies cross-workflow recovery, not only reuse within a single original run.

Wall-clock lease waiting, OS process kill and a provider service outage were not induced. Deterministic crash/expiry injection covers the requested boundaries without pretending those are live chaos tests. The full durable sleep timer's 180-second wall-clock behavior was not separately timed; installed Workflow sleep is reused.

Existing actual Microsoft Gemini3.5 canary from the preceding task remains evidence; provider request generation/settings were not changed, so no extra real call was needed.

## DB changes and preservation

Applied only `20261002092543_sec_s8_worker_lease_recovery.sql`:
- new service-only `sec_s8_worker_transition(uuid,uuid,text,text,jsonb)`;
- replaced `claim_sec_s8_structured`, `finish_sec_s8_structured`, `guard_sec_s8_structured_history` for lease/checkpoint compatibility and immutability;
- no new table/index, no permission expansion, no existing migration rewrite.

Added 19 explicitly verification-scoped ai_runs and 18 ai_outputs: 17 succeeded, one intentional stale with preserved output, one intentional claim-budget failure with no output. Earlier seven S8 runs/outputs remain unchanged. Whole-table protected digests for direct S8 history and non-S8 AI runs/outputs match before/after. anon/authenticated have no new RPC access. Metadata contains execution bookkeeping, not added semantic facts.

## Regression and freeze

- 27 focused persistence/runtime unit tests PASS (three new checkpoint recovery regressions).
- Full relevant suite: 113 tests, 112 PASS; existing main Matcher static failure only, not introduced by S8. The prior exact candidate/main comparison is retained in the durable handoff.
- Real-DB runner: T1–T7 plus uncertain-window case, four additional safety cases, three normal fixture cases PASS.
- Actual HTTP worker: three normal cases plus cross-workflow checkpoint recovery PASS.
- Full TypeScript and diff check PASS.
- Primary diff/calls 0; v6 prompt/schema/source-builder/official-reader/Monitor diff 0.

Conclusion: **S-8 Structured v6 production freeze 가능** for the verified backend scope. This supersedes the previous lease-recovery blocker; it is not a deployment or whole-product certification. Semantic retry/repair, UI, MCP/public API, Alert delivery and additional model validation remain out of scope. The uncheckpointed provider uncertainty remains documented, not hidden.

## Evidence / resume

`C:/Users/PC/.codex/visualizations/s8-v6-lease-20261002/`:
`db-before.json`, `migration.txt`, `report.json`, per-test readback, `stub-report.json`, `cross-workflow-recovery.json`, `final-db-audit.json`, request/raw-response/stored artifacts, `regressions-final.txt`, `typecheck-final.txt`, archived Workflow data, `completion.json`, SHA-256 manifest.

Runners: `scripts/verify-s8-lease-recovery.mjs`, `scripts/verify-s8-checkpoint-worker.mjs`, and existing `verify-s8-structured-durable.mjs` with explicit verification prefix. Scripts refuse non-authorized DB host/port; DB fault runner forbids external HTTP. Fixed keys intentionally refuse overwriting old fault-injection evidence. Normal runner reuses completed execution evidence on replay. Do not change semantic versions or delete history to obtain another run.

## Required operational handoff

Permanent main remains `C:/Users/PC/Documents/Codex/US-Stock Radar`, main only. Local main ref `9e5afda70b5b7314bcb747aaaef26462ce21888b`; cached origin/main `9c13aee7ef41b38bac0637e53e579633745effda`. Live GitHub main and Vercel commit/deployment status unverified; no equality claim. Candidate only; no merge/push/deploy.

Local migration applied to authorized 56322 only; remote DB unverified. No env files, account permissions, Docker, cron, external alerts or other services changed. Test server uses process-local Supabase settings plus a stub-only Gemini key; no real provider credentials are required. UI/mobile checks not applicable to this backend-only task. Task-owned 3113 server is stopped after verification; main server is untouched. Generated next-env.d.ts diff is preserved in external evidence and restored once after that server stops, excluded from product logic. Final candidate commit/clean state is recorded in completion.json.
