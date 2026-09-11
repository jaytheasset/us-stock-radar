# Schedule 13 Monitor and internal Alert v1

## Source and scope

The only fact source is `readSc13IssuerCurrentState`, which reads the immutable
`sec_sc13_filings` and `sec_sc13_reporting_persons` canonical XML values. The
matcher accepts only an `available_stored_history` position. Its scope is
`complete_stored_history_not_sec_global`: every value means the latest value in
the saved filing history at evaluation time, not real-time beneficial ownership.

Site analysis, Primary or fallback LLM output, events, legacy canonical facts,
external providers, and `lastReported` are not inputs. A missing current value,
an incomplete read, unresolved lineage, missing reporter CIK, or ambiguous exact
identity is ineligible and produces no Alert.

## Exact subject identity

A saved monitor identifies one position with all four normalized fields:

- ten-digit issuer CIK;
- ten-digit reporting-person CIK;
- normalized exact security class (trimmed, whitespace-collapsed, uppercase);
- a non-empty, sorted, de-duplicated exact CUSIP set (uppercase).

The matcher requires exactly one available position containing that reporter.
Other reporters and positions are never combined. Every condition in a monitor
is evaluated against the same current reporting-person row.

## Supported conditions

V1 supports exact decimal comparison (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`)
for six directly reported fields:

- `sc13.aggregate_owned`;
- `sc13.percent_of_class`;
- `sc13.sole_voting`;
- `sc13.shared_voting`;
- `sc13.sole_dispositive`;
- `sc13.shared_dispositive`.

Thresholds and reported values remain decimal strings and use integer/scale
comparison, so JavaScript `Number` limits do not apply. Share/power values must
be non-negative. Percent values must be between zero and 100. Zero is available;
null is unresolved. The matcher never sums reporters, copies another row, fills
null from `lastReported`, estimates, corrects, or asks an LLM for a value.

## Alert semantics and dedupe

The deterministic service entry is `consumeSc13MonitorAlertsForIssuer`. It reads
saved active conditions, calls the current-state reader, evaluates them, and
writes only the internal `sc13_monitor` lane. These rows have no site event,
channel, schedule, sender attempt, or external delivery path.

The database unique key is monitor + root accession + position key + reporter
CIK. The first matching latest-saved head creates one immutable Alert. Replays
and concurrent consumers return the existing row. If an amendment in the same
root lineage still matches, it does not create another Alert and does not
overwrite the first trigger provenance. If it no longer matches, the historical
Alert is retained. Amendment XML and its current head remain independently
available through the canonical history/current-state reader.
