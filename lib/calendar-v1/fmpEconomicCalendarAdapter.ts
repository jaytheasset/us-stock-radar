import { createHash } from "node:crypto";
import {
  buildFmpEconomicCalendarIdentity,
  extractFmpReferencePeriod,
  type FmpReferencePeriod,
} from "./fmpEconomicCalendarIdentity.ts";
import type {
  FmpEconomicCalendarAdapterResult,
  FmpEconomicCalendarEventType,
  FmpEconomicCalendarMetric,
  FmpEconomicCalendarObservation,
} from "./fmpEconomicCalendarTypes.ts";
import type {
  CalendarImpactLevel,
  MacroMetric,
  PolicySubcategory,
} from "./model.ts";

type AdapterContext = {
  eventTypes: ReadonlySet<FmpEconomicCalendarEventType>;
  fetchedAt: string;
  requestFrom: string;
  requestTo: string;
  runId: string;
};

type ParsedRow = {
  actual: number | null;
  estimate: number | null;
  event: string;
  eventDate: string;
  eventInstant: string;
  eventTime: string;
  impact: CalendarImpactLevel;
  previous: number | null;
  raw: Record<string, unknown>;
  unit: string | null;
};

type MetricDefinition = {
  eventType:
    | "cpi"
    | "ppi"
    | "pce"
    | "employment-situation"
    | "jolts"
    | "gdp-advance"
    | "retail-sales";
  metricKey: string;
  metricName: string;
  releaseStage: MacroMetric["releaseStage"];
  unit: MacroMetric["unit"];
  valueMultiplier?: number;
};

