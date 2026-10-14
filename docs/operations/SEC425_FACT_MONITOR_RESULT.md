# SEC425 FACT + Monitor candidate result

2026-10-15 KST. Minimal candidate implemented and tested; **live extraction selection2/3, full quality0/3**. It is not ready for canonical FACT publication or automatic Alerts. Exactly three provider requests completed, each HTTP200/STOP. No response correction, retry, fallback, Router, new baseline, Primary or live natural-language compiler call.

## Implemented boundary

`425/factsCandidate.ts` separates three current announcement types from non-exclusive transaction tags, preserves per-party name/role/ticker/participation and source evidence, and requires actual term values with evidence. Unknown values remain nullable. The source envelope preserves accession, official URL, SHA and raw-HTML versus public-text-excerpt representation. The validator reports shape, field-evidence presence and exact quotations; it does not establish semantic correctness. **Every candidate stays available=false/not_ready/matchEligible=false/alertEligible=false**, regardless of schema result. No storage/reader registry/automatic ingest hook or new approval system was added.

The existing `/monitor` input now offers four425 examples that only set editable text. Build uses the existing natural-language compiler prompt/ledger with an optional server-selected candidate catalog and unchanged default-family path. The preview endpoint retains read-only auth and origin checks. No regex sentence parser was added. Source-symbol role selectors are not official identity resolution. Preview conditions remain outside the production READY registry; existing persistence/matcher reject them. UI shows interpretation, unsupported or ambiguous requirements and disabled creation. No actual saving or matching success is simulated.

Primary already supplies investor-facing current_changes but lacks the new FACT contract; its summaries/scores were not reused as evidence. The existing product Primary prompt, model policy, repair and adapter remain unchanged. This trial does not determine a universal need for an additional production LLM call, and did not rerun Primary quality.

## Actual source results

| Case / accession | Output | Independent source assessment |
|---|---|---|
| Blue Owl /0001193125-25-267134 | definitive_agreement_signed; merger | Current signing selected correctly. Initial/final merger direction is correct and closing remains future. Full quality fails on ticker attribution, omitted qualifiers and citation format. |
| Held-out Axcelis /0001104659-26-011578 | definitive_agreement_signed; merger | **FAIL:** the excerpt explicitly describes a previously announced September2025 agreement; the current February2026 event is a stockholder meeting/vote. Model promotes old agreement existence into a current announcement, contrary to frozen truth. |
| Diana /0001104659-26-075214 | revised_acquisition_proposal; acquisition+tender_offer+merger | Current non-binding revised offer selected correctly, cash/share components preserved without computation. Several evidence/qualifier/party-currentness and formatting limits remain. |

