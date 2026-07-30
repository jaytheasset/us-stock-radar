import { createHash } from "node:crypto";
import { parseDateOnly } from "./dateUtils.ts";
import {
  buildDividendIdentity,
  buildEarningsIdentity,
  buildIpoIdentity,
  buildSplitIdentity,
  normalizeFmpCalendarExchange,
  normalizeFmpCalendarTicker,
  normalizeSplitRatio,
  validateRelatedDate,
} from "./fmpCalendarIdentity.ts";
import type {
  FmpCalendarAdapterOutcome,
  FmpCalendarObservation,
  FmpCompanyCalendarEventType,
  FmpTickerUniverseEntry,
} from "./fmpCalendarTypes.ts";

type AdapterContext = {
  fetchedAt: string;
  requestDate: string;
  runId: string;
  universe: ReadonlyMap<string, FmpTickerUniverseEntry>;
};

export function adaptFmpCalendarRow(
  eventType: FmpCompanyCalendarEventType,
  value: unknown,
  context: AdapterContext,
): FmpCalendarAdapterOutcome {
  const raw = recordValue(value);
  if (!raw) return rejected("row_not_object");

  const eventDate = dateValue(raw.date);
  if (!eventDate) return rejected("invalid_event_date");
  if (eventDate !== context.requestDate) {
    return rejected("event_date_outside_requested_day");
  }

  if (eventType === "earnings") return adaptEarnings(raw, eventDate, context);
  if (eventType === "dividend") return adaptDividend(raw, eventDate, context);
  if (eventType === "split") return adaptSplit(raw, eventDate, context);
  return adaptIpo(raw, eventDate, context);
}

function adaptEarnings(
  raw: Record<string, unknown>,
  eventDate: string,
  context: AdapterContext,
): FmpCalendarAdapterOutcome {
  const symbol = normalizeFmpCalendarTicker(raw.symbol);
  if (!symbol) return rejected("earnings_symbol_invalid");
  const company = context.universe.get(symbol);
  if (!company) return filtered("ticker_outside_allowed_universe");

  const identity = buildEarningsIdentity(symbol, eventDate);
  const epsActual = numericValue(raw.epsActual);
  const epsEstimated = numericValue(raw.epsEstimated);
  const revenueActual = numericValue(raw.revenueActual);
  const revenueEstimated = numericValue(raw.revenueEstimated);
  const released = epsActual !== null || revenueActual !== null;
  const details = {
    actualEps: epsActual,
    actualRevenue: revenueActual,
    epsEstimate: epsEstimated,
    fiscalQuarter: calendarQuarterLabel(eventDate),
    outcome: earningsOutcome(epsActual, epsEstimated),
    revenueEstimate: revenueEstimated,
  };

  return accepted(
    {
      canonicalIdentityKey: identity,
      companyName: company.name,
      details,
      eventDate,
      eventType: "earnings",
      impactLevel: "high",
      lifecycleStatus: released ? "released" : "scheduled",
      rawPayload: raw,
      requestDate: context.requestDate,
      runId: context.runId,
      scheduleConfidence: "tentative",
      sourceModifiedAt: instantValue(raw.lastUpdated),
      ticker: symbol,
      title: `${company.name} Earnings`,
    },
    "listed",
    context,
  );
}

