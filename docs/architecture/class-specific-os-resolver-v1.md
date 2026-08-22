# Class-Specific O/S Resolver V1

`resolveClassShareCountAt()` is the official read-only event-time resolver for one issuer-scoped `canonical_security_class_id`. It reads only `share_count_history`; it does not write a current value, rank sources, aggregate classes, apply reverse-split arithmetic, or calculate dilution.

## Eligibility and selection

For `{ cik, securityClassId, targetAt }`, the resolver keeps only observations whose issuer and mapped canonical class match exactly, whose `as_of` date is not after `targetAt`, and whose verified non-null `accepted_at` is not after `targetAt`. Filing, publication, feed-update, and ingestion timestamps are never substitutes for `accepted_at`.

Among eligible observations, the latest `as_of` group is selected. XBRL and Level 2 have no source priority. Equal values in that group resolve once while every source-specific observation and provenance record remains in `supportingObservations`. Different values for that same class and `as_of` return `CONFLICT` with no selected observation or winner. Conflicts at superseded older dates do not override a later unambiguous observation.

`UNAVAILABLE` means there is no eligible observation at the requested event time or the official history read failed. An observation with `accepted_at=null` is never event-time eligible.

## Output and downstream boundary

`RESOLVED` returns the exact integer string, source `as_of`, normalized `targetAt`, whole `ageDays`, one deterministic representational `selectedObservation`, and all latest-date supporting observations. The selected record does not establish source priority because every supporting record has the same resolved value. `CONFLICT` returns the conflicting latest-date observations with `selectedObservation=null`.

No arbitrary freshness cutoff exists in V1. `ageDays` is metadata for later policy. A future Reverse Split Normalizer may consume the result, but this resolver does not transform the stored share basis. Class A, Class B, Class C, and the single-class identity are always resolved independently and never summed.
