import { resolveCanonicalEventFields } from "@/lib/eventFieldMapping";
import type { MarketBar } from "@/lib/integrations";
import {
  readMarketBarCacheMap,
  readMarketGroupSnapshotCache,
  readMarketQuoteCacheMap,
  type MarketGroupSnapshotPayload,
} from "@/lib/marketDataCache";
import { readHydratedMarketQuoteMap } from "@/lib/marketQuoteHydration";
import {
  buildMarketPulseItems,
  marketPulseDefinitions,
  type MarketPulseItem,
} from "@/lib/marketPulse";
import { type RankedEvent } from "@/lib/radarRankings";
import {
  fetchEventById,
  fetchEventCount,
  fetchEvents,
  supabaseSelect,
} from "@/lib/supabase";
import { hasValidLiveFeedPrimaryTicker } from "@/lib/liveFeedEventPolicy";
import { liveFeedRailQueries } from "@/lib/liveFeedRailPolicy";
import { resolveLiveFeedSource } from "@/lib/liveFeedSource";
import { resolveNewsCompanyName } from "@/lib/newsCompanyIdentity";
import { resolveCanonicalMarketGroup } from "@/lib/taxonomyRegistry";

export type FeedTone = "bullish" | "bearish" | "volatile" | "neutral";
export type SourceGroup = "news" | "filings" | "market";
export type MarketScope = "company" | "sector" | "theme" | "macro";
export type FeedTab = "all" | "news" | "filings" | "market" | "alerts" | "watchlist";

export type LiveFeedItem = {
  accessionNumber: string;
  companyName: string;
  id: string;
  rawItemId: string;
  time: string;
  detectedAtRaw: string;
  ticker: string;
  price: string;
  changeAmount: string;
  change: string;
  updatedAt: string;
  sourceGroup: SourceGroup;
  marketScope: MarketScope;
  sector?: string;
  industryGroup?: string;
  themeGroup?: string;
  subTheme?: string;
  source: string;
  sourceUrl: string;
  formType: string;
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
  displayTicker: string;
  displayPrice: string;
  displayChange: string;
  displayKind: "ticker" | "group" | "macro";
  displayChartBars: MarketBar[];
  keyEvidence: string[];
  relatedTickers: Array<{
    companyName: string;
    context: string;
    ticker: string;
  }>;
  watchNext: string[];
};

export type { MarketPulseItem } from "@/lib/marketPulse";

export type MarketMovingNewsItem = {
  detectedAt: string;
  id: string;
  label: string;
  title: string;
  score: number;
  signal: FeedTone;
};

export type SituationCardItem = {
  label: string;
  value: string;
  window: string;
};

type DbEventRow = Record<string, unknown>;
type QuoteRow = Record<string, unknown>;
type GroupSnapshotLookup = Map<string, MarketGroupSnapshotPayload>;
type FeedPreviewContext = {
  analyses: Map<string, DbEventRow>;
  rawItems: Map<string, DbEventRow>;
  relatedTickers: Map<string, LiveFeedItem["relatedTickers"]>;
};

type EventClassification = {
  sector: string;
  industryGroup: string;
  themeGroup: string;
  subTheme: string;
};

type SharedFeedData = {
  alertFilingRows: DbEventRow[];
  highImpactNewsRows: DbEventRow[];
  marketMovingRows: DbEventRow[];
  marketPulseItems: MarketPulseItem[];
  situationCards: SituationCardItem[];
};

const sharedFeedDataTtlMs = 30_000;
let sharedFeedDataCache: {
  data?: SharedFeedData;
  expiresAt: number;
  promise?: Promise<SharedFeedData>;
} = { expiresAt: 0 };

type LiveFeedViewModelParams = {
  page: number;
  limit: number;
  tab?: FeedTab;
  includeCharts?: boolean;
  includeSharedData?: boolean;
};

type LiveFeedViewModel = Awaited<ReturnType<typeof buildLiveFeedViewModel>>;

const liveFeedViewModelTtlMs = 10_000;
const liveFeedViewModelCache = new Map<
  string,
  {
    data?: LiveFeedViewModel;
    expiresAt: number;
    promise?: Promise<LiveFeedViewModel>;
  }
