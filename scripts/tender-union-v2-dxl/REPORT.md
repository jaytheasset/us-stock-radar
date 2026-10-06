# single-call v2 DXL = FAIL

2026-10-06. One authorized Gemini call completed. **MODEL_ERROR**: expiration.previous was retained correctly, but both offer_price.currency_text values are incorrect. Source coverage is sufficient. No semantic correction, retry, repair, fallback or additional paid case. Stop at this experiment.

## Contract and omission risk

[contract.mjs](./contract.mjs) defines five required object|null slots and required unresolved:string[]. Positive expiration, offer_price and board_recommendation require current, previous:value|null, current_evidence_refs and previous_evidence_refs. Positive offer_status requires current withdrawn|terminated plus refs; positive final_results_observed requires observed:true plus refs. Null means no supported positive emitted from supplied evidence; it is not a persisted false/absence claim.

Making every slot and previous decision explicit removes the v1 ability to silently omit the previous key while satisfying the output schema. It cannot guarantee a correct nonnull value or eliminate semantic error. In this single observation previous expiration was correct, while another field failed.

[Provider schema](./run/provider-schema.json) uses documented nullable type arrays, required object properties, additionalProperties:false, enums and array minItems. [Official GenerateContent documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en) lists this basic subset and Gemini 3.5 Flash support. Existing repo nullable schemas and successful v1/terminal calls supplied preflight precedent. The actual v2 HTTP200/STOP response now confirms live acceptance for this specific request. No model switch was made.

The previous/ref correspondence is a **local shape refinement**: previous null requires []; nonnull requires nonempty refs. Duplicate refs are rejected within an array; a ref may support both current and previous. Validators report errors only. They deliberately do not reinterpret the currency strings.

## Offline gates, freeze and source identity

**21/21 offline tests PASS**, covering all 17 required gates plus map tampering, pre-network rejection, malformed values and provider/local representation agreement. [Frozen preflight results](./run/preflight-tests.txt), [preflight gate](./run/preflight.json).

During initial offline development one leakage test falsely matched the generic word “expected” in the exclusion of expected results. Before freeze, this was corrected to detect an expected-object key; request reconstruction and explicit case/date/price checks remained intact. No paid call occurred during this adjustment. The frozen tests all passed before the call.

The full request, prompt, schema, source, mapping, baseline and experiment code hashes were frozen before the started marker. [Freeze manifest](./run/frozen.json), [separate semantic baseline](./baseline.json), [pre-call plan](./PLAN.md). Baseline is never passed to buildRequest. Provider user content equals v1 exactly; only generic prompt/output schema differ. Source naturally contains the expected dates/prices, which are evidence rather than leaked expected output.

| Exact byte copy from v1 DXL | SHA-256, identical in v1/v2 |
| --- | --- |
| source.json | 6682b450b32e9c3ec10116cf5619065118de3728941b66c16768539018caff90 |
| provider-source.json | 41060db95865df2bf38991910b40c8fc2817f6303b0d567bdfdf80f901033145 |
| evidence-map.json | c5ad97f31410e373d87c94b3bad134c8a89b8ba786f8732ffa4869d47455631d |

All 18 Evidence units, refs and ordering retained. No SEC searches, fetches, additions, deletions or source pruning. Existing v1 and independent FACT experiments and product code remain unchanged.

| Size / measurement | v1 DXL | v2 DXL |
| --- | ---: | ---: |
| Prompt characters | 6,215 | 4,073 |
| Compact provider schema characters | 2,683 | 3,302 |
| Compact provider source characters | 19,742 | 19,742 |
| Input tokens | 6,505 | 6,125 |
| Output tokens | 226 | 317 |
| Total tokens | 6,731 | 6,442 |
| Recorded latency | 2,824 ms | 2,932 ms |

Prompt shrank by 2,142 characters; schema grew by 619. Character counts are JavaScript string lengths, not token estimates. No causality or statistical reliability is established by one call with both prompt and schema changed.

## Sole provider call

- Accession: 0001193125-26-298540, Destination XL, SC 14D9/A.
- Run: tender-union-v2-dxl-d3a3c22b-6ffe-4bae-9065-d542f7b48699.
- Model requested/reported: gemini-3.5-flash / gemini-3.5-flash.
- Physical calls: **1**; HTTP **200**; finish reason **STOP**; latency **2,932 ms**.
- Tokens: input **6,125**, output **317**, total **6,442**; standard service tier.
- Retry / repair / fallback / semantic corrections: **0 / 0 / 0 / 0**.
- [Started reservation](./run/started.json), [raw provider envelope](./run/provider-response.txt), [audit](./run/audit.json).

The exclusive started marker blocks repeat execution even after failure. No Rumble, Carlyle or Xerox call was made. A valid JSON response and technical PASS do not constitute semantic PASS.

## Raw transient output (unaltered)

Preserved byte-for-byte in [structured.txt](./run/structured.txt):

