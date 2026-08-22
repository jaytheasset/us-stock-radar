# Issuer Total Common O/S Aggregator V1

`resolveIssuerTotalCommonSharesAt()` is the official read-only event-time
projection for issuer-wide common shares outstanding. It does not discover
security classes, select an incomplete class set, mutate history, persist a
current value, use hindsight reconciliation, or calculate dilution.

## Official composition

The aggregator composes only the locked upstream contracts:

```text
targetAt
  -> readIssuerCommonClassUniverseAt()
  -> requiredCanonicalSecurityClassIds
  -> resolveClassShareCountAt() for every required class
  -> normalizeClassShareCountAt() for every resolved class
  -> exact rational sum after every class succeeds
```

The universe must be `AVAILABLE` and backed by a `COMPLETE_SINGLE` or
`COMPLETE_MULTI` snapshot. `INCOMPLETE`, `AMBIGUOUS`,
`CLASS_UNIVERSE_STALE`, a future snapshot, an empty required-class list, or a
malformed reader result produces no total. The aggregator never unions class
IDs found in `share_count_history`.

For every required ID, the official class resolver is invoked once. Its exact
result is supplied to the reverse-split normalizer so normalization does not
perform a second history selection. Each class is normalized independently;
only then are the class fractions added. Preferred stock, warrants, options,
convertibles, pre-funded warrants, authorized or reserved shares, float, and
treasury shares are outside the complete common-class universe and are never
added automatically.

## Fail-closed total

The official total exists only when every required class resolves and
normalizes successfully. A missing class, same-date class conflict, untrusted
acceptance timestamp, reverse-split execution conflict, indeterminate timing,
or identity mismatch makes the result `UNAVAILABLE`. Resolved components may
remain in diagnostics, but no partial aggregate field is emitted or promoted.

Class components preserve the selected observation, all corroborating
provenance, source `as_of`, actual `accepted_at`, `age_days`, the normalized
fraction, and applied reverse-split executions. Different `as_of` dates across
classes are permitted because every component independently satisfies the
same `targetAt` event-time contract.

## Exact arithmetic and coverage

Each normalized class value and the total use reduced integer
`numerator`/`denominator` fractions. Addition uses `BigInt`; floating point,
rounding, floor, and ceiling never establish an authoritative total. Integer
results expose the exact integer string, while a fractional issuer result
keeps its denominator.

Coverage is explicitly limited to:

- `complete_common_class_universe`
- `event_time_observations`
- `reverse_split_only_basis_normalization`

Calling the interface with `targetAt = now` yields the issuer common O/S
resolved from information publicly available by that time, using the complete
known common-class universe and known reverse splits. It is not represented as
the issuer's perfect real-time legal ledger balance.

Anchor Reconciliation remains a separate `RECONCILED_HINDSIGHT` view. Future
periodic anchors do not participate in this event-time aggregate. V1 creates no
table, cache, scheduler, UI, dilution exposure, potential-share amount, or
dilution percentage.
