# S-4/F-4 evidence retrieval candidate — 2026-10-06

Historical offline audit retained. The later [local MCP evidence handoff](MCP_EVIDENCE_HANDOFF.md) supersedes this document's future-MCP boundary and freezes the separate one-attempt Primary / original-evidence architecture. Selector and core retrieval remain unchanged.

Practical PASS for 15 source-term queries over the existing five selected current filings. Stop at this offline boundary. This replaces the old recommendation to normalize complex transaction terms into Monitor FACTs. No provider calls in this task. No selector changes, DB/schema changes, deployed MCP tools, product routes, Monitor/Matcher/Alert, 425, merge, push or deploy.

## Existing structures and minimal seam

`evidenceRetrieval.ts` consumes the exact `ReturnType<typeof selectS4F4Sources>` and retains its document identities, explicit current/parent/exhibit purposes, section headings/reasons, original-HTML coordinates and source SHA-256. The S-8 structured source's explicit evidence reference/hash/coordinate conventions were reused as a design precedent, without importing its family-specific facts or persistence. Existing stock `sec-source-filings` API exposes filing identity lists, not body retrieval; existing searches are primarily ticker/list projections. No reusable generic filing-body MCP search was found. No separate service was created.

`originalSourceContent.ts` can fall back to `analysis_text`; it is deliberately not used as evidence input. Likewise, the common chunker's whitespace rewriting/hard boundaries and proxy's whole-raw-payload binding are unsuitable here. Only selector-rendered source is searched/read. Extra Primary summary/score/signal/raw-payload fields are ignored.

```ts
const index = buildS4F4EvidenceIndex(selectedPacket);
const result = index.search({
  query: '"Available Closing Cash"', // original-language terms, not an answer template
  limit: 2,
  maxChars: 30_000,
});
// Inspect status/deferred before assuming the returned evidence is sufficient.
const evidence = result.hits.map(hit => index.read(hit.ref));
// Read a broader original selected section explicitly if a reference/footnote needs context:
const section = index.read(result.hits[0].sectionRef);
```

The map has document → selected section → read-unit references. A stable SHA-256 ID binds identity, source role, source hash, heading, coordinates and text hash; array-order citations are not exposed. The metadata map stores no source body. Text remains in the caller's existing packet; the transient token index stores term sets. Reading produces the exact source slice. Mutation of packet text/identity/coordinates fails closed, and public metadata copies cannot modify private bindings.

Small selected sections (at most 20,000 characters) stay intact. Longer sections use only standalone title-like rendered-text captions outside balanced tables as possible boundaries. This is a retrieval view, not a second core selector: every original selected character remains in exactly one unit. Captions are explicitly heuristic, not verified HTML hierarchy. Unknown boundaries stay large. No sentence clipping, hard truncation, reference traversal or semantic merging. Tables retain rows/cells/spans; in-scope footnotes remain text, not computed associations. `sectionRef` always permits explicit broader reading. References outside selected source remain unresolved.

Coordinates are half-open JS UTF-16: section HTML bounds locate the whole section in original HTML; unit text bounds locate its exact slice in selector-rendered text. Text coordinates are never presented as exact HTML subranges. The original hash is selector-supplied; the offline audit additionally verified it against archived original HTML. Source URL/filename/accession/role are included in every read.

Search uses lexical term coverage, inverse term frequency, caption weight and length normalization. Quoted phrases / `phrases` are whitespace/case-folded exact filters. Optional topics only route evidence; they never establish a transaction condition or status. `current` is the default; parent/exhibit require explicit queries and remain separately attributed. Limits return `deferred` candidates and `needs-larger-context-budget`, never an apparently complete clipped response. No hits means `no-match-in-selected-source`, never absent from the filing. Remaining candidate counts are visible.

## Representative questions and direct context review

External report and metadata-only maps: `C:/Users/PC/.codex/visualizations/s4-f4-retrieval-eeb4-20261006-release/`. `retrieval-report.json` records literal search terms, hit IDs, source coordinates/hashes, budgets and grouped context assertions. No original HTML or full packet was copied into this output. Original archive and accepted selector packets remained read-only.

