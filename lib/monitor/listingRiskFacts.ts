/**
 * Listing Risk V1 is an event-fact contract. It describes listing facts newly
 * established by one event; it is not an authoritative current-listing-state
 * snapshot and it does not reduce a lifecycle across events.
 *
 * Parsers may supply source identity, raw dates, rule text, security text, and
 * evidence. Analysis owns event classification, outcome, normalized free-form
 * security basis, proceeding semantics, requirement meaning, and the boundary
 * between adverse and procedural events.
 * This module only validates the resulting shape mechanically.
 */

export const LISTING_RISK_EVENT_FACTS_VERSION = "listing_risk_event_facts_v1";
export const LISTING_SOURCE_EVIDENCE_MAX_LENGTH = 520;

export const LISTING_EVENT_KINDS = [
  "deficiency_notice",
  "compliance_recovery",
  "delisting_determination",
  "hearing_or_appeal_update",
  "trading_suspension",
  "listing_removal",
  "voluntary_withdrawal",
  "other",
] as const;

export const LISTING_EVENT_OUTCOMES = ["adverse", "recovered", "procedural", "unknown"] as const;
export const LISTING_VALUE_QUALITIES = ["exact", "derived", "estimated", "unknown"] as const;
export const LISTING_AVAILABILITIES = ["available", "unavailable"] as const;
export const LISTING_DATE_STATUSES = ["occurred", "scheduled", "conditional", "unknown"] as const;
export const LISTING_PROCEEDING_KINDS = ["hearing", "appeal", "other", "unknown"] as const;
export const LISTING_PROCEEDING_STATUSES = [
  "intended",
  "requested",
  "pending",
  "decided",
  "not_pursued",
  "unknown",
] as const;
export const LISTING_SOURCE_FAMILIES = ["sec", "nasdaq", "news", "other"] as const;
export const LISTING_FACT_CONFIDENCES = ["high", "medium", "low"] as const;

export type ListingEventKind = (typeof LISTING_EVENT_KINDS)[number];
export type ListingEventOutcome = (typeof LISTING_EVENT_OUTCOMES)[number];
export type ListingValueQuality = (typeof LISTING_VALUE_QUALITIES)[number];
export type ListingAvailability = (typeof LISTING_AVAILABILITIES)[number];
export type ListingDateStatus = (typeof LISTING_DATE_STATUSES)[number];
export type ListingProceedingKind = (typeof LISTING_PROCEEDING_KINDS)[number];
export type ListingProceedingStatus = (typeof LISTING_PROCEEDING_STATUSES)[number];
export type ListingSourceFamily = (typeof LISTING_SOURCE_FAMILIES)[number];
export type ListingFactConfidence = (typeof LISTING_FACT_CONFIDENCES)[number] | null;

export type ListingTextFact = {
  value: string | null;
  availability: ListingAvailability;
  value_quality: ListingValueQuality;
  source_ref: string | null;
};

export type ListingBooleanFact = {
  value: boolean | null;
  availability: ListingAvailability;
  value_quality: ListingValueQuality;
  source_ref: string | null;
};

export type ListingDateFact = {
  value: string | null;
  availability: ListingAvailability;
  value_quality: ListingValueQuality;
  date_status: ListingDateStatus;
  source_ref: string | null;
};

export type ListingSourceEvidence = {
  source_family: ListingSourceFamily;
  source_id: string | null;
  source_url: string | null;
  source_ref: string;
  evidence: string;
};

export type ListingRiskEventFacts = {
  version: typeof LISTING_RISK_EVENT_FACTS_VERSION;
  classification: {
    event_kind: ListingEventKind;
    event_outcome: ListingEventOutcome;
    source_ref: string;
  };
  exchange: ListingTextFact;
  affected_security: {
    title: ListingTextFact;
    ticker: ListingTextFact;
    security_basis: ListingTextFact;
  };
  listing_rule: ListingTextFact;
  listing_requirement: ListingTextFact;
  compliance_period: ListingTextFact;
  proceeding: {
    kind: ListingProceedingKind;
    status: ListingProceedingStatus;
    source_ref: string | null;
  };
  dates: {
    notice_date: ListingDateFact;
    compliance_deadline: ListingDateFact;
    hearing_date: ListingDateFact;
    appeal_deadline: ListingDateFact;
    trading_suspension_date: ListingDateFact;
    removal_effective_date: ListingDateFact;
  };
  continued_trading: {
    continues: ListingBooleanFact;
    venue: ListingTextFact;
  };
  as_of: ListingDateFact;
  confidence: ListingFactConfidence;
  sources: ListingSourceEvidence[];
};

