import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const builder = read("components/alerts-v2/ListingMonitorDraftBuilder.tsx");
const builderStyles = read("components/alerts-v2/ListingMonitorDraftBuilder.module.css");
const monitorPresets = read("lib/monitor/monitorPresets.ts");
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
  assert.equal((builder.match(/\/api\/monitors\/listing\/confirm/g) ?? []).length, 1);
  assert.match(builderStyles, /\.promptForm textarea[\s\S]*min-height: 170px/);
  assert.match(monitorStyles, /width: min\(100%, 1120px\)/);
});

test("AI Draft narrowing confirmation is human-readable and blocks Create until resolved", () => {
  for (const expected of [
    "AI suggested an additional filter",
    "Confirm this filter",
    "Confirm or remove every suggested filter before creating this monitor.",
  ]) {
    assert.match(builder, new RegExp(escapeRegExp(expected)));
  }
  assert.match(builder, /proposal\.choices\.map/);
  assert.match(builder, /disabled=\{action !== "idle"\}/);
  assert.doesNotMatch(builder, />\s*(?:announced|action_stage|corporate_action\.action_stage)\s*</);
  assert.match(builderStyles, /\.confirmationActions[\s\S]*flex-wrap: wrap/);
  assert.match(builderStyles, /@media[^}]*max-width[\s\S]*\.confirmationActions[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
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

test("default condition review is concise and hides the Registry-wide assembler", () => {
  assert.match(builder, /className=\{styles\.conditionSummary\}/);
  assert.match(builder, /aria-label=\{`Edit \$\{preview\.label\}`\}/);
  assert.match(builder, /aria-label=\{`Remove \$\{preview\.label\}`\}/);
  assert.match(builder, /condition\.key === "market\.price" \? "Price is" : "Comparison"/);
  assert.match(builder, /condition\.key === "corporate_action\.event_kind" \|\| condition\.key === "listing\.event_kind"/);
  assert.match(builder, /condition\.key !== "listing\.compliance_deadline"/);
  assert.doesNotMatch(builder, />Watch for</);
  assert.doesNotMatch(builder, />Match</);
  assert.doesNotMatch(builder, /EDITOR_CATALOG\.map\(\(item\) => <option/);
  assert.doesNotMatch(builder, /changeListingMonitorDraftConditionKey/);
});

test("monitor information architecture separates curated recommendations and add-condition domains", () => {
  for (const expected of [
    "Recommended monitors",
    "recommendations",
    "+ Add condition",
  ]) {
    assert.match(builder, new RegExp(escapeRegExp(expected)));
  }
  for (const expected of [
    "Common",
    "Corporate Actions",
    "Listing Risk",
    "Price",
    "Reverse stock split",
    "Listing deficiency",
    "Compliance deadline",
    "Delisting determination",
    "Trading suspension",
  ]) {
    assert.match(monitorPresets, new RegExp(escapeRegExp(expected)));
  }
  assert.match(builder, /MONITOR_ADD_CONDITION_GROUPS\.map/);
  assert.match(builder, /addListingMonitorDraftCondition/);
  assert.doesNotMatch(builder, /Popular monitors/);
  assert.doesNotMatch(builder, /4 starting points/);
  assert.doesNotMatch(builder, /Reverse split \+ listing risk/);
  assert.match(builderStyles, /\.presetGrid[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(builderStyles, /\.addConditionPanel[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(builderStyles, /@media \(max-width: 600px\)[\s\S]*\.addConditionPanel[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("created summary uses the stored monitor returned by Create and clears the submitted draft", () => {
  assert.match(builder, /const monitor = readMonitor\(payload\?\.data\)/);
  assert.match(builder, /setCreatedMonitor\(monitor\)/);
  assert.match(builder, /setDraft\(null\)/);
  assert.match(builder, /setReview\(null\)/);
  assert.match(builder, /createdMonitor \? <CreatedMonitorSummary monitor=\{createdMonitor\}/);
  assert.match(builder, /monitor\.conditions\.map/);
  assert.match(builder, /monitor\.isActive \? "Active" : "Paused"/);
  assert.match(builder, /This is what Stock Radar saved and is watching now\./);
  assert.match(builder, /href="\/alerts">Manage monitors/);
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
