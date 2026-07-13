# Stock Radar Dashboard v2 UI Baseline Audit

Audit date: 2026-07-13

Canonical route: `/dashboard-v2`

Canonical Git branch: `ui/dashboard-v2-redesign`

Canonical Git commit: `23eda75` (`fix: replace mobile table with responsive market list`)

Render mode used for the audit: local Next.js production build (`next start`)

This document records the UI that exists at the commit above. It is descriptive, not a redesign specification. Values marked **Canonical current** are the values to preserve when phase 2 introduces tokens and shared components. Values marked **Exception** are observed differences that must not be silently normalized without a separate design decision.

## 1. Canonical Reference

- `/dashboard-v2` is the canonical visual reference for the first Stock Radar UI-system pass.
- Desktop canonical state is a two-column market-movers table plus ticker detail panel.
- Mobile canonical state is a no-horizontal-scroll, three-area market list. It is not the desktop table scaled down.
- Initial state is `Top Gainers` + `Regular`, with CRWD selected. State is defined in `components/dashboard-v2/StockRadarDashboardV2.tsx:33-40` and `lib/mock/dashboardV2Data.ts:849-920`.
- The alternate selected-state screenshots click AMD. Desktop replaces the right detail content; mobile opens the ticker detail bottom sheet.
- Mock rows and detail data are deterministic. There is no API, auth, database, or TradingView dependency on this route.
- The bottom-sheet animation is 170 ms; selected-state screenshots were captured after animation completion. See `components/dashboard-v2/StockRadarDashboardV2.module.css:1050-1059`, `1659`, and `1838`.

No AGENTS.md file exists in this repository. Project guidance was reviewed in `README.md` and the existing top-level documents under `docs/`. Those documents establish data ownership and schema constraints but do not define an existing UI system.

## 2. Reviewed Routes and Files

### Route and composition

| File | Responsibility | Relevant locations |
| --- | --- | --- |
| `app/dashboard-v2/page.tsx` | Route metadata and dashboard render | `1-11` |
| `components/dashboard-v2/StockRadarDashboardV2.tsx` | Client state, desktop/mobile composition, row selection, filter state | `1`, `32-107` |
| `components/dashboard-v2/StockRadarDashboardV2.module.css` | All dashboard-specific visual rules and responsive behavior | `1-1993` |
| `lib/mock/dashboardV2Data.ts` | Tabs, sessions, 25-row lists, selected ticker, detail mock generation | `1-74`, `841-988` |

### UI components

| File | Responsibility | Relevant locations |
| --- | --- | --- |
| `components/dashboard-v2/DashboardHeader.tsx` | Brand, desktop nav, actions, mobile menu popover | `6-20`, `22-132` |
| `components/dashboard-v2/SegmentedTabs.tsx` | Market-mover and session segmented controls | `1-39` |
| `components/dashboard-v2/FilterBar.tsx` | Desktop filters, mobile quick filters, active chips | `24-99` |
| `components/dashboard-v2/dashboardV2FilterConfig.ts` | Typed filter state, labels, sections, options | `1-80` |
| `components/dashboard-v2/MarketMoversTable.tsx` | Desktop table, mobile list mode, selected row, pagination | `6-141` |
| `components/dashboard-v2/TickerDetailPanel.tsx` | Desktop detail shell | `1-17` |
| `components/dashboard-v2/TickerDetailContent.tsx` | Shared summary, chart, events, CTA | `6-61` |
| `components/dashboard-v2/MobileTickerBottomSheet.tsx` | Mobile ticker dialog and scroll targeting | `8-95` |
| `components/dashboard-v2/MobileFilterBottomSheet.tsx` | Mobile filter dialog and filter actions | `11-129` |
| `components/dashboard-v2/MockChart.tsx` | SVG mock chart, ranges, chart tools | `4-149` |
| `components/dashboard-v2/EventTimeline.tsx` | Recent-events timeline | `4-27` |
| `components/dashboard-v2/EventBadge.tsx` | Event label mapping and badge class | `3-20` |
| `components/dashboard-v2/ImpactBadge.tsx` | Impact label and class | `1-9` |

### Project-level dependencies and styles

- `app/layout.tsx:1-40` imports `app/globals.css`, renders `ThemeToggle`, and does not load a web font.
- `app/globals.css:2852-2889` provides global box sizing, body typography, and button defaults that still cascade into dashboard-v2.
- `package.json:37` provides `lucide-react` (`^1.16.0`).
- No Tailwind configuration, `@tailwind` directive, Tailwind arbitrary values, or dashboard inline `style` prop was found.
- The CSS Module uses `:global(.dashboard-v2-...)` selectors. Naming scopes the rules by prefix, while `.root` itself only adds `isolation: isolate` (`components/dashboard-v2/StockRadarDashboardV2.module.css:1-3`).

