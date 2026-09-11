import { randomUUID } from "node:crypto";
import {
  evaluateSecInvestableUniverse,
  type SecInvestableUniverseGateResult,
} from "@/lib/ai/secInvestableUniverseGate";
import { fetchSecEdgarRawItems, type SecParsedRawItem } from "@/lib/sources/sec/parser";
import {
  createSecSourceRun,
  ensureSecSource,
  findExistingSecRawItem,
  finishSecSourceRun,
  saveSecRawItem,
} from "@/lib/secStores/rawStore";
import {
  workflowSourceRunMetadata,
  type WorkflowSourceRunAttempt,
} from "@/lib/sourceRunState";
import {
  persistSc13CanonicalXmlForRawItem,
  recordSc13CanonicalPersistenceState,
  sc13PersistenceFailureState,
} from "@/lib/sec-sc13-xml/persistence";

type SecRawIngestOptions = {
  formTypes?: string[];
  countPerForm?: number;
  limit?: number;
  accessionNumber?: string;
  cik?: string;
  dryRun?: boolean;
  force?: boolean;
  includeDocuments?: boolean;
  attachmentLimit?: number;
  sourceRun?: WorkflowSourceRunAttempt;
};

type SecRawIngestDependencies = {
  fetchRawItems?: typeof fetchSecEdgarRawItems;
};

