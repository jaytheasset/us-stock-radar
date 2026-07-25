import "server-only";

import {
  getLiveFeedViewModel,
  type FeedTab,
  type LiveFeedItem,
  type MarketMovingNewsItem,
  type MarketPulseItem,
  type SituationCardItem,
} from "@/lib/liveFeed";
import {
  createLiveFeedV2RailEventIdentity,
  decodeLiveFeedV2Cursor,
  encodeLiveFeedV2Cursor,
  formatLiveFeedV2Timestamp,
  liveFeedV2BatchSize,
  resolveLiveFeedV2MarketData,
  type LiveFeedV2Filter,
  type LiveFeedV2Item,
  type LiveFeedV2Kind,
  type LiveFeedV2Page,
  type LiveFeedV2RailDestination,
  type LiveFeedV2Sentiment,
} from "@/lib/liveFeedV2Contract";
import {
  createLiveFeedV2Preview,
  type LiveFeedV2PreviewSource,
} from "@/lib/liveFeedV2Preview";
import type { RankedEvent } from "@/lib/radarRankings";

export type LiveFeedV2RailEvent = {
  detailHref: string | null;
  headline: string;
  id: string;
  impactScore: number;
  label: string;
  sentiment: LiveFeedV2Sentiment;
  timeLabel: string;
};

export type LiveFeedV2InitialData = {
  alertFilings: readonly LiveFeedV2RailEvent[];
  highImpactNews: readonly LiveFeedV2RailEvent[];
  marketMovingNews: readonly LiveFeedV2RailEvent[];
  marketPulse: readonly MarketPulseItem[];
  page: LiveFeedV2Page;
  situationItems: readonly SituationCardItem[];
};

export async function getLiveFeedV2InitialData(): Promise<LiveFeedV2InitialData> {
  const viewModel = await getLiveFeedViewModel({
    includeCharts: true,
    limit: liveFeedV2BatchSize,
    page: 1,
    tab: "all",
  });

  return {
    alertFilings: viewModel.alertFilings.map((item) =>
      mapRankedEvent(item, "filings"),
    ),
    highImpactNews: viewModel.highImpactNews.map((item) =>
      mapRankedEvent(item, "events"),
    ),
    marketMovingNews: viewModel.marketMovingNews.map(mapMarketMovingEvent),
    marketPulse: viewModel.marketPulseItems,
    page: mapViewModelPage(viewModel, "all", 1),
    situationItems: viewModel.situationCards,
  };
}

export async function loadLiveFeedV2Page({
  cursor,
  filter,
}: {
  cursor?: string | null;
  filter: LiveFeedV2Filter;
}): Promise<LiveFeedV2Page> {
  if (filter === "watchlist") {
    return {
      availability: "unavailable",
      emptyMessage:
        "Watchlist activity is not available in Live Feed yet. Your saved tickers remain available on the Watchlist page.",
      filter,
      items: [],
      nextCursor: null,
      totalCount: 0,
    };
  }

  const page = decodeLiveFeedV2Cursor(cursor);
  const viewModel = await getLiveFeedViewModel({
    includeCharts: true,
    includeSharedData: false,
    limit: liveFeedV2BatchSize,
    page,
    tab: filter as FeedTab,
  });

  return mapViewModelPage(viewModel, filter, page);
}

function mapViewModelPage(
  viewModel: Awaited<ReturnType<typeof getLiveFeedViewModel>>,
  filter: LiveFeedV2Filter,
  page: number,
): LiveFeedV2Page {
  return {
    availability: "available",
    emptyMessage: emptyMessageForFilter(filter),
    error: viewModel.ok ? undefined : viewModel.error,
    filter,
    items: viewModel.feedItems.map((item) =>
      mapLiveFeedItem(item, viewModel.feedItems),
    ),
    nextCursor: viewModel.hasNext
      ? encodeLiveFeedV2Cursor(page + 1)
      : null,
    totalCount: viewModel.total,
  };
}

function mapLiveFeedItem(
  item: LiveFeedItem,
  relatedItems: readonly LiveFeedItem[],
): LiveFeedV2Item {
  const previewSource = mapPreviewSource(item);
  const feedType = previewSource.feedType;
  const timestamp = item.detectedAtRaw;
  const formattedTime = formatLiveFeedV2Timestamp(timestamp);
  const chartBars = item.displayChartBars.length
    ? item.displayChartBars
    : item.chartBars;
  const marketData = resolveLiveFeedV2MarketData({
    changeLabel: item.displayChange,
    chartCloses: chartBars.map((bar) => bar.close),
    priceLabel: item.displayPrice,
  });

  return {
    category: previewSource.category,
    changePercent: marketData.changePercent,
    company:
      item.displayKind === "ticker"
        ? item.source
        : `${formatMarketScope(item.marketScope)} market event`,
    detailHref: previewSource.detailHref,
    feedType,
    headline: item.title,
    id: item.id || `${item.ticker}-${item.title}`,
    impactScore: item.score,
    price: marketData.price,
    sentiment: formatSentiment(item.signal),
    source: item.source,
    sparkline: marketData.sparkline,
    summary: item.quickTake || item.summary,
    ticker: item.displayTicker,
    timestamp,
    timeDateLabel: formattedTime.dateLabel,
    timeLabel: formattedTime.timeLabel,
    preview: createLiveFeedV2Preview(
      previewSource,
      relatedItems.map(mapPreviewSource),
    ),
  };
}

