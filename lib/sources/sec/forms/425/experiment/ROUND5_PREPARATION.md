# Round 5: two announcement kinds, standalone — prepared only

2026-10-15 KST. Candidate root `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`; base/current HEAD `11f1dda4be3dc8f0a26ea35ee039e2e3da57ecc6`, detached. Start was clean. Only new Round5 experiment files are present. No earlier trial files or evidence were changed.

**Actual provider requests 0.** This turn prepares the bounded trial for Main's independent request/schema/guard review; no further user approval is requested. No credential reads, SEC fetch, new Router/baseline, retry/repair/fallback, model-validation/token API, DB, server, environment or product changes. No commit yet.

## Minimal standalone contract

The new module does not reuse the seven-kind schema, event-state table or actor-role classification framework. It does not generate Primary analysis or alter production Primary. Root output:

```text
coverage: supplied_current_filing_blocks_only
decision: confirmed | not_applicable | uncertain
reason: source-based explanation
announcement: one object if confirmed, otherwise null
  kind: acquisition_proposal_announced | definitive_agreement_signed
  parties: named participants and relevant involvement
  target: entity/securities and scope
  statement: concise explanation
  key_terms: [{term, evidence: [{block_id, source_field, quote}]}]
evidence: [{block_id, source_field, quote}]
```

Root evidence supports the actual newly reported action or reason for a non-confirmed decision. Each key term must have its own evidence. A revised offer and changed consideration produce one proposal with terms, never a separate consideration event. A non-binding proposal may actually be announced; that does not make it a final agreement or completed acquisition. A signed definitive agreement can still have future closing conditions.

Prior agreements/offers are not current merely because discussed in this filing. Negotiations, LOI, intended signing, proxy filing, board approval, own-share repurchase, scheduled vote and future merger mechanics do not establish the two supported announcements. Multiple distinct candidate transactions or ambiguous parties/target remain uncertain; no arbitrary selection. Preserve important positive and negative conditions, stated implied values/components, acquisition ownership scope and limited-purpose party involvement. No arithmetic or fallback values.

`not_applicable` is scoped to the supplied blocks, never whole-filing/transaction absence. `uncertain` remains a distinct unresolved judgment with null announcement. Neither creates a confirmed alert candidate. No actual alert consumer or dispatch is connected.

The validator checks shape, decision/object consistency and exact citation/length. It reports, never repairs. It cannot determine if a source actually reports a new action or whether a condition belongs to that transaction. A synthetic source proposal deliberately mislabeled as signing passes the internally consistent shape/citation checks and remains semantic-UNREVIEWED. Tests demonstrate representation and detection limits, not automatic natural-language correctness.

Citation format stays separate from semantic assessment: exact heading/text binding, max240 local quote length, existing description-only wire limit, no normalization, character replacement or block relocation. The diagnostic schema removes quote maxLength only to expose other diagnostics; original schema/output remain unchanged and a formatting failure remains FAIL. Source-supported short statements are not forced into literal quotes.

## Frozen request changes

Evidence directory: `C:/Users/PC/.codex/visualizations/sec425-two-announcements-round5-20261015`.

Plan SHA-256: `a5a2a9698cb597409a96f9574f9b4a4cdabbff2e536e32f5995d1b20e25be69f`.

Three original user contents are byte-identical to Round2/3/4, including source selection and Router metadata. Only `systemInstruction.parts[0].text` and `generationConfig.responseSchema` are replaced with this standalone task. Restoring those two paths makes the actual request deeply equal to Round4. Router metadata remains in input but is explicitly not decision/evidence authority.

| Case | Accession | Model | Blocks | User SHA-256 |
|---|---|---|---:|---|
| signed / Blue Owl | 0001193125-25-267134 | gemini-2.5-flash | 28 | 141f8f7a31a82d78a9b485f9bd21aacf37a556bd72d6b789133a3b2a38ade432 |
| background / MasterBrand | 0001193125-25-220725 | gemini-2.5-flash-lite | 7 | 1faf52c6e202e8740af7a2490099be2bb04557da132471d3295165e61c1f19e6 |
| revised-offer / Diana | 0001104659-26-075214 | gemini-2.5-flash | 27 | 18bf4306e6380bb5948e137ae33b7af59e19f15f4a8102b11c26685f9e9ee3f8 |

