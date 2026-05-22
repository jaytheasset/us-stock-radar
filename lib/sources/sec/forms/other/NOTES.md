# Other SEC Filing Fallback Notes

## Extractable Facts

- SEC metadata: form type, accession number, issuer name, ticker, CIK, filed date, title, and source URL.
- Primary and combined document text stats.
- Attachment summaries when provided by integration.
- Conservative keyword signals mapped only to existing canonical event type hints.
- Obvious dates or deadlines with short evidence.
- Obvious money, share, price, and percent candidates with source evidence.
- Named party candidates from issuer metadata and organization-name patterns.
- Reason the filing reached the fallback parser instead of a dedicated form parser room.

## Unstable Facts

- Named-party extraction is only a candidate pass; it can capture legal or boilerplate entities.
- Date role classification is sentence-level and may misclassify boilerplate legal dates.
- Value candidates are raw extracted terms, not offering economics or normalized investor impact.
- Keyword signals do not handle every negation, exhibit label, or incorporated-document context.

## Router Signal Candidates

- `listing_risk`: Nasdaq or NYSE deficiency, delisting, minimum-bid, continued-listing, or trading-suspension language.
- `dilution_risk`: offering, resale, ATM, warrant, convertible, private-placement, or equity-line language.
- `shareholder_vote`: shareholder meeting, proposal, vote, consent solicitation, approval, or record-date language.
- `leadership_governance`: executive, board, auditor, internal-control, compensation, or governance language.
- `strategic_transaction`: merger, acquisition, tender, asset sale, joint venture, license, partnership, or material agreement language.
- `financial_risk`: going concern, liquidity, default, debt, covenant, restructuring, or bankruptcy language.
- `legal_risk`: lawsuit, litigation, subpoena, investigation, settlement, enforcement, or regulatory proceeding language.
- `other`: administrative, correspondence, exhibit-only, routine, or ambiguous fallback filings.

## Router LLM Prompt Caveats

- Prefer `other` and `archive` when evidence is weak, mixed, boilerplate-heavy, or only parser-suggested.
- Do not invent event types. If a recurring fallback pattern needs a new taxonomy, document it for the integration/product room.
- Do not route to a dedicated canonical event type unless source-backed evidence survives the fallback context.

## Analysis LLM Prompt Caveats

- Treat router output as a hint, not final truth.
- Keep fallback summaries generic and short unless the filing contains source-backed investor relevance.
- Do not calculate dilution, discounts, float impact, or market-cap ratios.
- Use calendar items only for explicit investor-relevant dates or deadlines.

## Deterministic Completion Candidates

- Suppress low-confidence keyword matches when the evidence sentence contains direct negation.
- Add form-code-specific deny lists once live fallback samples show common administrative patterns.
- Promote repeated fallback form codes to dedicated parser-room candidates after sample review.

## Market Context Fields Needed

- Only needed if router/analysis sends the filing to a market-sensitive canonical event type.
- For dilution candidates, integration should use the existing offering market-context and audit flow rather than this fallback parser.
- For listing risk, useful market context includes price, exchange, market cap, and recent reverse-split/listing history.

## Score / Action Considerations

- Administrative or unclear fallback filings should stay below 50 and archive.
- Fallback filings should reach feed or alert only when source evidence is specific, timely, and investor-relevant.
- Score/action semantics should follow the common SEC thresholds:
  - score below 50: `archive`
  - score 50-74: `feed`
  - score 75 or above: `feed_alert`

## Display Model Type Candidates

- `generic_filing` for fallback archive/feed events with no specialized display.
- `offering_terms` only after a source-backed dilution/offering route and integration-owned audit.
- `governance` for shareholder vote or governance routes if existing UI supports it.
- `calendar` for a filing whose primary value is a confirmed investor deadline.

## New Detail UI Needs

- No new UI should be created from this room.
- If fallback volume justifies a dedicated generic SEC filing detail panel, hand that request to the display UI room.

## Integration-Room Wiring Tasks

- Register the fallback parser only after dedicated parser precedence is enforced.
- Pass parser facts to router prompt draft as non-authoritative candidates.
- Attach market context only after a canonical route requires it.
- Wire final event storage and display model mapping outside this room.

## Open Questions

- Which unmatched SEC form codes appear most often in production fallback traffic?
- Should repeated correspondence-only filings be skipped before LLM routing?
- Should future rooms split common fallback families such as CORRESP, CERT, 40-APP, or N-PORT?
