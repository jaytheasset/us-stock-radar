# Level 2 Share Count Observation V1

The source-stated sidecar also emits the exact class kind `common_stock` when it
is safe to do so. Cross-source mapping and verified SEC acceptance-time rules are
defined in `share-count-resolver-input-contract-v1.md`; title/synonym matching and
published-time fallback are not permitted.

Generic 8-K/6-K domain analyzers may still return the optional source-stated
sidecar described below. Offering no longer asks Gemini for this field. Its
S-1/S-3/F-3/424B path is a separate deterministic processor over the complete
stored SEC primary document. The Offering processor adds no provider call,
repair, fallback, resolver priority, split adjustment, dilution calculation,
or current/latest selection.

## Eligible execution paths

- Offering deterministic processor: `S-1`, `S-1/A`; the supported `S-3`/`F-3`
  family; and the supported `424B` family under exact form and raw-item guards.
- Generic SEC Monitor children: exact `8-K` and `6-K` Primary results routed to
  `listing_risk` and/or `corporate_action`. Amendments and other SEC forms stay
  outside this generic child path.

Offering runs the deterministic processor as the only active processing step in
its durable child workflow. The legacy Offering Gemini Stage 2 normalizer and
its canonical/Matcher continuation remain in source and history but are not
called by product runtime. The job reaches `completed` after an eligible or
ineligible sidecar result, `failed` after a sidecar exception, and `stale` when
the exact Primary parent is no longer current. Listing and Corporate Action
share the generic child processor. Each existing child makes one provider call. A
filing routed to both generic analyzers already creates two independent
children; this feature neither adds nor combines those calls.

## Generic provider boundary

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

Deterministic code removes this field before the existing Listing or Corporate
Action canonicalizer runs. It validates types, integer/date shape, accession,
SEC URL, source-ref membership, document identity, and exact evidence
containment. Sidecar validation never changes the domain result.

## Offering deterministic boundary

The Offering processor reads only the exact stored `raw_items` row named by the
Offering job. It requires a complete, non-truncated `primary_document_html`, an
exact matching SEC archive URL and primary-document inventory entry, the exact
accession/form/CIK/filed date, and current parent-run authority both before
extraction and immediately before persistence.

Extraction accepts only a directly stated positive integer count for `common
stock` or `common shares` with an explicit calendar as-of date no later than
the filed date. It performs no arithmetic. Approximate, estimated,
weighted-average, authorized-only, issued-only, float, non-affiliate, future,
pro-forma, as-adjusted, offered, registered, issuable, reserved, ADS/ADR,
ordinary-share, and named or multiple common-class cases fail closed. When
multiple direct candidates exist, only the latest non-future date is eligible;
different values on that date produce no row.

The selected evidence is one contiguous normalized-primary-document clause and
the content hash covers the complete stored primary HTML. The processor has no
provider dependency, so it remains independently runnable when Offering Gemini
Stage 2 is unavailable.

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
