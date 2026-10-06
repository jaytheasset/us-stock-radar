# Tender Evidence v1 — candidate handoff

Candidate scope: source-only Evidence retrieval with a separate local MCP entrypoint. No product API/UI activation, automatic acquisition, DB persistence, Monitor FACT, Alert or new LLM step. Candidate base: `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`. Candidate root: `C:\Users\PC\.codex\worktrees\87db\US-Stock Radar`, detached HEAD. Final candidate commit/clean status is supplied in the completion message; this document is part of that commit.

## Acceptance and changes

1. SC 14D9 accept/reject Item 4 / Solicitation or Recommendation / Recommendation of the Board / Reasons for the Recommendation source coverage. The live accept document had the actual recommendation, but baseline `buildSecTenderSourceBlockPromptInput` omitted it; reject was already covered. Prioritize up to ten source windows before the generic section budget, using actual filing metadata even if the Parser form is wrong. The existing Primary schema, classifier, numeric values, provider/retry/repair policies remain unchanged.
2. Existing fetched input → `prepareTenderEvidence` → `buildTenderEvidenceIndex` → `search_evidence` → `read_evidence`. Eleven investor question groups verified against nine complete individual SEC documents fetched into memory. Search results only contain IDs and retrieval/provenance metadata; read returns the exact selected rendered source.
3. Accession, document and source-revision isolation; unavailable documents, partial inputs and no-match retrieval are disclosed separately. No inferred transaction grouping or merging of text from different documents.
4. Source only. No input from Parser facts, classification, transaction_fingerprint, summary, score, signals, Primary answers, parent analysis, or `analysisText`. No new complete-filing archive or stored answers. The committed live report contains metadata/hashes/positions/check outcomes, not original filings.
5. Existing Tender parser, Primary prompt fixtures and adapter normalization regressions, new isolation/provenance/table/stdio tests, four Tender/SC13 selector cases and full TypeScript check pass. See reproducible commands below.
6. S4/F4/425, EFFECT, Proxy, Registry, other families, Monitor/Alert, application authentication and routes unchanged.
7. No UI/auth/redirect change: account-state API and 1440/820/390px UI testing is not applicable to this local stdio addition. No application server started, including port 3110.

## Source contract

`TenderSourcePacket` has one authoritative filing accession/form, document inputs and an explicit unavailable inventory. Supported forms: SC TO-I(/A), SC TO-T(/A), SC TO-C, SC 13E3(/A), SC 14D9(/A), CB(/A).

Each source document has:

- authoritative filing accession and SEC form (not Parser classification);
- exact SEC archive URL and document filename identity;
- primary/attachment role;
- original fetched HTML or already prepared per-document text, with format and completeness (`complete`, `excerpt`, `truncated`).

The adapter consumes existing `rawPayload.documents[].text`, identity-bound `attachment_texts`, or `primary_document_html` paired with `primary_document_url`. Attachment matches require URL/filename agreement; a label/type alone is not identity. Ambiguous/missing/conflicting identities remain unavailable. Combined `bodyText` is deliberately not silently assigned to the primary document. Older saved inputs with only combined text or unlabelled attachment text require the caller to supply the correctly bound original document; the adapter does not guess or refetch.

Evidence retains accession/form, document identity/URL/role/completeness, a SHA-256 stable evidence ID, original-input hash, rendered-document hash, exact-slice hash, optional source heading, and half-open UTF-16 offsets. HTML offsets refer to the versioned `tender-render-v1` representation, not original HTML byte offsets; text inputs use `prepared-text-v1`. Source hashes prove equality to supplied content, not independent authentication of the caller's input. Acquisition provenance remains the caller's responsibility.

HTML rendering preserves paragraphs and entire nested tables, row/cell boundaries, empty cells and row/column spans. Text is entity-decoded and whitespace-normalized; no semantic values are created. Selector windows retain adjacent units and never split a table. Original documents are transient construction input. The returned index only exposes selected slices and metadata. It has no serialization/persistence or whole-filing tool.

