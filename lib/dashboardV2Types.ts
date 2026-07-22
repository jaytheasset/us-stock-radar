import type { BadgeTone } from "@/components/ui/Badge";

export const dashboardV2Tabs = ["Top Gainers", "Top Losers", "Top Volume"] as const;
export const dashboardV2Sessions = ["Pre", "Regular", "After"] as const;

export type DashboardV2Tab = (typeof dashboardV2Tabs)[number];
export type DashboardV2Session = (typeof dashboardV2Sessions)[number];
export type DashboardV2Impact = "high" | "medium" | "low";

export type DashboardV2Event = {
  code: string;
  id: string;
  impact: DashboardV2Impact;
  label: string;
  timestamp: string;
  title: string;
  tone: BadgeTone;
};

export type DashboardV2MarketMover = {
  changePercent: string;
  company: string;
  events: DashboardV2Event[];
  logoUrl?: string;
  marketCap: string;
  maxImpact?: DashboardV2Impact;
  price: string;
  rank: number;
  ticker: string;
  volume: string;
};

export type DashboardV2TickerDetail = {
  badges: DashboardV2Event[];
  changeAmount: string;
  changePercent: string;
  company: string;
  logoUrl?: string;
  price: string;
  recentEvents: DashboardV2Event[];
  ticker: string;
};

export function getDashboardV2TickerDetail(row: DashboardV2MarketMover): DashboardV2TickerDetail {
  return {
    badges: row.events.slice(0, 3),
    changeAmount: calculateChangeAmount(row.price, row.changePercent),
    changePercent: row.changePercent,
    company: row.company,
    logoUrl: row.logoUrl,
    price: row.price,
    recentEvents: row.events.slice(0, 4),
    ticker: row.ticker,
  };
}

function calculateChangeAmount(price: string, changePercent: string) {
  const currentPrice = parseFormattedNumber(price);
  const percent = parseFormattedNumber(changePercent);
  if (currentPrice === null || percent === null || percent <= -100) return "—";

  const previousPrice = currentPrice / (1 + percent / 100);
  const change = currentPrice - previousPrice;
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  return `${sign}${Math.abs(change).toFixed(2)}`;
}

function parseFormattedNumber(value: string) {
  const parsed = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
