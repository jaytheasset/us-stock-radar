# Ownership Structured Context Ground Truth Plan

## Scope and authority

This plan validates the optional ownership semantic sidecar for four independently routed raw forms: `4`, `4/A`, `144`, and `144/A`. The original SEC XML is the semantic authority. The canonical parser inventory contributes opaque row, owner, security, evidence, and footnote references only. Primary analysis, scores, direct-fact values, Monitor conditions, market data, and alert results are forbidden prompt inputs.

The prompt rules are based on the SEC [Form 4 instructions](https://www.sec.gov/files/form4.pdf), [Form 144 instructions](https://www.sec.gov/files/form144.pdf), and [electronic Form 144 filing guide](https://www.sec.gov/submit-filings/filer-support-resources/how-do-i-guides/file-form-144-electronically). Actual-case links below are candidate evidence sources, not completed Ground Truth results.

No provider request, production ingest, shared database write, migration, Monitor activation, alert delivery, or Primary-analysis change is authorized by this plan.

## Contract decisions and known gaps

- New provider wire output for `economic_direction` is disabled for all four routes. The canonical fact remains readable/validatable for backward compatibility, but the route schemas never advertise it and the mapper rejects any attempted provider emission as nonapplicable. The condition registry declares `ownership.form4.direction` as `PARTIAL` against the direct transaction table; this is not evidence that the condition is activated, and no consumer was found that reads this context-sidecar field.
- Form 4 transaction codes remain mechanical source facts: `P` purchase, `S` sale, `G` gift, `M` exercise/conversion, `F` exercise-price or tax payment through delivery/withholding, and `C` derivative conversion. Neither a code nor A/D is converted into `economic_direction`.
- The current DTO has one `ownership_relation` assertion per row. It cannot safely represent a joint filing in which different reporting owners have different direct/indirect relations. The retained UWMC fixture exposes this: the XML row D/I value is indirect while supporting footnotes describe SFS as direct and Mat Ishbia as indirect. Expected result is unresolved/omitted, not owner merging or validator relaxation.
- The security inventory is row-title based. In the retained VENU derivative case it does not provide a distinct underlying target reference, so the model must not self-link the derivative security. Expected result is unresolved/omitted.
- Footnote IDs are inventoried, but the current neutral DTO does not carry a separate explicit row-to-footnote edge. Evidence must therefore stay within the supplied row locator unless a source-backed binding is representable.
- Form 144 lacks distinct canonical references for account owner, broker/market maker, filing agent, acquisition-history seller, and past-sale seller. Those roles must remain separated in reasoning and must not be forced into `owner_attribution`.
- Amendment input currently contains the amendment XML only; it does not supply a retained parent XML/comparison object. A prior accession or amendment explanation in the amendment may identify a target, but no parent-row comparison may be invented. Omission is not deletion; repetition is not replacement; explicit restatement is recognized only within evidenced scope and never authorizes direct-fact rewrites.
- `noOfUnitsOutstanding` in Form 144 is a disclosure local to the proposed-sale row. It is not canonical issuer outstanding shares and is outside this sidecar.

## Candidate corpus

Status meanings: **retained actual** has official SEC XML stored in the offline fixture; **actual plan-only** identifies an official filing but its required original/amendment pair is not retained; **synthetic** is useful only for deterministic negative/shape tests and cannot satisfy an actual Ground Truth gate.

### Form 4

| Case | Accession | Focus | Status |
|---|---|---|---|
| AGIG purchase | `0001493152-26-023264` | Simple Table I purchase, direct ownership | Retained actual |
| UWMC joint conversion/10b5-1 | `0001841794-26-000018` | Multi-owner scope, conversion legs, owner-specific relation gap | Retained actual |
| VENU derivative gift | `0002076354-26-000001` | Table II gift and missing distinct underlying target ref | Retained actual |
| Routine RSU grant | `0001193125-26-237487` | Award/grant mechanics without economic-direction inference | Actual candidate/source unverified: URL exists, retained byte hash is absent |

### Form 4/A

| Case | Amendment accession | Focus | Pair readiness |
|---|---|---|---|
| Innovex International (`INVX`), Adam Anderson | [`0000950170-25-114614`](https://www.sec.gov/Archives/edgar/data/1042893/000095017025114614/xslF345X05/ownership.xml) | Tax-withheld shares corrected from 12,833 to 13,067 | BLOCKED: original dated 2025-09-10 not retained/identified |
| Astera Labs | amendment [`0001736297-25-000108`](https://www.sec.gov/Archives/edgar/data/1736297/000173629725000108/xslF345X05/wk-form4a_1755723751.xml); original [`0001736297-25-000102`](https://www.sec.gov/Archives/edgar/data/1736297/000173629725000102/xslF345X03/wk-form4_1754946599.xml) | Explicit entire restatement; DAF trustee/pecuniary gift correction | Official web pair identified; BLOCKED until both byte-exact XML files and hashes are retained offline |
| Plexus, Karen Rapp | [`0001707073-25-000009`](https://www.sec.gov/Archives/edgar/data/785786/000170707325000009/xslF345X03/wk-form4a_1763762980.xml) | Failed 11/4 gift attempt versus actual 11/21 gift | BLOCKED: original accession/XML are not retained in this worktree |
| Correction-row safety | synthetic `0000000000-26-004105` | Omission/repetition must not imply delete/replace | Synthetic only |
| Reconciliation safety | synthetic `0000000000-26-004005` | Parent-comparison and amendment-effect fail-closed behavior | Synthetic only |

### Form 144

| Case | Accession | Focus | Status |
|---|---|---|---|
| Amcor, Michael Casamento | `0001959173-26-000698` | Proposed sale, acquisition history, nothing-to-report prior sales | Retained actual |
| Walmart namespaced XML | `0001958244-26-000308` | Namespace handling and person-for-account attribution | Retained actual |
| NVIDIA, Colette Kress original notice | [`0001958244-25-004346`](https://www.sec.gov/Archives/edgar/data/1045810/000195824425004346/xsl144X01/primary_doc.xml) | CDK2 LLC/NIM CRUT roles and 2025-03-04 plan disclosure | Actual web candidate; byte-exact XML not retained |
| Detailed proposed sale | synthetic `0000000000-26-014501` | Proposal/account/broker/acquisition scope separation | Synthetic only |
| Market maker without broker | synthetic `0000000000-26-014502` | Broker/market-maker role gap | Synthetic only |
| Ambiguous multi-row 10b5-1 | synthetic fixture | Plan locality and multiple proposal rows | Synthetic only |

### Form 144/A

| Case | Amendment accession | Focus | Pair readiness |
|---|---|---|---|
| Globe Life, Thomas Kalmbach | [`0001654954-26-005173`](https://www.sec.gov/Archives/edgar/data/320335/000165495426005173/primary_doc.xml) | Prior accession, option exercise acquisition, past-sale rows | BLOCKED: amendment retained; original `0001654954-26-005107` not retained |
| NVIDIA, Colette Kress | amendment [`0001958244-25-004347`](https://www.sec.gov/Archives/edgar/data/1045810/000195824425004347/xsl144X01/primary_doc.xml); original [`0001958244-25-004346`](https://www.sec.gov/Archives/edgar/data/1045810/000195824425004346/xsl144X01/primary_doc.xml) | Table I correction; amendment header identifies the previous accession; plan date is disclosed | Official web pair identified; BLOCKED until both byte-exact XML files and hashes are retained offline |
| Home BancShares, John Stephen Tipton | [`0001331520-25-000124`](https://www.sec.gov/Archives/edgar/data/1331520/000133152025000124/xsl144X01/primary_doc.xml) | Delayed-sale date/value change and option-exercise acquisition | BLOCKED: original accession/XML not retained |
| Mario Alberto Accardi / issuer CIK `1847903` | [`0001969223-25-000881`](https://www.sec.gov/Archives/edgar/data/1847903/000196922325000881/xsl144X01/primary_doc.xml) | Acquisition nature/date correction while amount/price stay unchanged; past sales and 10b5-1 | BLOCKED: same-day original accession/XML not retained |
| Material-increase fixture | synthetic fixture | Amendment amount change without executed-sale inference | Synthetic only |

## Per-form PASS gates

Each form is evaluated independently. A route is not PASS merely because another form passes. `supported` from the LLM remains a candidate assertion until the canonical validator and isolated official readback accept it.

### Form 4 gate

1. Offline route/schema tests select `form4`, reject amendment/family mismatch, exclude amendment-only and economic-direction fields, and cover all retained actual fixtures.
2. Actual provider runs cover simple Table I, multi-owner conversion/10b5-1, and derivative gift cases with exact source fingerprints.
3. Unsupported owner merging and missing underlying refs resolve without fabricated IDs.
4. Canonical validation and isolated persistence/readback preserve exact row/evidence lineage.
5. Direct Form 4 values, Primary output, matcher behavior, and alerts remain byte/behavior unchanged.

Current status: **NOT PASS**. Offline route/validator negatives are available; provider, DB persistence, and official readback were not run.

### Form 4/A gate

1. Offline route/schema tests select `form4A`, include amendment-only output, and distinguish explicit scoped restatement from assumed full replacement.
2. Retained actual original+amendment XML pairs cover the material correction structures in scope: numeric/withholding correction, explicit restatement, and erroneous-versus-actual transaction timing. Coverage, not a fixed sample count, controls readiness.
3. Ground Truth labels identify adds/modifies/removes/restates/no-change only from amendment text or the supplied pair comparison; omitted/repeated rows remain non-conclusions.
4. Canonical validation and isolated persistence/readback never rewrite direct original or amendment rows.
5. Primary, matcher, and alert behavior remains unchanged.

Current status: **BLOCKED / NOT PASS**. No complete actual original+amendment pair is retained; synthetic fixtures cannot satisfy this gate.

### Form 144 gate

1. Offline route/schema tests select `form144`, exclude derivative/amendment/economic-direction outputs, and reject route mismatch.
2. Actual provider runs cover ordinary proposed sale, namespaces, acquisition history, prior-sale history, broker/account separation, and plan locality.
3. The result never represents a proposal as executed, never treats row outstanding units as canonical OS, and never attributes broker/agent identity as owner.
4. Canonical validation and isolated persistence/readback preserve exact row/evidence lineage.
5. Direct Form 144 values, Primary output, matcher behavior, and alerts remain unchanged.

Current status: **NOT PASS**. Two actual fixtures are retained; provider, DB persistence, and official readback were not run.

### Form 144/A gate

1. Offline route/schema tests select `form144A`, include amendment-only output, and preserve proposal-versus-execution semantics.
2. Retained actual original+amendment XML pairs cover the material correction structures in scope: proposal-term correction, delayed-sale change, acquisition-history correction, past-sale scope, and 10b5-1 locality. Coverage, not a fixed sample count, controls readiness.
3. Ground Truth labels keep current proposal, acquisition history, past sales, and amendment explanation in separate scopes.
4. Canonical validation and isolated persistence/readback never fabricate parent evidence or rewrite direct rows.
5. Primary, matcher, and alert behavior remains unchanged.

Current status: **BLOCKED / NOT PASS**. One actual amendment is retained, but its original is absent; the other official candidates are plan-only.

## Overall release rule and provider order

Overall status is **NOT PASS**. It may become PASS only after all four form gates independently reach actual PASS. Recommended future provider order is: (1) Form 4 simple AGIG, then UWMC and VENU edges; (2) Form 144 Amcor, then Walmart and role/plan edges; (3) Form 4/A only after complete parent pairs are retained; (4) Form 144/A only after complete parent pairs are retained. Each step must start with one case, inspect the raw response and mapped candidate, then expand without changing direct facts or enabling delivery.
