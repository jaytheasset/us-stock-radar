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
import { persistLevel2ShareCountObservationFromSecRawItem } from "../sec-structured-data/level2ShareCountPersistenceRuntime.ts";
import type { Level2ShareCountValidatedCandidate } from "../sec-structured-data/level2ShareCountObservation.ts";

type RuntimeRepository = Pick<
  typeof genericMonitorChildRepository,
  "claim" | "releaseForRetry" | "recordTerminal" | "loadExactParent"
>;

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
    runCorporateActionAnalyzer?: (
      input: CorporateActionAnalyzerInput,
    ) => Promise<CorporateActionCanonicalAnalyzerPreviewResult>;
    persistCorporateAction?: (input: {
      identity: GenericMonitorChildIdentity;
      result: CorporateActionAnalyzerResult;
    }) => Promise<CorporateActionPersistenceResult>;
    persistShareCountObservation?: (input: {
      identity: GenericMonitorChildIdentity;
      rawItem: Record<string, unknown>;
      candidate: Level2ShareCountValidatedCandidate;
    }) => Promise<{ inserted: number; deduped: number }>;
  } = {},
) {
  const repository = dependencies.repository || genericMonitorChildRepository;
  if (identity.monitorAnalyzerKey === "corporate_action") {
    return processGenericMonitorChildWithDependencies(identity, {
      repository,
      buildAnalyzerInput: buildCorporateActionAnalyzerInput,
      runAnalyzer: dependencies.runCorporateActionAnalyzer || runCorporateActionCanonicalAnalyzerPreview,
      persist: dependencies.persistCorporateAction || persistCorporateActionAnalyzerResult,
      persistShareCountObservation: dependencies.persistShareCountObservation
        || persistGenericMonitorShareCountObservation,
      terminalStateAfterPersistence: corporateActionTerminalStateAfterPersistence,
      consumeListingMonitorAlerts: dependencies.consumeListingMonitorAlerts
        || consumeListingMonitorAlertsForEvent,
    });
  }
  return processGenericMonitorChildWithDependencies(identity, {
    repository,
    buildAnalyzerInput,
    runAnalyzer: dependencies.runListingRiskAnalyzer || runListingRiskDomainAnalyzerPreview,
    persist: dependencies.persistListingRisk
      || ((input) => persistListingRiskAnalyzerResult(input)),
    persistShareCountObservation: dependencies.persistShareCountObservation
      || persistGenericMonitorShareCountObservation,
    terminalStateAfterPersistence: listingRiskTerminalStateAfterPersistence,
    consumeListingMonitorAlerts: dependencies.consumeListingMonitorAlerts
      || consumeListingMonitorAlertsForEvent,
  });
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
