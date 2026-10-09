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


## C1 — durable execution and common calculation boundary (2026-10-10)

Base `f4ab8696`; retains A/B and the four restored Primary files. SEC raw ingestion
routes only the six supported domestic forms to one common invocation; F1 keeps
its two independent paths. A complete normal primary is reused; extra retained
HTML is stored only when the normal primary was truncated. No Primary hook,
canonical share-count write, Registry apply, cron or queue scan was introduced.

The common parent reuses ai_runs/ai_outputs, the shared provider lock, durable
lease, invocation intent, frozen UTF-8 output and journal recovery. Uncertain
invocations cannot be recalled. Its two terminal domain views explicitly carry
executionKind=derived_domain_view and the common invocation identity; they are
not two extractions. Readers verify exact role/child ID, contract and source
binding, parent checkpoint/output/hash, independent validation and exact domain
projection/output equality. One invalid domain cannot publish a Projected pair.
A latest pending/failed parent cannot fall back to an older successful pair.

Projected retains fact kind projected_offering_dilution_v1, with immutable
calculation revision projected_offering_dilution_v1-calc-r2. This revision is in
the fact ID and Alert key; old facts are not overwritten. Official common_stock
is supported. An exact-class/unit direct value is comparable only for exact
base/full_overallotment scenario labels (plus legacy null); free scenario prose
is never interpreted. A conflict gates the affected post-O/S/percentage fields,
while independent known issuance remains usable. Approval cannot clear it.
Existing generic/filing evaluation can read an already materialized Projected
fact for late events, without a Primary save hook or read-time writes.

Migrations 20261009175018 and 20261009180530 were iterated as SQL only on the
candidate-owned DB56462; no history entries were written there. Fresh isolated
DB56562 (project offering-migration-1f6c-20261010) applied all 141 repository
migrations in order, with history confirmed and seven function definitions,
invoker flags and grants equal to the iteration DB. CLI post-start diagnostic
reported an internal loopback connection error; it is not an advisors PASS.
Direct migration-history/object verification passed. No shared56322/remote DB
was used. Existing fixture rows and unresolved invocation journals remain.

Validation: focused unit selection 60 PASS; Offering45 PASS; O/S37 PASS;
Projected/Monitor/Registry/Primary334 PASS +4 skips; typecheck and diff check PASS.
New isolated report: combined-durable-1f6c-gELUf6 under the host temp directory:
five new local-only raw fixtures, three mock invocations, actual GPT0. It verifies
100+20=120, resale5, increase20%, three saves yielding one fact, independent
invalid-domain exclusion, parent recovery, latest-parent exclusion, private RPC
roles and immutable outputs. An initial rerun hit an existing synthetic accession
before inserting anything; the verifier now allocates unused local fixture
accessions instead of deleting old evidence.

Product admin/Alert integration, live extraction, authenticated current-code E2E
and final production build are still pending C2; earlier UI evidence is not
current acceptance evidence. Evidence: host temp offering-product-1f6c-20261010.

## C2 — existing admin and Custom alerts integration (2026-10-10)

Base `2ee7d2558d02cb7352aa686f73484c2409f0ee4e`, continuing the same detached
candidate. This section is the current completion report; earlier sections
describe their own stage boundaries. Main's follow-up authorized C1/C2 and up to
five single subscription extractions, one for each named domestic example.

### Scope and implemented behavior

- Existing `/admin/data/offering-plans?id=<run>` displays the exact saved
  Projected result, matching O/S link, input decisions, separate calculated/direct
  scenarios and evidence. Existing O/S and Offering detail show their common
  invocation identity and immutable parent original. Approval/hold/reject remain
  the existing input decisions; approval does not dismiss a numerical conflict.
- Existing `/monitor` creates conditions and `/alerts` displays them and expands
  recorded Projected details inline. The old Primary anchor was removed. Shared
  presentation moved from `components/filing-analysis-v2` to `components/monitor`.
  No new Primary output or separate approval/Monitor system.
- `GET /api/monitors/listing/alerts/<id>` checks authenticated ownership before
  accessing the fact, runs, decisions or evidence, returns private/no-store data,
  and performs no writes. It reads the Alert's exact historical fact; newer
  results never replace that history. Changed source suppresses unverifiable
  evidence and makes the recorded estimate ineligible for new matching.
- User-facing names are News & filing alerts, Custom alerts and Calendar alerts.
  Projected copy is English and identifies estimates based on offering plans.
  Existing storage lanes, Form 4/EFFECT behavior, billing policy and unrelated
  existing administrator copy remain in place.
