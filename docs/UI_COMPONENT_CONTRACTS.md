# Stock Radar UI Component Contracts

Phase: 3A/3B/3C/3D - foundational controls, market results, and product shell

Canonical visual baseline: commit `f87660f` and `docs/ui-reference/dashboard-v2/`

Token foundation: commit `7280394`, `app/stock-radar-tokens.css`, and `docs/UI_DESIGN_TOKENS.md`

These phases extract only the documented controls, market-result presentations, and Stock Radar product shell. The contracts preserve the canonical dashboard-v2 behavior and computed presentation. They do not introduce data fetching, filtering, chart, panel, generic popover, or sheet abstractions.

## 1. IconButton

### Purpose and files

- Component: `components/ui/IconButton.tsx`
- Styles: `components/ui/IconButton.module.css`
- Purpose: accessible icon-only header actions with an explicit button reset, size, indicator, disabled state, and focus-visible state.
- Current shell use: alert, settings, and mobile-menu actions in `components/shell/StockRadarProductHeader.tsx`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `aria-label` | `string` | yes | Accessible name for the icon-only action. |
| `children` | `ReactNode` | yes | Existing icon asset; decorative icon must set `aria-hidden="true"`. |
| `indicator` | `boolean` | no | Adds the small orange status dot without business meaning. |
| Native button props | `ButtonHTMLAttributes<HTMLButtonElement>` | no | Supports `onClick`, `disabled`, `aria-expanded`, `aria-controls`, and other native behavior. |
| `className` | `string` | no | Placement or responsive visibility hook only; it must not replace core button styling. |

The component forwards its button ref. `type` defaults to `button`. Its canonical 34 px header width and responsive action height are fixed internal styling; no single-choice size or icon-size prop is exposed.

### Accessibility and keyboard

- Uses a native `button`, so Enter and Space activation are provided by the browser.
- `aria-label` is required at the type level.
- Focus uses the Stock Radar focus-ring tokens.
- Disabled actions use the disabled text, surface, and opacity tokens and remain non-interactive.

### Usage

```tsx
<IconButton aria-label="Alerts" indicator>
  <Bell aria-hidden="true" size={18} />
</IconButton>
```

Do not use IconButton for icon-plus-text search actions, decorative icons, overlay click targets, or controls whose visual contract depends on a table cell or dialog shell.

### Deliberate exclusions

- Desktop detail close remains local because its canonical icon position includes inherited global button padding. Normalizing it would change the baseline.
- Mobile ticker/filter close controls remain with their sheet implementations because their border, surface, focus management, and ref behavior belong to the future sheet shell.
- Table chart action uses the 3C market-domain wrapper because stop-propagation and ticker-specific naming belong to the market-row contract.
- Chart toolbar actions remain local because their non-square 22 x 30 geometry and chart ownership do not match the header size contract.

## 2. SegmentedControl

### Purpose and files

- Component: `components/ui/SegmentedControl.tsx`
- Styles: `components/ui/SegmentedControl.module.css`
- Purpose: controlled, horizontally oriented tab selection with canonical primary and compact layouts.
- Current dashboard use: market mover category and market session controls in `components/dashboard-v2/StockRadarDashboardV2.tsx`.
- Replaced and removed legacy component: `SegmentedTabs` (formerly dashboard-v2-local).

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `ariaLabel` | `string` | yes | Names the tablist. |
| `items` | `readonly SegmentedControlItem<Value>[]` | yes | Presentation labels and typed string values. Business labels are supplied by the caller. |
| `value` | `Value` | yes | Controlled selected value. |
| `onValueChange` | `(value: Value) => void` | yes | Called by pointer or automatic keyboard selection. |
| `variant` | `"primary" | "compact"` | no | `primary` is the market-mode size; `compact` is the session size. Defaults to `primary`. |
| `disabled` | `boolean` | no | Disables every segment using shared disabled tokens. |
| `className` | `string` | no | Placement-only extension. |

`SegmentedControlItem<Value>` contains `{ label: string; value: Value }`. The primitive does not uppercase, translate, or interpret business values.

