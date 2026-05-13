export type RankedEventSignal = "bullish" | "bearish" | "volatile" | "neutral";

export type RankedEvent = {
  ticker: string;
  price: string;
  changeAmount: string;
  change: string;
  updatedAt: string;
  title: string;
  source: string;
  sourceGroup: "news" | "filings";
  eventType: string;
  score: number;
  signal: RankedEventSignal;
  time: string;
};

export const highImpactNewsRankings: RankedEvent[] = [
  {
    ticker: "PLTR",
    price: "$21.84",
    changeAmount: "$0.57",
    change: "+2.67%",
    updatedAt: "9:22 AM EDT",
    title: "Expanded commercial AI agreement",
    source: "PR Newswire",
    sourceGroup: "news",
    eventType: "contract_award",
    score: 82,
    signal: "bullish",
    time: "9:22 AM",
  },
  {
    ticker: "NVDA",
    price: "$125.47",
    changeAmount: "$2.29",
    change: "+1.86%",
    updatedAt: "11:05 AM EDT",
    title: "Data center platform availability",
    source: "Business Wire",
    sourceGroup: "news",
    eventType: "product_launch",
    score: 78,
    signal: "bullish",
    time: "11:05 AM",
  },
  {
    ticker: "LAC",
    price: "$3.82",
    changeAmount: "$0.23",
    change: "+6.28%",
    updatedAt: "10:21 AM EDT",
    title: "Thacker Pass construction update",
    source: "Accesswire",
    sourceGroup: "news",
    eventType: "project_update",
    score: 74,
    signal: "bullish",
    time: "10:21 AM",
  },
];

export const alertFilingRankings: RankedEvent[] = [
  {
    ticker: "AMC",
    price: "$2.73",
    changeAmount: "$0.12",
    change: "-4.21%",
    updatedAt: "8:16 AM EDT",
    title: "Prospectus supplement for ATM program",
    source: "SEC",
    sourceGroup: "filings",
    eventType: "prospectus_supplement",
    score: 79,
    signal: "bearish",
    time: "8:16 AM",
  },
  {
    ticker: "TSLA",
    price: "$176.35",
    changeAmount: "$2.02",
    change: "-1.13%",
    updatedAt: "10:42 AM EDT",
    title: "8-K operational update",
    source: "SEC",
    sourceGroup: "filings",
    eventType: "current_report",
    score: 68,
    signal: "neutral",
    time: "10:42 AM",
  },
  {
    ticker: "MSTR",
    price: "$362.18",
    changeAmount: "$11.52",
    change: "-3.08%",
    updatedAt: "9:58 AM EDT",
    title: "10-Q quarterly report filed",
    source: "SEC",
    sourceGroup: "filings",
    eventType: "quarterly_report",
    score: 58,
    signal: "neutral",
    time: "9:58 AM",
  },
];
