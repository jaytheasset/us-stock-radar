# Periodic Financial Monitor — minimal UI candidate

2026-10-14 KST. Candidate only; no main integration, push or deployment.

## Scope and existing contracts

The existing `/monitor` now offers typed financial conditions from Registry READY entries, an explicit currency input, a review and save action using `/api/monitors/financial`. `/alerts` Custom alerts displays the owner's financial Monitors and alerts alongside the existing families. SC13 CSS/layout patterns, existing persistence, owner APIs, official reader, Matcher and dedupe are reused. There is no new page, engine or LLM compiler expansion.

The existing financial contract has **no issuer or ticker target**. The builder and saved Monitor explicitly say that all supported stored SEC periodic filings are evaluated. It does not promise a particular stock, complete market coverage, real-time data or a new scheduling policy. Existing quarter/YTD/annual/instant, exact decimal, currency, unavailable and activation semantics remain unchanged. No new pause/delete API was added.

The consumer captures the same already-read official comparisons only after MATCH. `financial_match_evidence` stores immutable exact decimal strings, currency, current/prior-year period (when required), the existing absolute YoY change, original conditions, event/raw/execution/accession/CIK/form/times, filing artifact hashes/fact keys/context IDs/lexical values/scale/sign and CompanyFacts raw IDs/paths. It copies existing values; it does not compute or repair financial values. Unavailable YoY cannot fall back to the current value.

The existing shared evidence approach is reused: additive nullable alert JSON, strict read projection, same-accession SEC URL validation, explicit legacy/invalid evidence states and an immutable trigger. A financial-specific column avoids changing the Form144/SC13/OfferingPlan contracts or coercing exact decimal financial strings into numeric Form144 cells. New migration: `20261013203744_financial_monitor_match_evidence.sql`; apply it before the new consumer/list API. No old migrations, RLS, grants, comparator, resolver, conditions or canonical FACT schema changed.

Company name is copied from the identity-checked retained filing metadata. The current financial reader supplies no certified ticker mapping, so this stage shows **Ticker unconfirmed** and does not infer a symbol from CIK or a first security. Missing identity remains unconfirmed. Saved alerts never consult current Monitor conditions or current financial values for reconstruction.

## Actual retained-source validation

Evidence directory: `C:/Users/PC/AppData/Local/Temp/financial-monitor-7f32/` (not committed).

- Actual SEC Silvaco Group, Inc.10-Q, accession `0001628280-26-032286`, CIK `0001943289`, filed2026-05-07, report date2026-03-31.
- Original document `https://www.sec.gov/Archives/edgar/data/1943289/000162828026032286/svco-20260331.htm`; SHA256 `cf22c1328cff131e30bbb49044804d9ce86ab10e96e1b4e757c0c86cf82a45ae`.
- Retained documents: `os-auto-publication-1f6c-20261013/real-positive/prerequisite-artifacts.json`, `silvaco-companyfacts.json`, and `offering-product-1f6c-20261010/actual/silvaco-official-submissions.json` in the local Temp directory. The original index/body hashes were checked; no new SEC fetch.
- Original `CashAndCashEquivalentsAtCarryingValue`, context`c-3`, lexical`10,925`, scale`3`, unitUSD, instant2026-03-31. Existing deterministic resolver and official reader both return exact string`10925000`. The existing Matcher validates the filing-XBRL/CompanyFacts pair and currency.
- This Q1 filing's duration observations are `QUARTER_AND_YEAR_TO_DATE`; existing Monitor keys do not alias that to quarter or YTD. This stage preserves that limitation and uses the supported INSTANT cash condition. No period injection or coercion.
- New isolated transport event`64ebc62b-c4b1-407c-a75f-b805b8e6e549`, raw`23f93421-97c5-489b-8a49-5aacdde36fa6`; exact source content retained. The event's required score0 and archive/neutral metadata are test transport fields, **not a Primary result or financial FACT**. No Primary analysis was generated or used. The existing filing archive page therefore shows its ordinary archive fallback, outside this alert's financial evidence.
- Existing stored-source resolver ran against copied actual source records. Its exact result was persisted as a new deterministic completed output for the official reader. This is **retained-source resolver/output → official reader → consumer verification**, not fresh Primary, automatic child/fanout, provider or ingestion E2E. Existing AI rows were never modified.
- Preparation was limited to5 source artifacts,1 issuer,10 filing-ledger rows,10 source-derived CompanyFacts,1 raw item,1 event and the missing canonical earnings dictionary entry, followed by1 deterministic run/output pair. Test-only newly inserted metadata was aligned to repository contracts before the baseline. All pre-existing rows were preserved.

## Acceptance checks

