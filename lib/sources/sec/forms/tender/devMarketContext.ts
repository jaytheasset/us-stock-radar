export type SecTenderDevMarketContext = {
  ticker: string;
  source: "fmp_test_helper";
  as_of: string;
  price: number | null;
  previous_close: number | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  public_float: number | null;
  volume: number | null;
  avg_volume: number | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  raw?: {
    quote?: Record<string, unknown> | null;
    profile?: Record<string, unknown> | null;
    shares_float?: Record<string, unknown> | null;
  };
};

export type SecTenderDevMarketContextResult =
  | {
      ok: true;
      market_context: SecTenderDevMarketContext;
      warnings: string[];
    }
  | {
      ok: false;
      market_context: null;
      warnings: string[];
      error: string;
    };

export type SecTenderDevMarketContextOptions = {
  apiKey?: string | null;
  baseUrl?: string;
  includeRaw?: boolean;
  fetchImpl?: typeof fetch;
};

const DEFAULT_FMP_BASE_URL = "https://financialmodelingprep.com/api/v3";

// Test-only helper. Do not call this from parser/router/analysis runtime paths.
// Production ingest should provide market_context with this same shape.
export async function fetchSecTenderDevFmpMarketContext(
  ticker: string,
  options: SecTenderDevMarketContextOptions = {},
): Promise<SecTenderDevMarketContextResult> {
  const symbol = ticker.trim().toUpperCase();
  const apiKey = options.apiKey || process.env.FMP_API_KEY || "";
  const fetcher = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || DEFAULT_FMP_BASE_URL).replace(/\/+$/, "");
  const warnings: string[] = [];

  if (!symbol) {
    return { ok: false, market_context: null, warnings, error: "ticker_required" };
  }
  if (!apiKey) {
    return { ok: false, market_context: null, warnings, error: "FMP_API_KEY is missing" };
  }

  const [quoteResult, profileResult, sharesFloatResult] = await Promise.all([
    fetchFmpFirstRecord(fetcher, `${baseUrl}/quote/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(apiKey)}`),
    fetchFmpFirstRecord(fetcher, `${baseUrl}/profile/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(apiKey)}`),
    fetchFmpFirstRecord(fetcher, `${baseUrl}/shares_float?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`),
  ]);

  for (const result of [quoteResult, profileResult, sharesFloatResult]) {
    if (!result.ok) warnings.push(result.error);
  }

  const quote = quoteResult.ok ? quoteResult.record : null;
  const profile = profileResult.ok ? profileResult.record : null;
  const sharesFloat = sharesFloatResult.ok ? sharesFloatResult.record : null;

  if (!quote && !profile && !sharesFloat) {
    return {
      ok: false,
      market_context: null,
      warnings,
      error: "FMP returned no market context records",
    };
  }

  return {
    ok: true,
    warnings,
    market_context: {
      ticker: symbol,
      source: "fmp_test_helper",
      as_of: new Date().toISOString(),
      price: firstNumber(quote?.price, quote?.previousClose === undefined ? null : quote?.price),
      previous_close: firstNumber(quote?.previousClose, quote?.previous_close),
      market_cap: firstNumber(quote?.marketCap, profile?.mktCap),
      shares_outstanding: firstNumber(quote?.sharesOutstanding, profile?.sharesOutstanding),
      public_float: firstNumber(sharesFloat?.floatShares, sharesFloat?.freeFloat, sharesFloat?.publicFloat),
      volume: firstNumber(quote?.volume),
      avg_volume: firstNumber(quote?.avgVolume),
      exchange: firstString(quote?.exchange, profile?.exchangeShortName, profile?.exchange),
      sector: firstString(profile?.sector),
      industry: firstString(profile?.industry),
      raw: options.includeRaw
        ? {
            quote,
            profile,
            shares_float: sharesFloat,
          }
        : undefined,
    },
  };
}

async function fetchFmpFirstRecord(fetcher: typeof fetch, url: string) {
  try {
    const response = await fetcher(url);
    if (!response.ok) {
      return { ok: false as const, record: null, error: `FMP HTTP ${response.status}` };
    }
    const json = (await response.json()) as unknown;
    const record = Array.isArray(json) ? toRecord(json[0]) : toRecord(json);
    if (!record) return { ok: false as const, record: null, error: "FMP empty response" };
    return { ok: true as const, record, error: "" };
  } catch (error) {
    return {
      ok: false as const,
      record: null,
      error: error instanceof Error ? error.message : "FMP fetch failed",
    };
  }
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
