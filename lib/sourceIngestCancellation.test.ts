import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};\n") };
    }
    if (specifier === "workflow/api") {
      return {
        shortCircuit: true,
        url: dataModule("export function getRun() { throw new Error('unexpected default getRun'); }\n"),
      };
    }
    if (specifier === "@/lib/sourceRunState") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function cancelWorkflowSourceRuns() { throw new Error("unexpected default cancel"); }
          export async function readSourceRunsForWorkflow() { throw new Error("unexpected default read"); }
        `),
      };
    }
    return nextResolve(specifier, context);
  },
});

const { cancelSourceIngestWorkflowRun } = await import("./sourceIngestCancellation.ts");

test("explicit authoritative Workflow cancellation terminalizes only its active source attempts", async () => {
  const harness = createHarness("running", [
    sourceRun("source-running", "running"),
    sourceRun("source-completed", "completed"),
  ]);

  const result = await cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies);

  assert.equal(harness.cancelCalls, 1);
  assert.equal(result.workflowStatus, "cancelled");
  assert.deepEqual(result.sourceRuns.map((row) => row.status), ["cancelled", "completed"]);
  assert.deepEqual(result.transitions, [{
    sourceRunId: "source-running",
    outcome: "transitioned",
    status: "cancelled",
  }]);
  assert.equal(harness.rows[0]?.metadata.cancellation_authority, "workflow");
  assert.match(String(harness.rows[0]?.metadata.cancelled_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("duplicate cancellation is idempotent", async () => {
  const harness = createHarness("cancelled", [sourceRun("source-cancelled", "cancelled")]);

  const first = await cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies);
  const second = await cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies);

  assert.equal(harness.cancelCalls, 0);
  assert.equal(first.transitions[0]?.outcome, "idempotent");
  assert.equal(second.transitions[0]?.outcome, "idempotent");
  assert.equal(harness.rows[0]?.status, "cancelled");
});

test("completed and failed Workflow runs cannot be relabelled cancelled", async () => {
  for (const workflowStatus of ["completed", "failed"] as const) {
    const harness = createHarness(workflowStatus, [sourceRun(`source-${workflowStatus}`, workflowStatus)]);
    const result = await cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies);

    assert.equal(harness.cancelCalls, 0);
    assert.equal(result.workflowStatus, workflowStatus);
    assert.deepEqual(result.transitions, []);
    assert.equal(harness.rows[0]?.status, workflowStatus);
  }
});

test("a cancellation race preserves authoritative completion", async () => {
  const harness = createHarness("running", [sourceRun("source-race", "completed")], {
    cancelError: new Error("run already completed"),
    statusAfterCancel: "completed",
  });

  const result = await cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies);

  assert.equal(result.workflowStatus, "completed");
  assert.deepEqual(result.transitions, []);
  assert.equal(harness.rows[0]?.status, "completed");
});

test("unknown Workflow state and invalid run IDs fail closed", async () => {
  const harness = createHarness("paused", [sourceRun("source-unknown", "running")]);

  await assert.rejects(
    cancelSourceIngestWorkflowRun(harness.workflowRunId, harness.dependencies),
    /unsupported status paused/,
  );
  await assert.rejects(
    cancelSourceIngestWorkflowRun("source-run-id", harness.dependencies),
    /valid Workflow run ID/,
  );
  assert.equal(harness.rows[0]?.status, "running");
});

type SourceRunRow = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  stats: Record<string, unknown>;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

function sourceRun(id: string, status: string): SourceRunRow {
  return {
    id,
    status,
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: status === "running" ? null : "2026-08-31T00:01:00.000Z",
    stats: {},
    error_message: null,
    metadata: { workflow_run_id: "wrun_cancellation_test_123" },
  };
}

function createHarness(
  initialWorkflowStatus: string,
  initialRows: SourceRunRow[],
  options: { cancelError?: Error; statusAfterCancel?: string } = {},
) {
  const workflowRunId = "wrun_cancellation_test_123";
  const rows = structuredClone(initialRows);
  let workflowStatus = initialWorkflowStatus;
  let cancelCalls = 0;
  const dependencies = {
    getRun: (_runId: string) => ({
      cancel: async () => {
        cancelCalls += 1;
        workflowStatus = options.statusAfterCancel || "cancelled";
        if (options.cancelError) throw options.cancelError;
      },
      get status() {
        return Promise.resolve(workflowStatus);
      },
    }),
    readSourceRuns: async (_runId: string) => structuredClone(rows),
    cancelSourceRuns: async (runId: string) => {
      let updatedCount = 0;
      for (const row of rows) {
        if (row.metadata.workflow_run_id !== runId ||
            (row.status !== "running" && row.status !== "queued")) {
          continue;
        }
        row.status = "cancelled";
        row.finished_at = "2026-08-31T00:02:00.000Z";
        row.metadata = {
          ...row.metadata,
          cancellation_authority: "workflow",
          cancelled_at: "2026-08-31T00:02:00.000Z",
        };
        updatedCount += 1;
      }
      return updatedCount;
    },
  };

  return {
    workflowRunId,
    rows,
    dependencies,
    get cancelCalls() {
      return cancelCalls;
    },
  };
}

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
