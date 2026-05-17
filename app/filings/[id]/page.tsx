import Link from "next/link";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { fetchEventAnalysis, fetchEventById, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import type { DetailTone, PriceChartSeries, PricePoint, PriceRange, SectorThemeContext } from "@/app/events/[id]/detailTypes";

type FilingDetailPageProps = {
  params: Promise<{ id: string }>;
};

type FilingEvent = {
  id: string;
  ticker: string;
  exchange: string;
  company: string;
  title: string;
  formType: string;
  filedAt: string;
  source: string;
  sourceUrl: string;
  eventType: string;
  impact: "low" | "medium" | "high";
  deliveryLevel: "archive" | "feed" | "alert";
  score: number;
  signal: DetailTone;
  price: string;
  changeAmount: string;
  change: string;
  filingBrief: string;
  filingFocus: string;
  whyItMatters: string;
  bullishPoints: string[];
  bearishPoints: string[];
  summary: string;
  keyEvidence: string[];
  watchNext: string[];
  recentFilings: RecentFiling[];
  relatedNews: RelatedStory[];
  context: SectorThemeContext;
  priceSeries: PriceChartSeries;
  originalTextNote: string;
  originalHtml: string;
};

type RecentFiling = {
  form: string;
  eventType: string;
  title: string;
  filedAt: string;
  score: number;
};

type RelatedStory = {
  title: string;
  source: string;
  age: string;
};

const commonFilingEvents: Record<string, FilingEvent> = {
  "tsla-8k-operational-update": {
    id: "tsla-8k-operational-update",
    ticker: "TSLA",
    exchange: "NASDAQ",
    company: "Tesla, Inc.",
    title: "Tesla, Inc. Files Form 8-K With Operational Update",
    formType: "8-K",
    filedAt: "May 16, 2026 - 8:31 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "product_update",
    impact: "medium",
    deliveryLevel: "feed",
    score: 64,
    signal: "neutral",
    price: "$176.35",
    changeAmount: "-$2.02",
    change: "-1.13%",
    filingFocus: "Operational disclosure",
    filingBrief:
      "Tesla filed an 8-K describing operational updates and near-term execution items without a confirmed financing or transaction trigger.",
    whyItMatters:
      "A current report can become material if it changes production timing, delivery expectations, liquidity needs, or management guidance.",
    bullishPoints: [
      "The filing gives investors a fresh company-confirmed update.",
      "No immediate dilution or listing-risk trigger is shown in this common view.",
      "Follow-up exhibits may improve visibility into operational execution.",
    ],
    bearishPoints: [
      "Operational language can still point to delivery or margin pressure.",
      "The filing does not yet provide enough detail to upgrade confidence.",
      "Investors may need the original exhibit to judge timing and materiality.",
    ],
    summary:
      "This common filing page is designed for 8-K/6-K items that need structured review but do not yet require a specialized listing, dilution, earnings, transaction, or dividend template.",
    keyEvidence: [
      "Form 8-K was filed through SEC EDGAR.",
      "The normalized event type is Product Update.",
      "No specialized risk template has been triggered for this mock item.",
    ],
    watchNext: [
      "Any amended 8-K or exhibit with more specific operating metrics.",
      "Management commentary that changes delivery, margin, or cash expectations.",
      "Follow-up news coverage connecting the filing to analyst estimate changes.",
    ],
    recentFilings: [
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "Quarterly report with automotive margin commentary",
        filedAt: "May 9",
        score: 72,
      },
      {
        form: "8-K",
        eventType: "Product Update",
        title: "Current report with operational update",
        filedAt: "May 16",
        score: 64,
      },
      {
        form: "4",
        eventType: "Insider / Ownership",
        title: "Director transaction report filed",
        filedAt: "May 2",
        score: 41,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Annual meeting proxy statement filed",
        filedAt: "Apr 28",
        score: 38,
      },
    ],
    relatedNews: [
      { title: "EV delivery expectations remain active across large-cap autos", source: "Stock Radar", age: "1h ago" },
      { title: "Auto sector watches margin pressure after recent price adjustments", source: "Business Wire", age: "3h ago" },
      { title: "Operational updates keep Tesla in the live filing feed", source: "Stock Radar", age: "4h ago" },
      { title: "EV policy and demand headlines shape autos watchlist", source: "PR Newswire", age: "6h ago" },
    ],
    context: {
      sector: "Consumer Cyclical",
      industry: "Autos & Mobility",
      marketCap: "$565.0B",
      periods: {
        "1D": {
          sectorChange: "+0.63%",
          industryChange: "-0.82%",
          themeScore: 64,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "TSLA", change: "-1.13%", trend: [52, 50, 48, 47, 45, 46, 43, 42, 41, 40] },
            { symbol: "GM", change: "+0.42%", trend: [38, 39, 40, 39, 41, 42, 41, 43, 44, 45] },
            { symbol: "F", change: "-0.31%", trend: [44, 43, 42, 43, 41, 40, 39, 40, 39, 38] },
          ],
        },
        "5D": {
          sectorChange: "+1.42%",
          industryChange: "-1.76%",
          themeScore: 62,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "TSLA", change: "-3.84%", trend: [56, 54, 52, 49, 50, 47, 45, 43, 42, 40] },
            { symbol: "GM", change: "+1.92%", trend: [36, 37, 39, 38, 40, 41, 42, 44, 43, 45] },
            { symbol: "RIVN", change: "+2.74%", trend: [30, 31, 34, 33, 36, 38, 40, 42, 41, 44] },
          ],
        },
        "30D": {
          sectorChange: "+4.90%",
          industryChange: "-5.18%",
          themeScore: 60,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "TSLA", change: "-8.22%", trend: [64, 61, 58, 57, 53, 51, 48, 46, 43, 40] },
            { symbol: "GM", change: "+4.36%", trend: [34, 36, 38, 39, 41, 42, 44, 45, 47, 49] },
            { symbol: "F", change: "+1.18%", trend: [40, 39, 41, 42, 41, 43, 44, 43, 45, 46] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 176.35,
      previousClose: 178.37,
      trend: [58, 56, 54, 55, 53, 51, 49, 50, 48, 47, 45, 44],
      volumeBase: 42_000_000,
    }),
    originalTextNote: "Mock filing text area. Later this will preserve SEC primary document and exhibit text.",
    originalHtml: `
      <h3>Item 7.01 Regulation FD Disclosure</h3>
      <p>Tesla, Inc. furnished an operational update describing selected production, delivery, and commercial execution items. This common filing detail page keeps the source text visible while the specialized templates are reserved for dilution, listing, earnings, strategic transaction, insider ownership, shareholder vote, dividend, and financial risk events.</p>
      <h3>Item 9.01 Financial Statements and Exhibits</h3>
      <p>Exhibit 99.1 is referenced for reader review. The eventual parser should attach exhibit text here when the filing includes substantive investor-facing materials.</p>
    `,
  },
};

