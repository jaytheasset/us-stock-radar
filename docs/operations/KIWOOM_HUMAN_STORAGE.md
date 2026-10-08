# Kiwoom human judgment persistence and admin connection

Candidate base: `d1c869f2c75d17d2585a50049ed39418377797ad`, detached `eeb4`.
Existing pure candidate linkage, human exception, automatic class-conflict guard,
SEC extraction and original Kiwoom reviews remain unchanged.

## Acceptance and scope

The existing `/admin/data/kiwoom-verification` page now loads an exact SEC
decision, displays its original state/reasons/values/source, accepts an independent
SEC human assertion, and selects an exact existing Kiwoom review/image/row.
Preview, append, historical read-back, new revision and withdrawal use the same
existing admin API. No new page or CSS. The ticker-resolution link is unchanged.

The button saves **human judgment and linked evidence**. It grants no ticker
authority, security identity approval or scheduled action. SEC exchange transfer
is SEC-only. Missing Kiwoom class/CIK/exchange remains missing. Account/settlement
date basis is not accepted by this storage path. Literal row transcription and
its human interpretation remain separate; no OCR, copied SEC assertion or LLM.

This task verifies API behavior in-process and database behavior on owned native
PostgreSQL. Actual browser interactions, real administrator login, AdminShell
session propagation, and full PostgREST E2E are **unverified**, explicitly deferred
by the user. Static component rendering is not represented as UI E2E or a merge
gate pass. No viewport or screenshot completion is claimed.

## Exact inputs and authority

`humanStorage.ts` reuses `readSecTickerResolutionByDecisionId`; it never selects a
similar ticker or substitutes a latest candidate. It reads/revalidates the exact
cover/raw source and candidate decision/revision hashes. The client sees visible
SEC text and chooses exact UTF-16 spans; field values are entered separately.

The input binds decision ID/content hash/candidate revision, SEC source identity
and hash, existing Kiwoom review ID/revision/snapshot/image, and exact row locator.
Human fields cannot supply actor, record IDs or timestamps. Server-generated
judgment IDs, predecessors and timestamps bind the assertion to the authenticated
session actor. The existing pure contract still says
`actor.provenance=caller_supplied_unverified` and `authentication=not_verified`:
that pure function has no authentication facility. Authentication is supplied by
the API session and recorded separately as `actor_user_id` and the audit record;
the pure result alone must never be advertised as authentication evidence.

Stored automatic evaluation, human assertion and Kiwoom transcription remain
separate, with `tickerAuthority: none`. No new copy of full SEC HTML or Kiwoom
image bytes is stored by this feature. Existing source/review records are read
only; the new records retain references, relevant exact quotes and comparison.

## Storage and transaction

Migration `20261008121100_kiwoom_human_comparisons.sql` follows existing
`20261008121000_kiwoom_ticker_evidence_reviews.sql` (CLI-created then ordered after
that dependency). It adds:

- `kiwoom_sec_human_judgments`: draft, separate judgment, revision/predecessor,
  decision/review references, actor, idempotency and judgment hash.
- `kiwoom_sec_human_comparisons`: one immutable comparison and hash per judgment.
- `admin_record_kiwoom_human_comparison`: one RPC transaction inserts judgment,
  comparison and existing `admin_audit_logs` record. Deferred reciprocal FKs and
  audit FK prevent orphaned records; any insert failure rolls back all three.

Existing role lookup allows operations/super_admin. RLS and explicit grants deny
anon/authenticated table reads/writes and RPC execution. Service role receives
SELECT/INSERT; append-only triggers also reject UPDATE/DELETE. No role grants or
write access are added to SEC source/decision/current tables. The security-invoker
RPC is a trusted server entrypoint; its service credential is never exposed to
the client. Source semantic correctness still requires human review.

Locks always follow request -> human case -> existing Kiwoom case. Unique keys
enforce `(actor, request)` and `(case, revision)`. Identical actor/request/body
returns the previous record, without new rows or claiming fresh verification.
Different body produces idempotency conflict; different requests at the same
expected revision yield one winner and one revision conflict. A reproduced race
where the original completed between replay lookup and revision lookup is fixed
by a second read for the same request on build failure, never another write.
The RPC independently handles concurrent replay and revision enforcement.

Amendments append a revision. Withdrawal appends the historical values and a new
withdrawn status/reason, without depending on publisher availability. A withdrawn
case cannot be appended again; a distinct case is explicit new work. Prior rows
are neither updated nor deleted. Withdrawal cannot change its original evidence.

## Current-state reads

Every current read reloads the selected judgment, latest case revision, exact
SEC candidate/source, saved Kiwoom review and latest review revision, then the
current publisher snapshot/image through the existing source loader. It reuses
the accepted pure comparison checker. A checksum alone is insufficient.

| Status | Meaning |
| --- | --- |
| current | Selected saved input references still match at check time; does **not** mean eligible, semantically correct or approved |
| stale | New human/review revision, changed source/candidate/image or invalidated input comparison |
| withdrawn | Latest human judgment or linked review case is withdrawn; historical match retained |
| unavailable | DB/upstream error, malformed response or insufficient current verification |
| not_found | Successful exact lookup found no requested judgment or required referenced record |

Stored history remains visible when available, even if current verification
fails. History lists do not claim current validity. API replay is historical.
UI edits clear the prior current-input label/comparison. Reload refuses silently
replacing saved candidate/review hashes. A save reports historical persistence
and offers explicit current recheck. Checks are point-in-time, not a distributed
lock against future publisher changes.

