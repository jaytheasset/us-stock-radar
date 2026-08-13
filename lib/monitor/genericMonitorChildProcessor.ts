import type { ListingRiskDomainAnalyzerPreviewResult } from "../ai/listingRiskDomainAnalyzerPreview.ts";
import type { ListingRiskAnalyzerInput } from "./listingRiskAnalyzer.ts";
import type { ListingRiskAnalyzerResult } from "./listingRiskAnalyzer.ts";
import type { GenericMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import { listingRiskTerminalStateAfterPersistence, type ListingRiskPersistenceResult } from "./listingRiskPersistence.ts";
import type { GenericMonitorExactParent } from "./genericMonitorChildRepository.ts";

export type GenericMonitorChildProcessorRepository = {
  claim(identity: GenericMonitorChildIdentity): Promise<boolean>;
  releaseForRetry(identity: GenericMonitorChildIdentity, error?: unknown): Promise<unknown>;
  recordTerminal(
    identity: GenericMonitorChildIdentity,
    state: "succeeded_applicable" | "succeeded_not_applicable" | "failed" | "stale",
    options?: { error?: unknown },
  ): Promise<unknown>;
  loadExactParent(identity: GenericMonitorChildIdentity): Promise<GenericMonitorExactParent>;
};

export async function processGenericMonitorChildWithDependencies(
  identity: GenericMonitorChildIdentity,
  dependencies: {
    repository: GenericMonitorChildProcessorRepository;
    buildAnalyzerInput(
      identity: GenericMonitorChildIdentity,
      rawItem: Record<string, unknown>,
      primaryAnalysis: Record<string, unknown>,
    ): ListingRiskAnalyzerInput;
    runAnalyzer(input: ListingRiskAnalyzerInput): Promise<ListingRiskDomainAnalyzerPreviewResult>;
    persist(input: {
      identity: GenericMonitorChildIdentity;
      result: ListingRiskAnalyzerResult;
    }): Promise<ListingRiskPersistenceResult>;
  },
) {
  const repository = dependencies.repository;
  const claimed = await repository.claim(identity);
  if (!claimed) return { status: "duplicate" as const, jobId: identity.executionId, providerCalls: 0 };

  let parent: GenericMonitorExactParent;
  try {
    parent = await repository.loadExactParent(identity);
  } catch (error) {
    await repository.recordTerminal(identity, "failed", { error });
    return { status: "failed" as const, jobId: identity.executionId, providerCalls: 0, error: errorMessage(error) };
  }
  if (parent.currentness.status !== "current") {
    await repository.recordTerminal(identity, "stale");
    return { status: "stale" as const, jobId: identity.executionId, providerCalls: 0 };
  }

  let analyzerInput: ListingRiskAnalyzerInput;
  try {
    analyzerInput = dependencies.buildAnalyzerInput(identity, parent.rawItem, parent.analysis);
  } catch (error) {
    await repository.recordTerminal(identity, "failed", { error });
    return { status: "failed" as const, jobId: identity.executionId, providerCalls: 0, error: errorMessage(error) };
  }

  let analyzerRun: ListingRiskDomainAnalyzerPreviewResult;
  try {
    analyzerRun = await dependencies.runAnalyzer(analyzerInput);
  } catch (error) {
    await repository.releaseForRetry(identity, error);
    return retryableFailure(identity, error);
  }
  if (analyzerRun.stage !== "complete") {
    await repository.releaseForRetry(identity, analyzerRun.error);
    return retryableFailure(identity, analyzerRun.error);
  }

  let persistence: ListingRiskPersistenceResult;
  try {
    persistence = await dependencies.persist({ identity, result: analyzerRun.result });
  } catch (error) {
    await repository.releaseForRetry(identity, error);
    return retryableFailure(identity, error);
  }
  if (persistence.status === "stale") {
    await repository.recordTerminal(identity, "stale");
    return { status: "stale" as const, jobId: identity.executionId, providerCalls: 1 };
  }
  const terminalState = listingRiskTerminalStateAfterPersistence(analyzerRun.result, persistence);
  if (!terminalState) {
    const error = `Listing Risk persistence ${persistence.status}`;
    await repository.releaseForRetry(identity, error);
    return retryableFailure(identity, error);
  }
  await repository.recordTerminal(identity, terminalState);
  return {
    status: terminalState,
    jobId: identity.executionId,
    providerCalls: 1,
    persistence: persistence.status,
  };
}

function retryableFailure(identity: GenericMonitorChildIdentity, error: unknown) {
  return {
    status: "retryable_failure" as const,
    jobId: identity.executionId,
    providerCalls: 1,
    error: errorMessage(error),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Generic Monitor child failed";
}
