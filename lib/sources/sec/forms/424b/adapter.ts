import { build424bAnalysisPrompt } from "./analysisPrompt";
import { parse424bFiling } from "./parser";
import {
  DISPLAY_PAYLOAD_VERSION_424B,
  PARSER_GROUP_424B,
  PARSER_VERSION_424B,
} from "./types";
import type { SecFormParserInput } from "../common/parserContract";
import type { Sec424bAttachment, Sec424bParseInput } from "./types";

export const SEC_424B_ADAPTER_KEY = "sec-424b";
export const SEC_424B_SUPPORTED_FORMS = [
  "424B",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
  "424B8",
] as const;
export const SEC_424B_ANALYSIS_MODE = "analysis_only" as const;

function attachmentTextFromRawPayload(rawPayload: Record<string, unknown> | null | undefined): Sec424bAttachment[] {
  const attachmentTexts = rawPayload?.attachment_texts;
  if (!Array.isArray(attachmentTexts)) {
    return [];
  }

  return attachmentTexts
    .map((attachment): Sec424bAttachment | null => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }

      const record = attachment as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text : "";
      if (!text) {
        return null;
      }

      return {
        filename: typeof record.filename === "string" ? record.filename : undefined,
        description: typeof record.description === "string" ? record.description : undefined,
        text,
      };
    })
    .filter((attachment): attachment is Sec424bAttachment => attachment !== null);
}

function primaryTextFromInput(input: SecFormParserInput): string {
  const primaryText =
    input.primaryDocumentText ||
    input.bodyText ||
    input.analysisText ||
    input.filingText ||
    input.text ||
    "";
  const primaryHtml =
    input.rawPayload && typeof input.rawPayload === "object" && !Array.isArray(input.rawPayload)
      ? typeof input.rawPayload.primary_document_html === "string"
        ? input.rawPayload.primary_document_html
        : ""
      : "";

  if (!primaryHtml) {
    return primaryText;
  }

  return [primaryText, primaryHtml].filter(Boolean).join("\n\n");
}

function to424bParserInput(input: SecFormParserInput): Sec424bParseInput {
  const explicitAttachments = (input.attachments ?? [])
    .map((attachment): Sec424bAttachment | null => {
      if (!attachment.text) {
        return null;
      }

      return {
        filename: attachment.filename ?? undefined,
        description: attachment.description ?? attachment.type ?? undefined,
        text: attachment.text,
      };
    })
    .filter((attachment): attachment is Sec424bAttachment => attachment !== null);

  return {
    formType: input.formType,
    accessionNumber: input.accessionNumber ?? null,
    issuer: {
      name: input.companyName ?? null,
      ticker: input.ticker ?? null,
      exchange:
        typeof input.metadata?.exchange === "string"
          ? input.metadata.exchange
          : typeof input.rawPayload?.exchange === "string"
            ? input.rawPayload.exchange
            : null,
    },
    filingText: primaryTextFromInput(input),
    attachments: [...explicitAttachments, ...attachmentTextFromRawPayload(input.rawPayload)],
    parentFilingContext: {
      rawItemId: input.rawItemId ?? null,
      cik: input.cik ?? null,
      filedAt: input.filedAt ?? null,
      title: input.title ?? null,
      sourceUrl: input.sourceUrl ?? null,
    },
    marketContext:
      input.metadata?.marketContext && typeof input.metadata.marketContext === "object"
        ? (input.metadata.marketContext as Record<string, unknown>)
        : undefined,
  };
}

export function parseSec424bForm(input: SecFormParserInput) {
  return parse424bFiling(to424bParserInput(input));
}

export const sec424bAdapter = {
  key: SEC_424B_ADAPTER_KEY,
  parserGroup: PARSER_GROUP_424B,
  parserVersion: PARSER_VERSION_424B,
  supportedForms: SEC_424B_SUPPORTED_FORMS,
  analysisMode: SEC_424B_ANALYSIS_MODE,
  displayPayloadVersion: DISPLAY_PAYLOAD_VERSION_424B,
  parse: parseSec424bForm,
  buildAnalysisPrompt: build424bAnalysisPrompt,
};
