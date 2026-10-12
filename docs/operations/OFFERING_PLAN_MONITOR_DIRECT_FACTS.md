# Offering Plan direct FACT Monitor candidate

This candidate connects retained Offering Structured results to the existing generic Monitor and internal Alert flow. It does not restore projected dilution calculations, infer actual issuance, convert ADSs, sum securities, or change Primary outputs, prompts, schemas, Registry authority, or O/S canonical selection.

## Source witness correction after main review

Main independently reproduced a false positive in `02cda600`: a paragraph offering 50,000 Common Shares also mentioned a completed 2020 sale of 200,000 Common Shares. The old witness joined the current-offer words to the historical quantity. The added regression failed before the fix.

The witness now accepts only a bounded, affirmative single-clause paragraph: seller + offering verb + literal quantity + exact security label, with only the supported prospectus prefix/suffix. It matches the whole paragraph, rather than separating an affirmative sentence from a following qualification or negation. There is no wildcard between the verb and quantity and no unrecognized trailing clause. Negation, qualifiers, other tranches, historical quantities and unknown wording cannot be repaired into that pattern. Complex otherwise legitimate source statements can be unavailable. The Alert explanation now describes a recorded component and asks readers to review its context, rather than claiming all unclear/conditional scenarios have been ruled out.

The exact retained iBio current-resale paragraph was compared with the regression literal without DB/provider access. **iBio c1 is now ineligible:** its intervening sale terms and multi-tranche sentence are outside the bounded witness. c2 pre-funded warrant exercise shares and Canaan blank quantities remain ineligible. The historical iBio Alert created under `02cda600` below is prior evidence, not proof of a positive match under the corrected code. Stored facts and Alerts were not rewritten.

This correction is code/offline verification only. No login, E2E, DB write, provider call or server rebuild was repeated. Normal automatic positive and fresh approval-to-Alert positive remain unverified; merge remains on hold pending main review.

Correction checks: 13 focused tests included in 384 regression passes (4 existing optional skips), 151 related Monitor passes, typecheck and diff check. The prior running production build was not rebuilt; it must not be used as evidence that this correction is deployed or browser-verified.

## Supported condition set

All four conditions are required exactly once, ANDed against one component:

| Key | Operator | Value |
| --- | --- | --- |
| `offering_plan.component_quantity` | `gte` | Nonnegative literal decimal string |
| `offering_plan.seller_type` | `eq` | `issuer` or `selling_shareholders` |
| `offering_plan.security_type` | `eq` | `common_stock`, `ordinary_shares`, or `ads` |
| `offering_plan.quantity_unit` | `eq` | Exact source unit text |

Different components and condition families cannot be combined. A conservative source witness must support a current offering statement and the component's literal quantity/class label. Blank, unknown, historical, conditional, warrant exercise, ATM-linked and over-allotment-linked components are not eligible. Unsupported wording remains unavailable; this is not a general prospectus interpretation engine. Resale is a plan-disclosure condition, never issuer dilution.

## Existing product path

`/monitor` preset/edit/review/save uses the existing condition catalog and persistence validation. `/alerts` uses the existing owner-scoped Monitor list and Alert history with an expandable direct-component detail and SEC reference.

`readOfferingPlanFacts` selects the latest exact raw invocation and its designated Offering child, validates retained source/output bindings, and permits PASS or exactly one currently approved REVIEW_REQUIRED candidate. A newer incomplete result, non-public status, hold/reject/retry, or source mismatch blocks fallback to an older result. An O/S result is not required for this direct Offering condition.

The existing consumer retains filing-date activation and `(listing_monitor_id, alert_event_id)` uniqueness. A late saved result cannot notify a Monitor created after that filing. The evidence snapshot is immutable; current source/review validity is shown separately on detail readback.

Evaluation entries:

- Independent Offering finish and terminal replay.
- Combined Offering finish and terminal replay.
- Existing administrator Offering approval after its decision is committed.
- Existing saved-event API starter and source-ingest workflow step, including a reused completed event.

These only evaluate saved facts. They do not start a provider, an O/S worker, an Offering worker, a new queue, or an external notification. Saved-result hook failures are logged for replay and do not undo committed analysis/decisions; this change does not add an autonomous retry scheduler.

## Storage and migration

