import { AnalysisDetailDocument, AnalysisDetailCard, AnalysisDetailImpact } from "@/components/filing-analysis-v2/AnalysisDetailDocument";
import detailStyles from "@/components/filing-analysis-v2/GenericFilingAnalysis.module.css";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { PriceChartCard } from "./PriceChartCard";
import { SectorThemeContextPanel } from "./SectorThemeContextPanel";
import { feedItems, getFeedItem, type FeedItem } from "@/lib/feedMock";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { fetchFmpProfile } from "@/lib/integrations";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { readMarketGroupSnapshotCache, type MarketGroupSnapshotPayload } from "@/lib/marketDataCache";
import { parseGlobeNewswireArticleHtml } from "@/lib/sources/globe/parser";
import { NewsAnalysisAdapter } from "@/components/news-analysis-v2/NewsAnalysisAdapter";
import { NEWS_ANALYSIS_V2_FIXTURE_SLUG } from "@/lib/newsAnalysisConstants";
import { loadNewsAnalysisDetail } from "@/lib/newsAnalysisDetail";
import { sanitizeNewsArticleHtml } from "@/lib/newsArticleSanitizer";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getViewerContentState, savedContentKey } from "@/lib/saved/server";
import { fetchEventAnalysis, fetchEventTickers, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import { themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";
import { getCanonicalAnalysisPath } from "@/lib/analysisRoutes";
import {
  DilutionShareOverhang,
  type DilutionShareOverhangBarSegment,
  type DilutionShareOverhangBreakdownRow,
} from "@/components/DilutionShareOverhang";
import type { ContextRange, DetailTone, PriceChartSeries, PricePoint, PriceRange, SectorThemeContext, TopMover } from "./detailTypes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

type StockDetailPageProps = {
  params: Promise<{ id: string }>;
};

type DetailProfile = {
  company: string;
  exchange: string;
  identityChips?: string[];
  price: string;
  changeAmount: string;
  change: string;
  detectedAt: string;
  confidence: string;
  credibility: string;
  historicalAccuracy: string;
  articleReliability: string;
  sourceUrl: string;
  sourceReleaseType: string;
  sourceType: string;
  issuer: string;
  publishedAt: string;
  verification: string;
  theme: string;
  quickTake: string;
  whyItMatters: string;
  bullCase: string[];
  bearCase: string[];
  summary: string;
  keyEvidence: string[];
  watchNext: string[];
  relatedTickers: RelatedTicker[];
  relatedNews: RelatedStory[];
  recentFilings: RecentFiling[];
  context: SectorThemeContext;
  priceSeries: PriceChartSeries;
  fullTextHtml?: string | null;
  fullTextSourceUrl?: string;
  offeringTerms?: Record<string, unknown> | null;
};

type RelatedTicker = {
  symbol: string;
  name: string;
  price: string;
  change: string;
  tone: DetailTone;
};

type RelatedStory = {
  title: string;
  source: string;
  age: string;
};

type RecentFiling = {
  form: string;
  eventType: string;
  title: string;
  filedAt: string;
  score: number;
};

type DilutionMetricItem = {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
  tone?: "danger" | "neutral" | "positive";
};

type NewsOfferingDisplayMode = "standard" | "forward_sale" | "convertible";

const defaultEvent = feedItems[0];
const globeInvuArticleUrl =
  "https://www.globenewswire.com/news-release/2026/05/15/3296065/0/en/investview-inc-invu-reports-financial-results-and-operational-highlights-for-the-first-quarter-ended-march-31-2026.html";

const detailProfiles: Record<string, DetailProfile> = {
  INVU: {
    company: "Investview, Inc.",
    exchange: "OTCQB",
    price: "$0.05",
    changeAmount: "-$0.00",
    change: "-8.10%",
    detectedAt: "May 15, 2026 4:15 PM ET",
    confidence: "Medium",
    credibility: "Medium",
    historicalAccuracy: "N/A",
    articleReliability: "Medium",
    sourceUrl: globeInvuArticleUrl,
    sourceReleaseType: "Official Release",
    sourceType: "Company Press Release",
    issuer: "Investview",
    publishedAt: "May 15, 2026 - 16:15 ET",
    verification: "Original source linked",
    theme: "Financial Results",
    quickTake:
      "INVU reports steep revenue declines, widening operating losses, dwindling cash, and regulatory headwinds in Poland.",
    whyItMatters:
      "Revenue pressure, losses, and shrinking liquidity raise execution risk for the OTC-listed company.",
    bullCase: [
      "Management still reports active business units across fintech and education.",
      "Any recovery in Conectiv activity could stabilize revenue.",
      "Lower digital asset exposure may reduce balance sheet volatility.",
    ],
    bearCase: [
      "Q1 revenue fell sharply year over year.",
      "Operating losses widened while cash declined.",
      "Polish regulatory action remains a material uncertainty.",
    ],
    summary:
      "Investview posted Q1 revenue down about 61% to $3.9M, with operating losses widening to $2.8M. Cash and digital assets fell to $9.5M, while Conectiv revenue was hit by a Polish regulator decision.",
    keyEvidence: [
      "Gross revenue fell 62.2% year over year.",
      "Net loss from operations was $2.8M.",
      "Cash, equivalents, and digital assets were $9.5M at quarter end.",
    ],
    watchNext: [
      "Polish regulatory developments affecting Conectiv.",
      "Liquidity runway and any financing actions.",
      "Revenue stabilization in direct-to-consumer units.",
    ],
    relatedTickers: [
      { symbol: "HOOD", name: "Robinhood Markets", price: "$92.14", change: "+1.80%", tone: "bullish" },
      { symbol: "COIN", name: "Coinbase", price: "$241.77", change: "-0.92%", tone: "bearish" },
      { symbol: "SOFI", name: "SoFi Technologies", price: "$10.82", change: "+0.44%", tone: "bullish" },
    ],
    relatedNews: [
      { title: "Small-cap financial technology names trade on earnings risk", source: "Stock Radar", age: "Today" },
      { title: "Crypto-linked balance sheets remain sensitive to digital asset moves", source: "Stock Radar", age: "Today" },
      { title: "Regulatory headlines weigh on OTC fintech watchlist", source: "Stock Radar", age: "Today" },
      { title: "Revenue declines keep microcap earnings reports in focus", source: "Stock Radar", age: "Today" },
    ],
    recentFilings: [
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "Quarterly report for Q1 2026",
        filedAt: "May 15",
        score: 55,
      },
      {
        form: "8-K",
        eventType: "Financial Risk",
        title: "Operating update and regulatory matter disclosure",
        filedAt: "May 15",
        score: 51,
      },
      {
        form: "4",
        eventType: "Insider / Ownership",
        title: "Recent ownership transaction report",
        filedAt: "May 2",
        score: 34,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Annual meeting proxy materials",
        filedAt: "Apr 25",
        score: 32,
      },
    ],
    context: {
      sector: "Financial Services",
      industry: "Fintech & Digital Assets",
      themeGroup: "Crypto & Digital Assets",
      subTheme: "Retail Trading",
      periods: {
        "1D": {
          sectorChange: "+0.88%",
          industryChange: "-1.20%",
          themeScore: 58,
          themeSignal: "bearish",
          topMovers: [
            { symbol: "INVU", change: "-8.10%", trend: [46, 44, 41, 39, 42, 38, 35, 34, 31, 29] },
            { symbol: "COIN", change: "-0.92%", trend: [42, 41, 39, 40, 38, 37, 35, 36, 34, 33] },
            { symbol: "HOOD", change: "+1.80%", trend: [34, 35, 37, 36, 39, 40, 42, 43, 45, 47] },
          ],
        },
        "5D": {
          sectorChange: "+1.14%",
          industryChange: "-2.74%",
          themeScore: 56,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "INVU", change: "-12.40%", trend: [52, 49, 47, 44, 45, 41, 38, 36, 33, 31] },
            { symbol: "COIN", change: "-3.62%", trend: [46, 44, 42, 43, 40, 39, 37, 35, 34, 32] },
            { symbol: "SOFI", change: "+2.18%", trend: [31, 32, 34, 33, 36, 38, 39, 41, 42, 44] },
          ],
        },
        "30D": {
          sectorChange: "+3.90%",
          industryChange: "-6.20%",
          themeScore: 52,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "INVU", change: "-24.80%", trend: [64, 60, 58, 55, 51, 49, 44, 40, 36, 32] },
            { symbol: "COIN", change: "+6.30%", trend: [35, 36, 38, 41, 40, 43, 45, 48, 50, 52] },
            { symbol: "HOOD", change: "+9.45%", trend: [32, 34, 36, 39, 41, 42, 45, 49, 51, 55] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 0.05,
      previousClose: 0.055,
      trend: [46, 44, 41, 39, 42, 38, 35, 34, 31, 29, 30, 27],
      volumeBase: 620_000,
    }),
  },
  NVDA: {
    company: "NVIDIA Corporation",
    exchange: "NASDAQ",
    price: "$125.47",
    changeAmount: "$2.29",
    change: "+1.86%",
    detectedAt: "May 13, 2026 11:05 AM ET",
    confidence: "High",
    credibility: "High",
    historicalAccuracy: "93%",
    articleReliability: "High",
    sourceUrl: "https://www.businesswire.com/",
    sourceReleaseType: "Official Release",
    sourceType: "Company Press Release",
    issuer: "NVIDIA",
    publishedAt: "Jun 18, 2025 · 08:00 ET",
    verification: "Original source linked",
    theme: "AI Infrastructure",
    quickTake:
      "NVIDIA expanded availability for its data center platform, increasing enterprise access through major cloud partners.",
    whyItMatters:
      "The update reinforces NVIDIA's lead in accelerated computing and keeps investor attention on AI infrastructure demand.",
    bullCase: [
      "Broader cloud availability can pull more enterprise workloads onto NVIDIA platforms.",
      "Partner distribution lowers adoption friction for large customers.",
      "Data center demand remains the central growth driver for the stock.",
    ],
    bearCase: [
      "Supply constraints can limit near-term upside.",
      "Cloud partner timing may delay revenue recognition.",
      "Valuation leaves less room for execution misses.",
    ],
    summary:
      "The company announced wider platform availability across cloud partners. The event is company-specific, AI infrastructure linked, and likely relevant for investors tracking data center growth.",
    keyEvidence: [
      "Platform availability expanded through major cloud partners.",
      "Management positioned the release around enterprise AI deployment.",
      "The announcement supports continued demand for accelerated computing infrastructure.",
    ],
    watchNext: [
      "Cloud partner rollout timing and capacity signals.",
      "Any follow-up guidance around data center demand.",
      "Competitive responses from AMD, custom ASIC vendors, and hyperscalers.",
    ],
    relatedTickers: [
      { symbol: "AMD", name: "Advanced Micro Devices", price: "$173.21", change: "+2.35%", tone: "bullish" },
      { symbol: "AVGO", name: "Broadcom", price: "$1,497.89", change: "+2.10%", tone: "bullish" },
      { symbol: "MRVL", name: "Marvell Technology", price: "$71.32", change: "+1.62%", tone: "bullish" },
      { symbol: "SMCI", name: "Super Micro Computer", price: "$926.75", change: "+3.45%", tone: "bullish" },
      { symbol: "VRT", name: "Vertiv", price: "$96.42", change: "+1.84%", tone: "bullish" },
    ],
    relatedNews: [
      { title: "AI server demand keeps infrastructure suppliers in focus", source: "Business Wire", age: "1h ago" },
      { title: "Cloud capex comments lift data center watchlist", source: "PR Newswire", age: "3h ago" },
      { title: "Semiconductor names rise with accelerated computing demand", source: "GlobeNewswire", age: "5h ago" },
      { title: "AI infrastructure supply chain stays active after platform update", source: "Accesswire", age: "7h ago" },
    ],
    recentFilings: [
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "Quarterly report with data center revenue disclosure",
        filedAt: "May 9",
        score: 72,
      },
      {
        form: "8-K",
        eventType: "Product Update",
        title: "Corporate update tied to new platform availability",
        filedAt: "May 6",
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
        form: "S-8",
        eventType: "Shareholder Vote",
        title: "Equity incentive plan registration statement",
        filedAt: "Apr 28",
        score: 36,
      },
    ],
    context: {
      sector: "Technology",
      industry: "Semiconductors & Compute",
      themeGroup: "AI & Data Center",
      subTheme: "AI Infrastructure",
      periods: {
        "1D": {
          sectorChange: "+2.84%",
          industryChange: "+4.32%",
          themeScore: 92,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "NVDA", change: "+4.86%", trend: [34, 38, 37, 42, 45, 44, 49, 53, 56, 60] },
            { symbol: "AMD", change: "+3.92%", trend: [30, 31, 34, 33, 37, 40, 39, 43, 46, 50] },
            { symbol: "AVGO", change: "+2.74%", trend: [42, 41, 44, 47, 46, 48, 52, 51, 55, 57] },
          ],
        },
        "5D": {
          sectorChange: "+6.41%",
          industryChange: "+8.76%",
          themeScore: 94,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "NVDA", change: "+8.92%", trend: [31, 34, 33, 37, 40, 42, 45, 44, 49, 54] },
            { symbol: "AMD", change: "+7.38%", trend: [29, 31, 35, 34, 38, 41, 43, 42, 46, 50] },
            { symbol: "MRVL", change: "+6.12%", trend: [24, 26, 25, 29, 32, 34, 33, 37, 40, 43] },
          ],
        },
        "30D": {
          sectorChange: "+14.20%",
          industryChange: "+22.40%",
          themeScore: 90,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "NVDA", change: "+24.10%", trend: [22, 24, 27, 29, 33, 36, 39, 43, 47, 52] },
            { symbol: "AVGO", change: "+18.64%", trend: [28, 30, 32, 35, 34, 38, 42, 45, 49, 53] },
            { symbol: "MU", change: "+15.28%", trend: [20, 22, 24, 23, 29, 31, 35, 38, 41, 45] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 125.47,
      previousClose: 123.18,
      trend: [44, 47, 46, 49, 52, 50, 55, 58, 57, 61, 64, 63, 67, 70, 69, 73, 76, 79],
      volumeBase: 12_400_000,
    }),
  },
  PLTR: {
    company: "Palantir Technologies Inc.",
    exchange: "NASDAQ",
    price: "$21.84",
    changeAmount: "$0.57",
    change: "+2.67%",
    detectedAt: "May 13, 2026 9:22 AM ET",
    confidence: "High",
    credibility: "High",
    historicalAccuracy: "90%",
    articleReliability: "High",
    sourceUrl: "https://www.prnewswire.com/news-releases/",
    sourceReleaseType: "Official Release",
    sourceType: "Company Press Release",
    issuer: "Palantir",
    publishedAt: "May 13, 2026 · 09:22 ET",
    verification: "Original source linked",
    theme: "Enterprise AI",
    quickTake:
      "Palantir disclosed an expanded commercial AI agreement, pointing to continued enterprise demand for AI workflow platforms.",
    whyItMatters:
      "Contract expansion is one of the cleaner company-specific signals because it ties the AI narrative to paying customers.",
    bullCase: [
      "Multi-year platform access can support revenue visibility.",
      "Commercial traction expands the story beyond government contracts.",
      "Enterprise AI budgets remain active despite macro uncertainty.",
    ],
    bearCase: [
      "Deal size and timing may not be enough to change near-term estimates.",
      "High expectations can limit upside from routine wins.",
      "Customer concentration remains a watch item.",
    ],
    summary:
      "The event highlights new commercial AI demand and gives investors a company-specific data point for platform adoption.",
    keyEvidence: [
      "Announcement described an expanded commercial relationship.",
      "The customer use case centers on AI workflow deployment.",
      "The event was scored as high impact because it is directly tied to growth narrative.",
    ],
    watchNext: [
      "Whether management quantifies annual contract value.",
      "Follow-on customer wins in the same vertical.",
      "Margin commentary as commercial deployments scale.",
    ],
    relatedTickers: [
      { symbol: "SNOW", name: "Snowflake", price: "$164.22", change: "+1.24%", tone: "bullish" },
      { symbol: "CRM", name: "Salesforce", price: "$291.14", change: "+0.88%", tone: "bullish" },
      { symbol: "NOW", name: "ServiceNow", price: "$812.08", change: "+1.02%", tone: "bullish" },
      { symbol: "MSFT", name: "Microsoft", price: "$415.12", change: "+0.41%", tone: "bullish" },
    ],
    relatedNews: [
      { title: "Enterprise AI software names move higher on contract activity", source: "PR Newswire", age: "2h ago" },
      { title: "Large customers keep AI workflow spending active", source: "Business Wire", age: "4h ago" },
      { title: "Software infrastructure watchlist sees renewed inflows", source: "Accesswire", age: "6h ago" },
      { title: "AI workflow platforms draw fresh enterprise budget attention", source: "GlobeNewswire", age: "8h ago" },
    ],
    recentFilings: [
      {
        form: "8-K",
        eventType: "Strategic Transaction",
        title: "Material commercial agreement update",
        filedAt: "May 10",
        score: 78,
      },
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "Quarterly results and commercial revenue commentary",
        filedAt: "May 5",
        score: 69,
      },
      {
        form: "4",
        eventType: "Insider / Ownership",
        title: "Officer transaction report filed",
        filedAt: "Apr 30",
        score: 43,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Annual meeting proxy statement filed",
        filedAt: "Apr 24",
        score: 39,
      },
    ],
    context: {
      sector: "Technology",
      industry: "Software & Cloud",
      themeGroup: "AI & Data Center",
      subTheme: "AI Software Agents",
      periods: {
        "1D": {
          sectorChange: "+2.84%",
          industryChange: "+2.18%",
          themeScore: 86,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "PLTR", change: "+2.67%", trend: [26, 28, 27, 31, 34, 33, 37, 39, 41, 44] },
            { symbol: "SNOW", change: "+4.12%", trend: [32, 35, 34, 38, 42, 45, 43, 48, 50, 54] },
            { symbol: "DDOG", change: "+3.20%", trend: [28, 29, 32, 31, 35, 37, 39, 38, 42, 45] },
          ],
        },
        "5D": {
          sectorChange: "+6.41%",
          industryChange: "+5.74%",
          themeScore: 88,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "SNOW", change: "+9.18%", trend: [27, 30, 29, 33, 37, 40, 42, 41, 46, 50] },
            { symbol: "PLTR", change: "+7.64%", trend: [24, 25, 28, 31, 30, 35, 38, 40, 43, 47] },
            { symbol: "DDOG", change: "+5.82%", trend: [25, 27, 29, 28, 32, 35, 36, 39, 41, 44] },
          ],
        },
        "30D": {
          sectorChange: "+14.20%",
          industryChange: "+11.60%",
          themeScore: 84,
          themeSignal: "bullish",
          topMovers: [
            { symbol: "PLTR", change: "+21.30%", trend: [21, 23, 26, 29, 32, 36, 39, 43, 46, 51] },
            { symbol: "SNOW", change: "+16.42%", trend: [25, 27, 29, 34, 33, 37, 41, 44, 48, 52] },
            { symbol: "CRM", change: "+9.88%", trend: [30, 31, 34, 33, 36, 39, 41, 44, 45, 48] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 21.84,
      previousClose: 21.27,
      trend: [32, 35, 34, 38, 41, 40, 44, 48, 46, 51, 54, 53, 58, 61, 64, 63, 68, 71],
      volumeBase: 8_900_000,
    }),
  },
};