### Accessibility and keyboard

- Root uses `role="tablist"`, an accessible label, and horizontal orientation.
- Items use `role="tab"`, `aria-selected`, and roving `tabIndex`.
- Arrow Right/Down selects and focuses the next item; Arrow Left/Up selects and focuses the previous item.
- Home and End select and focus the first and last items.
- Navigation wraps at both ends. Enter, Space, and pointer activation retain native button behavior.

### Usage

```tsx
<SegmentedControl
  ariaLabel="Market session"
  items={sessionItems}
  onValueChange={setSession}
  value={session}
  variant="compact"
/>
```

Do not store business state inside the primitive, derive items from API data inside it, or use `className` to create arbitrary third-party sizes.

### Deliberate exclusion

The chart range row remains local. It is currently an uncontrolled visual selector with an underline treatment, overflow behavior, and chart-toolbar relationship that do not match the controlled segmented-container contract. It can be reconsidered with the chart shell after its state model is defined.

## 3. Badge

### Purpose and files

- Component: `components/ui/Badge.tsx`
- Styles: `components/ui/Badge.module.css`
- Business wrapper: `components/dashboard-v2/EventBadge.tsx`
- Purpose: bordered semantic event label with shared size and tone contracts.
- Current dashboard use: market-row event groups, ticker detail badges, and recent-event timeline labels.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `children` | `ReactNode` | yes | Visible label. Meaning must remain available as text. |
| `tone` | `earnings | legal | insider | transaction | product | neutral` | yes | Visual event-semantic color and surface only. |
| `size` | `small | large` | no | 22 px table/timeline size or canonical 29 px detail size. Defaults to `small`. |
| Native span props | `HTMLAttributes<HTMLSpanElement>` | no | Supports semantic metadata without adding interaction. |
| `className` | `string` | no | Placement-only extension, currently used for mobile timeline fit-content behavior. |

The generic component does not contain `EARN`, `LEGAL`, `M&A`, or other business labels. `EventBadge` owns the `DashboardV2EventType` to label/tone mapping.

### Accessibility

- Uses a non-interactive `span` and retains visible text; meaning does not rely on color alone.
- Badge is not a button, filter, tooltip, or status announcement by default.

### Usage

```tsx
<Badge size="small" tone="earnings">EARN</Badge>
```

Business-layer usage:

```tsx
<EventBadge type="earnings" />
<EventBadge size="large" type="legal" />
```

Do not hardcode business event maps in Badge, attach click handlers to make it a filter, or add a tone for a one-off component color.

### Deliberate exclusion

The borderless 3C `MarketImpactLabel` remains separate from Badge. Combining the two would require an oversized appearance API and weaken both contracts.

## 4. CSS Ownership

- Primitive modules own reset, dimensions, typography, focus/disabled states, border/radius, and semantic tone styling.
- `FilterTrigger.module.css` owns both demonstrated trigger geometries; `FilterOption.module.css` owns the mobile single-select option presentation.
- `StockRadarDashboardV2.module.css` retains page composition, filter-row and option-group layout, sheet/action layout, badge-group spacing, mobile timeline placement, and responsive visibility hooks.
- Moved selectors were removed from the dashboard module rather than duplicated.
- Shared component CSS contains no literal color and does not use `!important`.
- The pre-existing global button styles remain unchanged, but every extracted button explicitly defines the properties required for its canonical presentation.

## 5. FilterTrigger

### Purpose and files

