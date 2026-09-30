# SEC CUSIP mapping micro-backfill — 2026 Q2 pilot

This is a bounded validation, not a market-wide backfill or 13F holding ingestion. It used 11 active, non-option CUSIPs from the stored SEC 2026 Q2 Official List (snapshot id `2`, source SHA-256 `42e524a7d6901bdba97d517441452453b3630466f614a6fe9d9b282b200e0849`) in the existing local Postgres database on `127.0.0.1:56322`. No schema, mapping rule, stock-page, FMP, model, or Monitor change was made.

The repeatable bounded runner is [`scripts/verify-sec-security-identifier-micro-backfill-local.ts`](../scripts/verify-sec-security-identifier-micro-backfill-local.ts). It checks the Official List rows, fetches fixed SEC accessions with `fetchSecEdgarRawItems`, saves successful raw items with `saveSecRawItem`, uses the existing canonical SC13/cover persistence RPCs, reads both back through their validating readers, fetches the current SEC ticker catalog, and calls the existing strict resolver. It does not run the full SEC analysis job, a 13F holding job, or alerts. The resolver's mapping status is **computed from stored source evidence**; there is no persisted mapping-status table in this pilot.

| CUSIP | Pilot result | Relevant stored SC13 accession(s) / reason |
| --- | --- | --- |
| `00857U206` AGL | trusted | `0001167557-26-000123`; issuer cover `0001628280-26-053355` |
| `049560105` ATO | trusted | `0000902219-26-000262`; issuer cover `0000731802-26-000102` |
| `30050B101` EVH Class A | trusted | `0000895421-26-000280`; issuer cover `0001628908-26-000086` |
| `70614W100` PTON | conflict | `0000912282-26-001063` says Class A Common Stock; `0000102909-26-002038` says Common Stock |
| `457030104` IMKTA | conflict | `0000052388-26-000276` says Class A Common Stock; `0002100119-26-001396` says Common Stock |
| `38149W382` GS ETF | unmapped | `0001085146-26-000765`; the existing class key does not accept ETF beneficial-interest shares |
| `G3662E121` Founder | unmapped | `0002088488-26-000030`; the existing class key does not accept “Class A shares” |
| `023576101` Amerant | unmapped | `0002100119-26-001325`; no validated same-class ticker cover observation collected |
| `87969B101` Telos | unmapped | `0002012383-26-003106`; no validated same-class ticker cover observation collected |
| `59356Q108` Miami Intl | unmapped | `0001897612-26-000622`; no validated same-class ticker cover observation collected |
| `037833100` AAPL | unmapped | `0000932471-25-000778` was fetched but its XML lacks required `schemaVersion`; canonical parsing rejected it, so no raw/canonical row was written |

The “conflict” examples are **different title specificity for the same reported CUSIP**, which the current strict class-key policy treats as competing class claims. The pilot does not prove the underlying security is economically different. It intentionally did not choose a preferred title. The Official List issuer description was never used to infer CIK or ticker.

First pass: source run `ae0f7ff2-28f1-4cd2-ba17-f6193e7d8c89`; [full evidence JSON](</C:/Users/PC/.codex/visualizations/2026/09/30/sec-cusip-micro-backfill/ae0f7ff2-28f1-4cd2-ba17-f6193e7d8c89.json>) (SHA-256 `c8919d004b4d008d4650ee77bb7f1882dd19851a6977cca96b58e7b06980211b`). Second identical pass: source run `0db5d000-c0bb-452b-bd51-f0fd565263c9`; [replay evidence JSON](</C:/Users/PC/.codex/visualizations/2026/09/30/sec-cusip-micro-backfill/0db5d000-c0bb-452b-bd51-f0fd565263c9.json>) (SHA-256 `bb086f26ec8896a54379a8ab5eda421ba5007a61d45b3f98782507bd79e5de6c`). Each JSON records accession, SEC URL, source hash, parser result, raw-item ID, canonical readback, mapping reason, and the SEC ticker-catalog hash/time. The second pass retained every raw-item ID, returned `replayed` for all 12 canonical SC13 filings and three new cover observations, kept the same mapping results, and found one raw row per successful accession. Existing two unrelated cover rows were left in place.

To resume later, first verify the database and Official List snapshot explicitly; run the fixed pilot only with an authorized local test database and `.env.local` pointing to its existing Supabase API. The runner rejects any DB target other than `127.0.0.1:56322` and uses API loopback `56321` in-process. Command: `node --env-file=.env.local --no-warnings --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/verify-sec-security-identifier-micro-backfill-local.ts`. The current catalog must be fetched afresh: the trusted result is time-dependent. The focused offline regression is `node --test --experimental-strip-types lib/sec-security-identifiers/mapping.test.ts`.

The next full-backfill task starts **after** this pilot: design a bounded, systematic SEC accession-discovery queue for SC13 issuer-security evidence and cover observations, then measure coverage with unresolved holdings allowed. It must preserve the present no-name-only/no-CIK-only rule and conflict behavior. The AAPL XML incompatibility and unavailable or unsupported class evidence are known limitations, not reasons to force a match. No 13F holdings, institutional UI, or FMP replacement was tested here.

Handoff state at pilot start: local `main` `423f8f3c0fa92765f1c2759e202ada27ad8eff27`; GitHub `main` `9c13aee7ef41b38bac0637e53e579633745effda`; deployed Vercel commit/status unverified, so no code-equality or deployment claim. Pre-existing unrelated working-tree changes were present in `app/stocks/[ticker]/page.tsx`, `components/watchlist-v2/StockRadarWatchlistV2.tsx`, `lib/integrations.ts`, `next-env.d.ts`, and two `lib/watchlist/stockHeaderSecIdentity*` files; this task did not modify them. No migration was made. Remote DB migration status and cron state were not checked; no push or deployment was authorized.
