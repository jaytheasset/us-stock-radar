# SEC ticker catalog cache — stage 1 verification

Date: 2026-10-06 (Asia/Seoul). Implementation and isolated verification only.
Independent GPT review remains a separate user step; no integration authorized.

## Workspace and scope

- Existing attached workspace: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`.
- Start/base HEAD: `2089d0bc1674b1919fc8f0e386045a5caaf035de`, detached, clean.
- No new worktree/chat, branch switch, repoint, reset, merge, push or deployment.
- Compared `parser.ts` with investigation ref `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`.
  Cache functions and direct callers were unchanged. That ref has EFFECT source
  capture additions absent in this candidate. Those unrelated differences were
  preserved, not restored or imported. The investigation ref is not our base HEAD.
- Production changes: `parser.ts` and the small `tickerCatalogCache.ts` helper.
  Three new test/reproduction files and this review record support the change.

## Actual pre-fix reproduction

Before modifying `parser.ts` or creating the cache helper, ran the existing
exported `fetchTickerLookup()` against an in-memory HTTP double and fake `Date.now`.
Company `Synthetic Cache Company`, ticker `OLD`/`NEW` and CIK `1234567` are synthetic.

```text
first=OLD, cached=OLD, fresh=NEW, after=OLD
refreshes=2, HTTP attempts=2, real network calls=0
```

The command used on the unmodified task-base parser was:

```powershell
node --no-warnings --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/reproduce-sec-catalog-fresh.mjs --expect=OLD
```

The same script after the fix (omit `--expect=OLD`) returns:

```text
first=OLD, cached=OLD, fresh=NEW, after=NEW
refreshes=2, HTTP attempts=2, real network calls=0
```

This was an executed before/after comparison, not copied from a previous investigation.
To replay the old expectation independently, use this small reproduction script
against the base revision in a separately authorized review environment; do not
reset or change this candidate's connection.

## Cache contract

- The one TTL constant is `SEC_TICKER_CATALOG_TTL_MS = 15 * 60 * 1000`.
  It is a product policy, not an SEC update-frequency guarantee.
- TTL starts after successful complete JSON read/validation. Identical valid
  content still advances the successful-check timestamp.
- `fresh=true` bypasses TTL. Both normal and fresh requests join an existing
  in-flight refresh, including while response body parsing is still pending.
- Only one refresh can run per cache instance/process, so competing old/new
  refreshes cannot race to overwrite one another. No distributed guarantee.
- Invalid JSON, non-OK HTTP, transport errors/timeouts, missing/duplicate fields,
  empty catalog, malformed rows or a mixture of valid and malformed rows reject.
  No partial/empty success is committed. Known required fields must exist;
  reordered fields and string/numeric CIK representations still work. Null
  name/exchange are permitted. No new security classification/ticker selection
  filter was added; existing normalization and row ordering remain.
- On failure, last successful snapshot and timestamp are retained internally.
  They are **not** returned as a successful response to that request. The failed
  flight clears, and the next normal request retries, even after a failed forced
  refresh within the old TTL. No stale-on-error return or cached rejected promise.
- Every caller gets a copied Map, copied arrays and copied scalar row objects.
  Loader-owned objects also cannot mutate the internal snapshot after success.
- No new raw files, DB snapshots, disk cache, cache server, environment variable,
  setting, dependency or HTTP retry policy.

## Direct callers and compatibility

`fetchTickerLookup(fresh?: boolean)` still returns `Promise<Map<CIK, rows>>` on
success. Ordinary failures now reject rather than returning a permanently cached
empty Map. All direct production callers were checked:

1. `fetchSecEdgarRawItems()` catches only catalog acquisition failure and continues
   SEC document collection with an explicitly unavailable, local empty lookup.
   `diagnostics.tickerCatalog` records available/unavailable. This local placeholder
   is never committed to the catalog cache. Unresolved reason cannot describe the
   outage as a confirmed absence. Form 25 gets the explicit availability flag.
2. `ensureSecForm25Identity()` already calls `fetchTickerLookup(true)` and catches
   catalog failure into `sec_catalog_unavailable`. No changes to its code, Cover,
   Human review or downstream identity semantics were needed.

Existing source-backed issuer symbols and verified FMP/CUSIP behavior are untouched.
The fallback/selection functions were not changed and no current symbol is invented
because of a catalog outage. The synthetic 8-K outage yields ticker=null while its
original body is fully retained. Valid-catalog no-match remains a separate result.

## Executed scenario results

| Scenario | Actual returned values/state | Refresh / HTTP counts |
|---|---|---|
| Before/after exported reproduction | Before OLD→fresh NEW→OLD; after OLD→fresh NEW→NEW | Each 2 / 2 |
| Initial exported failure/recovery | HTTP 404 rejection; next ordinary read OLD; next cached OLD | 2 / 2, cache hit adds 0 |
| TTL | At 899,999ms existing value; at 900,000ms refresh; later NEW→LATER | One refresh per expiry; cache hit adds 0 |
| Equal content | NEW→NEW successful refresh; next expiry measured from this success | Timestamp advances; next within-TTL read adds 0 |
| Same-content helper clock | lastSuccessAt 0→900000→900100, value NEW | 3 refreshes; at 1800000 still cache hit |
| Overlapping exported fresh/normal/fresh | All wait for complete JSON and return LATEST | 1 / 1 for 3 callers |
| Normal-first and fresh-first helper races | First group all OLD; next group all NEW; completion time=30 | 2 loads total for 6 callers |
| Coalesced 503 failure | All 3 waiters reject; normal retry RECOVERED | Failed group 1 / 3; recovery 1 / 1 |
| Expired timeout | TimeoutError; next ordinary request AFTERTIMEOUT | Failed refresh 1 / 3; recovery 1 / 1 |
| Failed forced refresh during TTL | Last success timestamp stays 10; ordinary request retries, not stale hit; later success at 30 | Failure/recovery sequence 7 helper loads including initial and expired failures |
| Malformed payloads (8) | Each rejects; next ordinary request returns VALID; no partial catalog | Each failure 1 / 1 + recovery 1 / 1 |
| Missing CIK/ticker in valid catalog | `undefined`; whole HTTP 404 catalog instead rejects | Valid lookup adds 0 HTTP |
| Caller mutation | Mutated/cleared Map, appended array entry, changed row/loader object cannot change next LATEST/GOOD | No repair/refetch needed |
| Synthetic 8-K collection | Outage: ok=true, body retained, ticker=null, unavailable. Recovery: same body, RESTORED, available | 2 / 2 catalog calls |
| Synthetic Form25 collection | Valid catalog missing subject → subject_not_in_sec_catalog; outage → sec_catalog_unavailable; both retain body | Actual parser→identity connection, no DB |
| Real Form25 fresh caller, synthetic inputs | FORMNEW updates normal cache; failed fresh → UNRESOLVED/sec_catalog_unavailable; ordinary retry FORMRECOVERED | 3 / 3 after initial seed; cached normal read adds 0 |

Form25 persistence entry point used its existing injected in-memory repository
seam (16 fake operations); no actual DB reads/writes. Existing archived Form25
source-connection regression also replays local bytes through an HTTP double.
Its test titles say “real SEC acquisition” but this run made no live SEC requests.

## Commands and regression coverage

Run from the candidate root. Absolute loader URLs avoid an existing Node worker
resolution issue with relative loader/preload paths in this Windows worktree.
The existing server-only preload is reused; no dependency was installed.

```powershell
node --no-warnings --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types scripts/reproduce-sec-catalog-fresh.mjs