`20261012162202_offering_plan_monitor_evidence.sql` adds one nullable `user_alert_deliveries.offering_plan_match_evidence` JSONB column, a strict validator, a shape constraint, and an immutable-evidence trigger. Existing owner RLS, Form4 evidence, lanes and uniqueness remain. Monitor deletion retains the historical Alert through the existing `ON DELETE SET NULL` relationship.

Evidence version `offering_plan_match_v1` stores run/raw/event/accession, filing date, source fingerprint, output hash, contract version, approval selection, four condition snapshots, and one directly stated component with compact SEC block references. The user projection omits administrative decision/candidate IDs and integrity hashes. No provider log or original output is returned by the new Alert API.

Applied only to isolated local DB `56462`, after a verified full database backup. The existing local migration ledger was not changed. Applying the committed migration in another environment is a separate integration action; do not reapply it blindly to this already modified isolated DB. Shared local DB, remote DB and port 3110 were not operated.

## Prior verification evidence at 02cda600, 2026-10-13

Base: `6f599393cdfbe167f3f464af2e85771d6d504f69`, detached candidate worktree `1f6c`. Candidate server 3121; Auth/API 56461; DB 56462. Evidence is outside Git at `C:/Users/PC/AppData/Local/Temp/offering-direct-monitor-1f6c-20261013`.

Actual browser condition: quantity >= `1000000`, seller `selling_shareholders`, security `common_stock`, unit `shares`. Save, reload, pause and resume succeeded.

| Identity | ID |
| --- | --- |
| Monitor | `96e3365b-6ed8-461d-a99b-c62940fc74fb` |
| Retained real iBio raw | `6f141e9f-d774-4577-a999-15d3e3a1950e` |
| Offering run | `3d183855-5e25-5fab-a723-6296a7e0bb71` |
| Local-only event | `7f6208ec-9323-4cbc-bdaa-3f022392c953` |
| Historical-test Alert | `7595113d-f3a0-4c57-ae0b-828b5c8442be` |

iBio accession `0001104659-26-012183` directly states resale of 1,408,481 Common Shares. The separate 9,653,257 pre-funded warrant exercise shares were excluded. Exactly one local-only event was prepared against retained real raw after confirming that raw had no event; no Primary analysis or output was created.

**Normal activation:** the new Monitor postdates the 2026-02-09 filing, so evaluation created zero Alerts with `monitor_activation_not_met`.

**Explicit historical test only:** the existing consumer's `listActiveMonitors` dependency returned an in-memory clone of this one Monitor with `createdAt=2026-02-08T00:00:00.000Z`. The real official reader, matcher and `createListingMonitorAlert` writer created one Alert. Replay created zero additional Alerts. The database Monitor timestamp, filing date and source data were unchanged. Exact original/injected timestamps and results are in `historical-e2e.json`. This is not a normal automatic positive E2E.

Actual retained Canaan accession `0001193125-19-276263` has blank ADS quantity/ratio and zero eligible components; unavailable is not converted to a zero share count or 0% dilution. Its Class B post-offering quantity is kept as its own direct fact, not a total.

Authenticated owner Alert list/detail and SEC provenance were viewed. Other-user lists exclude the owner's records; direct other-owner read/mutation returns 404, logged-out detail returns 401, cross-origin access and unauthorized administrative decisions return 403. Existing admin decisions/roles were unchanged. Existing approved candidates and held results were read; unapproved/hold/reject/source mismatch and exact approval selection are covered by offline tests. No fresh approval-to-positive-Alert browser test was performed.

Condition editor, Alert detail, direct-fact admin and existing approval-history/Canaan screens were captured at exact CSS 1440x900, 900x900 and 390x900 without document horizontal overflow. The earlier draft-preview crash was fixed; final normal-flow console interval had zero errors/warnings. User-facing additions are English; existing admin presentation was preserved.

Validation: combined regression 380 PASS, 4 existing optional skips; O/S 37; Offering 45; Alert 76; filing UI 46; related Monitor 151; source-ingest workflow 12; isolated database 61 checks with rollback. Typecheck, production build and diff check passed. Some suites overlap. Live provider/GPT/O/S Worker/Offering Worker calls: zero.

## Acceptance limits

Normal automatic positive production E2E and a new administrator approval producing an Alert remain unverified. Automatic wiring is covered by mocked execution tests; historical dependency injection cannot substitute for those live acceptance checks. Candidate code is available for main's independent inspection, but this report does not authorize merge, push or deployment.
