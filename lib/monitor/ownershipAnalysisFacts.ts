export const OWNERSHIP_MONITOR_FACTS_VERSION = "ownership_monitor_facts_v1";

export type OwnershipValueQuality = "exact" | "derived" | "estimated" | "unknown";
export type OwnershipAvailability = "available" | "unavailable";
export type OwnershipFactConfidence = "high" | "medium" | "low" | null;

export type OwnershipNumericFact = {
  value: number | null;
  value_quality: OwnershipValueQuality;
  availability: OwnershipAvailability;
};

export type OwnershipReportingOwnerFact = {
  name: string | null;
  roles: string[];
  is_officer: boolean | null;
  is_director: boolean | null;
  is_10_percent_owner: boolean | null;
  officer_title: string | null;
  evidence: string[];
  confidence: OwnershipFactConfidence;
};

export type OwnershipForm4TransactionFact = {
  transaction_kind: "non_derivative" | "derivative" | null;
  security_title: string | null;
  transaction_date: string | null;
  transaction_code: string | null;
  acquired_disposed_code: "A" | "D" | null;
  economic_direction: "buy" | "sell" | "other" | "unknown";
  shares: OwnershipNumericFact;
  price_per_share: OwnershipNumericFact;
  post_transaction_shares: OwnershipNumericFact;
  direct_or_indirect_ownership: "D" | "I" | null;
  nature_of_ownership: string | null;
  is_10b5_1: boolean | null;
  evidence: string[];
  confidence: OwnershipFactConfidence;
};

export type OwnershipForm144ProposedSaleFact = {
  security_title: string | null;
  proposed_sale_shares: OwnershipNumericFact;
  aggregate_market_value: OwnershipNumericFact;
  proposed_sale_date: string | null;
  exchange: string | null;
  shares_outstanding: OwnershipNumericFact;
  percent_calculation: OwnershipForm144PercentCalculationDecision;
  evidence: string[];
  confidence: OwnershipFactConfidence;
};

export type OwnershipForm144PercentCalculationDecision = {
  comparable_units: boolean | null;
  numerator_unit: string | null;
  denominator_unit: string | null;
  normalization_target: "numerator" | "denominator" | null;
  normalization_multiplier: number | null;
  source_relation: string | null;
  evidence: string[];
  confidence: OwnershipFactConfidence;
};

export type OwnershipMonitorFacts = {
  version: typeof OWNERSHIP_MONITOR_FACTS_VERSION;
  form4: {
    reporting_owners: OwnershipReportingOwnerFact[];
    transactions: OwnershipForm4TransactionFact[];
  } | null;
  form144: {
    reporting_owners: OwnershipReportingOwnerFact[];
    proposed_sales: OwnershipForm144ProposedSaleFact[];
  } | null;
};

export function validateOwnershipMonitorFacts(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["analysis_output.ownership_monitor_facts must be an object"];
  if (root.version !== OWNERSHIP_MONITOR_FACTS_VERSION) {
    errors.push(`ownership_monitor_facts.version must be ${OWNERSHIP_MONITOR_FACTS_VERSION}`);
  }
  if (!("form4" in root) || !("form144" in root)) {
    errors.push("ownership_monitor_facts must include form4 and form144");
    return errors;
  }
  if (root.form4 === null && root.form144 === null) {
    errors.push("ownership_monitor_facts must identify the analyzed ownership form family");
  }
  if (root.form4 !== null && root.form144 !== null) {
    errors.push("ownership_monitor_facts must keep the non-current form family null");
  }
  if (root.form4 !== null) validateForm4(root.form4, errors);
  if (root.form144 !== null) validateForm144(root.form144, errors);
  return errors;
}

export function readOwnershipMonitorFacts(value: unknown): OwnershipMonitorFacts | null {
  return validateOwnershipMonitorFacts(value).length === 0 ? (value as OwnershipMonitorFacts) : null;
}

