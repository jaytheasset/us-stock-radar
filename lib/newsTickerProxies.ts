import { supabaseSelect } from "@/lib/supabase";
import { resolveCanonicalMarketGroup, themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

export type NewsTickerProxyRole = "sector_constituent" | "theme_constituent";

export type NewsTickerProxyInput = {
  marketScope: string;
  sector?: string | null;
  industryGroup?: string | null;
  themeGroup?: string | null;
  subTheme?: string | null;
  score?: number | null;
};

export type NewsTickerProxy = {
  ticker: string;
  exchange: string;
  role: NewsTickerProxyRole;
  reason: string;
  relevanceScore: number;
  metadata: Record<string, unknown>;
};

type ProxyCandidate = {
  ticker: string;
  exchange: string;
  reason: string;
  relevanceScore: number;
  metadata?: Record<string, unknown>;
};

type ClassificationTarget = {
  sectorCode: string;
  subCategorySlug?: string;
  label: string;
};

const fmpProxyCache = new Map<string, ProxyCandidate[]>();
const tickerLookupCache = new Map<string, Record<string, unknown> | null>();

export async function buildNewsTickerProxiesWithCache(
  input: NewsTickerProxyInput,
  options: { excludeSymbols?: Iterable<string> } = {},
): Promise<NewsTickerProxy[]> {
  const score = clampScore(input.score);
  const marketScope = normalize(input.marketScope);
  if (marketScope === "company" || score < 50) return [];

  const excluded = new Set(Array.from(options.excludeSymbols || [], normalizeTicker));
  const rows: NewsTickerProxy[] = [];
  const seen = new Set<string>();

  const push = (candidate: ProxyCandidate, role: NewsTickerProxyRole, proxySource: string) => {
    const ticker = normalizeTicker(candidate.ticker);
    if (!ticker || excluded.has(ticker) || seen.has(ticker)) return;
    seen.add(ticker);
    rows.push({
      ticker,
      exchange: candidate.exchange,
      role,
      reason: candidate.reason,
      relevanceScore: candidate.relevanceScore,
      metadata: {
        ...(candidate.metadata || {}),
        generated_by: "news_ticker_proxy",
        proxy_source: proxySource,
        mapping_basis: "llm_sector_theme_classification",
        llm_market_scope: stringValue(input.marketScope) || null,
        llm_sector: stringValue(input.sector) || null,
        llm_industry_group: stringValue(input.industryGroup) || null,
        llm_theme_group: stringValue(input.themeGroup) || null,
        llm_sub_theme: stringValue(input.subTheme) || null,
      },
    });
  };

  const sectorTarget = resolveClassificationTarget(input);
  for (const candidate of await matchThemeProxyCandidates(input)) {
    push(candidate, "theme_constituent", "theme_subtheme_seed_symbols");
  }

  if (sectorTarget) {
    for (const candidate of await matchFmpCacheProxyCandidates(sectorTarget)) {
      push(candidate, "sector_constituent", "fmp_ticker_classifications");
    }
  }

  return rows.slice(0, 8);
}

function resolveClassificationTarget(input: NewsTickerProxyInput): ClassificationTarget | null {
  const values = [
    stringValue(input.industryGroup),
    stringValue(input.sector),
  ].filter(Boolean);

  for (const value of values) {
    const match = resolveCanonicalMarketGroup(value);
    if (!match) continue;
    const sectorCode = sectorCodeFromName(match.sector);
    if (!sectorCode) continue;
    return {
      sectorCode,
      subCategorySlug: match.slug || undefined,
      label: match.subCategory || match.sector,
    };
  }

  return null;
}

async function matchFmpCacheProxyCandidates(target: ClassificationTarget): Promise<ProxyCandidate[]> {
  if (!target.subCategorySlug) return [];

  const cacheKey = `${target.sectorCode}:${target.subCategorySlug || "*"}`;
  const cached = fmpProxyCache.get(cacheKey);
  if (cached) return cached;

  const classificationQuery: Record<string, string> = {
    select: "symbol,sector_code,sub_category_slug,confidence",
    sector_code: `eq.${target.sectorCode}`,
    limit: "200",
  };
  if (target.subCategorySlug) {
    classificationQuery.sub_category_slug = `eq.${target.subCategorySlug}`;
  }

  const classificationResult = await supabaseSelect("ticker_classifications", classificationQuery);
  if (!classificationResult.ok || !Array.isArray(classificationResult.data) || !classificationResult.data.length) {
    fmpProxyCache.set(cacheKey, []);
    return [];
  }

  const symbols = uniqueStrings(
    classificationResult.data.map((row) => stringValue((row as Record<string, unknown>).symbol).toUpperCase()),
  ).slice(0, 180);
  if (!symbols.length) {
    fmpProxyCache.set(cacheKey, []);
    return [];
  }

  const tickerResult = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,fmp_sector,fmp_industry,asset_type,market_cap,is_active",
    symbol: `in.(${symbols.join(",")})`,
    is_active: "eq.true",
    asset_type: "in.(stock,adr_or_class)",
    limit: "200",
  });
  if (!tickerResult.ok || !Array.isArray(tickerResult.data)) {
    fmpProxyCache.set(cacheKey, []);
    return [];
  }

  const candidates = tickerResult.data
    .map((row) => toFmpProxyCandidate(row as Record<string, unknown>, target))
    .filter((item): item is ProxyCandidate => Boolean(item))
    .sort((a, b) => proxyMarketCap(b) - proxyMarketCap(a) || a.ticker.localeCompare(b.ticker))
    .slice(0, target.subCategorySlug ? 5 : 3);

  fmpProxyCache.set(cacheKey, candidates);
  return candidates;
}

