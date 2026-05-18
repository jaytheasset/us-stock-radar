import { supabaseSelect } from "@/lib/supabase";

type CanonicalTicker = {
  symbol: string;
  exchange: string | null;
  name: string | null;
  assetType: string | null;
  marketCap: number | null;
};

type TickerRejectReason = "foreign_exchange" | "non_equity";

export type TickerCanonicalizationCorrection = {
  field: "primary_ticker" | "tickers" | "related_tickers";
  symbol: string;
  from_exchange: string | null;
  to_exchange: string | null;
  name: string | null;
  asset_type: string | null;
  market_cap: number | null;
};

export type TickerCanonicalizationResult = {
  analysis: Record<string, unknown>;
  corrections: TickerCanonicalizationCorrection[];
  unresolved_symbols: string[];
  removed_non_equity_symbols: string[];
  removed_foreign_symbols: string[];
  lookup_error?: string;
};

const tickerCache = new Map<string, CanonicalTicker>();
const tickerRejectCache = new Map<string, TickerRejectReason>();

export async function canonicalizeAnalysisTickersWithCache(
  analysis: Record<string, unknown>,
): Promise<TickerCanonicalizationResult> {
  const symbols = collectTickerSymbols(analysis);
  const lookup = await lookupCanonicalTickers(symbols);
  const corrections: TickerCanonicalizationCorrection[] = [];
  const unresolved = new Set<string>();
  const removedNonEquity = new Set<string>();
  const removedForeign = new Set<string>();

  const canonicalized: Record<string, unknown> = { ...analysis };
  canonicalized.primary_ticker = canonicalizeTickerRecord({
    value: analysis.primary_ticker,
    field: "primary_ticker",
    lookup: lookup.tickers,
    rejects: lookup.rejects,
    corrections,
    unresolved,
    removedNonEquity,
    removedForeign,
  });
  canonicalized.tickers = canonicalizeTickerArray({
    value: analysis.tickers,
    field: "tickers",
    lookup: lookup.tickers,
    rejects: lookup.rejects,
    corrections,
    unresolved,
    removedNonEquity,
    removedForeign,
  });
  canonicalized.related_tickers = canonicalizeTickerArray({
    value: analysis.related_tickers,
    field: "related_tickers",
    lookup: lookup.tickers,
    rejects: lookup.rejects,
    corrections,
    unresolved,
    removedNonEquity,
    removedForeign,
  });

  canonicalized.ticker_canonicalization = {
    source: "tickers_cache",
    corrections,
    unresolved_symbols: Array.from(unresolved),
    removed_non_equity_symbols: Array.from(removedNonEquity),
    removed_foreign_symbols: Array.from(removedForeign),
    lookup_error: lookup.error || null,
  };

  return {
    analysis: canonicalized,
    corrections,
    unresolved_symbols: Array.from(unresolved),
    removed_non_equity_symbols: Array.from(removedNonEquity),
    removed_foreign_symbols: Array.from(removedForeign),
    lookup_error: lookup.error,
  };
}

function collectTickerSymbols(analysis: Record<string, unknown>) {
  const symbols = new Set<string>();
  const collect = (value: unknown) => {
    const record = toRecord(value);
    const symbol = normalizeTicker(record?.ticker);
    if (symbol) symbols.add(symbol);
  };

  collect(analysis.primary_ticker);
  for (const item of recordArray(analysis.tickers)) collect(item);
  for (const item of recordArray(analysis.related_tickers)) collect(item);

  return Array.from(symbols);
}

