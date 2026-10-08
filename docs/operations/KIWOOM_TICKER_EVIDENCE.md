# Kiwoom bulletin evidence for US ticker verification

Separate SEC-source human judgments (automatic candidate preserved):
[contract and actual-source validation](KIWOOM_HUMAN_EXCEPTION.md).

## Candidate-to-evidence pure linkage — follow-up after d385bc8f

This is a separate, opt-in pure contract in `candidateLink.ts`, not a rerun of
the prior UI/login work. Base: `d385bc8f4ad1abf82275bb4a3293a984a397b648`,
existing detached `eeb4`. No UI, API, repository, migration, environment file,
existing SEC resolution, or production caller was changed.

### Existing candidate and linkage contract

- Reuses `SecTickerResolutionEvaluation` from the existing canonical evaluator
  (or its replay-validated reader), with `decision.id`, `decision_sha256`,
  exact accession/source hash, issuer CIK, resolution state and summary.
  This existing contract represents **same-security ticker-change candidates**;
  it is not a generic corporate-action candidate store. No new listing,
  delisting, merger or split resolution system was invented.
- `candidateRevision()` checks decision-payload hash and summary consistency;
  a digest of the full evaluation binds the particular input/source revision.
  The adapter expects already validated input; it does not re-read SEC source
  bytes or replace the existing SEC validator.
- `ManualKiwoomRow` retains literal source cells separately from manually
  transcribed values, market/event/date basis and any additional changes. It
  binds candidate revision, existing review ID/case/revision, notice ID,
  snapshot hash, image hash and exact proof locator. The reviewer must explicitly
  identify correspondence of this row with this candidate. This is **not** an
  assertion of legal security continuity. Broker account dates are excluded.
- `createCandidateEvidenceLink()` preserves candidate values and observed values
  separately, with per-field `match / conflict / unconfirmed` and an aggregate
  comparison. Existing `ReviewDraft.facts` are candidate assertions, never the
  independently observed row; they must agree with the linked candidate values.
  The saved human verdict cannot turn conflicting transcribed values into a
  match. Neither value set is corrected or overwritten.
- A match compares old ticker, new ticker and calendar effective date only.
  `market_open` precision is retained, not upgraded to an intraday confirmation.
  Explicit type/class disagreement conflicts; unreported type/class remains
  unknown and is not inferred from names or ticker spelling. A match with
  unknown class therefore confirms only the three compared values, **not** class
  or identity. Exact row correspondence still requires human confirmation.
- Non-US/unconfirmed rows, compound events, unknown/broker date basis and
  withdrawn/unclear reviews cannot produce an aggregate match. Known related
  changes (ISIN, reverse split, exchange change, etc.) are retained as manual
  observations and make this narrow comparison unconfirmed. No fuzzy names,
  country inference, continuity inference or corporate-action calculation.
- Every link has `supporting_evidence_only`, `tickerAuthority: none` and scope
  `candidate_field_comparison_not_security_identity`. A SEC REVIEW/UNRESOLVED
  candidate remains in that state regardless of these field comparisons.

### Revision/invalidation boundary

`checkCandidateEvidenceLink()` requires explicitly supplied **current**
evaluation, snapshot, saved review and transcribed row. Missing/unreadable
inputs fail closed; the pure helper cannot discover whether the caller passed
the latest record. Changed candidate/source revision, notice HTML or image,
review revision/case, withdrawal or edited transcription makes the previous
link non-reusable and currently unconfirmed. It replays the comparison rather
than trusting stored status. Historical link/value records remain untouched.
An unchanged source captured at a later time does not invalidate the source.

Link hashes are deterministic integrity checks, not signatures or administrator
authentication. A future authorized integration must supply the current records
and record explicit new manual associations, not relabel old objects as current.
This task adds no persistence for links or automatic current-reader wiring.
Transcription correctness is still a human responsibility: a valid image hash
proves reference integrity, not the meaning of pixels or accuracy of typed text.

### Preserved-source samples and results

Manually inspected retained notice 4611, image 1 (880 × 1536). Its snapshot and
image hashes are recorded in `candidateLink.samples.ts`; full source/image bytes
remain outside Git. No live fetch, OCR or extraction-model call occurred.
Year comes from the table's `효력일 (2026)` header and day from the exact merged
date cell, not the notice posting date, coverage range or account guidance.
The WALDW security-name cell visibly cuts off; its fixture retains that cutoff.

**All SEC candidates, row-correspondence assertions and saved administrator
reviews in these tests are synthetic.** The Kiwoom row transcriptions are from
the preserved original. This is not confirmation of actual SEC→Kiwoom pairs,
real authenticated reviews, or current market ticker identities.