## API and permission checks

Existing GET/HEAD require `system.read`. Added GET modes are `candidate` (exact
decisionId), `human-history` (30 recent revisions) and `human` (exact judgment id).
POST `human-preview` and `human-save` require `data.run` plus existing same-origin
validation. Actor comes from the resolved session, request ID from `X-Request-Id`.
The body envelope rejects actor injection and unexpected fields. New POST modes
allow 65,536 bytes for bounded quotes; original review save stays at 16,384 bytes.
All routes preserve private/no-store and explicit failures. Current-read state
is in `data.status`; it is not collapsed into an empty history.

Actual existing role policy: support has neither `system.read` nor `data.run`,
and is denied. Operations/super_admin pass the relevant gates. The component also
renders disabled editing when supplied read-only access; no new role is created.

## Verification on 2026-10-08

Portable official PostgreSQL **17.11**, owned loopback cluster, random high port;
no installed service/Docker or shared environment. Existing role/audit DDL and
both actual Kiwoom migrations are applied. Other SEC dependency tables use
minimal fixture shapes. Real retained PSKY raw bytes pass through the existing
cover parser/evaluator and exact reader. Login IDs, role assignments and the
saved Kiwoom review are synthetic test metadata, not a real administrator review.
The SQL repository adapter exercises real PostgreSQL, **not PostgREST**.

Final receipt: external `human-storage/run12-final/postgres-result.json`, **24/24**
check groups, cleanup true. Tests cover atomic read-back on another connection,
replay/collision/two races/interleaving, injected comparison and audit failures,
role/direct-access denial, immutable history, source/row mismatch before save,
new revisions, unavailable vs absent, source/candidate/review/image changes,
transcription conflict, human withdrawal and original review withdrawal.

Reproduced/fixed during implementation: unnecessary `FOR SHARE` on immutable SEC
tables required UPDATE permission (removed without increasing grants); withdrawal
JSONB subtraction needed explicit parentheses; concurrent retry interleaving above.
The interleaving's failing receipt is `run10-race-before/postgres-result.json`.

PSKY result from actual retained sources:

| Input | Old / new / effective date / class |
| --- | --- |
| Automatic | PSKY / SKYD / null / B; REVIEW, EXCHANGE_CONFLICT and SUPPORTED_CHANGE_EVIDENCE_MISSING retained |
| SEC human | PSKY / SKYD / 2026-10-06 / B; separate occurred assertion with exact source quote |
| Kiwoom 4611 row | PSKY / SKYD / 2026-10-06 / null; row correspondence unconfirmed |

All three comparison fields match; assessment stays **ineligible** due to
unconfirmed row correspondence. SEC-only Nasdaq->NYSE is not added to Kiwoom.
Actual same-security identity/semantic confirmation is not granted. Stored
automatic payload and all nine retained JSON/HTML artifact hashes are unchanged.

Other results (do not sum repeated fixture modes as new unique tests):

- Kiwoom suite **50/50**: existing 43 plus 7 API/storage-envelope/render tests.
  Real route, auth gate, role policy and same-origin policy run with synthetic
  session/store adapters; no login or live source calls.
- SEC canonical **7/7**, exact persistence reader **6/6**.
- Human exception retained-source mode **15/15**, including A–E class controls:
  A remains eligible in its controlled fixture; B/C reject explicit class
  conflict; D/E preserve null and do not invent conflict. Actual PSKY remains
  ineligible. A real-reference but semantically wrong date remains an explicitly
  human-review-needed control; no semantic auto-detection claim.
- Full TypeScript and diffcheck pass. All tested ticker/current/Watchlist/Alert
  write calls **0**; unexpected write RPCs and fetch calls throw in the DB harness.
- All owned test connections/server/data directories cleaned up. Portable binary
  and receipts remain outside Git. No environment, shared DB, main/3110 or Docker
  changes. No migration applied outside owned temporary clusters.

Commands from candidate root (external receipt root shortened below):

```powershell
npm run verify:kiwoom-evidence
node --no-warnings --experimental-strip-types --test lib/sec-ticker-resolution/canonical.test.ts
node --no-warnings --import ./scripts/resolve-server-only.mjs --experimental-loader ./scripts/resolve-ts-paths.mjs --experimental-strip-types --test lib/sec-ticker-resolution/persistence.test.ts
$env:KIWOOM_HUMAN_TEST_DIR = 'C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/real-sec-link'
try { node --no-warnings --experimental-strip-types --test lib/ticker-verification/kiwoom/humanException.test.ts } finally { Remove-Item Env:KIWOOM_HUMAN_TEST_DIR }
node --no-warnings --experimental-strip-types scripts/verify-kiwoom-human-storage.mjs '<owned pgsql/bin>' '<retained real-sec-link>' '<new receipt directory>'
npx tsc --noEmit --incremental false
git diff --check
git diff --cached --check
```

The PostgreSQL script creates and deletes only its own marked cluster. It never
uses configured SQL/REST environment variables. Review the exact SQL/Auth/REST
target before any later migration or login test; prior target mismatch remains
unresolved. Actual full environment migration, browser/login/PostgREST behavior
and post-deployment behavior are not verified by this task.

Local main remains `d7347e4d2e75a5c412f69218003d2dfd407c79c5`.
GitHub/Vercel/shared DB/cron unqueried; equality and deployment not claimed.
Candidate implementation only; stop for GPT independent review. No merge/push/
deploy approval or complete ticker-change feature claim.
