# F-1 projected offering dilution v1

> 2026-10-10 correction: NOT merge-ready. Primary filing pages, shared analysis renderer and Primary ingestion have been restored exactly to local main a1ee8ac75ecbe075b9a3e2a814cee41a21a84515. The projected panel is disconnected from these surfaces, and the Primary post-save Alert hook is removed. Remaining Monitor/Alert English copy and a separately approved detail destination are unfinished; existing projected Alert anchors no longer expose a detail panel. Earlier verification below is historical and does not establish current feature completion. No original AI output, schema or prompt was changed by this restoration.

Base: `1b847ea1c5ef0c3b4a15e421570b025524558a5c`; detached candidate `C:\Users\PC\.codex\worktrees\1f6c\US-Stock Radar`.

## Acceptance gate

- Same accession, current source and publicly eligible O/S + Offering only. PASS or the administrator's explicit approved candidates; hold/reject/unapproved/no-direct/failed inputs cannot publish.
- Separate immutable versioned planning fact; original JSON, schemas, market O/S, canonical priority and Registry unchanged.
- Issuer shares/ADS base versus issuer overallotment versus resale versus potential warrants. Exact class and direct ADS ratio only. No amendment carry-forward or date substitution.
- ARM resale 95,500,000 ADS and zero issuer increase; blank Birkenstock F-1 unavailable; F-1/A issuer 10,752,688 versus resale 21,505,376; Canaan blank ADS/ratio unavailable, Class B not total; NuCana underlying/warrant separation and original Unicode.
- Existing condition builder, matcher, internal Alert list/detail and `/filings/<event-id>`; no new Monitor system. Alert wording must say 예상 and 공모 계획 기준.
- Approval and terminal persistence trigger evaluation; concurrent/replayed calls create no duplicates. Key binds condition, accession, both runs, contract and scenario. No external backfill notifications.
- Logged-out and relevant authenticated/admin journeys, 1440×900, intermediate and exactly 390×900; console errors zero. Candidate port >=3111 only.
- New unit/isolated DB, Offering/O/S, Monitor/Alert, Registry/Primary regressions, typecheck, production build, diff check. Actual GPT/worker calls zero.

## Conservative v1 limits

The frozen Offering schema has no typed warrant-underlying link or typed base/full scenario on direct post-O/S. Ambiguous relationships stay unavailable; scenario text is retained as evidence, not parsed into numeric relationships. Negative role markers reject historical/authorized/registered/underlying quantities from immediate issuance. Class labels are compared byte-for-byte. An issuer total with no class name is not silently matched to a named class.

## Storage, publication and conditions

`projected_offering_dilution_facts` stores immutable `projected_offering_dilution_v1` facts, both run IDs, accession, raw identity/source guard, review decision provenance, all required base/full/resale/warrant/post-O/S/percentage fields, direct post-O/S records and evidence references. The official reader checks the currently retained source and latest decisions again; it never serves an old fact after a fingerprint or approval change. It reads the newest run of each domain without falling back to an older successful result. O/S and Offering fingerprints have different filing metadata contracts, so each is compared against its own freshly built source, not incorrectly equated to the other domain's hash.

Terminal persistence/replay and admin approval refresh the derivative. The production worker uses the default runtime repository path so publication hooks execute; explicitly injected repositories remain isolated verification paths. The former Primary event-persistence retry was removed; Primary does not trigger this feature. Read-only UI requests cannot publish or enqueue. The generic consumer only requests these facts for the explicit `projected` publication trigger, preventing unrelated evaluations from creating planning Alerts. The normal filing and archive pages no longer render this feature. A separate display destination remains unresolved.

The existing registry, matcher, `listing_monitors`, condition editor and `user_alert_deliveries` are reused. Conditions: base issuer quantity >= threshold; base increase % >= threshold; full-overallotment increase % >= threshold; resale only; pre-funded warrant presence; warrant presence; calculation unavailable/partial/conflict. No natural-language compiler/provider invocation is needed to use the preset/editor.

The outbox has a separate `projected_monitor_id` reference to the SAME existing monitor table so its run/scenario identity does not weaken other Monitor families' existing monitor+event unique constraint. Atomic Alert key: condition-set ID + accession + O/S run ID + Offering run ID + calculation contract version + base/full/combined scenario + canonical condition hash. Paused/edited monitors and source/review changes are rechecked in the write transaction. The internal-only constraint forbids scheduling or sent/attempted external channels. Historical replay cannot send an external notification.