async function lookupCanonicalTickers(symbols: string[]) {
  const tickers = new Map<string, CanonicalTicker>();
  const rejects = new Map<string, TickerRejectReason>();
  const missing = symbols.filter((symbol) => !tickerCache.has(symbol) && !tickerRejectCache.has(symbol));
  if (missing.length) {
    const result = await supabaseSelect("tickers", {
      select: "symbol,name,exchange,asset_type,market_cap,is_active",
      symbol: `in.(${missing.join(",")})`,
      is_active: "eq.true",
      limit: String(Math.max(20, missing.length * 8)),
    });

    if (!result.ok || !Array.isArray(result.data)) {
      return {
        tickers: readCachedTickers(symbols, tickers),
        rejects: readCachedRejects(symbols, rejects),
        error: result.error || "ticker cache lookup failed",
      };
    }

    const bySymbol = new Map<string, CanonicalTicker[]>();
    for (const row of result.data) {
      const canonical = toCanonicalTicker(row as Record<string, unknown>);
      if (!canonical) continue;
      const rows = bySymbol.get(canonical.symbol) || [];
      rows.push(canonical);
      bySymbol.set(canonical.symbol, rows);
    }

    for (const symbol of missing) {
      const rows = bySymbol.get(symbol) || [];
      const preferred = choosePreferredCanonicalTicker(rows);
      if (preferred) {
        tickerCache.set(symbol, preferred);
        tickerRejectCache.delete(symbol);
        continue;
      }

      const rejectReason = rejectReasonForRows(rows);
      if (rejectReason) {
        tickerRejectCache.set(symbol, rejectReason);
      }
    }
  }

  return {
    tickers: readCachedTickers(symbols, tickers),
    rejects: readCachedRejects(symbols, rejects),
    error: undefined,
  };
}

function readCachedTickers(symbols: string[], tickers: Map<string, CanonicalTicker>) {
  for (const symbol of symbols) {
    const cached = tickerCache.get(symbol);
    if (cached) tickers.set(symbol, cached);
  }
  return tickers;
}

function readCachedRejects(symbols: string[], rejects: Map<string, TickerRejectReason>) {
  for (const symbol of symbols) {
    const cached = tickerRejectCache.get(symbol);
    if (cached) rejects.set(symbol, cached);
  }
  return rejects;
}

function canonicalizeTickerRecord({
  value,
  field,
  lookup,
  rejects,
  corrections,
  unresolved,
  removedNonEquity,
  removedForeign,
}: {
  value: unknown;
  field: TickerCanonicalizationCorrection["field"];
  lookup: Map<string, CanonicalTicker>;
  rejects: Map<string, TickerRejectReason>;
  corrections: TickerCanonicalizationCorrection[];
  unresolved: Set<string>;
  removedNonEquity: Set<string>;
  removedForeign: Set<string>;
}) {
  const record = toRecord(value);
  if (!record) return value;
  return (
    canonicalizeOneTicker(record, field, lookup, rejects, corrections, unresolved, removedNonEquity, removedForeign) || {
      ...record,
      ticker: null,
      exchange: null,
    }
  );
}

function canonicalizeTickerArray({
  value,
  field,
  lookup,
  rejects,
  corrections,
  unresolved,
  removedNonEquity,
  removedForeign,
}: {
  value: unknown;
  field: TickerCanonicalizationCorrection["field"];
  lookup: Map<string, CanonicalTicker>;
  rejects: Map<string, TickerRejectReason>;
  corrections: TickerCanonicalizationCorrection[];
  unresolved: Set<string>;
  removedNonEquity: Set<string>;
  removedForeign: Set<string>;
}) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = toRecord(item);
    const canonical = record
      ? canonicalizeOneTicker(record, field, lookup, rejects, corrections, unresolved, removedNonEquity, removedForeign)
      : item;
    return canonical ? [canonical] : [];
  });
}

