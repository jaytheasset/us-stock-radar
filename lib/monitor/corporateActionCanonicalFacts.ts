import { parseJsonWithoutDuplicateKeys } from "./listingRiskAnalyzer.ts";

export const CORPORATE_ACTION_ANALYZER_INPUT_VERSION = "corporate_action_analyzer_input_v1";
export const CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION = "corporate_action_reverse_split_analyzer_v1";
export const CORPORATE_ACTION_FACTS_VERSION = "corporate_action_reverse_split_facts_v1";
export const CORPORATE_ACTION_EVIDENCE_MAX_LENGTH = 520;

export const CORPORATE_ACTION_STAGES = [
  "announced",
  "board_approved",
  "shareholder_approved",
  "scheduled",
  "effective",
  "unknown",
] as const;

export const CORPORATE_ACTION_CONFIDENCES = ["high", "medium", "low"] as const;

export type CorporateActionStage = (typeof CORPORATE_ACTION_STAGES)[number];
export type CorporateActionConfidence = (typeof CORPORATE_ACTION_CONFIDENCES)[number];
export type CorporateActionSourceFamily = "nasdaq" | "news" | "sec";

export type CorporateActionSourceDocument = {
  source_ref: string;
  label: string | null;
  text: string;
};

export type CorporateActionAnalyzerInput = {
  version: typeof CORPORATE_ACTION_ANALYZER_INPUT_VERSION;
  source_family: CorporateActionSourceFamily;
  source_id: string;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  source_documents: CorporateActionSourceDocument[];
};

type Unavailable = { availability: "unavailable" };
type AvailableDate = { availability: "available"; value: string };

export type CorporateActionAnalyzerTransportResult =
  | { applicable: false }
  | {
      applicable: true;
      event_kind: "reverse_split";
      action_stage: CorporateActionStage;
      effective_date: Unavailable | AvailableDate;
      ratio:
        | Unavailable
        | {
            availability: "available";
            old_shares: string;
            new_shares: string;
          };
      source_ref: string;
      evidence: string | null;
      confidence: CorporateActionConfidence;
      as_of: Unavailable | AvailableDate;
    };

export type CorporateActionCanonicalFacts = {
  version: typeof CORPORATE_ACTION_FACTS_VERSION;
  event_kind: "reverse_split";
  action_stage: CorporateActionStage;
  effective_date: Unavailable | AvailableDate;
  ratio: {
    old_shares_per_new_share:
      | Unavailable
      | { availability: "available"; value: number };
  };
  source_ref: string;
  evidence:
    | { availability: "available"; value: string }
    | {
        availability: "unavailable";
        reason: "not_provided" | "too_long" | "not_exact_span";
      };
  confidence: CorporateActionConfidence;
  as_of: Unavailable | AvailableDate;
  source: {
    source_family: CorporateActionSourceFamily;
    source_id: string;
    source_url: string | null;
  };
};

export type CorporateActionAnalyzerResult =
  | { applicable: false }
  | { applicable: true; facts: CorporateActionCanonicalFacts };

export function validateCorporateActionAnalyzerInput(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["input must be an object"];
  exactKeys(root, [
    "version",
    "source_family",
    "source_id",
    "source_url",
    "published_at",
    "title",
    "source_documents",
  ], "input", errors);
  if (root.version !== CORPORATE_ACTION_ANALYZER_INPUT_VERSION) errors.push("input.version is invalid");
  if (!oneOf(root.source_family, ["nasdaq", "news", "sec"])) errors.push("input.source_family is invalid");
  if (!boundedText(root.source_id, 240)) errors.push("input.source_id is required");
  if (!nullableHttpUrl(root.source_url)) errors.push("input.source_url is invalid");
  if (!(root.published_at === null || validTimestamp(root.published_at))) errors.push("input.published_at is invalid");
  if (!(root.title === null || boundedText(root.title, 500))) errors.push("input.title is invalid");
  if (!Array.isArray(root.source_documents) || root.source_documents.length < 1 || root.source_documents.length > 48) {
    errors.push("input.source_documents must contain 1 to 48 documents");
    return errors;
  }
  const refs = new Set<string>();
  let totalChars = 0;
  root.source_documents.forEach((value, index) => {
    const path = `input.source_documents[${index}]`;
    const document = record(value);
    if (!document) {
      errors.push(`${path} must be an object`);
      return;
    }
    exactKeys(document, ["source_ref", "label", "text"], path, errors);
    if (!stableSourceRef(document.source_ref)) {
      errors.push(`${path}.source_ref is invalid`);
    } else if (refs.has(document.source_ref)) {
      errors.push(`${path}.source_ref must be unique`);
    } else {
      refs.add(document.source_ref);
    }
    if (!(document.label === null || boundedText(document.label, 240))) errors.push(`${path}.label is invalid`);
    if (!boundedText(document.text, 120_000)) errors.push(`${path}.text is required`);
    if (typeof document.text === "string") totalChars += document.text.length;
  });
  if (totalChars > 120_000) errors.push("input source text is too large");
  return errors;
}

