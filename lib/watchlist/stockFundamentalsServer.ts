import {
  normalizeStockFundamentals,
  type StockFundamentalsProviderResult,
} from "./stockFundamentals.ts";
// Preserve the existing unavailable contract without reviving historical FMP caches.
export async function fetchStockFundamentals(
  symbol: string,
  options: {
    apiKey?: string;
    cache?: boolean;
    fetchImpl?: (
      input: string | URL,
      init?: RequestInit & { next?: { revalidate: number } },
    ) => Promise<Response>;
    now?: Date;
  } = {},
) {
  const now = options.now ?? new Date();
  const unavailable: StockFundamentalsProviderResult = {
    data: [],
    fetchedAt: now.toISOString(),
    httpStatus: 410,
    state: "unavailable",
  };
  return normalizeStockFundamentals(
    symbol
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, "")
      .slice(0, 12),
    {
      balanceAnnual: unavailable,
      balanceQuarterly: unavailable,
      cashAnnual: unavailable,
      cashQuarterly: unavailable,
      incomeAnnual: unavailable,
      incomeQuarterly: unavailable,
      institutionalHolders: unavailable,
      institutionalSummary: unavailable,
    },
    now.toISOString(),
  );
}
