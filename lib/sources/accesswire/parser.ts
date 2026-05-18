const ACCESSWIRE_BASE_URL = "https://www.accessnewswire.com";
const ACCESSWIRE_NEWSROOM_API_URL = `${ACCESSWIRE_BASE_URL}/newsroom/api`;

const PARSER_VERSION = "accesswire_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "accesswire_analysis_text_v1";

type FetchOptions = {
  feeds?: AccesswireFeedConfig[];
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type AccesswireFeedConfig = {
  label: string;
  url: string;
  primary?: boolean;
  industry?: string;
  topic?: string;
};

export type AccesswireTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type AccesswireParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  companyName: string | null;
  topic: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  tickers: AccesswireTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type AccesswireParsedRawItem = {
  source_code: "accesswire";
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

export type AccesswireRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: AccesswireParsedRawItem[];
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

export const ACCESSWIRE_FEEDS: AccesswireFeedConfig[] = [
  accesswireFeed("All Newsroom Releases", undefined, true),
  accesswireFeed("Aerospace & Defense", "Aerospace & Defense"),
  accesswireFeed("Banking & Financial Services", "Banking & Financial Services"),
  accesswireFeed("Biotechnology", "Biotechnology"),
  accesswireFeed("Business & Professional Services", "Business & Professional Services"),
  accesswireFeed("Computers, Technology & Internet", "Computers, Technology & Internet"),
  accesswireFeed("Consumer & Retail Products", "Consumer & Retail Products"),
  accesswireFeed("Healthcare & Pharmaceutical", "Healthcare & Pharmaceutical"),
  accesswireFeed("Industrial & Manufacturing", "Industrial & Manufacturing"),
  accesswireFeed("Metals & Mining", "Metals & Mining"),
  accesswireFeed("Oil, Gas & Energy", "Oil, Gas & Energy"),
  accesswireFeed("Telecommunications", "Telecommunications"),
  accesswireFeed("Transportation", "Transportation"),
];

export async function fetchAccesswireRawItems(
  options: FetchOptions = {},
): Promise<AccesswireRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const rawSourceUniqueId = options.sourceUniqueId?.trim() || "";
  const sourceUniqueId = normalizeSourceUniqueId(rawSourceUniqueId);
  const directArticleUrl = /^https?:\/\//i.test(rawSourceUniqueId)
    ? normalizeAccesswireUrl(rawSourceUniqueId)
    : null;
  const limit = directArticleUrl || sourceUniqueId ? 1 : clampNumber(options.limit ?? 50, 1, 100);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;

  if (directArticleUrl) {
    try {
      const rawItem = await fetchAccesswireArticleRawItem(directArticleUrl, fetchedAt);
      return {
        ok: Boolean(rawItem),
        status: rawItem ? 200 : 0,
        fetchedAt,
        count: rawItem ? 1 : 0,
        items: rawItem ? [rawItem] : [],
        diagnostics: {
          feedCount: 0,
          parsedFromFeeds: rawItem ? 1 : 0,
          articleBodiesRequested: 1,
          articleBodiesFetched: rawItem?.body_text ? 1 : 0,
          parserVersion: PARSER_VERSION,
          skippedNonEnglish: 0,
          feedStats: [
            {
              label: "Direct Access Newswire article URL",
              ok: Boolean(rawItem),
              status: rawItem ? 200 : 0,
              itemCount: rawItem ? 1 : 0,
              error: rawItem ? undefined : "Direct Access Newswire article could not be parsed",
            },
          ],
        },
        error: rawItem ? undefined : "Direct Access Newswire article could not be parsed",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: {
          feedCount: 0,
          parsedFromFeeds: 0,
          articleBodiesRequested: 1,
          articleBodiesFetched: 0,
          parserVersion: PARSER_VERSION,
          skippedNonEnglish: 0,
          feedStats: [
            {
              label: "Direct Access Newswire article URL",
              ok: false,
              status: 0,
              itemCount: 0,
              error: error instanceof Error ? error.message : "Direct Access Newswire article fetch failed",
            },
          ],
        },
        error: error instanceof Error ? error.message : "Direct Access Newswire article fetch failed",
      };
    }
  }

  const feeds = options.feeds?.length ? options.feeds : ACCESSWIRE_FEEDS;
  const items: AccesswireParsedRawItem[] = [];
  const seen = new Set<string>();
  const feedStats: AccesswireRawFetchResult["diagnostics"]["feedStats"] = [];
  let skippedNonEnglish = 0;

  for (const feed of feeds) {
    if (items.length >= limit) break;

    try {
      const response = await fetchAccesswireNewsroomApi(feed, {
        pageIndex: 0,
        pageSize: Math.min(50, Math.max(limit, 20)),
      });
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.error || "Access Newswire newsroom API request failed",
        });
        continue;
      }

      const parsedItems = parseAccesswireNewsroomApi(response.data, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (sourceUniqueId && normalizeSourceUniqueId(item.source_unique_id) !== sourceUniqueId) continue;
        if (!isEnglishAccesswireItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
        if (items.length >= limit) break;
      }
      if (sourceUniqueId && items.length) break;
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Access Newswire newsroom API fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => dateMs(b.published_at) - dateMs(a.published_at))
    .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, limit);

  let articleBodiesFetched = 0;
  const hydrated: AccesswireParsedRawItem[] = [];

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchAccesswireArticleHtml(item.source_url);
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

      const article = parseAccesswireArticleHtml(articleResponse.html, articleResponse.url);
      articleBodiesFetched += article.bodyText ? 1 : 0;
      hydrated.push(mergeArticleIntoRawItem(item, article));
    } catch (error) {
      hydrated.push({
        ...item,
        raw_payload: {
          ...item.raw_payload,
          article_fetch_error: error instanceof Error ? error.message : "Access Newswire article fetch failed",
        },
      });
    }
  }

  const ok = feedStats.some((feed) => feed.ok);
  return {
    ok,
    status: ok ? 200 : firstNonZeroStatus(feedStats) || 0,
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
    error: ok
      ? undefined
      : "No Access Newswire newsroom API feeds could be fetched; use ACCESSWIRE_INGEST_URL NAS bridge if configured.",
  };
}

