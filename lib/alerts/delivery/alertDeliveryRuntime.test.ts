import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { matchWatchedEventTickers } from "./eventDeliveryDedupe.ts";
import type { NormalizedAlertEvent } from "./types.ts";

const projectRootUrl = new URL("../../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20%7B%7D;",
      };
    }
    if (specifier.startsWith("@/")) {
      return {
        shortCircuit: true,
        url: new URL(`${specifier.slice(2)}.ts`, projectRootUrl).href,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { evaluateAlertDeliveryForEvent } = await import(
  "./evaluateAlertDelivery.ts"
);

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const cronRoute = readProjectFile("app/api/cron/alert-delivery/route.ts");
const scheduler = readProjectFile(
  "lib/alerts/delivery/runAlertDeliveryScheduler.ts",
);
const eventDelivery = readProjectFile(
  "lib/alerts/delivery/runAlertDeliveryForEvent.ts",
);
const queuedDelivery = readProjectFile(
  "lib/alerts/delivery/processQueuedDeliveries.ts",
);
const publicTelegramDelivery = readProjectFile(
  "lib/alerts/delivery/publicTelegramBroadcast.ts",
);
const adminTelegramDelivery = readProjectFile(
  "lib/admin/telegramCampaignDelivery.ts",
);
const deliveryEvaluation = readProjectFile(
  "lib/alerts/delivery/evaluateAlertDelivery.ts",
);
const secEventStore = readProjectFile("lib/secStores/eventStore.ts");
const alertsConfig = readProjectFile("lib/alerts/alertsV2Config.ts");
const eventCli = readProjectFile("scripts/run-alert-delivery-for-event.mjs");
const queuedCli = readProjectFile("scripts/process-queued-alert-deliveries.mjs");
const headerMenu = readProjectFile(
  "components/shell/AlertNotificationsMenu.tsx",
);
const deliveredRoute = readProjectFile("app/api/alerts/delivered/route.ts");
const webDeliveryVisibility = readProjectFile(
  "lib/alerts/webDeliveryVisibility.ts",
);
const adminAlerts = readProjectFile("app/admin/alerts/page.tsx");
const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};

const tickerlessAlertEvent: NormalizedAlertEvent = {
  id: "tickerless-alert-event",
  title: "Material market event without issuer ticker linkage",
  tickers: [],
  category: "earnings",
  sourceType: "filing",
  marketScope: "company",
  score: 82,
  metadata: {
    delivery_level: "alert",
    market_cap: 50_000_000_000,
  },
};

type EvaluationDependencies = NonNullable<
  Parameters<typeof evaluateAlertDeliveryForEvent>[1]
>;

function createTickerlessEvaluationDependencies({
  channels = [{ channel: "web", enabled: true }],
  discoveryCategories = ["earnings"],
  discoveryEnabled = true,
  marketCapFilters = ["mega", "large", "mid", "small", "micro"],
  plan = "pro",
  watchlistTickers = [],
}: {
  channels?: Array<{ channel: "web"; enabled: boolean }>;
  discoveryCategories?: NormalizedAlertEvent["category"][];
  discoveryEnabled?: boolean;
  marketCapFilters?: string[];
  plan?: "free" | "pro";
  watchlistTickers?: string[];
} = {}): EvaluationDependencies {
  return {
    fetchUsers: async () => ["tickerless-user"],
    fetchUserContext: async (userId) => {
      assert.equal(userId, "tickerless-user");
      return {
        plan,
        preferences: {
          watchlistNewsEnabled: true,
          watchlistFilingsEnabled: true,
          watchlistCalendarEnabled: true,
          discoveryEnabled,
          marketCapFilters,
        },
        watchlistTickers: new Set(watchlistTickers),
        discoveryCategories: new Set(discoveryCategories),
        channels,
      };
    },
    now: () => new Date("2026-08-10T00:00:00.000Z"),
  };
}

test("Vercel Cron uses authenticated GET with an explicit write gate", () => {
  assert.match(cronRoute, /export async function GET/);
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
  assert.match(cronRoute, /authorization !== `Bearer \$\{secret\}`/);
  assert.match(cronRoute, /ALERT_DELIVERY_CRON_WRITE_ENABLED/);
  assert.match(cronRoute, /status: 401/);
  assert.match(cronRoute, /status: 403/);
});

test("manual POST compatibility stays dry-run by default and isolated from scheduled auth", () => {
  assert.match(cronRoute, /export async function POST/);
  assert.match(cronRoute, /scheduled: false/);
  assert.match(cronRoute, /ALERT_DELIVERY_CRON_SECRET/);
  assert.match(cronRoute, /x-cron-secret/);
});

test("one scheduler lock covers member, public Telegram, admin campaigns, and Calendar delivery", () => {
  assert.match(scheduler, /acquireJobLock/);
  assert.match(scheduler, /await runAlertDeliveryBatch/);
  assert.match(scheduler, /await processQueuedDeliveries/);
  assert.match(scheduler, /await runPublicTelegramBroadcastDelivery/);
  assert.match(scheduler, /await runDueAdminTelegramCampaigns/);
  assert.match(scheduler, /await runCalendarAlertDelivery/);
  assert.ok(
    scheduler.indexOf("await runAlertDeliveryBatch") <
      scheduler.indexOf("await processQueuedDeliveries"),
  );
  assert.ok(
    scheduler.indexOf("await processQueuedDeliveries") <
      scheduler.indexOf("await runPublicTelegramBroadcastDelivery"),
  );
  assert.ok(
    scheduler.indexOf("await runPublicTelegramBroadcastDelivery") <
      scheduler.indexOf("await runDueAdminTelegramCampaigns"),
  );
  assert.ok(
    scheduler.indexOf("await runDueAdminTelegramCampaigns") <
      scheduler.indexOf("await runCalendarAlertDelivery"),
  );
});

test("public Telegram stays separate from member delivery and fail-closed", () => {
  assert.match(publicTelegramDelivery, /public_telegram_broadcast_deliveries/);
  assert.match(publicTelegramDelivery, /normalizePublicTelegramDestination/);
  assert.match(publicTelegramDelivery, /alertDeliverySendTelegramPublic/);
  assert.match(publicTelegramDelivery, /claimPublicTelegramBroadcast/);
  assert.match(publicTelegramDelivery, /finishPublicTelegramBroadcast/);
  assert.doesNotMatch(
    publicTelegramDelivery,
    /user_alert_deliveries|user_delivery_channels|getEffectiveUserPlan/,
  );
  assert.match(cronRoute, /publicTelegramLimit/);
  assert.match(cronRoute, /publicTelegram: result\.publicTelegram/);
  assert.match(cronRoute, /telegramCampaigns: result\.telegramCampaigns/);
  assert.match(cronRoute, /telegramCampaignLimit/);
  assert.match(
    scheduler,
    /telegramCampaigns\?\.disabled \? undefined : telegramCampaigns\?\.error/,
  );
});

test("admin Telegram scheduler expires stale claims before any new provider work", () => {
  assert.match(adminTelegramDelivery, /expireAdminTelegramCampaignLeases/);
  assert.match(
    adminTelegramDelivery,
    /runDueAdminTelegramCampaigns[\s\S]*const expiredLeases = await expireAdminTelegramCampaignLeases\(50\);[\s\S]*const configuration = resolveDeliveryConfiguration\(transport\);/,
  );
  assert.match(adminTelegramDelivery, /expiredLeases/);
});

test("events persist an outbox row before any external channel processing", () => {
  assert.match(eventDelivery, /deliveryStatus: "queued"/);
  assert.match(
    eventDelivery,
    /candidate\.eligibleChannels\.map\([\s\S]*channel\.channel/,
  );
  assert.doesNotMatch(eventDelivery, /sendTelegramMessage|runDeliveryAdapters/);
});

test("queued delivery claims each channel and blocks uncertain Telegram retries", () => {
  assert.match(queuedDelivery, /claimAlertDeliveryChannelAttempt/);
  assert.match(queuedDelivery, /finishAlertDeliveryChannelAttempt/);
  assert.match(queuedDelivery, /status === "uncertain"/);
  assert.match(queuedDelivery, /automatic retry is blocked/);
  assert.match(queuedDelivery, /Web delivery is disabled/);
  assert.match(queuedDelivery, /ok: failed === 0 && inProgress === 0/);
  assert.match(
    queuedDelivery,
    /channels\.failedCount > 0 \|\| channels\.uncertain/,
  );
});

test("ticker and Market Discovery lanes recheck current centralized entitlements", () => {
  assert.match(deliveryEvaluation, /isTickerAlertCategoryAllowed\(context\.plan, event\.category\)/);
  assert.match(deliveryEvaluation, /isDiscoveryCategoryAllowed\(context\.plan, event\.category\)/);
  assert.doesNotMatch(deliveryEvaluation, /WATCHLIST_RISK_DISABLED/);
  assert.match(queuedDelivery, /getEffectiveUserPlan\(row\.user_id\)/);
  assert.match(queuedDelivery, /isDiscoveryCategoryAllowed\(plan, row\.category\)/);
  assert.match(queuedDelivery, /isTickerAlertCategoryAllowed\(plan, row\.category\)/);
  assert.match(queuedDelivery, /new Set\(getPlanLimits\(plan\)\.channels\)/);
});

test("tickerless alert event creates exactly one Discovery candidate", async () => {
  const evaluation = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies(),
  );

  assert.equal(evaluation.candidates.length, 1);
  assert.deepEqual(evaluation.skipped, []);
  assert.deepEqual(evaluation.candidates[0], {
    userId: "tickerless-user",
    plan: "pro",
    alertLane: "market_discovery",
    matchedTickers: [],
    eligibleChannels: [
      { channel: "web", connected: true, destination: undefined },
    ],
    scheduledFor: "2026-08-10T00:00:00.000Z",
    delayMinutes: 0,
    deliveryStatus: "sent",
  });
});

test("tickerless alert event never becomes a Watchlist candidate", async () => {
  assert.deepEqual(
    matchWatchedEventTickers([], new Set(["GOOG", "GOOGL"])),
    [],
  );

  const evaluation = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({
      watchlistTickers: ["GOOG", "GOOGL"],
    }),
  );

  assert.equal(evaluation.candidates.length, 1);
  assert.equal(evaluation.candidates[0]?.alertLane, "market_discovery");
  assert.deepEqual(evaluation.candidates[0]?.matchedTickers, []);
  assert.equal(
    evaluation.candidates.some((candidate) => candidate.alertLane === "watchlist"),
    false,
  );
});

