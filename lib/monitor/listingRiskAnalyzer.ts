import {
  LISTING_DATE_STATUSES,
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_FACT_CONFIDENCES,
  LISTING_FACT_PATHS,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
  LISTING_RISK_EVENT_FACTS_VERSION,
  LISTING_VALUE_QUALITIES,
  type ListingFactConfidence,
  type ListingFactOrigin,
  type ListingFactPath,
  type ListingValueQuality,
  type ListingRiskEventFacts,
  validateListingRiskEventFactEligibility,
  validateListingRiskEventFacts,
} from "./listingRiskFacts.ts";

export const LISTING_RISK_ANALYZER_INPUT_VERSION = "listing_risk_analyzer_input_v1";
export const LISTING_RISK_ANALYZER_PROMPT_VERSION = "listing_risk_domain_analyzer_v6";
export const LISTING_RISK_ANALYZER_MAX_DOCUMENTS = 48;
export const LISTING_RISK_ANALYZER_MAX_SOURCE_CHARS = 120_000;

export type ListingRiskAnalyzerStatus = "applicable" | "not_applicable";

export type ListingRiskAnalyzerResult =
  | { status: "applicable"; facts: ListingRiskEventFacts }
  | { status: "not_applicable" };

export type ListingRiskPrimaryContext = {
  event_type?: string | null;
  summary?: string | null;
  monitor_routes?: unknown[] | null;
};

export type ListingRiskSourceDocument = {
  source_ref: string;
  label: string | null;
  text: string;
};

export type ListingRiskAnalyzerInput = {
  version: typeof LISTING_RISK_ANALYZER_INPUT_VERSION;
  source_family: "news" | "nasdaq" | "sec" | "other";
  source_id: string | null;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  source_documents: ListingRiskSourceDocument[];
  primary_context: ListingRiskPrimaryContext | null;
};

export type ListingRiskAnalyzerProviderResult = {
  status: ListingRiskAnalyzerStatus;
  applicable_facts: ListingRiskEventFacts[];
};

export const LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS = [
  "classification_event_kind",
  "classification_event_outcome",
  "proceeding_kind",
  "proceeding_status",
] as const;

export const LISTING_RISK_PROVIDER_TEXT_FACT_KEYS = [
  "exchange",
  "affected_security_title",
  "affected_security_ticker",
  "affected_security_security_basis",
  "listing_rule",
  "listing_requirement",
  "compliance_period",
  "continued_trading_venue",
] as const;

export const LISTING_RISK_PROVIDER_DATE_FACT_KEYS = [
  "notice_date",
  "compliance_deadline",
  "hearing_date",
  "appeal_deadline",
  "trading_suspension_date",
  "removal_effective_date",
] as const;

export const LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS = ["continued_trading_continues"] as const;
export const LISTING_RISK_PROVIDER_UNAVAILABLE_FACT_KEYS = [
  "proceeding_kind",
  "proceeding_status",
  ...LISTING_RISK_PROVIDER_TEXT_FACT_KEYS,
  ...LISTING_RISK_PROVIDER_DATE_FACT_KEYS,
  ...LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS,
] as const;

export const LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH = {
  classification_event_kind: "classification.event_kind",
  classification_event_outcome: "classification.event_outcome",
  proceeding_kind: "proceeding.kind",
  proceeding_status: "proceeding.status",
  exchange: "exchange.value",
  affected_security_title: "affected_security.title.value",
  affected_security_ticker: "affected_security.ticker.value",
  affected_security_security_basis: "affected_security.security_basis.value",
  listing_rule: "listing_rule.value",
  listing_requirement: "listing_requirement.value",
  compliance_period: "compliance_period.value",
  continued_trading_venue: "continued_trading.venue.value",
  notice_date: "dates.notice_date.value",
  compliance_deadline: "dates.compliance_deadline.value",
  hearing_date: "dates.hearing_date.value",
  appeal_deadline: "dates.appeal_deadline.value",
  trading_suspension_date: "dates.trading_suspension_date.value",
  removal_effective_date: "dates.removal_effective_date.value",
  continued_trading_continues: "continued_trading.continues.value",
} as const satisfies Record<string, ListingFactPath>;

type ProviderCategoricalFactKey = (typeof LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS)[number];
type ProviderTextFactKey = (typeof LISTING_RISK_PROVIDER_TEXT_FACT_KEYS)[number];
type ProviderDateFactKey = (typeof LISTING_RISK_PROVIDER_DATE_FACT_KEYS)[number];
type ProviderBooleanFactKey = (typeof LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS)[number];
type ProviderFactKey = keyof typeof LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH;

