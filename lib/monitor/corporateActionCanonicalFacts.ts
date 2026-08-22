import { parseJsonWithoutDuplicateKeys } from "./listingRiskAnalyzer.ts";

export const CORPORATE_ACTION_ANALYZER_INPUT_VERSION = "corporate_action_analyzer_input_v1";
export const CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION = "corporate_action_reverse_split_analyzer_v1";
export const CORPORATE_ACTION_FACTS_VERSION = "corporate_action_reverse_split_facts_v1";
export const REVERSE_SPLIT_APPLICABILITY_VERSION = "reverse_split_applicability_v1";
export const CORPORATE_ACTION_EVIDENCE_MAX_LENGTH = 520;

export type CorporateActionCanonicalVocabularyEntry<TValue extends string = string> = Readonly<{
  value: TValue;
  description: string;
  monitorable: boolean;
  displayLabel: string;
}>;

export const CORPORATE_ACTION_EVENT_KIND_VOCABULARY = [
  {
    value: "reverse_split",
    description: "The event establishes a reverse stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Reverse stock split",
  },
] as const satisfies readonly CorporateActionCanonicalVocabularyEntry[];

export const CORPORATE_ACTION_STAGE_VOCABULARY = [
  {
    value: "announced",
    description: "a plan or decision is disclosed without a more specific confirmed approval or effect stage",
    monitorable: true,
    displayLabel: "Announced",
  },
  {
    value: "board_approved",
    description: "board approval is explicitly established",
    monitorable: true,
    displayLabel: "Board approved",
  },
  {
    value: "shareholder_approved",
    description: "shareholder approval is explicitly established",
    monitorable: true,
    displayLabel: "Shareholder approved",
  },
  {
    value: "scheduled",
    description: "an approved or confirmed future effective date is established",
    monitorable: true,
    displayLabel: "Scheduled",
  },
  {
    value: "effective",
    description: "the reverse split is already effective or the source is the effective action itself",
    monitorable: true,
    displayLabel: "Effective",
  },
  {
    value: "unknown",
    description: "a reverse split is certain but the stage cannot safely be normalized",
    monitorable: false,
    displayLabel: "Unknown",
  },
] as const satisfies readonly CorporateActionCanonicalVocabularyEntry[];

export type CorporateActionEventKind = (typeof CORPORATE_ACTION_EVENT_KIND_VOCABULARY)[number]["value"];
export type CorporateActionStage = (typeof CORPORATE_ACTION_STAGE_VOCABULARY)[number]["value"];

export const CORPORATE_ACTION_EVENT_KINDS: readonly CorporateActionEventKind[] =
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY.map((entry) => entry.value);
export const CORPORATE_ACTION_STAGES: readonly CorporateActionStage[] =
  CORPORATE_ACTION_STAGE_VOCABULARY.map((entry) => entry.value);

export const CORPORATE_ACTION_CONFIDENCES = ["high", "medium", "low"] as const;

export type CorporateActionConfidence = (typeof CORPORATE_ACTION_CONFIDENCES)[number];
export type CorporateActionSourceFamily = "nasdaq" | "news" | "sec";

export type CorporateActionSourceDocument = {
  source_ref: string;
  label: string | null;
  text: string;
};

export type CorporateActionIssuerContext =
  | {
      availability: "available";
      issuer_cik: string;
      accession_number: string;
      accepted_at: string | null;
      provenance: "sec_filing_ledger";
    }
  | {
      availability: "unavailable";
      reason:
        | "non_sec_source"
        | "accession_unavailable"
        | "filing_ledger_identity_unavailable"
        | "filing_ledger_identity_conflict";
    };

export type CorporateActionSecurityClassCandidate = {
  canonical_security_class_id: string;
  security_type: "common_stock";
  security_class_basis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK";
  source_member_local_name: string | null;
  supporting_accessions: string[];
};