>();

export async function getLiveFeedViewModel(params: LiveFeedViewModelParams) {
  const activeTab = normalizeFeedTab(params.tab);
  const cacheKey = [
    activeTab,
    params.page,
    params.limit,
    params.includeCharts === false ? "no-charts" : "charts",
    params.includeSharedData === false ? "feed-only" : "full",
  ].join(":");
  const cached = liveFeedViewModelCache.get(cacheKey);
  const now = Date.now();

  if (cached?.data && cached.expiresAt > now) {
    return cached.data;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = buildLiveFeedViewModel(params)
    .then((data) => {
      liveFeedViewModelCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + liveFeedViewModelTtlMs,
      });
      return data;
    })
    .catch((error) => {
      liveFeedViewModelCache.delete(cacheKey);
      throw error;
    });

  liveFeedViewModelCache.set(cacheKey, {
    expiresAt: now + liveFeedViewModelTtlMs,
    promise,
  });

  return promise;
}

async function buildLiveFeedViewModel({
  page,
  limit,
  tab = "all",
  includeCharts,
  includeSharedData = true,
}: LiveFeedViewModelParams) {
  const activeTab = normalizeFeedTab(tab);
  const feedFilters = feedTabToEventFilters(activeTab);
  const [feedResult, sharedFeedData] = await Promise.all([
    fetchEvents({
      page,
      limit,
      excludeDeliveryLevel: "archive",
      excludeTickerlessNonAlertMarketNews: true,
      ...feedFilters,
    }),
    includeSharedData ? fetchSharedFeedData() : Promise.resolve(emptySharedFeedData()),
  ]);

  const feedRows = toRows(feedResult.data);
  const {
    alertFilingRows,
    highImpactNewsRows,
    marketMovingRows,
    marketPulseItems,
    situationCards,
  } = sharedFeedData;
  const rankedRows = [...highImpactNewsRows, ...alertFilingRows];
  const [charts, groupSnapshots, previewContext] = await Promise.all([
    includeCharts === false ? Promise.resolve(new Map<string, ChartResult>()) : fetchChartMap(feedRows),
    fetchFeedGroupSnapshotLookup(feedRows),
    fetchFeedPreviewContext(feedRows),
  ]);
  const quotes = await fetchQuoteMap(
    [...feedRows, ...rankedRows],
    previewContext.relatedTickers,
  );

  const feedItems = feedRows.map((row) =>
    mapEventRow(row, quotes, charts, groupSnapshots, previewContext),
  );
  const highImpactNewsItems = highImpactNewsRows.map((row) => mapEventRow(row, quotes));
  const alertFilingItems = alertFilingRows.map((row) => mapEventRow(row, quotes));

  return {
    ok: feedResult.ok,
    error: feedResult.error,
    page,
    limit,
    activeTab,
    feedDateLabel: formatFeedDate(new Date()),
    total: feedResult.total ?? null,
    hasNext:
      typeof feedResult.total === "number" ? page * limit < feedResult.total : feedRows.length === limit,
    feedItems,
    highImpactNews: highImpactNewsItems.map(toRankedEvent),
    alertFilings: alertFilingItems.map(toRankedEvent),
    marketMovingNews: marketMovingRows
      .map(toMarketMovingNewsItem),
    marketPulseItems,
    situationCards,
  };
}

function emptySharedFeedData(): SharedFeedData {
  return {
    alertFilingRows: [],
    highImpactNewsRows: [],
    marketMovingRows: [],
    marketPulseItems: [],
    situationCards: [],
  };
}

