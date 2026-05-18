const DOJ_API_URL = "https://www.justice.gov/api/v1/press_releases.json";
const DOJ_API_PAGE_SIZE = 50;
const DEA_COMPONENT_NAME = "Drug Enforcement Administration (DEA)";

const PARSER_VERSION = "dea_doj_api_parser_v1";
const ANALYSIS_TEXT_VERSION = "dea_analysis_text_v1";

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type DeaApiResult = {
  uuid?: unknown;
  title?: unknown;
  url?: unknown;
  body?: unknown;
  teaser?: unknown;
  date?: unknown;
  created?: unknown;
  changed?: unknown;
  component?: unknown;
  topic?: unknown;
  attachment?: unknown;
};

export type DeaTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type DeaParsedRawItem = {
  source_code: "dea";
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

export type DeaRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: DeaParsedRawItem[];
  diagnostics: {
    apiUrls: string[];
    parsedFromApi: number;
    deaComponentMatches: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    apiCount?: number | null;
  };
  error?: string;
};

export async function fetchDeaRawItems(options: FetchOptions = {}): Promise<DeaRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 10, 1, 50);
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const apiUrls: string[] = [];

  try {
    if (sourceUniqueId) {
      const apiUrl = buildDojApiItemUrl(sourceUniqueId);
      apiUrls.push(apiUrl);
      const response = await fetch(apiUrl, {
        cache: "no-store",
        headers: deaFetchHeaders(),
      });
      const text = await response.text();
      if (!response.ok) {
        return failureResult(response.status, fetchedAt, apiUrls, articleBodyLimit, response.statusText);
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;
      const results = Array.isArray(parsed.results) ? (parsed.results as DeaApiResult[]) : [];
      const item = results
        .map((entry) => parseDeaApiItem(entry, fetchedAt))
        .find((entry): entry is DeaParsedRawItem => Boolean(entry));
      const items = item ? [deferArticleBody(item, 0, articleBodyLimit)] : [];

      return {
        ok: true,
        status: 200,
        fetchedAt,
        count: items.length,
        items,
        diagnostics: {
          apiUrls,
          parsedFromApi: results.length,
          deaComponentMatches: items.length,
          articleBodiesRequested: articleBodyLimit,
          articleBodiesFetched: items.filter((entry) => entry.body_text).length,
          parserVersion: PARSER_VERSION,
          apiCount: readApiCount(parsed),
        },
      };
    }

    const apiItems: DeaApiResult[] = [];
    const deaItems: DeaParsedRawItem[] = [];
    const seen = new Set<string>();
    let apiCount: number | null = null;

    for (let page = 0; page < maxPagesToFetch(limit); page += 1) {
      const apiUrl = buildDojApiListUrl(page);
      apiUrls.push(apiUrl);
      const response = await fetch(apiUrl, {
        cache: "no-store",
        headers: deaFetchHeaders(),
      });
      const text = await response.text();
      if (!response.ok) {
        if (page === 0) {
          return failureResult(response.status, fetchedAt, apiUrls, articleBodyLimit, response.statusText);
        }
        break;
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (apiCount === null) apiCount = readApiCount(parsed);
      const results = Array.isArray(parsed.results) ? (parsed.results as DeaApiResult[]) : [];
      apiItems.push(...results);

      for (const entry of results) {
        const item = parseDeaApiItem(entry, fetchedAt);
        if (!item) continue;
        const key = item.source_unique_id || item.source_url;
        if (seen.has(key)) continue;
        seen.add(key);
        deaItems.push(item);
        if (deaItems.length >= limit) break;
      }

      if (deaItems.length >= limit || results.length < DOJ_API_PAGE_SIZE) break;
      await delay(175);
    }

    const items = deaItems.slice(0, limit).map((item, index) => deferArticleBody(item, index, articleBodyLimit));

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: items.length,
      items,
      diagnostics: {
        apiUrls,
        parsedFromApi: apiItems.length,
        deaComponentMatches: deaItems.length,
        articleBodiesRequested: articleBodyLimit,
        articleBodiesFetched: items.filter((item) => item.body_text).length,
        parserVersion: PARSER_VERSION,
        apiCount,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: emptyDiagnostics(apiUrls, articleBodyLimit),
      error: error instanceof Error ? error.message : "DEA press release fetch failed",
    };
  }
}

function parseDeaApiItem(item: DeaApiResult, fetchedAt: string): DeaParsedRawItem | null {
  const components = readComponentNames(item.component);
  if (!components.some((component) => component.toLowerCase() === DEA_COMPONENT_NAME.toLowerCase())) {
    return null;
  }

  const title = stringValue(item.title);
  const sourceUrl = normalizeDojUrl(stringValue(item.url));
  if (!title || !sourceUrl) return null;

  const sourceUniqueId = stringValue(item.uuid) || readSlug(sourceUrl);
  const bodyHtml = stringValue(item.body);
  const bodyText = textFromHtml(bodyHtml);
  const teaser = textFromHtml(stringValue(item.teaser));
  const publishedAt = parseDojDate(item.date) || readDateTimeTag(item.created) || readDateTimeTag(item.changed);
  const topics = readTopicNames(item.topic);
  const tickers = dedupeTickerMentions(extractTickerMentions([title, bodyText].filter(Boolean).join("\n")));
  const candidate = classifyDeaCandidate({
    title,
    bodyText,
    teaser,
    components,
    topics,
    tickers,
  });

  return {
    source_code: "dea",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title,
    published_at: publishedAt,
    fetched_at: fetchedAt,
    body_text: bodyText,
    dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
    raw_payload: {
      provider: "DEA",
      source_name: "DEA",
      parser_version: PARSER_VERSION,
      api_url: DOJ_API_URL,
      api_source: "DOJ press release API",
      component: components,
      topic: topics,
      teaser,
      full_text_html: sanitizeHtml(bodyHtml),
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

function classifyDeaCandidate({
  title,
  bodyText,
  teaser,
  components,
  topics,
  tickers,
}: {
  title: string;
  bodyText: string | null;
  teaser: string | null;
  components: string[];
  topics: string[];
  tickers: DeaTickerMention[];
}) {
  const text = normalizeFilterText([title, teaser, bodyText, components.join(" "), topics.join(" ")].join("\n"));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const sectorImpactSignals = findDeaSectorImpactSignals(text);
  const lowValueReasons = findDeaLowValueReasons(text, sectorImpactSignals, hasUsTicker);
  const isRoutineLocalCase = lowValueReasons.some((reason) =>
    reason === "routine_individual_drug_case" || reason === "local_drug_trafficking_case"
  );
  const hasStrongMarketSignal = sectorImpactSignals.some((signal) =>
    signal === "controlled_substances_policy" ||
    signal === "pharma_corporate_enforcement" ||
    signal === "public_health_drug_supply" ||
    signal === "major_transnational_security"
  );
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...(hasUsTicker ? ["us_ticker", "feed:event"] : ["feed:sector"]),
  ];

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in DEA-related release body.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (isRoutineLocalCase && !hasStrongMarketSignal) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as routine DEA criminal case: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value DEA item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM because DEA item has no clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: `DEA policy or enforcement item with possible U.S. market transmission signals: ${sectorImpactSignals.join(", ")}`,
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findDeaSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["controlled_substances_policy", /\b(drug scheduling|reschedul(?:e|ing)|marijuana rescheduling|aggregate production quota|production quota|quota for controlled substances|telemedicine flexibilit(?:y|ies)|prescription of controlled medications|rulemaking|final rule|proposed rule)\b/i],
    ["pharma_corporate_enforcement", /\b(immediate suspension order|dea registrant|retail drug store|pharmacy chain|drug manufacturer|opioid settlement|agrees? to pay|civil settlement|false claims act|unlawful prescriptions?|controlled substance prescriptions?|diversion control division)\b/i],
    ["public_health_drug_supply", /\b(national drug threat assessment|drug shortage|public health emergency|dea launches fentanyl free america|launch(?:es|ed) fentanyl free america|fentanyl free america initiative to combat|xylazine|pill press|precursor chemicals?)\b/i],
    ["major_transnational_security", /\b(foreign terrorist organization|narcoterror(?:ism|ist)|sanctions|precursor chemicals?|high-ranking (?:cjng|sinaloa|cartel)|cartel leader|international drug distribution)\b/i],
    ["cyber_darknet_crypto", /\b(dark web|darknet|cryptocurrency|crypto|virtual currency|online pharmacy|illegal online pharmacies|cyber)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function findDeaLowValueReasons(text: string, _sectorImpactSignals: string[], hasUsTicker: boolean) {
  if (hasUsTicker) return [];

  const rules: Array<[string, RegExp]> = [
    ["routine_individual_drug_case", /\b(arrested|charged|sentenced|pleaded guilty|guilty plea|indicted|convicted|federal complaint)\b/i],
    ["local_drug_trafficking_case", /\b(possession with intent|drug trafficking|distribution of fentanyl|distribution of methamphetamine|distribution of cocaine|firearm offenses?|seized|seizure)\b/i],
    ["local_take_back_day", /\b(take back day|unwanted medications|unused medications|expired medications|collection sites?)\b/i],
    ["local_prevention_or_outreach", /\b(red ribbon|community outreach|family summit|drug prevention|public awareness campaign)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function deferArticleBody(item: DeaParsedRawItem, index: number, articleBodyLimit: number): DeaParsedRawItem {
  if (index < articleBodyLimit) return item;
  return {
    ...item,
    body_text: null,
    raw_payload: {
      ...item.raw_payload,
      full_text_html: null,
      analysis_text: null,
      analysis_text_chars: 0,
      article_body_deferred: true,
    },
  };
}

function maxPagesToFetch(limit: number) {
  if (limit <= 5) return 3;
  if (limit <= 20) return 8;
  return 12;
}

function buildDojApiListUrl(page: number) {
  const url = new URL(DOJ_API_URL);
  url.searchParams.set("pagesize", String(DOJ_API_PAGE_SIZE));
  url.searchParams.set("page", String(Math.max(0, Math.floor(page))));
  url.searchParams.set("sort", "date");
  url.searchParams.set("direction", "DESC");
  return url.toString();
}

function buildDojApiItemUrl(sourceUniqueId: string) {
  return `https://www.justice.gov/api/v1/press_releases/${encodeURIComponent(sourceUniqueId)}.json`;
}

function readApiCount(parsed: Record<string, unknown>) {
  const resultset = readRecord(readRecord(parsed.metadata)?.resultset);
  const count = Number(resultset?.count);
  return Number.isFinite(count) ? count : null;
}

function readComponentNames(value: unknown) {
  return toArray(value)
    .map((item) => stringValue(readRecord(item)?.name))
    .filter((item): item is string => Boolean(item));
}

function readTopicNames(value: unknown) {
  return toArray(value)
    .map((item) => (typeof item === "string" ? textFromHtml(item) : stringValue(readRecord(item)?.name)))
    .filter((item): item is string => Boolean(item));
}

function readDateTimeTag(value: unknown) {
  const text = stringValue(value);
  const datetime = text?.match(/datetime=["']([^"']+)["']/i)?.[1];
  return parseIsoDate(datetime || text);
}

function parseDojDate(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  return parseIsoDate(text);
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(decodeHtml(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function extractTickerMentions(text: string): DeaTickerMention[] {
  const mentions: DeaTickerMention[] = [];
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

function dedupeTickerMentions(tickers: DeaTickerMention[]) {
  const seen = new Set<string>();
  const result: DeaTickerMention[] = [];

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

function normalizeDojUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), "https://www.justice.gov");
    url.protocol = "https:";
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
  return text;
}

function readSlug(url: string) {
  return url.split("/").filter(Boolean).pop() || null;
}

function buildDedupeKey(sourceUniqueId: string | null, sourceUrl: string) {
  return `dea:${sourceUniqueId || sourceUrl.toLowerCase()}`;
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

function sanitizeHtml(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])(.*?)\2/gi, (_match, attr: string, quote: string, rawValue: string) => {
      const absolute = normalizeDojUrl(rawValue) || rawValue;
      return ` ${attr.toLowerCase()}=${quote}${escapeHtmlAttribute(absolute)}${quote}`;
    });
}

function normalizeFilterText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
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

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function deaFetchHeaders() {
  return {
    Accept: "application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 DEA parser",
  };
}

function emptyDiagnostics(apiUrls: string[], articleBodiesRequested: number) {
  return {
    apiUrls,
    parsedFromApi: 0,
    deaComponentMatches: 0,
    articleBodiesRequested,
    articleBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
  };
}

function failureResult(
  status: number,
  fetchedAt: string,
  apiUrls: string[],
  articleBodiesRequested: number,
  error: string,
): DeaRawFetchResult {
  return {
    ok: false,
    status,
    fetchedAt,
    count: 0,
    items: [],
    diagnostics: emptyDiagnostics(apiUrls, articleBodiesRequested),
    error: error || "DEA press release API request failed",
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