export function parseAccesswireNewsroomApi(
  data: unknown,
  options: { feed: AccesswireFeedConfig; fetchedAt?: string },
): AccesswireParsedRawItem[] {
  const record = readRecord(data);
  const dataRecord = readRecord(record?.data) || record;
  const articles = recordArray(dataRecord?.articles);
  const fetchedAt = options.fetchedAt || new Date().toISOString();

  return articles
    .map((rawArticle): AccesswireParsedRawItem | null => {
      const article = readRecord(rawArticle);
      if (!article) return null;
      const title = readString(article.title) || readString(article.headline);
      const sourceUrl = normalizeAccesswireUrl(
        readString(article.releaseurl) ||
          readString(article.releaseUrl) ||
          readString(article.url) ||
          readString(article.link),
      );
      if (!sourceUrl) return null;

      const sourceUniqueId =
        readString(article.id) ||
        readString(article.releaseid) ||
        readString(article.releaseId) ||
        readReleaseId(sourceUrl);
      const description = textFromHtml(readString(article.description) || readString(article.summary));
      const publishedAt = parseAccesswireDate(
        readString(article.adate) ||
          readString(article.date) ||
          readString(article.published_at) ||
          readString(article.publishedAt),
      );
      const topic = readFirstString(article.topics) || readString(article.topic) || options.feed.topic || null;
      const industry =
        readString(article.articleindustry) ||
        readString(article.industry) ||
        options.feed.industry ||
        null;
      const companyName = readString(article.company) || readString(article.author) || null;
      const metadataTickers = dedupeTickerMentions(
        extractTickerMentions([title, description, companyName].filter(Boolean).join(" ")),
      );
      const candidate = classifyAccesswireCandidate({
        title,
        description,
        tickers: metadataTickers,
        industry,
        topic,
      });

      return {
        source_code: "accesswire" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: publishedAt,
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "ACCESS Newswire",
          parser_version: PARSER_VERSION,
          feed_label: options.feed.label,
          feed_url: options.feed.url,
          industry,
          topic,
          company_name: companyName,
          description,
          newsroom_article: article,
          tickers: metadataTickers,
          metadata_tickers: metadataTickers,
          ticker_source: "newsroom_metadata_debug_only",
          candidate_class: candidate.candidateClass,
          candidate_reason: candidate.reason,
          candidate_signals: candidate.signals,
          low_value_reasons: candidate.lowValueReasons,
          sector_impact_signals: candidate.sectorImpactSignals,
        },
      };
    })
    .filter((item): item is AccesswireParsedRawItem => Boolean(item));
}

