# Share Count Anchor Reconciliation V1

`reconcileShareCountAnchors()` is a read-only retrospective quality-control
projection for one issuer-scoped canonical common-stock class. It never updates
`share_count_history` and is explicitly separate from the event-time resolver.

## Anchor contract

The caller identifies start and end anchors by the O/S fact's exact `as_of`
date. Filing date, report period, quarter end, and year end are not substitutes.
An anchor must already be an `ELIGIBLE` filing-level authoritative O/S history
observation with a verified SEC acceptance timestamp, exact canonical security
class, DEI O/S fact lineage, and a periodic form (`10-Q`, `10-K`, `20-F`, or
`40-F`, including amendments). Level 2 filing-text observations can corroborate
or become intermediate points, but cannot become anchors.

The currently locked authoritative extractor produces domestic `10-Q`/`10-K`
anchors. It still fails closed on foreign/ADR basis ambiguity. The reconciliation
gate recognizes a foreign periodic row only if a future authoritative extractor
has already promoted it to the same `ELIGIBLE` history contract; reconciliation
does not perform that promotion.

Multiple authoritative rows for the same class/date/value are preserved as
supporting provenance. Different values for the same class and `as_of` are a
`CONFLICT`; no accession, amendment, or source receives priority.

## Basis and arithmetic

The start anchor and every trusted intermediate Level 2 point are passed through
the locked `normalizeClassShareCountAt()` arithmetic to the end anchor's date
basis. Only calculation-eligible reverse-split executions are covered.

```text
net change shares = end anchor shares - normalized start shares
net change percent = net change shares / normalized start shares * 100
```

All values remain reduced exact rational numerator/denominator pairs. No float,
rounding, interpolation, or size-based anomaly heuristic establishes a result.
A change above 100% is valid. A reverse-split conflict or indeterminate basis
makes reconciliation unavailable.

Intermediate observations are grouped by exact `as_of`, normalized to the same
end basis, and returned with full source-specific provenance. Different dates
are ordinary history, not conflicts. Different values on the same class/date
are conflicts.

## Hindsight boundary

The output view is `RECONCILED_HINDSIGHT`. A future end anchor can explain the
interval retrospectively, but it is never inserted into, substituted for, or
fed back into a historical `resolveClassShareCountAt()` event-time result. The
raw history remains append-only and unchanged.

Coverage is intentionally limited to:

- `authoritative_periodic_anchor`
- `reverse_split_only_basis_normalization`

Offering, ATM, warrant, convertible, issuer-total aggregation, and dilution
attribution remain outside V1. A later attribution layer can subtract known
realized issuances from the exact reconciled net change without changing this
anchor result.