async function matchThemeProxyCandidates(input: NewsTickerProxyInput): Promise<ProxyCandidate[]> {
  const themeGroup = normalize(input.themeGroup);
  const subTheme = normalize(input.subTheme);
  if (!themeGroup && !subTheme) return [];

  const matches = themeSubThemes
    .map((theme) => {
    const group = themeGroups.find((item) => item.slug === theme.themeGroupSlug);
    const groupSlug = normalize(theme.themeGroupSlug);
    const groupName = normalize(group?.name);
    const themeSlug = normalize(theme.slug);
    const themeName = normalize(theme.name);
    const groupMatches =
      themeGroup && (normalizedValuesMatch(themeGroup, groupSlug) || normalizedValuesMatch(themeGroup, groupName));
    if (themeGroup && !groupMatches) return { theme, score: 0 };
    if (!subTheme) return { theme, score: groupMatches ? 1 : 0 };

    let score = 0;
    if (normalizedValuesMatch(subTheme, themeSlug)) score += 8;
    if (normalizedValuesMatch(subTheme, themeName)) score += 8;
    for (const keyword of theme.keywords) {
      const keywordScore = taxonomyTextMatchScore(subTheme, normalize(keyword));
      score = Math.max(score, keywordScore);
    }
    if (groupMatches && score > 0) score += 1;
    return { theme, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.theme.sortOrder - b.theme.sortOrder)
    .slice(0, subTheme ? 2 : 1)
    .map((item) => item.theme);

  const seedSymbols = uniqueStrings(matches.flatMap((theme) => theme.seedSymbols)).slice(0, 12);
  const tickerRows = await lookupTickers(seedSymbols);
  return seedSymbols.flatMap((symbol) => {
    const row = tickerRows.get(symbol);
    if (!row) return [];
    const exchange = stringValue(row.exchange);
    if (!exchange) return [];
    return [{
      ticker: symbol,
      exchange,
      reason: themeReason(matches, symbol),
      relevanceScore: 58,
      metadata: {
        theme_group: stringValue(input.themeGroup) || null,
        sub_theme: stringValue(input.subTheme) || null,
        company_name: stringValue(row?.name) || null,
        asset_type: stringValue(row?.asset_type) || null,
        market_cap: numberValue(row?.market_cap),
      },
    }];
  }).slice(0, 5);
}

async function lookupTickers(symbols: string[]) {
  const result = new Map<string, Record<string, unknown> | null>();
  const missing: string[] = [];
  for (const symbol of symbols.map(normalizeTicker).filter(Boolean)) {
    if (tickerLookupCache.has(symbol)) {
      result.set(symbol, tickerLookupCache.get(symbol) || null);
    } else {
      missing.push(symbol);
    }
  }
  if (missing.length) {
    const tickerResult = await supabaseSelect("tickers", {
      select: "symbol,name,exchange,asset_type,market_cap,is_active",
      symbol: `in.(${missing.join(",")})`,
      is_active: "eq.true",
      asset_type: "in.(stock,adr_or_class)",
      limit: "100",
    });
    const rows = Array.isArray(tickerResult.data) ? tickerResult.data as Record<string, unknown>[] : [];
    const bySymbol = new Map(rows.map((row) => [normalizeTicker(stringValue(row.symbol)), row]));
    for (const symbol of missing) {
      const row = bySymbol.get(symbol) || null;
      tickerLookupCache.set(symbol, row);
      result.set(symbol, row);
    }
  }
  return result;
}

function themeReason(matches: Array<{ name: string; seedSymbols: string[] }>, symbol: string) {
  const match = matches.find((theme) => theme.seedSymbols.includes(symbol));
  return match ? `Theme proxy mapped from LLM sub-theme: ${match.name}` : "Theme proxy mapped from LLM classification";
}

function toFmpProxyCandidate(row: Record<string, unknown>, target: ClassificationTarget): ProxyCandidate | null {
  const ticker = normalizeTicker(stringValue(row.symbol));
  const exchange = stringValue(row.exchange);
  const marketCap = numberValue(row.market_cap);
  if (!ticker || !exchange || !Number.isFinite(marketCap) || marketCap <= 0) return null;

  return {
    ticker,
    exchange: normalizeExchange(exchange),
    reason: `FMP cached constituent mapped from LLM classification: ${target.label}`,
    relevanceScore: Math.max(54, Math.min(69, 54 + Math.round(Math.log10(marketCap) * 1.2))),
    metadata: {
      company_name: stringValue(row.name) || null,
      fmp_sector: stringValue(row.fmp_sector) || null,
      fmp_industry: stringValue(row.fmp_industry) || null,
      fmp_market_cap: marketCap,
      sector_code: target.sectorCode,
      sub_category_slug: target.subCategorySlug || null,
    },
  };
}

function proxy(ticker: string, exchange: string, reason: string, relevanceScore: number): ProxyCandidate {
  return { ticker, exchange, reason, relevanceScore };
}

function sectorCodeFromName(value: string) {
  const normalized = normalize(value);
  if (normalized === "communication services") return "communication_services";
  if (normalized === "consumer cyclical" || normalized === "consumer discretionary") return "consumer_cyclical";
  if (normalized === "consumer defensive" || normalized === "consumer staples") return "consumer_defensive";
  if (normalized === "financial services" || normalized === "financials") return "financial_services";
  if (normalized === "basic materials" || normalized === "materials") return "basic_materials";
  if (normalized === "real estate") return "real_estate";
  if (normalized === "technology") return "technology";
  if (normalized === "healthcare" || normalized === "health care") return "healthcare";
  if (normalized === "industrials") return "industrials";
  if (normalized === "energy") return "energy";
  if (normalized === "utilities") return "utilities";
  return null;
}

function normalizeExchange(value: string) {
  const normalized = value.trim().toUpperCase();
  if (["NASDAQ", "NYSE", "AMEX", "CBOE"].includes(normalized)) return normalized;
  if (normalized === "NYSEARCA" || normalized === "NYSE ARCA") return "NYSE Arca";
  if (normalized.startsWith("OTC")) return normalized;
  return normalized || "";
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_/-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedValuesMatch(value: string, candidate: string) {
  if (!value || !candidate) return false;
  return value === candidate || value.includes(candidate) || candidate.includes(value);
}

function taxonomyTextMatchScore(value: string, candidate: string) {
  if (!value || !candidate) return 0;
  if (normalizedValuesMatch(value, candidate)) return 6;

  const valueTokens = tokenSet(value);
  const candidateTokens = tokenSet(candidate);
  if (!valueTokens.size || !candidateTokens.size) return 0;

  let overlap = 0;
  for (const token of candidateTokens) {
    if (valueTokens.has(token)) overlap += 1;
  }
  if (!overlap) return 0;

  const coverage = overlap / candidateTokens.size;
  if (coverage >= 0.75) return 5;
  if (coverage >= 0.5) return 4;
  return overlap >= 1 ? 2 : 0;
}

function tokenSet(value: string) {
  return new Set(
    value
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !taxonomyStopWords.has(token)),
  );
}

const taxonomyStopWords = new Set(["and", "the", "for", "with", "risk"]);

function normalizeTicker(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function proxyMarketCap(candidate: ProxyCandidate) {
  const value = numberValue(candidate.metadata?.fmp_market_cap);
  return Number.isFinite(value) ? value : 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(normalizeTicker).filter(Boolean)));
}

function clampScore(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value as number)));
}
