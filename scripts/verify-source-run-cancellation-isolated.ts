import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLocalWorld } from "@workflow/world-local";
import { getQueueTopicPrefix } from "@workflow/world";
import { start } from "workflow/api";
import { setWorld } from "workflow/runtime";
import { resolveSupabaseSecretKey } from "../lib/supabaseKeys.ts";

const apiUrl = requireIsolatedSupabase();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent("export {};\n")}`,
      };
    }
    if (specifier.startsWith("@/")) {
      return {
        shortCircuit: true,
        url: pathToFileURL(path.resolve(process.cwd(), `${specifier.slice(2)}.ts`)).href,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  supabaseDelete,
  supabaseSelect,
  supabaseUpsert,
} = await import("../lib/supabase.ts");
const {
  registerWorkflowSourceRun,
  readSourceRunsForWorkflow,
  transitionSourceRunToTerminal,
} = await import("../lib/sourceRunState.ts");
const { cancelSourceIngestWorkflowRun } = await import(
  "../lib/sourceIngestCancellation.ts"
);

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const sourceCode = `cancel_verify_${suffix}`;
const otherWorkflowRunId = `wrun_other_verify_${suffix}`;
const workflowDataDir = await mkdtemp(
  path.join(tmpdir(), "stock-radar-source-cancel-"),
);
const world = createLocalWorld({
  dataDir: workflowDataDir,
  recoverActiveRuns: false,
});
setWorld(world);
world.registerHandler(
  getQueueTopicPrefix("workflow"),
  async () => new Response(null, { status: 204 }),
);
const pendingWorkflow = Object.assign(
  async () => undefined,
  { workflowId: "sourceIngestCancellationVerification" },
);
const runtimeRun = await start(pendingWorkflow, []);
const workflowRunId = runtimeRun.runId;
assert.equal(await runtimeRun.status, "pending");
const ids = {
  cancelled: randomUUID(),
  lateRegistration: randomUUID(),
  otherAttempt: randomUUID(),
  completed: randomUUID(),
  failed: randomUUID(),
  normalComplete: randomUUID(),
  normalFail: randomUUID(),
};

try {
  assertMutation(await supabaseUpsert("sources", {
    code: sourceCode,
    name: "Isolated cancellation verification",
    source_group: "news",
    runtime_owner: "manual",
    enabled: false,
    metadata: { isolated_test: true },
  }, { onConflict: "code" }), "create isolated source");

  assert.equal(await registerRun(ids.cancelled, workflowRunId), "running");
  assert.equal(await registerRun(ids.otherAttempt, otherWorkflowRunId), "running");
  assert.equal(await registerRun(ids.completed, workflowRunId), "running");
  assert.equal(await registerRun(ids.failed, workflowRunId), "running");
  assert.equal(
    await registerRun(ids.normalComplete, `wrun_normal_complete_${suffix}`),
    "running",
  );
  assert.equal(
    await registerRun(ids.normalFail, `wrun_normal_fail_${suffix}`),
    "running",
  );

  await transitionSourceRunToTerminal({
    runId: ids.completed,
    status: "completed",
    stats: {},
    metadata: { workflow_run_id: workflowRunId, isolated_test: true },
  });
  await transitionSourceRunToTerminal({
    runId: ids.failed,
    status: "failed",
    stats: {},
    metadata: { workflow_run_id: workflowRunId, isolated_test: true },
  });

  const firstCancellation = await cancelSourceIngestWorkflowRun(workflowRunId);
  assert.equal(firstCancellation.workflowStatus, "cancelled");
  assert.equal(firstCancellation.transitions[0]?.outcome, "transitioned");
  assert.equal(await runtimeRun.status, "cancelled");

  assert.equal(
    await registerRun(ids.lateRegistration, workflowRunId),
    "cancelled",
  );

  const duplicateCancellation = await cancelSourceIngestWorkflowRun(workflowRunId);
  assert.equal(duplicateCancellation.workflowStatus, "cancelled");
  assert.equal(duplicateCancellation.transitions[0]?.outcome, "idempotent");

  for (const status of ["completed", "failed"] as const) {
    assert.equal((await transitionSourceRunToTerminal({
      runId: ids.cancelled,
      status,
      stats: { late_callback: status },
      metadata: { workflow_run_id: workflowRunId, isolated_test: true },
    })).outcome, "preserved");
  }

  for (const [runId, status] of [
    [ids.completed, "completed"],
    [ids.failed, "failed"],
  ] as const) {
    assert.equal((await transitionSourceRunToTerminal({
      runId,
      status: "cancelled",
      stats: {},
      metadata: { workflow_run_id: workflowRunId, isolated_test: true },
      workflowRunId,
      allowQueued: true,
    })).outcome, "preserved");
    assert.equal((await readRun(runId)).status, status);
  }

  assert.equal((await transitionSourceRunToTerminal({
    runId: ids.normalComplete,
    status: "completed",
    stats: { checked_count: 1 },
    metadata: { workflow_run_id: `wrun_normal_complete_${suffix}` },
  })).outcome, "transitioned");
  assert.equal(
    await registerRun(ids.normalComplete, `wrun_normal_complete_${suffix}`),
    "completed",
  );
  assert.equal((await transitionSourceRunToTerminal({
    runId: ids.normalFail,
    status: "failed",
    stats: { failed_count: 1 },
    errorMessage: "isolated expected failure",
    metadata: { workflow_run_id: `wrun_normal_fail_${suffix}` },
  })).outcome, "transitioned");

  const workflowRows = await readSourceRunsForWorkflow(workflowRunId);
  assert.deepEqual(
    workflowRows.map((row) => row.status).sort(),
    ["cancelled", "cancelled", "completed", "failed"],
  );
  assert.equal((await readRun(ids.otherAttempt)).status, "running");
  assert.equal((await readRun(ids.cancelled)).status, "cancelled");
  assert.equal((await readRun(ids.normalComplete)).status, "completed");
  assert.equal((await readRun(ids.normalFail)).status, "failed");

  console.log(JSON.stringify({
    ok: true,
    api_origin: apiUrl.origin,
    verified: [
      "cancelled enum migration",
      "actual local Workflow Run.cancel",
      "Workflow-to-source-run cancellation adapter",
      "atomic registration after cancellation",
      "exact Workflow-run binding",
      "idempotent cancellation",
      "late completion/failure preservation",
      "completed/failed preservation",
      "normal completion/failure",
      "terminal attempt replay preservation",
      "distinct attempt isolation",
    ],
  }));
} finally {
  assertMutation(await supabaseDelete("source_runs", {
    id: `in.(${Object.values(ids).join(",")})`,
  }), "clean isolated source runs");
  assertMutation(await supabaseDelete("source_workflow_cancellations", {
    workflow_run_id: `eq.${workflowRunId}`,
  }), "clean isolated Workflow cancellation");
  assertMutation(
    await supabaseDelete("sources", { code: `eq.${sourceCode}` }),
    "clean isolated source",
  );
  setWorld(undefined);
  await world.clear();
  await rm(workflowDataDir, { recursive: true, force: true });
}

function requireIsolatedSupabase() {
  if (process.env.SOURCE_RUN_CANCELLATION_ISOLATED_DB !== "1") {
    throw new Error("SOURCE_RUN_CANCELLATION_ISOLATED_DB=1 is required");
  }
  if (!resolveSupabaseSecretKey().key) {
    throw new Error("A privileged Supabase API key is required");
  }
  const url = new URL(process.env.SUPABASE_URL || "");
  if (!url.hostname.match(/^(127\.0\.0\.1|localhost)$/) ||
      url.port === "56321" ||
      Number(url.port) < 1024) {
    throw new Error("Refusing to run outside an isolated local Supabase API");
  }
  return url;
}

function registerRun(id: string, boundWorkflowRunId: string) {
  return registerWorkflowSourceRun({
    runId: id,
    sourceCode,
    sourceGroup: "news",
    runType: "isolated_test",
    startedAt: "2026-08-31T00:00:00.000Z",
    stats: {},
    metadata: {
      workflow_run_id: boundWorkflowRunId,
      isolated_test: true,
    },
  });
}

async function readRun(id: string) {
  const result = await supabaseSelect("source_runs", {
    select: "id,status,metadata",
    id: `eq.${id}`,
    limit: "1",
  });
  assertMutation(result, `read isolated source run ${id}`);
  const row = Array.isArray(result.data) ? result.data[0] : null;
  assert.ok(row && typeof row === "object");
  return row as Record<string, unknown>;
}

function assertMutation(
  result: { ok: boolean; status: number; error?: string; data?: unknown },
  label: string,
) {
  assert.equal(result.ok, true, `${label}: ${result.error || `HTTP ${result.status}`}`);
}
