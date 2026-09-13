import { matchWatchedEventTickers } from "./eventDeliveryDedupe.ts";
import { normalizeSecTickerProjectionExchange } from "../../sec-ticker-resolution/exchangeIdentity.ts";
import type { NormalizedAlertEvent } from "./types.ts";
import type { SecTickerProductProjectionReadResult } from "../../sec-ticker-resolution/productProjectionTypes.ts";
import type { SecCoverObservationReadResult } from "../../sec-cover-observations/persistence.ts";
import type { SecCoverSecurityObservation } from "../../sec-cover-observations/canonical.ts";

export type AlertTickerSubscription = { id: string; ticker: string };
export type AlertTickerBinding = {
  subscriptionId: string;
  savedTicker: string;
  eventTicker: string;
  kind: "literal" | "projection";
  issuerCik?: string;
};
export type AlertTickerMatch = { version: 1; bindings: AlertTickerBinding[] };
export type AlertTickerMatchReaders = {
  projection: (ticker: string) => Promise<SecTickerProductProjectionReadResult>;
  cover: (accession: string) => Promise<SecCoverObservationReadResult>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// One instance per evaluation only; never cache across queue processing/channel claims.
export function createAlertTickerMatcher(readers: AlertTickerMatchReaders = {
  projection: async (ticker) => (await import("../../sec-ticker-resolution/productProjection.ts"))
    .readSecTickerProductProjectionForTicker({ ticker }),
  cover: async (accessionNumber) => (await import("../../sec-cover-observations/persistence.ts"))
    .readSecCoverObservations({ accessionNumber }),
}) {
  const projections = new Map<string, Promise<SecTickerProductProjectionReadResult>>();
  const covers = new Map<string, Promise<SecCoverObservationReadResult>>();
  const projection = (ticker: string) => memo(projections, ticker, readers.projection);
  const cover = (accession: string) => memo(covers, accession, readers.cover);

  return async (event: NormalizedAlertEvent, subscriptions: readonly AlertTickerSubscription[]) => {
    const matchedTickers = matchWatchedEventTickers(event.tickers, new Set(subscriptions.map((s) => s.ticker)));
    const bindings: AlertTickerBinding[] = subscriptions.flatMap((s) => matchedTickers.includes(s.ticker) && UUID.test(s.id)
      ? [{ subscriptionId: s.id, savedTicker: s.ticker, eventTicker: s.ticker, kind: "literal" as const }]
      : []);
    const failures: string[] = [];
    const cik = normalizeCik(event.metadata?.cik);
    const accession = text(event.metadata?.accession_number);
    // SEC filing cover evidence is required. News, issuer-only and ticker-only inputs stay literal.
    if (subscriptions.length && event.sourceType === "filing" && event.marketScope === "company" &&
        event.metadata?.source_code === "sec_edgar" && cik && /^\d{10}-\d{2}-\d{6}$/.test(accession)) {
      for (const eventTicker of new Set(event.tickers)) {
        if (!subscriptions.some((s) => UUID.test(s.id) && s.ticker !== eventTicker)) continue;
        try {
          const projected = await projection(eventTicker);
          if (projected.status !== "available") {
            if (projected.status === "unavailable") failures.push(projected.reason);
            continue;
          }
          const aliases = new Set([projected.currentTicker, ...projected.historicalTickers]);
          const targets = subscriptions.filter((s) => UUID.test(s.id) && s.ticker !== eventTicker && aliases.has(s.ticker));
          if (!targets.length || !aliases.has(eventTicker) || projected.issuerCik !== cik) continue;
          const eventCover = uniqueSecurity(await cover(accession), eventTicker, cik);
          const documentUrl = text(event.metadata?.primary_document_url) || text(event.metadata?.source_url);
          if (!eventCover || !documentUrl || eventCover.sourceUrl !== documentUrl ||
              (eventCover.rawItemId && eventCover.rawItemId !== event.metadata?.raw_item_id)) continue;
          // Reuse the official reader's already verified edge for its source filing, including
          // its exchange normalization. Other filings require an independently matching cover.
          const anchor = projected.sourceFilings.find((s) => s.historicalTicker === eventTicker && s.accessionNumber === accession)
            ?? projected.sourceFilings.find((s) => s.historicalTicker === projected.currentTicker);
          if (!anchor) continue;
          const anchorCover = uniqueSecurity(await cover(anchor.accessionNumber), anchor.historicalTicker, cik);
          if (!anchorCover || securitySignature(eventCover.observation) !== securitySignature(anchorCover.observation)) continue;
          for (const s of targets) bindings.push({ subscriptionId: s.id, savedTicker: s.ticker,
            eventTicker, kind: "projection", issuerCik: cik });
          if (!matchedTickers.includes(eventTicker)) matchedTickers.push(eventTicker);
        } catch {
          failures.push("ticker_projection_read_failed");
        }
      }
    }
    return { matchedTickers, provenance: { version: 1 as const, bindings }, failures };
  };
}

export function parseAlertTickerMatch(value: unknown): AlertTickerMatch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as AlertTickerMatch;
  if (v.version !== 1 || !Array.isArray(v.bindings) || !v.bindings.length || v.bindings.length > 2000) return null;
  if (v.bindings.some((b) => !b || !UUID.test(b.subscriptionId) || !validTicker(b.savedTicker) ||
      !validTicker(b.eventTicker) || (b.kind !== "literal" && b.kind !== "projection") ||
      (b.kind === "literal" && b.savedTicker !== b.eventTicker) ||
      (b.kind === "projection" && (b.savedTicker === b.eventTicker || !/^\d{10}$/.test(b.issuerCik ?? ""))))) return null;
  return v;
}

