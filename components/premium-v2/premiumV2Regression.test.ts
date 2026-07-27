import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("./StockRadarPremiumV2.tsx", import.meta.url),
  "utf8",
);
const dataSource = readFileSync(
  new URL("../../lib/mock/premiumV2Data.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./StockRadarPremiumV2.module.css", import.meta.url),
  "utf8",
);

test("keeps the five-plan product contract and recommendation", () => {
  assert.match(
    dataSource,
    /premiumV2PlanOrder = \["free", "adFree", "pro", "advanced", "ultimate"\]/,
  );
  assert.match(dataSource, /premiumV2RecommendedPlan: PremiumV2PlanKey = "advanced"/);
  for (const price of ["$0", "$6.99", "$19", "$49", "From $199"]) {
    assert.match(dataSource, new RegExp(`monthlyPrice: "${price.replace("$", "\\$")}"`));
  }
});

test("keeps trial, current-plan, and preview-selection behavior visible in the source", () => {
  assert.match(componentSource, /accountState\.planSource === "trial"/);
  assert.match(componentSource, /<AdvancedTrialCta[\s\S]*guestMode/);
  assert.match(componentSource, /Start 14-day Advanced Trial/);
  assert.match(componentSource, /accountState\.trial\.used/);
  assert.match(componentSource, /styles\.currentCard/);
  assert.match(componentSource, /data-current-plan=\{isCurrent \? "true" : undefined\}/);
  assert.match(
    componentSource,
    /No checkout, payment, or account change was started\./,
  );
  assert.match(componentSource, /data-testid="premium-v2-upgrade-status"/);
});

test("uses the shared product shell width, typography, panels, and responsive plan grid", () => {
  assert.match(
    styles,
    /\.root \{[\s\S]*width: min\(100%, 1600px\);[\s\S]*margin: 0 auto;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-page-gutter-desktop\) var\(--sr-space-8\);[\s\S]*color: var\(--sr-color-text-primary\);[\s\S]*background: var\(--sr-color-page-background\);[\s\S]*font-family: var\(--sr-font-family-sans\);/,
  );
  assert.match(styles, /\.workspace \{[\s\S]*width: 100%;/);
  assert.doesNotMatch(styles, /\.workspace \{[\s\S]*?width: calc\(/);
  assert.match(
    styles,
    /\.planCard \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*background: var\(--sr-color-surface-panel\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
  assert.match(
    styles,
    /\.recommendedCard \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
  assert.doesNotMatch(styles, /\.planCardPro \{/);
  assert.doesNotMatch(styles, /\.planCardAdvanced \{/);
  assert.match(
    styles,
    /\.price strong \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-variant-numeric: var\(--sr-font-variant-numeric\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1320px\) \{[\s\S]*?\.planGrid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 960px\) \{[\s\S]*?\.planGrid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.root \{[\s\S]*?padding: var\(--sr-space-3\) var\(--sr-page-gutter-mobile\) var\(--sr-space-7\);[\s\S]*?\.planGrid,[\s\S]*?grid-template-columns: 1fr;/,
  );
});
