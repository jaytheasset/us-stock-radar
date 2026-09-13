import { unavailableCurrentPrice, type CurrentPrice } from "../market-data/marketDataProvider.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";
import type { SecTickerProductProjectionReadResult } from "../sec-ticker-resolution/productProjectionTypes.ts";
import type { SecCoverObservationReadResult } from "../sec-cover-observations/persistence.ts";
import type { SecCoverSecurityObservation } from "../sec-cover-observations/canonical.ts";
import { normalizeSecTickerProjectionExchange } from "../sec-ticker-resolution/exchangeIdentity.ts";

type Row = Readonly<Record<string, unknown>>;
export type MonitorCurrentPriceProjectionReaders = Readonly<{
  projection(ticker: string): Promise<SecTickerProductProjectionReadResult>;
  event(eventId: string): Promise<Row | null>;
  cover(accession: string): Promise<SecCoverObservationReadResult>;
}>;
const defaultReaders: MonitorCurrentPriceProjectionReaders = {
  projection: async (ticker) => (await import("../sec-ticker-resolution/productProjection.ts"))
    .readSecTickerProductProjectionForTicker({ ticker }),
  event: async (eventId) => {
    const repository = await import("../supabase.ts");
    const result = await repository.supabaseSelect("events", {
      select: "id,ticker,source_code,source_group,raw_item_id,metadata", id: `eq.${eventId}`, limit: "1",
    });
    if (!result.ok) throw new Error("Monitor price event read failed");
    return Array.isArray(result.data) ? result.data[0] as Row ?? null : null;
  },
  cover: async (accessionNumber) => (await import("../sec-cover-observations/persistence.ts"))
    .readSecCoverObservations({ accessionNumber }),
};

/** Only a live quote's lookup symbol changes. No event, fact, snapshot or Alert is written. */
export async function readMonitorCurrentPrice(
  input: Readonly<{ eventId: string; historicalTicker: string; ownership?: CurrentOwnershipReadResult }>,
  dependencies: Readonly<{
    readCurrentPrice(symbol: string): Promise<CurrentPrice>;
    projectionReaders?: MonitorCurrentPriceProjectionReaders;
  }>,
): Promise<CurrentPrice> {
  const historicalTicker = ticker(input.historicalTicker);
  if (!historicalTicker) return unavailableCurrentPrice(historicalTicker);
  let quoteTicker = historicalTicker;
  try {
    quoteTicker = await currentQuoteTicker(input, historicalTicker, dependencies.projectionReaders ?? defaultReaders);
  } catch {
    // Unavailable relationship evidence cannot authorize a different security.
  }
  try {
    return await dependencies.readCurrentPrice(quoteTicker);
  } catch {
    return unavailableCurrentPrice(quoteTicker);
  }
}

