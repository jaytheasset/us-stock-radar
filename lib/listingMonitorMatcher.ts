import { readMonitorCurrentPrice, type MonitorCurrentPriceProjectionReaders } from "./monitor/currentPrice.ts";
import type { NtLifecycleReadResult } from "./monitor/ntLifecycleRuntime.ts";
import type { S8MonitorFacts } from "./monitor/s8StructuredFacts.ts";
import type { TenderMonitorFacts } from "./monitor/tenderStructuredFacts.ts";
import type { ProxyMonitorFacts } from "./monitor/proxyStructuredFacts.ts";
import type { ReadResult as ProjectedFacts } from './projected-offering-dilution/repository.ts';
import { readEventFilingMetadata, type EventFilingMetadata } from "./monitor/eventFilingMetadata.ts";
import { readSecForm25EventIdentity, type Form25IdentityGate } from "./sec-form25-identity/consumption.ts";
import { form25HumanMonitorField } from "./sec-form25-analysis-review/consumer.ts";
import { hasEffect, type EffectCondition } from "./sec-effect/conditions.ts";
import { matchEffect, type EffectFacts } from "./sec-effect/reader.ts";
import {
  readCurrentListingRiskFacts,
  type CurrentListingRiskReadResult,
} from "./monitor/listingRiskPersistence.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
} from "./monitor/corporateActionPersistence.ts";
import {
  readCurrentOwnershipFacts,
  type CurrentOwnershipReadResult,
} from "./monitor/ownershipMonitorPersistence.ts";
import {
  getReadyMonitorCondition,
  monitorDateOnlyUtcDay,
  validateMonitorConditionInput,
  type MonitorConditionDefinition,
  type MonitorConditionOperator,
} from "./monitor/conditionRegistry.ts";
import {
  evaluateForm4InsiderPurchase,
  type Form4InsiderPurchaseSettings,
  type Form4PurchaseEvaluationTrace,
  type Form4PurchaseMatchEvidence,
} from "./monitor/form4InsiderPurchaseMonitor.ts";
import {
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
  | "ownership_form_mismatch"
  | "ownership_reporter_attribution_unavailable"
  | "ownership_row_conjunction_not_met"
  | "ownership_form4_purchase_unavailable"
  | "minimum_shares_not_met"
  | "reporting_owner_role_not_met"
  | "nonpurchase_transaction"
  | "monitor_activation_not_met"
  | "monitor_target_not_met"
  | "monitor_target_unavailable"
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
  form4PurchaseEvidence?: Form4PurchaseMatchEvidence;
  form4PurchaseTrace?: Form4PurchaseEvaluationTrace;
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
  readProjectedFacts?(eventId:string):Promise<ProjectedFacts>;
  readFilingMetadata?(eventId: string): Promise<EventFilingMetadata>;
  readTenderFacts?(eventId: string): Promise<TenderMonitorFacts>;
  readProxyFacts?(eventId: string): Promise<ProxyMonitorFacts>;
  readNtFacts?(eventId: string): Promise<NtLifecycleReadResult>;
  readEventIdentity?(eventId: string): Promise<Form25IdentityGate>;
  readFacts?(eventId: string): Promise<CurrentListingRiskReadResult>;
  readCorporateActionFacts?(eventId: string): Promise<CurrentCorporateActionReadResult>;
  readOwnershipFacts?(eventId: string): Promise<CurrentOwnershipReadResult>;
  readEventTicker?(eventId: string): Promise<string>;
  readCurrentPrice?(symbol: string): Promise<CurrentPrice>;
  currentPriceProjectionReaders?: MonitorCurrentPriceProjectionReaders;
  now?(): Date;
}>;

export type MonitorFactReaders = Readonly<{
  projected?: ProjectedFacts;
  filing?: EventFilingMetadata;
  effect?: EffectFacts;
  tender?: TenderMonitorFacts;
  proxy?: ProxyMonitorFacts;
  s8?: S8MonitorFacts;
  nt?: NtLifecycleReadResult;
  listing: CurrentListingRiskReadResult;
  corporateAction: CurrentCorporateActionReadResult;
  ownership: CurrentOwnershipReadResult;
}>;

