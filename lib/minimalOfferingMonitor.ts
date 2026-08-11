type JsonRecord = Record<string, unknown>;

export const MINIMAL_OFFERING_MONITOR_VERSION = "minimal_offering_monitor_v1" as const;

export const MINIMAL_OFFERING_FACT_KEYS = [
  "actual_primary_offering_amount",
  "offering_price",
  "immediate_primary_share_exposure",
  "additional_potential_primary_share_exposure",
  "resale_share_exposure",
] as const;

export type MinimalOfferingFactKey = (typeof MINIMAL_OFFERING_FACT_KEYS)[number];
export type MinimalOfferingValueQuality = "exact" | "derived" | "estimated" | "unknown";
export type MinimalOfferingBound = "exact" | "maximum" | "minimum" | "unknown";
export type MinimalOfferingComparisonBasis =
  | "shares_outstanding"
  | "public_float"
  | "market_cap"
  | "market_price"
  | "none"
  | "unknown";

export type MinimalOfferingNumericFact = {
  value: number | null;
  availability: "available" | "unavailable";
  value_quality: MinimalOfferingValueQuality;
  bound: MinimalOfferingBound;
  unit: "currency" | "currency_per_security" | "shares" | "other" | "unknown";
  currency: string | null;
  security_basis: string | null;
  comparison_basis_type: MinimalOfferingComparisonBasis;
  comparable_to_event_market_basis: boolean | null;
  source_ref: string | null;
};

export type MinimalOfferingMonitor = {
  version: typeof MINIMAL_OFFERING_MONITOR_VERSION;
  applicability: "applicable" | "not_applicable";
  financing_stage: "registration_only" | "active_offering" | "priced" | "closed" | "unknown";
  primary_or_resale: "primary" | "resale" | "mixed" | "not_applicable" | "unknown";
  security_nature: "equity" | "equity_linked" | "debt" | "mixed" | "non_equity" | "unknown";
  has_warrant: boolean | null;
  has_prefunded_warrant: boolean | null;
  has_convertible: boolean | null;
  facts: Record<MinimalOfferingFactKey, MinimalOfferingNumericFact>;
};

export type MinimalOfferingMonitorProvenance = {
  version: typeof MINIMAL_OFFERING_MONITOR_VERSION;
  status: "success" | "not_applicable" | "transport_failed" | "validation_failed";
  errors: string[];
};

export type MinimalOfferingMarketSnapshot = {
  price: number | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  public_float: number | null;
  currency: string | null;
  security_basis: string | null;
  price_unit: string | null;
  market_cap_unit: string | null;
  share_unit: string | null;
  as_of: string | null;
};

export type MinimalOfferingDerivedMetric = {
  availability: "available" | "unavailable";
  value: number | null;
  value_quality: "derived" | "unknown";
  bound: MinimalOfferingBound;
  unit: "percent";
  formula: string;
  source_fact: string;
  market_input: string;
  unavailable_reason: string | null;
};

export type MinimalOfferingMaterialized = MinimalOfferingMonitor & {
  total_potential_primary_share_exposure: MinimalOfferingNumericFact;
  derived_metrics: {
    immediate_primary_dilution_percent: MinimalOfferingDerivedMetric;
    total_potential_primary_dilution_percent: MinimalOfferingDerivedMetric;
    resale_overhang_percent: MinimalOfferingDerivedMetric;
    actual_primary_offering_amount_percent_of_market_cap: MinimalOfferingDerivedMetric;
    offering_discount_to_market_percent: MinimalOfferingDerivedMetric;
  };
  safe_projection: JsonRecord;
};

const factProviderSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: [
    "value",
    "availability",
    "value_quality",
    "bound",
    "unit",
    "currency",
    "security_basis",
    "comparison_basis_type",
    "comparable_to_event_market_basis",
    "source_ref",
  ],
  properties: {
    value: { type: ["number", "null"] },
    availability: { type: "string", enum: ["available", "unavailable"] },
    value_quality: { type: "string", enum: ["exact", "derived", "estimated", "unknown"] },
    bound: { type: "string", enum: ["exact", "maximum", "minimum", "unknown"] },
    unit: { type: "string", enum: ["currency", "currency_per_security", "shares", "other", "unknown"] },
    currency: { type: ["string", "null"] },
    security_basis: { type: ["string", "null"] },
    comparison_basis_type: {
      type: "string",
      enum: ["shares_outstanding", "public_float", "market_cap", "market_price", "none", "unknown"],
    },
    comparable_to_event_market_basis: { type: ["boolean", "null"] },
    source_ref: { type: ["string", "null"] },
  },
});

export const minimalOfferingMonitorProviderSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "applicability",
    "financing_stage",
    "primary_or_resale",
    "security_nature",
    "has_warrant",
    "has_prefunded_warrant",
    "has_convertible",
    "facts",
  ],
  properties: {
    version: { type: "string", enum: [MINIMAL_OFFERING_MONITOR_VERSION] },
    applicability: { type: "string", enum: ["applicable", "not_applicable"] },
    financing_stage: {
      type: "string",
      enum: ["registration_only", "active_offering", "priced", "closed", "unknown"],
    },
    primary_or_resale: {
      type: "string",
      enum: ["primary", "resale", "mixed", "not_applicable", "unknown"],
    },
    security_nature: {
      type: "string",
      enum: ["equity", "equity_linked", "debt", "mixed", "non_equity", "unknown"],
    },
    has_warrant: { type: ["boolean", "null"] },
    has_prefunded_warrant: { type: ["boolean", "null"] },
    has_convertible: { type: ["boolean", "null"] },
    facts: {
      type: "object",
      additionalProperties: false,
      required: [...MINIMAL_OFFERING_FACT_KEYS],
      properties: Object.fromEntries(MINIMAL_OFFERING_FACT_KEYS.map((key) => [key, factProviderSchema()])),
    },
  },
} as const;

export const MINIMAL_OFFERING_MONITOR_PROMPT = [
  `Add analysis_output.offering_monitor using version ${MINIMAL_OFFERING_MONITOR_VERSION}. This is additive only: do not change or copy it into title, quick_take, summary, score, signal, event_type, display_payload, routing, archive, or alerts.`,
  "The Analysis LLM, using SEC source blocks rather than parser semantics, is the final judge of financing stage, primary/resale meaning, security nature, distinct exposure, amount/price meaning, quality, bound, basis, and comparability.",
  "applicability is applicable or source-backed not_applicable. A generation/schema/validation failure is never not_applicable. financing_stage is registration_only, active_offering, priced, closed, or unknown. primary_or_resale is primary, resale, mixed, not_applicable, or unknown. security_nature is equity, equity_linked, debt, mixed, non_equity, or unknown.",
  "Return exactly five named facts: actual_primary_offering_amount, offering_price, immediate_primary_share_exposure, additional_potential_primary_share_exposure, resale_share_exposure. Do not return total potential exposure; code adds immediate plus additional only when compatible.",
  "actual_primary_offering_amount means issuer gross transaction amount from primary securities in this transaction. Never use shelf capacity, selling-holder resale value/proceeds, or amount remaining; for mixed transactions use only the issuer primary portion. Preserve up-to as bound=maximum.",
  "immediate_primary_share_exposure is the deduplicated immediate primary share-equivalent pool. additional_potential_primary_share_exposure excludes everything already in immediate. A share/unit versus pre-funded alternative pool is counted once; a distinct common-warrant or other conditional pool belongs in additional.",
  "Every fact contains value, availability, value_quality, bound, unit, currency, security_basis, comparison_basis_type, comparable_to_event_market_basis, and one short source_ref. availability is available/unavailable; quality is exact/derived/estimated/unknown; bound is exact/maximum/minimum/unknown. Preserve actual zero and available+unknown values; unavailable means value=null, never zero.",
  "Use unit currency, currency_per_security, shares, other, or unknown. Use comparison basis market_cap for actual amount, market_price for offering price, shares_outstanding for immediate/additional exposure, and public_float for resale exposure when that is the source-backed comparison. Use the exact event market_context currency and security_basis only when truly comparable; otherwise set comparable_to_event_market_basis false or null.",
  "For a source-backed non-equity not_applicable filing, keep all five facts unavailable/null and do not invent equity amounts, prices, or share exposure. Do not add components, groups, calculation inputs, row sets, repeated evidence, or confidence objects.",
].join("\n");

export function applyMinimalOfferingMonitorBoundary(analysisOutput: JsonRecord) {
  const boundary = resolveMinimalOfferingMonitorBoundary(analysisOutput.offering_monitor);
  if (boundary.value) analysisOutput.offering_monitor = boundary.value;
  else delete analysisOutput.offering_monitor;
  analysisOutput.offering_monitor_provenance = boundary.provenance;
  return boundary;
}

