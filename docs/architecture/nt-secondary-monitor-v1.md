# NT secondary Monitor v1

**Frozen at `d531571294eeb282be948b0f9a3dffe56f82cf9d` (2026-10-01).**
Preserve this implementation unless a later explicit product requirement or
demonstrated defect requires reopening. This freeze records a bounded local
verification, not complete family coverage or production deployment.

Implemented on local main from `c9b0d1994eaabc38bde7e7f8fe811f2c6a8c72ab`.
This is deterministic notice/report lifecycle support, not an assessment of the
issuer's financial risk, statutory deadline compliance, or investment significance.
Listing Status v1, Ownership, CUSIP/13F and the existing Primary prompts are unchanged.

## Product path

- Existing ingestion retains SEC original documents and submission identity.
- After an authorized `sec_nt_analysis` Primary completes, the existing generic
  child starter reserves `nt_lifecycle`. It does not consult GPT routing output.
- Original/amended 10-K, 10-Q and 20-F processing also schedules this deterministic
  child alongside the unchanged periodic-financial child. 40-F is unchanged.
- `ntLifecycle.ts` reuses the NT parser and ingested DEI observations. It records
  exact source identity, filing day, report period/evidence, source URL/hash,
  amendment/ambiguity reasons and an optional notice/report pair.
- `ntLifecycleRuntime.ts` persists typed results through the existing generic
  `ai_runs` / `ai_outputs` terminal-result contract. No table, permission change,
  migration, new prompt or provider call is required.
- `readCurrentNtLifecycle` revalidates the current exact Primary/child lineage,
  output envelope and retained source/candidate facts. It never substitutes
  Primary prose or the older `filing_context.nt_lifecycle` metadata.
- Existing condition registry, owner-scoped `user_monitors` persistence, matcher,
  Listing Monitor consumer and `user_alert_deliveries` event dedupe are reused.
  The generic listing domain/lane is infrastructure, not a Listing Status fact.

## Exposed conditions and linking

- `nt.notice_filed = true`: the current filing is a validated NT notice.
- `nt.report_filed = true`: the current filing is an original periodic report
  uniquely linked to a preceding NT notice. A notice may expose its follow-up in
  readback, but never emits that report's notification too.
- `nt.issuer_cik`: optional exact ten-digit issuer scope.

Linking requires the same explicit issuer CIK, report kind, unambiguous reporting
period, one notice and one original report, and a strictly later filing day.
No ticker/name fallback, first-candidate selection, or filename-derived period.
Explicit DEI `DocumentPeriodEndDate` observations accept meaning-preserving date
normalization, including month-name dates. Conflicting periods remain unresolved.
Same-day order, multiple candidates, partial/amended or transition-report
relationships, and unreadable possible counterparts remain unresolved.

An independently readable NT amendment can establish its own notice fact, but
this version does not automatically close an original notice through amendment
lineage. Periodic amendments do not establish a newly filed original report.
An unresolved/absent completion is null, never false or "still missing".
Neither Part IV answers nor 5/15-day constants establish a deadline or completion.
In particular, never calculate an exact due date by adding those constants to
the NT filing date. Absence of a local follow-up is not proof of non-filing.

Only monitors created by the supported filing-day boundary may notify. Same-day
activation without time ordering is conservatively suppressed. Historical dates
are not rewritten. Existing unique `(listing_monitor_id, alert_event_id)` dedupe
is unchanged. There is no new external delivery mechanism.

## Initial persisted verification (2026-10-01; retained evidence)

Explicit local main DB: `127.0.0.1:56322/postgres`, system identifier
`7678429483712069671`. No other DB/environment was used.

| Filing | Result |
| --- | --- |
| Karbon-X NT 10-K `0001477932-26-005311`, 2026-08-28 | Notice preserved; report period 2026-05-31; linked to subsequent original 10-K |
| Karbon-X 10-K `0001477932-26-005627`, 2026-09-15 | Collected through existing `runSecRawIngest`; source DEI confirms 2026-05-31 period; unique ordered match |
| CXJ NT 10-K `0001493152-26-040484`, 2026-08-28 | Notice preserved; this parser could not establish its report period; follow-up remains unresolved |

Raw report added: `71549c38-d778-4c8a-b550-ea0eeb26b227`. Normal ingestion also
recorded its existing cover sidecar (`no_cover_facts`); no identity was fabricated.
Two NT condition-set monitors were created for the existing retained local review
user, scoped to CIK `0001729637`, using normal create/read APIs and current dates.
They remain available for review. No accounts or permissions changed.
Actual consumer processing blocks the historical notice by activation policy and
does not treat the notice as a second completion event. Zero alerts were created.

This initial validation reused the retained completed Primary runs; fresh Primary/secondary
LLM calls: **0 / 0**. It executed the production starter, generic repository,
processor, persistence, official reader and consumer with an **in-process workflow
transport**. It is not a live durable-worker/cron or fresh Primary E2E claim.
The later-report automatic dispatch and completion matching are covered by
focused regressions; no new Primary was run for the collected 10-K.

Rerunning the same child identity and repeated official reads produced no new
current-version result or alert. Earlier verification contract revisions are
retained: v1 missed the ingested rendered DEI date; v1.1 preceded separating
completion notification ownership. Final contract is `nt_lifecycle_v1.2`.
Those historical outputs are not overwritten or selected by the current reader.

Evidence outside repository:
`C:/Users/PC/.codex/visualizations/nt-lifecycle-20261001/`:

- `ingest.json` plus SHA-256: normal SEC collection outcome.
- `final-verified/result.json` plus SHA-256: persisted sources/results, exact run
  IDs, official readback, actual consumer decisions, duplicate rerun and counts.
- `final-regression.txt`, `final-typecheck.txt`, `baseline-matcher-assertion.json`.

Focused suite: **149/150** passing. The remaining failure is the existing
`listingMonitorMatcher.test.ts:518` broad negative source regex: it rejects the
pre-existing `Form4PurchaseMatchEvidence` identifier. The identical assertion was
checked against read-only `git show` of the pre-task commit and also fails there;
this was not a complete baseline test rerun. Do not confuse this with the separate
historical `monitorPresets` failure documented by the Listing Status handoff.
Full TypeScript and diff check pass. No tests were deleted or relaxed.

## Verified automatic durable product path (2026-10-01)

At the frozen commit, the existing main server on port 3110 processed Karbon-X
NT 10-K `0001477932-26-005311` through the normal authenticated SEC ingest and
analysis endpoints. Ingestion fetched one SEC document and reused the existing
raw accession without duplication; this was not first-ever raw insertion.
Retained original HTML hash, accession and filing date were unchanged.

The analysis endpoint was started once with the existing `force:true` and
`suppressAlerts:true` options. Only Primary delivery was suppressed; automatic
secondary evaluation and existing activation/dedupe rules remained enabled.

| Stage | Actual result |
| --- | --- |
| New Primary | `27bac253-91bd-47e2-a1c6-8f18c2fa4168`, completed; `gemini-2.5-flash-lite`, `sec_nt_analysis/v6-material-results-floor` |
| Actual provider calls | Primary 1; retries, repair, router and secondary LLM calls 0; HTTP 200 |
| Automatic durable child | `febc4ab0-b375-5018-ab9f-531226cdba03`; workflow `wrun_01M3V9EAT4VX3QB43V4H89Y56V`, completed; step attempt 1 |
| Typed persistence / official reader | One new Primary and one new secondary output; `readCurrentNtLifecycle` returned the new child as `available` |
| Follow-up lifecycle | `linked` to original 10-K `0001477932-26-005627`, filed 2026-09-15, same CIK `0001729637` and period 2026-05-31 |
| Notice condition / alert | Fact conditions matched; actual consumer returned `monitor_activation_not_met` because the 2026-08-28 notice predates monitor creation; zero alerts |
| Completion condition on the NT event | `fact_unavailable`, intentionally: the later report's own event owns completion notification |
| Same-child reservation replay | `duplicate`, no new workflow; repeated official readback identical |

Runs/outputs/alerts were 4/4/0 before, 6/6/0 after fresh processing, and 6/6/0
after replay. Historical rows were preserved. Actual provider usage was 3,951
input and 1,186 output tokens; provider attempt 4,003 ms. This run used the real
durable workflow transport, unlike the initial in-process verification above.

Authenticated browser checks covered the fresh
`/filings/fe72e129-4de2-40af-82ce-bfafd18af8af`, `/monitor`, `/alerts`, and
`/admin/alerts`. The two saved NT monitors and zero Monitor alerts survived
refresh. Admin delivery operations rendered, but there is no NT-specific
lifecycle/evaluation detail screen; its empty queue is not processing proof.
Use the durable return and official reader for the actual NT decisions.

Evidence outside Git: `C:/Users/PC/.codex/visualizations/nt-live-durable-20261001/`.
`completion.md` indexes the actual ingest/analysis responses, provider trace,
durable run/step records, official readback, before/after/replay snapshots,
SHA-256 files and saved browser screenshots. `verification-summary.json` records
call counts and source/count invariance. This documentation update reuses that
evidence; it does not execute another analysis or test.