export function survivingAlertTickerBindings(original: AlertTickerMatch, current: AlertTickerMatch) {
  return current.bindings.filter((b) => original.bindings.some((o) =>
    o.subscriptionId === b.subscriptionId && o.savedTicker === b.savedTicker &&
    o.eventTicker === b.eventTicker && o.kind === b.kind && o.issuerCik === b.issuerCik));
}

function uniqueSecurity(read: SecCoverObservationReadResult, ticker: string, cik: string) {
  // Multiple source revisions/contexts are ambiguous, not absence or issuer identity.
  if (read.status !== "available" || read.results.length !== 1) return null;
  const payload = read.results[0]!.payload;
  if (payload.identity.issuerCik !== cik || payload.extractionStatus !== "available") return null;
  const matches = payload.observations.filter((o) => observed(o.tradingSymbol.status) &&
    text(o.tradingSymbol.parsedTextValue).toUpperCase() === ticker);
  if (matches.length !== 1 || !securitySignature(matches[0]!)) return null;
  return { observation: matches[0]!, rawItemId: payload.identity.rawItemId, sourceUrl: payload.source.url };
}

function securitySignature(o: SecCoverSecurityObservation) {
  if (!observed(o.securityTitle.status) || !observed(o.exchange.status) ||
      !text(o.securityTitle.parsedTextValue) || !text(o.exchange.parsedTextValue)) return "";
  return JSON.stringify([o.issuerCik, normalizedText(o.securityTitle.parsedTextValue),
    normalizeSecTickerProjectionExchange(o.exchange.parsedTextValue), o.context.dimensions]);
}
function normalizedText(v: unknown) { return text(v).replace(/\s+/g, " ").toLowerCase(); }
function observed(status: string) { return status === "observed" || status === "duplicate_equal"; }
function normalizeCik(v: unknown) { const s = text(v); return /^\d{1,10}$/.test(s) ? s.padStart(10, "0") : ""; }
function text(v: unknown) { return typeof v === "string" ? v.trim() : ""; }
function validTicker(v: unknown) { return typeof v === "string" && /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(v); }
function memo<T>(map: Map<string, Promise<T>>, key: string, read: (key: string) => Promise<T>) {
  if (!map.has(key)) map.set(key, read(key));
  return map.get(key)!;
}
