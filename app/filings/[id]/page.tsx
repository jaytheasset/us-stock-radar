import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import {
  getEventTypeBadge,
  type EventTypeBadgeTone,
} from "@/lib/eventTypeRegistry";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { fetchEventAnalysis, fetchEventById, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";
import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import {
  GenericFilingAnalysis,
  type GenericFilingAnalysisData,
} from "@/components/filing-analysis-v2/GenericFilingAnalysis";
import {
  FinancingDilutionDetails,
  FinancingDilutionInstrumentDetails,
  FinancingDilutionOfferingDetails,
  FinancingDilutionSnapshot,
  type FinancingDilutionCapitalStructureData,
} from "@/components/filing-analysis-v2/FinancingDilutionCapitalStructure";
import {
  OfferingRegistrationDetails,
  OfferingRegistrationInstrumentDetails,
  OfferingRegistrationOfferingDetails,
  OfferingRegistrationSnapshot,
  type OfferingRegistrationData,
} from "@/components/filing-analysis-v2/OfferingRegistration";
import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
  type ListingFinancialRiskSnapshotItem,
} from "@/components/filing-analysis-v2/ListingFinancialRiskSnapshot";
import {
  StrategicTransactionSnapshot,
  type StrategicTransactionSnapshotData,
} from "@/components/filing-analysis-v2/StrategicTransactionSnapshot";
import {
  GovernanceEventChanges,
  GovernanceEventSnapshot,
  type GovernanceEventChange,
  type GovernanceEventData,
  type GovernanceEventMode,
} from "@/components/filing-analysis-v2/GovernanceEventDetails";
import {
  OperatingEventDetails,
  OperatingEventSnapshot,
  type OperatingBusinessUpdate,
  type OperatingDetailSection,
  type OperatingEventMode,
  type OperatingGuidanceMetric,
  type OperatingLegalRoutineData,
  type OperatingPerformanceComparison,
  type OperatingRegulatoryStage,
  type OperatingSecondaryUpdate,
} from "@/components/filing-analysis-v2/OperatingLegalRoutine";
import {
  PeriodicReportDetails,
  PeriodicReportSnapshot,
  type PeriodicAmendmentChange,
  type PeriodicReportData,
} from "@/components/filing-analysis-v2/PeriodicReports";
import {
  ProxyProposalAgenda,
  ProxyVoteSnapshot,
  type ProxyProposal,
  type ProxyVoteData,
} from "@/components/filing-analysis-v2/ProxyVoteDetails";
import {
  OwnershipDetails,
  OwnershipSnapshot,
  type OwnershipData,
  type OwnershipDetailRow,
  type OwnershipTransaction,
} from "@/components/filing-analysis-v2/OwnershipDetails";
import {
  TenderOfferDetails,
  TenderOfferSnapshot,
  type TenderOfferChange,
  type TenderOfferData,
  type TenderOfferMode,
  type TenderOfferTerm,
} from "@/components/filing-analysis-v2/TenderOfferDetails";
import {
  S8Details,
  S8Snapshot,
  type S8Data,
  type S8DetailRow,
  type S8Mode,
} from "@/components/filing-analysis-v2/S8Details";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import type { BadgeTone } from "@/components/ui/Badge";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import {
  filingUiFamilies,
  registeredFilingUiFixtures,
} from "@/lib/development/filingUiRegistry";
import { getServerEnv } from "@/lib/env";
import { buildGooglePreferredSourceUrl } from "@/lib/googlePreferredSource";
import {
  DilutionShareOverhang,
  type DilutionShareOverhangBarSegment,
  type DilutionShareOverhangBreakdownRow,
} from "@/components/DilutionShareOverhang";
import {
  isRealTicker,
  type DetailTone,
  type PriceChartSeries,
  type PricePoint,
  type PriceRange,
  type SectorThemeContext,
  type SectorThemePeriod,
  type TopMover,
} from "@/app/events/[id]/detailTypes";

type FilingDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

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
  scoreRationale: string;
  context: SectorThemeContext;
  priceSeries: PriceChartSeries | null;
  originalTextNote: string;
  originalHtml: string;
  listingFinancialRiskSnapshot?: ListingFinancialRiskSnapshotData | null;
  form25ListingStatus?: Form25ListingStatusData | null;
  strategicTransactionSnapshot?: StrategicTransactionSnapshotData | null;
  form425TransactionSnapshot?: StrategicTransactionSnapshotData | null;
  governanceEvent?: GovernanceEventData | null;
  operatingEvent?: OperatingLegalRoutineData | null;
  periodicReport?: PeriodicReportData | null;
  proxyVote?: ProxyVoteData | null;
  ownership?: OwnershipData | null;
  tenderOffer?: TenderOfferData | null;
  ntLateFilingSnapshot?: ListingFinancialRiskSnapshotData | null;
  s8?: S8Data | null;
  financingDilution?: FinancingDilutionCapitalStructureData | null;
  offeringRegistration?: OfferingRegistrationData | null;
  offeringDisplayModel?: Record<string, unknown> | null;
  offeringMarketContext?: Record<string, unknown> | null;
  offeringDilutionMetrics?: Record<string, unknown> | null;
  offeringTerms?: Record<string, unknown> | null;
  s3Case?: string | null;
  genericAvailability?: GenericFilingAvailability;
};

type Form25ListingStatusData = {
  exchange: string;
  issuerName: string;
  primaryTicker: string;
  snapshot: ListingFinancialRiskSnapshotData;
};

type GenericFilingAvailability = {
  bearishPoints: boolean;
  bullishPoints: boolean;
  context: boolean;
  filingBrief: boolean;
  keyEvidence: boolean;
  originalHtml: boolean;
  recentFilings: boolean;
  relatedNews: boolean;
  scoreRationale: boolean;
  summary: boolean;
  watchNext: boolean;
  whyItMatters: boolean;
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
  eventId?: string;
  eventType?: string;
  title: string;
  source: string;
  sourceUrl?: string;
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
    sourceUrl: "",
    eventType: "product_update",
    impact: "medium",
    deliveryLevel: "feed",
    score: 64,
    scoreRationale:
      "The 8-K is relevant, but this shell does not show a confirmed financing, dilution, or transaction trigger.",
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
      { title: "EV delivery expectations remain active across large-cap autos", eventType: "sales_performance", source: "Stock Radar", age: "1h ago" },
      { title: "Auto sector watches margin pressure after recent price adjustments", eventType: "financial_risk", source: "Business Wire", age: "3h ago" },
      { title: "Operational updates keep Tesla in the live filing feed", eventType: "product_update", source: "Stock Radar", age: "4h ago" },
      { title: "EV policy and demand headlines shape autos watchlist", eventType: "legal_risk", source: "PR Newswire", age: "6h ago" },
    ],
    context: {
      sector: "Consumer Cyclical",
      industry: "Autos & Mobility",
      themeGroup: "Defense & Geopolitics",
      subTheme: "China Risk",
      marketCap: "$565.0B",
      sharesOutstanding: "3.22B",
      publicFloat: "2.79B",
      publicFloatPercent: "86.6%",
      periods: {
        "1D": {
          sectorChange: "+0.63%",
          industryChange: "-0.82%",
          themeChange: "+0.18%",
          subThemeChange: "-0.44%",
          themeScore: 64,
          themeSignal: "neutral",
          topMovers: [
            { symbol: "TSLA", change: "-1.13%", trend: [52, 50, 48, 47, 45, 46, 43, 42, 41, 40] },
            { symbol: "GM", change: "+0.42%", trend: [38, 39, 40, 39, 41, 42, 41, 43, 44, 45] },
            { symbol: "F", change: "-0.31%", trend: [44, 43, 42, 43, 41, 40, 39, 40, 39, 38] },
            { symbol: "NIO", change: "-1.84%", trend: [50, 48, 49, 46, 45, 43, 44, 41, 40, 39] },
            { symbol: "LI", change: "+0.76%", trend: [36, 37, 36, 39, 40, 41, 40, 42, 43, 44] },
            { symbol: "XPEV", change: "-0.58%", trend: [46, 45, 43, 44, 42, 41, 40, 38, 39, 37] },
          ],
        },
        "5D": {
          sectorChange: "+1.42%",
          industryChange: "-1.76%",
          themeChange: "+0.72%",
          subThemeChange: "-1.12%",
          themeScore: 62,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "TSLA", change: "-3.84%", trend: [56, 54, 52, 49, 50, 47, 45, 43, 42, 40] },
            { symbol: "GM", change: "+1.92%", trend: [36, 37, 39, 38, 40, 41, 42, 44, 43, 45] },
            { symbol: "RIVN", change: "+2.74%", trend: [30, 31, 34, 33, 36, 38, 40, 42, 41, 44] },
            { symbol: "NIO", change: "-4.12%", trend: [54, 52, 50, 48, 49, 46, 44, 43, 41, 39] },
            { symbol: "LI", change: "+2.18%", trend: [32, 34, 33, 36, 38, 37, 40, 42, 43, 45] },
            { symbol: "XPEV", change: "-2.36%", trend: [50, 48, 47, 45, 46, 43, 42, 40, 39, 38] },
          ],
        },
        "30D": {
          sectorChange: "+4.90%",
          industryChange: "-5.18%",
          themeChange: "+2.34%",
          subThemeChange: "-3.46%",
          themeScore: 60,
          themeSignal: "volatile",
          topMovers: [
            { symbol: "TSLA", change: "-8.22%", trend: [64, 61, 58, 57, 53, 51, 48, 46, 43, 40] },
            { symbol: "GM", change: "+4.36%", trend: [34, 36, 38, 39, 41, 42, 44, 45, 47, 49] },
            { symbol: "F", change: "+1.18%", trend: [40, 39, 41, 42, 41, 43, 44, 43, 45, 46] },
            { symbol: "NIO", change: "-10.64%", trend: [66, 63, 60, 57, 55, 51, 49, 46, 43, 40] },
            { symbol: "LI", change: "+5.42%", trend: [30, 32, 34, 36, 35, 39, 41, 44, 46, 49] },
            { symbol: "XPEV", change: "-6.78%", trend: [58, 55, 53, 50, 48, 46, 43, 41, 39, 37] },
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

commonFilingEvents["generic-no-chart-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "generic-no-chart-fixture",
  ticker: "N/A",
  exchange: "",
  company: "Example Corporation",
  title: "Example Corporation Files an Operational Update Without Available Market Data",
  price: "N/A",
  changeAmount: "$0.00",
  change: "+0.00%",
  filingBrief:
    "The filing provides a current operational update, but no reliable market chart is available for the issuer.",
  whyItMatters:
    "The disclosure changes the operating outlook investors need to assess even though a market-price reaction cannot be displayed.",
  summary:
    "Management described the current operating position, near-term execution priorities, and the next company-reported milestones without providing a usable public-market price series.",
  recentFilings: [],
  relatedNews: [],
  context: emptySectorThemeContext(64, "neutral"),
  priceSeries: null,
  genericAvailability: {
    bearishPoints: true,
    bullishPoints: true,
    context: false,
    filingBrief: true,
    keyEvidence: true,
    originalHtml: true,
    recentFilings: false,
    relatedNews: false,
    scoreRationale: true,
    summary: true,
    watchNext: true,
    whyItMatters: true,
  },
};

commonFilingEvents["listing-financial-risk-status-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "listing-financial-risk-status-fixture",
  ticker: "NKLA",
  exchange: "NASDAQ",
  company: "Nikola Corporation",
  title: "Nikola Receives Nasdaq Delisting Notice Following Chapter 11 Filing",
  formType: "8-K",
  filedAt: "Feb 19, 2025 - 4:30 PM ET",
  source: "SEC EDGAR",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1731289/000173128925000011/nkla-20250219.htm",
  eventType: "listing_risk",
  impact: "high",
  deliveryLevel: "alert",
  score: 92,
  signal: "bearish",
  price: "N/A",
  changeAmount: "$0.00",
  change: "+0.00%",
  filingFocus: "Exchange delisting",
  filingBrief:
    "Nasdaq determined that Nikola's common stock would be delisted after the company filed for Chapter 11 bankruptcy protection.",
  whyItMatters:
    "The bankruptcy-driven delisting sharply reduces common-stock liquidity and reinforces the risk that existing equity holders recover little or no value.",
  bullishPoints: [],
  bearishPoints: [
    "Nasdaq determined that the common stock would be delisted.",
    "The delisting followed Nikola's Chapter 11 bankruptcy filing.",
    "Nikola does not intend to appeal Nasdaq's determination.",
  ],
  summary:
    "Nikola received a Nasdaq delisting notice after filing for Chapter 11 bankruptcy protection. Trading was scheduled to be suspended on February 26, 2025, and the company said it would not appeal the determination.",
  keyEvidence: [
    "Nasdaq based its determination on the Chapter 11 filing and related public-interest concerns.",
    "Trading was scheduled to be suspended at the opening of business on February 26, 2025.",
    "Nikola stated that it did not intend to appeal the delisting determination.",
  ],
  watchNext: [
    "The venue and liquidity available for any post-suspension trading.",
    "Developments in the Chapter 11 process affecting residual common-equity value.",
    "The filing and effectiveness of Form 25-NSE and any subsequent Form 15.",
  ],
  recentFilings: [
    {
      form: "8-K",
      eventType: "Financial Risk",
      title: "Chapter 11 bankruptcy filing and restructuring process disclosed",
      filedAt: "Feb 19, 2025",
      score: 95,
    },
    {
      form: "Form 25-NSE",
      eventType: "Listing Risk",
      title: "Nasdaq removal filing follows the announced trading suspension",
      filedAt: "Follow-up filing",
      score: 20,
    },
    {
      form: "10-K",
      eventType: "Periodic Report",
      title: "Annual report provides prior liquidity and going-concern context",
      filedAt: "Prior filing",
      score: 75,
    },
  ],
  relatedNews: [
    {
      title: "Bankruptcy process shifts investor focus to asset-sale recoveries",
      eventType: "financial_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Nasdaq suspension sharply reduces liquidity for Nikola common stock",
      eventType: "listing_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Common-equity recovery remains subordinate in the Chapter 11 process",
      eventType: "financial_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Bankruptcy, a confirmed exchange delisting, and no planned appeal place the common equity in the highest listing-risk tier.",
  context: {
    sector: "Industrials",
    industry: "Automobiles & Components",
    themeGroup: "Automotive",
    subTheme: "Electric Vehicles",
    marketCap: "$227.4M",
    sharesOutstanding: "1.31B",
    publicFloat: "1.18B",
    publicFloatPercent: "90.1%",
    periods: {
      "1D": {
        sectorChange: "+0.11%",
        industryChange: "-0.74%",
        themeChange: "-0.53%",
        subThemeChange: "-1.18%",
        themeScore: 92,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "NKLA", change: "-4.84%", trend: [56, 54, 52, 49, 50, 47, 45, 43, 42, 40] },
          { symbol: "TSLA", change: "-1.13%", trend: [52, 50, 48, 47, 45, 46, 43, 42, 41, 40] },
          { symbol: "RIVN", change: "+0.42%", trend: [38, 39, 40, 39, 41, 42, 41, 43, 44, 45] },
          { symbol: "LCID", change: "-0.31%", trend: [44, 43, 42, 43, 41, 40, 39, 40, 39, 38] },
          { symbol: "NIO", change: "-1.84%", trend: [50, 48, 49, 46, 45, 43, 44, 41, 40, 39] },
          { symbol: "XPEV", change: "+0.76%", trend: [36, 37, 36, 39, 40, 41, 40, 42, 43, 44] },
        ],
      },
      "5D": {
        sectorChange: "+1.42%",
        industryChange: "-1.76%",
        themeChange: "-1.32%",
        subThemeChange: "-2.12%",
        themeScore: 92,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "NKLA", change: "-12.64%", trend: [62, 59, 57, 54, 52, 49, 46, 44, 42, 39] },
          { symbol: "TSLA", change: "-3.84%", trend: [56, 54, 52, 49, 50, 47, 45, 43, 42, 40] },
          { symbol: "RIVN", change: "+2.74%", trend: [30, 31, 34, 33, 36, 38, 40, 42, 41, 44] },
          { symbol: "LCID", change: "-2.36%", trend: [50, 48, 47, 45, 46, 43, 42, 40, 39, 38] },
          { symbol: "NIO", change: "-4.12%", trend: [54, 52, 50, 48, 49, 46, 44, 43, 41, 39] },
          { symbol: "XPEV", change: "+2.18%", trend: [32, 34, 33, 36, 38, 37, 40, 42, 43, 45] },
        ],
      },
      "30D": {
        sectorChange: "+4.90%",
        industryChange: "-5.18%",
        themeChange: "-4.34%",
        subThemeChange: "-7.46%",
        themeScore: 92,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "NKLA", change: "-38.22%", trend: [72, 68, 64, 60, 56, 52, 48, 45, 42, 38] },
          { symbol: "TSLA", change: "-8.22%", trend: [64, 61, 58, 57, 53, 51, 48, 46, 43, 40] },
          { symbol: "RIVN", change: "+4.36%", trend: [34, 36, 38, 39, 41, 42, 44, 45, 47, 49] },
          { symbol: "LCID", change: "+1.18%", trend: [40, 39, 41, 42, 41, 43, 44, 43, 45, 46] },
          { symbol: "NIO", change: "-10.64%", trend: [66, 63, 60, 57, 55, 51, 49, 46, 43, 40] },
          { symbol: "XPEV", change: "-6.78%", trend: [58, 55, 53, 50, 48, 46, 43, 41, 39, 37] },
        ],
      },
    },
  },
  priceSeries: null,
  originalTextNote: "Fixture excerpt based on the filed 8-K.",
  originalHtml: `
    <h3>Item 3.01 Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard</h3>
    <p>Nasdaq notified the Company that its securities would be delisted following the Company's Chapter 11 bankruptcy filing. Trading was expected to be suspended at the opening of business on February 26, 2025. The Company did not intend to appeal the determination.</p>
  `,
  listingFinancialRiskSnapshot: {
    title: "Listing Status Snapshot",
    items: [
      { label: "Current Status", value: "Delisting determined" },
      { label: "Primary Reason", value: "Chapter 11 bankruptcy" },
      { label: "Trading Suspension", value: "February 26, 2025" },
      { label: "Company Response", value: "No appeal planned" },
    ],
  },
  genericAvailability: {
    bearishPoints: true,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: true,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: true,
    whyItMatters: true,
  },
};

