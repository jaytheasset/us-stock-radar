import { XMLParser } from "fast-xml-parser";

const PRNEWSWIRE_BASE_URL = "https://www.prnewswire.com";
const PRNEWSWIRE_RSS_BASE_URL = "https://www.prnewswire.com/rss";

const PARSER_VERSION = "prnewswire_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "prnewswire_analysis_text_v1";
const ARTICLE_FETCH_ATTEMPTS = 3;
const ARTICLE_FETCH_DELAY_MS = 125;

type FetchOptions = {
  feeds?: PRNewswireFeedConfig[];
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type PRNewswireFeedConfig = {
  label: string;
  url: string;
  primary?: boolean;
  kind: "event" | "sector" | "all";
  topic: string;
};

export type PRNewswireTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type PRNewswireParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  tickers: PRNewswireTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type PRNewswireParsedRawItem = {
  source_code: "prnewswire";
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

export type PRNewswireRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: PRNewswireParsedRawItem[];
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

export const PRNEWSWIRE_FEEDS: PRNewswireFeedConfig[] = [
  prNewswireFeed("Earnings", "financial-services-latest-news/earnings-list.rss", "event", true),
  prNewswireFeed("Dividends", "financial-services-latest-news/dividends-list.rss", "event"),
  prNewswireFeed("Conference Call Announcements", "financial-services-latest-news/conference-call-announcements-list.rss", "event"),
  prNewswireFeed("Acquisitions, Mergers and Takeovers", "financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss", "event"),
  prNewswireFeed("Stock Offering", "financial-services-latest-news/stock-offering-list.rss", "event"),
  prNewswireFeed("Stock Split", "financial-services-latest-news/stock-split-list.rss", "event"),
  prNewswireFeed("Business Technology", "business-technology-latest-news/business-technology-list.rss", "sector"),
  prNewswireFeed("Consumer Technology", "consumer-technology-latest-news/consumer-technology-latest-news-list.rss", "sector"),
  prNewswireFeed("Energy", "energy-latest-news/energy-latest-news-list.rss", "sector"),
  prNewswireFeed("Environment", "environment-latest-news/environment-latest-news-list.rss", "sector"),
  prNewswireFeed("Health", "health-latest-news/health-latest-news-list.rss", "sector"),
  prNewswireFeed("Heavy Industry & Manufacturing", "heavy-industry-manufacturing-latest-news/heavy-industry-manufacturing-latest-news-list.rss", "sector"),
  prNewswireFeed("Policy & Public Interest", "policy-public-interest-latest-news/policy-public-interest-latest-news-list.rss", "sector"),
  prNewswireFeed("Telecommunications", "telecommunications-latest-news/telecommunications-latest-news-list.rss", "sector"),
  prNewswireFeed("Travel", "travel-latest-news/travel-latest-news-list.rss", "sector"),
];

export async function fetchPRNewswireRawItems(
  options: FetchOptions = {},
): Promise<PRNewswireRawFetchResult> {
  const feeds = options.feeds?.length ? options.feeds : PRNEWSWIRE_FEEDS;
  const fetchedAt = new Date().toISOString();
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const limit = sourceUniqueId ? 1 : clampNumber(options.limit ?? 50, 1, 100);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const items: PRNewswireParsedRawItem[] = [];
  const seen = new Set<string>();
  const feedStats: PRNewswireRawFetchResult["diagnostics"]["feedStats"] = [];
  let skippedNonEnglish = 0;

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: prNewswireFetchHeaders("rss"),
      });
      const xml = await response.text();
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.statusText || "PR Newswire RSS request failed",
        });
        continue;
      }

      const parsedItems = parsePRNewswireRssXml(xml, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishPRNewswireItem(item)) {
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
        error: error instanceof Error ? error.message : "PR Newswire RSS fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => dateMs(b.published_at) - dateMs(a.published_at))
    .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, limit);
  let articleBodiesFetched = 0;
  const hydrated: PRNewswireParsedRawItem[] = [];

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      if (index > 0) {
        await sleep(ARTICLE_FETCH_DELAY_MS);
      }
      const articleResponse = await fetchPRNewswireArticleHtml(item.source_url);
      if (!articleResponse.ok) {
        hydrated.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: articleResponse.error || `HTTP ${articleResponse.status}`,
            article_fetch_status: articleResponse.status,
            article_fetch_attempts: articleResponse.attempts,
          },
        });
        continue;
      }

      const article = parsePRNewswireArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "Article fetch failed",
          article_fetch_attempts: ARTICLE_FETCH_ATTEMPTS,
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
    error: ok ? undefined : "No PR Newswire feeds could be fetched",
  };
}

