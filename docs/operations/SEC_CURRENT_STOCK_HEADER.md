# Current Submissions → stock header candidate

Base: `357a70b15cd49763bbd848ac9568f70367a1f043`, detached eeb4.
Date: 2026-10-07 Asia/Seoul. **Not a completed real-sample browser acceptance.**

## Product change

The existing normalized route and issuer-validated historical projection still
choose the displayed ticker. `readStockHeaderSecIdentity` now performs an explicit
fresh/exact company-catalog lookup, requires one candidate CIK, calls the official
current SQL reader, checks the returned CIK and one exact ticker/listing pair.
Its allowlisted DTO contains ticker/status and, only when available, company name,
exchange and confirmedAt. Raw, payload, source IDs, SQL errors and DB configuration
are not client props. Catalog absence / no current / missing listing is unconfirmed;
catalog ambiguity, mismatched CIK, duplicate listing or reader failure is unavailable.

Removed **from this header path only**: raw fetched_at sorting, historical observation
selection, canonical exchange fallback, search-result/profile company-name fallback.
Canonical exchange/Cover/Human review remain intact for their other callers.
No new parser, facts, source/current table or migration.

Stock mode displays company state independently of overview/quote availability.
The timestamp is confirmedAt, formatted with explicit UTC, not raw firstFetchedAt
or render time. Valid company information stays visible with QUOTE UNAVAILABLE;
overview/chart/financial/listing state is not promoted to ready. Small screens now
retain the stock-mode quote state. Ordinary Watchlist behavior/layout is unchanged.
Ticker-bound presentation refuses a previous ticker's DTO; the stock page keys the
client subtree by requested/current ticker to reset route-bound state. Ticker-flow
adds a separate company-identity state and labels its existing overview judgment
as market/source data. Direct URL reads do not create search history.

`stockHeaderCurrentReader` uses a separate lazy max:1 pool via the existing server
Postgres factory, so it does not queue behind a refresh transaction. Acquisition /
connect timeout 5000ms, actual server statement_timeout 5000ms, transport watchdog
5500ms, default_transaction_read_only=on. SQL errors destroy the acquired connection;
successful reads release it. The watchdog is not a Promise.race with live abandoned
SQL. Idle connection errors are handled after pg removes the failed client. Missing
configuration, table or connectivity becomes unavailable. Common pool defaults and
other transaction timeouts are unchanged. This bound is **not** a whole-page SLA.

The page uses the existing read-only auth identity helper (no page-local bootstrap).
Other shared authenticated layout/bootstrap behavior was not changed or certified.
This task's browser sessions were logged out. No public refresh API, GET refresh,
sequence allocation or raw/current writes were added.

## Actual real HTTP → refresh → DB → header adapter

Three real main Submissions requests, using the configured SEC_USER_AGENT, completed:

| Issuer | Current listings accepted by fresh exact catalog + adapter | confirmedAt UTC |
| --- | --- | --- |
| Apple | AAPL / Nasdaq / Apple Inc. | 2026-10-06 15:15:12.462 |
| Alphabet | GOOGL, GOOG, GOOGM, GOOGN / Nasdaq / Alphabet Inc. | 2026-10-06 15:15:12.679 |
| Kodiak | KDK, KDKRW / Nasdaq / Kodiak AI, Inc. | 2026-10-06 15:15:12.901 |

Names/listings came from the actual response, not expected-value constants. Raw,
observations and current committed; an independent SQL connection and header adapter
read them successfully. No CompanyFacts/history/XBRL/LLM requests. The same run also
passed actual acquisition/SQL limits and synthetic ABA through the header adapter.

**Verification mistake and remaining gate:** before starting Next, the harness
incorrectly assumed the existing configured REST hostname was loopback (it was a
private LAN address). This assertion stopped the run and the owned DB cleanup
deleted it. The three acquired bodies were memory-only and are not retained. Thus
these real samples did **not** reach Next/browser. No repeat Submissions requests
were made. Permission for exactly three additional requests was requested; it had
not been received when this candidate was recorded. Do not call this full E2E PASS.

Receipt: `C:/Users/PC/.codex/visualizations/sec-current-header-20261007.json`.
Owned DB OID 165862 was deleted with connections 0. No actual raw response was
reconstructed from its DTO or fabricated for the subsequent browser test.

## Actual DB → Next → Edge with preserved/synthetic fixtures

To finish authorized work without repeating the real requests, a **separate**
fixture environment ran the actual refresh/storage/current reader/Next/UI path:
preserved minimal AAPL fixture plus explicitly synthetic SYNHDA/SYNHDB (different
listing exchanges), and an empty-listing synthetic SYNHDR. These are not reported
as live SEC confirmations. Synthetic catalog entries were added only by a process
verification guard; real catalog rows were unchanged. No SQL/header response mocks.

Environment was intentionally mixed:

- Current SQL: only the owned temporary database on the verified local PG17.6
  engine, system ID `7678429483712069671`, host 127.0.0.1:56322.
- Search/projection REST: existing development PostgREST 127.0.0.1:56321, separate
  `postgres` database. Existing environment-file key failed tickers SELECT (401);
  the local CLI's already-configured legacy service key succeeded (200). Only
  that key was passed to Next in memory. No environment/role/PostgREST changes.
