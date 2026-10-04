# Proxy Primary source input candidate — 2026-10-05

## Follow-up revision on the existing candidate

Revision base: detached `c3b843f8018366efa89c6463e05f2480a88e5310`, clean, in the same assigned `f6e4` worktree. No new chat/worktree, main operation, external call or deployment.

- Primary now accepts standalone `Proposal`, `Item` and `Matter` numbered references using the same numeric/spelled-number/No./Number forms. Item/Matter references with a parenthesized subclause or decimal suffix (e.g. `Item 25(b)`, `Item 25 (b)`, `Item 7.01`) do not independently select a block. Explanatory parentheses remain eligible. Existing Proposal reference behavior is preserved. This is source-label syntax, not classification of an agenda item or a financial fact. When a paragraph also has a selected standalone reference, its complete context is retained, including any citation in that paragraph.
- Every selected discovery block is emitted with its original text, start/end coordinates and a single original block ID. Adjacent and overlapping chunks are no longer combined. Existing uncovered Primary evidence and table samples remain. This supersedes the original coalescing implementation described below.
- No changes to shared parser, Structured v1, frozen Call 1/2, schemas, prompts, validators, Primary output/scoring/meaning rules or repair code in this follow-up.

Final comparison evidence: `C:/Users/PC/.codex/visualizations/2026/10/04/01a108b4-1f5b-7382-9535-3e0883cfe784/proxy-primary-boundary-verified` (complete before/after inputs and prompts, `comparison.json`, `tests.log`).

| Saved source | Maximum located block chars before → after | Previously covered discovery blocks retained | Input UTF-16 units before → after | Input UTF-8 bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| Alternus | 23,998 → 6,000 | 102/102 | 264,320 → 270,518 | 264,506 → 270,704 |
| ENDRA | 20,938 → 6,000 | 21/21 | 77,579 → 79,935 | 77,605 → 79,961 |
| BigBear | 1,016 → 1,016 | 2/2 | 5,746 → 5,746 | 5,766 → 5,766 |

85 fixture inputs and three saved HTML inputs pass exact parser-boundary and source-slice checks, previous source-ID retention, existing Primary evidence/inventory/context retention, unchanged prompt contract and legacy Structured v1 package/fingerprint comparisons. The generic Item fee-reference blocks in Alternus and ENDRA remain excluded. Full offline regressions: 121/121 passed, including nine focused Primary source tests. Frozen preserved-response replay remains Alternus 8 / BigBear 0; no provider calls. Full configured TypeScript check: 1,643 files, 0 diagnostics; git diff --check passed. Replay/typecheck logs use the sibling `proxy-primary-offline/boundary-revision-*` prefix.

Boundary preservation removes builder-induced 20–24k blocks. The existing repair path still clips each selected block at 5,000 chars; this change does not promise that all 6,000 chars of a parser chunk are visible during repair. A regression verifies that later chunk openings are independently available to that per-block clip. All earlier parser coverage limitations remain.

Reproduce the follow-up comparison using the command below with baseline `c3b843f8018366efa89c6463e05f2480a88e5310` and a fresh evidence directory. The operations checklist at the end remains applicable; local/GitHub/Vercel states were not re-audited in this offline candidate revision.

## Original candidate checkpoint (historical measurements)

## Scope and acceptance

- Assigned workspace: `C:/Users/PC/.codex/worktrees/f6e4/US-Stock Radar`.
- Start: detached `6ba9968c0486ed8f9780bd697f93d6e118c83067`, clean. Continue on that detached candidate lineage; no branch/worktree switching.
- Primary must receive located proposal bodies, table content within those regions and explicitly linked appendix regions, with document/offset provenance. Do not infer proposal meaning, generate model answers or inject Structured output.
- Preserve uncovered existing Primary excerpts, all table samples, parent references, change excerpts, filing/attachment/document inventories, warnings, market context and deterministic archive metadata.
- Frozen Call 1/Call 2 and shared parser must remain unchanged. Preserve the older Structured v1 package/fingerprint contract too.
- Offline evidence only. No UI/auth/route/plan changes; viewport/account journeys are not applicable to this candidate. No live Primary quality or production-flow claim.

## Implementation

