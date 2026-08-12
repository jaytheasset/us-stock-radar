import {
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerProviderResult,
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
      maxItems: 48,
      items: {
        type: "object",
        required: ["source_ref", "evidence"],
        properties: {
          source_ref: { type: "string", maxLength: 240 },
          evidence: { type: "string", maxLength: LISTING_SOURCE_EVIDENCE_MAX_LENGTH },
        },
      },
    },
  },
} as const;

export type ListingRiskEvidenceRepairTarget = {
  source_index: number;
  source_ref: string;
  original_evidence: string;
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
    source_ref: string;
    evidence: string;
  }>;
};

const EVIDENCE_MAX_ERROR = new RegExp(
  `^applicable_facts\\[0\\]: sources\\[(\\d+)\\]\\.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer$`,
);

export function buildListingRiskEvidenceRepairPlan(
  value: unknown,
  input: ListingRiskAnalyzerInput,
): ListingRiskEvidenceRepairPlan | null {
  const validationErrors = validateListingRiskAnalyzerProviderResult(value, input);
  if (!validationErrors.length) return null;

  const indexes: number[] = [];
  for (const error of validationErrors) {
    const match = EVIDENCE_MAX_ERROR.exec(error);
    if (!match) return null;
    indexes.push(Number(match[1]));
  }

  const root = record(value);
  const applicableFacts = Array.isArray(root?.applicable_facts) ? root.applicable_facts : [];
  const facts = record(applicableFacts[0]);
  const sources = Array.isArray(facts?.sources) ? facts.sources : [];
  if (root?.status !== "applicable" || applicableFacts.length !== 1 || !facts) return null;

  const uniqueIndexes = [...new Set(indexes)];
  const actualOverlengthIndexes = sources.flatMap((sourceValue, index) => {
    const source = record(sourceValue);
    return typeof source?.evidence === "string" &&
      Array.from(source.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH
      ? [index]
      : [];
  });
  if (
    uniqueIndexes.length !== actualOverlengthIndexes.length ||
    uniqueIndexes.some((index) => !actualOverlengthIndexes.includes(index))
  ) {
    return null;
  }

  const sourceDocuments = new Map(input.source_documents.map((document) => [document.source_ref, document]));
  const targets: ListingRiskEvidenceRepairTarget[] = [];
  for (const sourceIndex of uniqueIndexes) {
    const source = record(sources[sourceIndex]);
    if (!source || typeof source.source_ref !== "string" || typeof source.evidence !== "string") return null;
    const sourceDocument = sourceDocuments.get(source.source_ref);
    if (!sourceDocument) return null;
    targets.push({
      source_index: sourceIndex,
      source_ref: source.source_ref,
      original_evidence: source.evidence,
      original_length: Array.from(source.evidence).length,
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

  const targetRefs = new Set(plan.targets.map((target) => target.source_ref));
  const targetsByRef = new Map(plan.targets.map((target) => [target.source_ref, target]));
  const seenRefs = new Set<string>();
  repairs.forEach((repairValue, index) => {
    const path = `listing_risk_evidence_repair.evidence_repairs[${index}]`;
    const repair = record(repairValue);
    if (!repair) {
      errors.push(`${path} must be an object`);
      return;
    }
    exactKeys(repair, ["source_ref", "evidence"], path, errors);
    if (typeof repair.source_ref !== "string" || !targetRefs.has(repair.source_ref)) {
      errors.push(`${path}.source_ref must identify a repair target`);
    } else if (seenRefs.has(repair.source_ref)) {
      errors.push(`${path}.source_ref must be unique`);
    } else {
      seenRefs.add(repair.source_ref);
    }
    if (typeof repair.evidence !== "string" || !repair.evidence.trim()) {
      errors.push(`${path}.evidence must be a non-empty string`);
    } else if (Array.from(repair.evidence).length > LISTING_SOURCE_EVIDENCE_MAX_LENGTH) {
      errors.push(`${path}.evidence must be ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer`);
    } else {
      const target = typeof repair.source_ref === "string" ? targetsByRef.get(repair.source_ref) : null;
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
  const replacements = new Map(output.evidence_repairs.map((repair) => [repair.source_ref, repair.evidence]));
  const originalFacts = plan.original_result.applicable_facts[0];
  const repairedFacts: ListingRiskEventFacts = {
    ...originalFacts,
    sources: originalFacts.sources.map((source) => {
      const evidence = replacements.get(source.source_ref);
      return evidence === undefined ? source : { ...source, evidence };
    }),
  };
  return {
    ...plan.original_result,
    applicable_facts: [repairedFacts],
  };
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
