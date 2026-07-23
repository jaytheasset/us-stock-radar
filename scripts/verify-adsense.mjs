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

const scriptCounts = {};

for (const scenarioName of ["A", "B", "C", "D"]) {
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

console.log(
  JSON.stringify({
    A: summarize(scenarios.A),
    B: summarize(scenarios.B),
    C: summarize(scenarios.C),
    D: summarize(scenarios.D),
    duplicateScriptGuard: "passed",
    manualPushGuard: "passed",
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