`sourceInput.ts` selects existing parser location blocks by structural cues or overlap with existing required excerpts. Generic numbered Item references alone are excluded unless they preserve existing evidence. No semantic document classification or proposal category controls selection. Overlapping/adjacent coordinates are coalesced only within the same document, with overlap consistency validation. Unknown gaps are never filled. Repeated wording at different locations/documents keeps its provenance.

The input includes exact normalized-document slices and their original block IDs, document identity and character coordinates. Covered legacy snippets are replaced; uncovered snippets remain under neutral labels. Parser-generated placeholder inventories are explicitly labelled. Table samples remain explicitly partial and carry row counts and table/document IDs. Full rows/footnotes inside the selected source ranges have no four-row cap. Removing Primary's global 60-block slice protects late supplemental evidence.

The old implementation remains behind `buildProxyLegacySourceBlockPromptInput`; the only `structuredV1.ts` change is its import alias to that compatibility builder. Shared parser, Call 1/2 source builders/prompts/schemas/validators, Primary prompt text/output schema/meaning rules/scores, display and UI files are unchanged.

Changed files in this candidate:

1. `lib/sources/sec/forms/proxy/sourceInput.ts`
2. `lib/sources/sec/forms/proxy/structuredV1.ts` (compatibility import only)
3. `lib/sources/sec/forms/proxy/sourceInput.test.ts`
4. `scripts/verify-proxy-primary-input-offline.mjs`
5. This handoff document.

## Offline evidence

Evidence directory (not committed): `C:/Users/PC/.codex/visualizations/2026/10/04/01a108b4-1f5b-7382-9535-3e0883cfe784/proxy-primary-verified`.

`comparison.json` records every check, raw file path/hash, per-block source coverage and late table row comparison. Each real case has complete before/after source-input JSON, complete before/after local Primary prompt text, and a parser snapshot. Saved HTML inputs were read from `C:/Users/PC/.codex/visualizations/2026/10/02/01a0fe0e-fb35-7723-9790-6561fc3aacb0/proxy-structured-v1/json-mode-neutral-expanded/raw` without modification. Original experiment outputs were only read.

Exact measurements for pretty-printed source-input JSON, including unchanged inventories and a fixed offline market-context marker:

| Saved filing | UTF-16 code units before → after | UTF-8 bytes before → after | Whole discovery blocks present before → after / available |
| --- | ---: | ---: | ---: |
| Alternus | 56,659 → 264,320 | 56,709 → 264,506 | 29 → 102 / 103 |
| ENDRA | 23,564 → 77,579 | 23,577 → 77,605 | 2 → 21 / 22 |
| BigBear supplement | 3,331 → 5,746 | 3,338 → 5,766 | 0 → 2 / 2 |

Full local Primary prompt UTF-16 / UTF-8 measurements:

| Saved filing | Before | After |
| --- | ---: | ---: |
| Alternus | 73,894 / 73,944 | 281,555 / 281,741 |
| ENDRA | 40,799 / 40,812 | 94,814 / 94,840 |
| BigBear supplement | 20,566 / 20,573 | 22,981 / 23,001 |

These are exact string/byte counts, not token estimates or provider request/token measurements. The full prompt is `buildProxyAnalysisPrompt`, not an executed provider request. Source coverage is whole-block containment after whitespace normalization, not complete filing coverage or a count of correct proposals.

Confirmed real-source examples:

- Alternus `table-1-9` row 5 now includes the full reverse-split approval wording and Appendix B reference; `table-1-14`, `table-1-15`, `table-1-25` preserve late agenda/recommendation rows. Thirty rows after row 4 are newly found by conservative normalized row matching.
- Alternus Appendix A (`D1-B101`, 5,586 chars) and B (`D1-B102`, 3,981 chars) are retained to their ending source text. Appendix C retains the 96-character identity block selected by the unchanged parser; it does not import the entire plan.
- ENDRA late reverse-split discussion includes board-discretion factors, fractional-share wording and tax context. Its selected source character total rises from 428 to 43,018 when counting fully contained discovery blocks.
- Alternus/ENDRA each exclude one generic SEC Item fee-reference block. BigBear remains a bounded supplement; no parent proxy or entire-document fallback is imported.