function validateForm4(value: unknown, errors: string[]) {
  const form4 = record(value);
  if (!form4) {
    errors.push("ownership_monitor_facts.form4 must be an object or null");
    return;
  }
  validateOwners(form4.reporting_owners, "form4.reporting_owners", errors);
  if (!Array.isArray(form4.transactions)) {
    errors.push("ownership_monitor_facts.form4.transactions must be an array");
    return;
  }
  form4.transactions.forEach((value, index) => validateForm4Transaction(value, index, errors));
}

function validateForm4Transaction(value: unknown, index: number, errors: string[]) {
  const path = `form4.transactions[${index}]`;
  const row = record(value);
  if (!row) {
    errors.push(`ownership_monitor_facts.${path} must be an object`);
    return;
  }
  if (!nullableOneOf(row.transaction_kind, ["non_derivative", "derivative"])) errors.push(`${path}.transaction_kind is invalid`);
  if (!nullableText(row.security_title)) errors.push(`${path}.security_title is invalid`);
  if (!nullableDate(row.transaction_date)) errors.push(`${path}.transaction_date is invalid`);
  if (!(row.transaction_code === null || (typeof row.transaction_code === "string" && /^[A-Z]$/.test(row.transaction_code)))) {
    errors.push(`${path}.transaction_code is invalid`);
  }
  if (!nullableOneOf(row.acquired_disposed_code, ["A", "D"])) errors.push(`${path}.acquired_disposed_code is invalid`);
  if (!oneOf(row.economic_direction, ["buy", "sell", "other", "unknown"])) errors.push(`${path}.economic_direction is invalid`);
  validateNumericFact(row.shares, `${path}.shares`, errors);
  validateNumericFact(row.price_per_share, `${path}.price_per_share`, errors);
  validateNumericFact(row.post_transaction_shares, `${path}.post_transaction_shares`, errors);
  if (!nullableOneOf(row.direct_or_indirect_ownership, ["D", "I"])) errors.push(`${path}.direct_or_indirect_ownership is invalid`);
  if (!nullableText(row.nature_of_ownership)) errors.push(`${path}.nature_of_ownership is invalid`);
  if (!(row.is_10b5_1 === null || typeof row.is_10b5_1 === "boolean")) errors.push(`${path}.is_10b5_1 is invalid`);
  validateEvidence(row.evidence, `${path}.evidence`, errors);
  validateConfidence(row.confidence, `${path}.confidence`, errors);
}

function validateForm144(value: unknown, errors: string[]) {
  const form144 = record(value);
  if (!form144) {
    errors.push("ownership_monitor_facts.form144 must be an object or null");
    return;
  }
  validateOwners(form144.reporting_owners, "form144.reporting_owners", errors);
  if (!Array.isArray(form144.proposed_sales)) {
    errors.push("ownership_monitor_facts.form144.proposed_sales must be an array");
    return;
  }
  form144.proposed_sales.forEach((value, index) => validateForm144Sale(value, index, errors));
}

function validateForm144Sale(value: unknown, index: number, errors: string[]) {
  const path = `form144.proposed_sales[${index}]`;
  const row = record(value);
  if (!row) {
    errors.push(`ownership_monitor_facts.${path} must be an object`);
    return;
  }
  if (!nullableText(row.security_title)) errors.push(`${path}.security_title is invalid`);
  validateNumericFact(row.proposed_sale_shares, `${path}.proposed_sale_shares`, errors);
  validateNumericFact(row.aggregate_market_value, `${path}.aggregate_market_value`, errors);
  if (!nullableDate(row.proposed_sale_date)) errors.push(`${path}.proposed_sale_date is invalid`);
  if (!nullableText(row.exchange)) errors.push(`${path}.exchange is invalid`);
  validateNumericFact(row.shares_outstanding, `${path}.shares_outstanding`, errors);
  validateForm144PercentCalculation(row.percent_calculation, `${path}.percent_calculation`, errors);
  validateEvidence(row.evidence, `${path}.evidence`, errors);
  validateConfidence(row.confidence, `${path}.confidence`, errors);
}