commonFilingEvents["form-25-listing-removal-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "form-25-listing-removal-fixture",
  ticker: "TTOO",
  exchange: "NASDAQ",
  company: "T2 Biosystems, Inc.",
  title: "T2 Biosystems Common Stock Formally Removed from Nasdaq",
  formType: "25-NSE",
  filedAt: "Jul 10, 2025 - 4:07 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1492674/000135445725000634/0001354457-25-000634-index.html",
  eventType: "listing_risk",
  impact: "low",
  deliveryLevel: "archive",
  score: 20,
  signal: "neutral",
  price: "N/A",
  changeAmount: "$0.00",
  change: "+0.00%",
  filingFocus: "Formal exchange removal",
  filingBrief:
    "T2 Biosystems common stock was formally removed from Nasdaq effective July 21, 2025, following the previously announced trading suspension.",
  whyItMatters:
    "The market-impacting delisting decision was already disclosed; this Form 25 completes the formal Nasdaq removal and confirms continued OTC trading context.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "T2 Biosystems common stock was formally removed from Nasdaq effective July 21, 2025. Trading had been suspended on February 12, 2025, and the company expected its common stock to continue trading on OTC Markets under the TTOO symbol.",
  keyEvidence: [
    "Nasdaq set July 21, 2025 as the formal removal date for T2 Biosystems common stock.",
    "Trading was suspended on February 12, 2025 after the delisting determination became final.",
    "The company expected the common stock to continue trading on OTC Markets under TTOO.",
  ],
  watchNext: [],
  recentFilings: [
    {
      form: "8-K",
      eventType: "Listing Risk",
      title: "Nasdaq delisting decision and trading suspension disclosed",
      filedAt: "Feb 10, 2025",
      score: 88,
    },
    {
      form: "25-NSE/A",
      eventType: "Listing Risk",
      title: "Nasdaq files an amendment to the formal removal notice",
      filedAt: "Jul 10, 2025",
      score: 20,
    },
  ],
  relatedNews: [
    {
      title: "T2 Biosystems common stock moves to OTC trading after Nasdaq suspension",
      eventType: "listing_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "This filing is a procedural completion of an already disclosed delisting event, so it remains a low-impact archive update.",
  context: emptySectorThemeContext(20, "neutral"),
  priceSeries: null,
  originalTextNote: "Fixture excerpt based on the filed Form 25-NSE and related listing context.",
  originalHtml: `
    <h3>Notification of Removal from Listing</h3>
    <p>The Nasdaq Stock Market LLC determined to remove T2 Biosystems, Inc. common stock from listing effective at the opening of trading on July 21, 2025.</p>
    <p>The common stock was suspended on February 12, 2025 after the company no longer qualified for continued listing.</p>
  `,
  form25ListingStatus: {
    exchange: "Nasdaq Stock Market LLC",
    issuerName: "T2 Biosystems, Inc.",
    primaryTicker: "TTOO",
    snapshot: {
      title: "Exchange Delisting",
      items: [
        { label: "Removed Security", value: "Common Stock" },
        {
          label: "Exchange / Venue",
          value: "Nasdaq Stock Market LLC",
          note: "Continued trading: OTC Markets",
        },
        {
          label: "Removal Basis",
          value: "No longer qualified for listing",
          note: "Rule 12d2-2(b)",
        },
        {
          label: "Effective / Removal Date",
          value: "July 21, 2025",
          note: "Trading suspended February 12, 2025",
        },
      ],
    },
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: false,
    filingBrief: true,
    keyEvidence: true,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  },
};

commonFilingEvents["form-25-standalone-forced-delisting-fixture"] = {
  ...commonFilingEvents["form-25-listing-removal-fixture"],
  id: "form-25-standalone-forced-delisting-fixture",
  title: "Nasdaq Removes T2 Biosystems Common Stock After Listing Failure",
  impact: "high",
  deliveryLevel: "alert",
  score: 88,
  signal: "bearish",
  filingFocus: "Standalone exchange-forced removal",
  filingBrief:
    "Nasdaq formally removed T2 Biosystems common stock after the security no longer qualified for continued listing.",
  whyItMatters:
    "Without a linked prior event, this filing establishes an active exchange-liquidity loss and the transition to OTC trading.",
  summary:
    "Nasdaq formally removed T2 Biosystems common stock effective July 21, 2025, after trading had been suspended on February 12. The company expected the shares to continue trading on OTC Markets under TTOO, but exchange liquidity and market access were materially reduced.",
  watchNext: [
    "Confirm commencement and liquidity of OTC trading under TTOO.",
    "Watch for company disclosure on reporting status after Nasdaq removal.",
  ],
  recentFilings: [],
  scoreRationale:
    "Forced common-equity removal materially reduces exchange liquidity despite the expected continuation of OTC trading.",
  context: emptySectorThemeContext(88, "bearish"),
  genericAvailability: {
    ...commonFilingEvents["form-25-listing-removal-fixture"].genericAvailability!,
    recentFilings: false,
    watchNext: true,
  },
};

commonFilingEvents["form-25-despac-transition-feed-fixture"] = {
  ...commonFilingEvents["form-25-listing-removal-fixture"],
  id: "form-25-despac-transition-feed-fixture",
  ticker: "JVSA",
  company: "JVSPAC Acquisition Corp.",
  title: "JVSPAC Legacy Securities Removed for Hotel101 Listing Transition",
  filedAt: "Jun 30, 2025",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1866001/000135445725000591/xslF25X02/primary_doc.xml",
  eventType: "strategic_transaction",
  impact: "medium",
  deliveryLevel: "feed",
  score: 65,
  signal: "neutral",
  filingFocus: "Standalone de-SPAC listing transition",
  filingBrief:
    "Nasdaq filed to remove JVSPAC Class A ordinary shares, rights, and units during the Hotel101 listing transition.",
  whyItMatters:
    "The filing removes legacy SPAC securities while investors still need confirmation of the successor listing and treatment of old instruments.",
  summary:
    "Nasdaq filed Form 25 to remove JVSPAC Class A ordinary shares, rights, and units under Rule 12d2-2(a)(3). In the supplied standalone state, the filing indicates a security substitution or listing transition rather than an exchange-compliance failure. Investors still need confirmation of the successor Hotel101 listing and treatment of legacy JVSPAC instruments.",
  keyEvidence: [
    "The removed classes are Class A ordinary shares, rights, and units.",
    "Nasdaq relied on Rule 12d2-2(a)(3) for the removal.",
    "Nasdaq signed the Form 25 on June 30, 2025.",
  ],
  watchNext: [
    "Confirm the successor Hotel101 ticker and first trading date.",
    "Confirm treatment of legacy JVSPAC rights and units.",
  ],
  recentFilings: [],
  relatedNews: [],
  scoreRationale:
    "Legacy SPAC securities are being removed during a listing transition, leaving successor-trading and instrument-treatment details to confirm.",
  context: emptySectorThemeContext(65, "neutral"),
  originalTextNote: "Fixture excerpt based on the filed JVSPAC Form 25-NSE.",
  originalHtml: `
    <h3>Notification of Removal from Listing</h3>
    <p>Issuer: JVSPAC Acquisition Corp.</p>
    <p>Exchange: Nasdaq Stock Market LLC</p>
    <p>Class A Ordinary Share, Right, and Unit</p>
    <p>Rule 12d2-2(a)(3)</p>
  `,
  form25ListingStatus: {
    exchange: "Nasdaq Stock Market LLC",
    issuerName: "JVSPAC Acquisition Corp.",
    primaryTicker: "JVSA",
    snapshot: {
      title: "Listing Transition",
      items: [
        { label: "Removed Security", value: "Class A Shares, Rights, and Units" },
        { label: "Exchange / Venue", value: "Nasdaq Stock Market LLC" },
        {
          label: "Removal Basis",
          value: "Security substitution / transition",
          note: "Rule 12d2-2(a)(3)",
        },
        {
          label: "Form 25 Date",
          value: "June 30, 2025",
          note: "Signed by Nasdaq",
        },
      ],
    },
  },
  genericAvailability: {
    ...commonFilingEvents["form-25-listing-removal-fixture"].genericAvailability!,
    recentFilings: false,
    relatedNews: false,
    watchNext: true,
  },
};

commonFilingEvents["strategic-transaction-merger-closing-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "strategic-transaction-merger-closing-fixture",
  ticker: "MORF",
  exchange: "NASDAQ",
  company: "Morphic Holding, Inc.",
  title: "Morphic Completes $57-Per-Share Cash Acquisition by Eli Lilly",
  formType: "8-K",
  filedAt: "Aug 16, 2024 - 4:15 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1679363/000119312524202123/d877674d8k.htm",
  eventType: "strategic_transaction",
  impact: "high",
  deliveryLevel: "alert",
  score: 80,
  signal: "neutral",
  price: "$57.00",
  changeAmount: "+$0.01",
  change: "+0.02%",
  filingFocus: "Merger closing",
  filingBrief:
    "Eli Lilly completed its cash acquisition of Morphic after 92.8% of outstanding shares were tendered at $57 per share.",
  whyItMatters:
    "The transaction is complete, the cash consideration is fixed, and Morphic common stock is moving into the delisting and deregistration process.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Morphic completed its previously announced cash acquisition by Eli Lilly on August 16, 2024. Rainier Acquisition Corporation accepted 46,731,511 tendered shares, representing approximately 92.8% of outstanding shares, and the remaining eligible shares converted into the right to receive $57.00 in cash. Morphic became a wholly owned Lilly subsidiary and requested Nasdaq trading suspension and a Form 25 filing.",
  keyEvidence: [
    "The tender offer accepted 46,731,511 shares, approximately 92.8% of outstanding shares.",
    "Each eligible Morphic share converted into the right to receive $57.00 in cash.",
    "Morphic requested Nasdaq trading suspension and the filing of Form 25 after the merger closed.",
  ],
  watchNext: [
    "Nasdaq's Form 25 filing and the formal removal of Morphic common stock.",
    "Morphic's planned Form 15 filing to terminate registration and suspend reporting obligations.",
  ],
  recentFilings: [
    {
      form: "8-K",
      eventType: "Strategic Transaction",
      title: "Eli Lilly and Morphic enter into the definitive merger agreement",
      filedAt: "Jul 8, 2024",
      score: 80,
    },
    {
      form: "SC 14D9",
      eventType: "Tender Offer",
      title: "Morphic board recommends the $57-per-share tender offer",
      filedAt: "Jul 19, 2024",
      score: 75,
    },
    {
      form: "8-K",
      eventType: "Strategic Transaction",
      title: "Tender offer and second-step merger are completed",
      filedAt: "Aug 16, 2024",
      score: 80,
    },
  ],
  relatedNews: [
    {
      title: "Lilly completes Morphic acquisition after successful tender offer",
      eventType: "strategic_transaction",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Morphic shareholders receive $57 per share in cash",
      eventType: "strategic_transaction",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Nasdaq delisting follows the completed cash merger",
      eventType: "listing_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "The completed cash merger fixes shareholder consideration and ends Morphic's independent public-market status.",
  context: {
    sector: "Healthcare",
    industry: "Biotechnology",
    themeGroup: "Corporate Actions",
    subTheme: "Mergers & Acquisitions",
    periods: {
      "1D": {
        sectorChange: "+0.22%",
        industryChange: "+0.34%",
        themeChange: "+0.18%",
        subThemeChange: "+0.41%",
        themeScore: 80,
        themeSignal: "neutral",
        topMovers: [
          { symbol: "MORF", change: "+0.02%", trend: [56, 57, 57, 58, 58, 58, 58, 58, 58, 58] },
          { symbol: "LLY", change: "+0.58%", trend: [40, 41, 42, 42, 43, 44, 43, 45, 46, 47] },
          { symbol: "MRNA", change: "-0.74%", trend: [48, 47, 46, 47, 45, 44, 43, 44, 42, 41] },
          { symbol: "VRTX", change: "+0.31%", trend: [39, 40, 41, 40, 42, 43, 42, 44, 44, 45] },
          { symbol: "REGN", change: "-0.28%", trend: [46, 45, 46, 44, 43, 44, 42, 43, 42, 41] },
          { symbol: "BIIB", change: "+0.16%", trend: [40, 41, 40, 42, 42, 43, 42, 44, 43, 44] },
        ],
      },
      "5D": {
        sectorChange: "+1.06%",
        industryChange: "+1.42%",
        themeChange: "+0.88%",
        subThemeChange: "+1.18%",
        themeScore: 80,
        themeSignal: "neutral",
        topMovers: [],
      },
      "30D": {
        sectorChange: "+2.74%",
        industryChange: "+3.18%",
        themeChange: "+2.36%",
        subThemeChange: "+3.42%",
        themeScore: 80,
        themeSignal: "neutral",
        topMovers: [],
      },
    },
  },
  priceSeries: buildPriceSeries({
    lastClose: 57,
    previousClose: 56.99,
    trend: [52, 53, 54, 55, 56, 57, 57, 58, 58, 58, 58, 58],
    volumeBase: 1_900_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed merger-closing 8-K.",
  originalHtml: `
    <h3>Item 2.01 Completion of Acquisition or Disposition of Assets</h3>
    <p>On August 16, 2024, the tendered shares were accepted for payment and the merger was completed. Morphic Holding, Inc. continued as the surviving corporation and became a wholly owned subsidiary of Eli Lilly and Company.</p>
    <h3>Item 3.01 Notice of Delisting</h3>
    <p>Morphic requested that Nasdaq suspend trading of its common stock after the close of business on August 16, 2024 and file Form 25 to remove the common stock from listing and registration.</p>
  `,
  strategicTransactionSnapshot: {
    title: "Transaction Snapshot",
    items: [
      { label: "Transaction Status", value: "Closed", note: "Completed August 16, 2024" },
      { label: "Cash Consideration", value: "$57.00 per share" },
      { label: "Tender Result", value: "92.8% tendered", note: "46,731,511 shares accepted" },
      { label: "Post-Close Listing", value: "Nasdaq suspension requested", note: "Form 25 and Form 15 planned" },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: true,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: true,
    whyItMatters: true,
  },
};

commonFilingEvents["form-425-regulatory-approval-fixture"] = {
  ...commonFilingEvents["strategic-transaction-merger-closing-fixture"],
  id: "form-425-regulatory-approval-fixture",
  ticker: "RUM",
  exchange: "NASDAQ",
  company: "Rumble Inc.",
  title: "Rumble Receives Final Regulatory Approval for Northern Data Business Combination",
  formType: "425",
  filedAt: "May 5, 2026 - 6:13 AM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1830081/000121390026052303/ea028606803-425_rumble.htm",
  eventType: "strategic_transaction",
  impact: "high",
  deliveryLevel: "alert",
  score: 75,
  signal: "neutral",
  price: "$5.76",
  changeAmount: "+$0.04",
  change: "+0.70%",
  filingFocus: "Final regulatory approval",
  filingBrief:
    "Rumble secured the final regulatory approval required for its Northern Data business combination, moving the transaction toward closing.",
  whyItMatters:
    "The final regulatory clearance removes a remaining closing condition and materially increases transaction certainty.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Rumble announced that the United Arab Emirates Ministry of Economy granted the final regulatory approval for its proposed business combination with Northern Data AG on April 29, 2026. No further regulatory approvals are required, closing is expected in mid-June 2026, and 16% of Northern Data shares not covered by support agreements had been tendered.",
  keyEvidence: [
    "The United Arab Emirates Ministry of Economy granted the required approval on April 29, 2026.",
    "Rumble stated that no further regulatory approvals are required for the transaction.",
    "Sixteen percent of Northern Data shares not subject to support agreements had been tendered.",
  ],
  watchNext: [
    "Completion of the exchange offer and business combination.",
    "Final tender participation and satisfaction or waiver of the remaining offer conditions.",
    "Post-closing Northern Data delisting and integration disclosures.",
  ],
  recentFilings: [
    {
      form: "S-4",
      eventType: "Strategic Transaction",
      title: "Exchange-offer registration statement declared effective",
      filedAt: "Apr 13, 2026",
      score: 70,
    },
    {
      form: "8-K",
      eventType: "Strategic Transaction",
      title: "Rumble signs Northern Data business combination agreement",
      filedAt: "Nov 10, 2025",
      score: 75,
    },
  ],
  relatedNews: [
    {
      title: "Final UAE approval clears a remaining condition for the Northern Data transaction",
      eventType: "strategic_transaction",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Exchange-offer participation becomes the next transaction milestone",
      eventType: "shareholder_vote",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Final regulatory approval removes a material closing condition, but the transaction remains pending until the offer closes.",
  context: {
    sector: "Communication Services",
    industry: "Internet Platforms",
    marketCap: "$2.50B",
    sharesOutstanding: "434.42M",
    publicFloat: "299.67M",
    publicFloatPercent: "69.0%",
    periods: {
      "1D": {
        sectorChange: "N/A",
        industryChange: "N/A",
        themeChange: "N/A",
        subThemeChange: "N/A",
        themeScore: 75,
        themeSignal: "neutral",
        topMovers: [],
      },
      "5D": {
        sectorChange: "N/A",
        industryChange: "N/A",
        themeChange: "N/A",
        subThemeChange: "N/A",
        themeScore: 75,
        themeSignal: "neutral",
        topMovers: [],
      },
      "30D": {
        sectorChange: "N/A",
        industryChange: "N/A",
        themeChange: "N/A",
        subThemeChange: "N/A",
        themeScore: 75,
        themeSignal: "neutral",
        topMovers: [],
      },
    },
  },
  priceSeries: buildPriceSeries({
    lastClose: 5.76,
    previousClose: 5.72,
    trend: [45, 46, 44, 47, 48, 47, 50, 51, 50, 52, 53, 54],
    volumeBase: 2_027_077,
  }),
  originalTextNote: "Fixture excerpt based on the filed Form 425 transaction update.",
  originalHtml: `
    <h3>Rumble Announces Receipt of All Regulatory Approvals</h3>
    <p>Rumble announced that its proposed business combination with Northern Data AG obtained the final regulatory approval. The United Arab Emirates Ministry of Economy granted the required approval on April 29, 2026, and no other regulatory approvals are required.</p>
    <p>Based on current information, closing is anticipated in mid-June 2026. Sixteen percent of Northern Data shares not subject to transaction support agreements had been tendered.</p>
  `,
  strategicTransactionSnapshot: null,
  form425TransactionSnapshot: {
    title: "Rumble Inc. Business Combination Update",
    items: [
      {
        label: "Regulatory Approval",
        value: "Final Approval Received",
        note: "UAE Ministry of Economy approval received April 29, 2026; no approvals remain",
      },
      {
        label: "Transaction Status",
        value: "Closing Pending",
        note: "Final regulatory approval increases closing certainty",
      },
      {
        label: "Expected Closing",
        value: "Mid-June 2026",
      },
      {
        label: "Tendered Shares",
        value: "16%",
        note: "Shares not subject to support agreements",
      },
    ],
  },
};

commonFilingEvents["proxy-vote-reverse-split-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "proxy-vote-reverse-split-fixture",
  ticker: "RNAZ",
  exchange: "NASDAQ",
  company: "TransCode Therapeutics, Inc.",
  title: "TransCode Therapeutics Special Meeting: Reverse Stock Split Vote",
  formType: "DEF 14A",
  filedAt: "Apr 11, 2025 - 5:01 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1829635/000110465925034266/tm252488-2_def14a.htm",
  eventType: "shareholder_vote",
  impact: "high",
  deliveryLevel: "alert",
  score: 78,
  signal: "volatile",
  price: "$8.43",
  changeAmount: "+$0.16",
  change: "+1.93%",
  filingFocus: "Reverse stock split vote",
  filingBrief:
    "TransCode Therapeutics seeks shareholder approval for a reverse stock split to meet Nasdaq minimum bid price requirements and avoid delisting.",
  whyItMatters:
    "Shareholder approval of the reverse stock split is critical for TransCode Therapeutics to maintain its Nasdaq listing and avoid the risks associated with OTC trading.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "TransCode Therapeutics is holding a special meeting on April 21, 2025, where shareholders will vote on a reverse stock split and an adjournment proposal. The reverse stock split aims to increase the per-share price to comply with Nasdaq listing rules and avoid potential delisting.",
  keyEvidence: [
    "The reverse stock split is intended to increase the common-stock price to meet Nasdaq minimum bid requirements.",
    "The proposed split ratio ranges from 1-for-10 to 1-for-40, with the exact ratio set by the board.",
    "The board recommends voting for the reverse stock split and adjournment proposals.",
  ],
  watchNext: [
    "Voting results for the reverse stock split and adjournment proposals.",
    "The final split ratio and effective date if shareholders approve the proposal.",
    "Updates on Nasdaq listing compliance after the reverse stock split.",
  ],
  recentFilings: [],
  relatedNews: [],
  scoreRationale:
    "The vote directly affects Nasdaq listing compliance and the issuer's near-term capital structure.",
  context: buildFinancingFixtureContext({
    marketCap: "$8.01M",
    publicFloat: "865,763",
    publicFloatPercent: "91.1%",
    score: 78,
    sharesOutstanding: "950,302",
    signal: "volatile",
    ticker: "RNAZ",
  }),
  priceSeries: buildPriceSeries({
    lastClose: 8.43,
    previousClose: 8.27,
    trend: [47, 46, 48, 45, 44, 43, 45, 47, 46, 48, 49, 50],
    volumeBase: 5_713,
  }),
  originalTextNote: "Fixture excerpt based on the filed definitive proxy statement.",
  originalHtml: `
    <h3>Proposal One: Reverse Stock Split Proposal</h3>
    <p>Stockholders are being asked to approve an amendment that permits the board to effect a reverse stock split at a ratio ranging from one-for-ten to one-for-forty. The exact ratio may be selected by the board without further stockholder approval.</p>
    <p>The primary goal is to increase the per-share market price of the common stock to meet Nasdaq minimum bid requirements. The number of authorized shares will remain unchanged.</p>
    <h3>Proposal Two: Adjournment Proposal</h3>
    <p>Stockholders are also being asked to permit an adjournment if additional votes are needed for the reverse stock split proposal.</p>
  `,
  proxyVote: {
    snapshot: {
      title: "Reverse Stock Split Vote",
      items: [
        {
          label: "Meeting Date",
          value: "April 21, 2025",
          note: "Virtual meeting at 9:30 a.m. Eastern Time",
        },
        { label: "Record Date", value: "April 2, 2025" },
        { label: "Proposal Count", value: "2" },
        {
          label: "Listing Issue",
          value: "Nasdaq Minimum Bid Price",
          note: "Reverse split aims to regain compliance",
        },
      ],
    },
    proposals: [
      {
        boardRecommendation: "Support",
        category: "Reverse split",
        details: [
          {
            label: "Split Ratio Range",
            value: "1:10 to 1:40",
            note: "Exact ratio to be set by the board",
          },
          {
            label: "Board Discretion",
            value: "Yes",
            note: "Ratio set without further stockholder approval",
          },
          {
            label: "Goal",
            value: "Regain Nasdaq Listing Compliance",
            note: "Avoid delisting and OTC trading risks",
          },
          {
            label: "Authorized Shares",
            value: "Unchanged",
            note: "Authorized shares remain 300,000,000",
          },
        ],
        explanation:
          "This proposal allows the board to reduce outstanding shares and increase the per-share price to meet Nasdaq listing rules.",
        id: "1",
        isShareholderProposal: false,
        title: "Approval of an Amendment to Effect a Reverse Stock Split",
      },
      {
        boardRecommendation: "Support",
        category: "Adjournment",
        details: [],
        explanation:
          "This proposal permits the meeting to be delayed if additional votes are needed for the reverse stock split proposal.",
        id: "2",
        isShareholderProposal: false,
        title: "Adjournment Proposal",
      },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: true,
    originalHtml: true,
    recentFilings: false,
    relatedNews: false,
    scoreRationale: true,
    summary: true,
    watchNext: true,
    whyItMatters: true,
  },
};

commonFilingEvents["governance-auditor-change-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "governance-auditor-change-fixture",
  ticker: "INFQ",
  exchange: "NYSE",
  company: "Infleqtion, Inc.",
  title: "Infleqtion Clarifies Withum Dismissal and Conditional KPMG Engagement",
  formType: "8-K/A",
  filedAt: "Mar 31, 2026 - 4:27 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/2007825/000119312526134682/d108106d8ka.htm",
  eventType: "leadership_governance",
  impact: "medium",
  deliveryLevel: "feed",
  score: 55,
  signal: "neutral",
  price: "$9.09",
  changeAmount: "+$0.03",
  change: "+0.33%",
  filingFocus: "Auditor change",
  filingBrief:
    "Infleqtion specified the effective dismissal date for Withum and retained KPMG subject to completion of filing and engagement conditions.",
  whyItMatters:
    "The amendment resolves the timing of the auditor transition, while KPMG's appointment remains conditional rather than fully effective.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Infleqtion dismissed WithumSmith+Brown, PC effective March 31, 2026 after completion of the 2025 audit. The Audit Committee approved KPMG LLP for the 2026 audit, but the engagement remains subject to the 2025 Form 10-K filing and execution of an engagement letter. The company reported no disagreements, reportable events, or prior consultations affecting the transition.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "8-K",
      eventType: "Governance Event",
      title: "Audit Committee approves auditor transition",
      filedAt: "Mar 26, 2026",
      score: 55,
    },
    {
      form: "8-K/A",
      eventType: "Governance Event",
      title: "Amendment supplies the effective dismissal date",
      filedAt: "Mar 31, 2026",
      score: 55,
    },
  ],
  relatedNews: [
    {
      title: "Infleqtion completes Withum audit services before auditor transition",
      eventType: "leadership_governance",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "KPMG engagement remains subject to filing and acceptance conditions",
      eventType: "leadership_governance",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "The filing clarifies a routine auditor transition with no disputes, while the new engagement remains conditional.",
  context: {
    sector: "Technology",
    industry: "Hardware & Electronics",
    marketCap: "$1.58B",
    sharesOutstanding: "173.52M",
    publicFloat: "41.40M",
    publicFloatPercent: "23.9%",
    themeGroup: "Corporate Governance",
    subTheme: "Auditor Oversight",
    periods: {
      "1D": {
        sectorChange: "+0.44%",
        industryChange: "+0.18%",
        themeChange: "+0.06%",
        subThemeChange: "-0.12%",
        themeScore: 55,
        themeSignal: "neutral",
        topMovers: [
          { symbol: "INFQ", change: "+0.33%", trend: [41, 42, 41, 43, 44, 43, 45, 44, 46, 47] },
          { symbol: "IONQ", change: "+1.14%", trend: [38, 40, 39, 42, 43, 45, 44, 46, 47, 49] },
          { symbol: "RGTI", change: "-0.62%", trend: [50, 48, 49, 47, 46, 44, 45, 43, 42, 41] },
          { symbol: "QBTS", change: "+0.48%", trend: [39, 40, 42, 41, 43, 44, 45, 44, 46, 47] },
        ],
      },
      "5D": {
        sectorChange: "+1.28%",
        industryChange: "+0.82%",
        themeChange: "+0.36%",
        subThemeChange: "+0.18%",
        themeScore: 55,
        themeSignal: "neutral",
        topMovers: [],
      },
      "30D": {
        sectorChange: "+3.42%",
        industryChange: "+2.18%",
        themeChange: "+1.06%",
        subThemeChange: "+0.72%",
        themeScore: 55,
        themeSignal: "neutral",
        topMovers: [],
      },
    },
  },
  priceSeries: buildPriceSeries({
    lastClose: 9.09,
    previousClose: 9.06,
    trend: [42, 43, 42, 44, 45, 44, 46, 45, 47, 48, 47, 49],
    volumeBase: 520_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed 8-K/A.",
  originalHtml: `
    <h3>Item 4.01 Changes in Registrant's Certifying Accountant</h3>
    <p>WithumSmith+Brown, PC was dismissed effective March 31, 2026 upon completion of its audit services. There were no disagreements or reportable events.</p>
    <p>The Audit Committee approved KPMG LLP as the Company's independent registered public accounting firm for the year ending December 31, 2026, subject to filing the 2025 Form 10-K and executing an engagement letter.</p>
  `,
  governanceEvent: {
    mode: "auditor_change",
    snapshot: {
      title: "Auditor Change Details",
      items: [
        { label: "Dismissed Accountant", value: "WithumSmith+Brown, PC" },
        { label: "New Accountant", value: "KPMG LLP" },
        { label: "Dismissal Date", value: "March 31, 2026", note: "Effective after audit services were completed" },
        { label: "Conditional Approval Date", value: "March 20, 2026", note: "Engagement remains subject to stated conditions" },
      ],
    },
    changesTitle: "Key Changes",
    changes: [
      {
        category: "Auditor Dismissal",
        title: "Withum audit services completed and dismissal became effective",
        explanation:
          "Infleqtion dismissed WithumSmith+Brown, PC after completion of the audit for the year ended December 31, 2025.",
        details: [
          { label: "Effective Date", value: "March 31, 2026" },
          { label: "Disagreements / Events", value: "None" },
          { label: "Audit Scope", value: "2025 consolidated financial statements" },
        ],
      },
      {
        category: "Auditor Appointment",
        title: "KPMG approved for the 2026 audit subject to conditions",
        explanation:
          "The Audit Committee approved KPMG LLP, but the appointment is not yet unconditional.",
        details: [
          { label: "Approval Date", value: "March 20, 2026" },
          { label: "Engagement Condition", value: "2025 Form 10-K filing and engagement letter" },
          { label: "Prior Consultations", value: "None" },
        ],
      },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: false,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  },
};

commonFilingEvents["operating-earnings-outlook-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "operating-earnings-outlook-fixture",
  ticker: "MDB",
  exchange: "NASDAQ",
  company: "MongoDB, Inc.",
  title: "MongoDB Reports Strong Q4 and Full Year Fiscal 2026 Results and Issues FY27 Guidance",
  formType: "8-K",
  filedAt: "Mar 2, 2026 - 4:07 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1441816/000162828026013199/0001628280-26-013199-index.html",
  eventType: "earnings",
  impact: "high",
  deliveryLevel: "alert",
  score: 85,
  signal: "bullish",
  price: "$342.08",
  changeAmount: "-$20.79",
  change: "-5.73%",
  filingFocus: "Earnings and outlook",
  filingBrief:
    "MongoDB delivered 27% Q4 revenue growth, record free cash flow, and higher fiscal 2027 revenue guidance.",
  whyItMatters:
    "Strong subscription growth and cash generation support the outlook, while management transitions remain a secondary execution factor.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "MongoDB reported fourth-quarter fiscal 2026 revenue of $695.1 million, up 27% year over year, and full-year revenue of $2.46 billion, up 23%. Free cash flow increased to $176.7 million from $22.9 million. The company guided first-quarter fiscal 2027 revenue to $659 million to $664 million and full-year revenue to $2.86 billion to $2.90 billion.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "8-K",
      eventType: "Earnings",
      title: "MongoDB reports fiscal 2026 fourth-quarter results",
      filedAt: "Mar 2, 2026",
      score: 85,
    },
    {
      form: "10-K",
      eventType: "Periodic Report",
      title: "MongoDB files fiscal 2026 annual report",
      filedAt: "Mar 20, 2026",
      score: 75,
    },
  ],
  relatedNews: [
    {
      title: "MongoDB subscription revenue rises 27% as Atlas demand remains firm",
      eventType: "earnings",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Fiscal 2027 outlook points to continued double-digit revenue growth",
      eventType: "earnings",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Revenue, subscription growth, free cash flow, and fiscal 2027 guidance all support a high-impact bullish reading.",
  context: buildOperatingFixtureContext(),
  priceSeries: buildPriceSeries({
    lastClose: 342.08,
    previousClose: 362.87,
    trend: [58, 56, 54, 55, 51, 49, 47, 48, 44, 42, 43, 40],
    volumeBase: 1_401_270,
  }),
  originalTextNote: "Fixture excerpt based on MongoDB's filed earnings 8-K.",
  originalHtml: `
    <h3>Item 2.02 Results of Operations and Financial Condition</h3>
    <p>MongoDB announced total revenue of $695.1 million for the fourth quarter of fiscal 2026, an increase of 27% year over year. Subscription revenue was $673.1 million.</p>
    <p>For the first quarter of fiscal 2027, MongoDB expects revenue of $659 million to $664 million. For the full year, the company expects revenue of $2.86 billion to $2.90 billion.</p>
  `,
  operatingEvent: {
    mode: "earnings",
    regulatoryStage: "not_applicable",
    snapshot: {
      title: "Earnings Snapshot",
      items: [
        { label: "Q4 Fiscal 2026 Revenue", value: "$695.1M", note: "Up 27% year over year" },
        { label: "Full Year Fiscal 2026 Revenue", value: "$2.46B", note: "Up 23% year over year" },
        { label: "Q4 Fiscal 2026 GAAP Net Income", value: "$15.5M", note: "$0.18 per share" },
        { label: "Q4 Fiscal 2026 Non-GAAP Net Income", value: "$142.7M", note: "$1.65 per share" },
      ],
    },
    performanceComparisons: [
      {
        label: "Total Revenue",
        currentLabel: "Q4 FY26",
        currentValue: "$695.1M",
        currentNumeric: 695_100_000,
        comparisonLabel: "Q4 FY25",
        comparisonValue: "$548.4M",
        comparisonNumeric: 548_398_000,
        comparisonBasis: "yoy",
        changeNote: "Up 27%",
      },
      {
        label: "Subscription Revenue",
        currentLabel: "Q4 FY26",
        currentValue: "$673.1M",
        currentNumeric: 673_100_000,
        comparisonLabel: "Q4 FY25",
        comparisonValue: "$531.0M",
        comparisonNumeric: 530_958_000,
        comparisonBasis: "yoy",
        changeNote: "Up 27%",
      },
      {
        label: "Free Cash Flow",
        currentLabel: "Q4 FY26",
        currentValue: "$176.7M",
        currentNumeric: 176_700_000,
        comparisonLabel: "Q4 FY25",
        comparisonValue: "$22.9M",
        comparisonNumeric: 22_900_000,
        comparisonBasis: "yoy",
        changeNote: "Up 672%",
      },
    ],
    guidanceMetrics: [
      {
        label: "Revenue",
        guidanceLabel: "Q1 Fiscal 2027",
        guidanceValue: "$659M to $664M",
        note: "Non-GAAP EPS: $1.15 to $1.19",
        performanceRelationship: "standalone",
      },
      {
        label: "Revenue",
        guidanceLabel: "Full Year Fiscal 2027",
        guidanceValue: "$2.86B to $2.90B",
        note: "Non-GAAP EPS: $5.75 to $5.93",
        performanceRelationship: "standalone",
      },
    ],
    businessUpdates: [
      {
        title: "Total Customers",
        value: "Over 65,200",
        summary: "Customer count as of January 31, 2026.",
      },
      {
        title: "Atlas Revenue Growth",
        value: "29%",
        summary: "Atlas growth for the fourth quarter and full fiscal year 2026.",
      },
      {
        title: "AI Capabilities",
        summary: "MongoDB added Voyage AI models and an AI-assisted data operations workflow.",
      },
    ],
    detailSections: [],
    secondaryUpdates: [
      {
        label: "Leadership Change",
        title: "Customer and accounting leadership transitions",
        summary: "MongoDB appointed a Chief Customer Officer and Chief Accounting Officer as two executives departed.",
      },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: false,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  },
};

commonFilingEvents["periodic-report-performance-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "periodic-report-performance-fixture",
  ticker: "AMZN",
  exchange: "NASDAQ",
  company: "Amazon.com, Inc.",
  title: "Amazon Reports Higher Q1 2026 Sales, Operating Income, and Net Income",
  formType: "10-Q",
  filedAt: "Apr 30, 2026 - 4:05 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000014/0001018724-26-000014-index.htm",
  eventType: "earnings",
  impact: "high",
  deliveryLevel: "alert",
  score: 80,
  signal: "bullish",
  price: "$190.20",
  changeAmount: "+$5.61",
  change: "+3.04%",
  filingFocus: "Quarterly report",
  filingBrief:
    "Amazon's first-quarter filing shows double-digit sales growth and a larger increase in operating income, led by AWS and international operations.",
  whyItMatters:
    "Sales, operating income, and net income all increased year over year, while non-operating investment gains also contributed materially to reported earnings.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Amazon reported first-quarter 2026 net sales of $181.5 billion, operating income of $23.9 billion, and net income of $30.3 billion. AWS sales increased 28%, international sales increased 19%, and gains tied to strategic AI investments increased non-operating income.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "10-K",
      eventType: "Periodic Report",
      title: "Amazon files fiscal 2025 annual report",
      filedAt: "Feb 6, 2026",
      score: 78,
    },
    {
      form: "8-K",
      eventType: "Earnings",
      title: "Amazon furnishes first-quarter earnings materials",
      filedAt: "Apr 30, 2026",
      score: 80,
    },
  ],
  relatedNews: [
    {
      title: "AWS growth and operating leverage lift Amazon's quarterly results",
      eventType: "earnings",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "AI investment gains add a material non-operating boost to net income",
      eventType: "earnings",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Broad year-over-year growth in sales and operating income supports a high-impact bullish reading, partly offset by the contribution from investment gains.",
  context: buildPeriodicFixtureContext(),
  priceSeries: buildPriceSeries({
    lastClose: 190.2,
    previousClose: 184.59,
    trend: [44, 46, 45, 49, 51, 50, 54, 56, 55, 59, 61, 63],
    volumeBase: 48_600_000,
  }),
  originalTextNote: "Fixture excerpt based on Amazon's filed Q1 2026 Form 10-Q.",
  originalHtml: `
    <h3>Part I. Financial Information</h3>
    <p>Net sales increased to $181.5 billion for the three months ended March 31, 2026. Operating income increased to $23.9 billion and net income increased to $30.3 billion.</p>
    <p>AWS sales increased 28% compared with the prior-year quarter, while international sales increased 19%.</p>
    <p>Second-quarter net sales are expected to be $194.0 billion to $199.0 billion, with operating income of $20.0 billion to $24.0 billion.</p>
  `,
  periodicReport: {
    mode: "report",
    snapshot: {
      title: "Quarterly Report Snapshot",
      items: [
        { label: "Reporting Period End", value: "March 31, 2026" },
        { label: "Total Net Sales", value: "$181.5 Billion" },
        { label: "Operating Income", value: "$23.9 Billion" },
        { label: "Cash & Cash Equivalents", value: "$101.8 Billion", note: "As of March 31, 2026" },
      ],
    },
    performanceComparisons: [
      {
        label: "Total Net Sales",
        currentLabel: "Q1 2026",
        currentValue: "$181.5B",
        currentNumeric: 181_519_000_000,
        comparisonLabel: "Q1 2025",
        comparisonValue: "$155.7B",
        comparisonNumeric: 155_667_000_000,
        comparisonBasis: "yoy",
        changeNote: "Up 17%",
      },
      {
        label: "Operating Income",
        currentLabel: "Q1 2026",
        currentValue: "$23.9B",
        currentNumeric: 23_852_000_000,
        comparisonLabel: "Q1 2025",
        comparisonValue: "$18.4B",
        comparisonNumeric: 18_405_000_000,
        comparisonBasis: "yoy",
        changeNote: "Up 30%",
      },
      {
        label: "Net Income",
        currentLabel: "Q1 2026",
        currentValue: "$30.3B",
        currentNumeric: 30_255_000_000,
        comparisonLabel: "Q1 2025",
        comparisonValue: "$17.1B",
        comparisonNumeric: 17_127_000_000,
        comparisonBasis: "yoy",
        changeNote: "Up 77%",
      },
    ],
    guidanceMetrics: [
      {
        guidanceLabel: "Guidance",
        guidanceValue: "$194.0B to $199.0B",
        label: "Q2 2026",
        note: "Expected growth of 16% to 19% YoY",
        performanceLabel: "Total Net Sales",
        performanceRelationship: "same_basis",
      },
      {
        guidanceLabel: "Guidance",
        guidanceValue: "$20.0B to $24.0B",
        label: "Q2 2026",
        note: "Compared with $19.2B in Q2 2025",
        performanceLabel: "Operating Income",
        performanceRelationship: "same_basis",
      },
    ],
    businessUpdates: [
      {
        title: "AWS Sales Growth",
        value: "28% increase",
        summary: "AWS sales increased as customer usage continued to expand.",
      },
      {
        title: "International Sales Growth",
        value: "19% increase",
        summary: "International sales benefited from higher unit sales, advertising, and subscription services.",
      },
      {
        title: "Strategic AI Investments",
        value: "$15.6B other income",
        summary: "Anthropic-related valuation and conversion gains materially increased non-operating income during the quarter.",
      },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: false,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  },
};

commonFilingEvents["periodic-amendment-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "periodic-amendment-fixture",
  ticker: "SHOP",
  exchange: "NASDAQ",
  company: "Shopify Inc.",
  title: "Shopify Amends 2025 10-K to Add Part III Information and Certifications",
  formType: "10-K/A",
  filedAt: "Apr 29, 2026 - 4:10 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1594805/000159480526000011/0001594805-26-000011-index.htm",
  eventType: "other",
  impact: "low",
  deliveryLevel: "archive",
  score: 30,
  signal: "neutral",
  price: "$147.20",
  changeAmount: "+$0.34",
  change: "+0.23%",
  filingFocus: "Annual report amendment",
  filingBrief:
    "Shopify added previously omitted Part III disclosures and updated CEO and CFO certifications without changing its financial statements.",
  whyItMatters:
    "The amendment completes governance and certification disclosures but does not restate or alter Shopify's reported fiscal 2025 financial results.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Shopify filed a 10-K/A to include Part III information that was not incorporated through a definitive proxy statement and to add new Section 302 certifications. The amendment has no financial statement impact.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "10-K",
      eventType: "Periodic Report",
      title: "Shopify files fiscal 2025 annual report",
      filedAt: "Feb 11, 2026",
      score: 75,
    },
  ],
  relatedNews: [],
  scoreRationale:
    "The filing adds required governance disclosures and certifications without changing reported financial results.",
  context: buildPeriodicFixtureContext(),
  priceSeries: buildPriceSeries({
    lastClose: 147.2,
    previousClose: 146.86,
    trend: [49, 48, 50, 51, 50, 52, 53, 52, 54, 55, 54, 55],
    volumeBase: 6_200_000,
  }),
  originalTextNote: "Fixture excerpt based on Shopify's filed fiscal 2025 Form 10-K/A.",
  originalHtml: `
    <h3>Explanatory Note</h3>
    <p>This amendment includes the information required by Part III of Form 10-K and adds new certifications under Section 302 of the Sarbanes-Oxley Act.</p>
    <p>No financial statements were restated or otherwise changed.</p>
  `,
  periodicReport: {
    mode: "amendment",
    snapshot: {
      title: "Report Amendment Snapshot",
      items: [
        { label: "Amendment Type", value: "Administrative Correction" },
        { label: "Affected Period", value: "FY 2025" },
        { label: "Amended Items", value: "Part III information, Item 15 certifications" },
        { label: "Financial Statement Impact", value: "None" },
      ],
    },
    changes: [
      {
        title: "Purpose of Amendment",
        value: "Include Part III information",
        note: "The original 10-K omitted Part III information under the permitted incorporation-by-reference process.",
      },
      {
        title: "Certifications",
        value: "New CEO/CFO certifications",
        note: "Item 15 was amended to include new Section 302 certifications.",
      },
    ],
  },
  genericAvailability: {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: false,
    originalHtml: true,
    recentFilings: true,
    relatedNews: false,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  },
};

commonFilingEvents["financing-dilution-share-count-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "financing-dilution-share-count-fixture",
  ticker: "STTK",
  exchange: "NASDAQ",
  company: "Shattuck Labs, Inc.",
  title: "Shattuck Labs Announces Private Placement With Common Stock and Warrants",
  formType: "8-K",
  filedAt: "Aug 5, 2025 - 4:15 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1680367/000119312525173010/0001193125-25-173010-index.htm",
  eventType: "dilution_risk",
  impact: "high",
  deliveryLevel: "alert",
  score: 84,
  signal: "bearish",
  price: "$7.53",
  changeAmount: "+$0.46",
  change: "+6.51%",
  filingFocus: "Private placement",
  filingBrief:
    "The financing includes fixed common-equivalent supply that can be compared with the filing-date share base.",
  whyItMatters:
    "The included common stock and pre-funded warrants exceed the current share base, creating severe potential dilution before any additional common-warrant exercise.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Shattuck agreed to sell common stock and pre-funded warrants for $46 million upfront, with common warrants capable of providing another $57 million if exercised. The fixed common-equivalent supply alone is large relative to the filing-date share base, while the common warrants add a further conditional overhang.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "S-3",
      eventType: "Offering / Registration",
      title: "Registration statement provides the resale path for placement securities",
      filedAt: "Follow-up filing",
      score: 72,
    },
    {
      form: "8-K",
      eventType: "FDA / Clinical",
      title: "Clinical update describes the program milestone tied to closing",
      filedAt: "Related filing",
      score: 68,
    },
  ],
  relatedNews: [
    {
      title: "Private placement materially expands Shattuck's potential common-equity supply",
      eventType: "dilution_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Clinical milestone remains the principal financing closing condition",
      eventType: "fda_clinical",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Fixed common-equivalent supply exceeds the filing-date share base, placing the transaction in the severe dilution tier despite the additional capital raised.",
  context: buildFinancingFixtureContext({
    marketCap: "$360.7M",
    publicFloat: "45.24M",
    publicFloatPercent: "94.4%",
    score: 84,
    sharesOutstanding: "47.90M",
    signal: "bearish",
    ticker: "STTK",
  }),
  priceSeries: buildPriceSeries({
    lastClose: 7.53,
    previousClose: 7.07,
    trend: [47, 45, 48, 50, 49, 52, 55, 53, 57, 59, 58, 61],
    volumeBase: 780_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed 8-K and financing exhibit.",
  originalHtml: `
    <h3>Item 1.01 Entry into a Material Definitive Agreement</h3>
    <p>The Company entered into a securities purchase agreement for a private placement of common stock, pre-funded warrants, and common warrants. Upfront gross proceeds are expected to be approximately $46 million before fees and expenses.</p>
    <h3>Item 3.02 Unregistered Sales of Equity Securities</h3>
    <p>The fixed common-equivalent supply includes 15,225,158 common shares and pre-funded warrants covering up to 37,410,188 shares. Common warrants covering up to 52,635,346 additional shares are conditional supply.</p>
  `,
  financingDilution: {
    snapshot: {
      title: "Financing Snapshot",
      items: [
        {
          label: "Gross Proceeds",
          value: "Up to $103 Million",
          note: "$46M upfront plus $57M only if all common warrants are exercised",
        },
        { label: "Upfront Proceeds", value: "$46 Million", note: "Before fees and expenses" },
        { label: "Common Stock Issued", value: "15,225,158 Shares" },
        { label: "Pre-funded Warrants", value: "Up to 37,410,188", note: "To purchase Common Stock" },
      ],
    },
    scale: {
      basis: {
        label: "Shares outstanding",
        note: "As of latest market context",
        numericValue: 47_903_215,
        value: "47,903,215",
      },
      caption: "Fixed supply versus filing-date shares",
      headlineLabel: "Potential Dilution",
      headlineValue: "109.9%",
      mode: "shares",
      note: "Only compatible fixed common-equivalent quantities are included. Common warrants are shown separately as conditional supply.",
      segments: [
        {
          label: "Common Stock Issued",
          numericValue: 15_225_158,
          rowRole: "counted",
          supplyType: "common_stock",
          tone: "supply",
          value: "15,225,158",
        },
        {
          label: "Pre-funded Warrants",
          note: "Issuable upon exercise",
          numericValue: 37_410_188,
          rowRole: "counted",
          supplyType: "pre_funded_warrant",
          tone: "supply",
          value: "Up to 37,410,188",
        },
        {
          label: "Common Warrants",
          note: "Issuable upon exercise",
          numericValue: 52_635_346,
          rowRole: "conditional",
          supplyType: "warrant",
          tone: "conditional",
          value: "Up to 52,635,346",
        },
      ],
      subtitle: "Fixed common-equivalent supply compared with the filing-date share base.",
      title: "Share Overhang",
      total: {
        denominator: "47,903,215",
        numerator: "52,635,346",
        ratio: "109.9%",
        title: "Dilution vs Current Shares",
      },
    },
    offeringDetails: [
      { label: "Purchaser", value: "Certain institutional accredited investors" },
      { label: "Placement Agent", value: "Wedbush & Co., LLC" },
      { label: "Agreement Date", value: "August 4, 2025" },
      { label: "Closing Condition", value: "IND clearance for SL-325 and customary closing conditions" },
      { label: "Use of Proceeds", value: "SL-325 clinical development and general corporate purposes" },
      { label: "Registration Rights", value: "Resale registration for Shares and Warrant Shares" },
    ],
    instruments: [
      {
        type: "Pre-funded Warrant",
        securities: "37,410,188 shares",
        exerciseOrConversionPrice: "$0.0001",
        termOrLimits: "Exercisable until fully exercised",
      },
      {
        type: "Common Warrant",
        securities: "52,635,346 shares",
        exerciseOrConversionPrice: "$1.0846",
        termOrLimits: "Expires 30 days after Phase 1 SL-325 data; ownership limits apply",
      },
    ],
  },
  genericAvailability: financingFixtureAvailability(),
};

commonFilingEvents["financing-dilution-extreme-scale-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "financing-dilution-extreme-scale-fixture",
  ticker: "FCUV",
  exchange: "NASDAQ",
  company: "Focus Universal Inc.",
  title: "Focus Universal Closes $10M Convertible Preferred Stock Private Placements",
  formType: "8-K",
  filedAt: "Oct 22, 2025",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1590418/000168316825007784/focus_8k.htm",
  eventType: "dilution_risk",
  impact: "high",
  deliveryLevel: "alert",
  score: 78,
  signal: "bearish",
  price: "$3.48",
  changeAmount: "-$0.12",
  change: "-3.33%",
  filingFocus: "Convertible preferred stock financing",
  filingBrief:
    "Series A establishes a fixed 825,000-share common equivalent, while Series B converts under a future VWAP-based formula.",
  whyItMatters:
    "The fixed Series A common equivalent alone equals 409.8% of the comparison share base; the separate Series B conversion remains variable and is not added to that ratio.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Focus Universal completed a $3 million Series A preferred stock placement and entered into a $7 million Series B commitment funded in tranches. Series A converts into a fixed 825,000 common shares. Series B converts at 85% of the lowest 10-day VWAP, subject to its stated floor and ownership limits, so its final common-share supply is not fixed at filing.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "S-1",
      eventType: "Offering / Registration",
      title: "Registration statement is a funding condition for later Series B tranches",
      filedAt: "Related filing",
      score: 68,
    },
    {
      form: "8-K",
      eventType: "Dilution Risk",
      title: "Preferred stock agreements establish fixed and variable conversion terms",
      filedAt: "Same transaction",
      score: 78,
    },
  ],
  relatedNews: [
    {
      title: "Fixed Series A conversion exceeds four times Focus Universal's share base",
      eventType: "dilution_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Series B funding remains tied to registration and information-statement conditions",
      eventType: "capital_structure",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Fixed Series A supply exceeds four times the comparison share base, while the variable-price Series B commitment adds further dilution uncertainty without a fixed share total.",
  context: buildFinancingFixtureContext({
    marketCap: "$70.0M",
    publicFloat: "0.19M",
    publicFloatPercent: "94.4%",
    score: 78,
    sharesOutstanding: "0.20M",
    signal: "bearish",
    ticker: "FCUV",
  }),
  priceSeries: buildPriceSeries({
    lastClose: 3.48,
    previousClose: 3.6,
    trend: [58, 56, 54, 55, 51, 49, 47, 45, 46, 43, 42, 40],
    volumeBase: 185_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed 8-K and preferred stock agreements.",
  originalHtml: `
    <h3>Item 1.01 Entry into a Material Definitive Agreement</h3>
    <p>The Company completed a Series A preferred stock placement and entered into a Series B preferred stock purchase agreement. The Series A preferred stock is convertible at 1.1 common shares per preferred share.</p>
    <p>The Series B conversion price is based on 85% of the lowest VWAP during the ten trading days immediately before conversion, subject to the stated floor and beneficial-ownership limitation.</p>
  `,
  financingDilution: {
    snapshot: {
      title: "Financing Snapshot",
      items: [
        { label: "Total Commitment", value: "$10 Million" },
        { label: "Series A Funding", value: "$3 Million", note: "Funded at closing" },
        { label: "Series B Commitment", value: "$7 Million", note: "Funded in three tranches" },
        { label: "Conversion Structure", value: "Fixed Series A + Variable Series B" },
      ],
    },
    scale: {
      basis: {
        label: "Current Shares Outstanding",
        note: "Latest market context",
        numericValue: 201_323,
        value: "201,323 Shares",
      },
      caption: "Included fixed supply versus current shares",
      headlineLabel: "Fixed Dilution",
      headlineValue: "409.8%",
      mode: "shares",
      note: "The headline ratio includes only the fixed Series A common equivalent. Series B remains separate because its future VWAP-based conversion does not establish a fixed common-share total.",
      segments: [
        {
          label: "Series A Preferred Stock",
          note: "750,000 preferred shares convertible at 1.1 common shares each",
          numericValue: 825_000,
          rowRole: "counted",
          supplyType: "convertible_preferred",
          tone: "supply",
          value: "825,000 Common-Share Equivalent",
        },
        {
          label: "Series B Preferred Stock",
          note: "Common-share total varies with the future conversion price",
          numericValue: 8_236,
          rowRole: "conditional",
          supplyType: "variable_convertible_preferred",
          tone: "conditional",
          value: "Up to 8,236 Preferred Shares",
        },
      ],
      subtitle: "Fixed common-equivalent supply exceeds the scale of a standard proportional bar.",
      title: "Potential Dilution from Preferred Stock",
      total: {
        denominator: "201,323",
        numerator: "825,000",
        ratio: "409.8%",
        title: "Dilution vs Current Shares",
      },
    },
    offeringDetails: [
      { label: "Purchaser / Investor", value: "Edward Lee and other accredited investors" },
      { label: "Placement Agent", value: "Spartan Capital Securities, LLC" },
      { label: "Agreement Dates", value: "October 15 and October 21, 2025" },
      { label: "Funding Structure", value: "$3M funded; $7M Series B commitment in three tranches" },
      { label: "Closing Conditions", value: "S-1 and Information Statement effectiveness for later tranches" },
    ],
    instruments: [
      {
        type: "Series A Preferred Stock",
        securities: "750,000 preferred shares; 825,000 common-share equivalent",
        exerciseOrConversionPrice: "1.1 common shares per preferred share",
        termOrLimits: "Holder conversion option; no redemption rights",
      },
      {
        type: "Series B Preferred Stock",
        securities: "Up to 8,236 preferred shares; common-share total varies",
        exerciseOrConversionPrice: "85% of the lowest 10-day VWAP before conversion",
        resetOrFloor: "20% of the applicable Nasdaq minimum price",
        termOrLimits: "Holder conversion option; 4.99% ownership limit, adjustable to 9.99%",
      },
    ],
  },
  genericAvailability: financingFixtureAvailability(),
};

commonFilingEvents["financing-dilution-atm-amount-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "financing-dilution-atm-amount-fixture",
  ticker: "NTLA",
  exchange: "NASDAQ",
  company: "Intellia Therapeutics, Inc.",
  title: "Intellia Expands At-the-Market Program Capacity Alongside Clinical Update",
  formType: "8-K",
  filedAt: "Apr 7, 2026 - 4:05 PM ET",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1652130/000119312526084309/0001193125-26-084309-index.htm",
  eventType: "dilution_risk",
  impact: "high",
  deliveryLevel: "feed",
  score: 70,
  signal: "volatile",
  price: "$14.22",
  changeAmount: "-$1.22",
  change: "-7.93%",
  filingFocus: "ATM capacity expansion",
  filingBrief:
    "The company expanded its at-the-market capacity while also reporting the removal of a clinical hold.",
  whyItMatters:
    "The ATM creates substantial future financing capacity, but the number of shares depends on future sale prices and therefore cannot be treated as fixed dilution today.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "Intellia increased its aggregate ATM program size to approximately $1.035 billion after selling about $635.3 million, leaving $400 million of current capacity. Actual issuance, pricing, and timing remain discretionary, so the relevant scale is remaining dollar capacity versus market capitalization rather than an assumed share count.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "S-3",
      eventType: "Offering / Registration",
      title: "Shelf registration supports future at-the-market sales",
      filedAt: "Related filing",
      score: 66,
    },
    {
      form: "8-K",
      eventType: "FDA / Clinical",
      title: "FDA removes the clinical hold on the MAGNITUDE study",
      filedAt: "Same filing",
      score: 82,
    },
  ],
  relatedNews: [
    {
      title: "Clinical-hold removal offsets part of the expanded ATM financing risk",
      eventType: "fda_clinical",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "ATM capacity gives Intellia flexibility but leaves issuance timing open",
      eventType: "dilution_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "Remaining ATM capacity equals about one quarter of market capitalization, while uncertain issuance timing and a positive clinical catalyst keep the event below the fixed-dilution alert tier.",
  context: buildFinancingFixtureContext({
    marketCap: "$1.595B",
    publicFloat: "106.24M",
    publicFloatPercent: "94.7%",
    score: 70,
    sharesOutstanding: "112.21M",
    signal: "volatile",
    ticker: "NTLA",
  }),
  priceSeries: buildPriceSeries({
    lastClose: 14.215,
    previousClose: 15.44,
    trend: [62, 60, 61, 58, 55, 54, 51, 49, 47, 45, 46, 43],
    volumeBase: 2_600_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed 8-K and ATM sales agreement.",
  originalHtml: `
    <h3>Item 8.01 Other Events</h3>
    <p>The Company expanded the aggregate amount available under its at-the-market sales program. Shares may be sold from time to time at prevailing market prices.</p>
    <p>The filing also reported that the FDA removed the clinical hold on the MAGNITUDE Phase 3 study.</p>
  `,
  financingDilution: {
    snapshot: {
      title: "Financing Snapshot",
      items: [
        { label: "ATM Program Size", value: "$1,035,316,650", note: "Increased from $750,000,000" },
        { label: "Sold to Date", value: "$635,316,650" },
        { label: "Remaining Capacity", value: "$400,000,000" },
        { label: "Capacity vs Market Cap", value: "25.1%", note: "Based on latest market context" },
      ],
    },
    scale: {
      basis: {
        label: "Market capitalization",
        note: "Latest market context",
        numericValue: 1_595_072_627,
        value: "$1.595B",
      },
      caption: "Program capacity versus market capitalization",
      headlineLabel: "ATM Capacity",
      headlineValue: "25.1%",
      mode: "amount",
      note: "ATM capacity measures potential financing scale. Actual dilution depends on the amount sold and the share price at each sale.",
      segments: [
        {
          label: "Remaining ATM Capacity",
          numericValue: 400_000_000,
          rowRole: "reference",
          roleBadge: "Capacity",
          roleKind: "included",
          supplyType: "atm_capacity",
          tone: "conditional",
          value: "$400,000,000",
        },
      ],
      subtitle: "Dollar capacity is compared with market value because the future share count is not fixed.",
      title: "ATM Capacity",
      total: {
        denominator: "$1,595,072,627",
        numerator: "$400,000,000",
        ratio: "25.1%",
        title: "Capacity vs Market Cap",
      },
    },
    offeringDetails: [
      { label: "Agreement Date", value: "March 2, 2026", note: "Amendment No. 2" },
      { label: "Sales Agent", value: "Jefferies LLC", note: "Best efforts basis" },
      { label: "Compensation", value: "Up to 3.0% of gross proceeds" },
      { label: "Use of Proceeds", value: "General corporate purposes" },
    ],
    instruments: [],
  },
  genericAvailability: financingFixtureAvailability(),
};

commonFilingEvents["financing-dilution-a-to-e-fixture"] = {
  ...commonFilingEvents["financing-dilution-share-count-fixture"],
  id: "financing-dilution-a-to-e-fixture",
  ticker: "BBLG",
  exchange: "NASDAQ",
  company: "Bone Biologics Corporation",
  title: "Bone Biologics Prices Private Offering of Warrants and Pre-Funded Warrants",
  filedAt: "Jul 9, 2026 - 4:30 PM ET",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1419554/000149315226032694/0001493152-26-032694-index.html",
  score: 78,
  signal: "bearish",
  price: "$1.39",
  changeAmount: "+$0.01",
  change: "+0.72%",
  filingFocus: "Private warrant offering",
  filingBrief:
    "Bone Biologics completed a private offering of pre-funded warrants and common stock warrants, raising $2.7 million in net proceeds with substantial conditional warrant supply.",
  whyItMatters:
    "The immediately exercisable pre-funded warrants exceed the current share base, while three additional warrant series create separate conditional supply subject to shareholder approval.",
  summary:
    "Bone Biologics sold 2,112,677 pre-funded warrants and issued Series F, Series G, and placement-agent warrants. The offering generated approximately $2.7 million in net proceeds, while the pre-funded warrants represent immediate counted supply and the other warrant series remain conditional on shareholder approval.",
  keyEvidence: [
    "The offering included pre-funded warrants covering 2,112,677 shares.",
    "Series F and Series G warrants each cover 2,112,677 shares, subject to shareholder approval.",
    "Placement-agent warrants cover an additional 126,761 shares.",
  ],
  watchNext: [],
  recentFilings: [
    {
      id: "9c533fbd-7516-49a8-af57-ffd686b2cde7",
      form: "S-1",
      eventType: "Dilution Risk",
      title: "Bone Biologics registers offering securities for resale",
      filedAt: "Jul 17, 2026",
      score: 88,
    },
  ],
  relatedNews: [],
  scoreRationale:
    "Immediate pre-funded supply exceeds the current share base, and multiple additional warrant series materially increase the conditional overhang.",
  context: buildFinancingFixtureContext({
    marketCap: "$2.50M",
    publicFloat: "1.79M",
    publicFloatPercent: "100.0%",
    score: 78,
    sharesOutstanding: "1.80M",
    signal: "bearish",
    ticker: "BBLG",
  }),
  priceSeries: buildPriceSeries({
    lastClose: 1.39,
    previousClose: 1.38,
    trend: [52, 50, 49, 51, 48, 47, 49, 50, 48, 51, 52, 53],
    volumeBase: 23_993,
  }),
  originalTextNote: "Fixture excerpt based on the filed 8-K and warrant agreements.",
  originalHtml: `
    <h3>Private Offering</h3>
    <p>The Company sold pre-funded warrants covering 2,112,677 shares and issued Series F and Series G warrants covering 2,112,677 shares each. Placement-agent warrants cover an additional 126,761 shares.</p>
    <p>The common-stock warrants become exercisable upon shareholder approval. Net proceeds were approximately $2.7 million.</p>
  `,
  financingDilution: {
    snapshot: {
      title: "Financing Snapshot",
      items: [
        { label: "Net Proceeds", value: "$2.7 Million" },
        { label: "Offering Size", value: "2,112,677 Pre-Funded Warrants + 4,225,354 Warrants" },
        { label: "Combined Purchase Price", value: "$1.419 per Pre-Funded Warrant and accompanying Warrants" },
        { label: "Potential Gross Proceeds (Warrants)", value: "$6 Million", note: "If fully exercised on a cash basis" },
      ],
    },
    scale: {
      basis: {
        label: "Current Shares Outstanding",
        note: "Latest market context",
        numericValue: 1_795_260,
        value: "1.80M Shares",
      },
      caption: "Counted supply versus current shares",
      headlineLabel: "Immediate Dilution",
      headlineValue: "117.7%",
      mode: "shares",
      note: "Headline ratio excludes conditional future supply from Series F, Series G, and placement-agent warrants, which require shareholder approval.",
      segments: [
        {
          label: "Pre-Funded Warrants",
          note: "Immediately exercisable at nominal price",
          numericValue: 2_112_677,
          rowRole: "counted",
          supplyType: "warrant",
          tone: "supply",
          value: "2,112,677 Shares",
        },
        {
          label: "Series F Warrants",
          note: "Exercisable upon shareholder approval",
          numericValue: 2_112_677,
          rowRole: "conditional",
          supplyType: "warrant",
          tone: "conditional",
          value: "2,112,677 Shares",
        },
        {
          label: "Series G Warrants",
          note: "Exercisable upon shareholder approval",
          numericValue: 2_112_677,
          rowRole: "conditional",
          supplyType: "warrant",
          tone: "conditional",
          value: "2,112,677 Shares",
        },
        {
          label: "Placement Agent Warrants",
          note: "Exercisable upon shareholder approval",
          numericValue: 126_761,
          rowRole: "conditional",
          supplyType: "warrant",
          tone: "conditional",
          value: "126,761 Shares",
        },
      ],
      subtitle: "Immediate common-equivalent supply compared with the current share base.",
      title: "Potential Dilution from Warrants",
      total: {
        denominator: "1,795,260",
        numerator: "2,112,677",
        ratio: "117.7%",
        title: "Dilution vs Current Shares",
      },
    },
    offeringDetails: [
      { label: "Purchaser / Investor", value: "One investor" },
      { label: "Placement Agent", value: "H.C. Wainwright & Co., LLC" },
      { label: "Agreement Date", value: "July 7, 2026" },
      { label: "Closing Date", value: "July 9, 2026" },
      { label: "Use of Proceeds", value: "Clinical trials, patent portfolio, working capital, and general corporate purposes" },
      { label: "Shareholder Approval", value: "Required for warrant issuance and underlying shares" },
    ],
    instruments: [
      {
        type: "Pre-Funded Warrant",
        securities: "2,112,677 Shares",
        exerciseOrConversionPrice: "$0.001 per share",
        termOrLimits: "Immediately exercisable until exercised in full; ownership limitation applies",
      },
      {
        type: "Series F Warrant",
        securities: "2,112,677 Shares",
        exerciseOrConversionPrice: "$1.42 per share",
        termOrLimits: "Exercisable after shareholder approval; five-year term; ownership limitation applies",
      },
      {
        type: "Series G Warrant",
        securities: "2,112,677 Shares",
        exerciseOrConversionPrice: "$1.42 per share",
        termOrLimits: "Exercisable after shareholder approval; 18-month term; ownership limitation applies",
      },
      {
        type: "Placement Agent Warrant",
        securities: "126,761 Shares",
        exerciseOrConversionPrice: "$1.775 per share",
        termOrLimits: "Substantially the same terms as Series F warrants",
      },
    ],
  },
  genericAvailability: financingFixtureAvailability(),
};

commonFilingEvents["financing-dilution-variable-conversion-fixture"] = {
  ...commonFilingEvents["tsla-8k-operational-update"],
  id: "financing-dilution-variable-conversion-fixture",
  ticker: "GCTS",
  exchange: "NYSE",
  company: "GCT Semiconductor Holding, Inc.",
  title: "GCT Semiconductor Offers Up to $20M of Mandatory Convertible Notes",
  formType: "424B5",
  filedAt: "Mar 30, 2026",
  source: "SEC EDGAR",
  sourceUrl:
    "https://www.sec.gov/Archives/edgar/data/1851961/000092963826001255/a424b5.htm",
  eventType: "dilution_risk",
  impact: "high",
  deliveryLevel: "alert",
  score: 80,
  signal: "bearish",
  price: "$2.52",
  changeAmount: "-$0.05",
  change: "-1.95%",
  filingFocus: "Variable-price convertible note financing",
  filingBrief:
    "The notes convert at a future VWAP-based price, so the filing establishes financing principal but no fixed common-share total.",
  whyItMatters:
    "A standing 5% conversion discount and no stated floor make the share issuance price-sensitive: lower stock prices require more shares for the same principal.",
  bullishPoints: [],
  bearishPoints: [],
  summary:
    "GCT may issue up to $20 million of unsecured, interest-free mandatory convertible notes to Obsidian Global GP LLC in advances of up to $500,000. Each advance is funded at 96.5% of principal, and the notes mature 24 months after issuance. Common shares are issued at 95% of the three-day average VWAP measured immediately before conversion, so the final share count is not fixed at filing. The company estimates approximately $18.7 million of net proceeds for working capital, general corporate purposes, and debt repayment.",
  keyEvidence: [],
  watchNext: [],
  recentFilings: [
    {
      form: "S-3",
      eventType: "Offering / Registration",
      title: "Shelf registration supports the convertible-note offering",
      filedAt: "Apr 1, 2025",
      score: 55,
    },
    {
      form: "424B5",
      eventType: "Dilution Risk",
      title: "Earlier variable-price convertible-note facility",
      filedAt: "Dec 15, 2025",
      score: 78,
    },
  ],
  relatedNews: [
    {
      title: "Future VWAP pricing leaves GCT's final common-share supply open",
      eventType: "dilution_risk",
      source: "Stock Radar",
      age: "Related coverage",
    },
    {
      title: "Ownership and exchange caps limit issuance without fixing dilution",
      eventType: "capital_structure",
      source: "Stock Radar",
      age: "Related coverage",
    },
  ],
  scoreRationale:
    "A standing conversion discount with no stated floor creates price-sensitive dilution that can expand as the stock falls, while the $20 million principal cap limits financing size but not the final share count.",
  context: {
    industry: "Semiconductors & Compute",
    marketCap: "$144.1M",
    periods: {
      "1D": {
        industryChange: "-0.42%",
        sectorChange: "+0.18%",
        themeScore: 80,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "GCTS", change: "-1.95%", trend: [54, 52, 53, 50, 49, 48, 46, 45, 47, 44] },
          { symbol: "QCOM", change: "+0.64%", trend: [38, 39, 41, 40, 42, 43, 42, 44, 46, 47] },
          { symbol: "MRVL", change: "-0.71%", trend: [49, 47, 48, 46, 44, 45, 42, 41, 40, 39] },
          { symbol: "AVGO", change: "+1.12%", trend: [34, 35, 37, 36, 39, 41, 40, 43, 45, 47] },
          { symbol: "AMD", change: "-0.36%", trend: [48, 46, 47, 45, 43, 42, 44, 41, 40, 39] },
          { symbol: "MU", change: "+0.82%", trend: [36, 38, 37, 40, 42, 41, 44, 45, 47, 48] },
        ],
      },
      "5D": {
        industryChange: "-1.08%",
        sectorChange: "+0.46%",
        themeScore: 80,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "GCTS", change: "-4.60%", trend: [58, 56, 55, 52, 53, 49, 47, 45, 43, 41] },
          { symbol: "QCOM", change: "+1.34%", trend: [37, 38, 40, 39, 41, 43, 44, 45, 47, 48] },
          { symbol: "MRVL", change: "-2.14%", trend: [52, 50, 48, 49, 46, 44, 43, 41, 40, 38] },
          { symbol: "AVGO", change: "+2.26%", trend: [33, 35, 36, 38, 40, 42, 41, 44, 46, 48] },
          { symbol: "AMD", change: "-1.18%", trend: [50, 48, 47, 45, 46, 43, 42, 40, 39, 38] },
          { symbol: "MU", change: "+1.92%", trend: [34, 36, 38, 37, 40, 42, 43, 45, 46, 48] },
        ],
      },
      "30D": {
        industryChange: "-3.64%",
        sectorChange: "+1.32%",
        themeScore: 80,
        themeSignal: "bearish",
        topMovers: [
          { symbol: "GCTS", change: "-12.40%", trend: [64, 61, 59, 56, 53, 51, 48, 45, 43, 40] },
          { symbol: "QCOM", change: "+3.48%", trend: [35, 37, 39, 38, 41, 43, 44, 46, 48, 50] },
          { symbol: "MRVL", change: "-5.22%", trend: [56, 53, 51, 49, 47, 45, 43, 42, 40, 38] },
          { symbol: "AVGO", change: "+6.10%", trend: [31, 34, 36, 38, 40, 43, 45, 47, 49, 52] },
          { symbol: "AMD", change: "-2.76%", trend: [52, 50, 48, 46, 47, 44, 42, 41, 39, 38] },
          { symbol: "MU", change: "+4.24%", trend: [33, 35, 37, 39, 38, 42, 44, 46, 48, 50] },
        ],
      },
    },
    publicFloat: "44.08M",
    publicFloatPercent: "77.1%",
    sector: "Technology",
    sharesOutstanding: "57.20M",
  },
  priceSeries: buildPriceSeries({
    lastClose: 2.52,
    previousClose: 2.57,
    trend: [54, 52, 53, 50, 49, 48, 46, 45, 47, 44, 43, 42],
    volumeBase: 330_000,
  }),
  originalTextNote: "Fixture excerpt based on the filed 424B5 prospectus supplement.",
  originalHtml: `
    <h3>Mandatory Convertible Promissory Notes</h3>
    <p>The Company may issue up to $20 million aggregate principal amount of unsecured, interest-free mandatory convertible promissory notes to Obsidian Global GP LLC. Each advance may be up to $500,000 and is funded at 96.5% of principal.</p>
    <p>The conversion price equals 95% of the average VWAP during the three trading days immediately before the conversion notice. The notes mature 24 months after issuance and are subject to beneficial-ownership and NYSE exchange limitations.</p>
  `,
  financingDilution: {
    snapshot: {
      title: "Financing Snapshot",
      items: [
        { label: "Financing Type", value: "Mandatory convertible notes" },
        { label: "Maximum Principal", value: "$20M" },
        {
          label: "Purchase Funding",
          value: "96.5% of principal",
          note: "3.5% original issue discount",
        },
        {
          label: "Conversion Price",
          value: "95% of 3-day VWAP",
          note: "Set immediately before conversion",
        },
      ],
    },
    offeringDetails: [
      { label: "Investor", value: "Obsidian Global GP LLC" },
      { label: "Agreement Date", value: "March 25, 2026" },
      { label: "Draw Structure", value: "Up to $500,000 per advance" },
      { label: "Estimated Net Proceeds", value: "Approximately $18.7M" },
      {
        label: "Use of Proceeds",
        value: "Working capital, general corporate purposes, and debt repayment",
      },
    ],
    instruments: [
      {
        type: "Convertible Note",
        securities: "Up to $20M principal; common-share count varies",
        exerciseOrConversionPrice: "Not fixed yet; 95% of 3-day average VWAP",
        resetOrFloor: "No floor stated",
        termOrLimits: "0% interest; 24-month maturity; holder option or mandatory conversion; 4.99% ownership and NYSE exchange caps",
      },
    ],
  },
  genericAvailability: financingFixtureAvailability(),
};

function offeringRegistrationFixture({
  company,
  data,
  deliveryLevel,
  eventType,
  exchange,
  filedAt,
  filingBrief,
  formType,
  id,
  originalHtml,
  score,
  signal,
  sourceUrl,
  summary,
  ticker,
  title,
}: {
  company: string;
  data: OfferingRegistrationData;
  deliveryLevel: FilingEvent["deliveryLevel"];
  eventType: string;
  exchange: string;
  filedAt: string;
  filingBrief: string;
  formType: string;
  id: string;
  originalHtml: string;
  score: number;
  signal: DetailTone;
  sourceUrl: string;
  summary: string;
  ticker: string;
  title: string;
}): FilingEvent {
  return {
    ...commonFilingEvents["tsla-8k-operational-update"],
    bearishPoints: [],
    bullishPoints: [],
    change: "",
    changeAmount: "",
    company,
    context: emptySectorThemeContext(score, signal),
    deliveryLevel,
    eventType,
    exchange,
    filedAt,
    filingBrief,
    filingFocus: "",
    formType,
    genericAvailability: {
      bearishPoints: false,
      bullishPoints: false,
      context: false,
      filingBrief: true,
      keyEvidence: true,
      originalHtml: true,
      recentFilings: false,
      relatedNews: false,
      scoreRationale: true,
      summary: true,
      watchNext: false,
      whyItMatters: true,
    },
    id,
    impact: score >= 75 ? "high" : "medium",
    keyEvidence: data.snapshot.items.slice(0, 3).map((item) =>
      [item.label, item.value].filter(Boolean).join(": "),
    ),
    offeringRegistration: data,
    originalHtml,
    originalTextNote: `Fixture excerpt based on the filed ${formType}.`,
    price: "N/A",
    priceSeries: null,
    recentFilings: [],
    relatedNews: [],
    score,
    scoreRationale: filingBrief,
    signal,
    source: "SEC EDGAR",
    sourceUrl,
    summary,
    ticker,
    title,
    watchNext: [],
    whyItMatters: filingBrief,
  };
}

commonFilingEvents["offering-registration-primary-offering-fixture"] = offeringRegistrationFixture({
  company: "Red Cat Holdings, Inc.",
  deliveryLevel: "alert",
  eventType: "dilution_risk",
  exchange: "Nasdaq",
  filedAt: "May 13, 2026 - 9:02 PM ET",
  filingBrief: "Red Cat priced 23.9 million primary shares at $9.40, creating 19.6% immediate dilution and approximately $213.9 million in net proceeds.",
  formType: "424B5",
  id: "offering-registration-primary-offering-fixture",
  score: 75,
  signal: "bearish",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/748268/000110465926060505/0001104659-26-060505-index.html",
  summary: "Red Cat Holdings offered 23,936,171 common shares at $9.40 per share and expects approximately $213.9 million in net proceeds. The underwriters also received a 30-day option for 3,590,425 additional shares.",
  ticker: "RCAT",
  title: "Red Cat Offers 23.9M Common Shares at $9.40",
  originalHtml: "<h3>Common Stock Offering</h3><p>The company offered 23,936,171 shares of common stock at $9.40 per share. The underwriters received an option to purchase up to 3,590,425 additional shares.</p>",
  data: {
    snapshot: {
      title: "Offering Snapshot",
      items: [
        { label: "New Shares", value: "23.9M", note: "Excludes the underwriters' option" },
        { label: "Offer Price", value: "$9.40 per share" },
        { label: "Company Proceeds", value: "$213.9M", note: "Estimated net proceeds" },
        { label: "Dilution vs Current Shares", value: "19.6%" },
      ],
    },
    scale: {
      basis: { label: "Shares outstanding", value: "121,840,899 shares", numericValue: 121840899, note: "As of March 31, 2026" },
      caption: "Primary shares offered by Red Cat Holdings",
      headlineLabel: "Dilution",
      headlineValue: "19.6%",
      mode: "shares",
      note: "Headline ratio excludes the underwriters' option shown separately.",
      segments: [
        { label: "Primary shares", value: "23,936,171 shares", numericValue: 23936171, note: "Excludes underwriters' option", rowRole: "counted", tone: "supply" },
        { label: "Underwriters' option", value: "3,590,425 shares", numericValue: 3590425, note: "Exercisable for 30 days", rowRole: "conditional", tone: "conditional" },
      ],
      subtitle: "Shares offered versus shares outstanding as of March 31, 2026",
      title: "Share Dilution",
      total: { denominator: "121,840,899 shares", numerator: "23,936,171 shares", ratio: "19.6%", title: "Dilution vs Current Shares" },
    },
    offeringDetails: [
      { label: "Offering Type", value: "Underwritten public offering" },
      { label: "Offer Price", value: "$9.40 per share" },
      { label: "Underwriters", value: "BofA Securities and Needham & Company" },
      { label: "Closing Date", value: "May 14, 2026" },
      { label: "Use of Proceeds", value: "General corporate purposes and strategic growth initiatives" },
    ],
    instruments: [
      { type: "Common Stock", securities: "23,936,171 shares", exerciseOrConversionPrice: "$9.40 per share", resetOrFloor: "Not applicable", termOrLimits: "3,590,425-share underwriters' option" },
    ],
  },
});

commonFilingEvents["offering-registration-resale-fixture"] = offeringRegistrationFixture({
  company: "Bone Biologics Corp",
  deliveryLevel: "alert",
  eventType: "dilution_risk",
  exchange: "Nasdaq",
  filedAt: "July 17, 2026 - 5:14 PM ET",
  filingBrief: "Bone Biologics registered 6.46 million warrant-backed shares for resale, equal to 357.1% of current shares outstanding.",
  formType: "S-3",
  id: "offering-registration-resale-fixture",
  score: 88,
  signal: "bearish",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1419554/000149315226033789/0001493152-26-033789-index.htm",
  summary: "Bone Biologics registered up to 6,464,792 common shares for resale by selling stockholders. The company receives no proceeds from resale transactions but could receive approximately $6.2 million from cash warrant exercises.",
  ticker: "BBLG",
  title: "Bone Biologics Registers 6.46M Shares for Resale",
  originalHtml: "<h3>Resale Registration</h3><p>The prospectus covers up to 6,464,792 shares issuable upon exercise of pre-funded, Series F, Series G, and placement-agent warrants.</p>",
  data: {
    snapshot: {
      title: "Resale Registration Snapshot",
      items: [
        { label: "Resale Shares", value: "6.46M" },
        { label: "Overhang vs Outstanding", value: "357.1%" },
        { label: "Company Proceeds", value: "$6.2M", note: "Only if warrants are exercised for cash" },
        { label: "Selling Holders", value: "Registered holders" },
      ],
    },
    scale: {
      basis: { label: "Common stock outstanding", value: "1,810,380 shares", numericValue: 1810380, note: "As of July 16, 2026" },
      caption: "Registered warrant-backed shares versus current common stock",
      headlineLabel: "Potential Overhang",
      headlineValue: "357.1%",
      mode: "shares",
      note: "Total shares registered for resale by selling stockholders upon warrant exercise.",
      segments: [
        { label: "Pre-funded warrants", value: "2,112,677 shares", numericValue: 2112677, note: "Immediately exercisable at $0.001", rowRole: "counted", tone: "supply" },
        { label: "Series F warrants", value: "2,112,677 shares", numericValue: 2112677, note: "Exercisable at $1.42 after stockholder approval", rowRole: "counted", tone: "supply" },
        { label: "Series G warrants", value: "2,112,677 shares", numericValue: 2112677, note: "Exercisable at $1.42 after stockholder approval", rowRole: "counted", tone: "supply" },
        { label: "Placement agent warrants", value: "126,761 shares", numericValue: 126761, note: "Exercisable at $1.775 after stockholder approval", rowRole: "counted", tone: "supply" },
      ],
      subtitle: "6.46M shares registered for resale by selling stockholders",
      title: "Share Overhang",
      total: { denominator: "1,810,380 shares", numerator: "6,464,792 shares", ratio: "357.1%", title: "Overhang vs Current Shares (if all warrants exercised)" },
    },
    offeringDetails: [
      { label: "Offering Type", value: "Selling stockholder resale registration" },
      { label: "Resale Method", value: "From time to time at market or negotiated prices" },
      { label: "Source Instruments", value: "Pre-funded, Series F, Series G, and placement-agent warrants" },
      { label: "Company Proceeds", value: "None from resales" },
      { label: "Registration Obligation", value: "Shares underlying July 2026 warrant financing" },
    ],
    instruments: [
      { type: "Pre-Funded Warrant", securities: "2,112,677 shares", exerciseOrConversionPrice: "$0.001 per share", resetOrFloor: "Not applicable", termOrLimits: "Immediately exercisable; ownership limitation" },
      { type: "Series F Warrant", securities: "2,112,677 shares", exerciseOrConversionPrice: "$1.42 per share", resetOrFloor: "Not applicable", termOrLimits: "Exercisable after stockholder approval" },
      { type: "Series G Warrant", securities: "2,112,677 shares", exerciseOrConversionPrice: "$1.42 per share", resetOrFloor: "Not applicable", termOrLimits: "Exercisable after stockholder approval" },
      { type: "Placement Agent Warrant", securities: "126,761 shares", exerciseOrConversionPrice: "$1.775 per share", resetOrFloor: "Not applicable", termOrLimits: "Substantially the same terms as Series F warrants" },
    ],
  },
});

commonFilingEvents["offering-registration-shelf-fixture"] = offeringRegistrationFixture({
  company: "Energy Vault Holdings, Inc.",
  deliveryLevel: "feed",
  eventType: "dilution_risk",
  exchange: "NYSE",
  filedAt: "July 17, 2026 - 5:00 PM ET",
  filingBrief: "Energy Vault registered $300 million of future shelf capacity, equal to 54.65% of current market capitalization, without active sale terms.",
  formType: "S-3",
  id: "offering-registration-shelf-fixture",
  score: 65,
  signal: "volatile",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1828536/000182853626000091/0001828536-26-000091-index.html",
  summary: "Energy Vault filed a $300 million universal shelf registration covering common stock, preferred stock, debt securities, depositary shares, warrants, purchase contracts, and units. Actual sales require a later prospectus supplement.",
  ticker: "NRGV",
  title: "Energy Vault Files $300M Universal Shelf Registration",
  originalHtml: "<h3>Universal Shelf Registration</h3><p>The registration statement covers up to $300 million of securities. No active sale terms are included.</p>",
  data: {
    snapshot: {
      title: "Shelf Registration Snapshot",
      items: [
        { label: "Shelf Capacity", value: "$300M" },
        { label: "Market Cap", value: "$548.92M" },
        { label: "Capacity vs Market Cap", value: "54.65%" },
        { label: "Sale Status", value: "No active sale terms" },
      ],
    },
    scale: {
      basis: { label: "Market cap", value: "$548,920,680", numericValue: 548920680, note: "Latest market context" },
      caption: "Shelf capacity versus current market capitalization",
      headlineLabel: "Capacity Scale",
      headlineValue: "54.65%",
      mode: "amount",
      note: "Actual sales require a later prospectus supplement.",
      segments: [
        { label: "Shelf capacity", value: "$300,000,000", numericValue: 300000000, rowRole: "reference", supplyType: "shelf_capacity", tone: "supply" },
      ],
      subtitle: "Known registration capacity compared with current market capitalization",
      title: "Shelf Details",
      total: { denominator: "$548,920,680", numerator: "$300,000,000", ratio: "54.65%", title: "Shelf Capacity Scale (of current market cap)" },
    },
    offeringDetails: [
      { label: "Shelf Type", value: "Universal shelf registration" },
      { label: "Capacity", value: "$300 million" },
      { label: "Securities Covered", value: "Common, preferred, debt, warrants, contracts, and units" },
      { label: "Active Sale Terms", value: "None" },
      { label: "Use of Proceeds", value: "To be specified in future prospectus supplements" },
    ],
    instruments: [],
  },
});

commonFilingEvents["offering-registration-atm-fixture"] = offeringRegistrationFixture({
  company: "Sow Good Inc.",
  deliveryLevel: "alert",
  eventType: "dilution_risk",
  exchange: "Nasdaq",
  filedAt: "April 10, 2026 - 9:48 PM ET",
  filingBrief: "Sow Good established a $100 million ATM program equal to 87.5% of its market value at the disclosed last sale price.",
  formType: "424B5",
  id: "offering-registration-atm-fixture",
  score: 75,
  signal: "bearish",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1490161/0001829126-26-003423-index.html",
  summary: "Sow Good may sell up to $100 million of common stock through Craft Capital Management. Actual share issuance and proceeds depend on future market prices and sales.",
  ticker: "SOWG",
  title: "Sow Good Establishes $100M ATM Program",
  originalHtml: "<h3>At-The-Market Offering</h3><p>The company may sell common stock with an aggregate offering price of up to $100 million through Craft Capital Management LLC.</p>",
  data: {
    snapshot: {
      title: "ATM Program Snapshot",
      items: [
        { label: "ATM Capacity", value: "Up to $100M" },
        { label: "Market Value", value: "$114.3M" },
        { label: "Capacity vs Market Value", value: "87.5%" },
        { label: "Sale Method", value: "At the market" },
      ],
    },
    scale: {
      basis: { label: "Market Value at Last Sale Price", value: "$114,304,511", numericValue: 114304511, note: "300.8M shares at $0.38 on April 9, 2026" },
      caption: "The company may sell up to $100M through its ATM program",
      headlineLabel: "Potential ATM Capacity",
      headlineValue: "87.5%",
      mode: "amount",
      note: "The actual number of shares sold and proceeds will vary with market conditions.",
      segments: [
        { label: "ATM Capacity", value: "Up to $100,000,000", numericValue: 100000000, note: "Future primary offerings only", rowRole: "reference", supplyType: "shelf_capacity", tone: "supply" },
      ],
      subtitle: "Up to $100M of common stock through an ATM program",
      title: "ATM Program",
      total: { denominator: "$114,304,511", numerator: "$100,000,000", ratio: "87.5%", title: "ATM Capacity Scale" },
    },
    offeringDetails: [
      { label: "Offering Type", value: "At-the-market common stock program" },
      { label: "Sales Agent", value: "Craft Capital Management LLC" },
      { label: "Commission", value: "Up to 3.0% of gross proceeds" },
      { label: "Agreement Date", value: "April 9, 2026" },
      { label: "Use of Proceeds", value: "Working capital, capital expenditures, and general corporate purposes" },
    ],
    instruments: [],
  },
});

commonFilingEvents["offering-registration-mixed-fixture"] = offeringRegistrationFixture({
  company: "FuelCell Energy, Inc.",
  deliveryLevel: "alert",
  eventType: "dilution_risk",
  exchange: "Nasdaq",
  filedAt: "December 3, 2020 - 4:39 PM ET",
  filingBrief: "FuelCell registered 19.8 million primary shares and 14.7 million resale shares at $6.50, with approximately $123.9 million of net proceeds to the company.",
  formType: "424B5",
  id: "offering-registration-mixed-fixture",
  score: 75,
  signal: "bearish",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/886128/0001104659-20-132026-index.html",
  summary: "FuelCell Energy offered 19,822,219 primary shares and registered 14,696,320 selling-stockholder shares at $6.50 per share. The company receives proceeds only from the primary portion.",
  ticker: "FCEL",
  title: "FuelCell Registers Mixed Primary and Resale Offering",
  originalHtml: "<h3>Mixed Offering</h3><p>The prospectus covers 19,822,219 primary shares and 14,696,320 resale shares at $6.50 per share.</p>",
  data: {
    snapshot: {
      title: "Offering Snapshot",
      items: [
        { label: "Total Shares", value: "34.5M" },
        { label: "Offer Price", value: "$6.50 per share" },
        { label: "Company Proceeds", value: "Approximately $123.9M" },
        { label: "Primary / Resale Split", value: "19.8M / 14.7M" },
      ],
    },
    offeringDetails: [
      { label: "Offering Type", value: "Mixed primary and resale offering" },
      { label: "Primary Shares", value: "19,822,219" },
      { label: "Resale Shares", value: "14,696,320" },
      { label: "Offer Price", value: "$6.50 per share" },
      { label: "Company Proceeds", value: "Approximately $123.9 million" },
    ],
    instruments: [
      { type: "Common Stock", securities: "34,518,539 total shares", exerciseOrConversionPrice: "$6.50 per share", resetOrFloor: "Not applicable", termOrLimits: "19.8M primary shares and 14.7M resale shares" },
    ],
  },
});

commonFilingEvents["offering-registration-ipo-amendment-fixture"] = offeringRegistrationFixture({
  company: "Reddit, Inc.",
  deliveryLevel: "feed",
  eventType: "ipo_listing",
  exchange: "NYSE",
  filedAt: "March 19, 2024 - 6:04 AM ET",
  filingBrief: "Reddit's IPO amendment set a $31-$34 price range for 22 million Class A shares, including 15.28 million primary and 6.72 million secondary shares.",
  formType: "S-1/A",
  id: "offering-registration-ipo-amendment-fixture",
  score: 65,
  signal: "neutral",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1713445/000162828024011789/0001628280-24-011789-index.html",
  summary: "Reddit disclosed a $31-$34 IPO price range for 22 million Class A shares. The offering includes 15,276,527 primary shares and 6,723,473 selling-stockholder shares, plus a 3.3 million-share underwriters' option.",
  ticker: "RDDT",
  title: "Reddit IPO Amendment Sets $31-$34 Price Range",
  originalHtml: "<h3>Initial Public Offering</h3><p>The offering includes 22,000,000 Class A shares at an expected price of $31.00 to $34.00 per share.</p>",
  data: {
    snapshot: {
      title: "IPO Snapshot",
      items: [
        { label: "Class A Shares", value: "22M" },
        { label: "Price Range", value: "$31-$34" },
        { label: "Offering Size", value: "$682M-$748M" },
        { label: "Listing", value: "NYSE / RDDT" },
      ],
    },
    offeringDetails: [
      { label: "Primary Shares", value: "15,276,527" },
      { label: "Secondary Shares", value: "6,723,473" },
      { label: "Underwriters' Option", value: "3,300,000 shares" },
      { label: "Estimated Net Proceeds", value: "Approximately $450.9 million at the midpoint" },
      { label: "Use of Proceeds", value: "General corporate purposes and RSU tax obligations" },
    ],
    instruments: [
      { type: "Class A Common Stock", securities: "22,000,000 shares", exerciseOrConversionPrice: "$31-$34 price range", resetOrFloor: "Not applicable", termOrLimits: "Includes primary and selling-stockholder shares" },
    ],
  },
});

function ownershipFixture({
  company,
  deliveryLevel,
  filedAt,
  filingBrief,
  formType,
  id,
  keyEvidence,
  originalHtml,
  ownership,
  score,
  scoreRationale,
  signal,
  summary,
  ticker,
  title,
  whyItMatters,
}: {
  company: string;
  deliveryLevel: FilingEvent["deliveryLevel"];
  filedAt: string;
  filingBrief: string;
  formType: string;
  id: string;
  keyEvidence: string[];
  originalHtml: string;
  ownership: OwnershipData | null;
  score: number;
  scoreRationale: string;
  signal: DetailTone;
  summary: string;
  ticker: string;
  title: string;
  whyItMatters: string;
}): FilingEvent {
  return {
    ...commonFilingEvents["tsla-8k-operational-update"],
    bearishPoints: [],
    bullishPoints: [],
    change: "+0.00%",
    changeAmount: "$0.00",
    company,
    context: commonFilingEvents["tsla-8k-operational-update"].context,
    deliveryLevel,
    eventType: "insider_ownership",
    exchange: "NASDAQ",
    filedAt,
    filingBrief,
    filingFocus: formType.startsWith("144") ? "Proposed insider sale notice" : "Insider ownership transaction",
    formType,
    genericAvailability: {
      bearishPoints: false,
      bullishPoints: false,
      context: false,
      filingBrief: Boolean(filingBrief),
      keyEvidence: keyEvidence.length > 0,
      originalHtml: Boolean(originalHtml),
      recentFilings: false,
      relatedNews: false,
      scoreRationale: Boolean(scoreRationale),
      summary: Boolean(summary),
      watchNext: false,
      whyItMatters: Boolean(whyItMatters),
    },
    id,
    impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    keyEvidence,
    originalHtml,
    originalTextNote: "Fixture excerpt based on the source-backed ownership output.",
    ownership,
    price: "N/A",
    priceSeries: null,
    recentFilings: [],
    relatedNews: [],
    score,
    scoreRationale,
    signal,
    source: "SEC EDGAR",
    sourceUrl: "",
    summary,
    ticker,
    title,
    watchNext: [],
    whyItMatters,
  };
}

commonFilingEvents["ownership-form4-purchase-fixture"] = ownershipFixture({
  company: "Atlas Robotics Inc.",
  deliveryLevel: "feed",
  filedAt: "May 26, 2026 - 4:05 PM ET",
  filingBrief: "CEO Maya Chen reported an open-market purchase of 25,000 ATRB shares at $12.40.",
  formType: "4",
  id: "ownership-form4-purchase-fixture",
  keyEvidence: [
    "Transaction code P",
    "25,000 shares acquired at $12.40",
    "425,000 shares owned after the transaction",
  ],
  originalHtml: "<h3>Form 4</h3><p>Maya Chen reported transaction code P for 25,000 common shares at $12.40 per share, with 425,000 shares owned following the transaction.</p>",
  ownership: {
    mode: "form4_transaction",
    snapshot: {
      title: "Insider Transaction",
      items: [
        { label: "Reporting Owner", value: "Maya Chen" },
        { label: "Relationship", value: "Chief Executive Officer" },
        { label: "Transaction", value: "Open-market purchase", note: "Code P" },
        { label: "Reported Value", value: "$310,000", note: "25,000 shares at $12.40" },
      ],
    },
    transactions: [
      {
        code: "P",
        holdingsAfter: "425,000",
        price: "$12.40",
        security: "Common Stock",
        shares: "25,000",
        type: "Purchase",
        value: "$310,000",
      },
    ],
  },
  score: 58,
  scoreRationale: "A source-backed CEO open-market purchase is constructive and large enough for feed visibility.",
  signal: "bullish",
  summary: "Maya Chen, Atlas Robotics' CEO, reported acquiring 25,000 common shares at $12.40 per share for a reported value of $310,000.",
  ticker: "ATRB",
  title: "Atlas Robotics CEO Reports Open-Market Share Purchase",
  whyItMatters: "Open-market purchases by senior executives can be a positive ownership signal when price, share count, and post-transaction holdings are disclosed.",
});

commonFilingEvents["ownership-form4-10b5-sale-fixture"] = ownershipFixture({
  company: "Northstar Chips Corp.",
  deliveryLevel: "feed",
  filedAt: "May 26, 2026 - 4:10 PM ET",
  filingBrief: "CFO Daniel Ortiz reported selling 450,000 NSCP shares under a Rule 10b5-1 plan.",
  formType: "4",
  id: "ownership-form4-10b5-sale-fixture",
  keyEvidence: [
    "Transaction code S",
    "450,000 shares disposed at $24.75",
    "The filing footnote references a Rule 10b5-1 trading plan",
  ],
  originalHtml: "<h3>Form 4</h3><p>Daniel Ortiz reported transaction code S for 450,000 common shares at $24.75 per share. The footnote states that the sale was effected under a Rule 10b5-1 trading plan.</p>",
  ownership: {
    mode: "form4_transaction",
    snapshot: {
      title: "Insider Transaction",
      items: [
        { label: "Reporting Owner", value: "Daniel Ortiz" },
        { label: "Relationship", value: "Chief Financial Officer" },
        { label: "Transaction", value: "Reported sale", note: "Rule 10b5-1 plan" },
        { label: "Reported Value", value: "$11.14 million", note: "450,000 shares at $24.75" },
      ],
    },
    transactions: [
      {
        code: "S",
        holdingsAfter: "1,200,000",
        plan10b5: true,
        price: "$24.75",
        security: "Common Stock",
        shares: "450,000",
        type: "Sale",
        value: "$11,137,500",
      },
    ],
  },
  score: 61,
  scoreRationale: "The reported sale value is material enough for feed visibility, while the 10b5-1 plan reduces the need for alert treatment.",
  signal: "bearish",
  summary: "Daniel Ortiz reported selling 450,000 common shares at $24.75 per share, with the filing stating that the sale was made under a Rule 10b5-1 plan.",
  ticker: "NSCP",
  title: "Northstar Chips CFO Reports $11.1M 10b5-1 Sale",
  whyItMatters: "Large executive sales can matter to investors, but a disclosed 10b5-1 plan often indicates pre-arranged selling rather than a new discretionary decision.",
});

commonFilingEvents["ownership-form144a-material-sale-fixture"] = ownershipFixture({
  company: "Vector Therapeutics Inc.",
  deliveryLevel: "alert",
  filedAt: "May 28, 2026 - 4:15 PM ET",
  filingBrief: "Executive chair Samuel Price filed a Form 144/A increasing a proposed sale from 50,000 to 2.5 million shares.",
  formType: "144/A",
  id: "ownership-form144a-material-sale-fixture",
  keyEvidence: [
    "2,500,000 shares proposed for sale",
    "$24 million aggregate market value",
    "The amendment increases the proposed amount from 50,000 shares",
  ],
  originalHtml: "<h3>Form 144/A</h3><p>The amendment increases the proposed sale from 50,000 shares to 2,500,000 shares, with an aggregate market value of $24,000,000 and an approximate sale date of May 28, 2026.</p>",
  ownership: {
    amendmentDetails: [
      { label: "Previous Proposed Sale", value: "50,000 shares" },
      { label: "Updated Proposed Sale", value: "2,500,000 shares" },
      { label: "Increase", value: "50x" },
    ],
    details: [
      { label: "Notice Status", value: "Proposed sale", note: "Form 144 is not proof of execution" },
      { label: "Shares Proposed", value: "2,500,000" },
      { label: "Estimated Market Value", value: "$24 million" },
      { label: "Approximate Sale Date", value: "May 28, 2026" },
    ],
    mode: "form144_proposed_sale",
    snapshot: {
      title: "Proposed Insider Sale",
      items: [
        { label: "Seller", value: "Samuel Price", note: "Executive Chair" },
        { label: "Notice Status", value: "Proposed sale", note: "Not reported as executed" },
        { label: "Shares Proposed", value: "2,500,000" },
        { label: "Estimated Value", value: "$24 million", note: "Approximate sale date: May 28, 2026" },
      ],
    },
  },
  score: 76,
  scoreRationale: "The amendment increases the proposed sale to 2.5 million shares with a $24 million aggregate market value.",
  signal: "bearish",
  summary: "The Form 144/A reports a material increase in a proposed insider sale from 50,000 to 2.5 million shares. It is a sale notice, not confirmation that the sale occurred.",
  ticker: "VCTX",
  title: "Vector Therapeutics Form 144/A Raises Proposed Sale to 2.5M Shares",
  whyItMatters: "A large increase in a proposed insider sale can create investor concern even though Form 144 reports an intention rather than an executed transaction.",
});

commonFilingEvents["ownership-routine-award-fallback-fixture"] = ownershipFixture({
  company: "Xerox Holdings Corporation",
  deliveryLevel: "archive",
  filedAt: "May 20, 2026 - 4:05 PM ET",
  filingBrief: "Form 4 reported an 87,209-unit RSU award to John G. Bruno.",
  formType: "4",
  id: "ownership-routine-award-fallback-fixture",
  keyEvidence: ["Transaction code A", "87,209 restricted stock units awarded"],
  originalHtml: "<h3>Form 4</h3><p>Transaction code A reports an award of 87,209 Restricted Stock Units to John G. Bruno.</p>",
  ownership: null,
  score: 28,
  scoreRationale: "The filing contains only a routine equity-award row and no open-market purchase or sale signal.",
  signal: "neutral",
  summary: "Form 4 reported a routine equity award of 87,209 restricted stock units to John G. Bruno.",
  ticker: "XRX",
  title: "Xerox Reports Routine Insider RSU Award",
  whyItMatters: "The filing records compensation-related ownership rather than an open-market trading decision.",
});

commonFilingEvents["ownership-routine-form144-fallback-fixture"] = ownershipFixture({
  company: "Cobalt Cloud Software Inc.",
  deliveryLevel: "archive",
  filedAt: "May 27, 2026 - 4:05 PM ET",
  filingBrief: "Priya Raman filed a Form 144 notice proposing a sale of 25,000 shares worth about $175,000.",
  formType: "144",
  id: "ownership-routine-form144-fallback-fixture",
  keyEvidence: ["25,000 shares proposed for sale", "$175,000 aggregate market value"],
  originalHtml: "<h3>Form 144</h3><p>Priya Raman filed a notice proposing the sale of 25,000 shares with an aggregate market value of $175,000 on or around May 27, 2026.</p>",
  ownership: null,
  score: 32,
  scoreRationale: "The proposed sale is small by the source-backed amount and remains below the specialized ownership threshold.",
  signal: "neutral",
  summary: "Priya Raman filed a Form 144 notice proposing a sale of 25,000 shares worth about $175,000. The notice does not establish that the sale occurred.",
  ticker: "CBLD",
  title: "Cobalt Cloud Insider Files Routine Proposed Sale Notice",
  whyItMatters: "Form 144 records a proposed sale and should not be described as an executed transaction.",
});

commonFilingEvents["ownership-admin-amendment-fallback-fixture"] = ownershipFixture({
  company: "Horizon Battery Systems Inc.",
  deliveryLevel: "archive",
  filedAt: "May 27, 2026 - 4:10 PM ET",
  filingBrief: "A Form 4/A corrected footnote text without changing transaction or ownership amounts.",
  formType: "4/A",
  id: "ownership-admin-amendment-fallback-fixture",
  keyEvidence: ["Footnote text corrected", "No transaction or ownership amount changed"],
  originalHtml: "<h3>Form 4/A</h3><p>The amendment corrects footnote text and does not change the transaction date, code, shares, price, or post-transaction ownership.</p>",
  ownership: null,
  score: 20,
  scoreRationale: "The amendment is administrative and does not change reported ownership or transaction terms.",
  signal: "neutral",
  summary: "Horizon Battery Systems filed a Form 4/A correcting footnote text without changing transaction dates, shares, prices, or ownership amounts.",
  ticker: "HZBS",
  title: "Horizon Battery Systems Files Administrative Form 4/A",
  whyItMatters: "The amendment updates the record but does not report a new ownership transaction.",
});

function tenderOfferFixture({
  company,
  deliveryLevel,
  eventType,
  filedAt,
  filingBrief,
  formType,
  id,
  keyEvidence,
  originalHtml,
  score,
  scoreRationale,
  signal,
  summary,
  tenderOffer,
  ticker,
  title,
  watchNext,
  whyItMatters,
}: {
  company: string;
  deliveryLevel: FilingEvent["deliveryLevel"];
  eventType: string;
  filedAt: string;
  filingBrief: string;
  formType: string;
  id: string;
  keyEvidence: string[];
  originalHtml: string;
  score: number;
  scoreRationale: string;
  signal: DetailTone;
  summary: string;
  tenderOffer: TenderOfferData | null;
  ticker: string;
  title: string;
  watchNext: string[];
  whyItMatters: string;
}): FilingEvent {
  return {
    ...commonFilingEvents["tsla-8k-operational-update"],
    bearishPoints: [],
    bullishPoints: [],
    change: "+0.00%",
    changeAmount: "$0.00",
    company,
    deliveryLevel,
    eventType,
    exchange: "NASDAQ",
    filedAt,
    filingBrief,
    filingFocus: "Tender offer terms",
    formType,
    genericAvailability: {
      bearishPoints: false,
      bullishPoints: false,
      context: false,
      filingBrief: Boolean(filingBrief),
      keyEvidence: keyEvidence.length > 0,
      originalHtml: Boolean(originalHtml),
      recentFilings: false,
      relatedNews: false,
      scoreRationale: Boolean(scoreRationale),
      summary: Boolean(summary),
      watchNext: watchNext.length > 0,
      whyItMatters: Boolean(whyItMatters),
    },
    id,
    impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    keyEvidence,
    originalHtml,
    originalTextNote: "Fixture excerpt based on the Tender / CB / 13E3 room output.",
    price: "N/A",
    priceSeries: null,
    recentFilings: [],
    relatedNews: [],
    score,
    scoreRationale,
    signal,
    source: "SEC EDGAR",
    sourceUrl: "",
    summary,
    tenderOffer,
    ticker,
    title,
    watchNext,
    whyItMatters,
  };
}

commonFilingEvents["tender-issuer-repurchase-fixture"] = tenderOfferFixture({
  company: "NovaTech Robotics Inc.",
  deliveryLevel: "feed",
  eventType: "capital_return",
  filedAt: "May 22, 2026 - 4:05 PM ET",
  filingBrief: "NovaTech is offering to buy up to 2 million shares at $25.00 in cash.",
  formType: "SC TO-I",
  id: "tender-issuer-repurchase-fixture",
  keyEvidence: [
    "Issuer tender offer to purchase up to 2,000,000 shares.",
    "Purchase price is $25.00 per share in cash.",
    "Maximum aggregate purchase price is $50 million.",
  ],
  originalHtml: "<h3>Issuer Tender Offer</h3><p>NovaTech Robotics offers to purchase up to 2,000,000 shares at $25.00 per share in cash, for a maximum aggregate purchase price of $50 million. The offer expires June 20, 2026 and is subject to proration.</p>",
  score: 68,
  scoreRationale: "The issuer tender provides a defined cash return and potential share-count reduction, but acceptance remains subject to the offer cap and proration.",
  signal: "bullish",
  summary: "The issuer tender creates a near-term capital return and potential share count reduction, with proration if tenders exceed the cap.",
  tenderOffer: {
    mode: "issuer_tender",
    snapshot: {
      title: "Issuer Tender Snapshot",
      items: [
        { label: "Cash Price", value: "$25.00 per share" },
        { label: "Maximum Purchase", value: "$50 million" },
        { label: "Shares Sought", value: "Up to 2,000,000" },
        { label: "Expiration", value: "June 20, 2026", note: "Withdrawal deadline is the same date" },
      ],
    },
    termsTitle: "Tender Terms",
    terms: [
      { label: "Offeror", value: "NovaTech Robotics Inc." },
      { label: "Consideration", value: "$25.00 per share in cash" },
      { label: "Proration", value: "Applies if tenders exceed the offer cap" },
    ],
  },
  ticker: "NVT",
  title: "NovaTech Launches $50 Million Issuer Tender Offer",
  watchNext: ["Final shares accepted and proration factor.", "Whether the offer is extended or amended."],
  whyItMatters: "The offer creates direct cash liquidity for participating holders and may reduce the outstanding share count, subject to the cap and proration.",
});

commonFilingEvents["tender-third-party-acquisition-fixture"] = tenderOfferFixture({
  company: "Alpine Data Systems Inc.",
  deliveryLevel: "alert",
  eventType: "strategic_transaction",
  filedAt: "June 12, 2026 - 8:30 AM ET",
  filingBrief: "Summit is offering $18.50 per share in cash for Alpine Data.",
  formType: "SC TO-T",
  id: "tender-third-party-acquisition-fixture",
  keyEvidence: [
    "$18.50 per share net to the seller in cash.",
    "The stated offer premium is 42% to Alpine's previous closing price.",
    "The board recommends that stockholders tender their shares.",
  ],
  originalHtml: "<h3>Third-Party Tender Offer</h3><p>Summit Merger Sub Inc. offers $18.50 per share in cash for Alpine Data Systems. The offer expires July 15, 2026 and is subject to the minimum tender condition and regulatory approval, with no financing condition.</p>",
  score: 82,
  scoreRationale: "The actionable all-cash offer carries a source-backed 42% premium and a board recommendation, subject to minimum-tender and regulatory conditions.",
  signal: "bullish",
  summary: "The filing describes a control-change tender offer with a 42% premium, a July 15, 2026 expiration, and customary minimum tender and regulatory conditions.",
  tenderOffer: {
    mode: "third_party_tender",
    snapshot: {
      title: "Acquisition Tender Snapshot",
      items: [
        { label: "Offer Price", value: "$18.50 per share", note: "Cash, net to the seller" },
        { label: "Stated Premium", value: "42%", note: "Versus previous closing price" },
        { label: "Expiration", value: "July 15, 2026" },
        { label: "Board Position", value: "Recommends tendering" },
      ],
    },
    termsTitle: "Offer Conditions",
    terms: [
      { label: "Offeror", value: "Summit Merger Sub Inc." },
      { label: "Target", value: "Alpine Data Systems Inc." },
      { label: "Minimum Tender", value: "Required" },
      { label: "Regulatory Approval", value: "Required" },
      { label: "Financing Condition", value: "None" },
    ],
  },
  ticker: "ALPN",
  title: "Summit Starts $18.50 Cash Tender Offer for Alpine Data",
  watchNext: ["Minimum tender condition satisfaction.", "Regulatory approval and any offer extension."],
  whyItMatters: "The filing gives holders a defined cash exit at a stated premium, while completion still depends on tender participation and regulatory approval.",
});

commonFilingEvents["tender-going-private-13e3-fixture"] = tenderOfferFixture({
  company: "Harbor Foods Group Inc.",
  deliveryLevel: "alert",
  eventType: "strategic_transaction",
  filedAt: "June 18, 2026 - 4:20 PM ET",
  filingBrief: "Harbor Foods' controller group proposes to cash out unaffiliated holders at $11.25 per share.",
  formType: "SC 13E3",
  id: "tender-going-private-13e3-fixture",
  keyEvidence: [
    "The filing describes a Rule 13e-3 going-private transaction.",
    "Unaffiliated holders would receive $11.25 per share in cash.",
    "Completion requires approval by a majority of unaffiliated shares.",
  ],
  originalHtml: "<h3>Schedule 13E-3</h3><p>The controller group proposes a going-private transaction at $11.25 per share in cash, subject to approval by a majority of unaffiliated shares. The special committee addresses fairness and holders retain appraisal rights.</p>",
  score: 88,
  scoreRationale: "The definitive cash-out would end public ownership for unaffiliated holders and depends on minority approval and the disclosed fairness process.",
  signal: "volatile",
  summary: "The filing describes a Rule 13e-3 going-private transaction with cash consideration, special committee fairness language, unaffiliated-holder approval, and appraisal rights.",
  tenderOffer: {
    mode: "going_private",
    snapshot: {
      title: "Going-Private Snapshot",
      items: [
        { label: "Cash-Out Price", value: "$11.25 per share" },
        { label: "Affected Holders", value: "Unaffiliated shareholders" },
        { label: "Minority Approval", value: "Required", note: "Majority of unaffiliated shares" },
        { label: "Appraisal Rights", value: "Available" },
      ],
    },
    termsTitle: "Going-Private Terms",
    terms: [
      { label: "Transaction", value: "Rule 13e-3 going private" },
      { label: "Consideration", value: "$11.25 per share in cash" },
      { label: "Special Committee", value: "Fairness process disclosed" },
      { label: "Holder Approval", value: "Majority of unaffiliated shares" },
    ],
  },
  ticker: "HBRF",
  title: "Harbor Foods Files $11.25 Going-Private Schedule 13E-3",
  watchNext: ["Unaffiliated-holder approval result.", "Fairness materials and any appraisal-related litigation."],
  whyItMatters: "The transaction would cash out public minority holders and remove their continuing equity interest, making price fairness and minority approval central.",
});

commonFilingEvents["tender-cross-border-exchange-fixture"] = tenderOfferFixture({
  company: "BioThera Inc.",
  deliveryLevel: "feed",
  eventType: "strategic_transaction",
  filedAt: "July 2, 2026 - 8:15 AM ET",
  filingBrief: "EuroMed is offering 0.75 ordinary shares for each BioThera ADS.",
  formType: "CB",
  id: "tender-cross-border-exchange-fixture",
  keyEvidence: [
    "The exchange ratio is 0.75 EuroMed ordinary shares for each BioThera ADS.",
    "The offer expires August 3, 2026.",
    "Acceptances are subject to proration.",
  ],
  originalHtml: "<h3>Schedule CB</h3><p>EuroMed plc offers 0.75 ordinary shares for each BioThera ADS. The cross-border exchange offer expires August 3, 2026, is subject to proration, and relies on the Tier II exemption.</p>",
  score: 70,
  scoreRationale: "The exchange offer defines holder consideration but leaves final value exposed to EuroMed's share price and possible proration.",
  signal: "volatile",
  summary: "The filing describes a cross-border exchange offer with stock consideration, an August 3, 2026 expiration, proration risk, and Tier II exemption language.",
  tenderOffer: {
    mode: "cross_border",
    snapshot: {
      title: "Cross-Border Offer Snapshot",
      items: [
        { label: "Exchange Ratio", value: "0.75 EuroMed shares", note: "For each BioThera ADS" },
        { label: "Offeror", value: "EuroMed plc" },
        { label: "Expiration", value: "August 3, 2026" },
        { label: "Proration", value: "Applies" },
      ],
    },
    termsTitle: "Exchange Offer Terms",
    terms: [
      { label: "Target Security", value: "BioThera ADS" },
      { label: "Consideration", value: "EuroMed ordinary shares" },
      { label: "Exchange Ratio", value: "0.75 shares per ADS" },
      { label: "Cross-Border Exemption", value: "Tier II" },
    ],
  },
  ticker: "BTHR",
  title: "EuroMed Files 0.75-for-1 Cross-Border Exchange Offer",
  watchNext: ["EuroMed share price movement before expiration.", "Final proration and exchange offer acceptance results."],
  whyItMatters: "Holder value depends on the acquirer's share price through expiration, and proration may limit how much of the tendered position is accepted.",
});

commonFilingEvents["tender-material-amendment-fixture"] = tenderOfferFixture({
  company: "Alpine Data Systems Inc.",
  deliveryLevel: "alert",
  eventType: "strategic_transaction",
  filedAt: "July 10, 2026 - 8:30 AM ET",
  filingBrief: "Summit increased the Alpine tender price to $20.00 and extended the offer to July 29, 2026.",
  formType: "SC TO-T/A",
  id: "tender-material-amendment-fixture",
  keyEvidence: [
    "The offer price increased from $18.50 to $20.00 per share in cash.",
    "The expiration date moved from July 15 to July 29, 2026.",
    "All other terms and conditions remain unchanged.",
  ],
  originalHtml: "<h3>Amendment No. 2</h3><p>The offer price increases from $18.50 to $20.00 per share in cash and the expiration date extends from July 15 to July 29, 2026. All other terms remain unchanged.</p>",
  score: 76,
  scoreRationale: "The amendment directly improves cash consideration and extends the decision period without changing the other offer conditions.",
  signal: "bullish",
  summary: "The amendment improves cash consideration from $18.50 to $20.00 per share and extends the expiration deadline to July 29, 2026, while leaving all other terms unchanged.",
  tenderOffer: {
    changes: [
      { label: "Offer Price", previous: "$18.50 per share", current: "$20.00 per share" },
      { label: "Expiration", previous: "July 15, 2026", current: "July 29, 2026" },
    ],
    mode: "material_amendment",
    snapshot: {
      title: "Tender Amendment Snapshot",
      items: [
        { label: "Amendment", value: "No. 2" },
        { label: "New Offer Price", value: "$20.00 per share", note: "Previously $18.50" },
        { label: "New Expiration", value: "July 29, 2026", note: "Previously July 15" },
        { label: "Other Terms", value: "Unchanged" },
      ],
    },
    termsTitle: "Current Offer Terms",
    terms: [
      { label: "Offeror", value: "Summit Merger Sub Inc." },
      { label: "Target", value: "Alpine Data Systems Inc." },
      { label: "Consideration", value: "$20.00 per share in cash" },
    ],
  },
  ticker: "ALPN",
  title: "Summit Raises Alpine Tender Offer to $20.00",
  watchNext: ["Tender results at the extended deadline.", "Any additional price or condition amendments."],
  whyItMatters: "The amendment improves holder economics by raising the cash price and gives investors two additional weeks to decide whether to tender.",
});

commonFilingEvents["tender-routine-amendment-fallback-fixture"] = tenderOfferFixture({
  company: "NovaTech Robotics Inc.",
  deliveryLevel: "archive",
  eventType: "other",
  filedAt: "May 28, 2026 - 4:05 PM ET",
  filingBrief: "Routine tender amendment with no change to offer terms.",
  formType: "SC TO-I/A",
  id: "tender-routine-amendment-fallback-fixture",
  keyEvidence: ["An exhibit was added.", "The signature page was updated.", "All offer terms remain unchanged."],
  originalHtml: "<h3>Amendment No. 1</h3><p>This amendment adds an exhibit and updates the signature page. All other terms of the offer remain unchanged.</p>",
  score: 20,
  scoreRationale: "The amendment is administrative and does not change price, timing, conditions, or holder treatment.",
  signal: "neutral",
  summary: "The filing only adds an exhibit and updates the signature page while stating that all tender offer terms remain unchanged.",
  tenderOffer: null,
  ticker: "NVT",
  title: "NovaTech Files Routine Tender-Offer Amendment",
  watchNext: ["Any later amendment that changes price, deadline, proration, or conditions."],
  whyItMatters: "The filing updates the tender record but does not change the offer's investor-relevant terms.",
});

function ntLateFilingFixture({
  company,
  deliveryLevel,
  eventType,
  filedAt,
  filingBrief,
  formType,
  id,
  keyEvidence,
  score,
  scoreRationale,
  signal,
  snapshot,
  summary,
  ticker,
  title,
  watchNext,
  whyItMatters,
}: {
  company: string;
  deliveryLevel: FilingEvent["deliveryLevel"];
  eventType: string;
  filedAt: string;
  filingBrief: string;
  formType: string;
  id: string;
  keyEvidence: string[];
  score: number;
  scoreRationale: string;
  signal: DetailTone;
  snapshot: ListingFinancialRiskSnapshotData;
  summary: string;
  ticker: string;
  title: string;
  watchNext: string[];
  whyItMatters: string;
}): FilingEvent {
  return {
    ...commonFilingEvents["tsla-8k-operational-update"],
    bearishPoints: [],
    bullishPoints: [],
    change: "+0.00%",
    changeAmount: "$0.00",
    company,
    deliveryLevel,
    eventType,
    exchange: "NASDAQ",
    filedAt,
    filingBrief,
    filingFocus: "Late periodic report",
    formType,
    genericAvailability: {
      bearishPoints: false,
      bullishPoints: false,
      context: false,
      filingBrief: Boolean(filingBrief),
      keyEvidence: keyEvidence.length > 0,
      originalHtml: true,
      recentFilings: false,
      relatedNews: false,
      scoreRationale: Boolean(scoreRationale),
      summary: Boolean(summary),
      watchNext: watchNext.length > 0,
      whyItMatters: Boolean(whyItMatters),
    },
    id,
    impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    keyEvidence,
    ntLateFilingSnapshot: snapshot,
    originalHtml: `<h3>${formType} Notification</h3><p>${summary}</p>`,
    originalTextNote: "Fixture excerpt based on the NT form-room expected output.",
    price: "N/A",
    priceSeries: null,
    recentFilings: [],
    relatedNews: [],
    score,
    scoreRationale,
    signal,
    source: "SEC EDGAR",
    sourceUrl: "",
    summary,
    ticker,
    title,
    watchNext,
    whyItMatters,
  };
}

commonFilingEvents["nt-routine-10q-fixture"] = ntLateFilingFixture({
  company: "Acme Robotics Inc.",
  deliveryLevel: "archive",
  eventType: "other",
  filedAt: "May 12, 2026 - 4:15 PM ET",
  filingBrief: "Acme Robotics filed a routine NT 10-Q and says no significant results change is expected.",
  formType: "NT 10-Q",
  id: "nt-routine-10q-fixture",
  keyEvidence: [
    "The delayed report is the Form 10-Q for the quarter ended March 31, 2026.",
    "The company expects to file within the five-day extension period.",
    "No significant change in results is expected.",
  ],
  score: 25,
  scoreRationale: "The notice describes a routine review delay, expects filing within the extension, and discloses no material results change.",
  signal: "neutral",
  snapshot: {
    title: "Late Filing Snapshot",
    items: [
      { label: "Delayed Report", value: "10-Q", note: "Period ended Mar 31, 2026" },
      { label: "Filing Timing", value: "Expected within extension", note: "5-day extension window" },
      { label: "Reason for Delay", value: "Quarterly review and management review" },
      { label: "Expected Results Impact", value: "No significant change disclosed" },
    ],
  },
  summary: "Acme Robotics needs additional time to complete quarterly review procedures and management review and expects to file its Form 10-Q within the five-day extension period.",
  ticker: "ACME",
  title: "Acme Robotics Files Routine NT 10-Q Notice",
  watchNext: ["Whether the Form 10-Q is filed within the extension period."],
  whyItMatters: "The notice is procedural unless the company misses the extension or later discloses an accounting issue or material results change.",
});

commonFilingEvents["nt-material-sales-change-fixture"] = ntLateFilingFixture({
  company: "HelioGrid Storage Inc.",
  deliveryLevel: "alert",
  eventType: "sales_performance",
  filedAt: "May 12, 2026 - 4:25 PM ET",
  filingBrief: "HelioGrid's late-filing notice says quarterly revenue is expected to fall about 38% year over year.",
  formType: "NT 10-Q",
  id: "nt-material-sales-change-fixture",
  keyEvidence: [
    "Revenue is expected to decline approximately 38% year over year.",
    "The company also expects lower gross margin.",
    "The filing delay involves quarter-close work and analysis of customer order delays.",
  ],
  score: 76,
  scoreRationale: "The notice contains a material quantified revenue decline and lower expected gross margin, making the filing delay immediately relevant.",
  signal: "bearish",
  snapshot: {
    title: "Late Filing Snapshot",
    items: [
      { label: "Delayed Report", value: "10-Q", note: "Period ended Mar 31, 2026" },
      { label: "Filing Timing", value: "Expected within extension", note: "5-day extension window" },
      { label: "Reason for Delay", value: "Quarter close and customer-order analysis" },
      { label: "Expected Results Impact", value: "Revenue down about 38%; lower gross margin" },
    ],
  },
  summary: "HelioGrid needs additional time for quarter-close procedures and analysis of customer order delays. It expects revenue to decline about 38% year over year and gross margin to be lower.",
  ticker: "HGS",
  title: "HelioGrid NT 10-Q Flags 38% Revenue Decline",
  watchNext: ["The filed 10-Q's final revenue and gross-margin figures.", "Whether the company meets the extension deadline."],
  whyItMatters: "The NT notice provides material preliminary operating information before the full quarterly report, including a quantified revenue decline and margin pressure.",
});

commonFilingEvents["nt-accounting-delay-10k-fixture"] = ntLateFilingFixture({
  company: "Northstar Components Corp.",
  deliveryLevel: "alert",
  eventType: "financial_risk",
  filedAt: "March 31, 2026 - 5:10 PM ET",
  filingBrief: "Northstar's annual report is delayed by audit work involving revenue recognition, inventory valuation, and internal controls.",
  formType: "NT 10-K",
  id: "nt-accounting-delay-10k-fixture",
  keyEvidence: [
    "Open audit procedures involve revenue recognition and inventory valuation.",
    "Management is evaluating material adjustments and internal-control remediation testing.",
    "The company expects a material decrease in net income.",
  ],
  score: 82,
  scoreRationale: "The delay involves audit adjustments and internal-control work and is accompanied by an expected material decrease in net income.",
  signal: "bearish",
  snapshot: {
    title: "Late Filing Snapshot",
    items: [
      { label: "Delayed Report", value: "10-K", note: "Period ended Dec 31, 2025" },
      { label: "Filing Timing", value: "Expected within extension", note: "15-day extension window" },
      { label: "Reason for Delay", value: "Audit and internal-control procedures" },
      { label: "Expected Results Impact", value: "Material decrease in net income expected", note: "Financial reporting risk disclosed" },
    ],
  },
  summary: "Northstar requires more time for audit procedures concerning revenue recognition, inventory valuation, and internal-control remediation. Material adjustments are under evaluation, and net income is expected to decrease materially.",
  ticker: "NSTC",
  title: "Northstar Delays 10-K for Audit and Control Work",
  watchNext: ["The final audit adjustments and net-income effect.", "Any material weakness or restatement disclosure in the 10-K."],
  whyItMatters: "The delay is tied to accounting judgments and internal controls rather than routine report preparation, increasing financial-reporting uncertainty.",
});

commonFilingEvents["nt-foreign-issuer-20f-fixture"] = ntLateFilingFixture({
  company: "Global Meridian PLC",
  deliveryLevel: "feed",
  eventType: "financial_risk",
  filedAt: "April 30, 2026 - 5:05 PM ET",
  filingBrief: "Global Meridian delayed its 20-F while completing a subsidiary audit and consolidation schedules.",
  formType: "NT 20-F",
  id: "nt-foreign-issuer-20f-fixture",
  keyEvidence: [
    "The delayed report is the Form 20-F for the year ended December 31, 2025.",
    "A newly acquired subsidiary requires a local statutory audit and consolidation schedules.",
    "No significant results change was disclosed.",
  ],
  score: 58,
  scoreRationale: "The acquisition-related audit and consolidation work creates filing uncertainty, but the notice discloses no significant results change.",
  signal: "volatile",
  snapshot: {
    title: "Late Filing Snapshot",
    items: [
      { label: "Delayed Report", value: "20-F", note: "Period ended Dec 31, 2025" },
      { label: "Filing Timing", value: "Expected within extension", note: "15-day extension window" },
      { label: "Reason for Delay", value: "Subsidiary audit and consolidation schedules" },
      { label: "Expected Results Impact", value: "No significant change disclosed" },
    ],
  },
  summary: "Global Meridian needs additional time to complete a local statutory audit and consolidation schedules for a newly acquired non-U.S. subsidiary and expects to file within the extension period.",
  ticker: "GMDN",
  title: "Global Meridian Delays 20-F for Subsidiary Audit",
  watchNext: ["Completion of the subsidiary audit and filing of the Form 20-F."],
  whyItMatters: "The delay reflects acquisition-related consolidation work; risk rises if the extension is missed or the completed audit identifies material adjustments.",
});

function s8Fixture({
  company,
  deliveryLevel,
  filedAt,
  filingBrief,
  formType,
  id,
  keyEvidence,
  s8,
  score,
  scoreRationale,
  signal,
  summary,
  ticker,
  title,
  watchNext,
  whyItMatters,
}: {
  company: string;
  deliveryLevel: FilingEvent["deliveryLevel"];
  filedAt: string;
  filingBrief: string;
  formType: string;
  id: string;
  keyEvidence: string[];
  s8?: S8Data | null;
  score: number;
  scoreRationale: string;
  signal: DetailTone;
  summary: string;
  ticker: string;
  title: string;
  watchNext: string[];
  whyItMatters: string;
}): FilingEvent {
  return {
    ...commonFilingEvents["tsla-8k-operational-update"],
    bearishPoints: [],
    bullishPoints: [],
    change: "+0.00%",
    changeAmount: "$0.00",
    company,
    deliveryLevel,
    eventType: "dilution_risk",
    exchange: "NYSE",
    filedAt,
    filingBrief,
    filingFocus: "Equity compensation registration",
    formType,
    genericAvailability: {
      bearishPoints: false,
      bullishPoints: false,
      context: false,
      filingBrief: true,
      keyEvidence: keyEvidence.length > 0,
      originalHtml: true,
      recentFilings: false,
      relatedNews: false,
      scoreRationale: Boolean(scoreRationale),
      summary: true,
      watchNext: watchNext.length > 0,
      whyItMatters: true,
    },
    id,
    impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
    keyEvidence,
    originalHtml: `<h3>${formType} Equity Compensation Registration</h3><p>${summary}</p>`,
    originalTextNote: "Fixture excerpt based on the filed S-8 package and tested S-8 output contract.",
    price: "N/A",
    priceSeries: null,
    recentFilings: [],
    relatedNews: [],
    s8,
    score,
    scoreRationale,
    signal,
    source: "SEC EDGAR",
    sourceUrl: "",
    summary,
    ticker,
    title,
    watchNext,
    whyItMatters,
  };
}

commonFilingEvents["s8-plan-registration-fixture"] = s8Fixture({
  company: "Douglas Elliman Inc.",
  deliveryLevel: "feed",
  filedAt: "April 1, 2026 - 5:12 PM ET",
  filingBrief: "Douglas Elliman registered 4,412,397 shares for its management incentive and employee stock purchase plans.",
  formType: "S-8",
  id: "s8-plan-registration-fixture",
  keyEvidence: [
    "The filing registers 3,529,918 shares under the Management Incentive Plan.",
    "The filing registers 882,479 shares under the Employee Stock Purchase Plan.",
  ],
  s8: {
    detailsTitle: "Plan Registration Details",
    details: [
      { label: "Management Incentive Plan", value: "3,529,918 shares" },
      { label: "Employee Stock Purchase Plan", value: "882,479 shares" },
      { label: "Total Registered", value: "4,412,397 shares" },
    ],
    mode: "plan_registration",
    snapshot: {
      title: "Equity Plan Snapshot",
      items: [
        { label: "Shares Outstanding", value: "90,906,080" },
        { label: "Registered plan shares", value: "4,412,397" },
        { label: "Plan Shares / Outstanding", value: "4.87%" },
        { label: "Plan Type", value: "Management Incentive & ESPP" },
      ],
    },
  },
  score: 55,
  scoreRationale: "The registered plan shares equal 4.87% of shares outstanding, creating moderate potential compensation dilution without an immediate public sale.",
  signal: "neutral",
  summary: "Douglas Elliman registered 4,412,397 shares for employee and management equity compensation, including 3,529,918 shares under its Management Incentive Plan and 882,479 shares under its Employee Stock Purchase Plan.",
  ticker: "DOUG",
  title: "Douglas Elliman Registers 4.4 Million Equity Plan Shares",
  watchNext: ["Future grants and exercises under the registered plans."],
  whyItMatters: "The filing expands the pool of shares available for employee compensation; dilution occurs as awards are granted, vest, and are exercised.",
});

commonFilingEvents["s8-inducement-awards-fixture"] = s8Fixture({
  company: "Tela Medical Devices, Inc.",
  deliveryLevel: "feed",
  filedAt: "March 18, 2026 - 4:38 PM ET",
  filingBrief: "Tela Medical Devices registered 81,600 shares for employment inducement awards.",
  formType: "S-8",
  id: "s8-inducement-awards-fixture",
  keyEvidence: [
    "The inducement awards include options covering 75,000 shares.",
    "The inducement awards include restricted stock units covering 6,600 shares.",
  ],
  s8: {
    detailsTitle: "Inducement Award Details",
    details: [
      { label: "Stock Options", value: "75,000 shares" },
      { label: "Restricted Stock Units", value: "6,600 shares" },
      { label: "Total Inducement Awards", value: "81,600 shares" },
    ],
    mode: "inducement_awards",
    snapshot: {
      title: "Inducement Award Snapshot",
      items: [
        { label: "Registered inducement shares", value: "81,600" },
        { label: "Award Type", value: "Stock options and RSUs" },
        { label: "Stock Options", value: "75,000 shares" },
        { label: "Restricted Stock Units", value: "6,600 shares" },
      ],
    },
  },
  score: 52,
  scoreRationale: "The filing registers a defined inducement award pool, but the shares are tied to employment awards rather than an immediate capital raise.",
  signal: "neutral",
  summary: "Tela Medical Devices registered 81,600 shares for employment inducement awards, comprising options for 75,000 shares and restricted stock units for 6,600 shares.",
  ticker: "TMDV",
  title: "Tela Medical Devices Registers 81,600 Inducement Award Shares",
  watchNext: ["Vesting and exercise of the inducement awards."],
  whyItMatters: "Inducement awards can dilute existing holders as the awards vest or are exercised, but they do not represent an immediate public offering.",
});

commonFilingEvents["s8-reoffer-resale-fixture"] = s8Fixture({
  company: "BitCompute Inc.",
  deliveryLevel: "feed",
  filedAt: "September 9, 2025 - 4:22 PM ET",
  filingBrief: "BitCompute filed a reoffer prospectus covering 1,200,000 plan shares held by two selling stockholders.",
  formType: "S-8/A",
  id: "s8-reoffer-resale-fixture",
  keyEvidence: [
    "The reoffer prospectus covers 1,200,000 shares held by two selling stockholders.",
    "The company will not receive proceeds from the selling stockholders' sales.",
  ],
  s8: {
    detailsTitle: "Reoffer / Resale Details",
    details: [
      { label: "Reoffer Subset", value: "1,200,000 shares", note: "Shares already registered under the parent plan filing" },
      { label: "Selling Holder", value: "Alice Lee", note: "800,000 shares" },
      { label: "Selling Holder", value: "Brian Park", note: "400,000 shares" },
      { label: "Company Proceeds", value: "None" },
    ],
    mode: "reoffer_resale",
    snapshot: {
      title: "Reoffer Resale Snapshot",
      items: [
        { label: "Reoffer resale shares", value: "1,200,000" },
        { label: "Selling Holders", value: "2" },
        { label: "Relationship", value: "Subset of parent plan" },
        { label: "Company Proceeds", value: "None" },
      ],
    },
  },
  score: 48,
  scoreRationale: "The prospectus enables resale by two holders but does not register an additional share pool or provide sale proceeds to the company.",
  signal: "neutral",
  summary: "BitCompute's reoffer prospectus covers 1,200,000 shares held by Alice Lee and Brian Park. The shares are a subset of the parent plan registration, and the company will not receive proceeds from their resale.",
  ticker: "BITC",
  title: "BitCompute Files Reoffer Prospectus for 1.2 Million Plan Shares",
  watchNext: ["Resales reported by the named selling stockholders."],
  whyItMatters: "The filing enables liquidity for existing plan shares; the reoffer subset must not be added to the parent registration as new supply.",
});

commonFilingEvents["s8-post-effective-amendment-fixture"] = s8Fixture({
  company: "Delta Robotics Inc.",
  deliveryLevel: "feed",
  filedAt: "May 14, 2026 - 4:45 PM ET",
  filingBrief: "Delta Robotics added 2,000,000 shares to a parent equity plan registration that previously covered 5,000,000 shares.",
  formType: "S-8/A",
  id: "s8-post-effective-amendment-fixture",
  keyEvidence: [
    "The amendment registers 2,000,000 additional shares.",
    "The parent registration covered 5,000,000 shares.",
  ],
  s8: {
    detailsTitle: "Amendment Details",
    details: [
      { label: "What Changed", value: "2,000,000 additional shares registered" },
      { label: "Parent Plan Shares", value: "5,000,000 shares" },
      { label: "Additional / Outstanding", value: "2.22%" },
      { label: "Parent Plan / Outstanding", value: "5.56%" },
    ],
    mode: "post_effective_amendment",
    snapshot: {
      title: "Plan Amendment Snapshot",
      items: [
        { label: "Amendment Status", value: "Additional shares registered" },
        { label: "Additional Shares", value: "2,000,000" },
        { label: "Prior Shares Carried Forward", value: "5,000,000" },
        { label: "Additional / Outstanding", value: "2.22%" },
      ],
    },
  },
  score: 58,
  scoreRationale: "The amendment adds shares equal to 2.22% of outstanding stock to the existing compensation registration.",
  signal: "neutral",
  summary: "Delta Robotics registered 2,000,000 additional shares under an equity compensation plan. The related parent registration previously covered 5,000,000 shares.",
  ticker: "DRBT",
  title: "Delta Robotics Adds 2 Million Shares to Equity Plan Registration",
  watchNext: ["Future grants under the expanded plan registration."],
  whyItMatters: "Unlike an administrative amendment, this filing adds a source-backed share pool that can increase compensation dilution over time.",
});

commonFilingEvents["s8-administrative-amendment-fallback-fixture"] = s8Fixture({
  company: "Global Pharma Inc.",
  deliveryLevel: "archive",
  filedAt: "June 2, 2026 - 4:10 PM ET",
  filingBrief: "Global Pharma filed an exhibit-only post-effective amendment that registers no additional securities.",
  formType: "S-8 POS",
  id: "s8-administrative-amendment-fallback-fixture",
  keyEvidence: ["The amendment adds exhibits and registers no additional securities."],
  s8: null,
  score: 20,
  scoreRationale: "The amendment is administrative and does not add securities or change the registered plan share pool.",
  signal: "neutral",
  summary: "Global Pharma filed an exhibit-only post-effective amendment related to prior registration statements 333-210001 and 333-250002. No additional securities were registered.",
  ticker: "GLPH",
  title: "Global Pharma Files Administrative S-8 Amendment",
  watchNext: [],
  whyItMatters: "The filing updates exhibits without changing the registered securities and therefore remains a low-priority administrative event.",
});

export function generateStaticParams() {
  return Object.keys(commonFilingEvents).map((id) => ({ id }));
}

export async function generateMetadata({ params }: FilingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const fixture = registeredFilingUiFixtures.find(
    (entry) => entry.route === `/filings/${id}`,
  );
  const family = fixture
    ? filingUiFamilies.find((entry) => entry.id === fixture.family)
    : null;

  return {
    title: fixture && family
      ? `${family.label} Fixture | Stock Radar`
      : "Filing Analysis | Stock Radar",
    robots: fixture ? { follow: false, index: false } : undefined,
  };
}

export default async function FilingDetailPage({ params }: FilingDetailPageProps) {
  const { id } = await params;
  const filing = await resolveFilingEvent(id);
  const preferredSourceUrl = buildGooglePreferredSourceUrl(getServerEnv().appBaseUrl);
  const eventBadge = getEventTypeBadge(filing.eventType);
  const hasRealFilingTicker = isRealTicker(filing.ticker);
  const dilutionModel = filing.eventType === "dilution_risk" ? buildDilutionOfferingModel(filing) : null;
  const listingFinancialRiskSnapshot = buildListingFinancialRiskSnapshot(filing);
  const form25ListingStatus = filing.form25ListingStatus || null;
  const strategicTransactionSnapshot = filing.strategicTransactionSnapshot || null;
  const form425TransactionSnapshot = filing.form425TransactionSnapshot || null;
  const governanceEvent = filing.governanceEvent || null;
  const operatingEvent = filing.operatingEvent || null;
  const periodicReport = filing.periodicReport || null;
  const proxyVote = filing.proxyVote || null;
  const ownership = filing.ownership || null;
  const offeringRegistration = filing.offeringRegistration || null;
  const tenderOffer = filing.tenderOffer || null;
  const ntLateFilingSnapshot = filing.ntLateFilingSnapshot || null;
  const s8 = filing.s8 || null;
  const isS8Filing = isS8FormType(filing.formType);
  const useDilutionDetail = Boolean(
    dilutionModel && !dilutionModel.isShelfOnly && !dilutionModel.isCommonWarrantOnly
  );

  if (isS8Filing || offeringRegistration || filing.financingDilution || !useDilutionDetail || !dilutionModel) {
    const genericFiling = buildGenericFilingAnalysisData(filing);
    const useSummaryOfferingSplit = Boolean(
      (offeringRegistration || filing.financingDilution) &&
        !(offeringRegistration || filing.financingDilution)?.scale &&
        (offeringRegistration || filing.financingDilution)?.offeringDetails.length,
    );
    const analysisFiling = listingFinancialRiskSnapshot || form25ListingStatus || strategicTransactionSnapshot || form425TransactionSnapshot || governanceEvent || operatingEvent || periodicReport || proxyVote || ownership || tenderOffer || ntLateFilingSnapshot || s8 || offeringRegistration || filing.financingDilution
      ? {
          ...genericFiling,
          ...(offeringRegistration || filing.financingDilution
            ? {
                bearishPoints: [],
                bullishPoints: [],
                keyEvidence: [],
                watchNext: [],
              }
            : governanceEvent || operatingEvent || periodicReport || ownership
            ? {
                bearishPoints: [],
                bullishPoints: [],
                keyEvidence: [],
                watchNext: [],
              }
            : proxyVote
              ? {
                  bearishPoints: [],
                  bullishPoints: [],
                  keyEvidence: [],
                  watchNext: genericFiling.watchNext.slice(0, 3),
                }
            : tenderOffer
              ? {
                  bearishPoints: [],
                  bullishPoints: [],
                  keyEvidence: genericFiling.keyEvidence.slice(0, 3),
                  watchNext: genericFiling.watchNext.slice(0, 3),
                }
            : ntLateFilingSnapshot || s8
              ? {
                  bearishPoints: [],
                  bullishPoints: [],
                  keyEvidence: genericFiling.keyEvidence.slice(0, 3),
                  watchNext: genericFiling.watchNext.slice(0, 3),
                }
            : form25ListingStatus
              ? {
                  bearishPoints: [],
                  bullishPoints: [],
                  keyEvidence: genericFiling.keyEvidence.slice(0, 3),
                  watchNext: genericFiling.watchNext.slice(0, 3),
                }
            : {
                keyEvidence: genericFiling.keyEvidence.slice(0, 3),
                watchNext: genericFiling.watchNext.slice(0, 3),
              }),
        }
      : genericFiling;

    return (
      <StockRadarAppShell
        activeNavigationItem="filings"
        themeMode="user-selectable"
      >
        <GenericFilingAnalysis
          bodyRenderer={
            offeringRegistration ? (
              useSummaryOfferingSplit ? (
                <OfferingRegistrationInstrumentDetails data={offeringRegistration} />
              ) : (
                <OfferingRegistrationDetails data={offeringRegistration} />
              )
            ) : filing.financingDilution ? (
              useSummaryOfferingSplit ? (
                <FinancingDilutionInstrumentDetails data={filing.financingDilution} />
              ) : (
                <FinancingDilutionDetails data={filing.financingDilution} />
              )
            ) : governanceEvent ? (
              <GovernanceEventChanges data={governanceEvent} />
            ) : operatingEvent ? (
              <OperatingEventDetails data={operatingEvent} />
            ) : periodicReport ? (
              <PeriodicReportDetails data={periodicReport} />
            ) : proxyVote ? (
              <ProxyProposalAgenda data={proxyVote} />
            ) : ownership ? (
              <OwnershipDetails data={ownership} />
            ) : tenderOffer ? (
              <TenderOfferDetails data={tenderOffer} />
            ) : s8 ? (
              <S8Details data={s8} />
            ) : undefined
          }
          contextRenderer={
            isGenericFieldAvailable(filing, "context") ? (
              <SectorThemeContextPanel context={filing.context} ticker={filing.ticker} />
            ) : undefined
          }
          detailRenderer={
            offeringRegistration ? (
              <OfferingRegistrationSnapshot data={offeringRegistration} />
            ) : filing.financingDilution ? (
              <FinancingDilutionSnapshot data={filing.financingDilution} />
            ) : form25ListingStatus ? (
              <ListingFinancialRiskSnapshot snapshot={form25ListingStatus.snapshot} />
            ) : listingFinancialRiskSnapshot ? (
              <ListingFinancialRiskSnapshot snapshot={listingFinancialRiskSnapshot} />
            ) : strategicTransactionSnapshot ? (
              <StrategicTransactionSnapshot snapshot={strategicTransactionSnapshot} />
            ) : form425TransactionSnapshot ? (
              <StrategicTransactionSnapshot snapshot={form425TransactionSnapshot} />
            ) : governanceEvent ? (
              <GovernanceEventSnapshot data={governanceEvent} />
            ) : operatingEvent ? (
              <OperatingEventSnapshot data={operatingEvent} />
            ) : periodicReport ? (
              <PeriodicReportSnapshot data={periodicReport} />
            ) : proxyVote ? (
              <ProxyVoteSnapshot data={proxyVote} />
            ) : ownership ? (
              <OwnershipSnapshot data={ownership} />
            ) : tenderOffer ? (
              <TenderOfferSnapshot data={tenderOffer} />
            ) : ntLateFilingSnapshot ? (
              <ListingFinancialRiskSnapshot snapshot={ntLateFilingSnapshot} />
            ) : s8 ? (
              <S8Snapshot data={s8} />
            ) : undefined
          }
          eventLabel={eventBadge.label}
          eventTone={toGenericBadgeTone(eventBadge.tone)}
          filing={analysisFiling}
          summaryAsideRenderer={
            offeringRegistration && useSummaryOfferingSplit ? (
              <OfferingRegistrationOfferingDetails data={offeringRegistration} />
            ) : filing.financingDilution && useSummaryOfferingSplit ? (
              <FinancingDilutionOfferingDetails data={filing.financingDilution} />
            ) : undefined
          }
          filingId={id}
          originalRenderer={
            isGenericFieldAvailable(filing, "originalHtml") ? (
              <OriginalFilingText
                eventLabel={eventBadge.label}
                filing={filing}
                includeMetadataTable={false}
              />
            ) : undefined
          }
          priceRenderer={hasRealFilingTicker ? (
            <PriceChartCard
              change={filing.change}
              changeAmount={filing.changeAmount}
              mobileCollapsible
              price={filing.price}
              rangeAppearance="neutral"
              series={filing.priceSeries}
              ticker={filing.ticker}
              tone={filing.signal}
            />
          ) : undefined}
          sourceFooterActionRenderer={
            preferredSourceUrl ? <GooglePreferredSourceLink href={preferredSourceUrl} /> : undefined
          }
        />
      </StockRadarAppShell>
    );
  }

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

          {useDilutionDetail && dilutionModel ? (
            <DilutionOfferingTemplate eventLabel={eventBadge.label} filing={filing} model={dilutionModel} />
          ) : (
            <CommonFilingTemplate eventLabel={eventBadge.label} filing={filing} />
          )}
        </article>

        <aside className="stock-detail-rail">
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
            {preferredSourceUrl ? (
              <GooglePreferredSourceLink href={preferredSourceUrl} />
            ) : null}
          </section>
        </aside>
      </div>
    </main>
  );
}

async function resolveFilingEvent(id: string): Promise<FilingEvent> {
  const fixture = commonFilingEvents[id];
  if (fixture) return fixture;

  if (!isUuid(id)) {
    notFound();
  }

  const detailResult = await getLiveEventDetail(id);
  const item = detailResult.item;

  if (!item || item.sourceGroup !== "filings") {
    notFound();
  }

  return buildDbFilingEvent(item);
}

async function buildDbFilingEvent(item: LiveFeedItem): Promise<FilingEvent> {
  const normalizedTicker = item.ticker.trim().toUpperCase();
  const ticker = isRealTicker(normalizedTicker) ? normalizedTicker : "";
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
  const analysisMetadata = toRecord(analysis?.metadata);
  const rawPayload = toRecord(rawItem?.raw_payload);
  const storedMarketContext =
    toRecord(metadata?.market_context) ||
    toRecord(metadata?.marketContext);
  const formType = readFilingFormType(eventRow, rawPayload, item.title);
  const offeringTermsResult =
    isOfferingRegistrationForm(formType) || item.eventType === "dilution_risk"
    ? await fetchEventOfferingTerms(item.id)
    : null;
  const listingFinancialRiskSnapshot = readStoredListingFinancialRiskSnapshot(
    item.eventType,
    metadata,
    analysisMetadata,
  );
  const form25ListingStatus = readStoredForm25ListingStatus(
    metadata,
    analysisMetadata,
    formType,
  );
  const form425TransactionSnapshot = readStoredForm425TransactionSnapshot(
    metadata,
    analysisMetadata,
    formType,
    item.deliveryLevel,
  );
  const governanceEvent = readStoredGovernanceEvent(metadata, analysisMetadata);
  const operatingEvent = readStoredOperatingEvent(metadata, analysisMetadata);
  const periodicReport = readStoredPeriodicReport(metadata, analysisMetadata);
  const proxyVote = readStoredProxyVote(metadata, analysisMetadata);
  const ownership = readStoredOwnership(metadata, analysisMetadata, formType);
  const tenderOffer = readStoredTenderOffer(metadata, analysisMetadata, formType);
  const ntLateFilingSnapshot = readStoredNtLateFilingSnapshot(
    metadata,
    analysisMetadata,
    formType,
  );
  const s8 = readStoredS8(metadata, analysisMetadata, formType);
  const offeringRegistration = readStoredOfferingRegistration(
    metadata,
    analysisMetadata,
    toRecord(offeringTermsResult),
    formType,
  );
  const financingDilution = offeringRegistration
    ? null
    : readStoredFinancingDilution(metadata, analysisMetadata);
  const scoreRationale = readStoredScoreRationale(
    analysis,
    analysisMetadata,
    metadata,
  );
  const badge = getEventTypeBadge(item.eventType);
  const filedAt = formatDetailDateTime(
    readRowString(eventRow, "published_at") || item.detectedAtRaw || readRowString(eventRow, "detected_at"),
    `${item.time} ET`,
  );
  const sourceUrl = firstOriginalFilingUrl([
    item.sourceUrl,
    readRowString(rawItem, "source_url"),
    readMetadataString(eventRow, "source_url"),
    readMetadataString(eventRow, "url"),
  ]);
  const company =
    form25ListingStatus?.issuerName ||
    (formType.trim().toUpperCase() === "425"
      ? readRowString(storedMarketContext, "name")
      : "") ||
    readRowString(metadata, "issuer") ||
    readRowString(metadata, "company") ||
    readRowString(metadata, "company_name") ||
    readRowString(rawPayload, "issuer") ||
    "";
  const originalHtml = readOriginalHtml(eventRow, rawItem, rawPayload);
  const relatedNewsRows = toRows(relatedNewsResult.data);
  const recentFilingRows = toRows(recentFilingsResult.data);
  const marketContext = buildDbMarketContext(item, eventRow);
  const filingBrief = cleanStoredAnalysisText(item.quickTake || item.summary);
  const whyItMatters = cleanStoredAnalysisText(readRowString(analysis, "why_it_matters"));
  const summary = cleanStoredAnalysisText(item.summary);
  const bullishPoints = toStringArray(analysis?.bullish_points, []);
  const bearishPoints = toStringArray(analysis?.bearish_points, []);
  const keyEvidence = toStringArray(analysis?.key_evidence, []);
  const watchNext = toStringArray(analysis?.watch_next, []);
  const recentFilings = mapRecentFilingRows(recentFilingRows, item.id);
  const relatedNews = mapRelatedNewsRows(relatedNewsRows);
  const genericAvailability: GenericFilingAvailability = {
    bearishPoints: bearishPoints.length > 0,
    bullishPoints: bullishPoints.length > 0,
    context: Boolean(marketContext),
    filingBrief: Boolean(filingBrief),
    keyEvidence: keyEvidence.length > 0,
    originalHtml: Boolean(cleanDisclosureValue(stripHtml(originalHtml))),
    recentFilings: recentFilings.length > 0,
    relatedNews: relatedNews.length > 0,
    scoreRationale: Boolean(cleanDisclosureValue(scoreRationale)),
    summary: Boolean(summary),
    watchNext: watchNext.length > 0,
    whyItMatters: Boolean(whyItMatters),
  };

  return {
    id: item.id,
    ticker,
    exchange:
      readRowString(eventRow, "market") ||
      readMetadataString(eventRow, "exchange") ||
      form25ListingStatus?.exchange ||
      "",
    company,
    title: item.title,
    formType,
    filedAt,
    source: formatGenericFilingSource(item.source),
    sourceUrl,
    eventType: item.eventType,
    impact: item.impact,
    deliveryLevel: item.deliveryLevel,
    score: item.score,
    signal: item.signal,
    price: item.price,
    changeAmount: item.changeAmount,
    change: item.change,
    filingFocus: readMetadataString(eventRow, "filing_focus"),
    filingBrief,
    whyItMatters,
    bullishPoints,
    bearishPoints,
    summary,
    keyEvidence,
    watchNext,
    recentFilings,
    relatedNews,
    scoreRationale,
    context: marketContext || emptySectorThemeContext(item.score, item.signal),
    priceSeries: null,
    originalTextNote: originalHtml ? "SEC filing text preserved from the raw item store." : "",
    originalHtml,
    listingFinancialRiskSnapshot,
    form25ListingStatus,
    form425TransactionSnapshot,
    governanceEvent,
    operatingEvent,
    periodicReport,
    proxyVote,
    ownership,
    tenderOffer,
    ntLateFilingSnapshot,
    s8,
    financingDilution,
    offeringRegistration,
    offeringDisplayModel:
      readPlainRecord(toRecord(toRecord(offeringTermsResult)?.metadata)?.offering_display_model) ||
      readPlainRecord(analysisMetadata?.offering_display_model) ||
      readPlainRecord(metadata?.offering_display_model) ||
      null,
    offeringMarketContext: readPlainRecord(metadata?.market_context),
    offeringDilutionMetrics: readPlainRecord(metadata?.dilution_metrics),
    offeringTerms: readPlainRecord(offeringTermsResult),
    s3Case:
      readRowString(analysis, "s3_case") ||
      readRowString(analysisMetadata, "s3_case") ||
      readRowString(metadata, "s3_case") ||
      null,
    genericAvailability,
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
  const storedContext =
    toRecord(metadata?.market_context) ||
    toRecord(metadata?.marketContext) ||
    null;
  const storedPeriods = toRecord(storedContext?.periods);
  const sharedMovers = readStoredTopMovers(
    storedContext?.topMovers ||
      storedContext?.top_movers ||
      metadata?.topMovers ||
      metadata?.top_movers,
  );
  const sector = firstStoredValue([
    item.sector,
    readRowString(metadata, "sector"),
    readRowString(metadata, "sector_name"),
    readRowString(storedContext, "sector"),
  ]);
  const industry = firstStoredValue([
    item.industryGroup,
    readRowString(metadata, "industry_group"),
    readRowString(metadata, "industry"),
    readRowString(metadata, "sub_category"),
    readRowString(metadata, "subCategory"),
    readRowString(storedContext, "industry"),
  ]);
  const themeGroup = firstStoredValue([
    item.themeGroup,
    readRowString(metadata, "theme_group"),
    readRowString(metadata, "themeGroup"),
    readRowString(storedContext, "theme_group"),
    readRowString(storedContext, "themeGroup"),
  ]);
  const subTheme = firstStoredValue([
    item.subTheme,
    readRowString(metadata, "sub_theme"),
    readRowString(metadata, "subTheme"),
    readRowString(storedContext, "sub_theme"),
    readRowString(storedContext, "subTheme"),
  ]);
  const marketCap = firstStoredValue([
    readRowString(metadata, "market_cap"),
    readRowString(metadata, "marketCap"),
    readRowString(storedContext, "market_cap"),
    readRowString(storedContext, "marketCap"),
  ]);
  const sharesOutstanding = firstStoredValue([
    readRowString(metadata, "shares_outstanding"),
    readRowString(metadata, "sharesOutstanding"),
    readRowString(storedContext, "shares_outstanding"),
    readRowString(storedContext, "sharesOutstanding"),
  ]);
  const publicFloat = firstStoredValue([
    readRowString(metadata, "public_float"),
    readRowString(metadata, "publicFloat"),
    readRowString(storedContext, "public_float"),
    readRowString(storedContext, "publicFloat"),
  ]);
  const publicFloatPercent = firstStoredValue([
    readRowString(metadata, "public_float_percent"),
    readRowString(metadata, "publicFloatPercent"),
    readRowString(storedContext, "public_float_percent"),
    readRowString(storedContext, "publicFloatPercent"),
  ]);
  const periods = {
    "1D": buildStoredContextPeriod("1D", storedPeriods, metadata, sharedMovers, item),
    "5D": buildStoredContextPeriod("5D", storedPeriods, metadata, sharedMovers, item),
    "30D": buildStoredContextPeriod("30D", storedPeriods, metadata, sharedMovers, item),
  } satisfies Record<"1D" | "5D" | "30D", SectorThemePeriod>;
  const hasMovers = Object.values(periods).some((period) => period.topMovers.length > 0);

  if (
    !sector &&
    !industry &&
    !themeGroup &&
    !subTheme &&
    !marketCap &&
    !sharesOutstanding &&
    !publicFloat &&
    !publicFloatPercent &&
    !hasMovers
  ) {
    return undefined;
  }

  return {
    sector: sector || undefined,
    industry: industry || undefined,
    marketCap: formatStoredMarketCap(marketCap) || undefined,
    sharesOutstanding: formatStoredShareCount(sharesOutstanding) || undefined,
    publicFloat: formatStoredShareCount(publicFloat) || undefined,
    publicFloatPercent: formatStoredPercent(publicFloatPercent) || undefined,
    themeGroup: themeGroup || undefined,
    subTheme: subTheme || undefined,
    contextTitle: firstStoredValue([
      readRowString(storedContext, "context_title"),
      readRowString(storedContext, "contextTitle"),
    ]) || undefined,
    moverGroupName: firstStoredValue([
      readRowString(storedContext, "mover_group_name"),
      readRowString(storedContext, "moverGroupName"),
    ]) || undefined,
    moverMode: readStoredMoverMode(storedContext),
    periods,
  };
}

function formatStoredMarketCap(value: string) {
  const numeric = parsePlainStoredNumber(value);
  if (numeric === null) return value;
  if (numeric >= 1_000_000_000_000) return `$${formatCompactStoredNumber(numeric / 1_000_000_000_000)}T`;
  if (numeric >= 1_000_000_000) return `$${formatCompactStoredNumber(numeric / 1_000_000_000)}B`;
  if (numeric >= 1_000_000) return `$${formatCompactStoredNumber(numeric / 1_000_000)}M`;
  return `$${Math.round(numeric).toLocaleString("en-US")}`;
}

function formatStoredShareCount(value: string) {
  const numeric = parsePlainStoredNumber(value);
  if (numeric === null) return value;
  if (numeric >= 1_000_000_000) return `${formatCompactStoredNumber(numeric / 1_000_000_000)}B`;
  if (numeric >= 1_000_000) return `${formatCompactStoredNumber(numeric / 1_000_000)}M`;
  return Math.round(numeric).toLocaleString("en-US");
}

function formatStoredPercent(value: string) {
  const numeric = parsePlainStoredNumber(value);
  if (numeric === null) return value;
  return `${numeric.toFixed(1)}%`;
}

function parsePlainStoredNumber(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCompactStoredNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0,
  }).format(value);
}

function buildStoredContextPeriod(
  range: "1D" | "5D" | "30D",
  storedPeriods: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
  sharedMovers: TopMover[],
  item: LiveFeedItem,
): SectorThemePeriod {
  const storedPeriod =
    toRecord(storedPeriods?.[range]) ||
    toRecord(storedPeriods?.[range.toLowerCase()]) ||
    null;
  const suffix = range.toLowerCase();
  const periodMovers = readStoredTopMovers(
    storedPeriod?.topMovers || storedPeriod?.top_movers,
  );

  return {
    sectorChange: firstStoredValue([
      readRowString(storedPeriod, "sectorChange"),
      readRowString(storedPeriod, "sector_change"),
      readRowString(metadata, `sector_change_${suffix}`),
    ]) || undefined,
    industryChange: firstStoredValue([
      readRowString(storedPeriod, "industryChange"),
      readRowString(storedPeriod, "industry_change"),
      readRowString(metadata, `industry_change_${suffix}`),
    ]) || undefined,
    themeChange: firstStoredValue([
      readRowString(storedPeriod, "themeChange"),
      readRowString(storedPeriod, "theme_change"),
      readRowString(metadata, `theme_change_${suffix}`),
    ]) || undefined,
    subThemeChange: firstStoredValue([
      readRowString(storedPeriod, "subThemeChange"),
      readRowString(storedPeriod, "sub_theme_change"),
      readRowString(metadata, `sub_theme_change_${suffix}`),
    ]) || undefined,
    themeScore: item.score,
    themeSignal: item.signal,
    topMovers: periodMovers.length ? periodMovers : sharedMovers,
  };
}

function readStoredTopMovers(value: unknown): TopMover[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry): TopMover | null => {
      if (typeof entry === "string") {
        const symbol = entry.trim().toUpperCase();
        return isRealTicker(symbol) ? { symbol } : null;
      }

      const mover = toRecord(entry);
      const symbol = firstStoredValue([
        readRowString(mover, "symbol"),
        readRowString(mover, "ticker"),
      ]).toUpperCase();
      if (!isRealTicker(symbol)) return null;

      const change = readStoredMoverChange(mover);
      const trend = readStoredTrend(
        mover?.trend || mover?.trend_points || mover?.trendPoints || mover?.values,
      );

      return {
        symbol,
        ...(change ? { change } : {}),
        ...(trend.length ? { trend } : {}),
      };
    })
    .filter((mover): mover is TopMover => Boolean(mover));
}

function readStoredMoverChange(mover: Record<string, unknown> | null) {
  const text = firstStoredValue([
    readRowString(mover, "change"),
    readRowString(mover, "change_percent"),
    readRowString(mover, "changePercent"),
  ]);
  if (!text) return "";
  if (text.includes("%")) return text;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return "";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function readStoredTrend(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (typeof point === "number" && Number.isFinite(point)) return point;
      const record = toRecord(point);
      const close = record?.close;
      return typeof close === "number" && Number.isFinite(close) ? close : null;
    })
    .filter((point): point is number => point !== null);
}

function readStoredMoverMode(value: Record<string, unknown> | null): SectorThemeContext["moverMode"] {
  const mode = firstStoredValue([
    readRowString(value, "mover_mode"),
    readRowString(value, "moverMode"),
  ]);
  return mode === "related" || mode === "top_movers" || mode === "market_top_movers"
    ? mode
    : undefined;
}

function emptySectorThemeContext(score: number, signal: DetailTone): SectorThemeContext {
  const period = (): SectorThemePeriod => ({
    themeScore: score,
    themeSignal: signal,
    topMovers: [],
  });

  return {
    periods: {
      "1D": period(),
      "5D": period(),
      "30D": period(),
    },
  };
}

function financingFixtureAvailability(): GenericFilingAvailability {
  return {
    bearishPoints: false,
    bullishPoints: false,
    context: true,
    filingBrief: true,
    keyEvidence: false,
    originalHtml: true,
    recentFilings: true,
    relatedNews: true,
    scoreRationale: true,
    summary: true,
    watchNext: false,
    whyItMatters: true,
  };
}

function buildOperatingFixtureContext(): SectorThemeContext {
  const topMovers: TopMover[] = [
    { symbol: "MDB", change: "-5.73%", trend: [58, 56, 54, 55, 51, 49, 47, 48, 44, 42] },
    { symbol: "ORCL", change: "+0.62%", trend: [38, 39, 41, 40, 42, 44, 43, 45, 46, 47] },
    { symbol: "SNOW", change: "-1.14%", trend: [51, 49, 50, 47, 46, 44, 45, 42, 41, 40] },
    { symbol: "DDOG", change: "+0.91%", trend: [35, 37, 36, 39, 41, 40, 43, 44, 46, 47] },
  ];
  const period = (
    sectorChange: string,
    industryChange: string,
    themeChange: string,
  ): SectorThemePeriod => ({
    industryChange,
    sectorChange,
    themeChange,
    themeScore: 85,
    themeSignal: "bullish",
    topMovers,
  });

  return {
    industry: "Software & Cloud",
    marketCap: "$27.51B",
    periods: {
      "1D": period("+0.28%", "-0.36%", "-0.18%"),
      "5D": period("+1.42%", "+0.72%", "+0.48%"),
      "30D": period("+4.18%", "+3.26%", "+2.84%"),
    },
    publicFloat: "78.32M",
    publicFloatPercent: "97.4%",
    sector: "Technology",
    sharesOutstanding: "80.43M",
    themeGroup: "Software & Cloud",
  };
}

function buildPeriodicFixtureContext(): SectorThemeContext {
  const topMovers: TopMover[] = [
    { symbol: "AMZN", change: "+3.04%", trend: [42, 44, 43, 47, 49, 48, 52, 54, 53, 57] },
    { symbol: "MSFT", change: "+1.18%", trend: [38, 39, 41, 40, 43, 45, 44, 47, 48, 49] },
    { symbol: "GOOGL", change: "+0.72%", trend: [43, 42, 44, 46, 45, 47, 49, 48, 50, 51] },
    { symbol: "META", change: "-0.46%", trend: [52, 51, 49, 50, 47, 46, 48, 45, 44, 43] },
  ];
  const period = (
    sectorChange: string,
    industryChange: string,
    themeChange: string,
  ): SectorThemePeriod => ({
    industryChange,
    sectorChange,
    themeChange,
    themeScore: 80,
    themeSignal: "bullish",
    topMovers,
  });

  return {
    industry: "Broadline Retail",
    marketCap: "$2.03T",
    periods: {
      "1D": period("+0.84%", "+1.26%", "+1.11%"),
      "5D": period("+2.14%", "+3.08%", "+2.72%"),
      "30D": period("+5.62%", "+7.14%", "+6.48%"),
    },
    publicFloat: "10.12B",
    publicFloatPercent: "91.8%",
    sector: "Consumer Cyclical",
    sharesOutstanding: "10.84B",
    themeGroup: "Cloud & AI Infrastructure",
  };
}

function buildFinancingFixtureContext({
  marketCap,
  publicFloat,
  publicFloatPercent,
  score,
  sharesOutstanding,
  signal,
  ticker,
}: {
  marketCap: string;
  publicFloat: string;
  publicFloatPercent: string;
  score: number;
  sharesOutstanding: string;
  signal: DetailTone;
  ticker: string;
}): SectorThemeContext {
  const movers = (tickerChange: string): TopMover[] => [
    { symbol: ticker, change: tickerChange, trend: [56, 53, 54, 50, 48, 46, 47, 43, 42, 40] },
    { symbol: "MRNA", change: "+0.84%", trend: [36, 38, 37, 40, 41, 43, 42, 45, 46, 47] },
    { symbol: "CRSP", change: "-0.52%", trend: [48, 46, 47, 44, 43, 41, 42, 40, 39, 38] },
    { symbol: "BEAM", change: "+1.16%", trend: [32, 34, 33, 36, 38, 37, 40, 42, 43, 45] },
    { symbol: "EDIT", change: "-1.24%", trend: [52, 50, 48, 49, 46, 44, 43, 41, 40, 38] },
    { symbol: "VERV", change: "+0.63%", trend: [35, 36, 38, 37, 40, 41, 43, 42, 44, 46] },
  ];
  const period = (
    tickerChange: string,
    sectorChange: string,
    industryChange: string,
    themeChange: string,
    subThemeChange: string,
  ): SectorThemePeriod => ({
    industryChange,
    sectorChange,
    subThemeChange,
    themeChange,
    themeScore: score,
    themeSignal: signal,
    topMovers: movers(tickerChange),
  });

  return {
    industry: "Biotechnology",
    marketCap,
    periods: {
      "1D": period("-2.18%", "+0.21%", "-0.47%", "-0.32%", "-0.64%"),
      "5D": period("-5.62%", "+0.84%", "-1.38%", "-0.91%", "-1.72%"),
      "30D": period("-11.46%", "+2.16%", "-4.82%", "-3.58%", "-6.14%"),
    },
    publicFloat,
    publicFloatPercent,
    sector: "Healthcare",
    sharesOutstanding,
    subTheme: "Clinical Stage Biotech",
    themeGroup: "Biotech Catalysts",
  };
}

function readStoredProxyVote(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): ProxyVoteData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  if (readRowString(displayPayload, "display_type") !== "proxy_vote") return null;

  const data = toRecord(displayPayload?.data);
  if (!data) return null;

  const snapshotItems = readStoredSnapshotItems(data.snapshot)
    .filter((item) => isDisclosedValue(item.label) && isDisclosedValue(item.value))
    .slice(0, 4);
  const proposals = readStoredProxyProposals(data.proposals);
  if (snapshotItems.length !== 4 || !proposals.length) return null;

  return {
    proposals,
    snapshot: {
      items: snapshotItems,
      title: readRowString(data, "summary_title") || "Proxy Vote Snapshot",
    },
  };
}

function readStoredProxyProposals(value: unknown): ProxyProposal[] {
  return recordArray(value)
    .map((item, index): ProxyProposal | null => {
      const title = cleanDisclosureValue(readRowString(item, "title"));
      if (!title) return null;

      const category = cleanDisclosureValue(
        readRowString(item, "type") || readRowString(item, "category"),
      );
      const boardRecommendation = cleanDisclosureValue(
        readRowString(item, "board_recommendation") ||
          readRowString(item, "recommendation"),
      );
      const details = recordArray(item.details)
        .map((detail): ProxyProposal["details"][number] | null => {
          const label = cleanDisclosureValue(readRowString(detail, "label"));
          const detailValue = cleanDisclosureValue(readRowString(detail, "value"));
          if (!label || !isDisclosedValue(detailValue)) return null;
          const note = cleanDisclosureValue(readRowString(detail, "note"));
          return {
            label,
            value: detailValue,
            ...(note ? { note } : {}),
          };
        })
        .filter((detail): detail is ProxyProposal["details"][number] => Boolean(detail))
        .slice(0, 4);

      return {
        ...(isDisclosedValue(boardRecommendation) ? { boardRecommendation } : {}),
        ...(isDisclosedValue(category) ? { category } : {}),
        details,
        explanation: cleanDisclosureValue(readRowString(item, "explanation")) || undefined,
        id: cleanDisclosureValue(readRowString(item, "id")) || String(index + 1),
        isShareholderProposal:
          item.is_shareholder_proposal === true ||
          String(item.is_shareholder_proposal || "").toLowerCase() === "true",
        title,
      };
    })
    .filter((item): item is ProxyProposal => Boolean(item));
}

function readStoredOwnership(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
): OwnershipData | null {
  const normalizedForm = formType.trim().toUpperCase().replaceAll(" ", "");
  if (!["4", "4/A", "144", "144/A"].includes(normalizedForm)) return null;

  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  if (readRowString(displayPayload, "display_type") !== "candidate_special") return null;

  const data = toRecord(displayPayload?.data);
  if (!data) return null;

  if (normalizedForm === "4" || normalizedForm === "4/A") {
    return readStoredForm4Ownership(data);
  }

  return readStoredForm144Ownership(data, normalizedForm === "144/A");
}

function readStoredForm4Ownership(data: Record<string, unknown>): OwnershipData | null {
  const form4 = toRecord(data.form4);
  if (!form4) return null;

  const owner = toRecord(data.reporting_owner);
  const ownerName = firstStoredValue([
    readRowString(owner, "name"),
    readRowString(data, "owner_name"),
  ]);
  const relationship = firstStoredValue([
    readRowString(owner, "title"),
    ownershipRoleText(owner?.roles),
    readRowString(data, "owner_title"),
  ]);
  if (!ownerName || !relationship) return null;

  const rawTransactions = [
    ...recordArray(form4.non_derivative_transactions),
    ...recordArray(form4.derivative_transactions),
  ];
  const plan10b5 = ownershipHas10b5Reference(data);
  const transactions = rawTransactions
    .map((row) => readStoredOwnershipTransaction(row, plan10b5))
    .filter((row): row is OwnershipTransaction => Boolean(row));
  if (!transactions.length) return null;

  const hasPurchase = transactions.some((transaction) => transaction.code === "P");
  const hasSale = transactions.some((transaction) => transaction.code === "S");
  if (!hasPurchase && !hasSale) return null;

  const shareTotal = sumOwnershipNumbers(
    rawTransactions
      .filter((row) => ["P", "S"].includes(readRowString(row, "transaction_code").toUpperCase()))
      .map((row) => ownershipNumber(row.shares)),
  );
  const valueTotal = firstPositiveOwnershipNumber([
    ownershipNumber(form4.total_reported_value),
    sumOwnershipNumbers(rawTransactions.map((row) => ownershipNumber(row.transaction_value))),
  ]);
  const primaryType = hasPurchase && hasSale
    ? "Purchase and sale"
    : hasPurchase
      ? "Open-market purchase"
      : "Reported sale";
  const transactionDate = firstStoredValue(
    rawTransactions.map((row) => formatOwnershipDate(readRowString(row, "transaction_date"))),
  );
  const amountItem = valueTotal > 0
    ? {
        label: "Reported Value",
        note: shareTotal > 0 ? `${formatOwnershipQuantity(shareTotal)} shares` : undefined,
        value: formatOwnershipCurrency(valueTotal),
      }
    : shareTotal > 0
      ? {
          label: "Shares Reported",
          value: formatOwnershipQuantity(shareTotal),
        }
      : null;
  if (!amountItem) return null;

  return {
    mode: "form4_transaction",
    snapshot: {
      title: "Insider Transaction",
      items: [
        { label: "Reporting Owner", value: ownerName },
        { label: "Relationship", value: relationship },
        {
          label: "Transaction",
          value: primaryType,
          ...(transactionDate || plan10b5
            ? { note: [transactionDate, plan10b5 ? "Rule 10b5-1 plan" : ""].filter(Boolean).join(" · ") }
            : {}),
        },
        amountItem,
      ],
    },
    transactions,
  };
}

function readStoredOwnershipTransaction(
  row: Record<string, unknown>,
  plan10b5: boolean,
): OwnershipTransaction | null {
  const code = readRowString(row, "transaction_code").toUpperCase();
  if (code !== "P" && code !== "S") return null;

  const security = readRowString(row, "security_title");
  const shares = ownershipDisplayNumber(row.shares, readRowString(row, "shares_text"));
  if (!security || !shares) return null;

  const price = ownershipDisplayCurrency(
    row.price_per_share,
    readRowString(row, "price_per_share_text"),
  );
  const value = ownershipDisplayCurrency(row.transaction_value, "");
  const holdingsAfter = ownershipDisplayNumber(
    row.shares_owned_following,
    readRowString(row, "shares_owned_following_text"),
  );

  return {
    code,
    date: formatOwnershipDate(readRowString(row, "transaction_date")) || undefined,
    holdingsAfter: holdingsAfter || undefined,
    plan10b5: code === "S" && plan10b5,
    price: price || undefined,
    security,
    shares,
    type: code === "P" ? "Purchase" : "Sale",
    value: value || undefined,
  };
}

function readStoredForm144Ownership(
  data: Record<string, unknown>,
  isAmendment: boolean,
): OwnershipData | null {
  const form144 = toRecord(data.form144);
  if (!form144) return null;

  const owner = toRecord(data.reporting_owner);
  const seller = firstStoredValue([
    readRowString(owner, "name"),
    readRowString(form144, "seller_name"),
    readRowString(data, "owner_name"),
  ]);
  const shares = ownershipNumber(form144.securities_to_be_sold);
  const marketValue = ownershipNumber(form144.aggregate_market_value);
  if (!seller || shares <= 0 || marketValue <= 0) return null;

  const approximateSaleDate = formatOwnershipDate(
    readRowString(form144, "approximate_sale_date"),
  );
  const securityClass = readRowString(form144, "securities_class_title");
  const relationship = firstStoredValue([
    readRowString(owner, "title"),
    ownershipRoleText(owner?.roles),
  ]);
  const amendment = toRecord(data.amendment);
  const amendmentReason = firstStoredValue([
    readRowString(amendment, "reason"),
    readRowString(amendment, "amendment_reason"),
    readRowString(data, "amendment_reason"),
  ]);
  const details: OwnershipDetailRow[] = [
    {
      label: "Notice Status",
      note: "Form 144 is not proof of execution",
      value: "Proposed sale",
    },
    ...(securityClass ? [{ label: "Security", value: securityClass }] : []),
    { label: "Shares Proposed", value: formatOwnershipQuantity(shares) },
    { label: "Estimated Market Value", value: formatOwnershipCurrency(marketValue) },
    ...(approximateSaleDate
      ? [{ label: "Approximate Sale Date", value: approximateSaleDate }]
      : []),
  ];
  const amendmentDetails = isAmendment && amendmentReason
    ? [{ label: "Amendment", value: amendmentReason }]
    : undefined;

  return {
    ...(amendmentDetails ? { amendmentDetails } : {}),
    details,
    mode: "form144_proposed_sale",
    snapshot: {
      title: isAmendment ? "Proposed Insider Sale Amendment" : "Proposed Insider Sale",
      items: [
        {
          label: "Seller",
          value: seller,
          ...(relationship ? { note: relationship } : {}),
        },
        {
          label: "Notice Status",
          note: "Not reported as executed",
          value: "Proposed sale",
        },
        { label: "Shares Proposed", value: formatOwnershipQuantity(shares) },
        {
          label: "Estimated Value",
          value: formatOwnershipCurrency(marketValue),
          ...(approximateSaleDate ? { note: `Approximate sale date: ${approximateSaleDate}` } : {}),
        },
      ],
    },
  };
}

function ownershipRoleText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
    : "";
}

function ownershipHas10b5Reference(data: Record<string, unknown>) {
  if (data.has_10b5_1_reference === true) return true;
  return /10b5-?1/i.test(JSON.stringify({ footnotes: data.footnotes, remarks: data.remarks }));
}

function ownershipNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value.replaceAll(",", "").replace(/[$%]/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumOwnershipNumbers(values: number[]) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function firstPositiveOwnershipNumber(values: number[]) {
  return values.find((value) => Number.isFinite(value) && value > 0) || 0;
}

function ownershipDisplayNumber(value: unknown, storedText: string) {
  const numeric = ownershipNumber(value);
  if (numeric > 0) return formatOwnershipQuantity(numeric);
  return cleanDisclosureValue(storedText);
}

function ownershipDisplayCurrency(value: unknown, storedText: string) {
  const numeric = ownershipNumber(value);
  if (numeric > 0) return formatOwnershipCurrency(numeric);
  const cleaned = cleanDisclosureValue(storedText);
  return cleaned ? (cleaned.startsWith("$") ? cleaned : `$${cleaned}`) : "";
}

function formatOwnershipQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 4,
  }).format(value);
}

function formatOwnershipCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 100 ? 4 : 0,
    style: "currency",
  }).format(value);
}

function formatOwnershipDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return cleanDisclosureValue(value);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function readStoredTenderOffer(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
): TenderOfferData | null {
  const normalizedForm = formType.trim().toUpperCase().replaceAll(" ", "");
  if (!/^(?:SCTO-[ICT](?:\/A)?|SC13E3(?:\/A)?|CB(?:\/A)?)$/.test(normalizedForm)) {
    return null;
  }

  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const data = toRecord(displayPayload?.data);
  const fingerprint =
    toRecord(eventMetadata?.transaction_fingerprint) ||
    toRecord(analysisMetadata?.transaction_fingerprint);
  if (!data || !fingerprint) return null;

  const transactionType = readRowString(fingerprint, "transaction_type");
  const transactionFamily = readRowString(fingerprint, "transaction_family");
  const amendmentChangeType = readRowString(fingerprint, "amendment_change_type");
  const changedTerms = toStringArray(fingerprint.material_terms_changed, []);
  const isAmendment = normalizedForm.endsWith("/A") || transactionType === "amendment_update";
  if (
    isAmendment &&
    (amendmentChangeType === "procedural" || amendmentChangeType === "no_material_change")
  ) {
    return null;
  }

  if (isAmendment && !changedTerms.length && amendmentChangeType === "unknown") {
    return null;
  }

  const cashPrice = firstStoredValue([
    readRowString(fingerprint, "cash_price"),
    formatTenderCashPrice(data.cash_price_per_share),
    formatTenderCashPrice(data.new_offer_price),
  ]);
  const expiration = formatTenderDate(firstStoredValue([
    readRowString(fingerprint, "offer_expiration"),
    readRowString(data, "expiration_date"),
    readRowString(data, "new_expiration_date"),
  ]));
  const target = firstStoredValue([
    readRowString(fingerprint, "target_company"),
    readRowString(data, "target_company"),
  ]);
  const offeror = firstStoredValue([
    readRowString(fingerprint, "offeror"),
    readRowString(data, "offeror"),
  ]);

  if (isAmendment && transactionType === "amendment_update") {
    return buildStoredTenderAmendment({
      cashPrice,
      data,
      expiration,
      fingerprint,
      offeror,
      target,
    });
  }

  if (transactionType === "issuer_tender" || transactionFamily === "issuer_repurchase") {
    return buildStoredIssuerTender({ cashPrice, data, expiration, fingerprint, offeror });
  }

  if (transactionType === "going_private_cash_out" || transactionFamily === "going_private") {
    return buildStoredGoingPrivateTender({ cashPrice, data, fingerprint });
  }

  if (transactionType === "exchange_offer" || transactionFamily === "cross_border") {
    return buildStoredCrossBorderTender({ data, expiration, fingerprint, offeror, target });
  }

  if (transactionType === "third_party_tender" || transactionType === "merger_tender") {
    return buildStoredThirdPartyTender({ cashPrice, data, expiration, fingerprint, offeror, target });
  }

  return null;
}

function buildStoredIssuerTender({
  cashPrice,
  data,
  expiration,
  fingerprint,
  offeror,
}: {
  cashPrice: string;
  data: Record<string, unknown>;
  expiration: string;
  fingerprint: Record<string, unknown>;
  offeror: string;
}): TenderOfferData | null {
  const offerSize = firstStoredValue([
    readRowString(fingerprint, "offer_size"),
    formatTenderMoney(data.aggregate_purchase_price),
  ]);
  const securitiesSought = firstStoredValue([
    readRowString(fingerprint, "securities_sought"),
    formatTenderQuantity(data.shares_sought, "shares"),
  ]);
  const snapshot = tenderSnapshot("Issuer Tender Snapshot", [
    { label: "Cash Price", value: cashPrice },
    { label: "Maximum Purchase", value: offerSize },
    { label: "Shares Sought", value: securitiesSought },
    { label: "Expiration", value: expiration },
  ]);
  if (!snapshot) return null;

  return {
    mode: "issuer_tender",
    snapshot,
    termsTitle: "Tender Terms",
    terms: tenderTerms([
      { label: "Offeror", value: offeror },
      { label: "Consideration", value: readRowString(fingerprint, "consideration_summary") || cashPrice },
      {
        label: "Proration",
        value: tenderBoolean(data.proration) ? "Applies" : "",
      },
      {
        label: "Withdrawal Deadline",
        value: formatTenderDate(readRowString(data, "withdrawal_deadline")),
      },
    ]),
  };
}

function buildStoredThirdPartyTender({
  cashPrice,
  data,
  expiration,
  fingerprint,
  offeror,
  target,
}: {
  cashPrice: string;
  data: Record<string, unknown>;
  expiration: string;
  fingerprint: Record<string, unknown>;
  offeror: string;
  target: string;
}): TenderOfferData | null {
  const premium = formatTenderPercent(data.premium_percent);
  const snapshot = tenderSnapshot("Acquisition Tender Snapshot", [
    { label: "Offer Price", value: cashPrice, ...(premium ? { note: `Stated premium: ${premium}` } : {}) },
    { label: "Target", value: target },
    { label: "Expiration", value: expiration },
    { label: "Offeror", value: offeror },
  ]);
  if (!snapshot) return null;

  return {
    mode: "third_party_tender",
    snapshot,
    termsTitle: "Offer Conditions",
    terms: tenderTerms([
      { label: "Consideration", value: readRowString(fingerprint, "consideration_summary") || cashPrice },
      { label: "Minimum Tender", value: readRowString(fingerprint, "minimum_condition") },
      { label: "Financing Condition", value: readRowString(fingerprint, "financing_condition") },
      ...toStringArray(data.conditions, []).map((condition) => ({
        label: "Condition",
        value: formatTenderStoredLabel(condition),
      })),
    ]),
  };
}

function buildStoredGoingPrivateTender({
  cashPrice,
  data,
  fingerprint,
}: {
  cashPrice: string;
  data: Record<string, unknown>;
  fingerprint: Record<string, unknown>;
}): TenderOfferData | null {
  const affectedHolders = readRowString(fingerprint, "securities_sought");
  const minorityApproval = readRowString(fingerprint, "minimum_condition");
  const snapshot = tenderSnapshot("Going-Private Snapshot", [
    { label: "Cash-Out Price", value: cashPrice },
    { label: "Affected Holders", value: affectedHolders },
    { label: "Minority Approval", value: minorityApproval },
    { label: "Appraisal Rights", value: tenderBoolean(data.appraisal_rights) ? "Available" : "" },
  ]);
  if (!snapshot) return null;

  return {
    mode: "going_private",
    snapshot,
    termsTitle: "Going-Private Terms",
    terms: tenderTerms([
      { label: "Transaction", value: "Rule 13e-3 going private" },
      { label: "Consideration", value: readRowString(fingerprint, "consideration_summary") || cashPrice },
      {
        label: "Special Committee",
        value: tenderBoolean(data.special_committee_fairness) ? "Fairness process disclosed" : "",
      },
      { label: "Holder Approval", value: minorityApproval },
    ]),
  };
}

function buildStoredCrossBorderTender({
  data,
  expiration,
  fingerprint,
  offeror,
  target,
}: {
  data: Record<string, unknown>;
  expiration: string;
  fingerprint: Record<string, unknown>;
  offeror: string;
  target: string;
}): TenderOfferData | null {
  const exchangeRatio = firstStoredValue([
    readRowString(fingerprint, "exchange_ratio"),
    readRowString(data, "exchange_ratio"),
  ]);
  const snapshot = tenderSnapshot("Cross-Border Offer Snapshot", [
    { label: "Exchange Ratio", value: exchangeRatio },
    { label: "Offeror", value: offeror },
    { label: "Expiration", value: expiration },
    { label: "Proration", value: tenderBoolean(data.proration) ? "Applies" : "" },
  ]);
  if (!snapshot) return null;

  return {
    mode: "cross_border",
    snapshot,
    termsTitle: "Exchange Offer Terms",
    terms: tenderTerms([
      { label: "Target", value: target },
      { label: "Consideration", value: readRowString(fingerprint, "consideration_summary") || exchangeRatio },
      { label: "Securities Sought", value: readRowString(fingerprint, "securities_sought") },
      { label: "Cross-Border Exemption", value: readRowString(data, "cross_border_exemption") },
    ]),
  };
}

function buildStoredTenderAmendment({
  cashPrice,
  data,
  expiration,
  fingerprint,
  offeror,
  target,
}: {
  cashPrice: string;
  data: Record<string, unknown>;
  expiration: string;
  fingerprint: Record<string, unknown>;
  offeror: string;
  target: string;
}): TenderOfferData | null {
  const previousPrice = formatTenderCashPrice(data.prior_offer_price);
  const previousExpiration = formatTenderDate(readRowString(data, "prior_expiration_date"));
  const amendmentNumber = readRowString(fingerprint, "amendment_number");
  const changes: TenderOfferChange[] = [
    ...(previousPrice && cashPrice
      ? [{ label: "Offer Price", previous: previousPrice, current: cashPrice }]
      : []),
    ...(previousExpiration && expiration
      ? [{ label: "Expiration", previous: previousExpiration, current: expiration }]
      : []),
  ];
  const otherTerms = tenderBoolean(data.terms_otherwise_unchanged) ? "Unchanged" : "";
  const snapshot = tenderSnapshot("Tender Amendment Snapshot", [
    { label: "Amendment", value: amendmentNumber ? `No. ${amendmentNumber}` : "" },
    { label: "New Offer Price", value: cashPrice, ...(previousPrice ? { note: `Previously ${previousPrice}` } : {}) },
    { label: "New Expiration", value: expiration, ...(previousExpiration ? { note: `Previously ${previousExpiration}` } : {}) },
    { label: "Other Terms", value: otherTerms },
  ]);
  if (!snapshot || !changes.length) return null;

  return {
    changes,
    mode: "material_amendment",
    snapshot,
    termsTitle: "Current Offer Terms",
    terms: tenderTerms([
      { label: "Offeror", value: offeror },
      { label: "Target", value: target },
      { label: "Consideration", value: readRowString(fingerprint, "consideration_summary") || cashPrice },
    ]),
  };
}

function tenderSnapshot(
  title: string,
  items: ListingFinancialRiskSnapshotData["items"],
): ListingFinancialRiskSnapshotData | null {
  const cleaned = items
    .map((item) => ({
      label: cleanDisclosureValue(item.label),
      value: cleanDisclosureValue(item.value),
      ...(item.note && cleanDisclosureValue(item.note)
        ? { note: cleanDisclosureValue(item.note) }
        : {}),
    }))
    .filter((item) => isDisclosedValue(item.label) && isDisclosedValue(item.value));
  return cleaned.length === 4 ? { items: cleaned, title } : null;
}

function tenderTerms(terms: TenderOfferTerm[]) {
  return terms
    .map((term) => ({
      label: cleanDisclosureValue(term.label),
      value: cleanDisclosureValue(term.value),
      ...(term.note && cleanDisclosureValue(term.note)
        ? { note: cleanDisclosureValue(term.note) }
        : {}),
    }))
    .filter((term) => isDisclosedValue(term.label) && isDisclosedValue(term.value));
}

function formatTenderCashPrice(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(numeric);
}

function formatTenderMoney(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
  }).format(numeric);
}

function formatTenderQuantity(value: unknown, suffix = "") {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatTenderPercent(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? `${numeric}%` : "";
}

function formatTenderDate(value: string) {
  return value ? formatOwnershipDate(value) : "";
}

function tenderBoolean(value: unknown) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function formatTenderStoredLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function readStoredGovernanceEvent(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): GovernanceEventData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  if (readRowString(displayPayload, "display_type") !== "governance_event") return null;

  const data = toRecord(displayPayload?.data);
  const mode = readGovernanceEventMode(readRowString(data, "governance_mode"));
  if (!data || !mode) return null;

  const snapshotItems = readStoredSnapshotItems(data.snapshot_metrics)
    .filter((item) => cleanDisclosureValue(item.label) && cleanDisclosureValue(item.value))
    .slice(0, 4);
  const changes = readStoredGovernanceChanges(data.key_changes).slice(0, 4);

  if (snapshotItems.length !== 4 || !changes.length) return null;

  return {
    changes,
    changesTitle: mode === "vote_result" ? "Vote Results" : "Key Changes",
    mode,
    snapshot: {
      items: snapshotItems,
      title: firstStoredValue([
        readRowString(data, "snapshot_title"),
        readRowString(data, "title"),
      ]) || governanceSnapshotTitle(mode),
    },
  };
}

function readGovernanceEventMode(value: string): GovernanceEventMode | null {
  return value === "leadership_change" ||
    value === "auditor_change" ||
    value === "vote_result" ||
    value === "governance_change" ||
    value === "mixed"
    ? value
    : null;
}

function governanceSnapshotTitle(mode: GovernanceEventMode) {
  if (mode === "auditor_change") return "Auditor Change";
  if (mode === "leadership_change") return "Leadership Change";
  if (mode === "vote_result") return "Vote Result";
  if (mode === "governance_change") return "Governance Change";
  return "Governance Event";
}

function readStoredGovernanceChanges(value: unknown): GovernanceEventChange[] {
  return recordArray(value)
    .map((item): GovernanceEventChange | null => {
      const category = readRowString(item, "category");
      const title = readRowString(item, "title");
      if (!category || !title) return null;

      const details = recordArray(item.details)
        .map((detail) => {
          const label = readRowString(detail, "label");
          const detailValue = readRowString(detail, "value");
          if (!label || !detailValue) return null;
          const note = readRowString(detail, "note");
          return {
            label,
            value: detailValue,
            ...(note ? { note } : {}),
          };
        })
        .filter((detail): detail is GovernanceEventChange["details"][number] => Boolean(detail))
        .slice(0, 3);

      return {
        category,
        details,
        explanation: readRowString(item, "explanation"),
        title,
      };
    })
    .filter((change): change is GovernanceEventChange => Boolean(change));
}

function readStoredOperatingEvent(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): OperatingLegalRoutineData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  if (readRowString(displayPayload, "display_type") !== "operating_event") return null;

  const data = toRecord(displayPayload?.data);
  const mode = readOperatingEventMode(readRowString(data, "operating_mode"));
  if (!data || !mode || mode === "routine_archive") return null;

  const regulatoryStage = readOperatingRegulatoryStage(
    readRowString(data, "regulatory_stage"),
  );
  const snapshotItems = readStoredSnapshotItems(data.snapshot_metrics)
    .filter((item) => cleanDisclosureValue(item.label) && cleanDisclosureValue(item.value))
    .slice(0, 4);
  const performanceComparisons = readStoredOperatingComparisons(
    data.performance_comparisons,
  );
  const guidanceMetrics = readStoredOperatingGuidance(data.guidance_metrics);
  const promotedGuidance = new Set<OperatingGuidanceMetric>();

  if (mode === "operating_update" && snapshotItems.length < 4) {
    for (const guidance of guidanceMetrics) {
      if (snapshotItems.length >= 4) break;
      const normalizedValue = guidance.guidanceValue.trim().toLowerCase();
      if (snapshotItems.some((item) => item.value.trim().toLowerCase() === normalizedValue)) {
        continue;
      }
      snapshotItems.push({
        label: `${guidance.guidanceLabel} Guidance`,
        value: guidance.guidanceValue,
        note: guidance.label,
      });
      promotedGuidance.add(guidance);
    }
  }

  if (snapshotItems.length !== 4) return null;

  return {
    businessUpdates: readStoredOperatingBusinessUpdates(data),
    detailSections: mode === "earnings" ? [] : readStoredOperatingDetailSections(data.detail_sections),
    guidanceMetrics: guidanceMetrics.filter((item) => !promotedGuidance.has(item)),
    mode,
    performanceComparisons,
    regulatoryStage,
    secondaryUpdates: readStoredOperatingSecondaryUpdates(data.secondary_updates),
    snapshot: {
      items: snapshotItems,
      title:
        readRowString(data, "snapshot_title") ||
        operatingSnapshotTitle(mode),
    },
  };
}

