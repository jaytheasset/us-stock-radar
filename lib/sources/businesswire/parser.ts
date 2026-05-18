import { XMLParser } from "fast-xml-parser";

const BUSINESSWIRE_BASE_URL = "https://www.businesswire.com";

const PARSER_VERSION = "businesswire_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "businesswire_analysis_text_v1";

type FetchOptions = {
  feeds?: BusinessWireFeedConfig[];
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type BusinessWireFeedConfig = {
  label: string;
  url: string;
  primary?: boolean;
};

export type BusinessWireTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type BusinessWireParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  tickers: BusinessWireTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type BusinessWireParsedRawItem = {
  source_code: "businesswire";
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

export type BusinessWireRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: BusinessWireParsedRawItem[];
  diagnostics: {
    feedCount: number;
    parsedFromFeeds: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    skippedNonEnglish: number;
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

export const BUSINESSWIRE_FEEDS: BusinessWireFeedConfig[] = [
  businessWireFeed("Earnings News", "G1QFDERJXkJeEF9YXA==", true),
  businessWireFeed("IPO News", "G1QFDERJXkJeEF9YXQ=="),
  businessWireFeed("Merger/Acquisition News", "G1QFDERJXkJeEFtRWA=="),
  businessWireFeed("Funding News", "G1QFDERJXkJeEFtRXw=="),
  businessWireFeed("Share Issue News", "G1QFDERJXkJeGVtWXA=="),
  businessWireFeed("Stock Split News", "G1QFDERJXkJeGVtWXg=="),
  businessWireFeed("Stock Sale/Buyback News", "G1QFDERJXkJeGVtWXw=="),
  businessWireFeed("Product & Service News", "G1QFDERJXkJeEFtRWw=="),
  businessWireFeed("Contract/Agreements News", "G1QFDERJXkJeEF5XWA=="),
  businessWireFeed("Dividend News", "G1QFDERJXkJeEF9ZVA=="),
  businessWireFeed("Divestiture News", "G1QFDERJXkJeGVtWXQ=="),
  businessWireFeed("Bankruptcy News", "G1QFDERJXkJeEFtRXQ=="),
  businessWireFeed("Clinical Trials", "G1QFDERJXkJeGFNXXw=="),
  businessWireFeed("SPAC", "G1QFDERJXkJaF1hWXw=="),
  businessWireFeed("Automotive News", "G1QFDERJXkJeEVlZXw=="),
  businessWireFeed("Energy News", "G1QFDERJXkJeEFpQXw=="),
  businessWireFeed("Defense News", "G1QFDERJXkJeGVpZWQ=="),
  businessWireFeed("Health News", "G1QFDERJXkJeEVlZWA=="),
  businessWireFeed("Natural Resources News", "G1QFDERJXkJeEFpQWA=="),
];

export async function fetchBusinessWireRawItems(
  options: FetchOptions = {},
): Promise<BusinessWireRawFetchResult> {
  const feeds = options.feeds?.length ? options.feeds : BUSINESSWIRE_FEEDS;
  const fetchedAt = new Date().toISOString();
  const targetSourceUniqueId = readString(options.sourceUniqueId)?.toLowerCase() || null;
  const limit = targetSourceUniqueId ? 1 : clampNumber(options.limit ?? 50, 1, 100);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const items: BusinessWireParsedRawItem[] = [];
  const seen = new Set<string>();
  const feedStats: BusinessWireRawFetchResult["diagnostics"]["feedStats"] = [];
  let skippedNonEnglish = 0;

  for (const feed of feeds) {
    if (items.length >= limit) break;

    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: businessWireFetchHeaders("rss"),
      });
      const xml = await response.text();
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.statusText || "Business Wire RSS request failed",
        });
        continue;
      }

      const parsedItems = parseBusinessWireRssXml(xml, {
        feed,
        fetchedAt,
      });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (targetSourceUniqueId && !matchesSourceUniqueId(item, targetSourceUniqueId)) continue;
        if (!isEnglishBusinessWireItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (items.length >= limit) break;
      }
      if (targetSourceUniqueId && items.length) break;
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Business Wire RSS fetch failed",
      });
    }
  }

  let articleBodiesFetched = 0;
  const hydrated: BusinessWireParsedRawItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchBusinessWireArticleHtml(item.source_url);
      if (!articleResponse.ok) {
        hydrated.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: articleResponse.error || `HTTP ${articleResponse.status}`,
            article_fetch_status: articleResponse.status,
          },
        });
        continue;
      }

      const article = parseBusinessWireArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "Article fetch failed",
        },
      });
    }
  }

  const ok = feedStats.some((feed) => feed.ok);
  return {
    ok,
    status: ok ? 200 : 0,
    fetchedAt,
    count: hydrated.length,
    items: hydrated,
    diagnostics: {
      feedCount: feeds.length,
      parsedFromFeeds: items.length,
      articleBodiesRequested: articleBodyLimit,
      articleBodiesFetched,
      parserVersion: PARSER_VERSION,
      skippedNonEnglish,
      feedStats,
    },
    error: ok ? undefined : "No Business Wire feeds could be fetched",
  };
}

