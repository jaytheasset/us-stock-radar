import {
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  LISTING_RISK_PROVIDER_FACT_KEYS,
  type ListingRiskAnalyzerInput,
} from "../monitor/listingRiskAnalyzer.ts";
import {
  LISTING_AVAILABILITIES,
  LISTING_DATE_STATUSES,
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_FACT_CONFIDENCES,
  LISTING_FACT_ORIGINS,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
  LISTING_VALUE_QUALITIES,
} from "../monitor/listingRiskFacts.ts";
import {
  LEVEL2_SHARE_COUNT_OBSERVATION_FIELD,
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
} from "../sec-structured-data/level2ShareCountObservation.ts";

export const LISTING_RISK_DOMAIN_ANALYZER_PROMPT_KEY = "listing_risk_domain_analyzer";

const EVENT_KIND_MEANINGS = {
  deficiency_notice: "the current source establishes a new exchange notice that a continued-listing requirement is not met",
  compliance_recovery: "the current source confirms that the exchange has already found compliance regained",
  delisting_determination: "the current source establishes an exchange determination that the security is subject to delisting",
  hearing_or_appeal_update: "the current source establishes a new hearing or appeal request, schedule, status, or decision",
  trading_suspension: "the current source establishes a listing-related trading suspension action",
  listing_removal: "the current source establishes actual or effective removal or termination of the listing",
  voluntary_withdrawal: "the current source establishes an issuer-initiated withdrawal of the listing",
  other: "the current source establishes another material listing-status action that none of the preceding literals describes",
} as const satisfies Record<(typeof LISTING_EVENT_KINDS)[number], string>;

const EVENT_OUTCOME_MEANINGS = {
  adverse: "the current event worsens or threatens listing standing",
  recovered: "the exchange has confirmed that compliance was regained",
  procedural: "the current event is a process or administrative step that is not itself an adverse or recovered outcome",
  unknown: "the current source does not establish which outcome literal applies",
} as const satisfies Record<(typeof LISTING_EVENT_OUTCOMES)[number], string>;

const VALUE_QUALITY_MEANINGS = {
  exact: "the source supports the value at the exact precision represented",
  derived: "the represented value is a source-supported semantic normalization or derivation rather than an exact source rendering; this does not mean deterministic_derived origin",
  estimated: "the source presents the value as approximate or estimated",
  unknown: "the value is available but its precision or quality cannot be established",
} as const satisfies Record<(typeof LISTING_VALUE_QUALITIES)[number], string>;

const DATE_STATUS_MEANINGS = {
  occurred: "the dated event has already occurred as of the current source",
  scheduled: "the source establishes a fixed future scheduled date",
  conditional: "the date applies only if a stated condition occurs",
  unknown: "the source does not establish the date's event-state role",
} as const satisfies Record<(typeof LISTING_DATE_STATUSES)[number], string>;

const ORIGIN_MEANINGS = {
  source_stated: "the source directly states the fact value",
  domain_interpreted: "the Listing Domain Analyzer classifies or normalizes source-supported meaning",
  deterministic_derived: "deterministic application code mechanically derives the fact from canonical input facts; the provider must never output this literal",
} as const satisfies Record<(typeof LISTING_FACT_ORIGINS)[number], string>;

const PROCEEDING_KIND_MEANINGS = {
  hearing: "the proceeding is a listing hearing",
  appeal: "the proceeding is a listing appeal",
  other: "the source establishes another listing proceeding type",
  unknown: "the source does not establish the proceeding type",
} as const satisfies Record<(typeof LISTING_PROCEEDING_KINDS)[number], string>;

const PROCEEDING_STATUS_MEANINGS = {
  intended: "the source states an intention to pursue the proceeding but no request has been made",
  requested: "the proceeding has been requested",
  pending: "the proceeding is awaiting action or decision",
  decided: "the proceeding has received a decision",
  not_pursued: "the source establishes that the proceeding will not be pursued",
  unknown: "the source does not establish the proceeding status",
} as const satisfies Record<(typeof LISTING_PROCEEDING_STATUSES)[number], string>;

const PROVIDER_ORIGINS = LISTING_FACT_ORIGINS.filter((origin) => origin !== "deterministic_derived");

function glossaryLine<T extends string>(
  field: string,
  values: readonly T[],
  meanings: Record<T, string>,
) {
  return `${field} exact literals: ${values.map((value) => `${value} = ${meanings[value]}`).join("; ")}.`;
}

