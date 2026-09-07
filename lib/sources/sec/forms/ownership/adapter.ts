import {
  buildOwnershipDisplayPayload,
  buildOwnershipRoutingDecision,
  OWNERSHIP_FORM_SCOPE,
  OWNERSHIP_PARSER_GROUP,
  parseOwnershipFiling,
} from "./parser.ts";
import { SEC_OWNERSHIP_FORMS } from "../common/forms.ts";
import {
  buildOwnershipAnalysisInput,
  buildOwnershipAnalysisPrompt,
  OWNERSHIP_ANALYSIS_PROMPT,
} from "./analysisPrompt.ts";
import type { OwnershipFixtureInput, OwnershipParserOutput } from "./parser.ts";
export type { OwnershipParserOutput } from "./parser.ts";

export const ownershipAdapterKey = "ownership";
export const ownershipParserGroup = OWNERSHIP_PARSER_GROUP;
export const ownershipSupportedForms = SEC_OWNERSHIP_FORMS;
export const ownershipAnalysisMode = "ownership_direct_analysis" as const;

export function parseOwnershipForm(input: OwnershipFixtureInput): OwnershipParserOutput {
  return parseOwnershipFiling(input);
}

export const ownershipFormAdapter = {
  key: ownershipAdapterKey,
  parserGroup: ownershipParserGroup,
  forms: ownershipSupportedForms,
  formScope: OWNERSHIP_FORM_SCOPE,
  supportedForms: ownershipSupportedForms,
  analysisMode: ownershipAnalysisMode,
  routerRequired: false,
  matches: (canonicalFormType: string) => ownershipSupportedForms.includes(canonicalFormType as (typeof ownershipSupportedForms)[number]),
  parse: (rawItem: Record<string, unknown>, formType: string | null) => {
    const parserOutput = parseOwnershipFiling(buildRuntimeOwnershipParserInput(rawItem, formType));
    return {
      worker: {
        key: ownershipAdapterKey,
        parserGroup: ownershipParserGroup,
        analysisMode: ownershipAnalysisMode,
      },
      hardParsers: {
        ownership: parserOutput,
      },
      parserOutputs: {
        ownership: parserOutput,
      },
      s3Parsed: null,
      ownershipParsed: parserOutput,
    };
  },
  parseFixture: parseOwnershipForm,
  buildRoutingDecision: buildOwnershipRoutingDecision,
  buildDisplayPayload: buildOwnershipDisplayPayload,
  buildAnalysisInput: buildOwnershipAnalysisInput,
  buildAnalysisPrompt: buildOwnershipAnalysisPrompt,
  analysisPrompt: OWNERSHIP_ANALYSIS_PROMPT,
};

export const ownershipAdapter = ownershipFormAdapter;

export function buildRuntimeOwnershipParserInput(rawItem: Record<string, unknown>, formType: string | null): OwnershipFixtureInput {
  const rawPayload = recordValue(rawItem.raw_payload);
  const metadata = recordValue(rawItem.metadata);
  const attachments = attachmentArray(rawPayload.attachment_texts);
  const marketContext =
    nonEmptyRecordValue(rawPayload.market_context) ??
    nonEmptyRecordValue(rawPayload.marketContext) ??
    nonEmptyRecordValue(metadata.market_context) ??
    nonEmptyRecordValue(metadata.marketContext);
  const ownershipOriginalFiling =
    originalFilingValue(rawItem.ownership_original_filing) ??
    originalFilingValue(rawItem.ownershipOriginalFiling) ??
    originalFilingValue(rawPayload.ownership_original_filing) ??
    originalFilingValue(rawPayload.ownershipOriginalFiling) ??
    originalFilingValue(metadata.ownership_original_filing) ??
    originalFilingValue(metadata.ownershipOriginalFiling);
  return {
    id: stringValue(rawItem.id) || stringValue(rawItem.source_unique_id) || "runtime-sec-ownership",
    formType: stringValue(formType) || stringValue(rawItem.source_code) || "4",
    accessionNumber:
      stringValue(rawPayload.accession_number) ||
      stringValue(rawPayload.accessionNumber) ||
      stringValue(metadata.accession_number) ||
      stringValue(rawItem.source_unique_id) ||
      null,
    filingText: [stringValue(rawItem.body_text), stringValue(rawItem.analysis_text), ...attachments.map((attachment) => attachment.text || "")]
      .filter(Boolean)
      .join("\n\n"),
    attachments,
    rawPayload,
    metadata,
    ...(marketContext ? { market_context: marketContext } : {}),
    ...(ownershipOriginalFiling ? { ownership_original_filing: ownershipOriginalFiling } : {}),
    issuer: {
      name: stringValue(rawPayload.company_name) || stringValue(rawPayload.companyName) || stringValue(metadata.company_name) || stringValue(metadata.companyName) || null,
      ticker: stringValue(rawPayload.ticker) || stringValue(rawPayload.symbol) || stringValue(metadata.ticker) || stringValue(metadata.symbol) || null,
      exchange: stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
      cik: stringValue(rawPayload.cik) || stringValue(rawPayload.issuer_cik) || stringValue(metadata.cik) || null,
    },
    source: {
      url: stringValue(rawItem.source_url) || stringValue(rawPayload.source_url) || stringValue(rawPayload.detail_url) || null,
    },
  };
}

function attachmentArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(recordValue).map((attachment) => ({
    type: stringValue(attachment.type) || stringValue(attachment.documentType) || null,
    description: stringValue(attachment.description) || null,
    filename: stringValue(attachment.filename) || stringValue(attachment.name) || null,
    url: stringValue(attachment.url) || null,
    text: stringValue(attachment.text) || null,
  }));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmptyRecordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record).length ? record : null;
}

function originalFilingValue(value: unknown): Record<string, unknown> | string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return nonEmptyRecordValue(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
