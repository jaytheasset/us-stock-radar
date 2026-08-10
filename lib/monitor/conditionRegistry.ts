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
export type MonitorConditionQuality = "exact" | "derived" | "unavailable";

export type MonitorConditionDefinition = Readonly<{
  key: string;
  valueType: MonitorConditionValueType;
  allowedOperators: readonly MonitorConditionOperator[];
  family: "event" | "market" | "offering" | "ownership";
  domain: string;
  source: Readonly<{
    table: "events" | "event_market_snapshots" | "event_offering_terms" | "event_form4_transactions" | "event_form144_proposed_sales";
    column: string;
    subject: "event" | "ticker";
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
  condition("event.impact", "text", textOperators, "event", "classification", "events", "impact", "event", ["exact"]),
  condition("event.signal", "text", textOperators, "event", "classification", "events", "signal", "event", ["exact"]),
  condition("event.source_group", "text", textOperators, "event", "source", "events", "source_group", "event", ["exact"]),
  condition("event.source_code", "text", textOperators, "event", "source", "events", "source_code", "event", ["exact"]),
  condition("event.ticker", "text", textOperators, "event", "subject", "events", "ticker", "ticker", ["exact", "unavailable"]),
  condition("event.published_at", "timestamp", temporalOperators, "event", "time", "events", "published_at", "event", ["exact", "unavailable"]),
  condition("market.event_time_price", "number", numericOperators, "market", "event_time", "event_market_snapshots", "price", "ticker", ["exact", "unavailable"]),
  condition("market.event_time_market_cap", "number", numericOperators, "market", "event_time", "event_market_snapshots", "market_cap", "ticker", ["exact", "unavailable"]),
  condition("offering.amount", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "offering_amount", "event", ["exact", "derived", "unavailable"]),
  condition("offering.shares_offered", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "shares_offered", "event", ["exact", "derived", "unavailable"]),
  condition("offering.offering_price", "number", numericOperators, "offering", "capital_raising", "event_offering_terms", "offering_price", "event", ["exact", "unavailable"]),
  condition("offering.estimated_dilution_percent", "number", numericOperators, "offering", "dilution", "event_offering_terms", "estimated_dilution_percent", "event", ["derived", "unavailable"]),
  condition("offering.float_overhang_percent", "number", numericOperators, "offering", "dilution", "event_offering_terms", "float_overhang_percent", "event", ["derived", "unavailable"]),
  condition("offering.total_potential_share_exposure", "number", numericOperators, "offering", "dilution", "event_offering_terms", "total_potential_share_exposure", "event", ["exact", "derived", "unavailable"]),
  condition("ownership.form4.transaction_code", "text", textOperators, "ownership", "form4", "event_form4_transactions", "transaction_code", "ticker", ["exact", "unavailable"]),
  condition("ownership.form4.acquired_disposed_code", "text", equality, "ownership", "form4", "event_form4_transactions", "acquired_disposed_code", "ticker", ["exact", "unavailable"]),
  condition("ownership.form4.shares", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "shares", "ticker", ["exact", "unavailable"]),
  condition("ownership.form4.price_per_share", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "price_per_share", "ticker", ["exact", "unavailable"]),
  condition("ownership.form4.transaction_value", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "transaction_value", "ticker", ["derived", "unavailable"]),
  condition("ownership.form4.transaction_date", "date", temporalOperators, "ownership", "form4", "event_form4_transactions", "transaction_date", "ticker", ["exact", "unavailable"]),
  condition("ownership.form144.securities_to_be_sold", "number", numericOperators, "ownership", "form144", "event_form144_proposed_sales", "securities_to_be_sold", "ticker", ["exact", "unavailable"]),
  condition("ownership.form144.aggregate_market_value", "number", numericOperators, "ownership", "form144", "event_form144_proposed_sales", "aggregate_market_value", "ticker", ["exact", "unavailable"]),
  condition("ownership.form144.proposed_sale_percent", "number", numericOperators, "ownership", "form144", "event_form144_proposed_sales", "proposed_sale_percent", "ticker", ["derived", "unavailable"]),
  condition("ownership.form144.approximate_sale_date", "date", temporalOperators, "ownership", "form144", "event_form144_proposed_sales", "approximate_sale_date", "ticker", ["exact", "unavailable"]),
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
  table: MonitorConditionDefinition["source"]["table"],
  column: string,
  subject: MonitorConditionDefinition["source"]["subject"],
  qualityCapability: readonly MonitorConditionQuality[],
): MonitorConditionDefinition {
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    family,
    domain,
    source: Object.freeze({ table, column, subject }),
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
    keys.add(entry.key);
  }
}