## 3. Viewport and Responsive Rules

### Official baseline viewports

| Name | Screenshot viewport | CSS client width during scrollable initial state | Baseline |
| --- | ---: | ---: | --- |
| Mobile | 390 x 844 | 375 px | Required |
| Small mobile | 375 x 812 | 360 px | Required |
| Desktop | 1440 x 900 | 1425 px | Required |
| Large desktop | 1920 x 1080 | 1905 px | Required |

The 15 px difference is the browser vertical scrollbar. Screenshot files retain the exact requested outer viewport dimensions.

### Source breakpoints

| Rule | Current behavior | Source |
| --- | --- | --- |
| Base, above 1320 px | Two columns; controls share one row | CSS `265-329` |
| `max-width: 1320px` | Two columns remain, detail becomes 390-420 px; control groups stack | CSS `1086-1100` |
| `1181-1320px` | Detail title/chart/timeline compact and reflow | CSS `1102-1148` |
| `max-width: 1180px` | Workspace becomes one column; detail panel moves below table | CSS `1150-1173` |
| `max-width: 760px` | Mobile header, quick filters, mobile market list; desktop detail hidden; sheets enabled | CSS `1175-1993` |

The React mobile interaction test uses the same `max-width: 760px` threshold in `components/dashboard-v2/StockRadarDashboardV2.tsx:41-47` and `components/dashboard-v2/MobileTickerBottomSheet.tsx:27-32`.

## 4. Layout Measurements

Measurements below are rendered `getBoundingClientRect()` values. Minor fractional values come from browser layout rounding.

| Element | 1440 x 900 | 1920 x 1080 | 390 x 844 | 375 x 812 |
| --- | ---: | ---: | ---: | ---: |
| Header | 1424.8 x 56 | 1904.8 x 56 | 375.2 x 72.2 | 360 x 72.2 |
| Workspace | 1424.8 x 1383.8 | 1904.8 x 1321.8 | one column | one column |
| Left market area | 971.2 px wide | 1300 px wide | 375.2 px wide | 360 px wide |
| Desktop detail panel | 453.6 x 844 | 604.8 x 972.9 | hidden | hidden |
| Primary tabs | 455.2 x 41.6 | source max 456 px | 301.6 x 43.6 | 301.6 x 43.6 |
| Session tabs | 437.2 x 41.6 | source max 438 px | 301.6 x 36.6 | 301.6 x 36.6 |
| Mobile quick filters | hidden | hidden | 351.2 x 34 | 336 x 34 (derived from 12 px side padding) |
| Table/list panel | 914.4 px wide | about 1242 px wide | 351.2 px wide | 336 px wide |
| Desktop data row | 43 px | 43 px | n/a | n/a |
| Mobile list row | n/a | n/a | 349.6 x 48 | 334.4 x 48 |

### Page width and outer spacing

- There is no dashboard maximum width. The route fills the viewport (`components/dashboard-v2/StockRadarDashboardV2.module.css:5-30`, `265-270`).
- Desktop left content padding is `20px 28px 18px` (`272-277`).
- Mobile left content padding is `12px` (`1304-1306`).
- Header desktop padding is `0 24px 0 30px`; mobile padding is `14px` (`69-79`, `1175-1182`).
- Desktop detail is sticky at `top: 56px` with `max-height: calc(100vh - 56px)` (`707-714`).

### Table width behavior

- Desktop table canonical minimum width is 1060 px, fixed layout (`394-401`).
- At 1440, the measured table is 1088 px inside a 914.4 px panel, so the table has about 173.6 px horizontal overflow. This is a current exception, not a mobile rule.
- At 1920, the table fits without horizontal overflow.
- Mobile explicitly removes table horizontal scrolling, changes the table to a block/grid list, and sets `min-width: 0` (`1377-1408`). Document width equals client width at both mobile baselines.
- All three market tabs contain 25 rows (`components/dashboard-v2/MarketMoversTable.tsx:20-23`, `lib/mock/dashboardV2Data.ts:841-847`).

## 5. Typography Inventory

### Font families

