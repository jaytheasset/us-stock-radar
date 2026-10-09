# Common Offering contract candidate — 2026-10-10

Base: `87221c5f72e1e66d0fe04d1fda8812776c8c58d9`, detached candidate
`C:\Users\PC\.codex\worktrees\1f6c\US-Stock Radar`. Main reference:
`a1ee8ac75ecbe075b9a3e2a814cee41a21a84515`.

## A — shared ATM contract

Acceptance: one shared ATM definition; frozen Offering r2/O/S bytes unchanged;
new F1 enqueue/provider/runtime use r3; historical full/compact bindings, reader,
recovery and decision provenance retain their recorded revision and hashes;
missing historical ATM field stays absent, distinct from new `[]`.
No coercion, monetary arithmetic, currency normalization, share conversion or
inference from shelf/form. No UI, migration, backfill, real extraction or DB writes.

`offering_plan_v1-output-r3` keeps the domain version `offering_plan_v1` and adds
required `plan.atm_terms` to all plans, including review candidates. The schema
is composed from frozen r2 and `contracts/atm-terms-v1/atm-term.schema.json`;
the exact composed schema and new prompt hashes are pinned in the r3 manifest.
Future combined response contracts must reuse this definition, not copy it.
Rows distinguish current/prior limit, remaining amount, directly stated increase
or decrease; preserve decimal string, original currency, date expression,
qualification, scope/basis, component and evidence references. Unresolved and
no-direct main plans have empty arrays. No special approval bypass is added.

New reservations select r3. Binding hydration and CLI input files select the
recorded revision, checking the recorded hashes; unsupported revisions fail
closed. Runtime validation explicitly passes the binding revision. The legacy
two-argument `validateOutput` API continues to mean r2, not guessed auto-detection.
The existing generic reservation SQL stores version/hash strings without a
revision allowlist; no SQL/migration change is needed for A. No SQL was applied.

Retained experiment plan excerpts (not F1 extraction results): Silvaco has
`35000000`, `20000000`, `30668720`, original `$`; Shimmick has prior `7800000`
and current `4986750`, without a computed decrease; iBio has `atm_terms: []`.
Full retained files remain outside Git. F1/F1A tests using ATM rows have explicitly
synthetic metadata/references and only establish contract shape/wiring.

Validation: Offering 45 PASS (31 existing + 14 new); O/S 37 PASS;
Projected/Monitor/Registry/Primary selection 331 PASS, 4 optional skips;
typecheck, production build and `git diff --check` PASS. Provider tests use injected
Node runners; actual GPT/Worker calls 0.
The isolated-DB verification script now uses real supported revisions and
distinct synthetic raw IDs rather than invented revision names. It was syntax
checked only; it was not executed because DB writes are outside this stage.
Approval provenance tests use a mock repository, not a new authenticated DB E2E.
No UI changed; browser/auth review is not claimed for A.

## B — next adapter stage

Implement a separate domestic source/input/response adapter and injected provider
boundary. One response, independently validated O/S and Offering domains, shared
identity and evidence, immutable original bytes. F1 still uses its two independent
paths. No automatic enqueue, durable domestic domain storage, migration, Worker,
real provider/SEC network invocation, Primary or Registry/Monitor expansion.
Original experiment refs/metadata must not be rewritten to pass the new product
contract. Retained experiment r1/r2 validation is a separate evidence exercise.

## C — main's deferred Projected integration decision (not implemented here)

Main assigned these follow-up boundaries after A/B review:

- Admin: add read-only `Projected offering impact` to the exact run detail in
  `app/admin/data/offering-plans/page.tsx`, with the matching O/S run link.
  Reuse existing evidence, approve/hold/reject and history; no new approval system
  or direct override of calculated values.
- Keep calculated/direct values, scenario, class, units and evidence side by side.
  Input approval does not dismiss a surviving calculation/direct conflict.
  Unresolved conflicting numbers cannot match ordinary numeric thresholds;
  `calculation_issue` remains independently meaningful. Unrelated field issues
  must not automatically invalidate every certain value.
- User: expand detail/evidence in existing Monitor alerts rows of
  `components/alerts-v2/ListingMonitorDraftBuilder.tsx`; preserve Form4/EFFECT.
  No Primary slot, deleted anchor or new standalone product page.
- Authenticated owner read resolves exact alert -> projected fact -> historical
  runs/decisions/scenario. Never replace historical evidence with latest facts.
  Show current unavailability for changed source/review; expose no raw AI/private
  payload; reads never materialize, enqueue or generate Alerts.
- Separate event public reader and admin run/raw reads minimally, reusing source
  guards. Admin inspection must not create a Primary event/result.
- Blockers to verify next: official `common_stock` versus calculator
  `common_shares`; numeric conflict matching; F1-only calculator/SQL readers;
  generic evaluator loading and late-event evaluation after completed pair.
  Do not restore the Primary save hook or add cron/bulk replay/polling to bypass it.
- English user-facing Monitor/Alert copy; planning estimates, never actual closing
  or maximum dilution. Do not translate unrelated existing admin screens.

Future acceptance is authenticated Monitor save -> eligible real retained domain
results -> matching -> internal Alert detail/evidence -> existing admin approval ->
zero duplicate reevaluation, with review/source/conflict guards, immutable AI,
owner isolation and 1440x900/900x900/390x900. Synthetic positive cases must be
reported separately. Prior candidate UI E2E does not establish this flow.

## Handoff / operational boundary

Candidate remains NOT merge-ready for Projected. Four restored Primary files
must remain identical to the main reference. Main integration workspace stays
`C:\Users\PC\Documents\Codex\US-Stock Radar`, branch `main`; its user-owned
`next-env.d.ts` is untouched. No other worktree modified or created.
GitHub main, deployed Vercel commit/equality, current local/remote migrations,
environment/external services and cron are unverified and unchanged this stage.
No DB writes, server/3110 operations, merge, push or deployment. Main independently
reviews acceptance and changed files before integration; push/deploy are not authorized.
