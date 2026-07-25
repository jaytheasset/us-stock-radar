import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PriceChartCard } from "../../../events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "../../../events/[id]/SectorThemeContextPanel";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { parseGlobeNewswireArticleHtml } from "@/lib/sources/globe/parser";
import { fetchEventById, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import type { DetailTone, SectorThemeContext } from "../../../events/[id]/detailTypes";

type NewsArchiveDetailPageProps = {
  params: Promise<{ id: string }>;
};

type ArchiveEvent = {
  ticker: string;
  exchange: string;
  company: string;
  source: string;
  sourceGroup: string;
  sourceReleaseType: string;
  sourceType: string;
  publishedAt: string;
  title: string;
  price: string;
  changeAmount: string;
  change: string;
  impact: number;
  signal: DetailTone;
  eventType: string;
  sourceUrl: string;
  archiveNote: string;
  originalHtml: string;
  marketContext?: SectorThemeContext;
};

type ArchiveRelatedStory = {
  age: string;
  source: string;
  title: string;
};

type ArchiveRecentFiling = {
  eventType: string;
  filedAt: string;
  form: string;
  score: number;
  title: string;
};

type DbArchivePayload = {
  event: ArchiveEvent;
  recentFilings: ArchiveRecentFiling[];
  relatedNews: ArchiveRelatedStory[];
};

export default async function NewsArchiveDetailPage({ params }: NewsArchiveDetailPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const dbPayload = await loadDbArchivePayload(id);
  if (!dbPayload) notFound();

  const archiveEvent = dbPayload.event;
  const recentFilingItems = dbPayload.recentFilings;
  const relatedNewsItems = dbPayload.relatedNews;

  return (
    <main className="feed-page stock-detail-page archive-detail-page">
      <header className="feed-nav">
        <Link className="brand-lockup" href="/" aria-label="US Stock Radar home">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {[
            { label: "Live Feed", href: "/feed" },
            { label: "Watchlist", href: "/watchlist" },
            { label: "News", href: "/news" },
            { label: "Filings", href: "/filings" },
            { label: "Alerts", href: "#" },
            { label: "Premium", href: "#" },
          ].map((item) => (
            <Link className={item.label === "News" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
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

      <div className="stock-detail-shell">
        <article className="stock-detail-main">
          <div className="stock-detail-kicker-row">
            <div className="stock-detail-breadcrumb">
              <Link href="/news">News</Link>
              <span>/</span>
              <span>Archive</span>
            </div>
            <div className="stock-detail-source-line">
              <span>{archiveEvent.source}</span>
              <span>{archiveEvent.publishedAt}</span>
            </div>
          </div>

          <section className="stock-detail-hero archive-detail-hero">
            <div className="stock-detail-title-block">
              <h1>{archiveEvent.title}</h1>
              <div className="stock-detail-meta">
                <span className="ticker-chip">
                  {archiveEvent.exchange}:{archiveEvent.ticker}
                </span>
                <span>{archiveEvent.company}</span>
                <span className="delivery-badge archive">Archive</span>
                <span className={`source-badge impact-badge ${archiveEvent.signal}`}>
                  Impact {archiveEvent.impact}
                </span>
              </div>
            </div>
          </section>

          <section className="stock-detail-top-grid">
            <PriceChartCard
              change={archiveEvent.change}
              changeAmount={archiveEvent.changeAmount}
              price={archiveEvent.price}
              series={null}
              ticker={archiveEvent.ticker}
              tone={archiveEvent.signal}
            />

            <section className="stock-detail-card archive-notice-panel">
              <div>
                <h2>Brief Summary</h2>
                <p>{archiveEvent.archiveNote}</p>
              </div>
            </section>
          </section>

          {archiveEvent.marketContext ? (
            <SectorThemeContextPanel context={archiveEvent.marketContext} ticker={archiveEvent.ticker} />
          ) : null}

          <section className="stock-detail-card full-text-card archive-original-section">
            <div className="card-heading-row">
              <div>
                <h2>Original Release Text</h2>
                <p>Full source text preserved for reader review.</p>
              </div>
            </div>
            {archiveEvent.originalHtml ? (
              <div
                className="full-text-content"
                dangerouslySetInnerHTML={{ __html: archiveEvent.originalHtml }}
              />
            ) : (
              <div className="full-text-content">
                <p>
                  The original article text is currently unavailable. Use the
                  source link to view the publisher&apos;s copy.
                </p>
              </div>
            )}
          </section>
        </article>

        <aside className="stock-detail-rail">
          <section className="stock-detail-card recent-filings-card">
            <div className="card-heading-row">
              <div>
                <h2>Recent Filings</h2>
                <p>{archiveEvent.ticker} filings context</p>
              </div>
              <Link href="/filings">View all</Link>
            </div>
            <div className="recent-filings-list">
              {recentFilingItems.map((filing) => (
                <Link href="/filings" key={`${filing.form}-${filing.title}`}>
                  <span className="filing-form-chip">{filing.form}</span>
                  <div>
                    <strong>{filing.title}</strong>
                    <span>
                      {filing.eventType} - {filing.filedAt}
                    </span>
                  </div>
                  <b>{filing.score}</b>
                </Link>
              ))}
            </div>
          </section>

          <section className="stock-detail-card detail-score-card">
            <h2>Event Snapshot</h2>
            <div className={`detail-score-main ${archiveEvent.signal}`}>
              <strong>{archiveEvent.impact}</strong>
              <span>Impact</span>
            </div>
            <MetricRow label="Source Group" value={archiveEvent.sourceGroup} />
            <MetricRow label="Event Type" value={archiveEvent.eventType} />
            <MetricRow label="Signal" value={archiveEvent.signal} />
          </section>

          <section className="stock-detail-card related-news-card">
            <div className="card-heading-row">
              <h2>Related News</h2>
              <Link href="/news">View all</Link>
            </div>
            <div className="related-news-list">
              {relatedNewsItems.map((story) => (
                <Link href="/news" key={story.title}>
                  <strong>{story.title}</strong>
                  <span>
                    {story.source} - {story.age}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="stock-detail-card alert-card">
            <span>Premium</span>
            <h2>Real-time alerts for this event type</h2>
            <p>Track higher-impact news while archived items remain available in ticker history.</p>
            <button type="button">Upgrade to Premium</button>
          </section>

          <section className="stock-detail-card source-confidence-card">
            <h2>Source & Evidence</h2>
            <div className="source-confidence-top">
              <strong>{archiveEvent.source}</strong>
              <span>{archiveEvent.sourceReleaseType}</span>
            </div>
            <MetricRow label="Source Type" value={archiveEvent.sourceType} />
            <MetricRow label="Issuer" value={archiveEvent.company} />
            <MetricRow label="Published" value={archiveEvent.publishedAt} />
            <MetricRow label="Verification" value="Original source linked" />
            <a className="source-original-link" href={archiveEvent.sourceUrl}>
              <span>View Original Source</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </section>
        </aside>
      </div>
    </main>
  );
}

async function loadDbArchivePayload(id: string): Promise<DbArchivePayload | null> {
  const [liveResult, eventResult] = await Promise.all([getLiveEventDetail(id), fetchEventById(id)]);
  const liveItem = liveResult.item;
  const eventRow = toRecord(eventResult.data);

  if (!liveItem || !eventRow) {
    return null;
  }

  const rawItem = await fetchRawItem(readString(eventRow, "raw_item_id"));
  const ticker = liveItem.ticker.trim().toUpperCase();
  const [recentFilingsResult, relatedNewsResult] = await Promise.all([
    isRealTicker(ticker)
      ? fetchEventsByTicker({ ticker, sourceGroup: "filings", excludeId: liveItem.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
    isRealTicker(ticker)
      ? fetchEventsByTicker({ ticker, sourceGroup: "news", excludeId: liveItem.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
  ]);

  return {
    event: await mapDbArchiveEvent(liveItem, eventRow, rawItem),
    recentFilings: mapRecentFilingRows(toRows(recentFilingsResult.data)),
    relatedNews: mapRelatedNewsRows(toRows(relatedNewsResult.data)),
  };
}

async function fetchRawItem(rawItemId: string) {
  if (!isUuid(rawItemId)) {
    return null;
  }

  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${rawItemId}`,
    limit: "1",
  });

  return toRows(result.data)[0] || null;
}

async function mapDbArchiveEvent(
  item: LiveFeedItem,
  eventRow: Record<string, unknown>,
  rawItem: Record<string, unknown> | null,
): Promise<ArchiveEvent> {
  const metadata = toRecord(eventRow.metadata);
  const rawPayload = toRecord(rawItem?.raw_payload);
  const ticker = item.ticker.trim().toUpperCase();
  const eventType = getEventTypeBadge(item.eventType).label;
  const sourceUrl =
    item.sourceUrl ||
    readString(rawItem, "source_url") ||
    readString(metadata, "source_url") ||
    readString(metadata, "url") ||
    "#";
  const sourceType =
    readString(metadata, "source_type") ||
    readString(rawPayload, "source_type") ||
    (item.sourceGroup === "filings" ? "SEC Filing" : "Company Press Release");
  const sourceReleaseType =
    readString(metadata, "source_release_type") ||
    readString(rawPayload, "source_release_type") ||
    (item.sourceGroup === "filings" ? "Official Filing" : "Official Release");
  const company =
    readString(metadata, "issuer") ||
    readString(metadata, "company") ||
    readString(metadata, "company_name") ||
    readString(rawPayload, "issuer") ||
    (ticker && ticker !== "N/A" ? ticker : "Company");
  const exchange = readString(eventRow, "market") || readString(metadata, "exchange") || "US";
  const briefSeed = item.quickTake || item.summary || item.title;
  const originalHtml =
    readString(rawPayload, "full_text_html") ||
    bodyTextToHtml(readString(rawItem, "body_text")) ||
    (await fetchRemoteOriginalHtml(sourceUrl));

  return {
    ticker,
    exchange,
    company,
    source: item.source,
    sourceGroup: formatSourceGroup(item.sourceGroup),
    sourceReleaseType,
    sourceType,
    publishedAt: formatDetailDateTime(item.detectedAtRaw, `${item.time} ET`),
    title: item.title,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    impact: item.score,
    signal: item.signal,
    eventType,
    sourceUrl,
    archiveNote: makeArchiveNote(briefSeed),
    originalHtml,
    marketContext: buildDbMarketContext(item, eventRow),
  };
}

function buildDbMarketContext(item: LiveFeedItem, eventRow: Record<string, unknown>): SectorThemeContext | undefined {
  const metadata = toRecord(eventRow.metadata);
  const sector = readString(metadata, "sector") || readString(metadata, "sector_name");
  const industry =
    readString(metadata, "industry_group") ||
    readString(metadata, "industry") ||
    readString(metadata, "sub_category") ||
    readString(metadata, "subCategory");

  if (!sector && !industry) {
    return undefined;
  }

  const themeGroup = readString(metadata, "theme_group") || readString(metadata, "themeGroup");
  const subTheme = readString(metadata, "sub_theme") || readString(metadata, "subTheme");
  const baseMover = {
    change: item.change,
    symbol: item.ticker,
    trend: item.trend,
  };
  const topMovers = [
    baseMover,
    { change: "+0.42%", symbol: "SPY", trend: [41, 42, 43, 42, 44, 45, 46, 47, 48, 49] },
    { change: "+0.68%", symbol: "QQQ", trend: [38, 40, 41, 43, 42, 45, 47, 46, 49, 51] },
  ];

  return {
    sector: sector || "Market",
    industry: industry || sector || "Market",
    themeGroup: themeGroup || undefined,
    subTheme: subTheme || undefined,
    periods: {
      "1D": {
        sectorChange: "",
        industryChange: "",
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
      "5D": {
        sectorChange: "",
        industryChange: "",
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
      "30D": {
        sectorChange: "",
        industryChange: "",
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
    },
  };
}

function mapRecentFilingRows(rows: Record<string, unknown>[]): ArchiveRecentFiling[] {
  return rows.slice(0, 4).map((row) => {
    const badge = getEventTypeBadge(readString(row, "event_type") || "other");

    return {
      eventType: badge.label,
      filedAt: formatShortDate(readString(row, "detected_at")),
      form: readMetadataString(row, "form_type") || readMetadataString(row, "formType") || "SEC",
      score: readNumber(row, "score"),
      title: readString(row, "title") || "Recent filing",
    };
  });
}

function mapRelatedNewsRows(rows: Record<string, unknown>[]): ArchiveRelatedStory[] {
  return rows.slice(0, 4).map((row) => ({
    age: formatShortDate(readString(row, "detected_at")),
    source: formatSourceLabel(readString(row, "source_code")),
    title: readString(row, "title") || "Related news",
  }));
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function makeArchiveNote(value: string) {
  const summary = firstSentence(value) || "This item was archived as a lower-impact market update.";
  return `${summary} Limited market impact detected. The original source is included below for reference.`;
}

function firstSentence(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const match = cleaned.match(/^(.{1,220}?[.!?])(\s|$)/);
  return (match?.[1] || cleaned.slice(0, 220)).trim();
}

function bodyTextToHtml(value: string) {
  if (!value) return "";
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

async function fetchRemoteOriginalHtml(sourceUrl: string) {
  if (!isGlobeNewswireUrl(sourceUrl)) {
    return "";
  }

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "US-Stock-Radar/0.1 archive detail",
      },
    });

    if (!response.ok) return "";

    const html = await response.text();
    return parseGlobeNewswireArticleHtml(html, sourceUrl).bodyHtml || "";
  } catch {
    return "";
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return "";
  const value = row[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return 0;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function readMetadataString(row: Record<string, unknown>, key: string) {
  return readString(toRecord(row.metadata), key);
}

function formatShortDate(value: string) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function formatDetailDateTime(value: string, fallback = "Recent") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date)} - ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(date)} ET`;
}

function formatSourceGroup(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "News";
}

function formatSourceLabel(value: string) {
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    accesswire: "Accesswire",
    businesswire: "Business Wire",
    globe: "GlobeNewswire",
    globenewswire: "GlobeNewswire",
    newsfile: "Newsfile",
    prnewswire: "PR Newswire",
    sec_edgar: "SEC",
  };

  return labels[normalized] || value || "Stock Radar";
}

function isRealTicker(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isGlobeNewswireUrl(value: string) {
  return /(^|\/\/)(www\.)?globenewswire\.com\//i.test(value);
}
