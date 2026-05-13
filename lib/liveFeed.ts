import { fetchDailyBars, fetchFmpQuotes, type MarketBar } from "@/lib/integrations";
import { type RankedEvent } from "@/lib/radarRankings";
import { fetchEventById, fetchEvents } from "@/lib/supabase";

export type FeedTone = "bullish" | "bearish" | "volatile" | "neutral";
export type SourceGroup = "news" | "filings" | "market";

export type LiveFeedItem = {
  id: string;
  time: string;
  ticker: string;
  price: string;
  changeAmount: string;
  change: string;
  updatedAt: string;
  sourceGroup: SourceGroup;
  source: string;
  eventType: string;
  title: string;
  quickTake: string;
  summary: string;
  scoreReason: string;
  score: number;
  deliveryLevel: "archive" | "feed" | "alert";
  impact: "high" | "medium" | "low";
  signal: FeedTone;
  trend: number[];
  chartBars: MarketBar[];
  chartProvider: "polygon" | "fmp" | "none";
};

export type MarketPulseItem = {
  label: string;
  value: string;
  detail: string;
  tone: FeedTone;
};

type DbEventRow = Record<string, unknown>;
type QuoteRow = Record<string, unknown>;

const marketPulseSymbols = [
  { symbol: "SPY", label: "SPY", detail: "Large caps" },
  { symbol: "QQQ", label: "QQQ", detail: "Growth" },
  { symbol: "IWM", label: "IWM", detail: "Small caps" },
  { symbol: "DIA", label: "DIA", detail: "Dow" },
  { symbol: "TLT", label: "TLT", detail: "Treasury bonds" },
  { symbol: "GLD", label: "GLD", detail: "Gold" },
];

export async function getLiveFeedViewModel({
  page,
  limit,
}: {
  page: number;
  limit: number;
}) {
  const [feedResult, rankingResult] = await Promise.all([
    fetchEvents({ page, limit }),
    fetchEvents({ page: 1, limit: 100 }),
  ]);

  const feedRows = toRows(feedResult.data);
  const rankingRows = toRows(rankingResult.data);
  const [quotes, charts, marketPulseItems] = await Promise.all([
    fetchQuoteMap([...feedRows, ...rankingRows]),
    fetchChartMap(feedRows),
    fetchMarketPulseItems(),
  ]);

  const feedItems = feedRows.map((row) => mapEventRow(row, quotes, charts));
  const rankingItems = rankingRows.map((row) => mapEventRow(row, quotes));

  return {
    ok: feedResult.ok,
    error: feedResult.error,
    page,
    limit,
    total: feedResult.total ?? null,
    hasNext:
      typeof feedResult.total === "number" ? page * limit < feedResult.total : feedRows.length === limit,
    feedItems,
    highImpactNews: rankingItems
      .filter(isIndividualStockNews)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(toRankedEvent),
    alertFilings: rankingItems
      .filter((item) => item.sourceGroup === "filings")
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(toRankedEvent),
    marketPulseItems,
  };
}

export async function getRankingViewModel(sourceGroup: "news" | "filings") {
  const result = await fetchEvents({ page: 1, limit: 100 });
  const rows = toRows(result.data);
  const quotes = await fetchQuoteMap(rows);
  const items = rows
    .map((row) => mapEventRow(row, quotes))
    .filter((item) => item.sourceGroup === sourceGroup)
    .filter((item) => sourceGroup !== "news" || hasIndividualTicker(item.ticker))
    .sort((a, b) => b.score - a.score)
    .map(toRankedEvent);

  return {
    ok: result.ok,
    error: result.error,
    items,
  };
}

export async function getLiveEventDetail(id: string) {
  const result = await fetchEventById(id);
  const row = result.data && typeof result.data === "object" ? (result.data as DbEventRow) : null;

  if (!row) {
    return {
      ok: false,
      error: result.error,
      item: null,
    };
  }

  const quotes = await fetchQuoteMap([row]);

  return {
    ok: true,
    error: undefined,
    item: mapEventRow(row, quotes),
  };
}

