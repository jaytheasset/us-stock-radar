# O/S Snapshot history publication — candidate

Base: `aef4d35221c9744c3a3f47518c492212f678e582`.

This change connects a saved O/S Snapshot to the existing `share_count_history`.
It does not extract new values, calculate projected dilution, change Primary,
apply Dilution Registry instruments, or introduce another approval workflow.

## Eligibility

- Independent O/S completion and terminal replay, combined completion and replay,
  and the existing O/S administrator approval route invoke the same publisher.
- The publisher revalidates the persisted output, contract, original response
  hash, current source fingerprint, exact run identity, and combined parent and
  child where applicable. A superseding invocation makes the previous invocation
  ineligible. PASS records or explicitly approved REVIEW candidates are eligible
  for further evidence checks; hold, reject, unapproved REVIEW, and failed or
  mismatched results are not.
- This first version accepts only `scope=class` with the exact unqualified
  labels `Common Stock`, `Common stock`, or `common stock`, a directly stated
  date, and a positive integer share quantity. It requires the exact SEC filing
  ledger/document/acceptance and an existing eligible COMPLETE_SINGLE common
  class universe. Issuer totals, named classes, ordinary shares, ADS, missing
  dates, and ambiguous class evidence are omitted without inference.
- Only cited source blocks are considered. Exactly one distinct bounded excerpt
  must pass the **unchanged** manual O/S semantic validator for the saved
  quantity/date/class/unit and actual outstanding status. Mixed future/current
  wording can remain unavailable. No excerpt is rewritten to bypass validation.

## Storage and reads

The new source type is `sec_os_snapshot_verified`, with publication contract
`os-snapshot-history-publication-v1`. It is neither human verification nor an
XBRL authority decision. Provenance records the raw/run/parent IDs, exact output
and raw hashes, contract/schema/source fingerprint, selected record, existing
decision ID, ledger hash, and class-universe ID/hash.

`publish_os_snapshot_share_history` rechecks the live source and decision under
locks and atomically appends a bounded batch using the existing source uniqueness
constraint. Replaying an unchanged result deduplicates it. Publication failure
does not roll back or rewrite the completed AI output; the exact saved-run replay
retries publication without another provider call.

`share_count_history_eligible` is a service-role-only, security-invoker view over
the existing history. It preserves existing source rows and excludes invalid
automatic publications at read time. It is not a latest-value cache. Physical
history is retained when source/decision eligibility changes. Shared PostgreSQL,
manual upload, and stock readers use the view; the existing latest-as-of and
same-date conflict rules remain in the resolver.

Manual JSON, Preview, Apply, Registry-only input, and independent partial-success
semantics remain unchanged. No `source_review` field or manual override is added.

## Migration and verification boundary

Migration: `20261013085610_os_snapshot_share_count_publication.sql`.
Apply before code that reads the new view. Existing source-specific CHECK
expressions are retained, with a strictly constrained branch for the new source.
No existing observations or prior migration files are rewritten. New RPCs and
view are unavailable to anon/authenticated and available to service_role.

Candidate verification on 2026-10-13 used only the owned local API/Auth 56461 and
DB 56462, system identifier `7694629360856297510`, and candidate server 3121.
No shared/remote migration, provider call, real worker queue, external delivery,
push, deployment, or main merge was performed.

Evidence is outside Git in
`C:/Users/PC/AppData/Local/Temp/os-auto-publication-1f6c-20261013`:

- `final-regression.log`: 411 passed, 4 pre-existing optional fixture skips,
  0 failed, across 47 files. This includes the seven new publication unit tests,
  manual/Registry/history, O/S, Offering, combined runtime, Alert and filing tests.
- Typecheck and production build passed; `next-env.d.ts` and `tsconfig.json`
  hashes matched their pre-build copies. `git diff --check` passed.
- `db-results-1791883549573.json`: 13 synthetic DB checks covering automatic
  completion/replay, failed-write recovery, concurrent dedupe, latest-date and
  conflict resolution, stale sources, unsupported inputs, and approval/hold/reject.
- `manual-atomic-results.json`: original manual JSON through Preview and the real
  server writer, both first saves, replay, Registry-only, invalid O/S partial
  result, DB batch rollback/retry and database role checks passed.
- `combined-publication-results.json`: fully synthetic combined source stored
  1,000 shares dated 2026-01-30; terminal replay inserted zero additional rows.
  Its initial completion assertions are in `supplemental-db.mjs`; that broader
  harness later failed an incorrect expectation that an empty Registry input
  should report saved. The dedicated manual harness uses a real test instrument
  and passed. These are synthetic results, not real-issuer positive evidence.
- `original-integrity-results.json`: two retained raw rows, five original runs
  and five original outputs still match the prior recorded hashes.
- `immutable-status-results.json`: database immutability guards rejected changes
  to completed combined-parent and O/S-child status; no guard was disabled.

### Real retained evidence: not a positive publication test

Original iBio/PureCycle/Silvaco/Canaan results remain unmodified. Initially the
owned database lacked their exact ledger records. A further retained-file audit
found authentic iBio and Silvaco submissions JSON; only their exact two ledger
entries and source bodies were imported locally, with hashes recorded in
`real-retained-ledger-results.json`. No ticker/current pointer was published and
no SEC request was made. Both still omit publication with
`NO_UNIVERSE_SNAPSHOT_AVAILABLE`. No class universe was fabricated for real CIKs.
PureCycle and Canaan remain without exact ledger support in this database.

The retained iBio excerpt also contains future-offering wording; a separately
labelled synthetic-identity replay with the original HTML was conservatively
withheld by the existing semantic validator. This is not a product extraction
failure and the original result was not corrected.

### Authenticated manual upload browser gate

This task's browser tool currently resolves the user-visible 3121 tab to a
`data:` connection-error page and rejects selecting it under its URL policy.
No token injection, alternate browser surface, or policy bypass was attempted.
The main task independently used its already accessible candidate tab and
existing authenticated session for the original manual upload journey:

- `browser-upload.json`: Preview Verified, Registry Saved, O/S Saved.
- Repeating Apply: Registry Already Saved, O/S Already Saved.
- `browser-registry-only.json`: Registry Saved, O/S Skipped.
- `browser-partial.json` (2,001 vs source 2,000): Not Verified, Registry Saved,
  O/S Skipped.

`main-browser-readback.json` and four `main-browser-*.png` screenshots record
this check. The candidate independently reread the database afterward:
one eligible human-verified history row, ID 20, exactly 2,000 shares dated
2026-01-31, plus three test Registry instruments; no 2,001-share row.
The main task reported zero console errors. This resolves the manual upload
browser gate, not the real-issuer automatic publication positive gate.
Full viewport and account/plan matrices were not performed in this step.

The existing UI contains “These rows are never saved…” wording inconsistent
with its existing Saved behavior. This pre-existing copy is unchanged; no UI
redesign or correction was included in this connection-only step.
This document does not grant merge approval.
