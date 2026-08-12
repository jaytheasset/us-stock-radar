import { LISTING_SOURCE_EVIDENCE_MAX_LENGTH } from "../monitor/listingRiskFacts.ts";
import {
  LISTING_RISK_EVIDENCE_REPAIR_SCHEMA,
  LISTING_RISK_EVIDENCE_TARGET_LENGTH,
  type ListingRiskEvidenceRepairPlan,
} from "../monitor/listingRiskEvidenceRepair.ts";

export const LISTING_RISK_EVIDENCE_REPAIR_PROMPT_KEY = "listing_risk_evidence_repair";
export const LISTING_RISK_EVIDENCE_REPAIR_PROMPT_VERSION = "listing_risk_evidence_repair_v1";

export const LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT = [
  "Repair only validator-identified overlength evidence excerpts in an otherwise valid Listing Risk result.",
  "This is one bounded mechanical repair pass, not a new analysis. Do not reassess applicability, event meaning, outcome, dates, rule, exchange, security, as_of, provenance, confidence, or quality.",
  `For each supplied target, return the same source_ref and one shorter excerpt from that target's supplied source_document. Aim for ${LISTING_RISK_EVIDENCE_TARGET_LENGTH} characters or fewer and never exceed the canonical ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH}-character maximum.`,
  "Preserve the same factual support as the original evidence. A complete sentence is not required; return the shortest useful contiguous source-backed excerpt.",
  "Do not invent, paraphrase, summarize, combine distant passages, or use primary context. Use only the supplied original source document.",
  "Return exactly one evidence_repairs item per target and no other fields.",
].join("\n");

export function buildListingRiskEvidenceRepairPrompt(plan: ListingRiskEvidenceRepairPlan) {
  return {
    key: LISTING_RISK_EVIDENCE_REPAIR_PROMPT_KEY,
    version: LISTING_RISK_EVIDENCE_REPAIR_PROMPT_VERSION,
    system: LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT,
    user: JSON.stringify({
      hard_max_characters: LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
      target_characters: LISTING_RISK_EVIDENCE_TARGET_LENGTH,
      targets: plan.targets.map((target) => ({
        source_ref: target.source_ref,
        original_evidence: target.original_evidence,
        source_document: target.source_document,
      })),
    }, null, 2),
    responseFormat: {
      json_schema: {
        name: "listing_risk_evidence_repair",
        strict: true as const,
        schema: LISTING_RISK_EVIDENCE_REPAIR_SCHEMA,
      },
    },
  };
}
