# Reverse Split Execution Contract V1

## Product boundary

Corporate Action observations and share-basis calculation have different jobs.
The existing one-call Corporate Action analyzer continues to classify every
source observation as announced, board approved, shareholder approved,
scheduled, effective, or unknown. Monitor, Alert, and Timeline consumers may
use each observation independently.

Share-basis calculation does not consume that lifecycle graph. Its official
input is `readReverseSplitExecutions()`, which projects only source-backed,
calculation-eligible executions from the existing official current-observation
history. This V1 performs no outstanding-share arithmetic.

## Eligibility and identity

An observation is calculation-eligible only when it preserves all of:

- SEC issuer CIK and accession/accepted timestamp provenance
- exact mapped canonical common-stock class
- exact positive `old_share_units` and `new_share_units`
- source-backed effective date
- compact exact source evidence
- current canonical event/execution lineage

The action stage is not an eligibility gate. An announcement or approval with
no final ratio or effective date produces no execution. A scheduled filing that
states the exact final ratio, affected class, and future effective date creates
a future execution immediately.

The deterministic execution tuple is:

`issuer CIK + canonical security class + effective date + exact old units + exact new units`

Its stable ID is `rse:v1:<SHA-256 of the versioned tuple>`. Multiple 8-K,
effective notices, and later 10-Q observations with the same exact tuple become
one execution whose `observations[]` preserves every source. Elapsed time is not
part of the identity. A genuinely different source-backed tuple creates a
different execution.

## Amendment and cancellation safety

Before the existing Corporate Action Gemini call runs, deterministic context
may supply up to 12 calculation-eligible execution candidates for the same SEC
issuer. The source analysis returns one small `execution_update` sidecar:

- `KEEP_OR_CONFIRM`
- `SUPERSEDE_EXISTING_EXECUTION`
- `CANCEL_EXISTING_EXECUTION`
- `NEW_EXECUTION`
- `UNRESOLVED_EXECUTION_UPDATE`

An existing target must be one exact supplied `rse:v1` ID. The analyzer may
select it only when the current source explicitly confirms, changes, or cancels
that execution. Code never links by ratio/date similarity, ticker, title, or
elapsed time. The sidecar is part of the existing one provider response and
retains compact exact source evidence; it is not a second analyzer or lifecycle
graph.

`readReverseSplitExecutions()` is target-time aware. A superseded or cancelled
execution is returned separately as calculation-ineligible and never appears in
the active `executions[]` list after the update's SEC acceptance timestamp. An
unresolved update creates a conflict and fail-closes every active execution
already known at that update timestamp; it does not select or mutate one
arbitrary candidate. A genuinely new execution disclosed later remains
independent.

The calculation statuses `scheduled`, `effective`, `superseded`, `cancelled`,
and `conflict` are separate from Corporate Action Alert/Timeline `action_stage`.

## Conflict and class isolation

Different exact final ratios for the same issuer, canonical class, and
effective date produce `EXECUTION_CONFLICT`. Distinct explicit effective timing
values for that same group also conflict. No latest-source winner, source
priority, ratio heuristic, or LLM repair is used. Conflict groups are excluded
from the calculation-eligible execution list.

Canonical security classes are grouped independently. Unmapped classes,
ADR/ordinary ambiguity, unavailable ratio/date/evidence, and non-current source
lineage never enter the execution reader.

## Effective-date activation

V1 is a day-basis product contract and has no exchange calendar or synthetic
09:30 timestamp.

- target date before effective date: not applied
- target date after effective date: applied
- same date with date-only, market-open, or start-of-trading timing: applied
- same date with after-market-close timing: not applied for that day's ordinary
  basis; a later date is applied
- same date with exact timestamp: compare only when the consumer supplies an
  exact target timestamp; otherwise return indeterminate
- any other unresolved same-day timing: indeterminate

Thus a 1-for-10 split effective 2026-08-25 is pre-split on 8/24 and post-split
on 8/25 and 8/26 under ordinary date-only semantics.

## Unchanged systems

Corporate Action stage semantics, Reverse Split Monitor, Level 2 Share Count
sidecar, Generic Monitor fanout, Offering, and Listing contracts are unchanged.
Provider calls remain one per Corporate Action analysis, with no
execution-specific LLM call. The existing canonical JSON gains only the bounded
update sidecar. One service-role lineage-reader migration is added; no parallel
execution table or O/S arithmetic is introduced in V1.
