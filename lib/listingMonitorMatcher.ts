import {
  readCurrentListingRiskFacts,
  type CurrentListingRiskReadResult,
} from "./monitor/listingRiskPersistence.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
} from "./monitor/corporateActionPersistence.ts";
import {
  getReadyMonitorCondition,
  monitorDateOnlyUtcDay,
  validateMonitorConditionInput,
  type MonitorConditionDefinition,
  type MonitorConditionOperator,
} from "./monitor/conditionRegistry.ts";
import {
  unavailableCurrentPrice,
  type CurrentPrice,
} from "./market-data/marketDataProvider.ts";

export const LISTING_MONITOR_MATCHER_VERSION = "listing_monitor_matcher_v1" as const;

export type ListingMonitorMatchStatus = "match" | "no_match" | "ineligible";

export type ListingMonitorMatchReasonCode =
  | "all_conditions_match"
  | "condition_not_met"
  | "reader_not_ready"
  | "reader_not_applicable"
  | "reader_unavailable"
  | "condition_set_empty"
  | "condition_invalid"
  | "condition_key_unknown"
  | "condition_operator_unknown"
  | "condition_value_invalid"
  | "evaluation_date_invalid"
  | "fact_unavailable"
  | "fact_value_invalid"
  | "fact_quality_unknown"
  | "fact_value_ineligible"
  | "market_price_unavailable"
  | "market_price_data_mode_ineligible"
  | "market_price_stale";

export type ListingMonitorCondition = Readonly<{
  key: unknown;
  operator: unknown;
  value: unknown;
}>;

export type ListingMonitorConditionResult = Readonly<{
  key: string;
  status: ListingMonitorMatchStatus;
  reasonCode: ListingMonitorMatchReasonCode;
}>;

export type ListingMonitorMatchResult = Readonly<{
  version: typeof LISTING_MONITOR_MATCHER_VERSION;
  status: ListingMonitorMatchStatus;
  reasonCode: ListingMonitorMatchReasonCode;
  readerReason?: string;
  conditions: readonly ListingMonitorConditionResult[];
}>;

export type ListingMonitorConditionSet = Readonly<{
  id: string;
  conditions: readonly ListingMonitorCondition[];
}>;

export type ListingMonitorEventMatchResult = Readonly<{
  version: typeof LISTING_MONITOR_MATCHER_VERSION;
  eventId: string;
  evaluationDate: string;
  evaluations: readonly Readonly<{ id: string; result: ListingMonitorMatchResult }>[];
}>;

export type ListingMonitorMatcherDependencies = Readonly<{
  readFacts?(eventId: string): Promise<CurrentListingRiskReadResult>;
  readCorporateActionFacts?(eventId: string): Promise<CurrentCorporateActionReadResult>;
  readEventTicker?(eventId: string): Promise<string>;
  readCurrentPrice?(symbol: string): Promise<CurrentPrice>;
  now?(): Date;
}>;

export type MonitorFactReaders = Readonly<{
  listing: CurrentListingRiskReadResult;
  corporateAction: CurrentCorporateActionReadResult;
}>;

const defaultDependencies: ListingMonitorMatcherDependencies = {
  readFacts: readCurrentListingRiskFacts,
  readCorporateActionFacts: readCurrentCorporateActionFacts,
  readEventTicker: readMonitorEventTicker,
  readCurrentPrice: async (symbol) => (
    await import("./market-data/currentPrice.ts")
  ).getCurrentPrice(symbol),
  now: () => new Date(),
};

/** Pure, deterministic AND evaluation over one already-read official result. */
export function evaluateListingMonitorConditions(
  current: CurrentListingRiskReadResult,
  conditions: readonly ListingMonitorCondition[],
  input: Readonly<{
    evaluationDate: string;
    evaluatedAt?: string;
    currentPrice?: CurrentPrice;
  }>,
): ListingMonitorMatchResult {
  return evaluateMonitorConditions({
    listing: current,
    corporateAction: { status: "not_ready", reason: "reader_not_requested" },
  }, conditions, input);
}

