# S-4 / F-4 Integration Notes

## extractable facts

- Transaction parties, including registrant, acquirer, target, and merger sub candidates.
- Deal type: merger, business combination, exchange offer, reorganization, asset acquisition, redomiciliation, or unknown.
- Consideration sentence, cash consideration, stock consideration, exchange ratio, cash/stock mix, securities registered, shares to be issued, and post-transaction ownership excerpts.
- Shareholder meeting date, record date, vote deadline, vote requirements, and proposal candidates.
- Conditions, termination fee, outside date, expected closing timing, risk factor excerpt, financial statements reference, and pro forma reference.
- Calendar candidates for merger vote, shareholder record date, vote deadline, expected closing, and outside date.

## unstable facts

- Party-role inference is heuristic when the filing only gives a long "by and among" party list.
- Exact securities and share counts may be table-heavy; fee-table-only values should be audited before user-facing dilution math.
- Expected closing windows such as "third quarter of 2026" are preserved as estimated text and should not be treated as exact calendar dates.
- Amendments can be parent-context dependent; materiality should compare changed terms against prior filings when integration adds parent context.

## router signal candidates

- `merger_registration`: merger agreement, registration of shares, joint proxy/prospectus.
- `business_combination`: SPAC/de-SPAC or business combination agreement.
- `exchange_offer`: offer to exchange, tendered shares, expiration.
- `shareholder_vote`: special meeting, record date, vote threshold, merger/share issuance proposals.
- `stock_issuance_or_ownership_impact`: registered equity, shares to be issued, exchange ratio, post-closing ownership split.
- `amendment_limited_scope`: exhibit-only, consent-only, signature-only, unchanged remainder.
- `amendment_material_change`: changed consideration, exchange ratio, meeting/vote dates, conditions, termination fee, risk factors, or pro forma financials.

## router LLM prompt caveats

- Parser facts are candidates only; route from source text.
- S-4/F-4 stock consideration is usually part of `strategic_transaction`, but can become `dilution_risk` if issuance size or ownership shift dominates investor impact.
- Limited amendments should usually be `skip_analysis` or archive-level `other`.

## analysis LLM prompt caveats

- Do not calculate dilution percentages, market ratios, exchange-value premiums, or merger spread.
- Use S-3 offering/dilution scoring concepts only when code provides compatible market context or the filing clearly states share issuance/ownership facts.
- Separate deal consideration from ownership impact and issuer cash from registered stock issuance.
- Analyze only changed terms for S-4/A and F-4/A.

## deterministic completion candidates

- Add parent-registration comparison for amendments to decide routine vs material changes.
- Add table-aware extraction for fee table rows, pro forma tables, and exchange-offer expiration tables.
- Add stricter party extraction from SEC cover-page tagged text if raw XBRL/HTML structure is available.
- Add code-side stock-issuance metrics that reuse offering market context for shares-to-outstanding and shares-to-float ratios.

## market context fields needed

- Current price, market cap, shares outstanding, public float, volume, and average volume.
- If stock consideration is public-company shares, market context for the issuer/acquirer ticker is needed.
- If target is public, target ticker context can help estimate market sensitivity, but the parser does not fetch it.

## score/action considerations

- Common SEC thresholds apply: score below 50 archive, 50-74 feed, 75+ feed_alert.
- Routine amendments should score below 20.
- Merger registrations and exchange offers usually merit feed-level scoring when source text has concrete terms.
- Alert-level scoring is appropriate for near-term votes/expirations, material changed economics, high closing risk, or large code-supplied stock issuance impact.

## display_model_type candidates

- `strategic_transaction` for merger, acquisition, exchange offer, and business combination detail.
- `shareholder_vote` for meeting/vote-led filings.
- `offering_terms` only when stock issuance/dilution mechanics dominate.
- `generic_filing` or `none` for administrative amendments.

## new detail UI needs

- A future `strategic_transaction` detail model would need transaction parties, consideration, vote schedule, ownership impact, conditions, termination fees, and pro forma/risk references.
- No detail UI is implemented in this room.

## integration-room wiring tasks

- Register `parseSecS4F4Filing` with the SEC form parser registry.
- Decide where `s4_f4` parser facts live in `hard_parsers` or `router_evidence`.
- Add prompt registry entries only after integration chooses the router/analysis path.
- Attach market context and optional dilution metrics when stock issuance impact should be scored.
- Map calendar candidates into persisted calendar items after final analysis.

## open questions

- Should exchange-offer expiration use the tender-offer calendar type or a merger/deal-specific type when the offer is in an F-4?
- Should S-4/F-4 stock issuance use the existing offering display model or a new strategic-transaction ownership model?
- How much parent filing context should be fetched for S-4/A and F-4/A amendment triage?
