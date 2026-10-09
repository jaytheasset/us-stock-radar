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

## B — domestic one-response adapter

A was committed separately as `d4c563f9` before beginning B. B adds only
`lib/sec-combined-offering`, offline verification scripts and contract byte rules.
There is no UI, DB, enqueue, Primary, Registry or Monitor wiring change.

`combined_offering_v1-output-r1` composes O/S r2 and Offering r3 definitions into
one envelope with a common exact filing identity. The shared ATM definition is
referenced through Offering r3; no per-form schema copy. Supported adapter forms
are S-1/S-1/A, S-3/S-3/A, 424B3 and 424B5; other 424B forms are explicitly unsupported
at this stage. Amendment variants have synthetic shape coverage, not actual new
extraction quality approval. Existing `isOsForm`, F1 source fingerprints and the
two independent F1 provider/runtime paths are unchanged.

The new source builder requires complete primary bytes and official issuer, CIK,
accession, form and filing date. Missing/invalid metadata returns UNAVAILABLE
before provider invocation. It renders all lines in sequence under a distinct
source version and accession/hash/line IDs. The descriptor contains only raw ID,
accession, source fingerprint and domain/envelope contract versions/hashes. Full
source exists only as transient input; no persistence path was added.

The provider must be injected. Each analysis invokes it once, without retry or a
default live implementation. Raw returned JSON text and its hash are retained
exactly; sections are validated independently against their composed schemas and
original evidence IDs. A valid section survives an invalid peer. Common identity,
contract or source-binding errors reject both. Results report NOT_ASSESSED for
meaning: structural/reference validation never approves semantic interpretation.
No field calculation, repair, inference, default ATM array or reference rewrite.

### Retained evidence, separate from product execution

Read-only verifier:

```powershell
node --no-warnings --experimental-strip-types scripts/verify-combined-offering-retained.mjs <combined-offering-quality-3f45d533> <combined-offering-atm-6ca7e401>
```

It checks frozen experimental schema/prompt/input/request/output hashes, exact
filing identity, original SEC primary bytes and neutral rendering, complete block
line coverage, reference IDs and component links. It reads candidate fixture copies
and external retained HTML, never runs external scripts or writes their files.
All five cases passed the original experimental format/source/reference checks:

| Retained case | Observations retained without changes | Product boundary |
| --- | --- | --- |
| CAVA S-1 (experiment r1) | Current class O/S 567745; offered quantity/price blank; ATM field absent | Input build possible; old response revision rejected |
| PureCycle S-3 (experiment r1) | O/S 173491740; resale and conditional exercise proceeds separated | Input build possible; old response rejected; source `$` versus output `USD` semantic review **still on hold** |
| Silvaco 424B5 (experiment r2) | O/S 32688557; ATM 35000000 limit, 20000000 increase, 30668720 remaining; share quantity absent | UNAVAILABLE: retained official filing date missing |
| Shimmick 424B5 (experiment r2) | NO_DIRECT_CURRENT_OS; prior 7800000/current 4986750; no calculated decrease | UNAVAILABLE: retained official filing date missing |
| iBio 424B3 (experiment r2) | O/S 32540942; resale 1408481 and conditional underlying 9653257; direct conditional post 42194199; ATM `[]` | UNAVAILABLE: retained official filing date missing |

These outputs use original `D1-B...` IDs and are not converted into product run
outputs. New product source IDs are exercised only with clearly synthetic response
fixtures. No absent filing date/ATM field is filled. No new GPT quality test of the
new product prompt/input was performed. Original retained files were unchanged.

### B validation and outstanding boundary

- Combined adapter: 17 PASS, including one-call count, domain-isolated failures,
  exact binding/evidence checks, no-direct/review, missing metadata, no repair,
  shared ATM identity and F1's separate two-runtime calls with mocks.
- Offering: 45 PASS; O/S: 37 PASS.
- Projected/Monitor/Registry/Primary selection: 331 PASS, 4 optional skips.
- Alert: 76 PASS; filing UI regression: 46 PASS.
- Typecheck, production build and `git diff --check` PASS.
- Actual GPT/provider extraction calls: 0; actual O/S/Offering Workers: 0;
  SEC network requests: 0; DB writes/migration applications: 0.

Evidence logs and retained verifier JSON are outside the repository:
`C:\Users\PC\AppData\Local\Temp\offering-common-1f6c-20261010`.
No screenshots: there is no UI change in A/B. Real authenticated admin persistence,
domestic durable domain storage, automatic execution and product E2E remain
unconnected/unverified. This adapter is not proof of a live extraction or rollout.

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
