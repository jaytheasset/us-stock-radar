import { XMLParser } from "fast-xml-parser";

const NASDAQ_TRADER_BASE_URL = "https://www.nasdaqtrader.com";
const NASDAQ_CURRENT_HEADLINES_RSS_URL = `${NASDAQ_TRADER_BASE_URL}/rss.aspx?feed=currentheadlines&categorylist=0`;

const PARSER_VERSION = "nasdaq_trader_corporate_actions_parser_v1";
const ANALYSIS_TEXT_VERSION = "nasdaq_trader_corporate_actions_analysis_text_v1";

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type RssCorporateActionItem = {
  sourceUniqueId: string;
  sourceUrl: string;
  title: string | null;
  publishedAt: string | null;
  newsCategory: string | null;
  alert: string | null;
  markets: string | null;
  descriptionHtml: string | null;
};

export type NasdaqCorporateActionTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type NasdaqCorporateActionFields = {
  company_name: string | null;
  issue: string | null;
  cusip: string | null;
  symbol: string | null;
  old_symbol: string | null;
  new_symbol: string | null;
  last_trading_date: string | null;
  marketplace_effective_date: string | null;
  marketplace_effective_date_for_suspension: string | null;
  record_date: string | null;
  payment_date: string | null;
  ex_date: string | null;
  due_bill_redemption_date: string | null;
  ratio: string | null;
  merger_consideration: string | null;
  redemption_amount: string | null;
  rights_offering_terms: string | null;
};

export type NasdaqCorporateActionParsedRawItem = {
  source_code: "nasdaq_corporate_actions";
  source_group: "news";
  source_unique_id: string | null;
  source_url: string;
  title: string | null;
  published_at: string | null;
  fetched_at: string;
  body_text: string | null;
  dedupe_key: string;
  raw_payload: Record<string, unknown>;
};

export type NasdaqCorporateActionRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: NasdaqCorporateActionParsedRawItem[];
  diagnostics: {
    parsedFromFeed: number;
    ecaItemsFromFeed: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    sourceUrl: string;
    feedStats: Array<{
      label: string;
      ok: boolean;
      status: number;
      itemCount: number;
      error?: string;
    }>;
  };
  error?: string;
};

type ParsedCorporateActionArticle = {
  title: string | null;
  bodyText: string | null;
  analysisText: string | null;
  fullTextHtml: string | null;
  fields: NasdaqCorporateActionFields;
  tableFields: Record<string, string>;
  eventFamily: string;
  tickers: NasdaqCorporateActionTickerMention[];
  resources: Array<{ label: string; url: string }>;
};

export async function fetchNasdaqCorporateActionsRawItems(
  options: FetchOptions = {},
): Promise<NasdaqCorporateActionRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const directSourceUrl = readDirectArticleUrl(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody !== false;
  const limit = directSourceUrl || sourceUniqueId ? 1 : clampNumber(options.limit ?? 10, 1, 100);
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;

  if (directSourceUrl || sourceUniqueId) {
    return fetchSingleCorporateActionArticle({
      fetchedAt,
      sourceUrl: directSourceUrl || buildCorporateActionUrl(sourceUniqueId),
      publishedAt: null,
      title: null,
      rssMetadata: null,
    });
  }

  try {
    const response = await fetch(NASDAQ_CURRENT_HEADLINES_RSS_URL, {
      cache: "no-store",
      headers: nasdaqTraderFetchHeaders(),
    });
    const xml = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: emptyDiagnostics(response.status, 0, 0),
        error: response.statusText || "Nasdaq Trader current headlines RSS request failed",
      };
    }

    const feedItems = parseNasdaqCurrentHeadlinesRssXml(xml);
    const ecaItems = feedItems
      .filter((item) => normalizeSourceUniqueId(item.sourceUniqueId).startsWith("eca"))
      .slice(0, limit);

    const items: NasdaqCorporateActionParsedRawItem[] = [];
    let articleBodiesFetched = 0;

    for (let index = 0; index < ecaItems.length; index += 1) {
      const item = ecaItems[index];
      if (includeArticleBody && index < articleBodyLimit) {
        const article = await fetchCorporateActionArticle(item.sourceUrl);
        if (article.ok && article.article.bodyText) articleBodiesFetched += 1;
        items.push(buildRawItemFromArticle({
          fetchedAt,
          sourceUrl: item.sourceUrl,
          sourceUniqueId: item.sourceUniqueId,
          title: item.title,
          publishedAt: item.publishedAt,
          rssMetadata: item,
          article: article.ok ? article.article : null,
          articleFetchError: article.ok ? null : article.error,
        }));
      } else {
        items.push(buildRawItemFromArticle({
          fetchedAt,
          sourceUrl: item.sourceUrl,
          sourceUniqueId: item.sourceUniqueId,
          title: item.title,
          publishedAt: item.publishedAt,
          rssMetadata: item,
          article: null,
          articleFetchError: null,
        }));
      }
    }

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: items.length,
      items,
      diagnostics: {
        parsedFromFeed: feedItems.length,
        ecaItemsFromFeed: ecaItems.length,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched,
        parserVersion: PARSER_VERSION,
        sourceUrl: NASDAQ_CURRENT_HEADLINES_RSS_URL,
        feedStats: [
          {
            label: "Nasdaq Trader current headlines RSS",
            ok: true,
            status: response.status,
            itemCount: feedItems.length,
          },
        ],
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: emptyDiagnostics(0, 0, 0),
      error: error instanceof Error ? error.message : "Nasdaq Trader corporate actions fetch failed",
    };
  }
}

