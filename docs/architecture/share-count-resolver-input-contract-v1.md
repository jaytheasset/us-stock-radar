# Share Count Resolver Input Contract V1

This contract prepares `share_count_history` for a future event-time resolver. It does not select a current value, prioritize a source, aggregate classes, or perform split adjustment.

## Why the previous history was not comparable

The authoritative XBRL writer identified a class from filing context/axis/member data, while the Level 2 writer identified it with a hash of the source-stated title. Those keys preserved provenance but could not prove that two sources described the same security class. Level 2 also populated `accepted_at` from `raw_items.published_at`, which can be an SEC-feed update or filed-date fallback rather than the SEC acceptance timestamp.

## Canonical security-class identity

Every observation keeps its existing source-specific identity and adds:

- `canonical_security_class_id`
- `canonical_security_class_kind`
- `canonical_security_class_status` (`mapped` or `unavailable`)
- `canonical_security_class_provenance`

IDs are issuer-scoped (`sc:v1:<CIK>:common_stock:...`). An authoritative single-common-stock XBRL context maps to the issuer's `single` identity. Class-specific XBRL contexts use the authoritative extractor's standard US-GAAP class-member vocabulary (for example `CommonClassAMember`) so yearly taxonomy namespace versions do not split the same class. The exact axis/member namespace and local-name tuple remains in derivation provenance. Titles and synonyms are not used.

The Level 2 sidecar now has the exact enum `security_class_kind=common_stock`. That semantic decision remains in the existing domain LLM call; there is no additional provider call. A Level 2 observation maps to the single-class ID only when stored authoritative filing-level evidence establishes exactly one single common-stock class for the issuer. The provenance records the supporting observations. Missing, conflicting, or class-specific evidence leaves the mapping unavailable.

Multi-class Level 2 observations are deliberately not mapped in V1 because the filing-text sidecar does not carry a deterministic XBRL member identity. ADS/ADR/ordinary-share ambiguity is excluded by the sidecar contract and cannot be repaired with title matching or ratio inference.

## Acceptance timestamp

`accepted_at` is nullable and may contain only:

- the verified SEC filing-ledger acceptance timestamp for authoritative XBRL observations; or
- `raw_payload.accepted_at`, when present and valid, for Level 2 observations.

`accepted_at_source` and `accepted_at_provenance` identify that boundary. `published_at`, feed update time, filed date, and ingestion time are never promoted to `accepted_at`. If the SEC acceptance timestamp is unavailable, Level 2 stores `accepted_at=null`, records the rejected fallback candidates in provenance, and remains ineligible for future event-time resolution.

Historical Level 2 rows are not silently reinterpreted: the migration nulls their potentially fallback-derived `accepted_at` and preserves the former value as rejected legacy provenance. Historical authoritative XBRL rows retain their filing-ledger timestamp and receive deterministic canonical class backfill.

## Future resolver boundary

The history reader may filter by canonical security-class ID, but it still returns append-only history. A later resolver can compare cross-source rows for the same issuer/class/as-of and detect agreement or conflict. It must exclude rows with unavailable class identity or unavailable acceptance time and must define source priority, split basis, aggregation, and event-time selection separately.