const defaultDependencies: ListingMonitorMatcherDependencies = {
  readEventIdentity: readSecForm25EventIdentity,
  readFacts: readCurrentListingRiskFacts,
  readCorporateActionFacts: readCurrentCorporateActionFacts,
  readOwnershipFacts: readCurrentOwnershipFacts,
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
    ownership: { status: "not_ready", reason: "reader_not_requested" },
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
  if (hasEffect(conditions)) {
    const status = matchEffect(readers.effect, conditions as readonly EffectCondition[]);
    const reason = status === "match" ? "all_conditions_match" : status === "no_match" ? "condition_not_met" : "fact_unavailable";
    return result(status, reason, conditions.map(c => conditionResult(String(c.key), status, reason)));
  }
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

  const ownershipEntries = conditions
    .map((condition, index) => ({ condition, index }))
    .filter(({ condition }) => conditionUsesReader(condition, "read_current_event_ownership_facts"));
  const ownershipEvaluation = evaluateOwnershipConditionGroup(
    readers.ownership,
    ownershipEntries,
    evaluationDay,
  );
  const ownershipResults = new Map(ownershipEvaluation.results.map((item) => [item.index, item.result]));
  const evaluated = conditions.map((condition, index) => ownershipResults.get(index) ?? evaluateCondition(
    readers,
    condition,
    evaluationDay,
    evaluatedAt,
    input.currentPrice,
  ));
  const firstNoMatch = evaluated.find((item) => item.status === "no_match");
  if (firstNoMatch || ownershipEvaluation.status === "no_match") {
    return result("no_match", ownershipEvaluation.status === "no_match"
      ? ownershipEvaluation.reasonCode
      : firstNoMatch!.reasonCode, evaluated);
  }
  const firstIneligible = evaluated.find((item) => item.status === "ineligible");
  if (firstIneligible || ownershipEvaluation.status === "ineligible") {
    return result("ineligible", ownershipEvaluation.status === "ineligible"
      ? ownershipEvaluation.reasonCode
      : firstIneligible!.reasonCode, evaluated);
  }
  return result("match", "all_conditions_match", evaluated);
}

