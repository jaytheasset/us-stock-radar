import {
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import { processOfferingMonitorSecondStageJob } from "@/lib/offeringMonitorSecondStage";
import { offeringMonitorSecondStageRuntimeDependencies } from "@/lib/offeringMonitorSecondStageRuntime";
import {
  markOfferingMonitorJobFailed,
} from "@/lib/offeringMonitorJobRepository";

export async function offeringMonitorNormalizationWorkflow(identity: OfferingMonitorJobIdentity) {
  "use workflow";

  try {
    return await runOfferingMonitorSecondStageStep(identity);
  } catch (error) {
    return markOfferingMonitorFoundationFailedStep(identity, errorMessage(error));
  }
}

async function runOfferingMonitorSecondStageStep(identity: OfferingMonitorJobIdentity) {
  "use step";
  return processOfferingMonitorSecondStageJob(identity, offeringMonitorSecondStageRuntimeDependencies);
}
runOfferingMonitorSecondStageStep.maxRetries = 0;

async function markOfferingMonitorFoundationFailedStep(
  identity: OfferingMonitorJobIdentity,
  error: string,
) {
  "use step";

  await markOfferingMonitorJobFailed(identity.jobId, error);
  return {
    status: "failed" as const,
    jobId: identity.jobId,
    parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
    error,
  };
}
markOfferingMonitorFoundationFailedStep.maxRetries = 3;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Offering Monitor foundation failed";
}
