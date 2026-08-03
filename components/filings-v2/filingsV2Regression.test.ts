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

test("shared news and filing analysis use the readable mobile typography scale", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const analysisStyles = readFileSync(
    new URL(
      "../filing-analysis-v2/GenericFilingAnalysis.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const scoreStyles = readFileSync(
    new URL("../filing-analysis-v2/ScoreRationale.module.css", import.meta.url),
    "utf8",
  );
  const scoreSource = readFileSync(
    new URL("../filing-analysis-v2/ScoreRationale.tsx", import.meta.url),
    "utf8",
  );
  const googleStyles = readFileSync(
    new URL("../ui/GooglePreferredSourceLink.module.css", import.meta.url),
    "utf8",
  );
  const liveRoomSource = readFileSync(
    new URL("../live-room/LiveRoomEntryButton.tsx", import.meta.url),
    "utf8",
  );
  const mobileAnalysisStyles = analysisStyles.slice(
    analysisStyles.indexOf("@media (max-width: 760px)"),
  );
  const mobileScoreStyles = scoreStyles.slice(
    scoreStyles.indexOf("@media (max-width: 760px)"),
  );
  const mobileGoogleStyles = googleStyles.slice(
    googleStyles.indexOf("@media (max-width: 760px)"),
  );

  assert.match(mobileAnalysisStyles, /\.hero h1 \{[^}]*font-size: var\(--sr-font-size-heading-sm\);/);
  assert.match(mobileAnalysisStyles, /\.heroTimestamp \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.companyLine \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.tickerLine strong \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(mobileAnalysisStyles, /\.classification > span \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.impactScore strong \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.sectionLabel \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.card p \{[^}]*font-size: var\(--sr-font-size-lg-plus\);/);
  assert.match(mobileAnalysisStyles, /\.analysisDisclosure \{[^}]*font-size: var\(--sr-font-size-sm\);/);
  assert.match(mobileAnalysisStyles, /\.analysisLiveRoomButton \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.price-card-mobile-collapsible \.detail-price\)[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(mobileAnalysisStyles, /\.price-card-mobile-collapsible \.detail-change\)[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.price-chart-mobile-toggle\)[^}]*font-size: var\(--sr-font-size-base\);/);

  assert.match(mobileScoreStyles, /\.scoreBlock > span \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileScoreStyles, /\.scoreBlock \{[^}]*display: contents;/);
  assert.match(mobileScoreStyles, /\.scoreBlock > span \{[^}]*grid-column: 1;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.scoreBlock > strong \{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.signal \{[^}]*grid-column: 3;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.headingRow h2 \{[^}]*font-size: var\(--sr-font-size-xl\);/);
  assert.match(mobileScoreStyles, /\.headingRow h2 \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;[^}]*border-top: var\(--sr-border-width\) solid var\(--sr-color-divider\);/);
  assert.match(mobileScoreStyles, /\.copy p \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/);
  assert.match(mobileScoreStyles, /\.signal \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileScoreStyles, /\.signal\[data-score-tone="default"\],[\s\S]*\.signal\[data-score-tone="neutral"\] \{[^}]*color: var\(--sr-color-text-muted\);/);
  assert.match(mobileScoreStyles, /:global\(\[data-sr-theme="light"\]\) \.signal\[data-score-tone="default"\],[\s\S]*:global\(\[data-sr-theme="light"\]\) \.signal\[data-score-tone="neutral"\] \{[^}]*color: var\(--sr-color-text-muted\);/);
  assert.match(mobileScoreStyles, /\.copy p \{[^}]*font-size: var\(--sr-font-size-lg-plus\);/);
  assert.match(scoreStyles, /\.scoreBlock > strong \{[^}]*font-size: var\(--sr-font-size-heading-lg\);/);
  assert.match(scoreSource, /const scoreTone = getDirectionalScoreTone\(score, signal\);/);
  assert.match(scoreSource, /<strong data-score-tone=\{scoreTone\}>\{score\}<\/strong>/);
  assert.match(scoreSource, /<h2>Score Rationale<\/h2>[\s\S]*data-score-tone=\{scoreTone\}[\s\S]*\{signal\}/);
  assert.equal(scoreSource.match(/\{signal\}/g)?.length, 1);
  assert.match(mobileGoogleStyles, /\.summary \{[^}]*font-size: var\(--sr-font-size-md\);/);

  assert.match(analysisSource, /className=\{styles\.analysisLiveRoomButton\}[\s\S]*label="Discuss in Live Room"/);
  assert.match(liveRoomSource, /className\?: string;/);
  assert.match(liveRoomSource, /className=\{\[styles\.button, className\]\.filter\(Boolean\)\.join\(" "\)\}/);
});

