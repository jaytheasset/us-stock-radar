# SEC O/S Production Collection V1

This collector is the official issuer/CIK execution path that composes the
locked SEC Structured Data, O/S Candidate, Filing XBRL Context, Authoritative
O/S Extraction, Share Count History, and Common-Class Universe foundations. It adds no parser,
semantic resolver, storage model, scheduler, current-O/S selection, split
adjustment, dilution calculation, or LLM call.

## Production flow

```text
SEC Submissions + CompanyFacts
  -> SecStructuredDataService.ingestIssuer({ cik, mode })
  -> readOsCandidates()
  -> exact accession + filing-ledger identity
  -> SecFilingXbrlContextService.ingestFiling()
  -> readOsCandidateFilingContexts()
  -> resolveAuthoritativeOsFromFiling()
  -> writeIssuerCommonClassUniverseSnapshot()
       (COMPLETE_SINGLE / COMPLETE_MULTI / INCOMPLETE / AMBIGUOUS)
  -> COMPLETE_MULTI V2 only -> writeCompleteMultiClassShareCountObservations()
       (class facts only; aggregate is corroboration)
  -> ELIGIBLE only -> writeAuthoritativeShareCountObservation()
```

Universe promotion and O/S history persistence intentionally have different
eligibility boundaries. Every valid filing-level authoritative decision is
promoted through the existing deterministic universe writer, including
`INCOMPLETE` and `AMBIGUOUS` snapshots. This prevents a newer unresolved filing
from silently falling back to an older complete class universe. Share Count
History accepts either the existing direct `ELIGIBLE` authoritative O/S or the
specialized class observations from a persisted V2 `COMPLETE_MULTI` snapshot.
The latter requires one exact domestic filing, a US-GAAP common-stock aggregate
candidate, a complete source-backed class set, and an exact aggregate/class
sum. A universe-persistence failure blocks that specialized history write.

`SecOsProductionCollector.collectIssuer()` is the single issuer contract for
`bootstrap`, `backfill`, and `incremental`. `collectBatch()` runs the same
contract sequentially per CIK and preserves an independent result when another
issuer fails. `createSecOsProductionCollector()` is the official future
production scheduler/backfill entry point: it accepts a SQL client, the
required SEC User-Agent identity, and optional request-policy/clock injection.
No scheduler or cron is enabled by this foundation.

## Submissions and CompanyFacts roles

Submissions supplies issuer/ticker observations and the accession-keyed filing
ledger, including form, filed date, optional acceptance timestamp, primary
document, and XBRL flags. Bootstrap and backfill fetch the current Submissions
document plus only the historical files named by it. Incremental fetches only
the current Submissions document.

CompanyFacts supplies exact normalized discovery facts and source provenance.
The collector does not treat its implicit context as a security class. It uses
the existing candidate extractor, so only supported facts become filing-context
candidates. Current CompanyFacts is fetched on every mode because the SEC
publishes it as an issuer snapshot; raw snapshot and fact identities make
unchanged content and exact fact tuples dedupe at the repository boundary.

The result reports each source's `fetched`, `updated` (new content snapshot),
and `unchanged` counts. Source fetch/ingest time never replaces `as_of`,
`filed_date`, or `accepted_at`.

## Filing XBRL fetch and cache rule

Filing-level XBRL/IXDS is considered only after CompanyFacts produces an O/S
candidate. Candidates are grouped by accession, so one filing is fetched at
most once per issuer run. The filing ledger must match the candidate's CIK,
accession, form, filed date, accepted timestamp, source kind, and raw-source
identity exactly.

`SecFilingXbrlContextService.ingestFiling()` applies the existing shared cache
completeness validator before any request. A complete cached filing is a cache
hit and performs zero SEC requests. A missing or incomplete cache is fetched;
incomplete primary IXDS membership remains unavailable and is never parsed as
authoritative. Exact replay therefore reuses every complete accession while an
incomplete accession may be retried and remains fail-closed.

