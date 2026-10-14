# 425 Primary + filing events: first bounded experiment

2026-10-14 KST. **Transport feasibility demonstrated; factual/quality acceptance not passed.** No further tuning or model calls were made after inspecting these results.

## Scope and implementation

- Candidate: `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`, created with the official managed-worktree tool at explicit base `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`, detached.
- Existing eeb4/Kiwoom work was not changed. No DB connection/write, canonical persistence, Monitor/Alert integration, server, UI, login, migration, environment-file change, merge, push or deployment.
- Only this experiment folder is added. `combined.ts` extends the existing runtime Primary schema with `filing_events`; all original Primary properties, instructions, source-selection and user payload remain intact. Event classification is independent of Primary/router event_type, scores and parser facts.
- `runtime-loader.mjs` exposes existing private configuration/provider/repair functions **in this process's module source only**. No production file is edited. `run.mjs` uses existing package/parser/prompt/config/provider functions, temperature 0, existing 5,000 output-token limit, existing Gemini thinking configuration, retry/fallback and Primary repair policy. No separate event call/repair exists.
- Seven experimental kinds: agreement signed, acquisition proposal, consideration changed, shareholder vote result, regulator/court decision, closing, agreement termination/proposal withdrawal. `action` distinguishes withdrawal from termination; `event_state` and `disclosure_context` distinguish proposed/occurred and current/prior/unclear. Literal date/scope stay source wording or null. This is not a canonical event or authorization contract.
- Exact block/quote containment and JSON schema checks are separate from semantic review. No quote normalization, inferred dates, arithmetic or value corrections are applied. A whitespace-only comparison is retained solely as failure diagnosis.
- `events=[]` explicitly means `not_a_finding_of_no_event`, scoped to supplied current-filing blocks. The live cases did not produce an empty result: that meaning passed offline tests only.

## Fixed actual sources and coverage

Exact HTML bytes, URLs, SHA-256, input packages, parser blocks and payloads are outside Git at `C:/Users/PC/.codex/visualizations/sec425-primary-events-20261014/`. `sources.json` is the source manifest. No matching retained 425 baseline response was found in the inspected archive; three actual baseline Primary calls were therefore made. One real Router result per filing was reused for its baseline/combined pair. Both user payloads are byte-identical within each pair.