- Browser verification found and fixed a same-origin GET returning 403 because
  browser GETs normally omit Origin. The dedicated read guard accepts same-origin
  Fetch Metadata when Origin is absent, while rejecting foreign/null Origin and
  cross-site requests. Another rendered defect was a dark Projected card inside
  the light admin theme; the shared component now uses the existing admin tokens.

### Authenticated local E2E

Candidate Next server: `http://localhost:3121`. Owned local project:
`projected-auth-e2e-1f6c`, API/Auth56461, PostgreSQL56462. Neither shared56322 nor
3110 was operated. External delivery and external API keys were disabled in the
candidate launcher. Production build ran with the same local-only environment.

Real UI login used existing local fixture accounts, without cookie injection.
The administrator and two ordinary accounts have Free plans. No billing or role
changes were made; Pro/paid account behavior was not separately exercised.

The saved monitor `2e320f66-d9b7-4680-991c-c72a72bec189` contains two conditions:
projected increase >=10% and issuer new shares >=100000. UI save, reload
persistence, pause and resume passed. The condition editor was inspected at all
three required widths. Presets/editor were used; no GPT condition compilation.

Five explicitly LOCAL ONLY synthetic common invocations test the product path.
They were persisted through the existing checkpoint boundary without a provider
or Worker process. For the positive case: pre-O/S1000000, issuer200000,
resale50000, base post1200000/increase20%; issuer over-allotment30000 gives
full issuer230000/post1230000/increase23%. Long Unicode class labels are retained.

| Case | Public calculation / internal Alert result |
| --- | --- |
| PASS pair | One Alert; exact fact, runs, scenario and evidence expand in `/alerts` |
| Both inputs REVIEW_REQUIRED | No public pair/fact/Alert before both approvals; O/S approval alone remains blocked |
| Both approved through existing admin UI | Offering approval automatically saved a fact and created one Alert before manual reevaluation |
| Same Offering candidate approved again | Decision history advances; Alert still points to first recorded decision/fact, count remains one |
| Offering hold + O/S approve | No public pair or Alert |
| O/S reject + Offering approve | No public pair or Alert |
| Comparable direct base1500000 versus calculated1200000 | Both values displayed; base percentage threshold cannot match, zero Alert for the saved monitor |
| Changed local fixture source fingerprint | Current read and refresh blocked; exact historical quantities retained, old evidence hidden; zero new Alert; original fixture source restored exactly |

Six concurrent reevaluations per case plus repeated evaluations left the tested
administrator's two case Alerts at two. Duplicate keys across the local outbox:
zero. Older fixtures belonging to a different user remain and are not counted
as new C2 Alerts. The key includes monitor/condition identity, accession, both
run IDs, calculation revision and scenario. Reads and reevaluations preserve
all original ai_outputs hashes.

Access verification: 17 HTTP assertions PASS, including anonymous401,
other-owner detail404/list exclusion/mutation404, foreign-origin403,
administrator decision anonymous401/non-admin403/foreign-origin403 and no-store.
Real browser logout hides conditions and Alerts; direct administrator URL
redirects to login. A logged-in non-admin is redirected with admin_required;
the separate empty account sees zero conditions and zero Alerts. No private
actor/reason, provider raw output or internal execution payload is returned to
the ordinary user's detail reader.

### Actual filings: preserved evidence, not positive Alert fixtures

Retained real Canaan F-1 accession `0001193125-19-276263` uses O/S run
`ada400dd-2c79-5e0e-a881-0057acaba811` and Offering run
`df85e8b8-3f37-5c4a-a794-829096a7537c`. Both current source bindings verified.
Blank ADS quantity/ratio produces unavailable issuance/post-O/S/percentage,
not 0% dilution. Direct Class B356624444 remains separate from issuer total
2222222222. The original textual O/S basis is retained. Numeric Alert count0;
no new Canaan extraction.

The five separately authorized subscription calls completed once each using
the durable common runtime, existing ChatGPT authentication, no API keys and no
retry/repair. The original parent bytes, independent domain views and hashes
are preserved. Completed-job replay made zero additional provider calls.
No separate O/S/Offering Worker process or queue scan was run. No Primary event
was fabricated: each actual example has eventCount0, so their live event-to-Alert
journey is **not verified**. Synthetic positive E2E is not evidence of a real
positive dilution extraction.

