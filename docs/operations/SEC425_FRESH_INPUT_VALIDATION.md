# SEC 425 fresh collection → identity → model input (no model dispatch)

2026-10-15 KST. Existing candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, base `17db2a79a45372476fc933296b5b549c74eb3b30`, detached/clean at start. No legacy-data compatibility, backfill or recovery work; previous experiment evidence remains unchanged. No data reset was performed.

## Actual execution boundary

The verification harness calls **`runSecRawIngest({dryRun:true})`**, with its `fetchRawItems` dependency wrapping the actual **`fetchSecEdgarRawItems`** only to capture the unchanged return value. All persistence dependencies throw if invoked; invocation count is zero. The existing dry-run branch stops before source-run/raw/cover/queue writes. The captured *newly fetched* raw item then goes through **`buildSecFilingAnalysisPackage`**, existing **425 parser**, **`buildSec425RouterPromptForInput`** and new **`buildSec425FactInput`** (also exposed on the existing `sec425Adapter`). No previous raw item, old prompt or saved Router result is supplied.

Primary Router input was actually built. **Primary main-analysis selected input was not built**, because it requires a real Router decision and this task permits no model calls. The same Primary input builder's official identity/timestamp fields are covered by isolated tests with explicitly synthetic Router decisions; this is not live Primary selection evidence. FACT input uses all existing cleaned blocks, including headings, without pretending to have a Router selection. Neither builder dispatches a provider.

## Reproduced gaps and minimal changes

1. The previous parser retained filing-role CIKs but only the archive/focal company's catalog row. The new 425-only `sec425_official_companies` metadata joins each **explicit index-role CIK** to the **already fetched SEC catalog**. It does not perform a new network lookup or name search. Company name from index, catalog company name, symbol candidates, source URLs, index hash and observation time remain distinct. All transaction roles remain null; listing candidates do not identify a common/preferred/warrant security type.
2. The old FACT preparation script reuses historical experiment prompts. A pure fresh-package FACT input builder now consumes current parser blocks, primary HTML identity/hash and official observations. It rejects missing/incomplete/truncated primary source identity. It does not restore old inputs or fabricate optional metadata. It is available through the existing 425 form adapter; no automatic FACT ingestion, persistence or dispatch hook was added.
3. **Live Diana evidence reproduced a real Archives-CIK/filer mismatch**: the index under `1326200` identifies FILED BY Diana `1318885` and SUBJECT Genco `1326200`; its actual primary-document link is under `1318885`. Previously both raw and metadata `filer_cik` copied Archives CIK. The 425-only correction now uses a unique explicit index FILED BY CIK (otherwise null), consistently in raw and metadata, and retains `sec425_archive_cik` separately. Existing non-425 paths remain unchanged. The earlier shorthand that treated URL CIK `1326200` as Diana's filer CIK is disproven by this fresh official index; old evidence is not rewritten.
4. Filing date, acceptance timestamp and published timestamp are now retained as separate 425 input metadata. Actual action/date/prior context remain in original block text/headings. No date comparison or source phrase is converted into a newly announced event.

Primary prompt v11 / Router v6 identify the additional input fields; Primary output schema, scoring and display code were not modified in this task. FACT output schema remains candidate v2; its new fresh input builder is `sec425_fact_input_v1`.

## Live evidence and results

All files are outside Git in `C:/Users/PC/.codex/visualizations/sec425-fresh-input-20261015`. See `FINAL-AUDIT.json`, `final4-run/LIVE-RECEIPT.json` (final Diana) and `final2-run/LIVE-RECEIPT.json` (Axcelis). Every actual request has its method/URL/status and response bytes/SHA preserved, without credentials or request headers. The source HTML UTF-8 hash in the input equals the native HTTP response-byte hash for these samples.

| Sample | Fresh source / identity | Input result |
|---|---|---|
| Diana/Genco, `0001104659-26-075214` | Index FILED BY `0001318885` / Diana; SUBJECT `0001326200` / Genco. Catalog lists DSX, DSX-PB, DSX-WT for Diana and GNK for Genco. | 72 unchanged source blocks/headings. Both indexed company CIKs and catalog listings automatically reach Router and FACT input. Final raw **and metadata** filer CIK are `1318885`; archive CIK remains `1326200`. No listing is automatically selected as a transaction security. |
| Axcelis, `0001104659-26-011578` | FILED BY and SUBJECT both `0001113232`; catalog ACLS. Full HTML newly fetched, unlike the prior excerpt-only experiment. | 139 unchanged source blocks/headings. September 30, 2025 prior agreement and February 6, 2026 current meeting/vote context are preserved. Only Axcelis has automatic index-based company evidence. Veeco is not assigned Axcelis CIK. |

Diana primary URL: `https://www.sec.gov/Archives/edgar/data/1318885/000110465926075214/tm2612953d47_425.htm`; SHA `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d`. Index SHA `43c48e4ad8a32624fbc8d48b2ec7377ff95c26a9621bcffee7b08c135f3038a7`. Filing date `2026-06-17`; accepted `2026-06-17T21:02:07.000Z`. Block011 contains the current increased offer, 045 explicitly non-binding language, 067 earlier May offers and the June revision. These are manual source observations, not new model classifications.

