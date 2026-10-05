# S-4/F-4 local MCP evidence candidate — 2026-10-06

Practical PASS: actual stdio MCP initialize → tools/list → search → read, five existing filings and the exact 15 accepted queries. This is a local candidate, not a deployed service or automatic ingestion integration. The core selector and retrieval implementation are unchanged.

## Final contract

- SEC source → transient parser/core selector → source-only evidence index → MCP search/read → calling AI interprets at question time.
- Separately, existing S-4/F-4 Primary prompt and display adapter → one provider attempt per analysis invocation → human-facing app analysis. Transport/JSON failures and validator warnings do not trigger a repair or fallback call in this branch. Existing job scheduling/replays are outside this change; this is not a durable exactly-once execution claim.
- Primary summaries, scores and signals are not canonical facts and never enter the evidence tools. Evidence tools have no Primary/provider/DB dependency and remain usable when Primary fails.
- No complex merger FACT contract, Structured Call 2, waiver/conditional-extension graph, recursive references or semantic topic assertions. Monitor candidates remain limited to trusted form/accession/date/issuer/amendment/parent/simple-event identity; none is newly persisted here. Ticker/issuer lifecycle needs its own narrow contract next.

No generic filing-body MCP server existed. The existing `buildS4F4EvidenceIndex` search/read and selector provenance are reused directly. Official `@modelcontextprotocol/sdk` handles lifecycle, tool discovery, argument validation, errors and stdio; Zod describes tool arguments only, not transaction facts. Existing ticker/filing-list APIs do not expose filing bodies; `originalSourceContent`'s analysis-text fallback is intentionally not used.

## Local interface and source lifetime

Requires Node with TypeScript stripping (verified Node 24.15.0). An MCP client launches:

```json
{
  "command": "node",
  "args": [
    "--no-warnings", "--experimental-strip-types",
    "C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar/scripts/sec-evidence-mcp.mjs",
    "C:/Users/PC/.codex/visualizations/s4-f4-selector-eeb4-20261006-release/kodiak-selected.json"
  ]
}
```

Append explicit existing selector packet paths to load more filings. Paths are operator startup configuration, never model tool arguments. Loaded current accessions are advertised in MCP initialization instructions. Duplicate current accessions fail closed. No persistent listener, HTTP endpoint, account authorization or deployment was added. Local process access defines the session's authorized source scope. Production source acquisition/authentication remains a separate integration task.

Programmatic callers can use `createS4F4EvidenceMcpServer([selectS4F4Sources(sourceInput)])`, releasing the transient HTML after selection. The standalone local CLI reuses existing selected packets; it does not create a packet, snapshot, checkpoint or new source store. Only selected text and the existing metadata/term index are held in memory. No disk writes, fetches, `.env`, credentials or provider imports occur on the tool path.

| Tool | Arguments | Result |
|---|---|---|
| `sec_evidence_search` | Required `filingAccession`, `query`; optional `phrases`, `topics`, `role`, `documentAccession`, `limit`, `maxChars` | Form/current filing identity, unchanged ranked hits/deferred refs, headings/captions, topic hints, role/document provenance, hashes/text ranges/table ranges, candidate counts and limitations. No text body. |
| `sec_evidence_read` | Required `filingAccession`, `evidenceId`; optional `maxChars` | One exact original selected-text slice, source URL/filename/accession/role/purpose, document HTML hash, section and evidence hashes, section HTML bounds and unit text bounds, table markers/cells/notes, limitations. |

`filingAccession` always identifies the loaded current filing packet. `documentAccession` optionally narrows documents within the explicit role; current is the default. Parent/exhibit reads remain individually attributed, not blended or interpreted as amendments. Read accepts either a hit's `evidence:` ID or its `section:` reference for explicit broader context. There is no whole-packet or whole-filing read endpoint.

Search limit defaults to 4 (1–20); source-character budget defaults to 60,000 (1–200,000) for both tools. Oversized units/sections return a budget status without clipped text. Above the tool ceiling, context is unavailable through that read; never assume completeness. Search budget describes source characters to read, not metadata-response size. No hit means no match in selected source, not absence in a filing.

Queries use English source-language terms; quoted definitions/optional phrases filter exactly after whitespace/case normalization. Natural English questions work with those terms, but there is no semantic embedding or Korean translation layer. The upper AI must formulate source-language searches and inspect the returned limitations. Topics/captions are only hints, not verified heading hierarchy or facts. Evidence text is untrusted document content, not instructions.

Coordinates are half-open UTF-16. HTML coordinates cover the selected parent section; unit text coordinates refer to the selector-rendered section and are not exact HTML subranges. Original HTML hashes come from the selector. Table/footnote text is retained, not interpreted; out-of-section references remain unresolved. Stable IDs change when bound source identity/text/coordinates change. See the unchanged index's limitations in every response.

## Verification

`scripts/verify-sec-evidence-mcp.mjs` launches the real server subprocess with the official MCP client. It checks baseline packet file hashes, tool discovery, exact search results (IDs/order/budget/metadata), and every read's exact text and provenance. Equality to the accepted packet includes all table and footnote characters. The baseline already verified original HTML hashes/coordinates. No answer-generation acceptance test or new Gemini call occurred.

External metadata-only report: `C:/Users/PC/.codex/visualizations/s4-f4-mcp-e2e-20261006.json`. No source body or whole packet was copied into it.

