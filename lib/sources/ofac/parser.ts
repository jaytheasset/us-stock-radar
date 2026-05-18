const OFAC_BASE_URL = "https://ofac.treasury.gov";
const TREASURY_BASE_URL = "https://home.treasury.gov";
const OFAC_RECENT_ACTIONS_URL = `${OFAC_BASE_URL}/recent-actions`;

const PARSER_VERSION = "ofac_recent_actions_parser_v1";
const ANALYSIS_TEXT_VERSION = "ofac_analysis_text_v1";

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

export type OfacParsedRawItem = {
  source_code: "ofac";
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

export type OfacRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: OfacParsedRawItem[];
  diagnostics: {
    parsedFromList: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    pressReleaseBodiesFetched: number;
    parserVersion: string;
    sourceUrl: string;
    sourceUrls: string[];
    listPagesFetched: number;
  };
  error?: string;
};

type OfacActionPage = {
  title: string | null;
  publishedAt: string | null;
  category: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  pressReleaseUrl: string | null;
  rawPayload: Record<string, unknown>;
};

type TreasuryPressReleasePage = {
  title: string | null;
  publishedAt: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  rawPayload: Record<string, unknown>;
};

export async function fetchOfacRawItems(options: FetchOptions = {}): Promise<OfacRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 10, 1, 50);
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;

  try {
    const pagesToFetch = sourceUniqueId ? 5 : Math.max(1, Math.ceil(limit / 10));
    const sourceUrls: string[] = [];
    const listItemsAll: OfacParsedRawItem[] = [];
    const seenListItems = new Set<string>();

    for (let page = 0; page < pagesToFetch; page += 1) {
      const listUrl = buildOfacRecentActionsUrl(page);
      sourceUrls.push(listUrl);
      const listResponse = await fetchHtml(listUrl, OFAC_BASE_URL);

      if (!listResponse.ok) {
        if (page === 0) {
          return {
            ok: false,
            status: listResponse.status,
            fetchedAt,
            count: 0,
            items: [],
            diagnostics: emptyDiagnostics(0, articleBodyLimit),
            error: listResponse.error || "OFAC recent actions request failed",
          };
        }
        break;
      }

      const pageItems = parseOfacRecentActionsHtml(listResponse.html, fetchedAt);
      if (!pageItems.length) break;

      for (const item of pageItems) {
        const key = item.source_unique_id || item.source_url;
        if (seenListItems.has(key)) continue;
        seenListItems.add(key);
        listItemsAll.push(item);
      }

      if (!sourceUniqueId && listItemsAll.length >= limit) break;
      if (sourceUniqueId && listItemsAll.some((item) => normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)) break;
    }

    const listItems = listItemsAll
      .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
      .slice(0, limit);

    let articleBodiesFetched = 0;
    let pressReleaseBodiesFetched = 0;
    const hydrated: OfacParsedRawItem[] = [];

    for (let index = 0; index < listItems.length; index += 1) {
      const item = listItems[index];
      if (index >= articleBodyLimit) {
        hydrated.push(item);
        continue;
      }

      try {
        const actionResponse = await fetchHtml(item.source_url, OFAC_BASE_URL);
        if (!actionResponse.ok) {
          hydrated.push({
            ...item,
            raw_payload: {
              ...item.raw_payload,
              article_fetch_status: actionResponse.status,
              article_fetch_error: actionResponse.error || `HTTP ${actionResponse.status}`,
            },
          });
          continue;
        }

        const action = parseOfacActionHtml(actionResponse.html, actionResponse.url || item.source_url);
        articleBodiesFetched += action.bodyText ? 1 : 0;

        let pressRelease: TreasuryPressReleasePage | null = null;
        if (action.pressReleaseUrl) {
          const pressResponse = await fetchHtml(action.pressReleaseUrl, TREASURY_BASE_URL);
          if (pressResponse.ok) {
            pressRelease = parseTreasuryPressReleaseHtml(
              pressResponse.html,
              pressResponse.url || action.pressReleaseUrl,
            );
            pressReleaseBodiesFetched += pressRelease.bodyText ? 1 : 0;
          } else {
            action.rawPayload.press_release_fetch_status = pressResponse.status;
            action.rawPayload.press_release_fetch_error = pressResponse.error || `HTTP ${pressResponse.status}`;
          }
        }

        hydrated.push(mergeActionIntoRawItem(item, action, pressRelease));
      } catch (error) {
        hydrated.push({
          ...item,
          raw_payload: {
            ...item.raw_payload,
            article_fetch_error: error instanceof Error ? error.message : "OFAC action fetch failed",
          },
        });
      }
    }

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: hydrated.length,
      items: hydrated,
      diagnostics: {
        parsedFromList: listItems.length,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched,
        pressReleaseBodiesFetched,
        parserVersion: PARSER_VERSION,
        sourceUrl: OFAC_RECENT_ACTIONS_URL,
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
      diagnostics: emptyDiagnostics(0, articleBodyLimit),
      error: error instanceof Error ? error.message : "OFAC recent actions fetch failed",
    };
  }
}

