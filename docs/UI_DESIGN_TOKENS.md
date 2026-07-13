# Stock Radar UI Design Tokens

Phase: 2 - design token foundation

Canonical visual baseline: commit `f87660f`, `/dashboard-v2`, and `docs/ui-reference/dashboard-v2/`

Implementation branch: `refactor/dashboard-v2-design-tokens`

This document defines the semantic token layer extracted from the canonical dashboard-v2 implementation. It records a value-preserving refactor: no layout, copy, component API, responsive behavior, data, or interaction was intentionally changed.

## 1. Token Source and Loading

- Source of truth: `app/stock-radar-tokens.css`.
- Global load path: `app/layout.tsx` imports `./stock-radar-tokens.css` before `./globals.css`.
- Consumption: `components/dashboard-v2/StockRadarDashboardV2.module.css` uses the global custom properties inside the existing `dashboard-v2-*` selectors.
- Inline SVG exception: `components/dashboard-v2/MockChart.tsx` uses `var(--sr-color-chart-volume-bullish)` in SVG `stopColor`; browsers resolve the custom property without a JavaScript token mirror.
- Scope: tokens are declared once on `:root`. No unrequested light theme or alternate palette is defined.

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

There are 251 tokens: 131 color, 38 typography, 22 spacing, 22 sizing, 22 shape/effect, and 16 layer/motion tokens.

