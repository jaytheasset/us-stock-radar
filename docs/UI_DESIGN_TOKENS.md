# Stock Radar UI Design Tokens

Phase: 2 - design token foundation

Canonical visual baseline: commit `f87660f`, `/dashboard-v2`, and `docs/ui-reference/dashboard-v2/`

Implementation branch: `refactor/dashboard-v2-design-tokens`

This document defines the semantic token layer extracted from the canonical dashboard-v2 implementation. It records a value-preserving refactor: no layout, copy, component API, responsive behavior, data, or interaction was intentionally changed.

## 1. Token Source and Loading

- Source of truth: `app/stock-radar-tokens.css`.
- Global load path: `app/layout.tsx` imports `./stock-radar-tokens.css` before `./globals.css`.
- Consumption: dashboard modules and the extracted `components/ui`, `components/market`, and `components/shell` CSS modules use the same global custom properties without component-local token aliases.
- Inline SVG exception: `components/dashboard-v2/MockChart.tsx` uses `var(--sr-color-chart-volume-bullish)` in SVG `stopColor`; browsers resolve the custom property without a JavaScript token mirror.
- Scope: `:root` declares the canonical Dark values. `[data-sr-theme="light"]` overrides only theme-dependent semantic colors and effects inside a Stock Radar shell.

`app/globals.css` was not changed. Its existing global button cascade remains an audited exception rather than being corrected during this phase.

## 2. Naming Convention

All names use the `--sr-` prefix and semantic roles:

```text
--sr-{category}-{role}[-{state|scale|variant}]
```

- `color-*` describes visual purpose, not a palette index.
- `font-*`, `line-height-*`, and `letter-spacing-*` define typography behavior.
- `space-*` is a reusable spacing scale; `page-*` and `header-*` name layout roles.
- `size-*` captures canonical control, row, panel, and overlay dimensions.
- `radius-*`, `shadow-*`, `focus-*`, and `border-*` define shape and effects.
- `z-*` and `motion-*` define layer and transition contracts.
- Equal literal values remain separate when their roles differ. For example, positive market text and chart OHLC text both resolve to `#50e386`, but use distinct semantic tokens.

## 3. Token Inventory

There are 277 unique tokens: 151 color, 2 opacity, 38 typography, 22 spacing, 24 sizing, 25 shape/effect, and 15 layer/motion tokens. The Light selector redefines 142 existing roles; theme-invariant product-chrome roles are declared once in `:root` and deliberately do not receive Light overrides.

