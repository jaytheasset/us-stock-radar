import {
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA,
  type ListingRiskEventFacts,
  validateListingRiskEventFacts,
} from "./listingRiskFacts.ts";

export const LISTING_RISK_ANALYZER_INPUT_VERSION = "listing_risk_analyzer_input_v1";
export const LISTING_RISK_ANALYZER_PROMPT_VERSION = "listing_risk_domain_analyzer_v1";
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

const LISTING_RISK_EVENT_FACTS_GEMINI_SCHEMA = toGeminiResponseSchema(
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA as unknown as Record<string, unknown>,
);

export const LISTING_RISK_ANALYZER_PROVIDER_SCHEMA = {
  type: "object",
  required: ["status", "applicable_facts"],
  properties: {
    status: { type: "string", enum: ["applicable", "not_applicable"] },
    applicable_facts: {
      type: "array",
      maxItems: 1,
      items: LISTING_RISK_EVENT_FACTS_GEMINI_SCHEMA,
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
    errors.push(...validateListingRiskEventFacts(facts).map((error) => `applicable_facts[0]: ${error}`));
    if (input) errors.push(...validateFactsSourceIdentity(facts, input));
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

function validateFactsSourceIdentity(value: unknown, input: ListingRiskAnalyzerInput) {
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
  });
  return errors;
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