### Color: canvas, surfaces, and overlays

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-page-background` (source `app/stock-radar-tokens.css:3`) | `#080a0d` | Semantic page background color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:11` |
| `--sr-color-page-background-top` (source `app/stock-radar-tokens.css:4`) | `#0b0d10` | Semantic page background top color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:11`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:243` |
| `--sr-color-page-glow` (source `app/stock-radar-tokens.css:5`) | `rgba(255, 122, 26, 0.07)` | Semantic page glow color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:10` |
| `--sr-color-surface` (source `app/stock-radar-tokens.css:6`) | `#0d1014` | Semantic surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:697` |
| `--sr-color-surface-panel` (source `app/stock-radar-tokens.css:7`) | `#11161b` | Semantic surface panel color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1974` |
| `--sr-color-surface-elevated` (source `app/stock-radar-tokens.css:8`) | `#161b20` | Semantic surface elevated color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-surface-overlay` (source `app/stock-radar-tokens.css:9`) | `#0d1116` | Semantic surface overlay color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1238`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1640`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1819` |
| `--sr-color-surface-header` (source `app/stock-radar-tokens.css:10`) | `rgba(10, 12, 15, 0.92)` | Semantic surface header color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:61` |
| `--sr-color-surface-control` (source `app/stock-radar-tokens.css:11`) | `#0e1216` | Semantic surface control color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:322`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1340` |
| `--sr-color-surface-control-strong` (source `app/stock-radar-tokens.css:12`) | `#151a1f` | Semantic surface control strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:630`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:688` |
| `--sr-color-surface-control-group` (source `app/stock-radar-tokens.css:13`) | `rgba(10, 13, 16, 0.76)` | Semantic surface control group color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:273` |
| `--sr-color-surface-table-header-start` (source `app/stock-radar-tokens.css:14`) | `#1a1e22` | Semantic surface table header start color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:399` |
| `--sr-color-surface-table-header-end` (source `app/stock-radar-tokens.css:15`) | `#15191d` | Semantic surface table header end color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:399` |
| `--sr-color-surface-table-panel` (source `app/stock-radar-tokens.css:16`) | `rgba(12, 15, 18, 0.95)` | Semantic surface table panel color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:370` |
| `--sr-color-surface-table-row` (source `app/stock-radar-tokens.css:17`) | `rgba(12, 15, 18, 0.86)` | Semantic surface table row color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:410`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1390` |
| `--sr-color-surface-table-hover` (source `app/stock-radar-tokens.css:18`) | `#11171c` | Semantic surface table hover color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:416`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:424`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1394` |
| `--sr-color-surface-footer-start` (source `app/stock-radar-tokens.css:19`) | `#191e23` | Semantic surface footer start color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:630` |
| `--sr-color-surface-detail-start` (source `app/stock-radar-tokens.css:20`) | `#101419` | Semantic surface detail start color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:697`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1022` |
| `--sr-color-surface-option` (source `app/stock-radar-tokens.css:21`) | `rgba(14, 18, 22, 0.92)` | Semantic surface option color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1743` |
| `--sr-color-surface-overlay-control` (source `app/stock-radar-tokens.css:22`) | `rgba(13, 17, 22, 0.72)` | Semantic surface overlay control color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1671`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1851` |
| `--sr-color-surface-overlay-footer` (source `app/stock-radar-tokens.css:23`) | `rgba(13, 17, 22, 0.96)` | Semantic surface overlay footer color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1761` |
| `--sr-color-surface-muted-action` (source `app/stock-radar-tokens.css:24`) | `rgba(19, 24, 30, 0.96)` | Semantic surface muted action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1775` |
| `--sr-color-surface-emphasized-action` (source `app/stock-radar-tokens.css:25`) | `#14171b` | Semantic surface emphasized action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1783` |
| `--sr-color-surface-navigation-menu` (source `app/stock-radar-tokens.css:26`) | `rgba(12, 16, 21, 0.98)` | Semantic surface navigation menu color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:181` |
| `--sr-color-overlay-filter` (source `app/stock-radar-tokens.css:27`) | `rgba(3, 5, 8, 0.66)` | Semantic overlay filter color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1611` |
| `--sr-color-overlay-ticker` (source `app/stock-radar-tokens.css:28`) | `rgba(3, 5, 8, 0.68)` | Semantic overlay ticker color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1791` |

### Color: borders and dividers

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-border` (source `app/stock-radar-tokens.css:31`) | `#2c333a` | Semantic border color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:271`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:289`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:318`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:329` |
| `--sr-color-divider` (source `app/stock-radar-tokens.css:32`) | `#20262c` | Semantic divider color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:59`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:259`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:368`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:389` |
| `--sr-color-border-overlay` (source `app/stock-radar-tokens.css:33`) | `rgba(74, 82, 92, 0.78)` | Semantic border overlay color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1635`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1814` |
| `--sr-color-border-overlay-strong` (source `app/stock-radar-tokens.css:34`) | `rgba(74, 82, 92, 0.82)` | Semantic border overlay strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:178`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1233` |
| `--sr-color-border-overlay-soft` (source `app/stock-radar-tokens.css:35`) | `rgba(74, 82, 92, 0.58)` | Semantic border overlay soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1693` |
| `--sr-color-border-overlay-actions` (source `app/stock-radar-tokens.css:36`) | `rgba(74, 82, 92, 0.62)` | Semantic border overlay actions color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1759` |
| `--sr-color-border-section` (source `app/stock-radar-tokens.css:37`) | `rgba(52, 59, 68, 0.74)` | Semantic border section color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1714` |
| `--sr-color-border-control` (source `app/stock-radar-tokens.css:38`) | `rgba(71, 79, 90, 0.9)` | Semantic border control color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1739` |
| `--sr-color-border-close` (source `app/stock-radar-tokens.css:39`) | `rgba(104, 115, 128, 0.58)` | Semantic border close color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1667` |
| `--sr-color-border-close-soft` (source `app/stock-radar-tokens.css:40`) | `rgba(255, 255, 255, 0.13)` | Semantic border close soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1848` |
| `--sr-color-border-muted-action` (source `app/stock-radar-tokens.css:41`) | `rgba(86, 96, 108, 0.8)` | Semantic border muted action color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1773` |

### Color: text

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-text-primary` (source `app/stock-radar-tokens.css:44`) | `#e5e8ec` | Semantic text primary color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:8`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:383` |
| `--sr-color-text-bright` (source `app/stock-radar-tokens.css:45`) | `#f5f6f7` | Semantic text bright color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:91` |
| `--sr-color-text-strong` (source `app/stock-radar-tokens.css:46`) | `#f0f3f6` | Semantic text strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:741`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1475` |
| `--sr-color-text-ticker` (source `app/stock-radar-tokens.css:47`) | `#f0f2f5` | Semantic text ticker color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:489` |
| `--sr-color-text-heading` (source `app/stock-radar-tokens.css:48`) | `#dadde3` | Semantic text heading color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:724` |
| `--sr-color-text-body` (source `app/stock-radar-tokens.css:49`) | `#d7dbe0` | Semantic text body color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:209`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:219`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:409` |
| `--sr-color-text-menu` (source `app/stock-radar-tokens.css:50`) | `#d8dde4` | Semantic text menu color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1262` |
| `--sr-color-text-timeline` (source `app/stock-radar-tokens.css:51`) | `#d9dde3` | Semantic text timeline color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:984` |
| `--sr-color-text-secondary` (source `app/stock-radar-tokens.css:52`) | `#c0c5cc` | Semantic text secondary color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:497` |
| `--sr-color-text-detail-secondary` (source `app/stock-radar-tokens.css:53`) | `#bdc3cb` | Semantic text detail secondary color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:731`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:793` |
| `--sr-color-text-control` (source `app/stock-radar-tokens.css:54`) | `#c8ced6` | Semantic text control color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:657`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:823`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1774` |
| `--sr-color-text-control-strong` (source `app/stock-radar-tokens.css:55`) | `#d6d9de` | Semantic text control strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:321`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1339` |
| `--sr-color-text-footer` (source `app/stock-radar-tokens.css:56`) | `#c9cdd3` | Semantic text footer color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:629` |
| `--sr-color-text-label` (source `app/stock-radar-tokens.css:57`) | `#cbd0d7` | Semantic text label color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:908` |
| `--sr-color-text-close` (source `app/stock-radar-tokens.css:58`) | `#d7dce3` | Semantic text close color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1670`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1850` |
| `--sr-color-text-option` (source `app/stock-radar-tokens.css:59`) | `#d4d8df` | Semantic text option color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1742` |
| `--sr-color-text-sheet-title` (source `app/stock-radar-tokens.css:60`) | `#f0f3f7` | Semantic text sheet title color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1700` |
| `--sr-color-text-subtle` (source `app/stock-radar-tokens.css:61`) | `#aeb5be` | Semantic text subtle color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:398`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:679`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:945` |
| `--sr-color-text-muted` (source `app/stock-radar-tokens.css:62`) | `#9aa2ad` | Semantic text muted color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-text-meta` (source `app/stock-radar-tokens.css:63`) | `#8a929d` | Semantic text meta color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:994` |
| `--sr-color-text-delay` (source `app/stock-radar-tokens.css:64`) | `#8a919a` | Semantic text delay color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:102` |
| `--sr-color-text-nav` (source `app/stock-radar-tokens.css:65`) | `#9ba3ad` | Semantic text nav color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:142` |
| `--sr-color-text-tab` (source `app/stock-radar-tokens.css:66`) | `#b5bac1` | Semantic text tab color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:290` |
| `--sr-color-text-mobile-company` (source `app/stock-radar-tokens.css:67`) | `#9ca4ae` | Semantic text mobile company color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1456` |
| `--sr-color-text-mobile-rank` (source `app/stock-radar-tokens.css:68`) | `#aab1ba` | Semantic text mobile rank color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1427` |
| `--sr-color-text-mobile-value` (source `app/stock-radar-tokens.css:69`) | `#aeb6c0` | Semantic text mobile value color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1490` |
| `--sr-color-text-filter-label` (source `app/stock-radar-tokens.css:70`) | `#c4c8ce` | Semantic text filter label color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:331` |
| `--sr-color-text-filter-value` (source `app/stock-radar-tokens.css:71`) | `#e0e4e8` | Semantic text filter value color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:339` |
| `--sr-color-text-filter-icon` (source `app/stock-radar-tokens.css:72`) | `#b6bcc4` | Semantic text filter icon color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:347` |
| `--sr-color-text-section-label` (source `app/stock-radar-tokens.css:73`) | `#c8cdd4` | Semantic text section label color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1724` |
| `--sr-color-text-chart-icon` (source `app/stock-radar-tokens.css:74`) | `#c4c9d0` | Semantic text chart icon color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:593` |
| `--sr-color-text-detail-close` (source `app/stock-radar-tokens.css:75`) | `#ccd1d7` | Semantic text detail close color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:709` |
| `--sr-color-text-inverse` (source `app/stock-radar-tokens.css:76`) | `#ffffff` | Semantic text inverse color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:664`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:800`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:895` |

### Color: accent and interaction states

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-accent` (source `app/stock-radar-tokens.css:79`) | `#ff7a1a` | Semantic accent color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:110`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:151`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:167`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:245` |
| `--sr-color-accent-strong` (source `app/stock-radar-tokens.css:80`) | `#ff8b2e` | Semantic accent strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1017` |
| `--sr-color-accent-highlight` (source `app/stock-radar-tokens.css:81`) | `#ffad67` | Semantic accent highlight color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:665` |
| `--sr-color-accent-text` (source `app/stock-radar-tokens.css:82`) | `#ff9a3c` | Semantic accent text color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1019` |
| `--sr-color-accent-text-soft` (source `app/stock-radar-tokens.css:83`) | `#ff9a4a` | Semantic accent text soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1536`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1780` |
| `--sr-color-premium` (source `app/stock-radar-tokens.css:84`) | `#d8a068` | Semantic premium color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:195`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1280` |
| `--sr-color-accent-selected` (source `app/stock-radar-tokens.css:85`) | `rgba(255, 122, 26, 0.1)` | Semantic accent selected color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:152`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:603`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1503` |
| `--sr-color-accent-active` (source `app/stock-radar-tokens.css:86`) | `rgba(255, 122, 26, 0.13)` | Semantic accent active color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:303` |
| `--sr-color-accent-active-soft` (source `app/stock-radar-tokens.css:87`) | `rgba(255, 122, 26, 0.12)` | Semantic accent active soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1346`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1537` |
| `--sr-color-accent-active-strong` (source `app/stock-radar-tokens.css:88`) | `rgba(255, 122, 26, 0.14)` | Semantic accent active strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1751` |
| `--sr-color-accent-hover` (source `app/stock-radar-tokens.css:89`) | `rgba(255, 122, 26, 0.08)` | Semantic accent hover color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:168` |
| `--sr-color-accent-subtle` (source `app/stock-radar-tokens.css:90`) | `rgba(255, 122, 26, 0.04)` | Semantic accent subtle color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:196` |
| `--sr-color-accent-menu` (source `app/stock-radar-tokens.css:91`) | `rgba(255, 122, 26, 0.032)` | Semantic accent menu color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1271` |
| `--sr-color-accent-sheet-glow` (source `app/stock-radar-tokens.css:92`) | `rgba(255, 122, 26, 0.06)` | Semantic accent sheet glow color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1818` |
| `--sr-color-accent-overlay-glow` (source `app/stock-radar-tokens.css:93`) | `rgba(255, 122, 26, 0.07)` | Semantic accent overlay glow color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1237`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1639` |
| `--sr-color-accent-cta-top` (source `app/stock-radar-tokens.css:94`) | `rgba(255, 122, 26, 0.16)` | Semantic accent cta top color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1021` |
| `--sr-color-accent-cta-bottom` (source `app/stock-radar-tokens.css:95`) | `rgba(255, 122, 26, 0.07)` | Semantic accent cta bottom color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1021` |
| `--sr-color-accent-cta-strong` (source `app/stock-radar-tokens.css:96`) | `rgba(255, 122, 26, 0.2)` | Semantic accent cta strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1782`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1973` |
| `--sr-color-accent-cta-strong-bottom` (source `app/stock-radar-tokens.css:97`) | `rgba(255, 122, 26, 0.08)` | Semantic accent cta strong bottom color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1782`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1973` |
| `--sr-color-accent-transparent` (source `app/stock-radar-tokens.css:98`) | `rgba(255, 122, 26, 0)` | Semantic accent transparent color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1237`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1639` |
| `--sr-color-accent-border` (source `app/stock-radar-tokens.css:99`) | `rgba(255, 122, 26, 0.58)` | Semantic accent border color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:150`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1533` |
| `--sr-color-accent-border-open` (source `app/stock-radar-tokens.css:100`) | `rgba(255, 122, 26, 0.52)` | Semantic accent border open color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:166` |
| `--sr-color-accent-border-active` (source `app/stock-radar-tokens.css:101`) | `rgba(255, 122, 26, 0.78)` | Semantic accent border active color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1344` |
| `--sr-color-accent-border-strong` (source `app/stock-radar-tokens.css:102`) | `rgba(255, 122, 26, 0.8)` | Semantic accent border strong color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1749` |
| `--sr-color-accent-border-emphasis` (source `app/stock-radar-tokens.css:103`) | `rgba(255, 122, 26, 0.88)` | Semantic accent border emphasis color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1779` |
| `--sr-color-accent-border-premium` (source `app/stock-radar-tokens.css:104`) | `rgba(255, 122, 26, 0.24)` | Semantic accent border premium color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:194` |
| `--sr-color-accent-nav-line` (source `app/stock-radar-tokens.css:105`) | `rgba(255, 122, 26, 0.45)` | Semantic accent nav line color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:153` |
| `--sr-color-accent-focus-soft` (source `app/stock-radar-tokens.css:106`) | `rgba(255, 122, 26, 0.5)` | Semantic accent focus soft color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:425` |
| `--sr-color-accent-focus-mobile` (source `app/stock-radar-tokens.css:107`) | `rgba(255, 122, 26, 0.56)` | Semantic accent focus mobile color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1398` |

### Color: market and event semantics

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-positive` (source `app/stock-radar-tokens.css:110`) | `#50e386` | Semantic positive color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:503`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:583`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:748` |
| `--sr-color-negative` (source `app/stock-radar-tokens.css:111`) | `#ff675f` | Semantic negative color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:508`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:611`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:754`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1505` |
| `--sr-color-warning` (source `app/stock-radar-tokens.css:112`) | `#f4c542` | Semantic warning color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:579`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:999` |
| `--sr-color-info` (source `app/stock-radar-tokens.css:113`) | `#5cadff` | Semantic info color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-event-earnings` (source `app/stock-radar-tokens.css:114`) | `#36d5c2` | Semantic event earnings color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:532`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:953` |
| `--sr-color-event-earnings-surface` (source `app/stock-radar-tokens.css:115`) | `rgba(54, 213, 194, 0.12)` | Semantic event earnings surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:533` |
| `--sr-color-event-legal` (source `app/stock-radar-tokens.css:116`) | `#ff675f` | Semantic event legal color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:537`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:949` |
| `--sr-color-event-legal-surface` (source `app/stock-radar-tokens.css:117`) | `rgba(255, 103, 95, 0.13)` | Semantic event legal surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:538` |
| `--sr-color-event-insider` (source `app/stock-radar-tokens.css:118`) | `#bc8cff` | Semantic event insider color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:542`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:957` |
| `--sr-color-event-insider-surface` (source `app/stock-radar-tokens.css:119`) | `rgba(188, 140, 255, 0.13)` | Semantic event insider surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:543` |
| `--sr-color-event-transaction` (source `app/stock-radar-tokens.css:120`) | `#5cadff` | Semantic event transaction color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:548`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:961` |
| `--sr-color-event-transaction-surface` (source `app/stock-radar-tokens.css:121`) | `rgba(92, 173, 255, 0.12)` | Semantic event transaction surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:549` |
| `--sr-color-event-product` (source `app/stock-radar-tokens.css:122`) | `#f4c542` | Semantic event product color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:553` |
| `--sr-color-event-product-surface` (source `app/stock-radar-tokens.css:123`) | `rgba(244, 197, 66, 0.13)` | Semantic event product surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:554` |
| `--sr-color-event-neutral` (source `app/stock-radar-tokens.css:124`) | `#cbd1d9` | Semantic event neutral color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:559` |
| `--sr-color-event-neutral-surface` (source `app/stock-radar-tokens.css:125`) | `rgba(203, 209, 217, 0.08)` | Semantic event neutral surface color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:560` |

### Color: chart

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-chart-bullish` (source `app/stock-radar-tokens.css:128`) | `#3dd985` | Semantic chart bullish color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:878` |
| `--sr-color-chart-bearish` (source `app/stock-radar-tokens.css:129`) | `#f45c55` | Semantic chart bearish color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:882` |
| `--sr-color-chart-grid` (source `app/stock-radar-tokens.css:130`) | `rgba(255, 255, 255, 0.064)` | Semantic chart grid color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:835` |
| `--sr-color-chart-axis` (source `app/stock-radar-tokens.css:131`) | `#b4bac2` | Semantic chart axis color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:852` |
| `--sr-color-chart-ohlc` (source `app/stock-radar-tokens.css:132`) | `#50e386` | Semantic chart ohlc color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:860` |
| `--sr-color-chart-last-line` (source `app/stock-radar-tokens.css:133`) | `rgba(80, 227, 134, 0.22)` | Semantic chart last line color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:886` |
| `--sr-color-chart-last-price` (source `app/stock-radar-tokens.css:134`) | `#3acb83` | Semantic chart last price color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:891` |
| `--sr-color-chart-volume-bullish` (source `app/stock-radar-tokens.css:135`) | `#2be38a` | Semantic chart volume bullish color. | `components/dashboard-v2/MockChart.tsx:72`<br>`components/dashboard-v2/MockChart.tsx:73` |
| `--sr-opacity-chart-volume` (source `app/stock-radar-tokens.css:136`) | `0.28` | Opacity for chart volume. | `components/dashboard-v2/StockRadarDashboardV2.module.css:874` |