export function parseAccesswireArticleHtml(html: string, url: string): AccesswireParsedArticle {
  const normalizedUrl = normalizeAccesswireUrl(url) || url;
  const bodyHtml = extractAccesswireBodyHtml(html);
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripAccesswireAnalysisBoilerplate(bodyText);
  const title = readMetaContent(html, "og:title") || readMetaContent(html, "twitter:title") || readTitle(html);
  const description =
    readMetaContent(html, "description") ||
    readMetaContent(html, "og:description") ||
    readMetaContent(html, "twitter:description");
  const companyName =
    readMetaContent(html, "author") ||
    readMetaContent(html, "og:article:author") ||
    readSourceCompanyFromBody(bodyHtml);
  const topic = readMetaContent(html, "og:article:tag") || readTopicFromHeader(html);
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions([title, description, companyName, topic].filter(Boolean).join(" ")),
  );

  return {
    url: normalizedUrl,
    title,
    publishedAt: parseAccesswireDate(readMetaContent(html, "og:article:published_time") || readHeaderDate(html)),
    sourceName: "ACCESS Newswire",
    companyName,
    topic,
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

export function stripAccesswireAnalysisBoilerplate(bodyText: string | null) {
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

async function fetchAccesswireArticleRawItem(sourceUrl: string, fetchedAt: string) {
  const articleResponse = await fetchAccesswireArticleHtml(sourceUrl);
  if (!articleResponse.ok) {
    throw new Error(articleResponse.error || `Access Newswire article request failed: ${articleResponse.status}`);
  }
  const article = parseAccesswireArticleHtml(articleResponse.html, articleResponse.url);
  const sourceUniqueId = readReleaseId(article.url) || readReleaseId(sourceUrl);
  const candidate = classifyAccesswireCandidate({
    title: article.title,
    description: buildCandidateClassificationText(
      article.description,
      readString(article.rawPayload.analysis_text) || article.bodyText,
    ),
    tickers: article.tickers,
    industry: readIndustryFromUrl(article.url),
    topic: article.topic,
  });

  return {
    source_code: "accesswire" as const,
    source_group: "news" as const,
    source_unique_id: sourceUniqueId,
    source_url: article.url,
    title: article.title,
    published_at: article.publishedAt,
    fetched_at: fetchedAt,
    body_text: article.bodyText,
    dedupe_key: buildDedupeKey(sourceUniqueId, article.url),
    raw_payload: {
      provider: "ACCESS Newswire",
      parser_version: PARSER_VERSION,
      source_name: article.sourceName,
      company_name: article.companyName,
      topic: article.topic,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      tickers: article.tickers,
      body_tickers: article.rawPayload.body_tickers || [],
      metadata_tickers: article.rawPayload.metadata_tickers || [],
      ticker_source: article.bodyText ? "article_body" : "none",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  } satisfies AccesswireParsedRawItem;
}

async function fetchAccesswireNewsroomApi(
  feed: AccesswireFeedConfig,
  options: { pageIndex: number; pageSize: number },
) {
  const url = new URL(feed.url || ACCESSWIRE_NEWSROOM_API_URL);
  url.searchParams.set("pageindex", String(options.pageIndex));
  url.searchParams.set("pageSize", String(options.pageSize));
  if (feed.industry) url.searchParams.set("articleindustry", feed.industry);
  if (feed.topic) url.searchParams.set("topic", feed.topic);

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: accesswireFetchHeaders("api", feed),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: looksLikeCloudflareChallenge(text)
        ? "Access Newswire newsroom API returned Cloudflare challenge"
        : response.statusText || "Access Newswire newsroom API request failed",
    };
  }

  const data = safeJsonParse(text);
  return {
    ok: Boolean(data),
    status: response.status,
    data,
    error: data ? undefined : "Access Newswire newsroom API returned non-JSON response",
  };
}

async function fetchAccesswireArticleHtml(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: accesswireFetchHeaders("html"),
  });
  const html = await response.text();

  return {
    ok: response.ok && !looksLikeCloudflareChallenge(html),
    status: response.status,
    url: response.url || sourceUrl,
    html: response.ok ? html : "",
    error: response.ok
      ? looksLikeCloudflareChallenge(html)
        ? "Access Newswire article returned Cloudflare challenge"
        : undefined
      : response.statusText || "Access Newswire article request failed",
  };
}

