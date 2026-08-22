# Live Multi-Class O/S Production Path V1

## Scope and source contract

This validation used only the existing shared local Supabase data for issuer
CIK `0001652044`. The cache contained 13 complete filing-XBRL packages and 26
CompanyFacts candidates. The validation injected a cached structured-data
result and a filing source that throws if called. Observed SEC requests were
zero; LLM calls were zero.

The confirmed production gap was a sequence of fail-closed gates rather than
missing filing data:

1. Alphabet CompanyFacts exposes US-GAAP
   `CommonStockSharesOutstanding`, not DEI
   `EntityCommonStockSharesOutstanding`.
2. The filing parser already returned the same-date aggregate and Class A/B/C
   facts with exact contexts and QNames, but the authoritative resolver applied
   its non-DEI gate before classifying the aggregate-plus-class shape.
3. The universe gate then rejected non-DEI candidates and required both member
   and axis namespaces to be US-GAAP, excluding an otherwise source-backed
   custom Class C member.
4. History accepted only direct `ELIGIBLE` decisions, so a complete multi-class
   universe had no safe class-observation persistence path.
5. Existing V1 gap snapshots are append-only and required version precedence,
   not mutation, for a corrected source result.

The implementation classifies the filing shape first, admits a source-backed
US-GAAP common-stock aggregate to Universe V2, derives custom identity from the
exact member namespace URI plus local name, and persists class facts only after
one filing proves a complete exact-sum universe. No ticker, accession, issuer,
title, synonym, or sample is present in production decision code.

## Actual filing evidence

### 2026-03-31

- Accession: `0001652044-26-000048`
- Accepted: `2026-04-30T01:02:11.000Z`
- Primary IXDS: `goog-20260331.htm`
- Aggregate support: `12,116,000,000`, context `c-24`, US-GAAP
  `CommonStockSharesOutstanding`
- Class A: `5,824,000,000`, context `c-26`, axis
  `{http://fasb.org/us-gaap/2025}StatementClassOfStockAxis`, member
  `{http://fasb.org/us-gaap/2025}CommonClassAMember`, canonical ID
  `sc:v1:0001652044:common_stock:us-gaap:CommonClassAMember`
- Class B: `836,000,000`, context `c-27`, member
  `{http://fasb.org/us-gaap/2025}CommonClassBMember`, canonical ID
  `sc:v1:0001652044:common_stock:us-gaap:CommonClassBMember`
- Class C: `5,456,000,000`, context `c-30`, member
  `{http://www.google.com/20260331}CapitalClassCMember`, canonical ID
  `sc:v1:0001652044:common_stock:custom:44aa00224c6654d93243204f37e2c6a36b6096e32d4ae0ba838582a5c385c715:CapitalClassCMember`
- Universe: `COMPLETE_MULTI`; resolved issuer total: `12,116,000,000`

### 2026-06-30

- Accession: `0001652044-26-000071`
- Accepted: `2026-07-23T01:15:54.000Z`
- Primary IXDS: `goog-20260630.htm`
- Aggregate support: `12,230,000,000`, context `c-32`, US-GAAP
  `CommonStockSharesOutstanding`
- Class A: `5,868,000,000`, context `c-35`, member
  `{http://fasb.org/us-gaap/2026}CommonClassAMember`, canonical ID
  `sc:v1:0001652044:common_stock:us-gaap:CommonClassAMember`
- Class B: `835,000,000`, context `c-36`, member
  `{http://fasb.org/us-gaap/2026}CommonClassBMember`, canonical ID
  `sc:v1:0001652044:common_stock:us-gaap:CommonClassBMember`
- Class C: `5,527,000,000`, context `c-39`, member
  `{http://fasb.org/us-gaap/2026}CommonClassCMember`, canonical ID
  `sc:v1:0001652044:common_stock:us-gaap:CommonClassCMember`
- Universe: `COMPLETE_MULTI`; resolved issuer total: `12,230,000,000`

For both filings the three class values equal the aggregate exactly. The
aggregate is recorded as corroboration only and is absent from Share Count
History. Class B is included solely because the filing supplies a common-stock
concept, the exact standard class axis/member, an instant context, and shares
unit; exchange/ticker presence is not consulted.

## Collector and replay result

- First run: 26 candidates, 13 required filings, 13 cache hits, 0 filing
  fetches, 26 V2 universe inserts, 78 class-observation inserts, 0 incomplete,
  0 ambiguous.
- Exact replay: 26 universe duplicates, 78 history duplicates, 0 universe
  inserts, 0 history inserts, 13 cache hits, 0 filing fetches.
- Retained local GOOG state: 26 V1 diagnostic snapshots, 26 V2 corrected
  snapshots, and 78 class observations.
- One millisecond before the latest filing acceptance, the reader still
  selected accession `0001652044-26-000048` / as-of `2026-03-31`.
- `WRONG_CONFIDENT_ISSUER_TOTAL = 0`; partial issuer totals remained forbidden.

The live command is
`npm run verify:live-multi-class-os-production-path:local`.

## Verification and preserved boundaries

Passed:

- cached Alphabet production collection, reader, class resolver, issuer total,
  no-lookahead, and two deterministic replay runs;
- the isolated five-issuer production collector transaction, including AAPL
  `COMPLETE_SINGLE`, Alphabet `COMPLETE_MULTI`, foreign/ADS ambiguity, and
  incomplete primary IXDS;
- SEC structured data, candidate extraction, filing XBRL, authoritative O/S,
  History, Level 2 input, class resolver, Universe, Collector, and Issuer Total
  unit/regression suites;
- forward/reverse execution, stock-split normalizer, and anchor reconciliation
  suites, preserving the locked NVDA forward-split behavior;
- Monitor foundation/fanout, Alert, and Offering regressions;
- four relevant pgTAP files, 148/148 tests;
- local database lint at error level;
- TypeScript, strict workflow validation, and the Next.js production build;
- secret, issuer-specific production hardcode, direct O/S-to-AI, sensitive-file,
  diff, and oversized-change scans, all with zero findings.

The shared local database ended with AAPL history `20`, NVDA history `18`,
Alphabet complete-multi history `78`, Alphabet V2 universe snapshots `26`, and
fixture history `0`. The permanent main review server remained PID `38624` on
port 3110 and `/api/health` returned 200. No full O/S validation, dilution,
potential-shares flow, backfill, scheduler, UI, production database, remote
GitHub/Supabase/Vercel, push, deployment, or port-3110 restart was performed.
