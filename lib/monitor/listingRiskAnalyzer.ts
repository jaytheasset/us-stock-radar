import {
  LISTING_DATE_STATUSES,
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_FACT_CONFIDENCES,
  LISTING_FACT_PATHS,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
  LISTING_RISK_EVENT_FACTS_VERSION,
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
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
export const LISTING_RISK_ANALYZER_PROMPT_VERSION = "listing_risk_domain_analyzer_v11";
export const LISTING_RISK_ANALYZER_MAX_DOCUMENTS = 48;
export const LISTING_RISK_ANALYZER_MAX_SOURCE_CHARS = 120_000;
export const LISTING_RISK_ANALYZER_MAX_PAYLOAD_CHARS = 24_000;

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
export const LISTING_RISK_PROVIDER_FACT_KEYS = [
  ...LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS,
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

type ProviderTextFactKey = (typeof LISTING_RISK_PROVIDER_TEXT_FACT_KEYS)[number];
type ProviderDateFactKey = (typeof LISTING_RISK_PROVIDER_DATE_FACT_KEYS)[number];
type ProviderCategoricalFactKey = (typeof LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS)[number];
type ProviderFactKey = (typeof LISTING_RISK_PROVIDER_FACT_KEYS)[number];
type ProviderQualifiedFactKey = Exclude<ProviderFactKey, ProviderCategoricalFactKey>;

type ListingRiskProviderAgentFactContextBase = {
  origin: Exclude<ListingFactOrigin, "deterministic_derived">;
  source_ref: string;
  evidence: string | null;
  confidence: Exclude<ListingFactConfidence, null>;
  as_of: string | null;
};

type ListingRiskProviderCategoricalAgentFactContext = ListingRiskProviderAgentFactContextBase & {
  key: ProviderCategoricalFactKey;
};

type ListingRiskProviderQualifiedAgentFactContext = ListingRiskProviderAgentFactContextBase & {
  key: ProviderQualifiedFactKey;
  value_quality: ListingValueQuality;
};

type ListingRiskProviderAgentFactContext =
  | ListingRiskProviderCategoricalAgentFactContext
  | ListingRiskProviderQualifiedAgentFactContext;

type ListingRiskProviderAvailableCoreFact = {
  key: ProviderFactKey;
  availability: "available";
  value: string;
  date_status: (typeof LISTING_DATE_STATUSES)[number] | "not_applicable";
  source_ref: string;
};

type ListingRiskProviderUnavailableCoreFact = {
  key: ProviderFactKey;
  availability: "unavailable";
};

type ListingRiskProviderCoreFact = ListingRiskProviderAvailableCoreFact | ListingRiskProviderUnavailableCoreFact;

export type ListingRiskAnalyzerTransportResult = {
  status: ListingRiskAnalyzerStatus;
  core_facts: ListingRiskProviderCoreFact[];
  agent_context: {
    fact_provenance: ListingRiskProviderAgentFactContext[];
    as_of:
      | {
          availability: "available";
          value: string;
          value_quality: ListingValueQuality;
          date_status: (typeof LISTING_DATE_STATUSES)[number];
          source_ref: string;
        }
      | { availability: "unavailable" };
    confidence: Exclude<ListingFactConfidence, null> | "unknown";
    sources: Array<{ source_ref: string }>;
  };
};

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

export function parseListingRiskAnalyzerTransportJson(value: string): {
  transport: ListingRiskAnalyzerTransportResult | null;
  errors: string[];
} {
  if (typeof value !== "string" || !value.trim()) {
    return { transport: null, errors: ["listing_risk_analyzer_transport_json must be a non-empty string"] };
  }
  if (Array.from(value).length > LISTING_RISK_ANALYZER_MAX_PAYLOAD_CHARS) {
    return {
      transport: null,
      errors: [`listing_risk_analyzer_transport_json must be ${LISTING_RISK_ANALYZER_MAX_PAYLOAD_CHARS} characters or fewer`],
    };
  }
  try {
    const parsed = parseJsonWithoutDuplicateKeys(value);
    if (!record(parsed)) {
      return { transport: null, errors: ["listing_risk_analyzer_transport_json must decode to an object"] };
    }
    return { transport: parsed as ListingRiskAnalyzerTransportResult, errors: [] };
  } catch (error) {
    return {
      transport: null,
      errors: [`listing_risk_analyzer_transport_json is invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`],
    };
  }
}

export function canonicalizeListingRiskAnalyzerTransportResult(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): { result: ListingRiskAnalyzerProviderResult | null; errors: string[] } {
  const errors = validateListingRiskAnalyzerTransportFactEligibility(value, input);
  if (errors.length) return { result: null, errors };
  const transport = value as ListingRiskAnalyzerTransportResult;
  if (transport.status === "not_applicable") {
    return { result: { status: "not_applicable", applicable_facts: [] }, errors: [] };
  }

  const providerFacts = new Map(transport.core_facts.map((fact) => [fact.key, fact]));
  const agentFacts = new Map(transport.agent_context.fact_provenance.map((fact) => [fact.key, {
    ...fact,
    value_quality: providerValueQuality(fact.key, fact),
  }]));
  const unavailableText = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  const unavailableDate = () => ({ ...unavailableText(), date_status: "unknown" as const });
  const availableText = (fact: ListingRiskProviderAvailableCoreFact) => ({
    value: fact.value,
    availability: "available" as const,
    value_quality: agentFacts.get(fact.key)!.value_quality as ListingValueQuality,
    source_ref: fact.source_ref,
  });
  const availableDate = (fact: ListingRiskProviderAvailableCoreFact) => ({
    value: fact.value,
    availability: "available" as const,
    value_quality: agentFacts.get(fact.key)!.value_quality as ListingValueQuality,
    date_status: fact.date_status as (typeof LISTING_DATE_STATUSES)[number],
    source_ref: fact.source_ref,
  });
  const text = (key: ProviderTextFactKey) => {
    const fact = providerFacts.get(key);
    return fact?.availability === "available" ? availableText(fact) : unavailableText();
  };
  const date = (key: ProviderDateFactKey) => {
    const fact = providerFacts.get(key);
    return fact?.availability === "available" ? availableDate(fact) : unavailableDate();
  };
  const continuedTrading = providerFacts.get("continued_trading_continues");
  const asOf = transport.agent_context.as_of.availability === "available" ? transport.agent_context.as_of : null;
  const documents = new Map(input.source_documents.map((document) => [document.source_ref, document]));
  const provenanceByPath = new Map<ListingFactPath, ListingRiskEventFacts["fact_provenance"][number]>();
  for (const row of transport.core_facts) {
    if (row.availability !== "available") continue;
    const context = agentFacts.get(row.key)!;
    const factPath = LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH[row.key];
    const issue = listingEvidenceIssue(context.evidence, documents.get(context.source_ref)!.text);
    provenanceByPath.set(factPath, {
      fact_path: factPath,
      origin: context.origin,
      source_ref: context.source_ref,
      evidence: issue ? null : context.evidence,
      evidence_status: issue ? "unavailable" : "available",
      evidence_issue: issue,
      confidence: context.confidence,
      as_of: context.as_of,
      formula_id: null,
      input_fact_paths: [],
    });
  }

  const sources = [...transport.agent_context.sources]
    .sort((left, right) => left.source_ref.localeCompare(right.source_ref))
    .map((source) => ({
      source_family: input.source_family,
      source_id: input.source_id,
      source_url: input.source_url,
      source_ref: source.source_ref,
      evidence: null,
    }));
  const eventKind = providerFacts.get("classification_event_kind") as ListingRiskProviderAvailableCoreFact;
  const eventOutcome = providerFacts.get("classification_event_outcome") as ListingRiskProviderAvailableCoreFact;
  const proceedingKind = providerFacts.get("proceeding_kind");
  const proceedingStatus = providerFacts.get("proceeding_status");
  const proceedingSourceRef = proceedingKind?.availability === "available"
    ? proceedingKind.source_ref
    : proceedingStatus?.availability === "available"
      ? proceedingStatus.source_ref
      : null;

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
      kind: (proceedingKind?.availability === "available" ? proceedingKind.value : "unknown") as ListingRiskEventFacts["proceeding"]["kind"],
      status: (proceedingStatus?.availability === "available" ? proceedingStatus.value : "unknown") as ListingRiskEventFacts["proceeding"]["status"],
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
        && continuedTrading.availability === "available"
        ? {
            value: continuedTrading.value === "true",
            availability: "available",
            value_quality: agentFacts.get("continued_trading_continues")!.value_quality as ListingValueQuality,
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
    confidence: transport.agent_context.confidence === "unknown" ? null : transport.agent_context.confidence,
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
  return validateListingRiskAnalyzerTransportContract(value, input, true);
}

export function validateListingRiskAnalyzerTransportFactEligibility(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): string[] {
  return validateListingRiskAnalyzerTransportContract(value, input, false);
}

function validateListingRiskAnalyzerTransportContract(
  value: unknown,
  input: ListingRiskAnalyzerInput,
  validateEvidenceQuality: boolean,
): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["listing_risk_analyzer_transport_result must be an object"];
  exactKeys(root, ["status", "core_facts", "agent_context"], "listing_risk_analyzer_transport_result", errors);
  if (!oneOf(root.status, ["applicable", "not_applicable"])) {
    errors.push("listing_risk_analyzer_transport_result.status is invalid");
  }
  if (!Array.isArray(root.core_facts)) {
    errors.push("listing_risk_analyzer_transport_result.core_facts must be an array");
    return errors;
  }
  if (root.status === "applicable" && root.core_facts.length !== LISTING_RISK_PROVIDER_FACT_KEYS.length) {
    errors.push(`applicable status requires exactly ${LISTING_RISK_PROVIDER_FACT_KEYS.length} core_facts`);
  }
  if (root.status === "not_applicable" && root.core_facts.length !== 0) {
    errors.push("not_applicable status requires an empty core_facts array");
  }
  const sourceRefs = new Set(input.source_documents.map((document) => document.source_ref));
  const coreFacts = validateTransportCoreFactRows(root.core_facts, sourceRefs, errors);
  if (root.status === "applicable") {
    for (const requiredKey of LISTING_RISK_PROVIDER_FACT_KEYS) {
      if (!coreFacts.has(requiredKey)) errors.push(`core_facts is missing required key ${requiredKey}`);
    }
    for (const requiredKey of ["classification_event_kind", "classification_event_outcome"] as const) {
      if (coreFacts.get(requiredKey)?.availability !== "available") {
        errors.push(`core_facts key ${requiredKey} must be available`);
      }
    }
    validateSharedFactSource(coreFacts, ["classification_event_kind", "classification_event_outcome"], "classification", errors);
    validateSharedFactSource(coreFacts, ["proceeding_kind", "proceeding_status"], "proceeding", errors);
  }

  const agentContext = record(root.agent_context);
  if (!agentContext) {
    errors.push("agent_context must be an object");
    return errors;
  }
  exactKeys(agentContext, ["fact_provenance", "as_of", "confidence", "sources"], "agent_context", errors);
  const agentFacts = validateTransportAgentFactRows(
    agentContext.fact_provenance,
    coreFacts,
    input,
    errors,
    validateEvidenceQuality,
  );
  if (root.status === "applicable") {
    for (const [key, row] of coreFacts) {
      if (row.availability === "available" && !agentFacts.has(key)) {
        errors.push(`agent_context.fact_provenance is missing available core fact ${key}`);
      }
    }
  }
  if (root.status === "not_applicable" && Array.isArray(agentContext.fact_provenance) && agentContext.fact_provenance.length !== 0) {
    errors.push("not_applicable status requires empty agent_context.fact_provenance");
  }

  validateTransportAsOf(agentContext.as_of, sourceRefs, errors);
  if (root.status === "not_applicable" && record(agentContext.as_of)?.availability !== "unavailable") {
    errors.push("not_applicable status requires unavailable as_of");
  }
  if (!oneOf(agentContext.confidence, [...LISTING_FACT_CONFIDENCES, "unknown"])) {
    errors.push("confidence is invalid");
  }
  if (root.status === "not_applicable" && agentContext.confidence !== "unknown") {
    errors.push("not_applicable status requires unknown confidence");
  }
  const catalogRefs = validateTransportSources(agentContext.sources, sourceRefs, errors);
  if (root.status === "not_applicable" && Array.isArray(agentContext.sources) && agentContext.sources.length !== 0) {
    errors.push("not_applicable status requires an empty sources array");
  }
  if (root.status === "applicable") {
    const citedRefs = new Set<string>();
    for (const row of coreFacts.values()) {
      if (row.availability === "available" && typeof row.source_ref === "string") citedRefs.add(row.source_ref);
    }
    const asOf = record(agentContext.as_of);
    if (asOf?.availability === "available" && typeof asOf.source_ref === "string") citedRefs.add(asOf.source_ref);
    for (const sourceRef of citedRefs) {
      if (!catalogRefs.has(sourceRef)) errors.push(`sources is missing cited source_ref ${sourceRef}`);
    }
    for (const sourceRef of catalogRefs) {
      if (!citedRefs.has(sourceRef)) errors.push(`sources contains uncited source_ref ${sourceRef}`);
    }
  }
  return errors;
}

function validateTransportCoreFactRows(
  value: unknown,
  sourceRefs: Set<string>,
  errors: string[],
) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) {
    errors.push("core_facts must be an array");
    return seen;
  }
  if (rows.length > LISTING_RISK_PROVIDER_FACT_KEYS.length) errors.push("core_facts contains too many items");
  rows.forEach((rowValue, index) => {
    const rowPath = `core_facts[${index}]`;
    const row = record(rowValue);
    if (!row) {
      errors.push(`${rowPath} must be an object`);
      return;
    }
    if (row.availability === "unavailable") {
      exactKeys(row, ["key", "availability"], rowPath, errors);
    } else {
      exactKeys(row, [
        "key",
        "availability",
        "value",
        "date_status",
        "source_ref",
      ], rowPath, errors);
    }
    const rowKey = typeof row.key === "string" ? row.key : null;
    if (!rowKey || !(LISTING_RISK_PROVIDER_FACT_KEYS as readonly string[]).includes(rowKey)) {
      errors.push(`${rowPath}.key is invalid`);
    } else if (seen.has(rowKey)) {
      errors.push(`${rowPath}.key must be unique`);
    } else {
      seen.set(rowKey, row);
    }
    if (!oneOf(row.availability, ["available", "unavailable"])) {
      errors.push(`${rowPath}.availability is invalid`);
      return;
    }
    if (row.availability === "unavailable") return;
    if (!nonEmptyText(row.source_ref) || !sourceRefs.has(row.source_ref)) {
      errors.push(`${rowPath}.source_ref must identify a supplied source document`);
    }
    if (!nonEmptyText(row.value)) errors.push(`${rowPath}.value must be a non-empty string`);

    if (oneOf(row.key, LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS)) {
      if (row.date_status !== "not_applicable") errors.push(`${rowPath}.date_status must be not_applicable for ${row.key}`);
      const allowedValues = row.key === "classification_event_kind"
        ? LISTING_EVENT_KINDS
        : row.key === "classification_event_outcome"
          ? LISTING_EVENT_OUTCOMES
          : row.key === "proceeding_kind"
            ? LISTING_PROCEEDING_KINDS.filter((item) => item !== "unknown")
            : row.key === "proceeding_status"
              ? LISTING_PROCEEDING_STATUSES.filter((item) => item !== "unknown")
              : [];
      if (!oneOf(row.value, allowedValues)) errors.push(`${rowPath}.value is invalid for ${row.key}`);
    } else if (oneOf(row.key, LISTING_RISK_PROVIDER_DATE_FACT_KEYS)) {
      if (!validDate(row.value)) errors.push(`${rowPath}.value must be YYYY-MM-DD for ${row.key}`);
      if (!oneOf(row.date_status, LISTING_DATE_STATUSES)) errors.push(`${rowPath}.date_status is invalid for ${row.key}`);
    } else if (oneOf(row.key, LISTING_RISK_PROVIDER_BOOLEAN_FACT_KEYS)) {
      if (row.value !== "true" && row.value !== "false") errors.push(`${rowPath}.value must be true or false for ${row.key}`);
      if (row.date_status !== "not_applicable") errors.push(`${rowPath}.date_status must be not_applicable for ${row.key}`);
    } else if (oneOf(row.key, LISTING_RISK_PROVIDER_TEXT_FACT_KEYS)) {
      if (row.date_status !== "not_applicable") errors.push(`${rowPath}.date_status must be not_applicable for ${row.key}`);
    }
  });
  return seen;
}