function mergeArticleIntoRawItem(
  item: AccesswireParsedRawItem,
  article: AccesswireParsedArticle,
): AccesswireParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as AccesswireTickerMention[])
    : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const industry = readString(item.raw_payload.industry) || readIndustryFromUrl(article.url);
  const topic = article.topic || readString(item.raw_payload.topic);
  const candidate = classifyAccesswireCandidate({
    title: article.title || item.title,
    description: buildCandidateClassificationText(
      article.description || readString(item.raw_payload.description),
      readString(article.rawPayload.analysis_text) || article.bodyText,
    ),
    tickers,
    industry,
    topic,
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
      company_name: article.companyName || item.raw_payload.company_name,
      topic,
      industry,
      article_description: article.description,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: article.rawPayload.analysis_text || article.bodyText,
      analysis_text_version: article.rawPayload.analysis_text_version || ANALYSIS_TEXT_VERSION,
      removed_analysis_sections: article.rawPayload.removed_analysis_sections || [],
      search_tickers: searchTickers,
      tickers,
      ticker_source: article.bodyText ? "article_body" : "newsroom_listing",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function classifyAccesswireCandidate({
  title,
  description,
  tickers,
  industry,
  topic,
}: {
  title: string | null;
  description: string | null;
  tickers: AccesswireTickerMention[];
  industry: string | null;
  topic: string | null;
}) {
  const text = normalizeFilterText([title, description, industry, topic].filter(Boolean).join("\n"));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findLowValueReasons(text);
  const archiveableLowValueReasons = findArchiveableLowValueReasons(text, lowValueReasons);
  const materialCompanyEvent = hasMaterialCompanyEventSignal(text);
  const sectorImpactSignals = findSectorImpactSignals(text);
  const broadUsTransmission = hasBroadUsMarketTransmission(text, sectorImpactSignals);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...archiveableLowValueReasons.map((reason) => `archiveable_low_value:${reason}`),
    materialCompanyEvent ? "material_company_event" : "",
    hasUsTicker ? "us_ticker" : "",
  ].filter(Boolean);

  if (hasUsTicker && materialCompanyEvent) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker with a current company event signal.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (
    lowValueReasons.length > 0 &&
    archiveableLowValueReasons.length > 0 &&
    hasUsTicker &&
    !materialCompanyEvent &&
    sectorImpactSignals.length === 0
  ) {
    return {
      candidateClass: "ticker_archive_candidate",
      reason: `Ticker-bearing Access Newswire item marked for deterministic archive: ${archiveableLowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !materialCompanyEvent && !(hasUsTicker && sectorImpactSignals.length > 0)) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value Access Newswire item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in Access Newswire release body/listing.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (!broadUsTransmission) {
    return {
      candidateClass: "low_value_filtered",
      reason:
        "Filtered before LLM because Access Newswire item has no U.S.-listed ticker or clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: sectorImpactSignals.length
      ? `Sector/theme/policy candidate from Access Newswire feed: ${sectorImpactSignals.join(", ")}`
      : "Broad Access Newswire sector candidate; not filtered by low-value rules.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findLowValueReasons(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["advertorial_or_affiliate", /\b(advertorial|affiliate links?|commission may be earned|sponsored content)\b/i],
    ["shareholder_lawsuit_ad", /\b(shareholder alert|lead plaintiff|class action|securities fraud|investor deadline|law firm|investigates?|investors? with losses|lost money on)\b/i],
    ["award_or_ranking", /\b(award|awards|honou?r|honou?rs|ranking|ranked|recognition|winner|wins?|top employer)\b/i],
    ["local_opening", /\b(grand opening|opens? new|new showroom|new office|new location|ribbon cutting|store opening|branch opening)\b/i],
    ["expert_advice", /\b(expert explains|offers guidance|tips for|how to|what are the|why does|thought leadership|commentary|q&a)\b/i],
    ["marketing_campaign", /\b(brand campaign|launches campaign|sweepstakes|giveaway|limited-time offer|discount|promo(?:tional)?|announces sponsorship|sponsors)\b/i],
    ["conference_presence", /\b(to present at|will present at|to participate in|will participate in|attend(?:s|ing)?|exhibit(?:s|ing)? at|booth|webinar|investor day|analyst day|capital markets day|webcast.{0,80}presentation)\b/i],
    ["csr_or_community", /\b(charity|foundation|donation|scholarship|community event|volunteer|philanthrop|nonprofit|pro bono)\b/i],
    ["survey_or_report_marketing", /\b(survey|poll|study finds|report reveals|white paper|market research report|customer satisfaction rating)\b/i],
    ["third_party_research_coverage", /\b(?:initiates?|starts?|launches?)\s+coverage\b|\bresearch (?:coverage|report)\b|\banalyst report\b/i],
    ["private_product_promo", /\b(new product line|expands?.{0,80}(?:product line|portfolio|platform|line)|unveils?.{0,80}(?:portfolio|platform|product)|product launch|available now|commercially available|consumer alert)\b/i],
    ["real_estate_or_tourism_promo", /\b(luxury resort|branded residences|tourism offerings|destination|hotel opening|travel enthusiasts)\b/i],
    ["personnel_or_culture", /\b(appoints?|joins? as|new ceo|new cfo|graduates?|commencement|diversity|people and culture|workforce culture)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function findArchiveableLowValueReasons(text: string, lowValueReasons: string[]) {
  const archiveable = new Set([
    "shareholder_lawsuit_ad",
    "local_opening",
    "marketing_campaign",
    "third_party_research_coverage",
    "survey_or_report_marketing",
    "private_product_promo",
    "real_estate_or_tourism_promo",
  ]);
  const reasons = lowValueReasons.filter((reason) => archiveable.has(reason));
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
    /\b(?:share repurchase|stock repurchase|buyback|capital return|public offering|registered direct|private placement|stock split|reverse split|share issuance)\b/i,
    /\b(?:merger|acquisition|takeover|definitive agreement|bankruptcy|restructuring|strategic alternatives|joint venture)\b/i,
    /\b(?:raises guidance|raises outlook|lowers guidance|cuts guidance|reaffirms guidance|updates guidance|reiterates guidance)\b/i,
    /\b(?:clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|topline results?|primary endpoint|readout)\b/i,
    /\b(?:material contract|major contract|government contract|defense contract|supply agreement|master research agreement|grant milestones?)\b/i,
  ].some((pattern) => pattern.test(text));
}

function findSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["geopolitical_security", /\b(war|military conflict|invasion|missile|drone attack|airstrike|border conflict|geopolitical|national security|terror|weapon system)\b/i],
    ["sanctions_trade_controls", /\b(sanction|tariff|export control|import ban|trade restriction|customs duty|anti-dumping|countervailing|embargo|blacklist|entity list)\b/i],
    ["public_health", /\b(pandemic|epidemic|outbreak|virus|infectious disease|cdc|public health emergency|avian flu|h5n1|covid|vaccine shortage)\b/i],
    ["supply_chain_logistics", /\b(supply chain|shortage|disruption|port closure|shipping lane|freight|rail disruption|rail strike|truck strike|warehouse disruption|logistics bottleneck)\b/i],
    ["energy_commodity", /\b(oil price|natural gas|lng|uranium|lithium|copper|rare earth|critical minerals|commodity prices|power prices|grid reliability|electricity shortage|refinery outage|antimony|tungsten)\b/i],
    ["regulatory_agency", /\b(regulation|regulatory|agency action|epa|fda|cdc|doe|dod|department of war|dla|ftc|fcc|ferc|cftc|sec rule|antitrust|compliance deadline|rulemaking)\b/i],
    ["labor_infrastructure", /\b(strike|walkout|lockout|union action|labor dispute|infrastructure failure|bridge collapse|airport shutdown|port shutdown|plant shutdown|factory shutdown)\b/i],
    ["cyber_data_risk", /\b(cyberattack|ransomware|data breach|security breach|critical vulnerability|malware|phishing campaign|identity theft|system outage)\b/i],
    ["disaster_climate", /\b(hurricane|wildfire|flood|earthquake|tornado|drought|heatwave|winter storm|natural disaster|climate risk|evacuation)\b/i],
    ["defense_procurement", /\b(defense contract|government procurement|dod contract|department of war|dla contract|navy contract|army contract|air force contract|weapons procurement|munitions|shipbuilding contract)\b/i],
    ["ai_semiconductor_infrastructure", /\b(ai chip|artificial intelligence infrastructure|semiconductor|asic|gpu|data center|advanced packaging|wafer|foundry|memory chip|chip supply|hpc|compute capacity|ai infrastructure)\b/i],
    ["clinical_regulatory_milestone", /\b(clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|clinical data|late[- ]breaking data|topline results?|primary endpoint|readout)\b/i],
    ["healthcare_access_reimbursement", /\b(medicare|medicaid|reimbursement|drug pricing|pbm|pharmacy benefit|hospital capacity|medical supply shortage|health insurance premium)\b/i],
    ["financial_systemic", /\b(bank failure|credit crunch|liquidity stress|systemic risk|debt ceiling|sovereign debt|rate shock|bond market disruption)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function hasBroadUsMarketTransmission(text: string, sectorImpactSignals: string[]) {
  if (!sectorImpactSignals.length) return false;
  if (/\b(united states|u\.s\.|us market|nasdaq|nyse|otc|american depositary|adr|department of war|dla)\b/i.test(text)) {
    return true;
  }

  return sectorImpactSignals.some((signal) =>
    [
      "sanctions_trade_controls",
      "energy_commodity",
      "supply_chain_logistics",
      "financial_systemic",
      "geopolitical_security",
      "public_health",
      "ai_semiconductor_infrastructure",
      "defense_procurement",
    ].includes(signal),
  );
}

function hasCoreLeadershipChange(text: string) {
  const role =
    "(?:ceo|chief executive|cfo|chief financial|coo|chief operating|board|director|chair(?:man|woman)?|president)";
  return (
    /\bnew\s+(?:ceo|cfo|coo)\b/i.test(text) ||
    new RegExp(`\\b(?:appoints?|names?|elects?|promotes?|hires?)\\b.{0,120}\\b${role}\\b`, "i").test(text) ||
    new RegExp(`\\b${role}\\b.{0,120}\\b(?:retires?|resigns?|steps down|departure|succession)\\b`, "i").test(text)
  );
}

function findBoilerplateCut(bodyText: string) {
  const candidates = [
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Use of\s+)?(?:Cautionary|Forward[- ]Looking|Safe Harbor)\s+(?:Note|Statement|Statements|Information|Language)[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*((?:Caution|Cautionary)\s+(?:Concerning|Regarding|About)\s+Forward[- ]Looking\s+Statements?[^\n]*)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(This (?:(?:press|news)\s+)?release contains [^\n]{0,320}forward[- ]looking\s+statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Certain statements (?:in|contained in|included in) this (?:press|news) release [^\n]{0,320}forward[- ]looking\s+statements?)/i,
      "Forward-Looking Statements",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(About\s+[A-Z0-9][^\n]{0,120})/i,
      "About Company",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(Contacts?|Investor Relations Contact|Media Relations Contact|For (?:further )?(?:information|media inquiries|investor inquiries|more information)\b[^\n]*)/i,
      "Contact Information",
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

function extractAccesswireBodyHtml(html: string) {
  const bodyPattern =
    /<div\b(?=[^>]*\bdata-inline-binding=(["'])dynamic_page_collection\.body\1)(?=[^>]*\bclass=(["'])(?=[^"']*\barticle-update\b)[^"']*\2)[^>]*>/i;
  const match = bodyPattern.exec(html);
  if (match?.index !== undefined) return extractBalancedElementAt(html, match.index, "div");

  const fallbackPattern = /<div\b[^>]*\bclass=(["'])(?=[^"']*\bmain-article\b)[^"']*\1[^>]*>/i;
  const fallback = fallbackPattern.exec(html);
  if (fallback?.index === undefined) return null;
  const fallbackHtml = extractBalancedElementAt(html, fallback.index, "div");
  if (!fallbackHtml) return null;
  const nested = bodyPattern.exec(fallbackHtml);
  if (nested?.index !== undefined) return extractBalancedElementAt(fallbackHtml, nested.index, "div");
  return fallbackHtml;
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

function extractTickerMentions(text: string): AccesswireTickerMention[] {
  const mentions: AccesswireTickerMention[] = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca|\s+Texas)?|NYSEAMERICAN|AMEX|Cboe|CBOE|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC|TSX\s+Venture\s+Exchange|TSXV|TSX|CSE|FSE|XETRA|SIX|LSE|AIM|ASX))\s*(?::|\uFF1A)\s*([A-Z][A-Z0-9.-]{0,9})\b/g;

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

function dedupeTickerMentions(tickers: AccesswireTickerMention[]) {
  const seen = new Set<string>();
  const result: AccesswireTickerMention[] = [];

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
    .replace(/^NYSE Texas$/i, "NYSE")
    .replace(/^Cboe$/i, "CBOE")
    .replace(/^OTC PINK$/i, "OTC Pink")
    .trim();
}

function isUsExchange(exchange: string) {
  return /^(NASDAQ|NYSE|NYSE American|NYSE Arca|AMEX|CBOE|OTC|OTCQB|OTCQX|OTC Pink|OTC Markets)$/i.test(
    exchange,
  );
}

function normalizeAccesswireUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const decoded = decodeHtml(value).trim();
    if (!decoded) return null;
    const url = new URL(decoded, ACCESSWIRE_BASE_URL);
    if (!/^(?:www\.)?accessnewswire\.com$/i.test(url.hostname)) return null;
    url.protocol = "https:";
    url.hostname = "www.accessnewswire.com";
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
  return readReleaseId(text) || text;
}

function readReleaseId(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(decodeHtml(url), ACCESSWIRE_BASE_URL);
    const id = parsed.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    // Fall through to path match.
  }
  return String(url).match(/-(\d+)(?:\?|#|$)/i)?.[1] || null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `accesswire:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function accesswireFeed(label: string, industry?: string, primary = false): AccesswireFeedConfig {
  const url = new URL(ACCESSWIRE_NEWSROOM_API_URL);
  if (industry) url.searchParams.set("articleindustry", industry);
  return {
    label,
    industry,
    primary,
    url: url.toString(),
  };
}

function accesswireFetchHeaders(kind: "api" | "html", feed?: AccesswireFeedConfig) {
  const referer = feed?.industry
    ? `${ACCESSWIRE_BASE_URL}/newsroom/industry/${slugifyIndustry(feed.industry)}`
    : `${ACCESSWIRE_BASE_URL}/newsroom`;
  return {
    Accept: kind === "api" ? "application/json, text/javascript, */*; q=0.01" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": kind === "api" ? "application/json; charset=UTF-8" : "text/html; charset=utf-8",
    Origin: ACCESSWIRE_BASE_URL,
    Referer: referer,
    "User-Agent":
      kind === "api"
        ? "US-Stock-Radar/0.1 Access Newswire raw parser"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
  };
}

function slugifyIndustry(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function firstNonZeroStatus(feedStats: AccesswireRawFetchResult["diagnostics"]["feedStats"]) {
  return feedStats.find((feed) => feed.status > 0)?.status || 0;
}

function isEnglishAccesswireItem(item: AccesswireParsedRawItem) {
  const locale = readString(item.raw_payload.locale) || readString(item.raw_payload.language);
  if (locale) return /^en(?:-|$)?/i.test(locale);
  const text = `${item.title || ""} ${item.raw_payload.description || ""}`;
  if (/[채철체횩횪챔챙챵첫찼챕챠처첬챰쩔징]/i.test(text)) return false;
  return true;
}

function looksLikeCloudflareChallenge(value: string) {
  return /\bJust a moment\b/i.test(value) && /\bCloudflare\b|\bchallenge-platform\b/i.test(value);
}

function parseAccesswireDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = decodeHtml(value)
    .replace(/\bET\b/i, "GMT-0500")
    .replace(/\bEDT\b/i, "GMT-0400")
    .replace(/\bEST\b/i, "GMT-0500")
    .replace(/\s+/g, " ")
    .trim();
  const explicitEastern = parseAccesswireEasternDate(normalized);
  if (explicitEastern) return explicitEastern;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseAccesswireEasternDate(value: string) {
  const numeric = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i,
  );
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3]);
    const hour = to24Hour(Number(numeric[4]), numeric[7]);
    const minute = Number(numeric[5]);
    const second = Number(numeric[6] || 0);
    return easternDateToIso({ year, month, day, hour, minute, second });
  }

  const named = value.match(
    /^(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i,
  );
  if (named) {
    const month = monthNameToNumber(named[2]);
    if (!month) return null;
    const day = Number(named[1]);
    const year = Number(named[3]);
    const hour = to24Hour(Number(named[4]), named[7]);
    const minute = Number(named[5]);
    const second = Number(named[6] || 0);
    return easternDateToIso({ year, month, day, hour, minute, second });
  }

  return null;
}

function easternDateToIso({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}) {
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  const offsetHours = month >= 3 && month <= 11 ? 4 : 5;
  const utcMs = Date.UTC(year, month - 1, day, hour + offsetHours, minute, second);
  return Number.isFinite(utcMs) ? new Date(utcMs).toISOString() : null;
}

function to24Hour(hour: number, meridiem: string | undefined) {
  if (!meridiem) return hour;
  const normalized = meridiem.toUpperCase();
  if (normalized === "PM" && hour < 12) return hour + 12;
  if (normalized === "AM" && hour === 12) return 0;
  return hour;
}

function monthNameToNumber(value: string) {
  const key = value.toLowerCase().slice(0, 3);
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[key] || null;
}

function dateMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
        : normalizeArticleSrc(rawValue) || rawValue;
      return ` ${attr.toLowerCase()}=${quote}${escapeHtmlAttribute(absolute)}${quote}`;
    },
  );

  const cleaned = withAbsoluteLinks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s(?:class|id|style|onclick|onload|onerror|contenteditable|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|xmlns)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?(?:section|article|main|span|font|sup|figure)\b[^>]*>/gi, "")
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
        return href ? `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noreferrer">` : "<a>";
      }
      return `<${tagName}>`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || null;
}