## Verification

- 118/118 offline tests passed: every local Proxy test except the SEC-network real-source collector, plus Proxy adapter and Primary structural/disposition regressions. Six new focused tests cover late body/table/appendix text, >60 blocks, inventories/context, overlap/dedup/document provenance, filtering/invalid coordinates, older parser payloads, no mutation and parent-only supplements.
- 85 repository fixture inputs (including nested phase fixtures) plus three saved real HTML inputs passed before/after comparisons. Every prior important excerpt, parent reference, change excerpt and table sample was retained. Inventories, context, warnings and deterministic metadata were unchanged.
- Every emitted coordinate range matched the corresponding normalized saved document slice exactly. Primary prompt text outside serialized source input was identical. Legacy Structured package/fingerprints were identical, including matching placeholder rejection.
- Shared parser and frozen Call 1/Call 2 files were compared against the base Git objects and were unchanged. Preserved-response replay passed: Alternus 8 proposals, BigBear 0, without external calls. Replay evidence: sibling `proxy-primary-offline/candidate-replay.json`.
- Full configured TypeScript check: TypeScript 5.9.3, 1,643 files, 0 diagnostics, no emit/incremental writes. Existing dependency files were resolved read-only; no install or environment loading. Log: sibling `proxy-primary-offline/final-typecheck.log`.
- `git diff --check` passed. Initial runner failures were module-loader path/CJS-resolution problems; evidence loaders were corrected without product changes. Initial failure logs are retained in sibling `proxy-primary-offline`.

Reproduce the comparison with Node 24 and a **new** evidence directory:

```text
node --no-warnings --experimental-strip-types scripts/verify-proxy-primary-input-offline.mjs <saved-raw-directory> <new-evidence-directory> 6ba9968c0486ed8f9780bd697f93d6e118c83067
```

The runner blocks network, reads baseline Git objects from its own checkout, validates immutable files and emits full input comparisons. It never re-collects SEC documents or invokes a provider.

## Limits and integration boundary

- Input size increases materially. No token budget, live latency/cost, actual model response quality or downstream production run was measured. This candidate changes source delivery only.
- The unchanged parser's source coverage limits remain: unselected table rows, unaddressed appendix chapters, cross-document appendix links and image-only material are not newly reconstructed. Existing table samples remain available. Conservative normalized late-row matching finds 33/85 Alternus late rows and 1/7 ENDRA late rows; this is not a promise that every table is complete, and unmatched rows may also differ by footnote/normalization syntax.
- Stored parser outputs without discovery blocks retain their existing excerpts/table samples. They cannot gain missing full source without parsing available original text.
- Candidate completion is not merge authorization. Main integration must independently review scope and acceptance; no merge, push or deployment was performed here.

## Required operations handoff

- Permanent main workspace: `C:/Users/PC/Documents/Codex/US-Stock Radar`; must stay on `main`. Do not run candidate repository commands there or switch/repoint its worktree. Port 3110 was not operated.
- Local main at supplied handoff: `6ba9968c0486ed8f9780bd697f93d6e118c83067`, clean. Reconfirmed this as the assigned candidate's starting HEAD; permanent main was not independently re-audited from this candidate.
- GitHub main at supplied handoff: `9c13aee7ef41b38bac0637e53e579633745effda`, different from local main; no remote call in this offline task.
- Vercel deployed SHA/status: unverified. Code equality is **not established**; no production-sync completion claim.
- Candidate: this detached lineage and completion commit reported in the final result; tracked deliverables committed clean. No raw evidence, credentials, env or machine settings committed.
- Existing detached Proxy checkpoint `e40cb53139c80ded6f9cf070369733d94e75aad8`, its preserved `outputs/` and nine untracked experiment scripts were untouched. Its product history was already integrated according to the supplied handoff.
- No other feature branch/worktree was modified; no new worktree was created by this task.
- DB/migrations/data/RLS/permissions: unchanged and not re-audited. No migration required by this change.
- Environment variables, external services, cron, caches and Monitor: unchanged, status not re-audited. No server started/restarted or stopped.
- Push/deployment approval: absent; prohibited from this candidate. Next step: independent main acceptance review of this candidate, preserving the operating rules above.