/** Pure deterministic AND evaluation over already-read official domain facts. */
export function evaluateMonitorConditions(
  readers: MonitorFactReaders,
  conditions: readonly ListingMonitorCondition[],
  input: Readonly<{
    evaluationDate: string;
    evaluatedAt?: string;
    currentPrice?: CurrentPrice;
  }>,
): ListingMonitorMatchResult {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return result("ineligible", "condition_set_empty", []);
  }

  const evaluationDay = monitorDateOnlyUtcDay(input.evaluationDate);
  if (evaluationDay === null) {
    return result("ineligible", "evaluation_date_invalid", []);
  }
  const evaluatedAt = Date.parse(input.evaluatedAt ?? `${input.evaluationDate}T23:59:59.999Z`);
  if (!Number.isFinite(evaluatedAt)) {
    return result("ineligible", "evaluation_date_invalid", []);
  }

  const evaluated = conditions.map((condition) => evaluateCondition(
    readers,
    condition,
    evaluationDay,
    evaluatedAt,
    input.currentPrice,
  ));
  const firstNoMatch = evaluated.find((item) => item.status === "no_match");
  if (firstNoMatch) return result("no_match", firstNoMatch.reasonCode, evaluated);
  const firstIneligible = evaluated.find((item) => item.status === "ineligible");
  if (firstIneligible) return result("ineligible", firstIneligible.reasonCode, evaluated);
  return result("match", "all_conditions_match", evaluated);
}

/**
 * Event-centric reader boundary: official Listing facts are read exactly once,
 * then any number of condition sets are evaluated without persistence writes.
 */
