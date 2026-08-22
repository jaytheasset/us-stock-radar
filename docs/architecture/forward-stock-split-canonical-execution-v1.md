# Forward Stock Split Canonical & Execution Contract V1

## Boundary and reuse

An explicit forward stock split is a source-backed Corporate Action canonical
fact with `event_kind = forward_split`. It uses the existing one-call Corporate
Action analyzer, canonical security-class candidates, immutable current-lineage
fact history, execution update sidecar, and effective-date activation rules.
There is no second analyzer, verifier, repair call, execution table, backfill,
scheduler, or O/S calculation.

The locked `readReverseSplitExecutions()` API, `rse:v1` identities, reverse
canonical versions, and reverse-only share-basis normalizer are unchanged. The
official generic extension is `readStockSplitExecutions({ actionKind, ... })`.
Forward executions are not consumed by the reverse-only O/S normalizer in this
contract.

## Canonical ratio and applicability

Ratio components preserve old-to-new execution orientation:

- 4-for-1 forward split: `old_share_units = 1`, `new_share_units = 4`
- 3-for-2 forward split: `old_share_units = 2`, `new_share_units = 3`

Forward canonicalization fails closed unless new units are greater than old
units. These are source ratio components, not outstanding-share arithmetic.

The affected security must be exactly one existing issuer-scoped canonical
common-stock class candidate. Single common and explicit Class A/B/C identities
reuse the existing security-class system. Generic multi-class language,
unsupported classes, ADS-versus-ordinary ambiguity, missing SEC CIK/accession
lineage, ticker mapping, and title inference remain unavailable.

## Execution identity and lifecycle

A calculation-eligible forward observation requires SEC issuer CIK,
`forward_split`, mapped canonical class, exact positive units, source-backed
effective date and timing semantics, accession/evidence provenance, and current
canonical lineage. A scheduled filing may register a future execution once the
final ratio, class, and effective date are fixed.

The versioned identity tuple is:

`forward_split_execution_v1 + issuer CIK + canonical class + effective date + old units + new units`

Its ID is `fse:v1:<SHA-256>`. The action-specific version and prefix prevent a
forward tuple from colliding with the locked reverse `rse:v1` identity.

The same provider response owns the existing explicit update relation. It may
target only one supplied same-action-kind candidate ID. Identical later
observations dedupe into one execution; an explicit ratio/date change
supersedes the old tuple; cancellation leaves no active execution; a historical
re-mention confirms without creating another execution; and a genuinely new
split is independent. No ratio/date similarity, ticker, title, or elapsed-time
heuristic links actions.

## Stage, Alert, and effective date

Corporate Action stages remain `announced`, `board_approved`,
`shareholder_approved`, `scheduled`, `effective`, and `unknown`. Monitor and
Alert matching read the source-backed canonical event kind and stage exactly;
calculation eligibility remains a separate projection.

Effective-date activation is identical to the reverse contract: before the
date is not applied; after the date is applied; date-only, market-open, and
start-of-trading apply on the date; after-market-close does not apply to that
day basis; and exact timestamps require exact comparison. No exchange calendar
or synthetic 09:30 time is used.