export function parseCorporateActionAnalyzerTransportJson(value: string): {
  transport: CorporateActionAnalyzerTransportResult | null;
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = parseJsonWithoutDuplicateKeys(value);
  } catch (error) {
    return { transport: null, errors: [error instanceof Error ? error.message : "invalid JSON"] };
  }
  const errors = validateCorporateActionAnalyzerTransportResult(parsed);
  return errors.length
    ? { transport: null, errors }
    : { transport: parsed as CorporateActionAnalyzerTransportResult, errors: [] };
}

export function validateCorporateActionAnalyzerTransportResult(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["result must be an object"];
  if (root.applicable === false) {
    exactKeys(root, ["applicable"], "result", errors);
    return errors;
  }
  exactKeys(root, [
    "applicable",
    "event_kind",
    "action_stage",
    "effective_date",
    "ratio",
    "source_ref",
    "evidence",
    "confidence",
    "as_of",
  ], "result", errors);
  if (root.applicable !== true) errors.push("result.applicable must be boolean");
  if (root.event_kind !== "reverse_split") errors.push("result.event_kind must be reverse_split");
  if (!oneOf(root.action_stage, CORPORATE_ACTION_STAGES)) errors.push("result.action_stage is invalid");
  validateDateEnvelope(root.effective_date, "result.effective_date", errors);
  validateRatioEnvelope(root.ratio, errors);
  if (!stableSourceRef(root.source_ref)) errors.push("result.source_ref is invalid");
  if (!(root.evidence === null || boundedText(root.evidence, 4_000))) errors.push("result.evidence is invalid");
  if (!oneOf(root.confidence, CORPORATE_ACTION_CONFIDENCES)) errors.push("result.confidence is invalid");
  validateDateEnvelope(root.as_of, "result.as_of", errors);
  return errors;
}

export function canonicalizeCorporateActionAnalyzerResult(
  transport: CorporateActionAnalyzerTransportResult,
  input: CorporateActionAnalyzerInput,
): { result: CorporateActionAnalyzerResult | null; errors: string[] } {
  const inputErrors = validateCorporateActionAnalyzerInput(input);
  const transportErrors = validateCorporateActionAnalyzerTransportResult(transport);
  if (inputErrors.length || transportErrors.length) {
    return { result: null, errors: [...inputErrors, ...transportErrors] };
  }
  if (!transport.applicable) return { result: { applicable: false }, errors: [] };

  const document = input.source_documents.find((item) => item.source_ref === transport.source_ref);
  if (!document) {
    return { result: null, errors: ["result.source_ref must identify a supplied source document"] };
  }
  const ratio = transport.ratio.availability === "unavailable"
    ? { availability: "unavailable" as const }
    : mechanicalOldSharesPerNewShare(transport.ratio.old_shares, transport.ratio.new_shares);
  if (!ratio) return { result: null, errors: ["result.ratio contains an invalid positive finite value"] };

  const evidence = canonicalEvidence(transport.evidence, document.text);
  return {
    result: {
      applicable: true,
      facts: {
        version: CORPORATE_ACTION_FACTS_VERSION,
        event_kind: "reverse_split",
        action_stage: transport.action_stage,
        effective_date: transport.effective_date,
        ratio: { old_shares_per_new_share: ratio },
        source_ref: transport.source_ref,
        evidence,
        confidence: transport.confidence,
        as_of: transport.as_of,
        source: {
          source_family: input.source_family,
          source_id: input.source_id,
          source_url: input.source_url,
        },
      },
    },
    errors: [],
  };
}

export function validateCorporateActionAnalyzerResult(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["canonical result must be an object"];
  if (root.applicable === false) {
    exactKeys(root, ["applicable"], "canonical result", errors);
    return errors;
  }
  exactKeys(root, ["applicable", "facts"], "canonical result", errors);
  if (root.applicable !== true) errors.push("canonical result.applicable must be boolean");
  const facts = record(root.facts);
  if (!facts) return [...errors, "canonical result.facts must be an object"];
  exactKeys(facts, [
    "version",
    "event_kind",
    "action_stage",
    "effective_date",
    "ratio",
    "source_ref",
    "evidence",
    "confidence",
    "as_of",
    "source",
  ], "canonical result.facts", errors);
  if (facts.version !== CORPORATE_ACTION_FACTS_VERSION) errors.push("canonical facts.version is invalid");
  if (facts.event_kind !== "reverse_split") errors.push("canonical facts.event_kind must be reverse_split");
  if (!oneOf(facts.action_stage, CORPORATE_ACTION_STAGES)) errors.push("canonical facts.action_stage is invalid");
  validateDateEnvelope(facts.effective_date, "canonical facts.effective_date", errors);
  const ratio = record(facts.ratio);
  if (!ratio) {
    errors.push("canonical facts.ratio must be an object");
  } else {
    exactKeys(ratio, ["old_shares_per_new_share"], "canonical facts.ratio", errors);
    validateCanonicalNumberEnvelope(ratio.old_shares_per_new_share, errors);
  }
  if (!stableSourceRef(facts.source_ref)) errors.push("canonical facts.source_ref is invalid");
  validateCanonicalEvidence(facts.evidence, errors);
  if (!oneOf(facts.confidence, CORPORATE_ACTION_CONFIDENCES)) errors.push("canonical facts.confidence is invalid");
  validateDateEnvelope(facts.as_of, "canonical facts.as_of", errors);
  const source = record(facts.source);
  if (!source) {
    errors.push("canonical facts.source must be an object");
  } else {
    exactKeys(source, ["source_family", "source_id", "source_url"], "canonical facts.source", errors);
    if (!oneOf(source.source_family, ["nasdaq", "news", "sec"])) errors.push("canonical facts.source.source_family is invalid");
    if (!boundedText(source.source_id, 240)) errors.push("canonical facts.source.source_id is required");
    if (!nullableHttpUrl(source.source_url)) errors.push("canonical facts.source.source_url is invalid");
  }
  return errors;
}