export async function runSecRawIngest(
  options: SecRawIngestOptions = {},
  dependencies: SecRawIngestDependencies = {},
) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const runId = options.sourceRun?.sourceRunId || randomUUID();
  const startedAt = new Date().toISOString();
  const sourceRunMetadata = workflowSourceRunMetadata(options.sourceRun);
  const items: Array<Record<string, unknown>> = [];
  const stats = {
    checked_count: 0,
    raw_upserted_count: 0,
    skipped_count: 0,
    excluded_count: 0,
    failed_count: 0,
    documents_requested: 0,
    documents_fetched: 0,
    documents_failed: 0,
    sc13_xml_available_count: 0,
    sc13_xml_replayed_count: 0,
    sc13_xml_failed_count: 0,
    sc13_xml_state_recording_failed_count: 0,
  };

  if (!dryRun) {
    await ensureSecSource();
    const initialStatus = await createSecSourceRun({
      force,
      includeDocuments: options.includeDocuments ?? true,
      requestedFormTypes: options.formTypes,
      requestedLimit: options.limit,
      requestedAccessionNumber: options.accessionNumber,
      runId,
      startedAt,
      metadata: sourceRunMetadata,
    });
    if (initialStatus === "cancelled") {
      return {
        ok: false,
        cancelled: true,
        stage: "cancelled",
        status: 409,
        runId,
        stats,
        error: "Workflow source run was cancelled before ingest started",
        items,
      };
    }
    if (initialStatus !== "running") {
      return {
        ok: initialStatus === "completed" || initialStatus === "skipped",
        reused: true,
        stage: initialStatus,
        status: initialStatus === "failed" ? 500 : 200,
        runId,
        stats,
        error: initialStatus === "failed"
          ? "Workflow source attempt already failed"
          : undefined,
        items,
      };
    }
  }

  try {
    const rawResult = await (dependencies.fetchRawItems ?? fetchSecEdgarRawItems)({
      formTypes: options.formTypes,
      accessionNumber: options.accessionNumber,
      cik: options.cik,
      countPerForm: options.countPerForm,
      limit: options.limit,
      includeDocuments: options.includeDocuments,
      attachmentLimit: options.attachmentLimit,
    });

    if (!rawResult.ok) {
      if (!dryRun) {
        await finishSecSourceRun(runId, "failed", startedAt, stats, rawResult.error || "SEC raw fetch failed", {
          raw_diagnostics: rawResult.diagnostics,
          ...sourceRunMetadata,
        });
      }

      return {
        ok: false,
        stage: "raw_fetch",
        status: rawResult.status,
        error: rawResult.error || "SEC raw fetch failed",
        rawResult,
      };
    }

    stats.checked_count = rawResult.items.length;
    stats.documents_requested = rawResult.diagnostics.documentsRequested;
    stats.documents_fetched = rawResult.diagnostics.documentsFetched;
    stats.documents_failed = rawResult.diagnostics.documentsFailed;

    for (const rawItem of rawResult.items) {
      try {
        const exclusion = evaluateRawItemExclusion(rawItem);
        if (dryRun) {
          if (exclusion) {
            stats.skipped_count += 1;
            stats.excluded_count += 1;
          }
          items.push({
            ok: true,
            dryRun: true,
            ...(exclusion ? buildExcludedRawItem(rawItem, exclusion) : {}),
            raw_item: summarizeRaw(rawItem, exclusion),
          });
          continue;
        }

        if (exclusion) {
          stats.skipped_count += 1;
          stats.excluded_count += 1;
          items.push(buildExcludedRawItem(rawItem, exclusion));
          continue;
        }

        const existing = await findExistingSecRawItem(rawItem);
        if (existing && !force) {
          const sc13XmlPersistence = await persistSc13XmlAfterRawSave({
            rawItem,
            rawItemId: stringValue(existing.id),
            stats,
          });
          stats.skipped_count += 1;
          items.push({
            ok: true,
            skipped: true,
            reason: "existing_raw_item",
            raw_item_id: existing.id,
            source_unique_id: rawItem.source_unique_id,
            title: existing.title || rawItem.title,
            form_type: readNested(rawItem.raw_payload, "form_type"),
            cik: readNested(rawItem.raw_payload, "cik"),
            sc13_xml_persistence: sc13XmlPersistence,
          });
          continue;
        }

        const persisted = await saveSecRawItem(rawItem, runId, existing);
        const sc13XmlPersistence = await persistSc13XmlAfterRawSave({
          rawItem,
          rawItemId: stringValue(persisted.id),
          stats,
        });
        stats.raw_upserted_count += 1;
        items.push({
          ok: true,
          raw_item_id: persisted.id,
          source_unique_id: rawItem.source_unique_id,
          title: persisted.title,
          form_type: readNested(rawItem.raw_payload, "form_type"),
          cik: readNested(rawItem.raw_payload, "cik"),
          ticker: readNested(rawItem.raw_payload, "ticker"),
          body_chars: stringValue(rawItem.body_text).length,
          sc13_xml_persistence: sc13XmlPersistence,
        });
      } catch (error) {
        stats.failed_count += 1;
        items.push({
          ok: false,
          source_unique_id: rawItem.source_unique_id,
          title: rawItem.title,
          error: error instanceof Error ? error.message : "Unknown SEC raw item ingest error",
        });
      }
    }

    const ok = stats.failed_count === 0;
    const partial = stats.failed_count > 0 && stats.raw_upserted_count > 0;
    if (!dryRun) {
      await finishSecSourceRun(
        runId,
        ok || partial ? "completed" : "failed",
        startedAt,
        stats,
        ok ? undefined : "One or more SEC raw items failed",
        {
          raw_diagnostics: rawResult.diagnostics,
          partial,
          ...sourceRunMetadata,
        },
      );
    }

    return {
      ok,
      partial,
      stage: dryRun ? "dry_run" : "complete",
      runId: dryRun ? null : runId,
      stats,
      items,
      diagnostics: rawResult.diagnostics,
    };
  } catch (error) {
    if (!dryRun) {
      await finishSecSourceRun(
        runId,
        "failed",
        startedAt,
        stats,
        error instanceof Error ? error.message : "Unknown SEC raw ingest error",
        sourceRunMetadata,
      );
    }

    return {
      ok: false,
      stage: "ingest",
      runId: dryRun ? null : runId,
      stats,
      error: error instanceof Error ? error.message : "Unknown SEC raw ingest error",
      items,
    };
  }
}