async function currentQuoteTicker(
  input: Readonly<{ eventId: string; ownership?: CurrentOwnershipReadResult }>,
  historicalTicker: string,
  readers: MonitorCurrentPriceProjectionReaders,
): Promise<string> {
  // This official reader already applies Human decisions, freshness and security-chain conflicts.
  const projection = await readers.projection(historicalTicker);
  if (projection.status !== "available" || projection.currentTicker === historicalTicker
      || !projection.historicalTickers.includes(historicalTicker) || !ticker(projection.currentTicker)) return historicalTicker;
  const event = await readers.event(input.eventId);
  const metadata = record(event?.metadata);
  const accession = text(metadata.accession_number);
  if (!event || event.id !== input.eventId || ticker(event.ticker) !== historicalTicker
      || event.source_code !== "sec_edgar" || event.source_group !== "filings"
      || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return historicalTicker;
  const anchors = projection.sourceFilings.filter((filing) => filing.historicalTicker === historicalTicker);
  if (!anchors.length) return historicalTicker;

  // Form 4/144 have no cover XBRL. Their official reader verifies XML issuer/source provenance.
  // A derivative, missing title or mixed class cannot borrow a common-stock quote through this adapter.
  if (input.ownership?.status === "available") {
    const ownership = input.ownership;
    if (ownership.eventId !== input.eventId || ownership.rawItemId !== event.raw_item_id
        || ownership.accessionNumber !== accession || !ownership.rows.length) return historicalTicker;
    const titles = new Set(anchors.map((anchor) => normalized(anchor.securityTitle)));
    if (titles.size !== 1 || ![...titles][0]) return historicalTicker;
    if (!ownership.rows.every((row) => {
      const provenance = record(row.provenance);
      const identity = record(provenance.issuer_identity);
      const sourceRow = record(provenance.source_row);
      return ticker(row.symbol) === historicalTicker
        && normalizeCik(identity.xml_cik) === projection.issuerCik
        && normalizeCik(identity.target_cik) === projection.issuerCik
        && provenance.source_verified === true
        && titles.has(normalized(row.security_title))
        && (ownership.form !== "form4" || sourceRow.group === "non_derivative_transactions")
        && (!text(row.exchange) || anchors.every((anchor) =>
          normalizeSecTickerProjectionExchange(text(row.exchange)) === normalizeSecTickerProjectionExchange(anchor.exchange)));
    })) return historicalTicker;
    return projection.currentTicker;
  }

  const cik = normalizeCik(metadata.cik);
  if (cik !== projection.issuerCik) return historicalTicker;
  const sourceUrl = text(metadata.primary_document_url) || text(metadata.source_url);
  const cover = uniqueSecurity(await readers.cover(accession), historicalTicker, cik);
  if (!cover || !sourceUrl || cover.sourceUrl !== sourceUrl
      || (cover.rawItemId && cover.rawItemId !== event.raw_item_id)) return historicalTicker;
  // Compare against the separately observed current side, never a historical cover with itself.
  const anchor = projection.sourceFilings.find((filing) => filing.historicalTicker === projection.currentTicker);
  if (!anchor || anchor.accessionNumber === accession) return historicalTicker;
  const anchorCover = uniqueSecurity(await readers.cover(anchor.accessionNumber), projection.currentTicker, cik);
  return anchorCover && anchorCover.sourceUrl === anchor.sourceUrl
    && normalized(anchorCover.observation.securityTitle.parsedTextValue) === normalized(anchor.securityTitle)
    && normalizeSecTickerProjectionExchange(anchorCover.observation.exchange.parsedTextValue) === normalizeSecTickerProjectionExchange(anchor.exchange)
    && securitySignature(cover.observation) === securitySignature(anchorCover.observation)
    ? projection.currentTicker : historicalTicker;
}

function uniqueSecurity(read: SecCoverObservationReadResult, symbol: string, cik: string) {
  if (read.status !== "available" || read.results.length !== 1) return null;
  const payload = read.results[0]!.payload;
  if (payload.identity.issuerCik !== cik || payload.extractionStatus !== "available") return null;
  const matches = payload.observations.filter((observation) => observed(observation.tradingSymbol.status)
    && ticker(observation.tradingSymbol.parsedTextValue) === symbol);
  if (matches.length !== 1 || !securitySignature(matches[0]!)) return null;
  return { observation: matches[0]!, rawItemId: payload.identity.rawItemId, sourceUrl: payload.source.url };
}
function securitySignature(observation: SecCoverSecurityObservation) {
  if (!observed(observation.securityTitle.status) || !observed(observation.exchange.status)
      || !text(observation.securityTitle.parsedTextValue) || !text(observation.exchange.parsedTextValue)) return "";
  return JSON.stringify([observation.issuerCik, normalized(observation.securityTitle.parsedTextValue),
    normalizeSecTickerProjectionExchange(observation.exchange.parsedTextValue), observation.context.dimensions]);
}
function observed(status: string) { return status === "observed" || status === "duplicate_equal"; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function normalized(value: unknown) { return text(value).replace(/\s+/g, " ").toLowerCase(); }
function normalizeCik(value: unknown) { const s = text(value); return /^\d{1,10}$/.test(s) ? s.padStart(10, "0") : ""; }
function ticker(value: unknown) { const s = text(value).toUpperCase(); return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(s) ? s : ""; }