export function parseNasdaqCurrentHeadlinesRssXml(xml: string): RssCorporateActionItem[] {
  const parser = new XMLParser({
    attributeNamePrefix: "@_",
    ignoreAttributes: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = readRecord(readRecord(parsed.rss)?.channel);
  const rawItems = toArray(channel?.item);

  return rawItems
    .map((rawItem): RssCorporateActionItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const sourceUrl = normalizeNasdaqTraderUrl(readString(item.link));
      const sourceUniqueId = readCorporateActionId(sourceUrl);
      if (!sourceUrl || !sourceUniqueId) return null;

      return {
        sourceUniqueId,
        sourceUrl,
        title: readString(item.title),
        publishedAt: parseNasdaqDate(readString(item.pubDate)),
        newsCategory: readString(item["ndaq:NewsCategory"]),
        alert: readString(item["ndaq:Alert"]),
        markets: readString(item["ndaq:Markets"]),
        descriptionHtml: readString(item.description),
      };
    })
    .filter((item): item is RssCorporateActionItem => Boolean(item));
}

export function parseNasdaqCorporateActionHtml(html: string, sourceUrl: string): ParsedCorporateActionArticle {
  const title = decodeHtml(readTitle(html) || "");
  const contentHtml = extractCorporateActionContentHtml(html);
  const fullTextHtml = sanitizeArticleHtml(contentHtml);
  const bodyText = htmlToText(contentHtml);
  const analysisText = stripCorporateActionBoilerplate(bodyText);
  const tableFields = extractTableFields(contentHtml);
  const fields = normalizeCorporateActionFields(tableFields, title, analysisText);
  const eventFamily = classifyCorporateActionEventFamily(title, analysisText, tableFields);
  const tickers = extractCorporateActionTickers(fields, title, analysisText);
  const resources = extractResourceLinks(html);

  return {
    title: title || null,
    bodyText: bodyText || null,
    analysisText: analysisText || null,
    fullTextHtml: fullTextHtml || htmlFromText(bodyText || ""),
    fields,
    tableFields,
    eventFamily,
    tickers,
    resources,
  };
}

async function fetchSingleCorporateActionArticle(options: {
  fetchedAt: string;
  sourceUrl: string;
  publishedAt: string | null;
  title: string | null;
  rssMetadata: RssCorporateActionItem | null;
}): Promise<NasdaqCorporateActionRawFetchResult> {
  const articleResult = await fetchCorporateActionArticle(options.sourceUrl);
  const item = buildRawItemFromArticle({
    fetchedAt: options.fetchedAt,
    sourceUrl: options.sourceUrl,
    sourceUniqueId: readCorporateActionId(options.sourceUrl),
    title: options.title,
    publishedAt: options.publishedAt,
    rssMetadata: options.rssMetadata,
    article: articleResult.ok ? articleResult.article : null,
    articleFetchError: articleResult.ok ? null : articleResult.error,
  });

  return {
    ok: articleResult.ok,
    status: articleResult.status,
    fetchedAt: options.fetchedAt,
    count: articleResult.ok ? 1 : 0,
    items: articleResult.ok ? [item] : [],
    diagnostics: {
      parsedFromFeed: 0,
      ecaItemsFromFeed: 0,
      articleBodiesRequested: 1,
      articleBodiesFetched: articleResult.ok && articleResult.article.bodyText ? 1 : 0,
      parserVersion: PARSER_VERSION,
      sourceUrl: options.sourceUrl,
      feedStats: [
        {
          label: "Nasdaq Trader corporate action article",
          ok: articleResult.ok,
          status: articleResult.status,
          itemCount: articleResult.ok ? 1 : 0,
          ...(articleResult.error ? { error: articleResult.error } : {}),
        },
      ],
    },
    ...(articleResult.error ? { error: articleResult.error } : {}),
  };
}

async function fetchCorporateActionArticle(sourceUrl: string) {
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: nasdaqTraderFetchHeaders(),
    });
    const html = await response.text();
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        error: response.statusText || "Nasdaq Trader corporate action page request failed",
      };
    }

    return {
      ok: true as const,
      status: response.status,
      article: parseNasdaqCorporateActionHtml(html, sourceUrl),
    };
  } catch (error) {
    return {
      ok: false as const,
      status: 0,
      error: error instanceof Error ? error.message : "Nasdaq Trader corporate action page fetch failed",
    };
  }
}

