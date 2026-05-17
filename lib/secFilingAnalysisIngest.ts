import { randomUUID } from "node:crypto";
import { getCalendarEventGroup, normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import {
  SEC_EVENT_TYPE_VALUES,
  SEC_FILING_ANALYSIS_PROMPT_KEY,
  SEC_FILING_ANALYSIS_PROMPT_VERSION,
} from "@/lib/prompts/secFilingAnalysis";
import { SIGNAL_VALUES } from "@/lib/prompts/newsEventAnalysis";
import { findSecRawItem, runSecFilingAnalysisForRawRow } from "@/lib/ai/secFilingAnalysisPreview";
import { supabaseDelete, supabaseSelect, supabaseUpsert } from "@/lib/supabase";

type AnalyzeOptions = {
  rawItemId?: string;
  accessionNumber?: string;
  ticker?: string;
  calendarCandidate?: boolean;
  dryRun?: boolean;
  force?: boolean;
};

type SourceGroup = "filings";
type MarketScope = "company" | "sector" | "theme" | "macro";
type Signal = (typeof SIGNAL_VALUES)[number];
type DeliveryLevel = "archive" | "feed" | "alert";
type Impact = "high" | "medium" | "low";
type AnalysisScope = "company" | "sector" | "theme" | "market";
type PersistedRow = Record<string, unknown>;

const allowedEventTypes = new Set<string>(SEC_EVENT_TYPE_VALUES);
const allowedSignals = new Set<string>(SIGNAL_VALUES);
const allowedTickerRoles = new Set<string>([
  "primary",
  "related",
  "peer",
  "customer",
  "supplier",
  "counterparty",
  "mentioned",
  "sector_constituent",
  "theme_constituent",
]);

export async function runSecFilingAnalysisIngest(options: AnalyzeOptions = {}) {
  const rawResult = await findSecRawItem(options);
  if (!rawResult.ok || !rawResult.rawItem) {
    return {
      ok: false,
      stage: "raw_item",
      status: rawResult.status,
      error: rawResult.error || "SEC raw item not found",
    };
  }

  const analysisRun = await runSecFilingAnalysisForRawRow(rawResult.rawItem);
  if (!analysisRun.ok || !analysisRun.analysis) {
    return {
      ok: false,
      stage: analysisRun.stage,
      status: analysisRun.status,
      error: analysisRun.error || "SEC filing analysis failed",
      sourceItem: analysisRun.sourceItem,
      input: analysisRun.input,
      outputText: analysisRun.outputText,
      rawOpenAIResponse: analysisRun.rawOpenAIResponse,
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: analysisRun.sourceItem,
      input: analysisRun.input,
      analysis: analysisRun.analysis,
      outputText: analysisRun.outputText,
    };
  }

  const persistedEvent = await persistAnalyzedFilingEvent({
    rawRow: rawResult.rawItem,
    analysis: analysisRun.analysis,
    model: analysisRun.model || "",
    openAiResponseId: analysisRun.openAiResponseId || null,
    force: Boolean(options.force),
  });

  await persistAiTrace({
    rawItemId: stringValue(rawResult.rawItem.id),
    eventId: stringValue(persistedEvent.id),
    analysis: analysisRun.analysis,
    outputText: analysisRun.outputText || "",
    model: analysisRun.model || "",
    openAiResponseId: analysisRun.openAiResponseId || null,
  });

  const calendarItems = await fetchCalendarItemsForEvent(stringValue(persistedEvent.id));

  return {
    ok: true,
    stage: "complete",
    sourceItem: analysisRun.sourceItem,
    event: persistedEvent,
    analysis: analysisRun.analysis,
    calendarItems,
  };
}

async function persistAnalyzedFilingEvent({
  rawRow,
  analysis,
  model,
  openAiResponseId,
}: {
  rawRow: PersistedRow;
  analysis: Record<string, unknown>;
  model: string;
  openAiResponseId: string | null;
  force: boolean;
}) {
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const score = clampScore(numberValue(analysis.score));
  const eventType = normalizeEventType(stringValue(analysis.event_type));
  const signal = normalizeSignal(stringValue(analysis.signal));
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const primaryTicker = readPrimaryTicker(analysis, rawPayload);
  const groupDedupeKey = buildGroupDedupeKey(rawRow);
  const existing = await findExistingEvent(groupDedupeKey);
  const id = stringValue(existing?.id) || randomUUID();
  const deliveryLevel = deliveryLevelFromScore(score);
  const payload = {
    id,
    raw_item_id: stringValue(rawRow.id),
    source_code: "sec_edgar",
    source_group: "filings" satisfies SourceGroup,
    source_name: "SEC EDGAR",
    source_url: stringValue(rawRow.source_url),
    published_at: stringValue(rawRow.published_at) || null,
    ticker: primaryTicker.ticker,
    market: primaryTicker.exchange,
    event_type: eventType,
    score,
    delivery_level: deliveryLevel,
    impact: impactFromScore(score),
    signal,
    market_scope: marketScope,
    sector: nullableString(analysis.sector),
    industry_group: nullableString(analysis.industry_group),
    theme_group: nullableString(analysis.theme_group),
    sub_theme: nullableString(analysis.sub_theme),
    title: stringValue(analysis.event_title) || stringValue(rawRow.title) || "SEC filing event",
    quick_take: stringValue(analysis.quick_take),
    summary: stringValue(analysis.summary),
    reason: stringValue(analysis.score_reason),
    detected_at: new Date().toISOString(),
    group_dedupe_key: groupDedupeKey,
    cross_group_event_key: buildCrossGroupEventKey(primaryTicker.ticker, eventType, stringValue(analysis.event_title)),
    metadata: {
      issuer: nullableString(rawPayload.company_name),
      source_type: "SEC Filing",
      source_release_type: "Official Filing",
      accession_number: nullableString(rawPayload.accession_number) || nullableString(rawRow.source_unique_id),
      form_type: nullableString(rawPayload.form_type),
      cik: nullableString(rawPayload.cik),
      primary_document_url: nullableString(rawPayload.primary_document_url),
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      score_reason: stringValue(analysis.score_reason),
      openai_model: model,
      openai_response_id: openAiResponseId,
      prompt_key: SEC_FILING_ANALYSIS_PROMPT_KEY,
      prompt_version: SEC_FILING_ANALYSIS_PROMPT_VERSION,
      related_tickers: analysis.related_tickers || [],
    },
  };

  const result = await supabaseUpsert("events", payload, { onConflict: "id" });
  await assertMutation(result, "upsert SEC filing event");
  const eventRow = firstRow(result.data) || payload;

  await Promise.all([
    persistEventAnalysis(eventRow, analysis, marketScope),
    replaceEventTickers(stringValue(eventRow.id), analysis, primaryTicker),
    replaceEventCalendarItems({
      eventRow,
      rawRow,
      analysis,
      primaryTicker,
    }),
  ]);

  return eventRow;
}

async function persistEventAnalysis(
  eventRow: PersistedRow,
  analysis: Record<string, unknown>,
  marketScope: MarketScope,
) {
  const payload = {
    event_id: stringValue(eventRow.id),
    analysis_scope: analysisScopeFromMarketScope(marketScope),
    why_it_matters: stringValue(analysis.why_it_matters),
    bullish_points: stringArray(analysis.bullish_points),
    bearish_points: stringArray(analysis.bearish_points),
    key_evidence: stringArray(analysis.key_evidence),
    watch_next: stringArray(analysis.what_to_watch_next),
    metadata: {
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
    },
  };

  const result = await supabaseUpsert("event_analysis", payload, { onConflict: "event_id" });
  await assertMutation(result, "upsert SEC filing event analysis");
}

async function replaceEventTickers(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  await assertMutation(supabaseDelete("event_tickers", { event_id: `eq.${eventId}` }), "delete event tickers");
  const rows = buildTickerRows(eventId, analysis, primaryTicker);
  if (!rows.length) return;

  const result = await supabaseUpsert("event_tickers", rows, {
    onConflict: "event_id,symbol,role",
  });
  await assertMutation(result, "upsert SEC filing event tickers");
}

async function replaceEventCalendarItems({
  eventRow,
  rawRow,
  analysis,
  primaryTicker,
}: {
  eventRow: PersistedRow;
  rawRow: PersistedRow;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
}) {
  const eventId = stringValue(eventRow.id);
  await assertMutation(
    supabaseDelete("event_calendar_items", { source_event_id: `eq.${eventId}` }),
    "delete SEC filing event calendar items",
  );

  const rows = buildCalendarRows({ eventRow, rawRow, analysis, primaryTicker });
  if (!rows.length) return;

  const result = await supabaseUpsert("event_calendar_items", rows, { onConflict: "id" });
  await assertMutation(result, "upsert SEC filing event calendar items");
}

function buildTickerRows(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (input: {
    symbol: string | null;
    exchange?: string | null;
    role?: string | null;
    reason?: string | null;
    sortOrder?: number;
  }) => {
    const symbol = stringValue(input.symbol).toUpperCase();
    if (!symbol) return;
    const role = normalizeTickerRole(input.role || "related");
    const key = `${symbol}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      event_id: eventId,
      symbol,
      exchange: nullableString(input.exchange),
      role,
      sort_order: input.sortOrder ?? rows.length + 1,
      reason: nullableString(input.reason),
      metadata: {},
    });
  };

  push({
    symbol: primaryTicker.ticker,
    exchange: primaryTicker.exchange,
    role: "primary",
    reason: "Primary ticker from SEC filing analysis",
    sortOrder: 1,
  });

  for (const item of recordArray(analysis.tickers)) {
    push({
      symbol: stringValue(item.ticker),
      exchange: stringValue(item.exchange),
      role: stringValue(item.role),
      reason: stringValue(item.reason),
    });
  }

  for (const item of recordArray(analysis.related_tickers)) {
    push({
      symbol: stringValue(item.ticker),
      exchange: stringValue(item.exchange),
      role: "related",
      reason: stringValue(item.reason),
    });
  }

  return rows.map((row, index) => ({ ...row, sort_order: index + 1 }));
}

function buildCalendarRows({
  eventRow,
  rawRow,
  analysis,
  primaryTicker,
}: {
  eventRow: PersistedRow;
  rawRow: PersistedRow;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
}) {
  const eventId = stringValue(eventRow.id);
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const ticker = primaryTicker.ticker || null;
  const companyName = nullableString(rawPayload.company_name) || ticker;
  const secEventType = normalizeEventType(stringValue(analysis.event_type));
  const rows: Record<string, unknown>[] = [];

  for (const item of recordArray(analysis.calendar_items)) {
    const eventDate = normalizeDateString(item.event_date);
    const estimatedStartDate = normalizeDateString(item.estimated_start_date);
    const estimatedEndDate = normalizeDateString(item.estimated_end_date);

    if (!eventDate && !estimatedStartDate && !estimatedEndDate) continue;

    const calendarEventType = normalizeCalendarEventTypeForItem(stringValue(item.calendar_event_type), item, secEventType);
    if (shouldSkipCalendarItem(item, calendarEventType)) continue;

    const datePrecision = normalizeDatePrecision(stringValue(item.date_precision), eventDate);
    const isEstimated = Boolean(item.is_estimated) || datePrecision !== "exact";
    const calendarStatus = calendarStatusForFiling(datePrecision, isEstimated, Boolean(eventDate));
    const eventTime = normalizeTimeString(item.event_time);
    const calendarTitle =
      stringValue(item.calendar_title) || stringValue(eventRow.title) || stringValue(rawRow.title) || "Scheduled SEC filing event";

    rows.push({
      id: randomUUID(),
      source_event_id: eventId,
      raw_item_id: stringValue(rawRow.id),
      source_code: "sec_edgar",
      source_group: "filings",
      ticker,
      company_name: companyName,
      calendar_event_key: buildCalendarEventKey({
        ticker,
        calendarEventType,
        eventDate,
        eventTime,
        estimatedStartDate,
        estimatedEndDate,
        title: calendarTitle,
      }),
      calendar_event_type: calendarEventType,
      calendar_group: getCalendarEventGroup(calendarEventType),
      calendar_title: calendarTitle,
      event_date: eventDate,
      event_time: eventTime,
      event_timezone: nullableString(item.event_timezone),
      date_precision: datePrecision,
      estimated_start_date: estimatedStartDate,
      estimated_end_date: estimatedEndDate,
      is_estimated: isEstimated,
      confidence: normalizeConfidence(stringValue(item.confidence)),
      calendar_status: calendarStatus,
      confirmation_source: "filings",
      confirmed_at: calendarStatus === "confirmed" ? new Date().toISOString() : null,
      confirmed_by_event_id: calendarStatus === "confirmed" ? eventId : null,
      superseded_by_item_id: null,
      source_url: stringValue(eventRow.source_url) || stringValue(rawRow.source_url),
      evidence: nullableString(item.evidence),
      metadata: {
        raw_calendar_item: item,
        prompt_key: SEC_FILING_ANALYSIS_PROMPT_KEY,
        prompt_version: SEC_FILING_ANALYSIS_PROMPT_VERSION,
      },
    });
  }

  return rows;
}

async function persistAiTrace({
  rawItemId,
  eventId,
  analysis,
  outputText,
  model,
  openAiResponseId,
}: {
  rawItemId: string;
  eventId: string;
  analysis: Record<string, unknown>;
  outputText: string;
  model: string;
  openAiResponseId: string | null;
}) {
  const aiRunId = randomUUID();
  const now = new Date().toISOString();
  await assertMutation(
    supabaseUpsert(
      "ai_runs",
      {
        id: aiRunId,
        event_id: eventId,
        raw_item_id: rawItemId,
        prompt_key: SEC_FILING_ANALYSIS_PROMPT_KEY,
        prompt_version: SEC_FILING_ANALYSIS_PROMPT_VERSION,
        model,
        status: "completed",
        started_at: now,
        finished_at: now,
        usage: {},
        metadata: {
          openai_response_id: openAiResponseId,
        },
      },
      { onConflict: "id" },
    ),
    "insert SEC filing ai run",
  );

  await assertMutation(
    supabaseUpsert(
      "ai_outputs",
      {
        id: randomUUID(),
        ai_run_id: aiRunId,
        event_id: eventId,
        output_type: "sec_filing_analysis",
        payload: {
          analysis,
          output_text: outputText,
        },
      },
      { onConflict: "id" },
    ),
    "insert SEC filing ai output",
  );
}

async function findExistingEvent(groupDedupeKey: string) {
  const result = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    group_dedupe_key: `eq.${groupDedupeKey}`,
    limit: "1",
  });
  return firstRow(result.data);
}

async function fetchCalendarItemsForEvent(eventId: string) {
  const result = await supabaseSelect("event_calendar_items", {
    select: "*",
    source_event_id: `eq.${eventId}`,
    order: "event_date.asc",
    limit: "20",
  });
  return Array.isArray(result.data) ? result.data : [];
}

async function assertMutation(
  promise:
    | Promise<{ ok: boolean; status: number; error?: string; data?: unknown }>
    | { ok: boolean; status: number; error?: string; data?: unknown },
  label: string,
) {
  const result = await promise;
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error || `HTTP ${result.status}`}`);
  }
  return result;
}