### Color: canvas, surfaces, and overlays

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-page-background` (source `app/stock-radar-tokens.css:3`) | `#080a0d` | Semantic page background color. | `components/shell/StockRadarAppShell.module.css:8` |
| `--sr-color-page-background-top` (source `app/stock-radar-tokens.css:4`) | `#0b0d10` | Semantic page background top color. | `components/shell/StockRadarAppShell.module.css:8`<br>`components/ui/IconButton.module.css:29` |
| `--sr-color-page-glow` (source `app/stock-radar-tokens.css:5`) | `rgba(255, 122, 26, 0.07)` | Semantic page glow color. | `components/shell/StockRadarAppShell.module.css:7` |
| `--sr-color-surface` (source `app/stock-radar-tokens.css:6`) | `#0d1014` | Semantic surface color. | `components/ui/DetailPanelShell.module.css:7` |
| `--sr-color-surface-panel` (source `app/stock-radar-tokens.css:7`) | `#11161b` | Semantic surface panel color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:930` |
| `--sr-color-surface-elevated` (source `app/stock-radar-tokens.css:8`) | `#161b20` | Semantic surface elevated color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-surface-overlay` (source `app/stock-radar-tokens.css:9`) | `#0d1116` | Semantic surface overlay color. | `components/ui/BottomSheetShell.module.css:71`<br>`components/ui/BottomSheetShell.module.css:81` |
| `--sr-color-surface-header` (source `app/stock-radar-tokens.css:10`) | `rgba(10, 12, 15, 0.92)` | Legacy theme-dependent header surface role retained for compatibility; canonical product chrome uses its dedicated invariant surface. | Reserved foundation role. |
| `--sr-color-surface-control` (source `app/stock-radar-tokens.css:11`) | `#0e1216` | Semantic surface control color. | `components/ui/FilterTrigger.module.css:11` |
| `--sr-color-surface-control-strong` (source `app/stock-radar-tokens.css:12`) | `#151a1f` | Semantic surface control strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:152`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:196` |
| `--sr-color-surface-control-group` (source `app/stock-radar-tokens.css:13`) | `rgba(10, 13, 16, 0.76)` | Semantic surface control group color. | `components/ui/SegmentedControl.module.css:6` |
| `--sr-color-surface-table-header-start` (source `app/stock-radar-tokens.css:14`) | `#1a1e22` | Semantic surface table header start color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:79` |
| `--sr-color-surface-table-header-end` (source `app/stock-radar-tokens.css:15`) | `#15191d` | Semantic surface table header end color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:79` |
| `--sr-color-surface-table-panel` (source `app/stock-radar-tokens.css:16`) | `rgba(12, 15, 18, 0.95)` | Semantic surface table panel color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:50` |
| `--sr-color-surface-table-row` (source `app/stock-radar-tokens.css:17`) | `rgba(12, 15, 18, 0.86)` | Semantic surface table row color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:90`<br>`components/market/MarketResultRows.module.css:157` |
| `--sr-color-surface-table-hover` (source `app/stock-radar-tokens.css:18`) | `#11171c` | Semantic surface table hover color. | `components/market/MarketResultRows.module.css:8`<br>`components/market/MarketResultRows.module.css:161` |
| `--sr-color-surface-footer-start` (source `app/stock-radar-tokens.css:19`) | `#191e23` | Semantic surface footer start color. | Retained generic foundation role; the current capped market-movers list has no footer. |
| `--sr-color-surface-detail-start` (source `app/stock-radar-tokens.css:20`) | `#101419` | Semantic surface detail start color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:515`<br>`components/ui/DetailPanelShell.module.css:7` |
| `--sr-color-surface-option` (source `app/stock-radar-tokens.css:21`) | `rgba(14, 18, 22, 0.92)` | Semantic surface option color. | `components/ui/FilterOption.module.css:9` |
| `--sr-color-surface-overlay-control` (source `app/stock-radar-tokens.css:22`) | `rgba(13, 17, 22, 0.72)` | Semantic surface overlay control color. | `components/ui/BottomSheetShell.module.css:111` |
| `--sr-color-surface-overlay-footer` (source `app/stock-radar-tokens.css:23`) | `rgba(13, 17, 22, 0.96)` | Semantic surface overlay footer color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:797` |
| `--sr-color-surface-muted-action` (source `app/stock-radar-tokens.css:24`) | `rgba(19, 24, 30, 0.96)` | Semantic surface muted action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:811` |
| `--sr-color-surface-emphasized-action` (source `app/stock-radar-tokens.css:25`) | `#14171b` | Semantic surface emphasized action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:819` |
| `--sr-color-surface-primary-action` (source `app/stock-radar-tokens.css`) | `#ff7a1a` Dark; `rgba(255, 122, 26, 0.9)` Light | Solid primary-action surface. The Light role is deliberately opaque-orange without CTA glow. | `components/premium-v2/StockRadarPremiumV2.module.css` |
| `--sr-color-overlay-content-footer` (source `app/stock-radar-tokens.css:26`) | `rgba(3, 5, 8, 0.66)` | Overlay color for the content-footer sheet layout. | `components/ui/BottomSheetShell.module.css:27` |
| `--sr-color-overlay-full-scroll` (source `app/stock-radar-tokens.css:27`) | `rgba(3, 5, 8, 0.68)` | Overlay color for the full-scroll sheet layout. | `components/ui/BottomSheetShell.module.css:32` |
| `--sr-color-border` (source `app/stock-radar-tokens.css:30`) | `#2c333a` | Semantic border color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:195`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:424`<br>`components/ui/FilterTrigger.module.css:7`<br>`components/ui/FilterTrigger.module.css:24`<br>`components/ui/FilterTrigger.module.css:95`<br>`components/ui/SegmentedControl.module.css:4`<br>`components/ui/SegmentedControl.module.css:22` |
| `--sr-color-divider` (source `app/stock-radar-tokens.css:31`) | `#20262c` | Semantic divider color. | `components/dashboard-v2/StockRadarDashboardV2.module.css`<br>`components/market/MarketResultRows.module.css`<br>`components/ui/DetailPanelShell.module.css` |
| `--sr-color-border-overlay` (source `app/stock-radar-tokens.css:32`) | `rgba(74, 82, 92, 0.78)` | Semantic border overlay color. | `components/ui/BottomSheetShell.module.css:58` |
| `--sr-color-border-overlay-strong` (source `app/stock-radar-tokens.css:33`) | `rgba(74, 82, 92, 0.82)` | Semantic border overlay strong color. | Reserved foundation role; product navigation uses its dedicated invariant menu border. |
| `--sr-color-border-overlay-soft` (source `app/stock-radar-tokens.css:34`) | `rgba(74, 82, 92, 0.58)` | Semantic border overlay soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:746` |
| `--sr-color-border-overlay-actions` (source `app/stock-radar-tokens.css:35`) | `rgba(74, 82, 92, 0.62)` | Semantic border overlay actions color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:795` |
| `--sr-color-border-section` (source `app/stock-radar-tokens.css:36`) | `rgba(52, 59, 68, 0.74)` | Semantic border section color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:767` |
| `--sr-color-border-control` (source `app/stock-radar-tokens.css:37`) | `rgba(71, 79, 90, 0.9)` | Semantic border control color. | `components/ui/FilterOption.module.css:5`<br>`components/ui/FilterOption.module.css:30` |
| `--sr-color-border-close` (source `app/stock-radar-tokens.css:38`) | `rgba(104, 115, 128, 0.58)` | Semantic border close color. | `components/ui/BottomSheetShell.module.css:115` |
| `--sr-color-border-close-soft` (source `app/stock-radar-tokens.css:39`) | `rgba(255, 255, 255, 0.13)` | Semantic border close soft color. | `components/ui/BottomSheetShell.module.css:119` |
| `--sr-color-border-muted-action` (source `app/stock-radar-tokens.css:40`) | `rgba(86, 96, 108, 0.8)` | Semantic border muted action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:809` |
| `--sr-color-text-primary` (source `app/stock-radar-tokens.css:43`) | `#e5e8ec` | Semantic text primary color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:63`<br>`components/shell/StockRadarAppShell.module.css:5` |
| `--sr-color-text-bright` (source `app/stock-radar-tokens.css:44`) | `#f5f6f7` | Semantic text bright color. | `components/feed-chart-lab/FeedChartLab.module.css` |
| `--sr-color-text-strong` (source `app/stock-radar-tokens.css:45`) | `#f0f3f6` | Semantic text strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:240` |
| `--sr-color-text-ticker` (source `app/stock-radar-tokens.css:46`) | `#f0f2f5` | Semantic text ticker color. | `components/market/MarketResultRows.module.css:26`<br>`components/market/MarketResultRows.module.css:208` |
| `--sr-color-text-heading` (source `app/stock-radar-tokens.css:47`) | `#dadde3` | Semantic text heading color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:223` |
| `--sr-color-text-body` (source `app/stock-radar-tokens.css:48`) | `#d7dbe0` | Semantic text body color. | `components/dashboard-v2/StockRadarDashboardV2.module.css`<br>`components/ui/IconButton.module.css` |
| `--sr-color-text-menu` (source `app/stock-radar-tokens.css:49`) | `#d8dde4` | Theme-dependent generic menu text. | Reserved foundation role; product navigation uses invariant product-menu text. |
| `--sr-color-text-timeline` (source `app/stock-radar-tokens.css:50`) | `#d9dde3` | Semantic text timeline color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:477` |
| `--sr-color-text-secondary` (source `app/stock-radar-tokens.css:51`) | `#c0c5cc` | Semantic text secondary color. | `components/market/MarketResultRows.module.css:34` |
| `--sr-color-text-detail-secondary` (source `app/stock-radar-tokens.css:52`) | `#bdc3cb` | Semantic text detail secondary color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:230`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:286` |
| `--sr-color-text-control` (source `app/stock-radar-tokens.css:53`) | `#c8ced6` | Semantic text control color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:171`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:316`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:810`<br>`components/ui/Pagination.module.css:17`<br>`components/ui/Pagination.module.css:41` |
| `--sr-color-text-control-strong` (source `app/stock-radar-tokens.css:54`) | `#d6d9de` | Semantic text control strong color. | `components/ui/FilterTrigger.module.css:10` |
| `--sr-color-text-footer` (source `app/stock-radar-tokens.css:55`) | `#c9cdd3` | Semantic text footer color. | Retained generic foundation role; the current capped market-movers list has no footer. |
| `--sr-color-text-label` (source `app/stock-radar-tokens.css:56`) | `#cbd0d7` | Semantic text label color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:401` |
| `--sr-color-text-close` (source `app/stock-radar-tokens.css:57`) | `#d7dce3` | Semantic text close color. | `components/ui/BottomSheetShell.module.css:110` |
| `--sr-color-text-option` (source `app/stock-radar-tokens.css:58`) | `#d4d8df` | Semantic text option color. | `components/ui/FilterOption.module.css:8` |
| `--sr-color-text-sheet-title` (source `app/stock-radar-tokens.css:59`) | `#f0f3f7` | Semantic text sheet title color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:753` |
| `--sr-color-text-subtle` (source `app/stock-radar-tokens.css:60`) | `#aeb5be` | Semantic text subtle color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:78`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:187`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:438` |
| `--sr-color-text-muted` (source `app/stock-radar-tokens.css:61`) | `#9aa2ad` | Semantic text muted color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-text-meta` (source `app/stock-radar-tokens.css:62`) | `#8a929d` | Semantic text meta color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:487` |
| `--sr-color-text-delay` (source `app/stock-radar-tokens.css:63`) | `#8a919a` | Theme-dependent delayed-status text role. | Reserved foundation role; product status uses invariant product-chrome text. |
| `--sr-color-text-nav` (source `app/stock-radar-tokens.css:64`) | `#9ba3ad` | Theme-dependent generic navigation text. | Reserved foundation role; product navigation uses invariant product-chrome text. |
| `--sr-color-text-tab` (source `app/stock-radar-tokens.css:65`) | `#b5bac1` | Semantic text tab color. | `components/ui/SegmentedControl.module.css:25` |
| `--sr-color-text-mobile-company` (source `app/stock-radar-tokens.css:66`) | `#9ca4ae` | Semantic text mobile company color. | `components/market/MarketResultRows.module.css:214` |
| `--sr-color-text-mobile-rank` (source `app/stock-radar-tokens.css:67`) | `#aab1ba` | Semantic text mobile rank color. | `components/market/MarketResultRows.module.css:185` |
| `--sr-color-text-mobile-value` (source `app/stock-radar-tokens.css:68`) | `#aeb6c0` | Semantic text mobile value color. | `components/market/MarketResultRows.module.css:53`<br>`components/market/MarketResultRows.module.css:250` |
| `--sr-color-text-filter-label` (source `app/stock-radar-tokens.css:69`) | `#c4c8ce` | Semantic text filter label color. | `components/ui/FilterTrigger.module.css:26` |
| `--sr-color-text-filter-value` (source `app/stock-radar-tokens.css:70`) | `#e0e4e8` | Semantic text filter value color. | `components/ui/FilterTrigger.module.css:34` |
| `--sr-color-text-filter-icon` (source `app/stock-radar-tokens.css:71`) | `#b6bcc4` | Semantic text filter icon color. | `components/ui/FilterTrigger.module.css:42` |
| `--sr-color-text-section-label` (source `app/stock-radar-tokens.css:72`) | `#c8cdd4` | Semantic text section label color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:777` |
| `--sr-color-text-chart-icon` (source `app/stock-radar-tokens.css:73`) | `#c4c9d0` | Semantic text chart icon color. | `components/market/MarketResultRows.module.css:94` |
| `--sr-color-text-detail-close` (source `app/stock-radar-tokens.css:74`) | `#ccd1d7` | Semantic text detail close color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:208` |
| `--sr-color-text-inverse` (source `app/stock-radar-tokens.css:75`) | `#ffffff` | Semantic text inverse color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:293`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:388`<br>`components/ui/Pagination.module.css:26` |
| `--sr-color-text-primary-action` (source `app/stock-radar-tokens.css`) | `#ffffff` | Text on the primary-action surface in both themes. | `components/premium-v2/StockRadarPremiumV2.module.css` |
| `--sr-color-text-emphasized-action` | `#ff9a4a` | Theme-specific emphasized secondary-action label; Light maps it to white `#FFFFFF`. | `components/dashboard-v2/StockRadarDashboardV2.module.css` |
| `--sr-color-accent` (source `app/stock-radar-tokens.css:78`) | `#ff7a1a` | Theme-dependent workspace accent color. | Shared workspace controls; product navigation uses invariant product-chrome tokens. |
| `--sr-color-accent-strong` (source `app/stock-radar-tokens.css:79`) | `#ff8b2e` | Semantic accent strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:510` |
| `--sr-color-accent-highlight` (source `app/stock-radar-tokens.css:80`) | `#ffad67` | Semantic accent highlight color. | `components/ui/Pagination.module.css:27` |
| `--sr-color-accent-text` (source `app/stock-radar-tokens.css:81`) | `#ff9a3c` | Semantic accent text color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:512` |
| `--sr-color-accent-text-soft` (source `app/stock-radar-tokens.css:82`) | `#ff9a4a` | Semantic accent text soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:667`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:816` |
| `--sr-color-premium` (source `app/stock-radar-tokens.css:83`) | `#d8a068` | Theme-dependent Premium emphasis for workspace use. | Reserved foundation role; product navigation has a dedicated invariant Premium role. |
| `--sr-color-accent-selected` (source `app/stock-radar-tokens.css:84`) | `rgba(255, 122, 26, 0.1)` | Semantic accent selected color. | `components/market/MarketResultRows.module.css:117`<br>`components/market/MarketResultRows.module.css:254` |
| `--sr-color-accent-active` (source `app/stock-radar-tokens.css:85`) | `rgba(255, 122, 26, 0.13)` | Semantic accent active color. | `components/ui/SegmentedControl.module.css:40` |
| `--sr-color-accent-active-soft` (source `app/stock-radar-tokens.css:86`) | `rgba(255, 122, 26, 0.12)` | Semantic accent active soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:668`<br>`components/ui/FilterTrigger.module.css:67` |
| `--sr-color-accent-active-strong` (source `app/stock-radar-tokens.css:87`) | `rgba(255, 122, 26, 0.14)` | Semantic accent active strong color. | `components/ui/FilterOption.module.css:21` |
| `--sr-color-accent-subtle` (source `app/stock-radar-tokens.css:88`) | `rgba(255, 122, 26, 0.04)` | Theme-dependent subtle accent surface. | Reserved foundation role. |
| `--sr-color-accent-menu` (source `app/stock-radar-tokens.css:89`) | `rgba(255, 122, 26, 0.032)` | Theme-dependent generic menu accent surface. | Reserved foundation role. |
| `--sr-color-accent-sheet-glow` (source `app/stock-radar-tokens.css:90`) | `rgba(255, 122, 26, 0.06)` | Semantic accent sheet glow color. | `components/ui/BottomSheetShell.module.css:80` |
| `--sr-color-accent-overlay-glow` (source `app/stock-radar-tokens.css:91`) | `rgba(255, 122, 26, 0.07)` | Semantic accent overlay glow color. | `components/ui/BottomSheetShell.module.css:70` |
| `--sr-color-accent-cta-top` (source `app/stock-radar-tokens.css:92`) | `rgba(255, 122, 26, 0.16)` | Semantic accent cta top color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:514` |
| `--sr-color-accent-cta-bottom` (source `app/stock-radar-tokens.css:93`) | `rgba(255, 122, 26, 0.07)` | Semantic accent cta bottom color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:514` |
| `--sr-color-accent-cta-strong` (source `app/stock-radar-tokens.css:94`) | `rgba(255, 122, 26, 0.2)` | Semantic accent cta strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:818`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:929` |
| `--sr-color-accent-cta-strong-bottom` (source `app/stock-radar-tokens.css:95`) | `rgba(255, 122, 26, 0.08)` | Semantic accent cta strong bottom color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:818`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:929` |
| `--sr-color-accent-transparent` (source `app/stock-radar-tokens.css:96`) | `rgba(255, 122, 26, 0)` | Semantic accent transparent color. | `components/shell/StockRadarProductHeader.module.css:204`<br>`components/ui/BottomSheetShell.module.css:70` |
| `--sr-color-accent-border` (source `app/stock-radar-tokens.css:97`) | `rgba(255, 122, 26, 0.58)` | Semantic accent border color. | `components/dashboard-v2/StockRadarDashboardV2.module.css` |
| `--sr-color-accent-border-active` (source `app/stock-radar-tokens.css:98`) | `rgba(255, 122, 26, 0.78)` | Semantic accent border active color. | `components/ui/FilterTrigger.module.css:65` |
| `--sr-color-accent-border-strong` (source `app/stock-radar-tokens.css:99`) | `rgba(255, 122, 26, 0.8)` | Semantic accent border strong color. | `components/ui/FilterOption.module.css:19` |
| `--sr-color-accent-border-emphasis` (source `app/stock-radar-tokens.css:100`) | `rgba(255, 122, 26, 0.88)` | Semantic accent border emphasis color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:815` |
| `--sr-color-accent-border-premium` (source `app/stock-radar-tokens.css:101`) | `rgba(255, 122, 26, 0.24)` | Theme-dependent Premium border role for workspace use. | Reserved foundation role. |
| `--sr-color-accent-nav-line` (source `app/stock-radar-tokens.css:102`) | `rgba(255, 122, 26, 0.45)` | Theme-dependent navigation line role. | Reserved foundation role; product navigation uses its invariant line role. |
| `--sr-color-accent-focus-soft` (source `app/stock-radar-tokens.css:103`) | `rgba(255, 122, 26, 0.5)` | Semantic accent focus soft color. | `components/market/MarketResultRows.module.css:12` |
| `--sr-color-accent-focus-mobile` (source `app/stock-radar-tokens.css:104`) | `rgba(255, 122, 26, 0.56)` | Semantic accent focus mobile color. | `components/market/MarketResultRows.module.css:165` |
| `--sr-color-surface-product-header` | `rgba(10, 12, 15, 0.92)` | Theme-invariant dark product-header surface. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-surface-product-menu` | `#0d1116` | Theme-invariant dark mobile product-menu surface. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-border-product-header` | `#20262c` | Theme-invariant product-header divider. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-border-product-menu` | `rgba(74, 82, 92, 0.82)` | Theme-invariant mobile product-menu border. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-text-product-brand` | `#f5f6f7` | Product brand text on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-text-product-status` | `#8a919a` | Delayed-status text on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-text-product-navigation` | `#9ba3ad` | Inactive product navigation on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-text-product-action` | `#d7dbe0` | Search and icon actions on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-text-product-menu` | `#d8dde4` | Default mobile product-menu text. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-accent` | `#ff7a1a` | Product-chrome active navigation, status, and menu accent. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-accent-selected` | `rgba(255, 122, 26, 0.1)` | Selected navigation surface on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-accent-border` | `rgba(255, 122, 26, 0.58)` | Selected navigation border on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-accent-nav-line` | `rgba(255, 122, 26, 0.45)` | Selected navigation inset line on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-accent-menu` | `rgba(255, 122, 26, 0.032)` | Current mobile-menu item surface. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-premium` | `#bc8cff` | Premium navigation text on dark chrome; deliberately purple rather than the orange active-navigation accent. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-premium-border` | `rgba(188, 140, 255, 0.36)` | Premium navigation border on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-premium-surface` | `rgba(188, 140, 255, 0.07)` | Premium navigation surface on dark chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-menu-glow` | `rgba(255, 122, 26, 0.07)` | Top accent wash in the dark mobile product menu. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-product-indicator-border` | `#0b0d10` | Notification-dot separation against dark product chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-color-positive` (source `app/stock-radar-tokens.css:107`) | `#50e386` | Semantic positive color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:247`<br>`components/market/MarketResultRows.module.css:41`<br>`components/market/MarketResultRows.module.css:83`<br>`components/market/MarketResultRows.module.css:242` |
| `--sr-color-negative` (source `app/stock-radar-tokens.css:108`) | `#ff675f` | Semantic negative color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:253`<br>`components/market/MarketResultRows.module.css:47`<br>`components/market/MarketResultRows.module.css:125`<br>`components/market/MarketResultRows.module.css:246`<br>`components/market/MarketResultRows.module.css:256` |
| `--sr-color-warning` (source `app/stock-radar-tokens.css:109`) | `#f4c542` | Semantic warning color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:492`<br>`components/market/MarketResultRows.module.css:79` |
| `--sr-color-info` (source `app/stock-radar-tokens.css:110`) | `#5cadff` | Semantic info color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-event-earnings` (source `app/stock-radar-tokens.css:111`) | `#36d5c2` | Semantic event earnings color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:446`<br>`components/ui/Badge.module.css:29` |
| `--sr-color-event-earnings-surface` (source `app/stock-radar-tokens.css:112`) | `rgba(54, 213, 194, 0.12)` | Semantic event earnings surface color. | `components/ui/Badge.module.css:30` |
| `--sr-color-event-legal` (source `app/stock-radar-tokens.css:113`) | `#ff675f` | Semantic event legal color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:442`<br>`components/ui/Badge.module.css:34` |
| `--sr-color-event-legal-surface` (source `app/stock-radar-tokens.css:114`) | `rgba(255, 103, 95, 0.13)` | Semantic event legal surface color. | `components/ui/Badge.module.css:35` |
| `--sr-color-event-insider` (source `app/stock-radar-tokens.css:115`) | `#bc8cff` | Semantic event insider color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:450`<br>`components/ui/Badge.module.css:39` |
| `--sr-color-event-insider-surface` (source `app/stock-radar-tokens.css:116`) | `rgba(188, 140, 255, 0.13)` | Semantic event insider surface color. | `components/ui/Badge.module.css:40` |
| `--sr-color-event-transaction` (source `app/stock-radar-tokens.css:117`) | `#5cadff` | Semantic event transaction color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:454`<br>`components/ui/Badge.module.css:44` |
| `--sr-color-event-transaction-surface` (source `app/stock-radar-tokens.css:118`) | `rgba(92, 173, 255, 0.12)` | Semantic event transaction surface color. | `components/ui/Badge.module.css:45` |
| `--sr-color-event-product` (source `app/stock-radar-tokens.css:119`) | `#f4c542` | Semantic event product color. | `components/ui/Badge.module.css:49` |
| `--sr-color-event-product-surface` (source `app/stock-radar-tokens.css:120`) | `rgba(244, 197, 66, 0.13)` | Semantic event product surface color. | `components/ui/Badge.module.css:50` |
| `--sr-color-event-neutral` (source `app/stock-radar-tokens.css:121`) | `#cbd1d9` | Semantic event neutral color. | `components/ui/Badge.module.css:54` |
| `--sr-color-event-neutral-surface` (source `app/stock-radar-tokens.css:122`) | `rgba(203, 209, 217, 0.08)` | Semantic event neutral surface color. | `components/ui/Badge.module.css:55` |
| `--sr-color-chart-bullish` (source `app/stock-radar-tokens.css:125`) | `#3dd985` | Semantic chart bullish color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:371` |
| `--sr-color-chart-bearish` (source `app/stock-radar-tokens.css:126`) | `#f45c55` | Semantic chart bearish color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:375` |
| `--sr-color-chart-grid` (source `app/stock-radar-tokens.css:127`) | `rgba(255, 255, 255, 0.064)` | Semantic chart grid color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:328` |
| `--sr-color-chart-axis` (source `app/stock-radar-tokens.css:128`) | `#b4bac2` | Semantic chart axis color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:345` |
| `--sr-color-chart-ohlc` (source `app/stock-radar-tokens.css:129`) | `#50e386` | Semantic chart ohlc color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:353` |
| `--sr-color-chart-last-line` (source `app/stock-radar-tokens.css:130`) | `rgba(80, 227, 134, 0.22)` | Semantic chart last line color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:379` |
| `--sr-color-chart-last-price` (source `app/stock-radar-tokens.css:131`) | `#3acb83` | Semantic chart last price color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:384` |
| `--sr-color-chart-volume-bullish` (source `app/stock-radar-tokens.css:132`) | `#2be38a` | Semantic chart volume bullish color. | `components/dashboard-v2/MockChart.tsx:74`<br>`components/dashboard-v2/MockChart.tsx:75` |
| `--sr-opacity-chart-volume` (source `app/stock-radar-tokens.css:133`) | `0.28` | Opacity for chart volume. | `components/dashboard-v2/StockRadarDashboardV2.module.css:367` |
| `--sr-color-scrollbar-track` (source `app/stock-radar-tokens.css:136`) | `#0b0f13` | Semantic scrollbar track color. | `components/shell/StockRadarAppShell.module.css:18`<br>`components/shell/StockRadarAppShell.module.css:28`<br>`components/shell/StockRadarAppShell.module.css:32` |
| `--sr-color-scrollbar-thumb` (source `app/stock-radar-tokens.css:137`) | `#3a434d` | Semantic scrollbar thumb color. | `components/shell/StockRadarAppShell.module.css:18`<br>`components/shell/StockRadarAppShell.module.css:34` |
| `--sr-color-scrollbar-thumb-hover` (source `app/stock-radar-tokens.css:138`) | `#515c67` | Semantic scrollbar thumb hover color. | `components/shell/StockRadarAppShell.module.css:38` |
| `--sr-color-sheet-handle` (source `app/stock-radar-tokens.css:139`) | `#65707b` | Semantic sheet handle color. | `components/ui/BottomSheetShell.module.css:94` |
| `--sr-color-state-disabled-text` (source `app/stock-radar-tokens.css:140`) | `#6f7782` | Semantic state disabled text color. | `components/market/MarketResultRows.module.css:110`<br>`components/ui/FilterOption.module.css:31`<br>`components/ui/FilterTrigger.module.css:96`<br>`components/ui/IconButton.module.css:41`<br>`components/ui/SegmentedControl.module.css:52` |
| `--sr-color-state-disabled-surface` (source `app/stock-radar-tokens.css:141`) | `#161b20` | Semantic state disabled surface color. | `components/market/MarketResultRows.module.css:111`<br>`components/ui/FilterOption.module.css:32`<br>`components/ui/FilterTrigger.module.css:97`<br>`components/ui/IconButton.module.css:42`<br>`components/ui/SegmentedControl.module.css:53` |
| `--sr-opacity-disabled` (source `app/stock-radar-tokens.css:142`) | `0.6` | Opacity for disabled. | `components/market/MarketResultRows.module.css:113`<br>`components/ui/FilterOption.module.css:34`<br>`components/ui/FilterTrigger.module.css:99`<br>`components/ui/IconButton.module.css:44`<br>`components/ui/SegmentedControl.module.css:55` |
| `--sr-font-family-sans` (source `app/stock-radar-tokens.css:145`) | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Primary Stock Radar UI font stack. | `components/shell/StockRadarAppShell.module.css:9`<br>`components/ui/Badge.module.css:7`<br>`components/ui/FilterOption.module.css:10`<br>`components/ui/FilterTrigger.module.css:12` |
| `--sr-font-family-mono` (source `app/stock-radar-tokens.css:146`) | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` | Monospace stack for chart axes and numeric chart labels. | `components/dashboard-v2/StockRadarDashboardV2.module.css:339` |
| `--sr-font-variant-numeric` (source `app/stock-radar-tokens.css:147`) | `tabular-nums` | Stable-width numeric glyph behavior. | `components/market/MarketResultRows.module.css:42`<br>`components/market/MarketResultRows.module.css:48` |
| `--sr-font-size-xs` (source `app/stock-radar-tokens.css:148`) | `11px` | Typography size scale at 11px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:669`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:778`<br>`components/ui/Badge.module.css:17`<br>`components/ui/FilterTrigger.module.css:74` |
| `--sr-font-size-xs-plus` (source `app/stock-radar-tokens.css:149`) | `11.5px` | Typography size scale at 11.5px. | `components/ui/SegmentedControl.module.css:78`<br>`components/ui/SegmentedControl.module.css:86` |
| `--sr-font-size-sm` (source `app/stock-radar-tokens.css:150`) | `12px` | Typography size scale at 12px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:80`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:173`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:340`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:389`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:488`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:493`<br>`components/market/MarketResultRows.module.css:68`<br>`components/market/MarketResultRows.module.css:186`<br>`components/market/MarketResultRows.module.css:215`<br>`components/market/MarketResultRows.module.css:236`<br>`components/shell/StockRadarProductHeader.module.css:160`<br>`components/ui/FilterOption.module.css:11`<br>`components/ui/FilterTrigger.module.css:27`<br>`components/ui/Pagination.module.css:20` |
| `--sr-font-size-md` (source `app/stock-radar-tokens.css:151`) | `13px` | Typography size scale at 13px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:153`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:288`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:804`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:847`<br>`components/market/MarketResultRows.module.css:177`<br>`components/shell/StockRadarProductHeader.module.css:75`<br>`components/shell/StockRadarProductHeader.module.css:228`<br>`components/ui/Badge.module.css:25`<br>`components/ui/FilterTrigger.module.css:13`<br>`components/ui/FilterTrigger.module.css:35`<br>`components/ui/SegmentedControl.module.css:28` |
| `--sr-font-size-md-plus` (source `app/stock-radar-tokens.css:152`) | `13.5px` | Typography size scale at 13.5px. | `components/market/MarketResultRows.module.css:209` |
| `--sr-font-size-base` (source `app/stock-radar-tokens.css:153`) | `14px` | Typography size scale at 14px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:91`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:231`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:402`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:478`<br>`components/market/MarketResultRows.module.css:27`<br>`components/market/MarketResultRows.module.css:229`<br>`components/shell/StockRadarProductHeader.module.css:40` |
| `--sr-font-size-lg` (source `app/stock-radar-tokens.css:154`) | `15px` | Typography size scale at 15px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:518` |
| `--sr-font-size-lg-plus` (source `app/stock-radar-tokens.css:155`) | `15.5px` | Typography size scale at 15.5px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:868` |
| `--sr-font-size-xl` (source `app/stock-radar-tokens.css:156`) | `17px` | Typography size scale at 17px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:248` |
| `--sr-font-size-2xl` (source `app/stock-radar-tokens.css:157`) | `18px` | Typography size scale at 18px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:754` |
| `--sr-font-size-heading-sm` (source `app/stock-radar-tokens.css:158`) | `22px` | Typography size scale at 22px. | `components/shell/StockRadarProductHeader.module.css:156` |
| `--sr-font-size-heading-md` (source `app/stock-radar-tokens.css:159`) | `25px` | Typography size scale at 25px. | `components/shell/StockRadarProductHeader.module.css:29` |
| `--sr-font-size-metric-sm` (source `app/stock-radar-tokens.css:160`) | `26px` | Typography size scale at 26px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:864` |
| `--sr-font-size-metric-md` (source `app/stock-radar-tokens.css:161`) | `29px` | Typography size scale at 29px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:241` |
| `--sr-font-size-heading-lg` (source `app/stock-radar-tokens.css:162`) | `31px` | Typography size scale at 31px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:841` |
| `--sr-font-size-heading-xl` (source `app/stock-radar-tokens.css:163`) | `34px` | Typography size scale at 34px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:224` |
| `--sr-font-weight-regular` (source `app/stock-radar-tokens.css:164`) | `400` | Typography weight scale at 400. | `components/shell/StockRadarAppShell.module.css:10`<br>`components/ui/FilterTrigger.module.css:14` |
| `--sr-font-weight-medium` (source `app/stock-radar-tokens.css:165`) | `500` | Typography weight scale at 500. | `components/dashboard-v2/StockRadarDashboardV2.module.css:174`<br>`components/ui/FilterTrigger.module.css:36`<br>`components/ui/Pagination.module.css:21` |
| `--sr-font-weight-emphasis` (source `app/stock-radar-tokens.css:166`) | `540` | Typography weight scale at 540. | `components/dashboard-v2/StockRadarDashboardV2.module.css:479` |
| `--sr-font-weight-nav` (source `app/stock-radar-tokens.css:167`) | `680` | Typography weight scale at 680. | `components/shell/StockRadarProductHeader.module.css:76` |
| `--sr-font-weight-semibold` (source `app/stock-radar-tokens.css:168`) | `700` | Typography weight scale at 700. | `components/dashboard-v2/StockRadarDashboardV2.module.css:670`<br>`components/market/MarketResultRows.module.css:237`<br>`components/ui/FilterOption.module.css:12`<br>`components/ui/SegmentedControl.module.css:29` |
| `--sr-font-weight-strong` (source `app/stock-radar-tokens.css:169`) | `720` | Typography weight scale at 720. | `components/dashboard-v2/StockRadarDashboardV2.module.css:289`<br>`components/market/MarketResultRows.module.css:187`<br>`components/shell/StockRadarProductHeader.module.css:229` |
| `--sr-font-weight-display` (source `app/stock-radar-tokens.css:170`) | `760` | Typography weight scale at 760. | `components/dashboard-v2/StockRadarDashboardV2.module.css:242`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:249`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:403`<br>`components/market/MarketResultRows.module.css:28`<br>`components/market/MarketResultRows.module.css:210`<br>`components/shell/StockRadarProductHeader.module.css:30`<br>`components/ui/FilterTrigger.module.css:28`<br>`components/ui/FilterTrigger.module.css:75` |
| `--sr-font-weight-label` (source `app/stock-radar-tokens.css:171`) | `780` | Typography weight scale at 780. | `components/dashboard-v2/StockRadarDashboardV2.module.css:81`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:494`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:755`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:779`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:805`<br>`components/ui/Badge.module.css:8` |
| `--sr-font-weight-heavy` (source `app/stock-radar-tokens.css:172`) | `800` | Typography weight scale at 800. | `components/dashboard-v2/StockRadarDashboardV2.module.css:225`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:390`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:519`<br>`components/market/MarketResultRows.module.css:69`<br>`components/market/MarketResultRows.module.css:230` |
| `--sr-line-height-tightest` (source `app/stock-radar-tokens.css:173`) | `0.98` | Typography line-height scale at 0.98. | `components/dashboard-v2/StockRadarDashboardV2.module.css:842` |
| `--sr-line-height-none` (source `app/stock-radar-tokens.css:174`) | `1` | Typography line-height scale at 1. | `components/dashboard-v2/StockRadarDashboardV2.module.css:92`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:154`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:161`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:180`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:188`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:226`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:243`<br>`components/market/MarketResultRows.module.css:22`<br>`components/market/MarketResultRows.module.css:29`<br>`components/market/MarketResultRows.module.css:35`<br>`components/market/MarketResultRows.module.css:70`<br>`components/market/MarketResultRows.module.css:202`<br>`components/market/MarketResultRows.module.css:231`<br>`components/shell/StockRadarProductHeader.module.css:31`<br>`components/shell/StockRadarProductHeader.module.css:77`<br>`components/ui/Badge.module.css:9`<br>`components/ui/FilterTrigger.module.css:76`<br>`components/ui/Pagination.module.css:6` |
| `--sr-line-height-compact` (source `app/stock-radar-tokens.css:175`) | `1.1` | Typography line-height scale at 1.1. | `components/market/MarketResultRows.module.css:216`<br>`components/market/MarketResultRows.module.css:238` |
| `--sr-line-height-snug` (source `app/stock-radar-tokens.css:176`) | `1.15` | Typography line-height scale at 1.15. | `components/market/MarketResultRows.module.css:178`<br>`components/ui/SegmentedControl.module.css:87` |
| `--sr-line-height-control` (source `app/stock-radar-tokens.css:177`) | `1.25` | Typography line-height scale at 1.25. | `components/ui/SegmentedControl.module.css:79` |
| `--sr-line-height-body` (source `app/stock-radar-tokens.css:178`) | `1.3` | Typography line-height scale at 1.3. | `components/dashboard-v2/StockRadarDashboardV2.module.css:480` |
| `--sr-line-height-relaxed` (source `app/stock-radar-tokens.css:179`) | `1.35` | Typography line-height scale at 1.35. | `components/dashboard-v2/StockRadarDashboardV2.module.css:557`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:848` |
| `--sr-line-height-default` (source `app/stock-radar-tokens.css:180`) | `1.45` | Typography line-height scale at 1.45. | `components/shell/StockRadarAppShell.module.css:11`<br>`components/ui/FilterOption.module.css:13`<br>`components/ui/FilterTrigger.module.css:15` |
| `--sr-letter-spacing-default` (source `app/stock-radar-tokens.css:181`) | `0` | Typography letter spacing for default. | `components/dashboard-v2/StockRadarDashboardV2.module.css:756`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:780`<br>`components/shell/StockRadarAppShell.module.css:12`<br>`components/shell/StockRadarAppShell.module.css:47`<br>`components/ui/Badge.module.css:10`<br>`components/ui/FilterOption.module.css:14`<br>`components/ui/FilterTrigger.module.css:16`<br>`components/ui/IconButton.module.css:14` |
| `--sr-letter-spacing-brand` (source `app/stock-radar-tokens.css:182`) | `0.02em` | Typography letter spacing for brand. | `components/shell/StockRadarProductHeader.module.css:32` |
| `--sr-space-0-5` (source `app/stock-radar-tokens.css:185`) | `2px` | Reusable 2px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:571`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:655`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:762`<br>`components/ui/FilterTrigger.module.css:59` |
| `--sr-space-1` (source `app/stock-radar-tokens.css:186`) | `4px` | Reusable 4px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:422`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:564`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:626`<br>`components/market/MarketResultRows.module.css:196`<br>`components/shell/StockRadarProductHeader.module.css:54`<br>`components/shell/StockRadarProductHeader.module.css:152`<br>`components/ui/FilterTrigger.module.css:61`<br>`components/ui/SegmentedControl.module.css:85` |
| `--sr-space-1-25` (source `app/stock-radar-tokens.css:187`) | `5px` | Reusable 5px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:486`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:663`<br>`components/ui/FilterTrigger.module.css:52`<br>`components/ui/SegmentedControl.module.css:77` |
| `--sr-space-1-5` (source `app/stock-radar-tokens.css:188`) | `6px` | Reusable 6px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:563`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:652`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:856`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:890`<br>`components/market/MarketResultRows.module.css:60`<br>`components/shell/StockRadarProductHeader.module.css:170`<br>`components/shell/StockRadarProductHeader.module.css:212`<br>`components/ui/IconButton.module.css:27`<br>`components/ui/IconButton.module.css:28` |
| `--sr-space-1-75` (source `app/stock-radar-tokens.css:189`) | `7px` | Reusable 7px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:141`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:628`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:702`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:836`<br>`components/market/MarketResultRows.module.css:21`<br>`components/market/MarketResultRows.module.css:156`<br>`components/shell/StockRadarProductHeader.module.css:248`<br>`components/ui/Badge.module.css:16`<br>`components/ui/IconButton.module.css:25`<br>`components/ui/IconButton.module.css:26` |
| `--sr-space-2` (source `app/stock-radar-tokens.css:190`) | `8px` | Reusable 8px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:193`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:463`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:553`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:564`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:616`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:666`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:696`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:712`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:725`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:787`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:891`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:911`<br>`components/market/MarketResultRows.module.css:154`<br>`components/shell/StockRadarProductHeader.module.css:102`<br>`components/shell/StockRadarProductHeader.module.css:142`<br>`components/ui/Pagination.module.css:5`<br>`components/ui/SegmentedControl.module.css:77`<br>`components/ui/SegmentedControl.module.css:85` |
| `--sr-space-2-25` (source `app/stock-radar-tokens.css:191`) | `9px` | Reusable 9px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:258`<br>`components/market/MarketResultRows.module.css:93`<br>`components/shell/StockRadarProductHeader.module.css:38`<br>`components/shell/StockRadarProductHeader.module.css:73`<br>`components/ui/Badge.module.css:24`<br>`components/ui/Pagination.module.css:16`<br>`components/ui/SegmentedControl.module.css:24` |
| `--sr-space-2-5` (source `app/stock-radar-tokens.css:192`) | `10px` | Reusable 10px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:36`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:179`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:436`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:580`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:627`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:666`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:776`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:794`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:856`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:891`<br>`components/market/MarketResultRows.module.css:156`<br>`components/ui/FilterTrigger.module.css:33`<br>`components/ui/FilterTrigger.module.css:41` |
| `--sr-space-3` (source `app/stock-radar-tokens.css:193`) | `12px` | Reusable 12px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:71`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:307`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:415`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:421`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:580`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:653`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:682`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:706`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:796`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:884`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:925`<br>`components/shell/StockRadarProductHeader.module.css:202`<br>`components/shell/StockRadarProductHeader.module.css:224`<br>`components/ui/BottomSheetShell.module.css:89`<br>`components/ui/FilterOption.module.css:7`<br>`components/ui/FilterTrigger.module.css:46`<br>`components/ui/FilterTrigger.module.css:47` |
| `--sr-space-3-25` (source `app/stock-radar-tokens.css:194`) | `13px` | Reusable 13px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:420`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:575`<br>`components/market/MarketResultRows.module.css:93`<br>`components/ui/FilterTrigger.module.css:25`<br>`components/ui/Pagination.module.css:16`<br>`components/ui/SegmentedControl.module.css:24` |
| `--sr-space-3-5` (source `app/stock-radar-tokens.css:195`) | `14px` | Reusable 14px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:150`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:236`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:460`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:463`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:768`<br>`components/shell/StockRadarProductHeader.module.css:96`<br>`components/shell/StockRadarProductHeader.module.css:143` |
| `--sr-space-4` (source `app/stock-radar-tokens.css:196`) | `16px` | Reusable 16px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:218`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:400`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:762`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:796`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:927`<br>`components/ui/BottomSheetShell.module.css:101`<br>`components/ui/BottomSheetShell.module.css:102` |
| `--sr-space-4-5` (source `app/stock-radar-tokens.css:197`) | `18px` | Reusable 18px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:24`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:37`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:38`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:147`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:201`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:202`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:235`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:270`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:277`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:508`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:690`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:720`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:734`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:906`<br>`components/shell/StockRadarProductHeader.module.css:6` |
| `--sr-space-5` (source `app/stock-radar-tokens.css:198`) | `20px` | Reusable 20px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:24`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:265`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:396`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:706`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:734`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:747`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:828`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:874`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:884` |
| `--sr-space-5-5` (source `app/stock-radar-tokens.css:199`) | `22px` | Reusable 22px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:29`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:396`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:690`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:828` |
| `--sr-space-6` (source `app/stock-radar-tokens.css:200`) | `24px` | Reusable 24px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:214`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:259`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:265`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:509`<br>`components/shell/StockRadarProductHeader.module.css:23` |
| `--sr-space-7` (source `app/stock-radar-tokens.css:201`) | `28px` | Reusable 28px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:214`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:396`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:509`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:734`<br>`components/ui/BottomSheetShell.module.css:50` |
| `--sr-space-8` (source `app/stock-radar-tokens.css:202`) | `32px` | Reusable 32px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:509`<br>`components/shell/StockRadarProductHeader.module.css:198` |
| `--sr-page-gutter-desktop` (source `app/stock-radar-tokens.css:203`) | `28px` | Canonical page gutter desktop spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:24` |
| `--sr-page-gutter-mobile` (source `app/stock-radar-tokens.css:204`) | `12px` | Canonical page gutter mobile spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:612` |
| `--sr-header-gutter-start` (source `app/stock-radar-tokens.css:205`) | `30px` | Canonical header gutter start spacing. | `components/shell/StockRadarProductHeader.module.css:8` |
| `--sr-header-gutter-end` (source `app/stock-radar-tokens.css:206`) | `24px` | Canonical header gutter end spacing. | `components/shell/StockRadarProductHeader.module.css:8` |
| `--sr-size-header` (source `app/stock-radar-tokens.css:209`) | `56px` | Canonical header dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:17`<br>`components/shell/StockRadarProductHeader.module.css:3`<br>`components/ui/DetailPanelShell.module.css:3`<br>`components/ui/DetailPanelShell.module.css:5` |
| `--sr-size-nav-item` (source `app/stock-radar-tokens.css:210`) | `30px` | Canonical nav item dimension. | `components/shell/StockRadarProductHeader.module.css:67` |
| `--sr-size-icon-button` (source `app/stock-radar-tokens.css:211`) | `34px` | Canonical icon button dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:204`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:205`<br>`components/ui/IconButton.module.css:8` |
| `--sr-size-icon-button-mobile` (source `app/stock-radar-tokens.css:212`) | `32px` | Canonical icon button mobile dimension. | `components/shell/StockRadarProductHeader.module.css:175`<br>`components/shell/StockRadarProductHeader.module.css:176`<br>`components/ui/IconButton.module.css:49` |
| `--sr-size-header-action` (source `app/stock-radar-tokens.css:213`) | `38px` | Canonical header action dimension. | `components/shell/StockRadarProductHeader.module.css:101`<br>`components/ui/IconButton.module.css:9` |
| `--sr-size-close-button` (source `app/stock-radar-tokens.css:214`) | `38px` | Canonical close button dimension. | `components/ui/BottomSheetShell.module.css:104`<br>`components/ui/BottomSheetShell.module.css:105` |
| `--sr-size-control` (source `app/stock-radar-tokens.css:215`) | `40px` | Canonical control dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:802`<br>`components/ui/FilterTrigger.module.css:4`<br>`components/ui/FilterTrigger.module.css:22`<br>`components/ui/SegmentedControl.module.css:20` |
| `--sr-size-mobile-primary-tab` (source `app/stock-radar-tokens.css:216`) | `42px` | Canonical mobile primary tab dimension. | `components/ui/SegmentedControl.module.css:76` |
| `--sr-size-mobile-session-tab` (source `app/stock-radar-tokens.css:217`) | `35px` | Canonical mobile session tab dimension. | `components/ui/SegmentedControl.module.css:84` |
| `--sr-size-mobile-quick-filter` (source `app/stock-radar-tokens.css:218`) | `34px` | Canonical mobile quick filter dimension. | `components/ui/FilterTrigger.module.css:57` |
| `--sr-size-filter-option` (source `app/stock-radar-tokens.css:219`) | `32px` | Canonical filter option dimension. | `components/ui/FilterOption.module.css:4` |
| `--sr-size-table-header-row` (source `app/stock-radar-tokens.css:220`) | `46px` | Canonical table header row dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:77` |
| `--sr-size-table-row` (source `app/stock-radar-tokens.css:221`) | `43px` | Canonical table row dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:88` |
| `--sr-size-mobile-list-row` (source `app/stock-radar-tokens.css:222`) | `48px` | Canonical mobile list row dimension. | `components/market/MarketResultRows.module.css:150` |
| `--sr-size-table-footer` (source `app/stock-radar-tokens.css:223`) | `42px` | Table footer dimension. | Retained generic foundation role; the current capped market-movers list has no footer. |
| `--sr-size-badge` (source `app/stock-radar-tokens.css:224`) | `22px` | Canonical badge dimension. | `components/market/MarketResultRows.module.css:58`<br>`components/market/MarketResultRows.module.css:65`<br>`components/ui/Badge.module.css:14`<br>`components/ui/Badge.module.css:21` |
| `--sr-size-badge-lg` (source `app/stock-radar-tokens.css:225`) | `29px` | Canonical badge lg dimension. | `components/ui/Badge.module.css:22` |
| `--sr-size-filter-chip` (source `app/stock-radar-tokens.css:226`) | `28px` | Canonical filter chip dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:661` |
| `--sr-size-analysis-cta` (source `app/stock-radar-tokens.css:227`) | `58px` | Canonical analysis cta dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:505` |
| `--sr-size-chart-min-height` (source `app/stock-radar-tokens.css:228`) | `250px` | Canonical chart min height dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:324` |
| `--sr-size-market-table-min-width` (source `app/stock-radar-tokens.css:229`) | `1060px` | Canonical market table min width dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:60` |
| `--sr-size-mobile-menu-width` (source `app/stock-radar-tokens.css:230`) | `216px` | Canonical mobile menu width dimension. | `components/shell/StockRadarProductHeader.module.css:198` |
| `--sr-size-sheet-handle-width` (source `app/stock-radar-tokens.css:231`) | `46px` | Canonical sheet handle width dimension. | `components/ui/BottomSheetShell.module.css:91` |
| `--sr-size-sheet-handle-height` (source `app/stock-radar-tokens.css:232`) | `4px` | Canonical sheet handle height dimension. | `components/ui/BottomSheetShell.module.css:92` |
| `--sr-border-width` (source `app/stock-radar-tokens.css:235`) | `1px` | Canonical border width (1px). | `components/dashboard-v2/StockRadarDashboardV2.module.css:23`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:48`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:69`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:140`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:149`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:169`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:213`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:264`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:395`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:462`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:510`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:664`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:746`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:767`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:795`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:809`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:815`<br>`components/market/MarketResultRows.module.css:12`<br>`components/market/MarketResultRows.module.css:91`<br>`components/market/MarketResultRows.module.css:155`<br>`components/market/MarketResultRows.module.css:165`<br>`components/shell/StockRadarProductHeader.module.css:7`<br>`components/shell/StockRadarProductHeader.module.css:71`<br>`components/shell/StockRadarProductHeader.module.css:200`<br>`components/shell/StockRadarProductHeader.module.css:222`<br>`components/ui/Badge.module.css:6`<br>`components/ui/Badge.module.css:24`<br>`components/ui/BottomSheetShell.module.css:58`<br>`components/ui/BottomSheetShell.module.css:115`<br>`components/ui/BottomSheetShell.module.css:119`<br>`components/ui/DetailPanelShell.module.css:16`<br>`components/ui/FilterOption.module.css:5`<br>`components/ui/FilterTrigger.module.css:7`<br>`components/ui/FilterTrigger.module.css:24`<br>`components/ui/IconButton.module.css:29`<br>`components/ui/Pagination.module.css:14`<br>`components/ui/SegmentedControl.module.css:4`<br>`components/ui/SegmentedControl.module.css:22`<br>`components/ui/SegmentedControl.module.css:41` |
| `--sr-border-width-strong` (source `app/stock-radar-tokens.css:236`) | `2px` | Canonical border width (2px). | `components/shell/StockRadarAppShell.module.css:32`<br>`components/shell/StockRadarProductHeader.module.css:247` |
| `--sr-radius-sm` (source `app/stock-radar-tokens.css:237`) | `4px` | Corner radius for sm. | `components/market/MarketResultRows.module.css:92`<br>`components/shell/StockRadarProductHeader.module.css:72`<br>`components/ui/Badge.module.css:15` |
| `--sr-radius-control` (source `app/stock-radar-tokens.css:238`) | `5px` | Corner radius for control. | `components/dashboard-v2/StockRadarDashboardV2.module.css:49`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:170`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:511`<br>`components/ui/Badge.module.css:23`<br>`components/ui/FilterTrigger.module.css:8`<br>`components/ui/Pagination.module.css:15`<br>`components/ui/SegmentedControl.module.css:5` |
| `--sr-radius-base` (source `app/stock-radar-tokens.css:239`) | `6px` | Corner radius for base. | `components/ui/IconButton.module.css:7`<br>`components/ui/SegmentedControl.module.css:23` |
| `--sr-radius-mobile-control` (source `app/stock-radar-tokens.css:240`) | `7px` | Corner radius for mobile control. | `components/ui/FilterTrigger.module.css:60`<br>`components/ui/SegmentedControl.module.css:72` |
| `--sr-radius-action` (source `app/stock-radar-tokens.css:241`) | `8px` | Corner radius for action. | `components/dashboard-v2/StockRadarDashboardV2.module.css:803`<br>`components/shell/StockRadarProductHeader.module.css:223` |
| `--sr-radius-popover` (source `app/stock-radar-tokens.css:242`) | `12px` | Corner radius for popover. | `components/shell/StockRadarProductHeader.module.css:201` |
| `--sr-radius-sheet` (source `app/stock-radar-tokens.css:243`) | `22px` | Corner radius for sheet. | `components/ui/BottomSheetShell.module.css:60` |
| `--sr-radius-pill` (source `app/stock-radar-tokens.css:244`) | `999px` | Corner radius for pill. | `components/dashboard-v2/StockRadarDashboardV2.module.css:437`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:665`<br>`components/shell/StockRadarAppShell.module.css:33`<br>`components/shell/StockRadarProductHeader.module.css:46`<br>`components/ui/BottomSheetShell.module.css:93`<br>`components/ui/BottomSheetShell.module.css:108`<br>`components/ui/FilterOption.module.css:6`<br>`components/ui/IconButton.module.css:30` |
| `--sr-shadow-header` (source `app/stock-radar-tokens.css:245`) | `0 1px 0 rgba(255, 255, 255, 0.03)` | Legacy theme-dependent header shadow retained for compatibility. | Reserved foundation role. |
| `--sr-shadow-delay-dot` (source `app/stock-radar-tokens.css:246`) | `0 0 13px rgba(255, 122, 26, 0.65)` | Legacy theme-dependent delay-dot shadow retained for compatibility. | Reserved foundation role. |
| `--sr-shadow-panel` (source `app/stock-radar-tokens.css:247`) | `0 18px 52px rgba(0, 0, 0, 0.24)` | Elevation/effect shadow for panel. | `components/dashboard-v2/StockRadarDashboardV2.module.css:51` |
| `--sr-shadow-pagination-active` (source `app/stock-radar-tokens.css:248`) | `0 0 20px rgba(255, 122, 26, 0.34)` | Elevation/effect shadow for pagination active. | `components/ui/Pagination.module.css:28` |
| `--sr-shadow-menu` (source `app/stock-radar-tokens.css:249`) | `0 16px 36px rgba(0, 0, 0, 0.38)` | Theme-dependent generic menu shadow. | Reserved foundation role; product navigation uses its invariant menu shadow. |
| `--sr-shadow-product-header` | `0 1px 0 rgba(255, 255, 255, 0.03)` | Theme-invariant dark product-header edge. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-shadow-product-menu` | `0 16px 36px rgba(0, 0, 0, 0.38)` | Theme-invariant mobile product-menu elevation. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-shadow-product-delay-dot` | `0 0 13px rgba(255, 122, 26, 0.65)` | Theme-invariant delayed-status dot glow. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-shadow-sheet-content-footer` (source `app/stock-radar-tokens.css:250`) | `0 -22px 48px rgba(0, 0, 0, 0.44)` | Elevation shadow for the content-footer sheet layout. | `components/ui/BottomSheetShell.module.css:72` |
| `--sr-shadow-sheet-full-scroll` (source `app/stock-radar-tokens.css:251`) | `0 -28px 70px rgba(0, 0, 0, 0.56)` | Elevation shadow for the full-scroll sheet layout. | `components/ui/BottomSheetShell.module.css:82` |
| `--sr-shadow-cta` (source `app/stock-radar-tokens.css:252`) | `inset 0 0 0 1px rgba(255, 122, 26, 0.18), 0 0 22px rgba(255, 122, 26, 0.08)` | Elevation/effect shadow for cta. | `components/dashboard-v2/StockRadarDashboardV2.module.css:517` |
| `--sr-focus-ring-width` (source `app/stock-radar-tokens.css:253`) | `2px` | Keyboard focus ring width. | `components/dashboard-v2/StockRadarDashboardV2.module.css:740`<br>`components/market/MarketResultRows.module.css:105`<br>`components/shell/StockRadarProductHeader.module.css:236`<br>`components/ui/BottomSheetShell.module.css:130`<br>`components/ui/FilterOption.module.css:25`<br>`components/ui/FilterTrigger.module.css:90`<br>`components/ui/IconButton.module.css:36`<br>`components/ui/Pagination.module.css:36`<br>`components/ui/SegmentedControl.module.css:47` |
| `--sr-focus-ring-color` (source `app/stock-radar-tokens.css:254`) | `rgba(255, 122, 26, 0.65)` | Keyboard focus ring color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:740`<br>`components/market/MarketResultRows.module.css:105`<br>`components/shell/StockRadarProductHeader.module.css:236`<br>`components/ui/BottomSheetShell.module.css:130`<br>`components/ui/FilterOption.module.css:25`<br>`components/ui/FilterTrigger.module.css:90`<br>`components/ui/IconButton.module.css:36`<br>`components/ui/Pagination.module.css:36`<br>`components/ui/SegmentedControl.module.css:47` |
| `--sr-focus-ring-product-header` | `rgba(255, 122, 26, 0.65)` | Focus indication inside theme-invariant product chrome. | `components/shell/StockRadarProductHeader.module.css` |
| `--sr-focus-ring-offset` (source `app/stock-radar-tokens.css:255`) | `2px` | Keyboard focus ring offset. | `components/dashboard-v2/StockRadarDashboardV2.module.css:741`<br>`components/market/MarketResultRows.module.css:106`<br>`components/shell/StockRadarProductHeader.module.css:237`<br>`components/ui/BottomSheetShell.module.css:131`<br>`components/ui/FilterOption.module.css:26`<br>`components/ui/FilterTrigger.module.css:91`<br>`components/ui/IconButton.module.css:37`<br>`components/ui/Pagination.module.css:37`<br>`components/ui/SegmentedControl.module.css:48` |
| `--sr-z-timeline-marker` (source `app/stock-radar-tokens.css:258`) | `1` | Layer order for timeline marker. | `components/dashboard-v2/StockRadarDashboardV2.module.css:433` |
| `--sr-z-sticky-action` (source `app/stock-radar-tokens.css:259`) | `2` | Layer order for sticky action. | `components/dashboard-v2/StockRadarDashboardV2.module.css:924` |
| `--sr-z-sheet-handle` (source `app/stock-radar-tokens.css:260`) | `6` | Layer order for sheet handle. | `components/ui/BottomSheetShell.module.css:88` |
| `--sr-z-sheet-close` (source `app/stock-radar-tokens.css:261`) | `7` | Layer order for sheet close. | `components/ui/BottomSheetShell.module.css:100` |
| `--sr-z-sheet-full-scroll` (source `app/stock-radar-tokens.css:262`) | `80` | Layer order for the full-scroll sheet layout. | `components/ui/BottomSheetShell.module.css:31` |
| `--sr-z-mobile-menu` (source `app/stock-radar-tokens.css:263`) | `86` | Layer order for mobile menu. | `components/shell/StockRadarProductHeader.module.css:194` |
| `--sr-z-sheet-content-footer` (source `app/stock-radar-tokens.css:264`) | `90` | Layer order for the content-footer sheet layout. | `components/ui/BottomSheetShell.module.css:26` |
| `--sr-motion-duration-menu` (source `app/stock-radar-tokens.css:265`) | `130ms` | Motion duration for menu. | `components/shell/StockRadarProductHeader.module.css:207` |
| `--sr-motion-duration-sheet` (source `app/stock-radar-tokens.css:266`) | `170ms` | Motion duration for sheet. | `components/ui/BottomSheetShell.module.css:61` |
| `--sr-motion-duration-reduced` (source `app/stock-radar-tokens.css:267`) | `1ms` | Motion duration for reduced. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-motion-distance-menu` (source `app/stock-radar-tokens.css:268`) | `4px` | Motion travel distance for menu. | `components/shell/StockRadarProductHeader.module.css:128` |
| `--sr-motion-distance-sheet` (source `app/stock-radar-tokens.css:269`) | `24px` | Motion travel distance for sheet. | `components/ui/BottomSheetShell.module.css:8` |
| `--sr-motion-distance-drawer` (source `app/stock-radar-tokens.css:270`) | `28px` | Motion travel distance for drawer. | `components/dashboard-v2/StockRadarDashboardV2.module.css:525` |
| `--sr-motion-distance-reduced` (source `app/stock-radar-tokens.css:271`) | `0px` | Motion travel distance for reduced. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-motion-easing-standard` (source `app/stock-radar-tokens.css:272`) | `ease-out` | Motion easing for standard. | `components/shell/StockRadarProductHeader.module.css:207`<br>`components/ui/BottomSheetShell.module.css:61` |
| `--sr-color-text-chart-range-selected` (source `app/stock-radar-tokens.css:275`) | `#ffffff` | Selected chart-range text that remains canonical white in Dark and readable on the transparent Light chart surface. | `components/chart/ChartRangeSelector.module.css:20` |
## 3A. Light Theme Override Inventory

