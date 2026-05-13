import {
  alertFilingRankings,
  highImpactNewsRankings,
  type RankedEvent,
} from "@/lib/radarRankings";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import type { MarketBar } from "@/lib/integrations";

type FeedTone = "bullish" | "bearish" | "volatile" | "neutral";
type SourceGroup = "news" | "filings" | "market";

export type FeedItem = {
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
  quickTake?: string;
  summary: string;
  scoreReason: string;
  score: number;
  deliveryLevel: "archive" | "feed" | "alert";
  impact: "high" | "medium" | "low";
  signal: FeedTone;
  trend: number[];
  chartBars?: MarketBar[];
  chartProvider?: "polygon" | "fmp" | "none";
  related?: string;
  interactions?: {
    comments: number;
    repeats: number;
    saves: number;
  };
};

type FeedShellProps = {
  feedItems?: FeedItem[];
  highImpactNews?: RankedEvent[];
  alertFilings?: RankedEvent[];
  activeNavLabel?: string;
  activeTab?: string;
  pageVariant?: "default" | "news";
  sidebarMode?: "default" | "premiumOnly";
  sidebarSlot?: React.ReactNode;
  premiumPlacement?: "top" | "bottom" | "hidden";
  paginationBasePath?: string;
  searchFilterSlot?: React.ReactNode;
  showCharts?: boolean;
  showHeadingControls?: boolean;
  showSituationStrip?: boolean;
  showTabs?: boolean;
  showPageSizeControl?: boolean;
  pageInfo?: {
    page: number;
    limit: number;
    hasNext: boolean;
    total: number | null;
    itemCount: number;
  };
  dbError?: string;
};

const fallbackFeedItems: FeedItem[] = [
  {
    id: "nvda-data-center-platform",
    time: "11:05 AM",
    ticker: "NVDA",
    price: "$125.47",
    changeAmount: "$2.29",
    change: "+1.86%",
    updatedAt: "11:05 AM EDT",
    sourceGroup: "news",
    source: "Business Wire",
    eventType: "product_launch",
    title: "Nvidia Announces Expanded Data Center Platform Availability",
    summary: "New platform availability broadens enterprise AI deployment options across major cloud partners.",
    scoreReason: "Expanded platform availability could broaden enterprise AI deployment across major cloud partners.",
    score: 78,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
    trend: [22, 25, 24, 28, 31, 30, 35, 37, 36, 42, 44, 48],
  },
  {
    id: "tsla-form-8-k",
    time: "10:42 AM",
    ticker: "TSLA",
    price: "$176.35",
    changeAmount: "$2.02",
    change: "-1.13%",
    updatedAt: "10:42 AM EDT",
    sourceGroup: "filings",
    source: "SEC",
    eventType: "current_report",
    title: "Tesla, Inc. Files Form 8-K",
    summary: "Company filed an 8-K with operational updates and recent corporate disclosures.",
    scoreReason: "The 8-K is relevant, but this shell does not show a confirmed financing, dilution, or transaction trigger.",
    score: 61,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "neutral",
    trend: [44, 39, 41, 37, 35, 38, 34, 31, 29, 30, 27, 25],
  },
  {
    id: "lac-thacker-pass-update",
    time: "10:21 AM",
    ticker: "LAC",
    price: "$3.82",
    changeAmount: "$0.23",
    change: "+6.28%",
    updatedAt: "10:21 AM EDT",
    sourceGroup: "news",
    source: "Accesswire",
    eventType: "project_update",
    title: "Lithium Americas Provides Update on Thacker Pass Construction",
    summary: "Phase 1 construction remains on track with first production targeted for 2028.",
    scoreReason: "Construction progress is useful, but the update is not yet a near-term revenue or balance sheet trigger.",
    score: 74,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bullish",
    trend: [18, 20, 22, 24, 23, 27, 31, 35, 34, 39, 42, 45],
  },
  {
    id: "mstr-form-10-q",
    time: "9:58 AM",
    ticker: "MSTR",
    price: "$362.18",
    changeAmount: "$11.52",
    change: "-3.08%",
    updatedAt: "9:58 AM EDT",
    sourceGroup: "filings",
    source: "SEC",
    eventType: "quarterly_report",
    title: "MicroStrategy Incorporated Files Form 10-Q",
    summary: "Quarterly report filed for the period ended March 31, 2026.",
    scoreReason: "This remains a routine periodic filing unless parser or AI extraction finds a material change.",
    score: 58,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "neutral",
    trend: [50, 48, 45, 46, 42, 39, 41, 38, 35, 32, 30, 28],
  },
  {
    id: "gld-safe-haven-demand",
    time: "9:41 AM",
    ticker: "GLD",
    price: "$232.41",
    changeAmount: "$1.66",
    change: "+0.72%",
    updatedAt: "9:41 AM EDT",
    sourceGroup: "market",
    source: "FMP",
    eventType: "price_momentum",
    title: "Gold Strength Continues as Safe-Haven Demand Builds",
    summary: "Market snapshot shows sustained strength with volume running above recent average.",
    scoreReason: "Safe-haven strength adds market context but is not tied to a single corporate action.",
    score: 52,
    deliveryLevel: "feed",
    impact: "low",
    signal: "bullish",
    trend: [26, 28, 27, 31, 33, 35, 34, 36, 39, 41, 40, 43],
  },
  {
    id: "pltr-commercial-ai-agreement",
    time: "9:22 AM",
    ticker: "PLTR",
    price: "$21.84",
    changeAmount: "$0.57",
    change: "+2.67%",
    updatedAt: "9:22 AM EDT",
    sourceGroup: "news",
    source: "PR Newswire",
    eventType: "contract_award",
    title: "Palantir Secures Expanded Commercial AI Agreement",
    summary: "Expanded agreement adds multi-year platform access for a large enterprise client.",
    scoreReason: "The contract expansion is company-specific, growth-linked, and likely material to investor attention.",
    score: 82,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
    trend: [24, 23, 27, 29, 31, 30, 34, 37, 36, 39, 43, 46],
    interactions: { comments: 8, repeats: 4, saves: 21 },
  },
  {
    id: "amc-atm-prospectus",
    time: "8:16 AM",
    ticker: "AMC",
    price: "$2.73",
    changeAmount: "$0.12",
    change: "-4.21%",
    updatedAt: "8:16 AM EDT",
    sourceGroup: "filings",
    source: "SEC",
    eventType: "prospectus_supplement",
    title: "AMC Entertainment Files Prospectus Supplement for ATM Program",
    summary: "Supplement updates terms and sales agreement for at-the-market offering activity.",
    scoreReason: "ATM program updates can create dilution risk and directly affect trading sentiment.",
    score: 79,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bearish",
    trend: [43, 40, 36, 38, 34, 31, 29, 30, 26, 24, 21, 18],
  },
];

const marketMovingNews = [
  {
    label: "Macro",
    title: "Treasury yields hold near session highs before Fed speakers",
    score: 84,
    signal: "volatile" as const,
  },
  {
    label: "Policy",
    title: "New export-control headlines pressure semiconductor watchlist",
    score: 81,
    signal: "bearish" as const,
  },
  {
    label: "Energy",
    title: "Crude oil rebounds after inventory drawdown surprise",
    score: 76,
    signal: "bullish" as const,
  },
];

const marketPulse = [
  { label: "SPY", value: "+0.42%", detail: "Large caps", tone: "bullish" as const },
  { label: "QQQ", value: "+0.68%", detail: "Growth", tone: "bullish" as const },
  { label: "IWM", value: "-0.11%", detail: "Small caps", tone: "bearish" as const },
  { label: "VIX", value: "18.4", detail: "Volatility", tone: "neutral" as const },
  { label: "10Y", value: "4.31%", detail: "Treasury", tone: "volatile" as const },
  { label: "DXY", value: "104.2", detail: "Dollar", tone: "neutral" as const },
];

const tabs = ["All", "News", "Filings", "Market", "Alerts", "Watchlist"];

