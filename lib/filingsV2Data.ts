import "server-only";

import {
  readMarketBarCacheMap,
  readMarketQuoteCacheMap,
} from "@/lib/marketDataCache";
import {
  type FilingsV2Cursor,
  type FilingsV2EventType,
  type FilingsV2FilterState,
  type FilingsV2MarketCap,
  type FilingsV2PageResponse,
  type FilingsV2Record,
  type FilingsV2Signal,
  type FilingsV2SummaryMetrics,
} from "@/lib/filingsV2Model";
import type { FilingsV2LoadState } from "@/lib/filingsV2LoadState";
import { supabaseRpc } from "@/lib/supabase";

type FilingsV2Data = {
  formOptions: string[];
  hasMore: boolean;
  nextCursor: FilingsV2Cursor | null;
  records: FilingsV2Record[];
  referenceDate: string;
  state: FilingsV2LoadState;
  summary: FilingsV2SummaryMetrics;
  totalCount: number;
};

type LoadFilingsV2PageParams = {
  cursor?: FilingsV2Cursor | null;
  filters?: FilingsV2FilterState;
  includeTotal?: boolean;
  query?: string;
  referenceDate?: string;
};

type UnknownRecord = Record<string, unknown>;

export const filingsV2PageSize = 25;
const CACHE_TTL_MS = 30_000;
const quoteLimit = 40;
const chartLimit = 20;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedData: { expiresAt: number; value: FilingsV2Data } | null = null;
let pendingData: Promise<FilingsV2Data> | null = null;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

export async function loadFilingsV2Data(): Promise<FilingsV2Data> {
  const now = Date.now();
  if (cachedData && cachedData.expiresAt > now) return cachedData.value;
  if (pendingData) return pendingData;

  pendingData = buildFilingsV2Data()
    .then((value) => {
      cachedData = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      pendingData = null;
    });

  return pendingData;
}

async function buildFilingsV2Data(): Promise<FilingsV2Data> {
  const referenceDate = new Date().toISOString();
  const [page, facets] = await Promise.all([
    loadFilingsV2Page({ includeTotal: true, referenceDate }),
    loadFilingsV2Facets(),
  ]);

  if (page.state === "unavailable") {
    return {
      formOptions: [],
      hasMore: false,
      nextCursor: null,
      records: [],
      referenceDate,
      state: "unavailable",
      summary: emptySummary(),
      totalCount: 0,
    };
  }

  return {
    formOptions: facets?.formOptions ?? [],
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    records: page.records,
    referenceDate,
    state: facets ? "ready" : "partial",
    summary: facets?.summary ?? summarizeRecords(page.records, referenceDate),
    totalCount: page.totalCount ?? page.records.length,
  };
}

export async function loadFilingsV2Page({
  cursor,
  filters,
  includeTotal = true,
  query = "",
  referenceDate = new Date().toISOString(),
}: LoadFilingsV2PageParams = {}): Promise<FilingsV2PageResponse> {
  const publishedAfter = readPublishedAfter(filters, referenceDate);
  const result = await supabaseRpc("search_filings_v2", {
    p_cursor_id: cursor?.id ?? null,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_event_types: filters?.eventTypes ?? [],
    p_form_types: filters?.formTypes ?? [],
    p_impacts: filters?.impacts ?? [],
    p_include_total: includeTotal,
    p_limit: filingsV2PageSize,
    p_market_caps: filters?.marketCaps ?? [],
    p_published_after: publishedAfter,
    p_query: query.trim() || null,
    p_signals: filters?.signals ?? [],
  });

  const payload = asRecord(result.data);
  if (!result.ok || !payload) {
    return {
      hasMore: false,
      nextCursor: null,
      records: [],
      state: "unavailable",
      totalCount: null,
    };
  }

  const rows = Array.isArray(payload.records) ? payload.records.filter(isRecord) : [];
  const baseRecords = rows
    .map(mapEventRow)
    .filter((record): record is FilingsV2Record => Boolean(record));
  const records = await enrichRecordsWithMarketData(baseRecords);
  const cursorPayload = asRecord(payload.next_cursor);
  const nextCursor = readCursor(cursorPayload);

  return {
    hasMore: payload.has_more === true,
    nextCursor,
    records,
    state: "ready",
    totalCount: finiteNumber(payload.total) ?? null,
  };
}