async function fetchSharedFeedData(): Promise<SharedFeedData> {
  const now = Date.now();
  if (sharedFeedDataCache.data && sharedFeedDataCache.expiresAt > now) {
    return sharedFeedDataCache.data;
  }

  if (sharedFeedDataCache.promise) {
    return sharedFeedDataCache.promise;
  }

  sharedFeedDataCache.promise = Promise.all([
    fetchEvents(liveFeedRailQueries.highImpactNews),
    fetchEvents(liveFeedRailQueries.alertFilings),
    fetchEvents(liveFeedRailQueries.marketMoving),
    fetchMarketPulseItems(),
    fetchSituationCards(),
  ])
    .then(([
      highImpactNewsResult,
      alertFilingResult,
      marketMovingResult,
      marketPulseItems,
      situationCards,
    ]) => ({
      alertFilingRows: toRows(alertFilingResult.data),
      highImpactNewsRows: toRows(highImpactNewsResult.data),
      marketMovingRows: toRows(marketMovingResult.data),
      marketPulseItems,
      situationCards,
    }))
    .catch(() => ({
      ...emptySharedFeedData(),
    }));

  const data = await sharedFeedDataCache.promise;
  sharedFeedDataCache = {
    data,
    expiresAt: Date.now() + sharedFeedDataTtlMs,
  };
  return data;
}

export async function getRankingViewModel(sourceGroup: "news" | "filings") {
  const result = await fetchEvents({ page: 1, limit: 100, excludeDeliveryLevel: "archive" });
  const rows = toRows(result.data);
  const quotes = await fetchQuoteMap(rows);
  const items = rows
    .map((row) => mapEventRow(row, quotes))
    .filter((item) => item.sourceGroup === sourceGroup)
    .filter(
      (item) =>
        sourceGroup !== "news" ||
        hasValidLiveFeedPrimaryTicker(item.ticker),
    )
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
  groupSnapshots: GroupSnapshotLookup = new Map(),
  previewContext?: FeedPreviewContext,
): LiveFeedItem {
  const id = readString(row, ["id"]);
  const rawItemId = readString(row, ["raw_item_id"]);
  const analysis = previewContext?.analyses.get(id);
  const rawItem = previewContext?.rawItems.get(rawItemId);
  const ticker = readString(row, ["ticker", "symbol"]) || "N/A";
  const relatedTickers = previewContext?.relatedTickers.get(id) || [];
  const quoteSymbol = resolveEventQuoteSymbol(row, relatedTickers);
  const quote = quotes.get(quoteSymbol);
  const chart = charts.get(ticker.toUpperCase());
  const canonical = resolveCanonicalEventFields(row);
  const classification = readEventClassification(row);
  const detectedAt = readString(row, ["detected_at", "created_at", "event_date"]);
  const sourcePublishedAt =
    readString(row, ["published_at"]) ||
    readMetadataString(row, ["published_at", "publishedAt", "source_published_at", "published_time"]);
  const quoteValues = formatQuote(quote);
  const groupDisplay = buildGroupDisplay(
    row,
    canonical.marketScope,
    classification,
    groupSnapshots,
    quoteValues,
    Boolean(quoteSymbol && (quoteValues.price || quoteValues.change)),
  );
  const summary =
    readString(row, ["summary"]) ||
    readString(row, ["reason"]) ||
    "No summary available yet.";
  const quickTake = canonical.quickTake || summary;
  const sourceUniqueId = readString(rawItem, ["source_unique_id"]);
  const metadataAccession =
    readMetadataString(row, ["accession_number", "accessionNumber", "accession"]) ||
    readMetadataString(rawItem, ["accession_number", "accessionNumber", "accession"]);
  const accessionNumber =
    metadataAccession ||
    (canonical.sourceGroup === "filings" && isSecAccession(sourceUniqueId)
      ? sourceUniqueId
      : "");
  const sourceCode = readString(row, ["source_code", "source", "source_channel"]);
  const sourceName = readString(row, ["source_name"]);
  const companyName = canonical.sourceGroup === "news"
    ? resolveNewsCompanyName({
        configuredSourceName: sourceName,
        rawPayload: readMetadataRecord(row),
        sourceCode,
        title: readString(row, ["title"]),
      }) || resolveNewsCompanyName({
        configuredSourceName: sourceName,
        rawPayload: readMetadataRecord(rawItem),
        sourceCode,
        title: readString(row, ["title"]),
      }) || ""
    : readMetadataString(row, ["company_name", "companyName", "issuer_name", "issuerName", "company"]) ||
      readMetadataString(rawItem, ["company_name", "companyName", "issuer_name", "issuerName", "company"]);
  const formType =
    readMetadataString(row, ["form_type", "formType", "form"]) ||
    readMetadataString(rawItem, ["form_type", "formType", "form"]);

  return {
    accessionNumber,
    companyName,
    id: id || `${ticker}-${detectedAt || "event"}`,
    rawItemId,
    time: formatDetectedTime(detectedAt),
    detectedAtRaw: sourcePublishedAt || detectedAt,
    ticker,
    price: quoteValues.price,
    changeAmount: quoteValues.changeAmount,
    change: quoteValues.change,
    updatedAt: quoteValues.updatedAt || formatDetectedTime(detectedAt),
    sourceGroup: canonical.sourceGroup,
    marketScope: canonical.marketScope,
    sector: classification.sector,
    industryGroup: classification.industryGroup,
    themeGroup: classification.themeGroup,
    subTheme: classification.subTheme,
    source: resolveLiveFeedSource(
      sourceName,
      sourceCode,
    ),
    sourceUrl: readString(row, ["source_url", "source_link", "url"]) || readMetadataString(row, ["source_url"]),
    formType,
    eventType: readString(row, ["event_type"]) || "event",
    title: readString(row, ["title"]) || "Untitled event",
    quickTake,
    summary,
    scoreReason:
      readString(row, ["reason", "score_reason"]) ||
      summary ||
      "Event score was derived from the available database fields.",
    score: canonical.score,
    deliveryLevel: canonical.deliveryLevel,
    impact: canonical.impact,
    signal: canonical.signal,
    trend: buildTrend(canonical.signal, canonical.score),
    chartBars: chart?.bars || [],
    chartProvider: chart?.provider || "none",
    displayTicker: groupDisplay ? groupDisplay.ticker : ticker,
    displayPrice: groupDisplay ? groupDisplay.price : quoteValues.price,
    displayChange: groupDisplay ? groupDisplay.change : quoteValues.change,
    displayKind: groupDisplay ? groupDisplay.kind : "ticker",
    displayChartBars: groupDisplay ? groupDisplay.bars : chart?.bars || [],
    keyEvidence: readStringArray(analysis, ["key_evidence"]),
    relatedTickers,
    watchNext: readStringArray(analysis, ["watch_next"]),
  };
}

