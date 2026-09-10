import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

type JobRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
};

declare global {
  var __offeringMonitorJobRow: JobRow | undefined;
  var __offeringMonitorRpcFailure: boolean | undefined;
}

const mocks = new Map<string, string>([
  ["@/lib/offeringMonitorJobFoundation", dataModule(`
    export const OFFERING_MONITOR_JOB_PROMPT_KEY = "offering_monitor_normalization_job";
    export const OFFERING_MONITOR_JOB_VERSION = "offering_monitor_job_v2";
  `)],
  ["@/lib/supabase", dataModule(`
    export async function supabaseSelect() {
      const row = globalThis.__offeringMonitorJobRow;
      return { ok: true, status: 200, data: row ? [structuredClone(row)] : [] };
    }
    export async function supabaseUpdate(_table, _filters, patch) {
      const row = globalThis.__offeringMonitorJobRow;
      if (!row) return { ok: true, status: 200, data: [] };
      globalThis.__offeringMonitorJobRow = {
        ...row,
        ...structuredClone(patch),
      };
      return { ok: true, status: 200, data: [structuredClone(globalThis.__offeringMonitorJobRow)] };
    }
    export async function supabaseUpsert() {
      return { ok: true, status: 200, data: [] };
    }
    export async function supabaseRpc(functionName, payload) {
      if (globalThis.__offeringMonitorRpcFailure) {
        return { ok: false, status: 500, data: null, error: "intentional RPC failure" };
      }
      const row = globalThis.__offeringMonitorJobRow;
      if (!row) return { ok: true, status: 200, data: { status: "missing", job_id: payload.p_job_id } };
      if (functionName === "attach_offering_monitor_workflow_run") {
        row.metadata = { ...row.metadata, workflow_run_id: payload.p_workflow_run_id };
        return { ok: true, status: 200, data: { status: "updated", job_id: row.id } };
      }
      if (functionName === "set_offering_monitor_registry_alert_state") {
        const current = row.metadata.registry_alert_status;
        if (current === "completed" && payload.p_state !== "completed") {
          return { ok: true, status: 200, data: { status: "preserved", job_id: row.id, registry_alert_status: current } };
        }
        row.metadata = {
          ...row.metadata,
          registry_alert_status: payload.p_state,
          registry_alert_error: payload.p_state === "completed" ? null : payload.p_error,
        };
        return { ok: true, status: 200, data: { status: "updated", job_id: row.id, registry_alert_status: payload.p_state } };
      }
      if (functionName === "finish_offering_monitor_sidecar_job") {
        row.status = payload.p_status;
        row.metadata = { ...row.metadata, ...structuredClone(payload.p_metadata_patch) };
        return { ok: true, status: 200, data: { status: "updated", job_id: row.id } };
      }
      return { ok: false, status: 404, data: null, error: "unexpected RPC" };
    }
  `)],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mocks.get(specifier);
    return mock ? { shortCircuit: true, url: mock } : nextResolve(specifier, context);
  },
});

const {
  attachOfferingMonitorWorkflowRun,
  completeOfferingMonitorJobAfterSidecar,
  readOfferingMonitorRegistryRetryCandidate,
  recordOfferingMonitorRegistryExecution,
} = await import("./offeringMonitorJobRepository.ts");

const identity = {
  jobId: "11111111-1111-4111-8111-111111111111",
  executionContractVersion: "sidecar-only-v1",
} as any;

test("Registry failure then sidecar completion preserves both owners", async () => {
  globalThis.__offeringMonitorJobRow = {
    id: identity.jobId,
    status: "pending",
    metadata: { phase: "sidecar_only_pending" },
  };
  globalThis.__offeringMonitorRpcFailure = false;

  await recordOfferingMonitorRegistryExecution(identity.jobId, {
    status: "failed",
    error: "intentional monitor failure",
  });
  await completeOfferingMonitorJobAfterSidecar(identity, {
    status: "completed",
    providerCalled: false,
    inserted: 1,
    deduped: 0,
  });

  assert.equal(globalThis.__offeringMonitorJobRow.status, "completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.phase, "sidecar_only_completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.sidecar_status, "completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_status, "failed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_error, "intentional monitor failure");
  assert.deepEqual(
    await readOfferingMonitorRegistryRetryCandidate({ eventId: "event-1", rawItemId: "raw-1" }),
    { jobId: identity.jobId, state: "failed" },
  );
});

test("sidecar completion then Registry failure preserves both owners", async () => {
  globalThis.__offeringMonitorJobRow = {
    id: identity.jobId,
    status: "pending",
    metadata: { phase: "sidecar_only_pending" },
  };

  await completeOfferingMonitorJobAfterSidecar(identity, {
    status: "completed",
    providerCalled: false,
    inserted: 1,
    deduped: 0,
  });
  await recordOfferingMonitorRegistryExecution(identity.jobId, {
    status: "failed",
    error: "intentional monitor failure",
  });

  assert.equal(globalThis.__offeringMonitorJobRow.status, "completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.phase, "sidecar_only_completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_status, "failed");
});

test("completed Registry state is monotonic and attach preserves both metadata owners", async () => {
  globalThis.__offeringMonitorJobRow = {
    id: identity.jobId,
    status: "pending",
    metadata: { phase: "sidecar_only_pending", registry_alert_status: "pending" },
  };

  await recordOfferingMonitorRegistryExecution(identity.jobId, { status: "completed" });
  await recordOfferingMonitorRegistryExecution(identity.jobId, {
    status: "failed",
    error: "late failure",
  });
  await recordOfferingMonitorRegistryExecution(identity.jobId, {
    status: "deferred",
    readerReason: "late pending",
  });
  await attachOfferingMonitorWorkflowRun(identity, "workflow-run-1");

  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_status, "completed");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_error, null);
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.phase, "sidecar_only_pending");
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.workflow_run_id, "workflow-run-1");
  assert.equal(
    await readOfferingMonitorRegistryRetryCandidate({ eventId: "event-1", rawItemId: "raw-1" }),
    null,
  );
});

test("RPC failures and missing rows are errors rather than successful state writes", async () => {
  globalThis.__offeringMonitorJobRow = undefined;
  await assert.rejects(
    recordOfferingMonitorRegistryExecution(identity.jobId, { status: "failed", error: "failure" }),
    /lost job authority: missing/,
  );

  globalThis.__offeringMonitorJobRow = {
    id: identity.jobId,
    status: "pending",
    metadata: { registry_alert_status: "pending" },
  };
  globalThis.__offeringMonitorRpcFailure = true;
  await assert.rejects(
    recordOfferingMonitorRegistryExecution(identity.jobId, { status: "failed", error: "failure" }),
    /intentional RPC failure/,
  );
  assert.equal(globalThis.__offeringMonitorJobRow.metadata.registry_alert_status, "pending");
  globalThis.__offeringMonitorRpcFailure = false;
});

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
