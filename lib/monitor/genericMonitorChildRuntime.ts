import { buildInputFromSecRawRow } from "../ai/secFilingAnalysisPreview.ts";
import {
  runListingRiskDomainAnalyzerPreview,
  type ListingRiskDomainAnalyzerPreviewResult,
} from "../ai/listingRiskDomainAnalyzerPreview.ts";
import {
  runCorporateActionCanonicalAnalyzerPreview,
  type CorporateActionCanonicalAnalyzerPreviewResult,
} from "../ai/corporateActionCanonicalAnalyzerPreview.ts";
import { buildSecSourceBlockPromptInput } from "../sources/sec/forms/8k-6k/sourceBlockPromptInput.ts";
import type { ListingRiskAnalyzerInput } from "./listingRiskAnalyzer.ts";
import type {
  CorporateActionAnalyzerInput,
  CorporateActionAnalyzerResult,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCorporateActionApplicabilityContext,
  type CorporateActionApplicabilityContext,
  unavailableCorporateActionApplicabilityContext,
} from "./corporateActionApplicabilityContext.ts";
import type { GenericMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import { genericMonitorChildRepository } from "./genericMonitorChildSupabaseRepository.ts";
import {
  persistListingRiskAnalyzerResult,
  listingRiskTerminalStateAfterPersistence,
  type ListingRiskPersistenceResult,
} from "./listingRiskPersistence.ts";
import {
  corporateActionTerminalStateAfterPersistence,
  persistCorporateActionAnalyzerResult,
  type CorporateActionPersistenceResult,
} from "./corporateActionPersistence.ts";
import {
  adaptNasdaqListingRiskSource,
  adaptNewsListingRiskSource,
  adaptSec8k6kListingRiskSource,
} from "./listingRiskSourceAdapters.ts";
import {
  adaptNasdaqCorporateActionSource,
  adaptNewsCorporateActionSource,
  adaptSec8k6kCorporateActionSource,
} from "./corporateActionSourceAdapters.ts";
import { processGenericMonitorChildWithDependencies } from "./genericMonitorChildProcessor.ts";
import {
  consumeListingMonitorAlertsForEvent,
  type ListingMonitorAlertConsumerResult,
} from "./listingMonitorAlertConsumer.ts";
import {
  consumeFinancialMonitorAlertsForEvent,
  type FinancialMonitorAlertConsumerResult,
} from "./financialMonitorAlertConsumer.ts";
import { persistLevel2ShareCountObservationFromSecRawItem } from "../sec-structured-data/level2ShareCountPersistenceRuntime.ts";
import type { Level2ShareCountValidatedCandidate } from "../sec-structured-data/level2ShareCountObservation.ts";
import {
  buildPersistedStockSplitMaterializationDiagnostic,
  stockSplitMaterializationError,
} from "./stockSplitMaterialization.ts";
import { runDilutionCorporateActionAdjustmentForEvent } from "../dilution-registry/corporateActionAdjustmentRuntime.ts";
import {
  assertPeriodicFinancialMonitorAnalysisIdentity,
  PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY,
  readPeriodicFinancialRawFilingIdentity,
  type PeriodicFinancialFilingIdentity,
  type PeriodicFinancialMonitorAnalysis,
} from "./periodicFinancialMonitor.ts";
import { persistSecAmendmentMonitorReplacement, verifySecAmendmentExecutionAuthorization } from "../sec-amendments/secAmendmentMonitorBridge.ts";
import { persistListingRiskStatusAutomatically } from "../sec-listing-status/listingRiskAutomaticPersistence.ts";

type RuntimeRepository = Pick<
  typeof genericMonitorChildRepository,
  "claim" | "releaseForRetry" | "recordTerminal" | "loadExactParent"
>;

type PeriodicFinancialRuntimeRepository = RuntimeRepository;

export async function processGenericMonitorChild(
  identity: GenericMonitorChildIdentity,
  dependencies: {
    repository?: RuntimeRepository;
    runListingRiskAnalyzer?: (input: ListingRiskAnalyzerInput) => Promise<ListingRiskDomainAnalyzerPreviewResult>;
    persistListingRisk?: (input: {
      identity: GenericMonitorChildIdentity;
      result: unknown;
    }) => Promise<ListingRiskPersistenceResult>;
    consumeListingMonitorAlerts?: (input: Readonly<{ eventId: string }>) =>
      Promise<ListingMonitorAlertConsumerResult>;
    persistListingStatus?: typeof persistListingRiskStatusAutomatically;
    runCorporateActionAnalyzer?: (
      input: CorporateActionAnalyzerInput,
    ) => Promise<CorporateActionCanonicalAnalyzerPreviewResult>;
    persistCorporateAction?: (input: {
      identity: GenericMonitorChildIdentity;
      result: CorporateActionAnalyzerResult;
    }) => Promise<CorporateActionPersistenceResult>;
    loadCorporateActionApplicabilityContext?: (input: {
      eventId: string;
      rawItemId: string;
    }) => Promise<CorporateActionApplicabilityContext>;
    persistShareCountObservation?: (input: {
      identity: GenericMonitorChildIdentity;
      rawItem: Record<string, unknown>;
      candidate: Level2ShareCountValidatedCandidate;
    }) => Promise<{ inserted: number; deduped: number }>;
    runDilutionCorporateActionAdjustment?: (input: { eventId: string }) => Promise<unknown>;
    resolvePeriodicFinancialMonitor?: (
      rawItem: Record<string, unknown>,
      expectedIdentity: PeriodicFinancialFilingIdentity,
    ) => Promise<PeriodicFinancialMonitorAnalysis>;
    consumeFinancialMonitorAlerts?: (input: Readonly<{ eventId: string }>) =>
      Promise<FinancialMonitorAlertConsumerResult>;
  } = {},
) {
  const repository = dependencies.repository || genericMonitorChildRepository;
  if (identity.sourceFamily === "sec_form25") {
    return (await import("./form25ListingRuntime.ts")).processForm25ListingChild(identity, {
      repository,
      consumeAlerts: dependencies.consumeListingMonitorAlerts || consumeListingMonitorAlertsForEvent,
    });
  }
  if (identity.monitorAnalyzerKey === PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY) {
    return processPeriodicFinancialMonitorChild(identity, {
      repository,
      resolveAnalysis: dependencies.resolvePeriodicFinancialMonitor,
      consumeFinancialMonitorAlerts: dependencies.consumeFinancialMonitorAlerts,
    });
  }
  if (identity.monitorAnalyzerKey === "corporate_action") {
    const loadApplicabilityContext = dependencies.loadCorporateActionApplicabilityContext
      || readCorporateActionApplicabilityContext;
    return processGenericMonitorChildWithDependencies(identity, {
      repository,
      buildAnalyzerInput: async (childIdentity, rawItem, primaryAnalysis) =>
        buildCorporateActionAnalyzerInput(
          childIdentity,
          rawItem,
          primaryAnalysis,
          childIdentity.sourceFamily === "sec_8k_6k"
            ? await loadApplicabilityContext({
                eventId: childIdentity.eventId,
                rawItemId: childIdentity.rawItemId,
              })
            : unavailableCorporateActionApplicabilityContext("non_sec_source"),
        ),
      runAnalyzer: dependencies.runCorporateActionAnalyzer || runCorporateActionCanonicalAnalyzerPreview,
      persist: async (persistenceInput) => {
        const persisted = await (dependencies.persistCorporateAction || persistCorporateActionAnalyzerResult)(persistenceInput);
        if (
          persistenceInput.identity.secAmendmentLineage
          && (persisted.status === "saved" || persisted.status === "idempotent")
        ) {
          const lineage = await persistSecAmendmentMonitorReplacement({
            identity: persistenceInput.identity,
            result: persistenceInput.result as unknown as Record<string, unknown>,
          });
          if (lineage.status !== "saved" && lineage.status !== "idempotent") {
            throw new Error(`SEC amendment Corporate Action projection failed: ${"reason" in lineage ? lineage.reason : lineage.status}`);
          }
        }
        return persisted;
      },
      persistShareCountObservation: dependencies.persistShareCountObservation
        || persistGenericMonitorShareCountObservation,
      terminalStateAfterPersistence: corporateActionTerminalStateAfterPersistence,
      persistenceFailureError: (result: CorporateActionAnalyzerResult, error) => {
        if (!result.applicable) return error;
        const diagnostic = buildPersistedStockSplitMaterializationDiagnostic(
          result.facts,
          error instanceof Error ? error.message : String(error),
        );
        return diagnostic ? stockSplitMaterializationError(diagnostic) : error;
      },
      afterSuccessfulPersistence: ({ identity: childIdentity }) => (
        dependencies.runDilutionCorporateActionAdjustment
        || runDilutionCorporateActionAdjustmentForEvent
      )({ eventId: childIdentity.eventId }),
      consumeListingMonitorAlerts: dependencies.consumeListingMonitorAlerts
        || ((input) => consumeListingMonitorAlertsForEvent({
          ...input,
          alertEventId: identity.alertEventId,
        })),
      ...(identity.secAmendmentLineage
        ? { authorizeBeforeProvider: verifySecAmendmentExecutionAuthorization }
        : {}),
    });
  }
  const processed = await processGenericMonitorChildWithDependencies(identity, {
    repository,
    buildAnalyzerInput,
    runAnalyzer: dependencies.runListingRiskAnalyzer || runListingRiskDomainAnalyzerPreview,
    persist: async (persistenceInput) => {
      const persisted = await (dependencies.persistListingRisk
        || ((value) => persistListingRiskAnalyzerResult(value)))(persistenceInput);
      if (
        persistenceInput.identity.secAmendmentLineage
        && (persisted.status === "saved" || persisted.status === "idempotent")
      ) {
        const lineage = await persistSecAmendmentMonitorReplacement({
          identity: persistenceInput.identity,
          result: persistenceInput.result as unknown as Record<string, unknown>,
        });
        if (lineage.status !== "saved" && lineage.status !== "idempotent") {
          throw new Error(`SEC amendment Listing projection failed: ${"reason" in lineage ? lineage.reason : lineage.status}`);
        }
      }
      return persisted;
    },
    persistShareCountObservation: dependencies.persistShareCountObservation
      || persistGenericMonitorShareCountObservation,
    terminalStateAfterPersistence: listingRiskTerminalStateAfterPersistence,
    ...(identity.sourceFamily === "sec_8k_6k" ? {
      afterSuccessfulPersistence: () => (dependencies.persistListingStatus || persistListingRiskStatusAutomatically)(identity),
    } : {}),
    consumeListingMonitorAlerts: dependencies.consumeListingMonitorAlerts
      || ((input) => consumeListingMonitorAlertsForEvent({
        ...input,
        alertEventId: identity.alertEventId,
      })),
    ...(identity.secAmendmentLineage
      ? { authorizeBeforeProvider: verifySecAmendmentExecutionAuthorization }
      : {}),
  });
  // Retry only this idempotent history sidecar on a completed child replay;
  // never rerun its analyzer or change Monitor terminal/alert behavior.
  if (processed.status === "duplicate" && identity.sourceFamily === "sec_8k_6k")
    return {...processed,postPersistence:await (dependencies.persistListingStatus || persistListingRiskStatusAutomatically)(identity)};
  return processed;
}

export async function processPeriodicFinancialMonitorChild(
  identity: GenericMonitorChildIdentity,
  dependencies: {
    repository: PeriodicFinancialRuntimeRepository;
    resolveAnalysis?: (
      rawItem: Record<string, unknown>,
      expectedIdentity: PeriodicFinancialFilingIdentity,
    ) => Promise<PeriodicFinancialMonitorAnalysis>;
    consumeFinancialMonitorAlerts?: (input: Readonly<{ eventId: string }>) =>
      Promise<FinancialMonitorAlertConsumerResult>;
  },
) {
  if (
    identity.monitorAnalyzerKey !== PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY
    || identity.sourceFamily !== "sec_periodic_reports"
  ) {
    throw new Error("Invalid Periodic Financial Monitor child identity");
  }
  const claimed = await dependencies.repository.claim(identity);
  if (!claimed) {
    const financialMonitorAlerts = await safeConsumeFinancialAlerts(
      identity.eventId,
      dependencies.consumeFinancialMonitorAlerts,
    );
    return {
      status: "duplicate" as const,
      jobId: identity.executionId,
      providerCalls: 0,
      financialMonitorAlerts,
    };
  }

  let parent: Awaited<ReturnType<PeriodicFinancialRuntimeRepository["loadExactParent"]>>;
  try {
    parent = await dependencies.repository.loadExactParent(identity);
  } catch (error) {
    await dependencies.repository.recordTerminal(identity, "failed", { error });
    return {
      status: "failed" as const,
      jobId: identity.executionId,
      providerCalls: 0,
      error: runtimeErrorMessage(error),
    };
  }

  try {
    const resolveAnalysis = dependencies.resolveAnalysis
      || (await import("./periodicFinancialMonitorSource.ts"))
        .resolvePeriodicFinancialMonitorFromStoredSec;
    const rawIdentity = readPeriodicFinancialRawFilingIdentity(
      parent.rawItem,
      identity.sourceIdentity,
    );
    const analysis = await resolveAnalysis(parent.rawItem, rawIdentity);
    assertPeriodicFinancialMonitorAnalysisIdentity(analysis, rawIdentity);
    await dependencies.repository.recordTerminal(identity, "succeeded_applicable", {
      outputPayload: analysis,
    });
    const financialMonitorAlerts = await safeConsumeFinancialAlerts(
      identity.eventId,
      dependencies.consumeFinancialMonitorAlerts,
    );
    return {
      status: "succeeded_applicable" as const,
      jobId: identity.executionId,
      providerCalls: 0,
      calculationSource: analysis.calculationSource,
      resultStatus: analysis.resultStatus,
      comparisonCount: analysis.comparisons.length,
      financialMonitorAlerts,
    };
  } catch (error) {
    await dependencies.repository.releaseForRetry(identity, error);
    return {
      status: "retryable_failure" as const,
      jobId: identity.executionId,
      providerCalls: 0,
      error: runtimeErrorMessage(error),
    };
  }
}

async function safeConsumeFinancialAlerts(
  eventId: string,
  consumer?: (input: Readonly<{ eventId: string }>) => Promise<FinancialMonitorAlertConsumerResult>,
): Promise<FinancialMonitorAlertConsumerResult | Readonly<{ status: "failed"; error: string }>> {
  try {
    return await (consumer || consumeFinancialMonitorAlertsForEvent)({ eventId });
  } catch (error) {
    return { status: "failed", error: runtimeErrorMessage(error) };
  }
}

function runtimeErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Periodic Financial Monitor failed";
}

