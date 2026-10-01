# Listing Status provenance revalidation — 2026-10-01

Base: `082b43a01ea44d8a590f842c719d629d56efca12`, detached candidate
`C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.

## Actual cause

The history reader compared the complete retained raw envelope and the complete
current Listing Risk result with each historical snapshot. Two different changes
were therefore conflated with a changed SEC document:

- Fetch/index/receipt metadata, padded CIK, same-day receipt timestamp, added
  uncited documents and enrichment changed while the cited primary bytes did not.
- A new Listing Risk execution changed run lineage and some fact provenance /
  explanatory fields. The historical typed observations were no longer the
  current analysis, even though their canonical event/scope/date claims matched.

The SCPX primary document remains SHA-256
`574a009360ec15ec02606855aa634a50b8f3aac2217bc590bed6e7edc90b5579`, accession
`0001079973-24-000891`. No SEC source modification was found for this case.

## Reader-only change

For 8-K/6-K observations, a changed envelope is accepted only after checking the
retained primary cover and every cited document: exact SEC accession/CIK URL,
identical bytes/hash, unambiguous document selection and no truncation/fetch
failure. Filing date, form, raw identity and snapshot hash remain checked.
Form 25 source semantics are unchanged. Attachment revalidation uses the retained
snapshot after these document checks; it still uses the existing identity reader.

Pure execution-lineage refresh is reported separately. Other changed analysis
remains invalid in history. It can be excluded from projection only with an
independently usable, newer, attached observation for the same retained filing,
exact scope, event classification, rule, dates and canonical claims. The old
stored summary must also pass recomputation. The existing revalidation exclusion
record includes the old observation/hash and the replacement observation/hash.
Missing replacement, unknown scope, unrelated issue, changed status/date, changed
source or failed validation cannot use this exclusion. This does not close a
separate event or replace SEC facts with model prose.

No table, permission, migration, source record, historical observation or review
decision was modified. Exclusions and provenance annotations are read results.

## SCPX historical rows

| Observation ID | Finding and disposition |
| --- | --- |
| `56b6e2f4-89a4-4de4-86d1-df55916bbae2` | Older attached typed analysis; still `listing_evidence_changed` in audit, excluded from projection only against validated duplicate `69c04d83-aa5a-4f58-9f0d-2888f504cd0b`. |
| `cf73184d-d433-4afa-9a9b-3de60dd3626b` | Older typed analysis with unavailable identity; same exact scope/claim, same validated duplicate exclusion. |
| `81501c23-b565-462c-ba42-0e2842b69991` | Older typed analysis with no exact scope; remains invalid, no replacement certificate. Its existing human date decision is preserved. It is not attached/projected by this fix. |
| `4d96ad4e-68c5-4747-9188-7aa57d2bf9c8` | Source suspension observation; cited bytes unchanged, wrapper refreshed; usable after source and identity revalidation, no exact suspension date. |
| `8d7077c7-f69a-46d2-8f3e-5e225302e349` | Source removal decision; unchanged cited bytes, usable after revalidation. |
| `9cdafdb8-462d-4964-bb7d-09894092e685` | Same source removal decision, usable after revalidation. |
| `b635239a-64e8-45bc-bcc3-b36a8fd40a37` | Same source removal decision, usable after revalidation. |
| `91bd7e0e-4cd3-45c5-b62d-55dfcf9ca89a` | Older fixture-era source observation with unsupported June 14 operative suspension date; `observation_facts_changed`, preserved and excluded by the existing summary-revalidation mechanism. |
| `69c04d83-aa5a-4f58-9f0d-2888f504cd0b` | Latest real product execution; independently usable and attached, unchanged. |

Old typed provenance differed at `fact_provenance[5].evidence`, `[6].as_of`,
`[7].as_of/evidence`, `[12].origin`, continued-trading value quality and the
listing-requirement description, besides parent/run/persistence timestamps.
The raw snapshot itself was identical for those typed records. They are not
relabeled as historically valid merely because a replacement exists.

## Actual persisted-data verification

Isolated API 57321 / PostgreSQL 57322, verified system identifier
`7689949482832261158`; no main/shared-local writes.

- Latest live scope: Common Stock / NYSE American LLC, identity
  `9a45f886-e49d-5972-a63f-6ca17ce0bd02`. As-of June 17 no longer contains
  `listing_evidence_changed` as a projection blocker; two excluded duplicates
  remain enumerated. Both axes remain unresolved and operative dates null because
  the latest accepted automatic result does not establish them. This is not a
  positive status assertion.
- Retained source-event scope: common stock / NYSE American. June 17:
  `removal_pending`; July 30: `removal_decision_withdrawn`, withdrawal notice
  July 29. Only linked removal observations close. Trading remains unresolved,
  no global ACTIVE/relisting/resumption. These are separate existing scope queries;
  this task does not add security-title/exchange alias aggregation.
- Two existing automatic-writer replays returned the same latest observation ID
  with `replayed`. No additional LLM or live product job was started.
- All 21 stored observations, including all 9 SCPX rows, all evidence snapshots,
  the raw source and the one human review were identical before/after. Repeated
  reads were identical and did not append decisions.
- Read-only repository fault injections on actual retained data (changed document
  bytes / forged snapshot hash) invalidated all affected observations. Neither
  variant received duplicate-exclusion certificates. No DB tampering was used.
- Focused Listing Status, cover, identity and deterministic state regressions:
  **138/138**, none skipped. Full TypeScript `--noEmit --incremental false`: PASS.
  Git whitespace check: PASS.

Evidence outside Git:
`C:/Users/PC/.codex/visualizations/2026/10/01/listing-status-provenance/`:
`before.json`, `comparisons.log`, `after-read.json`, `verification.json`,
`inspect.mjs`, `read.mjs`, `verify.mjs`, `regression-final.log`,
`typecheck-final.log`. Earlier failed fixture-test logs are retained separately;
the final log identifies the corrected complete regression run.

## Scope / handoff

This resolves the reported stale-history blocker for canonical Listing Status v1;
the bounded backend history layer can be frozen with unresolved states intact.
It does not certify a fully resolved security-wide status or Monitor E2E: the
previous live Monitor's separate `sec_amendment_current_state_invalid_root_identity`
readiness limitation remains unchanged. No new browser check is claimed for this
reader-only task; prior authenticated UI evidence is preserved. No new provider
calls, prompt changes, migration, permissions, accounts or service changes.

Local main ref: `0b75ffcf573b64fcf030fde432d594bfa9f487ae`.
Cached origin/main: `9c13aee7ef41b38bac0637e53e579633745effda`.
Live GitHub main and Vercel deployment commit/status unverified; code equality,
merge, push and deployment are not claimed or authorized here.
Review server 3115 and isolated data preserved. Existing generated
`next-env.d.ts` is excluded from the commit. No environment/cron changes.
