import type { DetailTone, PriceChartSeries, SectorThemeContext } from "@/app/events/[id]/detailTypes";
import type { GenericFilingAnalysisData } from "@/components/filing-analysis-v2/GenericFilingAnalysis";
import { bodyTextToSafeHtml, sanitizeNewsArticleHtml } from "@/lib/newsArticleSanitizer";
import { NEWS_ANALYSIS_V2_FIXTURE_SLUG } from "@/lib/newsAnalysisConstants";
import { fetchEventAnalysis, fetchEventById, fetchEventTickers, fetchEventsByTicker, supabaseSelect } from "@/lib/supabase";

type DbRow = Record<string, unknown>;

export type NewsAnalysisDetail = {
  eventType: string;
  filing: GenericFilingAnalysisData;
  fixture: boolean;
  originalHtml: string;
  price: string;
  priceChange: string;
  priceChangeAmount: string;
  priceSeries: PriceChartSeries | null;
  timestampLabel: "Detected" | "Published";
  marketContext: SectorThemeContext | null;
};

export async function loadNewsAnalysisDetail(id: string): Promise<NewsAnalysisDetail | null> {
  if (id === NEWS_ANALYSIS_V2_FIXTURE_SLUG) return buildNewsAnalysisFixture();

  const eventResult = await fetchEventById(id);
  const event = asRecord(eventResult.data);
  if (!event || readString(event, "source_group") !== "news") return null;

  const ticker = normalizeTicker(readString(event, "ticker"));
  const rawItemId = readString(event, "raw_item_id");
  const [analysisResult, tickersResult, rawResult, relatedNewsResult, relatedFilingsResult, quote, chart] = await Promise.all([
    fetchEventAnalysis(id),
    fetchEventTickers(id),
    fetchRawItem(rawItemId),
    ticker ? fetchEventsByTicker({ ticker, sourceGroup: "news", excludeId: id, limit: 4 }) : emptyRowsResult(),
    ticker ? fetchEventsByTicker({ ticker, sourceGroup: "filings", excludeId: id, limit: 4 }) : emptyRowsResult(),
    ticker ? fetchStoredQuote(ticker) : Promise.resolve(null),
    ticker ? fetchStoredChart(ticker) : Promise.resolve(null),
  ]);
  const analysis = asRecord(analysisResult.data);
  const rawItem = asRecord(rawResult.data);
  const rawPayload = asRecord(rawItem?.raw_payload);
  const articlePayload = asRecord(rawPayload?.article_payload);
  const metadata = asRecord(event.metadata);
  const tickerRows = toRows(tickersResult.data);
  const primaryTickerRow = tickerRows.find((row) => readString(row, "role") === "primary") ||
    tickerRows.find((row) => normalizeTicker(readString(row, "symbol")) === ticker) || null;
  const tickerMetadata = asRecord(primaryTickerRow?.metadata);
  const sourceUrl = firstString(
    readString(event, "source_url"),
    readString(rawItem, "source_url"),
    readString(rawPayload, "source_url"),
    readString(articlePayload, "source_url"),
  );
  const source = firstString(
    readString(event, "source_name"),
    readString(rawPayload, "source_name"),
    readString(articlePayload, "source_name"),
    formatStoredSourceCode(readString(event, "source_code")),
  );
  const publishedAt = firstString(
    readString(event, "published_at"),
    readString(metadata, "published_at"),
    readString(rawPayload, "published_at"),
    readString(articlePayload, "published_at"),
  );
  const detectedAt = readString(event, "detected_at");
  const company = firstString(
    readString(event, "company"),
    readString(event, "company_name"),
    readString(event, "issuer"),
    readString(metadata, "company"),
    readString(metadata, "company_name"),
    readString(metadata, "issuer"),
    readString(tickerMetadata, "company_name"),
    readString(tickerMetadata, "company"),
    readString(tickerMetadata, "name"),
    readString(tickerMetadata, "issuer"),
    readString(rawItem, "company"),
    readString(rawItem, "company_name"),
    readString(rawItem, "issuer"),
    readString(rawPayload, "company"),
    readString(rawPayload, "company_name"),
    readString(rawPayload, "issuer"),
    readString(articlePayload, "company"),
    readString(articlePayload, "company_name"),
    readString(articlePayload, "issuer"),
  );
  const exchange = firstString(
    readString(event, "exchange"),
    readString(metadata, "exchange"),
    readString(tickerMetadata, "exchange"),
    readString(rawPayload, "exchange"),
  );
  const deliveryLevel = readDeliveryLevel(event);
  const impact = readImpact(event);
  const signal = readSignal(event);
  const score = readNumber(event, "score");

  const originalStoredHtml = firstString(
    readString(rawPayload, "full_text_html"),
    readString(articlePayload, "full_text_html"),
  );
  const originalBodyText = firstString(
    readString(rawItem, "body_text"),
    readString(rawPayload, "body_text"),
    readString(articlePayload, "body_text"),
  );
  const originalHtml = sanitizeNewsArticleHtml(
    originalStoredHtml || bodyTextToSafeHtml(originalBodyText),
    sourceUrl,
  );
  const classification = readClassification(event, metadata);
  const marketContext = classification
    ? await fetchStoredMarketContext(classification)
    : null;

  return {
    eventType: readString(event, "event_type"),
    filing: {
      bearishPoints: readStringArray(analysis, "bearish_points"),
      bullishPoints: readStringArray(analysis, "bullish_points"),
      company,
      deliveryLevel,
      exchange,
      filedAt: formatDateTime(publishedAt || detectedAt),
      filingBrief: firstString(readString(event, "quick_take"), readString(metadata, "quick_take")),
      formType: "",
      impact,
      keyEvidence: readStringArray(analysis, "key_evidence"),
      recentFilings: toRows(relatedFilingsResult.data).map(mapRelatedFiling).filter(isRelatedFiling),
      relatedNews: toRows(relatedNewsResult.data).map(mapRelatedNews).filter(isRelatedNews),
      score,
      scoreRationale:
        deliveryLevel === "alert" || deliveryLevel === "feed"
          ? readString(event, "reason")
          : "",
      signal,
      source,
      sourceUrl,
      summary: readString(event, "summary"),
      ticker,
      title: readString(event, "title"),
      watchNext: readStringArray(analysis, "watch_next"),
      whyItMatters: readString(analysis, "why_it_matters"),
    },
    fixture: false,
    marketContext,
    originalHtml,
    price: formatMoney(quote?.price ?? chart?.latestPrice),
    priceChange: formatPercent(quote?.changePercent ?? chart?.changePercent),
    priceChangeAmount: formatMoneyChange(quote?.changeAmount ?? chart?.changeAmount),
    priceSeries: chart?.series || null,
    timestampLabel: publishedAt ? "Published" : "Detected",
  };
}