function mapEventRow(
  row: DbEventRow,
  quotes: Map<string, QuoteRow>,
  charts = new Map<string, ChartResult>(),
): LiveFeedItem {
  const ticker = readString(row, ["ticker", "symbol"]) || "N/A";
  const quote = quotes.get(ticker.toUpperCase());
  const chart = charts.get(ticker.toUpperCase());
  const score = deriveScore(row);
  const impact = deriveImpact(row);
  const signal = deriveSignal(row);
  const detectedAt = readString(row, ["detected_at", "created_at", "event_date"]);
  const quoteValues = formatQuote(quote);
  const summary =
    readString(row, ["summary"]) ||
    readMetadataString(row, ["summary", "long_summary"]) ||
    readString(row, ["reason"]) ||
    "No summary available yet.";
  const quickTake =
    readString(row, ["quick_take", "quickTake", "quick_take_text"]) ||
    readMetadataString(row, ["quick_take", "quickTake", "quick_take_text"]) ||
    summary;

  return {
    id: readString(row, ["id"]) || `${ticker}-${detectedAt || "event"}`,
    time: formatDetectedTime(detectedAt),
    ticker,
    price: quoteValues.price,
    changeAmount: quoteValues.changeAmount,
    change: quoteValues.change,
    updatedAt: quoteValues.updatedAt || formatDetectedTime(detectedAt),
    sourceGroup: deriveSourceGroup(row),
    source: formatSource(readString(row, ["source_code", "source", "source_channel"])),
    eventType: readString(row, ["event_type"]) || "event",
    title: readString(row, ["title"]) || "Untitled event",
    quickTake,
    summary,
    scoreReason:
      readString(row, ["reason", "score_reason"]) ||
      summary ||
      "Event score was derived from the available database fields.",
    score,
    deliveryLevel: deriveDeliveryLevel(row, score),
    impact,
    signal,
    trend: buildTrend(signal, score),
    chartBars: chart?.bars || [],
    chartProvider: chart?.provider || "none",
  };
}

function toRankedEvent(item: LiveFeedItem): RankedEvent {
  return {
    ticker: item.ticker,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    updatedAt: item.updatedAt,
    title: item.title,
    source: item.source,
    sourceGroup: item.sourceGroup === "filings" ? "filings" : "news",
    eventType: item.eventType,
    score: item.score,
    signal: item.signal,
    time: item.time,
  };
}

function isIndividualStockNews(item: LiveFeedItem) {
  return item.sourceGroup === "news" && hasIndividualTicker(item.ticker);
}

function hasIndividualTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NA" || ticker === "UNKNOWN" || ticker === "-") {
    return false;
  }

  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker);
}

async function fetchQuoteMap(rows: DbEventRow[]) {
  const symbols = Array.from(
    new Set(
      rows
        .map((row) => readString(row, ["ticker", "symbol"]).toUpperCase())
        .filter((ticker) => ticker && ticker !== "N/A")
    )
  ).slice(0, 40);

  if (!symbols.length) return new Map<string, QuoteRow>();

  const result = await fetchFmpQuotes(symbols);
  const data = Array.isArray(result.data) ? result.data : [];

  const entries: Array<[string, QuoteRow]> = data
    .filter((row): row is QuoteRow => Boolean(row) && typeof row === "object")
    .map((row) => [readString(row, ["symbol"]).toUpperCase(), row] as [string, QuoteRow])
    .filter(([symbol]) => Boolean(symbol));

  return new Map<string, QuoteRow>(entries);
}

async function fetchMarketPulseItems(): Promise<MarketPulseItem[]> {
  const result = await fetchFmpQuotes(marketPulseSymbols.map((item) => item.symbol));
  const data = Array.isArray(result.data) ? result.data : [];
  const quoteMap = new Map(
    data
      .filter((row): row is QuoteRow => Boolean(row) && typeof row === "object")
      .map((row) => [readString(row, ["symbol"]).toUpperCase(), row] as [string, QuoteRow])
      .filter(([symbol]) => Boolean(symbol)),
  );

  return marketPulseSymbols.map((item) => {
    const quote = quoteMap.get(item.symbol);
    const changePct = readNumber(quote, ["changePercentage", "changesPercentage"]);
    const tone = deriveMarketPulseTone(changePct);

    return {
      label: item.label,
      value: Number.isFinite(changePct) ? formatSignedPercent(changePct) : "N/A",
      detail: item.detail,
      tone,
    };
  });
}

type ChartResult = {
  bars: MarketBar[];
  provider: "polygon" | "fmp" | "none";
};

async function fetchChartMap(rows: DbEventRow[]) {
  const symbols = Array.from(
    new Set(
      rows
        .map((row) => readString(row, ["ticker", "symbol"]).toUpperCase())
        .filter((ticker) => ticker && ticker !== "N/A")
    )
  ).slice(0, 20);

  if (!symbols.length) return new Map<string, ChartResult>();

  const results = await Promise.all(
    symbols.map(async (symbol) => {
      const result = await fetchDailyBars(symbol, 22);
      return [
        symbol,
        {
          bars: Array.isArray(result.data) ? result.data : [],
          provider:
            result.provider === "polygon" || result.provider === "fmp" ? result.provider : "none",
        },
      ] as [string, ChartResult];
    })
  );

  return new Map<string, ChartResult>(results);
}

