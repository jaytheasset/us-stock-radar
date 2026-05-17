const GLOBE_BASE_URL = "https://www.globenewswire.com";

export const GLOBE_EXCHANGE_SEARCH_URL =
  "https://www.globenewswire.com/en/search/exchange/AMEX,Nasdaq,NYSE,OTC%2520Markets,Pink%2520Sheets,Other%2520OTC?pageSize=50";

const PARSER_VERSION = "globe_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "globe_analysis_text_v1";

type FetchOptions = {
  searchUrl?: string;
  limit?: number;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

export type GlobeTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type GlobeParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  articleSections: string[];
  tickers: GlobeTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type GlobeParsedRawItem = {
  source_code: "globe";
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

export type GlobeRemovedAnalysisSection = {
  kind: "legal_boilerplate";
  label: string;
  start_index: number;
  char_count: number;
  preview: string;
};

export type GlobeRawFetchResult = {
  ok: boolean;
  status: number;
  searchUrl: string;
  fetchedAt: string;
  count: number;
  items: GlobeParsedRawItem[];
  diagnostics: {
    parsedFromSearch: number;
    skippedNonEnglish: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
  };
  error?: string;
};

export async function fetchGlobeNewswireRawItems(
  options: FetchOptions = {},
): Promise<GlobeRawFetchResult> {
  const searchUrl = options.searchUrl || GLOBE_EXCHANGE_SEARCH_URL;
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 50, 1, 100);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;

  try {
    const response = await fetch(searchUrl, {
      cache: "no-store",
      headers: globeFetchHeaders(),
    });
    const html = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        searchUrl,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: {
          parsedFromSearch: 0,
          skippedNonEnglish: 0,
          articleBodiesRequested: 0,
          articleBodiesFetched: 0,
          parserVersion: PARSER_VERSION,
        },
        error: response.statusText || "GlobeNewswire search request failed",
      };
    }

    const parsedItems = parseGlobeNewswireSearchHtml(html, {
      searchUrl,
      fetchedAt,
    });
    const englishItems = parsedItems.filter(isEnglishGlobeNewswireItem);
    const searchItems = englishItems.slice(0, limit);

    let articleBodiesFetched = 0;
    const items: GlobeParsedRawItem[] = [];

    for (let index = 0; index < searchItems.length; index += 1) {
      const item = searchItems[index];
      if (index >= articleBodyLimit) {
        items.push(item);
        continue;
      }

      try {
        const articleResponse = await fetch(item.source_url, {
          cache: "no-store",
          headers: globeFetchHeaders(),
        });
        const articleHtml = await articleResponse.text();
        if (!articleResponse.ok) {
          items.push({
            ...item,
            raw_payload: {
              ...item.raw_payload,
              article_fetch_error: articleResponse.statusText || `HTTP ${articleResponse.status}`,
              article_fetch_status: articleResponse.status,
            },
          });
          continue;
        }

        const article = parseGlobeNewswireArticleHtml(articleHtml, item.source_url);
        articleBodiesFetched += article.bodyText ? 1 : 0;
        items.push(mergeArticleIntoRawItem(item, article));
      } catch (error) {
        items.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: error instanceof Error ? error.message : "Article fetch failed",
          },
        });
      }
    }

    return {
      ok: true,
      status: response.status,
      searchUrl,
      fetchedAt,
      count: items.length,
      items,
      diagnostics: {
        parsedFromSearch: parsedItems.length,
        skippedNonEnglish: parsedItems.length - englishItems.length,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched,
        parserVersion: PARSER_VERSION,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      searchUrl,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: {
        parsedFromSearch: 0,
        skippedNonEnglish: 0,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched: 0,
        parserVersion: PARSER_VERSION,
      },
      error: error instanceof Error ? error.message : "GlobeNewswire raw fetch failed",
    };
  }
}

function isEnglishGlobeNewswireItem(item: GlobeParsedRawItem) {
  try {
    const url = new URL(item.source_url);
    const path = url.pathname.toLowerCase();
    return path.includes("/en/");
  } catch {
    return true;
  }
}

