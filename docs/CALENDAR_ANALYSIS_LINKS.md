# Calendar analysis links

Normalized Calendar events and SEC filing analyses remain separate records. The
`calendar_event_analysis_links` table stores only their relationship and minimal
matching evidence; it does not copy filing analysis text or Calendar provider
payloads.

## Matching contract

- An identical SEC accession number or explicit source event UUID is authoritative
  and produces an exact link.
- Deterministic rules score the remaining Company events. Scores of 90 or more are
  linked, scores from 70 through 89 remain candidates, and lower scores are not
  persisted automatically.
- Earnings require a trusted fiscal period in addition to issuer/date evidence.
  The FMP adapter's display-only quarter derived from the scheduled date is not a
  trusted fiscal period.
- Dividend matching distinguishes declaration, ex-dividend, record, and payment
  dates. Split matching requires the normalized ratio and effective date. IPO
  matching never auto-links from ticker and date alone.
- Amendments and other related filings remain attached. One linked analysis is the
  representative CTA, selected deterministically unless a manual primary exists.
- A filing that announces a future date does not change the Calendar event's
  lifecycle state.

The protected manual backfill endpoint is
`/api/sources/calendar-analysis-links/match`. `GET` is always dry-run. `POST`
also defaults to dry-run and persists only when `persist: true` is supplied with
valid `from` and `to` dates. It uses the existing source-ingest secret boundary,
returns aggregate matching statistics, and never returns raw matching evidence.

## UI and review state

Only a linked representative analysis exposes the canonical
`/filings/{analysis_event_id}` CTA. Additional linked analyses are shown as a
compact related count. `Analysis pending` is shown only when a stored candidate
exists and no linked analysis exists. The provider/agency/source URL remains a
separate source section.

Candidate rows intentionally do not trigger an LLM call in a request path. The
current shared AI pipeline is filing-analysis oriented rather than a queued,
idempotent relationship-review worker, so LLM or administrator review for the
70–89 band remains a follow-up. Any future reviewer must retain deterministic
evidence, may not link from LLM judgment alone, and must write through a
server-only path.
