import type { SecFormParserInput } from "../common/parserContract";

import { buildSec425AnalysisPromptDraft, buildSec425DeterministicRoomResult } from "./analysisPrompt";
import { buildSec425DisplayPayload } from "./displayPayload";
import { parseSec425Filing } from "./parser";
import { buildSec425RouterPromptDraft, routeSec425ParserOutput } from "./routerPrompt";
import { SEC_425_PARSER_GROUP, type Sec425ParseInput } from "./types";

export const SEC_425_ADAPTER_KEY = "sec_425";
export const SEC_425_SUPPORTED_FORMS = ["425"] as const;
export const SEC_425_ANALYSIS_MODE = "router_required" as const;

export function parseSec425AdapterInput(input: SecFormParserInput) {
  return parseSec425Filing(toSec425ParseInput(input));
}

export const sec425Adapter = {
  adapterKey: SEC_425_ADAPTER_KEY,
  parserGroup: SEC_425_PARSER_GROUP,
  supportedForms: SEC_425_SUPPORTED_FORMS,
  analysisMode: SEC_425_ANALYSIS_MODE,
  parse: parseSec425AdapterInput,
  parser: parseSec425AdapterInput,
  parseSec425Filing,
  route: routeSec425ParserOutput,
  buildRouterPrompt: buildSec425RouterPromptDraft,
  buildDisplayPayload: buildSec425DisplayPayload,
  buildAnalysisPrompt: buildSec425AnalysisPromptDraft,
  buildDeterministicRoomResult: buildSec425DeterministicRoomResult,
} as const;

export const sec425FormAdapter = sec425Adapter;

function toSec425ParseInput(input: SecFormParserInput): Sec425ParseInput {
  const runtimeInput = input as SecFormParserInput & {
    bodyText?: string | null;
    primaryDocumentText?: string | null;
  };
  const rawPayload = toRecord(input.rawPayload);
  const primaryDocument = recordArray(rawPayload.documents).find((document) => document.isPrimary === true) || null;
  return {
    rawItemId: input.rawItemId,
    sourceUniqueId: input.accessionNumber,
    sourceUrl: input.sourceUrl,
    primaryDocumentUrl: stringValue(primaryDocument?.url) || input.sourceUrl,
    primaryDocumentFilename: stringValue(primaryDocument?.document) || null,
    primaryDocumentDescription: stringValue(primaryDocument?.description) || input.title,
    title: input.title,
    publishedAt: input.filedAt,
    formType: input.formType,
    accessionNumber: input.accessionNumber,
    companyName: input.companyName,
    primaryTicker: input.ticker,
    filingText: extractPrimaryDocumentText(runtimeInput.bodyText || runtimeInput.primaryDocumentText || null),
    attachments: (input.attachments || []).map((attachment) => ({
      documentType: attachment.type,
      description: attachment.description || attachment.filename,
      filename: attachment.filename,
      text: attachment.text,
      url: attachment.url,
    })),
    rawPayload: input.rawPayload,
    metadata: input.metadata,
  };
}

function extractPrimaryDocumentText(value: string | null | undefined) {
  const text = stringValue(value);
  if (!text.startsWith("### ")) return text;
  const firstHeaderEnd = text.indexOf("\n");
  if (firstHeaderEnd < 0) return text;
  const nextDocument = text.indexOf("\n\n### ", firstHeaderEnd + 1);
  return text.slice(firstHeaderEnd + 1, nextDocument < 0 ? undefined : nextDocument).trim();
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
