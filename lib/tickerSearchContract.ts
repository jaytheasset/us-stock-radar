export type TickerSearchResult = {
  assetType: string | null;
  companyName: string;
  exchange: string | null;
  historicalTicker?: string | null;
  isHistoricalTicker?: boolean;
  marketCap: number | null;
  ticker: string;
};

export type TickerSearchResponse = {
  data?: unknown;
  error?: string;
  message?: string;
  ok?: boolean;
  partial?: boolean;
};

export type TickerSearchRead = { data: TickerSearchResult[]; partial?: true };
export const TICKER_SEARCH_UNAVAILABLE_MESSAGE = "Ticker search is temporarily unavailable. Please try again.";
export const TICKER_SEARCH_PARTIAL_MESSAGE = "Some results may be unavailable.";

export class TickerSearchUnavailableError extends Error {
  readonly code = "TICKER_SEARCH_UNAVAILABLE";
  constructor() { super(TICKER_SEARCH_UNAVAILABLE_MESSAGE); }
}

export function completeTickerSearch(data: TickerSearchResult[], partial = false): TickerSearchRead {
  if (partial && !data.length) throw new TickerSearchUnavailableError();
  return { data, ...(partial ? { partial: true as const } : {}) };
}

// Array-only callers cannot silently treat an incomplete search as complete.
export function requireCompleteTickerSearch(result: TickerSearchRead) {
  if (result.partial) throw new TickerSearchUnavailableError();
  return result.data;
}

export function normalizeTickerSearchQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/[^A-Za-z0-9 .&'-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

export function normalizeTickerSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(ticker) ? ticker : null;
}

export function mapTickerSearchResults(payload: unknown): TickerSearchResult[] {
  const response = asRecord(payload);
  const rows = Array.isArray(response?.data) ? response.data : [];
  const seen = new Set<string>();

  return rows.flatMap((value) => {
    const row = asRecord(value);
    const ticker = normalizeTickerSymbol(readString(row, "ticker"));
    const companyName = readString(row, "companyName");
    if (!ticker || !companyName || seen.has(ticker)) return [];
    seen.add(ticker);

    const rawMarketCap = row?.marketCap;
    const historicalTicker = normalizeTickerSymbol(row?.historicalTicker);
    const isHistoricalTicker = row?.isHistoricalTicker === true &&
      Boolean(historicalTicker) && historicalTicker !== ticker;
    const marketCap =
      rawMarketCap === null || rawMarketCap === undefined || rawMarketCap === ""
        ? Number.NaN
        : Number(rawMarketCap);
    return [{
      assetType: readString(row, "assetType") || null,
      companyName,
      exchange: readString(row, "exchange") || null,
      ...(isHistoricalTicker ? { historicalTicker, isHistoricalTicker: true } : {}),
      marketCap: Number.isFinite(marketCap) ? marketCap : null,
      ticker,
    }];
  });
}

export function parseTickerSearchResponse(payload: unknown, httpStatus: number): TickerSearchRead {
  const row = asRecord(payload);
  if (httpStatus < 200 || httpStatus >= 300 || row?.ok !== true || !Array.isArray(row.data) ||
      (row.partial !== undefined && typeof row.partial !== "boolean") ||
      row.data.some((value) => {
        const item = asRecord(value);
        return !normalizeTickerSymbol(item?.ticker) || !readString(item, "companyName");
      })) {
    throw new TickerSearchUnavailableError();
  }
  return completeTickerSearch(mapTickerSearchResults(payload), row.partial === true);
}

export async function readTickerSearchResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  return parseTickerSearchResponse(payload, response.status);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(row: Record<string, unknown> | null, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}