Dark is the default and canonical palette. A Stock Radar shell defaults to `fixed-dark`. A route that explicitly selects `user-selectable` renders `data-sr-theme="dark"` when `sr-theme` is missing, invalid, or unreadable. The operating system color-scheme preference is not consulted. In that mode, a stored `light` value changes the same shell to `data-sr-theme="light"`; no route-specific Light stylesheet or duplicate component tree exists.

Exact override values are maintained in the final `[data-sr-theme="light"]` block of `app/stock-radar-tokens.css`.

Light surface hierarchy:

| Level | Roles | Contract |
| --- | --- | --- |
| Canvas | Page background and top gradient | Luminous cool-white outer workspace that feels open without becoming a visibly gray field. |
| Recessed | Panel, elevated, control-group, table-header, footer, and muted-action surfaces | Uses a restrained blue-neutral tint to group controls and supporting regions in the same visual family as the canvas. |
| Content | Base surface and detail gradient | White reading surface for the chart, detail rail, advertising reservations, and content panels. |
| Raised | Table panel, table rows, controls, options, and non-product overlays | White interactive/data surfaces separated by crisp cool borders and shallow layered elevation. |
| Product chrome | Product header and mobile product menu | Theme-invariant near-black surfaces with bright brand/actions, muted navigation, orange active emphasis, and distinct purple Premium emphasis above the Light workspace. |

