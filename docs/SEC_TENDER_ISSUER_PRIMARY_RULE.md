# SEC Tender / CB / 13E3 Primary Ticker Rule

For Tender / CB / 13E3 filings, the event primary ticker must follow the SEC filing issuer, filer, or public reporting company when that ticker is source-backed.

Do not promote a target, subject company, buyer, offeror, parent, merger sub, or other transaction counterparty ticker to `primary_ticker` merely because that company has the larger expected market reaction.

Use target or subject-company tickers only as related transaction context:

- `transaction_fingerprint.target_ticker`
- `related_tickers`
- related filings / transaction history context

If no source-backed issuer/filer ticker exists, keep `primary_ticker.ticker` null rather than backfilling it with a target ticker.

The analysis text may explain the impact on target or subject-company holders, but event ownership, chart/market context, dedupe, alert routing, and primary ticker persistence must remain issuer/filer based.