async function loadFilingsV2Facets() {
  const result = await supabaseRpc("get_filings_v2_facets", {});
  const payload = asRecord(result.data);
  if (!result.ok || !payload) return null;

  const formOptions = Array.isArray(payload.form_options)
    ? payload.form_options
      .map(readString)
      .filter((value): value is string => Boolean(value))
    : [];
  const summaryPayload = asRecord(payload.summary);

  return {
    formOptions,
    summary: readSummary(summaryPayload),
  };
}

async function enrichRecordsWithMarketData(baseRecords: FilingsV2Record[]) {
  const symbols = Array.from(
    new Set(baseRecords.map((record) => record.ticker).filter(isUsableTicker)),
  );
  const quoteSymbols = symbols.slice(0, quoteLimit);
  const chartSymbols = symbols.slice(0, chartLimit);
  const [quoteMap, chartMap] = await Promise.all([
    readMarketQuoteCacheMap(quoteSymbols),
    readMarketBarCacheMap(chartSymbols, "1D"),
  ]);

  return baseRecords.map((record) => {
    const symbol = record.ticker;
    if (!symbol) return record;

    const quote = quoteMap.get(symbol);
    const chart = chartMap.get(symbol);
    return {
      ...record,
      changePercent: finiteNumber(quote?.changePercent) ?? record.changePercent,
      chartPoints:
        chart?.points.map((point) => point.close).filter(Number.isFinite) ??
        record.chartPoints,
      price: finiteNumber(quote?.price) ?? record.price,
    };
  });
}

function mapEventRow(row: UnknownRecord): FilingsV2Record | null {
  const id = readString(row.id);
  if (!id || !uuidPattern.test(id)) return null;

  const metadata = asRecord(row.metadata);
  const displayPayload = asRecord(metadata?.display_payload);
  const displayData = asRecord(displayPayload?.data);
  const analysisOutput =
    asRecord(metadata?.analysis_output) ||
    asRecord(metadata?.analysis) ||
    asRecord(metadata?.analysis_result);
  const marketContext =
    asRecord(metadata?.market_context) ||
    asRecord(analysisOutput?.market_context) ||
    asRecord(displayData?.market_context);
  const contexts = [
    row,
    metadata,
    analysisOutput,
    displayPayload,
    displayData,
    marketContext,
  ].filter((value): value is UnknownRecord => Boolean(value));

  const filedAt = firstDateString(contexts, [
    "published_at",
    "detected_at",
    "event_date",
    "filed_at",
    "filing_date",
    "filed_date",
  ]);
  if (!filedAt) return null;
  const ticker = normalizeTicker(firstString(contexts, ["ticker", "symbol"]));
  const eventTypes = collectEventTypes(row, metadata);
  const score = clampScore(
    firstFiniteNumber(contexts, ["score", "impact", "impact_score"]) ?? 50,
  );
  const signal = normalizeSignal(firstString(contexts, ["signal"]));
  const summary =
    firstString(contexts, [
      "quick_take",
      "why_it_matters",
      "summary",
      "filing_brief",
      "investor_takeaway",
    ]) || "";
  const storedPrice = firstFiniteNumber(
    [row, marketContext, metadata].filter((value): value is UnknownRecord => Boolean(value)),
    ["price", "latest_price", "current_price"],
  );
  const storedChange = firstFiniteNumber(
    [row, marketContext, metadata].filter((value): value is UnknownRecord => Boolean(value)),
    ["change_percent", "change_percentage", "changes_percentage"],
  );

  return {
    accession:
      firstString(contexts, ["accession_number", "accession", "accession_no"]) || "",
    changePercent: storedChange,
    company:
      firstString(contexts, [
        "issuer",
        "company_name",
        "company",
        "registrant_name",
        "entity_name",
      ]) ||
      ticker ||
      "Issuer not available",
    events: eventTypes,
    filedAt,
    filedDate: dateFormatter.format(new Date(filedAt)),
    filedDateTime: formatDateTime(filedAt),
    filedTime: `${timeFormatter.format(new Date(filedAt))} ET`,
    formType:
      firstString(contexts, ["form_type", "form", "filing_type"]) || "SEC filing",
    id,
    impact: score,
    keyPoints: collectKeyPoints(metadata, analysisOutput, displayData),
    marketCap: classifyMarketCap(
      firstValue(contexts, [
        "market_cap",
        "market_capitalization",
        "marketCap",
        "marketCapitalization",
      ]),
    ),
    price: storedPrice,
    relatedFilings: collectRelatedFilings(metadata),
    signal,
    source: "SEC",
    summary,
    ticker,
    title:
      firstString(contexts, ["title", "headline", "analysis_title"]) ||
      `${firstString(contexts, ["form_type", "form"]) || "SEC"} filing`,
  };
}