function persistGenericMonitorShareCountObservation(input: {
  identity: GenericMonitorChildIdentity;
  rawItem: Record<string, unknown>;
  candidate: Level2ShareCountValidatedCandidate;
}) {
  return persistLevel2ShareCountObservationFromSecRawItem({
    candidate: input.candidate,
    rawItem: input.rawItem,
    eventId: input.identity.eventId,
    rawItemId: input.identity.rawItemId,
    parentPrimaryAiRunId: input.identity.parentPrimaryAiRunId,
    sourceExecutionId: input.identity.executionId,
    analyzerKey: input.identity.monitorAnalyzerKey,
  });
}

export function buildCorporateActionAnalyzerInput(
  identity: GenericMonitorChildIdentity,
  rawItem: Record<string, unknown>,
  _primaryAnalysis: Record<string, unknown>,
  applicabilityContext?: CorporateActionApplicabilityContext,
): CorporateActionAnalyzerInput {
  const common = {
    source_unique_id: nullableText(rawItem.source_unique_id),
    source_url: nullableText(rawItem.source_url),
    published_at: nullableText(rawItem.published_at),
    title: nullableText(rawItem.title),
    body_text: stringValue(rawItem.body_text),
  };
  if (identity.sourceFamily === "nasdaq_corporate_actions") {
    return adaptNasdaqCorporateActionSource(common);
  }
  if (identity.sourceFamily === "news") {
    return adaptNewsCorporateActionSource(common);
  }
  if (identity.sourceFamily !== "sec_8k_6k") {
    throw new Error("Unsupported Corporate Action source family");
  }
  const secInput = buildInputFromSecRawRow(rawItem);
  const filingPackage = record(secInput.filing_package);
  const hardParsers = record(filingPackage?.hard_parsers);
  const parserOutput = record(hardParsers?.["8k-6k"]);
  if (!filingPackage || !parserOutput) {
    throw new Error("Stored SEC 8-K/6-K parser source is unavailable");
  }
  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage,
    parserOutput,
    fallbackText: stringValue(filingPackage.llm_text) || stringValue(rawItem.body_text),
  });
  const rawPayload = record(rawItem.raw_payload);
  return adaptSec8k6kCorporateActionSource({
    accession_number: nullableText(rawPayload?.accession_number) || nullableText(rawItem.source_unique_id),
    source_url: nullableText(rawItem.source_url),
    filed_at: nullableText(rawItem.published_at),
    title: nullableText(rawItem.title),
    cleaned_source_blocks: sourceInput.cleaned_source_blocks,
    issuer_context: applicabilityContext?.issuerContext,
    security_class_candidates: applicabilityContext?.securityClassCandidates,
    reverse_split_execution_candidates: applicabilityContext?.reverseSplitExecutionCandidates,
    forward_split_execution_candidates: applicabilityContext?.forwardSplitExecutionCandidates,
  });
}

