import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateSc13Monitor } from "../sc13MonitorMatcher.ts";
import type { Sc13IssuerCurrentStateRead } from "../sec-sc13-xml/currentState.ts";
import {
  validateCanonicalSc13Conditions,
  validateSc13MonitorTarget,
  type CanonicalSc13MonitorCondition,
  type Sc13Monitor,
  type Sc13SpecificMonitorTarget,
} from "./sc13MonitorPersistence.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../../${specifier.slice(2)}`, import.meta.url);
      const file = new URL(`${base.href}.ts`);
      const index = new URL(`${base.href}/index.ts`);
      return nextResolve(existsSync(fileURLToPath(file)) ? file.href : index.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { consumeSc13MonitorAlertsForIssuer } = await import("./sc13MonitorAlertConsumer.ts");

const USER_ID = "98000000-0000-4000-8000-000000000001";
const MONITOR_ID = "98000000-0000-4000-8000-000000000002";
const ISSUER = "0002131524";
const REPORTER = "0001055951";
const ROOT = "0000947871-26-000814";
const HEAD = "0000947871-26-000860";

test("SC13 registry persistence accepts only six exact-decimal latest-saved conditions and exact target identity", () => {
  assert.equal(validateSc13MonitorTarget({ issuerCik: "2131524", reportingPersonCik: "1055951", securityClass: " Common  Stock ", cusips: ["10567x101"] }).ok, true);
  assert.equal(validateSc13MonitorTarget({ issuerCik: ISSUER, reportingPersonCik: REPORTER, securityClass: "COMMON STOCK", cusips: ["bad"] }).ok, false);
  const all = conditions([
    ["sc13.aggregate_owned", "12175159.00"], ["sc13.percent_of_class", "13.5"],
    ["sc13.sole_voting", "0"], ["sc13.shared_voting", "12175159.00"],
    ["sc13.sole_dispositive", "273333.00"], ["sc13.shared_dispositive", "11901826.00"],
  ]);
  assert.equal(validateCanonicalSc13Conditions(all).ok, true);
  assert.equal(validateCanonicalSc13Conditions([{ key: "sc13.aggregate_owned", operator: "gt", value: 1 }]).ok, false);
  assert.equal(validateCanonicalSc13Conditions([{ key: "sc13.aggregate_owned", operator: "gt", value: "-1" }]).ok, false);
  assert.equal(validateCanonicalSc13Conditions([{ key: "sc13.percent_of_class", operator: "lte", value: "100.000000000000000001" }]).ok, false);
  assert.equal(validateCanonicalSc13Conditions([{ key: "sc13.percent_of_class", operator: "eq", value: "0" }]).ok, true);
});

test("all six conditions use one exact reporter row and retain decimal precision beyond Number", () => {
  const monitor = makeMonitor(conditions([
    ["sc13.aggregate_owned", "9007199254740993.010"],
    ["sc13.percent_of_class", "13.5"],
    ["sc13.sole_voting", "0"],
    ["sc13.shared_voting", "11901826.00"],
    ["sc13.sole_dispositive", "273333.00"],
    ["sc13.shared_dispositive", "11901826.00"],
  ]));
  const state = availableState([{ cik: REPORTER, values: values({ aggregateAmountOwnedRaw: "9007199254740993.010" }) }]);
  const result = evaluateSc13Monitor(state, monitor);
  assert.equal(result.status, "match", JSON.stringify(result));
  assert.equal(result.evidence?.headAccessionNumber, HEAD);
  assert.equal(result.evidence?.scope, "complete_stored_history_not_sec_global");
  assert.equal(result.evidence?.meaning, "latest_saved_filing_value_not_realtime_ownership");
  assert.ok(result.evidence?.conditions.every((row) => row.sourceAccessionNumber === HEAD));
});

test("zero is evaluated while null current stays ineligible and lastReported is never substituted", () => {
  const zero = evaluateSc13Monitor(availableState([{ cik: REPORTER, values: values({ soleVotingPowerRaw: "0" }) }]), makeMonitor(conditions([["sc13.sole_voting", "0"]])));
  assert.equal(zero.status, "match");
  const state = availableState([{ cik: REPORTER, values: values({ soleVotingPowerRaw: null }) }]);
  const position = state.status === "available" ? state.lineage.positions[0] : null;
  if (!position || position.status !== "available_stored_history") throw new Error("position required");
  (position.currentReporters[0]!.values as Record<string, unknown>).soleVotingPowerRaw = {
    status: "unresolved", valueRaw: null, sourceAccessionNumber: null,
    reason: "current_filing_field_missing", lastReported: { valueRaw: "0", sourceAccessionNumber: ROOT },
  };
  const unresolved = evaluateSc13Monitor(state, makeMonitor(conditions([["sc13.sole_voting", "0"]])));
  assert.equal(unresolved.status, "ineligible");
  assert.equal(unresolved.reasonCode, "current_value_unresolved");
});

test("different-holder position is ignored, but two positions for the target reporter are ambiguous", () => {
  const target = makeMonitor(conditions([["sc13.aggregate_owned", "12175159.00"]]));
  const otherPosition = position("other-position", "0001920574", "500");
  const oneTarget = availableState([{ cik: REPORTER, values: values({}) }], [otherPosition]);
  assert.equal(evaluateSc13Monitor(oneTarget, target).status, "match");
  const duplicateTarget = position("duplicate-target", REPORTER, "12175159.00");
  const ambiguous = availableState([{ cik: REPORTER, values: values({}) }], [duplicateTarget]);
  assert.equal(evaluateSc13Monitor(ambiguous, target).reasonCode, "position_identity_ambiguous");
});

test("conditions never mix reporters or positions and all identity mismatches fail closed", () => {
  const state = availableState([
    { cik: REPORTER, values: values({ aggregateAmountOwnedRaw: "12175159.00", percentOfClassRaw: "1" }) },
    { cik: "0001920574", values: values({ aggregateAmountOwnedRaw: "1", percentOfClassRaw: "13.5" }) },
  ]);
  const monitor = makeMonitor(conditions([["sc13.aggregate_owned", "12175159.00"], ["sc13.percent_of_class", "13.5"]]));
  assert.equal(evaluateSc13Monitor(state, monitor).status, "no_match");
  const wrongReporter = { ...monitor, target: { ...monitor.target, reportingPersonCik: "0001808744" } };
  assert.equal(evaluateSc13Monitor(state, wrongReporter).reasonCode, "reporter_identity_mismatch");
  const wrongClass = { ...monitor, target: { ...monitor.target, securityClass: "PREFERRED STOCK" } };
  assert.equal(evaluateSc13Monitor(state, wrongClass).reasonCode, "position_identity_mismatch");
  const unresolved: Sc13IssuerCurrentStateRead = { status: "unavailable", issuerCik: ISSUER, historyComplete: false, reason: "history_count_changed" };
  assert.equal(evaluateSc13Monitor(unresolved, monitor).reasonCode, "reader_not_ready");
});

test("consumer exposes retryable partial failure and 12 concurrent/replay calls dedupe to one logical Alert", async () => {
  const monitor = makeMonitor(conditions([["sc13.aggregate_owned", "gt", "0"] as never]));
  const state = availableState([{ cik: REPORTER, values: values({}) }]);
  const keys = new Set<string>();
  const dependencies = {
    readCurrentState: async () => state,
    listActiveMonitors: async () => ({ monitors: [monitor], diagnostics: [] }),
    createAlert: async ({ evidence }: { evidence: { rootAccessionNumber: string; positionKey: string; reportingPersonCik: string } }) => {
      const key = `${monitor.id}:${evidence.rootAccessionNumber}:${evidence.positionKey}:${evidence.reportingPersonCik}`;
      if (keys.has(key)) return { status: "existing" as const, monitorId: monitor.id };
      keys.add(key);
      return { status: "created" as const, monitorId: monitor.id, alertId: "98000000-0000-4000-8000-000000000003" };
    },
    now: () => new Date("2026-09-11T00:00:00Z"),
  };
  const results = await Promise.all(Array.from({ length: 12 }, () => consumeSc13MonitorAlertsForIssuer({ issuerCik: ISSUER }, dependencies as never)));
  assert.equal(results.reduce((sum, item) => sum + item.createdCount, 0), 1);
  assert.equal(results.reduce((sum, item) => sum + item.existingCount, 0), 11);
  assert.equal(keys.size, 1);
  const failed = await consumeSc13MonitorAlertsForIssuer({ issuerCik: ISSUER }, { ...dependencies, createAlert: async () => ({ status: "failed", monitorId: monitor.id, error: "retry me" }) } as never);
  assert.equal(failed.status, "partial_failure");
  assert.equal(failed.failedCount, 1);
});

function makeMonitor(monitorConditions: readonly CanonicalSc13MonitorCondition[]): Sc13Monitor & { target: Sc13SpecificMonitorTarget } {
  return {
    id: MONITOR_ID, userId: USER_ID, domain: "sc13",
    target: { issuerCik: ISSUER, reportingPersonCik: REPORTER, securityClass: "COMMON STOCK", cusips: ["10567X101"] },
    conditions: monitorConditions, isActive: true,
    createdAt: "2026-09-11T00:00:00Z", updatedAt: "2026-09-11T00:00:00Z",
  };
}
function conditions(rows: readonly (readonly [string, string] | readonly [string, string, string])[]): CanonicalSc13MonitorCondition[] {
  return rows.map((row) => ({ key: row[0], operator: (row.length === 3 ? row[1] : "eq") as CanonicalSc13MonitorCondition["operator"], value: row.length === 3 ? row[2] : row[1] }));
}
function values(overrides: Partial<Record<string, string | null>>) {
  return { soleVotingPowerRaw: "0", sharedVotingPowerRaw: "11901826.00", soleDispositivePowerRaw: "273333.00", sharedDispositivePowerRaw: "11901826.00", aggregateAmountOwnedRaw: "12175159.00", percentOfClassRaw: "13.5", ...overrides };
}
function position(positionKey: string, cik: string, aggregate: string) {
  const state = availableState([{ cik, values: values({ aggregateAmountOwnedRaw: aggregate }) }]);
  return { ...state.lineage.positions[0]!, positionKey };
}
function availableState(reporters: readonly { cik: string; values: Record<string, string | null> }[], additionalPositions: readonly unknown[] = []): Extract<Sc13IssuerCurrentStateRead, { status: "available" }> {
  const basePosition = {
    status: "available_stored_history" as const, scope: "complete_stored_history_not_sec_global" as const,
    version: "sec_sc13_lineage_v1" as const, positionKey: "target-position", issuerCik: ISSUER,
    formFamily: "SCHEDULE 13G" as const, securityClassRaw: "Common Stock", cusipsRaw: ["10567X101"],
    rootAccessionNumber: ROOT, headAccessionNumber: HEAD, orderedAccessions: [ROOT, HEAD], issues: [] as const,
    currentReporters: reporters.map(({ cik, values: rawValues }) => ({
      reportingPersonCik: cik, reportingPersonNameRaw: `Reporter ${cik}`, sourceAccessionNumber: HEAD,
      values: Object.fromEntries(Object.entries(rawValues).map(([key, value]) => [key, value === null
        ? { status: "unresolved", valueRaw: null, sourceAccessionNumber: null, reason: "current_filing_field_missing", lastReported: null }
        : { status: "available", valueRaw: value, sourceAccessionNumber: HEAD, lastReported: { valueRaw: value, sourceAccessionNumber: HEAD } }])) as never,
    })),
  };
  return {
    status: "available", issuerCik: ISSUER, historyComplete: true, history: [] as never,
    lineage: { version: "sec_sc13_lineage_v1", scope: "complete_stored_history_not_sec_global", secGlobalCompleteness: "not_verified", links: [], positions: [basePosition, ...additionalPositions] as never },
  };
}