function readOperatingEventMode(value: string): OperatingEventMode | "routine_archive" | null {
  return value === "earnings" ||
    value === "operating_update" ||
    value === "product_or_regulatory" ||
    value === "legal_or_accounting" ||
    value === "routine_archive"
    ? value
    : null;
}

function readOperatingRegulatoryStage(value: string): OperatingRegulatoryStage {
  return value === "ind_or_clinical_hold" ||
    value === "application_review" ||
    value === "advisory_committee" ||
    value === "approval" ||
    value === "crl_or_appeal" ||
    value === "clinical_update" ||
    value === "other_regulatory"
    ? value
    : "not_applicable";
}

function operatingSnapshotTitle(mode: OperatingEventMode) {
  if (mode === "earnings") return "Earnings Snapshot";
  if (mode === "operating_update") return "Operating Snapshot";
  if (mode === "product_or_regulatory") return "Product / Regulatory Snapshot";
  return "Legal / Accounting Snapshot";
}

function readStoredOperatingComparisons(value: unknown): OperatingPerformanceComparison[] {
  return recordArray(value)
    .map((item): OperatingPerformanceComparison | null => {
      const label = readRowString(item, "label");
      const currentLabel = readRowString(item, "current_label");
      const currentValue = readRowString(item, "current_value");
      const currentNumeric = readOptionalStoredNumber(item, "current_numeric");
      const comparisonLabel = readRowString(item, "comparison_label");
      const comparisonValue = readRowString(item, "comparison_value");
      const comparisonNumeric = readOptionalStoredNumber(item, "comparison_numeric");
      if (
        !label ||
        !currentLabel ||
        !currentValue ||
        currentNumeric === null ||
        !comparisonLabel ||
        !comparisonValue ||
        comparisonNumeric === null
      ) {
        return null;
      }

      return {
        changeNote: readRowString(item, "change_note") || undefined,
        comparisonBasis: inferOperatingComparisonBasis(
          readRowString(item, "comparison_basis"),
          currentLabel,
          comparisonLabel,
        ),
        comparisonLabel,
        comparisonNumeric,
        comparisonValue,
        currentLabel,
        currentNumeric,
        currentValue,
        label,
      };
    })
    .filter((item): item is OperatingPerformanceComparison => Boolean(item))
    .slice(0, 3);
}

