export type DashboardV2FilterKey =
  | "marketCap"
  | "price"
  | "volume"
  | "eventType"
  | "signal"
  | "impact";

export type DashboardV2FilterState = Record<DashboardV2FilterKey, string>;

export type DashboardV2FilterSection = {
  key: DashboardV2FilterKey;
  title: string;
  options: string[];
};

export const dashboardV2AllFilterValue = "All";

export const dashboardV2DefaultFilterState: DashboardV2FilterState = {
  marketCap: dashboardV2AllFilterValue,
  price: dashboardV2AllFilterValue,
  volume: dashboardV2AllFilterValue,
  eventType: dashboardV2AllFilterValue,
  signal: dashboardV2AllFilterValue,
  impact: dashboardV2AllFilterValue,
};

export const dashboardV2FilterLabels: Record<DashboardV2FilterKey, string> = {
  marketCap: "Market Cap",
  price: "Price",
  volume: "Volume",
  eventType: "Event Type",
  signal: "Signal",
  impact: "Impact",
};

export const dashboardV2MobileFilterLabels: Record<DashboardV2FilterKey, string> = {
  ...dashboardV2FilterLabels,
  marketCap: "Mkt Cap",
  eventType: "Event",
};

export const dashboardV2QuickFilterKeys = ["marketCap", "price", "eventType"] as const;

export const dashboardV2FilterSections: DashboardV2FilterSection[] = [
  {
    key: "volume",
    title: "Volume",
    options: ["All", "1M+", "5M+", "10M+", "50M+"],
  },
  {
    key: "signal",
    title: "Signal",
    options: ["All", "Bullish", "Bearish", "Neutral", "Volatile"],
  },
  {
    key: "impact",
    title: "Impact",
    options: ["All", "Low", "Medium", "High", "Major"],
  },
  {
    key: "eventType",
    title: "Event Type",
    options: ["All", "Earnings", "M&A", "Insider", "Legal", "Dilution", "FDA", "Listing"],
  },
  {
    key: "marketCap",
    title: "Market Cap",
    options: ["All", "Micro", "Small", "Mid", "Large", "Mega"],
  },
  {
    key: "price",
    title: "Price",
    options: ["All", "Under $1", "$1-$5", "$5-$20", "$20+"],
  },
];

export function getDashboardV2FilterChipLabel(key: DashboardV2FilterKey, value: string) {
  return `${dashboardV2MobileFilterLabels[key]}: ${value}`;
}
