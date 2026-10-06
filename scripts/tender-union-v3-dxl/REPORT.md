# Tender single-call v3 DXL ??PASS

## Decision

**single-call v3 DXL = PASS.** This is a one-filing result, not a generalized v3 Practical PASS.

Base: `dc218d10e778964c4a852de27fa803e5650ceaf4`
Accession: `0001193125-26-298540`
Model: `gemini-3.5-flash`
Physical provider calls: **1**
Retry / repair / fallback / semantic correction: **0 / 0 / 0 / 0**

The v2 fixed-slot contract was retained. The only semantic-output-space change was that `offer_price.currency_text` is no longer an unconstrained string: before the call, a deterministic lexical inventory is derived from the supplied SEC Evidence and used as the provider-schema enum.

For this unchanged DXL packet the derived inventory is exactly:

```json
["$"]
```

The inventory does not choose the current or previous tender price, does not know the expected answer, and does not perform post-call repair. Gemini still decides whether offer_price exists, which amount is current, which amount is previous, and which Evidence refs support those claims.

## Source identity and isolation

The following files are byte-for-byte identical to the v2 DXL experiment:

- `source.json`: SHA-256 `6682b450b32e9c3ec10116cf5619065118de3728941b66c16768539018caff90`
- `provider-source.json`: SHA-256 `41060db95865df2bf38991910b40c8fc2817f6303b0d567bdfdf80f901033145`
- `evidence-map.json`: SHA-256 `c5ad97f31410e373d87c94b3bad134c8a89b8ba786f8732ffa4869d47455631d`

All 18 Evidence units and ordering are unchanged. No source search, expansion, pruning, case-specific Evidence addition, or Selector change occurred.

The provider request contains the exact same user/source payload as v2. The semantic baseline is stored separately and is not sent to Gemini.

## v3 contract change

v2 already required five fixed slots and an explicit `previous: value|null` decision for expiration, offer_price, and board_recommendation. v3 preserves that structure.

v3 adds a deterministic pre-call function that scans supplied Evidence for literal currency notations adjacent to numeric amounts. It recognizes currency symbols/prefixed dollar notations and ISO currency codes supported by the runtime. The resulting unique notations are injected only into the response schema.

For DXL:

```json
"currency_text": {
  "type": "string",
  "enum": ["$"]
}
```

This structurally rejects the two v2 errors:

- `"per share in cash"`
- `"$0.82"`

The amount fields remain unconstrained numbers from the model; the system does not derive or correct `0.82` or `0.84`.

If no supported currency notation can be derived, the v3 schema makes the offer_price slot null rather than accepting arbitrary currency text. That behavior is an explicit limitation to test on other representative filings before any production claim.

## Offline gates

Before the paid call:

- v3 tests: 15/15 PASS
- combined v1 + v2 + v3 regression: **44/44 PASS**
- exact v2 source/provider/map byte identity: PASS
- expected/baseline leakage: none
- current currency enum: `["$"]`
- previous currency enum: `["$"]`
- one-call durable reservation: PASS
- retry/repair/fallback prevention: PASS
- null slots create no canonical false FACTs: PASS
- amount values remain model-owned: PASS
- typecheck: PASS

The frozen preflight was completed with physical provider calls = 0.

## Sole provider call

- HTTP: **200**
- finish reason: **STOP**
- returned modelVersion: **gemini-3.5-flash**
- latency: **2,812 ms**
- input tokens: **5,996**
- output tokens: **355**
- total tokens: **6,351**
- physical calls: **1**

No additional paid call was made.

## Raw v3 output

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
      "currency_text": "$",
      "unit": "cash_per_share"
    },
    "previous": {
      "amount": 0.82,
      "currency_text": "$",
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

## SEC meaning review

All baseline fields match the frozen SEC Evidence:

| Field | Expected | Actual | Result |
| --- | --- | --- | --- |
| expiration.current | 2026-07-24 | 2026-07-24 | PASS |
| expiration.previous | 2026-06-22 | 2026-06-22 | PASS |
| price current amount | 0.84 | 0.84 | PASS |
| price current currency | $ | $ | PASS |
| price previous amount | 0.82 | 0.82 | PASS |
| price previous currency | $ | $ | PASS |
| board current | reject | reject | PASS |
| board previous | null | null | PASS |
| offer_status | null | null | PASS |
| final_results_observed | null | null | PASS |
| unresolved | [] | [] | PASS |

Direct support remains the same frozen source:

- expiration current: E1/E12/E13
- expiration previous: E4/E13
- offer price current: E8/E9/E12/E13
- offer price previous: E12/E13
- board current: E11/E12

No foreign, fabricated or irrelevant returned ref was found.

## Canonical projection

The transient fixed-slot output projects structurally to three canonical FACTs:

- expiration
- offer_price
- board_recommendation

Null status/final slots produce no canonical FACT. Board previous=null is omitted. Evidence arrays are structural unions of model-selected current/previous refs.

No source reading, value correction, currency normalization, previous insertion, or semantic repair occurs during projection.

Provider shape, local shape, canonical validation, structural projection and provenance all PASS.

## v2 vs v3

| Measurement | v2 | v3 |
| --- | ---: | ---: |
| prompt chars | 4,073 | 3,303 |
| schema chars | 3,302 | 3,328 |
| provider source chars | 19,742 | 19,742 |
| input tokens | 6,125 | 5,996 |
| output tokens | 317 | 355 |
| total tokens | 6,442 | 6,351 |
| latency | 2,932 ms | 2,812 ms |
| semantic result | FAIL | PASS |

One observation does not establish causal performance or general reliability.

## Remaining limits / next gate

v3 has only repaired the specific output-space weakness exposed by DXL while preserving the one-filing/one-call invariant. It has **not** yet earned generalized Practical PASS.

Important remaining checks before production:

- another all-cash filing using the same or different literal notation
- a filing with no applicable fixed-cash price
- a terminal/final-results-only filing
- a filing where multiple currency notations exist in selected Evidence, if a suitable real case exists
- partial/unavailable source behavior

Do not rerun DXL. Do not start DB/Monitor/product integration from this one result.

**STOP after this one authorized paid call.**
