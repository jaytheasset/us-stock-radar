# Reverse Split Share-Basis Normalization V1

`normalizeClassShareCountAt()` is the official read-only projection from one
class-specific historical O/S observation to a target timestamp. It composes
only the locked official interfaces:

```text
share_count_history
  -> resolveClassShareCountAt()
  -> readReverseSplitExecutions()
  -> normalizeClassShareCountAt()
```

The history row remains immutable. The normalizer creates no adjusted history
observation, current-O/S record, job, cache, or scheduler. A later Current O/S
projection may call this interface at read time without creating a second
source of truth.

## Exact calculation

Only active calculation-eligible executions for the exact issuer-scoped
canonical security class are considered. Executions start strictly after the
resolved O/S `as_of` date and end at `targetAt`. Superseded and cancelled
executions are absent from the active official-reader result. Any execution
conflict makes normalization unavailable.

For every applied execution in effective chronology:

```text
next shares = previous shares * new_share_units / old_share_units
```

Arithmetic uses exact integers and reduced rational fractions. No IEEE-754
number, floor, ceiling, or rounding operation establishes the result. A
non-integral answer retains `numerator` and `denominator`; individual-holder
fractional-share or cash-in-lieu policies are not applied to issuer O/S.

The locked effective-date activation contract is reused unchanged. Date-only,
market-open, and start-of-trading executions apply on the effective date.
After-market-close does not apply on that date's day basis. Exact timestamps
compare against `targetAt`, and an unresolved timing that affects the target
fails closed.

## Output boundary

`NORMALIZED` preserves the original class resolver result, the exact projected
share fraction, the applied execution IDs in chronology, exact ratios, and all
source observations. `NORMALIZATION_UNAVAILABLE` returns no normalized number
for O/S conflicts, execution conflicts, indeterminate timing, invalid ratios,
missing provenance, or reader failures. It never presents the unadjusted
historical number as current fallback.

Coverage is always `reverse_split_only`. The read-only
[Share Count Anchor Reconciliation V1](share-count-anchor-reconciliation-v1.md)
may consume this projection, but the normalizer itself does not select anchors.
V1 does not cover forward splits, stock dividends, recapitalizations, ADS ratio
changes, issuer-wide class aggregation, market cap, or dilution.
