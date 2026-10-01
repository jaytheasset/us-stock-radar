# Amendment lineage filing-date contract — 2026-10-01

Candidate base: `8836f7298333eee2b21cb1ad51351abefdf6966e`, detached,
`C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.

## Narrow correction

Normal SEC ingestion writes `raw_payload.filing_date`; the amendment ledger RPC
read only `filed_date`. SCPX's valid non-amended 8-K therefore became a null-date
root before the empty-lineage fallback. This is an existing common lineage
contract defect, not a security-attachment or Form 25 policy defect.

- The ledger RPC and TypeScript bridge now accept an explicit `filing_date` or
  legacy `filed_date`. If both are populated they must agree. Empty/null fields
  are absent; missing, malformed, impossible-calendar and conflicting dates fail
  closed. `published_at` is no longer used to rescue absent filing dates.
- The existing parent lookup by date searches both spellings with OR, retaining
  issuer/form constraints, unique raw/event requirements and complete candidate
  revalidation. A conflicting row is not silently dropped to make another match.
  Lookup by accession is unchanged; its candidate date is still validated.
- New migration `20261001012244_sec_amendment_filing_date_contract.sql` replaces
  only `read_sec_filing_amendment_ledger(uuid)`. Original migration, function
  signature, stable/security-definer/search-path settings, ACLs and other ledger
  fields/queries remain unchanged. No data rewrite or new table.

No Listing Status v1, Form 25, Monitor policy, security identity, Primary, prompt,
Ownership or CUSIP/13F implementation was changed.

## Actual isolated verification

DB: API `127.0.0.1:57321`, PostgreSQL `57322`, verified system identifier
`7689949482832261158`. Only this isolated DB received the migration and its new
history entry. Main/shared-local and remote DBs were not changed.

Real SCPX accession `0001079973-24-000891`, raw
`702804d7-389d-4a95-83a0-48727db55a60`, event
`926b9590-8d1a-4d16-813b-0ea34d46eee0`:

- SQL ledger root now returns `filedDate: 2024-06-17`, observations/facts empty.
- Official amendment bridge returns `not_applicable`: normal empty lineage,
  not a bypass of failed validation.
- Official Listing Risk reader remains `available`, source execution
  `48657e08-121c-5ac0-ae3c-02a0be82495e`.
- Actual existing Monitor consumer ran once with its normal dependencies and
  nine existing monitors. Listing reader became `available`; the Listing Risk
  monitor `c3f8269d-023f-59b4-8a66-8caba39b53e9` returned
  `no_match / condition_not_met`, replacing `reader_not_ready`. Eight unrelated
  Ownership monitors remained `monitor_target_unavailable`; eight evaluation
  history records were appended normally. Alerts: zero writes, zero failures.
  No positive-alert or dedupe claim is made from this negative condition result.
- The real PostgREST parent-date OR lookup selected exactly the SCPX raw record.
- Seven SQL reader checks used isolated synthetic clones inside a rolled-back
  transaction: current spelling, legacy spelling, both equal, conflicting,
  absent, impossible date and malformed legacy date. The first three passed;
  others returned explicit date reasons. Existing raw records were not edited.
- All protected raw/AI/canonical Listing Status/review/security/lineage table
  hashes and the function ACL were unchanged. Only migration metadata and the
  consumer's normal evaluation records were added.
- New model calls, filing reprocessing, external notifications: **0**.

Regression: **194/194**, none skipped, covering amendment lineage, consumer,
automatic fanout, frozen Listing Status, identity, cover and deterministic state.
Real-source Enveric 8-K/A and Ostin 6-K/A fixture regressions passed with both
legacy and ingestion-only dates; amendment operations remain REPLACE and retain
the existing root alert identity. Full TypeScript `--noEmit --incremental false`
and Git whitespace checks passed. Browser work was not repeated for this backend
contract change; earlier authenticated candidate screen evidence is retained.

Evidence outside Git:
`C:/Users/PC/.codex/visualizations/2026/10/01/amendment-date-contract/`:
`before.json`, `migration.json`, `reader-checks.json`, `consumer.json`,
`runtime-2.log`, `regression-final.log`, `typecheck-final.log`, `verify.mjs`.
`runtime.log` retains an initial harness-only snapshot query failure (the lineage
table has no `id` column); it occurred before migration or consumer execution.

## Integration handoff

The reported Monitor root-date blocker is resolved. This task adds no new known
integration blocker; migration application on the approved integration DB and
the normal independent merge checks remain required. A no-match is not an alert
failure or a new live provider E2E verification.

Local main ref: `0b75ffcf573b64fcf030fde432d594bfa9f487ae`.
Cached origin/main: `9c13aee7ef41b38bac0637e53e579633745effda`.
Live GitHub main and Vercel commit/status unverified; equality not claimed.
No merge, push or deployment. Candidate server 3115 preserved; no environment,
credential, cron, permission or Docker/service change. Generated `next-env.d.ts`
remains outside the commit. Listing Status v1 remains frozen.
