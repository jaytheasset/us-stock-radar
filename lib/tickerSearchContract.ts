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
};

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

export async function readTickerSearchResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as TickerSearchResponse | null;
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || "Ticker search failed.");
  }
  return mapTickerSearchResults(payload);
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