export function buildAnalyzerInput(
  identity: GenericMonitorChildIdentity,
  rawItem: Record<string, unknown>,
  primaryAnalysis: Record<string, unknown>,
): ListingRiskAnalyzerInput {
  if (identity.monitorAnalyzerKey !== "listing_risk") {
    throw new Error(`Unsupported Generic Monitor analyzer route: ${identity.monitorAnalyzerKey}`);
  }
  if (identity.sourceFamily === "news" || identity.sourceFamily === "nasdaq_corporate_actions") {
    const input = {
      source_unique_id: nullableText(rawItem.source_unique_id),
      source_url: nullableText(rawItem.source_url),
      published_at: nullableText(rawItem.published_at),
      title: nullableText(rawItem.title),
      body_text: stringValue(rawItem.body_text),
      primary_analysis: primaryAnalysis,
    };
    return identity.sourceFamily === "nasdaq_corporate_actions"
      ? adaptNasdaqListingRiskSource(input)
      : adaptNewsListingRiskSource(input);
  }

  const secInput = buildInputFromSecRawRow(rawItem);
  const filingPackage = record(secInput.filing_package);
  const hardParsers = record(filingPackage?.hard_parsers);
  const parserOutput = record(hardParsers?.["8k-6k"]);
  if (!filingPackage || !parserOutput) {
    throw new Error("Stored SEC 8-K/6-K parser source is unavailable");
  }
  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage,
    parserOutput,
    fallbackText: stringValue(filingPackage.llm_text) || stringValue(rawItem.body_text),
  });
  const rawPayload = record(rawItem.raw_payload);
  return adaptSec8k6kListingRiskSource({
    accession_number: nullableText(rawPayload?.accession_number) || nullableText(rawItem.source_unique_id),
    source_url: nullableText(rawItem.source_url),
    filed_at: nullableText(rawItem.published_at),
    title: nullableText(rawItem.title),
    cleaned_source_blocks: sourceInput.cleaned_source_blocks,
    primary_analysis: primaryAnalysis,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const text = stringValue(value);
  return text || null;
}