temperature0, thinkingBudget0, maxOutputTokens5000, timeout120s, JSON transport and source/Router bytes unchanged. Directory holds exact new requests/prompts/schemas, prior Round4 requests/prompts/raw responses, source HTML, saved Router, per-case diff audit and plan hashes. not_applicable/uncertain null outputs pass both local and actual wire schemas for all three prepared cases. Ledger is empty; no Round5 response exists.

Round3 standalone seven-kind and Round4 combined results remain references. Multiple task/schema differences prevent attributing any later improvement to one universal cause. No new baseline call is planned.

## Bounded execution and later assessment

`round5-guard.mjs` is Round4's bounded guard with only function and plan-version names changed. One actual request per case, maximum3 including failures, durable pre-fetch reservations, cross-process lock, exact plan/request hashes, restart duplicate denial. Full output failures consume the case but allow a different unsent case; HTTP/network/protocol uncertainty halts the trial. No retry, continuation/reset, fallback, repair or extra API calls. The sender pins this one directory/digest and has not been executed.

After preparation review, record actual HTTP status, raw response, usage, finish reason, latency and validation separately. Use the previously recorded 2026-10-14 Standard price snapshot for an explicitly historical-rate estimate; actual billing stays unverified. Do not fetch new prices or query a model to verify the model.

Acceptance criteria (not outcomes yet):

- Blue Owl: one definitive agreement announcement, source056 parties and initial-merger direction retained; limited-purpose Adviser distinguished; future conditional closing not completed. No separate board or buyback candidate.
- Diana: one current revised non-binding proposal; source-stated $27.34 implied value, $24.80 cash and one Diana share valued $2.54 retained without computation. Source045 non-binding,068/069 major conditions and016/042 explicit absence of financing/Star Bulk conditions assessed against each returned term. May4 and May27 actions in067 must not become current candidates.
- MasterBrand: no supported announcement; filed proxy/future vote in009 do not establish definitive signing or a newly made acquisition proposal. A correct not_applicable is not forced into uncertain, but an actually ambiguous input must not be labeled not_applicable to hide uncertainty.
- Independently compare statement/parties/target/each term to supplied blocks and preserved HTML. Mechanical PASS or exact quotes do not establish semantic PASS. No three-sample generalization, seven-category coverage or product-readiness claim.

## Offline verification

New Round5 contract/guard tests **21/21 PASS**. Full existing+new experiment suites **93/93 PASS**, existing425 parser/router/analysis/adapter/fetchPlan scripts **5/5 PASS**. Typecheck and diffcheck recorded in the preparation receipt; no prior result is substituted for this run. Logs remain in the external evidence directory.

Commands use `node --no-warnings --experimental-strip-types --test` with `round5.test.mjs`, Round4/3 tests and existing Round2/combined/guard/continuation tests; existing425 scripts use the absolute `scripts/resolve-ts-paths.mjs` file-URL loader. Typecheck: `node node_modules/typescript/bin/tsc --noEmit --incremental false`. New untracked files receive a separate syntax/whitespace check in addition to `git diff --check`.

## Operations and handoff

Last Main handoff: local main `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`, permanent root `C:/Users/PC/Documents/Codex/US-Stock Radar`, existing user-owned next-env.d.ts SHA `083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd`. Not read or modified this turn. GitHub main/Vercel current status unqueried; only historical GitHub equality reported. Remote DB/migration/env/cron state unverified and untouched. eeb4 and all other worktrees untouched. No UI/API/login/viewport task, server/3110, Monitor connection, merge/push/deploy. Earlier unmerged candidate commits through11f1dda4 are preserved.

Stop at provider0 for Main's frozen-request review. Preparation tests alone are not live experiment or acceptance PASS.
