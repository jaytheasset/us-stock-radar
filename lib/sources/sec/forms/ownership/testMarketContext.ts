export const OWNERSHIP_FMP_MARKET_CONTEXT_HELPER_NOTE =
  "FMP network helper is retired; this test-only normalizer accepts supplied historical fixtures only.";

export type OwnershipTestMarketContext = {
  symbol: string;
  source: "fmp_test_helper";
  retrieved_at: string;
  market_cap: number | null;
  shares_outstanding: number | null;
  float: number | null;
  public_float: number | null;
  average_volume: number | null;
  average_daily_volume: number | null;
  average_daily_dollar_volume: number | null;
  last_price: number | null;
  currency: string | null;
  source_notes: string[];
};

type JsonFetcher = (url: string) => Promise<{
  ok?: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

type FetchFmpMarketContextOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: JsonFetcher;
  now?: () => Date;
};

export async function fetchFmpOwnershipMarketContext(_symbol: string, _options: FetchFmpMarketContextOptions = {}): Promise<OwnershipTestMarketContext> { throw new Error("FMP_RETIRED"); }

export function buildFmpOwnershipMarketContextFromResponses(
  symbol: string,
  input: {
    quote?: unknown;
    profile?: unknown;
    floatData?: unknown;
    retrievedAt?: string;
  },
): OwnershipTestMarketContext {
  const quote = firstRecord(input.quote);
  const profile = firstRecord(input.profile);
  const floatData = firstRecord(input.floatData);

  const marketCap =
    numberValue(quote.marketCap) ??
    numberValue(profile.mktCap) ??
    numberValue(profile.marketCap);
  const sharesOutstanding =
    numberValue(quote.sharesOutstanding) ??
    numberValue(floatData.outstandingShares) ??
    numberValue(floatData.sharesOutstanding);
  const floatShares =
    numberValue(floatData.floatShares) ??
    numberValue(floatData.freeFloat) ??
    null;
  const averageVolume =
    numberValue(quote.avgVolume) ??
    numberValue(quote.averageVolume) ??
    numberValue(profile.volAvg) ??
    numberValue(profile.averageVolume);
  const lastPrice =
    numberValue(quote.price) ??
    numberValue(profile.price);

  return {
    symbol: symbol.trim().toUpperCase(),
    source: "fmp_test_helper",
    retrieved_at: input.retrievedAt ?? new Date().toISOString(),
    market_cap: marketCap,
    shares_outstanding: sharesOutstanding,
    float: floatShares,
    public_float: floatShares,
    average_volume: averageVolume,
    average_daily_volume: averageVolume,
    average_daily_dollar_volume:
      averageVolume !== null && lastPrice !== null ? averageVolume * lastPrice : null,
    last_price: lastPrice,
    currency: stringValue(quote.currency) || stringValue(profile.currency) || null,
    source_notes: [
      OWNERSHIP_FMP_MARKET_CONTEXT_HELPER_NOTE,
      "Normalizes supplied historical FMP quote/profile/shares_float records.",
      "Runtime parser path must not call this helper automatically.",
    ],
  };
}

function firstRecord(value: unknown): Record<string, unknown> {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const numeric = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