| Scope | Canonical current | Source / verification |
| --- | --- | --- |
| Dashboard | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | CSS `30`; computed style identical |
| App body | `Arial, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif` | `app/globals.css:2863-2869`; computed style identical |
| Chart axes/OHLC | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` | CSS `859-864` |

No `@font-face`, `next/font`, or loaded `FontFace` entry exists. The dashboard declares Inter, but whether Inter is physically rendered depends on a locally installed font. This is an open baseline dependency.

### Desktop type scale

| Role | Size / weight / line-height | Source |
| --- | --- | --- |
| Brand | 25 / 760 / 1 | CSS `106-112` |
| Delayed label | 14 / 400 / body line-height 20.3 px | CSS `114-120` |
| Primary nav | 13 / 680 / 1 | CSS `148-163` |
| Segment tabs | 13 / 700 / inherited 18.85 px | CSS `302-311`; computed |
| Desktop filter label | 12 / 760 | CSS `341-350` |
| Desktop filter value | 13 / 500 | CSS `352-359` |
| Table header | 12 / 780 | CSS `412-420` |
| Table body | 14 / 400 / 1 | CSS `422-429` |
| Ticker | 14 / 760 / 1 | CSS `504-509` |
| Event badge | 11 / 780 / 1 | CSS `534-545` |
| Impact | 12 / 800 / 1 | CSS `579-587` |
| Footer | 13 / 400 / 1 | CSS `639-649` |
| Detail ticker | 34 / 800 / 1 | CSS `738-744` |
| Detail company | 14 / 400 | CSS `746-749` |
| Detail price | 29 / 760 / 1 | CSS `756-761` |
| Detail change | 17 / 760 | CSS `763-767` |
| Detail badge | 13 / 780 / 13 px computed line-height | CSS `779-784` |
| Range tabs | 13 / 720 | CSS `804-813` |
| Timeline heading | 14 / 760 | CSS `922-928` |
| Timeline title | 14 / 540 / 1.3 | CSS `998-1006` |
| Timeline time | 12 / 400 | CSS `1008-1012` |
| Timeline impact | 12 / 780 | CSS `1014-1019` |
| Analysis CTA | 15 / 800 | CSS `1025-1044` |

### Mobile type scale

| Role | Size / weight / line-height | Source |
| --- | --- | --- |
| Brand | 22 / 760 / 1 | CSS `1193-1195`; base weight from `106-112` |
| Delayed label | 12 / 400 | CSS `1197-1199` |
| Primary tab | 11.5 / 700 / 1.25 | CSS `1319-1325` |
| Session tab | 11.5 / 700 / 1.15 | CSS `1327-1332` |
| Quick filter label | 11 / 760 / 1 | CSS `1366-1375` |
| Mobile row base | 13 / 400 / 1.15 | CSS `1419-1430` |
| Rank | 12 / 720 / 1.15 | CSS `1440-1448` |
| Ticker | 13.5 / 760 / 1 | CSS `1463-1469` |
| Company | 12 / 400 / 1.1 | CSS `1471-1478` |
| Main value | 14 / 800 / 1 | CSS `1489-1496` |
| Secondary value | 12 / 700 / 1.1 | CSS `1498-1504` |
| Sheet ticker | 31 / 800 / 0.98 | CSS `1901-1904` |
| Sheet company | 13 / 400 / 1.35 | CSS `1906-1910` |
| Sheet price | 26 / 760 / 1 | CSS `1923-1926` |
| Sheet change | 15.5 / 760 | CSS `1928-1930` |

## 6. Color Inventory

### Canonical current CSS variables

Defined at `components/dashboard-v2/StockRadarDashboardV2.module.css:5-23`.

| Candidate role | Current value | Current usage |
| --- | --- | --- |
| `background.canvas` | `#080a0d` | Page gradient end |
| `background.soft` | `#0d1014` | Detail gradient |
| `surface.1` | `#11161b` | Declared; only reused as sheet CTA base later |
| `surface.2` | `#161b20` | Declared but unused |
| `surface.3` | `#1b2026` | Declared but unused |
| `border.default` | `#2c333a` | Tabs, filters, select |
| `border.subtle` | `#20262c` | Header, table rows, panels, timeline |
| `text.primary` | `#e5e8ec` | Page text |
| `text.muted` | `#9aa2ad` | Declared but not consumed through `var()` |
| `text.faint` | `#6f7782` | Declared but not consumed through `var()` |
| `accent.orange` | `#ff7a1a` | Active controls, high impact, selection |
| `accent.orangeWeak` | `rgba(255,122,26,0.13)` | Active segment background |
| `semantic.positive` | `#50e386` | Positive change, low impact |
| `semantic.negative` | `#ff675f` | Negative change, legal |
| `event.earnings` | `#36d5c2` | Earnings badge/marker |
| `event.insider` | `#bc8cff` | Insider badge/marker |
| `event.transaction` | `#5cadff` | M&A/listing badge/marker |
| `event.product` | `#f4c542` | Product and medium impact |