```json
{
  "expiration": {
    "current": "2026-07-24",
    "previous": "2026-06-22",
    "current_evidence_refs": ["E1", "E12", "E13"],
    "previous_evidence_refs": ["E4", "E13"]
  },
  "offer_price": {
    "current": {
      "amount": 0.84,
      "currency_text": "per share in cash",
      "unit": "cash_per_share"
    },
    "previous": {
      "amount": 0.82,
      "currency_text": "$0.82",
      "unit": "cash_per_share"
    },
    "current_evidence_refs": ["E8", "E9", "E12", "E13"],
    "previous_evidence_refs": ["E12", "E13"]
  },
  "board_recommendation": {
    "current": "reject",
    "previous": null,
    "current_evidence_refs": ["E11", "E12"],
    "previous_evidence_refs": []
  },
  "offer_status": null,
  "final_results_observed": null,
  "unresolved": []
}
```

## Direct source review

Codex reviewed all 18 frozen source units directly. This is not independent human signoff. [Detailed field review](./run/review.json), [source text](./run/provider-source.json), [full provenance map](./run/evidence-map.json).

| Judgment | Expected | Actual | Source support | Result |
| --- | --- | --- | --- | --- |
| expiration current | 2026-07-24 | 2026-07-24 | E1 currently scheduled; E12/E13 actual extension | PASS |
| expiration previous | 2026-06-22 | 2026-06-22 | E4/E13 explicit earlier expiration | PASS |
| price current amount/unit | 0.84 / cash_per_share | same | E8/E9 operative cash/share; E12/E13 increase | PASS |
| price current currency_text | `$` | `per share in cash` | E8/E9 say $0.84 per share in cash; returned phrase is unit/payment form | **FAIL** |
| price previous amount/unit | 0.82 / cash_per_share | same | E12/E13 explicit prior price of same offer | PASS |
| price previous currency_text | `$` | `$0.82` | E12/E13 full price token is not currency notation alone | **FAIL** |
| board current / previous | reject / null | reject / null | E11/E12 explicit rejection; temporary company take-no-action excluded | PASS |
| offer_status | null | null | HSR condition E3 and different merger recommendation E15 do not establish tender status | PASS |
| final_results_observed | null | null | June 22 approximate 16% E12/E13 is interim | PASS |
| unresolved | [] | [] | Explicit supported source; no necessary unresolved item | PASS |

All selected refs exist, belong to this filing and relate to the appropriate tender claim. E13 directly supports both expiration dates and both prices; shared selection is permitted. No foreign/fabricated or unrelated ref was selected. However, the two **currency_text claims are semantically unsupported in that field**, despite quoting real source substrings. Technical provenance is identity/linkage verification, not a meaning check. [Provenance audit](./run/provenance-audit.json) resolves all 10 canonical fact/ref pairs to exact stable Evidence IDs.

E6's separate acquisition proposal, E10/E17's hypothetical July 31 consummation and executive payouts, and E18's compensation table did not contaminate the requested values. E15 concerns withdrawn support for the FBB merger, not prior tender recommendation or tender withdrawal. No unsupported previous board state was invented.

## Canonical projection and validation

[canonical.json](./run/canonical.json) contains exactly three facts: expiration, offer_price, board_recommendation. Null status/final slots create no facts. Board previous null becomes omitted. Current/previous refs are unioned in first-seen order:

- expiration: E1, E12, E13, E4.
- offer_price: E8, E9, E12, E13.
- board_recommendation: E11, E12.

All current/previous values are copied verbatim, **including the two incorrect currency_text values**. unresolved remains []. The projection does not read source or baseline and performs no semantic repair. Canonical schema is unchanged; no DB persistence exists in this experiment.

Provider-schema shape / local shape / canonical shape / structural projection / technical provenance: **all PASS**. Local checks intentionally allow arbitrary nonempty currency notation strings; source meaning must be reviewed, not repaired in code. The v2 live response establishes representation compatibility but fails semantic acceptance.

## Classification and decision

- **MODEL_ERROR:** two wrong currency_text roles with sufficient direct source.
- SOURCE_COVERAGE: not the cause; preserve exact source selection.
- SCHEMA_ERROR: not the cause; minimal currency_text can represent `$` and the output satisfies the intended format. Format acceptance cannot establish currency meaning.
- Original-source ambiguity: not the cause; `$0.84` and `$0.82` are explicit.

v1 DXL remains FAIL / MODEL_ERROR for omitted expiration.previous. v2 retained that previous date in this observation but failed another FACT. Do not rewrite v1 history, loosen the baseline, normalize strings, expand Selector or repeat the case. Whether prompt compression contributed is unproven; no automatic prompt/schema iteration is authorized after this call.

Retain v2 as a documented failed experiment, not an accepted general extraction contract. No generalized Practical PASS or readiness for Monitor/persistence is claimed. Existing independent FACT PASS findings remain historical results.

Changed files are confined to scripts/tender-union-v2-dxl/. Base 04633a09b000cc69f389f0e1fb0e6ce15fcbcc5d; candidate stays detached. Final offline verification and local commit are recorded in completion-checks.json and Git history. No merge, push, deployment, server operation or product implementation. Local-main/GitHub-main/deployed commit equality was not evaluated; this is a candidate experiment, not an integration handoff.

**single-call v2 DXL = FAIL — STOP.**
