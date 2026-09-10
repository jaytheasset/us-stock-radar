# SEC Amendment Lineage and Current State V1

## Scope

This foundation links an `8-K/A` or `6-K/A` to one source-established original
filing, records append-only lineage and fact versions, projects current Monitor
state, and preserves the original event as the internal Alert identity. It
reuses the existing SEC Primary routing, Corporate Action/Listing Risk domain
analyzers, typed persistence, and Listing Monitor consumer. It adds no new LLM,
public delivery channel, scheduler, backfill, parser, UI, or Monitor type.

V1 authorizes one affected Monitor domain per amendment. Multiple affected
domains, uncertain scope, and unsupported forms remain review-only. A
`SUPPLEMENT` also requires that exact domain in the unchanged Primary routing;
the persisted-lineage empty-route exception is limited to a Corporate Action
`REPLACE` of an existing root fact.

## Exact link proof

`resolveSecAmendmentLineage()` requires:

1. a valid official `sec_edgar` identity (raw item, CIK, accession, `/A` form,
   filed date, index URL, and primary-document URL);
2. amendment text that explicitly identifies the base form and exactly one
   original accession or filing date;
3. exactly one stored original event/raw item matching source, CIK, base form,
   and that explicit accession/date; and
4. affirmative source language establishing `NOOP`, `SUPPLEMENT`, `REPLACE`,
   or `CANCEL` and literal evidence for every affected semantic fact.

The bridge queries the exact stored candidates itself. It does not trust the
Primary `parent_filing_context`, filing order, date proximity, ticker/name/title
similarity, or the `/A` suffix as link evidence. Zero or multiple raw candidates,
or a raw candidate that does not map to exactly one event, blocks before domain
provider work.

Dates that describe the amended business fact are not target filing dates. The
target-date extractor is anchored to an explicit unamended base form followed
by `filed`/`furnished`. Multiple target filing dates conflict.

## Operation and fact rules

- `NOOP` requires an explicitly non-substantive clerical/formatting/signature
  change and carries no fact version.
- `SUPPLEMENT` requires explicit add/supplement language plus preservation of
  the remaining original. It is allowed only when the production root-fact
  reader positively returns `absent`; a read failure is never treated as
  absence.
- `REPLACE` requires explicit correction/replacement language. Each affected
  fact must exist at the root and receive one new typed version.
- `CANCEL` requires affirmative language directed at the prior Form/report/
  filing itself. Cancellation of an agreement, license, note, or transaction
  is not filing cancellation. Conditional, modal, negated, partial, or
  contradictory cancellation language blocks.

The source excerpt must contain the exact evidence phrase for each fact scope.
Code never calculates, repairs, replaces, or supplies a fallback SEC analysis
value.

## Persistence and projection

Migration `20260910124734_sec_amendment_lineage_current_state_v1.sql` creates:

- `sec_filing_lineage_observations`, an append-only linked/review ledger;
- `sec_filing_semantic_fact_history`, append-only typed fact envelopes;
- service-role-only insert RPCs for original facts and amendment observations;
  and
- a service-role-only reader consumed by the deterministic projector.

Both tables have RLS enabled and direct access revoked from `PUBLIC`, `anon`,
`authenticated`, and `service_role`. RPCs are `SECURITY DEFINER` with an empty
fixed `search_path`. Content-derived keys make exact replay idempotent and make
different content under an existing key conflict.

The projector follows only explicit prior edges. Forks, cycles, conflicting
fact histories, missing replacement facts, supplement overwrite, and relevant
review-only observations make the lineage unavailable. A cancelled lineage
cannot be revived. A review observation blocks only the target lineage it can
be tied to; an unrelated review record does not poison another issuer/form
root.

Existing Corporate Action/Listing Risk tables remain event-scoped. The Alert
consumer reads the lineage projection first and overlays the current fact on
the stable original event ID. Thus replacement changes the current value but
does not create a second Alert; supplement adds only a new fact identity; NOOP
and CANCEL add none. A missing original URL, issuer/CIK mismatch, or unavailable
event-to-source identity blocks all legacy-fact fallback and produces zero
Alerts. `not_applicable` is reserved for a verified root whose ledger proves no
amendment effect. Amendment trace fields stay in existing `ai_runs.metadata`;
the generic `ai_runs` schema and non-amendment logical job IDs are unchanged.

## Official isolated verification

The disposable 58321/58322 Supabase verification fetches official SEC
submissions and primary documents, seeds the exact filing ledger with official
acceptance timestamps, uses the production applicability reader, calls the
existing Corporate Action analyzer, persists through the existing typed path,
projects current state, evaluates one real saved Monitor condition, and invokes
the existing internal Alert consumer.

- Enveric Biosciences (`CIK 890821`): original 8-K
  `0001493152-25-003091`; amendment 8-K/A `0001493152-25-003676`. The amendment
  changes reverse-split adjusted trading from January 27 to January 29, 2025.
- Ostin Technology (`CIK 1803407`): original 6-K
  `0001213900-24-110728`; amendment 6-K/A `0001213900-24-112018`. The amendment
  changes the reverse-split effective date from December 26 to December 31,
  2024.

The actual Enveric Primary output was retained unchanged. Its original routed
to `corporate_action`; its amendment returned `monitor_routes: []` plus a
`clerical_correction` delta for `Item 5.03`. The bridge authorized the existing
Corporate Action analyzer only after the official amendment sentence, persisted
REPLACE observation, exact root event, and already-materialized root Corporate
Action fact all agreed. The default generic repository/processor and typed SQL
persistence then passed. The original created one internal Alert; amendment,
original replay, and concurrent amendment/root replay created zero more.

After the risk-status prompt's independent dual-route rule was made explicit,
the actual Ostin original Primary output retained `listing_risk` as its primary
event and routed both `listing_risk` and `corporate_action`. The amendment
returned `monitor_routes: []` plus a `clerical_correction` delta for
`effective_date`; neither output was rewritten. The exact Corporate Action
parent gate, existing analyzer, typed persistence, REPLACE lineage, current-state
projection, saved condition, internal Alert, and replay/concurrency dedupe all
passed. Both 8-K/A and 6-K/A form families therefore completed the same actual
end-to-end path on the isolated stack.

The official Enveric filing ledger did not establish a canonical security class,
so the production applicability reader correctly returned unavailable
security-class mapping and no stock-split execution side effect was materialized.
The harness deliberately does not fabricate a share-count anchor. Email and
Telegram delivery were never invoked, and the lineage architecture itself made
zero provider calls.