export function parseGlobeNewswireSearchHtml(
  html: string,
  options: { searchUrl?: string; fetchedAt?: string } = {},
): GlobeParsedRawItem[] {
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const searchUrl = options.searchUrl || GLOBE_EXCHANGE_SEARCH_URL;
  const listHtml =
    extractFirst(html, /<div\s+class=["']recentNewsH["'][^>]*>([\s\S]*?)<\/ul>\s*<\/div>/i) ||
    html;
  const items: GlobeParsedRawItem[] = [];

  for (const match of listHtml.matchAll(/<li\s+class=["']row["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1] || "";
    const mainLink = block.match(
      /<div\s+class=["']mainLink["'][^>]*>\s*<a\s+([^>]+)>([\s\S]*?)<\/a>/i,
    );
    if (!mainLink) continue;

    const href = readAttribute(mainLink[1], "href");
    const sourceUrl = absolutizeGlobeUrl(href);
    if (!sourceUrl) continue;

    const title = textFromHtml(mainLink[2]);
    const dateText = textFromHtml(extractFirst(block, /<div\s+class=["']date-source["'][^>]*>([\s\S]*?)<\/div>/i));
    const publishedText = textFromHtml(extractFirst(block, /<div\s+class=["']date-source["'][^>]*>\s*<span>([\s\S]*?)<\/span>/i));
    const sourceLink = block.match(/Source:\s*<a\s+([^>]+)>([\s\S]*?)<\/a>/i);
    const sourceName = sourceLink ? textFromHtml(sourceLink[2]) : null;
    const organizationSearchUrl = sourceLink ? absolutizeGlobeUrl(readAttribute(sourceLink[1], "href")) : null;
    const teaserHtml = extractFirst(block, /<div\s+class=["']newsTxt["'][^>]*>([\s\S]*?)<\/div>/i);
    const teaser = textFromHtml(teaserHtml);
    const imageTag = extractFirst(block, /<div\s+class=["']newsImg["'][^>]*>([\s\S]*?)<\/div>/i);
    const imageUrl = absolutizeGlobeUrl(readAttribute(extractFirst(imageTag, /<img\s+([^>]+)>/i), "src"));
    const sourceUniqueId = readReleaseId(sourceUrl);
    const tickers = dedupeTickerMentions(extractTickerMentions(`${title} ${teaser}`));

    items.push({
      source_code: "globe",
      source_group: "news",
      source_unique_id: sourceUniqueId,
      source_url: sourceUrl,
      title,
      published_at: parseGlobeNewswireDate(publishedText),
      fetched_at: fetchedAt,
      body_text: null,
      dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
      raw_payload: {
        provider: "GlobeNewswire",
        parser_version: PARSER_VERSION,
        search_url: searchUrl,
        source_name: sourceName,
        source_label_text: dateText,
        organization_search_url: organizationSearchUrl,
        teaser,
        image_url: imageUrl,
        tickers,
      },
    });
  }

  return items;
}

export function parseGlobeNewswireArticleHtml(html: string, url: string): GlobeParsedArticle {
  const normalizedUrl = absolutizeGlobeUrl(url) || url;
  const jsonLd = parseArticleJsonLd(html, normalizedUrl);
  const bodyHtml = extractElementById(html, "main-body-container");
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripGlobeNewswireAnalysisBoilerplate(bodyText);
  const headline = textFromHtml(
    extractFirst(html, /<h1\s+class=["']article-headline["'][^>]*>([\s\S]*?)<\/h1>/i),
  );
  const publishedIso = readString(jsonLd?.datePublished) || readAttribute(extractFirst(html, /<time\s+([^>]+)>/i), "datetime");
  const sourceName =
    readJsonLdName(jsonLd?.sourceOrganization) ||
    readJsonLdName(jsonLd?.author) ||
    readMetaContent(html, "author");
  const description = readString(jsonLd?.description) || readMetaContent(html, "description");
  const articleSections = readStringArray(jsonLd?.articleSection);
  const metadataText = [
    ...readStringArray(jsonLd?.keywords),
    readMetaContent(html, "keywords"),
    readMetaContent(html, "ticker"),
    description,
  ]
    .filter(Boolean)
    .join(" ");
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(extractTickerMentions(metadataText));

  return {
    url: normalizedUrl,
    title: readString(jsonLd?.headline) || headline || readMetaContent(html, "title"),
    publishedAt: parseGlobeNewswireDate(publishedIso),
    sourceName,
    description,
    bodyHtml: fullTextHtml,
    bodyText,
    articleSections,
    tickers: bodyTickers,
    rawPayload: {
      article_json_ld: jsonLd,
      meta_keywords: readMetaContent(html, "keywords"),
      meta_ticker: readMetaContent(html, "ticker"),
      canonical_url: readCanonicalUrl(html),
      original_source_url: readMetaContent(html, "original-source"),
      syndication_source_url: readLinkHref(html, "syndication-source"),
      article_sections: articleSections,
      full_text_html: fullTextHtml,
      body_tickers: bodyTickers,
      metadata_tickers: metadataTickers,
      ticker_source: bodyText ? "article_body" : "none",
      analysis_text: analysisText.text,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: analysisText.text?.length || 0,
      removed_analysis_sections: analysisText.removedSections,
    },
  };
}

function mergeArticleIntoRawItem(
  item: GlobeParsedRawItem,
  article: GlobeParsedArticle,
): GlobeParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as GlobeTickerMention[])
    : [];
  const tickers = article.bodyText
    ? article.tickers
    : dedupeTickerMentions([...searchTickers, ...article.tickers]);

  return {
    ...item,
    title: article.title || item.title,
    published_at: article.publishedAt || item.published_at,
    body_text: article.bodyText,
    raw_payload: {
      ...item.raw_payload,
      source_name: article.sourceName || item.raw_payload.source_name,
      article_description: article.description,
      article_sections: article.articleSections,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      ticker_source: article.bodyText ? "article_body" : "search_listing",
    },
  };
}

export function stripGlobeNewswireAnalysisBoilerplate(bodyText: string | null) {
  if (!bodyText) {
    return {
      text: null,
      removedSections: [] as GlobeRemovedAnalysisSection[],
    };
  }

  const cut = findBoilerplateCut(bodyText);
  if (!cut) {
    return {
      text: bodyText,
      removedSections: [] as GlobeRemovedAnalysisSection[],
    };
  }

  const keptText = bodyText.slice(0, cut.index).trim();
  const removedText = bodyText.slice(cut.index).trim();

  return {
    text: keptText || bodyText,
    removedSections: keptText
      ? [
          {
            kind: "legal_boilerplate" as const,
            label: cut.label,
            start_index: cut.index,
            char_count: removedText.length,
            preview: removedText.slice(0, 240),
          },
        ]
      : [],
  };
}

function findBoilerplateCut(bodyText: string) {
  const candidates = [
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:(?:Caution|Cautionary|Special Note|Notice|Note|Disclosure)(?:\s+(?:Note|Statement|Statements))?\s+(?:Concerning|Regarding|About|On|With Respect To)\s+)?Forward[- ]Looking (?:Statements?|Information)(?:\s+(?:and|&)\s+[A-Za-z -]+)?)[ \t.:;-]*(?:\n|$)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(bodyText, /(?:^|\n)\s*(Safe Harbor Statement)\s*(?:\n|$)/i, "Safe Harbor Statement"),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(This (?:press|news) release contains forward-looking statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(This (?:press|news) release contains [^\n]{0,320}forward[- ]looking statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Certain statements in this (?:press|news) release are forward-looking statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[- ]looking statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Statements|Information) (?:contained|included) in this (?:press|news) release [^\n]{0,320}forward[- ]looking)/i,
      "Forward-Looking Statements",
    ),
  ].filter((item): item is { index: number; label: string } => Boolean(item));

  if (!candidates.length) return null;

  return candidates.sort((a, b) => a.index - b.index)[0];
}

function findPatternCut(bodyText: string, pattern: RegExp, label: string) {
  const match = pattern.exec(bodyText);
  if (!match || match.index < 0) return null;

  const matchedText = match[0] || "";
  const leadingNewlineOffset = matchedText.startsWith("\n") ? 1 : 0;
  const index = match.index + leadingNewlineOffset;

  // If the legal wording appears before any article content, keep the full text
  // so the parser does not accidentally erase a malformed or unusual release.
  if (index < 80) return null;

  return { index, label };
}

function globeFetchHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "US-Stock-Radar/0.1 GlobeNewswire raw parser",
  };
}

function extractTickerMentions(text: string): GlobeTickerMention[] {
  const mentions: GlobeTickerMention[] = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca)?|NYSEAMERICAN|AMEX|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC|TSX\s+Venture\s+Exchange|TSXV|TSX|CSE|FSE|LSE|AIM|ASX))\s*[:：]\s*([A-Z][A-Z0-9.-]{0,9})\b/g;

  for (const match of text.matchAll(pattern)) {
    const exchange = normalizeExchange(match[1]);
    const symbol = match[2].replace(/[.,;:)]+$/g, "").toUpperCase();
    if (!symbol) continue;
    mentions.push({
      exchange,
      symbol,
      raw: match[0],
      usListed: isUsExchange(exchange),
    });
  }

  return mentions;
}

function dedupeTickerMentions(tickers: GlobeTickerMention[]) {
  const seen = new Set<string>();
  const result: GlobeTickerMention[] = [];

  for (const ticker of tickers) {
    const key = `${ticker.exchange}:${ticker.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ticker);
  }

  return result;
}

function normalizeExchange(exchange: string) {
  return decodeHtml(exchange)
    .replace(/\s+/g, " ")
    .replace(/^Nasdaq$/i, "NASDAQ")
    .replace(/^NYSEAMERICAN$/i, "NYSE American")
    .replace(/^OTC PINK$/i, "OTC Pink")
    .trim();
}

function isUsExchange(exchange: string) {
  return /^(NASDAQ|NYSE|NYSE American|NYSE Arca|AMEX|OTC|OTCQB|OTCQX|OTC Pink|OTC Markets)$/i.test(
    exchange,
  );
}

function parseArticleJsonLd(html: string, url: string): Record<string, unknown> | null {
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const parsed = safeJsonParse<Record<string, unknown>>(decodeScriptJson(match[1]));
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const article = candidates.find((item) => {
      if (!item || typeof item !== "object") return false;
      const type = item["@type"];
      const itemUrl = readString(item.url) || readString(item["@id"]);
      return type === "NewsArticle" || itemUrl === url;
    });
    if (article && typeof article === "object") return article as Record<string, unknown>;
  }

  return null;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function decodeScriptJson(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/\\u0026/g, "&")
    .trim();
}

function readJsonLdName(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return readJsonLdName(value[0]);
  if (typeof value === "object" && "name" in value) return readString((value as { name?: unknown }).name);
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? decodeHtml(value).trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter((item): item is string => Boolean(item));
  }
  const single = readString(value);
  return single ? [single] : [];
}

function readMetaContent(html: string, name: string) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property|itemprop)=["']${escapeRegExp(name)}["'][^>]*>`,
    "i",
  );
  return decodeHtml(readAttribute(html.match(pattern)?.[0] || "", "content") || "").trim() || null;
}

function readCanonicalUrl(html: string) {
  return readLinkHref(html, "canonical");
}

function readLinkHref(html: string, relOrName: string) {
  const pattern = new RegExp(
    `<link\\s+[^>]*(?:rel|name)=["']${escapeRegExp(relOrName)}["'][^>]*>`,
    "i",
  );
  return absolutizeGlobeUrl(readAttribute(html.match(pattern)?.[0] || "", "href"));
}

function extractElementById(html: string, id: string) {
  const startPattern = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`, "i");
  const startMatch = startPattern.exec(html);
  if (!startMatch || startMatch.index === undefined) return null;

  const tagName = startMatch[1].toLowerCase();
  const startIndex = startMatch.index;
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;

  let depth = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(html))) {
    if (tagMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, tagPattern.lastIndex);
    } else {
      depth += 1;
    }
  }

  const providerMarker = html.indexOf("<span itemprop=\"provider\"", startIndex);
  if (providerMarker > startIndex) return html.slice(startIndex, providerMarker);

  return null;
}

function textFromHtml(value: string | null | undefined) {
  if (!value) return null;

  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeArticleHtml(value: string | null | undefined) {
  if (!value) return null;

  const withAbsoluteLinks = value.replace(
    /\s(href|src)\s*=\s*(["'])(.*?)\2/gi,
    (_match, attr: string, quote: string, rawValue: string) => {
      const absolute = attr.toLowerCase() === "href"
        ? absolutizeGlobeUrl(rawValue) || rawValue
        : rawValue;
      return ` ${attr.toLowerCase()}=${quote}${escapeHtmlAttribute(absolute)}${quote}`;
    },
  );

  const cleaned = withAbsoluteLinks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s(?:class|id|style|onclick|onload|onerror|data-[a-z0-9_-]+|aria-[a-z0-9_-]+)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?(?:section|article|main|span|font)\b[^>]*>/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (match, slash: string, tag: string, attrs: string) => {
      const tagName = tag.toLowerCase();
      const allowed = new Set([
        "a",
        "b",
        "blockquote",
        "br",
        "div",
        "em",
        "h2",
        "h3",
        "h4",
        "li",
        "ol",
        "p",
        "strong",
        "table",
        "tbody",
        "td",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
      ]);

      if (!allowed.has(tagName)) return "";
      if (slash) return `</${tagName}>`;
      if (tagName === "a") {
        const href = readAttribute(match, "href");
        return href
          ? `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noreferrer">`
          : "<a>";
      }
      return `<${tagName}>`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || null;
}

function extractFirst(value: string | null | undefined, pattern: RegExp) {
  return value?.match(pattern)?.[1] || null;
}

function readAttribute(tag: string | null | undefined, name: string) {
  if (!tag) return null;
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return decodeHtml(tag.match(pattern)?.[2] || "").trim() || null;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absolutizeGlobeUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(decodeHtml(value), GLOBE_BASE_URL).toString();
  } catch {
    return null;
  }
}

function readReleaseId(url: string) {
  return url.match(/\/news-release\/\d{4}\/\d{2}\/\d{2}\/(\d+)\//)?.[1] || null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `globe:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function parseGlobeNewswireDate(value: string | null | undefined) {
  if (!value) return null;

  const normalized = decodeHtml(value).replace(/\s+/g, " ").trim();
  const isoDate = Date.parse(normalized);
  if (Number.isFinite(isoDate)) return new Date(isoDate).toISOString();

  const match = normalized.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+ET$/i,
  );
  if (!match) return null;

  const month = monthIndex(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 0) return null;

  const offsetHours = isEasternDaylightDate(year, month, day) ? -4 : -5;
  return new Date(Date.UTC(year, month, day, hour - offsetHours, minute, 0)).toISOString();
}

function monthIndex(value: string) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months.findIndex((month) => value.toLowerCase().startsWith(month));
}

function isEasternDaylightDate(year: number, month: number, day: number) {
  if (month < 2 || month > 10) return false;
  if (month > 2 && month < 10) return true;
  const dstStartDay = nthWeekdayOfMonth(year, 2, 0, 2);
  const dstEndDay = nthWeekdayOfMonth(year, 10, 0, 1);
  if (month === 2) return day >= dstStartDay;
  return day < dstEndDay;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    sect: "§",
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => namedEntities[name.toLowerCase()] || entity);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