export function generateStaticParams() {
  return [...feedItems.map((item) => ({ id: item.id })), { id: NEWS_ANALYSIS_V2_FIXTURE_SLUG }];
}

export default async function StockNewsDetailPage({ params }: StockDetailPageProps) {
  const [{ id }, viewerPlan, userId] = await Promise.all([
    params,
    getCurrentViewerPlan(),
    getOptionalCurrentUserId(),
  ]);
  const allowAds = areAdsEnabledForPlan(viewerPlan);
  if (id === NEWS_ANALYSIS_V2_FIXTURE_SLUG) {
    const fixture = await loadNewsAnalysisDetail(id);
    if (!fixture) notFound();
    return (
      <NewsAnalysisAdapter
        allowAds={allowAds}
        detail={fixture}
        newsId={id}
        viewerState={await getNewsViewerState(userId, id, fixture.filing.ticker)}
      />
    );
  }
  const liveDetail = isUuid(id) ? await getLiveEventDetail(id) : { item: null };
  const liveItem = liveDetail.item;
  if (isUuid(id) && !liveItem) notFound();
  if (liveItem?.sourceGroup === "filings") {
    redirect(`/filings/${liveItem.id}`);
  }
  if (liveItem?.sourceGroup === "news") {
    const canonicalPath = getCanonicalAnalysisPath({
      deliveryLevel: liveItem.deliveryLevel,
      id: liveItem.id,
      sourceGroup: "news",
    });
    if (!canonicalPath) notFound();
    permanentRedirect(canonicalPath);
  }
  const event = liveItem ? toDetailEvent(liveItem) : getFeedItem(id) || defaultEvent;
  let profile = liveItem
    ? await buildDbBackedProfile(liveItem, event)
    : detailProfiles[event.ticker] || buildFallbackProfile(event);
  profile = await attachTickerMarketCap(profile, event.ticker);
  const fullTextUrl = isGlobeNewswireUrl(profile.sourceUrl)
    ? profile.sourceUrl
    : event.id === "globe-invu-q1-2026-results"
      ? globeInvuArticleUrl
      : "";
  if (!profile.fullTextHtml && fullTextUrl) {
    profile = await attachGlobeFullText(profile, fullTextUrl);
  }
  profile = sanitizeDetailProfileFullText(profile);
  const eventBadge = getEventTypeBadge(event.eventType);
  const useDilutionOfferingTemplate = shouldUseNewsDilutionOfferingTemplate(event, profile);
  const isNasdaqCorporateAction = isNasdaqCorporateActionDetail(event, profile);
  const showBullBearCases = shouldShowBullBearCases(event, profile);

  return (
    <AnalysisDetailDocument navigation="news" title={event.title} ticker={isRealTicker(event.ticker) ? event.ticker : undefined}
      breadcrumb={<><Link href="/news">News</Link><span>/ Analysis</span></>}
      timestamp={<><time>{profile.detectedAt}</time><span>{event.source}</span></>}
      identity={<>{getDetailIdentityChips(event, profile).map((chip, index) => index === 0 ? <strong key={chip}>{chip}</strong> : <span key={`${chip}-${index}`}>{chip}</span>)}</>}
      badges={<AnalysisDetailImpact score={event.score} signal={event.signal} />}
      rail={<>{!isNasdaqCorporateAction ? (
        <AnalysisDetailCard kind="rail" className="recent-filings-card">
          <div className="card-heading-row">
            <div>
              <h2>Recent Filings</h2>
              <p>{event.ticker} filings context</p>
            </div>
            <Link href="/filings">View all</Link>
          </div>
          <div className={detailStyles.recentList}>
            {profile.recentFilings.slice(0, 4).map((filing) => (
              <Link href="/filings" key={`${filing.form}-${filing.title}`}>
                <span className={detailStyles.formLabel}>{filing.form}</span>
                <div>
                  <strong>{filing.title}</strong>
                  <span>{filing.eventType} - {filing.filedAt}</span>
                </div>
                <b>{filing.score}</b>
              </Link>
            ))}
          </div>
        </AnalysisDetailCard>
      ) : null}

        <AnalysisDetailCard kind="rail" className="detail-score-card">
          <h2>Event Snapshot</h2>
          <div className="detail-score-main">
            <strong data-score-tone={getDirectionalScoreTone(event.score, event.signal)}>
              {event.score}
            </strong>
            <span>Impact</span>
          </div>
          <MetricRow label="Source Group" value={event.sourceGroup} />
          <MetricRow label="Event Type" value={eventBadge.label} />
          <MetricRow label="Signal" value={event.signal} />
        </AnalysisDetailCard>

        {!isNasdaqCorporateAction ? (
          <AnalysisDetailCard kind="rail" className="related-news-card">
            <div className="card-heading-row">
              <h2>Related News</h2>
              <Link href="/news">View all</Link>
            </div>
            <div className={detailStyles.newsList}>
              {profile.relatedNews.slice(0, 4).map((story) => (
                <Link className={detailStyles.newsListItem} href="/news" key={story.title}>
                  <strong>{story.title}</strong>
                  <span>{story.source} - {story.age}</span>
                </Link>
              ))}
            </div>
          </AnalysisDetailCard>
        ) : null}

        {!isNasdaqCorporateAction ? (
          <AnalysisDetailCard kind="rail" className="alert-card">
            <span>Premium</span>
            <h2>Real-time alerts for this event type</h2>
            <p>Track similar high-impact stock news, source changes, and follow-up catalysts.</p>
            <button type="button">Upgrade to Premium</button>
          </AnalysisDetailCard>
        ) : null}

        <AnalysisDetailCard kind="rail" className="source-confidence-card">
          <h2>Source & Evidence</h2>
          <div className="source-confidence-top">
            <strong>{event.source}</strong>
            <span>{profile.sourceReleaseType}</span>
          </div>
          <MetricRow label="Source Type" value={profile.sourceType} />
          <MetricRow label="Issuer" value={profile.issuer} />
          <MetricRow label="Published" value={profile.publishedAt} />
          <MetricRow label="Verification" value={profile.verification} />
          <a className="source-original-link" href={profile.sourceUrl} target="_blank" rel="noreferrer">
            <span>View Original Source</span>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </AnalysisDetailCard></>}
      original={profile.fullTextHtml ? (
        <AnalysisDetailCard kind="original" className="full-text-card">
          <div className="card-heading-row">
            <div>
              <h2>Original Release Text</h2>
              <p>Full source text preserved for reader review. This section is not used for LLM analysis.</p>
            </div>
            <a href={profile.fullTextSourceUrl || profile.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          </div>
          <div
            className="full-text-content"
            dangerouslySetInnerHTML={{ __html: profile.fullTextHtml }}
          />
        </AnalysisDetailCard>
      ) : null}>
      {useDilutionOfferingTemplate ? (
        <NewsDilutionOfferingTemplate event={event} profile={profile} />
      ) : (
        <>
          <section className={`${detailStyles.chartSummaryGrid} ${detailStyles.chartSummaryGridSplit}`}>
            <AnalysisDetailCard kind="renderer"><PriceChartCard
              change={profile.change}
              changeAmount={profile.changeAmount}
              mobileCollapsible
              price={profile.price}
              series={profile.priceSeries}
              ticker={event.ticker}
              tone={event.signal}
            /></AnalysisDetailCard>

            <AnalysisDetailCard>
              <div className="card-heading-row">
                <h2>Quick Take</h2>
                <span>{profile.theme}</span>
              </div>
              <p>{profile.quickTake}</p>
              <div className={detailStyles.classification}>
                <span className={detailStyles.formLabel}>{eventBadge.label}</span>
                <span className={detailStyles.formLabel}>{event.impact} impact</span>
                <span className={detailStyles.formLabel}>{event.deliveryLevel}</span>
              </div>
            </AnalysisDetailCard>
          </section>

          {showBullBearCases ? (
            <section className={detailStyles.caseGrid}>
              <CaseList title="Positive" tone="bullish" items={profile.bullCase} />
              <CaseList title="Negative" tone="bearish" items={profile.bearCase} />
            </section>
          ) : null}

          <section className={detailStyles.analysisGrid}>
            <AnalysisCard title="Why It Matters" body={profile.whyItMatters} />
            <AnalysisDetailCard kind="copy">
              <h2>Summary</h2>
              <p>{profile.summary}</p>
            </AnalysisDetailCard>
          </section>

          <section className={detailStyles.analysisGrid}>
            <AnalysisList title="Key Evidence" items={profile.keyEvidence} />
            <AnalysisList title="What To Watch Next" numbered items={profile.watchNext} />
          </section>

          {!isNasdaqCorporateAction ? <AnalysisDetailCard kind="renderer"><SectorThemeContextPanel context={profile.context} ticker={event.ticker} /></AnalysisDetailCard> : null}
        </>
      )}
    </AnalysisDetailDocument>
  );
}

async function getNewsViewerState(
  userId: string | null,
  contentId: string,
  ticker: string,
) {
  const state = await getViewerContentState({
    userId,
    references: isUuid(contentId)
      ? [{ contentId, contentType: "news" as const }]
      : [],
    tickers: [ticker],
  });
  return {
    authenticated: state.authenticated,
    saved: state.savedKeys.has(savedContentKey("news", contentId)),
    watched: state.watchedTickers.has(ticker.trim().toUpperCase()),
  };
}

function isNasdaqCorporateActionDetail(event: FeedItem, profile: DetailProfile) {
  return (
    event.source === "Nasdaq Corporate Actions" ||
    profile.sourceType === "Exchange Corporate Action Alert" ||
    profile.sourceReleaseType === "Nasdaq Trader Alert"
  );
}

function shouldShowBullBearCases(event: FeedItem, profile: DetailProfile) {
  if (!isNasdaqCorporateActionDetail(event, profile)) return true;
  return ["listing_risk", "strategic_transaction", "dilution_risk", "financial_risk", "capital_return"].includes(event.eventType);
}

function NewsDilutionOfferingTemplate({ event, profile }: { event: FeedItem; profile: DetailProfile }) {
  const model = buildNewsDilutionOfferingModel(event, profile);

  return (
    <>
      <section className={`${detailStyles.chartSummaryGrid} ${detailStyles.chartSummaryGridSplit}`}>
        <AnalysisDetailCard kind="renderer"><PriceChartCard
          change={profile.change}
          changeAmount={profile.changeAmount}
          mobileCollapsible
          price={profile.price}
          series={profile.priceSeries}
          ticker={event.ticker}
          tone={event.signal}
        /></AnalysisDetailCard>

        <NewsDilutionSnapshotCard model={model} />
      </section>

      <AnalysisDetailCard kind="copy">
        <h2>Dilution Summary</h2>
        {model.summaryParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </AnalysisDetailCard>

      <AnalysisDetailCard kind="renderer"><NewsShareOverhangCard model={model} /></AnalysisDetailCard>

      <AnalysisDetailCard kind="renderer"><SectorThemeContextPanel context={profile.context} ticker={event.ticker} /></AnalysisDetailCard>
    </>
  );
}

function NewsDilutionSnapshotCard({ model }: { model: ReturnType<typeof buildNewsDilutionOfferingModel> }) {
  return (
    <AnalysisDetailCard kind="copy" className="dilution-investor-card dilution-snapshot-panel">
      <h2>Dilution Snapshot</h2>

      <div className="dilution-impact-metrics">
        {model.impactMetrics.map((metric) => (
          <DilutionMetric key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="dilution-warning-strip">
        <p>{model.investorTakeaway}</p>
      </div>
    </AnalysisDetailCard>
  );
}

function NewsShareOverhangCard({ model }: { model: ReturnType<typeof buildNewsDilutionOfferingModel> }) {
  return <DilutionShareOverhang model={model} />;
}

function DilutionMetric({ metric }: { metric: DilutionMetricItem }) {
  return (
    <div className={`dilution-metric${metric.emphasis ? " emphasis" : ""}${metric.tone ? ` ${metric.tone}` : ""}`}>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      {metric.note ? <em>{metric.note}</em> : null}
    </div>
  );
}

function shouldUseNewsDilutionOfferingTemplate(event: FeedItem, profile: DetailProfile) {
  if (event.eventType !== "dilution_risk" || !profile.offeringTerms) return false;

  const row = profile.offeringTerms;
  const metadata = toRecord(row.metadata);
  const originalTerms = toRecord(metadata?.original_offering_terms);
  const metrics = toRecord(metadata?.dilution_metrics) || toRecord(originalTerms?.dilution_metrics);
  const explicitSupplyValues = [
    readOfferingNumber(row, "total_potential_share_exposure", metrics, ["total_potential_share_exposure"]),
    readOfferingNumber(row, "total_potential_share_exposure", originalTerms, ["total_potential_share_exposure", "count"]),
    readOfferingNumber(row, "shares_offered", originalTerms, ["shares_offered", "count"]),
    readOfferingNumber(row, "common_shares_offered", originalTerms, ["common_shares", "count"]),
    readOfferingNumber(row, "prefunded_warrant_shares", originalTerms, ["prefunded_warrants", "shares", "count"]),
    readOfferingNumber(row, "common_warrant_shares", originalTerms, ["common_warrants", "shares", "count"]),
    readOfferingNumber(row, "convertible_share_exposure", originalTerms, ["convertible_securities", "share_exposure", "count"]),
    readOfferingNumber(row, "immediate_share_exposure", metrics, ["immediate_share_exposure"]),
  ];

  return explicitSupplyValues.some((value) => value > 0);
}

function buildNewsDilutionOfferingModel(event: FeedItem, profile: DetailProfile) {
  const row = profile.offeringTerms || {};
  const metadata = toRecord(row.metadata);
  const originalTerms = toRecord(metadata?.original_offering_terms);
  const metrics = toRecord(metadata?.dilution_metrics) || toRecord(originalTerms?.dilution_metrics);
  const offeringTypeValue = readRowString(row, "offering_type") || readRowString(originalTerms, "offering_type");
  const securityTypeValue = readRowString(row, "security_type") || readRowString(originalTerms, "security_type");
  const rawOfferingType = readRowString(metadata, "raw_offering_type") || readRowString(originalTerms, "offering_type");
  const normalizedOfferingType = normalizeDisplayToken(offeringTypeValue);
  const normalizedSecurityType = normalizeDisplayToken(securityTypeValue);
  const dealLabel = formatOfferingDealLabel({
    offeringType: offeringTypeValue,
    rawOfferingType,
    securityType: securityTypeValue,
  });
  const primaryOrResale = readRowString(row, "primary_or_resale") || readRowString(originalTerms, "primary_or_resale");
  const isResale = primaryOrResale === "resale";
  const offeringAmount = readOfferingNumber(row, "offering_amount", originalTerms, ["offering_amount", "amount"]);
  const offeringPrice = readOfferingNumber(row, "offering_price", originalTerms, ["offering_price", "price"]);
  const marketReferencePrice =
    readOfferingNumber(row, "market_reference_price", metrics, ["market_reference_price"]) ||
    readOfferingNumber(row, "market_reference_price", originalTerms, ["market_context_used", "price"]);
  const currentShares =
    readOfferingNumber(row, "shares_outstanding_market", metrics, ["shares_outstanding_market"]) ||
    readOfferingNumber(row, "current_shares_outstanding", originalTerms, ["market_context_used", "shares_outstanding"]);
  const publicFloat = readOfferingNumber(row, "public_float_market", metrics, ["public_float_market"]);
  const marketCap = readOfferingNumber(row, "market_cap", metrics, ["market_cap"]);
  const commonShares =
    readOfferingNumber(row, "common_shares_offered", originalTerms, ["common_shares", "count"]) ||
    readOfferingNumber(row, "shares_offered", originalTerms, ["shares_offered", "count"]);
  const prefundedWarrantShares = readOfferingNumber(
    row,
    "prefunded_warrant_shares",
    originalTerms,
    ["prefunded_warrants", "shares", "count"],
  );
  const commonWarrantShares = readOfferingNumber(
    row,
    "common_warrant_shares",
    originalTerms,
    ["common_warrants", "shares", "count"],
  );
  const convertibleShareExposure = readOfferingNumber(
    row,
    "convertible_share_exposure",
    originalTerms,
    ["convertible_securities", "share_exposure", "count"],
  );
  const convertiblePrincipalAmount = readOfferingNumber(
    row,
    "convertible_principal_amount",
    originalTerms,
    ["convertible_securities", "principal_amount", "amount"],
  );
  const conversionPrice = readOfferingNumber(
    row,
    "conversion_price",
    originalTerms,
    ["convertible_securities", "conversion_price", "price"],
  );
  const immediateShareExposure =
    readOfferingNumber(row, "immediate_share_exposure", metrics, ["immediate_share_exposure"]);
  const totalPotentialShareExposure =
    readOfferingNumber(row, "total_potential_share_exposure", metrics, ["total_potential_share_exposure"]);
  const immediateDilutionPercent =
    readOfferingNumber(row, "estimated_dilution_percent", metrics, ["estimated_dilution_percent"]) ||
    ratioPercent(immediateShareExposure, currentShares);
  const totalPotentialDilutionPercent =
    readOfferingNumber(row, "total_potential_dilution_percent", metrics, ["total_potential_dilution_percent"]) ||
    readOfferingNumber(row, "max_share_impact_percent", metrics, ["max_share_impact_percent"]) ||
    ratioPercent(totalPotentialShareExposure, currentShares);
  const totalPotentialFloatPercent =
    readOfferingNumber(row, "total_potential_float_overhang_percent", metrics, ["total_potential_float_overhang_percent"]) ||
    readOfferingNumber(row, "float_overhang_percent", metrics, ["float_overhang_percent"]) ||
    ratioPercent(totalPotentialShareExposure, publicFloat);
  const discountToMarketPercent =
    readOfferingNumber(row, "discount_to_market_percent", metrics, ["discount_to_market_percent"]) ||
    (offeringPrice && marketReferencePrice ? ((marketReferencePrice - offeringPrice) / marketReferencePrice) * 100 : 0);
  const canCalculatePotentialSupply = Boolean(totalPotentialShareExposure && currentShares);
  const overhangLevel = canCalculatePotentialSupply
    ? formatRiskLabel(readRowString(row, "dilution_scale") || readRowString(metrics, "dilution_scale"))
    : "NEEDS REVIEW";
  const currentSharesCompact = formatCompactShareCount(currentShares) || "Not disclosed";
  const potentialSupplyCompact = formatCompactShareCount(totalPotentialShareExposure) || "Not disclosed";
  const immediateExposureCompact = formatCompactShareCount(immediateShareExposure) || "Not disclosed";
  const dilutionRatioPercentValue = canCalculatePotentialSupply ? formatPercentCompact(totalPotentialDilutionPercent) || "N/A" : "N/A";
  const dilutionRatioValue = dilutionRatioPercentValue || "N/A";
  const sourceConfidence = readRowString(metadata, "source_confidence") || "medium";
  const sourceNote = `Preliminary news terms - ${sourceConfidence} confidence`;
  const offeringDisplayMode = getNewsOfferingDisplayMode({
    convertiblePrincipalAmount,
    convertibleShareExposure,
    normalizedOfferingType,
    normalizedSecurityType,
    searchText: buildOfferingSearchText(event.title, profile.summary, profile.keyEvidence, profile.watchNext, metadata, originalTerms),
  });
  const displayCopy = buildNewsOfferingDisplayCopy(offeringDisplayMode);
  const commonShareLabel = isResale ? "Resale shares" : "Common shares";
  const components = [
    { label: commonShareLabel, value: commonShares, className: isResale ? "registered-supply" : "common" },
    { label: "Pre-funded warrants", value: prefundedWarrantShares, className: "prefunded" },
    { label: "Warrants", value: commonWarrantShares, className: "warrant" },
    { label: offeringDisplayMode === "convertible" ? "Conversion shares" : "Convertibles", value: convertibleShareExposure, className: "conversion" },
  ].filter((segment) => segment.value > 0);
  const componentRatios = components.map((segment) => ratioPercent(segment.value, currentShares));
  const supplyComponentTotal = components.reduce((total, segment) => total + segment.value, 0);
  const displayedPotentialSupply = totalPotentialShareExposure;
  const supplyScaleBase = displayedPotentialSupply || supplyComponentTotal;
  const additiveScaleBaseShares =
    currentShares && supplyScaleBase
      ? currentShares + supplyScaleBase
      : Math.max(currentShares || 0, supplyScaleBase || 0);
  const currentSharesBarWidth = scaleShareAmount(currentShares, additiveScaleBaseShares);
  const supplyBarWidth = scaleShareAmount(displayedPotentialSupply, additiveScaleBaseShares);
  const supplyComponentSegments = components.map((segment, index) => {
    const width = scaleShareAmount(segment.value, additiveScaleBaseShares);
    const ratio = componentRatios[index] || 0;
    return {
      key: `news-supply-${index}`,
      className: segment.className,
      label: segment.label,
      value: formatCompactShareCount(segment.value) || "N/A",
      note: currentShares ? `${formatPercentCompact(ratio) || "N/A"} of current shares` : "Potential",
      width,
      compact: width < 24,
    };
  });
  const fallbackSupplyClassName =
    offeringDisplayMode === "convertible" ? "conversion" : isResale ? "registered-supply" : "common";
  const overhangBarSegmentCandidates: Array<DilutionShareOverhangBarSegment | null> = [
    currentShares
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
    displayedPotentialSupply && !supplyComponentSegments.length
      ? {
          key: "news-total-supply",
          className: fallbackSupplyClassName,
          label: displayCopy.potentialSupplyLabel,
          value: potentialSupplyCompact,
          note: currentShares ? `${dilutionRatioValue} of current shares` : "Potential",
          width: supplyBarWidth,
          compact: supplyBarWidth < 24,
        }
      : null,
  ];
  const overhangBarSegments = overhangBarSegmentCandidates.filter(
    (segment): segment is DilutionShareOverhangBarSegment => Boolean(segment && segment.width > 0),
  );
  const overhangBreakdownRows: DilutionShareOverhangBreakdownRow[] = components.map((segment, index) => ({
    key: `news-breakdown-${index}`,
    className: segment.className,
    label: segment.label,
    value: formatCompactShareCount(segment.value) || "N/A",
    ratio: formatPercentCompact(componentRatios[index] || 0) || "N/A",
  }));
  if (!overhangBreakdownRows.length && displayedPotentialSupply) {
    overhangBreakdownRows.push({
      key: "news-breakdown-total",
      className: fallbackSupplyClassName,
      label: displayCopy.potentialSupplyLabel,
      value: potentialSupplyCompact,
      ratio: dilutionRatioPercentValue,
    });
  }
  const companyCash = isResale ? "$0 from resale" : formatMoneyNumber(offeringAmount) || "Not disclosed";
  const priceComparison = formatPriceComparison({
    discountToMarketPercent,
    marketReferencePrice,
    offeringPrice,
  });
  const primaryExposureCompact =
    offeringDisplayMode === "convertible"
      ? formatMoneyNumber(convertiblePrincipalAmount) || "Not disclosed"
      : immediateExposureCompact;
  const priceSentence = buildNewsOfferingPriceSentence({
    conversionPrice,
    marketReferencePrice,
    offeringDisplayMode,
    offeringPrice,
    priceComparison,
  });
  const impactMetrics: DilutionMetricItem[] = [
    {
      label: "Current shares",
      value: currentSharesCompact,
      note: "Market-context share count.",
      tone: "neutral",
    },
    {
      label: displayCopy.potentialSupplyLabel,
      value: potentialSupplyCompact,
      note: formatSupplyMixSummary(components),
      emphasis: true,
      tone: totalPotentialDilutionPercent >= 25 ? "danger" : "neutral",
    },
    {
      label: displayCopy.ratioLabel,
      value: dilutionRatioValue || "Not disclosed",
      note: displayCopy.ratioNote,
      emphasis: true,
      tone: totalPotentialDilutionPercent >= 25 ? "danger" : "neutral",
    },
    {
      label: offeringDisplayMode === "convertible" ? "Convertible principal" : "Company cash",
      value: offeringDisplayMode === "convertible" ? primaryExposureCompact : companyCash,
      note: buildCompanyCashNote({ isResale, offeringDisplayMode }),
      tone: "neutral",
    },
  ];
  const summaryParagraphs = [
    profile.summary,
    [
      dealLabel ? `${event.ticker} ${dealLabel}.` : "",
      buildExposureSummarySentence({
        convertiblePrincipalAmount,
        immediateExposureCompact,
        offeringDisplayMode,
        potentialSupplyCompact,
      }),
      priceSentence,
    ].filter(Boolean).join(" "),
    [
      `Share overhang uses ${currentSharesCompact} as the base.`,
      totalPotentialFloatPercent ? `${displayCopy.floatExposureLabel} equals ${formatPercentCompact(totalPotentialFloatPercent)} of public float.` : "",
      profile.watchNext[0] || "Watch for closing, warrant exercise, and follow-up filing details.",
    ].filter(Boolean).join(" "),
  ].filter(Boolean);
  const investorTakeaway =
    profile.whyItMatters ||
    "This financing can improve liquidity, but potential share supply may create dilution and selling-pressure risk.";

  return {
    canRenderOverhangChart: canCalculatePotentialSupply,
    currentSharesCompact,
    dilutionRatioPercentValue,
    dilutionRatioValue,
    immediateExposureCompact,
    impactMetrics,
    investorTakeaway,
    followupNote: displayCopy.followupNote,
    overhangLevel,
    overhangAriaLabel: canCalculatePotentialSupply
      ? `${displayCopy.potentialSupplyLabel} equals ${dilutionRatioValue} of current shares`
      : `${displayCopy.potentialSupplyLabel} is not calculable from disclosed terms`,
    overhangBarSegments,
    overhangBreakdownRows,
    overhangScoreNote: displayCopy.overhangScoreNote,
    overhangScoreCaption: displayCopy.overhangScoreNote,
    overhangSubtitle: displayCopy.overhangSubtitle,
    overhangNote: displayCopy.followupNote,
    overhangUnavailableMessage: `${displayCopy.potentialSupplyLabel} could not be calculated from disclosed share counts.`,
    potentialSupplyCompact,
    potentialSupplyLabel: displayCopy.potentialSupplyLabel,
    primaryExposureCompact,
    primaryExposureLabel: displayCopy.primaryExposureLabel,
    sourceNote,
    summaryParagraphs,
    supplyDetailLabel: displayCopy.potentialSupplyLabel,
  };
}

function getNewsOfferingDisplayMode({
  convertiblePrincipalAmount,
  convertibleShareExposure,
  normalizedOfferingType,
  normalizedSecurityType,
  searchText,
}: {
  convertiblePrincipalAmount: number;
  convertibleShareExposure: number;
  normalizedOfferingType: string;
  normalizedSecurityType: string;
  searchText: string;
}): NewsOfferingDisplayMode {
  const hasConvertible =
    normalizedOfferingType === "convertible_financing" ||
    normalizedSecurityType === "convertible_notes" ||
    convertiblePrincipalAmount > 0 ||
    convertibleShareExposure > 0;

  if (hasConvertible) return "convertible";

  if (
    /\bforward\s+(sale|basis|seller|settlement|contract|agreement|purchase)\b/.test(searchText) ||
    searchText.includes("physical settlement")
  ) {
    return "forward_sale";
  }

  return "standard";
}

function buildNewsOfferingDisplayCopy(mode: NewsOfferingDisplayMode) {
  if (mode === "convertible") {
    return {
      floatExposureLabel: "Estimated conversion exposure",
      followupNote: "News terms are preliminary. Confirm conversion price, capped-call terms, share exposure, and closing details in follow-up filings.",
      overhangScoreNote: "Estimated conversion exposure vs. current shares",
      overhangSubtitle: "Conversion overhang breakdown",
      potentialSupplyLabel: "Estimated conversion shares",
      primaryExposureLabel: "Convertible Principal",
      ratioLabel: "Conversion / current",
      ratioNote: "Estimated conversion shares vs. current shares.",
    };
  }

  if (mode === "forward_sale") {
    return {
      floatExposureLabel: "Potential settlement supply",
      followupNote: "Forward-sale terms are preliminary. Confirm settlement timing, final share count, and issuer proceeds in follow-up filings.",
      overhangScoreNote: "Potential settlement supply vs. current shares",
      overhangSubtitle: "Forward sale supply breakdown",
      potentialSupplyLabel: "Potential settlement supply",
      primaryExposureLabel: "Forward Sale Shares",
      ratioLabel: "Settlement / current",
      ratioNote: "Potential settlement shares vs. current shares.",
    };
  }

  return {
    floatExposureLabel: "Potential supply",
    followupNote: "News terms are preliminary. Confirm final share counts, warrant exercise terms, and closing details in follow-up filings.",
    overhangScoreNote: "Total potential dilution vs. current shares",
    overhangSubtitle: "Potential supply breakdown",
    potentialSupplyLabel: "Potential supply",
    primaryExposureLabel: "Immediate Share Exposure",
    ratioLabel: "Supply / current",
    ratioNote: "Total potential exposure vs. current shares.",
  };
}

function buildExposureSummarySentence({
  convertiblePrincipalAmount,
  immediateExposureCompact,
  offeringDisplayMode,
  potentialSupplyCompact,
}: {
  convertiblePrincipalAmount: number;
  immediateExposureCompact: string;
  offeringDisplayMode: NewsOfferingDisplayMode;
  potentialSupplyCompact: string;
}) {
  if (offeringDisplayMode === "convertible") {
    return [
      `Convertible principal is ${formatMoneyNumber(convertiblePrincipalAmount) || "Not disclosed"}.`,
      `Estimated conversion exposure is ${potentialSupplyCompact}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (offeringDisplayMode === "forward_sale") {
    return `Forward sale share exposure is ${immediateExposureCompact}; potential settlement supply is ${potentialSupplyCompact}.`;
  }

  return `Immediate exposure is ${immediateExposureCompact}; total potential supply is ${potentialSupplyCompact}.`;
}

function buildNewsOfferingPriceSentence({
  conversionPrice,
  marketReferencePrice,
  offeringDisplayMode,
  offeringPrice,
  priceComparison,
}: {
  conversionPrice: number;
  marketReferencePrice: number;
  offeringDisplayMode: NewsOfferingDisplayMode;
  offeringPrice: number;
  priceComparison: string;
}) {
  if (offeringDisplayMode === "convertible") {
    if (!conversionPrice && !marketReferencePrice) return "";
    const context = [
      conversionPrice ? `conversion ${formatPriceNumber(conversionPrice)}` : "",
      marketReferencePrice ? `market ${formatPriceNumber(marketReferencePrice)}` : "",
    ].filter(Boolean);
    return `Conversion context: ${context.join(" / ")}.`;
  }

  if (!offeringPrice || !priceComparison) return "";
  return `Pricing comparison: ${priceComparison}.`;
}

function buildCompanyCashNote({
  isResale,
  offeringDisplayMode,
}: {
  isResale: boolean;
  offeringDisplayMode: NewsOfferingDisplayMode;
}) {
  if (offeringDisplayMode === "convertible") return "Principal amount from the news terms.";
  if (offeringDisplayMode === "forward_sale") return "Forward-sale proceeds depend on settlement.";
  if (isResale) return "Resale proceeds do not go to the issuer.";
  return "Gross proceeds from the news terms.";
}

function buildOfferingSearchText(...values: unknown[]) {
  return values
    .map((value) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    })
    .join(" ")
    .toLowerCase();
}

function buildFallbackProfile(event: FeedItem): DetailProfile {
  return {
    company: `${event.ticker} Corporation`,
    exchange: getExchange(event.ticker),
    price: event.price,
    changeAmount: event.change.startsWith("-") ? "-$0.46" : "$0.14",
    change: event.change,
    detectedAt: `May 13, 2026 ${event.time} ET`,
    confidence: event.impact === "high" ? "High" : "Medium",
    credibility: "Medium",
    historicalAccuracy: "88%",
    articleReliability: "Medium",
    sourceUrl: getSourceUrl(event.source),
    sourceReleaseType: event.source === "SEC" ? "Official Filing" : "Official Release",
    sourceType: event.source === "SEC" ? "SEC Filing" : "Company Press Release",
    issuer: event.ticker,
    publishedAt: `May 13, 2026 · ${event.time} ET`,
    verification: "Original source linked",
    theme: "Company News",
    quickTake: event.summary,
    whyItMatters: event.scoreReason,
    bullCase: [
      "The event gives investors a fresh company-specific signal.",
      "Follow-up disclosures may improve visibility.",
      "The headline can attract short-term trading attention.",
    ],
    bearCase: [
      "The announcement may not be material enough to change estimates.",
      "Market reaction can fade without additional detail.",
      "Execution risk remains until management provides proof points.",
    ],
    summary: event.summary,
    keyEvidence: [
      "Source headline and summary were parsed from the event feed.",
      "Event type and impact score are shown as normalized feed fields.",
      "Detailed source extraction will be connected after the analysis table is finalized.",
    ],
    watchNext: [
      "Source updates or company follow-up statements.",
      "Price and volume reaction across the next session.",
      "Related filings, guidance, or analyst commentary.",
    ],
    relatedTickers: [
      { symbol: "SPY", name: "S&P 500 ETF", price: "$529.12", change: "+0.42%", tone: "bullish" },
      { symbol: "QQQ", name: "Nasdaq 100 ETF", price: "$451.30", change: "+0.68%", tone: "bullish" },
      { symbol: "IWM", name: "Russell 2000 ETF", price: "$205.10", change: "-0.11%", tone: "bearish" },
    ],
    relatedNews: [
      { title: "Company-specific catalysts remain active across the live feed", source: "Stock Radar", age: "1h ago" },
      { title: "High impact stock news list updates with new source items", source: "Stock Radar", age: "2h ago" },
      { title: "Watchlist alerts will use this event type after filter wiring", source: "Stock Radar", age: "4h ago" },
      { title: "Related company updates are grouped for detail-page context", source: "Stock Radar", age: "6h ago" },
    ],
    recentFilings: [
      {
        form: "8-K",
        eventType: "Product Update",
        title: "Recent corporate update filed",
        filedAt: "May 12",
        score: 62,
      },
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "Latest quarterly report",
        filedAt: "May 8",
        score: 58,
      },
      {
        form: "4",
        eventType: "Insider / Ownership",
        title: "Recent insider transaction filing",
        filedAt: "May 3",
        score: 45,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Recent proxy statement filing",
        filedAt: "Apr 29",
        score: 38,
      },
    ],
    context: {
      sector: "Technology",
      industry: "Company Watchlist",
      periods: {
        "1D": {
          sectorChange: "+0.62%",
          industryChange: "+0.44%",
          themeScore: event.score,
          themeSignal: event.signal,
          topMovers: [
            { symbol: event.ticker, change: event.change, trend: event.trend },
            { symbol: "SPY", change: "+0.42%", trend: [41, 42, 43, 42, 44, 45, 46, 47, 48, 49] },
            { symbol: "QQQ", change: "+0.68%", trend: [38, 40, 41, 43, 42, 45, 47, 46, 49, 51] },
          ],
        },
        "5D": {
          sectorChange: "+1.90%",
          industryChange: "+1.28%",
          themeScore: Math.min(event.score + 2, 99),
          themeSignal: event.signal,
          topMovers: [
            { symbol: event.ticker, change: "+3.18%", trend: [31, 32, 34, 33, 36, 38, 37, 40, 42, 44] },
            { symbol: "SPY", change: "+1.24%", trend: [38, 39, 40, 41, 40, 42, 43, 44, 45, 46] },
            { symbol: "QQQ", change: "+2.08%", trend: [34, 36, 35, 38, 40, 41, 43, 42, 45, 47] },
          ],
        },
        "30D": {
          sectorChange: "+4.85%",
          industryChange: "+3.60%",
          themeScore: Math.min(event.score + 4, 99),
          themeSignal: event.signal,
          topMovers: [
            { symbol: event.ticker, change: "+7.42%", trend: [25, 26, 29, 31, 30, 34, 37, 39, 42, 45] },
            { symbol: "SPY", change: "+3.70%", trend: [32, 33, 35, 36, 38, 37, 40, 42, 43, 45] },
            { symbol: "QQQ", change: "+5.18%", trend: [28, 30, 32, 35, 34, 38, 41, 43, 46, 49] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: parsePrice(event.price),
      previousClose: estimatePreviousClose(parsePrice(event.price), event.change),
      trend: event.trend,
      volumeBase: 3_800_000,
    }),
  };
}

async function attachGlobeFullText(profile: DetailProfile, sourceUrl: string): Promise<DetailProfile> {
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "US-Stock-Radar/0.1 detail full text preview",
      },
    });

    if (!response.ok) {
      return profile;
    }

    const html = await response.text();
    const article = parseGlobeNewswireArticleHtml(html, sourceUrl);

    return {
      ...profile,
      fullTextHtml: article.bodyHtml,
      fullTextSourceUrl: article.url || sourceUrl,
      sourceUrl: article.url || profile.sourceUrl,
    };
  } catch {
    return profile;
  }
}

function sanitizeDetailProfileFullText(profile: DetailProfile): DetailProfile {
  if (!profile.fullTextHtml) return profile;

  return {
    ...profile,
    fullTextHtml: sanitizeNewsArticleHtml(
      profile.fullTextHtml,
      profile.fullTextSourceUrl || profile.sourceUrl,
    ),
  };
}

function isGlobeNewswireUrl(value: string) {
  return /(^|\/\/)(www\.)?globenewswire\.com\//i.test(value);
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

async function attachTickerMarketCap(profile: DetailProfile, ticker: string): Promise<DetailProfile> {
  if (!isRealTicker(ticker) || profile.context.marketCap || profile.context.themeGroup || profile.context.subTheme) {
    return profile;
  }

  const marketCap = await fetchTickerMarketCap(ticker);
  if (!marketCap) {
    return profile;
  }

  return {
    ...profile,
    context: {
      ...profile.context,
      marketCap,
    },
  };
}

async function fetchTickerMarketCap(ticker: string) {
  const symbol = ticker.trim().toUpperCase();
  const cached = await supabaseSelect("tickers", {
    select: "symbol,market_cap",
    symbol: `eq.${symbol}`,
    limit: "1",
  });
  const cachedRow = toRows(cached.data)[0] || null;
  const cachedMarketCap = readRowNumber(cachedRow, "market_cap");
  if (cachedMarketCap > 0) {
    return formatMarketCap(cachedMarketCap);
  }

  const profileResult = await fetchFmpProfile(symbol);
  const profileRow = toRows(profileResult.data)[0] || toRecord(profileResult.data);
  const liveMarketCap =
    readRowNumber(profileRow, "marketCap") ||
    readRowNumber(profileRow, "mktCap") ||
    readRowNumber(profileRow, "market capitalization");

  return liveMarketCap > 0 ? formatMarketCap(liveMarketCap) : "";
}

function toDetailEvent(item: LiveFeedItem): FeedItem {
  return {
    id: item.id,
    time: item.time,
    ticker: item.ticker,
    price: item.price,
    change: item.change,
    sourceGroup: item.sourceGroup,
    source: item.source,
    eventType: item.eventType,
    title: item.title,
    summary: item.quickTake || item.summary,
    scoreReason: item.scoreReason,
    score: item.score,
    deliveryLevel: item.deliveryLevel,
    impact: item.impact,
    signal: item.signal,
    trend: item.trend,
  };
}

async function buildDbBackedProfile(item: LiveFeedItem, event: FeedItem): Promise<DetailProfile> {
  const fallback = detailProfiles[item.ticker] || buildFallbackProfile(event);
  const ticker = item.ticker.trim().toUpperCase();
  const canLoadTickerContext = isRealTicker(ticker);
  const [analysisResult, tickersResult, rawItemResult, offeringTermsResult, aiOutputResult, relatedNewsResult, recentFilingsResult] = await Promise.all([
    fetchEventAnalysis(item.id),
    fetchEventTickers(item.id),
    fetchRawItem(item.rawItemId),
    fetchEventOfferingTerms(item.id),
    fetchEventAiOutputAnalysis(item.id),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "news", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
    canLoadTickerContext
      ? fetchEventsByTicker({ ticker, sourceGroup: "filings", excludeId: item.id, limit: 4 })
      : Promise.resolve({ ok: true, status: 200, data: [], error: undefined }),
  ]);
  const analysis = toRecord(analysisResult.data);
  const tickerRows = toRows(tickersResult.data);
  const relatedNews = mapRelatedNewsRows(toRows(relatedNewsResult.data));
  const recentFilings = mapRecentFilingRows(toRows(recentFilingsResult.data));
  const dbRelatedTickers = mapRelatedTickerRows(tickerRows, []);
  const relatedTickers = dbRelatedTickers.length ? dbRelatedTickers : fallback.relatedTickers;
  const context = await buildResolvedMarketContext({
    dbRelatedTickers,
    event,
    fallback: fallback.context,
    item,
  });
  const publishedLabel = formatDetailDateTime(item.detectedAtRaw, `${item.time} ET`);
  const rawItem = toRecord(rawItemResult.data);
  const offeringTerms =
    toRecord(offeringTermsResult.data) ||
    buildOfferingTermsRowFromAiAnalysis(toRecord(aiOutputResult.data));
  const sourceUrl = item.sourceUrl || readRowString(rawItem, "source_url") || fallback.sourceUrl;
  const fullTextHtml = buildRawItemFullTextHtml(rawItem);
  const sourceEvidence = resolveSourceEvidence({
    fallback,
    item,
    rawItem,
    ticker,
  });

  return {
    ...fallback,
    company: sourceEvidence.issuer || fallback.company,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    priceSeries: buildDbBackedPriceSeries(item),
    detectedAt: publishedLabel,
    confidence: item.impact === "high" ? "High" : item.impact === "medium" ? "Medium" : "Low",
    identityChips: buildDetailIdentityChips(item, ticker, sourceEvidence, fallback),
    sourceReleaseType: sourceEvidence.sourceReleaseType,
    sourceType: sourceEvidence.sourceType,
    sourceUrl,
    issuer: sourceEvidence.issuer,
    publishedAt: publishedLabel,
    theme: getEventTypeBadge(item.eventType).label || fallback.theme,
    quickTake: item.quickTake || item.summary || fallback.quickTake,
    whyItMatters: readRowString(analysis, "why_it_matters") || item.scoreReason || fallback.whyItMatters,
    bullCase: toStringArray(analysis?.bullish_points, fallback.bullCase),
    bearCase: toStringArray(analysis?.bearish_points, fallback.bearCase),
    summary: item.summary || fallback.summary,
    keyEvidence: toStringArray(analysis?.key_evidence, fallback.keyEvidence),
    watchNext: toStringArray(analysis?.watch_next, fallback.watchNext),
    relatedTickers,
    relatedNews: relatedNews.length ? relatedNews : fallback.relatedNews,
    recentFilings: recentFilings.length ? recentFilings : fallback.recentFilings,
    context,
    fullTextHtml: fullTextHtml || fallback.fullTextHtml,
    fullTextSourceUrl: sourceUrl,
    offeringTerms: offeringTerms || fallback.offeringTerms || null,
  };
}

function buildDbBackedPriceSeries(item: LiveFeedItem): PriceChartSeries {
  const chartBars = item.displayChartBars.length ? item.displayChartBars : item.chartBars;
  const barSeries = buildPriceSeriesFromBars(chartBars);
  if (barSeries) return barSeries;

  return emptyPriceSeries();
}

function buildPriceSeriesFromBars(bars: LiveFeedItem["chartBars"]): PriceChartSeries | null {
  const points = bars
    .map((bar) => ({
      close: Number(bar.close),
      high: Number(bar.high),
      low: Number(bar.low),
      open: Number(bar.open),
      time: bar.date,
      volume: Number(bar.volume) || 0,
      vwap: Number(bar.close),
    }))
    .filter((point) =>
      point.time &&
      Number.isFinite(point.close) &&
      Number.isFinite(point.high) &&
      Number.isFinite(point.low) &&
      Number.isFinite(point.open),
    );

  if (!points.length) return null;
  const previousClose = points[0]?.open || points[0]?.close || 0;

  return {
    previousClose,
    periods: {
      "1D": points,
      "5D": points,
      "1M": points,
      "3M": points,
      "1Y": points,
    },
  };
}

function emptyPriceSeries(): PriceChartSeries {
  return {
    previousClose: 0,
    periods: {
      "1D": [],
      "5D": [],
      "1M": [],
      "3M": [],
      "1Y": [],
    },
  };
}

function getDetailIdentityChips(event: FeedItem, profile: DetailProfile) {
  const profileChips = profile.identityChips?.filter((chip) => chip && !/\bN\/A\b/i.test(chip)) || [];
  const chips = profileChips.length ? profileChips : [`${profile.exchange}:${event.ticker}`, profile.company];

  return chips.filter((chip) => chip && !/\bN\/A\b/i.test(chip));
}

function buildDetailIdentityChips(
  item: LiveFeedItem,
  ticker: string,
  sourceEvidence: SourceEvidence,
  fallback: DetailProfile,
) {
  if (item.marketScope === "company" && isRealTicker(ticker)) {
    const companyName =
      sourceEvidence.sourceType === "Exchange Corporate Action Alert"
        ? sourceEvidence.issuer
        : fallback.company;
    return [`${fallback.exchange || getExchange(ticker)}:${ticker}`, companyName || `${ticker} Corporation`];
  }

  return [sourceEvidence.issuer || item.source, ...buildClassificationIdentityChips(item)].filter(Boolean);
}

type SourceEvidence = {
  issuer: string;
  sourceReleaseType: string;
  sourceType: string;
};

function resolveSourceEvidence({
  fallback,
  item,
  rawItem,
  ticker,
}: {
  fallback: DetailProfile;
  item: LiveFeedItem;
  rawItem: Record<string, unknown> | null;
  ticker: string;
}): SourceEvidence {
  const rawPayload = toRecord(rawItem?.raw_payload);
  const rawSourceName = readRowString(rawPayload, "source_name");
  const sourceLabel = formatSourceLabel(item.source || rawSourceName);

  if (item.sourceGroup === "filings") {
    return {
      issuer: ticker || fallback.issuer,
      sourceReleaseType: "Official Filing",
      sourceType: "SEC Filing",
    };
  }

  if (sourceLabel === "Nasdaq Corporate Actions") {
    const corporateAction = toRecord(rawPayload?.corporate_action);
    const companyName = cleanCorporateActionIssuer(readRowString(corporateAction, "company_name"));
    return {
      issuer: companyName || ticker || fallback.issuer,
      sourceReleaseType: "Nasdaq Trader Alert",
      sourceType: "Exchange Corporate Action Alert",
    };
  }

  if (sourceLabel === "Nasdaq Trader") {
    const tradeHalt = toRecord(rawPayload?.trade_halt);
    return {
      issuer: readRowString(tradeHalt, "issueName") || ticker || fallback.issuer,
      sourceReleaseType: "Nasdaq Trading Halt Notice",
      sourceType: "Exchange Trading Halt Notice",
    };
  }

  if (isGovernmentSource(sourceLabel)) {
    return {
      issuer: sourceLabel,
      sourceReleaseType: "Official Release",
      sourceType: "Government Release",
    };
  }

  if (item.marketScope !== "company" || !isRealTicker(ticker)) {
    return {
      issuer: rawSourceName || sourceLabel || fallback.issuer,
      sourceReleaseType: "Official Release",
      sourceType: "Market News Release",
    };
  }

  return {
    issuer: ticker || fallback.issuer,
    sourceReleaseType: "Official Release",
    sourceType: "Company Press Release",
  };
}

function buildClassificationIdentityChips(item: LiveFeedItem) {
  const sector = cleanContextValue(item.sector);
  const industry = cleanContextValue(item.industryGroup, { rejectGenericIndustry: true });
  const themeGroup = formatThemeGroupChip(item.themeGroup);
  const subTheme = formatSubThemeChip(item.subTheme);

  if (item.marketScope === "theme") {
    return uniqueChipLabels([themeGroup, subTheme, industry, sector]).slice(0, 2);
  }

  if (item.marketScope === "sector") {
    return uniqueChipLabels([sector, industry]).slice(0, 2);
  }

  if (item.marketScope === "macro") {
    return uniqueChipLabels([themeGroup, subTheme, sector, industry, "Macro / Policy"]).slice(0, 2);
  }

  return uniqueChipLabels([themeGroup, subTheme, sector, industry]).slice(0, 2);
}

function formatThemeGroupChip(value?: string) {
  const cleaned = cleanContextValue(value);
  if (!cleaned) return "";
  const normalized = normalizeGroupLabel(cleaned);
  return themeGroups.find((theme) => normalizeGroupLabel(theme.slug) === normalized || normalizeGroupLabel(theme.name) === normalized)?.name || humanizeContextLabel(cleaned);
}

function formatSubThemeChip(value?: string) {
  const cleaned = cleanContextValue(value);
  if (!cleaned) return "";
  const normalized = normalizeGroupLabel(cleaned);
  return themeSubThemes.find((theme) => normalizeGroupLabel(theme.slug) === normalized || normalizeGroupLabel(theme.name) === normalized)?.name || humanizeContextLabel(cleaned);
}

function humanizeContextLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bIpo\b/g, "IPO")
    .replace(/\bSpac\b/g, "SPAC")
    .replace(/\bFda\b/g, "FDA")
    .replace(/\bOfac\b/g, "OFAC")
    .replace(/\bDoj\b/g, "DOJ")
    .replace(/\bDea\b/g, "DEA");
}

function uniqueChipLabels(values: string[]) {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of values) {
    const label = value.trim();
    const key = normalizeGroupLabel(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  return labels;
}

function cleanCorporateActionIssuer(value: string) {
  return value
    .replace(/\s+(?:Class\s+[A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares|American Depositary Shares)$/i, "")
    .replace(/\s+(?:Rights?|Units?|Warrants?)$/i, "")
    .replace(/\s+\d+(?:\.\d+)?%\s+.*$/i, "")
    .replace(/\s+(?:Fixed\s*-\s*Rate\s+Reset\s+)?Series\s+[A-Z]\s+.*$/i, "")
    .replace(/\s+(?:Cumulative\s+)?(?:Perpetual\s+)?Redeemable\s+Preferred\s+Shares?$/i, "")
    .replace(/\s+Notes?\s+due\s+\d{4}$/i, "")
    .trim();
}

function isGovernmentSource(value: string) {
  return /^(OFAC|DOJ|DEA|White House)$/i.test(value.trim());
}

type ContextSnapshotMap = Record<ContextRange, MarketGroupSnapshotPayload[]>;
type MarketQuoteMover = {
  changePercent: number;
  symbol: string;
};

let contextSnapshotCache:
  | {
      expiresAt: number;
      snapshots: ContextSnapshotMap;
    }
  | undefined;
let marketTopMoverCache:
  | {
      expiresAt: number;
      movers: MarketQuoteMover[];
    }
  | undefined;

async function buildResolvedMarketContext({
  dbRelatedTickers,
  event,
  fallback,
  item,
}: {
  dbRelatedTickers: RelatedTicker[];
  event: FeedItem;
  fallback: SectorThemeContext;
  item: LiveFeedItem;
}): Promise<SectorThemeContext> {
  const sector = cleanContextValue(item.sector) || cleanContextValue(fallback.sector);
  const industry =
    cleanContextValue(item.industryGroup) ||
    cleanContextValue(fallback.industry, { rejectGenericIndustry: true });
  const themeGroup = cleanContextValue(item.themeGroup) || cleanContextValue(fallback.themeGroup);
  const subTheme = cleanContextValue(item.subTheme) || cleanContextValue(fallback.subTheme);
  const primaryTicker = isRealTicker(event.ticker) ? event.ticker.toUpperCase() : "";
  const relatedSymbols = dbRelatedTickers.map((ticker) => ticker.symbol).filter(isRealTicker);
  const [snapshots, marketTopMovers] = await Promise.all([
    readContextSnapshots(),
    readMarketQuoteTopMovers(),
  ]);
  const moverMode = resolveMoverMode({ industry, relatedSymbols, snapshots, subTheme });
  const moverGroupName = resolveMoverGroupName({ industry, moverMode, subTheme });
  const periods = buildResolvedContextPeriods({
    event,
    fallback,
    industry,
    marketTopMovers,
    moverMode,
    primaryTicker,
    relatedSymbols,
    sector,
    snapshots,
    subTheme,
    themeGroup,
  });

  return {
    ...fallback,
    contextTitle: primaryTicker || subTheme || themeGroup || industry || sector || "Market",
    industry,
    moverGroupName,
    moverMode,
    periods,
    sector,
    ...(themeGroup ? { themeGroup } : { themeGroup: undefined }),
    ...(subTheme ? { subTheme } : { subTheme: undefined }),
  };
}

async function readContextSnapshots(): Promise<ContextSnapshotMap> {
  const now = Date.now();
  if (contextSnapshotCache && contextSnapshotCache.expiresAt > now) {
    return contextSnapshotCache.snapshots;
  }

  const [oneDay, fiveDay, thirtyDay] = await Promise.all([
    readMarketGroupSnapshotCache("1D"),
    readMarketGroupSnapshotCache("5D"),
    readMarketGroupSnapshotCache("1M"),
  ]);
  const snapshots = {
    "1D": oneDay.snapshots,
    "5D": fiveDay.snapshots,
    "30D": thirtyDay.snapshots,
  };

  contextSnapshotCache = {
    expiresAt: now + 30_000,
    snapshots,
  };
  return snapshots;
}

async function readMarketQuoteTopMovers(): Promise<MarketQuoteMover[]> {
  const now = Date.now();
  if (marketTopMoverCache && marketTopMoverCache.expiresAt > now) {
    return marketTopMoverCache.movers;
  }

  const result = await supabaseSelect("market_quotes", {
    select: "symbol,change_percent,expires_at",
    expires_at: `gt.${new Date().toISOString()}`,
    order: "change_percent.desc",
    limit: "8",
  });
  let movers = toRows(result.data)
    .map((row) => ({
      changePercent: readRowNumber(row, "change_percent"),
      symbol: readRowString(row, "symbol").toUpperCase(),
    }))
    .filter((mover) => isRealTicker(mover.symbol));

  if (!movers.length) {
    const barsResult = await supabaseSelect("market_bars", {
      select: "symbol,change_percent,expires_at",
      range: "eq.1D",
      interval: "eq.5min-ext",
      expires_at: `gt.${new Date().toISOString()}`,
      order: "change_percent.desc",
      limit: "8",
    });
    movers = toRows(barsResult.data)
      .map((row) => ({
        changePercent: readRowNumber(row, "change_percent"),
        symbol: readRowString(row, "symbol").toUpperCase(),
      }))
      .filter((mover) => isRealTicker(mover.symbol));
  }

  marketTopMoverCache = {
    expiresAt: now + 30_000,
    movers,
  };
  return movers;
}

function buildResolvedContextPeriods({
  event,
  fallback,
  industry,
  marketTopMovers,
  moverMode,
  primaryTicker,
  relatedSymbols,
  sector,
  snapshots,
  subTheme,
  themeGroup,
}: {
  event: FeedItem;
  fallback: SectorThemeContext;
  industry: string;
  marketTopMovers: MarketQuoteMover[];
  moverMode: SectorThemeContext["moverMode"];
  primaryTicker: string;
  relatedSymbols: string[];
  sector: string;
  snapshots: ContextSnapshotMap;
  subTheme: string;
  themeGroup: string;
}): SectorThemeContext["periods"] {
  return {
    "1D": buildResolvedContextPeriod({
      event,
      fallbackPeriod: fallback.periods["1D"],
      industry,
      marketTopMovers,
      moverMode,
      primaryTicker,
      range: "1D",
      relatedSymbols,
      sector,
      snapshots: snapshots["1D"],
      subTheme,
      themeGroup,
    }),
    "5D": buildResolvedContextPeriod({
      event,
      fallbackPeriod: fallback.periods["5D"],
      industry,
      marketTopMovers,
      moverMode,
      primaryTicker,
      range: "5D",
      relatedSymbols,
      sector,
      snapshots: snapshots["5D"],
      subTheme,
      themeGroup,
    }),
    "30D": buildResolvedContextPeriod({
      event,
      fallbackPeriod: fallback.periods["30D"],
      industry,
      marketTopMovers,
      moverMode,
      primaryTicker,
      range: "30D",
      relatedSymbols,
      sector,
      snapshots: snapshots["30D"],
      subTheme,
      themeGroup,
    }),
  };
}

function buildResolvedContextPeriod({
  event,
  fallbackPeriod,
  industry,
  marketTopMovers,
  moverMode,
  primaryTicker,
  range,
  relatedSymbols,
  sector,
  snapshots,
  subTheme,
  themeGroup,
}: {
  event: FeedItem;
  fallbackPeriod: SectorThemeContext["periods"][ContextRange];
  industry: string;
  marketTopMovers: MarketQuoteMover[];
  moverMode: SectorThemeContext["moverMode"];
  primaryTicker: string;
  range: ContextRange;
  relatedSymbols: string[];
  sector: string;
  snapshots: MarketGroupSnapshotPayload[];
  subTheme: string;
  themeGroup: string;
}) {
  const sectorSnapshot = findGroupSnapshot(snapshots, "sector", sector);
  const industrySnapshot = findGroupSnapshot(snapshots, "industry_group", industry);
  const themeSnapshot = findGroupSnapshot(snapshots, "theme", themeGroup);
  const subThemeSnapshot = findGroupSnapshot(snapshots, "sub_theme", subTheme);
  const selectedSnapshot =
    moverMode === "top_movers"
      ? industrySnapshot
      : moverMode === "market_top_movers"
        ? findMarketTopMoverSnapshot(snapshots)
        : undefined;
  const topMovers =
    moverMode === "related"
      ? buildRelatedTopMovers({
          event,
          primaryTicker,
          range,
          relatedSymbols,
          snapshots,
        })
      : buildSnapshotTopMovers(selectedSnapshot, event.signal);
  const resolvedTopMovers =
    topMovers.length || moverMode !== "market_top_movers"
      ? topMovers
      : buildMarketQuoteTopMovers(marketTopMovers, event.signal, range);
  const fallbackTopMovers = fallbackPeriod.topMovers.filter((mover) => isRealTicker(mover.symbol));

  return {
    sectorChange: formatSnapshotChange(sectorSnapshot?.changePercent),
    industryChange: formatSnapshotChange(industrySnapshot?.changePercent),
    themeChange: formatSnapshotChange(themeSnapshot?.changePercent),
    subThemeChange: formatSnapshotChange(subThemeSnapshot?.changePercent),
    themeScore: event.score || fallbackPeriod.themeScore,
    themeSignal: event.signal,
    topMovers: resolvedTopMovers.length ? resolvedTopMovers : fallbackTopMovers,
  };
}

function buildRelatedTopMovers({
  event,
  primaryTicker,
  range,
  relatedSymbols,
  snapshots,
}: {
  event: FeedItem;
  primaryTicker: string;
  range: ContextRange;
  relatedSymbols: string[];
  snapshots: MarketGroupSnapshotPayload[];
}) {
  const symbols = uniqueSymbols([...relatedSymbols, primaryTicker ? primaryTicker : ""]).slice(0, 4);

  return symbols.map((symbol, index) => {
    const snapshotMover = findSnapshotMover(snapshots, symbol);
    return {
      change:
        snapshotMover?.changePercent !== undefined
          ? formatSignedPercent(snapshotMover.changePercent)
          : symbol === primaryTicker
            ? event.change
            : "+0.00%",
      symbol,
      trend: buildContextTrend(event.signal, index, range),
    };
  });
}

function buildSnapshotTopMovers(snapshot: MarketGroupSnapshotPayload | undefined, tone: DetailTone) {
  if (!snapshot?.topMovers.length) {
    return [];
  }

  return snapshot.topMovers.slice(0, 4).map((mover, index) => ({
    change: formatSignedPercent(mover.changePercent),
    symbol: mover.symbol.toUpperCase(),
    trend: snapshot.trendPoints.length
      ? offsetTrend(snapshot.trendPoints, index)
      : buildContextTrend(tone, index, "1D"),
  }));
}

function buildMarketQuoteTopMovers(movers: MarketQuoteMover[], tone: DetailTone, range: ContextRange): TopMover[] {
  return movers.slice(0, 4).map((mover, index) => ({
    change: formatSignedPercent(mover.changePercent),
    symbol: mover.symbol,
    trend: buildContextTrend(tone, index, range),
  }));
}

function resolveMoverMode({
  industry,
  relatedSymbols,
  snapshots,
  subTheme,
}: {
  industry: string;
  relatedSymbols: string[];
  snapshots: ContextSnapshotMap;
  subTheme: string;
}): SectorThemeContext["moverMode"] {
  if (relatedSymbols.length && (subTheme || industry)) {
    return "related";
  }

  if (industry && hasSnapshotTopMovers(snapshots, "industry_group", industry)) {
    return "top_movers";
  }

  return "market_top_movers";
}

function resolveMoverGroupName({
  industry,
  moverMode,
  subTheme,
}: {
  industry: string;
  moverMode: SectorThemeContext["moverMode"];
  subTheme: string;
}) {
  if (moverMode === "related") {
    return subTheme || industry;
  }

  if (moverMode === "top_movers") {
    return industry;
  }

  return "Market";
}

function findMarketTopMoverSnapshot(snapshots: MarketGroupSnapshotPayload[]) {
  return snapshots
    .filter((snapshot) => snapshot.topMovers.length)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0];
}

function hasSnapshotTopMovers(
  snapshots: ContextSnapshotMap,
  scope: MarketGroupSnapshotPayload["scope"],
  label: string,
) {
  return Object.values(snapshots).some((items) => Boolean(findGroupSnapshot(items, scope, label)?.topMovers.length));
}

function findGroupSnapshot(
  snapshots: MarketGroupSnapshotPayload[],
  scope: MarketGroupSnapshotPayload["scope"],
  label: string,
) {
  if (!label) return undefined;
  const normalizedLabel = normalizeGroupLabel(label);

  return snapshots.find(
    (snapshot) =>
      snapshot.scope === scope &&
      (normalizeGroupLabel(snapshot.groupName) === normalizedLabel ||
        normalizeGroupLabel(snapshot.groupKey) === normalizedLabel),
  );
}

function findSnapshotMover(snapshots: MarketGroupSnapshotPayload[], symbol: string) {
  const normalized = symbol.toUpperCase();
  for (const snapshot of snapshots) {
    const mover = snapshot.topMovers.find((item) => item.symbol.toUpperCase() === normalized);
    if (mover) return mover;
  }
  return undefined;
}

function uniqueSymbols(symbols: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const symbol of symbols) {
    const normalized = symbol.trim().toUpperCase();
    if (!isRealTicker(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function cleanContextValue(value?: string, options: { rejectGenericIndustry?: boolean } = {}) {
  const cleaned = (value || "").trim();
  if (!cleaned || cleaned === "N/A" || cleaned === "NA") return "";
  if (options.rejectGenericIndustry && /^(company watchlist|watchlist|company news)$/i.test(cleaned)) return "";
  return cleaned;
}

function normalizeGroupLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatSnapshotChange(value: number | undefined) {
  return value === undefined ? "" : formatSignedPercent(value);
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function buildContextTrend(tone: DetailTone, offset: number, range: ContextRange): number[] {
  const bullish = [34, 35, 38, 37, 40, 42, 43, 45, 47, 50];
  const bearish = [50, 48, 47, 45, 44, 41, 40, 38, 37, 35];
  const volatile = [40, 44, 39, 46, 42, 48, 43, 50, 45, 49];
  const neutral = [40, 41, 40, 42, 41, 42, 43, 42, 43, 44];
  const base =
    tone === "bearish"
      ? bearish
      : tone === "volatile"
        ? volatile
        : tone === "neutral"
          ? neutral
          : bullish;
  const multiplier = range === "30D" ? 1.7 : range === "5D" ? 1.25 : 1;

  return base.map((value, index) => Math.round(value * multiplier + offset * 2 + (index % 3)));
}

function offsetTrend(values: number[], offset: number) {
  return values.map((value, index) => Number((value + offset * 0.35 + (index % 2) * 0.1).toFixed(2)));
}

async function fetchRawItem(rawItemId: string) {
  if (!rawItemId) {
    return { ok: true, status: 200, data: null, error: undefined };
  }

  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${rawItemId}`,
    limit: "1",
  });

  return {
    ...result,
    data: Array.isArray(result.data) ? result.data[0] || null : null,
  };
}

async function fetchEventOfferingTerms(eventId: string) {
  if (!eventId) {
    return { ok: true, status: 200, data: null, error: undefined };
  }

  const result = await supabaseSelect("event_offering_terms", {
    select: "*",
    event_id: `eq.${eventId}`,
    limit: "1",
  });

  return {
    ...result,
    data: Array.isArray(result.data) ? result.data[0] || null : null,
  };
}

async function fetchEventAiOutputAnalysis(eventId: string) {
  if (!eventId) {
    return { ok: true, status: 200, data: null, error: undefined };
  }

  const result = await supabaseSelect("ai_outputs", {
    select: "payload,created_at",
    event_id: `eq.${eventId}`,
    output_type: "eq.news_event_analysis",
    order: "created_at.desc",
    limit: "1",
  });

  const row = Array.isArray(result.data) ? toRecord(result.data[0]) : null;
  const payload = toRecord(row?.payload);
  const analysis = toRecord(payload?.analysis);

  return {
    ...result,
    data: analysis,
  };
}

function buildOfferingTermsRowFromAiAnalysis(analysis: Record<string, unknown> | null) {
  const offeringTerms = toRecord(analysis?.offering_terms);
  if (offeringTerms?.is_offering !== true) return null;
  const metrics = toRecord(offeringTerms.dilution_metrics);
  const marketContext = toRecord(offeringTerms.market_context_used);
  const offeringAmount = toRecord(offeringTerms.offering_amount);
  const sharesOffered = toRecord(offeringTerms.shares_offered);
  const offeringPrice = toRecord(offeringTerms.offering_price);
  const commonShares = toRecord(offeringTerms.common_shares);
  const prefundedWarrants = toRecord(offeringTerms.prefunded_warrants);
  const prefundedWarrantShares = toRecord(prefundedWarrants?.shares);
  const prefundedWarrantExercisePrice = toRecord(prefundedWarrants?.exercise_price);
  const commonWarrants = toRecord(offeringTerms.common_warrants);
  const commonWarrantShares = toRecord(commonWarrants?.shares);
  const commonWarrantExercisePrice = toRecord(commonWarrants?.exercise_price);
  const convertibleSecurities = toRecord(offeringTerms.convertible_securities);
  const convertiblePrincipal = toRecord(convertibleSecurities?.principal_amount);
  const convertibleConversionPrice = toRecord(convertibleSecurities?.conversion_price);
  const convertibleShareExposure = toRecord(convertibleSecurities?.share_exposure);
  const totalPotentialShareExposure = toRecord(offeringTerms.total_potential_share_exposure);
  const warrants = toRecord(offeringTerms.warrants);
  const warrantExercisePrice = toRecord(warrants?.exercise_price);

  return {
    offering_type: readRowString(offeringTerms, "offering_type"),
    security_type: readRowString(offeringTerms, "security_type"),
    primary_or_resale: readRowString(offeringTerms, "primary_or_resale"),
    offering_amount: readRowNumber(offeringAmount, "amount"),
    offering_price: readRowNumber(offeringPrice, "price"),
    shares_offered: readRowNumber(sharesOffered, "count"),
    common_shares_offered: readRowNumber(commonShares, "count"),
    prefunded_warrant_shares: readRowNumber(prefundedWarrantShares, "count"),
    prefunded_warrant_exercise_price: readRowNumber(prefundedWarrantExercisePrice, "price"),
    common_warrant_shares: readRowNumber(commonWarrantShares, "count"),
    common_warrant_exercise_price: readRowNumber(commonWarrantExercisePrice, "price"),
    convertible_principal_amount: readRowNumber(convertiblePrincipal, "amount"),
    convertible_share_exposure: readRowNumber(convertibleShareExposure, "count"),
    total_potential_share_exposure: readRowNumber(totalPotentialShareExposure, "count"),
    market_reference_price: readRowNumber(metrics, "market_reference_price") || readRowNumber(marketContext, "price"),
    market_cap: readRowNumber(metrics, "market_cap") || readRowNumber(marketContext, "market_cap"),
    shares_outstanding_market: readRowNumber(metrics, "shares_outstanding_market") || readRowNumber(marketContext, "shares_outstanding"),
    public_float_market: readRowNumber(metrics, "public_float_market") || readRowNumber(marketContext, "public_float"),
    warrant_coverage_text: readRowString(commonWarrantShares, "value_text") || readRowString(warrants, "coverage_text"),
    warrant_exercise_price: readRowNumber(commonWarrantExercisePrice, "price") || readRowNumber(warrantExercisePrice, "price"),
    conversion_price: readRowNumber(convertibleConversionPrice, "price"),
    discount_to_market_percent: readRowNumber(metrics, "discount_to_market_percent"),
    estimated_dilution_percent: readRowNumber(metrics, "estimated_dilution_percent"),
    immediate_share_exposure: readRowNumber(metrics, "immediate_share_exposure"),
    future_warrant_overhang_shares: readRowNumber(metrics, "future_warrant_overhang_shares"),
    immediate_float_impact_percent: readRowNumber(metrics, "immediate_float_impact_percent"),
    total_potential_dilution_percent: readRowNumber(metrics, "total_potential_dilution_percent"),
    total_potential_float_overhang_percent: readRowNumber(metrics, "total_potential_float_overhang_percent"),
    float_overhang_percent: readRowNumber(metrics, "float_overhang_percent"),
    max_share_impact_percent: readRowNumber(metrics, "max_share_impact_percent"),
    dilution_scale: readRowString(metrics, "dilution_scale"),
    metadata: {
      source_group: "news",
      source_precedence: "ai_output",
      source_confidence: "medium",
      original_offering_terms: offeringTerms,
      dilution_metrics: metrics || {},
    },
  };
}

function buildRawItemFullTextHtml(rawItem: Record<string, unknown> | null) {
  if (!rawItem) return "";

  const rawPayload = toRecord(rawItem.raw_payload);
  const articlePayload = toRecord(rawPayload?.article_payload);
  return (
    readRowString(rawPayload, "full_text_html") ||
    readRowString(articlePayload, "full_text_html") ||
    bodyTextToHtml(readRowString(rawItem, "body_text")) ||
    bodyTextToHtml(readRowString(rawPayload, "body_text")) ||
    bodyTextToHtml(readRowString(articlePayload, "body_text"))
  );
}

function mapRelatedTickerRows(rows: Record<string, unknown>[], fallback: RelatedTicker[]) {
  const rankedRows = rows
    .filter((row) => readRowString(row, "role") !== "primary")
    .sort((a, b) => {
      const roleDiff = getRelatedTickerRolePriority(a) - getRelatedTickerRolePriority(b);
      return roleDiff || readRowNumber(a, "sort_order") - readRowNumber(b, "sort_order");
    });
  const seenSymbols = new Set<string>();
  const related: RelatedTicker[] = [];

  for (const row of rankedRows) {
    const symbol = readRowString(row, "symbol").toUpperCase();
    if (!symbol || seenSymbols.has(symbol)) {
      continue;
    }
    seenSymbols.add(symbol);
    related.push({
      symbol,
      name: readMetadataString(row, "name") || symbol,
      price: "N/A",
      change: "",
      tone: "neutral" as const,
    });
    if (related.length >= 8) {
      break;
    }
  }

  return related.length ? related : fallback;
}

function getRelatedTickerRolePriority(row: Record<string, unknown>) {
  const role = readRowString(row, "role");
  const rolePriority: Record<string, number> = {
    counterparty: 1,
    customer: 2,
    supplier: 2,
    peer: 3,
    related: 4,
    sector_constituent: 5,
    theme_constituent: 5,
    mentioned: 6,
  };
  return rolePriority[role] ?? 99;
}

function mapRelatedNewsRows(rows: Record<string, unknown>[]): RelatedStory[] {
  return rows.slice(0, 4).map((row) => ({
    title: readRowString(row, "title") || "Related event",
    source: formatSourceLabel(readRowString(row, "source_code")),
    age: formatShortDate(readRowString(row, "detected_at")),
  }));
}

function mapRecentFilingRows(rows: Record<string, unknown>[]): RecentFiling[] {
  return rows.slice(0, 4).map((row) => {
    const eventType = readRowString(row, "event_type") || "other";
    const badge = getEventTypeBadge(eventType);
    return {
      form: readMetadataString(row, "form_type") || readMetadataString(row, "formType") || "SEC",
      eventType: badge.label,
      title: readRowString(row, "title") || "Recent filing",
      filedAt: formatShortDate(readRowString(row, "detected_at")),
      score: readRowNumber(row, "score"),
    };
  });
}

function toRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
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

function readRowString(row: Record<string, unknown> | null, key: string) {
  if (!row) return "";
  const value = row[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRowNumber(row: Record<string, unknown> | null, key: string) {
  if (!row) return 0;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function readMetadataString(row: Record<string, unknown>, key: string) {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object") return "";
  return readRowString(metadata as Record<string, unknown>, key);
}

function readOfferingNumber(
  row: Record<string, unknown>,
  column: string,
  fallbackRecord?: Record<string, unknown> | null,
  fallbackPath: string[] = [],
) {
  const direct = readRowNumber(row, column);
  if (direct > 0) return direct;
  if (!fallbackRecord || !fallbackPath.length) return 0;
  return readDeepNumber(fallbackRecord, fallbackPath);
}

function readDeepNumber(record: Record<string, unknown>, path: string[]) {
  let value: unknown = record;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    value = (value as Record<string, unknown>)[key];
  }

  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function readDeepString(record: Record<string, unknown> | null, path: string[]) {
  if (!record) return "";
  let value: unknown = record;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    value = (value as Record<string, unknown>)[key];
  }

  return typeof value === "string" ? value.trim() : "";
}

function ratioPercent(numerator: number, denominator: number) {
  if (!numerator || !denominator) return 0;
  return (numerator / denominator) * 100;
}

function formatOfferingType(value: string) {
  if (!value) return "Not disclosed";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAtm\b/g, "ATM")
    .replace(/\bAds\b/g, "ADS");
}

function formatOfferingDealLabel({
  offeringType,
  rawOfferingType,
  securityType,
}: {
  offeringType: string;
  rawOfferingType: string;
  securityType: string;
}) {
  const normalizedType = normalizeDisplayToken(offeringType);
  const normalizedRawType = normalizeDisplayToken(rawOfferingType);
  const normalizedSecurity = normalizeDisplayToken(securityType);
  const securityLabel = formatSecurityTypeForDeal(normalizedSecurity);

  if (normalizedType === "convertible_financing" || normalizedSecurity === "convertible_notes") {
    return "convertible financing";
  }

  if (normalizedType === "warrant_exercise") return "warrant exercise financing";
  if (normalizedType === "rights_offering") return "rights offering";
  if (normalizedType === "atm") return "at-the-market offering";
  if (normalizedType === "registered_direct") return `${securityLabel || "registered direct"} offering`;
  if (normalizedType === "private_placement") return `${securityLabel || "private placement"} financing`;
  if (normalizedType === "resale_registration") return `${securityLabel || "resale"} registration`;
  if (normalizedType === "shelf_registration") return `${securityLabel || "shelf"} registration`;

  if (normalizedSecurity === "units") return "unit offering";
  if (normalizedType === "mixed" || normalizedSecurity === "mixed") return `${securityLabel || "mixed securities"} offering`;
  if (securityLabel) return `${securityLabel} offering`;
  if (normalizedRawType.includes("public")) return "public offering";
  return "";
}

function formatSecurityTypeForDeal(value: string) {
  if (!value || value === "unknown" || value === "other") return "";
  if (value === "common_stock" || value === "common_shares" || value === "ordinary_shares") return "common stock";
  if (value === "prefunded_warrants") return "pre-funded warrant";
  if (value === "convertible_notes") return "convertible note";
  if (value === "ads") return "ADS";
  return formatOfferingType(value).toLowerCase();
}

function formatPriceComparison({
  discountToMarketPercent,
  marketReferencePrice,
  offeringPrice,
}: {
  discountToMarketPercent: number;
  marketReferencePrice: number;
  offeringPrice: number;
}) {
  const comparison = [
    offeringPrice ? `offering ${formatPriceNumber(offeringPrice)}` : "",
    marketReferencePrice ? `market ${formatPriceNumber(marketReferencePrice)}` : "",
  ].filter(Boolean);

  if (Number.isFinite(discountToMarketPercent) && discountToMarketPercent !== 0) {
    comparison.push(
      discountToMarketPercent > 0
        ? `${formatPercentCompact(discountToMarketPercent)} discount`
        : `${formatPercentCompact(Math.abs(discountToMarketPercent))} premium`,
    );
  }

  return comparison.join(" / ");
}

function normalizeDisplayToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-\s/]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^_+|_+$/g, "");
}

function formatRiskLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "UNKNOWN";
  return normalized.toUpperCase();
}

function formatCompactShareCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function formatPercentCompact(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function scaleShareAmount(value: number, maxValue: number) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || value <= 0 || maxValue <= 0) return 0;
  return Math.min(100, Math.max(0, (value / maxValue) * 100));
}

function formatMoneyNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPriceNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`;
}

function formatSupplyMixSummary(components: Array<{ label: string; value: number }>) {
  const disclosed = components.filter((component) => component.value > 0);
  if (!disclosed.length) return "Potential supply components not disclosed.";
  return disclosed.map((component) => `${component.label}: ${formatCompactShareCount(component.value)}`).join(" / ");
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
  }).format(date)} · ${new Intl.DateTimeFormat("en-US", {
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
    dea: "DEA",
    doj: "DOJ",
    globe: "GlobeNewswire",
    globenewswire: "GlobeNewswire",
    nasdaq_corporate_actions: "Nasdaq Corporate Actions",
    "nasdaq corporate actions": "Nasdaq Corporate Actions",
    nasdaq_trader: "Nasdaq Trader",
    newsfile: "Newsfile",
    ofac: "OFAC",
    prnewswire: "PR Newswire",
    sec_edgar: "SEC",
    whitehouse: "White House",
    "white-house": "White House",
  };

  return labels[normalized] || value || "Stock Radar";
}

function isRealTicker(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
      spread: 1,
      volumeMultiplier: 1,
    },
    "5D": {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Today"],
      spread: 1.8,
      volumeMultiplier: 1.15,
    },
    "1M": {
      labels: ["W1", "W1", "W2", "W2", "W3", "W3", "W4", "W4", "W5", "W5", "W6", "Today"],
      spread: 2.6,
      volumeMultiplier: 1.25,
    },
    "3M": {
      labels: ["M1", "M1", "M1", "M2", "M2", "M2", "M3", "M3", "M3", "M3", "M3", "Today"],
      spread: 3.6,
      volumeMultiplier: 1.35,
    },
    "1Y": {
      labels: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"],
      spread: 5,
      volumeMultiplier: 1.55,
    },
    "5Y": {
      labels: ["2022", "2022", "2023", "2023", "2024", "2024", "2025", "2025", "2026", "2026", "2026", "Today"],
      spread: 8,
      volumeMultiplier: 1.75,
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
      "5Y": makePricePoints(ranges["5Y"], lastClose, previousClose, trend, volumeBase),
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
  const effectiveSpread = lastClose < 1
    ? Math.max(Math.max(lastClose, previousClose) * 0.12, 0.002)
    : range.spread;
  const lowBand = Math.max(0, Math.min(previousClose, lastClose) - effectiveSpread);
  const highBand = Math.max(previousClose, lastClose) + effectiveSpread * 0.55;
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
    const volatility = Math.max(Math.abs(close - priorClose), effectiveSpread * 0.18);
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

function parsePrice(price: string) {
  const parsed = Number(price.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 100;
}

function estimatePreviousClose(lastClose: number, changePercent: string) {
  const parsedPercent = Number(changePercent.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsedPercent)) {
    return lastClose;
  }

  return roundPrice(lastClose / (1 + parsedPercent / 100));
}

function roundPrice(value: number) {
  return Number(value.toFixed(2));
}

function getSourceUrl(source: string) {
  const sourceUrls: Record<string, string> = {
    Accesswire: "https://www.accesswire.com/",
    "Business Wire": "https://www.businesswire.com/",
    GlobeNewswire: "https://www.globenewswire.com/",
    "Nasdaq Corporate Actions": "https://www.nasdaqtrader.com/TraderNews.aspx",
    "Nasdaq Trader": "https://www.nasdaqtrader.com/",
    "PR Newswire": "https://www.prnewswire.com/news-releases/",
    SEC: "https://www.sec.gov/edgar/search/",
  };

  return sourceUrls[source] || "https://www.sec.gov/edgar/search/";
}

function getExchange(ticker: string) {
  const exchanges: Record<string, string> = {
    AMC: "NYSE",
    ARDC: "NYSE",
    GLD: "NYSEARCA",
    LAC: "NYSE",
    MSTR: "NASDAQ",
    NLST: "OTCQB",
    NVDA: "NASDAQ",
    PLTR: "NASDAQ",
    PRSO: "NASDAQ",
    TSLA: "NASDAQ",
    TYBT: "OTC",
  };

  return exchanges[ticker] || "NASDAQ";
}

function AnalysisCard({ title, body }: { title: string; body: string }) {
  return (
    <AnalysisDetailCard kind="copy">
      <h2>{title}</h2>
      <p>{body}</p>
    </AnalysisDetailCard>
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
    <AnalysisDetailCard className={tone ? detailStyles[tone] : undefined}>
      <h2 className={ToneIcon ? `analysis-title ${tone}` : undefined}>
        {ToneIcon ? <ToneIcon aria-hidden="true" size={18} strokeWidth={2.2} /> : null}
        <span>{title}</span>
      </h2>
      <ol className={numbered ? detailStyles.numberedList : detailStyles.textList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </AnalysisDetailCard>
  );
}

function CaseList({ title, items, tone }: { title: string; items: string[]; tone: "bullish" | "bearish" }) {
  const ToneIcon = tone === "bullish" ? TrendingUp : TrendingDown;

  return (
    <section className={`${detailStyles.card} ${detailStyles.caseCard} ${detailStyles[tone]}`}>
      <h2>
        <ToneIcon aria-hidden="true" size={18} strokeWidth={2.2} />
        <span>{title}</span>
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
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
