# Listing Matcher V1

## Scope and canonical boundary

Listing Matcher V1 is a deterministic, LLM-free evaluator over the official
`readCurrentListingRiskFacts()` result. It does not create or persist Monitors,
send Alerts, call a provider, infer condition meaning, or change Listing
Analyzer/Core/Agent facts. The official reader is the only fact source.

The Registry is authoritative for supported Listing keys, operators, value
types, enum values, canonical JSON paths, and eligibility. A condition that
does not pass `validateMonitorConditionInput()` is ineligible; the Matcher does
not repair, normalize, or reinterpret it. Categorical values are compared as
canonical enum tokens and never consult value quality or provenance. Fact
envelopes require `availability=available` and value quality `exact`, `derived`,
or `estimated`. Reader `not_ready`/`not_applicable`, unavailable facts, unknown
quality, invalid canonical values, and Registry-declared ineligible enum values
all fail closed.

## Evaluation flow and result

`evaluateListingMonitorEvent()` reads official facts once per event, then
evaluates any supplied in-memory condition sets. The pure
`evaluateListingMonitorConditions()` function has no side effects. Like the
Offering Matcher, one condition set uses AND aggregation and returns `match`,
`no_match`, or `ineligible`; a definite `no_match` takes precedence over an
ineligible sibling condition.

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

## Explicitly absent

V1 adds no Alert, user Monitor persistence/API/UI, natural-language Condition
LLM, migration, remote write, lifecycle reducer, or Listing-specific operator
fallback. It does not compare `source_ref`, evidence, confidence, or any Agent
provenance field.