export async function evaluateListingMonitorEvent(
  input: Readonly<{
    eventId: string;
    evaluationDate: string;
    evaluatedAt?: string;
    conditionSets: readonly ListingMonitorConditionSet[];
  }>,
  dependencies: ListingMonitorMatcherDependencies = defaultDependencies,
): Promise<ListingMonitorEventMatchResult> {
  const conditions = input.conditionSets.flatMap((set) => set.conditions);
  const listingRequested = conditions.some((condition) => conditionUsesReader(
    condition,
    "read_current_event_listing_risk_facts",
  ));
  const corporateActionRequested = conditions.some((condition) => conditionUsesReader(
    condition,
    "read_current_event_corporate_action_facts",
  ));
  const readers: MonitorFactReaders = {
    listing: listingRequested
      ? await safeReadFacts(
          input.eventId,
          dependencies.readFacts ?? defaultDependencies.readFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: corporateActionRequested
      ? await safeReadFacts(
          input.eventId,
          dependencies.readCorporateActionFacts ?? defaultDependencies.readCorporateActionFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
  };
  const evaluatedAt = input.evaluatedAt
    ?? (dependencies.now ?? defaultDependencies.now!)().toISOString();
  const priceRequested = conditions.some(isCurrentPriceCondition);
  let currentPrice: CurrentPrice | undefined;
  if (priceRequested) {
    const symbol = currentListingTicker(readers.listing)
      || await safeReadEventTicker(
        input.eventId,
        dependencies.readEventTicker ?? defaultDependencies.readEventTicker!,
      );
    if (!symbol) {
      currentPrice = unavailableCurrentPrice(symbol);
    } else {
      try {
        currentPrice = await (dependencies.readCurrentPrice
          ?? defaultDependencies.readCurrentPrice!)(symbol);
      } catch {
        currentPrice = unavailableCurrentPrice(symbol);
      }
    }
  }
  return {
    version: LISTING_MONITOR_MATCHER_VERSION,
    eventId: input.eventId,
    evaluationDate: input.evaluationDate,
    evaluations: input.conditionSets.map((set) => ({
      id: set.id,
      result: evaluateMonitorConditions(readers, set.conditions, {
        evaluationDate: input.evaluationDate,
        evaluatedAt,
        ...(currentPrice ? { currentPrice } : {}),
      }),
    })),
  };
}

function evaluateCondition(
  readers: MonitorFactReaders,
  input: ListingMonitorCondition,
  evaluationDay: number,
  evaluatedAt: number,
  currentPrice?: CurrentPrice,
): ListingMonitorConditionResult {
  if (!recordValue(input)) return conditionResult("", "ineligible", "condition_invalid");
  const key = typeof input.key === "string" ? input.key : "";
  const validationError = validateMonitorConditionInput(input)[0];
  if (validationError) return conditionResult(key, "ineligible", validationError);

  const definition = getReadyMonitorCondition(key);
  if (!definition || !definition.monitorDomains?.includes("listing")) {
    return conditionResult(key, "ineligible", "condition_key_unknown");
  }

  const operator = input.operator as MonitorConditionOperator;
  if (definition.source.reader === "get_current_price") {
    return evaluateCurrentPriceCondition(
      definition,
      key,
      operator,
      input.value,
      currentPrice,
      evaluatedAt,
    );
  }
  if (
    (definition.family !== "listing" && definition.family !== "corporate_action")
    || !definition.source.jsonPath
  ) {
    return conditionResult(key, "ineligible", "condition_key_unknown");
  }
  const current = definition.family === "corporate_action"
    ? readers.corporateAction
    : readers.listing;
  if (current.status === "not_ready") {
    const reasonCode = current.reason === "reader_unavailable"
      ? "reader_unavailable"
      : "reader_not_ready";
    return conditionResult(key, "ineligible", reasonCode);
  }
  if (current.status === "not_applicable") {
    return conditionResult(key, "ineligible", "reader_not_applicable");
  }
  const facts = current.facts;
  const eligibilityError = factEligibilityError(facts, definition);
  if (eligibilityError) return conditionResult(key, "ineligible", eligibilityError);

  const actual = valueAtPath(facts, definition.source.jsonPath);
  if (definition.enumValues) {
    if (typeof actual !== "string" || !definition.enumValues.includes(actual)) {
      return conditionResult(key, "ineligible", "fact_value_invalid");
    }
    if (definition.eligibility?.ineligibleValues?.includes(actual)) {
      return conditionResult(key, "ineligible", "fact_value_ineligible");
    }
  }

  const matched = compareCondition(definition, actual, operator, input.value, evaluationDay);
  if (matched === null) return conditionResult(key, "ineligible", "fact_value_invalid");
  return conditionResult(
    key,
    matched ? "match" : "no_match",
    matched ? "all_conditions_match" : "condition_not_met",
  );
}

function evaluateCurrentPriceCondition(
  definition: MonitorConditionDefinition,
  key: string,
  operator: MonitorConditionOperator,
  expected: unknown,
  currentPrice: CurrentPrice | undefined,
  evaluatedAt: number,
): ListingMonitorConditionResult {
  if (!currentPrice || currentPrice.availability !== "available") {
    return conditionResult(key, "ineligible", "market_price_unavailable");
  }
  if (
    definition.eligibility?.requiredDataModes
    && !definition.eligibility.requiredDataModes.includes(currentPrice.dataMode as never)
  ) {
    return conditionResult(key, "ineligible", "market_price_data_mode_ineligible");
  }
  const asOf = Date.parse(currentPrice.asOf);
  const maximumAgeMs = (definition.eligibility?.maximumAgeSeconds ?? 0) * 1_000;
  const ageMs = evaluatedAt - asOf;
  if (!Number.isFinite(asOf) || maximumAgeMs <= 0 || ageMs < -60_000 || ageMs > maximumAgeMs) {
    return conditionResult(key, "ineligible", "market_price_stale");
  }
  const matched = compareCondition(definition, currentPrice.price, operator, expected, 0);
  if (matched === null) return conditionResult(key, "ineligible", "fact_value_invalid");
  return conditionResult(
    key,
    matched ? "match" : "no_match",
    matched ? "all_conditions_match" : "condition_not_met",
  );
}

function factEligibilityError(
  facts: unknown,
  definition: MonitorConditionDefinition,
): ListingMonitorMatchReasonCode | null {
  if (definition.eligibility?.requiredAvailability) {
    const path = definition.source.availabilityJsonPath;
    if (!path || valueAtPath(facts, path) !== definition.eligibility.requiredAvailability) {
      return "fact_unavailable";
    }
  }
  if (definition.eligibility?.requiredValueQualities) {
    const path = definition.source.valueQualityJsonPath;
    const quality = path ? valueAtPath(facts, path) : null;
    if (typeof quality !== "string" || !definition.eligibility.requiredValueQualities.includes(quality as never)) {
      return "fact_quality_unknown";
    }
  }
  return null;
}

function compareCondition(
  definition: MonitorConditionDefinition,
  actual: unknown,
  operator: MonitorConditionOperator,
  expected: unknown,
  evaluationDay: number,
): boolean | null {
  if (definition.valueType === "text") {
    if (typeof actual !== "string" || actual.length === 0) return null;
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
    if (operator === "not_in") return Array.isArray(expected) && !expected.includes(actual);
    return null;
  }
  if (definition.valueType === "boolean") {
    if (typeof actual !== "boolean" || typeof expected !== "boolean") return null;
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    return null;
  }
  if (definition.valueType === "date") {
    const actualDay = monitorDateOnlyUtcDay(actual);
    if (actualDay === null) return null;
    if (operator === "within_days") {
      if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0) return null;
      const daysAhead = actualDay - evaluationDay;
      return daysAhead >= 0 && daysAhead <= expected;
    }
    const expectedDay = monitorDateOnlyUtcDay(expected);
    if (expectedDay === null) return null;
    if (operator === "eq") return actualDay === expectedDay;
    if (operator === "neq") return actualDay !== expectedDay;
    if (operator === "before") return actualDay < expectedDay;
    if (operator === "after") return actualDay > expectedDay;
    return null;
  }
  if (definition.valueType === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return null;
    if (typeof expected !== "number" || !Number.isFinite(expected)) return null;
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    if (operator === "gt") return actual > expected;
    if (operator === "gte") return actual >= expected;
    if (operator === "lt") return actual < expected;
    if (operator === "lte") return actual <= expected;
    return null;
  }
  return null;
}

function isCurrentPriceCondition(condition: ListingMonitorCondition) {
  if (!recordValue(condition) || typeof condition.key !== "string") return false;
  return getReadyMonitorCondition(condition.key)?.source.reader === "get_current_price";
}

function conditionUsesReader(
  condition: ListingMonitorCondition,
  reader: NonNullable<MonitorConditionDefinition["source"]["reader"]>,
) {
  if (!recordValue(condition) || typeof condition.key !== "string") return false;
  return getReadyMonitorCondition(condition.key)?.source.reader === reader;
}

async function safeReadFacts<T>(eventId: string, reader: (eventId: string) => Promise<T>): Promise<T> {
  try {
    return await reader(eventId);
  } catch {
    return { status: "not_ready", reason: "reader_unavailable" } as T;
  }
}

async function safeReadEventTicker(eventId: string, reader: (eventId: string) => Promise<string>) {
  try {
    return normalizeTicker(await reader(eventId));
  } catch {
    return "";
  }
}

export async function readMonitorEventTicker(eventId: string) {
  const repository = await import("./supabase.ts");
  const response = await repository.supabaseSelect("events", {
    select: "ticker",
    id: `eq.${eventId}`,
    limit: "1",
  });
  if (!response.ok) throw new Error(`Monitor event ticker read failed: ${response.error || response.status}`);
  const row = Array.isArray(response.data) && recordValue(response.data[0]) ? response.data[0] : null;
  return normalizeTicker(row?.ticker);
}

export function currentListingTicker(current: CurrentListingRiskReadResult) {
  if (current.status !== "available") return "";
  const ticker = valueAtPath(current.facts, ["affected_security", "ticker", "value"]);
  const availability = valueAtPath(current.facts, ["affected_security", "ticker", "availability"]);
  return availability === "available" && typeof ticker === "string"
    ? ticker.trim().toUpperCase()
    : "";
}

function normalizeTicker(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9][A-Z0-9.-]{0,14}$/i.test(value.trim())
    ? value.trim().toUpperCase()
    : "";
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!recordValue(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function result(
  status: ListingMonitorMatchStatus,
  reasonCode: ListingMonitorMatchReasonCode,
  conditions: readonly ListingMonitorConditionResult[],
  readerReason?: string,
): ListingMonitorMatchResult {
  return {
    version: LISTING_MONITOR_MATCHER_VERSION,
    status,
    reasonCode,
    ...(readerReason ? { readerReason } : {}),
    conditions,
  };
}

function conditionResult(
  key: string,
  status: ListingMonitorMatchStatus,
  reasonCode: ListingMonitorMatchReasonCode,
): ListingMonitorConditionResult {
  return { key, status, reasonCode };
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
