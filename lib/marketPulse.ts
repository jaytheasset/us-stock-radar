import type {
  MarketBarCachePayload,
  MarketQuoteCachePayload,
} from "./marketDataCache.ts";

export type MarketPulseGroup = "cash" | "futures";
export type MarketPulseTone = "bullish" | "bearish" | "volatile" | "neutral";

export type MarketPulseDefinition = {
  cacheSymbol: string;
  group: MarketPulseGroup;
  label: string;
  providerSymbol: string;
  unit: "index" | "yield";
};

export type MarketPulseItem = {
  cacheSymbol: string;
  detail: string;
  group: MarketPulseGroup;
  label: string;
  tone: MarketPulseTone;
  trend: number[];
  value: string;
};

export const marketPulseDefinitions: readonly MarketPulseDefinition[] = [
  { cacheSymbol: "^GSPC", group: "cash", label: "S&P 500", providerSymbol: "^GSPC", unit: "index" },
  { cacheSymbol: "^NDX", group: "cash", label: "Nasdaq 100", providerSymbol: "^NDX", unit: "index" },
  { cacheSymbol: "^RUT", group: "cash", label: "Russell 2000", providerSymbol: "^RUT", unit: "index" },
  { cacheSymbol: "^SOX", group: "cash", label: "SOX", providerSymbol: "I:SOX", unit: "index" },
  { cacheSymbol: "^VIX", group: "cash", label: "VIX", providerSymbol: "^VIX", unit: "index" },
  { cacheSymbol: "US10Y", group: "cash", label: "US 10Y", providerSymbol: "year10", unit: "yield" },
  { cacheSymbol: "ESUSD", group: "futures", label: "S&P 500 Fut.", providerSymbol: "ESUSD", unit: "index" },
  { cacheSymbol: "NQUSD", group: "futures", label: "Nasdaq Fut.", providerSymbol: "NQUSD", unit: "index" },
  { cacheSymbol: "RTYUSD", group: "futures", label: "Russell Fut.", providerSymbol: "RTYUSD", unit: "index" },
] as const;

type Quote = Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">;

export function buildMarketPulseItems(
  quoteMap: ReadonlyMap<string, Quote>,
  barMap: ReadonlyMap<string, MarketBarCachePayload>,
): MarketPulseItem[] {
  return marketPulseDefinitions.map((definition) => {
    const quote = quoteMap.get(definition.cacheSymbol);
    const bars = barMap.get(definition.cacheSymbol);
    const price = finiteNumber(quote?.price);
    const changeAmount = finiteNumber(quote?.changeAmount);
    const changePercent = finiteNumber(quote?.changePercent);

    return {
      cacheSymbol: definition.cacheSymbol,
      detail: formatChange(definition, changeAmount, changePercent),
      group: definition.group,
      label: definition.label,
      tone: resolveTone(definition, changeAmount, changePercent),
      trend: bars?.points.map((point) => point.close).filter(Number.isFinite).slice(-16) || [],
      value: formatValue(definition, price),
    };
  });
}

function formatValue(definition: MarketPulseDefinition, value: number | null) {
  if (value === null) return "—";
  if (definition.unit === "yield") return `${value.toFixed(3)}%`;

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value < 100 ? 2 : 0,
  });
}

function formatChange(
  definition: MarketPulseDefinition,
  changeAmount: number | null,
  changePercent: number | null,
) {
  if (definition.unit === "yield") {
    return changeAmount === null
      ? "Change unavailable"
      : `${signed(changeAmount * 100, 1)} bp`;
  }

  if (changeAmount !== null && changePercent !== null) {
    return `${signed(changeAmount, 2)} (${signed(changePercent, 2)}%)`;
  }
  if (changePercent !== null) return `${signed(changePercent, 2)}%`;
  if (changeAmount !== null) return signed(changeAmount, 2);
  return "Data unavailable";
}

function resolveTone(
  definition: MarketPulseDefinition,
  changeAmount: number | null,
  changePercent: number | null,
): MarketPulseTone {
  if (definition.unit === "yield") {
    return changeAmount === null || changeAmount === 0 ? "neutral" : "volatile";
  }

  const movement = changePercent ?? changeAmount;
  if (movement === null || movement === 0) return "neutral";
  return movement > 0 ? "bullish" : "bearish";
}

function signed(value: number, digits: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
