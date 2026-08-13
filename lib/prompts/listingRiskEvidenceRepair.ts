import { LISTING_SOURCE_EVIDENCE_MAX_LENGTH } from "../monitor/listingRiskFacts.ts";
import {
  LISTING_RISK_EVIDENCE_REPAIR_SCHEMA,
  LISTING_RISK_EVIDENCE_TARGET_LENGTH,
  type ListingRiskEvidenceRepairPlan,
} from "../monitor/listingRiskEvidenceRepair.ts";

export const LISTING_RISK_EVIDENCE_REPAIR_PROMPT_KEY = "listing_risk_evidence_repair";
export const LISTING_RISK_EVIDENCE_REPAIR_PROMPT_VERSION = "listing_risk_evidence_repair_v2";

export const LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT = [
  "SELECT AND COPY exact substrings only for validator-identified overlength evidence excerpts in an otherwise valid Listing Risk result. Do not write new evidence.",
  "This is one bounded mechanical repair pass, not a new analysis. Do not reassess applicability, event meaning, outcome, dates, rule, exchange, security, as_of, provenance, confidence, or quality.",
  "The target source_ref is immutable. For each target, return exactly that same source_ref and select exactly one continuous span from that target's source_document.text.",
  "Copy the selected span character-for-character. The hard runtime contract is source_document.text.includes(evidence) === true.",
  "Do not summarize, paraphrase, rewrite, normalize, retype, correct grammar, join non-contiguous passages, or delete words from the middle. Do not change whitespace, line breaks, case, punctuation, quotation marks, apostrophes, hyphens or dashes, Unicode characters, numbers, or date formatting. Never use primary context.",
  `Preserve the same factual support as the original evidence. A complete sentence is not required. Prefer the smallest useful span of 120 to 250 characters; shorter is allowed, and never exceed the canonical ${LISTING_SOURCE_EVIDENCE_MAX_LENGTH}-character maximum.`,
  "Semantic facts and source identity are immutable: the repair output may select only replacement evidence and cannot change or supplement any fact value or source_ref.",
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