Search requires one accession, optionally a document ID, and returns up to 20 hits (default five), scores, matched query/expansion terms, positions/hashes, remaining hit count and coverage diagnostics. Ranking uses lexical token coverage, a small fixed expansion list, length normalization, caption down-weighting and overlap/repeated-text suppression. No company/accession rules in runtime code; no semantic LLM search. No saved synthesized answers.

Read requires the same accession and selected IDs. Foreign/unknown IDs, stale source revisions and unknown filing scopes fail closed. Reads are atomic against a caller character budget: over-budget reads return `needs-larger-context-budget` and no clipped text. Returned objects cannot mutate the index.

## Actual search → read verification

[evidence-live-report.json](./evidence-live-report.json) records exact questions, URLs, filing identities, source hashes, returned IDs/positions and independent source-present versus retrieved checks. Run date: 2026-10-06. All eleven groups pass at Top5. The script drives the real MCP tools over the SDK in-memory transport; a separate offline test starts the actual stdio process.

| Group | Actual source | Confirmed read coverage |
| --- | --- | --- |
| 1 | Rumble SC TO-I, `0001213900-25-000757`, offer attachment | $7.50/share, 70,000,000 shares, $525 million |
| 2 | Same offer attachment | February 4, 2025 expiration and extension text |
| 3 | Same offer attachment | Proration and withdrawal rights source passages |
| 4 | United Rentals/H&E SC TO-T, `0001104659-25-006713`, offer attachment | Minimum tender and regulatory/HSR conditions |
| 5 | Applied Therapeutics SC 14D9, `0001193125-25-335440`, primary | Board recommendation to accept and tender, recovered after baseline omission |
| 6 | SC 14D9, `0001193125-26-096287`, primary | Board recommendation to REJECT and NOT tender |
| 7 | Nano/Stratasys SC TO-T/A, `0001213900-23-055698`, supplement attachment | Explicit increase from $20.05 to $24.00 in the same passage |
| 8 | Applied Therapeutics SC TO-T/A, `0001193125-26-026154`, primary | Previous January 27 → extended January 28, 2026, same passage |
| 9 | Carlyle SC TO-I/A, `0001702510-26-000009`, primary | 4,180,330 accepted shares, $18.82/share, $78,673,802 aggregate |
| 10 | Royal Road/Caza CB, `0001062993-17-000336`, offer attachment | 0.16 share consideration and per-share context |
| 11 | Nordstrom SC 13E3, `0001213900-25-019787`, primary | Special Committee's actual determination that the transaction is fair and in the best interests of shareholders |

Each read is checked against `renderedDocument.slice(start, end)`, its text hash, original-document hash, URL and accession. Price/date relationships are source sentences, not extracted canonical fields. Source phrase checks operate inside individual evidence slices, not stitched search results.

## Failure semantics and limits

- `source-insufficient`: no supplied documents, failed/missing document input or partial source inventory plus no hits. Nonempty hits still carry unavailable/partial diagnostics. An unsuccessful read/acquisition is never evidence of absence.
- `retrieval-no-match`: supplied complete documents did not yield a lexical match in selected slices. This is not a claim that the filing lacks the answer. The selector vocabulary is bounded, so an omitted selection can also underlie this state.
- `interpretation: unassessed-source-only`: even a successful read does not determine whether the original disclosure is ambiguous, superseded or conclusive. That is a separate calling-AI assessment against the returned source. The index never “repairs” an unclear source or fills absent values.
- Incorporated references are not automatically traversed. Nordstrom's primary includes actual Special Committee determinations and references to fairness opinions; the separately incorporated proxy/opinion bodies are not in this packet. A broad question asking for “fairness opinion evidence” can prioritize reference-list entries. The accepted group-11 question explicitly asks about the Committee's determination and shareholder interests; actual opinion-body retrieval is unverified with this input.
- Initially the issuer price/size question missed the price despite source presence: a retrieval failure, fixed by bounded expansion and length-normalized ranking. The first deadline assertion used an incorrect February expectation; direct original-source inspection corrected the test to January 28. Neither problem caused a Parser value correction.
- One filing may mention several transactions. The index never assigns a semantic transaction identity, joins transactions, or claims a hit belongs to the requested deal. The calling AI must inspect source context and use document scope as needed. Tests ensure separate-document evidence stays attributable and foreign-filing IDs cannot be read. Same-document multi-transaction interpretation remains a caller responsibility.
- English source-language lexical retrieval; general multilingual search and universal recall are not claimed. Huge source tables can require a larger read budget; >500,000 selected characters cannot be read in one request.
- No paid provider calls. Existing saved `real-*` fixtures are preserved, but their shortened text alone was not counted as live SEC verification.

