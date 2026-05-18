import { XMLParser } from "fast-xml-parser";

const FDA_BASE_URL = "https://www.fda.gov";

const PARSER_VERSION = "fda_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "fda_analysis_text_v1";

type FetchOptions = {
  feeds?: FdaFeedConfig[];
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type FdaFeedConfig = {
  label: string;
  url: string;
  primary?: boolean;
  kind: "press_release" | "drugs" | "biologics" | "medwatch";
};

export type FdaTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type FdaParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  tickers: FdaTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type FdaParsedRawItem = {
  source_code: "fda";
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

export type FdaRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: FdaParsedRawItem[];
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

export const FDA_FEEDS: FdaFeedConfig[] = [
  fdaFeed(
    "Press Releases",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    "press_release",
    true,
  ),
  fdaFeed(
    "What's New: Drugs",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml",
    "drugs",
  ),
  fdaFeed(
    "What's New: Vaccines, Blood, and Biologics",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/biologics/rss.xml",
    "biologics",
  ),
  fdaFeed(
    "MedWatch Safety Alerts",
    "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml",
    "medwatch",
  ),
];

export async function fetchFdaRawItems(options: FetchOptions = {}): Promise<FdaRawFetchResult> {
  const feeds = options.feeds?.length ? options.feeds : FDA_FEEDS;
  const fetchedAt = new Date().toISOString();
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const limit = sourceUniqueId ? 1 : clampNumber(options.limit ?? 25, 1, 100);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const items: FdaParsedRawItem[] = [];
  const seen = new Set<string>();
  const feedStats: FdaRawFetchResult["diagnostics"]["feedStats"] = [];
  let skippedNonEnglish = 0;

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: fdaFetchHeaders("rss"),
      });
      const xml = await response.text();
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.statusText || "FDA RSS request failed",
        });
        continue;
      }

      const parsedItems = parseFdaRssXml(xml, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishFdaItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (sourceUniqueId && items.length >= limit) break;
      }
      if (sourceUniqueId && items.length >= limit) break;
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "FDA RSS fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => candidatePriority(b) - candidatePriority(a) || dateMs(b.published_at) - dateMs(a.published_at))
    .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, limit);
  let articleBodiesFetched = 0;
  const hydrated: FdaParsedRawItem[] = [];

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchFdaArticleHtml(item.source_url);
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

      const article = parseFdaArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "FDA article fetch failed",
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
    error: ok ? undefined : "No FDA feeds could be fetched",
  };
}

export function parseFdaRssXml(xml: string, options: { feed: FdaFeedConfig; fetchedAt?: string }): FdaParsedRawItem[] {
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
    .map((rawItem): FdaParsedRawItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const title = readString(item.title);
      const sourceUrl = normalizeFdaUrl(readString(item.link) || readGuid(item.guid));
      if (!sourceUrl) return null;

      const sourceUniqueId = readFdaId(sourceUrl) || readGuid(item.guid);
      const descriptionHtml = readString(item.description);
      const description = textFromHtml(descriptionHtml);
      const metadataTickers = dedupeTickerMentions(
        extractTickerMentions([title, description].filter(Boolean).join(" ")),
      );
      const candidate = classifyFdaCandidate({
        title,
        description,
        feedKind: options.feed.kind,
        tickers: metadataTickers,
      });

      return {
        source_code: "fda" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: parseFdaDate(readString(item.pubDate)),
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "FDA",
          source_name: "FDA",
          parser_version: PARSER_VERSION,
          feed_label: options.feed.label,
          feed_kind: options.feed.kind,
          feed_url: options.feed.url,
          description,
          description_html: descriptionHtml,
          rss_guid: readGuid(item.guid),
          tickers: metadataTickers,
          metadata_tickers: metadataTickers,
          ticker_source: "rss_metadata_debug_only",
          candidate_class: candidate.candidateClass,
          candidate_reason: candidate.reason,
          candidate_signals: candidate.signals,
          low_value_reasons: candidate.lowValueReasons,
          sector_impact_signals: candidate.sectorImpactSignals,
        },
      };
    })
    .filter((item): item is FdaParsedRawItem => Boolean(item));
}

