import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  buildSecS3AmendmentTriagePrompt,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
} from "@/lib/prompts/secS3AmendmentTriage";
import {
  buildSecS3OfferingAnalysisPrompt,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
} from "@/lib/prompts/secS3OfferingAnalysis";
import {
  normalize424bOfferingDisplayModel,
  validate424bDisplayPayload,
} from "@/lib/ai/sec424bAnalysisAdapter";

export {
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
};

export type SecS3AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

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

export function buildSecS3TriagePrompt(input: SecFilingAnalysisInput) {
  return buildSecS3AmendmentTriagePrompt(input);
}

export function adaptSecS3AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS3AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S3 result did not contain analysis_output and display_payload",
    };
  }

  const displayPayloadError = validate424bDisplayPayload(displayPayload).replace(/^SEC 424B\b/, "SEC S3");
  if (displayPayloadError) {
    return {
      ok: false,
      error: displayPayloadError,
    };
  }

  const normalizedValue = {
    ...root,
    parser_output: normalizeS3ParserOutput(root?.parser_output, input),
  };
  const adapted = adaptSecFormRoomOutputForIngest(normalizedValue);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S3 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value),
  };
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_s3_analysis_mode: "analysis_only",
    sec_offering_analysis_mode: "analysis_only",
  };
}

function normalizeS3ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const s3 = readRecord(hardParsers.s3) || {};
  return {
    ...parser,
    parserVersion: stringValue(parser.parserVersion) || stringValue(s3.parser_version) || "sec_s3_parser_v1",
    parserGroup: stringValue(parser.parserGroup) || "s3",
    formType: stringValue(parser.formType) || stringValue(filingPackage.form_type) || stringValue(s3.form_type) || "S-3",
    accessionNumber:
      stringValue(parser.accessionNumber) ||
      stringValue(filingPackage.accession_number) ||
      stringValue(s3.accession_number) ||
      null,
    isSupported: typeof parser.isSupported === "boolean" ? parser.isSupported : true,
    facts: readRecord(parser.facts) || {
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      offering_terms: readRecord(s3.offering_terms) || null,
    },
    signals: Array.isArray(parser.signals) ? parser.signals : [],
    calendarItems: Array.isArray(parser.calendarItems) ? parser.calendarItems : [],
    warnings: Array.isArray(parser.warnings) ? parser.warnings : [],
    raw: readRecord(parser.raw) || {},
  };
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

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