function formatQuote(quote?: QuoteRow) {
  const price = readNumber(quote, ["price"]);
  const change = readNumber(quote, ["change"]);
  const changePct = readNumber(quote, ["changePercentage", "changesPercentage"]);
  const timestamp = readNumber(quote, ["timestamp"]);
  const sign = change < 0 || changePct < 0 ? "-" : "+";

  return {
    price: Number.isFinite(price) ? formatCurrency(price) : "N/A",
    changeAmount: Number.isFinite(change) ? `$${formatAbs(change)}` : "$0.00",
    change: Number.isFinite(changePct) ? `${sign}${Math.abs(changePct).toFixed(2)}%` : "+0.00%",
    updatedAt: timestamp ? formatDetectedTime(new Date(timestamp * 1000).toISOString()) : "",
  };
}

function deriveMarketPulseTone(changePct: number): FeedTone {
  if (!Number.isFinite(changePct)) return "neutral";
  if (changePct > 0.05) return "bullish";
  if (changePct < -0.05) return "bearish";
  return "neutral";
}

function formatSignedPercent(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function deriveSourceGroup(row: DbEventRow): SourceGroup {
  const value = readString(row, ["source_group"]).toLowerCase();
  if (value === "news" || value === "filings" || value === "market") return value;

  const source = `${readString(row, ["source_code"])} ${readString(row, ["source_channel"])} ${readString(row, ["event_type"])}`.toLowerCase();
  if (source.includes("sec") || source.includes("edgar") || /\b(8-k|10-k|10-q|s-1|form4|filing)\b/.test(source)) {
    return "filings";
  }
  if (source.includes("fmp") || source.includes("polygon") || source.includes("market")) {
    return "market";
  }
  return "news";
}

function deriveImpact(row: DbEventRow): "high" | "medium" | "low" {
  const impact = readString(row, ["impact", "impact_level"]).toLowerCase();
  if (impact === "high" || impact === "medium" || impact === "low") return impact;
  return "medium";
}

function deriveSignal(row: DbEventRow): FeedTone {
  const value = readString(row, ["signal", "market_direction", "direction"]).toLowerCase();
  if (value === "bullish" || value === "up") return "bullish";
  if (value === "bearish" || value === "down") return "bearish";
  if (value === "volatile" || value === "volatility_watch" || value === "mixed") return "volatile";
  return "neutral";
}

function deriveScore(row: DbEventRow) {
  const directScore = readNumber(row, ["score"]);
  if (Number.isFinite(directScore)) return clampScore(directScore);

  const impact = deriveImpact(row);
  const confidence = readString(row, ["confidence"]).toLowerCase();
  const base = impact === "high" ? 82 : impact === "medium" ? 68 : 52;
  const confidenceBoost = confidence === "high" ? 4 : confidence === "low" ? -4 : 0;

  return clampScore(base + confidenceBoost);
}

function deriveDeliveryLevel(row: DbEventRow, score: number): "archive" | "feed" | "alert" {
  const value = readString(row, ["delivery_level", "impact_level"]).toLowerCase();
  if (value === "archive" || value === "feed" || value === "alert") return value;
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function buildTrend(signal: FeedTone, score: number) {
  const start = signal === "bearish" ? 50 : 22;
  const direction = signal === "bearish" ? -1 : signal === "neutral" ? 0 : 1;
  return Array.from({ length: 12 }, (_, index) => {
    const wobble = index % 2 === 0 ? 1 : -1;
    return start + direction * index * 2 + wobble + Math.round(score / 20);
  });
}

function formatDetectedTime(value: string) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatSource(value: string) {
  const normalized = value.toLowerCase();
  const known: Record<string, string> = {
    accesswire: "Accesswire",
    sec_edgar: "SEC",
    globe: "GlobeNewswire",
    globenewswire: "GlobeNewswire",
    businesswire: "Business Wire",
    prnewswire: "PR Newswire",
    newsfile: "Newsfile",
    fmp: "FMP",
    polygon: "Polygon",
  };

  return known[normalized] || value || "Unknown";
}

function formatCurrency(value: number) {
  const digits = Math.abs(value) < 10 ? 2 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatAbs(value: number) {
  return Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toRows(value: unknown): DbEventRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is DbEventRow => Boolean(row) && typeof row === "object")
    : [];
}

function readString(row: DbEventRow | QuoteRow | undefined, keys: string[]) {
  if (!row) return "";

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return "";
}

function readMetadataString(row: DbEventRow | undefined, keys: string[]) {
  const metadata = row?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";

  for (const key of keys) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function readNumber(row: DbEventRow | QuoteRow | undefined, keys: string[]) {
  if (!row) return Number.NaN;

  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return Number.NaN;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
