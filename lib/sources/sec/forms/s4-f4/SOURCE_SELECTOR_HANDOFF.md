# S-4/F-4 core section selector candidate — 2026-10-06

Scope completed: standalone transient HTML selector and offline review of the existing five cases / 42 evidence items. The existing adapter, parser, Primary prompt/output, FACT schema and runtime are unchanged. No provider, DB, persistence, Monitor, Matcher, Alert, 425, server or deployment integration.

## Implementation and use

`sourceSelector.ts` exports `selectS4F4Sources`. Supply one full current HTML source with accession, URL, filename and role. TOC labels are matched to actual body headings; core heading sections are selected in document order, including conditions and exceptions. Tables preserve cells, spans and subsequent in-section footnotes. Column captions cannot terminate sections. Overlapping ranges are unioned; the first heading labels a merged range.

Direct economic definitions are limited to 12 supplements, each with up to eight following blocks for page continuations. There is no recursive reference graph, company-specific rule, FACT calculation, or fixed payload truncation. The input HTML stays transient. Output holds only selected evidence and compact document/section attribution, SHA-256 and half-open HTML UTF-16 coordinates. Do not put the input HTML or a full raw row into `binding.original`, snapshots or checkpoints.

Parent sources require explicit `amendment-comparison` purpose; exhibits require `direct-supplement`. Current amendment content works without a parent. Presence of parent context does not itself establish changes. Five reviewed packets are current-only. Optional real-source smoke tests verified attribution for parent and three exhibits; supplemental indenture returned no selected core heading (not an absence claim), and registration-rights selection is broad. Optional-source completeness is not established.

```powershell
node --experimental-strip-types lib/sources/sec/forms/s4-f4/coverageOffline.mjs <existing-archive> <new-external-output-directory>
node --test --experimental-strip-types lib/sources/sec/forms/s4-f4/sourceSelector.test.ts lib/sources/sec/forms/s4-f4/parser.test.ts lib/sources/sec/forms/s4-f4/adapter.test.ts lib/sources/sec/forms/s4-f4/analysis.test.ts
npm run typecheck -- --incremental false
git diff --check
```

The harness emits locators requiring manual source/context review, never semantic PASS based on a phrase. Its five-case manifest is test data, not selector logic. Output must be new and outside the repository and original archive.

## Offline acceptance result

Final external artifacts: `C:/Users/PC/.codex/visualizations/s4-f4-selector-eeb4-20261006-release/` (`AUDIT_REPORT.md`, `reviewed-coverage.json`, `coverage-locators.json`, `context-review.md`, five selected packets). Original archive `C:/Users/PC/.codex/visualizations/s4-f4-coverage-audit-20261005/` remains read-only. No originals or generated packets are committed.

| Case | Phrase locators | Sufficient core | Sufficient with ancillary references unresolved | Selected chars | UTF-8 bytes | Local token estimate |
|---|---:|---:|---:|---:|---:|---:|
| Capital One / Discover | 9/9 | 9 | 0 | 529,468 | 533,052 | 105,894–176,490 |
| Kodiak / Ares | 9/9 | 6 | 3 | 730,460 | 734,009 | 146,092–243,487 |
| Freenome amendment | 9/9 | 8 | 1 | 1,199,142 | 1,206,454 | 239,829–399,714 |
| First Majestic / Gatos | 9/9 | 9 | 0 | 547,671 | 551,538 | 109,535–182,557 |
| STORE exchange | 6/6 | 4 | 2 | 79,237 | 79,745 | 15,848–26,413 |

Total: 42/42 locators; manual review 36 sufficient core + 6 sufficient core with acceptable ancillary unresolved references. No confirmed material omissions within these 42; this is not complete-filing or LLM-correctness certification. Ancillary items: E20, E23, E27, E31, E40, E41. Token ranges are local UTF-16 chars / 5 to / 3 heuristics, **not Gemini tokenization**. Document/section metadata is 0.83–1.86% of evidence bytes; serialized packet bytes are separately recorded in the external report.

Freenome original ownership table and all six numbered footnotes are retained. Kodiak uses the Q&A ownership section at HTML `[415859,488172)`, with scenario headers, rows, totals and subsequent footnotes. The original preamble table is not selected; alternate table is not byte-identical (e.g. dash versus 0.0). No value is corrected. Numbers repeated in unrelated tables were not sufficient evidence.

All four transaction meeting dates and STORE expiry remain source placeholders; Freenome June 10 is the extension meeting, and June 13 2027 is proposed. A numeric STORE minimum aggregate exchange/consent threshold remains unverified; minimum note denominations and indenture action thresholds must not be substituted for it. Unselected, unprovided and unavailable do not mean absent in the entire filing.

Historical next-step recommendation (superseded): one bounded current-source LLM validation. After the subsequent Kodiak semantic failure, the user changed direction to source evidence retrieval. Follow [EVIDENCE_RETRIEVAL_HANDOFF.md](EVIDENCE_RETRIEVAL_HANDOFF.md); do not rerun the old validation or resume complex Monitor FACT normalization. The selector remains accepted and unchanged.

Verification: eight focused tests + three existing regression modules passed; full typecheck and diffcheck passed. All five primary and four optional archive SHA-256 hashes matched; every selected section exactly reproduces from its source coordinates. UI/API/accounts/plans/viewports unaffected; browser checks not applicable.

## Mandatory operational handoff

- Candidate: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`, original detached HEAD base `ee740278083bd08abc4d05d8bd0d1a3155614049`. Official managed attachment verified via `list_artifacts` after `attach_worktree`; attachment ID `01a10ca4-b1ad-7793-9a41-4d21c0d77e00`. No branch switches or manual worktree operations. Candidate commit is reported in final message / external completion receipt.
- Main integration: `C:/Users/PC/Documents/Codex/US-Stock Radar`, permanently `main`; no feature edits, checkout or worktree shell operations there. Port 3110 untouched. Candidate start clean; only these four new selector/test/harness/handoff files are intended changes; commit them and confirm final clean status.
- Operational state carried from the 2026-10-06 incoming handoff, **not revalidated by this offline task**: local main `ee740278083bd08abc4d05d8bd0d1a3155614049` (reported clean), GitHub main `9c13aee7ef41b38bac0637e53e579633745effda`, Vercel production READY `bf586ed559c7f4bea6a171790ab7b563cabc7161`, deployment `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`. Three-way code equality: no. No operational completion claim.
- Local/remote migrations and DB state unverified in this task; no DB access or changes. No environment-variable/credential changes. Incoming Render cron record: alert-delivery running, market cron suspended; not revalidated or changed. External services and caches untouched.
- No merge, push or deployment authorization. Candidate completion only. Main agent must independently verify original acceptance before any integration under `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md`.