function readStoredOperatingGuidance(value: unknown): OperatingGuidanceMetric[] {
  return recordArray(value)
    .map((item): OperatingGuidanceMetric | null => {
      const label = readRowString(item, "label");
      const guidanceLabel = readRowString(item, "guidance_label");
      const guidanceValue = readRowString(item, "guidance_value");
      if (!label || !guidanceLabel || !guidanceValue) return null;

      const relationship = readRowString(item, "performance_relationship");
      const performanceRelationship =
        relationship === "same_basis" ||
        relationship === "related_different_basis" ||
        relationship === "standalone"
          ? relationship
          : "standalone";

      return {
        guidanceLabel,
        guidanceValue,
        label,
        note: readRowString(item, "note") || undefined,
        performanceLabel: readRowString(item, "performance_label") || undefined,
        performanceRelationship,
      };
    })
    .filter((item): item is OperatingGuidanceMetric => Boolean(item))
    .slice(0, 3);
}

function readStoredOperatingBusinessUpdates(
  data: Record<string, unknown>,
): OperatingBusinessUpdate[] {
  const modern = recordArray(data.business_catalysts)
    .map((item): OperatingBusinessUpdate | null => {
      const title = readRowString(item, "title");
      const summary = readRowString(item, "summary");
      if (!title || !summary) return null;
      return {
        summary,
        title,
        value: readRowString(item, "value") || undefined,
      };
    })
    .filter((item): item is OperatingBusinessUpdate => Boolean(item));
  if (modern.length) return modern.slice(0, 3);

  const legacyMetrics = readStoredSnapshotItems(data.operating_metrics).map((item) => ({
    summary: item.note || `${item.label}: ${item.value}.`,
    title: item.label,
    value: item.value,
  }));
  const legacyHighlights = recordArray(data.business_highlights)
    .map((item): OperatingBusinessUpdate | null => {
      const title = readRowString(item, "title");
      const summary = readRowString(item, "summary");
      return title && summary ? { summary, title } : null;
    })
    .filter((item): item is OperatingBusinessUpdate => Boolean(item));

  return [...legacyMetrics, ...legacyHighlights].slice(0, 3);
}

