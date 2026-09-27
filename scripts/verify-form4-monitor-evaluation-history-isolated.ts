import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consumeListingMonitorAlertsForEvent,
  createListingMonitorAlert,
  type ListingMonitorAlertConsumerDependencies,
  type ListingMonitorAlertWriteResult,
} from "../lib/monitor/listingMonitorAlertConsumer.ts";
import { recordForm4MonitorEvaluation } from "../lib/monitor/form4MonitorEvaluationHistory.ts";
import {
  buildForm4InsiderPurchaseConditions,
  FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  type Form4InsiderPurchaseSettings,
} from "../lib/monitor/form4InsiderPurchaseMonitor.ts";
import type { ListingMonitor } from "../lib/monitor/listingMonitorPersistence.ts";
import { readCurrentOwnershipFacts, type CurrentOwnershipReadResult } from "../lib/monitor/ownershipMonitorPersistence.ts";
import { buildOwnershipParserFactRows } from "../lib/monitor/ownershipParserFacts.ts";
import { supabaseSelect } from "../lib/supabase.ts";

type Row = Record<string, unknown>;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "lib/sources/sec/forms/ownership/fixtures");
const positiveEventId = "40000000-0000-4000-8000-000000000044";
const ownerId = "0f1b8961-d2e5-4ae3-90df-91747400b464";
const positiveMonitorId = "20000000-0000-4000-8000-000000000022";

assert.equal(new URL(process.env.SUPABASE_URL || "http://invalid").port, "57321");
const positive = await readCurrentOwnershipFacts(positiveEventId);
assert.equal(positive.status, "available");
assert.equal(positive.form, "form4");

const positiveSettings = settings("AGIG", "director", null);
const positiveMonitor = monitor(positiveMonitorId, positiveSettings, "2026-05-01T00:00:00.000Z");
const positiveFirst = await run(positiveEventId, positive, positiveMonitor, createListingMonitorAlert, "2026-05-23T15:00:01.000Z");
const positiveReplay = await run(positiveEventId, positive, positiveMonitor, createListingMonitorAlert, "2026-05-23T15:00:02.000Z");
assert.deepEqual([positiveFirst.createdCount, positiveReplay.existingCount], [1, 1]);
assert.equal(positiveFirst.evaluationHistoryWrites[0]?.status, "recorded");
assert.equal(positiveReplay.evaluationHistoryWrites[0]?.status, "recorded");

await run("41000000-0000-4000-8000-000000000001", positive, monitor("21000000-0000-4000-8000-000000000001", settings("AGIG", "director", 9000)), noAlert, "2026-05-23T15:01:00.000Z");
await run("41000000-0000-4000-8000-000000000002", positive, monitor("21000000-0000-4000-8000-000000000002", settings("AGIG", "officer", null)), noAlert, "2026-05-23T15:02:00.000Z");

const venu = currentFromFixture("source-venu-form4-section16-derivative-gift.json", "41000000-0000-4000-8000-000000000003");
await run(venu.eventId, venu, monitor("21000000-0000-4000-8000-000000000003", settings("VENU", "officer_or_director", null)), noAlert, "2026-05-23T15:03:00.000Z");

const uwmc = currentFromFixture("source-uwmc-form4-multi-owner-10b5-1-conversion.json", "41000000-0000-4000-8000-000000000004");
await run(uwmc.eventId, uwmc, monitor("21000000-0000-4000-8000-000000000004", settings("UWMC", "officer_or_director", null)), noAlert, "2026-05-23T15:04:00.000Z");

const unresolved = {
  ...structuredClone(positive),
  rows: positive.rows.map((row) => ({
    ...row,
    provenance: { ...(row.provenance as Row), reporting_owner_scope: "filing_level_unattributed_owner_set" },
  })),
  context: undefined,
  contextEligibility: undefined,
} as Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }>;
await run("41000000-0000-4000-8000-000000000005", unresolved, monitor("21000000-0000-4000-8000-000000000005", positiveSettings), noAlert, "2026-05-23T15:05:00.000Z");

await run("41000000-0000-4000-8000-000000000006", positive, monitor("21000000-0000-4000-8000-000000000006", positiveSettings, "2026-05-24T00:00:00.000Z"), noAlert, "2026-05-24T00:01:00.000Z");
await run("41000000-0000-4000-8000-000000000007", positive, monitor("21000000-0000-4000-8000-000000000007", positiveSettings), async (input) => ({ status: "failed", monitorId: input.monitorId, error: "isolated review injected alert write failure" }), "2026-05-23T15:07:00.000Z");

