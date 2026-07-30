import {
  CALENDAR_CATEGORIES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_MARKET_SESSIONS,
  CALENDAR_PROVIDERS,
  POLICY_SUBCATEGORIES,
  eventTypeCategories,
  type CalendarDateRange,
  type CalendarEvent,
  type CalendarEventStatus,
  type CalendarImpactLevel,
  type CalendarLifecycleStatus,
  type CalendarProvider,
  type CalendarScheduleConfidence,
  type MacroCalendarEventType,
  type MacroMetric,
  type PolicyCalendarEventType,
  type PolicySubcategory,
} from "./model.ts";
import {
  daysBetween,
  normalizeDateRange,
  parseDateOnly,
} from "./dateUtils.ts";
import { policyEventTypeSubcategories } from "./taxonomyManifest.ts";

export const MAX_CALENDAR_RANGE_DAYS = 93;
export const NORMALIZED_CALENDAR_PAGE_SIZE = 500;
export const MAX_NORMALIZED_CALENDAR_RESULTS = 2_000;

export const NORMALIZED_CALENDAR_SELECT = [
  "id",
  "event_type",
  "category",
  "title",
  "event_date",
  "event_end_date",
  "event_time",
  "event_timezone",
  "time_status",
  "market_session",
  "lifecycle_status",
  "schedule_confidence",
  "impact_level",
  "impact_scope",
  "last_seen_at",
  "updated_at",
  "type_definition:calendar_event_types!calendar_events_event_type_category_fkey(label,policy_subcategory,schema_version)",
  "sources:calendar_event_sources(provider,source_agency,source_name,source_url,source_modified_at,fetched_at,confidence)",
  "securities:calendar_event_securities(ticker,role)",
  "sectors:calendar_event_sectors(sector,role)",
  "metrics:calendar_event_metrics(metric_key,name,actual,consensus,previous,actual_text,consensus_text,previous_text,unit,unit_raw,release_stage,released)",
  "details:calendar_event_details(detail,schema_version)",
].join(",");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

export type CalendarRangeParseResult =
  | { ok: true; range: CalendarDateRange }
  | {
      ok: false;
      error: {
        code: "MISSING_RANGE" | "INVALID_RANGE" | "RANGE_TOO_LARGE";
        message: string;
      };
    };

export class CalendarRowValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "CalendarRowValidationError";
    this.field = field;
  }
}

export class CalendarRepositoryError extends Error {
  readonly code:
    | "CALENDAR_DATA_UNAVAILABLE"
    | "CALENDAR_RESULT_LIMIT"
    | "CALENDAR_RESPONSE_INVALID";

  constructor(
    code:
      | "CALENDAR_DATA_UNAVAILABLE"
      | "CALENDAR_RESULT_LIMIT"
      | "CALENDAR_RESPONSE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CalendarRepositoryError";
    this.code = code;
  }
}

export type CalendarSelectResult = {
  ok: boolean;
  status: number;
  data: unknown;
  count: number | null;
  error?: string;
};

export type CalendarSelect = (
  table: string,
  query: Record<string, string>,
) => Promise<CalendarSelectResult>;

export function parseNormalizedCalendarRange(
  searchParams: Pick<URLSearchParams, "get">,
): CalendarRangeParseResult {
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  if (!from || !to) {
    return {
      ok: false,
      error: {
        code: "MISSING_RANGE",
        message: "Both from and to date parameters are required.",
      },
    };
  }

  try {
    parseDateOnly(from);
    parseDateOnly(to);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_RANGE",
        message: "Calendar dates must be valid YYYY-MM-DD values.",
      },
    };
  }

  if (from > to) {
    return {
      ok: false,
      error: {
        code: "INVALID_RANGE",
        message: "The from date must not be later than the to date.",
      },
    };
  }

  const range = normalizeDateRange({ from, to });
  if (daysBetween(range.from, range.to) + 1 > MAX_CALENDAR_RANGE_DAYS) {
    return {
      ok: false,
      error: {
        code: "RANGE_TOO_LARGE",
        message: `Calendar ranges are limited to ${MAX_CALENDAR_RANGE_DAYS} days.`,
      },
    };
  }

  return { ok: true, range };
}