function adaptDividend(
  raw: Record<string, unknown>,
  eventDate: string,
  context: AdapterContext,
): FmpCalendarAdapterOutcome {
  const warnings: string[] = [];
  const symbol = normalizeFmpCalendarTicker(raw.symbol);
  if (!symbol) return rejected("dividend_symbol_invalid");
  const company = context.universe.get(symbol);
  if (!company) return filtered("ticker_outside_allowed_universe");

  const declarationDate = validatedAuxiliaryDate(
    raw.declarationDate,
    eventDate,
    { minDays: -730, maxDays: 31 },
    "dividend_declaration_date_invalid",
    warnings,
  );
  const recordDate = validatedAuxiliaryDate(
    raw.recordDate,
    eventDate,
    { minDays: -31, maxDays: 90 },
    "dividend_record_date_invalid",
    warnings,
  );
  const paymentDate = validatedAuxiliaryDate(
    raw.paymentDate,
    eventDate,
    { minDays: -31, maxDays: 366 },
    "dividend_payment_date_invalid",
    warnings,
  );
  const amount =
    positiveNumber(raw.adjDividend) ?? positiveNumber(raw.dividend);
  const frequency = dividendFrequency(raw.frequency);
  if (amount === null || !frequency) {
    return quarantined("dividend_identity_inputs_missing", warnings);
  }
  const occurrenceDate = declarationDate ?? recordDate;
  const occurrenceKind = declarationDate ? "declaration" : "record";
  if (!occurrenceDate) {
    return quarantined("dividend_occurrence_unverified", warnings);
  }
  const identity = buildDividendIdentity({
    amount,
    frequency,
    occurrenceDate,
    occurrenceKind,
    symbol,
  });
  if (!identity) return quarantined("dividend_identity_unavailable", warnings);

  return accepted(
    {
      canonicalIdentityKey: identity,
      companyName: company.name,
      details: {
        currency: "USD",
        dividendPerShare: amount,
        exDividendDate: eventDate,
        frequency,
        paymentDate,
        recordDate,
      },
      eventDate,
      eventType: "dividend",
      impactLevel: "medium",
      lifecycleStatus: "scheduled",
      rawPayload: raw,
      requestDate: context.requestDate,
      runId: context.runId,
      scheduleConfidence: "tentative",
      sourceModifiedAt: null,
      ticker: symbol,
      title: `${company.name} Dividend`,
    },
    "listed",
    context,
    warnings,
  );
}

function adaptSplit(
  raw: Record<string, unknown>,
  eventDate: string,
  context: AdapterContext,
): FmpCalendarAdapterOutcome {
  const warnings: string[] = [];
  const symbol = normalizeFmpCalendarTicker(raw.symbol);
  if (!symbol) return rejected("split_symbol_invalid");
  const company = context.universe.get(symbol);
  if (!company) return filtered("ticker_outside_allowed_universe");

  const numerator = integerValue(raw.numerator);
  const denominator = integerValue(raw.denominator);
  if (numerator === null || denominator === null) {
    return quarantined("split_ratio_invalid");
  }
  const ratio = normalizeSplitRatio(numerator, denominator);
  if (!ratio) return quarantined("split_ratio_invalid");
  const providerKind = normalizeSplitKind(raw.splitType);
  if (providerKind && providerKind !== ratio.kind) {
    warnings.push("split_type_conflicts_with_ratio");
  }
  const identity = buildSplitIdentity({
    denominator,
    eventDate,
    numerator,
    symbol,
  });
  if (!identity) return quarantined("split_identity_unavailable", warnings);

  return accepted(
    {
      canonicalIdentityKey: identity,
      companyName: company.name,
      details: {
        effectiveDate: eventDate,
        ratio: ratio.ratio,
        relatedTicker: null,
        splitKind: ratio.kind,
      },
      eventDate,
      eventType: "split",
      impactLevel: "medium",
      lifecycleStatus: "scheduled",
      rawPayload: raw,
      requestDate: context.requestDate,
      runId: context.runId,
      scheduleConfidence: "tentative",
      sourceModifiedAt: null,
      ticker: symbol,
      title: `${company.name} ${ratio.kind === "forward" ? "Stock Split" : "Reverse Stock Split"}`,
    },
    "listed",
    context,
    warnings,
  );
}

function adaptIpo(
  raw: Record<string, unknown>,
  eventDate: string,
  context: AdapterContext,
): FmpCalendarAdapterOutcome {
  const companyName = nonPlaceholderText(raw.company);
  const exchange = normalizeFmpCalendarExchange(raw.exchange);
  const providerSymbol = normalizeFmpCalendarTicker(raw.symbol);
  if (!companyName) return quarantined("ipo_company_missing");
  if (!exchange) return quarantined("ipo_exchange_not_supported");

  const listed = providerSymbol
    ? context.universe.get(providerSymbol) ?? null
    : null;
  const identity = buildIpoIdentity({
    company: companyName,
    exchange,
    symbol: providerSymbol,
  });
  if (!identity) return quarantined("ipo_identity_unavailable");
  const priceRange = parseIpoPriceRange(raw.priceRange);
  const actionText = stringValue(raw.actions)?.toLowerCase() ?? "";
  const offerPrice = actionText.includes("priced")
    ? priceRange?.low ?? null
    : null;

  return accepted(
    {
      canonicalIdentityKey: identity,
      companyName: listed?.name ?? companyName,
      details: {
        exchange,
        ipoStage: actionText.includes("priced") ? "priced" : "date-estimated",
        offerPrice,
        priceRangeHigh: priceRange?.high ?? null,
        priceRangeLow: priceRange?.low ?? null,
        raiseAmount: numericValue(raw.marketCap),
      },
      eventDate,
      eventType: "ipo",
      impactLevel: "medium",
      lifecycleStatus: "scheduled",
      rawPayload: raw,
      requestDate: context.requestDate,
      runId: context.runId,
      scheduleConfidence: "tentative",
      sourceModifiedAt: null,
      ticker: listed ? listed.symbol : null,
      title: `${listed?.name ?? companyName} IPO`,
    },
    listed ? "listed" : "ipo-candidate",
    context,
    providerSymbol && !listed
      ? ["ipo_symbol_not_in_current_ticker_universe"]
      : [],
  );
}

