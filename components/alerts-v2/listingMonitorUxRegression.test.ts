import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const builder = read("components/alerts-v2/ListingMonitorDraftBuilder.tsx");
const builderStyles = read("components/alerts-v2/ListingMonitorDraftBuilder.module.css");
const alerts = read("components/alerts-v2/StockRadarAlertsV2.tsx");
const monitorPage = read("app/monitor/page.tsx");
const monitorStyles = read("app/monitor/page.module.css");

test("monitor landing keeps the prompt prominent and reuses the existing creation flow", () => {
  assert.match(monitorPage, /Tell Stock Radar what to watch\./);
  assert.match(monitorPage, /<ListingMonitorDraftBuilder \/>/);
  assert.match(builder, /What should Stock Radar watch\?/);
  assert.match(builder, /Build monitor/);
  assert.match(builder, /Create this monitor/);
  assert.equal((builder.match(/\/api\/monitors\/listing\/compile/g) ?? []).length, 1);
  assert.match(builderStyles, /\.promptForm textarea[\s\S]*min-height: 170px/);
  assert.match(monitorStyles, /width: min\(100%, 1120px\)/);
});

test("review and unsupported states use human language without developer copy", () => {
  for (const expected of [
    "Your monitor",
    "Review your monitor",
    "Some conditions need your attention.",
    "We can’t use these conditions yet",
    "Not supported yet",
    "Remove",
    "We can’t create this monitor yet. Remove the unsupported conditions or try another request.",
  ]) {
    assert.match(builder, new RegExp(escapeRegExp(expected)));
  }

  for (const removed of [
    "Requirements needing a decision",
    "Explicit confirmation required",
    "Abandon requirement",
    "Review mapped conditions",
    "Build draft preview",
    "Confirm and create monitor",
  ]) {
    assert.doesNotMatch(builder, new RegExp(escapeRegExp(removed)));
  }
});

test("Alerts entry links to the landing while preserving monitor management actions", () => {
  assert.match(alerts, /href="\/monitor">Open AI Monitor/);
  assert.match(alerts, /<ListingMonitorManagement \/>/);
  assert.match(builder, /Pause/);
  assert.match(builder, /Resume/);
  assert.match(builder, /Delete/);
  assert.match(builder, /Monitor alerts/);
  assert.match(builder, /method: "PATCH"/);
  assert.match(builder, /method: "DELETE"/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
