import {
  SEC_FILING_ANALYSIS_PROMPT_KEY,
  SEC_FILING_ANALYSIS_PROMPT_VERSION,
} from "@/lib/prompts/secFilingAnalysis";
import { runAlertDeliveryForEvent } from "@/lib/alerts/delivery/runAlertDeliveryForEvent";
import { findSecRawItem, runSecFilingAnalysisForRawRow } from "@/lib/ai/secFilingAnalysisPreview";
import {
  fetchSecFilingCalendarItemsForEvent,
  saveAnalyzedSecFilingEvent,
  saveSecFilingAiTrace,
} from "@/lib/secStores/eventStore";
import {
  buildGenericMonitorPrimaryExecutionContext,
  enqueueGenericMonitorChildrenAfterPrimary,
} from "@/lib/monitor/genericMonitorChildWorkflowStarter";
import {
  beginSecAnalysisSpan,
  traceSecAnalysis,
  updateSecAnalysisAccession,
  withSecAnalysisSpan,
} from "@/lib/ai/secAnalysisInstrumentation";
import {
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD,
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD,
} from "@/lib/dilution/economicExposureIdentityObservationSidecar";

export {
  buildSecFilingGroupDedupe,
  buildSecFilingGroupDedupeKey,
  buildSecFilingLegacyGroupDedupeKey,
  isSecOwnershipFormType,
} from "@/lib/secStores/eventStore";

type AnalyzeOptions = {
  rawItemId?: string;
  accessionNumber?: string;
  ticker?: string;
  calendarCandidate?: boolean;
  dryRun?: boolean;
  force?: boolean;
  suppressAlerts?: boolean;
  llmProvider?: string;
  llmModel?: string;
  secPromptVariant?: string;
};

