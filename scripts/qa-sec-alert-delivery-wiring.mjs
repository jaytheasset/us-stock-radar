#!/usr/bin/env node

import { readFileSync } from "node:fs";

const checks = [];

const ingest = readText("lib/secFilingAnalysisIngest.ts");
checks.push([
  "SEC filing ingest imports alert delivery runner",
  ingest.includes('from "@/lib/alerts/delivery/runAlertDeliveryForEvent"'),
]);
checks.push([
  "SEC filing ingest runs alert delivery after persistence",
  ingest.includes("const alertDelivery = await runSecFilingAlertDelivery(persistedEvent);"),
]);
checks.push([
  "SEC filing ingest returns alert delivery result",
  ingest.includes("alertDelivery,"),
]);
checks.push([
  "SEC filing alert delivery writes real deliveries",
  ingest.includes("dryRun: false") && ingest.includes("write: true"),
]);
checks.push([
  "SEC filing alert delivery only runs for alert rows",
  ingest.includes('stringValue(eventRow.delivery_level) !== "alert"'),
]);

const adapters = readText("lib/alerts/delivery/deliveryAdapters.ts");
const queued = readText("lib/alerts/delivery/processQueuedDeliveries.ts");
const batch = readText("lib/alerts/delivery/runAlertDeliveryBatch.ts");
const eventScript = readText("scripts/run-alert-delivery-for-event.mjs");
const batchScript = readText("scripts/run-alert-delivery-batch.mjs");
const queuedScript = readText("scripts/process-queued-alert-deliveries.mjs");

checks.push([
  "feed-level SEC filing persist does not call alert delivery",
  ingest.includes('stringValue(eventRow.delivery_level) !== "alert"') && ingest.includes("return null;"),
]);
checks.push([
  "archive-level SEC filing persist does not call alert delivery",
  ingest.includes('stringValue(eventRow.delivery_level) !== "alert"') && ingest.includes("return null;"),
]);
checks.push([
  "alert-level SEC filing persist keeps real alert delivery enabled",
  ingest.includes("runAlertDeliveryForEvent({") && ingest.includes("dryRun: false") && ingest.includes("write: true"),
]);
checks.push([
  "library alert batch fetches only alert-level events",
  batch.includes('delivery_level: "eq.alert"') && !batch.includes('delivery_level: "neq.archive"'),
]);
checks.push([
  "library alert batch skips non-alert events before delivery",
  batch.includes('event.deliveryLevel !== "alert"') && batch.includes("continue;"),
]);
checks.push([
  "library alert batch does not record non-alert run logs",
  batch.includes('event.deliveryLevel !== "alert"') &&
    batch.includes('supabaseUpsert("alert_delivery_event_runs"'),
]);
checks.push([
  "script alert batch fetches only alert-level events",
  batchScript.includes('delivery_level: "eq.alert"') && !batchScript.includes('delivery_level: "neq.archive"'),
]);
checks.push([
  "script alert batch skips non-alert events before delivery",
  batchScript.includes('event.deliveryLevel !== "alert"') && batchScript.includes("continue;"),
]);
checks.push([
  "script alert batch does not record non-alert run logs",
  batchScript.includes('event.deliveryLevel !== "alert"') &&
    batchScript.includes('supabaseRequest("POST", "alert_delivery_event_runs"'),
]);

for (const [label, source] of [
  ["immediate adapter", adapters],
  ["queued processor", queued],
  ["event delivery script", eventScript],
  ["queued delivery script", queuedScript],
]) {
  checks.push([
    `${label} keeps Telegram enabled by default`,
    !source.includes('ALERT_DELIVERY_SEND_TELEGRAM !== "true"'),
  ]);
  checks.push([
    `${label} allows explicit Telegram opt-out`,
    source.includes('ALERT_DELIVERY_SEND_TELEGRAM === "false"'),
  ]);
}

const failed = checks.filter(([, passed]) => !passed);
if (failed.length) {
  console.error("SEC alert delivery wiring QA failed:");
  for (const [label] of failed) console.error(`- ${label}`);
  process.exit(1);
}

console.log(`SEC alert delivery wiring QA passed (${checks.length} checks).`);

function readText(path) {
  return readFileSync(path, "utf8");
}