const records = await readHistory();
assert.equal(records.length, 9);
const outcomes = records.map((row) => [row.evaluation_reason_code, row.notification_status, row.notification_reason_code]);
for (const expected of [
  ["all_conditions_match", "created", "alert_created"],
  ["all_conditions_match", "existing", "duplicate_alert_existing"],
  ["minimum_shares_not_met", "not_created", "evaluation_not_match"],
  ["reporting_owner_role_not_met", "not_created", "evaluation_not_match"],
  ["nonpurchase_transaction", "not_created", "evaluation_not_match"],
  ["ownership_reporter_attribution_unavailable", "not_created", "evaluation_not_match"],
  ["monitor_activation_not_met", "not_created", "evaluation_not_match"],
  ["all_conditions_match", "failed", "alert_write_failed"],
]) assert.ok(outcomes.some((outcome) => JSON.stringify(outcome) === JSON.stringify(expected)), JSON.stringify(expected));

const created = records.find((row) => row.notification_status === "created")!;
const replay = records.find((row) => row.notification_status === "existing")!;
assert.equal(created.alert_id, replay.alert_id);
assert.ok(created.alert_id);
const alert = await supabaseSelect("user_alert_deliveries", { select: "id,listing_match_evidence", id: `eq.${created.alert_id}`, limit: "1" });
assert.equal(alert.ok, true);
assert.equal(((alert.data as Row[])[0].listing_match_evidence as Row).matches instanceof Array, true);
assert.equal((((alert.data as Row[])[0].listing_match_evidence as Row).matches as unknown[]).length, 2);

console.log(JSON.stringify({ status: "PASS", records: records.length, alertId: created.alert_id, providerCalls: 0 }));

async function run(eventId: string, current: CurrentOwnershipReadResult, selectedMonitor: ListingMonitor, createAlert: ListingMonitorAlertConsumerDependencies["createAlert"], at: string) {
  return consumeListingMonitorAlertsForEvent({ eventId }, {
    readOwnershipFacts: async () => current,
    listActiveMonitors: async () => ({ monitors: [selectedMonitor], diagnostics: [] }),
    createAlert,
    recordForm4Evaluation: recordForm4MonitorEvaluation,
    now: () => new Date(at),
  });
}

async function noAlert(input: Parameters<ListingMonitorAlertConsumerDependencies["createAlert"]>[0]): Promise<ListingMonitorAlertWriteResult> {
  throw new Error(`Unexpected alert write for ${input.monitorId}`);
}

function settings(ticker: string, role: Form4InsiderPurchaseSettings["role"], minimumShares: number | null): Form4InsiderPurchaseSettings {
  return { target: { scope: "ticker", ticker }, role, minimumShares };
}

function monitor(id: string, monitorSettings: Form4InsiderPurchaseSettings, createdAt = "2026-05-01T00:00:00.000Z"): ListingMonitor {
  return { id, userId: ownerId, domain: "listing", kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND, conditions: buildForm4InsiderPurchaseConditions(monitorSettings), form4PurchaseSettings: monitorSettings, isActive: true, createdAt, updatedAt: createdAt };
}

function currentFromFixture(filename: string, eventId: string): Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }> {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const sourceText = String(fixture.filingText), accessionNumber = String(fixture.accessionNumber), sourceUrl = String((fixture.source as Row).url);
  const ticker = xmlValue(sourceText, "issuerTradingSymbol"), issuerCik = xmlValue(sourceText, "issuerCik"), formType = String(fixture.formType);
  const rawItemId = crypto.randomUUID();
  const built = buildOwnershipParserFactRows({ eventId, symbol: ticker, rawItem: { id: rawItemId, source_unique_id: accessionNumber, raw_payload: { form_type: formType, accession_number: accessionNumber, cik: issuerCik, ownership_issuer_cik: issuerCik, ownership_issuer_trading_symbol: ticker, ticker, ownership_source_text: sourceText, ownership_source_url: sourceUrl, ownership_source_format: "ownership_xml", ownership_source_text_truncated: false } } });
  return { status: "available", form: "form4", rows: built.form4Transactions as never, eventId, rawItemId, sourceExecutionId: eventId, accessionNumber, parserVersion: String(built.parserOutput.parserVersion), persistedAt: "2026-05-23T15:00:00.000Z", filingForm: formType as "4" | "4/A", filedAt: "2026-05-23T15:00:00.000Z" };
}

function xmlValue(sourceText: string, localName: string) { const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`; return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*</${tag}>`, "i"))?.[1]?.trim() ?? ""; }
async function readHistory() { const result = await supabaseSelect("listing_monitor_evaluation_records", { select: "id,event_id,alert_id,evaluation_reason_code,notification_status,notification_reason_code", order: "evaluated_at.asc", limit: "100" }); assert.equal(result.ok, true); return result.data as Row[]; }
