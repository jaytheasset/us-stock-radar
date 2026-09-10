import {
  finalizeOfferingMonitorSidecarOnlyJob,
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import {
  completeOfferingMonitorJobAfterSidecar,
  failOfferingMonitorJobAfterSidecar,
  markOfferingMonitorJobFailed,
  markOfferingMonitorJobStaleAfterSidecar,
  readOfferingMonitorParentAuthority,
} from "@/lib/offeringMonitorJobRepository";
import { processOfferingShareCountSidecar } from "@/lib/sec-structured-data/offeringShareCountSidecar";
import { offeringShareCountSidecarRuntimeDependencies } from "@/lib/sec-structured-data/offeringShareCountSidecarRuntime";

export async function offeringMonitorNormalizationWorkflow(identity: OfferingMonitorJobIdentity) {
  "use workflow";

  try {
    let shareCountSidecar;
    try {
      shareCountSidecar = await runOfferingShareCountSidecarStep(identity);
    } catch (error) {
      shareCountSidecar = {
        status: "failed" as const,
        error: errorMessage(error),
        providerCalled: false as const,
      };
    }
    const terminal = await finalizeOfferingMonitorSidecarOnlyStep(identity, shareCountSidecar);
    return { ...terminal, shareCountSidecar };
  } catch (error) {
    return markOfferingMonitorFoundationFailedStep(identity, errorMessage(error));
  }
}

async function runOfferingShareCountSidecarStep(identity: OfferingMonitorJobIdentity) {
  "use step";
  return processOfferingShareCountSidecar(identity, offeringShareCountSidecarRuntimeDependencies);
}
runOfferingShareCountSidecarStep.maxRetries = 0;

async function finalizeOfferingMonitorSidecarOnlyStep(
  identity: OfferingMonitorJobIdentity,
  sidecar: Awaited<ReturnType<typeof runOfferingShareCountSidecarStep>> | {
    status: "failed";
    error: string;
    providerCalled: false;
  },
) {
  "use step";
  return finalizeOfferingMonitorSidecarOnlyJob(identity, sidecar, {
    readParentAuthority: readOfferingMonitorParentAuthority,
    completeAfterSidecar: completeOfferingMonitorJobAfterSidecar,
    failAfterSidecar: failOfferingMonitorJobAfterSidecar,
    markStaleAfterSidecar: markOfferingMonitorJobStaleAfterSidecar,
  });
}
finalizeOfferingMonitorSidecarOnlyStep.maxRetries = 3;

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