- Component: `components/ui/FilterTrigger.tsx`
- Styles: `components/ui/FilterTrigger.module.css`
- Purpose: native filter button presentation for the demonstrated desktop split-label/value control and mobile compact quick filter.
- Current dashboard use: Market Cap, Price, Volume, Event Type, Signal, desktop More Filters, and the four mobile quick filters in `components/dashboard-v2/FilterBar.tsx`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `label` | `string` | yes | Visible trigger label supplied by the business layer. |
| `value` | `string` | no | Renders the desktop value segment. Absence produces the demonstrated label-plus-icon More Filters geometry. |
| `trailingIcon` | `ReactNode` | no | Existing decorative icon rendered after label/value; callers keep it `aria-hidden`. |
| `variant` | `"split" | "compact"` | no | Desktop split geometry or mobile quick-filter geometry. Defaults to `split`. |
| `active` | `boolean` | no | Indicates that a non-default filter value is applied and controls only the demonstrated compact visual state. |
| `expanded` | `boolean` | no | Indicates whether the connected popup is open and maps only to `aria-expanded`; omission leaves the attribute absent. |
| Native button props | `ButtonHTMLAttributes<HTMLButtonElement>` | no | Supports `onClick`, `disabled`, `aria-label`, `aria-controls`, and other native behavior. `aria-expanded`, `children`, and `type` are controlled by this contract. |
| `className` | `string` | no | Placement-only extension; it must not redefine trigger geometry or state styling. |

The component forwards its button ref and defaults `type` to `button`. It contains no filter keys, labels, values, open state, or update logic.

### Accessibility and keyboard

- Uses a native `button`, preserving Enter and Space activation.
- The visible label provides the accessible name; abbreviated mobile labels may add a fuller `aria-label` through native props.
- `active` and `expanded` are independent: an applied filter can remain active while its dialog is closed.
- Mobile triggers expose `aria-haspopup="dialog"` and boolean `aria-expanded`; `aria-controls` is present only while the controlled sheet is rendered with the matching ID.
- Inert desktop triggers do not expose `aria-haspopup`, `aria-expanded`, or `aria-controls` because no popup exists.
- Closing the mobile sheet through X, overlay, Escape, or Apply restores focus to the exact trigger that opened it.
- Disabled state uses Stock Radar disabled tokens and native button behavior.
- The trailing icon is decorative and must not duplicate the accessible label.

### Usage

Desktop split trigger:

```tsx
<FilterTrigger
  label="MARKET CAP"
  trailingIcon={<ChevronDown aria-hidden="true" size={15} />}
  value={filterState.marketCap}
/>
```

Mobile compact trigger:

```tsx
<FilterTrigger
  active={filterState.marketCap !== "All"}
  aria-controls={isMobileFilterOpen ? "dashboard-v2-filter-sheet" : undefined}
  aria-haspopup="dialog"
  aria-label="Market Cap filter"
  expanded={isMobileFilterOpen}
  label="Mkt Cap"
  onClick={openFilters}
  trailingIcon={<ChevronDown aria-hidden="true" size={12} />}
  variant="compact"
/>
```

Do not put option lists, dropdown positioning, sheet state, filter keys, or data filtering inside FilterTrigger.

## 6. FilterOption

### Purpose and files

- Component: `components/ui/FilterOption.tsx`
- Styles: `components/ui/FilterOption.module.css`
- Purpose: the existing single-select mobile filter option rendered as a toggle button.
- Current dashboard use: every option in `components/dashboard-v2/MobileFilterBottomSheet.tsx`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `label` | `string` | yes | Visible option label supplied by the filter configuration. |
| `selected` | `boolean` | yes | Controls `aria-pressed` and the selected visual state. |
| Native button props | `ButtonHTMLAttributes<HTMLButtonElement>` | no | Supports parent-owned `onClick`, `disabled`, metadata, and native keyboard behavior. `aria-pressed`, `children`, and `type` are controlled by this contract. |
| `className` | `string` | no | Placement-only extension. |

The component forwards its button ref and defaults `type` to `button`.

### Accessibility and keyboard

- Retains the canonical native toggle-button model with `aria-pressed`; it does not introduce unrequested radio or checkbox semantics.
- The parent retains the labeled `role="group"` for each filter section.
- Enter and Space select through the parent callback. Disabled options remain non-interactive.

### Usage

```tsx
<FilterOption
  label={option}
  onClick={() => onChangeFilter(section.key, option)}
  selected={filterState[section.key] === option}
/>
```

