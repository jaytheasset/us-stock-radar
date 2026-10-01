# Listing Status: live exact cover attachment

Candidate base: `49f2533d95290a01c205498dccf7b8aa57cac901`.
Workspace: `C:/Users/PC/.codex/worktrees/listing-status-audit/US-Stock Radar`.

## Narrow change

The normal typed Listing Risk branch required literal equality between the
reported subject and the full SEC cover title. The existing exact cover-row
binding was only used by the source-event branch, including its DB check.
The normal branch now reuses that binding. The reported subject remains intact;
the attachment separately preserves the exact cover row, ticker, class, venue,
source hash, and existing canonical identity proof. The source reader receives
the verified cover scope while the typed facts keep their original scope.

A second live blocker was two preserved cover collections of the same SEC bytes
with different receipt metadata. Identity scans now validate each stored result
by its ID as well as accession/hash. They do not pick a preferred collection,
delete older rows, or bypass source revalidation. Existing conflicting-revision,
class/venue, sibling-security and changed-ticker checks remain enforced.

An unresolved `identity_evidence_unavailable` observation may expose a separate
revalidated stable attachment, just like the existing missing-identity cases.
The original observation is never rewritten, and this does not bypass stale
source/currentness failures or consume human date decisions as identity proof.

Migration `20261001002420_sec_listing_typed_cover_attachment.sql` extends only
the existing cover-binding check to the officially validated typed-facts branch.
No new table, permission expansion, model/prompt, Monitor, or UI changes.

## Real normal-path verification

Scorpius 8-K `0001079973-24-000891`, filed 2024-06-17:
<https://www.sec.gov/Archives/edgar/data/1476963/000107997324000891/scpx_8k.htm>.

One authenticated existing `/api/development/sec-live` controlled-persist job
on candidate port **3115**, with original dates and no analysis reset, performed
normal SEC ingest, fresh Primary, automatic Listing Risk child, typed persistence,
and automatic canonical persistence. No analyzer fixture supplied this live run.

- Router: 1 Gemini 2.5 Flash-Lite request; Primary: 1 Flash-Lite request;
  Listing Risk: 1 Gemini 2.5 Flash request. All HTTP 200 / STOP. Retry/repair: 0.
- Primary run: `65476822-90a6-4f6b-973a-5e1e89ef1a5e`.
- Child: `48657e08-121c-5ac0-ae3c-02a0be82495e`; workflow
  `wrun_01M3TDZZXCVJZGECHBTG47XR6W`, completed / succeeded_applicable.
- Automatically stored observation: `69c04d83-aa5a-4f58-9f0d-2888f504cd0b`.
  Official history read: usable, attached.
- Canonical security: `9a45f886-e49d-5972-a63f-6ca17ce0bd02`.
  Cover: **Common Stock, $0.0002 par value per share / SCPX / NYSE American LLC**.
  Stable proof uses SEC covers `0001079973-24-000635` and
  `0001079973-24-000767`, known by 2024-05-16. Sibling purchase rights remain.
- Two subsequent persistence replays returned the same observation; total
  canonical rows stayed 21 → 21. These were not additional model executions.
- Wrong class, wrong exchange and a forged cover ticker were rejected by the
  actual DB writer (`LISTING_STABLE_IDENTITY_MISMATCH`).
- Six pre-existing observations, human reviews and original SEC HTML unchanged.
  The migration itself left protected data and function ACLs unchanged.

## Deliberately unresolved results

Attachment success is not a claim that every status/date is established.
The fresh analyzer classified the event as trading suspension and again supplied
the June 14 notice date as its suspension date. Canonical operative-date
validation rejected that exact date; both canonical axes remain unresolved and
the original model facts/evidence are retained. No ACTIVE, relisting or resumption
was inferred. Human notice/unknown-date decisions remain separate and unchanged.

The full as-of reader additionally reports `listing_evidence_changed` for older
typed-analysis versions, with identity-unresolved reasons on an older retained
version. No history was removed or silently selected away to obtain a positive
projection. Live identity attachment is verified; a fully resolved security-wide
as-of result and unconditional Listing Status v1 freeze are **not** claimed.
Handling stale analysis history remains a separate limitation to resolve before
claiming that broader result.

The existing Monitor completed safely with zero alert writes. It reported
`sec_amendment_current_state_invalid_root_identity` / reader-not-ready and
unavailable targets. Monitor's separate event/ticker readiness was not changed by
canonical security attachment. Alert success is not claimed.

## Checks and evidence

135 focused Listing Status, ticker identity, cover and deterministic state tests
passed; full TypeScript `--noEmit --incremental false` passed. Tests include
multi-security ambiguity, wrong class/venue, actual ticker changes, source
tampering, repeated cover collections, human review and follow-up regressions.
Code was hashed before the live job and remained unchanged during it.

Evidence outside Git:
`C:/Users/PC/.codex/visualizations/2026/10/01/listing-status-live-attachment/`.
Contains original state, exact provider requests/responses, code freeze hashes,
official workflow/readback, replay and SQL negatives, migration preservation
checks, test and typecheck logs. No new browser verification was required or
claimed for this backend-only change; earlier UI evidence remains preserved.

## Handoff

Detached candidate only. Migration applied solely to existing isolated API
127.0.0.1:57321 / PostgreSQL 57322, system ID `7689949482832261158`.
Review server 3115 preserved; no configuration, account or Docker changes.
Local main ref: `0b75ffcf573b64fcf030fde432d594bfa9f487ae`.
Cached origin/main: `9c13aee7ef41b38bac0637e53e579633745effda`.
Live GitHub main and deployed Vercel commit/status unverified; no code equality,
merge, push or deployment claim. Main/shared-local migration not applied.
Pre-existing generated `next-env.d.ts` remains outside the candidate commit.
