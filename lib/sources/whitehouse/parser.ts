const WHITE_HOUSE_BASE_URL = "https://www.whitehouse.gov";

const PARSER_VERSION = "whitehouse_html_parser_v1";
const ANALYSIS_TEXT_VERSION = "whitehouse_analysis_text_v1";

const SOURCE_PAGES = [
  {
    code: "presidential_actions",
    label: "Presidential Actions",
    url: "https://www.whitehouse.gov/presidential-actions/",
  },
  {
    code: "fact_sheets",
    label: "Fact Sheets",
    url: "https://www.whitehouse.gov/fact-sheets/",
  },
  {
    code: "releases",
    label: "Releases",
    url: "https://www.whitehouse.gov/releases/",
  },
] as const;

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type WhiteHouseListItem = {
  sourceType: string;
  sourceTypeLabel: string;
  sourceUniqueId: string | null;
  sourceUrl: string;
  title: string;
  publishedAt: string | null;
  categories: string[];
};

type WhiteHouseArticlePage = {
  title: string | null;
  publishedAt: string | null;
  category: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  rawPayload: Record<string, unknown>;
};

export type WhiteHouseTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type WhiteHouseParsedRawItem = {
  source_code: "whitehouse";
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

export type WhiteHouseRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: WhiteHouseParsedRawItem[];
  diagnostics: {
    parsedFromList: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    sourceUrls: string[];
    listPagesFetched: number;
  };
  error?: string;
};

export async function fetchWhiteHouseRawItems(options: FetchOptions = {}): Promise<WhiteHouseRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 10, 1, 50);
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;

  try {
    const sourceUrls: string[] = [];
    const listItemsAll: WhiteHouseListItem[] = [];
    const seenListItems = new Set<string>();
    const pagesPerSource = sourceUniqueId ? 5 : Math.max(1, Math.ceil(limit / SOURCE_PAGES.length / 8));

    for (const sourcePage of SOURCE_PAGES) {
      for (let page = 1; page <= pagesPerSource; page += 1) {
        const listUrl = page === 1 ? sourcePage.url : buildPagedUrl(sourcePage.url, page);
        sourceUrls.push(listUrl);
        const response = await fetchHtml(listUrl);

        if (!response.ok) {
          if (sourceUrls.length === 1) {
            return {
              ok: false,
              status: response.status,
              fetchedAt,
              count: 0,
              items: [],
              diagnostics: emptyDiagnostics(articleBodyLimit, sourceUrls),
              error: response.error || "White House list request failed",
            };
          }
          break;
        }

        const pageItems = parseWhiteHouseListHtml(response.html, {
          sourceType: sourcePage.code,
          sourceTypeLabel: sourcePage.label,
        });
        if (!pageItems.length) break;

        for (const item of pageItems) {
          const key = item.sourceUniqueId || item.sourceUrl;
          if (seenListItems.has(key)) continue;
          seenListItems.add(key);
          listItemsAll.push(item);
        }

        if (sourceUniqueId && listItemsAll.some((item) => normalizeSourceUniqueId(item.sourceUniqueId) === sourceUniqueId)) {
          break;
        }
        await delay(150);
      }

      if (sourceUniqueId && listItemsAll.some((item) => normalizeSourceUniqueId(item.sourceUniqueId) === sourceUniqueId)) {
        break;
      }
    }

    const listItems = listItemsAll
      .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.sourceUniqueId) === sourceUniqueId)
      .sort((a, b) => (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0))
      .slice(0, limit);

    let articleBodiesFetched = 0;
    const items: WhiteHouseParsedRawItem[] = [];

    for (let index = 0; index < listItems.length; index += 1) {
      const listItem = listItems[index];
      const baseItem = listItemToRawItem(listItem, fetchedAt);

      if (index >= articleBodyLimit) {
        items.push(baseItem);
        continue;
      }

      try {
        const articleResponse = await fetchHtml(listItem.sourceUrl);
        if (!articleResponse.ok) {
          items.push({
            ...baseItem,
            raw_payload: {
              ...baseItem.raw_payload,
              article_fetch_status: articleResponse.status,
              article_fetch_error: articleResponse.error || `HTTP ${articleResponse.status}`,
            },
          });
          continue;
        }

        const article = parseWhiteHouseArticleHtml(articleResponse.html, articleResponse.url || listItem.sourceUrl);
        articleBodiesFetched += article.bodyText ? 1 : 0;
        items.push(mergeArticleIntoRawItem(baseItem, article));
      } catch (error) {
        items.push({
          ...baseItem,
          raw_payload: {
            ...baseItem.raw_payload,
            article_fetch_error: error instanceof Error ? error.message : "White House article fetch failed",
          },
        });
      }

      await delay(150);
    }

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: items.length,
      items,
      diagnostics: {
        parsedFromList: listItemsAll.length,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched,
        parserVersion: PARSER_VERSION,
        sourceUrls,
        listPagesFetched: sourceUrls.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: emptyDiagnostics(articleBodyLimit, []),
      error: error instanceof Error ? error.message : "White House fetch failed",
    };
  }
}