function normalizeArticleHref(value: string | null | undefined) {
  if (!value) return null;
  const decoded = decodeHtml(value).trim();
  if (!decoded) return null;
  try {
    const url = new URL(decoded, ACCESSWIRE_BASE_URL);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return decoded;
  } catch {
    return decoded;
  }
}

function normalizeArticleSrc(value: string | null | undefined) {
  if (!value) return null;
  const decoded = decodeHtml(value).trim();
  if (!decoded) return null;
  try {
    return new URL(decoded, ACCESSWIRE_BASE_URL).toString();
  } catch {
    return decoded;
  }
}

function buildCandidateClassificationText(description: string | null, articleText: string | null) {
  return [description, trimArticleTextForCandidateClassification(articleText)].filter(Boolean).join("\n");
}

function trimArticleTextForCandidateClassification(value: string | null) {
  if (!value) return null;
  const cuts = [
    findClassificationCut(value, /(?:^|\n)\s*About\s+[A-Z0-9][^\n]{0,120}/i),
    findClassificationCut(value, /(?:^|\n)\s*Forward[- ]Looking\s+Statements?/i),
    findClassificationCut(value, /(?:^|\n)\s*Contacts?\b/i),
  ].filter((index): index is number => typeof index === "number" && Number.isFinite(index));
  const cut = cuts.length ? Math.min(...cuts) : -1;
  return (cut > 0 ? value.slice(0, cut) : value).trim();
}