function canonicalizeOneTicker(
  record: Record<string, unknown>,
  field: TickerCanonicalizationCorrection["field"],
  lookup: Map<string, CanonicalTicker>,
  rejects: Map<string, TickerRejectReason>,
  corrections: TickerCanonicalizationCorrection[],
  unresolved: Set<string>,
  removedNonEquity: Set<string>,
  removedForeign: Set<string>,
) {
  const symbol = normalizeTicker(record.ticker);
  if (!symbol) return { ...record };

  const canonical = lookup.get(symbol);
  if (!canonical) {
    const rejectReason = rejects.get(symbol);
    if (rejectReason === "non_equity") {
      removedNonEquity.add(symbol);
      return null;
    }
    if (rejectReason === "foreign_exchange" || isKnownForeignExchange(record.exchange)) {
      removedForeign.add(symbol);
      return null;
    }
    unresolved.add(symbol);
    return null;
  }

  if (isBlockedFundAssetType(canonical.assetType)) {
    removedNonEquity.add(symbol);
    return null;
  }

  const fromExchange = nullableString(record.exchange);
  const toExchange = canonical.exchange;
  if (normalizeExchange(fromExchange) !== normalizeExchange(toExchange)) {
    corrections.push({
      field,
      symbol,
      from_exchange: fromExchange,
      to_exchange: toExchange,
      name: canonical.name,
      asset_type: canonical.assetType,
      market_cap: canonical.marketCap,
    });
  }

  return {
    ...record,
    ticker: symbol,
    exchange: toExchange,
  };
}

function choosePreferredCanonicalTicker(rows: CanonicalTicker[]) {
  const candidates = rows
    .filter((row) => !isBlockedFundAssetType(row.assetType))
    .filter((row) => isUsListedExchange(row.exchange))
    .sort((a, b) => tickerPreferenceScore(b) - tickerPreferenceScore(a) || compareMarketCap(b, a));
  return candidates[0] || null;
}

function rejectReasonForRows(rows: CanonicalTicker[]): TickerRejectReason | null {
  if (!rows.length) return null;
  if (rows.every((row) => isBlockedFundAssetType(row.assetType))) return "non_equity";
  if (!rows.some((row) => isUsListedExchange(row.exchange))) return "foreign_exchange";
  return "foreign_exchange";
}

function tickerPreferenceScore(row: CanonicalTicker) {
  const assetType = normalizeAssetType(row.assetType);
  let score = 0;
  if (assetType === "stock") score += 30;
  if (assetType === "adr_or_class") score += 25;
  if (assetType === "otc") score += 20;
  if (isMajorExchange(row.exchange)) score += 10;
  if (normalizeExchange(row.exchange).startsWith("OTC")) score += 3;
  return score;
}

function compareMarketCap(a: CanonicalTicker, b: CanonicalTicker) {
  return (a.marketCap || 0) - (b.marketCap || 0);
}

function isMajorExchange(value: string | null) {
  const normalized = normalizeExchange(value);
  return normalized === "NASDAQ" || normalized === "NYSE" || normalized === "NYSE_AMERICAN" || normalized === "AMEX";
}

function isUsListedExchange(value: string | null) {
  const normalized = normalizeExchange(value);
  return (
    normalized === "NASDAQ" ||
    normalized === "NYSE" ||
    normalized === "NYSE_AMERICAN" ||
    normalized === "NYSE_ARCA" ||
    normalized === "AMEX" ||
    normalized === "CBOE" ||
    normalized === "BATS" ||
    normalized === "OTC" ||
    normalized === "OTCQX" ||
    normalized === "OTCQB" ||
    normalized === "OTC_PINK" ||
    normalized === "PINK" ||
    normalized.startsWith("OTC_")
  );
}

function isKnownForeignExchange(value: unknown) {
  const text = nullableString(value);
  return Boolean(text && !isUsListedExchange(text));
}

function isBlockedFundAssetType(value: string | null) {
  const normalized = normalizeAssetType(value);
  return (
    normalized === "etf" ||
    normalized === "fund" ||
    normalized === "cef" ||
    normalized === "index" ||
    normalized === "commodity_trust" ||
    normalized === "trust"
  );
}

function normalizeAssetType(value: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toCanonicalTicker(row: Record<string, unknown>): CanonicalTicker | null {
  const symbol = normalizeTicker(row.symbol);
  if (!symbol) return null;
  return {
    symbol,
    exchange: nullableString(row.exchange),
    name: nullableString(row.name),
    assetType: nullableString(row.asset_type),
    marketCap: numberOrNull(row.market_cap),
  };
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTicker(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeExchange(value: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[.\s-]+/g, "_");
}

function nullableString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
