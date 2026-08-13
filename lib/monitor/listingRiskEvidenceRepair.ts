import {
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  type ListingEvidenceIssue,
  type ListingFactPath,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerProviderResult,
  validateListingRiskAnalyzerProviderFactEligibility,
  validateListingRiskAnalyzerProviderResult,
} from "./listingRiskAnalyzer.ts";

export const LISTING_RISK_EVIDENCE_TARGET_LENGTH = 280;

export const LISTING_RISK_EVIDENCE_REPAIR_SCHEMA = {
  type: "object",
  required: ["evidence_repairs"],
  properties: {
    evidence_repairs: {
      type: "array",
      minItems: 1,
      maxItems: 72,
      items: {
        type: "object",
        required: ["target_key", "source_ref", "evidence"],
        properties: {
          target_key: { type: "string", maxLength: 320 },
          source_ref: { type: "string", maxLength: 240 },
          evidence: { type: "string", nullable: true, maxLength: LISTING_SOURCE_EVIDENCE_MAX_LENGTH },
        },
      },
    },
  },
} as const;

export type ListingRiskEvidenceRepairTarget = {
  target_kind: "source" | "fact";
  target_key: string;
  source_index: number | null;
  provenance_index: number | null;
  fact_path: ListingFactPath | null;
  source_ref: string;
  original_evidence: string | null;
  original_length: number;
  source_document: {
    source_ref: string;
    label: string | null;
    text: string;
  };
};

export type ListingRiskEvidenceRepairPlan = {
  original_result: ListingRiskAnalyzerProviderResult;
  initial_validation_errors: string[];
  targets: ListingRiskEvidenceRepairTarget[];
};

export type ListingRiskEvidenceRepairOutput = {
  evidence_repairs: Array<{
    target_key: string;
    source_ref: string;
    evidence: string | null;
  }>;
};

const EVIDENCE_MAX_ERROR = new RegExp(
  `^applicable_facts\\[0\\]: sources\\[(\\d+)\\]\\.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer$`,
);
const EVIDENCE_EXACT_ERROR = /^applicable_facts\[0\]\.sources\[(\d+)\]\.evidence must be a contiguous excerpt from the supplied source document$/;
const FACT_EVIDENCE_MAX_ERROR = new RegExp(
  `^applicable_facts\\[0\\]: fact_provenance\\[(\\d+)\\]\\.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer$`,
);
const FACT_EVIDENCE_EXACT_ERROR = /^applicable_facts\[0\]\.fact_provenance\[(\d+)\]\.evidence must be a contiguous excerpt from the supplied source document$/;
const REPAIR_EVIDENCE_FORMAT_ERROR = new RegExp(
  `^listing_risk_evidence_repair\\.evidence_repairs\\[\\d+\\]\\.evidence must be (?:${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer|a contiguous excerpt from the supplied source document|provided as a non-empty string)$`,
);

