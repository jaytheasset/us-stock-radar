import "server-only";
import { validateSourceEvent, validateEventLink, type ListingSourceEvent } from "./sourceEvent.ts";
import { readStoredForm25Source } from "../sources/sec/forms/form25/storedSource.ts";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { readCurrentListingRiskFacts, validateCurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";
import { record, validDate, validScope, SEC_DELISTING_STATE_VERSION, type DelistingScope } from "../sec-delisting-state/state.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { resolveListingAttachment } from "./identity.ts";
import { selectListingCoverRow } from "./coverAttachment.ts";
import { sameRetainedListingEvidence, sameCanonicalListingClaim } from "./provenance.ts";
import { LISTING_OBSERVATION_VERSION, buildObservation, listingSourceSnapshot, evaluateObservation, summarize,
  projectListingStatus, hash, stable, uuid, unattached, type Row, type ListingObservation, type HistoryItem } from "./observation.ts";

/** One existing stored filing -> immutable observation. Explicit invocation; no
 * Primary, child execution, Monitor evaluation or delivery is started here. */
export async function persistSecListingObservation(input: {
  rawItemId: string; eventId?: string; asOf: string; repository?: SecTickerResolutionRepository;
  sourceEvent?: ListingSourceEvent; scope?: DelistingScope;
}) {
  if (!uuid(input.rawItemId) || !validDate(input.asOf) || input.eventId && !uuid(input.eventId)) throw Error("invalid_listing_observation_request");
  const repository = input.repository ?? await defaultRepository();
  const raw = await readOne(repository, "raw_items", input.rawItemId);
  if (!raw) throw Error("listing_raw_source_missing");
  const form = String(record(raw.raw_payload).form_type ?? "");
  const isForm25 = /^(25|25-NSE)(\/A)?$/.test(form);
  let scope: DelistingScope | null = null;
  let listingRisk = null;
  if (input.sourceEvent) {
    if (isForm25) throw Error("form25_source_event_override_forbidden");
    scope = input.scope ?? null;
    validateSourceEvent(raw,scope,input.sourceEvent);
    // Explicit source-only history does not require creating a Primary/feed event.
    if (input.eventId) {
      const event = await readOne(repository,"events",input.eventId);
      if (!event || event.raw_item_id !== raw.id || event.source_code !== "sec_edgar") throw Error("listing_event_raw_mismatch");
    }
    if (input.sourceEvent.resolves) await checkSourceLink(raw,scope!,input.sourceEvent,repository);
  } else if (isForm25) {
    const source = readStoredForm25Source(raw);
    if (source.status === "available" && source.scopeVerified) scope = {
      issuerCik: source.identity.facts.subject_company_cik!.value.padStart(10, "0"),
      securityTitle: source.identity.facts.removed_security!.value, exchange: source.identity.facts.exchange!.value,
    };
  } else {
    if (!/^(8-K|6-K)(\/A)?$/.test(form) || !input.eventId) throw Error("unsupported_listing_source_or_missing_event");
    const event = await readOne(repository, "events", input.eventId);
    if (!event || event.raw_item_id !== raw.id || event.source_code !== "sec_edgar") throw Error("listing_event_raw_mismatch");
    listingRisk = await readCurrentListingRiskFacts(input.eventId, { rpc: repository.rpc.bind(repository) });
    // Unsupported or malformed cover evidence must not discard the retained filing.
    let cover: ReturnType<typeof buildSecCoverObservationPayload> = null;
    try { cover = buildSecCoverObservationPayload(input.rawItemId, raw); } catch { /* unresolved scope */ }
    if (listingRisk.status === "available" && cover && ["available", "partial"].includes(cover.payload.extractionStatus)) {
      const f = listingRisk.facts;
      const subject = { issuerCik: cover.payload.identity.issuerCik,
        securityTitle: f.affected_security.title.value ?? "", exchange: f.exchange.value ?? "" };
      // Keep the reported subject unchanged; record the exact cover row as
      // separate identity evidence using the existing class/venue binding.
      if (validScope(subject) && selectListingCoverRow(raw, subject)) scope = subject;
    }
  }
  const attachment = await observationAttachment(raw, scope, input.sourceEvent, repository);
  const observation = buildObservation({ raw, scope, asOf: input.asOf, attachment, eventId: input.eventId, listingRisk, sourceEvent: input.sourceEvent });
  const response = await repository.rpc("persist_sec_listing_status_observation", { p_observation: observation });
  if (!response.ok) throw Error(`listing_observation_persistence_failed: ${response.error || response.status}`);
  const result = record(response.data);
  if (!["inserted", "replayed"].includes(String(result.status)) || !uuid(String(result.id))) throw Error("invalid_listing_persistence_response");
  return { status: String(result.status), id: String(result.id), observation };
}

/** Official readback revalidates the source version, summary and identity proof.
 * A changed source or proof is retained as history but is ineligible for projection. */
export async function readSecListingHistory(input: {
  rawItemId?: string; scope?: DelistingScope; repository?: SecTickerResolutionRepository;
}): Promise<HistoryItem[]> {
  if (!input.rawItemId && !input.scope || input.rawItemId && !uuid(input.rawItemId)
    || input.scope && !validScope(input.scope)) throw Error("invalid_listing_history_query");
  const repository = input.repository ?? await defaultRepository();
  const response = await repository.select("sec_listing_status_observations", {
    select: "*", ...(input.rawItemId ? { raw_item_id: `eq.${input.rawItemId}` } : { issuer_cik: `eq.${input.scope!.issuerCik}` }),
    order: "filing_date.asc,id.asc", limit: "1001",
  });
  if (!response.ok || !Array.isArray(response.data) || response.data.length > 1000) throw Error("listing_history_read_failed_or_incomplete");
  const history: HistoryItem[] = [];
  for (const row of response.data) {
    const o = row.observation as ListingObservation;
    const item: HistoryItem = { id: String(row.id), observation: o, usable: false, reason: null };
    // Malformed rows must fail the whole bounded read, never disappear from projection.
    if (!o || o.version !== LISTING_OBSERVATION_VERSION || !o.attachment || !o.reported || !validDate(o.filingDate)
      || !validDate(o.evaluatedAsOf) || !uuid(o.rawItemId) || row.raw_item_id !== o.rawItemId)
      throw Error("invalid_stored_listing_observation");
    const raw = await readOne(repository, "raw_items", o.rawItemId);
    const exactEnvelope = raw && stable(listingSourceSnapshot(raw)) === stable(o.sourceSnapshot);
    if (!raw || hash(o.sourceSnapshot) !== o.sourceHash
      || !exactEnvelope && !sameRetainedListingEvidence(o,raw))
      item.reason = "stale_or_missing_sec_source";
    else if (o.readerVersion !== SEC_DELISTING_STATE_VERSION) item.reason = "reader_version_changed";
    else {
      item.provenance = { source: exactEnvelope ? "unchanged" : "wrapper_refreshed", analysis: "unchanged" };
      if (o.listingRisk) {
        const current = validateCurrentListingRiskReadResult(toRpcShape(o.listingRisk));
        if (current.status !== o.listingRisk.status) item.reason = "invalid_saved_listing_evidence";
        else {
          const live = await readCurrentListingRiskFacts(o.eventId!, { rpc: repository.rpc.bind(repository) });
          if (stable(live) !== stable(o.listingRisk)) {
            const semantic = (v: typeof live) => v.status === "available" ? {
              status:v.status,eventId:v.eventId,rawItemId:v.rawItemId,monitorAnalyzerKey:v.monitorAnalyzerKey,
              analyzerContractVersion:v.analyzerContractVersion,factSchemaVersion:v.factSchemaVersion,facts:v.facts,
            } : v;
            if (stable(semantic(live)) === stable(semantic(o.listingRisk))) item.provenance.analysis = "lineage_refreshed";
            else item.reason = "listing_evidence_changed";
          }
        }
      }
      if (!item.reason && !o.sourceEvent && stable(summarize(evaluateObservation(o,o.evaluatedAsOf))) !== stable(o.reported))
        item.reason = "observation_facts_changed";
      if (!item.reason && o.sourceEvent) {
        try {
          const current = summarize(evaluateObservation(o,o.evaluatedAsOf));
          if (stable(current) !== stable(o.reported)) {
            item.reason = "observation_facts_changed";
            item.revalidationFailure = { reason: "observation_facts_changed", sourceHash: o.sourceHash,
              storedReported: o.reported, revalidatedReported: current };
          }
          if (o.sourceEvent?.resolves) await checkSourceLink(raw!,o.scope!,o.sourceEvent,repository);
        } catch (e) {
          if (e instanceof Error && /(?:read_failed|unavailable)/.test(e.message)) throw e;
          item.reason = "invalid_source_event_or_link"; delete item.revalidationFailure;
        }
      }
      if (!item.reason && o.attachment.status === "attached") {
        const proof = await observationAttachment(o.sourceSnapshot, o.scope, o.sourceEvent, repository);
        if (stable(proof) !== stable(o.attachment)) item.reason = "identity_evidence_changed";
      }
      // Retain the original unresolved record. Re-resolve only a missing identity,
      // never a conflict or source failure, against evidence available to its filing.
      if (!item.reason && o.attachment.status === "unresolved"
        && ["no_exact_canonical_security_exchange", "identity_observation_time_missing", "identity_evidence_unavailable"].includes(o.attachment.reason)) {
        const proof = await observationAttachment(o.sourceSnapshot, o.scope, o.sourceEvent, repository);
        if (proof.status === "attached" && proof.reason === "validated_stable_sec_security_exchange")
          item.resolvedAttachment = proof;
      }
    }
    item.usable = item.reason === null;
    history.push(item);
  }
  // A stale analysis is not itself a new/open SEC event. Exclusion requires a
  // usable independently validated replacement of the *same* canonical claim.
  // Missing source, conflicting claims and unrelated issues remain blocking.
  for (const item of history) {
    const o=item.observation;
    if (item.reason!=="listing_evidence_changed" || o.listingRisk?.status!=="available") continue;
    let revalidated: ListingObservation["reported"];
    try { revalidated=summarize(evaluateObservation(o,o.evaluatedAsOf)); } catch { continue; }
    if (stable(revalidated)!==stable(o.reported)) continue;
    const replacements=history.filter(next=>next.usable && next.id!==item.id
      && next.observation.listingRisk?.status==="available"
      && Date.parse(next.observation.listingRisk.persistedAt)>Date.parse(o.listingRisk!.status==="available" ? o.listingRisk!.persistedAt : "")
      && (next.resolvedAttachment ?? next.observation.attachment).status==="attached"
      && (o.attachment.status!=="attached" || o.attachment.securityIdentityId===(next.resolvedAttachment ?? next.observation.attachment).securityIdentityId)
      && sameCanonicalListingClaim(o,next.observation));
    replacements.sort((a,b)=>a.id.localeCompare(b.id));
    const next=replacements[0];
    if (next) item.revalidationFailure={reason:"listing_evidence_changed",sourceHash:o.sourceHash,
      storedReported:o.reported,revalidatedReported:revalidated,
      replacement:{observationId:next.id,sourceHash:next.observation.sourceHash}};
  }
  return history;
}

async function observationAttachment(raw: Row, scope: DelistingScope | null, event: ListingSourceEvent | undefined,
  repository: SecTickerResolutionRepository) {
  if (!scope || !/^(8-K|6-K)(\/A)?$/.test(String(record(raw.raw_payload).form_type)))
    return resolveListingAttachment(scope,repository,String(raw.published_at).slice(0,10));
  const coverRow = selectListingCoverRow(raw,scope);
  if (!coverRow) return unattached("no_exact_canonical_security_exchange");
  const attachment = await resolveListingAttachment({ issuerCik: scope.issuerCik,
    securityTitle: coverRow.securityTitle, exchange: coverRow.exchange },repository,String(raw.published_at).slice(0,10));
  if (attachment.status !== "attached") return attachment;
  // An exact title/venue alone cannot authorize a ticker transition.
  const identity = await readOne(repository,"sec_ticker_security_identities",attachment.securityIdentityId!);
  if (record(record(identity?.identity_payload).after).tradingSymbol !== coverRow.ticker)
    return { ...attachment, status: "unresolved" as const, securityIdentityId: null, decisionId: null,
      proofHash: null, knownAt: null, reason: "cover_ticker_requires_change_evidence" };
  return { ...attachment, coverRow };
}

export async function readSecListingStatusAsOf(input: {
  securityIdentityId: string | null; scope: DelistingScope; asOf: string; repository?: SecTickerResolutionRepository;
}) {
  return projectListingStatus({ ...input, observations: await readSecListingHistory({ scope: input.scope, repository: input.repository }) });
}

function toRpcShape(current: NonNullable<ListingObservation["listingRisk"]>) {
  if (current.status === "not_ready") return current;
  return { status: current.status, event_id: current.eventId, raw_item_id: current.rawItemId,
    parent_primary_ai_run_id: current.parentPrimaryAiRunId, source_execution_id: current.sourceExecutionId,
    monitor_analyzer_key: current.monitorAnalyzerKey, analyzer_contract_version: current.analyzerContractVersion,
    persisted_at: current.persistedAt, ...(current.status === "available" ? { fact_schema_version: current.factSchemaVersion, facts: current.facts } : {}) };
}
async function readOne(repository: SecTickerResolutionRepository, table: string, id: string) {
  const r = await repository.select(table, { select: "*", id: `eq.${id}`, limit: "2" });
  if (!r.ok || !Array.isArray(r.data) || r.data.length > 1) throw Error(`listing_source_read_failed:${table}`);
  return r.data[0] as Row | undefined;
}
async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}

