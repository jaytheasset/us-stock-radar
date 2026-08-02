import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveFilingsV2LoadState } from "../../lib/filingsV2LoadState.ts";
import { resolveFilingsV2SelectedRecord } from "./filingsV2Selection.ts";

test("does not keep a stale filing selection when filtered results are empty", () => {
  const records = [{ id: "visible" }];

  assert.equal(resolveFilingsV2SelectedRecord(records, "stale")?.id, "visible");
  assert.equal(resolveFilingsV2SelectedRecord([], "stale"), undefined);
});

test("distinguishes complete, partial, and unavailable filing loads", () => {
  assert.equal(resolveFilingsV2LoadState(3, 3), "ready");
  assert.equal(resolveFilingsV2LoadState(2, 3), "partial");
  assert.equal(resolveFilingsV2LoadState(0, 3), "unavailable");
});

test("filing detail embeds stored SEC source in the sandbox and resolves related filings broadly", () => {
  const source = readFileSync(
    new URL("../../app/filings/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /readStoredFilingSourceContent/);
  assert.match(source, /<SecFilingHtmlViewer/);
  assert.match(source, /fetchEventTickers\(item\.id\)/);
  assert.match(source, /symbol: `eq\.\$\{ticker\}`/);
  assert.match(source, /selectRelatedFilingRows/);
  assert.match(source, /source_group: "eq\.filings"/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{ __html: embeddedHtml \}\}/);
});

test("news and filing analysis share one source-verification disclosure", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const filingSource = readFileSync(
    new URL("../../app/filings/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(filingSource, /<GenericFilingAnalysis/);
  assert.equal(
    analysisSource.match(/AI-assisted analysis\. Verify material facts against the original source\. Scores, labels, and directional signals are not investment recommendations\./g)?.length,
    1,
  );
  assert.equal(analysisSource.match(/\{AI_ANALYSIS_DISCLOSURE\}/g)?.length, 1);
});

test("filings preview rail keeps intrinsic ad widths constrained after route transitions", () => {
  const adStyles = readFileSync(
    new URL("./FilingsRailAdSlot.module.css", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(adStyles, /\.slot\.mobileSlot\s*\{[\s\S]*display:\s*none;/);
  assert.match(
    adStyles,
    /@media \(max-width: 1180px\)\s*\{[\s\S]*\.slot\.desktopSlot\s*\{[\s\S]*display:\s*none;/,
  );
  assert.match(
    styles,
    /\.detailContent\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(styles, /\.detailPreviewCard\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(
    styles,
    /\.detailAdArea\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/,
  );
});

test("filings preview uses shared Saved and Watchlist actions with batched viewer state", () => {
  const detailSource = readFileSync(
    new URL("./FilingsV2Detail.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = readFileSync(
    new URL("../../app/filings/page.tsx", import.meta.url),
    "utf8",
  );
  const clientSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );

  assert.match(detailSource, /<WatchlistButton/);
  assert.match(detailSource, /record\.ticker \? \(/);
  assert.match(detailSource, /ticker=\{record\.ticker\}/);
  assert.match(detailSource, /<SavedContentButton/);
  assert.match(detailSource, /contentId=\{record\.id\}/);
  assert.match(detailSource, /contentType="filing"/);
  assert.match(pageSource, /getViewerContentState/);
  assert.match(clientSource, /savedContentBatchSize = 100/);
  assert.match(clientSource, /\/api\/saved\?\$\{search\.toString\(\)\}/);
  assert.match(clientSource, /fetch\("\/api\/watchlist"/);
});

test("filings mobile landing keeps one accessible preferred-source link and a flat full-width list", () => {
  const filterSource = readFileSync(
    new URL("./FilingsV2FilterBar.tsx", import.meta.url),
    "utf8",
  );
  const listSource = readFileSync(
    new URL("./FilingsV2List.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(filterSource, /import \{ ChevronDown, Search, SlidersHorizontal, X \} from "lucide-react";/);
  assert.match(
    filterSource,
    /preferredSourceUrl\?: string \| null;[\s\S]*<button aria-label="Search" className=\{styles\.searchButton\} type="submit">[\s\S]*<Search aria-hidden="true" className=\{styles\.searchButtonIcon\}/,
  );
  assert.match(
    filterSource,
    /className=\{styles\.mobilePreferredSourceLink\}[\s\S]*<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header[\s\S]*href=\{preferredSourceUrl\}/,
  );
  assert.match(
    listSource,
    /<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header[\s\S]*href=\{preferredSourceUrl\}/,
  );
  assert.match(pageSource, /<FilingsV2FilterBar[\s\S]*preferredSourceUrl=\{preferredSourceUrl\}/);
  assert.doesNotMatch(filterSource, /ariaLabel="Add Stock Radar on Google Google"/);
  assert.doesNotMatch(listSource, /ariaLabel="Add Stock Radar on Google Google"/);

  assert.match(styles, /\.mobilePreferredSourceLink \{[\s\S]*display: none;/);
  assert.match(styles, /\.searchButtonIcon \{[\s\S]*display: none;/);
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.filterUtilityRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;[\s\S]*\.searchForm \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px;[\s\S]*\.searchControl > label > span:first-child \{[\s\S]*display: none;[\s\S]*\.searchForm > \.searchButton \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*\.searchButtonIcon \{[\s\S]*display: block;/,
  );
  assert.match(
    styles,
    /\.mobileFilterActions \.mobileFilterTrigger \{[\s\S]*min-height: 44px;[\s\S]*border-color: var\(--sr-color-border-control\);[\s\S]*\.mobilePreferredSourceLink \{[\s\S]*display: flex;[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*height: 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*\.mobilePreferredSourceLink > a > span::after \{[\s\S]*content: "Google";/,
  );
  assert.match(
    styles,
    /\.listPanel \{[\s\S]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[\s\S]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styles,
    /\.listHeader \{[\s\S]*min-height: 52px;[\s\S]*flex-wrap: nowrap;[\s\S]*border-bottom-color: var\(--sr-color-border\);[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*\.listHeaderTitle \{[\s\S]*width: auto;[\s\S]*flex: 1 1 auto;[\s\S]*\.listHeaderTitle > a \{[\s\S]*display: none;[\s\S]*\.listHeaderCount \{[\s\S]*width: auto;[\s\S]*flex: 0 0 auto;/,
  );
  assert.match(styles, /\.filingItemSlot::after \{[\s\S]*background: var\(--sr-color-border\);/);
  assert.match(styles, /\.listFooter \{[\s\S]*background: transparent;/);
  assert.match(
    styles,
    /@media \(max-width: 340px\) \{[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*width: 44px;[\s\S]*padding: 0;[\s\S]*\.mobilePreferredSourceLink > a > span \{[\s\S]*clip-path: inset\(50%\);/,
  );

  assert.match(styles, /\.searchForm \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) max-content;/);
  assert.match(
    styles,
    /\.listPanel \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
});

test("filing feed rows use watchlist density and plain representative event metadata", () => {
  const listSource = readFileSync(
    new URL("./FilingsV2List.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(listSource, /const visibleEvents = record\.events\.slice\(0, 1\);/);
  assert.match(listSource, /className=\{styles\.filingEventMeta\}/);
  assert.match(listSource, /data-ticker-available=\{record\.ticker \? "true" : "false"\}/);
  assert.match(listSource, /className=\{styles\.mobileIdentityTicker\}/);
  assert.match(listSource, /record\.ticker \? \([\s\S]*styles\.mobileIdentityTicker/);
  assert.doesNotMatch(listSource, /record\.ticker \?\? record\.formType/);
  assert.match(listSource, /className=\{styles\.mobileFilingClassification\}/);
  assert.match(listSource, /className=\{styles\.mobileFilingFooter\}/);
  assert.match(
    styles,
    /\.root \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 380px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.detailIdentity \{[\s\S]*?padding-right: calc\(var\(--sr-size-close-button\) \* 3 \+ var\(--sr-space-3\)\);/,
  );
  assert.match(
    styles,
    /\.filingItem \{[\s\S]*min-height: 82px;[\s\S]*gap: var\(--sr-space-3\);[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-4\);/,
  );
  assert.match(
    styles,
    /\.filingTitle \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-semibold\);/,
  );
  assert.match(
    styles,
    /\.identity strong \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styles,
    /\.filingImpact \.impactScore \{[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingTitle \{[\s\S]*?font-size: var\(--sr-font-size-sm\);[\s\S]*?font-weight: 600;[\s\S]*?line-height: var\(--sr-line-height-snug\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingItemTime \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?line-height: var\(--sr-line-height-default\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.formLabel,[\s\S]*?\.eventBadges \.filingEventMeta \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingImpact \.signal \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: var\(--sr-font-weight-regular\);[\s\S]*?\.filingImpact \.impactScore \{[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    styles,
    /\.formLabel \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*padding: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styles,
    /\.eventBadges \.filingEventMeta \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*padding: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styles,
    /\.filingItem\.selectedFilingItem::before \{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*width: 3px;[\s\S]*border-radius: 0;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1440px\) and \(min-width: 761px\) \{[\s\S]*?\.filingSparkline \{[\s\S]*?display: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingItem \{[\s\S]*?min-height: 96px;[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) 58px;[\s\S]*?grid-template-rows: auto auto auto;[\s\S]*?gap: var\(--sr-space-1-5\);[\s\S]*?padding: var\(--sr-space-3\);/,
  );
  assert.match(
    styles,
    /\.filingItem\[data-ticker-available="false"\] \.mobileFilingClassification \{[\s\S]*grid-column: 1 \/ 3;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingTitle \{[\s\S]*?grid-column: 1 \/ 3;[\s\S]*?grid-row: 2;[\s\S]*?font-size: var\(--sr-font-size-base\);[\s\S]*?font-weight: 600;[\s\S]*?line-height: 1\.35;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingPrice \{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 2 \/ 4;[\s\S]*?flex-direction: column;[\s\S]*?align-items: flex-end;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingPriceUnavailable \{[\s\S]*?display: none;/,
  );
});
