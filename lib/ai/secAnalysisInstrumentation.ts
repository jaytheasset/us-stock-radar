import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export type SecAnalysisStage =
  | "request_received"
  | "request_finished"
  | "request_failed"
  | "client_disconnected"
  | "event_loop_lag"
  | "raw_lookup_start"
  | "raw_lookup_end"
  | "raw_loaded"
  | "context_build_start"
  | "context_build_end"
  | "market_context_start"
  | "market_context_end"
  | "source_ready"
  | "router_attempt_start"
  | "router_attempt_end"
  | "router_attempt_failed"
  | "primary_attempt_start"
  | "primary_attempt_end"
  | "primary_attempt_failed"
  | "primary_repair_attempt_start"
  | "primary_repair_attempt_end"
  | "primary_repair_attempt_failed"
  | "provider_headers_received"
  | "provider_body_parsed"
  | "primary_validation_start"
  | "primary_validation_end"
  | "persistence_start"
  | "persistence_end"
  | "event_persistence_start"
  | "event_persistence_end"
  | "ai_trace_persistence_start"
  | "ai_trace_persistence_end"
  | "listing_fanout_start"
  | "listing_fanout_end";

export type SecAnalysisProviderPhase = "router" | "primary" | "primary_repair";

export type SecAnalysisLogFields = {
  model?: string;
  attempt?: number;
  status?: "start" | "success" | "error" | "observed";
  input_chars?: number;
  request_body_chars?: number;
  duration_ms?: number;
  error_class?: string;
  http_status?: number;
  retryable?: boolean;
  provider_phase?: SecAnalysisProviderPhase;
  force?: boolean;
  suppress_alerts?: boolean;
  event_loop_lag_ms?: number;
  market_context_available?: boolean;
  timeout_observed?: boolean;
  prompt_key?: string;
  prompt_version?: string;
  raw_item_id?: string;
  event_id?: string;
  primary_ai_run_id?: string;
  child_count?: number;
};

type SecAnalysisLogEntry = {
  request_id: string;
  accession: string | null;
  stage: SecAnalysisStage;
  timestamp: string;
  elapsed_ms: number;
} & SecAnalysisLogFields;

type TimerHandle = ReturnType<typeof setInterval>;

type SecAnalysisInstrumentationDependencies = {
  sink?: (entry: SecAnalysisLogEntry) => void;
  monotonicNow?: () => number;
  timestampNow?: () => string;
  setInterval?: (callback: () => void, intervalMs: number) => TimerHandle;
  clearInterval?: (timer: TimerHandle) => void;
  eventLoopIntervalMs?: number;
};

type SecAnalysisContext = {
  requestId: string;
  accession: string | null;
  startedAt: number;
  sink: (entry: SecAnalysisLogEntry) => void;
  monotonicNow: () => number;
  timestampNow: () => string;
};

const requestContext = new AsyncLocalStorage<SecAnalysisContext>();

export function createSecAnalysisRequestId(existingId?: string | null) {
  const candidate = (existingId || "").trim();
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  try {
    return randomUUID();
  } catch {
    return `sec-${Date.now()}`;
  }
}

export async function runWithSecAnalysisInstrumentation<T>(
  input: {
    requestId: string;
    accession?: string | null;
    force: boolean;
    suppressAlerts: boolean;
    signal?: AbortSignal;
  },
  task: () => Promise<T>,
  dependencies: SecAnalysisInstrumentationDependencies = {},
): Promise<T> {
  const monotonicNow = dependencies.monotonicNow || performance.now.bind(performance);
  const timestampNow = dependencies.timestampNow || (() => new Date().toISOString());
  const sink = dependencies.sink || defaultLogSink;
  const context: SecAnalysisContext = {
    requestId: input.requestId,
    accession: cleanAccession(input.accession),
    startedAt: monotonicNow(),
    sink,
    monotonicNow,
    timestampNow,
  };

  return requestContext.run(context, async () => {
    traceSecAnalysis("request_received", {
      status: "start",
      force: input.force,
      suppress_alerts: input.suppressAlerts,
    });

    const onAbort = () => traceSecAnalysis("client_disconnected", { status: "observed" });
    try {
      input.signal?.addEventListener("abort", onAbort, { once: true });
    } catch {
      // Best-effort instrumentation must not affect request execution.
    }
    if (input.signal?.aborted) onAbort();

    const stopEventLoopObserver = startEventLoopObserver(dependencies);
    try {
      const result = await task();
      const httpStatus = result instanceof Response ? result.status : undefined;
      traceSecAnalysis(httpStatus && httpStatus >= 400 ? "request_failed" : "request_finished", {
        status: httpStatus && httpStatus >= 400 ? "error" : "success",
        http_status: httpStatus,
      });
      return result;
    } catch (error) {
      traceSecAnalysis("request_failed", {
        status: "error",
        error_class: secAnalysisErrorClass(error),
      });
      throw error;
    } finally {
      stopEventLoopObserver();
      try {
        input.signal?.removeEventListener("abort", onAbort);
      } catch {
        // Best-effort instrumentation must not affect request cleanup.
      }
    }
  });
}

export function updateSecAnalysisAccession(accession: unknown) {
  try {
    const context = requestContext.getStore();
    if (context) context.accession = cleanAccession(accession);
  } catch {
    // Best-effort instrumentation must not affect source preparation.
  }
}