async function checkSourceLink(raw: Row, scope: DelistingScope, event: ListingSourceEvent, repository: SecTickerResolutionRepository) {
  const target = await readOne(repository,"sec_listing_status_observations",event.resolves!.observationId);
  const o = target?.observation as ListingObservation | undefined;
  if (!o?.sourceEvent || o.sourceEvent.resolves || !o.scope || o.sourceHash !== event.resolves!.sourceHash
    || o.scope.issuerCik !== scope.issuerCik || o.scope.securityTitle !== scope.securityTitle || o.scope.exchange !== scope.exchange
    || o.filingDate > String(raw.published_at).slice(0,10)
    || o.filingDate === String(raw.published_at).slice(0,10) && o.rawItemId !== raw.id)
    throw Error("listing_follow_up_target_mismatch");
  const original = await readOne(repository,"raw_items",o.rawItemId);
  if (!original || stable(listingSourceSnapshot(original)) !== stable(o.sourceSnapshot) && !sameRetainedListingEvidence(o,original)
    || o.sourceHash !== hash(o.sourceSnapshot) || stable(summarize(evaluateObservation(o,o.evaluatedAsOf))) !== stable(o.reported))
    throw Error("listing_follow_up_target_stale");
  validateEventLink(event,o.sourceEvent);
}
