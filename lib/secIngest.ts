import { randomUUID } from "node:crypto";
import { ensureSecForm25Identity } from "@/lib/sec-form25-identity/persistence";
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
import {
  SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION,
  runSc13MonitorAutomaticTrigger,
} from "@/lib/monitor/sc13MonitorAutomaticTrigger";
import {
  persistSecCoverObservationsForRawItem,
  recordSecCoverObservationPersistenceState,
  secCoverObservationFailureState,
} from "@/lib/sec-cover-observations/persistence";
import { runSecTickerResolutionAutomaticTrigger } from "@/lib/sec-ticker-resolution/automaticTrigger";
import { form25DelistingFailure, runForm25DelistingAutomaticTrigger, type Form25DelistingRunRecord } from "@/lib/sec-delisting-state/automaticTrigger";
import { SEC_FORM25_FORMS } from "@/lib/sources/sec/forms/common/forms";
import { persistForm25ListingStatusAutomatically, type Form25ListingPersistenceRecord } from "@/lib/sec-listing-status/automaticPersistence";
import { isS8Form } from "@/lib/sec-s8/directFacts";
import { persistS8Registration } from "@/lib/sec-s8/persistence";
import { enqueueS8Structured } from "@/lib/sec-s8/structuredRuntime";
import { enqueueProxyStructured } from "@/lib/sec-proxy/starter";
import { isProxyForm } from "@/lib/sec-proxy/source";

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
  ensureSource?: typeof ensureSecSource;
  createSourceRun?: typeof createSecSourceRun;
  findExistingRawItem?: typeof findExistingSecRawItem;
  saveRawItem?: typeof saveSecRawItem;
  finishSourceRun?: typeof finishSecSourceRun;
  persistCoverObservations?: typeof persistSecCoverObservationsForRawItem;
  recordCoverState?: typeof recordSecCoverObservationPersistenceState;
  resolveCoverTickerChange?: typeof runSecTickerResolutionAutomaticTrigger;
  evaluateForm25Delisting?: typeof runForm25DelistingAutomaticTrigger;
  evaluateForm25Identity?: typeof ensureSecForm25Identity;
  persistForm25ListingStatus?: typeof persistForm25ListingStatusAutomatically;
  persistS8Registration?: typeof persistS8Registration;
  enqueueS8Structured?: typeof enqueueS8Structured;
  enqueueProxyStructured?: typeof enqueueProxyStructured;
};