## Reproduce in the candidate

```powershell
$tenderLoader = ([System.Uri](Join-Path $pwd.Path 'scripts/resolve-ts-paths.mjs')).AbsoluteUri
node --no-warnings --experimental-loader $tenderLoader --experimental-strip-types --test lib/sources/sec/forms/tender/evidenceRetrieval.test.ts lib/sources/sec/forms/tender/evidenceMcp.test.ts lib/sources/sec/forms/tender/parser.test.ts lib/sources/sec/forms/tender/analysis.test.ts lib/ai/secTenderAnalysisAdapter.test.ts
node --no-warnings --experimental-loader $tenderLoader --experimental-strip-types scripts/qa-sec-tender-sc13-selector.mjs
npm run typecheck
git diff --check
```

The absolute loader URI avoids a pre-existing Windows relative-loader resolution issue. No loader changes are included.

Read-only live verification (SEC HTTP, no DB or provider):

```powershell
node --no-warnings --experimental-strip-types scripts/verify-tender-evidence-live.mjs
```

An optional final argument saves the metadata report. No full original documents are written. Existing source packets can be exposed locally with:

```powershell
node --no-warnings --experimental-strip-types scripts/tender-evidence-mcp.mjs <existing-source-packet.json>
```

Startup paths are operator configuration; tools accept no paths/URLs and cannot fetch or mutate anything. Do not create a duplicate filing archive just to run this entrypoint. Programmatic consumers can pass transient packets directly to `createTenderEvidenceMcpServer`.

## Main independent gate and operational handoff

- Recheck exact candidate commit, detached state and clean status; compare every changed file to the acceptance list. No merge authorization is implied by this report.
- Reproduce accept/reject coverage and all eleven search/read questions, including exact URL/hash/position checks, adversarial identity isolation, budget handling, source-missing and ambiguous-text cases. Inspect actual returned prose, not just keyword assertions. Independently assess the documented fairness-opinion and same-document transaction limitations before integration.
- Confirm Primary regressions and full typecheck. There are no changed product pages, API routes, auth, redirects or plan policies; if integration adds any, perform the required permitted-account/logged-out and 1440/820/390px journey checks.
- Main integration root remains `C:\Users\PC\Documents\Codex\US-Stock Radar`, branch `main`, no switching. Candidate has not operated this root or port 3110. Any future candidate server must use 3111+.
- Local `refs/heads/main` and GitHub `refs/heads/main` were read from this candidate and both remain `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`. Main clean status was supplied by the main handoff; not independently re-audited from the locked candidate.
- Last handed-off Vercel: `dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`, READY, CLI code `bf586ed559c7f4bea6a171790ab7b563cabc7161`; not re-queried here. It differs from local/GitHub main. No deployment completion claim or deployment approval.
- Last handed-off local DB: approved EFFECT migration `20261005183052` verified at `127.0.0.1:56322`; remote migrations unverified. No DB reads/writes or migration operations for this candidate.
- No environment-variable changes. Handed-off Render: two web services and notification cron autoDeploy off; web unsuspended, cron suspended. Vercel source-ingest prelaunch automatic cron disabled; other cron declarations do not prove execution. These operational settings were not changed or re-audited.
- Preserved other work: eeb4 S4, 5f1c EFFECT, effect-main-integration and unrelated branches remain outside scope. Their completion/unmerged status was not re-audited.
- Last handed-off main product verification: 94/94 focused regressions, full typecheck, Monitor/Alerts 1440/820/390px and logged-out 401. This candidate's verification is separately documented above.
- No main merge, push, deployment, external messaging or notification delivery performed. Next step: main independently reviews this candidate commit.