function findClassificationCut(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  if (!match || match.index < 500) return null;
  return match.index;
}

function readIndustryFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const match = String(url).match(/\/newsroom\/en\/([^/]+)\//i);
  if (!match) return null;
  return match[1]
    .replace(/-/g, " ")
    .replace(/\band\b/g, "&")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readCanonicalUrl(html: string) {
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  return normalizeAccesswireUrl(readAttribute(html.match(pattern)?.[0] || "", "href"));
}

function readTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(match?.[1] || "").trim() || null;
}

function readHeaderDate(html: string) {
  const pattern =
    /<span\b[^>]*\bdata-inline-binding=(["'])dynamic_page_collection\.date\1[^>]*>([\s\S]*?)<\/span>/i;
  return textFromHtml(pattern.exec(html)?.[2] || null);
}

function readTopicFromHeader(html: string) {
  const pattern =
    /<span\b[^>]*\bdata-inline-binding=(["'])dynamic_page_collection\.topics\1[^>]*>([\s\S]*?)<\/span>/i;
  return textFromHtml(pattern.exec(html)?.[2] || null);
}

function readSourceCompanyFromBody(bodyHtml: string | null | undefined) {
  const text = textFromHtml(bodyHtml);
  return text?.match(/(?:^|\n)\s*SOURCE:\s*([^\n]{2,160})/i)?.[1]?.trim() || null;
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

function readFirstString(value: unknown) {
  const values = stringArray(value);
  return values[0] || null;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(readRecord(item)));
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => readString(item)).filter((item): item is string => Boolean(item));
  const text = readString(value);
  return text ? [text] : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeFilterText(value: string) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    aacute: "\u00e1",
    agrave: "\u00e0",
    atilde: "\u00e3",
    auml: "\u00e4",
    ccedil: "\u00e7",
    eacute: "\u00e9",
    egrave: "\u00e8",
    iacute: "\u00ed",
    iuml: "\u00ef",
    ntilde: "\u00f1",
    oacute: "\u00f3",
    ouml: "\u00f6",
    uacute: "\u00fa",
    uuml: "\u00fc",
    copy: "\u00a9",
    reg: "\u00ae",
    trade: "\u2122",
  };

  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] || match)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_match, num: string) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
