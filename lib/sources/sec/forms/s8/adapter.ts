import type { SecFormParserInput } from "../common/parserContract";
import { SEC_S8_FORMS } from "../common/forms";
import { secS8FetchPlan } from "./fetchPlan";
import { parseS8Filing } from "./parser";
import { buildS8RouterPrompt, routeS8Filing } from "./routerPrompt";
import {
  buildS8AnalysisPrompt,
  buildS8CompactAnalysisInput,
  buildS8DilutionAnalysisPrompt,
} from "./analysisPrompt";
import type { S8FixtureInput, S8ParserOutput } from "./types";

export const SEC_S8_ADAPTER_KEY = "sec_s8";
export const SEC_S8_PARSER_GROUP = "s8";
export const SEC_S8_ANALYSIS_MODE = "analysis_only";
export const SEC_S8_SUPPORTED_FORMS = SEC_S8_FORMS;

export type S8SupportedFormType = (typeof SEC_S8_SUPPORTED_FORMS)[number];

export function parseS8FormRoomFiling(input: S8FixtureInput | SecFormParserInput): S8ParserOutput {
  return parseS8Filing(toS8FixtureInput(input));
}

export function toS8FixtureInput(input: S8FixtureInput | SecFormParserInput): S8FixtureInput {
  if (isS8FixtureInput(input)) {
    return input;
  }

  const rawPayload = readRecord(input.rawPayload);
  const metadata = readRecord(input.metadata);

  return {
    fixtureName: input.rawItemId ?? input.accessionNumber ?? input.formType,
    formType: input.formType,
    accessionNumber: input.accessionNumber ?? null,
    filedAt: input.filedAt ?? null,
    issuer: {
      name: input.companyName ?? null,
      ticker: input.ticker ?? null,
      exchange: null,
    },
    filingText: input.primaryDocumentText ?? input.filingText ?? input.bodyText ?? input.analysisText ?? "",
    attachments: (input.attachments ?? []).map((attachment) => ({
      documentType: attachment.type ?? attachment.filename ?? null,
      description: attachment.description ?? attachment.filename ?? null,
      text: attachment.text ?? null,
    })),
    parentFilingContext:
      readRecord(rawPayload?.parent_filing_context) ||
      readRecord(rawPayload?.parentFilingContext) ||
      readRecord(metadata?.parent_filing_context) ||
      readRecord(metadata?.parentFilingContext),
    marketContext:
      readRecord(rawPayload?.market_context) ||
      readRecord(rawPayload?.marketContext) ||
      readRecord(metadata?.market_context) ||
      readRecord(metadata?.marketContext),
  };
}

function isS8FixtureInput(input: S8FixtureInput | SecFormParserInput): input is S8FixtureInput {
  return "fixtureName" in input;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const secS8FormAdapter = {
  key: SEC_S8_ADAPTER_KEY,
  parserGroup: SEC_S8_PARSER_GROUP,
  analysisMode: SEC_S8_ANALYSIS_MODE,
  supportedForms: SEC_S8_SUPPORTED_FORMS,
  fetchPlan: secS8FetchPlan,
  parse: parseS8FormRoomFiling,
  parser: parseS8FormRoomFiling,
  route: routeS8Filing,
  buildRouterPrompt: buildS8RouterPrompt,
  buildAnalysisPrompt: buildS8AnalysisPrompt,
  buildDilutionAnalysisPrompt: buildS8DilutionAnalysisPrompt,
  buildCompactAnalysisInput: buildS8CompactAnalysisInput,
} as const;

export default secS8FormAdapter;
