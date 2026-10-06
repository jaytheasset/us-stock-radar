# Tender single-call v3 representative batch

Base: b6afb3f2571358ff1479a87fd78e3fbe2bc892a9

Purpose: after DXL v3 PASS, test the same fixed-slot + source-derived currency-enum contract on two already-reviewed SEC filings with no source selection changes.

Paid cases, maximum 2 total:
1. Rumble 0001213900-25-000757 — positive expiration + fixed-cash offer_price + board no_recommendation; status/final null.
2. Xerox 0001193125-20-092896 — composite cash+stock offer_price must remain null; actual offer_status terminated; all other slots null.

Rules:
- Reuse exact source.json/provider-source.json/evidence-map.json bytes from tender-union-single-call frozen runs.
- Use the exact v3 DXL contract without modification.
- gemini-3.5-flash only.
- One physical call per filing, no retry/repair/fallback/per-FACT calls.
- Stop if Rumble has a semantic or technical failure. Xerox can run only after a preserved Rumble review PASS.
- Baselines are frozen outside provider input and derived by direct SEC source review.
- No DB/Monitor/product/main merge/push/deploy.