test("tickerless Discovery respects preference and category selection", async () => {
  const discoveryDisabled = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({ discoveryEnabled: false }),
  );
  assert.deepEqual(discoveryDisabled.candidates, []);
  assert.equal(discoveryDisabled.skipped[0]?.reason, "DISCOVERY_DISABLED");

  const categoryDisabled = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({ discoveryCategories: [] }),
  );
  assert.deepEqual(categoryDisabled.candidates, []);
  assert.equal(
    categoryDisabled.skipped[0]?.reason,
    "DISCOVERY_CATEGORY_NOT_ACTIVE",
  );
});

test("tickerless Discovery preserves plan, channel, market-cap, and other filters", async () => {
  const planDisallowed = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({ plan: "free" }),
  );
  assert.deepEqual(planDisallowed.candidates, []);
  assert.equal(
    planDisallowed.skipped[0]?.reason,
    "DISCOVERY_CATEGORY_NOT_ACTIVE",
  );

  const noChannel = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({
      channels: [{ channel: "web", enabled: false }],
    }),
  );
  assert.deepEqual(noChannel.candidates, []);
  assert.equal(noChannel.skipped[0]?.reason, "NO_ENABLED_CHANNELS");

  const marketCapFiltered = await evaluateAlertDeliveryForEvent(
    tickerlessAlertEvent,
    createTickerlessEvaluationDependencies({ marketCapFilters: ["small"] }),
  );
  assert.deepEqual(marketCapFiltered.candidates, []);
  assert.equal(marketCapFiltered.skipped[0]?.reason, "MARKET_CAP_FILTERED");

  const otherCategory = await evaluateAlertDeliveryForEvent(
    { ...tickerlessAlertEvent, category: "other" },
    createTickerlessEvaluationDependencies(),
  );
  assert.deepEqual(otherCategory.candidates, []);
  assert.equal(
    otherCategory.skipped[0]?.reason,
    "DISCOVERY_CATEGORY_NOT_ACTIVE",
  );
});

