import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export async function supabaseRpc() { throw new Error("unexpected default rpc"); }
          export async function supabaseSelect() { throw new Error("unexpected default select"); }
          export async function supabaseUpdate() { throw new Error("unexpected default update"); }
        `)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  readSourceRunsForWorkflow,
  transitionSourceRunToTerminal,
} = await import("./sourceRunState.ts");

type Row = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  stats: Record<string, unknown>;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

test("normal source-run completion and failure remain supported", async () => {
  const completed = createStore([runningRow("normal-complete", "wrun_normal_complete_123")]);
  const failed = createStore([runningRow("normal-fail", "wrun_normal_fail_123")]);

  assert.equal((await transitionSourceRunToTerminal({
    runId: "normal-complete",
    status: "completed",
    stats: { checked_count: 2 },
    metadata: { workflow_run_id: "wrun_normal_complete_123" },
  }, completed.dependencies)).outcome, "transitioned");
  assert.equal(completed.rows[0]?.status, "completed");

  assert.equal((await transitionSourceRunToTerminal({
    runId: "normal-fail",
    status: "failed",
    stats: { failed_count: 1 },
    errorMessage: "expected failure",
    metadata: { workflow_run_id: "wrun_normal_fail_123" },
  }, failed.dependencies)).outcome, "transitioned");
  assert.equal(failed.rows[0]?.status, "failed");
});

test("cancelled is terminal, idempotent, and cannot be overwritten by late callbacks", async () => {
  const store = createStore([runningRow("cancel-attempt", "wrun_cancel_attempt_123")]);
  const input = {
    runId: "cancel-attempt",
    status: "cancelled" as const,
    stats: {},
    metadata: { workflow_run_id: "wrun_cancel_attempt_123" },
    workflowRunId: "wrun_cancel_attempt_123",
    allowQueued: true,
  };

  assert.equal((await transitionSourceRunToTerminal(input, store.dependencies)).outcome, "transitioned");
  assert.equal((await transitionSourceRunToTerminal(input, store.dependencies)).outcome, "idempotent");

  for (const status of ["completed", "failed"] as const) {
    const result = await transitionSourceRunToTerminal({
      runId: "cancel-attempt",
      status,
      stats: { late: status },
      metadata: { workflow_run_id: "wrun_cancel_attempt_123" },
    }, store.dependencies);
    assert.equal(result.outcome, "preserved");
    assert.equal(store.rows[0]?.status, "cancelled");
  }
});

test("cancellation is bound to the exact Workflow run and leaves other attempts untouched", async () => {
  const store = createStore([
    runningRow("attempt-one", "wrun_attempt_one_123"),
    runningRow("attempt-two", "wrun_attempt_two_123"),
  ]);

  await transitionSourceRunToTerminal({
    runId: "attempt-one",
    status: "cancelled",
    stats: {},
    metadata: { workflow_run_id: "wrun_attempt_one_123" },
    workflowRunId: "wrun_attempt_one_123",
    allowQueued: true,
  }, store.dependencies);

  assert.equal(store.rows.find((row) => row.id === "attempt-one")?.status, "cancelled");
  assert.equal(store.rows.find((row) => row.id === "attempt-two")?.status, "running");

  await assert.rejects(
    transitionSourceRunToTerminal({
      runId: "attempt-two",
      status: "cancelled",
      stats: {},
      metadata: { workflow_run_id: "wrun_attempt_one_123" },
      workflowRunId: "wrun_attempt_one_123",
      allowQueued: true,
    }, store.dependencies),
    /not bound to Workflow run/,
  );
  assert.equal(store.rows.find((row) => row.id === "attempt-two")?.status, "running");
});

test("terminal source runs are preserved and read errors fail closed", async () => {
  const store = createStore([
    { ...runningRow("already-complete", "wrun_terminal_123"), status: "completed" },
    { ...runningRow("already-failed", "wrun_terminal_123"), status: "failed" },
  ]);

  for (const row of store.rows) {
    const result = await transitionSourceRunToTerminal({
      runId: row.id,
      status: "cancelled",
      stats: {},
      metadata: { workflow_run_id: "wrun_terminal_123" },
      workflowRunId: "wrun_terminal_123",
      allowQueued: true,
    }, store.dependencies);
    assert.equal(result.outcome, "preserved");
  }
  assert.deepEqual(store.rows.map((row) => row.status), ["completed", "failed"]);

  await assert.rejects(
    readSourceRunsForWorkflow("wrun_terminal_123", {
      select: async () => ({
        ok: false,
        status: 503,
        data: null,
        count: null,
        error: "read unavailable",
      }),
    }),
    /read unavailable/,
  );
});

function runningRow(id: string, workflowRunId: string): Row {
  return {
    id,
    status: "running",
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: null,
    stats: {},
    error_message: null,
    metadata: { workflow_run_id: workflowRunId },
  };
}

function createStore(initialRows: Row[]) {
  const rows = structuredClone(initialRows);
  const dependencies = {
    select: async (_table: string, filters: Record<string, string>) => {
      const id = filters.id?.replace(/^eq\./, "");
      const workflowRunId = filters["metadata->>workflow_run_id"]?.replace(/^eq\./, "");
      return {
        ok: true,
        status: 200,
        data: rows.filter((row) => (!id || row.id === id) &&
          (!workflowRunId || row.metadata.workflow_run_id === workflowRunId)),
        count: null,
        error: undefined,
      };
    },
    update: async (
      _table: string,
      filters: Record<string, string>,
      payload: Record<string, unknown>,
    ) => {
      const id = filters.id?.replace(/^eq\./, "");
      const workflowRunId = filters["metadata->>workflow_run_id"]?.replace(/^eq\./, "");
      const allowedStatuses = filters.status === "in.(queued,running)"
        ? new Set(["queued", "running"])
        : new Set(["running"]);
      const updated: Row[] = [];
      for (const row of rows) {
        if (row.id !== id || !allowedStatuses.has(row.status)) continue;
        if (workflowRunId && row.metadata.workflow_run_id !== workflowRunId) continue;
        Object.assign(row, payload);
        updated.push(structuredClone(row));
      }
      return { ok: true, status: 200, data: updated, error: undefined };
    },
  };
  return { rows, dependencies };
}
