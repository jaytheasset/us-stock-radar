# Stock Split Share-Basis Normalization V2

`normalizeClassShareCountForStockSplitsAt()` is the official read-only projection
from one class-specific historical O/S observation to a target timestamp. It
reuses `resolveClassShareCountAt()` and the official
`readStockSplitExecutions()` projections for `forward_split` (`fse:v1`) and
`reverse_split` (`rse:v1`). It does not parse, link, or deduplicate raw
Corporate Action filings.

Every active execution strictly after the observation `as_of` and applicable at
`targetAt` is applied in effective chronology:

```text
normalized shares = historical shares * new_share_units / old_share_units
```

The calculation uses reduced `BigInt` rational fractions only. Date-only,
market-open, start-of-trading, after-market-close, exact-timestamp, and
unresolved timing reuse the locked execution activation contract. Either
action kind's execution conflict or indeterminate timing makes normalization
unavailable; no unadjusted fallback is returned.

Coverage is `stock_split_basis_normalization`. It covers explicit forward and
reverse stock splits only. Stock dividends, recapitalizations, ADS ratio
changes, and every other non-split basis change remain unsupported and are
listed in the result. Share-count history stays immutable, and no current O/S,
cache, job, scheduler, backfill, dilution, or potential-share value is created.

The V1 reverse-only `normalizeClassShareCountAt()` interface remains unchanged
for backward compatibility. The official Anchor Reconciliation and Issuer
Total Common O/S Aggregator paths use the V2 common normalizer. Their generic
`appliedStockSplitExecutions` output preserves both kinds; the deprecated
`appliedReverseSplitExecutions` view remains as a reverse-only compatibility
alias.
