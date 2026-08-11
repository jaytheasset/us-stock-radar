import assert from "node:assert/strict";
import test from "node:test";
import {
  readSecEventAnalysisMap,
  readSecPersistenceContextMap,
  readSecRepairTraceMap,
} from "./secPersistedLineageRead.ts";
import type { SecDiagnosticSelect } from "./secPersistedDiagnosticRead.ts";

const eventId = "5c12efff-d839-4e72-b983-52990312aaf1";
const rawItemId = "7b856257-4374-41e9-86a4-901f0d28f40f";
const runId = "095b80ef-1f3e-48b5-b31d-1aabf3bbb454";
const monitorRunId = "195b80ef-1f3e-48b5-b31d-1aabf3bbb455";

test("raw-item and event-analysis query failures are explicit and sanitized", async () => {
  const failedSelect: SecDiagnosticSelect = async () => ({
    ok: false,
    data: { error: "Token=must-not-leak" },
  });

  const persistence = await readSecPersistenceContextMap([rawItemId], failedSelect);
  const analysis = await readSecEventAnalysisMap([eventId], failedSelect);

  assert.deepEqual(
    { rawItems: persistence.rawItems, sourceRuns: persistence.sourceRuns, size: persistence.data.size },
    { rawItems: "read_failed", sourceRuns: "read_failed", size: 0 },
  );
  assert.deepEqual({ status: analysis.status, size: analysis.data.size }, { status: "read_failed", size: 0 });
  assert.doesNotMatch(JSON.stringify([persistence, analysis]), /must-not-leak|Token=/);
});

test("source-run failure preserves the successfully read raw item", async () => {
  const select: SecDiagnosticSelect = async (table) => {
    if (table === "raw_items") return { ok: true, data: [{ id: rawItemId, run_id: runId }] };
    throw new Error("must-not-leak");
  };

  const result = await readSecPersistenceContextMap([rawItemId], select);

  assert.equal(result.rawItems, "ok");
  assert.equal(result.sourceRuns, "read_failed");
  assert.equal(result.data.get(rawItemId)?.rawItem?.id, rawItemId);
  assert.equal(result.data.get(rawItemId)?.sourceRun, null);
});

test("repair output failure is read_unavailable, not historical record_missing", async () => {
  const select: SecDiagnosticSelect = async (table) => {
    if (table === "ai_runs") return { ok: true, data: [{ id: runId, event_id: eventId, status: "completed" }] };
    throw new Error("database-secret");
  };

  const result = await readSecRepairTraceMap([eventId], select);
  const trace = result.data.get(eventId);

  assert.equal(result.aiRuns, "ok");
  assert.equal(result.aiOutputs, "read_failed");
  assert.equal(trace?.availability, "read_unavailable");
  assert.notEqual(trace?.availability, "historical_missing");
  assert.doesNotMatch(JSON.stringify(result), /database-secret|detail/);
});

test("successful child reads with no matching records remain genuine absence", async () => {
  const emptySelect: SecDiagnosticSelect = async () => ({ ok: true, data: [] });

  const persistence = await readSecPersistenceContextMap([rawItemId], emptySelect);
  const analysis = await readSecEventAnalysisMap([eventId], emptySelect);
  const repair = await readSecRepairTraceMap([eventId], emptySelect);

  assert.deepEqual(
    [persistence.rawItems, persistence.sourceRuns, analysis.status, repair.aiRuns, repair.aiOutputs],
    ["ok", "ok", "ok", "ok", "ok"],
  );
  assert.equal(persistence.data.size + analysis.data.size + repair.data.size, 0);
});

test("Monitor foundation ledger rows cannot replace the latest persisted Primary analysis run", async () => {
  const traceId = "295b80ef-1f3e-48b5-b31d-1aabf3bbb456";
  const select: SecDiagnosticSelect = async (table, search) => {
    if (table === "ai_runs") {
      assert.equal(search.prompt_key, "neq.offering_monitor_normalization_job");
      return {
        ok: true,
        data: [
          {
            id: monitorRunId,
            event_id: eventId,
            prompt_key: "offering_monitor_normalization_job",
            status: "completed",
            finished_at: "2026-08-11T22:04:16.211Z",
          },
          {
            id: runId,
            event_id: eventId,
            prompt_key: "sec_s1_f1_analysis",
            status: "completed",
            finished_at: "2026-08-11T21:20:49.747Z",
          },
        ],
      };
    }
    assert.equal(table, "ai_outputs");
    assert.equal(search.ai_run_id, `in.(${runId})`);
    return {
      ok: true,
      data: [
        {
          id: monitorRunId,
          ai_run_id: monitorRunId,
          output_type: "offering_monitor_normalization_candidate",
          payload: { canonical_candidate: { side: "primary" } },
        },
        {
          id: traceId,
          ai_run_id: runId,
          payload: { validation_repair_trace: { attempted: false } },
        },
      ],
    };
  };

  const result = await readSecRepairTraceMap([eventId], select);
  const trace = result.data.get(eventId);

  assert.equal(result.aiRuns, "ok");
  assert.equal(result.aiOutputs, "ok");
  assert.equal(trace?.availability, "available");
  assert.equal(trace?.trace_record_id, traceId);
  assert.equal((trace?.analysis_run as Record<string, unknown>)?.id, runId);
});

test("non-Monitor prompt runs retain historical record_missing semantics", async () => {
  const otherRunId = "395b80ef-1f3e-48b5-b31d-1aabf3bbb457";
  const select: SecDiagnosticSelect = async (table, search) => {
    if (table === "ai_runs") {
      assert.equal(search.prompt_key, "neq.offering_monitor_normalization_job");
      return {
        ok: true,
        data: [{
          id: otherRunId,
          event_id: eventId,
          prompt_key: "sec_8k_6k_capital_financing_analysis",
          status: "completed",
        }],
      };
    }
    return { ok: true, data: [] };
  };

  const result = await readSecRepairTraceMap([eventId], select);
  const trace = result.data.get(eventId);

  assert.equal(result.aiRuns, "ok");
  assert.equal(result.aiOutputs, "ok");
  assert.equal(trace?.availability, "historical_missing");
  assert.equal((trace?.analysis_run as Record<string, unknown>)?.id, otherRunId);
});