export function parseWhiteHouseListHtml(
  html: string,
  source: { sourceType: string; sourceTypeLabel: string },
): WhiteHouseListItem[] {
  const rows = extractRowsByClass(html, "wp-block-post");

  return rows
    .map((row): WhiteHouseListItem | null => {
      const titleLink = readFirstLink(row, /https:\/\/www\.whitehouse\.gov\//i);
      if (!titleLink?.href || !titleLink.text) return null;
      const sourceUrl = normalizeWhiteHouseUrl(titleLink.href);
      if (!sourceUrl || !isWhiteHouseArticleUrl(sourceUrl)) return null;

      const publishedAt = readDateTime(row);
      const categories = readCategoryNames(row);

      return {
        sourceType: source.sourceType,
        sourceTypeLabel: source.sourceTypeLabel,
        sourceUniqueId: readWhiteHouseArticleId(sourceUrl),
        sourceUrl,
        title: titleLink.text,
        publishedAt,
        categories,
      };
    })
    .filter((item): item is WhiteHouseListItem => Boolean(item));
}

export function parseWhiteHouseArticleHtml(html: string, url: string): WhiteHouseArticlePage {
  const entryHtml = extractEntryContentHtml(html);
  const title = readArticleTitle(html);
  const publishedAt = readDateTime(html) || readMetaArticlePublishedTime(html);
  const category = readArticleCategory(html);
  const bodyHtml = entryHtml ? sanitizeArticleHtml(entryHtml) : null;
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;

  return {
    title,
    publishedAt,
    category,
    bodyHtml,
    bodyText,
    rawPayload: {
      canonical_url: readCanonicalUrl(html) || normalizeWhiteHouseUrl(url),
      full_text_html: bodyHtml,
      analysis_text: bodyText,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: bodyText?.length || 0,
      category,
    },
  };
}

function listItemToRawItem(item: WhiteHouseListItem, fetchedAt: string): WhiteHouseParsedRawItem {
  const candidate = classifyWhiteHouseCandidate({
    title: item.title,
    bodyText: null,
    sourceType: item.sourceType,
    category: item.categories.join(", "),
  });

  return {
    source_code: "whitehouse",
    source_group: "news",
    source_unique_id: item.sourceUniqueId,
    source_url: item.sourceUrl,
    title: item.title,
    published_at: item.publishedAt,
    fetched_at: fetchedAt,
    body_text: null,
    dedupe_key: buildDedupeKey(item.sourceUniqueId, item.sourceUrl),
    raw_payload: {
      provider: "White House",
      source_name: "White House",
      parser_version: PARSER_VERSION,
      source_type: item.sourceType,
      source_type_label: item.sourceTypeLabel,
      categories: item.categories,
      full_text_html: null,
      analysis_text: null,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: 0,
      tickers: [],
      body_tickers: [],
      metadata_tickers: [],
      ticker_source: "none",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function mergeArticleIntoRawItem(
  item: WhiteHouseParsedRawItem,
  article: WhiteHouseArticlePage,
): WhiteHouseParsedRawItem {
  const title = article.title || item.title || "";
  const bodyText = article.bodyText || item.body_text;
  const sourceType = stringValue(item.raw_payload.source_type) || "";
  const category = article.category || stringValue(item.raw_payload.source_type_label);
  const tickers = dedupeTickerMentions(extractTickerMentions([title, bodyText].filter(Boolean).join("\n")));
  const candidate = classifyWhiteHouseCandidate({
    title,
    bodyText,
    sourceType,
    category,
  });

  return {
    ...item,
    title,
    published_at: article.publishedAt || item.published_at,
    body_text: bodyText,
    raw_payload: {
      ...item.raw_payload,
      category,
      full_text_html: article.bodyHtml,
      article_payload: article.rawPayload,
      analysis_text: bodyText,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: bodyText?.length || 0,
      tickers,
      body_tickers: tickers,
      metadata_tickers: [],
      ticker_source: tickers.length ? "article_body" : "none",
      candidate_class: candidate.candidateClass,
      candidate_reason: candidate.reason,
      candidate_signals: candidate.signals,
      low_value_reasons: candidate.lowValueReasons,
      sector_impact_signals: candidate.sectorImpactSignals,
    },
  };
}

function classifyWhiteHouseCandidate({
  title,
  bodyText,
  sourceType,
  category,
}: {
  title: string | null;
  bodyText: string | null;
  sourceType: string | null;
  category: string | null;
}) {
  const text = normalizeFilterText([title, category, bodyText].filter(Boolean).join("\n"));
  const sectorImpactSignals = findWhiteHouseSectorImpactSignals(text);
  const lowValueReasons = findWhiteHouseLowValueReasons(text, sourceType, sectorImpactSignals);
  const isHardLowValue = lowValueReasons.some((reason) =>
    reason === "nominations_or_personnel" ||
    reason === "routine_commemorative_proclamation" ||
    reason === "general_release_without_market_policy"
  );
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    "feed:sector",
  ];

  if (isHardLowValue) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value White House item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value White House item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM because White House item has no clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: `White House policy item with U.S. market transmission signals: ${sectorImpactSignals.join(", ")}`,
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findWhiteHouseSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["trade_tariffs_export_controls", /\b(tariff|tariffs|trade deal|trade agreement|export controls?|import ban|china deal|customs duties|section 232|section 301)\b/i],
    ["sanctions_geopolitics", /\b(sanctions?|cuba|iran|russia|north korea|venezuela|foreign policy|national security|defense industrial base)\b/i],
    ["energy_critical_minerals", /\b(energy|oil|natural gas|lng|electric grid|nuclear|critical minerals?|mining|coal|refinery|pipeline)\b/i],
    ["healthcare_pharma", /\b(drug prices?|medicare|medicaid|fda|pharmaceutical|vaccines?|health insurance|hospital|pbm|public health)\b/i],
    ["technology_ai_cyber", /\b(artificial intelligence| AI |semiconductor|chips?|data center|cybersecurity|quantum|broadband|spectrum)\b/i],
    ["defense_procurement", /\b(defense|military|shipbuilding|missile|drone|weapons?|procurement|federal contracting|government contracts?)\b/i],
    ["tax_budget_regulation", /\b(tax|budget|appropriations?|deregulation|regulation|regulatory|permitting|environmental review|federal reserve|banking)\b/i],
    ["labor_immigration_infrastructure", /\b(immigration|visa|labor|workforce|strike|ports?|rail|trucking|supply chain|infrastructure|construction)\b/i],
    ["agriculture_food_commodities", /\b(agriculture|farmers?|soybeans?|corn|wheat|beef|food prices?|commodity|commodities)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function findWhiteHouseLowValueReasons(text: string, sourceType: string | null, sectorImpactSignals: string[]) {
  const rules: Array<[string, RegExp]> = [
    ["nominations_or_personnel", /\b(nominations? sent to the senate|nomination|appoint(?:s|ed|ment)|designating|commission|ambassador)\b/i],
    ["commemorative_proclamation", /\b(memorial day|police week|flag day|national .* month|national .* week|proclamation on|honors?|celebrates?|tribute)\b/i],
    ["ceremonial_statement", /\b(message on|statement from|remarks by|joint statement|greeting|congratulates?|mourns|prayer|holiday)\b/i],
    ["political_promo", /\b(making america|delivering for|historic first|unwavering support|america is back|promises kept)\b/i],
  ];

  const reasons = rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  const hasDirectPolicyAction =
    /\b(executive order|signed an order|signed a memorandum|imposes? sanctions?|tariffs?|trade deal|presidential permit|rulemaking|final rule|new federal guidance|announced sweeping new initiatives|directing agencies?|launches? initiative)\b/i.test(text);
  const isProclamation = /\bproclamations?\b/i.test(text) || /\bby the president of the united states of america a proclamation\b/i.test(text);
  const isRoutineCommemorativeTitle =
    /\b(day|week|month|weekend|heritage month|memorial|victory day|sports month)\b/i.test(text.slice(0, 220)) &&
    !/\b(tariff|sanctions?|imports?|national emergency|trade|pipeline|permit)\b/i.test(text.slice(0, 220));
  const isScorecardRelease =
    sourceType === "releases" &&
    /\b(jobs report|economic data|economy roars|economic strength|small business week|support for law enforcement|making america safe)\b/i.test(text);

  if ((isProclamation && !hasDirectPolicyAction) || isRoutineCommemorativeTitle) {
    reasons.push("routine_commemorative_proclamation");
  }
  if (isScorecardRelease && !hasDirectPolicyAction) {
    reasons.push("general_release_without_market_policy");
  }
  if (
    sectorImpactSignals.length > 0 &&
    !reasons.some((reason) =>
      reason === "nominations_or_personnel" ||
      reason === "routine_commemorative_proclamation" ||
      reason === "general_release_without_market_policy"
    )
  ) {
    return [];
  }
  if (!reasons.length && sourceType === "releases" && !hasDirectPolicyAction) reasons.push("general_release_without_market_policy");
  return reasons;
}

function extractEntryContentHtml(html: string) {
  const match = /<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*\bwp-block-post-content\b[^"']*["'][^>]*>/i.exec(html);
  if (!match) return null;
  const entry = extractBalancedElementAt(html, match.index, "div");
  if (!entry) return null;
  const withoutTopper = removeBalancedElementsByClass(entry, "wp-block-whitehouse-topper");
  return withoutTopper
    .replace(/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>/i, "")
    .replace(/<\/div>\s*$/i, "")
    .trim();
}

function sanitizeArticleHtml(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])(.*?)\2/gi, (_match, attr: string, quote: string, rawValue: string) => {
      const absolute = normalizeWhiteHouseUrl(rawValue) || rawValue;
      return ` ${attr.toLowerCase()}=${quote}${escapeHtmlAttribute(absolute)}${quote}`;
    });
}

async function fetchHtml(url: string) {
  const normalizedUrl = normalizeWhiteHouseUrl(url) || url;
  const response = await fetch(normalizedUrl, {
    cache: "no-store",
    headers: whiteHouseFetchHeaders(),
  });
  const html = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    url: response.url || normalizedUrl,
    html: response.ok ? html : "",
    error: response.ok ? undefined : response.statusText || "White House request failed",
  };
}

function buildPagedUrl(baseUrl: string, page: number) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/page/${Math.max(1, Math.floor(page))}/`;
  return url.toString();
}

function extractRowsByClass(html: string, className: string) {
  const rows: string[] = [];
  const pattern = new RegExp(`<li\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const row = extractBalancedElementAt(html, match.index, "li");
    if (row) rows.push(row);
  }

  return rows;
}