| Actual case | Preserved result | Projected boundary |
| --- | --- | --- |
| CAVA S-1, 2023-05-19 | O/S567745 as of2023-04-16; blank offered quantity and price | Unavailable; exact class labels are not fuzzy matched |
| PureCycle S-3, 2024-11-20 | O/S173491740 as of2024-11-04; issued resale8528786, conditional warrant underlying5000000 and1510943, preferred50000; original `$` preserved | Unavailable; potential-warrant representation issue below |
| Silvaco 424B5, 2026-05-08 | O/S32688557 as of2026-05-06; ATM limit$35000000, directly stated increase$20000000, remaining$30668720; no share quantity | Unavailable; no dollars-to-shares conversion |
| Shimmick 424B5, 2026-05-22 | NO_DIRECT_CURRENT_OS; Offering PASS; prior ATM$7800000/current$4986750 | No public pair; no computed monetary decrease |
| iBio 424B3, 2026-02-09 | O/S32540942 as of2026-01-30; issued resale1408481; conditional pre-funded underlying9653257; direct conditional post42194199 | Unavailable; direct conditional post stays separate; representation issue below |

Silvaco and iBio filing dates were checked against the exact accession in the
official SEC submissions JSON, retained with hashes. Shimmick used its original
SEC header. Dates in old experimental filenames were not used as filing dates.
Structural/source-reference PASS does not establish semantic quality PASS.

**Confirmed merge blocker:** PureCycle/iBio encode conditional warrant underlying
as selling-shareholder common_stock components, without a typed warrant component
and relationship. The calc-r2 resolver safely avoids a positive immediate
issuance calculation, but sets has_warrants/has_prefunded_warrants false and
potential_warrant_shares0. The UI consequently displays 0 potential shares even
though those conditional instruments appear in the original. This does not meet
the requirement to report unknown potential dilution as unavailable. iBio was
also reproduced in the rendered admin screen. These cases are not approved as
complete semantic successes. No interpretation, relationship repair, original
rewrite or extra extraction was performed to hide this issue. Resolving it must
preserve immutable calc-r2 facts and use a new calculation revision if meaning
changes; integration decisions belong with main's shared contract review.

### Final verification and evidence

- Projected/Monitor/Registry/Primary selection:341 PASS,4 optional skips.
- O/S37 PASS; Offering45 PASS (31 original +14); Alert76 PASS; filing UI46 PASS.
- Combined24 PASS, including new immutable admin history rejection tests.
- Naming1 PASS; GET guard1 PASS (the latter also belongs to the Projected selection).
- Typecheck, production build and git diff check PASS.
- CSS viewports exactly1440x900,900x900,390x900: conditions, Alert list/details,
  approved admin result and real Canaan unavailable view inspected. Recorded
  document widths do not exceed viewport width; long IDs/Unicode wrap.
- Initial normal-flow detail403 was fixed. Post-fix browser verification reports
  zero console errors; historical pre-fix errors are not represented as zero.
  A fresh final browser tab after the successful build/restart also verifies
  loading the owner detail without errors.
- Full-page screenshots supplement viewport screenshots because the IAB viewport
  screenshot API physically clips some desktop captures. CSS dimensions are
  recorded separately; image pixel dimensions are not claimed to equal CSS size.

Evidence outside Git:
`C:\Users\PC\AppData\Local\Temp\offering-product-1f6c-20261010`.
Includes browser-checks.json, approval-auto-readback.json, evaluation-replay.json,
source-change-report.json, access-current.json, actual-final-audit.json, original
invocation journals, final test/build logs and screenshots. No credentials or
large original filings are added to the repository.

C2 adds no migration and does not change calculation revision. Existing
20261009104931 plus C1 migrations20261009175018/20261009180530 remain local-only;
the fresh141-migration verification on56562 is recorded in C1. No remote
migration, Registry Apply, market/canonical O/S, ticker/current or Watchlist writes.

Primary protection: app/filings/[id]/page.tsx,
app/filings/archive/[id]/page.tsx,
components/filing-analysis-v2/GenericFilingAnalysis.tsx and
lib/secFilingAnalysisIngest.ts remain identical to main reference
`a1ee8ac75ecbe075b9a3e2a814cee41a21a84515`. No Primary page was used as proof of
the new Monitor journey. Candidate-only next-env.d.ts development regeneration
is excluded from the feature commit; main's user-owned file was untouched.

Current disposition: candidate implementation/evidence is ready for independent
main review, **not authorized or ready for merge** while the semantic blocker
and actual positive event-to-Alert acceptance remain unresolved. Local main ref
is `a1ee8ac75ecbe075b9a3e2a814cee41a21a84515`; cached origin/main is
`7fa1de18a5c9b6dc9454862c1d195ea6a773cefa` (not live GitHub verification).
Deployed Vercel commit, live GitHub equality, remote DB/environment and cron are
unverified and unchanged. No merge, push or deployment was performed/authorized.