export function buildNormalizedCalendarQuery(
  range: CalendarDateRange,
  offset = 0,
) {
  const normalized = normalizeDateRange(range);
  return {
    and: `(event_date.gte.${normalized.from},event_date.lte.${normalized.to})`,
    limit: String(NORMALIZED_CALENDAR_PAGE_SIZE),
    offset: String(Math.max(0, Math.floor(offset))),
    order: "event_date.asc,event_time.asc.nullslast,id.asc",
    select: NORMALIZED_CALENDAR_SELECT,
  };
}

export async function readNormalizedCalendarEvents(
  range: CalendarDateRange,
  select: CalendarSelect,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  for (
    let offset = 0;
    offset < MAX_NORMALIZED_CALENDAR_RESULTS;
    offset += NORMALIZED_CALENDAR_PAGE_SIZE
  ) {
    const result = await select(
      "calendar_events",
      buildNormalizedCalendarQuery(range, offset),
    );
    if (!result.ok) {
      throw new CalendarRepositoryError(
        "CALENDAR_DATA_UNAVAILABLE",
        "Normalized Calendar data could not be loaded.",
      );
    }
    if (!Array.isArray(result.data)) {
      throw new CalendarRepositoryError(
        "CALENDAR_RESPONSE_INVALID",
        "Normalized Calendar returned an invalid response.",
      );
    }
    if (
      typeof result.count === "number" &&
      result.count > MAX_NORMALIZED_CALENDAR_RESULTS
    ) {
      throw new CalendarRepositoryError(
        "CALENDAR_RESULT_LIMIT",
        "The selected Calendar range contains too many events.",
      );
    }

    try {
      events.push(...mapNormalizedCalendarRows(result.data));
    } catch (error) {
      if (error instanceof CalendarRowValidationError) {
        throw new CalendarRepositoryError(
          "CALENDAR_RESPONSE_INVALID",
          `Normalized Calendar row failed validation at ${error.field}.`,
        );
      }
      throw error;
    }

    if (
      result.data.length < NORMALIZED_CALENDAR_PAGE_SIZE ||
      (typeof result.count === "number" && events.length >= result.count)
    ) {
      return events;
    }
  }

  throw new CalendarRepositoryError(
    "CALENDAR_RESULT_LIMIT",
    "The selected Calendar range contains too many events.",
  );
}

export function mapNormalizedCalendarRows(rows: readonly unknown[]) {
  return rows.map(mapNormalizedCalendarRow);
}

