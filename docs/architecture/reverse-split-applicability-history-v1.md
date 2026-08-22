# Reverse Split Applicability & History Contract V1

This contract supplies source-backed inputs for a future share-basis normalizer. It does not adjust an O/S value, aggregate security classes, calculate dilution, or claim that reverse splits are the only possible basis-changing action.

## Identity boundary

An issuer CIK is available only when the Corporate Action event's exact SEC accession resolves to `sec_filing_ledger`. Ticker, company name, source title, parser output, and prior AI output are not issuer identity. News and Nasdaq actions therefore keep issuer applicability unavailable in V1 unless a later authoritative identity boundary is added.

The deterministic context reader supplies only canonical common-stock class IDs already admitted by `share_count_history` before the source filing's verified SEC acceptance timestamp:

- single common: `sc:v1:<CIK>:common_stock:single`
- class-specific: `sc:v1:<CIK>:common_stock:us-gaap:<MemberLocalName>`

The existing Corporate Action Gemini call reads the source and may select exactly one supplied candidate. It cannot create an ID. A generic common-stock reference with multiple candidates, unsupported/custom class identity, or ADS-versus-ordinary ambiguity is stored as unavailable. No title/synonym/ticker mapping exists in code.

## Canonical extension

Existing `corporate_action_reverse_split_facts_v1` fields remain valid. New results also contain:

- `applicability.version = reverse_split_applicability_v1`
- the exact filing-ledger issuer context or an unavailable reason
- affected security mapping or an unavailable reason, exact source evidence, and candidate provenance
- `basis_change_capability = reverse_split_only`
- exact ratio source components (`old_share_units`, `new_share_units`) in addition to the backward-compatible derived `old_shares_per_new_share`
- effective timing that is either source-backed `market_open`, `start_of_trading`, `after_market_close`, or `exact_timestamp`, or explicitly unavailable (`not_provided`, `date_only`, `ambiguous`)

A date-only fact does not establish same-day ordering. The future normalizer must fail closed when its target falls on that date and no source-backed session ordering is available.

## Persistence and history

`event_corporate_action_facts` remains the only Corporate Action fact table. A before-insert materializer records indexed issuer/class/date fields while preserving the full canonical JSON and immutable Generic Monitor lineage. Old rows without the extension remain readable.

`readReverseSplitHistory({ cik, canonicalSecurityClassId?, from, to })` first reads mapped candidates, then calls the existing current-event Corporate Action reader for every candidate. A stale parent, superseded child, not-applicable result, or mismatched execution is excluded. Results retain event, execution, accession/source, ratio, applicability, timing, and evidence provenance. Multiple dated splits are returned in effective-date chronology. A deterministic tie order does not convert date-only items into semantic same-day ordering.

For basis-normalization consumers, this raw observation reader is superseded by
`readReverseSplitActionHistory()`. The successor groups current observations by
the canonical lifecycle ID so multiple filings for one real split cannot be
applied as separate actions. See `reverse-split-canonical-action-identity-v1.md`.

The reader reports `basisChangeCoverage = reverse_split_only`. Forward splits, stock dividends, recapitalizations, ADS-ratio changes, and other basis changes are not detected by this V1 contract; downstream code must never infer their absence from an empty reverse-split history.