Do not pass a filter key into FilterOption, store selected state inside it, or combine single-select and multi-select behavior in one API.

## 7. Filter Boundaries and Deliberate Exclusions

- `StockRadarDashboardV2` continues to own filter state, mobile-sheet open state, and opener focus restoration.
- `FilterBar` continues to own dashboard labels, key mapping, active-filter derivation, and the callback that opens the mobile sheet.
- `MobileFilterBottomSheet` continues to own section iteration, option-to-key mapping, overlay, close behavior, focus, scroll lock, and actions.
- Desktop triggers remain the canonical inert mock controls. No dropdown, outside-click, Escape, or option-selection behavior was added where none existed, and no popup ARIA is advertised.
- No `FilterAction` was created. Clear all and Apply filters each occur once, have different visual/behavioral contracts, and do not demonstrate a reusable variant set.
- Active-filter chips remain local reset controls with removal icons; their geometry and action contract do not match FilterTrigger or FilterOption.
- Filter row layout, option-group wrapping, action-grid layout, and the mobile sheet shell remain dashboard-owned.

## 8. Deferred Beyond Phase 3D

- Market table shell, header, and column layout
- Rows-per-page control
- Panel and detail-panel shells
- Generic popover framework
- Bottom-sheet shell, overlay, handle, and close control
- Active-filter chip contract
- Chart range control and chart toolbar
- Chart shell

## 9. DesktopMarketRow

### Purpose and files

- Component: `components/market/DesktopMarketRow.tsx`
- Shared market-result styles: `components/market/MarketResultRows.module.css`
- Purpose: semantic desktop `tr`/`td` presentation for a ranked market result.
- Current dashboard use: every desktop result rendered by `components/dashboard-v2/MarketMoversTable.tsx`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `rank` | `number` | yes | Visible ranking. |
| `ticker` | `string` | yes | Visible ticker and chart-action accessible-name input. |
| `company` | `string` | yes | Ellipsized company label. |
| `price` | `string` | yes | Preformatted visible price. |
| `change` | `string` | yes | Preformatted percentage; a leading minus selects the negative tone. |
| `volume` | `string` | yes | Preformatted visible volume. |
| `marketCap` | `string` | yes | Preformatted visible market cap. |
| `events` | `ReactNode` | yes | Parent-rendered `EventBadge` group; the row does not import mock event types. |
| `impact` | `high | low | major | medium` | yes | Actual supported impact level for `MarketImpactLabel`. |
| `selected` | `boolean` | no | Controls `aria-selected` and the canonical selected-row treatment. |
| `onSelect` | `() => void` | no | Parent-owned row selection callback. |
| `onOpenChart` | `() => void` | no | Parent-owned chart action callback. |

The table shell, header, fixed column widths, page data, sorting, and filtering remain dashboard-owned. `MarketMoversTable` maps the current mock row into these presentation props.

### Interaction

- The row is keyboard reachable; Enter and Space invoke `onSelect` once.
- Pointer activation invokes `onSelect` once.
- The nested chart action stops click and keydown propagation so chart activation does not also select the row.
- Visible column order remains rank, identity, price, change, volume, market cap, events, impact, chart.

### Usage

```tsx
<DesktopMarketRow
  change={row.changePercent}
  company={row.company}
  events={row.events.map((event) => <EventBadge key={event} type={event} />)}
  impact={row.maxImpact}
  marketCap={row.marketCap}
  onOpenChart={() => onOpenChart(row)}
  onSelect={() => onSelectRow(row)}
  price={row.price}
  rank={row.rank}
  selected={row.ticker === selectedTicker}
  ticker={row.ticker}
  volume={row.volume}
/>
```

## 10. MobileMarketRow

### Purpose and files