function mapPreviewSource(item: LiveFeedItem): LiveFeedV2PreviewSource {
  const feedType = resolveFeedType(item);

  return {
    accessionNumber: item.accessionNumber,
    category: normalizeCategory(item.eventType, feedType),
    companyName: item.companyName,
    detailHref:
      feedType === "filings" ? `/filings/${item.id}` : `/events/${item.id}`,
    feedType,
    formType: item.formType,
    headline: item.title,
    id: item.id || `${item.ticker}-${item.title}`,
    impactScore: item.score,
    keyEvidence:
      feedType === "market"
        ? [...item.keyEvidence, ...item.watchNext]
        : item.keyEvidence,
    marketScopeLabel: formatMarketScope(item.marketScope),
    primaryTicker: item.ticker,
    publishedAt: item.detectedAtRaw,
    relatedTickers: item.relatedTickers,
    sentiment: formatSentiment(item.signal),
    source: item.source,
    sourceUrl: item.sourceUrl,
    summary: item.quickTake || item.summary,
    themeLabel: formatMarketThemeLabel(
      item.subTheme ||
        item.themeGroup ||
        item.industryGroup ||
        item.sector ||
        item.displayTicker,
    ),
    ticker: item.displayTicker,
  };
}

function formatMarketThemeLabel(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bUs\b/g, "US");
}

function mapRankedEvent(
  item: RankedEvent,
  destination: LiveFeedV2RailDestination,
): LiveFeedV2RailEvent {
  return {
    ...createLiveFeedV2RailEventIdentity({
      destination,
      eventId: item.id,
      fallbackId: `${item.ticker}-${item.title}`,
    }),
    headline: item.title,
    impactScore: item.score,
    label: item.ticker,
    sentiment: formatSentiment(item.signal),
    timeLabel: "Recent",
  };
}

function mapMarketMovingEvent(
  item: MarketMovingNewsItem,
): LiveFeedV2RailEvent {
  return {
    ...createLiveFeedV2RailEventIdentity({
      destination: "events",
      eventId: item.id,
      fallbackId: `market-moving-${item.label}-${item.title}`,
    }),
    headline: item.title,
    impactScore: item.score,
    label: item.label,
    sentiment: formatSentiment(item.signal),
    timeLabel: item.detectedAt
      ? formatLiveFeedV2Timestamp(item.detectedAt).timeLabel
      : "Latest",
  };
}

function resolveFeedType(item: LiveFeedItem): LiveFeedV2Kind {
  if (item.sourceGroup === "filings") return "filings";
  return item.marketScope === "company" ? "news" : "market";
}

function formatSentiment(
  signal: LiveFeedItem["signal"] | RankedEvent["signal"],
): LiveFeedV2Sentiment {
  if (signal === "bullish") return "Bullish";
  if (signal === "bearish") return "Bearish";
  if (signal === "volatile") return "Volatile";
  return "Neutral";
}

function normalizeCategory(value: string, feedType: LiveFeedV2Kind) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (feedType === "market") return "MARKET";
  if (normalized.includes("earn")) return "EARN";
  if (normalized.includes("fda") || normalized.includes("clinical")) return "FDA";
  if (normalized.includes("dilution") || normalized.includes("offering")) {
    return "DILUTION";
  }
  if (normalized.includes("listing") || normalized.includes("ipo")) {
    return "LISTING";
  }
  if (normalized.includes("insider") || normalized.includes("ownership")) {
    return "INSIDER";
  }
  if (normalized.includes("dividend") || normalized.includes("capital return")) {
    return "DIVIDEND";
  }
  if (normalized.includes("legal") || normalized.includes("regulation")) {
    return "LEGAL";
  }
  return feedType === "filings" ? "FILING" : "NEWS";
}

function formatMarketScope(value: LiveFeedItem["marketScope"]) {
  if (value === "macro") return "Macro";
  if (value === "sector") return "Sector";
  if (value === "theme") return "Theme";
  return "Company";
}

function emptyMessageForFilter(filter: LiveFeedV2Filter) {
  if (filter === "alerts") {
    return "No alert-level events are available for this feed window.";
  }
  if (filter === "market") {
    return "No sector, theme, or macro events are available right now.";
  }
  return `No ${filter === "all" ? "" : `${filter} `}events are available right now.`;
}
