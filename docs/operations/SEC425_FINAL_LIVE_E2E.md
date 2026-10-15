# 425 final live-provider E2E: environment blocked (2026-10-15)

## Latest authorized continuation: explicit private bridge

Base0c4c14954a836b3a80315f08718f9b751bdff55d, same425 candidate, detached/clean. Main's actual latest user turn authorizes read-only Docker/host/WSL/VPN overlap analysis; only if a non-overlapping private subnet is confirmed, create one dedicated bridge with explicit --subnet and start the already prepared stack using --network-id. No prune, existing resource deletion, global daemon change, Desktop restart or other-project network sharing. Prior failed attempts remain immutable. New evidence subdirectory: `network-recovery`. Current checkpoint: **dedicated bridge created; explicit-network-ID Supabase start failed; STOP**. Total physical provider budget0/6; live SEC/worker/FACT/Alert execution0.

### Explicit subnet result

- Read-only audit covered49 Docker networks with their IPAM subnets and connected containers, Windows IPv4 routes/addresses, adapter state and user/all-user VPN profiles, and the only running WSL distribution docker-desktop. Its ip command is absent; `/proc/net/route` and `/proc/net/fib_trie` were successfully read instead. The VPN adapter was disconnected. The overlap checker compared86 non-default ranges and found0 overlaps for10.245.240.0/24. Default routes are excluded from address-overlap checks; future VPN routes remain outside this time-specific assessment.
- Created exactly one dedicated bridge `sec425-final-live-20261015-net`, subnet10.245.240.0/24, gateway10.245.240.1, network ID `e97563a7d647ada0cf13ef8ea06ef9c65b8d120025b161bde90da77ddda00556`. It had no attached containers before startup. No existing network was removed, pruned, shared or reconfigured. Current candidate product files still match the validated runtime archive (4172 files; only report commits since60a859b0).
- Ran the prepared CLI once with the actual network ID:

```text
supabase start --workdir C:/Users/PC/.codex/visualizations/sec425-final-live-e2e-20261015/stack --network-id e97563a7d647ada0cf13ef8ea06ef9c65b8d120025b161bde90da77ddda00556 -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

- CLI2.110.0 advertises --network-id as using a specified network instead of a generated one. Nevertheless, this invocation exited1 with `LegacyStartNetworkCreateError: failed to create docker network: Error response from daemon: all predefined address pools have been fully subnetted`. Sanitized stdout contains the error; stderr is empty. The command/actual ID and logs are preserved. Why this CLI invocation still attempted generated-network creation is **unconfirmed**; do not claim a proven flag-forwarding defect or retry with guessed alternatives.
- Post-check:50 networks total; all49 prior network names/drivers/IPAM definitions unchanged; the one new bridge remains empty. No new project container/volume or listening target port; no DB system_identifier. The dedicated bridge is retained for review. No further start, recreation, alternate network/DB, daemon change or cleanup occurred.

Evidence: `network-recovery/NETWORK-AUDIT.json`, `ENVIRONMENT-ACTION-RESERVATION.json`, `NETWORK-CREATED.json`, `STACK-START.json`, sanitized stdout/stderr, `RESOURCE-STATE.json`, and `FINAL-CHECK.json`. These append to the prior failed-attempt evidence without overwriting it. Product code, prompts, responses and schema were not modified. Only this report changes in Git. Main/shared DB/next-env remain protected.

Result: explicit bridge setup PASS; isolated Supabase environment FAIL; Diana/Axcelis actual-provider E2E NOT RUN. Remaining blocker is CLI startup despite the existing explicit private bridge. No425 semantic failure or actual-provider success is established. STOP for independent review.

## Current authorized continuation

Main's latest actual user turn authorizes read-only environment diagnosis, minimal test-environment repair, and **one** start retry. Base37d22cf79fc4a0d4c0e7e5f148bba86ebcaf3fa9. Product code/response correction remains forbidden. Preserve the first failed attempt and its missing-error-detail limitation below. Retry evidence uses a new `recovery` subdirectory. Current checkpoint: **authorized retry consumed, exit1, Docker network address pool exhausted; STOP**. Provider budget0/6 used; live SEC/worker/FACT/Alert execution0. No further start, reset, network cleanup, alternate DB or environment workaround attempted.

### Recovery preflight and observed failure

- Docker Desktop responds: client/server29.6.1, Linux,20CPUs, memory16645787648 bytes,35 running containers. Supabase CLI2.110.0. Planned3156 and59820/59821/59822/59823/59824/59829 ports were free.
- All153 copied migration files match their recorded hashes and the candidate files. Planned config remains a unique project `sec425-final-live-20261015` / REST59821 / SQL59822. No confirmed config/migration defect was found before retry; no DB was available to query migration application state.
- Compared4172 tracked archive files with the current committed Git blobs, omitting only this later report. Git archive EOL attributes had converted3161 files to CRLF; the external disposable runtime was aligned to the exact committed blob bytes after proving all differences were line endings. No non-line-ending differences, no candidate/main file changes. Per-file before/after hashes are retained in recovery/PREFLIGHT.json. This was source-copy preparation, not a product or Supabase failure fix.
- Reserved the single retry in create-new/fsynced `recovery/START-RETRY-RESERVATION.json`, then ran the same scoped start command once. Process stdout/stderr were retained only after in-memory redaction. No raw output or credentials were stored. Retry exited1; stderr was empty, and stdout contained the actual error:

```json
{"_tag":"Error","error":{"code":"LegacyStartNetworkCreateError","message":"failed to create docker network: Error response from daemon: all predefined address pools have been fully subnetted"}}
```

- This confirms network address-pool exhaustion **for the authorized retry**. The original attempt's cause remains unproven because its stdout was discarded; do not retrospectively claim its exact failure was observed.
- Read-only scoped Docker listings after the retry find no project container, volume or network. No database system_identifier, app runtime, source record, workflow execution or output/Alert ID exists for this attempted run. No existing networks/containers were removed or reconfigured.

Recovery evidence: `recovery/PREFLIGHT.json`, `START-RETRY-RESERVATION.json`, `START-RETRY-RESULT.json`, `start-stdout-redacted.log`, `start-stderr-redacted.log`, and `FINAL-CHECK.json`. First-attempt evidence remains unchanged. Only this report changes in Git; no product tests are rerun for a report-only change. Final HEAD/detached/clean and diffcheck are recorded in the recovery receipt.

Remaining blocker: Docker needs an independently reviewed safe network-capacity remedy before a new environment start can be authorized. This task does not select/remove other projects' networks or bypass the failure using another DB. Diana actual-provider E2E: NOT RUN. Axcelis actual-provider E2E: NOT RUN. No merge/deploy/operational-readiness claim.

Latest user-authorized task, verified against Main's actual user turn: fresh SEC collection → actual425 FACT workflow → official reader → existing Monitor/Alert, Diana/Genco then Axcelis. This supersedes old eeb4/Round4 context. Only candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, base60a859b0fc85a264c20283104a0745a0b9206249, detached/clean at start. No new Git worktree/branch/reset.

Budget: total real Router/Primary/FACT/provider attempts at most6; planned FACT1 per accession (2 total). No new compiler, Router or Primary is needed by the independent425 workflow. Durable create-new attempt reservation before HTTP; per-case FACT cap1; no retry/repair/fallback, output correction or retained/synthetic provider response. First failed stage stops further cases/provider calls. Workflow retry configuration is unchanged, but outbound repeated attempts are physically blocked by the shared ledger.

Cases: Diana0001104659-26-075214 (subject1326200, filer1318885): current revised proposal, cash24.80 +1DSX, implied27.34, non-binding, excluding already owned shares, official DSX/acquirer and GNK/target, matching Alert1. Axcelis0001104659-26-011578 (1113232): prior contract/current shareholder approval, not_applicable, new-contract Alert0. No issuer substitution for cover. Source/citation/reader/currentness and concurrent replay must preserve source and avoid extra provider calls/Alerts.

Existing owned59721/59722 stack has successful runs and remains untouched. Prepare a separate owned temporary stack only if necessary for fresh unchanged production fingerprints. No shared56322/remote DB. New evidence: `C:/Users/PC/.codex/visualizations/sec425-final-live-e2e-20261015`. Existing evidence and failed checks stay immutable. Model credentials only in memory from approved settings, never written/logged; external delivery disabled; operational flag only in verification process.

Known prior blockers are not new failures: cover status metadata refresh, Axcelis XML parse limitation, Diana cover source identity limitation, shared main CSS pure-selector build error, two existing automaticTrigger mock export errors. No product/prompt/CSS/schema changes or broad UI/auth revalidation. Main8a2bb826 and original next-env SHA083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd preserved. GitHub/Vercel/remote state unqueried; no merge/push/deploy/operational enablement.

## Historical first attempt / preserved stop checkpoint

Stopped at isolated environment startup, before live SEC collection or any provider execution. This is an environment BLOCKED result, not a finding that425 FACT semantics or the worker failed. No retained/synthetic response was used. Provider attempts0/6, SEC requests0, worker dispatches0, FACT/Alert records0 for this attempted run. There are no raw/FACT/Alert IDs to report.

Prepared a Git archive of exact60a859b0 under the external evidence `runtime` directory (plain source copy, not a worktree), reusing installed dependencies via junction. No environment file was copied. Created external config for project `sec425-final-live-20261015`, planned REST59821, SQL59822, app3156, and copied the existing153 migration files into this new empty stack directory. This was infrastructure preparation only; the application was never started.

Executed the existing local Supabase CLI once:

```text
supabase start --workdir C:/Users/PC/.codex/visualizations/sec425-final-live-e2e-20261015/stack -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

It exited1. Subsequent read-only `supabase status -o json` reports `No such container: supabase_db_sec425-final-live-20261015`. Docker read-only listings find no containers, volumes or networks with this exact project name, and ports59820–59830/3156 are not listening. No database system identifier could be established. No second start, reset, alternate database, model call or application dispatch was attempted after the failure.

Diagnostic limitation: the startup wrapper suppressed stdout because CLI success output contains keys and retained only migration-name lines from stderr. The original startup failure detail was therefore not retained. The later missing-container status establishes the unavailable environment, **not the original cause of start failure**. The empty migration log cannot independently prove all internal CLI initialization actions; current scoped Docker listings show no surviving resources. Do not label this as a confirmed migration error, port conflict, Docker outage or425 product defect.

Evidence: PREPARATION.json (exact commit, source archive/config and153 migration hashes), STACK-START.json (exit1), STACK-STATUS-FAILURE.json (read-only status), prepare-runtime.mjs (exact wrapper), and FINAL-CHECK.json (final state). All are outside Git under the evidence root above. No credentials were loaded from existing environment files, printed, or persisted by this attempted run.

Product code/prompt/tests/schema are unchanged. Only this report is added to the candidate. Existing59721 stack, shared56322, main3110 and original source evidence were not operated on. Main next-env SHA remains083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd; candidate next-env remains4e4da12aa061aac172fb1bcb48e9b6e4b293080d2f494327925fdba8f39632ac. No product test/build rerun is needed for this report-only change. Diffcheck is recorded at commit.

Remaining: establish a working fresh owned stack, then execute the still-unspent live SEC/provider worker E2E. Neither Diana nor Axcelis has been assessed by a new model call in this task. No actual-provider E2E PASS, merge readiness or operational readiness. Stop for Main review as requested on failure.
