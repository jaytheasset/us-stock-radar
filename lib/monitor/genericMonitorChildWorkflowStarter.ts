import {
  buildGenericMonitorChildIdentities,
  buildPeriodicFinancialMonitorChildIdentity,
  type GenericMonitorChildIdentity,
  type GenericMonitorPrimaryExecutionContext,
  type GenericMonitorSourceFamily,
} from "./genericMonitorChildExecution.ts";
import { readMonitorRoutingResultFromPrimaryOutput } from "./monitorRouting.ts";
import { FORM25_LISTING_FORMS } from "./form25ListingRisk.ts";

const SEC_8K_6K_FORM_TYPES = new Set(["8-K", "6-K"]);
const SEC_8K_6K_AMENDMENT_FORM_TYPES = new Set(["8-K/A", "6-K/A"]);
const SEC_PERIODIC_FINANCIAL_FORM_TYPES = new Set([
  "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A",
]);

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
      childCount: number;
      jobId?: string;
      workflowRunId?: string;
      error?: string;
      linkageWarning?: string;
      children?: GenericMonitorChildEnqueueItem[];
    };

type GenericMonitorChildEnqueueItem = {
  status: "enqueued" | "duplicate" | "enqueue_failed";
  monitorAnalyzerKey: GenericMonitorChildIdentity["monitorAnalyzerKey"];
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
  /** Present only after the SEC amendment bridge has persisted an exact linked REPLACE/SUPPLEMENT decision. */
  secAmendmentAlertEventId?: string | null;
  secAmendmentLineage?: GenericMonitorPrimaryExecutionContext["secAmendmentLineage"];
}): GenericMonitorPrimaryExecutionContext | null {
  const sourceFamily = sourceFamilyForProductionSource(
    input.sourceGroup,
    input.sourceCode,
    input.secFormType,
    Boolean(input.secAmendmentAlertEventId),
  );
  if (!sourceFamily) return null;
  return {
    eventId: input.eventId,
    alertEventId: input.secAmendmentAlertEventId || input.eventId,
    rawItemId: input.rawItemId,
    sourceFamily,
    sourceGroup: input.sourceGroup,
    sourceCode: input.sourceCode,
    sourceIdentity: input.sourceIdentity,
    parentPrimaryAiRunId: input.parentPrimaryAiRunId,
    parentPromptKey: input.parentPromptKey,
    parentPromptVersion: input.parentPromptVersion,
    ...(input.secAmendmentLineage
      ? { secAmendmentLineage: input.secAmendmentLineage }
      : {}),
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
  const identities = input.primary.sourceFamily === "sec_periodic_reports"
    ? [buildPeriodicFinancialMonitorChildIdentity({ primary: input.primary })]
    : input.primary.sourceFamily === "sec_form25"
    ? buildGenericMonitorChildIdentities({ primary: input.primary,
      monitorRouting: { monitor_routes: [{monitor_analyzer_key:"listing_risk"}] } })
    : buildRoutedIdentities(input.primary, input.primaryAnalysis);
  if (identities.length === 0) return { status: "not_routed", childCount: 0 };
  const repository = input.dependencies?.repository || await defaultRepository();
  const startWorkflow = input.dependencies?.startWorkflow || defaultStartWorkflow;
  const children = await Promise.all(identities.map((identity) => enqueueOne({
    identity,
    repository,
    startWorkflow,
    injectedStartWorkflow: Boolean(input.dependencies?.startWorkflow),
  })));
  if (children.length === 1) {
    const [{ monitorAnalyzerKey: _monitorAnalyzerKey, ...single }] = children;
    return { ...single, childCount: 1 };
  }
  const status = children.some((child) => child.status === "enqueue_failed")
    ? "enqueue_failed"
    : children.every((child) => child.status === "duplicate")
      ? "duplicate"
      : "enqueued";
  return { status, childCount: children.length, children };
}

async function enqueueOne(input: {
  identity: GenericMonitorChildIdentity;
  repository: StarterRepository;
  startWorkflow: WorkflowStart;
  injectedStartWorkflow: boolean;
}): Promise<GenericMonitorChildEnqueueItem> {
  const { identity, repository, startWorkflow } = input;
  try {
    await repository.reserve(identity);
    const ownsStart = await repository.claimWorkflowStart(identity);
    if (!ownsStart) {
      return {
        status: "duplicate",
        monitorAnalyzerKey: identity.monitorAnalyzerKey,
        jobId: identity.executionId,
      };
    }
  } catch (error) {
    return {
      status: "enqueue_failed",
      monitorAnalyzerKey: identity.monitorAnalyzerKey,
      jobId: identity.executionId,
      error: errorMessage(error, "Generic Monitor durable reservation failed"),
    };
  }

  let run: { runId: string };
  try {
    const workflow = input.injectedStartWorkflow
      ? null
      : (await import("../../workflows/generic-monitor-child.ts")).genericMonitorChildWorkflow;
    run = await startWorkflow(workflow, [identity]);
  } catch (error) {
    await repository.releaseWorkflowStart(identity, error).catch(() => null);
    return {
      status: "enqueue_failed",
      monitorAnalyzerKey: identity.monitorAnalyzerKey,
      jobId: identity.executionId,
      error: errorMessage(error, "Generic Monitor durable workflow start failed"),
    };
  }

  try {
    await repository.attachWorkflowRun(identity, run.runId);
    return {
      status: "enqueued",
      monitorAnalyzerKey: identity.monitorAnalyzerKey,
      jobId: identity.executionId,
      workflowRunId: run.runId,
    };
  } catch (error) {
    return {
      status: "enqueued",
      monitorAnalyzerKey: identity.monitorAnalyzerKey,
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
  amendmentAuthorized: boolean,
): GenericMonitorSourceFamily | null {
  if (sourceGroup === "news") {
    return sourceCode === "nasdaq_corporate_actions" ? "nasdaq_corporate_actions" : "news";
  }
  const normalizedForm = normalizeSecFormType(secFormType);
  if (sourceCode === "sec_edgar" && (FORM25_LISTING_FORMS as readonly string[]).includes(normalizedForm)) return "sec_form25";
  const currentReportAllowed = SEC_8K_6K_FORM_TYPES.has(normalizedForm)
    || (amendmentAuthorized && SEC_8K_6K_AMENDMENT_FORM_TYPES.has(normalizedForm));
  if (sourceCode !== "sec_edgar" || !currentReportAllowed) {
    return sourceCode === "sec_edgar" && SEC_PERIODIC_FINANCIAL_FORM_TYPES.has(normalizeSecFormType(secFormType))
      ? "sec_periodic_reports"
      : null;
  }
  return "sec_8k_6k";
}

function buildRoutedIdentities(
  primary: GenericMonitorPrimaryExecutionContext,
  primaryAnalysis: unknown,
) {
  const routing = readMonitorRoutingResultFromPrimaryOutput(primaryAnalysis);
  return !routing || routing.monitor_routes.length === 0
    ? []
    : buildGenericMonitorChildIdentities({ primary, monitorRouting: routing });
}

function normalizeSecFormType(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}
