import "server-only";

import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  matchCalendarEventToAnalysis,
  selectPrimaryCalendarAnalysis,
  type CalendarAnalysisFacts,
  type CalendarAnalysisMatchDecision,
  type CalendarAnalysisMatchRecord,
  type CalendarCompanyMatchRecord,
} from "./analysisLinks.ts";
import type { CalendarDateRange, CompanyCalendarEventType } from "./model.ts";

const MATCHER_PAGE_LIMIT = 2_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CalendarAnalysisMatchRunResult = {
  ok: true;
  dryRun: boolean;
  range: CalendarDateRange;
  calendarEventsScanned: number;
  analysisItemsScanned: number;
  linked: number;
  candidates: number;
  rejected: number;
  processed: number;
  changed: number;
  unchanged: number;
  primarySelected: number;
  llmReviewQueued: 0;
};

export async function runCalendarAnalysisMatcher({
  dryRun,
  range,
}: {
  dryRun: boolean;
  range: CalendarDateRange;
}): Promise<CalendarAnalysisMatchRunResult> {
  const [calendarRows, calendarItemRows] = await Promise.all([
    readCalendarRows(range),
    readAnalysisCalendarItems(range),
  ]);
  const analysisEventIds = Array.from(
    new Set(
      calendarItemRows
        .map((row) => stringValue(row.source_event_id))
        .filter((value): value is string => Boolean(value && UUID_PATTERN.test(value))),
    ),
  );
  const analysisEvents = await readAnalysisEvents(analysisEventIds);
  const analysisById = new Map(
    analysisEvents.map((event) => [stringValue(event.id), event]),
  );
  const analysisRecords = calendarItemRows
    .map((item) => buildAnalysisRecord(item, analysisById.get(stringValue(item.source_event_id))))
    .filter((value): value is CalendarAnalysisMatchRecord => value !== null);

  let linked = 0;
  let candidates = 0;
  let rejected = 0;
  let processed = 0;
  let changed = 0;
  let primarySelected = 0;

  for (const row of calendarRows) {
    const calendar = buildCalendarRecord(row);
    if (!calendar) continue;
    const decisions = bestDecisionsForCalendarEvent(calendar, analysisRecords);
    linked += decisions.filter((decision) => decision.linkStatus === "linked").length;
    candidates += decisions.filter((decision) => decision.linkStatus === "candidate").length;
    rejected += decisions.filter((decision) => decision.linkStatus === "rejected").length;
    const persistable = decisions.filter((decision) => decision.linkStatus !== "rejected");
    const primary = selectPrimaryCalendarAnalysis(persistable);
    if (primary) primarySelected += 1;
    if (dryRun || !persistable.length) continue;

    const rpc = await supabaseRpc("upsert_calendar_event_analysis_matches", {
      p_calendar_event_id: calendar.calendarEventId,
      p_matches: persistable.map(toRpcMatch),
      p_primary_analysis_event_id: primary?.analysisEventId ?? null,
    });
    if (!rpc.ok) {
      throw new Error("Calendar analysis links could not be persisted.");
    }
    const result = Array.isArray(rpc.data) ? recordValue(rpc.data[0]) : recordValue(rpc.data);
    processed += integerValue(result?.processed_count);
    changed += integerValue(result?.changed_count);
  }

  return {
    analysisItemsScanned: analysisRecords.length,
    calendarEventsScanned: calendarRows.length,
    candidates,
    changed,
    dryRun,
    linked,
    llmReviewQueued: 0,
    ok: true,
    primarySelected,
    processed,
    range,
    rejected,
    unchanged: Math.max(0, processed - changed),
  };
}

export function bestDecisionsForCalendarEvent(
  calendar: CalendarCompanyMatchRecord,
  analyses: readonly CalendarAnalysisMatchRecord[],
) {
  const byAnalysis = new Map<string, CalendarAnalysisMatchDecision>();
  for (const analysis of analyses) {
    if (!isPlausibleCandidate(calendar, analysis)) continue;
    const decision = matchCalendarEventToAnalysis(calendar, analysis);
    const current = byAnalysis.get(decision.analysisEventId);
    if (!current || decision.matchScore > current.matchScore) {
      byAnalysis.set(decision.analysisEventId, decision);
    }
  }
  return Array.from(byAnalysis.values()).sort((left, right) =>
    left.analysisEventId.localeCompare(right.analysisEventId),
  );
}

async function readCalendarRows(range: CalendarDateRange) {
  const result = await supabaseSelect("calendar_events", {
    and: `(event_date.gte.${range.from},event_date.lte.${range.to})`,
    category: "eq.company",
    limit: String(MATCHER_PAGE_LIMIT),
    order: "event_date.asc,id.asc",
    select: [
      "id",
      "event_type",
      "event_date",
      "title",
      "sources:calendar_event_sources(source_event_key)",
      "securities:calendar_event_securities(ticker,role)",
      "details:calendar_event_details(detail)",
    ].join(","),
  });
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error("Calendar events could not be loaded for analysis matching.");
  }
  return result.data.map(recordValue).filter((row): row is Record<string, unknown> => Boolean(row));
}