function removeBalancedElementsByClass(html: string, className: string) {
  const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "gi");
  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const element = extractBalancedElementAt(html, match.index, "div");
    if (!element) continue;
    output += html.slice(cursor, match.index);
    cursor = match.index + element.length;
    pattern.lastIndex = cursor;
  }

  return output + html.slice(cursor);
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

function readFirstLink(html: string, hrefPattern: RegExp) {
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const href = decodeHtml(match[1]);
    if (!hrefPattern.test(href)) continue;
    return {
      href,
      text: textFromHtml(match[2]) || null,
    };
  }

  return null;
}

function readCategoryNames(row: string) {
  return [...row.matchAll(/<div\b[^>]*class=["'][^"']*\btaxonomy-category\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .flatMap((match) => [...match[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((link) => textFromHtml(link[1])))
    .filter((item): item is string => Boolean(item));
}

function readArticleTitle(html: string) {
  return (
    textFromHtml(html.match(/<h1\b[^>]*class=["'][^"']*\bwp-block-whitehouse-topper__headline\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ||
    readMetaContent(html, "og:title") ||
    readTitleTag(html)
  );
}

function readArticleCategory(html: string) {
  return textFromHtml(
    html.match(/<div\b[^>]*class=["'][^"']*\bwp-block-whitehouse-byline-subcategory\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1],
  );
}

function readDateTime(html: string) {
  const value = html.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1];
  return parseIsoDate(value);
}

function readMetaArticlePublishedTime(html: string) {
  return parseIsoDate(readMetaContent(html, "article:published_time"));
}

function readCanonicalUrl(html: string) {
  const href = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href ? normalizeWhiteHouseUrl(href) : null;
}

function readMetaContent(html: string, name: string) {
  const escaped = escapeRegExp(name);
  const pattern = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const match = pattern.exec(html);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function readTitleTag(html: string) {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? textFromHtml(value)?.replace(/\s*\|\s*The White House\s*$/i, "") || null : null;
}

function isWhiteHouseArticleUrl(value: string) {
  return /^https:\/\/www\.whitehouse\.gov\/(?:presidential-actions|fact-sheets|releases)\/\d{4}\/\d{2}\//i.test(value);
}

function normalizeWhiteHouseUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), WHITE_HOUSE_BASE_URL);
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "/");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return readWhiteHouseArticleId(text) || text.replace(/\/$/, "");
}

function readWhiteHouseArticleId(value: string | null | undefined) {
  const normalizedUrl = normalizeWhiteHouseUrl(value);
  const text = normalizedUrl || String(value || "");
  const match = text.match(/\/(?:presidential-actions|fact-sheets|releases)\/(\d{4})\/(\d{2})\/([^/?#]+)\/?$/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `whitehouse:${sourceUniqueId || sourceUrl.toLowerCase()}`;
}

function extractTickerMentions(text: string): WhiteHouseTickerMention[] {
  const mentions: WhiteHouseTickerMention[] = [];
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
      usListed: true,
    });
  }

  return mentions;
}

function dedupeTickerMentions(tickers: WhiteHouseTickerMention[]) {
  const seen = new Set<string>();
  const result: WhiteHouseTickerMention[] = [];

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

function textFromHtml(value: string | null | undefined) {
  if (!value) return null;

  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeFilterText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(decodeHtml(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeHtml(value: string) {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, '"')
    .replace(/&#8221;|&rdquo;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function escapeHtmlAttribute(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function whiteHouseFetchHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 White House parser",
  };
}

function emptyDiagnostics(articleBodiesRequested: number, sourceUrls: string[]) {
  return {
    parsedFromList: 0,
    articleBodiesRequested,
    articleBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
    sourceUrls,
    listPagesFetched: sourceUrls.length,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