export function buildListingRiskEvidenceRepairPlan(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): ListingRiskEvidenceRepairPlan | null {
  const validationErrors = validateListingRiskAnalyzerProviderResult(value, input);
  if (!validationErrors.length) return null;
  if (validateListingRiskAnalyzerProviderFactEligibility(value, input).length) return null;

  const sourceIndexes: number[] = [];
  const provenanceIndexes: number[] = [];
  for (const error of validationErrors) {
    const sourceMatch = EVIDENCE_MAX_ERROR.exec(error) || EVIDENCE_EXACT_ERROR.exec(error);
    if (sourceMatch) {
      sourceIndexes.push(Number(sourceMatch[1]));
      continue;
    }
    const provenanceMatch = FACT_EVIDENCE_MAX_ERROR.exec(error) || FACT_EVIDENCE_EXACT_ERROR.exec(error);
    if (provenanceMatch) {
      provenanceIndexes.push(Number(provenanceMatch[1]));
      continue;
    }
    return null;
  }

  const root = record(value);
  const applicableFacts = Array.isArray(root?.applicable_facts) ? root.applicable_facts : [];
  const facts = record(applicableFacts[0]);
  const sources = Array.isArray(facts?.sources) ? facts.sources : [];
  const provenance = Array.isArray(facts?.fact_provenance) ? facts.fact_provenance : [];
  if (root?.status !== "applicable" || applicableFacts.length !== 1 || !facts) return null;

  const sourceDocuments = new Map(input.source_documents.map((document) => [document.source_ref, document]));
  const uniqueSourceIndexes = [...new Set(sourceIndexes)];
  const uniqueProvenanceIndexes = [...new Set(provenanceIndexes)];
  const actualSourceIndexes = sources.flatMap((sourceValue, index) => {
    const source = record(sourceValue);
    if (typeof source?.source_ref !== "string" || typeof source.evidence !== "string") return [];
    const sourceDocument = sourceDocuments.get(source.source_ref);
    return Array.from(source.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH
      || (sourceDocument && !sourceDocument.text.includes(source.evidence))
      ? [index] : [];
  });
  const actualProvenanceIndexes = provenance.flatMap((entryValue, index) => {
    const entry = record(entryValue);
    if (typeof entry?.source_ref !== "string" || typeof entry.evidence !== "string") return [];
    const sourceDocument = sourceDocuments.get(entry.source_ref);
    return Array.from(entry.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH
      || (sourceDocument && !sourceDocument.text.includes(entry.evidence))
      ? [index] : [];
  });
  if (
    uniqueSourceIndexes.length !== actualSourceIndexes.length
    || uniqueSourceIndexes.some((index) => !actualSourceIndexes.includes(index))
    || uniqueProvenanceIndexes.length !== actualProvenanceIndexes.length
    || uniqueProvenanceIndexes.some((index) => !actualProvenanceIndexes.includes(index))
  ) {
    return null;
  }

  const targets: ListingRiskEvidenceRepairTarget[] = [];
  for (const sourceIndex of uniqueSourceIndexes) {
    const source = record(sources[sourceIndex]);
    if (!source || typeof source.source_ref !== "string" || typeof source.evidence !== "string") return null;
    const sourceDocument = sourceDocuments.get(source.source_ref);
    if (!sourceDocument) return null;
    targets.push({
      target_kind: "source",
      target_key: `source:${sourceIndex}`,
      source_index: sourceIndex,
      provenance_index: null,
      fact_path: null,
      source_ref: source.source_ref,
      original_evidence: source.evidence,
      original_length: Array.from(source.evidence).length,
      source_document: sourceDocument,
    });
  }
  for (const provenanceIndex of uniqueProvenanceIndexes) {
    const entry = record(provenance[provenanceIndex]);
    if (
      !entry
      || typeof entry.fact_path !== "string"
      || typeof entry.source_ref !== "string"
      || typeof entry.evidence !== "string"
    ) return null;
    const sourceDocument = sourceDocuments.get(entry.source_ref);
    if (!sourceDocument) return null;
    targets.push({
      target_kind: "fact",
      target_key: `fact:${entry.fact_path}`,
      source_index: null,
      provenance_index: provenanceIndex,
      fact_path: entry.fact_path as ListingFactPath,
      source_ref: entry.source_ref,
      original_evidence: entry.evidence,
      original_length: Array.from(entry.evidence).length,
      source_document: sourceDocument,
    });
  }
  if (!targets.length) return null;

  return {
    original_result: value as ListingRiskAnalyzerProviderResult,
    initial_validation_errors: validationErrors,
    targets,
  };
}

export function readListingRiskEvidenceRepairOutput(
  value: unknown,
  plan: ListingRiskEvidenceRepairPlan,
): { output: ListingRiskEvidenceRepairOutput | null; errors: string[] } {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { output: null, errors: ["listing_risk_evidence_repair must be an object"] };
  exactKeys(root, ["evidence_repairs"], "listing_risk_evidence_repair", errors);

  const repairs = Array.isArray(root.evidence_repairs) ? root.evidence_repairs : [];
  if (!Array.isArray(root.evidence_repairs)) {
    errors.push("listing_risk_evidence_repair.evidence_repairs must be an array");
  }
  if (repairs.length !== plan.targets.length) {
    errors.push("listing_risk_evidence_repair.evidence_repairs must contain exactly one item per target");
  }

  const targetsByKey = new Map(plan.targets.map((target) => [target.target_key, target]));
  const seenKeys = new Set<string>();
  repairs.forEach((repairValue, index) => {
    const path = `listing_risk_evidence_repair.evidence_repairs[${index}]`;
    const repair = record(repairValue);
    if (!repair) {
      errors.push(`${path} must be an object`);
      return;
    }
    exactKeys(repair, ["target_key", "source_ref", "evidence"], path, errors);
    const target = typeof repair.target_key === "string" ? targetsByKey.get(repair.target_key) : null;
    if (!target) {
      errors.push(`${path}.target_key must identify a repair target`);
    } else if (seenKeys.has(target.target_key)) {
      errors.push(`${path}.target_key must be unique`);
    } else {
      seenKeys.add(target.target_key);
    }
    if (!target || repair.source_ref !== target.source_ref) {
      errors.push(`${path}.source_ref must match the repair target`);
    }
    if (typeof repair.evidence !== "string" || !repair.evidence.trim()) {
      errors.push(`${path}.evidence must be provided as a non-empty string`);
    } else if (Array.from(repair.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH) {
      errors.push(`${path}.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer`);
    } else {
      if (!target?.source_document.text.includes(repair.evidence)) {
        errors.push(`${path}.evidence must be a contiguous excerpt from the supplied source document`);
      }
    }
  });

  if (errors.length) return { output: null, errors };
  return { output: value as ListingRiskEvidenceRepairOutput, errors: [] };
}

export function applyListingRiskEvidenceRepair(
  plan: ListingRiskEvidenceRepairPlan,
  output: ListingRiskEvidenceRepairOutput,
): ListingRiskAnalyzerProviderResult {
  const replacements = new Map(output.evidence_repairs.map((repair) => [repair.target_key, repair.evidence]));
  const originalFacts = plan.original_result.applicable_facts[0];
  const repairedFacts: ListingRiskEventFacts = {
    ...originalFacts,
    sources: originalFacts.sources.map((source, index) => {
      const evidence = replacements.get(`source:${index}`);
      return typeof evidence === "string" ? { ...source, evidence } : source;
    }),
    fact_provenance: originalFacts.fact_provenance.map((entry) => {
      const evidence = replacements.get(`fact:${entry.fact_path}`);
      return typeof evidence === "string"
        ? { ...entry, evidence, evidence_status: "available", evidence_issue: null }
        : entry;
    }),
  };
  return {
    ...plan.original_result,
    applicable_facts: [repairedFacts],
  };
}

/**
 * Preserves fact eligibility after the single repair attempt when the repair
 * response failed only display-evidence formatting. The original semantic
 * facts and source_ref values are immutable; only the targeted evidence leaf
 * becomes explicitly unavailable.
 */
export function applyListingRiskEvidenceUnavailable(
  plan: ListingRiskEvidenceRepairPlan,
  repairValue: unknown,
  repairErrors: string[],
): ListingRiskAnalyzerProviderResult | null {
  if (!repairErrors.length || repairErrors.some((error) => !REPAIR_EVIDENCE_FORMAT_ERROR.test(error))) {
    return null;
  }
  const root = record(repairValue);
  const repairs = Array.isArray(root?.evidence_repairs) ? root.evidence_repairs : [];
  const targetsByKey = new Map(plan.targets.map((target) => [target.target_key, target]));
  const issuesByKey = new Map<string, ListingEvidenceIssue>();
  const evidenceByKey = new Map<string, string | null>();
  for (const repairValueItem of repairs) {
    const repair = record(repairValueItem);
    if (typeof repair?.target_key !== "string" || typeof repair.source_ref !== "string") return null;
    const target = targetsByKey.get(repair.target_key);
    if (!target || repair.source_ref !== target.source_ref || issuesByKey.has(repair.target_key)) return null;
    issuesByKey.set(repair.target_key, evidenceIssue(repair.evidence, target.source_document.text));
    evidenceByKey.set(repair.target_key, typeof repair.evidence === "string" ? repair.evidence : null);
  }
  if (
    issuesByKey.size !== plan.targets.length
    || plan.targets.some((target) => !issuesByKey.has(target.target_key))
  ) {
    return null;
  }

  const originalFacts = plan.original_result.applicable_facts[0];
  return {
    ...plan.original_result,
    applicable_facts: [{
      ...originalFacts,
      sources: originalFacts.sources.map((source, index) => {
        const key = `source:${index}`;
        if (!issuesByKey.has(key)) return source;
        const evidence = evidenceByKey.get(key);
        return { ...source, evidence: issuesByKey.get(key) === null && evidence ? evidence : null };
      }),
      fact_provenance: originalFacts.fact_provenance.map((entry) => {
        const key = `fact:${entry.fact_path}`;
        if (!issuesByKey.has(key)) return entry;
        const issue = issuesByKey.get(key) ?? null;
        const evidence = evidenceByKey.get(key);
        return issue === null && evidence
          ? { ...entry, evidence, evidence_status: "available", evidence_issue: null }
          : { ...entry, evidence: null, evidence_status: "unavailable", evidence_issue: issue || "not_provided" };
      }),
    }],
  };
}

function evidenceIssue(value: unknown, sourceText: string): ListingEvidenceIssue {
  if (typeof value !== "string" || !value.trim()) return "not_provided";
  if (Array.from(value).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH) return "too_long";
  if (!sourceText.includes(value)) return "not_exact_span";
  return null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
