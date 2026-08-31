# Dilution Corporate Action Adjustment V1

## Boundary

This layer projects post-split terms for currently live Dilution Registry
instruments without changing reviewed historical snapshots. It handles only
`forward_split` and `reverse_split` executions returned by the official
`readStockSplitExecutions()` path. It does not parse, link, deduplicate,
supersede, or calculate a competing Corporate Action execution.

The existing registry schema could preserve point-in-time snapshots but could
not bind one adjusted field to an exact SEC contract clause or to the canonical
split execution that authorized the adjustment. V1 fills that narrow gap with
the append-only `dilution_corporate_action_clause_bindings` evidence table and
the append-only `dilution_corporate_action_adjustments` projection table.

## Production execution

There are two real product triggers. A successful Corporate Action child runs
the event adjustment hook after its terminal result is recorded, so the
official canonical reader can see that result. Registry Apply persists each
reviewed SEC clause binding and then runs the issuer adjustment hook. The
second trigger is necessary when a reviewed contract binding is added after a
split event has already completed. Both triggers call the same runtime, which
uses the default `readStockSplitExecutions()` implementation and the real
service-role RPCs; neither supplies a test execution reader.

The Registry Apply route is therefore the recovery path for event/binding
arrival in either order. Exact runtime replay is append-idempotent.

Clause bindings are a sidecar to the reviewed Registry payload, just like
`os_observations`. Registry Apply removes both top-level members before it
derives the Registry source digest and calls `apply_dilution_registry_v1`, then
persists the bindings independently. Adding, changing, or exactly replaying a
binding therefore cannot create a new Registry paste or Registry rows.

## Clause and calculation gate

The split ratio is never contract authority. Every adjusted field requires:

- one live instrument and immutable base snapshot;
- one exact `fse:v1` or `rse:v1` canonical execution for the same SEC issuer
  and canonical common-stock class;
- one explicit instrument/execution binding;
- one exact SEC Archives contract document;
- one field-specific evidence identity that verifies against the supplied
  cached source document; and
- the operation required for that field (`multiply_by_split_ratio` for
  share-denominated terms or `divide_by_split_ratio` for per-share prices).

Missing, duplicate, invalid, non-linkable, class-ambiguous, timing-indeterminate,
non-integral share, or non-terminating price evidence produces `REVIEW` with an
empty replacement. A snapshot whose latest status is `old` or `closed` is not
applicable.

The allowlist contains share/unit terms, potential shares, option/award units,
share reserves/caps, and conversion/exercise/floor prices. Dollar amounts,
commitments, proceeds, interest, and generic capacity fields are not on the
allowlist and cannot be overlaid by either the application reader or the append
RPC.

## Append-only lifecycle and reader

`binding_id` is a deterministic SHA-256 identity over the instrument,
canonical execution, SEC raw item/document, and exact field evidence. The
binding row references the stored `raw_items` document; source text is read
from that exact cached SEC record instead of being copied into Registry JSON.

`projection_id` is a deterministic SHA-256 identity over the base snapshot,
active execution set, field results, and exact contract evidence. Exact replay
returns `already_saved` and adds zero rows. A later canonical replacement or
conflict appends a new projection with one `supersedes_projection_id` edge.
The prior row and original registry snapshot remain historical.

The Dilution Registry reader selects only one unsuperseded projection whose
`base_snapshot_id` is the instrument's latest current snapshot. An `APPLIED`
projection overlays only allowlisted fields. A `REVIEW`, invalid projection, or
multiple current branches returns the unadjusted reviewed terms with Review
metadata; it never guesses a replacement.

The table has RLS enabled. Browser roles have no access. `service_role` may
select and insert but cannot update or delete; the append function is
`SECURITY INVOKER` with an empty `search_path`.

## Official SEC acceptance cases

### Forward split — Chipotle Mexican Grill, Inc. (`0001058090`)

- Split source: Form 8-K, accession `0001058090-24-000024`, 50-for-1 trading on
  a split-adjusted basis June 26, 2024:
  <https://www.sec.gov/Archives/edgar/data/1058090/000105809024000024/cmg-20240606.htm>
- Contract source: 2022 DEF 14A, accession `0001140361-22-012495`, Appendix A
  requires appropriate adjustment of plan shares, outstanding award shares,
  and exercise/base prices:
  <https://www.sec.gov/Archives/edgar/data/1058090/000114036122012495/ny20002259x1_def14a.htm>
- Live pre-split SOSAR state: Q1 2024 Form 10-Q, accession
  `0001058090-24-000015`, reports 304,000 outstanding units at a $1,526.40
  weighted-average exercise price:
  <https://www.sec.gov/Archives/edgar/data/1058090/000105809024000015/cmg-20240331.htm>
- Exact fixture outputs:
  - plan reserve `2,431,419 -> 121,570,950`;
  - Q1 SOSAR units `304,000 -> 15,200,000`;
  - weighted-average SOSAR exercise price `$1,526.40 -> $30.528`;
  - supplied dollar amount unchanged.

### Reverse split — TransCode Therapeutics, Inc. (`0001829635`)

- Split source: Form 8-K, accession `0001104659-24-004094`, 1-for-40 effective
  January 16, 2024:
  <https://www.sec.gov/Archives/edgar/data/1829635/000110465924004094/tm243329d1_8k.htm>
- Live pre-split terms and contract: December 2023 Form 8-K/exhibit, accession
  `0001104659-23-123274`, 300,000 placement-agent warrant shares at $0.3025;
  the exhibit proportionately adjusts warrant shares and inversely adjusts the
  exercise price:
  <https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm>
- Exact fixture outputs:
  - remaining warrant shares `300,000 -> 7,500`;
  - exercise price `$0.3025 -> $12.10`;
  - aggregate dollar exercise amount `$90,750` unchanged.
- Post-split corroboration: the January 2024 Form S-1/A, accession
  `0001104659-24-004721`, reports the same placement-agent warrant as 7,500
  shares at $12.10:
  <https://www.sec.gov/Archives/edgar/data/1829635/000110465924004721/tm2333928-7_s1a.htm>

The deterministic unit fixtures make no SEC, provider, LLM, ingest, scheduler,
or database call. The separate isolated product-path acceptance script fetches
the four exact accessions above through the SEC parser, persists the complete
stored documents and canonical results into a disposable full Supabase stack,
runs Registry Apply and the production adjustment runtime without an injected
execution reader, and reads the result through `fetchStockDilution()`. It also
checks exact replay, invalid binding rejection, tampered evidence, ambiguous
bindings, and a closed-instrument control. It refuses shared Supabase ports.
