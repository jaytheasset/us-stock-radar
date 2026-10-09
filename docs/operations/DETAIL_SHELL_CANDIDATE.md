# Detail body candidate — 2026-10-09

Candidate implementation is committed locally. **Not merge-ready:** authentic stored news archive / legacy dilution coverage and the earlier shared-DB discrepancy remain unresolved. The isolated follow-up below closes normal free/Pro authentication, saved-list navigation, and same-data before/after comparison. No merge, push, deployment, or shared-database repair was performed. Earlier verification sections are retained as historical evidence; the follow-up gate table supersedes their pending statuses.

## Workspace and acceptance

- Candidate root: `C:/Users/PC/.codex/worktrees/45d1/US-Stock Radar`; original detached HEAD retained.
- Base: `1b847ea1c5ef0c3b4a15e421570b025524558a5c`.
- Earlier chrome-only commit: `7a8592a10f9f81578d0489622db883783b0014c1`. This report supersedes its incomplete body-design report. Final candidate HEAD is the commit containing this revision (full SHA in the completion message).
- Acceptance: modernize the remaining legacy bodies of `/filings/[id]`, `/filings/archive/[id]`, `/news/archive/[id]`, and `/events/[id]` using the current filing/news design; preserve analysis, scores, calculations, evidence, related items, original text, action conditions, auth/plan policy and redirects; verify 1440, 900 and 390px, light/dark, logged-out and available existing account journeys.
- Permanent integration root remains `C:/Users/PC/Documents/Codex/US-Stock Radar`, branch `main`. No repository command ran in that workspace.
- Candidate server used only 3122 and is now stopped. 3110 PID 29836 and other candidate 3121 PID 22540 were unchanged at the final port check.
- No work on candidate 1f6c Projected Dilution. Integration must preserve its rendering/calculation work when reconciling the shared filing page; this candidate changes presentation around `DilutionOfferingTemplate`, `DilutionSnapshotCard`, `DilutionLongSummary` and the legacy page return.

## Implementation

`AnalysisDetailDocument` reuses `StockRadarAppShell` and the actual `GenericFilingAnalysis.module.css` document, hero, grid, cards, rail, case, related-list and renderer styles. Both current reference routes use that design (`NewsAnalysisAdapter` delegates to GenericFilingAnalysis). The new component accepts presentation slots without converting legacy analysis into a new data model.

- Identity/title/badges/actions use the current hero. Existing breadcrumb, timestamps, source and metadata remain.
- Price and summary/snapshot use the current split grid. Mobile price controls use the existing expandable price renderer.
- Event positive/negative cases are separate current-style cards; summaries, evidence and watch-next retain their content and conditions.
- Archives use current summary, source and evidence cards. SEC iframe, proxy agenda, attachments, source inventory and sanitized news HTML are retained.
- Dilution retains its model builders and ShareOverhang renderer; wrapper cards and scoped color tokens repair legacy dark-theme contrast.
- Supplemental CSS is limited to the new document's extra metadata, original heading spacing, legacy inner metric colors and overflow containment. No shared GenericFilingAnalysis stylesheet or analysis model was changed.
- Earlier `StockRadarDetailShell` and its 43-line global CSS block were removed after confirming no remaining references. Net diff against the original base has no globals.css change and no StockRadarDetailShell file.
- Existing inert body-level Premium buttons remain inert. This task does not alter their action or plan conditions.

Net deliverable files against base:

1. `app/events/[id]/page.tsx`
2. `app/filings/[id]/page.tsx`
3. `app/filings/archive/[id]/page.tsx`
4. `app/news/archive/[id]/page.tsx`
5. `components/filing-analysis-v2/AnalysisDetailDocument.tsx`
6. `components/filing-analysis-v2/AnalysisDetailDocument.module.css`
7. `docs/operations/DETAIL_SHELL_CANDIDATE.md`

## Verification results

