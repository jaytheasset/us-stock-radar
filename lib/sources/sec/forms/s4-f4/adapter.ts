import { buildS4F4AnalysisPrompt, validateRequiredOutputJson } from "./analysisPrompt.ts";
import { parseS4F4Filing } from "./parser.ts";
import {
  S4_F4_PARSER_GROUP,
  S4_F4_PARSER_VERSION,
  type ParserOutput,
  type S4F4Fixture,
  type TickerRef,
} from "./types.ts";
import type { SecFormParserAttachment, SecFormParserInput } from "../common/parserContract.ts";

export const SEC_S4_F4_ADAPTER_KEY = "sec:s4-f4";
export const SEC_S4_F4_SUPPORTED_FORMS = ["S-4", "S-4/A", "F-4", "F-4/A"] as const;
export const SEC_S4_F4_ANALYSIS_MODE = "analysis_only" as const;

export type SecS4F4SupportedForm = (typeof SEC_S4_F4_SUPPORTED_FORMS)[number];

export function parseSecS4F4RuntimeInput(input: SecFormParserInput): ParserOutput {
  return parseS4F4Filing(toS4F4Fixture(input));
}

export const secS4F4Adapter = {
  key: SEC_S4_F4_ADAPTER_KEY,
  parserGroup: S4_F4_PARSER_GROUP,
  parserVersion: S4_F4_PARSER_VERSION,
  supportedForms: SEC_S4_F4_SUPPORTED_FORMS,
  analysisMode: SEC_S4_F4_ANALYSIS_MODE,
  parse: parseSecS4F4RuntimeInput,
  buildAnalysisPrompt: buildS4F4AnalysisPrompt,
  validateRequiredOutputJson,
};

function toS4F4Fixture(input: SecFormParserInput): S4F4Fixture {
  const formType = normalizeSupportedForm(input.formType);
  const primaryTicker = toTickerRef(input.ticker ?? null);
  const filingText = buildFilingText(input);

  return {
    id: input.rawItemId ?? input.accessionNumber ?? `${formType}-runtime`,
    description: input.title ?? `${formType} SEC filing`,
    formType,
    accessionNumber: input.accessionNumber ?? null,
    filingDate: input.filedAt ?? undefined,
    companyName: input.companyName ?? "Unknown registrant",
    primaryTicker,
    participants: [
      {
        name: input.companyName ?? "Unknown registrant",
        ticker: primaryTicker.ticker,
        exchange: primaryTicker.exchange,
        role: "registrant",
      },
    ],
    filingText,
    attachments: (input.attachments ?? []).map((attachment) => ({
      type: attachment.type ?? "unknown",
      description: attachment.description ?? attachment.filename ?? "",
      filename: attachment.filename ?? null,
      url: attachment.url ?? null,
      text: attachment.text ?? null,
      filedHerewith: null,
    })),
    market_context: null,
    parentFilingContext: readRuntimeParentFilingContext(input),
  };
}

function normalizeSupportedForm(formType: string): SecS4F4SupportedForm {
  const normalized = formType.trim().toUpperCase();
  if (SEC_S4_F4_SUPPORTED_FORMS.includes(normalized as SecS4F4SupportedForm)) {
    return normalized as SecS4F4SupportedForm;
  }

  return "S-4";
}

function toTickerRef(ticker: string | null): TickerRef {
  return {
    ticker: ticker && ticker.trim() ? ticker.trim().toUpperCase() : null,
    exchange: null,
  };
}

function buildFilingText(input: SecFormParserInput): string {
  const primaryText = extractPrimaryText(input);
  const documents = [
    buildDocumentBlock({
      type: input.formType,
      filename: primaryFilename(input),
      description: input.title ?? "Primary filing document",
      text: primaryText,
    }),
    ...(input.attachments ?? [])
      .filter((attachment) => attachment.text && attachment.text.trim())
      .map((attachment) => buildAttachmentDocumentBlock(attachment)),
  ].filter(Boolean);

  if (documents.length > 0) {
    return documents.join("\n");
  }

  return primaryText;
}

function extractPrimaryText(input: SecFormParserInput): string {
  const looseInput = input as SecFormParserInput & Record<string, unknown>;
  return (
    stringValue(input.primaryDocumentText) ||
    stringValue(looseInput.bodyText) ||
    stringValue(looseInput.analysisText) ||
    extractRawText(input.rawPayload) ||
    stringValue(looseInput.filingText) ||
    stringValue(looseInput.text) ||
    ""
  );
}

function buildAttachmentDocumentBlock(attachment: SecFormParserAttachment): string {
  return buildDocumentBlock({
    type: attachment.type ?? "EX-99",
    filename: attachment.filename ?? "attachment.txt",
    description: attachment.description ?? attachment.filename ?? "Attachment",
    text: attachment.text ?? "",
  });
}

function buildDocumentBlock(input: { type: string; filename: string; description: string; text: string }): string {
  const text = input.text.trim();
  if (!text) {
    return "";
  }

  return [
    "<DOCUMENT>",
    `<TYPE>${input.type}`,
    `<FILENAME>${input.filename}`,
    `<DESCRIPTION>${input.description}`,
    "<TEXT>",
    text,
    "</TEXT>",
    "</DOCUMENT>",
  ].join("\n");
}

function primaryFilename(input: SecFormParserInput): string {
  const sourceUrl = input.sourceUrl ?? "";
  const fileName = sourceUrl.split("/").filter(Boolean).pop();
  return fileName && fileName.includes(".") ? fileName : "primary-document.htm";
}

function extractRawText(rawPayload: Record<string, unknown> | null | undefined): string | null {
  if (!rawPayload) {
    return null;
  }

  for (const key of ["primaryDocumentText", "primary_document_text", "filingText", "filing_text", "body_text", "analysis_text", "text", "content", "body"]) {
    const value = rawPayload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function readRuntimeParentFilingContext(input: SecFormParserInput): Record<string, unknown> | null {
  const looseInput = input as SecFormParserInput & Record<string, unknown>;
  return (
    recordValue(looseInput.parent_filing_context) ||
    recordValue(looseInput.parentFilingContext) ||
    recordValue(input.rawPayload?.parent_filing_context) ||
    recordValue(input.rawPayload?.parentFilingContext) ||
    recordValue(input.metadata?.parent_filing_context) ||
    recordValue(input.metadata?.parentFilingContext) ||
    null
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
