import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADVANCED_TRIAL_POLICY,
  ALERT_CATEGORIES,
  CORE_ALERT_CATEGORIES,
  INTERNAL_ALERT_CATEGORIES,
  RISK_CATALYST_ALERT_CATEGORIES,
  getAllAlertCategoryValues,
  getPlanLimits,
  isDiscoveryCategoryAllowed,
  isTickerAlertCategoryAllowed,
  isValidAlertCategory,
  isValidPublicAlertCategory,
  type Plan,
} from "./subscriptionPolicy.ts";

const plans: Plan[] = ["free", "ad_free", "pro", "advanced", "ultimate"];

test("public alert taxonomy is exactly 12 Core plus 5 Risk & Catalyst categories", () => {
  assert.equal(CORE_ALERT_CATEGORIES.length, 12);
  assert.equal(RISK_CATALYST_ALERT_CATEGORIES.length, 5);
  assert.equal(ALERT_CATEGORIES.length, 17);
  assert.equal(getAllAlertCategoryValues().length, 17);
  assert.equal(new Set(getAllAlertCategoryValues()).size, 17);
});

test("other remains an internal fallback and is never a public entitlement", () => {
  assert.deepEqual(INTERNAL_ALERT_CATEGORIES.map((category) => category.code), ["other"]);
  assert.equal(isValidAlertCategory("other"), true);
  assert.equal(isValidPublicAlertCategory("other"), false);
  assert.equal(getAllAlertCategoryValues().includes("other" as never), false);
});

test("watchlists are unlimited and alert ticker limits match the approved contract", () => {
  assert.deepEqual(
    plans.map((plan) => getPlanLimits(plan).watchlistLimit),
    [null, null, null, null, null],
  );
  assert.deepEqual(
    plans.map((plan) => getPlanLimits(plan).alertTickerLimit),
    [1, 5, 15, null, null],
  );
  assert.deepEqual(
    plans.map((plan) => getPlanLimits(plan).calendarEventFollowLimit),
    [5, 20, 50, null, null],
  );
});

test("market-wide Discovery uses an allowed category set, not arbitrary slots", () => {
  assert.deepEqual(
    plans.map((plan) => getPlanLimits(plan).discoveryCategories.length),
    [0, 0, 12, 17, 17],
  );

  for (const plan of ["free", "ad_free"] as const) {
    assert.equal(isDiscoveryCategoryAllowed(plan, "earnings"), false);
    assert.equal(isDiscoveryCategoryAllowed(plan, "dilution_risk"), false);
    assert.equal(isDiscoveryCategoryAllowed(plan, "other"), false);
  }

  assert.equal(isDiscoveryCategoryAllowed("pro", "earnings"), true);
  assert.equal(isDiscoveryCategoryAllowed("pro", "dilution_risk"), false);
  assert.equal(isDiscoveryCategoryAllowed("pro", "other"), false);

  for (const plan of ["advanced", "ultimate"] as const) {
    assert.equal(isDiscoveryCategoryAllowed(plan, "dilution_risk"), true);
    assert.equal(isDiscoveryCategoryAllowed(plan, "other"), false);
  }
});

test("every alert-enabled ticker is monitored across all 17 public event types", () => {
  for (const plan of plans) {
    assert.equal(getPlanLimits(plan).tickerAlertCategories.length, 17);
    for (const category of getAllAlertCategoryValues()) {
      assert.equal(isTickerAlertCategoryAllowed(plan, category), true);
    }
    assert.equal(isTickerAlertCategoryAllowed(plan, "other"), false);
  }
});