export function mapNormalizedCalendarRow(value: unknown): CalendarEvent {
  const row = requireRecord(value, "row");
  const id = requireString(row.id, "id");
  if (!UUID_PATTERN.test(id)) {
    throw invalid("id", "Calendar event id must be a UUID.");
  }

  const eventType = requireAllowed(
    row.event_type,
    CALENDAR_EVENT_TYPES,
    "event_type",
  );
  const category = requireAllowed(
    row.category,
    CALENDAR_CATEGORIES,
    "category",
  );
  if (eventTypeCategories[eventType] !== category) {
    throw invalid(
      "category",
      `Calendar event type ${eventType} does not belong to ${category}.`,
    );
  }

  const eventDate = requireDateOnly(row.event_date, "event_date");
  const eventEndDate = optionalDateOnly(row.event_end_date, "event_end_date");
  if (eventEndDate && eventEndDate < eventDate) {
    throw invalid("event_end_date", "Event end date precedes event date.");
  }

  const timeStatus = requireAllowed(
    row.time_status,
    ["exact", "time-not-announced", "all-day"] as const,
    "time_status",
  );
  const eventTime =
    timeStatus === "exact"
      ? requireClockTime(row.event_time, "event_time")
      : optionalClockTime(row.event_time, "event_time");
  if (timeStatus !== "exact" && eventTime !== null) {
    throw invalid(
      "event_time",
      "Only exact events may expose a local event time.",
    );
  }

  const timezone = requireString(row.event_timezone, "event_timezone");
  if (timezone !== "America/New_York") {
    throw invalid(
      "event_timezone",
      "Calendar V1 only accepts America/New_York schedules.",
    );
  }

  const marketSession = requireAllowed(
    row.market_session,
    CALENDAR_MARKET_SESSIONS,
    "market_session",
  );
  const lifecycleStatus = requireAllowed(
    row.lifecycle_status,
    ["scheduled", "released", "postponed", "cancelled"] as const,
    "lifecycle_status",
  );
  const scheduleConfidence = requireAllowed(
    row.schedule_confidence,
    ["confirmed", "tentative"] as const,
    "schedule_confidence",
  );
  const impactLevel = requireAllowed(
    row.impact_level,
    ["high", "medium", "low"] as const,
    "impact_level",
  );
  const impactScope = requireAllowed(
    row.impact_scope,
    ["market-wide", "sector", "company"] as const,
    "impact_scope",
  );
  const title = requireString(row.title, "title");
  const updatedAt = requireInstant(row.updated_at, "updated_at");
  const typeDefinition = relationRecord(row.type_definition);
  if (!typeDefinition) {
    throw invalid(
      "type_definition",
      "Calendar event type definition is missing.",
    );
  }

  const expectedPolicySubcategory =
    category === "policy"
      ? policyEventTypeSubcategories[eventType as PolicyCalendarEventType]
      : null;
  const policySubcategory = optionalAllowed(
    typeDefinition.policy_subcategory,
    POLICY_SUBCATEGORIES,
    "type_definition.policy_subcategory",
  );
  if (policySubcategory !== expectedPolicySubcategory) {
    throw invalid(
      "type_definition.policy_subcategory",
      "Calendar policy subcategory does not match the event type.",
    );
  }

  const sources = relationRecords(row.sources)
    .map(readSource)
    .filter((source): source is NormalizedSource => source !== null)
    .sort(compareSources);
  const source = sources[0] ?? null;
  const securities = relationRecords(row.securities)
    .map(readSecurity)
    .filter((security): security is NormalizedSecurity => security !== null);
  const sectors = Array.from(
    new Set(
      relationRecords(row.sectors)
        .map((item) => optionalString(item.sector))
        .filter((sector): sector is string => Boolean(sector)),
    ),
  );
  const primaryTicker =
    securities.find((security) => security.role === "primary")?.ticker ?? null;
  const relatedTickers = Array.from(
    new Set(
      securities
        .filter((security) => security.role !== "primary")
        .map((security) => security.ticker),
    ),
  );
  const detail = readDetail(row.details);
  const metrics = relationRecords(row.metrics)
    .map(readMetric)
    .filter((metric): metric is MacroMetric => metric !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
  const lastUpdatedAt = latestInstant([
    updatedAt,
    optionalInstant(row.last_seen_at),
    source?.sourceModifiedAt ?? null,
    source?.fetchedAt ?? null,
  ]);

  const common = {
    affectedSectors: sectors,
    eventDate,
    eventEndDate,
    eventTime,
    id,
    impactLevel,
    impactScope,
    lastUpdatedAt,
    lifecycleStatus,
    marketSession,
    provider: source?.provider ?? ("unknown" as const),
    relatedTickers,
    scheduleConfidence,
    source: source?.agency ?? "Calendar",
    sourceAgency: source?.agency ?? "Agency not announced",
    sourceName: source?.name ?? "Source not announced",
    sourceUrl: source?.url ?? null,
    status: deriveCalendarStatus(lifecycleStatus, scheduleConfidence),
    timeStatus,
    timezone: "America/New_York" as const,
    title,
  };

  if (category === "company") {
    const companyName =
      readDetailString(detail, "companyName", "company_name") ??
      (primaryTicker ? `${primaryTicker} company` : "Company not announced");
    const companyCommon = {
      ...common,
      category: "company" as const,
      companyName,
      isWatchlisted: false,
      ticker: primaryTicker,
    };

    if (eventType === "earnings") {
      return {
        ...companyCommon,
        eventType,
        details: {
          actualEps: readDetailNumber(detail, "actualEps", "actual_eps"),
          actualRevenue: readDetailNumber(
            detail,
            "actualRevenue",
            "actual_revenue",
          ),
          epsEstimate: readDetailNumber(
            detail,
            "epsEstimate",
            "eps_estimate",
          ),
          fiscalQuarter: readDetailString(
            detail,
            "fiscalQuarter",
            "fiscal_quarter",
          ),
          outcome: readDetailAllowed(
            detail,
            ["beat", "miss", "in-line"] as const,
            "outcome",
          ),
          revenueEstimate: readDetailNumber(
            detail,
            "revenueEstimate",
            "revenue_estimate",
          ),
        },
      };
    }
    if (eventType === "dividend") {
      return {
        ...companyCommon,
        eventType,
        details: {
          currency: readDetailString(detail, "currency"),
          dividendPerShare: readDetailNumber(
            detail,
            "dividendPerShare",
            "dividend_per_share",
          ),
          exDividendDate: readDetailDate(
            detail,
            "exDividendDate",
            "ex_dividend_date",
          ),
          frequency: readDetailString(detail, "frequency"),
          paymentDate: readDetailDate(
            detail,
            "paymentDate",
            "payment_date",
          ),
          recordDate: readDetailDate(detail, "recordDate", "record_date"),
        },
      };
    }
    if (eventType === "split") {
      return {
        ...companyCommon,
        eventType,
        details: {
          effectiveDate: readDetailDate(
            detail,
            "effectiveDate",
            "effective_date",
          ),
          ratio: readDetailString(detail, "ratio"),
          relatedTicker: readDetailTicker(
            detail,
            "relatedTicker",
            "related_ticker",
          ),
          splitKind: readDetailAllowed(
            detail,
            ["forward", "reverse"] as const,
            "splitKind",
            "split_kind",
          ),
        },
      };
    }
    if (eventType === "ipo") {
      return {
        ...companyCommon,
        eventType,
        details: {
          exchange: readDetailString(detail, "exchange"),
          ipoStage: readDetailAllowed(
            detail,
            [
              "expected",
              "date-estimated",
              "range-announced",
              "priced",
              "trading",
            ] as const,
            "ipoStage",
            "ipo_stage",
          ),
          offerPrice: readDetailNumber(detail, "offerPrice", "offer_price"),
          priceRangeHigh: readDetailNumber(
            detail,
            "priceRangeHigh",
            "price_range_high",
          ),
          priceRangeLow: readDetailNumber(
            detail,
            "priceRangeLow",
            "price_range_low",
          ),
          raiseAmount: readDetailNumber(
            detail,
            "raiseAmount",
            "raise_amount",
          ),
        },
      };
    }
  }

  if (category === "macro") {
    return {
      ...common,
      category,
      eventType: eventType as MacroCalendarEventType,
      details: {
        metrics,
        referencePeriod: readDetailString(
          detail,
          "referencePeriod",
          "reference_period",
        ),
        releaseNote: readDetailString(detail, "releaseNote", "release_note"),
      },
    };
  }

  const policyCommon = {
    ...common,
    category: "policy" as const,
    policySubcategory: policySubcategory as PolicySubcategory,
    primaryTicker,
  };
  if (eventType === "fomc-decision") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "monetary-policy",
      details: {
        decisionTime: readDetailTime(
          detail,
          "decisionTime",
          "decision_time",
        ),
        includesSep: readDetailBoolean(detail, "includesSep", "includes_sep"),
        pressConferenceTime: readDetailTime(
          detail,
          "pressConferenceTime",
          "press_conference_time",
        ),
        targetRangeLower: readDetailNumber(
          detail,
          "targetRangeLower",
          "target_range_lower",
        ),
        targetRangeUpper: readDetailNumber(
          detail,
          "targetRangeUpper",
          "target_range_upper",
        ),
      },
    };
  }
  if (eventType === "fomc-minutes") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "monetary-policy",
      details: {
        documentTitle: readDetailString(
          detail,
          "documentTitle",
          "document_title",
        ),
        meetingPeriod: readDetailString(
          detail,
          "meetingPeriod",
          "meeting_period",
        ),
      },
    };
  }
  if (eventType === "fed-chair-testimony") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "monetary-policy",
      details: {
        committee: readDetailString(detail, "committee"),
        topic: readDetailString(detail, "topic"),
        witness: readDetailString(detail, "witness"),
      },
    };
  }
  if (
    eventType === "treasury-borrowing-estimate" ||
    eventType === "treasury-refunding" ||
    eventType === "treasury-auction-10y" ||
    eventType === "treasury-auction-30y"
  ) {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "treasury",
      details: {
        amountBillions: readDetailNumber(
          detail,
          "amountBillions",
          "amount_billions",
        ),
        kind: readDetailAllowed(
          detail,
          ["announcement", "auction"] as const,
          "kind",
        ),
        maturity: readDetailString(detail, "maturity"),
        result: readDetailString(detail, "result"),
      },
    };
  }
  if (eventType === "sec-open-meeting" || eventType === "sec-rule-milestone") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "sec-regulation",
      details: {
        agenda: readDetailStringArray(detail, "agenda"),
        documentOrDocket: readDetailString(
          detail,
          "documentOrDocket",
          "document_or_docket",
        ),
        milestone: readDetailAllowed(
          detail,
          [
            "meeting",
            "comment-deadline",
            "effective-date",
            "compliance-date",
          ] as const,
          "milestone",
        ),
        ruleOrMeetingTitle: readDetailString(
          detail,
          "ruleOrMeetingTitle",
          "rule_or_meeting_title",
        ),
      },
    };
  }
  if (eventType === "trade-policy-action") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "trade-policy",
      details: {
        actionDateKind: readDetailAllowed(
          detail,
          ["effective-date", "comment-deadline"] as const,
          "actionDateKind",
          "action_date_kind",
        ),
        actionType: readDetailAllowed(
          detail,
          ["tariff", "export-control", "sanctions"] as const,
          "actionType",
          "action_type",
        ),
        affectedIndustries: readDetailStringArray(
          detail,
          "affectedIndustries",
          "affected_industries",
        ),
        targetCountries: readDetailStringArray(
          detail,
          "targetCountries",
          "target_countries",
        ),
        tariffOrRestriction: readDetailString(
          detail,
          "tariffOrRestriction",
          "tariff_or_restriction",
        ),
      },
    };
  }
  if (eventType === "fda-advisory-committee") {
    return {
      ...policyCommon,
      eventType,
      policySubcategory: "industry-regulation",
      details: {
        committee: readDetailString(detail, "committee"),
        indication: readDetailString(detail, "indication"),
        meetingEndDate: readDetailDate(
          detail,
          "meetingEndDate",
          "meeting_end_date",
        ),
        meetingStartDate: readDetailDate(
          detail,
          "meetingStartDate",
          "meeting_start_date",
        ),
        product: readDetailString(detail, "product"),
        sponsor: readDetailString(detail, "sponsor"),
      },
    };
  }

  throw invalid("event_type", `Unsupported Calendar event type: ${eventType}`);
}