async function persistSc13XmlAfterRawSave(input: {
  rawItem: SecParsedRawItem;
  rawItemId: string;
  stats: {
    sc13_xml_available_count: number;
    sc13_xml_replayed_count: number;
    sc13_xml_failed_count: number;
    sc13_xml_state_recording_failed_count: number;
  };
}) {
  try {
    const result = await persistSc13CanonicalXmlForRawItem({
      rawItemId: input.rawItemId,
      rawItem: input.rawItem,
    });
    if (result.status === "not_applicable") return result;
    input.stats.sc13_xml_available_count += 1;
    if (result.writeStatus === "replayed") input.stats.sc13_xml_replayed_count += 1;
    try {
      await recordSc13CanonicalPersistenceState({
        rawItemId: input.rawItemId,
        state: result,
      });
      return { ...result, stateRecorded: true };
    } catch {
      input.stats.sc13_xml_state_recording_failed_count += 1;
      return { ...result, stateRecorded: false };
    }
  } catch (error) {
    input.stats.sc13_xml_failed_count += 1;
    const failureState = sc13PersistenceFailureState(error);
    try {
      await recordSc13CanonicalPersistenceState({
        rawItemId: input.rawItemId,
        state: failureState,
      });
      return { ...failureState, stateRecorded: true };
    } catch {
      input.stats.sc13_xml_state_recording_failed_count += 1;
      return { ...failureState, stateRecorded: false };
    }
  }
}

function summarizeRaw(rawItem: SecParsedRawItem, exclusion: SecInvestableUniverseGateResult | null = null) {
  const rawPayload = toRecord(rawItem.raw_payload);
  return {
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    form_type: readNested(rawItem.raw_payload, "form_type"),
    cik: readNested(rawItem.raw_payload, "cik"),
    ticker: readNested(rawItem.raw_payload, "ticker"),
    exchange: readNested(rawItem.raw_payload, "exchange"),
    ticker_resolution: toRecord(rawPayload?.ticker_resolution),
    is_excluded: Boolean(exclusion),
    skip_gate: exclusion?.gate || null,
    skip_reason: exclusion?.reason || null,
    skip_evidence: exclusion?.evidence || [],
    document_count: Array.isArray(rawItem.raw_payload.documents) ? rawItem.raw_payload.documents.length : 0,
    body_chars: stringValue(rawItem.body_text).length,
  };
}

function buildExcludedRawItem(rawItem: SecParsedRawItem, exclusion: SecInvestableUniverseGateResult) {
  return {
    ok: true,
    skipped: true,
    is_excluded: true,
    reason: "excluded_before_raw_persist",
    skip_gate: exclusion.gate,
    skip_reason: exclusion.reason,
    skip_evidence: exclusion.evidence,
    source_unique_id: rawItem.source_unique_id,
    title: rawItem.title,
    form_type: readNested(rawItem.raw_payload, "form_type"),
    ticker: readNested(rawItem.raw_payload, "ticker"),
  };
}

function evaluateRawItemExclusion(rawItem: SecParsedRawItem) {
  const rawPayload = toRecord(rawItem.raw_payload);
  const metadata = toRecord(rawItem.metadata);
  return evaluateSecInvestableUniverse({
    filing_package: {
      form_type: stringValue(rawPayload?.form_type || metadata?.form_type),
      title: stringValue(rawItem.title),
      company_name: stringValue(rawPayload?.company_name || metadata?.company_name),
      llm_text: stringValue(rawItem.analysis_text || rawItem.body_text),
      ticker: stringValue(rawPayload?.ticker || metadata?.ticker),
      primary_ticker: {
        ticker: stringValue(rawPayload?.ticker || metadata?.ticker) || null,
        exchange: stringValue(rawPayload?.exchange || metadata?.exchange) || null,
      },
      tickers: Array.isArray(rawPayload?.tickers) ? rawPayload?.tickers : [],
      ticker_resolution: toRecord(rawPayload?.ticker_resolution),
    },
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNested(value: unknown, key: string) {
  return toRecord(value)?.[key] || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
