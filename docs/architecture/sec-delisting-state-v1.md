# SEC delisting state, phase 1

This is a read-only, derived evidence reader. It does not change the security
catalog or any filing, analysis, Monitor, Watchlist, or Alert row. No migration,
automatic collection, state persistence, API route, or UI is added.

## Form 25 ingest connection (2026-09-14)

The reader and its phase-1 rules below remain unchanged. `runSecRawIngest` now
invokes `runForm25DelistingAutomaticTrigger` after a new raw save and on an
existing-raw replay for the existing Form 25 supported-form list. The adapter
loads the exact stored raw ID/accession, uses the existing Form 25 parser's XML
issuer/security/exchange fields to prepare the scope, and calls the existing
reader with that single raw ID and the ingest run's UTC as-of date. Exchange
filer CIK and ticker/catalog metadata cannot substitute for XML issuer identity.

The outcome is recorded in existing `source_runs.metadata.form25_delisting`
and returned in the ingest item's `form25_delisting` field. This is a per-run
evidence evaluation record, not a current security-state table. It retains
scope, selected raw/event IDs, accession, as-of, states, reasons, parser/reader
versions and source URLs/hashes; original document bodies and AI payloads are
not copied into run metadata. Raw metadata and site analysis remain untouched.
No migration is needed. Replays make another execution record but do not create
duplicate delisting-state rows or rewrite prior failure records.

Reader/query exceptions are recorded as `failed`; missing XML scope is
`unavailable`. A successful reader's unresolved or pending evidence is preserved
as its result, not treated as an ingest failure. Failed evaluations do not change
raw ingest success or invoke site analysis, and an ordinary source replay retries
them. The existing source-run terminal writer persists outcomes; if that writer
itself fails, its existing error behavior is retained and durable recording is
not claimed. There is no new retry worker, scheduled as-of refresh, combined
all-filings state, UI, Alert, Watchlist, administrator, or catalog integration.

Official TTOO/FTCH source bytes were replayed through the product raw-ingest,
raw-store, existing parser/reader and source-run terminal persistence in the
dedicated `127.0.0.1:59822` database. TTOO remained confirmed/suspended; FTCH
remained removal-pending/trading-unresolved. Repeated and simultaneous replay
kept one raw row per accession. Injected event-query failure and helper exception
were recorded separately while the run stayed completed; replay recovered and
the prior failure record remained. Raw/source strings and pre-existing partial
archival analysis stayed unchanged. The transaction was rolled back, pre/post
counts matched, and external HTTP/LLM/notification calls were zero. These checks
do not constitute a new site-analysis execution or user-screen E2E.

## Scope and states

`readStoredDelistingState` requires explicit stored raw-item IDs (maximum 100),
issuer CIK, exact declared security title, exact exchange name, and an as-of
date. Its coverage is **selected stored filing evidence only**, not all stored
filings, all SEC history, or a complete present-day exchange/trading status.
The caller must not describe `removal_pending` as proof that a years-old case is
still pending today. It means the selected sources do not confirm completion.

- Listing: `confirmed_exchange_delisting`, `removal_pending`, or `unresolved`.
- Trading: `suspended`, `suspension_scheduled`, or `unresolved`, independently.
- Catalog flag: `inactive_only`, `active_flag_only`, or `unavailable`. Neither
  flag establishes listing status. Missing sources or read errors are unresolved.

Confirmed removal means the stated security was removed from the stated
exchange under the selected source evidence effective as of the requested date.
It does not mean all trading stopped, OTC trading ended, SEC registration ended,
or the issuer disappeared. Filing/signature/index-effectiveness dates and
filing-plus-10/90-day arithmetic cannot establish this state.

## Reused sources and fail-closed boundaries

The existing Form 25 parser reads preserved `primary_document_html` XML and
stored official attachments. A separate invocation of that same parser obtains
issuer, exchange and security from XML without accepting catalog/filer metadata
as issuer identity. No parser or site-analysis contract is changed. Optional
existing event `display_payload` fields are checked for contradictions; missing
fields are never reconstructed and free-text AI summaries do not establish state.

The existing cover parser supplies filing/security identity for 8-K/6-K only;
their states come from `readCurrentListingRiskFacts`, including its current
execution/parent lineage checks. A source-stated, exact, `occurred` removal date
with matching SEC accession/evidence can confirm removal. Conditional facts
cannot. This does not run or extend an analyzer. Missing/unverified cover
identity (including unsupported 6-Ks) or missing current typed facts remains
unresolved. Non-SEC Listing Risk source families are outside phase 1.

Common stock, warrants, preferred/debt and different classes are not merged.
Exact exchange names are intentionally not normalized by substring: NYSE Arca
is not NYSE. Multiple identities, source/analysis conflicts, truncated documents,
failed document fetches, withdrawal/stay language, and conflicting notice dates
fail closed. The reader does not choose a convenient older record when selected
evidence disagrees. Amendments and reinstatements are not independently resolved.

Each result retains raw/event IDs, accession, issuer versus filer, source URLs,
original stored document strings and their UTF-8 SHA-256, parser fields/evidence,
optional stored analysis and official typed-reader result. A stored extracted
attachment string's hash identifies that stored string; it must not be advertised
as a byte-identical HTTP artifact unless separately compared with the original.
Repeated/concurrent reads do not create or overwrite state.

## Verification (2026-09-14)

Official TTOO `25-NSE/A` accession `0001354457-25-000637` XML identifies issuer
1492674, Common Stock, Nasdaq Stock Market LLC; exchange filer is 1354457.
The official notice establishes removal effective July 21, 2025 and suspension
February 12, 2025. Original documents, unchanged existing parser output, isolated
stored raw/event records, and the reader agree: confirmed exchange delisting and
suspension. Before July 21 the listing result remains pending.

Official FTCH `25-NSE` accession `0000876661-23-001010` identifies issuer 1740915,
Class A ordinary shares, NEW YORK STOCK EXCHANGE LLC; exchange filer is 876661.
The notice reports an intention to remove January 2, 2024. The reader preserves
that date but does not turn source intention into completion confirmation. The
source also describes immediate suspension; the existing parser does not extract
that suspension date, so the trading result remains unresolved. No parser fix or
AI replacement was made. An archived analysis rendering has a filer-CIK defect;
it remains untouched and is not used to replace XML issuer/filer identity.

Two actual cases used the existing dedicated isolated DB `127.0.0.1:59822` in a
transaction. Replay, concurrent reads, wrong-security rejection and unchanged
raw rows passed. Test raw/event records were rolled back and pre/post table
counts matched. There were no external HTTP/LLM/notification calls during E2E.
Previously saved analysis renderings were reused only as explicitly partial
archival metadata; no new AI analysis was called or fabricated.

The 8-K current typed-fact positive case, source conflicts, inactive/missing data,
different classes, and date/withdrawal boundaries are synthetic regressions,
separate from the two real Form 25 cases. No real 8-K/6-K typed state E2E or user
screen E2E is claimed. UI, Alerts, Watchlist handling and lifecycle automation are
deliberately deferred.
