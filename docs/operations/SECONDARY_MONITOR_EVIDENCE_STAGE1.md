# Secondary Monitor alert evidence — stage 1 candidate

2026-10-14 KST. Candidate only; no integration, push or deployment.

## Narrow follow-up: explicit USD display

Continued from clean detached candidate `e11238a1c5e5a74d8b4565efdd1e1ba03257845b` in the same worktree. `formatSecondaryMonitorValue` reuses the existing Registry `display.numberFormat` currency contract for both stored FACT and expected condition value, with the explicit currency code: `USD 1,437,000.00` and `USD 1,000,000.00`. Shares, dates and other non-currency values keep their previous presentation. No numeric, comparison, schema, migration or saved-evidence changes.

Evidence: `C:/Users/PC/AppData/Local/Temp/secondary-monitor-usd-7f32/`. Relevant tests36/36, full typecheck, production build and diffcheck PASS. Normal existing owner/other login plus anonymous were rechecked at 1440x900,900x900 and exactly390x900; USD appears on both amounts, saved25000/FACT30000 remain distinct from current35000. Owner API returns the unchanged snapshot, other returns zero and anonymous401. The owner actually clicked the internal filing link; the accession-bound SEC href was checked without refetching SEC. All three owner screenshots were visually inspected; no overflow, signed-in console/page/HTTP errors0. No real Pro-account test is claimed.

The full-row hashes of all172 public product tables (including the snapshot column), original XML SHA, existing FACT and alert records are unchanged. Only normal auth sessions changed. No new Monitor/Alert, provider, worker, message or DB DDL. The temporary guard permits no product writes; bootstrap upsert attempts to existing profile/subscription/preferences/channel tables are deliberately blocked. They are guard events, not successful writes or browser errors. An initial server-connection interruption was discarded and verification repeated against the maintained foreground server session.

Keep the final3147 candidate server running for independent parent review, using isolated API59621/PG59622. The final commit, PID, build ID and target are recorded in the evidence folder's `environment.json`, `owned-process.json` and completion report. No main/shared environment or server was operated. The main/GitHub/Vercel non-equality and remote-state limitations below remain in force.

## Scope and contract

The first adapter connects Form144 to a small shared `secondary_match_evidence` display snapshot on the existing `user_alert_deliveries` table. The existing ownership conjunction now returns the exact matching row index. The consumer copies that row's direct facts and the evaluated conditions into the alert INSERT. Matching, eligibility, activation, dedupe, compiler, extraction and delivery policy are unchanged.

`secondaryMonitorEvidence.ts` validates the snapshot and exposes `stored`, `partial`, `not_preserved` or `invalid`. The owner-scoped listing alert API reads only stored evidence. It never reads current Monitor conditions or current FACTs to reconstruct an old alert. The snapshot binds event/raw/execution/accession, parser version, original XML hash, row index, filing/persistence/evaluation times and individual condition/FACT pairs. Mixed conditions without a stage-1 FACT adapter are explicitly marked `not_preserved` within a `partial` snapshot.

The company name comes from retained filing metadata only when accession, form, source URL and exact original XML SHA agree. The ticker reuses the official reader's canonical row and verified issuer ticker binding. There is no CIK lookup, first-security selection, new source parser, provider call, Primary prose/score fallback or numeric calculation. Missing company/ticker stays unconfirmed.

The shared display shows the company/ticker, form, filing timestamp with timezone, accession/row, direct facts, saved conditions, evaluation time and evidence status. Form144 is explicitly a proposed-sale notice, not an executed sale or sale proceeds. The internal filing URL uses the existing route; the SEC link must identify the same accession on `https://www.sec.gov/Archives/edgar/data/` and have no credentials/query/fragment. Missing URLs are not synthesized.

Legacy generic alerts show that match evidence was not preserved. They receive no update/backfill. Existing Form4 purchase, OfferingPlan, EFFECT and NT detail branches retain their behavior. Other generic families are not newly connected to evidence or given reconstructed identities/titles.

## Migration and isolation

- New migration: `20261013155644_secondary_monitor_match_evidence.sql`. Apply before running the new list API/consumer; the list projection requires the new column.
- One nullable JSONB column, a lane/lineage constraint and an invoker trigger; no RLS, grants, existing migration files, dedupe keys or external delivery changes.
- The trigger prohibits changing evidence, assigning evidence to legacy rows, owner/execution reassignment and non-null Monitor/event reassignment. Existing nullable FK removal semantics are retained.
- Only the authorized isolated `nt-positive-e56cf806` API59621/PG59622 was used for application/DB checks. Its candidate-owned additive objects were applied/refined with direct SQL; its migration history table is absent. No migration-history repair was attempted.
- Existing data were preserved. Exactly one test Monitor and one internal alert were added; the owned Monitor's conditions were later changed through the normal API. All other 170 public tables, original raw/FACT/AI rows, existing Monitors and old alerts were unchanged. All 172 public tables were checked.
- No environment files changed. Isolated Supabase credentials and external-send/provider disable settings were passed only to child processes. No secret values are recorded here. No shared-main/remote DB writes, external messages, provider calls, new accounts, role changes or backdating.

## Acceptance evidence

Local evidence directory: `C:/Users/PC/AppData/Local/Temp/secondary-monitor-7f32/` (not committed).

