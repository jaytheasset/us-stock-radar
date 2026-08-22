# Reverse Split Canonical Action Identity & Dedup V1

## Boundary

This contract groups multiple current Corporate Action observations that describe
one real reverse-split lifecycle. It performs no share-count arithmetic, basis
normalization, issuer aggregation, or dilution calculation.

Before this contract, `readReverseSplitHistory()` returned one item per current
event/execution. A scheduled filing and a later effective filing for the same
split could therefore look like two independently applicable basis changes.
Event ID, execution ID, and accession remain observation provenance; they are
not the lifecycle identity.

## One-call semantic link

The existing Corporate Action Gemini call receives at most 12 prior action
candidates for the exact issuer, grouped by canonical security class. Each
candidate contains its stable action ID, origin event ID, current projection,
and at most four compact prior observation summaries.

The model returns exactly one semantic link decision:

- `NEW_ACTION`
- `EXISTING_ACTION_ID` copied from the supplied candidates
- `UNRESOLVED_ACTION_LINK`

Application validation checks candidate membership, exact issuer/class
identity, transport shape, and exact current-source evidence. It never links by
ratio, date proximity, ticker/title similarity, or class alone. No second LLM
call is introduced.

For a new linked SEC action, the deterministic identity is:

`rsa:v1:<10-digit CIK>:<origin event UUID>`

Reanalysis of the same origin event therefore produces the same ID. A later
real split whose semantic decision is `NEW_ACTION` has a different origin event
and a different ID. Unresolved and legacy observations have no applicable
action ID and are excluded from action-level normalization input.

## Persistence and official history

`event_corporate_action_facts` remains the only Corporate Action fact table. Its
immutable observation row now materializes the action ID, link status, origin
event, and link provenance. The database rejects an existing-action link unless
the referenced issuer/class action already exists.

`readReverseSplitActionHistory()` is the action-level successor reader. It
verifies every candidate through the existing current-event official reader,
then groups current observations by canonical action ID. Each group preserves
event ID, execution ID, accession, SEC accepted time, stage, ratio, effective
timing, evidence, and full canonical facts.

One canonical action is returned at most once. Distinct available final ratios,
effective dates, timing values, identity/class data, or same-acceptance-time
stages produce `ACTION_UNRESOLVED`; no winner or older fallback is selected.
Unavailable early lifecycle values may be refined by a later non-conflicting
observation.

## Same-day capability

V1 deliberately has no exchange calendar or synthetic market-session time.

- target calendar date before effective date: `NOT_APPLIED`
- target calendar date after effective date: `APPLIED`
- same date with authoritative `exact_timestamp`: compare exact instants
- same date with `market_open`, `start_of_trading`, `after_market_close`, or
  date-only timing: `SAME_DAY_ORDER_INDETERMINATE`

No session kind is converted to 09:30 or another inferred timestamp.