function validateTransportAgentFactRows(
  value: unknown,
  coreFacts: Map<string, Record<string, unknown>>,
  input: ListingRiskAnalyzerInput,
  errors: string[],
  validateEvidenceQuality: boolean,
) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) {
    errors.push("agent_context.fact_provenance must be an array");
    return seen;
  }
  const documents = new Map(input.source_documents.map((document) => [document.source_ref, document]));
  rows.forEach((rowValue, index) => {
    const path = `agent_context.fact_provenance[${index}]`;
    const row = record(rowValue);
    if (!row) {
      errors.push(`${path} must be an object`);
      return;
    }
    const key = typeof row.key === "string" ? row.key : "";
    if (oneOf(key, LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS)) {
      exactKeys(row, ["key", "origin", "source_ref", "evidence", "confidence", "as_of"], path, errors);
    } else {
      exactKeys(row, ["key", "value_quality", "origin", "source_ref", "evidence", "confidence", "as_of"], path, errors);
    }
    if (!(LISTING_RISK_PROVIDER_FACT_KEYS as readonly string[]).includes(key)) {
      errors.push(`${path}.key is invalid`);
    } else if (seen.has(key)) {
      errors.push(`${path}.key must be unique`);
    } else {
      seen.set(key, row);
    }
    const core = coreFacts.get(key);
    if (!core || core.availability !== "available") {
      errors.push(`${path}.key must identify an available core fact`);
    }
    if (!oneOf(row.origin, ["source_stated", "domain_interpreted"])) errors.push(`${path}.origin is invalid`);
    if (!nonEmptyText(row.source_ref) || !documents.has(row.source_ref)) {
      errors.push(`${path}.source_ref must identify a supplied source document`);
    } else if (core?.source_ref !== row.source_ref) {
      errors.push(`${path}.source_ref must match the core fact`);
    }
    if (!(row.evidence === null || typeof row.evidence === "string")) {
      errors.push(`${path}.evidence must be a string or null`);
    } else if (validateEvidenceQuality) {
      const document = typeof row.source_ref === "string" ? documents.get(row.source_ref) : null;
      const issue = document ? listingEvidenceIssue(row.evidence, document.text) : null;
      if (issue === "not_provided") errors.push(`${path}.evidence must be provided as a non-empty string`);
      if (issue === "too_long") errors.push(`${path}.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer`);
      if (issue === "not_exact_span") errors.push(`${path}.evidence must be a contiguous excerpt from the supplied source document`);
    }
    if (!oneOf(row.confidence, LISTING_FACT_CONFIDENCES)) errors.push(`${path}.confidence is invalid`);
    if (!(row.as_of === null || validDate(row.as_of))) errors.push(`${path}.as_of is invalid`);
    if (!oneOf(key, LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS) && !oneOf(row.value_quality, LISTING_VALUE_QUALITIES)) {
      errors.push(`${path}.value_quality is invalid for ${key}`);
    }
  });
  return seen;
}

