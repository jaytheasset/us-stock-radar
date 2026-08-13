import {
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
} from "./listingRiskFacts.ts";

export const MONITOR_CONDITION_REGISTRY_VERSION = "monitor_conditions_v1";

export type MonitorConditionValueType = "number" | "text" | "boolean" | "date" | "timestamp";
export type MonitorConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "before"
  | "after";
export type MonitorConditionQuality = "exact" | "derived" | "estimated" | "unknown";

// Storage can retain an available numeric observation with unknown quality for
// provenance. A future matcher must intersect an entry's qualityCapability
// with this list and must also require availability = "available".
export const MONITOR_COMPARISON_ELIGIBLE_QUALITIES = Object.freeze([
  "exact",
  "derived",
  "estimated",
] as const);

type MonitorFactTable =
  | "events"
  | "event_market_snapshots"
  | "event_offering_monitor_canonical"
  | "event_offering_terms"
  | "event_listing_risk_facts"
  | "event_form4_transactions"
  | "event_form144_proposed_sales";

export type MonitorConditionDefinition = Readonly<{
  key: string;
  valueType: MonitorConditionValueType;
  allowedOperators: readonly MonitorConditionOperator[];
  enumValues?: readonly string[];
  family: "event" | "market" | "offering" | "listing" | "ownership";
  domain: string;
  source: Readonly<{
    table: MonitorFactTable;
    column: string;
    subject: "event" | "ticker";
    reader?: "read_event_offering_monitor_canonical" | "read_current_event_listing_risk_facts";
    jsonPath?: readonly string[];
    valueQualityColumn?: string;
    availabilityColumn?: string;
    valueQualityJsonPath?: readonly string[];
    availabilityJsonPath?: readonly string[];
  }>;
  qualityCapability: readonly MonitorConditionQuality[];
  eligibility?: Readonly<{
    requiredReaderStatus: "available";
    requiredAvailability?: "available";
    requiredValueQualities?: readonly MonitorConditionQuality[];
    ineligibleValues?: readonly string[];
  }>;
  status: "READY" | "PARTIAL";
}>;

export type MonitorConditionInputValidationError =
  | "condition_invalid"
  | "condition_key_unknown"
  | "condition_operator_unknown"
  | "condition_value_invalid";

const equality = ["eq", "neq"] as const;
const textOperators = ["eq", "neq", "in", "not_in"] as const;
const numericOperators = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const temporalOperators = ["eq", "neq", "before", "after"] as const;
const enumOperators = ["eq", "in"] as const;

