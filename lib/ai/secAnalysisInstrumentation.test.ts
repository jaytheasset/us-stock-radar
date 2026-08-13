import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runWithSecAnalysisInstrumentation,
  traceSecAnalysis,
} from "./secAnalysisInstrumentation.ts";

type LogEntry = Record<string, unknown>;

test("T1 keeps one correlation ID across every stage in a request", async () => {
  const logs: LogEntry[] = [];
  await runWithSecAnalysisInstrumentation(
    {
      requestId: "sec-request-t1",
      accession: "0001493152-26-004150",
      force: true,
      suppressAlerts: true,
    },
    async () => {
      traceSecAnalysis("raw_lookup_start");
      traceSecAnalysis("source_ready");
      traceSecAnalysis("primary_attempt_start", {
        model: "gemini-2.5-flash-lite",
        attempt: 1,
        input_chars: 1200,
      });
      return { ok: true };
    },
    quietDependencies(logs),
  );

  assert.ok(logs.length >= 5);
  assert.deepEqual(new Set(logs.map((entry) => entry.request_id)), new Set(["sec-request-t1"]));
  assert.deepEqual(
    new Set(logs.map((entry) => entry.accession)),
    new Set(["0001493152-26-004150"]),
  );
});

test("T2 a first-attempt success emits no second or third attempt", async () => {
  const logs: LogEntry[] = [];
  await runWithSecAnalysisInstrumentation(
    requestInput("sec-request-t2"),
    async () => {
      emitProviderAttempt("primary", 1, "gemini-2.5-flash-lite", "success");
      return { ok: true };
    },
    quietDependencies(logs),
  );

  const starts = logs.filter((entry) => entry.stage === "primary_attempt_start");
  assert.deepEqual(starts.map((entry) => [entry.attempt, entry.model]), [
    [1, "gemini-2.5-flash-lite"],
  ]);
});

test("T3 retry fixture records lite, lite, then flash physical attempts in order", async () => {
  const logs: LogEntry[] = [];
  await runWithSecAnalysisInstrumentation(
    requestInput("sec-request-t3"),
    async () => {
      emitProviderAttempt("router", 1, "gemini-2.5-flash-lite", "error");
      emitProviderAttempt("router", 2, "gemini-2.5-flash-lite", "error");
      emitProviderAttempt("router", 3, "gemini-2.5-flash", "success");
      return { ok: true };
    },
    quietDependencies(logs),
  );

  const starts = logs.filter((entry) => entry.stage === "router_attempt_start");
  assert.deepEqual(starts.map((entry) => [entry.attempt, entry.model]), [
    [1, "gemini-2.5-flash-lite"],
    [2, "gemini-2.5-flash-lite"],
    [3, "gemini-2.5-flash"],
  ]);
});

test("T4 instrumentation sink failure does not change the semantic result", async () => {
  const semanticResult = { ok: true, event_type: "listing_risk", score: 75 };
  const result = await runWithSecAnalysisInstrumentation(
    requestInput("sec-request-t4"),
    async () => {
      traceSecAnalysis("primary_validation_start");
      traceSecAnalysis("primary_validation_end", { status: "success" });
      return semanticResult;
    },
    {
      sink: () => {
        throw new Error("telemetry unavailable");
      },
      setInterval: (() => ({ unref() {} })) as never,
      clearInterval: (() => undefined) as never,
    },
  );

  assert.equal(result, semanticResult);
});

test("T5 log payload allowlist excludes secrets and full prompt or source text", async () => {
  const logs: LogEntry[] = [];
  await runWithSecAnalysisInstrumentation(
    requestInput("sec-request-t5"),
    async () => {
      traceSecAnalysis("primary_attempt_start", {
        model: "gemini-2.5-flash-lite",
        attempt: 1,
        input_chars: 5000,
        api_key: "secret-api-key",
        authorization: "Bearer secret",
        full_prompt: "private prompt",
        source_text: "private filing source",
      } as never);
      return { ok: true };
    },
    quietDependencies(logs),
  );

  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /secret-api-key|Bearer secret|private prompt|private filing source/);
  assert.doesNotMatch(serialized, /api_key|authorization|full_prompt|source_text/);
  assert.match(serialized, /"input_chars":5000/);
});