| Source row / synthetic comparison | Result | Reason |
| --- | --- | --- |
| PSKY → SKYD, 2026-10-06 | match | Three field values agree; identity not asserted |
| Same source vs candidate PSKY → WRONG | conflict | New ticker differs; both values retained |
| Same source vs candidate date 2026-10-07 | conflict | Effective date differs |
| VACI → NSTR, 2026-10-02 | unconfirmed | Source also says ISIN change |
| VTAK → VJET, 2026-10-05 | unconfirmed | Reverse split plus symbol change |
| WALD → WALDF, 2026-10-05 | unconfirmed | Also NYSE → OTC |
| Adjacent WALDW → WALWF against WALD candidate | unconfirmed | Different security row plus exchange change; ticker fields conflict |
| HK 08026 → 08583 | unconfirmed | Non-US and reverse split; not a US candidate match |
| AETH liquidation delisting | unconfirmed | Different event, no new ticker; no fabricated successor |

Additional controls cover omitted values, different share class/warrant,
account/unknown dates, wrong image/locator/review/case, candidate values/source
amendment, notice HTML/image-only update, withdrawal/new review revision, missing
current inputs, edited transcription, corrupt data and retained historical
records. These are controlled mutations, not claims of real publisher changes.

### Verification and handoff

- New pure tests: **15/15**, both synthetic-snapshot mode and retained-original
  mode. Retained-original receipt:
  `C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/candidate-link/retained-source-tests.log`.
- Existing canonical SEC regression: **7/7**. Existing Kiwoom source/review
  regression: **13/13**. The normal Kiwoom verification script now includes
  the 15 linkage tests (**28 total**). No browser/login checks repeated.
- Commands: `npm run verify:kiwoom-evidence`;
  `node --no-warnings --experimental-strip-types --test lib/sec-ticker-resolution/canonical.test.ts`;
  `npx tsc --noEmit --incremental false`; `git diff --check`.
- For retained-source reproduction, set **process-only**
  `KIWOOM_LINK_TEST_SNAPSHOT` to the existing `live-snapshot.json` absolute path,
  run `node --no-warnings --experimental-strip-types --test lib/ticker-verification/kiwoom/candidateLink.test.ts`,
  then remove that test-process variable. The test checks the expected source
  and image hashes before comparing. No product environment file changes.
- No DB/network integration, current-record orchestration, authenticated link
  persistence, live-source freshness or ticker mutation tested/implemented.
  Existing UI/login/environment limits below remain unchanged and were not
  re-investigated. No main/3110 operation, merge/push/deploy or automation.
- Worktree completion is limited to pure linkage and offline regression; stop
  for GPT independent review. Local `refs/heads/main`, read from this candidate,
  is `d7347e4d2e75a5c412f69218003d2dfd407c79c5` (no main workspace command).
  GitHub main/Vercel and DB/cron state are unqueried;
  there is no synchronization/deployment claim.

## Scope and acceptance

User request: make Kiwoom Securities' overseas-stock bulletin notices one supporting verification source. Stock Radar serves US customers. Kiwoom account posting, settlement and broker-specific trading restrictions must not determine market-effective dates or US ticker identity.

Implemented admin page: `/admin/data/kiwoom-verification`, linked from the existing ticker-resolution page and Data Operations menu. Read permission is `system.read`; recording a review requires `data.run`, a same-origin request and the authenticated server-side actor. No public/customer-facing source page, ticker publisher, market-data refresh, automatic collection or LLM/OCR call was added.

The page supports loading official notices or an exact known notice number, inspecting the captured original image at fit/original size, manually recording a US security candidate and a `supports` / `conflicts` / `unclear` assessment, adding revisions, rechecking publisher changes, and withdrawing an earlier assessment.

`supports` means only that the operator judged this Kiwoom notice to support the entered candidate. It is NOT an approval of a security conversion, same-security alias, listing or production ticker mutation. Every saved row has `ticker_authority='none'`; no existing ticker-resolution rules were relaxed.

## Source adapter

- Public board: `https://www.kiwoom.com/h/common/bbs/VBbsBoardBWGCZView?dummyVal=0`.
- Fixed public list method: `https://bbn.kiwoom.com/bbs/SBbsBoardBWGCZListAjax`.
- Official rows require numeric `step=0` and `scrnTp=NWGCZ`. Customer posts are discarded, not stored/rendered. Author names and keywords do not establish authority.
- Exact detail method: `SBbsNoticeBWGCZDetailAjax`, with matching ID and `scrnTp=NWGCZ`.
- Images are limited to the same-origin `VBbsNoticeImageView` path, one valid `apndnm` argument and PNG/JPEG bytes. Redirects/arbitrary URLs are rejected.
- One 15-second deadline covers headers, body and all images. Limits: JSON 1 MB, each image 2 MB, three images. No automatic retries.
- Nonempty attachments or unsupported images fail explicitly. Missing data is not an empty successful notice.
- Snapshot hashing includes stable metadata, retained HTML and image URL/hash/MIME. Capture time/read counts do not alter identity. Image-only updates change the hash.
- One board page is not a complete corporate-action/IPO universe. Weekly coverage dates and review timestamps are not market effective dates.