export type CorporateActionAnalyzerInput = {
  version: typeof CORPORATE_ACTION_ANALYZER_INPUT_VERSION;
  source_family: CorporateActionSourceFamily;
  source_id: string;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  source_documents: CorporateActionSourceDocument[];
  issuer_context?: CorporateActionIssuerContext;
  security_class_candidates?: CorporateActionSecurityClassCandidate[];
};

type Unavailable = { availability: "unavailable" };
type AvailableDate = { availability: "available"; value: string };

export const CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS = [
  "issuer_identity_unavailable",
  "security_class_context_unavailable",
  "source_security_ambiguous",
  "ads_or_ordinary_ambiguous",
] as const;

export type CorporateActionAffectedSecurityUnavailableReason =
  (typeof CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS)[number];

export const CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS = [
  "market_open",
  "start_of_trading",
  "after_market_close",
  "exact_timestamp",
] as const;

export type CorporateActionEffectiveTimingKind =
  (typeof CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS)[number];

export const CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS = [
  "not_provided",
  "date_only",
  "ambiguous",
] as const;

type TransportSourceEvidence = {
  source_ref: string | null;
  evidence: string | null;
};

export type CorporateActionAffectedSecurityTransport =
  | {
      availability: "available";
      canonical_security_class_id: string;
      security_type: "common_stock";
      source_security_title: string;
      source_ref: string;
      evidence: string;
    }
  | ({
      availability: "unavailable";
      reason: CorporateActionAffectedSecurityUnavailableReason;
    } & TransportSourceEvidence);

export type CorporateActionEffectiveTimingTransport =
  | {
      availability: "available";
      kind: CorporateActionEffectiveTimingKind;
      timestamp: string | null;
      source_ref: string;
      evidence: string;
    }
  | {
      availability: "unavailable";
      reason: (typeof CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS)[number];
    };

export type CorporateActionAnalyzerTransportResult =
  | { applicable: false }
  | {
      applicable: true;
      event_kind: CorporateActionEventKind;
      action_stage: CorporateActionStage;
      effective_date: Unavailable | AvailableDate;
      ratio:
        | Unavailable
        | {
            availability: "available";
            old_shares: string;
            new_shares: string;
          };
      affected_security?: CorporateActionAffectedSecurityTransport;
      effective_timing?: CorporateActionEffectiveTimingTransport;
      source_ref: string;
      evidence: string | null;
      confidence: CorporateActionConfidence;
      as_of: Unavailable | AvailableDate;
    };

