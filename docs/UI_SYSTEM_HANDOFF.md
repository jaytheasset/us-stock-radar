# Stock Radar UI System Handoff

This guide transfers the approved Stock Radar presentation system into the production repository without transferring dashboard-v2 mock behavior or overwriting production ownership.

## Source Repository State

The portable source state ends at `6909e95` on the UI-system chain:

1. `f87660f` - baseline screenshots and audit
2. `7280394` - design tokens
3. `04d9e8b` - UI primitives
4. `c514ed8` - filter controls
5. `0235b06` - market result components
6. `1e0d754` - Stock Radar app shell
7. `4a8e6b8` - panel and bottom-sheet shells
8. `6909e95` - provider-neutral chart shell

Canonical route: `/dashboard-v2`.

Required reading:

- [Official design system](UI_DESIGN_SYSTEM.md)
- [Design tokens](UI_DESIGN_TOKENS.md)
- [Component contracts](UI_COMPONENT_CONTRACTS.md)
- [Historical baseline audit](UI_BASELINE_AUDIT.md)
- [Baseline screenshots](ui-reference/dashboard-v2/)

## Portable Assets

Transfer only after auditing target-repository conflicts:

| Asset | Purpose | Notes |
| --- | --- | --- |
| `app/stock-radar-tokens.css` | Global `--sr-` semantic token source. | Import exactly once before application styles. |
| `components/ui/` | Generic Badge, BottomSheetShell, DetailPanelShell, FilterOption, FilterTrigger, IconButton, Pagination, and SegmentedControl. | Preserve CSS modules and public TypeScript contracts. |
| `components/shell/` | App canvas, product header, desktop/mobile navigation, and navigation configuration. | Adapt route hrefs only after checking target routes. |
| `components/market/` | Desktop/mobile market rows, impact label, and isolated chart action. | Feed preformatted presentation props through adapters. |
| `components/chart/` | Provider-neutral ChartShell, ChartRangeSelector, and ChartToolbar. | Supply a production renderer and accessible summary. |
| `docs/UI_DESIGN_SYSTEM.md` | Official direction and workflow. | Merge into the target repository's documentation structure. |
| `docs/UI_DESIGN_TOKENS.md` | Exact token inventory and rules. | Keep synchronized with the transferred CSS. |
| `docs/UI_COMPONENT_CONTRACTS.md` | Exact props and interaction contracts. | Keep synchronized with transferred components. |
| `docs/UI_BASELINE_AUDIT.md` | Historical measurements, source inventory, and known baseline exceptions. | Retain as supporting evidence; current code and specialist contracts have higher authority. |
| `docs/ui-reference/dashboard-v2/` | Eight approved visual references. | Preserve files; do not overwrite during migration. |

The target repository may choose a different physical token-file location, but the `--sr-` namespace, semantic meaning, load order, and documentation must remain coherent.

## Do Not Copy Blindly

Do not transfer these as production contracts:

- `lib/mock/dashboardV2Data.ts` or any dashboard-v2 mock values;
- route-local selection, filter, pagination, or session state;
- `app/dashboard-v2/` as a production route replacement;
- `components/dashboard-v2/` business composition without an ownership review;
- inert desktop filter, search, alert, settings, Premium, or chart-toolbar behavior;
- `MockChart` candle data, OHLC values, coordinates, or provider assumptions;
- dashboard-specific grid, table shell/header, rows-per-page, timeline, CTA, or active-chip code;
- any page file that collides with existing production routing, metadata, auth, SEO, permission, analytics, or data loading.

The baseline demonstrates presentation. It is not a schema, API, routing, or business-state specification.

## Dependency Map

```text
app/layout.tsx
  -> stock-radar-tokens.css (global, before globals.css)

StockRadarAppShell (server-compatible)
  -> StockRadarProductHeader (client boundary)
     -> IconButton
     -> StockRadarDesktopNavigation
     -> StockRadarMobileNavigationMenu
     -> stockRadarNavigation configuration

Page/domain adapter
  -> SegmentedControl
  -> FilterTrigger / FilterOption
  -> Pagination
  -> DesktopMarketRow / MobileMarketRow
     -> EventBadge-style business wrapper -> Badge
     -> MarketImpactLabel
     -> MarketChartAction
  -> DetailPanelShell
  -> BottomSheetShell
  -> ChartShell
     -> ChartRangeSelector (client-controlled range state)
     -> ChartToolbar
     -> production or mock renderer child
```

Server/client boundaries:

- `StockRadarAppShell`, desktop navigation, navigation configuration, `DetailPanelShell`, `ChartShell`, and `ChartToolbar` are server-compatible.
- `StockRadarProductHeader` owns the mobile menu client state.
- `SegmentedControl`, `ChartRangeSelector`, and page-owned interactive state require a client boundary.
- `BottomSheetShell` uses effects for modal lifecycle and belongs in a client graph.
- A production chart provider may create an additional client boundary inside the renderer slot; do not move provider lifecycle into `ChartShell`.