export function traceSecAnalysis(stage: SecAnalysisStage, fields: SecAnalysisLogFields = {}) {
  try {
    const context = requestContext.getStore();
    if (!context) return;
    const entry: SecAnalysisLogEntry = {
      request_id: context.requestId,
      accession: context.accession,
      stage,
      timestamp: context.timestampNow(),
      elapsed_ms: roundedDuration(context.monotonicNow() - context.startedAt),
      ...safeFields(fields),
    };
    try {
      context.sink(entry);
    } catch {
      // Logging failures are deliberately isolated from the analysis pipeline.
    }
  } catch {
    // Instrumentation is fail-safe by contract.
  }
}

export function beginSecAnalysisSpan(startStage: SecAnalysisStage, fields: SecAnalysisLogFields = {}) {
  const context = requestContext.getStore();
  const startedAt = context?.monotonicNow() ?? performance.now();
  traceSecAnalysis(startStage, { ...fields, status: "start" });
  return (endStage: SecAnalysisStage, endFields: SecAnalysisLogFields = {}) => {
    const current = requestContext.getStore();
    const now = current?.monotonicNow() ?? performance.now();
    traceSecAnalysis(endStage, {
      ...fields,
      ...endFields,
      duration_ms: roundedDuration(now - startedAt),
    });
  };
}

export async function withSecAnalysisSpan<T>(
  startStage: SecAnalysisStage,
  endStage: SecAnalysisStage,
  task: () => Promise<T>,
  fields: SecAnalysisLogFields = {},
): Promise<T> {
  const end = beginSecAnalysisSpan(startStage, fields);
  try {
    const result = await task();
    end(endStage, { status: "success" });
    return result;
  } catch (error) {
    end(endStage, {
      status: "error",
      error_class: secAnalysisErrorClass(error),
    });
    throw error;
  }
}

export function secAnalysisErrorClass(error: unknown) {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "UnknownError";
}

function startEventLoopObserver(dependencies: SecAnalysisInstrumentationDependencies) {
  try {
    const intervalMs = Math.max(5_000, dependencies.eventLoopIntervalMs || 10_000);
    const monotonicNow = dependencies.monotonicNow || performance.now.bind(performance);
    const schedule = dependencies.setInterval || setInterval;
    const clear = dependencies.clearInterval || clearInterval;
    let expectedAt = monotonicNow() + intervalMs;
    const timer = schedule(() => {
      const now = monotonicNow();
      const lag = Math.max(0, now - expectedAt);
      expectedAt = now + intervalMs;
      traceSecAnalysis("event_loop_lag", {
        status: "observed",
        event_loop_lag_ms: roundedDuration(lag),
      });
    }, intervalMs);
    timer.unref?.();
    return () => {
      try {
        clear(timer);
      } catch {
        // Best-effort cleanup only.
      }
    };
  } catch {
    return () => undefined;
  }
}

function defaultLogSink(entry: SecAnalysisLogEntry) {
  console.info("[sec-analysis]", JSON.stringify(entry));
}

function safeFields(fields: SecAnalysisLogFields): SecAnalysisLogFields {
  return {
    ...(cleanString(fields.model) ? { model: cleanString(fields.model) } : {}),
    ...(finiteNumber(fields.attempt) !== null ? { attempt: fields.attempt } : {}),
    ...(fields.status ? { status: fields.status } : {}),
    ...(finiteNumber(fields.input_chars) !== null ? { input_chars: fields.input_chars } : {}),
    ...(finiteNumber(fields.request_body_chars) !== null ? { request_body_chars: fields.request_body_chars } : {}),
    ...(finiteNumber(fields.duration_ms) !== null ? { duration_ms: finiteNumber(fields.duration_ms)! } : {}),
    ...(cleanString(fields.error_class) ? { error_class: cleanString(fields.error_class) } : {}),
    ...(finiteNumber(fields.http_status) !== null ? { http_status: finiteNumber(fields.http_status)! } : {}),
    ...(typeof fields.retryable === "boolean" ? { retryable: fields.retryable } : {}),
    ...(fields.provider_phase ? { provider_phase: fields.provider_phase } : {}),
    ...(typeof fields.force === "boolean" ? { force: fields.force } : {}),
    ...(typeof fields.suppress_alerts === "boolean" ? { suppress_alerts: fields.suppress_alerts } : {}),
    ...(finiteNumber(fields.event_loop_lag_ms) !== null
      ? { event_loop_lag_ms: finiteNumber(fields.event_loop_lag_ms)! }
      : {}),
    ...(typeof fields.market_context_available === "boolean"
      ? { market_context_available: fields.market_context_available }
      : {}),
    ...(typeof fields.timeout_observed === "boolean" ? { timeout_observed: fields.timeout_observed } : {}),
    ...(cleanString(fields.prompt_key) ? { prompt_key: cleanString(fields.prompt_key) } : {}),
    ...(cleanString(fields.prompt_version) ? { prompt_version: cleanString(fields.prompt_version) } : {}),
    ...(cleanString(fields.raw_item_id) ? { raw_item_id: cleanString(fields.raw_item_id) } : {}),
    ...(cleanString(fields.event_id) ? { event_id: cleanString(fields.event_id) } : {}),
    ...(cleanString(fields.primary_ai_run_id)
      ? { primary_ai_run_id: cleanString(fields.primary_ai_run_id) }
      : {}),
    ...(finiteNumber(fields.child_count) !== null ? { child_count: finiteNumber(fields.child_count)! } : {}),
  };
}

function cleanAccession(value: unknown) {
  const text = cleanString(value);
  return text ? text.slice(0, 80) : null;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundedDuration(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}
