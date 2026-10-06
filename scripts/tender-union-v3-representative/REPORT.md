# Tender single-call v3 representative batch — PASS

## Decision

DXL v3 PASS에 이어, 추가 대표 사례 **Rumble + Xerox 2/2 PASS**.

This stage used exactly two additional Gemini calls and then stopped. It does not yet claim complete generalized v3 Practical PASS because a positive final_results_observed-only filing has not been revalidated under v3.

## Contract

The accepted DXL v3 contract is reused without modification:

- five required fixed slots
- explicit previous value|null decisions
- source-derived currency notation enum
- null slots are transient abstentions, not canonical false claims
- deterministic structural projection only
- one filing = one Gemini physical call
- no retry / repair / fallback / per-FACT calls

## Sources

Both filings reuse byte-identical frozen source/provider/map artifacts from the prior single-call v1 experiment. No source search, expansion, pruning or Selector changes were made.

### Rumble
- Accession: 0001213900-25-000757
- Form: SC TO-I
- Currency inventory: ["$"]
- Expected: expiration + fixed cash price + board no_recommendation; no terminal/final fact

Raw result:
- expiration current 2025-02-04, previous null
- offer_price $7.50 cash_per_share, previous null
- board no_recommendation, previous null
- offer_status null
- final_results_observed null
- unresolved []

Direct support:
- expiration: E1/E2/E16
- price: E8/E9/E16
- board: E12/E13/E15
- E11 is corroborating only

The model did not promote:
- $12.40 market price or aggregate amounts to offer_price
- may-terminate or shareholder withdrawal language to offer_status
- future preliminary/final proration language to final_results_observed

Result: **PASS**

Provider:
- Gemini 3.5 Flash
- physical calls: 1
- HTTP 200 / STOP
- input 7,357 tokens
- output 255 tokens
- latency 2,967 ms

### Xerox
- Accession: 0001193125-20-092896
- Form: SC TO-T/A
- Currency inventory: ["$"]
- Expected: offer_status terminated only

Frozen source contains a historical composite tender consideration:
- $18.40 cash
- plus 0.149 Xerox shares

That is outside the accepted fixed all-cash offer_price scope.

Raw result:
- expiration null
- offer_price null
- board_recommendation null
- offer_status terminated, E7
- final_results_observed null
- unresolved []

The model correctly ignored filing fees, transaction valuation, $22.05 market price and the composite consideration as fixed cash offer_price.

Result: **PASS**

Provider:
- Gemini 3.5 Flash
- physical calls: 1
- HTTP 200 / STOP
- input 2,985 tokens
- output 77 tokens
- latency 2,338 ms

## Batch totals

- physical Gemini calls: **2**
- input tokens: **10,342**
- output tokens: **332**
- total tokens: **10,674**
- retry: 0
- repair: 0
- fallback: 0
- semantic corrections: 0

## Validation

- artifact audit: PASS
- semantic baseline comparison: 2/2 PASS
- schema/local/canonical/provenance: PASS
- source/provider/map identity: PASS
- expected/baseline request leakage: none
- representative offline tests: 12/12 PASS
- v1+v2+v3 combined regression: **56/56 PASS**
- typecheck: PASS
- git diff check: PASS

## Current v3 evidence

Successful single-call v3 observations now include:

1. DXL — amendment with expiration previous/current, price previous/current, board reject
2. Rumble — active filing with expiration, price and no_recommendation simultaneously
3. Xerox — terminal filing with composite price excluded and offer_status terminated

This materially strengthens the v3 candidate.

## Remaining gate

A positive `final_results_observed=true` filing has not yet been revalidated using the v3 fixed-slot/currency-enum contract. Carlyle remains the cleanest already-frozen candidate for that next gate.

No Carlyle call was made in this stage.

Do not start DB/Monitor integration or claim production readiness from these three observations alone.

**Stage result: v3 representative active/terminal PASS. STOP after two authorized calls.**