async function fetchFeedPreviewContext(
  rows: DbEventRow[],
): Promise<FeedPreviewContext> {
  const eventIds = uniqueUuidValues(rows.map((row) => readString(row, ["id"])));
  const rawItemIds = uniqueUuidValues(
    rows.map((row) => readString(row, ["raw_item_id"])),
  );
  if (!eventIds.length) {
    return {
      analyses: new Map(),
      rawItems: new Map(),
      relatedTickers: new Map(),
    };
  }

  const [analysisResult, rawItemResult, tickerResult] = await Promise.all([
    supabaseSelect("event_analysis", {
      select: "event_id,key_evidence,watch_next",
      event_id: `in.(${eventIds.join(",")})`,
      limit: String(eventIds.length),
    }),
    rawItemIds.length
      ? supabaseSelect("raw_items", {
          select: "id,source_unique_id,metadata",
          id: `in.(${rawItemIds.join(",")})`,
          limit: String(rawItemIds.length),
        })
      : Promise.resolve({ data: [] }),
    supabaseSelect("event_tickers", {
      select: "event_id,symbol,role,reason,metadata",
      event_id: `in.(${eventIds.join(",")})`,
      order: "sort_order.asc",
      limit: String(Math.min(eventIds.length * 8, 200)),
    }),
  ]);

  const analyses = new Map(
    toRows(analysisResult.data)
      .map((row) => [readString(row, ["event_id"]), row] as const)
      .filter(([eventId]) => Boolean(eventId)),
  );
  const rawItems = new Map(
    toRows(rawItemResult.data)
      .map((row) => [readString(row, ["id"]), row] as const)
      .filter(([rawItemId]) => Boolean(rawItemId)),
  );
  const relatedTickers = new Map<string, LiveFeedItem["relatedTickers"]>();

  for (const row of toRows(tickerResult.data)) {
    const eventId = readString(row, ["event_id"]);
    const ticker = readString(row, ["symbol"]).toUpperCase();
    if (!eventId || !ticker) continue;

    const current = relatedTickers.get(eventId) || [];
    if (current.some((item) => item.ticker === ticker)) continue;
    current.push({
      companyName: readMetadataString(row, [
        "company_name",
        "companyName",
        "issuer_name",
      ]),
      context: readString(row, ["reason", "role"]),
      ticker,
    });
    relatedTickers.set(eventId, current);
  }

  return { analyses, rawItems, relatedTickers };
}

