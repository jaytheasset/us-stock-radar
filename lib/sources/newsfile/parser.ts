import { XMLParser } from "fast-xml-parser";

const NEWSFILE_BASE_URL = "https://www.newsfilecorp.com";
const NEWSFILE_RSS_URL = "https://feeds.newsfilecorp.com/global/Last25Stories";

const PARSER_VERSION = "newsfile_raw_parser_v1";
const ANALYSIS_TEXT_VERSION = "newsfile_analysis_text_v1";

type FetchOptions = {
  feeds?: NewsfileFeedConfig[];
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type NewsfileFeedConfig = {
  label: string;
  url: string;
  primary?: boolean;
};

export type NewsfileTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type NewsfileParsedArticle = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  companyName: string | null;
  description: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  tickers: NewsfileTickerMention[];
  rawPayload: Record<string, unknown>;
};

export type NewsfileParsedRawItem = {
  source_code: "newsfile";
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

export type NewsfileRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: NewsfileParsedRawItem[];
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

export const NEWSFILE_FEEDS: NewsfileFeedConfig[] = [
  {
    label: "Newsfile Last 25 Stories",
    primary: true,
    url: NEWSFILE_RSS_URL,
  },
];

export async function fetchNewsfileRawItems(options: FetchOptions = {}): Promise<NewsfileRawFetchResult> {
  const feeds = options.feeds?.length ? options.feeds : NEWSFILE_FEEDS;
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 25, 1, 100);
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const items: NewsfileParsedRawItem[] = [];
  const seen = new Set<string>();
  const feedStats: NewsfileRawFetchResult["diagnostics"]["feedStats"] = [];
  let skippedNonEnglish = 0;

  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: newsfileFetchHeaders("rss"),
      });
      const xml = await response.text();
      if (!response.ok) {
        feedStats.push({
          label: feed.label,
          ok: false,
          status: response.status,
          itemCount: 0,
          error: response.statusText || "Newsfile RSS request failed",
        });
        continue;
      }

      const parsedItems = parseNewsfileRssXml(xml, { feed, fetchedAt });
      feedStats.push({
        label: feed.label,
        ok: true,
        status: response.status,
        itemCount: parsedItems.length,
      });

      for (const item of parsedItems) {
        if (!isEnglishNewsfileItem(item)) {
          skippedNonEnglish += 1;
          continue;
        }
        const dedupeKey = item.source_unique_id || item.dedupe_key || item.source_url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
      }
    } catch (error) {
      feedStats.push({
        label: feed.label,
        ok: false,
        status: 0,
        itemCount: 0,
        error: error instanceof Error ? error.message : "Newsfile RSS fetch failed",
      });
    }
  }

  const selectedItems = items
    .sort((a, b) => dateMs(b.published_at) - dateMs(a.published_at))
    .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
    .slice(0, limit);
  let articleBodiesFetched = 0;
  const hydrated: NewsfileParsedRawItem[] = [];

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    if (index >= articleBodyLimit) {
      hydrated.push(item);
      continue;
    }

    try {
      const articleResponse = await fetchNewsfileArticleHtml(item.source_url);
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

      const article = parseNewsfileArticleHtml(articleResponse.html, articleResponse.url);
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
    error: ok ? undefined : "No Newsfile feeds could be fetched",
  };
}