export const LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY = [
  glossaryLine("classification_event_kind.value", LISTING_EVENT_KINDS, EVENT_KIND_MEANINGS),
  glossaryLine("classification_event_outcome.value", LISTING_EVENT_OUTCOMES, EVENT_OUTCOME_MEANINGS),
  glossaryLine("value_quality", LISTING_VALUE_QUALITIES, VALUE_QUALITY_MEANINGS),
  glossaryLine("date_status", LISTING_DATE_STATUSES, DATE_STATUS_MEANINGS),
  glossaryLine("origin", LISTING_FACT_ORIGINS, ORIGIN_MEANINGS),
  glossaryLine("proceeding_kind.value", LISTING_PROCEEDING_KINDS, PROCEEDING_KIND_MEANINGS),
  glossaryLine("proceeding_status.value", LISTING_PROCEEDING_STATUSES, PROCEEDING_STATUS_MEANINGS),
  `Provider origin exact literals are ${PROVIDER_ORIGINS.join(", ")}; deterministic_derived is code-only and is invalid in provider output.`,
  `availability exact literals are ${LISTING_AVAILABILITIES.join(", ")}: available means this current source supports the fact; unavailable means this current source does not support the fact and the row must contain only key and availability.`,
  `Fact confidence exact literals are ${LISTING_FACT_CONFIDENCES.join(", ")}; root confidence exact literals are ${[...LISTING_FACT_CONFIDENCES, "unknown"].join(", ")}. Fact confidence has no unknown literal.`,
  "Enum fields contain exactly one listed literal, never a synonym, label, explanation, or combined phrase. For example, output deficiency_notice exactly, never deficiency or listing deficiency.",
  "value_quality describes the represented value's precision or directness. origin describes how that value was produced. They are independent fields: a domain_interpreted fact may have derived value_quality without becoming deterministic_derived.",
  "date_status describes the event-state role of a date, not the date string format. Date values use YYYY-MM-DD independently of occurred, scheduled, conditional, or unknown.",
  "Each available fact as_of is provenance metadata: use one YYYY-MM-DD date when that individual fact has a source-supported observation or effective basis date, otherwise null. It is not an availability envelope.",
  "Root as_of describes the basis date for the complete canonical fact result and is a typed date envelope. Return either exactly {availability: unavailable} or {availability: available, value: YYYY-MM-DD, value_quality: exact|derived|estimated|unknown, date_status: occurred|scheduled|conditional|unknown, source_ref: a supplied source_ref}. Do not copy another date into root or fact as_of without source support.",
].join("\n");

export const LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF = "example_listing_notice";
export const LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_TEXT =
  "On March 2, 2030, Example Issuer received a deficiency notice from the Example Exchange stating that its common shares did not meet Listing Rule X-1, which requires a minimum closing price of 1.00. Trading continues on the Example Exchange while the issuer has until September 1, 2030 to regain compliance.";

const coreFact = (
  key: (typeof LISTING_RISK_PROVIDER_FACT_KEYS)[number],
  value: string,
  date_status: "occurred" | "scheduled" | "conditional" | "unknown" | "not_applicable",
) => ({
  key,
  availability: "available" as const,
  value,
  date_status,
  source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
});

const agentFact = (
  key: (typeof LISTING_RISK_PROVIDER_FACT_KEYS)[number],
  value_quality: "exact" | "derived" | "estimated" | "unknown",
  origin: "source_stated" | "domain_interpreted",
  evidence: string,
) => ({
  key,
  value_quality,
  origin,
  source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
  evidence,
  confidence: "high" as const,
  as_of: "2030-03-02",
});

const categoricalAgentFact = (
  key: "classification_event_kind" | "classification_event_outcome" | "proceeding_kind" | "proceeding_status",
  origin: "source_stated" | "domain_interpreted",
  evidence: string,
) => ({
  key,
  origin,
  source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
  evidence,
  confidence: "high" as const,
  as_of: "2030-03-02",
});

const unavailableFact = (key: (typeof LISTING_RISK_PROVIDER_FACT_KEYS)[number]) => ({
  key,
  availability: "unavailable" as const,
});

