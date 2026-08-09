export const marketCapBands = ["Micro", "Small", "Mid", "Large", "Mega"] as const;

export type MarketCapBand = (typeof marketCapBands)[number];
export type MarketCapFilterId = Lowercase<MarketCapBand>;

export const marketCapRangeLabels: Record<MarketCapBand, string> = {
  Micro: "<$100M",
  Small: "$100M-$2B",
  Mid: "$2B-$10B",
  Large: "$10B-$200B",
  Mega: "$200B+",
};

export function classifyMarketCapBand(value: unknown): MarketCapBand | null {
  const marketCap = finiteNonNegativeNumber(value);
  if (marketCap === null) return null;
  if (marketCap < 100_000_000) return "Micro";
  if (marketCap < 2_000_000_000) return "Small";
  if (marketCap < 10_000_000_000) return "Mid";
  if (marketCap < 200_000_000_000) return "Large";
  return "Mega";
}

export function classifyMarketCapFilterId(value: unknown): MarketCapFilterId | null {
  const band = classifyMarketCapBand(value);
  return band ? band.toLowerCase() as MarketCapFilterId : null;
}

export function matchesMarketCapBand(value: unknown, band: string) {
  return classifyMarketCapBand(value) === band;
}

export function readStoredEventMarketCap(metadataValue: unknown) {
  const metadata = readRecord(metadataValue);
  const resolved = readRecord(metadata?.resolved_market_cap);
  if (resolved) return finiteNonNegativeNumber(resolved.value);

  const marketContext = readRecord(metadata?.market_context);
  const analysisOutput = readRecord(metadata?.analysis_output);
  const analysisMarketContext = readRecord(analysisOutput?.market_context);
  const displayPayload = readRecord(metadata?.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const displayMarketContext = readRecord(displayData?.market_context);

  for (const value of [
    marketContext?.market_cap,
    analysisMarketContext?.market_cap,
    displayMarketContext?.market_cap,
  ]) {
    const marketCap = finiteNonNegativeNumber(value);
    if (marketCap !== null) return marketCap;
  }
  return null;
}

function finiteNonNegativeNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/[$,\s]/g, ""))
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