| Check | Result / evidence |
| --- | --- |
| Retained actual AMCOR source | Accession `0001959173-26-000698`, event `ea10cbc7-28d3-4973-9ab9-933306c318b4`, raw `b183769d-489a-42f9-9e5a-5dc5280e7357`; XML SHA `a83d8706796bb864027f5cbfad20533f5214a34badfe4e67bb665827820baba8` unchanged |
| Original official reader | Available Form144: Common, 30000 proposed shares, 1437000 aggregate market value, NYSE, 2026-02-06. `official-reader.json` |
| Normal login/save | Existing ordinary owner account; POST201 and list200, no account or role changes. Monitor `2270f156-6c5e-4ae0-936c-b3869c57eb7d`; `monitor-created.json` |
| Production consumer | Default production reader, active-Monitor list, Matcher and writer; created1/failed0. Alert `22858f00-e65b-466a-ada8-8435bc3fc26b`. `evaluation-proof.json`, `alert.json` |
| Same-event replay | Created0; existing new and legacy alerts unchanged. Original event remains the ownership execution identity; no invented analysis run |
| Condition change | Normal owner PATCH: shares threshold25000 →35000, then production Matcher no_match. Historical alert still threshold25000 / FACT30000, byte-for-byte unchanged. `condition-change-proof.json` |
| Immutability/backfill | Direct snapshot mutation and filling the legacy alert both rejected. Existing alert `723d1ac4-dc27-4ff2-9cf0-218028d83926` stays unchanged/null |
| API ownership | Exact-Monitor list: owner200/one, other200/zero, anonymous401. `api-isolation.json` |
| Actual browser | Owner/other normal password login, anonymous; 1440x900,900x900,390x900 (9 views), exact new alert ID visible only to owner, no document overflow; signed-in console/HTTP errors0. Anonymous protected Monitor401 responses are expected. `browser-complete.json`, `*-browser.json`, `owner-*.png` |
| Real filing route | `/filings/ea10cbc7-28d3-4973-9ab9-933306c318b4`200 and actual filing DOM in all three states. Existing public filing access is separate from owner-only alert evidence. `*-filing-route.json` |
| Existing detail regression | 15 browser-only response-fixture views across Form4 purchase/OfferingPlan/EFFECT/NT/invalid evidence at all three sizes, no overflow/page errors or product writes. `synthetic-regression-complete.json`, `regression-*.png`. These are UI regressions, not fresh filing-family E2Es |
| Source/data preservation | `migration-proof.json`, `migration-proof-final.json`, `final-integrity.json`; original/FACT/AI hashes and existing records preserved, sends0 |
| Automated checks | 49 new/Matcher/API/consumer +85 existing focused tests PASS; full TypeScript check PASS, production build PASS, diff whitespace check PASS |
| Known unrelated failures | Explicit rerun of the unchanged socialVerification +mutationOriginInventory files:12 PASS/2 FAIL (creator page title expectation and cron-wrapper static regex). Failure targets are unchanged from base; expectations were not weakened |

Screenshots were visually inspected, including the real AMCOR/legacy display and the existing Form4/OfferingPlan/EFFECT mobile details. Browser result files were saved before bounded browser shutdown. Test tooling is local-only and not part of the candidate.

## Boundaries and follow-up

- This proves retained original/official-readback evaluation, not fresh SEC ingestion or a new provider execution. The five literal existing conditions were submitted to the existing API; no natural-language compiler E2E was performed.
- Generic Form144 still has no filing-time activation guard. This stage does not add, weaken or backdate one. Relative-date semantics remain evaluated at the recorded processing time.
- No real Pro account was available/tested. No Pro result is claimed; plan/access code is unchanged.
- SEC remote availability was not re-fetched. The exact retained XML and accession-bound URL are the source evidence. The existing filing detail route was actually verified; isolated market-data unavailability on that page is outside the new alert display.
- Follow-up adapters: general Form4, ListingRisk, CorporateAction, Proxy, Tender, S4/F4. Evaluate composing existing Form4Purchase/OfferingPlan/EFFECT/NT detail headers only in a separately scoped stage. SC13 and financial remain separate storage/APIs and are not connected to `/alerts` Custom here. No backfill is planned.
- Main integration must independently inspect this candidate and replay the critical journeys. This report never authorizes merge.

## Required handoff state

- Candidate root: `C:/Users/PC/.codex/worktrees/7f32/US-Stock Radar`, original detached HEAD/base `219a086f822d340b4a0f5945bf28b9961cb1a260`. No branch/worktree repointing.
- Permanent integration root: `C:/Users/PC/Documents/Codex/US-Stock Radar`, main-only lock. No commands were run with that root as working directory and no files there were changed by this task.
- Local main ref, read from candidate: `219a086f822d340b4a0f5945bf28b9961cb1a260`.
- GitHub main, verified via `git ls-remote`: `aef4d35221c9744c3a3f47518c492212f678e582`. Local/GitHub equality: **no**.
- Vercel: not rechecked; handoff's last reported `bf586ed559c7f4bea6a171790ab7b563cabc7161` READY is historical, not a current deployment assertion. Three-way equality is unverified.
- Main/remote migration, environment, external services and cron were not rechecked or changed. Main's previously reported user `next-env.d.ts` change was not inspected or altered. Other worktrees, F1/Offering tasks and their candidate commits were not inspected or modified.
- Only owned candidate server3147 was started/restarted. At the final read-only listener inventory3110/3124/3126 were not present; their prior/owner-controlled lifecycle is unverified. This task did not stop/restart them and must not attempt to repair them.
- No merge/push/deploy authorization or action. Stop after the clean candidate commit; the integration chat decides the next stage.
