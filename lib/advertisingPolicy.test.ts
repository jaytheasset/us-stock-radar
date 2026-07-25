import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  areAdsEnabledForPlan,
  shouldShowAnalysisCollapsedRailInlineAd,
  shouldShowAnalysisSignalCompanionAd,
} from "./advertisingPolicy.ts";
import type { Plan } from "./subscriptionPolicy.ts";

test("free viewers see a companion ad for a bullish-only analysis", () => {
  assert.equal(
    shouldShowAnalysisSignalCompanionAd({
      adsAllowed: areAdsEnabledForPlan("free"),
      bearishCount: 0,
      bullishCount: 2,
    }),
    true,
  );
});

test("free viewers see a companion ad for a bearish-only analysis", () => {
  assert.equal(
    shouldShowAnalysisSignalCompanionAd({
      adsAllowed: areAdsEnabledForPlan("free"),
      bearishCount: 3,
      bullishCount: 0,
    }),
    true,
  );
});

test("free viewers do not see a companion ad for both or neither signal card", () => {
  assert.equal(
    shouldShowAnalysisSignalCompanionAd({
      adsAllowed: true,
      bearishCount: 1,
      bullishCount: 1,
    }),
    false,
  );
  assert.equal(
    shouldShowAnalysisSignalCompanionAd({
      adsAllowed: true,
      bearishCount: 0,
      bullishCount: 0,
    }),
    false,
  );
});

test("all ad-free and paid plans disable advertising", () => {
  const plans: Plan[] = ["ad_free", "pro", "advanced", "ultimate"];

  for (const plan of plans) {
    assert.equal(areAdsEnabledForPlan(plan), false, plan);
    assert.equal(
      shouldShowAnalysisCollapsedRailInlineAd({
        adsAllowed: areAdsEnabledForPlan(plan),
        hasRelatedContent: false,
        scoreRationaleVisible: true,
      }),
      false,
      plan,
    );
    assert.equal(
      shouldShowAnalysisSignalCompanionAd({
        adsAllowed: areAdsEnabledForPlan(plan),
        bearishCount: 0,
        bullishCount: 1,
      }),
      false,
      plan,
    );
  }
});

test("free viewers see the collapsed rail fallback before a score rationale", () => {
  assert.equal(
    shouldShowAnalysisCollapsedRailInlineAd({
      adsAllowed: areAdsEnabledForPlan("free"),
      hasRelatedContent: false,
      scoreRationaleVisible: true,
    }),
    true,
  );
});

test("related content suppresses the collapsed rail fallback", () => {
  assert.equal(
    shouldShowAnalysisCollapsedRailInlineAd({
      adsAllowed: true,
      hasRelatedContent: true,
      scoreRationaleVisible: true,
    }),
    false,
  );
});

test("a missing score rationale suppresses the collapsed rail fallback", () => {
  assert.equal(
    shouldShowAnalysisCollapsedRailInlineAd({
      adsAllowed: true,
      hasRelatedContent: false,
      scoreRationaleVisible: false,
    }),
    false,
  );
});