test("delivery speed, channels, filters, and automation match the approved tiers", () => {
  assert.deepEqual(getPlanLimits("free").channels, ["web"]);
  assert.deepEqual(getPlanLimits("ad_free").channels, ["web"]);
  assert.deepEqual(getPlanLimits("pro").channels, ["web", "telegram"]);
  assert.deepEqual(getPlanLimits("advanced").channels, ["web", "telegram", "email"]);
  assert.deepEqual(getPlanLimits("ultimate").channels, ["web", "telegram", "email", "webhook", "api"]);
  assert.equal(getPlanLimits("free").alertDelayMinutes, 5);
  assert.equal(getPlanLimits("ad_free").alertDelayMinutes, 5);
  assert.equal(getPlanLimits("pro").alertDelayMinutes, 0);
  assert.equal(getPlanLimits("advanced").advancedFilters, true);
  assert.equal(getPlanLimits("pro").advancedFilters, false);
  assert.equal(getPlanLimits("ultimate").customRules, true);
  assert.equal(getPlanLimits("ultimate").webhookApi, true);
});

test("the only new trial offer is a card-backed 14-day Advanced trial", () => {
  assert.equal(ADVANCED_TRIAL_POLICY.plan, "advanced");
  assert.equal(ADVANCED_TRIAL_POLICY.durationDays, 14);
  assert.equal(ADVANCED_TRIAL_POLICY.paymentMethodRequired, true);
  assert.equal(ADVANCED_TRIAL_POLICY.autoConvertsToPaid, true);
  assert.equal(ADVANCED_TRIAL_POLICY.oncePerAccount, true);
  assert.equal(ADVANCED_TRIAL_POLICY.cancellationKeepsAccessUntilEnd, true);
  assert.equal(ADVANCED_TRIAL_POLICY.failedPaymentFallbackPlan, "free");
  assert.equal(ADVANCED_TRIAL_POLICY.preservesUserDataOnFallback, true);
});

test("trial routes cannot create a no-card trial", () => {
  const advancedRoute = read("../app/api/trials/advanced/start/route.ts");
  const legacyProRoute = read("../app/api/trials/pro/start/route.ts");
  const effectivePlan = read("./subscription/effectivePlan.ts");

  assert.match(advancedRoute, /CHECKOUT_REQUIRED/);
  assert.doesNotMatch(advancedRoute, /supabaseUpsert|trial_plan:\s*"advanced"/);
  assert.match(legacyProRoute, /PRO_TRIAL_RETIRED/);
  assert.doesNotMatch(legacyProRoute, /supabaseUpsert/);
  assert.match(effectivePlan, /trialPlan === "pro" \|\| trialPlan === "advanced"/);
  assert.doesNotMatch(effectivePlan, /endsTime > now\.getTime\(\) && !cancelledAt/);
});

test("Premium, Alerts, and Watchlist surfaces do not advertise retired limits", () => {
  const sources = [
    read("./mock/premiumV2Data.ts"),
    read("../app/alerts/AlertsClient.tsx"),
    read("../components/alerts-v2/StockRadarAlertsV2.tsx"),
    read("../components/watchlist-v2/StockRadarWatchlistV2.tsx"),
  ].join("\n");

  assert.doesNotMatch(sources, /20 alert tickers|20 tickers|30 watchlist|150 watchlist|6 Discovery categories/i);
  assert.doesNotMatch(sources, /Start 14-day Pro Trial|no-card Pro trial/i);
  assert.match(sources, /Unlimited watchlist/i);
  assert.match(sources, /All 17/i);
});

test("Alerts persistence and delivery enforce the public plan category set", () => {
  const validation = read("./alerts/alertValidation.ts");
  const categoryRoute = read("../app/api/alerts/discovery-categories/route.ts");
  const delivery = read("./alerts/delivery/evaluateAlertDelivery.ts");

  assert.match(validation, /isValidPublicAlertCategory/);
  assert.match(validation, /assertDiscoveryCategoriesAllowed/);
  assert.doesNotMatch(validation, /discoveryCategoryLimit|CATEGORY_LIMIT_EXCEEDED/);
  assert.match(categoryRoute, /assertDiscoveryCategoriesAllowed\(plan, categories\)/);
  assert.match(delivery, /event\.category === "other"/);
  assert.match(delivery, /isDiscoveryCategoryAllowed\(context\.plan, event\.category\)/);
});

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
