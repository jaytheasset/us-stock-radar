import { isSameMarketDate } from "@/lib/marketDate";

export type FilingsV2EventType =
  | "earnings"
  | "insider"
  | "offering"
  | "dilution"
  | "listing"
  | "legal"
  | "ma"
  | "governance"
  | "fda"
  | "operating"
  | "capital_return";

export type FilingsV2ImpactFilter = "Alerts 75+" | "50-74";
export type FilingsV2Signal = "bullish" | "bearish" | "neutral" | "volatile";
export type FilingsV2DateRange = "24 Hours" | "7 Days" | "30 Days";
export type FilingsV2MarketCap = "Mega" | "Large" | "Mid" | "Small" | "Micro";

export type FilingsV2RelatedFiling = {
  filedDate?: string;
  formType: string;
  id: string;
  source: "SEC";
  title: string;
};

export type FilingsV2Record = {
  accession: string;
  changePercent?: number;
  chartPoints?: readonly number[];
  company: string;
  events: readonly FilingsV2EventType[];
  filedAt: string;
  filedDate: string;
  filedDateTime: string;
  filedTime: string;
  formType: string;
  id: string;
  impact: number;
  keyPoints: readonly string[];
  keyPointsLabel:
    | "Capital Snapshot"
    | "Key Business Updates"
    | "Key Changes"
    | "Key Points";
  marketCap?: FilingsV2MarketCap;
  price?: number;
  relatedFilings: readonly FilingsV2RelatedFiling[];
  signal: FilingsV2Signal;
  source: "SEC";
  showKeyPoints: boolean;
  summary: string;
  ticker?: string;
  title: string;
  watchlist?: boolean;
};

export type FilingsV2Cursor = {
  id: string;
  publishedAt: string;
};

export type FilingsV2SummaryMetrics = {
  alerts: number;
  earnings: number;
  filedToday: number;
  insider: number;
  listing: number;
  offering: number;
};

export type FilingsV2PageResponse = {
  hasMore: boolean;
  nextCursor: FilingsV2Cursor | null;
  records: FilingsV2Record[];
  state: "ready" | "unavailable";
  totalCount: number | null;
};

export type FilingsV2FilterGroup =
  | "signals"
  | "marketCaps"
  | "formTypes"
  | "eventTypes"
  | "impacts"
  | "dateRanges";

export type FilingsV2FilterState = {
  signals: FilingsV2Signal[];
  marketCaps: FilingsV2MarketCap[];
  formTypes: string[];
  eventTypes: FilingsV2EventType[];
  impacts: FilingsV2ImpactFilter[];
  dateRanges: FilingsV2DateRange[];
};

export function isFilingsV2Today(filedAt: string, referenceDate: string) {
  return isSameMarketDate(filedAt, referenceDate);
}

export const filingsV2DefaultFilters: FilingsV2FilterState = {
  signals: [],
  marketCaps: [],
  formTypes: [],
  eventTypes: [],
  impacts: [],
  dateRanges: [],
};

export const filingsV2EventOptions = [
  "earnings",
  "insider",
  "offering",
  "dilution",
  "listing",
  "legal",
  "ma",
  "governance",
  "fda",
  "operating",
  "capital_return",
] as const;

export const filingsV2HighImpactMinimum = 75;
export const filingsV2ImpactOptions = ["Alerts 75+", "50-74"] as const;
export const filingsV2SignalOptions = ["bullish", "bearish", "neutral", "volatile"] as const;
export const filingsV2DateOptions = ["24 Hours", "7 Days", "30 Days"] as const;
export const filingsV2MarketCapOptions = ["Mega", "Large", "Mid", "Small", "Micro"] as const;

export function matchesFilingsV2ImpactFilter(
  score: number,
  filter: FilingsV2ImpactFilter,
) {
  if (filter === "Alerts 75+") return score >= filingsV2HighImpactMinimum;
  return score >= 50 && score <= 74;
}

export const filingsV2EventLabels: Record<FilingsV2EventType, string> = {
  capital_return: "Capital Return",
  dilution: "Dilution",
  earnings: "Earnings",
  fda: "FDA / Clinical",
  governance: "Governance",
  insider: "Insider",
  legal: "Legal",
  listing: "Listing",
  ma: "M&A",
  offering: "Offering",
  operating: "Operating Update",
};

export const filingsV2SignalLabels: Record<FilingsV2Signal, string> = {
  bearish: "Bearish",
  bullish: "Bullish",
  neutral: "Neutral",
  volatile: "Volatile",
};
