# Live Stock Split Production Path V1

## Verdict

`LIVE STOCK SPLIT PRODUCTION PATH V1 — MERGE READY`

This audit used only local Supabase and the isolated worktree server on port
3111. It did not write to production, access remote Supabase, restart port
3110, delete the existing live-validation dataset, or start GOOG/full O/S,
Dilution, backfill, scheduler, UI, push, or deploy work.

## Root cause and gap classification

The original missing NVDA execution was not an O/S Collector defect. The exact
NVDA 8-K accession `0001045810-24-000113` already existed in
`sec_filing_ledger`, but the prior validation harness had not run its exact SEC
raw ingest, Primary analysis, Router, or Corporate Action child. Running that
path also exposed production gaps:

1. Primary could describe an explicit current stock split while returning an
   empty `monitor_routes` array.
2. The Corporate Action provider schema required only `applicable`; an
   applicable response could omit calculation fields. Required source refs
   were not constrained to the supplied document refs, the output budget was
   too small, and provider JSON parse failure was checked with the weaker HTTP
   flag instead of the structured runner result.
3. Calculation-complete canonical facts could persist with root evidence that
   had canonicalized to unavailable, after which the execution reader silently
   omitted them.
4. Historical hindsight used the end-anchor timestamp both as the share-basis
   target and as the persistence knowledge cutoff. A valid historical action
   materialized during replay was therefore invisible.

Classification: **both harness and product wiring/contract gaps**. The fix
keeps the existing ownership boundary: SEC O/S Collector owns O/S history,
Corporate Action owns split execution, and Resolver/Normalizer combines the
two read models.

## Corrected flow

```text
NVDA SEC 8-K accession 0001045810-24-000113
  -> exact SEC raw ingest
  -> Primary 8-K analysis v49
  -> monitor_routes: corporate_action
  -> existing Generic Monitor durable child
  -> existing Corporate Action Gemini analyzer
  -> forward_split canonical fact
  -> typed Corporate Action persistence
  -> readStockSplitExecutions()
  -> stock-split share-basis normalizer
  -> anchor reconciliation hindsight projection
```

The Primary final-output invariant prevents a split stated elsewhere in the
same output from losing its Corporate Action route. The provider schema now
has explicit applicable/non-applicable branches, requires the complete
applicable shape, constrains required `source_ref` values to the supplied
documents, permits one bounded 800-character exact Corporate Action evidence
span, uses a 2,400-token output budget, and accepts success only when the
structured runner parsed valid JSON. There is still one Corporate Action
provider call per child attempt and no analyzer repair call.

The common fail-closed contract now rejects a calculation-complete canonical
result whose root source evidence cannot materialize. The execution reader
also throws when complete canonical calculation evidence cannot materialize
into an execution. These are structural evidence/materialization checks, not
change-size thresholds, split heuristics, or an NVDA patch.

For hindsight replay, optional `knownAt`/`executionKnownAt` separates the DB
knowledge cutoff from the historical basis date. The default remains
`knownAt = targetAt`, preserving all event-time behavior.

## Actual NVDA acceptance evidence

- SEC source: official 8-K accession `0001045810-24-000113`, accepted
  `2024-05-22T20:21:29Z`, Item 8.01.
- Source fetch: 1 feed plus 6 filing documents = 7 SEC requests; 0 retries.
  The configured SEC User-Agent, no-store behavior, and bounded transient
  retry policy were used.
- Canonical current lineage: one `forward_split` fact for Primary v49.
- Security: `sc:v1:0001045810:common_stock:single`, source title `common stock`.
- Ratio: exact old `1`, new `10`.
- Effective execution: `2024-06-07`, `after_market_close`, backed by the source
  statement that additional shares were to be distributed after market close
  on June 7. The June 10 split-adjusted trading start is not substituted as the
  execution date.
- Active execution: exactly one,
  `fse:v1:9c8473fce560743eeda2972b1cf648ce5c8ac74984ff44509c3a02d13bdb99e6`,
  with one source observation and zero conflicts/inactive executions.
- Pre-split authoritative anchor: `2,460,000,000` as of `2024-05-24`, NVDA
  10-Q accession `0001045810-24-000124`.
- Normalized start: `24,600,000,000`.
- Post-split authoritative anchor: `24,530,000,000` as of `2024-08-23`, NVDA
  10-Q accession `0001045810-24-000264`.
- Actual net change: `-70,000,000`; exact percent `-35/123%`
  (`-0.2845528455...%`). The values are calculated from the SEC anchors and
  canonical 1:10 execution, not hardcoded.
- The wrong-confident `+868%` disappears because the pre-split anchor is first
  normalized onto the post-split basis before subtraction.

## Gemini and replay accounting

Final architecture for this filing is the existing Primary path followed by
one Corporate Action Gemini call. The v49 Primary run used the existing Router,
Primary analysis, and one existing validation-repair call for two Primary
warnings. The final successful Corporate Action child attempt made exactly one
Gemini call, used no verifier/repair call, and the O/S-specific additional LLM
count was zero.

During evidence-driven development, 12 Corporate Action provider invocations
were observed across successive v47/v48/v49 contract experiments and retries;
failed invocations persisted no canonical result. Two earlier non-current
canonical facts are intentionally preserved in the shared local dataset rather
than deleted. Current-lineage selection exposes one fact and one execution.

Two final replay runs were byte-identical with SHA-256
`5df88f2503f3c2dfda9c6931cf7da33c676d79ec6af519a510950c02d978721b`.
Each replay returned duplicate/provider-calls `0`, current canonical fact count
`1`, active execution count `1`, execution observation count `1`, NVDA O/S
history count `18`, and the same reconciliation. Therefore canonical current
fact, execution, O/S history, and reconciliation duplicate increases were all
zero.

## Verification

Passed:

- actual local NVDA production flow and two deterministic replays
- Corporate Action applicability/persistence/analyzer, forward and reverse
  execution regressions
- stock-split normalization and anchor reconciliation
- SEC request policy/O/S production collection, authoritative extraction,
  history, class resolver
- Monitor foundation, production fanout, Alert consumer, Issuer Total
- relevant pgTAP: 4 files / 119 tests
- local DB lint at error level
- TypeScript, strict workflow validation, and production build
- secret scan, direct O/S-to-Gemini scan, changed-product NVDA patch scan,
  diff check, and oversized-change scan (all zero findings)

The dependency audit reported 3 moderate and 18 high advisories, 0 critical.
They are existing dependency findings outside this stock-split wiring change.

The all-file pgTAP run also showed the four relevant files passing. It stopped
only in two unrelated fixtures (`calendar_event_analysis_links.sql` and
`public_telegram_broadcast_delivery.sql`) because the shared local DB lacks the
unrelated `event_types.material_filing` row. No database state was changed to
mask that pre-existing fixture dependency.

## Operational handoff

- Base: `5fc8c17c0550abd4f3700b890aaa591417ed43e1`.
- Permanent local `main`, GitHub tracking ref, Vercel deployment, and port 3110
  were not changed.
- No push or deploy was performed.
