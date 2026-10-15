# 425 official counterparty identity + bounded Router/Primary/FACT trial

2026-10-15 KST. Base `7d29f4f653c93fda3688064e1b80f0340850fb57`, existing detached candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`. No worktree/branch change or legacy-data repair. Prior source/request/response evidence is preserved.

## Result: identity input verified; provider trial halted at request 1

The new source-backed identity connection resolves Veeco automatically from the **newly collected** explicit company/trading-symbol pair plus official SEC catalog. The bounded model trial then stopped on its first Router response: HTTP200 / STOP, but `/evidence/2` was **480 characters against the existing 300-character local limit**. This is an output-contract failure, not a transport failure. No Primary or FACT request was made. The other five planned slots remain unused under an immutable HALTED ledger. No regeneration, correction, retry, fallback or alternative baseline was attempted.

## Minimal implementation

- Extend existing `sourceTickerSelection.ts` with a narrow company `(exchange: ticker)` check. It reuses exact symbol selection and the already-loaded official SEC catalog. It requires the complete company-name tokens, exact symbol/exchange and one unique official mapping. Only case/whitespace/comma/period differences are tolerated; no legal-suffix removal, alias dictionary, substring company lookup, ticker-only match or inferred CIK. Prefix/suffix company mismatches and multiple CIKs remain unresolved.
- Reuse existing `buildCommonFormParserInput` and 425 adapter/parser in the raw-collection path, preserving heading/text and source block IDs. Only pair observations and their official rows are added to raw metadata; the full catalog and another full copy of parser text are not added. Failure of this auxiliary check yields unavailable evidence rather than aborting raw collection.
- Carry those observations through the existing Filing Package into Router, Primary and independent FACT input builders. Index filing roles remain separate from narrative company observations. `filingRole:null`, `transactionRole:null`, `historicalTickerVerified:false` on a narrative match are deliberate: this does not establish acquirer/target, future combined-company identity, security class or historical validity.
- Compare unchanged FACT party claims to automatically collected index/source observations when the actual fresh package is supplied to the candidate factory. The package accession/hash must match the candidate source. Exact name/ticker agreement can corroborate CIK; conflicting/ambiguous claims remain blocked. This is not a manually filled optional binding. Original model party values and claimed roles remain separate and unmodified. This output comparison passed isolated tests; **live FACT output binding was not exercised because FACT was not called**.
- Extract the existing Gemini request-body construction into a pure helper used by runtime and diagnostics. JSON byte-equivalence tests cover Router, Primary, FACT-key/default and another family; existing retry/repair/fallback functions are not changed or invoked by the experiment. The experiment loader's private exports are idempotent, including when Node invokes its loader more than once.
- Prompt input versions: Primary v12, Router v7, FACT input v2. No score policy change, no persistence or Alert connection.

Recognition is intentionally narrow, not a general narrative entity resolver. A source-stated abbreviation, unlabelled future ticker or model output is not enough. An exact current catalog observation still does not prove a future listing or transaction role. Alias/name variants outside the stated normalization remain unresolved.

## Fresh SEC source verification

Evidence root: `C:/Users/PC/.codex/visualizations/sec425-veeco-stage-trial-20261015`; fresh request/response bytes and packages are in `sources/`. **7 native SEC GET requests, all HTTP200, no denied requests in this collection.** Existing `runSecRawIngest(dryRun:true)` captured the unchanged result of the actual `fetchSecEdgarRawItems`; all persistence hooks were guarded and called zero times. No previous snapshot or saved Router was injected.

| Source | Official identity / input evidence |
|---|---|
| Diana/Genco `0001104659-26-075214` | FILED BY Diana `0001318885`; SUBJECT Genco `0001326200`. Catalog lists DSX/DSX-PB/DSX-WT and GNK under their respective CIKs. Those lists are observations, not verified security-type selection. 72 current parser blocks/headings retained. |
| Axcelis `0001104659-26-011578` | Index FILED BY and SUBJECT both Axcelis `0001113232`, ACLS. Separate source heading contains `Veeco Instruments Inc. (Nasdaq: VECO)`; exact official catalog match supplies Veeco `0000103145`, VECO, Nasdaq. No filer CIK copying. 139 blocks/headings retained. |

The Veeco proof is the literal heading span in `425_primary_101` **in this collected sample**. No company, CIK or block ID is hardcoded in the product matcher. Its company name, ticker and CIK are derived from the fresh source/catalog. Axcelis's separate source pair remains unresolved where the narrow complete-name rule cannot establish the pairing; its independent index/catalog observation remains available.

Full HTML SHA: Diana `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d`; Axcelis `c5ae0230448ed9ce19660881dca132b8afd96368037e2f80d6446b1018fb2a51`. Actual HTTP bytes are preserved; source HTML hashes match the package inputs. Filing dates/accepted times are separate metadata. Diana's revised offer/non-binding/prior-offer language and Axcelis's September2025 agreement/February2026 meeting language remain in the original source fields and order. Their presence is not a new semantic model verdict.

## Frozen request plan and budget

`trial/plan.json` SHA: `29b9089303bb240bbebd81a453bbfce5f039fdbfd592e1eb67f53a4164277417`.

| Stage per filing | Planned model / behavior | Actual |
|---|---|---|
| Router | Existing `gemini-2.5-flash-lite` selection | Diana only, 1 request |
| Primary | Actual Router → existing `buildSec425AnalysisModelPlan` → Flash or Flash-Lite; preserve skip policy | 0 |
| Independent FACT | Configured `gemini-2.5-flash`; unaffected by an ordinary Primary skip | 0 |

All slots: max output 5,000, temperature0, thinkingBudget0. Router/Primary use the existing runtime schema converter; FACT would use its existing `SEC425_FACT_WIRE_SCHEMA`, not silently switch to the Primary converter. Exact wire schemas and prompts are saved before transmission. The experiment applies a 120-second abort deadline; the existing runtime itself has no fetch deadline and its policy was not changed.

`staged-guard.mjs` uses create-new durable reservation files, fsync and a directory lock before any HTTP. Case/stage is single-use, total cap6, prior uncertain/failed attempts halt all subsequent stages. Failed/timeout/incomplete attempts consume a slot. A Primary slot requires the actual validated Router policy; a legitimate skip does not consume the independent FACT slot. There is no real `runOpenAiJsonPrompt`, repair loop, fallback or token-count API invocation.

The live ledger contains exactly **one** attempt (`diana-router`) and `HALTED.json`. The existing normalization of the raw Router was saved separately for diagnosis; its `runPrimary:true` does **not** authorize a follow-up after schema failure. Provider request SHA `d3089c5617e4f57f376b5825fd01fc0484a72862368089c764b8707a10f804ca`; response SHA `afede64b391fb1726a3ef5087ddce9128618209bb74c0d1e967bd9b134ac8eab`.

## Failure and separate semantic review

- Model identifier: `gemini-2.5-flash-lite`; HTTP200; finishReason STOP; latency **2,756ms**. Input5,710 / output784 / total6,494 tokens. No incomplete generation or timeout occurred.
- Local Router schema rejected only `/evidence/2`: **480 > 300**. The unchanged provider adapter conveys maxLength as an instruction/description rather than a hard wire-schema limit. This explains why an HTTP-success response can fail local validation; it does not prove that the new identity fields caused the long quote.
- Four quote lengths: 124, 289, 480, 158. All four correspond to their selected source passages after whitespace collapse, but none is byte-exact in the supplied fields. Whitespace comparison is diagnostic only; no quote was normalized, shortened or accepted by rewriting it. Citation format is separate from semantic review.
- Manual source review: `material_update_reason` correctly says **revised offer**, $27.34 implied value, $24.80 cash and one Diana share. `routing_reason` instead calls it a **new acquisition proposal**, an inconsistency worth review. Router selected008/019/070/044; source070 remains conditional future completion. This is not a FACT classification result, nor proof that all non-binding/other conditions would survive Primary analysis.
- Primary quality/score/condition preservation: **not tested live**. FACT classification and output identity binding: **not tested live**. Axcelis model behavior/new-signing false-positive removal: **not retested**. Source identity input passed; the two complete model pipelines did not pass or finish.

Cost basis: using the *historical 2026-10-14* preserved Flash-Lite Standard rates ($0.10/M input, $0.40/M output), this one request estimates **$0.0008846**. Current pricing/invoice was not rechecked. The existing runtime's own Gemini cost estimate is unavailable (`getPricing` only defines gpt-5-mini); no fabricated runtime billing result is reported.

## Verification and handoff

- Related regression set **50/50**: existing47 plus3 focused trading-pair tests; actual collection→package→Primary/Router/FACT input tests now include a non-index company and unchanged raw party comparison.
- Experiment suite **114/114**: previous102 plus7 stage-budget/halting/concurrency/skip tests and5 request byte-equivalence tests. HTTP calls in these tests are doubles, not provider requests.
- Typecheck and diffcheck PASS. Frozen preparation files and36 prior source/request/response evidence hashes unchanged. No behavior or prompt tuning after the failed live response.
- DB reads/writes, source-run/raw/cover/ticker/judgment/comparison storage, automatic Alerts: **0**. No UI/browser/build, migration, main/3110/Docker lifecycle, environment-file changes, merge/push/deploy.

Run commands used the existing absolute Windows file-URL loaders (`scripts/resolve-server-only.mjs`, `scripts/resolve-ts-paths.mjs`; `experiment/runtime-loader.mjs` for provider-serialization helpers), Node `--experimental-strip-types --test`, `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and `git diff --check`. Real collection, stage runner, plan and evaluation scripts/receipts remain outside Git in the evidence root; product changes, direct tests and this report are the local candidate commit.

Local main last confirmed ref `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; its existing user `next-env.d.ts` modification was not touched. GitHub/Vercel commit/runtime, remote DB/environment/cron unqueried. No full Monitor completion, model-quality PASS or merge-readiness claim. **Stop for independent review; do not use the remaining slots or rerun this case.**