test("news and filing detail routes wire the shared analysis ad contract", () => {
  const genericSource = read("../components/filing-analysis-v2/GenericFilingAnalysis.tsx");
  const genericStyles = read(
    "../components/filing-analysis-v2/GenericFilingAnalysis.module.css",
  );
  const newsAdapterSource = read("../components/news-analysis-v2/NewsAnalysisAdapter.tsx");
  const newsRouteSource = read("../app/events/[id]/page.tsx");
  const filingRouteSource = read("../app/filings/[id]/page.tsx");
  const rootLayoutSource = read("../app/layout.tsx");
  const newsListSource = read("../components/news-v2/NewsV2List.tsx");
  const newsRailSource = read("../components/news-v2/NewsV2InsightRail.tsx");
  const filingsListSource = read("../components/filings-v2/FilingsV2List.tsx");
  const filingsRailSource = read("../components/filings-v2/StockRadarFilingsV2.tsx");
  const filingsDetailSource = read("../components/filings-v2/FilingsV2Detail.tsx");
  const companionSource = read(
    "../components/filing-analysis-v2/AnalysisSignalCompanionAd.tsx",
  );
  const collapsedRailSource = read(
    "../components/filing-analysis-v2/AnalysisCollapsedRailInlineAd.tsx",
  );
  const sharedSlotSource = read("../components/ads/AdSenseSlot.tsx");
  const sharedSlotStyles = read("../components/ads/AdSenseSlot.module.css");
  const existingAnalysisAdSources = [
    read("../components/filing-analysis-v2/FilingInlineAdSlot.tsx"),
    read("../components/filing-analysis-v2/FilingRailAdSlot.tsx"),
  ];

  assert.match(genericSource, /allowAds: boolean/);
  assert.match(genericSource, /shouldShowAnalysisSignalCompanionAd/);
  assert.match(genericSource, /<AnalysisSignalCompanionAd \/>/);
  assert.match(genericSource, /shouldShowAnalysisCollapsedRailInlineAd/);
  assert.match(
    genericSource,
    /showCollapsedRailInlineAd[\s\S]*<AnalysisCollapsedRailInlineAd \/>[\s\S]*scoreRationaleProps[\s\S]*<ScoreRationale/,
  );
  assert.match(genericSource, /allowAds \? <FilingInlineAdSlot \/> : null/);
  assert.match(genericSource, /allowAds \? <FilingRailAdSlot format="rectangle" \/> : null/);
  assert.match(genericSource, /allowAds \? <FilingRailAdSlot format="skyscraper" \/> : null/);
  assert.match(newsAdapterSource, /allowAds: boolean/);
  assert.match(newsAdapterSource, /allowAds=\{allowAds\}/);
  assert.match(newsRouteSource, /<NewsAnalysisAdapter[\s\S]*allowAds=\{allowAds\}/);
  assert.match(filingRouteSource, /<GenericFilingAnalysis[\s\S]*allowAds=\{allowAds\}/);
  assert.match(rootLayoutSource, /<AdSensePublisherLoader enabledForViewer \/>/);
  assert.doesNotMatch(rootLayoutSource, /getCurrentViewerPlan|areAdsEnabledForPlan/);
  assert.match(rootLayoutSource, /viewer-aware boundary before enabling it/i);
  assert.match(newsListSource, /viewerPlan === "free" &&[\s\S]*shouldInsertDesktopInlineAd/);
  assert.match(newsRailSource, /viewerPlan === "free" \? <NewsV2InsightInlineAd \/> : null/);
  assert.match(filingsListSource, /viewerPlan === "free" && showInlineAd/);
  assert.match(filingsRailSource, /viewerPlan === "free" \?/);
  assert.match(filingsRailSource, /showAds=\{viewerPlan === "free"\}/);
  assert.match(filingsDetailSource, /showAds \? \([\s\S]*<FilingsRailAdSlot/);
  assert.match(companionSource, /inventory="analysis-signal-companion"/);
  assert.match(
    collapsedRailSource,
    /inventory="analysis-collapsed-rail-inline"/,
  );
  assert.match(collapsedRailSource, /mediaQuery="\(max-width: 1180px\)"/);
  assert.match(collapsedRailSource, /height=\{90\}/);
  assert.match(collapsedRailSource, /width=\{970\}/);
  assert.match(collapsedRailSource, /mobileHeight=\{100\}/);
  assert.match(collapsedRailSource, /mobileWidth=\{480\}/);
  assert.match(
    genericStyles,
    /\.scoreRationaleRailFallback\s*\{\s*display:\s*none;[\s\S]*@media \(max-width: 1180px\)[\s\S]*\.scoreRationaleRailFallback\s*\{\s*display:\s*block;/,
  );
  assert.match(sharedSlotSource, /data-mobile-size=\{hasMobileSize \? "true" : undefined\}/);
  assert.match(
    sharedSlotStyles,
    /@media \(max-width: 760px\)[\s\S]*\.slot\[data-mobile-size="true"\][\s\S]*--adsense-slot-mobile-height/,
  );
  assert.match(newsAdapterSource, /<GenericFilingAnalysis/);
  assert.match(filingRouteSource, /<GenericFilingAnalysis/);
  assert.ok(
    existingAnalysisAdSources.every(
      (source) =>
        !source.includes("analysis-signal-companion") &&
        !source.includes("analysis-collapsed-rail-inline"),
    ),
  );
});

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