const registry = [
  condition("event.event_type", "text", textOperators, "event", "classification", "events", "event_type", "event", ["exact"]),
  condition("event.score", "number", numericOperators, "event", "classification", "events", "score", "event", ["exact"]),
  condition("event.delivery_level", "text", textOperators, "event", "classification", "events", "delivery_level", "event", ["exact"]),
  condition("event.impact", "text", textOperators, "event", "classification", "events", "impact", "event", ["exact", "unknown"]),
  condition("event.signal", "text", textOperators, "event", "classification", "events", "signal", "event", ["exact", "unknown"]),
  condition("event.source_group", "text", textOperators, "event", "source", "events", "source_group", "event", ["exact"]),
  condition("event.source_code", "text", textOperators, "event", "source", "events", "source_code", "event", ["exact"]),
  condition("event.ticker", "text", textOperators, "event", "subject", "events", "ticker", "ticker", ["exact", "unknown"]),
  condition("event.market_scope", "text", textOperators, "event", "subject", "events", "market_scope", "event", ["exact"]),
  condition("event.sector", "text", textOperators, "event", "subject", "events", "sector", "event", ["exact", "unknown"]),
  condition("event.industry_group", "text", textOperators, "event", "subject", "events", "industry_group", "event", ["exact", "unknown"]),
  condition("event.theme_group", "text", textOperators, "event", "subject", "events", "theme_group", "event", ["exact", "unknown"]),
  condition("event.sub_theme", "text", textOperators, "event", "subject", "events", "sub_theme", "event", ["exact", "unknown"]),
  condition("event.published_at", "timestamp", temporalOperators, "event", "time", "events", "published_at", "event", ["exact", "unknown"]),
  condition("event.detected_at", "timestamp", temporalOperators, "event", "time", "events", "detected_at", "event", ["exact"]),

  condition("market.price_at_event", "number", numericOperators, "market", "event_time", "event_market_snapshots", "price", "ticker", ["exact", "derived", "estimated", "unknown"], {
    valueQualityColumn: "price_value_quality",
    availabilityColumn: "price_availability",
  }),
  condition("market.market_cap_at_event", "number", numericOperators, "market", "event_time", "event_market_snapshots", "market_cap", "ticker", ["exact", "derived", "estimated", "unknown"], {
    valueQualityColumn: "market_cap_value_quality",
    availabilityColumn: "market_cap_availability",
  }),

  canonicalOfferingCondition("offering.side", "text", enumOperators, "classification", "validated_canonical_payload", ["primary_or_resale"], ["primary", "resale", "mixed"]),
  canonicalOfferingCondition("offering.amount", "number", numericOperators, "capital_raising", "validated_canonical_payload", ["facts", "actual_primary_offering_amount"]),
  canonicalOfferingCondition("offering.offering_price", "number", numericOperators, "capital_raising", "validated_canonical_payload", ["facts", "offering_price"]),
  canonicalOfferingCondition("offering.immediate_primary_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "immediate_primary_share_exposure"]),
  canonicalOfferingCondition("offering.additional_potential_primary_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "additional_potential_primary_share_exposure"]),
  canonicalOfferingCondition("offering.resale_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "resale_share_exposure"]),
  canonicalOfferingCondition("offering.total_potential_share_exposure", "number", numericOperators, "dilution", "materialized_payload", ["total_potential_primary_share_exposure"]),

  canonicalListingCondition("listing.event_kind", "text", enumOperators, "classification", ["classification", "event_kind"], {
    enumValues: LISTING_EVENT_KINDS,
  }),
  canonicalListingCondition("listing.event_outcome", "text", enumOperators, "classification", ["classification", "event_outcome"], {
    enumValues: LISTING_EVENT_OUTCOMES,
    ineligibleValues: ["unknown"],
  }),
  canonicalListingCondition("listing.exchange", "text", textOperators, "venue", ["exchange", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.compliance_deadline", "date", temporalOperators, "dates", ["dates", "compliance_deadline", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.hearing_date", "date", temporalOperators, "dates", ["dates", "hearing_date", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.appeal_deadline", "date", temporalOperators, "dates", ["dates", "appeal_deadline", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.suspension_date", "date", temporalOperators, "dates", ["dates", "trading_suspension_date", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.removal_effective_date", "date", temporalOperators, "dates", ["dates", "removal_effective_date", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.continued_trading", "boolean", equality, "trading", ["continued_trading", "continues", "value"], {
    factEnvelope: true,
  }),
  canonicalListingCondition("listing.proceeding_kind", "text", enumOperators, "proceeding", ["proceeding", "kind"], {
    enumValues: LISTING_PROCEEDING_KINDS,
    ineligibleValues: ["unknown"],
  }),
  canonicalListingCondition("listing.proceeding_status", "text", enumOperators, "proceeding", ["proceeding", "status"], {
    enumValues: LISTING_PROCEEDING_STATUSES,
    ineligibleValues: ["unknown"],
  }),

  condition("ownership.form4.direction", "text", equality, "ownership", "form4", "event_form4_transactions", "economic_direction", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.transaction_value", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "transaction_value", "ticker", ["derived", "unknown"], {
    valueQualityColumn: "transaction_value_value_quality",
    availabilityColumn: "transaction_value_availability",
  }),
  condition("ownership.form4.reporting_owner_role", "text", textOperators, "ownership", "form4", "event_form4_transactions", "reporting_owner_roles", "ticker", ["exact", "unknown"]),
  partialCondition(condition("ownership.form4.is_officer", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_officer", "ticker", ["exact", "unknown"])),
  partialCondition(condition("ownership.form4.is_director", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_director", "ticker", ["exact", "unknown"])),
  partialCondition(condition("ownership.form4.officer_title", "text", textOperators, "ownership", "form4", "event_form4_transactions", "officer_title", "ticker", ["exact", "unknown"])),
  condition("ownership.form4.is_10_percent_owner", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_10_percent_owner", "ticker", ["exact", "unknown"]),
  partialCondition(condition("ownership.form4.is_10b5_1", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_10b5_1", "ticker", ["exact", "unknown"])),
  condition("ownership.form144.proposed_sale_value", "number", numericOperators, "ownership", "form144", "event_form144_proposed_sales", "aggregate_market_value", "ticker", ["exact", "unknown"], {
    valueQualityColumn: "aggregate_market_value_value_quality",
    availabilityColumn: "aggregate_market_value_availability",
  }),
] satisfies readonly MonitorConditionDefinition[];

validateRegistry(registry);

export const MONITOR_CONDITION_REGISTRY = Object.freeze(registry);

export function getReadyMonitorConditions() {
  return MONITOR_CONDITION_REGISTRY.filter((entry) => entry.status === "READY");
}

export function getReadyMonitorCondition(key: string) {
  return getReadyMonitorConditions().find((entry) => entry.key === key) || null;
}

export function validateMonitorConditionInput(value: unknown): readonly MonitorConditionInputValidationError[] {
  if (!record(value)) return ["condition_invalid"];
  const key = typeof value.key === "string" ? value.key : "";
  const operator = typeof value.operator === "string" ? value.operator : "";
  const definition = getReadyMonitorCondition(key);
  if (!definition) return ["condition_key_unknown"];
  if (!definition.allowedOperators.includes(operator as MonitorConditionOperator)) {
    return ["condition_operator_unknown"];
  }
  const values = operator === "in" || operator === "not_in" ? value.value : [value.value];
  if (!Array.isArray(values) || values.length === 0 || values.some((entry) => !validConditionScalar(definition, entry))) {
    return ["condition_value_invalid"];
  }
  return [];
}

function condition(
  key: string,
  valueType: MonitorConditionValueType,
  allowedOperators: readonly MonitorConditionOperator[],
  family: MonitorConditionDefinition["family"],
  domain: string,
  table: MonitorFactTable,
  column: string,
  subject: MonitorConditionDefinition["source"]["subject"],
  qualityCapability: readonly MonitorConditionQuality[],
  sourceContract: { valueQualityColumn?: string; availabilityColumn?: string } = {},
): MonitorConditionDefinition {
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    family,
    domain,
    source: Object.freeze({ table, column, subject, ...sourceContract }),
    qualityCapability: Object.freeze([...qualityCapability]),
    status: "READY" as const,
  });
}

function canonicalOfferingCondition(
  key: string,
  valueType: "number" | "text",
  allowedOperators: readonly MonitorConditionOperator[],
  domain: string,
  column: "validated_canonical_payload" | "materialized_payload",
  jsonPath: readonly string[],
  enumValues?: readonly string[],
): MonitorConditionDefinition {
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    ...(enumValues ? { enumValues: Object.freeze([...enumValues]) } : {}),
    family: "offering" as const,
    domain,
    source: Object.freeze({
      table: "event_offering_monitor_canonical" as const,
      column,
      subject: "event" as const,
      reader: "read_event_offering_monitor_canonical" as const,
      jsonPath: Object.freeze([...jsonPath]),
    }),
    qualityCapability: Object.freeze(["exact", "derived", "estimated", "unknown"] as const),
    status: "READY" as const,
  });
}

function canonicalListingCondition(
  key: string,
  valueType: "text" | "boolean" | "date",
  allowedOperators: readonly MonitorConditionOperator[],
  domain: string,
  jsonPath: readonly string[],
  options: {
    enumValues?: readonly string[];
    factEnvelope?: boolean;
    ineligibleValues?: readonly string[];
  } = {},
): MonitorConditionDefinition {
  const envelopePath = jsonPath.slice(0, -1);
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    ...(options.enumValues ? { enumValues: Object.freeze([...options.enumValues]) } : {}),
    family: "listing" as const,
    domain,
    source: Object.freeze({
      table: "event_listing_risk_facts" as const,
      column: "facts_payload",
      subject: "event" as const,
      reader: "read_current_event_listing_risk_facts" as const,
      jsonPath: Object.freeze([...jsonPath]),
      ...(options.factEnvelope ? {
        valueQualityJsonPath: Object.freeze([...envelopePath, "value_quality"]),
        availabilityJsonPath: Object.freeze([...envelopePath, "availability"]),
      } : {}),
    }),
    qualityCapability: Object.freeze(options.factEnvelope
      ? ["exact", "derived", "estimated", "unknown"] as const
      : ["exact"] as const),
    eligibility: Object.freeze({
      requiredReaderStatus: "available" as const,
      ...(options.factEnvelope ? {
        requiredAvailability: "available" as const,
        requiredValueQualities: MONITOR_COMPARISON_ELIGIBLE_QUALITIES,
      } : {}),
      ...(options.ineligibleValues ? { ineligibleValues: Object.freeze([...options.ineligibleValues]) } : {}),
    }),
    status: "READY" as const,
  });
}

function partialCondition(entry: MonitorConditionDefinition): MonitorConditionDefinition {
  return Object.freeze({ ...entry, status: "PARTIAL" as const });
}

function validateRegistry(entries: readonly MonitorConditionDefinition[]) {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9_.]*$/.test(entry.key)) throw new Error(`Invalid monitor condition key: ${entry.key}`);
    if (keys.has(entry.key)) throw new Error(`Duplicate monitor condition key: ${entry.key}`);
    if (!entry.allowedOperators.length) throw new Error(`Monitor condition has no operators: ${entry.key}`);
    if (!entry.qualityCapability.length) throw new Error(`Monitor condition has no quality capability: ${entry.key}`);
    if (entry.enumValues && (entry.valueType !== "text" || !entry.enumValues.length || new Set(entry.enumValues).size !== entry.enumValues.length)) {
      throw new Error(`Invalid monitor condition enum: ${entry.key}`);
    }
    if (entry.eligibility?.ineligibleValues?.some((value) => !entry.enumValues?.includes(value))) {
      throw new Error(`Monitor condition ineligible value is outside its enum: ${entry.key}`);
    }
    if (entry.eligibility?.requiredValueQualities?.some((quality) => !entry.qualityCapability.includes(quality) || quality === "unknown")) {
      throw new Error(`Invalid monitor condition eligible quality: ${entry.key}`);
    }
    if (entry.qualityCapability.includes("unknown") && entry.qualityCapability.includes("exact") === false && entry.valueType === "boolean") {
      throw new Error(`Boolean monitor condition lacks exact quality: ${entry.key}`);
    }
    if ((entry.source.valueQualityColumn || entry.source.availabilityColumn) && !(entry.source.valueQualityColumn && entry.source.availabilityColumn)) {
      throw new Error(`Incomplete value-quality contract: ${entry.key}`);
    }
    if ((entry.source.valueQualityJsonPath || entry.source.availabilityJsonPath) && !(entry.source.valueQualityJsonPath && entry.source.availabilityJsonPath)) {
      throw new Error(`Incomplete JSON value-quality contract: ${entry.key}`);
    }
    keys.add(entry.key);
  }
}

function validConditionScalar(definition: MonitorConditionDefinition, value: unknown) {
  if (definition.valueType === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.valueType === "boolean") return typeof value === "boolean";
  if (definition.valueType === "date") return validDate(value);
  if (definition.valueType === "timestamp") {
    return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
  }
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (definition.enumValues && !definition.enumValues.includes(value)) return false;
  return !definition.eligibility?.ineligibleValues?.includes(value);
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
