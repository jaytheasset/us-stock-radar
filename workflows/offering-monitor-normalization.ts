import { RetryableError } from "workflow";
import {
  processOfferingMonitorFoundationJob,
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import {
  claimOfferingMonitorJob,
  completeOfferingMonitorJob,
  markOfferingMonitorJobFailed,
  markOfferingMonitorJobStale,
  readOfferingMonitorParentAuthority,
} from "@/lib/offeringMonitorJobRepository";

export async function offeringMonitorNormalizationWorkflow(identity: OfferingMonitorJobIdentity) {
  "use workflow";

  try {
    return await runOfferingMonitorFoundationStep(identity);
  } catch (error) {
    return markOfferingMonitorFoundationFailedStep(identity, errorMessage(error));
  }
}

async function runOfferingMonitorFoundationStep(identity: OfferingMonitorJobIdentity) {
  "use step";

  try {
    return await processOfferingMonitorFoundationJob(identity, {
      readParentAuthority: readOfferingMonitorParentAuthority,
      claimJob: claimOfferingMonitorJob,
      completeJob: completeOfferingMonitorJob,
      markStale: markOfferingMonitorJobStale,
    });
  } catch (error) {
    throw new RetryableError(errorMessage(error));
  }
}
runOfferingMonitorFoundationStep.maxRetries = 3;

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
