import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("./StockRadarPremiumV2.tsx", import.meta.url),
  "utf8",
);
const comparisonSource = readFileSync(
  new URL("./PremiumFeatureComparison.tsx", import.meta.url),
  "utf8",
);
const dataSource = readFileSync(
  new URL("../../lib/mock/premiumV2Data.ts", import.meta.url),
  "utf8",
);
const trialCtaSource = readFileSync(
  new URL("../AdvancedTrialCta.tsx", import.meta.url),
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
  assert.doesNotMatch(componentSource, /Start Advanced Trial|Go Advanced/);
  assert.doesNotMatch(dataSource, /cta: "Start Advanced Trial"/);
  assert.match(componentSource, /accountState\.trial\.used/);
  assert.match(
    componentSource,
    /if \(!accountState\.authenticated\) \{[\s\S]*Start Free/,
  );
  assert.match(
    componentSource,
    /accountState\.currentPlan === "free"[\s\S]*Manage alerts/,
  );
  assert.match(componentSource, /Current: \{premiumV2Plans\[accountState\.currentPlan\]\.name\}/);
  assert.match(
    componentSource,
    /accountState\.authenticated && planKey === accountState\.currentPlan/,
  );
  assert.match(componentSource, /styles\.currentCard/);
  assert.match(componentSource, /data-current-plan=\{isCurrent \? "true" : undefined\}/);
  assert.match(
    componentSource,
    /No checkout, payment, or account change was started\./,
  );
  assert.match(componentSource, /data-testid="premium-v2-upgrade-status"/);
  assert.match(trialCtaSource, /Card required/);
  assert.match(trialCtaSource, /Renews as monthly Advanced after 14 days/);
  assert.match(trialCtaSource, /Checkout required/);
});

test("keeps coverage labels concise and comparison values free of repeated event badges", () => {
  assert.match(dataSource, /badge: "Pro\+"/);
  assert.match(dataSource, /badge: "Advanced\+"/);
  assert.match(
    dataSource,
    /feature: "Market-Wide Discovery",[\s\S]*free: "Pro\+ required",[\s\S]*adFree: "Pro\+ required",[\s\S]*pro: "12 Core types",[\s\S]*advanced: "All 17 types",[\s\S]*ultimate: "All 17 types \+ rules"/,
  );
  assert.doesNotMatch(dataSource, /details:|emphasized:/);
  assert.match(componentSource, /className=\{styles\.coverageTier\}>\{group\.badge\}/);
  assert.doesNotMatch(componentSource, /<strong>\{group\.badge\}<\/strong>/);
  assert.doesNotMatch(componentSource, /category-\$\{category\.tone\}/);
  assert.doesNotMatch(comparisonSource, /\bBadge\b|detailItems|row\.details|row\.emphasized/);
  assert.match(
    styles,
    /\.coverageGroups \{[\s\S]*grid-template-columns: minmax\(0, 1\.4fr\) minmax\(0, 0\.6fr\);/,
  );
  assert.doesNotMatch(styles, /\.comparisonRowEmphasized|\.comparisonDetailList/);
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
    /\.actionRow \{[\s\S]*align-items: flex-start;[\s\S]*\.heroCopy \.actionRow \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*align-items: start;/,
  );
  assert.match(
    styles,
    /\.currentPlanAction \{[\s\S]*border-color: var\(--sr-color-border-control\);[\s\S]*color: var\(--sr-color-text-control-strong\);[\s\S]*background: var\(--sr-color-surface-control\);/,
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