### Color: scrollbar and disabled state

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-color-scrollbar-track` (source `app/stock-radar-tokens.css:139`) | `#0b0f13` | Semantic scrollbar track color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:21`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:31`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:35` |
| `--sr-color-scrollbar-thumb` (source `app/stock-radar-tokens.css:140`) | `#3a434d` | Semantic scrollbar thumb color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:21`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:37` |
| `--sr-color-scrollbar-thumb-hover` (source `app/stock-radar-tokens.css:141`) | `#515c67` | Semantic scrollbar thumb hover color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:41` |
| `--sr-color-sheet-handle` (source `app/stock-radar-tokens.css:142`) | `#65707b` | Semantic sheet handle color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1653`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1833` |
| `--sr-color-state-disabled-text` (source `app/stock-radar-tokens.css:143`) | `#6f7782` | Semantic state disabled text color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-color-state-disabled-surface` (source `app/stock-radar-tokens.css:144`) | `#161b20` | Semantic state disabled surface color. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-opacity-disabled` (source `app/stock-radar-tokens.css:145`) | `0.6` | Opacity for disabled. | Reserved foundation role; see Migration Result for its phase 3 contract. |

### Typography

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-font-family-sans` (source `app/stock-radar-tokens.css:148`) | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Primary Stock Radar UI font stack. | `components/dashboard-v2/StockRadarDashboardV2.module.css:12` |
| `--sr-font-family-mono` (source `app/stock-radar-tokens.css:149`) | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` | Monospace stack for chart axes and numeric chart labels. | `components/dashboard-v2/StockRadarDashboardV2.module.css:846` |
| `--sr-font-variant-numeric` (source `app/stock-radar-tokens.css:150`) | `tabular-nums` | Stable-width numeric glyph behavior. | `components/dashboard-v2/StockRadarDashboardV2.module.css:504`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:509` |
| `--sr-font-size-xs` (source `app/stock-radar-tokens.css:151`) | `11px` | Typography size scale at 11px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:526`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1353`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1538`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1725` |
| `--sr-font-size-xs-plus` (source `app/stock-radar-tokens.css:152`) | `11.5px` | Typography size scale at 11.5px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1305`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1313` |
| `--sr-font-size-sm` (source `app/stock-radar-tokens.css:153`) | `12px` | Typography size scale at 12px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:332`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:400`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:568`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:659` |
| `--sr-font-size-md` (source `app/stock-radar-tokens.css:154`) | `13px` | Typography size scale at 13px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:143`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:292`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:340`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:631` |
| `--sr-font-size-md-plus` (source `app/stock-radar-tokens.css:155`) | `13.5px` | Typography size scale at 13.5px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1448` |
| `--sr-font-size-base` (source `app/stock-radar-tokens.css:156`) | `14px` | Typography size scale at 14px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:103`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:411`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:490`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:732` |
| `--sr-font-size-lg` (source `app/stock-radar-tokens.css:157`) | `15px` | Typography size scale at 15px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1025` |
| `--sr-font-size-lg-plus` (source `app/stock-radar-tokens.css:158`) | `15.5px` | Typography size scale at 15.5px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1912` |
| `--sr-font-size-xl` (source `app/stock-radar-tokens.css:159`) | `17px` | Typography size scale at 17px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:749` |
| `--sr-font-size-2xl` (source `app/stock-radar-tokens.css:160`) | `18px` | Typography size scale at 18px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1701` |
| `--sr-font-size-heading-sm` (source `app/stock-radar-tokens.css:161`) | `22px` | Typography size scale at 22px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1177` |
| `--sr-font-size-heading-md` (source `app/stock-radar-tokens.css:162`) | `25px` | Typography size scale at 25px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:92` |
| `--sr-font-size-metric-sm` (source `app/stock-radar-tokens.css:163`) | `26px` | Typography size scale at 26px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1908` |
| `--sr-font-size-metric-md` (source `app/stock-radar-tokens.css:164`) | `29px` | Typography size scale at 29px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:742` |
| `--sr-font-size-heading-lg` (source `app/stock-radar-tokens.css:165`) | `31px` | Typography size scale at 31px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1885` |
| `--sr-font-size-heading-xl` (source `app/stock-radar-tokens.css:166`) | `34px` | Typography size scale at 34px. | `components/dashboard-v2/StockRadarDashboardV2.module.css:725` |
| `--sr-font-weight-regular` (source `app/stock-radar-tokens.css:167`) | `400` | Typography weight scale at 400. | `components/dashboard-v2/StockRadarDashboardV2.module.css:13` |
| `--sr-font-weight-medium` (source `app/stock-radar-tokens.css:168`) | `500` | Typography weight scale at 500. | `components/dashboard-v2/StockRadarDashboardV2.module.css:341`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:660` |
| `--sr-font-weight-emphasis` (source `app/stock-radar-tokens.css:169`) | `540` | Typography weight scale at 540. | `components/dashboard-v2/StockRadarDashboardV2.module.css:986` |
| `--sr-font-weight-nav` (source `app/stock-radar-tokens.css:170`) | `680` | Typography weight scale at 680. | `components/dashboard-v2/StockRadarDashboardV2.module.css:144` |
| `--sr-font-weight-semibold` (source `app/stock-radar-tokens.css:171`) | `700` | Typography weight scale at 700. | `components/dashboard-v2/StockRadarDashboardV2.module.css:293`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1485`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1539`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1745` |
| `--sr-font-weight-strong` (source `app/stock-radar-tokens.css:172`) | `720` | Typography weight scale at 720. | `components/dashboard-v2/StockRadarDashboardV2.module.css:796`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1264`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1429` |
| `--sr-font-weight-display` (source `app/stock-radar-tokens.css:173`) | `760` | Typography weight scale at 760. | `components/dashboard-v2/StockRadarDashboardV2.module.css:93`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:333`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:491`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:743` |
| `--sr-font-weight-label` (source `app/stock-radar-tokens.css:174`) | `780` | Typography weight scale at 780. | `components/dashboard-v2/StockRadarDashboardV2.module.css:401`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:527`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1001`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1702` |
| `--sr-font-weight-heavy` (source `app/stock-radar-tokens.css:175`) | `800` | Typography weight scale at 800. | `components/dashboard-v2/StockRadarDashboardV2.module.css:569`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:726`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:897`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1026` |
| `--sr-line-height-tightest` (source `app/stock-radar-tokens.css:176`) | `0.98` | Typography line-height scale at 0.98. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1886` |
| `--sr-line-height-none` (source `app/stock-radar-tokens.css:177`) | `1` | Typography line-height scale at 1. | `components/dashboard-v2/StockRadarDashboardV2.module.css:94`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:145`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:412`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:485` |
| `--sr-line-height-compact` (source `app/stock-radar-tokens.css:178`) | `1.1` | Typography line-height scale at 1.1. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1458`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1486` |
| `--sr-line-height-snug` (source `app/stock-radar-tokens.css:179`) | `1.15` | Typography line-height scale at 1.15. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1314`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1412` |
| `--sr-line-height-control` (source `app/stock-radar-tokens.css:180`) | `1.25` | Typography line-height scale at 1.25. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1306` |
| `--sr-line-height-body` (source `app/stock-radar-tokens.css:181`) | `1.3` | Typography line-height scale at 1.3. | `components/dashboard-v2/StockRadarDashboardV2.module.css:987` |
| `--sr-line-height-relaxed` (source `app/stock-radar-tokens.css:182`) | `1.35` | Typography line-height scale at 1.35. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1097`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1892` |
| `--sr-line-height-default` (source `app/stock-radar-tokens.css:183`) | `1.45` | Typography line-height scale at 1.45. | `components/dashboard-v2/StockRadarDashboardV2.module.css:14` |
| `--sr-letter-spacing-default` (source `app/stock-radar-tokens.css:184`) | `0` | Typography letter spacing for default. | `components/dashboard-v2/StockRadarDashboardV2.module.css:15`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:50`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1703`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1727` |
| `--sr-letter-spacing-brand` (source `app/stock-radar-tokens.css:185`) | `0.02em` | Typography letter spacing for brand. | `components/dashboard-v2/StockRadarDashboardV2.module.css:95` |