function readStoredOperatingDetailSections(value: unknown): OperatingDetailSection[] {
  return recordArray(value)
    .map((section): OperatingDetailSection | null => {
      const title = readRowString(section, "title");
      const rows = readStoredSnapshotItems(section.rows).slice(0, 5);
      return title && rows.length ? { rows, title } : null;
    })
    .filter((section): section is OperatingDetailSection => Boolean(section))
    .slice(0, 2);
}

function readStoredOperatingSecondaryUpdates(value: unknown): OperatingSecondaryUpdate[] {
  return recordArray(value)
    .map((item): OperatingSecondaryUpdate | null => {
      const label = readRowString(item, "label");
      const title = readRowString(item, "title");
      const summary = readRowString(item, "summary");
      return label && title && summary ? { label, summary, title } : null;
    })
    .filter((item): item is OperatingSecondaryUpdate => Boolean(item))
    .slice(0, 1);
}

function readStoredPeriodicReport(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): PeriodicReportData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const displayType = readRowString(displayPayload, "display_type");
  if (displayType !== "periodic_report" && displayType !== "periodic_amendment") {
    return null;
  }

  const data = toRecord(displayPayload?.data);
  if (!data) return null;

  const snapshotItems = readStoredSnapshotItems(data.snapshot_metrics)
    .filter((item) => cleanDisclosureValue(item.label) && cleanDisclosureValue(item.value))
    .slice(0, 4);
  if (snapshotItems.length !== 4) return null;

  const formType = readRowString(data, "form_type");
  const snapshot = {
    items: snapshotItems,
    title:
      readRowString(data, "snapshot_title") ||
      periodicSnapshotTitle(formType, displayType === "periodic_amendment"),
  };

  if (displayType === "periodic_amendment") {
    const changes = readStoredPeriodicAmendmentChanges(data);
    if (!changes.length) return null;
    return { changes, mode: "amendment", snapshot };
  }

  const performanceComparisons = readStoredOperatingComparisons(
    data.performance_comparisons,
  );
  const guidanceMetrics = readStoredOperatingGuidance(data.guidance_metrics);
  const businessUpdates = readStoredPeriodicBusinessUpdates(data.key_business_updates);
  if (!performanceComparisons.length && !guidanceMetrics.length && !businessUpdates.length) {
    return null;
  }

  return {
    businessUpdates,
    guidanceMetrics,
    mode: "report",
    performanceComparisons,
    snapshot,
  };
}

