# Canonical Listing Status date review v1

Base: detached candidate `696be964f1d9cb481794dd3cef9b2a54c6a292e1`.

## Narrow contract

`/admin/data/listing-status?observationId=<id>` reuses existing admin page
authorization (`system.read`), mutation authorization (`data.run`), same-origin
checks, server session identity and the existing admin audit log. Data Operations
links to the review page. No new roles, account grants or public table access.

Only two date roles are reviewable: `notice_date` and
`suspension_effective_date`. Each requires an explicit exact date or `unknown`
with null value, a retained document reference/hash and verbatim passage.
An operator must determine the date's role from the source; the application
checks calendar format and quote/source integrity, not the operator's semantic
judgment. This is an attributed human assertion, not a new automatic verifier.

`sec_listing_status_date_reviews` holds append-only revisions, actor/role,
reason, observation/source version, previous decision, request ID and audit ID.
The narrow service-only RPC validates admin role, current source and Listing Risk
lineage through the existing official RPC. It locks the review stream, rejects
stale versions/revisions, and replays the same request ID only for the identical
payload. UPDATE/DELETE are denied; a withdrawal is another revision. Both roles
are reviewed explicitly on each revision, so no old field silently carries over.

`readReviewedSecListingObservation` calls the existing validating canonical
history reader, then returns `automatic`, `reviewedFacts`, `reviewStatus` and the
complete bounded decision history separately. Stale/invalid automatic evidence
or review evidence makes human facts unavailable, without deleting history.
No read writes data. The original source snapshot, model values and automatic
observation are never rewritten. The recorded review time is not backdated.

The existing as-of **status projector and Monitor are unchanged**. Date review
does not resolve security identity, establish a new event, infer ACTIVE, or turn
an unknown operative date into a suspension/removal state. Consumers needing
these reviewed dates use the explicit reviewed-observation reader; this v1 does
not silently override every existing status reader.

## Migrations

1. `20260930225206_sec_listing_status_date_review.sql`: review table, append-only
   protection and audited RPC.
2. `20260930230812_sec_listing_date_review_immutable_read.sql`: remove an
   unnecessary FOR SHARE lock on immutable automatic observations. The initial
   live write exposed PostgreSQL's UPDATE privilege requirement for this lock.
   The fix preserves the review advisory lock and does not broaden permissions.

Applied only to the existing isolated review DB, API `127.0.0.1:57321`,
Postgres `127.0.0.1:57322`, system identifier `7689949482832261158`.
No main/shared-local migration application is claimed.

## Real verification

Scorpius 8-K `0001079973-24-000891`, retained observation
`81501c23-b565-462c-ba42-0e2842b69991`:

- Existing Operations administrator reviewed the retained SEC text in Chrome
  and saved decision `56c82373-167d-4a14-a520-373b7f78084f`, revision 1.
- Notice/receipt = **2024-06-14**; suspension effective date = **unknown**.
- Original Listing Risk model date remains 2024-06-14. Automatic canonical
  suspension date remains null. Its unresolved security attachment is unchanged.
- Page refresh, official reviewed reader and history agree. Same request replay
  returns the same decision; repeated reads leave the decision count at one.
- Real API rejects anonymous (401), ordinary user (403), cross-origin (403)
  and stale revision (409). DB also rejects non-admin actors, stale versions,
  conflicting request replay, forged hashes and non-null unknown dates.
- Review UPDATE/DELETE and automatic observation UPDATE remain denied to the
  service role. Raw items, AI runs/outputs, events and automatic observations
  retain their exact pre-review row counts and hashes.
- Desktop, intermediate (853 CSS px) and 390 CSS px layouts inspected. Desktop
  and mobile readback screenshots saved; mobile controls stay within the viewport.
  Browser capture of the scrolled mobile form timed out (not claimed captured).
- The in-app browser's review POST returned 401 despite a preceding admin page
  load. Normal API authentication and the full Chrome UI path succeeded without
  account/auth changes; the in-app-browser-specific behavior was not diagnosed.

Evidence (outside Git):
`C:/Users/PC/.codex/visualizations/2026/10/01/listing-status-human-review/`.
Contains before/readback hashes, DB/API negative checks, screenshots and logs.
Intermediate screenshot width was measured as 853 CSS px; mobile as 390 CSS px.

Focused canonical/Form25 review/admin regressions: **99/99**. Full TypeScript
check and whitespace check run for this change. No LLM, ingest, Monitor or alert
execution. No semantic policy changes, original data deletion or source repair.

## Handoff boundary

Candidate-only. Local main ref at handoff:
`0b75ffcf573b64fcf030fde432d594bfa9f487ae`; cached origin/main:
`9c13aee7ef41b38bac0637e53e579633745effda`. Live GitHub main and Vercel deployment
are unverified; no equality, merge, push or deployment claim. The candidate's
pre-existing generated `next-env.d.ts` modification is retained outside the commit.
Unresolved identity remains a separate limitation, not something date review fixes.