The original source is retained as evidence. Publisher HTML is not directly rendered. The UI text preview excludes broker/account guidance; such text is rejected as a supporting market-event quote. A human must confirm the US market row for supporting/conflicting assertions. Original images can contain other countries' rows and are not automatically interpreted.

## Storage and safety boundary

Migration: `20261008121000_kiwoom_ticker_evidence_reviews.sql`.

One append-only table stores the reviewed candidate, captured notice/image bytes, content hash, actor, request identity and revision. The existing `admin_audit_logs` entry is inserted atomically with the review. Existing `private.admin_actor_role` performs the database role check. Anonymous/authenticated database roles cannot read/write/execute; service role can select/insert, not update/delete. A trigger also prohibits rewriting/deleting history.

A new assessment re-fetches the notice and images before saving. Hash mismatch returns `KIWOOM_SOURCE_CHANGED` before any review write. A saved assessment is historical evidence, not permanent live confirmation. Source recheck reports same/changed without silently reapproving a changed notice.

Idempotency: `(actor_user_id, request_id)`. Same-body retries return the original result without another source fetch; reuse for different data fails. Case-revision checks and transaction locks prevent concurrent decisions advancing the same revision twice. Withdrawal uses retained evidence and works during an upstream outage.

Proof validation establishes that an image/excerpt belongs to the captured notice, not that the human's interpretation is correct. The tests deliberately retain a semantic-error control which passes reference validation. It still has no ticker authority. No source/service/migration path writes to ticker/current/Watchlist/Alert tables.

## Prior isolated verification (before Codex follow-up)

- `npm run verify:kiwoom-evidence`: 12 tests. Includes a real localhost stalled-body timeout of about 15.04 seconds, one request, no retry.
- PostgreSQL: 18 checks in one owned temporary DB. Actual feature migration and existing role/audit DDL, minimal synthetic auth/users dependencies. Real service-role save/reconnect read-back, two-connection same-request and revision races, request collision, withdrawal, audit rollback, actor/RLS denial, update/delete rejection. The DB and connections were removed afterward.
- Product source adapter: real list, notice 4611 and original image (three requests in this harness, separate from preliminary inspection). The notice covers 2026-10-05 through 2026-10-12. Stored QA candidate was synthetic/unclear, not an asserted source-row fact.
- Actual API handlers and auth helpers: unauthenticated GET/HEAD/POST and cross-origin POST denied; four checks, no external calls.
- Actual component/CSS in an external Next + Edge fixture: 1440/900/390px. API responses and role were fixtures; original notice image came from the live capture. Load/review request, changed-source warning, read-only controls, error states and overflow checked. No pageerror; three deliberate upstream-502 console entries.
- Existing admin/ticker regression: exact menu expectation updated to include the newly authorized page. Final logs record typecheck and regression results.

The UI fixture is NOT a successful real admin login, full application-shell test or integrated PostgREST/Next/DB E2E. Those remain required before merge/activation. The migration has NOT been applied to the shared development or production DB. Missing store/schema must remain unavailable; never fall back to another database.

## State and reproduction

Existing `eeb4` candidate was fast-forwarded from `270ea63d719305def1d627683031800fb28cbbc6` to integrated local main `d7347e4d2e75a5c412f69218003d2dfd407c79c5` before edits. No branch switch, new worktree, or main mutation. Main's existing `next-env.d.ts` bytes are preserved.