type ListingRiskProviderProvenance = {
  origin: Exclude<ListingFactOrigin, "deterministic_derived">;
  source_ref: string;
  evidence: string;
  confidence: Exclude<ListingFactConfidence, null>;
  as_of: string | null;
};

type ListingRiskProviderCategoricalFact = ListingRiskProviderProvenance & {
  fact_key: ProviderCategoricalFactKey;
  value: string;
};

type ListingRiskProviderTextFact = ListingRiskProviderProvenance & {
  fact_key: ProviderTextFactKey;
  value: string;
  value_quality: ListingValueQuality;
};

type ListingRiskProviderDateFact = ListingRiskProviderProvenance & {
  fact_key: ProviderDateFactKey;
  value: string;
  value_quality: ListingValueQuality;
  date_status: (typeof LISTING_DATE_STATUSES)[number];
};

type ListingRiskProviderBooleanFact = ListingRiskProviderProvenance & {
  fact_key: ProviderBooleanFactKey;
  value: boolean;
  value_quality: ListingValueQuality;
};

type ListingRiskProviderAnalysis = {
  categorical_facts: ListingRiskProviderCategoricalFact[];
  text_facts: ListingRiskProviderTextFact[];
  date_facts: ListingRiskProviderDateFact[];
  boolean_facts: ListingRiskProviderBooleanFact[];
  unavailable_fact_keys: (typeof LISTING_RISK_PROVIDER_UNAVAILABLE_FACT_KEYS)[number][];
  as_of_facts: Array<{
    value: string;
    value_quality: ListingValueQuality;
    date_status: (typeof LISTING_DATE_STATUSES)[number];
    source_ref: string;
  }>;
  as_of_availability: "available" | "unavailable";
  confidence: Exclude<ListingFactConfidence, null> | "unknown";
};

export type ListingRiskAnalyzerTransportResult = {
  status: ListingRiskAnalyzerStatus;
  facts: ListingRiskProviderAnalysis[];
};

const providerProvenanceProperties = {
  origin: { type: "string", enum: ["source_stated", "domain_interpreted"] },
  source_ref: { type: "string" },
  evidence: { type: "string" },
  confidence: { type: "string", enum: LISTING_FACT_CONFIDENCES },
  as_of: { type: "string", nullable: true },
} as const;

function providerFactSchema(
  factKeys: readonly string[],
  value: Record<string, unknown>,
  extras: Record<string, unknown> = {},
) {
  return {
    type: "object",
    required: ["fact_key", "value", ...Object.keys(extras), ...Object.keys(providerProvenanceProperties)],
    properties: {
      fact_key: { type: "string", enum: factKeys },
      value,
      ...extras,
      ...providerProvenanceProperties,
    },
  } as const;
}

export const LISTING_RISK_ANALYZER_PROVIDER_SCHEMA = {
  type: "object",
  required: ["status", "facts"],
  properties: {
    status: { type: "string", enum: ["applicable", "not_applicable"] },
    facts: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        required: [
          "categorical_facts",
          "text_facts",
          "date_facts",
          "boolean_facts",
          "unavailable_fact_keys",
          "as_of_facts",
          "as_of_availability",
          "confidence",
        ],
        properties: {
          categorical_facts: {
            type: "array",
            maxItems: LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS.length,
            items: providerFactSchema(
              LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS,
              { type: "string" },
            ),
          },
          text_facts: {
            type: "array",
            maxItems: LISTING_RISK_PROVIDER_TEXT_FACT_KEYS.length,
            items: providerFactSchema(
              LISTING_RISK_PROVIDER_TEXT_FACT_KEYS,
              { type: "string" },
              { value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES } },
            ),
          },
          date_facts: {
            type: "array",
            maxItems: LISTING_RISK_PROVIDER_DATE_FACT_KEYS.length,
            items: providerFactSchema(
              LISTING_RISK_PROVIDER_DATE_FACT_KEYS,
              { type: "string" },
              {
                value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES },
                date_status: { type: "string", enum: LISTING_DATE_STATUSES },
              },
            ),
          },
          boolean_facts: {
            type: "array",
            maxItems: LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS.length,
            items: providerFactSchema(
              LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS,
              { type: "boolean" },
              { value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES } },
            ),
          },
          unavailable_fact_keys: {
            type: "array",
            maxItems: LISTING_RISK_PROVIDER_UNAVAILABLE_FACT_KEYS.length,
            items: { type: "string", enum: LISTING_RISK_PROVIDER_UNAVAILABLE_FACT_KEYS },
          },
          as_of_facts: {
            type: "array",
            maxItems: 1,
            items: {
              type: "object",
              required: ["value", "value_quality", "date_status", "source_ref"],
              properties: {
                value: { type: "string" },
                value_quality: { type: "string", enum: LISTING_VALUE_QUALITIES },
                date_status: { type: "string", enum: LISTING_DATE_STATUSES },
                source_ref: { type: "string" },
              },
            },
          },
          as_of_availability: { type: "string", enum: ["available", "unavailable"] },
          confidence: { type: "string", enum: [...LISTING_FACT_CONFIDENCES, "unknown"] },
        },
      },
    },
  },
} as const;

