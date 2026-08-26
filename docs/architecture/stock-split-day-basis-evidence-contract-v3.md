# Stock Split Day-Basis Evidence Contract V3

This contract narrows the calculation boundary for reverse and forward stock
splits. It does not change Corporate Action alert/timeline semantics, the
official stock-split normalizer, share-count arithmetic, or the one-call Level
2 provider route.

## Authoritative evidence and preview

An authoritative evidence identity is derived only after the provider selects
an exact contiguous span from one supplied cached source document. It contains:

- `source_ref`
- zero-based exact `range_start` and exclusive `range_end`
- SHA-256 `source_content_hash` of that exact span
- `exact_source: true`

Application code may verify the source reference, range, hash, and exact-source
indicator. It may also derive an at-most-800-character display preview. The
preview is not the authoritative source and its length never decides whether a
semantic fact is available. The cached source document remains the raw source
of truth; application code does not summarize or rewrite it into evidence.

Ratio, effective date, affected canonical security class, and calculation
activation each carry their own evidence identity. Root evidence remains useful
provenance, but it is not the only promotion gate. Existing V1 facts remain
readable; newly generated V3 facts require complete field identities before an
execution can materialize.

## Day-basis calculation activation

The calculation boundary has exactly three states:

| Source-backed meaning | Calculation activation | Effective-date behavior |
| --- | --- | --- |
| `date_only` | `ON_EFFECTIVE_DATE` | apply when `target_date >= effective_date` |
| `business_day_open` | `ON_EFFECTIVE_DATE` | apply when `target_date >= effective_date` |
| `market_open` | `ON_EFFECTIVE_DATE` | apply when `target_date >= effective_date` |
| `start_of_trading` | `ON_EFFECTIVE_DATE` | apply when `target_date >= effective_date` |
| `after_market_close` | `AFTER_MARKET_CLOSE` | do not apply on the effective date; apply after it |
| effective date unavailable | `INDETERMINATE` | fail closed |

Richer timing remains in raw/canonical provenance for alert and timeline
consumers. O/S calculation does not infer an exchange calendar, timezone,
09:30, midnight, or any other clock boundary. An available effective date with
unavailable fine-grained timing uses the date-only calculation state; only an
unsafe effective date is calculation-indeterminate.

## LLM and deterministic responsibilities

The existing Corporate Action Level 2 call remains the only semantic call. It
selects the event kind, exact old/new ratio, effective date, affected supplied
security-class candidate, source evidence, timing meaning, and execution-update
meaning. There is no verifier, repair, or evidence-model call.

Deterministic code validates the returned transport and exact source spans,
derives evidence identities/previews, mechanically derives the ratio quotient,
and maps the source timing meaning to the day-basis activation. It does not use
phrase matching or regexes to classify semantic meaning and does not create
evidence.

## Fail-closed states

The downstream states stay distinct:

- `NO_SPLIT_EVIDENCE`: no applicable source-backed split fact exists.
- `SPLIT_MATERIALIZATION_FAILED`: applicable split evidence exists but canonical
  promotion or execution materialization failed.
- `SPLIT_EXECUTIONS_AVAILABLE`: at least one conflict-free calculation execution
  is available.

An invalid/missing field evidence identity, unavailable effective date,
unresolved execution update, tuple conflict, or persistence failure never causes
an execution to be created at any cost.

## Persistence

`event_corporate_action_results.validated_result_payload` and
`event_corporate_action_facts.facts_payload` already preserve the extended JSONB
payload. V3 adds no table, column, arithmetic, or remote data change. The V3
migration only admits the new analyzer contract version through the existing
lineage-locked persistence/current-reader functions while retaining V1 support.

The application asks for the current-lineage V3 result first. It reads a
current-lineage V1 result only when the database proves that no V3 child exists
for that exact current Primary. A pending, failed, stale, malformed, or
unpersisted current-lineage V3 attempt returns `not_ready`; it never revives an
older V1 success. A successful V3 `not_applicable` result is likewise terminal.

The application reads the current V3 lineage first. It queries the legacy V1
contract only when that exact V3 read reports `current_successful_result_missing`;
each query independently enforces the current parent run and exact source
execution in the existing `SECURITY DEFINER` function. The V1 reader also
rechecks for an exact-current V3 attempt at its own database snapshot, closing
the race between the application's V3 and V1 reads. A V3 available result,
not-applicable result, lineage mismatch, or broken terminal result is therefore
never replaced by an older V1 success. Likewise, a persisted V3 materialization
failure can be healed only by a matching V3 fact with calculation activation;
a legacy V1 execution with the same tuple cannot hide that failure.