### Surface and text exceptions

- Page background also hard-codes `#0b0d10` and an orange radial tint (`27-29`).
- Header uses `rgba(10,12,15,0.92)` (`77`).
- Table panel uses `rgba(12,15,18,0.95)` and rows use `rgba(12,15,18,0.86)` (`382-387`, `422-427`).
- Detail text uses separate hard-coded whites/grays: `#dadde3`, `#bdc3cb`, `#f0f3f6`, `#d9dde3`, and `#8a929d` (`738-767`, `998-1012`).
- Mock chart bullish/bearish colors are `#3dd985` and `#f45c55`, not the page semantic variables (`893-899`). The last-price pill is a third green, `#3acb83` (`906-908`).
- CTA uses `#ff8b2e`, `#ff9a3c`, and several orange alpha values instead of one accent token (`1025-1044`).
- Mobile sheet/menu surfaces use `#0d1116`, distinct from the declared panel variables (`1242-1257`, `1643-1659`, `1823-1838`).

## 7. Spacing and Sizing Inventory

### Header and navigation

- Desktop header: 56 px minimum height; 18 px main gap; 30 px left and 24 px right padding (`69-79`).
- Brand-to-delay gap: 24 px; delay-to-dot gap: 9 px (`100-128`).
- Desktop nav item: 30 px high, `0 9px` padding, 4 px radius, 4 px nav gap (`130-163`).
- Header actions: 14 px gap; icon button width 34 px; action minimum height 38 px (`215-242`).
- Mobile header: measured 72.2 px high, 14 px padding, 8 px main gap, 6 px action gap; icon actions are 32-34 px (`1175-1239`).
- Mobile popover: 216 px computed width at the 390 baseline, 12 px right offset, 68 px top, 36 px rows (`1242-1298`).

### Controls

- Desktop market and session tabs: 40 px button minimum height; panel heights compute to 41.6 px with borders (`284-320`).
- Desktop primary group: max 456 px; session group: max 438 px (`292-300`).
- Desktop filters: 40 px internal minimum height, 10 px group gap, 18 px top/bottom margins (`323-374`).
- Mobile primary tabs: 42 px minimum button height; session tabs: 35 px (`1312-1332`).
- Mobile quick filter: 34 px minimum height, 4 px grid gap, `0 4px` padding (`1338-1375`).
- Active filter chip: 28 px minimum height and pill radius (`1536-1557`).

### Data table and mobile list

- Desktop header row: 46 px; body row: 43 px; horizontal cell padding: 12 px (`403-429`).
- Desktop column widths: 42, 238, 108, 94, 112, 110, 220, 116, and 48 px (`445-493`).
- Ticker cell uses a 54 px ticker track plus flexible company track and a 7 px gap (`495-502`).
- Event badges are 22 px high with `0 7px` padding and 6 px group gap (`528-545`).
- Chart icon button is nominally 30 x 30 (`602-615`).
- Mobile row is a 3-column, 2-row grid: `26px minmax(0,1fr) minmax(76px,max-content)`, 8 px column gap, `7px 10px` padding, 48 px minimum height (`1396-1408`).
- Mobile company names are single-line ellipsis (`1471-1478`). Numeric values are right aligned and `nowrap` (`1480-1504`).

### Detail, chart, timeline, and sheets

- Desktop detail header padding: `44px 58px 24px 28px` (`729-732`).
- Chart nav minimum height: 50 px; range gap: 18 px; tool gap: 12 px (`791-841`).
- Timeline outer padding: `20px 28px 22px`; item tracks: 14 px marker + flexible content, 12 px gap (`917-939`).
- CTA: 58 px minimum height, `24px 28px 32px` margin (`1025-1044`).
- Ticker sheet: 90dvh capped by `100dvh - 28px`, 22 px top radius, internal vertical scroll (`1823-1840`).
- Filter sheet: 82dvh capped by `100dvh - 54px`, 22 px top radius (`1643-1660`).
- Both handles are 46 x 4 at top 12 px and centered with `left: 50%` (`1662-1672`, `1842-1852`).
- Both close controls render 38 x 38 at top/right 16 px; SVG is forced to 18 x 18 (`1674-1696`, `1854-1876`).

## 8. Borders, Radius and Shadows