function buildRawItemFromArticle(options: {
  fetchedAt: string;
  sourceUrl: string;
  sourceUniqueId: string | null;
  title: string | null;
  publishedAt: string | null;
  rssMetadata: RssCorporateActionItem | null;
  article: ParsedCorporateActionArticle | null;
  articleFetchError: string | null;
}): NasdaqCorporateActionParsedRawItem {
  const title = options.article?.title || options.title || null;
  const sourceUniqueId = options.sourceUniqueId || readCorporateActionId(options.sourceUrl);
  const fields = options.article?.fields || emptyCorporateActionFields();
  const tickers = options.article?.tickers || extractCorporateActionTickers(fields, title, null);
  const bodyText = options.article?.bodyText || htmlToText(options.rssMetadata?.descriptionHtml || "");
  const analysisText = options.article?.analysisText || stripCorporateActionBoilerplate(bodyText);
  const fullTextHtml = options.article?.fullTextHtml || sanitizeArticleHtml(options.rssMetadata?.descriptionHtml) || htmlFromText(bodyText);
  const eventFamily = options.article?.eventFamily || classifyCorporateActionEventFamily(title, analysisText, {});
  const candidate = classifyCorporateActionCandidate(eventFamily);

  return {
    source_code: "nasdaq_corporate_actions",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: options.sourceUrl,
    title,
    published_at: options.publishedAt,
    fetched_at: options.fetchedAt,
    body_text: bodyText || null,
    dedupe_key: buildDedupeKey(sourceUniqueId, options.sourceUrl),
    raw_payload: {
      provider: "Nasdaq Trader",
      source_name: "Nasdaq Trader",
      parser_version: PARSER_VERSION,
      feed_label: "Equity Corporate Actions",
      feed_url: NASDAQ_CURRENT_HEADLINES_RSS_URL,
      news_category: options.rssMetadata?.newsCategory || "Equity Corporate Actions Alert",
      alert: options.rssMetadata?.alert || readAlertNumber(title),
      markets: options.rssMetadata?.markets || null,
      full_text_html: fullTextHtml,
      analysis_text: analysisText,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: analysisText.length,
      corporate_action: fields,
      corporate_action_table_fields: options.article?.tableFields || {},
      corporate_action_event_family: eventFamily,
      resources: options.article?.resources || [],
      tickers,
      body_tickers: tickers,
      metadata_tickers: [],
      ticker_source: "nasdaq_trader_corporate_action",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: [],
      ...(options.articleFetchError ? { article_fetch_error: options.articleFetchError } : {}),
    },
  };
}

