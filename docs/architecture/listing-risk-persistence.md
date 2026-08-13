# Listing Risk Typed Persistence Foundation

> **Scope.** This document describes the Phase 1I persistence boundary only. It
> does not authorize a provider call, Primary fan-out, Matcher, Registry, Alert,
> UI, Calendar, or company-level listing lifecycle reducer.

## Canonical input and semantic boundary

The only accepted semantic input is a validated `ListingRiskAnalyzerResult`.
Applicable facts must pass `validateListingRiskAnalyzerResult()` and the nested
`validateListingRiskEventFacts()` contract in `lib/monitor/listingRiskFacts.ts`.
Persistence performs identity checks, current/stale checks, serialization,
typed materialization, atomic writes, idempotency, and read filtering. It does
not classify an event, repair evidence, infer a date, map a rule, normalize a
security basis, or supply a fallback value.

The persisted unit is one exact event analysis execution, not the company's
current final listing state.

## Persistence model decision

Phase 1I chose execution-keyed history plus a current reader (Option B).

Option A, replacing or deleting one event row, was rejected because an
`event_id`-only current row cannot naturally preserve exact Primary/child
lineage, distinguish a valid `not_applicable` conclusion from failure, or
protect against a late stale child without destructive history mutation.

Option B uses two immutable server-only tables:

- `event_listing_risk_results`: one semantic `applicable` or
  `not_applicable` result per exact child execution;
- `event_listing_risk_facts`: one row only for an applicable result, containing
  exact lineage, the untouched validated payload, and typed Matcher-oriented
  projections.

`not_applicable` creates a result-history row and no fact row. Analyzer failures
never enter the writer, and stale executions create neither row. Historical
applicable facts remain stored but are not current truth unless the reader
proves their exact parent is still current and their execution is the newest
successful semantic result for that parent.

## Exact lineage

Both persistence tables mechanically retain:

- `event_id` and `raw_item_id`;
- `parent_primary_ai_run_id`;
- exact child `source_execution_id` and `logical_job_id`;
- `monitor_analyzer_key` and `analyzer_contract_version`; and
- the result status and original validated result/fact payload.

The write RPC locks the event and child execution, verifies the generic child
metadata, exact Primary run and output, Listing route, event/raw/source
identity, every facts source family/ID/URL, and current Primary authority. There
is no `UNIQUE(event_id)` fact replacement boundary. The exact source execution
is the fact primary key.

## Fact mapping

| Canonical fact/group | Persistence strategy | Matcher-oriented typed projection |
| --- | --- | --- |
| `classification` | exact JSON plus typed columns | event kind, outcome, source ref |
| `exchange` | exact fact envelope in JSON | value |
| `affected_security` | exact fact envelopes in JSON | title, ticker, security basis |
| `listing_rule`, `listing_requirement`, `compliance_period` | exact fact envelopes in JSON | values |
| `proceeding` | exact JSON | kind and status |
| six `dates` | exact fact envelopes in JSON | six typed `date` columns |
| `continued_trading` | exact fact envelopes in JSON | typed boolean and venue |
| `as_of` | exact fact envelope in JSON | typed `date` |
| `confidence` | exact JSON | typed enum text |
| `sources` / evidence / all `source_ref` values | untouched JSON | sources JSONB retained exactly |

The complete validated payload remains authoritative for round-trip behavior,
including availability, quality, date status, null, false, source identity,
and evidence. Typed columns are transactionally extracted from that payload and
protected by consistency checks. Persistence does not re-truncate the existing
520-character evidence contract.

## Current reader

`read_current_event_listing_risk_facts(event_id, analyzer_contract_version)` is
the only database reader, wrapped by `readCurrentListingRiskFacts()`.

It first identifies the current accepted Primary for the event/raw/source
family, then selects the newest exact successful Listing child for that parent.
Only after selecting that semantic success does it require the matching Listing
result and applicable fact row. Consequently:

- a newer Primary immediately makes old-parent facts unavailable;
- a newer successful `not_applicable` returns `not_applicable` and never old
  facts;
- a stale child cannot become current;
- a failed retry on the same parent does not erase a prior valid success;
- terminal applicable success without typed persistence is `not_ready`, never
  an older-fact fallback.

The reader never inspects Primary summary/event type, display
`listing_status_snapshot`, news or parser text, Ownership/Offering facts, or an
arbitrary latest historical fact.

## Retry and ordering contract

The same execution and JSONB-identical validated result is idempotent. The same
execution with a different payload returns `conflict`; it is never overwritten.

For a future caller the required order is:

```text
validated analyzer result
  -> persist_listing_risk_analyzer_result
  -> saved/idempotent
  -> generic child terminal succeeded_applicable/succeeded_not_applicable
```

An applicable persistence error, rejection, conflict, or stale result must not
be followed by `succeeded_applicable`. `listingRiskTerminalStateAfterPersistence()`
encodes that repository-level gate. Phase 1I adds no caller.

If persistence succeeds but the later generic terminal transition fails, the
execution remains retryable and the stored row is not reader-eligible until the
terminal transition succeeds. It is not converted to semantic empty.

## Security and future Form 25

Both public-schema tables have RLS enabled and all direct privileges revoked
from `PUBLIC`, `anon`, `authenticated`, and `service_role`. The two RPCs are
`SECURITY DEFINER`, use an empty fixed `search_path`, and grant execute only to
`service_role`.

The schema records a textual `source_execution_kind` rather than constraining
all facts to a generic child enum. The Phase 1I writer accepts only verified
generic children, but a future separately approved direct one-stage Form 25
writer can reuse the result/fact tables and canonical fact version without a
table redesign. No Form 25 execution or fan-out is implemented here.
