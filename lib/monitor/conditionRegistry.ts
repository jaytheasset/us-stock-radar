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

type MonitorFactTable =
  | "events"
  | "event_market_snapshots"
  | "event_offering_terms"
  | "event_form4_transactions"
  | "event_form144_proposed_sales";

export type MonitorConditionDefinition = Readonly<{
  key: string;
  valueType: MonitorConditionValueType;
  allowedOperators: readonly MonitorConditionOperator[];
  family: "event" | "market" | "offering" | "ownership";
  domain: string;
  source: Readonly<{
    table: MonitorFactTable;
    column: string;
    subject: "event" | "ticker";
    valueQualityColumn?: string;
    availabilityColumn?: string;
  }>;
  qualityCapability: readonly MonitorConditionQuality[];
  status: "READY";
}>;

const equality = ["eq", "neq"] as const;
const textOperators = ["eq", "neq", "in", "not_in"] as const;
const numericOperators = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const temporalOperators = ["eq", "neq", "before", "after"] as const;

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

  condition("offering.amount", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "offering_amount", "event", ["exact", "derived", "estimated", "unknown"]),
  condition("offering.shares_offered", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "shares_offered", "event", ["exact", "derived", "estimated", "unknown"]),
  condition("offering.offering_price", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "offering_price", "event", ["exact", "unknown"]),
  condition("offering.estimated_dilution_percent", "number", numericOperators, "offering", "dilution", "event_offering_terms", "estimated_dilution_percent", "event", ["derived", "estimated", "unknown"]),
  condition("offering.float_overhang_percent", "number", numericOperators, "offering", "dilution", "event_offering_terms", "float_overhang_percent", "event", ["derived", "estimated", "unknown"]),
  condition("offering.total_potential_share_exposure", "number", numericOperators, "offering", "dilution", "event_offering_terms", "total_potential_share_exposure", "event", ["exact", "derived", "estimated", "unknown"]),

  condition("ownership.form4.direction", "text", equality, "ownership", "form4", "event_form4_transactions", "acquired_disposed_code", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.transaction_value", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "transaction_value", "ticker", ["derived", "unknown"], {
    valueQualityColumn: "transaction_value_value_quality",
    availabilityColumn: "transaction_value_availability",
  }),
  condition("ownership.form4.reporting_owner_role", "text", textOperators, "ownership", "form4", "event_form4_transactions", "reporting_owner_roles", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.is_officer", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_officer", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.is_director", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_director", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.officer_title", "text", textOperators, "ownership", "form4", "event_form4_transactions", "officer_title", "ticker", ["exact", "unknown"]),
  condition("ownership.form4.is_10_percent_owner", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_10_percent_owner", "ticker", ["exact", "unknown"]),
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

function validateRegistry(entries: readonly MonitorConditionDefinition[]) {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9_.]*$/.test(entry.key)) throw new Error(`Invalid monitor condition key: ${entry.key}`);
    if (keys.has(entry.key)) throw new Error(`Duplicate monitor condition key: ${entry.key}`);
    if (!entry.allowedOperators.length) throw new Error(`Monitor condition has no operators: ${entry.key}`);
    if (!entry.qualityCapability.length) throw new Error(`Monitor condition has no quality capability: ${entry.key}`);
    if (entry.qualityCapability.includes("unknown") && entry.qualityCapability.includes("exact") === false && entry.valueType === "boolean") {
      throw new Error(`Boolean monitor condition lacks exact quality: ${entry.key}`);
    }
    if ((entry.source.valueQualityColumn || entry.source.availabilityColumn) && !(entry.source.valueQualityColumn && entry.source.availabilityColumn)) {
      throw new Error(`Incomplete value-quality contract: ${entry.key}`);
    }
    keys.add(entry.key);
  }
}
