import "server-only";
import { normalizeStockTicker } from "./stockOverview.ts";
import type { StockListingStatus } from "./stockListingStatus.ts";
import { resolveListingAttachment } from "../sec-listing-status/identity.ts";
import { readSecListingHistory, readSecListingStatusAsOf } from "../sec-listing-status/persistence.ts";
import { readReviewedSecListingObservation } from "../sec-listing-status/review.ts";
import { record, validScope } from "../sec-delisting-state/state.ts";
import { sameScope, uuid } from "../sec-listing-status/observation.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

type Dependencies = {
  repository?: SecTickerResolutionRepository;
  resolveAttachment?: typeof resolveListingAttachment;
  readHistory?: typeof readSecListingHistory;
  readAsOf?: typeof readSecListingStatusAsOf;
  readReview?: typeof readReviewedSecListingObservation;
  now?: Date;
};

/** Read-only adapter shared by SSR and JSON. The ticker query only discovers
 * candidates; the existing identity and canonical readers authorize all facts. */
export async function readStockListingStatus(tickerInput: string, deps: Dependencies = {}): Promise<StockListingStatus> {
  const ticker = normalizeStockTicker(tickerInput);
  if (!ticker) throw Error("invalid_stock_ticker");
  const asOf = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const result: StockListingStatus = {
    ticker, asOf, coverage: "stored_sec_observations_only", availability: "unknown",
    reason: "identity_unresolved", security: null,
    automatic: { listing: "unresolved", trading: "unresolved", removalDate: null,
      suspensionDate: null, withdrawalNoticeDate: null, resumptionDate: null },
    sources: [], reviewedDates: [],
  };
  try {
    const repo = deps.repository ?? await defaultRepository();
    const candidates = await repo.select("sec_ticker_security_identities", {
      select: "*", order: "created_at.asc,id.asc", limit: "101",
      or: `(identity_payload->before->>tradingSymbol.eq.${ticker},identity_payload->after->>tradingSymbol.eq.${ticker})`,
    });
    if (!candidates.ok || !Array.isArray(candidates.data) || candidates.data.length > 100)
      throw Error("identity_read_incomplete");
    if (!candidates.data.length) return result;
    // A ticker reused across securities, or historical/current ambiguity, cannot
    // be settled by choosing a row. The stock route already resolves known aliases.
    if (new Set(candidates.data.map(r => r.id)).size !== 1) {
      return { ...result, reason: "conflicting_evidence" };
    }
    const identity = candidates.data[0];
    const after = record(record(identity.identity_payload).after);
    if (after.tradingSymbol !== ticker || !uuid(String(identity.id))) return result;
    const scope = { issuerCik: String(identity.issuer_cik ?? ""),
      securityTitle: String(after.securityTitle ?? ""), exchange: String(after.exchange ?? "") };
    if (!validScope(scope)) return result;
    const attachment = await (deps.resolveAttachment ?? resolveListingAttachment)(scope, repo, asOf);
    if (attachment.status !== "attached" || attachment.securityIdentityId !== identity.id
      || !attachment.knownAt || attachment.knownAt.slice(0, 10) > asOf) {
      return { ...result, reason: attachment.status === "conflict" ? "conflicting_evidence" : "identity_unresolved" };
    }
    const history = await (deps.readHistory ?? readSecListingHistory)({ scope, repository: repo });
    // A source may use a shorter subject title than its validated cover row.
    // Only the official reader's exact attachment may authorize that scope.
    const scopes = history.filter(item => item.usable && item.observation.filingDate <= asOf
      && (item.resolvedAttachment ?? item.observation.attachment).securityIdentityId === identity.id
      && (item.resolvedAttachment ?? item.observation.attachment).status === "attached")
      .flatMap(item => item.observation.scope ? [item.observation.scope] : []);
    const uniqueScopes = scopes.filter((s, i) => scopes.findIndex(t => sameScope(s, t)) === i);
    if (uniqueScopes.length > 1) return { ...result, reason: "conflicting_evidence" };
    const projection = await (deps.readAsOf ?? readSecListingStatusAsOf)({
      scope: uniqueScopes[0] ?? scope, securityIdentityId: String(identity.id), asOf, repository: repo,
    });
    result.security = { issuerCik: scope.issuerCik, title: scope.securityTitle, exchange: scope.exchange };
    result.automatic = { listing: projection.listing, trading: projection.trading,
      removalDate: projection.removalDate, suspensionDate: projection.suspensionDate,
      withdrawalNoticeDate: projection.withdrawalNoticeDate, resumptionDate: projection.resumptionDate };
    result.availability = projection.listing !== "unresolved" || projection.trading !== "unresolved" ? "available" : "unknown";
    result.reason = projection.reasons.some(r => r.endsWith("_conflict")) ? "conflicting_evidence"
      : projection.reasons.some(r => /unresolved_or_conflicting|independent_event/.test(r)) ? "evidence_unresolved_or_conflicting"
      : projection.reasons.some(r => /identity/.test(r)) ? "identity_unresolved"
      : result.availability === "unknown" ? "insufficient_evidence" : null;
    const excluded = new Set(projection.excludedObservations.map(o => o.id));
    const closed = new Set(projection.closedObservations.map(o => o.id));
    for (const item of history) {
      if (!item.usable || !projection.observationIds.includes(item.id) || excluded.has(item.id)
        || (item.resolvedAttachment ?? item.observation.attachment).securityIdentityId !== identity.id) continue;
      const o = item.observation;
      for (const source of o.reported.sources) {
        const url = secDocumentUrl(source.url, o.accession);
        if (!url) continue;
        result.sources.push({ form: o.form, accession: o.accession, filingDate: o.filingDate,
          url, role: closed.has(item.id) ? "closed_event" : "evidence" });
      }
      const review = await (deps.readReview ?? readReviewedSecListingObservation)({ observationId: item.id, repository: repo });
      if (review.reviewStatus !== "reviewed" || !review.reviewedFacts) continue;
      for (const field of ["notice_date", "suspension_effective_date"] as const) {
        const fact = review.reviewedFacts[field];
        const doc = review.documents.find(d => d.id === fact.sourceRef && d.sha256 === fact.sourceHash);
        const sourceUrl = doc && secDocumentUrl(doc.url, o.accession);
        if (sourceUrl) result.reviewedDates.push({ accession: o.accession, field,
          availability: fact.availability, value: fact.value, sourceUrl });
      }
    }
    result.sources = result.sources.filter((s, i, all) => all.findIndex(t => JSON.stringify(t) === JSON.stringify(s)) === i);
    return result;
  } catch {
    // Do not leak database errors or downgrade an incomplete read to "no evidence".
    return { ...result, availability: "unavailable", reason: "reader_unavailable", security: null,
      automatic: { listing: "unresolved", trading: "unresolved", removalDate: null,
        suspensionDate: null, withdrawalNoticeDate: null, resumptionDate: null }, sources: [], reviewedDates: [] };
  }
}

function secDocumentUrl(value: string, accession: string) {
  try {
    const u = new URL(value);
    return /^\d{10}-\d{2}-\d{6}$/.test(accession) && u.protocol === "https:"
      && (u.hostname === "sec.gov" || u.hostname === "www.sec.gov") && !u.username && !u.password
      && u.pathname.startsWith("/Archives/edgar/data/") && u.pathname.includes(`/${accession.replaceAll("-", "")}/`)
      ? u.href : null;
  } catch { return null; }
}
async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