function periodicSnapshotTitle(formType: string, isAmendment: boolean) {
  if (isAmendment) return "Report Amendment Snapshot";
  const normalized = formType.toUpperCase();
  if (normalized.startsWith("10-Q")) return "Quarterly Report Snapshot";
  if (normalized.startsWith("20-F")) return "Annual Report Snapshot";
  return "Annual Report Snapshot";
}

function readStoredPeriodicBusinessUpdates(value: unknown): OperatingBusinessUpdate[] {
  return recordArray(value)
    .map((item): OperatingBusinessUpdate | null => {
      const title = readRowString(item, "title");
      const summary = readRowString(item, "summary");
      if (!title || !summary) return null;
      return {
        summary,
        title,
        value: readRowString(item, "value") || undefined,
      };
    })
    .filter((item): item is OperatingBusinessUpdate => Boolean(item))
    .slice(0, 3);
}

function readStoredPeriodicAmendmentChanges(
  data: Record<string, unknown>,
): PeriodicAmendmentChange[] {
  const changes = recordArray(data.change_details)
    .map((item): PeriodicAmendmentChange | null => {
      const title = readRowString(item, "title");
      const value = readRowString(item, "value");
      if (!title || !value) return null;
      return {
        note: readRowString(item, "note") || undefined,
        title,
        value,
      };
    })
    .filter((item): item is PeriodicAmendmentChange => Boolean(item));
  if (changes.length) return changes.slice(0, 4);

  return recordArray(data.changed_metrics)
    .map((item): PeriodicAmendmentChange | null => {
      const title = readRowString(item, "label") || readRowString(item, "title");
      const before = readRowString(item, "before") || readRowString(item, "previous_value");
      const after = readRowString(item, "after") || readRowString(item, "current_value");
      if (!title || (!before && !after)) return null;
      return {
        note: readRowString(item, "note") || undefined,
        title,
        value: [before, after].filter(Boolean).join(" to "),
      };
    })
    .filter((item): item is PeriodicAmendmentChange => Boolean(item))
    .slice(0, 4);
}

