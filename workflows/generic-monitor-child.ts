import type { GenericMonitorChildIdentity } from "@/lib/monitor/genericMonitorChildExecution";
import { processGenericMonitorChild } from "@/lib/monitor/genericMonitorChildRuntime";
import { genericMonitorChildRepository } from "@/lib/monitor/genericMonitorChildSupabaseRepository";

export async function genericMonitorChildWorkflow(identity: GenericMonitorChildIdentity) {
  "use workflow";
  try {
    return await runGenericMonitorChildStep(identity);
  } catch (error) {
    return recoverGenericMonitorChildWorkflowFailure(
      identity,
      error instanceof Error ? error.message : "Generic Monitor child workflow failed",
    );
  }
}

async function runGenericMonitorChildStep(identity: GenericMonitorChildIdentity) {
  "use step";
  return processGenericMonitorChild(identity);
}
runGenericMonitorChildStep.maxRetries = 0;

export async function recoverGenericMonitorChildWorkflowFailure(
  identity: GenericMonitorChildIdentity,
  error: string,
) {
  "use step";
  await genericMonitorChildRepository.recoverWorkflowFailure(identity, error);
  return { status: "retryable_failure" as const, jobId: identity.executionId, error };
}
recoverGenericMonitorChildWorkflowFailure.maxRetries = 3;