/**
 * Gemini accepts an OpenAPI-like response-schema subset. This is a mechanical
 * dialect conversion of the canonical Listing facts schema, not a second fact
 * contract: runtime validation still uses validateListingRiskEventFacts().
 */
export function toGeminiResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const allowedScalarKeys = [
    "description",
    "format",
    "maxItems",
    "maxLength",
    "minItems",
    "minLength",
    "maximum",
    "minimum",
    "title",
  ] as const;
  for (const key of allowedScalarKeys) {
    if (schema[key] !== undefined) output[key] = schema[key];
  }

  const rawTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const concreteTypes = rawTypes.filter((value): value is string => typeof value === "string" && value !== "null");
  if (concreteTypes.length === 1) output.type = concreteTypes[0];
  if (rawTypes.includes("null")) output.nullable = true;

  if (Array.isArray(schema.enum)) {
    const enumValues = schema.enum.filter((value) => value !== null);
    if (enumValues.length) output.enum = enumValues;
    if (schema.enum.includes(null)) output.nullable = true;
  }
  if (Array.isArray(schema.required)) output.required = [...schema.required];
  if (record(schema.items)) output.items = toGeminiResponseSchema(schema.items as Record<string, unknown>);

  const properties = record(schema.properties);
  if (properties) {
    output.properties = Object.fromEntries(
      Object.entries(properties)
        .filter((entry): entry is [string, Record<string, unknown>] => Boolean(record(entry[1])))
        .map(([key, child]) => [key, toGeminiResponseSchema(child)]),
    );
  }
  return output;
}

export function validateListingRiskAnalyzerInput(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_analyzer_input must be an object"];

  exactKeys(root, [
    "version",
    "source_family",
    "source_id",
    "source_url",
    "published_at",
    "title",
    "source_documents",
    "primary_context",
  ], "listing_risk_analyzer_input", errors);

  if (root.version !== LISTING_RISK_ANALYZER_INPUT_VERSION) {
    errors.push(`listing_risk_analyzer_input.version must be ${LISTING_RISK_ANALYZER_INPUT_VERSION}`);
  }
  if (!oneOf(root.source_family, ["news", "nasdaq", "sec", "other"])) {
    errors.push("listing_risk_analyzer_input.source_family is invalid");
  }
  if (!nullableText(root.source_id)) errors.push("listing_risk_analyzer_input.source_id is invalid");
  if (!nullableHttpUrl(root.source_url)) errors.push("listing_risk_analyzer_input.source_url is invalid");
  if (!nullableText(root.published_at)) errors.push("listing_risk_analyzer_input.published_at is invalid");
  if (!nullableText(root.title)) errors.push("listing_risk_analyzer_input.title is invalid");

  const documents = Array.isArray(root.source_documents) ? root.source_documents : [];
  if (!Array.isArray(root.source_documents) || documents.length === 0) {
    errors.push("listing_risk_analyzer_input.source_documents must be a non-empty array");
  }
  if (documents.length > LISTING_RISK_ANALYZER_MAX_DOCUMENTS) {
    errors.push(`listing_risk_analyzer_input.source_documents must contain at most ${LISTING_RISK_ANALYZER_MAX_DOCUMENTS} documents`);
  }

  const sourceRefs = new Set<string>();
  let sourceChars = 0;
  documents.forEach((documentValue, index) => {
    const path = `listing_risk_analyzer_input.source_documents[${index}]`;
    const document = record(documentValue);
    if (!document) {
      errors.push(`${path} must be an object`);
      return;
    }
    exactKeys(document, ["source_ref", "label", "text"], path, errors);
    if (!nonEmptyText(document.source_ref) || document.source_ref.length > 240) {
      errors.push(`${path}.source_ref must be a non-empty string of 240 characters or fewer`);
    } else if (sourceRefs.has(document.source_ref)) {
      errors.push(`${path}.source_ref must be unique`);
    } else {
      sourceRefs.add(document.source_ref);
    }
    if (!nullableText(document.label)) errors.push(`${path}.label is invalid`);
    if (!nonEmptyText(document.text)) errors.push(`${path}.text must be a non-empty string`);
    else sourceChars += Array.from(document.text).length;
  });
  if (sourceChars > LISTING_RISK_ANALYZER_MAX_SOURCE_CHARS) {
    errors.push(`listing_risk_analyzer_input source text must be ${LISTING_RISK_ANALYZER_MAX_SOURCE_CHARS} characters or fewer`);
  }

  const primaryContext = root.primary_context === null ? null : record(root.primary_context);
  if (!(root.primary_context === null || primaryContext)) {
    errors.push("listing_risk_analyzer_input.primary_context must be an object or null");
  } else if (primaryContext) {
    exactKeys(primaryContext, Object.keys(primaryContext).filter((key) => [
      "event_type",
      "summary",
      "monitor_routes",
    ].includes(key)), "listing_risk_analyzer_input.primary_context", errors);
    if (!(primaryContext.event_type === undefined || nullableText(primaryContext.event_type))) {
      errors.push("listing_risk_analyzer_input.primary_context.event_type is invalid");
    }
    if (!(primaryContext.summary === undefined || nullableText(primaryContext.summary))) {
      errors.push("listing_risk_analyzer_input.primary_context.summary is invalid");
    }
    if (!(primaryContext.monitor_routes === undefined || primaryContext.monitor_routes === null || Array.isArray(primaryContext.monitor_routes))) {
      errors.push("listing_risk_analyzer_input.primary_context.monitor_routes is invalid");
    }
  }
  return errors;
}

