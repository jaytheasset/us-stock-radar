# New-Listing Prospectus O/S Baseline V1

This contract seeds O/S for a newly listed U.S. common-stock issuer whose first
periodic filing is not yet available. It is deliberately narrower than generic
filing-text extraction and remains distinct from authoritative XBRL, Level 2,
and human-approved observations.

The production source is a stored final `424B4` primary document produced by
the existing SEC raw-ingest path. The deterministic verifier accepts only a
complete primary document that proves all of the following in source text:

- a finalized U.S. exchange and ticker listing;
- positive capital-structure evidence that the authorized stock consists of
  exactly one `Common Stock` class plus preferred stock, with no conflicting
  ADS/ADR, ordinary-share, or multi-common-class evidence; and
- one explicit positive-integer current O/S statement with an explicit
  calendar as-of date no later than the filing date.

Future, post-offering, pro-forma, assumed, projected, registered, or derived
share counts are retained as rejected evidence and never become current O/S.
Incomplete documents are not eligible. Definitive ADS/ordinary/multi-class
evidence produces `REVIEW`; other missing authority produces `NOT_VERIFIED`.
Both outcomes write zero history and zero universe rows.

An accepted decision has version `prospectus-text-os-baseline-v1`, source type
`sec_prospectus_text_authoritative_os`, and a complete-single universe version
`issuer-common-class-universe-prospectus-text-v1`. One transaction writes the
history observation and matching universe snapshot. Mixed insertion state
rolls back. Exact replay inserts zero rows. A pre-existing usable periodic
baseline skips both writes.

The seed is an incremental discovery boundary, not a periodic baseline. The
normal collector may therefore fetch only current Submissions after the seed's
SEC acceptance time. The first later eligible periodic filing writes the
unchanged authoritative-XBRL contracts and naturally wins event-time class
resolution by its later O/S as-of date. The prospectus row remains immutable
history and is never promoted, rewritten, or converted into XBRL authority.

The SEC source workflow invokes this verifier after raw persistence and before
ordinary filing analysis. Its result is returned separately. Verification or
persistence failure is fail-closed for O/S but does not suppress the existing
general SEC analysis path.