export type CorporateActionCanonicalFacts = {
  version: typeof CORPORATE_ACTION_FACTS_VERSION;
  event_kind: CorporateActionEventKind;
  action_stage: CorporateActionStage;
  effective_date: Unavailable | AvailableDate;
  ratio: {
    old_shares_per_new_share:
      | Unavailable
      | { availability: "available"; value: number };
    exact_source_components?:
      | Unavailable
      | {
          availability: "available";
          old_share_units: string;
          new_share_units: string;
        };
  };
  applicability?: {
    version: typeof REVERSE_SPLIT_APPLICABILITY_VERSION;
    issuer: CorporateActionIssuerContext;
    affected_security:
      | {
          availability: "available";
          security_type: "common_stock";
          canonical_security_class_id: string;
          source_security_title: string;
          source_ref: string;
          evidence: CorporateActionCanonicalFacts["evidence"];
          provenance: {
            rule: "llm_source_meaning_exact_candidate";
            security_class_basis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK";
            source_member_local_name: string | null;
            supporting_accessions: string[];
          };
        }
      | {
          availability: "unavailable";
          reason: CorporateActionAffectedSecurityUnavailableReason;
          source_ref: string | null;
          evidence: CorporateActionCanonicalFacts["evidence"];
        };
    basis_change_capability: "reverse_split_only";
  };
  effective_timing?:
    | {
        availability: "available";
        kind: CorporateActionEffectiveTimingKind;
        timestamp: string | null;
        source_ref: string;
        evidence: CorporateActionCanonicalFacts["evidence"];
      }
    | {
        availability: "unavailable";
        reason: (typeof CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS)[number];
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
  exactKeysAllowingOptional(root, [
    "version",
    "source_family",
    "source_id",
    "source_url",
    "published_at",
    "title",
    "source_documents",
  ], ["issuer_context", "security_class_candidates"], "input", errors);
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
  if (root.issuer_context !== undefined || root.security_class_candidates !== undefined) {
    validateIssuerContext(root.issuer_context, "input.issuer_context", errors);
    validateSecurityClassCandidates(
      root.security_class_candidates,
      root.issuer_context,
      "input.security_class_candidates",
      errors,
    );
  }
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
  exactKeysAllowingOptional(root, [
    "applicable",
    "event_kind",
    "action_stage",
    "effective_date",
    "ratio",
    "source_ref",
    "evidence",
    "confidence",
    "as_of",
  ], ["affected_security", "effective_timing"], "result", errors);
  if (root.applicable !== true) errors.push("result.applicable must be boolean");
  if (!oneOf(root.event_kind, CORPORATE_ACTION_EVENT_KINDS)) errors.push("result.event_kind must be reverse_split");
  if (!oneOf(root.action_stage, CORPORATE_ACTION_STAGES)) errors.push("result.action_stage is invalid");
  validateDateEnvelope(root.effective_date, "result.effective_date", errors);
  validateRatioEnvelope(root.ratio, errors);
  if (root.affected_security !== undefined) {
    validateAffectedSecurityTransport(root.affected_security, "result.affected_security", errors);
  }
  if (root.effective_timing !== undefined) {
    validateEffectiveTimingTransport(root.effective_timing, "result.effective_timing", errors);
  }
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

  const issuer = input.issuer_context ?? unavailableIssuerContext(input.source_family);
  const securityCandidates = input.security_class_candidates ?? [];
  const affectedSecurity = canonicalAffectedSecurity(
    transport.affected_security,
    issuer,
    securityCandidates,
    input.source_documents,
  );
  if (affectedSecurity.errors.length) return { result: null, errors: affectedSecurity.errors };
  const effectiveTiming = canonicalEffectiveTiming(
    transport.effective_timing,
    transport.effective_date,
    input.source_documents,
  );
  if (effectiveTiming.errors.length) return { result: null, errors: effectiveTiming.errors };

  const evidence = canonicalEvidence(transport.evidence, document.text);
  return {
    result: {
      applicable: true,
      facts: {
        version: CORPORATE_ACTION_FACTS_VERSION,
        event_kind: CORPORATE_ACTION_EVENT_KIND_VOCABULARY[0].value,
        action_stage: transport.action_stage,
        effective_date: transport.effective_date,
        ratio: {
          old_shares_per_new_share: ratio,
          exact_source_components: transport.ratio.availability === "available"
            ? {
                availability: "available",
                old_share_units: transport.ratio.old_shares,
                new_share_units: transport.ratio.new_shares,
              }
            : { availability: "unavailable" },
        },
        applicability: {
          version: REVERSE_SPLIT_APPLICABILITY_VERSION,
          issuer,
          affected_security: affectedSecurity.value!,
          basis_change_capability: "reverse_split_only",
        },
        effective_timing: effectiveTiming.value!,
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
  exactKeysAllowingOptional(facts, [
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
  ], ["applicability", "effective_timing"], "canonical result.facts", errors);
  if (facts.version !== CORPORATE_ACTION_FACTS_VERSION) errors.push("canonical facts.version is invalid");
  if (!oneOf(facts.event_kind, CORPORATE_ACTION_EVENT_KINDS)) errors.push("canonical facts.event_kind must be reverse_split");
  if (!oneOf(facts.action_stage, CORPORATE_ACTION_STAGES)) errors.push("canonical facts.action_stage is invalid");
  validateDateEnvelope(facts.effective_date, "canonical facts.effective_date", errors);
  const ratio = record(facts.ratio);
  if (!ratio) {
    errors.push("canonical facts.ratio must be an object");
  } else {
    exactKeysAllowingOptional(
      ratio,
      ["old_shares_per_new_share"],
      ["exact_source_components"],
      "canonical facts.ratio",
      errors,
    );
    validateCanonicalNumberEnvelope(ratio.old_shares_per_new_share, errors);
    if (ratio.exact_source_components !== undefined) {
      validateExactRatioComponents(ratio.exact_source_components, errors);
      const derived = record(ratio.old_shares_per_new_share);
      const exact = record(ratio.exact_source_components);
      if (derived?.availability === "available" && exact?.availability === "available") {
        const mechanical = mechanicalOldSharesPerNewShare(
          String(exact.old_share_units ?? ""),
          String(exact.new_share_units ?? ""),
        );
        if (!mechanical || mechanical.value !== derived.value) {
          errors.push("canonical exact ratio components do not match derived ratio");
        }
      }
    }
  }
  if (facts.applicability !== undefined) validateCanonicalApplicability(facts.applicability, errors);
  if (facts.effective_timing !== undefined) {
    validateCanonicalEffectiveTiming(facts.effective_timing, facts.effective_date, errors);
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

function unavailableIssuerContext(sourceFamily: CorporateActionSourceFamily): CorporateActionIssuerContext {
  return sourceFamily === "sec"
    ? { availability: "unavailable", reason: "filing_ledger_identity_unavailable" }
    : { availability: "unavailable", reason: "non_sec_source" };
}

function canonicalAffectedSecurity(
  transport: CorporateActionAffectedSecurityTransport | undefined,
  issuer: CorporateActionIssuerContext,
  candidates: readonly CorporateActionSecurityClassCandidate[],
  documents: readonly CorporateActionSourceDocument[],
): {
  value: NonNullable<CorporateActionCanonicalFacts["applicability"]>["affected_security"] | null;
  errors: string[];
} {
  if (!transport) {
    return {
      value: {
        availability: "unavailable",
        reason: issuer.availability === "unavailable"
          ? "issuer_identity_unavailable"
          : candidates.length === 0
            ? "security_class_context_unavailable"
            : "source_security_ambiguous",
        source_ref: null,
        evidence: { availability: "unavailable", reason: "not_provided" },
      },
      errors: [],
    };
  }
  if (transport.availability === "unavailable") {
    if (transport.source_ref === null) {
      if (transport.evidence !== null) {
        return { value: null, errors: ["result.affected_security.evidence requires source_ref"] };
      }
      return {
        value: {
          availability: "unavailable",
          reason: transport.reason,
          source_ref: null,
          evidence: { availability: "unavailable", reason: "not_provided" },
        },
        errors: [],
      };
    }
    const document = documents.find((item) => item.source_ref === transport.source_ref);
    if (!document) {
      return { value: null, errors: ["result.affected_security.source_ref must identify a supplied source document"] };
    }
    return {
      value: {
        availability: "unavailable",
        reason: transport.reason,
        source_ref: transport.source_ref,
        evidence: canonicalEvidence(transport.evidence, document.text),
      },
      errors: [],
    };
  }
  if (issuer.availability !== "available") {
    return { value: null, errors: ["result.affected_security cannot be mapped without authoritative issuer CIK"] };
  }
  const candidate = candidates.find((item) =>
    item.canonical_security_class_id === transport.canonical_security_class_id);
  if (!candidate || candidate.security_type !== transport.security_type) {
    return { value: null, errors: ["result.affected_security must use one supplied canonical security class candidate"] };
  }
  const document = documents.find((item) => item.source_ref === transport.source_ref);
  if (!document) {
    return { value: null, errors: ["result.affected_security.source_ref must identify a supplied source document"] };
  }
  if (!document.text.includes(transport.source_security_title)) {
    return { value: null, errors: ["result.affected_security.source_security_title must be an exact source span"] };
  }
  const evidence = canonicalEvidence(transport.evidence, document.text);
  if (evidence.availability !== "available") {
    return { value: null, errors: ["result.affected_security requires compact exact source evidence"] };
  }
  return {
    value: {
      availability: "available",
      security_type: "common_stock",
      canonical_security_class_id: candidate.canonical_security_class_id,
      source_security_title: transport.source_security_title,
      source_ref: transport.source_ref,
      evidence,
      provenance: {
        rule: "llm_source_meaning_exact_candidate",
        security_class_basis: candidate.security_class_basis,
        source_member_local_name: candidate.source_member_local_name,
        supporting_accessions: [...candidate.supporting_accessions],
      },
    },
    errors: [],
  };
}

function canonicalEffectiveTiming(
  transport: CorporateActionEffectiveTimingTransport | undefined,
  effectiveDate: Unavailable | AvailableDate,
  documents: readonly CorporateActionSourceDocument[],
): {
  value: NonNullable<CorporateActionCanonicalFacts["effective_timing"]> | null;
  errors: string[];
} {
  if (!transport) {
    return {
      value: {
        availability: "unavailable",
        reason: effectiveDate.availability === "available" ? "date_only" : "not_provided",
      },
      errors: [],
    };
  }
  if (transport.availability === "unavailable") return { value: transport, errors: [] };
  if (effectiveDate.availability !== "available") {
    return { value: null, errors: ["result.effective_timing requires an available effective_date"] };
  }
  const document = documents.find((item) => item.source_ref === transport.source_ref);
  if (!document) {
    return { value: null, errors: ["result.effective_timing.source_ref must identify a supplied source document"] };
  }
  const evidence = canonicalEvidence(transport.evidence, document.text);
  if (evidence.availability !== "available") {
    return { value: null, errors: ["result.effective_timing requires compact exact source evidence"] };
  }
  if (transport.kind === "exact_timestamp") {
    if (!validTimestamp(transport.timestamp)
      || transport.timestamp!.slice(0, 10) !== effectiveDate.value) {
      return { value: null, errors: ["result.effective_timing exact timestamp must match effective_date"] };
    }
  } else if (transport.timestamp !== null) {
    return { value: null, errors: ["result.effective_timing timestamp is only allowed for exact_timestamp"] };
  }
  return {
    value: {
      availability: "available",
      kind: transport.kind,
      timestamp: transport.timestamp,
      source_ref: transport.source_ref,
      evidence,
    },
    errors: [],
  };
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

function validateIssuerContext(value: unknown, path: string, errors: string[]) {
  const context = record(value);
  if (!context) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (context.availability === "unavailable") {
    exactKeys(context, ["availability", "reason"], path, errors);
    if (!oneOf(context.reason, [
      "non_sec_source",
      "accession_unavailable",
      "filing_ledger_identity_unavailable",
      "filing_ledger_identity_conflict",
    ])) errors.push(`${path}.reason is invalid`);
    return;
  }
  exactKeys(context, [
    "availability",
    "issuer_cik",
    "accession_number",
    "accepted_at",
    "provenance",
  ], path, errors);
  if (context.availability !== "available") errors.push(`${path}.availability is invalid`);
  if (!validCik(context.issuer_cik)) errors.push(`${path}.issuer_cik is invalid`);
  if (!validAccession(context.accession_number)) errors.push(`${path}.accession_number is invalid`);
  if (!(context.accepted_at === null || validTimestamp(context.accepted_at))) {
    errors.push(`${path}.accepted_at is invalid`);
  }
  if (context.provenance !== "sec_filing_ledger") errors.push(`${path}.provenance is invalid`);
}

function validateSecurityClassCandidates(
  value: unknown,
  issuerValue: unknown,
  path: string,
  errors: string[],
) {
  if (!Array.isArray(value) || value.length > 24) {
    errors.push(`${path} must be an array with at most 24 entries`);
    return;
  }
  const issuer = record(issuerValue);
  if (issuer?.availability !== "available" && value.length > 0) {
    errors.push(`${path} requires authoritative issuer context`);
  }
  const issuerCik = typeof issuer?.issuer_cik === "string" ? issuer.issuer_cik : "";
  const ids = new Set<string>();
  value.forEach((candidateValue, index) => {
    const candidate = record(candidateValue);
    const candidatePath = `${path}[${index}]`;
    if (!candidate) {
      errors.push(`${candidatePath} must be an object`);
      return;
    }
    exactKeys(candidate, [
      "canonical_security_class_id",
      "security_type",
      "security_class_basis",
      "source_member_local_name",
      "supporting_accessions",
    ], candidatePath, errors);
    const id = typeof candidate.canonical_security_class_id === "string"
      ? candidate.canonical_security_class_id : "";
    if (!canonicalSecurityClassId(id, issuerCik)) errors.push(`${candidatePath}.canonical_security_class_id is invalid`);
    if (ids.has(id)) errors.push(`${candidatePath}.canonical_security_class_id must be unique`);
    ids.add(id);
    if (candidate.security_type !== "common_stock") errors.push(`${candidatePath}.security_type is invalid`);
    if (!oneOf(candidate.security_class_basis, ["SINGLE_COMMON_STOCK_CLASS", "CLASS_SPECIFIC_COMMON_STOCK"])) {
      errors.push(`${candidatePath}.security_class_basis is invalid`);
    }
    if (!(candidate.source_member_local_name === null || boundedText(candidate.source_member_local_name, 128))) {
      errors.push(`${candidatePath}.source_member_local_name is invalid`);
    }
    if (candidate.security_class_basis === "SINGLE_COMMON_STOCK_CLASS"
      && candidate.source_member_local_name !== null) {
      errors.push(`${candidatePath}.source_member_local_name must be null for single class`);
    }
    if (candidate.security_class_basis === "CLASS_SPECIFIC_COMMON_STOCK"
      && !boundedText(candidate.source_member_local_name, 128)) {
      errors.push(`${candidatePath}.source_member_local_name is required for class-specific identity`);
    }
    if (!Array.isArray(candidate.supporting_accessions)
      || candidate.supporting_accessions.length < 1
      || candidate.supporting_accessions.length > 12
      || candidate.supporting_accessions.some((item) => !validAccession(item))) {
      errors.push(`${candidatePath}.supporting_accessions is invalid`);
    }
  });
}

function validateAffectedSecurityTransport(value: unknown, path: string, errors: string[]) {
  const affected = record(value);
  if (!affected) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (affected.availability === "unavailable") {
    exactKeys(affected, ["availability", "reason", "source_ref", "evidence"], path, errors);
    if (!oneOf(affected.reason, CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS)) {
      errors.push(`${path}.reason is invalid`);
    }
    if (!(affected.source_ref === null || stableSourceRef(affected.source_ref))) errors.push(`${path}.source_ref is invalid`);
    if (!(affected.evidence === null || boundedText(affected.evidence, 4_000))) errors.push(`${path}.evidence is invalid`);
    return;
  }
  exactKeys(affected, [
    "availability",
    "canonical_security_class_id",
    "security_type",
    "source_security_title",
    "source_ref",
    "evidence",
  ], path, errors);
  if (affected.availability !== "available") errors.push(`${path}.availability is invalid`);
  if (!boundedText(affected.canonical_security_class_id, 240)) errors.push(`${path}.canonical_security_class_id is invalid`);
  if (affected.security_type !== "common_stock") errors.push(`${path}.security_type is invalid`);
  if (!boundedText(affected.source_security_title, 240)) errors.push(`${path}.source_security_title is invalid`);
  if (!stableSourceRef(affected.source_ref)) errors.push(`${path}.source_ref is invalid`);
  if (!boundedText(affected.evidence, 4_000)) errors.push(`${path}.evidence is invalid`);
}

function validateEffectiveTimingTransport(value: unknown, path: string, errors: string[]) {
  const timing = record(value);
  if (!timing) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (timing.availability === "unavailable") {
    exactKeys(timing, ["availability", "reason"], path, errors);
    if (!oneOf(timing.reason, CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS)) {
      errors.push(`${path}.reason is invalid`);
    }
    return;
  }
  exactKeys(timing, ["availability", "kind", "timestamp", "source_ref", "evidence"], path, errors);
  if (timing.availability !== "available") errors.push(`${path}.availability is invalid`);
  if (!oneOf(timing.kind, CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS)) errors.push(`${path}.kind is invalid`);
  if (!(timing.timestamp === null || validTimestamp(timing.timestamp))) errors.push(`${path}.timestamp is invalid`);
  if (!stableSourceRef(timing.source_ref)) errors.push(`${path}.source_ref is invalid`);
  if (!boundedText(timing.evidence, 4_000)) errors.push(`${path}.evidence is invalid`);
}

function validateExactRatioComponents(value: unknown, errors: string[]) {
  const components = record(value);
  if (!components) {
    errors.push("canonical facts.ratio.exact_source_components must be an object");
    return;
  }
  if (components.availability === "unavailable") {
    exactKeys(components, ["availability"], "canonical exact ratio", errors);
    return;
  }
  exactKeys(components, ["availability", "old_share_units", "new_share_units"], "canonical exact ratio", errors);
  if (components.availability !== "available") errors.push("canonical exact ratio availability is invalid");
  if (strictPositiveNumber(components.old_share_units) === null) errors.push("canonical exact old share units are invalid");
  if (strictPositiveNumber(components.new_share_units) === null) errors.push("canonical exact new share units are invalid");
}

function validateCanonicalApplicability(value: unknown, errors: string[]) {
  const applicability = record(value);
  if (!applicability) {
    errors.push("canonical facts.applicability must be an object");
    return;
  }
  exactKeys(applicability, [
    "version",
    "issuer",
    "affected_security",
    "basis_change_capability",
  ], "canonical facts.applicability", errors);
  if (applicability.version !== REVERSE_SPLIT_APPLICABILITY_VERSION) {
    errors.push("canonical facts.applicability.version is invalid");
  }
  validateIssuerContext(applicability.issuer, "canonical facts.applicability.issuer", errors);
  if (applicability.basis_change_capability !== "reverse_split_only") {
    errors.push("canonical facts.applicability.basis_change_capability is invalid");
  }
  const affected = record(applicability.affected_security);
  if (!affected) {
    errors.push("canonical facts.applicability.affected_security must be an object");
    return;
  }
  if (affected.availability === "unavailable") {
    exactKeys(affected, ["availability", "reason", "source_ref", "evidence"], "canonical affected security", errors);
    if (!oneOf(affected.reason, CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS)) {
      errors.push("canonical affected security reason is invalid");
    }
    if (!(affected.source_ref === null || stableSourceRef(affected.source_ref))) {
      errors.push("canonical affected security source_ref is invalid");
    }
    validateCanonicalEvidence(affected.evidence, errors);
    return;
  }
  exactKeys(affected, [
    "availability",
    "security_type",
    "canonical_security_class_id",
    "source_security_title",
    "source_ref",
    "evidence",
    "provenance",
  ], "canonical affected security", errors);
  if (affected.availability !== "available") errors.push("canonical affected security availability is invalid");
  if (affected.security_type !== "common_stock") errors.push("canonical affected security type is invalid");
  const issuer = record(applicability.issuer);
  const issuerCik = issuer?.availability === "available" && typeof issuer.issuer_cik === "string"
    ? issuer.issuer_cik : "";
  if (!canonicalSecurityClassId(affected.canonical_security_class_id, issuerCik)) {
    errors.push("canonical affected security class id is invalid");
  }
  if (!boundedText(affected.source_security_title, 240)) errors.push("canonical affected security title is invalid");
  if (!stableSourceRef(affected.source_ref)) errors.push("canonical affected security source_ref is invalid");
  validateCanonicalEvidence(affected.evidence, errors);
  if (record(affected.evidence)?.availability !== "available") {
    errors.push("canonical mapped affected security requires available evidence");
  }
  const provenance = record(affected.provenance);
  if (!provenance) {
    errors.push("canonical affected security provenance must be an object");
    return;
  }
  exactKeys(provenance, [
    "rule",
    "security_class_basis",
    "source_member_local_name",
    "supporting_accessions",
  ], "canonical affected security provenance", errors);
  if (provenance.rule !== "llm_source_meaning_exact_candidate") errors.push("canonical affected security provenance rule is invalid");
  if (!oneOf(provenance.security_class_basis, ["SINGLE_COMMON_STOCK_CLASS", "CLASS_SPECIFIC_COMMON_STOCK"])) {
    errors.push("canonical affected security basis is invalid");
  }
  if (!(provenance.source_member_local_name === null || boundedText(provenance.source_member_local_name, 128))) {
    errors.push("canonical affected security member is invalid");
  }
  if (!Array.isArray(provenance.supporting_accessions)
    || provenance.supporting_accessions.length < 1
    || provenance.supporting_accessions.some((item) => !validAccession(item))) {
    errors.push("canonical affected security supporting accessions are invalid");
  }
}

function validateCanonicalEffectiveTiming(value: unknown, effectiveDateValue: unknown, errors: string[]) {
  const timing = record(value);
  if (!timing) {
    errors.push("canonical facts.effective_timing must be an object");
    return;
  }
  if (timing.availability === "unavailable") {
    exactKeys(timing, ["availability", "reason"], "canonical effective timing", errors);
    if (!oneOf(timing.reason, CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS)) {
      errors.push("canonical effective timing reason is invalid");
    }
    return;
  }
  exactKeys(timing, ["availability", "kind", "timestamp", "source_ref", "evidence"], "canonical effective timing", errors);
  if (timing.availability !== "available") errors.push("canonical effective timing availability is invalid");
  if (!oneOf(timing.kind, CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS)) errors.push("canonical effective timing kind is invalid");
  if (!(timing.timestamp === null || validTimestamp(timing.timestamp))) errors.push("canonical effective timing timestamp is invalid");
  if (timing.kind === "exact_timestamp" && !validTimestamp(timing.timestamp)) {
    errors.push("canonical exact effective timing requires timestamp");
  }
  if (timing.kind !== "exact_timestamp" && timing.timestamp !== null) {
    errors.push("canonical non-exact effective timing cannot have timestamp");
  }
  const effectiveDate = record(effectiveDateValue);
  if (effectiveDate?.availability !== "available") errors.push("canonical effective timing requires effective date");
  if (validTimestamp(timing.timestamp)
    && (timing.timestamp as string).slice(0, 10) !== effectiveDate?.value) {
    errors.push("canonical effective timing timestamp must match effective date");
  }
  if (!stableSourceRef(timing.source_ref)) errors.push("canonical effective timing source_ref is invalid");
  validateCanonicalEvidence(timing.evidence, errors);
  if (record(timing.evidence)?.availability !== "available") {
    errors.push("canonical available effective timing requires available evidence");
  }
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

function exactKeysAllowingOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[],
) {
  const actual = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const unexpected = actual.filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length) {
    errors.push(
      `${path} must contain required keys ${[...required].sort().join(", ")}`
      + ` and only optional keys ${[...optional].sort().join(", ")}`,
    );
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

function validCik(value: unknown) {
  return typeof value === "string" && /^\d{10}$/.test(value);
}

function validAccession(value: unknown) {
  return typeof value === "string" && /^\d{10}-\d{2}-\d{6}$/.test(value);
}

function canonicalSecurityClassId(value: unknown, issuerCik: string) {
  return typeof value === "string"
    && validCik(issuerCik)
    && new RegExp(`^sc:v1:${issuerCik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
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
