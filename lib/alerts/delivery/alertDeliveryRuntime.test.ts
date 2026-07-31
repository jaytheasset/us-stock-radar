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
const headerMenu = readProjectFile(
  "components/shell/AlertNotificationsMenu.tsx",
);
const deliveredRoute = readProjectFile("app/api/alerts/delivered/route.ts");
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

test("one scheduler lock covers event outbox, queued channels, and Calendar", () => {
  assert.match(scheduler, /acquireJobLock/);
  assert.match(scheduler, /await runAlertDeliveryBatch/);
  assert.match(scheduler, /await processQueuedDeliveries/);
  assert.match(scheduler, /await runCalendarAlertDelivery/);
  assert.ok(
    scheduler.indexOf("await runAlertDeliveryBatch") <
      scheduler.indexOf("await processQueuedDeliveries"),
  );
  assert.ok(
    scheduler.indexOf("await processQueuedDeliveries") <
      scheduler.indexOf("await runCalendarAlertDelivery"),
  );
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

test("header notifications use real unread counts and read mutations", () => {
  assert.match(headerMenu, /X-Unread-Count/);
  assert.match(headerMenu, /body: JSON\.stringify\(\{ id: alert\.id, read: true \}\)/);
  assert.match(headerMenu, /body: JSON\.stringify\(\{ all: true, read: true \}\)/);
  assert.match(headerMenu, /href="\/alerts"/);
  assert.match(deliveredRoute, /"X-Auth-State": "guest"/);
  assert.match(deliveredRoute, /delivery_status: "eq\.sent"/);
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
