import { createHash } from "node:crypto";
import { evaluateStoredForm25, evaluateStoredListingRiskFiling, applyCurrentListingRiskEvidence,
  record, validDate, validScope, SEC_DELISTING_STATE_VERSION,
  type DelistingEvidence, type DelistingScope } from "../sec-delisting-state/state.ts";
import type { CurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";

export const LISTING_OBSERVATION_VERSION = "sec_listing_observation_v1";
export type Row = Record<string, unknown>;
export type Attachment = {
  status: "attached" | "unresolved" | "conflict";
  securityIdentityId: string | null; decisionId: string | null;
  knownAt: string | null; proofHash: string | null; reason: string;
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
  reported: ReturnType<typeof summarize>;
};

export function summarize(evidence: DelistingEvidence) {
  return { listing: evidence.listing, trading: evidence.trading, removalDate: evidence.removalDate,
    suspensionDate: evidence.suspensionDate, reasons: evidence.reasons,
    parserVersion: evidence.parserVersion,
    sources: evidence.sourceDocuments.map(({ url, sha256 }) => ({ url, sha256 })) };
}
export function evaluateObservation(observation: Pick<ListingObservation,
  "sourceSnapshot" | "scope" | "eventId" | "listingRisk" | "form">, asOf: string) {
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
  eventId?: string; listingRisk?: CurrentListingRiskReadResult | null;
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
    evaluatedAsOf: input.asOf, attachment: input.attachment };
  return { ...base, reported: summarize(evaluateObservation(base, input.asOf)) };
}

export type HistoryItem = { id: string; observation: ListingObservation; usable: boolean; reason: string | null };
/** Query-time projection over selected, persisted SEC evidence. Not a live market status.
 * Unknown/contradictory evidence is never silently discarded in favor of a newer row. */
export function projectListingStatus(input: {
  securityIdentityId: string | null; scope: DelistingScope; asOf: string; observations: HistoryItem[];
}) {
  const result = { asOf: input.asOf, scope: input.scope, securityIdentityId: input.securityIdentityId,
    coverage: "stored_sec_observations_only" as const,
    listing: "unresolved" as DelistingEvidence["listing"], trading: "unresolved" as DelistingEvidence["trading"],
    removalDate: null as string | null, suspensionDate: null as string | null,
    reasons: [] as string[], observationIds: [] as string[] };
  if (!validDate(input.asOf) || !validScope(input.scope) || input.securityIdentityId !== null && !uuid(input.securityIdentityId)) {
    result.reasons.push("invalid_request"); return result;
  }
  const selected = input.observations.filter(({ observation: o }) => o.filingDate <= input.asOf
    && (o.scope === null || sameScope(o.scope, input.scope)));
  result.observationIds = selected.map(item => item.id);
  if (!selected.length) { result.reasons.push("no_status_evidence"); return result; }
  if (!input.securityIdentityId) { result.reasons.push("canonical_identity_unresolved"); return result; }
  for (const item of selected) {
    const o = item.observation; const a = o.attachment;
    if (!item.usable) result.reasons.push(item.reason || "observation_unavailable");
    if (a.status !== "attached" || a.securityIdentityId !== input.securityIdentityId)
      result.reasons.push(a.status === "conflict" ? "identity_conflict" : "canonical_identity_unresolved");
    if (!a.knownAt || a.knownAt.slice(0, 10) > input.asOf) result.reasons.push("identity_not_established_as_of");
  }
  if (result.reasons.length) { result.reasons = [...new Set(result.reasons)]; return result; }
  const evaluated = selected.map(item => evaluateObservation(item.observation, input.asOf));
  const axis = (kind: "listing" | "trading", dateKey: "removalDate" | "suspensionDate",
    completed: "confirmed_exchange_delisting" | "suspended", pending: "removal_pending" | "suspension_scheduled") => {
    const states = new Set(evaluated.map(e => e[kind]));
    const dates = new Set(evaluated.map(e => e[dateKey]).filter(Boolean));
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