export function generateStaticParams() {
  return Object.keys(commonFilingEvents).map((id) => ({ id }));
}

export default async function FilingDetailPage({ params }: FilingDetailPageProps) {
  const { id } = await params;
  const filing = await resolveFilingEvent(id);
  const eventBadge = getEventTypeBadge(filing.eventType);

  return (
    <main className="feed-page stock-detail-page filing-detail-page">
      <header className="feed-nav">
        <Link className="brand-lockup" href="/" aria-label="US Stock Radar home">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {[
            { label: "Live Feed", href: "/feed" },
            { label: "Watchlist", href: "#" },
            { label: "News", href: "/news" },
            { label: "Filings", href: "/filings" },
            { label: "Alerts", href: "#" },
            { label: "Premium", href: "#" },
          ].map((item) => (
            <Link className={item.label === "Filings" ? "active" : ""} href={item.href} key={item.label}>
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
              <Link href="/filings">Filings</Link>
              <span>/</span>
              <span>Analysis</span>
            </div>
            <div className="stock-detail-source-line">
              <span>{filing.source}</span>
              <span>Filed {filing.filedAt}</span>
            </div>
          </div>

          <section className="stock-detail-hero">
            <div className="stock-detail-title-block">
              <h1>{filing.title}</h1>
              <div className="stock-detail-meta">
                <span className="ticker-chip">{filing.exchange}:{filing.ticker}</span>
                <span>{filing.company}</span>
                <span className="filing-form-pill">{filing.formType}</span>
                <span className={`signal-badge ${filing.signal}`}>{filing.signal}</span>
                <span className={`source-badge impact-badge ${filing.signal}`}>Impact {filing.score}</span>
              </div>
            </div>
          </section>

          <section className="stock-detail-top-grid">
            <PriceChartCard
              change={filing.change}
              changeAmount={filing.changeAmount}
              price={filing.price}
              series={filing.priceSeries}
              ticker={filing.ticker}
              tone={filing.signal}
            />

            <div className="stock-detail-card quick-analysis-panel">
              <div className="quick-take-card quick-take-block">
                <div className="card-heading-row">
                  <h2>Filing Brief</h2>
                  <span>{filing.filingFocus}</span>
                </div>
                <p>{filing.filingBrief}</p>
                <div className="detail-chip-row">
                  <span>{filing.formType}</span>
                  <span>{eventBadge.label}</span>
                  <span>{filing.impact} impact</span>
                  <span>{filing.deliveryLevel}</span>
                </div>
              </div>

              <div className="quick-case-grid">
                <CaseList title="Bullish" tone="bullish" items={filing.bullishPoints} />
                <CaseList title="Bearish" tone="bearish" items={filing.bearishPoints} />
              </div>
            </div>
          </section>

          <section className="stock-detail-card-grid two-up insight-summary-grid">
            <AnalysisCard title="Why It Matters" body={filing.whyItMatters} />
            <section className="stock-detail-card summary-card">
              <h2>Summary</h2>
              <p>{filing.summary}</p>
            </section>
          </section>

          <section className="stock-detail-card-grid two-up insight-summary-grid">
            <AnalysisList title="Key Evidence" items={filing.keyEvidence} />
            <AnalysisList title="What To Watch Next" numbered items={filing.watchNext} />
          </section>

          <SectorThemeContextPanel context={filing.context} ticker={filing.ticker} />

          <section className="stock-detail-card full-text-card filing-original-card">
            <div className="card-heading-row">
              <div>
                <h2>Original Filing Text</h2>
                <p>{filing.originalTextNote}</p>
              </div>
            </div>
            <div
              className="full-text-content filing-text-content"
              dangerouslySetInnerHTML={{ __html: filing.originalHtml }}
            />
            <div className="full-text-content filing-text-content filing-template-table">
              <table>
                <tbody>
                  <tr>
                    <th>Form</th>
                    <td>{filing.formType}</td>
                  </tr>
                  <tr>
                    <th>Normalized event type</th>
                    <td>{eventBadge.label}</td>
                  </tr>
                  <tr>
                    <th>Common template status</th>
                    <td>Suitable for product, governance, legal, clinical, and other non-specialized filings.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </article>

        <aside className="stock-detail-rail">
          <section className="stock-detail-card recent-filings-card">
            <div className="card-heading-row">
              <div>
                <h2>Recent Filings</h2>
                <p>{filing.ticker} filing history</p>
              </div>
              <Link href="/filings">View all</Link>
            </div>
            <div className="recent-filings-list">
              {filing.recentFilings.slice(0, 4).map((item) => (
                <Link href="/filings" key={`${item.form}-${item.title}`}>
                  <span className="filing-form-chip">{item.form}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.eventType} - {item.filedAt}</span>
                  </div>
                  <b>{item.score}</b>
                </Link>
              ))}
            </div>
          </section>

          <section className="stock-detail-card detail-score-card">
            <h2>Event Snapshot</h2>
            <div className={`detail-score-main ${filing.signal}`}>
              <strong>{filing.score}</strong>
              <span>Impact</span>
            </div>
            <MetricRow label="Source Group" value="filings" />
            <MetricRow label="Event Type" value={eventBadge.label} />
            <MetricRow label="Form Type" value={filing.formType} />
            <MetricRow label="Signal" value={filing.signal} />
          </section>

          <section className="stock-detail-card related-news-card">
            <div className="card-heading-row">
              <h2>Related News</h2>
              <Link href="/news">View all</Link>
            </div>
            <div className="related-news-list">
              {filing.relatedNews.slice(0, 4).map((story) => (
                <Link href="/news" key={story.title}>
                  <strong>{story.title}</strong>
                  <span>{story.source} - {story.age}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="stock-detail-card alert-card">
            <span>Premium</span>
            <h2>Real-time alerts for this filing type</h2>
            <p>Track similar SEC filings, amended disclosures, source changes, and follow-up catalysts.</p>
            <button type="button">Upgrade to Premium</button>
          </section>

          <section className="stock-detail-card source-confidence-card">
            <h2>Source & Evidence</h2>
            <div className="source-confidence-top">
              <strong>{filing.source}</strong>
              <span>Official Filing</span>
            </div>
            <MetricRow label="Source Type" value="SEC Filing" />
            <MetricRow label="Issuer" value={filing.company} />
            <MetricRow label="Filed" value={filing.filedAt} />
            <MetricRow label="Verification" value="Original filing linked" />
            <a className="source-original-link" href={filing.sourceUrl} target="_blank" rel="noreferrer">
              <span>View Original Filing</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </section>
        </aside>
      </div>
    </main>
  );
}

async function resolveFilingEvent(id: string): Promise<FilingEvent> {
  const fallback = commonFilingEvents[id] || commonFilingEvents["tsla-8k-operational-update"];

  if (!isUuid(id)) {
    return fallback;
  }

  const detailResult = await getLiveEventDetail(id);
  const item = detailResult.item;

  if (!item || item.sourceGroup !== "filings") {
    return fallback;
  }

  return buildDbFilingEvent(item, fallback);
}

async function buildDbFilingEvent(item: LiveFeedItem, fallback: FilingEvent): Promise<FilingEvent> {
  const ticker = item.ticker.trim().toUpperCase();
  const canLoadTickerContext = isRealTicker(ticker);
  const [eventResult, analysisResult, relatedNewsResult, recentFilingsResult] = await Promise.all([
    fetchEventById(item.id),
    fetchEventAnalysis(item.id),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "news", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "filings", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
  ]);
  const eventRow = toRecord(eventResult.data);
  const rawItem = await loadRawItem(readRowString(eventRow, "raw_item_id"));
  const analysis = toRecord(analysisResult.data);
  const metadata = toRecord(eventRow?.metadata);
  const rawPayload = toRecord(rawItem?.raw_payload);
  const badge = getEventTypeBadge(item.eventType);
  const formType = readFilingFormType(eventRow, rawPayload, item.title);
  const filedAt = formatDetailDateTime(
    readRowString(eventRow, "published_at") || item.detectedAtRaw || readRowString(eventRow, "detected_at"),
    `${item.time} ET`,
  );
  const sourceUrl =
    item.sourceUrl ||
    readRowString(rawItem, "source_url") ||
    readMetadataString(eventRow, "source_url") ||
    readMetadataString(eventRow, "url") ||
    "https://www.sec.gov/edgar/search/";
  const company =
    readRowString(metadata, "issuer") ||
    readRowString(metadata, "company") ||
    readRowString(metadata, "company_name") ||
    readRowString(rawPayload, "issuer") ||
    (ticker && ticker !== "N/A" ? ticker : fallback.company);
  const lastClose = parseSignedNumber(item.price) || parseSignedNumber(fallback.price) || 1;
  const changeAmount = parseSignedNumber(item.changeAmount);
  const previousClose = Number.isFinite(changeAmount) ? Math.max(0, lastClose - changeAmount) : lastClose;
  const originalHtml = readOriginalHtml(eventRow, rawItem, rawPayload);

  return {
    ...fallback,
    id: item.id,
    ticker: ticker || fallback.ticker,
    exchange: readRowString(eventRow, "market") || readMetadataString(eventRow, "exchange") || fallback.exchange,
    company,
    title: item.title,
    formType,
    filedAt,
    source: item.source || "SEC EDGAR",
    sourceUrl,
    eventType: item.eventType,
    impact: item.impact,
    deliveryLevel: item.deliveryLevel,
    score: item.score,
    signal: item.signal,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    filingFocus: readMetadataString(eventRow, "filing_focus") || `${formType} disclosure`,
    filingBrief: item.quickTake || item.summary || fallback.filingBrief,
    whyItMatters: readRowString(analysis, "why_it_matters") || item.scoreReason || fallback.whyItMatters,
    bullishPoints: toStringArray(analysis?.bullish_points, fallback.bullishPoints),
    bearishPoints: toStringArray(analysis?.bearish_points, fallback.bearishPoints),
    summary: item.summary || fallback.summary,
    keyEvidence: toStringArray(analysis?.key_evidence, fallback.keyEvidence),
    watchNext: toStringArray(analysis?.watch_next, fallback.watchNext),
    recentFilings: mapRecentFilingRows(toRows(recentFilingsResult.data), item.id, fallback.recentFilings),
    relatedNews: mapRelatedNewsRows(toRows(relatedNewsResult.data), fallback.relatedNews),
    context: buildDbMarketContext(item, eventRow) || fallback.context,
    priceSeries: buildPriceSeries({
      lastClose,
      previousClose,
      trend: item.trend.length ? item.trend : fallback.context.periods["1D"].topMovers[0]?.trend || [40, 41, 42],
      volumeBase: 1_000_000,
    }),
    originalTextNote: originalHtml
      ? "SEC filing text preserved from the raw item store."
      : "Original SEC filing text has not been parsed for this event yet.",
    originalHtml:
      originalHtml ||
      `<p>Original filing text is not stored for this event yet. Use the original SEC filing link in Source & Evidence for the source document.</p>`,
  };
}

async function loadRawItem(rawItemId: string) {
  if (!rawItemId) return null;

  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${rawItemId}`,
    limit: "1",
  });

  return toRows(result.data)[0] || null;
}

function readOriginalHtml(
  eventRow: Record<string, unknown> | null,
  rawItem: Record<string, unknown> | null,
  rawPayload: Record<string, unknown> | null,
) {
  return (
    readRowString(rawPayload, "full_text_html") ||
    readRowString(rawPayload, "filing_html") ||
    readRowString(rawPayload, "primary_document_html") ||
    readMetadataString(eventRow, "full_text_html") ||
    readMetadataString(eventRow, "filing_html") ||
    bodyTextToHtml(
      readRowString(rawItem, "body_text") ||
        readRowString(rawPayload, "body_text") ||
        readMetadataString(eventRow, "filing_text") ||
        readMetadataString(eventRow, "original_text"),
    )
  );
}

function buildDbMarketContext(
  item: LiveFeedItem,
  eventRow: Record<string, unknown> | null,
): SectorThemeContext | undefined {
  const metadata = toRecord(eventRow?.metadata);
  const ticker = item.ticker.trim().toUpperCase();
  const sector = readRowString(metadata, "sector") || readRowString(metadata, "sector_name");
  const industry =
    readRowString(metadata, "industry_group") ||
    readRowString(metadata, "industry") ||
    readRowString(metadata, "sub_category") ||
    readRowString(metadata, "subCategory");

  if (!sector && !industry) {
    return undefined;
  }

  const topMovers = [
    { change: item.change, symbol: ticker, trend: item.trend.length ? item.trend : [40, 41, 42, 43] },
    { change: "+0.42%", symbol: "SPY", trend: [41, 42, 43, 42, 44, 45, 46, 47, 48, 49] },
    { change: "+0.68%", symbol: "QQQ", trend: [38, 40, 41, 43, 42, 45, 47, 46, 49, 51] },
  ].filter((mover) => isRealTicker(mover.symbol));

  return {
    sector: sector || "Market",
    industry: industry || sector || "Market",
    marketCap: readRowString(metadata, "market_cap") || readRowString(metadata, "marketCap") || undefined,
    themeGroup: readRowString(metadata, "theme_group") || readRowString(metadata, "themeGroup") || undefined,
    subTheme: readRowString(metadata, "sub_theme") || readRowString(metadata, "subTheme") || undefined,
    periods: {
      "1D": {
        sectorChange: readRowString(metadata, "sector_change_1d"),
        industryChange: readRowString(metadata, "industry_change_1d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
      "5D": {
        sectorChange: readRowString(metadata, "sector_change_5d"),
        industryChange: readRowString(metadata, "industry_change_5d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
      "30D": {
        sectorChange: readRowString(metadata, "sector_change_30d"),
        industryChange: readRowString(metadata, "industry_change_30d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers,
      },
    },
  };
}

function AnalysisCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="stock-detail-card analysis-card">
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

function AnalysisList({
  title,
  items,
  tone,
  numbered,
}: {
  title: string;
  items: string[];
  tone?: DetailTone;
  numbered?: boolean;
}) {
  const ToneIcon = tone === "bullish" ? TrendingUp : tone === "bearish" ? TrendingDown : null;

  return (
    <section className={`stock-detail-card analysis-card${tone ? ` ${tone}` : ""}`}>
      <h2 className={ToneIcon ? `analysis-title ${tone}` : undefined}>
        {ToneIcon ? <ToneIcon aria-hidden="true" strokeWidth={2.2} /> : null}
        <span>{title}</span>
      </h2>
      <ol className={numbered ? "numbered" : undefined}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </section>
  );
}

function CaseList({ title, items, tone }: { title: string; items: string[]; tone: "bullish" | "bearish" }) {
  const ToneIcon = tone === "bullish" ? TrendingUp : TrendingDown;

  return (
    <div className={`case-list ${tone}`}>
      <h2 className={`analysis-title ${tone}`}>
        <ToneIcon aria-hidden="true" strokeWidth={2.2} />
        <span>{title}</span>
      </h2>
      <ol>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function mapRecentFilingRows(rows: Record<string, unknown>[], currentId: string, fallback: RecentFiling[]): RecentFiling[] {
  const filings = rows
    .filter((row) => readRowString(row, "id") !== currentId)
    .slice(0, 4)
    .map((row) => {
      const badge = getEventTypeBadge(readRowString(row, "event_type") || "other");

      return {
        eventType: badge.label,
        filedAt: formatShortDate(readRowString(row, "detected_at") || readRowString(row, "published_at")),
        form: readFilingFormType(row, toRecord(row.metadata), readRowString(row, "title")),
        score: readRowNumber(row, "score"),
        title: readRowString(row, "title") || "Recent filing",
      };
    });

  return filings.length ? filings : fallback;
}

function mapRelatedNewsRows(rows: Record<string, unknown>[], fallback: RelatedStory[]): RelatedStory[] {
  const stories = rows.slice(0, 4).map((row) => ({
    age: formatShortDate(readRowString(row, "detected_at") || readRowString(row, "published_at")),
    source: formatSourceLabel(readRowString(row, "source_code")),
    title: readRowString(row, "title") || "Related news",
  }));

  return stories.length ? stories : fallback;
}

function toStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  const items = value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return readRowString(record, "text") || readRowString(record, "title") || readRowString(record, "point");
      }
      return "";
    })
    .filter(Boolean);

  return items.length ? items : fallback;
}

function toRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readRowString(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return "";
  const value = row[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRowNumber(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return 0;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function readMetadataString(row: Record<string, unknown> | null | undefined, key: string) {
  return readRowString(toRecord(row?.metadata), key);
}

function readFilingFormType(
  row: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  title: string,
) {
  return (
    readMetadataString(row, "form_type") ||
    readMetadataString(row, "formType") ||
    readRowString(payload, "form_type") ||
    readRowString(payload, "formType") ||
    inferFormType(title) ||
    "SEC"
  );
}

function inferFormType(title: string) {
  const match = title.match(/\b(?:form\s+)?(10-K|10-Q|8-K|6-K|20-F|S-1|S-3|S-4|S-8|F-1|F-3|F-4|4|144|DEF\s+14A|PRE\s+14A)\b/i);
  return match?.[1]?.toUpperCase().replace(/\s+/, " ") || "";
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

function bodyTextToHtml(value: string) {
  if (!value) return "";
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseSignedNumber(value: string) {
  const parsed = Number(value.replace(/[$,%+\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRealTicker(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildPriceSeries({
  lastClose,
  previousClose,
  trend,
  volumeBase,
}: {
  lastClose: number;
  previousClose: number;
  trend: number[];
  volumeBase: number;
}): PriceChartSeries {
  const ranges: Record<PriceRange, { labels: string[]; spread: number; volumeMultiplier: number }> = {
    "1D": {
      labels: ["9:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "1:00", "1:30", "2:00", "2:30", "3:00"],
      spread: 3.2,
      volumeMultiplier: 1,
    },
    "5D": {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Today"],
      spread: 6.4,
      volumeMultiplier: 1.15,
    },
    "1M": {
      labels: ["W1", "W1", "W2", "W2", "W3", "W3", "W4", "W4", "W5", "W5", "W6", "Today"],
      spread: 9,
      volumeMultiplier: 1.25,
    },
    "3M": {
      labels: ["M1", "M1", "M1", "M2", "M2", "M2", "M3", "M3", "M3", "M3", "M3", "Today"],
      spread: 14,
      volumeMultiplier: 1.35,
    },
    "1Y": {
      labels: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"],
      spread: 24,
      volumeMultiplier: 1.55,
    },
  };

  return {
    previousClose,
    periods: {
      "1D": makePricePoints(ranges["1D"], lastClose, previousClose, trend, volumeBase),
      "5D": makePricePoints(ranges["5D"], lastClose, previousClose, trend, volumeBase),
      "1M": makePricePoints(ranges["1M"], lastClose, previousClose, trend, volumeBase),
      "3M": makePricePoints(ranges["3M"], lastClose, previousClose, trend, volumeBase),
      "1Y": makePricePoints(ranges["1Y"], lastClose, previousClose, trend, volumeBase),
    },
  };
}

function makePricePoints(
  range: { labels: string[]; spread: number; volumeMultiplier: number },
  lastClose: number,
  previousClose: number,
  trend: number[],
  volumeBase: number,
): PricePoint[] {
  const sampledTrend = sampleTrend(trend, range.labels.length);
  const minTrend = Math.min(...sampledTrend);
  const maxTrend = Math.max(...sampledTrend);
  const trendRange = maxTrend - minTrend || 1;
  const lowBand = Math.max(0, Math.min(previousClose, lastClose) - range.spread);
  const highBand = Math.max(previousClose, lastClose) + range.spread * 0.55;
  const closes = sampledTrend.map((value, index) => {
    const normalized = (value - minTrend) / trendRange;
    const drift = (index / Math.max(sampledTrend.length - 1, 1)) * (lastClose - previousClose) * 0.38;
    return roundPrice(lowBand + normalized * (highBand - lowBand) + drift);
  });
  closes[closes.length - 1] = roundPrice(lastClose);

  let cumulativeValue = 0;
  let cumulativeVolume = 0;

  return closes.map((close, index) => {
    const priorClose = index === 0 ? previousClose : closes[index - 1];
    const volatility = Math.max(Math.abs(close - priorClose), range.spread * 0.18);
    const open = roundPrice(priorClose + (index % 2 === 0 ? -1 : 1) * volatility * 0.28);
    const high = roundPrice(Math.max(open, close) + volatility * 0.46);
    const low = roundPrice(Math.max(0, Math.min(open, close) - volatility * 0.42));
    const volume = Math.round(volumeBase * range.volumeMultiplier * (0.58 + (index + 1) / range.labels.length * 0.42 + (index % 3) * 0.08));
    cumulativeValue += close * volume;
    cumulativeVolume += volume;

    return {
      close,
      high,
      low,
      open,
      time: range.labels[index],
      volume,
      vwap: roundPrice(cumulativeValue / cumulativeVolume),
    };
  });
}

function sampleTrend(trend: number[], count: number) {
  const values = trend.length ? trend : [30, 33, 31, 37, 40, 44];

  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(count - 1, 1)) * (values.length - 1));
    return values[sourceIndex];
  });
}

function roundPrice(value: number) {
  return Number(value.toFixed(2));
}