function normalizeCorporateActionFields(
  tableFields: Record<string, string>,
  title: string | null,
  analysisText: string | null,
): NasdaqCorporateActionFields {
  const symbol = normalizeSymbol(
    readFirstField(tableFields, ["symbol", "old symbol", "current symbol"]) ||
      extractPrimarySymbolFromTitle(title) ||
      extractPrimarySymbolFromText(analysisText),
  );

  return {
    company_name:
      readFirstField(tableFields, ["company name issue", "company parent", "company", "issuer"]) ||
      extractCompanyNameFromTitle(title),
    issue: readFirstField(tableFields, ["issue", "security description"]),
    cusip: readFirstField(tableFields, ["cusip", "cusip number", "cusip #"]) || extractCusipFromText(analysisText),
    symbol,
    old_symbol: normalizeSymbol(readFirstField(tableFields, ["old symbol", "current symbol"])),
    new_symbol: normalizeSymbol(readFirstField(tableFields, ["new symbol", "new ticker symbol"])),
    last_trading_date: readFirstField(tableFields, ["last trading date"]),
    marketplace_effective_date: readFirstField(tableFields, [
      "marketplace effective date",
      "effective date",
      "nasdaq effective date",
    ]) || extractEffectiveDateFromText(analysisText),
    marketplace_effective_date_for_suspension: readFirstField(tableFields, [
      "marketplace effective date for suspension",
      "suspension date",
    ]),
    record_date: readFirstField(tableFields, ["record date"]),
    payment_date: readFirstField(tableFields, ["payment date", "distribution date"]),
    ex_date: readFirstField(tableFields, ["ex date", "ex-date"]),
    due_bill_redemption_date: readFirstField(tableFields, ["due bill redemption date"]),
    ratio: readFirstField(tableFields, [
      "ratio",
      "ratio of spin off distribution",
      "ratio of spin-off distribution",
      "exchange ratio",
      "reverse split ratio",
      "mandatory exchange",
    ]) || extractRatioFromText(analysisText),
    merger_consideration: readFirstField(tableFields, ["merger consideration", "consideration"]),
    redemption_amount: readFirstField(tableFields, ["redemption amount", "redemption price"]),
    rights_offering_terms: readFirstField(tableFields, ["rights offering terms", "subscription right", "subscription price"]),
  };
}

function extractTableFields(html: string | null) {
  const fields: Record<string, string> = {};
  if (!html) return fields;
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html))) {
    const rowHtml = rowMatch[1];
    const headerMatch = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(rowHtml);
    const valueMatch = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml);
    if (!headerMatch || !valueMatch) continue;
    const key = normalizeFieldKey(htmlToText(headerMatch[1]));
    const value = htmlToText(valueMatch[1]);
    if (key && value && !fields[key]) fields[key] = value;
  }
  return fields;
}

function extractCorporateActionContentHtml(html: string) {
  const startMatch = /<div\b(?=[^>]*\bclass=(["'])(?=[^"']*\bnewscontentbox2\b)[^"']*\1)[^>]*>/i.exec(html);
  if (!startMatch) return "";
  const start = startMatch.index;
  const stopMarkers = [
    "<!-- Begin FooterHTAEmail.html",
    "<!-- Begin FooterHTABoilerPlateEmail.html",
    "<hr",
  ];
  const stop = stopMarkers
    .map((marker) => html.indexOf(marker, start))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0];
  return html.slice(start, stop || html.length).trim();
}

function stripCorporateActionBoilerplate(bodyText: string | null) {
  if (!bodyText) return "";
  const withoutInlineBoilerplate = bodyText.replace(
    /\s*If you would like to register as a market maker\b[\s\S]*?(?:\+1\s*212\s*231\s*5100\.?|$)/gi,
    "",
  );
  const lines = withoutInlineBoilerplate
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^if you would like to register as a market maker/i.test(line))
    .filter((line) => !/^contact nasdaq/i.test(line))
    .filter((line) => !/^email alert subscriptions/i.test(line));
  return lines.join("\n").trim();
}

function classifyCorporateActionEventFamily(
  title: string | null,
  analysisText: string | null,
  tableFields: Record<string, string>,
) {
  const text = normalizeText([title, analysisText, Object.keys(tableFields).join(" ")].filter(Boolean).join("\n"));
  if (/\breverse (?:stock )?split\b|\bshare consolidation\b|\bone-for-\w+|\b\d+\s*-\s*\d+\s+reverse\b/.test(text)) {
    return "reverse_split";
  }
  if (/\bspin-?off\b|\bdistribution\b|\bwhen-issued\b/.test(text)) return "spin_off";
  if (/\bbusiness combination\b|\bspac\b/.test(text)) return "business_combination";
  if (/\bmerger\b|\bmerged?\b/.test(text)) return "merger";
  if (/\bright[s]? offering\b|\bsubscription right\b/.test(text)) return "rights_offering";
  if (/\bredemption\b|\bredeem\b/.test(text)) return "redemption";
  if (/\bsymbol\b.*\bchange\b|\bcusip\b.*\bchange\b/.test(text)) return "symbol_or_cusip_change";
  if (/\bratio\b.*\bchange\b/.test(text)) return "ratio_change";
  return "corporate_action_general";
}