| Role | Canonical current | Source |
| --- | --- | --- |
| Standard border | 1 CSS px using `--dash-v2-border` or `--dash-v2-border-soft` | CSS `11-12`, throughout |
| Segments/filters/table/CTA radius | 5 px | CSS `288`, `335`, `385`, `1034` |
| Mobile control radius | 7 px | CSS `1316`, `1354` |
| Mobile menu popover | 12 px | CSS `1251` |
| Mobile menu row | 8 px | CSS `1277` |
| Bottom sheet top radius | 22 px | CSS `1654`, `1833` |
| Badge radius | 4 px base; 5 px in detail | CSS `540`, `781` |
| Pill radius | 999 px | Scrollbar thumb, chips, handles, close controls, filter options |
| Table panel shadow | `0 18px 52px rgba(0,0,0,.24)` | CSS `387` |
| Active page shadow | inset bottom orange line | CSS `165-170` |
| Selected row | inset top/bottom orange; left red; right orange | CSS `618-637`, mobile `1519-1526` |
| Ticker sheet shadow | `0 -28px 70px rgba(0,0,0,.56)` | CSS `1837` |
| Filter sheet shadow | `0 -22px 48px rgba(0,0,0,.44)` | CSS `1658` |
| Menu shadow | `0 16px 36px rgba(0,0,0,.38)` | CSS `1256` |

Browser computed borders appear as 0.8 px in the capture environment because of device/browser scaling. Source intent is 1 CSS px and should be tokenized as such.

## 9. Icon Rules

### Sources

- Primary icon source: `lucide-react` (`package.json:37`).
- Header imports `Bell`, `Menu`, `Search`, `Settings` (`components/dashboard-v2/DashboardHeader.tsx:4`).
- Filters import `ChevronDown`, `SlidersHorizontal`, `X` (`components/dashboard-v2/FilterBar.tsx:1`).
- Table imports `BarChart3`, `ChevronLeft`, `ChevronRight` (`components/dashboard-v2/MarketMoversTable.tsx:1`).
- Detail/sheets import Lucide `X` and `ChevronRight`.
- Chart tools import `CandlestickChart`, `LineChart`, `SlidersHorizontal`, `Expand` (`components/dashboard-v2/MockChart.tsx:1`).
- Pagination rows-per-page chevron is a local inline SVG with 1.6 stroke (`components/dashboard-v2/MarketMoversTable.tsx:136-140`).
- Candles, axes, volume, and grid are a custom SVG chart (`components/dashboard-v2/MockChart.tsx:68-146`).

### Sizes and strokes

| Context | Source size | Effective stroke rule |
| --- | ---: | --- |
| Search/Bell/Settings | 18 | Header forces 1.8 (`CSS:234-237`) |
| Mobile hamburger | 19 | Header forces 1.8 |
| Desktop filter icons | 15 | Lucide default unless inherited |
| Mobile quick-filter icons | 12 | Width/height also fixed at 12 (`1528-1534`) |
| Table chart icon | 18 | 1.8 (`602-615`) |
| Desktop detail close | 22 | Lucide default |
| Mobile ticker close | source 20, CSS-rendered 18 | 2.25 (`1871-1876`) |
| Mobile filter close | 18 | 2.25 (`1691-1696`) |
| Chart tools | 17 | Lucide default |
| CTA chevron | 22 | Lucide default |

Canonical icon style is outline-only with round Lucide geometry. There is no formal icon-size token or shared icon-button component yet.

## 10. Component Inventory

| Visual pattern | Current implementation | Current variants | Phase-2 extraction boundary |
| --- | --- | --- | --- |
| App header | `DashboardHeader` | Desktop nav, mobile actions/popover | Stock Radar header + nav item + icon action |
| Segmented control | `SegmentedTabs` | `primary`, `session` | Shared segmented control with size/density variants |
| Filter trigger | `FilterBar` markup | Desktop compound trigger, mobile quick trigger | FilterTrigger + ActiveFilterChip |
| Filter dialog | `MobileFilterBottomSheet` | Mobile only | Shared BottomSheet shell + filter content |
| Market data display | `MarketMoversTable` | Desktop table, mobile list, change/volume mobile value mode | DataTable shell + MarketMoverListRow |
| Event badge | `EventBadge` | 8 event types | Semantic Badge component |
| Impact text | `ImpactBadge` | major/high/medium/low | Semantic text/badge tone |
| Ticker detail | `TickerDetailContent` | Desktop panel/mobile sheet | TickerSummary + shared detail sections |
| Chart frame | `MockChart` | One mock chart state | ChartPanel shell, controls, provider slot |
| Timeline | `EventTimeline` | Event type and impact tones | EventTimeline + EventTimelineItem |
| Overlay shell | Separate ticker/filter markup | 90dvh ticker, 82dvh filter | Shared BottomSheet primitives |
| Mobile menu | Header-local popover | Active and premium rows | Popover/Menu primitives |
| CTA | Inline detail button | Desktop and sticky mobile | AnalysisCTA/button variant |

