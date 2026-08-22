# Level 2 Share Count Observation V1

The source-stated sidecar also emits the exact class kind `common_stock` when it
is safe to do so. Cross-source mapping and verified SEC acceptance-time rules are
defined in `share-count-resolver-input-contract-v1.md`; title/synonym matching and
published-time fallback are not permitted.

This feature adds one optional source-stated shares-outstanding sidecar to the
existing Level 2 domain analyzer calls. It does not add an analyzer, provider
call, repair, fallback, resolver, source priority, split adjustment, dilution
calculation, or current/latest selection.

## Eligible execution paths

- Offering Stage 2: `S-1`, `S-1/A`; the supported `S-3`/`F-3` family; and the
  supported `424B` family under the existing exact prompt/form guards.
- Generic SEC Monitor children: exact `8-K` and `6-K` Primary results routed to
  `listing_risk` and/or `corporate_action`. Amendments and other SEC forms stay
  outside this generic child path.

Offering has its own Stage 2 processor. Listing and Corporate Action share the
generic child processor. Each existing child makes one provider call. A filing
routed to both generic analyzers already creates two independent children; this
feature neither adds nor combines those calls.

## Provider and canonical boundaries

The optional root field is `share_count_observation`. It contains:

- `observation_type: source_stated`;
- an exact positive-integer `shares_outstanding` string;
- exact source-stated `as_of` date;
- sufficiently clear source-stated `security_class_title`;
- optional source-stated `basis`;
- one supplied `source_ref`; and
- compact contiguous `evidence` from that source document.

The LLM decides whether the text means shares outstanding and extracts the
count, date, and stated class. It must omit the sidecar for weighted-average,
authorized, issued-only, reserved, float, treasury, warrant/option exposure,
offering-size, approximate, missing-date, and class-ambiguous values.

Deterministic code removes the sidecar before the existing Offering, Listing,
or Corporate Action canonicalizer runs. It validates types, integer/date
shape, accession, SEC URL, source-ref membership, document identity, and exact
evidence containment. Sidecar validation never changes the domain result.

## Persistence

Eligible observations use the existing `public.share_count_history` table with
`source_type = sec_filing_text_level2` and
`observation_type = source_stated`. Existing authoritative XBRL rows retain
`source_type = sec_authoritative_os` and
`observation_type = authoritative_xbrl`.

The common unique source identity still includes `source_type`, so an XBRL row
and a filing-text row coexist even when issuer/date/value match. The Level 2
fact key is a deterministic hash of the exact source-stated candidate and
evidence. Replaying the same Level 2 source inserts zero rows. History readers
remain ordered observation readers only and expose no winner/latest/current
field.
