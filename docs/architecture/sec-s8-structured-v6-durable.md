# S-8 Structured v6 durable worker verification — 2026-10-02

Candidate: `C:/Users/PC/.codex/worktrees/s8-structured-monitor-v1/US-Stock Radar`, `codex/s8-structured-monitor-v1`.
Start HEAD: `a18609425ed9abb2e0ca4de8cbd7410e5f9e5ef8`. Final commit: `git log -1 -- this file`; exact completion SHA is also recorded in the external evidence completion.json.

## What changed

The existing raw-bound S8 Workflow now has two durable steps: claim/reconstruct/analyze, then persist the checkpointed response. Provider step retries remain zero; persistence-only retries are three, matching the generic workflow's bounded infrastructure recovery count without repeating Gemini. A successful DB write followed by a lost HTTP acknowledgment can be replayed exactly by the existing immutable finish RPC.

Existing ingest hook is unchanged: `runSecRawIngest -> successful direct persistence -> enqueueS8Structured -> actual Workflow queue/HTTP worker -> unchanged v6 analyzer -> ai_runs/ai_outputs -> readS8Structured -> s8MonitorFacts -> existing Matcher`.

The generic Primary child cannot be reused as an S8 semantic parent: it requires an event, authorized Primary run/output and currentness/routing. S8 reuses the same Workflow platform and private AI storage, but retains raw/accession/source fingerprint/contract identity. No Primary input, routing, prompt, model fallback, semantic validator/repair, UI or alert consumer was added.

An explicit service-only `verification:<key>` execution namespace permits bounded verification without deleting or replacing the three previous successful automatic replay records. Default enqueue/read remains `automatic`; ordinary ingest and Monitor readers never select verification results. The same input binding, analyzer, finish RPC, exact reader and Matcher are used. The key is not an HTTP/user option. No schema/output/prompt changes.

New migration `20261002085756_sec_s8_structured_durable_verification.sql` only replaces `reserve_sec_s8_structured(uuid,jsonb)` to permit the tightly bounded verification namespace. Source validation, existing indexes, permissions and immutable history remain unchanged. No new tables or indexes. The previously applied migration is unchanged.

## Static failure audit

`reader failure is deterministic and the Matcher has no fallback, provenance, LLM, or delivery dependency`, `lib/listingMonitorMatcher.test.ts:518`, fails `assert.doesNotMatch(source, /source_ref|fact_provenance|evidence|parser|Gemini|ai_runs|alert|notification|Telegram|Email/i)`.

The exact same two source assertions were run on candidate HEAD and local main `9e5afda70b5b7314bcb747aaaef26462ce21888b`, using `git show` from the candidate. Both fail on existing Form 4 `Evidence` identifiers. This is an overbroad pre-existing static assertion, not an S8 regression or a missing runtime module. Main was neither checked out nor edited. The unrelated test was not weakened.

## Actual verification

Candidate Next.js/Workflow HTTP server used port 3113; approved local Supabase target was 127.0.0.1:56322/postgres, cluster 7678429483712069671. No Docker or main server operation.

The runner starts the actual compiler-generated workflow ID through `workflow/api.start`. It does not inject a direct worker/analyzer function. Actual compiled flow/step endpoints execute the unchanged provider boundary. The outside-repository Node preload serves preserved raw Gemini responses for the three stub tests and permits precisely one real Microsoft call afterward. Requests are checked against the frozen source/prompt; no evidence/contract edits or regenerated answers.

| Case | Accession | Actual queue/worker | Persist/readback | Matcher |
|---|---|---|---|---|
| Microsoft stub | 0001193125-25-337056 | PASS | PASS | registration eq/in match |
| Nautilus stub | 0001808805-26-000013 | PASS | PASS | registration eq/in match |
| Lottery.com stub | 0001641172-25-017852 | PASS | PASS | amendment eq/in match |
| Microsoft live | 0001193125-25-337056 | PASS | PASS | registration eq/in match |

Live canary: gemini-3.5-flash, one HTTP/provider call, zero retries/repair/Primary calls, HTTP 200, STOP, 2,033 ms provider latency, 6,719 input / 110 output tokens. Schema PASS. Source comparison PASS: Microsoft Corporation 2026 Stock Plan, registration, E1/E2/E5/E7, no spurious prior filing. Semantic fields exactly match the pre-call source-grounded baseline. Canonical direct rows/hashes were unchanged.

Duplicate enqueue, second claim, exact finish replay, and four additional actual worker deliveries of the completed jobs all returned duplicate/replay with no additional provider requests or outputs. These are duplicate deliveries, not four fresh analyses. No lease-expiry/crash chaos test was performed.

