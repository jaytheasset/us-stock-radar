import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  adSenseInventories,
  resolveAdSenseConfig,
} from "../components/ads/adsenseConfig.ts";
import {
  ADSENSE_SCRIPT_ID,
  ADSENSE_SCRIPT_ORIGIN,
  loadAdSenseScript,
} from "../components/ads/adsenseScriptLoader.ts";

const scenarios = {
  A: resolveAdSenseConfig({ nodeEnv: "production" }),
  B: resolveAdSenseConfig({
    anchorEnabled: "true",
    nodeEnv: "production",
    publisherId: "ca-pub-test",
  }),
  C: resolveAdSenseConfig({
    anchorEnabled: "false",
    nodeEnv: "production",
    publisherId: "ca-pub-test",
    slotIds: {
      "news-rail-300x250": "manual-slot",
    },
  }),
  D: resolveAdSenseConfig({
    anchorEnabled: "true",
    nodeEnv: "production",
    publisherId: "ca-pub-test",
    slotIds: {
      "news-rail-300x250": "manual-slot",
    },
  }),
  E: resolveAdSenseConfig({
    anchorEnabled: "false",
    nodeEnv: "production",
    publisherId: "ca-pub-test",
    slotIds: {
      "analysis-signal-companion": "analysis-companion-slot",
    },
  }),
  F: resolveAdSenseConfig({
    anchorEnabled: "false",
    nodeEnv: "production",
    publisherId: "ca-pub-test",
    slotIds: {
      "analysis-collapsed-rail-inline": "analysis-collapsed-rail-slot",
    },
  }),
};

assert.equal(scenarios.A.publisherScriptEnabled, false);
assert.equal(scenarios.A.anchorEnabled, false);
assert.ok(Object.values(scenarios.A.manualSlotEnabled).every((enabled) => !enabled));

assert.equal(scenarios.B.publisherScriptEnabled, true);
assert.equal(scenarios.B.anchorEnabled, true);
assert.ok(Object.values(scenarios.B.manualSlotEnabled).every((enabled) => !enabled));

assert.equal(scenarios.C.publisherScriptEnabled, true);
assert.equal(scenarios.C.anchorEnabled, false);
assert.equal(scenarios.C.manualSlotEnabled["news-rail-300x250"], true);
assert.ok(
  adSenseInventories
    .filter((inventory) => inventory !== "news-rail-300x250")
    .every((inventory) => !scenarios.C.manualSlotEnabled[inventory]),
);

assert.equal(scenarios.D.publisherScriptEnabled, true);
assert.equal(scenarios.D.anchorEnabled, true);
assert.equal(scenarios.D.manualSlotEnabled["news-rail-300x250"], true);

assert.equal(scenarios.E.publisherScriptEnabled, true);
assert.equal(scenarios.E.anchorEnabled, false);
assert.equal(scenarios.E.manualSlotEnabled["analysis-signal-companion"], true);
assert.equal(
  Object.values(scenarios.E.manualSlotEnabled).filter(Boolean).length,
  1,
);

assert.equal(scenarios.F.publisherScriptEnabled, true);
assert.equal(scenarios.F.anchorEnabled, false);
assert.equal(
  scenarios.F.manualSlotEnabled["analysis-collapsed-rail-inline"],
  true,
);
assert.equal(
  Object.values(scenarios.F.manualSlotEnabled).filter(Boolean).length,
  1,
);

const scriptCounts = {};

for (const scenarioName of ["A", "B", "C", "D", "E", "F"]) {
  const fakeDom = installFakeDom();
  const scenario = scenarios[scenarioName];
  const loaderCalls = [];

  if (scenario.anchorEnabled) {
    loaderCalls.push(loadAdSenseScript(scenario.publisherId));
  }
  for (const inventory of adSenseInventories) {
    if (scenario.manualSlotEnabled[inventory]) {
      loaderCalls.push(loadAdSenseScript(scenario.publisherId));
      loaderCalls.push(loadAdSenseScript(scenario.publisherId));
    }
  }

  await Promise.all(loaderCalls);
  const expectedScriptCount = scenario.publisherScriptEnabled ? 1 : 0;
  scriptCounts[scenarioName] = fakeDom.appendCount;
  assert.equal(
    fakeDom.appendCount,
    expectedScriptCount,
    `scenario ${scenarioName} script count`,
  );
  assert.equal(
    fakeDom.scripts.size,
    expectedScriptCount,
    `scenario ${scenarioName} unique script`,
  );
  if (expectedScriptCount) {
    const script = fakeDom.scripts.get(ADSENSE_SCRIPT_ID);
    assert.ok(script, `scenario ${scenarioName} script id`);
    assert.equal(
      script.src,
      `${ADSENSE_SCRIPT_ORIGIN}?client=ca-pub-test`,
      `scenario ${scenarioName} script source`,
    );
  }
  uninstallFakeDom();
}