export function validateListingRiskAnalyzerResult(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_analyzer_result must be an object"];

  if (root.status === "applicable") {
    exactKeys(root, ["status", "facts"], "listing_risk_analyzer_result", errors);
    errors.push(...validateListingRiskEventFacts(root.facts).map((error) => `facts: ${error}`));
    return errors;
  }
  if (root.status === "not_applicable") {
    exactKeys(root, ["status"], "listing_risk_analyzer_result", errors);
    return errors;
  }
  errors.push("listing_risk_analyzer_result.status is invalid");
  return errors;
}

export function readListingRiskAnalyzerResult(value: unknown): ListingRiskAnalyzerResult | null {
  return validateListingRiskAnalyzerResult(value).length === 0
    ? value as ListingRiskAnalyzerResult
    : null;
}

export function validateListingRiskAnalyzerProviderResult(
  value: unknown,
  input?: ListingRiskAnalyzerInput,
): string[] {
  return validateListingRiskAnalyzerProviderContract(value, input, true);
}

export function validateListingRiskAnalyzerProviderFactEligibility(
  value: unknown,
  input?: ListingRiskAnalyzerInput,
): string[] {
  return validateListingRiskAnalyzerProviderContract(value, input, false);
}

function validateListingRiskAnalyzerProviderContract(
  value: unknown,
  input: ListingRiskAnalyzerInput | undefined,
  validateEvidenceQuality: boolean,
): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_analyzer_provider_result must be an object"];
  exactKeys(root, ["status", "applicable_facts"], "listing_risk_analyzer_provider_result", errors);

  if (!oneOf(root.status, ["applicable", "not_applicable"])) {
    errors.push("listing_risk_analyzer_provider_result.status is invalid");
  }
  if (!Array.isArray(root.applicable_facts)) {
    errors.push("listing_risk_analyzer_provider_result.applicable_facts must be an array");
    return errors;
  }
  if (root.applicable_facts.length > 1) {
    errors.push("listing_risk_analyzer_provider_result.applicable_facts must contain at most one item");
  }
  if (root.status === "applicable" && root.applicable_facts.length !== 1) {
    errors.push("applicable status requires exactly one facts item");
  }
  if (root.status === "not_applicable" && root.applicable_facts.length !== 0) {
    errors.push("not_applicable status requires an empty applicable_facts array");
  }

  if (root.applicable_facts.length === 1) {
    const facts = root.applicable_facts[0];
    const factErrors = validateEvidenceQuality
      ? validateListingRiskEventFacts(facts)
      : validateListingRiskEventFactEligibility(facts);
    errors.push(...factErrors.map((error) => `applicable_facts[0]: ${error}`));
    if (input) errors.push(...validateFactsSourceIdentity(facts, input, validateEvidenceQuality));
  }
  return errors;
}

export function normalizeListingRiskAnalyzerProviderResult(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): ListingRiskAnalyzerResult | null {
  if (validateListingRiskAnalyzerProviderResult(value, input).length !== 0) return null;
  const providerResult = value as ListingRiskAnalyzerProviderResult;
  return providerResult.status === "not_applicable"
    ? { status: "not_applicable" }
    : { status: "applicable", facts: providerResult.applicable_facts[0] };
}