function toRankedEvent(item: LiveFeedItem): RankedEvent {
  return {
    id: item.id,
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

function readEventClassification(row: DbEventRow): EventClassification {
  return {
    sector: readString(row, ["sector"]) || readMetadataString(row, ["sector", "sector_name", "sectorName"]),
    industryGroup:
      readString(row, ["industry_group"]) ||
      readMetadataString(row, ["industry_group", "industryGroup", "industry", "industry_name"]),
    themeGroup:
      readString(row, ["theme_group"]) ||
      readMetadataString(row, ["theme_group", "themeGroup", "theme", "theme_group_name"]),
    subTheme:
      readString(row, ["sub_theme"]) ||
      readMetadataString(row, ["sub_theme", "subTheme", "sub_theme_name"]),
  };
}

function buildGroupDisplay(
  row: DbEventRow,
  marketScope: MarketScope,
  classification: EventClassification,
  snapshots: GroupSnapshotLookup,
  quote: ReturnType<typeof formatQuote>,
  hasTickerQuote: boolean,
):
  | {
      ticker: string;
      price: string;
      change: string;
      kind: "group" | "macro";
      bars: MarketBar[];
    }
  | null {
  if (marketScope === "company") return null;

  const snapshot = resolveFeedGroupSnapshot(marketScope, classification, snapshots);
  const fallback = resolveFallbackGroupDisplay(row, marketScope, classification);
  const ticker = snapshot?.groupName || fallback.label;
  const change = hasTickerQuote
    ? quote.change
    : snapshot
      ? formatSignedPercent(snapshot.changePercent)
      : "";

  return {
    bars: snapshot ? groupSnapshotToBars(snapshot) : [],
    change,
    kind: marketScope === "macro" && !snapshot ? "macro" : "group",
    price: hasTickerQuote ? quote.price : "",
    ticker,
  };
}

function resolveFeedGroupSnapshot(
  marketScope: MarketScope,
  classification: EventClassification,
  snapshots: GroupSnapshotLookup,
) {
  const candidates =
    marketScope === "theme"
      ? [
          ["sub_theme", classification.subTheme],
          ["theme", classification.themeGroup],
          ["industry_group", classification.industryGroup],
          ["sector", classification.sector],
        ]
      : marketScope === "sector"
        ? [
            ["industry_group", classification.industryGroup],
            ["sector", classification.sector],
          ]
        : [
            ["sub_theme", classification.subTheme],
            ["theme", classification.themeGroup],
            ["industry_group", classification.industryGroup],
            ["sector", classification.sector],
          ];

  for (const [scope, label] of candidates) {
    const snapshot = lookupGroupSnapshot(snapshots, scope, label);
    if (snapshot) return snapshot;
  }

  return null;
}

function resolveFallbackGroupDisplay(
  row: DbEventRow,
  marketScope: MarketScope,
  classification: EventClassification,
) {
  const ordered =
    marketScope === "theme"
      ? [
          ["Sub Theme", classification.subTheme],
          ["Theme", classification.themeGroup],
          ["Industry", classification.industryGroup],
          ["Sector", classification.sector],
        ]
      : marketScope === "sector"
        ? [
            ["Industry", classification.industryGroup],
            ["Sector", classification.sector],
          ]
        : [
            ["Theme", classification.themeGroup],
            ["Sector", classification.sector],
          ];

  for (const [scopeLabel, label] of ordered) {
    if (label) return { label: formatGroupLabel(label), scopeLabel };
  }

  return {
    label: readMarketMovingLabel(row, marketScope) || formatMarketScopeLabel(marketScope),
    scopeLabel: formatMarketScopeLabel(marketScope),
  };
}

function lookupGroupSnapshot(snapshots: GroupSnapshotLookup, scope: string, label: string) {
  if (!label) return null;
  const direct = snapshots.get(groupSnapshotLookupKey(scope, label));
  if (direct) return direct;

  const canonical = resolveCanonicalMarketGroup(label);
  if (!canonical) return null;

  const industrySnapshot =
    canonical.subCategory && scope !== "sector"
      ? snapshots.get(groupSnapshotLookupKey("industry_group", canonical.subCategory))
      : null;
  if (industrySnapshot) return industrySnapshot;

  return snapshots.get(groupSnapshotLookupKey("sector", canonical.sector)) || null;
}

function groupSnapshotToBars(snapshot: MarketGroupSnapshotPayload): MarketBar[] {
  const points = snapshot.trendPoints.filter((value) => Number.isFinite(value)).slice(-22);
  if (!points.length) return [];

  return points.map((close, index) => {
    const open = index > 0 ? points[index - 1] : close;
    const spread = Math.max(Math.abs(close - open), 0.05);

    return {
      close,
      date: `${snapshot.scope}:${snapshot.groupKey}:${index}`,
      high: Math.max(open, close) + spread * 0.35,
      low: Math.min(open, close) - spread * 0.35,
      open,
      volume: 1000 + index * 120,
    };
  });
}

function formatGroupLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/[_-]/.test(trimmed)) return trimmed;

  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bIpo\b/g, "IPO")
    .replace(/\bSpac\b/g, "SPAC")
    .replace(/\bFda\b/g, "FDA");
}

