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
const marketMovingSource = readFileSync(
  new URL("./PremiumMarketMovingEvents.tsx", import.meta.url),
  "utf8",
);
const marketMovingDataSource = readFileSync(
  new URL("../../lib/premiumMarketMoving.ts", import.meta.url),
  "utf8",
);
const marketMovingServerSource = readFileSync(
  new URL("../../lib/premiumMarketMoving.server.ts", import.meta.url),
  "utf8",
);
const marketMovingRouteSource = readFileSync(
  new URL("../../app/api/premium/market-moving-events/route.ts", import.meta.url),
  "utf8",
);
const marketMovingRateLimitSource = readFileSync(
  new URL("../../lib/premiumMarketMovingRateLimit.server.ts", import.meta.url),
  "utf8",
);
const marketMovingRateLimitPolicySource = readFileSync(
  new URL("../../lib/premiumMarketMovingRateLimit.ts", import.meta.url),
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

test("keeps public delayed and personalized premium delivery channels distinct", () => {
  assert.match(dataSource, /"5-minute delayed Web alerts"/);
  assert.match(dataSource, /"5-minute delayed Public Telegram channel"/);
  assert.match(
    dataSource,
    /"Real-time personalized Web \+ Telegram \+ Mobile app push alerts"/,
  );
  assert.match(
    dataSource,
    /"Real-time personalized Web \+ Telegram \+ Mobile app push \+ Email alerts"/,
  );
  assert.match(dataSource, /"Webhook \+ API delivery"/);
  assert.match(
    dataSource,
    /free: "Web \+ Public Telegram channel",[\s\S]*adFree: "Web \+ Public Telegram channel",[\s\S]*pro: "Personalized Web \+ Telegram \+ Mobile app push",[\s\S]*advanced: "Personalized Web \+ Telegram \+ Mobile app push \+ Email",[\s\S]*ultimate: "Personalized Web \+ Telegram \+ Mobile app push \+ Email \+ Webhook \+ API"/,
  );
  assert.match(
    dataSource,
    /Personalized Telegram alerts begin with Pro\./,
  );
  assert.doesNotMatch(dataSource, /Unlimited watchlist 쨌/);
});

test("loads only real 90+ SEC filings through a fixed minimal server-only API", () => {
  assert.doesNotMatch(dataSource, /premiumV2SampleAlerts|MULN files|Bearish 88|Bullish 82/);
  assert.match(componentSource, /<PremiumMarketMovingEvents \/>/);
  assert.match(marketMovingDataSource, /source_group: "eq\.filings"/);
  assert.match(marketMovingDataSource, /source_code: "eq\.sec_edgar"/);
  assert.match(marketMovingDataSource, /score: "gte\.90"/);
  assert.match(marketMovingDataSource, /order: "detected_at\.desc"/);
  assert.doesNotMatch(marketMovingDataSource, /published_at\.desc\.nullslast/);
  assert.match(marketMovingDataSource, /\.slice\(0, PREMIUM_MARKET_MOVING_LIMIT\)/);
  assert.match(marketMovingDataSource, /href: `\/filings\/\$\{id\}`/);
  assert.match(marketMovingDataSource, /getEventTypeDefinition/);
  assert.match(marketMovingServerSource, /import "server-only"/);
  assert.match(marketMovingServerSource, /supabaseSelect\(\s*"events"/);
  assert.match(marketMovingServerSource, /supabaseSelect\(\s*"event_tickers"/);
  assert.doesNotMatch(marketMovingRouteSource, /metadata|prompt|service.?role/i);
  assert.match(marketMovingRouteSource, /if \(request\.nextUrl\.search\)/);
  assert.match(marketMovingRouteSource, /Query parameters are not supported\./);
  assert.match(marketMovingRouteSource, /headers: publicCacheHeaders/);
  assert.match(
    marketMovingRouteSource,
    /public, max-age=0, s-maxage=\$\{PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS\}, stale-while-revalidate=\$\{PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS\}/,
  );
  assert.match(marketMovingRouteSource, /private, no-store, max-age=0/);
  assert.match(marketMovingServerSource, /cachedResponse/);
  assert.match(marketMovingServerSource, /pendingResponse/);
  assert.match(
    marketMovingServerSource,
    /PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS \* 1_000/,
  );
});

test("protects the public fixed endpoint from uncached request abuse", () => {
  assert.match(marketMovingRouteSource, /consumePremiumMarketMovingReadLimit\(request\)/);
  assert.match(marketMovingRouteSource, /"Retry-After"/);
  assert.match(marketMovingRouteSource, /status: 429/);
  assert.match(marketMovingRateLimitSource, /createHash\("sha256"\)/);
  assert.match(
    marketMovingRateLimitPolicySource,
    /PREMIUM_MARKET_MOVING_IDENTITY_LIMIT = 30/,
  );
  assert.match(
    marketMovingRateLimitPolicySource,
    /PREMIUM_MARKET_MOVING_GLOBAL_LIMIT = 600/,
  );
  assert.match(
    marketMovingRateLimitPolicySource,
    /PREMIUM_MARKET_MOVING_MAX_IDENTITIES = 1_000/,
  );
});

test("covers live event loading, empty, error, success, and resilient refresh states", () => {
  assert.match(marketMovingSource, /Loading 90\+ filings/);
  assert.match(marketMovingSource, /No 90\+ filings right now\./);
  assert.match(marketMovingSource, /Market-moving filings are temporarily unavailable\./);
  assert.match(marketMovingSource, /events\.map/);
  assert.match(marketMovingSource, /Showing the latest available filings\./);
  assert.match(marketMovingSource, /hasSuccessfulDataRef\.current/);
});

test("polls at 60 seconds only while visible and refreshes on visibility and focus", () => {
  assert.match(marketMovingSource, /PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS/);
  assert.match(marketMovingSource, /document\.visibilityState/);
  assert.match(marketMovingSource, /visibilitychange/);
  assert.match(marketMovingSource, /window\.addEventListener\("focus"/);
  assert.match(
    marketMovingSource,
    /const handleFocus = \(\) => \{[\s\S]*shouldPollPremiumMarketMoving\(document\.visibilityState\)[\s\S]*void refresh\(\);[\s\S]*\};/,
  );
  assert.match(marketMovingSource, /if \(inFlightRef\.current\) return inFlightRef\.current/);
  assert.match(marketMovingSource, /new AbortController\(\)/);
  assert.doesNotMatch(marketMovingSource, /cache: "no-store"/);
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
    /@media \(max-width: 760px\) \{[\s\S]*?\.root \{[\s\S]*?padding: var\(--sr-space-3\) var\(--sr-space-2\) var\(--sr-space-7\);[\s\S]*?\.planGrid,[\s\S]*?grid-template-columns: 1fr;/,
  );
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.planCard \{[\s\S]*?width: 100%;[\s\S]*?margin-inline: 0;[\s\S]*?padding: var\(--sr-space-3\);/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.titleBlock h1 \{[\s\S]*?font-size: var\(--sr-font-size-heading-sm\);/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.planDescription,[\s\S]*?\.benefitList li,[\s\S]*?font-size: var\(--sr-font-size-lg\);/);
});