- Component: `components/market/MobileMarketRow.tsx`
- Styles: `components/market/MarketResultRows.module.css`
- Purpose: mobile-only three-area market result with no horizontal scroll.
- Current dashboard use: every mobile result rendered by `MarketMoversTable`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `rank` | `number` | yes | Left ranking area. |
| `ticker` | `string` | yes | Bold center identity. |
| `company` | `string` | yes | Single-line ellipsized center metadata. |
| `primaryValue` | `string` | yes | Right, first-line value. |
| `secondaryValue` | `string` | yes | Right, second-line value. |
| `primaryTone` | `negative | neutral | positive` | no | Primary semantic market tone; defaults to neutral. |
| `secondaryTone` | `negative | neutral | positive` | no | Secondary semantic market tone; defaults to neutral. |
| `selected` | `boolean` | no | Controls `aria-selected` and the canonical outline/surface. |
| `onSelect` | `() => void` | no | Parent-owned selection and ticker-sheet opening callback. |

`MarketMoversTable` owns mode interpretation. Gainers/Losers pass change then price; Top Volume passes volume then change. The row does not inspect tab names or mock data and does not add a mobile chart action.

### Accessibility and layout

- Enter, Space, and pointer activation invoke the same parent callback.
- Desktop and mobile row instances are both emitted by the responsive table composition, but CSS renders only the matching contract at each breakpoint; hidden rows are removed from layout and the accessibility tree.
- The visual areas are rank, ticker/company, and right-aligned primary/secondary values. Separate right-side cells preserve the canonical text rasterization while sharing one grid column.

## 11. MarketImpactLabel and MarketChartAction

### MarketImpactLabel

- Component: `components/market/MarketImpactLabel.tsx`
- Props: `impact: "high" | "low" | "major" | "medium"`.
- It preserves the borderless uppercase label. An exhaustive `Record<MarketImpact, string>` maps major/high to accent, medium to warning, and low to positive; unsupported runtime values do not receive an arbitrary fallback tone.
- It is intentionally separate from generic Badge and contains no speculative levels, appearance, or size variants.

### MarketChartAction

- Component: `components/market/MarketChartAction.tsx`
- Props: `ticker: string`, optional `onOpen: () => void`, and native button props except the component-owned accessible name, children, class, click/keydown handlers, and type.
- It preserves the 30 x 30 market-cell geometry, existing BarChart3 icon, and `Open {ticker} chart` accessible label.
- It forwards its button ref, fixes `type="button"`, and supports native disabled behavior plus tokenized focus-visible and disabled states.
- Click and keydown propagation are stopped to isolate it from row selection. Enter/Space retain native button activation and invoke `onOpen` once without invoking the row callback. It is not an IconButton variant because header IconButton has a different 34 px geometry and ownership contract.

## 12. Pagination

### Purpose and files

- Component: `components/ui/Pagination.tsx`
- Styles: `components/ui/Pagination.module.css`
- Purpose: business-neutral page navigation presentation; page state and visible-page calculation remain caller-owned.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `currentPage` | `number` | yes | Current page and previous/next disabled-state source. |
| `totalPages` | `number` | yes | Last boundary and next disabled-state source. |
| `items` | `readonly PaginationItem[]` | yes | Caller-calculated unique page numbers and the optional single ellipsis marker. |
| `onPageChange` | `(page: number) => void` | yes | Parent-owned page request callback. |
| `ariaLabel` | `string` | no | Navigation landmark name; defaults to `Pagination`. |

`PaginationItem` is a page number or the literal `"ellipsis"`. The caller owns the visible item calculation and must provide unique page numbers within `1..totalPages`, include `currentPage` exactly once, and include at most one ellipsis. `currentPage` alone owns the active state, while `totalPages` owns previous/next boundaries; `items` owns only the visible sequence. There is no responsive variant because the canonical desktop and mobile geometry is the same.

### Accessibility and keyboard

- The root is a named `nav`; controls are native `button type="button"` elements.
- The current page exposes `aria-current="page"`; each page and direction control has an accessible label.
- Previous and next use native disabled state at their respective boundaries while preserving the canonical visual opacity.
- Requests for the current page, a non-integer page, or a page outside `1..totalPages` are suppressed before `onPageChange`.
- Tab, Enter, and Space behavior is native; focus-visible uses Stock Radar focus tokens.

