import "server-only";

import {
  readSc13IssuerCurrentState,
  type Sc13IssuerCurrentStateRead,
} from "@/lib/sec-sc13-xml/currentState";
import type { Sc13CanonicalRepository } from "@/lib/sec-sc13-xml/persistence";
import {
  buildStockSc13OwnershipSnapshot,
  STOCK_SC13_SCOPE,
  STOCK_SC13_SOURCE,
  type StockSc13OwnershipSnapshot,
} from "@/lib/watchlist/stockSc13Ownership";

type ReadCurrentState = (
  issuerCik: string,
  options: { repository: Sc13CanonicalRepository },
) => Promise<Sc13IssuerCurrentStateRead>;

const TICKER_OBSERVATION_LIMIT = 1000;

export async function fetchStockSc13Ownership(
  symbolValue: string,
  options: {
    fetchedAt?: string;
    readCurrentState?: ReadCurrentState;
    repository?: Sc13CanonicalRepository;
  } = {},
): Promise<StockSc13OwnershipSnapshot> {
  const symbol = normalizeSymbol(symbolValue);
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  if (!symbol) return unavailable(symbol, fetchedAt, null, "invalid_symbol");

  const repository = options.repository ?? await defaultRepository();
  const tickerResult = await repository.select("sec_issuer_ticker_observations", {
    limit: String(TICKER_OBSERVATION_LIMIT),
    order: "observed_at.desc,id.desc",
    select: "issuer_cik,ticker,observed_at,id",
    ticker: `eq.${symbol}`,
  });
  if (!tickerResult.ok || !Array.isArray(tickerResult.data)) {
    return unavailable(symbol, fetchedAt, null, "issuer_identity_read_failed");
  }
  if (
    typeof tickerResult.count !== "number"
    || !Number.isInteger(tickerResult.count)
    || tickerResult.count < 0
    || tickerResult.count !== tickerResult.data.length
  ) {
    return unavailable(symbol, fetchedAt, null, "issuer_identity_history_incomplete");
  }
  const tickerIdentities = tickerResult.data.map(readTickerIdentity);
  if (tickerIdentities.some((identity) => !identity || identity.ticker !== symbol)) {
    return unavailable(symbol, fetchedAt, null, "issuer_identity_response_invalid");
  }
  const issuerCiks = [...new Set(tickerIdentities.map((identity) => identity!.issuerCik))];
  if (issuerCiks.length !== 1 || tickerResult.data.length === 0) {
    return unavailable(
      symbol,
      fetchedAt,
      null,
      issuerCiks.length > 1 ? "issuer_identity_ambiguous" : "issuer_identity_unavailable",
    );
  }

  const issuerCik = issuerCiks[0]!;
  const readCurrentState = options.readCurrentState ?? readSc13IssuerCurrentState;
  const currentState = await readCurrentState(issuerCik, { repository });
  return buildStockSc13OwnershipSnapshot({ currentState, fetchedAt, symbol });
}

function unavailable(
  symbol: string,
  fetchedAt: string,
  issuerCik: string | null,
  reason: string,
): Extract<StockSc13OwnershipSnapshot, { status: "unavailable" }> {
  return {
    fetchedAt,
    gptDependency: false,
    historyComplete: false,
    issuerCik,
    positions: [],
    reason,
    scope: STOCK_SC13_SCOPE,
    secGlobalCompleteness: "not_verified",
    source: STOCK_SC13_SOURCE,
    status: "unavailable",
    symbol,
  };
}

async function defaultRepository(): Promise<Sc13CanonicalRepository> {
  const supabase = await import("@/lib/supabase");
  return {
    rpc: supabase.supabaseRpc,
    select: supabase.supabaseSelect,
  };
}

function readTickerIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const raw = row.issuer_cik;
  const text = typeof raw === "string" ? raw.trim() : "";
  const ticker = typeof row.ticker === "string" ? normalizeSymbol(row.ticker) : "";
  return /^\d{1,10}$/.test(text) && ticker
    ? { issuerCik: text.padStart(10, "0"), ticker }
    : null;
}

function normalizeSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(symbol) ? symbol : "";
}
