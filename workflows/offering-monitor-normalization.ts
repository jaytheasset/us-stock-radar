import {
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import { processOfferingMonitorSecondStageJob } from "@/lib/offeringMonitorSecondStage";
import { offeringMonitorSecondStageRuntimeDependencies } from "@/lib/offeringMonitorSecondStageRuntime";
import { processOfferingMonitorProductionWiring } from "@/lib/offeringMonitorProductionWiring";
import {
  markOfferingMonitorJobFailed,
} from "@/lib/offeringMonitorJobRepository";

export async function offeringMonitorNormalizationWorkflow(identity: OfferingMonitorJobIdentity) {
  "use workflow";

  try {
    const secondStage = await runOfferingMonitorSecondStageStep(identity);
    if (secondStage.status !== "completed") return secondStage;
    try {
      const productionWiring = await runOfferingMonitorProductionWiringStep(identity, secondStage);
      return { ...secondStage, productionWiring };
    } catch (error) {
      return {
        ...secondStage,
        productionWiring: {
          status: "failed" as const,
          error: errorMessage(error),
          matcherInvoked: false as const,
        },
      };
    }
  } catch (error) {
    return markOfferingMonitorFoundationFailedStep(identity, errorMessage(error));
  }
}

async function runOfferingMonitorSecondStageStep(identity: OfferingMonitorJobIdentity) {
  "use step";
  return processOfferingMonitorSecondStageJob(identity, offeringMonitorSecondStageRuntimeDependencies);
}
runOfferingMonitorSecondStageStep.maxRetries = 0;

async function runOfferingMonitorProductionWiringStep(
  identity: OfferingMonitorJobIdentity,
  secondStage: Awaited<ReturnType<typeof runOfferingMonitorSecondStageStep>>,
) {
  "use step";
  return processOfferingMonitorProductionWiring(identity, secondStage);
}
runOfferingMonitorProductionWiringStep.maxRetries = 0;

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
