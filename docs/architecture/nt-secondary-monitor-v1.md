# NT secondary Monitor v1

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

Only monitors created by the supported filing-day boundary may notify. Same-day
activation without time ordering is conservatively suppressed. Historical dates
are not rewritten. Existing unique `(listing_monitor_id, alert_event_id)` dedupe
is unchanged. There is no new external delivery mechanism.

## Verified real records (2026-10-01)

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

Validation reused the retained completed Primary runs; fresh Primary/secondary
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

## Resume boundaries

- NT 10-Q/20-F and amendments have parser/dispatch regressions, not fresh real
  full-product E2Es in this task.
- Positive live alert insertion/durable workflow transport, fresh periodic
  Primary execution and browser journeys were not verified here. Positive matching
  and repeated-delivery behavior were verified with the existing consumer in tests.
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

## Required environment handoff

- Local main: implementation is the commit containing this document; task base
  is recorded above. User explicitly requested implementation on local main.
- GitHub main: last locally recorded `origin/main` is
  `9c13aee7ef41b38bac0637e53e579633745effda`; remote freshness is not established here.
- Deployed Vercel commit: not queried; no deployment/equality claim.
- No push/deploy, server restart, Docker change, new migration, or external alert.
- Existing 3110 runtime, retained accounts, evidence and frozen families preserved.