export function validateListingRiskEventFacts(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_event_facts must be an object"];

  exactKeys(root, [
    "version",
    "classification",
    "exchange",
    "affected_security",
    "listing_rule",
    "listing_requirement",
    "compliance_period",
    "proceeding",
    "dates",
    "continued_trading",
    "as_of",
    "confidence",
    "sources",
  ], "listing_risk_event_facts", errors);

  if (root.version !== LISTING_RISK_EVENT_FACTS_VERSION) {
    errors.push(`listing_risk_event_facts.version must be ${LISTING_RISK_EVENT_FACTS_VERSION}`);
  }

  const sourceRefs = validateSources(root.sources, errors);
  validateClassification(root.classification, sourceRefs, errors);
  validateTextFact(root.exchange, "exchange", sourceRefs, errors);

  const security = objectAt(root.affected_security, "affected_security", errors);
  if (security) {
    exactKeys(security, ["title", "ticker", "security_basis"], "affected_security", errors);
    validateTextFact(security.title, "affected_security.title", sourceRefs, errors);
    validateTextFact(security.ticker, "affected_security.ticker", sourceRefs, errors);
    validateTextFact(security.security_basis, "affected_security.security_basis", sourceRefs, errors);
  }

  validateTextFact(root.listing_rule, "listing_rule", sourceRefs, errors);
  validateTextFact(root.listing_requirement, "listing_requirement", sourceRefs, errors);
  validateTextFact(root.compliance_period, "compliance_period", sourceRefs, errors);
  validateProceeding(root.proceeding, sourceRefs, errors);

  const dates = objectAt(root.dates, "dates", errors);
  if (dates) {
    const dateKeys = [
      "notice_date",
      "compliance_deadline",
      "hearing_date",
      "appeal_deadline",
      "trading_suspension_date",
      "removal_effective_date",
    ] as const;
    exactKeys(dates, dateKeys, "dates", errors);
    for (const key of dateKeys) validateDateFact(dates[key], `dates.${key}`, sourceRefs, errors);
  }

  const continuedTrading = objectAt(root.continued_trading, "continued_trading", errors);
  if (continuedTrading) {
    exactKeys(continuedTrading, ["continues", "venue"], "continued_trading", errors);
    validateBooleanFact(continuedTrading.continues, "continued_trading.continues", sourceRefs, errors);
    validateTextFact(continuedTrading.venue, "continued_trading.venue", sourceRefs, errors);
  }

  validateDateFact(root.as_of, "as_of", sourceRefs, errors);
  if (!(root.confidence === null || oneOf(root.confidence, LISTING_FACT_CONFIDENCES))) {
    errors.push("confidence is invalid");
  }

  return errors;
}

export function readListingRiskEventFacts(value: unknown): ListingRiskEventFacts | null {
  return validateListingRiskEventFacts(value).length === 0 ? (value as ListingRiskEventFacts) : null;
}

function validateClassification(value: unknown, sourceRefs: Set<string>, errors: string[]) {
  const classification = objectAt(value, "classification", errors);
  if (!classification) return;
  exactKeys(classification, ["event_kind", "event_outcome", "source_ref"], "classification", errors);
  if (!oneOf(classification.event_kind, LISTING_EVENT_KINDS)) errors.push("classification.event_kind is invalid");
  if (!oneOf(classification.event_outcome, LISTING_EVENT_OUTCOMES)) errors.push("classification.event_outcome is invalid");
  validateRequiredSourceRef(classification.source_ref, "classification.source_ref", sourceRefs, errors);
}

function validateProceeding(value: unknown, sourceRefs: Set<string>, errors: string[]) {
  const proceeding = objectAt(value, "proceeding", errors);
  if (!proceeding) return;
  exactKeys(proceeding, ["kind", "status", "source_ref"], "proceeding", errors);
  if (!oneOf(proceeding.kind, LISTING_PROCEEDING_KINDS)) errors.push("proceeding.kind is invalid");
  if (!oneOf(proceeding.status, LISTING_PROCEEDING_STATUSES)) errors.push("proceeding.status is invalid");
  if (!nullableText(proceeding.source_ref)) {
    errors.push("proceeding.source_ref is invalid");
  } else if (typeof proceeding.source_ref === "string" && !sourceRefs.has(proceeding.source_ref)) {
    errors.push("proceeding.source_ref must identify a supplied source");
  }
  if (proceeding.source_ref === null && (proceeding.kind !== "unknown" || proceeding.status !== "unknown")) {
    errors.push("proceeding semantic values require a source_ref");
  }
}