function validateFactsSourceIdentity(
  value: unknown,
  input: ListingRiskAnalyzerInput,
  validateEvidenceQuality: boolean,
) {
  const errors: string[] = [];
  const facts = record(value);
  const sources = Array.isArray(facts?.sources) ? facts.sources : [];
  const sourceDocuments = new Map(input.source_documents.map((document) => [document.source_ref, document]));

  sources.forEach((sourceValue, index) => {
    const source = record(sourceValue);
    if (!source) return;
    const path = `applicable_facts[0].sources[${index}]`;
    if (source.source_family !== input.source_family) errors.push(`${path}.source_family must match analyzer input`);
    if (source.source_id !== input.source_id) errors.push(`${path}.source_id must match analyzer input`);
    if (source.source_url !== input.source_url) errors.push(`${path}.source_url must match analyzer input`);
    const document = typeof source.source_ref === "string" ? sourceDocuments.get(source.source_ref) : null;
    if (!document) {
      errors.push(`${path}.source_ref must identify a supplied source document`);
      return;
    }
    if (validateEvidenceQuality && typeof source.evidence === "string" && !document.text.includes(source.evidence)) {
      errors.push(`${path}.evidence must be a contiguous excerpt from the supplied source document`);
    }
  });
  const provenance = Array.isArray(facts?.fact_provenance) ? facts.fact_provenance : [];
  provenance.forEach((entryValue, index) => {
    const entry = record(entryValue);
    if (!entry) return;
    const path = `applicable_facts[0].fact_provenance[${index}]`;
    if (entry.origin === "deterministic_derived") {
      errors.push(`${path}.origin cannot be deterministic_derived in analyzer provider output`);
      return;
    }
    const document = typeof entry.source_ref === "string" ? sourceDocuments.get(entry.source_ref) : null;
    if (!document) {
      errors.push(`${path}.source_ref must identify a supplied source document`);
      return;
    }
    if (validateEvidenceQuality) {
      if (
        entry.evidence_status !== "available"
        || entry.evidence_issue !== null
        || typeof entry.evidence !== "string"
        || !entry.evidence.trim()
      ) {
        errors.push(`${path}.evidence must be available with a non-empty string in provider output`);
      } else if (!document.text.includes(entry.evidence)) {
        errors.push(`${path}.evidence must be a contiguous excerpt from the supplied source document`);
      }
    }
  });
  return errors;
}