function providerValueQuality(
  key: ProviderFactKey,
  context: ListingRiskProviderAgentFactContext,
): ListingValueQuality | "not_applicable" {
  return oneOf(key, LISTING_RISK_PROVIDER_CATEGORICAL_FACT_KEYS)
    ? "not_applicable"
    : (context as ListingRiskProviderQualifiedAgentFactContext).value_quality;
}

function validateSharedFactSource(
  rows: Map<string, Record<string, unknown>>,
  keys: readonly string[],
  label: string,
  errors: string[],
) {
  const sourceRefs = keys.flatMap((key) => {
    const row = rows.get(key);
    const sourceRef = row?.availability === "available" ? row.source_ref : null;
    return typeof sourceRef === "string" ? [sourceRef] : [];
  });
  if (new Set(sourceRefs).size > 1) {
    errors.push(`facts ${label} values must share one source_ref`);
  }
}

function validateTransportAsOf(value: unknown, sourceRefs: Set<string>, errors: string[]) {
  const asOf = record(value);
  if (!asOf) {
    errors.push("as_of must be an object");
    return;
  }
  if (asOf.availability === "unavailable") {
    exactKeys(asOf, ["availability"], "as_of", errors);
    return;
  }
  exactKeys(asOf, ["availability", "value", "value_quality", "date_status", "source_ref"], "as_of", errors);
  if (asOf.availability !== "available") errors.push("as_of.availability is invalid");
  if (!validDate(asOf.value)) errors.push("as_of.value is invalid");
  if (!oneOf(asOf.value_quality, LISTING_VALUE_QUALITIES)) errors.push("as_of.value_quality is invalid");
  if (!oneOf(asOf.date_status, LISTING_DATE_STATUSES)) errors.push("as_of.date_status is invalid");
  if (!nonEmptyText(asOf.source_ref) || !sourceRefs.has(asOf.source_ref)) {
    errors.push("as_of.source_ref must identify a supplied source document");
  }
}