function matchesSourceUniqueId(item: BusinessWireParsedRawItem, targetSourceUniqueId: string) {
  const sourceUniqueId = item.source_unique_id?.toLowerCase();
  if (sourceUniqueId === targetSourceUniqueId) return true;
  const releaseId = readReleaseId(item.source_url)?.toLowerCase();
  return Boolean(releaseId && releaseId === targetSourceUniqueId);
}

export function parseBusinessWireRssXml(
  xml: string,
  options: { feed: BusinessWireFeedConfig; fetchedAt?: string },
): BusinessWireParsedRawItem[] {
  const parser = new XMLParser({
    attributeNamePrefix: "@_",
    ignoreAttributes: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = readRecord(readRecord(parsed.rss)?.channel);
  const rawItems = toArray(channel?.item);
  const fetchedAt = options.fetchedAt || new Date().toISOString();

  return rawItems
    .map((rawItem): BusinessWireParsedRawItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const title = readString(item.title);
      const sourceUrl = normalizeBusinessWireUrl(readString(item.link));
      if (!sourceUrl) return null;

      const sourceUniqueId = readGuid(item.guid) || readReleaseId(sourceUrl);
      const description = readString(item.description);
      const imageUrl = readString(readRecord(item.enclosure)?.["@_url"]);
      const tickers = dedupeTickerMentions(extractTickerMentions(`${title || ""} ${description || ""}`));

      return {
        source_code: "businesswire" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: parseBusinessWireDate(readString(item.pubDate)),
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "Business Wire",
          parser_version: PARSER_VERSION,
          feed_label: options.feed.label,
          feed_url: options.feed.url,
          description,
          image_url: imageUrl,
          rss_guid: readGuid(item.guid),
          tickers,
          metadata_tickers: tickers,
          ticker_source: "rss_metadata_debug_only",
        },
      };
    })
    .filter((item): item is BusinessWireParsedRawItem => Boolean(item));
}