function validateForm144PercentCalculation(value: unknown, path: string, errors: string[]) {
  const decision = record(value);
  if (!decision) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!(decision.comparable_units === null || typeof decision.comparable_units === "boolean")) {
    errors.push(`${path}.comparable_units is invalid`);
  }
  if (!nullableText(decision.numerator_unit)) errors.push(`${path}.numerator_unit is invalid`);
  if (!nullableText(decision.denominator_unit)) errors.push(`${path}.denominator_unit is invalid`);
  if (!nullableOneOf(decision.normalization_target, ["numerator", "denominator"])) {
    errors.push(`${path}.normalization_target is invalid`);
  }
  const multiplier = decision.normalization_multiplier;
  if (!(multiplier === null || (typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0))) {
    errors.push(`${path}.normalization_multiplier is invalid`);
  }
  if (!nullableText(decision.source_relation)) errors.push(`${path}.source_relation is invalid`);
  validateEvidence(decision.evidence, `${path}.evidence`, errors);
  validateConfidence(decision.confidence, `${path}.confidence`, errors);

  if (decision.comparable_units !== true && (decision.normalization_target !== null || multiplier !== null)) {
    errors.push(`${path} cannot select normalization unless comparable_units is true`);
  }
  if (decision.normalization_target === null && multiplier !== null) {
    errors.push(`${path}.normalization_multiplier requires a normalization_target`);
  }
  if (decision.normalization_target !== null && multiplier === null) {
    errors.push(`${path}.normalization_target requires a normalization_multiplier`);
  }
  if (decision.normalization_target !== null && decision.source_relation === null) {
    errors.push(`${path}.normalization_target requires a source_relation`);
  }
  if (decision.normalization_target !== null && Array.isArray(decision.evidence) && decision.evidence.length === 0) {
    errors.push(`${path}.normalization_target requires source evidence`);
  }
}

function validateOwners(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`ownership_monitor_facts.${path} must be an array`);
    return;
  }
  value.forEach((ownerValue, index) => {
    const ownerPath = `${path}[${index}]`;
    const owner = record(ownerValue);
    if (!owner) {
      errors.push(`ownership_monitor_facts.${ownerPath} must be an object`);
      return;
    }
    if (!nullableText(owner.name)) errors.push(`${ownerPath}.name is invalid`);
    if (!Array.isArray(owner.roles) || owner.roles.some((role) => typeof role !== "string" || !role.trim())) {
      errors.push(`${ownerPath}.roles must contain non-empty strings`);
    }
    for (const key of ["is_officer", "is_director", "is_10_percent_owner"] as const) {
      if (!(owner[key] === null || typeof owner[key] === "boolean")) errors.push(`${ownerPath}.${key} is invalid`);
    }
    if (!nullableText(owner.officer_title)) errors.push(`${ownerPath}.officer_title is invalid`);
    validateEvidence(owner.evidence, `${ownerPath}.evidence`, errors);
    validateConfidence(owner.confidence, `${ownerPath}.confidence`, errors);
  });
}

function validateNumericFact(value: unknown, path: string, errors: string[]) {
  const fact = record(value);
  if (!fact) {
    errors.push(`${path} must be a numeric fact object`);
    return;
  }
  const numeric = typeof fact.value === "number" && Number.isFinite(fact.value) && fact.value >= 0;
  if (!oneOf(fact.value_quality, ["exact", "derived", "estimated", "unknown"])) errors.push(`${path}.value_quality is invalid`);
  if (!oneOf(fact.availability, ["available", "unavailable"])) errors.push(`${path}.availability is invalid`);
  if (fact.availability === "available" && !numeric) errors.push(`${path} available facts require a nonnegative numeric value`);
  if (fact.availability === "unavailable" && (fact.value !== null || fact.value_quality !== "unknown")) {
    errors.push(`${path} unavailable facts require null value and unknown quality`);
  }
}