export function canonicalizeListingRiskAnalyzerTransportResult(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): { result: ListingRiskAnalyzerProviderResult | null; errors: string[] } {
  const errors = validateListingRiskAnalyzerTransportResult(value, input);
  if (errors.length) return { result: null, errors };
  const transport = value as ListingRiskAnalyzerTransportResult;
  if (transport.status === "not_applicable") {
    return { result: { status: "not_applicable", applicable_facts: [] }, errors: [] };
  }

  const analysis = transport.facts[0];
  const categorical = new Map(analysis.categorical_facts.map((fact) => [fact.fact_key, fact]));
  const textFacts = new Map(analysis.text_facts.map((fact) => [fact.fact_key, fact]));
  const dateFacts = new Map(analysis.date_facts.map((fact) => [fact.fact_key, fact]));
  const booleanFacts = new Map(analysis.boolean_facts.map((fact) => [fact.fact_key, fact]));
  const unavailableText = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  const unavailableDate = () => ({ ...unavailableText(), date_status: "unknown" as const });
  const availableText = (fact: ListingRiskProviderTextFact) => ({
    value: fact.value,
    availability: "available" as const,
    value_quality: fact.value_quality,
    source_ref: fact.source_ref,
  });
  const availableDate = (fact: ListingRiskProviderDateFact) => ({
    value: fact.value,
    availability: "available" as const,
    value_quality: fact.value_quality,
    date_status: fact.date_status,
    source_ref: fact.source_ref,
  });
  const text = (key: ProviderTextFactKey) => {
    const fact = textFacts.get(key);
    return fact ? availableText(fact) : unavailableText();
  };
  const date = (key: ProviderDateFactKey) => {
    const fact = dateFacts.get(key);
    return fact ? availableDate(fact) : unavailableDate();
  };
  const continuedTrading = booleanFacts.get("continued_trading_continues");
  const asOf = analysis.as_of_facts[0];
  const provenanceRows = [
    ...analysis.categorical_facts,
    ...analysis.text_facts,
    ...analysis.date_facts,
    ...analysis.boolean_facts,
  ];
  const provenanceByPath = new Map<ListingFactPath, ListingRiskEventFacts["fact_provenance"][number]>();
  for (const row of provenanceRows) {
    const factPath = LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH[row.fact_key as ProviderFactKey];
    provenanceByPath.set(factPath, {
      fact_path: factPath,
      origin: row.origin,
      source_ref: row.source_ref,
      evidence: row.evidence,
      evidence_status: "available",
      evidence_issue: null,
      confidence: row.confidence,
      as_of: row.as_of,
      formula_id: null,
      input_fact_paths: [],
    });
  }

  const sourceRefs = new Set<string>();
  for (const row of provenanceRows) {
    sourceRefs.add(row.source_ref);
  }
  if (asOf) sourceRefs.add(asOf.source_ref);
  const sources = [...sourceRefs]
    .sort((left, right) => left.localeCompare(right))
    .map((sourceRef) => ({
      source_family: input.source_family,
      source_id: input.source_id,
      source_url: input.source_url,
      source_ref: sourceRef,
      evidence: null,
    }));
  const eventKind = categorical.get("classification_event_kind") as ListingRiskProviderCategoricalFact;
  const eventOutcome = categorical.get("classification_event_outcome") as ListingRiskProviderCategoricalFact;
  const proceedingKind = categorical.get("proceeding_kind");
  const proceedingStatus = categorical.get("proceeding_status");
  const proceedingSourceRef = proceedingKind?.source_ref || proceedingStatus?.source_ref || null;

  const facts: ListingRiskEventFacts = {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: {
      event_kind: eventKind.value as ListingRiskEventFacts["classification"]["event_kind"],
      event_outcome: eventOutcome.value as ListingRiskEventFacts["classification"]["event_outcome"],
      source_ref: eventKind.source_ref,
    },
    exchange: text("exchange"),
    affected_security: {
      title: text("affected_security_title"),
      ticker: text("affected_security_ticker"),
      security_basis: text("affected_security_security_basis"),
    },
    listing_rule: text("listing_rule"),
    listing_requirement: text("listing_requirement"),
    compliance_period: text("compliance_period"),
    proceeding: {
      kind: (proceedingKind?.value || "unknown") as ListingRiskEventFacts["proceeding"]["kind"],
      status: (proceedingStatus?.value || "unknown") as ListingRiskEventFacts["proceeding"]["status"],
      source_ref: proceedingSourceRef,
    },
    dates: {
      notice_date: date("notice_date"),
      compliance_deadline: date("compliance_deadline"),
      hearing_date: date("hearing_date"),
      appeal_deadline: date("appeal_deadline"),
      trading_suspension_date: date("trading_suspension_date"),
      removal_effective_date: date("removal_effective_date"),
    },
    continued_trading: {
      continues: continuedTrading
        ? {
            value: continuedTrading.value,
            availability: "available",
            value_quality: continuedTrading.value_quality,
            source_ref: continuedTrading.source_ref,
          }
        : { value: null, availability: "unavailable", value_quality: "unknown", source_ref: null },
      venue: text("continued_trading_venue"),
    },
    as_of: asOf
      ? {
          value: asOf.value,
          availability: "available",
          value_quality: asOf.value_quality,
          date_status: asOf.date_status,
          source_ref: asOf.source_ref,
        }
      : unavailableDate(),
    confidence: analysis.confidence === "unknown" ? null : analysis.confidence,
    sources,
    fact_provenance: LISTING_FACT_PATHS.flatMap((path) => {
      const entry = provenanceByPath.get(path);
      return entry ? [entry] : [];
    }),
  };
  return { result: { status: "applicable", applicable_facts: [facts] }, errors: [] };
}

