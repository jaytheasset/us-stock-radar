import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("./StockRadarAlertsV2.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./StockRadarAlertsV2.module.css", import.meta.url),
  "utf8",
);

test("alerts uses the shared product shell and token-only visual contract", () => {
  assert.match(
    styles,
    /\.page \{[\s\S]*width: min\(100%, 1600px\);[\s\S]*margin: 0 auto;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-page-gutter-desktop\) var\(--sr-space-8\);[\s\S]*font-family: var\(--sr-font-family-sans\);/,
  );
  assert.match(
    styles,
    /\.pageShell \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 320px;[\s\S]*width: 100%;/,
  );
  assert.match(
    styles,
    /\.header h1 \{[\s\S]*font-size: var\(--sr-font-size-heading-sm\);/,
  );
  assert.match(
    styles,
    /\.notice,[\s\S]*\.card,[\s\S]*\.watchlistPanel \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*background: var\(--sr-color-surface-panel\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
  assert.doesNotMatch(styles, /--alerts-/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /rgba?\(/i);
});

test("alerts controls keep the shared search, focus, toggle, and locked-state hierarchy", () => {
  assert.match(
    styles,
    /\.searchBox \{[\s\S]*height: 38px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*background: var\(--sr-color-surface-control\);/,
  );
  assert.match(
    styles,
    /\.searchBox:focus-within \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*box-shadow: 0 0 0 2px var\(--sr-color-accent-active-soft\);/,
  );
  assert.match(
    styles,
    /\.toggle \{[\s\S]*width: 38px;[\s\S]*height: var\(--sr-size-badge\);[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);/,
  );
  assert.match(
    styles,
    /\.toggle\[data-state="on"\] \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*background: var\(--sr-color-accent-selected\);/,
  );
  assert.match(
    styles,
    /\.toggle:disabled \{[\s\S]*background: var\(--sr-color-state-disabled-surface\);[\s\S]*opacity: var\(--sr-opacity-disabled\);/,
  );
  assert.match(
    styles,
    /\.lockedBadge \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*color: var\(--sr-color-text-meta\);[\s\S]*background: var\(--sr-color-surface-control\);/,
  );
});

test("alerts preserves the plan-aware rail and mobile settings flow", () => {
  assert.match(
    styles,
    /\.railUpgrade \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-accent-border-premium\);[\s\S]*linear-gradient\(180deg, var\(--sr-color-accent-cta-top\), var\(--sr-color-accent-cta-bottom\)\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
  assert.match(
    styles,
    /\.railUpgradeLink \{[\s\S]*color: var\(--sr-color-text-primary-action\);[\s\S]*background: var\(--sr-color-surface-primary-action\);/,
  );
  assert.match(
    componentSource,
    /className=\{styles\.mobileCoverageControl\}[\s\S]*id="alerts-v2-coverage-toggle"[\s\S]*className=\{styles\.mobileCoverageSummary\} htmlFor="alerts-v2-coverage-toggle"/,
  );
  assert.match(
    styles,
    /\.mobileCoverageControl:not\(:checked\) ~ \.settingList,[\s\S]*\.mobileCoverageControl:not\(:checked\) ~ \.upgradePanel,[\s\S]*\.mobileCoverageControl:not\(:checked\) ~ \.cardFooter \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.settingsSideColumn \.marketCapCard \{[\s\S]*order: 1;[\s\S]*\.settingsSideColumn \.deliveryCard \{[\s\S]*order: 2;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.filingTypeGrid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
  );
});