### Spacing

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-space-0-5` (source `app/stock-radar-tokens.css:188`) | `2px` | Reusable 2px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1111`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1186`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1335`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1524` |
| `--sr-space-1` (source `app/stock-radar-tokens.css:189`) | `4px` | Reusable 4px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:117`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:929`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1104`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1173` |
| `--sr-space-1-25` (source `app/stock-radar-tokens.css:190`) | `5px` | Reusable 5px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:357`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:993`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1304`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1532` |
| `--sr-space-1-5` (source `app/stock-radar-tokens.css:191`) | `6px` | Reusable 6px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:180`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:514`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1103`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1200` |
| `--sr-space-1-75` (source `app/stock-radar-tokens.css:192`) | `7px` | Reusable 7px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:174`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:239`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:240`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:475` |
| `--sr-space-2` (source `app/stock-radar-tokens.css:193`) | `8px` | Reusable 8px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:215`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:644`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:685`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:970` |
| `--sr-space-2-25` (source `app/stock-radar-tokens.css:194`) | `9px` | Reusable 9px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:101`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:141`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:759`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:766` |
| `--sr-space-2-5` (source `app/stock-radar-tokens.css:195`) | `10px` | Reusable 10px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:190`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:310`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:338`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:346` |
| `--sr-space-3` (source `app/stock-radar-tokens.css:196`) | `12px` | Reusable 12px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:351`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:352`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:391`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:814` |
| `--sr-space-3-25` (source `app/stock-radar-tokens.css:197`) | `13px` | Reusable 13px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:330`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:927`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1115` |
| `--sr-space-3-5` (source `app/stock-radar-tokens.css:198`) | `14px` | Reusable 14px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:201`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:628`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:737`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:967` |
| `--sr-space-4` (source `app/stock-radar-tokens.css:199`) | `16px` | Reusable 16px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:719`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:907`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1660`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1661` |
| `--sr-space-4-5` (source `app/stock-radar-tokens.css:200`) | `18px` | Reusable 18px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:58`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:260`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:311`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:312` |
| `--sr-space-5` (source `app/stock-radar-tokens.css:201`) | `20px` | Reusable 20px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:260`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:772`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:903`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1575` |
| `--sr-space-5-5` (source `app/stock-radar-tokens.css:202`) | `22px` | Reusable 22px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:265`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:903`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1559`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1872` |
| `--sr-space-6` (source `app/stock-radar-tokens.css:203`) | `24px` | Reusable 24px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:86`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:715`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:760`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:772` |
| `--sr-space-7` (source `app/stock-radar-tokens.css:204`) | `28px` | Reusable 28px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:715`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:903`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1016`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1603` |
| `--sr-space-8` (source `app/stock-radar-tokens.css:205`) | `32px` | Reusable 32px spacing scale step. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1016`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1231` |
| `--sr-page-gutter-desktop` (source `app/stock-radar-tokens.css:206`) | `28px` | Canonical page gutter desktop spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:260` |
| `--sr-page-gutter-mobile` (source `app/stock-radar-tokens.css:207`) | `12px` | Canonical page gutter mobile spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1288` |
| `--sr-header-gutter-start` (source `app/stock-radar-tokens.css:208`) | `30px` | Canonical header gutter start spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:60` |
| `--sr-header-gutter-end` (source `app/stock-radar-tokens.css:209`) | `24px` | Canonical header gutter end spacing. | `components/dashboard-v2/StockRadarDashboardV2.module.css:60` |

### Sizing

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-size-header` (source `app/stock-radar-tokens.css:212`) | `56px` | Canonical header dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:55`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:253`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:693`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:695` |
| `--sr-size-nav-item` (source `app/stock-radar-tokens.css:213`) | `30px` | Canonical nav item dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:137` |
| `--sr-size-icon-button` (source `app/stock-radar-tokens.css:214`) | `34px` | Canonical icon button dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:225`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:705`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:706` |
| `--sr-size-icon-button-mobile` (source `app/stock-radar-tokens.css:215`) | `32px` | Canonical icon button mobile dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1205`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1209` |
| `--sr-size-close-button` (source `app/stock-radar-tokens.css:216`) | `38px` | Canonical close button dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1663`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1664`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1843`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1844` |
| `--sr-size-control` (source `app/stock-radar-tokens.css:217`) | `40px` | Canonical control dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:287`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:316`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:327`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1766` |
| `--sr-size-mobile-primary-tab` (source `app/stock-radar-tokens.css:218`) | `42px` | Canonical mobile primary tab dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1303` |
| `--sr-size-mobile-session-tab` (source `app/stock-radar-tokens.css:219`) | `35px` | Canonical mobile session tab dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1311` |
| `--sr-size-mobile-quick-filter` (source `app/stock-radar-tokens.css:220`) | `34px` | Canonical mobile quick filter dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1332` |
| `--sr-size-filter-option` (source `app/stock-radar-tokens.css:221`) | `32px` | Canonical filter option dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1738` |
| `--sr-size-table-header-row` (source `app/stock-radar-tokens.css:222`) | `46px` | Canonical table header row dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:397` |
| `--sr-size-table-row` (source `app/stock-radar-tokens.css:223`) | `43px` | Canonical table row dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:408` |
| `--sr-size-mobile-list-row` (source `app/stock-radar-tokens.css:224`) | `48px` | Canonical mobile list row dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1383` |
| `--sr-size-table-footer` (source `app/stock-radar-tokens.css:225`) | `42px` | Canonical table footer dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:626` |
| `--sr-size-badge` (source `app/stock-radar-tokens.css:226`) | `22px` | Canonical badge dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:513`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:520`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:565` |
| `--sr-size-filter-chip` (source `app/stock-radar-tokens.css:227`) | `28px` | Canonical filter chip dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1530` |
| `--sr-size-analysis-cta` (source `app/stock-radar-tokens.css:228`) | `58px` | Canonical analysis cta dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1012` |
| `--sr-size-chart-min-height` (source `app/stock-radar-tokens.css:229`) | `250px` | Canonical chart min height dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:831` |
| `--sr-size-market-table-min-width` (source `app/stock-radar-tokens.css:230`) | `1060px` | Canonical market table min width dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:380` |
| `--sr-size-mobile-menu-width` (source `app/stock-radar-tokens.css:231`) | `216px` | Canonical mobile menu width dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1231` |
| `--sr-size-sheet-handle-width` (source `app/stock-radar-tokens.css:232`) | `46px` | Canonical sheet handle width dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1650`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1830` |
| `--sr-size-sheet-handle-height` (source `app/stock-radar-tokens.css:233`) | `4px` | Canonical sheet handle height dimension. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1651`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1831` |

