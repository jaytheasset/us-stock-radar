# Common Monitor Matcher V1

## Scope and canonical boundary

The common Matcher is a deterministic, LLM-free evaluator over registered
official fact readers. V1 supports `readCurrentListingRiskFacts()` and
`readCurrentEventCorporateActionFacts()`. It does not create or persist
Monitors, send Alerts, infer condition meaning, or change analyzer facts. Each
registered official reader is the only truth for its condition family.

The Registry is authoritative for supported keys, operators, value types, enum
values, canonical JSON paths, readers, and eligibility. A condition that
does not pass `validateMonitorConditionInput()` is ineligible; the Matcher does
not repair, normalize, or reinterpret it. Categorical values are compared as
canonical enum tokens and never consult value quality or provenance. Fact
envelopes require `availability=available` and value quality `exact`, `derived`,
or `estimated`. Reader `not_ready`/`not_applicable`, unavailable facts, unknown
quality, invalid canonical values, and Registry-declared ineligible enum values
all fail closed.

## Evaluation flow and result

`evaluateListingMonitorEvent()` reads official facts once per event, then
evaluates any supplied in-memory condition sets. It reads each required
canonical reader at most once and calls the provider-neutral current-price
adapter at most once, reusing those values across monitors. The pure
`evaluateMonitorConditions()` function has no side effects. The compatibility
wrapper `evaluateListingMonitorConditions()` keeps the original Listing API.
One condition set uses AND aggregation and returns `match`, `no_match`, or
`ineligible`; a definite `no_match` takes precedence over an ineligible sibling
condition.

`corporate_action.event_kind = reverse_split` is evaluable only when the
official Corporate Action reader returns an available reverse-split fact.
`not_ready` and `not_applicable` are ineligible. A plain reverse-split condition
does not imply an action stage. An explicit `corporate_action.action_stage`
condition is a lifecycle restriction and uses the exact canonical stage meaning
shared by the Analyzer, official reader, Registry, and Compiler catalog. The
canonical `unknown` stage remains reader-valid but is not monitorable. Ratio and
effective date are not condition-addressable in Monitor V1. No parser, calendar,
Primary output, raw analyzer output, or unrelated AI run is a fallback fact
source.

Text comparison is exact and case-sensitive. Boolean comparison preserves
`false`. Fixed date operators remain unchanged and date-only:

- `eq`: fact date equals the supplied date.
- `neq`: fact date differs from the supplied date.
- `before`: fact date is strictly earlier than the supplied date.
- `after`: fact date is strictly later than the supplied date.

## Generic `within_days` contract

`within_days` is a generic date-only Registry operator. Its stored condition
shape remains `{ key, operator: "within_days", value: N }`. `N` must be a
non-negative safe integer; negative, fractional, string, and unsafe integer
values are rejected. The operator is not available to timestamp conditions.

The caller must inject a valid `evaluationDate` in `YYYY-MM-DD` form. No wall
clock is read. Both the fact and evaluation date are parsed as strict UTC
date-only values, so local timezone and daylight-saving transitions cannot
shift the comparison day. The exact rule is:

```text
fact date >= evaluationDate
and
fact date <= evaluationDate + N calendar days
```

Today and the exact N-day boundary match. Past dates and N+1 do not. A relative
condition is evaluated on each run and is never rewritten to a fixed date.

## Alert boundary

The common event consumer loads active Monitor condition sets, reuses the facts
and current price for that event attempt, and inserts internal Alerts only for
`match`. The existing `(monitor_id, event_id)` uniqueness contract makes replay
idempotent. Delivery remains out of scope. The Matcher itself performs no Alert
or Monitor persistence and makes no LLM call. It does not compare `source_ref`,
evidence, confidence, or any analyzer provenance field.
