# Stock Radar UI Design System

Status: official UI-system entry point at commit `6909e95`

Canonical route: `/dashboard-v2`

Baseline commit: `f87660f`

Implementation chain: `7280394` (tokens), `04d9e8b` (primitives), `c514ed8` (filters), `0235b06` (market results), `1e0d754` (app shell), `4a8e6b8` (panel and sheet shells), `6909e95` (chart shell)

Detailed sources:

- [Baseline audit](UI_BASELINE_AUDIT.md)
- [Design token reference](UI_DESIGN_TOKENS.md)
- [Component contracts](UI_COMPONENT_CONTRACTS.md)
- [Repository handoff guide](UI_SYSTEM_HANDOFF.md)

This document defines design direction, ownership, selection rules, and delivery workflow. The token inventory and exact component props remain authoritative in their specialist documents rather than being duplicated here.

## 1. Purpose and Authority

This system makes the approved `/dashboard-v2` presentation reusable without turning its mock data, route state, or known defects into general product rules. Use it for new Stock Radar surfaces and incremental migrations of existing routes.

When sources disagree, use this priority:

1. Current checked-in token and component code at `6909e95`.
2. [UI_DESIGN_TOKENS.md](UI_DESIGN_TOKENS.md).
3. [UI_COMPONENT_CONTRACTS.md](UI_COMPONENT_CONTRACTS.md).
4. The eight [canonical baseline screenshots](ui-reference/dashboard-v2/).
5. [UI_BASELINE_AUDIT.md](UI_BASELINE_AUDIT.md).

The baseline audit records the pre-extraction implementation and can contain historical file names or line numbers. Current code wins for API, ownership, and file location. A screenshot wins only when evaluating visual parity in the same browser/runtime. If code and a specialist document disagree, correct the document in the same focused change or stop and report the conflict.

## 2. Canonical References

The canonical visual reference is `/dashboard-v2` with its deterministic mock state. Validate both the initial Top Gainers state and the AMD-selected state.

| Viewport | Initial | AMD selected |
| --- | --- | --- |
| 390 x 844 | [PNG](ui-reference/dashboard-v2/mobile-390x844-top-gainers.png) | [PNG](ui-reference/dashboard-v2/mobile-390x844-ticker-selected-amd.png) |
| 375 x 812 | [PNG](ui-reference/dashboard-v2/small-mobile-375x812-top-gainers.png) | [PNG](ui-reference/dashboard-v2/small-mobile-375x812-ticker-selected-amd.png) |
| 1440 x 900 | [PNG](ui-reference/dashboard-v2/desktop-1440x900-top-gainers.png) | [PNG](ui-reference/dashboard-v2/desktop-1440x900-ticker-selected-amd.png) |
| 1920 x 1080 | [PNG](ui-reference/dashboard-v2/large-desktop-1920x1080-top-gainers.png) | [PNG](ui-reference/dashboard-v2/large-desktop-1920x1080-ticker-selected-amd.png) |

Do not compare screenshots produced by different Chrome, font, operating-system, zoom, or device-scale-factor configurations as if every changed pixel were an application regression. For refactors, render the previous commit and candidate commit in the same runtime, then perform an A/B pixel comparison. Never overwrite a baseline PNG without explicit approval for a new canonical visual state.

## 3. Visual Principles

- **Dark and data-first.** Near-black canvases and charcoal surfaces support dense, repeated financial scanning.
- **Density before decoration.** Prefer rows, bands, dividers, and compact controls over marketing cards, large empty space, gradients used as decoration, or oversized type.
- **Orange has a job.** Orange marks product accent, active navigation, selected rows, strong calls to action, and high-priority emphasis. It is not a general decorative color.
- **Market meaning is semantic.** Positive and negative movement use their market tones. Warning, info, event, and impact meanings use their dedicated roles.
- **Hierarchy is explicit.** Ticker, primary metric, and active state lead. Company, secondary metric, metadata, and timestamps recede.
- **Mobile reprioritizes.** Mobile does not shrink a desktop table until every column fits. It presents the same record as a purpose-built list row and moves detail into a sheet.
- **Scan speed wins.** Stable row heights, tabular numerals, right-aligned metrics, nowrap values, and ellipsized identity metadata reduce visual movement.

