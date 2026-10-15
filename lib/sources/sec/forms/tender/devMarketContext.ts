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

// Test-only helper. Do not call this from parser/router/analysis runtime paths.
// Production ingest should provide market_context with this same shape.
export async function fetchSecTenderDevFmpMarketContext(_ticker: string, _options: SecTenderDevMarketContextOptions = {}): Promise<SecTenderDevMarketContextResult> {
  return { ok: false, market_context: null, warnings: [], error: "FMP_RETIRED" };
}
