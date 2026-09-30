import { createHash } from "node:crypto";
import { evaluateStoredForm25, evaluateStoredListingRiskFiling, applyCurrentListingRiskEvidence,
  record, validDate, validScope, SEC_DELISTING_STATE_VERSION,
  type DelistingEvidence, type DelistingScope } from "../sec-delisting-state/state.ts";
import type { CurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";

import { validateSourceEvent, validateEventLink, sourceEventAxis, closingEvent, type ListingSourceEvent } from "./sourceEvent.ts";

export type ListingState = DelistingEvidence["listing"] | "removal_decision_withdrawn";
export type TradingStatus = DelistingEvidence["trading"] | "resumed";
export type ObservationEvidence = Omit<DelistingEvidence, "listing" | "trading"> & {listing: ListingState; trading: TradingStatus};

export const LISTING_OBSERVATION_VERSION = "sec_listing_observation_v1";
export type Row = Record<string, unknown>;
export type Attachment = {
  status: "attached" | "unresolved" | "conflict";
  securityIdentityId: string | null; decisionId: string | null;
  knownAt: string | null; proofHash: string | null; reason: string;
  coverRow?: { resultId: string; observationKey: string; sourceHash: string; securityTitle: string; ticker: string; exchange: string };
};
export const unattached = (reason: string, status: "unresolved" | "conflict" = "unresolved"): Attachment =>
  ({ status, securityIdentityId: null, decisionId: null, knownAt: null, proofHash: null, reason });

/** Keep the original fields used by the existing reader, including original documents.
 * This is an immutable source version, not a mutable event/Primary snapshot. */
export function listingSourceSnapshot(raw: Row) {
  return { id: raw.id, source_code: raw.source_code, source_group: raw.source_group ?? null,
    source_unique_id: raw.source_unique_id, source_url: raw.source_url,
    published_at: raw.published_at, fetched_at: raw.fetched_at ?? null, raw_payload: raw.raw_payload };
}
export type ListingObservation = {
  version: typeof LISTING_OBSERVATION_VERSION; readerVersion: string;
  rawItemId: string; accession: string; form: string; filingDate: string;
  sourceSnapshot: Row; sourceHash: string; scope: DelistingScope | null;
  eventId: string | null; listingRisk: CurrentListingRiskReadResult | null;
  evaluatedAsOf: string; attachment: Attachment;
  sourceEvent?: ListingSourceEvent;
  reported: ReturnType<typeof summarize>;
};

export function summarize(evidence: ObservationEvidence) {
  return { listing: evidence.listing, trading: evidence.trading, removalDate: evidence.removalDate,
    suspensionDate: evidence.suspensionDate, reasons: evidence.reasons,
    parserVersion: evidence.parserVersion,
    sources: evidence.sourceDocuments.map(({ url, sha256 }) => ({ url, sha256 })) };
}
export function evaluateObservation(observation: Pick<ListingObservation,
  "sourceSnapshot" | "scope" | "eventId" | "listingRisk" | "form" | "sourceEvent">, asOf: string): ObservationEvidence {
  if (observation.sourceEvent) {
    const e = observation.sourceEvent;
    validateSourceEvent(observation.sourceSnapshot, observation.scope, e);
    return { rawItemId: String(observation.sourceSnapshot.id), eventId: observation.eventId,
      accession: String(observation.sourceSnapshot.source_unique_id), sourceUrl: e.documentUrl,
      sourceSha256: e.documentHash, parserVersion: e.version, issuerCik: observation.scope!.issuerCik,
      securityTitle: observation.scope!.securityTitle, exchange: observation.scope!.exchange, filedByCik: null,
      listing: e.kind === "removal_decision" ? "removal_pending" : e.kind === "removal_decision_withdrawn" ? "removal_decision_withdrawn" : "unresolved",
      trading: e.kind === "trading_suspension" ? "suspended" : e.kind === "trading_resumed" ? "resumed" : "unresolved",
      removalDate: null, suspensionDate: e.kind === "trading_suspension"
        && e.quote.match(/was suspended (?:beginning|on) ([^.]+)/i)?.[1]?.startsWith(e.dateText) ? e.date : null,
      reasons: ["explicit_source_event"], parser: null, analysis: null, listingRisk: null,
      sourceDocuments: [{url:e.documentUrl,sha256:e.documentHash,text:e.quote}] };
  }
  const scope = observation.scope ?? { issuerCik: "", securityTitle: "", exchange: "" };
  const input = { raw: observation.sourceSnapshot, scope, asOf };
  if (/^(25|25-NSE)(\/A)?$/.test(observation.form)) return evaluateStoredForm25(input);
  const event = { id: observation.eventId, raw_item_id: observation.sourceSnapshot.id, source_code: "sec_edgar" };
  let evaluated = evaluateStoredListingRiskFiling({ ...input, event });
  if (observation.listingRisk) evaluated = applyCurrentListingRiskEvidence(evaluated, observation.listingRisk, scope, asOf);
  // A recovery/appeal label is not proof that a security resumed trading or was relisted.
  const current = observation.listingRisk;
  if (current?.status === "available" && !["listing_removal", "trading_suspension",
    "delisting_determination", "voluntary_withdrawal"].includes(current.facts.classification.event_kind)) {
    evaluated = { ...evaluated, listing: "unresolved", trading: "unresolved",
      reasons: [...evaluated.reasons, "unsupported_listing_transition"] };
  }
  return evaluated;
}

export function buildObservation(input: {
  raw: Row; scope: DelistingScope | null; asOf: string; attachment: Attachment;
  eventId?: string; listingRisk?: CurrentListingRiskReadResult | null; sourceEvent?: ListingSourceEvent;
}): ListingObservation {
  const form = String(record(input.raw.raw_payload).form_type ?? "").toUpperCase();
  const filingDate = String(input.raw.published_at ?? "").slice(0, 10);
  if (!/^(25|25-NSE|8-K|6-K)(\/A)?$/.test(form) || !validDate(input.asOf)
    || !validDate(filingDate) || input.asOf < filingDate) throw Error("invalid_listing_observation_input");
  const sourceSnapshot = listingSourceSnapshot(input.raw);
  const isForm25 = /^(25|25-NSE)(\/A)?$/.test(form);
  const base: Omit<ListingObservation, "reported"> = { version: LISTING_OBSERVATION_VERSION, readerVersion: SEC_DELISTING_STATE_VERSION,
    rawItemId: String(input.raw.id), accession: String(input.raw.source_unique_id), form, filingDate,
    sourceSnapshot, sourceHash: hash(sourceSnapshot), scope: input.scope,
    eventId: isForm25 ? null : input.eventId ?? null,
    listingRisk: isForm25 ? null : input.listingRisk ?? null,
    evaluatedAsOf: input.asOf, attachment: input.attachment,
    ...(input.sourceEvent ? {sourceEvent: input.sourceEvent} : {}) };
  return { ...base, reported: summarize(evaluateObservation(base, input.asOf)) };
}

export type HistoryItem = { id: string; observation: ListingObservation; usable: boolean; reason: string | null;
  resolvedAttachment?: Attachment;
  revalidationFailure?: { reason: "observation_facts_changed"; sourceHash: string;
    storedReported: ListingObservation["reported"]; revalidatedReported: ListingObservation["reported"] } };
/** Query-time projection over selected, persisted SEC evidence. Not a live market status.
 * Unknown/contradictory evidence is never silently discarded in favor of a newer row. */
export function projectListingStatus(input: {
  securityIdentityId: string | null; scope: DelistingScope; asOf: string; observations: HistoryItem[];
}) {
  const result = { asOf: input.asOf, scope: input.scope, securityIdentityId: input.securityIdentityId,
    coverage: "stored_sec_observations_only" as const,
    listing: "unresolved" as ListingState, trading: "unresolved" as TradingStatus,
    removalDate: null as string | null, suspensionDate: null as string | null,
    withdrawalNoticeDate: null as string | null, resumptionDate: null as string | null,
    reasons: [] as string[], observationIds: [] as string[],
    excludedObservations: [] as { id: string; reason: string; sourceHash: string }[],
    closedObservations: [] as { id: string; targetId: string; followUpId: string }[] };
  if (!validDate(input.asOf) || !validScope(input.scope) || input.securityIdentityId !== null && !uuid(input.securityIdentityId)) {
    result.reasons.push("invalid_request"); return result;
  }
  const scoped = input.observations.filter(({ observation: o }) => o.filingDate <= input.asOf
    && (o.scope === null || sameScope(o.scope, input.scope)));
  result.observationIds = scoped.map(item => item.id);
  const selected = scoped.filter(item => {
    const f = item.revalidationFailure;
    if (!item.usable && item.observation.sourceEvent && item.reason === "observation_facts_changed"
      && f?.reason === item.reason && f.sourceHash === item.observation.sourceHash
      && stable(f.storedReported) === stable(item.observation.reported)
      && stable(f.storedReported) !== stable(f.revalidatedReported)) {
      result.excludedObservations.push({ id: item.id, reason: f.reason, sourceHash: f.sourceHash });
      return false;
    }
    return true;
  });
  if (!selected.length) { result.reasons.push("no_status_evidence"); return result; }
  if (!input.securityIdentityId) { result.reasons.push("canonical_identity_unresolved"); return result; }
  for (const item of selected) {
    const o = item.observation; const a = item.resolvedAttachment ?? o.attachment;
    if (!item.usable) result.reasons.push(item.reason || "observation_unavailable");
    if (a.status !== "attached" || a.securityIdentityId !== input.securityIdentityId)
      result.reasons.push(a.status === "conflict" ? "identity_conflict" : "canonical_identity_unresolved");
    if (!a.knownAt || a.knownAt.slice(0, 10) > input.asOf) result.reasons.push("identity_not_established_as_of");
  }
  if (result.reasons.length) { result.reasons = [...new Set(result.reasons)]; return result; }
  const links = new Map<string, HistoryItem[]>();
  for (const item of selected) {
    const e = item.observation.sourceEvent;
    if (!e?.resolves) continue;
    const previous = selected.find(p => p.id === e.resolves!.observationId);
    try {
      if (!previous?.observation.sourceEvent || previous.observation.sourceHash !== e.resolves.sourceHash
        || previous.observation.filingDate > item.observation.filingDate
        || previous.observation.filingDate === item.observation.filingDate && previous.observation.rawItemId !== item.observation.rawItemId
        || !previous.observation.scope || !item.observation.scope || !sameScope(previous.observation.scope,item.observation.scope)) throw Error("invalid_target");
      validateEventLink(e,previous.observation.sourceEvent);
      // Attaching a formerly unresolved immutable observation can create a new
      // stored version, not a new removal decision. Close only exact source-event
      // repetitions; all IDs remain visible. Different evidence/issues stay open.
      const eventFacts = (o: ListingObservation) => ({ rawItemId:o.rawItemId, sourceHash:o.sourceHash,
        scope:o.scope, sourceEvent:o.sourceEvent, reported:o.reported, eventId:o.eventId, listingRisk:o.listingRisk });
      for (const target of selected.filter(p => stable(eventFacts(p.observation)) === stable(eventFacts(previous.observation)))) {
        links.set(target.id,[...(links.get(target.id) ?? []),item]);
        result.closedObservations.push({id:target.id,targetId:previous.id,followUpId:item.id});
      }
    } catch { result.reasons.push("unvalidated_follow_up_link"); }
  }
  if (result.reasons.length) return result;
  const evaluated = selected.map(item => evaluateObservation(item.observation, input.asOf));
  const axis = (kind: "listing" | "trading", dateKey: "removalDate" | "suspensionDate",
    completed: "confirmed_exchange_delisting" | "suspended", pending: "removal_pending" | "suspension_scheduled") => {
    if (selected.some(x => x.observation.sourceEvent)) {
      const relevant = selected.filter(x => !x.observation.sourceEvent || sourceEventAxis(x.observation.sourceEvent) === kind);
      const closed = new Set([...links.keys()].filter(id => relevant.some(x => x.id === id)));
      const active = relevant.filter(x => !closed.has(x.id));
      const closing = active.filter(x => x.observation.sourceEvent && closingEvent(x.observation.sourceEvent));
      if (closing.length) {
        const values = new Set(closing.map(x => x.observation.sourceEvent!.kind + ":" + x.observation.sourceEvent!.date));
        // An unrelated issue or unresolved legacy evidence is never silently removed.
        if (values.size !== 1 || active.length !== closing.length) {
          result.reasons.push(kind + "_unresolved_or_independent_event"); return;
        }
        if (kind === "listing") result.listing = "removal_decision_withdrawn";
        else result.trading = "resumed";
        result[kind === "listing" ? "withdrawalNoticeDate" : "resumptionDate"] = closing[0].observation.sourceEvent!.date;
        result.reasons.push(kind + "_explicit_follow_up:" + [...closed].sort().join(",")); return;
      }
      if (!active.length) { result.reasons.push(kind + "_no_status_evidence"); return; }
    }
    const axisEvidence = evaluated.filter((_,i) => !selected[i].observation.sourceEvent || sourceEventAxis(selected[i].observation.sourceEvent!) === kind);
    if (!axisEvidence.length) { result.reasons.push(kind + "_no_status_evidence"); return; }
    const states = new Set(axisEvidence.map(e => e[kind]));
    const dates = new Set(axisEvidence.map(e => e[dateKey]).filter(Boolean));
    if (states.has("unresolved") || dates.size > 1 || dates.size === 0 && states.has(completed)) {
      result.reasons.push(`${kind}_evidence_unresolved_or_conflicting`); return;
    }
    // Same-date pending -> confirmed is permitted only with a later/equal filing
    // that independently establishes completion; never by adding days to filing date.
    const completedFilings = selected.filter((_, i) => evaluated[i][kind] === completed).map(x => x.observation.filingDate);
    const pendingFilings = selected.filter((_, i) => evaluated[i][kind] === pending).map(x => x.observation.filingDate);
    if (completedFilings.length && pendingFilings.some(d => d > completedFilings.sort().at(-1)!)) {
      result.reasons.push(`${kind}_later_pending_conflict`); return;
    }
    if (kind === "listing") result.listing = completedFilings.length ? "confirmed_exchange_delisting" : "removal_pending";
    else result.trading = completedFilings.length ? "suspended" : "suspension_scheduled";
    result[dateKey] = [...dates][0] ?? null;
  };
  axis("listing", "removalDate", "confirmed_exchange_delisting", "removal_pending");
  axis("trading", "suspensionDate", "suspended", "suspension_scheduled");
  result.reasons = [...new Set([...result.reasons, ...evaluated.flatMap(e => e.reasons)])];
  return result;
}

export function sameScope(a: DelistingScope, b: DelistingScope) {
  return a.issuerCik === b.issuerCik && exact(a.securityTitle) === exact(b.securityTitle) && exact(a.exchange) === exact(b.exchange);
}
export const exact = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const uuid = (s: string) => /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(s);
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function hash(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }
