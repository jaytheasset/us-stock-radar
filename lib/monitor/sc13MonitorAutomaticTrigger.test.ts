import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { Sc13MonitorAlertConsumerResult } from "./sc13MonitorAlertConsumer.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier === "./sc13MonitorAlertConsumer.ts") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20async%20function%20consumeSc13MonitorAlertsForIssuer()%7Bthrow%20new%20Error('unexpected%20default%20consumer')%7D",
      };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runSc13MonitorAutomaticTrigger } = await import("./sc13MonitorAutomaticTrigger.ts");

const RAW_ITEM_ID = "a1000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "a1000000-0000-4000-8000-000000000002";
const ISSUER_CIK = "0002131524";
const SOURCE_SHA = "a".repeat(64);

test("canonical identity runs the existing consumer and records completed independently", async () => {
  const calls: string[] = [];
  const result = await runSc13MonitorAutomaticTrigger(input(), {
    begin: async (value) => {
      assert.deepEqual(value, input());
      calls.push("begin");
      return { status: "started", attempt: { attemptId: ATTEMPT_ID, attemptGeneration: 4 } };
    },
    consume: async ({ issuerCik }) => {
      assert.equal(issuerCik, ISSUER_CIK);
      calls.push("consume");
      return completedConsumer();
    },
    finish: async (value) => {
      calls.push(`finish:${value.status}`);
      assert.deepEqual(value.attempt, { attemptId: ATTEMPT_ID, attemptGeneration: 4 });
      assert.equal(value.result.consumer_status, "completed");
      return "updated";
    },
    reportFailure: () => assert.fail("unexpected failure report"),
  });
  assert.deepEqual(calls, ["begin", "consume", "finish:completed"]);
  assert.equal(result.status, "completed");
  assert.equal(result.stateRecorded, true);
});

for (const failure of [
  { name: "reader unavailable", consumer: failedConsumer("failed", "reader_unavailable") },
  { name: "partial Alert write", consumer: failedConsumer("partial_failure") },
] as const) {
  test(`${failure.name} records a retryable failed state without throwing`, async () => {
    const finishes: unknown[] = [];
    const result = await runSc13MonitorAutomaticTrigger(input(), {
      begin: async () => ({ status: "started", attempt: { attemptId: ATTEMPT_ID, attemptGeneration: 2 } }),
      consume: async () => failure.consumer,
      finish: async (value) => { finishes.push(value); return "updated"; },
      reportFailure: () => undefined,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.stateRecorded, true);
    assert.equal((finishes[0] as { status: string }).status, "failed");
  });
}

test("consumer exception and failure-report exception stay inside the XML success boundary", async () => {
  const result = await runSc13MonitorAutomaticTrigger(input(), {
    begin: async () => ({ status: "started", attempt: { attemptId: ATTEMPT_ID, attemptGeneration: 3 } }),
    consume: async () => { throw new Error("intentional monitor exception"); },
    finish: async ({ status, error }) => {
      assert.equal(status, "failed");
      assert.match(error || "", /intentional monitor exception/);
      return "updated";
    },
    reportFailure: () => { throw new Error("intentional reporter exception"); },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stateRecorded, true);
});

test("state recording failures remain visible and the consumer still runs for replay retry", async () => {
  let consumes = 0;
  const beginFailure = await runSc13MonitorAutomaticTrigger(input(), {
    begin: async () => { throw new Error("intentional begin failure"); },
    consume: async () => { consumes += 1; return completedConsumer(); },
    finish: async () => assert.fail("finish cannot run without an attempt"),
    reportFailure: () => undefined,
  });
  assert.equal(beginFailure.status, "failed");
  assert.equal(beginFailure.stateRecorded, false);
  assert.equal(consumes, 1);

  const finishFailure = await runSc13MonitorAutomaticTrigger(input(), {
    begin: async () => ({ status: "started", attempt: { attemptId: ATTEMPT_ID, attemptGeneration: 5 } }),
    consume: async () => { consumes += 1; return completedConsumer(); },
    finish: async () => { throw new Error("intentional finish failure"); },
    reportFailure: () => undefined,
  });
  assert.equal(finishFailure.status, "failed");
  assert.equal(finishFailure.stateRecorded, false);
  assert.equal(consumes, 2);
});

test("canonical identity rejection fails closed before monitor reads", async () => {
  let consumes = 0;
  const result = await runSc13MonitorAutomaticTrigger(input(), {
    begin: async () => ({ status: "rejected", error: "SC13 Monitor pending state write rejected: canonical_identity_mismatch" }),
    consume: async () => { consumes += 1; return completedConsumer(); },
    finish: async () => "updated",
    reportFailure: () => undefined,
  });
  assert.equal(result.status, "failed");
  assert.equal(consumes, 0);
});

function input() { return { rawItemId: RAW_ITEM_ID, issuerCik: ISSUER_CIK, sourceSha256: SOURCE_SHA }; }
function completedConsumer(): Sc13MonitorAlertConsumerResult {
  return { version: "sc13_monitor_alert_consumer_v1", status: "completed", issuerCik: ISSUER_CIK, readerStatus: "available", monitorCount: 1, diagnostics: [], evaluations: [], writes: [], createdCount: 1, existingCount: 0, failedCount: 0 };
}
function failedConsumer(status: "failed" | "partial_failure", readerReason?: string): Sc13MonitorAlertConsumerResult {
  return { ...completedConsumer(), status, readerStatus: status === "failed" ? "unavailable" : "available", ...(readerReason ? { readerReason } : {}), createdCount: 0, failedCount: status === "partial_failure" ? 1 : 0 };
}
