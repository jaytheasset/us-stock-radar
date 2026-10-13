import {consumeOfferingPlanEvent} from './monitor/offeringPlanTrigger.ts';
import { start } from "workflow/api";
import {
  buildOfferingMonitorJobIdentity,
  enqueueOfferingMonitorJobWithDependencies,
  type OfferingMonitorEnqueueResult,
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import {
  attachOfferingMonitorWorkflowRun,
  markOfferingMonitorJobFailed,
  reserveOfferingMonitorJob,
} from "@/lib/offeringMonitorJobRepository";
import { offeringMonitorNormalizationWorkflow } from "@/workflows/offering-monitor-normalization";

type WorkflowStart = (
  workflow: typeof offeringMonitorNormalizationWorkflow,
  args: [OfferingMonitorJobIdentity],
) => Promise<{ runId: string }>;

export type OfferingMonitorAfterPrimaryResult =
  | { status: "not_applicable" }
  | OfferingMonitorEnqueueResult;

export async function enqueueOfferingMonitorAfterPrimary(
  primaryResult: unknown,
  dependencies: {
    evaluateOfferingPlan?: typeof consumeOfferingPlanEvent;
    startWorkflow?: WorkflowStart;
    reserveJob?: typeof reserveOfferingMonitorJob;
    attachWorkflowRun?: typeof attachOfferingMonitorWorkflowRun;
    markFailed?: typeof markOfferingMonitorJobFailed;
  } = {},
): Promise<OfferingMonitorAfterPrimaryResult> {
  const saved = primaryResult && typeof primaryResult === "object" ? primaryResult as Record<string, unknown> : null;
  const event = saved?.event && typeof saved.event === "object" ? saved.event as Record<string,unknown> : null;
  if(saved?.ok === true && typeof event?.id === "string") {
    try { await (dependencies.evaluateOfferingPlan ?? consumeOfferingPlanEvent)(event.id); }
    catch { console.error("[offering-plan-monitor] saved event evaluation failed; retry saved event"); }
  }
  const identity = buildOfferingMonitorJobIdentity(primaryResult);
  if (!identity) return { status: "not_applicable" };
  return enqueueOfferingMonitorJob(identity, dependencies);
}

export async function enqueueOfferingMonitorJob(
  identity: OfferingMonitorJobIdentity,
  dependencies: {
    startWorkflow?: WorkflowStart;
    reserveJob?: typeof reserveOfferingMonitorJob;
    attachWorkflowRun?: typeof attachOfferingMonitorWorkflowRun;
    markFailed?: typeof markOfferingMonitorJobFailed;
  } = {},
): Promise<OfferingMonitorEnqueueResult> {
  const reserveJob = dependencies.reserveJob || reserveOfferingMonitorJob;
  const startWorkflow = dependencies.startWorkflow || (start as WorkflowStart);
  const attachWorkflowRun = dependencies.attachWorkflowRun || attachOfferingMonitorWorkflowRun;
  const markFailed = dependencies.markFailed || markOfferingMonitorJobFailed;
  return enqueueOfferingMonitorJobWithDependencies(identity, {
    reserveJob,
    startWorkflow: async (jobIdentity) => startWorkflow(
      offeringMonitorNormalizationWorkflow,
      [jobIdentity],
    ),
    attachWorkflowRun,
    markFailed,
  });
}