| Check | Result |
| --- | --- |
| Current design references | Normal TSLA filing and complete news-v2 fixture inspected at 390px before body changes. |
| Actual compact filing archive | Stored BBAI `9d2914b0-5b21-4a70-893e-9190953e36f5` rendered with summary, DEFA14A identity, source/CIK/accession, score and original SEC HTML. Its existing $1.00 fallback price and score 0 were preserved, not validated or corrected as market facts. |
| Legacy event body | Existing `nvda-data-center-platform` fixture rendered with all analysis, case, context, related-content and source sections. This is fixture evidence, not a stored news record. |
| Missing news archive and dilution bodies | Process-only synthetic REST responses exercised the real loaders at UUIDs ending `901` (news archive) and `902` (legacy filing dilution). Titles explicitly say SYNTHETIC. No fixture was inserted in the DB or added to product source/routes. These are layout/loader checks, not actual stored-data verification. |
| Viewports and themes | Four route families × 390/900/1440 CSS px × light/dark: 24 captures. One main landmark on each detail, document scroll width no greater than viewport. Actual rendered mobile, intermediate and desktop captures inspected, including long titles and source areas. SEC original retains its own horizontal scrolling. |
| Logged-out action | Synthetic legacy filing Watchlist opens `/login?next=%2Ffilings%2F00000000-0000-4000-8000-000000000902`; no sign-in submitted. |
| Existing account | Chrome's existing session rendered real BBAI archive and account menu. No cookies extracted/injected; no account/session created. This is authenticated guarded-read evidence, not proof of Operations or paid-plan behavior. |
| List → stored detail | Existing account opened `/filings`, then its visible View Filing Details link to `/filings/9f8cbb28-1cae-435c-a35c-73b715f694cb`; title and stored analysis rendered. This unchanged generic route is supporting journey evidence only. |
| Bookmarks → detail | `/saved` showed 0 bookmarks in the existing account view. No bookmark was created. Navigation from an existing bookmark remains unverified. |
| Canonical redirects | `/filings/9d2914b0-5b21-4a70-893e-9190953e36f5` → compact archive; `/filings/archive/4803f486-c669-41e0-a8ff-f5657f70c2e6` → normal filing detail. |
| Content and logic preservation | TypeScript AST comparison against base, omitting imports and JSX subtrees and normalizing line endings: all four remaining programs are identical. This covers loaders, calculations, model builders and pre-render auth/route conditions. Full conditional inventory differs only in removed old navigation styling and added/reused visual ticker/tone conditions. JSX/props reviewed separately; this is supporting evidence, not a complete value-level E2E proof. |
| Protected regression | 148 tests: 147 passed; 1 existing failure in `lib/saved/savedContent.test.ts`, “Feed actions are preview-only and Live Room saves posts, not messages”. The test and both relevant Feed preview files have no diff against base; it expects direct SavedContentButton text while existing code uses shared actions. No test weakened. |
| Typecheck | Final `npm run typecheck`: exit 0. |
| Production build | Final `npm run build`: exit 0; Next 16.2.6 optimized compile, TypeScript and static generation completed. Candidate dev server stopped first. |
| React review | New shared components are server presentation components with no new hooks, IO, client data serialization or auth boundary. Existing action controls and iframe sanitation remain. Single main landmark retained. |
| Console / requests | Final IAB error/warn log query returned none. Runtime still had chart 502, logo 404 and some live-room unread 500 responses under the guard. These are recorded limitations, not claimed successes. |
| Diff / generated files | `git diff --check` passed; generated next-env.d.ts noise absent from final base diff. No lockfile/config/env change. |

## Read-only runtime and DB discrepancy

The approved local CLI status was captured in memory, with no status JSON or secret values printed or stored. Identity checks: local API port 56321, DB port 56322, system identifier `7678429483712069671`, project `US-Stock_Radar`. Queries used READ ONLY transactions. Migration ledger: 136 entries, latest `20261008171255`; none applied.

