# 425 identity and current-announcement boundary — offline candidate

2026-10-15. Base `47894c512f22b7cf7766b5022bf3ff21b903e50c`, existing detached candidate `C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar`. This is the subsequent offline identity/currentness task, **not another Round4 or FACT provider experiment**. eeb4 was initially inspected read-only because the desktop cwd differed; no files or Git state were changed there.

## Confirmed defects before modification

Two narrow regression tests failed on the base behavior: the Primary adapter returned model abbreviation `OBDC II` as its primary ticker; a `confirmed` signing citing an explicitly previously announced agreement had no independent currentness assessment. These are distinct from the existing global candidate `not_ready` publication gate.

Trace: SEC ingest uses `fetchSecEdgarRawItems` → shared parser/catalog resolution → existing raw repository → `buildSecFilingAnalysisPackage` → 425 prompt and analysis adapter. The shared resolver previously allowed issuer text/FMP CUSIP/accession-CIK fallback for 425. The package omitted its resolution provenance. The adapter chose model ticker, then package ticker, then parser fallback; display payload independently exposed the parser ticker. FACT only checked literal ticker containment in party quotes. No source quote proves company identity by itself.

## Changes and exact boundaries

- **Existing collection/parser**: a 425-only branch uses the already-loaded SEC exchange catalog by Archives CIK, without another collector, HTTP call or FMP lookup. A primary row requires one row. It retains that exact row and source URL. Existing index role parser now also accepts 425 and retains index hash, literal company name, CIK and role separately. Filing company name is selected by the explicitly matching CIK, rather than the first company span; original detail company text is retained. Other form policies are unchanged.
- **Package/Primary**: pass that provenance through the existing package. Only an exact official row/CIK/name/ticker/exchange agreement produces a consumable ticker. CIK is checked against the Archives path. No fuzzy names, abbreviation expansion or ticker replacement. Missing provenance is unresolved; disagreement is blocked. Input includes separate filing roles and unverified claims. Existing runtime and deterministic archive projections share the guard; display payload cannot independently promote a parser ticker. Raw model response is retained in `sec_425_raw_model_output`, parser claims and each failed claim are retained in `sec_425_identity`. Summary/score/event semantics are not reclassified by this change. Explicitly verified related rows remain available; unrelated rows cannot borrow the filer identity.
- **Shared pure verification**: per-party server-owned bindings may use an exact literal identity label or existing index-role provenance; a party need not print its CIK inside its transaction sentence. Company identity and ticker identity are separate, including companies with no claimed ticker. For additional parties, reuse `normalizeMainSubmissions`, the same integrity boundary used by `readCurrentIssuerSubmissions`. Verify source URL, exact raw/payload integrity, hash, CIK and observation time before comparing the claimed symbol. The SQL reader itself is not called here. No new catalog parser, DB reader or persistence is introduced.
- **Time meaning**: official mapping corroboration is at its observation time. It does not establish a historical ticker, current freshness, a security class or transaction role. Existing catalog evidence has an observed time but no confirmed-at snapshot timestamp; `catalogConfirmedAt` stays null. A later mapping disagreement never replaces the original historical claim. FILED BY/SUBJECT COMPANY do not mean acquirer/target.
- **FACT v2**: accepts an `action_context` with literal action date, disclosure context, action evidence and context evidence. Old responses are still readable; missing context remains unresolved, without filling fields. Primary schema is unchanged; its source instructions distinguish action/filing dates and roles. Primary prompt v10 / Router v5 distinguish changed input contracts from preserved v9/v4 requests.
- **Currentness guard**: checks exact, unique source bindings and explicit prior/current context. A new-signing claim citing a quote starting `As previously announced` is a conflict requiring review. A shortened quote omitting that paragraph's historical prefix is unresolved. The explicit `action_evidence` takes precedence over general background evidence. A revised proposal in a paragraph also mentioning prior history is not automatically classified as historical. Date equality/inequality is not a decision rule. Original decision, dates and quotes are never edited.

`supported_claim` means the structured evidence checks passed, **not semantic approval**. `semanticAccuracy` stays unverified and `confirmedForConsumption` stays false. The historical-prefix guard is a narrow contradiction detector, not a general temporal NLP classifier: other historical phrasings, mixed actions and poorly chosen but exact evidence still require source review. Neither exact quotes nor the new schema demonstrate accuracy of an uncalled model.

Identity context is server-owned evidence, not a model-supplied authority object. Hash consistency is integrity, not proof that an arbitrary caller fetched SEC. The public model schema does not accept official identity metadata. Additional party bindings remain explicit; there is no name-based CIK discovery or automatic cross-company join. No new production FACT ingestion, storage, Monitor matching or Alert integration is connected.

## Preserved real cases: manual source assessment vs new guard

Evidence receipt: `C:/Users/PC/.codex/visualizations/sec425-identity-currentness-20261015/FINAL-OFFLINE-REPLAY.json`. The replay checks 36 preserved files before/after, including source bytes, original prompts, actual provider requests/responses and inputs. No archived request, response or source was changed. Historical FACT and Round4 Primary outputs were replayed, not rerun or rewritten as new-contract outputs.