### Usage

```tsx
<Pagination
  currentPage={page}
  items={[1, 2, 3, "ellipsis", totalPages]}
  onPageChange={setPage}
  totalPages={totalPages}
/>
```

The current dashboard still supplies a no-op callback because pagination is a canonical mock. This extraction does not add pagination behavior.

## 13. Phase 3C Boundaries and Deferred Work

- `components/ui` contains only the business-neutral Pagination contract.
- `components/market` owns ticker/market-value semantics, impact mapping, row interaction, and the cell-specific chart action.
- `MarketMoversTable` retains mock-data coupling, result/page calculations, mode mapping, table shell/header, column geometry, and rows-per-page UI.
- Event label/tone mapping stays in the existing dashboard `EventBadge` wrapper; generic Badge remains business-neutral.
- Generic data-table engines, sorting, filtering, data fetching, active-filter chips, responsive table shells, panels, sheets, popovers, chart controls, and real pagination remain deferred.

These remain deferred because they combine broader layout, domain state, responsive composition, focus management, or container-specific interaction beyond the demonstrated 3C contracts.

## 14. StockRadarAppShell

### Purpose and files

- Component: `components/shell/StockRadarAppShell.tsx`
- Styles: `components/shell/StockRadarAppShell.module.css`
- Purpose: Stock Radar page canvas, product header, and exactly one main-content landmark.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `activeNavigationItem` | `StockRadarPrimaryNavigationKey` | yes | Single source of truth for the active product navigation item. |
| `children` | `ReactNode` | yes | Full-width page-owned content rendered inside the main landmark. |

The shell owns the canonical page background, minimum viewport height, Stock Radar typography inheritance, scrollbar treatment, hidden legacy theme toggle, product header, and `main#stock-radar-main-content`. It does not own page maximum width, gutters, table/detail grids, sidebars, filters, panels, sheets, or data state.

The dashboard passes its workspace and mobile sheets as the content slot. Its table/detail split remains in `StockRadarDashboardV2.module.css` and is not normalized for other routes.

### Server and client boundary

- `StockRadarAppShell` has no `"use client"` directive and is composed by the Server Component route in `app/dashboard-v2/page.tsx`.
- `StockRadarProductHeader` is the only shell component that declares `"use client"`; it owns the mobile-menu state, refs, document listeners, and focus restoration.
- Desktop/mobile navigation renderers and the navigation configuration contain no hooks or browser APIs. They enter the client graph only through ProductHeader.
- The `children` slot remains server-compatible. Dashboard-v2 is already a Client Component for its own market, filter, and sheet state; the shell does not move otherwise-server page content across a client boundary.

### Usage

```tsx
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";

<StockRadarAppShell activeNavigationItem="markets">
  <PageOwnedLayout />
</StockRadarAppShell>
```

A skip link was not added in 3D. Introducing its focus placement and visible focus treatment would create a new interaction contract not present in the approved baseline; the stable main ID leaves that work possible in a later accessibility phase.

## 15. StockRadarProductHeader

### Purpose and files

- Component: `components/shell/StockRadarProductHeader.tsx`
- Styles: `components/shell/StockRadarProductHeader.module.css`
- Purpose: canonical brand/status, desktop product navigation, inert header actions, and mobile menu trigger/state.
- Replaced component: deleted `components/dashboard-v2/DashboardHeader.tsx`.

### Props

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `activeNavigationItem` | `StockRadarPrimaryNavigationKey` | yes | Passed unchanged to desktop and mobile navigation renderers. |

Product name `STOCK RADAR` and market status `15m delayed` are exported product constants in `stockRadarNavigation.ts`; they are not dashboard data or customizable speculative props. Header height, padding, surface, divider, brand geometry, status dot, action spacing, and the 760 px breakpoint preserve the canonical computed values.

### Header actions and ARIA

