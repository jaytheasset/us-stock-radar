# Current header: three live issuers through DB, Next and Edge

2026-10-07 Asia/Seoul. Product verification base:
`aee477a71dda272a29e78d88f04a1adc88b5ce1c`, detached eeb4.
No product code, authentication, schema, environment file or dependency changed.

Follow-up: the status-message clipping recorded below was subsequently reproduced
and fixed with scoped CSS. Non-interfering hydration/capture checks are documented
in [`SEC_HEADER_STATUS_READABILITY.md`](SEC_HEADER_STATUS_READABILITY.md).

## Result and limits

**Same-live-source connection PASS:** main Submissions → explicit refresh → owned
PostgreSQL current → actual Next reader → Edge. Five representative tickers ×
1440/900/390px = 15 search journeys passed. Including direct entry, normalized
route, cross-company/back/forward, reload and absent-current: 22 browser assertions.
This is not an unconditional visual/accessibility or authenticated-flow PASS.

**Visual finding, unchanged product:** `/stocks/MSFT` at 390px correctly returns
`not-confirmed`, no company-name fallback and no confirmation time. However its
visible message is truncated to `Company information …`, hiding the distinction
between not-confirmed and temporarily unavailable. Expected: readable unconfirmed
notice. Actual DOM: `Company information not yet confirmed`; actual pixels:
ellipsis. Cause location: `StockRadarWatchlistV2.module.css` `.stockIdentity p`
shares overflow:hidden / text-overflow:ellipsis / white-space:nowrap with the
ticker heading (lines 116–121 at the product base). Product not fixed in this
verification task. Actual sampled ticker/exchange strings, including KDKRW at
900px, were fully readable; screenshots and element widths were inspected.

## Preflight and actual acquisition

- Existing engine rechecked: PostgreSQL 17.6, system ID `7678429483712069671`.
  Existing foundation/current migrations applied only in the owned temporary DB.
  Temporary write/read probe committed and automatically dropped; schema, role
  and DB ownership were checked. No shared migration or data writes.
- SQL target: `sec_submissions_eeb4_2033de09f98045f78b5633489e9bd3e4`, OID 166731,
  owner postgres, marker `eeb4 submissions verification 2033de09-f980-45f7-8b56-33489e9bd3e4`.
- REST target: existing development `postgres` via local CLI-reported PostgREST
  endpoint. This is a **different database** from current SQL. Existing legacy
  service credentials were read from CLI status and passed only in memory. REST
  tickers GET returned 200 before acquisition. No new key/role/permission.
- Port 3118 was checked unused before launch. Installed Edge opened actual empty
  current `/stocks/AAPL`, actual Search stocks dialog and real search result.
  Next trace confirmed current SQL read against the owned DB **before any
  Submissions request**. Search/catalog rows and header/RSC/SQL were not replaced.
- First preflight attempt clicked before hydration; dialog wait failed. Added
  network-idle readiness in the harness. Submissions attempts in that run: **0**.
  Its DB OID 166558 was checked, closed and deleted. Second preflight passed.

Live requests used existing SEC_USER_AGENT and each CIK was attempted exactly
once, all HTTP 200. A harness guard refused duplicate CIKs and attempts above
three without changing the product HTTP retry policy. No CompanyFacts, historical
Submissions, XBRL, filing-body or LLM requests. No preserved replay or synthetic
issuer was used in the successful live-completion run.

| CIK | Actual source company | All stored current listings | Browser representatives | confirmedAt UTC |
| --- | --- | --- | --- | --- |
| 0000320193 | Apple Inc. | AAPL / Nasdaq | AAPL | 2026-10-06T16:17:24.742Z |
| 0001652044 | Alphabet Inc. | GOOGL, GOOG, GOOGM, GOOGN / Nasdaq | GOOGL, GOOG | 2026-10-06T16:17:25.157Z |
| 0001853138 | Kodiak AI, Inc. | KDK, KDKRW / Nasdaq | KDK, KDKRW | 2026-10-06T16:17:26.265Z |

Expectations came from that run's raw JSON and current read, not previous names or
listing counts. Separate SQL connection compared source ID, exact raw text/hash,
all ticker/exchange pairs, name and confirmation. firstFetchedAt was respectively
`.728Z`, `.143Z`, `.263Z` within those seconds, distinct from confirmedAt; HTML
`time[datetime]` matched the full confirmedAt, while readable UTC copy uses seconds.
No assertion that any ticker is a common share, tradable or eligible for FMP.

## Browser and read-only evidence

- Click selection at 1440/390px, keyboard Enter on actual result at 900px: all 15
  paths had exact selected ticker / URL / header / safe flow readout agreement.
  Each search response was HTTP 200. No results were patched.
