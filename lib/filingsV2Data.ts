import "server-only";

import {
  readMarketBarCacheMap,
} from "@/lib/marketDataCache";
import { readHydratedMarketQuoteMap } from "@/lib/marketQuoteHydration";
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
import {
  formatFilingsV2FormType,
  resolveFilingsV2FilingGroupQuery,
} from "@/lib/filingsV2FilingGroups";
import { classifyMarketCapBand } from "@/lib/marketCapBands";
import type { FilingsV2LoadState } from "@/lib/filingsV2LoadState";
import { resolveFilingPreviewFields } from "@/lib/filingPreviewContract";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";

type FilingsV2Data = {
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
  const filingGroupQuery = resolveFilingsV2FilingGroupQuery(
    filters?.filingGroups ?? [],
  );
  const result = await supabaseRpc("search_filings_v2", {
    p_cursor_id: cursor?.id ?? null,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_event_types: filters?.eventTypes ?? [],
    p_effective_filing_forms: filingGroupQuery.effectiveFilingForms,
    p_form_types: filingGroupQuery.formTypes,
    p_impacts: filters?.impacts ?? [],
    p_include_effectiveness: filingGroupQuery.includeEffectiveness,
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
  const rowsById = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const id = readString(row.id);
    if (id) rowsById.set(id, row);
  }
  const baseRecords = rows
    .map(mapEventRow)
    .filter((record): record is FilingsV2Record => Boolean(record));
  const [marketRecords, keyEvidenceByEventId, displayPayloadByEventId] = await Promise.all([
    enrichRecordsWithMarketData(baseRecords),
    loadFilingPreviewKeyEvidence(baseRecords),
    loadFilingPreviewDisplayPayloads(baseRecords),
  ]);
  const records = marketRecords.map((record) => {
    const row = rowsById.get(record.id);
    const metadata = asRecord(row?.metadata);
    const previewFields = resolveFilingPreviewFields({
      displayPayload:
        displayPayloadByEventId.get(record.id) || metadata?.display_payload,
      formType: record.formType,
      governanceEvent: record.events.includes("governance"),
      keyEvidence: keyEvidenceByEventId.get(record.id),
      materialEvents: metadata?.material_events,
      quickTake: row?.quick_take,
      summary: row?.summary,
    });

    return {
      ...record,
      keyPoints: previewFields.keyPoints,
      keyPointsLabel: previewFields.keyPointsLabel,
      showKeyPoints: previewFields.showKeyPoints,
      summary: previewFields.filingBrief,
    };
  });
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

  const summaryPayload = asRecord(payload.summary);

  return {
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
    readHydratedMarketQuoteMap(quoteSymbols),
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

async function loadFilingPreviewKeyEvidence(
  records: readonly FilingsV2Record[],
) {
  const eventIds = records.map((record) => record.id);
  if (!eventIds.length) return new Map<string, unknown>();

  const result = await supabaseSelect("event_analysis", {
    select: "event_id,key_evidence",
    event_id: `in.(${eventIds.join(",")})`,
    limit: String(eventIds.length),
  });
  if (!result.ok || !Array.isArray(result.data)) {
    return new Map<string, unknown>();
  }

  return new Map(
    result.data
      .filter(isRecord)
      .map((row) => [readString(row.event_id), row.key_evidence] as const)
      .filter((entry): entry is [string, unknown] => Boolean(entry[0])),
  );
}

async function loadFilingPreviewDisplayPayloads(
  records: readonly FilingsV2Record[],
) {
  const eventIds = records.map((record) => record.id);
  if (!eventIds.length) return new Map<string, unknown>();

  const result = await supabaseSelect("events", {
    select: [
      "id",
      "display_type:metadata->display_payload->>display_type",
      "payload_display_version:metadata->display_payload->>display_version",
      "display_version:metadata->display_payload->data->>display_version",
      "operating_mode:metadata->display_payload->data->>operating_mode",
      "business_catalysts:metadata->display_payload->data->business_catalysts",
      "capital_mode:metadata->display_payload->data->>capital_mode",
      "snapshot_metrics:metadata->display_payload->data->snapshot_metrics",
    ].join(","),
    id: `in.(${eventIds.join(",")})`,
    limit: String(eventIds.length),
  });
  if (!result.ok || !Array.isArray(result.data)) {
    return new Map<string, unknown>();
  }

  const displayPayloads = new Map<string, unknown>();
  for (const row of result.data.filter(isRecord)) {
    const id = readString(row.id);
    const displayType = readString(row.display_type);
    const displayVersion =
      readString(row.payload_display_version) || readString(row.display_version);
    const operatingMode = readString(row.operating_mode);
    const capitalMode = readString(row.capital_mode);
    const isEarningsPreview =
      displayType === "operating_event" &&
      displayVersion === "sec_8k_6k_operating_event_v1" &&
      operatingMode === "earnings";
    const isCapitalFinancingPreview =
      displayType === "capital_financing" &&
      displayVersion === "sec_8k_6k_capital_financing_v1";
    const isOfferingPreview =
      displayType === "offering_terms" &&
      (displayVersion === "s3_offering_v1" ||
        displayVersion === "424b-display-payload-v1");
    if (
      !id ||
      (!isEarningsPreview && !isCapitalFinancingPreview && !isOfferingPreview)
    ) {
      continue;
    }
    displayPayloads.set(id, {
      display_type: displayType,
      display_version: displayVersion,
      data: {
        business_catalysts: row.business_catalysts,
        capital_mode: capitalMode,
        display_version: displayVersion,
        operating_mode: operatingMode,
        snapshot_metrics: row.snapshot_metrics,
      },
    });
  }
  return displayPayloads;
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
  const previewFields = resolveFilingPreviewFields({
    displayPayload: metadata?.display_payload,
    governanceEvent: eventTypes.includes("governance"),
    materialEvents: metadata?.material_events,
    quickTake: row.quick_take,
    summary: row.summary,
  });
  const storedPrice = firstFiniteNumber(
    [row, marketContext, metadata].filter((value): value is UnknownRecord => Boolean(value)),
    ["price", "latest_price", "current_price"],
  );
  const storedChange = firstFiniteNumber(
    [row, marketContext, metadata].filter((value): value is UnknownRecord => Boolean(value)),
    ["change_percent", "change_percentage", "changes_percentage"],
  );
  const storedFormType =
    firstString(contexts, ["form_type", "form", "filing_type"]) ||
    "SEC filing";
  const effectiveFilingForm = firstString(contexts, [
    "effective_filing_form",
  ]);

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
    formType: formatFilingsV2FormType(storedFormType, effectiveFilingForm),
    id,
    impact: score,
    keyPoints: previewFields.keyPoints,
    keyPointsLabel: previewFields.keyPointsLabel,
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
    showKeyPoints: previewFields.showKeyPoints,
    summary: previewFields.filingBrief,
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
  return classifyMarketCapBand(marketCap) || undefined;
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
