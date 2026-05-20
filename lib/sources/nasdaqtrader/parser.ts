import { XMLParser } from "fast-xml-parser";

const NASDAQ_TRADER_BASE_URL = "https://www.nasdaqtrader.com";
const NASDAQ_TRADE_HALTS_URL = `${NASDAQ_TRADER_BASE_URL}/rss.aspx?feed=tradehalts`;

const PARSER_VERSION = "nasdaq_trader_trade_halts_parser_v3";
const ANALYSIS_TEXT_VERSION = "nasdaq_trader_analysis_text_v3";

type FetchOptions = {
  limit?: number;
  sourceUniqueId?: string;
  haltDate?: string;
  resumptionDate?: string;
  includeArticleBody?: boolean;
  articleBodyLimit?: number;
};

export type NasdaqTraderTickerMention = {
  exchange: string;
  symbol: string;
  raw: string;
  usListed: boolean;
};

export type NasdaqTraderParsedRawItem = {
  source_code: "nasdaq_trader";
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

export type NasdaqTraderRawFetchResult = {
  ok: boolean;
  status: number;
  fetchedAt: string;
  count: number;
  items: NasdaqTraderParsedRawItem[];
  diagnostics: {
    parsedFromFeed: number;
    articleBodiesRequested: number;
    articleBodiesFetched: number;
    parserVersion: string;
    skippedNonEnglish: number;
    sourceUrl: string;
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

type TradeHaltFields = {
  haltDate: string | null;
  haltTime: string | null;
  issueSymbol: string | null;
  issueName: string | null;
  market: string | null;
  reasonCode: string | null;
  pauseThresholdPrice: string | null;
  resumptionDate: string | null;
  resumptionQuoteTime: string | null;
  resumptionTradeTime: string | null;
};

export async function fetchNasdaqTraderRawItems(
  options: FetchOptions = {},
): Promise<NasdaqTraderRawFetchResult> {
  const fetchedAt = new Date().toISOString();
  const sourceUniqueId = normalizeSourceUniqueId(options.sourceUniqueId);
  const limit = sourceUniqueId ? 1 : clampNumber(options.limit ?? 25, 1, 100);
  const sourceUrl = buildTradeHaltsUrl(options);

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: nasdaqTraderFetchHeaders(),
    });
    const xml = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        fetchedAt,
        count: 0,
        items: [],
        diagnostics: emptyDiagnostics(response.status, 0, sourceUrl),
        error: response.statusText || "Nasdaq Trader trade halt RSS request failed",
      };
    }

    const parsedItems = parseNasdaqTraderRssXml(xml, fetchedAt, sourceUrl);
    const selectedItems = parsedItems
      .filter((item) => !sourceUniqueId || normalizeSourceUniqueId(item.source_unique_id) === sourceUniqueId)
      .slice(0, limit);

    return {
      ok: true,
      status: 200,
      fetchedAt,
      count: selectedItems.length,
      items: selectedItems,
      diagnostics: {
        parsedFromFeed: parsedItems.length,
        articleBodiesRequested: 0,
        articleBodiesFetched: 0,
        parserVersion: PARSER_VERSION,
        skippedNonEnglish: 0,
        sourceUrl,
        feedStats: [
          {
            label: "Nasdaq Trader trade halts",
            ok: true,
            status: response.status,
            itemCount: parsedItems.length,
          },
        ],
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      fetchedAt,
      count: 0,
      items: [],
      diagnostics: emptyDiagnostics(0, 0, sourceUrl),
      error: error instanceof Error ? error.message : "Nasdaq Trader trade halt RSS fetch failed",
    };
  }
}

