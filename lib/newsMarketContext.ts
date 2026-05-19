import { fetchFmpProfile, fetchFmpQuote, fetchFmpSharesFloat } from "@/lib/integrations";
import { writeMarketQuoteCache } from "@/lib/marketDataCache";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import type { NewsPromptMarketContext } from "@/lib/prompts/newsEventAnalysis";

type Row = Record<string, unknown>;
type ResolveOptions = {
  refresh?: boolean;
  persist?: boolean;
};

const MAX_CONTEXT_SYMBOLS = 6;

export async function resolveNewsPromptMarketContext(
  symbolInputs: string[],
  options: ResolveOptions = {},
): Promise<NewsPromptMarketContext> {
  const symbols = normalizeSymbols(symbolInputs).slice(0, MAX_CONTEXT_SYMBOLS);
  if (!symbols.length) {
    return {
      available: false,
      symbols: [],
      items: [],
      notes: ["no_body_tickers"],
    };
  }

  const refresh = options.refresh ?? true;
  const [tickerResult, quoteResult, snapshotResult, liveResults] = await Promise.all([
    readTickerRows(symbols),
    readQuoteRows(symbols),
    readSnapshotRows(symbols),
    refresh ? readFreshMarketRows(symbols, Boolean(options.persist)) : Promise.resolve(new Map<string, FreshMarketRow>()),
  ]);

  const tickerRows = rowsBySymbol(tickerResult.rows, "symbol");
  const quoteRows = rowsBySymbol(quoteResult.rows, "symbol");
  const snapshotRows = rowsBySymbol(snapshotResult.rows, "ticker");
  const notes = [
    refresh ? "fresh_market_context_requested" : "cache_only_market_context",
    options.persist ? "fresh_market_context_persist_enabled" : "fresh_market_context_persist_disabled",
    ...tickerResult.errors,
    ...quoteResult.errors,
    ...snapshotResult.errors,
    ...Array.from(liveResults.values()).flatMap((item) => item.errors),
  ].slice(0, 10);

  const items = symbols.map((symbol) => {
    const live: FreshMarketRow = liveResults.get(symbol) || { errors: [] };
    const ticker = tickerRows.get(symbol) || {};
    const quote = quoteRows.get(symbol) || {};
    const snapshot = snapshotRows.get(symbol) || {};
    const price = firstNumber(live.price, quote.price, snapshot.price);
    const previousClose = firstNumber(live.previous_close, quote.previous_close);
    const marketCap = firstNumber(live.market_cap, ticker.market_cap, snapshot.market_cap);
    const sharesOutstanding = firstNumber(live.shares_outstanding, snapshot.shares_outstanding);
    const publicFloat = firstNumber(live.public_float, snapshot.float_shares);
    const volume = firstNumber(live.volume, quote.volume, snapshot.volume);
    const avgVolume = firstNumber(live.avg_volume, snapshot.avg_volume);
    const asOf = firstString(live.as_of, quote.fetched_at, snapshot.fetched_at, ticker.last_profiled_at);
    const fieldsAvailable = [
      price,
      previousClose,
      marketCap,
      sharesOutstanding,
      publicFloat,
      volume,
      avgVolume,
    ].filter((value) => value !== null).length;
    const dataQuality: "complete" | "partial" | "missing" =
      fieldsAvailable >= 5 ? "complete" : fieldsAvailable > 0 ? "partial" : "missing";

    return {
      symbol,
      name: firstString(live.name, ticker.name),
      exchange: firstString(live.exchange, ticker.exchange),
      asset_type: firstString(ticker.asset_type),
      sector: firstString(live.sector, ticker.fmp_sector),
      industry: firstString(live.industry, ticker.fmp_industry),
      price,
      previous_close: previousClose,
      market_cap: marketCap,
      shares_outstanding: sharesOutstanding,
      public_float: publicFloat,
      volume,
      avg_volume: avgVolume,
      as_of: asOf,
      data_quality: dataQuality,
      field_sources: {
        price: sourceForValue(price, [
          [live.price, "fmp_quote"],
          [quote.price, "market_quotes"],
          [snapshot.price, "market_snapshots"],
        ]),
        previous_close: sourceForValue(previousClose, [
          [live.previous_close, "fmp_quote"],
          [quote.previous_close, "market_quotes"],
        ]),
        market_cap: sourceForValue(marketCap, [
          [live.market_cap, "fmp_quote/profile"],
          [ticker.market_cap, "tickers"],
          [snapshot.market_cap, "market_snapshots"],
        ]),
        shares_outstanding: sourceForValue(sharesOutstanding, [
          [live.shares_outstanding, "fmp_shares_float/profile"],
          [snapshot.shares_outstanding, "market_snapshots"],
        ]),
        public_float: sourceForValue(publicFloat, [
          [live.public_float, "fmp_shares_float"],
          [snapshot.float_shares, "market_snapshots"],
        ]),
        volume: sourceForValue(volume, [
          [live.volume, "fmp_quote"],
          [quote.volume, "market_quotes"],
          [snapshot.volume, "market_snapshots"],
        ]),
        avg_volume: sourceForValue(avgVolume, [
          [live.avg_volume, "fmp_quote/profile"],
          [snapshot.avg_volume, "market_snapshots"],
        ]),
      },
    };
  });

  return {
    available: items.some((item) => item.data_quality !== "missing"),
    symbols,
    items,
    notes,
  };
}

type FreshMarketRow = Partial<NewsPromptMarketContext["items"][number]> & {
  errors: string[];
  raw_payload?: Record<string, unknown>;
};

