# SEC catalog readers — stage 2 isolated verification

2026-10-06, Asia/Seoul. Stage 2 implementation only; independent GPT review pending.

## Candidate and boundaries

- Workspace unchanged: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
- Base `0fec36e4da1a261029882ce110ce4f7b275f6f1d`, detached and clean at start.
- Stage 1 commit preserved. No branch/worktree replacement, reset, merge, push or deploy.
- User-provided investigation main ref: `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`.
  No assumption that it is the current main; unrelated EFFECT differences untouched.
- GitHub main, Vercel deployment, DB migration and cron state were not queried.
  No claim of integration/deployment equality. No stage 3 work.

## Minimal dependency structure

`tickerCatalog.ts` owns two independent in-process cache instances:

| Reader | Actual source | Stored value | HTTP policy |
|---|---|---|---|
| `readSecCompanyCatalog` | `company_tickers.json` | Ordered original `cik_str/ticker/title` rows plus successful HTTP status | Existing 15-second fetch timeout, no retry |
| `readSecExchangeCatalog` | `company_tickers_exchange.json` | Existing CIK-keyed Map of ticker/name/exchange rows | Existing `secFetch`, including its three-attempt policy |

The common module imports only env, the cache helper, secFetch and the ticker row
type. It does not import parser or integrations. Company searches do not acquire
a new dependency on the large SEC parser. There is no combined cross-source snapshot,
fallback, lookup enrichment, row merger or relabeling of provenance.

The stage-1 helper is minimally generic over the snapshot value, with
`structuredClone` replacing the Map-only copy. The state machine and its one
15-minute TTL constant are unchanged. Successful complete read/validation starts
TTL; unchanged content advances confirmation time; cache hits do not. Readers
join an existing source-specific flight, including an incomplete JSON body. On
failure the last success remains internal, but callers receive failure and the
next request retries. Maps, arrays and row objects returned to callers are isolated.

Company validation requires a nonempty object of complete rows with positive
integer `cik_str` and nonempty string ticker/title. It does not uppercase/trim the
stored rows, reorder them, deduplicate candidates, infer exchange or classify
securities. Extra row fields survive cloning. Exchange validation/normalization
was moved from parser without changing its stage-1 rules.

HTTP failures return the existing response fields (`ok/status/data/count/error`),
with the HTTP status/text and empty failure data/count. JSON/schema/transport
failures return status 0. A valid list with no query match is still
`ok=true`, empty data and the **full catalog count**. Malformed responses previously
treated loosely by the company wrapper are now explicit failures, not cached
empty/partial success. User-Agent is checked before every company read, including
warm-cache hits; its missing-setting failure remains unchanged.

## Fresh versus cached consumers

| Consumer | Policy after change |
|---|---|
| `fetchSecCompanyTickers(query, options)` | Defaults to fresh; existing exactTicker preserved; internal optional fresh added |
| Alert ticker view model `searchSecTickerCatalog` fallback | Only explicit company `fresh:false` product opt-in |
| stockHeaderSecIdentity | Default fresh; existing exact ticker/current CIK verification |
| publicTickerSearch projection issuer check | Default fresh; ambiguity and issuer mismatch remain blocking |
| probeSec | Default fresh connection recheck |
| `/api/sec/company-tickers` | Default fresh; same route/query/response shape, no new public parameter |
| `fetchTickerLookup(fresh)` | Stage-1 default TTL and explicit fresh behavior unchanged |
| Form25 identity | Existing explicit fresh call unchanged |

Local DB-first search, fallback threshold, merge, ordering, limits, asset type and
is_active filters are unchanged. Alert/Watchlist storage was not touched.
Other timedFetch users are unchanged; search has not inherited exchange retry delays.

## Executed before/after search comparison

Before product edits, invoked the existing exported `fetchSecCompanyTickers` on
61 synthetic rows through an HTTP double. Re-ran the same script after edits and
deep-compared all returned fields and rows with the saved pre-change receipt.
Both complete outputs have SHA-256:

`afd78e8622449447d62e631ed60c449564e2388b15e2e0ca24e048775928575f`

| Query | Exact? | Returned before / after | Full count |
|---|---|---|---|
| empty | no | 50 / 50 | 61 |
| ` syn.a ` | no | 1 / 1 | 61 |
| `sYn` | no | 4 / 4 | 61 |
| `bLuE` | no | 3 / 3 | 61 |
| `SYN.A` | yes | 1 / 1 | 61 |
| `SYN` | yes | 0 / 0 | 61 |
| `not-found` | no | 0 / 0 | 61 |
| `FILL` (57 matches) | no | 50 / 50 | 61 |

Both runs made 8 HTTP calls because default fresh is preserved. First row sequence
remains `syn.a, BETA, SYNX, SYN.B`; first/fourth share a CIK. Lowercase ticker and
spaces in original title remain unchanged. No CIK grouping/reflattening occurs.
Local pre-change receipt: `C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json`.
It contains only synthetic results, no real SEC source/credentials, and is not committed.