export function parseCalendarEventsApiPayload(value: unknown): CalendarEvent[] {
  const response = requireRecord(value, "response");
  if (response.ok !== true || !Array.isArray(response.data)) {
    throw invalid("response", "Calendar API response is not successful.");
  }
  for (const [index, event] of response.data.entries()) {
    assertPublicCalendarEvent(event, `data.${index}`);
  }
  return response.data as CalendarEvent[];
}

export function normalizeCalendarProvider(value: unknown): CalendarProvider {
  const text = optionalString(value)?.toLocaleLowerCase("en-US") ?? "";
  const normalized = text.replaceAll("_", "-").replaceAll(" ", "-");
  const aliases: Record<string, CalendarProvider> = {
    "financial-modeling-prep": "fmp",
    "federal-reserve-board": "federal-reserve",
    "bureau-of-economic-analysis": "bea",
    "bureau-of-labor-statistics": "bls",
    "u.s.-census-bureau": "census",
    "united-states-census-bureau": "census",
    treasury: "us-treasury",
    "u.s.-treasury": "us-treasury",
    "securities-and-exchange-commission": "sec",
    "u.s.-securities-and-exchange-commission": "sec",
  };
  if (aliases[normalized]) return aliases[normalized];
  if ((CALENDAR_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as CalendarProvider;
  }
  return text ? "other" : "unknown";
}

export function normalizeSafeCalendarSourceUrl(value: unknown): string | null {
  const text = optionalString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function deriveCalendarStatus(
  lifecycleStatus: CalendarLifecycleStatus,
  scheduleConfidence: CalendarScheduleConfidence,
): CalendarEventStatus {
  if (lifecycleStatus === "released") return "completed";
  if (lifecycleStatus === "postponed") return "postponed";
  if (lifecycleStatus === "cancelled") return "cancelled";
  return scheduleConfidence === "tentative" ? "estimated" : "confirmed";
}

type NormalizedSource = {
  agency: string;
  confidence: CalendarImpactLevel;
  fetchedAt: string | null;
  name: string;
  provider: CalendarProvider;
  sourceModifiedAt: string | null;
  url: string | null;
};

type NormalizedSecurity = {
  role: "primary" | "related" | "affected";
  ticker: string;
};

function readSource(row: Record<string, unknown>): NormalizedSource | null {
  const agency = optionalString(row.source_agency);
  const name = optionalString(row.source_name);
  if (!agency || !name) return null;
  return {
    agency,
    confidence:
      optionalAllowed(
        row.confidence,
        ["high", "medium", "low"] as const,
        "sources.confidence",
      ) ?? "low",
    fetchedAt: optionalInstant(row.fetched_at),
    name,
    provider: normalizeCalendarProvider(row.provider),
    sourceModifiedAt: optionalInstant(row.source_modified_at),
    url: normalizeSafeCalendarSourceUrl(row.source_url),
  };
}

function compareSources(left: NormalizedSource, right: NormalizedSource) {
  const rank = { high: 3, medium: 2, low: 1 };
  return (
    rank[right.confidence] - rank[left.confidence] ||
    (right.sourceModifiedAt ?? right.fetchedAt ?? "").localeCompare(
      left.sourceModifiedAt ?? left.fetchedAt ?? "",
    )
  );
}

function readSecurity(row: Record<string, unknown>): NormalizedSecurity | null {
  const ticker = optionalString(row.ticker)?.toUpperCase() ?? "";
  const role = optionalAllowed(
    row.role,
    ["primary", "related", "affected"] as const,
    "securities.role",
  );
  if (!ticker || !TICKER_PATTERN.test(ticker) || !role) return null;
  return { role, ticker };
}

function readMetric(row: Record<string, unknown>): MacroMetric | null {
  const name = optionalString(row.name);
  const unit = normalizeMetricUnit(row.unit, row.unit_raw);
  const releaseStage = optionalAllowed(
    row.release_stage,
    ["monthly", "advance", "preliminary", "final"] as const,
    "metrics.release_stage",
  );
  if (!name || !unit || !releaseStage || typeof row.released !== "boolean") {
    return null;
  }
  return {
    actual: readNumeric(row.actual),
    consensus: readNumeric(row.consensus),
    name,
    previous: readNumeric(row.previous),
    releaseStage,
    released: row.released,
    unit,
  };
}

function normalizeMetricUnit(
  unitValue: unknown,
  rawValue: unknown,
): MacroMetric["unit"] | null {
  const value = (optionalString(unitValue) ?? optionalString(rawValue) ?? "")
    .toLocaleLowerCase("en-US")
    .replaceAll("_", "-");
  if (value === "percent" || value === "%" || value === "percentage") {
    return "percent";
  }
  if (value === "thousands" || value === "thousand" || value === "k") {
    return "thousands";
  }
  if (value === "index" || value === "index-points") return "index";
  if (
    value === "billions-usd" ||
    value === "usd-billions" ||
    value === "$-billions"
  ) {
    return "billions-usd";
  }
  return null;
}

function readDetail(value: unknown): Record<string, unknown> {
  const relation = relationRecord(value);
  return relation ? optionalRecord(relation.detail) ?? {} : {};
}

function readDetailString(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  return optionalString(readFirst(detail, keys));
}

function readDetailStringArray(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  const value = readFirst(detail, keys);
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(optionalString)
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

function readDetailNumber(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  return readNumeric(readFirst(detail, keys));
}

function readDetailBoolean(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  const value = readFirst(detail, keys);
  return typeof value === "boolean" ? value : null;
}

function readDetailDate(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  const value = optionalString(readFirst(detail, keys));
  if (!value || !DATE_ONLY_PATTERN.test(value)) return null;
  try {
    parseDateOnly(value);
    return value;
  } catch {
    return null;
  }
}

function readDetailTime(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  return optionalClockTime(readFirst(detail, keys), keys[0]);
}

function readDetailTicker(
  detail: Record<string, unknown>,
  ...keys: string[]
) {
  const value = optionalString(readFirst(detail, keys))?.toUpperCase() ?? "";
  return value && TICKER_PATTERN.test(value) ? value : null;
}

function readDetailAllowed<const T extends readonly string[]>(
  detail: Record<string, unknown>,
  allowed: T,
  ...keys: string[]
): T[number] | null {
  return optionalAllowed(readFirst(detail, keys), allowed, keys[0]);
}

function readFirst(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return null;
}

function relationRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map(optionalRecord)
    .filter((item): item is Record<string, unknown> => item !== null);
}

function relationRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return optionalRecord(value[0]);
  return optionalRecord(value);
}

function requireRecord(value: unknown, field: string) {
  const record = optionalRecord(value);
  if (!record) throw invalid(field, `${field} must be an object.`);
  return record;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, field: string) {
  const text = optionalString(value);
  if (!text) throw invalid(field, `${field} must be a non-empty string.`);
  return text;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireAllowed<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  const parsed = optionalAllowed(value, allowed, field);
  if (!parsed) throw invalid(field, `${field} is not supported.`);
  return parsed;
}

function optionalAllowed<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  _field: string,
): T[number] | null {
  const text = optionalString(value);
  return text && (allowed as readonly string[]).includes(text)
    ? (text as T[number])
    : null;
}