export function parseBusinessWireArticleHtml(html: string, url: string): BusinessWireParsedArticle {
  const normalizedUrl = normalizeBusinessWireUrl(url) || url;
  const jsonLd = parseArticleJsonLd(html, normalizedUrl);
  const bodyHtml = extractElementById(html, "bw-release-story");
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripBusinessWireAnalysisBoilerplate(bodyText);
  const description = readString(jsonLd?.articleBody) || readMetaContent(html, "description");
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions(
      [
        readString(jsonLd?.headline),
        description,
        readMetaContent(html, "keywords"),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return {
    url: normalizedUrl,
    title: readString(jsonLd?.headline) || readMetaContent(html, "og:title") || readMetaContent(html, "title"),
    publishedAt: parseBusinessWireDate(readString(jsonLd?.datePublished)),
    sourceName: "Business Wire",
    description,
    bodyHtml: fullTextHtml,
    bodyText,
    tickers: bodyTickers,
    rawPayload: {
      article_json_ld: jsonLd,
      canonical_url: readCanonicalUrl(html),
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

export function stripBusinessWireAnalysisBoilerplate(bodyText: string | null) {
  if (!bodyText) {
    return {
      text: null,
      removedSections: [] as Array<Record<string, unknown>>,
    };
  }

  const cut = findBoilerplateCut(bodyText);
  if (!cut) {
    return {
      text: bodyText,
      removedSections: [] as Array<Record<string, unknown>>,
    };
  }

  const keptText = bodyText.slice(0, cut.index).trim();
  const removedText = bodyText.slice(cut.index).trim();

  return {
    text: keptText || bodyText,
    removedSections: keptText
      ? [
          {
            kind: "legal_boilerplate",
            label: cut.label,
            start_index: cut.index,
            char_count: removedText.length,
            preview: removedText.slice(0, 240),
          },
        ]
      : [],
  };
}

async function fetchBusinessWireArticleHtml(sourceUrl: string) {
  const candidates = articleUrlCandidates(sourceUrl);
  const seenCandidates = new Set(candidates);
  let lastStatus = 0;
  let lastError = "";

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const response = await fetch(candidate, {
      cache: "no-store",
      redirect: "follow",
      headers: businessWireFetchHeaders("html"),
    });
    lastStatus = response.status;

    const html = await response.text();
    if (response.ok && !html.includes("__next_error__")) {
      return {
        ok: true,
        status: response.status,
        url: response.url || candidate,
        html,
      };
    }

    lastError = response.statusText || "Business Wire article request failed";
    const nextRedirectUrl = readNextRedirectUrl(html, candidate);
    if (nextRedirectUrl && !seenCandidates.has(nextRedirectUrl)) {
      seenCandidates.add(nextRedirectUrl);
      candidates.push(nextRedirectUrl);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url: sourceUrl,
    html: "",
    error: lastError,
  };
}

function mergeArticleIntoRawItem(
  item: BusinessWireParsedRawItem,
  article: BusinessWireParsedArticle,
): BusinessWireParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as BusinessWireTickerMention[])
    : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);

  return {
    ...item,
    title: article.title || item.title,
    published_at: article.publishedAt || item.published_at,
    source_url: article.url || item.source_url,
    body_text: article.bodyText,
    raw_payload: {
      ...item.raw_payload,
      source_name: article.sourceName || item.raw_payload.source_name,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      ticker_source: article.bodyText ? "article_body" : "rss_listing",
    },
  };
}

function findBoilerplateCut(bodyText: string) {
  const candidates = [
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information)[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*([A-Z][^\n]{0,120}\bForward[- ]Looking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Cautionary\s+Disclosure\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:This|The)\s+information[^\n]{0,420}(?:press|news)\s+release[^\n]{0,240}(?:may\s+contain|contains|include[s]?)\s+[^\n]{0,240}forward[- ]looking\s+statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[- ]looking\s+statements?)/i,
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
  if (index < 80) return null;
  return { index, label };
}

function businessWireFeed(label: string, rss: string, primary = false): BusinessWireFeedConfig {
  return {
    label,
    primary,
    url: `https://feed.businesswire.com/rss/home/?rss=${encodeURIComponent(rss)}`,
  };
}

function businessWireFetchHeaders(kind: "rss" | "html") {
  return {
    Accept: kind === "rss" ? "application/rss+xml,application/xml,text/xml,*/*" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 Business Wire raw parser",
  };
}

function articleUrlCandidates(sourceUrl: string) {
  const normalized = normalizeBusinessWireUrl(sourceUrl) || sourceUrl;
  const candidates = [normalized];
  const releaseId = readReleaseId(normalized);
  if (releaseId) {
    const idOnlyUrl = `${BUSINESSWIRE_BASE_URL}/news/home/${releaseId}/en`;
    if (!candidates.includes(idOnlyUrl)) candidates.push(idOnlyUrl);
  }
  const asciiSlugUrl = normalizeBusinessWireUrl(stripSlugPunctuation(normalized));
  if (asciiSlugUrl && !candidates.includes(asciiSlugUrl)) candidates.push(asciiSlugUrl);
  return candidates;
}

function readNextRedirectUrl(html: string, baseUrl: string) {
  const match = html.match(/NEXT_REDIRECT;replace;([^;]+);30[1278];/);
  const path = match?.[1]?.replace(/\\\//g, "/");
  if (!path) return null;

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

function stripSlugPunctuation(value: string) {
  try {
    const url = new URL(value, BUSINESSWIRE_BASE_URL);
    const parts = url.pathname.split("/");
    const slug = parts.at(-1) || "";
    parts[parts.length - 1] = encodeURIComponent(
      decodeURIComponent(slug)
        .replace(/[\u2018\u2019'`]/g, "")
        .replace(/[\u201C\u201D"]/g, "")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
    url.pathname = parts.join("/");
    return url.toString();
  } catch {
    return value;
  }
}

function parseArticleJsonLd(html: string, url: string): Record<string, unknown> | null {
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const parsed = safeJsonParse<Record<string, unknown>>(decodeHtml(match[1]).trim());
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const article = candidates.find((item) => {
      if (!item || typeof item !== "object") return false;
      const type = (item as Record<string, unknown>)["@type"];
      const itemUrl = readString((item as Record<string, unknown>).url) || url;
      return type === "NewsArticle" || itemUrl === url;
    });
    if (article && typeof article === "object") return article as Record<string, unknown>;
  }

  return null;
}

function extractTickerMentions(text: string): BusinessWireTickerMention[] {
  const mentions: BusinessWireTickerMention[] = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca)?|NYSEAMERICAN|AMEX|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC|TSX\s+Venture\s+Exchange|TSXV|TSX|CSE|FSE|LSE|AIM|ASX))\s*(?::|\uFF1A)\s*([A-Z][A-Z0-9.-]{0,9})\b/g;

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

function dedupeTickerMentions(tickers: BusinessWireTickerMention[]) {
  const seen = new Set<string>();
  const result: BusinessWireTickerMention[] = [];

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

function normalizeBusinessWireUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), BUSINESSWIRE_BASE_URL);
    url.protocol = "https:";
    url.hostname = "www.businesswire.com";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function readReleaseId(url: string) {
  return url.match(/\/news\/home\/(\d+)\/en/i)?.[1] || null;
}

function readGuid(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  const record = readRecord(value);
  return readString(record?.["#text"]);
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `businesswire:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function isEnglishBusinessWireItem(item: BusinessWireParsedRawItem) {
  const urlLanguage = item.source_url.match(/\/news\/home\/\d+\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1];
  if (!urlLanguage) return true;
  return urlLanguage.toLowerCase() === "en";
}

function parseBusinessWireDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = decodeHtml(value)
    .replace(/\bUT\b/i, "UTC")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
        ? normalizeArticleHref(rawValue) || rawValue
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
    .replace(/\s(?:class|id|style|onclick|onload|onerror|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|xmlns)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?(?:section|article|main|span|font)\b[^>]*>/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (match, slash: string, tag: string) => {
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

function readCanonicalUrl(html: string) {
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  return normalizeBusinessWireUrl(readAttribute(html.match(pattern)?.[0] || "", "href"));
}

function normalizeArticleHref(value: string | null | undefined) {
  if (!value) return null;
  const decoded = decodeHtml(value).trim();
  if (!decoded) return null;

  try {
    const url = new URL(decoded, BUSINESSWIRE_BASE_URL);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return decoded;
  } catch {
    return decoded;
  }
}

function readMetaContent(html: string, name: string) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property|itemprop)=["']${escapeRegExp(name)}["'][^>]*>`,
    "i",
  );
  return decodeHtml(readAttribute(html.match(pattern)?.[0] || "", "content") || "").trim() || null;
}

function readAttribute(tag: string | null | undefined, name: string) {
  if (!tag) return null;
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return decodeHtml(tag.match(pattern)?.[2] || "").trim() || null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toArray(value: unknown) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const decoded = decodeHtml(value).trim();
  return decoded || null;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    reg: "(R)",
    trade: "(TM)",
  };

  return value
    .replace(/&([a-z]+);/gi, (match, entity: string) => namedEntities[entity.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
