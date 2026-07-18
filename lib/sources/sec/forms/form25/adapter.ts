import { buildSecForm25AnalysisPromptDraft } from "./analysisPrompt";
import { SEC_FORM25_FORMS } from "../common/forms";
import { secForm25FetchPlan } from "./fetchPlan";
import {
  SEC_FORM25_PARSER_GROUP,
  parseSecForm25Filing,
  type SecForm25ParserOutput,
} from "./parser";

export const SEC_FORM25_ADAPTER_KEY = "form25";
export const SEC_FORM25_SUPPORTED_FORMS = SEC_FORM25_FORMS;
export const SEC_FORM25_ANALYSIS_MODE = "generic_sec_analysis";

export type SecForm25AdapterRawItem = {
  id?: unknown;
  source_unique_id?: unknown;
  source_url?: unknown;
  title?: unknown;
  published_at?: unknown;
  body_text?: unknown;
  analysis_text?: unknown;
  raw_payload?: unknown;
  metadata?: unknown;
};

export type SecForm25AdapterResult = {
  worker: {
    key: typeof SEC_FORM25_ADAPTER_KEY;
    parserGroup: typeof SEC_FORM25_PARSER_GROUP;
    analysisMode: typeof SEC_FORM25_ANALYSIS_MODE;
  };
  hardParsers: {
    form25: SecForm25ParserOutput;
  };
  parserOutputs: {
    form25: SecForm25ParserOutput;
  };
  s3Parsed: null;
  ownershipParsed: null;
};

export const form25FormAdapter = {
  key: SEC_FORM25_ADAPTER_KEY,
  parserGroup: SEC_FORM25_PARSER_GROUP,
  forms: SEC_FORM25_SUPPORTED_FORMS,
  analysisMode: SEC_FORM25_ANALYSIS_MODE,
  fetchPlan: secForm25FetchPlan,
  matches: isSecForm25CanonicalFormType,
  parse: (rawItem: SecForm25AdapterRawItem, formType: string | null): SecForm25AdapterResult => {
    const parsed = parseSecForm25Filing(buildForm25ParserInput(rawItem, formType));
    return {
      worker: {
        key: SEC_FORM25_ADAPTER_KEY,
        parserGroup: SEC_FORM25_PARSER_GROUP,
        analysisMode: SEC_FORM25_ANALYSIS_MODE,
      },
      hardParsers: {
        form25: parsed,
      },
      parserOutputs: {
        form25: parsed,
      },
      s3Parsed: null,
      ownershipParsed: null,
    };
  },
  buildAnalysisPrompt: (parserOutput: SecForm25ParserOutput) =>
    buildSecForm25AnalysisPromptDraft({
      parser_output: parserOutput,
    }),
};

export function isSecForm25CanonicalFormType(form: string | null | undefined) {
  return typeof form === "string" && SEC_FORM25_SUPPORTED_FORMS.includes(form as (typeof SEC_FORM25_SUPPORTED_FORMS)[number]);
}

function buildForm25ParserInput(rawItem: SecForm25AdapterRawItem, formType: string | null) {
  const rawPayload = toRecord(rawItem.raw_payload) || {};
  const metadata = toRecord(rawItem.metadata) || {};
  return {
    rawItemId: nullableString(rawItem.id),
    sourceUniqueId:
      nullableString(rawItem.source_unique_id) ||
      nullableString(rawPayload.accession_number) ||
      nullableString(rawPayload.accessionNumber) ||
      nullableString(metadata.accession_number),
    sourceUrl:
      nullableString(rawItem.source_url) ||
      nullableString(rawPayload.detail_url) ||
      nullableString(rawPayload.source_url),
    title: nullableString(rawItem.title),
    publishedAt: nullableString(rawItem.published_at),
    bodyText: nullableString(rawItem.body_text),
    analysisText: nullableString(rawItem.analysis_text),
    rawPayload: {
      ...rawPayload,
      form_type: nullableString(rawPayload.form_type) || nullableString(rawPayload.formType) || formType,
    },
    metadata: rawItem.metadata,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export { buildSecForm25AnalysisPromptDraft } from "./analysisPrompt";
export { parseSecForm25Filing } from "./parser";
export type { SecForm25ParserOutput } from "./parser";