function toMarketMovingNewsItem(row: DbEventRow): MarketMovingNewsItem {
  const canonical = resolveCanonicalEventFields(row);

  return {
    detectedAt: readString(row, ["detected_at", "published_at"]),
    id: readString(row, ["id"]),
    label: readMarketMovingLabel(row, canonical.marketScope),
    title: readString(row, ["title"]) || "Untitled market-moving event",
    score: canonical.score,
    signal: canonical.signal,
  };
}

function readMarketMovingLabel(row: DbEventRow, marketScope: MarketScope) {
  if (marketScope === "macro") {
    return (
      readMetadataString(row, ["macro_category", "macroCategory", "policy_area", "policyArea"]) ||
      "Macro"
    );
  }

  if (marketScope === "sector") {
    return (
      readMetadataString(row, ["sector_name", "sectorName", "sector", "industry_group", "industryGroup"]) ||
      "Sector"
    );
  }

  if (marketScope === "theme") {
    return (
      readMetadataString(row, ["theme_group_name", "themeGroupName", "theme_group", "themeGroup", "theme"]) ||
      "Theme"
    );
  }

  return formatMarketScopeLabel(marketScope);
}

function formatMarketScopeLabel(value: MarketScope) {
  if (value === "macro") return "Macro";
  if (value === "sector") return "Sector";
  if (value === "theme") return "Theme";
  return "Company";
}

export function normalizeFeedTab(value: string | undefined): FeedTab {
  const normalized = (value || "all").trim().toLowerCase();
  if (
    normalized === "news" ||
    normalized === "filings" ||
    normalized === "market" ||
    normalized === "alerts" ||
    normalized === "watchlist"
  ) {
    return normalized;
  }

  return "all";
}

function feedTabToEventFilters(tab: FeedTab) {
  if (tab === "news") return { sourceGroup: "news" as const };
  if (tab === "filings") return { sourceGroup: "filings" as const };
  if (tab === "market") {
    return { sourceGroup: "news" as const, marketScopes: ["sector", "theme", "macro"] as MarketScope[] };
  }
  if (tab === "alerts") return { alertOnly: true };
  return {};
}