export function validateListingRiskAnalyzerTransportResult(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_analyzer_transport_result must be an object"];
  exactKeys(root, ["status", "facts"], "listing_risk_analyzer_transport_result", errors);
  if (!oneOf(root.status, ["applicable", "not_applicable"])) {
    errors.push("listing_risk_analyzer_transport_result.status is invalid");
  }
  if (!Array.isArray(root.facts)) {
    errors.push("listing_risk_analyzer_transport_result.facts must be an array");
    return errors;
  }
  if (root.facts.length > 1) {
    errors.push("listing_risk_analyzer_transport_result.facts must contain at most one item");
  }
  if (root.status === "applicable" && root.facts.length !== 1) {
    errors.push("applicable status requires exactly one facts item");
  }
  if (root.status === "not_applicable" && root.facts.length !== 0) {
    errors.push("not_applicable status requires an empty facts array");
  }
  if (root.facts.length !== 1) return errors;

  const analysis = record(root.facts[0]);
  if (!analysis) {
    errors.push("facts[0] must be an object");
    return errors;
  }
  exactKeys(analysis, [
    "categorical_facts",
    "text_facts",
    "date_facts",
    "boolean_facts",
    "unavailable_fact_keys",
    "as_of_facts",
    "as_of_availability",
    "confidence",
  ], "facts[0]", errors);
  const sourceRefs = new Set(input.source_documents.map((document) => document.source_ref));
  const categorical = validateTransportFactRows(
    analysis.categorical_facts,
    "facts[0].categorical_facts",
    LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS,
    sourceRefs,
    errors,
    "categorical",
  );
  const text = validateTransportFactRows(
    analysis.text_facts,
    "facts[0].text_facts",
    LISTING_RISK_PROVIDER_TEXT_FACT_KEYS,
    sourceRefs,
    errors,
    "text",
  );
  const dates = validateTransportFactRows(
    analysis.date_facts,
    "facts[0].date_facts",
    LISTING_RISK_PROVIDER_DATE_FACT_KEYS,
    sourceRefs,
    errors,
    "date",
  );
  const booleans = validateTransportFactRows(
    analysis.boolean_facts,
    "facts[0].boolean_facts",
    LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS,
    sourceRefs,
    errors,
    "boolean",
  );
  for (const requiredKey of ["classification_event_kind", "classification_event_outcome"] as const) {
    if (!categorical.has(requiredKey)) errors.push(`facts[0].categorical_facts is missing ${requiredKey}`);
  }
  validateSharedCategoricalSource(categorical, ["classification_event_kind", "classification_event_outcome"], "classification", errors);
  validateSharedCategoricalSource(categorical, ["proceeding_kind", "proceeding_status"], "proceeding", errors);

  const availableKeys = new Set([...categorical.keys(), ...text.keys(), ...dates.keys(), ...booleans.keys()]);
  const unavailableKeys = new Set<string>();
  if (!Array.isArray(analysis.unavailable_fact_keys)) {
    errors.push("facts[0].unavailable_fact_keys must be an array");
  } else {
    analysis.unavailable_fact_keys.forEach((key, index) => {
      if (!oneOf(key, LISTING_RISK_PROVIDER_UNAVAILABLE_FACT_KEYS)) {
        errors.push(`facts[0].unavailable_fact_keys[${index}] is invalid`);
      } else if (unavailableKeys.has(key)) {
        errors.push("facts[0].unavailable_fact_keys must be unique");
      } else {
        unavailableKeys.add(key);
        if (availableKeys.has(key)) errors.push(`facts[0] fact_key ${key} cannot be both available and unavailable`);
      }
    });
  }
  for (const key of Object.keys(LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH)) {
    if (!availableKeys.has(key) && !unavailableKeys.has(key)) {
      errors.push(`facts[0] is missing explicit state for fact_key ${key}`);
    }
  }

  if (!Array.isArray(analysis.as_of_facts) || analysis.as_of_facts.length > 1) {
    errors.push("facts[0].as_of_facts must be an array containing at most one item");
  } else if (analysis.as_of_facts.length === 1) {
    const asOf = record(analysis.as_of_facts[0]);
    if (!asOf) {
      errors.push("facts[0].as_of_facts[0] must be an object");
    } else {
      exactKeys(asOf, ["value", "value_quality", "date_status", "source_ref"], "facts[0].as_of_facts[0]", errors);
      if (!validDate(asOf.value)) errors.push("facts[0].as_of_facts[0].value is invalid");
      if (!oneOf(asOf.value_quality, LISTING_VALUE_QUALITIES)) errors.push("facts[0].as_of_facts[0].value_quality is invalid");
      if (!oneOf(asOf.date_status, LISTING_DATE_STATUSES)) errors.push("facts[0].as_of_facts[0].date_status is invalid");
      if (!nonEmptyText(asOf.source_ref) || !sourceRefs.has(asOf.source_ref)) {
        errors.push("facts[0].as_of_facts[0].source_ref must identify a supplied source document");
      }
    }
  }
  if (!oneOf(analysis.as_of_availability, ["available", "unavailable"])) {
    errors.push("facts[0].as_of_availability is invalid");
  } else if (analysis.as_of_availability === "available" && (!Array.isArray(analysis.as_of_facts) || analysis.as_of_facts.length !== 1)) {
    errors.push("facts[0] available as_of requires exactly one as_of_facts row");
  } else if (analysis.as_of_availability === "unavailable" && Array.isArray(analysis.as_of_facts) && analysis.as_of_facts.length !== 0) {
    errors.push("facts[0] unavailable as_of requires an empty as_of_facts array");
  }
  if (!oneOf(analysis.confidence, [...LISTING_FACT_CONFIDENCES, "unknown"])) {
    errors.push("facts[0].confidence is invalid");
  }
  return errors;
}