The Light page glow remains near-imperceptible, while low-opacity panel shadows may reinforce major workspace separation. The product header and mobile product menu retain their Dark chrome edge and elevation in both themes. Dark uses ambient glow against a low-luminance canvas; Light uses clear white space, crisp navy text, controlled cool-blue depth, and cool low-contrast borders instead of a broad gray or warm-tinted workspace.

| Override family | Count | Covered roles |
| --- | ---: | --- |
| Canvas, surfaces, and overlays | 27 | Neutral page canvas, white/near-white panels, controls, table surfaces, sheet surfaces, primary and sticky actions, and dim overlays. Product chrome is intentionally excluded from Light overrides. |
| Borders and dividers | 11 | Standard, overlay, section, close-control, and action boundaries. |
| Text hierarchy | 34 | Primary, heading, ticker, body, control, menu, metadata, mobile, inverse, and selected chart-range text. |
| Accent and interaction | 29 | Orange accent, selected/active states, primary CTA roles, navigation emphasis, and focus-adjacent states. |
| Market and event semantics | 16 | Positive, negative, warning, info, and all event text/background pairs. |
| Chart | 9 | Grid, axis, bullish/bearish candles, OHLC, volume, and last-price treatment. |
| Scrollbar and disabled state | 6 | Track, thumb, handle, and disabled text/surface. |
| Shadows and focus effect | 9 | Header, panel, menu, sheet, CTA, pagination, delay dot, and focus ring. |
| **Total** | **139** | Existing semantic roles overridden for Light. |

