# Source-backed O/S observation corrections — candidate

Base: `162edd9c46759226486ac9ec12fad86754a1378d`.

## Existing administrator journey

Use `/admin/data/dilution-registry`, search an exact accession, and open
`?observation=<share_count_history ID>`. A selected O/S Snapshot links to this
same page with its exact run filter. The existing manual JSON upload remains on
the page and retains its Preview / Apply / Registry-only / partial-result contract.

The observation detail displays the original quantity/date, effective
quantity/date, fixed class, retained SEC text and hash, latest correction and
append-only history. A correction requires a quantity, as-of date, exact excerpt,
and reason; Preview precedes Save in the UI. Withdrawal also requires a reason
and preview. The original observation and any AI JSON remain unchanged.

Only existing `data.read` / `data.run` authorization is used. Operations and
super_admin are the existing writing roles. The API obtains the actor from the
authenticated session and rejects client actor/issuer/class/unit fields. The
database checks the actor's active role independently. Same-origin checks and
private, no-store responses apply to the existing administrator API boundary.

## Fixed scope and source checks

This version supports exact mapped **single common-stock** observations with
an exact SEC filing-ledger acceptance and a retained original document. A
quantity/date correction must pass the **unchanged** manual O/S semantic verifier
against that document and the existing common-class universe reader. A
source-stated observation retains its exact original class title. This does not
add ordinary/ADS conversion, named-class mapping, aggregation, inferred dates,
market fallbacks, or correction of extraction outputs.

The observation ID/hash, source binding hash and expected revision accompany
every preview/save. The source binding includes the original observation,
document, filing ledger, relevant class-universe support and, for Snapshot
observations, the current run/output/parent/decision identity. Missing, changed,
held, rejected or replaced automatic sources cannot retain an effective
correction. A later decision is never inherited by a replacement observation.

## Storage and official reads

`share_count_observation_corrections` stores `correct` and `revoke` decisions.
Every decision records the observation, revision, original/source hashes,
quantity/date/evidence where applicable, reason, authenticated actor, request
identity/hash, and timestamp. The table is append-only and inaccessible to anon
and authenticated database roles; only the authorized server uses its RPCs.

The append RPC serializes the request and observation with transaction advisory
locks. It does not require granting UPDATE on immutable source tables. Same
request and content is a no-op; reused request identities with different content
and stale revisions conflict. Source checks are repeated at save and read time.

The existing `share_count_history_eligible` view adds a valid correction projection
and `effective_as_of` for current-value bounded reads. Original stored columns remain intact.
Historical readers retain original `as_of` bounds by default, including periodic
baseline ingestion. Only the class resolver opts into `effectiveDates: true`.
The mapper validates the original observation before attaching correction
metadata. The class resolver applies that per-observation projection and then
uses its existing latest-as-of / equal-date conflict rules. `sourceType` still
identifies the original record; `correction` identifies the separate manual
decision and original values. No issuer-wide or permanent human priority exists.

Withdrawal is a subsequent revision, not deletion. If the original is still
eligible it becomes effective again; an ineligible original stays excluded.
Invalidating a latest correction never resurrects an earlier correction.

## Migration and verification

New migration: `20261013110341_share_count_observation_corrections.sql`.
Apply before code expecting the new view fields. Existing migration files and
original history rows are not rewritten. Candidate verification uses only local
API/Auth 56461, DB 56462 / system `7694629360856297510`, and server 3121.

Evidence is outside Git:
`C:/Users/PC/AppData/Local/Temp/os-manual-correction-1f6c-20261013`.

- Baseline: 411 PASS and four existing optional fixture skips.
- New tests cover input/identity/auth/origin boundaries, per-observation
  projection, exact large integers, date selection and retained conflicts.
- `db-core-results.json` checks real DB preview/save/readback, request dedupe,
  concurrent revision conflict, withdrawal, original preservation, independent
  same-date conflict, corrected-date filtering, database permissions and
  immutable decisions.
- `db-automatic-results.json` checks subsequent normal automatic observations,
  correction/source changes, hold/reject, replacement observation isolation and
  unchanged AI runs/outputs. Injected transport is explicitly synthetic, with
  no real provider or worker queue invocation.
- `db-unauthorized-result.json` checks an existing non-Operations actor against
  the real database role gate without changing any account or permission.
- CIK 93 is the DB fixture and CIK 94 / observation 31 is the UI fixture. Their
  retained source states 2,000 shares on 2026-01-31. An explicitly marked TEST ONLY
  legacy row intentionally stores 2,001 / 2026-01-30 to exercise correction of
  erroneous historical data. This bad row is not presented as a real approved
  SEC result. The preliminary CIK 92 setup has no bad observation; its failed
  test source-bundle normalization was corrected before the subsequent fixture.
- Real Silvaco observation 22 is preserved and is never deliberately corrupted
  or corrected for these tests.

Final candidate verification:

- 420 PASS / four existing optional fixture SKIP across the 49-file regression;
  another 50 PASS cover total-share aggregation, reverse-split normalization,
  anchor reconciliation and production collection. Typecheck, production build
  and diff checks pass. No extraction prompt/schema or Primary code changed.
- `db-date-filter-results.json` confirms original/effective date bounds in both
  directions. `db-final-readback.json` confirms the later automatic 4,000 /
  2026-02-02 observation wins, rejected/replaced rows remain stored but excluded,
  and the seven original-data table hashes remain unchanged. Real Silvaco stays
  32,688,557; unrelated same-date disagreement stays CONFLICT.
- Main independently exercised the existing Operations browser session on 3121:
  source inspection, invalid-date rejection, preview, double-click save (one
  revision), refresh, then withdrawal (second revision). Original 2,001 /
  2026-01-30 and both decisions remain. Busy inputs/buttons were disabled.
  Screenshots and `main-ui-browser.json` cover 1440x900, 900x900 and 390x900,
  retained Unicode, zero horizontal overflow and zero console errors.
- Anonymous GET/POST return 401; foreign-origin POST returns 403; responses
  remain no-store. The existing ordinary actor is denied by the real DB role
  gate. Main subsequently verified normal UI logout and login with the existing
  ordinary account: the exact administrator page required login while logged
  out, then denied the ordinary account with `reason=admin_required`. The
  existing Operations login was restored through the normal UI. No accounts,
  passwords or roles were changed, and no tokens were injected; normal Auth
  session writes are separate from the unchanged product-data checks.
- Authenticated API role-specific GET/POST remain **unverified**. An ordinary
  account's address-bar GET returned 403 at the origin gate before user lookup
  (2026-10-13 12:07:22.631 UTC), so it is not evidence of an API role denial.
  The browser reported `ERR_BLOCKED_BY_CLIENT` for that probe; it was not
  retried or bypassed. This is distinct from the zero-error normal Operations
  correction flow and from the existing DB/route permission tests.
- No real provider/GPT, new SEC collection, worker queue, external alert,
  shared/remote DB write, main merge, push or deployment was performed.

No completion report alone grants main merge approval. The remaining account
matrix and main's independent acceptance review must be addressed before merge.