function validateTransportSources(value: unknown, sourceRefs: Set<string>, errors: string[]) {
  const catalogRefs = new Set<string>();
  if (!Array.isArray(value)) {
    errors.push("sources must be an array");
    return catalogRefs;
  }
  value.forEach((sourceValue, index) => {
    const path = `sources[${index}]`;
    const source = record(sourceValue);
    if (!source) {
      errors.push(`${path} must be an object`);
      return;
    }
    exactKeys(source, ["source_ref"], path, errors);
    if (!nonEmptyText(source.source_ref) || !sourceRefs.has(source.source_ref)) {
      errors.push(`${path}.source_ref must identify a supplied source document`);
    } else if (catalogRefs.has(source.source_ref)) {
      errors.push(`${path}.source_ref must be unique`);
    } else {
      catalogRefs.add(source.source_ref);
    }
  });
  return catalogRefs;
}

function listingEvidenceIssue(value: unknown, sourceText: string) {
  if (typeof value !== "string" || !value.trim()) return "not_provided" as const;
  if (Array.from(value).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH) return "too_long" as const;
  if (!sourceText.includes(value)) return "not_exact_span" as const;
  return null;
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

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0;
  const fail = (message: string): never => {
    throw new Error(`${message} at character ${index}`);
  };
  const skipWhitespace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };
  const parseString = () => {
    if (text[index] !== '"') fail("JSON string must start with a quote");
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code < 0x20) fail("unescaped control character");
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          fail("invalid JSON string escape");
        }
      }
      index += 1;
    }
    return fail("unterminated JSON string");
  };
  const parseValue = (): unknown => {
    skipWhitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const result = Object.create(null) as Record<string, unknown>;
      const seen = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        skipWhitespace();
        if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        seen.add(key);
        if (text[index] !== ":") fail("missing colon");
        index += 1;
        result[key] = parseValue();
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("missing comma");
        index += 1;
      }
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      const result: unknown[] = [];
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      while (true) {
        result.push(parseValue());
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("missing comma");
        index += 1;
      }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(token, index)) {
        index += token.length;
        return parsed;
      }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) return fail("invalid JSON value");
    index += number[0].length;
    return Number(number[0]);
  };
  const result = parseValue();
  skipWhitespace();
  if (index !== text.length) fail("trailing content");
  return result;
}
