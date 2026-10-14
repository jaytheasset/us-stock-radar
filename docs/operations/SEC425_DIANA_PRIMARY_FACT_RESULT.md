# Diana: independent Primary and FACT, two-request result

2026-10-15 KST. Candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, base `0c5a4c3be131679ff43b483619d3fc17f544c887`, detached. **Exactly two real provider requests, both HTTP200/STOP. Both fail their unchanged local output contracts.** This is a completed bounded diagnostic, not a product/semantic/identity acceptance PASS. No correction or additional call follows.

The handoff briefly conflicted with the old eeb4/Round4 context. Read-only state checks found eeb4 unchanged at45359d36 and the expected three untracked diagnostic files in this candidate. Main clarified the active task before any new request or edit. Those files were preserved. The early statement of zero file changes applied only to the post-compaction inspection; the overall task already included those three files. Round4 was not repeated and its budget was not reused.

## Preserved inputs and actual execution

Evidence root: `C:/Users/PC/.codex/visualizations/sec425-diana-primary-fact-20261015`.

- SEC accession `0001104659-26-075214`, primary document `https://www.sec.gov/Archives/edgar/data/1318885/000110465926075214/tm2612953d47_425.htm`.
- Original native HTML SHA256 `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d`, from the preserved successful collection's `sources/response-4.body`. Native HTML copied unchanged to `trial/diana.htm`. No SEC request this task.
- Preserved actual Router: `sec425-router-reference-once-20261015/trial/model-output.json`. Recomputing the existing normalizer exactly matches `normalized-router.json`. Raw stage `router` becomes null, but **both raw/normalized shouldRun=true and deterministic archive=null**. No archive override, new Router or inferred Router answer.
- Actual `buildSec425AnalysisPromptForInput` output equals the preserved `offline-primary-prompt.json`. The existing model policy selects Flash for12 blocks/one source/3,103 text characters. Selected original blocks:007,008,009,018,019,020,043,044,045,069,070,071. No supplementary facts or truth labels were injected.
- Independent `buildSec425FactInput` exactly matches the prior freshly collected FACT input: all72 blocks, official observations and filing roles. No Router or Primary response in FACT. Existing FACT candidate v2 and `SEC425_FACT_WIRE_SCHEMA` are used; **FACT remains experimental, not a production extraction integration**.
- Existing configuration read into memory only. Both models `gemini-2.5-flash`, maxOutputTokens5000, temperature0, thinkingBudget0. Actual runtime model selection and serializer reused. Diagnostic120s transport deadline; full product runner not invoked because it may retry/repair.
- New plan SHA256 `9cd8f03f1c47df420d8ebbd1940b5bda7d047dbdfb53504b9fd7fb2bfc40bd4c`; independent primary/fact slots, durable reservations before fetch, one fetch per slot.124 frozen source/prompt/code files rechecked after completion. Old ledgers remain untouched. Authentication/common-integrity failures halt both slots; Primary output failure alone permits the independent FACT request.

## Source-based assessment, separate from mechanical validation

The original HTML and the unchanged transmitted blocks were directly read. `native-source-reading-text.txt` is a local HTML-decoded reading aid, never model input or a substitute quotation. Parser whitespace/punctuation and heading placement are distinguished from native HTML. No output was normalized to manufacture exact quotations.