function validateTextFact(value: unknown, path: string, sourceRefs: Set<string>, errors: string[]) {
  const fact = validateFactEnvelope(value, path, sourceRefs, errors);
  if (!fact) return;
  if (fact.availability === "available" && !nonEmptyText(fact.value)) {
    errors.push(`${path} available facts require a non-empty string value`);
  }
  if (fact.value !== null && typeof fact.value !== "string") errors.push(`${path}.value is invalid`);
}

function validateBooleanFact(value: unknown, path: string, sourceRefs: Set<string>, errors: string[]) {
  const fact = validateFactEnvelope(value, path, sourceRefs, errors);
  if (!fact) return;
  if (fact.availability === "available" && typeof fact.value !== "boolean") {
    errors.push(`${path} available facts require a boolean value`);
  }
  if (!(fact.value === null || typeof fact.value === "boolean")) errors.push(`${path}.value is invalid`);
}

function validateDateFact(value: unknown, path: string, sourceRefs: Set<string>, errors: string[]) {
  const fact = validateFactEnvelope(value, path, sourceRefs, errors, [
    "value",
    "availability",
    "value_quality",
    "date_status",
    "source_ref",
  ]);
  if (!fact) return;
  if (!oneOf(fact.date_status, LISTING_DATE_STATUSES)) errors.push(`${path}.date_status is invalid`);
  if (fact.availability === "available" && !validDate(fact.value)) {
    errors.push(`${path} available facts require a valid YYYY-MM-DD value`);
  }
  if (fact.value !== null && !validDate(fact.value)) errors.push(`${path}.value is invalid`);
  if (fact.availability === "unavailable" && fact.date_status !== "unknown") {
    errors.push(`${path} unavailable facts require unknown date_status`);
  }
}

function validateFactEnvelope(
  value: unknown,
  path: string,
  sourceRefs: Set<string>,
  errors: string[],
  keys: readonly string[] = ["value", "availability", "value_quality", "source_ref"],
) {
  const fact = objectAt(value, path, errors);
  if (!fact) return null;
  exactKeys(fact, keys, path, errors);
  if (!oneOf(fact.availability, LISTING_AVAILABILITIES)) errors.push(`${path}.availability is invalid`);
  if (!oneOf(fact.value_quality, LISTING_VALUE_QUALITIES)) errors.push(`${path}.value_quality is invalid`);
  if (!nullableText(fact.source_ref)) errors.push(`${path}.source_ref is invalid`);

  if (fact.availability === "available") {
    validateRequiredSourceRef(fact.source_ref, `${path}.source_ref`, sourceRefs, errors);
  }
  if (fact.availability === "unavailable") {
    if (fact.value !== null || fact.value_quality !== "unknown" || fact.source_ref !== null) {
      errors.push(`${path} unavailable facts require null value/source_ref and unknown quality`);
    }
  }
  return fact;
}

function validateSources(value: unknown, errors: string[]) {
  const refs = new Set<string>();
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("sources must be a non-empty array");
    return refs;
  }
  value.forEach((entryValue, index) => {
    const path = `sources[${index}]`;
    const entry = objectAt(entryValue, path, errors);
    if (!entry) return;
    exactKeys(entry, ["source_family", "source_id", "source_url", "source_ref", "evidence"], path, errors);
    if (!oneOf(entry.source_family, LISTING_SOURCE_FAMILIES)) errors.push(`${path}.source_family is invalid`);
    if (!nullableText(entry.source_id)) errors.push(`${path}.source_id is invalid`);
    if (!nullableHttpUrl(entry.source_url)) errors.push(`${path}.source_url is invalid`);
    if (!nonEmptyText(entry.source_ref) || entry.source_ref.length > 240) {
      errors.push(`${path}.source_ref must be a non-empty string of 240 characters or fewer`);
    } else if (refs.has(entry.source_ref)) {
      errors.push(`${path}.source_ref must be unique`);
    } else {
      refs.add(entry.source_ref);
    }
    if (!nonEmptyText(entry.evidence)) {
      errors.push(`${path}.evidence must be a non-empty string`);
    } else if (Array.from(entry.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH) {
      errors.push(`${path}.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer`);
    }
  });
  return refs;
}