test("only score-75-plus alert delivery levels reach the alert runner", () => {
  assert.match(
    secEventStore,
    /if \(score >= 75\) return "alert";[\s\S]*if \(score >= 50\) return "feed";[\s\S]*return "archive";/,
  );
  assert.match(eventDelivery, /if \(deliveryLevel !== "alert"\)/);
  assert.match(eventDelivery, /reason: "EVENT_NOT_ALERT_DELIVERY_LEVEL"/);
});

test("alert delivery applies stored market-cap preferences through the shared classifier", () => {
  assert.match(alertsConfig, /range: marketCapRangeLabels\.Mega/);
  assert.match(alertsConfig, /range: marketCapRangeLabels\.Micro/);
  assert.match(deliveryEvaluation, /market_cap_filters/);
  assert.match(deliveryEvaluation, /matchesAlertMarketCapFilters\(event\.metadata\?\.market_cap/);
  assert.match(deliveryEvaluation, /reason: "MARKET_CAP_FILTERED"/);
  assert.match(eventCli, /matchesAlertMarketCapFilters\(event\.marketCap/);
  assert.match(eventCli, /readStoredEventMarketCap\(metadata\)/);
});

test("CLI and scheduler helper paths use the same policy and alert-enabled ticker table", () => {
  assert.match(eventCli, /from "\.\.\/lib\/subscriptionPolicy\.ts"/);
  assert.match(eventCli, /isDiscoveryCategoryAllowed\(context\.plan, event\.category\)/);
  assert.match(eventCli, /isTickerAlertCategoryAllowed\(context\.plan, event\.category\)/);
  assert.match(eventCli, /fetchRows\("user_alert_tickers"/);
  assert.doesNotMatch(eventCli, /fetchRows\("watchlist_tickers"/);
  assert.match(queuedCli, /await runtime\.processQueuedDeliveries/);
  assert.match(queuedCli, /loadAlertDeliveryRuntime/);
  assert.match(queuedDelivery, /isDiscoveryCategoryAllowed\(plan, row\.category\)/);
  assert.match(queuedDelivery, /new Set\(getPlanLimits\(plan\)\.channels\)/);
});

test("header notifications use real unread counts and read mutations", () => {
  assert.match(headerMenu, /X-Unread-Count/);
  assert.match(headerMenu, /body: JSON\.stringify\(\{ id: alert\.id, read: true \}\)/);
  assert.match(headerMenu, /body: JSON\.stringify\(\{ all: true, read: true \}\)/);
  assert.match(headerMenu, /href="\/alerts"/);
  assert.match(deliveredRoute, /"X-Auth-State": "guest"/);
  assert.match(deliveredRoute, /getWebDeliveredAlertIdsForUser/);
  assert.match(webDeliveryVisibility, /sent_web_delivery_attempts\.status.*"eq\.sent"/);
  assert.match(webDeliveryVisibility, /delivered_channels\.cs\.\{web\}/);
});

test("Web visibility does not finalize or cancel Email retries", () => {
  assert.doesNotMatch(webDeliveryVisibility, /supabaseUpdate|finishAlertDeliveryChannelAttempt|next_retry_at/);
  assert.match(queuedDelivery, /claim\.attemptNumber < 3/);
  assert.match(queuedDelivery, /A bounded retry is scheduled/);
  assert.match(queuedDelivery, /claim\.status === "sent"/);
});

test("admin reuses Alerts operations and reports cron delivery outcomes", () => {
  assert.match(adminAlerts, /Recent cron runs/);
  assert.match(adminAlerts, /Channel attempts requiring review/);
  assert.match(adminAlerts, /run\.duplicates/);
  assert.match(adminAlerts, /run\.suppressed/);
});

test("only the alert delivery cron is added; source collection stays unscheduled", () => {
  const paths = (vercelConfig.crons || []).map((cron) => cron.path || "");
  assert.ok(paths.includes("/api/cron/alert-delivery"));
  assert.equal(
    paths.some((path) => /news|filing|sec|source/i.test(path)),
    false,
  );
});