## 11. Interaction and State Rules

### Implemented states

- Active nav: orange text, orange-tinted background, orange border and inset bottom line (`CSS:165-170`).
- Active segmented tab: orange text/background and 1 px inset outline (`317-320`).
- Table row hover: `#11171c` (`431-433`).
- Table row keyboard focus: row background plus orange outline; mobile uses a row outline (`439-443`, `1414-1417`).
- Selected row: orange-tinted fill and inset outline without changing row height (`618-637`, `1519-1526`).
- Positive/negative: green/red with tabular numerals (`518-526`).
- Active mobile filter/option/chip: orange border/text/tint (`1360-1364`, `1544-1557`, `1765-1769`).
- Mobile menu active item: subtle orange tint/text plus 2 px left bar (`1285-1294`).
- Focus rings exist for the mobile menu, sheets, filter options, and chips (`1260-1264`, `1698-1705`, `1878-1881`).
- No disabled component state or disabled visual rule exists.

### Implemented behavior

- Market mover tab changes the 25-row mock dataset. Session tabs only change visual state (`components/dashboard-v2/StockRadarDashboardV2.tsx:33-40`, `65-77`).
- Desktop row click changes the right detail panel. Mobile row click changes selection and opens the ticker bottom sheet (`41-48`, `85-100`).
- Chart button stops row propagation and requests the chart section (`components/dashboard-v2/MarketMoversTable.tsx:96-108`). On desktop this only changes the selected detail. On mobile the chart column is currently hidden, so this path has no visible mobile trigger.
- Mobile ticker sheet locks body scroll, focuses close, and scrolls to summary/chart (`components/dashboard-v2/MobileTickerBottomSheet.tsx:25-50`). It closes by X, overlay, or Escape bubbling through the sheet root (`56-92`).
- Mobile filter sheet locks body scroll and closes by X, overlay, global Escape, or Apply (`components/dashboard-v2/MobileFilterBottomSheet.tsx:28-58`, `64-126`).
- Mobile menu closes on item selection, outside pointerdown, repeated hamburger click, or Escape (`components/dashboard-v2/DashboardHeader.tsx:27-55`, `92-128`).

### Presentational controls without behavior

- Desktop filter triggers and desktop More Filters have no click handler (`components/dashboard-v2/FilterBar.tsx:42-58`).
- Search, Alerts, Settings, chart ranges/tools, desktop detail close, pagination, rows-per-page, and View Full Analysis are presentational mock controls.
- Filter option state is visible, but rows are not filtered. Session state does not affect rows.

## 12. Desktop vs Mobile Behavior

| Area | Desktop | Mobile (`<=760px`) |
| --- | --- | --- |
| Header nav | Full 8-item nav | Text nav hidden; Search, Bell, hamburger shown; Settings hidden |
| Global menu | Inline nav | 216 px top-right popover with 9 items |
| Controls | Primary/session side by side above 1320 | Stacked compact groups |
| Filters | Market Cap, Price, Volume, Event Type, Signal, More Filters | Mkt Cap, Price, Event, More quick row; full options in filter sheet |
| Market movers | Nine-column table, 1060 px minimum | Three-area list: rank, ticker/company, primary/secondary value |
| Top Gainers/Losers value | Change and all desktop columns | Change is primary, price secondary |
| Top Volume value | Volume and all desktop columns | Volume is primary, change secondary |
| Mobile-hidden data | n/a | Header row, market cap, events, impact, chart icon, and unused value column |
| Selection | Updates right detail | Updates row and opens ticker sheet |
| Detail | Sticky right panel above 1180; stacked panel from 1180 to 761 | Desktop panel hidden; ticker sheet only |
| Footer | One 42 px row | Three stacked groups, measured about 145 px |

Mobile list behavior is defined at `components/dashboard-v2/StockRadarDashboardV2.module.css:1377-1526` and its mode is selected in `components/dashboard-v2/StockRadarDashboardV2.tsx:85-90`.

## 13. Existing Inconsistencies

These are findings only. Phase 1 does not fix them.