export function parseFdaArticleHtml(html: string, url: string): FdaParsedArticle {
  const normalizedUrl = normalizeFdaUrl(url) || url;
  const mainHtml = extractFdaMainHtml(html);
  const fullTextHtml = sanitizeArticleHtml(mainHtml);
  const bodyText = mainHtml ? textFromHtml(mainHtml) : null;
  const analysisText = stripFdaAnalysisBoilerplate(bodyText);
  const title = readMetaContent(html, "og:title") || readTitleText(html);
  const description = readMetaContent(html, "description") || readMetaContent(html, "og:description");
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions([title, description, readMetaContent(html, "keywords")].filter(Boolean).join(" ")),
  );

  return {
    url: normalizedUrl,
    title,
    publishedAt: readPublishedAt(html),
    sourceName: "FDA",
    description,
    bodyHtml: fullTextHtml,
    bodyText,
    tickers: bodyTickers,
    rawPayload: {
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

export function stripFdaAnalysisBoilerplate(bodyText: string | null) {
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
            kind: "analysis_tail_or_boilerplate",
            label: cut.label,
            start_index: cut.index,
            char_count: removedText.length,
            preview: removedText.slice(0, 240),
          },
        ]
      : [],
  };
}

async function fetchFdaArticleHtml(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: fdaFetchHeaders("html"),
  });
  const html = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    url: response.url || sourceUrl,
    html: response.ok ? html : "",
    error: response.ok ? undefined : response.statusText || "FDA article request failed",
  };
}