async function readAnalysisCalendarItems(range: CalendarDateRange) {
  const result = await supabaseSelect("event_calendar_items", {
    event_date: `gte.${range.from}`,
    limit: String(MATCHER_PAGE_LIMIT),
    order: "event_date.asc,source_event_id.asc,id.asc",
    select: "id,source_event_id,ticker,company_name,calendar_event_type,event_date,metadata",
    source_event_id: "not.is.null",
    source_group: "eq.filings",
  });
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error("SEC Calendar items could not be loaded for analysis matching.");
  }
  return result.data
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => {
      const date = stringValue(row?.event_date);
      return Boolean(row && date && date <= range.to);
    });
}

async function readAnalysisEvents(ids: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const page = ids.slice(offset, offset + 100);
    if (!page.length) continue;
    const result = await supabaseSelect("events", {
      id: `in.(${page.join(",")})`,
      limit: String(page.length),
      select: "id,event_type,ticker,title,published_at,event_date,metadata",
      source_group: "eq.filings",
    });
    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error("SEC analysis events could not be loaded for Calendar matching.");
    }
    rows.push(
      ...result.data
        .map(recordValue)
        .filter((row): row is Record<string, unknown> => Boolean(row)),
    );
  }
  return rows;
}

function buildCalendarRecord(row: Record<string, unknown>): CalendarCompanyMatchRecord | null {
  const calendarEventId = stringValue(row.id);
  const eventDate = dateValue(row.event_date);
  const eventType = companyEventType(row.event_type);
  if (!calendarEventId || !eventDate || !eventType) return null;
  const detail = relationRecords(row.details).map((value) => recordValue(value.detail)).find(Boolean) ?? {};
  const primarySecurity = relationRecords(row.securities).find((value) => value.role === "primary");
  const sourceEventId = relationRecords(row.sources)
    .map((value) => stringValue(value.source_event_key))
    .find((value) => value && (UUID_PATTERN.test(value) || isAccession(value)));

  return {
    calendarEventId,
    eventDate,
    eventType,
    facts: {
      accessionNumber: readString(detail, "accessionNumber", "accession_number"),
      cik: readString(detail, "cik"),
      companyName: readString(detail, "companyName", "company_name") ?? stringValue(row.title),
      dividendAmount: readNumber(detail, "dividendPerShare", "dividend_per_share"),
      effectiveDate: readString(detail, "effectiveDate", "effective_date"),
      epsActual: readNumber(detail, "actualEps", "actual_eps"),
      exchange: readString(detail, "exchange"),
      fiscalPeriod: readString(detail, "fiscalPeriod", "fiscal_period", "fiscalQuarter", "fiscal_quarter"),
      fiscalPeriodTrusted: Boolean(
        readString(detail, "fiscalPeriodEnd", "fiscal_period_end") ||
          readString(detail, "fiscalPeriodSource", "fiscal_period_source") === "source",
      ),
      offerTermsKey: buildOfferTermsKey(detail),
      paymentDate: readString(detail, "paymentDate", "payment_date"),
      recordDate: readString(detail, "recordDate", "record_date"),
      revenueActual: readNumber(detail, "actualRevenue", "actual_revenue"),
      sourceEventId,
      splitRatio: readString(detail, "ratio", "splitRatio", "split_ratio"),
      stage: readString(detail, "ipoStage", "ipo_stage"),
      symbol: readString(detail, "symbol"),
      ticker: stringValue(primarySecurity?.ticker),
    },
  };
}