Theme selector rules:

- Apply `data-sr-theme` to `StockRadarAppShell` through `StockRadarThemeProvider`; do not apply it to `html`, `body`, or unrelated routes. The shell remains `fixed-dark` unless a verified route explicitly opts into `user-selectable`.
- Component CSS consumes the same `var(--sr-*)` names in both themes. Do not add `[data-sr-theme]` branches to dashboard or shared component modules.
- Light overrides may change semantic colors, opacity used by color rendering, shadows, and focus color. They must not redefine typography, spacing, control heights, row geometry, radii, layers, motion, or breakpoints.
- `--sr-color-surface-primary-action` and `--sr-color-text-primary-action` are the paired roles for primary Upgrade, Subscribe, and trial CTAs. Light uses the approved orange surface and white text with `--sr-shadow-cta: none`; component modules must not add a theme-specific CTA branch.
- New Stock Radar pages must render correctly in both themes without literal color declarations in reusable component CSS before they opt into `user-selectable`; otherwise they retain the `fixed-dark` default.

## 4. Semantic Color Rules

- Use `--sr-color-page-*` only for the app canvas and page-level glow.
- Use `--sr-color-surface-*` for panels, controls, tables, overlays, and elevated actions. Select the token matching the UI role even when another surface currently has the same literal value.
- Use `--sr-color-text-*` by information hierarchy. Do not substitute muted or metadata text based only on visual similarity.
- Use `--sr-color-accent` for orange product emphasis in both themes. Light maps compact active text to the readable `#C94F00`, while selected surfaces, borders, underlines, focus, menu, and overlay variants reuse the Upgrade orange RGB (`255, 122, 26`) at role-specific alpha levels.
- Use the dedicated `--sr-*-product-*` roles only inside `StockRadarProductHeader` and its canonical mobile navigation popover. They are declared once in `:root`, remain dark in both themes, and must not be substituted for Light workspace surfaces or page text.
- Use `--sr-color-surface-primary-action` with `--sr-color-text-primary-action` for primary actions. Light uses the Upgrade orange RGB at 90% alpha (`rgba(255, 122, 26, 0.9)`) with white `#FFFFFF` and no CTA glow.
- Use `--sr-color-positive`, `--sr-color-negative`, `--sr-color-warning`, and `--sr-color-info` for market/status semantics. Light positive values align visually with the bullish candle green and remain readable at compact table text sizes.
- Use `--sr-color-event-*` for event badges and timeline markers. Legal, earnings, insider, transaction, product, and neutral roles are intentionally separate. In Light, semantic badge surfaces use a moderate tint so adjacent event types remain distinguishable on white data rows without turning into solid-color labels; neutral remains one step quieter, and outline/text tones retain small-label contrast against the stronger tint.
- Use `--sr-color-chart-*` inside chart rendering. Chart candle colors remain separate semantic contracts from market text colors even when Light intentionally assigns the same green value to positive text and bullish candles; bearish and negative roles remain independently tunable.
- Focus indicators should use the `--sr-focus-*` tokens rather than a border or selected-state alpha.