const situationCards = [
  {
    label: "Today's Alerts",
    value: "42",
    window: "Last 24H",
  },
  {
    label: "Dilution Risk",
    value: "14",
    window: "Last 7D",
  },
  {
    label: "Delisting Watch",
    value: "6",
    window: "Last 30D",
  },
  {
    label: "Earnings",
    value: "31",
    window: "Last 7D",
  },
  {
    label: "Insider Buys",
    value: "18",
    window: "Last 14D",
  },
  {
    label: "Dividends",
    value: "24",
    window: "Last 30D",
  },
  {
    label: "FDA Catalysts",
    value: "9",
    window: "Last 30D",
  },
];

export function FeedShell({
  feedItems = fallbackFeedItems,
  highImpactNews = highImpactNewsRankings,
  alertFilings = alertFilingRankings,
  activeNavLabel = "Live Feed",
  activeTab = "All",
  pageVariant = "default",
  sidebarMode = "default",
  sidebarSlot,
  premiumPlacement = "top",
  paginationBasePath = "/feed",
  searchFilterSlot,
  showCharts = true,
  showHeadingControls = true,
  showSituationStrip = true,
  showTabs = true,
  showPageSizeControl = true,
  pageInfo,
  dbError,
}: FeedShellProps) {
  return (
    <main className={`feed-page${pageVariant === "news" ? " news-feed-page" : ""}`}>
      <header className="feed-nav">
        <a className="brand-lockup" href="/" aria-label="US Stock Radar home">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </a>
        <nav className="feed-nav-links" aria-label="Primary">
          {[
            { label: "Live Feed", href: "/feed" },
            { label: "Watchlist", href: "#" },
            { label: "News", href: "/news" },
            { label: "Filings", href: "/filings" },
            { label: "Alerts", href: "#" },
            { label: "Premium", href: "#" },
          ].map((item) => (
            <a className={item.label === activeNavLabel ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="feed-search" role="search">
          <span aria-hidden="true">/</span>
          <input aria-label="Search" placeholder="Search tickers, companies, or keywords" />
        </div>
        <div className="feed-actions">
          <button className="icon-button" type="button" aria-label="Notifications">
            <span aria-hidden="true">!</span>
            <span className="notification-dot">3</span>
          </button>
          <button className="avatar-button" type="button" aria-label="User menu">
            N
          </button>
        </div>
      </header>

      <div className="feed-layout">
        <section className="feed-main" aria-label="Market feed">
          <div className="feed-heading">
            <div>
              <h1>Today</h1>
              <span>May 13, 2026</span>
            </div>
            {showHeadingControls ? (
              <div className="feed-controls">
                <button type="button">Filters</button>
                <button type="button">Sort: Newest</button>
                <button className="view-toggle" type="button" aria-label="List view">
                  <span />
                  <span />
                  <span />
                </button>
              </div>
            ) : null}
          </div>

          {showSituationStrip ? (
            <section className="situation-strip" aria-label="Market situation board">
              {situationCards.map((card) => (
                <article className="situation-card" key={card.label}>
                  <div>
                    <h2>{card.label}</h2>
                    <strong>{card.value}</strong>
                    <span className="situation-window">{card.window}</span>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {searchFilterSlot}

          {showTabs ? (
            <div className="feed-tabs" aria-label="Feed filters">
              {tabs.map((tab) => (
                <button className={tab === activeTab ? "active" : ""} type="button" key={tab}>
                  {tab}
                </button>
              ))}
            </div>
          ) : null}

          {dbError ? <p className="feed-db-error">DB feed fallback: {dbError}</p> : null}

          <div className="feed-list">
            {feedItems.length ? (
              feedItems.map((item) => (
                <FeedRow item={item} key={`${item.id}-${item.time}-${item.ticker}-${item.eventType}`} showChart={showCharts} />
              ))
            ) : (
              <div className="feed-empty-state">No events found.</div>
            )}
          </div>

          {pageInfo ? (
            <FeedPagination basePath={paginationBasePath} pageInfo={pageInfo} showPageSizeControl={showPageSizeControl} />
          ) : null}
        </section>

        <aside className="feed-sidebar" aria-label="Market context">
          {sidebarSlot ? (
            <>
              {premiumPlacement === "top" ? <PremiumCard /> : null}
              {sidebarSlot}
              {premiumPlacement === "bottom" ? <PremiumCard /> : null}
            </>
          ) : sidebarMode === "default" ? (
            <>
              <SidebarPanel title="Market Pulse">
                <MarketPulseGrid items={marketPulse} />
              </SidebarPanel>

              <SidebarPanel title="Market-Moving News">
                <MarketMovingList items={marketMovingNews} />
              </SidebarPanel>
            </>
          ) : null}

          {sidebarSlot ? null : <PremiumCard />}

          {sidebarMode === "default" ? (
            <>
              <SidebarPanel title="High-Impact News" tone="news">
                <SidebarEventList items={highImpactNews} seeMoreHref="/news" />
              </SidebarPanel>

              <SidebarPanel title="Alert Filings" tone="filings">
                <SidebarEventList items={alertFilings} seeMoreHref="/filings" />
              </SidebarPanel>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function FeedPagination({
  basePath,
  pageInfo,
  showPageSizeControl,
}: {
  basePath: string;
  pageInfo: {
    page: number;
    limit: number;
    hasNext: boolean;
    total: number | null;
    itemCount: number;
  };
  showPageSizeControl: boolean;
}) {
  const previousPage = Math.max(1, pageInfo.page - 1);
  const nextPage = pageInfo.page + 1;
  const totalPages =
    typeof pageInfo.total === "number" ? Math.max(1, Math.ceil(pageInfo.total / pageInfo.limit)) : null;
  const startItem = pageInfo.itemCount ? (pageInfo.page - 1) * pageInfo.limit + 1 : 0;
  const endItem = pageInfo.itemCount
    ? Math.min((pageInfo.page - 1) * pageInfo.limit + pageInfo.itemCount, pageInfo.total ?? pageInfo.page * pageInfo.limit)
    : 0;
  const pageItems = buildPaginationItems(pageInfo.page, totalPages);

  return (
    <nav className="feed-pagination" aria-label="Feed pagination">
      <p className="feed-pagination-status">
        {pageInfo.total === null
          ? `Showing ${startItem}-${endItem} items`
          : `Showing ${startItem}-${endItem} of ${pageInfo.total} items`}
      </p>

      <div className="feed-pagination-controls">
        {pageInfo.page > 1 ? (
          <a href={feedPageHref(previousPage, pageInfo.limit, basePath)} className="pagination-step">
            <span aria-hidden="true">&lt;</span>
            Previous
          </a>
        ) : (
          <span className="pagination-step disabled" aria-disabled="true">
            <span aria-hidden="true">&lt;</span>
            Previous
          </span>
        )}

        <div className="pagination-pages" aria-label="Feed pages">
          {pageItems.map((item, index) =>
            item === "ellipsis" ? (
              <span className="pagination-ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>
                ...
              </span>
            ) : item === pageInfo.page ? (
              <strong aria-current="page" key={item}>
                {item}
              </strong>
            ) : (
              <a href={feedPageHref(item, pageInfo.limit, basePath)} key={item}>
                {item}
              </a>
            ),
          )}
        </div>

        {pageInfo.hasNext ? (
          <a href={feedPageHref(nextPage, pageInfo.limit, basePath)} className="pagination-step">
            Next
            <span aria-hidden="true">&gt;</span>
          </a>
        ) : (
          <span className="pagination-step disabled" aria-disabled="true">
            Next
            <span aria-hidden="true">&gt;</span>
          </span>
        )}
      </div>

      {showPageSizeControl ? (
        <details className="feed-page-size">
          <summary>{pageInfo.limit} per page</summary>
          <div>
            {[10, 20, 50, 100].map((limit) => (
              <a className={limit === pageInfo.limit ? "active" : ""} href={feedPageHref(1, limit, basePath)} key={limit}>
                {limit} per page
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}

function buildPaginationItems(currentPage: number, totalPages: number | null): Array<number | "ellipsis"> {
  if (!totalPages) return [currentPage];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function feedPageHref(page: number, limit: number, basePath = "/feed") {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (limit !== 20) params.set("limit", String(limit));

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function FeedRow({ item, showChart }: { item: FeedItem; showChart: boolean }) {
  const eventBadge = getEventTypeBadge(item.eventType);

  return (
    <a className={`feed-row${showChart ? "" : " no-chart"}`} href={`/events/${item.id}`}>
      <FeedTime value={item.time} />
      {showChart ? (
        <div className="sparkline-cell">
          <CandleVolumeChart
            bars={item.chartBars}
            fallbackValues={item.trend}
            tone={item.signal === "bearish" ? "bearish" : "bullish"}
          />
        </div>
      ) : null}
      <div className="ticker-cell">
        <strong>{item.ticker}</strong>
        <span>{item.price}</span>
        <span className={item.change.startsWith("-") ? "bearish" : "bullish"}>{item.change}</span>
      </div>
      <div className="event-cell">
        <div className="event-title-line">
          <span className={`event-type-badge ${eventBadge.tone}`}>{eventBadge.label}</span>
          <strong>{item.title}</strong>
        </div>
        <p>{item.quickTake || item.summary}</p>
      </div>
      <div className="signal-cell">
        <span className={`signal-badge ${item.signal}`}>{item.signal}</span>
        <span className={`delivery-badge ${item.deliveryLevel}`}>{item.deliveryLevel}</span>
      </div>
    </a>
  );
}

function FeedTime({ value }: { value: string }) {
  const [time, meridiem] = value.split(" ");

  return (
    <time className="feed-time" dateTime={value}>
      <span>{time || value}</span>
      {meridiem ? <small>{meridiem}</small> : null}
    </time>
  );
}

function SidebarQuote({
  price,
  changeAmount,
  change,
  updatedAt,
}: {
  price: string;
  changeAmount: string;
  change: string;
  updatedAt: string;
}) {
  const tone = change.startsWith("-") ? "bearish" : "bullish";
  const direction = tone === "bearish" ? "down" : "up";
  const percent = change.replace(/^[+-]/, "");
  const displayUpdatedAt = updatedAt.replace(/\s+EDT$/, "");

  return (
    <div className={`sidebar-quote ${tone}`}>
      <strong>{price}</strong>
      <span>
        <span aria-hidden="true">{direction === "down" ? "↓" : "↑"}</span> {changeAmount} ({percent})
      </span>
      <small>Updated {displayUpdatedAt}</small>
    </div>
  );
}

function SidebarPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "news" | "filings";
  children: React.ReactNode;
}) {
  return (
    <section className="sidebar-panel">
      <div className={`sidebar-panel-header${tone ? ` ${tone}` : ""}`}>
        {tone ? <span className="sidebar-panel-icon" aria-hidden="true" /> : null}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function PremiumCard() {
  return (
    <section className="premium-card">
      <div>
        <span className="premium-kicker">Go Premium</span>
        <h2>Unlock real-time alerts and advanced filters.</h2>
        <button type="button">Upgrade Now</button>
      </div>
      <div className="premium-art" aria-hidden="true">
        PRO
      </div>
    </section>
  );
}

function SidebarEventList({
  items,
  seeMoreHref,
}: {
  items: RankedEvent[];
  seeMoreHref?: string;
}) {
  return (
    <div className="sidebar-event-list">
      {items.length ? (
        items.map((item) => (
          <article className="sidebar-event-row" key={`${item.ticker}-${item.title}`}>
            <SidebarQuote
              price={item.price}
              changeAmount={item.changeAmount}
              change={item.change}
              updatedAt={item.updatedAt}
            />
            <div className="sidebar-event-copy">
              <strong>{item.ticker}</strong>
              <p>{item.title}</p>
              <span>
                {item.source} - {item.time}
              </span>
            </div>
            <div className={`sidebar-score-mini ${item.sourceGroup}`}>
              <span>Score</span>
              <strong>{item.score}</strong>
            </div>
          </article>
        ))
      ) : (
        <div className="sidebar-empty-state">No matching events yet.</div>
      )}
      {seeMoreHref ? (
        <a className="sidebar-see-more" href={seeMoreHref}>
          See more <span aria-hidden="true">›</span>
        </a>
      ) : null}
    </div>
  );
}

function MarketMovingList({
  items,
}: {
  items: Array<{
    label: string;
    title: string;
    score: number;
    signal: FeedTone;
  }>;
}) {
  return (
    <div className="market-moving-list">
      {items.map((item) => (
        <article className="market-moving-row" key={item.title}>
          <span className={`market-label ${item.signal}`}>{item.label}</span>
          <div>
            <p>{item.title}</p>
            <small>
              Score {item.score} - {item.signal}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}

function MarketPulseGrid({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    detail: string;
    tone: FeedTone;
  }>;
}) {
  return (
    <div className="market-pulse-grid">
      {items.map((item) => (
        <article className="market-pulse-card" key={item.label}>
          <span>{item.label}</span>
          <strong className={item.tone}>{item.value}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

function CandleVolumeChart({
  bars,
  fallbackValues,
  tone,
}: {
  bars?: MarketBar[];
  fallbackValues: number[];
  tone: "bullish" | "bearish";
}) {
  const width = 128;
  const height = 88;
  const priceTop = 0;
  const priceHeight = 66;
  const volumeTop = 68;
  const volumeBottomPadding = 2;
  const visibleBars = (bars && bars.length ? bars.slice(-22) : buildFallbackBars(fallbackValues, tone)).slice(-22);
  const lows = visibleBars.map((bar) => bar.low);
  const highs = visibleBars.map((bar) => bar.high);
  const volumes = visibleBars.map((bar) => bar.volume);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const maxVolume = Math.max(...volumes, 1);
  const priceSpread = Math.max(maxPrice - minPrice, 0.01);
  const candleGap = width / Math.max(visibleBars.length, 1);
  const candleWidth = Math.max(4, Math.min(7, candleGap * 0.48));

  function yPrice(value: number) {
    return priceTop + ((maxPrice - value) / priceSpread) * priceHeight;
  }

  return (
    <svg className="candle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily candlestick chart with volume">
      {visibleBars.map((bar, index) => {
        const x = index * candleGap + candleGap / 2;
        const openY = yPrice(bar.open);
        const closeY = yPrice(bar.close);
        const highY = yPrice(bar.high);
        const lowY = yPrice(bar.low);
        const bullish = bar.close >= bar.open;
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
        const volumeHeight = Math.max(2, (bar.volume / maxVolume) * 16);

        return (
          <g className={bullish ? "bullish" : "bearish"} key={`${bar.date}-${index}`}>
            <line className="candle-wick" x1={x} x2={x} y1={highY} y2={lowY} />
            <rect
              className="candle-body"
              x={x - candleWidth / 2}
              y={bodyY}
              width={candleWidth}
              height={bodyHeight}
              rx="1"
            />
            <rect
              className="volume-bar"
              x={x - candleWidth / 2}
              y={height - volumeHeight - volumeBottomPadding}
              width={candleWidth}
              height={volumeHeight}
              rx="1"
            />
          </g>
        );
      })}
      <line className="volume-divider" x1="0" x2={width} y1={volumeTop} y2={volumeTop} />
    </svg>
  );
}

function buildFallbackBars(values: number[], tone: "bullish" | "bearish"): MarketBar[] {
  return values.map((value, index) => {
    const drift = tone === "bearish" ? -1 : 1;
    const open = value - drift * 0.8;
    const close = value + drift * 0.8;
    return {
      date: String(index),
      open,
      high: Math.max(open, close) + 1.4,
      low: Math.min(open, close) - 1.4,
      close,
      volume: 1000 + index * 160 + (index % 3) * 240,
    };
  });
}
