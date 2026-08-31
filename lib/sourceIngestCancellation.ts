import "server-only";

import { getRun } from "workflow/api";
import {
  cancelWorkflowSourceRuns,
  readSourceRunsForWorkflow,
} from "@/lib/sourceRunState";

type WorkflowRunHandle = {
  cancel(): Promise<void>;
  status: Promise<string>;
};

type CancellationDependencies = {
  getRun: (workflowRunId: string) => WorkflowRunHandle;
  cancelSourceRuns: typeof cancelWorkflowSourceRuns;
  readSourceRuns: typeof readSourceRunsForWorkflow;
};

export async function cancelSourceIngestWorkflowRun(
  workflowRunId: string,
  dependencies: CancellationDependencies = {
    getRun,
    cancelSourceRuns: cancelWorkflowSourceRuns,
    readSourceRuns: readSourceRunsForWorkflow,
  },
) {
  const normalizedRunId = normalizeWorkflowRunId(workflowRunId);
  const run = dependencies.getRun(normalizedRunId);
  let workflowStatus = await run.status;

  if (workflowStatus === "pending" || workflowStatus === "running") {
    try {
      await run.cancel();
    } catch (error) {
      workflowStatus = await run.status;
      if (workflowStatus !== "completed" && workflowStatus !== "failed" && workflowStatus !== "cancelled") {
        throw error;
      }
    }
    workflowStatus = await run.status;
  }

  if (workflowStatus !== "cancelled" && workflowStatus !== "completed" && workflowStatus !== "failed") {
    throw new Error(`Workflow run ${normalizedRunId} has unsupported status ${workflowStatus || "unknown"}`);
  }

  const sourceRuns = await dependencies.readSourceRuns(normalizedRunId);
  if (workflowStatus !== "cancelled") {
    return {
      workflowRunId: normalizedRunId,
      workflowStatus,
      sourceRuns: sourceRuns.map(summarizeSourceRun),
      transitions: [],
    };
  }

  const reconciledSourceRunCount = await dependencies.cancelSourceRuns(normalizedRunId);
  const refreshed = await dependencies.readSourceRuns(normalizedRunId);
  const previousStatusById = new Map(
    sourceRuns.map((row) => [stringValue(row.id), stringValue(row.status)]),
  );
  const transitions = refreshed
    .filter((row) => stringValue(row.status) === "cancelled")
    .map((row) => {
      const sourceRunId = stringValue(row.id);
      const previousStatus = previousStatusById.get(sourceRunId);
      return {
        sourceRunId,
        outcome: previousStatus === "cancelled" ? "idempotent" as const : "transitioned" as const,
        status: "cancelled",
      };
    });
  return {
    workflowRunId: normalizedRunId,
    workflowStatus,
    sourceRuns: refreshed.map(summarizeSourceRun),
    transitions,
    reconciledSourceRunCount,
  };
}

function normalizeWorkflowRunId(value: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^wrun_[A-Za-z0-9_-]{10,120}$/.test(normalized)) {
    throw new Error("A valid Workflow run ID is required.");
  }
  return normalized;
}

function summarizeSourceRun(row: Record<string, unknown>) {
  return {
    id: stringValue(row.id) || null,
    status: stringValue(row.status) || "unknown",
    startedAt: stringValue(row.started_at) || null,
    finishedAt: stringValue(row.finished_at) || null,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
