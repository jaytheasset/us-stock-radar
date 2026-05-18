const DOJ_API_URL = "https://www.justice.gov/api/v1/press_releases.json";

const PARSER_VERSION = "doj_press_release_parser_v1";
const ANALYSIS_TEXT_VERSION = "doj_analysis_text_v1";

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

type DojApiResult = {
  uuid?: unknown;
  number?: unknown;
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

export type DojTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type DojParsedRawItem = {
  source_code: "doj";
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

export type DojRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: DojParsedRawItem[];
  diagnostics: {
    apiUrl: string;
    parsedFromApi: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    apiCount?: number | null;
  };
  error?: string;
};

export async function fetchDojRawItems(options: FetchOptions = {}): Promise<DojRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const limit = clampNumber(options.limit ?? 10, 1, 50);
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const includeArticleBody = options.includeArticleBody ?? false;
  const articleBodyLimit = includeArticleBody
    ? clampNumber(options.articleBodyLimit ?? limit, 0, limit)
    : 0;
  const apiUrl = sourceUniqueId
    ? buildDojApiItemUrl(sourceUniqueId)
    : buildDojApiUrl(Math.max(limit, articleBodyLimit, 10));

  try {
    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: dojFetchHeaders(),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: emptyDiagnostics(apiUrl, 0, articleBodyLimit),
        error: response.statusText || "DOJ press release API request failed",
      };
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const results = Array.isArray(parsed.results) ? (parsed.results as DojApiResult[]) : [];
    const apiCount = readApiCount(parsed);
    const items = results
      .map((item) => parseDojApiItem(item, fetchedAt))
      .filter((item): item is DojParsedRawItem => Boolean(item))
      .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
      .slice(0, limit)
      .map((item, index) => {
        if (index >= articleBodyLimit) {
          return {
            ...item,
            body_text: null,
            raw_payload: {
              ...item.raw_payload,
              full_text_html: null,
              analysis_text: null,
              article_body_deferred: true,
            },
          };
        }
        return item;
      });

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: items.length,
      items,
      diagnostics: {
        apiUrl,
        parsedFromApi: results.length,
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
      diagnostics: emptyDiagnostics(apiUrl, 0, articleBodyLimit),
      error: error instanceof Error ? error.message : "DOJ press release API fetch failed",
    };
  }
}