Read-only event inspection found 29 stored rows, all source_group filings (13 archive / 12 feed / 4 alert); no news or dilution_risk row in that complete table snapshot. Some other rows are explicitly synthetic. Missing stored rows are not inferred from a failed request.

The temporary launcher outside Git provided local `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` only to the child process. Its fetch guard allowed local GET/HEAD and verified STABLE/IMMUTABLE RPCs, returning 403 for mutations and external requests. Synthetic responses were restricted to the three explicit verification UUIDs, before requests reached the DB. No external/model collection was requested. The guard is verification infrastructure, not a product change or ordinary unguarded login E2E environment.

**Zero shared-DB change was NOT established.** During the final browser-check window, before/after fingerprints covered 50 relevant public tables. `user_profiles` and `alert_preferences` hashes changed; the other 48 and the migration ledger were equal. Guard logs show 59 blocked POSTs for each bootstrap table (`user_profiles`, `user_plan_subscriptions`, `alert_preferences`, `user_delivery_channels`), plus blocked guest-session, token-refresh and logo-cache writes. No allowed mutation appears in the guard log. Existing shared servers/tabs were active, but attributing the two table changes to them would be an inference, not a confirmed cause. No full before-row snapshot exists to determine the changed fields. A further read-only snapshot after the candidate was stopped showed no further changes. No cleanup, rollback or data repair was attempted. This discrepancy blocks a claim that the whole shared DB stayed unchanged.

## Evidence

Local evidence root (not committed):
`C:/Users/PC/.codex/visualizations/2026/10/09/01a1208d-903e-79d0-b787-e2f1405c8fd3/body-refresh`

- `reference-filing-390.jpg`, `reference-news-390.jpg`
- `before-filing-archive-390.jpg` (actual BBAI), `before-event-390.jpg` (existing fixture)
- `after-filing-archive-real-{390,900,1440}-{light,dark}.jpg`
- `after-event-fixture-{390,900,1440}-{light,dark}.jpg`
- `after-news-archive-synthetic-{390,900,1440}-{light,dark}.jpg`
- `after-dilution-synthetic-{390,900,1440}-{light,dark}.jpg`
- `operations-real-archive.jpg`: filename retained, but evidence is only the existing authenticated account; Operations entitlement was not independently verified.
- `layout-checks.json`, `preservation.json`, `regression.tap`, `build.log`
- `before.json`, `after.json`, `stopped.json`, `db-comparison.json`, `http.jsonl`, and temporary launcher/guard/verification scripts.

No before screenshot exists for the two new synthetic cases. Their full-page screenshots can omit offscreen iframe painting; DOM showed the synthetic original source. Actual BBAI original source was both visible and read in DOM.

## Required integration handoff

- Local `main` shared ref: `1b847ea1c5ef0c3b4a15e421570b025524558a5c` (read from candidate).
- GitHub `main`: `7fa1de18a5c9b6dc9454862c1d195ea6a773cefa` confirmed with `git ls-remote origin refs/heads/main` on 2026-10-09.
- Local/GitHub equality: **no**. No fetch, merge or push performed.
- Vercel deployed commit/status: **unverified**, no deployment performed.
- Permanent-main uncommitted file previously reported by handoff: `next-env.d.ts`; not inspected or altered from this candidate.
- Candidate detached state: final clean status/full HEAD are in the completion message. Earlier chrome commit and this body revision remain unmerged.
- Local migration state above; remote migration state unverified. No env files, DB schema/roles/permissions, provider/model configuration, cron, cache invalidation or external service settings changed by this implementation. Process-only verification env described above.
- Push/deploy authorization: none; candidate rules prohibit both.
- Remaining merge blockers after follow-up: authentic stored news archive and legacy dilution examples (or an explicit, narrowly scoped exception for those two missing samples); the prior shared-DB fingerprint discrepancy remains unresolved and cannot be represented as a zero-change PASS. Main must independently perform the original acceptance checks, review every changed file, and repeat critical checks on existing 3110 after any approved integration. Do not restart 3110 for routine TSX/CSS integration.