function accepted(
  input: Omit<
    FmpCalendarObservation,
    "fetchedAt" | "observationFingerprint" | "rawChecksum" | "sourceEventKey"
  >,
  universeClass: "listed" | "ipo-candidate",
  context: AdapterContext,
  warnings: string[] = [],
): FmpCalendarAdapterOutcome {
  const rawChecksum = checksum(input.rawPayload);
  const normalized = {
    companyName: input.companyName,
    details: input.details,
    eventDate: input.eventDate,
    eventType: input.eventType,
    impactLevel: input.impactLevel,
    lifecycleStatus: input.lifecycleStatus,
    scheduleConfidence: input.scheduleConfidence,
    ticker: input.ticker,
    title: input.title,
  };
  return {
    kind: "accepted",
    observation: {
      ...input,
      fetchedAt: context.fetchedAt,
      observationFingerprint: checksum(normalized),
      rawChecksum,
      sourceEventKey: input.canonicalIdentityKey,
    },
    universeClass,
    warnings,
  };
}

function rejected(
  reason: string,
  warnings: string[] = [],
): FmpCalendarAdapterOutcome {
  return { kind: "rejected", reason, warnings };
}

function filtered(
  reason: string,
  warnings: string[] = [],
): FmpCalendarAdapterOutcome {
  return { kind: "filtered", reason, warnings };
}

function quarantined(
  reason: string,
  warnings: string[] = [],
): FmpCalendarAdapterOutcome {
  return { kind: "quarantined", reason, warnings };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonPlaceholderText(value: unknown) {
  const text = stringValue(value);
  return text && !["-", "N/A", "NA", "TBA", "TBD"].includes(text.toUpperCase())
    ? text
    : null;
}

function dividendFrequency(value: unknown) {
  const text = stringValue(value);
  if (text) return text;
  if (value === 1) return "Annual";
  if (value === 2) return "Semi-annual";
  if (value === 4) return "Quarterly";
  if (value === 12) return "Monthly";
  return null;
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveNumber(value: unknown) {
  const parsed = numericValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function integerValue(value: unknown) {
  const parsed = numericValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function dateValue(value: unknown) {
  const date = stringValue(value);
  if (!date) return null;
  try {
    parseDateOnly(date);
    return date;
  } catch {
    return null;
  }
}

function instantValue(value: unknown) {
  const text = stringValue(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function validatedAuxiliaryDate(
  value: unknown,
  eventDate: string,
  bounds: { maxDays: number; minDays: number },
  warning: string,
  warnings: string[],
) {
  const result = validateRelatedDate(value, eventDate, bounds);
  if (value !== null && value !== undefined && stringValue(value) && !result) {
    warnings.push(warning);
  }
  return result;
}

function normalizeSplitKind(value: unknown) {
  const text = stringValue(value)?.toLowerCase() ?? "";
  if (text.includes("reverse")) return "reverse";
  if (text.includes("forward")) return "forward";
  return null;
}

function parseIpoPriceRange(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const numbers = text
    .replaceAll(",", "")
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter((number) => Number.isFinite(number));
  if (!numbers?.length) return null;
  const low = numbers[0];
  const high = numbers[1] ?? low;
  if (low <= 0 || high < low) return null;
  return { high, low };
}

function earningsOutcome(actual: number | null, estimate: number | null) {
  if (actual === null || estimate === null) return null;
  if (actual > estimate) return "beat" as const;
  if (actual < estimate) return "miss" as const;
  return "in-line" as const;
}

function calendarQuarterLabel(eventDate: string) {
  const date = parseDateOnly(eventDate);
  return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`;
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