function parseDojApiItem(item: DojApiResult, fetchedAt: string): DojParsedRawItem | null {
  const title = stringValue(item.title);
  const sourceUrl = normalizeDojUrl(stringValue(item.url));
  if (!title || !sourceUrl) return null;

  const sourceUniqueId = stringValue(item.uuid) || stringValue(item.number) || readSlug(sourceUrl);
  const bodyHtml = stringValue(item.body);
  const bodyText = textFromHtml(bodyHtml);
  const teaser = textFromHtml(stringValue(item.teaser));
  const publishedAt = parseDojDate(item.date) || readDateTimeTag(item.created) || readDateTimeTag(item.changed);
  const components = readComponentNames(item.component);
  const topics = readTopicNames(item.topic);
  const tickers = dedupeTickerMentions(extractTickerMentions([title, bodyText].filter(Boolean).join("\n")));
  const candidate = classifyDojCandidate({
    title,
    bodyText,
    teaser,
    components,
    topics,
    tickers,
  });

  return {
    source_code: "doj",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title,
    published_at: publishedAt,
    fetched_at: fetchedAt,
    body_text: bodyText,
    dedupe_key: buildDedupeKey(sourceUniqueId, sourceUrl),
    raw_payload: {
      provider: "DOJ",
      parser_version: PARSER_VERSION,
      api_url: DOJ_API_URL,
      release_number: stringValue(item.number),
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

function classifyDojCandidate({
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
  tickers: DojTickerMention[];
}) {
  const text = normalizeFilterText([title, teaser, bodyText, components.join(" "), topics.join(" ")].join("\n"));
  const hasUsTicker = tickers.some((ticker) => ticker.usListed);
  const sectorImpactSignals = findDojSectorImpactSignals(text);
  const lowValueReasons = findDojLowValueReasons(text, sectorImpactSignals, hasUsTicker);
  const companyMarketSignal = hasDojCompanyMarketSignal(text);
  const signals = [
    ...sectorImpactSignals.map((signal) => `sector:${signal}`),
    ...lowValueReasons.map((reason) => `low_value:${reason}`),
    ...(hasUsTicker ? ["us_ticker", "feed:event"] : ["feed:sector"]),
  ];

  if (hasUsTicker) {
    return {
      candidateClass: "company_event",
      reason: "U.S.-listed ticker found in DOJ release body.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.includes("local_healthcare_fraud")) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value DOJ item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && !companyMarketSignal) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value DOJ item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (lowValueReasons.length > 0 && sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: `Filtered before LLM as low-value DOJ item: ${lowValueReasons.join(", ")}`,
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  if (sectorImpactSignals.length === 0) {
    return {
      candidateClass: "low_value_filtered",
      reason: "Filtered before LLM because DOJ item has no clear U.S. market transmission path.",
      signals,
      lowValueReasons,
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "sector_theme_policy_candidate",
    reason: `DOJ enforcement item with U.S. market transmission signals: ${sectorImpactSignals.join(", ")}`,
    signals,
    lowValueReasons,
    sectorImpactSignals,
  };
}

function findDojSectorImpactSignals(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["antitrust_competition", /\b(antitrust|monopoly|monopolization|price[- ]fixing|bid rigging|competition|merger challenge|market allocation)\b/i],
    ["securities_financial_fraud", /\b(securities fraud|market manipulation|insider trading|investment fraud|ponzi|broker[- ]dealer fraud|investment adviser fraud)\b/i],
    ["fcpa_foreign_bribery", /\b(foreign corrupt practices act|fcpa|foreign bribery|bribe|anti-bribery)\b/i],
    ["false_claims_healthcare", /\b(false claims act|qui tam|pharmaceutical|drug pricing|medical device|kickback|anti-kickback)\b/i],
    ["cyber_crypto", /\b(cyber|ransomware|malware|botnet|data breach|cryptocurrency|crypto|digital asset|virtual currency)\b/i],
    ["export_sanctions", /\b(export control|sanctions|iran|russia|china|north korea|restricted technology|itar|ear)\b/i],
    ["defense_procurement", /\b(defense contract|government contract|procurement fraud|department of defense|dod|military contract|army contract|navy contract|air force contract)\b/i],
    ["public_company_legal", /\b(inc\.|corporation|corp\.|company|llc|ltd\.)\b.{0,120}\b(agreed to pay|settlement|settle|pleaded guilty|guilty plea|civil penalty|criminal fine|deferred prosecution|non-prosecution)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function findDojLowValueReasons(text: string, sectorImpactSignals: string[], hasUsTicker: boolean) {
  if (hasUsTicker) return [];

  const rules: Array<[string, RegExp]> = [
    ["personnel_or_office_notice", /\b(appointed|appointment|serve on|advisory committee|u\.s\. attorney|district of)\b/i],
    ["local_individual_crime", /\b(arrested|charged by criminal complaint|sentenced|pleaded guilty|indicted|detained)\b/i],
    ["violent_or_child_crime", /\b(child exploitation|firearms offense|carjacking|murder|assault|robbery|sex trafficking)\b/i],
    ["routine_drug_case", /\b(possession with intent|controlled substance|fentanyl|methamphetamine|cocaine|drug trafficking)\b/i],
    ["routine_border_or_immigration_case", /\b(border-related cases|immigration cases|human smuggling|illegal reentry|importation of controlled substances)\b/i],
    ["local_victim_scam", /\b(lottery scam|romance scam|elderly victim|retiree|tax return preparer|false tax returns)\b/i],
    ["local_healthcare_fraud", /\b(home health care agency owner|medicare fraud scheme|medicaid fraud allegations|day treatment program)\b/i],
  ];

  return rules.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function hasDojCompanyMarketSignal(text: string) {
  return [
    /\b(?:nasdaq|nyse|otc|publicly traded|issuer|shareholders?)\b/i,
    /\b(?:inc\.|corp\.|corporation|company|plc|ltd\.|llc)\b.{0,180}\b(?:agreed to pay|settlement|settle|pleaded guilty|guilty plea|civil penalty|criminal fine|deferred prosecution|non-prosecution|antitrust|false claims act|fcpa|foreign corrupt practices act)\b/i,
    /\b(?:antitrust|merger challenge|market allocation|price[- ]fixing|bid rigging)\b/i,
    /\b(?:export control|sanctions|restricted technology|itar|ear|russia|china|iran|north korea)\b.{0,180}\b(?:company|corporation|inc\.|semiconductor|technology|shipping|energy|bank|financial institution)\b/i,
  ].some((pattern) => pattern.test(text));
}

function buildDojApiUrl(pageSize: number) {
  const url = new URL(DOJ_API_URL);
  url.searchParams.set("pagesize", String(clampNumber(pageSize, 1, 50)));
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
    .map((item) => (typeof item === "string" ? item : stringValue(readRecord(item)?.name)))
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

function extractTickerMentions(text: string): DojTickerMention[] {
  const mentions: DojTickerMention[] = [];
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

function dedupeTickerMentions(tickers: DojTickerMention[]) {
  const seen = new Set<string>();
  const result: DojTickerMention[] = [];

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
  return `doj:${sourceUniqueId || sourceUrl.toLowerCase()}`;
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

function dojFetchHeaders() {
  return {
    Accept: "application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 DOJ parser",
  };
}

function emptyDiagnostics(apiUrl: string, parsedFromApi: number, articleBodiesRequested: number) {
  return {
    apiUrl,
    parsedFromApi,
    articleBodiesRequested,
    articleBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
  };
}