## Isolated verification follow-up — 2026-10-09

Implementation under test: detached `245a53d5a1b08eca3d5c84ef097fbdb5b314c4ac`. This follow-up changes only this report. No redesign, model change, SEC value correction, auth-policy change, or unrelated test repair was made.

### Isolation and performed changes

- Dedicated Supabase project `detail-body-45d1-e2e`, API `127.0.0.1:56581`, DB port `56582`, PostgreSQL system identifier **`7694655045198774310`**. This differs from shared DB identifier `7678429483712069671` on `56322`.
- Docker project/workdir labels and volume `supabase_db_detail-body-45d1-e2e` point to the task-owned temporary project. Network `detail-body-45d1-net`, ID `624fa2c3191d1db027c579136f3d41336fb5b8bbd75e0ab028c0dc3b3417571d`, subnet `10.253.45.0/24`, has owner `45d1`. It was created because default Docker address pools were exhausted; no other network was edited.
- App bound to `http://127.0.0.2:3122`, with process-only Supabase configuration and provider credentials blanked. The fetch boundary allowed normal requests to the owned app/API, including auth and DB writes; it rejected external requests. **No HTTP response mocks, fake auth success, cookie injection, role changes, or blocked bootstrap writes were used.** Cookies were handled by ordinary login/logout UI on the test hostname.
- Temporary configuration and copies of existing migrations live outside Git. The new isolated ledger contains **138 migrations, latest `20261009072629`**, matching the candidate migration directory. The earlier summary's count of 136 described the shared DB ledger, not this new stack. No migration was added to the repository or applied to a shared/remote database.
- Setup copied three actual retained filing events, their raw items, source-run dependencies, event analysis and ticker relations; source metadata was copied as required by foreign keys. After the journeys, all three copied event row hashes still match the values read during setup. No real renderer-trigger field was changed.
- Setup inserted two explicitly synthetic event/raw/analysis/ticker sets, two temporary confirmed auth users (free and Pro), their profile/plan rows, five bookmarks per account, and one LAYOUT Watchlist row per account. Synthetic source metadata is disabled for collection. No SEC/news collection, GPT call, worker, or cron was invoked.
- Normal browser authentication produced real successful token requests and bootstrap upserts to `user_profiles`, `user_plan_subscriptions`, `alert_preferences`, and `user_delivery_channels`. Preferences/channels each increased from 0 to 2; free and Pro subscriptions remained active with their original plans. Ordinary shell reads also created two `live_room_member_profiles` and three logo-cache writes in this isolated DB. These are performed changes, **not a zero-write claim**. POST RPC calls are classified as requests, not automatically as mutations.
- Final isolated content counts: events 5, raw items 5, analyses 4, saved items 10, Watchlist rows 2, profiles 2, preferences 2, delivery channels 2, subscriptions 2. Passwords/tokens were not printed or committed; the temporary plaintext test-password bridge was deleted after logout.
- Shared DB access in this follow-up was confined to explicit read-only transactions for the bounded sample search and copying retained public source records. Its earlier table-fingerprint discrepancy was not reinvestigated, repaired, or attributed to any process.

### Gate results

