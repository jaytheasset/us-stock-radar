import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  CalendarCheck,
  ChartPie,
  CircleCheck,
  Clock3,
  DollarSign,
  ExternalLink,
  FileText,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getServerEnv } from "@/lib/env";
import { fetchFmpQuotes } from "@/lib/integrations";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { readMarketGroupSnapshotCache, type MarketGroupSnapshotPayload } from "@/lib/marketDataCache";
import { fetchEventAnalysis, fetchEventById, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import { SecFilingHtmlViewer } from "@/app/filings/SecFilingHtmlViewer";
import {
  CURRENT_SHARES_MARKET_CONTEXT_NOTE,
  DILUTION_MARKET_DATA_DISCLAIMER,
  DilutionShareOverhang,
  type DilutionShareOverhangBarSegment,
  type DilutionShareOverhangBreakdownRow,
} from "@/components/DilutionShareOverhang";
import type {
  ContextRange,
  DetailTone,
  PriceChartMarker,
  PriceChartSeries,
  PricePoint,
  PriceRange,
  SectorThemeContext,
  TopMover,
} from "@/app/events/[id]/detailTypes";

type FilingDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

type FilingContextSnapshotMap = Record<ContextRange, MarketGroupSnapshotPayload[]>;

const FILING_CONTEXT_MOVER_LIMIT = 6;
const BROAD_MARKET_MOVER_SYMBOLS = new Set(["SPY", "QQQ", "DIA", "IWM"]);

let filingContextSnapshotCache:
  | {
      expiresAt: number;
      snapshots: FilingContextSnapshotMap;
    }
  | null = null;

type FilingScoreExplanation = {
  summary: string;
  baseBand: string;
  upwardFactors: string[];
  limitingFactors: string[];
  finalRead: string;
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
  primaryDocumentUrl?: string;
  eventType: string;
  impact: "low" | "medium" | "high";
  deliveryLevel: "archive" | "feed" | "alert";
  score: number;
  scoreExplanation?: FilingScoreExplanation | null;
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
  ownershipRelatedFilings?: OwnershipRelatedFiling[];
  contextRelatedFilings?: FilingContextRelatedFiling[];
  relatedNews: RelatedStory[];
  context?: SectorThemeContext | null;
  priceMarkers?: PriceChartMarker[];
  priceSeries: PriceChartSeries;
  originalTextNote: string;
  originalHtml: string;
  offeringDisplayModel?: Record<string, unknown> | null;
  offeringMarketContext?: Record<string, unknown> | null;
  offeringDilutionMetrics?: Record<string, unknown> | null;
  offeringTerms?: Record<string, unknown> | null;
  s3Case?: string | null;
  displayPayload?: FilingDisplayPayload | null;
};

type FilingDisplayPayload = {
  display_type?: string;
  data?: Record<string, unknown>;
  evidence?: unknown[];
  notes?: unknown[];
  [key: string]: unknown;
};

type RecentFiling = {
  id?: string;
  form: string;
  eventType: string;
  title: string;
  filedAt: string;
  score: number;
  accession?: string;
  deliveryLevel?: string;
};

type OwnershipRelatedFiling = RecentFiling & {
  relation: string;
  description: string;
  candidate?: boolean;
};

type FilingContextRelatedFiling = OwnershipRelatedFiling & {
  matchScore?: number | null;
  matchConfidence?: string;
};

type RelatedStory = {
  title: string;
  source: string;
  age: string;
};

type ShareOverhangBarSegment = DilutionShareOverhangBarSegment;

type SpacStageTone = "complete" | "current" | "risk" | "pending";

type SpacStageItem = {
  label: string;
  date: string;
  tone: SpacStageTone;
};

type SpacSourceItem = {
  title: string;
  detail: string;
  form: string;
  url: string;
};

type SpacHistoryItem = {
  date: string;
  form: string;
  title: string;
  source: string;
  status: string;
  current: boolean;
};

type SpacTransactionStatusModel = {
  currentStage: SpacStageCode;
  currentStageNumber: number;
  currentStageLabel: string;
  stageBadge: string;
  dealStatus: string;
  spacStatus: string;
  stageSummary: string;
  stages: SpacStageItem[];
  targetCompany: string;
  targetSummary: string;
  targetCompanyStory: string;
  expectedTicker: string;
  dealValue: string;
  announcedDate: string;
  mergerAgreementDate: string;
  sponsor: string;
  ipoUnderwriter: string;
  ipoDate: string;
  ipoYear: string;
  unitRightWarrantTerms: string;
  voteDate: string;
  redemptionDeadline: string;
  redemptionResultDate: string;
  redemptionRate: string;
  trustCashBefore: string;
  trustCashAfter: string;
  redemptionPrice: string;
  publicSharesRemaining: string;
  minCashCondition: string;
  minCashStatus: string;
  cashCondition: string;
  floatImpact: string;
  closingDate: string;
  tickerChangeDate: string;
  sourceDate: string;
  blockingIssue: string;
  nextCheck: string;
  riskFlags: string[];
  watchNext: string[];
  sources: SpacSourceItem[];
  eventHistory: SpacHistoryItem[];
};

type IpoStageCode = "s1_filed" | "terms_set" | "effect" | "pricing" | "listing" | "lockup";

type IpoListingModel = {
  displayMode: string;
  isInitialTermsPending: boolean;
  ipoKind: string;
  currentStage: IpoStageCode;
  currentStageLabel: string;
  stageBadge: string;
  displayQuickTake: string;
  issuer: string;
  proposedTicker: string;
  exchange: string;
  companyStory: string;
  companyStage: string;
  revenue: string;
  netLoss: string;
  cash: string;
  priceRange: string;
  midpointPrice: string;
  sharesOffered: string;
  offeringSize: string;
  impliedValuation: string;
  primarySecondaryMix: string;
  underwriters: string;
  underwriterOption: string;
  floatPercent: string;
  floatSummary: string;
  lockupSummary: string;
  lockupExpiration: string;
  expectedPricingDate: string;
  expectedListingDate: string;
  useOfProceeds: string[];
  snapshotMetrics: DilutionMetricItem[];
  offeringDetailsRows: DilutionDisclosureRow[];
  amendmentRows: DilutionDisclosureRow[];
  stages: SpacStageItem[];
  riskFlags: string[];
  watchNext: string[];
  sources: SpacSourceItem[];
};

type ListingRiskCheck = {
  label: string;
  value: string;
  status: string;
  note: string;
};

type ListingRiskTimelineItem = {
  label: string;
  date: string;
  status: string;
};

type ListingRiskModel = {
  exchange: string;
  complianceStatus: string;
  deficiencyNotice: string;
  mainRiskDriver: string;
  currentPoint: string;
  curePeriod: string;
  cureDeadline: string;
  extensionEligibility: string;
  appealHearingStatus: string;
  extensionReviewDate: string;
  hearingAppealDeadline: string;
  bidPrice: string;
  stockholdersEquity: string;
  marketValue: string;
  publicFloat: string;
  publicHolders: string;
  reverseSplitHistory: string;
  lateFilingGovernance: string;
  representativeThresholdsNote: string;
  noActiveDeficiency: boolean;
  checks: ListingRiskCheck[];
  timeline: ListingRiskTimelineItem[];
  riskFlags: string[];
  watchNext: string[];
  sources: SpacSourceItem[];
};

type EarningsMetric = {
  label: string;
  value: string;
  comparison: string;
  note: string;
};

type EarningsSegment = {
  name: string;
  revenue: string;
  performance: string;
  note: string;
};

type EarningsRiskSignal = {
  label: string;
  status: string;
  detail: string;
  tone: "clear" | "watch" | "risk";
};

type EarningsModel = {
  periodType: string;
  period: string;
  reportDate: string;
  revenue: string;
  revenueComparison: string;
  eps: string;
  netIncome: string;
  yoyGrowth: string;
  estimateBeatMiss: string;
  marginSummary: string;
  grossMargin: string;
  operatingMargin: string;
  ebitdaMargin: string;
  guidanceSummary: string;
  revenueGuidance: string;
  epsGuidance: string;
  marginGuidance: string;
  guidanceTone: "Bullish" | "Neutral" | "Weak";
  guidanceChange: string;
  forwardCommentary: string;
  cash: string;
  cashBurn: string;
  runway: string;
  managementOutlook: string;
  numbers: EarningsMetric[];
  actuals: EarningsMetric[];
  guidance: EarningsMetric[];
  marginMetrics: EarningsMetric[];
  marginTrend: string;
  marginTrendNote: string;
  segments: EarningsSegment[];
  surprises: EarningsMetric[];
  riskSignals: EarningsRiskSignal[];
  riskFlags: string[];
  watchNext: string[];
  sources: SpacSourceItem[];
};

type ClinicalTimelineItem = {
  label: string;
  date: string;
  status: string;
  detail: string;
};

type ClinicalDataHighlight = {
  label: string;
  value: string;
  note: string;
};

type FdaClinicalModel = {
  phase: string;
  indication: string;
  therapy: string;
  trialName: string;
  eventStatus: string;
  eventSummary: string;
  primaryEndpoint: string;
  patientPopulation: string;
  dataReadout: string;
  nextMilestone: string;
  fdaStatus: string;
  keyTakeaways: string[];
  fdaTimeline: ClinicalTimelineItem[];
  dataHighlights: ClinicalDataHighlight[];
  risks: string[];
  watchNext: string[];
  marketSize: string;
  marketSizeSource: string;
  sources: SpacSourceItem[];
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
  "abcd-spac-transaction-status": {
    id: "abcd-spac-transaction-status",
    ticker: "ABCD",
    exchange: "NASDAQ",
    company: "ABCD Acquisition Corp.",
    title: "ABCD Acquisition Files De-SPAC Redemption and Closing Update",
    formType: "8-K",
    filedAt: "Jun 19, 2026 - 7:12 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "strategic_transaction",
    impact: "high",
    deliveryLevel: "alert",
    score: 84,
    signal: "volatile",
    price: "$10.42",
    changeAmount: "-$0.08",
    change: "-0.76%",
    filingFocus: "SPAC transaction status",
    filingBrief:
      "Shareholders approved the de-SPAC, but redemptions leave minimum cash and final listing mechanics as the next closing variables.",
    whyItMatters:
      "High redemptions can reduce trust cash and public float before the target begins trading under the post-close ticker.",
    bullishPoints: [
      "Shareholder vote approval moves the transaction closer to closing.",
      "Expected ticker-change timing gives holders a concrete follow-up marker.",
      "Waiver or backstop financing could resolve the cash condition.",
    ],
    bearishPoints: [
      "High redemption participation reduced the cash available at closing.",
      "Minimum cash condition may require a waiver or backstop.",
      "A smaller float can increase post-close volatility.",
    ],
    summary:
      "The filing updates a SPAC business combination after the vote and redemption window. The key investor question is whether remaining trust cash, waiver language, or backstop financing is enough to close and support the ticker change.",
    keyEvidence: [
      "Shareholder approval and redemption results were disclosed in an 8-K.",
      "Minimum cash condition remains the main closing variable.",
      "The company expects a post-close ticker change after the merger closes.",
    ],
    watchNext: [
      "Closing 8-K with final share count and cash position.",
      "Any minimum cash waiver or backstop financing update.",
      "Ticker-change date and first post-close trading session.",
    ],
    recentFilings: [
      {
        form: "8-K",
        eventType: "Strategic Transaction",
        title: "Vote and redemption results disclosed",
        filedAt: "Jun 19",
        score: 84,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Merger vote proxy filed",
        filedAt: "May 10",
        score: 72,
      },
      {
        form: "S-4",
        eventType: "Strategic Transaction",
        title: "Business combination registration filed",
        filedAt: "Apr 5",
        score: 66,
      },
      {
        form: "8-K",
        eventType: "Strategic Transaction",
        title: "Business combination agreement signed",
        filedAt: "Mar 18",
        score: 70,
      },
    ],
    relatedNews: [
      { title: "SPAC redemptions keep de-SPAC float and cash conditions in focus", source: "Stock Radar", age: "1h ago" },
      { title: "Mobility target prepares for public-company transition", source: "GlobeNewswire", age: "3h ago" },
      { title: "Small-float de-SPACs remain volatile around ticker changes", source: "Stock Radar", age: "4h ago" },
      { title: "Backstop financing remains a key closing tool for SPAC deals", source: "PR Newswire", age: "6h ago" },
    ],
    context: {
      sector: "Industrials",
      industry: "Mobility Technology",
      marketCap: "$126.0M",
      periods: {
        "1D": {
          sectorChange: "-0.18%",
          industryChange: "-1.06%",
          themeScore: 84,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ABCD", change: "-0.76%", trend: [52, 51, 50, 49, 48, 46, 45, 44, 44, 43] },
            { symbol: "SPY", change: "-0.22%", trend: [48, 48, 47, 47, 46, 46, 45, 45, 44, 44] },
            { symbol: "QQQ", change: "+0.31%", trend: [40, 41, 42, 42, 43, 44, 45, 46, 47, 48] },
          ],
        },
        "5D": {
          sectorChange: "+0.36%",
          industryChange: "-3.88%",
          themeScore: 82,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ABCD", change: "-4.92%", trend: [60, 58, 55, 52, 50, 48, 46, 44, 43, 42] },
            { symbol: "SPY", change: "+1.20%", trend: [44, 45, 46, 47, 47, 48, 49, 49, 50, 51] },
            { symbol: "QQQ", change: "+2.14%", trend: [42, 43, 45, 46, 47, 48, 49, 51, 52, 53] },
          ],
        },
        "30D": {
          sectorChange: "+2.12%",
          industryChange: "-9.74%",
          themeScore: 80,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ABCD", change: "-10.48%", trend: [70, 68, 65, 61, 57, 53, 49, 46, 43, 41] },
            { symbol: "SPY", change: "+4.18%", trend: [40, 42, 43, 44, 45, 47, 48, 49, 51, 52] },
            { symbol: "QQQ", change: "+5.32%", trend: [38, 40, 42, 44, 46, 48, 50, 52, 54, 56] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 10.42,
      previousClose: 10.5,
      trend: [54, 53, 52, 51, 50, 48, 47, 46, 46, 45, 45, 50],
      volumeBase: 1_700_000,
    }),
    originalTextNote: "Mock SEC filing text for SPAC transaction status layout verification.",
    originalHtml: `
      <h3>Item 5.07 Submission of Matters to a Vote of Security Holders</h3>
      <p>ABCD Acquisition Corp. announced that its shareholders approved the proposed business combination with Apex Battery Systems at a special meeting held on June 18, 2026.</p>
      <h3>Redemption Results</h3>
      <p>Holders of 14,800,000 public shares elected to redeem their shares for approximately $10.61 per share, representing approximately 82% of the public shares outstanding before the meeting.</p>
      <h3>Closing Conditions</h3>
      <p>The company expects to close the transaction on or about June 24, 2026, subject to satisfaction or waiver of closing conditions, including minimum cash and Nasdaq listing requirements.</p>
    `,
    displayPayload: {
      display_type: "spac_transaction_status",
      data: {
        current_stage: "redemption",
        current_stage_label: "Redemption Result",
        deal_status: "Vote approved / closing pending",
        spac_status: "Vote approval moved the de-SPAC toward closing, but high redemptions leave cash and listing conditions unresolved.",
        stage_summary:
          "Vote approval moved the transaction forward, but redemptions keep minimum cash, float, and listing conditions in focus.",
        stages: [
          { code: "target", label: "Target / Deal Signed", date: "Mar 18, 2026" },
          { code: "proxy", label: "SEC Filing / Proxy", date: "May 10, 2026" },
          { code: "vote", label: "Vote & Redemption Window", date: "Jun 16-18, 2026" },
          { code: "redemption", label: "Redemption Result", date: "Jun 19, 2026" },
          { code: "cash", label: "Cash / Listing Conditions", date: "Before closing" },
          { code: "closing", label: "Closing / Ticker Change", date: "Jun 24-25, 2026" },
        ],
        target_company: "Apex Battery Systems",
        target_summary: "A battery systems company expected to become public through the SPAC merger.",
        target_company_story: "Apex Battery Systems develops commercial battery modules and energy-storage controls for fleet operators.",
        expected_ticker: "APXB",
        deal_value: "$515M pre-money equity value",
        announced_date: "Feb 12, 2026",
        merger_agreement_date: "Mar 18, 2026",
        sponsor: "ABCD Sponsor LLC",
        ipo_underwriter: "EF Hutton",
        ipo_date: "Mar 18, 2025",
        ipo_year: "2025",
        unit_right_warrant_terms: "Units: 1 share plus 1/5 right; no public warrants",
        vote_date: "Jun 18, 2026",
        redemption_deadline: "Jun 16, 2026",
        redemption_result_date: "Jun 19, 2026",
        redemption_rate: "82%",
        trust_cash_before: "$191.0M",
        trust_cash_after: "$34.0M",
        redemption_price: "$10.61",
        public_shares_remaining: "3.2M",
        min_cash_condition: "$50.0M",
        min_cash_status: "At risk",
        float_impact: "Public float reduced before closing",
        closing_date: "Jun 24, 2026",
        ticker_change_date: "Jun 25, 2026",
        risk_flags: [
          "Redemptions reduced trust cash below the stated cash condition.",
          "Minimum cash may need a waiver, backstop, or added financing.",
          "Small post-close float can amplify volatility.",
        ],
        watch_next: [
          "Closing 8-K with final cash and share count.",
          "Minimum cash waiver or financing backstop language.",
          "Ticker-change confirmation and first post-close trading session.",
        ],
        sources: [
          { title: "8-K vote results", detail: "Shareholder approval and redemption results", form: "8-K" },
          { title: "Business combination agreement", detail: "Minimum cash and closing conditions", form: "Exhibit" },
          { title: "Proxy statement", detail: "Redemption mechanics and timeline", form: "DEF 14A" },
        ],
        event_history: [
          { date: "Jun 19, 2026", form: "8-K", title: "Vote and redemption results disclosed", source: "SEC", status: "Current" },
          { date: "May 10, 2026", form: "DEF 14A", title: "Merger vote proxy filed", source: "SEC", status: "Filed" },
          { date: "Apr 5, 2026", form: "S-4", title: "Business combination registration filed", source: "SEC", status: "Filed" },
          { date: "Mar 18, 2026", form: "8-K", title: "Business combination agreement signed", source: "SEC", status: "Filed" },
        ],
      },
      evidence: [],
      notes: [],
    },
  },
  "orion-ipo-listing": {
    id: "orion-ipo-listing",
    ticker: "ORIN",
    exchange: "NASDAQ",
    company: "Orion Data Systems, Inc.",
    title: "Orion Data Systems Sets Terms for Proposed Initial Public Offering",
    formType: "S-1/A",
    filedAt: "Jun 22, 2026 - 6:42 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "ipo_listing",
    impact: "medium",
    deliveryLevel: "feed",
    score: 72,
    signal: "neutral",
    price: "Not trading",
    changeAmount: "$0.00",
    change: "0.00%",
    filingFocus: "IPO terms update",
    filingBrief:
      "Orion Data Systems updated its IPO terms with a proposed ticker, price range, proceeds plan, and underwriter lineup.",
    whyItMatters:
      "IPO term updates help investors judge listing timing, initial float, valuation, and first-trade supply before a new issuer begins trading.",
    bullishPoints: [
      "The filing discloses a proposed ticker and exchange.",
      "IPO proceeds are earmarked for growth and working capital.",
      "Lead underwriters and greenshoe terms are identified.",
    ],
    bearishPoints: [
      "The company remains loss-making before listing.",
      "Public float may be limited at the initial listing.",
      "Pricing and first-trade dates remain subject to market conditions.",
    ],
    summary:
      "The amended registration statement moves Orion Data Systems closer to listing by setting IPO terms and expected Nasdaq ticker context. Investors should track pricing, effectiveness, final proceeds, and lock-up supply.",
    keyEvidence: [
      "S-1/A discloses the IPO price range and proposed Nasdaq ticker.",
      "The use-of-proceeds section lists growth investment and working capital.",
      "Lock-up terms and underwriter option are disclosed in the prospectus.",
    ],
    watchNext: [
      "SEC effectiveness notice and final prospectus.",
      "IPO pricing and first Nasdaq trading session.",
      "Lock-up expiration and post-listing float updates.",
    ],
    recentFilings: [
      {
        form: "S-1/A",
        eventType: "IPO Listing",
        title: "IPO price range and proposed ticker disclosed",
        filedAt: "Jun 22",
        score: 72,
      },
      {
        form: "S-1",
        eventType: "IPO Listing",
        title: "Initial registration statement filed",
        filedAt: "May 28",
        score: 64,
      },
      {
        form: "8-A12B",
        eventType: "IPO Listing",
        title: "Exchange Act registration for Nasdaq listing",
        filedAt: "Pending",
        score: 58,
      },
    ],
    relatedNews: [
      { title: "Software IPO pipeline waits for pricing windows to reopen", source: "Stock Radar", age: "2h ago" },
      { title: "Investors watch float and lock-up terms in new listings", source: "Stock Radar", age: "4h ago" },
      { title: "Data infrastructure issuers test public market appetite", source: "Market Desk", age: "6h ago" },
    ],
    context: {
      sector: "Technology",
      industry: "Data Infrastructure Software",
      marketCap: "IPO pending",
      themeGroup: "Cloud Infrastructure",
      subTheme: "Operational Data Platforms",
      periods: {
        "1D": {
          sectorChange: "+0.48%",
          industryChange: "+0.74%",
          themeScore: 72,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "ORIN", change: "IPO pending", trend: [40, 40, 41, 41, 42, 42, 43, 43, 43, 44] },
            { symbol: "DDOG", change: "+1.12%", trend: [42, 43, 44, 44, 45, 45, 46, 47, 48, 48] },
            { symbol: "MDB", change: "+0.64%", trend: [45, 45, 44, 46, 47, 47, 48, 49, 49, 50] },
          ],
        },
        "5D": {
          sectorChange: "+1.86%",
          industryChange: "+2.41%",
          themeScore: 73,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "ORIN", change: "IPO pending", trend: [40, 41, 41, 42, 42, 43, 43, 44, 44, 45] },
            { symbol: "DDOG", change: "+3.18%", trend: [40, 41, 42, 43, 44, 45, 46, 48, 49, 51] },
            { symbol: "MDB", change: "+2.07%", trend: [42, 43, 43, 44, 45, 47, 48, 48, 49, 50] },
          ],
        },
        "30D": {
          sectorChange: "+5.28%",
          industryChange: "+6.42%",
          themeScore: 75,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "ORIN", change: "IPO pending", trend: [39, 40, 41, 41, 42, 43, 44, 44, 45, 46] },
            { symbol: "DDOG", change: "+8.44%", trend: [36, 38, 39, 41, 43, 45, 47, 49, 51, 53] },
            { symbol: "MDB", change: "+6.15%", trend: [38, 39, 41, 42, 44, 45, 46, 48, 50, 52] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 19,
      previousClose: 19,
      trend: [40, 40, 41, 41, 42, 42, 43, 43, 44, 44, 45, 45],
      volumeBase: 500_000,
    }),
    originalTextNote: "Mock SEC filing text for IPO listing detail layout verification.",
    originalHtml: `
      <h3>Prospectus Summary</h3>
      <p>Orion Data Systems, Inc. provides a cloud data operations platform for enterprise engineering and compliance teams.</p>
      <h3>The Offering</h3>
      <p>The company expects to offer 10,500,000 shares of common stock at an initial public offering price between $18.00 and $20.00 per share. Orion has applied to list its common stock on Nasdaq under the symbol ORIN.</p>
      <h3>Use of Proceeds</h3>
      <p>Net proceeds are expected to be used for sales and marketing, research and development, working capital, and general corporate purposes.</p>
    `,
    displayPayload: {
      display_type: "ipo_listing",
      data: {
        ipo_kind: "Traditional IPO",
        current_stage: "terms_set",
        current_stage_label: "Terms Set",
        display_quick_take:
          "The amended registration statement sets the IPO range, proposed ticker, offering size, proceeds plan, and underwriter lineup.",
        issuer: "Orion Data Systems, Inc.",
        proposed_ticker: "ORIN",
        exchange: "NASDAQ",
        company_story:
          "Orion Data Systems sells cloud software that helps enterprise teams monitor operational data flows and compliance controls.",
        company_stage: "Growth-stage software issuer with recurring revenue and operating losses.",
        revenue: "$118.4M trailing twelve months",
        net_loss: "$42.8M trailing twelve months",
        cash: "$51.6M before IPO proceeds",
        price_range: "$18.00-$20.00",
        midpoint_price: "$19.00",
        shares_offered: "10.5M shares",
        offering_size: "$199.5M at midpoint before greenshoe",
        implied_valuation: "$1.42B at midpoint",
        primary_secondary_mix: "Primary shares only",
        underwriters: "Goldman Sachs, Morgan Stanley, J.P. Morgan",
        underwriter_option: "30-day option for 1.575M additional shares",
        float_percent: "13.8%",
        float_summary: "Initial float expected to be limited to IPO shares plus greenshoe if exercised.",
        lockup_summary: "Directors, officers, and major holders subject to 180-day lock-up.",
        lockup_expiration: "180 days after final prospectus date",
        expected_pricing_date: "Week of Jun 29, 2026",
        expected_listing_date: "After pricing, date not disclosed",
        use_of_proceeds: [
          "Expand sales and marketing capacity.",
          "Fund research and development for the data platform.",
          "Support working capital and general corporate purposes.",
        ],
        stages: [
          { code: "s1_filed", label: "S-1/F-1 Filed", date: "May 28, 2026" },
          { code: "terms_set", label: "Terms / Range Set", date: "Jun 22, 2026" },
          { code: "effect", label: "SEC Effective", date: "Not disclosed" },
          { code: "pricing", label: "Pricing / 424B4", date: "Week of Jun 29, 2026" },
          { code: "listing", label: "First Trade", date: "Not disclosed" },
          { code: "lockup", label: "Lock-Up Expiry", date: "180 days after final prospectus date" },
        ],
        risk_flags: [
          "Losses remain material before public listing.",
          "IPO timing depends on effectiveness and market demand.",
          "Low initial float can increase first-trade volatility.",
        ],
        watch_next: [
          "SEC effectiveness notice.",
          "Final pricing and 424B4 prospectus.",
          "First Nasdaq trading date and initial float.",
        ],
        sources: [
          { title: "S-1/A prospectus", detail: "IPO terms, proceeds, and lock-up disclosure", form: "S-1/A" },
          { title: "The Offering", detail: "Shares offered, price range, underwriters, and greenshoe", form: "Prospectus" },
          { title: "Use of Proceeds", detail: "Planned deployment of IPO proceeds", form: "Prospectus" },
        ],
      },
      evidence: [],
      notes: [],
    },
  },
  "zenx-listing-risk": {
    id: "zenx-listing-risk",
    ticker: "ZENX",
    exchange: "NASDAQ",
    company: "Zenith Exploration Corp.",
    title: "Zenith Exploration Discloses Nasdaq Bid Price Deficiency Notice",
    formType: "8-K",
    filedAt: "Jun 21, 2026 - 8:04 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "listing_risk",
    impact: "medium",
    deliveryLevel: "feed",
    score: 68,
    signal: "bearish",
    price: "$0.43",
    changeAmount: "-$0.05",
    change: "-10.42%",
    filingFocus: "Nasdaq compliance notice",
    filingBrief:
      "Zenith disclosed a Nasdaq bid-price deficiency notice and a cure period while it evaluates compliance options.",
    whyItMatters:
      "Listing deficiency notices can force reverse split planning, hearings, or delisting risk if the company does not regain compliance.",
    bullishPoints: [
      "The company says the notice does not immediately affect trading.",
      "A cure period gives management time to regain compliance.",
      "Extension eligibility may remain available if other listing standards are met.",
    ],
    bearishPoints: [
      "The stock remains below the representative $1.00 bid-price threshold.",
      "A reverse split may become necessary if compliance is not restored.",
      "Hearing or appeal timing can create event risk before the deadline.",
    ],
    summary:
      "The filing discloses an active Nasdaq bid-price deficiency and lays out the near-term compliance path. Investors should track the cure deadline, any extension request, and whether the board moves toward a reverse split.",
    keyEvidence: [
      "Nasdaq deficiency notice disclosed in an 8-K.",
      "Bid price is the main compliance driver.",
      "The company described a cure period and possible compliance actions.",
    ],
    watchNext: [
      "Ten-day bid-price compliance period.",
      "Cure deadline or extension determination.",
      "Reverse split proposal or hearing request.",
    ],
    recentFilings: [
      {
        form: "8-K",
        eventType: "Listing Risk",
        title: "Nasdaq bid price deficiency disclosed",
        filedAt: "Jun 21",
        score: 68,
      },
      {
        form: "DEF 14A",
        eventType: "Shareholder Vote",
        title: "Reverse split authorization proposal",
        filedAt: "May 30",
        score: 72,
      },
    ],
    relatedNews: [
      { title: "Low-priced issuers face compliance deadlines after Nasdaq notices", source: "Stock Radar", age: "1h ago" },
      { title: "Reverse split proposals remain active among micro-cap issuers", source: "Market Desk", age: "5h ago" },
    ],
    context: {
      sector: "Energy",
      industry: "Oil & Gas Exploration",
      marketCap: "$18.2M",
      periods: {
        "1D": {
          sectorChange: "-0.22%",
          industryChange: "-1.34%",
          themeScore: 68,
          themeSignal: "bearish",
          topMovers: [
            { symbol: "ZENX", change: "-10.42%", trend: [58, 54, 51, 47, 45, 42, 40, 38, 37, 35] },
            { symbol: "XOP", change: "-0.84%", trend: [50, 49, 48, 48, 47, 46, 45, 45, 44, 44] },
          ],
        },
        "5D": {
          sectorChange: "-1.80%",
          industryChange: "-4.28%",
          themeScore: 66,
          themeSignal: "bearish",
          topMovers: [
            { symbol: "ZENX", change: "-18.33%", trend: [66, 62, 58, 54, 51, 47, 43, 40, 37, 35] },
            { symbol: "XOP", change: "-3.12%", trend: [52, 50, 49, 47, 46, 45, 44, 43, 42, 41] },
          ],
        },
        "30D": {
          sectorChange: "+0.42%",
          industryChange: "-7.90%",
          themeScore: 65,
          themeSignal: "bearish",
          topMovers: [
            { symbol: "ZENX", change: "-34.85%", trend: [72, 68, 63, 59, 54, 49, 45, 40, 37, 34] },
            { symbol: "XOP", change: "-2.64%", trend: [50, 49, 48, 48, 47, 46, 45, 45, 44, 43] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 0.43,
      previousClose: 0.48,
      trend: [58, 54, 51, 47, 45, 42, 40, 38, 37, 35, 34, 33],
      volumeBase: 4_800_000,
    }),
    originalTextNote: "Mock SEC filing text for listing-risk layout verification.",
    originalHtml: `
      <h3>Nasdaq Notice</h3>
      <p>Zenith Exploration Corp. received a notice from Nasdaq stating that the company was not in compliance with the minimum bid price requirement for continued listing.</p>
      <h3>Cure Period</h3>
      <p>The company has a compliance period to regain compliance and may be eligible for an additional period if it meets other continued listing standards.</p>
      <h3>Company Response</h3>
      <p>The notice has no immediate effect on the listing of the company's common stock. The company intends to monitor the bid price and consider available options.</p>
    `,
    displayPayload: {
      display_type: "listing_risk",
      data: {
        exchange: "Nasdaq",
        compliance_status: "Active deficiency disclosed",
        deficiency_notice: "Minimum bid price deficiency notice",
        main_risk_driver: "Bid price below representative continued-listing threshold",
        current_point: "Cure period active",
        notice_date: "Jun 18, 2026",
        cure_period: "180 calendar days",
        cure_deadline: "Dec 15, 2026",
        extension_eligibility: "Potentially eligible if other Nasdaq Capital Market standards are met",
        appeal_hearing_status: "No hearing disclosed",
        extension_review_date: "Not disclosed",
        hearing_appeal_deadline: "Not disclosed",
        representative_thresholds_note:
          "Representative thresholds shown only when source-backed; verify exchange rule text before treating them as exact.",
        bid_price: "$0.43 last close; deficiency tied to minimum bid price",
        stockholders_equity: "Not disclosed in this filing",
        market_value: "Not disclosed",
        public_float: "Not disclosed",
        public_holders: "Not disclosed",
        reverse_split_history: "Reverse split authorization proposal previously filed",
        late_filing_governance: "No late-filing or governance deficiency disclosed",
        checks: [
          { label: "Bid Price", value: "$0.43", status: "Deficient", note: "Main source-backed risk driver." },
          { label: "Stockholders' Equity", value: "Not disclosed", status: "Unknown", note: "No equity deficiency disclosed in this filing." },
          { label: "MVLS / Market Value", value: "Not disclosed", status: "Unknown", note: "No market-value deficiency disclosed." },
          { label: "Public Float / Holders", value: "Not disclosed", status: "Unknown", note: "No float or holder deficiency disclosed." },
          { label: "Reverse Split History", value: "Proposal filed", status: "Watch", note: "Possible compliance tool if bid price does not recover." },
          { label: "Late Filing / Governance", value: "No issue disclosed", status: "Satisfied", note: "No active deficiency disclosed for this check." },
        ],
        timeline: [
          { label: "Notice Date", date: "Jun 18, 2026", status: "Complete" },
          { label: "Current Point", date: "Cure period active", status: "Current" },
          { label: "Cure Deadline", date: "Dec 15, 2026", status: "Pending" },
          { label: "Extension / Review", date: "Not disclosed", status: "Unknown" },
          { label: "Hearing / Appeal Deadline", date: "Not disclosed", status: "Unknown" },
        ],
        risk_flags: [
          "Bid-price deficiency is active.",
          "Reverse split may become a compliance tool.",
          "Extension eligibility depends on other listing standards.",
        ],
        watch_next: [
          "Bid price above required level for compliance window.",
          "Reverse split proposal, board action, or shareholder vote.",
          "Nasdaq extension, hearing, or delisting determination.",
        ],
        sources: [
          { title: "8-K Nasdaq notice", detail: "Deficiency notice and cure period", form: "8-K" },
          { title: "Company response", detail: "Monitoring and available compliance options", form: "8-K" },
        ],
      },
      evidence: [],
      notes: [],
    },
  },
  "nova-q1-earnings": {
    id: "nova-q1-earnings",
    ticker: "NOVA",
    exchange: "NASDAQ",
    company: "Nova Retail Holdings, Inc.",
    title: "Nova Retail Reports First Quarter Results and Updates Guidance",
    formType: "10-Q",
    filedAt: "May 14, 2026 - 7:00 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "earnings",
    impact: "medium",
    deliveryLevel: "feed",
    score: 66,
    signal: "neutral",
    price: "$24.18",
    changeAmount: "+$0.62",
    change: "+2.63%",
    filingFocus: "Quarterly earnings",
    filingBrief:
      "Nova Retail reported first-quarter revenue growth, an EPS beat, softer margin guidance, and several small-cap risk signals in the filing.",
    whyItMatters:
      "The earnings page separates current quarter numbers from guidance quality, margin trend, and risk signals that often matter more for small-cap reactions.",
    bullishPoints: [
      "Revenue increased from the prior-year period.",
      "Revenue and EPS came in ahead of estimates.",
      "Management did not disclose a going-concern warning.",
    ],
    bearishPoints: [
      "Management cut margin outlook despite the headline beat.",
      "The filing references an active ATM program.",
      "Debt costs and liquidity remain watch items.",
    ],
    summary:
      "Nova Retail's quarter beat headline estimates, but the useful read is split between actual numbers, weaker guidance, compressing margins, and financing/liquidity risk signals.",
    keyEvidence: [
      "Quarterly revenue and net income disclosed in Form 10-Q.",
      "Management updated full-year revenue and margin outlook.",
      "The filing references ATM capacity and higher debt expense.",
    ],
    watchNext: [
      "Whether margin compression stabilizes next quarter.",
      "Any use of the ATM facility or additional financing.",
      "Debt covenant and liquidity language in the next filing.",
    ],
    recentFilings: [
      {
        form: "10-Q",
        eventType: "Earnings",
        title: "First quarter results and updated guidance",
        filedAt: "May 14",
        score: 66,
      },
      {
        form: "8-K",
        eventType: "Earnings",
        title: "Earnings release furnished",
        filedAt: "May 14",
        score: 68,
      },
    ],
    relatedNews: [
      { title: "Retail earnings focus shifts to margins and inventory quality", source: "Stock Radar", age: "2h ago" },
      { title: "Department store traffic remains mixed into summer", source: "Market Desk", age: "5h ago" },
    ],
    context: {
      sector: "Consumer Discretionary",
      industry: "Specialty Retail",
      marketCap: "$185.0M",
      themeGroup: "Consumer Spending",
      subTheme: "Retail Margins",
      periods: {
        "1D": {
          sectorChange: "+0.28%",
          industryChange: "+0.92%",
          themeScore: 66,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "NOVA", change: "+2.63%", trend: [44, 45, 47, 48, 50, 51, 52, 53, 55, 56] },
            { symbol: "XRT", change: "+0.58%", trend: [45, 46, 46, 47, 48, 48, 49, 50, 50, 51] },
          ],
        },
        "5D": {
          sectorChange: "+1.08%",
          industryChange: "+2.14%",
          themeScore: 67,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "NOVA", change: "+5.18%", trend: [40, 42, 43, 45, 47, 49, 51, 53, 54, 56] },
            { symbol: "XRT", change: "+1.44%", trend: [42, 43, 44, 45, 46, 47, 48, 49, 49, 50] },
          ],
        },
        "30D": {
          sectorChange: "+3.80%",
          industryChange: "+4.42%",
          themeScore: 66,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "NOVA", change: "+7.02%", trend: [38, 40, 42, 44, 45, 47, 49, 51, 53, 55] },
            { symbol: "XRT", change: "+3.28%", trend: [40, 41, 42, 43, 45, 46, 48, 49, 50, 51] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 24.18,
      previousClose: 23.56,
      trend: [44, 45, 47, 48, 50, 51, 52, 53, 55, 56, 55, 57],
      volumeBase: 2_300_000,
    }),
    originalTextNote: "Mock SEC filing text for earnings layout verification.",
    originalHtml: `
      <h3>Results of Operations</h3>
      <p>Revenue increased to $612.4 million for the quarter, compared with $584.1 million in the prior-year period. Net income was $18.6 million, compared with $24.2 million in the prior-year period.</p>
      <h3>Liquidity</h3>
      <p>Cash and cash equivalents were $142.0 million as of quarter end. Operating cash flow was affected by seasonal inventory purchases.</p>
      <h3>Outlook</h3>
      <p>The company maintained full-year revenue guidance of $2.45 billion to $2.55 billion and expects gross margin pressure to moderate in the second half.</p>
    `,
    displayPayload: {
      display_type: "earnings",
      data: {
        period_type: "quarterly",
        period: "Q1 2026",
        report_date: "May 14, 2026",
        revenue: "$612.4M",
        revenue_comparison: "+4.8% year over year",
        eps: "$0.28 diluted EPS",
        net_income: "$18.6M",
        yoy_growth: "+4.8%",
        estimate_beat_miss: "Beat: revenue +1.9%, EPS +$0.04 vs estimate",
        margin_summary: "Margins compressed despite the revenue beat.",
        gross_margin: "34.2%",
        operating_margin: "5.1%",
        ebitda_margin: "8.6%",
        guidance_summary: "Revenue outlook maintained, but margin outlook cut.",
        revenue_guidance: "$2.45B-$2.55B full-year revenue maintained",
        eps_guidance: "$0.92-$1.02 full-year EPS, narrowed lower",
        margin_guidance: "Gross margin outlook reduced by ~120 bps",
        guidance_tone: "Weak",
        guidance_change: "Mixed: revenue maintained, margin cut",
        forward_commentary: "Management cited cautious demand, higher freight costs, and debt expense pressure.",
        cash: "$142.0M cash and equivalents",
        cash_burn: "$18.0M operating cash outflow",
        runway: "More than 12 months based on current cash use",
        management_outlook: "Headline numbers beat, but forward commentary is weak because margin and financing language matter more than the quarter itself.",
        numbers: [
          { label: "Revenue", value: "$612.4M", comparison: "+4.8% YoY", note: "Beat estimate by 1.9%." },
          { label: "EPS", value: "$0.28", comparison: "+$0.04 beat", note: "Diluted EPS." },
          { label: "Net Income", value: "$18.6M", comparison: "-23.1% YoY", note: "Profit declined year over year." },
          { label: "YoY Growth", value: "+4.8%", comparison: "Revenue growth", note: "Current quarter sales growth." },
          { label: "Estimate Beat/Miss", value: "Beat", comparison: "Rev +1.9%, EPS +$0.04", note: "Only shown when estimate context exists." },
        ],
        actuals: [
          { label: "Revenue", value: "$612.4M", comparison: "+4.8% YoY", note: "Beat estimate by 1.9%." },
          { label: "EPS", value: "$0.28", comparison: "+$0.04 beat", note: "Diluted EPS." },
          { label: "Net Income", value: "$18.6M", comparison: "-23.1% YoY", note: "Profit declined year over year." },
        ],
        guidance: [
          { label: "Revenue Outlook", value: "$2.45B-$2.55B", comparison: "Maintained", note: "Management kept the revenue range." },
          { label: "EPS Outlook", value: "$0.92-$1.02", comparison: "Narrowed lower", note: "Forward EPS tone weakened." },
          { label: "Margin Outlook", value: "Cut ~120 bps", comparison: "Weak", note: "Margin guidance is the main reaction risk." },
        ],
        margin_metrics: [
          { label: "Gross Margin", value: "34.2%", comparison: "-180 bps YoY", note: "Compressing" },
          { label: "Operating Margin", value: "5.1%", comparison: "-90 bps YoY", note: "Compressing" },
          { label: "EBITDA Margin", value: "8.6%", comparison: "-60 bps YoY", note: "Stable to weaker" },
        ],
        margin_trend: "Compressing",
        margin_trend_note: "Gross and operating margins both declined year over year despite higher revenue.",
        segments: [
          { name: "Stores", revenue: "$438.0M", performance: "+6.1% YoY", note: "Comparable traffic improved." },
          { name: "E-commerce", revenue: "$174.4M", performance: "+1.9% YoY", note: "Growth slowed from prior period." },
        ],
        surprises: [
          { label: "Estimate Context", value: "Beat", comparison: "Revenue and EPS", note: "Consensus context supplied by mock payload." },
        ],
        risk_signals: [
          { label: "Going concern", status: "Clear", detail: "No going-concern warning disclosed.", tone: "clear" },
          { label: "Liquidity issue", status: "Watch", detail: "$18.0M operating cash outflow; cash remains positive.", tone: "watch" },
          { label: "Covenant risk", status: "Watch", detail: "Debt expense increased; no breach disclosed.", tone: "watch" },
          { label: "ATM / dilution mention", status: "Risk", detail: "Active ATM program referenced in liquidity section.", tone: "risk" },
          { label: "Financing need", status: "Watch", detail: "Working-capital needs could require financing if cash burn continues.", tone: "watch" },
          { label: "Debt pressure", status: "Risk", detail: "Higher interest expense reduced net income.", tone: "risk" },
          { label: "Nasdaq compliance risk", status: "Clear", detail: "No active listing deficiency disclosed.", tone: "clear" },
        ],
        risk_flags: [
          "Margin guidance weakened despite the headline beat.",
          "ATM facility is available and could create dilution if used.",
          "Higher interest expense and cash use remain small-cap risk signals.",
        ],
        watch_next: [
          "Whether gross margin stabilizes or compresses again.",
          "Any ATM sale, debt amendment, or financing update.",
          "Next-quarter guidance tone and cash-flow trend.",
        ],
        sources: [
          { title: "Form 10-Q", detail: "Quarterly financial statements and MD&A", form: "10-Q" },
          { title: "Management outlook", detail: "Guidance and margin commentary", form: "10-Q" },
        ],
      },
      evidence: [],
      notes: [],
    },
  },
  "atlas-phase-3-readout": {
    id: "atlas-phase-3-readout",
    ticker: "ATLS",
    exchange: "NASDAQ",
    company: "Atlas Oncology, Inc.",
    title: "Atlas Oncology Reports Phase 3 Trial Update for AT-201",
    formType: "8-K",
    filedAt: "May 21, 2026 - 7:15 AM ET",
    source: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov/edgar/search/",
    eventType: "fda_clinical",
    impact: "high",
    deliveryLevel: "alert",
    score: 82,
    signal: "volatile",
    price: "$11.42",
    changeAmount: "+$1.76",
    change: "+18.22%",
    filingFocus: "Phase 3 clinical update",
    filingBrief:
      "Atlas disclosed source-backed Phase 3 topline data for AT-201 in second-line ovarian cancer, with a survival endpoint update and planned FDA interaction.",
    whyItMatters:
      "Late-stage clinical readouts can reset regulatory probability, financing needs, and commercial expectations when endpoint detail and FDA timing are disclosed.",
    bullishPoints: [
      "The filing reports a statistically significant primary endpoint result.",
      "Management expects to request an FDA meeting after the topline disclosure.",
      "Safety was described as broadly consistent with prior studies.",
    ],
    bearishPoints: [
      "Overall survival remains immature.",
      "FDA filing timing is not yet confirmed.",
      "The company may need additional capital before commercialization.",
    ],
    summary:
      "Atlas Oncology disclosed Phase 3 topline data for AT-201, including a positive progression-free survival result, immature overall survival data, and an expected FDA meeting request.",
    keyEvidence: [
      "Phase 3 topline data disclosed in Form 8-K.",
      "Primary endpoint reported as statistically significant.",
      "FDA meeting request expected after topline data package completion.",
    ],
    watchNext: [
      "FDA meeting outcome and submission timing.",
      "Mature overall survival update.",
      "Financing or partnership update before launch preparation.",
    ],
    recentFilings: [
      {
        form: "8-K",
        eventType: "FDA / Clinical",
        title: "Phase 3 topline data disclosed",
        filedAt: "May 21",
        score: 82,
      },
      {
        form: "10-Q",
        eventType: "Financial Risk",
        title: "Quarterly report with runway disclosure",
        filedAt: "May 8",
        score: 61,
      },
    ],
    relatedNews: [
      { title: "Biotech investors watch late-stage oncology readouts", source: "Stock Radar", age: "1h ago" },
      { title: "Small-cap oncology names move on FDA meeting timing", source: "Market Desk", age: "3h ago" },
    ],
    context: {
      sector: "Healthcare",
      industry: "Biotechnology",
      marketCap: "$720.0M",
      themeGroup: "Oncology",
      subTheme: "Late-stage Clinical Readouts",
      periods: {
        "1D": {
          sectorChange: "+0.36%",
          industryChange: "+1.84%",
          themeScore: 82,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ATLS", change: "+18.22%", trend: [38, 39, 42, 45, 51, 57, 63, 68, 72, 76] },
            { symbol: "XBI", change: "+1.12%", trend: [42, 43, 44, 45, 46, 47, 49, 50, 51, 52] },
          ],
        },
        "5D": {
          sectorChange: "+1.62%",
          industryChange: "+4.40%",
          themeScore: 81,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ATLS", change: "+29.40%", trend: [32, 35, 37, 40, 48, 55, 63, 70, 75, 78] },
            { symbol: "XBI", change: "+2.36%", trend: [39, 40, 42, 43, 45, 46, 48, 49, 51, 52] },
          ],
        },
        "30D": {
          sectorChange: "+2.84%",
          industryChange: "+6.18%",
          themeScore: 80,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "ATLS", change: "+34.10%", trend: [30, 31, 35, 38, 43, 49, 56, 63, 70, 76] },
            { symbol: "XBI", change: "+5.92%", trend: [37, 38, 40, 42, 43, 45, 47, 49, 51, 53] },
          ],
        },
      },
    },
    priceSeries: buildPriceSeries({
      lastClose: 11.42,
      previousClose: 9.66,
      trend: [38, 39, 42, 45, 51, 57, 63, 68, 72, 76, 74, 78],
      volumeBase: 5_600_000,
    }),
    originalTextNote: "Mock SEC filing text for FDA clinical layout verification.",
    originalHtml: `
      <h3>Clinical Development Update</h3>
      <p>Atlas Oncology announced topline results from the Phase 3 AURORA-301 trial evaluating AT-201 in patients with second-line platinum-resistant ovarian cancer.</p>
      <h3>Topline Data</h3>
      <p>The study met its primary endpoint of progression-free survival. Overall survival data remain immature, and the safety profile was described as consistent with prior clinical experience.</p>
      <h3>Regulatory Timing</h3>
      <p>The company expects to request a meeting with the FDA after completing the topline data package.</p>
    `,
    displayPayload: {
      display_type: "fda_clinical",
      data: {
        phase: "Phase 3",
        indication: "Second-line platinum-resistant ovarian cancer",
        therapy: "AT-201",
        trial_name: "AURORA-301",
        event_status: "Topline Phase 3 data disclosed",
        event_summary: "Primary endpoint was met; overall survival remains immature and FDA timing is the next key checkpoint.",
        primary_endpoint: "Progression-free survival",
        patient_population: "Patients with second-line platinum-resistant ovarian cancer",
        data_readout: "Positive PFS topline result; OS immature",
        next_milestone: "FDA meeting request after topline package completion",
        fda_status: "FDA meeting not yet held",
        key_takeaways: [
          "Phase 3 topline data are now disclosed, moving the program into regulatory-preparation mode.",
          "The primary endpoint was met, but mature overall survival remains an important follow-up.",
          "FDA meeting timing is the next investor-relevant checkpoint before any filing plan.",
          "Runway and partnership updates matter because launch preparation may require additional capital.",
        ],
        fda_timeline: [
          { label: "Trial readout", date: "May 2026", status: "Current", detail: "Topline Phase 3 result disclosed in the filing." },
          { label: "FDA meeting request", date: "Expected after topline package", status: "Pending", detail: "No meeting outcome disclosed yet." },
          { label: "Submission path", date: "Not disclosed", status: "Watch", detail: "Filing timing depends on FDA feedback and mature data package." },
          { label: "Next data update", date: "Not disclosed", status: "Watch", detail: "Overall survival maturity remains a key follow-up." },
        ],
        data_highlights: [
          { label: "Primary endpoint", value: "Met", note: "PFS result described as statistically significant." },
          { label: "Overall survival", value: "Immature", note: "Follow-up data still needed." },
          { label: "Safety", value: "Consistent", note: "No new safety signal highlighted in the mock filing." },
        ],
        risks: [
          "Overall survival data are not mature.",
          "FDA feedback could alter submission timing or required evidence.",
          "Commercial preparation may require additional capital.",
        ],
        watch_next: [
          "FDA meeting request and minutes.",
          "Mature overall survival update.",
          "Cash runway, partnership, or financing disclosure.",
        ],
        market_size: "Addressable market size not quantified in this filing; oncology indication is investor-relevant but should stay source-backed.",
        market_size_source: "SEC filing did not disclose a numeric market-size estimate.",
        sources: [
          { title: "Form 8-K", detail: "Topline Phase 3 clinical update", form: "8-K" },
          { title: "Clinical readout exhibit", detail: "Endpoint, safety, and regulatory timing summary", form: "EX-99.1" },
        ],
      },
      evidence: [],
      notes: [],
    },
  },
};

export function generateStaticParams() {
  return Object.keys(commonFilingEvents).map((id) => ({ id }));
}

export default async function FilingDetailPage({ params }: FilingDetailPageProps) {
  const { id } = await params;
  const filing = await resolveFilingEvent(id);
  const eventBadge = getEventTypeBadge(filing.eventType);
  const ipoModel = buildIpoListingModel(filing);
  const useIpoDetail = Boolean(ipoModel);
  const spacModel = !useIpoDetail ? buildSpacTransactionStatusModel(filing) : null;
  const useSpacDetail = Boolean(spacModel);
  const canUseDilutionDetail = canRenderDilutionOfferingDetail(filing);
  const listingRiskModel = !useIpoDetail && !useSpacDetail && !canUseDilutionDetail ? buildListingRiskModel(filing) : null;
  const useListingRiskDetail = Boolean(listingRiskModel);
  const earningsModel = !useIpoDetail && !useSpacDetail && !useListingRiskDetail ? buildEarningsModel(filing) : null;
  const useEarningsDetail = Boolean(earningsModel);
  const fdaClinicalModel =
    !useIpoDetail && !useSpacDetail && !useListingRiskDetail && !useEarningsDetail ? buildFdaClinicalModel(filing) : null;
  const useFdaClinicalDetail = Boolean(fdaClinicalModel);
  const dilutionModel =
    !useIpoDetail &&
    !useSpacDetail &&
    !useListingRiskDetail &&
    !useEarningsDetail &&
    !useFdaClinicalDetail &&
    canUseDilutionDetail
        ? buildDilutionOfferingModel(filing)
        : null;
  const useDilutionDetail = Boolean(
    dilutionModel &&
      (dilutionModel.isS8DetailCandidate || !dilutionModel.isCommonWarrantOnly)
  );

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
                {useIpoDetail ? <span className="filing-template-chip">IPO Listing</span> : null}
                {useSpacDetail ? <span className="filing-template-chip">SPAC Transaction Status</span> : null}
                {useListingRiskDetail ? <span className="filing-template-chip">Listing Risk</span> : null}
                {useEarningsDetail ? <span className="filing-template-chip">Earnings</span> : null}
                {useFdaClinicalDetail ? <span className="filing-template-chip">FDA Clinical</span> : null}
              </div>
            </div>
          </section>

          {useIpoDetail && ipoModel ? (
            <IpoListingTemplate eventLabel={eventBadge.label} filing={filing} model={ipoModel} />
          ) : useSpacDetail && spacModel ? (
            <SpacTransactionStatusTemplate eventLabel={eventBadge.label} filing={filing} model={spacModel} />
          ) : useListingRiskDetail && listingRiskModel ? (
            <ListingRiskTemplate eventLabel={eventBadge.label} filing={filing} model={listingRiskModel} />
          ) : useEarningsDetail && earningsModel ? (
            <EarningsTemplate eventLabel={eventBadge.label} filing={filing} model={earningsModel} />
          ) : useFdaClinicalDetail && fdaClinicalModel ? (
            <FdaClinicalTemplate eventLabel={eventBadge.label} filing={filing} model={fdaClinicalModel} />
          ) : useDilutionDetail && dilutionModel ? (
            <DilutionOfferingTemplate eventLabel={eventBadge.label} filing={filing} model={dilutionModel} />
          ) : (
            <CommonFilingTemplate eventLabel={eventBadge.label} filing={filing} />
          )}
        </article>

        <aside className="stock-detail-rail">
          {filing.recentFilings.length ? (
            <section className="stock-detail-card recent-filings-card">
              <div className="card-heading-row">
                <div>
                  <h2>{useDilutionDetail ? "Related Filings" : "Recent Filings"}</h2>
                  <p>{useDilutionDetail ? `${filing.ticker} related filing history` : `${filing.ticker} filing history`}</p>
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
          ) : null}

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
            {useDilutionDetail && filing.scoreExplanation ? (
              <a className="score-rationale-link" href="#score-rationale">
                View score rationale
              </a>
            ) : null}
          </section>

          {filing.relatedNews.length ? (
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
          ) : null}

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
  const fallback = commonFilingEvents[id];

  if (!isUuid(id)) {
    if (!fallback) notFound();
    return hydrateFallbackFilingPriceSeries(fallback);
  }

  const detailResult = await getLiveEventDetail(id);
  const item = detailResult.item;

  if (!item || item.sourceGroup !== "filings") {
    notFound();
  }

  if (item.deliveryLevel === "archive" && (await shouldUseCompactArchiveFilingPage(item.id))) {
    redirect(`/filings/archive/${item.id}`);
  }

  return buildDbFilingEvent(item, commonFilingEvents["tsla-8k-operational-update"]);
}

async function hydrateFallbackFilingPriceSeries(filing: FilingEvent): Promise<FilingEvent> {
  const existingPoints = filing.priceSeries.periods["1D"] || [];
  if (existingPoints.length) return filing;

  const remoteSeries = await fetchInitialFilingPriceSeries(filing.ticker);
  return remoteSeries ? { ...filing, priceSeries: remoteSeries } : filing;
}

function canRenderDilutionOfferingDetail(filing: FilingEvent) {
  const displayPayload = readPlainRecord(filing.displayPayload);
  const displayType = readRowString(displayPayload, "display_type");
  const displayData = readDisplayPayloadData(displayPayload);
  const formType = filing.formType.trim().toUpperCase();
  const isTenderCbForm = /^(?:CB|SC TO|SC TO-I|SC TO-T|SC 13E3|SC 14D9)(?:\/A)?$/.test(formType);
  const isS8Form = /^S-8(?:\/A|\s+POS)?$/.test(formType);
  const isS1F1OfferingForm = /^(?:S-1(?:\/A|MEF)?|F-1(?:\/A|MEF)?|POS AM)$/.test(formType);
  const hasS8Mode = Boolean(readRowString(displayData, "s8_ui_mode") || readRowString(displayData, "s8UiMode"));

  if (isTenderCbForm && displayType !== "offering_terms") return false;
  if (displayType === "offering_terms" && isS1F1OfferingForm) return true;
  if (filing.eventType !== "dilution_risk") return false;

  return Boolean(
    displayType === "offering_terms" ||
      (isS8Form && hasS8Mode) ||
      filing.offeringDisplayModel ||
      filing.offeringTerms,
  );
}

async function shouldUseCompactArchiveFilingPage(eventId: string) {
  const result = await fetchEventById(eventId);
  const eventRow = toRecord(result.data);
  if (!eventRow) return true;

  const metadata = toRecord(eventRow.metadata);
  const archiveRoute = readRowString(metadata, "archive_route");
  if (archiveRoute === "common_filing_detail") return false;
  if (archiveRoute === "compact_archive") return true;

  const runtimeSource = readRowString(metadata, "analysis_runtime_source");
  if (runtimeSource === "llm") return false;
  if (runtimeSource === "parser_deterministic") return true;

  return !readRowString(metadata, "openai_response_id");
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
      ? fetchEventsByTicker({
          ticker,
          sourceGroup: "filings",
          excludeId: item.id,
          limit: item.eventType === "insider_ownership" ? 12 : 4,
        })
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
  const displayPayload =
    readPlainRecord(analysis?.display_payload) ||
    readPlainRecord(analysisMetadata?.display_payload) ||
    readPlainRecord(metadata?.display_payload);
  const transactionFingerprint =
    readPlainRecord(metadata?.transaction_fingerprint) ||
    readPlainRecord(analysisMetadata?.transaction_fingerprint) ||
    readPlainRecord(analysis?.transaction_fingerprint);
  const offeringTerms = readPlainRecord(offeringTermsResult);
  const rawPayload = toRecord(rawItem?.raw_payload);
  const badge = getEventTypeBadge(item.eventType);
  const formType = readFilingFormType(eventRow, rawPayload, item.title);
  const filedAt = formatSecFilingDateTime(
    readRowString(eventRow, "published_at") || item.detectedAtRaw || readRowString(eventRow, "detected_at"),
    rawPayload,
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
  const primaryDocumentUrl = readPrimaryDocumentUrl(rawPayload, eventRow, sourceUrl);
  const originalHtml = await readOriginalHtml(eventRow, rawItem, rawPayload, primaryDocumentUrl);
  const recentFilingRows = toRows(recentFilingsResult.data);
  const sc13IssuerRelatedRows =
    item.eventType === "insider_ownership" && isSc13OwnershipForm(formType)
      ? await fetchSc13RelatedFilingRowsByIssuer({
          currentId: item.id,
          metadata,
          rawPayload,
          title: item.title,
        })
      : [];
  const ownershipRelationRows = dedupeRowsById([...recentFilingRows, ...sc13IssuerRelatedRows]);
  const recentFilings = mapRecentFilingRows(recentFilingRows, item.id, []);
  const ownershipRelatedFilings =
    item.eventType === "insider_ownership"
      ? await buildOwnershipRelatedFilings({
          currentId: item.id,
          currentFormType: formType,
          currentTitle: item.title,
          displayPayload,
          metadata,
          rawPayload,
          recentRows: ownershipRelationRows,
        })
      : undefined;
  const contextRelatedFilings = buildFilingContextRelatedFilings({
    currentId: item.id,
    metadata,
  });

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
    primaryDocumentUrl,
    eventType: item.eventType,
    impact: item.impact,
    deliveryLevel: item.deliveryLevel,
    score: item.score,
    scoreExplanation:
      readScoreExplanation(analysis) ||
      readScoreExplanation(analysisMetadata) ||
      readScoreReasonFallback(item.scoreReason),
    signal: item.signal,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    filingFocus: readMetadataString(eventRow, "filing_focus") || `${formType} disclosure`,
    filingBrief: item.quickTake || item.summary || fallback.filingBrief,
    whyItMatters: readRowString(analysis, "why_it_matters") || item.scoreReason || fallback.whyItMatters,
    bullishPoints: toStringArray(analysis?.bullish_points, []),
    bearishPoints: toStringArray(analysis?.bearish_points, []),
    summary: item.summary || fallback.summary,
    keyEvidence: toStringArray(analysis?.key_evidence, []),
    watchNext: toStringArray(analysis?.watch_next, []),
    recentFilings,
    ownershipRelatedFilings,
    contextRelatedFilings,
    relatedNews: mapRelatedNewsRows(toRows(relatedNewsResult.data), []),
    context: await buildDbMarketContext(item, eventRow),
    priceMarkers: buildFilingPriceMarkers({
      displayPayload,
      filingTicker: ticker,
      offeringTerms,
      transactionFingerprint,
    }),
    priceSeries: await buildDbFilingPriceSeries(item, ticker),
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
    offeringTerms,
    s3Case:
      readRowString(analysis, "s3_case") ||
      readRowString(analysisMetadata, "s3_case") ||
      readRowString(metadata, "s3_case") ||
      null,
    displayPayload: displayPayload as FilingDisplayPayload | null,
  };
}

async function buildDbFilingPriceSeries(item: LiveFeedItem, ticker: string): Promise<PriceChartSeries> {
  const chartBars = item.displayChartBars.length ? item.displayChartBars : item.chartBars;
  const barSeries = buildDbFilingPriceSeriesFromBars(chartBars);
  if (barSeries) return barSeries;

  const remoteSeries = await fetchInitialFilingPriceSeries(ticker);
  if (remoteSeries) return remoteSeries;

  return emptyFilingPriceSeries();
}

function buildDbFilingPriceSeriesFromBars(bars: LiveFeedItem["chartBars"]): PriceChartSeries | null {
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

function emptyFilingPriceSeries(): PriceChartSeries {
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

type FilingChartApiResponse = {
  ok?: boolean;
  points?: PricePoint[];
  previousClose?: number;
  providerLabel?: string;
};

async function fetchInitialFilingPriceSeries(ticker: string): Promise<PriceChartSeries | null> {
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return null;

  const appBaseUrl = await resolveMarketChartBaseUrl();

  try {
    const response = await fetch(
      `${appBaseUrl}/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=1D`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as FilingChartApiResponse;
    const points = Array.isArray(data.points)
      ? data.points.filter((point) =>
          point.time &&
          Number.isFinite(point.close) &&
          Number.isFinite(point.high) &&
          Number.isFinite(point.low) &&
          Number.isFinite(point.open),
        )
      : [];
    const previousClose = Number(data.previousClose);
    if (!data.ok || !points.length || !Number.isFinite(previousClose) || previousClose <= 0) return null;

    return {
      providerLabel: data.providerLabel || "Market data",
      previousClose,
      periods: {
        "1D": points,
        "5D": points,
        "1M": points,
        "3M": points,
        "1Y": points,
      },
    };
  } catch {
    return null;
  }
}

async function resolveMarketChartBaseUrl() {
  try {
    const headerList = await headers();
    const host = headerList.get("host");
    if (host) {
      const forwardedProto = headerList.get("x-forwarded-proto");
      const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return `${protocol}://${host}`;
    }
  } catch {
    // Use configured app URL when this helper runs outside a request context.
  }

  return getServerEnv().appBaseUrl.replace(/\/$/, "") || "http://127.0.0.1:3002";
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

async function readOriginalHtml(
  eventRow: Record<string, unknown> | null,
  rawItem: Record<string, unknown> | null,
  rawPayload: Record<string, unknown> | null,
  primaryDocumentUrl: string,
) {
  const storedHtml =
    readRowString(rawPayload, "full_text_html") ||
    readRowString(rawPayload, "filing_html") ||
    readRowString(rawPayload, "primary_document_html") ||
    readMetadataString(eventRow, "full_text_html") ||
    readMetadataString(eventRow, "filing_html");
  if (storedHtml) return storedHtml;

  const fetchedHtml = await fetchSecPrimaryDocumentHtml(primaryDocumentUrl);
  if (fetchedHtml) return fetchedHtml;

  return bodyTextToHtml(
    readRowString(rawItem, "body_text") ||
      readRowString(rawPayload, "body_text") ||
      readMetadataString(eventRow, "filing_text") ||
      readMetadataString(eventRow, "original_text"),
  );
}

async function fetchSecPrimaryDocumentHtml(url: string) {
  if (!isSecPrimaryDocumentUrl(url)) return "";

  try {
    const response = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 24 },
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": process.env.SEC_USER_AGENT || process.env.SEC_EDGAR_USER_AGENT || "StockRadar/1.0 contact@stockradar.local",
      },
    });
    if (!response.ok) return "";

    const text = await response.text();
    if (!isRenderableSecPrimaryDocument(text)) return "";
    return text.length > 2_000_000 ? text.slice(0, 2_000_000) : text;
  } catch {
    return "";
  }
}

function isRenderableSecPrimaryDocument(value: string) {
  return /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value) || /<table[\s>]/i.test(value);
}

function readPrimaryDocumentUrl(
  rawPayload: Record<string, unknown> | null,
  eventRow: Record<string, unknown> | null,
  fallbackUrl: string,
) {
  const explicit =
    readRowString(rawPayload, "primary_document_url") ||
    readRowString(rawPayload, "primaryDocumentUrl") ||
    readMetadataString(eventRow, "primary_document_url");
  if (isSecPrimaryDocumentUrl(explicit)) return explicit;

  const documentUrl = recordArray(rawPayload?.documents)
    .filter((document) => Boolean(document.isPrimary))
    .map((document) => readRowString(document, "url"))
    .find(isSecPrimaryDocumentUrl);
  if (documentUrl) return documentUrl;

  return isSecPrimaryDocumentUrl(fallbackUrl) ? fallbackUrl : explicit || fallbackUrl;
}

function isSecPrimaryDocumentUrl(url: string) {
  return /^https:\/\/www\.sec\.gov\/Archives\//i.test(url) && !/-index\.html?$/i.test(url);
}

async function buildDbMarketContext(
  item: LiveFeedItem,
  eventRow: Record<string, unknown> | null,
): Promise<SectorThemeContext | undefined> {
  const metadata = toRecord(eventRow?.metadata);
  const marketContext = readPlainRecord(metadata?.market_context);
  if (!marketContext || !hasUsableMarketContext(marketContext)) {
    return undefined;
  }

  const ticker = item.ticker.trim().toUpperCase();
  if (!isRealTicker(ticker)) {
    return undefined;
  }

  const contextSymbol = (
    readRowString(marketContext, "symbol") ||
    readRowString(marketContext, "ticker") ||
    ticker
  ).toUpperCase();
  if (contextSymbol && contextSymbol !== ticker) {
    return undefined;
  }

  const sector = readRowString(marketContext, "sector") || readRowString(metadata, "sector") || readRowString(metadata, "sector_name");
  const industry =
    readRowString(marketContext, "industry") ||
    readRowString(marketContext, "industry_group") ||
    readRowString(marketContext, "sub_category") ||
    readRowString(metadata, "industry_group") ||
    readRowString(metadata, "industry") ||
    readRowString(metadata, "sub_category") ||
    readRowString(metadata, "subCategory");
  const fmpSector = readRowString(marketContext, "fmp_sector") || sector;
  const fmpIndustry = readRowString(marketContext, "fmp_industry") || industry;

  if (!sector && !industry) {
    return undefined;
  }

  const topMoversByRange = await buildDbMarketContextTopMovers({
    fmpIndustry,
    fmpSector,
    industry,
    item,
    sector,
    ticker,
  });

  return {
    sector: sector || "Market",
    industry: industry || sector || "Market",
    marketCap: formatMarketContextNumber(marketContext.market_cap) || readRowString(marketContext, "market_cap") || undefined,
    sharesOutstanding: formatMarketContextShares(marketContext.shares_outstanding),
    publicFloat: formatMarketContextShares(marketContext.public_float),
    floatPercent: formatMarketContextFloatPercent(marketContext),
    themeGroup:
      readRowString(marketContext, "theme_group") ||
      readRowString(marketContext, "themeGroup") ||
      readRowString(metadata, "theme_group") ||
      readRowString(metadata, "themeGroup") ||
      undefined,
    subTheme:
      readRowString(marketContext, "sub_theme") ||
      readRowString(marketContext, "subTheme") ||
      readRowString(metadata, "sub_theme") ||
      readRowString(metadata, "subTheme") ||
      undefined,
    periods: {
      "1D": {
        sectorChange: readRowString(metadata, "sector_change_1d"),
        industryChange: readRowString(metadata, "industry_change_1d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers: topMoversByRange["1D"],
      },
      "5D": {
        sectorChange: readRowString(metadata, "sector_change_5d"),
        industryChange: readRowString(metadata, "industry_change_5d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers: topMoversByRange["5D"],
      },
      "30D": {
        sectorChange: readRowString(metadata, "sector_change_30d"),
        industryChange: readRowString(metadata, "industry_change_30d"),
        themeScore: item.score,
        themeSignal: item.signal,
        topMovers: topMoversByRange["30D"],
      },
    },
  };
}

async function buildDbMarketContextTopMovers({
  fmpIndustry,
  fmpSector,
  industry,
  item,
  sector,
  ticker,
}: {
  fmpIndustry: string;
  fmpSector: string;
  industry: string;
  item: LiveFeedItem;
  sector: string;
  ticker: string;
}): Promise<Record<ContextRange, TopMover[]>> {
  const snapshots = await readFilingContextSnapshots();
  const fallbackMover = buildCurrentTickerMover(item, ticker);
  const peerMovers = await buildPeerVolatilityMovers({
    fmpIndustry,
    fmpSector,
    fallbackMover,
    ticker,
  });

  return {
    "1D": buildDbMarketContextRangeTopMovers({
      fallbackMover,
      industry,
      peerMovers,
      range: "1D",
      sector,
      snapshots: snapshots["1D"],
    }),
    "5D": buildDbMarketContextRangeTopMovers({
      fallbackMover,
      industry,
      peerMovers,
      range: "5D",
      sector,
      snapshots: snapshots["5D"],
    }),
    "30D": buildDbMarketContextRangeTopMovers({
      fallbackMover,
      industry,
      peerMovers,
      range: "30D",
      sector,
      snapshots: snapshots["30D"],
    }),
  };
}

function buildDbMarketContextRangeTopMovers({
  fallbackMover,
  industry,
  peerMovers,
  range,
  sector,
  snapshots,
}: {
  fallbackMover: TopMover | null;
  industry: string;
  peerMovers: TopMover[];
  range: ContextRange;
  sector: string;
  snapshots: MarketGroupSnapshotPayload[];
}) {
  const industrySnapshot = findFilingGroupSnapshot(snapshots, "industry_group", industry);
  const sectorSnapshot = findFilingGroupSnapshot(snapshots, "sector", sector);
  const snapshotMovers = buildFilingSnapshotTopMovers(industrySnapshot || sectorSnapshot, range);

  if (snapshotMovers.length) {
    return snapshotMovers;
  }
  if (peerMovers.length) {
    return peerMovers;
  }
  return fallbackMover ? [fallbackMover] : [];
}

async function buildPeerVolatilityMovers({
  fallbackMover,
  fmpIndustry,
  fmpSector,
  ticker,
}: {
  fallbackMover: TopMover | null;
  fmpIndustry: string;
  fmpSector: string;
  ticker: string;
}): Promise<TopMover[]> {
  const peerSymbols = await readFilingPeerSymbols({ fmpIndustry, fmpSector, ticker });
  const quoteSymbols = uniqueSymbols([ticker, ...peerSymbols]).filter(isSectorMoverSymbol).slice(0, 40);
  if (!quoteSymbols.length) {
    return fallbackMover ? [fallbackMover] : [];
  }

  const quoteResult = await fetchFmpQuotes(quoteSymbols);
  const quoteRows = recordArray(quoteResult.data);
  const quoteMovers = quoteRows
    .map((row) => {
      const symbol = readRowString(row, "symbol").toUpperCase();
      const changePercent = readFmpQuoteChangePercent(row);
      if (!isSectorMoverSymbol(symbol) || changePercent === null) return null;
      return {
        change: formatSignedPercent(changePercent),
        changePercent,
        symbol,
        trend: buildFilingContextTrend(0, "1D"),
      };
    })
    .filter((mover): mover is TopMover & { changePercent: number } => Boolean(mover));

  const selected = selectBalancedVolatilityMovers(quoteMovers).map(({ changePercent: _changePercent, ...mover }) => mover);
  if (selected.length) {
    return selected;
  }
  return fallbackMover ? [fallbackMover] : [];
}

async function readFilingPeerSymbols({
  fmpIndustry,
  fmpSector,
  ticker,
}: {
  fmpIndustry: string;
  fmpSector: string;
  ticker: string;
}) {
  const industryRows = fmpIndustry
    ? await readFilingPeerTickerRows({
        column: "fmp_industry",
        value: fmpIndustry,
      })
    : [];
  const sectorRows =
    industryRows.length >= FILING_CONTEXT_MOVER_LIMIT || !fmpSector
      ? []
      : await readFilingPeerTickerRows({
          column: "fmp_sector",
          value: fmpSector,
        });

  return uniqueSymbols([
    ...industryRows.map((row) => readRowString(row, "symbol")),
    ...sectorRows.map((row) => readRowString(row, "symbol")),
  ]).filter((symbol) => symbol !== ticker);
}

async function readFilingPeerTickerRows({ column, value }: { column: "fmp_industry" | "fmp_sector"; value: string }) {
  const result = await supabaseSelect("tickers", {
    select: "symbol,name,asset_type,market_cap,fmp_sector,fmp_industry,is_active",
    [column]: `eq.${value}`,
    is_active: "eq.true",
    asset_type: "in.(stock,adr,adr_or_class)",
    order: "market_cap.desc",
    limit: "80",
  });

  return recordArray(result.data).filter((row) => isSectorMoverSymbol(readRowString(row, "symbol").toUpperCase()));
}

function selectBalancedVolatilityMovers<T extends TopMover & { changePercent: number }>(movers: T[]) {
  const sorted = uniqueTickerMoversWithChange(movers).sort(
    (left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent),
  );
  const gainers = sorted.filter((mover) => mover.changePercent > 0);
  const losers = sorted.filter((mover) => mover.changePercent < 0);
  const selected: T[] = [];

  while (selected.length < FILING_CONTEXT_MOVER_LIMIT && (gainers.length || losers.length)) {
    const nextGainer = gainers.shift();
    if (nextGainer) selected.push(nextGainer);
    if (selected.length >= FILING_CONTEXT_MOVER_LIMIT) break;
    const nextLoser = losers.shift();
    if (nextLoser) selected.push(nextLoser);
  }

  for (const mover of sorted) {
    if (selected.length >= FILING_CONTEXT_MOVER_LIMIT) break;
    if (!selected.some((item) => item.symbol === mover.symbol)) selected.push(mover);
  }

  return selected.slice(0, FILING_CONTEXT_MOVER_LIMIT);
}

function uniqueTickerMoversWithChange<T extends TopMover & { changePercent: number }>(movers: T[]) {
  const seen = new Set<string>();
  return movers.filter((mover) => {
    const symbol = mover.symbol.toUpperCase();
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    return true;
  });
}

function readFmpQuoteChangePercent(row: Record<string, unknown>) {
  const value =
    readNullableNumber(row, "change_percent") ??
    readNullableNumber(row, "changesPercentage") ??
    readNullableNumber(row, "changePercentage");
  return value !== null && Number.isFinite(value) ? value : null;
}

function readNullableNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readFilingContextSnapshots(): Promise<FilingContextSnapshotMap> {
  const now = Date.now();
  if (filingContextSnapshotCache && filingContextSnapshotCache.expiresAt > now) {
    return filingContextSnapshotCache.snapshots;
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

  filingContextSnapshotCache = {
    expiresAt: now + 30_000,
    snapshots,
  };
  return snapshots;
}

function buildFilingSnapshotTopMovers(snapshot: MarketGroupSnapshotPayload | undefined, range: ContextRange): TopMover[] {
  if (!snapshot?.topMovers.length) {
    return [];
  }

  return uniqueTickerMovers(
    snapshot.topMovers
      .map((mover, index) => ({
        change: formatSignedPercent(mover.changePercent),
        symbol: mover.symbol.toUpperCase(),
        trend: snapshot.trendPoints.length
          ? offsetFilingTrend(snapshot.trendPoints, index)
          : buildFilingContextTrend(index, range),
      }))
      .filter((mover) => isSectorMoverSymbol(mover.symbol)),
  ).slice(0, FILING_CONTEXT_MOVER_LIMIT);
}

function buildCurrentTickerMover(item: LiveFeedItem, ticker: string): TopMover | null {
  if (!isRealTicker(ticker)) return null;
  return {
    change: item.change,
    symbol: ticker,
    trend: item.trend.length ? item.trend : buildFilingContextTrend(0, "1D"),
  };
}

function uniqueSymbols(symbols: string[]) {
  const seen = new Set<string>();
  return symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => {
      if (!isRealTicker(symbol) || seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    });
}

function uniqueTickerMovers(movers: TopMover[]) {
  const seen = new Set<string>();
  return movers.filter((mover) => {
    const symbol = mover.symbol.toUpperCase();
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    return true;
  });
}

function isSectorMoverSymbol(symbol: string) {
  return isRealTicker(symbol) && !BROAD_MARKET_MOVER_SYMBOLS.has(symbol.toUpperCase());
}

function findFilingGroupSnapshot(
  snapshots: MarketGroupSnapshotPayload[],
  scope: MarketGroupSnapshotPayload["scope"],
  label: string,
) {
  if (!label) return undefined;
  const normalizedLabel = normalizeFilingGroupLabel(label);

  return snapshots.find(
    (snapshot) =>
      snapshot.scope === scope &&
      (normalizeFilingGroupLabel(snapshot.groupName) === normalizedLabel ||
        normalizeFilingGroupLabel(snapshot.groupKey) === normalizedLabel),
  );
}

function normalizeFilingGroupLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function buildFilingContextTrend(offset: number, range: ContextRange): number[] {
  const multiplier = range === "30D" ? 1.7 : range === "5D" ? 1.25 : 1;
  return [40, 41, 40, 42, 41, 42, 43, 42, 43, 44].map((value, index) =>
    Math.round(value * multiplier + offset * 2 + (index % 3)),
  );
}

function offsetFilingTrend(values: number[], offset: number) {
  return values.map((value, index) => Number((value + offset * 0.35 + (index % 2) * 0.1).toFixed(2)));
}

function FilingMarketContextPanel({ filing }: { filing: FilingEvent }) {
  const context = filing.context;
  const relatedFilings = <FilingRelatedFilingsPanel filing={filing} />;
  const marketDataPending = isRegistrationMarketDataPending(filing);
  if (!isRealTicker(filing.ticker)) return relatedFilings;
  if (!context || !hasRenderableFilingMarketContext(context)) {
    return (
      <>
        {relatedFilings}
        <FilingMarketContextUnavailablePanel marketDataPending={marketDataPending} ticker={filing.ticker} />
      </>
    );
  }

  return (
    <>
      {relatedFilings}
      <SectorThemeContextPanel context={context} ticker={filing.ticker} />
    </>
  );
}

function FilingMarketContextUnavailablePanel({
  marketDataPending,
  ticker,
}: {
  marketDataPending: boolean;
  ticker: string;
}) {
  return (
    <section className="stock-detail-card sector-theme-main-card">
      <div className="card-heading-row context-heading-row">
        <div>
          <h2>{ticker} Market Context</h2>
          <p className="market-context-data-disclaimer">Market data is latest available, not necessarily as of the filing date.</p>
        </div>
      </div>
      <p className="context-empty-state">
        {marketDataPending
          ? "Market data is pending until regular trading data becomes available."
          : "Market context data is not available for this ticker yet."}
      </p>
    </section>
  );
}

function isRegistrationMarketDataPending(filing: FilingEvent) {
  const formType = filing.formType.trim().toUpperCase();
  if (!/^(?:S-1|S-1\/A|F-1|F-1\/A|S-1MEF|F-1MEF|POS AM)$/.test(formType)) return false;

  const sourceText = [
    filing.title,
    filing.filingBrief,
    filing.summary,
    filing.whyItMatters,
    readRowString(readDisplayPayloadData(readPlainRecord(filing.displayPayload)), "display_mode"),
  ]
    .filter(Boolean)
    .join(" ");
  return /\b(?:ipo|initial public offering|listing|nasdaq|nyse|registration statement|post-effective amendment)\b/i.test(sourceText);
}

function hasRenderableFilingMarketContext(context: SectorThemeContext) {
  return Boolean(
    cleanContextValue(context.sector) ||
      cleanContextValue(context.industry) ||
      cleanContextValue(context.themeGroup) ||
      cleanContextValue(context.subTheme) ||
      cleanContextValue(context.marketCap),
  );
}

function hasUsableMarketContext(marketContext: Record<string, unknown>) {
  return Boolean(
    readRowString(marketContext, "symbol") ||
      readRowString(marketContext, "ticker") ||
      readRowString(marketContext, "sector") ||
      readRowString(marketContext, "industry") ||
      readRowString(marketContext, "industry_group") ||
      readRowString(marketContext, "sub_category") ||
      readRowString(marketContext, "market_cap") ||
      readRowNumber(marketContext, "market_cap"),
  );
}

function formatMarketContextNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) && numberValue > 0 ? formatMoneyValue(numberValue) : "";
}

function formatMarketContextShares(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) && numberValue > 0 ? formatCompactShareCount(numberValue) : undefined;
}

function formatMarketContextFloatPercent(marketContext: Record<string, unknown>) {
  const directValue = readRowNumber(marketContext, "public_float_percent");
  if (directValue > 0) {
    return formatPercentCompact(directValue <= 1 ? directValue * 100 : directValue) || undefined;
  }

  const publicFloat = readRowNumber(marketContext, "public_float");
  const sharesOutstanding = readRowNumber(marketContext, "shares_outstanding");
  if (!publicFloat || !sharesOutstanding) return undefined;
  return formatPercentCompact((publicFloat / sharesOutstanding) * 100) || undefined;
}

function cleanContextValue(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  if (!cleaned || cleaned === "-" || /^n\/?a$/i.test(cleaned) || /^not disclosed$/i.test(cleaned)) return "";
  return cleaned;
}

function FilingPriceChart({ filing }: { filing: FilingEvent }) {
  return (
    <PriceChartCard
      change={filing.change}
      changeAmount={filing.changeAmount}
      markers={filing.priceMarkers}
      price={filing.price}
      series={filing.priceSeries}
      ticker={filing.ticker}
      tone={filing.signal}
      tradingDataPending={isRegistrationMarketDataPending(filing)}
    />
  );
}

function CommonFilingTemplate({ eventLabel, filing }: { eventLabel: string; filing: FilingEvent }) {
  const hasPositivePoints = filing.bullishPoints.length > 0;
  const hasNegativePoints = filing.bearishPoints.length > 0;
  const hasCasePoints = hasPositivePoints || hasNegativePoints;
  const caseGridMode = hasPositivePoints && hasNegativePoints ? "two-up" : "single";
  const hasEvidenceOrWatch = filing.keyEvidence.length > 0 || filing.watchNext.length > 0;

  return (
    <>
      <section className={`stock-detail-top-grid${hasCasePoints ? " common-overview-no-divider" : ""}`}>
        <FilingPriceChart filing={filing} />

        <div className="stock-detail-card quick-analysis-panel">
          <div className="quick-take-card quick-take-block">
            <div className="card-heading-row">
              <h2>Why It Matters</h2>
              <span>{filing.filingFocus}</span>
            </div>
            <p>{filing.whyItMatters}</p>
            <div className="detail-chip-row">
              <span>{filing.formType}</span>
              <span>{eventLabel}</span>
              <span>{filing.impact} impact</span>
              <span>{filing.deliveryLevel}</span>
            </div>
            <div className="quick-summary-block">
              <h3>Summary</h3>
              <p>{filing.summary}</p>
            </div>
          </div>
        </div>
      </section>

      {hasCasePoints ? (
        <section className="stock-detail-card quick-analysis-panel">
          <div className={`quick-case-grid ${caseGridMode}`}>
            <CaseList title="Positive" tone="bullish" items={filing.bullishPoints} />
            <CaseList title="Negative" tone="bearish" items={filing.bearishPoints} />
          </div>
        </section>
      ) : null}

      {hasEvidenceOrWatch ? (
        <section className="stock-detail-card-grid two-up insight-summary-grid">
          <AnalysisList title="Key Evidence" items={filing.keyEvidence} />
          <AnalysisList title="What To Watch Next" numbered items={filing.watchNext} />
        </section>
      ) : null}

      <FilingMarketContextPanel filing={filing} />

      <OriginalFilingText filing={filing} eventLabel={eventLabel} includeTemplateStatus />
    </>
  );
}

function ListingRiskTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: ListingRiskModel;
}) {
  return (
    <>
      <section className="stock-detail-top-grid special-overview-grid">
        <FilingPriceChart filing={filing} />

        <section className="stock-detail-card spac-summary-panel listing-risk-summary-panel">
          <div className="spac-summary-heading">
            <h2>Listing Risk Snapshot</h2>
            <p>
              <strong>{model.complianceStatus}.</strong> {model.mainRiskDriver}
            </p>
          </div>
          <div className="spac-metric-grid">
            <SpacMetricCard icon="status" label="Exchange Status" note={model.exchange} tone={model.noActiveDeficiency ? "neutral" : "risk"} value={model.complianceStatus} />
            <SpacMetricCard icon="closing" label="Cure Deadline" note={model.curePeriod} tone={model.noActiveDeficiency ? "neutral" : "risk"} value={model.cureDeadline} />
            <SpacMetricCard icon="cash" label="Main Risk Driver" note="Source-backed when disclosed" tone={model.noActiveDeficiency ? "neutral" : "risk"} value={model.mainRiskDriver} />
            <SpacMetricCard icon="status" label="Appeal / Hearing" note={model.hearingAppealDeadline} value={model.appealHearingStatus} />
          </div>
        </section>
      </section>

      <section className="stock-detail-card listing-risk-status-card">
        <div className="card-heading-row">
          <div>
            <h2>Exchange Compliance Status</h2>
            <p>{model.deficiencyNotice}</p>
          </div>
          <span>{model.currentPoint}</span>
        </div>
        <div className="spac-readout-grid listing-risk-readout-grid">
          <MetricRow label="Extension Eligibility" value={model.extensionEligibility} />
          <MetricRow label="Extension / Review Date" value={model.extensionReviewDate} />
          <MetricRow label="Representative Thresholds Note" value={model.representativeThresholdsNote} />
        </div>
      </section>

      <section className="stock-detail-card listing-risk-checks-card">
        <div className="card-heading-row">
          <div>
            <h2>Compliance Checks</h2>
            <p>Common listing-risk checks shown only when the filing or payload provides support.</p>
          </div>
        </div>
        <div className="listing-risk-check-grid">
          {model.checks.map((check) => (
            <ListingRiskCheckCard check={check} key={check.label} />
          ))}
        </div>
      </section>

      {model.noActiveDeficiency ? (
        <section className="stock-detail-card listing-risk-clear-card">
          <CircleCheck size={18} aria-hidden="true" />
          <div>
            <h2>No Active Deficiency Disclosed</h2>
            <p>Requirement satisfied or no active listing deficiency was disclosed in the filing payload.</p>
          </div>
        </section>
      ) : (
        <section className="stock-detail-card spac-stage-card listing-risk-timeline-card">
          <div className="card-heading-row">
            <div>
              <h2>Listing Timeline</h2>
              <p>Notice, current point, cure deadline, extension review, and appeal/hearing dates when available.</p>
            </div>
          </div>
          <div className="listing-risk-timeline">
            {model.timeline.map((item) => (
              <div className={item.status.toLowerCase()} key={`${item.label}-${item.date}`}>
                <span>{item.label}</span>
                <strong>{item.date}</strong>
                <em>{item.status}</em>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stock-detail-card-grid two-up spac-support-grid">
        <section className="stock-detail-card spac-risk-card">
          <h2>Key Risk Flags</h2>
          <ul>
            {model.riskFlags.map((flag) => (
              <li key={flag}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="stock-detail-card spac-watch-card">
          <h2>What To Watch Next</h2>
          <ol>
            {model.watchNext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </section>

      <FilingMarketContextPanel filing={filing} />
      <SpacSourceEvidence filing={filing} model={model} />
      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function EarningsTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: EarningsModel;
}) {
  return (
    <>
      <section className="stock-detail-top-grid special-overview-grid">
        <FilingPriceChart filing={filing} />

        <section className="stock-detail-card spac-summary-panel earnings-summary-panel">
          <div className="spac-summary-heading">
            <h2>Earnings Snapshot</h2>
            <p>
              <strong>{model.period}.</strong> {model.managementOutlook}
            </p>
          </div>
          <div className="spac-metric-grid">
            <SpacMetricCard icon="cash" label="Numbers" note={model.estimateBeatMiss} value={model.revenue} />
            <SpacMetricCard icon="status" label="Guidance" note={model.guidanceChange} tone={model.guidanceTone === "Weak" ? "risk" : "neutral"} value={model.guidanceTone} />
            <SpacMetricCard icon="redemption" label="Margin Trend" note={model.marginTrendNote} tone={model.marginTrend === "Compressing" ? "risk" : "neutral"} value={model.marginTrend} />
            <SpacMetricCard icon="closing" label="Risk Signals" note="Disclosure extraction" value={`${model.riskSignals.length} checks`} />
          </div>
        </section>
      </section>

      <section className="stock-detail-card earnings-results-card">
        <div className="card-heading-row">
          <div>
            <h2>Numbers</h2>
            <p>Current-quarter results.</p>
          </div>
          <span>{model.periodType}</span>
        </div>
        <div className="earnings-metric-grid">
          {model.numbers.map((metric) => (
            <EarningsMetricCard metric={metric} key={metric.label} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card earnings-guidance-card">
        <div className="card-heading-row">
          <div>
            <h2>Guidance</h2>
            <p>Revenue, EPS, margin outlook, and forward commentary.</p>
          </div>
          <EarningsGuidanceToneBadge tone={model.guidanceTone} />
        </div>
        <div className="spac-readout-grid earnings-guidance-grid">
          <MetricRow label="Revenue Outlook" value={model.revenueGuidance} />
          <MetricRow label="EPS Outlook" value={model.epsGuidance} />
          <MetricRow label="Margin Outlook" value={model.marginGuidance} />
          <MetricRow label="Raise / Cut" value={model.guidanceChange} />
          <MetricRow label="Forward Commentary" value={model.forwardCommentary} />
        </div>
      </section>

      <section className="stock-detail-card earnings-margin-card">
        <div className="card-heading-row">
          <div>
            <h2>Margin Trend</h2>
            <p>Quality of earnings: gross, operating, and EBITDA margin direction.</p>
          </div>
          <span>{model.marginTrend}</span>
        </div>
        <EarningsMarginTrendChart metrics={model.marginMetrics} trend={model.marginTrend} />
      </section>

      <section className="stock-detail-card earnings-risk-signal-card">
        <div className="card-heading-row">
          <div>
            <h2>Risk Signals</h2>
            <p>Going concern, liquidity, covenant, dilution, financing, debt, and listing-pressure language.</p>
          </div>
        </div>
        <div className="earnings-risk-signal-grid">
          {model.riskSignals.map((signal) => (
            <EarningsRiskSignalCard signal={signal} key={signal.label} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card spac-watch-card earnings-watch-card">
        <h2>What To Watch Next</h2>
        <ol>
          {model.watchNext.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <FilingMarketContextPanel filing={filing} />
      <SpacSourceEvidence filing={filing} model={model} />
      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function FdaClinicalTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: FdaClinicalModel;
}) {
  return (
    <>
      <section className="stock-detail-top-grid special-overview-grid">
        <FilingPriceChart filing={filing} />

        <section className="stock-detail-card spac-summary-panel clinical-summary-panel">
          <div className="spac-summary-heading">
            <h2>Event Snapshot</h2>
            <p>
              <strong>{model.phase}.</strong> {model.eventSummary}
            </p>
          </div>
          <div className="spac-metric-grid clinical-snapshot-grid">
            <SpacMetricCard icon="status" label="Trial / Indication" note={model.trialName} value={model.indication} />
            <SpacMetricCard icon="redemption" label="Therapy" note={model.patientPopulation} value={model.therapy} />
            <SpacMetricCard icon="cash" label="Event Status" note={model.dataReadout} tone="risk" value={model.eventStatus} />
            <SpacMetricCard icon="closing" label="Next Milestone" note={model.fdaStatus} value={model.nextMilestone} />
          </div>
        </section>
      </section>

      <section className="stock-detail-card clinical-timeline-card">
        <div className="card-heading-row">
          <div>
            <h2>FDA Timeline</h2>
            <p>Regulatory and clinical checkpoints shown only when the filing payload provides support.</p>
          </div>
          <span>{model.primaryEndpoint}</span>
        </div>
        <div className="clinical-timeline-list">
          {model.fdaTimeline.map((item) => (
            <ClinicalTimelineRow item={item} key={`${item.label}-${item.date}`} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card clinical-takeaways-card">
        <div className="card-heading-row">
          <div>
            <h2>Key Takeaways</h2>
            <p>Four source-backed points from the current filing.</p>
          </div>
        </div>
        <ol className="clinical-takeaway-list">
          {model.keyTakeaways.slice(0, 4).map((item, index) => (
            <li key={item}>
              <span>{index + 1}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="stock-detail-card clinical-data-card">
        <div className="card-heading-row">
          <div>
            <h2>Data Highlights</h2>
            <p>Compact endpoint, survival, and safety facts without repeating the full summary.</p>
          </div>
        </div>
        <div className="clinical-data-list">
          {model.dataHighlights.map((item) => (
            <ClinicalDataHighlightRow item={item} key={item.label} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card-grid two-up spac-support-grid">
        <section className="stock-detail-card spac-risk-card clinical-risk-card">
          <h2>Risks</h2>
          <ul>
            {model.risks.map((risk) => (
              <li key={risk}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="stock-detail-card spac-watch-card clinical-watch-card">
          <h2>What To Watch</h2>
          <ol>
            {model.watchNext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </section>

      <section className="stock-detail-card clinical-market-card">
        <div className="card-heading-row">
          <div>
            <h2>Market Size</h2>
            <p>{model.marketSizeSource}</p>
          </div>
        </div>
        <p>{model.marketSize}</p>
      </section>

      <FilingMarketContextPanel filing={filing} />
      <SpacSourceEvidence filing={filing} model={model} />
      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function ClinicalTimelineRow({ item }: { item: ClinicalTimelineItem }) {
  return (
    <div>
      <span>{item.status}</span>
      <strong>{item.label}</strong>
      <em>{item.date}</em>
      <p>{item.detail}</p>
    </div>
  );
}

function ClinicalDataHighlightRow({ item }: { item: ClinicalDataHighlight }) {
  return (
    <div>
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      <p>{item.note}</p>
    </div>
  );
}

function ListingRiskCheckCard({ check }: { check: ListingRiskCheck }) {
  const tone = /deficient|risk|watch|unknown/i.test(check.status) ? "risk" : "complete";
  return (
    <div className={`listing-risk-check ${tone}`}>
      <span>{check.label}</span>
      <strong>{check.value}</strong>
      <em>{check.status}</em>
      <p>{check.note}</p>
    </div>
  );
}

function EarningsMetricCard({ metric }: { metric: EarningsMetric }) {
  return (
    <div className="earnings-metric-card">
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <em>{metric.comparison}</em>
      <p>{metric.note}</p>
    </div>
  );
}

function EarningsGuidanceToneBadge({ tone }: { tone: EarningsModel["guidanceTone"] }) {
  return <span className={`earnings-guidance-tone ${tone.toLowerCase()}`}>{tone}</span>;
}

function EarningsMarginTrendChart({ metrics, trend }: { metrics: EarningsMetric[]; trend: string }) {
  return (
    <div className="earnings-margin-trend-shell">
      <div className="earnings-margin-chart" aria-label={`Margin trend: ${trend}`}>
        {metrics.map((metric, index) => (
          <div className="earnings-margin-bar-row" key={metric.label}>
            <span>{metric.label}</span>
            <div>
              <i style={{ width: `${Math.max(18, 74 - index * 12)}%` }} />
            </div>
            <strong>{metric.value}</strong>
            <em>{metric.comparison}</em>
          </div>
        ))}
      </div>
      <p>{metrics[0]?.note || "Margin trend is source-backed when disclosed."}</p>
    </div>
  );
}

function EarningsRiskSignalCard({ signal }: { signal: EarningsRiskSignal }) {
  return (
    <div className={`earnings-risk-signal ${signal.tone}`}>
      <span>{signal.label}</span>
      <strong>{signal.status}</strong>
      <p>{signal.detail}</p>
    </div>
  );
}

function IpoListingTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: IpoListingModel;
}) {
  if (model.displayMode === "rule_462b_mef") {
    return <Rule462bMefTemplate eventLabel={eventLabel} filing={filing} model={model} />;
  }
  if (model.isInitialTermsPending) {
    return <InitialIpoFilingTemplate eventLabel={eventLabel} filing={filing} model={model} />;
  }
  if (model.displayMode === "ipo_amendment") {
    return <IpoTermsUpdateTemplate eventLabel={eventLabel} filing={filing} model={model} />;
  }

  const listingNote = model.proposedTicker !== "Not disclosed" ? `${model.exchange}:${model.proposedTicker}` : model.exchange;

  return (
    <>
      <section className="stock-detail-top-grid spac-overview-grid ipo-overview-grid">
        <FilingPriceChart filing={filing} />

        <section className="stock-detail-card spac-summary-panel ipo-summary-panel">
          <div className="spac-summary-heading">
            <div>
              <h2>IPO Schedule</h2>
              <p>
                <strong>{model.currentStageLabel}.</strong> {model.displayQuickTake}
              </p>
            </div>
          </div>

          <div className="spac-metric-grid ipo-schedule-grid">
            <SpacMetricCard icon="status" label="Current Stage" note={model.stageBadge} value={model.currentStageLabel} />
            <SpacMetricCard icon="closing" label="Pricing Window" note="Expected IPO pricing" value={model.expectedPricingDate} />
            <SpacMetricCard
              icon="cash"
              label="Price Range"
              note={model.midpointPrice !== "Not disclosed" ? `Midpoint ${model.midpointPrice}` : "Range from filing"}
              value={model.priceRange}
            />
            <SpacMetricCard icon="closing" label="Expected First Trade" note={listingNote} value={model.expectedListingDate} />
          </div>
        </section>
      </section>

      <section className="stock-detail-card ipo-financial-card">
        <div className="card-heading-row">
          <div>
            <h2>Financial Snapshot</h2>
            <p>Most recent issuer financial figures disclosed in the filing payload.</p>
          </div>
          <span>{model.ipoKind}</span>
        </div>
        <div className="ipo-financial-grid">
          <IpoFactCard label="Revenue" note="Latest disclosed period" value={model.revenue} />
          <IpoFactCard label="Net Loss" note="Latest disclosed period" value={model.netLoss} />
          <IpoFactCard label="Balance Sheet Cash" note="Before IPO proceeds" value={model.cash} />
          <IpoFactCard label="IPO Proceeds" note="Expected gross offering size" value={model.offeringSize} />
        </div>
      </section>

      <section className="stock-detail-card spac-stage-card ipo-timeline-card">
        <div className="card-heading-row">
          <div>
            <h2>IPO Timeline</h2>
            <p>Follow the listing from initial filing through terms, effectiveness, pricing, first trade, and lock-up expiry.</p>
          </div>
          <span>{model.stageBadge}</span>
        </div>
        <div className="spac-stage-map ipo-stage-map" aria-label="IPO listing stage timeline">
          {model.stages.map((stage, index) => (
            <SpacStageStep key={`${stage.label}-${index}`} stage={stage} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card spac-explainer-card ipo-company-card">
        <div className="card-heading-row">
          <div>
            <h2>Company Overview</h2>
            <p>Issuer business context and pre-listing investor focus from the filing payload.</p>
          </div>
        </div>
        <div className="spac-explainer-grid ipo-company-grid">
          <div>
            <strong>What the company does</strong>
            <p>{model.companyStory}</p>
          </div>
          <div>
            <strong>Stage / business model</strong>
            <p>{model.companyStage}</p>
          </div>
          <div>
            <strong>Why investors may care</strong>
            <p>{filing.whyItMatters}</p>
          </div>
        </div>
      </section>

      <section className="stock-detail-card spac-context-strip ipo-deal-context-card">
        <div className="card-heading-row">
          <div>
            <h2>IPO Deal Context</h2>
            <p>Offering terms, planned proceeds use, and post-listing supply from the IPO filing payload.</p>
          </div>
        </div>

        <div className="spac-context-columns ipo-deal-columns">
          <section className="spac-context-light-column">
            <h3>IPO Offering Terms</h3>
            <strong className="spac-context-headline">{model.issuer}</strong>
            <div className="spac-readout-grid compact spac-card-readouts">
              <MetricRow label="Shares Offered" value={model.sharesOffered} />
              <MetricRow label="Implied Valuation" value={model.impliedValuation} />
              <MetricRow label="Lead Underwriters" value={model.underwriters} />
              <MetricRow label="Underwriter Option / Greenshoe" value={model.underwriterOption} />
              <MetricRow label="Primary / Secondary Mix" value={model.primarySecondaryMix} />
            </div>
          </section>

          <section className="spac-context-light-column">
            <h3>Use of Proceeds</h3>
            <strong className="spac-context-headline">Planned deployment</strong>
            <ul className="ipo-use-list">
              {model.useOfProceeds.map((item) => (
                <li key={item}>
                  <CircleCheck size={14} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="spac-context-light-column">
            <h3>Post-Listing Supply</h3>
            <strong className="spac-context-headline">{model.proposedTicker}</strong>
            <div className="spac-readout-grid compact spac-card-readouts">
              <MetricRow label="Expected Float" value={model.floatSummary} />
              <MetricRow label="Float %" value={model.floatPercent} />
              <MetricRow label="Lock-Up Terms" value={model.lockupSummary} />
              <MetricRow label="Lock-Up Expiry" value={model.lockupExpiration} />
            </div>
          </section>
        </div>
      </section>

      <section className="stock-detail-card-grid two-up spac-support-grid ipo-support-grid">
        <section className="stock-detail-card spac-risk-card">
          <h2>Key Risk Flags</h2>
          <ul>
            {model.riskFlags.map((flag) => (
              <li key={flag}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="stock-detail-card spac-watch-card">
          <h2>What To Watch Next</h2>
          <ol>
            {model.watchNext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </section>

      <FilingMarketContextPanel filing={filing} />
      <SpacSourceEvidence filing={filing} model={model} />
      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function InitialIpoFilingTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: IpoListingModel;
}) {
  const quickTake = model.displayQuickTake;
  const watchNext =
    model.watchNext.length > 0
      ? model.watchNext
      : [
          "S-1/A or F-1/A with share count and price range.",
          "SEC effectiveness and final 424B4 prospectus.",
          "Pricing date and first trading date.",
        ];

  return (
    <>
      <section className="stock-detail-card-grid two-up initial-ipo-compact-grid">
        <section className="stock-detail-card dilution-snapshot-panel ipo-summary-panel initial-ipo-top-panel">
          <div className="ipo-summary-heading">
            <h2>Initial IPO Filing</h2>
          </div>

          <div className="dilution-impact-metrics">
            {model.snapshotMetrics.map((metric) => (
              <DilutionMetric key={metric.label} metric={metric} />
            ))}
          </div>
        </section>

        <section className="stock-detail-card initial-ipo-side-stack">
          <div className="initial-ipo-summary-card initial-ipo-quick-card">
            <h2>Quick Take</h2>
            <p>{quickTake}</p>
          </div>

          <div className="initial-ipo-summary-card initial-ipo-background-card">
            <h2>Company Overview</h2>
            <p>{model.companyStory}</p>
          </div>
        </section>
      </section>

      <section className="stock-detail-card spac-watch-card ipo-watch-card">
        <h2>What To Watch Next</h2>
        <ol>
          {watchNext.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function IpoTermsUpdateTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: IpoListingModel;
}) {
  const quickTake = model.displayQuickTake;
  const watchNext =
    model.watchNext.length > 0
      ? model.watchNext
      : [
          "SEC effectiveness and final 424B4 prospectus.",
          "Final IPO pricing and first trading date.",
          "Any lock-up, underwriter option, or selling-shareholder updates.",
        ];

  return (
    <>
      <section className="stock-detail-card-grid two-up initial-ipo-compact-grid">
        <section className="stock-detail-card dilution-snapshot-panel ipo-summary-panel initial-ipo-top-panel">
          <div className="ipo-summary-heading">
            <h2>IPO Terms Update</h2>
          </div>

          <div className="dilution-impact-metrics">
            {model.snapshotMetrics.map((metric) => (
              <DilutionMetric key={metric.label} metric={metric} />
            ))}
          </div>
        </section>

        <section className="stock-detail-card initial-ipo-side-stack">
          <div className="initial-ipo-summary-card initial-ipo-quick-card">
            <h2>Quick Take</h2>
            <p>{quickTake}</p>
          </div>

          <div className="initial-ipo-summary-card initial-ipo-background-card">
            <h2>Company Overview</h2>
            <p>{model.companyStory}</p>
          </div>
        </section>
      </section>

      {model.offeringDetailsRows.length ? (
        <section className="stock-detail-card initial-ipo-details-block">
          <h2>Offering Details</h2>
          <div className="initial-ipo-detail-list">
            {model.offeringDetailsRows.map((row) => (
              <div className="initial-ipo-detail-row" key={`${row.label}-${row.value}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="stock-detail-card spac-watch-card ipo-watch-card">
        <h2>What To Watch Next</h2>
        <ol>
          {watchNext.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function Rule462bMefTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: IpoListingModel;
}) {
  const quickTake = model.displayQuickTake;
  const summary = model.companyStory;

  return (
    <>
      <section className="stock-detail-card-grid two-up initial-ipo-compact-grid">
        <section className="stock-detail-card dilution-snapshot-panel ipo-summary-panel initial-ipo-top-panel">
          <div className="ipo-summary-heading">
            <h2>Rule 462(b) MEF</h2>
          </div>

          <div className="dilution-impact-metrics">
            {model.snapshotMetrics.map((metric) => (
              <DilutionMetric key={metric.label} metric={metric} />
            ))}
          </div>
        </section>

        {quickTake || summary ? (
          <section className="stock-detail-card initial-ipo-side-stack">
            {quickTake ? (
              <div className="initial-ipo-summary-card initial-ipo-quick-card">
                <h2>Quick Take</h2>
                <p>{quickTake}</p>
              </div>
            ) : null}

            {summary ? (
              <div className="initial-ipo-summary-card initial-ipo-background-card">
                <h2>Additional Registration</h2>
                <p>{summary}</p>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>

      {model.offeringDetailsRows.length ? (
        <section className="stock-detail-card initial-ipo-details-block">
          <h2>Registration Details</h2>
          <div className="initial-ipo-detail-list">
            {model.offeringDetailsRows.map((row) => (
              <div className="initial-ipo-detail-row" key={`${row.label}-${row.value}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {model.amendmentRows.length ? (
        <section className="stock-detail-card initial-ipo-details-block">
          <h2>What Changed</h2>
          <div className="initial-ipo-detail-list">
            {model.amendmentRows.map((row) => (
              <div className="initial-ipo-detail-row" key={`${row.label}-${row.value}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function IpoFactCard({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="ipo-fact-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{note}</em>
    </div>
  );
}

function SpacTransactionStatusTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: SpacTransactionStatusModel;
}) {
  return (
    <>
      <section className="stock-detail-top-grid spac-overview-grid">
        <FilingPriceChart filing={filing} />

        <section className="stock-detail-card spac-summary-panel">
          <div className="spac-summary-heading">
            <div>
              <h2>SPAC Transaction Snapshot</h2>
              <p>
                <strong>{model.currentStageLabel}.</strong> {model.stageSummary}
              </p>
            </div>
          </div>

          <div className="spac-metric-grid">
            <SpacMetricCard icon="status" label="Deal Status" note="Current transaction state" value={model.dealStatus} />
            <SpacMetricCard icon="redemption" label="Redemption Rate" note="Public shares redeemed" tone="risk" value={model.redemptionRate} />
            <SpacMetricCard icon="cash" label="Cash Condition" note={model.minCashCondition} tone="risk" value={model.cashCondition} />
            <SpacMetricCard
              icon="closing"
              label="Expected Closing"
              note={model.tickerChangeDate ? `Ticker change: ${model.tickerChangeDate}` : "Ticker change not disclosed"}
              value={model.closingDate}
            />
          </div>
        </section>
      </section>

      <section className="stock-detail-card spac-stage-card">
        <div className="card-heading-row">
          <div>
            <h2>SPAC Deal Flow</h2>
            <p>Track the SPAC from target announcement through redemption, cash-condition review, closing, and ticker change.</p>
          </div>
          <span>{model.currentStageNumber}/{model.stages.length} stages reached</span>
        </div>
        <div className="spac-stage-map" aria-label="SPAC transaction stage timeline">
          {model.stages.map((stage, index) => (
            <SpacStageStep key={`${stage.label}-${index}`} stage={stage} />
          ))}
        </div>
      </section>

      <section className="stock-detail-card spac-explainer-card spac-target-overview-card">
        <div className="card-heading-row">
          <div>
            <h2>Target Company Overview</h2>
            <p>{model.targetCompanyStory}</p>
          </div>
          <span>{model.expectedTicker}</span>
        </div>
        <div className="spac-explainer-grid">
          <div>
            <strong>Target company</strong>
            <p>{model.targetCompany}</p>
          </div>
          <div>
            <strong>What the target does</strong>
            <p>{model.targetSummary}</p>
          </div>
          <div>
            <strong>Expected ticker</strong>
            <p>{model.expectedTicker}</p>
          </div>
        </div>
      </section>

      <section className="stock-detail-card spac-context-strip">
        <div className="card-heading-row">
          <div>
            <h2>Transaction Context</h2>
            <p>Current gate, target deal, and SPAC vehicle details from the filing payload.</p>
          </div>
          <span>{model.stageBadge}</span>
        </div>

        <div className="spac-context-columns">
          <section className="spac-current-gate-column">
            <h3>Current Gate</h3>
            <strong className="spac-gate-headline">{model.currentStageLabel}</strong>
            <div className="spac-readout-grid compact spac-card-readouts spac-gate-readouts">
              <MetricRow label="Deal Status" value={model.dealStatus} />
              <MetricRow label="Blocking Issue" value={model.blockingIssue} />
              <MetricRow label="Next Check" value={model.nextCheck} />
              <MetricRow label="Source Date" value={model.sourceDate} />
            </div>
          </section>

          <section className="spac-context-light-column">
            <h3>Target Deal</h3>
            <strong className="spac-context-headline">{model.targetCompany}</strong>
            <div className="spac-readout-grid compact spac-card-readouts">
              <MetricRow label="Expected Ticker" value={model.expectedTicker} />
              <MetricRow label="Deal Value" value={model.dealValue} />
              <MetricRow label="Announced" value={model.announcedDate} />
              <MetricRow label="Merger Agreement Date" value={model.mergerAgreementDate} />
            </div>
          </section>

          <section className="spac-context-light-column">
            <h3>SPAC Vehicle</h3>
            <strong className="spac-context-headline">
              {filing.ticker}
              {model.ipoYear ? ` / IPO ${model.ipoYear}` : ""}
            </strong>
            <div className="spac-readout-grid compact spac-card-readouts">
              <MetricRow label="IPO Date" value={model.ipoDate} />
              <MetricRow label="Sponsor" value={model.sponsor} />
              <MetricRow label="IPO Underwriter" value={model.ipoUnderwriter} />
              <MetricRow label="Unit / Right / Warrant" value={model.unitRightWarrantTerms} />
            </div>
          </section>
        </div>
      </section>

      <section className="stock-detail-card spac-explainer-card">
        <div className="card-heading-row">
          <div>
            <h2>SPAC Context</h2>
            <p>{model.targetSummary}</p>
          </div>
        </div>
        <div className="spac-explainer-grid">
          <div>
            <strong>What is happening</strong>
            <p>{model.spacStatus}</p>
          </div>
          <div>
            <strong>Sponsor / underwriter context</strong>
            <p>
              Sponsor: {model.sponsor}. IPO underwriter: {model.ipoUnderwriter}. Treat profile quality as context, not a standalone alert trigger.
            </p>
          </div>
          <div>
            <strong>Highest-priority follow-up</strong>
            <p>{model.nextCheck}</p>
          </div>
        </div>
      </section>

      <section className="stock-detail-card-grid two-up spac-detail-grid">
        <section className="stock-detail-card spac-impact-card">
          <div className="card-heading-row">
            <h2>Redemption Impact</h2>
            <span>{model.redemptionRate}</span>
          </div>
          <div className="spac-readout-grid">
            <MetricRow label="Trust Cash Before" value={model.trustCashBefore} />
            <MetricRow label="Trust Cash After" value={model.trustCashAfter} />
            <MetricRow label="Redemption Price" value={model.redemptionPrice} />
            <MetricRow label="Public Shares Remaining" value={model.publicSharesRemaining} />
            <MetricRow label="Minimum Cash Condition" value={model.minCashCondition} />
            <MetricRow label="Float Impact" value={model.floatImpact} />
          </div>
        </section>

        <section className="stock-detail-card spac-conditions-card">
          <div className="card-heading-row">
            <h2>Closing Conditions</h2>
            <span>{model.minCashStatus}</span>
          </div>
          <ul className="spac-check-list">
            <SpacConditionItem tone={model.minCashStatus.toLowerCase().includes("risk") ? "risk" : "complete"}>
              Minimum cash condition: {model.minCashCondition} ({model.minCashStatus})
            </SpacConditionItem>
            <SpacConditionItem>Business combination target: {model.targetCompany}</SpacConditionItem>
            <SpacConditionItem>Expected closing: {model.closingDate}</SpacConditionItem>
            <SpacConditionItem>Ticker change expected: {model.tickerChangeDate}</SpacConditionItem>
          </ul>
        </section>
      </section>

      <section className="stock-detail-card-grid two-up spac-support-grid">
        <section className="stock-detail-card spac-risk-card">
          <h2>Key Risk Flags</h2>
          <ul>
            {model.riskFlags.map((flag) => (
              <li key={flag}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="stock-detail-card spac-watch-card">
          <h2>What To Watch Next</h2>
          <ol>
            {model.watchNext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </section>

      {model.eventHistory.length ? <SpacEventHistory items={model.eventHistory} /> : null}

      <SpacSourceEvidence filing={filing} model={model} />
      <OriginalFilingText filing={filing} eventLabel={eventLabel} />
    </>
  );
}

function SpacMetricCard({
  icon,
  label,
  note,
  tone = "neutral",
  value,
}: {
  icon: "status" | "redemption" | "cash" | "closing";
  label: string;
  note: string;
  tone?: "neutral" | "risk";
  value: string;
}) {
  const Icon = icon === "redemption" ? ChartPie : icon === "cash" ? DollarSign : icon === "closing" ? CalendarCheck : Clock3;

  return (
    <div className={`spac-metric-card ${tone}`}>
      <span className="spac-metric-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{note}</em>
      </div>
    </div>
  );
}

function SpacStageStep({ stage }: { stage: SpacStageItem }) {
  const Icon = stage.tone === "complete" ? CircleCheck : stage.tone === "risk" ? TriangleAlert : stage.tone === "current" ? Clock3 : CalendarCheck;

  return (
    <div className={`spac-stage-step ${stage.tone}`}>
      <span className="spac-stage-dot">
        <Icon size={14} aria-hidden="true" />
      </span>
      {stage.tone !== "pending" ? <span className="spac-stage-line" aria-hidden="true" /> : null}
      <strong>{stage.label}</strong>
      {stage.date ? <em>{stage.date}</em> : null}
      {stage.tone === "current" ? <span className="spac-current-marker">Current filing</span> : null}
    </div>
  );
}

function SpacConditionItem({
  children,
  tone = "complete",
}: {
  children: ReactNode;
  tone?: "complete" | "risk";
}) {
  const Icon = tone === "risk" ? TriangleAlert : CircleCheck;
  return (
    <li className={tone}>
      <Icon size={14} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function SpacEventHistory({ items }: { items: SpacHistoryItem[] }) {
  return (
    <section className="stock-detail-card spac-history-card">
      <div className="card-heading-row">
        <h2>SPAC Event History</h2>
        <span>{items.length} items</span>
      </div>
      <div className="spac-history-list">
        {items.map((item) => (
          <div className={item.current ? "current" : ""} key={`${item.date}-${item.title}`}>
            <span>{item.date}</span>
            <b>{item.form}</b>
            <div>
              <strong>{item.title}</strong>
              <em>
                {item.source} / {item.status}
              </em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SpacSourceEvidence({ filing, model }: { filing: FilingEvent; model: { sources: SpacSourceItem[] } }) {
  return (
    <section className="stock-detail-card spac-source-card">
      <div className="card-heading-row">
        <h2>Source Evidence</h2>
        <a href={filing.sourceUrl} target="_blank" rel="noreferrer">
          Open SEC filing <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      <div className="spac-source-grid">
        {model.sources.map((source) => (
          <a href={source.url || filing.sourceUrl} target="_blank" rel="noreferrer" key={`${source.form}-${source.title}`}>
            <FileText size={17} aria-hidden="true" />
            <strong>{source.title}</strong>
            <span>{source.detail}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function DilutionOfferingTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: ReturnType<typeof buildDilutionOfferingModel>;
}) {

  if (!model.isS8DetailCandidate && model.isCommonWarrantOnly) {
    return <CommonFilingTemplate eventLabel={eventLabel} filing={filing} />;
  }

  const showSummaryBesideChart = model.hideSnapshotPanel;

  return (
    <>
      {showSummaryBesideChart ? (
        <section className="stock-detail-top-grid">
          <FilingPriceChart filing={filing} />

          <DilutionLongSummary model={model} />
        </section>
      ) : (
        <section className="stock-detail-top-grid">
          <FilingPriceChart filing={filing} />

          <DilutionSnapshotCard model={model} />
        </section>
      )}
      {showSummaryBesideChart ? <ScoreBasisPanel filing={filing} /> : null}

      {model.isShelfOnly ? (
        <>
          {showSummaryBesideChart ? null : (
            <>
              <DilutionLongSummary model={model} />
              <ScoreBasisPanel filing={filing} />
            </>
          )}
          <ShelfDetailsSection model={model} />
          <ShelfWatchNext model={model} />
        </>
      ) : (
        <>
          {showSummaryBesideChart ? null : (
            <>
              <DilutionLongSummary model={model} />
              <ScoreBasisPanel filing={filing} />
            </>
          )}

          {model.hideStructuredDetailSections ? null : model.hideShareOverhang ? (
            <AtmProgramDetails model={model} />
          ) : model.isMixedOffering ? (
            <MixedOfferingDetails model={model} />
          ) : model.isPricedPrimaryOrRegisteredDirect ? (
            <PricedOfferingDetails model={model} />
          ) : model.isResaleRegistration ? (
            <ResaleRegistrationDetails model={model} />
          ) : model.isWarrantConvertible ? (
            <WarrantConvertibleDetails model={model} />
          ) : model.is424bOfferingTermsPayload ? (
            <OfferingTermsSourceDetails model={model} />
          ) : (
            <ShareOverhangCard model={model} />
          )}
        </>
      )}

      <S3AmendmentChangesSection model={model} />
      <FilingMarketContextPanel filing={filing} />
      <OriginalFilingText filing={filing} eventLabel="Dilution Risk" />
    </>
  );
}

function ShelfDetailsSection({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  const rows = model.offeringDetailsRows.length ? model.offeringDetailsRows : model.shelfDetailRows;
  if (!rows.length) return null;

  return (
    <DilutionDisclosureSection
      title="Shelf Details"
      rows={rows}
      emptyText="No source-backed shelf details were provided."
      headingLabel="Registration details"
    />
  );
}

function S3AmendmentChangesSection({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  if (!model.s3AmendmentChangeRows.length) return null;

  return (
    <DilutionDisclosureSection
      title="What Changed"
      rows={model.s3AmendmentChangeRows}
      emptyText="No source-backed amendment changes were provided."
      headingLabel="S-3/A updates"
    />
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

      {model.investorTakeaway ? (
        <div className="dilution-warning-strip">
          <p>{model.investorTakeaway}</p>
        </div>
      ) : null}

    </section>
  );
}

function DilutionLongSummary({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  return (
    <section className="stock-detail-card dilution-long-summary">
      <h2>{model.summaryTitle}</h2>
      {model.summaryParagraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </section>
  );
}

function OfferingTermsSourceDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  const detailRows = model.offeringDetailsRows.length ? model.offeringDetailsRows : model.termRows;

  return (
    <>
      <DilutionDisclosureSection
        title="Offering Details"
        rows={detailRows}
        emptyText="No source-backed offering detail rows were provided."
      />
      {model.warrantInstrumentRows.length ? (
        <DilutionInstrumentDetailsSection
          rows={model.warrantInstrumentRows}
          emptyText="No source-backed instrument rows were provided."
        />
      ) : model.warrantDetailsRows.length ? (
        <DilutionDisclosureSection
          title="Instrument Details"
          rows={model.warrantDetailsRows}
          emptyText="No source-backed instrument rows were provided."
        />
      ) : null}
    </>
  );
}

function AtmProgramDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  const llmAtmModel = buildAtmProgramLlmOverhangModel(model);
  if (llmAtmModel) return <DilutionShareOverhang model={llmAtmModel} />;

  const programSize = findMetricValue(model.impactMetrics, "Program size") || findDisclosureRowValue(model.atmProgramRows, "Program size");
  const publicFloat = findMetricValue(model.impactMetrics, "Public float");
  const publicFloatScale = findMetricValue(model.impactMetrics, "Size vs public float");
  const marketCap =
    findMetricValue(model.impactMetrics, "Market cap") ||
    findMetricValue(model.impactMetrics, "Approximate Current Market Cap") ||
    model.atmMarketCapValue;
  const marketCapScale = findMetricValue(model.impactMetrics, "Size vs market cap") || findDisclosureRowValue(model.atmDilutionRows, "Market cap scale");
  const denominatorLabel = publicFloat ? "Public Float" : "Market Cap";
  const denominatorValue = publicFloat || marketCap;
  const denominatorCaption = publicFloat ? "of public float" : "of market cap";
  const denominatorScaleLabel = publicFloat ? "Size vs Public Float" : "Size vs Market Cap";
  const denominatorNoteSuffix = publicFloat ? "program size vs. public float" : "program size vs. market cap";
  const denominatorUnavailableLabel = publicFloat ? "public float" : "market cap";
  const programAmount = parseMoneyValue(programSize);
  const denominatorAmount = parseMoneyValue(denominatorValue);
  const totalAmount = programAmount + denominatorAmount;
  const canRenderScale = Boolean(programAmount && denominatorAmount && totalAmount);
  const marketCapWidth = canRenderScale ? (denominatorAmount / totalAmount) * 100 : 0;
  const programWidth = canRenderScale ? (programAmount / totalAmount) * 100 : 0;
  const computedScale =
    canRenderScale ? `${formatPercentCompact((programAmount / denominatorAmount) * 100)} ${denominatorCaption}` : "";
  const displayedScale = publicFloatScale || marketCapScale || computedScale;
  const scaleShort = displayedScale.replace(/\s+of\s+(?:market cap|public float)\b/i, "");

  return (
    <DilutionShareOverhang
      model={{
        canRenderOverhangChart: canRenderScale,
        chartTitle: "ATM Program",
        currentDetailLabel: denominatorLabel,
        currentSharesCompact: denominatorValue || `${denominatorLabel} unavailable`,
        dilutionRatioPercentValue: scaleShort || displayedScale || "Not calculated",
        dilutionRatioValue: displayedScale || "Not calculated",
        overhangAriaLabel: `ATM capacity compared with ${denominatorUnavailableLabel}`,
        overhangBarSegments: canRenderScale
          ? [
              {
                key: "market-cap",
                className: "current-base",
                label: denominatorLabel,
                value: denominatorValue,
                width: marketCapWidth,
                compact: marketCapWidth < 24,
                roleBadge: "Base",
                roleKind: "base",
              },
              {
                key: "atm-capacity",
                className: "registered-supply",
                label: "ATM capacity",
                value: programSize,
                note: displayedScale || undefined,
                width: programWidth,
                compact: programWidth < 24,
                roleBadge: "Capacity",
                roleKind: "included",
              },
            ]
          : [],
        overhangLevel: "Capacity Scale",
        overhangLevelLabel: "Capacity Level",
        overhangNote: "Actual dilution depends on how much stock the company sells.",
        overhangScoreCaption: denominatorCaption,
        overhangSubtitle: `${denominatorLabel} plus potential ATM sale capacity`,
        overhangUnavailableMessage:
          `ATM capacity scale could not be shown because program size or ${denominatorUnavailableLabel} was unavailable.`,
        potentialSupplyCompact: programSize || "Not disclosed",
        showBreakdownPanel: false,
        showSegmentLegend: true,
        showTotalNote: true,
        requireProvidedSupplyDetails: true,
        supplyDetailRows: model.offeringDetailsRows,
        extraDetailPanels: buildWarrantExtraDetailPanels(model),
        supplyDetailTitle: "Offering Details",
        supplyDetailLabel: "ATM Capacity",
        totalNoteSuffix: denominatorNoteSuffix,
        totalNoteTitle: "ATM Capacity Scale",
        totalOverhangLabel: denominatorScaleLabel,
      }}
    />
  );
}

function buildAtmProgramLlmOverhangModel(model: ReturnType<typeof buildDilutionOfferingModel>) {
  const overhang = model.llmShareOverhang;
  if (!overhang) return null;

  const basisSegment =
    overhang.overhangBarSegments.find((segment) => segment.calculationRole === "denominator") ||
    overhang.overhangBarSegments.find((segment) => segment.supplyNature === "base_shares") ||
    overhang.overhangBarSegments[0] ||
    null;
  const isAtmCapacityRow = (row: LlmShareOverhangFactRow) => {
    const text = `${row.label} ${row.note || ""}`.toLowerCase();
    return row.rowRole === "reference" && /\batm\b|at-the-market|sales agreement/.test(text) && parseMoneyValue(row.value) > 0;
  };
  const isShelfCapacityRow = (row: LlmShareOverhangFactRow) => {
    const text = `${row.label} ${row.note || ""}`.toLowerCase();
    return /\bshelf\b|universal shelf|base shelf/.test(text);
  };
  const capacityRow =
    overhang.conditionalSupplyRows.find(isAtmCapacityRow) ||
    overhang.conditionalSupplyRows.find(
      (row) =>
        row.rowRole === "reference" &&
        /\b(?:program|capacity)\b/i.test(`${row.label} ${row.note || ""}`) &&
        !isShelfCapacityRow(row) &&
        parseMoneyValue(row.value) > 0,
    ) ||
    null;

  if (!basisSegment || !capacityRow) return null;

  const denominatorValue = overhang.totalNoteDenominator || overhang.currentValue || basisSegment.value;
  const numeratorValue = capacityRow.value;
  const denominatorAmount = parseMoneyValue(denominatorValue);
  const numeratorAmount = parseMoneyValue(numeratorValue);
  if (!denominatorAmount || !numeratorAmount) return null;

  const chartSegments = normalizeLlmShareOverhangSegmentWidths([
    {
      ...basisSegment,
      key: basisSegment.key || "atm-value-basis",
      className: "current-base",
      label: overhang.currentLabel || basisSegment.label,
      value: denominatorValue,
      roleBadge: "Base",
      roleKind: "base",
    },
    {
      key: capacityRow.key || "atm-capacity",
      className: "registered-supply",
      rowRole: capacityRow.rowRole,
      supplyType: capacityRow.supplyType || "atm_capacity",
      unit: capacityRow.unit,
      classBasis: capacityRow.classBasis,
      label: overhang.supplyLabel || capacityRow.label,
      value: numeratorValue,
      note: capacityRow.note,
      numericValue: capacityRow.numericValue ?? numeratorAmount,
      width: 0,
      roleBadge: "Capacity",
      roleKind: "included",
    },
  ]);
  const extraReferenceRows = overhang.conditionalSupplyRows
    .filter((row) => row !== capacityRow)
    .map((row) =>
      row.rowRole === "reference"
        ? {
            ...row,
            supplyType: row.supplyType || (isShelfCapacityRow(row) ? "shelf_capacity" : undefined),
          }
        : row,
    );
  const computedRatioValue = formatPercentCompact((numeratorAmount / denominatorAmount) * 100);
  const ratioValue = computedRatioValue || overhang.totalNoteRatio || overhang.ratioValue || overhang.statusValue || "Not calculated";

  return {
    canRenderOverhangChart: true,
    chartTitle: overhang.chartTitle || "ATM Program",
    currentDetailLabel: overhang.currentLabel || basisSegment.label || "Market Value",
    currentSharesCompact: denominatorValue,
    dilutionRatioPercentValue: ratioValue,
    dilutionRatioValue: ratioValue,
    overhangAriaLabel: `${overhang.chartTitle || "ATM Program"}: ${ratioValue}`,
    overhangBarSegments: chartSegments,
    overhangLevel: overhang.statusLabel || "Capacity Scale",
    overhangLevelLabel: "Capacity Level",
    overhangNote: overhang.note || "Actual dilution depends on how much stock the company sells.",
    overhangScoreCaption: overhang.totalNoteSuffix || overhang.caption || overhang.ratioLabel || "of company value",
    overhangSubtitle: overhang.subtitle || "ATM capacity compared with source-backed company value",
    overhangUnavailableMessage: overhang.note || "ATM capacity scale could not be shown from source-backed values.",
    potentialSupplyCompact: numeratorValue,
    showBreakdownPanel: false,
    showSegmentLegend: true,
    showTotalNote: true,
    requireProvidedSupplyDetails: true,
    supplyDetailRows: model.offeringDetailsRows,
    conditionalSupplyRows: extraReferenceRows,
    extraDetailPanels: buildWarrantExtraDetailPanels(model),
    supplyDetailTitle: "Offering Details",
    supplyDetailLabel: overhang.supplyLabel || capacityRow.label || "ATM Capacity",
    totalNoteSuffix: overhang.totalNoteSuffix || "program size vs. company value",
    totalNoteTitle: overhang.totalNoteTitle || "ATM Capacity Scale",
    totalOverhangLabel: overhang.ratioLabel || "ATM Capacity Scale",
  };
}

function ShelfWatchNext({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  if (!model.shelfWatchRows.length) return null;

  return (
    <section className="stock-detail-card dilution-section-block">
      <div className="dilution-section-heading">
        <div>
          <h2>What To Watch Next</h2>
        </div>
        <span>Shelf registration</span>
      </div>
      <ul className="dilution-shelf-watch-list">
        {model.shelfWatchRows.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function findDisclosureRowValue(rows: DilutionDisclosureRow[], label: string) {
  return rows.find((row) => row.label === label)?.value || "";
}

function computeVisibleShareOverhangScale(segments: ShareOverhangBarSegment[]) {
  if (!segments.length) return null;
  const numericSegments = segments.filter((segment) => typeof segment.numericValue === "number" && segment.numericValue > 0);
  if (numericSegments.length !== segments.length) return null;

  const isBaseSegment = (segment: ShareOverhangBarSegment) =>
    segment.calculationRole
      ? segment.calculationRole === "denominator"
      : segment.supplyNature
        ? segment.supplyNature === "base_shares"
        : segment.className === "current-base";
  const isIncludedSupplySegment = (segment: ShareOverhangBarSegment) =>
    segment.rowRole
      ? segment.rowRole === "counted"
      : typeof segment.countedInRatio === "boolean"
      ? segment.countedInRatio
      : segment.calculationRole
      ? segment.calculationRole === "headline_numerator"
      : segment.supplyNature
        ? ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(segment.supplyNature)
        : segment.className !== "current-base";

  const baseSegments = numericSegments.filter((segment) => isBaseSegment(segment));
  const basisSegment = baseSegments[0] || null;
  const currentValue = baseSegments
    .reduce((total, segment) => total + (segment.numericValue || 0), 0);
  const supplyValue = collapseAlternativeShareOverhangSegments(numericSegments)
    .filter((segment) => isIncludedSupplySegment(segment))
    .reduce((total, segment) => total + (segment.numericValue || 0), 0);
  if (currentValue <= 0 || supplyValue <= 0) return null;

  const unit = detectShareOverhangUnit(segments);
  return {
    currentValue: formatShareOverhangCount(currentValue, unit),
    ratioValue: formatPercentCompact((supplyValue / currentValue) * 100) || "Variable",
    supplyValue: formatShareOverhangCount(supplyValue, unit),
  };
}

function buildConditionalExerciseScaleRows(
  segments: ShareOverhangBarSegment[],
  conditionalRows: LlmShareOverhangFactRow[],
): DilutionDisclosureRow[] {
  const numericSegments = segments.filter((segment) => typeof segment.numericValue === "number" && segment.numericValue > 0);
  const isBaseSegment = (segment: ShareOverhangBarSegment) =>
    segment.calculationRole
      ? segment.calculationRole === "denominator"
      : segment.supplyNature
        ? segment.supplyNature === "base_shares"
        : segment.className === "current-base";
  const isIncludedSupplySegment = (segment: ShareOverhangBarSegment) =>
    segment.rowRole
      ? segment.rowRole === "counted"
      : typeof segment.countedInRatio === "boolean"
      ? segment.countedInRatio
      : segment.calculationRole
      ? segment.calculationRole === "headline_numerator"
      : segment.supplyNature
        ? ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(segment.supplyNature)
        : segment.className !== "current-base";
  const isFutureExerciseRow = (row: LlmShareOverhangFactRow) =>
    row.rowRole === "conditional" ||
    row.supplyType === "future_exercise" ||
    (!row.supplyType && row.supplyNature === "conditional_future_supply") ||
    (!row.supplyType && row.calculationRole === "visible_excluded");

  const basisSegment = numericSegments.find(isBaseSegment) || null;
  const denominator = basisSegment?.numericValue || 0;
  if (denominator <= 0) return [];

  const includedSupply = collapseAlternativeShareOverhangSegments(numericSegments)
    .filter((segment) => isIncludedSupplySegment(segment))
    .reduce((total, segment) => total + (segment.numericValue || 0), 0);
  if (includedSupply <= 0) return [];

  const futureExerciseSegments = conditionalRows
    .filter(isFutureExerciseRow)
    .map(structuredRowToSegment)
    .filter((segment) => typeof segment.numericValue === "number" && segment.numericValue > 0);
  const futureExerciseSupply = futureExerciseSegments.reduce((total, segment) => total + (segment.numericValue || 0), 0);
  if (futureExerciseSupply <= 0) return [];

  const unit = detectShareOverhangUnit([...segments, ...futureExerciseSegments]);
  const totalIfExercised = includedSupply + futureExerciseSupply;
  const ratio = formatPercentCompact((totalIfExercised / denominator) * 100) || "Variable";

  return [
    {
      label: "Conditional exercise supply",
      value: formatShareOverhangCount(futureExerciseSupply, unit),
    },
    {
      label: "Total if exercised",
      value: `${formatShareOverhangCount(totalIfExercised, unit)} (${ratio})`,
      note: "Headline supply plus conditional exercise rows",
    },
  ];
}

function collapseAlternativeShareOverhangSegments(segments: ShareOverhangBarSegment[]) {
  const output: ShareOverhangBarSegment[] = [];
  const alternativePools = new Map<string, ShareOverhangBarSegment[]>();

  for (const segment of segments) {
    if (segment.poolId && segment.poolRelationship === "alternative_max") {
      const existing = alternativePools.get(segment.poolId) || [];
      existing.push(segment);
      alternativePools.set(segment.poolId, existing);
    } else {
      output.push(segment);
    }
  }

  for (const poolSegments of alternativePools.values()) {
    if (poolSegments.length <= 1) {
      output.push(...poolSegments);
      continue;
    }
    const representative =
      poolSegments.reduce((selected, segment) => ((segment.numericValue || 0) > (selected.numericValue || 0) ? segment : selected), poolSegments[0]) ||
      poolSegments[0];
    const label = Array.from(new Set(poolSegments.map((segment) => segment.label).filter(Boolean))).join(" / ");
    output.push({
      ...representative,
      label: label || representative.label,
      note: representative.note || "Alternative maximum pool",
    });
  }

  return output;
}

function detectShareOverhangUnit(segments: ShareOverhangBarSegment[]) {
  const text = segments.map((segment) => segment.value).join(" ");
  if (/\bADSs?\b/i.test(text)) return "ADSs";
  if (/\bunits?\b/i.test(text)) return "units";
  return "shares";
}

function formatShareOverhangCount(value: number, unit: string) {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

function OfferingTermsShareOverhangDetails({
  fallbackSubtitle,
  fallbackSupplyDetailLabel,
  fallbackTitle,
  model,
}: {
  fallbackSubtitle: string;
  fallbackSupplyDetailLabel: string;
  fallbackTitle: string;
  model: ReturnType<typeof buildDilutionOfferingModel>;
}) {
  const overhang = model.llmShareOverhang;
  if (!overhang) return <OfferingTermsSourceDetails model={model} />;

  const canRenderChart = overhang.overhangBarSegments.length > 0;
  const computedScale = computeVisibleShareOverhangScale(overhang.overhangBarSegments);
  const rawRatioValue = overhang.totalNoteRatio || overhang.ratioValue || overhang.statusValue || "Variable";
  const ratioValue =
    computedScale?.ratioValue || (/%/.test(rawRatioValue) ? rawRatioValue : /%/.test(overhang.statusValue) ? overhang.statusValue : rawRatioValue);
  const statusValue =
    computedScale?.ratioValue || (/%/.test(ratioValue) && !/%/.test(overhang.statusValue) ? ratioValue : overhang.statusValue || ratioValue);
  const supplyValue = computedScale?.supplyValue || overhang.totalNoteNumerator || overhang.supplyValue || "Variable";
  const currentValue = computedScale?.currentValue || overhang.totalNoteDenominator || overhang.currentValue || "Not fixed yet";
  const usesComputedSegmentScale = Boolean(computedScale && canRenderChart);
  const statusLabel = normalizeComputedShareOverhangStatusLabel(overhang.statusLabel, usesComputedSegmentScale);
  const scoreCaption = usesComputedSegmentScale
    ? normalizeComputedShareOverhangCaption(overhang.caption || overhang.ratioLabel, overhang.overhangBarSegments) || "of current shares"
    : overhang.caption || overhang.ratioLabel || model.overhangScoreCaption;
  const totalNoteSuffix =
    overhang.totalNoteSuffix || (usesComputedSegmentScale ? "of current shares" : overhang.ratioLabel || "source-backed share scale");

  return (
    <DilutionShareOverhang
      model={{
        canRenderOverhangChart: canRenderChart,
        chartTitle: overhang.chartTitle || fallbackTitle,
        currentDetailLabel: overhang.currentLabel || "Current Shares Outstanding",
        currentSharesCompact: currentValue,
        dilutionRatioPercentValue: statusValue,
        dilutionRatioValue: ratioValue,
        overhangAriaLabel: `${overhang.chartTitle || fallbackTitle}: ${ratioValue}`,
        overhangBarSegments: overhang.overhangBarSegments,
        overhangLevel: statusLabel || (usesComputedSegmentScale ? "Total potential supply" : model.overhangLevel),
        overhangLevelLabel: statusLabel ? "Status" : undefined,
        overhangNote: overhang.note,
        overhangScoreCaption: scoreCaption,
        overhangSubtitle: overhang.subtitle || fallbackSubtitle,
        overhangUnavailableMessage: overhang.note || "Final share impact depends on source-backed terms shown below.",
        potentialSupplyCompact: supplyValue,
        showBreakdownPanel: false,
        showSegmentLegend: canRenderChart,
        showTotalNote: canRenderChart && Boolean(currentValue && supplyValue && ratioValue),
        requireProvidedSupplyDetails: true,
        supplyDetailRows: model.offeringDetailsRows,
        conditionalSupplyRows: overhang.conditionalSupplyRows,
        extraDetailPanels: [
          ...(overhang.conditionalExerciseScaleRows.length
            ? [{ title: "If Exercised", rows: overhang.conditionalExerciseScaleRows }]
            : []),
          ...buildWarrantExtraDetailPanels(model),
        ],
        supplyDetailTitle: "Offering Details",
        supplyDetailLabel: overhang.supplyLabel || fallbackSupplyDetailLabel,
        totalNoteSuffix,
        totalNoteTitle: overhang.totalNoteTitle || overhang.ratioLabel || "Total Potential Overhang",
        totalOverhangLabel: overhang.ratioLabel || "Total Potential Overhang",
        unavailableRows: overhang.unavailableRows.length
          ? overhang.unavailableRows
          : [
              { label: overhang.currentLabel || "Current shares", value: currentValue },
              { label: overhang.supplyLabel || fallbackSupplyDetailLabel, value: supplyValue },
              { label: overhang.ratioLabel || "Scale", value: ratioValue, tone: "danger" },
            ],
      }}
    />
  );
}

function normalizeComputedShareOverhangStatusLabel(value: string, usesComputedSegmentScale: boolean) {
  const label = value.trim();
  if (!label) return "";
  if (!usesComputedSegmentScale) return label;
  if (/^(?:not stated|not disclosed|not fixed|variable)(?:\s+of\b.*)?$/i.test(label)) return "";
  if (/^(?:status|scale|ratio|value|result)$/i.test(label)) return "";
  if (/%/.test(label)) return "";
  return label;
}

function normalizeComputedShareOverhangCaption(value: string, segments: ShareOverhangBarSegment[]) {
  const caption = value.trim();
  if (!caption) return "";
  if (/^(?:not stated|not disclosed|not fixed|variable)(?:\s+of\b.*)?$/i.test(caption)) return "";
  const includedSegments = segments.filter(isCountedInShareOverhangRatio);
  if (/\bpre[-\s]?funded\b/i.test(caption)) {
    const hasNonPrefundedSupply = includedSegments.some((segment) => !/\bpre[-\s]?funded\b/i.test(`${segment.label} ${segment.value}`));
    if (hasNonPrefundedSupply) return "";
  }
  return caption;
}

function PricedOfferingDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  if (model.llmShareOverhang) {
    return (
      <OfferingTermsShareOverhangDetails
        model={model}
        fallbackSupplyDetailLabel="New Shares"
        fallbackTitle="Share Dilution"
        fallbackSubtitle="Current shares plus new shares"
      />
    );
  }
  if (model.is424bOfferingTermsPayload) return <OfferingTermsSourceDetails model={model} />;

  const pricedSegments = model.overhangBarSegments.map((segment) =>
    /\b(?:warrants?|preferred|convertible|rights)\b/i.test(segment.label)
      ? segment
      : segment.key === "registered-supply" || /\b(?:common|ordinary|ads)\b/i.test(segment.label)
      ? {
          ...segment,
          label: "New shares",
        }
      : segment,
  );

  return (
    <DilutionShareOverhang
      model={{
        ...model,
        chartTitle: "Share Dilution",
        overhangAriaLabel: `New shares equal ${model.dilutionRatioValue} of current shares`,
        overhangBarSegments: pricedSegments,
        overhangSubtitle: "Current shares plus new shares",
        overhangUnavailableMessage:
          "Share dilution scale could not be shown because current shares or new shares were unavailable.",
        potentialSupplyCompact: model.potentialSupplyCompact,
        showBreakdownPanel: false,
        showSegmentLegend: true,
        showTotalNote: true,
        requireProvidedSupplyDetails: true,
        supplyDetailRows: model.offeringDetailsRows,
        extraDetailPanels: buildWarrantExtraDetailPanels(model),
        supplyDetailTitle: "Offering Details",
        supplyDetailLabel: "New Shares",
        totalNoteSuffix: "new shares vs. current shares",
        totalNoteTitle: "Dilution vs Current Shares",
        totalOverhangLabel: "Dilution vs Current Shares",
      }}
    />
  );
}

function MixedOfferingDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  if (model.llmShareOverhang) {
    return (
      <OfferingTermsShareOverhangDetails
        model={model}
        fallbackSupplyDetailLabel="Potential Supply"
        fallbackTitle="Mixed Offering"
        fallbackSubtitle="Current shares plus source-backed offering supply"
      />
    );
  }
  if (model.is424bOfferingTermsPayload) return <OfferingTermsSourceDetails model={model} />;

  return (
    <DilutionShareOverhang
      model={{
        ...model,
        chartTitle: "Mixed Offering",
        overhangAriaLabel: `Potential offering supply equals ${model.dilutionRatioValue} of current shares`,
        overhangSubtitle: "Current shares plus new shares and instrument-linked supply",
        overhangUnavailableMessage:
          "Mixed offering scale could not be shown because current shares or source-backed supply counts were unavailable.",
        potentialSupplyCompact: model.potentialSupplyCompact,
        showBreakdownPanel: false,
        showSegmentLegend: true,
        showTotalNote: true,
        requireProvidedSupplyDetails: true,
        supplyDetailRows: model.offeringDetailsRows,
        extraDetailPanels: buildWarrantExtraDetailPanels(model),
        supplyDetailTitle: "Offering Details",
        supplyDetailLabel: "Potential Supply",
        totalNoteSuffix: "potential supply vs. current shares",
        totalNoteTitle: "Total Potential Dilution",
        totalOverhangLabel: "Dilution vs Current Shares",
      }}
    />
  );
}

function ResaleRegistrationDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  if (model.llmShareOverhang) {
    return (
      <OfferingTermsShareOverhangDetails
        model={model}
        fallbackSupplyDetailLabel={model.isS8ReofferResale ? model.supplyDetailLabel : "Resale Shares"}
        fallbackTitle="Share Overhang"
        fallbackSubtitle={`${model.currentDetailLabel || "Current shares"} plus registered resale shares`}
      />
    );
  }
  if (model.is424bOfferingTermsPayload) return <OfferingTermsSourceDetails model={model} />;

  const isS8ReofferResale = model.isS8ReofferResale;
  const resaleSegments = model.overhangBarSegments.map((segment) =>
    /\b(?:warrants?|preferred|convertible|rights)\b/i.test(segment.label)
      ? segment
      : segment.key === "registered-supply" || /\b(?:resale|common|ordinary|ads)\b/i.test(segment.label)
      ? {
          ...segment,
          label: isS8ReofferResale ? model.primaryExposureLabel : "Resale shares",
        }
      : segment,
  );

  return (
    <DilutionShareOverhang
      model={{
        ...model,
        chartTitle: "Share Overhang",
        overhangAriaLabel: isS8ReofferResale
          ? `Parent plan shares equal ${model.dilutionRatioValue} of current shares`
          : `Registered resale shares equal ${model.dilutionRatioValue} of ${model.currentDetailLabel || "current shares"}`,
        overhangBarSegments: resaleSegments,
        overhangSubtitle: isS8ReofferResale ? model.overhangSubtitle : `${model.currentDetailLabel || "Current shares"} plus registered resale shares`,
        overhangUnavailableMessage:
          isS8ReofferResale
            ? model.overhangUnavailableMessage
            : "Resale overhang could not be shown because current shares or resale shares were unavailable.",
        potentialSupplyCompact: model.potentialSupplyCompact,
        showBreakdownPanel: false,
        showSegmentLegend: true,
        showTotalNote: true,
        requireProvidedSupplyDetails: true,
        supplyDetailRows: isS8ReofferResale ? model.s8ContextDetailRows : model.offeringDetailsRows,
        extraDetailPanels: buildWarrantExtraDetailPanels(model),
        supplyDetailTitle: isS8ReofferResale ? "What Changed" : "Offering Details",
        supplyDetailLabel: isS8ReofferResale ? model.supplyDetailLabel : "Resale Shares",
        totalNoteSuffix: isS8ReofferResale ? "parent plan shares vs. current shares" : `resale shares vs. ${model.currentDetailLabel || "current shares"}`,
        totalNoteTitle: isS8ReofferResale ? "Parent Plan / Outstanding" : "Total Potential Overhang",
        totalOverhangLabel: isS8ReofferResale ? "Parent Plan / Outstanding" : "Overhang vs Current Shares",
      }}
    />
  );
}

function getWarrantConvertibleChartTitle(model: ReturnType<typeof buildDilutionOfferingModel>) {
  const instrumentText = [
    model.conversionBreakdownLabel,
    model.instrumentPriceSummary,
    model.warrantSegmentLabel,
    ...model.warrantInstrumentRows.map((row) => row.type),
  ].join(" ");
  const hasPrefunded = /\bpre[-\s]?funded\b/i.test(instrumentText);
  const nonPrefundedText = instrumentText.replace(/\bpre[-\s]?funded\s+warrants?\b/gi, "");
  const hasWarrant = (model.hasWarrantSegment && !hasPrefunded) || /\bwarrants?\b/i.test(nonPrefundedText);
  const hasPreferred = /\bpreferred\b/i.test(instrumentText);
  const hasConvertible = model.hasConversionSegment || /\bconvert|debenture|notes?\b/i.test(instrumentText);
  const hasConversionFamily = hasPreferred || hasConvertible;
  const familyCount = [hasPrefunded, hasWarrant, hasConversionFamily].filter(Boolean).length;

  if (familyCount >= 2) return "Mixed Instrument Supply";
  if (hasPrefunded) return "Pre-Funded Warrant Supply";
  if (hasPreferred) return "Preferred Conversion Supply";
  if (hasConvertible) return "Convertible Share Supply";
  return "Warrant Share Supply";
}

function WarrantConvertibleDetails({ model }: { model: ReturnType<typeof buildDilutionOfferingModel> }) {
  const chartTitle = getWarrantConvertibleChartTitle(model);
  if (model.llmShareOverhang) {
    return (
      <OfferingTermsShareOverhangDetails
        model={model}
        fallbackSupplyDetailLabel="Potential Supply"
        fallbackTitle={chartTitle}
        fallbackSubtitle="Current shares plus warrant or conversion share supply"
      />
    );
  }
  if (model.is424bOfferingTermsPayload) return <OfferingTermsSourceDetails model={model} />;

  const useVariableConversionExposure = Boolean(model.isNoFloorVariableConvertibleExposure && !model.canRenderOverhangChart);
  const variableConvertibleInstrument = model.warrantInstrumentRows[0];
  const variableConvertiblePrincipal = variableConvertibleInstrument?.sharesSecurities || "";
  const variableConvertibleCash = model.companyProceeds || "";
  const variableConvertibleAmount =
    variableConvertiblePrincipal && variableConvertibleCash
      ? `${variableConvertiblePrincipal.replace(/\s+principal amount$/i, " principal")} / ${variableConvertibleCash} cash`
      : variableConvertibleCash || variableConvertiblePrincipal;
  const variableConvertibleRows = [
    { label: "Current shares", value: model.currentSharesCompact },
    { label: "Conversion price", value: model.instrumentPriceSummary || "Variable" },
    variableConvertibleAmount ? { label: "Principal / cash proceeds", value: variableConvertibleAmount } : null,
    variableConvertibleInstrument?.termLimits
      ? { label: "Term / limits", value: variableConvertibleInstrument.termLimits }
      : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <DilutionShareOverhang
      model={{
        ...model,
        chartTitle,
        overhangAriaLabel: useVariableConversionExposure
          ? "Convertible share supply is variable until the conversion price is set"
          : `Potential warrant or conversion shares equal ${model.dilutionRatioValue} of current shares`,
        overhangLevel: useVariableConversionExposure ? "Potential Dilution" : model.overhangLevel,
        overhangScoreCaption: useVariableConversionExposure ? "" : model.overhangScoreCaption,
        overhangSubtitle: useVariableConversionExposure
          ? "Share count is variable until the conversion price is set."
          : "Current shares plus warrant or conversion share supply",
        overhangUnavailableMessage: useVariableConversionExposure
          ? "No floor price was stated, so lower stock prices could require more shares for the same note principal."
          : "Warrant or conversion share supply could not be shown because current shares or underlying securities were unavailable.",
        dilutionRatioPercentValue: useVariableConversionExposure ? "Variable" : model.dilutionRatioPercentValue,
        compactScore: useVariableConversionExposure,
        potentialSupplyCompact: model.potentialSupplyCompact,
        unavailableSupplyValue: useVariableConversionExposure ? model.instrumentPriceSummary || "Variable" : model.potentialSupplyCompact,
        unavailableRows: useVariableConversionExposure ? variableConvertibleRows : undefined,
        hideUnavailableRows: useVariableConversionExposure,
        showBreakdownPanel: false,
        showSegmentLegend: true,
        showTotalNote: true,
        requireProvidedSupplyDetails: true,
        supplyDetailRows: model.offeringDetailsRows,
        extraDetailPanels: useVariableConversionExposure ? [] : buildWarrantExtraDetailPanels(model),
        supplyDetailTitle: "Offering Details",
        supplyDetailLabel: useVariableConversionExposure ? "Conversion Price" : "Underlying Securities",
        totalNoteSuffix: "underlying securities vs. current shares",
        totalNoteTitle: "Potential Dilution",
        totalOverhangLabel: "Dilution vs Current Shares",
      }}
    />
  );
}

function findMetricValue(metrics: DilutionMetricItem[], label: string) {
  return metrics.find((metric) => metric.label === label)?.value || "";
}

function buildWarrantExtraDetailPanels(model: ReturnType<typeof buildDilutionOfferingModel>) {
  const panels: Array<{ title: string; rows?: DilutionDisclosureRow[]; instrumentRows?: typeof model.warrantInstrumentRows }> = [];
  if (model.warrantInstrumentRows.length) {
    panels.push({ title: "Instrument Details", instrumentRows: model.warrantInstrumentRows });
    return panels;
  }
  if (model.warrantDetailsRows.length) {
    panels.push({ title: "Warrant Details", rows: model.warrantDetailsRows });
  }
  return panels;
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
      <SecFilingHtmlViewer
        html={filing.originalHtml}
        sourceUrl={filing.primaryDocumentUrl || filing.sourceUrl}
        title={`${filing.formType} original SEC filing`}
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

type ShareOverhangSupplyNature =
  | "base_shares"
  | "current_offering_supply"
  | "registered_resale_supply"
  | "common_equivalent_supply"
  | "conditional_future_supply"
  | "replacement_supply";

type ShareOverhangSupplyType =
  | "current_offering_pool"
  | "registered_resale_pool"
  | "share_equivalent"
  | "future_exercise"
  | "replacement_alternative"
  | "atm_capacity"
  | "shelf_capacity"
  | "public_float"
  | "market_cap"
  | "market_value";

type ShareOverhangCalculationRole =
  | "denominator"
  | "headline_numerator"
  | "visible_excluded"
  | "note_only";

type ShareOverhangRowRole = "counted" | "conditional" | "alternative" | "reference";

type ShareOverhangPoolRelationship = "alternative_max" | "additive";

type LlmShareOverhangFactRow = {
  key?: string;
  className?: string;
  rowRole?: ShareOverhangRowRole;
  supplyNature?: ShareOverhangSupplyNature;
  supplyType?: ShareOverhangSupplyType;
  countedInRatio?: boolean;
  calculationRole?: ShareOverhangCalculationRole;
  unit?: string;
  classBasis?: string;
  poolId?: string;
  poolRelationship?: ShareOverhangPoolRelationship;
  label: string;
  value: string;
  note?: string;
  tone?: "danger" | "neutral";
  numericValue?: number | null;
};

type LlmShareOverhangModel = {
  chartTitle: string;
  subtitle: string;
  statusLabel: string;
  statusValue: string;
  caption: string;
  ratioLabel: string;
  ratioValue: string;
  currentLabel: string;
  currentValue: string;
  supplyLabel: string;
  supplyValue: string;
  totalNoteTitle: string;
  totalNoteNumerator: string;
  totalNoteDenominator: string;
  totalNoteRatio: string;
  totalNoteSuffix: string;
  note: string;
  unavailableRows: LlmShareOverhangFactRow[];
  conditionalSupplyRows: LlmShareOverhangFactRow[];
  overhangBarSegments: ShareOverhangBarSegment[];
  conditionalExerciseScaleRows: DilutionDisclosureRow[];
};

function DilutionMetric({ metric }: { metric: DilutionMetricItem }) {
  const title = /current shares/i.test(metric.label) ? CURRENT_SHARES_MARKET_CONTEXT_NOTE : undefined;

  return (
    <div className={`dilution-metric${metric.emphasis ? " emphasis" : ""}${metric.tone ? ` ${metric.tone}` : ""}`}>
      <span title={title}>{metric.label}</span>
      <strong>{metric.value}</strong>
      {metric.note ? <em>{metric.note}</em> : null}
    </div>
  );
}

function DilutionDisclosureSection({
  title,
  rows,
  emptyText,
  headingLabel = "Key terms",
}: {
  title: string;
  rows: DilutionDisclosureRow[];
  emptyText: string;
  headingLabel?: string;
}) {
  return (
    <section className="dilution-section-block">
      <div className="dilution-section-heading">
        <h2>{title}</h2>
        <span>{rows.length ? headingLabel : "No parsed fields"}</span>
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

function DilutionInstrumentDetailsSection({
  rows,
  emptyText,
}: {
  rows: ReturnType<typeof buildDilutionOfferingModel>["warrantInstrumentRows"];
  emptyText: string;
}) {
  return (
    <section className="dilution-section-block">
      <div className="dilution-section-heading">
        <h2>Instrument Details</h2>
        <span>{rows.length ? "Key terms" : "No parsed fields"}</span>
      </div>
      {rows.length ? (
        <div className="dilution-instrument-table dilution-source-instrument-table">
          <div className="dilution-instrument-row header">
            <span>Type</span>
            <span>Shares / Securities</span>
            <span>Exercise / Conversion Price</span>
            <span>Reset / Floor</span>
            <span>Term / Limits</span>
          </div>
          {rows.map((item, index) => (
            <div key={`${item.type}-${index}`} className="dilution-instrument-row">
              <strong className="dilution-instrument-cell" data-label="Type">
                {item.type}
              </strong>
              <span className="dilution-instrument-cell" data-label="Shares / Securities">
                {displayInstrumentValue(item.sharesSecurities)}
              </span>
              <span className="dilution-instrument-cell" data-label="Exercise / Conversion Price">
                {displayInstrumentValue(item.exerciseConversionPrice)}
              </span>
              <span className="dilution-instrument-cell" data-label="Reset / Floor">
                {displayInstrumentValue(item.resetFloor)}
              </span>
              <span className="dilution-instrument-cell" data-label="Term / Limits">
                {displayInstrumentValue(item.termLimits)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="dilution-empty-note">{emptyText}</p>
      )}
    </section>
  );
}

function displayInstrumentValue(value: string | undefined) {
  const normalized = (value || "").trim();
  if (!normalized || /^(?:null|undefined|none|n\/a|not stated)$/i.test(normalized)) {
    return "-";
  }
  return normalized;
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

function OwnershipRelatedFilingsPanel({ filing }: { filing: FilingEvent }) {
  const filings = filing.ownershipRelatedFilings ?? [];
  if (filing.eventType !== "insider_ownership" || filings.length === 0) return null;

  return <RelatedFilingsContextList filings={filings} heading="Related Filings" subheading="Ownership context" />;
}

function FilingRelatedFilingsPanel({ filing }: { filing: FilingEvent }) {
  const contextFilings = filing.contextRelatedFilings ?? [];
  if (contextFilings.length > 0) {
    return <RelatedFilingsContextList filings={contextFilings} heading="Related Filings" subheading="Transaction context" />;
  }

  return <OwnershipRelatedFilingsPanel filing={filing} />;
}

function RelatedFilingsContextList({
  filings,
  heading,
  subheading,
}: {
  filings: FilingContextRelatedFiling[];
  heading: string;
  subheading: string;
}) {
  if (filings.length === 0) return null;

  return (
    <section className="stock-detail-card dilution-related-filings ownership-related-filings">
      <div className="dilution-related-heading">
        <h2>{heading}</h2>
        <span>{subheading}</span>
      </div>
      <div className="dilution-related-list">
        {filings.slice(0, 6).map((related) => {
          const match = related.matchConfidence ? `Match ${related.matchConfidence}` : "";
          const details = [related.filedAt, related.eventType, related.accession, match].filter(Boolean).join(" · ");
          const content = (
            <>
              <span className={`ownership-related-relation${related.candidate ? " candidate" : ""}`}>
                {related.relation}
              </span>
              <span className="dilution-related-form ownership-related-form-type">{related.form}</span>
              <span className="dilution-related-copy">
                <strong>{related.title}</strong>
                <small>{related.description}</small>
                {details ? <small>{details}</small> : null}
              </span>
              <span className="dilution-related-impact">
                <small>Impact</small>
                <b>{related.score}</b>
              </span>
            </>
          );

          return related.id ? (
            <Link
              className="dilution-related-item"
              href={`/filings/${related.id}`}
              key={`${related.relation}-${related.id}`}
            >
              {content}
            </Link>
          ) : (
            <div className="dilution-related-item" key={`${related.relation}-${related.accession}-${related.title}`}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const SPAC_DEFAULT_STAGES = [
  "Target / Deal Signed",
  "SEC Filing / Proxy",
  "Vote & Redemption Window",
  "Redemption Result",
  "Cash / Listing Conditions",
  "Closing / Ticker Change",
] as const;

const SPAC_STAGE_ORDER = [
  { code: "target", label: "Target / Deal Signed" },
  { code: "proxy", label: "SEC Filing / Proxy" },
  { code: "vote", label: "Vote & Redemption Window" },
  { code: "redemption", label: "Redemption Result" },
  { code: "cash", label: "Cash / Listing Conditions" },
  { code: "closing", label: "Closing / Ticker Change" },
] as const;

type SpacStageCode = (typeof SPAC_STAGE_ORDER)[number]["code"];

const SPAC_STAGE_LABELS = SPAC_STAGE_ORDER.reduce<Record<SpacStageCode, string>>((labels, stage) => {
  labels[stage.code] = stage.label;
  return labels;
}, {} as Record<SpacStageCode, string>);

function buildListingRiskModel(filing: FilingEvent): ListingRiskModel | null {
  const displayPayload = readPlainRecord(filing.displayPayload);
  if (readRowString(displayPayload, "display_type") !== "listing_risk") return null;

  const data = readDisplayPayloadData(displayPayload);
  if (
    !hasEnoughSpecialDisplayFields(
      data,
      [
        "exchange",
        "compliance_status",
        "deficiency_notice",
        "main_risk_driver",
        "current_point",
        "notice_date",
        "cure_deadline",
        "appeal_hearing_status",
      ],
      2,
    )
  ) {
    return null;
  }

  const complianceStatus = displayString(data, "compliance_status", "Not disclosed");
  const mainRiskDriver = displayString(data, "main_risk_driver", "Not disclosed");
  const noActiveDeficiency = isNoActiveListingDeficiency(complianceStatus, mainRiskDriver, data);

  return {
    exchange: displayString(data, "exchange", filing.exchange || "Not disclosed"),
    complianceStatus,
    deficiencyNotice: displayString(data, "deficiency_notice", noActiveDeficiency ? "No active deficiency disclosed" : filing.filingBrief),
    mainRiskDriver,
    currentPoint: displayString(data, "current_point", noActiveDeficiency ? "Requirement satisfied" : "Compliance review active"),
    curePeriod: displayString(data, "cure_period", "Not disclosed"),
    cureDeadline: displayString(data, "cure_deadline", "Not disclosed"),
    extensionEligibility: displayString(data, "extension_eligibility", "Not disclosed"),
    appealHearingStatus: displayString(data, "appeal_hearing_status", "Not disclosed"),
    extensionReviewDate: displayString(data, "extension_review_date", "Not disclosed"),
    hearingAppealDeadline: displayString(data, "hearing_appeal_deadline", "Not disclosed"),
    bidPrice: displayString(data, "bid_price", "Not disclosed"),
    stockholdersEquity: displayString(data, "stockholders_equity", "Not disclosed"),
    marketValue: displayString(data, "market_value", "Not disclosed"),
    publicFloat: displayString(data, "public_float", "Not disclosed"),
    publicHolders: displayString(data, "public_holders", "Not disclosed"),
    reverseSplitHistory: displayString(data, "reverse_split_history", "Not disclosed"),
    lateFilingGovernance: displayString(data, "late_filing_governance", "Not disclosed"),
    representativeThresholdsNote: displayString(
      data,
      "representative_thresholds_note",
      "Exchange thresholds are shown only when source-backed in the filing payload.",
    ),
    noActiveDeficiency,
    checks: normalizeListingRiskChecks(data),
    timeline: normalizeListingRiskTimeline(data, filing.filedAt),
    riskFlags: displayStringArray(data.risk_flags, filing.bearishPoints.length ? filing.bearishPoints : ["No active deficiency disclosed."]),
    watchNext: displayStringArray(data.watch_next, filing.watchNext.length ? filing.watchNext : ["Next exchange compliance update."]),
    sources: normalizeSpecialSources(data.sources, filing.sourceUrl, "Listing-risk source evidence"),
  };
}

function buildEarningsModel(filing: FilingEvent): EarningsModel | null {
  const displayPayload = readPlainRecord(filing.displayPayload);
  if (readRowString(displayPayload, "display_type") !== "earnings") return null;

  const data = readDisplayPayloadData(displayPayload);
  if (
    !hasEnoughSpecialDisplayFields(
      data,
      ["period", "revenue", "eps", "net_income", "guidance_summary", "cash", "management_outlook"],
      2,
    )
  ) {
    return null;
  }

  return {
    periodType: displayString(data, "period_type", "Not disclosed"),
    period: displayString(data, "period", "Reported period"),
    reportDate: displayString(data, "report_date", filing.filedAt || "Not disclosed"),
    revenue: displayString(data, "revenue", "Not disclosed"),
    revenueComparison: displayString(data, "revenue_comparison", "No comparison disclosed"),
    eps: displayString(data, "eps", "Not disclosed"),
    netIncome: displayString(data, "net_income", "Not disclosed"),
    yoyGrowth: displayString(data, "yoy_growth", displayString(data, "revenue_comparison", "Not disclosed")),
    estimateBeatMiss: displayString(data, "estimate_beat_miss", "Not disclosed"),
    marginSummary: displayString(data, "margin_summary", "Not disclosed"),
    grossMargin: displayString(data, "gross_margin", "Not disclosed"),
    operatingMargin: displayString(data, "operating_margin", "Not disclosed"),
    ebitdaMargin: displayString(data, "ebitda_margin", "Not disclosed"),
    guidanceSummary: displayString(data, "guidance_summary", "No guidance disclosed"),
    revenueGuidance: displayString(data, "revenue_guidance", "Not disclosed"),
    epsGuidance: displayString(data, "eps_guidance", "Not disclosed"),
    marginGuidance: displayString(data, "margin_guidance", displayString(data, "margin_summary", "Not disclosed")),
    guidanceTone: normalizeGuidanceTone(displayString(data, "guidance_tone", displayString(data, "guidance_signal", "Neutral"))),
    guidanceChange: displayString(data, "guidance_change", "Not disclosed"),
    forwardCommentary: displayString(data, "forward_commentary", displayString(data, "management_outlook", "Not disclosed")),
    cash: displayString(data, "cash", "Not disclosed"),
    cashBurn: displayString(data, "cash_burn", "Not disclosed"),
    runway: displayString(data, "runway", "Not disclosed"),
    managementOutlook: displayString(data, "management_outlook", filing.summary || "Not disclosed"),
    numbers: normalizeEarningsMetrics(data.numbers, [
      { label: "Revenue", value: displayString(data, "revenue", "Not disclosed"), comparison: displayString(data, "revenue_comparison", "No comparison disclosed"), note: "Current quarter sales." },
      { label: "EPS", value: displayString(data, "eps", "Not disclosed"), comparison: displayString(data, "estimate_beat_miss", "No estimate context"), note: "Current quarter EPS." },
      { label: "Net Income", value: displayString(data, "net_income", "Not disclosed"), comparison: "Reported result", note: "Current quarter profitability." },
      { label: "YoY Growth", value: displayString(data, "yoy_growth", displayString(data, "revenue_comparison", "Not disclosed")), comparison: "Revenue growth", note: "Year-over-year sales change." },
      { label: "Estimate Beat/Miss", value: displayString(data, "estimate_beat_miss", "Not disclosed"), comparison: "Consensus context", note: "Only source-backed when estimate context exists." },
    ]),
    actuals: normalizeEarningsMetrics(data.actuals, [
      { label: "Revenue", value: displayString(data, "revenue", "Not disclosed"), comparison: displayString(data, "revenue_comparison", "No comparison disclosed"), note: "Reported actual result." },
      { label: "EPS", value: displayString(data, "eps", "Not disclosed"), comparison: "No comparison disclosed", note: "Reported actual result when disclosed." },
      { label: "Net Income", value: displayString(data, "net_income", "Not disclosed"), comparison: "No comparison disclosed", note: "Reported actual result when disclosed." },
    ]),
    guidance: normalizeEarningsMetrics(data.guidance, [
      { label: "Guidance Summary", value: displayString(data, "guidance_summary", "No guidance disclosed"), comparison: "Forward-looking", note: "Guidance is separate from actual results." },
    ]),
    marginMetrics: normalizeEarningsMetrics(data.margin_metrics, [
      { label: "Gross Margin", value: displayString(data, "gross_margin", "Not disclosed"), comparison: "No comparison disclosed", note: "Margin quality check." },
      { label: "Operating Margin", value: displayString(data, "operating_margin", "Not disclosed"), comparison: "No comparison disclosed", note: "Operating leverage check." },
      { label: "EBITDA Margin", value: displayString(data, "ebitda_margin", "Not disclosed"), comparison: "No comparison disclosed", note: "Cash-profit proxy when disclosed." },
    ]),
    marginTrend: displayString(data, "margin_trend", inferEarningsMarginTrend(displayString(data, "margin_summary", ""))),
    marginTrendNote: displayString(data, "margin_trend_note", displayString(data, "margin_summary", "Not disclosed")),
    segments: normalizeEarningsSegments(data.segments),
    surprises: normalizeEarningsMetrics(data.surprises, [
      { label: "Surprise Context", value: "Not available", comparison: "No context disclosed", note: "Do not infer surprise without prior, guidance, or consensus context." },
    ]),
    riskSignals: normalizeEarningsRiskSignals(data.risk_signals, data, filing.bearishPoints),
    riskFlags: displayStringArray(data.risk_flags, filing.bearishPoints),
    watchNext: displayStringArray(data.watch_next, filing.watchNext),
    sources: normalizeSpecialSources(data.sources, filing.sourceUrl, "Earnings source evidence"),
  };
}

function buildFdaClinicalModel(filing: FilingEvent): FdaClinicalModel | null {
  const displayPayload = readPlainRecord(filing.displayPayload);
  if (readRowString(displayPayload, "display_type") !== "fda_clinical") return null;

  const data = readDisplayPayloadData(displayPayload);
  if (
    !hasEnoughSpecialDisplayFields(
      data,
      [
        "phase",
        "indication",
        "therapy",
        "trial_name",
        "event_status",
        "primary_endpoint",
        "next_milestone",
        "fda_status",
      ],
      2,
    )
  ) {
    return null;
  }

  const eventSummary = displayString(data, "event_summary", filing.summary || filing.filingBrief);
  const phase = displayString(data, "phase", "Phase not disclosed");
  const indication = displayString(data, "indication", "Not disclosed");
  const therapy = displayString(data, "therapy", displayString(data, "drug_name", filing.company));
  const trialName = displayString(data, "trial_name", "Trial name not disclosed");
  const eventStatus = displayString(data, "event_status", filing.filingFocus || "Clinical update");
  const primaryEndpoint = displayString(data, "primary_endpoint", "Not disclosed");
  const dataReadout = displayString(data, "data_readout", "Not disclosed");
  const fdaStatus = displayString(data, "fda_status", "Not disclosed");
  const nextMilestone = displayString(data, "next_milestone", filing.watchNext[0] || "Next FDA or clinical update");

  return {
    phase,
    indication,
    therapy,
    trialName,
    eventStatus,
    eventSummary,
    primaryEndpoint,
    patientPopulation: displayString(data, "patient_population", "Not disclosed"),
    dataReadout,
    nextMilestone,
    fdaStatus,
    keyTakeaways: displayStringArray(data.key_takeaways, filing.keyEvidence.length ? filing.keyEvidence : [eventSummary]).slice(0, 4),
    fdaTimeline: normalizeClinicalTimeline(data, filing.filedAt),
    dataHighlights: normalizeClinicalDataHighlights(data),
    risks: displayStringArray(data.risks, filing.bearishPoints.length ? filing.bearishPoints : ["Key clinical risk not disclosed."]),
    watchNext: displayStringArray(data.watch_next, filing.watchNext.length ? filing.watchNext : [nextMilestone]),
    marketSize: displayString(
      data,
      "market_size",
      "Market size was not quantified in the filing payload. Do not infer a numeric estimate without source support.",
    ),
    marketSizeSource: displayString(data, "market_size_source", "Source-backed market-size context was not disclosed."),
    sources: normalizeSpecialSources(data.sources, filing.sourceUrl, "FDA clinical source evidence"),
  };
}

const IPO_STAGE_ORDER: Array<{ code: IpoStageCode; label: string }> = [
  { code: "s1_filed", label: "S-1/F-1 Filed" },
  { code: "terms_set", label: "Terms / Range Set" },
  { code: "effect", label: "SEC Effective" },
  { code: "pricing", label: "Pricing / 424B4" },
  { code: "listing", label: "First Trade" },
  { code: "lockup", label: "Lock-Up Expiry" },
];

const IPO_STAGE_LABELS = IPO_STAGE_ORDER.reduce<Record<IpoStageCode, string>>((labels, stage) => {
  labels[stage.code] = stage.label;
  return labels;
}, {} as Record<IpoStageCode, string>);

function buildIpoListingModel(filing: FilingEvent): IpoListingModel | null {
  const displayPayload = readPlainRecord(filing.displayPayload);
  const displayType = readRowString(displayPayload, "display_type");
  const data = readDisplayPayloadData(displayPayload);
  const displayMode = readRowString(data, "display_mode") || readRowString(data, "offering_ui_mode");
  const isOfferingTermsIpo =
    displayType === "offering_terms" &&
    ["ipo_registration", "ipo_amendment", "spac_ipo", "rule_462b_mef"].includes(displayMode);

  if (displayType !== "ipo_listing" && !isOfferingTermsIpo) return null;

  if (
    displayType === "ipo_listing" &&
    !hasEnoughSpecialDisplayFields(
      data,
      [
        "issuer",
        "proposed_ticker",
        "exchange",
        "price_range",
        "shares_offered",
        "offering_size",
        "expected_pricing_date",
        "expected_listing_date",
        "underwriters",
        "lead_underwriters",
      ],
      2,
    )
  ) {
    return null;
  }

  const snapshotMetric = (...labels: string[]) => readLabeledDisplayValue(data.snapshot_metrics, labels);
  const offeringDetail = (...labels: string[]) => readLabeledDisplayValue(data.offering_details, labels);
  const currentStage = resolveIpoStage(data, filing.formType);
  const stages = normalizeIpoStages(data, currentStage);
  const currentStageIndex = Math.max(0, IPO_STAGE_ORDER.findIndex((stage) => stage.code === currentStage));
  const currentStageLabel = displayString(data, "current_stage_label", IPO_STAGE_LABELS[currentStage]);
  const issuer = displayString(data, "issuer", filing.company || "Not disclosed");
  const proposedTicker = displayString(data, "proposed_ticker", isRealTicker(filing.ticker) ? filing.ticker : "Not disclosed");
  const exchange = displayString(data, "exchange", snapshotMetric("Proposed exchange", "Exchange / ticker") || filing.exchange || "Not disclosed");
  const useOfProceeds = displayStringArray(data.use_of_proceeds, []);
  const useOfProceedsDetail = offeringDetail("Use of Proceeds");
  const priceRange = displayString(data, "price_range", snapshotMetric("Price range", "Updated price range", "Unit price") || "Not disclosed");
  const sharesOffered = displayString(data, "shares_offered", snapshotMetric("Shares offered", "Shares / ADS offered", "Updated shares / ADS", "Units offered") || "Not disclosed");
  const offeringSize = displayString(data, "offering_size", snapshotMetric("Offering size", "Gross proceeds", "Updated offering size", "Trust amount") || "Not disclosed");
  const underwriters = displayString(data, "underwriters", displayString(data, "lead_underwriters", offeringDetail("Underwriters") || "Pending"));
  const termsStatus = snapshotMetric("Terms status") || deriveInitialIpoTermsStatus(priceRange, sharesOffered, offeringSize);
  const sourceSnapshotMetrics = readSnapshotMetrics(data);
  const initialSnapshotMetrics = buildInitialIpoSnapshotMetrics({
    currentStageLabel,
    exchange,
    proposedTicker,
    termsStatus,
    underwriters,
    sourceMetrics: sourceSnapshotMetrics,
  });
  const termsUpdateSnapshotMetrics = buildIpoTermsUpdateSnapshotMetrics({
    exchange,
    offeringSize,
    priceRange,
    proposedTicker,
    sharesOffered,
    sourceMetrics: sourceSnapshotMetrics,
  });
  const mefSnapshotMetrics = buildMefSnapshotMetrics(sourceSnapshotMetrics);
  const snapshotMetrics =
    displayMode === "rule_462b_mef"
      ? mefSnapshotMetrics
      : displayMode === "ipo_amendment"
        ? termsUpdateSnapshotMetrics
        : initialSnapshotMetrics;
  const offeringDetailsRows = filterIpoOfferingDetailsRows(
    readOfferingDetailsRows(data),
    snapshotMetrics,
    displayMode,
  );
  const amendmentRows = readS1F1LabelValueRows(data.amendment_changes).slice(0, 6);
  const investorTakeaway = displayString(data, "investor_takeaway", "");
  const narrativeSummary = displayString(data, "company_story", "");
  const isInitialTermsPending =
    isOfferingTermsIpo &&
    displayMode === "ipo_registration" &&
    currentStage === "s1_filed" &&
    hasPendingInitialIpoTerms({ offeringSize, priceRange, sharesOffered, termsStatus });

  return {
    displayMode,
    isInitialTermsPending,
    ipoKind: displayString(data, "ipo_kind", isOfferingTermsIpo && displayMode === "spac_ipo" ? "SPAC IPO" : "Traditional IPO"),
    currentStage,
    currentStageLabel,
    stageBadge: `Stage ${currentStageIndex + 1}/${IPO_STAGE_ORDER.length} · ${currentStageLabel}`,
    displayQuickTake: displayString(data, "display_quick_take", ""),
    issuer,
    proposedTicker,
    exchange,
    companyStory: narrativeSummary,
    companyStage: displayString(data, "company_stage", "Not disclosed"),
    revenue: displayString(data, "revenue", "Not disclosed"),
    netLoss: displayString(data, "net_loss", "Not disclosed"),
    cash: displayString(data, "cash", "Not disclosed"),
    priceRange,
    midpointPrice: displayString(data, "midpoint_price", "Not disclosed"),
    sharesOffered,
    offeringSize,
    impliedValuation: displayString(data, "implied_valuation", "Not disclosed"),
    primarySecondaryMix: displayString(data, "primary_secondary_mix", "Not disclosed"),
    underwriters,
    underwriterOption: displayString(data, "underwriter_option", "Not disclosed"),
    floatPercent: displayString(data, "float_percent", "Not disclosed"),
    floatSummary: displayString(data, "float_summary", "Not disclosed"),
    lockupSummary: displayString(data, "lockup_summary", offeringDetail("Lock-up") || "Not disclosed"),
    lockupExpiration: displayString(data, "lockup_expiration", "Not disclosed"),
    expectedPricingDate: displayString(data, "expected_pricing_date", "Not disclosed"),
    expectedListingDate: displayString(data, "expected_listing_date", "Not disclosed"),
    useOfProceeds: (useOfProceeds.length ? useOfProceeds : useOfProceedsDetail ? [useOfProceedsDetail] : ["Not disclosed"]).slice(0, 4),
    snapshotMetrics,
    offeringDetailsRows,
    amendmentRows,
    stages,
    riskFlags: displayStringArray(data.risk_flags, filing.bearishPoints),
    watchNext: displayStringArray(data.watch_next, filing.watchNext),
    sources: normalizeIpoSources(data.sources, filing.sourceUrl),
  };
}

function deriveInitialIpoTermsStatus(priceRange: string, sharesOffered: string, offeringSize: string) {
  return [priceRange, sharesOffered, offeringSize].some(isPendingIpoTermValue) ? "Price and share count pending" : "Terms partially disclosed";
}

function hasPendingInitialIpoTerms({
  offeringSize,
  priceRange,
  sharesOffered,
  termsStatus,
}: {
  offeringSize: string;
  priceRange: string;
  sharesOffered: string;
  termsStatus: string;
}) {
  return [termsStatus, priceRange, sharesOffered, offeringSize].some(isPendingIpoTermValue);
}

function isPendingIpoTermValue(value: string) {
  const normalized = cleanDisclosureValue(value).toLowerCase();
  return (
    !isDisclosedValue(value) ||
    /\b(?:pending|to be determined|not yet|blank|not specified|not set)\b/i.test(normalized) ||
    /\$\s*(?:per share|and\s+\$|\s*$)/i.test(value)
  );
}

function buildInitialIpoSnapshotMetrics({
  currentStageLabel,
  exchange,
  proposedTicker,
  sourceMetrics,
  termsStatus,
  underwriters,
}: {
  currentStageLabel: string;
  exchange: string;
  proposedTicker: string;
  sourceMetrics: DilutionMetricItem[];
  termsStatus: string;
  underwriters: string;
}) {
  const allowed = new Set(["Filing stage", "Terms status", "Proposed exchange / ticker", "Underwriters"]);
  const normalizedRows = sourceMetrics
    .map((metric) => normalizeInitialIpoSnapshotMetric(metric))
    .filter((metric): metric is DilutionMetricItem => {
      if (!metric) return false;
      return allowed.has(metric.label);
    });
  const underwriterValue = compactInitialIpoUnderwriters(underwriters);

  const fallbackRows: DilutionMetricItem[] = [
    { label: "Filing stage", value: currentStageLabel, note: "Initial registration filed" },
    { label: "Terms status", value: termsStatus, note: "Awaiting amended prospectus" },
    {
      label: "Proposed exchange / ticker",
      value: formatInitialIpoListingValue(exchange, proposedTicker),
      note: "Planned listing venue",
    },
    {
      label: "Underwriters",
      value: underwriterValue,
      note: underwriterValue === "Pending" ? "To be named later" : "Lead banks",
    },
  ];

  const rowsByLabel = new Map<string, DilutionMetricItem>();
  [...normalizedRows, ...fallbackRows].forEach((metric) => {
    if (!rowsByLabel.has(metric.label) && isDisclosedValue(metric.value)) rowsByLabel.set(metric.label, metric);
  });

  return Array.from(allowed)
    .map((label) => rowsByLabel.get(label))
    .filter((metric): metric is DilutionMetricItem => Boolean(metric))
    .slice(0, 4);
}

function normalizeInitialIpoSnapshotMetric(metric: DilutionMetricItem): DilutionMetricItem | null {
  const normalized = normalizeDisplayLookupLabel(metric.label);
  if (/filing|stage/.test(normalized)) return { ...metric, label: "Filing stage" };
  if (/term|status|price|share/.test(normalized) && isPendingIpoTermValue(metric.value)) {
    return { ...metric, label: "Terms status", value: "Price and share count pending" };
  }
  if (/exchange|ticker|nasdaq|nyse/.test(normalized)) return { ...metric, label: "Proposed exchange / ticker" };
  if (/underwriter|bookrunner|lead bank|lead manager/.test(normalized)) return { ...metric, label: "Underwriters" };
  return null;
}

function buildIpoTermsUpdateSnapshotMetrics({
  exchange,
  offeringSize,
  priceRange,
  proposedTicker,
  sharesOffered,
  sourceMetrics,
}: {
  exchange: string;
  offeringSize: string;
  priceRange: string;
  proposedTicker: string;
  sharesOffered: string;
  sourceMetrics: DilutionMetricItem[];
}) {
  const allowed = new Set(["Shares offered", "Price range", "Offering size", "Exchange / ticker"]);
  const normalizedRows = sourceMetrics
    .map((metric) => normalizeIpoTermsUpdateSnapshotMetric(metric))
    .filter((metric): metric is DilutionMetricItem => Boolean(metric))
    .filter((metric) => allowed.has(metric.label));

  const fallbackRows: DilutionMetricItem[] = [
    { label: "Shares offered", value: sharesOffered, note: "Current amendment terms" },
    { label: "Price range", value: priceRange, note: "Current amendment range" },
    { label: "Offering size", value: offeringSize, note: "Estimated or stated deal size" },
    {
      label: "Exchange / ticker",
      value: formatInitialIpoListingValue(exchange, proposedTicker),
      note: "Planned listing venue",
    },
  ];

  const rowsByLabel = new Map<string, DilutionMetricItem>();
  [...normalizedRows, ...fallbackRows].forEach((metric) => {
    if (!rowsByLabel.has(metric.label) && isDisclosedValue(metric.value)) rowsByLabel.set(metric.label, metric);
  });

  return Array.from(allowed)
    .map((label) => rowsByLabel.get(label))
    .filter((metric): metric is DilutionMetricItem => Boolean(metric))
    .slice(0, 4);
}

function buildMefSnapshotMetrics(sourceMetrics: DilutionMetricItem[]) {
  const normalizedRows = sourceMetrics
    .map((metric) => normalizeMefSnapshotMetric(metric) ?? metric)
    .filter((metric) => isDisclosedValue(metric.value));

  const rowsByLabel = new Map<string, DilutionMetricItem>();
  normalizedRows.forEach((metric) => {
    if (!rowsByLabel.has(metric.label)) rowsByLabel.set(metric.label, metric);
  });

  return Array.from(rowsByLabel.values()).slice(0, 4);
}

function normalizeMefSnapshotMetric(metric: DilutionMetricItem): DilutionMetricItem | null {
  const normalized = normalizeDisplayLookupLabel(metric.label);
  if (/prior/.test(normalized) && /registration/.test(normalized)) return metric;
  if (/additional|added|new/.test(normalized) && /share|ads|security|securities/.test(normalized)) {
    return { ...metric, label: "Additional shares / ADS" };
  }
  if ((/total|pool/.test(normalized) && /share|ads|pool|registered/.test(normalized)) || /registered\s+pool/.test(normalized)) {
    return { ...metric, label: "Total registered pool" };
  }
  if (/value|amount|offering|aggregate|proceed/.test(normalized)) {
    return { ...metric, label: "Additional offering value" };
  }
  if (/462|20|limit/.test(normalized)) return { ...metric, label: "Rule 462(b) limit" };
  return null;
}

function filterIpoOfferingDetailsRows(
  rows: DilutionDisclosureRow[],
  snapshotMetrics: DilutionMetricItem[],
  displayMode: string,
) {
  if (!rows.length) return rows;
  const snapshotLabels = new Set(snapshotMetrics.map((metric) => normalizeDisplayLookupLabel(metric.label)));
  const snapshotText = normalizeDisplayLookupLabel(
    snapshotMetrics
      .map((metric) => `${metric.label} ${metric.value} ${metric.note || ""}`)
      .join(" "),
  );
  const seen = new Set<string>();

  return rows.filter((row) => {
    const normalizedLabel = normalizeDisplayLookupLabel(row.label);
    if (!normalizedLabel || seen.has(normalizedLabel)) return false;
    seen.add(normalizedLabel);

    if (displayMode === "ipo_amendment") {
      if (/\b(?:proposed\s+)?(?:exchange|ticker|symbol|listing venue)\b/.test(normalizedLabel)) {
        return !snapshotLabels.has("exchange ticker");
      }
      if (/\b(?:shares?|ads|units?)\s+offered\b/.test(normalizedLabel)) return false;
      if (/\bprice\s+range\b/.test(normalizedLabel)) return false;
      if (/\b(?:offering size|gross proceeds|estimated deal size)\b/.test(normalizedLabel)) return false;
      if (
        /\b(?:underwriter option|greenshoe)\b/.test(normalizedLabel) &&
        /\b(?:option|greenshoe|additional)\b/.test(snapshotText)
      ) {
        return false;
      }
    }

    if (displayMode === "rule_462b_mef") {
      if (/\b(?:additional shares|additional ads|additional offering value|rule 462|462 b limit)\b/.test(normalizedLabel)) {
        return !snapshotText.includes(normalizedLabel);
      }
    }

    return true;
  });
}

function readS1F1LabelValueRows(value: unknown): DilutionDisclosureRow[] {
  return recordArray(value)
    .map((item) => {
      const label = cleanDisclosureValue(readRowString(item, "label")).slice(0, 42);
      const valueText = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      if (!label || !isDisclosedValue(valueText)) return null;
      return { label, value: valueText, ...(note ? { note } : {}) };
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item));
}

function normalizeIpoTermsUpdateSnapshotMetric(metric: DilutionMetricItem): DilutionMetricItem | null {
  const normalized = normalizeDisplayLookupLabel(metric.label);
  if (/share|ads|unit/.test(normalized) && !/price|proceed|size|value/.test(normalized)) {
    return { ...metric, label: "Shares offered" };
  }
  if (/price|range/.test(normalized) && !/offering size|gross|proceed|value/.test(normalized)) {
    return { ...metric, label: "Price range" };
  }
  if (/offering size|gross|proceed|value|aggregate/.test(normalized)) {
    return { ...metric, label: "Offering size" };
  }
  if (/exchange|ticker|nasdaq|nyse|symbol/.test(normalized)) {
    return { ...metric, label: "Exchange / ticker" };
  }
  return null;
}

function formatInitialIpoListingValue(exchange: string, proposedTicker: string) {
  const exchangeValue = isDisclosedValue(exchange) ? exchange : "Pending";
  return isDisclosedValue(proposedTicker) ? `${exchangeValue}: ${proposedTicker}` : exchangeValue;
}

function compactInitialIpoUnderwriters(value: string) {
  const cleaned = cleanDisclosureValue(value);
  if (!isDisclosedValue(cleaned)) return "Pending";
  return cleaned
    .replace(/\b(?:joint )?book-?running managers?\b/gi, "bookrunners")
    .replace(/\b(?:lead )?underwriters?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function readLabeledDisplayValue(value: unknown, labels: string[]) {
  const wanted = new Set(labels.map(normalizeDisplayLookupLabel));
  for (const item of recordArray(value)) {
    const label = normalizeDisplayLookupLabel(readRowString(item, "label"));
    if (!wanted.has(label)) continue;
    return cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
  }
  return "";
}

function normalizeDisplayLookupLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readDisplayPayloadData(displayPayload: Record<string, unknown> | null): Record<string, unknown> {
  if (!displayPayload) return {};
  const data = readPlainRecord(displayPayload.data) || {};
  const rootData = Object.fromEntries(
    Object.entries(displayPayload).filter(([key]) => !["display_type", "data", "evidence", "notes"].includes(key)),
  );

  return {
    ...rootData,
    ...data,
  };
}

function resolveIpoStage(data: Record<string, unknown>, formType: string): IpoStageCode {
  const explicitStage = normalizeIpoStageCode(readRowString(data, "current_stage"));
  if (explicitStage) return explicitStage;

  const normalizedForm = formType.toUpperCase().replace(/\s+/g, "");
  if (normalizedForm.includes("424B4")) return "pricing";
  if (normalizedForm.includes("EFFECT")) return "effect";
  if (normalizedForm.includes("8-A")) return "listing";
  if (displayString(data, "price_range", "") !== "") return "terms_set";
  return "s1_filed";
}

function normalizeIpoStageCode(value: string): IpoStageCode | null {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!normalized) return null;
  if (normalized in IPO_STAGE_LABELS) return normalized as IpoStageCode;
  if (normalized.includes("term") || normalized.includes("range")) return "terms_set";
  if (normalized.includes("effect")) return "effect";
  if (normalized.includes("price") || normalized.includes("424b4")) return "pricing";
  if (normalized.includes("trade") || normalized.includes("listing") || normalized.includes("listed")) return "listing";
  if (normalized.includes("lock")) return "lockup";
  if (normalized.includes("s1") || normalized.includes("f1") || normalized.includes("file")) return "s1_filed";
  return null;
}

function normalizeIpoStages(data: Record<string, unknown>, currentStage: IpoStageCode): SpacStageItem[] {
  const currentIndex = IPO_STAGE_ORDER.findIndex((stage) => stage.code === currentStage);
  const rawStages = Array.isArray(data.stages) && data.stages.length ? data.stages : buildDefaultIpoStageRows(data);

  return rawStages
    .map((item, index) => {
      const record = readPlainRecord(item);
      const code = record ? normalizeIpoStageCode(readRowString(record, "code") || readRowString(record, "stage")) : null;
      const codeIndex = code ? IPO_STAGE_ORDER.findIndex((stage) => stage.code === code) : index;
      const stageIndex = codeIndex >= 0 ? codeIndex : index;
      const label = record
        ? readRowString(record, "label") || readRowString(record, "title") || (code ? IPO_STAGE_LABELS[code] : "")
        : typeof item === "string"
          ? item.trim()
          : IPO_STAGE_ORDER[index]?.label || "";
      if (!label) return null;

      return {
        label,
        date: record ? readRowString(record, "date") || readRowString(record, "window") : "",
        tone: stageIndex === currentIndex ? "current" : stageIndex < currentIndex ? "complete" : "pending",
      };
    })
    .filter((item): item is SpacStageItem => Boolean(item));
}

function buildDefaultIpoStageRows(data: Record<string, unknown>) {
  return [
    { code: "s1_filed", label: "S-1/F-1 Filed", date: readRowString(data, "s1_filed_date") || readRowString(data, "filing_date") },
    { code: "terms_set", label: "Terms / Range Set", date: readRowString(data, "terms_set_date") },
    { code: "effect", label: "SEC Effective", date: readRowString(data, "effective_date") },
    { code: "pricing", label: "Pricing / 424B4", date: readRowString(data, "expected_pricing_date") },
    { code: "listing", label: "First Trade", date: readRowString(data, "expected_listing_date") },
    { code: "lockup", label: "Lock-Up Expiry", date: readRowString(data, "lockup_expiration") },
  ];
}

function normalizeIpoSources(value: unknown, fallbackUrl: string): SpacSourceItem[] {
  const sources = recordArray(value)
    .map((source) => ({
      title: readRowString(source, "title") || readRowString(source, "label") || readRowString(source, "name") || "SEC source",
      detail: readRowString(source, "detail") || readRowString(source, "summary") || readRowString(source, "evidence") || "Source-backed IPO listing evidence",
      form: readRowString(source, "form") || readRowString(source, "type") || "SEC",
      url: readRowString(source, "url") || readRowString(source, "source_url") || fallbackUrl,
    }))
    .filter((source) => source.title);

  if (sources.length) return sources;

  return [
    {
      title: "SEC filing source",
      detail: "Original filing and source text for the IPO listing.",
      form: "SEC",
      url: fallbackUrl,
    },
  ];
}

function buildSpacTransactionStatusModel(filing: FilingEvent): SpacTransactionStatusModel | null {
  const displayPayload = readPlainRecord(filing.displayPayload);
  if (readRowString(displayPayload, "display_type") !== "spac_transaction_status") return null;

  const data = readDisplayPayloadData(displayPayload);
  if (
    !hasEnoughSpecialDisplayFields(
      data,
      [
        "deal_status",
        "spac_status",
        "target_company",
        "expected_ticker",
        "deal_value",
        "announced_date",
        "merger_agreement_date",
        "redemption_rate",
        "min_cash_condition",
        "min_cash_status",
        "closing_date",
        "ticker_change_date",
        "sponsor",
        "ipo_underwriter",
      ],
      2,
    )
  ) {
    return null;
  }

  const currentStage = resolveSpacStage(data);
  const currentStageNumber = spacStageNumber(currentStage);
  const rawStages = Array.isArray(data.stages) && data.stages.length ? data.stages : buildDefaultSpacStageRows(data);
  const stages = normalizeSpacStages(rawStages, currentStage);
  const currentStageLabel = displayString(data, "current_stage_label", SPAC_STAGE_LABELS[currentStage] || "Current SPAC status");
  const closingDate = displayString(data, "closing_date", "Not disclosed");
  const tickerChangeDate = displayString(data, "ticker_change_date", "Not disclosed");
  const minCashCondition = displayString(data, "min_cash_condition", "Not disclosed");
  const minCashStatus = displayString(data, "min_cash_status", "Not disclosed");
  const targetCompany = displayString(data, "target_company", filing.company);
  const expectedTicker = displayString(data, "expected_ticker", "Not disclosed");
  const riskFlags = displayStringArray(data.risk_flags, filing.bearishPoints);
  const watchNext = displayStringArray(data.watch_next, filing.watchNext);
  const redemptionResultDate = displayString(data, "redemption_result_date", "Not disclosed");
  const voteDate = displayString(data, "vote_date", "Not disclosed");
  const redemptionDeadline = displayString(data, "redemption_deadline", "Not disclosed");
  const sourceDate = buildSpacSourceDate(redemptionResultDate, voteDate, filing.filedAt);
  const ipoUnderwriter = displayString(data, "ipo_underwriter", "Not disclosed");

  return {
    currentStage,
    currentStageNumber,
    currentStageLabel,
    stageBadge: `Stage ${currentStageNumber}/${stages.length} · ${currentStageLabel}`,
    dealStatus: displayString(data, "deal_status", filing.filingFocus || "SPAC transaction update"),
    spacStatus: displayString(data, "spac_status", filing.filingBrief || filing.summary),
    stageSummary: displayString(data, "stage_summary", filing.filingBrief || filing.summary),
    stages,
    targetCompany,
    targetSummary: displayString(data, "target_summary", filing.summary),
    targetCompanyStory: displayString(data, "target_company_story", displayString(data, "target_summary", filing.summary)),
    expectedTicker,
    dealValue: displayString(data, "deal_value", "Not disclosed"),
    announcedDate: displayString(data, "announced_date", "Not disclosed"),
    mergerAgreementDate: displayString(data, "merger_agreement_date", "Not disclosed"),
    sponsor: displayString(data, "sponsor", "Not disclosed"),
    ipoUnderwriter,
    ipoDate: displayString(data, "ipo_date", "Not disclosed"),
    ipoYear: displayString(data, "ipo_year", ""),
    unitRightWarrantTerms: displayString(data, "unit_right_warrant_terms", "Not disclosed"),
    voteDate,
    redemptionDeadline,
    redemptionResultDate,
    redemptionRate: displayString(data, "redemption_rate", "Not disclosed"),
    trustCashBefore: displayString(data, "trust_cash_before", "Not disclosed"),
    trustCashAfter: displayString(data, "trust_cash_after", "Not disclosed"),
    redemptionPrice: displayString(data, "redemption_price", "Not disclosed"),
    publicSharesRemaining: displayString(data, "public_shares_remaining", "Not disclosed"),
    minCashCondition,
    minCashStatus,
    cashCondition: minCashStatus !== "Not disclosed" ? minCashStatus : minCashCondition,
    floatImpact: displayString(data, "float_impact", "Not disclosed"),
    closingDate,
    tickerChangeDate,
    sourceDate,
    blockingIssue: buildSpacBlockingIssue(minCashStatus, minCashCondition, riskFlags),
    nextCheck: buildSpacNextCheck(closingDate, tickerChangeDate, minCashStatus),
    riskFlags,
    watchNext,
    sources: normalizeSpacSources(data.sources, filing.sourceUrl),
    eventHistory: normalizeSpacEventHistory(data.event_history),
  };
}

function normalizeSpacStages(items: unknown[], currentStage: SpacStageCode): SpacStageItem[] {
  const currentStageIndex = spacStageNumber(currentStage) - 1;
  const stages = items
    .map((item, index) => {
      const record = readPlainRecord(item);
      const explicitCode = record ? normalizeSpacStageCode(readRowString(record, "code") || readRowString(record, "stage")) : null;
      const label = record
        ? readRowString(record, "label") || readRowString(record, "title") || readRowString(record, "name") || (explicitCode ? SPAC_STAGE_LABELS[explicitCode] : "")
        : typeof item === "string"
          ? item.trim()
          : "";
      if (!label) return null;

      const explicitTone = record ? readRowString(record, "tone") || readRowString(record, "status") : "";
      const stageIndex = explicitCode ? spacStageNumber(explicitCode) - 1 : index;
      const lowerLabel = `${label} ${explicitTone}`.toLowerCase();
      const tone: SpacStageTone =
        stageIndex === currentStageIndex
          ? "current"
          : stageIndex < currentStageIndex
            ? "complete"
            : lowerLabel.includes("cash") || lowerLabel.includes("listing") || lowerLabel.includes("condition") || lowerLabel.includes("risk")
              ? "risk"
              : "pending";

      return {
        label,
        date: record ? readRowString(record, "date") || readRowString(record, "window") : "",
        tone,
      };
    })
    .filter((item): item is SpacStageItem => Boolean(item));

  return stages.length ? stages : normalizeSpacStages(buildDefaultSpacStageRows({}), currentStage);
}

function resolveSpacStage(data: Record<string, unknown>): SpacStageCode {
  const explicitStage = normalizeSpacStageCode(readRowString(data, "current_stage"));
  if (explicitStage) return explicitStage;

  const numericStage = readOptionalNumber(data.current_stage);
  if (numericStage > 0) {
    return SPAC_STAGE_ORDER[clampSpacStage(numericStage) - 1]?.code || "target";
  }

  return inferSpacStage(data.stages);
}

function normalizeSpacStageCode(value: string): SpacStageCode | null {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!normalized) return null;
  if (normalized === "target" || normalized.includes("signed") || normalized.includes("announce")) return "target";
  if (normalized === "proxy" || normalized.includes("sec_filing") || normalized.includes("s_4") || normalized.includes("f_4")) return "proxy";
  if (normalized === "vote" || normalized.includes("shareholder") || normalized.includes("redemption_window")) return "vote";
  if (normalized === "redemption" || normalized.includes("redemption_result")) return "redemption";
  if (normalized === "cash" || normalized.includes("condition") || normalized.includes("backstop") || normalized.includes("pipe")) return "cash";
  if (normalized === "closing" || normalized.includes("ticker") || normalized.includes("close")) return "closing";
  return null;
}

function spacStageNumber(value: SpacStageCode) {
  const index = SPAC_STAGE_ORDER.findIndex((stage) => stage.code === value);
  return index >= 0 ? index + 1 : 1;
}

function buildDefaultSpacStageRows(data: Record<string, unknown>) {
  return [
    { code: "target", label: "Target / Deal Signed", date: readRowString(data, "merger_agreement_date") || readRowString(data, "announced_date") },
    { code: "proxy", label: "SEC Filing / Proxy", date: readRowString(data, "proxy_filing_date") },
    { code: "vote", label: "Vote & Redemption Window", date: readRowString(data, "vote_date") || readRowString(data, "redemption_deadline") },
    { code: "redemption", label: "Redemption Result", date: readRowString(data, "redemption_result_date") },
    { code: "cash", label: "Cash / Listing Conditions", date: readRowString(data, "min_cash_status") },
    { code: "closing", label: "Closing / Ticker Change", date: readRowString(data, "closing_date") || readRowString(data, "ticker_change_date") },
  ];
}

function buildSpacSourceDate(redemptionResultDate: string, voteDate: string, filedAt: string) {
  if (redemptionResultDate !== "Not disclosed") return redemptionResultDate;
  if (voteDate !== "Not disclosed") return voteDate;
  return filedAt || "Not disclosed";
}

function normalizeSpacSources(value: unknown, fallbackUrl: string): SpacSourceItem[] {
  const sources = recordArray(value)
    .map((source) => ({
      title: readRowString(source, "title") || readRowString(source, "label") || readRowString(source, "name") || "SEC source",
      detail: readRowString(source, "detail") || readRowString(source, "summary") || readRowString(source, "evidence") || "Source-backed filing evidence",
      form: readRowString(source, "form") || readRowString(source, "type") || "SEC",
      url: readRowString(source, "url") || readRowString(source, "source_url") || fallbackUrl,
    }))
    .filter((source) => source.title);

  if (sources.length) return sources;

  return [
    {
      title: "SEC filing source",
      detail: "Original filing and source text for the SPAC transaction status.",
      form: "SEC",
      url: fallbackUrl,
    },
  ];
}

function normalizeSpacEventHistory(value: unknown): SpacHistoryItem[] {
  return recordArray(value)
    .map((item, index) => ({
      date: readRowString(item, "date") || "Recent",
      form: readRowString(item, "form") || readRowString(item, "type") || "SEC",
      title: readRowString(item, "title") || readRowString(item, "event") || "SPAC filing update",
      source: readRowString(item, "source") || "SEC",
      status: readRowString(item, "status") || (index === 0 ? "Current" : "Filed"),
      current: index === 0 || /current/i.test(readRowString(item, "status")),
    }))
    .filter((item) => item.title);
}

function normalizeListingRiskChecks(data: Record<string, unknown>): ListingRiskCheck[] {
  const checks = recordArray(data.checks)
    .map((item) => ({
      label: readRowString(item, "label") || readRowString(item, "name") || "Listing check",
      value: readRowString(item, "value") || "Not disclosed",
      status: readRowString(item, "status") || "Unknown",
      note: readRowString(item, "note") || readRowString(item, "detail") || "No additional detail disclosed.",
    }))
    .filter((item) => item.label);

  if (checks.length) return checks;

  return [
    { label: "Bid Price", value: displayString(data, "bid_price", "Not disclosed"), status: inferListingCheckStatus(data, "bid_price"), note: "Minimum bid-price context when source-backed." },
    { label: "Stockholders' Equity", value: displayString(data, "stockholders_equity", "Not disclosed"), status: inferListingCheckStatus(data, "stockholders_equity"), note: "Equity deficiency context when disclosed." },
    { label: "MVLS / Market Value", value: displayString(data, "market_value", "Not disclosed"), status: inferListingCheckStatus(data, "market_value"), note: "Market-value listing standard context when disclosed." },
    { label: "Public Float / Holders", value: displayString(data, "public_float", "Not disclosed"), status: inferListingCheckStatus(data, "public_float"), note: "Float and holder counts when disclosed." },
    { label: "Reverse Split History", value: displayString(data, "reverse_split_history", "Not disclosed"), status: inferListingCheckStatus(data, "reverse_split_history"), note: "Reverse split status or history when disclosed." },
    { label: "Late Filing / Governance", value: displayString(data, "late_filing_governance", "Not disclosed"), status: inferListingCheckStatus(data, "late_filing_governance"), note: "Late filing or governance deficiency context when disclosed." },
  ];
}

function normalizeListingRiskTimeline(data: Record<string, unknown>, filedAt: string): ListingRiskTimelineItem[] {
  const timeline = recordArray(data.timeline)
    .map((item) => ({
      label: readRowString(item, "label") || readRowString(item, "title") || "Listing milestone",
      date: readRowString(item, "date") || readRowString(item, "value") || "Not disclosed",
      status: readRowString(item, "status") || "Pending",
    }))
    .filter((item) => item.label);

  if (timeline.length) return timeline;

  return [
    { label: "Notice Date", date: displayString(data, "notice_date", filedAt || "Not disclosed"), status: "Complete" },
    { label: "Current Point", date: displayString(data, "current_point", "Not disclosed"), status: "Current" },
    { label: "Cure Deadline", date: displayString(data, "cure_deadline", "Not disclosed"), status: "Pending" },
    { label: "Extension / Review", date: displayString(data, "extension_review_date", "Not disclosed"), status: "Unknown" },
    { label: "Hearing / Appeal Deadline", date: displayString(data, "hearing_appeal_deadline", "Not disclosed"), status: "Unknown" },
  ];
}

function normalizeEarningsMetrics(value: unknown, fallback: EarningsMetric[]): EarningsMetric[] {
  const metrics = recordArray(value)
    .map((item) => ({
      label: readRowString(item, "label") || readRowString(item, "name") || "Metric",
      value: readRowString(item, "value") || "Not disclosed",
      comparison: readRowString(item, "comparison") || readRowString(item, "change") || "No comparison disclosed",
      note: readRowString(item, "note") || readRowString(item, "detail") || "Source-backed when disclosed.",
    }))
    .filter((item) => item.label);

  return metrics.length ? metrics : fallback;
}

function normalizeEarningsSegments(value: unknown): EarningsSegment[] {
  const segments = recordArray(value)
    .map((item) => ({
      name: readRowString(item, "name") || readRowString(item, "segment") || "Segment",
      revenue: readRowString(item, "revenue") || readRowString(item, "value") || "Not disclosed",
      performance: readRowString(item, "performance") || readRowString(item, "comparison") || "No comparison disclosed",
      note: readRowString(item, "note") || readRowString(item, "detail") || "Segment commentary was not disclosed.",
    }))
    .filter((item) => item.name);

  return segments.length
    ? segments
    : [
        {
          name: "Segment detail",
          revenue: "Not disclosed",
          performance: "No segment context disclosed",
          note: "The filing payload did not include segment-level results.",
        },
      ];
}

function normalizeEarningsRiskSignals(
  value: unknown,
  data: Record<string, unknown>,
  fallback: string[],
): EarningsRiskSignal[] {
  const signals = recordArray(value)
    .map((item) => {
      const label = readRowString(item, "label") || readRowString(item, "name") || "Risk signal";
      const status = readRowString(item, "status") || readRowString(item, "value") || "Watch";
      const tone = normalizeRiskSignalTone(readRowString(item, "tone") || status);
      return {
        label,
        status,
        detail: readRowString(item, "detail") || readRowString(item, "note") || "Source-backed when disclosed.",
        tone,
      };
    })
    .filter((item) => item.label);

  if (signals.length) return signals;

  const atmMention = displayString(data, "atm_dilution_mention", "Not disclosed");
  const liquidity = displayString(data, "liquidity_issue", displayString(data, "cash_burn", "Not disclosed"));
  const debtPressure = displayString(data, "debt_pressure", "Not disclosed");

  return [
    {
      label: "Going concern",
      status: displayString(data, "going_concern", "Not disclosed"),
      detail: "Going-concern language from the filing when available.",
      tone: normalizeRiskSignalTone(displayString(data, "going_concern", "Not disclosed")),
    },
    {
      label: "Liquidity issue",
      status: liquidity,
      detail: "Cash burn, runway, or liquidity stress language.",
      tone: normalizeRiskSignalTone(liquidity),
    },
    {
      label: "ATM / dilution mention",
      status: atmMention,
      detail: "ATM, shelf, equity line, or financing disclosure.",
      tone: normalizeRiskSignalTone(atmMention),
    },
    {
      label: "Debt pressure",
      status: debtPressure,
      detail: fallback[0] || "Debt pressure not disclosed.",
      tone: normalizeRiskSignalTone(debtPressure),
    },
  ];
}

function normalizeRiskSignalTone(value: string): EarningsRiskSignal["tone"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("risk") || normalized.includes("issue") || normalized.includes("breach") || normalized.includes("active")) {
    return "risk";
  }
  if (normalized.includes("watch") || normalized.includes("not disclosed") || normalized.includes("pressure")) return "watch";
  return "clear";
}

function normalizeGuidanceTone(value: string): EarningsModel["guidanceTone"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("bull") || normalized.includes("strong") || normalized.includes("raise")) return "Bullish";
  if (normalized.includes("weak") || normalized.includes("cut") || normalized.includes("lower")) return "Weak";
  return "Neutral";
}

function inferEarningsMarginTrend(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("compress") || normalized.includes("declin") || normalized.includes("pressure")) return "Compressing";
  if (normalized.includes("improv") || normalized.includes("expand")) return "Improving";
  if (normalized.includes("stable") || normalized.includes("maintain")) return "Stable";
  return "Not disclosed";
}

function normalizeClinicalTimeline(data: Record<string, unknown>, filedAt: string): ClinicalTimelineItem[] {
  const timeline = recordArray(data.fda_timeline || data.timeline)
    .map((item) => ({
      label: readRowString(item, "label") || readRowString(item, "title") || "Clinical milestone",
      date: readRowString(item, "date") || readRowString(item, "window") || "Not disclosed",
      status: readRowString(item, "status") || "Pending",
      detail: readRowString(item, "detail") || readRowString(item, "summary") || "Source-backed milestone when disclosed.",
    }))
    .filter((item) => item.label);

  if (timeline.length) return timeline;

  return [
    {
      label: "Current filing",
      date: filedAt || "Recent",
      status: "Current",
      detail: displayString(data, "event_status", "Clinical filing update disclosed."),
    },
    {
      label: "Next milestone",
      date: displayString(data, "next_milestone", "Not disclosed"),
      status: "Watch",
      detail: displayString(data, "fda_status", "FDA status not disclosed."),
    },
  ];
}

function normalizeClinicalDataHighlights(data: Record<string, unknown>): ClinicalDataHighlight[] {
  const highlights = recordArray(data.data_highlights)
    .map((item) => ({
      label: readRowString(item, "label") || readRowString(item, "name") || "Clinical data",
      value: readRowString(item, "value") || "Not disclosed",
      note: readRowString(item, "note") || readRowString(item, "detail") || "Source-backed when disclosed.",
    }))
    .filter((item) => item.label)
    .slice(0, 4);

  if (highlights.length) return highlights;

  return [
    {
      label: "Primary endpoint",
      value: displayString(data, "primary_endpoint", "Not disclosed"),
      note: displayString(data, "data_readout", "Readout detail not disclosed."),
    },
    {
      label: "Patient population",
      value: displayString(data, "patient_population", "Not disclosed"),
      note: displayString(data, "indication", "Indication not disclosed."),
    },
    {
      label: "FDA status",
      value: displayString(data, "fda_status", "Not disclosed"),
      note: displayString(data, "next_milestone", "Next milestone not disclosed."),
    },
  ];
}

function normalizeSpecialSources(value: unknown, fallbackUrl: string, fallbackDetail: string): SpacSourceItem[] {
  const sources = recordArray(value)
    .map((source) => ({
      title: readRowString(source, "title") || readRowString(source, "label") || readRowString(source, "name") || "SEC source",
      detail: readRowString(source, "detail") || readRowString(source, "summary") || readRowString(source, "evidence") || fallbackDetail,
      form: readRowString(source, "form") || readRowString(source, "type") || "SEC",
      url: readRowString(source, "url") || readRowString(source, "source_url") || fallbackUrl,
    }))
    .filter((source) => source.title);

  if (sources.length) return sources;

  return [
    {
      title: "SEC filing source",
      detail: fallbackDetail,
      form: "SEC",
      url: fallbackUrl,
    },
  ];
}

function isNoActiveListingDeficiency(complianceStatus: string, mainRiskDriver: string, data: Record<string, unknown>) {
  const combined = `${complianceStatus} ${mainRiskDriver} ${displayString(data, "deficiency_notice", "")}`.toLowerCase();
  return (
    combined.includes("no active") ||
    combined.includes("satisfied") ||
    combined.includes("regained compliance") ||
    combined.includes("compliant")
  );
}

function inferListingCheckStatus(data: Record<string, unknown>, key: string) {
  const value = displayString(data, key, "Not disclosed").toLowerCase();
  if (value === "not disclosed") return "Unknown";
  if (value.includes("deficien") || value.includes("below") || value.includes("risk")) return "Deficient";
  if (value.includes("no issue") || value.includes("satisfied") || value.includes("compliant")) return "Satisfied";
  return "Watch";
}

function hasEnoughSpecialDisplayFields(data: Record<string, unknown>, keys: string[], minimumCount: number) {
  const presentCount = keys.reduce((count, key) => (readDisclosureValue(data[key]) ? count + 1 : count), 0);
  return presentCount >= minimumCount;
}

function displayString(data: Record<string, unknown>, key: string, fallback: string) {
  return cleanDisclosureValue(readDisclosureValue(data[key])) || fallback;
}

function readDisclosureValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item === "number" && Number.isFinite(item)) return String(item);
        const record = readPlainRecord(item);
        return record
          ? readRowString(record, "text") ||
              readRowString(record, "title") ||
              readRowString(record, "label") ||
              readRowString(record, "name") ||
              readRowString(record, "detail")
          : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function displayStringArray(value: unknown, fallback: string[]) {
  const items = Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") return item.trim();
          const record = readPlainRecord(item);
          return record
            ? readRowString(record, "text") ||
                readRowString(record, "title") ||
                readRowString(record, "label") ||
                readRowString(record, "point") ||
                readRowString(record, "detail")
            : "";
        })
        .filter(Boolean)
    : [];

  return items.length ? items : fallback.filter(Boolean);
}

function buildSpacBlockingIssue(minCashStatus: string, minCashCondition: string, riskFlags: string[]) {
  if (minCashStatus !== "Not disclosed" && minCashCondition !== "Not disclosed") {
    return `${minCashStatus} vs ${minCashCondition} minimum cash`;
  }
  if (minCashStatus !== "Not disclosed") return minCashStatus;
  if (minCashCondition !== "Not disclosed") return `Minimum cash condition: ${minCashCondition}`;
  return riskFlags[0] || "No blocking issue parsed";
}

function buildSpacNextCheck(closingDate: string, tickerChangeDate: string, minCashStatus: string) {
  if (closingDate && closingDate !== "Not disclosed") {
    return `Closing 8-K or waiver update around ${closingDate}`;
  }
  if (tickerChangeDate && tickerChangeDate !== "Not disclosed") {
    return `Ticker-change confirmation around ${tickerChangeDate}`;
  }
  if (minCashStatus && minCashStatus !== "Not disclosed") {
    return "Minimum cash waiver / PIPE / backstop update";
  }
  return "Closing 8-K / cash waiver / backstop update";
}

function inferSpacStage(items: unknown): SpacStageCode {
  const sourceItems = Array.isArray(items) ? items : [];
  const labels = sourceItems
    .map((item) => {
      const record = readPlainRecord(item);
      return record
        ? `${readRowString(record, "label")} ${readRowString(record, "title")} ${readRowString(record, "status")}`
        : typeof item === "string"
          ? item
          : "";
    })
    .join(" ")
    .toLowerCase();

  if (labels.includes("closing") || labels.includes("ticker")) return "closing";
  if (labels.includes("cash") || labels.includes("condition") || labels.includes("backstop") || labels.includes("pipe")) return "cash";
  if (labels.includes("redemption result")) return "redemption";
  if (labels.includes("vote")) return "vote";
  if (labels.includes("proxy") || labels.includes("sec filing")) return "proxy";
  return "target";
}

function clampSpacStage(value: number, maxStage: number = SPAC_DEFAULT_STAGES.length) {
  return Math.max(1, Math.min(Math.max(1, maxStage), Math.round(value || 1)));
}

function readOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalize424bOfferingDisplayMode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed = new Set([
    "atm",
    "resale_registration",
    "primary_offering",
    "registered_direct",
    "warrant_convertible",
    "rights_offering",
    "shelf_capacity",
    "spac_transaction_status",
    "mixed_offering",
    "post_effective_amendment",
    "routine_amendment",
    "generic",
  ]);
  return allowed.has(normalized) ? normalized : "";
}

function isLikelyDateDisclosure(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[$%]/.test(trimmed)) return false;
  return (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2},\s+\d{4}\b/i.test(trimmed) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(trimmed) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(trimmed)
  );
}

function buildDilutionOfferingModel(filing: FilingEvent) {
  const llmDisplayModel = readPlainRecord(filing.offeringDisplayModel);
  const displayPayloadRecord = readPlainRecord(filing.displayPayload);
  const displayPayloadData = readDisplayPayloadData(displayPayloadRecord);
  const offeringTerms = readPlainRecord(filing.offeringTerms);
  const offeringTermsMetadata = readPlainRecord(offeringTerms?.metadata);
  const s3Case = cleanDisclosureValue(filing.s3Case || "");
  const displayMode = normalize424bOfferingDisplayMode(
    readRowString(llmDisplayModel, "display_mode") ||
      readRowString(displayPayloadData, "display_mode") ||
      readRowString(displayPayloadData, "offering_ui_mode"),
  );
  const is424bS3OfferingTermsPayload =
    /^(?:424B|S-3|F-3)/i.test(filing.formType.trim()) &&
    readRowString(displayPayloadRecord, "display_type") === "offering_terms";
  const isS1F1OfferingTermsPayload =
    /^(?:S-1|F-1|EFFECT|POS AM)/i.test(filing.formType.trim()) &&
    readRowString(displayPayloadRecord, "display_type") === "offering_terms";
  const is424bOfferingTermsPayload = is424bS3OfferingTermsPayload || isS1F1OfferingTermsPayload;
  const isAuthoritative424bMode = is424bOfferingTermsPayload;
  const allowDisplayFallbacks = !is424bOfferingTermsPayload;
  const displayPayloadSearchText = JSON.stringify({
    displayPayloadData,
    llmDisplayModel,
  });
  const sourceText = stripHtml(`${filing.title} ${filing.filingBrief} ${filing.summary} ${filing.originalHtml}`);
  const fallbackSourceText = allowDisplayFallbacks ? sourceText : "";
  const dbOfferingType = formatOfferingEnumLabel(readRowString(offeringTerms, "offering_type"));
  const dbSecurityType = formatOfferingEnumLabel(readRowString(offeringTerms, "security_type"));
  const dbPrimaryOrResale = formatPrimaryResaleLabel(readRowString(offeringTerms, "primary_or_resale"));
  const rawOfferingType = readRowString(offeringTermsMetadata, "raw_offering_type");
  const offeringMethod = readRowString(offeringTermsMetadata, "offering_method");
  const classificationSourceText = allowDisplayFallbacks ? sourceText : displayPayloadSearchText;
  const classificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${classificationSourceText}`;
  const structuredClassificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${filing.title} ${filing.filingBrief}`;
  const isAtm = isAuthoritative424bMode
    ? displayMode === "atm"
    : displayMode === "atm" || (!displayMode && dbOfferingType === "ATM");
  const isMixedOffering = isAuthoritative424bMode
    ? displayMode === "mixed_offering"
    : displayMode === "mixed_offering";
  const hasActionableAtmMechanism = isActionableAtmMechanism({
    dbOfferingType,
    displayMode,
    offeringTerms,
    sourceText: fallbackSourceText,
  });
  const isShelf = isAuthoritative424bMode
    ? displayMode === "shelf_capacity"
    : /\b(?:shelf|s-3|s-3asr|registration statement)\b/i.test(classificationText);
  const isForwardSale =
    /\bforward (?:sale|basis|purchase|transaction|contract|agreement)|physical settlement\b/i.test(structuredClassificationText) ||
    /\bforward (?:sale|purchase) agreement\b/i.test(fallbackSourceText);
  const isS8Form = /^S-8(?:\/A|\s+POS)?$/i.test(filing.formType.trim());
  const s8NormalizedType =
    readRowString(displayPayloadData, "normalized_s8_type") || readRowString(displayPayloadData, "normalizedS8Type");
  const s8UiMode = readRowString(displayPayloadData, "s8_ui_mode") || readRowString(displayPayloadData, "s8UiMode");
  const hasS8ResaleFacts = Boolean(
    s8UiMode === "reoffer_resale" ||
    displayPayloadData?.reofferProspectus === true ||
      displayPayloadData?.resaleProspectus === true ||
      recordArray(displayPayloadData?.sellingSecurityholders).length
  );
  const isS8ReofferResale = isS8Form && s8UiMode === "reoffer_resale";
  const hasSellingHolderResale = isAtm
    ? false
    : isS8Form
      ? hasS8ResaleFacts
      : /\b(?:resale|selling stockholders?|selling shareholders?)\b/i.test(classificationText);
  const isResale =
    isAtm
      ? false
      : displayMode
        ? displayMode === "resale_registration"
      : isS8Form
      ? hasS8ResaleFacts
      : dbPrimaryOrResale === "Resale" ||
        /\bresale\b/i.test(dbPrimaryOrResale) ||
        dbOfferingType === "Resale registration" ||
        /\bresale\b/i.test(dbOfferingType) ||
        hasSellingHolderResale;
  const isS8PlanRegistration =
    isS8Form &&
    (s8UiMode
      ? ["plan_registration", "inducement_awards", "post_effective_amendment"].includes(s8UiMode)
      : !hasS8ResaleFacts);
  const resaleProceedsToCompany = readDisplayCashTermValue(llmDisplayModel, "resale_proceeds_to_company");
  const resaleProceedsSearchText = `${resaleProceedsToCompany} ${displayPayloadSearchText}`;
  const noIssuerProceeds =
    resaleProceedsToCompany === "$0" ||
    /\b(?:no money|no proceeds|not receive any|will not receive|would not receive|receives?\s+no)\b/i.test(resaleProceedsSearchText) ||
    /\b(?:will not|would not|do not|does not|did not|not receive any)\s+proceeds\b/i.test(fallbackSourceText) ||
    /\breceives?\s+no\s+proceeds\b/i.test(fallbackSourceText) ||
    /\bno\s+proceeds\s+from\b/i.test(fallbackSourceText);
  const isRegisteredDirect = isAuthoritative424bMode
    ? displayMode === "registered_direct"
    : displayMode ? displayMode === "registered_direct" : /\bregistered direct\b/i.test(classificationText);
  const isPrivatePlacement = isAuthoritative424bMode
    ? /\bprivate placement\b/i.test(displayPayloadSearchText)
    : /\bprivate placement\b/i.test(classificationText);
  const hasPrefundedWarrants = isAuthoritative424bMode
    ? /\bpre[-\s]?funded warrants?\b/i.test(displayPayloadSearchText)
    : /\bpre[-\s]?funded warrants?\b/i.test(classificationText);
  const hasDisplayWarrants =
    hasVisibleWarrantDisplay(llmDisplayModel) || hasVisibleWarrantDisplay(displayPayloadData);
  const hasWarrants = isAuthoritative424bMode
    ? hasDisplayWarrants
    : /\bwarrant/i.test(classificationText);
  const hasConvertibles = isAuthoritative424bMode
    ? /\b(?:convertible|conversion|debenture|note|preferred)\b/i.test(displayPayloadSearchText)
    : /\b(?:convertible|debenture|note)\b/i.test(classificationText);
  const isConvertibleFinancing =
    isAuthoritative424bMode
      ? displayMode === "warrant_convertible"
      : (displayMode === "warrant_convertible" ||
          /convertible[_\s-]?financing|convertible_warrant_financing|convertible notes?|conversion shares|convertible securities/i.test(
            structuredClassificationText
          )) &&
        !/^Shelf registration$/i.test(dbOfferingType);
  const offeringType = isS8PlanRegistration
    ? formatS8PlanOfferingType(s8NormalizedType, s8UiMode)
    : isMixedOffering
      ? "Mixed offering"
    : buildOfferingDisplayType({
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
  const securityType = dbSecurityType || findSecurityType(fallbackSourceText, { hasConvertibles, hasWarrants });
  const primaryOrResale = dbPrimaryOrResale || (isS8PlanRegistration
      ? "Plan registration"
      : isResale
      ? "Resale"
      : isMixedOffering
        ? "Mixed"
      : isAtm || isRegisteredDirect || isPrivatePlacement
        ? "Primary"
        : "Not disclosed");
  const offeringAmount = isResale ? "" : readDbMoneyValue(offeringTerms, "offering_amount", "offering_amount_text") || findMoneyAmount(fallbackSourceText);
  const isShelfLike = isAuthoritative424bMode ? displayMode === "shelf_capacity" : isShelf || /shelf/i.test(offeringType);
  const salesAgent = isResale ? "" : findSalesAgent(fallbackSourceText);
  const dbPoolBreakdown = allowDisplayFallbacks ? buildDbOfferingPoolBreakdown(offeringTerms, { isResale }) : [];
  const sourceBackedPoolBreakdown = allowDisplayFallbacks ? buildRegisteredPoolBreakdown(sourceText) : [];
  const llmPoolBreakdown = allowDisplayFallbacks ? buildLlmPoolBreakdown(llmDisplayModel, { isResale }) : [];
  const payloadPoolBreakdown = allowDisplayFallbacks ? buildLlmPoolBreakdown(displayPayloadData, { isResale }) : [];
  const poolBreakdown = payloadPoolBreakdown.length
    ? payloadPoolBreakdown
    : llmPoolBreakdown.length
      ? llmPoolBreakdown
      : dbPoolBreakdown.length
        ? dbPoolBreakdown
        : sourceBackedPoolBreakdown;
  const poolBreakdownTotal = poolBreakdown.reduce((total, item) => total + item.shareCount, 0);
  const dbPotentialSupply = allowDisplayFallbacks
    ? readDbShareValue(offeringTerms, "total_potential_share_exposure", "total_potential_share_exposure_text") ||
      readDbShareValue(offeringTerms, "resale_share_count", "resale_share_count_text") ||
      readDbShareValue(offeringTerms, "shares_offered", "shares_offered_text")
    : "";
  const llmTotalPotentialSupplyValue =
    readDisplayShareExposureValue(displayPayloadData) ||
    readDisplayShareExposureValue(llmDisplayModel);
  const llmTotalPotentialSupplyCount =
    readDisplayShareExposureNumber(displayPayloadData) ||
    readDisplayShareExposureNumber(llmDisplayModel);
  const s8RegisteredPlanShares = isS8PlanRegistration ? readS8RegisteredShareValue(displayPayloadData) : "";
  const s8ReofferResaleShares = isS8ReofferResale
    ? readS8ShareValueFromModels(displayPayloadData, llmDisplayModel, [
        "reoffer_resale_shares",
        "reofferResaleShares",
        "reoffer_shares",
        "reofferShares",
        "resale_shares",
        "resaleShares",
      ])
    : "";
  const s8ParentPlanShares = isS8ReofferResale
    ? readS8ShareValueFromModels(displayPayloadData, llmDisplayModel, [
        "parent_plan_registered_shares",
        "parentPlanRegisteredShares",
        "parent_s8_registered_shares",
        "parentS8RegisteredShares",
        "parent_registered_shares",
        "parentRegisteredShares",
        "prior_plan_registered_shares",
        "priorPlanRegisteredShares",
      ])
    : "";
  const sourceSharesOffered = allowDisplayFallbacks ? findSharesOffered(sourceText) : "";
  const s8PlanSharesOffered = isS8PlanRegistration
    ? chooseS8PlanShareValue(s8RegisteredPlanShares, "")
    : "";
  let sharesOffered = isS8PlanRegistration
    ? s8PlanSharesOffered ||
      llmTotalPotentialSupplyValue ||
      dbPotentialSupply ||
      ""
    : isS8ReofferResale && s8ParentPlanShares
      ? s8ParentPlanShares
    : llmTotalPotentialSupplyValue ||
      dbPotentialSupply ||
      sourceSharesOffered ||
      (poolBreakdownTotal ? `${poolBreakdownTotal.toLocaleString("en-US")} shares` : "");
  const dbCurrentShares = allowDisplayFallbacks
    ? readDbShareValue(offeringTerms, "current_shares_outstanding", "current_shares_outstanding_text")
    : "";
  const llmCurrentShares =
    readDisplayFlexibleValue(displayPayloadData, "current_shares_outstanding") ||
    readDisplayFlexibleValue(llmDisplayModel, "current_shares_outstanding") ||
    readDisplayFlexibleValue(displayPayloadData, "current_shares") ||
    readDisplayFlexibleValue(llmDisplayModel, "current_shares");
  const llmCurrentSharesCount =
    readDisplayFlexibleNumber(displayPayloadData, "current_shares_outstanding") ||
    readDisplayFlexibleNumber(llmDisplayModel, "current_shares_outstanding") ||
    readDisplayFlexibleNumber(displayPayloadData, "current_shares") ||
    readDisplayFactNumber(llmDisplayModel, "current_shares");
  const marketContextCurrentShares = readMetricShareValue(filing.offeringMarketContext, "shares_outstanding");
  const metricCurrentShares = allowDisplayFallbacks
    ? readMetricShareValue(filing.offeringDilutionMetrics, "current_shares_outstanding") || marketContextCurrentShares
    : "";
  const filingCurrentShares = allowDisplayFallbacks ? findCurrentSharesOutstanding(sourceText) : "";
  const currentSharesOutstanding =
    dbCurrentShares ||
    llmCurrentShares ||
    filingCurrentShares ||
    metricCurrentShares;
  const currentSharesSourceNote =
    dbCurrentShares
      ? "Outstanding share count from offering terms."
      : llmCurrentShares || filingCurrentShares
      ? "Outstanding share count in the filing."
      : metricCurrentShares
        ? "Latest available market context."
        : "Outstanding share count not disclosed.";
  const marketContextPublicFloat = readMetricShareValue(filing.offeringMarketContext, "public_float");
  const publicFloat = allowDisplayFallbacks
    ? readDbShareValue(offeringTerms, "public_float", "public_float_text") ||
      findPublicFloat(sourceText) ||
      marketContextPublicFloat
    : marketContextPublicFloat;
  const authorizedShares = allowDisplayFallbacks
    ? readDbShareValue(offeringTerms, "authorized_shares", "authorized_shares_text") || findAuthorizedShares(sourceText)
    : "";
  const offeringPrice = isResale
    ? ""
    : readDisplayOfferingPrice(displayPayloadData) || readDisplayOfferingPrice(llmDisplayModel);
  const estimatedSupplyFromAmountAndPrice = allowDisplayFallbacks && !parseShareCount(sharesOffered)
    ? estimateShareCountFromAmountAndPrice(offeringAmount, offeringPrice)
    : 0;
  const supplyCountEstimated = Boolean(estimatedSupplyFromAmountAndPrice);
  if (supplyCountEstimated) {
    sharesOffered = `${Math.round(estimatedSupplyFromAmountAndPrice).toLocaleString("en-US")} shares`;
  }
  const hasS8PlanContext = Boolean(
    recordArray(displayPayloadData?.planNames).length ||
      recordArray(displayPayloadData?.planNameFacts).length ||
      /\b(?:RSU|restricted stock units?|option scheme|share option|equity incentive|stock plan|award plan|incentive plan)\b/i.test(
        sourceText,
      ),
  );
  const hasMinimumS8DetailFields = Boolean(
    isS8Form &&
      (s8UiMode === "reoffer_resale"
        ? hasS8ResaleFacts && (isDisclosedValue(sharesOffered) || recordArray(displayPayloadData?.sellingSecurityholders).length > 0)
        : s8UiMode === "post_effective_amendment"
          ? isDisclosedValue(sharesOffered) ||
            /\b(?:post-effective|no additional securities|deregister|deregistration|unsold securities|carryover|carry over|replacement plan)\b/i.test(
              sourceText,
            )
          : s8UiMode === "inducement_awards"
            ? isDisclosedValue(sharesOffered) || /\binducement\b/i.test(sourceText)
            : isS8PlanRegistration && (isDisclosedValue(sharesOffered) || hasS8PlanContext)),
  );
  const calculatedDisplayDilutionPercent = estimateDilutionPercent(sharesOffered, currentSharesOutstanding);
  const llmEstimatedDilutionPercent =
    readDisplayPercentValue(displayPayloadData, "estimated_dilution_percent") ||
    readDisplayPercentValue(llmDisplayModel, "estimated_dilution_percent");
  let estimatedDilutionPercent = isS8ReofferResale && s8ParentPlanShares && calculatedDisplayDilutionPercent
    ? calculatedDisplayDilutionPercent
    : allowDisplayFallbacks
    ? llmEstimatedDilutionPercent ||
      readDbPercentValue(offeringTerms, "total_potential_dilution_percent") ||
      readDbPercentValue(offeringTerms, "estimated_dilution_percent") ||
      calculatedDisplayDilutionPercent
    : isDisclosedValue(calculatedDisplayDilutionPercent)
      ? calculatedDisplayDilutionPercent
      : llmEstimatedDilutionPercent || readSnapshotRatioStatusValue(displayPayloadData, llmDisplayModel);
  const discountToMarket = findDiscountToMarket(fallbackSourceText);
  const warrantCoverage = summarizeWarrantCoverage(fallbackSourceText, {
    hasConvertibles,
    hasWarrants,
    sharesOffered,
  });
  const warrantExercisePrice = readDisplayInstrumentPriceByType(displayPayloadData, /warrant/i) || readDisplayInstrumentPriceByType(llmDisplayModel, /warrant/i);
  const conversionPrice =
    readDisplayInstrumentPriceByType(displayPayloadData, /convertible|conversion|note|preferred/i) ||
    readDisplayInstrumentPriceByType(llmDisplayModel, /convertible|conversion|note|preferred/i);
  const displayInstrumentPriceGroups = readDisplayInstrumentPriceGroups(displayPayloadData);
  const llmInstrumentPriceGroups = readDisplayInstrumentPriceGroups(llmDisplayModel);
  const instrumentPriceGroups = displayInstrumentPriceGroups.length ? displayInstrumentPriceGroups : llmInstrumentPriceGroups;
  const displayInstrumentPriceSummary =
    readDisplayInstrumentPriceSummary(displayPayloadData) || readDisplayInstrumentPriceSummary(llmDisplayModel);
  const useOfProceeds = isResale || noIssuerProceeds ? "" : findSentence(fallbackSourceText, /\buse of proceeds\b|\bnet proceeds\b|\bgeneral corporate purposes\b|\bworking capital\b/i);
  const prefundedWarrantExerciseCash =
    readDisplayCashTermValue(displayPayloadData, "prefunded_warrant_exercise_cash") ||
    readDisplayCashTermValue(llmDisplayModel, "prefunded_warrant_exercise_cash");
  const warrantCashExerciseProceeds =
    readDisplayCashTermValue(displayPayloadData, "common_warrant_cash_exercise_proceeds") ||
    readDisplayCashTermValue(displayPayloadData, "conditional_warrant_cash") ||
    readDisplayCashTermValue(llmDisplayModel, "common_warrant_cash_exercise_proceeds") ||
    readDisplayCashTermValue(llmDisplayModel, "conditional_warrant_cash");
  const atmFeeCommission = isAtm ? findAtmFeeCommission(fallbackSourceText) : "";
  const atmAgreementDate = isAtm ? findAtmAgreementDate(fallbackSourceText) : "";
  const atmEndDate = isAtm && allowDisplayFallbacks ? findAtmEndDate(fallbackSourceText) || "No fixed end date disclosed" : "";
  const hasConditionalWarrantCash = isDisclosedValue(warrantCashExerciseProceeds);
  const firstNotePrincipal = findNotePrincipal(fallbackSourceText, "First");
  const secondNotePrincipal = findNotePrincipal(fallbackSourceText, "Second");
  const pipePrincipalValue = formatMoneyTotal([firstNotePrincipal, secondNotePrincipal]) || "Not disclosed";
  const firstClosingNetProceeds = findClosingNetProceeds(fallbackSourceText, "First");
  const secondClosingNetProceeds = findClosingNetProceeds(fallbackSourceText, "Second");
  const issuerPrimaryOrClosingCash = cleanCompanyCashDisclosure(
    readDisplayCashTermValue(displayPayloadData, "issuer_primary_or_closing_cash") ||
      readDisplayCashTermValue(llmDisplayModel, "issuer_primary_or_closing_cash"),
  );
  const isEquityLineResale =
    isResale &&
    /\b(?:ELOC|equity line|committed equity facility|standby purchase agreement|common stock purchase agreement|purchase agreement)\b/i.test(
      classificationSourceText,
    );
  const resaleCompanyProceedsValue =
    isEquityLineResale && isDisclosedValue(issuerPrimaryOrClosingCash)
      ? formatResaleCompanyProceedsValue(issuerPrimaryOrClosingCash)
      : "No money goes to the company";
  const resaleCompanyProceedsNote =
    isEquityLineResale && isDisclosedValue(issuerPrimaryOrClosingCash)
      ? "Separate from resale proceeds."
      : hasConditionalWarrantCash
        ? `Warrant cash is separate and only if exercised: ${warrantCashExerciseProceeds}.`
        : "No resale proceeds to company.";
  const closingNetProceedsValue =
    issuerPrimaryOrClosingCash ||
    formatMoneyTotal([firstClosingNetProceeds, secondClosingNetProceeds], "~") ||
    "Not disclosed";
  const additionalNotesAmount = findAdditionalNotesAmount(fallbackSourceText);
  const additionalWarrantShares = findAdditionalWarrantShares(fallbackSourceText);
  const effectiveDate = findDateSentence(fallbackSourceText, /\beffective\b/i);
  const closingDate = findDateSentence(fallbackSourceText, /\bclosing\b|\bclose\b/i);
  const offeringAgreementDate = findOfferingAgreementDate(fallbackSourceText);
  const purchaserInvestor = findPurchaserInvestor(fallbackSourceText);
  const isShelfOnly = displayMode === "shelf_capacity";
  const hasActionableDilutionMechanism = Boolean(
    isMixedOffering ||
      hasActionableAtmMechanism ||
      isResale ||
      isForwardSale ||
      isRegisteredDirect ||
      hasPrefundedWarrants ||
      isConvertibleFinancing
  );
  const isCommonWarrantOnly = isAuthoritative424bMode
    ? false
    : hasWarrants &&
      !hasActionableDilutionMechanism &&
      (dbSecurityType === "Warrants" ||
        dbOfferingType === "Warrant exercise" ||
        /\b(?:warrant indenture|warrant agreement|warrant amendment|warrant expiration|warrants? expire|warrant redemption|warrant holder)\b/i.test(
          classificationText
        ));
  const llmTotalSupplyValue = llmTotalPotentialSupplyValue;
  const shelfCapacityValue =
    normalizePositiveShelfMoney(readDbMoneyValue(offeringTerms, "shelf_capacity", "shelf_capacity_text")) ||
    normalizePositiveShelfMoney(isMoneyDisclosure(llmTotalSupplyValue) ? llmTotalSupplyValue : "") ||
    normalizePositiveShelfMoney(offeringAmount) ||
    normalizePositiveShelfMoney(findShelfCapacity(fallbackSourceText)) ||
    "Not disclosed";
  const shelfRegisteredSharesValue =
    (isShareDisclosure(llmTotalSupplyValue) ? formatShareCountValue(llmTotalSupplyValue) || llmTotalSupplyValue : "") ||
    (isShareDisclosure(sharesOffered) ? formatShareCountValue(sharesOffered) || sharesOffered : "") ||
    "Not disclosed";
  const shelfStatus =
    s3Case === "automatic_shelf" || /\bautomatic shelf|Rule 462\(e\)|effective upon filing\b/i.test(fallbackSourceText)
      ? "Automatic shelf"
      : /\bnot complete|may not be sold until|not be sold until|preliminary prospectus|subject to completion\b/i.test(fallbackSourceText)
        ? "Filed; effectiveness pending"
        : "Filed shelf";
  const shelfSecuritiesCovered =
    securityType && securityType !== "Not disclosed"
      ? securityType
      : findShelfSecuritiesCovered(fallbackSourceText) || "Registered securities";
  const shelfDisplayMode = "Shelf Registration";
  const shelfIntro =
    isDisclosedValue(shelfCapacityValue)
      ? `${filing.company} registered future financing capacity of ${shelfCapacityValue}.`
      : `${filing.company} filed a shelf registration for possible future securities sales.`;
  const shelfCapacityNote =
    isDisclosedValue(shelfCapacityValue)
      ? "Future issuance capacity, not current proceeds."
      : "Dollar capacity was not cleanly disclosed.";
  const shelfShareNote =
    isDisclosedValue(shelfRegisteredSharesValue)
      ? "Registered share capacity, not shares already sold."
      : "No source-backed share count for overhang calculation.";
  const shelfCompanyProceeds = isDisclosedValue(shelfCapacityValue) ? "Future sales only" : "Not disclosed";
  const shelfCompanyProceedsNote = "Company receives cash only if securities are later sold.";
  const shelfSummaryParagraphs = buildShelfSummaryParagraphs({
    company: filing.company,
    shelfCapacityValue,
    shelfRegisteredSharesValue,
    shelfSecuritiesCovered,
    shelfStatus,
    summaryNarrative: filing.summary,
  });
  const shelfCurrentStateRows = [
    `Capacity: ${shelfCapacityValue}.`,
    `Securities covered: ${shelfSecuritiesCovered}.`,
    isDisclosedValue(shelfRegisteredSharesValue)
      ? `Registered shares: ${shelfRegisteredSharesValue}.`
      : "Registered share count is not disclosed, so share overhang is not calculated.",
    "No current offering price, closing date, or issued share count is established by the shelf alone.",
  ];
  const shelfDetailRows: DilutionDisclosureRow[] = [
    {
      label: "Shelf Capacity",
      value: shelfCapacityValue,
      note: "Maximum future offering capacity stated in this filing.",
    },
    {
      label: "Active Sale Terms",
      value: "None in this filing",
      note: "No price, share count, underwriter, or closing is set yet.",
    },
    {
      label: "Use of Proceeds",
      value: useOfProceeds || "To be described in future supplements",
      note: "No immediate proceeds from the shelf alone.",
    },
    {
      label: "Securities Covered",
      value: shelfSecuritiesCovered,
      note: "Types of securities the shelf may cover.",
    },
  ];
  const shelfWatchRows = [
    "Prospectus supplement or takedown with price, shares, investors, underwriters, or sale method.",
    "ATM, registered direct, resale, warrant, or debt terms that convert shelf capacity into an actual sale.",
    "Updated share count, market cap, and proceeds after any sale, conversion, or warrant exercise.",
  ];
  const scoreBand =
    formatDisplayRiskLabel(readRowString(offeringTerms, "overhang_level")) ||
    formatDisplayRiskLabel(readRowString(llmDisplayModel, "risk_label")) ||
    (filing.score >= 90 ? "Severe" : filing.score >= 75 ? "High" : filing.score >= 55 ? "Moderate" : "Low");
  const llmWatchItems = readDisplayStringArray(llmDisplayModel, "watch_items");
  const nextTrigger = llmWatchItems[0] || filing.watchNext[0] || "Watch for pricing, closing, or amended prospectus details.";
  const llmWarrantInstrumentRows = readWarrantInstrumentRows(llmDisplayModel);
  const payloadWarrantInstrumentRows = readWarrantInstrumentRows(displayPayloadData);
  const warrantInstrumentRows = payloadWarrantInstrumentRows.length ? payloadWarrantInstrumentRows : llmWarrantInstrumentRows;
  const llmWarrantDetailsRows = readWarrantDetailsRows(llmDisplayModel);
  const payloadWarrantDetailsRows = readWarrantDetailsRows(displayPayloadData);
  const warrantDetailsRows = warrantInstrumentRows.length
    ? []
    : payloadWarrantDetailsRows.length
      ? payloadWarrantDetailsRows
      : llmWarrantDetailsRows;
  const payloadOfferingDetailsRows = readOfferingDetailsRows(displayPayloadData);
  const llmOfferingDetailsRows = readOfferingDetailsRows(llmDisplayModel);
  const offeringDetailsRows = payloadOfferingDetailsRows.length ? payloadOfferingDetailsRows : llmOfferingDetailsRows;
  const llmShareOverhang = readLlmShareOverhang(displayPayloadData, llmDisplayModel);
  const s3AmendmentChangeRows = /^(?:S-3|F-3)\/A$/i.test(filing.formType.trim())
    ? readS3AmendmentChangeRows(displayPayloadData, llmDisplayModel)
    : [];
  const s8ContextDetailRows = isS8ReofferResale
    ? readS8ContextDetailRows(displayPayloadData, llmDisplayModel)
    : [];
  const resaleSellingHolderValue =
    offeringDetailsRows.find((row) => row.label === "Selling Holders")?.value || "Named holders / investors";
  const useCalculatedMixedOffering = isMixedOffering && !is424bOfferingTermsPayload;
  const mixedOfferingComponents = useCalculatedMixedOffering ? readMixedOfferingComponents(displayPayloadData, llmDisplayModel) : [];
  const mixedOfferingCurrentSaleComponent = findMixedOfferingShareComponent(mixedOfferingComponents, [
    "new_shares",
    "current_sale_share_equivalents",
    "current_sale",
  ]);
  const mixedOfferingInstrumentComponent = findMixedOfferingShareComponent(mixedOfferingComponents, [
    "potential_warrants",
    "potential_instruments",
    "additional_potential_supply",
  ]);
  const mixedOfferingTotalComponent = findMixedOfferingShareComponent(mixedOfferingComponents, [
    "total_potential_supply",
    "total_potential_dilution",
    "total_supply",
  ]);
  const hasLlmMixedComponents = mixedOfferingComponents.length > 0;
  const mixedOfferingCurrentSaleCount = useCalculatedMixedOffering
    ? sumMixedOfferingComponentShares(mixedOfferingComponents, [
        "new_shares",
        "current_sale_share_equivalents",
        "current_sale",
      ]) ||
      (!hasLlmMixedComponents ? sumMixedOfferingCurrentSaleShares(poolBreakdown) : 0)
    : 0;
  const mixedOfferingInstrumentSegmentCount = useCalculatedMixedOffering
    ? sumMixedOfferingComponentShares(mixedOfferingComponents, [
        "potential_warrants",
        "potential_instruments",
        "additional_potential_supply",
      ]) ||
      (!hasLlmMixedComponents ? sumMixedOfferingInstrumentShares(poolBreakdown) : 0)
    : 0;
  const mixedOfferingInstrumentCount = mixedOfferingInstrumentSegmentCount;
  const mixedOfferingReconciledPotentialCount = useCalculatedMixedOffering
    ? mixedOfferingShareCount(mixedOfferingTotalComponent) || mixedOfferingCurrentSaleCount + mixedOfferingInstrumentCount
    : 0;
  const offeredCount = useCalculatedMixedOffering
    ? mixedOfferingReconciledPotentialCount || llmTotalPotentialSupplyCount || 0
    : is424bOfferingTermsPayload
      ? llmTotalPotentialSupplyCount || parseShareCount(sharesOffered) || 0
    : Math.max(
        llmTotalPotentialSupplyCount || 0,
        parseShareCount(sharesOffered) || 0,
        poolBreakdownTotal || 0,
      );
  const currentCount = llmCurrentSharesCount || parseShareCount(currentSharesOutstanding);
  if (!allowDisplayFallbacks && currentCount && offeredCount) {
    estimatedDilutionPercent = formatDilutionPercentFromCounts(offeredCount, currentCount) || estimatedDilutionPercent;
  }
  if (useCalculatedMixedOffering && currentCount && mixedOfferingReconciledPotentialCount) {
    estimatedDilutionPercent =
      formatDilutionPercentFromCounts(mixedOfferingReconciledPotentialCount, currentCount) || estimatedDilutionPercent;
  }
  const currentSharesValue = formatShareCountValue(currentSharesOutstanding) || "Not disclosed";
  const currentShareBasisLabel = buildCurrentShareBasisLabel(displayPayloadData, llmDisplayModel);
  const currentShareDetailLabel = buildCurrentShareDetailLabel(currentShareBasisLabel);
  const currentShareComparisonLabel = currentShareBasisLabel === "Current shares" ? "current shares" : currentShareBasisLabel;
  const potentialSupplyValue =
    formatShareCountNumber(offeredCount) ||
    formatShareCountValue(sharesOffered) ||
    readSnapshotFactStatusValue(displayPayloadData, llmDisplayModel, "total_potential_supply", "Not stated");
  const dilutionRatioValue = formatDilutionRatio(estimatedDilutionPercent);
  const dilutionRatioSnapshotValue = isDisclosedValue(dilutionRatioValue)
    ? `${dilutionRatioValue} of current shares`
    : readSnapshotRatioStatusValue(displayPayloadData, llmDisplayModel);
  const dilutionRatioUnavailableNote =
    dilutionRatioSnapshotValue === "Variable"
      ? "Dilution varies with final share count or conversion price."
      : "Not fixed until source-backed share count is available.";
  const canRenderOverhangChart = Boolean(currentCount && offeredCount);
  const displayOverhangLevel = canRenderOverhangChart ? scoreBand : dilutionRatioSnapshotValue;
  const displayLabels = buildOfferingDisplayLabels({
    hasPrefundedWarrants,
    isConvertibleFinancing,
    isForwardSale,
    isRegisteredDirect,
    isResale,
    isS8PlanRegistration,
    isS8ReofferResale,
    isShelfLike: isShelf || /shelf/i.test(offeringType),
    s8UiMode,
    hasS8ParentPlanContext: Boolean(s8ParentPlanShares),
    supplyCountEstimated,
  });
  const overhangShareRead = isDisclosedValue(dilutionRatioValue) ? `${dilutionRatioValue} of current shares` : "";
  const companyProceeds = buildCompanyProceedsValue({
    closingNetProceedsValue,
    isAtm,
    isResale,
    offeringAmount,
    useOfProceeds,
  });
  const atmProgramSize =
    readDisplayCashTermValue(displayPayloadData, "atm_program_size") ||
    readDisplayCashTermValue(llmDisplayModel, "atm_program_size") ||
    (isAtm ? findAtmProgramSize(fallbackSourceText) : "") ||
    readDbMoneyValue(offeringTerms, "atm_program_size", "atm_program_size_text") ||
    (isAtm ? cleanCompanyCashDisclosure(offeringAmount) : "");
  const atmProgramAmount = parseMoneyValue(atmProgramSize);
  const marketCapAmount = readMarketCapAmount(filing.offeringMarketContext);
  const marketCapValue = marketCapAmount ? formatMoneyValue(marketCapAmount) : "Market cap unavailable";
  const atmSizeVsMarketCapValue =
    atmProgramAmount && marketCapAmount ? `${formatPercentCompact((atmProgramAmount / marketCapAmount) * 100)} of market cap` : "Not calculated";
  const isPricedPrimaryOrRegisteredDirect =
    !isAtm &&
    !isResale &&
    !isMixedOffering &&
    (displayMode === "primary_offering" ||
      displayMode === "registered_direct" ||
      isRegisteredDirect ||
      (!displayMode &&
        /\b(?:priced|fixed price|offering price|purchase price|registered direct|firm commitment|underwritten)\b/i.test(
          classificationText,
        )));
  const pricedOfferingCash = isDisclosedValue(closingNetProceedsValue)
    ? closingNetProceedsValue
    : isDisclosedValue(offeringAmount)
      ? offeringAmount
      : "Not disclosed";
  const instrumentPriceSummary = displayInstrumentPriceSummary;
  const instrumentPriceMetric = buildSnapshotInstrumentPriceMetric({
    fallbackValue: instrumentPriceSummary,
    hasConvertibles,
    hasWarrants,
    priceGroups: instrumentPriceGroups,
  });
  const warrantInstrumentContext = warrantInstrumentRows
    .map((row) =>
      [row.type, row.sharesSecurities, row.exerciseConversionPrice, row.resetFloor, row.termLimits]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  const variableConversionContext = [instrumentPriceSummary, conversionPrice, warrantInstrumentContext].join(" ");
  const resetFloorContext = warrantInstrumentRows.map((row) => row.resetFloor).filter(Boolean).join(" ");
  const hasVariableConversionFormula =
    isConvertibleFinancing &&
    /\b(?:vwap|variable|formula|floating|reset|refix|market price|average trading price|average vwap|% of)\b/i.test(
      variableConversionContext,
    );
  const hasExplicitFloorPrice =
    /\b(?:floor price|minimum conversion price|minimum price|not less than|exchange-rule price floor)\b/i.test(resetFloorContext) &&
    /\$[\d,.]+|\d+(?:\.\d+)?%/i.test(resetFloorContext);
  const isNoFloorVariableConvertibleExposure = Boolean(hasVariableConversionFormula && !hasExplicitFloorPrice && !offeredCount);
  const conversionPriceAmount = parseMoneyValue(conversionPrice);
  const warrantExercisePriceAmount = parseMoneyValue(warrantExercisePrice);
  const totalConversionSharesCount = sumPoolBreakdownShares(poolBreakdown, /\bnotes conversion\b/i);
  const totalWarrantSharesCount = sumPoolBreakdownShares(poolBreakdown, /\bwarrants?\b/i);
  const conversionSharesValue = formatShareCountNumber(totalConversionSharesCount) || "Not disclosed";
  const warrantSharesValue = formatShareCountNumber(totalWarrantSharesCount) || "Not disclosed";
  const currentSharesCompact = formatCompactShareCount(currentCount) || "Not disclosed";
  const potentialSupplyCompact = formatCompactShareCount(offeredCount) || potentialSupplyValue;
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
  const supplyComponentSegments = poolBreakdown.map((item, index) => ({
    key: `supply-component-${index}`,
    className: overhangSegmentClassName(item.label),
    label: formatOverhangComponentLabel(item.label, { isResale }),
    value: formatCompactShareCount(item.shareCount) || item.shares,
    note: buildSupplyComponentSegmentNote(item, currentCount, instrumentPriceGroups, currentShareComparisonLabel),
    width: scaleShareAmount(item.shareCount, additiveScaleBaseShares),
    compact: scaleShareAmount(item.shareCount, additiveScaleBaseShares) < 24,
  }));
  const mixedOfferingInstrumentLabel =
    cleanDisclosureValue(mixedOfferingInstrumentComponent?.label || "") ||
    (poolBreakdown.some((item) => /\bwarrants?\b/i.test(item.label)) ? "Potential warrants" : "Potential instruments");
  const overhangBarSegmentCandidates: Array<ShareOverhangBarSegment | null> = [
    currentCount
      ? {
          key: "current-base",
          className: "current-base",
          label: currentShareBasisLabel,
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
          note: `${dilutionRatioValue} of ${currentShareComparisonLabel}`,
          width: supplyBarWidth,
          compact: supplyBarWidth < 24,
      }
      : null,
  ];
  let overhangBarSegments = overhangBarSegmentCandidates.filter(
    (segment): segment is ShareOverhangBarSegment => Boolean(segment && segment.width > 0)
  );
  if (useCalculatedMixedOffering && currentCount && mixedOfferingReconciledPotentialCount) {
    const mixedScaleBase = currentCount + mixedOfferingReconciledPotentialCount;
    const mixedNewSharesNote = currentCount
      ? formatPercentCompact((mixedOfferingCurrentSaleCount / currentCount) * 100) || "Not disclosed"
      : null;
    const mixedInstrumentNote = currentCount
      ? formatPercentCompact((mixedOfferingInstrumentCount / currentCount) * 100) || "Not disclosed"
      : null;
    const mixedOverhangBarSegmentCandidates: Array<ShareOverhangBarSegment | null> = [
      {
        key: "current-base",
        className: "current-base",
        label: currentShareBasisLabel,
        value: currentSharesCompact,
        width: scaleShareAmount(currentCount, mixedScaleBase),
        compact: scaleShareAmount(currentCount, mixedScaleBase) < 24,
      },
      mixedOfferingCurrentSaleCount
        ? {
            key: "mixed-new-shares",
            className: "registered-supply",
            label: "New shares",
            value: formatCompactShareCount(mixedOfferingCurrentSaleCount) || `${mixedOfferingCurrentSaleCount.toLocaleString("en-US")} shares`,
            ...(mixedNewSharesNote ? { note: `${mixedNewSharesNote} of current shares` } : {}),
            width: scaleShareAmount(mixedOfferingCurrentSaleCount, mixedScaleBase),
            compact: scaleShareAmount(mixedOfferingCurrentSaleCount, mixedScaleBase) < 24,
          }
        : null,
      mixedOfferingInstrumentCount
        ? {
            key: "mixed-instruments",
            className: "warrant",
            label: mixedOfferingInstrumentLabel,
            value: formatCompactShareCount(mixedOfferingInstrumentCount) || `${mixedOfferingInstrumentCount.toLocaleString("en-US")} shares`,
            ...(mixedInstrumentNote ? { note: `${mixedInstrumentNote} of current shares` } : {}),
            width: scaleShareAmount(mixedOfferingInstrumentCount, mixedScaleBase),
            compact: scaleShareAmount(mixedOfferingInstrumentCount, mixedScaleBase) < 24,
          }
        : null,
    ];
    overhangBarSegments = mixedOverhangBarSegmentCandidates.filter(
      (segment): segment is ShareOverhangBarSegment => Boolean(segment && segment.width > 0)
    );
  }
  const conversionBasisValue =
    !is424bOfferingTermsPayload && totalConversionSharesCount && conversionPriceAmount
      ? formatMoneyValue(totalConversionSharesCount * conversionPriceAmount, "~")
      : "Not disclosed";
  const conversionSegmentLabel = isDisclosedValue(pipePrincipalValue) ? "Convertible Notes" : "Convertibles";
  const conversionBreakdownLabel = isDisclosedValue(pipePrincipalValue) ? "Convertible Notes" : "Convertibles";
  const warrantSegmentLabel = "Warrants";
  const warrantExerciseTotalValue =
    warrantCashExerciseProceeds ||
    (!is424bOfferingTermsPayload && totalWarrantSharesCount && warrantExercisePriceAmount
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
    isS8PlanRegistration,
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
  const investorTakeaway = readRowString(llmDisplayModel, "investor_takeaway");
  const poolMixValue = formatPoolMixValue({
    conversionSharesValue,
    pipePrincipalValue,
    warrantSharesValue,
  });
  const llmNarrativeSummary = filing.summary;
  const summaryNarrative = llmNarrativeSummary;
  const summaryParagraphs = [llmNarrativeSummary].filter(isDisclosedValue);
  const llmSnapshotMetrics = readSnapshotMetrics(displayPayloadData);
  const postEffectiveText = `${displayPayloadSearchText} ${filing.title} ${filing.summary} ${summaryNarrative}`;
  const isPostEffectiveAmendment = displayMode === "post_effective_amendment";
  const isRoutineAmendment = displayMode === "routine_amendment";
  const isAmendmentSummaryMode = isPostEffectiveAmendment || isRoutineAmendment;
  const isDeregistrationPostEffective =
    isPostEffectiveAmendment &&
    /\b(?:deregister|deregistration|unsold securities?|removed from registration|no securities will remain|no longer being offered)\b/i.test(
      postEffectiveText,
    );
  const isRoutinePostEffectiveUpdate =
    isRoutineAmendment ||
    (isPostEffectiveAmendment &&
      !isDeregistrationPostEffective &&
      /\b(?:no additional securities|updated financial|financial statements?|financials|quarter|nine months|consent|exhibit|fee table|legal opinion)\b/i.test(
        postEffectiveText,
      ));
  const mixedOfferingNewSharesValue =
    formatMixedOfferingComponentValue(mixedOfferingCurrentSaleComponent) ||
    formatShareCountNumber(mixedOfferingCurrentSaleCount) ||
    readSnapshotFactStatusValue(displayPayloadData, llmDisplayModel, "total_potential_supply", "Not stated");
  const mixedOfferingInstrumentValue =
    formatMixedOfferingComponentValue(mixedOfferingInstrumentComponent) ||
    formatShareCountNumber(mixedOfferingInstrumentCount) ||
    (hasDisplayWarrants ? warrantSharesValue : "") ||
    "Not stated";
  const s8FallbackMetricItems = isS8Form
    ? buildS8SnapshotMetricItems({
        currentSharesNote: currentSharesSourceNote,
        currentSharesValue,
        dilutionRatioValue,
        displayLabels,
        displayPayloadData,
        llmDisplayModel,
        parentPlanSharesValue: s8ParentPlanShares,
        potentialSupplyValue,
        reofferResaleSharesValue: s8ReofferResaleShares,
        s8UiMode,
      })
    : [];
  const impactMetricItems: Array<DilutionMetricItem | null> = [
    ...(isS8Form
      ? s8FallbackMetricItems
      : isShelfOnly
      ? [
          {
            label: "Shelf Capacity",
            value: shelfCapacityValue,
            note: "Maximum future offering capacity stated in this filing.",
            emphasis: true,
            tone: "neutral",
          } as DilutionMetricItem,
          {
            label: "Active Sale Terms",
            value: "None in this filing",
            note: "No price, share count, or closing is set yet.",
            tone: "neutral",
          } as DilutionMetricItem,
          {
            label: "Use of Proceeds",
            value: useOfProceeds || "To be described in future supplements",
            note: "No immediate proceeds from the shelf alone.",
            tone: "neutral",
          } as DilutionMetricItem,
          {
            label: "Securities Covered",
            value: shelfSecuritiesCovered,
            note: "Future securities covered by the shelf.",
            tone: "neutral",
          } as DilutionMetricItem,
        ]
      : isAtm
      ? [
          {
            label: "Program size",
            value: atmProgramSize || "Not disclosed",
            note: "Maximum gross sale capacity stated in the filing.",
            emphasis: true,
            tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
          } as DilutionMetricItem,
          {
            label: "Market cap",
            value: marketCapValue,
            note: marketCapAmount ? "Latest available market context." : "Market cap was not available for this filing.",
            tone: "neutral",
          } as DilutionMetricItem,
          {
            label: "Size vs market cap",
            value: atmSizeVsMarketCapValue,
            note: atmProgramAmount && marketCapAmount ? "ATM program size compared with company value." : "Calculated only when market cap is available.",
            tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
          } as DilutionMetricItem,
          {
            label: "Sale method",
            value: "At-the-market sales over time",
            note: "Shares may be sold gradually at market prices.",
            tone: "neutral",
          } as DilutionMetricItem,
        ]
      : isMixedOffering
        ? [
            {
              label: "Company proceeds",
              value: pricedOfferingCash,
              note: "Cash to the company from this offering.",
              emphasis: true,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
            {
              label: "New shares",
              value: mixedOfferingNewSharesValue,
              note: "Common stock or share-equivalent securities sold now.",
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
            {
              label: "Offer price",
              value: offeringPrice || "Multiple prices",
              note: "Representative sale price when disclosed.",
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: mixedOfferingInstrumentLabel,
              value: mixedOfferingInstrumentValue,
              note: "Warrant or convertible shares, if exercised or converted.",
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
          ]
      : isPricedPrimaryOrRegisteredDirect
        ? [
            {
              label: "New shares",
              value: potentialSupplyValue,
              note: "Shares added by this offering.",
              emphasis: true,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
            {
              label: "Offer price",
              value: offeringPrice || "Not stated",
              note: "Price per share in this deal.",
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Company proceeds",
              value: pricedOfferingCash,
              note: "Cash to the company from this offering.",
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Dilution vs current shares",
              value: dilutionRatioSnapshotValue,
              note:
                currentSharesOutstanding && isDisclosedValue(dilutionRatioValue)
                  ? "Estimated dilution from this sale."
                  : dilutionRatioUnavailableNote,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
          ]
      : isConvertibleFinancing
        ? [
            {
              label: "Underlying shares",
              value: potentialSupplyValue,
              note: "Shares issuable from warrant or conversion terms.",
              emphasis: true,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
            {
              label: instrumentPriceMetric.label,
              value: instrumentPriceMetric.value,
              note: instrumentPriceMetric.note,
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Company proceeds",
              value: companyProceeds,
              note: "Cash to the company from this offering.",
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Dilution vs current shares",
              value: dilutionRatioSnapshotValue,
              note: isDisclosedValue(dilutionRatioValue) ? "Underlying shares vs. current shares." : dilutionRatioUnavailableNote,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
          ]
      : isResale
        ? [
            {
              label: "Resale shares",
              value: potentialSupplyValue,
              note: "Registered for resale.",
              emphasis: true,
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
            {
              label: "Company proceeds",
              value: resaleCompanyProceedsValue,
              note: resaleCompanyProceedsNote,
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Selling holder",
              value: resaleSellingHolderValue,
              note: "Named selling holder.",
              tone: "neutral",
            } as DilutionMetricItem,
            {
              label: "Overhang",
              value: isDisclosedValue(dilutionRatioValue) ? dilutionRatioValue : readSnapshotRatioStatusValue(displayPayloadData, llmDisplayModel),
              note: currentSharesOutstanding ? "Resale shares vs. current shares." : "Current-share denominator not stated.",
              tone: scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
            } as DilutionMetricItem,
          ]
      : [
          {
            label: "Current shares",
            value: currentSharesValue,
            note: currentSharesSourceNote,
            tone: "neutral",
          } as DilutionMetricItem,
          {
            label: displayLabels.supplyMetricLabel,
            value: potentialSupplyValue,
            note: supplyCountEstimated
              ? `Estimated from ${offeringAmount} / ${offeringPrice}.`
              : displayLabels.supplyMetricNote || (poolMixSummary || "Share count disclosed in the filing."),
            emphasis: true,
            tone: isResale || scoreBand === "Severe" || scoreBand === "High" ? "danger" : "neutral",
          } as DilutionMetricItem,
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
          } as DilutionMetricItem,
          {
            label: "Company proceeds",
            value: companyProceeds,
            note: "Cash to the company from this offering.",
            tone: "neutral",
          } as DilutionMetricItem,
        ]),
  ];
  const fallbackImpactMetrics = impactMetricItems.filter((metric): metric is DilutionMetricItem => Boolean(metric));
  const impactMetrics = isRoutinePostEffectiveUpdate
    ? []
    : isS8Form && fallbackImpactMetrics.length
    ? fallbackImpactMetrics
    : is424bOfferingTermsPayload
    ? llmSnapshotMetrics
    : llmSnapshotMetrics.length
      ? llmSnapshotMetrics
      : fallbackImpactMetrics;
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
    : isS8PlanRegistration
      ? [
          `The filing is an S-8 employee-plan registration.`,
          sharesOffered ? `Registered plan shares: ${sharesOffered}.` : "Registered plan-share count was not clearly parsed.",
          useOfProceeds || "These shares are for plan awards or exercises, not a cash offering by itself.",
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
      : isS8PlanRegistration
        ? "Actual dilution depends on future grants, vesting, exercises, and share issuance under the plan."
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
    isResale || isS8PlanRegistration || isForwardSale || isConvertibleFinancing || isRegisteredDirect || hasPrefundedWarrants
      ? sharesOffered || "Not disclosed"
      : offeringAmount || sharesOffered || "Not disclosed";
  const offeringStructureRows = compactRows([
    row("Offering Type", offeringType),
    row("Security Type", securityType),
    row("Registration Use", primaryOrResale),
    row(isS8PlanRegistration ? "Registered Plan Shares" : isResale ? "Registered Resale Shares" : "Shares Offered", sharesOffered),
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
  const pricedOfferingRows = compactRows([
    termRow("Purchaser / Investor", purchaserInvestor),
    termRow("Placement Agent / Underwriter", salesAgent),
    termRow("Warrant Terms", hasDisplayWarrants && warrantExercisePrice ? `Exercise price: ${warrantExercisePrice}` : ""),
    termRow("Closing Date", isLikelyDateDisclosure(closingDate) ? closingDate : ""),
    termRow("Agreement Date", isLikelyDateDisclosure(offeringAgreementDate) ? offeringAgreementDate : ""),
    termRow("Use of Proceeds", useOfProceeds),
  ]);
  const atmProgramRows = compactRows([
    termRow("Program size", atmProgramSize, "Maximum gross sale capacity stated in the filing."),
    termRow("Sales agent", salesAgent),
    termRow("Fee / commission", atmFeeCommission),
    termRow("Use of proceeds", useOfProceeds),
    termRow("Agreement date", atmAgreementDate),
    termRow("End date", atmEndDate),
  ]);
  const atmDilutionRows = compactRows([
    {
      label: "Fixed share count",
      value: "Not fixed",
      note: "This filing sets a dollar cap, not a final share count.",
    },
    {
      label: "Market cap scale",
      value: atmSizeVsMarketCapValue,
      note: marketCapAmount ? "ATM program size compared with company value." : "Market cap was not available.",
    },
    {
      label: "Confirmed shares sold",
      value: "None disclosed",
      note: "Actual sales require future execution or follow-up disclosure.",
    },
  ]);

  return {
    disclosureStatus: hasParsedTerms ? "Parsed from current filing text" : "Terms require source review",
    atmDilutionRows,
    atmProgramRows,
    atmMarketCapValue: marketCapValue,
    offeringDetailsRows,
    llmShareOverhang,
    s3AmendmentChangeRows,
    s8ContextDetailRows,
    warrantDetailsRows,
    warrantInstrumentRows,
    is424bOfferingTermsPayload,
    isMixedOffering,
    isNoFloorVariableConvertibleExposure,
    isResaleRegistration: isResale,
    isWarrantConvertible: isConvertibleFinancing,
    isPricedPrimaryOrRegisteredDirect,
    pricedOfferingRows,
    isS8ReofferResale,
    isS8DetailCandidate: hasMinimumS8DetailFields,
    isShelfOnly,
    isCommonWarrantOnly,
    shelfCapacityValue,
    shelfCapacityNote,
    shelfCompanyProceeds,
    shelfCompanyProceedsNote,
    shelfCurrentStateRows,
    shelfDetailRows,
    shelfDisplayMode,
    shelfIntro,
    shelfRegisteredSharesValue,
    shelfSecuritiesCovered,
    shelfShareNote,
    shelfStatus,
    shelfSummaryParagraphs,
    shelfWatchRows,
    dilutionRead: `${displayOverhangLevel} dilution watch`,
    dilutionRatioPercentValue: canRenderOverhangChart ? estimatedDilutionPercent || dilutionRatioValue : readSnapshotRatioStatusValue(displayPayloadData, llmDisplayModel),
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
    currentDetailLabel: currentShareDetailLabel,
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
      : isS8PlanRegistration
        ? s8UiMode === "inducement_awards"
          ? "Plan and inducement shares"
          : "Registered plan shares"
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
    hideShareOverhang: isAtm,
    hideSnapshotPanel: isRoutinePostEffectiveUpdate,
    hideStructuredDetailSections: isRoutinePostEffectiveUpdate,
    summaryTitle: isAmendmentSummaryMode ? "Amendment Summary" : "Dilution Summary",
    hasConversionSegment,
    hasCurrentSharesMarker,
    hasPoolSegments,
    hasPoolTotalMarker,
    markersAreClose,
    useCombinedMarkerLabel,
    supplyBreakdownLabel: displayLabels.supplyBreakdownLabel,
    supplyDetailLabel: displayLabels.supplyDetailLabel,
    supplyRatioCaption: isDisclosedValue(dilutionRatioValue) ? `${dilutionRatioValue} of current` : "Not calculable",
    supplyMarkerLabel: isResale
      ? "Current + resale"
      : isS8PlanRegistration
        ? "Current + plan shares"
        : isShelfLike
          ? "Current + registered"
          : "Current + supply",
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

const APPROVED_424B_SUPPLY_SEGMENT_LABELS = [
  "Resale shares",
  "Common shares",
  "Pre-funded warrants",
  "Common warrants",
  "Placement agent warrants",
  "Preferred stock",
  "Convertible preferred",
  "Convertible notes",
  "Rights",
  "Other registered shares",
];

function normalize424bSupplySegmentLabel(label: string) {
  const normalized = label.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return (
    APPROVED_424B_SUPPLY_SEGMENT_LABELS.find(
      (approved) => approved.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ") === normalized,
    ) || ""
  );
}

function buildLlmPoolBreakdown(model: Record<string, unknown> | null, options: { isResale: boolean }) {
  const rows = recordArray(model?.supply_segments)
    .map((segment) => {
      const shares = readSegmentShareExposureFact(segment);
      const valueText = readRowString(shares, "value_text");
      const numericValue = readRowNumber(shares, "numeric_value");
      const shareCount = numericValue || parseShareCount(valueText);
      if (!shareCount) return null;
      const priceValue = readDisplayFactRecordValue(readPlainRecord(segment.price));
      const instrumentCountValue = readDisplayFactRecordValue(readPlainRecord(segment.instrument_count));

      return {
        detail: [
          readRowString(segment, "timing_or_condition"),
          readRowString(segment, "evidence"),
          instrumentCountValue,
          valueText,
          priceValue,
        ].filter(Boolean).join(" ") || "LLM-selected supply component",
        label: formatLlmPoolSegmentLabel(segment, options),
        shareCount,
        shares: `${shareCount.toLocaleString("en-US")} shares`,
      };
    })
    .filter((item): item is { label: string; shares: string; detail: string; shareCount: number } => Boolean(item));

  return aggregatePoolBreakdownRows(rows);
}

type MixedOfferingComponent = {
  evidence: string;
  label: string;
  numericValue: number;
  role: string;
  unit: string;
  valueText: string;
};

function readMixedOfferingComponents(
  primaryModel: Record<string, unknown> | null,
  secondaryModel: Record<string, unknown> | null,
): MixedOfferingComponent[] {
  const rows = recordArray(primaryModel?.mixed_offering_components).length
    ? recordArray(primaryModel?.mixed_offering_components)
    : recordArray(secondaryModel?.mixed_offering_components);

  return rows
    .map((row) => {
      const role = normalizeMixedOfferingComponentRole(
        readRowString(row, "role") || readRowString(row, "component") || readRowString(row, "key"),
      );
      if (!role) return null;

      const valueText = cleanDisclosureValue(
        readRowString(row, "value_text") ||
          readRowString(row, "valueText") ||
          readRowString(row, "shares") ||
          readRowString(row, "value"),
      );
      const numericValue =
        readRowNumber(row, "numeric_value") || readRowNumber(row, "numericValue") || parseShareCount(valueText);

      return {
        evidence: readRowString(row, "evidence"),
        label: cleanDisclosureValue(readRowString(row, "label")) || formatMixedOfferingComponentRole(role),
        numericValue,
        role,
        unit: readRowString(row, "unit") || "shares",
        valueText,
      };
    })
    .filter((row): row is MixedOfferingComponent => Boolean(row));
}

function normalizeMixedOfferingComponentRole(role: string) {
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "";
  if (/^(?:new_shares|current_sale|current_sale_share_equivalents|current_share_equivalents)$/.test(normalized)) {
    return "new_shares";
  }
  if (/^(?:potential_warrants|warrants|additional_warrants)$/.test(normalized)) return "potential_warrants";
  if (/^(?:potential_instruments|additional_potential_supply|additional_instruments)$/.test(normalized)) {
    return "potential_instruments";
  }
  if (/^(?:total_potential_supply|total_potential_dilution|total_supply|total)$/.test(normalized)) {
    return "total_potential_supply";
  }
  return normalized;
}

function formatMixedOfferingComponentRole(role: string) {
  if (role === "new_shares") return "New shares";
  if (role === "potential_warrants") return "Potential warrants";
  if (role === "potential_instruments") return "Potential instruments";
  if (role === "total_potential_supply") return "Total potential supply";
  return role.replace(/_/g, " ");
}

function findMixedOfferingComponent(components: MixedOfferingComponent[], roles: string[]) {
  const normalizedRoles = roles.map(normalizeMixedOfferingComponentRole);
  return components.find((component) => normalizedRoles.includes(component.role));
}

function findMixedOfferingShareComponent(components: MixedOfferingComponent[], roles: string[]) {
  const normalizedRoles = roles.map(normalizeMixedOfferingComponentRole);
  return components.find((component) => normalizedRoles.includes(component.role) && mixedOfferingShareCount(component) > 0);
}

function sumMixedOfferingComponentShares(components: MixedOfferingComponent[], roles: string[]) {
  const normalizedRoles = roles.map(normalizeMixedOfferingComponentRole);
  return components.reduce(
    (total, component) => total + (normalizedRoles.includes(component.role) ? mixedOfferingShareCount(component) : 0),
    0,
  );
}

function mixedOfferingShareCount(component: MixedOfferingComponent | undefined) {
  if (!component) return 0;
  const unit = component.unit.trim().toLowerCase();
  if (unit && !/\bshares?\b|share_equivalents?|securities/.test(unit)) return 0;
  if (/\$/.test(component.valueText) && !/\bshares?\b/i.test(component.valueText)) return 0;
  return component.numericValue || parseShareCount(component.valueText);
}

function formatMixedOfferingComponentValue(component: MixedOfferingComponent | undefined) {
  if (!component) return "";
  if (component.valueText) return component.valueText;
  if (!component.numericValue) return "";
  if (component.unit === "usd") return formatMoneyValue(component.numericValue);
  if (component.unit === "percent") return `${component.numericValue.toLocaleString("en-US")}%`;
  return `${Math.round(component.numericValue).toLocaleString("en-US")} shares`;
}

function buildSupplyComponentSegmentNote(
  item: { label: string; detail: string; shareCount: number },
  currentCount: number,
  instrumentPriceGroups: Array<{ type: string; price: string; shares?: string }>,
  currentShareComparisonLabel = "current shares",
) {
  const ratioNote = currentCount
    ? `${formatPercentCompact((item.shareCount / currentCount) * 100) || "Not disclosed"} of ${currentShareComparisonLabel}`
    : "Potential";
  void item;
  void instrumentPriceGroups;
  return ratioNote;
}

function buildSupplyComponentBasisNote(
  item: { label: string; detail: string },
  instrumentPriceGroups: Array<{ type: string; price: string; shares?: string }>,
) {
  const conversionGroup = instrumentPriceGroups.find((group) => classifyInstrumentPriceFamily(group.type) === "conversion");
  const basisText = `${item.label} ${item.detail} ${conversionGroup?.type || ""} ${conversionGroup?.shares || ""}`.replace(/\s+/g, " ").trim();
  if (!/\b(?:convertible|conversion|notes?|preferred)\b/i.test(basisText) || /\bwarrants?\b/i.test(basisText)) return "";
  const priceText = `${conversionGroup?.price || ""} ${item.detail}`.replace(/\s+/g, " ").trim();

  const alternate = priceText.match(/\balternate(?: conversion)?(?: price)?(?: basis)?[:\s]*(?:at|of|=)?\s*(\$[\d,.]+(?:\/share)?)/i)?.[1];
  if (alternate && /\balternate(?: conversion)?(?: price)?(?: basis)?\b/i.test(basisText)) {
    return `based on ${alternate} alternate conversion price`;
  }

  const floor = priceText.match(/\bfloor(?: price)?[:\s]*(?:at|of|=)?\s*(\$[\d,.]+(?:\/share)?)/i)?.[1];
  if (floor && /\bfloor(?: price)?(?: basis)?\b/i.test(basisText)) return `based on ${floor} floor price`;

  const initial = priceText.match(/\binitial(?: conversion)?(?: price)?[:\s]*(?:at|of|=)?\s*(\$[\d,.]+(?:\/share)?)/i)?.[1];
  if (initial && /\binitial(?: conversion)?(?: price)?(?: basis)?\b/i.test(basisText)) return `based on ${initial} initial conversion price`;

  if (/\b(?:VWAP|variable|formula|floating|reset|refix)\b/i.test(basisText)) return "based on variable conversion formula";

  return "";
}

function aggregatePoolBreakdownRows(rows: Array<{ label: string; shares: string; detail: string; shareCount: number }>) {
  const grouped = new Map<string, { label: string; shares: string; detail: string; shareCount: number }>();

  for (const row of rows) {
    const key = row.label;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row });
      continue;
    }

    existing.shareCount += row.shareCount;
    existing.shares = `${Math.round(existing.shareCount).toLocaleString("en-US")} shares`;
    existing.detail = [existing.detail, row.detail].filter(Boolean).join(" ");
  }

  return Array.from(grouped.values());
}

function sumMixedOfferingCurrentSaleShares(rows: Array<{ label: string; shareCount: number }>) {
  return rows.reduce((total, row) => {
    return /^(?:Common shares|Pre-funded warrants|Preferred stock|Convertible preferred|Rights|Other registered shares)$/i.test(row.label)
      ? total + row.shareCount
      : total;
  }, 0);
}

function sumMixedOfferingInstrumentShares(rows: Array<{ label: string; shareCount: number }>) {
  return rows.reduce((total, row) => {
    return /^(?:Common warrants|Placement agent warrants|Convertible notes)$/i.test(row.label)
      ? total + row.shareCount
      : total;
  }, 0);
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
      "Pre-funded warrants",
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
      "Common warrants",
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
  if (label) return label;
  if (instrumentType) return instrumentType;

  const price = readPlainRecord(segment.price);
  const text = [
    readRowString(segment, "timing_or_condition"),
    readRowString(segment, "evidence"),
    readRowString(price, "value_text"),
  ]
    .join(" ")
    .toLowerCase();

  if (/\bpre[-_\s]?funded\b/.test(text)) return "Pre-funded warrants";
  if (/\bplacement agent\b/.test(text) && text.includes("warrant")) return "Placement agent warrants";
  if (text.includes("warrant")) return "Common warrants";
  if (text.includes("preferred")) return "Preferred stock";
  if (text.includes("convertible") || text.includes("conversion") || text.includes("note")) return "Convertible notes";
  if (options.isResale && /\b(common|ordinary|ads|resale)\b/.test(text)) return "Resale shares";
  return label || "Other registered shares";
}

function hasVisibleWarrantDisplay(model: Record<string, unknown> | null) {
  const shareOverhang = readPlainRecord(model?.share_overhang);
  const shareOverhangText = [
    readRowString(shareOverhang, "chart_title"),
    readRowString(shareOverhang, "subtitle"),
    ...recordArray(shareOverhang?.rows).flatMap((row) => [
      readRowString(row, "label"),
      readRowString(row, "value"),
      readRowString(row, "note"),
      readRowString(row, "supply_type"),
    ]),
  ].join(" ");
  if (/\bwarrants?\b/i.test(shareOverhangText)) return true;

  return readRawWarrantDetailRows(model).some((row) => /\bwarrants?\b/i.test(`${row.label} ${row.value}`));
}

function readDisplayFactValue(model: Record<string, unknown> | null, key: string) {
  return readDisplayFactRecordValue(readPlainRecord(model?.[key]));
}

function readDisplayFactNumber(model: Record<string, unknown> | null, key: string) {
  const fact = readPlainRecord(model?.[key]);
  return readRowNumber(fact, "numeric_value") || readRowNumber(fact, "numericValue");
}

function readDisplayFlexibleValue(model: Record<string, unknown> | null, key: string) {
  const value = model?.[key];
  return readDisplayFactRecordValue(readPlainRecord(value)) || cleanDisclosureValue(readDisclosureValue(value) || readRowString(model, key));
}

function readDisplayFlexibleNumber(model: Record<string, unknown> | null, key: string) {
  const value = model?.[key];
  const fact = readPlainRecord(value);
  return readRowNumber(fact, "numeric_value") || readRowNumber(fact, "numericValue") || readRowNumber(model, key);
}

function buildCurrentShareBasisLabel(primaryModel: Record<string, unknown> | null, secondaryModel: Record<string, unknown> | null) {
  const parts: string[] = [];
  for (const model of [primaryModel, secondaryModel]) {
    if (!model) continue;
    for (const key of ["current_shares", "current_shares_outstanding"]) {
      const fact = readPlainRecord(model[key]);
      parts.push(readDisplayFactRecordValue(fact), readRowString(fact, "evidence"));
    }
    for (const metric of recordArray(model.snapshot_metrics)) {
      parts.push(readRowString(metric, "label"), readDisclosureValue(metric.note), readDisclosureValue(metric.value));
    }
  }
  const text = parts.filter(Boolean).join(" ");
  if (/\bclass\s+a\b/i.test(text)) return "Class A shares";
  if (/\bclass\s+b\b/i.test(text)) return "Class B shares";
  if (/\bordinary shares?\b/i.test(text)) return "Ordinary shares";
  if (/\b(?:ADSs?|American Depositary Shares?)\b/i.test(text)) return "ADSs";
  if (/\bpublic float\b/i.test(text)) return "Public float";
  if (/\bnon-affiliate\b/i.test(text)) return "Non-affiliate shares";
  return "Current shares";
}

function buildCurrentShareDetailLabel(label: string) {
  if (label === "Current shares") return "Current Shares Outstanding";
  if (label === "Public float") return "Public Float";
  if (label === "Non-affiliate shares") return "Non-Affiliate Shares";
  if (/shares$/i.test(label)) return `${label} outstanding`;
  return label;
}

function readDisplayPercentValue(model: Record<string, unknown> | null, key: string) {
  const value = readDisplayFlexibleValue(model, key);
  if (!value) return "";
  const numeric = Number(value.replace(/,/g, "").replace(/%$/, "").trim());
  if (!Number.isFinite(numeric)) return value;
  return `${numeric.toFixed(numeric >= 10 ? 1 : 2)}%`;
}

function readDisplayShareExposureValue(model: Record<string, unknown> | null) {
  return readDisplayFactRecordValue(readDisplayShareExposureFact(model));
}

function readDisplayShareExposureNumber(model: Record<string, unknown> | null) {
  const fact = readDisplayShareExposureFact(model);
  return readRowNumber(fact, "numeric_value") || readRowNumber(fact, "numericValue");
}

function readDisplayShareExposureFact(model: Record<string, unknown> | null) {
  const adsEquivalence = readPlainRecord(model?.ads_equivalence);
  const registeredTotals = readPlainRecord(model?.registered_security_totals);
  return firstDisplayFact([
    readPlainRecord(adsEquivalence?.ordinary_shares_represented),
    readPlainRecord(registeredTotals?.ordinary_shares_represented),
    readPlainRecord(registeredTotals?.total_distinct_share_exposure),
    readPlainRecord(model?.total_potential_supply),
  ]);
}

function firstDisplayFact(facts: Array<Record<string, unknown> | null>) {
  return facts.find((fact) => Boolean(readDisplayFactRecordValue(fact) || readRowNumber(fact, "numeric_value") || readRowNumber(fact, "numericValue"))) || null;
}

function readSegmentShareExposureFact(segment: Record<string, unknown>) {
  const ordinaryShares = readPlainRecord(segment.ordinary_shares_represented);
  const underlyingShares = readPlainRecord(segment.underlying_shares);
  const shares = readPlainRecord(segment.shares);
  const instrumentCount = readPlainRecord(segment.instrument_count);
  const text = [
    readRowString(segment, "instrument_type"),
    readRowString(segment, "label"),
    readDisplayFactRecordValue(shares),
    readDisplayFactRecordValue(instrumentCount),
    readRowString(segment, "evidence"),
  ].join(" ");
  if (/\bADSs?\b|American Depositary Shares?/i.test(text)) {
    return firstDisplayFact([ordinaryShares, underlyingShares, shares]);
  }
  return firstDisplayFact([shares, underlyingShares]);
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

function readSnapshotFactStatusValue(
  primaryModel: Record<string, unknown> | null,
  secondaryModel: Record<string, unknown> | null,
  key: string,
  fallback: "Not stated" | "Variable" | "Not fixed yet" = "Not stated",
) {
  const value = readDisplayFactValue(primaryModel, key) || readDisplayFactValue(secondaryModel, key);
  if (isDisclosedValue(value)) return value;

  const context = collectSnapshotStatusContext(primaryModel, secondaryModel, key);
  if (/\b(?:variable|vwap|formula|depends|actual sales|market prices?|conversion price|from time to time)\b/i.test(context)) {
    return "Variable";
  }
  if (/\b(?:not fixed|not yet fixed|future sales|not completed|not sold yet|no shares sold)\b/i.test(context)) {
    return "Not fixed yet";
  }
  if (/\b(?:not stated|not provided|not disclosed|unavailable|missing|no fixed share count)\b/i.test(context)) {
    return "Not stated";
  }
  return fallback;
}

function readSnapshotRatioStatusValue(primaryModel: Record<string, unknown> | null, secondaryModel: Record<string, unknown> | null) {
  const context = collectSnapshotStatusContext(primaryModel, secondaryModel, "total_potential_supply");
  if (/\b(?:variable|vwap|formula|depends|actual sales|market prices?|no fixed share count)\b/i.test(context)) {
    return "Variable";
  }
  if (/\b(?:not fixed|not yet fixed|future sales|not completed|not sold yet)\b/i.test(context)) {
    return "Not fixed yet";
  }
  return "Not stated";
}

function collectSnapshotStatusContext(
  primaryModel: Record<string, unknown> | null,
  secondaryModel: Record<string, unknown> | null,
  key: string,
) {
  const pieces: string[] = [];
  for (const model of [primaryModel, secondaryModel]) {
    if (!model) continue;
    const fact = readPlainRecord(model[key]);
    pieces.push(
      readRowString(fact, "value_text"),
      readRowString(fact, "evidence"),
      ...readDisplayStringArray(model, "source_notes"),
    );
  }
  return pieces.filter(Boolean).join(" ");
}

function readDbShareValue(terms: Record<string, unknown> | null, numberKey: string, textKey: string) {
  const textValue = cleanDisclosureValue(readRowString(terms, textKey));
  if (isDisclosedValue(textValue)) return formatShareCountValue(textValue) || textValue;

  return formatShareCountNumber(readRowNumber(terms, numberKey));
}

function readS8RegisteredShareValue(data: Record<string, unknown> | null) {
  if (!data) return "";
  const directKeys = [
    "total_registered_shares",
    "totalRegisteredShares",
    "total_registered_shares_text",
    "totalRegisteredSharesText",
    "amount_registered",
    "registered_shares",
    "additional_shares",
    "reoffer_shares",
  ];

  const directCandidate = readS8ShareCandidateFromKeys(data, directKeys);
  const fallbackKeys = ["registeredShares", "additionalShares", "reofferShares"];
  const fallbackCandidate = readS8ShareCandidateFromKeys(data, fallbackKeys);
  const planCandidate = readS8ShareCandidateFromKeys(data, ["plan_registered_shares", "planRegisteredShares"]);
  const inducementCandidate = readS8ShareCandidateFromKeys(data, [
    "inducement_award_shares",
    "inducementAwardShares",
  ]);
  const reofferCandidate = readS8ShareCandidateFromKeys(data, ["reoffer_resale_shares", "reofferResaleShares"]);
  const combinedLlmCandidate = [planCandidate, inducementCandidate, reofferCandidate]
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const candidates = [
    directCandidate,
    fallbackCandidate,
    combinedLlmCandidate,
  ].filter((value) => value > 0);
  if (!candidates.length) return "";

  const largestCandidate = Math.max(...candidates);

  return formatShareCountNumber(largestCandidate);
}

function readS8ShareValueFromModels(
  primaryModel: Record<string, unknown> | null,
  secondaryModel: Record<string, unknown> | null,
  keys: string[],
) {
  for (const model of [primaryModel, secondaryModel]) {
    if (!model) continue;
    const candidate = readS8ShareCandidateFromKeys(model, keys);
    if (candidate) return formatShareCountNumber(candidate);
  }
  return "";
}

function readS8ShareCandidateFromKeys(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const textValue = cleanDisclosureValue(readRowString(data, key));
    const textCount = parseShareCount(textValue);
    if (textCount) return textCount;

    const numericValue = readRowNumber(data, key);
    if (numericValue) return numericValue;
  }

  return 0;
}

function formatS8ShareRatio(numeratorValue: string, denominatorValue: string) {
  const numerator = parseShareCount(numeratorValue);
  const denominator = parseShareCount(denominatorValue);
  if (!numerator || !denominator) return "";
  const percent = (numerator / denominator) * 100;
  if (!Number.isFinite(percent) || percent <= 0) return "";
  return `${percent >= 100 ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function chooseS8PlanShareValue(displayPayloadValue: string, sourceTextValue: string) {
  const displayCount = parseShareCount(displayPayloadValue);
  const sourceCount = parseShareCount(sourceTextValue);

  if (displayCount && sourceCount) {
    const differenceRatio = Math.abs(displayCount - sourceCount) / Math.max(displayCount, sourceCount);
    if (differenceRatio <= 0.02) return displayPayloadValue;
    return displayCount > sourceCount ? displayPayloadValue : sourceTextValue;
  }

  return displayPayloadValue || sourceTextValue;
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
    convertible_preferred: "Convertible preferred",
    preferred_stock: "Preferred stock",
    preferred_shares: "Preferred shares",
    series_a_preferred: "Series A preferred",
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

function formatS8PlanOfferingType(normalizedType: string, s8UiMode = "") {
  if (s8UiMode === "inducement_awards") return "S-8 inducement awards";
  if (s8UiMode === "post_effective_amendment") return "S-8 post-effective amendment";
  const normalized = normalizedType.trim().toLowerCase();
  if (normalized.includes("post_effective")) return "S-8 post-effective amendment";
  if (normalized.includes("general_instruction_e") || normalized.includes("additional")) return "S-8 additional plan shares";
  if (normalized.includes("initial")) return "S-8 plan registration";
  return "S-8 plan registration";
}

function isActionableAtmMechanism({
  dbOfferingType,
  displayMode,
  offeringTerms,
  sourceText,
}: {
  dbOfferingType: string;
  displayMode: string;
  offeringTerms: Record<string, unknown> | null;
  sourceText: string;
}) {
  if (dbOfferingType === "At-the-market offering" || dbOfferingType === "ATM") return true;
  if (displayMode === "atm") return true;
  if (isDisclosedValue(readDbMoneyValue(offeringTerms, "atm_program_size", "atm_program_size_text"))) return true;

  return /\b(?:at-the-market sales agreement|equity distribution agreement|sales agreement with|sales agreement, dated|ATM program|at-the-market offering program)\b/i.test(
    sourceText,
  );
}

function buildOfferingDisplayLabels({
  hasPrefundedWarrants,
  isConvertibleFinancing,
  isForwardSale,
  isRegisteredDirect,
  isResale,
  isS8PlanRegistration,
  isS8ReofferResale,
  isShelfLike,
  s8UiMode,
  hasS8ParentPlanContext,
  supplyCountEstimated,
}: {
  hasPrefundedWarrants: boolean;
  isConvertibleFinancing: boolean;
  isForwardSale: boolean;
  isRegisteredDirect: boolean;
  isResale: boolean;
  isS8PlanRegistration: boolean;
  isS8ReofferResale: boolean;
  isShelfLike: boolean;
  s8UiMode: string;
  hasS8ParentPlanContext: boolean;
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

  if (isS8ReofferResale && hasS8ParentPlanContext) {
    return {
      overhangSubtitle: "Current shares plus parent S-8 plan shares",
      overhangScoreCaption: "Parent plan shares vs. current shares",
      supplyDetailLabel: "Parent Plan Shares",
      supplyBreakdownLabel: "Parent plan shares",
      supplyMetricLabel: "Parent plan shares",
      supplyMetricNote: "Original S-8 plan registration.",
      ratioMetricLabel: "Parent Plan / Outstanding",
      ratioMetricNote: "Parent plan shares compared with current shares.",
      primaryExposureLabel: "Parent Plan Shares",
      quickImpactLabel: "Parent Plan / Outstanding",
      snapshotSupplyLabel: "Parent Plan Shares",
      totalExposureLabel: "Potential plan-share total",
      unavailableMessage:
        "Parent S-8 plan share count was not supplied, so plan-share overhang is not calculated.",
    };
  }

  if (isS8ReofferResale) {
    return {
      overhangSubtitle: "Current shares plus reoffer resale subset",
      overhangScoreCaption: "Reoffer resale shares vs. current shares",
      supplyDetailLabel: "Reoffer Resale Shares",
      supplyBreakdownLabel: "Reoffer resale shares",
      supplyMetricLabel: "Reoffer resale shares",
      supplyMetricNote: "Shares covered by the reoffer prospectus.",
      ratioMetricLabel: "Resale Shares / Outstanding",
      ratioMetricNote: "Reoffer resale shares compared with current shares.",
      primaryExposureLabel: "Reoffer Resale Shares",
      quickImpactLabel: "Resale Shares / Outstanding",
      snapshotSupplyLabel: "Reoffer Shares",
      totalExposureLabel: "Reoffer subset",
      unavailableMessage:
        "Reoffer resale share count was not disclosed or mechanically calculable, so reoffer overhang is not calculated.",
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

  if (isS8PlanRegistration) {
    if (s8UiMode === "inducement_awards") {
      return {
        overhangSubtitle: "Current shares plus registered plan and inducement-award shares",
        overhangScoreCaption: "Registered S-8 shares vs. current shares",
        supplyDetailLabel: "Plan + Inducement Shares",
        supplyBreakdownLabel: "Registered plan and inducement shares",
        supplyMetricLabel: "Plan + inducement shares",
        supplyMetricNote: supplyCountEstimated ? "Estimated S-8 share count." : "Registered plan and inducement-award shares.",
        ratioMetricLabel: "S-8 shares / current",
        ratioMetricNote: "Registered S-8 shares compared with current shares.",
        primaryExposureLabel: "Plan + Inducement Shares",
        quickImpactLabel: "S-8 Shares / Current",
        snapshotSupplyLabel: "Plan + Inducement Shares",
        totalExposureLabel: "Potential S-8 total",
        unavailableMessage:
          "Registered S-8 share count was not disclosed or mechanically calculable, so plan-share overhang is not calculated.",
      };
    }

    return {
      overhangSubtitle: "Current shares plus registered plan shares",
      overhangScoreCaption: "Registered plan shares vs. current shares",
      supplyDetailLabel: "Registered Plan Shares",
      supplyBreakdownLabel: "Registered plan shares",
      supplyMetricLabel: "Registered plan shares",
      supplyMetricNote: supplyCountEstimated ? "Estimated plan-share count." : "Plan-share registration.",
      ratioMetricLabel: "Plan shares / current",
      ratioMetricNote: "Registered plan shares compared with current shares.",
      primaryExposureLabel: "Registered Plan Shares",
      quickImpactLabel: "Plan Shares / Current",
      snapshotSupplyLabel: "Plan Shares",
      totalExposureLabel: "Potential plan-share total",
      unavailableMessage:
        "Registered plan-share count was not disclosed or mechanically calculable, so plan-share overhang is not calculated.",
    };
  }

  if (hasPrefundedWarrants) {
    return {
      overhangSubtitle: "Current shares plus pre-funded warrant supply",
      overhangScoreCaption: "Pre-funded warrant supply vs. current shares",
      supplyDetailLabel: "Pre-Funded Warrant Supply",
      supplyBreakdownLabel: "Pre-funded warrant supply",
      supplyMetricLabel: "Pre-Funded Warrant Supply",
      supplyMetricNote: "Pre-funded warrants are treated as near-immediate common-share supply.",
      ratioMetricLabel: "Supply / current",
      ratioMetricNote: "Pre-funded warrant supply compared with current shares.",
      primaryExposureLabel: "Pre-Funded Warrant Supply",
      quickImpactLabel: "Supply / Current",
      snapshotSupplyLabel: "Pre-Funded Warrants",
      totalExposureLabel: "Potential total",
      unavailableMessage:
        "Pre-funded warrant supply was not disclosed or mechanically calculable, so dilution is not calculated.",
    };
  }

  return {
    overhangSubtitle: "Current shares plus potential supply",
    overhangScoreCaption: "Total potential dilution vs. current shares",
    supplyDetailLabel: isShelfLike ? "Registered Shares" : isRegisteredDirect ? "New Shares" : "Potential Supply",
    supplyBreakdownLabel: isShelfLike ? "Registered shares" : "Potential supply",
    supplyMetricLabel: isShelfLike && !isRegisteredDirect ? "Registered shares" : "Potential supply",
    supplyMetricNote: supplyCountEstimated ? "Estimated from amount and price." : "Potential supply.",
    ratioMetricLabel: "Supply / current",
    ratioMetricNote: "Potential supply compared with current shares.",
    primaryExposureLabel: isShelfLike ? "Registered Shares" : "New Shares",
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

function readMarketCapAmount(record: Record<string, unknown> | null | undefined) {
  const numericValue = readRowNumber(record, "market_cap") || readRowNumber(record, "marketCap");
  if (numericValue) return numericValue;

  const textValue =
    readRowString(record, "market_cap") ||
    readRowString(record, "marketCap") ||
    readRowString(record, "market_cap_text") ||
    readRowString(record, "marketCapText");
  return parseMoneyValue(textValue);
}

function readDisplayStringArray(model: Record<string, unknown> | null, key: string) {
  const value = model?.[key];
  return Array.isArray(value) ? value.map((item) => cleanDisclosureValue(item)).filter(Boolean).slice(0, 3) : [];
}

function readLlmShareOverhang(
  primaryModel: Record<string, unknown> | null,
  secondaryModel: Record<string, unknown> | null,
): LlmShareOverhangModel | null {
  const primaryOverhang = readPlainRecord(primaryModel?.share_overhang);
  const secondaryOverhang = readPlainRecord(secondaryModel?.share_overhang);
  const overhang = hasRawShareOverhangContent(primaryOverhang)
    ? primaryOverhang
    : hasRawShareOverhangContent(secondaryOverhang)
      ? secondaryOverhang
      : null;
  if (!overhang) return null;

  const totalNote = normalizeShareOverhangTotalNoteRecord(readPlainRecord(overhang.total_note) || {});
  const hasStructuredRows = Boolean(readPlainRecord(overhang.basis)) || recordArray(overhang.rows).length > 0;
  const unavailableRows = readLlmShareOverhangRows(
    hasStructuredRows ? overhang.unavailable_rows || overhang.detail_rows : overhang.unavailable_rows || overhang.detail_rows || overhang.rows,
  );
  const routedRows = readLlmShareOverhangRoutedRows(overhang);
  const model: LlmShareOverhangModel = {
    chartTitle: readOverhangString(overhang, "chart_title", "chartTitle", "title"),
    subtitle: readOverhangString(overhang, "subtitle", "chart_subtitle", "chartSubtitle"),
    statusLabel: readOverhangString(overhang, "status_label", "statusLabel", "level_label", "levelLabel"),
    statusValue: readOverhangString(overhang, "status_value", "statusValue", "value"),
    caption: readOverhangString(overhang, "caption", "score_caption", "scoreCaption"),
    ratioLabel: readOverhangString(overhang, "ratio_label", "ratioLabel", "scale_label", "scaleLabel"),
    ratioValue: readOverhangString(overhang, "ratio_value", "ratioValue", "percent_value", "percentValue"),
    currentLabel: "",
    currentValue: "",
    supplyLabel: "",
    supplyValue: "",
    totalNoteTitle: readOverhangString(totalNote, "title", "label"),
    totalNoteNumerator: readOverhangString(totalNote, "numerator"),
    totalNoteDenominator: readOverhangString(totalNote, "denominator"),
    totalNoteRatio: readOverhangString(totalNote, "ratio"),
    totalNoteSuffix: readOverhangString(totalNote, "suffix", "note"),
    note: readOverhangString(overhang, "note", "footnote"),
    unavailableRows,
    conditionalSupplyRows: routedRows.conditionalSupplyRows,
    overhangBarSegments: routedRows.overhangBarSegments,
    conditionalExerciseScaleRows: buildConditionalExerciseScaleRows(routedRows.overhangBarSegments, routedRows.conditionalSupplyRows),
  };

  const hasVisibleContent = [
    model.statusLabel,
    model.statusValue,
    model.ratioLabel,
    model.ratioValue,
    model.currentValue,
    model.supplyValue,
  ].some(Boolean) || unavailableRows.length > 0 || model.conditionalSupplyRows.length > 0 || model.overhangBarSegments.length > 0;

  return hasVisibleContent ? model : null;
}

function hasRawShareOverhangContent(overhang: Record<string, unknown> | null) {
  if (!overhang) return false;
  const totalNote = readPlainRecord(overhang.total_note);
  if (readPlainRecord(overhang.basis) || recordArray(overhang.rows).length) return true;
  if (totalNote && Object.keys(totalNote).length > 0) return true;
  return [
    overhang.status_value,
    overhang.statusValue,
    overhang.ratio_value,
    overhang.ratioValue,
  ].some((value) => Boolean(cleanDisclosureValue(readDisclosureValue(value))));
}

function readLlmShareOverhangRows(value: unknown): LlmShareOverhangModel["unavailableRows"] {
  return recordArray(value)
    .map((row): LlmShareOverhangFactRow | null => {
      const label = readOverhangString(row, "label");
      const rowValue = readOverhangString(row, "value", "value_text", "valueText");
      if (!label || !rowValue) return null;
      const tone = readOverhangString(row, "tone");
      return {
        key: readOverhangString(row, "key"),
        className: normalizeLlmShareOverhangSegmentClass(readOverhangString(row, "class_name", "className", "role") || label),
        rowRole: normalizeShareOverhangRowRole(readOverhangString(row, "row_role", "rowRole")),
        supplyNature: normalizeShareOverhangSupplyNature(readOverhangString(row, "supply_nature", "supplyNature")),
        supplyType: normalizeShareOverhangSupplyType(readOverhangString(row, "supply_type", "supplyType")),
        countedInRatio: readOverhangBoolean(row, "counted_in_ratio", "countedInRatio"),
        calculationRole: normalizeShareOverhangCalculationRole(readOverhangString(row, "calculation_role", "calculationRole")),
        unit: readOverhangString(row, "unit"),
        classBasis: readOverhangString(row, "class_basis", "classBasis"),
        poolId: readOverhangString(row, "pool_id", "poolId"),
        poolRelationship: normalizeShareOverhangPoolRelationship(readOverhangString(row, "pool_relationship", "poolRelationship")),
        label,
        value: rowValue,
        ...(readOverhangString(row, "note") ? { note: readOverhangString(row, "note") } : {}),
        ...(tone === "danger" || tone === "neutral" ? { tone } : {}),
        numericValue: readOverhangSegmentStructuredAmount(row),
      };
    })
    .filter((row): row is LlmShareOverhangFactRow => row !== null)
    .slice(0, 8);
}

function readLlmShareOverhangRoutedRows(overhang: Record<string, unknown>) {
  const structuredRows = readLlmShareOverhangStructuredRows(overhang);
  if (structuredRows) return structuredRows;

  return { conditionalSupplyRows: [], overhangBarSegments: [] };
}

function readLlmShareOverhangStructuredRows(overhang: Record<string, unknown>) {
  const basis = readLlmShareOverhangBasis(overhang.basis);
  const rows = readLlmShareOverhangRows(overhang.rows);
  if (!basis && !rows.length) return null;

  const candidateSegments = [basis, ...rows.map(structuredRowToSegment)].filter(
    (segment): segment is ShareOverhangBarSegment => Boolean(segment),
  );
  const overhangBarSegments = normalizeLlmShareOverhangSegmentWidths(
    collapseAlternativeShareOverhangSegments(
      candidateSegments.filter(
        (segment) =>
          segment.calculationRole === "denominator" ||
          isCountedInShareOverhangRatio(segment),
      ),
    ),
  );
  const conditionalSupplyRows = rows
    .filter((row) => {
      if (row.calculationRole === "denominator") return false;
      return !isCountedInShareOverhangRatio(row);
    })
    .slice(0, 8);

  return { conditionalSupplyRows, overhangBarSegments };
}

function readLlmShareOverhangBasis(value: unknown): ShareOverhangBarSegment | null {
  const record = readPlainRecord(value);
  if (!record) return null;
  const label = readOverhangString(record, "label");
  const rowValue = readOverhangString(record, "value", "value_text", "valueText");
  if (!label || !rowValue) return null;
  return {
    key: readOverhangString(record, "key") || "share-overhang-basis",
    className: normalizeLlmShareOverhangSegmentClass(readOverhangString(record, "class_name", "className") || "current-base"),
    supplyNature: "base_shares",
    calculationRole: "denominator",
    unit: readOverhangString(record, "unit"),
    classBasis: readOverhangString(record, "class_basis", "classBasis"),
    label,
    value: rowValue,
    ...(readOverhangString(record, "note") ? { note: readOverhangString(record, "note") } : {}),
    numericValue: readOverhangSegmentStructuredAmount(record),
    width: 0,
  };
}

function structuredRowToSegment(row: LlmShareOverhangFactRow): ShareOverhangBarSegment {
  return {
    key: row.key || `llm-share-overhang-row-${row.label}`,
    className: row.className || normalizeLlmShareOverhangSegmentClass(row.label),
    rowRole: row.rowRole,
    supplyNature: row.supplyNature,
    supplyType: row.supplyType,
    countedInRatio: row.countedInRatio,
    calculationRole: row.calculationRole,
    unit: row.unit,
    classBasis: row.classBasis,
    poolId: row.poolId,
    poolRelationship: row.poolRelationship,
    label: row.label,
    value: row.value,
    ...(row.note ? { note: row.note } : {}),
    numericValue: row.numericValue ?? null,
    width: 0,
  };
}

function isCountedInShareOverhangRatio(row: { rowRole?: string; countedInRatio?: boolean; supplyNature?: string }) {
  if (row.rowRole) return row.rowRole === "counted";
  if (typeof row.countedInRatio === "boolean") return row.countedInRatio;
  return (
    row.supplyNature === "current_offering_supply" ||
    row.supplyNature === "registered_resale_supply" ||
    row.supplyNature === "common_equivalent_supply"
  );
}

function normalizeLlmShareOverhangSegmentWidths(segments: ShareOverhangBarSegment[]) {
  if (!segments.length) return [];
  const fallbackWidth = 100 / segments.length;
  const canUseNumericValues = segments.every((segment) => typeof segment.numericValue === "number" && segment.numericValue > 0);
  const displaySegments = segments.map((segment) => {
    const width = canUseNumericValues ? segment.numericValue || 0 : fallbackWidth;
    return {
      ...segment,
      width,
      compact: width < 24 || segment.label.length > 28,
    };
  });
  const totalWidth = displaySegments.reduce((total, segment) => total + segment.width, 0);
  if (totalWidth <= 0) return displaySegments;
  return displaySegments.map((segment) => {
    const width = (segment.width / totalWidth) * 100;
    return {
      ...segment,
      width,
      compact: width < 24 || segment.label.length > 28,
    };
  });
}

function normalizeShareOverhangSupplyNature(value: string): ShareOverhangSupplyNature | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "base_shares" ||
    normalized === "current_offering_supply" ||
    normalized === "registered_resale_supply" ||
    normalized === "common_equivalent_supply" ||
    normalized === "conditional_future_supply" ||
    normalized === "replacement_supply"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeShareOverhangRowRole(value: string): ShareOverhangRowRole | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "counted" ||
    normalized === "conditional" ||
    normalized === "alternative" ||
    normalized === "reference"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeShareOverhangSupplyType(value: string): ShareOverhangSupplyType | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "current_offering_pool" ||
    normalized === "registered_resale_pool" ||
    normalized === "share_equivalent" ||
    normalized === "future_exercise" ||
    normalized === "replacement_alternative" ||
    normalized === "atm_capacity" ||
    normalized === "shelf_capacity" ||
    normalized === "public_float" ||
    normalized === "market_cap" ||
    normalized === "market_value"
  ) {
    return normalized;
  }
  if (
    normalized === "market_value_at_last_sale_price" ||
    normalized === "market_value_last_sale" ||
    normalized === "last_sale_market_value"
  ) {
    return "market_value";
  }
  return undefined;
}

function normalizeShareOverhangCalculationRole(value: string): ShareOverhangCalculationRole | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "denominator" ||
    normalized === "headline_numerator" ||
    normalized === "visible_excluded" ||
    normalized === "note_only"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeShareOverhangPoolRelationship(value: string): ShareOverhangPoolRelationship | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "alternative_max" || normalized === "additive") return normalized;
  return undefined;
}

function readOverhangSegmentStructuredAmount(record: Record<string, unknown>) {
  for (const key of ["numeric_value", "numericValue", "amount", "share_count", "shareCount"]) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = readRowNumber(record, key);
    return value > 0 ? value : null;
  }
  return undefined;
}

function readOverhangString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = cleanDisclosureValue(readDisclosureValue(record[key]) || readRowString(record, key));
    if (value) return value;
  }
  return "";
}

function readOverhangBoolean(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

function normalizeShareOverhangTotalNoteRecord(record: Record<string, unknown>) {
  const rawTitle = readOverhangString(record, "title", "label");
  const splitTitle = splitShareOverhangTotalNoteTitle(rawTitle);
  if (!splitTitle) return record;
  return {
    ...record,
    title: splitTitle.title || rawTitle,
    numerator: readOverhangString(record, "numerator") || splitTitle.numerator,
    denominator: readOverhangString(record, "denominator") || splitTitle.denominator,
    ratio: readOverhangString(record, "ratio") || splitTitle.ratio,
    suffix: readOverhangString(record, "suffix", "note") || splitTitle.suffix,
  };
}

function splitShareOverhangTotalNoteTitle(value: string) {
  const text = cleanDisclosureValue(value).replace(/\s+/g, " ");
  if (!text || !text.includes("/") || !text.includes("=")) return null;
  const formulaPattern = "((?:Up to\\s+)?[~$]?\\d[\\d,.]*(?:\\s*[MBK])?(?:\\s+[^/=]+?)?)\\s*/\\s*([^=]+?)\\s*=\\s*([\\d,.]+\\s*%)(?:\\s+(.+))?$";
  const titledMatch = text.match(new RegExp(`^(.+?):\\s*${formulaPattern}`, "i"));
  const directMatch = titledMatch ? null : text.match(new RegExp(`^${formulaPattern}`, "i"));
  const match = titledMatch || directMatch;
  if (!match) return null;
  const titlePart = titledMatch ? match[1] : "";
  const numerator = titledMatch ? match[2] : match[1];
  const denominator = titledMatch ? match[3] : match[2];
  const ratio = titledMatch ? match[4] : match[3];
  const suffixText = titledMatch ? match[5] : match[4];
  const condition = titlePart.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
  const title = cleanDisclosureValue(titlePart.replace(/\s*\([^)]*\)/g, "")) || "Total Potential Supply";
  return {
    title,
    numerator: cleanDisclosureValue(numerator),
    denominator: cleanDisclosureValue(denominator),
    ratio: cleanDisclosureValue(ratio),
    suffix: cleanDisclosureValue(suffixText) || condition,
  };
}

function normalizeLlmShareOverhangSegmentClass(value: string) {
  const text = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  const explicit = text.replace(/\s+/g, "-");
  if (["current-base", "registered-supply", "warrant", "conversion", "prefunded"].includes(explicit)) {
    return explicit;
  }
  if (/\bcurrent|outstanding|base|denominator\b/.test(text)) return "current-base";
  if (/\bpre funded|prefunded\b/.test(text)) return "prefunded";
  if (/\bwarrants?\b/.test(text)) return "warrant";
  if (/\bconvert|notes?|preferred\b/.test(text)) return "conversion";
  return "registered-supply";
}

function readSnapshotMetrics(model: Record<string, unknown> | null): DilutionMetricItem[] {
  return recordArray(model?.snapshot_metrics)
    .map((item): DilutionMetricItem | null => {
      const label = cleanDisclosureValue(readRowString(item, "label"));
      const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      if (!label || !value) return null;
      const tone = cleanDisclosureValue(readRowString(item, "tone"));
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      return {
        label,
        value,
        ...(note ? { note } : {}),
        emphasis: item.emphasis === true,
        tone: tone === "danger" || tone === "positive" || tone === "neutral" ? tone : "neutral",
      };
    })
    .filter((item): item is DilutionMetricItem => Boolean(item))
    .slice(0, 4);
}

const S8_CONTEXT_DETAIL_LABELS = new Set([
  "Parent filing",
  "Parent plan shares",
  "Reoffer subset",
  "Relationship",
  "Company proceeds",
  "Selling holders",
  "What changed",
  "What did not change",
]);

function readS8ContextDetailRows(
  displayPayloadData: Record<string, unknown> | null,
  llmDisplayModel: Record<string, unknown> | null,
): DilutionDisclosureRow[] {
  const sourceRows = recordArray(displayPayloadData?.s8_context_details).length
    ? recordArray(displayPayloadData?.s8_context_details)
    : recordArray(llmDisplayModel?.s8_context_details);

  return sourceRows
    .map((item) => {
      const label = cleanDisclosureValue(readRowString(item, "label"));
      const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      if (!S8_CONTEXT_DETAIL_LABELS.has(label) || !isDisclosedValue(value)) return null;
      return { label, value };
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item))
    .slice(0, 6);
}

function buildS8SnapshotMetricItems({
  currentSharesNote,
  currentSharesValue,
  dilutionRatioValue,
  displayLabels,
  displayPayloadData,
  llmDisplayModel,
  parentPlanSharesValue,
  potentialSupplyValue,
  reofferResaleSharesValue,
  s8UiMode,
}: {
  currentSharesNote: string;
  currentSharesValue: string;
  dilutionRatioValue: string;
  displayLabels: {
    ratioMetricNote: string;
    supplyMetricNote: string;
  };
  displayPayloadData: Record<string, unknown> | null;
  llmDisplayModel: Record<string, unknown> | null;
  parentPlanSharesValue: string;
  potentialSupplyValue: string;
  reofferResaleSharesValue: string;
  s8UiMode: string;
}): DilutionMetricItem[] {
  const metric = (label: string, value: string, note = "", emphasis = false): DilutionMetricItem | null =>
    isDisclosedValue(value) ? { label, value, ...(note ? { note } : {}), emphasis, tone: "neutral" } : null;
  const first = (...keys: string[]) => readS8MetricValue(displayPayloadData, llmDisplayModel, keys);
  const firstOptionalMetric = (...items: Array<DilutionMetricItem | null>) => items.find(Boolean) || null;
  const planName = first("plan_name", "planName", "plan_names", "planNames");
  const planType = first("plan_type", "planType", "normalized_s8_type", "normalizedS8Type");
  const vestingPeriod = first("vesting_period", "vestingPeriod", "vesting_schedule", "vestingSchedule");
  const immediateDilution = first("immediate_dilution", "immediateDilution") || "Future grants/exercises";
  const awardType = first("award_type", "awardType", "inducement_award_type", "inducementAwardType");
  const grantDate = first("grant_date", "grantDate", "granted_at", "grantedAt");
  const recipientCount = first("recipient_count", "recipientCount", "employee_count", "employeeCount");
  const sellingHolders = first("selling_holders", "sellingHolders", "selling_securityholders", "sellingSecurityholders");
  const amendmentStatus = first("amendment_status", "amendmentStatus") || (s8UiMode === "post_effective_amendment" ? "Post-effective amendment" : "");
  const additionalShares = first("additional_shares", "additionalShares") || potentialSupplyValue;
  const priorShares = first("prior_shares_carried_forward", "priorSharesCarriedForward", "parent_registered_shares", "parentRegisteredShares");
  const removedShares = first("remaining_plan_shares_removed", "remainingPlanSharesRemoved", "deregistered_shares", "deregisteredShares");

  const baseCurrent = metric("Shares Outstanding", currentSharesValue, currentSharesNote || "Share count used as the comparison base.");

  if (s8UiMode === "reoffer_resale") {
    const parentPlanShares =
      parentPlanSharesValue ||
      first(
        "parent_plan_registered_shares",
        "parentPlanRegisteredShares",
        "parent_s8_registered_shares",
        "parentS8RegisteredShares",
        "parent_registered_shares",
        "parentRegisteredShares",
        "prior_plan_registered_shares",
        "priorPlanRegisteredShares",
      );
    const reofferShares =
      reofferResaleSharesValue ||
      first("reoffer_resale_shares", "reofferResaleShares", "reoffer_shares", "reofferShares", "resale_shares", "resaleShares") ||
      potentialSupplyValue;
    const parentPlanRatio = formatS8ShareRatio(parentPlanShares, currentSharesValue);
    const reofferVsCurrentRatio = formatS8ShareRatio(reofferShares, currentSharesValue);
    const reofferVsParentRatio = formatS8ShareRatio(reofferShares, parentPlanShares);
    const reofferNote = [reofferVsParentRatio ? `${reofferVsParentRatio} of parent plan` : "", reofferVsCurrentRatio ? `${reofferVsCurrentRatio} of current shares` : ""]
      .filter(Boolean)
      .join("; ");
    const parentPlanRatioNote = [
      "Original S-8 plan shares compared with shares outstanding.",
      reofferVsParentRatio ? `Reoffer subset is ${reofferVsParentRatio} of parent plan.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (isDisclosedValue(parentPlanShares)) {
      return [
        baseCurrent,
        metric("Parent plan shares", parentPlanShares, "Shares registered by the original S-8 plan.", true),
        metric("Reoffer subset", reofferShares, reofferNote ? `POS resale subset; ${reofferNote}.` : "POS resale subset from the parent plan."),
        metric("Parent Plan / Outstanding", parentPlanRatio, parentPlanRatioNote),
      ].filter((item): item is DilutionMetricItem => Boolean(item)).slice(0, 4);
    }

    return [
      baseCurrent,
      metric("Reoffer resale shares", reofferShares, "Shares covered by the reoffer prospectus.", true),
      metric("Resale Shares / Outstanding", dilutionRatioValue, "Reoffer resale shares compared with current shares."),
      firstOptionalMetric(
        metric("Selling Holders", sellingHolders, "Named holders when disclosed."),
        metric("Plan Name", planName, "Plan tied to the resale registration."),
        metric("Vesting Period", vestingPeriod, "Source-backed vesting schedule."),
      ),
    ].filter((item): item is DilutionMetricItem => Boolean(item)).slice(0, 4);
  }

  if (s8UiMode === "post_effective_amendment") {
    return [
      metric("Amendment Status", amendmentStatus, "S-8 amendment context.", true),
      metric("Additional Shares", additionalShares, displayLabels.supplyMetricNote),
      metric("Prior Shares Carried Forward", priorShares, "Prior registration context when supplied."),
      firstOptionalMetric(
        metric("Remaining Plan Shares Removed", removedShares, "Unsold plan shares removed when disclosed."),
        metric("Plan Name", planName, "Plan affected by the amendment."),
      ),
    ].filter((item): item is DilutionMetricItem => Boolean(item)).slice(0, 4);
  }

  if (s8UiMode === "inducement_awards") {
    return [
      baseCurrent,
      metric("Registered inducement shares", potentialSupplyValue, displayLabels.supplyMetricNote, true),
      metric("Inducement Shares / Outstanding", dilutionRatioValue, displayLabels.ratioMetricNote),
      firstOptionalMetric(
        metric("Award Type", awardType, "Source-backed award type."),
        metric("Grant Date", grantDate, "Grant date stated in the filing."),
        metric("Recipient Count", recipientCount, "Recipient count stated in the filing."),
        metric("Vesting Period", vestingPeriod, "Source-backed vesting schedule."),
      ),
    ].filter((item): item is DilutionMetricItem => Boolean(item)).slice(0, 4);
  }

  return [
    baseCurrent,
    metric("Registered plan shares", potentialSupplyValue, displayLabels.supplyMetricNote, true),
    metric("Plan Shares / Outstanding", dilutionRatioValue, displayLabels.ratioMetricNote),
    firstOptionalMetric(
      metric("Plan Name", planName, "Plan named in the filing."),
      metric("Vesting Period", vestingPeriod, "Source-backed vesting schedule."),
      metric("Plan Type", planType, "Plan category stated or clearly indicated."),
      metric("Immediate Dilution", immediateDilution, "Registration alone does not issue all shares immediately."),
    ),
  ].filter((item): item is DilutionMetricItem => Boolean(item)).slice(0, 4);
}

function readS8MetricValue(
  displayPayloadData: Record<string, unknown> | null,
  llmDisplayModel: Record<string, unknown> | null,
  keys: string[],
) {
  for (const model of [displayPayloadData, llmDisplayModel]) {
    if (!model) continue;
    for (const key of keys) {
      const value = model[key];
      const normalized = normalizeS8MetricValue(value);
      if (normalized) return normalized;
    }
  }
  return "";
}

function normalizeS8MetricValue(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeS8MetricValue(item))
      .filter(Boolean);
    if (items.length <= 2) return items.join(", ");
    return `${items.slice(0, 2).join(", ")} + others`;
  }
  const record = readPlainRecord(value);
  if (record) {
    return (
      cleanDisclosureValue(
        readDisclosureValue(record.value) ||
          readRowString(record, "name") ||
          readRowString(record, "planName") ||
          readRowString(record, "plan_name") ||
          readRowString(record, "label") ||
          readRowString(record, "text"),
      ) || ""
    );
  }
  return cleanDisclosureValue(readDisclosureValue(value) || String(value ?? ""));
}

function readOfferingDetailsRows(model: Record<string, unknown> | null): DilutionDisclosureRow[] {
  return recordArray(model?.offering_details)
    .map((item) => {
      const label = normalizeOfferingDetailLabel(readRowString(item, "label"));
      const rawValue = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      const value = normalizeOfferingDetailValue(label, rawValue);
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      return label && isDisclosedValue(value) ? { label, value, ...(isDisclosedValue(note) ? { note } : {}) } : null;
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item));
}

function readS3AmendmentChangeRows(
  displayPayloadData: Record<string, unknown> | null,
  llmDisplayModel: Record<string, unknown> | null,
): DilutionDisclosureRow[] {
  const sourceRows = recordArray(displayPayloadData?.amendment_changes).length
    ? recordArray(displayPayloadData?.amendment_changes)
    : recordArray(llmDisplayModel?.amendment_changes);

  return sourceRows
    .map((item) => {
      const label = cleanDisclosureValue(readRowString(item, "label")).slice(0, 42);
      const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      if (!label || !isDisclosedValue(value)) return null;
      const compactValue = compactS3AmendmentValue(value);
      const compactNote = compactS3AmendmentNote(note);
      if (!isUsefulS3AmendmentChange(label, compactValue, compactNote)) return null;
      return { label, value: compactValue, ...(compactNote ? { note: compactNote } : {}) };
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item))
    .slice(0, 6);
}

function isUsefulS3AmendmentChange(label: string, value: string, note: string) {
  const combined = `${label} ${value} ${note}`;
  if (/\b(?:core terms unchanged|no economic change)\b/i.test(label)) return false;
  if (/^(?:updated|revised|filed|added|amended|corrected)$/i.test(value)) return false;
  if (/\b(?:updated section|updated list|general updates?|miscellaneous|key terms)\b/i.test(combined)) return false;
  if (/documents? incorporated/i.test(label)) {
    return /\b(?:Form\s+(?:10-K|10-Q|8-K|20-F|6-K|S-3|S-1|F-3|F-1)|annual report|quarterly report|current report|proxy statement|fiscal year|year ended|quarter ended)\b/i.test(
      combined,
    );
  }
  return true;
}

function compactS3AmendmentValue(value: string) {
  const normalized = cleanDisclosureValue(value)
    .replace(/\s+changed\s+from\s+/i, " ")
    .replace(/\s+to\s+/i, " -> ");
  return normalized.length > 120 ? `${normalized.slice(0, 117).trim()}...` : normalized;
}

function compactS3AmendmentNote(value: string) {
  const normalized = compactS3AmendmentValue(value);
  if (/^(?:updated|revised|filed|added|amended|corrected)(?:\s+in\s+this\s+amendment)?$/i.test(normalized)) return "";
  if (/^(?:current filing|this amendment)$/i.test(normalized)) return "";
  return normalized;
}

function readInstrumentDetailsArray(model: Record<string, unknown> | null) {
  return recordArray(model?.instrument_details);
}

function readWarrantDetailsRows(model: Record<string, unknown> | null): DilutionDisclosureRow[] {
  const allowed = new Set([
    "Type",
    "Shares / Securities",
    "Exercise / Conversion Price",
    "Reset / Floor",
    "Term / Limits",
    "Underlying Shares",
    "Exercise Price",
    "Exercise Status",
  ]);
  const rows = readInstrumentDetailsArray(model)
    .map((item) => {
      const label = cleanDisclosureValue(readRowString(item, "label"));
      const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      return label && allowed.has(label) && isDisclosedValue(value) ? { label, value, ...(isDisclosedValue(note) ? { note } : {}) } : null;
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item));

  return rows.filter((row) => row.label !== "Type").length ? rows.slice(0, 4) : [];
}

function readWarrantInstrumentRows(model: Record<string, unknown> | null) {
  const rows = readRawWarrantDetailRows(model);
  const typeCount = rows.filter((row) => row.label === "Type").length;
  if (typeCount < 1) return [];

  const groups: Array<{ type: string; rows: Map<string, string> }> = [];
  let current: { type: string; rows: Map<string, string> } | null = null;

  for (const row of rows) {
    if (row.label === "Type") {
      current = { type: row.value, rows: new Map() };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    current.rows.set(row.label, row.value);
  }

  return groups
    .map((group) => ({
      type: shortWarrantTypeLabel(group.type),
      sharesSecurities: compactInstrumentSharesValue(group.rows.get("Shares / Securities") || group.rows.get("Underlying Shares") || ""),
      exerciseConversionPrice: compactInstrumentPriceValue(
        group.rows.get("Exercise / Conversion Price") ||
          group.rows.get("Exercise Price") ||
          group.rows.get("Conversion Price") ||
          "",
      ),
      resetFloor: compactInstrumentResetFloorValue(
        group.rows.get("Reset / Floor") || group.rows.get("Reset / Repricing") || group.rows.get("Floor Price") || "",
      ),
      termLimits: compactInstrumentTermLimitsValue(group.rows.get("Term / Limits") || group.rows.get("Exercise Status") || ""),
    }))
    .filter((row) => row.type && (row.sharesSecurities || row.exerciseConversionPrice || row.resetFloor || row.termLimits))
    .slice(0, 7);
}

function readDisplayInstrumentPriceGroups(model: Record<string, unknown> | null): Array<{ type: string; price: string; shares?: string }> {
  return readInstrumentPriceGroups(readRawWarrantDetailRows(model));
}

function readDisplayInstrumentPriceSummary(model: Record<string, unknown> | null) {
  const detailPriceGroups = readDisplayInstrumentPriceGroups(model);
  const selectedGroup = selectSnapshotInstrumentPriceGroup(detailPriceGroups);
  if (selectedGroup?.price) return selectedGroup.price;

  const firstDetailPrice = detailPriceGroups.find((group) => group.price)?.price;
  return firstDetailPrice || "";
}

function buildSnapshotInstrumentPriceMetric({
  fallbackValue,
  hasConvertibles,
  hasWarrants,
  priceGroups,
}: {
  fallbackValue: string;
  hasConvertibles: boolean;
  hasWarrants: boolean;
  priceGroups: Array<{ type: string; price: string }>;
}) {
  const selectedGroup = selectSnapshotInstrumentPriceGroup(priceGroups);
  const family = selectedGroup ? classifyInstrumentPriceFamily(selectedGroup.type) : hasConvertibles ? "conversion" : hasWarrants ? "warrant" : "other";
  const value = selectedGroup?.price || fallbackValue || "Not stated";
  const families = new Set(priceGroups.map((group) => classifyInstrumentPriceFamily(group.type)).filter((item) => item !== "other"));
  const hasMixedPrices = families.size > 1 || priceGroups.length > 1;

  if (family === "conversion") {
    return {
      label: hasMixedPrices ? "Key conversion price" : "Conversion price",
      note: hasMixedPrices ? "Other instrument prices are shown below." : "Source-backed conversion price.",
      value,
    };
  }

  if (family === "warrant") {
    return {
      label: hasMixedPrices ? "Key exercise price" : "Exercise price",
      note: hasMixedPrices ? "Other instrument prices are shown below." : "Source-backed exercise price.",
      value,
    };
  }

  return {
    label: hasMixedPrices ? "Key instrument price" : "Instrument price",
    note: hasMixedPrices ? "Other instrument prices are shown below." : "Source-backed instrument price.",
    value,
  };
}

function selectSnapshotInstrumentPriceGroup(groups: Array<{ type: string; price: string }>) {
  return (
    groups.find((group) => classifyInstrumentPriceFamily(group.type) === "conversion") ||
    groups.find((group) => classifyInstrumentPriceFamily(group.type) === "warrant") ||
    groups.find((group) => group.price)
  );
}

function classifyInstrumentPriceFamily(type: string) {
  const normalized = type.toLowerCase();
  if (/\b(?:convertible|conversion|debenture|note)\b/.test(normalized)) return "conversion";
  if (/\bwarrant\b/.test(normalized)) return "warrant";
  if (/\bright\b/.test(normalized)) return "right";
  if (/\bunit\b/.test(normalized)) return "unit";
  return "other";
}

function readInstrumentPriceGroups(rows: DilutionDisclosureRow[]) {
  const groups: Array<{ type: string; price: string; shares?: string }> = [];
  let currentType = "";

  for (const row of rows) {
    if (row.label === "Type") {
      currentType = row.value;
      groups.push({ type: currentType, price: "" });
      continue;
    }
    if (/^(?:Shares \/ Securities|Underlying Shares)$/i.test(row.label) && groups.length) {
      const currentGroup = groups[groups.length - 1];
      currentGroup.shares = row.value;
      continue;
    }
    if (!/^(?:Exercise \/ Conversion Price|Exercise Price|Conversion Price)$/i.test(row.label)) continue;
    const price = compactInstrumentPriceValue(row.value);
    if (!price) continue;
    if (!groups.length) {
      groups.push({ type: currentType, price });
      continue;
    }
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup.price) {
      currentGroup.price = price;
    }
  }

  return groups.filter((group) => group.price);
}

function readDisplayInstrumentPriceByType(model: Record<string, unknown> | null, typePattern: RegExp) {
  const rows = readRawWarrantDetailRows(model);
  let currentType = "";

  for (const row of rows) {
    if (row.label === "Type") {
      currentType = row.value;
      continue;
    }
    if (/^(?:Exercise \/ Conversion Price|Exercise Price|Conversion Price)$/i.test(row.label) && typePattern.test(currentType)) {
      return compactInstrumentPriceValue(row.value);
    }
  }

  return "";
}

function compactInstrumentSharesValue(value: string) {
  const text = cleanDisclosureValue(value);
  if (!text) return "";

  const principal = text.match(/up to\s+\$[\d,.]+\s*(?:million|billion|m|bn)?\s+principal(?:\s+amount)?/i)?.[0];
  const shares = text.match(/(?:convertible into\s+)?up to\s+[\d,.]+\s+(?:ordinary|common)?\s*shares/i)?.[0];
  if (principal && shares) return `${principal.replace(/\s+amount$/i, "")} / ${shares.replace(/^convertible into\s+/i, "")}`;

  return text
    .replace(/\s*\([^)]*basis[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactInstrumentPriceValue(value: string) {
  const text = cleanDisclosureValue(value);
  if (!text) return "";

  const initial = text.match(/\binitial\s+(\$[\d,.]+(?:\/share)?)/i)?.[1];
  const alternate = text.match(/\balternate conversion price\s+(\$[\d,.]+(?:\/share)?)/i)?.[1];
  if (initial && alternate) return `Initial conversion: ${initial}\nAlternate conversion: ${alternate}`;

  return text
    .replace(/;\s*\$[\d,.]+(?:\/share)?,?\s+subject to adjustments\.?/gi, "")
    .replace(/;\s*variable pricing for installment payments\s*\([^)]*\)\.?/gi, "")
    .replace(/,\s*subject to adjustments\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactInstrumentResetFloorValue(value: string) {
  const text = cleanDisclosureValue(value);
  if (!text) return "";
  const vwap = text.match(/(?:80% or 95%|95% or 80%)\s+of\s+VWAP/i)?.[0];
  if (vwap) return `Installments: ${vwap}`;
  return text
    .replace(/\bmonthly installment payments are based on a variable formula\s*/i, "Installments: ")
    .replace(/,\s*and the Notes can be converted at an Alternate Conversion Price\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactInstrumentTermLimitsValue(value: string) {
  const text = cleanDisclosureValue(value);
  if (!text) return "";
  const maturity = text.match(/\bmatures?\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}/i)?.[0];
  const ownershipCap = text.match(/\d+(?:\.\d+)?%\s+beneficial ownership limitation/i)?.[0];
  return [maturity, ownershipCap].filter(Boolean).join("; ") || text.replace(/;\s*monthly installment payments starting[^.;]+/i, "").trim();
}

function readRawWarrantDetailRows(model: Record<string, unknown> | null): DilutionDisclosureRow[] {
  const allowed = new Set([
    "Type",
    "Shares / Securities",
    "Exercise / Conversion Price",
    "Reset / Floor",
    "Term / Limits",
    "Underlying Shares",
    "Exercise Price",
    "Conversion Price",
    "Reset / Repricing",
    "Floor Price",
    "Exercise Status",
  ]);
  return readInstrumentDetailsArray(model)
    .map((item) => {
      const label = cleanDisclosureValue(readRowString(item, "label"));
      const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
      const note = cleanDisclosureValue(readDisclosureValue(item.note) || readRowString(item, "note"));
      return label && allowed.has(label) && isDisclosedValue(value) ? { label, value, ...(isDisclosedValue(note) ? { note } : {}) } : null;
    })
    .filter((item): item is DilutionDisclosureRow => Boolean(item));
}

function shortWarrantTypeLabel(value: string) {
  const normalized = value.toLowerCase();
  const groupedSeries = normalizeGroupedSeriesLabel(value);
  if (groupedSeries && /\bwarrants?\b/i.test(value)) return `${groupedSeries} warrants`;
  const series = value.match(/\bseries\s+[a-z0-9]+\b/i)?.[0];
  if (/pre[-\s]?funded/.test(normalized)) return series ? `${series} pre-funded warrant` : "Pre-funded warrant";
  if (/placement agent|underwriter|agent/.test(normalized)) return series ? `${series} placement agent warrant` : "Placement agent warrant";
  if (/\bcommon\b/.test(normalized) && /\bwarrants?\b/.test(normalized)) return series ? `${series} common warrant` : "Common warrant";
  if (series && /\bwarrants?\b/i.test(value)) return `${series} warrant`;
  if (series) return series;
  return value;
}

function normalizeGroupedSeriesLabel(value: string) {
  const match = value.match(/\bseries\s+[a-z0-9]+(?:\s*(?:\/|&|\band\b)\s*(?:series\s+)?[a-z0-9]+)+/i)?.[0];
  if (!match) return "";
  return match
    .replace(/\s+/g, " ")
    .replace(/\bseries\b/gi, "Series")
    .replace(/\s+and\s+/gi, " & ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\bSeries\s+([A-Za-z0-9]+)\s*([/&])\s*(?:Series\s+)?([A-Za-z0-9]+)\b/g, "Series $1$2$3")
    .replace(/\bSeries\s+([A-Za-z0-9]+)\s*&\s*(?:Series\s+)?([A-Za-z0-9]+)\b/g, "Series $1 & $2")
    .trim();
}

function normalizeOfferingDetailLabel(value: string | null | undefined) {
  const label = cleanDisclosureValue(value);
  if (label === "Sale Price to Purchaser" || label === "Pricing Formula") return "Sale Price";
  if (label === "Related Private Placement / Purchase Agreement Date") return "Agreement Date";
  return label;
}

function normalizeOfferingDetailValue(label: string, value: string) {
  const normalized = cleanDisclosureValue(value);
  if (label === "Offering Type" && /\bconvertible\b/i.test(normalized) && /\bnotes?\b/i.test(normalized)) {
    return "Convertible promissory notes";
  }
  return normalized;
}

function formatResaleCompanyProceedsValue(value: string) {
  return cleanDisclosureValue(value)
    .replace(/\s*\((?:from|under|via)\s+(?:ELOC|equity line|purchase agreement)[^)]+\)/gi, "")
    .replace(/\$([\d,.]+)\s+million\b/gi, "$$$1M")
    .replace(/\$([\d,.]+)\s+billion\b/gi, "$$$1B")
    .replace(/\s+/g, " ")
    .trim();
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
      !normalized.startsWith("not disclosed") &&
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

function cleanCompanyCashDisclosure(value: string) {
  const cleaned = cleanDisclosureValue(value);
  if (!isDisclosedValue(cleaned)) return "";
  if (
    /\b(?:fee[-\s]?table|registration value|maximum aggregate offering price|total offering amounts?|sec fee|filing fee)\b/i.test(cleaned) ||
    /\bshelf capacity\b/i.test(cleaned) ||
    /^future takedown$/i.test(cleaned)
  ) {
    return "";
  }
  return cleaned;
}

function buildCompanyProceedsValue({
  closingNetProceedsValue,
  isAtm,
  isResale,
  offeringAmount,
  useOfProceeds,
}: {
  closingNetProceedsValue: string;
  isAtm: boolean;
  isResale: boolean;
  offeringAmount: string;
  useOfProceeds: string;
}) {
  if (isDisclosedValue(closingNetProceedsValue)) return closingNetProceedsValue;
  const cleanOfferingAmount = cleanCompanyCashDisclosure(offeringAmount);
  if (isAtm) return cleanOfferingAmount || "The total amount is not fixed yet.";
  if (isResale) return "No money goes to the company.";
  if (cleanOfferingAmount) return cleanOfferingAmount;
  if (isDisclosedValue(useOfProceeds)) return "No specific amount is listed.";
  return "No money details were found.";
}

function findMoneyAmount(sourceText: string) {
  return (
    sourceText.match(/\b(?:up to|maximum aggregate(?: offering)? price of|aggregate(?: offering)? price of|gross proceeds of|net proceeds of|offering amount of)\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\b(?:gross|net)\s+proceeds\s+(?:were|are|will be|of)?\s*(?:approximately)?\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
}

function findAtmProgramSize(sourceText: string) {
  const value =
    sourceText.match(/\baggregate offering price of up to\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\b(?:may|can)\s+offer\s+and\s+sell\b[^.\n]{0,180}?\bup to\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\bat-the-market\b[^.\n]{0,220}?\bup to\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    "";

  return value ? `Up to ${value}` : "";
}

function findShelfCapacity(sourceText: string) {
  return (
    sourceText.match(/\b(?:shelf registration|shelf registration statement|registration statement)\b[^.]{0,220}?\b(?:up to|not to exceed|aggregate(?: initial)? offering price(?: of)?|maximum aggregate(?: offering)? price(?: of)?)\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\b(?:we may offer and sell|may offer and sell|may sell)\b[^.]{0,160}?\b(?:up to|not to exceed)\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
}

function findShelfSecuritiesCovered(sourceText: string) {
  const securities = [
    /\bclass [a-z] common stock\b|\bcommon stock\b/i.test(sourceText) ? "Common stock" : "",
    /\bpreferred stock\b/i.test(sourceText) ? "Preferred stock" : "",
    /\bdebt securities\b|\bnotes\b/i.test(sourceText) ? "Debt securities" : "",
    /\bwarrants?\b/i.test(sourceText) ? "Warrants" : "",
    /\bunits?\b/i.test(sourceText) ? "Units" : "",
    /\brights?\b/i.test(sourceText) ? "Rights" : "",
  ].filter(Boolean);

  return Array.from(new Set(securities)).slice(0, 5).join(", ");
}

function isMoneyDisclosure(value: string) {
  const text = cleanDisclosureValue(value);
  return Boolean(/\$/.test(text) || /\b(?:usd|dollars?|million|billion|m|bn)\b/i.test(text)) && !/\bshares?\b/i.test(text);
}

function normalizePositiveShelfMoney(value: string) {
  const text = cleanDisclosureValue(value);
  if (!text || !isMoneyDisclosure(text)) return "";
  return parseMoneyValue(text) > 0 ? text : "";
}

function isShareDisclosure(value: string) {
  const text = cleanDisclosureValue(value);
  return Boolean(/\b(?:shares?|common stock|ordinary shares|ADSs?|units)\b/i.test(text)) && !/\$/.test(text);
}

function findSalesAgent(sourceText: string) {
  const salesAgent =
    sourceText.match(/\b(?:sales agreement with|with|through|by)\s+([A-Z][A-Za-z0-9&.,\-\s]+?(?:Securities|Capital|Markets|Partners|LLC|Inc\.?))/)?.[1]?.trim() ||
    "";

  return /\bOTC Markets\b/i.test(salesAgent) ? "" : salesAgent;
}

function findAtmFeeCommission(sourceText: string) {
  const percent =
    sourceText.match(/\b(?:commission|compensation|fee)\b[\s\S]{0,260}?\b(?:up to\s+)?(\d+(?:\.\d+)?%)\s+of\s+(?:the\s+)?gross\s+(?:sales\s+price|proceeds|offering proceeds|sales proceeds)\b/i)?.[1] ||
    sourceText.match(/\b(?:commission|compensation|fee)\b[^.\n]{0,120}?\b(?:up to\s+)?(\d+(?:\.\d+)?%)\b[^.\n]{0,80}?\bgross\s+(?:sales\s+price|proceeds|offering proceeds|sales proceeds)\b/i)?.[1] ||
    "";

  return percent ? `${percent} of gross sales/proceeds` : "";
}

function findAtmAgreementDate(sourceText: string) {
  const match =
    sourceText.match(/\bsales agreement\b[^.\n]{0,120}?\bdated\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})/i) ||
    sourceText.match(/\bdated\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})[^.\n]{0,120}?\bsales agreement\b/i);

  return cleanDisclosureValue(match?.[1] || "");
}

function findAtmEndDate(sourceText: string) {
  const match =
    sourceText.match(/\b(?:sales agreement|offering|program)\b[^.\n]{0,160}?\b(?:expires?|terminates?|ends?)\s+(?:on\s+)?([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})/i) ||
    sourceText.match(/\b(?:expiration|termination|end) date\b[^.\n]{0,80}?([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})/i);

  return cleanDisclosureValue(match?.[1] || "");
}

function findOfferingAgreementDate(sourceText: string) {
  const match =
    sourceText.match(/\b(?:securities purchase agreement|subscription agreement|underwriting agreement|placement agency agreement)\b[^.\n]{0,160}?\bdated\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})/i) ||
    sourceText.match(/\bdated\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+20\d{2})[^.\n]{0,160}?\b(?:securities purchase agreement|subscription agreement|underwriting agreement|placement agency agreement)\b/i);

  return cleanDisclosureValue(match?.[1] || "");
}

function findPurchaserInvestor(sourceText: string) {
  if (/\bcertain institutional investors\b/i.test(sourceText)) return "Certain institutional investors";
  if (/\baccredited investors\b/i.test(sourceText)) return "Accredited investors";
  if (/\bpurchasers?\b[^.\n]{0,80}?\bnamed in\b/i.test(sourceText)) return "Named purchasers";

  const match = sourceText.match(
    /\b(?:securities purchase agreement|subscription agreement)\s+with\s+([A-Z][A-Za-z0-9&.,'\-\s]+?)(?:\s+(?:for|to purchase|relating to|pursuant to)|[.;])/i,
  );
  const value = cleanDisclosureValue(match?.[1] || "");

  return value.length > 80 || /\b(?:the company|we|us|our)\b/i.test(value) ? "" : value;
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
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
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
  const explicitLabel = cleanDisclosureValue(label);
  if (explicitLabel) return explicitLabel;

  const text = explicitLabel.toLowerCase();
  if (/registered|shelf/.test(text)) return "Registered shelf shares";
  if (/resale/.test(text)) return "Registered resale shares";
  if (/pre[-_\s]?funded/.test(text)) return "Pre-funded warrants";
  if (/warrant/.test(text)) return "Warrants";
  if (/preferred/.test(text)) return "Preferred stock";
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
  return `${Math.round(value).toLocaleString("en-US")} shares`;
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

  return formatDilutionPercentFromCounts(offered, current) || "Not disclosed";
}

function formatDilutionPercentFromCounts(offered: number, current: number) {
  if (!Number.isFinite(offered) || !Number.isFinite(current) || offered <= 0 || current <= 0) return "";
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

function buildDilutionFollowUpParagraph(nextTrigger: string) {
  const trigger = cleanDisclosureValue(nextTrigger);
  if (!isDisclosedValue(trigger)) return "";
  if (/^(?:confirm|review|check|monitor|watch)\b/i.test(trigger)) {
    return `The unresolved variable is ${trigger.replace(/^(?:confirm|review|check|monitor|watch)\s+/i, "")}.`;
  }

  return `The key follow-up variable is ${trigger}.`;
}

function buildShelfSummaryParagraphs({
  company,
  shelfCapacityValue,
  shelfRegisteredSharesValue,
  shelfSecuritiesCovered,
  shelfStatus,
  summaryNarrative,
}: {
  company: string;
  shelfCapacityValue: string;
  shelfRegisteredSharesValue: string;
  shelfSecuritiesCovered: string;
  shelfStatus: string;
  summaryNarrative: string;
}) {
  const lead = isDisclosedValue(shelfCapacityValue)
    ? `${company} filed a shelf registration for up to ${shelfCapacityValue} of future securities sales.`
    : `${company} filed a shelf registration for possible future securities sales.`;
  const mechanism =
    `${shelfStatus} means the company has financing capacity available, but pricing, timing, investor demand, and actual issuance still require a future takedown, ATM sale, or prospectus supplement.`;
  const shareContext = isDisclosedValue(shelfRegisteredSharesValue)
    ? `The filing also discloses ${shelfRegisteredSharesValue} of registered share capacity, but those shares are not sold by the shelf filing itself.`
    : "The filing does not provide a source-backed share count, so share overhang and dilution percentage should not be calculated from this shelf alone.";
  const securities = isDisclosedValue(shelfSecuritiesCovered) ? `Securities covered: ${shelfSecuritiesCovered}.` : "";
  const safeNarrative =
    summaryNarrative &&
    !/\b\d+(?:\.\d+)?%\b/.test(summaryNarrative) &&
    !/\b(?:urgent|immediate|today)\b/i.test(summaryNarrative)
      ? summaryNarrative
      : "";

  return [safeNarrative || lead, mechanism, `${shareContext}${securities ? ` ${securities}` : ""}`];
}

function buildDilutionCoreSummary({
  closingNetProceedsValue,
  currentSharesValue,
  dilutionRatioValue,
  instrumentPriceSummary,
  isS8PlanRegistration,
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
  isS8PlanRegistration?: boolean;
  noteConversionSummary: string;
  pipePrincipalValue: string;
  potentialSupplyValue: string;
  warrantExerciseSummary: string;
  warrantCashExerciseProceeds: string;
}) {
  const instrumentQualifier = isDisclosedValue(instrumentPriceSummary) ? " including instrument-linked shares" : "";
  const supplySentence =
    isDisclosedValue(currentSharesValue) && isDisclosedValue(potentialSupplyValue) && isDisclosedValue(dilutionRatioValue)
      ? isS8PlanRegistration
        ? `Current shares are ${currentSharesValue}; registered plan shares are ${potentialSupplyValue}${instrumentQualifier}, equal to ${dilutionRatioValue} of current shares.`
        : `Current shares are ${currentSharesValue}; registered resale pool is ${potentialSupplyValue}${instrumentQualifier}, equal to ${dilutionRatioValue} of current shares.`
      : isS8PlanRegistration
        ? "Current share count, registered plan shares, or plan-share ratio was not fully parsed."
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
  const match = value.match(/([\d,.]+)\s*(million|billion|m|b|bn)?/i);
  if (!match) return 0;
  const parsed = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return 0;

  const unit = (match[2] || "").toLowerCase();
  if (unit === "billion" || unit === "b" || unit === "bn") return parsed * 1_000_000_000;
  if (unit === "million" || unit === "m") return parsed * 1_000_000;
  return parsed;
}

function findPriceTerm(sourceText: string, pattern: RegExp) {
  return sourceText.match(pattern)?.[1] || "";
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
  const match = cleanDisclosureValue(value).match(/\$?([\d,.]+)\s*(thousand|million|billion|k|m|b|bn)?/i);
  if (!match) return 0;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return 0;

  const unit = (match[2] || "").toLowerCase();
  if (unit === "billion" || unit === "bn" || unit === "b") return amount * 1_000_000_000;
  if (unit === "million" || unit === "m") return amount * 1_000_000;
  if (unit === "thousand" || unit === "k") return amount * 1_000;
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
  if (!items.length) return null;

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
  if (!items.length) return null;

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

function ScoreBasisPanel({ filing }: { filing: FilingEvent }) {
  const explanation = filing.scoreExplanation;
  if (!explanation) return null;
  const scoreSummary = buildScoreBasisHeadline(explanation);
  if (!scoreSummary) return null;

  return (
    <section className="stock-detail-card score-basis-card score-basis-card-main" id="score-rationale">
      <div className="score-basis-header">
        <span className={`score-basis-score ${filing.signal}`}>
          <strong>{filing.score}</strong>
          <b>{filing.signal}</b>
        </span>
        <span className="score-basis-summary">{scoreSummary}</span>
      </div>
    </section>
  );
}

function buildScoreBasisHeadline(explanation: FilingScoreExplanation) {
  return compactInlineText(explanation.summary);
}

function compactInlineText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type OwnershipRelatedFilingsInput = {
  currentId: string;
  currentFormType: string;
  currentTitle: string;
  displayPayload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rawPayload: Record<string, unknown> | null;
  recentRows: Record<string, unknown>[];
};

async function buildOwnershipRelatedFilings(input: OwnershipRelatedFilingsInput): Promise<OwnershipRelatedFiling[]> {
  const previousAccession = readOwnershipPreviousAccession(input);
  const parentRow = previousAccession ? await fetchOwnershipEventByAccession(previousAccession) : null;
  const rows = [parentRow, ...input.recentRows].filter((row): row is Record<string, unknown> => Boolean(row));
  const seen = new Set<string>();
  const related: OwnershipRelatedFiling[] = [];

  for (const row of rows) {
    const id = readRowString(row, "id");
    if (!id || id === input.currentId || seen.has(id)) continue;
    seen.add(id);

    const item = mapOwnershipRelatedFilingRow(row, input, previousAccession);
    if (item) related.push(item);
  }

  return related.slice(0, 6);
}

async function fetchSc13RelatedFilingRowsByIssuer(input: {
  currentId: string;
  metadata: Record<string, unknown> | null;
  rawPayload: Record<string, unknown> | null;
  title: string;
}) {
  const needles = readSc13IssuerSearchNeedles(input);
  if (needles.length === 0) return [];

  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const needle of needles) {
    const result = await supabaseSelect("events", {
      select: "*",
      source_group: "eq.filings",
      source_code: "eq.sec_edgar",
      event_type: "eq.insider_ownership",
      "metadata->>issuer": `ilike.*${needle}*`,
      order: "detected_at.desc",
      limit: "12",
    });

    for (const row of toRows(result.data)) {
      const id = readRowString(row, "id");
      if (!id || id === input.currentId || seen.has(id)) continue;
      const form = readFilingFormType(row, toRecord(row.metadata), readRowString(row, "title"));
      if (!isSc13OwnershipForm(form)) continue;
      seen.add(id);
      rows.push(row);
    }
  }

  return rows;
}

function readSc13IssuerSearchNeedles(input: {
  metadata: Record<string, unknown> | null;
  rawPayload: Record<string, unknown> | null;
  title: string;
}) {
  const issuerText = [
    readRowString(input.metadata, "issuer"),
    readRowString(input.rawPayload, "issuer"),
    input.title,
  ].join(" ");
  const subjectCik = issuerText.match(/\bSubject\)\s*CIK\s*:?\s*0*(\d{4,10})\b/i)?.[1];
  const metadataCik = readRowString(input.metadata, "cik") || readRowString(input.rawPayload, "cik");
  const cik = subjectCik || metadataCik.replace(/^0+/, "");
  const paddedCik = cik ? cik.padStart(10, "0") : "";
  const company = issuerText
    .split(/\(\s*Subject\s*\)/i)[0]
    .replace(/\s+CIK\s*:.*$/i, "")
    .trim();

  return [paddedCik, cik, company]
    .map((value) => value.trim())
    .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index)
    .slice(0, 3);
}

function dedupeRowsById(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = readRowString(row, "id");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function fetchOwnershipEventByAccession(accession: string) {
  const normalized = normalizeAccession(accession);
  if (!normalized) return null;

  const byDedupe = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    source_code: "eq.sec_edgar",
    group_dedupe_key: `eq.sec_edgar:ownership:accession:${normalized}`,
    limit: "1",
  });
  const dedupeRow = toRows(byDedupe.data)[0];
  if (dedupeRow) return dedupeRow;

  const byMetadata = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    source_code: "eq.sec_edgar",
    "metadata->>accession_number": `eq.${normalized}`,
    limit: "1",
  });
  return toRows(byMetadata.data)[0] ?? null;
}

function mapOwnershipRelatedFilingRow(
  row: Record<string, unknown>,
  input: OwnershipRelatedFilingsInput,
  previousAccession: string,
): OwnershipRelatedFiling | null {
  const title = readRowString(row, "title") || "Related ownership filing";
  const metadata = toRecord(row.metadata);
  const form = readFilingFormType(row, metadata, title);
  const accession = readEventAccession(row);
  const relatedEventType = readRowString(row, "event_type") || "other";
  const badge = getEventTypeBadge(relatedEventType);
  const relation = classifyOwnershipRelatedFiling({
    currentFormType: input.currentFormType,
    currentTitle: input.currentTitle,
    currentOwnerName: readOwnershipCurrentOwnerName(input),
    relatedFormType: form,
    relatedTitle: title,
    relatedAccession: accession,
    relatedEventType,
    previousAccession,
  });

  return {
    id: readRowString(row, "id"),
    form,
    eventType: badge.label,
    filedAt: formatShortDate(readRowString(row, "detected_at") || readRowString(row, "published_at")),
    score: readRowNumber(row, "score"),
    title,
    accession,
    deliveryLevel: readRowString(row, "delivery_level"),
    relation: relation.label,
    description: relation.description,
    candidate: relation.candidate,
  };
}

function classifyOwnershipRelatedFiling(input: {
  currentFormType: string;
  currentTitle: string;
  currentOwnerName: string;
  relatedFormType: string;
  relatedTitle: string;
  relatedAccession: string;
  relatedEventType: string;
  previousAccession: string;
}) {
  const currentForm = normalizeOwnershipForm(input.currentFormType);
  const relatedForm = normalizeOwnershipForm(input.relatedFormType);
  const relatedAccession = normalizeAccession(input.relatedAccession);
  const previousAccession = normalizeAccession(input.previousAccession);
  const sameOwner = hasSharedOwnerName(input.currentOwnerName || input.currentTitle, input.relatedTitle);
  const currentSc13 = isSc13OwnershipForm(currentForm);
  const relatedSc13 = isSc13OwnershipForm(relatedForm);
  const relatedIsOwnership = input.relatedEventType === "insider_ownership";

  if (previousAccession && relatedAccession === previousAccession) {
    return {
      label: "Parent",
      description: "Original ownership filing matched by accession.",
      candidate: false,
    };
  }

  if (!relatedIsOwnership) {
    return {
      label: "Related SEC filing",
      description: "Recent SEC filing for the same issuer.",
      candidate: false,
    };
  }

  if (currentSc13 && relatedSc13) {
    if (isSc13AmendmentOf(currentForm, relatedForm)) {
      return {
        label: "Parent candidate",
        description: "Likely original Schedule 13 filing for this amendment; candidate only.",
        candidate: true,
      };
    }

    if (isSc13Amendment(currentForm) && sc13BaseFamily(currentForm) === sc13BaseFamily(relatedForm)) {
      return {
        label: "Prior amendment",
        description: "Earlier Schedule 13 amendment for the same issuer.",
        candidate: false,
      };
    }

    return {
      label: "Schedule 13 history",
      description: "Recent 13D/13G ownership filing for the same issuer.",
      candidate: false,
    };
  }

  if (sameOwner && isOwnershipAmendmentOf(currentForm, relatedForm)) {
    return {
      label: "Parent candidate",
      description: "Likely original ownership filing for this amendment; candidate only.",
      candidate: true,
    };
  }

  if (sameOwner && isOwnershipForm144(currentForm) && isOwnershipForm4(relatedForm)) {
    return {
      label: "Form 4 candidate",
      description: "Possible execution follow-up for a planned sale; candidate only.",
      candidate: true,
    };
  }

  if (sameOwner && isOwnershipForm4(currentForm) && isOwnershipForm144(relatedForm)) {
    return {
      label: "Form 144 candidate",
      description: "Possible planned-sale context for this insider transaction.",
      candidate: true,
    };
  }

  if (sameOwner) {
    return {
      label: "Same insider",
      description: "Recent filing appears tied to the same reporting owner or seller.",
      candidate: false,
    };
  }

  return {
    label: "Company filing",
    description: "Recent ownership filing for the same issuer.",
    candidate: false,
  };
}

function readOwnershipPreviousAccession(input: OwnershipRelatedFilingsInput) {
  const data = readDisplayPayloadData(input.displayPayload);
  const filing = readPlainRecord(data.filing);
  const form144 = readPlainRecord(data.form144);
  const amendment = readPlainRecord(data.amendment);
  const parserOutput = readPlainRecord(input.metadata?.parser_output) || readPlainRecord(input.rawPayload?.parser_output);
  const parserFacts = readPlainRecord(parserOutput?.facts);
  const parserFiling = readPlainRecord(parserFacts?.filing);
  const parserForm144 = readPlainRecord(parserFacts?.form144);
  const values = [
    readRowString(data, "previous_accession_number"),
    readRowString(data, "previous_accession"),
    readRowString(data, "parent_accession"),
    readRowString(filing, "previous_accession_number"),
    readRowString(form144, "previous_accession_number"),
    readRowString(amendment, "previous_accession_number"),
    readRowString(input.metadata, "previous_accession_number"),
    readRowString(input.rawPayload, "previous_accession_number"),
    readRowString(parserFiling, "previous_accession_number"),
    readRowString(parserForm144, "previous_accession_number"),
  ];

  return values.map(normalizeAccession).find(Boolean) || "";
}

function readOwnershipCurrentOwnerName(input: OwnershipRelatedFilingsInput) {
  const data = readDisplayPayloadData(input.displayPayload);
  const reportingOwner = readPlainRecord(data.reporting_owner) || readPlainRecord(data.reportingOwner);
  const form144 = readPlainRecord(data.form144);
  const values = [
    readRowString(data, "owner_name"),
    readRowString(data, "reporting_owner_name"),
    readRowString(data, "seller_name"),
    readRowString(reportingOwner, "name"),
    readRowString(form144, "seller_name"),
    readRowString(form144, "account_person_name"),
  ];

  return values.find(Boolean) || "";
}

function readEventAccession(row: Record<string, unknown>) {
  const metadata = toRecord(row.metadata);
  return normalizeAccession(
    readRowString(metadata, "accession_number") ||
      readRowString(metadata, "accessionNumber") ||
      readRowString(row, "source_unique_id") ||
      readRowString(row, "dedupe_key") ||
      readRowString(row, "raw_item_id"),
  );
}

function normalizeAccession(value: string) {
  const match = value.match(/\d{10}-\d{2}-\d{6}/);
  return match?.[0] || "";
}

function normalizeOwnershipForm(value: string) {
  return value.toUpperCase().replace(/\bSCHEDULE\b/g, "SC").replace(/\s+/g, "");
}

function isOwnershipForm4(value: string) {
  return value === "4" || value === "4/A";
}

function isOwnershipForm144(value: string) {
  return value === "144" || value === "144/A";
}

function isOwnershipAmendmentOf(currentForm: string, relatedForm: string) {
  return (currentForm === "4/A" && relatedForm === "4") || (currentForm === "144/A" && relatedForm === "144");
}

function isSc13OwnershipForm(value: string) {
  const normalized = normalizeOwnershipForm(value);
  return normalized === "SC13D" || normalized === "SC13D/A" || normalized === "SC13G" || normalized === "SC13G/A";
}

function isSc13Amendment(value: string) {
  return normalizeOwnershipForm(value).endsWith("/A") && isSc13OwnershipForm(value);
}

function isSc13AmendmentOf(currentForm: string, relatedForm: string) {
  return (
    (currentForm === "SC13D/A" && relatedForm === "SC13D") ||
    (currentForm === "SC13G/A" && relatedForm === "SC13G")
  );
}

function sc13BaseFamily(value: string) {
  return normalizeOwnershipForm(value).replace(/\/A$/, "");
}

function hasSharedOwnerName(left: string, right: string) {
  const leftTokens = personNameTokens(left);
  const rightTokens = personNameTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  return leftTokens.filter((token) => rightTokens.includes(token)).length >= 2;
}

function personNameTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["form", "files", "issuer", "reporting", "cik", "inc", "corp", "ltd"].includes(token))
    .slice(0, 8);
}

function buildFilingContextRelatedFilings({
  currentId,
  metadata,
}: {
  currentId: string;
  metadata: Record<string, unknown> | null;
}): FilingContextRelatedFiling[] {
  const filingContext = readPlainRecord(metadata?.filing_context);
  const transactionHistory = readPlainRecord(filingContext?.transaction_history);
  const priorFilings = recordArray(transactionHistory?.prior_filings);
  const seen = new Set<string>();

  return priorFilings
    .map((item) => mapFilingContextRelatedFiling(item))
    .filter((item): item is FilingContextRelatedFiling => Boolean(item))
    .filter((item) => {
      if (item.id && item.id === currentId) return false;
      const key = item.id || item.accession || `${item.form}:${item.filedAt}:${item.title}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function mapFilingContextRelatedFiling(item: Record<string, unknown>): FilingContextRelatedFiling | null {
  const id = readRowString(item, "event_id");
  const accession = readRowString(item, "accession_number");
  const title = readRowString(item, "event_title") || readRowString(item, "title") || "Related SEC filing";
  const form = readRowString(item, "form_type") || "SEC";
  const eventType = readRowString(item, "event_type") || "other";
  const badge = getEventTypeBadge(eventType);
  const relation = classifyFilingContextRelation(item, form);
  const confidence = readRowString(item, "match_confidence");
  const score = readRowNumber(item, "match_score");

  return {
    id,
    form,
    eventType: badge.label,
    filedAt: formatShortDate(readRowString(item, "filed_at")),
    score: readRowNumber(item, "score"),
    title,
    accession,
    deliveryLevel: readRowString(item, "delivery_level"),
    relation: relation.label,
    description: relation.description,
    candidate: relation.candidate,
    matchScore: score || null,
    matchConfidence: confidence,
  };
}

function classifyFilingContextRelation(item: Record<string, unknown>, formType: string) {
  const source = readRowString(item, "match_source");
  const form = formType.toUpperCase();
  const confidence = readRowString(item, "match_confidence").toLowerCase();

  if (source === "parent_filing_context") {
    return {
      label: "Parent",
      description: "Original filing matched for this amendment.",
      candidate: false,
    };
  }

  if (form.includes("14D9")) {
    return {
      label: "Target response",
      description: "Target-company response tied to the same tender transaction.",
      candidate: confidence !== "high",
    };
  }

  if (form.endsWith("/A")) {
    return {
      label: "Prior amendment",
      description: "Earlier amendment tied to the same transaction fingerprint.",
      candidate: confidence !== "high",
    };
  }

  return {
    label: "Prior filing",
    description: "Earlier filing tied to the same transaction fingerprint.",
    candidate: confidence !== "high" && confidence !== "",
  };
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
        accession: readEventAccession(row),
        deliveryLevel: readRowString(row, "delivery_level"),
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

function buildFilingPriceMarkers({
  displayPayload,
  filingTicker,
  offeringTerms,
  transactionFingerprint,
}: {
  displayPayload: Record<string, unknown> | null;
  filingTicker: string;
  offeringTerms: Record<string, unknown> | null;
  transactionFingerprint: Record<string, unknown> | null;
}): PriceChartMarker[] {
  const markers: PriceChartMarker[] = [];
  const data = readDisplayPayloadData(displayPayload);
  const explicitMarkerSources = [
    data.price_markers,
    data.priceMarkers,
    displayPayload?.price_markers,
    displayPayload?.priceMarkers,
  ];

  for (const source of explicitMarkerSources) {
    for (const item of recordArray(source)) {
      pushPriceMarker(markers, {
        label: readRowString(item, "label") || readRowString(item, "name") || "Filing Price",
        rawValue: item.value ?? item.price ?? item.amount,
        currency: readRowString(item, "currency") || "USD",
        appliesToTicker:
          readRowString(item, "applies_to_ticker") ||
          readRowString(item, "appliesToTicker") ||
          readRowString(item, "ticker") ||
          filingTicker,
        tone: normalizeMarkerTone(readRowString(item, "tone")),
        note: readRowString(item, "note"),
      });
    }
  }

  const targetTicker = readRowString(transactionFingerprint, "target_ticker") || filingTicker;
  const transactionFamily = readRowString(transactionFingerprint, "transaction_family").toLowerCase();
  const transactionType = readRowString(transactionFingerprint, "transaction_type").toLowerCase();
  const cashPrice = readRowString(transactionFingerprint, "cash_price");
  const considerationSummary = readRowString(transactionFingerprint, "consideration_summary");
  const tenderPriceText = [cashPrice, considerationSummary].filter(Boolean).join(" ");
  if (tenderPriceText && /(?:tender|issuer|repurchase|going[_-]?private|cash[_-]?out|third[_-]?party|merger)/i.test(`${transactionFamily} ${transactionType}`)) {
    pushPriceMarker(markers, {
      label: transactionFamily.includes("issuer") || transactionType.includes("issuer") ? "Tender Price" : "Offer Price",
      rawValue: tenderPriceText,
      currency: extractPriceMarkerCurrency(tenderPriceText) || "USD",
      appliesToTicker: targetTicker,
      tone: "volatile",
      note: "Source-backed tender or offer price.",
    });
  }

  pushPriceMarker(markers, {
    label: "Approx. Placement Price",
    rawValue: readDisplayOfferingDetailValue(data, "Approx. Placement Price"),
    currency: "USD",
    appliesToTicker: filingTicker,
    tone: "volatile",
  });
  pushPriceMarker(markers, {
    label: "Offering Price",
    rawValue: readDisplayOfferingPrice(data) || offeringTerms?.offering_price,
    currency: "USD",
    appliesToTicker: filingTicker,
    tone: "bearish",
  });
  pushPriceMarker(markers, {
    label: "Exercise Price",
    rawValue:
      offeringTerms?.exercise_price ||
      offeringTerms?.warrant_exercise_price ||
      offeringTerms?.common_warrant_exercise_price ||
      offeringTerms?.prefunded_warrant_exercise_price,
    currency: "USD",
    appliesToTicker: filingTicker,
    tone: "volatile",
  });
  pushPriceMarker(markers, {
    label: "Conversion Price",
    rawValue: offeringTerms?.conversion_price,
    currency: "USD",
    appliesToTicker: filingTicker,
    tone: "volatile",
  });

  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.label.toLowerCase()}-${marker.value.toFixed(4)}-${marker.appliesToTicker || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushPriceMarker(
  markers: PriceChartMarker[],
  input: {
    label: string;
    rawValue: unknown;
    currency?: string;
    appliesToTicker?: string;
    tone?: DetailTone;
    note?: string;
  },
) {
  if (isFeeTablePriceMarker(input.label, input.rawValue)) return;

  const currency = normalizePriceMarkerCurrency(input.currency || extractPriceMarkerCurrency(input.rawValue) || "USD");
  if (currency && currency !== "USD") return;

  const value = parsePriceMarkerValue(input.rawValue);
  if (!Number.isFinite(value) || value <= 0) return;

  markers.push({
    label: input.label,
    value,
    currency: "USD",
    appliesToTicker: normalizeMarkerTicker(input.appliesToTicker || ""),
    tone: input.tone || "volatile",
    note: input.note || null,
  });
}

function isFeeTablePriceMarker(label: string, rawValue: unknown) {
  const text = `${label} ${typeof rawValue === "string" ? rawValue : ""}`;
  return /\b(?:fee table|filing fee|fee calculation|calculation of fees|for calculation of fees|rule\s*457|proposed maximum offering price)\b/i.test(text);
}

function readDisplayOfferingDetailValue(data: Record<string, unknown>, label: string) {
  const normalizedLabel = normalizeOfferingDetailLabel(label);
  for (const item of recordArray(data.offering_details)) {
    if (normalizeOfferingDetailLabel(readRowString(item, "label")) !== normalizedLabel) continue;
    const value = cleanDisclosureValue(readDisclosureValue(item.value) || readRowString(item, "value"));
    if (value) return value;
  }
  return "";
}

function readDisplayOfferingPrice(data: Record<string, unknown> | null) {
  if (!data) return "";
  const directPrice =
    readDisclosureValue(data.offer_price) ||
    readDisclosureValue(data.offering_price) ||
    readDisclosureValue(data.offerPrice) ||
    readDisclosureValue(data.offeringPrice);
  if (directPrice) return directPrice;
  return "";
}

function parsePriceMarkerValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = typeof value === "string" ? value : "";
  if (!text) return 0;

  const perAdsMoneyMatch = text.match(/\b(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:in\s+cash\s*)?per\s+ADS\b/i);
  if (perAdsMoneyMatch) return Number(perAdsMoneyMatch[1].replace(/,/g, ""));

  const moneyMatch = text.match(/\b(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (moneyMatch) return Number(moneyMatch[1].replace(/,/g, ""));

  const perShareMatch = text.match(/\b([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:per share|per ADS|per ordinary share)\b/i);
  if (perShareMatch && !/%/.test(text.slice(Math.max(0, perShareMatch.index || 0), (perShareMatch.index || 0) + perShareMatch[0].length + 12))) {
    return Number(perShareMatch[1].replace(/,/g, ""));
  }

  return 0;
}

function extractPriceMarkerCurrency(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (/\b(?:USD|US\$|\$)\b/i.test(text)) return "USD";
  const match = text.match(/\b([A-Z]{3})\s*[0-9]/);
  return match?.[1] || "";
}

function normalizePriceMarkerCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!currency || currency === "$" || currency === "US$") return "USD";
  return currency;
}

function normalizeMarkerTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return isRealTicker(ticker) ? ticker : null;
}

function normalizeMarkerTone(value: string): DetailTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bullish" || normalized === "bearish" || normalized === "volatile" || normalized === "neutral") {
    return normalized;
  }
  return "volatile";
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

  return items;
}

function readScoreExplanation(analysis: Record<string, unknown> | null | undefined): FilingScoreExplanation | null {
  const value = readPlainRecord(analysis?.score_explanation);
  if (!value) return null;
  const summary = readRowString(value, "summary") || readRowString(value, "rationale");
  const baseBand = readRowString(value, "base_band") || readRowString(value, "baseBand");
  const upwardFactors = toStringArray(value?.upward_factors || value?.upwardFactors, []).slice(0, 3);
  const limitingFactors = toStringArray(value?.limiting_factors || value?.limitingFactors, []).slice(0, 3);
  const finalRead = readRowString(value, "final_read") || readRowString(value, "finalRead");
  if (!summary && !baseBand && !upwardFactors.length && !limitingFactors.length && !finalRead) return null;
  return {
    summary,
    baseBand,
    upwardFactors,
    limitingFactors,
    finalRead,
  };
}

function readScoreReasonFallback(scoreReason: string): FilingScoreExplanation | null {
  const finalRead = scoreReason.trim();
  return finalRead ? { summary: finalRead, baseBand: "", upwardFactors: [], limitingFactors: [], finalRead } : null;
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
  const match = title.match(/\b(?:form\s+)?(SC\s*13D\/A|SC\s*13G\/A|SC\s*13D|SC\s*13G|SCHEDULE\s*13D\/A|SCHEDULE\s*13G\/A|SCHEDULE\s*13D|SCHEDULE\s*13G|10-K|10-Q|8-K|6-K|20-F|S-1|S-3|S-4|S-8|F-1|F-3|F-4|4|144|DEF\s+14A|PRE\s+14A)\b/i);
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

function formatSecFilingDateTime(
  value: string,
  rawPayload: Record<string, unknown> | null,
  fallback = "Recent",
) {
  const acceptedAt =
    readRowString(rawPayload, "accepted_at") ||
    readRowString(rawPayload, "acceptance_datetime") ||
    readRowString(rawPayload, "accepted");
  if (acceptedAt) return formatDetailDateTime(acceptedAt, fallback);

  const filingDate = normalizeDateOnlyForDisplay(readRowString(rawPayload, "filing_date"));
  if (filingDate) {
    return formatDetailDateOnly(filingDate, fallback);
  }

  return formatDetailDateTime(value, fallback);
}

function formatDetailDateOnly(value: string, fallback = "Recent") {
  const dateOnly = normalizeDateOnlyForDisplay(value);
  if (!dateOnly) return fallback;
  const date = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function normalizeDateOnlyForDisplay(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
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