export function evaluateForm4InsiderPurchaseMonitor(
  current: CurrentOwnershipReadResult,
  conditions: readonly ListingMonitorCondition[],
  settings: Form4InsiderPurchaseSettings,
  targetStatus: "eligible" | "no_match" | "unavailable",
): ListingMonitorMatchResult {
  const specialized = evaluateForm4InsiderPurchase(current, settings);
  const evaluatedConditions = conditions.map((condition) => conditionResult(
    String(condition.key),
    specialized.status,
    specialized.status === "match" ? "all_conditions_match" : specialized.reasonCode,
  ));
  if (targetStatus === "no_match") return {
    ...result("no_match", "monitor_target_not_met", evaluatedConditions),
    form4PurchaseTrace: specialized.trace,
  };
  if (targetStatus === "unavailable") return {
    ...result("ineligible", "monitor_target_unavailable", evaluatedConditions),
    form4PurchaseTrace: specialized.trace,
  };
  if (specialized.status !== "match") {
    return {
      ...result(specialized.status, specialized.reasonCode, evaluatedConditions),
      form4PurchaseTrace: specialized.trace,
    };
  }
  return {
    ...result("match", "all_conditions_match", evaluatedConditions),
    form4PurchaseEvidence: specialized.evidence,
    form4PurchaseTrace: specialized.trace,
  };
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
  const identity = dependencies.readEventIdentity
    ? await safeReadMonitorEventIdentity(input.eventId, dependencies.readEventIdentity)
    : null;
  if (identity?.status === "blocked") return {
    version: LISTING_MONITOR_MATCHER_VERSION, eventId: input.eventId,
    evaluationDate: input.evaluationDate,
    evaluations: input.conditionSets.map((set) => ({ id: set.id, result: {
      version: LISTING_MONITOR_MATCHER_VERSION, status: "ineligible", reasonCode: "reader_not_ready",
      readerReason: identity.reason, conditions: [],
    } })),
  };
  const conditions = input.conditionSets.flatMap((set) => set.conditions);
  const listingRequested = conditions.some((condition) => conditionUsesReader(
    condition,
    "read_current_event_listing_risk_facts",
  ));
  const corporateActionRequested = conditions.some((condition) => conditionUsesReader(
    condition,
    "read_current_event_corporate_action_facts",
  ));
  const ownershipRequested = conditions.some((condition) => conditionUsesReader(
    condition,
    "read_current_event_ownership_facts",
  ));
  const readers: MonitorFactReaders = {
    projected: conditions.some(c=>conditionUsesReader(c,'read_projected_offering_dilution'))
      ? await safeReadFacts(input.eventId,dependencies.readProjectedFacts??(await import('./projected-offering-dilution/repository.ts')).readProjectedFacts)
      : {status:'not_ready',reason:'reader_not_requested'},
    filing: conditions.some(condition => conditionUsesReader(condition, "read_event_filing_metadata"))
      ? await safeReadFacts(input.eventId, dependencies.readFilingMetadata ?? readEventFilingMetadata)
      : { status: "not_ready", reason: "reader_not_requested" },
    tender: conditions.some(condition => conditionUsesReader(condition, "read_current_tender_structured"))
      ? await safeReadFacts(input.eventId, dependencies.readTenderFacts ?? (await import("./monitor/tenderStructuredFacts.ts")).readCurrentTenderFacts)
      : { status: "not_ready", reason: "reader_not_requested" },
    proxy: conditions.some(condition => conditionUsesReader(condition, "read_current_proxy_structured"))
      ? await safeReadFacts(input.eventId, dependencies.readProxyFacts ?? (await import("./monitor/proxyStructuredFacts.ts")).readCurrentProxyFacts)
      : { status: "not_ready", reason: "reader_not_requested" },
    nt: conditions.some(condition => conditionUsesReader(condition, "read_current_event_nt_lifecycle"))
      ? await safeReadFacts(input.eventId, dependencies.readNtFacts ?? (await import("./monitor/ntLifecycleRuntime.ts")).readCurrentNtLifecycle)
      : { status: "not_ready", reason: "reader_not_requested" },
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
    ownership: ownershipRequested
      ? await safeReadFacts(
          input.eventId,
          dependencies.readOwnershipFacts ?? defaultDependencies.readOwnershipFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
  };
  const evaluatedAt = input.evaluatedAt
    ?? (dependencies.now ?? defaultDependencies.now!)().toISOString();
  const priceRequested = conditions.some(isCurrentPriceCondition);
  let currentPrice: CurrentPrice | undefined;
  if (priceRequested) {
    const symbol = identity?.ticker || currentListingTicker(readers.listing)
      || currentOwnershipTicker(readers.ownership)
      || await safeReadEventTicker(
        input.eventId,
        dependencies.readEventTicker ?? defaultDependencies.readEventTicker!,
      );
    currentPrice = await readMonitorCurrentPrice({
      eventId: input.eventId, historicalTicker: symbol, ownership: readers.ownership,
    }, {
      readCurrentPrice: dependencies.readCurrentPrice ?? defaultDependencies.readCurrentPrice!,
      projectionReaders: dependencies.currentPriceProjectionReaders,
    });
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

export async function safeReadMonitorEventIdentity(
  eventId: string, reader: (eventId: string) => Promise<Form25IdentityGate>,
): Promise<Form25IdentityGate> {
  try { return await reader(eventId); } catch {
    return { status: "blocked", ticker: null, exchange: null, reason: "form25_identity_reader_unavailable" };
  }
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
  // S-8 is explicitly supplied for isolated fact evaluation only. Event/alert consumers do not load it.
  if (!definition || (!definition.monitorDomains?.includes("listing") && !(definition.family === "s8" && readers.s8))) {
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
    (definition.source.reader !== "read_event_filing_metadata" && definition.family !== "projected" && definition.family !== "listing" && definition.family !== "corporate_action" && definition.family !== "nt" && definition.family !== "s8" && definition.family !== "proxy" && definition.family !== "tender")
    || !definition.source.jsonPath
  ) {
    return conditionResult(key, "ineligible", "condition_key_unknown");
  }
  const current = definition.source.reader === "read_event_filing_metadata"
    ? readers.filing ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "projected"
    ? readers.projected ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "tender"
    ? readers.tender ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "proxy"
    ? readers.proxy ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "s8"
    ? readers.s8 ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "nt"
    ? readers.nt ?? { status: "not_ready" as const, reason: "reader_not_requested" }
    : definition.family === "corporate_action"
    ? readers.corporateAction
    : readers.listing;
  const humanField = definition.family === "listing"
    ? form25HumanMonitorField(readers.listing.form25HumanReview, key) : null;
  if (humanField) {
    if (humanField.availability !== "available" || humanField.value === null) {
      return conditionResult(key, "ineligible", "fact_unavailable");
    }
    if (definition.enumValues && !definition.enumValues.includes(humanField.value)) {
      return conditionResult(key, "ineligible", "fact_value_invalid");
    }
    if (definition.eligibility?.ineligibleValues?.includes(humanField.value)) {
      return conditionResult(key, "ineligible", "fact_value_ineligible");
    }
    const matched = compareCondition(definition, humanField.value, operator, input.value, evaluationDay);
    return conditionResult(key, matched === null ? "ineligible" : matched ? "match" : "no_match",
      matched === null ? "fact_value_invalid" : matched ? "all_conditions_match" : "condition_not_met");
  }
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
  if (definition.family === 'projected') {
    const f=facts as unknown as {ineligible_numeric_fields?:string[];calculation_status?:string};
    const field=key.slice('projected.'.length);
    if(f.ineligible_numeric_fields?.includes(field)
      ||(!f.ineligible_numeric_fields&&f.calculation_status==='CONFLICT'&&field.startsWith('projected_increase_percent_')))
      return conditionResult(key,'ineligible','fact_unavailable');
  }
  if ((definition.family === "projected" || definition.family === "nt" || definition.family === "tender") && valueAtPath(facts, definition.source.jsonPath) === null) {
    return conditionResult(key, "ineligible", "fact_unavailable");
  }
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

function evaluateOwnershipConditionGroup(
  current: CurrentOwnershipReadResult,
  entries: readonly Readonly<{ condition: ListingMonitorCondition; index: number }>[],
  evaluationDay: number,
): Readonly<{
  status: ListingMonitorMatchStatus | null;
  reasonCode: ListingMonitorMatchReasonCode;
  results: readonly Readonly<{ index: number; result: ListingMonitorConditionResult }>[];
}> {
  if (entries.length === 0) {
    return { status: null, reasonCode: "all_conditions_match", results: [] };
  }
  const validationFailures = entries
    .map((entry) => ({
      entry,
      reasonCode: recordValue(entry.condition)
        ? validateMonitorConditionInput(entry.condition)[0]
        : "condition_invalid",
    }))
    .filter((item) => item.reasonCode);
  if (validationFailures.length > 0) {
    const invalidIndexes = new Set(validationFailures.map(({ entry }) => entry.index));
    const validEntries = entries.filter((entry) => !invalidIndexes.has(entry.index));
    const validEvaluation = evaluateOwnershipConditionGroup(current, validEntries, evaluationDay);
    const validResults = new Map(validEvaluation.results.map((item) => [item.index, item.result]));
    const invalidResults = new Map(validationFailures.map(({ entry, reasonCode }) => [
      entry.index,
      conditionResult(String(entry.condition.key ?? ""), "ineligible", reasonCode!),
    ]));
    return {
      status: validEvaluation.status === "no_match" ? "no_match" : "ineligible",
      reasonCode: validEvaluation.status === "no_match"
        ? validEvaluation.reasonCode
        : validationFailures[0].reasonCode!,
      results: entries.map((entry) => ({
        index: entry.index,
        result: invalidResults.get(entry.index) ?? validResults.get(entry.index)!,
      })),
    };
  }
  const definitions = entries.map(({ condition }) => (
    recordValue(condition) && typeof condition.key === "string"
      ? getReadyMonitorCondition(condition.key)
      : null
  ));
  const invalidIndex = definitions.findIndex((definition) => (
    !definition || definition.family !== "ownership"
      || definition.source.reader !== "read_current_event_ownership_facts"
  ));
  if (invalidIndex >= 0) {
    return ownershipGroupTerminal(entries, "ineligible", "condition_key_unknown");
  }
  if (current.status === "not_ready") {
    const reasonCode = current.reason === "reader_unavailable" ? "reader_unavailable" : "reader_not_ready";
    return ownershipGroupTerminal(entries, "ineligible", reasonCode);
  }
  if (current.status === "not_applicable") {
    return ownershipGroupTerminal(entries, "ineligible", "reader_not_applicable");
  }
  const requiredForms = new Set(definitions.map((definition) => definition!.domain));
  if (requiredForms.size !== 1 || !requiredForms.has(current.form)) {
    return ownershipGroupTerminal(entries, "ineligible", "ownership_form_mismatch");
  }

  const ownerConditionCount = definitions.filter((definition) => definition!.source.ownerScoped === true).length;
  const hasOwnerCondition = ownerConditionCount > 0;
  const hasTransactionCondition = definitions.some((definition) => definition!.source.ownerScoped !== true);
  const reporterAttributionRequired = current.form === "form4"
    && hasOwnerCondition
    && (hasTransactionCondition || ownerConditionCount > 1);
  const rowEvaluations = current.rows.map((row) => entries.map(({ condition }, conditionIndex) => {
    const definition = definitions[conditionIndex]!;
    if (
      reporterAttributionRequired
      && recordValue(row.provenance)
      && row.provenance.reporting_owner_scope === "filing_level_unattributed_owner_set"
    ) {
      return conditionResult(String(condition.key), "ineligible", "ownership_reporter_attribution_unavailable");
    }
    return evaluateOwnershipRowCondition(row, definition, condition, evaluationDay);
  }));
  const matchingRow = rowEvaluations.find((row) => row.every((item) => item.status === "match"));
  if (matchingRow) {
    return {
      status: "match",
      reasonCode: "all_conditions_match",
      results: entries.map((entry) => ({
        index: entry.index,
        result: conditionResult(String(entry.condition.key), "match", "all_conditions_match"),
      })),
    };
  }

  const conditionResults = entries.map((entry, conditionIndex) => {
    const perRow = rowEvaluations.map((row) => row[conditionIndex]);
    if (perRow.some((item) => item.status === "match")) {
      return { index: entry.index, result: conditionResult(String(entry.condition.key), "match", "all_conditions_match") };
    }
    const ineligible = perRow.find((item) => item.status === "ineligible");
    return {
      index: entry.index,
      result: ineligible ?? conditionResult(String(entry.condition.key), "no_match", "condition_not_met"),
    };
  });
  const everyRowDefinitelyNoMatch = rowEvaluations.every((row) => row.some((item) => item.status === "no_match"));
  if (everyRowDefinitelyNoMatch) {
    return {
      status: "no_match",
      reasonCode: entries.length > 1 ? "ownership_row_conjunction_not_met" : "condition_not_met",
      results: conditionResults,
    };
  }
  const firstIneligible = rowEvaluations.flat().find((item) => item.status === "ineligible");
  return {
    status: "ineligible",
    reasonCode: firstIneligible?.reasonCode ?? "fact_unavailable",
    results: conditionResults,
  };
}

function evaluateOwnershipRowCondition(
  row: Readonly<Record<string, unknown>>,
  definition: MonitorConditionDefinition,
  input: ListingMonitorCondition,
  evaluationDay: number,
) {
  const key = String(input.key);
  if (definition.eligibility?.requiredAvailability) {
    const availabilityColumn = definition.source.availabilityColumn;
    if (!availabilityColumn || row[availabilityColumn] !== definition.eligibility.requiredAvailability) {
      return conditionResult(key, "ineligible", "fact_unavailable");
    }
  }
  if (definition.eligibility?.requiredValueQualities) {
    const qualityColumn = definition.source.valueQualityColumn;
    const quality = qualityColumn ? row[qualityColumn] : null;
    if (typeof quality !== "string" || !definition.eligibility.requiredValueQualities.includes(quality as never)) {
      return conditionResult(key, "ineligible", "fact_quality_unknown");
    }
  }
  const actual = definition.source.column ? row[definition.source.column] : undefined;
  if (definition.enumValues) {
    if (typeof actual !== "string" || !definition.enumValues.includes(actual)) {
      return conditionResult(key, "ineligible", "fact_value_invalid");
    }
  }
  const operator = input.operator as MonitorConditionOperator;
  const matched = Array.isArray(actual) && definition.valueType === "text"
    ? compareTextSet(actual, operator, input.value)
    : compareCondition(definition, actual, operator, input.value, evaluationDay);
  if (matched === null) return conditionResult(key, "ineligible", "fact_value_invalid");
  return conditionResult(key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met");
}

function compareTextSet(
  actual: readonly unknown[],
  operator: MonitorConditionOperator,
  expected: unknown,
): boolean | null {
  if (!actual.every((value) => typeof value === "string" && value.length > 0)) return null;
  if (operator === "eq") return typeof expected === "string" ? actual.includes(expected) : null;
  if (operator === "neq") return typeof expected === "string" ? !actual.includes(expected) : null;
  if (operator === "in") return Array.isArray(expected) && expected.every((value) => typeof value === "string")
    ? expected.some((value) => actual.includes(value))
    : null;
  if (operator === "not_in") return Array.isArray(expected) && expected.every((value) => typeof value === "string")
    ? expected.every((value) => !actual.includes(value))
    : null;
  return null;
}

function ownershipGroupTerminal(
  entries: readonly Readonly<{ condition: ListingMonitorCondition; index: number }>[],
  status: "no_match" | "ineligible",
  reasonCode: ListingMonitorMatchReasonCode,
) {
  return {
    status,
    reasonCode,
    results: entries.map((entry) => ({
      index: entry.index,
      result: conditionResult(String(entry.condition.key ?? ""), status, reasonCode),
    })),
  };
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

export function currentOwnershipTicker(current: CurrentOwnershipReadResult) {
  if (current.status !== "available") return "";
  const symbols = new Set(current.rows.map((row) => normalizeTicker(row.symbol)).filter(Boolean));
  return symbols.size === 1 ? [...symbols][0] : "";
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