## Executed behavior evidence

| Check | Observed result |
|---|---|
| Cold concurrent company searches | 3 queries, 1 full HTTP download; each gets its own filtered result |
| Completion clock / TTL | JSON completes at fake t=9000; cached hit at +899999; +900000 refreshes; identical refresh restarts TTL |
| Fresh + cached concurrency | Cached request waits for fresh body; both receive updated CIK; next cached read needs 0 HTTP |
| Defensive copy | Mutating wrapper arrays/rows and direct reader rows cannot change next search |
| Source mismatch | Company order SYN/BETA/SYN.B and titles retained; exchange ONLYX/XSYN and different names retained; absent rows not borrowed |
| Independent failures | Company 503 uses 1 attempt, exchange cache still works with 0 HTTP; exchange 503 uses 3 attempts, company cache still works with 0 HTTP |
| 7 malformed/network cases | Each fails once; next cached-mode request performs 1 successful recovery; valid no-match remains ok=true/count=3 |
| Missing SEC_USER_AGENT | Warm-cache wrapper/direct-reader calls fail before HTTP; restoring test setting allows valid cached read |
| Company timeout | Fake timer: still pending at 14999ms, fails at 15000ms; exactly 1 attempt |
| Stock header actual function | Warm search CIK 1000011; HTTP changed to 2000011; 1 fresh HTTP, all 3 memory repository reads scoped to 0002000011 |
| Historical projection actual function | Same warm-cache scenario; 1 fresh HTTP rejects old issuer with projection_current_issuer_not_confirmed |
| Duplicate/conflicting candidates | Equal duplicates and competing CIKs remain in source data; both identity consumers fail closed |
| probeSec | Warm cache + HTTP 503 => ok=false/status=503 after 1 fresh HTTP, not false healthy |
| Company API GET function | Warm cache then CIK change; default GET makes 1 fresh HTTP and returns updated CIK |
| Actual exploratory fallback | Alpha/Beta queries share 1 company HTTP; complete local result adds 0 SEC HTTP; 6 fake repository GET responses, no DB |
| Stage-1 exported repro | OLD → fresh NEW → ordinary NEW; 2 refreshes / 2 HTTP attempts |

All new identities/company names are synthetic. Identity dependencies use existing
in-memory injection points without replacing their actual SEC reader. The exploratory
search has no repository injection argument; its existing HTTP transport is replaced
with an in-memory repository response at `memory-repository.example.test`, with
all unexpected requests blocked. No real DB/network/provider request is delegated.
The company API is invoked in-process without starting a server.

## Verification commands

From this candidate root:

```powershell
node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/verify-sec-company-search-contract.mjs --compare=C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json

node --no-warnings --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/reproduce-sec-catalog-fresh.mjs

node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/sources/sec/tickerCatalog.test.mjs lib/sources/sec/tickerCatalogCache.test.ts lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts lib/sources/sec/forms/ownership/source-parser.test.ts lib/watchlist/stockHeaderSecIdentity.test.ts lib/sec-ticker-resolution/publicTickerSearch.test.ts lib/tickerSearchContract.test.ts

npm run typecheck
git diff --check
git diff --cached --check
```

71/71 tests PASS, including all original 46. Stage-1 test assertions remain intact;
only its generic helper result type annotation changed. Typecheck and diffcheck PASS.
Before recording the baseline, used the comparison script with
`--write=C:/Users/PC/.codex/visualizations/sec-catalog-stage2-search-before.json`.

Initial test-only corrections: Node required explicit `next/server.js` resolution
to execute the unchanged API route; one synthetic query was corrected from SYN
(also matches every title's “Synthetic”) to Alpha. Product filtering was not changed
to satisfy that expectation. No prior verification was weakened.

## Files / remaining scope

Product: `tickerCatalog.ts`, `tickerCatalogCache.ts`, parser catalog wrapper,
integrations company wrapper, one explicit search fallback opt-in.
Support: `tickerCatalog.test.mjs`, helper test type annotation, before/after script,
this review. Stage-1 commits and earlier S-4 experiments preserved.

Unconverted by design: secFilingAnalysisPreview's SC13 catalog path and standalone
catalog DB synchronization script. This is not project-wide catalog unification.
No Submissions/CompanyFacts, FMP eligibility, security classification, ticker
succession, Primary, MCP/Monitor/Human-review or persistence change.

Unverified: rendered UI/account/viewport journeys, live SEC response shapes/load,
multi-process behavior and production deployment. The guarantee is per process
and per source. No real SEC/Gemini/DB, environment-file, Docker or 3110 operation.
Stop here for independent GPT review; no stage 3 or integration.