export async function runSecRawIngest(
  options: SecRawIngestOptions = {},
  dependencies: SecRawIngestDependencies = {},
) {
  const runtime = {
    ensureSource: dependencies.ensureSource ?? ensureSecSource,
    createSourceRun: dependencies.createSourceRun ?? createSecSourceRun,
    findExistingRawItem: dependencies.findExistingRawItem ?? findExistingSecRawItem,
    saveRawItem: dependencies.saveRawItem ?? saveSecRawItem,
    finishSourceRun: dependencies.finishSourceRun ?? finishSecSourceRun,
    persistCoverObservations: dependencies.persistCoverObservations ?? persistSecCoverObservationsForRawItem,
    recordCoverState: dependencies.recordCoverState ?? recordSecCoverObservationPersistenceState,
    resolveCoverTickerChange: dependencies.resolveCoverTickerChange ?? runSecTickerResolutionAutomaticTrigger,
    evaluateForm25Delisting: dependencies.evaluateForm25Delisting ?? runForm25DelistingAutomaticTrigger,
    evaluateForm25Identity: dependencies.evaluateForm25Identity ?? ensureSecForm25Identity,
    persistForm25ListingStatus: dependencies.persistForm25ListingStatus ?? persistForm25ListingStatusAutomatically,
    persistS8Registration: dependencies.persistS8Registration ?? persistS8Registration,
    enqueueS8Structured: dependencies.enqueueS8Structured ?? enqueueS8Structured,
    enqueueProxyStructured: dependencies.enqueueProxyStructured ?? enqueueProxyStructured,
  };
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const runId = options.sourceRun?.sourceRunId || randomUUID();
  const startedAt = new Date().toISOString();
  const sourceRunMetadata = workflowSourceRunMetadata(options.sourceRun);
  const form25DelistingRecords: Form25DelistingRunRecord[] = [];
  const form25IdentityRecords: Array<Record<string, unknown>> = [];
  const form25ListingStatusRecords: Form25ListingPersistenceRecord[] = [];
  const s8RegistrationRecords: Array<Record<string, unknown>> = [];
  const items: Array<Record<string, unknown>> = [];
  async function proxyAfterRawSave(rawItem: SecParsedRawItem, rawItemId: string) {
    if (!isProxyForm(rawItem.raw_payload.form_type)) return { status: "not_applicable" };
    try { return await runtime.enqueueProxyStructured(rawItemId); }
    catch (error) { return { status: "failed", reason: String(error) }; }
  }
  async function persistS8AfterRawSave(rawItem: SecParsedRawItem, rawItemId: string) {
    if (!isS8Form(rawItem.raw_payload.form_type)) return { status: "not_applicable" };
    let outcome;
    try { outcome = await runtime.persistS8Registration({ rawItemId }); }
    catch (error) { outcome = { status: "failed", reason: error instanceof Error ? error.message : "s8_persistence_failed" }; }
    s8RegistrationRecords.push({ rawItemId, ...outcome });
    if (outcome.status === "available") {
      try { return { ...outcome, structured: await runtime.enqueueS8Structured(rawItemId) }; }
      catch (error) { return { ...outcome, structured: { status: "failed", reason: String(error) } }; }
    }
    return outcome;
  }
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
    section16_xml_available_count: 0,
    section16_xml_replayed_count: 0,
    section16_xml_failed_count: 0,
    section16_xml_state_recording_failed_count: 0,
    sec_cover_observation_available_count: 0,
    sec_cover_observation_replayed_count: 0,
    sec_cover_observation_failed_count: 0,
    sec_cover_observation_state_recording_failed_count: 0,
    sc13_monitor_completed_count: 0,
    sc13_monitor_failed_count: 0,
    sc13_monitor_state_recording_failed_count: 0,
    form25_delisting_completed_count: 0,
    form25_delisting_unavailable_count: 0,
    form25_delisting_failed_count: 0,
    form25_listing_observation_inserted_count: 0,
    form25_listing_observation_replayed_count: 0,
    form25_listing_observation_unavailable_count: 0,
    form25_listing_observation_failed_count: 0,
  };

  async function persistForm25AfterSidecars(rawItem: SecParsedRawItem, rawItemId: string) {
    const form = stringValue(readNested(rawItem.raw_payload, "form_type")).toUpperCase().replace(/\s+/g, "");
    if (!(SEC_FORM25_FORMS as readonly string[]).includes(form)) return { status: "not_applicable" as const };
    const request = { rawItemId, accession: stringValue(rawItem.source_unique_id) };
    let outcome: Form25ListingPersistenceRecord;
    try { outcome = await runtime.persistForm25ListingStatus(request); }
    catch { outcome = { ...request, status: "failed", reason: "listing_observation_trigger_exception" }; }
    form25ListingStatusRecords.push(outcome);
    if (outcome.status === "inserted") stats.form25_listing_observation_inserted_count++;
    else if (outcome.status === "replayed") stats.form25_listing_observation_replayed_count++;
    else if (outcome.status === "failed") stats.form25_listing_observation_failed_count++;
    else if (outcome.status === "unavailable") stats.form25_listing_observation_unavailable_count++;
    return outcome;
  }

  async function evaluateForm25AfterRawSave(rawItem: SecParsedRawItem, rawItemId: string) {
    const formType = stringValue(readNested(rawItem.raw_payload, "form_type")).toUpperCase().replace(/\s+/g, "");
    if (!(SEC_FORM25_FORMS as readonly string[]).includes(formType)) return { status: "not_applicable" as const };
    // Identity review is independent of the delisting reader and first analysis.
    try {
      const identity = await runtime.evaluateForm25Identity({ rawItemId });
      form25IdentityRecords.push({ rawItemId, ...identity });
    } catch {
      form25IdentityRecords.push({ rawItemId, status: "unavailable", reason: "identity_trigger_failed" });
    }
    const request = { rawItemId, accession: stringValue(rawItem.source_unique_id), asOf: startedAt.slice(0, 10) };
    let outcome: Form25DelistingRunRecord;
    try { outcome = await runtime.evaluateForm25Delisting(request); }
    catch { outcome = form25DelistingFailure(request, "delisting_trigger_exception"); }
    // Separate run metadata avoids stale raw-item metadata overwriting analysis
    // or another sidecar. Reader failure never changes raw/site ingest success.
    form25DelistingRecords.push(outcome);
    if (outcome.status === "failed") stats.form25_delisting_failed_count += 1;
    else if (outcome.status === "unavailable") stats.form25_delisting_unavailable_count += 1;
    else stats.form25_delisting_completed_count += 1;
    return outcome;
  }

  const completedRunMetadata = () => ({ ...sourceRunMetadata,
    ...(s8RegistrationRecords.length ? { s8_registration: s8RegistrationRecords } : {}),
    ...(form25DelistingRecords.length ? { form25_delisting: form25DelistingRecords } : {}),
    ...(form25IdentityRecords.length ? { form25_ticker_identity: form25IdentityRecords } : {}),
    ...(form25ListingStatusRecords.length ? { form25_listing_status: form25ListingStatusRecords } : {}),
  });

  if (!dryRun) {
    await runtime.ensureSource();
    const initialStatus = await runtime.createSourceRun({
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
        await runtime.finishSourceRun(runId, "failed", startedAt, stats, rawResult.error || "SEC raw fetch failed", {
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

        const existing = await runtime.findExistingRawItem(rawItem);
        if (existing && !force) {
          const form25Delisting = await evaluateForm25AfterRawSave(rawItem, stringValue(existing.id));
          const sc13XmlPersistence = await persistSc13XmlAfterRawSave({
            rawItem,
            rawItemId: stringValue(existing.id),
            stats,
          });
          const section16XmlPersistence = await persistSection16XmlAfterRawSave({
            rawItem,
            rawItemId: stringValue(existing.id),
            stats,
          });
          const secCoverObservationPersistence = await persistSecCoverObservationsAfterRawSave({
            rawItem,
            rawItemId: stringValue(existing.id),
            stats,
            persistCoverObservations: runtime.persistCoverObservations,
            recordCoverState: runtime.recordCoverState,
            resolveCoverTickerChange: runtime.resolveCoverTickerChange,
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
            section16_xml_persistence: section16XmlPersistence,
            s8_registration_persistence: await persistS8AfterRawSave(rawItem, stringValue(existing.id)),
            proxy_structured: await proxyAfterRawSave(rawItem, stringValue(existing.id)),
            sec_cover_observation_persistence: secCoverObservationPersistence,
            form25_delisting: form25Delisting,
            form25_listing_status: await persistForm25AfterSidecars(rawItem, stringValue(existing.id)),
          });
          continue;
        }

        const persisted = await runtime.saveRawItem(rawItem, runId, existing);
        const form25Delisting = await evaluateForm25AfterRawSave(rawItem, stringValue(persisted.id));
        const sc13XmlPersistence = await persistSc13XmlAfterRawSave({
          rawItem,
          rawItemId: stringValue(persisted.id),
          stats,
        });
        const section16XmlPersistence = await persistSection16XmlAfterRawSave({
          rawItem,
          rawItemId: stringValue(persisted.id),
          stats,
        });
        const secCoverObservationPersistence = await persistSecCoverObservationsAfterRawSave({
          rawItem,
          rawItemId: stringValue(persisted.id),
          stats,
          persistCoverObservations: runtime.persistCoverObservations,
          recordCoverState: runtime.recordCoverState,
          resolveCoverTickerChange: runtime.resolveCoverTickerChange,
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
          section16_xml_persistence: section16XmlPersistence,
          s8_registration_persistence: await persistS8AfterRawSave(rawItem, stringValue(persisted.id)),
          proxy_structured: await proxyAfterRawSave(rawItem, stringValue(persisted.id)),
          sec_cover_observation_persistence: secCoverObservationPersistence,
          form25_delisting: form25Delisting,
          form25_listing_status: await persistForm25AfterSidecars(rawItem, stringValue(persisted.id)),
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
      await runtime.finishSourceRun(
        runId,
        ok || partial ? "completed" : "failed",
        startedAt,
        stats,
        ok ? undefined : "One or more SEC raw items failed",
        {
          raw_diagnostics: rawResult.diagnostics,
          partial,
          ...completedRunMetadata(),
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
      await runtime.finishSourceRun(
        runId,
        "failed",
        startedAt,
        stats,
        error instanceof Error ? error.message : "Unknown SEC raw ingest error",
        completedRunMetadata(),
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

async function persistSecCoverObservationsAfterRawSave(input: {
  rawItem: SecParsedRawItem;
  rawItemId: string;
  stats: {
    sec_cover_observation_available_count: number;
    sec_cover_observation_replayed_count: number;
    sec_cover_observation_failed_count: number;
    sec_cover_observation_state_recording_failed_count: number;
  };
  persistCoverObservations: typeof persistSecCoverObservationsForRawItem;
  recordCoverState: typeof recordSecCoverObservationPersistenceState;
  resolveCoverTickerChange: typeof runSecTickerResolutionAutomaticTrigger;
}) {
  try {
    const result = await input.persistCoverObservations({
      rawItemId: input.rawItemId,
      rawItem: input.rawItem,
    });
    if (result.status === "not_applicable") return result;
    input.stats.sec_cover_observation_available_count += 1;
    if (result.writeStatus === "replayed") input.stats.sec_cover_observation_replayed_count += 1;
    // This sidecar must never turn a saved observation (or raw/site analysis) into a failure.
    let tickerResolution: Awaited<ReturnType<typeof runSecTickerResolutionAutomaticTrigger>>;
    try {
      tickerResolution = await input.resolveCoverTickerChange(result);
    } catch {
      tickerResolution = {
        version: "sec-ticker-resolution-ingest-v1", status: "failed",
        reasons: ["automatic_resolution_exception"], decisions: [],
      };
    }
    const state = { ...result, tickerResolution };
    try {
      await input.recordCoverState({ rawItemId: input.rawItemId, state });
      return { ...state, stateRecorded: true };
    } catch {
      input.stats.sec_cover_observation_state_recording_failed_count += 1;
      return { ...state, stateRecorded: false };
    }
  } catch (error) {
    input.stats.sec_cover_observation_failed_count += 1;
    const failureState = secCoverObservationFailureState(error);
    try {
      await input.recordCoverState({ rawItemId: input.rawItemId, state: failureState });
      return { ...failureState, stateRecorded: true };
    } catch {
      input.stats.sec_cover_observation_state_recording_failed_count += 1;
      return { ...failureState, stateRecorded: false };
    }
  }
}

async function persistSection16XmlAfterRawSave(input: {
  rawItem: SecParsedRawItem;
  rawItemId: string;
  stats: {
    section16_xml_available_count: number;
    section16_xml_replayed_count: number;
    section16_xml_failed_count: number;
    section16_xml_state_recording_failed_count: number;
  };
}) {
  const formType = stringValue(toRecord(input.rawItem.raw_payload)?.form_type)
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!["3", "3/A", "5", "5/A"].includes(formType)) {
    return { status: "not_applicable" as const };
  }
  let persistence: typeof import("@/lib/sec-section16-xml/persistence") | null = null;
  try {
    persistence = await import("@/lib/sec-section16-xml/persistence");
    const result = await persistence.persistSection16CanonicalXmlForRawItem({
      rawItemId: input.rawItemId,
      rawItem: input.rawItem,
    });
    if (result.status === "not_applicable") return result;
    input.stats.section16_xml_available_count += 1;
    if (result.writeStatus === "replayed") input.stats.section16_xml_replayed_count += 1;
    try {
      await persistence.recordSection16CanonicalPersistenceState({ rawItemId: input.rawItemId, state: result });
      return { ...result, stateRecorded: true };
    } catch {
      input.stats.section16_xml_state_recording_failed_count += 1;
      return { ...result, stateRecorded: false };
    }
  } catch (error) {
    input.stats.section16_xml_failed_count += 1;
    const failureState = persistence?.section16PersistenceFailureState(error)
      ?? { status: "failed" as const, errorCode: "module_unavailable" };
    if (!persistence) {
      input.stats.section16_xml_state_recording_failed_count += 1;
      return { ...failureState, stateRecorded: false };
    }
    try {
      await persistence.recordSection16CanonicalPersistenceState({ rawItemId: input.rawItemId, state: failureState });
      return { ...failureState, stateRecorded: true };
    } catch {
      input.stats.section16_xml_state_recording_failed_count += 1;
      return { ...failureState, stateRecorded: false };
    }
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
    sc13_monitor_completed_count: number;
    sc13_monitor_failed_count: number;
    sc13_monitor_state_recording_failed_count: number;
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
    let stateRecorded = true;
    try {
      await recordSc13CanonicalPersistenceState({
        rawItemId: input.rawItemId,
        state: result,
      });
    } catch {
      input.stats.sc13_xml_state_recording_failed_count += 1;
      stateRecorded = false;
    }
    let monitor;
    try {
      monitor = await runSc13MonitorAutomaticTrigger({
        rawItemId: input.rawItemId,
        issuerCik: result.issuerCik,
        sourceSha256: result.sourceSha256,
      });
    } catch (error) {
      monitor = {
        version: SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION,
        status: "failed" as const,
        rawItemId: input.rawItemId,
        issuerCik: result.issuerCik,
        stateRecorded: false,
        error: error instanceof Error ? error.message : "Unexpected SC13 Monitor trigger failure",
      };
      try {
        console.error("[sc13-monitor] unexpected ingest trigger failure", monitor);
      } catch {
        // Console/reporting failures never cross the canonical XML boundary.
      }
    }
    if (monitor.status === "completed") input.stats.sc13_monitor_completed_count += 1;
    else input.stats.sc13_monitor_failed_count += 1;
    if (!monitor.stateRecorded) input.stats.sc13_monitor_state_recording_failed_count += 1;
    return { ...result, stateRecorded, monitor };
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