async function fetchSituationCards(): Promise<SituationCardItem[]> {
  const now = new Date();
  const counts = await Promise.all([
    fetchEventCount({ alertOnly: true, detectedAfter: hoursAgo(now, 24) }),
    fetchEventCount({ eventTypes: ["dilution_risk"], detectedAfter: daysAgo(now, 7) }),
    fetchEventCount({ eventTypes: ["listing_risk"], detectedAfter: daysAgo(now, 30) }),
    fetchEventCount({ eventTypes: ["earnings"], detectedAfter: daysAgo(now, 7) }),
    fetchEventCount({ eventTypes: ["insider_ownership"], detectedAfter: daysAgo(now, 14) }),
    fetchEventCount({ eventTypes: ["dividends"], detectedAfter: daysAgo(now, 30) }),
    fetchEventCount({ eventTypes: ["fda_clinical"], detectedAfter: daysAgo(now, 30) }),
  ]);

  return [
    { label: "Today's Alerts", value: formatCount(counts[0].count), window: "Last 24H" },
    { label: "Dilution Risk", value: formatCount(counts[1].count), window: "Last 7D" },
    { label: "Listing Risk", value: formatCount(counts[2].count), window: "Last 30D" },
    { label: "Earnings", value: formatCount(counts[3].count), window: "Last 7D" },
    { label: "Insider / Ownership", value: formatCount(counts[4].count), window: "Last 14D" },
    { label: "Dividends", value: formatCount(counts[5].count), window: "Last 30D" },
    { label: "FDA / Clinical", value: formatCount(counts[6].count), window: "Last 30D" },
  ];
}

async function fetchQuoteMap(
  rows: DbEventRow[],
  relatedTickers?: Map<string, LiveFeedItem["relatedTickers"]>,
) {
  const symbols = Array.from(
    new Set(
      rows
        .map((row) =>
          resolveEventQuoteSymbol(
            row,
            relatedTickers?.get(readString(row, ["id"])),
          ),
        )
        .filter((ticker) => ticker && ticker !== "N/A")
    )
  ).slice(0, 40);

  if (!symbols.length) return new Map<string, QuoteRow>();

  const cachedQuotes = await readHydratedMarketQuoteMap(symbols);
  return new Map(
    Array.from(cachedQuotes.entries()).map(([symbol, quote]) => [
      symbol,
      {
        change: quote.changeAmount,
        changeAmount: quote.changeAmount,
        changePercent: quote.changePercent,
        changePercentage: quote.changePercent,
        changesPercentage: quote.changePercent,
        previousClose: quote.previousClose,
        price: quote.price,
        provider: quote.provider,
        symbol,
        volume: quote.volume,
      },
    ]),
  );
}

async function fetchMarketPulseItems(): Promise<MarketPulseItem[]> {
  const symbols = marketPulseDefinitions.map((item) => item.cacheSymbol);
  const [quoteMap, barMap] = await Promise.all([
    readMarketQuoteCacheMap(symbols),
    readMarketBarCacheMap(symbols, "1D"),
  ]);

  return buildMarketPulseItems(quoteMap, barMap);
}

async function fetchFeedGroupSnapshotLookup(rows: DbEventRow[]): Promise<GroupSnapshotLookup> {
  const needsGroupSnapshots = rows.some((row) => {
    const canonical = resolveCanonicalEventFields(row);
    return canonical.sourceGroup === "news" && canonical.marketScope !== "company";
  });

  if (!needsGroupSnapshots) return new Map();

  const result = await readMarketGroupSnapshotCache("1D");
  if (!result.hit) return new Map();

  return buildGroupSnapshotLookup(result.snapshots);
}

function buildGroupSnapshotLookup(snapshots: MarketGroupSnapshotPayload[]): GroupSnapshotLookup {
  const lookup: GroupSnapshotLookup = new Map();

  for (const snapshot of snapshots) {
    for (const value of [snapshot.groupName, snapshot.groupKey]) {
      const key = groupSnapshotLookupKey(snapshot.scope, value);
      if (key && !lookup.has(key)) lookup.set(key, snapshot);
    }
  }

  return lookup;
}

type ChartResult = {
  bars: MarketBar[];
  provider: "polygon" | "fmp" | "none";
};

