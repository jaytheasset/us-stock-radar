# Issuer Common-Class Universe Snapshot V1/V2

This foundation records which canonical common-stock classes a single complete
SEC filing proves existed at one O/S measurement date. It does not calculate an
issuer total, select a current O/S value, normalize a share basis, or calculate
dilution.

## Why share-count history is not a universe

`share_count_history` is deliberately an append-only observation ledger. It can
show that Class A and Class B were observed, but absence of Class C from that
history is not evidence that Class C did not exist. Historical class IDs are
therefore never unioned and labelled complete.

The universe source is one complete primary IXDS filing set already admitted by
the Filing-level XBRL completeness gate. The existing Authoritative O/S decision
preserves every relevant same-concept filing fact, its context, dimensions,
document, and accession. Universe derivation consumes that complete fact set and
the existing canonical security-class identity function.

## Snapshot contract

`deriveIssuerCommonClassUniverseSnapshot()` produces one of:

- `COMPLETE_SINGLE`: one axis-free authoritative DEI O/S fact, an exact
  `single` canonical common class, no separate class facts, and no unresolved
  class ambiguity. A `20-F`/`40-F` source must already carry the authoritative
  extractor's exact U.S.-listed foreign trading-security evidence.
- `COMPLETE_MULTI`: at least two same-date class-specific common O/S facts and
  every member maps to a source-backed canonical common-class identity. V2
  accepts either an existing `us-gaap:<member-local-name>` ID or an issuer
  extension `custom:<namespace-uri-sha256>:<member-local-name>` ID.
- `INCOMPLETE`: the filing set, breakdown, provenance, member mapping, or
  aggregate corroboration cannot prove the complete set.
- `AMBIGUOUS`: unresolved foreign/ADS basis or same-class fact conflicts
  prevent a safe class set.

For a multi-class snapshot, every class fact must use the same O/S instant. If
an aggregate fact is present, it is corroboration only: its exact integer must
equal the exact sum of the class facts. It never supplies or reverse-engineers a
missing class. Preferred, warrant, option, convertible, float, reserved-share,
and other unsupported members are never returned as required common classes.

Custom identity is generic and QName-based. The source concept must be DEI
`EntityCommonStockSharesOutstanding` or US-GAAP
`CommonStockSharesOutstanding`; the axis must be the US-GAAP
`StatementClassOfStockAxis`; and the member must have an exact resolved
namespace URI and local name. Prefix spelling, ticker presence, filing title,
accession, and member-title synonyms are never identity evidence. Standard
US-GAAP IDs remain unchanged. An issuer extension namespace is stored in
provenance and represented in the canonical ID by its exact SHA-256, so equal
local names in different namespaces cannot collide.

Non-complete snapshots persist with an empty required-class list. This prevents
a partial list from being mistaken for an aggregation contract while retaining
the reason and source evidence needed for diagnosis and later reprocessing.

## Time and persistence

`universe_as_of` is the shared instant date of the filing O/S facts. It is not a
report-period, quarter-end, filed-date, or ingestion-time fallback.
`accepted_at` is the actual SEC filing-ledger acceptance timestamp. The source
accession, form, filed date, primary IXDS documents, fact/context evidence, and
completeness lineage remain attached to the append-only snapshot.

`public.issuer_common_class_universe_snapshots` has RLS enabled. Browser roles
have no direct access; `service_role` has only `SELECT` and `INSERT` plus the
identity-sequence privileges. A deterministic filing/fact identity hash makes
exact replay insert zero rows. There is no current-universe column or update
path.

V2 is an additive source-contract correction. V1 rows remain immutable. When
V1 and V2 describe the same issuer/as-of/acceptance/accession observation, the
official reader keeps the highest supported version before testing the latest
frontier for conflicts. This lets a V2 result supersede a prior V1 gap without
rewriting append-only history.

The separate `issuer-common-class-universe-prospectus-text-v1` version is not a
V1/V2 XBRL upgrade. It is admitted only by the complete final-424B4 contract in
`new-listing-prospectus-os-baseline-v1.md`, can represent only one canonical
common-stock class, and retains its automatic-verifier/listing/text-artifact
lineage. Periodic-only readers do not treat it as a periodic baseline.

## Official event-time reader

`readIssuerCommonClassUniverseAt({ repository, shareCountHistoryRepository,
cik, targetAt })` applies both look-ahead gates:

- `universe_as_of <= targetAt` date
- `accepted_at <= targetAt`

It selects the newest eligible snapshot frontier. A newer `INCOMPLETE` or
`AMBIGUOUS` frontier fails closed rather than silently falling back to an older
complete set. Conflicting snapshots on the same frontier are `AMBIGUOUS`.

After a complete snapshot is selected, the reader checks later source-backed,
mapped common-class observations in `share_count_history`. A canonical class not
present in the snapshot returns `CLASS_UNIVERSE_STALE` until a later complete
snapshot includes the new class. No title matching or class-name synonym logic
is used.

## Downstream boundary

The [Issuer Total Common O/S Aggregator V1](issuer-total-common-os-aggregator-v1.md)
consumes only an `AVAILABLE` reader result and resolves and
share-basis-normalizes every ID in `requiredCanonicalSecurityClassIds`. Partial
sums remain forbidden.