1. **Declared Inter is not bundled.** The dashboard requests Inter, but the app registers no font face. Rendering can differ by machine.
2. **Token variables are partial.** `--dash-v2-panel-2`, `--dash-v2-panel-3`, `--dash-v2-muted`, and `--dash-v2-faint` are declared but unused; many equivalent values are hard-coded.
3. **Multiple values represent the same semantic role.** Positive chart/page greens, bearish/page reds, surface blacks, muted text grays, and CTA oranges diverge.
4. **Global button styles leak into dashboard controls.** `app/globals.css:2877-2889` supplies `padding: 9px 13px`, 6 px radius, and pointer cursor. Dashboard CSS only globally resets button font/letter spacing (`CSS:64-67`). Computed desktop tabs, chart tools, chart buttons, CTA, and overlays therefore inherit values not obvious in their local rules.
5. **1440 desktop still scrolls the table horizontally.** The left panel is narrower than the 1060 px table minimum. Large desktop does not overflow.
6. **Chart labels remain CRWD-specific.** `components/dashboard-v2/MockChart.tsx:43` and `68-69` hard-code CRWD in accessible labels even after selecting AMD or another ticker.
7. **Chart grid price labels are fixed to 332-346.** Selected tickers with another price scale can have semantically incorrect axis labels (`components/dashboard-v2/MockChart.tsx:31`, `77-87`).
8. **Mobile chart-icon flow is unreachable.** The React handler remains, but the mobile list hides the ninth/chart cell (`CSS:1510-1516`). Mobile currently opens detail only from the row.
9. **Ticker and filter sheets duplicate shell markup and styling.** Their heights, z-indexes, close borders, overlays, and shadows differ without shared primitives.
10. **Overlay state is decentralized.** Ticker sheet (`z-index:80`), menu (`86`), and filter sheet (`90`) have independent booleans. There is no shared overlay coordinator.
11. **Sticky mobile CTA can visually cover timeline content.** It is sticky at the bottom without a matching scroll-content bottom offset (`CSS:1983-1992`). This is visible in the selected mobile baseline.
12. **Desktop detail close is non-functional.** The control exists but has no callback (`components/dashboard-v2/TickerDetailPanel.tsx:7-13`).
13. **No disabled state system exists.** Mock controls are either visually active/inactive or unimplemented, but never disabled.
14. **Text weight values are highly granular.** The UI uses 540, 680, 700, 720, 760, 780, and 800. Some browsers/fonts may synthesize those weights.
15. **Breakpoint behavior is not a single desktop/mobile split.** 1320, 1180, and 760 each change composition. Token/component work must retain all three until a deliberate responsive redesign.

## 14. Token Candidates

### Phase-2 priority 1: foundation tokens

| Proposed token family | Canonical seed values |
| --- | --- |
| Canvas/surface | `#080a0d`, `#0d1014`, `#11161b`, `#0d1116` |
| Border | default `#2c333a`, subtle `#20262c`, overlay border `rgba(74,82,92,.78)` |
| Text | primary `#e5e8ec`, strong `#f0f3f6`, muted `#9aa2ad`, faint `#6f7782` |
| Accent | `#ff7a1a`; weak `.13`; focus `.65`; selected `.10` |
| Semantic | positive `#50e386`, negative `#ff675f`, warning `#f4c542` |
| Event tones | earnings `#36d5c2`, legal `#ff675f`, insider `#bc8cff`, transaction `#5cadff`, product `#f4c542` |
| Typography family | dashboard sans stack; chart mono stack |
| Typography sizes | 11, 12, 13, 14, 15, 17, 22, 25, 26, 29, 31, 34 |
| Typography weights | reduce current 540/680/720/760/780/800 set only after visual comparison |

### Phase-2 priority 2: structural and state tokens

- Spacing scale from current repeated values: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32.
- Control heights: 30 nav, 34 quick filter/icon, 35 mobile session, 38 close, 40 desktop control, 42 mobile primary, 43 desktop row, 46 header row, 48 mobile row, 56 header, 58 CTA.
- Radii: 4 badge/nav, 5 dashboard controls/panels, 7 mobile controls, 8 action/menu rows, 12 popover, 22 sheet, full/pill 999.
- Border widths: 1 standard, 2 focus/active bar.
- Shadows: panel, active glow, popover, filter sheet, ticker sheet, CTA.
- Z-index: ticker overlay 80, mobile menu 86, filter overlay 90, local handle 6, close 7.
- Motion: menu 130 ms ease-out; sheets 170 ms ease-out.
- Responsive aliases: `wide <=1320`, `stack <=1180`, `mobile <=760`.

