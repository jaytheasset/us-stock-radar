# Stock-page SEC listing status

`readStockListingStatus` is the shared read-only server adapter for stock-page
SSR and `GET /api/stocks/[ticker]/listing-status`. It does not write observations,
run analysis, or evaluate monitors. Listing Status v1 remains unchanged.

## Identity and canonical reads

The exact ticker discovers stored security identity candidates. Candidate fields
are not proof: `resolveListingAttachment` revalidates the existing stable/change
identity against its SEC cover evidence. Multiple candidate identities, historical
symbol ambiguity, missing proof, and an unestablished identity remain unknown.
There is no issuer-name/CIK-only fallback or selection of the first security.

The adapter uses `readSecListingHistory` and `readSecListingStatusAsOf` for the
validated security/exchange scope. An official attachment can identify the
source's shorter subject wording; otherwise the exact cover scope is used.
Multiple distinct attached scopes remain unresolved rather than being combined.

## Limited public response

The JSON envelope is `{ ok, data }`. `data` contains ticker, query `asOf`,
`coverage: stored_sec_observations_only`, availability/reason, optional verified
security/class/exchange, automatic listing/trading states and supported dates,
SEC filing references, and separate human-reviewed dates. Missing dates are null.

An unknown result is HTTP 200. An incomplete/failed reader is HTTP 503, not empty
evidence. Invalid ticker syntax/case is HTTP 400. Responses use `no-store`.
No mutation endpoint, bulk access or new schema-version system is introduced.

The stock page shows this result below the company/ticker header. Dates retain
their roles (scheduled, effective, withdrawal notice, resumption). Query as-of
is not an effective date or assurance of live exchange status. No ACTIVE state is
inferred. Primary prose, scores and Monitor matches are not status sources.

Only usable, exact-attached history selected by the projection supplies SEC
links. Excluded records are not presented as supporting evidence; linked closed
events are labeled as earlier events. Reviewed dates come from the existing
revalidating review reader, without changing the automatic state. Raw payloads,
model output, review actor IDs, internal error messages and private audit bodies
are never serialized into this public model.

## Local verification (2026-10-01)

- Main DB: 127.0.0.1:56322, PostgreSQL system identifier 7678429483712069671.
- Existing PLTR/TTOO: identity unresolved, both axes unknown, no inferred ACTIVE.
- Test-scoped SCPX: retained original SEC HTML for accessions
  0001079973-24-000635, 0001079973-24-000767, 0001079973-24-000891,
  0001079973-24-001121. Existing raw-store, cover parser/writer, stable identity
  writer and source-validating status writer were used. This is retained-source
  preparation, not a fresh collection/LLM/automatic-Monitor E2E claim.
- Added four raw filings and cover results (including sibling security rows),
  one exact common-stock/NYSE American identity, two linked status observations,
  and one completed test source run. No canonical state was directly inserted.
- SCPX: removal decision withdrawn, notice 2024-07-29; trading unresolved;
  no confirmed resumption or suspension date invented. Both SEC accessions/links
  agree on the page and JSON. Canonical writer replay adds no observations.
- Original protected rows are unchanged; no AI, Monitor, alert or review writes.
- Authenticated desktop and guest desktop/768px/390px views checked. Human date
  separation/stale-review exclusion are regression-tested; no new real human
  decision was created for this display task.
- Focused status/identity/header/adapter regressions: 119/119 passed. Full
  TypeScript check and diff whitespace check passed. HTTP/UI/official values and
  accession links agree; invalid ticker returns 400 and POST returns 405.
- Evidence outside Git:
  `C:/Users/PC/.codex/visualizations/2026/10/01/stock-listing-status-surface/`.
  API HTTP results, official projection, DOM comparison, screenshots, replay and
  before/after hashes are preserved there. Chrome capture/viewport issues were
  worked around with the supported in-app browser; its raw API navigation is
  client-blocked, so JSON contents/status were verified via HTTP readback.

Limitations: current projection is bounded by stored SEC evidence, not market-wide
coverage or live listing status. This adds no collection, state, identity, review,
Monitor, migration, or provider behavior. No push or deployment is part of it.