External harnesses, captures and results:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008`.

Key records: `postgres-result.json`, `api-denials.json`, `browser-result.json`, `unit.log`, `regression.log`, `typecheck.log`, `live-snapshot.json`, `ui-1440.png`, `ui-900.png`, `ui-390.png`. Source bytes/images remain outside Git.

GitHub main and Vercel were not queried; no synchronization/deployment claim. No main merge, push, deploy, scheduler change, shared-data write or 3110 operation. Public redistribution rights and all-market source coverage are not established; internal verification only.

## Codex follow-up — 2026-10-08 (KST)

The user explicitly deferred DB application and real-login E2E until the target
is established. This follow-up completed code review, isolated regression and
two reproduced UI fixes. It is **not merge-ready full-product acceptance**.
All 16 intended uncommitted files were preserved and reviewed at base
`d7347e4d2e75a5c412f69218003d2dfd407c79c5`; no old-HEAD reset or branch change.

### Reproduced and fixed

1. After saving a review, opening another notice retained the previous case,
   revision, saved record, candidate and proof locator. Reproduced at all three
   widths. An explicit notice open now starts a fresh review case and clears
   those inputs. Open saved review/recheck remain the revision workflow.
2. Rechecking changed publisher content and then withdrawing sent the newly
   viewed source hash against the old retained assessment; the existing service
   correctly rejected it. Reproduced at all three widths. The UI now retains
   the exact selected `SavedReview`; withdrawal restores its source/candidate/
   proof and sends its revision with the new withdrawal reason. Candidate/proof
   editing is disabled for withdrawal. No second withdrawal option is offered
   for an already withdrawn selected record. Proof-image controls are also
   locked during a save, so a pending request cannot visually switch evidence.

Only `KiwoomTickerVerification.tsx`, its direct service regression test file and
this document changed relative to the handed-off implementation. Source adapter,
API, service, storage, migration, existing ticker paths and permissions were not
redesigned. Withdrawal still relies on the original service revision guards and
retained evidence; no upstream availability requirement or ticker authority was
introduced.

### Direct checks in this follow-up

- `npm run verify:kiwoom-evidence`: **13/13**, including a new changed-source /
  edited-candidate withdrawal regression. Actual localhost stalled-body deadline:
  approximately **15.027s**, one request, no retry.
- Existing admin/ticker/header suite: **64/64** using `adminFoundation`,
  `canonical`, `persistence`, `productProjection`, `publicTickerSearch`,
  `readSurface`, and `stockHeaderSecIdentity` test files. Additional stable-
  identity/client regression checks also passed. No product data writes.
- Actual API handler/auth helper denial checks: **4/4**, GET/HEAD/POST without a
  session and cross-origin POST; network calls zero. No successful login claim.
- Browser: actual current component/CSS in the original external Next/Edge
  fixture, with cached source image and injected API/role, **27 check groups**
  across **1440/900/390px**, all passed. Includes original 880px image rendering
  with internal scroll (panel widths 713/824/326px), no page horizontal overflow,
  case reset, historical withdrawal after changed source, double-click single
  request, retry with the same request ID/body, locked image selection while
  saving, revision conflict, source-change rejection, read-only controls and
  upstream error. Captures were visually inspected. Page errors zero; 12
  deliberate browser errors correspond to injected network/409/502 scenarios.
  This validates client behavior against controlled responses, not DB writes.
- Full `npx tsc --noEmit --incremental false`, script syntax, and diff checks pass.
- **No DB connections, SQL application, new live Kiwoom, paid API, OCR or LLM
  requests in this follow-up.** Prior PostgreSQL 18-check receipt is retained as
  prior evidence, not rerun or relabeled. Migration SHA-256 still equals that
  receipt: `43c266312a0a6ca18d98c91684332d8b1606391b97db266ab9b761f4fe76b244`.

New receipts/harness/captures are outside Git, under the existing verification
directory's `codex-followup/`: `before-2/browser-result.json` records both
pre-fix failures; `after-accepted/browser-result.json` records all 27 groups;
`verify-ui.cjs` reuses the prior external harness without overwriting its logs;
`api-denials.json` records this run's handler checks. Intermediate harness
failures from exact label matching are retained separately; they are not
counted as product defects or acceptance passes. The prior source captures and
FINAL-CHECK.json were not overwritten.

### Environment blocker and required next approval

Read-only inspection confirmed the candidate has no `.env.local` and no
Supabase configuration in the verification process. Main settings identify a
**LAN REST/Auth endpoint on port 56321**, while SQL points to
**`aws-1-us-east-1.pooler.supabase.com:5432/postgres`**. These cannot be treated
as one verified database. The LAN address is deliberately not committed.
No remote/shared DB/schema/role state was queried or inferred from this.

Before full E2E, identify and approve one matching REST/Auth + SQL target and an
existing authorized administrator login. Verify that target's identity and
existing admin role/audit dependencies, then obtain approval for applying only
`20261008121000_kiwoom_ticker_evidence_reviews.sql` there. It adds the evidence
table, index, append-only trigger and audited RPC/service-role grants; it does
not write current tickers or same-security mappings. SQL migration availability
must also be confirmed through that target's real PostgREST table/RPC surface.
Use explicitly selected process configuration for a candidate server, never a
whole environment-file copy or the unrelated remote SQL URL by assumption.

Still unverified: actual administrator login, candidate app/AdminShell at the
three widths, authenticated API→PostgREST→DB save/read/revision/withdrawal, real
DB-target alignment and production deployment. No account creation, cookie
extraction, authentication bypass or shared migration was performed. Main,
3110, environment files, Docker and automatic jobs were untouched. Only owned
fixture servers were started/stopped. Stop for independent GPT review.