node --no-warnings --import 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-server-only.mjs' --experimental-loader 'file:///C:/Users/PC/.codex/worktrees/eeb4/US-Stock%20Radar/scripts/resolve-ts-paths.mjs' --test --experimental-strip-types lib/sources/sec/tickerCatalogCache.test.ts lib/sources/sec/parser.catalog.test.mjs lib/sources/sec/parser.fetch.test.ts lib/sources/sec/sourceTickerSelection.test.ts lib/sec-form25-identity/canonical.test.ts lib/sec-form25-identity/manualCandidate.test.ts lib/sources/sec/forms/form25/sourceConnection.test.ts lib/sources/sec/forms/ownership/source-parser.test.ts

npm run typecheck
git diff --check
git diff --cached --check
```

Result: 46/46 tests PASS, including real exported-function connections, cache
state-machine safeguards, existing SEC timeout/429/503 retry behavior, 40-F source
collection, Form25 archived original preservation and identity/manual-review
rules, source ticker choice and ownership parser fixtures. Typecheck/diffcheck PASS.
The first test harness attempts failed before test execution due to relative loader
resolution and missing standalone `server-only`; final commands above correct that.
A fake repository initially used the wrong human-decisions table name; correcting
that test fixture made the existing Form25 caller pass without product changes.

## Limits and stop

- Process-local, volatile cache only; independent server processes refresh separately.
- Live SEC catalog shape, real network latency and production load were not tested.
  Schema rejection deliberately fails closed; an upstream shape change is surfaced
  as unavailable, not an empty successful list.
- The existing SEC HTTP layer still owns its three-attempt/30-second timeout policy.
  A slow refresh can therefore delay readers/collection within those existing bounds.
- No DB/server/Docker operation, Gemini/Primary call, FMP call, Monitor/MCP/Watchlist
  change or S-4 experiment import. No common-reader integration into integrations.ts,
  catalog source replacement, Submissions/CompanyFacts or phase 2 work.
- This is stage 1 only. Independent structure/diff/reproduction review is pending;
  no assertion of merged/deployed production status.