| Check | Evidence/result |
| --- | --- |
| Actual UI save | Existing owner password login → `/monitor` metric/amount/currency controls → review checkbox → Save button, POST201. Monitor`2476b88e-d4cf-4c7d-a4a9-39ec210cbc1b`; cash INSTANT gte`10000000`USD. `monitor-created.json`, `builder-owner-*.png` |
| Production reader/Matcher/writer | Default production consumer creates exactly1 internal alert`19313ffa-a47f-4c48-8815-8491715fc8f3`; failed0. `official-reader.json`, `first.json`, `evaluation-proof.json` |
| Same-event replay | created0/existing1/failed0, entire stored alert and official reader unchanged. No external channels |
| Historical evidence | Snapshot stores actual`10925000`, condition`10000000`, USD and2026-03-31 independently of future Monitor/reader changes. Unit tests mutate later inputs and confirm the snapshot is unchanged |
| Immutability | Direct snapshot modification and filling a legacy alert's evidence are rejected. `final-integrity.json` |
| Owner APIs | Owner200/one exact filtered alert; other200/zero; anonymous401. `api-isolation.json` |
| Actual browser | `/monitor` and `/alerts` ×owner/other/anonymous ×1440x900,900x900,390x900 =18 views. Exact alert/Monitor IDs only visible to owner; no horizontal overflow; signed-in console/page/HTTP errors0. Anonymous protected401s are expected. `browser-complete.json`, `*-browser.json` |
| Links | Owner clicked View filing; actual existing archive route ends in the same event ID and shows Silvaco. SEC href matches the preserved original accession and hash-backed source; no refetch. `filing-route.json` |
| Existing families | Real SC13 records remain visible; specific-person and all-reporters builder modes checked. Existing Form144 USD snapshot retained.15 additional browser-only response-fixture views cover Form4 purchase/OfferingPlan/EFFECT/NT/invalid evidence at three widths; not fresh family E2Es. `synthetic-regression-complete.json` |
| Data preservation | All172 public tables checked; every pre-existing row preserved. After source preparation only1 financial Monitor and1 alert added; source/FACT/AI/old Monitor/old Alert hashes unchanged. `final-integrity.json` |
| Checks | Existing financial/resolver/runtime tests86PASS; new evidence/display tests6PASS; existing-family focused regressions69PASS (161 total). Full typecheck, production build and diffcheck PASS. Isolated security advisors: no issues |
| Known baseline failures | Separate unchanged socialVerification and mutationOriginInventory rerun:12PASS/2FAIL, creator-title expectation and cron-wrapper static regex. No expectation weakening |

Actual financial screenshots were visually inspected at all three widths, including mobile wrapping and retained SC13 content. Early harness-only immediate-DOM, exact-label/text and network-idle failures were corrected without additional Monitor/Alert creation; `browser-complete.json` identifies the completed run. Auth bootstrap upserts were blocked by the temporary guard and are not successful product writes. Existing-account auth sessions are outside product-table immutability checks. No cookies injected, new accounts, role changes, provider calls, worker dispatch, external messages or backfill.

## Required handoff and limits

- Root `C:/Users/PC/.codex/worktrees/7f32/US-Stock Radar`. Began clean detached`8bc5c75caad85a8a54c76f45680d927a11104bfa`; explicitly authorized ff-only merge advanced to base`d933d7662560eb14f6d99966c0b01dbf5a23566c`. No switch/checkout/reset/new worktree.
- Permanent main root `C:/Users/PC/Documents/Codex/US-Stock Radar` remains main-only. No commands ran there; no shared-main DB or server changes. Its reported user `next-env.d.ts` change was not modified/rehashed.
- Local main ref`d933d7662560eb14f6d99966c0b01dbf5a23566c`; origin/main cache`aef4d35221c9744c3a3f47518c492212f678e582`, remote not rechecked. Vercel current commit/status unverified; prior report`bf586ed5...`READY is historical. Three-way equality is not established.
- DB tests only on authorized isolated`nt-positive-e56cf806`, API/Auth59621, PG59622, system`7696143717028368440`. Candidate migration applied directly there; the clone has no migration ledger and no history repair occurred. Shared-main ledger146/last`20261013193021` is inherited information, not newly verified. Remote migrations/environment/cron/external services remain unverified and unchanged.
- No environment files changed. Child process only: isolated Supabase settings and disabled provider/external-send settings; no secret values in this report. Candidate server3153 only; live process/build/HEAD recorded in the evidence directory. Main3110 was observed running and never operated.
- Real Pro account, fresh Primary/child/fanout, live SEC refresh and wider filing coverage were not tested or claimed. All existing period/currency eligibility and no-target scope remain in force. Follow-up targeting, Q1 combined-basis semantics, broader identity mapping and other-family work require separate scope.
- No main merge/push/deploy. Completion report does not authorize merge: the integration chat must independently verify the original acceptance journey. Stop at the clean candidate commit.