## 5. Typography Rules

- `--sr-font-family-sans` preserves the current dashboard declaration exactly: `Inter` followed by system UI fallbacks.
- Inter is not installed or loaded by the repository. Do not add `next/font`, `@font-face`, or a package without a separate visual-baseline decision.
- `--sr-font-family-mono` is limited to chart axes and OHLC data.
- Use `--sr-font-variant-numeric: tabular-nums` for price and change columns where stable numeric alignment is required.
- Choose a named font-size token matching the canonical role; avoid viewport-scaled typography.
- Use the weight and line-height scales independently. The existing fractional values (`540`, `680`, `720`, `760`, `780`) are preserved because changing them can alter fallback-font rendering.
- Letter spacing is either `--sr-letter-spacing-default` or the brand-only `--sr-letter-spacing-brand`.

## 6. Spacing and Control Size Rules

- Prefer `--sr-space-*` for recurring gaps, padding, margins, and offsets.
- Use `--sr-page-gutter-desktop`, `--sr-page-gutter-mobile`, `--sr-header-gutter-start`, and `--sr-header-gutter-end` when the space is part of page framing rather than component internals.
- Use semantic sizing tokens for controls and fixed-format UI: header, tabs, filters, table rows, mobile list rows, badges, CTA, menu, and sheet controls.
- Keep table and chart geometry stable. A spacing token must not be used to compress a row or force desktop columns into the mobile viewport.
- Breakpoints remain source literals because CSS custom properties cannot be used in media query conditions.

