# S-1 / F-1 Integration Notes

## Extractable Facts

- Form family and amendment status for `S-1`, `S-1/A`, `F-1`, and `F-1/A`.
- IPO/new listing, primary registration, resale registration, mixed primary/resale, and routine amendment candidates.
- Shares offered, primary shares offered, resale share count, current shares outstanding, price range, offering price, offering amount, gross proceeds, and net proceeds.
- Use of proceeds, dilution, capitalization, underwriting, lock-up, selling-stockholder, warrant, convertible, and risk-factor excerpts.
- Selling-stockholder table rows when text is line or pipe delimited.
- Fee table presence and simple total offering amount / maximum aggregate offering price / registration fee candidates.
- Calendar candidates for IPO pricing, expected listing, registration effectiveness, offering closing, and lock-up expiration.

## Unstable Facts

- SEC HTML tables vary heavily, especially selling-stockholder and capitalization tables.
- Price ranges and share counts can appear in fee tables, cover pages, footnotes, or placeholders.
- Early S-1/F-1 drafts often omit pricing, underwriting, and listing timing.
- S-1/A and F-1/A can be complete prospectus rewrites or narrow exhibit-only amendments.

## Router Signal Candidates

- `ipo_listing`: initial public offering, no prior public market, exchange listing application, expected pricing/listing dates.
- `primary_registration`: issuer is offering or selling shares/securities, or issuer receives offering proceeds.
- `resale_registration`: selling stockholders/shareholders, resale prospectus, no issuer proceeds from selling-holder sales.
- `mixed_primary_resale`: issuer-sale and selling-holder resale mechanics both present.
- `routine_amendment`: unchanged-remainder, exhibit-only, signature-only, consent-only, or no material offering signals.

## Router LLM Prompt Caveats

- Router should not treat every S-1/A or F-1/A as a fresh dilution event.
- Router should not infer IPO status from form type alone.
- Router should not calculate share/float/market-cap ratios.
- Router should preserve `other` only as a documented fallback.

## Analysis LLM Prompt Caveats

- Analysis should use common SEC action semantics: `<50 archive`, `50-74 feed`, `75+ feed_alert`.
- Resale proceeds are not issuer cash unless the filing separately states company proceeds.
- Fee table amounts are SEC registration math unless supported by prospectus proceeds language.
- Authorized shares and generic capital-stock descriptions are not offered share supply.
- Warrant, pre-funded warrant, and convertible components should be separated from current registered common-share supply.

## Deterministic Completion Candidates

- Better HTML table parsing for selling stockholders, dilution, and capitalization.
- Fee table tokenization comparable to the S-3 parser.
- Amendment triage for exhibit-only, consent-only, and unchanged-remainder S-1/A or F-1/A filings.
- Registration number and prior amendment comparison when parent filing context is available.

## Market Context Fields Needed

- Current or previous-close price.
- Market cap.
- Shares outstanding.
- Public float.
- Volume and average volume for resale/overhang liquidity context.
- Code-calculated dilution metrics from selected filing facts plus market context.

## Score / Action Considerations

- IPO/new listing with concrete pricing or listing timing should usually be feed-level or alert-level depending on specificity and market interest.
- Resale registrations should normally be feed-level dilution/overhang when share count or selling-holder table is present.
- Primary or mixed offerings should rise with concrete share count, price, warrants/convertibles, closing timing, liquidity pressure, or large market-relative size.
- Routine amendments should stay archive-level unless changed economics or material offering terms are detected.

## Display Model Type Candidates

- `ipo_registration` for IPO/new listing S-1/F-1 filings.
- `offering_terms` for primary or mixed registrations with issuer-sale mechanics.
- `share_overhang` for selling-stockholder resale registrations.
- `routine_filing` for administrative amendments.

## New Detail UI Needs

- No new UI is implemented in this room.
- Integration/display rooms should decide whether `ipo_registration` needs a dedicated detail model or can reuse `offering_terms`.

## Integration-Room Wiring Tasks

- Register the parser for `S-1`, `S-1/A`, `F-1`, and `F-1/A`.
- Decide where to store `hard_parsers.s1_f1` and prompt evidence.
- Connect router and analysis prompt drafts to the prompt registry only after integration review.
- Attach market context and code-calculated dilution metrics before final score/action policy.
- Map calendar candidates only after common calendar validation.

## Open Questions

- Should IPO/new listing events use `dilution_risk`, `other`, or a future IPO-specific event type?
- Should `display_model_type = ipo_registration` be added, or should IPOs use `offering_terms` until a dedicated UI exists?
- How much parent-registration context should S-1/A and F-1/A amendments receive before analysis?
