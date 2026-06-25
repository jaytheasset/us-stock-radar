import { buildS1F1AnalysisPrompt } from "./analysisPrompt.ts";
import { parseS1F1Filing } from "./parser.ts";
import {
  S1F1_PARSER_GROUP,
  S1F1_PARSER_VERSION,
  type S1F1ParserInput,
  type S1F1ParserOutput,
} from "./types.ts";

export const S1F1_ADAPTER_KEY = "sec-s1-f1";
export const S1F1_SUPPORTED_FORMS = ["S-1", "S-1/A", "F-1", "F-1/A", "S-1MEF", "F-1MEF", "POS AM"] as const;
export const S1F1_ADJACENT_FORMS = [] as const;
export const S1F1_ANALYSIS_MODE = "analysis_only";

type RuntimeAttachment = {
  name?: string | null;
  filename?: string | null;
  description?: string | null;
  text?: string | null;
};

export type S1F1RuntimeParserInput =
  | S1F1ParserInput
  | {
      formType: string;
      accessionNumber?: string | null;
      primaryDocumentText?: string | null;
      filingText?: string | null;
      ticker?: string | null;
      companyName?: string | null;
      exchange?: string | null;
      filedAt?: string | null;
      metadata?: S1F1ParserInput["metadata"];
      attachments?: RuntimeAttachment[];
      parentFilingContext?: S1F1ParserInput["parentFilingContext"];
      marketContext?: S1F1ParserInput["marketContext"];
    };

function isS1F1ParserInput(input: S1F1RuntimeParserInput): input is S1F1ParserInput {
  return typeof (input as S1F1ParserInput).filingText === "string";
}

export function normalizeS1F1ParserInput(input: S1F1RuntimeParserInput): S1F1ParserInput {
  if (isS1F1ParserInput(input)) return input;

  return {
    formType: input.formType,
    accessionNumber: input.accessionNumber ?? null,
    filingText: input.primaryDocumentText ?? input.filingText ?? "",
    metadata: {
      companyName: input.metadata?.companyName ?? input.companyName ?? null,
      ticker: input.metadata?.ticker ?? input.ticker ?? null,
      exchange: input.metadata?.exchange ?? input.exchange ?? null,
      filedAt: input.metadata?.filedAt ?? input.filedAt ?? null,
    },
    attachments: input.attachments?.map((attachment) => ({
      name: attachment.name ?? attachment.filename ?? "attachment",
      description: attachment.description ?? null,
      text: attachment.text ?? null,
    })),
    parentFilingContext: input.parentFilingContext ?? null,
    marketContext: input.marketContext ?? null,
  };
}

export function parseS1F1RuntimeFiling(input: S1F1RuntimeParserInput): S1F1ParserOutput {
  return parseS1F1Filing(normalizeS1F1ParserInput(input));
}

export const s1F1Adapter = {
  key: S1F1_ADAPTER_KEY,
  parserGroup: S1F1_PARSER_GROUP,
  parserVersion: S1F1_PARSER_VERSION,
  supportedForms: S1F1_SUPPORTED_FORMS,
  adjacentForms: S1F1_ADJACENT_FORMS,
  analysisMode: S1F1_ANALYSIS_MODE,
  parse: parseS1F1RuntimeFiling,
  parserEntrypoint: parseS1F1Filing,
  normalizeParserInput: normalizeS1F1ParserInput,
  buildAnalysisPrompt: buildS1F1AnalysisPrompt,
} as const;

export default s1F1Adapter;