CSS loading:

- Load `stock-radar-tokens.css` globally exactly once.
- In this repository it is imported by `app/layout.tsx` before `app/globals.css`.
- Component CSS modules import no global stylesheet and resolve `--sr-` variables at runtime.
- Audit target global button, anchor, heading, body, and theme selectors before migration. Shared controls explicitly preserve their verified presentation, but page-local controls can still be affected by target cascade rules.

## Recommended Integration Order

1. Audit the production repository: framework/version, routing, global CSS, tokens, components, AGENTS rules, data ownership, auth, SEO, and current visual baselines.
2. Read and merge the target repository's existing `AGENTS.md` and design-system guidance. Never overwrite them.
3. Search for `--sr-` namespace and semantic collisions. Resolve meaning before copying values.
4. Add the token source and one global import. Verify that existing production pages do not change.
5. Integrate generic UI components one at a time with focused visual and keyboard checks.
6. Integrate the app shell and navigation configuration only after mapping every target route and header action.
7. Integrate market and chart domain components, preserving their presentation-only boundaries.
8. Write adapters from real production models to preformatted component props. Add the real chart renderer as a `ChartShell` child.
9. Migrate one production page incrementally, keeping page grids, workflows, and server data ownership local.
10. Run visual, functional, accessibility, and git-scope acceptance checks before migrating another page.

## Business Logic Preservation

- Keep production DB, API, parser, ingestion, auth, billing, analytics, SEO, permission, caching, and routing behavior unchanged unless separately approved.
- Do not rename or reshape a production schema to match dashboard-v2 mock types.
- Use adapters that format ticker, company, price, change, volume, market cap, impact, and event presentation at the page/domain boundary.
- Preserve production error, loading, empty, stale, and permission states. The design repository does not define them yet; do not delete them to match the mock.
- Keep filtering, sorting, pagination, selection, navigation, and chart-provider state in their existing business owner.
- Replace inert controls with production behavior only when the behavior and its ARIA are implemented together.
- Preserve route metadata, canonical URLs, query parameters, server/client boundaries, and link semantics.

## Conflict Resolution

### Existing components

Compare semantics, keyboard model, dimensions, tokens, and ownership. Prefer adapting an existing production component when it already satisfies the Stock Radar contract. Do not retain two near-identical components without documenting why their interaction or geometry differs.

### Existing tokens

Do not alias solely because values match. Map roles, not hex values. If the target token has a different meaning, retain the `--sr-` role or create a documented target alias. Verify both Stock Radar and unrelated production pages after load-order changes.

### Existing AGENTS.md

Do not overwrite it. Merge the mandatory Stock Radar UI rules into the narrowest applicable repository or directory scope, preserving stricter production rules and resolving contradictions explicitly.

### Framework or version differences

This source uses Next.js 16, React 19.2, TypeScript 5.9, CSS Modules, and `lucide-react` 1.16. Audit support before copying. Adapt imports, ref types, server/client directives, CSS nesting, and build configuration to the target version without changing the public presentation contract. Do not upgrade the production framework as part of UI migration.

## Acceptance Checklist

The first production dashboard migration is complete only when:

```text
[ ] Existing production business behavior, routes, metadata, auth, and data contracts still pass.
[ ] Stock Radar tokens load once and do not restyle unrelated pages.
[ ] No token is undefined; token docs match the transferred source.
[ ] Desktop 1440x900 and 1920x1080 match approved intent without adopting the known 1440 overflow defect.
[ ] Mobile 375x812 and 390x844 use reprioritized market rows with no horizontal market-result overflow.
[ ] Real data maps through page/domain adapters; dashboard-v2 mock data is absent.
[ ] Desktop filters have real behavior or truthful inert semantics, with no false popup ARIA.
[ ] Desktop detail and mobile ticker/filter sheets preserve their correct modal/non-modal contracts.
[ ] The real chart provider renders inside ChartShell with a current accessible name and summary.
[ ] Pointer and keyboard interactions do not double-call row, chart, filter, or pagination callbacks.
[ ] Modal focus containment, dismissal, opener restoration, and body scroll restoration pass.
[ ] Browser console has no application warning/error and required assets return successfully.
[ ] Typecheck, build, project tests, and diff checks pass.
[ ] Visual A/B checks use the same browser/runtime.
[ ] Git diff contains only the intended UI-system integration and page migration.
```

## Deferred Items

These require separate product or visual decisions and must not be silently inherited:

- Decide whether and how to load Inter.
- Fix the 1440px table overflow rather than copying it.
- Integrate a real chart provider and define loading, error, and empty states.
- Implement functional desktop filters and truthful popup relationships.
- Add a valid favicon asset.
- Resolve mobile sticky CTA overlap with timeline content.
- Establish shared market table shell/header and rows-per-page contracts after a second use exists.
- Establish an active-filter-chip contract after repeated production use exists.