export function parsePRNewswireRssXml(
  xml: string,
  options: { feed: PRNewswireFeedConfig; fetchedAt?: string },
): PRNewswireParsedRawItem[] {
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
    .map((rawItem): PRNewswireParsedRawItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const title = readString(item.title);
      const sourceUrl = normalizePRNewswireUrl(readString(item.link) || readGuid(item.guid));
      if (!sourceUrl) return null;

      const sourceUniqueId = readReleaseId(sourceUrl) || readGuid(item.guid);
      const descriptionHtml = readString(item.description);
      const description = textFromHtml(descriptionHtml);
      const language = readString(item["dc:language"]) || readString(readRecord(item["dc:language"])?.["#text"]);
      const contributor =
        readString(item["dc:contributor"]) || readString(readRecord(item["dc:contributor"])?.["#text"]);
      const publisher = readString(item["dc:publisher"]) || readString(readRecord(item["dc:publisher"])?.["#text"]);
      const industries = toStringArray(item["prn:industry"]);
      const subjects = [...toStringArray(item["prn:subject"]), ...toStringArray(item["dc:subject"])];
      const mediaUrl = readString(readRecord(item["media:content"])?.["@_url"]);
      const metadataTickers = dedupeTickerMentions(extractTickerMentions(`${title || ""} ${description || ""}`));
      const candidate = classifyPRNewswireCandidate({
        title,
        description,
        industries,
        subjects,
        tickers: metadataTickers,
        feedKind: options.feed.kind,
        feedTopic: options.feed.topic,
      });

      return {
        source_code: "prnewswire" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: parsePRNewswireDate(readString(item.pubDate)),
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "PR Newswire",
          parser_version: PARSER_VERSION,
          feed_label: options.feed.label,
          feed_url: options.feed.url,
          feed_kind: options.feed.kind,
          feed_topic: options.feed.topic,
          description,
          description_html: descriptionHtml,
          language,
          contributor,
          publisher,
          industries,
          subjects,
          image_url: mediaUrl,
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
    .filter((item): item is PRNewswireParsedRawItem => Boolean(item));
}

export function parsePRNewswireArticleHtml(html: string, url: string): PRNewswireParsedArticle {
  const normalizedUrl = normalizePRNewswireUrl(url) || url;
  const jsonLd = parseArticleJsonLd(html, normalizedUrl);
  const bodyHtml = extractReleaseBodyHtml(html);
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripPRNewswireAnalysisBoilerplate(bodyText);
  const description = readString(jsonLd?.description) || readMetaContent(html, "description");
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions(
      [readString(jsonLd?.headline), description, readMetaContent(html, "keywords")]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return {
    url: normalizedUrl,
    title: readString(jsonLd?.headline) || readMetaContent(html, "og:title") || readMetaContent(html, "title"),
    publishedAt: parsePRNewswireDate(readString(jsonLd?.datePublished)),
    sourceName: "PR Newswire",
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

export function stripPRNewswireAnalysisBoilerplate(bodyText: string | null) {
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

async function fetchPRNewswireArticleHtml(sourceUrl: string) {
  let lastStatus = 0;
  let lastUrl = sourceUrl;
  let lastError = "PR Newswire article request failed";

  for (let attempt = 1; attempt <= ARTICLE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {
        cache: "no-store",
        headers: prNewswireFetchHeaders("html"),
      });
      const html = await response.text();
      lastStatus = response.status;
      lastUrl = response.url || sourceUrl;
      lastError = response.statusText || lastError;

      if (response.ok && html && !looksLikeTransientPRNewswireBlock(html)) {
        return {
          ok: true,
          status: response.status,
          url: lastUrl,
          html,
          attempts: attempt,
          error: undefined,
        };
      }

      if (response.ok && html && attempt === ARTICLE_FETCH_ATTEMPTS) {
        return {
          ok: true,
          status: response.status,
          url: lastUrl,
          html,
          attempts: attempt,
          error: undefined,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "PR Newswire article request failed";
    }

    if (attempt < ARTICLE_FETCH_ATTEMPTS) {
      await sleep(ARTICLE_FETCH_DELAY_MS * attempt);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url: lastUrl,
    html: "",
    attempts: ARTICLE_FETCH_ATTEMPTS,
    error: lastError,
  };
}

function mergeArticleIntoRawItem(
  item: PRNewswireParsedRawItem,
  article: PRNewswireParsedArticle,
): PRNewswireParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as PRNewswireTickerMention[])
    : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const industries = stringArray(item.raw_payload.industries);
  const subjects = stringArray(item.raw_payload.subjects);
  const candidate = classifyPRNewswireCandidate({
    title: article.title || item.title,
    description: buildCandidateClassificationText(
      article.description,
      readString(article.rawPayload.analysis_text) || article.bodyText,
    ),
    industries,
    subjects,
    tickers,
    feedKind: readFeedKind(item.raw_payload.feed_kind),
    feedTopic: readString(item.raw_payload.feed_topic) || "unknown",
  });

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
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function looksLikeTransientPRNewswireBlock(html: string) {
  return /\b(?:access denied|temporarily unavailable|request unsuccessful|service unavailable|too many requests)\b/i.test(
    String(textFromHtml(html) || "").slice(0, 1200),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBoilerplateCut(bodyText: string) {
  const candidates = [
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Use of\s+)?(?:Cautionary|Forward[-\s]*L\s*ooking|Safe Harbor)\s+(?:Note|Statement|Statements|Information|Language)[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[-\s]*L\s*ooking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Cautionary\s+Disclosure\s+(?:Concerning|Regarding|About)\s+Forward[-\s]*L\s*ooking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(This (?:(?:press|news)\s+)?release (?:contains|includes) [^\n]{0,320}forward[-\s]*l\s*ooking\s+statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[-\s]*l\s*ooking\s+statements?)/i,
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

function prNewswireFeed(
  label: string,
  path: string,
  kind: PRNewswireFeedConfig["kind"],
  primary = false,
): PRNewswireFeedConfig {
  return {
    label,
    primary,
    kind,
    topic: path.replace(/\.rss$/i, "").split("/").pop() || label.toLowerCase(),
    url: `${PRNEWSWIRE_RSS_BASE_URL}/${path}`,
  };
}

function classifyPRNewswireCandidate({
  title,
  description,
  industries,
  subjects,
  tickers,
  feedKind,
  feedTopic,
}: {
  title: string | null;
  description: string | null;
  industries: string[];
  subjects: string[];
  tickers: PRNewswireTickerMention[];
  feedKind: PRNewswireFeedConfig["kind"];
  feedTopic: string;
}) {
  const text = normalizeFilterText([title, description].join(" "));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findLowValueReasons(text);
  const sectorImpactSignals = findSectorImpactSignals(text);
  const archiveableLowValueReasons = findArchiveableLowValueReasons(text, lowValueReasons);
  const hasMaterialCompanyEvent = hasMaterialCompanyEventSignal(text);
  const isRoutineConferenceNotice =
    lowValueReasons.includes("conference_presence") &&
    !hasSubstantiveConferenceDisclosure(text) &&
    !hasMaterialCompanyEvent &&
    !archiveableLowValueReasons.some((reason) => reason !== "conference_presence");
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...archiveableLowValueReasons.map((reason) => `archiveable_low_value:${reason}`),
    hasMaterialCompanyEvent ? "material_company_event" : "",
    isRoutineConferenceNotice ? "routine_conference_notice" : "",
    hasUsTicker ? "us_ticker" : "",
    `feed:${feedKind}`,
  ].filter(Boolean);

  if (isRoutineConferenceNotice) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM as routine conference/webinar notice without current substantive disclosure.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (hasUsTicker && hasMaterialCompanyEvent) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker with a current company event signal.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (shouldDropLowValueDespiteSectorSignals({ hasUsTicker, lowValueReasons, sectorImpactSignals })) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM because low-value PR Newswire pattern dominates weak sector signals: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (
    lowValueReasons.length > 0 &&
    archiveableLowValueReasons.length > 0 &&
    hasUsTicker &&
    sectorImpactSignals.length === 0
  ) {
    return {
      candidateClass: "ticker_archive_candidate",
      reason: `Ticker-bearing PR Newswire item marked for deterministic archive: ${archiveableLowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value PR Newswire item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (hasUsTicker || feedKind === "event") {
    return {
      candidateClass: "company_event",
      reason: hasUsTicker
        ? "U.S.-listed ticker found in PR Newswire body/listing."
        : "Event-focused PR Newswire feed item.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: sectorImpactSignals.length
      ? `Sector/theme/policy candidate from PR Newswire feed: ${sectorImpactSignals.join(", ")}`
      : "Broad PR Newswire sector feed candidate; not filtered by low-value rules.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findLowValueReasons(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["shareholder_lawsuit_ad", /\b(shareholder alert|lead plaintiff|class action|securities fraud|investor deadline|claims?filer|law firm of|investors? with losses|investigation of securities claims)\b/i],
    ["award_or_ranking", /\b(award|awards|honou?r|honou?rs|named one of|best managed|ranking|ranked|receives recognition|recognized (?:as|by|for)|medal|winner|wins?|top employer|great place to work)\b/i],
    ["local_opening", /\b(grand opening|opens? new|new showroom|new office|new location|ribbon cutting|local space|store opening|branch opening)\b/i],
    ["expert_advice", /\b(expert explains|offers guidance|tips for|how to|what are the|why does|guide for|in hellonation|thought leadership|commentary|q&a)\b/i],
    ["marketing_campaign", /\b(brand campaign|launches campaign|sweepstakes|giveaway|club offers?|limited-time offer|discount|promo(?:tional)?|influencer campaign|announces sponsorship|sponsors)\b/i],
    ["conference_presence", /\b(showcases? (?:at|the)|showcases?.{0,80}\bat\b|to present at|will present at|to participate in|will participate in|participat(?:es?|ing) in|attend(?:s|ing)?|exhibit(?:s|ing)? at|booth|webinar|salon suite|media event|trade show|investor day|analyst day|capital markets day|webcast.{0,80}presentation)\b/i],
    ["csr_or_community", /\b(charity|foundation|donation|scholarship|community event|volunteer|philanthrop|opens? community|nonprofit gala|medals of honor|pro bono)\b/i],
    ["survey_or_report_marketing", /\b(survey|poll|study finds|report reveals|white paper|market research report|customer satisfaction rating)\b/i],
    ["private_product_promo", /\b(new product line|expands?.{0,80}(?:product line|portfolio|platform|line)|unveils?.{0,80}(?:portfolio|platform|product)|product launch|available now|commercially available|consumer alert|counterfeit sellers?)\b/i],
    ["real_estate_or_tourism_promo", /\b(luxury resort|branded residences|tourism offerings|destination|hotel opening|travel enthusiasts|home remodel|property management)\b/i],
    ["personnel_or_culture", /\b(appoints?|joins? as|new ceo|new cfo|graduates?|commencement|diversity|people and culture|workforce culture)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function findArchiveableLowValueReasons(text: string, lowValueReasons: string[]) {
  const archiveable = new Set([
    "shareholder_lawsuit_ad",
    "local_opening",
    "marketing_campaign",
    "survey_or_report_marketing",
    "private_product_promo",
    "real_estate_or_tourism_promo",
  ]);
  const reasons = lowValueReasons.filter((reason) => archiveable.has(reason));

  if (lowValueReasons.includes("conference_presence") && hasSubstantiveConferenceDisclosure(text)) {
    reasons.push("conference_presence");
  }
  if (lowValueReasons.includes("personnel_or_culture") && hasCoreLeadershipChange(text)) {
    reasons.push("personnel_or_culture");
  }

  return [...new Set(reasons)];
}

function hasMaterialCompanyEventSignal(text: string) {
  return [
    /\b(?:reports?|announces?|posts?)\b.{0,120}\b(?:quarter|fiscal|q[1-4]|annual|year[- ]end)\b.{0,80}\b(?:financial results?|results?|earnings)\b/i,
    /\b(?:financial results?|earnings release date|earnings call|conference call)\b/i,
    /\b(?:monthly distribution|quarterly dividend|cash dividend|dividend increase|ex-dividend|record date|payment date)\b/i,
    /\b(?:share repurchase|stock repurchase|buyback|capital return|public offering|registered direct|private placement|stock split|reverse split)\b/i,
    /\b(?:merger|acquisition|takeover|definitive agreement|bankruptcy|restructuring|strategic alternatives)\b/i,
    /\b(?:raises guidance|raises outlook|lowers guidance|cuts guidance|reaffirms guidance|updates guidance)\b/i,
    /\b(?:clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|topline results?|primary endpoint|readout)\b/i,
    /\b(?:material contract|major contract|government contract|defense contract|supply agreement|master research agreement)\b/i,
  ].some((pattern) => pattern.test(text));
}

function shouldDropLowValueDespiteSectorSignals({
  hasUsTicker,
  lowValueReasons,
  sectorImpactSignals,
}: {
  hasUsTicker: boolean;
  lowValueReasons: string[];
  sectorImpactSignals: string[];
}) {
  if (hasUsTicker || lowValueReasons.length === 0 || sectorImpactSignals.length === 0) return false;
  if (lowValueReasons.includes("shareholder_lawsuit_ad")) return true;

  const lowValueDominant = lowValueReasons.some((reason) =>
    ["award_or_ranking", "csr_or_community", "expert_advice", "personnel_or_culture", "survey_or_report_marketing"].includes(
      reason,
    ),
  );
  if (!lowValueDominant) return false;

  const highConfidenceSignals = new Set([
    "sanctions_trade_controls",
    "public_health",
    "supply_chain_logistics",
    "energy_commodity",
    "labor_infrastructure",
    "cyber_data_risk",
    "disaster_climate",
    "defense_procurement",
    "ai_semiconductor_infrastructure",
    "clinical_regulatory_milestone",
    "healthcare_access_reimbursement",
    "financial_systemic",
  ]);

  return !sectorImpactSignals.some((signal) => highConfidenceSignals.has(signal));
}

function hasSubstantiveConferenceDisclosure(text: string) {
  return [
    /\b(clinical data|trial data|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda|breakthrough therapy|orphan drug|fast track)\b/i,
    /\b(late[- ]breaking data|topline results?|primary endpoint|readout|abstract presentation)\b/i,
    /\b(new product|product launch|platform|ai chip|semiconductor|asic|gpu|data center)\b/i,
    /\b(tactical edge|mission power|military battery|soldier system|defense technology|defen[cs]e electronics|battlefield|warfighter)\b/i,
  ].some((pattern) => pattern.test(text));
}

function hasCoreLeadershipChange(text: string) {
  const role =
    "(?:ceo|chief executive|cfo|chief financial|coo|chief operating|board|director|chair(?:man|woman)?|president)";
  const appointNearRole = new RegExp(
    `\\b(?:appoints?|names?|elects?|promotes?|hires?)\\b.{0,120}\\b${role}\\b`,
    "i",
  );
  const roleNearDeparture = new RegExp(
    `\\b${role}\\b.{0,120}\\b(?:retires?|resigns?|steps down|departure|succession)\\b`,
    "i",
  );
  return /\bnew\s+(?:ceo|cfo|coo)\b/i.test(text) || appointNearRole.test(text) || roleNearDeparture.test(text);
}

function findSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["geopolitical_security", /\b(war|military conflict|invasion|missile|drone attack|airstrike|border conflict|geopolitical|homeland security|national security|terror|weapon system)\b/i],
    ["sanctions_trade_controls", /\b(sanction|tariff|export control|import ban|trade restriction|customs duty|anti-dumping|countervailing|embargo|blacklist|entity list)\b/i],
    ["public_health", /\b(pandemic|epidemic|outbreak|virus|infectious disease|cdc|public health emergency|avian flu|h5n1|covid|vaccine shortage)\b/i],
    ["supply_chain_logistics", /\b(supply chain|shortage|disruption|port closure|shipping lane|freight|rail disruption|rail strike|truck strike|warehouse disruption|logistics bottleneck)\b/i],
    ["energy_commodity", /\b(oil price|natural gas|lng|uranium|lithium|copper|rare earth|critical minerals|commodity prices|power prices|grid reliability|electricity shortage|refinery outage)\b/i],
    ["regulatory_agency", /\b(regulation|regulatory|agency action|epa|fda|cdc|doe|dod|ftc|fcc|ferc|cftc|sec rule|antitrust|compliance deadline|rulemaking)\b/i],
    ["labor_infrastructure", /\b(strike|walkout|lockout|union action|labor dispute|infrastructure failure|bridge collapse|airport shutdown|port shutdown|plant shutdown|factory shutdown)\b/i],
    ["cyber_data_risk", /\b(cyberattack|ransomware|data breach|security breach|critical vulnerability|malware|phishing campaign|identity theft|system outage)\b/i],
    ["disaster_climate", /\b(hurricane|wildfire|flood|earthquake|tornado|drought|heatwave|winter storm|natural disaster|climate risk|evacuation)\b/i],
    ["defense_procurement", /\b(defense contract|government procurement|dod contract|navy contract|army contract|air force contract|weapons procurement|munitions|shipbuilding contract|tactical edge|mission power|military battery|soldier system|defen[cs]e electronics|battlefield|warfighter)\b/i],
    ["ai_semiconductor_infrastructure", /\b(ai chip|artificial intelligence infrastructure|semiconductor|asic|gpu|data center|advanced packaging|wafer|foundry|memory chip|chip supply)\b/i],
    ["clinical_regulatory_milestone", /\b(clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|clinical data|late[- ]breaking data|topline results?|primary endpoint|readout)\b/i],
    ["healthcare_access_reimbursement", /\b(medicare|medicaid|reimbursement|drug pricing|pbm|pharmacy benefit|hospital capacity|medical supply shortage|health insurance premium)\b/i],
    ["consumer_safety_recall", /\b(recall|contamination|safety alert|foodborne|product safety|consumer protection|defect investigation|counterfeit)\b/i],
    ["financial_systemic", /\b(bank failure|credit crunch|liquidity stress|systemic risk|debt ceiling|sovereign debt|rate shock|bond market disruption)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function normalizeFilterText(value: string) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildCandidateClassificationText(description: string | null, articleText: string | null) {
  return [description, trimArticleTextForCandidateClassification(articleText)].filter(Boolean).join("\n");
}

function trimArticleTextForCandidateClassification(value: string | null) {
  if (!value) return null;
  const cuts = [
    findClassificationCut(value, /(?:^|\n)\s*About\s+[A-Z0-9][^\n]{0,120}/i),
    findClassificationCut(value, /(?:^|\n)\s*SOURCE\s+[A-Z0-9][^\n]{0,120}/i),
  ].filter((index): index is number => typeof index === "number" && Number.isFinite(index));
  const cut = cuts.length ? Math.min(...cuts) : -1;
  return (cut > 0 ? value.slice(0, cut) : value).trim();
}

function findClassificationCut(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  if (!match || match.index < 500) return null;
  return match.index;
}

function readFeedKind(value: unknown): PRNewswireFeedConfig["kind"] {
  return value === "event" || value === "sector" || value === "all" ? value : "all";
}

function prNewswireFetchHeaders(kind: "rss" | "html") {
  return {
    Accept: kind === "rss" ? "application/rss+xml,application/xml,text/xml,*/*" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 PR Newswire raw parser",
  };
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

function extractReleaseBodyHtml(html: string) {
  const sectionPattern = /<section\b[^>]*\bclass=(["'])(?=[^"']*\brelease-body\b)[^"']*\1[^>]*>/i;
  const sectionMatch = sectionPattern.exec(html);
  if (!sectionMatch || sectionMatch.index === undefined) return null;

  const releaseBodyHtml = extractBalancedElementAt(html, sectionMatch.index, "section");
  if (!releaseBodyHtml) return null;

  const contentPattern =
    /<div\b[^>]*\bclass=(["'])(?=[^"']*\bcol-(?:sm|lg)-10\b)(?=[^"']*\bcol-(?:sm|lg)-offset-1\b)[^"']*\1[^>]*>/gi;
  const candidates: Array<{ html: string; score: number }> = [];
  let contentMatch: RegExpExecArray | null;

  while ((contentMatch = contentPattern.exec(releaseBodyHtml))) {
    const contentHtml = extractBalancedElementAt(releaseBodyHtml, contentMatch.index, "div");
    if (!contentHtml) continue;
    const text = textFromHtml(contentHtml);
    const score = scoreReleaseBodyCandidate(text || "");
    if (score <= 0) continue;
    candidates.push({ html: contentHtml, score });
  }

  if (!candidates.length) return null;

  return candidates.sort((a, b) => b.score - a.score)[0].html;
}

function scoreReleaseBodyCandidate(text: string) {
  const normalized = normalizeFilterText(text);
  if (!normalized) return -100;

  let score = normalized.length;
  if (/request a demo|more press release views with|amplify platform/i.test(normalized)) score -= 5000;
  if (/^also from this source\b/i.test(normalized)) score -= 2000;
  if (/\b\/prnewswire\/\s*--/i.test(normalized)) score += 3000;
  if (/\bsource\s+[a-z0-9]/i.test(normalized)) score += 1000;
  if (/\b(nasdaq|nyse|amex|otc(?:qb|qx)?|nyse american)\s*:/i.test(normalized)) score += 500;

  return score;
}

function extractBalancedElementAt(html: string, startIndex: number, tagName: string) {
  const tagPattern = new RegExp(`</?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;

  let depth = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(html))) {
    if (tagMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, tagPattern.lastIndex);
    } else if (!tagMatch[0].endsWith("/>")) {
      depth += 1;
    }
  }

  return null;
}

function extractTickerMentions(text: string): PRNewswireTickerMention[] {
  const mentions: PRNewswireTickerMention[] = [];
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

function dedupeTickerMentions(tickers: PRNewswireTickerMention[]) {
  const seen = new Set<string>();
  const result: PRNewswireTickerMention[] = [];

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

function normalizePRNewswireUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), PRNEWSWIRE_BASE_URL);
    url.protocol = "https:";
    url.hostname = "www.prnewswire.com";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function readReleaseId(url: string) {
  return url.match(/-(\d+)\.html$/i)?.[1] || null;
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  return value?.trim() || "";
}

function readGuid(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return normalizePRNewswireUrl(value) || value.trim() || null;
  const record = readRecord(value);
  return readString(record?.["#text"]);
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `prnewswire:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function isEnglishPRNewswireItem(item: PRNewswireParsedRawItem) {
  const language = readString(item.raw_payload.language);
  if (language) return /^en(?:-|$)/i.test(language);

  const text = `${item.title || ""} ${item.raw_payload.description || ""}`;
  if (/[äöüßàèìòùáéíóúñ¿¡]/i.test(text)) return false;
  return true;
}

function parsePRNewswireDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = decodeHtml(value)
    .replace(/\bUT\b/i, "UTC")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
    .replace(/<\/?(?:section|article|main|span|font|sup)\b[^>]*>/gi, "")
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
        "i",
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

  const withoutTrackingLinks = rewritePRNewswireTrackingLinks(cleaned);
  return withoutTrackingLinks || null;
}

function readCanonicalUrl(html: string) {
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  return normalizePRNewswireUrl(readAttribute(html.match(pattern)?.[0] || "", "href"));
}

function normalizeArticleHref(value: string | null | undefined) {
  if (!value) return null;
  let decoded = decodeHtml(value).trim();
  if (!decoded) return null;

  for (let index = 0; index < 4; index += 1) {
    const wrappedTrackingUrl = decoded.match(
      /___(https?:\/\/(?:edge\.prnewswire\.com|c212\.net)\/c\/link\/\?[\s\S]*?)___/i,
    );
    if (wrappedTrackingUrl) {
      decoded = decodeHtml(wrappedTrackingUrl[1]);
      continue;
    }

    try {
      const url = new URL(decoded, PRNEWSWIRE_BASE_URL);
      if ((url.hostname === "edge.prnewswire.com" || url.hostname === "c212.net") && url.searchParams.get("u")) {
        decoded = decodeHtml(url.searchParams.get("u") || "");
        continue;
      }
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
      return decoded;
    } catch {
      return decoded;
    }
  }

  return decoded;
}

function rewritePRNewswireTrackingLinks(value: string) {
  return value.replace(
    /\bhref=(["'])([^"']*(?:edge\.prnewswire\.com\/c\/link|c212\.net\/c\/link)[^"']*)\1/gi,
    (match, quote: string, href: string) => {
      const normalized = normalizeArticleHref(href);
      return normalized ? `href=${quote}${escapeHtmlAttribute(normalized)}${quote}` : match;
    },
  );
}

function readMetaContent(html: string, name: string) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property|itemprop|id)=["']${escapeRegExp(name)}["'][^>]*>`,
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

function toStringArray(value: unknown) {
  return toArray(value)
    .map((item) => readString(readRecord(item)?.["#text"]) || readString(item))
    .filter((item): item is string => Boolean(item));
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter((item): item is string => Boolean(item)) : [];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const decoded = decodeHtml(value).trim();
  return decoded || null;
}

function dateMs(value: string | null | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
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

  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    decoded = decoded
      .replace(/&([a-z]+);/gi, (match, entity: string) => namedEntities[entity.toLowerCase()] ?? match)
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
  }
  return decoded;
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