function classifyCorporateActionCandidate(eventFamily: string) {
  const highSignalFamilies = new Set([
    "reverse_split",
    "business_combination",
    "merger",
    "rights_offering",
    "redemption",
    "spin_off",
  ]);
  const signals = [`corporate_action:${eventFamily}`, "official_exchange_source", "us_ticker"];

  if (highSignalFamilies.has(eventFamily)) {
    return {
      candidateClass: "company_event",
      reason: `Nasdaq Trader corporate action: ${eventFamily}.`,
      signals,
      lowValueReasons: [],
    };
  }

  return {
    candidateClass: "ticker_archive_candidate",
    reason: `Lower-priority Nasdaq Trader corporate action: ${eventFamily}.`,
    signals: [...signals, "low_value:administrative_corporate_action"],
    lowValueReasons: ["administrative_corporate_action"],
  };
}

function extractCorporateActionTickers(
  fields: NasdaqCorporateActionFields,
  title: string | null,
  analysisText: string | null,
) {
  const symbols = new Set<string>();
  [
    fields.symbol,
    fields.old_symbol,
    fields.new_symbol,
    ...extractSymbolsFromParentheses(title),
    ...extractSymbolsFromParentheses(analysisText),
    ...extractLabeledSymbolsFromText(analysisText),
    ...extractSymbolsFromTableValues(fields),
  ].forEach((symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (normalized) symbols.add(normalized);
  });

  return [...symbols].map((symbol) => ({
    exchange: "NASDAQ",
    symbol,
    raw: `NASDAQ:${symbol}`,
    usListed: true,
  }));
}

function extractSymbolsFromTableValues(fields: NasdaqCorporateActionFields) {
  return [
    fields.ratio,
    fields.merger_consideration,
    fields.rights_offering_terms,
    fields.issue,
  ]
    .filter(Boolean)
    .flatMap((value) => extractSymbolsFromParentheses(value));
}

function extractSymbolsFromParentheses(value: string | null | undefined) {
  const symbols: string[] = [];
  const pattern =
    /\(([A-Z][A-Z0-9.-]{0,9}(?:(?:\s*(?:\/|&|,|\band\b)\s*)[A-Z][A-Z0-9.-]{0,9}){0,6})\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value || ""))) {
    const parts = match[1].split(/\s*(?:\/|&|,|\band\b)\s*/i);
    const base = normalizeSymbol(parts[0]);
    for (const part of expandSymbolParts(parts)) {
      const symbol = normalizeSymbol(part);
      if (symbol) symbols.push(symbol);
    }
    if (base) symbols.push(base);
  }
  return symbols;
}

function expandSymbolParts(parts: string[]) {
  if (parts.length <= 1) return parts;
  const base = normalizeSymbol(parts[0]);
  return parts.flatMap((part, index) => {
    const normalized = normalizeSymbol(part);
    if (!normalized) return [];
    if (index > 0 && base && normalized.length <= 2) return [base + normalized];
    return [normalized];
  });
}

function extractLabeledSymbolsFromText(value: string | null | undefined) {
  const symbols: string[] = [];
  const pattern = /\bSymbol\s*:\s*(?:\/\s*)?([A-Z][A-Z0-9.-]{0,9})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value || ""))) {
    const symbol = normalizeSymbol(match[1]);
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

function extractResourceLinks(html: string) {
  const resources: Array<{ label: string; url: string }> = [];
  const resourcesMatch = /<h3\b[^>]*>\s*Resources:?\s*<\/h3>([\s\S]*?)<\/ul>/i.exec(html);
  if (!resourcesMatch) return resources;
  const linkPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(resourcesMatch[1]))) {
    const url = normalizeExternalUrl(match[2]);
    const label = htmlToText(match[3]) || "Resource";
    if (url) resources.push({ label, url });
  }
  return resources;
}

function readDirectArticleUrl(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  const url = normalizeNasdaqTraderUrl(text);
  return readCorporateActionId(url)?.startsWith("ECA") ? url : null;
}

function buildCorporateActionUrl(sourceUniqueId: string) {
  const id = sourceUniqueId.toUpperCase();
  return `${NASDAQ_TRADER_BASE_URL}/TraderNews.aspx?id=${encodeURIComponent(id)}`;
}

function readCorporateActionId(sourceUrl: string | null) {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl, NASDAQ_TRADER_BASE_URL);
    const id = url.searchParams.get("id");
    return /^ECA\d{4}-\d+$/i.test(id || "") ? String(id).toUpperCase() : null;
  } catch {
    return null;
  }
}

function readAlertNumber(title: string | null | undefined) {
  const match = /Equity Corporate Actions Alert\s+#(\d{4})\s*-\s*(\d+)/i.exec(title || "");
  return match ? `#${match[1]}-${match[2].padStart(3, "0")}` : null;
}