function readPrimaryTicker(analysis: Record<string, unknown>, rawPayload: Record<string, unknown>) {
  const primary = toRecord(analysis.primary_ticker);
  const ticker = nullableString(primary?.ticker) || nullableString(rawPayload.ticker);
  const exchange = nullableString(primary?.exchange) || nullableString(rawPayload.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function buildGroupDedupeKey(rawRow: PersistedRow) {
  return `sec_edgar:${stringValue(rawRow.source_unique_id) || stringValue(rawRow.dedupe_key) || stringValue(rawRow.id)}`;
}

function buildCrossGroupEventKey(ticker: string | null, eventType: string, title: string | null) {
  if (!ticker) return null;
  return `${ticker}:${eventType}:${slugify(title || "")}`.slice(0, 180);
}

function buildCalendarEventKey({
  ticker,
  calendarEventType,
  eventDate,
  eventTime,
  estimatedStartDate,
  estimatedEndDate,
  title,
}: {
  ticker: string | null;
  calendarEventType: string;
  eventDate: string | null;
  eventTime: string | null;
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
  title: string;
}) {
  const datePart = eventDate || estimatedStartDate || estimatedEndDate || "unknown";
  const timePart = eventTime || "all_day";
  return `${(ticker || "market").toLowerCase()}:${calendarEventType}:${datePart}:${timePart}:${slugify(title)}`.slice(
    0,
    220,
  );
}

function normalizeEventType(value: string) {
  const normalized = value.trim().toLowerCase();
  return allowedEventTypes.has(normalized) ? normalized : "other";
}

function normalizeCalendarEventTypeForItem(
  value: string,
  item: Record<string, unknown>,
  secEventType: string,
) {
  const normalized = normalizeCalendarEventType(value);
  const text = [value, item.calendar_title, item.evidence].map((part) => stringValue(part).toLowerCase()).join("\n");

  if (
    secEventType === "dividends" &&
    (normalized === "shareholder_record_date" || text.includes("record date") || text.includes("shareholding position"))
  ) {
    return "dividend_record_date";
  }

  if (
    text.includes("warrant") &&
    /\b(expiration|expires|expire|exercisable|exercise|redemption|redeem)\b/.test(text)
  ) {
    return "warrant_redemption_deadline";
  }

  return normalized;
}

function shouldSkipCalendarItem(item: Record<string, unknown>, calendarEventType: string) {
  const text = [item.calendar_title, item.evidence].map((part) => stringValue(part).toLowerCase()).join("\n");
  if (calendarEventType !== "other_scheduled_event") return false;

  return [
    /tax[-\s]?(status|exemption|exempt)/,
    /withholding (income )?tax/,
    /provide .*evidence/,
    /submit .*evidence/,
    /proxy (mailing|distribution|distributed|statement will be distributed)/,
    /board response/,
    /position statement/,
  ].some((pattern) => pattern.test(text));
}

function normalizeSignal(value: string): Signal {
  const normalized = value.trim().toLowerCase();
  return allowedSignals.has(normalized) ? (normalized as Signal) : "neutral";
}

function normalizeMarketScope(value: string): MarketScope {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sector" || normalized === "theme" || normalized === "macro") return normalized;
  return "company";
}

function normalizeTickerRole(value: string) {
  const normalized = value.trim().toLowerCase();
  return allowedTickerRoles.has(normalized) ? normalized : "related";
}

function deliveryLevelFromScore(score: number): DeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function impactFromScore(score: number): Impact {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function analysisScopeFromMarketScope(value: MarketScope): AnalysisScope {
  return value === "macro" ? "market" : value;
}

function calendarStatusForFiling(datePrecision: string, isEstimated: boolean, hasExactDate: boolean) {
  return hasExactDate && !isEstimated && datePrecision === "exact" ? "confirmed" : "tentative";
}

function normalizeDateString(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function normalizeTimeString(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:00`;
}

function normalizeDatePrecision(value: string, eventDate: string | null) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "exact" ||
    normalized === "month" ||
    normalized === "quarter" ||
    normalized === "year" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return eventDate ? "exact" : "unknown";
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function firstRow(value: unknown): PersistedRow | null {
  return Array.isArray(value) && value[0] && typeof value[0] === "object"
    ? (value[0] as PersistedRow)
    : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
