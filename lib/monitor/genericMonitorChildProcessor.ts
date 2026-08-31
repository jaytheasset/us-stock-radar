import type { GenericMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import type { GenericMonitorChildTerminalState } from "./genericMonitorChildExecution.ts";
import type { GenericMonitorExactParent } from "./genericMonitorChildRepository.ts";
import type { ListingMonitorAlertConsumerResult } from "./listingMonitorAlertConsumer.ts";
import type { Level2ShareCountValidatedCandidate } from "../sec-structured-data/level2ShareCountObservation.ts";

export type ListingMonitorAlertHookResult = ListingMonitorAlertConsumerResult | Readonly<{
  status: "failed";
  eventId: string;
  error: string;
}>;

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

type GenericMonitorAnalyzerRun<TResult> =
  | {
      stage: "complete";
      result: TResult;
      shareCountObservation?: Level2ShareCountValidatedCandidate | null;
    }
  | { stage: string; result: null; error: string; retryError?: unknown };

export async function processGenericMonitorChildWithDependencies<
  TInput,
  TResult extends object,
  TPersistence extends { status: string },
>(
  identity: GenericMonitorChildIdentity,
  dependencies: {
    repository: GenericMonitorChildProcessorRepository;
    buildAnalyzerInput(
      identity: GenericMonitorChildIdentity,
      rawItem: Record<string, unknown>,
      primaryAnalysis: Record<string, unknown>,
    ): TInput | Promise<TInput>;
    runAnalyzer(input: TInput): Promise<GenericMonitorAnalyzerRun<TResult>>;
    persist(input: {
      identity: GenericMonitorChildIdentity;
      result: TResult;
    }): Promise<TPersistence>;
    persistShareCountObservation?(input: {
      identity: GenericMonitorChildIdentity;
      rawItem: Record<string, unknown>;
      candidate: Level2ShareCountValidatedCandidate;
    }): Promise<{ inserted: number; deduped: number }>;
    terminalStateAfterPersistence?(
      result: TResult,
      persistence: TPersistence,
    ): GenericMonitorChildTerminalState | null;
    persistenceFailureError?(result: TResult, error: unknown): unknown;
    afterSuccessfulPersistence?(input: {
      identity: GenericMonitorChildIdentity;
      result: TResult;
      persistence: TPersistence;
    }): Promise<unknown>;
    consumeListingMonitorAlerts?: (input: Readonly<{ eventId: string }>) =>
      Promise<ListingMonitorAlertConsumerResult>;
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

  let analyzerInput: TInput;
  try {
    analyzerInput = await dependencies.buildAnalyzerInput(identity, parent.rawItem, parent.analysis);
  } catch (error) {
    await repository.recordTerminal(identity, "failed", { error });
    return { status: "failed" as const, jobId: identity.executionId, providerCalls: 0, error: errorMessage(error) };
  }

  let analyzerRun: GenericMonitorAnalyzerRun<TResult>;
  try {
    analyzerRun = await dependencies.runAnalyzer(analyzerInput);
  } catch (error) {
    await repository.releaseForRetry(identity, error);
    return retryableFailure(identity, error);
  }
  if (analyzerRun.stage !== "complete" || analyzerRun.result === null) {
    const error = "error" in analyzerRun ? analyzerRun.error : "Analyzer result is unavailable";
    const retryError = "retryError" in analyzerRun && analyzerRun.retryError
      ? analyzerRun.retryError : error;
    await repository.releaseForRetry(identity, retryError);
    return retryableFailure(identity, error);
  }

  let persistence: TPersistence;
  try {
    persistence = await dependencies.persist({ identity, result: analyzerRun.result });
  } catch (error) {
    const retryError = dependencies.persistenceFailureError
      ? dependencies.persistenceFailureError(analyzerRun.result, error)
      : error;
    await repository.releaseForRetry(identity, retryError);
    return retryableFailure(identity, error);
  }
  if (persistence.status === "stale") {
    await repository.recordTerminal(identity, "stale");
    return { status: "stale" as const, jobId: identity.executionId, providerCalls: 1 };
  }
  let shareCountPersistence: { inserted: number; deduped: number } | undefined;
  const shareCountObservation = "shareCountObservation" in analyzerRun
    ? analyzerRun.shareCountObservation
    : null;
  if (shareCountObservation && dependencies.persistShareCountObservation) {
    try {
      shareCountPersistence = await dependencies.persistShareCountObservation({
        identity,
        rawItem: parent.rawItem,
        candidate: shareCountObservation,
      });
    } catch (error) {
      await repository.releaseForRetry(identity, error);
      return retryableFailure(identity, error);
    }
  }
  const terminalState = dependencies.terminalStateAfterPersistence
    ? dependencies.terminalStateAfterPersistence(analyzerRun.result, persistence)
    : defaultListingTerminalState(analyzerRun.result, persistence);
  if (!terminalState) {
    const error = `${identity.monitorAnalyzerKey} persistence ${persistence.status}`;
    await repository.releaseForRetry(identity, error);
    return retryableFailure(identity, error);
  }
  await repository.recordTerminal(identity, terminalState);
  let postPersistence: unknown;
  if (terminalState === "succeeded_applicable" && dependencies.afterSuccessfulPersistence) {
    try {
      postPersistence = await dependencies.afterSuccessfulPersistence({
        identity,
        result: analyzerRun.result,
        persistence,
      });
    } catch (error) {
      postPersistence = { status: "failed", error: errorMessage(error) };
    }
  }
  let listingMonitorAlerts: ListingMonitorAlertHookResult | undefined;
  if (terminalState === "succeeded_applicable" && dependencies.consumeListingMonitorAlerts) {
    try {
      listingMonitorAlerts = await dependencies.consumeListingMonitorAlerts({ eventId: identity.eventId });
    } catch (error) {
      listingMonitorAlerts = {
        status: "failed",
        eventId: identity.eventId,
        error: errorMessage(error),
      };
    }
  }
  return {
    status: terminalState,
    jobId: identity.executionId,
    providerCalls: 1,
    persistence: persistence.status,
    ...(postPersistence !== undefined ? { postPersistence } : {}),
    ...(shareCountPersistence ? { shareCountPersistence } : {}),
    ...(listingMonitorAlerts ? { listingMonitorAlerts } : {}),
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

function defaultListingTerminalState(
  analyzerResult: object,
  persistenceResult: { status: string },
): GenericMonitorChildTerminalState | null {
  const result = analyzerResult as Record<string, unknown>;
  const persistence = persistenceResult as Record<string, unknown>;
  if (
    !["saved", "idempotent"].includes(persistenceResult.status)
    || persistence.resultStatus !== result.status
  ) return null;
  if (result.status === "applicable") return "succeeded_applicable";
  if (result.status === "not_applicable") return "succeeded_not_applicable";
  return null;
}
