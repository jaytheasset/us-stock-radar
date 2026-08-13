import {
  buildGenericMonitorChildIdentities,
  type GenericMonitorChildIdentity,
  type GenericMonitorPrimaryExecutionContext,
  type GenericMonitorSourceFamily,
} from "./genericMonitorChildExecution.ts";
import { readMonitorRoutingResultFromPrimaryOutput } from "./monitorRouting.ts";

const SEC_8K_6K_FORM_TYPES = new Set(["8-K", "6-K"]);

type WorkflowStart = (
  workflow: unknown,
  args: [GenericMonitorChildIdentity],
) => Promise<{ runId: string }>;

type StarterRepository = {
  reserve(identity: GenericMonitorChildIdentity): Promise<{ reserved: boolean; jobId: string }>;
  claimWorkflowStart(identity: GenericMonitorChildIdentity): Promise<boolean>;
  releaseWorkflowStart(identity: GenericMonitorChildIdentity, error?: unknown): Promise<unknown>;
  attachWorkflowRun(identity: GenericMonitorChildIdentity, workflowRunId: string): Promise<unknown>;
};

export type GenericMonitorChildEnqueueResult =
  | { status: "not_routed" | "out_of_scope"; childCount: 0 }
  | {
      status: "enqueued" | "duplicate" | "enqueue_failed";
      childCount: 1;
      jobId: string;
      workflowRunId?: string;
      error?: string;
      linkageWarning?: string;
    };

export function buildGenericMonitorPrimaryExecutionContext(input: {
  eventId: string;
  rawItemId: string;
  sourceGroup: "news" | "filings";
  sourceCode: string;
  sourceIdentity: string;
  parentPrimaryAiRunId: string;
  parentPromptKey: string;
  parentPromptVersion: string;
  secFormType?: string | null;
}): GenericMonitorPrimaryExecutionContext | null {
  const sourceFamily = sourceFamilyForProductionSource(input.sourceGroup, input.sourceCode, input.secFormType);
  if (!sourceFamily) return null;
  return {
    eventId: input.eventId,
    rawItemId: input.rawItemId,
    sourceFamily,
    sourceGroup: input.sourceGroup,
    sourceCode: input.sourceCode,
    sourceIdentity: input.sourceIdentity,
    parentPrimaryAiRunId: input.parentPrimaryAiRunId,
    parentPromptKey: input.parentPromptKey,
    parentPromptVersion: input.parentPromptVersion,
  };
}

export async function enqueueGenericMonitorChildrenAfterPrimary(input: {
  primary: GenericMonitorPrimaryExecutionContext | null;
  primaryAnalysis: unknown;
  dependencies?: {
    repository?: StarterRepository;
    startWorkflow?: WorkflowStart;
  };
}): Promise<GenericMonitorChildEnqueueResult> {
  if (!input.primary) return { status: "out_of_scope", childCount: 0 };
  const routing = readMonitorRoutingResultFromPrimaryOutput(input.primaryAnalysis);
  if (!routing || routing.monitor_routes.length === 0) {
    return { status: "not_routed", childCount: 0 };
  }

  const identities = buildGenericMonitorChildIdentities({
    primary: input.primary,
    monitorRouting: routing,
  });
  if (identities.length !== 1) {
    throw new Error("Generic Monitor production fan-out expected exactly one validated child route");
  }

  const identity = identities[0];
  const repository = input.dependencies?.repository || await defaultRepository();
  const startWorkflow = input.dependencies?.startWorkflow || defaultStartWorkflow;
  try {
    await repository.reserve(identity);
    const ownsStart = await repository.claimWorkflowStart(identity);
    if (!ownsStart) {
      return { status: "duplicate", childCount: 1, jobId: identity.executionId };
    }
  } catch (error) {
    return {
      status: "enqueue_failed",
      childCount: 1,
      jobId: identity.executionId,
      error: errorMessage(error, "Generic Monitor durable reservation failed"),
    };
  }

  let run: { runId: string };
  try {
    const workflow = input.dependencies?.startWorkflow
      ? null
      : (await import("../../workflows/generic-monitor-child.ts")).genericMonitorChildWorkflow;
    run = await startWorkflow(workflow, [identity]);
  } catch (error) {
    await repository.releaseWorkflowStart(identity, error).catch(() => null);
    return {
      status: "enqueue_failed",
      childCount: 1,
      jobId: identity.executionId,
      error: errorMessage(error, "Generic Monitor durable workflow start failed"),
    };
  }

  try {
    await repository.attachWorkflowRun(identity, run.runId);
    return {
      status: "enqueued",
      childCount: 1,
      jobId: identity.executionId,
      workflowRunId: run.runId,
    };
  } catch (error) {
    return {
      status: "enqueued",
      childCount: 1,
      jobId: identity.executionId,
      workflowRunId: run.runId,
      linkageWarning: errorMessage(error, "Generic Monitor workflow run linkage was not recorded"),
    };
  }
}

async function defaultRepository(): Promise<StarterRepository> {
  return (await import("./genericMonitorChildSupabaseRepository.ts")).genericMonitorChildRepository;
}

async function defaultStartWorkflow(workflow: unknown, args: [GenericMonitorChildIdentity]) {
  const { start } = await import("workflow/api");
  return (start as WorkflowStart)(workflow, args);
}

function sourceFamilyForProductionSource(
  sourceGroup: "news" | "filings",
  sourceCode: string,
  secFormType: string | null | undefined,
): GenericMonitorSourceFamily | null {
  if (sourceGroup === "news") {
    return sourceCode === "nasdaq_corporate_actions" ? "nasdaq_corporate_actions" : "news";
  }
  if (sourceCode !== "sec_edgar" || !SEC_8K_6K_FORM_TYPES.has(normalizeSecFormType(secFormType))) {
    return null;
  }
  return "sec_8k_6k";
}

function normalizeSecFormType(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}
