# Alert ticker projection diagnostics

## Stored subscriptions and matching

`user_alert_tickers` remains the source of saved subscriptions. Its UUID, literal ticker,
enabled state and creation timestamp are not rewritten by evaluation or delivery.
`user_alert_deliveries.ticker` remains the analyzed event ticker, including sent history.

`lib/alerts/delivery/tickerSubscriptionMatch.ts` is the common matcher used by server
evaluation and the per-event CLI. Batch entry points use those same paths. Literal
matches retain the existing event-ticker behavior. An enabled literal subscription can
survive independently when an older subscription's projected relationship is rejected.

Projection requires the official `readSecTickerProductProjectionForTicker` result to
be available. That reader applies the effective AUTO/Human decision and source-revision
rules; the Alert adapter does not infer approval from candidate decisions. It also
requires a company SEC filing event, CIK, accession, and a validated cover observation
bound to the event's primary document URL and raw-item identity. The event security
must belong to the verified ticker component and match its issuer, security title,
exchange and context dimensions. Common shares and warrants or different classes
cannot be joined by issuer alone.

For a graph source filing the adapter reuses the official reader's verified edge.
Other filings require a complete cover whose normalized title, exchange identity and
dimensions match the current anchor. Both readers share the existing exchange
normalizer in `lib/sec-ticker-resolution/exchangeIdentity.ts`: for example NASDAQ and
The Nasdaq Stock Market LLC identify the same exchange, including on a new non-anchor
filing. The mapping is unchanged from the official product reader; NYSE and NYSE
American remain distinct, and issuer, class/title and dimensions must still match.
News, ticker-only and issuer-only events use literal
matching. Missing, ambiguous, REVIEW, UNRESOLVED, rejected or stale evidence never
creates a projected match. Lookup failure means unverified, not proof of absence.

## Queue provenance and transmission

Migration `20260913130530_alert_ticker_match_provenance.sql` adds one nullable JSONB
column to the existing outbox. Version 1 records each original saved subscription UUID,
saved ticker, matched event ticker and literal/projection kind; projected bindings also
record the issuer CIK. This is selection provenance, not a cached authorization.
The migration does not change RLS, subscription rows or existing history.

All newly selected watchlist deliveries retain that provenance. The existing
user/event deduplication and channel-attempt claim remain the concurrency boundary.
The per-event CLI inserts the outbox row before immediate processing. Both it and the
queued CLI invoke the shared `processQueuedDeliveries.ts` processor; neither has a
private provider sender.

After acquiring each channel claim, `revalidateTickerDelivery.ts` reads the original
enabled subscription UUIDs and the normalized event, then creates a fresh official
matcher. Telegram validates immediately before presentation/provider invocation; email
validates through `beforeSend` after rendering; web validates before completing its
visibility claim. A disabled/deleted original, changed binding, invalid provenance,
unavailable evidence or newly ineffective relationship suppresses the unsent owned
claim. Re-adding the same ticker with another UUID does not revive it. Another original
literal binding may still authorize the same delivery.

Sent channels are not retracted. Existing uncertain/in-progress channel protections
remain in effect. A later worker may reconcile a queued row after concurrent workers
finished different channels, without sending those channels again. A suppressed row
is not revived by replay. Legacy watchlist rows with null provenance and non-watchlist
lanes retain their prior behavior; no speculative provenance is backfilled.

This is a fresh-read boundary, **not a transaction spanning Human decisions, source
updates and provider sends**. A change visible before the relevant final read is
observed. A change after that read, during subsequent reads or at provider invocation
can race an already authorized send. There is no linearizable cancellation guarantee
or promise to retract an external message. Existing claim/idempotency protection
prevents concurrent/replayed sends per delivery/channel; it does not make external
delivery atomic with a Human decision.

## Telegram and unaffected policies

Telegram body, filing link and Live Room use the event ticker. Mute buttons use the
surviving original saved tickers, so a BTLN event selected by saved GGRP offers Mute
GGRP and the existing callback resolves that saved row. If both saved tickers remain
valid, both mute actions are offered on the single notification.

Discovery eligibility, plans, categories, market-cap filters, provider readiness and
existing literal deduplication remain in their existing policy functions. Projection
no-match does not imply Discovery no-match. Monitor, Watchlist display, SEC ingestion,
observations, resolution/Human engine and LLM analysis are outside this change.

## Investigation and verification

1. Read the stored event and original saved row without modifying either. Check the
   event's primary document URL, accession, CIK and raw item.
2. Read the official product projection and cover observations. Preserve distinctions
   between rejected/unresolved/reconsideration and an unavailable read.
3. Inspect outbox `ticker_match`, status and channel-attempt rows. Compare original
   UUIDs with currently enabled saved rows. Do not rewrite provenance to revive a row.
4. Inspect the relevant provider result or mock ledger. Queue count alone does not
   prove one external send. Check each delivery/channel's claim and replay behavior.
5. Verify server, batch, per-event CLI and queued CLI with the same isolated DB and
   mocked providers. Keep actual SEC source evidence separate from synthetic analyzed
   events, subscriptions, Human actions, injected failures and race fixtures.

The CLI bridge `scripts/alert-delivery-runtime.mjs` loads the shared TypeScript server
modules with Node's `registerHooks` and the installed TypeScript TSX transpiler. This
path was exercised on Node 24.15.0 with the repository's installed dependencies;
older Node runtimes or production installs omitting TypeScript are unverified.