| Gate | Result and limit |
| --- | --- |
| Normal free/Pro auth | **PASS.** Both accounts logged in through the product form, real GoTrue password grants returned 200, original `next` URL was restored, and both logged out through the account menu (204). One earlier token request returned 400; its cause was not established. One Pro form submission occurred before hydration retained the entered fields and showed the required-fields error; filling the settled form completed normally. |
| Saved → real detail | **PASS in isolated storage.** Free `/saved` displayed 5 bookmarks; clicking BigBear.ai opened the copied real compact archive. This is an actual retained filing plus synthetic account/bookmark setup. |
| Saved → missing-family details | **PASS with DB-seeded synthetic events.** Free saved-list links opened both news archive and legacy dilution; Pro saved-list link opened dilution. No REST responses were replaced. |
| Save/Watchlist state and logged-out behavior | **PASS.** Free and Pro dilution displayed `Remove filing bookmark` and `Remove LAYOUT from Watchlist`, each `aria-pressed=true`. Logged-out bookmark and Watchlist actions opened `/login?next=%2Ffilings%2F00000000-0000-4000-8000-000000000902`. Bookmark/Watchlist toggling itself was not changed or exercised. |
| List → detail | **PASS.** Pro `/filings` preview's visible `View Filing Details` link opened the seeded legacy dilution UUID and its title. The earlier actual SeeQC list journey remains supporting real-record evidence. |
| Archive redirects | **PASS.** Direct BBAI normal URL redirects to compact archive; direct OPKO archive URL redirects to normal filing, both with unchanged copied records. |
| Relevant plan difference | **PASS.** The normal OPKO filing shows Advertisement for free and none for Pro. All four changed legacy bodies render for Pro at 390/900/1440; their existing unconditional Premium cards remain unchanged. No billing action was performed. |
| Operations-specific body | **Not applicable to these body branches, by code inspection.** The four changed body paths and presentation wrapper contain no Operations-role condition. `getCurrentViewerPlan` uses the subscription/effective-plan path, not an Operations entitlement. This does not claim that Operations pages or unrelated header/admin permissions were tested. |
| Responsive/theme | **PASS for represented samples.** Fresh normal-auth candidate captures: four families × 390/900/1440 × light/dark (24), plus 12 Pro captures. One main landmark per changed detail and no document horizontal overflow. Representative rendered mobile, intermediate and desktop images were visually inspected; prior 24-capture review also remains valid. The news source table wraps; the SEC original retains iframe scrolling. Mobile Show chart changes to Hide chart. |
| Same-data base comparison | **PASS for represented content.** Temporarily loaded only the four original-base page files in this candidate workspace, captured them against the same isolated DB/account, then restored and matched all four committed candidate files. No branch/worktree switch. Compared main text and DOM: analysis sentences, scores, quantities, summaries, source identity, original text and related items remain. Differences are old chrome moved outside main, split timestamp/ticker labels, chart-toggle presentation, and transient market-loading text. This is stronger than the prior AST-only check but does not cover absent real samples. |
| Authentic news archive / legacy dilution | **UNVERIFIED.** Bounded retained-data search described below returned no samples. Synthetic E2E does not close this gate. |
| Earlier shared DB discrepancy | **UNRESOLVED.** This isolated success neither explains the earlier two-table changes nor proves that earlier shared DB state was unchanged. |

### Exact sample URLs and reachable conditions

All follow-up URLs used origin `http://127.0.0.2:3122`:

- Actual BBAI: `/filings/archive/9d2914b0-5b21-4a70-893e-9190953e36f5`; normal `/filings/9d2914b0-5b21-4a70-893e-9190953e36f5` redirects here. Score 0 and existing $1.00 fallback remain unchanged, not asserted as market facts.
- Actual OPKO redirect/plan control: `/filings/archive/4803f486-c669-41e0-a8ff-f5657f70c2e6` → `/filings/4803f486-c669-41e0-a8ff-f5657f70c2e6`.
- Actual SeeQC retained copy: `/filings/9f8cbb28-1cae-435c-a35c-73b715f694cb`.
- Synthetic stored news: `/news/archive/00000000-0000-4000-8000-000000000901`, `source_group=news`, `delivery_level=archive`, score 25, with retained synthetic original HTML/table.
- Synthetic stored legacy dilution: `/filings/00000000-0000-4000-8000-000000000902`, event type `dilution_risk`, score 70, 8-K, with no modern financing/offering display payload. Existing model selects the non-shelf/non-common-warrant legacy body; its missing share-count warnings and 1,000,000 potential shares are preserved.
- Existing legacy event fixture: `/events/nvda-data-center-platform`. This is intentionally fixture evidence: current `/events/[id]` redirects stored filing/news UUIDs to their canonical routes. The changed fallback body is reachable by non-UUID fixtures, not by a retained news UUID.

