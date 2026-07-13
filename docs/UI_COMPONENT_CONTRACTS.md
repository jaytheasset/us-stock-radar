# Stock Radar UI Component Contracts

Phase: 3A/3B - foundational shared components and filter controls

Canonical visual baseline: commit `f87660f` and `docs/ui-reference/dashboard-v2/`

Token foundation: commit `7280394`, `app/stock-radar-tokens.css`, and `docs/UI_DESIGN_TOKENS.md`

This phase extracts only IconButton, SegmentedControl, and Badge. The contracts preserve the canonical dashboard-v2 DOM behavior and computed presentation. They do not introduce routing, data, filtering, chart, panel, popover, or sheet abstractions.

## 1. IconButton

### Purpose and files

- Component: `components/ui/IconButton.tsx`
- Styles: `components/ui/IconButton.module.css`
- Purpose: accessible icon-only header actions with an explicit button reset, size, indicator, disabled state, and focus-visible state.
- Current dashboard use: alert, settings, and mobile-menu actions in `components/dashboard-v2/DashboardHeader.tsx`.

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
- Table chart action remains local because stop-propagation and selected-row interaction belong to the market-row contract.
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

ImpactBadge remains local. It is borderless impact text with different weight and status semantics, not the bordered event-label contract. Combining it would require an oversized appearance API and weaken both components.

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

## 8. Deferred Beyond Phase 3B

- Desktop market table and mobile market row
- Pagination and rows-per-page controls
- Panel and detail-panel shells
- Navigation popover
- Bottom-sheet shell, overlay, handle, and close control
- Active-filter chip contract
- Chart range control and chart toolbar
- Chart shell
- Impact label contract

These remain deferred because they combine layout, domain state, responsive composition, focus management, or container-specific interaction beyond the demonstrated filter-control contracts.