| Dimension | Primary actual output | FACT actual output / source assessment |
|---|---|---|
| Current action | Revised offer, non-binding, no definitive agreement. Supported by019/045 and original letter. | `confirmed`, `revised_acquisition_proposal`, June17 current announcement. Supported by011/037/007; mechanical currentness still unresolved because its exact evidence fails. |
| Consideration | $24.80 cash + one Diana share; $2.54 uses30-day VWAP; total$27.34,53% and6% premiums. Summary preserves valuation basis but labels total without explicit “implied.” | Statement retains total **implied**$27.34 and ownership exclusion. Separate terms$27.34 and$2.54 abbreviate qualifications, while associated evidence contains implied/VWAP basis. Cash distribution reduction is included. No new calculation. |
| Non-binding/completion | Summary and Offer Status preserve non-binding/no definitive agreement; no completed acquisition asserted. | Non-binding term and045 evidence preserve the distinction between a submitted proposal and a binding deal. No completed acquisition asserted. |
| Conditions | No financing/Star Bulk/distribution/full tender conditions.042/067/068 were **not selected**; distinguish input coverage from omission of supplied information.070 conditional second-step merger **was supplied but omitted**. | Includes no financing condition/$1.433bn, majority on fully diluted basis, rights-plan **termination OR inapplicability**, affiliate provisions and F-4 effectiveness. Long conditions quote ends “other customary”; value completes “conditions” using source continuation069, which it does not cite. Star Bulk participation abbreviates the no-completion-condition; associated quote retains the exact substantive qualification. No complete condition/qualification PASS. |
| Transaction types | Investor-facing acquisition description; no separate FACT type claim. | `acquisition`, `tender_offer` are source-supported; root proof does not itself mention tender offer, which appears in067 subsidiary evidence. `merger`/conditional second-step structure070 omitted although supplied. Do not call this complete transaction-type coverage or assert a newly completed merger. |
| Current versus past | Current revision retained; no May event promoted.067 May history was not supplied to Primary. | May4 subsidiary/tender background appears in party evidence; May27 is not a separate current announcement. Current June17 revision retained. No full historical-event extraction claim; the contract is one current announcement. |
| Engagement request | Delay request is explicitly in the final summary sentence, and June18 is in current_changes/key_evidence. Validator warning is **not evidence the action was omitted**. | Currentness context mentions request to delay; no assertion the meeting actually was delayed. |

Native original011/037 supports Diana acquiring Genco shares not already owned;042 supports the Star Bulk condition qualification;067 distinguishes May4 tender, May27 price increase and June17 revision;068/069 list conditional requirements;070 states a second-step merger only **if** the offer completes. FACT did not promote these past actions or future completion to a new completed transaction, but omitted the conditional merger structure. Semantic support for the central proposal does not erase output-contract failures.

## Mechanical results and unchanged adapter effects

**Primary:** raw schema fails only `score_reason`188/180 characters. Existing adapter succeeds but emits `current_changes not reflected in Snapshot or Summary: Engagement Request`. `isCurrentChangeCovered` extracts the June18,2026 marker from the result; visible quick_take/summary/snapshot omit that date, and key_evidence is not part of visible coverage. The action itself is present. The runtime's repair-warning filter would request repair; this diagnostic records that condition and makes **zero repair calls**.

Raw `tickers=[{},{}]` is accepted by the existing unstructured object-items schema; it is **not** successful DSX/GNK list extraction. Existing adapter drops empty rows and adds already-returned primary GNK/NYSE. Raw `material_progression` score75 becomes74 under the existing cap. The raw primary GNK/NYSE remains; related_tickers stays empty. Raw response, adapted response and these differences are separate artifacts. No adapter/schema/policy was changed, and adapter success does not rehabilitate raw schema failure.

**FACT:** local schema fails eight quote-length constraints. Existing field-binding shape check passes; citation check fails. Full independent traversal finds32 proofs (28 ordinary evidence entries plus4 action/context entries):

-2 exact,28 differing only by whitespace/newlines in the same transmitted field,2 wrong `source_field` references.
-Wrong fields: root006 and Genco004 cite `heading`, which is null; their literal date/subject content exists in `text`. Dates/company content are not absent from the source.
-8 exceed240 characters. The ordinary validator `bindings` array contains28, **not all32**; the4 action/context proofs also undergo the separate currentness checks.
-Whitespace-only diagnostics do not modify, accept, or relocate any quote. All original failures remain failures. Currentness remains `unresolved/action_or_context_evidence_missing_or_invalid`, even though direct source reading supports the current revision.

## Company identity versus transaction and filing roles