const METRIC_DEFINITIONS = new Map<string, MetricDefinition>([
  [
    "CPI YoY",
    {
      eventType: "cpi",
      metricKey: "headline-yoy",
      metricName: "Headline CPI YoY",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Core CPI YoY",
    {
      eventType: "cpi",
      metricKey: "core-yoy",
      metricName: "Core CPI YoY",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Producer Price Index MoM",
    {
      eventType: "ppi",
      metricKey: "headline-mom",
      metricName: "Headline PPI MoM",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Core PPI MoM",
    {
      eventType: "ppi",
      metricKey: "core-mom",
      metricName: "Core PPI MoM",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "PCE Price Index YoY",
    {
      eventType: "pce",
      metricKey: "headline-yoy",
      metricName: "Headline PCE YoY",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Core PCE Price Index YoY",
    {
      eventType: "pce",
      metricKey: "core-yoy",
      metricName: "Core PCE YoY",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Non Farm Payrolls",
    {
      eventType: "employment-situation",
      metricKey: "nonfarm-payrolls",
      metricName: "Nonfarm Payrolls",
      releaseStage: "monthly",
      unit: "thousands",
    },
  ],
  [
    "Unemployment Rate",
    {
      eventType: "employment-situation",
      metricKey: "unemployment-rate",
      metricName: "Unemployment Rate",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "Average Hourly Earnings YoY",
    {
      eventType: "employment-situation",
      metricKey: "average-hourly-earnings-yoy",
      metricName: "Average Hourly Earnings YoY",
      releaseStage: "monthly",
      unit: "percent",
    },
  ],
  [
    "JOLTs Job Openings",
    {
      eventType: "jolts",
      metricKey: "job-openings",
      metricName: "Job Openings",
      releaseStage: "monthly",
      unit: "thousands",
      valueMultiplier: 1_000,
    },
  ],
  [
    "GDP Growth Rate QoQ",
    {
      eventType: "gdp-advance",
      metricKey: "real-gdp-annualized",
      metricName: "Real GDP annualized",
      releaseStage: "advance",
      unit: "percent",
    },
  ],
  [
    "Retail Sales MoM",
    {
      eventType: "retail-sales",
      metricKey: "retail-sales-mom",
      metricName: "Retail Sales MoM",
      releaseStage: "advance",
      unit: "percent",
    },
  ],
]);

const POLICY_EVENTS = new Map<
  string,
  Exclude<FmpEconomicCalendarEventType, MetricDefinition["eventType"]>
>([
  ["Fed Interest Rate Decision", "fomc-decision"],
  ["FOMC Economic Projections", "fomc-decision"],
  ["FOMC Minutes", "fomc-minutes"],
  ["Treasury Refunding Announcement", "treasury-refunding"],
  ["10-Year Note Auction", "treasury-auction-10y"],
  ["30-Year Bond Auction", "treasury-auction-30y"],
]);

const EVENT_METADATA: Record<
  FmpEconomicCalendarEventType,
  {
    releaseNote: string | null;
    sourceAgency: string;
    title: string;
  }
> = {
  cpi: {
    releaseNote: "Headline and core CPI are one release event.",
    sourceAgency: "U.S. Bureau of Labor Statistics",
    title: "Consumer Price Index",
  },
  ppi: {
    releaseNote: "Headline and core PPI are one release event.",
    sourceAgency: "U.S. Bureau of Labor Statistics",
    title: "Producer Price Index",
  },
  pce: {
    releaseNote: "Headline and core PCE are one release event.",
    sourceAgency: "U.S. Bureau of Economic Analysis",
    title: "PCE Price Index",
  },
  "employment-situation": {
    releaseNote: "Payrolls, unemployment, and wages remain one event.",
    sourceAgency: "U.S. Bureau of Labor Statistics",
    title: "Employment Situation",
  },
  jolts: {
    releaseNote: null,
    sourceAgency: "U.S. Bureau of Labor Statistics",
    title: "JOLTS Job Openings",
  },
  "gdp-advance": {
    releaseNote: "Advance estimate; later revisions remain separate stages.",
    sourceAgency: "U.S. Bureau of Economic Analysis",
    title: "GDP Advance Estimate",
  },
  "retail-sales": {
    releaseNote: null,
    sourceAgency: "U.S. Census Bureau",
    title: "Retail Sales",
  },
  "fomc-decision": {
    releaseNote: null,
    sourceAgency: "Federal Reserve",
    title: "FOMC Decision",
  },
  "fomc-minutes": {
    releaseNote: null,
    sourceAgency: "Federal Reserve",
    title: "FOMC Meeting Minutes",
  },
  "treasury-refunding": {
    releaseNote: null,
    sourceAgency: "U.S. Treasury",
    title: "Treasury Quarterly Refunding",
  },
  "treasury-auction-10y": {
    releaseNote: null,
    sourceAgency: "U.S. Treasury",
    title: "10-Year Treasury Note Auction",
  },
  "treasury-auction-30y": {
    releaseNote: null,
    sourceAgency: "U.S. Treasury",
    title: "30-Year Treasury Bond Auction",
  },
};

export function adaptFmpEconomicCalendarRows(
  values: readonly unknown[],
  context: AdapterContext,
): FmpEconomicCalendarAdapterResult {
  const groups = new Map<
    string,
    {
      eventType: FmpEconomicCalendarEventType;
      referencePeriod: FmpReferencePeriod | null;
      rows: ParsedRow[];
    }
  >();
  const warnings = new Set<string>();
  let matchedRows = 0;
  let rejectedRows = 0;
  let unsupportedRows = 0;
  let usRows = 0;

  for (const value of values) {
    const raw = recordValue(value);
    if (!raw) continue;
    if (stringValue(raw.country)?.toUpperCase() !== "US") continue;
    usRows += 1;

    const parsed = parseRow(raw);
    if (!parsed) {
      rejectedRows += 1;
      warnings.add("rejected:invalid_us_row");
      continue;
    }
    const eventBase = baseEventName(parsed.event);
    const metric = METRIC_DEFINITIONS.get(eventBase) ?? null;
    const policyEventType = POLICY_EVENTS.get(eventBase) ?? null;
    const eventType = metric?.eventType ?? policyEventType;
    if (!eventType) {
      unsupportedRows += 1;
      continue;
    }
    if (!context.eventTypes.has(eventType)) continue;

    const referencePeriod = metric
      ? extractFmpReferencePeriod(parsed.event, parsed.eventDate)
      : null;
    if (metric && !referencePeriod) {
      rejectedRows += 1;
      warnings.add(`rejected:reference_period_missing:${eventBase}`);
      continue;
    }
    const identity = buildFmpEconomicCalendarIdentity({
      eventDate: parsed.eventDate,
      eventType,
      referencePeriod,
    });
    const group = groups.get(identity) ?? {
      eventType,
      referencePeriod,
      rows: [],
    };
    group.rows.push(parsed);
    groups.set(identity, group);
    matchedRows += 1;
  }

  const observations = Array.from(groups.entries())
    .map(([identity, group]) =>
      createObservation(identity, group, context, warnings),
    )
    .filter(
      (observation): observation is FmpEconomicCalendarObservation =>
        observation !== null,
    )
    .sort(
      (left, right) =>
        left.eventDate.localeCompare(right.eventDate) ||
        left.eventTime.localeCompare(right.eventTime) ||
        left.eventType.localeCompare(right.eventType),
    );

  return {
    matchedRows,
    observations,
    rejectedRows,
    unsupportedRows,
    usRows,
    warnings: Array.from(warnings).sort(),
  };
}

function createObservation(
  identity: string,
  group: {
    eventType: FmpEconomicCalendarEventType;
    referencePeriod: FmpReferencePeriod | null;
    rows: ParsedRow[];
  },
  context: AdapterContext,
  warnings: Set<string>,
): FmpEconomicCalendarObservation | null {
  const rows = [...group.rows].sort(
    (left, right) =>
      left.eventInstant.localeCompare(right.eventInstant) ||
      left.event.localeCompare(right.event),
  );
  const scheduleKeys = new Set(
    rows.map((row) => `${row.eventDate}T${row.eventTime}`),
  );
  if (scheduleKeys.size !== 1) {
    warnings.add(`rejected:conflicting_group_schedule:${identity}`);
    return null;
  }

  const eventType = group.eventType;
  const category = isPolicyEvent(eventType)
    ? ("policy" as const)
    : ("macro" as const);
  const representative = rows[0];
  const metricMap = new Map<string, FmpEconomicCalendarMetric>();
  for (const row of rows) {
    const definition = METRIC_DEFINITIONS.get(baseEventName(row.event));
    if (!definition) continue;
    if (!unitMatches(row.unit, definition)) {
      warnings.add(`rejected:metric_unit:${definition.metricKey}`);
      continue;
    }
    const multiplier = definition.valueMultiplier ?? 1;
    const metric = {
      actual: multiply(row.actual, multiplier),
      consensus: multiply(row.estimate, multiplier),
      metricKey: definition.metricKey,
      name: definition.metricName,
      previous: multiply(row.previous, multiplier),
      releaseStage: definition.releaseStage,
      released: row.actual !== null,
      unit: definition.unit,
    };
    if (metricMap.has(definition.metricKey)) {
      warnings.add(`deduplicated:metric:${identity}:${definition.metricKey}`);
      continue;
    }
    metricMap.set(definition.metricKey, metric);
  }
  const metrics = Array.from(metricMap.values()).sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey),
  );
  if (category === "macro" && metrics.length === 0) {
    warnings.add(`rejected:no_allowed_metrics:${identity}`);
    return null;
  }

  const rawPayload = {
    rows: rows
      .map((row) => row.raw)
      .sort((left, right) =>
        stableStringify(left).localeCompare(stableStringify(right)),
      ),
  };
  const details =
    category === "macro"
      ? {
          referencePeriod: group.referencePeriod?.display ?? null,
          releaseNote: EVENT_METADATA[eventType].releaseNote,
        }
      : policyDetails(eventType, representative.eventTime);
  const lifecycleStatus: "released" | "scheduled" =
    metrics.some((metric) => metric.released) ||
    (category === "policy" &&
      (rows.some((row) => row.actual !== null) ||
        representative.eventInstant <= context.fetchedAt))
      ? "released"
      : "scheduled";
  const normalized = {
    category,
    details,
    eventDate: representative.eventDate,
    eventInstant: representative.eventInstant,
    eventTime: representative.eventTime,
    eventType,
    impactLevel: strongestImpact(rows.map((row) => row.impact)),
    lifecycleStatus,
    marketSession: marketSession(representative.eventTime),
    metrics,
    policySubcategory: policySubcategory(eventType),
    title: EVENT_METADATA[eventType].title,
  };

  return {
    canonicalIdentityKey: identity,
    ...normalized,
    fetchedAt: context.fetchedAt,
    observationFingerprint: checksum(normalized),
    rawChecksum: checksum(rawPayload),
    rawPayload,
    requestFrom: context.requestFrom,
    requestTo: context.requestTo,
    runId: context.runId,
    scheduleConfidence: "tentative",
    sourceAgency: EVENT_METADATA[eventType].sourceAgency,
    sourceEventKey: identity,
    sourceName: "FMP Economic Calendar",
    timeStatus: "exact",
  };
}

function parseRow(raw: Record<string, unknown>): ParsedRow | null {
  const event = stringValue(raw.event);
  const timestamp = stringValue(raw.date);
  if (!event || !timestamp) return null;
  const schedule = fmpUtcToEastern(timestamp);
  if (!schedule) return null;
  return {
    actual: numericValue(raw.actual),
    estimate: numericValue(raw.estimate),
    event,
    ...schedule,
    impact: normalizeImpact(raw.impact),
    previous: numericValue(raw.previous),
    raw,
    unit: stringValue(raw.unit),
  };
}

export function fmpUtcToEastern(value: string) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?(?:Z)?$/,
  );
  if (!match) return null;
  const instant = new Date(`${match[1]}T${match[2]}:00Z`);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const eventDate = `${part("year")}-${part("month")}-${part("day")}`;
  const eventTime = `${part("hour")}:${part("minute")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(eventTime)) return null;
  return {
    eventDate,
    eventInstant: instant.toISOString(),
    eventTime,
  };
}

function policyDetails(
  eventType: FmpEconomicCalendarEventType,
  eventTime: string,
) {
  if (eventType === "fomc-decision") {
    return {
      decisionTime: eventTime,
      includesSep: null,
      pressConferenceTime: null,
      targetRangeLower: null,
      targetRangeUpper: null,
    };
  }
  if (eventType === "fomc-minutes") {
    return {
      documentTitle: "Minutes of the Federal Open Market Committee",
      meetingPeriod: null,
    };
  }
  return {
    amountBillions: null,
    kind: eventType === "treasury-refunding" ? "announcement" : "auction",
    maturity:
      eventType === "treasury-auction-10y"
        ? "10-Year"
        : eventType === "treasury-auction-30y"
          ? "30-Year"
          : null,
    result: null,
  };
}

function policySubcategory(
  eventType: FmpEconomicCalendarEventType,
): PolicySubcategory | null {
  if (eventType === "fomc-decision" || eventType === "fomc-minutes") {
    return "monetary-policy";
  }
  return isPolicyEvent(eventType) ? "treasury" : null;
}

function isPolicyEvent(eventType: FmpEconomicCalendarEventType) {
  return eventType.startsWith("fomc-") || eventType.startsWith("treasury-");
}

function marketSession(eventTime: string) {
  if (eventTime < "09:30") return "bmo" as const;
  if (eventTime <= "16:00") return "market-hours" as const;
  return "amc" as const;
}

function baseEventName(value: string) {
  return value.replace(/\s+\([^()]*(?:\([^()]*\)[^()]*)?\)\s*$/, "").trim();
}

function unitMatches(unit: string | null, definition: MetricDefinition) {
  const normalized = unit?.trim().toUpperCase() ?? "";
  if (definition.unit === "percent") return normalized === "%";
  if (definition.metricKey === "job-openings") return normalized === "M";
  return definition.unit === "thousands" && normalized === "K";
}

function strongestImpact(values: readonly CalendarImpactLevel[]) {
  if (values.includes("high")) return "high" as const;
  if (values.includes("medium")) return "medium" as const;
  return "low" as const;
}

function normalizeImpact(value: unknown): CalendarImpactLevel {
  const text = stringValue(value)?.toLowerCase();
  if (text === "high" || text === "medium" || text === "low") return text;
  return "low";
}

function multiply(value: number | null, multiplier: number) {
  return value === null ? null : value * multiplier;
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function checksum(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