function collectEventTypes(
  row: UnknownRecord,
  metadata: UnknownRecord | null,
): FilingsV2EventType[] {
  const candidates: unknown[] = [
    row.event_type,
    metadata?.event_type,
    metadata?.category,
    ...(Array.isArray(row.event_tags) ? row.event_tags : []),
  ];
  const materialEvents = Array.isArray(metadata?.material_events)
    ? metadata.material_events
    : [];

  for (const event of materialEvents) {
    const record = asRecord(event);
    candidates.push(record?.event_type, record?.type, record?.category);
  }

  return Array.from(
    new Set(
      candidates
        .map((candidate) => mapEventType(readString(candidate)))
        .filter((value): value is FilingsV2EventType => Boolean(value)),
    ),
  ).slice(0, 3);
}

function mapEventType(value: string | undefined): FilingsV2EventType | null {
  switch ((value || "").trim().toLowerCase()) {
    case "earnings":
      return "earnings";
    case "insider":
    case "insider_ownership":
      return "insider";
    case "offering":
    case "securities_offering":
      return "offering";
    case "dilution":
    case "dilution_risk":
      return "dilution";
    case "ipo_listing":
    case "listing":
    case "listing_risk":
      return "listing";
    case "financial_risk":
    case "legal":
    case "legal_risk":
      return "legal";
    case "ma":
    case "strategic_transaction":
      return "ma";
    case "governance":
    case "leadership_governance":
    case "shareholder_vote":
      return "governance";
    case "fda":
    case "fda_clinical":
      return "fda";
    case "operating_update":
      return "operating";
    case "capital_return":
    case "dividends":
      return "capital_return";
    default:
      return null;
  }
}

function collectKeyPoints(
  metadata: UnknownRecord | null,
  analysisOutput: UnknownRecord | null,
  displayData: UnknownRecord | null,
) {
  const candidates = [
    metadata?.key_evidence,
    metadata?.key_points,
    analysisOutput?.key_evidence,
    analysisOutput?.key_points,
    displayData?.key_evidence,
    displayData?.key_points,
    displayData?.key_changes,
  ];
  const points = candidates.flatMap(readTextList);
  const materialEvents = Array.isArray(metadata?.material_events)
    ? metadata.material_events
    : [];

  for (const event of materialEvents) {
    const record = asRecord(event);
    const text = firstString(
      [record].filter((value): value is UnknownRecord => Boolean(value)),
      ["event_summary", "summary", "value", "title"],
    );
    if (text) points.push(text);
  }

  return Array.from(new Set(points.map(cleanText).filter(Boolean))).slice(0, 3);
}