### Shape and effects

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-border-width` (source `app/stock-radar-tokens.css:236`) | `1px` | Canonical border width (1px). | `components/dashboard-v2/StockRadarDashboardV2.module.css:59`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:139`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:178`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:243` |
| `--sr-border-width-strong` (source `app/stock-radar-tokens.css:237`) | `2px` | Canonical border width (2px). | `components/dashboard-v2/StockRadarDashboardV2.module.css:35`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1275` |
| `--sr-radius-sm` (source `app/stock-radar-tokens.css:238`) | `4px` | Corner radius for sm. | `components/dashboard-v2/StockRadarDashboardV2.module.css:140`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:524`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:592` |
| `--sr-radius-control` (source `app/stock-radar-tokens.css:239`) | `5px` | Corner radius for control. | `components/dashboard-v2/StockRadarDashboardV2.module.css:272`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:319`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:369`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:656` |
| `--sr-radius-base` (source `app/stock-radar-tokens.css:240`) | `6px` | Corner radius for base. | `components/dashboard-v2/StockRadarDashboardV2.module.css:189` |
| `--sr-radius-mobile-control` (source `app/stock-radar-tokens.css:241`) | `7px` | Corner radius for mobile control. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1299`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1337` |
| `--sr-radius-action` (source `app/stock-radar-tokens.css:242`) | `8px` | Corner radius for action. | `components/dashboard-v2/StockRadarDashboardV2.module.css:179`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1260`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1767` |
| `--sr-radius-popover` (source `app/stock-radar-tokens.css:243`) | `12px` | Corner radius for popover. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1234` |
| `--sr-radius-sheet` (source `app/stock-radar-tokens.css:244`) | `22px` | Corner radius for sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1637`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1816` |
| `--sr-radius-pill` (source `app/stock-radar-tokens.css:245`) | `999px` | Corner radius for pill. | `components/dashboard-v2/StockRadarDashboardV2.module.css:36`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:109`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:244`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:944` |
| `--sr-shadow-header` (source `app/stock-radar-tokens.css:246`) | `0 1px 0 rgba(255, 255, 255, 0.03)` | Elevation/effect shadow for header. | `components/dashboard-v2/StockRadarDashboardV2.module.css:62` |
| `--sr-shadow-delay-dot` (source `app/stock-radar-tokens.css:247`) | `0 0 13px rgba(255, 122, 26, 0.65)` | Elevation/effect shadow for delay dot. | `components/dashboard-v2/StockRadarDashboardV2.module.css:111` |
| `--sr-shadow-panel` (source `app/stock-radar-tokens.css:248`) | `0 18px 52px rgba(0, 0, 0, 0.24)` | Elevation/effect shadow for panel. | `components/dashboard-v2/StockRadarDashboardV2.module.css:371` |
| `--sr-shadow-pagination-active` (source `app/stock-radar-tokens.css:249`) | `0 0 20px rgba(255, 122, 26, 0.34)` | Elevation/effect shadow for pagination active. | `components/dashboard-v2/StockRadarDashboardV2.module.css:666` |
| `--sr-shadow-menu` (source `app/stock-radar-tokens.css:250`) | `0 16px 36px rgba(0, 0, 0, 0.38)` | Elevation/effect shadow for menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1239` |
| `--sr-shadow-navigation-menu` (source `app/stock-radar-tokens.css:251`) | `0 16px 34px rgba(0, 0, 0, 0.42)` | Elevation/effect shadow for navigation menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:182` |
| `--sr-shadow-filter-sheet` (source `app/stock-radar-tokens.css:252`) | `0 -22px 48px rgba(0, 0, 0, 0.44)` | Elevation/effect shadow for filter sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1641` |
| `--sr-shadow-ticker-sheet` (source `app/stock-radar-tokens.css:253`) | `0 -28px 70px rgba(0, 0, 0, 0.56)` | Elevation/effect shadow for ticker sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1820` |
| `--sr-shadow-cta` (source `app/stock-radar-tokens.css:254`) | `inset 0 0 0 1px rgba(255, 122, 26, 0.18), 0 0 22px rgba(255, 122, 26, 0.08)` | Elevation/effect shadow for cta. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1024` |
| `--sr-focus-ring-width` (source `app/stock-radar-tokens.css:255`) | `2px` | Keyboard focus ring width. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1245`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1687`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1862` |
| `--sr-focus-ring-color` (source `app/stock-radar-tokens.css:256`) | `rgba(255, 122, 26, 0.65)` | Keyboard focus ring color. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1245`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1687`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1862` |
| `--sr-focus-ring-offset` (source `app/stock-radar-tokens.css:257`) | `2px` | Keyboard focus ring offset. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1246`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1688`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1863` |

