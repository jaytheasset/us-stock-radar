# Offering Plan direct FACT Monitor candidate

## Current path and meaning

This adapter follows the existing Proxy/S-8 pattern: the official reader verifies retained source/output identity and review selection, projects typed fields, and the existing generic Monitor compares them. Source prose and freeform `scenario` are evidence for the user; Monitor does not extract, repair, or certify their meaning.

`/monitor` preset → existing editor/review/save → `readOfferingPlanFacts` → existing matcher/consumer → immutable internal Alert → owner-scoped `/alerts` list/detail. Primary outputs, extraction prompts/schemas, O/S authority and Registry are unchanged. No quantity sums, ADS conversions, projected O/S, execution or closing inference.

All four conditions are required exactly once, on the **same component**:

| Key | Operator | Value |
| --- | --- | --- |
| `offering_plan.stated_component_quantity` | `gte` | Direct nonnegative decimal string |
| `offering_plan.seller_type` | `eq` | `issuer` or `selling_shareholders` |
| `offering_plan.security_type` | `eq` | `common_stock`, `ordinary_shares`, `ads` |
| `offering_plan.quantity_unit` | `eq` | Exact stated unit |

Meaning: **the quantity stated in this plan component satisfies the conditions**. This does not establish current unconditional issuance. The stored scenario is displayed verbatim, including conditional exercise or resale context. Rows linked by typed over-allotment/ATM relationships remain out of scope. Blank/not-stated quantities and unsupported seller/security values cannot match and are never zero-filled. Separate rows are neither combined nor reclassified from their labels.

## Integrity and execution

`readOfferingPlanFacts` selects the latest exact raw invocation and designated Offering child, verifies source/output hashes, contracts and evidence refs, then permits PASS or exactly one approved REVIEW_REQUIRED candidate. Newer incomplete work, non-public status, hold/reject/retry or source mismatch blocks fallback. Format/hash validation is **not semantic correctness approval**. A source/FACT meaning discrepancy belongs in extraction/review, not a second regex extractor in Monitor.

Existing triggers evaluate saved facts after independent/combined result completion or replay, committed administrator approval, saved-event creation and the source-ingest step. No provider, extraction worker, separate queue or external notification is started. Hook failure is logged and can be replayed without undoing the saved result.

The existing consumer retains filing-date activation and unique `(listing_monitor_id, alert_event_id)`. A newly created Monitor does not notify on an older filing. Source validity is checked separately from the immutable historical match snapshot.

## Compatibility and cleanup

`offering_plan.component_quantity` is retired through the existing retirement mechanism: owner readback and pause remain available; new creation, editing, reactivation and execution are blocked. No old Monitor is automatically converted and no partial subset executes. The other three scope keys retain their meanings. New behavior requires an explicit new quantity condition.

Evidence keeps the existing `offering_plan_match_v1` envelope and column. The new key is tied exactly to `meaning=stated_plan_component_not_execution`; the legacy key is tied to its saved `stated_current_plan_component_not_execution` meaning. Mixed contracts are rejected. Old Alerts are labeled historical and not overwritten.

Removed: source paragraph/sentence witness regex, literal quantity/label regex construction, and scenario-based semantic selection. Replaced those tests with typed field boundaries, semantic-discrepancy role separation, exact units, row isolation and retirement tests. Kept only the legacy evidence-format predicate needed to read the already applied historical contract. It does not select live components. Earlier projected-history modules and unrelated families remain unchanged.

## Migration

The applied `20261012162202_offering_plan_monitor_evidence.sql` and its validator are unchanged. New `20261012173310_offering_plan_stated_component_compat.sql` adds a new strict validator and expands only the existing evidence CHECK with legacy OR new validation. No table/column, RLS, immutable trigger, lane or unique-key change.

Local only: Auth/API 56461, owned DB 56462, candidate 3121. A new full backup (`typed-before.dump`) was verified before application. The CLI staging directory contained exact source files for the 139 already registered migrations plus only the new pending migration; `migration up --local --include-all` applied that one migration and added one ledger row. All prior ledger rows and both old functions were compared unchanged. Earlier evidence migration was applied as SQL without ledger registration; it was not reapplied or falsely registered here. Shared DB, main3110 and remote systems were untouched.

## Retained real-source comparison

Retained outputs and source hashes were validated without new extraction or SEC retrieval; source passages were read separately.