## 7. Usage Examples

```css
.stock-radar-panel {
  border: var(--sr-border-width) solid var(--sr-color-border);
  border-radius: var(--sr-radius-control);
  background: var(--sr-color-surface-panel);
  color: var(--sr-color-text-primary);
  box-shadow: var(--sr-shadow-panel);
}

.stock-radar-control {
  min-height: var(--sr-size-control);
  padding-inline: var(--sr-space-3);
  font: var(--sr-font-weight-semibold) var(--sr-font-size-md) / var(--sr-line-height-control)
    var(--sr-font-family-sans);
}

.stock-radar-positive-value {
  color: var(--sr-color-positive);
  font-variant-numeric: var(--sr-font-variant-numeric);
}
```

For React SVG, pass a CSS variable string when the SVG presentation attribute accepts CSS colors:

```tsx
<stop stopColor="var(--sr-color-chart-volume-bullish)" stopOpacity="0.42" />
```

## 8. Values Intentionally Not Converted

- Breakpoints `1320px`, `1180px`, `1181px`, and `760px`: custom properties are not valid in media query conditions.
- Grid and column geometry such as `770px`, `690px`, `430px`, `420px`, `390px`, `31.5vw`, and the individual table column widths: these are component-specific layout formulas, not shared design-system values.
- Mobile sheet formulas using `82dvh`, `90dvh`, safe-area calculations, and viewport subtraction: these encode current responsive behavior and must remain unchanged.
- Unique SVG geometry such as stroke widths, dash arrays, candle coordinates, chart view-box values, gradient offsets, and `stopOpacity` values: these are rendering data rather than reusable UI tokens.
- One-off menu and detail measurements that have no demonstrated cross-page role remain local until a shared component contract is established. Pagination's demonstrated geometry is now owned by the phase 3C shared component.
- Existing global button styles from `app/globals.css`: phase 2 does not alter cascade ownership or specificity.
- Known baseline issues, including 1440 px desktop table overflow and the mobile sticky CTA overlap risk, were not fixed.