export function parseNasdaqTraderRssXml(
  xml: string,
  fetchedAt = new Date().toISOString(),
  sourceUrl = NASDAQ_TRADE_HALTS_URL,
) {
  const parser = new XMLParser({
    attributeNamePrefix: "@_",
    ignoreAttributes: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = readRecord(readRecord(parsed.rss)?.channel);
  const rawItems = toArray(channel?.item);

  return rawItems
    .map((rawItem): NasdaqTraderParsedRawItem | null => {
      const item = readRecord(rawItem);
      if (!item) return null;
      const fields = readTradeHaltFields(item);
      if (!fields.issueSymbol || !fields.haltDate || !fields.haltTime) return null;

      const sourceUniqueId = buildTradeHaltId(fields);
      const haltGroupKey = buildTradeHaltGroupKey(fields);
      const publishedAt = parseNasdaqDateTime(fields.haltDate, fields.haltTime) || parseNasdaqDate(readString(item.pubDate));
      const reasonDescription = reasonDescriptionForCode(fields.reasonCode);
      const ticker = buildTickerMention(fields);
      const tickers = ticker ? [ticker] : [];
      const bodyText = buildTradeHaltText(fields, reasonDescription);
      const candidate = classifyNasdaqTraderCandidate(fields, reasonDescription);
      const fullTextHtml = sanitizeArticleHtml(readString(item.description)) || htmlFromText(bodyText);

      return {
        source_code: "nasdaq_trader" as const,
        source_group: "news" as const,
        source_unique_id: sourceUniqueId,
        source_url: sourceUrl,
        title: buildTradeHaltTitle(fields),
        published_at: publishedAt,
        fetched_at: fetchedAt,
        body_text: bodyText,
        dedupe_key: buildDedupeKey(sourceUniqueId),
        raw_payload: {
          provider: "Nasdaq Trader",
          source_name: "Nasdaq Trader",
          parser_version: PARSER_VERSION,
          feed_label: "Trade Halts",
          feed_url: sourceUrl,
          full_text_html: fullTextHtml,
          analysis_text: bodyText,
          analysis_text_version: ANALYSIS_TEXT_VERSION,
          analysis_text_chars: bodyText.length,
          trade_halt: fields,
          halt_group_key: haltGroupKey,
          reason_description: reasonDescription,
          tickers,
          body_tickers: tickers,
          metadata_tickers: [],
          ticker_source: "nasdaq_trader_trade_halt_feed",
          candidate_class: candidate.candidateClass,
          candidate_reason: candidate.reason,
          candidate_signals: candidate.signals,
          low_value_reasons: candidate.lowValueReasons,
          halt_feed_policy: candidate.feedPolicy,
          sector_impact_signals: candidate.sectorImpactSignals,
        },
      };
    })
    .filter((item): item is NasdaqTraderParsedRawItem => Boolean(item));
}

function readTradeHaltFields(item: Record<string, unknown>): TradeHaltFields {
  return {
    haltDate: readString(item["ndaq:HaltDate"]),
    haltTime: normalizeTimeText(readString(item["ndaq:HaltTime"])),
    issueSymbol: normalizeSymbol(readString(item["ndaq:IssueSymbol"]) || readString(item.title)),
    issueName: readString(item["ndaq:IssueName"]),
    market: readString(item["ndaq:Market"]),
    reasonCode: normalizeReasonCode(readString(item["ndaq:ReasonCode"])),
    pauseThresholdPrice: readString(item["ndaq:PauseThresholdPrice"]),
    resumptionDate: readString(item["ndaq:ResumptionDate"]),
    resumptionQuoteTime: normalizeTimeText(readString(item["ndaq:ResumptionQuoteTime"])),
    resumptionTradeTime: normalizeTimeText(readString(item["ndaq:ResumptionTradeTime"])),
  };
}

function classifyNasdaqTraderCandidate(fields: TradeHaltFields, reasonDescription: string | null) {
  const reasonCode = fields.reasonCode || "";
  const lowValueReasons = volatilityPauseCodes.has(reasonCode)
    ? ["volatility_trading_pause"]
    : updateOnlyHaltCodes.has(reasonCode)
      ? ["halt_resumption_update_only"]
      : [];
  const sectorImpactSignals: string[] = [];
  const signals = [
    `halt_code:${reasonCode || "unknown"}`,
    ...(lowValueReasons.length ? lowValueReasons.map((reason) => `low_value:${reason}`) : []),
    "official_exchange_source",
    "us_ticker",
  ];

  if (materialHaltCodes.has(reasonCode)) {
    return {
      candidateClass: "company_event",
      reason: `Nasdaq Trader halt code ${reasonCode}: ${reasonDescription || "material halt"}.`,
      signals,
      lowValueReasons,
      feedPolicy: {
        global_feed: true,
        event_action: "create_feed_event",
        reason: "Material halt code selected for global feed coverage.",
      },
      sectorImpactSignals,
    };
  }

  if (volatilityPauseCodes.has(reasonCode)) {
    return {
      candidateClass: "halt_status_log",
      reason: `Nasdaq Trader volatility pause excluded from global feed: ${reasonCode} (${reasonDescription || "volatility pause"}).`,
      signals,
      lowValueReasons,
      feedPolicy: {
        global_feed: false,
        event_action: "status_log_only",
        reason: "Volatility pauses are too frequent for the global feed.",
      },
      sectorImpactSignals,
    };
  }

  if (updateOnlyHaltCodes.has(reasonCode)) {
    return {
      candidateClass: "halt_update_only",
      reason: `Nasdaq Trader halt update should update an existing halt event, not create a new feed card: ${reasonCode} (${reasonDescription || "halt update"}).`,
      signals,
      lowValueReasons,
      feedPolicy: {
        global_feed: false,
        event_action: "update_existing_halt",
        reason: "Resumption and update notices should not duplicate the original halt card.",
      },
      sectorImpactSignals,
    };
  }

  return {
    candidateClass: "halt_status_log",
    reason: reasonDescription
      ? `Nasdaq Trader trading halt or pause: ${reasonCode} (${reasonDescription}).`
      : "Nasdaq Trader trading halt or pause.",
    signals,
    lowValueReasons,
    feedPolicy: {
      global_feed: false,
      event_action: "review_before_feed",
      reason: "Unknown or unsupported halt code is stored for traceability but not sent to global feed by default.",
    },
    sectorImpactSignals,
  };
}

function buildTradeHaltText(fields: TradeHaltFields, reasonDescription: string | null) {
  const parts = [
    `Nasdaq Trader trade halt notice for ${fields.issueSymbol}${fields.issueName ? ` (${fields.issueName})` : ""}.`,
    `Market: ${fields.market || "unknown"}.`,
    `Reason code: ${fields.reasonCode || "unknown"}${reasonDescription ? ` - ${reasonDescription}` : ""}.`,
    `Halt time: ${[fields.haltDate, fields.haltTime].filter(Boolean).join(" ") || "unknown"} Eastern Time.`,
    fields.pauseThresholdPrice ? `Pause threshold price: ${fields.pauseThresholdPrice}.` : "",
    fields.resumptionTradeTime
      ? `Resumption trade time: ${[fields.resumptionDate, fields.resumptionTradeTime].filter(Boolean).join(" ")} Eastern Time.`
      : "",
    fields.resumptionQuoteTime
      ? `Resumption quote time: ${[fields.resumptionDate, fields.resumptionQuoteTime].filter(Boolean).join(" ")} Eastern Time.`
      : "",
  ].filter(Boolean);

  return parts.join("\n");
}

function buildTradeHaltTitle(fields: TradeHaltFields) {
  const symbol = fields.issueSymbol || "Unknown";
  const description = reasonDescriptionForCode(fields.reasonCode);
  if (volatilityPauseCodes.has(fields.reasonCode || "")) {
    return `${symbol} volatility trading pause`;
  }
  if (updateOnlyHaltCodes.has(fields.reasonCode || "")) {
    return `${symbol} trading halt update${description ? `: ${description}` : ""}`;
  }
  return `${symbol} trading halt${description ? `: ${description}` : fields.reasonCode ? ` ${fields.reasonCode}` : ""}`;
}

function buildTickerMention(fields: TradeHaltFields): NasdaqTraderTickerMention | null {
  if (!fields.issueSymbol) return null;
  const exchange = normalizeExchange(fields.market);
  return {
    exchange,
    symbol: fields.issueSymbol,
    raw: `${exchange}:${fields.issueSymbol}`,
    usListed: true,
  };
}

function buildTradeHaltId(fields: TradeHaltFields) {
  return [
    "tradehalt",
    fields.issueSymbol,
    compactDate(fields.haltDate),
    compactTime(fields.haltTime),
    fields.reasonCode || "unknown",
  ]
    .filter(Boolean)
    .join("-");
}

function buildTradeHaltGroupKey(fields: TradeHaltFields) {
  return [
    "nasdaq-trader-halt",
    fields.issueSymbol,
    compactDate(fields.haltDate),
    compactTime(fields.haltTime),
  ]
    .filter(Boolean)
    .join(":");
}

function buildDedupeKey(sourceUniqueId: string | null) {
  return `nasdaq_trader:${sourceUniqueId || ""}`;
}

const materialHaltCodes = new Set([
  "T1",
  "T2",
  "T12",
  "H4",
  "H9",
  "H10",
  "H11",
  "D",
  "M1",
  "IPO1",
  "IPOQ",
  "IPOE",
]);

const updateOnlyHaltCodes = new Set(["T3", "R4", "R9", "C3", "C4", "C9", "C11", "R1", "R2", "MWCQ"]);
const volatilityPauseCodes = new Set(["LUDP", "LUDS", "M", "T5", "T6"]);

function reasonDescriptionForCode(value: string | null) {
  const code = normalizeReasonCode(value);
  if (!code) return null;
  return (
    {
      T1: "News pending",
      T2: "News released",
      T3: "News and resumption times",
      T5: "Single stock trading pause in effect",
      T6: "Extraordinary market activity",
      T7: "Single stock trading pause or quotation-only period",
      T8: "Exchange-traded fund halt",
      T12: "Additional information requested by Nasdaq",
      H4: "Non-compliance",
      H9: "Not current in required filings",
      H10: "SEC trading suspension",
      H11: "Regulatory concern",
      O1: "Operations halt",
      IPO1: "IPO issue not yet trading",
      M1: "Corporate action",
      M2: "Quotation not available",
      LUDP: "Volatility trading pause",
      LUDS: "Volatility trading pause, straddle condition",
      MWC1: "Market-wide circuit breaker level 1",
      MWC2: "Market-wide circuit breaker level 2",
      MWC3: "Market-wide circuit breaker level 3",
      MWC0: "Market-wide circuit breaker carryover",
      R4: "Qualification issues resolved; quotation or trading to resume",
      R9: "Filing requirements satisfied; quotation or trading to resume",
      C3: "Issuer news not forthcoming; quotation or trading to resume",
      C4: "Qualifications halt ended; maintenance requirement met",
      C9: "Qualifications halt concluded; filings met",
      C11: "Trade halt concluded by other regulatory authority",
      R1: "New issue available",
      R2: "Issue available",
      IPOQ: "IPO security released for quotation",
      IPOE: "IPO security positioning window extension",
      MWCQ: "Market-wide circuit breaker resumption",
      M: "Volatility trading pause in an exchange-listed issue",
      D: "Security deletion",
    } as Record<string, string>
  )[code] || null;
}

function normalizeReasonCode(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeSymbol(value: string | null | undefined) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : null;
}

function normalizeTimeText(value: string | null | undefined) {
  const text = String(value || "")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, "")
    .trim();
  return text || null;
}

function normalizeExchange(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "NASDAQ") return "NASDAQ";
  if (normalized === "NYSE") return "NYSE";
  if (normalized === "AMEX") return "AMEX";
  if (normalized === "NYSE AMERICAN" || normalized === "NYSE_AMERICAN") return "NYSE_AMERICAN";
  if (normalized === "NYSE ARCA" || normalized === "NYSE_ARCA") return "NYSE_ARCA";
  return normalized || "UNKNOWN";
}