export function parseOfacRecentActionsHtml(html: string, fetchedAt = new Date().toISOString()): OfacParsedRawItem[] {
  const rows = extractRowsByClass(html, "search-result");

  return rows
    .map((row): OfacParsedRawItem | null => {
      const link = readFirstLink(row, /\/recent-actions\/[0-9_a-z-]+/i);
      if (!link?.href) return null;
      const sourceUrl = normalizeOfacUrl(link.href);
      if (!sourceUrl) return null;

      const sourceUniqueId = readRecentActionId(sourceUrl);
      const dateText = textFromHtml(row.match(/<div[^>]*class=["'][^"']*margin-top-1[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
      const publishedAt = parseOfacDate(dateText);
      const category = readCategoryFromRow(row);
      const candidate = classifyOfacCandidate({
        title: link.text,
        bodyText: [dateText, category].filter(Boolean).join("\n"),
        category,
      });

      return {
        source_code: "ofac",
        source_group: "news",
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title: link.text,
        published_at: publishedAt,
        fetched_at: fetchedAt,
        body_text: null,
        dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
        raw_payload: {
          provider: "OFAC",
          parser_version: PARSER_VERSION,
          source_list_url: OFAC_RECENT_ACTIONS_URL,
          category,
          tickers: [],
          ticker_source: "none",
          candidate_class: candidate.candidateClass,
          candidate_reason: candidate.reason,
          candidate_signals: candidate.signals,
          low_value_reasons: candidate.lowValueReasons,
          sector_impact_signals: candidate.sectorImpactSignals,
        },
      };
    })
    .filter((item): item is OfacParsedRawItem => Boolean(item));
}

export function parseOfacActionHtml(html: string, url: string): OfacActionPage {
  const bodyHtml = extractFieldItemByClass(html, "field--name-field-body");
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;
  const category = readCategoryFromAction(html);
  const pressReleaseUrl = readPressReleaseUrl(html);

  return {
    title: readOfacTitle(html),
    publishedAt: readDateFromField(html, "field--name-field-release-date"),
    category,
    bodyHtml: sanitizeHtml(bodyHtml, OFAC_BASE_URL),
    bodyText,
    pressReleaseUrl,
    rawPayload: {
      canonical_url: readCanonicalUrl(html),
      full_text_html: sanitizeHtml(bodyHtml, OFAC_BASE_URL),
      analysis_text: bodyText,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: bodyText?.length || 0,
      category,
      press_release_url: pressReleaseUrl,
    },
  };
}

export function parseTreasuryPressReleaseHtml(html: string, url: string): TreasuryPressReleasePage {
  const bodyHtml = extractFieldItemByClass(html, "field--name-field-news-body");
  const bodyText = bodyHtml ? textFromHtml(bodyHtml) : null;

  return {
    title: readTreasuryTitle(html),
    publishedAt:
      readDateTimeFromField(html, "field--name-field-news-publication-date") ||
      parseOfacDate(textFromHtml(html)),
    bodyHtml: sanitizeHtml(bodyHtml, TREASURY_BASE_URL),
    bodyText,
    rawPayload: {
      canonical_url: readCanonicalUrl(html),
      source_url: normalizeTreasuryUrl(url),
      full_text_html: sanitizeHtml(bodyHtml, TREASURY_BASE_URL),
      analysis_text: bodyText,
      analysis_text_chars: bodyText?.length || 0,
    },
  };
}

function mergeActionIntoRawItem(
  item: OfacParsedRawItem,
  action: OfacActionPage,
  pressRelease: TreasuryPressReleasePage | null,
): OfacParsedRawItem {
  const category = stringValue(item.raw_payload.category) || action.category;
  const combinedText = [
    `OFAC Recent Action: ${action.title || item.title || ""}`,
    category ? `Category: ${category}` : null,
    action.bodyText,
    pressRelease?.bodyText ? `Treasury press release: ${pressRelease.title || ""}` : null,
    pressRelease?.bodyText || null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const fullTextHtml = [
    action.bodyHtml,
    pressRelease?.bodyHtml
      ? `<hr><h2>Treasury Press Release</h2>${pressRelease.bodyHtml}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const candidate = classifyOfacCandidate({
    title: action.title || item.title,
    bodyText: combinedText || action.bodyText || item.body_text,
    category,
  });

  return {
    ...item,
    title: action.title || item.title,
    published_at: action.publishedAt || pressRelease?.publishedAt || item.published_at,
    body_text: combinedText || action.bodyText || item.body_text,
    raw_payload: {
      ...item.raw_payload,
      source_name: "OFAC",
      category: category || null,
      full_text_html: fullTextHtml || action.bodyHtml,
      action_payload: action.rawPayload,
      treasury_press_release_payload: pressRelease?.rawPayload || null,
      analysis_text: combinedText || action.bodyText,
      analysis_text_version: ANALYSIS_TEXT_VERSION,
      analysis_text_chars: combinedText.length,
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

function classifyOfacCandidate({
  title,
  bodyText,
  category,
}: {
  title: string | null;
  bodyText: string | null;
  category: string | null;
}) {
  const text = normalizeFilterText([title, category, bodyText].filter(Boolean).join("\n"));
  const sectorImpactSignals = findOfacSectorImpactSignals(text);
  const lowValueReasons = findOfacLowValueReasons(text, category);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    "feed:sector",
  ];

  if (lowValueReasons.length > 0 && sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value OFAC action: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM because OFAC item has no clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: `OFAC sanctions or enforcement item with U.S. market transmission signals: ${sectorImpactSignals.join(", ")}`,
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findOfacSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["sanctions_trade_controls", /\b(sdn list|blocked persons?|designation|designating|sanctions list|secondary sanctions|executive order|general license|export control|import ban|trade restriction)\b/i],
    ["energy_commodity", /\b(oil|petroleum|natural gas|lng|refinery|refineries|tanker|vessel|shipping|commodit(?:y|ies)|shadow fleet|iranian oil|russian oil)\b/i],
    ["financial_systemic", /\b(financial institution|bank|correspondent account|payable-through account|money laundering|terrorist financing|illicit finance|settlement|civil penalty|enforcement action)\b/i],
    ["crypto_digital_assets", /\b(cryptocurrency|crypto|digital asset|virtual currency|wallet|exchange|blockchain|stablecoin)\b/i],
    ["cyber_data_risk", /\b(cyber|ransomware|malware|hacking|data theft|sanctioned cyber)\b/i],
    ["defense_geopolitics", /\b(irgc|terrorist|weapons?|uav|drone|missile|militia|north korea|russia|iran|china|cartel|narcotics trafficking)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function findOfacLowValueReasons(text: string, category: string | null) {
  const reasons: string[] = [];
  const lowerCategory = String(category || "").toLowerCase();
  const isGuidanceOnly =
    /\bnotice with regard to\b/i.test(text) ||
    /\bposting a notice\b/i.test(text) ||
    lowerCategory.includes("regulations and guidance");
  const hasDesignationOrEnforcement =
    /\b(designat(?:e|ed|ing|ions?)|added to|removed from|sdn list|blocked persons?|civil penalty|settlement|enforcement action|secondary sanctions)\b/i.test(
      text,
    );

  if (isGuidanceOnly && !hasDesignationOrEnforcement) {
    reasons.push("administrative_guidance_notice");
  }

  return reasons;
}

async function fetchHtml(url: string, baseUrl: string) {
  const normalizedUrl = normalizeRequestUrl(url, baseUrl) || url;
  const response = await fetch(normalizedUrl, {
    cache: "no-store",
    headers: ofacFetchHeaders(),
  });
  const html = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    url: response.url || normalizedUrl,
    html: response.ok ? html : "",
    error: response.ok ? undefined : response.statusText || "OFAC request failed",
  };
}

function emptyDiagnostics(parsedFromList: number, articleBodiesRequested: number) {
  return {
    parsedFromList,
    articleBodiesRequested,
    articleBodiesFetched: 0,
    pressReleaseBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
    sourceUrl: OFAC_RECENT_ACTIONS_URL,
    sourceUrls: [],
    listPagesFetched: 0,
  };
}

function buildOfacRecentActionsUrl(page: number) {
  if (page <= 0) return OFAC_RECENT_ACTIONS_URL;
  const url = new URL(OFAC_RECENT_ACTIONS_URL);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function extractRowsByClass(html: string, className: string) {
  const rows: string[] = [];
  const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const row = extractBalancedElementAt(html, match.index, "div");
    if (row) rows.push(row);
  }

  return rows;
}

function extractFieldItemByClass(html: string, fieldClass: string) {
  const fieldPattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${escapeRegExp(fieldClass)}\\b[^"']*["'][^>]*>`, "i");
  const fieldMatch = fieldPattern.exec(html);
  if (!fieldMatch) return null;

  const fieldHtml = extractBalancedElementAt(html, fieldMatch.index, "div");
  if (!fieldHtml) return null;

  const itemPattern = /<div\b[^>]*class=["'][^"']*\bfield__item\b[^"']*["'][^>]*>/i;
  const itemMatch = itemPattern.exec(fieldHtml);
  if (!itemMatch) return fieldHtml;

  return extractBalancedElementAt(fieldHtml, itemMatch.index, "div") || fieldHtml;
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

function readCategoryFromRow(row: string) {
  const links = [...row.matchAll(/<a\b[^>]*href=["'][^"']*\/recent-actions\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const category = links[1]?.[1] ? textFromHtml(links[1][1]) : null;
  return category || null;
}

function readCategoryFromAction(html: string) {
  const match = /<a\b[^>]*href=["'][^"']*\/recent-actions\/[^"']+["'][^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/a>/i.exec(
    html,
  );
  return match?.[1] ? textFromHtml(match[1]) : null;
}

function readPressReleaseUrl(html: string) {
  const fieldHtml = extractFieldItemByClass(html, "field--name-field-press-release-link");
  const href = fieldHtml?.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href ? normalizeTreasuryUrl(href) || normalizeUrl(href, TREASURY_BASE_URL) : null;
}

function readOfacTitle(html: string) {
  return (
    textFromHtml(html.match(/<h1\b[^>]*>[\s\S]*?<span[^>]*class=["'][^"']*\btreas-page-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h1>/i)?.[1]) ||
    readMetaContent(html, "og:title") ||
    readTitleTag(html)
  );
}

function readTreasuryTitle(html: string) {
  return (
    textFromHtml(html.match(/<h2\b[^>]*class=["'][^"']*\buswds-page-title\b[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h2>/i)?.[1]) ||
    readMetaContent(html, "og:title") ||
    readTitleTag(html)
  );
}

function readDateTimeFromField(html: string, fieldClass: string) {
  const fieldPattern = new RegExp(`${escapeRegExp(fieldClass)}[\\s\\S]{0,800}<time\\b[^>]*datetime=["']([^"']+)["']`, "i");
  const value = fieldPattern.exec(html)?.[1];
  return value ? parseIsoDate(value) : null;
}

function readDateFromField(html: string, fieldClass: string) {
  const dateTime = readDateTimeFromField(html, fieldClass);
  if (dateTime) return dateTime;

  const fieldHtml = extractFieldItemByClass(html, fieldClass);
  return parseOfacDate(textFromHtml(fieldHtml));
}

function readCanonicalUrl(html: string) {
  const href = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href ? decodeHtml(href) : null;
}

function readMetaContent(html: string, name: string) {
  const escaped = escapeRegExp(name);
  const pattern = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const match = pattern.exec(html);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function readTitleTag(html: string) {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? textFromHtml(value)?.replace(/\s*\|\s*(Office of Foreign Assets Control|U\.S\. Department of the Treasury)\s*$/i, "") || null : null;
}

function parseOfacDate(value: string | null | undefined) {
  if (!value) return null;
  const shortDateMatch = decodeHtml(value).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (shortDateMatch) {
    const [, month, day, year] = shortDateMatch;
    const parsed = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00.000Z`);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  const dateMatch = decodeHtml(value).match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+\d{4}\b/i);
  if (!dateMatch) return parseIsoDate(value);
  const parsed = Date.parse(`${dateMatch[0]} 12:00:00 UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(decodeHtml(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeOfacUrl(value: string | null | undefined) {
  return normalizeUrl(value, OFAC_BASE_URL);
}

function normalizeTreasuryUrl(value: string | null | undefined) {
  return normalizeUrl(value, TREASURY_BASE_URL);
}

function normalizeUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeRequestUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  return readRecentActionId(text) || text;
}

function readRecentActionId(url: string) {
  return url.match(/\/recent-actions\/([^/?#]+)(?:$|[?#/])/i)?.[1] || null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `ofac:${sourceUniqueId || sourceUrl.toLowerCase()}`;
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

function sanitizeHtml(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;

  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])(.*?)\2/gi, (_match, attr: string, quote: string, rawValue: string) => {
      const absolute = normalizeUrl(rawValue, baseUrl) || rawValue;
      return ` ${attr.toLowerCase()}=${quote}${escapeHtmlAttribute(absolute)}${quote}`;
    });
}

function normalizeFilterText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
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

function ofacFetchHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 OFAC parser",
  };
}