async function fetchRawItem(rawItemId: string) {
  if (!rawItemId) return { data: null };
  const result = await supabaseSelect("raw_items", { select: "*", id: `eq.${rawItemId}`, limit: "1" });
  return { data: toRows(result.data)[0] || null };
}

async function fetchStoredQuote(ticker: string) {
  const result = await supabaseSelect("market_quotes", {
    select: "price,change_amount,change_percent,previous_close,fetched_at",
    symbol: `eq.${ticker}`,
    order: "fetched_at.desc",
    limit: "1",
  });
  const row = toRows(result.data)[0];
  if (!row) return null;
  return {
    price: readNumber(row, "price") ?? undefined,
    changeAmount: readNumber(row, "change_amount") ?? undefined,
    changePercent: readNumber(row, "change_percent") ?? undefined,
  };
}

async function fetchStoredChart(ticker: string) {
  const result = await supabaseSelect("market_bars", {
    select: "range,provider_label,previous_close,latest_price,change_amount,change_percent,bars,fetched_at",
    symbol: `eq.${ticker}`,
    order: "fetched_at.desc",
    limit: "20",
  });
  const rows = toRows(result.data);
  const periods: PriceChartSeries["periods"] = {};
  let providerLabel = "";
  let previousClose = 0;
  let latestPrice: number | undefined;
  let changeAmount: number | undefined;
  let changePercent: number | undefined;

  for (const row of rows) {
    const range = readString(row, "range");
    if (!isPriceRange(range) || periods[range]?.length) continue;
    const points = readPricePoints(row.bars, range);
    if (!points.length) continue;
    periods[range] = points;
    providerLabel ||= readString(row, "provider_label");
    previousClose ||= readNumber(row, "previous_close") || 0;
    latestPrice ??= readNumber(row, "latest_price") ?? undefined;
    changeAmount ??= readNumber(row, "change_amount") ?? undefined;
    changePercent ??= readNumber(row, "change_percent") ?? undefined;
  }

  if (!Object.values(periods).some((points) => points?.length)) return null;
  const firstStoredPoint = Object.values(periods).find((points) => points?.length)?.[0];
  return {
    changeAmount,
    changePercent,
    latestPrice,
    series: {
      periods,
      previousClose: previousClose || firstStoredPoint?.open || firstStoredPoint?.close || 0,
      ...(providerLabel ? { providerLabel } : {}),
    },
  };
}