- Direct entry: search unobserved. Lowercase redirect, AAPL↔GOOGL back/forward and
  reload: same current identity, no cross-company bleed. The previously reported
  independent overlapping B→C navigation test is **user-provided prior evidence**;
  not rerun here. Product route/key/DTO logic is byte-for-byte unchanged from its
  reviewed base, so this verification does not claim new overlap-test coverage.
- Company name, exact listing exchange and UTC time stayed visible while quotes,
  chart and overall market/source overview remained unavailable. No false ready
  state. At 390px confirmation copy wrapped without overlap. No horizontal overflow.
- Actual catalog MSFT, no current, no extra acquisition: no fabricated name/time.
  The clipping issue above remains; DOM-only assertions are not visual acceptance.
- Pageerrors: **0**. Browser console additionally recorded 452 expected excluded
  dependency 503 messages and **one hydration attribute warning** on the MSFT
  autocomplete input (`style=caret-color:transparent`). Installed Playwright's
  `coreBundle.js` screenshot code explicitly inserts that style while hiding
  carets. This points to screenshot/hydration timing, but a separate causal
  reproduction was not run; it is not reported as “console errors 0”.
- 195 `ERR_ABORTED` requests were all ancillary `/api/` paths; no stock document
  or ticker-search failure. All excluded paths are recorded in browser receipt.
- Before/after canonical serialized raw/issuer/name/ticker/ledger/facts/current
  state plus refresh sequence had identical SHA256
  `1c50b69b60c76be658bcb931920c3e719e75ae42a89110e1602debf6fb6345aa`.
  Sequence remained 3. Page-triggered Submissions, current confirmation updates,
  raw/observation/ledger writes: **0**. Initial permitted refresh writes are separate.
- Successful run: 23 actual current SQL reads; Next company catalog attempts 25
  plus harness catalog 1. Aborted preflight: catalog 2. **Task total catalog 28,
  Submissions 3**. Product fresh/cached policy unchanged; queries were sequential.
  Successful run traced 94 read-only REST GETs, plus one preflight REST probe.

Only exact SEC catalog GET and development REST table GET were allowed from Next;
REST RPC/mutations and other outbound requests were blocked before transmission.
Browser ancillary APIs for quote/chart/profile/logo/financials/ownership/source
filings, watchlist refresh, auth widgets, live unread, events/calendar were excluded
with 503. Thus their UI warnings are expected exclusions, not successes. Next's
npm version check was also blocked. No watchlist/alert mutation, post or sending.
No approved authenticated session was supplied for this isolated browser; no
cookie extraction, authentication bypass, new account or bootstrap write was
attempted. Logged-in detail/plan/watchlist and Live Room search remain environment
gates. They are not treated as code failures or passed checks.

## Artifacts, cleanup and checks

All receipts/captures are outside Git under `C:/Users/PC/.codex/visualizations/`:

- `sec-header-live-completion-20261007.json`: failed preflight, live attempts 0.
- `sec-header-live-completion-20261007-r2.json`: successful same-live-source run.
- Its `.artifacts/browser-live.json`, `browser-preflight.json`, `next-trace.jsonl`
  and screenshots include `live-1440-AAPL.png`, `live-900-KDKRW.png`,
  `live-390-KDKRW.png`, `no-current.png`.
- `.artifacts/acquisition.json` is the single preservation file containing exact
  raw bodies, source URLs/hashes, actual acquisition, first-fetch and confirmation
  records. Never committed, never rebuilt from a DTO. No replay occurred.

Both owned DB identities were rechecked and sessions reached zero before plain
DROP; absence verified. Owned Next/Edge/connections closed, no 3118 listener.
`next-env.d.ts` restored from original bytes, tsconfig unchanged. 3110 and other
tasks' processes were untouched. No environment-file or shared configuration edits.

Harness changes: new `--header-live` mode skips already-passed fixture suite,
preflights browser before acquisition, preserves exact sources, permits at most
two explicit browser-only retries with ten-minute deadlines in the same DB.
Successful run required no post-acquisition retry. Existing fixture modes remain.
Syntax checks (`node --check`, four changed/new harness files), actual preflight
and live run, and final diffcheck pass. No product change: 231/140/full regression
suites and SQL/HTTP failure suites were not unnecessarily rerun.

Invocation uses existing absolute server-only/TS loaders, in-memory admin DB URL
and SEC_USER_AGENT, then `verify-sec-submissions-postgres.mjs --run --header-live
--pause-header --system-id=7678429483712069671 --output=<new external receipt>`.
Do not rerun live mode without a new request allowance. Existing product base is
the verification reference; follow-up commit contains only harness/documentation.
No merge, push, deploy, shared initial load or periodic refresh. Local main was
not rechecked (last reported `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`);
GitHub main, Vercel, operational migration and cron remain unqueried.