const S8_MODES: readonly S8Mode[] = [
  "plan_registration",
  "inducement_awards",
  "reoffer_resale",
  "post_effective_amendment",
];

const S8_CONTEXT_LABELS = new Set([
  "Parent filing",
  "Parent plan shares",
  "Reoffer subset",
  "Relationship",
  "Company proceeds",
  "Selling holders",
  "What changed",
  "What did not change",
]);

function readStoredS8(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
): S8Data | null {
  if (!/^S-8(?:\s+POS|\/A)?$/i.test(formType.trim())) return null;

  const displayPayloadCandidates = [
    toRecord(eventMetadata?.display_payload),
    toRecord(analysisMetadata?.display_payload),
    toRecord(eventMetadata?.displayPayload),
    toRecord(analysisMetadata?.displayPayload),
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

  const displayPayload = displayPayloadCandidates.find((candidate) => {
    const data = toRecord(candidate.data) || candidate;
    return Boolean(readRowString(data, "s8_ui_mode") || readRowString(data, "s8UiMode"));
  });
  if (!displayPayload) return null;

  const data = toRecord(displayPayload.data) || displayPayload;
  const storedMode = readRowString(data, "s8_ui_mode") || readRowString(data, "s8UiMode");
  if (!S8_MODES.includes(storedMode as S8Mode)) return null;
  const mode = storedMode as S8Mode;

  const snapshotItems = [
    data.snapshot_metrics,
    data.snapshotMetrics,
    data.snapshot,
    eventMetadata?.snapshot_metrics,
    analysisMetadata?.snapshot_metrics,
  ]
    .map((candidate) => readStoredSnapshotItems(candidate))
    .find((items) => items.length === 4) || buildStoredS8FlatSnapshotItems(data, mode);
  if (!snapshotItems) return null;

  const details = readStoredS8ContextDetails(data);
  const fallbackDetails = details.length ? details : buildStoredS8DetailRows(data, mode);
  if (!fallbackDetails.length) return null;

  return {
    details: fallbackDetails.slice(0, 6),
    detailsTitle: s8DetailsTitle(mode),
    mode,
    snapshot: {
      items: snapshotItems,
      title: s8SnapshotTitle(mode),
    },
  };
}

function buildStoredS8FlatSnapshotItems(
  data: Record<string, unknown>,
  mode: S8Mode,
): ListingFinancialRiskSnapshotData["items"] | null {
  if (mode !== "inducement_awards") return null;

  const currentShares = firstStoredValue([
    readStoredScalar(data.current_shares_outstanding),
    readStoredScalar(data.currentSharesOutstanding),
  ]);
  const planShares = firstStoredValue([
    readStoredScalar(data.plan_registered_shares),
    readStoredScalar(data.planRegisteredShares),
  ]);
  const inducementShares = firstStoredValue([
    readStoredScalar(data.inducement_award_shares),
    readStoredScalar(data.inducementAwardShares),
  ]);
  const totalShares = firstStoredValue([
    readStoredScalar(data.total_registered_shares),
    readStoredScalar(data.totalRegisteredShares),
  ]);
  const dilutionPercent = firstStoredValue([
    readStoredScalar(data.estimated_dilution_percent),
    readStoredScalar(data.estimatedDilutionPercent),
  ]);

  if (!currentShares || !planShares || !inducementShares || !totalShares) return null;

  return [
    { label: "Shares Outstanding", value: formatStoredShareCount(currentShares) },
    { label: "Plan Shares", value: formatStoredShareCount(planShares) },
    { label: "Inducement Shares", value: formatStoredShareCount(inducementShares) },
    {
      label: "Total Registered",
      value: formatStoredShareCount(totalShares),
      ...(dilutionPercent
        ? { note: `Estimated dilution: ${formatStoredPercent(dilutionPercent)}` }
        : {}),
    },
  ];
}

function isS8FormType(formType: string) {
  const normalized = formType.trim().toUpperCase().replace(/\s+/g, " ");
  return normalized === "S-8" || normalized === "S-8/A" || normalized === "S-8 POS";
}

function readStoredS8ContextDetails(data: Record<string, unknown>): S8DetailRow[] {
  return recordArray(data.s8_context_details || data.s8ContextDetails)
    .map((row): S8DetailRow | null => {
      const label = readRowString(row, "label");
      const value = firstStoredValue([
        readRowString(row, "value"),
        readRowString(row, "status"),
      ]);
      if (!S8_CONTEXT_LABELS.has(label) || !value) return null;
      const note = firstStoredValue([
        readRowString(row, "note"),
        readRowString(row, "detail"),
      ]);
      return { label, value, ...(note ? { note } : {}) };
    })
    .filter((row): row is S8DetailRow => Boolean(row));
}

function buildStoredS8DetailRows(data: Record<string, unknown>, mode: S8Mode) {
  const row = (label: string, keys: string[], noteKeys: string[] = []): S8DetailRow | null => {
    const value = firstStoredValue(keys.map((key) => readStoredScalar(data[key])));
    if (!value) return null;
    const note = firstStoredValue(noteKeys.map((key) => readStoredScalar(data[key])));
    return { label, value, ...(note ? { note } : {}) };
  };

  const rowsByMode: Record<S8Mode, Array<S8DetailRow | null>> = {
    plan_registration: [
      row("Plan Name", ["plan_name", "planName"]),
      row("Plan Type", ["plan_type", "planType"]),
      row("Registered Plan Shares", ["plan_registered_shares", "planRegisteredShares", "registered_shares", "registeredShares"]),
      row("Total Registered", ["total_registered_shares", "totalRegisteredShares"]),
    ],
    inducement_awards: [
      row("Plan Shares", ["plan_registered_shares", "planRegisteredShares"]),
      row("Inducement Shares", ["inducement_award_shares", "inducementAwardShares", "inducement_award_total_shares", "inducementAwardTotalShares"]),
      row("Total Registered", ["total_registered_shares", "totalRegisteredShares", "registered_shares", "registeredShares"]),
      row("Award Type", ["award_type", "awardType"]),
      row("Grant Date", ["grant_date", "grantDate"]),
      row("Recipient Count", ["recipient_count", "recipientCount"]),
    ],
    reoffer_resale: [
      row("Parent Plan Shares", ["parent_plan_shares", "parentPlanShares", "parent_registered_shares", "parentRegisteredShares"]),
      row("Reoffer Subset", ["reoffer_resale_shares", "reofferResaleShares", "reoffer_shares", "reofferShares"]),
      row("Relationship", ["relationship"]),
      row("Company Proceeds", ["company_proceeds", "companyProceeds"]),
      row("Selling Holders", ["selling_holder_count", "sellingHolderCount", "selling_holders", "sellingHolders"]),
    ],
    post_effective_amendment: [
      row("Amendment Status", ["amendment_status", "amendmentStatus", "amendment_type", "amendmentType"]),
      row("Additional Shares", ["additional_shares", "additionalShares"]),
      row("Prior Shares Carried Forward", ["prior_shares_carried_forward", "priorSharesCarriedForward", "parent_registered_shares", "parentRegisteredShares"]),
      row("Remaining Plan Shares Removed", ["remaining_plan_shares_removed", "remainingPlanSharesRemoved"]),
      row("What Changed", ["what_changed", "whatChanged"]),
      row("What Did Not Change", ["what_did_not_change", "whatDidNotChange"]),
    ],
  };

  return rowsByMode[mode].filter((item): item is S8DetailRow => Boolean(item));
}

function s8SnapshotTitle(mode: S8Mode) {
  if (mode === "plan_registration") return "Equity Plan Snapshot";
  if (mode === "inducement_awards") return "Inducement Award Snapshot";
  if (mode === "reoffer_resale") return "Reoffer Resale Snapshot";
  return "Plan Amendment Snapshot";
}

function s8DetailsTitle(mode: S8Mode) {
  if (mode === "plan_registration") return "Plan Registration Details";
  if (mode === "inducement_awards") return "Inducement Award Details";
  if (mode === "reoffer_resale") return "Reoffer / Resale Details";
  return "Amendment Details";
}

function readOptionalStoredNumber(
  row: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function inferOperatingComparisonBasis(
  supplied: string,
  currentLabel: string,
  comparisonLabel: string,
): OperatingPerformanceComparison["comparisonBasis"] {
  const currentQuarter = parseOperatingQuarterLabel(currentLabel);
  const comparisonQuarter = parseOperatingQuarterLabel(comparisonLabel);
  if (currentQuarter && comparisonQuarter) {
    if (
      currentQuarter.quarter === comparisonQuarter.quarter &&
      currentQuarter.year === comparisonQuarter.year + 1
    ) {
      return "yoy";
    }
    const currentSequence = currentQuarter.year * 4 + currentQuarter.quarter;
    const comparisonSequence = comparisonQuarter.year * 4 + comparisonQuarter.quarter;
    return currentSequence === comparisonSequence + 1 ? "qoq" : "other";
  }

  const currentYear = parseOperatingFiscalYearLabel(currentLabel);
  const comparisonYear = parseOperatingFiscalYearLabel(comparisonLabel);
  if (currentYear !== null && comparisonYear !== null) {
    return currentYear === comparisonYear + 1 ? "yoy" : "other";
  }
  return supplied === "yoy" || supplied === "qoq" ? supplied : "other";
}

function parseOperatingQuarterLabel(label: string) {
  const normalized = label.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  const match =
    normalized.match(/\bq([1-4])\s*(?:fy\s*)?(\d{2,4})\b/) ||
    normalized.match(/\b([1-4])q\s*(?:fy\s*)?(\d{2,4})\b/);
  if (!match) return null;
  const year = Number(match[2]);
  return { quarter: Number(match[1]), year: year < 100 ? 2000 + year : year };
}

function parseOperatingFiscalYearLabel(label: string) {
  const match = label
    .toLowerCase()
    .replace(/[’']/g, "")
    .match(/\b(?:fy|fiscal year|full year)\s*(\d{2,4})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return year < 100 ? 2000 + year : year;
}

function readStoredListingFinancialRiskSnapshot(
  eventType: string,
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): ListingFinancialRiskSnapshotData | null {
  if (eventType !== "listing_risk" && eventType !== "financial_risk") return null;

  const displayPayload = toRecord(eventMetadata?.display_payload);
  const displayData = toRecord(displayPayload?.data);
  const candidates = [
    analysisMetadata?.listing_status_snapshot,
    analysisMetadata?.financial_risk_snapshot,
    analysisMetadata?.restatement_status_snapshot,
    analysisMetadata?.risk_status_snapshot,
    analysisMetadata?.status_snapshot,
    eventMetadata?.listing_status_snapshot,
    eventMetadata?.financial_risk_snapshot,
    eventMetadata?.restatement_status_snapshot,
    eventMetadata?.risk_status_snapshot,
    eventMetadata?.status_snapshot,
    displayData?.listing_status_snapshot,
    displayData?.financial_risk_snapshot,
    displayData?.restatement_status_snapshot,
    displayData?.risk_status_snapshot,
    displayData?.status_snapshot,
  ];
  let storedSnapshot: unknown;
  let items: ListingFinancialRiskSnapshotItem[] = [];

  for (const candidate of candidates) {
    const candidateItems = readStoredSnapshotItems(candidate);
    if (!candidateItems.length) continue;
    storedSnapshot = candidate;
    items = candidateItems;
    break;
  }

  if (!items.length) return null;

  const snapshotRecord = toRecord(storedSnapshot);
  const explicitTitle = firstStoredValue([
    readRowString(snapshotRecord, "title"),
    readRowString(snapshotRecord, "heading"),
    readRowString(analysisMetadata, "listing_status_snapshot_title"),
    readRowString(analysisMetadata, "financial_risk_snapshot_title"),
    readRowString(analysisMetadata, "restatement_status_snapshot_title"),
    readRowString(analysisMetadata, "risk_status_snapshot_title"),
    readRowString(analysisMetadata, "status_snapshot_title"),
    readRowString(eventMetadata, "listing_status_snapshot_title"),
    readRowString(eventMetadata, "financial_risk_snapshot_title"),
    readRowString(eventMetadata, "restatement_status_snapshot_title"),
    readRowString(eventMetadata, "risk_status_snapshot_title"),
    readRowString(eventMetadata, "status_snapshot_title"),
    readRowString(displayData, "snapshot_title"),
  ]);

  return {
    items,
    title: explicitTitle || inferStoredSnapshotTitle(items),
  };
}

function readStoredNtLateFilingSnapshot(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
): ListingFinancialRiskSnapshotData | null {
  const normalizedForm = formType.trim().toUpperCase();
  if (!normalizedForm.startsWith("NT ") || normalizedForm.endsWith("/A")) return null;

  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const displayType = readRowString(displayPayload, "display_type");
  const displayVersion = readRowString(displayPayload, "display_version");
  if (displayType !== "nt_late_filing" && displayVersion !== "nt_late_filing_v1") {
    return null;
  }

  const data = toRecord(displayPayload?.data);
  if (!data) return null;

  const delayedReport = cleanNtSnapshotValue(
    readRowString(data, "delayed_report") || normalizedForm.replace(/^NT\s+/, ""),
  );
  const periodOfReport = formatNtSnapshotDate(readRowString(data, "period_of_report"));
  const anticipatedWithinExtension = data.anticipated_within_extension;
  const extensionDays = readOptionalNumber(data.extension_days);
  const filingTiming = formatNtFilingTiming(
    readRowString(data, "delay_status"),
    typeof anticipatedWithinExtension === "boolean"
      ? anticipatedWithinExtension
      : null,
  );
  const reasonForDelay = firstConciseNtValue([
    readRowString(data, "reason_for_delay_value"),
    readRowString(data, "underlying_issue"),
    readRowString(data, "late_filing_reason"),
  ], 180);
  const expectedResultsImpact = formatNtResultsImpact(
    firstConciseNtValue([
      readRowString(data, "expected_results_impact_value"),
      readRowString(data, "results_change"),
    ], 160),
    data.significant_change_expected,
  );
  const reliabilityRisk = formatNtReliabilityNote(
    readRowString(data, "financial_reliability_risk"),
  );

  const items: ListingFinancialRiskSnapshotItem[] = [
    {
      label: "Delayed Report",
      value: delayedReport,
      ...(periodOfReport ? { note: `Period ended ${periodOfReport}` } : {}),
    },
    {
      label: "Filing Timing",
      value: filingTiming,
      ...(anticipatedWithinExtension === true && extensionDays
        ? { note: `${extensionDays}-day extension window` }
        : {}),
    },
    {
      label: "Reason for Delay",
      value: reasonForDelay,
      ...(firstConciseNtValue([readRowString(data, "reason_for_delay_note")], 120)
        ? { note: firstConciseNtValue([readRowString(data, "reason_for_delay_note")], 120) }
        : {}),
    },
    {
      label: "Expected Results Impact",
      value: expectedResultsImpact,
      ...(firstConciseNtValue([readRowString(data, "expected_results_impact_note")], 120) || reliabilityRisk
        ? {
            note:
              firstConciseNtValue([readRowString(data, "expected_results_impact_note")], 120) ||
              reliabilityRisk,
          }
        : {}),
    },
  ].filter((item) => item.value && !isNtSnapshotPlaceholder(item.value));

  if (items.length !== 4) return null;

  return {
    title: "Late Filing Snapshot",
    items,
  };
}

function formatNtFilingTiming(value: string, anticipatedWithinExtension: boolean | null) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/within_extension|extension_expected|expected_within/.test(normalized)) {
    return "Expected within extension";
  }
  if (/outside_extension|extension_missed|not_expected_within/.test(normalized)) {
    return "Extension window at risk";
  }
  if (/filed|completed/.test(normalized)) return "Report filed";
  if (anticipatedWithinExtension === true) return "Expected within extension";
  if (anticipatedWithinExtension === false) return "Extension timing at risk";
  return cleanNtSnapshotValue(value);
}

function formatNtResultsImpact(value: string, significantChangeExpected: unknown) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^(?:none|none disclosed|no significant change|unchanged)$/.test(normalized)) {
    return "No significant change disclosed";
  }
  if (value) return cleanNtSnapshotValue(value);
  if (significantChangeExpected === true) return "Significant change expected";
  if (significantChangeExpected === false) return "No significant change disclosed";
  return "";
}

function formatNtReliabilityNote(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!normalized || /^(?:none|none disclosed|not disclosed|unknown)$/.test(normalized)) {
    return "";
  }
  return normalized === "explicit"
    ? "Financial reporting risk disclosed"
    : cleanNtSnapshotValue(value);
}

function firstConciseNtValue(values: string[], maxLength: number) {
  for (const value of values) {
    const cleaned = cleanNtSnapshotValue(value);
    if (cleaned && !isNtSnapshotPlaceholder(cleaned) && cleaned.length <= maxLength) {
      return cleaned;
    }
  }
  return "";
}

function cleanNtSnapshotValue(value: string) {
  const normalized = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return /^[a-z]/.test(normalized)
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : normalized;
}

function isNtSnapshotPlaceholder(value: string) {
  return /^(?:not disclosed|not stated|unknown|n\/?a|none|-|—)$/i.test(value.trim());
}

function formatNtSnapshotDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function readStoredForm425TransactionSnapshot(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
  deliveryLevel: FilingEvent["deliveryLevel"],
): StrategicTransactionSnapshotData | null {
  if (deliveryLevel === "archive" || formType.trim().toUpperCase() !== "425") {
    return null;
  }

  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const data = toRecord(displayPayload?.data);
  const storedSnapshot = toRecord(data?.analysis_snapshot);
  if (!storedSnapshot) return null;

  const items = readStoredSnapshotItems(storedSnapshot)
    .filter((item) => cleanDisclosureValue(item.label) && cleanDisclosureValue(item.value))
    .slice(0, 4);
  const title = firstStoredValue([
    readRowString(storedSnapshot, "title"),
    readRowString(data, "snapshot_title"),
  ]);

  if (!title || items.length !== 4) return null;

  return { items, title };
}

function readStoredForm25ListingStatus(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  formType: string,
): Form25ListingStatusData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const displayType = readRowString(displayPayload, "display_type");
  const normalizedForm = formType.trim().toUpperCase();
  const isForm25 =
    normalizedForm === "25" ||
    normalizedForm === "25/A" ||
    normalizedForm === "25-NSE" ||
    normalizedForm === "25-NSE/A" ||
    normalizedForm === "FORM 25" ||
    normalizedForm === "FORM 25-NSE";

  if (displayType !== "sec_form25_listing_removal" && !isForm25) return null;

  const data = toRecord(displayPayload?.data);
  if (!data) return null;

  const removedSecurity = readRowString(data, "removed_security");
  const exchange = readRowString(data, "exchange");
  const removalReason = firstStoredValue([
    readRowString(data, "removal_reason"),
    readRowString(data, "removal_reason_text"),
  ]);
  const ruleProvision = formatForm25RuleProvision(readRowString(data, "rule_provision"));
  const removalBasis = removalReason || ruleProvision;
  const filingDate = readRowString(data, "filing_date");
  const removalDate = readRowString(data, "delisting_or_removal_date");
  const effectivenessDate = readRowString(data, "effectiveness_date");
  const effectiveDate = firstStoredValue([
    removalDate,
    effectivenessDate && normalizeStoredDate(effectivenessDate) !== normalizeStoredDate(filingDate)
      ? effectivenessDate
      : "",
  ]);
  const displayedDate = effectiveDate || filingDate;

  if (!removedSecurity || !exchange || !removalBasis || !displayedDate) return null;

  const continuedVenue = readRowString(data, "continued_listing_or_trading_venue");
  const tradingSuspensionDate = readRowString(data, "trading_suspension_date");
  const issuerName = readRowString(data, "issuer_name");
  const primaryTicker = readRowString(data, "primary_ticker");
  const reasonText = `${removalReason} ${readRowString(data, "removal_reason_text")}`.toLowerCase();
  const isAmendment = normalizedForm.endsWith("/A");
  const isCommonEquity = /common stock|ordinary shares|american depositary shares|ads\b/i.test(removedSecurity);
  const title = isAmendment
    ? "Listing Status Amendment"
    : /voluntary|withdrawal|going dark/.test(reasonText)
      ? "Voluntary Delisting"
      : /merger|business combination|acquisition/.test(reasonText)
        ? "Merger Completion"
        : /redeemed|paid at maturity|retirement|matured/.test(reasonText)
          ? "Security Removal"
          : isCommonEquity
            ? "Exchange Delisting"
            : "Security Removal";

  return {
    exchange,
    issuerName,
    primaryTicker,
    snapshot: {
      title,
      items: [
        { label: "Removed Security", value: removedSecurity },
        {
          label: "Exchange / Venue",
          value: exchange,
          ...(continuedVenue ? { note: `Continued trading: ${continuedVenue}` } : {}),
        },
        {
          label: "Removal Basis",
          value: removalBasis,
          ...(removalReason && ruleProvision ? { note: ruleProvision } : {}),
        },
        {
          label: effectiveDate ? "Effective / Removal Date" : "Form 25 Filed",
          value: formatForm25Date(displayedDate),
          ...(tradingSuspensionDate
            ? { note: `Trading suspended ${formatForm25Date(tradingSuspensionDate)}` }
            : {}),
        },
      ],
    },
  };
}