function validateTransportFactRows(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  sourceRefs: Set<string>,
  errors: string[],
  kind: "categorical" | "text" | "date" | "boolean",
) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return seen;
  }
  if (rows.length > allowedKeys.length) errors.push(`${path} contains too many items`);
  rows.forEach((rowValue, index) => {
    const rowPath = `${path}[${index}]`;
    const row = record(rowValue);
    if (!row) {
      errors.push(`${rowPath} must be an object`);
      return;
    }
    const keys = ["fact_key", "value", "origin", "source_ref", "evidence", "confidence", "as_of"];
    if (kind === "text" || kind === "boolean") keys.push("value_quality");
    if (kind === "date") keys.push("value_quality", "date_status");
    exactKeys(row, keys, rowPath, errors);
    if (typeof row.fact_key !== "string" || !allowedKeys.includes(row.fact_key)) {
      errors.push(`${rowPath}.fact_key is invalid`);
    } else if (seen.has(row.fact_key)) {
      errors.push(`${rowPath}.fact_key must be unique`);
    } else {
      seen.set(row.fact_key, row);
    }
    if (!oneOf(row.origin, ["source_stated", "domain_interpreted"])) errors.push(`${rowPath}.origin is invalid`);
    if (!nonEmptyText(row.source_ref) || !sourceRefs.has(row.source_ref)) {
      errors.push(`${rowPath}.source_ref must identify a supplied source document`);
    }
    if (!nonEmptyText(row.evidence)) errors.push(`${rowPath}.evidence must be a non-empty string`);
    if (!oneOf(row.confidence, LISTING_FACT_CONFIDENCES)) errors.push(`${rowPath}.confidence is invalid`);
    if (!(row.as_of === null || validDate(row.as_of))) errors.push(`${rowPath}.as_of is invalid`);
    if (kind === "boolean") {
      if (typeof row.value !== "boolean") errors.push(`${rowPath}.value is invalid`);
    } else if (!nonEmptyText(row.value)) {
      errors.push(`${rowPath}.value must be a non-empty string`);
    }
    if ((kind === "text" || kind === "date" || kind === "boolean") && !oneOf(row.value_quality, LISTING_VALUE_QUALITIES)) {
      errors.push(`${rowPath}.value_quality is invalid`);
    }
    if (kind === "date" && !validDate(row.value)) errors.push(`${rowPath}.value must be YYYY-MM-DD`);
    if (kind === "date" && !oneOf(row.date_status, LISTING_DATE_STATUSES)) errors.push(`${rowPath}.date_status is invalid`);
    if (kind === "categorical" && typeof row.fact_key === "string" && typeof row.value === "string") {
      const allowedValues = row.fact_key === "classification_event_kind"
        ? LISTING_EVENT_KINDS
        : row.fact_key === "classification_event_outcome"
          ? LISTING_EVENT_OUTCOMES
          : row.fact_key === "proceeding_kind"
            ? LISTING_PROCEEDING_KINDS.filter((item) => item !== "unknown")
            : row.fact_key === "proceeding_status"
              ? LISTING_PROCEEDING_STATUSES.filter((item) => item !== "unknown")
              : [];
      if (!oneOf(row.value, allowedValues)) errors.push(`${rowPath}.value is invalid for ${row.fact_key}`);
    }
  });
  return seen;
}

function validateSharedCategoricalSource(
  rows: Map<string, Record<string, unknown>>,
  keys: readonly string[],
  label: string,
  errors: string[],
) {
  const sourceRefs = keys.flatMap((key) => {
    const sourceRef = rows.get(key)?.source_ref;
    return typeof sourceRef === "string" ? [sourceRef] : [];
  });
  if (new Set(sourceRefs).size > 1) {
    errors.push(`facts[0].categorical_facts ${label} values must share one source_ref`);
  }
}

export function normalizeListingRiskAnalyzerFactEligibleProviderResult(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): ListingRiskAnalyzerResult | null {
  if (validateListingRiskAnalyzerProviderFactEligibility(value, input).length !== 0) return null;
  const providerResult = value as ListingRiskAnalyzerProviderResult;
  return providerResult.status === "not_applicable"
    ? { status: "not_applicable" }
    : { status: "applicable", facts: providerResult.applicable_facts[0] };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function nullableHttpUrl(value: unknown) {
  if (value === null) return true;
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function nullableText(value: unknown) {
  return value === null || nonEmptyText(value);
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function oneOf(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