The held-out input is three preserved excerpts from the [official SEC document](https://www.sec.gov/Archives/edgar/data/1113232/000110465926011578/tm265450d2_425.htm), parsed by the existing425 parser. It is not publisher raw HTML or full-filing ingestion E2E. Direct downloads failed; acquisition method/scope and pre-call negative truth were recorded before execution. Its SHA `0455973a6f0c857e41c0ac569838bb8d9ee251b77dd61b1fb0fa89e58d469af2` identifies the **excerpt artifact**, not original HTML. No cover ticker was injected. This is a real unseen source failure, not a synthetic fact sample or a post-result truth change.

Blue Owl and Diana use the same saved user contents as Round5, with28/27 blocks and source SHAs `3d7ec163cc58b040592ecd1cfe0dee329f8061b4bc916b7daea0edb943469b54` / `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d`. Blue/Diana/MasterBrand Round5 responses are separately retained as **old-contract references** (signing/proposal/none). No new roles/tickers/tags were filled into old output and called model validation; MasterBrand was not a new provider call here.

### Party and condition findings

- **Blue Owl target ticker:** returned `OBDC II` is a defined company abbreviation in056/1518, without source support as a current trading symbol. This is an input-grounding failure, not a global assertion that no such ticker exists. Literal containment cannot distinguish an abbreviation from a trading symbol. The code did not replace it with null or another symbol.
- **Blue Owl acquirer ticker:** `OBDC` is explicitly NYSE:OBDC in1517. It is independently supported, not borrowed from the future combined symbol. The external manager's ticker in1518 was not copied to the target. Official company/security identity matching remains unverified.
- **Blue Owl roles:** target/acquirer/Merger Sub are source-supported. Adviser participation omits the important limited-purpose contractual qualifier from both value and selected evidence. Term values are now actual values rather than nine labels, but share-conversion summary omits the existing-OBDC-owned-share exclusion. NAV basis is described without the table's alternative price-based branch; input header limitation and incomplete output are distinct. No financial computation or invented amount was found/added by code. Future closing has a separate conditions term; its expected-quarter field alone drops that qualification.
- **Axcelis:** parties and past merger structure exist in the excerpt; this does not cure wrong currentness. Null tickers are appropriate because cover symbols were not supplied. Name-only party quotations do not independently explain all assigned roles, even when the full historical paragraph supports them. Leave the erroneous confirmed output intact.
- **Diana:** DSX for acquirer Diana and GNK for target Genco are separately explicit in011. Star Bulk partnership and no-completion condition are stated in042; its ticker stays null. Other advisers retain null tickers. 4 Dragon is genuinely named in historical May4 evidence067; current revised-offer participation is not independently restated in that quote. Do not call that entity invented or automatically assert current continuity.
- **Diana conditions:** implied27.34,24.80 cash plus one share valued2.54 and non-binding/no-financing conditions remain supported. `OR inapplicability` and fully diluted basis are now retained in the long condition value. Its evidence stops at068 while the final word continues in069 heading, a binding-coverage issue. The cash adjustment for distributions in067 is absent. The scalar27.34 field drops implied wording that remains in statement/quote. Several term values copy long passages instead of concise explanations. Planned merger tags are not completed-closing assertions; root007/011/045 evidence does not alone cover tender/planned-merger tags found in067/070.

These errors/limits are recorded without modifying raw output or adding company-specific rules. Every item remains blocked from consumption. A source-backed ticker mention is not canonical issuer/security identity, and correct quotations cannot prove the selected current announcement.

## Mechanical, quotation and meaning are separate

| Check | Blue Owl | Axcelis | Diana |
|---|---:|---:|---:|
| Field-evidence presence/literal test |PASS |PASS |PASS |
| Exact quotations |9/22 |10/10 |19/19 |
| Quotes over240 characters |6 |1 |6 |
| Local schema / full citation contract |FAIL |FAIL |FAIL |
| Current-announcement selection |PASS |FAIL |PASS |
| Full quality / publication |FAIL / blocked |FAIL / blocked |FAIL / blocked |

Total51 citations,38 exact,13 whitespace-only differences (all Blue Owl),13 overlength. No wrong block IDs. Diagnostic whitespace comparison does not accept or normalize quotations. The preexisting local numeric240 versus provider description-only bound is explicit and unchanged. No malformed/output failure was repaired. Literal/presence checks passing on the unsupported `OBDC II` ticker demonstrate why they cannot publish FACTs.

## Monitor/UI validation

Actual Next `/monitor` DOM was exercised at CSS1440×900,900×900,390×900; document widths1425/885/390 showed no horizontal overflow. Four examples only populated text; edited text, supported interpretation, unsupported prediction and ambiguous company/role messages worked. Candidate create stayed disabled and standard create was absent in425 preview. Existing reverse-split preset still produced its standard review; no save was clicked. Readable labels replace internal enums.

This used an explicitly simulated auth/list API plus injected compiler outputs through the actual handler/compiler. **Not real login, live natural-language provider, DB or automatic Alert E2E.** Browser logs in the final fixture check contained no warnings/errors. Desktop viewport-only capture was clipped by the IAB host surface, so final desktop/medium evidence uses full-page captures at measured CSS widths. Mobile viewport capture is390×900. Owned3147/3148 servers and viewport override were cleaned up;3110 untouched. API client request was then isolated into a tested explicit helper to preserve the existing default compiler callsite; no visible layout or request semantics changed.

See [preparation/design](SEC425_FACT_MONITOR_CANDIDATE.md) and external `UI-FIXTURE-CHECK.json`/screenshots. No mocked provider output is hardcoded in the product endpoint.

## Usage and evidence

| Input | Model | Input tokens | Output | Thinking | Latency | Estimated USD |
|---|---|---:|---:|---:|---:|---:|
| Blue Owl |Gemini2.5 Flash |6,984 |2,818 |0 reported |12.846s |0.0091402 |
| Axcelis |Gemini2.5 Flash-Lite |1,157 |1,263 |0 reported |3.667s |0.0006209 |
| Diana |Gemini2.5 Flash |6,288 |3,122 |0 reported |13.191s |0.0096914 |
| Total |**3 HTTP200/STOP** |**14,429** |**7,203** |**0 reported** |**29.704s** |**0.0194525** |

Total21,632 tokens. Cost is an estimate using the previously verified2026-10-14 Standard snapshot (Flash0.30/2.50, Lite0.10/0.40 USD per million input/output), not a current invoice; no additional pricing API. Different schema and held-out input prevent a clean efficiency/causal comparison with Round5.

Evidence root `C:/Users/PC/.codex/visualizations/sec425-fact-monitor-v1-20261015`; frozen plan/request/response/receipt artifacts under `trial/`. Plan SHA `8e0ad7ac38df558a733c1a01db6cb4ed89c935da92800a4d5a7a432a31d15bad`. `FINAL-FACT-MONITOR-EVALUATION.json` preserves the actual typed output, original assessment, direct source annotations, diagnostics and accounting. Original raw responses and validator files are unchanged. Three durable request slots consumed; no further requests authorized in this run.

## Verification and remaining product step

Candidate/Monitor/default-family regression107/107, prior experiment+new guard102/102, existing425 scripts6/6 and typecheck/diffcheck PASS. Three initial source-string UI tests failed due to endpoint placement; their expectations were preserved and the standard callsite kept intact, with a separately tested425 request helper. No test expectation was weakened.

**Production build did not pass.** The normal package build command (`next build`, no pre/post scripts) failed in Turbopack because the existing candidate node_modules junction points outside its filesystem root. An App Router webpack compile attempt separately failed on a global-only pure-selector error at `components/dashboard-v2/StockRadarDashboardV2.module.css:1`. That selector and file are unchanged from base d3166696; a baseline build was not rerun, so no baseline execution result is claimed. An earlier scoped compile exited0 but its manifest contained no target App Router paths, so it is not credited as route/build verification. All three logs are retained (`build-normal.txt`, `build-app-compile.txt`, `build-compile.txt`). No Next, node_modules, unrelated CSS or configuration was changed to make builds pass. Actual Next dev `/monitor` rendering and offline handler tests remain separate evidence; complete production build/route bundle validation is blocked, not PASS.

Next product connection requires resolving currentness and source-grounded ticker/qualifier quality first, then an independently verified identity/publication boundary, official reader/persistence/ingest integration and end-to-end matcher/Alert tests. Live compiler and actual authentication/storage remain unverified. None is implemented by an `available:true` shortcut or a permanent manual-admin requirement. No feature expansion, post-response tuning or new call was performed after these results.

Base `d3166696b83b7899dc646a942c9eec42044cbc03`, existing detached candidate; final isolated commit/clean status in final receipt. Main/other worktrees/Primary/default-family policy/DB/migration/env/account/cron unchanged. Current GitHub/Vercel/remote DB unqueried. No merge/push/deploy, no full feature-completion or merge-ready declaration. Stop for independent review.