function normalizeSourceUniqueId(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function buildTradeHaltsUrl(options: FetchOptions) {
  const params = new URLSearchParams({ feed: "tradehalts" });
  const haltDate = normalizeFeedDateParam(options.haltDate);
  const resumptionDate = normalizeFeedDateParam(options.resumptionDate);
  if (haltDate) params.set("haltdate", haltDate);
  if (resumptionDate) params.set("resumedate", resumptionDate);
  return `${NASDAQ_TRADER_BASE_URL}/rss.aspx?${params.toString()}`;
}

function normalizeFeedDateParam(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 8) return digits;
  const iso = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}${iso[3]}${iso[1]}`;
  return null;
}

function parseNasdaqDateTime(dateValue: string | null, timeValue: string | null) {
  if (!dateValue || !timeValue) return null;
  const dateParts = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateParts) return null;
  const [, month, day, year] = dateParts;
  const normalizedTime = timeValue.replace(/\.\d+$/, "");
  const ms = Date.parse(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${normalizedTime}-04:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseNasdaqDate(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function compactDate(value: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function compactTime(value: string | null) {
  return String(value || "").replace(/\D/g, "").slice(0, 9);
}

function nasdaqTraderFetchHeaders() {
  return {
    Accept: "application/rss+xml,application/xml,text/xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "US-Stock-Radar/0.1 Nasdaq Trader raw parser",
  };
}

function emptyDiagnostics(status: number, itemCount: number, sourceUrl = NASDAQ_TRADE_HALTS_URL): NasdaqTraderRawFetchResult["diagnostics"] {
  return {
    parsedFromFeed: itemCount,
    articleBodiesRequested: 0,
    articleBodiesFetched: 0,
    parserVersion: PARSER_VERSION,
    skippedNonEnglish: 0,
    sourceUrl,
    feedStats: [
      {
        label: "Nasdaq Trader trade halts",
        ok: false,
        status,
        itemCount,
      },
    ],
  };
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

function htmlFromText(value: string) {
  return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