function mergeArticleIntoRawItem(item: FdaParsedRawItem, article: FdaParsedArticle): FdaParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as FdaTickerMention[])
    : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const feedKind = readString(item.raw_payload.feed_kind) as FdaFeedConfig["kind"] | null;
  const candidate = classifyFdaCandidate({
    title: article.title || item.title,
    description: [article.description, readString(article.rawPayload.analysis_text) || article.bodyText]
      .filter(Boolean)
      .join("\n"),
    feedKind: feedKind || "press_release",
    tickers,
  });

  return {
    ...item,
    title: article.title || item.title,
    published_at: item.published_at || article.publishedAt,
    source_url: article.url || item.source_url,
    body_text: article.bodyText,
    raw_payload: {
      ...item.raw_payload,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      ticker_source: article.bodyText ? "article_body" : "rss_listing",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function classifyFdaCandidate({
  title,
  description,
  feedKind,
  tickers,
}: {
  title: string | null;
  description: string | null;
  feedKind: FdaFeedConfig["kind"];
  tickers: FdaTickerMention[];
}) {
  const text = normalizeFilterText([title, description, feedKind].filter(Boolean).join("\n"));
  const titleText = normalizeFilterText(title || "");
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findLowValueReasons(text);
  const sectorImpactSignals = findSectorImpactSignals(text, feedKind);
  const highValueAgencyAction = hasHighValueAgencyActionSignal(text, feedKind);
  const titleHighValueAgencyAction = hasHighValueAgencyActionSignal(titleText, feedKind);
  const safetyRecallAction = hasFdaSafetyRecallAction(text, feedKind);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...(highValueAgencyAction ? ["agency_action"] : []),
    ...(hasUsTicker ? ["us_ticker"] : []),
    "official_agency_source",
  ];

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in FDA item body.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !titleHighValueAgencyAction && !safetyRecallAction) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value FDA page: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length || highValueAgencyAction || feedKind === "press_release" || feedKind === "medwatch") {
    return {
      candidateClass: "sector_theme_policy_candidate",
      reason: sectorImpactSignals.length
        ? `FDA agency candidate: ${sectorImpactSignals.join(", ")}`
        : "FDA agency candidate from official FDA feed.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "low_value_filtered",
    reason: "Filtered before LLM because FDA page has no clear market-relevant agency action.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findLowValueReasons(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["data_files_or_static_database", /\b(data files?|downloadable data|database|listing includes|annual reports?|accelerated approvals|novel drug approvals|approval notifications|patent certifications|suitability petitions|potential signals of serious risks)\b/i],
    ["conference_or_training", /\b(conference|webinar|workshop|training|education|listening session|public meeting|town hall)\b/i],
    ["guidance_resource", /\b(guidance document|draft guidance|question[- ]and[- ]answer|q&a|faq|resource page|user fee amendments|medication errors related)\b/i],
    ["static_product_label_page", /\b(product approval indicated|proper name:|tradename:|stn:\s*(?:bl|bn)\b|package insert)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function hasHighValueAgencyActionSignal(text: string, feedKind: FdaFeedConfig["kind"]) {
  if (feedKind === "medwatch" && /\b(?:recall|safety alert|adverse event|contamination|defect)\b/i.test(text)) {
    return true;
  }

  return [
    /\bfda\s+(?:approves?|approved|clears?|cleared|grants?|issued?|announced?|finalizes?|launches?)\b/i,
    /\bmay be harmful\b/i,
    /\b(?:early alert|potentially high-risk device issue|medical device recalls?)\b/i,
    /\b(?:issued?|grants?)\s+(?:an?\s+)?approval\b/i,
    /\b(?:complete response letter|crl|safety alert|drug safety communication|warning letter|shortage)\b/i,
    /\b(?:breakthrough therapy|orphan drug|fast track|priority review|pdufa date|advisory committee)\b/i,
    /\b(?:voluntary|nationwide|class i|class ii)\s+recall\b/i,
  ].some((pattern) => pattern.test(text));
}

function hasFdaSafetyRecallAction(text: string, feedKind: FdaFeedConfig["kind"]) {
  const safetyPattern =
    /\b(?:early alert|potentially high-risk device issue|medical device recalls?|class\s+(?:i|ii)\s+recall|nationwide recall|voluntary recall|safety alert|drug safety communication|boxed warning|contamination|defect)\b/i;
  return safetyPattern.test(text) || (feedKind === "medwatch" && /\b(?:recall|removes?|removing|corrected?|replaced?)\b/i.test(text));
}

function findSectorImpactSignals(text: string, feedKind: FdaFeedConfig["kind"]) {
  const rules: Array<[string, RegExp]> = [
    ["fda_approval_clearance", /\b(?:approval|approves?|approved|clearance|cleared|accelerated approval|priority voucher)\b/i],
    ["fda_safety_recall", /\b(?:recall|safety alert|medwatch|adverse event|boxed warning|contamination|defect)\b/i],
    ["fda_policy_regulation", /\b(?:rule|program|policy|guidance|post-market assessment|regulatory|soliciting input)\b/i],
    ["clinical_regulatory_milestone", /\b(?:clinical trial|breakthrough therapy|orphan drug|fast track|pdufa|advisory committee)\b/i],
    ["public_health", /\b(?:outbreak|public health|infectious disease|vaccine|shortage)\b/i],
  ];
  const signals = rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
  if (feedKind === "medwatch" && !signals.includes("fda_safety_recall")) signals.push("fda_safety_recall");
  return signals;
}

function findBoilerplateCut(bodyText: string) {
  const candidates = [
    findPatternCut(bodyText, /(?:^|\n)\s*(The FDA, an agency within the U\.S\. Department of Health and Human Services\b[^\n]*)/i, "FDA boilerplate"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Media:\s*\n|Consumer:\s*\n|For (?:media|consumer|press) inquiries\b[^\n]*)/i, "FDA contact information"),
    findPatternCut(bodyText, /(?:^|\n)\s*(###)\s*(?:\n|$)/i, "FDA release terminator"),
    findPatternCut(bodyText, /(?:^|\n)\s*(Content current as of:\b[^\n]*)/i, "FDA page metadata"),
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

function extractFdaMainHtml(html: string) {
  const roleMainMatch = /<div[^>]*role=["']main["'][^>]*>/i.exec(html);
  if (roleMainMatch?.index != null) {
    const start = roleMainMatch.index;
    const end = html.indexOf("<aside", start + roleMainMatch[0].length);
    return end > start ? html.slice(start, end) : html.slice(start);
  }

  const mainMatch = /<main\b[^>]*>/i.exec(html);
  if (mainMatch?.index != null) {
    const start = mainMatch.index;
    const end = html.search(/<\/main>/i);
    return end > start ? html.slice(start, end + "</main>".length) : html.slice(start);
  }

  return "";
}

function sanitizeArticleHtml(html: string | null) {
  if (!html) return null;
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "")
    .trim();
}

function extractTickerMentions(text: string): FdaTickerMention[] {
  const mentions: FdaTickerMention[] = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca)?|NYSEAMERICAN|AMEX|Cboe|CBOE|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC))\s*(?::|\uFF1A)\s*([A-Z][A-Z0-9.-]{0,9})\b/g;

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

function dedupeTickerMentions(tickers: FdaTickerMention[]) {
  const seen = new Set<string>();
  const result: FdaTickerMention[] = [];

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
    .replace(/^Cboe$/i, "CBOE")
    .replace(/^OTC PINK$/i, "OTC Pink")
    .trim();
}

function isUsExchange(exchange: string) {
  return /^(NASDAQ|NYSE|NYSE American|NYSE Arca|AMEX|CBOE|OTC|OTCQB|OTCQX|OTC Pink|OTC Markets)$/i.test(
    exchange,
  );
}

function fdaFeed(label: string, url: string, kind: FdaFeedConfig["kind"], primary = false): FdaFeedConfig {
  return { label, url, kind, primary };
}

function fdaFetchHeaders(kind: "rss" | "html") {
  return {
    Accept: kind === "rss" ? "application/rss+xml,application/xml,text/xml,*/*" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 FDA raw parser",
  };
}

function normalizeFdaUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), FDA_BASE_URL);
    url.protocol = "https:";
    url.hostname = "www.fda.gov";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return readFdaId(text) || text;
}

function readFdaId(url: string) {
  try {
    const parsed = new URL(url, FDA_BASE_URL);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.at(-1) || null;
  } catch {
    return null;
  }
}

function readGuid(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  const record = readRecord(value);
  return readString(record?.["#text"]);
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `fda:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function isEnglishFdaItem(_item: FdaParsedRawItem) {
  return true;
}

function parseFdaDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = decodeHtml(value)
    .replace(/\bEDT\b/i, "-0400")
    .replace(/\bEST\b/i, "-0500")
    .replace(/\bCDT\b/i, "-0500")
    .replace(/\bCST\b/i, "-0600")
    .trim();
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function dateMs(value: string | null) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function candidatePriority(item: FdaParsedRawItem) {
  const candidateClass = readString(item.raw_payload.candidate_class);
  if (candidateClass === "company_event") return 4;
  if (candidateClass === "sector_theme_policy_candidate") return 3;
  if (candidateClass === "ticker_archive_candidate") return 2;
  if (candidateClass === "low_value_filtered") return 0;
  return 1;
}

function readPublishedAt(html: string) {
  const timeValue = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  return parseFdaDate(timeValue) || parseFdaDate(readMetaContent(html, "article:published_time"));
}

function readCanonicalUrl(html: string) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return normalizeFdaUrl(match?.[1]);
}

function readMetaContent(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decodeHtml(match).trim();
  }
  return null;
}

function readTitleText(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return textFromHtml(h1);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? textFromHtml(title) : null;
}

function normalizeFilterText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function textFromHtml(html: string | null | undefined) {
  if (!html) return null;
  return decodeHtml(
    html
      .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|dt|dd)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
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