async function fetchChartMap(rows: DbEventRow[]) {
  const symbols = Array.from(
    new Set(
      rows
        .map((row) => {
          const canonical = resolveCanonicalEventFields(row);
          if (canonical.marketScope !== "company") return "";
          return readString(row, ["ticker", "symbol"]).toUpperCase();
        })
        .filter((ticker) => ticker && ticker !== "N/A")
    )
  ).slice(0, 20);

  if (!symbols.length) return new Map<string, ChartResult>();

  const cachedBars = await readMarketBarCacheMap(symbols, "1D");
  const results = symbols.map((symbol) => {
    const cached = cachedBars.get(symbol);
    return [
      symbol,
      {
        bars: cached
          ? cached.points.map((point) => ({
              close: point.close,
              date: point.time,
              high: point.high,
              low: point.low,
              open: point.open,
              volume: point.volume,
            }))
          : [],
        provider: cached?.provider || "none",
      },
    ] as [string, ChartResult];
  });

  return new Map<string, ChartResult>(results);
}

function formatQuote(quote?: QuoteRow) {
  const price = readNumber(quote, ["price"]);
  const change = readNumber(quote, ["change", "changeAmount", "change_amount"]);
  const changePct = readNumber(quote, ["changePercentage", "changesPercentage", "changePercent", "change_percent"]);
  const timestamp = readNumber(quote, ["timestamp"]);
  const sign = change < 0 || changePct < 0 ? "-" : "+";

  return {
    price: Number.isFinite(price) ? formatCurrency(price) : "",
    changeAmount: Number.isFinite(change) ? `$${formatAbs(change)}` : "",
    change: Number.isFinite(changePct) ? `${sign}${Math.abs(changePct).toFixed(2)}%` : "",
    updatedAt: timestamp ? formatDetectedTime(new Date(timestamp * 1000).toISOString()) : "",
  };
}

function resolveEventQuoteSymbol(
  row: DbEventRow,
  relatedTickers: LiveFeedItem["relatedTickers"] = [],
) {
  const candidates = [
    readString(row, ["ticker", "symbol"]),
    ...relatedTickers.map((item) => item.ticker),
    ...readMetadataTickerCandidates(row),
  ];

  return (
    candidates
      .map((value) => value.trim().toUpperCase())
      .find(hasValidLiveFeedPrimaryTicker) || ""
  );
}

function readMetadataTickerCandidates(row: DbEventRow) {
  if (!row.metadata || typeof row.metadata !== "object") return [];
  const metadata = row.metadata as Record<string, unknown>;
  const values = [
    metadata.related_tickers,
    metadata.relatedTickers,
    metadata.tickers,
  ];
  const candidates: string[] = [];

  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") {
        candidates.push(item);
      } else if (item && typeof item === "object") {
        candidates.push(
          readString(item as Record<string, unknown>, ["ticker", "symbol"]),
        );
      }
    }
  }

  return candidates.filter(Boolean).slice(0, 8);
}

function formatSignedPercent(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function groupSnapshotLookupKey(scope: string, value: string) {
  const normalized = normalizeGroupLookupValue(value);
  return normalized ? `${scope}:${normalized}` : "";
}

function normalizeGroupLookupValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_/-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function formatFeedDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function hoursAgo(now: Date, hours: number) {
  const date = new Date(now);
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

function daysAgo(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function formatCount(value: number | null) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "N/A";
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

function readStringArray(row: DbEventRow | undefined, keys: string[]) {
  if (!row) return [];

  for (const key of keys) {
    const value = row[key];
    if (!Array.isArray(value)) continue;

    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 8);
  }

  return [];
}

function readMetadataString(row: DbEventRow | undefined, keys: string[]) {
  if (!row || !row.metadata || typeof row.metadata !== "object") return "";
  return readString(row.metadata as Record<string, unknown>, keys);
}

function readMetadataRecord(row: DbEventRow | undefined) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : null;
}

function uniqueUuidValues(values: string[]) {
  return Array.from(
    new Set(
      values.filter((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
      ),
    ),
  );
}

function isSecAccession(value: string) {
  return /^\d{10}-\d{2}-\d{6}$/.test(value);
}