| Filing / representative query | Hits | Read chars | Result |
|---|---:|---:|---|
| Kodiak / Available Closing Cash | 2 | 7,683 | PASS |
| Kodiak / Available Purchaser Closing Cash | 1 | 806 | PASS |
| Kodiak / termination, cure, Outside Date | 2 | 15,542 | PASS |
| Kodiak / proposal dependency | 2 | 3,065 | PASS |
| Kodiak / distinct PIPE obligations | 1 | 2,895 | PASS |
| Kodiak / ownership tables and notes | 1 | 16,086 | PASS |
| Capital One / separate voting thresholds | 1 | 6,282 | PASS |
| Capital One / regulatory closing | 1 | 3,615 | PASS |
| Capital One / conditional extension | 1 | 3,971 | PASS |
| Freenome / cash waiver and notice | 1 | 1,571 | PASS |
| Freenome / ownership tables and notes | 1 | 16,450 | PASS |
| First Majestic / cure and extension | 1 | 5,795 | PASS |
| First Majestic / exchange ratio | 1 | 1,703 | PASS |
| STORE / equal principal, tender/withdrawal | 2 | 9,177 | PASS |
| STORE / waiver and notice | 2 | 9,943 | PASS |

Read sizes are 0.11%–12.55% of their packets. No changed context blending or important evidence loss was found within these 15 questions. This is not certification of arbitrary-query recall. Additional MCP tests cover an English sentence, current/parent/exhibit separation, cross-filing ID rejection, unknown IDs, explicit section reads, budgets without truncation, mutation rejection, duplicate accession rejection and failed/incorrect Primary exclusion.

Primary regression executes the actual S-4/F-4 runner branch and both provider attempt loops with mocked IO: success (including incomplete visible text), validation failure, invalid JSON, HTTP 429 and network failure each make exactly one attempt, zero waits and no repair/fallback. Existing display validators still report warnings.

Completed checks: 39 automated test entries PASS (19 selector/index/MCP, 14 Primary one-attempt/catalog, 6 adapter/parser/analysis), 15/15 real stdio query E2E PASS, project typecheck and diff whitespace checks PASS. The Windows test-loader invocation needed an absolute file URL; tests passed after correcting the command, without changing the loader.

Commands (run in candidate root):

```powershell
node --no-warnings --test --experimental-strip-types lib/sources/sec/forms/s4-f4/evidenceMcp.test.ts lib/sources/sec/forms/s4-f4/evidenceRetrieval.test.ts lib/sources/sec/forms/s4-f4/sourceSelector.test.ts lib/ai/secS4F4PrimaryOneCall.test.ts lib/development/secCorrectionPromptCatalog.test.ts
node --no-warnings --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/ai/secS4F4AnalysisAdapter.test.ts lib/sources/sec/forms/s4-f4/parser.test.ts lib/sources/sec/forms/s4-f4/adapter.test.ts lib/sources/sec/forms/s4-f4/analysis.test.ts
node --no-warnings --experimental-strip-types scripts/verify-sec-evidence-mcp.mjs <existing-packet-directory> <accepted-retrieval-report.json> <NEW-report-path.json>
npm run typecheck
git diff --check
```

## Retired code and preserved audit

Removed the active S-4/F-4 validation repair call, retry/fallback eligibility in this branch, unused repair prompt/patch/selection helpers and registry exports, obsolete repair-only tests, and its active correction-prompt catalog entry. Primary prompt, adapter behavior, selector and core retrieval are otherwise reused. No other family's repair behavior is changed.

Complex merger Structured Call 2 was an experimental plan, not a found product implementation. It is retired. Historical `SEC_S4_F4_ROOM.md` router/deterministic guidance and the broad merger Monitor roadmap do not authorize implementing them under this final contract. The earlier evidence handoff is retained as the offline audit; this document supersedes its "future MCP" boundary.

Preserved without edits/deletion: selected packets/original archive, selector/retrieval reports, Kodiak one-call Structured experiment, Flash-Lite 7/15 and Flash 3.5 10/15 answer audits. No model's output is made canonical. Removed code remains in Git history; no migrations or stored data were removed.

## Workspace / operations

Root: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`; base `fad3479733525488999a1de7640e176ee6ea1d96`, existing detached candidate HEAD. Official attachment `01a10ca4-b1ad-7793-9a41-4d21c0d77e00`. Final commit and clean status belong in the completion receipt. No UI/account/plan change; browser viewport checks not applicable. The dev correction catalog's retired entry is checked by its existing regression test, not a browser run.

Incoming operational records, **not revalidated**: permanent main `C:/Users/PC/Documents/Codex/US-Stock Radar` on locked `main`; local main `ee740278083bd08abc4d05d8bd0d1a3155614049`; GitHub main `9c13aee7ef41b38bac0637e53e579633745effda`; Vercel READY `bf586ed559c7f4bea6a171790ab7b563cabc7161` (`dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`). Equality not established; no production completion claim. No permanent-main/port3110 operations or branch/worktree changes.

DB/migrations, deployed env and cron are unchanged/unverified. No credentials, account permissions or external-service configuration changed. Dependency installation accessed npm; MCP verification used local source files with zero provider/SEC/DB calls. No merge/push/deploy. Before any later integration, independently revalidate the original scope and `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md` gates. Ticker/issuer lifecycle may begin as a separate narrow design/review task; no identity semantics are established by these evidence tools.