The live verification reran focused regressions (**149/150**, same unrelated
Matcher static assertion above), full TypeScript (pass) and diff check (pass).

## Resume boundaries

- NT 10-Q/20-F and amendments have parser/dispatch regressions, not fresh real
  full-product E2Es. Do not generalize the Karbon-X NT 10-K result to all forms.
- Positive live alert insertion remains unverified: historical activation policy
  correctly blocked it. Positive matching/delivery dedupe have regression coverage.
  The later periodic report's fresh Primary/child and cron scheduling also remain
  unverified. Do not confuse a real durable child run with a scheduled collector run.
- Re-ingesting the NT notice reported auxiliary SEC cover
  `caller_stored_identity_mismatch`: the fresh caller and retained raw snapshot
  failed that sidecar's exact comparison. The precise differing field was not
  isolated. NT does not depend on this sidecar; original source and official NT
  readback passed. Preserve this separate issue without relaxing identity rules
  or claiming the entire ingestion path was warning-free.
- The existing Matcher source-text assertion still fails on the pre-existing
  `Form4PurchaseMatchEvidence` identifier; it is not an NT regression. No test was
  relaxed. No NT-specific admin detail view was added.
- Local collection is incomplete: absence cannot establish failure to file.
- A newly collected or changed counterpart can invalidate an old snapshot's
  official readback. Do not silently mutate that stored history. Later periodic
  processing creates its own child; a new authorized Primary execution can refresh
  the notice. A general raw-only backfill/reconciliation service is deferred.
- No statutory deadline calculator, automatic missing-report alert, new UI, or
  amendment consolidation policy is introduced.

Run the bounded local verifier using the existing TS resolver and
`--import ./scripts/resolve-server-only.mjs`; pass an outside-repository evidence
directory. `--ingest-followup` only collects the one documented accession.
It preserves credentials locally and deliberately has no provider/delivery setup.

## Next candidate: S-8 / S-8/A audit only

The [main handoff](../operations/ASTRA_6_MAIN_HANDOFF.md#later-monitor-families)
lists S-8/S-8/A after Form 25 and NT, before Proxy, Merger and Tender.
Current inventory at the frozen commit supports choosing it for the next audit:

- `lib/sources/sec/forms/s8/` already contains fetch plan, parser, adapter,
  source/analysis contracts, fixtures and tests. `formWorkerRegistry.ts` and
  `fetchPlanRegistry.ts` register it; `lib/ai/secS8AnalysisAdapter.ts` supplies the
  existing Primary path. This is not a request to rebuild those components.
- `lib/monitor/genericMonitorChildWorkflowStarter.ts` has no S-8 source-family
  eligibility. `genericMonitorChildExecution.ts` has no S-8 analyzer contract.
- `lib/offeringMonitorJobFoundation.ts` limits automatic Offering identities to
  S-1, S-3/F-3 and 424B families with their matching Primary keys; S-8 is excluded.
  No S-8-specific condition/typed Monitor persistence entry was found in the
  current Monitor inventory. Existing Primary support is not secondary completion.

Smallest next step: a read-only S-8 source -> parser -> retained/typed facts ->
official reader -> existing Monitor consumer audit, including what already
exists for amendments, plan registration and reoffer facts. Establish reuse and
actual gaps before proposing implementation; do not infer issuance or realized
dilution from a registration merely to create a Monitor fact.

Roadmap ambiguity remains: the handoff calls its order historical, and no newer
definitive queue was found. S-8/S-8/A is the plan-supported next audit candidate,
not authorization to implement. Listing Status, NT, Ownership and CUSIP/13F
remain outside that audit unless a later explicit task says otherwise.

## Required environment handoff

- Permanent root: `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch `main`.
  Product freeze/task-entry HEAD: `d531571294eeb282be948b0f9a3dffe56f82cf9d`.
  The subsequent commit updating this handoff is documentation-only (see Git).
  Task entry was clean; only the requested documentation is committed.
- GitHub main: last locally recorded `origin/main` is
  `9c13aee7ef41b38bac0637e53e579633745effda`; remote freshness is not established here.
- Deployed Vercel commit: not queried; no deployment/equality claim.
- NT needs no migration. Last verified local DB is identified above; remote DB
  state is unverified. No DB query/write, account, env, runtime or cron change
  was performed for this documentation task. Other worktrees/unmerged branches
  were not re-audited. Source-ingest cron activation is not certified here.
- Validation this task: documentation references, evidence IDs, scope and diff
  whitespace only. Prior runtime/browser/typecheck results above are reused.
- No push/deploy, server restart, Docker change, new migration, or external alert.
- Existing 3110 runtime, retained accounts, evidence and frozen families preserved.
