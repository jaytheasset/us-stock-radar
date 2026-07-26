import {
  getDirectionalScoreTone,
  type DirectionalScoreTone,
} from "../directionalScore.ts";

export type StockOverviewSignal = "bullish" | "bearish" | "volatile" | "neutral";

export type StockOverviewEvent = {
  category: string;
  companyName: string;
  detectedAt: string;
  detailHref: string | null;
  eventType: string;
  formType: string;
  id: string;
  score: number | null;
  scoreTone: DirectionalScoreTone;
  signal: StockOverviewSignal;
  source: string;
  sourceGroup: "news" | "filings" | "market";
  summary: string;
  ticker: string;
  title: string;
};

export type StockOverviewProfile = {
  companyName: string;
  country: string;
  description: string;
  exchange: string;
  industry: string;
  marketCap: number | null;
  sector: string;
  website: string;
};

export type StockOverviewQuote = {
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  previousClose: number | null;
  price: number | null;
  volume: number | null;
  yearHigh: number | null;
  yearLow: number | null;
};

export type StockOverviewChartPoint = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: string;
  volume: number;
};

export type TickerSearchResult = {
  assetType: string | null;
  companyName: string;
  exchange: string | null;
  marketCap: number | null;
  ticker: string;
};

export type StockOverviewSelectionMode = "stock" | "watchlist";

const eventUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const financialEventTerms = [
  "earnings",
  "financial",
  "guidance",
  "sales_performance",
  "periodic_report",
];
const ownershipEventTerms = [
  "insider",
  "ownership",
  "beneficial",
  "form_4",
  "13d",
  "13g",
  "144",
];
const dilutionEventTerms = [
  "dilution",
  "offering",
  "shelf",
  "atm",
  "convertible",
  "warrant",
  "s-8",
];

export function resolveWatchlistTicker(
  requestedTicker: string | null | undefined,
  savedTickers: readonly string[],
) {
  const normalized = normalizeStockTicker(requestedTicker);
  const normalizedSaved = savedTickers
    .map(normalizeStockTicker)
    .filter((ticker): ticker is string => Boolean(ticker));

  if (normalized && normalizedSaved.includes(normalized)) {
    return normalized;
  }

  return normalizedSaved[0] ?? null;
}

export function resolveStockOverviewTicker(
  requestedTicker: string | null | undefined,
  savedTickers: readonly string[],
  mode: StockOverviewSelectionMode,
) {
  return mode === "stock"
    ? normalizeStockTicker(requestedTicker)
    : resolveWatchlistTicker(requestedTicker, savedTickers);
}

export function normalizeStockTicker(value: unknown) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(ticker) ? ticker : null;
}

export function getStockRouteHref(value: unknown) {
  const ticker = normalizeStockTicker(value);
  return ticker ? `/stocks/${encodeURIComponent(ticker)}` : null;
}

export function hasStockOverviewData(
  profile: StockOverviewProfile,
  quote: StockOverviewQuote,
  events: readonly StockOverviewEvent[],
) {
  return Boolean(
    profile.companyName ||
      profile.exchange ||
      profile.description ||
      profile.industry ||
      profile.sector ||
      profile.marketCap !== null ||
      Object.values(quote).some((value) => value !== null) ||
      events.length,
  );
}

export function mapStockOverviewProfile(
  payload: unknown,
  fallbackCompanyName = "",
): StockOverviewProfile {
  const row = firstDataRow(payload);
  return {
    companyName:
      readString(row, ["companyName", "company_name", "name"]) ||
      fallbackCompanyName,
    country: readString(row, ["country"]),
    description: readString(row, ["description"]),
    exchange: readString(row, ["exchangeShortName", "exchange", "exchangeFullName"]),
    industry: readString(row, ["industry"]),
    marketCap: readNumber(row, ["mktCap", "marketCap", "market_cap"]),
    sector: readString(row, ["sector"]),
    website: safeHttpUrl(readString(row, ["website"])),
  };
}

export function mapStockOverviewQuote(payload: unknown): StockOverviewQuote {
  const row = firstDataRow(payload);
  return {
    change: readNumber(row, ["change"]),
    changePercent: readNumber(row, [
      "changesPercentage",
      "changePercentage",
      "changePercent",
    ]),
    dayHigh: readNumber(row, ["dayHigh", "high"]),
    dayLow: readNumber(row, ["dayLow", "low"]),
    open: readNumber(row, ["open"]),
    previousClose: readNumber(row, ["previousClose"]),
    price: readNumber(row, ["price"]),
    volume: readNumber(row, ["volume"]),
    yearHigh: readNumber(row, ["yearHigh"]),
    yearLow: readNumber(row, ["yearLow"]),
  };
}

