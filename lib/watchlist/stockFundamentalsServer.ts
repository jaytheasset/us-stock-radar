import { getServerEnv } from "../env.ts";
import {
  normalizeStockFundamentals,
  type StockFundamentalsProviderResult,
  type StockFundamentalsProviderSources,
} from "./stockFundamentals.ts";

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";
const FUNDAMENTALS_REVALIDATE_SECONDS = 60 * 60;
const FUNDAMENTALS_TIMEOUT_MS = 15_000;

const sourceDefinitions = {
  balanceSheet: {
    endpoint: "balance-sheet-statement",
    params: { limit: "5", period: "quarter" },
  },
  beneficialOwnership: {
    endpoint: "acquisition-of-beneficial-ownership",
    params: {},
  },
  cashFlow: {
    endpoint: "cash-flow-statement",
    params: { limit: "5", period: "quarter" },
  },
  incomeStatement: {
    endpoint: "income-statement",
    params: { limit: "5", period: "quarter" },
  },
  insiderStatistics: {
    endpoint: "insider-trading/statistics",
    params: {},
  },
  insiderTrades: {
    endpoint: "insider-trading/search",
    params: { limit: "20", page: "0" },
  },
  sharesFloat: {
    endpoint: "shares-float",
    params: {},
  },
} as const;

type FetchLike = (
  input: string | URL,
  init?: RequestInit & { next?: { revalidate: number } },
) => Promise<Response>;

export async function fetchStockFundamentals(
  symbol: string,
  options: {
    apiKey?: string;
    fetchImpl?: FetchLike;
    now?: Date;
  } = {},
) {
  const apiKey = options.apiKey ?? getServerEnv().fmpApiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cleanSymbol = normalizeSymbol(symbol);
  const entries = Object.entries(sourceDefinitions) as Array<
    [
      keyof typeof sourceDefinitions,
      (typeof sourceDefinitions)[keyof typeof sourceDefinitions],
    ]
  >;

  const providerSources = Object.fromEntries(
    await Promise.all(
      entries.map(async ([key, definition]) => [
        key,
        apiKey
          ? await fetchFmpSource(
              cleanSymbol,
              definition.endpoint,
              definition.params,
              apiKey,
              fetchImpl,
            )
          : unavailableSource(),
      ]),
    ),
  ) as StockFundamentalsProviderSources;

  return normalizeStockFundamentals(
    cleanSymbol,
    providerSources,
    (options.now ?? new Date()).toISOString(),
  );
}

async function fetchFmpSource(
  symbol: string,
  endpoint: string,
  params: Readonly<Record<string, string>>,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<StockFundamentalsProviderResult> {
  const url = new URL(`${FMP_STABLE_BASE_URL}/${endpoint}`);
  url.searchParams.set("symbol", symbol);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FUNDAMENTALS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      cache: "force-cache",
      headers: {
        Accept: "application/json",
        apikey: apiKey,
      },
      next: { revalidate: FUNDAMENTALS_REVALIDATE_SECONDS },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        data: null,
        state: response.status === 402 ? "plan_unavailable" : "unavailable",
      };
    }
    return {
      data: await response.json().catch(() => null),
      state: "ready",
    };
  } catch {
    return unavailableSource();
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableSource(): StockFundamentalsProviderResult {
  return { data: null, state: "unavailable" };
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}