function formatForm25RuleProvision(value: string) {
  return value
    .replace(/^17\s+CFR\s+240\./i, "Rule ")
    .replace(/^240\./i, "Rule ")
    .trim();
}

function normalizeStoredDate(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function formatForm25Date(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(parsed));
}

function isOfferingRegistrationForm(formType: string) {
  const normalized = formType.trim().toUpperCase().replace(/\s+/g, "");
  return (
    /^424B\d*$/.test(normalized) ||
    /^(S-1|S-1\/A|F-1|F-1\/A|S-3|S-3\/A|S-3ASR|S-3MEF|F-3|F-3\/A|F-3ASR|F-3MEF)$/.test(
      normalized,
    )
  );
}

function readStoredOfferingRegistration(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  offeringTermsRow: Record<string, unknown> | null,
  formType: string,
): OfferingRegistrationData | null {
  if (!isOfferingRegistrationForm(formType)) return null;

  const offeringTermsMetadata = toRecord(offeringTermsRow?.metadata);
  const displayModel =
    toRecord(offeringTermsMetadata?.offering_display_model) ||
    toRecord(analysisMetadata?.offering_display_model) ||
    toRecord(eventMetadata?.offering_display_model);
  if (!displayModel) return null;

  const displayMode = readRowString(displayModel, "display_mode");
  const snapshotItems = readStoredSnapshotItems(displayModel.snapshot_metrics).slice(0, 4);
  const offeringDetails = readStoredFinancingDetailRows(displayModel.offering_details);
  const instruments = readStoredFinancingInstruments(
    displayModel.instrument_details || displayModel.warrant_details,
  );
  const suppressScale = ["ipo_amendment", "ipo_registration", "spac_ipo"].includes(
    displayMode,
  );
  const scale = suppressScale
    ? undefined
    : readStoredFinancingScale(displayModel.share_overhang, displayMode);

  if (!snapshotItems.length && !offeringDetails.length && !instruments.length && !scale) {
    return null;
  }

  return {
    instruments,
    offeringDetails,
    scale,
    snapshot: {
      items: snapshotItems,
      title: offeringRegistrationSnapshotTitle(displayMode),
    },
  };
}

function offeringRegistrationSnapshotTitle(displayMode: string) {
  if (displayMode === "shelf_capacity") return "Shelf Registration Snapshot";
  if (displayMode === "resale_registration") return "Resale Registration Snapshot";
  if (displayMode === "atm") return "ATM Program Snapshot";
  if (["ipo_amendment", "ipo_registration", "spac_ipo"].includes(displayMode)) {
    return "IPO Snapshot";
  }
  if (["post_effective_amendment", "routine_amendment"].includes(displayMode)) {
    return "Registration Amendment Snapshot";
  }
  return "Offering Snapshot";
}

function readStoredFinancingDilution(
  eventMetadata: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
): FinancingDilutionCapitalStructureData | null {
  const displayPayload =
    toRecord(eventMetadata?.display_payload) ||
    toRecord(analysisMetadata?.display_payload);
  const displayData = toRecord(displayPayload?.data);
  const displayType = readRowString(displayPayload, "display_type");
  const displayVersion = readRowString(displayData, "display_version");
  const capitalMode = readRowString(displayData, "capital_mode");
  const offeringDisplayModel =
    toRecord(analysisMetadata?.offering_display_model) ||
    toRecord(eventMetadata?.offering_display_model) ||
    (displayData && readRowString(displayData, "display_mode") ? displayData : null);

  if (
    displayType !== "capital_financing" &&
    displayVersion !== "sec_8k_6k_capital_financing_v1"
  ) {
    return readStoredOfferingFinancingDilution(offeringDisplayModel);
  }

  const snapshotItems = readStoredSnapshotItems(displayData?.snapshot_metrics).slice(0, 4);
  const offeringDetails = readStoredFinancingDetailRows(displayData?.offering_details);
  const instruments = readStoredFinancingInstruments(displayData?.instrument_details);
  const scale = readStoredFinancingScale(displayData?.share_overhang, capitalMode);

  if (!snapshotItems.length && !offeringDetails.length && !instruments.length && !scale) {
    return null;
  }

  return {
    instruments,
    offeringDetails,
    scale,
    snapshot: {
      items: snapshotItems,
      title: financingSnapshotTitle(capitalMode),
    },
  };
}

function readStoredOfferingFinancingDilution(
  value: Record<string, unknown> | null,
): FinancingDilutionCapitalStructureData | null {
  if (!value) return null;

  const offeringDetails = readStoredFinancingDetailRows(value.offering_details);
  const instruments = readStoredFinancingInstruments(value.warrant_details);
  const termRows = recordArray(value.warrant_details);
  const keyCashTerms = toRecord(value.key_cash_terms);
  const issuerCash = toRecord(keyCashTerms?.issuer_primary_or_closing_cash);
  const termValue = (label: string) => {
    const row = termRows.find((item) => readRowString(item, "label") === label);
    return row ? readRowString(row, "value") : "";
  };
  const detailValue = (label: string) =>
    offeringDetails.find((item) => item.label === label)?.value || "";

  const snapshotItems = [
    { label: "Financing Type", value: detailValue("Offering Type") },
    { label: "Maximum Principal", value: termValue("Shares / Securities") },
    {
      label: "Expected Cash Proceeds",
      value: readRowString(issuerCash, "value_text") || readRowString(issuerCash, "valueText"),
    },
    { label: "Conversion Pricing", value: termValue("Exercise / Conversion Price") },
  ].filter((item) => item.value);

  if (!snapshotItems.length && !offeringDetails.length && !instruments.length) return null;

  return {
    instruments,
    offeringDetails,
    snapshot: {
      items: snapshotItems.slice(0, 4),
      title: "Financing Snapshot",
    },
  };
}

function readStoredFinancingScale(
  value: unknown,
  capitalMode: string,
): FinancingDilutionCapitalStructureData["scale"] {
  const overhang = toRecord(value);
  const basis = toRecord(overhang?.basis);
  const basisLabel = readRowString(basis, "label");
  const basisValue = readRowString(basis, "value");
  const basisNumeric = readOptionalNumber(basis?.numeric_value ?? basis?.numericValue);
  if (!basisLabel || !basisValue || !basisNumeric || basisNumeric <= 0) return undefined;

  const mode =
    ["atm", "atm_capacity", "shelf_capacity"].includes(capitalMode) ||
    readRowString(basis, "unit").toLowerCase() === "usd"
      ? "amount"
      : "shares";
  const segments = recordArray(overhang?.rows)
    .slice(0, 7)
    .map((row) => {
      const rowRole = normalizeFinancingRowRole(readRowString(row, "row_role") || readRowString(row, "rowRole"));
      const supplyType = readRowString(row, "supply_type") || readRowString(row, "supplyType");
      const label = readRowString(row, "label");
      const rowValue = readRowString(row, "value");
      const numericValue = readOptionalNumber(row.numeric_value ?? row.numericValue);
      if (!label || !rowValue || !numericValue || numericValue <= 0) return null;
      if (
        label.trim().toLowerCase() === basisLabel.trim().toLowerCase() &&
        numericValue === basisNumeric
      ) {
        return null;
      }

      return {
        calculationRole: readRowString(row, "calculation_role") || readRowString(row, "calculationRole") || undefined,
        classBasis: readRowString(row, "class_basis") || readRowString(row, "classBasis") || undefined,
        countedInRatio: readOptionalBoolean(row.counted_in_ratio ?? row.countedInRatio),
        label,
        note: readRowString(row, "note") || undefined,
        numericValue,
        poolId: readRowString(row, "pool_id") || readRowString(row, "poolId") || undefined,
        poolRelationship: normalizeFinancingPoolRelationship(
          readRowString(row, "pool_relationship") || readRowString(row, "poolRelationship"),
        ),
        rowRole,
        supplyNature: readRowString(row, "supply_nature") || readRowString(row, "supplyNature") || undefined,
        supplyType: supplyType || undefined,
        tone:
          rowRole === "counted" ||
          (mode === "amount" && ["atm_capacity", "shelf_capacity"].includes(supplyType))
            ? "supply"
            : "conditional",
        unit: readRowString(row, "unit") || undefined,
        value: rowValue,
      } satisfies NonNullable<FinancingDilutionCapitalStructureData["scale"]>["segments"][number];
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));

  const hasIncludedSupply = segments.some((segment) =>
    segment.rowRole === "counted" ||
    (mode === "amount" &&
      ["atm_capacity", "shelf_capacity"].includes(segment.supplyType || "")),
  );
  if (!hasIncludedSupply) return undefined;

  const totalNote = toRecord(overhang?.total_note) || toRecord(overhang?.totalNote);
  const totalTitle = readRowString(totalNote, "title");
  const totalNumerator = readStoredScalar(totalNote?.numerator);
  const totalDenominator = readStoredScalar(totalNote?.denominator);
  const totalRatio = readStoredScalar(totalNote?.ratio);
  const suffix = readRowString(totalNote, "suffix");
  const storedNote = readRowString(overhang, "note");

  return {
    basis: {
      label: basisLabel,
      note: readRowString(basis, "note") || undefined,
      numericValue: basisNumeric,
      value: basisValue,
    },
    caption:
      readRowString(overhang, "caption") ||
      (mode === "amount"
        ? "Program capacity versus market capitalization"
        : "Counted supply versus share basis"),
    headlineLabel:
      readRowString(overhang, "status_label") ||
      readRowString(overhang, "statusLabel") ||
      (mode === "amount" ? "Capacity Scale" : "Potential Dilution"),
    headlineValue:
      readRowString(overhang, "status_value") ||
      readRowString(overhang, "statusValue") ||
      totalRatio,
    mode,
    note:
      storedNote ||
      (mode === "amount"
        ? "ATM capacity measures financing scale; actual dilution depends on future sales and prices."
        : "Only rows marked Counted are included in the headline ratio; conditional supply is shown separately."),
    segments,
    subtitle:
      readRowString(overhang, "subtitle") ||
      (mode === "amount"
        ? "Known dollar capacity compared with a compatible company-value basis."
        : "Fixed common-equivalent supply compared with the disclosed share basis."),
    title: readRowString(overhang, "chart_title") || readRowString(overhang, "chartTitle") || "Share Overhang",
    ...(totalTitle && totalNumerator && totalDenominator && totalRatio
      ? {
          total: {
            denominator: totalDenominator,
            numerator: totalNumerator,
            ratio: totalRatio,
            title: suffix ? `${totalTitle} (${suffix})` : totalTitle,
          },
        }
      : {}),
  };
}

function readStoredFinancingDetailRows(value: unknown) {
  return recordArray(value)
    .slice(0, 6)
    .map((row) => {
      const label = readRowString(row, "label");
      const rowValue = readRowString(row, "value");
      if (!label || !rowValue) return null;
      const note = readRowString(row, "note");
      return { label, value: rowValue, ...(note ? { note } : {}) };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function readStoredFinancingInstruments(value: unknown) {
  const instruments: FinancingDilutionCapitalStructureData["instruments"] = [];
  let current: FinancingDilutionCapitalStructureData["instruments"][number] | null = null;

  for (const row of recordArray(value)) {
    const label = readRowString(row, "label");
    const rowValue = readRowString(row, "value");
    if (!label || !rowValue) continue;
    const note = readRowString(row, "note");
    const normalizedValue = normalizeStoredFinancingInstrumentTerm(label, rowValue);
    const cellValue = note ? `${normalizedValue} (${note})` : normalizedValue;

    if (label === "Type") {
      if (current) instruments.push(current);
      current = { securities: "", type: rowValue };
      continue;
    }
    if (!current) continue;

    if (label === "Shares / Securities") current.securities = cellValue;
    if (label === "Exercise / Conversion Price") current.exerciseOrConversionPrice = cellValue;
    if (label === "Reset / Floor") current.resetOrFloor = cellValue;
    if (label === "Term / Limits") current.termOrLimits = cellValue;
  }

  if (current) instruments.push(current);
  return instruments
    .filter((instrument) => instrument.type)
    .slice(0, 8);
}

function normalizeStoredFinancingInstrumentTerm(label: string, value: string) {
  if (label !== "Reset / Floor") return value;

  return value
    .replace(/\bno floor stated\b/gi, "None")
    .replace(/\bno reset stated\b/gi, "None")
    .replace(/\s*,\s*/g, "; ");
}

function financingSnapshotTitle(capitalMode: string) {
  if (capitalMode === "atm_capacity") return "ATM Program Snapshot";
  if (capitalMode === "capital_structure_action") return "Capital Structure Snapshot";
  if (capitalMode === "capital_return") return "Capital Return Snapshot";
  if (capitalMode === "debt_liquidity") return "Liquidity Snapshot";
  return "Financing Snapshot";
}

function normalizeFinancingRowRole(value: string) {
  return ["alternative", "conditional", "counted", "reference"].includes(value)
    ? (value as "alternative" | "conditional" | "counted" | "reference")
    : undefined;
}

function normalizeFinancingPoolRelationship(value: string) {
  return value === "additive" || value === "alternative_max" ? value : undefined;
}

function readOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(normalized)) return normalized;
  }
  return undefined;
}

function readOptionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readStoredScalar(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("en-US");
  if (typeof value === "string") return value.trim();
  return "";
}

function readStoredSnapshotItems(value: unknown): ListingFinancialRiskSnapshotItem[] {
  const record = toRecord(value);
  const source = Array.isArray(value)
    ? value
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.metrics)
        ? record.metrics
        : Array.isArray(record?.fields)
          ? record.fields
          : [];

  return source
    .map((entry): ListingFinancialRiskSnapshotItem | null => {
      const item = toRecord(entry);
      const label = firstStoredValue([
        readRowString(item, "label"),
        readRowString(item, "name"),
      ]);
      const itemValue = firstStoredValue([
        readRowString(item, "value"),
        readRowString(item, "status"),
      ]);
      if (!label || !itemValue) return null;

      const note = firstStoredValue([
        readRowString(item, "note"),
        readRowString(item, "detail"),
        readRowString(item, "description"),
      ]);

      return {
        label,
        value: itemValue,
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is ListingFinancialRiskSnapshotItem => Boolean(item));
}

function inferStoredSnapshotTitle(items: ListingFinancialRiskSnapshotItem[]) {
  const storedCopy = items
    .flatMap((item) => [item.label, item.value])
    .join(" ")
    .toLowerCase();

  if (/restat|non[- ]?reliance|affected periods?|internal controls?/.test(storedCopy)) {
    return "Restatement Status Snapshot";
  }
  if (/listing|delist|trading status|appeal status|nasdaq|nyse/.test(storedCopy)) {
    return "Listing Status Snapshot";
  }
  if (/bankrupt|chapter 11|liquidity|debt|default|debtor|going concern|winddown|wind-down/.test(storedCopy)) {
    return "Financial Risk Snapshot";
  }

  return "Risk Status Snapshot";
}

function buildListingFinancialRiskSnapshot(
  filing: FilingEvent,
): ListingFinancialRiskSnapshotData | null {
  if (filing.eventType !== "listing_risk" && filing.eventType !== "financial_risk") {
    return null;
  }

  const snapshot = filing.listingFinancialRiskSnapshot;
  if (!snapshot) return null;

  const validItems = snapshot.items.filter(
    (item) => cleanDisclosureValue(item.label) && cleanDisclosureValue(item.value),
  );

  return validItems.length >= 4
    ? {
        items: validItems.slice(0, 4),
        title: snapshot.title,
      }
    : null;
}

function buildGenericFilingAnalysisData(
  filing: FilingEvent,
): GenericFilingAnalysisData {
  return {
    bearishPoints: isGenericFieldAvailable(filing, "bearishPoints")
      ? filing.bearishPoints
      : [],
    bullishPoints: isGenericFieldAvailable(filing, "bullishPoints")
      ? filing.bullishPoints
      : [],
    company: filing.company,
    deliveryLevel: filing.deliveryLevel,
    exchange: filing.exchange,
    filedAt: filing.filedAt,
    filingBrief: isGenericFieldAvailable(filing, "filingBrief")
      ? filing.filingBrief
      : "",
    formType: filing.formType,
    impact: filing.impact,
    keyEvidence: isGenericFieldAvailable(filing, "keyEvidence")
      ? filing.keyEvidence
      : [],
    recentFilings: isGenericFieldAvailable(filing, "recentFilings")
      ? filing.recentFilings
      : [],
    relatedNews: isGenericFieldAvailable(filing, "relatedNews")
      ? filing.relatedNews
      : [],
    score: filing.score,
    scoreRationale: isGenericFieldAvailable(filing, "scoreRationale")
      ? filing.scoreRationale
      : "",
    signal: filing.signal,
    source: filing.source,
    sourceUrl: filing.sourceUrl,
    summary: isGenericFieldAvailable(filing, "summary")
      ? filing.summary
      : "",
    ticker: filing.ticker,
    title: filing.title,
    watchNext: isGenericFieldAvailable(filing, "watchNext")
      ? filing.watchNext
      : [],
    whyItMatters: isGenericFieldAvailable(filing, "whyItMatters")
      ? filing.whyItMatters
      : "",
  };
}

function isGenericFieldAvailable(
  filing: FilingEvent,
  field: keyof GenericFilingAvailability,
) {
  return filing.genericAvailability?.[field] ?? true;
}

function readStoredScoreRationale(
  analysis: Record<string, unknown> | null,
  analysisMetadata: Record<string, unknown> | null,
  eventMetadata: Record<string, unknown> | null,
) {
  const scoreExplanation =
    toRecord(analysis?.scoreExplanation) ||
    toRecord(analysis?.score_explanation) ||
    toRecord(analysisMetadata?.scoreExplanation) ||
    toRecord(analysisMetadata?.score_explanation);

  return (
    readRowString(scoreExplanation, "summary") ||
    readRowString(analysis, "scoreReason") ||
    readRowString(analysis, "score_reason") ||
    readRowString(analysisMetadata, "scoreReason") ||
    readRowString(analysisMetadata, "score_reason") ||
    readRowString(eventMetadata, "scoreReason") ||
    readRowString(eventMetadata, "score_reason")
  );
}

function toGenericBadgeTone(tone: EventTypeBadgeTone): BadgeTone {
  if (tone === "earnings") return "earnings";
  if (tone === "risk" || tone === "dilution") return "legal";
  if (tone === "deal") return "transaction";
  if (tone === "clinical" || tone === "market") return "product";
  if (tone === "regulatory") return "insider";
  return "neutral";
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

function DilutionOfferingTemplate({
  eventLabel,
  filing,
  model,
}: {
  eventLabel: string;
  filing: FilingEvent;
  model: ReturnType<typeof buildDilutionOfferingModel>;
}) {

  if (model.isShelfOnly || model.isCommonWarrantOnly) {
    return <CommonFilingTemplate eventLabel={eventLabel} filing={filing} />;
  }

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
  includeMetadataTable = true,
  includeTemplateStatus = false,
}: {
  filing: FilingEvent;
  eventLabel: string;
  includeMetadataTable?: boolean;
  includeTemplateStatus?: boolean;
}) {
  const embeddedHtml = isolateOriginalFilingMarkup(filing.originalHtml, filing.sourceUrl);

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
        dangerouslySetInnerHTML={{ __html: embeddedHtml }}
      />
      {includeMetadataTable ? (
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
      ) : null}
    </section>
  );
}

function isolateOriginalFilingMarkup(value: string, sourceUrl?: string) {
  const textBlock = value.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/i)?.[1] || value;

  const isolatedMarkup = removeOriginalFilingImageOcr(textBlock)
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(?:script|style|title)\b[^>]*>[\s\S]*?<\/(?:script|style|title)\s*>/gi, "")
    .replace(/<(?:base|link|meta)\b[^>]*\/?\s*>/gi, "")
    .replace(/<\/?(?:body|head|html)\b[^>]*>/gi, "")
    .replace(/<a\b(?=[^>]*\bhref\s*=\s*["']#TOC["'])[^>]*>\s*TABLE OF CONTENTS\s*<\/a>/gi, "")
    .replace(/\s+(?:color|bgcolor)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*(["'])([\s\S]*?)\1/gi, (_match, quote, style) => {
      const cleanedStyle = stripOriginalFilingColors(style).trim();
      return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : "";
    });

  return resolveOriginalFilingUrls(isolatedMarkup, sourceUrl);
}

function removeOriginalFilingImageOcr(value: string) {
  return value.replace(
    /(<div\b[^>]*>\s*<img\b[^>]*>\s*<\/div>)\s*<div\b(?=[^>]*\bstyle\s*=\s*["'][^"']*\bline-height\s*:\s*(?:[0-3](?:\.\d+)?)pt\b[^"']*["'])[^>]*>\s*(?:<font\b[^>]*>[\s\S]*?<\/font>\s*)+<\/div>/gi,
    "$1",
  );
}

function resolveOriginalFilingUrls(value: string, sourceUrl?: string) {
  if (!sourceUrl) return value;

  return value.replace(
    /\s+(src|href)\s*=\s*(["'])([^"']*)\2/gi,
    (attributeMarkup, attribute: string, _quote: string, rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url || url.startsWith("#") || /^(?:data:|javascript:|mailto:|tel:)/i.test(url)) {
        return attributeMarkup;
      }

      try {
        const resolvedUrl = new URL(url, sourceUrl).toString();
        return ` ${attribute.toLowerCase()}="${escapeOriginalFilingAttribute(resolvedUrl)}"`;
      } catch {
        return attributeMarkup;
      }
    },
  );
}

function escapeOriginalFilingAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function stripOriginalFilingColors(value: string) {
  return value.replace(
    /(^|[;{]\s*)(?:color|background(?:-color)?)\s*:\s*[^;}]+;?/gim,
    "$1",
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
  const s3Case = cleanDisclosureValue(filing.s3Case || "");
  const displayMode = readRowString(llmDisplayModel, "display_mode");
  const sourceText = stripHtml(`${filing.title} ${filing.filingBrief} ${filing.summary} ${filing.originalHtml}`);
  const dbOfferingType = formatOfferingEnumLabel(readRowString(offeringTerms, "offering_type"));
  const dbSecurityType = formatOfferingEnumLabel(readRowString(offeringTerms, "security_type"));
  const dbPrimaryOrResale = formatPrimaryResaleLabel(readRowString(offeringTerms, "primary_or_resale"));
  const rawOfferingType = readRowString(offeringTermsMetadata, "raw_offering_type");
  const offeringMethod = readRowString(offeringTermsMetadata, "offering_method");
  const classificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${sourceText}`;
  const structuredClassificationText = `${dbOfferingType} ${dbSecurityType} ${dbPrimaryOrResale} ${rawOfferingType} ${offeringMethod} ${filing.title} ${filing.filingBrief}`;
  const isAtm = dbOfferingType === "ATM" || /\b(?:atm|at-the-market|at the market)\b/i.test(sourceText);
  const hasActionableAtmMechanism = isActionableAtmMechanism({
    dbOfferingType,
    displayMode,
    offeringTerms,
    sourceText,
  });
  const isShelf = /\b(?:shelf|s-3|s-3asr|registration statement)\b/i.test(classificationText);
  const isForwardSale =
    /\bforward (?:sale|basis|purchase|transaction|contract|agreement)|physical settlement\b/i.test(structuredClassificationText) ||
    /\bforward (?:sale|purchase) agreement\b/i.test(sourceText);
  const hasSellingHolderResale = /\b(?:resale|selling stockholders?|selling shareholders?)\b/i.test(classificationText);
  const isResale =
    dbPrimaryOrResale === "Resale" ||
    /\bresale\b/i.test(dbPrimaryOrResale) ||
    dbOfferingType === "Resale registration" ||
    /\bresale\b/i.test(dbOfferingType) ||
    hasSellingHolderResale;
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
  const prefundedWarrantExerciseCash = readDisplayCashTermValue(llmDisplayModel, "prefunded_warrant_exercise_cash");
  const warrantCashExerciseProceeds =
    readDisplayCashTermValue(llmDisplayModel, "common_warrant_cash_exercise_proceeds") ||
    readDisplayCashTermValue(llmDisplayModel, "conditional_warrant_cash") ||
    findWarrantCashExerciseProceeds(sourceText);
  const firstNotePrincipal = findNotePrincipal(sourceText, "First");
  const secondNotePrincipal = findNotePrincipal(sourceText, "Second");
  const pipePrincipalValue = formatMoneyTotal([firstNotePrincipal, secondNotePrincipal]) || "Not disclosed";
  const firstClosingNetProceeds = findClosingNetProceeds(sourceText, "First");
  const secondClosingNetProceeds = findClosingNetProceeds(sourceText, "Second");
  const issuerPrimaryOrClosingCash = cleanCompanyCashDisclosure(readDisplayCashTermValue(llmDisplayModel, "issuer_primary_or_closing_cash"));
  const closingNetProceedsValue =
    issuerPrimaryOrClosingCash ||
    formatMoneyTotal([firstClosingNetProceeds, secondClosingNetProceeds], "~") ||
    "Not disclosed";
  const additionalNotesAmount = findAdditionalNotesAmount(sourceText);
  const additionalWarrantShares = findAdditionalWarrantShares(sourceText);
  const effectiveDate = findDateSentence(sourceText, /\beffective\b/i);
  const closingDate = findDateSentence(sourceText, /\bclosing\b|\bclose\b/i);
  const isShelfOnly =
    !hasActionableAtmMechanism &&
    !isResale &&
    !isForwardSale &&
    !isRegisteredDirect &&
    !isPrivatePlacement &&
    !hasPrefundedWarrants &&
    !isConvertibleFinancing &&
    (displayMode === "shelf_capacity" ||
      s3Case === "base_shelf" ||
      s3Case === "automatic_shelf" ||
      (isShelfLike && /\b(?:base shelf|universal shelf|automatic shelf|shelf registration|from time to time)\b/i.test(classificationText)));
  const hasActionableDilutionMechanism = Boolean(
    hasActionableAtmMechanism ||
      isResale ||
      isForwardSale ||
      isRegisteredDirect ||
      hasPrefundedWarrants ||
      isConvertibleFinancing
  );
  const isCommonWarrantOnly =
    hasWarrants &&
    !hasActionableDilutionMechanism &&
    (dbSecurityType === "Warrants" ||
      dbOfferingType === "Warrant exercise" ||
      /\b(?:warrant indenture|warrant agreement|warrant amendment|warrant expiration|warrants? expire|warrant redemption|warrant holder)\b/i.test(
        classificationText
      ));
  const llmTotalSupplyValue = readDisplayFactValue(llmDisplayModel, "total_potential_supply");
  const shelfCapacityValue =
    normalizePositiveShelfMoney(readDbMoneyValue(offeringTerms, "shelf_capacity", "shelf_capacity_text")) ||
    normalizePositiveShelfMoney(isMoneyDisclosure(llmTotalSupplyValue) ? llmTotalSupplyValue : "") ||
    normalizePositiveShelfMoney(offeringAmount) ||
    normalizePositiveShelfMoney(findShelfCapacity(sourceText)) ||
    "Not disclosed";
  const shelfRegisteredSharesValue =
    (isShareDisclosure(llmTotalSupplyValue) ? formatShareCountValue(llmTotalSupplyValue) || llmTotalSupplyValue : "") ||
    (isShareDisclosure(sharesOffered) ? formatShareCountValue(sharesOffered) || sharesOffered : "") ||
    "Not disclosed";
  const shelfStatus =
    s3Case === "automatic_shelf" || /\bautomatic shelf|Rule 462\(e\)|effective upon filing\b/i.test(sourceText)
      ? "Automatic shelf"
      : /\bnot complete|may not be sold until|not be sold until|preliminary prospectus|subject to completion\b/i.test(sourceText)
        ? "Filed; effectiveness pending"
        : "Filed shelf";
  const shelfSecuritiesCovered =
    securityType && securityType !== "Not disclosed"
      ? securityType
      : findShelfSecuritiesCovered(sourceText) || "Registered securities";
  const shelfDisplayMode = s3Case === "automatic_shelf" ? "Automatic shelf capacity" : "Base shelf capacity";
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
    summaryNarrative: readRowString(llmDisplayModel, "narrative_summary"),
  });
  const shelfCurrentStateRows = [
    `Capacity: ${shelfCapacityValue}.`,
    `Securities covered: ${shelfSecuritiesCovered}.`,
    isDisclosedValue(shelfRegisteredSharesValue)
      ? `Registered shares: ${shelfRegisteredSharesValue}.`
      : "Registered share count is not disclosed, so share overhang is not calculated.",
    "No current offering price, closing date, or issued share count is established by the shelf alone.",
  ];
  const shelfWatchRows = [
    "Prospectus supplement with pricing, shares, underwriters, or sales agent.",
    "ATM sale updates or takedown filings that convert shelf capacity into actual issuance.",
    "Updated shares outstanding after any sale, conversion, or warrant exercise.",
  ];
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
  const companyProceeds = buildCompanyProceedsValue({
    closingNetProceedsValue,
    isResale,
    noIssuerProceeds,
    offeringAmount,
  });
  const companyProceedsNote = buildCompanyProceedsNote({
    closingNetProceedsValue,
    isResale,
    noIssuerProceeds,
    offeringAmount,
    prefundedWarrantExerciseCash,
    warrantCashExerciseProceeds,
  });
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
        buildDilutionFollowUpParagraph(nextTrigger),
      ]
        .filter(isDisclosedValue)
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
    isShelfOnly,
    isCommonWarrantOnly,
    shelfCapacityValue,
    shelfCapacityNote,
    shelfCompanyProceeds,
    shelfCompanyProceedsNote,
    shelfCurrentStateRows,
    shelfDisplayMode,
    shelfIntro,
    shelfRegisteredSharesValue,
    shelfSecuritiesCovered,
    shelfShareNote,
    shelfStatus,
    shelfSummaryParagraphs,
    shelfWatchRows,
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
  if (displayMode === "atm_capacity") return true;
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
  isResale,
  noIssuerProceeds,
  offeringAmount,
}: {
  closingNetProceedsValue: string;
  isResale: boolean;
  noIssuerProceeds: boolean;
  offeringAmount: string;
}) {
  if (isResale && noIssuerProceeds) return "$0 from resale";
  if (isDisclosedValue(closingNetProceedsValue)) return closingNetProceedsValue;
  return cleanCompanyCashDisclosure(offeringAmount) || "Not disclosed";
}

function buildCompanyProceedsNote({
  closingNetProceedsValue,
  isResale,
  noIssuerProceeds,
  offeringAmount,
  prefundedWarrantExerciseCash,
  warrantCashExerciseProceeds,
}: {
  closingNetProceedsValue: string;
  isResale: boolean;
  noIssuerProceeds: boolean;
  offeringAmount: string;
  prefundedWarrantExerciseCash: string;
  warrantCashExerciseProceeds: string;
}) {
  const parts: string[] = [];
  if (isResale && noIssuerProceeds) parts.push("Selling-holder resales send $0 to the company.");
  if (!(isResale && noIssuerProceeds) && isDisclosedValue(closingNetProceedsValue)) {
    parts.push("Company cash from disclosed primary or placement terms.");
  }
  if (isDisclosedValue(prefundedWarrantExerciseCash)) {
    parts.push(`Pre-funded exercise cash is nominal: ${prefundedWarrantExerciseCash}.`);
  }
  if (isDisclosedValue(warrantCashExerciseProceeds)) {
    parts.push(`Common warrant cash only if exercised: ${warrantCashExerciseProceeds}.`);
  }
  if (!parts.length && cleanCompanyCashDisclosure(offeringAmount)) {
    parts.push("Gross proceeds from disclosed primary offering terms.");
  }
  return parts.join(" ") || "Company proceeds were not clearly disclosed.";
}

function findMoneyAmount(sourceText: string) {
  return (
    sourceText.match(/\b(?:up to|maximum aggregate(?: offering)? price of|aggregate(?: offering)? price of|gross proceeds of|net proceeds of|offering amount of)\s+(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    sourceText.match(/\b(?:gross|net)\s+proceeds\s+(?:were|are|will be|of)?\s*(?:approximately)?\s*(\$[\d,.]+\s*(?:million|billion|m|bn)?)/i)?.[1] ||
    ""
  );
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

function mapRecentFilingRows(rows: Record<string, unknown>[], currentId: string): RecentFiling[] {
  return rows
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
}

function mapRelatedNewsRows(rows: Record<string, unknown>[]): RelatedStory[] {
  return rows.slice(0, 4).map((row) => ({
    age: formatShortDate(readRowString(row, "detected_at") || readRowString(row, "published_at")),
    eventId: readRowString(row, "id") || undefined,
    eventType: readRowString(row, "event_type") || undefined,
    source: formatSourceLabel(readRowString(row, "source_code")),
    sourceUrl: firstHttpUrl([
      readRowString(row, "source_url"),
      readMetadataString(row, "source_url"),
      readMetadataString(row, "url"),
    ]) || undefined,
    title: readRowString(row, "title") || "Related news",
  }));
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

function firstStoredValue(values: Array<string | null | undefined>) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function cleanStoredAnalysisText(value: string | null | undefined) {
  const cleaned = cleanDisclosureValue(value);
  return /^(?:no (?:summary|quick take) available yet|untitled event)$/i.test(cleaned)
    ? ""
    : cleaned;
}

function cleanSourceIdentity(value: string | null | undefined) {
  const cleaned = cleanDisclosureValue(value);
  return /^(?:unknown|n\/a|na)$/i.test(cleaned) ? "" : cleaned;
}

function formatGenericFilingSource(value: string | null | undefined) {
  const source = cleanSourceIdentity(value);
  return /^sec$/i.test(source) ? "SEC EDGAR" : source;
}

function firstOriginalFilingUrl(values: Array<string | null | undefined>) {
  for (const value of values) {
    const candidate = String(value || "").trim();
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (
        /(^|\.)sec\.gov$/i.test(url.hostname) &&
        /^\/edgar\/search\/?$/i.test(url.pathname)
      ) {
        continue;
      }
      return candidate;
    } catch {
      continue;
    }
  }

  return "";
}

function firstHttpUrl(values: Array<string | null | undefined>) {
  for (const value of values) {
    const candidate = String(value || "").trim();
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return candidate;
    } catch {
      continue;
    }
  }

  return "";
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

  return labels[normalized] || value;
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
    "5Y": {
      labels: ["2021", "2021", "2022", "2022", "2023", "2023", "2024", "2024", "2025", "2025", "2026", "2026"],
      spread: 60,
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
