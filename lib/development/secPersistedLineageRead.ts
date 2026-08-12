import type { SecDiagnosticSelect } from "./secPersistedDiagnosticRead.ts";
import { OFFERING_MONITOR_JOB_PROMPT_KEY } from "../offeringMonitorJobFoundation.ts";

export type SecLineageReadStatus = "ok" | "read_failed";

export type RecentPersistenceContext = {
  rawItem: Record<string, unknown> | null;
  sourceRun: Record<string, unknown> | null;
};

export type PersistenceContextRead = {
  data: Map<string, RecentPersistenceContext>;
  rawItems: SecLineageReadStatus;
  sourceRuns: SecLineageReadStatus;
};

export type EventAnalysisRead = {
  data: Map<string, Record<string, unknown>>;
  status: SecLineageReadStatus;
};

export type RepairTraceRead = {
  data: Map<string, Record<string, unknown>>;
  aiRuns: SecLineageReadStatus;
  aiOutputs: SecLineageReadStatus;
};

export async function readSecPersistenceContextMap(
  rawItemIds: string[],
  select: SecDiagnosticSelect,
): Promise<PersistenceContextRead> {
  const data = new Map<string, RecentPersistenceContext>();
  if (!rawItemIds.length) return { data, rawItems: "ok", sourceRuns: "ok" };

  try {
    const rawResponse = await select("raw_items", {
      select: "id,run_id,source_code,published_at,fetched_at,metadata",
      id: `in.(${rawItemIds.join(",")})`,
      limit: String(rawItemIds.length),
    });
    if (!rawResponse.ok || !Array.isArray(rawResponse.data)) {
      return { data, rawItems: "read_failed", sourceRuns: "read_failed" };
    }

    const rawItems = rawResponse.data.filter(isRecord);
    const sourceRunIds = rawItems.map((row) => stringValue(row.run_id)).filter(Boolean);
    const sourceRunById = new Map<string, Record<string, unknown>>();
    if (sourceRunIds.length) {
      let sourceRunResponse;
      try {
        sourceRunResponse = await select("source_runs", {
          select: "id,status,started_at,finished_at,error_message",
          id: `in.(${sourceRunIds.join(",")})`,
          limit: String(sourceRunIds.length),
        });
      } catch {
        sourceRunResponse = { ok: false };
      }
      if (!sourceRunResponse.ok || !Array.isArray(sourceRunResponse.data)) {
        for (const rawItem of rawItems) {
          const rawItemId = stringValue(rawItem.id);
          if (rawItemId) data.set(rawItemId, { rawItem, sourceRun: null });
        }
        return { data, rawItems: "ok", sourceRuns: "read_failed" };
      }
      for (const run of sourceRunResponse.data.filter(isRecord)) {
        const runId = stringValue(run.id);
        if (runId) sourceRunById.set(runId, run);
      }
    }

    for (const rawItem of rawItems) {
      const rawItemId = stringValue(rawItem.id);
      if (!rawItemId) continue;
      data.set(rawItemId, {
        rawItem,
        sourceRun: sourceRunById.get(stringValue(rawItem.run_id)) || null,
      });
    }
    return { data, rawItems: "ok", sourceRuns: "ok" };
  } catch {
    return { data, rawItems: "read_failed", sourceRuns: "read_failed" };
  }
}

export async function readSecEventAnalysisMap(
  eventIds: string[],
  select: SecDiagnosticSelect,
): Promise<EventAnalysisRead> {
  const data = new Map<string, Record<string, unknown>>();
  if (!eventIds.length) return { data, status: "ok" };
  try {
    const response = await select("event_analysis", {
      select: "*",
      event_id: `in.(${eventIds.join(",")})`,
      limit: String(eventIds.length),
    });
    if (!response.ok || !Array.isArray(response.data)) return { data, status: "read_failed" };
    for (const record of response.data.filter(isRecord)) {
      const eventId = stringValue(record.event_id);
      if (eventId) data.set(eventId, record);
    }
    return { data, status: "ok" };
  } catch {
    return { data, status: "read_failed" };
  }
}

export async function readSecRepairTraceMap(
  eventIds: string[],
  select: SecDiagnosticSelect,
): Promise<RepairTraceRead> {
  const data = new Map<string, Record<string, unknown>>();
  if (!eventIds.length) return { data, aiRuns: "ok", aiOutputs: "ok" };
  try {
    const runResponse = await select("ai_runs", {
      select: "*",
      event_id: `in.(${eventIds.join(",")})`,
      prompt_key: `neq.${OFFERING_MONITOR_JOB_PROMPT_KEY}`,
      order: "finished_at.desc",
      limit: String(Math.max(eventIds.length * 3, 30)),
    });
    if (!runResponse.ok || !Array.isArray(runResponse.data)) {
      return { data, aiRuns: "read_failed", aiOutputs: "read_failed" };
    }
    const latestRunByEventId = new Map<string, Record<string, unknown>>();
    for (const run of runResponse.data.filter(isRecord)) {
      if (stringValue(run.prompt_key) === OFFERING_MONITOR_JOB_PROMPT_KEY) continue;
      const eventId = stringValue(run.event_id);
      if (eventId && !latestRunByEventId.has(eventId)) latestRunByEventId.set(eventId, run);
    }
    const runIds = [...latestRunByEventId.values()].map((run) => stringValue(run.id)).filter(Boolean);
    if (!runIds.length) return { data, aiRuns: "ok", aiOutputs: "ok" };

    let outputResponse;
    try {
      outputResponse = await select("ai_outputs", {
        select: "*",
        ai_run_id: `in.(${runIds.join(",")})`,
        order: "created_at.desc",
        limit: String(runIds.length),
      });
    } catch {
      outputResponse = { ok: false };
    }
    if (!outputResponse.ok || !Array.isArray(outputResponse.data)) {
      for (const [eventId, run] of latestRunByEventId) {
        data.set(eventId, readUnavailableTrace(summarizeAnalysisRun(run)));
      }
      return { data, aiRuns: "ok", aiOutputs: "read_failed" };
    }

    const traceByRunId = new Map<string, Record<string, unknown>>();
    for (const output of outputResponse.data.filter(isRecord)) {
      const trace = readRecord(readRecord(output.payload)?.validation_repair_trace);
      const runId = stringValue(output.ai_run_id);
      if (runId && trace && !traceByRunId.has(runId)) {
        traceByRunId.set(runId, {
          availability: "available",
          trace_record_id: stringValue(output.id) || null,
          ...trace,
        });
      }
    }
    for (const [eventId, run] of latestRunByEventId) {
      const analysisRun = summarizeAnalysisRun(run);
      const trace = traceByRunId.get(stringValue(run.id));
      data.set(eventId, trace
        ? { ...trace, analysis_run: analysisRun }
        : { availability: "historical_missing", message: "기록 없음", analysis_run: analysisRun });
    }
    return { data, aiRuns: "ok", aiOutputs: "ok" };
  } catch {
    return { data, aiRuns: "read_failed", aiOutputs: "read_failed" };
  }
}

function readUnavailableTrace(analysisRun: Record<string, unknown> | null = null) {
  return {
    availability: "read_unavailable",
    message: "Persisted repair trace read unavailable.",
    analysis_run: analysisRun,
  };
}

function summarizeAnalysisRun(run: Record<string, unknown>) {
  return {
    id: stringValue(run.id) || null,
    status: stringValue(run.status) || null,
    provider: stringValue(run.provider) || null,
    model: stringValue(run.model) || null,
    started_at: stringValue(run.started_at) || null,
    finished_at: stringValue(run.finished_at) || null,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