export function mapStockOverviewChart(payload: unknown): StockOverviewChartPoint[] {
  const record = asRecord(payload);
  const points = Array.isArray(record?.points) ? record.points : [];
  return points
    .map((value) => {
      const row = asRecord(value);
      if (!row) return null;
      const close = readNumber(row, ["close"]);
      const high = readNumber(row, ["high"]);
      const low = readNumber(row, ["low"]);
      const open = readNumber(row, ["open"]);
      if (close === null || high === null || low === null || open === null) {
        return null;
      }
      return {
        close,
        high,
        low,
        open,
        time: readString(row, ["time"]),
        volume: readNumber(row, ["volume"]) ?? 0,
      };
    })
    .filter((point): point is StockOverviewChartPoint => Boolean(point));
}

export function mapStockOverviewEvents(payload: unknown): StockOverviewEvent[] {
  const record = asRecord(payload);
  const rows = Array.isArray(record?.data) ? record.data : [];
  return rows
    .map(mapStockOverviewEvent)
    .filter((event): event is StockOverviewEvent => Boolean(event));
}

export function mapTickerSearchResults(payload: unknown): TickerSearchResult[] {
  const record = asRecord(payload);
  const rows = Array.isArray(record?.data) ? record.data : [];
  return rows
    .map((value) => {
      const row = asRecord(value);
      const ticker = normalizeStockTicker(readString(row, ["ticker"]));
      const companyName = readString(row, ["companyName"]);
      if (!ticker || !companyName) return null;
      return {
        assetType: readNullableString(row, ["assetType"]),
        companyName,
        exchange: readNullableString(row, ["exchange"]),
        marketCap: readNumber(row, ["marketCap"]),
        ticker,
      };
    })
    .filter((item): item is TickerSearchResult => Boolean(item));
}

export function selectStockOverviewEvents(
  events: readonly StockOverviewEvent[],
  section: "financials" | "ownership" | "dilution",
) {
  const terms =
    section === "financials"
      ? financialEventTerms
      : section === "ownership"
        ? ownershipEventTerms
        : dilutionEventTerms;

  return events.filter((event) => {
    const haystack = `${event.eventType} ${event.formType} ${event.category}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
}

export function formatStockOverviewEt(
  value: string,
  format: "date" | "time" | "full" = "full",
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/New_York",
    ...(format !== "time" ? { day: "numeric", month: "short" } : {}),
    ...(format !== "date" ? { hour: "numeric", minute: "2-digit" } : {}),
  };
  return `${new Intl.DateTimeFormat("en-US", options).format(date)}${format === "date" ? "" : " ET"}`;
}

export function formatCompactMarketValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function isPersistentEventId(value: string) {
  return eventUuidPattern.test(value.trim());
}

function mapStockOverviewEvent(value: unknown): StockOverviewEvent | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readString(row, ["id"]);
  const ticker =
    normalizeStockTicker(readString(row, ["ticker", "symbol"])) ?? "";
  const sourceGroup = normalizeSourceGroup(readString(row, ["source_group"]));
  const detectedAt =
    readString(row, ["published_at", "detected_at", "created_at", "event_date"]);
  const signal = normalizeSignal(readString(row, ["signal"]));
  const score = readNumber(row, ["score"]);
  const eventType = readString(row, ["event_type"]) || "event";
  const formType =
    readString(row, ["form_type"]) ||
    readMetadataString(row, ["form_type", "formType", "form"]);
  const detailHref = isPersistentEventId(id)
    ? sourceGroup === "filings"
      ? `/filings/${encodeURIComponent(id)}`
      : `/events/${encodeURIComponent(id)}`
    : null;

  return {
    category: humanizeEventType(eventType),
    companyName:
      readMetadataString(row, ["company_name", "companyName", "issuer_name"]) ||
      ticker,
    detectedAt,
    detailHref,
    eventType,
    formType,
    id: id || `${ticker || "event"}-${detectedAt || "unknown"}`,
    score,
    scoreTone: getDirectionalScoreTone(score, signal),
    signal,
    source:
      readString(row, ["source_name", "source_code", "source", "source_channel"]) ||
      (sourceGroup === "filings" ? "SEC" : "Source unavailable"),
    sourceGroup,
    summary:
      readString(row, ["summary", "reason", "quick_take"]) ||
      "Analysis summary is not available yet.",
    ticker,
    title: readString(row, ["title"]) || "Untitled event",
  };
}

function firstDataRow(payload: unknown) {
  const record = asRecord(payload);
  const data = record?.data;
  const first = Array.isArray(data) ? data[0] : data;
  return asRecord(first);
}

function normalizeSourceGroup(value: string): StockOverviewEvent["sourceGroup"] {
  if (value === "filings" || value === "market") return value;
  return "news";
}

function normalizeSignal(value: string): StockOverviewSignal {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "bullish" ||
    normalized === "bearish" ||
    normalized === "volatile"
  ) {
    return normalized;
  }
  return "neutral";
}

function humanizeEventType(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function readMetadataString(row: Record<string, unknown>, keys: string[]) {
  const metadata = asRecord(row.metadata);
  return readString(metadata, keys);
}

function readString(row: Record<string, unknown> | null, keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNullableString(row: Record<string, unknown> | null, keys: string[]) {
  return readString(row, keys) || null;
}

function readNumber(row: Record<string, unknown> | null, keys: string[]) {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function safeHttpUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