function validateRequiredSourceRef(value: unknown, path: string, sourceRefs: Set<string>, errors: string[]) {
  if (!nonEmptyText(value)) {
    errors.push(`${path} must be a non-empty string`);
  } else if (!sourceRefs.has(value)) {
    errors.push(`${path} must identify a supplied source`);
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function objectAt(value: unknown, path: string, errors: string[]) {
  const result = record(value);
  if (!result) errors.push(`${path} must be an object`);
  return result;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nullableHttpUrl(value: unknown) {
  if (value === null) return true;
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableText(value: unknown) {
  return value === null || nonEmptyText(value);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function oneOf(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const textFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "availability", "value_quality", "source_ref"],
  properties: {
    value: { type: ["string", "null"] },
    availability: { type: "string", enum: LISTING_AVAILABILITIES },
    value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES },
    source_ref: { type: ["string", "null"] },
  },
} as const;

const booleanFactSchema = {
  ...textFactSchema,
  properties: {
    ...textFactSchema.properties,
    value: { type: ["boolean", "null"] },
  },
} as const;

const dateFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "availability", "value_quality", "date_status", "source_ref"],
  properties: {
    value: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    availability: { type: "string", enum: LISTING_AVAILABILITIES },
    value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES },
    date_status: { type: "string", enum: LISTING_DATE_STATUSES },
    source_ref: { type: ["string", "null"] },
  },
} as const;

export const LISTING_RISK_EVENT_FACTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "classification",
    "exchange",
    "affected_security",
    "listing_rule",
    "listing_requirement",
    "compliance_period",
    "proceeding",
    "dates",
    "continued_trading",
    "as_of",
    "confidence",
    "sources",
  ],
  properties: {
    version: { type: "string", enum: [LISTING_RISK_EVENT_FACTS_VERSION] },
    classification: {
      type: "object",
      additionalProperties: false,
      required: ["event_kind", "event_outcome", "source_ref"],
      properties: {
        event_kind: { type: "string", enum: LISTING_EVENT_KINDS },
        event_outcome: { type: "string", enum: LISTING_EVENT_OUTCOMES },
        source_ref: { type: "string" },
      },
    },
    exchange: textFactSchema,
    affected_security: {
      type: "object",
      additionalProperties: false,
      required: ["title", "ticker", "security_basis"],
      properties: { title: textFactSchema, ticker: textFactSchema, security_basis: textFactSchema },
    },
    listing_rule: textFactSchema,
    listing_requirement: textFactSchema,
    compliance_period: textFactSchema,
    proceeding: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "status", "source_ref"],
      properties: {
        kind: { type: "string", enum: LISTING_PROCEEDING_KINDS },
        status: { type: "string", enum: LISTING_PROCEEDING_STATUSES },
        source_ref: { type: ["string", "null"] },
      },
    },
    dates: {
      type: "object",
      additionalProperties: false,
      required: [
        "notice_date",
        "compliance_deadline",
        "hearing_date",
        "appeal_deadline",
        "trading_suspension_date",
        "removal_effective_date",
      ],
      properties: {
        notice_date: dateFactSchema,
        compliance_deadline: dateFactSchema,
        hearing_date: dateFactSchema,
        appeal_deadline: dateFactSchema,
        trading_suspension_date: dateFactSchema,
        removal_effective_date: dateFactSchema,
      },
    },
    continued_trading: {
      type: "object",
      additionalProperties: false,
      required: ["continues", "venue"],
      properties: { continues: booleanFactSchema, venue: textFactSchema },
    },
    as_of: dateFactSchema,
    confidence: { type: ["string", "null"], enum: [...LISTING_FACT_CONFIDENCES, null] },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_family", "source_id", "source_url", "source_ref", "evidence"],
        properties: {
          source_family: { type: "string", enum: LISTING_SOURCE_FAMILIES },
          source_id: { type: ["string", "null"] },
          source_url: { type: ["string", "null"] },
          source_ref: { type: "string", maxLength: 240 },
          evidence: { type: "string", maxLength: LISTING_SOURCE_EVIDENCE_MAX_LENGTH },
        },
      },
    },
  },
} as const;