function collectRelatedFilings(metadata: UnknownRecord | null) {
  const raw =
    metadata?.related_filing_contexts ??
    metadata?.related_filings ??
    metadata?.related_events;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const id = firstString([record], ["event_id", "id"]);
      if (!id || !uuidPattern.test(id)) return null;
      const filedAt = firstDateString([record], [
        "filed_at",
        "filing_date",
        "filed_date",
        "published_at",
      ]);
      const formType = firstString([record], ["form_type", "form"]) || "SEC";

      return {
        filedDate: filedAt ? dateFormatter.format(new Date(filedAt)) : undefined,
        formType,
        id,
        source: "SEC" as const,
        title:
          firstString([record], ["title", "headline"]) || `${formType} related filing`,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .slice(0, 3);
}

function classifyMarketCap(value: unknown): FilingsV2MarketCap | undefined {
  const marketCap = parseMagnitude(value);
  if (!marketCap || marketCap <= 0) return undefined;
  if (marketCap >= 50_000_000_000) return "Mega";
  if (marketCap >= 10_000_000_000) return "Large";
  if (marketCap >= 1_000_000_000) return "Mid";
  if (marketCap >= 50_000_000) return "Small";
  return "Micro";
}

function readPublishedAfter(
  filters: FilingsV2FilterState | undefined,
  referenceDate: string,
) {
  const rangeDays = filters?.dateRanges.reduce((largest, range) => {
    if (range === "30 Days") return Math.max(largest, 30);
    if (range === "7 Days") return Math.max(largest, 7);
    if (range === "24 Hours") return Math.max(largest, 1);
    return largest;
  }, 0) ?? 0;
  if (!rangeDays) return null;

  const referenceTime = Date.parse(referenceDate);
  if (!Number.isFinite(referenceTime)) return null;
  return new Date(referenceTime - rangeDays * 24 * 60 * 60 * 1000).toISOString();
}

function readCursor(value: UnknownRecord | null): FilingsV2Cursor | null {
  if (!value) return null;
  const id = readString(value.id);
  const publishedAt = firstDateString([value], ["published_at"]);
  if (!id || !uuidPattern.test(id) || !publishedAt) return null;
  return { id, publishedAt };
}

function emptySummary(): FilingsV2SummaryMetrics {
  return {
    alerts: 0,
    earnings: 0,
    filedToday: 0,
    insider: 0,
    listing: 0,
    offering: 0,
  };
}

function readSummary(value: UnknownRecord | null): FilingsV2SummaryMetrics {
  return {
    alerts: finiteNumber(value?.alerts) ?? 0,
    earnings: finiteNumber(value?.earnings) ?? 0,
    filedToday: finiteNumber(value?.filedToday) ?? 0,
    insider: finiteNumber(value?.insider) ?? 0,
    listing: finiteNumber(value?.listing) ?? 0,
    offering: finiteNumber(value?.offering) ?? 0,
  };
}

function summarizeRecords(
  records: readonly FilingsV2Record[],
  referenceDate: string,
): FilingsV2SummaryMetrics {
  const referenceFormatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  });
  const referenceMarketDate = referenceFormatter.format(new Date(referenceDate));

  return {
    alerts: records.filter((record) => record.impact >= 75).length,
    earnings: records.filter((record) => record.events.includes("earnings")).length,
    filedToday: records.filter(
      (record) => referenceFormatter.format(new Date(record.filedAt)) === referenceMarketDate,
    ).length,
    insider: records.filter((record) => record.events.includes("insider")).length,
    listing: records.filter((record) => record.events.includes("listing")).length,
    offering: records.filter((record) => record.events.includes("offering")).length,
  };
}

function parseMagnitude(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[$,\s]/g, "").toUpperCase();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/);
  if (!match) return undefined;
  const number = Number(match[1]);
  const multiplier =
    match[2] === "T"
      ? 1_000_000_000_000
      : match[2] === "B"
        ? 1_000_000_000
        : match[2] === "M"
          ? 1_000_000
          : match[2] === "K"
            ? 1_000
            : 1;
  return Number.isFinite(number) ? number * multiplier : undefined;
}

function readTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      if (!record) return "";
      const title = firstString([record], ["title", "label"]);
      const detail = firstString([record], ["value", "text", "summary", "description"]);
      return [title, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean);
}

function firstDateString(records: UnknownRecord[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = readString(record[key]);
      if (!value) continue;
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    }
  }
  return undefined;
}

function firstString(records: UnknownRecord[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = readString(record[key]);
      if (value) return cleanText(value);
    }
  }
  return undefined;
}

function firstFiniteNumber(records: UnknownRecord[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = finiteNumber(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function firstValue(records: UnknownRecord[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
  }
  return undefined;
}

function normalizeSignal(value?: string): FilingsV2Signal {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "bullish" ||
    normalized === "bearish" ||
    normalized === "neutral" ||
    normalized === "volatile"
  ) {
    return normalized;
  }
  return "neutral";
}

function normalizeTicker(value?: string) {
  const ticker = (value || "").trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NA" || ticker === "MARKET") {
    return undefined;
  }
  return ticker;
}

function isUsableTicker(value: string | undefined): value is string {
  return Boolean(value);
}

function clampScore(value: number) {
  return Math.max(1, Math.min(99, Math.round(value)));
}

function formatDateTime(value: string) {
  const formatted = dateTimeFormatter
    .format(new Date(value))
    .replace(/, (?=\d{1,2}:\d{2})/, " - ");
  return `${formatted} ET`;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.replace(/[%,$\s]/g, ""))
        : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