export function readCorporateActionAnalyzerResult(value: unknown): CorporateActionAnalyzerResult | null {
  return validateCorporateActionAnalyzerResult(value).length === 0
    ? value as CorporateActionAnalyzerResult
    : null;
}

function mechanicalOldSharesPerNewShare(oldShares: string, newShares: string) {
  const oldValue = strictPositiveNumber(oldShares);
  const newValue = strictPositiveNumber(newShares);
  if (oldValue === null || newValue === null) return null;
  const value = oldValue / newValue;
  return Number.isFinite(value) && value > 0
    ? { availability: "available" as const, value }
    : null;
}

function strictPositiveNumber(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canonicalEvidence(value: string | null, sourceText: string): CorporateActionCanonicalFacts["evidence"] {
  if (typeof value !== "string" || !value.trim()) return { availability: "unavailable", reason: "not_provided" };
  if (Array.from(value).length > CORPORATE_ACTION_EVIDENCE_MAX_LENGTH) {
    return { availability: "unavailable", reason: "too_long" };
  }
  if (!sourceText.includes(value)) return { availability: "unavailable", reason: "not_exact_span" };
  return { availability: "available", value };
}

function validateDateEnvelope(value: unknown, path: string, errors: string[]) {
  const envelope = record(value);
  if (!envelope) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (envelope.availability === "unavailable") {
    exactKeys(envelope, ["availability"], path, errors);
    return;
  }
  exactKeys(envelope, ["availability", "value"], path, errors);
  if (envelope.availability !== "available") errors.push(`${path}.availability is invalid`);
  if (!validDate(envelope.value)) errors.push(`${path}.value must be YYYY-MM-DD`);
}

function validateRatioEnvelope(value: unknown, errors: string[]) {
  const ratio = record(value);
  if (!ratio) {
    errors.push("result.ratio must be an object");
    return;
  }
  if (ratio.availability === "unavailable") {
    exactKeys(ratio, ["availability"], "result.ratio", errors);
    return;
  }
  exactKeys(ratio, ["availability", "old_shares", "new_shares"], "result.ratio", errors);
  if (ratio.availability !== "available") errors.push("result.ratio.availability is invalid");
  if (strictPositiveNumber(ratio.old_shares) === null) errors.push("result.ratio.old_shares is invalid");
  if (strictPositiveNumber(ratio.new_shares) === null) errors.push("result.ratio.new_shares is invalid");
}

function validateCanonicalNumberEnvelope(value: unknown, errors: string[]) {
  const envelope = record(value);
  if (!envelope) {
    errors.push("canonical ratio must be an object");
    return;
  }
  if (envelope.availability === "unavailable") {
    exactKeys(envelope, ["availability"], "canonical ratio", errors);
    return;
  }
  exactKeys(envelope, ["availability", "value"], "canonical ratio", errors);
  if (envelope.availability !== "available") errors.push("canonical ratio availability is invalid");
  if (typeof envelope.value !== "number" || !Number.isFinite(envelope.value) || envelope.value <= 0) {
    errors.push("canonical ratio value must be positive and finite");
  }
}

function validateCanonicalEvidence(value: unknown, errors: string[]) {
  const evidence = record(value);
  if (!evidence) {
    errors.push("canonical facts.evidence must be an object");
    return;
  }
  if (evidence.availability === "available") {
    exactKeys(evidence, ["availability", "value"], "canonical facts.evidence", errors);
    if (!boundedText(evidence.value, CORPORATE_ACTION_EVIDENCE_MAX_LENGTH)) errors.push("canonical evidence value is invalid");
    return;
  }
  exactKeys(evidence, ["availability", "reason"], "canonical facts.evidence", errors);
  if (evidence.availability !== "unavailable") errors.push("canonical evidence availability is invalid");
  if (!oneOf(evidence.reason, ["not_provided", "too_long", "not_exact_span"])) errors.push("canonical evidence reason is invalid");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function stableSourceRef(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function oneOf(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