- Official index: Diana CIK0001318885 **filed_by**; Genco CIK0001326200 **subject_company**. Native source establishes acquirer/target roles separately; filing roles alone do not.
- FACT Diana/DSX automatically corroborates against collected official company observations: CIK0001318885. `transactionRoleVerified=false`, `historicalTickerVerified=false` remain unchanged.
- FACT Genco/GNK remains unresolved. Official GNK/0001326200 data **exists**; model name “Genco Shipping & Trading Limited” differs from official “GENCO SHIPPING & TRADING LTD.” `compareSec425PartyIdentities` normalizes case/space/comma/period only, so it does not expand Limited/LTD. No alias, manual binding or ticker replacement was added.
- Primary GNK/NYSE corroborates CIK0001326200 using existing filing identity, without claiming transaction-role approval. FACT Star Bulk and4 Dragon remain unresolved; their null symbols are not filled. Catalog DSX/DSX-PB/DSX-WT observations do not independently establish every listing's security type.
- FACT `publicationStatus=not_ready`, `available=false`, `matchEligible=false`, `alertEligible=false`, `corrected=false`. Company corroboration and semantic review grant no publication/Alert authority.

## Requests, evidence and verification

| Request | HTTP/finish | Input | Output | Total | Latency | Result |
|---|---|---:|---:|---:|---:|---|
| Primary |200/STOP|7,408|1,134|8,542|6.150s|local output validation failed|
| FACT |200/STOP|10,174|3,936|14,110|16.664s|local output validation failed|
| Total |2 requests|17,582|5,070|22,652|22.814s|budget consumed; stop|

No thinking-token field was reported. Both responses identify standard service tier. Historical2026-10-14 Flash price basis ($0.30/M input,$2.50/M output) implies$0.0179496 total; current pricing/invoice/credits were not queried and this is not billed-cost verification. Production cost estimator does not provide Gemini pricing.

`trial/*-request.json` contains exact sent bodies; `*-response.json`, `*-output-text.txt`, `*-model-output.json` preserve original responses. `primary-adapted.json`, `fact-candidate.json`, `*-validation.json` and new `ledger/attempt-*`/`result-*` keep separate stages. `FINAL-EVALUATION.json` records hash rechecks,32-proof diagnostics, identity, raw→adapter differences and usage. Credential scan found no credential echo; no secret/environment file was written.

Before calls: experiment tests127/127 (including new guard/branch7); related regressions54/54; `npm run typecheck -- --incremental false` PASS. The initial narrower related invocation37/37 also passed;54 is the complete rerun including the prior catalog/source selection set, not54 newly added tests. Logs are outside Git (`experiment-tests.txt`, `related-full-tests.txt`, `typecheck.txt`). Node commands use `--experimental-strip-types --test`, `scripts/resolve-server-only.mjs`, and absolute file-URL loaders (`experiment/runtime-loader.mjs` for experiment/private serializer exports, `scripts/resolve-ts-paths.mjs` for related tests). Preparation/send use:

```text
node [same server-only import/runtime loader/strip-types] lib/sources/sec/forms/425/experiment/diana-dual-run.mjs prepare
node [same flags] lib/sources/sec/forms/425/experiment/diana-dual-run.mjs send primary <frozen plan hash>
node [same flags] lib/sources/sec/forms/425/experiment/diana-dual-run.mjs send fact <frozen plan hash>
node lib/sources/sec/forms/425/experiment/diana-dual-evaluate.mjs
git diff --check
```

Do not rerun preparation/send to obtain new answers. Create-new evidence and consumed slots intentionally block that. Tests use synthetic HTTP responses and temporary ledgers, never provider requests. Only the three existing diagnostic files, new runner/evaluator and this report are committed. All product files, especially Veeco identity handling, are unchanged from base. Final diffcheck/commit/clean verification is recorded separately.

New Router/baseline/retry/repair/fallback/token-count/LLM-evaluation/Axcelis/SEC requests0; DB/storage/Alert0. No Monitor integration, environment change, server/main/3110/Docker operation, merge/push/deploy. Browser E2E was not run: no UI/auth changes. Local main ref read from candidate remains `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; GitHub/Vercel/runtime/remote DB/cron remain unqueried. No operational equality or merge readiness claim. Stop for independent review.