## 15. Shared Component Candidates

Recommended extraction order for phase 2, while preserving this baseline:

1. `IconButton` and `FocusRing` primitives to stop global button leakage.
2. `SegmentedControl` with desktop/mobile density variants.
3. `Badge` with event and impact semantic tones.
4. `FilterTrigger`, `FilterOption`, and `ActiveFilterChip`.
5. `BottomSheet` shell shared by ticker and filter content.
6. `PopoverMenu` and `MenuItem` for the mobile global menu.
7. `MarketMoverDesktopTable` and `MarketMoverMobileRow` under one data/view adapter.
8. `TickerSummary`, `ChartPanel`, `EventTimeline`, and `AnalysisCTA` detail primitives.
9. `DashboardHeader` split into brand, desktop navigation, and mobile actions while retaining one navigation data model.
10. `DataFooter` for result count, pagination, and rows-per-page.

The first extraction should include an explicit local reset for button border, radius, padding, background, cursor, and font so the shared components no longer depend on `app/globals.css` defaults.

## 16. Open Questions / Values That Could Not Be Verified

- Which font file should become canonical? The current declaration requests Inter but does not bundle it. The audit cannot prove the exact locally resolved glyph face on another machine.
- Should the 1440 table horizontal overflow remain canonical or be removed in a later layout pass? Phase 1 records it but makes no choice.
- Are the 1320 and 1180 intermediate breakpoints product requirements or implementation history? They were source-verified but are not official screenshot viewports.
- Should mobile regain a chart-specific row action after the chart cell was hidden? Current baseline has no mobile chart icon.
- Should the sticky mobile CTA intentionally overlay content, or should a future shared sheet reserve space for it?
- Should unimplemented mock controls become disabled, remain inert, or receive routes/actions? No disabled baseline exists.
- Hover and focus values were verified from source and static computed styles, but they are not separate screenshot artifacts in this phase.
- Mock chart data is static and deterministic; actual provider loading, empty, error, and delayed states are not represented.

## 17. Baseline Screenshot Index

All screenshots contain only the rendered app viewport, with no browser chrome or DevTools. Dimensions were verified from the PNG headers after capture.

| File | State | Verified dimensions |
| --- | --- | ---: |
| [`ui-reference/dashboard-v2/mobile-390x844-top-gainers.png`](ui-reference/dashboard-v2/mobile-390x844-top-gainers.png) | Mobile initial, CRWD selected row | 390 x 844 |
| [`ui-reference/dashboard-v2/mobile-390x844-ticker-selected-amd.png`](ui-reference/dashboard-v2/mobile-390x844-ticker-selected-amd.png) | Mobile AMD ticker bottom sheet | 390 x 844 |
| [`ui-reference/dashboard-v2/small-mobile-375x812-top-gainers.png`](ui-reference/dashboard-v2/small-mobile-375x812-top-gainers.png) | Small mobile initial, CRWD selected row | 375 x 812 |
| [`ui-reference/dashboard-v2/small-mobile-375x812-ticker-selected-amd.png`](ui-reference/dashboard-v2/small-mobile-375x812-ticker-selected-amd.png) | Small mobile AMD ticker bottom sheet | 375 x 812 |
| [`ui-reference/dashboard-v2/desktop-1440x900-top-gainers.png`](ui-reference/dashboard-v2/desktop-1440x900-top-gainers.png) | Desktop initial, CRWD detail | 1440 x 900 |
| [`ui-reference/dashboard-v2/desktop-1440x900-ticker-selected-amd.png`](ui-reference/dashboard-v2/desktop-1440x900-ticker-selected-amd.png) | Desktop AMD selected detail | 1440 x 900 |
| [`ui-reference/dashboard-v2/large-desktop-1920x1080-top-gainers.png`](ui-reference/dashboard-v2/large-desktop-1920x1080-top-gainers.png) | Large desktop initial, CRWD detail | 1920 x 1080 |
| [`ui-reference/dashboard-v2/large-desktop-1920x1080-ticker-selected-amd.png`](ui-reference/dashboard-v2/large-desktop-1920x1080-ticker-selected-amd.png) | Large desktop AMD selected detail | 1920 x 1080 |

### Capture stability

- Mock data and SVG candles are deterministic.
- No data polling or time-based content was observed.
- The only capture timing dependency is the 130 ms menu animation and 170 ms sheet animation. Baseline state screenshots do not include the menu, and selected mobile screenshots were captured after the sheet settled.
- Browser console inspection returned no warning or error entries for `/dashboard-v2` during this audit.