function readFirstField(fields: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const normalizedKey = normalizeFieldKey(key);
    if (fields[normalizedKey]) return fields[normalizedKey];
  }
  return null;
}

function normalizeFieldKey(value: string | null | undefined) {
  return String(value || "")
    .replace(/[#：:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractCompanyNameFromTitle(title: string | null | undefined) {
  const match =
    /\bfor\s+(.+?)\s+\(([A-Z][A-Z0-9./-]{0,20})\)\s*$/i.exec(title || "") ||
    /\bof\s+(.+?)\s+\(([A-Z][A-Z0-9./-]{0,20})\)\s*$/i.exec(title || "");
  return match ? match[1].trim() : null;
}

function extractPrimarySymbolFromTitle(title: string | null | undefined) {
  return extractSymbolsFromParentheses(title)[0] || null;
}

function extractPrimarySymbolFromText(value: string | null | undefined) {
  return extractSymbolsFromParentheses(value)[0] || null;
}

function extractRatioFromText(value: string | null | undefined) {
  const text = value || "";
  return (
    /\bone-for-[a-z0-9-]+\s+\([^)]*\)\s+reverse split/i.exec(text)?.[0] ||
    /\b\d+\s*[-:]\s*\d+\s+reverse split/i.exec(text)?.[0] ||
    null
  );
}

function extractCusipFromText(value: string | null | undefined) {
  const text = value || "";
  return (
    /\bCUSIP(?: number)? will change to\s+([A-Z0-9]{6,12})\b/i.exec(text)?.[1] ||
    /\bCUSIP(?:#| number)?\s*:\s*\/?\s*([A-Z0-9]{6,12})\b/i.exec(text)?.[1] ||
    null
  );
}

function extractEffectiveDateFromText(value: string | null | undefined) {
  const text = value || "";
  return (
    /\b(?:reverse stock split|reverse split|plan of arrangement)\s+will become effective(?:\s+on Nasdaq at the open of business on|\s+on)?\s+([A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}|[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)?.[1] ||
    /\btransactions will be effective on Nasdaq at the open of business on\s+([A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i.exec(text)?.[1] ||
    null
  );
}

function normalizeSymbol(value: string | null | undefined) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : null;
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (/^https?:\/\//i.test(text)) return readCorporateActionId(text)?.toLowerCase() || "";
  return text.toLowerCase();
}

function parseNasdaqDate(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `nasdaq_corporate_actions:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function emptyDiagnostics(status: number, itemCount: number, ecaCount: number): NasdaqCorporateActionRawFetchResult["diagnostics"] {
  return {
    parsedFromFeed: itemCount,
    ecaItemsFromFeed: ecaCount,
    articleBodiesRequested: 0,
    articleBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
    sourceUrl: NASDAQ_CURRENT_HEADLINES_RSS_URL,
    feedStats: [
      {
        label: "Nasdaq Trader current headlines RSS",
        ok: false,
        status,
        itemCount,
      },
    ],
  };
}

function emptyCorporateActionFields(): NasdaqCorporateActionFields {
  return {
    company_name: null,
    issue: null,
    cusip: null,
    symbol: null,
    old_symbol: null,
    new_symbol: null,
    last_trading_date: null,
    marketplace_effective_date: null,
    marketplace_effective_date_for_suspension: null,
    record_date: null,
    payment_date: null,
    ex_date: null,
    due_bill_redemption_date: null,
    ratio: null,
    merger_consideration: null,
    redemption_amount: null,
    rights_offering_terms: null,
  };
}

function sanitizeArticleHtml(html: string | null | undefined) {
  if (!html) return null;
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "")
    .trim();
}

function htmlToText(value: string | null | undefined) {
  if (!value) return "";
  const withoutScripts = value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h\d|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(withBreaks)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlFromText(value: string) {
  return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function readTitle(html: string) {
  const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return match ? htmlToText(match[1]) : null;
}

function normalizeNasdaqTraderUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), NASDAQ_TRADER_BASE_URL);
    if (!/^(?:www\.)?nasdaqtrader\.com$/i.test(url.hostname)) return null;
    url.protocol = "https:";
    url.hostname = "www.nasdaqtrader.com";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(decodeHtml(value), NASDAQ_TRADER_BASE_URL).toString();
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function nasdaqTraderFetchHeaders() {
  return {
    Accept: "application/rss+xml,application/xml,text/xml,text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 Nasdaq Trader corporate actions parser",
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