- Before SEC acquisition, the corrected harness now probes REST using those
  credentials. All server HTTP other than exact company catalog GET or allowed
  development REST GET is blocked **before transmission**. RPC/mutations blocked.
- Browser ancillary APIs (logo, market/profile/chart, watchlist re-read, auth
  widgets, live unread, source filings, financials, alerts/calendar etc.) return
  an explicitly excluded 503 at the browser boundary. This avoids existing cache
  writes and sending. Search API, stock route, RSC current reads are actual.
  These excluded dependencies explain the watchlist/security/market warnings in
  screenshots; their success is not claimed. No logged-in session or action.
- Candidate Next on 3118, installed Edge via existing Playwright. No 3110 or
  existing 3117 process operations. Process SQL guard verifies the temporary DB
  target and allows read statements only; actual DB identity/read-back is retained.

Results:

- Search stocks → actual search GET/result → stock route at **1440, 900, 390px**:
  3 fixture tickers × 3 widths = 9 passes. Names, per-ticker exchanges, confirmedAt
  match SQL DTOs; quote unavailable remains separate; no horizontal overflow.
- Direct entry (unobserved search), lowercase redirect, cross-company navigation,
  back/forward: pass. Unit tests additionally reject mismatched/stale ticker DTOs.
- Real catalog MSFT with no current and synthetic empty/no-matching listing:
  unconfirmed, no fabricated name/time or loading loop.
- Actual current table temporarily renamed in the owned DB: Next SQL read fails,
  UI shows temporary unavailable without old company/time. Restore then read passes.
- 16 normal browser assertions + failure + recovery = **18 passes**. Page errors 0.
  DOM and screenshots at all three widths inspected. No claim that blocked
  ancillary requests succeeded. No logged-in Live Room acceptance.
- Before/after complete raw/observation/current snapshots and refresh sequence
  are identical across repeated GET/search/navigation. Submissions HTTP after
  initial setup **0**; current SQL reads recorded **25**, REST GETs **92** (includes
  earlier browser test-selector attempts). No SQL/header response substitution.
- Synthetic A→B→A: raw count 2, last A and latest confirmedAt chosen by the actual
  adapter. Boundary is SQL→adapter, not live issuer ABA or browser ABA.
- Actual pool acquisition queue: **5014.6ms**; actual SQL lock cancellation:
  **5005.7ms**; connection refusal **2.4ms**; missing config unavailable. Recovery
  succeeds, pools ended. Allowed elapsed tolerance 4800–7000ms for 5s cases.

Receipts outside Git:
`sec-header-fixture-browser-20261007.json` and its `.artifacts/` directory under
`C:/Users/PC/.codex/visualizations/`. Browser reports contain DOM readouts, actual
search responses' status, excluded-request paths and screenshots. Earlier fixture
smoke receipt is `sec-header-smoke-20261007.json`; its cleanup supplement records
natural pooled-session teardown followed by verified deletion.

## Regressions, resources and rollout boundary

- Structured/O/S/HTTP **231/231** retained (archive-only header expectation updated).
- Search/identity **140/140**: prior 138 + SQL adapter lifecycle and independent
  company/overview state tests. Fresh catalog/CIK ambiguity checks retained.
- Additional stockOverview/projection/canonical/cache tests **44/44** (overlaps
  prior suite; do not sum as unique cases). Existing canonical helper unchanged.
- Existing actual current PostgreSQL **21 checks**, raw conflict and guard tests pass.
- Native catalog body/header/drip/invalid/broken/complete timeout **6/6**; product
  abort ~15s, resources closed. Typecheck and diffcheck pass.
- Full commands use the existing absolute TS/server-only loaders. See the prior
  `SEC_SUBMISSIONS_CURRENT_VERIFICATION.md` command list. New reproducible mode:
  `verify-sec-submissions-postgres.mjs --run --header-only --system-id=<verified>
  --output=<new receipt>`; `--header-smoke` uses fixtures only. `--pause-header`
  keeps the same owned DB after a browser assertion for explicit harness retry;
  it never re-fetches Submissions. Credentials stay process-only.
- Final owned DB `sec_submissions_eeb4_8706805079ee4ff8b816704675d425fb`, OID 166212,
  owner postgres, marker `eeb4 submissions verification 87068050-79ee-4ff8-b816-704675d425fb`:
  identity + sessions 0 checked, plain DROP, absence verified. All own browser/
  Next/DB resources closed. Earlier OIDs 165862 and 166042 also deleted; the latter
  needed a second metadata check after a short natural session-close delay, no
  forced backend termination. `next-env.d.ts` restored byte-for-byte; no other
  generated file changes retained.

Deployment is **not authorized or performed**. Future approved order: ensure
foundation/current migration on the intended DB; configure and verify the SQL
target independently of REST; explicitly refresh a bounded initial issuer set;
verify current read-back; only then release the header-reader switch. Missing
issuers stay unconfirmed until an explicit refresh; no automatic backfill.

Remaining: same real samples through actual Next/browser, real rapid overlapping
SPA transition stress, authenticated flows, production DB/config/migrations and
rollout. Local main/GitHub/Vercel/cron were not rechecked. No merge/push/deploy.