export async function runSecFilingAnalysisIngest(options: AnalyzeOptions = {}) {
  const rawResult = await withSecAnalysisSpan(
    "raw_lookup_start",
    "raw_lookup_end",
    () => findSecRawItem(options),
  );
  if (!rawResult.ok || !rawResult.rawItem) {
    return {
      ok: false,
      stage: "raw_item",
      status: rawResult.status,
      error: rawResult.error || "SEC raw item not found",
    };
  }
  updateSecAnalysisAccession(rawResult.rawItem.source_unique_id);
  traceSecAnalysis("raw_loaded", {
    status: "success",
    raw_item_id: stringValue(rawResult.rawItem.id),
  });

  const analysisRun = await runSecFilingAnalysisForRawRow(rawResult.rawItem, {
    llmProvider: options.llmProvider,
    llmModel: options.llmModel,
    secPromptVariant: options.secPromptVariant,
  });
  if (!analysisRun.ok || !analysisRun.analysis) {
    const failedValidationRepair = readValidationRepair(analysisRun);
    if (failedValidationRepair?.attempted === true) {
      await saveSecFilingAiTrace({
        rawItemId: stringValue(rawResult.rawItem.id),
        eventId: null,
        analysis: analysisRun.analysis || null,
        outputText: withoutEconomicExposureIdentitySidecar(analysisRun.outputText),
        repairOutputText: analysisRun.repairOutputText,
        usage: analysisRun.usage || null,
        repairUsage: analysisRun.repairUsage || null,
        costEstimate: analysisRun.costEstimate || null,
        model: analysisRun.model || "",
        openAiResponseId: analysisRun.openAiResponseId || null,
        repairOpenAiResponseId: analysisRun.repairOpenAiResponseId || null,
        promptKey: analysisRun.prompt?.key || SEC_FILING_ANALYSIS_PROMPT_KEY,
        promptVersion: analysisRun.prompt?.version || SEC_FILING_ANALYSIS_PROMPT_VERSION,
        prompt: readRecord(analysisRun.prompt),
        validationRepair: failedValidationRepair,
        error: analysisRun.error || "SEC filing analysis failed after validation repair",
      }).catch(() => null);
    }
    return {
      ok: false,
      stage: analysisRun.stage,
      status: analysisRun.status,
      error: analysisRun.error || "SEC filing analysis failed",
      sourceItem: analysisRun.sourceItem,
      input: analysisRun.input,
      runtime: summarizeSecAnalysisRuntime(analysisRun.input, analysisRun.prompt),
      outputText: analysisRun.outputText,
      rawOpenAIResponse: analysisRun.rawOpenAIResponse,
      validationRepair: failedValidationRepair,
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: analysisRun.sourceItem,
      input: analysisRun.input,
      runtime: summarizeSecAnalysisRuntime(analysisRun.input, analysisRun.prompt),
      audit: analysisRun.audit,
      analysis: analysisRun.analysis,
      economicExposureIdentityObservations: arrayValue(readRecord(analysisRun)?.economicExposureIdentityObservations),
      economicExposureIdentityRejected: arrayValue(readRecord(analysisRun)?.economicExposureIdentityRejected),
      auditOutputText: analysisRun.auditOutputText,
      outputText: analysisRun.outputText,
      auditUsage: analysisRun.auditUsage,
      usage: analysisRun.usage,
      costEstimate: analysisRun.costEstimate,
      model: analysisRun.model,
      prompt: analysisRun.prompt,
      validationRepairTrace: buildRuntimeValidationRepairTrace(analysisRun),
    };
  }

  if (isSkipAnalysisAction(analysisRun.analysis)) {
    return {
      ok: true,
      stage: "skipped",
      skipped: true,
      skipReason:
        stringValue(analysisRun.analysis.archive_summary) ||
        stringValue(analysisRun.analysis.score_reason) ||
        "SEC filing analysis selected skip_analysis",
      sourceItem: analysisRun.sourceItem,
      input: analysisRun.input,
      runtime: summarizeSecAnalysisRuntime(analysisRun.input, analysisRun.prompt),
      audit: analysisRun.audit,
      analysis: analysisRun.analysis,
      auditOutputText: analysisRun.auditOutputText,
      outputText: analysisRun.outputText,
      auditUsage: analysisRun.auditUsage,
      usage: analysisRun.usage,
      costEstimate: analysisRun.costEstimate,
      model: analysisRun.model,
      prompt: analysisRun.prompt,
    };
  }

  const { persistedEvent, aiTrace } = await withSecAnalysisSpan(
    "persistence_start",
    "persistence_end",
    async () => {
      const persistedEvent = await withSecAnalysisSpan(
        "event_persistence_start",
        "event_persistence_end",
        () => saveAnalyzedSecFilingEvent({
          rawRow: rawResult.rawItem!,
          input: analysisRun.input,
          analysis: analysisRun.analysis!,
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
          promptKey: analysisRun.prompt?.key || SEC_FILING_ANALYSIS_PROMPT_KEY,
          promptVersion: analysisRun.prompt?.version || SEC_FILING_ANALYSIS_PROMPT_VERSION,
          force: Boolean(options.force),
        }),
      );

      const aiTrace = await withSecAnalysisSpan(
        "ai_trace_persistence_start",
        "ai_trace_persistence_end",
        () => saveSecFilingAiTrace({
          rawItemId: stringValue(rawResult.rawItem!.id),
          eventId: stringValue(persistedEvent.id),
          analysis: analysisRun.analysis!,
          outputText: withoutEconomicExposureIdentitySidecar(analysisRun.outputText),
          usage: analysisRun.usage || null,
          costEstimate: analysisRun.costEstimate || null,
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
          promptKey: analysisRun.prompt?.key || SEC_FILING_ANALYSIS_PROMPT_KEY,
          promptVersion: analysisRun.prompt?.version || SEC_FILING_ANALYSIS_PROMPT_VERSION,
          prompt: readRecord(analysisRun.prompt),
          repairOutputText: analysisRun.repairOutputText,
          repairUsage: analysisRun.repairUsage || null,
          repairOpenAiResponseId: analysisRun.repairOpenAiResponseId || null,
          validationRepair: readValidationRepair(analysisRun),
        }),
      );
      return { persistedEvent, aiTrace };
    },
    {
      prompt_key: analysisRun.prompt?.key || SEC_FILING_ANALYSIS_PROMPT_KEY,
      prompt_version: analysisRun.prompt?.version || SEC_FILING_ANALYSIS_PROMPT_VERSION,
    },
  );
  const validationRepairTrace = aiTrace.repairTrace;

  const calendarItems = await fetchSecFilingCalendarItemsForEvent(stringValue(persistedEvent.id));
  const alertDelivery = options.suppressAlerts
    ? {
        ok: true,
        suppressed: true,
        reason: "alert delivery suppressed by controlled SEC development persist",
      }
    : await runSecFilingAlertDelivery(persistedEvent);
  const primaryPromptKey = analysisRun.prompt?.key || SEC_FILING_ANALYSIS_PROMPT_KEY;
  const primaryPromptVersion = analysisRun.prompt?.version || SEC_FILING_ANALYSIS_PROMPT_VERSION;
  const endListingFanout = beginSecAnalysisSpan("listing_fanout_start", {
    event_id: stringValue(persistedEvent.id),
    primary_ai_run_id: aiTrace.aiRunId,
  });
  const genericMonitorChildren = await enqueueGenericMonitorChildrenAfterPrimary({
      primary: buildGenericMonitorPrimaryExecutionContext({
        eventId: stringValue(persistedEvent.id),
        rawItemId: stringValue(rawResult.rawItem.id),
        sourceGroup: "filings",
        sourceCode: stringValue(rawResult.rawItem.source_code),
        sourceIdentity: stringValue(rawResult.rawItem.source_unique_id),
        parentPrimaryAiRunId: aiTrace.aiRunId,
        parentPromptKey: primaryPromptKey,
        parentPromptVersion: primaryPromptVersion,
        secFormType: stringValue(readRecord(readRecord(analysisRun.input)?.filing_package)?.form_type),
      }),
      primaryAnalysis: analysisRun.analysis,
    }).then((result) => {
      endListingFanout("listing_fanout_end", {
        status: "success",
        child_count: result.childCount,
      });
      return result;
    }).catch((error) => {
      endListingFanout("listing_fanout_end", {
        status: "error",
        child_count: 0,
        error_class: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        status: "enqueue_failed" as const,
        childCount: 0 as const,
        error: error instanceof Error ? error.message : "Generic Monitor enqueue failed",
      };
    });

  return {
    ok: true,
    stage: "complete",
    sourceItem: analysisRun.sourceItem,
    event: persistedEvent,
    analysis: analysisRun.analysis,
    economicExposureIdentityObservations: arrayValue(readRecord(analysisRun)?.economicExposureIdentityObservations),
    economicExposureIdentityRejected: arrayValue(readRecord(analysisRun)?.economicExposureIdentityRejected),
    runtime: summarizeSecAnalysisRuntime(analysisRun.input, analysisRun.prompt),
    outputText: analysisRun.outputText,
    usage: analysisRun.usage,
    costEstimate: analysisRun.costEstimate,
    model: analysisRun.model,
    prompt: analysisRun.prompt,
    primaryAiRunId: aiTrace.aiRunId,
    calendarItems,
    alertDelivery,
    genericMonitorChildren,
    validationRepairTrace,
  };
}

function readValidationRepair(analysisRun: unknown) {
  const run = readRecord(analysisRun);
  const direct = readRecord(run?.validationRepair);
  if (direct) return direct;
  const form25 = readRecord(run?.form25ValidationRepair);
  if (form25) return form25;
  return readRecord(readRecord(run?.sec8k6kDebug)?.validation_repair);
}

function buildRuntimeValidationRepairTrace(analysisRun: unknown) {
  const validationRepair = readValidationRepair(analysisRun);
  return {
    attempted: validationRepair?.attempted === true,
    status: validationRepair?.attempted === true
      ? validationRepair.succeeded === true || validationRepair.run_ok === true
        ? "succeeded"
        : "failed"
      : "not_attempted",
    detail: validationRepair,
  };
}

function isSkipAnalysisAction(analysis: Record<string, unknown>) {
  return stringValue(analysis.analysis_action) === "skip_analysis";
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function summarizeSecAnalysisRuntime(input: unknown, prompt: unknown) {
  const inputRecord = readRecord(input);
  const filingPackage = readRecord(inputRecord?.filing_package);
  const adapter = readRecord(filingPackage?.form_adapter);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const promptRecord = readRecord(prompt);
  const triagePrompt = readRecord(promptRecord?.triage);
  const auditPrompt = readRecord(promptRecord?.audit);

  return {
    form_type: stringValue(filingPackage?.form_type) || null,
    form_family: stringValue(filingPackage?.form_family) || null,
    form_adapter: adapter
      ? {
          key: stringValue(adapter.key) || null,
          parserGroup: stringValue(adapter.parserGroup) || null,
          analysisMode: stringValue(adapter.analysisMode) || null,
          primaryAdapter: stringValue(adapter.primary_adapter) || null,
          secondaryFormContext: readStringArray(adapter.secondary_form_context),
          selectorReason: stringValue(adapter.selector_reason) || null,
          selectorSignal: stringValue(adapter.selector_signal) || null,
        }
      : null,
    hard_parser_keys: hardParsers ? Object.keys(hardParsers) : [],
    prompt: promptRecord
      ? {
          key: stringValue(promptRecord.key) || null,
          version: stringValue(promptRecord.version) || null,
          triageKey: stringValue(triagePrompt?.key) || null,
          auditKey: stringValue(auditPrompt?.key) || null,
        }
      : null,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function withoutEconomicExposureIdentitySidecar(value: unknown) {
  const text = stringValue(value);
  if (
    !text ||
    (!text.includes(`"${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD}"`) &&
      !text.includes(`"${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD}"`))
  ) return text;
  try {
    const parsed = JSON.parse(text);
    const root = readRecord(parsed);
    if (!root) return "";
    delete root[ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD];
    delete root[ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD];
    return JSON.stringify(root);
  } catch {
    return "";
  }
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

async function runSecFilingAlertDelivery(eventRow: Record<string, unknown>) {
  if (stringValue(eventRow.delivery_level) !== "alert") return null;

  const eventId = stringValue(eventRow.id);
  if (!eventId) {
    return {
      ok: false,
      dryRun: false,
      write: true,
      error: "Persisted SEC filing event is missing id; alert delivery was not run.",
    };
  }

  try {
    return await runAlertDeliveryForEvent({
      eventId,
      dryRun: false,
      write: true,
    });
  } catch (error) {
    return {
      ok: false,
      dryRun: false,
      write: true,
      error: error instanceof Error ? error.message : "SEC filing alert delivery failed.",
    };
  }
}
