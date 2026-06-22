import {
  buildSecOfferingAuditPrompt,
  SEC_OFFERING_AUDIT_PROMPT_KEY,
  SEC_OFFERING_AUDIT_PROMPT_VERSION,
} from "@/lib/prompts/secOfferingAudit";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSecS3AmendmentTriagePrompt,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
} from "@/lib/prompts/secS3AmendmentTriage";
import {
  buildSecS3OfferingAnalysisPrompt,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
} from "@/lib/prompts/secS3OfferingAnalysis";

export {
  SEC_OFFERING_AUDIT_PROMPT_KEY,
  SEC_OFFERING_AUDIT_PROMPT_VERSION,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
};

export function isS3FilingInput(input: SecFilingAnalysisInput) {
  if (readSecFormAnalysisMode(input) === "s3_offering_flow") return true;

  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (/^S-3(?:ASR|\/A)?$/.test(formType)) return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  return s3?.is_s3_family === true;
}

export function isS3AmendmentInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (formType === "S-3/A") return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  return s3?.is_s3_family === true && amendment?.is_amendment === true;
}

export function buildSecS3AnalysisPrompt(input: SecFilingAnalysisInput) {
  return buildSecS3OfferingAnalysisPrompt(input);
}

export function buildSecS3AuditPrompt(input: SecFilingAnalysisInput) {
  return buildSecOfferingAuditPrompt(input);
}

export function buildSecS3TriagePrompt(input: SecFilingAnalysisInput) {
  return buildSecS3AmendmentTriagePrompt(input);
}

function readSecFormAnalysisMode(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const adapter = readRecord(filingPackage?.form_adapter);
  return stringValue(adapter?.analysisMode);
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
