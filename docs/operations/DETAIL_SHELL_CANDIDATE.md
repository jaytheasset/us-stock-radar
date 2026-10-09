# Detail Shell candidate — 2026-10-09

Candidate implementation only. **Not approved for merge:** actual saved-data,
Operations/plan, archive, and legacy dilution journeys remain unverified.

## Workspace and scope

- Worktree: `C:/Users/PC/.codex/worktrees/45d1/US-Stock Radar`, detached HEAD.
- Base: `1b847ea1c5ef0c3b4a15e421570b025524558a5c`, initially clean.
- Four detail chrome replacements, one shared server wrapper, scoped global CSS,
  and this report. No analysis, score, source, calculation, auth, plan, DB, or
  Projected Dilution implementation changes.
- `StockRadarDetailShell` reuses `StockRadarAppShell` with user-selectable theme.
  The Shell supplies the single main landmark, real product navigation/search,
  account controls, activity rail, and footer. The old body becomes a div.
- Existing detail content classes remain. A `detail-shell-page` marker scopes
  transparent background, divider token, page width/gutters, source-line wrapping,
  original-text horizontal scrolling, and a single mobile rail column.
- No global CSS deletion. No new client component, effects, fetch, or dependency.

## Baseline route map (inspected before edits)

| Route / condition | Existing behavior and preserved content |
| --- | --- |
| `/filings/[id]`, generic branch | S-8, offering registration, financing dilution, shelf/common-warrant-only or absent dilution model continue through existing `StockRadarAppShell` + `GenericFilingAnalysis`. All renderer props, `allowAds`, authenticated/saved/watched state, original SEC viewer, specialized snapshots and review notices unchanged. |
| `/filings/[id]`, remaining dilution branch | Only old main/header replaced. Title, identity, score, Watchlist for real tickers, Save for UUIDs, dilution/common renderer, related filings/news, snapshot, premium notice and SEC source links unchanged. This branch's existing lack of an `allowAds` prop is unchanged. |
| `/filings/[id]`, canonical archive | Existing permanent redirect to `/filings/archive/[id]` unchanged. Fixture lookup, UUID validation and not-found behavior unchanged. |
| `/filings/archive/[id]` | UUID and compact-route checks retained, including permanent redirect back to normal detail for noncompact filings. Stored summary, optional price/context, proxy agenda, SEC HTML viewer, attachment snippets/inventory, score, source/evidence and archive reason retained. No new auth/plan gate. |
| `/news/archive/[id]` | UUID and stored archive payload checks retained. Summary, price component with existing null series, optional context, sanitized original HTML, recent filings/news, score, premium notice and source retained. No new auth/plan gate. |
| `/events/[id]` | Existing v2 fixture still uses `NewsAnalysisAdapter` and `allowAds`/viewer state. Real filings redirect to `/filings/[id]`; real news permanently redirects to its canonical path. Remaining market/fixture fallback retains price, analysis, specialized dilution/corporate-action branches, context, related content and optional original release. |

Common Shell account resolution is inherited from the existing product Shell.
The routes' own authentication and plan policies have not been changed. Existing
inert body-level `Upgrade to Premium` buttons remain unchanged; this task removes
the fake header controls, not redesigns or rewires the body promotion.

## Verification and acceptance

