import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("CLI and scheduler helper paths use the same policy and alert-enabled ticker table", () => {
  assert.match(eventCli, /from "\.\.\/lib\/subscriptionPolicy\.ts"/);
  assert.match(eventCli, /isDiscoveryCategoryAllowed\(context\.plan, event\.category\)/);
  assert.match(eventCli, /isTickerAlertCategoryAllowed\(context\.plan, event\.category\)/);
  assert.match(eventCli, /fetchRows\("user_alert_tickers"/);
  assert.doesNotMatch(eventCli, /fetchRows\("watchlist_tickers"/);
  assert.match(queuedCli, /isDiscoveryCategoryAllowed\(plan, category\)/);
  assert.match(queuedCli, /new Set\(getPlanLimits\(plan\)\.channels\)/);
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