async function readFreshMarketRows(symbols: string[], persist: boolean) {
  const entries = await Promise.all(symbols.map(async (symbol) => [symbol, await readFreshMarketRow(symbol, persist)] as const));
  return new Map(entries);
}

async function readFreshMarketRow(symbol: string, persist: boolean): Promise<FreshMarketRow> {
  const asOf = new Date().toISOString();
  const [quoteResult, profileResult, floatResult] = await Promise.all([
    fetchFmpQuote(symbol),
    fetchFmpProfile(symbol),
    fetchFmpSharesFloat(symbol),
  ]);
  const quote = firstRecord(quoteResult.data);
  const profile = firstRecord(profileResult.data);
  const sharesFloat = firstRecord(floatResult.data);
  const errors = [
    quoteResult.ok ? "" : `fmp_quote:${symbol}: ${quoteResult.error || quoteResult.status}`,
    profileResult.ok ? "" : `fmp_profile:${symbol}: ${profileResult.error || profileResult.status}`,
    floatResult.ok ? "" : `fmp_shares_float:${symbol}: ${floatResult.error || floatResult.status}`,
  ].filter(Boolean);

  const row: FreshMarketRow = {
    symbol,
    name: firstString(profile?.companyName, profile?.company_name, profile?.name),
    exchange: firstString(profile?.exchangeShortName, profile?.exchange, quote?.exchange),
    sector: firstString(profile?.sector),
    industry: firstString(profile?.industry),
    price: firstNumber(quote?.price),
    previous_close: firstNumber(quote?.previousClose),
    market_cap: firstNumber(quote?.marketCap, profile?.mktCap, profile?.marketCap),
    shares_outstanding: firstNumber(
      sharesFloat?.outstandingShares,
      sharesFloat?.outstanding_shares,
      quote?.sharesOutstanding,
      profile?.sharesOutstanding,
    ),
    public_float: firstNumber(
      sharesFloat?.floatShares,
      sharesFloat?.float_shares,
      sharesFloat?.freeFloatShares,
      sharesFloat?.publicFloat,
      sharesFloat?.sharesFloat,
    ),
    volume: firstNumber(quote?.volume),
    avg_volume: firstNumber(quote?.avgVolume, quote?.averageVolume, profile?.volAvg),
    as_of: asOf,
    errors,
    raw_payload: {
      fmp_quote: quote || null,
      fmp_profile: profile || null,
      fmp_shares_float: sharesFloat || null,
    },
  };

  if (persist) {
    await persistFreshMarketRow(row);
  }

  return row;
}

async function persistFreshMarketRow(row: FreshMarketRow) {
  if (!row.symbol) return;
  await Promise.allSettled([
    writeMarketQuoteCache({
      symbol: row.symbol,
      provider: "fmp",
      price: row.price ?? undefined,
      previousClose: row.previous_close ?? undefined,
      volume: row.volume ?? undefined,
      rawPayload: row.raw_payload?.fmp_quote || {},
    }),
    supabaseUpsert("market_snapshots", {
      ticker: row.symbol,
      price: row.price ?? null,
      market_cap: row.market_cap ?? null,
      float_shares: row.public_float ?? null,
      shares_outstanding: row.shares_outstanding ?? null,
      volume: row.volume ?? null,
      avg_volume: row.avg_volume ?? null,
      source: "fmp",
      fetched_at: row.as_of,
      raw_payload: row.raw_payload || {},
    }),
  ]);
}

async function readTickerRows(symbols: string[]) {
  const result = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,asset_type,fmp_sector,fmp_industry,market_cap,last_profiled_at",
    symbol: postgrestIn(symbols),
    limit: String(symbols.length),
  });
  return {
    rows: result.ok && Array.isArray(result.data) ? (result.data as Row[]) : [],
    errors: result.ok ? [] : [`tickers: ${result.error || "read_failed"}`],
  };
}

async function readQuoteRows(symbols: string[]) {
  const result = await supabaseSelect("market_quotes", {
    select: "symbol,price,previous_close,change_percent,volume,fetched_at",
    symbol: postgrestIn(symbols),
    limit: String(symbols.length),
  });
  return {
    rows: result.ok && Array.isArray(result.data) ? (result.data as Row[]) : [],
    errors: result.ok ? [] : [`market_quotes: ${result.error || "read_failed"}`],
  };
}

async function readSnapshotRows(symbols: string[]) {
  const result = await supabaseSelect("market_snapshots", {
    select: "ticker,price,market_cap,float_shares,shares_outstanding,volume,avg_volume,fetched_at",
    ticker: postgrestIn(symbols),
    order: "ticker.asc,fetched_at.desc",
    limit: String(symbols.length * 3),
  });
  return {
    rows: result.ok && Array.isArray(result.data) ? (result.data as Row[]) : [],
    errors: result.ok ? [] : [`market_snapshots: ${result.error || "read_failed"}`],
  };
}

function rowsBySymbol(rows: Row[], key: string) {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const symbol = firstString(row[key])?.toUpperCase();
    if (symbol && !map.has(symbol)) map.set(symbol, row);
  }
  return map;
}

function normalizeSymbols(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().replace(/^\$/, "").toUpperCase())
        .filter((value) => /^[A-Z][A-Z0-9.-]{0,5}$/.test(value)),
    ),
  );
}

function postgrestIn(values: string[]) {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")})`;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstRecord(value: unknown): Row | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceForValue(value: number | null, candidates: Array<[unknown, string]>) {
  if (value === null) return null;
  for (const [candidate, source] of candidates) {
    const parsed = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isFinite(parsed) && parsed === value) return source;
  }
  return null;
}