test("T6 event-loop observer and abort listener are cleaned up", async () => {
  const logs: LogEntry[] = [];
  const controller = new AbortController();
  let timerClears = 0;
  let scheduledCallback: (() => void) | null = null;

  await runWithSecAnalysisInstrumentation(
    { ...requestInput("sec-request-t6"), signal: controller.signal },
    async () => {
      controller.abort();
      scheduledCallback?.();
      return { ok: true };
    },
    {
      sink: (entry) => logs.push(entry),
      monotonicNow: monotonicClock(),
      timestampNow: () => "2026-08-13T00:00:00.000Z",
      setInterval: ((callback: () => void) => {
        scheduledCallback = callback;
        return { unref() {} };
      }) as never,
      clearInterval: (() => {
        timerClears += 1;
      }) as never,
    },
  );

  assert.equal(timerClears, 1);
  assert.equal(logs.filter((entry) => entry.stage === "client_disconnected").length, 1);
  assert.equal(logs.filter((entry) => entry.stage === "event_loop_lag").length, 1);
});

test("production wiring preserves the physical model sequence and large execution boundaries", () => {
  const preview = readFileSync("lib/ai/secFilingAnalysisPreview.ts", "utf8");
  const geminiAttempts = preview.slice(preview.indexOf("async function runGeminiJsonPromptAttempts"));
  const ingest = readFileSync("lib/secFilingAnalysisIngest.ts", "utf8");
  const route = readFileSync("app/api/sources/sec/analyze/route.ts", "utf8");

  assert.match(preview, /\[\s*llmConfig\.model,\s*llmConfig\.model,\s*llmConfig\.fallbackModel,\s*\]/);
  assert.match(preview, /beginSecAnalysisSpan\(attemptStages\.start, attemptFields\)/);
  assert.ok(
    geminiAttempts.indexOf('traceSecAnalysis("provider_headers_received"') <
      geminiAttempts.indexOf("await response.json()"),
  );
  assert.ok(
    geminiAttempts.indexOf("await response.json()") <
      geminiAttempts.indexOf('traceSecAnalysis("provider_body_parsed"'),
  );
  assert.match(preview, /beginSecAnalysisSpan\("primary_validation_start"/);
  assert.match(ingest, /"raw_lookup_start",\s*"raw_lookup_end"/);
  assert.match(ingest, /"persistence_start",\s*"persistence_end"/);
  assert.match(ingest, /beginSecAnalysisSpan\("listing_fanout_start"/);
  assert.match(route, /runWithSecAnalysisInstrumentation/);
  assert.match(route, /signal:\s*request\.signal/);
});

function emitProviderAttempt(
  phase: "router" | "primary",
  attempt: number,
  model: string,
  status: "success" | "error",
) {
  const prefix = phase === "router" ? "router" : "primary";
  traceSecAnalysis(`${prefix}_attempt_start`, {
    provider_phase: phase,
    attempt,
    model,
    input_chars: 1000,
    status: "start",
  });
  traceSecAnalysis(`${prefix}_attempt_end`, {
    provider_phase: phase,
    attempt,
    model,
    status,
    http_status: status === "success" ? 200 : 503,
    retryable: status === "error",
  });
}

function requestInput(requestId: string) {
  return {
    requestId,
    accession: "0001493152-26-004150",
    force: true,
    suppressAlerts: true,
  };
}

function quietDependencies(logs: LogEntry[]) {
  return {
    sink: (entry: LogEntry) => logs.push(entry),
    setInterval: (() => ({ unref() {} })) as never,
    clearInterval: (() => undefined) as never,
  };
}

function monotonicClock() {
  let now = 0;
  return () => {
    now += 10_000;
    return now;
  };
}