type Classification = { sector: string; industry: string; theme: string; subTheme: string };

async function fetchStoredMarketContext(classification: Classification): Promise<SectorThemeContext | null> {
  const ranges = ["1D", "5D", "1M"] as const;
  const results = await Promise.all(ranges.map((range) => supabaseSelect("market_group_snapshots", {
    select: "scope,group_key,group_name,change_percent,trend_points,top_movers,fetched_at",
    range: `eq.${range}`,
    order: "fetched_at.desc",
    limit: "200",
  })));
  const matched = results.map((result) => matchContextRows(toRows(result.data), classification));
  if (matched.some((item) => !item.primary)) return null;

  const periods = Object.fromEntries(matched.map((item, index) => {
    const primary = item.primary!;
    const change = readNumber(primary, "change_percent") || 0;
    return [index === 0 ? "1D" : index === 1 ? "5D" : "30D", {
      sectorChange: formatPercent(readNumber(item.sector, "change_percent") ?? undefined),
      industryChange: formatPercent(readNumber(item.industry, "change_percent") ?? undefined),
      themeChange: formatPercent(readNumber(item.theme, "change_percent") ?? undefined),
      subThemeChange: formatPercent(readNumber(item.subTheme, "change_percent") ?? undefined),
      themeScore: Math.round(Math.abs(change)),
      themeSignal: change > 0 ? "bullish" : change < 0 ? "bearish" : "neutral",
      topMovers: readTopMovers(primary),
    }];
  })) as SectorThemeContext["periods"];

  return {
    contextTitle: classification.subTheme || classification.theme || classification.industry || classification.sector,
    industry: classification.industry || undefined,
    moverGroupName: classification.subTheme || classification.theme || classification.industry || classification.sector,
    moverMode: "top_movers",
    periods,
    sector: classification.sector || undefined,
    subTheme: classification.subTheme || undefined,
    themeGroup: classification.theme || undefined,
  };
}

function matchContextRows(rows: DbRow[], classification: Classification) {
  const find = (scope: string, value: string) => value ? rows.find((row) =>
    readString(row, "scope") === scope && [readString(row, "group_key"), readString(row, "group_name")]
      .some((candidate) => normalizeLabel(candidate) === normalizeLabel(value))) || null : null;
  const sector = find("sector", classification.sector);
  const industry = find("industry_group", classification.industry);
  const theme = find("theme", classification.theme);
  const subTheme = find("sub_theme", classification.subTheme);
  return { sector, industry, theme, subTheme, primary: subTheme || theme || industry || sector };
}

function readClassification(event: DbRow, metadata: DbRow | null): Classification | null {
  const value = {
    sector: firstString(readString(event, "sector"), readString(metadata, "sector")),
    industry: firstString(readString(event, "industry_group"), readString(metadata, "industry_group")),
    theme: firstString(readString(event, "theme_group"), readString(metadata, "theme_group")),
    subTheme: firstString(readString(event, "sub_theme"), readString(metadata, "sub_theme")),
  };
  return Object.values(value).some(Boolean) ? value : null;
}

function readTopMovers(row: DbRow) {
  return Array.isArray(row.top_movers) ? row.top_movers.flatMap((value) => {
    const mover = asRecord(value);
    const symbol = normalizeTicker(readString(mover, "symbol"));
    const change = readNumber(mover, "change_percent");
    return symbol && change !== null ? [{ symbol, change: formatPercent(change) }] : [];
  }) : [];
}

function mapRelatedNews(row: DbRow) {
  return {
    age: formatDate(readString(row, "published_at") || readString(row, "detected_at")),
    eventId: readString(row, "id"),
    eventType: readString(row, "event_type"),
    source: firstString(
      readString(row, "source_name"),
      formatStoredSourceCode(readString(row, "source_code")),
    ),
    sourceUrl: readString(row, "source_url"),
    title: readString(row, "title"),
  };
}

function mapRelatedFiling(row: DbRow) {
  const metadata = asRecord(row.metadata);
  const score = readNumber(row, "score");
  return {
    eventType: readString(row, "event_type"),
    filedAt: formatDate(readString(row, "published_at") || readString(row, "detected_at")),
    form: firstString(readString(row, "form_type"), readString(metadata, "form_type")),
    id: readString(row, "id"),
    score,
    title: readString(row, "title"),
  };
}