export function resolveMinimalOfferingMonitorBoundary(value: unknown): {
  value: MinimalOfferingMonitor | null;
  provenance: MinimalOfferingMonitorProvenance;
} {
  if (!recordValue(value)) {
    return {
      value: null,
      provenance: provenance("transport_failed", ["offering_monitor must be an object"]),
    };
  }
  const validation = validateMinimalOfferingMonitor(value);
  if (!validation.ok) {
    return { value: null, provenance: provenance("validation_failed", validation.errors) };
  }
  return {
    value: validation.value,
    provenance: provenance(validation.value.applicability === "not_applicable" ? "not_applicable" : "success", []),
  };
}

export function validateMinimalOfferingMonitor(value: unknown):
  | { ok: true; value: MinimalOfferingMonitor; errors: [] }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const root = recordValue(value);
  if (!root) return { ok: false, errors: ["offering_monitor must be an object"] };
  validateKnownKeys(root, [
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature",
    "has_warrant", "has_prefunded_warrant", "has_convertible", "facts",
  ], "offering_monitor", errors);
  requireEnum(root.version, [MINIMAL_OFFERING_MONITOR_VERSION], "version", errors);
  requireEnum(root.applicability, ["applicable", "not_applicable"], "applicability", errors);
  requireEnum(root.financing_stage, ["registration_only", "active_offering", "priced", "closed", "unknown"], "financing_stage", errors);
  requireEnum(root.primary_or_resale, ["primary", "resale", "mixed", "not_applicable", "unknown"], "primary_or_resale", errors);
  requireEnum(root.security_nature, ["equity", "equity_linked", "debt", "mixed", "non_equity", "unknown"], "security_nature", errors);
  for (const key of ["has_warrant", "has_prefunded_warrant", "has_convertible"] as const) {
    if (root[key] !== null && typeof root[key] !== "boolean") errors.push(`${key} must be boolean or null`);
  }
  const facts = recordValue(root.facts);
  if (!facts) errors.push("facts must be an object");
  else {
    validateKnownKeys(facts, [...MINIMAL_OFFERING_FACT_KEYS], "facts", errors);
    for (const key of MINIMAL_OFFERING_FACT_KEYS) validateFact(facts[key], `facts.${key}`, errors);
  }
  if (root.applicability === "not_applicable" && facts) {
    for (const key of MINIMAL_OFFERING_FACT_KEYS) {
      const fact = recordValue(facts[key]);
      if (fact?.availability !== "unavailable" || fact.value !== null) {
        errors.push(`facts.${key} must be unavailable/null when not_applicable`);
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: root as MinimalOfferingMonitor, errors: [] };
}

export function materializeMinimalOfferingMonitor(
  monitor: MinimalOfferingMonitor,
  snapshot: MinimalOfferingMarketSnapshot,
): MinimalOfferingMaterialized {
  const total = totalPotentialFact(
    monitor.facts.immediate_primary_share_exposure,
    monitor.facts.additional_potential_primary_share_exposure,
  );
  const derived = {
    immediate_primary_dilution_percent: ratioMetric({
      fact: monitor.facts.immediate_primary_share_exposure,
      expectedBasis: "shares_outstanding",
      denominator: snapshot.shares_outstanding,
      denominatorUnit: snapshot.share_unit,
      snapshot,
      formula: "immediate_primary_share_exposure / shares_outstanding * 100",
      sourceFact: "immediate_primary_share_exposure",
      marketInput: "shares_outstanding",
    }),
    total_potential_primary_dilution_percent: ratioMetric({
      fact: total,
      expectedBasis: "shares_outstanding",
      denominator: snapshot.shares_outstanding,
      denominatorUnit: snapshot.share_unit,
      snapshot,
      formula: "(immediate_primary_share_exposure + additional_potential_primary_share_exposure) / shares_outstanding * 100",
      sourceFact: "immediate_primary_share_exposure + additional_potential_primary_share_exposure",
      marketInput: "shares_outstanding",
    }),
    resale_overhang_percent: ratioMetric({
      fact: monitor.facts.resale_share_exposure,
      expectedBasis: "public_float",
      denominator: snapshot.public_float,
      denominatorUnit: snapshot.share_unit,
      snapshot,
      formula: "resale_share_exposure / public_float * 100",
      sourceFact: "resale_share_exposure",
      marketInput: "public_float",
    }),
    actual_primary_offering_amount_percent_of_market_cap: ratioMetric({
      fact: monitor.facts.actual_primary_offering_amount,
      expectedBasis: "market_cap",
      denominator: snapshot.market_cap,
      denominatorUnit: snapshot.market_cap_unit,
      snapshot,
      formula: "actual_primary_offering_amount / market_cap * 100",
      sourceFact: "actual_primary_offering_amount",
      marketInput: "market_cap",
    }),
    offering_discount_to_market_percent: discountMetric(monitor.facts.offering_price, snapshot),
  };
  const materialized = {
    ...clone(monitor),
    total_potential_primary_share_exposure: total,
    derived_metrics: derived,
    safe_projection: {},
  } satisfies MinimalOfferingMaterialized;
  materialized.safe_projection = buildSafeProjection(materialized);
  return materialized;
}

export function buildMinimalOfferingMarketSnapshot(value: unknown): MinimalOfferingMarketSnapshot {
  const market = recordValue(value) || {};
  return {
    price: finiteNumber(market.price),
    market_cap: finiteNumber(market.market_cap),
    shares_outstanding: finiteNumber(market.shares_outstanding),
    public_float: finiteNumber(market.public_float),
    currency: nullableString(market.currency),
    security_basis: nullableString(market.security_basis),
    price_unit: nullableString(market.price_unit),
    market_cap_unit: nullableString(market.market_cap_unit),
    share_unit: nullableString(market.share_unit),
    as_of: nullableString(market.as_of),
  };
}

export function prepareMinimalOfferingMonitorPersistence({
  analysisOutput,
  provenance: provenanceInput,
  existingMetadata,
  marketSnapshot,
}: {
  analysisOutput: unknown;
  provenance: unknown;
  existingMetadata: unknown;
  marketSnapshot: MinimalOfferingMarketSnapshot;
}) {
  const metadata = { ...(recordValue(existingMetadata) || {}) };
  const supplied = readProvenance(provenanceInput);
  const validation = validateMinimalOfferingMonitor(analysisOutput);
  if (!validation.ok) {
    const failure = supplied && ["transport_failed", "validation_failed"].includes(supplied.status)
      ? supplied
      : provenance(recordValue(analysisOutput) ? "validation_failed" : "transport_failed", validation.errors);
    metadata.offering_monitor_provenance = failure;
    return { status: failure.status, metadata, errors: failure.errors };
  }
  const materialized = materializeMinimalOfferingMonitor(validation.value, marketSnapshot);
  const status = materialized.applicability === "not_applicable" ? "not_applicable" : "success";
  metadata.offering_monitor = materialized;
  metadata.offering_monitor_provenance = provenance(status, []);
  return { status, metadata, errors: [] };
}

function validateFact(value: unknown, path: string, errors: string[]) {
  const fact = recordValue(value);
  if (!fact) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateKnownKeys(fact, [
    "value", "availability", "value_quality", "bound", "unit", "currency", "security_basis",
    "comparison_basis_type", "comparable_to_event_market_basis", "source_ref",
  ], path, errors);
  requireEnum(fact.availability, ["available", "unavailable"], `${path}.availability`, errors);
  requireEnum(fact.value_quality, ["exact", "derived", "estimated", "unknown"], `${path}.value_quality`, errors);
  requireEnum(fact.bound, ["exact", "maximum", "minimum", "unknown"], `${path}.bound`, errors);
  requireEnum(fact.unit, ["currency", "currency_per_security", "shares", "other", "unknown"], `${path}.unit`, errors);
  requireEnum(fact.comparison_basis_type, ["shares_outstanding", "public_float", "market_cap", "market_price", "none", "unknown"], `${path}.comparison_basis_type`, errors);
  if (fact.comparable_to_event_market_basis !== null && typeof fact.comparable_to_event_market_basis !== "boolean") {
    errors.push(`${path}.comparable_to_event_market_basis must be boolean or null`);
  }
  for (const key of ["currency", "security_basis", "source_ref"] as const) {
    if (fact[key] !== null && typeof fact[key] !== "string") errors.push(`${path}.${key} must be string or null`);
  }
  const number = finiteNumber(fact.value);
  if (fact.availability === "available") {
    if (number === null || number < 0) errors.push(`${path}.value must be a non-negative finite number when available`);
    if (!nullableString(fact.security_basis)) errors.push(`${path}.security_basis is required when available`);
    if (["currency", "currency_per_security"].includes(String(fact.unit)) && !nullableString(fact.currency)) {
      errors.push(`${path}.currency is required for currency facts`);
    }
  } else if (fact.value !== null) {
    errors.push(`${path}.value must be null when unavailable`);
  }
  if ((fact.source_ref as string | null)?.length && String(fact.source_ref).length > 160) {
    errors.push(`${path}.source_ref must be 160 characters or fewer`);
  }
}

function totalPotentialFact(immediate: MinimalOfferingNumericFact, additional: MinimalOfferingNumericFact): MinimalOfferingNumericFact {
  const unavailable = unavailableFact("shares_outstanding");
  const firstReason = factEligibilityReason(immediate);
  const secondReason = factEligibilityReason(additional);
  if (firstReason || secondReason) return unavailable;
  if (
    immediate.unit !== additional.unit ||
    normalizeToken(immediate.currency) !== normalizeToken(additional.currency) ||
    normalizeToken(immediate.security_basis) !== normalizeToken(additional.security_basis) ||
    immediate.comparison_basis_type !== additional.comparison_basis_type
  ) return unavailable;
  return {
    value: (immediate.value as number) + (additional.value as number),
    availability: "available",
    value_quality: combineQuality(immediate.value_quality, additional.value_quality),
    bound: combineBounds(immediate.bound, additional.bound),
    unit: immediate.unit,
    currency: immediate.currency,
    security_basis: immediate.security_basis,
    comparison_basis_type: immediate.comparison_basis_type,
    comparable_to_event_market_basis:
      immediate.comparable_to_event_market_basis === true && additional.comparable_to_event_market_basis === true,
    source_ref: [immediate.source_ref, additional.source_ref].filter(Boolean).join(" + ").slice(0, 160) || null,
  };
}

function ratioMetric({ fact, expectedBasis, denominator, denominatorUnit, snapshot, formula, sourceFact, marketInput }: {
  fact: MinimalOfferingNumericFact;
  expectedBasis: MinimalOfferingComparisonBasis;
  denominator: number | null;
  denominatorUnit: string | null;
  snapshot: MinimalOfferingMarketSnapshot;
  formula: string;
  sourceFact: string;
  marketInput: string;
}): MinimalOfferingDerivedMetric {
  const reason = comparisonReason(fact, expectedBasis, denominator, denominatorUnit, snapshot);
  if (reason) return unavailableMetric(formula, sourceFact, marketInput, reason);
  return availableMetric(((fact.value as number) / (denominator as number)) * 100, fact.bound, formula, sourceFact, marketInput);
}

function discountMetric(fact: MinimalOfferingNumericFact, snapshot: MinimalOfferingMarketSnapshot): MinimalOfferingDerivedMetric {
  const formula = "(market_price - offering_price) / market_price * 100";
  const reason = comparisonReason(fact, "market_price", snapshot.price, snapshot.price_unit, snapshot);
  if (reason) return unavailableMetric(formula, "offering_price", "price", reason);
  return availableMetric(
    (((snapshot.price as number) - (fact.value as number)) / (snapshot.price as number)) * 100,
    invertBound(fact.bound),
    formula,
    "offering_price",
    "price",
  );
}

function comparisonReason(
  fact: MinimalOfferingNumericFact,
  expectedBasis: MinimalOfferingComparisonBasis,
  denominator: number | null,
  denominatorUnit: string | null,
  snapshot: MinimalOfferingMarketSnapshot,
) {
  const eligibility = factEligibilityReason(fact);
  if (eligibility) return eligibility;
  if (fact.comparable_to_event_market_basis !== true) return "fact_not_comparable";
  if (fact.comparison_basis_type !== expectedBasis) return "comparison_basis_mismatch";
  if (denominator === null || denominator <= 0) return "snapshot_value_unavailable";
  if (!denominatorUnit || fact.unit !== denominatorUnit) return "unit_mismatch";
  if (["currency", "currency_per_security"].includes(fact.unit) && normalizeToken(fact.currency) !== normalizeToken(snapshot.currency)) {
    return "currency_mismatch";
  }
  if (!snapshot.security_basis || normalizeToken(fact.security_basis) !== normalizeToken(snapshot.security_basis)) {
    return "security_basis_mismatch";
  }
  return null;
}

function factEligibilityReason(fact: MinimalOfferingNumericFact) {
  if (fact.availability !== "available" || fact.value === null) return "fact_unavailable";
  if (fact.value_quality === "unknown") return "fact_quality_unknown";
  return null;
}

function buildSafeProjection(value: Omit<MinimalOfferingMaterialized, "safe_projection"> | MinimalOfferingMaterialized) {
  if (value.applicability !== "applicable") return {};
  const projection: JsonRecord = {
    financing_stage: value.financing_stage,
    primary_or_resale: value.primary_or_resale,
    security_nature: value.security_nature,
    has_warrant: value.has_warrant,
    has_prefunded_warrant: value.has_prefunded_warrant,
    has_convertible: value.has_convertible,
  };
  for (const key of MINIMAL_OFFERING_FACT_KEYS) {
    const fact = value.facts[key];
    if (!factEligibilityReason(fact)) projection[key] = fact.value;
  }
  const total = value.total_potential_primary_share_exposure;
  if (!factEligibilityReason(total)) projection.total_potential_primary_share_exposure = total.value;
  for (const [key, metric] of Object.entries(value.derived_metrics)) {
    if (metric.availability === "available") projection[key] = metric.value;
  }
  return projection;
}

function unavailableFact(comparison: MinimalOfferingComparisonBasis): MinimalOfferingNumericFact {
  return {
    value: null, availability: "unavailable", value_quality: "unknown", bound: "unknown", unit: "shares",
    currency: null, security_basis: null, comparison_basis_type: comparison,
    comparable_to_event_market_basis: null, source_ref: null,
  };
}

function availableMetric(value: number, bound: MinimalOfferingBound, formula: string, sourceFact: string, marketInput: string): MinimalOfferingDerivedMetric {
  return { availability: "available", value, value_quality: "derived", bound, unit: "percent", formula, source_fact: sourceFact, market_input: marketInput, unavailable_reason: null };
}

function unavailableMetric(formula: string, sourceFact: string, marketInput: string, reason: string): MinimalOfferingDerivedMetric {
  return { availability: "unavailable", value: null, value_quality: "unknown", bound: "unknown", unit: "percent", formula, source_fact: sourceFact, market_input: marketInput, unavailable_reason: reason };
}

function combineQuality(left: MinimalOfferingValueQuality, right: MinimalOfferingValueQuality): MinimalOfferingValueQuality {
  if (left === "unknown" || right === "unknown") return "unknown";
  if (left === "estimated" || right === "estimated") return "estimated";
  if (left === "derived" || right === "derived") return "derived";
  return "exact";
}

function combineBounds(left: MinimalOfferingBound, right: MinimalOfferingBound): MinimalOfferingBound {
  if (left === right) return left;
  if (left === "unknown" || right === "unknown") return "unknown";
  if (left === "exact") return right;
  if (right === "exact") return left;
  return "unknown";
}

function invertBound(value: MinimalOfferingBound): MinimalOfferingBound {
  if (value === "maximum") return "minimum";
  if (value === "minimum") return "maximum";
  return value;
}

function provenance(status: MinimalOfferingMonitorProvenance["status"], errors: string[]): MinimalOfferingMonitorProvenance {
  return { version: MINIMAL_OFFERING_MONITOR_VERSION, status, errors: errors.slice(0, 12) };
}

function readProvenance(value: unknown): MinimalOfferingMonitorProvenance | null {
  const record = recordValue(value);
  const status = String(record?.status || "") as MinimalOfferingMonitorProvenance["status"];
  if (!record || !["success", "not_applicable", "transport_failed", "validation_failed"].includes(status)) return null;
  return provenance(status, Array.isArray(record.errors) ? record.errors.filter((item): item is string => typeof item === "string") : []);
}

function validateKnownKeys(value: JsonRecord, keys: string[], path: string, errors: string[]) {
  const allowed = new Set(keys);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) errors.push(`${path} has unsupported field(s): ${extra.join(", ")}`);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
}

function requireEnum(value: unknown, allowed: readonly string[], path: string, errors: string[]) {
  if (typeof value !== "string" || !allowed.includes(value)) errors.push(`${path} is invalid`);
}

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeToken(value: unknown) {
  return nullableString(value)?.toLowerCase().replace(/[\s-]+/g, "_") || "";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