| Filing | Typed component result |
| --- | --- |
| iBio 0001104659-26-012183 | c1: selling-shareholder resale 1,408,481 Common Shares. c2: separate 9,653,257 pre-funded warrant underlying shares with exercise scenario. Each can satisfy its own literal row condition; no sum or immediate-issuance claim. |
| Shimmick 0001193125-26-237198 | ATM dollar ceiling $4,986,750; component share quantity not stated. No share match; market/O/S numbers not substituted. |
| Silvaco 0001213900-26-054018 | ATM monetary limits and historical sold quantity in source; plan component share quantity not stated. No match or reconstruction from prior sales. |
| PureCycle 0001193125-24-262591 | Separate resale components: 8,528,786 existing common shares, 5,000,000 Series C warrant underlying shares, 1,510,943 RTI warrant underlying shares. Scenarios remain separate. 50,000 preferred shares outside supported security scope. |
| CAVA 0001628280-23-018945 | Blank IPO share quantity; no match. |

Canaan 0001193125-19-276263 retains blank ADS quantity/ratio. Its separate Class B direct post-offering value is never treated as a total or used by this adapter.

## Verification evidence and boundaries

Current verification starts at detached `0034dd8a48dc2e91a0a9113853c837d4478f3c05`. Artifacts are outside the repository at `C:/Users/PC/AppData/Local/Temp/offering-direct-monitor-1f6c-20261013`, with `typed-` prefixes distinguishing this run from prior evidence. The old `historical-e2e.json` and old Alert remain intact and are not proof of current positive behavior.

Current E2E IDs, test totals and responsive results are recorded below. Historical dependency injection, if used, is explicitly separate from normal activation; database timestamps and filing dates are never changed. A historical positive cannot establish normal automatic positive or a new approval-to-Alert positive.

### Current authenticated verification

A new owner Monitor `5b2fe647-d6fa-4ae4-9d63-1b0c9d6f15e4` was created through `/monitor`: quantity >= 1000000, selling shareholders, common stock, exact unit `shares`. The browser confirmed save, reload persistence, pause and resume. The retired prior Monitor remains readable and cannot be edited/reactivated (422); old Alerts retain their original meaning.

The reused local-only event `7f6208ec-9323-4cbc-bdaa-3f022392c953` points to retained real iBio raw `6f141e9f-d774-4577-a999-15d3e3a1950e` and Offering run `3d183855-5e25-5fab-a723-6296a7e0bb71`.

- Normal activation: **0 new Alerts**, because the Monitor was created after the 2026-02-09 filing.
- Explicit historical dependency injection: only an in-memory Monitor clone used `createdAt=2026-02-08T00:00:00.000Z`; the official reader, matcher and real existing writer created new Alert `29da41e3-96f5-4e7b-a5ae-2399d922c0a5` for c1 (1,408,481 shares). Replay created **0** additional Alerts. No DB timestamp or filing date changed.
- Authenticated list/detail displayed the new Alert, verbatim scenario, filing/run and SEC evidence reference; current source/review validity was confirmed. Historical old Alert was displayed separately.
- Actual Canaan reader: available source, zero eligible components (blank ADS quantity), zero Alert. No quantity/dilution zero was synthesized.
- Access checks: **16 PASS** covering owner/non-owner/logout/cross-origin, unauthorized admin decisions, retired condition mutation and historical readback.
- Exact CSS viewports **1440x900, 900x900, 390x900**: condition review/editor and Alert list/detail; no document horizontal overflow. Normal browser console errors/warnings **0**. `typed-browser-results.json` and `typed-*.jpg` preserve evidence. Full-page images also preserve desktop content beyond the side-panel screenshot crop.
- Read-only integrity comparison: **all pre-existing rows across 10 tracked tables unchanged**, including raw/AI outputs, decisions, roles, old Monitors/Alerts and projected historical facts. Only one new Monitor and one new internal Alert were added. No external delivery.

Checks: combined regression **385 PASS / 4 existing optional skips**, O/S **37**, Offering **45**, Alert **76**, filing UI **46**, related Monitor **151**, isolated DB **89** (rolled back). Suites overlap. Typecheck, production build and `git diff --check` passed. Live provider/GPT/O/S Worker/Offering Worker/SEC collection calls: **0**.

Normal automatic positive and fresh administrator-approval-to-positive-Alert browser E2E remain **unverified**; they are not claimed by the historical test. Approval/source gates and automatic entry wiring retain their existing regression coverage. Administrator UI/state was not expanded or mutated in this cleanup. Main independent acceptance remains required before merge; no merge/push/deploy was performed.