function buildAnalysisRecord(
  item: Record<string, unknown>,
  event: Record<string, unknown> | undefined,
): CalendarAnalysisMatchRecord | null {
  if (!event) return null;
  const analysisEventId = stringValue(event.id);
  const eventDate = dateValue(item.event_date);
  const calendarEventType = stringValue(item.calendar_event_type);
  const analysisEventType = stringValue(event.event_type);
  if (!analysisEventId || !eventDate || !calendarEventType || !analysisEventType) return null;
  const metadata = recordValue(event.metadata) ?? {};
  const itemMetadata = recordValue(item.metadata) ?? {};
  const rawItem = recordValue(itemMetadata.raw_calendar_item) ?? {};
  const displayPayload = recordValue(metadata.display_payload) ?? {};
  const displayData = recordValue(displayPayload.data) ?? {};

  return {
    analysisEventId,
    analysisEventType,
    calendarEventDate: eventDate,
    calendarEventType,
    facts: {
      accessionNumber: readString(metadata, "accession_number", "accessionNumber"),
      analysisEventId,
      cik: readString(metadata, "cik"),
      companyName: stringValue(item.company_name) ?? readString(metadata, "issuer") ?? stringValue(event.title),
      declarationDate: readString(rawItem, "declaration_date", "declarationDate"),
      dividendAmount: readNumber(rawItem, "dividend_per_share", "dividendAmount", "amount"),
      dividendDateKind: dividendDateKind(calendarEventType),
      effectiveDate: readString(rawItem, "effective_date", "effectiveDate") ?? eventDate,
      epsActual: readNumber(displayData, "eps_actual", "actualEps"),
      exchange: readString(rawItem, "exchange") ?? readString(displayData, "exchange"),
      fiscalPeriod: readString(
        rawItem,
        "fiscal_period",
        "fiscalPeriod",
        "fiscal_quarter",
      ) ?? readString(displayData, "fiscal_period", "fiscalPeriod"),
      fiscalPeriodTrusted: Boolean(
        readString(rawItem, "fiscal_period_end", "fiscalPeriodEnd") ||
          readString(displayData, "fiscal_period_end", "fiscalPeriodEnd"),
      ),
      formType: readString(metadata, "form_type", "formType"),
      offerTermsKey: buildOfferTermsKey(displayData),
      paymentDate: readString(rawItem, "payment_date", "paymentDate"),
      recordDate: readString(rawItem, "record_date", "recordDate"),
      revenueActual: readNumber(displayData, "revenue_actual", "actualRevenue"),
      splitRatio: readString(rawItem, "ratio", "split_ratio", "splitRatio") ?? readString(displayData, "split_ratio"),
      stage: readString(displayData, "current_stage", "ipo_stage"),
      symbol: readString(rawItem, "symbol") ?? stringValue(item.ticker) ?? stringValue(event.ticker),
      ticker: stringValue(item.ticker) ?? stringValue(event.ticker),
    },
    publishedAt: stringValue(event.published_at),
    relationType: relationTypeFor(event, rawItem),
  };
}

function isPlausibleCandidate(
  calendar: CalendarCompanyMatchRecord,
  analysis: CalendarAnalysisMatchRecord,
) {
  const ticker = normalizeTicker(calendar.facts.ticker);
  const analysisTicker = normalizeTicker(analysis.facts.ticker);
  if (ticker && analysisTicker) return ticker === analysisTicker;
  if (calendar.eventType !== "ipo") return false;
  return normalizeCompany(calendar.facts.companyName) === normalizeCompany(analysis.facts.companyName);
}

function toRpcMatch(decision: CalendarAnalysisMatchDecision) {
  return {
    analysis_event_id: decision.analysisEventId,
    evidence: decision.evidence,
    link_status: decision.linkStatus,
    match_method: decision.matchMethod,
    match_score: decision.matchScore,
    reason: decision.reason,
    relation_type: decision.relationType,
  };
}

function relationTypeFor(
  event: Record<string, unknown>,
  rawItem: Record<string, unknown>,
) {
  const formType = readString(recordValue(event.metadata) ?? {}, "form_type", "formType") ?? "";
  if (/\/A$/i.test(formType)) return "amendment" as const;
  if (stringValue(event.event_type) === "earnings" && Boolean(rawItem.released)) {
    return "result" as const;
  }
  return "announcement" as const;
}

function dividendDateKind(value: string): CalendarAnalysisFacts["dividendDateKind"] {
  if (value === "ex_dividend_date") return "ex-dividend";
  if (value === "dividend_record_date" || value === "shareholder_record_date") return "record";
  if (value === "dividend_payment_date") return "payment";
  if (value === "dividend_declaration_date") return "declaration";
  return null;
}

function companyEventType(value: unknown): CompanyCalendarEventType | null {
  return value === "earnings" || value === "dividend" || value === "split" || value === "ipo"
    ? value
    : null;
}

function relationRecords(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(recordValue).filter((row): row is Record<string, unknown> => Boolean(row));
}

function buildOfferTermsKey(value: Record<string, unknown>) {
  const low = readNumber(value, "priceRangeLow", "price_range_low", "range_low");
  const high = readNumber(value, "priceRangeHigh", "price_range_high", "range_high");
  const shares = readNumber(value, "shares", "shares_offered", "offered_shares");
  if (low === null && high === null && shares === null) return null;
  return [low ?? "", high ?? "", shares ?? ""].join(":");
}

function readString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown) {
  const valueString = stringValue(value);
  return valueString && /^\d{4}-\d{2}-\d{2}$/.test(valueString) ? valueString : null;
}

function integerValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeTicker(value: unknown) {
  return stringValue(value)?.toUpperCase() ?? null;
}

function normalizeCompany(value: unknown) {
  return stringValue(value)
    ?.toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() ?? null;
}

function isAccession(value: string) {
  return /^\d{10}-?\d{2}-?\d{6}$/.test(value);
}