| Acceptance | Result |
| --- | --- |
| Shared header/theme/navigation | Verified on event fixture, matching the unchanged normal filing Shell. Four route call sites checked. |
| Content/action/branch preservation | All four page files compared with base after removing only the replaced header/wrapper/import: exact equality. No renderer props or condition changes. |
| 1440x900 / 900x900 / 390x900 | Event fixture checked at actual CSS dimensions in IAB; light/dark screenshots inspected. Document scroll width does not exceed client width; one main; no old header; title below header. Mobile rail has one column. Existing context carousel intentionally contains offscreen slides inside its scroll container. |
| Logged-out actions | Generic filing fixture Watchlist opens `/login?next=%2Ffilings%2Ftsla-8k-operational-update`; no login submitted. Mobile menu contains real navigation and correct login return URL. |
| Operations / existing paid plans | **Unverified.** Candidate lacks Supabase config. Also normal detail `getOptionalCurrentUserId()` and Shell auth resolution can bootstrap user rows; performing this against the shared DB would violate the requested zero-write boundary. No cookies extracted/injected and no account/session created. |
| List to actual saved detail / archives / legacy dilution | **Blocked/unverified.** `/filings` reports `Filing data unavailable`. No actual row URLs could be established from this candidate. Existing generic financing fixtures must not be presented as proof of the legacy dilution branch. |
| Browser JS | Fresh IAB verification tab: no error/warn logs. Editing-time Chrome HMR briefly saw the wrapper import before the new file existed; reload/final verification cleared it. |
| Runtime data errors | Missing local Supabase/provider config: market chart GET 502, live-room unread GET 500, logo 404, unavailable market activity/filing list. Classified as environment failures, not successful real-data verification. |
| Protected regression | 148 tests: 147 pass, 1 pre-existing failure in `lib/saved/savedContent.test.ts`, “Feed actions are preview-only and Live Room saves posts, not messages”. Base and candidate test/preview files are byte-equivalent after line-ending normalization. Both base preview files lack direct `SavedContentButton` text; they use existing shared preview actions. No test weakened or unrelated fix made. |
| Typecheck | `npm run typecheck` passed. |
| Production build | `npm run build` passed (Next.js 16.2.6): optimized compilation, TypeScript, page data collection and static generation completed, exit 0. |
| Diff check | `git diff --check` passed. |
| React review | Server wrapper accepts children without serializing new data, adds no hooks/IO, reuses the theme/auth/navigation boundary, and avoids nested main landmarks. |

## URLs and evidence

Normal candidate runtime used port **3122** with `npm run dev -- --hostname
127.0.0.1 --port 3122`, then stopped for production build. No env files or runtime
configuration were created/modified. `npm ci --no-audit --no-fund` used the existing
lockfile. No lockfile changes.

- `http://localhost:3122/events/nvda-data-center-platform`: existing mock event,
  old chrome reproduced before change; common Shell verified after change.
- `http://localhost:3122/filings/tsla-8k-operational-update`: existing generic
  fixture, preserved Shell, 390px view and logged-out Watchlist flow.
- `http://localhost:3122/filings`: actual loader path, backend unavailable.
- Archive UUID URLs and actual legacy dilution URL: **not verified**.

Evidence is outside Git at
`C:/Users/PC/.codex/visualizations/2026/10/09/01a1208d-903e-79d0-b787-e2f1405c8fd3/`:
`event-layout-checks.json`, `event-{1440,900,390}-light-full.jpg`,
`event-390-dark.jpg`, `event-900-dark.jpg`, `event-390-menu.jpg`,
`generic-filing-390.jpg`, `filings-backend-unavailable.jpg`, `regression.tap`,
`build.log`. Browser viewport overrides and Chrome test theme were restored.

## Required integration handoff

- Permanent main stays `C:/Users/PC/Documents/Codex/US-Stock Radar` on `main`.
  No commands were run against it; port 3110 was never stopped/restarted.
- Local main: handoff supplied `1b847ea1c5ef0c3b4a15e421570b025524558a5c`;
  not independently refreshed from the permanent workspace.
- GitHub main: unverified; no fetch/push. Vercel commit/state: unverified; no deploy.
  Local/remote/deployed equality is **not established**.
- Candidate final commit and clean status: reported with `git rev-parse HEAD`
  and end-of-task status in the final response.
- Other work: Projected Dilution candidate in worktree `1f6c`, untouched.
  Integration touchpoint is only the import and legacy return wrapper in
  `app/filings/[id]/page.tsx`; keep both candidates' renderer logic intact.
- Shared DB: not connected. Actual model/provider calls, DB writes, migrations,
  collection/analysis reruns and external deliveries: **0 performed**.
  Supabase local/remote migration state, external service health and cron status
  unverified and unchanged. No environment-variable names changed.
- User's existing main `next-env.d.ts` change was not accessed or changed.
  Candidate Next-generated `next-env.d.ts` returned to its base content after
  production build and is excluded from the commit.
- Merge/push/deploy authorization: none for this candidate task.
- Next gate: provide an authorized read-only verification environment and real
  route IDs, then verify all four routes, redirects and applicable existing
  account/plan states at all three viewports. Resolve baseline regression failure
  separately. Main integration must independently repeat acceptance checks before
  merge; this report does not authorize integration.
