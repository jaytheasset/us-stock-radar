# Detail body candidate — 2026-10-09

Candidate implementation is committed locally. **Not merge-ready:** stored news archive / legacy dilution, paid-plan coverage, bookmarked-detail navigation, and the shared-DB fingerprint discrepancy below remain unverified. No merge, push, deployment, or database repair was performed.

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
- Merge blockers: actual stored news archive and legacy dilution journeys; relevant paid-plan/Operations states; bookmark→detail with an existing record; shared-DB fingerprint discrepancy; complete production data/source variants not represented by the small fixtures. Main must independently perform the original acceptance checks, review every changed file, and repeat critical checks on existing 3110 after any approved integration. Do not restart 3110 for routine TSX/CSS integration.