- Alert, Settings, and mobile menu actions reuse `IconButton`; the alert keeps its indicator.
- Search keeps its existing icon-plus-text native button because the header IconButton contract is icon-only. It remains inert.
- Search, Alert, and desktop Settings do not advertise `aria-haspopup`, `aria-expanded`, or `aria-controls` because no popup exists.
- Only the mobile menu trigger exposes `aria-haspopup="menu"` and boolean `aria-expanded`. `aria-controls` is present only while the matching menu DOM exists.
- None of the inert actions gained new search, notification, settings, auth, or Premium behavior.

## 16. Navigation Configuration and Desktop Navigation

### Files and data contract

- Configuration: `components/shell/stockRadarNavigation.ts`
- Renderer: `components/shell/StockRadarDesktopNavigation.tsx`
- `StockRadarPrimaryNavigationKey`: markets, feed, watchlist, news, filings, alerts, calendar, or premium.
- `StockRadarNavigationKey`: a primary navigation key or the mobile-only Settings action key.
- Link item: `{ kind: "link", key, label, href, premium? }`.
- Inert mobile action: `{ kind: "action", key: "settings", label: "Settings" }`.

The shared primary list retains Markets, Live Feed, Watchlist, News, Filings, Alerts, Calendar, and Premium in that order. Every primary href corresponds to an existing route. Active state is derived only from `activeNavigationItem`; it is not duplicated in configuration. Premium retains its separate accent contract.

Desktop navigation renders native anchors and the current item uses `aria-current="page"`. Labels and hrefs are declared once and shared with mobile rendering. The configuration contains no React nodes, route creation, dashboard selection state, or mock market data.

`StockRadarDesktopNavigation` accepts one required prop: `activeItem: StockRadarPrimaryNavigationKey`.

## 17. Mobile Product Navigation

### Purpose and files

- Component: `components/shell/StockRadarMobileNavigationMenu.tsx`
- Menu ID: `stock-radar-mobile-navigation-menu`, distinct from ticker and filter sheet IDs.
- State owner: `StockRadarProductHeader`.

| Prop | Type | Required | Contract |
| --- | --- | --- | --- |
| `activeItem` | `StockRadarPrimaryNavigationKey` | yes | Applies `aria-current="page"` to the matching link. |
| `menuRef` | `Ref<HTMLDivElement>` | yes | Gives ProductHeader the rendered popover boundary for outside-pointer detection. |
| `onItemActivate` | `(item: StockRadarNavigationItem) => void` | yes | Reports one activated link/action so ProductHeader can close the popover. |

The menu reuses the primary link configuration and appends Settings as an inert native button rather than the previous fake `#settings` anchor. Link and action items remain visually identical to the baseline; activating any item closes the menu.

### Interaction contract

- Hamburger pointer, Enter, and Space toggle the menu through native IconButton behavior.
- A second trigger activation, document-level outside pointerdown, Escape, or item activation closes the menu.
- Escape explicitly restores focus to the opener. The opener naturally retains focus on trigger toggles; the inert Settings action restores it after close. Link activation prioritizes route navigation.
- The canonical compact popover is non-modal: it has no visible X, dim overlay, focus trap, or body scroll lock. Body overflow remains untouched, and click-away handling replaces an overlay. This preserves the approved open-menu geometry and avoids ownership conflicts with ticker/filter modal sheets.
- Closed menu DOM is not rendered, so it cannot intercept pointer events. The product popover uses its own z-index below the dashboard filter sheet and does not share IDs or overlays with either sheet.

## 18. Phase 3D Boundaries and Deferred Work

- `components/shell` owns only Stock Radar canvas, brand/status, product navigation, header actions, and the canonical mobile product menu.
- `app/dashboard-v2/page.tsx` supplies `activeNavigationItem="markets"`; `StockRadarDashboardV2` owns only market/session/filter/ticker state and page content.
- Dashboard workspace, page-specific gutters, detail grid, table, panels, ticker/filter sheets, rows-per-page, and chart controls remain page-owned.
- Generic layout variants, max-width containers, generic popovers, modal/focus-trap frameworks, skip-link presentation, actual action behavior, new routes, auth, and Premium behavior remain deferred.