## SEC request policy

The structured JSON and filing clients use one shared `SecRequestPolicy` in the
production factory. It preserves a caller-supplied organization/contact
User-Agent and serializes all SEC traffic at a default 125 ms minimum interval
(8 requests/second). Retry is capped at three attempts and applies only to
network failures, HTTP 429, and HTTP 500/502/503/504. Backoff is bounded
exponential, honors `Retry-After` up to 30 seconds, and retains the final HTTP
status or explicit network error. HTTP 4xx other than 429, malformed JSON,
XBRL parse/completeness failures, and semantic decisions are never retried by
the transport policy.

This follows the SEC's current primary guidance for the
[Submissions and CompanyFacts APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
and its [fair-access limit of no more than 10 requests per second](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits).

## Deterministic result and failure isolation

Every issuer result includes:

- Submissions and CompanyFacts fetched/updated counts;
- O/S candidates and unique filing contexts required;
- SEC filing fetches and complete-cache hits;
- eligible, persisted, and duplicate observation counts;
- evaluated, inserted, duplicate, incomplete, and ambiguous universe snapshot counts;
- existing O/S candidate-extraction rejections with exact CompanyFacts keys;
- accession-level filing outcomes;
- decision status/reason and canonical stored identity; and
- sorted issue details and reason counts.

Operational reasons distinguish SEC fetch failure, SEC rate limit, SEC network
failure, malformed source, incomplete IXDS, filing context unavailable, DB read
failure, and DB persistence failure. `NON_ELIGIBLE_OS` separately preserves the
official authoritative reason. A candidate/filing failure does not stop other
candidates, and an issuer failure does not stop an independent batch issuer.
There is no fallback, inferred correction, winner selection, or semantic
promotion.

## Incremental and replay behavior

The collector reuses existing raw-source, fact, accession, filing-artifact,
Share Count History, and universe snapshot identities. Incremental mode skips historical Submissions
files. Complete filing caches are not downloaded again. The history writer's
canonical identity and the universe writer's deterministic source hash remain
the final concurrency/idempotency boundaries, so an exact replay inserts zero
rows and reports duplicates. New execution time is
used only as history `ingested_at`; source timestamps and filing provenance are
preserved unchanged.

## Local five-issuer acceptance

`npm run verify:sec-os-production-collection:local` uses the existing audited
SEC identities and minimal structural fixture documents. It runs inside one
local-Postgres transaction and rolls back all fixture rows.

| Representative | Issuer | Expected production result |
| --- | --- | --- |
| Ordinary single class | AAPL / `0000320193` | `ELIGIBLE`, one history row |
| Small-cap amendment | NEOM / `0001022701` | `ELIGIBLE`, one history row |
| Multi-class | GOOG / `0001652044` | parent `REQUIRES_FURTHER_CONTEXT`; V2 `COMPLETE_MULTI`; three class rows |
| Foreign/ADR | WIT / `0001123799` | `REQUIRES_FURTHER_CONTEXT`, no row |
| Incomplete negative control | ARM / `0001973239` | incomplete IXDS, `UNAVAILABLE`, no row |

The acceptance asserts the exact five audited observations (two single-class
and three multi-class rows), V2 universe outcomes (two complete single-class,
one complete multi-class, and two ambiguous), replay persistence of zero with
history and universe duplicates, complete-cache reuse where available, zero
public SEC requests, zero LLM/Gemini calls, and zero fixture changes after
rollback. It isolates each fixture by exact accession and O/S as-of so retained
live-validation history in the shared local database cannot contaminate it.

`npm run verify:live-multi-class-os-production-path:local` is the retained-data
acceptance. It uses the existing local Alphabet CompanyFacts, filing ledger,
and filing-XBRL cache, blocks/counts any attempted SEC filing request, executes
the production collector twice, and verifies the event-time universe reader,
class resolver, no-lookahead behavior, and issuer-total aggregator at two real
filing timepoints.
