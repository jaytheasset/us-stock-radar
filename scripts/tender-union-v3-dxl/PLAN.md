# Tender single-call v3 DXL

Goal: preserve the v2 fixed-slot/required-previous contract and change only offer_price.currency_text from a free string to a deterministic source-derived lexical enum.

Invariants:
- Base commit: dc218d10e778964c4a852de27fa803e5650ceaf4.
- Exact DXL source.json, provider-source.json and evidence-map.json bytes are copied from v2.
- Gemini model stays gemini-3.5-flash.
- One physical provider call maximum; no retry, repair, fallback, per-FACT call or source expansion.
- Expected semantic baseline never enters the provider request.
- Currency candidates are derived before the call from literal notation adjacent to numeric amounts in supplied Evidence only.
- Currency candidate extraction does not choose current/previous price amounts or tender semantics.
- Provider schema constrains current and previous currency_text to those literal candidates.
- Canonical projection remains structural only; no semantic repair.
- If preflight fails, no provider call.
- If DXL fails semantically, stop.

DXL frozen baseline remains:
- expiration 2026-06-22 -> 2026-07-24
- offer_price $0.82 -> $0.84 cash_per_share
- board current reject, previous null
- offer_status null
- final_results_observed null
- unresolved []

Paid scope: DXL one call only. No DB/Monitor/product/main merge/push/deploy.