### Layers and motion

| Token | Value | Meaning | Current use |
| --- | --- | --- | --- |
| `--sr-z-timeline-marker` (source `app/stock-radar-tokens.css:260`) | `1` | Layer order for timeline marker. | `components/dashboard-v2/StockRadarDashboardV2.module.css:940` |
| `--sr-z-sticky-action` (source `app/stock-radar-tokens.css:261`) | `2` | Layer order for sticky action. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1968` |
| `--sr-z-sheet-handle` (source `app/stock-radar-tokens.css:262`) | `6` | Layer order for sheet handle. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1647`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1827` |
| `--sr-z-sheet-close` (source `app/stock-radar-tokens.css:263`) | `7` | Layer order for sheet close. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1659`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1839` |
| `--sr-z-ticker-sheet` (source `app/stock-radar-tokens.css:264`) | `80` | Layer order for ticker sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1788` |
| `--sr-z-mobile-menu` (source `app/stock-radar-tokens.css:265`) | `86` | Layer order for mobile menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1227` |
| `--sr-z-filter-sheet` (source `app/stock-radar-tokens.css:266`) | `90` | Layer order for filter sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1608` |
| `--sr-z-navigation-menu` (source `app/stock-radar-tokens.css:267`) | `95` | Layer order for navigation menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:173` |
| `--sr-motion-duration-menu` (source `app/stock-radar-tokens.css:268`) | `130ms` | Motion duration for menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1240` |
| `--sr-motion-duration-sheet` (source `app/stock-radar-tokens.css:269`) | `170ms` | Motion duration for sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1642`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1821` |
| `--sr-motion-duration-reduced` (source `app/stock-radar-tokens.css:270`) | `1ms` | Motion duration for reduced. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-motion-distance-menu` (source `app/stock-radar-tokens.css:271`) | `4px` | Motion travel distance for menu. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1060` |
| `--sr-motion-distance-sheet` (source `app/stock-radar-tokens.css:272`) | `24px` | Motion travel distance for sheet. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1036` |
| `--sr-motion-distance-drawer` (source `app/stock-radar-tokens.css:273`) | `28px` | Motion travel distance for drawer. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1048` |
| `--sr-motion-distance-reduced` (source `app/stock-radar-tokens.css:274`) | `0px` | Motion travel distance for reduced. | Reserved foundation role; see Migration Result for its phase 3 contract. |
| `--sr-motion-easing-standard` (source `app/stock-radar-tokens.css:275`) | `ease-out` | Motion easing for standard. | `components/dashboard-v2/StockRadarDashboardV2.module.css:1240`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1642`<br>`components/dashboard-v2/StockRadarDashboardV2.module.css:1821` |
## 4. Semantic Color Rules

- Use `--sr-color-page-*` only for the app canvas and page-level glow.
- Use `--sr-color-surface-*` for panels, controls, tables, overlays, and elevated actions. Select the token matching the UI role even when another surface currently has the same literal value.
- Use `--sr-color-text-*` by information hierarchy. Do not substitute muted or metadata text based only on visual similarity.
- Use `--sr-color-accent` for the canonical orange emphasis. Alpha variants encode selected, active, hover, focus, menu, CTA, and overlay roles.
- Use `--sr-color-positive`, `--sr-color-negative`, `--sr-color-warning`, and `--sr-color-info` for market/status semantics.
- Use `--sr-color-event-*` for event badges and timeline markers. Legal, earnings, insider, transaction, product, and neutral roles are intentionally separate.
- Use `--sr-color-chart-*` inside chart rendering. Chart candle colors are not aliases for market text colors; the current baseline uses different greens and reds.
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
- One-off menu, pagination, and detail measurements that have no demonstrated cross-page role remain local until phase 3 establishes a shared component contract.
- Existing global button styles from `app/globals.css`: phase 2 does not alter cascade ownership or specificity.
- Known baseline issues, including 1440 px desktop table overflow and the mobile sticky CTA overlap risk, were not fixed.

## 9. Migration Result

The dashboard CSS no longer contains literal hex, RGB, or RGBA colors. The migration replaced 177 color occurrences, all 47 font-size declarations, all 29 font-weight declarations, all 27 explicit line-height declarations, and the repeated radius, shadow, border, spacing, layer, and motion values covered by the semantic contracts above.

The former 18 local `--dash-v2-*` variables were removed. Dashboard-v2 now references 243 unique Stock Radar tokens across 632 `var(--sr-*)` usages.

The final quality pass removed nine tokens that lacked an independent reusable role: `surface-high`, `text-faint`, `text-neutral-badge`, `accent-outline`, `accent-focus`, `accent-pagination-glow`, the unused `2xs` font size, zero spacing, and the unused 30 px spacing step. Legal and neutral event colors now use their event-semantic tokens directly. The old `legacy-menu` token names were renamed to reusable `navigation-menu` roles without changing values.

Eight foundation tokens are intentionally defined but not rendered by dashboard-v2:

- `--sr-color-surface-elevated`: phase 3 elevated panel and popover surface contract.
- `--sr-color-text-muted`: phase 3 shared helper and metadata text hierarchy.
- `--sr-color-info`: non-event informational status; kept distinct from transaction-event blue.
- `--sr-color-state-disabled-text`, `--sr-color-state-disabled-surface`, and `--sr-opacity-disabled`: phase 3 disabled variants for shared controls.
- `--sr-motion-duration-reduced` and `--sr-motion-distance-reduced`: phase 3 reduced-motion variants for shared menu and sheet shells.

## 10. Unresolved Items

- Inter remains declaration-only. Actual glyph rendering depends on the client machine's installed fonts.
- There is no light theme, theme switching contract, or alternate market palette.
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