| Case / question | Returned source and context verified | Chars / packet |
|---|---|---:|
| Kodiak: Available Closing Cash components? | Two Business Combination Consideration units, expenses deduction, redemptions/excise, actual PIPE receipts, GAAP/time preserved | 7,683 / 1.05% |
| Kodiak: Available Purchaser Closing Cash basis? | Separate direct definition, before transaction-cost payment; no blending with the other label | 806 / 0.11% |
| Kodiak: termination cure and Outside Date exceptions? | Article IX plus narrative; earlier-of 20 days/outside date, written-date agreement, breaching-party exclusion, extension right no longer applicable | 15,542 / 2.13% |
| Kodiak: Condition Precedent/Advisory/Adjournment dependencies? | Meeting purpose + adjournment; cross-conditioning, advisory dependency and adjournment exception | 3,065 / 0.42% |
| Kodiak: PIPE open-market vs already-owned voting obligations? | PIPE Subscription Agreements; abstaining vs affirmative vote, transfer/redemption restrictions, one-for-one election and concurrent closing | 2,895 / 0.40% |
| Kodiak: ownership scenario assumptions and footnotes? | Whole Q&A section: both tables, scenario headings, all following notes, illustrative PIPE assumption, original 2.34 value unchanged | 16,086 / 2.20% |
| Capital One: respective shareholder vote thresholds? | Q&A retains Capital One votes-cast vs Discover outstanding entitled shares, with different abstention effects | 6,282 / 1.19% |
| Capital One: regulatory closing conditions? | Conditions to Complete the First Merger, waiting periods/continuing approvals/burdensome-condition exclusion | 3,615 / 0.68% |
| Capital One: deadline extension and termination limits? | Termination section; February→May, regulatory/all-other-conditions qualification, breach/cure exceptions | 3,971 / 0.75% |
| Freenome: proceeds condition satisfied, waiver and notice? | Unsatisfied condition, sole discretion, four-business-day notice intent and possible post-redemption/meeting waiver | 1,571 / 0.13% |
| Freenome: ownership scenarios and extension redemptions? | Whole Ownership of New Freenome: both tables, all numbered notes and explicit exclusion of extension-meeting redemptions | 16,450 / 1.37% |
| First Majestic: cure period and conditional outside-date extension? | Termination section; earlier of 45 days/one business day before outside date, material breach exclusion, antitrust condition and April→May | 5,795 / 1.06% |
| First Majestic: stated exchange ratio and qualification? | 2.55 exchange ratio, excluded shares and corporate-action adjustment; fractional-share cross-reference retained, not inferred | 1,703 / 0.31% |
| STORE: exchange consideration and tender requirements? | Offer terms + Terms of Exchange, equal principal, properly tendered/not withdrawn, registered-vs-old notes | 9,177 / 11.58% |
| STORE: waiver and material-change notice? | Conditions + Terms of Exchange, discretionary waiver, government-approval exception, five-business-day period and unfilled expiry | 9,943 / 12.55% |

No material omissions or incorrect merging confirmed **within these questions**. Exact source hashes/coordinates and unit reassembly passed for all five packets. Ownership acceptance compares the entire returned selected section, not numbers found elsewhere. Fixtures assert related qualifications together within one hit; the STORE waiver question deliberately requires two separately attributed sections. No value was calculated, repaired or promoted to a typed fact.

The first fixture run had two Capital One locator failures because the expected phrases quoted another source occurrence; direct review confirmed the returned Q&A/conditions used equivalent explicit wording. Fixture quotations were corrected to the actual returned source and strengthened with abstention/waiting-period context. Retrieval and selector were not changed for these failures. The first report remains separately available at `s4-f4-retrieval-eeb4-20261006/`.

## Limits and next boundary

This is lexical retrieval using original-language terms, not unrestricted Korean/English natural-language QA certification. Broad queries such as “proposal conditioned approval” can rank other proposal sections; named terms or “cross-conditioned” locate the relevant relationships. Some long units can exceed a requested budget, visibly deferred. Original headings can label ranges containing several subsections; captions may miss single-word/mixed-style titles. These are reasons to inspect results/read parent context, not to infer completeness. Automatic footnote association, external referenced documents, amendment-delta meaning and all-filing recall remain unverified. The prior six ancillary unresolved references remain unresolved. No selector expansion is warranted by the accepted questions.

Ready for a small future MCP search/read adapter using these IDs, filters, explicit budget states and source-role boundaries. Authentication, tool registration, source acquisition lifetime, multilingual query formulation and production authorization remain future work; no deployed MCP availability is claimed. Do not resume complex FACT normalization.

Monitor candidates only: form, accession, trusted filing date, issuer/CIK, amendment flag, and explicitly sourced simple identity/event observations. The current packet does not supply a trusted filing date/CIK; do not invent them from text. Transaction identity requires explicit provenance, not inferred deal unification. No complex cash/waiver/cure/dependency/PIPE/ownership scenario is promoted to Monitor FACTs.

## Verification and workspace handoff

```powershell
node --no-warnings --test --experimental-strip-types lib/sources/sec/forms/s4-f4/evidenceRetrieval.test.ts lib/sources/sec/forms/s4-f4/sourceSelector.test.ts lib/sources/sec/forms/s4-f4/parser.test.ts lib/sources/sec/forms/s4-f4/adapter.test.ts lib/sources/sec/forms/s4-f4/analysis.test.ts
node --no-warnings --experimental-strip-types lib/sources/sec/forms/s4-f4/retrievalOffline.mjs <accepted-packet-directory> <existing-original-archive> <new-external-output>
npm run typecheck
git diff --check
```

Candidate root: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`; task base `ddf24dbef9dc3d51a8021f344cf6ef535503eec1`, detached HEAD retained. Official attachment ID `01a10ca4-b1ad-7793-9a41-4d21c0d77e00`. Start clean; final commit/status reported in completion receipt. Changed files are evidence implementation/test/offline harness/this handoff, selector handoff direction pointer and diagnostics index. Product code paths/UI/API/account/plan/viewports are unaffected; browser checks not applicable.

Required operational context carried from incoming handoff, **not revalidated in this offline task**: permanent main root `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch locked to `main`; local main `ee740278083bd08abc4d05d8bd0d1a3155614049`, GitHub main `9c13aee7ef41b38bac0637e53e579633745effda`, Vercel READY `bf586ed559c7f4bea6a171790ab7b563cabc7161` (`dpl_8x8yCBA6mw67f7pkyQrLR7YtBXqU`). Equality was not established; no operational completion claim. No commands ran in permanent main, no branch/worktree changes, no port 3110 operations.

Local/remote migrations, DB state, cron and deployed environment are unverified and unchanged. Incoming cron record was alert-delivery running / market cron suspended, not checked here. No credentials/environment changes, external service calls, jobs, cache or permissions changes. No merge/push/deploy authorization. Follow `docs/operations/PRODUCTION_SOURCE_OF_TRUTH.md` and independently check the original user scope before any later integration.