Axcelis primary URL: `https://www.sec.gov/Archives/edgar/data/1113232/000110465926011578/tm265450d2_425.htm`; full HTML SHA `c5ae0230448ed9ce19660881dca132b8afd96368037e2f80d6446b1018fb2a51`. Index SHA `3b637bc449e6bd0ac53f21e08e40f2644dae45d8985013eadbfc73ff31f02927`. Filing date `2026-02-06`; accepted `2026-02-06T21:41:38.000Z`. Block048 preserves “As previously announced” and the September agreement. **Veeco's `Nasdaq: VECO` appears in block101's heading**, not its text field; both fields are retained unchanged. The audit initially inspected text only, then correctly included headings without modifying any input.

### Remaining Axcelis identity gap

Source material does contain Veeco's company/symbol statement. The gap is **resolver wiring**, not absence of source text: existing 425 `findTransactionParties` returns company-name candidates; `readTicker` is a first-symbol fallback and cannot prove per-party association. The shared catalog selector requires a known CIK; the canonical cover extractor is for issuer DEI/XBRL security observations, not arbitrary narrative counterparties. Index roles here both identify Axcelis. This task does not add a new narrative name/ticker parser, infer a Veeco CIK from a name, or manually inject a company binding. Therefore **automatic official identity for all transaction parties is not complete**. New model transaction-role accuracy and final semantic currentness are untested.

No Submissions endpoint was called: the normal collection already loads the official SEC exchange catalog and supplies all rows for each explicit role CIK. The existing Submissions client/normalizer was inspected; invoking it requires a justified per-party CIK, and fetching Axcelis Submissions would not establish Veeco identity. No DB current reader or refresh service was executed. Catalog observation time is not a historical-symbol validity interval; `catalogConfirmedAt` and transaction role remain null. No common/preferred/warrant classification is claimed for the observed ticker list.

## HTTP accounting and guard correction

**22 native SEC GET attempts, 22 HTTP 200 responses**, all confined to these two filings and the official exchange catalog. **3 additional attempts were rejected before network transmission** by the initial test harness guard. Breakdown: Axcelis baseline 4; first Diana run 3 sent; final2 two-sample run 7; raw-filer correction confirmation 4; raw/metadata consistency confirmation 4. No further SEC requests after successful final capture.

The initial Diana harness allowed only the requested CIK directory, so it rejected the real index-derived same-accession document under the other official CIK. This was a **verification harness restriction**, not SEC rejection or a product parser failure. Its receipt is retained. The corrected guard admits only an exact path literally present in the freshly received SEC index, on the same official origin and same accession. No arbitrary URL, broad full-index scan, prior snapshot or fetch result was injected. Existing `secFetch` retry policy was unchanged; those three denied attempts did not send SEC HTTP requests. No new unused filing was added after the two contrasting approved cases succeeded.

The subprocess reused the existing configured `SEC_USER_AGENT` read-only, only in memory, and restored its original process value. No environment file, key, account or server configuration was changed. All other network origins/provider endpoints were blocked by the harness.

## Validation / limits

- Related regressions **47/47**, including Primary/Router/FACT inputs, exact index-role catalog joins, malformed/wrong-CIK input, missing catalog row, partial source rejection, no-fetch builder, archive-CIK vs FILED BY in raw and metadata, existing catalog/Form25/SC13 behavior and candidate preview guards.
- Existing experiment regressions **102/102** with isolated provider doubles; real model calls **0**.
- Typecheck and diffcheck PASS. Previous 36-file source/request/response evidence hashes unchanged; all 22 fresh response hashes checked.
- DB reads/writes, source-run writes, raw saves, cover/ticker triggers, new candidate/judgment/comparison records, automatic Alerts: **0**.
- Primary actual Router decision and selected main-analysis input: **unverified**. FACT source input construction: verified; FACT extraction/semantic verdict: **not executed**. No fabricated Router, no old response attached to a new filing.
- No UI/browser/login/build run; no UI/CSS changes. No product-completion, live-model E2E or merge-readiness claim. No legacy rows modified or initialized.

Executed from this candidate:

```powershell
$loader = 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-ts-paths.mjs'
$serverOnly = 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-server-only.mjs'
node --no-warnings --import $serverOnly --experimental-loader $loader --experimental-strip-types <external live-baseline/live-final2/live-final3/live-final4.mjs>
node --no-warnings --import $serverOnly --experimental-loader $loader --experimental-strip-types --test <same 14-file related set recorded in regressions.txt>
node --no-warnings --experimental-loader $loader --experimental-strip-types --test <experiment/*.test.ts and experiment/*.test.mjs>
node node_modules/typescript/bin/tsc --noEmit --incremental false
node C:/Users/PC/.codex/visualizations/sec425-fresh-input-20261015/audit-live.mjs
git diff --check
```

Handoff: local main last confirmed ref `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; main's existing `next-env.d.ts` user edit untouched and main worktree not operated. GitHub/Vercel actual commit/runtime, remote DB/env/cron unqueried. No worktree/branch switch, migration, main/3110/Docker operation, merge/push/deploy. Separate local candidate commit, then stop for independent review.