function validateEvidence(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${path} must contain non-empty strings`);
  }
}

function validateConfidence(value: unknown, path: string, errors: string[]) {
  if (!(value === null || oneOf(value, ["high", "medium", "low"]))) errors.push(`${path} is invalid`);
}

function nullableText(value: unknown) {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function nullableDate(value: unknown) {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nullableOneOf(value: unknown, allowed: readonly string[]) {
  return value === null || oneOf(value, allowed);
}

function oneOf(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const nullableTextSchema = { type: ["string", "null"] } as const;
const confidenceSchema = { type: ["string", "null"], enum: ["high", "medium", "low", null] } as const;
const numericFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "value_quality", "availability"],
  properties: {
    value: { type: ["number", "null"], minimum: 0 },
    value_quality: { type: "string", enum: ["exact", "derived", "estimated", "unknown"] },
    availability: { type: "string", enum: ["available", "unavailable"] },
  },
} as const;
const ownerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "roles", "is_officer", "is_director", "is_10_percent_owner", "officer_title", "evidence", "confidence"],
  properties: {
    name: nullableTextSchema,
    roles: { type: "array", items: { type: "string" } },
    is_officer: { type: ["boolean", "null"] },
    is_director: { type: ["boolean", "null"] },
    is_10_percent_owner: { type: ["boolean", "null"] },
    officer_title: nullableTextSchema,
    evidence: { type: "array", items: { type: "string" } },
    confidence: confidenceSchema,
  },
} as const;
const form144PercentCalculationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "comparable_units", "numerator_unit", "denominator_unit", "normalization_target",
    "normalization_multiplier", "source_relation", "evidence", "confidence",
  ],
  properties: {
    comparable_units: { type: ["boolean", "null"] },
    numerator_unit: nullableTextSchema,
    denominator_unit: nullableTextSchema,
    normalization_target: { type: ["string", "null"], enum: ["numerator", "denominator", null] },
    normalization_multiplier: { type: ["number", "null"], exclusiveMinimum: 0 },
    source_relation: nullableTextSchema,
    evidence: { type: "array", items: { type: "string" } },
    confidence: confidenceSchema,
  },
} as const;

export const OWNERSHIP_MONITOR_FACTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "form4", "form144"],
  properties: {
    version: { type: "string", enum: [OWNERSHIP_MONITOR_FACTS_VERSION] },
    form4: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["reporting_owners", "transactions"],
      properties: {
        reporting_owners: { type: "array", items: ownerSchema },
        transactions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "transaction_kind", "security_title", "transaction_date", "transaction_code",
              "acquired_disposed_code", "economic_direction", "shares", "price_per_share",
              "post_transaction_shares", "direct_or_indirect_ownership", "nature_of_ownership",
              "is_10b5_1", "evidence", "confidence",
            ],
            properties: {
              transaction_kind: { type: ["string", "null"], enum: ["non_derivative", "derivative", null] },
              security_title: nullableTextSchema,
              transaction_date: nullableTextSchema,
              transaction_code: nullableTextSchema,
              acquired_disposed_code: { type: ["string", "null"], enum: ["A", "D", null] },
              economic_direction: { type: "string", enum: ["buy", "sell", "other", "unknown"] },
              shares: numericFactSchema,
              price_per_share: numericFactSchema,
              post_transaction_shares: numericFactSchema,
              direct_or_indirect_ownership: { type: ["string", "null"], enum: ["D", "I", null] },
              nature_of_ownership: nullableTextSchema,
              is_10b5_1: { type: ["boolean", "null"] },
              evidence: { type: "array", items: { type: "string" } },
              confidence: confidenceSchema,
            },
          },
        },
      },
    },
    form144: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["reporting_owners", "proposed_sales"],
      properties: {
        reporting_owners: { type: "array", items: ownerSchema },
        proposed_sales: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "security_title", "proposed_sale_shares", "aggregate_market_value",
              "proposed_sale_date", "exchange", "shares_outstanding", "percent_calculation",
              "evidence", "confidence",
            ],
            properties: {
              security_title: nullableTextSchema,
              proposed_sale_shares: numericFactSchema,
              aggregate_market_value: numericFactSchema,
              proposed_sale_date: nullableTextSchema,
              exchange: nullableTextSchema,
              shares_outstanding: numericFactSchema,
              percent_calculation: form144PercentCalculationSchema,
              evidence: { type: "array", items: { type: "string" } },
              confidence: confidenceSchema,
            },
          },
        },
      },
    },
  },
} as const;