test("filing analysis inherits the final news-document mobile gutter and type hierarchy", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.module.css", import.meta.url),
    "utf8",
  );
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 760px)"));

  assert.match(analysisSource, /styles\.filingDocument/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.workspace \{[\s\S]*padding-right: var\(--sr-space-2\);[\s\S]*padding-left: var\(--sr-space-2\);/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument :is\(\.hero, \.card, \.railCard, \.rendererCard\) \{[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;[\s\S]*max-width: 100%;/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument \.summaryHeader \{[\s\S]*flex-direction: row;[\s\S]*align-items: center;/,
  );
  assert.match(
    mobileStyles,
    /@media \(max-width: 360px\) \{[\s\S]*\.filingDocument \.summaryHeader > :last-child > svg:last-child \{[^}]*display: none;/,
  );
  assert.doesNotMatch(
    mobileStyles,
    /\.filingDocument \.summaryHeader > :last-child > svg \{[^}]*display: none;/,
  );
  assert.match(mobileStyles, /\.filingDocument \.hero h1 \{[^}]*font-size: var\(--sr-font-size-heading-md\);/);
  assert.match(mobileStyles, /\.filingDocument \.heroTimestamp \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileStyles, /\.filingDocument \.companyLine \{[^}]*font-size: 16px;/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.sectionLabel,[\s\S]*\.filingDocument \.specializedBody :is\(h2, h3\) \{[\s\S]*font-size: var\(--sr-font-size-2xl\);/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument \.card p,[\s\S]*\.filingDocument \.specializedBody :is\(p, li, dd, td\) \{[\s\S]*font-size: 16px;[\s\S]*line-height: 1\.6;/,
  );
  assert.match(mobileStyles, /\.filingDocument \.specializedBody \[class\*="label" i\] \{[\s\S]*font-size: max\(13px, 1em\);/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.rendererCard :global\(\.context-mover-copy strong\) \{[\s\S]*font-size: 16px;/,
  );
});

test("specialized filing cards define their own readable mobile typography", () => {
  const readMobileStyles = (name: string, breakpoint: number) => {
    const styles = readFileSync(
      new URL(`../filing-analysis-v2/${name}.module.css`, import.meta.url),
      "utf8",
    );
    const marker = `@media (max-width: ${breakpoint}px)`;
    const mobileStyles = styles.slice(styles.indexOf(marker));

    assert.ok(mobileStyles.startsWith(marker), `${name} must define mobile styles`);
    return mobileStyles;
  };

  const snapshotStyles = readMobileStyles("ListingFinancialRiskSnapshot", 760);
  const operatingStyles = readMobileStyles("OperatingLegalRoutine", 700);
  const financingStyles = readMobileStyles("FinancingDilutionCapitalStructure", 760);
  const remainingStyles = [
    readMobileStyles("GovernanceEventDetails", 640),
    readMobileStyles("OwnershipDetails", 760),
    readMobileStyles("PeriodicReports", 700),
    readMobileStyles("ProxyVoteDetails", 640),
    readMobileStyles("S8Details", 700),
    readMobileStyles("TenderOfferDetails", 640),
  ];

  assert.match(snapshotStyles, /\.snapshot h2 \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(snapshotStyles, /\.item dt \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(snapshotStyles, /\.item strong \{[^}]*font-size: 16px;/);
  assert.match(snapshotStyles, /\.item span \{[^}]*font-size: var\(--sr-font-size-base\);/);

  assert.match(operatingStyles, /\.panelHeading h2,[\s\S]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(operatingStyles, /\.updateHeading strong,[\s\S]*font-size: 16px;/);
  assert.match(operatingStyles, /\.updateList p,[\s\S]*font-size: 16px;[\s\S]*line-height: 1\.6;/);

  assert.match(financingStyles, /\.sectionHeading h2 \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(financingStyles, /\.headline span,[\s\S]*font-size: var\(--sr-font-size-base\);/);
  assert.match(financingStyles, /\.legendCopy > strong,[\s\S]*font-size: 16px;/);
  assert.match(financingStyles, /\.legendValue i \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(financingStyles, /\.detailRows strong,[\s\S]*font-size: 16px;/);

  for (const styles of remainingStyles) {
    assert.match(styles, /font-size: var\(--sr-font-size-2xl\);/);
    assert.match(styles, /font-size: var\(--sr-font-size-base\);/);
    assert.match(styles, /font-size: 16px;/);
  }
});

test("legacy filing chart mobile display override follows the desktop hidden rule", () => {
  const globals = readFileSync(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );
  const desktopHiddenRule =
    /\.filing-detail-page \.price-chart-mobile-toggle\s*\{\s*display:\s*none;/g;
  const mobileVisibleRule =
    /\.filing-detail-page \.price-chart-mobile-toggle\s*\{\s*display:\s*inline-flex;/g;
  const desktopHiddenMatches = [...globals.matchAll(desktopHiddenRule)];
  const mobileVisibleMatches = [...globals.matchAll(mobileVisibleRule)];
  const desktopRuleIndex = desktopHiddenMatches[0]?.index ?? -1;
  const mobileRuleIndex = mobileVisibleMatches[0]?.index ?? -1;

  assert.equal(
    desktopHiddenMatches.length,
    1,
    "desktop chart toggle must have exactly one default hidden rule",
  );
  assert.equal(
    mobileVisibleMatches.length,
    1,
    "mobile chart toggle must have exactly one visible override",
  );
  assert.ok(
    mobileRuleIndex > desktopRuleIndex,
    "the equal-specificity mobile display override must follow the desktop rule",
  );
  assert.equal(
    desktopHiddenMatches.some(
      (match) => (match.index ?? -1) > mobileRuleIndex,
    ),
    false,
    "no later desktop hidden rule may override the mobile chart toggle",
  );
  assert.match(
    globals.slice(desktopRuleIndex, mobileRuleIndex),
    /@media \(max-width: 760px\)/,
  );
  assert.match(
    globals.slice(mobileRuleIndex),
    /data-mobile-chart-expanded="false"[\s\S]*:is\(\.price-range-control, \.price-chart-details\) \{[\s\S]*display: none;/,
  );
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
    /@media \(max-width: 760px\) \{[\s\S]*\.filterUtilityRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;[\s\S]*\.searchForm \{[\s\S]*height: 44px;[\s\S]*min-height: 44px;[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: var\(--sr-radius-action\);[\s\S]*background: var\(--sr-color-surface-control\);[\s\S]*\.searchForm:focus-within \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*box-shadow: 0 0 0 2px var\(--sr-color-accent-active-soft\);/,
  );
  assert.match(
    styles,
    /\.searchControl > label \{[\s\S]*height: 42px;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchControl > label:focus-within \{[\s\S]*border: 0;[\s\S]*box-shadow: none;[\s\S]*\.searchControl > label > span:first-child \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.searchControl > label input \{[\s\S]*font-size: 16px;[\s\S]*\.searchControl > label input::placeholder \{[\s\S]*color: transparent;[\s\S]*\.searchControl::after \{[\s\S]*content: "Search filings";[\s\S]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styles,
    /\.searchForm > \.searchButton \{[\s\S]*width: 44px;[\s\S]*height: 42px;[\s\S]*min-height: 42px;[\s\S]*border: 0;[\s\S]*border-left: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchForm > \.searchButton:focus-visible \{[\s\S]*outline: 0;[\s\S]*\.searchButtonIcon \{[\s\S]*display: block;/,
  );
  assert.doesNotMatch(styles, /\.searchForm \{[^}]*overflow:\s*hidden;/);
  assert.match(
    styles,
    /\.mobileFilterActions \.mobileFilterTrigger \{[\s\S]*min-height: 44px;[\s\S]*border-color: var\(--sr-color-border-control\);[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobileFilterActions \.mobileFilterTrigger > span:first-child \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobilePreferredSourceLink \{[\s\S]*display: flex;[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*height: 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*\.mobilePreferredSourceLink > a > span::after \{[\s\S]*content: "Google";/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.primaryColumn \{[\s\S]*display: grid;[\s\S]*gap: var\(--sr-space-3\);[\s\S]*\.controlBand \{[\s\S]*padding: 0;[\s\S]*\.summaryStrip \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.mobileFilterSheetContent \{[\s\S]*padding: calc\(var\(--sr-space-8\) \* 2\) var\(--sr-space-4\) var\(--sr-space-6\);[\s\S]*\.mobileFilterSheetContent header p,[\s\S]*\.mobileFilterGroup h3 \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobileFilterGroup > div > button \{[\s\S]*min-height: 44px;[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-2-5\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*\.mobileFilterSheetActions > button \{[\s\S]*min-height: 44px;[\s\S]*padding: 0 var\(--sr-space-4\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: var\(--sr-font-weight-semibold\);[\s\S]*line-height: var\(--sr-line-height-none\);/,
  );
  assert.match(
    styles,
    /\.listPanel \{[\s\S]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[\s\S]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.listHeader \{[\s\S]*min-height: 40px;[\s\S]*gap: var\(--sr-space-2\);[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*background: var\(--sr-color-surface-control-strong\);[\s\S]*\.listHeaderTitle \{[\s\S]*width: auto;[\s\S]*flex: 1 1 auto;[\s\S]*\.listHeaderTitle > a \{[\s\S]*display: none;[\s\S]*\.listHeaderCount \{[\s\S]*width: auto;[\s\S]*flex: 0 0 auto;[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);/,
  );
  const mobileListHeader =
    [...styles.matchAll(/\.listHeader \{[^}]*\}/g)].at(-1)?.[0] ?? "";
  assert.doesNotMatch(mobileListHeader, /linear-gradient/);
  const desktopListHeader = styles.match(/^\.listHeader \{[^}]*\}/m)?.[0] ?? "";
  assert.match(
    desktopListHeader,
    /background: linear-gradient\([\s\S]*var\(--sr-color-surface-table-header-start\),[\s\S]*var\(--sr-color-surface-table-header-end\)/,
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
  const marketReactionSource = readFileSync(
    new URL("./FilingsV2MarketReaction.tsx", import.meta.url),
    "utf8",
  );
  const dataSource = readFileSync(
    new URL("../../lib/filingsV2Data.ts", import.meta.url),
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
  assert.ok(
    marketReactionSource.indexOf("{hasChange ? <span") <
      marketReactionSource.indexOf("{hasPrice ? <strong>"),
    "quote DOM should expose change before price for mobile reading order",
  );
  assert.match(
    styles,
    /\.filingPrice strong \{[\s\S]*?order: 1;[\s\S]*?\.filingPrice > span:not\(\.filingDataUnavailable\) \{[\s\S]*?order: 2;/,
  );
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
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingItem \{[\s\S]*?min-height: 132px;[\s\S]*?grid-template-columns: minmax\(40px, auto\) minmax\(0, 1fr\) auto;[\s\S]*?grid-template-rows: auto auto auto;[\s\S]*?column-gap: var\(--sr-space-2\);[\s\S]*?row-gap: 7px;[\s\S]*?padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*?background: var\(--sr-color-surface-table-row\);/,
  );
  assert.match(
    styles,
    /\.filingItem\[data-ticker-available="false"\] \.mobileFilingClassification \{[\s\S]*grid-column: 1 \/ 3;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingTitle \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?font-size: 18px;[\s\S]*?font-weight: 650;[\s\S]*?line-height: 1\.4;[\s\S]*?-webkit-line-clamp: 2;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingPrice \{[\s\S]*?min-width: max-content;[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 3;[\s\S]*?flex-direction: row;[\s\S]*?align-items: baseline;[\s\S]*?justify-self: end;[\s\S]*?gap: var\(--sr-space-1\);[\s\S]*?white-space: nowrap;/,
  );
  assert.match(dataSource, /readHydratedMarketQuoteMap\(quoteSymbols\)/);
  assert.match(
    styles,
    /\.listHeaderCount \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.listHeaderTitle h2 \{[\s\S]*font-size: var\(--sr-font-size-xl\);[\s\S]*font-weight: var\(--sr-font-weight-display\);[\s\S]*\.liveLabel \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*\.identity strong \{[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 800;[\s\S]*letter-spacing: 0\.02em;/,
  );
  assert.match(
    styles,
    /\.mobileFilingClassification \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.mobileFilingClassification \.formLabel,[\s\S]*\.mobileFilingClassification \.filingEventMeta,[\s\S]*\.mobileFilingClassification \.eventOverflow,[\s\S]*\.mobileFilingClassification \.metadataEmpty \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 650;[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.mobileFilingClassification \.filingEventMeta \{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*text-transform: none;/,
  );
  assert.match(
    styles,
    /\.mobileFilingFooter \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFiledAt \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFilingSource \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFilingSource::before \{[\s\S]*margin: 0 var\(--sr-space-1\);[\s\S]*content: "·";/,
  );
  assert.match(
    styles,
    /\.filingPrice strong \{[\s\S]*order: 2;[\s\S]*font-size: 15px;[\s\S]*font-weight: 600;[\s\S]*\.filingPrice > span:not\(\.filingDataUnavailable\) \{[\s\S]*order: 1;[\s\S]*font-size: 15px;[\s\S]*font-weight: 700;[\s\S]*\.filingImpact \.signal \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 700;[\s\S]*\.filingImpact \.impactScore \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 600;/,
  );
  assert.match(
    listSource,
    /className=\{styles\.mobileFiledAt\}[\s\S]*\{filingDateLabel\}\{" "\}\{record\.filedTime\}/,
  );
  assert.doesNotMatch(listSource, /mobileFiledDate|mobileFiledTime/);
  assert.doesNotMatch(styles, /\.mobileFiledDate::after/);
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.filingPriceUnavailable \{[\s\S]*?display: none;/,
  );
});

test("mobile filings premium CTA is a flat list row while desktop keeps its premium card", () => {
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );
  const mobileRule = [...styles.matchAll(/\.premiumCtaMobile\s*\{[^}]*\}/g)].at(-1)?.[0] ?? "";

  assert.match(
    mobileRule,
    /display: block;[\s\S]*min-width: 0;[\s\S]*min-height: 0;[\s\S]*margin: 0;[\s\S]*border: 0;[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: 0;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-table-row\);[\s\S]*box-shadow: none;/,
  );
  assert.doesNotMatch(mobileRule, /border-top|gradient|accent-border-premium/);
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaCopy \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*align-items: center;[\s\S]*column-gap: var\(--sr-space-3\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy > span \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy strong \{[\s\S]*font: 700 16px \/ 1\.25 var\(--sr-font-family-sans\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy p \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*line-height: 1\.4;/,
  );
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaLink \{[\s\S]*grid-row: 1 \/ 4;[\s\S]*min-height: 40px;[\s\S]*align-self: center;[\s\S]*padding: 0 var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-primary-action\);[\s\S]*font: 700 var\(--sr-font-size-base\) \/ var\(--sr-line-height-none\)[\s\S]*\.premiumCtaMobile \.premiumCtaLinkIcon,[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.premiumCta \{[\s\S]*min-height: 152px;[\s\S]*var\(--sr-color-accent-cta-top\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
});