export const LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE = {
  status: "applicable",
  core_facts: [
    coreFact("classification_event_kind", "deficiency_notice", "not_applicable"),
    coreFact("notice_date", "2030-03-02", "occurred"),
    coreFact("compliance_deadline", "2030-09-01", "scheduled"),
    unavailableFact("exchange"),
  ],
  agent_context: {
    fact_provenance: [
      categoricalAgentFact("classification_event_kind", "domain_interpreted", "received a deficiency notice"),
      agentFact("notice_date", "exact", "source_stated", "On March 2, 2030"),
      agentFact("compliance_deadline", "exact", "source_stated", "until September 1, 2030 to regain compliance"),
    ],
    as_of: {
      availability: "available",
      value: "2030-03-02",
      value_quality: "exact",
      date_status: "occurred",
      source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
    },
    confidence: "high",
    sources: [{ source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF }],
  },
} as const;

export const LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT = [
  "You are the Listing Risk Domain Monitor Analyzer. Analyze one supplied source for listing-related event facts newly established by that source.",
  "The structured listing_risk_event_facts_v2 fields are the primary product output consumed by downstream Monitor conditions and external agents. Evidence supports those structured facts; evidence never replaces a supported structured field.",
  "The complete source_documents are the source of truth. primary_context is optional routing and summary context only; it is not evidence, does not make the result applicable, and must never be cited.",
  "Return status applicable only when the current source establishes an actual new listing-related event fact, such as a deficiency or compliance action, compliance recovery, delisting determination, hearing or appeal update, listing-related suspension, removal, withdrawal, termination, or another material listing-status action. Otherwise return not_applicable as a successful semantic result, not as failure or low confidence.",
  "Judge the current event, not the issuer's overall listing history. A historical deficiency repeated only as background is not a new deficiency. It becomes applicable only if this source establishes a new listing fact such as a changed deadline, hearing decision, recovery, suspension, or removal action.",
  "A simple reverse split without an explicit current listing or compliance action is not_applicable. A reverse split source may be applicable when the current source itself establishes a material listing-compliance action or status change. The split ratio is not a Listing Risk fact.",
  "Regained compliance is applicable and uses compliance_recovery with the recovered outcome only when the source confirms that the exchange has already found compliance regained. An intended, planned, or pending cure action to regain compliance is not a recovery; use another source-supported event kind and outcome without claiming recovery.",
  "A merger cleanup, security substitution, successor listing, or voluntary withdrawal can be applicable and may be procedural; do not force adverse merely because a security is removed.",
  "Keep notice date, compliance deadline, hearing date, appeal deadline, trading suspension date, and removal effective date distinct. Never copy one date into another role. Use unavailable fields when the source does not establish a value, rule, security basis, venue, or date.",
  "The LLM owns listing meaning. Do not infer applicability from event_type, monitor_routes, source family, form, exchange names, rule numbers, keywords, or regex-like word matches.",
  `Return one complete JSON object directly. Do not use markdown fences, prose, explanations, prefixes, suffixes, a payload wrapper, or JSON embedded inside a string. The root has exactly status, core_facts, agent_context, and optional ${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.`,
  "Core Monitor Facts are the condition-evaluation layer. For applicable, return all 19 canonical fact keys exactly once in core_facts, each with explicit availability available or unavailable. Never omit a known fact and never invent another key. Return every source-supported condition-relevant listing_risk_event_facts_v2 value, including supported exchange, rule or requirement, affected security and security basis, proceeding, distinct date roles, compliance period, and continued trading. Continue through all supported facts; do not stop after classification or after finding evidence.",
  "For not_applicable, return status not_applicable, core_facts [], and agent_context {fact_provenance: [], as_of: {availability: unavailable}, confidence: unknown, sources: []}. Do not create fake facts, provenance, sources, or evidence.",
  "Distinguish semantic inference from schema-required mechanical representation. You may represent an explicitly source-supported value in the exact required schema shape, but must not change, complete, correct, calculate, or supplement its semantic value.",
  "Use only supplied source_ref values, and each source_ref must identify the exact source_document that supports that fact. Deterministic application code copies the analyzer input source_family, source_id, and source_url into the unchanged canonical sources array; do not output or infer source identity fields.",
  "Agent Context is separate from Core Monitor Facts. agent_context has exactly fact_provenance, as_of, confidence, and sources. Canonical fact_provenance is authoritative for fact-level provenance; deterministic application code maps each known key to one stable fact_path and joins source_ref to the canonical source catalog for source_url. Agent Context never replaces or changes a Core value.",
  "Duplicate, missing, and unknown Core keys are invalid. classification_event_kind and classification_event_outcome must be available for applicable results. For every other unsupported key return exactly {key, availability: unavailable}; application code creates only that explicitly authorized canonical unavailable envelope. Never mark a supported condition-relevant fact unavailable. For unknown proceeding meaning, return proceeding_kind and proceeding_status as unavailable rather than inventing a value.",
  "Use each generic key at most once: classification_event_kind, classification_event_outcome, proceeding_kind, proceeding_status, exchange, affected_security_title, affected_security_ticker, affected_security_security_basis, listing_rule, listing_requirement, compliance_period, continued_trading_venue, notice_date, compliance_deadline, hearing_date, appeal_deadline, trading_suspension_date, removal_effective_date, continued_trading_continues. Array order has no meaning. Do not create rows for root confidence, availability, source_ref, evidence status, or other metadata.",
  "Every available core_facts row has exactly key, availability, value, date_status, and source_ref. value is always a JSON string. For continued_trading_continues use exactly the string true or false. For date keys use YYYY-MM-DD and preserve LLM-owned date_status. For classification, proceeding, text, and boolean keys use date_status not_applicable. Every unavailable Core row has exactly key and availability.",
  "For every available Core row, return exactly one agent_context.fact_provenance row using the same key and source_ref. Do not create provenance for unavailable Core rows. For exactly classification_event_kind, classification_event_outcome, proceeding_kind, and proceeding_status, the provenance row has exactly key, origin, source_ref, evidence, confidence, and as_of: do not output value_quality because deterministic application code assigns the schema-fixed not_applicable quality for these categorical paths. For every other key, the provenance row has exactly key, value_quality, origin, source_ref, evidence, confidence, and as_of, and value_quality must be one canonical literal. Preserve non-categorical value_quality independently from origin.",
  LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY,
  "Set origin source_stated when the fact value is directly stated by the source. Set origin domain_interpreted when Listing-domain meaning or normalization is required, including classification and semantic security-basis normalization. value_quality and origin are independent: value_quality derived does not mean deterministic_derived. Never output deterministic_derived; only deterministic application code may create that origin with a formula and input facts.",
  "Every available Core and matching provenance source_ref must identify the exact source_document supporting that fact. Evidence must be the shortest unambiguous exact span sufficient to verify only that fact, not a general event summary. Deterministic application code maps each key to stable fact_path and mechanically records evidence availability or issue without changing Core facts.",
  "For each evidence value, select and copy exactly one continuous span verbatim from the cited source_document.text. The hard runtime contract is source_document.text.includes(evidence) === true.",
  "Evidence copying is character-for-character: do not change or normalize whitespace, line breaks, case, punctuation, quotation marks, apostrophes, hyphens or dashes, Unicode characters, numbers, or date formatting. Do not retype, paraphrase, summarize, correct grammar, join non-contiguous passages, or delete words from the middle of a span.",
  "A complete sentence is not required. Select the smallest useful supporting span, with a practical target of 150 to 280 characters; shorter evidence is allowed, and the hard maximum is 520 characters.",
  "Every available Core fact and matching provenance row must cite a supplied source_ref. Root agent_context.as_of remains LLM-owned: return either exactly {availability: unavailable} or an available object with exactly availability, value, value_quality, date_status, and source_ref. Never infer as_of from another date.",
  "For applicable, agent_context.sources is the exact cited source catalog. Include each source_ref cited by an available Core fact or available as_of exactly once and no uncited source_ref. Each source row has exactly source_ref. Application code copies source_family, source_id, source_url, and null source-level compatibility evidence from the analyzer input; fact-level evidence is authoritative.",
  `Short educational row example only, not a complete response; a real applicable response must still include all 19 Core keys and every matching provenance row (example source_document.text is ${JSON.stringify(LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_TEXT)}): ${JSON.stringify(LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE)}`,
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
  "Do not guess missing values. Do not calculate, correct, replace, or supply fallback fact values. Return only the direct JSON object matching this contract.",
].join("\n");

export function buildListingRiskDomainAnalysisPrompt(input: ListingRiskAnalyzerInput) {
  return {
    key: LISTING_RISK_DOMAIN_ANALYZER_PROMPT_KEY,
    version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
    system: LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT,
    user: JSON.stringify(input, null, 2),
    responseFormat: {
      json_schema: {
        name: "listing_risk_domain_analyzer_result",
        strict: true as const,
        schema: { type: "object" as const },
      },
    },
  };
}