New DB data: four verification ai_runs and four ai_outputs only (three provider-stub executions, one fresh canary). Existing three automatic replay runs/outputs are byte-equivalent after JSON timestamp normalization. Full-table protected digests for direct registration, non-S8 AI runs and outputs match before/after. Twenty transaction-rolled-back DB checks verify conflicting writes, wrong fingerprints, immutable output, invalid verification keys and future-version separation. No primary/direct source writes. anon/authenticated RPC access remains false.

Source/contract changes retain distinct IDs and do not overwrite v6 history. A new source is eligible only when independently accepted by the existing direct-history contract; this worker does not rewrite immutable direct history to force refreshed evidence through.

## Tests and practical limits

Focused S8/direct/ingest/generic child/Matcher suite: 110 tests, 109 PASS, only the known main static assertion FAIL. Full TypeScript check PASS; diff check PASS. Added tests cover verification isolation and persistence retry without a second provider call. Windows Node test-launcher alias failures were fixed in the invocation (absolute loader file URL), not product code.

The live tests start at the actual enqueue boundary against already preserved raw/direct records. Ingest eligibility and raw/direct-to-enqueue ordering are regression-tested; these tests did not refetch SEC or rewrite the existing direct records. Only Microsoft had a fresh provider response in this task. Nautilus/Lottery are actual-worker provider stubs, not fresh semantic validation.

Failure semantics: input unavailable prevents reservation; source mismatch is stale; analyzer reports input/configuration/provider/validation stage; a failed semantic/provider result remains failed/unavailable. A DB failure retries only the checkpointed persistence step and remains a failed durable step if exhausted. Ambiguous workflow start or a process loss after claiming cannot safely authorize a replacement model call: the reservation stays unavailable for explicit operational investigation. There is no automatic expired-running lease takeover. This conservative zero-provider-retry behavior is distinct from generic child `releaseForRetry` and is not claimed as verified generic failure recovery. Do not infer that the happy-path validation proves crash recovery or all production failure handling.

Because that requested generic recovery/lease behavior is still not equivalent, the exact conclusion is **Persistence complete; durable worker recovery still needs follow-up** (`Persistence는 완료, durable worker 보완 필요`), not an unconditional production freeze. Normal durable execution, dedupe, checkpointed storage, reader and minimal FACT are verified. Any recovery change must preserve the immutable response and must not silently repeat an uncertain model attempt.

## Evidence and resume point

Evidence directory: `C:/Users/PC/.codex/visualizations/s8-v6-durable-20261002/`.
- static-audit.json; db-before.json; migration.txt; final-db-audit.json
- stub/canary report, request, full response, transport, stored and readback files
- actual-worker-duplicate-delivery.json; workflow archive; server.log
- regressions-final.txt; typecheck-final.txt; completion.json; SHA-256 manifest

Previous evidence directories remain unchanged. Outside-repository preloader/server launch files contain no copied credentials. Credentials were read into process memory from the existing project-local setup; no API keys/headers/cookies are included in request artifacts.

Reproduction uses `scripts/verify-s8-structured-durable.mjs` and `scripts/verify-s8-structured-redelivery.mjs`, the existing candidate's generated manifest/Workflow HTTP server, retained frozen v6 response directory and an outside-repository output directory. Next's installed Workflow adapter forces `.next/workflow-data`; the runner reads that actual store. Re-running with the same verification key reuses evidence/history, not a fresh call. Do not reset counters or silently choose a new key to obtain preferred output.

Next work is narrow failure recovery, if authorized: explicit ambiguous-start/recovery contract and a bounded recovery test without recirculating a successful model response. Do not reopen semantic prompt/model evaluation.

## Operational handoff

- Permanent main remains `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch main; local main ref `9e5afda70b5b7314bcb747aaaef26462ce21888b`, unchanged.
- Cached origin/main `9c13aee7ef41b38bac0637e53e579633745effda`; live GitHub main and Vercel deployed commit unverified. No code-equality/deployment claim.
- Candidate only; no merge/push/deploy approved or performed. Local migration applied only to authorized 56322; remote migration state unverified.
- Candidate server used SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / GEMINI_API_KEY / WORKFLOW_LOCAL_BASE_URL / NODE_OPTIONS in process memory. No env file, account, cron or external delivery changes.
- No UI changes/checks in this task. Main/shared resources and all historical data are preserved. Generated next-env.d.ts is local development output, excluded from product commit.
`3113` was a task-owned verification server; it was stopped after all eight real workflow deliveries completed. Its Workflow store was archived outside the repository. Main/other servers were not operated.

## Lease recovery completion

The subsequent [lease-recovery handoff](sec-s8-structured-v6-lease-recovery.md) supersedes this document's outstanding lease/recovery blocker. It records atomic expiry/reclaim, cross-workflow DB checkpoints, crash/concurrency validation and the remaining uncheckpointed-provider uncertainty. All evidence in this document remains preserved as the earlier verification stage.