function isRelatedNews(item: ReturnType<typeof mapRelatedNews>) { return Boolean(item.title); }
function isRelatedFiling(item: ReturnType<typeof mapRelatedFiling>) { return Boolean(item.title || item.form); }

function buildNewsAnalysisFixture(): NewsAnalysisDetail {
  const points = Array.from({ length: 48 }, (_, index) => {
    const base = 8.2 + index * 0.025 + Math.sin(index / 3) * 0.16;
    return { close: base, high: base + 0.09, low: base - 0.08, open: base - 0.03, time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(Date.UTC(2026, 6, 21, 13, 30 + index * 5))), volume: 28000 + index * 1700, vwap: base - 0.01 };
  });
  const period = (change: string, score: number): SectorThemeContext["periods"]["1D"] => ({
    industryChange: change,
    sectorChange: change,
    subThemeChange: change,
    themeChange: change,
    themeScore: score,
    themeSignal: "bullish",
    topMovers: [
      { symbol: "IPWR", change: "+7.84%", trend: [8.1, 8.3, 8.25, 8.6, 8.9, 9.05] },
      { symbol: "PWR", change: "+2.31%", trend: [401, 403, 402, 408, 410, 412] },
    ],
  });
  const sourceUrl = "https://example.com/news/ipwr-grid-storage-long-form";
  const unsafeFixtureHtml = `<article><p>This complete fixture deliberately contains a long original article, relative links, a wide table, and an oversized image so the scoped renderer can be verified without borrowing any Actual DB content.</p><p><a href="/research/grid-storage">Read the supporting research</a></p><div><table><thead><tr><th>Scenario</th><th>2026 capacity</th><th>2027 capacity</th><th>Funding status</th><th>Execution note</th></tr></thead><tbody><tr><td>Base deployment</td><td>125 MWh</td><td>310 MWh</td><td>Committed</td><td>Supplier qualification remains the gating milestone</td></tr></tbody></table></div><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" width="1800" height="900" alt="Grid storage campus fixture image" /><script>alert('removed')</script><iframe src="https://example.com"></iframe><img/src=x/onerror=alert(1)><a href="javascript:alert(1)">Unsafe link probe</a><svg onload="alert(1)"><circle /></svg><form><input autofocus onfocus="alert(1)"></form><object data="https://example.com/unsafe"></object><style>@import url("https://example.com/unsafe.css");</style><p onclick="alert('removed')">The sanitizer removes executable attributes while keeping article copy readable in both themes.</p><iframe src="https://example.com/unclosed">`;

  return {
    eventType: "contract",
    filing: {
      bearishPoints: ["Customer concentration could amplify delays.", "Working-capital needs may rise before deployments generate cash."],
      bullishPoints: ["The announced program expands contracted deployment capacity.", "A multi-year customer schedule improves revenue visibility."],
      company: "Ideal Power Fixture Company",
      deliveryLevel: "alert",
      exchange: "NASDAQ",
      filedAt: "Jul 21, 2026, 9:15 AM ET",
      filingBrief: "A signed grid-storage program expands the company's contracted deployment plan, with staged milestones extending into 2027.",
      formType: "Fixture",
      impact: "high",
      keyEvidence: ["The customer agreement covers staged deployments through 2027.", "Management tied revenue recognition to acceptance milestones.", "The release identifies supplier qualification as the next gating item."],
      recentFilings: [{ id: "generic-filing-ui-v2-complete-fixture", eventType: "Material Agreement", filedAt: "Jul 18", form: "8-K", score: 78, title: "Fixture filing: material grid-storage supply agreement" }],
      relatedNews: [{ age: "2 hours ago", eventId: "news-analysis-v2-complete-fixture", eventType: "Contract", source: "Fixture Wire", title: "Fixture companion story tracks the same deployment program" }],
      score: 88,
      scoreRationale: "The stored fixture rationale combines contract size, multi-year visibility, and execution dependencies.",
      signal: "bullish",
      source: "Fixture Wire",
      sourceUrl,
      summary: "The complete fixture models a long-form company news event with a real chart-shaped stored series, full analysis arrays, market context, related content, and a sanitized original article.",
      ticker: "IPWR",
      title: "Fixture: Ideal Power signs a multi-year grid-storage deployment program with staged customer milestones and supplier qualification requirements extending through 2027",
      watchNext: ["Supplier qualification completion.", "First customer acceptance milestone.", "Working-capital guidance for the deployment schedule."],
      whyItMatters: "The agreement may improve forward visibility, but the value depends on supplier qualification and successful customer acceptance at each stage.",
    },
    fixture: true,
    marketContext: {
      contextTitle: "Grid Storage Fixture",
      industry: "Electrical Equipment",
      moverGroupName: "Grid Storage",
      moverMode: "top_movers",
      periods: { "1D": period("+2.18%", 72), "5D": period("+5.44%", 78), "30D": period("+11.26%", 84) },
      sector: "Industrials",
      subTheme: "Grid Storage",
      themeGroup: "Power & Energy Resources",
    },
    originalHtml: sanitizeNewsArticleHtml(unsafeFixtureHtml, sourceUrl),
    price: "$9.37",
    priceChange: "+7.84%",
    priceChangeAmount: "+$0.68",
    priceSeries: { periods: { "1D": points, "5D": points, "1M": points, "3M": points, "1Y": points }, previousClose: 8.69, providerLabel: "Fixture stored bars" },
    timestampLabel: "Published",
  };
}