function requireDateOnly(value: unknown, field: string) {
  const date = optionalDateOnly(value, field);
  if (!date) throw invalid(field, `${field} must be a valid date-only value.`);
  return date;
}

function optionalDateOnly(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const text = optionalString(value);
  if (!text || !DATE_ONLY_PATTERN.test(text)) {
    throw invalid(field, `${field} must be a valid date-only value.`);
  }
  try {
    parseDateOnly(text);
    return text;
  } catch {
    throw invalid(field, `${field} must be a valid date-only value.`);
  }
}

function requireClockTime(value: unknown, field: string) {
  const time = optionalClockTime(value, field);
  if (!time) throw invalid(field, `${field} must be a valid local time.`);
  return time;
}

function optionalClockTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = optionalString(value);
  const match = text?.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) throw invalid(field, `${field} must be a valid local time.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw invalid(field, `${field} must be a valid local time.`);
  }
  return `${match[1]}:${match[2]}`;
}

function requireInstant(value: unknown, field: string) {
  const instant = optionalInstant(value);
  if (!instant) throw invalid(field, `${field} must be an ISO timestamp.`);
  return instant;
}

function optionalInstant(value: unknown) {
  const text = optionalString(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function latestInstant(values: Array<string | null>) {
  const valid = values.filter((value): value is string => Boolean(value));
  const latest = valid.sort((left, right) => right.localeCompare(left))[0];
  if (!latest) throw invalid("updated_at", "Calendar update timestamp is missing.");
  return latest;
}

function readNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function assertPublicCalendarEvent(value: unknown, field: string) {
  const event = requireRecord(value, field);
  const category = requireAllowed(
    event.category,
    CALENDAR_CATEGORIES,
    `${field}.category`,
  );
  const eventType = requireAllowed(
    event.eventType,
    CALENDAR_EVENT_TYPES,
    `${field}.eventType`,
  );
  if (eventTypeCategories[eventType] !== category) {
    throw invalid(`${field}.eventType`, "Calendar API category/type mismatch.");
  }
  requireString(event.id, `${field}.id`);
  requireString(event.title, `${field}.title`);
  requireDateOnly(event.eventDate, `${field}.eventDate`);
  requireAllowed(
    event.marketSession,
    CALENDAR_MARKET_SESSIONS,
    `${field}.marketSession`,
  );
  requireRecord(event.details, `${field}.details`);
  if (!Array.isArray(event.affectedSectors) || !Array.isArray(event.relatedTickers)) {
    throw invalid(field, "Calendar API relation arrays are missing.");
  }
}

function invalid(field: string, message: string) {
  return new CalendarRowValidationError(field, message);
}
