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
    startWorkflow?: WorkflowStart;
    reserveJob?: typeof reserveOfferingMonitorJob;
    attachWorkflowRun?: typeof attachOfferingMonitorWorkflowRun;
    markFailed?: typeof markOfferingMonitorJobFailed;
  } = {},
): Promise<OfferingMonitorAfterPrimaryResult> {
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