Do not add unverified brand philosophy, illustration rules, a light theme, or alternate palettes. Those contracts do not exist in the canonical implementation.

## 4. Responsive System

The current breakpoints are source literals because CSS custom properties cannot be used in media-query conditions:

| Boundary | Current behavior |
| --- | --- |
| Above 1320px | Two-column dashboard: flexible market results plus detail panel with a `31.5vw` target and 430px minimum. |
| 1181px to 1320px | Two-column dashboard with 690px market minimum and 390-420px detail panel; controls stack and detail content tightens. |
| 761px to 1180px | One-column page flow; the non-modal detail panel stacks after market content. |
| 760px and below | Mobile product header, compact controls, mobile market rows, hidden desktop detail panel, and modal bottom sheets. |

Responsive rules:

- `StockRadarAppShell` owns the canvas and main landmark, not a max-width container. Each page owns its content width, gutters, split columns, and page-specific overflow.
- Desktop market results retain the semantic table and nine-column contract.
- Mobile market results use the three-area `MobileMarketRow`: rank, ticker/company, and primary/secondary values.
- Mobile market results must not use horizontal table scrolling as the default solution. Reprioritize information and expose deeper fields through detail views.
- Mobile filters show four quick triggers and move secondary options into a modal filter sheet.
- Mobile ticker detail is a modal sheet; desktop/tablet ticker detail is a non-modal complementary panel.
- Validate at all four canonical viewports. Add intermediate checks when a change touches 1180px or 1320px behavior.

The current 1440px desktop table overflow is a known defect, not a reusable layout rule. Do not encode it into new pages or widen new shells to reproduce it.

## 5. Layout and Spacing

Ownership:

- `StockRadarAppShell` owns page canvas, inherited Stock Radar typography, product header, scrollbar treatment, and one `main#stock-radar-main-content`.
- `StockRadarProductHeader` owns brand, delayed-status display, desktop navigation, header actions, and mobile navigation state.
- Page modules own gutters, maximum width, columns, sidebars, table shells, panel placement, and section composition.
- `DetailPanelShell` owns the non-modal sticky surface, not its grid width.
- `BottomSheetShell` owns modal surface geometry and lifecycle, not domain content.

Canonical repeated measurements come from tokens:

| Role | Token and current value |
| --- | --- |
| Desktop page gutter | `--sr-page-gutter-desktop`: 28px |
| Mobile page gutter | `--sr-page-gutter-mobile`: 12px |
| Header | `--sr-size-header`: 56px |
| Standard control | `--sr-size-control`: 40px |
| Mobile primary tab | `--sr-size-mobile-primary-tab`: 42px |
| Mobile session tab | `--sr-size-mobile-session-tab`: 35px |
| Mobile quick filter | `--sr-size-mobile-quick-filter`: 34px |
| Desktop table header row | `--sr-size-table-header-row`: 46px |
| Desktop table body row | `--sr-size-table-row`: 43px |
| Mobile market list row | `--sr-size-mobile-list-row`: 48px |
| Desktop table footer | `--sr-size-table-footer`: 42px |

Use `--sr-space-*` for repeated component gaps, padding, and offsets. Use semantic gutter and sizing tokens when the value expresses a stable role. Do not add an arbitrary pixel value when an existing token expresses the same role.

Local literals remain valid when they encode verified one-off geometry rather than a reusable design decision. Examples include table column widths, responsive grid formulas, sheet viewport formulas, chart SVG coordinates, candle widths, dash arrays, and provider rendering coordinates. Document a new local literal when its purpose is not obvious.