Migration: `20261009104931_projected_offering_dilution_v1.sql`; private table, service-only invoker RPCs, immutable trigger and internal-outbox fields. Apply this migration before the candidate application changes. Shared local Supabase and remote databases were not modified; this migration was tested in an owned standalone PostgreSQL schema only, then that schema was removed.

## Verification — 2026-10-09 KST

- New calculation + Monitor tests: 11 passing, included in combined regression command `node scripts/run-projected-dilution-tests.mjs`.
- Combined Monitor/Registry/Primary/calculation regression: 328 PASS, 4 existing optional skips (332 total).
- Offering: 31 PASS; O/S: 37 PASS; Alert regression: 76 PASS.
- Filing UI regression: 46 PASS. Final `npm run typecheck`, `npm run build` and `git diff --check` PASS. Candidate preview route and generated-file changes are excluded from the commit. Task-owned port 3121 server and isolated port 56439 database were stopped after verification; port 3110 was untouched.
- Isolated PostgreSQL: concurrent materialization, 12 concurrent Alert writers (one new row), six concurrent writers after approval for each domain (one new row each), retry dedupe, approval/hold for both domains, immutable facts, source change blocking, anon/authenticated role denial, pause guard, null-scenario rejection, external scheduling denial, Unicode and original-output preservation PASS. Docker Supabase was unavailable; used a separate temporary native PostgreSQL cluster on loopback port 56439. No worker or provider executed. This isolated schema test does not substitute for full Supabase migration/Auth/RLS integration.
- Frozen Offering case checks use synthetic O/S baselines explicitly, because this checkout does not contain matching frozen O/S fixtures for ARM, Birkenstock and NuCana. They prove offering arithmetic and exclusion behavior, not real issuer post-O/S results. Canaan uses a synthetic blank-ADS/Class B case, not an invented completed Offering output.
- ARM frozen Offering: resale 95,500,000 ADS, no issuer proceeds; base and full issuer increase 0.
- Birkenstock frozen F-1: unavailable. Separate frozen F-1/A: issuer 10,752,688 shares, resale 21,505,376 shares; shareholder over-allotment does not increase issuer issuance. Cross-accession composition rejected.
- Canaan-shaped test: blank ADS/ratio stays unavailable; direct Class B 356,624,444 is retained separately and never becomes total post-O/S.
- NuCana frozen Offering: base 12,497,768 ADS × 25 = 312,444,200 ordinary shares, assuming no pre-funded substitution. Registered warrant underlying 559,275,129 ADS is excluded from immediate issuance. Warrant potential remains unavailable because v1 lacks a typed relationship. Original Unicode unchanged. No actual NuCana pre/post-O/S assertion.
- Candidate UI at port 3121: existing Monitor preset/add-condition catalog and editable 10% → 15% threshold verified logged out; create remains disabled. Admin O/S direct URL redirects to login.
- Actual reusable display component rendered using a clearly labeled temporary synthetic preview, inspected at actual DOM viewport 1440×900, 900×900 and exactly 390×900: no horizontal overflow; preview and mobile Monitor tab console errors 0. Preview route removed before commit. Chrome's 75% scale initially produced 389px; exact 390px was separately verified with the in-app browser.
- **Unverified / merge blocker:** authenticated condition save, actual `/filings/<event-id>` and `/filings/archive/<event-id>` populated from Supabase, internal Alert list/detail, administrator approval → UI/Alert reflection, relevant logged-in plan states and full-journey zero-console-error gate. Docker Desktop failed to start its Linux engine, so local Supabase/Auth was inaccessible. The initial unauthenticated Chrome Alert shell also logged an existing `/api/live-room/unread` 500 without configured Supabase; full console-zero acceptance is not claimed. No mock-auth bypass or shared service reconfiguration was introduced.
- Actual GPT calls: **0**; real workers started: **0**. No closing/424B/S-1/S-3/Registry Apply/market O/S/actual canonical priority changes.

## Production handoff boundary

Permanent main remains `C:\Users\PC\Documents\Codex\US-Stock Radar`, branch `main`. Inherited local main is the base above; GitHub main and Vercel SHA/state/equality unverified. Main's user-owned `next-env.d.ts` (SHA256 `083e23c4c5e7761db151134ea1ef7896120c86c5888cdc8a861f534f7e86d6fd`) and other worktrees untouched. Other in-progress/unmerged inventory not investigated. Remote migration/environment/external services/cron unverified and unchanged. No push/deploy authorization. Last inherited main check was ticker docs-only link/static Mermaid/diff PASS. This candidate needs independent acceptance before merge.
