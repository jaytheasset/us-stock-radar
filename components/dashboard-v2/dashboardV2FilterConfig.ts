import type {
  DashboardV2Impact,
  DashboardV2MarketMover,
  DashboardV2Signal,
} from "@/lib/dashboardV2Types";
import { marketCapRangeLabels, matchesMarketCapBand } from "../../lib/marketCapBands.ts";

export type DashboardV2FilterKey =
  | "marketCap"
  | "price"
  | "volume"
  | "eventType"
  | "signal"
  | "impact";

export type DashboardV2FilterState = Record<DashboardV2FilterKey, string>;

export type DashboardV2FilterSection = {
  available: boolean;
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

export const dashboardV2DesktopFilterKeys = [
  "marketCap",
  "price",
  "volume",
  "eventType",
  "signal",
] as const;

export const dashboardV2QuickFilterKeys = ["marketCap", "price", "eventType"] as const;

const staticOptions: Record<"marketCap" | "price" | "volume", string[]> = {
  marketCap: ["All", "Micro", "Small", "Mid", "Large", "Mega"],
  price: ["All", "Under $1", "$1-$5", "$5-$20", "$20+"],
  volume: ["All", "1M+", "5M+", "10M+", "50M+"],
};

const signalOrder: DashboardV2Signal[] = ["bullish", "bearish", "neutral", "volatile"];
const impactOrder: DashboardV2Impact[] = ["low", "medium", "high"];

export function getDashboardV2FilterSections(
  rows: DashboardV2MarketMover[],
): DashboardV2FilterSection[] {
  const eventTypes = uniqueSorted(
    rows.flatMap((row) => row.events.map((event) => event.label).filter(Boolean)),
  );
  const signals = signalOrder
    .filter((signal) => rows.some((row) => row.events.some((event) => event.signal === signal)))
    .map(capitalize);
  const impacts = impactOrder
    .filter((impact) => rows.some((row) => row.events.some((event) => event.impact === impact)))
    .map(capitalize);

  return [
    section("volume", staticOptions.volume, rows.some((row) => row.volumeValue !== undefined)),
    section("signal", ["All", ...signals], signals.length > 0),
    section("impact", ["All", ...impacts], impacts.length > 0),
    section("eventType", ["All", ...eventTypes], eventTypes.length > 0),
    section("marketCap", staticOptions.marketCap, rows.some((row) => row.marketCapValue !== undefined)),
    section("price", staticOptions.price, rows.some((row) => Number.isFinite(row.priceValue))),
  ];
}

export function sanitizeDashboardV2FilterState(
  state: DashboardV2FilterState,
  sections: DashboardV2FilterSection[],
): DashboardV2FilterState {
  const next = { ...state };

  for (const section of sections) {
    if (!section.available || !section.options.includes(next[section.key])) {
      next[section.key] = dashboardV2AllFilterValue;
    }
  }

  return next;
}

export function filterDashboardV2Rows(
  rows: DashboardV2MarketMover[],
  state: DashboardV2FilterState,
) {
  return rows.filter((row) => {
    if (!matchesMarketCap(row.marketCapValue, state.marketCap)) return false;
    if (!matchesPrice(row.priceValue, state.price)) return false;
    if (!matchesMinimum(row.volumeValue, state.volume)) return false;
    if (
      state.eventType !== dashboardV2AllFilterValue &&
      !row.events.some((event) => event.label === state.eventType)
    ) {
      return false;
    }
    if (
      state.signal !== dashboardV2AllFilterValue &&
      !row.events.some((event) => event.signal === state.signal.toLowerCase())
    ) {
      return false;
    }
    if (
      state.impact !== dashboardV2AllFilterValue &&
      !row.events.some((event) => event.impact === state.impact.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

export function hasDashboardV2ActiveFilters(state: DashboardV2FilterState) {
  return (Object.keys(state) as DashboardV2FilterKey[]).some(
    (key) => state[key] !== dashboardV2AllFilterValue,
  );
}

export function getDashboardV2FilterChipLabel(key: DashboardV2FilterKey, value: string) {
  return `${dashboardV2MobileFilterLabels[key]}: ${value}`;
}

export function getDashboardV2FilterOptionLabel(key: DashboardV2FilterKey, value: string) {
  if (key !== "marketCap" || value === dashboardV2AllFilterValue) return value;
  const range = marketCapRangeLabels[value as keyof typeof marketCapRangeLabels];
  return range ? `${value} (${range})` : value;
}

function section(
  key: DashboardV2FilterKey,
  options: string[],
  available: boolean,
): DashboardV2FilterSection {
  return { available, key, options, title: dashboardV2FilterLabels[key] };
}

function matchesMarketCap(value: number | undefined, filter: string) {
  if (filter === dashboardV2AllFilterValue) return true;
  return matchesMarketCapBand(value, filter);
}

function matchesPrice(value: number, filter: string) {
  if (filter === dashboardV2AllFilterValue) return true;
  if (!Number.isFinite(value)) return false;
  if (filter === "Under $1") return value < 1;
  if (filter === "$1-$5") return value >= 1 && value < 5;
  if (filter === "$5-$20") return value >= 5 && value < 20;
  return filter === "$20+" && value >= 20;
}

function matchesMinimum(value: number | undefined, filter: string) {
  if (filter === dashboardV2AllFilterValue) return true;
  if (value === undefined) return false;
  const minimumByFilter: Record<string, number> = {
    "1M+": 1_000_000,
    "5M+": 5_000_000,
    "10M+": 10_000_000,
    "50M+": 50_000_000,
  };
  const minimum = minimumByFilter[filter];
  return minimum !== undefined && value >= minimum;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