| Sample | SEC accession / URL | Parser / Router / selected blocks |
|---|---|---|
| Blue Owl agreement | `0001193125-25-267134` — [SEC](https://www.sec.gov/Archives/edgar/data/1655887/000119312525267134/d96968d425.htm) | 1532 / 4 / 12 |
| MasterBrand meeting/integration update | `0001193125-25-220725` — [SEC](https://www.sec.gov/Archives/edgar/data/794619/000119312525220725/d18454d425.htm) | 30 / 4 / 3 |
| Diana/Genco revised offer | `0001104659-26-075214` — [SEC](https://www.sec.gov/Archives/edgar/data/1326200/000110465926075214/tm2612953d47_425.htm) | 72 / 4 / 12 |

SHA-256, respectively:

```text
3d7ec163cc58b040592ecd1cfe0dee329f8061b4bc916b7daea0edb943469b54
60056493e027b95a2824b63969a80f4d6301c2a68a54f3193241ceec2da3e623
9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d
```

These are source-only offline raw-row-shaped inputs, not hydrated/stored production raw rows. Issuer/ticker and filing acceptance metadata were not filled from guesses. No external market data or parent filing lookup was performed. Consequently this is a prompt/provider experiment, not ingest E2E.

## Direct source/response review

| Sample | Actual combined result | Independent finding |
|---|---|---|
| Blue Owl | `agreement_signed`, occurred/current, November 5, 2025 | The action, parties and date are supported by block 056. Block 1505 describes closing as conditional/expected, and no completed closing event was invented. **Content supported; exact evidence FAIL:** output replaced source line breaks with spaces. Do not call this a fabricated event. |
| MasterBrand | `shareholder_vote_result`, **proposed**, October 30 | Block 009 states a future shareholder meeting/vote, not a vote result. **Semantic false positive in the result category**, despite correct proposed state and exact quote. It belongs in unresolved/scheduled context under this experiment's intent. No completed vote was asserted. |
| Diana/Genco | `acquisition_proposal`, occurred/current, revised cash/share offer | Revised proposal content is broadly supported. **Exact evidence FAIL:** quotes for 007/019/070 alter whitespace; the quote assigned to 008 is not its text even after whitespace-only comparison. 008 actually concerns Diana's $2.54 share valuation/VWAP. `consideration_changed` is absent; no transaction closing was asserted. |

Every combined response passes JSON schema (3/3). Strict quote binding passes only MasterBrand (1/3), which fails semantic review. **No case passes the complete schema + exact evidence + intended semantic contract.** Seven kinds in the schema do not mean seven types were validated. Actual vote results, regulator/court decisions, completed closing, termination/withdrawal and genuine prior-background event handling remain untested.

Confirmed source-selection omissions:

- Diana parser block **011** explicitly says it increased its offer; **067** states May 27 cash-price change and June 17 revised cash/share consideration. Neither appears in the Router's four blocks nor in the twelve selected analysis blocks. Block 045 (non-binding/no definitive agreement) is selected, but the combined Primary summary drops the baseline's explicit non-binding qualifier.
- MasterBrand selected blocks 008–010 omit posting-date block 007 and the surrounding integration-update context. Router classified the future meeting as a material update and ran analysis. This is observed gate behavior, not a completed vote.
- All three actual Router runs allowed analysis. No forced diagnostic analysis was needed. A live archive/skip-induced missed event is **unverified**, although the code would bypass the combined field whenever the existing gate skips Primary.

The omissions above are confirmed. That they caused the model's category omission or other output differences is an inference, not established causality. We did not add full-document context, parser rules or company exceptions to seek a better result.

## Primary comparison and existing repair

| Sample | Raw score baseline → combined | Existing adapter score baseline → combined | Quality observations |
|---|---|---|---|
| Blue Owl | 75 → 75 | 75 → 75 | Core signing/conditional closing meaning retained. Existing evidence warnings triggered repair in both runs. |
| MasterBrand | 65 → 65 | 49 → 49 | Both remain future-vote summaries. Combined pre-repair output adds snapshot fields despite generic display; baseline pre-repair output has none. Both final repaired outputs retain generic-snapshot warnings. |
| Diana/Genco | 65 → 75 | 65 → 74 | Combined summary loses explicit non-binding qualification and raw score changes. Combined pre-repair output adds generic snapshot fields. Both have existing validator issues. |

One observation per variant cannot establish that the extra event task caused the score or quality changes. **No-quality-degradation PASS is not justified.** Baseline itself fails original JSON max-length checks on two initial outputs (`score_reason`), and existing Primary repair leaves warnings/schema failures in several outputs. These baseline failures are not new experiment fixes. Raw responses, pre-repair adapter results, repair responses, and final adapter results are separately preserved in `offline-review.json`.

## Calls, usage and costs

15 provider attempts: **3 Router + 3 baseline Primary + 3 combined Primary + 6 existing Primary repairs**. Retries 0, fallback 0, additional event calls 0. Each combined Primary response contains both areas in **one** generation. That is not one total call for the entire pipeline. All attempts returned HTTP 200 and STOP.

| Phase (3 calls each) | Input tokens | Visible output | Thinking | Sum of measured latency |
|---|---:|---:|---:|---:|
| Router | 10,349 | 1,925 | 0 | 7.485 s |
| Baseline Primary | 16,524 | 3,071 | 2 | 14.204 s |
| Combined Primary | 17,859 | 4,479 | 0 | 19.923 s |
| Baseline existing repair | 3,758 | 2,046 | 0 | 9.997 s |
| Combined existing repair | 3,985 | 1,916 | 0 | 15.703 s |
| Total | **52,475** | **13,437** | **2** | **67.312 s** |

Router uses existing Gemini 2.5 Flash-Lite; analysis selects Flash for Blue Owl/Diana and Flash-Lite for MasterBrand using the original block-count/size plan. Per-attempt payload/settings/model/usage/finish reason/latency and raw JSON are retained without keys.

Estimated Standard paid-tier cost **$0.0342709**, not a verified bill. [Official pricing](https://ai.google.dev/gemini-api/docs/pricing), checked 2026-10-14: Flash $0.30/$2.50 and Flash-Lite $0.10/$0.40 per million input/output tokens (including thinking). No cached tokens reported. Account tier, credits and actual billed amount were not inspected.

## Verification and next smallest step

- New isolated tests: 7/7. Existing 425 parser/router/analysis/adapter/fetchPlan scripts: 5/5 passed. Typecheck (`tsc --noEmit --incremental false`) and diffcheck passed.
- Initial local test-launch attempts failed due to relative loader resolution on Windows; rerunning with absolute `file:///.../scripts/resolve-ts-paths.mjs` passed without changing tests or source expectations. No provider requests were made by those launch failures.
- Reproduction: `node --no-warnings --import <absolute file URL to scripts/resolve-server-only.mjs> --experimental-loader <absolute file URL to experiment/runtime-loader.mjs> --experimental-strip-types <absolute experiment/run.mjs> prepare|live <new external evidence folder> [existing env file]`. A source manifest and exact source files are required. `live-started.json` is create-new; existing run output is never overwritten. Do not rerun the frozen trial without authorization.
- Existing dependencies were reused via an ignored node_modules junction; no install/lockfile changes.
- Next smallest proposed step (not performed): offline-only contract decision for future votes vs results and exact quote encoding; then inspect bounded source-selection loss at Diana 011/067 before authorizing any second model trial. Keep these raw outputs as the fixed baseline.

Handoff: local main ref read at start = `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`; GitHub same SHA was supplied by the main handoff and was not independently queried here. Vercel prior READY deployment `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU` was supplied; its SHA/current deployment was not rechecked. Remote migrations/Render/cron were not queried or changed. The main workspace's next-env.d.ts was not touched. No integration/push/deploy approval or readiness claim.
