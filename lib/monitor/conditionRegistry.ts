import {
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
} from "./listingRiskFacts.ts";
import {
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  type CorporateActionCanonicalVocabularyEntry,
} from "./corporateActionCanonicalFacts.ts";

export const MONITOR_CONDITION_REGISTRY_VERSION = "monitor_conditions_v1";

export type MonitorConditionValueType = "number" | "decimal" | "text" | "boolean" | "date" | "timestamp";
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
  | "after"
  | "within_days";
export type MonitorConditionQuality = "exact" | "derived" | "estimated" | "unknown";

export type MonitorConditionSemanticMetadata = Readonly<{
  description: string;
  enumValueDescriptions?: Readonly<Record<string, string>>;
}>;

export type MonitorConditionDisplayMetadata = Readonly<{
  label: string;
  enumValueLabels?: Readonly<Record<string, string>>;
  booleanValueLabels?: Readonly<Record<"true" | "false", string>>;
  numberFormat?: Readonly<{
    style: "currency" | "decimal";
    currency?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }>;
  operatorValueTemplates?: Readonly<Partial<Record<MonitorConditionOperator, string>>>;
}>;

export const MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS = Object.freeze({
  eq: "Equals",
  neq: "Does not equal",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  in: "Any of",
  not_in: "None of",
  before: "Before",
  after: "After",
  within_days: "Within",
} satisfies Record<MonitorConditionOperator, string>);

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
  | "event_corporate_action_facts"
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
  description?: string;
  enumValueDescriptions?: Readonly<Record<string, string>>;
  display?: MonitorConditionDisplayMetadata;
  requiresExplicitConfirmationInAiDraft?: boolean;
  aiDraftConfirmation?: Readonly<{
    useLabel: string;
    omitLabel: string;
    enumValueLabels?: Readonly<Record<string, string>>;
  }>;
  monitorDomains?: readonly ("listing" | "financial" | "sc13")[];
  numberValidation?: Readonly<{
    exclusiveMinimum?: number;
    minimum?: number;
  }>;
  family: "event" | "market" | "offering" | "listing" | "corporate_action" | "ownership" | "financial" | "sc13";
  domain: string;
  source: Readonly<{
    table?: MonitorFactTable;
    column?: string;
    subject: "event" | "ticker" | "issuer";
    reader?:
      | "read_event_offering_monitor_canonical"
      | "read_current_event_listing_risk_facts"
      | "read_current_event_corporate_action_facts"
      | "read_current_event_ownership_facts"
      | "read_current_event_periodic_financial"
      | "read_sc13_issuer_current_state"
      | "get_current_price";
    jsonPath?: readonly string[];
    valueQualityColumn?: string;
    availabilityColumn?: string;
    valueQualityJsonPath?: readonly string[];
    availabilityJsonPath?: readonly string[];
    ownerScoped?: boolean;
  }>;
  qualityCapability: readonly MonitorConditionQuality[];
  eligibility?: Readonly<{
    requiredReaderStatus: "available";
    requiredAvailability?: "available";
    requiredValueQualities?: readonly MonitorConditionQuality[];
    ineligibleValues?: readonly string[];
    requiredDataModes?: readonly "realtime"[];
    maximumAgeSeconds?: number;
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
const dateOperators = [...temporalOperators, "within_days"] as const;
const enumOperators = ["eq", "in"] as const;
const publicCorporateActionEventKinds = monitorableCorporateActionVocabulary(
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY,
);
const publicCorporateActionStages = monitorableCorporateActionVocabulary(
  CORPORATE_ACTION_STAGE_VOCABULARY,
);

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

  currentMarketCondition("market.price", "number", ["lt", "lte", "gt", "gte"], {
    description: "Current market price of the security.",
    display: {
      label: "Price",
      numberFormat: {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      },
      operatorValueTemplates: {
        lt: "Below {value}",
        lte: "{value} or less",
        gt: "Above {value}",
        gte: "{value} or more",
      },
    },
    numberValidation: { exclusiveMinimum: 0 },
  }),

  ...periodicFinancialConditions(),
  ...sc13CurrentConditions(),

  canonicalCorporateActionCondition(
    "corporate_action.event_kind",
    publicCorporateActionEventKinds.values,
    ["event_kind"],
    {
      description: "The kind of corporate action established by the official canonical Corporate Action facts.",
      enumValueDescriptions: publicCorporateActionEventKinds.descriptions,
      display: {
        label: "Corporate action",
        enumValueLabels: publicCorporateActionEventKinds.labels,
      },
    },
  ),
  canonicalCorporateActionCondition(
    "corporate_action.action_stage",
    publicCorporateActionStages.values,
    ["action_stage"],
    {
      description: "The explicit lifecycle-stage restriction required for a reverse stock split in the official canonical Corporate Action facts; general event requests do not imply a stage.",
      enumValueDescriptions: publicCorporateActionStages.descriptions,
      requiresExplicitConfirmationInAiDraft: true,
      aiDraftConfirmation: {
        useLabel: "Use this filter",
        omitLabel: "Any stage",
        enumValueLabels: {
          announced: "Initial plan announced",
          board_approved: "Board approved",
          shareholder_approved: "Shareholders approved",
          scheduled: "Scheduled",
          effective: "Effective",
        },
      },
      display: {
        label: "Corporate action stage",
        enumValueLabels: publicCorporateActionStages.labels,
      },
    },
  ),
  canonicalOfferingCondition("offering.side", "text", enumOperators, "classification", "validated_canonical_payload", ["primary_or_resale"], ["primary", "resale", "mixed"]),
  canonicalOfferingCondition("offering.amount", "number", numericOperators, "capital_raising", "validated_canonical_payload", ["facts", "actual_primary_offering_amount"]),
  canonicalOfferingCondition("offering.offering_price", "number", numericOperators, "capital_raising", "validated_canonical_payload", ["facts", "offering_price"]),
  canonicalOfferingCondition("offering.immediate_primary_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "immediate_primary_share_exposure"]),
  canonicalOfferingCondition("offering.additional_potential_primary_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "additional_potential_primary_share_exposure"]),
  canonicalOfferingCondition("offering.resale_share_exposure", "number", numericOperators, "dilution", "validated_canonical_payload", ["facts", "resale_share_exposure"]),
  canonicalOfferingCondition("offering.total_potential_share_exposure", "number", numericOperators, "dilution", "materialized_payload", ["total_potential_primary_share_exposure"]),

  canonicalListingCondition("listing.event_kind", "text", enumOperators, "classification", ["classification", "event_kind"], {
    enumValues: LISTING_EVENT_KINDS,
    description: "The type of exchange listing-compliance event established by the canonical event facts.",
    enumValueDescriptions: {
      deficiency_notice: "The exchange notified the issuer that one or more continued-listing requirements were not met.",
      compliance_recovery: "The exchange confirmed that the issuer regained compliance with one or more continued-listing requirements.",
      delisting_determination: "The exchange determined that the security is subject to delisting.",
      hearing_or_appeal_update: "A listing hearing or appeal was requested, scheduled, updated, or decided.",
      trading_suspension: "The exchange took or scheduled a listing-related trading suspension action.",
      listing_removal: "The security's exchange listing was removed or terminated.",
      voluntary_withdrawal: "The issuer initiated withdrawal of the security's exchange listing.",
      other: "Another material listing-status event not represented by a more specific event kind.",
    },
    display: {
      label: "Listing event",
      enumValueLabels: {
        deficiency_notice: "Listing deficiency notice",
        compliance_recovery: "Compliance recovery",
        delisting_determination: "Delisting determination",
        hearing_or_appeal_update: "Hearing or appeal update",
        trading_suspension: "Trading suspension",
        listing_removal: "Listing removal",
        voluntary_withdrawal: "Voluntary withdrawal",
        other: "Other listing event",
      },
    },
  }),
  canonicalListingCondition("listing.event_outcome", "text", enumOperators, "classification", ["classification", "event_outcome"], {
    enumValues: LISTING_EVENT_OUTCOMES,
    ineligibleValues: ["unknown"],
    description: "The effect of the event on the security's listing-compliance standing.",
    enumValueDescriptions: {
      adverse: "The event worsens or threatens the security's listing standing.",
      recovered: "The outcome indicates recovery from a previously adverse listing-compliance condition.",
      procedural: "The event is procedural or administrative and is not itself adverse or recovered.",
      unknown: "The event outcome is not established.",
    },
    display: {
      label: "Listing outcome",
      enumValueLabels: {
        adverse: "Unfavorable",
        recovered: "Recovered",
        procedural: "Procedural",
        unknown: "Unknown",
      },
    },
  }),
  canonicalListingCondition("listing.exchange", "text", textOperators, "venue", ["exchange", "value"], {
    factEnvelope: true,
    description: "The securities exchange associated with the listing-compliance event.",
    display: { label: "Exchange" },
  }),
  canonicalListingCondition("listing.compliance_deadline", "date", dateOperators, "dates", ["dates", "compliance_deadline", "value"], {
    factEnvelope: true,
    description: "The date by which the issuer must regain compliance with continued-listing requirements.",
    display: { label: "Compliance deadline" },
  }),
  canonicalListingCondition("listing.hearing_date", "date", dateOperators, "dates", ["dates", "hearing_date", "value"], {
    factEnvelope: true,
    description: "The scheduled or occurred date of a listing hearing.",
    display: { label: "Hearing date" },
  }),
  canonicalListingCondition("listing.appeal_deadline", "date", dateOperators, "dates", ["dates", "appeal_deadline", "value"], {
    factEnvelope: true,
    description: "The date by which the issuer may appeal a listing determination.",
    display: { label: "Appeal deadline" },
  }),
  canonicalListingCondition("listing.suspension_date", "date", dateOperators, "dates", ["dates", "trading_suspension_date", "value"], {
    factEnvelope: true,
    description: "The date a listing-related trading suspension is scheduled to begin or occurred.",
    display: { label: "Trading suspension date" },
  }),
  canonicalListingCondition("listing.removal_effective_date", "date", dateOperators, "dates", ["dates", "removal_effective_date", "value"], {
    factEnvelope: true,
    description: "The date removal or termination of the exchange listing becomes or became effective.",
    display: { label: "Listing removal date" },
  }),
  canonicalListingCondition("listing.continued_trading", "boolean", equality, "trading", ["continued_trading", "continues", "value"], {
    factEnvelope: true,
    description: "Whether the security continues trading after the listing-compliance event.",
    display: {
      label: "Continued trading",
      booleanValueLabels: { true: "Yes", false: "No" },
    },
  }),
  canonicalListingCondition("listing.proceeding_kind", "text", enumOperators, "proceeding", ["proceeding", "kind"], {
    enumValues: LISTING_PROCEEDING_KINDS,
    ineligibleValues: ["unknown"],
    description: "The type of exchange listing proceeding associated with the event.",
    enumValueDescriptions: {
      hearing: "The proceeding is an exchange listing hearing.",
      appeal: "The proceeding is an appeal of an exchange listing decision.",
      other: "The proceeding is another listing process not represented by hearing or appeal.",
      unknown: "The proceeding type is not established.",
    },
    display: {
      label: "Proceeding type",
      enumValueLabels: {
        hearing: "Hearing",
        appeal: "Appeal",
        other: "Other proceeding",
        unknown: "Unknown",
      },
    },
  }),
  canonicalListingCondition("listing.proceeding_status", "text", enumOperators, "proceeding", ["proceeding", "status"], {
    enumValues: LISTING_PROCEEDING_STATUSES,
    ineligibleValues: ["unknown"],
    description: "The current procedural status of the exchange listing proceeding.",
    enumValueDescriptions: {
      intended: "The issuer intends to pursue the proceeding but has not requested it.",
      requested: "The proceeding has been requested.",
      pending: "The proceeding is awaiting action or a decision.",
      decided: "The proceeding has received a decision.",
      not_pursued: "The proceeding will not be pursued.",
      unknown: "The proceeding status is not established.",
    },
    display: {
      label: "Proceeding status",
      enumValueLabels: {
        intended: "Intended",
        requested: "Requested",
        pending: "Pending",
        decided: "Decided",
        not_pursued: "Not pursued",
        unknown: "Unknown",
      },
    },
  }),

  partialCondition(condition("ownership.form4.direction", "text", equality, "ownership", "form4", "event_form4_transactions", "economic_direction", "ticker", ["exact", "unknown"])),
  partialCondition(condition("ownership.form4.transaction_value", "number", numericOperators, "ownership", "form4", "event_form4_transactions", "transaction_value", "ticker", ["derived", "unknown"], {
    valueQualityColumn: "transaction_value_value_quality",
    availabilityColumn: "transaction_value_availability",
  })),
  canonicalOwnershipCondition("ownership.form4.transaction_kind", "text", enumOperators, "form4", "event_form4_transactions", "transaction_kind", {
    enumValues: ["non_derivative", "derivative"],
    description: "Whether the reported Form 4 transaction row is non-derivative or derivative.",
    enumValueDescriptions: {
      non_derivative: "A reported transaction in a non-derivative security.",
      derivative: "A reported transaction in a derivative security.",
    },
    display: {
      label: "Form 4 transaction type",
      enumValueLabels: { non_derivative: "Non-derivative", derivative: "Derivative" },
    },
  }),
  canonicalOwnershipCondition("ownership.form4.transaction_code", "text", textOperators, "form4", "event_form4_transactions", "transaction_code", {
    description: "The raw one-letter SEC transaction code on a reported Form 4 transaction row.",
    display: { label: "Form 4 transaction code" },
  }),
  canonicalOwnershipCondition("ownership.form4.acquisition_disposition", "text", enumOperators, "form4", "event_form4_transactions", "acquired_disposed_code", {
    enumValues: ["A", "D"],
    description: "The raw SEC acquisition or disposition marker on a reported Form 4 transaction row.",
    enumValueDescriptions: {
      A: "The source row is marked as an acquisition.",
      D: "The source row is marked as a disposition.",
    },
    display: {
      label: "Form 4 acquisition/disposition",
      enumValueLabels: { A: "Acquisition (A)", D: "Disposition (D)" },
    },
  }),
  canonicalOwnershipCondition("ownership.form4.security_class", "text", textOperators, "form4", "event_form4_transactions", "security_title", {
    description: "The security title reported on a Form 4 transaction row.",
    display: { label: "Form 4 security class" },
  }),
  canonicalOwnershipCondition("ownership.form4.transaction_date", "date", dateOperators, "form4", "event_form4_transactions", "transaction_date", {
    description: "The transaction date reported on a Form 4 transaction row.",
    display: { label: "Form 4 transaction date" },
  }),
  canonicalOwnershipCondition("ownership.form4.shares", "number", numericOperators, "form4", "event_form4_transactions", "shares", {
    qualityColumn: "shares_value_quality",
    availabilityColumn: "shares_availability",
    description: "The exact share or unit quantity reported on a Form 4 transaction row.",
    display: { label: "Form 4 shares", numberFormat: { style: "decimal", maximumFractionDigits: 8 } },
  }),
  canonicalOwnershipCondition("ownership.form4.price_per_share", "number", numericOperators, "form4", "event_form4_transactions", "price_per_share", {
    qualityColumn: "price_per_share_value_quality",
    availabilityColumn: "price_per_share_availability",
    description: "The exact per-share price reported on a Form 4 transaction row.",
    display: { label: "Form 4 price per share", numberFormat: { style: "currency", currency: "USD", maximumFractionDigits: 8 } },
  }),
  canonicalOwnershipCondition("ownership.form4.post_transaction_shares", "number", numericOperators, "form4", "event_form4_transactions", "post_transaction_shares", {
    qualityColumn: "post_transaction_shares_value_quality",
    availabilityColumn: "post_transaction_shares_availability",
    description: "The exact post-transaction holdings reported on a Form 4 transaction row.",
    display: { label: "Form 4 post-transaction holdings", numberFormat: { style: "decimal", maximumFractionDigits: 8 } },
  }),
  canonicalOwnershipCondition("ownership.form4.reporting_owner_role", "text", textOperators, "form4", "event_form4_transactions", "reporting_owner_roles", {
    description: "A reporting-owner role preserved for the Form 4 filing without inventing row attribution.",
    display: { label: "Form 4 reporting-owner role" },
    ownerScoped: true,
  }),
  canonicalOwnershipCondition("ownership.form4.is_officer", "boolean", equality, "form4", "event_form4_transactions", "is_officer", {
    description: "Whether the sole reporting owner is identified as an officer in the Form 4 filing.",
    display: { label: "Form 4 owner is officer", booleanValueLabels: { true: "Yes", false: "No" } },
    ownerScoped: true,
  }),
  canonicalOwnershipCondition("ownership.form4.is_director", "boolean", equality, "form4", "event_form4_transactions", "is_director", {
    description: "Whether the sole reporting owner is identified as a director in the Form 4 filing.",
    display: { label: "Form 4 owner is director", booleanValueLabels: { true: "Yes", false: "No" } },
    ownerScoped: true,
  }),
  canonicalOwnershipCondition("ownership.form4.officer_title", "text", textOperators, "form4", "event_form4_transactions", "officer_title", {
    description: "The officer title of the sole reporting owner in the Form 4 filing.",
    display: { label: "Form 4 officer title" },
    ownerScoped: true,
  }),
  canonicalOwnershipCondition("ownership.form4.is_10_percent_owner", "boolean", equality, "form4", "event_form4_transactions", "is_10_percent_owner", {
    description: "Whether the sole reporting owner is identified as a ten-percent owner in the Form 4 filing.",
    display: { label: "Form 4 ten-percent owner", booleanValueLabels: { true: "Yes", false: "No" } },
    ownerScoped: true,
  }),
  partialCondition(condition("ownership.form4.is_10b5_1", "boolean", equality, "ownership", "form4", "event_form4_transactions", "is_10b5_1", "ticker", ["exact", "unknown"])),
  canonicalOwnershipCondition("ownership.form144.security_class", "text", textOperators, "form144", "event_form144_proposed_sales", "security_title", {
    description: "The security class stated on a Form 144 proposed-sale notice row.",
    display: { label: "Form 144 security class" },
  }),
  canonicalOwnershipCondition("ownership.form144.proposed_sale_shares", "number", numericOperators, "form144", "event_form144_proposed_sales", "securities_to_be_sold", {
    qualityColumn: "securities_to_be_sold_value_quality",
    availabilityColumn: "securities_to_be_sold_availability",
    description: "The exact proposed share or unit quantity on a Form 144 notice row; it is not an executed sale.",
    display: { label: "Form 144 proposed shares", numberFormat: { style: "decimal", maximumFractionDigits: 8 } },
  }),
  canonicalOwnershipCondition("ownership.form144.proposed_sale_value", "number", numericOperators, "form144", "event_form144_proposed_sales", "aggregate_market_value", {
    qualityColumn: "aggregate_market_value_value_quality",
    availabilityColumn: "aggregate_market_value_availability",
    description: "The exact aggregate market value on a Form 144 proposed-sale notice row; it is not sale proceeds.",
    display: { label: "Form 144 proposed value", numberFormat: { style: "currency", currency: "USD", maximumFractionDigits: 2 } },
  }),
  canonicalOwnershipCondition("ownership.form144.proposed_sale_date", "date", dateOperators, "form144", "event_form144_proposed_sales", "approximate_sale_date", {
    description: "The approximate sale date stated on a Form 144 proposed-sale notice row.",
    display: { label: "Form 144 proposed sale date" },
  }),
  canonicalOwnershipCondition("ownership.form144.exchange", "text", textOperators, "form144", "event_form144_proposed_sales", "exchange", {
    description: "The exchange stated on a Form 144 proposed-sale notice row.",
    display: { label: "Form 144 exchange" },
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
  if (operator === "within_days") {
    return definition.valueType === "date" && validRelativeDayCount(value.value)
      ? []
      : ["condition_value_invalid"];
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

function periodicFinancialConditions(): readonly MonitorConditionDefinition[] {
  const metrics = [
    ["revenue", "REVENUE", "Revenue"],
    ["operating_income_loss", "OPERATING_INCOME_LOSS", "Operating income/loss"],
    ["net_income_loss", "NET_INCOME_LOSS", "Net income/loss"],
    ["operating_cash_flow", "OPERATING_CASH_FLOW", "Operating cash flow"],
    ["cash", "CASH", "Cash and cash equivalents"],
  ] as const;
  const bases = [
    ["quarter", "QUARTER", "quarter"],
    ["year_to_date", "YEAR_TO_DATE", "year to date"],
    ["annual", "ANNUAL", "annual"],
    ["instant", "INSTANT", "period end"],
  ] as const;
  return metrics.flatMap(([metricKey, metric, metricLabel]) => bases.flatMap(([basisKey, basis, basisLabel]) => {
    if ((metric === "CASH") !== (basis === "INSTANT")) return [];
    if (metric !== "CASH" && basis === "INSTANT") return [];
    if (metric === "OPERATING_CASH_FLOW" && basis === "QUARTER") return [];
    const common = {
      valueType: "decimal" as const,
      allowedOperators: Object.freeze([...numericOperators]),
      monitorDomains: Object.freeze(["financial"] as const),
      family: "financial" as const,
      domain: "periodic_sec" as const,
      source: Object.freeze({
        subject: "event" as const,
        reader: "read_current_event_periodic_financial" as const,
        jsonPath: Object.freeze([metric, basis] as const),
      }),
      qualityCapability: Object.freeze(["exact"] as const),
      eligibility: Object.freeze({ requiredReaderStatus: "available" as const }),
      status: "READY" as const,
    };
    return [
      Object.freeze({
        ...common,
        key: `financial.${metricKey}.${basisKey}.current`,
        description: `Canonical ${basisLabel} ${metricLabel.toLowerCase()} for the exact SEC filing.`,
        display: Object.freeze({ label: `${metricLabel} (${basisLabel})` }),
      }),
      Object.freeze({
        ...common,
        key: `financial.${metricKey}.${basisKey}.yoy_change`,
        description: `Exact year-over-year change in canonical ${basisLabel} ${metricLabel.toLowerCase()}.`,
        display: Object.freeze({ label: `${metricLabel} YoY change (${basisLabel})` }),
      }),
    ];
  }));
}

function sc13CurrentConditions(): readonly MonitorConditionDefinition[] {
  const fields = [
    ["aggregate_owned", "aggregateAmountOwnedRaw", "Aggregate amount beneficially owned"],
    ["percent_of_class", "percentOfClassRaw", "Percent of class beneficially owned"],
    ["sole_voting", "soleVotingPowerRaw", "Sole voting power"],
    ["shared_voting", "sharedVotingPowerRaw", "Shared voting power"],
    ["sole_dispositive", "soleDispositivePowerRaw", "Sole dispositive power"],
    ["shared_dispositive", "sharedDispositivePowerRaw", "Shared dispositive power"],
  ] as const;
  return fields.map(([key, field, label]) => Object.freeze({
    key: `sc13.${key}`,
    valueType: "decimal" as const,
    allowedOperators: Object.freeze([...numericOperators]),
    description: `${label} in the latest saved Schedule 13 filing for one exact issuer, reporter, security class, and CUSIP position; this is not a real-time ownership value.`,
    display: Object.freeze({ label: `${label} (latest saved filing)` }),
    monitorDomains: Object.freeze(["sc13"] as const),
    family: "sc13" as const,
    domain: "stored_filing_current_state",
    source: Object.freeze({
      subject: "issuer" as const,
      reader: "read_sc13_issuer_current_state" as const,
      jsonPath: Object.freeze([field] as const),
    }),
    qualityCapability: Object.freeze(["exact"] as const),
    eligibility: Object.freeze({ requiredReaderStatus: "available" as const }),
    status: "READY" as const,
  }));
}

function currentMarketCondition(
  key: string,
  valueType: "number",
  allowedOperators: readonly MonitorConditionOperator[],
  options: Readonly<{
    description: string;
    display: MonitorConditionDisplayMetadata;
    numberValidation: Readonly<{ exclusiveMinimum: number }>;
  }>,
): MonitorConditionDefinition {
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    description: options.description,
    display: Object.freeze({
      ...options.display,
      numberFormat: options.display.numberFormat
        ? Object.freeze({ ...options.display.numberFormat })
        : undefined,
      operatorValueTemplates: options.display.operatorValueTemplates
        ? Object.freeze({ ...options.display.operatorValueTemplates })
        : undefined,
    }),
    monitorDomains: Object.freeze(["listing"] as const),
    numberValidation: Object.freeze({ ...options.numberValidation }),
    family: "market" as const,
    domain: "current_state",
    source: Object.freeze({
      subject: "ticker" as const,
      reader: "get_current_price" as const,
      jsonPath: Object.freeze(["price"] as const),
    }),
    qualityCapability: Object.freeze(["exact"] as const),
    eligibility: Object.freeze({
      requiredReaderStatus: "available" as const,
      requiredAvailability: "available" as const,
      requiredDataModes: Object.freeze(["realtime"] as const),
      maximumAgeSeconds: 300,
    }),
    status: "READY" as const,
  });
}

type CorporateActionConditionMetadata<TEnumValues extends readonly string[]> = Readonly<{
  description: string;
  enumValueDescriptions: Readonly<Record<TEnumValues[number], string>>;
  requiresExplicitConfirmationInAiDraft?: boolean;
  aiDraftConfirmation?: Readonly<{
    useLabel: string;
    omitLabel: string;
    enumValueLabels?: Readonly<Record<TEnumValues[number], string>>;
  }>;
  display: Readonly<{
    label: string;
    enumValueLabels: Readonly<Record<TEnumValues[number], string>>;
  }>;
}>;

function monitorableCorporateActionVocabulary(
  entries: readonly CorporateActionCanonicalVocabularyEntry[],
) {
  const monitorable = entries.filter((entry) => entry.monitorable);
  return Object.freeze({
    values: Object.freeze(monitorable.map((entry) => entry.value)),
    descriptions: Object.freeze(Object.fromEntries(
      monitorable.map((entry) => [entry.value, entry.description]),
    )),
    labels: Object.freeze(Object.fromEntries(
      monitorable.map((entry) => [entry.value, entry.displayLabel]),
    )),
  });
}

function canonicalCorporateActionCondition<const TEnumValues extends readonly string[]>(
  key: string,
  enumValues: TEnumValues,
  jsonPath: readonly string[],
  metadata: CorporateActionConditionMetadata<TEnumValues>,
): MonitorConditionDefinition {
  return Object.freeze({
    key,
    valueType: "text" as const,
    allowedOperators: Object.freeze([...enumOperators]),
    enumValues: Object.freeze([...enumValues]),
    description: metadata.description,
    enumValueDescriptions: Object.freeze({ ...metadata.enumValueDescriptions }),
    display: Object.freeze({
      label: metadata.display.label,
      enumValueLabels: Object.freeze({ ...metadata.display.enumValueLabels }),
    }),
    requiresExplicitConfirmationInAiDraft: metadata.requiresExplicitConfirmationInAiDraft,
    aiDraftConfirmation: metadata.aiDraftConfirmation
      ? Object.freeze({
          useLabel: metadata.aiDraftConfirmation.useLabel,
          omitLabel: metadata.aiDraftConfirmation.omitLabel,
          enumValueLabels: metadata.aiDraftConfirmation.enumValueLabels
            ? Object.freeze({ ...metadata.aiDraftConfirmation.enumValueLabels })
            : undefined,
        })
      : undefined,
    monitorDomains: Object.freeze(["listing"] as const),
    family: "corporate_action" as const,
    domain: "canonical",
    source: Object.freeze({
      table: "event_corporate_action_facts" as const,
      column: "facts_payload",
      subject: "event" as const,
      reader: "read_current_event_corporate_action_facts" as const,
      jsonPath: Object.freeze([...jsonPath]),
    }),
    qualityCapability: Object.freeze(["exact"] as const),
    eligibility: Object.freeze({ requiredReaderStatus: "available" as const }),
    status: "READY" as const,
  });
}

type ListingConditionMetadata<TEnumValues extends readonly string[] | undefined> = Readonly<{
  description: string;
  display: Readonly<{
    label: string;
    booleanValueLabels?: Readonly<Record<"true" | "false", string>>;
  } & (TEnumValues extends readonly string[]
    ? { enumValueLabels: Readonly<Record<TEnumValues[number], string>> }
    : { enumValueLabels?: never })>;
} & (TEnumValues extends readonly string[]
  ? { enumValueDescriptions: Readonly<Record<TEnumValues[number], string>> }
  : { enumValueDescriptions?: never })>;

function canonicalListingCondition<
  const TEnumValues extends readonly string[] | undefined = undefined,
>(
  key: string,
  valueType: "text" | "boolean" | "date",
  allowedOperators: readonly MonitorConditionOperator[],
  domain: string,
  jsonPath: readonly string[],
  options: {
    enumValues?: TEnumValues;
    factEnvelope?: boolean;
    ineligibleValues?: readonly string[];
  } & ListingConditionMetadata<TEnumValues>,
): MonitorConditionDefinition {
  const envelopePath = jsonPath.slice(0, -1);
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    ...(options.enumValues ? { enumValues: Object.freeze([...options.enumValues]) } : {}),
    description: options.description,
    ...(options.enumValueDescriptions ? {
      enumValueDescriptions: Object.freeze({ ...options.enumValueDescriptions }),
    } : {}),
    display: Object.freeze({
      label: options.display.label,
      ...(options.display.enumValueLabels ? {
        enumValueLabels: Object.freeze({ ...options.display.enumValueLabels }),
      } : {}),
      ...(options.display.booleanValueLabels ? {
        booleanValueLabels: Object.freeze({ ...options.display.booleanValueLabels }),
      } : {}),
    }),
    monitorDomains: Object.freeze(["listing"] as const),
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

type OwnershipConditionOptions = Readonly<{
  description: string;
  enumValues?: readonly string[];
  enumValueDescriptions?: Readonly<Record<string, string>>;
  qualityColumn?: string;
  availabilityColumn?: string;
  ownerScoped?: boolean;
  display: MonitorConditionDisplayMetadata;
}>;

function canonicalOwnershipCondition(
  key: string,
  valueType: "text" | "boolean" | "date" | "number",
  allowedOperators: readonly MonitorConditionOperator[],
  domain: "form4" | "form144",
  table: "event_form4_transactions" | "event_form144_proposed_sales",
  column: string,
  options: OwnershipConditionOptions,
): MonitorConditionDefinition {
  const numeric = valueType === "number";
  return Object.freeze({
    key,
    valueType,
    allowedOperators: Object.freeze([...allowedOperators]),
    ...(options.enumValues ? { enumValues: Object.freeze([...options.enumValues]) } : {}),
    description: options.description,
    ...(options.enumValueDescriptions ? {
      enumValueDescriptions: Object.freeze({ ...options.enumValueDescriptions }),
    } : {}),
    display: Object.freeze({
      ...options.display,
      ...(options.display.enumValueLabels ? {
        enumValueLabels: Object.freeze({ ...options.display.enumValueLabels }),
      } : {}),
      ...(options.display.booleanValueLabels ? {
        booleanValueLabels: Object.freeze({ ...options.display.booleanValueLabels }),
      } : {}),
      ...(options.display.numberFormat ? {
        numberFormat: Object.freeze({ ...options.display.numberFormat }),
      } : {}),
      ...(numeric ? {
        operatorValueTemplates: Object.freeze({
          eq: "Equals {value}",
          neq: "Does not equal {value}",
          gt: "Greater than {value}",
          gte: "At least {value}",
          lt: "Less than {value}",
          lte: "At most {value}",
        }),
      } : {}),
    }),
    monitorDomains: Object.freeze(["listing"] as const),
    ...(numeric ? { numberValidation: Object.freeze({ minimum: 0 }) } : {}),
    family: "ownership" as const,
    domain,
    source: Object.freeze({
      table,
      column,
      subject: "ticker" as const,
      reader: "read_current_event_ownership_facts" as const,
      ...(options.qualityColumn ? { valueQualityColumn: options.qualityColumn } : {}),
      ...(options.availabilityColumn ? { availabilityColumn: options.availabilityColumn } : {}),
      ...(options.ownerScoped ? { ownerScoped: true } : {}),
    }),
    qualityCapability: Object.freeze(numeric ? ["exact", "unknown"] as const : ["exact"] as const),
    eligibility: Object.freeze({
      requiredReaderStatus: "available" as const,
      ...(numeric ? {
        requiredAvailability: "available" as const,
        requiredValueQualities: Object.freeze(["exact"] as const),
      } : {}),
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
    if (entry.allowedOperators.includes("within_days") && entry.valueType !== "date") {
      throw new Error(`within_days requires a date-only monitor condition: ${entry.key}`);
    }
    if (!entry.qualityCapability.length) throw new Error(`Monitor condition has no quality capability: ${entry.key}`);
    if (entry.enumValues && (entry.valueType !== "text" || !entry.enumValues.length || new Set(entry.enumValues).size !== entry.enumValues.length)) {
      throw new Error(`Invalid monitor condition enum: ${entry.key}`);
    }
    if (entry.monitorDomains?.includes("listing")) {
      if (typeof entry.description !== "string" || !entry.description.trim()) {
        throw new Error(`Monitor condition lacks a description: ${entry.key}`);
      }
      const describedValues = Object.keys(entry.enumValueDescriptions ?? {});
      if (entry.enumValues) {
        if (
          describedValues.length !== entry.enumValues.length
          || entry.enumValues.some((value) => !entry.enumValueDescriptions?.[value]?.trim())
          || describedValues.some((value) => !entry.enumValues?.includes(value))
        ) {
          throw new Error(`Monitor condition enum descriptions are incomplete: ${entry.key}`);
        }
      } else if (describedValues.length > 0) {
        throw new Error(`Monitor condition has descriptions without enum values: ${entry.key}`);
      }
      if (typeof entry.display?.label !== "string" || !entry.display.label.trim()) {
        throw new Error(`Monitor condition lacks a display label: ${entry.key}`);
      }
      const labeledValues = Object.keys(entry.display.enumValueLabels ?? {});
      if (entry.enumValues) {
        if (
          labeledValues.length !== entry.enumValues.length
          || entry.enumValues.some((value) => !entry.display?.enumValueLabels?.[value]?.trim())
          || labeledValues.some((value) => !entry.enumValues?.includes(value))
        ) {
          throw new Error(`Monitor condition enum display labels are incomplete: ${entry.key}`);
        }
      } else if (labeledValues.length > 0) {
        throw new Error(`Monitor condition has enum display labels without enum values: ${entry.key}`);
      }
      const booleanLabels = entry.display.booleanValueLabels;
      if (entry.valueType === "boolean") {
        if (!booleanLabels?.true?.trim() || !booleanLabels.false?.trim()) {
          throw new Error(`Monitor boolean condition display labels are incomplete: ${entry.key}`);
        }
      } else if (booleanLabels) {
        throw new Error(`Non-boolean monitor condition has boolean display labels: ${entry.key}`);
      }
      if (entry.valueType === "number") {
        const templates = entry.display.operatorValueTemplates;
        if (
          !entry.numberValidation
          || entry.allowedOperators.some((operator) => !templates?.[operator]?.includes("{value}"))
        ) {
          throw new Error(`Numeric monitor condition metadata is incomplete: ${entry.key}`);
        }
      }
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
    if (
      entry.numberValidation?.exclusiveMinimum !== undefined
      && (!Number.isFinite(entry.numberValidation.exclusiveMinimum) || entry.valueType !== "number")
    ) {
      throw new Error(`Invalid numeric monitor condition constraint: ${entry.key}`);
    }
    if (
      entry.numberValidation?.minimum !== undefined
      && (!Number.isFinite(entry.numberValidation.minimum) || entry.valueType !== "number")
    ) {
      throw new Error(`Invalid numeric monitor condition constraint: ${entry.key}`);
    }
    if (
      entry.numberValidation?.minimum !== undefined
      && entry.numberValidation.exclusiveMinimum !== undefined
    ) {
      throw new Error(`Ambiguous numeric monitor condition constraint: ${entry.key}`);
    }
    if (
      entry.eligibility?.maximumAgeSeconds !== undefined
      && (!Number.isFinite(entry.eligibility.maximumAgeSeconds) || entry.eligibility.maximumAgeSeconds <= 0)
    ) {
      throw new Error(`Invalid monitor condition freshness constraint: ${entry.key}`);
    }
    keys.add(entry.key);
  }
}

function validConditionScalar(definition: MonitorConditionDefinition, value: unknown) {
  if (definition.valueType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const exclusiveMinimum = definition.numberValidation?.exclusiveMinimum;
    const minimum = definition.numberValidation?.minimum;
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) return false;
    return minimum === undefined || value >= minimum;
  }
  if (definition.valueType === "decimal") {
    return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
  }
  if (definition.valueType === "boolean") return typeof value === "boolean";
  if (definition.valueType === "date") return monitorDateOnlyUtcDay(value) !== null;
  if (definition.valueType === "timestamp") {
    return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
  }
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (definition.enumValues && !definition.enumValues.includes(value)) return false;
  return !definition.eligibility?.ineligibleValues?.includes(value);
}

/** Parses a strict date-only value to its UTC epoch day without local-time conversion. */
export function monitorDateOnlyUtcDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed.getTime() / 86_400_000;
}

function validRelativeDayCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