## 9. Migration Result

The dashboard CSS no longer contains literal hex, RGB, or RGBA colors. The migration replaced 177 color occurrences, all 47 font-size declarations, all 29 font-weight declarations, all 27 explicit line-height declarations, and the repeated radius, shadow, border, spacing, layer, and motion values covered by the semantic contracts above.

The former 18 local `--dash-v2-*` variables were removed. Stock Radar UI source now references 243 unique tokens across 667 `var(--sr-*)` usages, including the phase 3A through 3E shared components.

The phase 2 quality pass removed nine tokens that lacked an independent reusable role: `surface-high`, `text-faint`, `text-neutral-badge`, `accent-outline`, `accent-focus`, `accent-pagination-glow`, the unused `2xs` font size, zero spacing, and the unused 30 px spacing step. Legal and neutral event colors use their event-semantic tokens directly.

Phase 3D removed five more tokens that were referenced only by obsolete, unrendered nav-more selectors: `surface-navigation-menu`, `accent-hover`, `accent-border-open`, `shadow-navigation-menu`, and `z-navigation-menu`. The canonical product menu continues to use the existing overlay surface, menu shadow, accent-menu, and mobile-menu layer tokens.

Five foundation tokens are intentionally defined but not rendered by dashboard-v2:

- `--sr-color-surface-elevated`: phase 3 elevated panel and popover surface contract.
- `--sr-color-text-muted`: phase 3 shared helper and metadata text hierarchy.
- `--sr-color-info`: non-event informational status; kept distinct from transaction-event blue.
- `--sr-motion-duration-reduced` and `--sr-motion-distance-reduced`: phase 3 reduced-motion variants for shared menu and sheet shells.

Phase 3A added `--sr-size-header-action` and `--sr-size-badge-lg` to preserve the extracted IconButton and Badge computed sizes without component-local aliases. The 18 px and 19 px icon dimensions remain owned by the existing Lucide icon instances because they are verified one-off glyph inputs, not a reusable public size scale. The shared controls now consume the disabled text, surface, and opacity tokens directly.

Phase 3B reuses the existing control, quick-filter, option, semantic state, and focus tokens for FilterTrigger and FilterOption. No new token was added; the demonstrated 56 px value segment and 12 px icon geometry remain local one-off measurements rather than speculative scale entries.

Phase 3C reuses the existing row, market tone, selected state, impact, chart-action, pagination, focus, and responsive tokens for the market result and Pagination contracts. No new token was added; table column widths and the 30 px chart-cell action remain component-owned geometry rather than speculative global sizes.

Phase 3D moves the page canvas, header, brand/status, desktop navigation, actions, and mobile product menu to `components/shell` without adding tokens. Page-specific workspace geometry stays in the dashboard module, while the shell consumes the established page, header, navigation, menu, scrollbar, focus, and responsive tokens.

Phase 3E moves the detail-panel surface and duplicated mobile sheet outer geometry to `components/ui` without adding tokens. The shared sheet shell consumes the established overlay, surface, border, radius, shadow, close, layer, and motion roles; the demonstrated `content-footer` and `full-scroll` layouts preserve the existing height and scroll formulas without exposing domain state through the generic API.

## 10. Unresolved Items

- Inter remains declaration-only. Actual glyph rendering depends on the client machine's installed fonts.
- Disabled-state and reduced-motion tokens are defined, but dashboard-v2 currently has no matching rendered state or reduced-motion override to migrate without changing behavior.
- Some token values preserve visually close but distinct colors. Consolidation requires a separate visual decision and new baseline approval.
- The global button cascade and dashboard ownership boundary remain as documented in `docs/UI_BASELINE_AUDIT.md`.

## 11. Phase 3 Shared Component Inputs

Prioritize these token groups when shared components are introduced:

1. Segmented control: `--sr-size-control`, mobile tab sizes, control radius, border, tab text, accent active/selected colors.
2. Filter control and option pill: control/filter option sizes, border-control, surface-control/option, text label/value, focus ring.
3. Event and impact badges: badge size, badge radius, event semantic colors/surfaces, warning/accent impact colors.
4. Market data row: desktop/mobile row sizes, table surfaces/dividers, ticker/body/muted text, numeric behavior, selected state.
5. Icon button and close button: icon sizes, close borders/surfaces, focus ring, interaction states.
6. Panel, popover, and sheet shells: surface/border/radius/shadow/layer/motion tokens.
7. Chart shell: chart palette, axis typography, chart min height, and chart-specific opacity values.

Component extraction must continue to preserve the dashboard-v2 DOM behavior and the canonical desktop/mobile layouts. Token availability alone is not a reason to merge components with different interaction roles.

## 12. Validation Record

- Production build render: `next build` followed by `next start` at `127.0.0.1`.
- Comparison captures were written to `%TEMP%/stock-radar-token-comparison`; they are not repository artifacts.
- Exact pixel comparison against all eight files in `docs/ui-reference/dashboard-v2/` passed with zero changed pixels:
  - 390 x 844 initial and AMD selected
  - 375 x 812 initial and AMD selected
  - 1440 x 900 initial and AMD selected
  - 1920 x 1080 initial and AMD selected
- Requested outer image dimensions were preserved.
- No runtime exception or HTTP error was recorded during the final eight-state capture.
- Project validation: `npm run typecheck`, `npm run build`, and `git diff --check`.
- The project defines no `lint` or general `test` script in `package.json`; no unrelated QA scripts were run.