| Case / actual accession | Direct source findings | New offline result |
|---|---|---|
| Blue Owl / `0001193125-25-267134` | Block056 supports agreement and transaction roles; 1517 explicitly says `NYSE: OBDC` for Blue Owl Capital Corporation. 1518 defines `OBDC II` as the other company's abbreviation. `OWL` is the adviser-parent symbol. | Raw `OBDC II` claim retained, never verified. OBDC/OWL not substituted. No per-party official CIK snapshot was supplied in this preserved bundle; all official party mappings remain unresolved. Old response lacks action context → currentness unresolved, not a new model failure or a declaration that no signing occurred. |
| Diana/Genco / `0001104659-26-075214` | Block011 gives Diana/DSX and Genco/GNK, increased offer and their roles. Block045 explicitly non-binding; 042 partnership does not require a completed Star Bulk transaction. Historical offer participation is separate. | Names, DSX/GNK source claims and roles preserved independently. No filer CIK copied to Genco. Missing official per-party mapping stays unresolved. Old action context absent; no fabricated date/context metadata. |
| Axcelis / `0001104659-26-011578` | Preserved official public excerpt001 explicitly describes the previously announced September 30, 2025 agreement; 002/003 describe February 6, 2026 meeting/vote. This is an excerpt, not full-HTML ingestion. | The existing model's `confirmed/definitive_agreement_signed` remains raw. Separate `historical_leadin_in_signing_evidence_requires_review` conflict blocks current-signing consumption independently of `not_ready`. No claim that the model's next output is fixed. |
| MasterBrand / `0001193125-25-220725` | Previously reviewed proxy/future-vote communication has no relevant new proposal/signing in supplied blocks. | Preserved Round5 `not_applicable`, announcement null, remains `not_applicable`. Its old schema is explicitly labeled; new fields were not invented. |

Raw source SHA-256: Blue Owl `3d7ec163cc58b040592ecd1cfe0dee329f8061b4bc916b7daea0edb943469b54`; Diana `9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d`; MasterBrand `60056493e027b95a2824b63969a80f4d6301c2a68a54f3193241ceec2da3e623`; Axcelis excerpt `0455973a6f0c857e41c0ac569838bb8d9ee251b77dd61b1fb0fa89e58d469af2`.

Three saved Primary responses preserve their original summaries and complete raw output. Their old packages lack the newly retained exact catalog row, so identity consumption is unresolved, not guessed from old ticker strings. No legacy database migration or retroactive update was performed. Positive catalog and Submissions cases are **synthetic observations through real functions**, not newly fetched verification of these four companies.

Citation length/whitespace/exactness failures remain separate from identity/currentness and from this manual semantic review. Nothing normalizes quotes to make saved responses pass.

## Validation

- New focused regressions: 10 tests, including pre-fix two-test reproduction, Primary raw/projection preservation, independent verified related row, real collection → package → prompts → normal/deterministic projection using an isolated HTTP double, exact company-role binding, missing ticker CIK, changed hashes, wrong source/CIK, ambiguous references, prior/current/mixed/shortened/duplicate evidence and no-event meaning.
- Related regression set: 47/47, including existing 425 parser/router/analysis/adapter/fetch/context, FACT, Monitor preview/auth/default-family guards, shared catalog/Form25 failure recovery, SC13 issuer and exact source-symbol selection.
- Existing experiment suites: 102/102. Their provider calls are HTTP doubles, not real API requests.
- Typecheck and diffcheck pass. No new build/browser/login verification: UI components/CSS and server setup were not changed; model-facing instructions and data projection are tested offline. Existing build limitations from the previous task were not repaired or retested.
- Initial combined test command lacked the existing server-only resolver; the corrected command uses both existing resolvers by absolute file URL. A subsequent strict company-name test exposed the generic detail-name contamination, fixed only in the 425 CIK-linked name selection. Failed logs are retained separately.

Commands (run in this candidate):

```powershell
# Loader paths must be absolute file: URLs on Windows with this resolver.
$loader = 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-ts-paths.mjs'
$serverOnly = 'file:///C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock%20Radar/scripts/resolve-server-only.mjs'
node --no-warnings --import $serverOnly --experimental-loader $loader --experimental-strip-types --test <related test files listed in final2-regressions.txt>
node --no-warnings --experimental-loader $loader --experimental-strip-types --test <experiment/*.test.ts and experiment/*.test.mjs>
node --no-warnings --experimental-loader $loader --experimental-strip-types lib/sources/sec/forms/425/experiment/identity-currentness-replay.mjs C:/Users/PC/.codex/visualizations <new-receipt-path>
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

## Limits and handoff

Real provider requests 0; new SEC collection 0; DB reads/writes 0; persistence/automatic Alerts 0. No model repair/retry/fallback, migration, UI changes, server operation, env changes, merge/push/deploy. New model quality and real official mappings for these preserved parties are unverified. There is no live product/browser or storage E2E claim. Exact company-name mismatch is intentionally unresolved/conflicting; alias resolution is not implemented. Missing old provenance is not reconstructed. Existing stored rows are not rewritten.

Local `main` ref read from the candidate: `8a2bb826d38eeca6e0eb071e7017d66e579ba46a`. Main's reported `next-env.d.ts` modification was not touched; main working-tree state was not independently inspected. GitHub main, Vercel commit/runtime, remote DB/env/cron unqueried. No equality, deployment or merge-readiness claim. Stop for Main/GPT independent review after the separate local candidate commit.
