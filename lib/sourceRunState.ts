import {
  supabaseRpc,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase";

export type SourceRunTerminalStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type WorkflowSourceRunAttempt = {
  sourceRunId: string;
  workflowRunId: string;
  workflowStepId: string;
  workflowAttempt: number;
  triggerId: string;
  lockKey: string;
  lockOwner: string;
};

type SourceRunStateDependencies = {
  rpc: typeof supabaseRpc;
  select: typeof supabaseSelect;
  update: typeof supabaseUpdate;
};

const TERMINAL_STATUSES = new Set<SourceRunTerminalStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export function workflowSourceRunMetadata(
  attempt: WorkflowSourceRunAttempt | undefined,
) {
  return attempt
    ? {
        workflow_run_id: attempt.workflowRunId,
        workflow_step_id: attempt.workflowStepId,
        workflow_attempt: attempt.workflowAttempt,
        workflow_trigger_id: attempt.triggerId,
        workflow_lock_key: attempt.lockKey,
        workflow_lock_owner: attempt.lockOwner,
      }
    : {};
}

export async function registerWorkflowSourceRun(
  input: {
    runId: string;
    sourceCode: string;
    sourceGroup: "news" | "filings" | "market";
    runType: string;
    startedAt: string;
    stats: Record<string, unknown>;
    metadata: Record<string, unknown>;
  },
  dependencies: Pick<SourceRunStateDependencies, "rpc"> = {
    rpc: supabaseRpc,
  },
) {
  const result = await dependencies.rpc("register_workflow_source_run", {
    p_run_id: input.runId,
    p_source_code: input.sourceCode,
    p_source_group: input.sourceGroup,
    p_run_type: input.runType,
    p_started_at: input.startedAt,
    p_stats: input.stats,
    p_metadata: input.metadata,
  });
  assertMutation(result, `register Workflow source run ${input.runId}`);
  const status = stringValue(result.data);
  if (!["queued", "running", "completed", "failed", "skipped", "cancelled"].includes(status)) {
    throw new Error(`Workflow source run ${input.runId} registered with unexpected status ${status || "unknown"}`);
  }
  return status;
}

export async function cancelWorkflowSourceRuns(
  workflowRunId: string,
  dependencies: Pick<SourceRunStateDependencies, "rpc"> = {
    rpc: supabaseRpc,
  },
) {
  const result = await dependencies.rpc("cancel_workflow_source_runs", {
    p_workflow_run_id: workflowRunId,
  });
  assertMutation(result, `cancel source runs for Workflow ${workflowRunId}`);
  const updatedCount = Number(result.data);
  if (!Number.isInteger(updatedCount) || updatedCount < 0) {
    throw new Error(`Workflow ${workflowRunId} cancellation returned an invalid update count`);
  }
  return updatedCount;
}

export async function transitionSourceRunToTerminal(
  input: {
    runId: string;
    status: SourceRunTerminalStatus;
    stats: Record<string, unknown>;
    errorMessage?: string;
    metadata: Record<string, unknown>;
    workflowRunId?: string;
    allowQueued?: boolean;
  },
  dependencies: Pick<SourceRunStateDependencies, "select" | "update"> = {
    select: supabaseSelect,
    update: supabaseUpdate,
  },
) {
  const workflowRunId = input.workflowRunId || stringValue(input.metadata.workflow_run_id);
  const allowedStatuses = input.allowQueued ? "in.(queued,running)" : "eq.running";
  const filters: Record<string, string> = {
    id: `eq.${input.runId}`,
    status: allowedStatuses,
  };
  if (workflowRunId) {
    filters["metadata->>workflow_run_id"] = `eq.${workflowRunId}`;
  }

  const finishedAt = new Date().toISOString();
  const result = await dependencies.update(
    "source_runs",
    filters,
    {
      status: input.status,
      finished_at: finishedAt,
      stats: input.stats,
      error_message: input.errorMessage || null,
      metadata: input.metadata,
    },
  );
  assertMutation(result, `transition source run ${input.runId} to ${input.status}`);

  const updated = records(result.data)[0];
  if (updated) {
    return { outcome: "transitioned" as const, row: updated };
  }

  const current = await dependencies.select("source_runs", {
    select: "id,status,started_at,finished_at,stats,error_message,metadata",
    id: `eq.${input.runId}`,
    limit: "1",
  });
  if (!current.ok) {
    throw new Error(
      `read source run ${input.runId} after terminal transition failed: ${current.error || `HTTP ${current.status}`}`,
    );
  }
  const row = records(current.data)[0];
  if (!row) {
    throw new Error(`source run ${input.runId} is missing`);
  }

  if (workflowRunId) {
    const boundWorkflowRunId = stringValue(record(row.metadata)?.workflow_run_id);
    if (boundWorkflowRunId !== workflowRunId) {
      throw new Error(`source run ${input.runId} is not bound to Workflow run ${workflowRunId}`);
    }
  }

  const currentStatus = stringValue(row.status);
  if (TERMINAL_STATUSES.has(currentStatus as SourceRunTerminalStatus)) {
    return {
      outcome: currentStatus === input.status ? "idempotent" as const : "preserved" as const,
      row,
    };
  }

  throw new Error(
    `source run ${input.runId} remained in non-terminal status ${currentStatus || "unknown"}`,
  );
}

export async function readSourceRunsForWorkflow(
  workflowRunId: string,
  dependencies: Pick<SourceRunStateDependencies, "select"> = {
    select: supabaseSelect,
  },
) {
  const result = await dependencies.select("source_runs", {
    select: "id,status,started_at,finished_at,stats,error_message,metadata",
    "metadata->>workflow_run_id": `eq.${workflowRunId}`,
    order: "started_at.asc",
    limit: "20",
  });
  if (!result.ok) {
    throw new Error(
      `read source runs for Workflow ${workflowRunId} failed: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  return records(result.data);
}

function assertMutation(
  result: { ok: boolean; status: number; error?: string; data?: unknown },
  label: string,
) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error || `HTTP ${result.status}`}`);
  }
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
