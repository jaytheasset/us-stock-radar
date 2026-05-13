export type FeedTone = "bullish" | "bearish" | "volatile" | "neutral";
export type SourceGroup = "news" | "filings" | "market";

export type FeedItem = {
  id: string;
  time: string;
  ticker: string;
  price: string;
  change: string;
  sourceGroup: SourceGroup;
  source: string;
  eventType: string;
  title: string;
  summary: string;
  scoreReason: string;
  score: number;
  deliveryLevel: "archive" | "feed" | "alert";
  impact: "high" | "medium" | "low";
  signal: FeedTone;
  trend: number[];
};

export const feedItems: FeedItem[] = [
  {
    id: "nvda-data-center-platform",
    time: "11:05 AM",
    ticker: "NVDA",
    price: "$125.47",
    change: "+1.86%",
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
    change: "-1.13%",
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
    change: "+6.28%",
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
    change: "-3.08%",
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
    change: "+0.72%",
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
    change: "+2.67%",
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
  },
  {
    id: "amc-atm-prospectus",
    time: "8:16 AM",
    ticker: "AMC",
    price: "$2.73",
    change: "-4.21%",
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

export const highScoreNews = [
  { ticker: "PLTR", title: "Expanded commercial AI agreement", source: "PR Newswire", score: 82, signal: "bullish" as const, time: "9:22 AM" },
  { ticker: "NVDA", title: "Data center platform availability", source: "Business Wire", score: 78, signal: "bullish" as const, time: "11:05 AM" },
  { ticker: "LAC", title: "Thacker Pass construction update", source: "Accesswire", score: 74, signal: "bullish" as const, time: "10:21 AM" },
];

export const highScoreFilings = [
  { ticker: "AMC", title: "Prospectus supplement for ATM program", source: "SEC", score: 79, signal: "bearish" as const, time: "8:16 AM" },
  { ticker: "TSLA", title: "8-K operational update", source: "SEC", score: 68, signal: "neutral" as const, time: "10:42 AM" },
  { ticker: "MSTR", title: "10-Q quarterly report filed", source: "SEC", score: 58, signal: "neutral" as const, time: "9:58 AM" },
];

export const marketMovingNews = [
  { label: "Macro", title: "Treasury yields hold near session highs before Fed speakers", score: 84, signal: "volatile" as const },
  { label: "Policy", title: "New export-control headlines pressure semiconductor watchlist", score: 81, signal: "bearish" as const },
  { label: "Energy", title: "Crude oil rebounds after inventory drawdown surprise", score: 76, signal: "bullish" as const },
];

export const marketPulse = [
  { label: "SPY", value: "+0.42%", detail: "Large caps", tone: "bullish" as const },
  { label: "QQQ", value: "+0.68%", detail: "Growth", tone: "bullish" as const },
  { label: "IWM", value: "-0.11%", detail: "Small caps", tone: "bearish" as const },
  { label: "VIX", value: "18.4", detail: "Volatility", tone: "neutral" as const },
  { label: "10Y", value: "4.31%", detail: "Treasury", tone: "volatile" as const },
  { label: "DXY", value: "104.2", detail: "Dollar", tone: "neutral" as const },
];

export function getFeedItem(id: string) {
  return feedItems.find((item) => item.id === id);
}