Bounded search: historical news IDs `66116d3f-f7a9-484f-ac3e-62f82a140e99`, `02486615-d609-4184-aa76-e0f72e80108a`, and `4b3a2c05-d03a-4c89-966b-c86aa9912016` returned no event rows; `raw_items WHERE source_group='news' LIMIT 10` and `events WHERE event_type='dilution_risk' LIMIT 10` returned no rows. The repository's IPWR/Arbor fixtures are synthetic. This result is scoped to the inspected local retained store/repository, not a claim that no production or remote sample exists. Other tasks' stopped databases were not started or searched.

To close the two remaining real-sample checks, provide an authorized retained event/raw/analysis bundle or accessible read-only source containing (1) a news archive event and (2) a dilution event that actually reaches the legacy branch under the conditions above. Alternatively, explicitly approve an exception limited to **authentic-sample coverage for those two bodies**, accepting the labeled synthetic E2E evidence. Neither option automatically authorizes merging or resolves the historical shared DB discrepancy.

### Defects, limitations, evidence and final state

No new body regression requiring a product fix was found. Existing unavailable charts/quotes/logos remain limited by absent external providers in the isolated environment (chart 502, logo 404); they are not claimed as market-data successes. Two browser warnings concerned Turbopack HMR messages during temporary before/after source swaps; normal page navigation after restore succeeded. Offscreen SEC iframe painting can be blank in full-page captures, while DOM inspection included its original content; real BBAI original was visibly rendered.

Follow-up evidence root, outside Git:
`C:/Users/PC/.codex/visualizations/2026/10/09/01a1208d-903e-79d0-b787-e2f1405c8fd3/isolated-detail-45d1`

- `setup-evidence.json`, `audit-evidence.json`: identity, bounded search, copied-record hashes, plans/counts and status-only request classification.
- `candidate-content.json`, `base-content.json`, `candidate-*.dom.txt`, `base-*.dom.txt`: same-data content comparison.
- `layout-checks.json`, `pro-checks.json`; `candidate-{family}-{width}-{theme}.jpg`, `base-{family}-{390|1440}-light.jpg`, `pro-{family}-{width}.jpg`.
- `free-saved-list.jpg`, `free-saved-to-bbai.jpg`, `free-saved-to-news.jpg`, `pro-list-to-dilution.jpg`, `free-generic-plan.jpg`, `pro-generic-plan.jpg`, `mobile-chart-expanded.jpg`, `logged-out-watchlist-login.jpg`.
- Temporary setup/runtime/audit/source-restore scripts are retained for review. They target only the named isolated project; setup is test infrastructure, not product code. Runtime logs contain no auth bodies, cookies or keys. CLI-managed stack secrets are not report artifacts and must not be copied into Git.

Previous typecheck/build results and 147/148 protected tests remain applicable because product files are unchanged; the one documented baseline test failure remains. No redundant full build/test run was performed. Candidate pages were restored byte-for-byte from backups and checked against the committed versions; generated `next-env.d.ts` dev noise was restored before completion. Final report-only diff check and workspace status are recorded in the completion message.

On resuming after the Codex interruption, port 3122 and owned Node PID were already absent. Ports 3110 and 3121 also had no listener at that observation; this task did not stop/restart either, and their cause/state outside this task is unverified. Do not treat them as healthy based on the earlier report. The task-owned Supabase project is stopped with retained volumes; its verified-empty owned network was removed. No other task's stack was stopped, modified, or cleaned up.

Handoff refs rechecked from this candidate: local `main` **`1b847ea1c5ef0c3b4a15e421570b025524558a5c`**, GitHub `main` **`7fa1de18a5c9b6dc9454862c1d195ea6a773cefa`**, unequal. Vercel deployed SHA/status remains unverified. Remote migrations, external service state and cron state remain unverified/unchanged by this task. No push/deploy authorization, merge, push or deployment. Permanent-main `next-env.d.ts` was not inspected or altered.