const slotSource = await readFile(
  new URL("../components/ads/AdSenseSlot.tsx", import.meta.url),
  "utf8",
);
const publisherLoaderSource = await readFile(
  new URL("../components/ads/AdSensePublisherLoader.tsx", import.meta.url),
  "utf8",
);
const scriptLoaderSource = await readFile(
  new URL("../components/ads/adsenseScriptLoader.ts", import.meta.url),
  "utf8",
);
const slotStylesSource = await readFile(
  new URL("../components/ads/AdSenseSlot.module.css", import.meta.url),
  "utf8",
);
const manualPlacementSources = await Promise.all(
  [
    "../components/news-v2/NewsV2RailAdSlot.tsx",
    "../components/news-v2/NewsV2InlineAd.tsx",
    "../components/news-v2/NewsV2InsightInlineAd.tsx",
    "../components/filings-v2/FilingsRailAdSlot.tsx",
    "../components/filings-v2/FilingsV2InlineAd.tsx",
    "../components/dashboard-v2/DesktopInlineAdSlot.tsx",
    "../components/dashboard-v2/DesktopRailAdSlot.tsx",
    "../components/dashboard-v2/MobileInlineAdSlot.tsx",
    "../components/filing-analysis-v2/FilingInlineAdSlot.tsx",
    "../components/filing-analysis-v2/FilingRailAdSlot.tsx",
    "../components/filing-analysis-v2/AnalysisSignalCompanionAd.tsx",
    "../components/filing-analysis-v2/AnalysisCollapsedRailInlineAd.tsx",
    "../components/alerts-v2/StockRadarAlertsV2.tsx",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
);
const analysisCompanionSource = await readFile(
  new URL(
    "../components/filing-analysis-v2/AnalysisSignalCompanionAd.tsx",
    import.meta.url,
  ),
  "utf8",
);
const analysisCollapsedRailSource = await readFile(
  new URL(
    "../components/filing-analysis-v2/AnalysisCollapsedRailInlineAd.tsx",
    import.meta.url,
  ),
  "utf8",
);
const advertisingSource = `${slotSource}\n${publisherLoaderSource}\n${scriptLoaderSource}`;

assert.equal(
  (slotSource.match(/window\.adsbygoogle\.push\(\{\}\)/g) || []).length,
  1,
  "manual slots expose one guarded push call",
);
assert.match(slotSource, /hasPushedRef\.current/);
assert.doesNotMatch(advertisingSource, /setInterval|auto.?refresh/i);
assert.doesNotMatch(publisherLoaderSource, /<ins|data-ad-slot|position:\s*fixed/i);
assert.match(publisherLoaderSource, /return null/);
assert.match(slotSource, /import Link from "next\/link"/);
assert.match(slotSource, /removeAdsHref = "\/premium"/);
assert.match(slotSource, /showRemoveAdsLink = true/);
assert.match(slotSource, /enabledForViewer = true/);
assert.match(slotSource, /if \(!enabledForViewer\) return null/);
assert.match(
  slotSource,
  /<ins[\s\S]*?\/>[\s\S]*?<div className=\{styles\.footer\}>/,
  "manual footer follows the self-closing AdSense element as a sibling",
);
assert.match(slotSource, /href=\{removeAdsHref\}/);
assert.match(slotSource, />\s*Remove ads\s*<\/Link>/);
assert.doesNotMatch(
  publisherLoaderSource,
  /Remove ads|removeAdsHref|styles\.footer/,
  "Anchor loader has no custom conversion footer",
);
assert.match(slotStylesSource, /\.adSurface[\s\S]*height:\s*var\(--adsense-slot-height\)/);
assert.match(slotSource, /data-responsive=\{isResponsiveFormat \? "true" : undefined\}/);
assert.match(slotSource, /data-ad-format=\{isResponsiveFormat \? "auto" : undefined\}/);
assert.match(slotStylesSource, /\.slot\[data-responsive="true"\] \.adSurface/);
assert.match(slotStylesSource, /\.footer[\s\S]*border-top:/);
assert.match(slotStylesSource, /\.removeAdsLink:focus-visible/);
assert.ok(
  manualPlacementSources.every((source) => source.includes("<AdSenseSlot")),
  "all manual placement owners use the shared slot footer",
);
assert.equal(
  (
    analysisCompanionSource.match(
      /inventory="analysis-signal-companion"/g,
    ) || []
  ).length,
  1,
  "analysis companion owns one independently configured inventory",
);
assert.equal(
  (
    analysisCollapsedRailSource.match(
      /inventory="analysis-collapsed-rail-inline"/g,
    ) || []
  ).length,
  1,
  "analysis collapsed rail fallback owns one independently configured inventory",
);

console.log(
  JSON.stringify({
    A: summarize(scenarios.A),
    B: summarize(scenarios.B),
    C: summarize(scenarios.C),
    D: summarize(scenarios.D),
    E: summarize(scenarios.E),
    F: summarize(scenarios.F),
    duplicateScriptGuard: "passed",
    manualFooterBoundary: "passed",
    manualFooterPremiumHref: "/premium",
    manualPushGuard: "passed",
    anchorCustomFooter: "absent",
    refreshTimer: "absent",
    scriptCounts,
  }),
);

function summarize(config) {
  return {
    anchorEnabled: config.anchorEnabled,
    manualSlots: Object.values(config.manualSlotEnabled).filter(Boolean).length,
    publisherScriptEnabled: config.publisherScriptEnabled,
  };
}

function installFakeDom() {
  const scripts = new Map();
  let appendCount = 0;

  class FakeScript {
    async = false;
    crossOrigin = "";
    dataset = {};
    id = "";
    listeners = new Map();
    src = "";

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    dispatch(type) {
      this.listeners.get(type)?.();
    }
  }

  globalThis.window = {};
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "script");
      return new FakeScript();
    },
    getElementById(id) {
      return scripts.get(id) || null;
    },
    head: {
      appendChild(script) {
        appendCount += 1;
        scripts.set(script.id, script);
        queueMicrotask(() => script.dispatch("load"));
      },
    },
  };

  return {
    get appendCount() {
      return appendCount;
    },
    scripts,
  };
}

function uninstallFakeDom() {
  delete globalThis.document;
  delete globalThis.window;
}
