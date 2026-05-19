import Link from "next/link";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { fetchEventAnalysis, fetchEventById, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import {
  DilutionShareOverhang,
  type DilutionShareOverhangBarSegment,
  type DilutionShareOverhangBreakdownRow,
} from "@/components/DilutionShareOverhang";
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
  offeringDisplayModel?: Record<string, unknown> | null;
  offeringMarketContext?: Record<string, unknown> | null;
  offeringDilutionMetrics?: Record<string, unknown> | null;
  offeringTerms?: Record<string, unknown> | null;
};

type RecentFiling = {
  id?: string;
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

type ShareOverhangBarSegment = DilutionShareOverhangBarSegment;

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
            { label: "Watchlist", href: "/watchlist" },
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

          {filing.eventType === "dilution_risk" ? (
            <DilutionOfferingTemplate filing={filing} />
          ) : (
            <CommonFilingTemplate eventLabel={eventBadge.label} filing={filing} />
          )}
        </article>

        <aside className="stock-detail-rail">
          <section className="stock-detail-card recent-filings-card">
            <div className="card-heading-row">
              <div>
                <h2>{filing.eventType === "dilution_risk" ? "Related Filings" : "Recent Filings"}</h2>
                <p>{filing.eventType === "dilution_risk" ? `${filing.ticker} related filing history` : `${filing.ticker} filing history`}</p>
              </div>
              <Link href="/filings">View all</Link>
            </div>
            <div className="recent-filings-list">
              {filing.recentFilings.slice(0, 4).map((item) => (
                <Link href={item.id ? `/filings/${item.id}` : "/filings"} key={`${item.form}-${item.title}`}>
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
  const [eventResult, analysisResult, relatedNewsResult, recentFilingsResult, offeringTermsResult] = await Promise.all([
    fetchEventById(item.id),
    fetchEventAnalysis(item.id),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "news", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "filings", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
    item.eventType === "dilution_risk"
      ? fetchEventOfferingTerms(item.id)
      : Promise.resolve(null),
  ]);
  const eventRow = toRecord(eventResult.data);
  const rawItem = await loadRawItem(readRowString(eventRow, "raw_item_id"));
  const analysis = toRecord(analysisResult.data);
  const metadata = toRecord(eventRow?.metadata);
  const analysisMetadata = toRecord(analysis?.metadata);
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
    offeringDisplayModel:
      readPlainRecord(analysisMetadata?.offering_display_model) ||
      readPlainRecord(metadata?.offering_display_model) ||
      null,
    offeringMarketContext: readPlainRecord(metadata?.market_context),
    offeringDilutionMetrics: readPlainRecord(metadata?.dilution_metrics),
    offeringTerms: readPlainRecord(offeringTermsResult),
  };
}

async function fetchEventOfferingTerms(eventId: string) {
  const result = await supabaseSelect("event_offering_terms", {
    select: "*",
    event_id: `eq.${eventId}`,
    limit: "1",
  });

  if (!result.ok) return null;
  return toRows(result.data)[0] || null;
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

function CommonFilingTemplate({ eventLabel, filing }: { eventLabel: string; filing: FilingEvent }) {
  return (
    <>
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
              <span>{eventLabel}</span>
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

      <OriginalFilingText filing={filing} eventLabel={eventLabel} includeTemplateStatus />
    </>
  );
}

function DilutionOfferingTemplate({ filing }: { filing: FilingEvent }) {
  const model = buildDilutionOfferingModel(filing);

  return (
    <>
      <section className="stock-detail-top-grid">
        <PriceChartCard
          change={filing.change}
          changeAmount={filing.changeAmount}
          price={filing.price}
          series={filing.priceSeries}
          ticker={filing.ticker}
          tone={filing.signal}
        />

        <DilutionSnapshotCard model={model} />
      </section>

      <DilutionLongSummary model={model} />

      <ShareOverhangCard model={model} />

      <SectorThemeContextPanel context={filing.context} ticker={filing.ticker} />
      <OriginalFilingText filing={filing} eventLabel="Dilution Risk" />
    </>
  );
}

function DilutionSnapshotCard({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  return (
    <section className="stock-detail-card dilution-investor-card dilution-snapshot-panel">
      <div className="dilution-investor-header">
        <div>
          <h2>Dilution Snapshot</h2>
        </div>
      </div>

      <div className="dilution-impact-metrics">
        {model.impactMetrics.map((metric) => (
          <DilutionMetric key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="dilution-warning-strip">
        <p>{model.investorTakeaway}</p>
      </div>

    </section>
  );
}

function DilutionLongSummary({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  return (
    <section className="stock-detail-card dilution-long-summary">
      <h2>Dilution Summary</h2>
      {model.summaryParagraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </section>
  );
}

function ShareOverhangCard({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  const overhangBreakdownRows: DilutionShareOverhangBreakdownRow[] = [];
  if (model.hasConversionSegment) {
    overhangBreakdownRows.push({
      key: "conversion",
      className: "conversion",
      label: model.conversionBreakdownLabel,
      value: model.conversionSharesCompact,
      ratio: model.conversionRatioValue,
    });
  }
  if (model.hasWarrantSegment) {
    overhangBreakdownRows.push({
      key: "warrant",
      className: "warrant",
      label: model.warrantSegmentLabel,
      value: model.warrantSharesCompact,
      ratio: model.warrantRatioValue,
    });
  }
  if (!model.hasPoolSegments && model.potentialSupplyCompact !== "Not disclosed") {
    overhangBreakdownRows.push({
      key: "registered",
      className: "registered",
      label: model.supplyBreakdownLabel,
      value: model.potentialSupplyCompact,
      ratio: model.dilutionRatioPercentValue,
    });
  }

  return (
    <DilutionShareOverhang
      model={{
        ...model,
        overhangAriaLabel: `Potential supply equals ${model.dilutionRatioValue} of current shares`,
        overhangBreakdownRows,
      }}
    />
  );
}

function OriginalFilingText({
  filing,
  eventLabel,
  includeTemplateStatus = false,
}: {
  filing: FilingEvent;
  eventLabel: string;
  includeTemplateStatus?: boolean;
}) {
  return (
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
              <td>{eventLabel}</td>
            </tr>
            {includeTemplateStatus ? (
              <tr>
                <th>Common template status</th>
                <td>Suitable for product, governance, legal, clinical, and other non-specialized filings.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DilutionTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="dilution-term">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type DilutionMetricItem = {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
  tone?: "danger" | "neutral" | "positive";
};

type DilutionDisclosureRow = {
  label: string;
  value: string;
  note?: string;
};

function DilutionMetric({ metric }: { metric: DilutionMetricItem }) {
  return (
    <div className={`dilution-metric${metric.emphasis ? " emphasis" : ""}${metric.tone ? ` ${metric.tone}` : ""}`}>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      {metric.note ? <em>{metric.note}</em> : null}
    </div>
  );
}

function DilutionDisclosureSection({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: DilutionDisclosureRow[];
  emptyText: string;
}) {
  return (
    <section className="dilution-section-block">
      <div className="dilution-section-heading">
        <h2>{title}</h2>
        <span>{rows.length ? "Key terms" : "No parsed fields"}</span>
      </div>
      {rows.length ? (
        <div className="dilution-detail-table">
          {rows.map((row) => (
            <div className="dilution-detail-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              {row.note ? <em>{row.note}</em> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="dilution-empty-note">{emptyText}</p>
      )}
    </section>
  );
}

function RelatedFilingsTable({ filings }: { filings: RecentFiling[] }) {
  return (
    <section className="stock-detail-card dilution-related-filings">
      <div className="dilution-related-heading">
        <h2>Related Filings</h2>
        <span>Recent company filings</span>
      </div>
      <div className="dilution-related-list">
        {filings.slice(0, 4).map((filing) => {
          const content = (
            <>
              <span className="dilution-related-form">{filing.form}</span>
              <span className="dilution-related-copy">
                <strong>{filing.title}</strong>
                <small>
                  {filing.filedAt} · {filing.eventType}
                </small>
              </span>
              <span className="dilution-related-impact">
                <small>Impact</small>
                <b>{filing.score}</b>
              </span>
            </>
          );

          return filing.id ? (
            <Link className="dilution-related-item" href={`/filings/${filing.id}`} key={`${filing.form}-${filing.title}`}>
              {content}
            </Link>
          ) : (
            <div className="dilution-related-item" key={`${filing.form}-${filing.title}`}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function buildDilutionOfferingModel(filing: FilingEvent) {
  const llmDisplayModel = readPlainRecord(filing.offeringDisplayModel);
  const offeringTerms = readPlainRecord(filing.offeringTerms);
  const offeringTermsMetadata = readPlainRecord(offeringTerms?.metadata);
  const sourceText = stripHtml(`${filing.title} ${filing.filingBrief} ${filing.summary} ${filing.originalHtml}`);
  const dbOfferingType = formatOfferingEnumLabel(readRowString(offeringTerms, "offering_type"));
  const dbSecurityType = formatOfferingEnumLabel(readRowString(offeringTerms, "security_type"));
  const dbPrimaryOrResale = formatPrimaryResaleLabel(readRowString(offeringTerms, "primary_or_resale"));
  const rawOfferingType = readRowString(offeringTermsMetadata, "raw_offering_type");
  const offeringMethod = readRowString(offeringTermsMetadata, "offering_method");
  const classificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${sourceText}`;
  const structuredClassificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${filing.title} ${filing.filingBrief}`;
  const isAtm = dbOfferingType === "ATM" || /\b(?:atm|at-the-market|at the market)\b/i.test(sourceText);
  const isShelf = /\b(?:shelf|s-3|s-3asr|registration statement)\b/i.test(classificationText);
  const isForwardSale =
    /\bforward (?:sale|basis|purchase|transaction|contract|agreement)|physical settlement\b/i.test(structuredClassificationText) ||
    /\bforward (?:sale|purchase) agreement\b/i.test(sourceText);
  const isResale =
    dbPrimaryOrResale === "Resale" ||
    dbOfferingType === "Resale registration" ||
    (!dbPrimaryOrResale && /\b(?:resale|selling stockholders?|selling shareholders?)\b/i.test(classificationText));
  const resaleProceedsToCompany = readDisplayCashTermValue(llmDisplayModel, "resale_proceeds_to_company");
  const noIssuerProceeds =
    resaleProceedsToCompany === "$0" ||
    /\b(?:will not|would not|do not|does not|did not|not receive any)\s+proceeds\b/i.test(sourceText) ||
    /\breceives?\s+no\s+proceeds\b/i.test(sourceText) ||
    /\bno\s+proceeds\s+from\b/i.test(sourceText);
  const isRegisteredDirect = /\bregistered direct\b/i.test(classificationText);
  const isPrivatePlacement = /\bprivate placement\b/i.test(classificationText);
  const hasPrefundedWarrants = /\bpre[-\s]?funded warrants?\b/i.test(classificationText);
  const hasWarrants = /\bwarrant/i.test(classificationText);
  const hasConvertibles = /\b(?:convertible|debenture|note)\b/i.test(classificationText);
  const isConvertibleFinancing =
    /convertible[_\s-]?financing|convertible_warrant_financing|convertible notes?|conversion shares|convertible securities/i.test(
      structuredClassificationText
    ) && !/^Shelf registration$/i.test(dbOfferingType);
  const offeringType = buildOfferingDisplayType({
    dbOfferingType,
    hasConvertibles: isConvertibleFinancing,
    hasPrefundedWarrants,
    hasWarrants,
    isAtm,
    isForwardSale,
    isPrivatePlacement,
    isRegisteredDirect,
    isResale,
    isShelf,
    rawOfferingType,
    securityType: dbSecurityType,
  });
  const securityType = dbSecurityType || findSecurityType(sourceText, { hasConvertibles, hasWarrants });
  const primaryOrResale = dbPrimaryOrResale || (isResale
      ? "Resale"
      : isAtm || isRegisteredDirect || isPrivatePlacement
        ? "Primary"
        : "Not disclosed");
  const offeringAmount = isResale ? "" : readDbMoneyValue(offeringTerms, "offering_amount", "offering_amount_text") || findMoneyAmount(sourceText);
  const isShelfLike = isShelf || /shelf/i.test(offeringType);
  const salesAgent = isResale ? "" : findSalesAgent(sourceText);
  const dbPoolBreakdown = buildDbOfferingPoolBreakdown(offeringTerms, { isResale });
  const sourceBackedPoolBreakdown = buildRegisteredPoolBreakdown(sourceText);
  const llmPoolBreakdown = buildLlmPoolBreakdown(llmDisplayModel, { isResale });
  const poolBreakdown = dbPoolBreakdown.length ? dbPoolBreakdown : mergePoolBreakdown(llmPoolBreakdown, sourceBackedPoolBreakdown);
  const poolBreakdownTotal = poolBreakdown.reduce((total, item) => total + item.shareCount, 0);
  const dbPotentialSupply =
    readDbShareValue(offeringTerms, "total_potential_share_exposure", "total_potential_share_exposure_text") ||
    readDbShareValue(offeringTerms, "resale_share_count", "resale_share_count_text") ||
    readDbShareValue(offeringTerms, "shares_offered", "shares_offered_text");
  let sharesOffered =
    dbPotentialSupply ||
    readDisplayFactValue(llmDisplayModel, "total_potential_supply") ||
    findSharesOffered(sourceText) ||
    (poolBreakdownTotal ? `${poolBreakdownTotal.toLocaleString("en-US")} shares` : "");
  const dbCurrentShares = readDbShareValue(offeringTerms, "current_shares_outstanding", "current_shares_outstanding_text");
  const llmCurrentShares = readDisplayFactValue(llmDisplayModel, "current_shares");
  const metricCurrentShares =
    readMetricShareValue(filing.offeringDilutionMetrics, "current_shares_outstanding") ||
    readMetricShareValue(filing.offeringMarketContext, "shares_outstanding");
  const filingCurrentShares = findCurrentSharesOutstanding(sourceText);
  const currentSharesOutstanding =
    dbCurrentShares ||
    llmCurrentShares ||
    metricCurrentShares ||
    filingCurrentShares;
  const currentSharesSourceNote =
    dbCurrentShares
      ? "Outstanding share count from offering terms."
      : llmCurrentShares || filingCurrentShares
      ? "Outstanding share count in the filing."
      : metricCurrentShares
        ? "Latest available market context."
        : "Outstanding share count not disclosed.";
  const publicFloat = readDbShareValue(offeringTerms, "public_float", "public_float_text") || findPublicFloat(sourceText);
  const authorizedShares = readDbShareValue(offeringTerms, "authorized_shares", "authorized_shares_text") || findAuthorizedShares(sourceText);
  const offeringPrice = isResale ? "" : findPriceTerm(sourceText, /(?:offering price|purchase price|price per share|sales price|at a price of)\s*(?:of)?\s*(\$[\d,.]+)/i);
  const estimatedSupplyFromAmountAndPrice = !parseShareCount(sharesOffered)
    ? estimateShareCountFromAmountAndPrice(offeringAmount, offeringPrice)
    : 0;
  const supplyCountEstimated = Boolean(estimatedSupplyFromAmountAndPrice);
  if (supplyCountEstimated) {
    sharesOffered = `${Math.round(estimatedSupplyFromAmountAndPrice).toLocaleString("en-US")} shares`;
  }
  const estimatedDilutionPercent =
    readDbPercentValue(offeringTerms, "total_potential_dilution_percent") ||
    readDbPercentValue(offeringTerms, "estimated_dilution_percent") ||
    estimateDilutionPercent(sharesOffered, currentSharesOutstanding);
  const discountToMarket = findDiscountToMarket(sourceText);
  const warrantCoverage = summarizeWarrantCoverage(sourceText, {
    hasConvertibles,
    hasWarrants,
    sharesOffered,
  });
  const warrantExercisePrice =
    readDbPriceValue(offeringTerms, "common_warrant_exercise_price", "common_warrant_exercise_price_text") ||
    readDbPriceValue(offeringTerms, "warrant_exercise_price", "warrant_exercise_price_text") ||
    findWarrantExercisePrice(sourceText);
  const conversionPrice =
    readDbPriceValue(offeringTerms, "conversion_price", "conversion_price_text") ||
    findPriceTerm(sourceText, /(?:conversion price|convertible at|convert into)\s*(?:of)?\s*(\$[\d,.]+)/i);
  const useOfProceeds = isResale || noIssuerProceeds ? "" : findSentence(sourceText, /\buse of proceeds\b|\bnet proceeds\b|\bgeneral corporate purposes\b|\bworking capital\b/i);
  const warrantCashExerciseProceeds = readDisplayCashTermValue(llmDisplayModel, "conditional_warrant_cash") || findWarrantCashExerciseProceeds(sourceText);
  const firstNotePrincipal = findNotePrincipal(sourceText, "First");
  const secondNotePrincipal = findNotePrincipal(sourceText, "Second");
  const pipePrincipalValue = formatMoneyTotal([firstNotePrincipal, secondNotePrincipal]) || "Not disclosed";
  const firstClosingNetProceeds = findClosingNetProceeds(sourceText, "First");
  const secondClosingNetProceeds = findClosingNetProceeds(sourceText, "Second");
  const closingNetProceedsValue =
    readDisplayCashTermValue(llmDisplayModel, "issuer_primary_or_closing_cash") ||
    formatMoneyTotal([firstClosingNetProceeds, secondClosingNetProceeds], "~") ||
    "Not disclosed";
  const additionalNotesAmount = findAdditionalNotesAmount(sourceText);
  const additionalWarrantShares = findAdditionalWarrantShares(sourceText);
  const effectiveDate = findDateSentence(sourceText, /\beffective\b/i);
  const closingDate = findDateSentence(sourceText, /\bclosing\b|\bclose\b/i);
  const scoreBand =
    formatDisplayRiskLabel(readRowString(offeringTerms, "overhang_level")) ||
    formatDisplayRiskLabel(readRowString(llmDisplayModel, "risk_label")) ||
    (filing.score >= 90 ? "Severe" : filing.score >= 75 ? "High" : filing.score >= 55 ? "Moderate" : "Low");
  const llmWatchItems = readDisplayStringArray(llmDisplayModel, "watch_items");
  const nextTrigger = llmWatchItems[0] || filing.watchNext[0] || "Watch for pricing, closing, or amended prospectus details.";
  const offeredCount = parseShareCount(sharesOffered);
  const currentCount = parseShareCount(currentSharesOutstanding);
  const currentSharesValue = formatShareCountValue(currentSharesOutstanding) || "Not disclosed";
  const potentialSupplyValue = formatShareCountValue(sharesOffered) || "Not disclosed";
  const dilutionRatioValue = formatDilutionRatio(estimatedDilutionPercent);
  const canRenderOverhangChart = Boolean(currentCount && offeredCount);
  const displayOverhangLevel = canRenderOverhangChart ? scoreBand : "Needs review";
  const displayLabels = buildOfferingDisplayLabels({
    hasPrefundedWarrants,
    isConvertibleFinancing,
    isForwardSale,
    isRegisteredDirect,
    isResale,
    isShelfLike: isShelf || /shelf/i.test(offeringType),
    supplyCountEstimated,
  });
  const overhangShareRead = isDisclosedValue(dilutionRatioValue) ? `${dilutionRatioValue} of current shares` : "";
  const companyProceeds =
    isResale && noIssuerProceeds
      ? "$0 from resale"
      : isDisclosedValue(closingNetProceedsValue)
        ? closingNetProceedsValue
        : isShelfLike && isDisclosedValue(offeringAmount)
          ? "Future takedown"
          : offeringAmount || "Not disclosed";
  const companyProceedsNote =
    isResale && noIssuerProceeds
      ? "Resale sales are $0 to the company."
      : isShelfLike && isDisclosedValue(offeringAmount)
        ? `${offeringAmount} shelf capacity; cash only if securities are sold later.`
        : "Gross proceeds from the disclosed terms.";
  const instrumentPriceSummary = formatInstrumentPriceSummary(warrantExercisePrice, conversionPrice);
  const conversionPriceAmount = parseMoneyValue(conversionPrice);
  const warrantExercisePriceAmount = parseMoneyValue(warrantExercisePrice);
  const totalConversionSharesCount = sumPoolBreakdownShares(poolBreakdown, /\bnotes conversion\b/i);
  const totalWarrantSharesCount = sumPoolBreakdownShares(poolBreakdown, /\bwarrant shares\b/i);
  const conversionSharesValue = formatShareCountNumber(totalConversionSharesCount) || "Not disclosed";
  const warrantSharesValue = formatShareCountNumber(totalWarrantSharesCount) || "Not disclosed";
  const currentSharesCompact = formatCompactShareCount(currentCount) || "Not disclosed";
  const potentialSupplyCompact = formatCompactShareCount(offeredCount) || "Not disclosed";
  const combinedPotentialSharesCompact =
    formatCompactShareCount(currentCount && offeredCount ? currentCount + offeredCount : Math.max(currentCount, offeredCount)) || "Not disclosed";
  const conversionSharesCompact = formatCompactShareCount(totalConversionSharesCount) || "Not disclosed";
  const warrantSharesCompact = formatCompactShareCount(totalWarrantSharesCount) || "Not disclosed";
  const totalOverhangPercent = offeredCount && currentCount ? (offeredCount / currentCount) * 100 : 0;
  const conversionRatioPercent = currentCount && totalConversionSharesCount ? (totalConversionSharesCount / currentCount) * 100 : 0;
  const warrantRatioPercent = currentCount && totalWarrantSharesCount ? (totalWarrantSharesCount / currentCount) * 100 : 0;
  const additiveScaleBaseShares =
    currentCount && offeredCount ? currentCount + offeredCount : Math.max(currentCount || 0, offeredCount || 0, poolBreakdownTotal || 0);
  const currentSharesBarWidth = scaleShareAmount(currentCount, additiveScaleBaseShares);
  const supplyBarWidth = scaleShareAmount(offeredCount, additiveScaleBaseShares);
  const currentSharesScalePosition = currentSharesBarWidth;
  const supplyScalePosition = currentCount && offeredCount ? 100 : supplyBarWidth;
  const additiveBoundaryPosition = currentSharesBarWidth;
  const conversionScaleWidth = scaleShareAmount(totalConversionSharesCount, additiveScaleBaseShares);
  const warrantScaleWidth = Math.min(
    Math.max(0, supplyBarWidth - conversionScaleWidth),
    scaleShareAmount(totalWarrantSharesCount, additiveScaleBaseShares)
  );
  const overhangAxisTicks = buildAdditiveOverhangAxisTicks({
    currentPosition: additiveBoundaryPosition,
    supplyPosition: 100,
    currentLabel: "Current",
    supplyLabel: "Total",
  });
  const conversionLabelPosition = Math.min(92, Math.max(8, conversionScaleWidth / 2));
  const warrantLabelPosition = Math.min(92, Math.max(8, conversionScaleWidth + warrantScaleWidth / 2));
  const conversionRatioValue = formatPercentCompact(conversionRatioPercent) || "Not disclosed";
  const warrantRatioValue = formatPercentCompact(warrantRatioPercent) || "Not disclosed";
  const hasCurrentSharesMarker = Boolean(currentCount);
  const hasPoolTotalMarker = Boolean(offeredCount && currentCount);
  const markersAreClose = false;
  const useCombinedMarkerLabel = false;
  const hasConversionSegment = Boolean(totalConversionSharesCount && conversionScaleWidth > 0);
  const hasWarrantSegment = Boolean(totalWarrantSharesCount && warrantScaleWidth > 0);
  const hasPoolSegments = hasConversionSegment || hasWarrantSegment;
  const supplySegmentLabel = supplyMarkerLabelFromType(isResale, isShelfLike);
  const supplyComponentTotal = poolBreakdown.reduce((total, item) => total + item.shareCount, 0);
  const supplyComponentSegments = poolBreakdown.map((item, index) => ({
    key: `supply-component-${index}`,
    className: overhangSegmentClassName(item.label),
    label: formatOverhangComponentLabel(item.label, { isResale }),
    value: formatCompactShareCount(item.shareCount) || item.shares,
    note: currentCount ? `${formatPercentCompact((item.shareCount / currentCount) * 100) || "Not disclosed"} of current shares` : "Potential",
    width: scaleShareAmount(item.shareCount, additiveScaleBaseShares),
    compact: scaleShareAmount(item.shareCount, additiveScaleBaseShares) < 24,
  }));
  const remainingSupplyCount = Math.max(0, offeredCount - supplyComponentTotal);
  const overhangBarSegmentCandidates: Array<ShareOverhangBarSegment | null> = [
    currentCount
      ? {
          key: "current-base",
          className: "current-base",
          label: "Current shares",
          value: currentSharesCompact,
          width: currentSharesBarWidth,
          compact: currentSharesBarWidth < 24,
      }
      : null,
    ...supplyComponentSegments,
    offeredCount && !supplyComponentSegments.length
      ? {
          key: "registered-supply",
          className: "registered-supply",
          label: supplySegmentLabel,
          value: potentialSupplyCompact,
          note: `${dilutionRatioValue} of current shares`,
          width: supplyBarWidth,
          compact: supplyBarWidth < 24,
      }
      : null,
    remainingSupplyCount && supplyComponentSegments.length
      ? {
          key: "remaining-supply",
          className: "registered-supply",
          label: "Other potential supply",
          value: formatCompactShareCount(remainingSupplyCount) || `${remainingSupplyCount.toLocaleString("en-US")} shares`,
          note: currentCount ? `${formatPercentCompact((remainingSupplyCount / currentCount) * 100) || "Not disclosed"} of current shares` : "Potential",
          width: scaleShareAmount(remainingSupplyCount, additiveScaleBaseShares),
          compact: scaleShareAmount(remainingSupplyCount, additiveScaleBaseShares) < 24,
        }
      : null,
  ];
  const overhangBarSegments = overhangBarSegmentCandidates.filter(
    (segment): segment is ShareOverhangBarSegment => Boolean(segment && segment.width > 0)
  );
  const conversionBasisValue =
    totalConversionSharesCount && conversionPriceAmount
      ? formatMoneyValue(totalConversionSharesCount * conversionPriceAmount, "~")
      : "Not disclosed";
  const conversionSegmentLabel = isDisclosedValue(pipePrincipalValue) ? "Convertible Notes" : "Convertibles";
  const conversionBreakdownLabel = isDisclosedValue(pipePrincipalValue) ? "Convertible Notes" : "Convertibles";
  const warrantSegmentLabel = "Warrants";
  const warrantExerciseTotalValue =
    warrantCashExerciseProceeds ||
    (totalWarrantSharesCount && warrantExercisePriceAmount
      ? formatMoneyValue(totalWarrantSharesCount * warrantExercisePriceAmount, "~")
      : "");
  const warrantExerciseSummary =
    isDisclosedValue(warrantSharesValue) && isDisclosedValue(warrantExercisePrice)
      ? `${warrantSharesValue} @ ${warrantExercisePrice}; cash if exercised ${warrantExerciseTotalValue || "not disclosed"}`
      : isDisclosedValue(warrantExercisePrice)
        ? warrantExercisePrice
        : "Not disclosed";
  const noteConversionSummary =
    isDisclosedValue(conversionSharesValue) && isDisclosedValue(conversionPrice)
      ? `${conversionSharesValue} @ ${conversionPrice}; implied basis ${conversionBasisValue}`
      : instrumentPriceSummary || "Not disclosed";
  const companyCashSummary =
    isDisclosedValue(closingNetProceedsValue) && isDisclosedValue(warrantExerciseTotalValue)
      ? `${closingNetProceedsValue} closing net; ${warrantExerciseTotalValue} if warrants are exercised`
      : closingNetProceedsValue;
  const coreSummary = buildDilutionCoreSummary({
    closingNetProceedsValue,
    currentSharesValue,
    dilutionRatioValue,
    instrumentPriceSummary,
    noteConversionSummary,
    pipePrincipalValue,
    potentialSupplyValue,
    warrantExerciseSummary,
    warrantCashExerciseProceeds,
  });
  const plainOfferingType = isResale
    ? "resale registration"
    : isAtm
      ? "at-the-market offering"
      : offeringType.toLowerCase();
  const investorHeadline =
    isResale && overhangShareRead
      ? `Resale supply equals ${overhangShareRead}`
      : isResale
        ? "Potential selling pressure from registered resale shares"
        : `${scoreBand} dilution watch`;
  const poolMixSummary = formatPoolMixSummary(poolBreakdown);
  const registeredPoolDescription = poolMixSummary
    ? `, including ${poolMixSummary}`
    : hasConvertibles && hasWarrants
      ? ", including convertible-note and warrant shares"
      : hasWarrants
        ? ", including warrant-linked shares"
        : "";
  const registeredPoolDoubleCountWarning =
    hasWarrants || poolMixSummary
      ? ` It is not ${potentialSupplyValue} plus separate warrant shares.`
      : " Do not double count registered components as separate additional supply.";
  const investorTakeaway =
    isResale && sharesOffered
      ? `The ${potentialSupplyValue} figure is the registered resale pool${registeredPoolDescription}.${registeredPoolDoubleCountWarning}`
      : filing.whyItMatters;
  const poolMixValue = formatPoolMixValue({
    conversionSharesValue,
    pipePrincipalValue,
    warrantSharesValue,
  });
  const llmNarrativeSummary = readRowString(llmDisplayModel, "narrative_summary");
  const summaryNarrative = llmNarrativeSummary || buildDilutionSummaryNarrative({
    additionalNotesAmount,
    additionalWarrantShares,
    closingNetProceedsValue,
    company: filing.company,
    currentSharesValue,
    dilutionRatioValue,
    isResale,
    noIssuerProceeds,
    poolMixSummary,
    potentialSupplyValue,
    warrantExerciseTotalValue,
  });
  const summaryParagraphs = llmNarrativeSummary
    ? [
        llmNarrativeSummary,
        `Share overhang view uses ${currentSharesValue} as the base and ${potentialSupplyValue} as potential resale supply. ${nextTrigger}`,
      ]
    : buildDilutionSummaryParagraphs({
        additionalNotesAmount,
        additionalWarrantShares,
        closingNetProceedsValue,
        currentSharesValue,
        dilutionRatioValue,
        nextTrigger,
        noIssuerProceeds,
        poolMixSummary,
        potentialSupplyValue,
        warrantExerciseTotalValue,
      });
  const impactMetricItems: Array<DilutionMetricItem | null> = [
    {
      label: "Current shares",
      value: currentSharesValue,
      note: currentSharesSourceNote,
      tone: "neutral",
    },
    {
      label: displayLabels.supplyMetricLabel,
      value: potentialSupplyValue,
      note: supplyCountEstimated
        ? `Estimated from ${offeringAmount} / ${offeringPrice}.`
        : displayLabels.supplyMetricNote || (poolMixSummary || "Share count disclosed in the filing."),
      emphasis: true,
      tone: isResale || scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
    },
    {
      label: displayLabels.ratioMetricLabel,
      value: dilutionRatioValue,
      note:
        supplyCountEstimated
          ? "Estimated from amount and price, then compared with current shares."
          : overhangShareRead && currentSharesOutstanding
          ? displayLabels.ratioMetricNote
          : "Calculated only when share counts are disclosed.",
      tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
    },
    {
      label: "Company proceeds",
      value: companyProceeds,
      note: companyProceedsNote,
      tone: "neutral",
    },
  ];
  const impactMetrics = impactMetricItems.filter((metric): metric is DilutionMetricItem => Boolean(metric));
  const termsAndProceeds = [
    termRow("First notes principal", firstNotePrincipal),
    termRow("Second notes principal", secondNotePrincipal),
    termRow("Total notes principal", pipePrincipalValue),
    termRow("First closing net proceeds", firstClosingNetProceeds),
    termRow("Second closing net proceeds", secondClosingNetProceeds),
    termRow("Notes conversion price", conversionPrice),
    termRow("Warrant exercise price", warrantExercisePrice),
    termRow(
      "Resale sale proceeds",
      noIssuerProceeds ? "$0 to company" : "Not disclosed",
      "Selling stockholders receive resale proceeds."
    ),
    termRow(
      "Warrant cash exercise",
      warrantCashExerciseProceeds,
      "Company receives this only if warrants are exercised for cash."
    ),
  ].filter((item): item is DilutionDisclosureRow => Boolean(item));
  const futureOverhangRows = [
    termRow("Additional notes", additionalNotesAmount, "Potential future PIPE notes, not part of the 13.02M registered pool."),
    termRow(
      "Additional warrant shares",
      additionalWarrantShares,
      "Potential future warrant shares, outside the current registered resale pool."
    ),
  ].filter((item): item is DilutionDisclosureRow => Boolean(item));
  const closingRows = [
    {
      label: "First closing",
      timing: "Issued May 4, 2026",
      principal: firstNotePrincipal || "Not disclosed",
      conversionShares: findPoolBreakdownShares(poolBreakdown, "First notes conversion"),
      warrantShares: findPoolBreakdownShares(poolBreakdown, "First warrant shares"),
      netProceeds: firstClosingNetProceeds || "Not disclosed",
      conversionBasis: formatConversionBasis(
        findPoolBreakdownShareCount(poolBreakdown, "First notes conversion"),
        conversionPriceAmount
      ),
      warrantCashValue: formatWarrantCashValue(
        findPoolBreakdownShareCount(poolBreakdown, "First warrant shares"),
        warrantExercisePriceAmount
      ),
      conversionMath: formatConversionMath(
        findPoolBreakdownShareCount(poolBreakdown, "First notes conversion"),
        conversionPrice,
        conversionPriceAmount
      ),
      warrantMath: formatWarrantMath(
        findPoolBreakdownShareCount(poolBreakdown, "First warrant shares"),
        warrantExercisePrice,
        warrantExercisePriceAmount
      ),
    },
    {
      label: "Second closing",
      timing: "After registration effectiveness",
      principal: secondNotePrincipal || "Not disclosed",
      conversionShares: findPoolBreakdownShares(poolBreakdown, "Second notes conversion"),
      warrantShares: findPoolBreakdownShares(poolBreakdown, "Second warrant shares"),
      netProceeds: secondClosingNetProceeds || "Not disclosed",
      conversionBasis: formatConversionBasis(
        findPoolBreakdownShareCount(poolBreakdown, "Second notes conversion"),
        conversionPriceAmount
      ),
      warrantCashValue: formatWarrantCashValue(
        findPoolBreakdownShareCount(poolBreakdown, "Second warrant shares"),
        warrantExercisePriceAmount
      ),
      conversionMath: formatConversionMath(
        findPoolBreakdownShareCount(poolBreakdown, "Second notes conversion"),
        conversionPrice,
        conversionPriceAmount
      ),
      warrantMath: formatWarrantMath(
        findPoolBreakdownShareCount(poolBreakdown, "Second warrant shares"),
        warrantExercisePrice,
        warrantExercisePriceAmount
      ),
    },
  ].filter((item) =>
    [item.principal, item.conversionShares, item.warrantShares, item.netProceeds].some(isDisclosedValue)
  );
  const whatHappened = isResale
    ? [
        `Current shares outstanding: ${currentSharesValue}.`,
        `Registered resale pool: ${potentialSupplyValue}.`,
        `Potential supply equals ${dilutionRatioValue} of current shares.`,
        isDisclosedValue(instrumentPriceSummary)
          ? `The pool includes conversion/warrant-linked shares; instrument prices are ${instrumentPriceSummary}.`
          : "The registered pool may include instrument-linked shares, but prices were not cleanly parsed.",
        noIssuerProceeds
          ? "The company gets $0 from those resales."
          : "Company proceeds were not clearly parsed.",
      ]
    : [
        `The filing is a ${plainOfferingType}.`,
        offeringAmount ? `Disclosed offering size: ${offeringAmount}.` : "Offering size was not clearly parsed.",
        useOfProceeds || "Use of proceeds was not cleanly parsed from the filing.",
      ];
  const whyItMattersItems = [
    isDisclosedValue(instrumentPriceSummary)
      ? `The conversion price and warrant exercise price are separate terms, not two separate share pools on top of ${potentialSupplyValue}.`
      : "Instrument terms were not cleanly parsed.",
    overhangShareRead
      ? `Supply overhang is ${overhangShareRead}.`
      : "The main risk is additional tradable supply.",
    isResale
      ? "If holders sell, extra supply can pressure price."
      : "Actual dilution depends on pricing and shares issued.",
  ];
  const termRows = compactRows([
    row("Registered shares", sharesOffered),
    row("Current shares", currentSharesOutstanding),
    row("Company proceeds", companyProceeds),
    row("Warrant exercise", warrantExercisePrice),
    row("Conversion price", conversionPrice),
    row("Effective date", effectiveDate),
    row("Closing date", closingDate),
  ]);
  const hasParsedTerms = [
    offeringAmount,
    sharesOffered,
    currentSharesOutstanding,
    publicFloat,
    authorizedShares,
    offeringPrice,
    discountToMarket,
    warrantCoverage?.value,
    warrantExercisePrice,
    conversionPrice,
    useOfProceeds,
    salesAgent,
    effectiveDate,
    closingDate,
  ].some(isDisclosedValue);
  const displayedSupplyValue =
    isResale || isForwardSale || isConvertibleFinancing || isRegisteredDirect || hasPrefundedWarrants
      ? sharesOffered || "Not disclosed"
      : offeringAmount || sharesOffered || "Not disclosed";
  const offeringStructureRows = compactRows([
    row("Offering Type", offeringType),
    row("Security Type", securityType),
    row("Registration Use", primaryOrResale),
    row(isResale ? "Registered Resale Shares" : "Shares Offered", sharesOffered),
    isResale ? null : row("Offering Amount", offeringAmount),
    isResale ? null : row("Offering Price", offeringPrice),
    isResale ? null : row("Discount to Market", discountToMarket),
    isResale ? null : row("Sales Agent", salesAgent),
    isResale && noIssuerProceeds
      ? row("Issuer Proceeds", "None from selling-stockholder resales")
      : row("Use of Proceeds", useOfProceeds),
    row("Effective Date", effectiveDate),
    row("Closing Date", closingDate),
  ]);
  const shareImpactRows = compactRows([
    row("Current Shares Outstanding", currentSharesOutstanding),
    row("Public Float", publicFloat),
    row("Authorized Shares", authorizedShares),
    row("Estimated Dilution Percent", estimatedDilutionPercent),
    row("Overhang Level", scoreBand),
  ]);
  const warrantConvertibleRows = compactRows([
    warrantCoverage
      ? {
          label: hasConvertibles ? "Convertible / Warrant Shares" : "Warrant Coverage",
          value: warrantCoverage.value,
          note: warrantCoverage.note,
        }
      : null,
    row("Warrant Exercise Price", warrantExercisePrice),
    row("Conversion Price", conversionPrice),
  ]);

  return {
    disclosureStatus: hasParsedTerms ? "Parsed from current filing text" : "Terms require source review",
    dilutionRead: `${displayOverhangLevel} dilution watch`,
    dilutionRatioPercentValue: canRenderOverhangChart ? estimatedDilutionPercent || dilutionRatioValue : "No supply count",
    estimatedDilutionPercent,
    companyProceeds,
    coreSummary,
    additionalNotesAmount: additionalNotesAmount || "Not disclosed",
    additionalWarrantShares: additionalWarrantShares || "Not disclosed",
    closingNetProceedsValue,
    closingRows,
    companyCashSummary,
    conversionPrice,
    conversionBasisValue,
    conversionBreakdownLabel,
    conversionLabelPosition,
    conversionRatioValue,
    conversionScaleWidth,
    conversionSegmentLabel,
    conversionSharesCompact,
    conversionSharesValue,
    canRenderOverhangChart,
    currentSharesCompact,
    combinedPotentialSharesCompact,
    currentSharesLabelPosition: currentSharesScalePosition,
    currentSharesScalePosition,
    currentSharesValue,
    dilutionRatioValue,
    impactMetrics,
    instrumentPriceSummary,
    investorHeadline,
    investorTakeaway,
    mainVariable: isResale
      ? "Registered resale shares"
      : isAtm
        ? "Actual shares sold"
        : hasConvertibles
          ? "Conversion price and share cap"
          : "Offering size and pricing",
    nextTrigger,
    offeringAmount,
    offeringStructureRows,
    offeringType,
    overhangScoreCaption: displayLabels.overhangScoreCaption,
    overhangSubtitle: displayLabels.overhangSubtitle,
    overhangUnavailableMessage: displayLabels.unavailableMessage,
    overhangLevel: displayOverhangLevel,
    overhangAxisTicks,
    overhangBarSegments,
    overhangPosition: filing.score >= 75 ? 72 : filing.score >= 55 ? 48 : 22,
    overhangSummary:
      filing.score >= 75
        ? "The score implies elevated overhang risk until final sales, conversion, or share-count effects are clear."
        : filing.score >= 55
          ? "The filing creates a moderate overhang watch, mainly dependent on execution and follow-up terms."
          : "The filing is on dilution watch, but the parsed terms do not yet show a large confirmed share impact.",
    primaryOrResale,
    primaryExposureLabel: displayLabels.primaryExposureLabel,
    primaryExposureValue: displayedSupplyValue,
    potentialSupplyValue,
    potentialSupplyCompact,
    pipePrincipalValue,
    poolMixValue,
    poolBreakdown,
    quickImpactLabel: displayLabels.quickImpactLabel,
    quickImpactValue: isDisclosedValue(estimatedDilutionPercent) ? estimatedDilutionPercent : dilutionRatioValue,
    riskTone: displayOverhangLevel === "Severe" || displayOverhangLevel === "High" ? "danger" : displayOverhangLevel === "Moderate" ? "neutral" : "positive",
    securityType,
    shareImpactRows,
    supplyScalePosition,
    supplyLabelPosition: Math.min(92, supplyScalePosition),
    snapshotMetrics: [
      { label: "Offering Type", value: offeringType, emphasis: true },
      { label: "Security Type", value: securityType },
      {
        label: displayLabels.snapshotSupplyLabel,
        value: displayedSupplyValue,
        emphasis: isDisclosedValue(displayedSupplyValue),
      },
      { label: "Primary / Resale", value: primaryOrResale },
      { label: "Estimated Dilution", value: estimatedDilutionPercent, note: "Calculated only when share counts are disclosed." },
      { label: "Overhang", value: displayOverhangLevel },
    ],
    keyEvidence: filing.keyEvidence.length
      ? filing.keyEvidence
      : [
          `${offeringType} identified from the filing.`,
          "Final dilution depends on actual sales or conversion activity.",
          "Follow-up filings should confirm proceeds and share count changes.",
        ],
    timeline: llmWatchItems.length || filing.watchNext.length
      ? [...llmWatchItems, ...filing.watchNext].filter(Boolean).slice(0, 3)
      : [
          "Watch prospectus supplement or amended filing for final terms.",
          "Compare issued shares against current float after closing.",
          "Track proceeds usage and follow-up liquidity disclosures.",
    ],
    summaryNarrative,
    summaryParagraphs,
    termRows,
    termsAndProceeds,
    futureOverhangRows,
    hasConversionSegment,
    hasCurrentSharesMarker,
    hasPoolSegments,
    hasPoolTotalMarker,
    markersAreClose,
    useCombinedMarkerLabel,
    supplyBreakdownLabel: displayLabels.supplyBreakdownLabel,
    supplyDetailLabel: displayLabels.supplyDetailLabel,
    supplyRatioCaption: isDisclosedValue(dilutionRatioValue) ? `${dilutionRatioValue} of current` : "Not calculable",
    supplyMarkerLabel: isResale ? "Current + resale" : isShelfLike ? "Current + registered" : "Current + supply",
    totalExposureLabel: displayLabels.totalExposureLabel,
    hasWarrantSegment,
    noteConversionSummary,
    warrantCashExerciseProceeds,
    warrantLabelPosition,
    warrantSegmentLabel,
    warrantExercisePrice,
    warrantExerciseSummary,
    warrantExerciseTotalValue: warrantExerciseTotalValue || "Not disclosed",
    warrantRatioValue,
    warrantScaleWidth,
    warrantSharesCompact,
    warrantSharesValue,
    whatHappened,
    whyItMattersItems,
    warrantConvertibleRows,
  };
}

function row(label: string, value: string | null | undefined): DilutionDisclosureRow | null {
  const normalized = cleanDisclosureValue(value);
  return isDisclosedValue(normalized) ? { label, value: normalized } : null;
}

function termRow(label: string, value: string | null | undefined, note?: string): DilutionDisclosureRow | null {
  const normalized = cleanDisclosureValue(value);
  return isDisclosedValue(normalized) ? { label, value: normalized, note } : null;
}

function compactRows(rows: Array<DilutionDisclosureRow | null>) {
  return rows.filter((item): item is DilutionDisclosureRow => Boolean(item));
}

function buildLlmPoolBreakdown(model: Record<string, unknown> | null, options: { isResale: boolean }) {
  return recordArray(model?.supply_segments)
    .map((segment) => {
      const shares = readPlainRecord(segment.shares);
      const valueText = readRowString(shares, "value_text");
      const numericValue = readRowNumber(shares, "numeric_value");
      const shareCount = numericValue || parseShareCount(valueText);
      if (!shareCount) return null;

      return {
        detail: readRowString(segment, "timing_or_condition") || readRowString(segment, "evidence") || "LLM-selected supply component",
        label: formatLlmPoolSegmentLabel(segment, options),
        shareCount,
        shares: `${shareCount.toLocaleString("en-US")} shares`,
      };
    })
    .filter((item): item is { label: string; shares: string; detail: string; shareCount: number } => Boolean(item));
}

function buildDbOfferingPoolBreakdown(terms: Record<string, unknown> | null, options: { isResale: boolean }) {
  return [
    dbPoolComponent(
      options.isResale ? "Resale shares" : "Common shares",
      readRowNumber(terms, "common_shares_offered"),
      readRowString(terms, "common_shares_offered_text"),
      options.isResale ? "Common stock registered for resale in the current pool" : "Common shares in the current offering pool"
    ),
    dbPoolComponent(
      "Pre-funded warrant shares",
      readRowNumber(terms, "prefunded_warrant_shares"),
      readRowString(terms, "prefunded_warrant_shares_text"),
      "Pre-funded warrant shares in the current offering pool"
    ),
    dbPoolComponent(
      "Notes conversion",
      readRowNumber(terms, "convertible_share_exposure"),
      readRowString(terms, "convertible_share_exposure_text"),
      "Convertible-note share exposure in the current pool"
    ),
    dbPoolComponent(
      "Warrant shares",
      readRowNumber(terms, "common_warrant_shares"),
      readRowString(terms, "common_warrant_shares_text"),
      "Warrant shares in the current pool"
    ),
  ].filter((item): item is { label: string; shares: string; detail: string; shareCount: number } => Boolean(item));
}

function dbPoolComponent(label: string, numericValue: number, textValue: string, detail: string) {
  const shareCount = numericValue || parseShareCount(textValue);
  if (!shareCount) return null;

  return {
    detail,
    label,
    shareCount,
    shares: `${Math.round(shareCount).toLocaleString("en-US")} shares`,
  };
}

function mergePoolBreakdown(
  llmPoolBreakdown: Array<{ label: string; shares: string; detail: string; shareCount: number }>,
  sourceBackedPoolBreakdown: Array<{ label: string; shares: string; detail: string; shareCount: number }>,
) {
  if (!llmPoolBreakdown.length) return sourceBackedPoolBreakdown;
  if (!sourceBackedPoolBreakdown.length) return llmPoolBreakdown;

  const sourceHasWarrants = sourceBackedPoolBreakdown.some((item) => /\bwarrant/i.test(item.label));
  const sourceHasConvertibles = sourceBackedPoolBreakdown.some((item) => /\bnotes conversion|convert/i.test(item.label));
  const sourceHasInstrumentMix = sourceHasWarrants && sourceHasConvertibles;

  if (sourceHasInstrumentMix) {
    return sourceBackedPoolBreakdown;
  }

  const merged = [...llmPoolBreakdown];
  const hasLlmWarrants = merged.some((item) => /\bwarrant/i.test(item.label));
  const hasLlmConvertibles = merged.some((item) => /\bnotes conversion|convert/i.test(item.label));

  for (const item of sourceBackedPoolBreakdown) {
    if (/\bwarrant/i.test(item.label) && !hasLlmWarrants) merged.push(item);
    if (/\bnotes conversion|convert/i.test(item.label) && !hasLlmConvertibles) merged.push(item);
  }

  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.label}:${item.shareCount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatLlmPoolSegmentLabel(segment: Record<string, unknown>, options: { isResale: boolean }) {
  const instrumentType = readRowString(segment, "instrument_type");
  const label = readRowString(segment, "label");
  const text = `${instrumentType} ${label}`.toLowerCase();

  if (text.includes("warrant")) return "Warrant shares";
  if (text.includes("convertible") || text.includes("conversion") || text.includes("note")) return "Notes conversion";
  if (options.isResale && /\b(common|ordinary|ads|resale)\b/.test(text)) return "Resale shares";
  return label || "Other registered shares";
}

function readDisplayFactValue(model: Record<string, unknown> | null, key: string) {
  return readDisplayFactRecordValue(readPlainRecord(model?.[key]));
}

function readDisplayCashTermValue(model: Record<string, unknown> | null, key: string) {
  const cashTerms = readPlainRecord(model?.key_cash_terms);
  return readDisplayFactRecordValue(readPlainRecord(cashTerms?.[key]));
}

function readDisplayFactRecordValue(fact: Record<string, unknown> | null) {
  const valueText = cleanDisclosureValue(readRowString(fact, "value_text"));
  if (valueText) return valueText;

  const numericValue = readRowNumber(fact, "numeric_value");
  if (!numericValue) return "";

  const unit = readRowString(fact, "unit");
  if (unit === "shares") return `${numericValue.toLocaleString("en-US")} shares`;
  if (unit === "usd") return formatMoneyValue(numericValue);
  if (unit === "usd_per_share") return `$${numericValue.toLocaleString("en-US")}`;
  if (unit === "percent") return `${numericValue.toLocaleString("en-US")}%`;
  return numericValue.toLocaleString("en-US");
}

function readDbShareValue(terms: Record<string, unknown> | null, numberKey: string, textKey: string) {
  const textValue = cleanDisclosureValue(readRowString(terms, textKey));
  if (isDisclosedValue(textValue)) return formatShareCountValue(textValue) || textValue;

  return formatShareCountNumber(readRowNumber(terms, numberKey));
}

function readDbMoneyValue(terms: Record<string, unknown> | null, numberKey: string, textKey: string) {
  const textValue = cleanDisclosureValue(readRowString(terms, textKey));
  if (isDisclosedValue(textValue)) return textValue;

  return formatMoneyValue(readRowNumber(terms, numberKey));
}

function readDbPriceValue(terms: Record<string, unknown> | null, numberKey: string, textKey: string) {
  const textValue = cleanDisclosureValue(readRowString(terms, textKey));
  if (isDisclosedValue(textValue)) return textValue;

  const value = readRowNumber(terms, numberKey);
  return value ? `$${value.toLocaleString("en-US")}` : "";
}

function readDbPercentValue(terms: Record<string, unknown> | null, key: string) {
  const value = readRowNumber(terms, key);
  if (!value) return "";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatOfferingEnumLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "not_disclosed") return "";
  const labels: Record<string, string> = {
    atm: "At-the-market offering",
    at_the_market_offering: "At-the-market offering",
    registered_direct: "Registered direct offering",
    private_placement: "Private placement",
    shelf: "Shelf registration",
    shelf_registration: "Shelf registration",
    resale: "Resale registration",
    resale_registration: "Resale registration",
    convertible_financing: "Convertible financing",
    convertible_warrant_financing: "Convertible / warrant financing",
    warrant_exercise: "Warrant exercise",
    rights_offering: "Rights offering",
    mixed: "Mixed offering",
    common_stock: "Common stock",
    common_shares: "Common shares",
    ordinary_shares: "Ordinary shares",
    ads: "ADS",
    warrants: "Warrants",
    prefunded_warrants: "Pre-funded warrants",
    pre_funded_warrants: "Pre-funded warrants",
    convertible_notes: "Convertible notes",
    debt: "Debt",
  };
  return labels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPrimaryResaleLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "primary") return "Primary";
  if (normalized === "resale") return "Resale";
  if (normalized === "mixed") return "Primary and resale";
  return "";
}

function buildOfferingDisplayType({
  dbOfferingType,
  hasConvertibles,
  hasPrefundedWarrants,
  hasWarrants,
  isAtm,
  isForwardSale,
  isPrivatePlacement,
  isRegisteredDirect,
  isResale,
  isShelf,
  rawOfferingType,
  securityType,
}: {
  dbOfferingType: string;
  hasConvertibles: boolean;
  hasPrefundedWarrants: boolean;
  hasWarrants: boolean;
  isAtm: boolean;
  isForwardSale: boolean;
  isPrivatePlacement: boolean;
  isRegisteredDirect: boolean;
  isResale: boolean;
  isShelf: boolean;
  rawOfferingType: string;
  securityType: string;
}) {
  const text = `${dbOfferingType} ${rawOfferingType} ${securityType}`.toLowerCase();
  if (isForwardSale) return "Forward sale";
  if (isAtm) return "At-the-market offering";
  if (isRegisteredDirect) return "Registered direct offering";
  if (isResale) return "Resale registration";
  if (hasConvertibles) return isPrivatePlacement ? "Convertible financing" : "Convertible financing";
  if (hasPrefundedWarrants || (hasWarrants && /unit|mixed|pre[-_\s]?funded/.test(text))) return "Mixed offering";
  if (isPrivatePlacement) return "Private placement";
  if (isShelf) return "Shelf registration";
  if (hasWarrants) return "Warrant-linked offering";
  if (/public offering|underwritten public offering|common stock public offering/.test(text)) return "Common stock offering";
  return dbOfferingType || "Equity offering";
}

function buildOfferingDisplayLabels({
  hasPrefundedWarrants,
  isConvertibleFinancing,
  isForwardSale,
  isRegisteredDirect,
  isResale,
  isShelfLike,
  supplyCountEstimated,
}: {
  hasPrefundedWarrants: boolean;
  isConvertibleFinancing: boolean;
  isForwardSale: boolean;
  isRegisteredDirect: boolean;
  isResale: boolean;
  isShelfLike: boolean;
  supplyCountEstimated: boolean;
}) {
  if (isForwardSale) {
    return {
      overhangSubtitle: "Current shares plus potential settlement supply",
      overhangScoreCaption: "Potential settlement supply vs. current shares",
      supplyDetailLabel: "Forward Sale Shares",
      supplyBreakdownLabel: "Forward sale shares",
      supplyMetricLabel: "Potential settlement supply",
      supplyMetricNote: supplyCountEstimated ? "Estimated settlement share count." : "Potential settlement supply.",
      ratioMetricLabel: "Settlement / current",
      ratioMetricNote: "Potential settlement supply compared with current shares.",
      primaryExposureLabel: "Forward Sale Shares",
      quickImpactLabel: "Settlement / Current",
      snapshotSupplyLabel: "Forward Sale Shares",
      totalExposureLabel: "Potential total",
      unavailableMessage:
        "Forward sale share count was not disclosed or mechanically calculable, so settlement overhang is not calculated.",
    };
  }

  if (isConvertibleFinancing) {
    return {
      overhangSubtitle: "Current shares plus estimated conversion exposure",
      overhangScoreCaption: "Estimated conversion exposure vs. current shares",
      supplyDetailLabel: "Estimated conversion shares",
      supplyBreakdownLabel: "Convertible securities",
      supplyMetricLabel: "Estimated conversion shares",
      supplyMetricNote: supplyCountEstimated ? "Estimated from principal amount and conversion price." : "Conditional conversion exposure.",
      ratioMetricLabel: "Conversion / current",
      ratioMetricNote: "Estimated conversion exposure compared with current shares.",
      primaryExposureLabel: "Convertible Principal",
      quickImpactLabel: "Conversion / Current",
      snapshotSupplyLabel: "Estimated Conversion Shares",
      totalExposureLabel: "Potential total",
      unavailableMessage:
        "Conversion share exposure was not disclosed or mechanically calculable, so conversion overhang is not calculated.",
    };
  }

  if (isResale) {
    return {
      overhangSubtitle: "Current shares plus potential resale supply",
      overhangScoreCaption: "Potential resale supply vs. current shares",
      supplyDetailLabel: "Registered Resale Shares",
      supplyBreakdownLabel: "Registered resale shares",
      supplyMetricLabel: "Potential supply",
      supplyMetricNote: supplyCountEstimated ? "Estimated resale supply." : "Potential resale supply.",
      ratioMetricLabel: "Supply / current",
      ratioMetricNote: "Potential resale supply compared with current shares.",
      primaryExposureLabel: "Registered Resale Shares",
      quickImpactLabel: "Vs Current Shares",
      snapshotSupplyLabel: "Resale Shares",
      totalExposureLabel: "Potential total",
      unavailableMessage:
        "Registered resale share count was not disclosed or mechanically calculable, so share overhang is not calculated.",
    };
  }

  if (hasPrefundedWarrants) {
    return {
      overhangSubtitle: "Current shares plus near-immediate common share exposure",
      overhangScoreCaption: "Near-immediate exposure vs. current shares",
      supplyDetailLabel: "Immediate Share Exposure",
      supplyBreakdownLabel: "Pre-funded warrant exposure",
      supplyMetricLabel: "Immediate Share Exposure",
      supplyMetricNote: "Pre-funded warrants are treated as near-immediate common share exposure.",
      ratioMetricLabel: "Exposure / current",
      ratioMetricNote: "Near-immediate exposure compared with current shares.",
      primaryExposureLabel: "Immediate Share Exposure",
      quickImpactLabel: "Exposure / Current",
      snapshotSupplyLabel: "Immediate Exposure",
      totalExposureLabel: "Potential total",
      unavailableMessage:
        "Immediate share exposure was not disclosed or mechanically calculable, so dilution is not calculated.",
    };
  }

  return {
    overhangSubtitle: "Current shares plus potential supply",
    overhangScoreCaption: "Total potential dilution vs. current shares",
    supplyDetailLabel: isShelfLike ? "Registered Shares" : isRegisteredDirect ? "Immediate Share Exposure" : "Potential Supply",
    supplyBreakdownLabel: isShelfLike ? "Registered shares" : "Potential supply",
    supplyMetricLabel: isShelfLike && !isRegisteredDirect ? "Registered shares" : "Potential supply",
    supplyMetricNote: supplyCountEstimated ? "Estimated from amount and price." : "Potential supply.",
    ratioMetricLabel: "Supply / current",
    ratioMetricNote: "Potential supply compared with current shares.",
    primaryExposureLabel: isShelfLike ? "Registered Shares" : "Immediate Share Exposure",
    quickImpactLabel: "Potential Dilution",
    snapshotSupplyLabel: isShelfLike ? "Registered Shares" : "Potential Supply",
    totalExposureLabel: "Potential total",
    unavailableMessage:
      "Potential supply was not disclosed or mechanically calculable, so share overhang is not calculated.",
  };
}

function readMetricShareValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = readRowNumber(record, key);
  if (!value) return "";
  return `${Math.round(value).toLocaleString("en-US")} shares`;
}

function readDisplayStringArray(model: Record<string, unknown> | null, key: string) {
  const value = model?.[key];
  return Array.isArray(value) ? value.map((item) => cleanDisclosureValue(item)).filter(Boolean).slice(0, 3) : [];
}

function formatDisplayRiskLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isDisclosedValue(value: string | null | undefined) {
  const normalized = cleanDisclosureValue(value).toLowerCase();
  return Boolean(
    normalized &&
      /[a-z0-9$]/i.test(normalized) &&
      normalized !== "not disclosed" &&
      normalized !== "none identified"
  );
}

function cleanDisclosureValue(value: string | null | undefined) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&ldquo;|&rdquo;|&quot;/g, "\"")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "");
}

function findMoneyAmount(sourceText: string) {
  return (
    sourceText.match(/\b(?:up to|maximum aggregate(?: offering)? price of|aggregate(?: offering)? price of|gross proceeds of|net proceeds of|offering amount of)\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\b(?:gross|net)\s+proceeds\s+(?:were|are|will be|of)?\s*(?:approximately)?\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
}

function findSalesAgent(sourceText: string) {
  const salesAgent =
    sourceText.match(/\b(?:sales agreement with|with|through|by)\s+([A-Z][A-Za-z0-9&.,\-\s]+?(?:Securities|Capital|Markets|Partners|LLC|Inc\.?))/)?.[1]?.trim() ||
    "";

  return /\bOTC Markets\b/i.test(salesAgent) ? "" : salesAgent;
}

function findSecurityType(sourceText: string, flags: { hasConvertibles: boolean; hasWarrants: boolean }) {
  if (/\bpre-funded warrants?\b/i.test(sourceText)) return "Pre-funded warrants";
  if (/\bcommon stock\b/i.test(sourceText)) return "Common stock";
  if (/\bcommon shares?\b/i.test(sourceText)) return "Common shares";
  if (/\bADSs?\b|\bAmerican Depositary Shares?\b/i.test(sourceText)) return "ADS";
  if (/\bordinary shares?\b/i.test(sourceText)) return "Ordinary shares";
  if (flags.hasConvertibles) return "Convertible securities";
  if (flags.hasWarrants) return "Warrants";
  if (/\bunits?\b/i.test(sourceText)) return "Units";
  return "Not disclosed";
}

function findSharesOffered(sourceText: string) {
  return (
    sourceText.match(/\b(?:registers?|registered|registering|resale registration for|registered resale of|resale of|sell(?:ing)? up to|issuance of)\s+(?:up to\s+)?([\d,]+(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|warrants|units))/i)?.[1] ||
    sourceText.match(/\b(?:up to|offering of)\s+([\d,]+(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|warrants|units))/i)?.[1] ||
    sourceText.match(/\b([\d,]+(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|warrants|units))\b/i)?.[1] ||
    ""
  );
}

function findCurrentSharesOutstanding(sourceText: string) {
  return (
    sourceText.match(/\b([\d,]+(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares))\s+(?:issued and outstanding|outstanding)\b/i)?.[1] ||
    ""
  );
}

function buildRegisteredPoolBreakdown(sourceText: string) {
  return [
    poolComponent(
      "First notes conversion",
      findShareCountNear(sourceText, /(\d[\d,]*)\s+shares of Common Stock[^.]{0,120}\bFirst Conversion Shares\b/i),
      "First notes issued May 4, 2026"
    ),
    poolComponent(
      "First warrant shares",
      findShareCountNear(sourceText, /(\d[\d,]*)\s+shares of Common Stock[^.]{0,120}\bFirst Warrant Shares\b/i),
      "First warrants issued with first notes"
    ),
    poolComponent(
      "Second notes conversion",
      findShareCountNear(sourceText, /(\d[\d,]*)\s+shares of Common Stock[^.]{0,120}\bSecond Conversion Shares\b/i),
      "Second notes after registration effectiveness"
    ),
    poolComponent(
      "Second warrant shares",
      findShareCountNear(sourceText, /(\d[\d,]*)\s+shares of Common Stock[^.]{0,120}\bSecond Warrant Shares\b/i),
      "Second warrants after registration effectiveness"
    ),
  ].filter((item): item is { label: string; shares: string; detail: string; shareCount: number } => Boolean(item));
}

function findPoolBreakdownShares(poolBreakdown: Array<{ label: string; shares: string }>, label: string) {
  return poolBreakdown.find((item) => item.label === label)?.shares || "Not disclosed";
}

function findPoolBreakdownShareCount(poolBreakdown: Array<{ label: string; shareCount: number }>, label: string) {
  return poolBreakdown.find((item) => item.label === label)?.shareCount || 0;
}

function sumPoolBreakdownShares(poolBreakdown: Array<{ label: string; shareCount: number }>, pattern: RegExp) {
  return poolBreakdown
    .filter((item) => pattern.test(item.label))
    .reduce((total, item) => total + item.shareCount, 0);
}

function findShareCountNear(sourceText: string, pattern: RegExp) {
  const match = sourceText.match(pattern);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function poolComponent(label: string, shareCount: number, detail: string) {
  if (!shareCount) return null;

  return {
    detail,
    label,
    shareCount,
    shares: `${shareCount.toLocaleString("en-US")} shares`,
  };
}

function formatPoolMixSummary(poolBreakdown: Array<{ label: string; shareCount: number }>) {
  const conversionShares = poolBreakdown
    .filter((item) => /\bnotes conversion\b/i.test(item.label))
    .reduce((total, item) => total + item.shareCount, 0);
  const warrantShares = poolBreakdown
    .filter((item) => /\bwarrant shares\b/i.test(item.label))
    .reduce((total, item) => total + item.shareCount, 0);

  const parts = [
    conversionShares ? `${formatCompactShareCount(conversionShares)} shares from convertible notes` : "",
    warrantShares ? `${formatCompactShareCount(warrantShares)} shares from warrants` : "",
  ].filter(Boolean);

  return parts.join(" + ");
}

function formatPoolMixValue({
  conversionSharesValue,
  pipePrincipalValue,
  warrantSharesValue,
}: {
  conversionSharesValue: string;
  pipePrincipalValue: string;
  warrantSharesValue: string;
}) {
  const parts = [
    isDisclosedValue(conversionSharesValue)
      ? `${isDisclosedValue(pipePrincipalValue) ? `${pipePrincipalValue} convertible notes -> ` : "Convertible notes -> "}${conversionSharesValue}`
      : "",
    isDisclosedValue(warrantSharesValue) ? `Warrants -> ${warrantSharesValue}` : "",
  ].filter(Boolean);

  return parts.length ? parts.join(" / ") : "Not disclosed";
}

function formatCompactShareCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString("en-US");
}

function formatPercentCompact(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function buildOverhangAxisMaxPercent(values: number[]) {
  const observedMax = Math.max(100, ...values.filter((value) => Number.isFinite(value) && value > 0));
  if (observedMax <= 100) return 100;

  const breakpoints = [150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
  const bounded = breakpoints.find((breakpoint) => observedMax <= breakpoint);
  if (bounded) return bounded;
  return Math.ceil(observedMax / 1000) * 1000;
}

function buildOverhangAxisTicks(axisMax: number) {
  const step = axisMax <= 100 ? 25 : axisMax <= 200 ? 50 : axisMax <= 500 ? 100 : axisMax <= 1000 ? 250 : 500;
  const values = new Set<number>([0, axisMax]);

  for (let value = step; value < axisMax; value += step) {
    values.add(value);
  }

  if (axisMax > 100) {
    values.add(100);
  }

  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({
      label: `${value}%`,
      position: scaleOverhangValue(value, axisMax),
      value,
    }));
}

function scaleOverhangValue(value: number, axisMax: number) {
  if (!Number.isFinite(value) || !Number.isFinite(axisMax) || axisMax <= 0) return 0;
  return Math.min(100, Math.max(0, (value / axisMax) * 100));
}

function scaleShareAmount(value: number, maxValue: number) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || value <= 0 || maxValue <= 0) return 0;
  return Math.min(100, Math.max(0, (value / maxValue) * 100));
}

function buildShareOverhangAxisTicks({
  currentPosition,
  supplyPosition,
  currentLabel,
  supplyLabel,
}: {
  currentPosition: number;
  supplyPosition: number;
  currentLabel: string;
  supplyLabel: string;
}) {
  const ticks = [
    { label: "0", position: 0, value: 0 },
    { label: currentLabel, position: currentPosition, value: 100 },
    { label: supplyLabel, position: supplyPosition, value: 200 },
  ].filter((tick) => Number.isFinite(tick.position) && tick.position >= 0);

  const deduped: Array<{ label: string; position: number; value: number }> = [];
  for (const tick of ticks.sort((a, b) => a.position - b.position)) {
    const existing = deduped.find((item) => Math.abs(item.position - tick.position) < 8);
    if (existing) {
      existing.label = existing.label === "0" ? tick.label : `${existing.label} / ${tick.label}`;
      existing.position = Math.max(existing.position, tick.position);
      continue;
    }
    deduped.push(tick);
  }

  return deduped.map((tick, index) => ({
    ...tick,
    value: index,
  }));
}

function buildAdditiveOverhangAxisTicks({
  currentPosition,
  supplyPosition,
  currentLabel,
  supplyLabel,
}: {
  currentPosition: number;
  supplyPosition: number;
  currentLabel: string;
  supplyLabel: string;
}) {
  return [
    { label: "0", position: 0, value: 0 },
    { label: currentLabel, position: Math.min(100, Math.max(0, currentPosition)), value: 1 },
    { label: supplyLabel, position: Math.min(100, Math.max(0, supplyPosition)), value: 2 },
  ];
}

function formatOverhangComponentLabel(label: string, options: { isResale?: boolean } = {}) {
  const text = label.toLowerCase();
  if (/registered|shelf/.test(text)) return "Registered shelf shares";
  if (/resale/.test(text)) return "Registered resale shares";
  if (/pre[-_\s]?funded/.test(text)) return "Pre-funded warrants";
  if (/warrant/.test(text)) return "Warrants";
  if (/convert|note/.test(text)) return "Convertible notes";
  if (options.isResale && /common|ordinary|ads/.test(text)) return "Resale shares";
  if (/common|ordinary|ads/.test(text)) return "Common shares";
  return label || "Potential supply";
}

function overhangSegmentClassName(label: string) {
  const text = label.toLowerCase();
  if (/pre[-_\s]?funded/.test(text)) return "prefunded";
  if (/warrant/.test(text)) return "warrant";
  if (/convert|note/.test(text)) return "conversion";
  if (/common|ordinary|ads/.test(text)) return "common";
  return "registered-supply";
}

function supplyMarkerLabelFromType(isResale: boolean, isShelfLike: boolean) {
  if (isResale) return "Resale supply";
  if (isShelfLike) return "Registered shares";
  return "Potential supply";
}

function formatShareCountNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value.toLocaleString("en-US")} shares`;
}

function findPublicFloat(sourceText: string) {
  const value =
    sourceText.match(/\bpublic float\b[^.\n]{0,120}?(\$?\d[\d,.]*\s*(?:million|billion|m|bn)?|\d[\d,]*(?:\.\d+)?\s+shares)/i)?.[1] ||
    "";

  return cleanDisclosureValue(value);
}

function findAuthorizedShares(sourceText: string) {
  return sourceText.match(/\bauthorized\b[^.\n]{0,120}?([\d,]+(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares))/i)?.[1] || "";
}

function estimateDilutionPercent(sharesOffered: string, currentSharesOutstanding: string) {
  const offered = parseShareCount(sharesOffered);
  const current = parseShareCount(currentSharesOutstanding);
  if (!offered || !current) return "Not disclosed";

  const percent = (offered / current) * 100;
  return `${percent.toFixed(percent >= 10 ? 1 : 2)}%`;
}

function formatShareCountValue(value: string) {
  const count = parseShareCount(value);
  if (!count) return "";
  return `${count.toLocaleString("en-US")} shares`;
}

function formatDilutionRatio(estimatedDilutionPercent: string) {
  return isDisclosedValue(estimatedDilutionPercent) ? estimatedDilutionPercent : "Not disclosed";
}

function buildDilutionSummaryNarrative({
  additionalNotesAmount,
  additionalWarrantShares,
  closingNetProceedsValue,
  company,
  currentSharesValue,
  dilutionRatioValue,
  isResale,
  noIssuerProceeds,
  poolMixSummary,
  potentialSupplyValue,
  warrantExerciseTotalValue,
}: {
  additionalNotesAmount: string;
  additionalWarrantShares: string;
  closingNetProceedsValue: string;
  company: string;
  currentSharesValue: string;
  dilutionRatioValue: string;
  isResale: boolean;
  noIssuerProceeds: boolean;
  poolMixSummary: string;
  potentialSupplyValue: string;
  warrantExerciseTotalValue: string;
}) {
  const issuer = company || "The company";
  const supplySentence =
    isResale && isDisclosedValue(potentialSupplyValue) && isDisclosedValue(currentSharesValue)
      ? `${issuer} filed a resale registration covering ${potentialSupplyValue}, compared with a current share count of ${currentSharesValue} (${dilutionRatioValue}).`
      : `${issuer} filed a dilution-risk registration statement.`;
  const poolSentence = poolMixSummary
    ? `The registered pool already includes ${poolMixSummary}; these are not separate share blocks on top of the registered amount.`
    : "";
  const cashSentence =
    noIssuerProceeds || isDisclosedValue(closingNetProceedsValue) || isDisclosedValue(warrantExerciseTotalValue)
      ? `Company cash is separate: resale sales send ${noIssuerProceeds ? "$0" : "undisclosed proceeds"} to the company${isDisclosedValue(closingNetProceedsValue) ? `, parsed closing net proceeds are ${closingNetProceedsValue}` : ""}${isDisclosedValue(warrantExerciseTotalValue) ? `, and warrants could add ${warrantExerciseTotalValue} only if exercised for cash` : ""}.`
      : "";
  const extraSentence =
    isDisclosedValue(additionalNotesAmount) || isDisclosedValue(additionalWarrantShares)
      ? `The filing also discloses possible future overhang outside the current registered pool (${[additionalNotesAmount, additionalWarrantShares].filter(isDisclosedValue).join(" / ")}).`
      : "";

  return [supplySentence, poolSentence, cashSentence, extraSentence].filter(Boolean).join(" ");
}

function buildDilutionSummaryParagraphs({
  additionalNotesAmount,
  additionalWarrantShares,
  closingNetProceedsValue,
  currentSharesValue,
  dilutionRatioValue,
  nextTrigger,
  noIssuerProceeds,
  poolMixSummary,
  potentialSupplyValue,
  warrantExerciseTotalValue,
}: {
  additionalNotesAmount: string;
  additionalWarrantShares: string;
  closingNetProceedsValue: string;
  currentSharesValue: string;
  dilutionRatioValue: string;
  nextTrigger: string;
  noIssuerProceeds: boolean;
  poolMixSummary: string;
  potentialSupplyValue: string;
  warrantExerciseTotalValue: string;
}) {
  const supplyParagraph =
    isDisclosedValue(potentialSupplyValue) && isDisclosedValue(currentSharesValue)
      ? `The central issue is supply size: a pool of ${potentialSupplyValue} is registered against a current share count of ${currentSharesValue}, or ${dilutionRatioValue}. This does not mean every share is sold immediately, but it creates a large tradable-share overhang once resale becomes available.`
      : "";
  const poolParagraph = poolMixSummary
    ? `The registered amount should be read as one pool. It includes ${poolMixSummary}, so the conversion and warrant pieces explain what is inside the pool rather than adding another full block of shares on top of it.`
    : "";
  const cashParagraph =
    noIssuerProceeds || isDisclosedValue(closingNetProceedsValue) || isDisclosedValue(warrantExerciseTotalValue)
      ? `Cash proceeds and resale pressure are separate. Selling-stockholder resale sales send ${noIssuerProceeds ? "$0" : "undisclosed proceeds"} to the company${isDisclosedValue(closingNetProceedsValue) ? `, while parsed closing net proceeds are ${closingNetProceedsValue}` : ""}${isDisclosedValue(warrantExerciseTotalValue) ? ` and warrants could add ${warrantExerciseTotalValue} only if exercised for cash` : ""}.`
      : "";
  const followUpParagraph =
    isDisclosedValue(additionalNotesAmount) || isDisclosedValue(additionalWarrantShares) || nextTrigger
      ? `The follow-up risk is whether more supply becomes eligible. The filing also points to possible overhang outside the current pool${isDisclosedValue(additionalNotesAmount) || isDisclosedValue(additionalWarrantShares) ? ` (${[additionalNotesAmount, additionalWarrantShares].filter(isDisclosedValue).join(" / ")})` : ""}. Next trigger: ${nextTrigger}`
      : "";

  return [supplyParagraph, poolParagraph, cashParagraph, followUpParagraph].filter(Boolean);
}

function buildDilutionCoreSummary({
  closingNetProceedsValue,
  currentSharesValue,
  dilutionRatioValue,
  instrumentPriceSummary,
  noteConversionSummary,
  pipePrincipalValue,
  potentialSupplyValue,
  warrantExerciseSummary,
  warrantCashExerciseProceeds,
}: {
  closingNetProceedsValue: string;
  currentSharesValue: string;
  dilutionRatioValue: string;
  instrumentPriceSummary: string;
  noteConversionSummary: string;
  pipePrincipalValue: string;
  potentialSupplyValue: string;
  warrantExerciseSummary: string;
  warrantCashExerciseProceeds: string;
}) {
  const instrumentQualifier = isDisclosedValue(instrumentPriceSummary) ? " including instrument-linked shares" : "";
  const supplySentence =
    isDisclosedValue(currentSharesValue) && isDisclosedValue(potentialSupplyValue) && isDisclosedValue(dilutionRatioValue)
      ? `Current shares are ${currentSharesValue}; registered resale pool is ${potentialSupplyValue}${instrumentQualifier}, equal to ${dilutionRatioValue} of current shares.`
      : "Current share count, registered resale pool, or dilution ratio was not fully parsed.";
  const instrumentSentence = isDisclosedValue(noteConversionSummary) || isDisclosedValue(warrantExerciseSummary)
    ? ` Convertible note shares: ${noteConversionSummary}; warrants: ${warrantExerciseSummary}.`
    : isDisclosedValue(instrumentPriceSummary)
      ? ` Conversion and warrant prices: ${instrumentPriceSummary}.`
    : "";
  const moneyParts = [
    isDisclosedValue(pipePrincipalValue) ? `${pipePrincipalValue} note principal` : "",
    isDisclosedValue(closingNetProceedsValue) ? `${closingNetProceedsValue} net proceeds from first/second closings` : "",
    isDisclosedValue(warrantCashExerciseProceeds) ? `up to ${warrantCashExerciseProceeds} from cash warrant exercise` : "",
  ].filter(Boolean);
  const moneySentence = moneyParts.length ? ` Financing amounts: ${moneyParts.join("; ")}.` : "";

  return `${supplySentence}${instrumentSentence}${moneySentence}`;
}

function formatInstrumentPriceSummary(warrantExercisePrice: string, conversionPrice: string) {
  const parts = [
    isDisclosedValue(conversionPrice) ? `conversion ${conversionPrice}` : "",
    isDisclosedValue(warrantExercisePrice) ? `warrant ${warrantExercisePrice}` : "",
  ].filter(Boolean);

  return parts.join(" / ");
}

function formatConversionMath(shareCount: number, conversionPrice: string, conversionPriceAmount: number) {
  if (!shareCount || !conversionPriceAmount || !isDisclosedValue(conversionPrice)) return "Not disclosed";

  return `${formatMoneyValue(shareCount * conversionPriceAmount, "~")} / ${conversionPrice} -> ${formatShareCountNumber(shareCount)}`;
}

function formatConversionBasis(shareCount: number, conversionPriceAmount: number) {
  if (!shareCount || !conversionPriceAmount) return "Not disclosed";

  return formatMoneyValue(shareCount * conversionPriceAmount, "~");
}

function formatWarrantMath(shareCount: number, warrantExercisePrice: string, warrantExercisePriceAmount: number) {
  if (!shareCount || !warrantExercisePriceAmount || !isDisclosedValue(warrantExercisePrice)) return "Not disclosed";

  return `${formatShareCountNumber(shareCount)} x ${warrantExercisePrice} -> ${formatMoneyValue(shareCount * warrantExercisePriceAmount, "~")}`;
}

function formatWarrantCashValue(shareCount: number, warrantExercisePriceAmount: number) {
  if (!shareCount || !warrantExercisePriceAmount) return "Not disclosed";

  return formatMoneyValue(shareCount * warrantExercisePriceAmount, "~");
}

function parseShareCount(value: string) {
  const match = value.match(/([\d,.]+)/);
  if (!match) return 0;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function findPriceTerm(sourceText: string, pattern: RegExp) {
  return sourceText.match(pattern)?.[1] || "";
}

function findWarrantExercisePrice(sourceText: string) {
  return (
    sourceText.match(/\bWarrants?\b[^.]{0,220}\bexercisable at (?:a price of )?(\$[\d,.]+)\s+per share/i)?.[1] ||
    sourceText.match(/\bexercisable at (?:a price of )?(\$[\d,.]+)\s+per share[^.]{0,80}\bCommon Stock\b/i)?.[1] ||
    sourceText.match(/\bExercise Price\)?[^.]{0,120}?(?:is|of|at)\s+(\$[\d,.]+)/i)?.[1] ||
    ""
  );
}

function findWarrantCashExerciseProceeds(sourceText: string) {
  return (
    sourceText.match(/\breceive up to an aggregate of approximately\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)\s+in cash from the exercise of the Warrants/i)?.[1] ||
    sourceText.match(/\breceive proceeds from the exercise of the Warrants\b[^.]{0,140}?(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
}

function findNotePrincipal(sourceText: string, closing: "First" | "Second") {
  return (
    sourceText.match(new RegExp(`aggregate principal amount of\\s+(\\$[\\d,.]+)\\s+\\(?the\\s+"${closing} Notes"`, "i"))?.[1] ||
    sourceText.match(new RegExp(`(\\$[\\d,.]+)\\s+\\(?the\\s+"${closing} Notes"`, "i"))?.[1] ||
    ""
  );
}

function findClosingNetProceeds(sourceText: string, closing: "First" | "Second") {
  return (
    sourceText.match(new RegExp(`net proceeds to us from the ${closing} Closing[^.]{0,180}?(\\$[\\d,.]+\\s*(?:million|billion|m|bn)?)`, "i"))?.[1] ||
    ""
  );
}

function formatMoneyTotal(values: string[], prefix = "") {
  const total = values.reduce((sum, value) => sum + parseMoneyValue(value), 0);
  if (!total) return "";

  return formatMoneyValue(total, prefix);
}

function formatMoneyValue(value: number, prefix = "") {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000_000) return `${prefix}$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${prefix}$${(value / 1_000_000).toFixed(1)}M`;
  return `${prefix}$${Math.round(value).toLocaleString("en-US")}`;
}

function parseMoneyValue(value: string) {
  const match = cleanDisclosureValue(value).match(/\$?([\d,.]+)\s*(million|billion|m|bn)?/i);
  if (!match) return 0;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return 0;

  const unit = (match[2] || "").toLowerCase();
  if (unit === "billion" || unit === "bn") return amount * 1_000_000_000;
  if (unit === "million" || unit === "m") return amount * 1_000_000;
  return amount;
}

function estimateShareCountFromAmountAndPrice(amountValue: string, priceValue: string) {
  const amount = parseMoneyValue(amountValue);
  const price = parseMoneyValue(priceValue);
  if (!amount || !price) return 0;
  const shares = amount / price;
  return Number.isFinite(shares) && shares > 0 ? shares : 0;
}

function findAdditionalNotesAmount(sourceText: string) {
  return (
    sourceText.match(/\bAdditional Notes\b[^.]{0,120}?up to\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\badditional\s+[^.]{0,80}?Notes\b[^.]{0,120}?up to\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
}

function findAdditionalWarrantShares(sourceText: string) {
  const count =
    findShareCountNear(sourceText, /\bAdditional Warrants\b[^.]{0,160}?aggregate of\s+(\d[\d,]*)\s+shares of Common Stock/i) ||
    findShareCountNear(sourceText, /\bAdditional Warrant Shares\b[^.]{0,120}?(\d[\d,]*)\s+shares of Common Stock/i);

  return count ? `${count.toLocaleString("en-US")} shares` : "";
}

function findDiscountToMarket(sourceText: string) {
  return (
    sourceText.match(/\b(?:discount of|discount to|discount from)\b[^.%]{0,80}?([\d.]+%)/i)?.[1] ||
    sourceText.match(/\b([\d.]+%)\s+discount\b/i)?.[1] ||
    ""
  );
}

function summarizeWarrantCoverage(
  sourceText: string,
  flags: { hasConvertibles: boolean; hasWarrants: boolean; sharesOffered: string }
): { value: string; note?: string } | null {
  const explicitCoverage =
    sourceText.match(/\b(?:warrant coverage|warrant coverage ratio|coverage of)\b[^.%]{0,80}?([\d.]+%)/i)?.[1] ||
    sourceText.match(/\b([\d.]+%)\s+warrant coverage\b/i)?.[1] ||
    "";

  if (explicitCoverage) {
    return { value: explicitCoverage };
  }

  const warrantShares =
    sourceText.match(/\bwarrants?\s+(?:to purchase|exercisable for|representing)\s+(?:up to\s+)?(\d[\d,]*(?:\.\d+)?\s+(?:ordinary shares|common shares|shares of common stock|shares|ADSs?))/i)?.[1] ||
    "";

  if (warrantShares) {
    return {
      value: warrantShares,
      note: "Underlying warrant shares; exercise price shown separately when parsed.",
    };
  }

  if (flags.hasConvertibles && flags.hasWarrants) {
    return {
      value: "Convertible and warrant-linked terms disclosed",
      note: "Use exercise and conversion prices below; share cap requires source review.",
    };
  }

  if (flags.hasWarrants) {
    return {
      value: "Warrant terms disclosed",
      note: "Use exercise price below; coverage was not parsed as a clean percentage.",
    };
  }

  if (flags.hasConvertibles) {
    return {
      value: "Convertible terms disclosed",
      note: "Use conversion price below; conversion share cap requires source review.",
    };
  }

  return null;
}

function findDateSentence(sourceText: string, pattern: RegExp) {
  const sentence = findSentence(sourceText, pattern);
  if (!sentence || !/\b(?:20\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|today|tomorrow)\b/i.test(sentence)) {
    return "";
  }
  return sentence;
}

function findSentence(sourceText: string, pattern: RegExp) {
  const sentence = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .find((item) => pattern.test(item));

  if (!sentence) return "";
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function stripHtml(value: string) {
  return cleanDisclosureValue(value.replace(/<[^>]*>/g, " "));
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
        id: readRowString(row, "id"),
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

function readPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
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