See the [complete spacing and sizing inventory](UI_DESIGN_TOKENS.md#6-spacing-and-control-size-rules).

## 6. Typography

The canonical sans stack is:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

`Inter` is declared but not loaded by this repository. Actual glyphs can therefore come from the first available fallback. Do not install Inter, add `next/font`, or introduce `@font-face` as an incidental refactor; that is a visual-baseline decision.

Rules:

- Use the named `--sr-font-size-*`, `--sr-font-weight-*`, and `--sr-line-height-*` tokens.
- Do not introduce arbitrary font sizes or weights to make a local layout fit.
- Use `--sr-font-variant-numeric: tabular-nums` for aligned prices, percentages, volumes, market caps, axes, and pagination counts where applicable.
- Keep financial values on one line unless the component contract explicitly stacks primary and secondary values.
- Ticker is stronger than company name. Primary mobile value is stronger than its secondary value. Metadata and timestamps use muted roles.
- Use the mono stack only for chart axes and OHLC-style technical output, not general financial rows.
- Letter spacing is zero except for the verified brand token.

See the [typography rules and inventory](UI_DESIGN_TOKENS.md#5-typography-rules).

## 7. Color and Semantic Tone

Use semantic `--sr-color-*` tokens only. The maintained families cover:

- page, panel, table, control, overlay, and emphasized surfaces;
- border, divider, section, overlay, and focus distinctions;
- primary, body, secondary, subtle, muted, disabled, label, and metric text;
- orange accent, active, selected, hover, focus, and CTA states;
- positive, negative, warning, and informational states;
- event-specific earnings, legal, insider, transaction, product, and neutral tones;
- impact-specific major/high, medium, and low tones;
- chart grid, axis, line, candle up/down, last price, and volume roles.

Important boundaries:

- Positive/negative text and chart up/down colors are distinct contracts even when they are semantically related.
- Border and divider roles stay separate from text and icon roles.
- Accent and selected roles stay separate so interactive emphasis can evolve without recoloring every orange surface.
- Badge text, border, and background roles stay separate by event type.
- `MarketImpactLabel` owns impact mapping; generic `Badge` owns event presentation tones only.

Literal hex, RGB, HSL, or named colors are not allowed in reusable Stock Radar component CSS. Before adding a token, prove that no current semantic role fits, choose a role-based `--sr-` name, add it to `app/stock-radar-tokens.css`, update [UI_DESIGN_TOKENS.md](UI_DESIGN_TOKENS.md), and verify existing baselines. Do not create component-name color tokens for a one-off styling preference.

## 8. Icons

The current icon source is `lucide-react` `1.16.0`. Reuse Lucide assets already present before adding a dependency or drawing SVG controls manually.

- Every icon-only button requires a type-level or explicit accessible name.
- Set decorative icons to `aria-hidden="true"`.
- Use `IconButton` for the verified header icon-only geometry and status indicator.
- Do not force chart tools, market-row chart actions, panel close controls, or sheet close controls through `IconButton`. Their 22x30, 30x30, 34px, or 38px geometry and event ownership are intentionally separate.
- Current rendered Lucide glyph sizes are generally 12, 15, 17, 18, 19, or 22px according to context. Preserve the owning component contract rather than inventing a global icon-size prop.
- Keep Lucide's default stroke behavior unless a verified component contract says otherwise.
- Distinguish a decorative glyph from its native interactive button. Never make a bare SVG the only keyboard target.
- Do not add `aria-haspopup`, `aria-expanded`, or `aria-controls` to an inert icon action that has no real popup.

## 9. Component Selection Guide

Exact props, accessibility models, and exclusions are maintained in [UI_COMPONENT_CONTRACTS.md](UI_COMPONENT_CONTRACTS.md).

### Shell and surfaces

| Component | Use when | Do not use when |
| --- | --- | --- |
| `StockRadarAppShell` | A Stock Radar route needs the canonical canvas, header, and main landmark. | A nested panel needs local framing or the page needs the shell to impose a max width. |
| `StockRadarProductHeader` | Rendering the canonical product brand, status, navigation, and actions through the app shell. | Building a page-local toolbar or custom marketing header. |
| `StockRadarDesktopNavigation` / `StockRadarMobileNavigationMenu` | Rendering the shared route configuration in its verified desktop or mobile presentation. | Creating page tabs or a generic popover. |
| `DetailPanelShell` | A desktop/tablet non-modal complementary detail surface is required. | Content must block the page, trap focus, or render as a mobile dialog. |
| `BottomSheetShell` | A mobile modal needs the verified `content-footer` or `full-scroll` lifecycle and geometry. | A non-modal menu, drawer, desktop dialog, or speculative sheet layout is needed. |

### Generic UI

| Component | Use when | Do not use when |
| --- | --- | --- |
| `IconButton` | A canonical header icon-only action needs native button semantics. | Geometry or behavior belongs to chart, table, panel, or sheet context. |
| `SegmentedControl` | A controlled three-item primary or compact tab selection matches the verified tablist model. | A chart range needs radio semantics or values/layout do not match the contract. |
| `Badge` | A bordered, non-interactive semantic event label is required. | The label is a filter, impact label, button, or status announcement. |
| `FilterTrigger` | A desktop split trigger or mobile compact quick-filter trigger is needed. | The component would own filter logic, popup positioning, or data filtering. |
| `FilterOption` | A parent-owned mobile single-select option uses the verified toggle-button model. | Multi-select, radio, or checkbox behavior is required without a reviewed contract. |
| `Pagination` | A caller already owns page state and visible-page calculation. | The component is expected to fetch, paginate, or calculate business results. |

### Market domain

| Component | Use when | Do not use when |
| --- | --- | --- |
| `DesktopMarketRow` | A semantic nine-column market result row receives preformatted presentation props. | The component would import API or mock models, sort, filter, or own the table shell. |
| `MobileMarketRow` | A no-horizontal-scroll rank/identity/primary-secondary mobile market result is needed. | A desktop table is being compressed into a small viewport. |
| `MarketImpactLabel` | Rendering one supported market-impact level. | Rendering event types or arbitrary status labels. |
| `MarketChartAction` | A 30x30 market-cell chart action must be isolated from row activation. | A generic header or chart-toolbar action is needed. |

### Chart domain

| Component | Use when | Do not use when |
| --- | --- | --- |
| `ChartShell` | A provider-neutral named chart region needs range, toolbar, renderer, and text summary slots. | The shell is expected to fetch data, size a provider, or own loading/error behavior. |
| `ChartRangeSelector` | The fixed eight financial ranges and controlled radio-group contract apply. | Arbitrary ranges, disabled items, or generic tabs are needed. |
| `ChartToolbar` | The current fixed inert chart actions must be presented. | A real provider action API or popup is being implied before implementation. |

## 10. Interaction Patterns

- `active` means an applied value or current navigation state. `expanded` means a real connected popup is open. Do not merge them.
- Inert mock controls remain native and visually available but must not advertise popup ARIA or fake behavior.
- `SegmentedControl` uses tabs with roving focus; `ChartRangeSelector` uses a radio group. Preserve each keyboard model.
- Arrow navigation, Home, and End update controlled selection only through the documented path. Pointer and keyboard activation must not double-call callbacks.
- Interactive market rows isolate nested `MarketChartAction`. Chart activation must not also activate row selection.
- Selected rows use the canonical selected surface/outline without changing row geometry.
- `BottomSheetShell` is controlled and renders nothing while closed. X, direct overlay activation, and Escape request one dismiss per open cycle.
- Modal sheets contain focus, restore the exact valid opener when possible, and restore the captured body overflow value.
- The mobile product menu is a non-modal top-right popover. It has no dim overlay, focus trap, or body scroll lock; outside pointer, Escape, trigger toggle, and item activation close it.
- Pagination suppresses current, invalid, non-integer, and out-of-range requests. The dashboard's pagination callback remains a mock no-op.
- Hover provides secondary feedback; focus-visible must remain independently visible through focus tokens.

## 11. Accessibility Rules

- Every Stock Radar route rendered through `StockRadarAppShell` has one `main#stock-radar-main-content` landmark.
- Icon-only controls require accessible names; visible labels should provide names for text controls.
- IDs used by `aria-controls`, `aria-labelledby`, and descriptions must exist while referenced and remain unique across product menu, ticker sheet, and filter sheet.
- Current navigation uses `aria-current="page"`; pagination exposes exactly one current page.
- Modal sheets use `role="dialog"`, `aria-modal="true"`, and exactly one naming mechanism.
- Use native button and anchor semantics. Preserve Enter/Space activation and documented arrow-key behavior.
- Restore focus after modal or popover dismissal according to the owning component contract.
- Never communicate event, impact, selected, positive, or negative meaning by color alone; visible text remains required.
- Provider renderers must not duplicate chart narration. The current `MockChart` SVG is presentational while `ChartShell` supplies the accessible name and text summary.
- Incorrect ARIA is worse than omission. Do not promise a popup, expanded region, disabled behavior, or selection model that does not exist.

## 12. Desktop and Mobile Contracts

| Area | Desktop/tablet | Mobile at 760px and below | Source |
| --- | --- | --- | --- |
| Header/navigation | Full primary navigation and header actions. | Brand/status plus search, alert, and hamburger; compact non-modal menu popover. | `components/shell/` |
| Market results | Semantic table with nine columns and chart action. | Three-area list row with no horizontal market-table scroll. | `components/market/`, `MarketMoversTable` |
| Detail | Sticky complementary panel above 1180px; stacked panel from 761-1180px. | Desktop panel hidden; full-scroll ticker sheet. | `DetailPanelShell`, `BottomSheetShell` |
| Filters | Six split triggers; currently inert mock controls. | Four quick triggers, optional active chips, and content-footer modal sheet. | `FilterTrigger`, `FilterOption`, dashboard filter components |
| Chart | Shared named shell, ranges, toolbar, and renderer in panel. | Same composition in ticker sheet with responsive renderer sizing. | `components/chart/` |
| Pagination | Shared footer pagination and rows-per-page presentation. | Same pagination contract in a taller stacked footer. | `Pagination`, dashboard table footer |
| Overlays | No modal for standard detail; no generic popover framework. | Product nav is non-modal; ticker and filter sheets are modal and mutually exclusive. | Product header and sheet shell |

## 13. New Page Workflow

1. Read root `AGENTS.md`, this guide, the token reference, and component contracts.
2. Inspect existing shell, generic UI, market, and chart components before adding code.
3. Define the page's information hierarchy and business ownership without copying dashboard mock state.
4. Design desktop and mobile composition together; specify what is hidden, reordered, summarized, or moved to detail.
5. Use existing semantic tokens only.
6. If no token or component fits, document at least two real uses and the missing semantic contract before proposing one.
7. Validate at 375x812, 390x844, 1440x900, and 1920x1080, plus any touched breakpoint boundary.
8. Validate keyboard operation, ARIA relationships, focus restoration, numeric wrapping, text truncation, and overflow.
9. Decide explicitly whether a new baseline is required. Do not overwrite existing references.
10. Update the specialist documentation in the same focused change when a token or public component contract changes.

## 14. Existing Page Migration Workflow

1. Freeze the route's existing data, KPI, API, parser, auth, SEO, permission, and routing behavior.
2. Separate presentation inputs from business models through page-owned adapters.
3. Introduce `StockRadarAppShell` only after confirming landmark and header ownership.
4. Replace visual literals with existing tokens without changing computed presentation.
5. Replace repeated controls incrementally with verified shared components.
6. Keep route-specific grids, data mapping, and workflow state local.
7. Compare each migration step against the prior commit in the same runtime.
8. Do not rewrite the entire page in one change or copy dashboard-v2 mock data into production routes.

## 15. Do / Don't

Do:

- Use `var(--sr-*)` semantic tokens.
- Reuse the narrowest verified component that matches the interaction and geometry.
- Keep business state and API models in page/domain adapters.
- Reprioritize information for mobile.
- Preserve stable row geometry and aligned financial numerals.
- Run same-runtime A/B verification for visual refactors.
- Update token and component documentation with contract changes.

Don't:

- Add arbitrary hex/RGB colors, typography, spacing, radius, shadow, or breakpoints.
- force a desktop market table into mobile horizontal scrolling.
- Put business filter, event, ticker, route, or API names in generic UI props.
- Create speculative variants or components for a single unproven use.
- Add popup ARIA where no popup exists.
- combine a new feature or data change with a visual refactor.
- Treat a known baseline defect as the target for new pages.
- Overwrite canonical PNGs without explicit approval.

## 16. Known Limitations

| Item | Classification | Guidance |
| --- | --- | --- |
| Inter is declared but not loaded. | Known defect / unresolved decision | Do not change fonts incidentally; approve a new baseline if font loading is introduced. |
| 1440px table overflow can occur. | Known defect | Do not reproduce it as a new-page rule. Fix in a dedicated visual change. |
| Mobile sticky analysis CTA can cover the final timeline content. | Known defect | Preserve only for parity during refactors; fix separately with baseline approval. |
| Desktop filter triggers are inert mocks. | Deferred implementation | Do not copy inert behavior into production logic or add false popup ARIA. |
| Search, alerts, settings, and chart toolbar actions are partly inert. | Deferred implementation | Add behavior and ARIA together when the feature exists. |
| `/favicon.ico` returns 404 in the current app. | Known defect | Resolve as an asset task, not a design-system refactor. |
| `MockChart` uses deterministic mock rendering; its SVG is hidden from accessibility and summarized by `ChartShell`. | Canonical accessibility behavior; real provider deferred | Preserve shell naming/summary when replacing the renderer. Do not copy mock data. |
| Market table shell/header and rows-per-page control are not shared. | Deferred implementation | Keep page-owned until a second real usage proves a contract. |
| Active-filter chip is not shared. | Deferred implementation | Keep local until selection/reset geometry repeats. |

Canonical responsive behavior, such as mobile list rows and modal ticker/filter sheets, is not a limitation. Known defects are compatibility constraints during refactors, not standards for new UI.

## 17. Change Governance

Before adding a token, component, or pattern:

1. Search the current token source and component contracts.
2. Demonstrate at least two concrete uses or a clearly cross-route semantic role.
3. Name by semantic responsibility, not a page, component, value, or color appearance.
4. Keep generic UI free of business logic and provider assumptions.
5. Update the relevant specialist document and this guide only when selection/governance changes.
6. Run existing baseline comparisons. If the visual output changes intentionally, request explicit approval for a new baseline set.
7. Add a new route-specific reference only when it establishes a distinct, approved canonical pattern.
8. Keep unrelated features, data changes, and defect fixes out of the refactor.

Current token health at `6909e95`: 248 definitions, 248 documented, 243 referenced, 5 documented foundation tokens unused by dashboard-v2, and 0 undefined references.

## 18. Verification Checklist

Copy this checklist into Stock Radar UI pull requests:

```text
[ ] Read AGENTS.md, UI_DESIGN_SYSTEM.md, UI_DESIGN_TOKENS.md, and UI_COMPONENT_CONTRACTS.md.
[ ] Change scope contains no unrelated feature, data, API, parser, auth, routing, or SEO work.
[ ] Existing token/component contracts were reused before adding new ones.
[ ] Reusable CSS contains no literal color, !important, or unexplained arbitrary sizing.
[ ] Token definitions/documentation/references have no mismatch or undefined reference.
[ ] TypeScript typecheck passes.
[ ] Production build passes.
[ ] git diff --check passes.
[ ] /dashboard-v2 and affected routes return HTTP 200.
[ ] Browser console has no application warning/error; known favicon 404 is recorded separately.
[ ] 375x812, 390x844, 1440x900, and 1920x1080 were inspected.
[ ] Mobile market results have no horizontal overflow.
[ ] Long text truncation and numeric nowrap behavior are intact.
[ ] Pointer, Enter, Space, arrow, Home, End, and Escape behavior were tested where applicable.
[ ] ARIA names, current/selected state, IDs, dialog labels, and popup promises match real behavior.
[ ] Modal focus containment, opener restoration, outside/overlay dismissal, and body scroll restoration work.
[ ] Visual refactors were compared A/B in the same runtime against the prior commit.
[ ] Canonical baseline PNGs were not overwritten without approval.
[ ] Git diff contains only intended files.
```
