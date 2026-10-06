# Tender single-call v3 Carlyle final-results gate

Base: 148c0a0de557d75d28094e177138049c1826f28b

Purpose: validate the already-accepted v3 fixed-slot + source-derived currency-enum contract on one positive final_results_observed filing.

Paid scope:
- Carlyle Credit Solutions, Inc.
- SC TO-I/A
- accession 0001702510-26-000009
- maximum one Gemini 3.5 Flash physical call

Frozen expected:
- expiration: null (only historical expired offer results)
- offer_price: null (price tied to NAV and payment via promissory notes; outside fixed all-cash per-share contract)
- board_recommendation: null
- offer_status: null
- final_results_observed: { observed: true }
- unresolved: []

Rules:
- Reuse exact source.json/provider-source.json/evidence-map.json bytes from tender-union-single-call/runs/carlyle-final.
- Reuse v3 contract without modification.
- No source search/expansion/pruning.
- No retry/repair/fallback/per-FACT call.
- Expected baseline never enters provider input.
- Stop after this one call whether PASS or FAIL.
- No DB/Monitor/product/main merge/push/deploy.