export function parseNewsfileRssXml(
  xml: string,
  options: { feed: NewsfileFeedConfig; fetchedAt?: string },
): NewsfileParsedRawItem[] {
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
    .map((rawItem): NewsfileParsedRawItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const title = readString(item.title);
      const sourceUrl = normalizeNewsfileUrl(readString(item.link) || readGuid(item.guid));
      if (!sourceUrl) return null;

      const sourceUniqueId = readReleaseId(sourceUrl) || readGuid(item.guid);
      const descriptionHtml = readString(item.description);
      const description = textFromHtml(descriptionHtml);
      const subtitle = readString(item["atom:subtitle"]) || readString(readRecord(item["atom:subtitle"])?.["#text"]);
      const language =
        readString(item["@_xml:lang"]) ||
        readString(item["@_lang"]) ||
        readString(item["dc:language"]) ||
        readString(readRecord(item["dc:language"])?.["#text"]);
      const metadataTickers = dedupeTickerMentions(
        extractTickerMentions([title, description, subtitle].filter(Boolean).join(" ")),
      );
      const candidate = classifyNewsfileCandidate({
        title,
        description: buildCandidateClassificationText([description, subtitle].filter(Boolean).join("\n"), null),
        tickers: metadataTickers,
      });

      return {
        source_code: "newsfile" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title,
        published_at: parseNewsfileDate(readString(item.pubDate)),
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "Newsfile",
          parser_version: PARSER_VERSION,
          feed_label: options.feed.label,
          feed_url: options.feed.url,
          description,
          description_html: descriptionHtml,
          subtitle,
          language,
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
    .filter((item): item is NewsfileParsedRawItem => Boolean(item));
}

export function parseNewsfileArticleHtml(html: string, url: string): NewsfileParsedArticle {
  const normalizedUrl = normalizeNewsfileUrl(url) || url;
  const bodyHtml = extractElementById(html, "release");
  const fullTextHtml = sanitizeArticleHtml(bodyHtml);
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const analysisText = stripNewsfileAnalysisBoilerplate(bodyText);
  const title = readMetaContent(html, "og:title") || readMetaContent(html, "title");
  const description = readMetaContent(html, "description") || readMetaContent(html, "og:description");
  const companyName = readMetaContent(html, "author") || readSourceCompanyFromRelease(bodyHtml);
  const bodyTickers = dedupeTickerMentions(extractTickerMentions(bodyText || ""));
  const metadataTickers = dedupeTickerMentions(
    extractTickerMentions([title, description, readMetaContent(html, "keywords")].filter(Boolean).join(" ")),
  );

  return {
    url: normalizedUrl,
    title,
    publishedAt: readPublishedAt(html) || parseNewsfileDate(readMetaContent(html, "article:published_time")),
    sourceName: "Newsfile",
    companyName,
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

export function stripNewsfileAnalysisBoilerplate(bodyText: string | null) {
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

async function fetchNewsfileArticleHtml(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: newsfileFetchHeaders("html"),
  });
  const html = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    url: response.url || sourceUrl,
    html: response.ok ? html : "",
    error: response.ok ? undefined : response.statusText || "Newsfile article request failed",
  };
}

function mergeArticleIntoRawItem(
  item: NewsfileParsedRawItem,
  article: NewsfileParsedArticle,
): NewsfileParsedRawItem {
  const searchTickers = Array.isArray(item.raw_payload.tickers)
    ? (item.raw_payload.tickers as NewsfileTickerMention[])
    : [];
  const tickers = article.bodyText ? article.tickers : dedupeTickerMentions([...searchTickers, ...article.tickers]);
  const candidate = classifyNewsfileCandidate({
    title: article.title || item.title,
    description: buildCandidateClassificationText(
      [article.description, readString(item.raw_payload.subtitle)].filter(Boolean).join("\n"),
      readString(article.rawPayload.analysis_text) || article.bodyText,
    ),
    tickers,
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

function classifyNewsfileCandidate({
  title,
  description,
  tickers,
}: {
  title: string | null;
  description: string | null;
  tickers: NewsfileTickerMention[];
}) {
  const text = normalizeFilterText([title, description].filter(Boolean).join("\n"));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const lowValueReasons = findLowValueReasons(text);
  const archiveableLowValueReasons = findArchiveableLowValueReasons(lowValueReasons);
  const materialCompanyEvent = hasMaterialCompanyEventSignal(text);
  const sectorImpactSignals = findSectorImpactSignals(text);
  const broadUsTransmission = hasBroadUsMarketTransmission(text, sectorImpactSignals);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...archiveableLowValueReasons.map((reason) => `archiveable_low_value:${reason}`),
    ...(materialCompanyEvent ? ["material_company_event"] : []),
    ...(hasUsTicker ? ["us_ticker"] : []),
    ...(hasUsTicker || materialCompanyEvent ? ["feed:event"] : ["feed:sector"]),
  ];

  if (isGenericIssuerMeetingDateList(text) && !hasUsTicker) {
    return {
      candidateClass: "low_value_filtered",
      reason:
        "Filtered before LLM as generic issuer meeting-date list with no U.S.-listed ticker or clear U.S. market transmission path.",
      signals: [...signals, "low_value:generic_meeting_dates_list"],
      lowValueReasons: [...lowValueReasons, "generic_meeting_dates_list"],
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.includes("shareholder_lawsuit_ad") && hasUsTicker) {
    return {
      candidateClass: "ticker_archive_candidate",
      reason: "Ticker-bearing Newsfile legal/lawsuit notice marked for deterministic archive.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.includes("third_party_research_coverage") && hasUsTicker) {
    return {
      candidateClass: "ticker_archive_candidate",
      reason: "Ticker-bearing Newsfile third-party research coverage notice marked for deterministic archive.",
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
      reason: `Ticker-bearing Newsfile item marked for deterministic archive: ${archiveableLowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !materialCompanyEvent && !(hasUsTicker && sectorImpactSignals.length > 0)) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value Newsfile item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (!hasUsTicker && isForeignCompanyClinicalOrRegulatoryItem(materialCompanyEvent, sectorImpactSignals)) {
    return {
      candidateClass: "low_value_filtered",
      reason:
        "Filtered before LLM because Newsfile clinical/regulatory company item has no U.S.-listed ticker or direct U.S. issuer impact.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in Newsfile release body/listing.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (!broadUsTransmission) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM because Newsfile item has no U.S.-listed ticker or clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: sectorImpactSignals.length
      ? `Sector/theme/policy candidate from Newsfile feed: ${sectorImpactSignals.join(", ")}`
      : "Broad Newsfile sector candidate; not filtered by low-value rules.",
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function isForeignCompanyClinicalOrRegulatoryItem(materialCompanyEvent: boolean, sectorImpactSignals: string[]) {
  if (!materialCompanyEvent || !sectorImpactSignals.length) return false;
  const companySpecificSignals = new Set([
    "clinical_regulatory_milestone",
    "healthcare_access_reimbursement",
    "regulatory_agency",
  ]);
  return sectorImpactSignals.every((signal) => companySpecificSignals.has(signal));
}

function findLowValueReasons(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["shareholder_lawsuit_ad", /\b(shareholder alert|lead plaintiff|class action|securities fraud|investor deadline|law firm|investigates?|investigation into|investigation of|investors? with losses|contact levi|lost money on)\b/i],
    ["award_or_ranking", /\b(award|awards|honou?r|honou?rs|ranking|ranked|recognition|winner|wins?|top employer)\b/i],
    ["local_opening", /\b(grand opening|opens? new|new showroom|new office|new location|ribbon cutting|store opening|branch opening)\b/i],
    ["expert_advice", /\b(expert explains|offers guidance|tips for|how to|what are the|why does|thought leadership|commentary|q&a)\b/i],
    ["marketing_campaign", /\b(brand campaign|launches campaign|sweepstakes|giveaway|limited-time offer|discount|promo(?:tional)?|announces sponsorship|sponsors)\b/i],
    ["conference_presence", /\b(to present at|will present at|to participate in|will participate in|attend(?:s|ing)?|exhibit(?:s|ing)? at|booth|webinar|investor day|analyst day|capital markets day|webcast.{0,80}presentation)\b/i],
    ["csr_or_community", /\b(charity|foundation|donation|scholarship|community event|volunteer|philanthrop|nonprofit|pro bono)\b/i],
    ["survey_or_report_marketing", /\b(survey|poll|study finds|report reveals|white paper|market research report|customer satisfaction rating)\b/i],
    ["third_party_research_coverage", /\b(?:initiates?|initiat(?:e|ia)tes?|starts?|launches?)\s+coverage\b|\bresearch (?:coverage|report)\b|\banalyst report\b/i],
    ["private_product_promo", /\b(new product line|expands?.{0,80}(?:product line|portfolio|platform|line)|unveils?.{0,80}(?:portfolio|platform|product)|product launch|available now|commercially available|consumer alert)\b/i],
    ["real_estate_or_tourism_promo", /\b(luxury resort|branded residences|tourism offerings|destination|hotel opening|travel enthusiasts)\b/i],
    ["personnel_or_culture", /\b(appoints?|joins? as|new ceo|new cfo|graduates?|commencement|diversity|people and culture|workforce culture)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function findArchiveableLowValueReasons(lowValueReasons: string[]) {
  const archiveable = new Set([
    "shareholder_lawsuit_ad",
    "local_opening",
    "marketing_campaign",
    "third_party_research_coverage",
    "survey_or_report_marketing",
    "private_product_promo",
    "real_estate_or_tourism_promo",
  ]);
  return lowValueReasons.filter((reason) => archiveable.has(reason));
}

function isGenericIssuerMeetingDateList(text: string) {
  return (
    /\bupcoming meeting dates?\b/i.test(text) &&
    /\breporting issuers?\b/i.test(text) &&
    /\b(?:cds clearing|depository services|transfer agent|meeting date|record date)\b/i.test(text)
  );
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

function findSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["geopolitical_security", /\b(war|military conflict|invasion|missile|drone attack|airstrike|border conflict|geopolitical|national security|terror|weapon system)\b/i],
    ["sanctions_trade_controls", /\b(sanction|tariff|export control|import ban|trade restriction|customs duty|anti-dumping|countervailing|embargo|blacklist|entity list)\b/i],
    ["public_health", /\b(pandemic|epidemic|outbreak|virus|infectious disease|cdc|public health emergency|avian flu|h5n1|covid|vaccine shortage)\b/i],
    ["supply_chain_logistics", /\b(supply chain|shortage|disruption|port closure|shipping lane|freight|rail disruption|rail strike|truck strike|warehouse disruption|logistics bottleneck)\b/i],
    ["energy_commodity", /\b(oil price|natural gas|lng|uranium|lithium|copper|rare earth|critical minerals|commodity prices|power prices|grid reliability|electricity shortage|refinery outage)\b/i],
    ["regulatory_agency", /\b(regulation|regulatory|agency action|epa|fda|cdc|doe|dod|ftc|fcc|ferc|cftc|sec rule|antitrust|compliance deadline|rulemaking)\b/i],
    ["labor_infrastructure", /\b(strike|walkout|lockout|union action|labor dispute|infrastructure failure|bridge collapse|airport shutdown|port shutdown|plant shutdown|factory shutdown)\b/i],
    ["cyber_data_risk", /\b(cyberattack|ransomware|data breach|security breach|critical vulnerability|malware|phishing campaign|identity theft|system outage|anti-fraud)\b/i],
    ["disaster_climate", /\b(hurricane|wildfire|flood|earthquake|tornado|drought|heatwave|winter storm|natural disaster|climate risk|evacuation)\b/i],
    ["defense_procurement", /\b(defense contract|government procurement|dod contract|navy contract|army contract|air force contract|weapons procurement|munitions|shipbuilding contract)\b/i],
    ["ai_semiconductor_infrastructure", /\b(ai chip|artificial intelligence infrastructure|semiconductor|asic|gpu|data center|advanced packaging|wafer|foundry|memory chip|chip supply|hpc|compute capacity|ai infrastructure)\b/i],
    ["clinical_regulatory_milestone", /\b(clinical trial results?|phase\s+(?:1|2|3|i|ii|iii)|pdufa|fda approval|breakthrough therapy|orphan drug|fast track|clinical data|late[- ]breaking data|topline results?|primary endpoint|readout)\b/i],
    ["healthcare_access_reimbursement", /\b(medicare|medicaid|reimbursement|drug pricing|pbm|pharmacy benefit|hospital capacity|medical supply shortage|health insurance premium)\b/i],
    ["financial_systemic", /\b(bank failure|credit crunch|liquidity stress|systemic risk|debt ceiling|sovereign debt|rate shock|bond market disruption)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function hasBroadUsMarketTransmission(text: string, sectorImpactSignals: string[]) {
  if (!sectorImpactSignals.length) return false;
  if (/\b(united states|u\.s\.|us market|nasdaq|nyse|otc|american depositary|adr)\b/i.test(text)) return true;

  return sectorImpactSignals.some((signal) =>
    [
      "sanctions_trade_controls",
      "energy_commodity",
      "supply_chain_logistics",
      "financial_systemic",
      "geopolitical_security",
      "public_health",
      "ai_semiconductor_infrastructure",
    ].includes(signal),
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
      /(?:^|\n)\s*(To view the source version of this press release\b[^\n]*)/i,
      "Newsfile Source Link",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(About\s+[A-Z0-9][^\n]{0,120})/i,
      "About Company",
    ),
    findPatternCut(
      bodyText,
      /(?:^|\n)\s*(For (?:further )?(?:information|media inquiries|investor inquiries|more information)\b[^\n]*)/i,
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

function newsfileFetchHeaders(kind: "rss" | "html") {
  return {
    Accept: kind === "rss" ? "application/rss+xml,application/xml,text/xml,*/*" : "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 Newsfile raw parser",
  };
}

function extractTickerMentions(text: string): NewsfileTickerMention[] {
  const mentions: NewsfileTickerMention[] = [];
  const pattern =
    /\b((?:NASDAQ|Nasdaq|NYSE(?:\s+American|\s+Arca)?|NYSEAMERICAN|AMEX|Cboe|CBOE|OTCQB|OTCQX|OTC\s+Pink|OTC\s+PINK|OTC\s+Markets|OTC|TSX\s+Venture\s+Exchange|TSXV|TSX|CSE|FSE|XETRA|SIX|LSE|AIM|ASX))\s*(?::|\uFF1A)\s*([A-Z][A-Z0-9.-]{0,9})\b/g;

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

function dedupeTickerMentions(tickers: NewsfileTickerMention[]) {
  const seen = new Set<string>();
  const result: NewsfileTickerMention[] = [];

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

function normalizeNewsfileUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), NEWSFILE_BASE_URL);
    url.protocol = "https:";
    url.hostname = "www.newsfilecorp.com";
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

function readReleaseId(url: string) {
  return url.match(/\/release\/(\d+)(?:\/|$)/i)?.[1] || null;
}

function readGuid(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  const record = readRecord(value);
  return readString(record?.["#text"]);
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `newsfile:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function isEnglishNewsfileItem(item: NewsfileParsedRawItem) {
  const language = readString(item.raw_payload.language);
  if (!language) return true;
  return language.toLowerCase().startsWith("en");
}

function parseNewsfileDate(value: string | null | undefined) {
  if (!value) return null;
  const normalized = decodeHtml(value)
    .replace(/\bEDT\b/i, "-0400")
    .replace(/\bEST\b/i, "-0500")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function dateMs(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractElementById(html: string, id: string) {
  const startPattern = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`, "i");
  const startMatch = startPattern.exec(html);
  if (!startMatch || startMatch.index === undefined) return null;

  const tagName = startMatch[1].toLowerCase();
  return extractBalancedElementAt(html, startMatch.index, tagName);
}

function extractBalancedElementAt(html: string, startIndex: number, tagName: string) {
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
        : normalizeArticleHref(rawValue) || rawValue;
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
  return normalizeNewsfileUrl(readAttribute(html.match(pattern)?.[0] || "", "href"));
}

function normalizeArticleHref(value: string | null | undefined) {
  if (!value) return null;
  const decoded = decodeHtml(value).trim();
  if (!decoded) return null;

  try {
    const url = new URL(decoded, NEWSFILE_BASE_URL);
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

function readPublishedAt(html: string) {
  const match = /<h1\b[\s\S]*?<\/h1>\s*<p\b[^>]*>([\s\S]*?)\|\s*Source:/i.exec(html);
  const text = textFromHtml(match?.[1] || "");
  return parseNewsfileDate(text);
}

function readSourceCompanyFromRelease(value: string | null | undefined) {
  if (!value) return null;
  const match = /<p>\s*Source:\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i.exec(value);
  return textFromHtml(match?.[1] || "");
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
    findClassificationCut(value, /(?:^|\n)\s*To view the source version of this press release\b/i),
  ].filter((index): index is number => typeof index === "number" && Number.isFinite(index));
  const cut = cuts.length ? Math.min(...cuts) : -1;
  return (cut > 0 ? value.slice(0, cut) : value).trim();
}

function findClassificationCut(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  if (!match || match.index < 500) return null;
  return match.index;
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
    rsquo: "'",
    lsquo: "'",
    rdquo: "\"",
    ldquo: "\"",
    ndash: "-",
    mdash: "-",
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
