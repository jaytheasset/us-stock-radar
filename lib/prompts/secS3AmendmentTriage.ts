import { type SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";

export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY = "sec_s3_amendment_triage";
export const SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION = "v1";

export const SEC_S3_AMENDMENT_TRIAGE_ACTION_VALUES = ["skip_analysis", "needs_offering_audit"] as const;
export const SEC_S3_AMENDMENT_TRIAGE_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export const secS3AmendmentTriageSystemPrompt = [
  "Triage one SEC S-3/A amendment and return only strict JSON matching the provided response schema.",
  "Your only job is to decide whether this S-3/A amendment needs the expensive offering/security audit.",
  "Do not perform numeric security-stack audit. Do not write investor analysis. Do not score the event.",
  "Focus on what changed in the amendment itself. Parent registration context is background only.",
  "Do not treat repeated parent S-3 share counts, shelf amounts, fee table amounts, resale pools, warrants, or conversion terms as new unless the amendment text shows they changed.",
  "If parent_registration_context is missing and the S-3/A includes concrete resale share counts, fee-table economics, selling-holder overhang, ATM terms, warrant terms, conversion terms, or offering economics, prefer needs_offering_audit unless the amendment is clearly limited to consent/exhibit housekeeping.",
  "Choose skip_analysis when the amendment is routine: auditor consent, exhibit-only update, signature, legal housekeeping, delaying amendment, incorporated-document update, unchanged remainder, or no changed economics.",
  "A full prospectus or repeated base-shelf language is not material by itself. The deciding question is whether the amendment changes the economics, securities, holders, timing, or distribution terms.",
  "Treat EX-107 or filing-fee table changes as routine when they only update fee mechanics and do not change amount registered, share count, security class, selling holders, price, proceeds, or distribution terms.",
  "Treat refiled Exhibit 107 / filing-fee correction / fee carry-forward cleanup as skip_analysis when the amendment says no offering economics changed.",
  "Treat EX-99 operational or trust service exhibits as routine for dilution/offering triage unless they change securities, proceeds, sale mechanics, holder pools, warrants, convertibles, or distribution terms.",
  "Treat incorporation-by-reference updates as routine unless the referenced update changes a financing agreement, offering terms, warrant/convertible terms, selling-holder pool, or share/proceeds economics.",
  "Choose needs_offering_audit when the amendment changes or newly discloses offering economics, share count, selling holders, fee table economics, distribution plan, ATM terms, shelf takedown terms, warrant terms, convertible terms, pricing, proceeds, or a material overhang-related item.",
  "If the amendment text is ambiguous but could hide changed offering terms, choose needs_offering_audit and set needs_human_review true.",
  "archive_summary is an internal one-sentence reason. For skip_analysis, state why no event/audit is needed. For needs_offering_audit, state what changed or needs audit.",
  "Keep all arrays to at most 4 short items.",
].join("\n");

export const secS3AmendmentTriageResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "triage_action",
    "material_change",
    "material_change_reasons",
    "routine_reasons",
    "archive_summary",
    "confidence",
    "needs_human_review",
  ],
  properties: {
    triage_action: { type: "string", enum: SEC_S3_AMENDMENT_TRIAGE_ACTION_VALUES },
    material_change: { type: "boolean" },
    material_change_reasons: { type: "array", items: { type: "string" } },
    routine_reasons: { type: "array", items: { type: "string" } },
    archive_summary: { type: "string" },
    confidence: { type: "string", enum: SEC_S3_AMENDMENT_TRIAGE_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
  },
} as const;

export function buildSecS3AmendmentTriagePrompt(input: SecFilingAnalysisInput) {
  return {
    key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
    version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
    system: secS3AmendmentTriageSystemPrompt,
    user: JSON.stringify(buildSecS3AmendmentTriagePromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s3_amendment_triage",
        strict: true,
        schema: secS3AmendmentTriageResponseSchema,
      },
    },
  };
}

function buildSecS3AmendmentTriagePromptInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const routerEvidence = readRecord(filingPackage.router_evidence) || {};
  const s3Evidence = readRecord(routerEvidence.s3) || {};
  const s3Parser = readRecord(hardParsers.s3) || {};
  const routerExcerpt = stringValue(s3Evidence.router_excerpt) || trimForPrompt(stringValue(filingPackage.llm_text), 10_000);

  return {
    filing_package: {
      package_version: filingPackage.package_version || null,
      raw_item_id: filingPackage.raw_item_id || null,
      accession_number: filingPackage.accession_number || null,
      cik: filingPackage.cik || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      tickers: Array.isArray(filingPackage.tickers) ? filingPackage.tickers : [],
      form_type: filingPackage.form_type || null,
      filed_at: filingPackage.filed_at || null,
      title: filingPackage.title || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      documents: Array.isArray(filingPackage.documents) ? filingPackage.documents : [],
      parser_candidates: {
        warning:
          "Parser candidates are unverified hints. Decide only whether the S-3/A amendment changed material offering terms.",
        amendment: readRecord(s3Parser.amendment) || readRecord(s3Evidence.amendment) || null,
        core_terms: readRecord(s3Evidence.core_terms) || null,
        s3_summary: {
          registration_statement_kind: s3Parser.registration_statement_kind || null,
          registration_status: s3Parser.registration_status || null,
          prospectus_status: s3Parser.prospectus_status || null,
          primary_or_resale: s3Parser.primary_or_resale || null,
          fee_table: readRecord(s3Parser.fee_table) || null,
          selling_stockholders: readRecord(s3Parser.selling_stockholders) || null,
          review_reasons: Array.isArray(s3Parser.review_reasons) ? s3Parser.review_reasons : [],
        },
      },
      router_evidence: {
        s3: {
          evidence_version: s3Evidence.evidence_version || null,
          form_type: s3Evidence.form_type || null,
          important_sections: Array.isArray(s3Evidence.important_sections) ? s3Evidence.important_sections : [],
          important_tables: readRecord(s3Evidence.important_tables) || null,
          source_documents: Array.isArray(s3Evidence.source_documents) ? s3Evidence.source_documents : [],
          router_excerpt: routerExcerpt,
        },
      },
      parent_registration_context: filingPackage.parent_registration_context || null,
    },
  };
}

function trimForPrompt(value: string, max: number) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 12).trim()}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