function readPricePoints(value: unknown, range: keyof PriceChartSeries["periods"]) {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = asRecord(entry);
    const time = firstString(readString(row, "time"), readString(row, "date"));
    const open = readNumber(row, "open");
    const high = readNumber(row, "high");
    const low = readNumber(row, "low");
    const close = readNumber(row, "close");
    if (!time || open === null || high === null || low === null || close === null) return [];
    return [{ time: formatChartPointTime(time, range), open, high, low, close, volume: readNumber(row, "volume") || 0, vwap: readNumber(row, "vwap") ?? close }];
  }) : [];
}

function readDeliveryLevel(row: DbRow) { const value = readString(row, "delivery_level"); return value === "alert" || value === "archive" || value === "feed" ? value : null; }
function readImpact(row: DbRow) { const value = readString(row, "impact"); return value === "high" || value === "medium" || value === "low" ? value : null; }
function readSignal(row: DbRow): DetailTone | null { const value = readString(row, "signal"); return value === "bullish" || value === "bearish" || value === "volatile" || value === "neutral" ? value : null; }
function isPriceRange(value: string): value is keyof PriceChartSeries["periods"] { return value === "1D" || value === "5D" || value === "1M" || value === "3M" || value === "1Y"; }
function normalizeTicker(value: string) { const ticker = value.trim().toUpperCase(); return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : ""; }
function normalizeLabel(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function formatStoredSourceCode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  const knownLabels: Record<string, string> = {
    accesswire: "Accesswire",
    businesswire: "Business Wire",
    dea: "DEA",
    doj: "DOJ",
    globe: "GlobeNewswire",
    globenewswire: "GlobeNewswire",
    nasdaq_corporate_actions: "Nasdaq Corporate Actions",
    nasdaq_trader: "Nasdaq Trader",
    newsfile: "Newsfile",
    ofac: "OFAC",
    prnewswire: "PR Newswire",
    whitehouse: "White House",
  };
  return knownLabels[normalized] || normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
function formatChartPointTime(value: string, range: keyof PriceChartSeries["periods"]) { const date = new Date(value); if (Number.isNaN(date.getTime())) return value; if (range === "1D") return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date); if (range === "5D") return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "America/New_York" }).format(date); return date.toISOString(); }
function asRecord(value: unknown): DbRow | null { return value && typeof value === "object" && !Array.isArray(value) ? value as DbRow : null; }
function toRows(value: unknown): DbRow[] { return Array.isArray(value) ? value.map(asRecord).filter((row): row is DbRow => Boolean(row)) : []; }
function readString(row: DbRow | null, key: string) { const value = row?.[key]; return typeof value === "string" ? value.trim() : ""; }
function firstString(...values: string[]) { return values.find(Boolean) || ""; }
function readNumber(row: DbRow | null, key: string) { const value = row?.[key]; const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(number) ? number : null; }
function readStringArray(row: DbRow | null, key: string) { return Array.isArray(row?.[key]) ? (row![key] as unknown[]).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []) : []; }
function formatDateTime(value: string) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone: "America/New_York", timeZoneName: "short", year: "numeric" }).format(date); }
function formatDate(value: string) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date); }
function formatMoney(value?: number) { return value === undefined || !Number.isFinite(value) ? "" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`; }
function formatMoneyChange(value?: number) { if (value === undefined || !Number.isFinite(value)) return ""; return `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`; }
function formatPercent(value?: number) { if (value === undefined || !Number.isFinite(value)) return ""; return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function emptyRowsResult() { return Promise.resolve({ ok: true, status: 200, data: [] as unknown[], error: undefined }); }
